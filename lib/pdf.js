/**
 * PDF Generation Service using PDFKit.
 * Generates official printable Collection Notes, Delivery Notes, and Inventory Reports.
 */
const PDFDocument = require('pdfkit');

/**
 * Builds a printable Delivery Note or Collection Note PDF.
 */
function generateDocumentPdf(data) {
  const { document, site, user, lines, companySettings } = data;
  const doc = new PDFDocument({ margin: 40, size: 'A4' });

  const companyName = companySettings.company_name || 'Apex Logistics & Distribution Ltd';
  const companyAddress = companySettings.company_address || '100 Industrial Parkway';
  const companyPhone = companySettings.company_phone || '';
  const companyEmail = companySettings.company_email || '';
  const footerNote = companySettings.footer_note || 'Goods received in good order and condition.';

  const isDelivery = document.doc_type === 'delivery_note';
  const titleText = isDelivery ? 'DELIVERY NOTE' : 'COLLECTION NOTE';

  // 1. Company Header
  doc
    .fillColor('#1e293b')
    .font('Helvetica-Bold')
    .fontSize(18)
    .text(companyName, 40, 40);

  doc
    .fillColor('#64748b')
    .font('Helvetica')
    .fontSize(9)
    .text(companyAddress, 40, 62)
    .text([companyPhone, companyEmail].filter(Boolean).join('  |  '), 40, 74);

  // Document Title Box on Right
  doc
    .fillColor(isDelivery ? '#0284c7' : '#0d9488')
    .font('Helvetica-Bold')
    .fontSize(16)
    .text(titleText, 350, 40, { align: 'right', width: 205 });

  doc
    .fillColor('#334155')
    .font('Helvetica-Bold')
    .fontSize(11)
    .text(document.doc_number, 350, 60, { align: 'right', width: 205 });

  doc
    .fillColor('#64748b')
    .font('Helvetica')
    .fontSize(9)
    .text(`Date: ${new Date(document.created_at || Date.now()).toLocaleDateString()}`, 350, 74, {
      align: 'right',
      width: 205,
    });

  // Divider Line
  doc
    .strokeColor('#cbd5e1')
    .lineWidth(1)
    .moveTo(40, 95)
    .lineTo(555, 95)
    .stroke();

  // 2. Metadata Grid
  const gridY = 105;
  doc
    .fillColor('#475569')
    .font('Helvetica-Bold')
    .fontSize(9)
    .text(isDelivery ? 'Deliver To / Customer:' : 'Collected From / Supplier:', 40, gridY)
    .font('Helvetica')
    .fontSize(10)
    .fillColor('#0f172a')
    .text(document.customer_or_supplier || 'N/A', 40, gridY + 12)
    .font('Helvetica-Bold')
    .fontSize(9)
    .fillColor('#475569')
    .text('Fulfillment Site:', 40, gridY + 30)
    .font('Helvetica')
    .fontSize(10)
    .fillColor('#0f172a')
    .text(site ? site.name : 'All Sites', 40, gridY + 42);

  doc
    .font('Helvetica-Bold')
    .fontSize(9)
    .fillColor('#475569')
    .text('Purchase Order (PO):', 320, gridY)
    .font('Helvetica')
    .fontSize(10)
    .fillColor('#0f172a')
    .text(document.po_number || 'N/A', 320, gridY + 12)
    .font('Helvetica-Bold')
    .fontSize(9)
    .fillColor('#475569')
    .text('Issued By User:', 320, gridY + 30)
    .font('Helvetica')
    .fontSize(10)
    .fillColor('#0f172a')
    .text(user ? user.username : 'System', 320, gridY + 42);

  if (document.notes) {
    doc
      .font('Helvetica-Bold')
      .fontSize(9)
      .fillColor('#475569')
      .text('Notes:', 40, gridY + 60)
      .font('Helvetica')
      .fontSize(9)
      .fillColor('#334155')
      .text(document.notes, 75, gridY + 60, { width: 470 });
  }

  // 3. Line Items Table Header
  const tableY = document.notes ? gridY + 85 : gridY + 65;

  // Header background
  doc
    .rect(40, tableY, 515, 20)
    .fill('#f1f5f9');

  doc
    .fillColor('#1e293b')
    .font('Helvetica-Bold')
    .fontSize(9)
    .text('#', 48, tableY + 5)
    .text('SKU', 75, tableY + 5)
    .text('Description', 170, tableY + 5)
    .text('Action', 380, tableY + 5)
    .text('Quantity', 430, tableY + 5, { width: 60, align: 'right' })
    .text('Unit', 500, tableY + 5, { width: 45, align: 'right' });

  // 4. Line Items Rows
  let curY = tableY + 22;
  lines.forEach((line, idx) => {
    const isOdd = idx % 2 === 1;
    if (isOdd) {
      doc.rect(40, curY - 2, 515, 18).fill('#f8fafc');
    }

    doc
      .fillColor('#475569')
      .font('Helvetica')
      .fontSize(9)
      .text(String(idx + 1), 48, curY)
      .fillColor('#0f172a')
      .font('Helvetica-Bold')
      .text(line.sku, 75, curY)
      .font('Helvetica')
      .fillColor('#334155')
      .text(line.item_description || line.description, 170, curY, { width: 200, lineBreak: false, ellipsis: true })
      .fillColor(line.movement_type === 'IN' ? '#0d9488' : '#e11d48')
      .font('Helvetica-Bold')
      .text(line.movement_type, 380, curY)
      .fillColor('#0f172a')
      .text(Number(line.qty).toLocaleString(), 430, curY, { width: 60, align: 'right' })
      .fillColor('#64748b')
      .font('Helvetica')
      .text(line.unit || 'pcs', 500, curY, { width: 45, align: 'right' });

    curY += 20;
  });

  // Table bottom border
  doc
    .strokeColor('#cbd5e1')
    .lineWidth(1)
    .moveTo(40, curY)
    .lineTo(555, curY)
    .stroke();

  // 5. Signature Section
  const sigY = Math.max(curY + 40, 620);

  // Box 1: Authorized Issuer
  doc
    .rect(40, sigY, 240, 100)
    .strokeColor('#cbd5e1')
    .lineWidth(1)
    .stroke();

  doc
    .fillColor('#475569')
    .font('Helvetica-Bold')
    .fontSize(9)
    .text('AUTHORIZED DISPATCH / RECEIVING', 50, sigY + 8)
    .font('Helvetica')
    .fontSize(8)
    .fillColor('#64748b')
    .text('Name: _______________________________', 50, sigY + 35)
    .text('Signature: __________________________', 50, sigY + 60)
    .text('Date: _______________________________', 50, sigY + 85);

  // Box 2: Driver / Customer Receipt
  doc
    .rect(315, sigY, 240, 100)
    .strokeColor('#cbd5e1')
    .lineWidth(1)
    .stroke();

  doc
    .fillColor('#475569')
    .font('Helvetica-Bold')
    .fontSize(9)
    .text('CARRIER / CUSTOMER ACKNOWLEDGEMENT', 325, sigY + 8)
    .font('Helvetica')
    .fontSize(8)
    .fillColor('#64748b')
    .text('Name: _______________________________', 325, sigY + 35)
    .text('Signature: __________________________', 325, sigY + 60)
    .text('Date: _______________________________', 325, sigY + 85);

  // 6. Footer Note
  doc
    .fillColor('#64748b')
    .font('Helvetica-Oblique')
    .fontSize(8)
    .text(footerNote, 40, 750, { width: 515, align: 'center' });

  doc.end();
  return doc;
}

