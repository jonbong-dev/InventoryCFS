const express = require('express');
const bcrypt = require('bcryptjs');
const { handleLoginSeatAllocation, removeSession, getActiveLicense } = require('../lib/license');

function createAuthRoutes(db) {
  const router = express.Router();

  // POST /api/auth/login
  router.post('/login', async (req, res) => {
    try {
      const { username, password } = req.body;
      if (!username || !password) {
        return res.status(400).json({ error: 'Username and password are required.' });
      }

      const user = await db('users as u')
        .leftJoin('sites as s', 'u.site_id', 's.id')
        .select(
          'u.id',
          'u.username',
          'u.password_hash',
          'u.role',
          'u.site_id',
          's.name as site_name'
        )
        .where('u.username', username.trim())
        .first();

      if (!user) {
        return res.status(401).json({ error: 'Invalid username or password.' });
      }

      const match = await bcrypt.compare(password, user.password_hash);
      if (!match) {
        return res.status(401).json({ error: 'Invalid username or password.' });
      }

      // Enforce concurrent seat limit
      await handleLoginSeatAllocation(db, req.sessionID, user);

      // Save user in session
      req.session.user = {
        id: user.id,
        username: user.username,
        role: user.role,
        site_id: user.site_id,
        site_name: user.site_name,
      };

      res.json({
        success: true,
        user: req.session.user,
      });
    } catch (err) {
      console.error('Login error:', err);
      res.status(500).json({ error: 'An unexpected server error occurred during login.' });
    }
  });

  // POST /api/auth/logout
  router.post('/logout', async (req, res) => {
    try {
      const sessionId = req.sessionID;
      await removeSession(db, sessionId);
      req.session.destroy((err) => {
        if (err) {
          return res.status(500).json({ error: 'Failed to terminate session.' });
        }
        res.clearCookie('connect.sid');
        res.json({ success: true, message: 'Logged out successfully.' });
      });
    } catch (err) {
      console.error('Logout error:', err);
      res.status(500).json({ error: 'Logout failed.' });
    }
  });

  // GET /api/auth/me
  router.get('/me', async (req, res) => {
    if (!req.session || !req.session.user) {
      return res.json({ authenticated: false });
    }

    try {
      const license = await getActiveLicense(db);
      res.json({
        authenticated: true,
        user: req.session.user,
        license: {
          customer_name: license.customer_name,
          seats: license.seats,
          active_seats_in_use: license.active_seats_in_use,
          is_trial: license.is_trial,
          is_expired: license.is_expired,
          days_remaining: license.days_remaining,
        },
      });
    } catch (err) {
      res.json({
        authenticated: true,
        user: req.session.user,
      });
    }
  });

  return router;
}

module.exports = {
  createAuthRoutes,
};
