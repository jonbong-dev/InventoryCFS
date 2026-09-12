/**
 * Idempotent Database Schema Migration and Seeder.
 * Safe to re-run at any time without touching or overwriting existing user data.
 */
const bcrypt = require('bcryptjs');
const { getDb, closeDb } = require('../lib/db');
const { ensureSchema } = require('../lib/schema');
const { getActiveLicense } = require('../lib/license');

async function migrateAndSeed() {
  const db = getDb();
  console.log('--- Ensuring database schema exists ---');
  await ensureSchema(db);

  // 1. Seed Company Settings
  console.log('--- Checking default settings ---');
  const defaultSettings = [
    { key: 'company_name', value: 'Apex Logistics & Supply Chain Ltd' },
    { key: 'company_address', value: '742 Industrial Boulevard, Dock 12, West Port' },
    { key: 'company_phone', value: '+1 (555) 019-2834' },
    { key: 'company_email', value: 'operations@apexlogistics.local' },
    {
      key: 'footer_note',
      value: 'Goods received in good order & condition. Inspect all packages immediately. All claims or discrepancies must be reported within 5 working days.',
    },
  ];

  for (const s of defaultSettings) {
    const existing = await db('settings').where('key', s.key).first();
    if (!existing) {
      await db('settings').insert({
        key: s.key,
        value: s.value,
        updated_at: new Date(),
      });
    }
  }

  // 2. Ensure Default Trial License
  console.log('--- Ensuring default trial license ---');
  await getActiveLicense(db);

  // 3. Seed Default Sites
  console.log('--- Checking default sites ---');
  const defaultSites = [
    'Main Warehouse (Dock A)',
    'North Distribution Hub',
  ];

  for (const name of defaultSites) {
    const exists = await db('sites').where('name', name).first();
    if (!exists) {
      await db('sites').insert({
        name,
        created_at: new Date(),
        updated_at: new Date(),
      });
    }
  }

  const site1 = await db('sites').where('name', defaultSites[0]).first();
  const site2 = await db('sites').where('name', defaultSites[1]).first();

  // 4. Seed Default Users
  console.log('--- Checking default users ---');
  const adminExists = await db('users').where('username', 'admin').first();
  if (!adminExists) {
    const adminHash = await bcrypt.hash('admin123', 10);
    await db('users').insert({
      username: 'admin',
      password_hash: adminHash,
      role: 'admin',
      site_id: null, // Admin has access to all sites
      created_at: new Date(),
      updated_at: new Date(),
    });
    console.log('Created default admin: admin / admin123');
  }

  const staffExists = await db('users').where('username', 'staff1').first();
  if (!staffExists && site1) {
    const staffHash = await bcrypt.hash('staff123', 10);
    await db('users').insert({
      username: 'staff1',
      password_hash: staffHash,
      role: 'staff',
      site_id: site1.id, // Strictly restricted to site 1
      created_at: new Date(),
      updated_at: new Date(),
    });
    console.log(`Created default staff user: staff1 / staff123 (Site: ${site1.name})`);
  }

  // 5. Seed Default Items
  console.log('--- Checking default items ---');
  const defaultItems = [
    { sku: 'GLV-HEAVY-01', description: 'Industrial Nitrile Grip Safety Gloves (XL)', unit: 'pairs', reorder_level: 50 },
    { sku: 'PLT-BEAM-270', description: 'Heavy-Duty Steel Racking Crossbeam 2.7m', unit: 'pcs', reorder_level: 15 },
    { sku: 'BOX-CRG-L40', description: 'Double-Wall Corrugated Packing Carton (40L)', unit: 'bundle', reorder_level: 30 },
    { sku: 'TPE-STRAP-50', description: 'Reinforced Filament Packaging Tape 50mm x 50m', unit: 'rolls', reorder_level: 40 },
    { sku: 'STC-FLM-ROLL', description: 'Cast Pallet Stretch Wrap 500mm x 400m', unit: 'rolls', reorder_level: 20 },
  ];

  for (const item of defaultItems) {
    const exists = await db('items').where('sku', item.sku).first();
    if (!exists) {
      await db('items').insert({
        ...item,
        created_at: new Date(),
        updated_at: new Date(),
      });
    }
  }

  // 6. Seed Purchase Order
  if (site1) {
    const poExists = await db('purchase_orders').where('po_number', 'PO-9001').first();
    if (!poExists) {
      await db('purchase_orders').insert({
        po_number: 'PO-9001',
        site_id: site1.id,
        status: 'OPEN',
        notes: 'Monthly bulk replenish from Premier Industrial Supply',
        created_at: new Date(),
        updated_at: new Date(),
      });
    }
  }

  // 7. Seed Initial Stock Movements (if ledger is empty)
  const movementCountRes = await db('stock_movements').count('id as count').first();
  const movementCount = Number(movementCountRes ? movementCountRes.count : 0);

  if (movementCount === 0 && site1 && site2) {
    console.log('--- Seeding initial stock ledger entries ---');
    const items = await db('items').select('*');
    const adminUser = await db('users').where('username', 'admin').first();
    const po = await db('purchase_orders').where('po_number', 'PO-9001').first();

    const initialLedger = [
      { sku: 'GLV-HEAVY-01', site: site1.id, type: 'IN', qty: 120, notes: 'Initial delivery from vendor' },
      { sku: 'PLT-BEAM-270', site: site1.id, type: 'IN', qty: 25, notes: 'Warehouse racking replenishment' },
      { sku: 'BOX-CRG-L40', site: site1.id, type: 'IN', qty: 100, notes: 'Bulk carton shipment' },
      { sku: 'TPE-STRAP-50', site: site1.id, type: 'IN', qty: 60, notes: 'Tape inventory setup' },
      { sku: 'STC-FLM-ROLL', site: site1.id, type: 'IN', qty: 45, notes: 'Stretch wrap baseline' },
      // Site 2 initial stock
      { sku: 'GLV-HEAVY-01', site: site2.id, type: 'IN', qty: 40, notes: 'Branch distribution transfer' },
      { sku: 'BOX-CRG-L40', site: site2.id, type: 'IN', qty: 20, notes: 'Branch packaging baseline' },
    ];

    for (const entry of initialLedger) {
      const item = items.find((i) => i.sku === entry.sku);
      if (item) {
        await db('stock_movements').insert({
          item_id: item.id,
          site_id: entry.site,
          movement_type: entry.type,
          qty: entry.qty,
          po_id: po ? po.id : null,
          created_by_user_id: adminUser ? adminUser.id : null,
          notes: entry.notes,
          created_at: new Date(),
        });
      }
    }
  }

  console.log('--- Migration & Seed completed successfully ---');
}

if (require.main === module) {
  migrateAndSeed()
    .then(() => closeDb())
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Migration failed:', err);
      process.exit(1);
    });
}

module.exports = {
  migrateAndSeed,
};
