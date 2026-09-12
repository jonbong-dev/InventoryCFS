/**
 * Idempotent schema initialization for Inventory Tracker.
 * Safely creates tables and indexes across PostgreSQL, SQL Server, and SQLite.
 */

async function ensureSchema(db) {
  // 1. Sites table
  const hasSites = await db.schema.hasTable('sites');
  if (!hasSites) {
    await db.schema.createTable('sites', (table) => {
      table.increments('id').primary();
      table.string('name', 150).notNullable().unique();
      table.timestamp('created_at').defaultTo(db.fn.now());
      table.timestamp('updated_at').defaultTo(db.fn.now());
    });
  }

  // 2. Users table
  const hasUsers = await db.schema.hasTable('users');
  if (!hasUsers) {
    await db.schema.createTable('users', (table) => {
      table.increments('id').primary();
      table.string('username', 100).notNullable().unique();
      table.string('password_hash', 255).notNullable();
      table.string('role', 20).notNullable().defaultTo('staff'); // 'admin' | 'staff'
      table.integer('site_id').unsigned().references('id').inTable('sites').onDelete('SET NULL');
      table.timestamp('created_at').defaultTo(db.fn.now());
      table.timestamp('updated_at').defaultTo(db.fn.now());
    });
  }

  // 3. Items table
  const hasItems = await db.schema.hasTable('items');
  if (!hasItems) {
    await db.schema.createTable('items', (table) => {
      table.increments('id').primary();
      table.string('sku', 100).notNullable().unique();
      table.string('description', 255).notNullable();
      table.string('unit', 50).notNullable().defaultTo('pcs');
      table.integer('reorder_level').notNullable().defaultTo(0);
      table.timestamp('created_at').defaultTo(db.fn.now());
      table.timestamp('updated_at').defaultTo(db.fn.now());
    });
  }

  // 4. Purchase Orders table
  const hasPO = await db.schema.hasTable('purchase_orders');
  if (!hasPO) {
    await db.schema.createTable('purchase_orders', (table) => {
      table.increments('id').primary();
      table.string('po_number', 100).notNullable().unique();
      table.integer('site_id').unsigned().notNullable().references('id').inTable('sites');
      table.string('status', 50).notNullable().defaultTo('OPEN'); // 'OPEN' | 'RECEIVED' | 'CLOSED'
      table.text('notes');
      table.timestamp('created_at').defaultTo(db.fn.now());
      table.timestamp('updated_at').defaultTo(db.fn.now());
    });
  }

  // 5. Documents table (Collection Note / Delivery Note)
  const hasDocs = await db.schema.hasTable('documents');
  if (!hasDocs) {
    await db.schema.createTable('documents', (table) => {
      table.increments('id').primary();
      table.string('doc_type', 50).notNullable(); // 'collection_note' | 'delivery_note'
      table.string('doc_number', 100).notNullable().unique();
      table.integer('site_id').unsigned().notNullable().references('id').inTable('sites');
      table.string('customer_or_supplier', 255).notNullable();
      table.string('po_number', 100);
      table.text('notes');
      table.integer('created_by_user_id').unsigned().references('id').inTable('users').onDelete('SET NULL');
      table.timestamp('created_at').defaultTo(db.fn.now());
    });
  }

  // 6. Stock Movements (Append-only ledger — never edited or deleted)
  const hasMovements = await db.schema.hasTable('stock_movements');
  if (!hasMovements) {
    await db.schema.createTable('stock_movements', (table) => {
      table.increments('id').primary();
      table.integer('item_id').unsigned().notNullable().references('id').inTable('items');
      table.integer('site_id').unsigned().notNullable().references('id').inTable('sites');
      table.string('movement_type', 10).notNullable(); // 'IN' | 'OUT'
      table.float('qty').notNullable();
      table.integer('po_id').unsigned().references('id').inTable('purchase_orders').onDelete('SET NULL');
      table.integer('document_id').unsigned().references('id').inTable('documents').onDelete('SET NULL');
      table.integer('created_by_user_id').unsigned().references('id').inTable('users').onDelete('SET NULL');
      table.text('notes');
      table.timestamp('created_at').defaultTo(db.fn.now());

      table.index(['site_id', 'item_id']);
      table.index(['document_id']);
      table.index(['created_at']);
    });
  }

  // 7. Company Settings table
  const hasSettings = await db.schema.hasTable('settings');
  if (!hasSettings) {
    await db.schema.createTable('settings', (table) => {
      table.string('key', 100).primary();
      table.text('value').notNullable();
      table.timestamp('updated_at').defaultTo(db.fn.now());
    });
  }

  // 8. License State table
  const hasLicense = await db.schema.hasTable('license_state');
  if (!hasLicense) {
    await db.schema.createTable('license_state', (table) => {
      table.increments('id').primary();
      table.text('license_key').notNullable();
      table.string('customer_name', 255).notNullable();
      table.integer('seats').notNullable().defaultTo(1);
      table.timestamp('expires_at').notNullable();
      table.timestamp('activated_at').defaultTo(db.fn.now());
      table.boolean('is_trial').defaultTo(false);
    });
  }

  // 9. Active Sessions table (tracks concurrent seats and enables eviction)
  const hasSessions = await db.schema.hasTable('active_sessions');
  if (!hasSessions) {
    await db.schema.createTable('active_sessions', (table) => {
      table.string('session_id', 255).primary();
      table.integer('user_id').unsigned().notNullable().references('id').inTable('users').onDelete('CASCADE');
      table.string('username', 100).notNullable();
      table.timestamp('created_at').defaultTo(db.fn.now());
      table.timestamp('last_seen').defaultTo(db.fn.now());
    });
  }
}

module.exports = {
  ensureSchema,
};
