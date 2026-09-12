/**
 * Production Server Entry Point.
 * Binds Express application to host 0.0.0.0 and port 3000.
 */
const { createApp } = require('./app');
const { migrateAndSeed } = require('./scripts/migrate-and-seed');

const PORT = 3000;
const HOST = '0.0.0.0';

async function startServer() {
  try {
    console.log('Initializing database schema and seed state...');
    await migrateAndSeed();

    const { app } = createApp();

    const server = app.listen(PORT, HOST, () => {
      console.log(`=======================================================`);
      console.log(`  Inventory Tracker Server is running on http://${HOST}:${PORT}`);
      console.log(`  Database client: ${process.env.DB_CLIENT || 'disposable-pgmem'}`);
      console.log(`=======================================================`);
    });

    const shutdown = () => {
      console.log('Shutting down server gracefully...');
      server.close(() => {
        console.log('Server closed.');
        process.exit(0);
      });
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } catch (err) {
    console.error('Fatal startup error:', err);
    process.exit(1);
  }
}

startServer();
