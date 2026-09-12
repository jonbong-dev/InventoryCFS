/**
 * Authentication and Authorization Middleware.
 * Enforces session validity, seat eviction, role restrictions, and site boundaries.
 */
const { isSessionActive, touchSession } = require('./license');

function createAuthMiddleware(db) {
  /**
   * Requires a valid logged-in session.
   * Checks database active_sessions table to verify if the session was evicted by seat limits.
   */
  async function requireAuth(req, res, next) {
    const isApi = (req.originalUrl || req.url || '').startsWith('/api/');

    if (!req.session || !req.session.user) {
      if (req.accepts('html') && !isApi) {
        return res.redirect('/login');
      }
      return res.status(401).json({ error: 'Authentication required. Please log in.' });
    }

    // Verify session has not been evicted due to concurrent seat limit
    const active = await isSessionActive(db, req.sessionID);
    if (!active) {
      req.session.destroy(() => {});
      if (req.accepts('html') && !isApi) {
        return res.redirect('/login?evicted=1');
      }
      return res.status(401).json({
        error: 'Your session was evicted because the maximum concurrent seat limit was exceeded by another login.',
        evicted: true,
      });
    }

    // Update last_seen
    await touchSession(db, req.sessionID);
    next();
  }

  /**
   * Requires administrator role.
   */
  function requireAdmin(req, res, next) {
    if (!req.session || !req.session.user) {
      return res.status(401).json({ error: 'Authentication required.' });
    }
    if (req.session.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied. Administrator privileges required.' });
    }
    next();
  }

  /**
   * Enforces site write restrictions:
   * Admin can write to any site.
   * Staff can ONLY write to their explicitly assigned site_id.
   */
  function requireSiteAccess(targetSiteIdParam) {
    return (req, res, next) => {
      const user = req.session.user;
      if (!user) {
        return res.status(401).json({ error: 'Authentication required.' });
      }

      if (user.role === 'admin') {
        return next(); // Admin has unrestricted site access
      }

      const targetSiteId = Number(
        req.body[targetSiteIdParam] || req.params[targetSiteIdParam] || req.query[targetSiteIdParam]
      );

      if (!targetSiteId || Number(user.site_id) !== targetSiteId) {
        return res.status(403).json({
          error: `Permission denied. As a staff member, your write actions are strictly restricted to your assigned site (Site #${user.site_id}).`,
        });
      }

      next();
    };
  }

  return {
    requireAuth,
    requireAdmin,
    requireSiteAccess,
  };
}

module.exports = {
  createAuthMiddleware,
};
