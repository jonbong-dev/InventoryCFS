/**
 * Licensing Subsystem — Verification and Seat Enforcement ONLY.
 *
 * CRITICAL TRUST BOUNDARY:
 * This module ONLY verifies cryptographic signatures and manages active seats.
 * It does NOT generate or issue license keys. Key generation lives strictly
 * in a separate standalone tool outside the deployable runtime.
 */
const crypto = require('crypto');

function getSecret() {
  return process.env.LICENSE_HMAC_SECRET || 'inventory-tracker-secret-key-2026';
}

/**
 * Verifies an HMAC-SHA256 signed license key.
 * Expected format: LIC-<base64url_payload>.<hex_signature>
 */
function verifyLicenseKey(keyString) {
  if (!keyString || typeof keyString !== 'string') {
    return { valid: false, error: 'License key is missing or empty' };
  }

  const trimmed = keyString.trim();
  if (!trimmed.startsWith('LIC-')) {
    return { valid: false, error: 'Invalid license format. Must start with LIC-' };
  }

  const parts = trimmed.slice(4).split('.');
  if (parts.length !== 2) {
    return { valid: false, error: 'Invalid license key structure. Missing signature segment.' };
  }

  const [payloadB64, providedSigHex] = parts;

  let payload;
  try {
    const jsonStr = Buffer.from(payloadB64, 'base64url').toString('utf8');
    payload = JSON.parse(jsonStr);
  } catch (err) {
    return { valid: false, error: 'Malformed license payload encoding.' };
  }

  if (!payload.customer || !payload.expires || !payload.seats) {
    return { valid: false, error: 'License payload missing required attributes (customer, expires, seats).' };
  }

  // Verify HMAC-SHA256 signature
  const expectedSigHex = crypto
    .createHmac('sha256', getSecret())
    .update(payloadB64)
    .digest('hex');

  const providedBuf = Buffer.from(providedSigHex, 'hex');
  const expectedBuf = Buffer.from(expectedSigHex, 'hex');

  if (providedBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(providedBuf, expectedBuf)) {
    return { valid: false, error: 'Invalid license signature. Key has been altered or signed with an unrecognized key.' };
  }

  // Check expiration date
  const expiryDate = new Date(payload.expires);
  if (isNaN(expiryDate.getTime())) {
    return { valid: false, error: 'Invalid expiry date format in license.' };
  }

  if (expiryDate.getTime() < Date.now()) {
    return {
      valid: false,
      error: `License expired on ${expiryDate.toLocaleDateString()}. Please renew or activate a valid key.`,
      payload,
    };
  }

  const seats = parseInt(payload.seats, 10);
  if (isNaN(seats) || seats < 1) {
    return { valid: false, error: 'License must authorize at least 1 seat.' };
  }

  return {
    valid: true,
    payload: {
      customer: payload.customer,
      issued: payload.issued,
      expires: expiryDate.toISOString(),
      seats,
    },
  };
}

/**
 * Retrieves the current active license from the database.
 * If no license exists, auto-provisions a default 30-day, 1-seat trial.
 */
async function getActiveLicense(db) {
  let record = await db('license_state').orderBy('id', 'desc').first();

  if (!record) {
    // Auto-activate 30-day, 1-seat default trial
    const trialDays = 30;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + trialDays * 24 * 60 * 60 * 1000);

    const [newId] = await db('license_state')
      .insert({
        license_key: 'TRIAL-DEFAULT-30DAYS-1SEAT',
        customer_name: 'Trial Customer (Evaluation Mode)',
        seats: 1,
        expires_at: expiresAt,
        activated_at: now,
        is_trial: true,
      })
      .returning('id');

    record = await db('license_state').where('id', typeof newId === 'object' ? newId.id : newId).first();
  }

  const now = new Date();
  const expiresAt = new Date(record.expires_at);
  const isExpired = expiresAt.getTime() < now.getTime();
  const daysRemaining = Math.max(0, Math.ceil((expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));

  // Count active sessions currently logged in
  const activeCountRes = await db('active_sessions').count('session_id as count').first();
  const currentActiveSessions = Number(activeCountRes ? activeCountRes.count : 0);

  return {
    id: record.id,
    customer_name: record.customer_name,
    seats: Number(record.seats),
    active_seats_in_use: currentActiveSessions,
    expires_at: record.expires_at,
    activated_at: record.activated_at,
    is_trial: Boolean(record.is_trial),
    is_expired: isExpired,
    days_remaining: daysRemaining,
    license_key_masked: record.license_key ? `${record.license_key.slice(0, 10)}...${record.license_key.slice(-8)}` : '',
  };
}

/**
 * Activates a new signed license key.
 */
async function activateLicenseKey(db, keyString) {
  const verification = verifyLicenseKey(keyString);
  if (!verification.valid) {
    return { success: false, error: verification.error };
  }

  const { customer, expires, seats } = verification.payload;

  await db('license_state').insert({
    license_key: keyString.trim(),
    customer_name: customer,
    seats,
    expires_at: new Date(expires),
    activated_at: new Date(),
    is_trial: false,
  });

  return {
    success: true,
    license: {
      customer,
      expires,
      seats,
    },
  };
}

/**
 * Seat Management:
 * Enforces concurrent login seat limits upon login.
 * - Re-login by same user replaces their prior session without consuming an extra seat.
 * - Logging in beyond seat count evicts the oldest active session.
 */
async function handleLoginSeatAllocation(db, sessionId, user) {
  const license = await getActiveLicense(db);
  const maxSeats = Math.max(1, license.seats);

  // 1. If this user already has an active session, remove the prior session (replaces own session)
  await db('active_sessions').where('user_id', user.id).del();

  // 2. Clean up stale sessions inactive for > 24 hours
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  await db('active_sessions').where('last_seen', '<', cutoff).del();

  // 3. Count remaining active sessions
  const activeSessions = await db('active_sessions').orderBy('created_at', 'asc');

  // 4. If current count >= maxSeats, evict oldest sessions to free a seat
  if (activeSessions.length >= maxSeats) {
    const evictCount = activeSessions.length - maxSeats + 1;
    const toEvict = activeSessions.slice(0, evictCount).map((s) => s.session_id);
    if (toEvict.length > 0) {
      await db('active_sessions').whereIn('session_id', toEvict).del();
    }
  }

  // 5. Register the new active session
  await db('active_sessions').insert({
    session_id: sessionId,
    user_id: user.id,
    username: user.username,
    created_at: new Date(),
    last_seen: new Date(),
  });
}

/**
 * Checks if a session is still valid (not evicted by another login).
 */
async function isSessionActive(db, sessionId) {
  if (!sessionId) return false;
  const session = await db('active_sessions').where('session_id', sessionId).first();
  return Boolean(session);
}

/**
 * Updates last_seen timestamp on request.
 */
async function touchSession(db, sessionId) {
  if (!sessionId) return;
  await db('active_sessions')
    .where('session_id', sessionId)
    .update({ last_seen: new Date() })
    .catch(() => {});
}

/**
 * Removes session on explicit user logout.
 */
async function removeSession(db, sessionId) {
  if (!sessionId) return;
  await db('active_sessions').where('session_id', sessionId).del().catch(() => {});
}

module.exports = {
  verifyLicenseKey,
  getActiveLicense,
  activateLicenseKey,
  handleLoginSeatAllocation,
  isSessionActive,
  touchSession,
  removeSession,
};
