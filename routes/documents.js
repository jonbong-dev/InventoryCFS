const express = require('express');
const crypto = require('crypto');
const { generateDocumentPdf } = require('../lib/pdf');

function createDocumentRoutes(db, authMiddleware) {
  const router = express.Router();
  const { requireAuth, requireSiteAccess } = authMiddleware;

  // GET /api/documents - List all notes with filtering
  router.get('/', requireAuth, async (req, res) => {
    try {
      const { site_id, doc_type, search, limit = 50, offset = 0 } = req.query;

      let query = db('documents as d')
        .join('sites as s', 'd.site_id', 's.id')
        .leftJoin('users as u', 'd.created_by_user_id', 'u.id')
        .select(
          'd.id',
          'd.doc_type',
          'd.doc_number',
          'd.site_id',
          's.name as site_name',
          'd.customer_or_supplier',
          'd.po_number',
          'd.notes',
          'd.created_at',
          'u.username as created_by'
        );

      if (site_id) {
        query = query.where('d.site_id', Number(site_id));
      }
      if (doc_type) {
        query = query.where('d.doc_type', doc_type);
      }
      if (search) {
        query = query.where(function () {
          this.where('d.doc_number', 'like', `%${search}%`)
            .orWhere('d.customer_or_supplier', 'like', `%${search}%`)
            .orWhere('d.po_number', 'like', `%${search}%`);
        });
      }

      const documents = await query
        .orderBy('d.created_at', 'desc')
        .orderBy('d.id', 'desc')
        .limit(parseInt(limit, 10))
        .offset(parseInt(offset, 10));

      // Fetch line item counts for these documents
      if (documents.length > 0) {
        const docIds = documents.map((d) => d.id);
        const counts = await db('stock_movements')
          .whereIn('document_id', docIds)
          .select('document_id')
          .count('id as line_count')
          .sum('qty as total_qty')
          .groupBy('document_id');

        const countMap = new Map();
        counts.forEach((c) => {
          countMap.set(c.document_id, {
            line_count: Number(c.line_count),
            total_qty: Number(c.total_qty),
          });
        });

        documents.forEach((d) => {
          const stats = countMap.get(d.id) || { line_count: 0, total_qty: 0 };
          d.line_count = stats.line_count;
          d.total_qty = stats.total_qty;
        });
      }

      res.json(documents);
    } catch (err) {
      console.error('Error fetching documents:', err);
      res.status(500).json({ error: 'Failed to retrieve documents.' });
    }
  });

  // GET /api/documents/:id - Single document with line items
  router.get('/:id', requireAuth, async (req, res) => {
    try {
      const docId = Number(req.params.id);
      const document = await db('documents as d')
        .join('sites as s', 'd.site_id', 's.id')
        .leftJoin('users as u', 'd.created_by_user_id', 'u.id')
        .select(
          'd.id',
          'd.doc_type',
          'd.doc_number',
          'd.site_id',
          's.name as site_name',
          'd.customer_or_supplier',
          'd.po_number',
          'd.notes',
          'd.created_at',
          'u.username as created_by'
        )
        .where('d.id', docId)
        .first();

      if (!document) {
        return res.status(404).json({ error: 'Document not found.' });
      }

      const lines = await db('stock_movements as sm')
        .join('items as i', 'sm.item_id', 'i.id')
        .select(
          'sm.id as movement_id',
          'sm.item_id',
          'sm.movement_type',
          'sm.qty',
          'sm.notes',
          'i.sku',
          'i.description as item_description',
          'i.unit'
        )
        .where('sm.document_id', docId)
        .orderBy('sm.id', 'asc');

      res.json({
        document,
        lines: lines.map((l) => ({ ...l, qty: Number(l.qty) })),
      });
    } catch (err) {
      console.error('Error fetching document details:', err);
      res.status(500).json({ error: 'Failed to retrieve document details.' });
    }
  });

  // POST /api/documents - Create Collection/Delivery Note in a SINGLE atomic transaction
  router.post('/', requireAuth, requireSiteAccess('site_id'), async (req, res) => {
    try {
      const { doc_type, site_id, customer_or_supplier, po_number, notes, items } = req.body;

      if (!doc_type || (doc_type !== 'collection_note' && doc_type !== 'delivery_note')) {
        return res.status(400).json({ error: 'doc_type must be collection_note or delivery_note.' });
      }
      if (!site_id) {
        return res.status(400).json({ error: 'site_id is required.' });
      }
      if (!customer_or_supplier || !customer_or_supplier.trim()) {
        return res.status(400).json({ error: 'customer_or_supplier name is required.' });
      }
      if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'At least one line item is required.' });
      }

      // Validate all items
      for (const item of items) {
        if (!item.item_id || !item.qty || parseFloat(item.qty) <= 0) {
          return res.status(400).json({ error: 'Each line item must have a valid item_id and positive qty.' });
        }
      }

      // Execute in a single atomic database transaction
      const result = await db.transaction(async (trx) => {
        // SQL Server and Postgres compatibility:
        // Use temporary unique placeholder to avoid unique constraint collisions before ID is known
        const tempPlaceholder = `TEMP-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;

        const [docInsert] = await trx('documents')
          .insert({
            doc_type,
            doc_number: tempPlaceholder,
            site_id: Number(site_id),
            customer_or_supplier: customer_or_supplier.trim(),
            po_number: po_number ? po_number.trim() : null,
            notes: notes ? notes.trim() : null,
            created_by_user_id: req.session.user.id,
            created_at: new Date(),
          })
          .returning('id');

        const docId = typeof docInsert === 'object' ? docInsert.id : docInsert;
        const prefix = doc_type === 'collection_note' ? 'CN' : 'DN';
        const sequentialDocNumber = `${prefix}-${String(docId).padStart(6, '0')}`;

        // Assign final sequential document number
        await trx('documents').where('id', docId).update({ doc_number: sequentialDocNumber });

        // Insert stock movement lines
        const movementType = doc_type === 'collection_note' ? 'IN' : 'OUT';
        const poId = po_number
          ? (await trx('purchase_orders').where('po_number', po_number.trim()).first())?.id || null
          : null;

        for (const line of items) {
          await trx('stock_movements').insert({
            item_id: Number(line.item_id),
            site_id: Number(site_id),
            movement_type: movementType,
            qty: Math.abs(parseFloat(line.qty)),
            po_id: poId,
            document_id: docId,
            created_by_user_id: req.session.user.id,
            notes: `${sequentialDocNumber} — ${line.notes || ''}`.trim(),
            created_at: new Date(),
          });
        }

        return {
          id: docId,
          doc_number: sequentialDocNumber,
          doc_type,
          site_id: Number(site_id),
          customer_or_supplier: customer_or_supplier.trim(),
        };
      });

      res.status(201).json({
        success: true,
        document: result,
      });
    } catch (err) {
      console.error('Document creation transaction error:', err);
      res.status(500).json({ error: 'Transaction failed. Could not create document and update ledger.' });
    }
  });

  // GET /api/documents/:id/pdf - Stream printable PDF
  router.get('/:id/pdf', requireAuth, async (req, res) => {
    try {
      const docId = Number(req.params.id);

      const document = await db('documents').where('id', docId).first();
      if (!document) {
        return res.status(404).send('Document not found');
      }

      const site = await db('sites').where('id', document.site_id).first();
      const user = document.created_by_user_id
        ? await db('users').where('id', document.created_by_user_id).first()
        : null;

      const lines = await db('stock_movements as sm')
        .join('items as i', 'sm.item_id', 'i.id')
        .select(
          'sm.qty',
          'sm.movement_type',
          'i.sku',
          'i.description as item_description',
          'i.unit'
        )
        .where('sm.document_id', docId)
        .orderBy('sm.id', 'asc');

      // Fetch company settings
      const settingsRows = await db('settings').select('*');
      const companySettings = {};
      settingsRows.forEach((r) => {
        companySettings[r.key] = r.value;
      });

      const pdfStream = generateDocumentPdf({
        document,
        site,
        user,
        lines,
        companySettings,
      });

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${document.doc_number}.pdf"`);

      pdfStream.pipe(res);
    } catch (err) {
      console.error('Error streaming document PDF:', err);
      res.status(500).send('Failed to generate document PDF');
    }
  });

  return router;
}

module.exports = {
  createDocumentRoutes,
};
