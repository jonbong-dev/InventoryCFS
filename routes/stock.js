const express = require('express');
const { getStockLevels, getMovementHistory, getItemStockAtSite } = require('../lib/stock');

function createStockRoutes(db, authMiddleware) {
  const router = express.Router();
  const { requireAuth, requireSiteAccess } = authMiddleware;

  // GET /api/stock/levels - Derived stock levels per item per site
  router.get('/levels', requireAuth, async (req, res) => {
    try {
      const { site_id, item_id, search, low_stock_only } = req.query;
      const levels = await getStockLevels(db, {
        site_id,
        item_id,
        search,
        low_stock_only: low_stock_only === 'true',
      });
      res.json(levels);
    } catch (err) {
      console.error('Error fetching stock levels:', err);
      res.status(500).json({ error: 'Failed to retrieve stock levels.' });
    }
  });

  // GET /api/stock/movements - Raw append-only ledger history log
  router.get('/movements', requireAuth, async (req, res) => {
    try {
      const { site_id, item_id, movement_type, limit, offset } = req.query;
      const history = await getMovementHistory(db, {
        site_id,
        item_id,
        movement_type,
        limit: limit ? parseInt(limit, 10) : 100,
        offset: offset ? parseInt(offset, 10) : 0,
      });
      res.json(history);
    } catch (err) {
      console.error('Error fetching stock movements:', err);
      res.status(500).json({ error: 'Failed to retrieve stock movement ledger.' });
    }
  });

  // POST /api/stock/movements - Record a manual stock movement (IN or OUT)
  router.post('/movements', requireAuth, requireSiteAccess('site_id'), async (req, res) => {
    try {
      const { item_id, site_id, movement_type, qty, po_id, notes } = req.body;

      if (!item_id || !site_id || !movement_type || !qty) {
        return res.status(400).json({ error: 'item_id, site_id, movement_type, and qty are required.' });
      }

      if (movement_type !== 'IN' && movement_type !== 'OUT') {
        return res.status(400).json({ error: 'movement_type must be IN or OUT.' });
      }

      const numQty = parseFloat(qty);
      if (isNaN(numQty) || numQty <= 0) {
        return res.status(400).json({ error: 'Quantity must be a positive number.' });
      }

      // Verify item and site exist
      const item = await db('items').where('id', Number(item_id)).first();
      if (!item) {
        return res.status(404).json({ error: 'Specified item does not exist.' });
      }

      const site = await db('sites').where('id', Number(site_id)).first();
      if (!site) {
        return res.status(404).json({ error: 'Specified site does not exist.' });
      }

      // Optional: Check current stock if OUT
      if (movement_type === 'OUT') {
        const currentQty = await getItemStockAtSite(db, item_id, site_id);
        if (currentQty < numQty) {
          // Warning or allow negative if company allows backorder
        }
      }

      const [movementId] = await db('stock_movements')
        .insert({
          item_id: Number(item_id),
          site_id: Number(site_id),
          movement_type,
          qty: numQty,
          po_id: po_id ? Number(po_id) : null,
          created_by_user_id: req.session.user.id,
          notes: notes ? notes.trim() : null,
          created_at: new Date(),
        })
        .returning('id');

      const id = typeof movementId === 'object' ? movementId.id : movementId;
      const newBalance = await getItemStockAtSite(db, item_id, site_id);

      res.status(201).json({
        success: true,
        movement_id: id,
        item_id: Number(item_id),
        site_id: Number(site_id),
        movement_type,
        qty: numQty,
        new_balance: newBalance,
      });
    } catch (err) {
      console.error('Error recording stock movement:', err);
      res.status(500).json({ error: 'Failed to record stock movement into ledger.' });
    }
  });

  return router;
}

module.exports = {
  createStockRoutes,
};
