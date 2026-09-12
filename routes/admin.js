const express = require('express');
const bcrypt = require('bcryptjs');
const { isUniqueViolation } = require('../lib/db-errors');

function createAdminRoutes(db, authMiddleware) {
  const router = express.Router();
  const { requireAuth, requireAdmin } = authMiddleware;

  // --- SITES ---

  // GET /api/sites (accessible by all authenticated users for dropdowns)
  router.get('/sites', requireAuth, async (req, res) => {
    try {
      const sites = await db('sites').select('*').orderBy('name', 'asc');
      res.json(sites);
    } catch (err) {
      res.status(500).json({ error: 'Failed to retrieve sites.' });
    }
  });

  // POST /api/sites (admin only)
  router.post('/sites', requireAuth, requireAdmin, async (req, res) => {
    try {
      const { name } = req.body;
      if (!name || !name.trim()) {
        return res.status(400).json({ error: 'Site name is required.' });
      }

      const [siteId] = await db('sites')
        .insert({
          name: name.trim(),
          created_at: new Date(),
          updated_at: new Date(),
        })
        .returning('id');

      const id = typeof siteId === 'object' ? siteId.id : siteId;
      const newSite = await db('sites').where('id', id).first();
      res.status(201).json(newSite);
    } catch (err) {
      if (isUniqueViolation(err)) {
        return res.status(409).json({ error: 'A site with this name already exists.' });
      }
      res.status(500).json({ error: 'Failed to create site.' });
    }
  });

  // PUT /api/sites/:id (rename site - admin only)
  router.put('/sites/:id', requireAuth, requireAdmin, async (req, res) => {
    try {
      const { name } = req.body;
      const siteId = Number(req.params.id);

      if (!name || !name.trim()) {
        return res.status(400).json({ error: 'Site name cannot be empty.' });
      }

      await db('sites')
        .where('id', siteId)
        .update({
          name: name.trim(),
          updated_at: new Date(),
        });

      const updated = await db('sites').where('id', siteId).first();
      if (!updated) {
        return res.status(404).json({ error: 'Site not found.' });
      }
      res.json(updated);
    } catch (err) {
      if (isUniqueViolation(err)) {
        return res.status(409).json({ error: 'Another site with this name already exists.' });
      }
      res.status(500).json({ error: 'Failed to update site name.' });
    }
  });

  // --- ITEMS ---

  // GET /api/items
  router.get('/items', requireAuth, async (req, res) => {
    try {
      const { search } = req.query;
      let query = db('items').select('*').orderBy('sku', 'asc');
      if (search) {
        query = query.where(function () {
          this.where('sku', 'like', `%${search}%`).orWhere('description', 'like', `%${search}%`);
        });
      }
      const items = await query;
      res.json(items);
    } catch (err) {
      res.status(500).json({ error: 'Failed to retrieve items.' });
    }
  });

  // POST /api/items (admin only)
  router.post('/items', requireAuth, requireAdmin, async (req, res) => {
    try {
      const { sku, description, unit, reorder_level } = req.body;
      if (!sku || !sku.trim() || !description || !description.trim()) {
        return res.status(400).json({ error: 'SKU and description are required.' });
      }

      const [itemId] = await db('items')
        .insert({
          sku: sku.trim().toUpperCase(),
          description: description.trim(),
          unit: (unit || 'pcs').trim(),
          reorder_level: parseInt(reorder_level, 10) || 0,
          created_at: new Date(),
          updated_at: new Date(),
        })
        .returning('id');

      const id = typeof itemId === 'object' ? itemId.id : itemId;
      const created = await db('items').where('id', id).first();
      res.status(201).json(created);
    } catch (err) {
      if (isUniqueViolation(err)) {
        return res.status(409).json({ error: 'An item with this SKU already exists.' });
      }
      res.status(500).json({ error: 'Failed to create item.' });
    }
  });

  // PUT /api/items/:id (admin only)
  router.put('/items/:id', requireAuth, requireAdmin, async (req, res) => {
    try {
      const itemId = Number(req.params.id);
      const { sku, description, unit, reorder_level } = req.body;

      if (!sku || !sku.trim() || !description || !description.trim()) {
        return res.status(400).json({ error: 'SKU and description are required.' });
      }

      await db('items')
        .where('id', itemId)
        .update({
          sku: sku.trim().toUpperCase(),
          description: description.trim(),
          unit: (unit || 'pcs').trim(),
          reorder_level: parseInt(reorder_level, 10) || 0,
          updated_at: new Date(),
        });

      const updated = await db('items').where('id', itemId).first();
      if (!updated) {
        return res.status(404).json({ error: 'Item not found.' });
      }
      res.json(updated);
    } catch (err) {
      if (isUniqueViolation(err)) {
        return res.status(409).json({ error: 'Another item with this SKU already exists.' });
      }
      res.status(500).json({ error: 'Failed to update item.' });
    }
  });

  // --- PURCHASE ORDERS ---

  // GET /api/purchase-orders
  router.get('/purchase-orders', requireAuth, async (req, res) => {
    try {
      const { site_id } = req.query;
      let query = db('purchase_orders as po')
        .join('sites as s', 'po.site_id', 's.id')
        .select(
          'po.id',
          'po.po_number',
          'po.site_id',
          's.name as site_name',
          'po.status',
          'po.notes',
          'po.created_at',
          'po.updated_at'
        )
        .orderBy('po.created_at', 'desc');

      if (site_id) {
        query = query.where('po.site_id', Number(site_id));
      }

      const orders = await query;
      res.json(orders);
    } catch (err) {
      res.status(500).json({ error: 'Failed to retrieve purchase orders.' });
    }
  });

  // POST /api/purchase-orders (admin and staff for their site)
  router.post('/purchase-orders', requireAuth, async (req, res) => {
    try {
      const { po_number, site_id, notes, status } = req.body;

      if (!po_number || !po_number.trim() || !site_id) {
        return res.status(400).json({ error: 'PO number and destination site are required.' });
      }

      // Enforce staff site constraint
      if (req.session.user.role === 'staff' && Number(req.session.user.site_id) !== Number(site_id)) {
        return res.status(403).json({ error: 'Staff can only create Purchase Orders for their assigned site.' });
      }

      const [poId] = await db('purchase_orders')
        .insert({
          po_number: po_number.trim().toUpperCase(),
          site_id: Number(site_id),
          status: status || 'OPEN',
          notes: notes ? notes.trim() : null,
          created_at: new Date(),
          updated_at: new Date(),
        })
        .returning('id');

      const id = typeof poId === 'object' ? poId.id : poId;
      const created = await db('purchase_orders').where('id', id).first();
      res.status(201).json(created);
    } catch (err) {
      if (isUniqueViolation(err)) {
        return res.status(409).json({ error: 'A purchase order with this PO Number already exists.' });
      }
      res.status(500).json({ error: 'Failed to create purchase order.' });
    }
  });

  // --- USERS MANAGEMENT (Admin only) ---

  // GET /api/users
  router.get('/users', requireAuth, requireAdmin, async (req, res) => {
    try {
      const users = await db('users as u')
        .leftJoin('sites as s', 'u.site_id', 's.id')
        .select(
          'u.id',
          'u.username',
          'u.role',
          'u.site_id',
          's.name as site_name',
          'u.created_at',
          'u.updated_at'
        )
        .orderBy('u.username', 'asc');
      res.json(users);
    } catch (err) {
      res.status(500).json({ error: 'Failed to retrieve users.' });
    }
  });

  // POST /api/users
  router.post('/users', requireAuth, requireAdmin, async (req, res) => {
    try {
      const { username, password, role, site_id } = req.body;

      if (!username || !username.trim() || !password) {
        return res.status(400).json({ error: 'Username and password are required.' });
      }
      if (role !== 'admin' && role !== 'staff') {
        return res.status(400).json({ error: 'Role must be admin or staff.' });
      }
      if (role === 'staff' && !site_id) {
        return res.status(400).json({ error: 'Staff users must be assigned to a specific site.' });
      }

      const hash = await bcrypt.hash(password, 10);
      const [userId] = await db('users')
        .insert({
          username: username.trim(),
          password_hash: hash,
          role,
          site_id: role === 'staff' ? Number(site_id) : null,
          created_at: new Date(),
          updated_at: new Date(),
        })
        .returning('id');

      const id = typeof userId === 'object' ? userId.id : userId;
      const created = await db('users')
        .select('id', 'username', 'role', 'site_id', 'created_at')
        .where('id', id)
        .first();

      res.status(201).json(created);
    } catch (err) {
      if (isUniqueViolation(err)) {
        return res.status(409).json({ error: 'A user with this username already exists.' });
      }
      res.status(500).json({ error: 'Failed to create user.' });
    }
  });

  // PUT /api/users/:id
  router.put('/users/:id', requireAuth, requireAdmin, async (req, res) => {
    try {
      const userId = Number(req.params.id);
      const { username, password, role, site_id } = req.body;

      if (!username || !username.trim()) {
        return res.status(400).json({ error: 'Username cannot be empty.' });
      }

      const updates = {
        username: username.trim(),
        role: role === 'admin' ? 'admin' : 'staff',
        site_id: role === 'staff' ? Number(site_id) : null,
        updated_at: new Date(),
      };

      if (password && password.trim()) {
        updates.password_hash = await bcrypt.hash(password.trim(), 10);
      }

      await db('users').where('id', userId).update(updates);

      const updated = await db('users')
        .select('id', 'username', 'role', 'site_id', 'updated_at')
        .where('id', userId)
        .first();

      if (!updated) {
        return res.status(404).json({ error: 'User not found.' });
      }

      res.json(updated);
    } catch (err) {
      if (isUniqueViolation(err)) {
        return res.status(409).json({ error: 'Another user with this username already exists.' });
      }
      res.status(500).json({ error: 'Failed to update user.' });
    }
  });

  // DELETE /api/users/:id
  router.delete('/users/:id', requireAuth, requireAdmin, async (req, res) => {
    try {
      const userId = Number(req.params.id);

      // Prevent deleting self
      if (req.session.user.id === userId) {
        return res.status(400).json({ error: 'You cannot delete your own active account.' });
      }

      // Check if user has associated records
      await db('active_sessions').where('user_id', userId).del();
      await db('users').where('id', userId).del();

      res.json({ success: true, message: 'User deleted.' });
    } catch (err) {
      res.status(500).json({ error: 'Failed to delete user.' });
    }
  });

  // --- COMPANY SETTINGS ---

  // GET /api/settings
  router.get('/settings', requireAuth, async (req, res) => {
    try {
      const settings = await db('settings').select('*');
      const map = {};
      settings.forEach((s) => {
        map[s.key] = s.value;
      });
      res.json(map);
    } catch (err) {
      res.status(500).json({ error: 'Failed to retrieve company settings.' });
    }
  });

  // PUT /api/settings (admin only)
  router.put('/settings', requireAuth, requireAdmin, async (req, res) => {
    try {
      const { company_name, company_address, company_phone, company_email, footer_note } = req.body;

      const pairs = [
        { key: 'company_name', value: company_name || '' },
        { key: 'company_address', value: company_address || '' },
        { key: 'company_phone', value: company_phone || '' },
        { key: 'company_email', value: company_email || '' },
        { key: 'footer_note', value: footer_note || '' },
      ];

      for (const p of pairs) {
        const exists = await db('settings').where('key', p.key).first();
        if (exists) {
          await db('settings').where('key', p.key).update({ value: p.value, updated_at: new Date() });
        } else {
          await db('settings').insert({ key: p.key, value: p.value, updated_at: new Date() });
        }
      }

      res.json({ success: true, message: 'Company settings updated successfully.' });
    } catch (err) {
      res.status(500).json({ error: 'Failed to update company settings.' });
    }
  });

  return router;
}

module.exports = {
  createAdminRoutes,
};
