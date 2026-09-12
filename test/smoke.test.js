/**
 * Automated Smoke-Test Suite for Inventory Tracker.
 * Tests:
 * 1. Health & Server setup
 * 2. Authentication & Session Cookies
 * 3. Derived Stock Level calculations
 * 4. Manual Stock Movement ledger logging
 * 5. Transactional Document Creation (Collection/Delivery Notes)
 * 6. Printable PDF & CSV Report generation
 * 7. Server-side Staff Site write boundary enforcement
 * 8. Cryptographic License Activation & Seat Eviction
 */
const request = require('supertest');
const { createApp } = require('../app');
const { migrateAndSeed } = require('../scripts/migrate-and-seed');
const { generateLicense } = require('../license-keygen/generate-key');

async function runSmokeTests() {
  console.log('====================================================');
  console.log('  STARTING AUTOMATED SMOKE-TEST SUITE');
  console.log('====================================================');

  await migrateAndSeed();
  const { app, db } = createApp();

  let adminAgent = request.agent(app);
  let staffAgent = request.agent(app);

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  ✓ PASS: ${message}`);
      passed++;
    } else {
      console.error(`  ✗ FAIL: ${message}`);
      failed++;
    }
  }

  try {
    // 1. Health check
    console.log('\n--- 1. Health Check ---');
    const healthRes = await request(app).get('/api/health');
    assert(healthRes.status === 200 && healthRes.body.status === 'ok', 'GET /api/health returns 200 OK');

    // 2. Authentication
    console.log('\n--- 2. Authentication & Sessions ---');
    const badLogin = await adminAgent.post('/api/auth/login').send({ username: 'admin', password: 'wrongpassword' });
    assert(badLogin.status === 401, 'Login with invalid password returns 401 Unauthorized');

    const adminLogin = await adminAgent.post('/api/auth/login').send({ username: 'admin', password: 'admin123' });
    assert(adminLogin.status === 200 && adminLogin.body.user.role === 'admin', 'Admin login successful with role "admin"');

    const meRes = await adminAgent.get('/api/auth/me');
    assert(meRes.body.authenticated === true && meRes.body.user.username === 'admin', 'Session cookie recognized on /api/auth/me');

    // 3. Derived Stock Levels
    console.log('\n--- 3. Derived Stock Levels ---');
    const initialLevels = await adminAgent.get('/api/stock/levels');
    assert(initialLevels.status === 200 && Array.isArray(initialLevels.body), 'Stock levels endpoint returns array');
    const item1Site1 = initialLevels.body.find((row) => row.sku === 'BOX-CRG-L40' && row.site_id === 1);
    assert(item1Site1 && item1Site1.qty_on_hand === 100, 'Derived stock calculation for BOX-CRG-L40 at Site 1 matches ledger (100)');

    // 4. Record Stock Movement
    console.log('\n--- 4. Stock Movement Ledger ---');
    const movRes = await adminAgent.post('/api/stock/movements').send({
      item_id: item1Site1.item_id,
      site_id: 1,
      movement_type: 'IN',
      qty: 50,
      notes: 'Smoke test inbound shipment',
    });
    assert(movRes.status === 201 && movRes.body.new_balance === 150, 'Recorded manual IN movement of 50 units (New balance = 150)');

    const updatedLevels = await adminAgent.get('/api/stock/levels');
    const item1After = updatedLevels.body.find((row) => row.sku === 'BOX-CRG-L40' && row.site_id === 1);
    assert(item1After.qty_on_hand === 150, 'Derived stock level dynamically re-calculated to 150 without caching');

    // 5. Atomic Document Creation (Delivery Note)
    console.log('\n--- 5. Atomic Document Creation (Delivery Note) ---');
    const docRes = await adminAgent.post('/api/documents').send({
      doc_type: 'delivery_note',
      site_id: 1,
      customer_or_supplier: 'Apex Metro Client Ltd',
      po_number: 'PO-TEST-001',
      notes: 'Urgent warehouse dispatch',
      items: [
        { item_id: item1Site1.item_id, qty: 20, notes: 'Carton 1' },
      ],
    });
    assert(docRes.status === 201 && docRes.body.document.doc_number === 'DN-000001', 'Document created with auto-sequenced ID DN-000001');

    // Verify stock ledger was updated in the same transaction
    const postDocLevels = await adminAgent.get('/api/stock/levels');
    const item1PostDoc = postDocLevels.body.find((row) => row.sku === 'BOX-CRG-L40' && row.site_id === 1);
    assert(item1PostDoc.qty_on_hand === 130, 'Atomic ledger update: Stock level decreased by 20 to 130');

    // Verify document details endpoint
    const docDetailsRes = await adminAgent.get(`/api/documents/${docRes.body.document.id}`);
    assert(
      docDetailsRes.status === 200 && docDetailsRes.body.lines.length === 1 && docDetailsRes.body.lines[0].qty === 20,
      'Document lines retrieved correctly with item details'
    );

    // 6. PDF and CSV Generation
    console.log('\n--- 6. PDF & CSV Generation ---');
    const pdfDocRes = await adminAgent.get(`/api/documents/${docRes.body.document.id}/pdf`);
    assert(
      pdfDocRes.status === 200 && pdfDocRes.headers['content-type'] === 'application/pdf' && pdfDocRes.body.length > 500,
      'Document PDF generated with application/pdf header and valid binary buffer'
    );

    const reportPdfRes = await adminAgent.get('/api/reports/inventory/pdf');
    assert(
      reportPdfRes.status === 200 && reportPdfRes.headers['content-type'] === 'application/pdf',
      'Inventory Report PDF generated successfully'
    );

    const reportCsvRes = await adminAgent.get('/api/reports/inventory/csv');
    assert(
      reportCsvRes.status === 200 && reportCsvRes.text.includes('SKU,Description,Site'),
      'Inventory Report CSV generated with valid CSV headers'
    );

    // 7. Server-Side Staff Site Write Boundary Enforcement
    console.log('\n--- 7. Role & Site Access Boundary ---');
    const staffLogin = await staffAgent.post('/api/auth/login').send({ username: 'staff1', password: 'staff123' });
    assert(staffLogin.status === 200 && staffLogin.body.user.role === 'staff' && staffLogin.body.user.site_id === 1, 'Staff logged in (assigned to Site 1)');

    // Attempt staff write to Site 2 (should be rejected by server-side middleware)
    const illegalStaffMov = await staffAgent.post('/api/stock/movements').send({
      item_id: item1Site1.item_id,
      site_id: 2,
      movement_type: 'IN',
      qty: 10,
    });
    assert(illegalStaffMov.status === 403, 'Server-side middleware strictly blocks staff write to unassigned site (Site 2 -> 403 Forbidden)');

    // Attempt staff write to Site 1 (assigned site - should be allowed)
    const validStaffMov = await staffAgent.post('/api/stock/movements').send({
      item_id: item1Site1.item_id,
      site_id: 1,
      movement_type: 'IN',
      qty: 10,
    });
    assert(validStaffMov.status === 201, 'Staff permitted to record movement to assigned Site 1');

    // 8. License Activation & Seat Eviction
    console.log('\n--- 8. Cryptographic Licensing & Seats ---');
    // Because initial license has 1 seat and staff1 logged in, adminAgent was evicted
    const adminEvictedCheck = await adminAgent.get('/api/stock/levels');
    assert(adminEvictedCheck.status === 401 && adminEvictedCheck.body.evicted === true, 'Admin was properly evicted when staff logged in beyond 1-seat limit');

    // Re-login admin
    await adminAgent.post('/api/auth/login').send({ username: 'admin', password: 'admin123' });

    const initialLicRes = await adminAgent.get('/api/license/status');
    assert(initialLicRes.body.is_trial === true && initialLicRes.body.seats === 1, 'Default initial state is 30-day trial with 1 seat');

    // Generate a valid signed commercial key for 5 seats
    const { licenseKey: newKey } = generateLicense(
      'Acme Mega Distribution',
      5,
      365,
      process.env.LICENSE_HMAC_SECRET || 'inventory-tracker-secret-key-2026'
    );

    const activateRes = await adminAgent.post('/api/license/activate').send({ license_key: newKey });
    assert(activateRes.status === 200 && activateRes.body.license.seats === 5, 'Activated valid HMAC-SHA256 commercial key for 5 seats');

    // With 5 seats, staff1 logs back in and both remain active concurrently
    await staffAgent.post('/api/auth/login').send({ username: 'staff1', password: 'staff123' });
    const adminStillActive = await adminAgent.get('/api/auth/me');
    const staffStillActive = await staffAgent.get('/api/auth/me');
    assert(adminStillActive.body.authenticated === true && staffStillActive.body.authenticated === true, 'Both admin and staff remain concurrently active under 5-seat license');

    const invalidKeyRes = await adminAgent.post('/api/license/activate').send({ license_key: 'LIC-tampered-invalid-key' });
    assert(invalidKeyRes.status === 400, 'Tampered/invalid license key correctly rejected with 400');

    console.log('\n====================================================');
    console.log(`  SMOKE TESTS COMPLETE: ${passed} PASSED, ${failed} FAILED`);
    console.log('====================================================\n');

    if (failed > 0) {
      process.exit(1);
    } else {
      process.exit(0);
    }
  } catch (err) {
    console.error('Unhandled error during smoke test:', err);
    process.exit(1);
  }
}

runSmokeTests();
