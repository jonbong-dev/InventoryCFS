/**
 * Derived Stock Levels and Ledger Queries.
 *
 * CRITICAL ARCHITECTURAL RULE:
 * Stock levels are ALWAYS derived from the append-only stock_movements ledger.
 * We NEVER store a computed qty_on_hand column in items or a separate table,
 * which eliminates drift between movement history and current state.
 */

/**
 * Get current stock levels across all or filtered sites.
 * Derives current qty on hand from the sum of IN minus OUT movements in the ledger.
 */
async function getStockLevels(db, filters = {}) {
  const { site_id, item_id, search, low_stock_only } = filters;

  // 1. Fetch sites
  let sitesQuery = db('sites').select('id', 'name').orderBy('name', 'asc');
  if (site_id) {
    sitesQuery = sitesQuery.where('id', Number(site_id));
  }
  const sites = await sitesQuery;

  // 2. Fetch items
  let itemsQuery = db('items')
    .select('id', 'sku', 'description', 'unit', 'reorder_level')
    .orderBy('sku', 'asc');
  if (item_id) {
    itemsQuery = itemsQuery.where('id', Number(item_id));
  }
  if (search) {
    itemsQuery = itemsQuery.where(function () {
      this.where('sku', 'like', `%${search}%`).orWhere('description', 'like', `%${search}%`);
    });
  }
  const items = await itemsQuery;

  // 3. Fetch ledger sums grouped by (item_id, site_id)
  let ledgerQuery = db('stock_movements')
    .select('item_id', 'site_id')
    .select(
      db.raw(
        "SUM(CASE WHEN movement_type = 'IN' THEN qty WHEN movement_type = 'OUT' THEN -qty ELSE 0 END) as qty_on_hand"
      )
    )
    .groupBy('item_id', 'site_id');

  if (site_id) {
    ledgerQuery = ledgerQuery.where('site_id', Number(site_id));
  }
  if (item_id) {
    ledgerQuery = ledgerQuery.where('item_id', Number(item_id));
  }

  const ledgerRows = await ledgerQuery;

  // Create a lookup map: `${item_id}_${site_id}` -> qty_on_hand
  const stockMap = new Map();
  for (const row of ledgerRows) {
    const key = `${row.item_id}_${row.site_id}`;
    stockMap.set(key, Number(row.qty_on_hand) || 0);
  }

  // 4. Combine items x sites to derive current stock levels
  const results = [];
  for (const site of sites) {
    for (const item of items) {
      const key = `${item.id}_${site.id}`;
      const qty = stockMap.get(key) || 0;
      const reorder = Number(item.reorder_level) || 0;
      const isLowStock = qty <= reorder;

      // If search filter is active and matched site name
      if (search && !item.sku.toLowerCase().includes(search.toLowerCase()) &&
          !item.description.toLowerCase().includes(search.toLowerCase()) &&
          !site.name.toLowerCase().includes(search.toLowerCase())) {
        continue;
      }

      results.push({
        item_id: item.id,
        sku: item.sku,
        item_description: item.description,
        unit: item.unit,
        reorder_level: reorder,
        site_id: site.id,
        site_name: site.name,
        qty_on_hand: qty,
        is_low_stock: isLowStock,
        status: isLowStock ? 'LOW_STOCK' : 'ADEQUATE',
      });
    }
  }

  if (low_stock_only) {
    return results.filter((r) => r.is_low_stock);
  }

  return results;
}

/**
 * Get current stock quantity for a specific item at a specific site.
 */
async function getItemStockAtSite(db, itemId, siteId) {
  const res = await db('stock_movements')
    .where({ item_id: Number(itemId), site_id: Number(siteId) })
    .select(
      db.raw(
        "COALESCE(SUM(CASE WHEN movement_type = 'IN' THEN qty WHEN movement_type = 'OUT' THEN -qty ELSE 0 END), 0) as qty_on_hand"
      )
    )
    .first();

  return Number(res ? res.qty_on_hand : 0);
}

/**
 * Get raw stock movement history with related entity information.
 */
async function getMovementHistory(db, filters = {}) {
  const { site_id, item_id, movement_type, limit = 100, offset = 0 } = filters;

  let query = db('stock_movements as sm')
    .join('items as i', 'sm.item_id', 'i.id')
    .join('sites as s', 'sm.site_id', 's.id')
    .leftJoin('documents as d', 'sm.document_id', 'd.id')
    .leftJoin('purchase_orders as po', 'sm.po_id', 'po.id')
    .leftJoin('users as u', 'sm.created_by_user_id', 'u.id')
    .select(
      'sm.id',
      'sm.movement_type',
      'sm.qty',
      'sm.notes',
      'sm.created_at',
      'i.id as item_id',
      'i.sku',
      'i.description as item_description',
      'i.unit',
      's.id as site_id',
      's.name as site_name',
      'd.id as document_id',
      'd.doc_type',
      'd.doc_number',
      'd.customer_or_supplier',
      'po.id as po_id',
      'po.po_number',
      'u.username as created_by'
    );

  if (site_id) {
    query = query.where('sm.site_id', Number(site_id));
  }
  if (item_id) {
    query = query.where('sm.item_id', Number(item_id));
  }
  if (movement_type) {
    query = query.where('sm.movement_type', movement_type);
  }

  const rows = await query
    .orderBy('sm.created_at', 'desc')
    .orderBy('sm.id', 'desc')
    .limit(limit)
    .offset(offset);

  return rows.map((r) => ({
    ...r,
    qty: Number(r.qty),
  }));
}

module.exports = {
  getStockLevels,
  getItemStockAtSite,
  getMovementHistory,
};
