/**
 * Database client abstraction using Knex query builder.
 *
 * Supports:
 * - PostgreSQL ('postgres' or 'pg') using 'pg' client
 * - Microsoft SQL Server ('mssql' or 'sqlserver') using 'tedious' client
 * - Disposable pure-JS engine (default or 'memory'/'test') using 'pg-mem'
 *
 * Switches seamlessly via DB_CLIENT environment variable.
 */
const knex = require('knex');
const path = require('path');
const fs = require('fs');

let knexInstance = null;
let memDbInstance = null;

function getKnexConfig() {
  const dbClient = (process.env.DB_CLIENT || '').toLowerCase();

  if (dbClient === 'postgres' || dbClient === 'pg' || dbClient === 'postgresql') {
    return {
      type: 'knex',
      config: {
        client: 'pg',
        connection: process.env.DATABASE_URL || {
          host: process.env.DB_HOST || '127.0.0.1',
          port: Number(process.env.DB_PORT || 5432),
          user: process.env.DB_USER || 'postgres',
          password: process.env.DB_PASSWORD || '',
          database: process.env.DB_NAME || 'inventory_db',
          ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
        },
        pool: { min: 2, max: 10 },
      },
    };
  }

  if (dbClient === 'mssql' || dbClient === 'sqlserver') {
    return {
      type: 'knex',
      config: {
        client: 'mssql',
        connection: {
          server: process.env.DB_HOST || '127.0.0.1',
          port: Number(process.env.DB_PORT || 1433),
          user: process.env.DB_USER || 'sa',
          password: process.env.DB_PASSWORD || '',
          database: process.env.DB_NAME || 'inventory_db',
          options: {
            encrypt: process.env.DB_ENCRYPT !== 'false',
            trustServerCertificate: process.env.DB_TRUST_CERT !== 'false',
          },
        },
        pool: { min: 2, max: 10 },
      },
    };
  }

  // Default: Disposable pure-JS PostgreSQL engine via pg-mem
  // Zero native dependencies, runs anywhere (container, local machine, Windows without glibc issues)
  return {
    type: 'pg-mem',
  };
}

function getDb() {
  if (knexInstance) {
    return knexInstance;
  }

  const spec = getKnexConfig();
  if (spec.type === 'knex') {
    knexInstance = knex(spec.config);
  } else {
    const { newDb } = require('pg-mem');
    memDbInstance = newDb();
    // Register common postgres helper functions if needed
    memDbInstance.public.registerFunction({
      name: 'version',
      implementation: () => 'PostgreSQL 14.1 (pg-mem pure-JS)',
    });
    knexInstance = memDbInstance.adapters.createKnex();
  }

  return knexInstance;
}

async function closeDb() {
  if (knexInstance) {
    try {
      await knexInstance.destroy();
    } catch (e) {
      // ignore
    }
    knexInstance = null;
    memDbInstance = null;
  }
}

module.exports = {
  getDb,
  getKnexConfig,
  closeDb,
};