/**
 * Builds a printable Inventory Report PDF.
 */
function generateInventoryReportPdf(data) {
  const { stockLevels, companySettings } = data;
  const doc = new PDFDocument({ margin: 40, size: 'A4' });

  const companyName = companySettings.company_name || 'Apex Logistics & Distribution Ltd';

  // Header
  doc
    .fillColor('#0f172a')
    .font('Helvetica-Bold')
    .fontSize(16)
    .text(companyName, 40, 40);

  doc
    .fillColor('#0284c7')
    .font('Helvetica-Bold')
    .fontSize(14)
    .text('COMPREHENSIVE INVENTORY STATUS REPORT', 40, 60);

  doc
    .fillColor('#64748b')
    .font('Helvetica')
    .fontSize(9)
    .text(`Report Generated: ${new Date().toLocaleString()}`, 40, 78);

  // Summary Metrics Bar
  const totalStock = stockLevels.reduce((sum, item) => sum + item.qty_on_hand, 0);
  const lowStockCount = stockLevels.filter((item) => item.is_low_stock).length;

  doc
    .rect(40, 95, 515, 30)
    .fill('#f8fafc');

  doc
    .strokeColor('#e2e8f0')
    .rect(40, 95, 515, 30)
    .stroke();

  doc
    .fillColor('#334155')
    .font('Helvetica-Bold')
    .fontSize(9)
    .text(`Total Records: ${stockLevels.length}`, 55, 105)
    .text(`Total Units on Hand: ${totalStock.toLocaleString()}`, 200, 105)
    .fillColor(lowStockCount > 0 ? '#e11d48' : '#0d9488')
    .text(`Low Stock Warnings: ${lowStockCount}`, 380, 105);

  // Table Header
  let curY = 135;
  doc
    .rect(40, curY, 515, 20)
    .fill('#0f172a');

  doc
    .fillColor('#ffffff')
    .font('Helvetica-Bold')
    .fontSize(8)
    .text('SKU', 48, curY + 6)
    .text('Description', 130, curY + 6)
    .text('Site', 290, curY + 6)
    .text('Reorder', 390, curY + 6, { width: 45, align: 'right' })
    .text('On Hand', 445, curY + 6, { width: 50, align: 'right' })
    .text('Status', 505, curY + 6, { width: 45, align: 'center' });

  curY += 20;

  stockLevels.forEach((row, idx) => {
    // Add page if near bottom
    if (curY > 740) {
      doc.addPage();
      curY = 40;
    }

    const isOdd = idx % 2 === 1;
    if (isOdd) {
      doc.rect(40, curY, 515, 16).fill('#f8fafc');
    }

    doc
      .fillColor('#0f172a')
      .font('Helvetica-Bold')
      .fontSize(8)
      .text(row.sku, 48, curY + 4)
      .font('Helvetica')
      .fillColor('#334155')
      .text(row.item_description, 130, curY + 4, { width: 155, ellipsis: true })
      .text(row.site_name, 290, curY + 4, { width: 95, ellipsis: true })
      .fillColor('#64748b')
      .text(String(row.reorder_level), 390, curY + 4, { width: 45, align: 'right' })
      .fillColor('#0f172a')
      .font('Helvetica-Bold')
      .text(`${row.qty_on_hand} ${row.unit}`, 445, curY + 4, { width: 50, align: 'right' })
      .fillColor(row.is_low_stock ? '#e11d48' : '#0d9488')
      .font('Helvetica-Bold')
      .text(row.is_low_stock ? 'REORDER' : 'OK', 505, curY + 4, { width: 45, align: 'center' });

    curY += 16;
  });

  doc.end();
  return doc;
}

/**
 * Builds RFC-4180 compliant CSV string for the Inventory Report.
 */
function generateInventoryReportCsv(stockLevels) {
  const escapeCsv = (val) => {
    if (val === null || val === undefined) return '""';
    const str = String(val).replace(/"/g, '""');
    return `"${str}"`;
  };

  const headers = ['SKU', 'Description', 'Site', 'Unit', 'Reorder Level', 'Qty On Hand', 'Status'];
  const rows = [headers.join(',')];

  for (const row of stockLevels) {
    rows.push(
      [
        escapeCsv(row.sku),
        escapeCsv(row.item_description),
        escapeCsv(row.site_name),
        escapeCsv(row.unit),
        row.reorder_level,
        row.qty_on_hand,
        escapeCsv(row.status),
      ].join(',')
    );
  }

  return rows.join('\r\n');
}

module.exports = {
  generateDocumentPdf,
  generateInventoryReportPdf,
  generateInventoryReportCsv,
};
