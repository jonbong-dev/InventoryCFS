const express = require('express');
const { getActiveLicense, activateLicenseKey } = require('../lib/license');

function createLicenseRoutes(db, authMiddleware) {
  const router = express.Router();
  const { requireAuth, requireAdmin } = authMiddleware;

  // GET /api/license/status - View current license status & seats
  router.get('/status', requireAuth, async (req, res) => {
    try {
      const status = await getActiveLicense(db);
      res.json(status);
    } catch (err) {
      console.error('Error fetching license status:', err);
      res.status(500).json({ error: 'Failed to retrieve license status.' });
    }
  });

  // POST /api/license/activate - Activate a newly purchased/issued key (Admin only)
  router.post('/activate', requireAuth, requireAdmin, async (req, res) => {
    try {
      const { license_key } = req.body;
      if (!license_key || !license_key.trim()) {
        return res.status(400).json({ error: 'License key is required.' });
      }

      const result = await activateLicenseKey(db, license_key);
      if (!result.success) {
        return res.status(400).json({ error: result.error });
      }

      const updated = await getActiveLicense(db);
      res.json({
        success: true,
        message: `License successfully activated for ${result.license.customer} (${result.license.seats} concurrent seats).`,
        license: updated,
      });
    } catch (err) {
      console.error('Error activating license:', err);
      res.status(500).json({ error: 'Server error during license activation.' });
    }
  });

  return router;
}

module.exports = {
  createLicenseRoutes,
};
