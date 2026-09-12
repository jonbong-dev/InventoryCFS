#!/usr/bin/env node
/**
 * STANDALONE LICENSE GENERATOR
 *
 * CRITICAL TRUST BOUNDARY:
 * This tool is for software vendors/distributors to issue cryptographically signed keys.
 * IT MUST NEVER BE DEPLOYED WITH THE APPLICATION OR EXPOSED VIA HTTP ENDPOINTS.
 *
 * Usage:
 *   node generate-key.js --customer "Acme Industrial" --seats 5 --days 365
 *   node generate-key.js -c "MegaCorp Ltd" -s 10 -d 90 --secret "custom-secret"
 */
const crypto = require('crypto');

function parseArgs() {
  const args = process.argv.slice(2);
  const params = {
    customer: 'Enterprise Client',
    seats: 5,
    days: 365,
    secret: process.env.LICENSE_HMAC_SECRET || 'inventory-tracker-secret-key-2026',
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--customer' || arg === '-c') {
      params.customer = args[++i];
    } else if (arg === '--seats' || arg === '-s') {
      params.seats = parseInt(args[++i], 10);
    } else if (arg === '--days' || arg === '-d') {
      params.days = parseInt(args[++i], 10);
    } else if (arg === '--secret') {
      params.secret = args[++i];
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
Usage: node generate-key.js [options]

Options:
  -c, --customer <name>   Customer / Organization name (default: "Enterprise Client")
  -s, --seats <number>    Number of concurrent authorized seats (default: 5)
  -d, --days <number>     License validity in days from today (default: 365)
      --secret <string>   HMAC secret key (default: from LICENSE_HMAC_SECRET env)
  -h, --help              Show this help message
      `);
      process.exit(0);
    }
  }

  return params;
}

function generateLicense(customer, seats, days, secret) {
  const now = new Date();
  const expires = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

  const payload = {
    customer,
    seats,
    issued: now.toISOString(),
    expires: expires.toISOString(),
  };

  const payloadJson = JSON.stringify(payload);
  const payloadB64 = Buffer.from(payloadJson, 'utf8').toString('base64url');

  const signatureHex = crypto
    .createHmac('sha256', secret)
    .update(payloadB64)
    .digest('hex');

  const licenseKey = `LIC-${payloadB64}.${signatureHex}`;

  return {
    payload,
    licenseKey,
  };
}

if (require.main === module) {
  const params = parseArgs();
  const result = generateLicense(params.customer, params.seats, params.days, params.secret);

  console.log('===============================================================');
  console.log('  INVENTORY TRACKER — OFFICIAL SIGNED LICENSE KEY GENERATOR   ');
  console.log('===============================================================');
  console.log(`Customer:       ${result.payload.customer}`);
  console.log(`Seats:          ${result.payload.seats} concurrent user(s)`);
  console.log(`Issued:         ${result.payload.issued}`);
  console.log(`Expires:        ${result.payload.expires} (${params.days} days)`);
  console.log('---------------------------------------------------------------');
  console.log('LICENSE KEY (Copy and paste into Admin > License Activation):');
  console.log('\n' + result.licenseKey + '\n');
  console.log('===============================================================');
}

module.exports = {
  generateLicense,
};

