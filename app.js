/**
 * Main Express Application Setup.
 * Configures middleware, session store, API routes, and static asset serving.
 */
const express = require('express');
const session = require('express-session');
const path = require('path');
const { getDb } = require('./lib/db');
const { createAuthMiddleware } = require('./lib/auth-middleware');

// Routes
const { createAuthRoutes } = require('./routes/auth');
const { createStockRoutes } = require('./routes/stock');
const { createDocumentRoutes } = require('./routes/documents');
const { createAdminRoutes } = require('./routes/admin');
const { createLicenseRoutes } = require('./routes/license');
const { createReportRoutes } = require('./routes/reports');

function createApp() {
  const app = express();
  const db = getDb();
  const authMiddleware = createAuthMiddleware(db);

  // Body parsing middleware
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Session configuration
  app.use(
    session({
      secret: process.env.SESSION_SECRET || 'inventory-tracker-secret-session-key',
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        secure: false, // Set to true behind HTTPS proxy in production if desired
        maxAge: 24 * 60 * 60 * 1000, // 24 hours
        sameSite: 'lax',
      },
    })
  );

  // Serve static assets from public/
  app.use(express.static(path.join(__dirname, 'public')));

  // Mount API routes
  app.use('/api/auth', createAuthRoutes(db));
  app.use('/api/stock', createStockRoutes(db, authMiddleware));
  app.use('/api/documents', createDocumentRoutes(db, authMiddleware));
  app.use('/api/admin', createAdminRoutes(db, authMiddleware));
  app.use('/api/license', createLicenseRoutes(db, authMiddleware));
  app.use('/api/reports', createReportRoutes(db, authMiddleware));

  // Health check endpoint
  app.get('/api/health', (req, res) => {
    res.json({
      status: 'ok',
      dbClient: process.env.DB_CLIENT || 'sqlite3-pgmem',
      timestamp: new Date().toISOString(),
    });
  });

  // Serve index.html for root and SPA routes
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });

  return { app, db };
}

module.exports = {
  createApp,
};
