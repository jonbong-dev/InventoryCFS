const express = require('express');
const { getStockLevels } = require('../lib/stock');
const { generateInventoryReportPdf, generateInventoryReportCsv } = require('../lib/pdf');

function createReportRoutes(db, authMiddleware) {
  const router = express.Router();
  const { requireAuth } = authMiddleware;

  // GET /api/reports/inventory/pdf - Download Combined Inventory Report as PDF
  router.get('/inventory/pdf', requireAuth, async (req, res) => {
    try {
      const { site_id, low_stock_only } = req.query;
      const stockLevels = await getStockLevels(db, {
        site_id,
        low_stock_only: low_stock_only === 'true',
      });

      const settingsRows = await db('settings').select('*');
      const companySettings = {};
      settingsRows.forEach((r) => {
        companySettings[r.key] = r.value;
      });

      const pdfStream = generateInventoryReportPdf({
        stockLevels,
        companySettings,
      });

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename="inventory-report.pdf"');
      pdfStream.pipe(res);
    } catch (err) {
      console.error('Error generating inventory report PDF:', err);
      res.status(500).send('Failed to generate report PDF');
    }
  });

  // GET /api/reports/inventory/csv - Download Combined Inventory Report as CSV
  router.get('/inventory/csv', requireAuth, async (req, res) => {
    try {
      const { site_id, low_stock_only } = req.query;
      const stockLevels = await getStockLevels(db, {
        site_id,
        low_stock_only: low_stock_only === 'true',
      });

      const csvContent = generateInventoryReportCsv(stockLevels);

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="inventory-report.csv"');
      res.send(csvContent);
    } catch (err) {
      console.error('Error generating inventory report CSV:', err);
      res.status(500).send('Failed to generate report CSV');
    }
  });

  return router;
}

module.exports = {
  createReportRoutes,
};
