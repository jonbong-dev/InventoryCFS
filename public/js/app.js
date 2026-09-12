/**
 * Front-end Application Client for Inventory Tracker.
 * Pure Vanilla JavaScript — zero external dependencies, 100% offline capable.
 */

// Global App State
let state = {
  currentUser: null,
  license: null,
  sites: [],
  items: [],
  purchaseOrders: [],
  currentView: 'stock',
  currentAdminTab: 'sites',
  stockDebounceTimer: null,
  docsDebounceTimer: null,
};

// Initialize Application
document.addEventListener('DOMContentLoaded', async () => {
  setupMobileNav();
  checkUrlParams();
  await checkAuth();
});

function setupMobileNav() {
  const toggle = document.getElementById('mobile-nav-toggle');
  const nav = document.getElementById('main-nav');
  if (toggle && nav) {
    toggle.addEventListener('click', () => {
      nav.classList.toggle('open');
    });
  }
}

function checkUrlParams() {
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('evicted') === '1') {
    const alert = document.getElementById('evicted-alert');
    if (alert) alert.classList.remove('hidden');
  }
}

// -------------------------------------------------------------
// Authentication
// -------------------------------------------------------------
async function checkAuth() {
  try {
    const res = await fetch('/api/auth/me');
    const data = await res.json();

    if (data.authenticated) {
      state.currentUser = data.user;
      state.license = data.license;
      showAppShell();
      await loadInitialData();
      switchView(state.currentView);
    } else {
      showLoginScreen();
    }
  } catch (err) {
    console.error('Error verifying authentication:', err);
    showLoginScreen();
  }
}

function showLoginScreen() {
  document.getElementById('login-screen').classList.remove('hidden');
  document.getElementById('app-shell').classList.add('hidden');
}

function showAppShell() {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('app-shell').classList.remove('hidden');

  // Update header badges
  const u = state.currentUser;
  document.getElementById('user-display-name').textContent = u.username;
  document.getElementById('user-role-badge').textContent = u.role.toUpperCase();
  document.getElementById('user-role-badge').className = `badge ${
    u.role === 'admin' ? 'badge-admin' : 'badge-staff'
  }`;

  document.getElementById('user-site-badge').textContent =
    u.role === 'admin' ? 'All Sites Access' : (u.site_name || `Site #${u.site_id}`);

  // Admin nav link visibility
  const adminNav = document.getElementById('nav-admin-link');
  if (u.role === 'admin') {
    adminNav.classList.remove('hidden');
  } else {
    adminNav.classList.add('hidden');
  }

  updateLicenseDisplay();
}

function updateLicenseDisplay() {
  const lic = state.license;
  const pill = document.getElementById('license-pill');
  if (!lic || !pill) return;

  if (lic.is_expired) {
    pill.className = 'badge badge-low';
    pill.textContent = 'License Expired';
  } else if (lic.is_trial) {
    pill.className = 'badge badge-trial';
    pill.textContent = `Trial: ${lic.days_remaining}d (${lic.active_seats_in_use}/${lic.seats} seats)`;
  } else {
    pill.className = 'badge badge-active';
    pill.textContent = `Licensed (${lic.active_seats_in_use}/${lic.seats} seats)`;
  }
}

// Login Form Submit
document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const alert = document.getElementById('login-alert');
  alert.classList.add('hidden');

  const username = document.getElementById('login-username').value;
  const password = document.getElementById('login-password').value;

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });

    const data = await res.json();
    if (!res.ok) {
      alert.textContent = data.error || 'Login failed.';
      alert.classList.remove('hidden');
      return;
    }

    state.currentUser = data.user;
    // Clear URL query if present
    window.history.replaceState({}, document.title, window.location.pathname);
    await checkAuth();
  } catch (err) {
    alert.textContent = 'Server connection error. Please try again.';
    alert.classList.remove('hidden');
  }
});

function fillLogin(user, pass) {
  document.getElementById('login-username').value = user;
  document.getElementById('login-password').value = pass;
}

async function handleLogout() {
  try {
    await fetch('/api/auth/logout', { method: 'POST' });
  } catch (e) {
    // Ignore error
  }
  state.currentUser = null;
  showLoginScreen();
}

// -------------------------------------------------------------
// Initial Data Fetching
// -------------------------------------------------------------
async function loadInitialData() {
  await Promise.all([loadSites(), loadItems(), loadCompanySettings()]);
}

async function loadSites() {
  try {
    const res = await fetch('/api/admin/sites');
    if (res.ok) {
      state.sites = await res.json();
      populateSiteDropdowns();
    }
  } catch (e) {
    console.error('Failed to load sites', e);
  }
}

async function loadItems() {
  try {
    const res = await fetch('/api/admin/items');
    if (res.ok) {
      state.items = await res.json();
      populateItemDropdowns();
    }
  } catch (e) {
    console.error('Failed to load items', e);
  }
}

async function loadCompanySettings() {
  try {
    const res = await fetch('/api/admin/settings');
    if (res.ok) {
      const data = await res.json();
      if (data.company_name) {
        const tag = document.getElementById('company-name-tag');
        if (tag) tag.textContent = data.company_name;
      }
    }
  } catch (e) {}
}

function populateSiteDropdowns() {
  const selects = [
    'stock-site-filter',
    'ledger-site-filter',
    'doc-site-filter',
    'report-site-filter',
    'mov-site',
    'doc-site',
    'po-site-select',
    'user-site-select',
  ];

  selects.forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;

    const isFilter = id.includes('filter');
    const prevVal = el.value;

    let html = isFilter ? '<option value="">All Sites</option>' : '<option value="">Select Warehouse Site...</option>';

    // If current user is staff, restrict write dropdowns to their assigned site!
    const isWriteSelect = id === 'mov-site' || id === 'doc-site';
    const isStaff = state.currentUser && state.currentUser.role === 'staff';

    state.sites.forEach((s) => {
      if (isWriteSelect && isStaff && s.id !== state.currentUser.site_id) {
        return; // Don't allow selecting another site for staff writes
      }
      html += `<option value="${s.id}">${escapeHtml(s.name)}</option>`;
    });

    el.innerHTML = html;
    if (prevVal) el.value = prevVal;

    // Default select assigned site for staff
    if (isWriteSelect && isStaff && state.currentUser.site_id) {
      el.value = state.currentUser.site_id;
      el.disabled = true; // Visual lock for staff
      const note = document.getElementById('mov-site-note');
      if (note && id === 'mov-site') {
        note.textContent = 'Locked to your assigned staff site.';
      }
    } else if (isWriteSelect) {
      el.disabled = false;
      const note = document.getElementById('mov-site-note');
      if (note && id === 'mov-site') note.textContent = '';
    }
  });
}

function populateItemDropdowns() {
  const movItem = document.getElementById('mov-item');
  if (movItem) {
    let html = '<option value="">Select Catalog SKU...</option>';
    state.items.forEach((item) => {
      html += `<option value="${item.id}">${item.sku} — ${escapeHtml(item.description)} (${item.unit})</option>`;
    });
    movItem.innerHTML = html;
  }
}

// -------------------------------------------------------------
// View Navigation
// -------------------------------------------------------------
function switchView(viewName) {
  // If not admin, block admin view
  if (viewName === 'admin' && state.currentUser.role !== 'admin') {
    viewName = 'stock';
  }

  state.currentView = viewName;

  // Update Nav links
  document.querySelectorAll('.nav-link').forEach((btn) => {
    if (btn.dataset.view === viewName) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  // Hide mobile drawer
  const nav = document.getElementById('main-nav');
  if (nav) nav.classList.remove('open');

  // Switch panels
  document.querySelectorAll('.view-panel').forEach((p) => p.classList.add('hidden'));
  const activePanel = document.getElementById(`view-${viewName}`);
  if (activePanel) activePanel.classList.remove('hidden');

  // Load view content
  if (viewName === 'stock') loadStockLevels();
  if (viewName === 'movements') loadLedger();
  if (viewName === 'documents') loadDocuments();
  if (viewName === 'reports') loadReportPreview();
  if (viewName === 'admin') loadAdminData();
}

// -------------------------------------------------------------
// VIEW 1: Stock Levels Screen
// -------------------------------------------------------------
function debounceLoadStock() {
  clearTimeout(state.stockDebounceTimer);
  state.stockDebounceTimer = setTimeout(loadStockLevels, 300);
}

async function loadStockLevels() {
  const tbody = document.getElementById('stock-table-body');
  if (!tbody) return;

  const search = document.getElementById('stock-search').value.trim();
  const siteId = document.getElementById('stock-site-filter').value;
  const lowOnly = document.getElementById('stock-low-filter').checked;

  const params = new URLSearchParams();
  if (search) params.append('search', search);
  if (siteId) params.append('site_id', siteId);
  if (lowOnly) params.append('low_stock_only', 'true');

  try {
    const res = await fetch(`/api/stock/levels?${params.toString()}`);
    if (!res.ok) throw new Error('Failed to fetch stock levels');
    const levels = await res.json();

    // Update Metric Cards
    document.getElementById('stat-total-skus').textContent = state.items.length;
    const totalUnits = levels.reduce((acc, row) => acc + (row.qty_on_hand || 0), 0);
    document.getElementById('stat-total-units').textContent = totalUnits.toLocaleString();
    const lowCount = levels.filter((row) => row.is_low_stock).length;
    document.getElementById('stat-low-stock').textContent = lowCount;

    if (levels.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" class="text-center text-muted" style="padding: 2rem;">No stock records found matching current filters.</td></tr>`;
      return;
    }

    let html = '';
    levels.forEach((row) => {
      const statusBadge = row.is_low_stock
        ? `<span class="badge badge-low">LOW STOCK</span>`
        : `<span class="badge badge-ok">ADEQUATE</span>`;

      html += `
        <tr>
          <td class="font-mono font-bold">${escapeHtml(row.sku)}</td>
          <td>${escapeHtml(row.item_description)}</td>
          <td>${escapeHtml(row.site_name)}</td>
          <td class="text-right font-bold" style="font-size: 1rem; color: ${row.is_low_stock ? 'var(--danger)' : 'var(--text-main)'}">
            ${row.qty_on_hand.toLocaleString()}
          </td>
          <td class="text-right text-muted">${escapeHtml(row.unit)}</td>
          <td class="text-right text-muted">${row.reorder_level}</td>
          <td class="text-center">${statusBadge}</td>
          <td class="text-center">
            <button class="btn btn-secondary btn-sm" onclick="quickMovementFor(${row.item_id}, ${row.site_id})">
              Adjust / Move
            </button>
          </td>
        </tr>
      `;
    });

    tbody.innerHTML = html;
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="8" class="text-center text-muted" style="color: var(--danger);">Error loading stock balances.</td></tr>`;
  }
}

function quickMovementFor(itemId, siteId) {
  openMovementModal();
  document.getElementById('mov-item').value = itemId;
  updateMovementUnitPreview();

  // If user is admin or assigned to this site, set site
  if (state.currentUser.role === 'admin' || state.currentUser.site_id === siteId) {
    document.getElementById('mov-site').value = siteId;
  }
}

// -------------------------------------------------------------
// Stock Movement Modal & Submissions
// -------------------------------------------------------------
async function openMovementModal() {
  document.getElementById('movement-modal-alert').classList.add('hidden');
  document.getElementById('movement-form').reset();
  populateSiteDropdowns();
  populateItemDropdowns();

  // Fetch purchase orders for optional link
  try {
    const res = await fetch('/api/admin/purchase-orders');
    if (res.ok) {
      const pos = await res.json();
      const poSelect = document.getElementById('mov-po');
      let html = '<option value="">None / Manual Adjustment</option>';
      pos.forEach((p) => {
        html += `<option value="${p.id}">${p.po_number} (${p.site_name})</option>`;
      });
      poSelect.innerHTML = html;
    }
  } catch (e) {}

  openModal('modal-movement');
}

function updateMovementUnitPreview() {
  const itemId = document.getElementById('mov-item').value;
  const item = state.items.find((i) => i.id == itemId);
  const preview = document.getElementById('mov-unit-preview');
  if (item && preview) {
    preview.textContent = item.unit;
  }
}

async function submitStockMovement(e) {
  e.preventDefault();
  const alert = document.getElementById('movement-modal-alert');
  alert.classList.add('hidden');

  const itemId = document.getElementById('mov-item').value;
  const siteId = document.getElementById('mov-site').value;
  const movType = document.getElementById('mov-type').value;
  const qty = document.getElementById('mov-qty').value;
  const poId = document.getElementById('mov-po').value;
  const notes = document.getElementById('mov-notes').value;

  try {
    const res = await fetch('/api/stock/movements', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        item_id: itemId,
        site_id: siteId,
        movement_type: movType,
        qty,
        po_id: poId || null,
        notes,
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      alert.textContent = data.error || 'Failed to record movement.';
      alert.classList.remove('hidden');
      return;
    }

    closeModal('modal-movement');
    if (state.currentView === 'stock') loadStockLevels();
    if (state.currentView === 'movements') loadLedger();
  } catch (err) {
    alert.textContent = 'Server error recording stock movement.';
    alert.classList.remove('hidden');
  }
}

// -------------------------------------------------------------
// VIEW 2: Movement Ledger History
// -------------------------------------------------------------
async function loadLedger() {
  const tbody = document.getElementById('ledger-table-body');
  if (!tbody) return;

  const siteId = document.getElementById('ledger-site-filter').value;
  const type = document.getElementById('ledger-type-filter').value;

  const params = new URLSearchParams();
  if (siteId) params.append('site_id', siteId);
  if (type) params.append('movement_type', type);

  try {
    const res = await fetch(`/api/stock/movements?${params.toString()}`);
    if (!res.ok) throw new Error('Failed to fetch ledger');
    const movements = await res.json();

    if (movements.length === 0) {
      tbody.innerHTML = `<tr><td colspan="11" class="text-center text-muted" style="padding: 2rem;">No movement ledger rows found.</td></tr>`;
      return;
    }

    let html = '';
    movements.forEach((row) => {
      const typeBadge = row.movement_type === 'IN'
        ? `<span class="badge badge-in">IN</span>`
        : `<span class="badge badge-out">OUT</span>`;

      const docLink = row.doc_number
        ? `<a href="#" onclick="viewDocumentDetails(${row.document_id}); return false;" class="font-mono font-bold" style="color: var(--primary);">${row.doc_number}</a>`
        : '<span class="text-muted">—</span>';

      html += `
        <tr>
          <td class="font-mono text-muted">#${row.id}</td>
          <td style="white-space: nowrap; font-size: 0.8125rem;">${formatDate(row.created_at)}</td>
          <td>${typeBadge}</td>
          <td class="font-mono font-bold">${escapeHtml(row.sku)}</td>
          <td>${escapeHtml(row.item_description)}</td>
          <td>${escapeHtml(row.site_name)}</td>
          <td class="text-right font-bold" style="color: ${row.movement_type === 'IN' ? 'var(--success)' : 'var(--danger)'}">
            ${row.movement_type === 'IN' ? '+' : '-'}${row.qty.toLocaleString()} <span class="text-muted" style="font-size: 0.75rem;">${row.unit}</span>
          </td>
          <td>${docLink}</td>
          <td class="font-mono">${row.po_number || '<span class="text-muted">—</span>'}</td>
          <td class="text-muted">${escapeHtml(row.logged_by || 'system')}</td>
          <td style="max-width: 200px; font-size: 0.8125rem;">${escapeHtml(row.notes || '')}</td>
        </tr>
      `;
    });

    tbody.innerHTML = html;
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="11" class="text-center text-muted" style="color: var(--danger);">Failed to load movements.</td></tr>`;
  }
}

// -------------------------------------------------------------
// VIEW 3: Documents (Collection & Delivery Notes)
// -------------------------------------------------------------
function debounceLoadDocs() {
  clearTimeout(state.docsDebounceTimer);
  state.docsDebounceTimer = setTimeout(loadDocuments, 300);
}

async function loadDocuments() {
  const tbody = document.getElementById('documents-table-body');
  if (!tbody) return;

  const search = document.getElementById('doc-search').value.trim();
  const docType = document.getElementById('doc-type-filter').value;
  const siteId = document.getElementById('doc-site-filter').value;

  const params = new URLSearchParams();
  if (search) params.append('search', search);
  if (docType) params.append('doc_type', docType);
  if (siteId) params.append('site_id', siteId);

  try {
    const res = await fetch(`/api/documents?${params.toString()}`);
    if (!res.ok) throw new Error('Failed to fetch documents');
    const docs = await res.json();

    if (docs.length === 0) {
      tbody.innerHTML = `<tr><td colspan="10" class="text-center text-muted" style="padding: 2rem;">No documents found.</td></tr>`;
      return;
    }

    let html = '';
    docs.forEach((d) => {
      const isDN = d.doc_type === 'delivery_note';
      const typeBadge = isDN
        ? `<span class="badge badge-out">DELIVERY (OUT)</span>`
        : `<span class="badge badge-in">COLLECTION (IN)</span>`;

      html += `
        <tr>
          <td class="font-mono font-bold" style="font-size: 0.95rem;">${escapeHtml(d.doc_number)}</td>
          <td>${typeBadge}</td>
          <td>${escapeHtml(d.site_name)}</td>
          <td class="font-bold">${escapeHtml(d.customer_or_supplier)}</td>
          <td class="font-mono">${d.po_number ? escapeHtml(d.po_number) : '<span class="text-muted">—</span>'}</td>
          <td class="text-right font-mono">${d.line_count}</td>
          <td class="text-right font-bold">${(d.total_qty || 0).toLocaleString()}</td>
          <td style="white-space: nowrap; font-size: 0.8125rem;">${formatDate(d.created_at)}</td>
          <td class="text-muted">${escapeHtml(d.created_by || 'system')}</td>
          <td class="text-center" style="white-space: nowrap;">
            <button class="btn btn-secondary btn-sm" onclick="viewDocumentDetails(${d.id})">Details</button>
            <a href="/api/documents/${d.id}/pdf" target="_blank" class="btn btn-primary btn-sm">PDF</a>
          </td>
        </tr>
      `;
    });

    tbody.innerHTML = html;
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="10" class="text-center text-muted" style="color: var(--danger);">Failed to load documents.</td></tr>`;
  }
}

// Document Creation Modal
function openCreateDocModal() {
  document.getElementById('doc-modal-alert').classList.add('hidden');
  document.getElementById('document-form').reset();
  populateSiteDropdowns();
  onDocTypeChange();

  // Reset lines
  const linesBody = document.getElementById('doc-line-items-body');
  linesBody.innerHTML = '';
  addDocumentLineItem(); // Add one blank line by default

  openModal('modal-document');
}

function onDocTypeChange() {
  const type = document.getElementById('doc-type').value;
  const label = document.getElementById('doc-recipient-label');
  const input = document.getElementById('doc-customer');
  if (type === 'delivery_note') {
    label.textContent = 'Recipient / Customer Name';
    input.placeholder = 'e.g. Metro Freight Corp';
  } else {
    label.textContent = 'Origin / Supplier Name';
    input.placeholder = 'e.g. Acme Industrial Supplies Ltd';
  }
}

function addDocumentLineItem() {
  const linesBody = document.getElementById('doc-line-items-body');
  const rowId = `doc-line-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;

  let itemOptions = '<option value="">Select Item...</option>';
  state.items.forEach((item) => {
    itemOptions += `<option value="${item.id}">${item.sku} — ${escapeHtml(item.description)} (${item.unit})</option>`;
  });

  const tr = document.createElement('tr');
  tr.id = rowId;
  tr.innerHTML = `
    <td>
      <select class="form-select doc-item-select" required style="min-height: 36px; padding: 0.35rem 0.5rem;">
        ${itemOptions}
      </select>
    </td>
    <td>
      <input type="number" class="form-input doc-item-qty" min="0.01" step="any" placeholder="Qty" required style="min-height: 36px; padding: 0.35rem 0.5rem;" />
    </td>
    <td>
      <input type="text" class="form-input doc-item-notes" placeholder="Remarks" style="min-height: 36px; padding: 0.35rem 0.5rem;" />
    </td>
    <td class="text-center">
      <button type="button" class="btn btn-danger btn-sm" onclick="removeDocumentLineItem('${rowId}')" style="min-height: 32px; padding: 0.2rem 0.5rem;">×</button>
    </td>
  `;
  linesBody.appendChild(tr);
}

function removeDocumentLineItem(rowId) {
  const row = document.getElementById(rowId);
  if (row) row.remove();
}

async function submitDocument(e) {
  e.preventDefault();
  const alert = document.getElementById('doc-modal-alert');
  alert.classList.add('hidden');

  const docType = document.getElementById('doc-type').value;
  const siteId = document.getElementById('doc-site').value;
  const customer = document.getElementById('doc-customer').value.trim();
  const po = document.getElementById('doc-po').value.trim();
  const notes = document.getElementById('doc-notes').value.trim();

  // Extract lines
  const rows = document.querySelectorAll('#doc-line-items-body tr');
  if (rows.length === 0) {
    alert.textContent = 'Please add at least one line item.';
    alert.classList.remove('hidden');
    return;
  }

  const items = [];
  for (const row of rows) {
    const itemId = row.querySelector('.doc-item-select').value;
    const qty = row.querySelector('.doc-item-qty').value;
    const lineNotes = row.querySelector('.doc-item-notes').value;

    if (!itemId || !qty || parseFloat(qty) <= 0) {
      alert.textContent = 'All line items must have a valid item selected and a positive quantity.';
      alert.classList.remove('hidden');
      return;
    }

    items.push({
      item_id: itemId,
      qty: parseFloat(qty),
      notes: lineNotes,
    });
  }

  try {
    const res = await fetch('/api/documents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        doc_type: docType,
        site_id: siteId,
        customer_or_supplier: customer,
        po_number: po || null,
        notes: notes || null,
        items,
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      alert.textContent = data.error || 'Failed to create document.';
      alert.classList.remove('hidden');
      return;
    }

    closeModal('modal-document');

    // Refresh views
    if (state.currentView === 'documents') loadDocuments();
    if (state.currentView === 'stock') loadStockLevels();

    // Open view modal for newly generated document
    viewDocumentDetails(data.document.id);
  } catch (err) {
    alert.textContent = 'Server error during atomic document creation.';
    alert.classList.remove('hidden');
  }
}

async function viewDocumentDetails(docId) {
  try {
    const res = await fetch(`/api/documents/${docId}`);
    if (!res.ok) throw new Error('Document not found');
    const { document: doc, lines } = await res.json();

    const titleEl = document.getElementById('details-doc-title');
    titleEl.textContent = `${doc.doc_number} — ${
      doc.doc_type === 'delivery_note' ? 'Delivery Note' : 'Collection Note'
    }`;

    const metaEl = document.getElementById('details-doc-meta');
    metaEl.innerHTML = `
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 0.75rem; background: var(--bg-subtle); padding: 1rem; border-radius: var(--radius-sm);">
        <div><strong class="text-muted">Site:</strong> ${escapeHtml(doc.site_name)}</div>
        <div><strong class="text-muted">${doc.doc_type === 'delivery_note' ? 'Delivered To:' : 'Collected From:'}</strong> ${escapeHtml(doc.customer_or_supplier)}</div>
        <div><strong class="text-muted">PO Number:</strong> ${escapeHtml(doc.po_number || 'N/A')}</div>
        <div><strong class="text-muted">Date:</strong> ${formatDate(doc.created_at)}</div>
        <div><strong class="text-muted">Created By:</strong> ${escapeHtml(doc.created_by || 'System')}</div>
        <div><strong class="text-muted">Special Notes:</strong> ${escapeHtml(doc.notes || 'None')}</div>
      </div>
    `;

    const linesTbody = document.getElementById('details-lines-body');
    let html = '';
    lines.forEach((line, idx) => {
      html += `
        <tr>
          <td>${idx + 1}</td>
          <td class="font-mono font-bold">${escapeHtml(line.sku)}</td>
          <td>${escapeHtml(line.item_description)}</td>
          <td><span class="badge ${line.movement_type === 'IN' ? 'badge-in' : 'badge-out'}">${line.movement_type}</span></td>
          <td class="text-right font-bold">${line.qty.toLocaleString()}</td>
          <td class="text-muted">${escapeHtml(line.unit)}</td>
        </tr>
      `;
    });
    linesTbody.innerHTML = html;

    const pdfBtn = document.getElementById('details-pdf-btn');
    pdfBtn.href = `/api/documents/${doc.id}/pdf`;

    openModal('modal-doc-details');
  } catch (err) {
    alert('Failed to load document details.');
  }
}

// -------------------------------------------------------------
// VIEW 4: Reports
// -------------------------------------------------------------
async function loadReportPreview() {
  const tbody = document.getElementById('report-preview-body');
  if (!tbody) return;

  const siteId = document.getElementById('report-site-filter').value;
  const lowOnly = document.getElementById('report-low-filter').checked;

  const params = new URLSearchParams();
  if (siteId) params.append('site_id', siteId);
  if (lowOnly) params.append('low_stock_only', 'true');

  try {
    const res = await fetch(`/api/stock/levels?${params.toString()}`);
    if (!res.ok) throw new Error('Failed to fetch report');
    const levels = await res.json();

    if (levels.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted" style="padding: 2rem;">No items matching report criteria.</td></tr>`;
      return;
    }

    let html = '';
    levels.forEach((row) => {
      html += `
        <tr>
          <td class="font-mono font-bold">${escapeHtml(row.sku)}</td>
          <td>${escapeHtml(row.item_description)}</td>
          <td>${escapeHtml(row.site_name)}</td>
          <td class="text-right text-muted">${row.reorder_level}</td>
          <td class="text-right font-bold" style="color: ${row.is_low_stock ? 'var(--danger)' : 'var(--text-main)'}">
            ${row.qty_on_hand.toLocaleString()}
          </td>
          <td>${escapeHtml(row.unit)}</td>
          <td class="text-center">
            <span class="badge ${row.is_low_stock ? 'badge-low' : 'badge-ok'}">${row.status}</span>
          </td>
        </tr>
      `;
    });
    tbody.innerHTML = html;
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted" style="color: var(--danger);">Failed to load report preview.</td></tr>`;
  }
}

function downloadReport(format) {
  const siteId = document.getElementById('report-site-filter').value;
  const lowOnly = document.getElementById('report-low-filter').checked;

  const params = new URLSearchParams();
  if (siteId) params.append('site_id', siteId);
  if (lowOnly) params.append('low_stock_only', 'true');

  const url = `/api/reports/inventory/${format}?${params.toString()}`;
  window.open(url, '_blank');
}

// -------------------------------------------------------------
// VIEW 5: Administration Hub
// -------------------------------------------------------------
function switchAdminTab(tabName) {
  state.currentAdminTab = tabName;

  document.querySelectorAll('.tab-btn').forEach((btn) => {
    if (btn.textContent.toLowerCase().includes(tabName)) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  document.querySelectorAll('.admin-tab-panel').forEach((p) => p.classList.add('hidden'));
  const panel = document.getElementById(`admin-tab-${tabName}`);
  if (panel) panel.classList.remove('hidden');

  loadAdminData();
}

async function loadAdminData() {
  const tab = state.currentAdminTab;
  if (tab === 'sites') loadAdminSites();
  if (tab === 'items') loadAdminItems();
  if (tab === 'pos') loadAdminPOs();
  if (tab === 'users') loadAdminUsers();
  if (tab === 'settings') loadAdminSettings();
  if (tab === 'license') loadAdminLicense();
}

// Sites Admin
async function loadAdminSites() {
  await loadSites();
  const tbody = document.getElementById('admin-sites-table');
  if (!tbody) return;

  let html = '';
  state.sites.forEach((site) => {
    html += `
      <tr>
        <td class="font-mono text-muted">#${site.id}</td>
        <td class="font-bold">${escapeHtml(site.name)}</td>
        <td class="text-muted" style="font-size: 0.8125rem;">${formatDate(site.created_at)}</td>
        <td class="text-center">
          <button class="btn btn-secondary btn-sm" onclick="openSiteModal(${site.id}, '${escapeAttr(site.name)}')">Rename</button>
        </td>
      </tr>
    `;
  });
  tbody.innerHTML = html;
}

function openSiteModal(siteId = null, currentName = '') {
  document.getElementById('site-modal-alert').classList.add('hidden');
  document.getElementById('site-id-input').value = siteId || '';
  document.getElementById('site-name-input').value = currentName || '';
  document.getElementById('modal-site-title').textContent = siteId ? 'Rename Site' : 'Create New Site';
  openModal('modal-site');
}

async function submitSite(e) {
  e.preventDefault();
  const alert = document.getElementById('site-modal-alert');
  alert.classList.add('hidden');

  const siteId = document.getElementById('site-id-input').value;
  const name = document.getElementById('site-name-input').value.trim();

  const isEdit = Boolean(siteId);
  const url = isEdit ? `/api/admin/sites/${siteId}` : '/api/admin/sites';
  const method = isEdit ? 'PUT' : 'POST';

  try {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });

    const data = await res.json();
    if (!res.ok) {
      alert.textContent = data.error || 'Failed to save site.';
      alert.classList.remove('hidden');
      return;
    }

    closeModal('modal-site');
    await loadSites();
    loadAdminSites();
  } catch (err) {
    alert.textContent = 'Server error saving site.';
    alert.classList.remove('hidden');
  }
}

// Items Admin
async function loadAdminItems() {
  await loadItems();
  const tbody = document.getElementById('admin-items-table');
  if (!tbody) return;

  let html = '';
  state.items.forEach((item) => {
    html += `
      <tr>
        <td class="font-mono font-bold">${escapeHtml(item.sku)}</td>
        <td>${escapeHtml(item.description)}</td>
        <td class="text-muted">${escapeHtml(item.unit)}</td>
        <td class="text-right font-mono">${item.reorder_level}</td>
        <td class="text-center">
          <button class="btn btn-secondary btn-sm" onclick='openItemModal(${JSON.stringify(item)})'>Edit</button>
        </td>
      </tr>
    `;
  });
  tbody.innerHTML = html;
}

function openItemModal(item = null) {
  document.getElementById('item-modal-alert').classList.add('hidden');
  document.getElementById('item-id-input').value = item ? item.id : '';
  document.getElementById('item-sku-input').value = item ? item.sku : '';
  document.getElementById('item-desc-input').value = item ? item.description : '';
  document.getElementById('item-unit-input').value = item ? item.unit : 'pcs';
  document.getElementById('item-reorder-input').value = item ? item.reorder_level : 10;
  document.getElementById('modal-item-title').textContent = item ? 'Edit Item' : 'Add Catalog Item';
  openModal('modal-item');
}

async function submitItem(e) {
  e.preventDefault();
  const alert = document.getElementById('item-modal-alert');
  alert.classList.add('hidden');

  const itemId = document.getElementById('item-id-input').value;
  const sku = document.getElementById('item-sku-input').value.trim();
  const description = document.getElementById('item-desc-input').value.trim();
  const unit = document.getElementById('item-unit-input').value.trim();
  const reorder_level = document.getElementById('item-reorder-input').value;

  const isEdit = Boolean(itemId);
  const url = isEdit ? `/api/admin/items/${itemId}` : '/api/admin/items';
  const method = isEdit ? 'PUT' : 'POST';

  try {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sku, description, unit, reorder_level }),
    });

    const data = await res.json();
    if (!res.ok) {
      alert.textContent = data.error || 'Failed to save item.';
      alert.classList.remove('hidden');
      return;
    }

    closeModal('modal-item');
    await loadItems();
    loadAdminItems();
  } catch (err) {
    alert.textContent = 'Server error saving catalog item.';
    alert.classList.remove('hidden');
  }
}

// Purchase Orders Admin
async function loadAdminPOs() {
  const tbody = document.getElementById('admin-pos-table');
  if (!tbody) return;

  try {
    const res = await fetch('/api/admin/purchase-orders');
    if (!res.ok) throw new Error();
    const pos = await res.json();

    if (pos.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted">No purchase orders created yet.</td></tr>`;
      return;
    }

    let html = '';
    pos.forEach((p) => {
      html += `
        <tr>
          <td class="font-mono font-bold">${escapeHtml(p.po_number)}</td>
          <td>${escapeHtml(p.site_name)}</td>
          <td><span class="badge ${p.status === 'OPEN' ? 'badge-trial' : 'badge-ok'}">${p.status}</span></td>
          <td class="text-muted" style="font-size: 0.8125rem;">${escapeHtml(p.notes || '—')}</td>
          <td class="text-muted" style="font-size: 0.8125rem;">${formatDate(p.created_at)}</td>
        </tr>
      `;
    });
    tbody.innerHTML = html;
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted" style="color: var(--danger);">Failed to load POs.</td></tr>`;
  }
}

function openPoModal() {
  document.getElementById('po-modal-alert').classList.add('hidden');
  document.getElementById('po-form').reset();
  populateSiteDropdowns();
  openModal('modal-po');
}

async function submitPo(e) {
  e.preventDefault();
  const alert = document.getElementById('po-modal-alert');
  alert.classList.add('hidden');

  const po_number = document.getElementById('po-number-input').value.trim();
  const site_id = document.getElementById('po-site-select').value;
  const notes = document.getElementById('po-notes-input').value.trim();

  try {
    const res = await fetch('/api/admin/purchase-orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ po_number, site_id, notes }),
    });

    const data = await res.json();
    if (!res.ok) {
      alert.textContent = data.error || 'Failed to create PO.';
      alert.classList.remove('hidden');
      return;
    }

    closeModal('modal-po');
    loadAdminPOs();
  } catch (e) {
    alert.textContent = 'Server error creating PO.';
    alert.classList.remove('hidden');
  }
}

// Users Admin
async function loadAdminUsers() {
  const tbody = document.getElementById('admin-users-table');
  if (!tbody) return;

  try {
    const res = await fetch('/api/admin/users');
    if (!res.ok) throw new Error();
    const users = await res.json();

    let html = '';
    users.forEach((u) => {
      const isSelf = u.id === state.currentUser.id;
      const roleBadge = u.role === 'admin'
        ? '<span class="badge badge-admin">ADMIN</span>'
        : '<span class="badge badge-staff">STAFF</span>';

      html += `
        <tr>
          <td class="font-bold">${escapeHtml(u.username)} ${isSelf ? '<span class="badge badge-active" style="font-size: 0.65rem;">YOU</span>' : ''}</td>
          <td>${roleBadge}</td>
          <td>${u.role === 'staff' ? escapeHtml(u.site_name || `Site #${u.site_id}`) : '<span class="text-muted">Unrestricted (All Sites)</span>'}</td>
          <td class="text-muted" style="font-size: 0.8125rem;">${formatDate(u.created_at)}</td>
          <td class="text-center">
            <button class="btn btn-secondary btn-sm" onclick='openUserModal(${JSON.stringify(u)})'>Edit</button>
            ${!isSelf ? `<button class="btn btn-danger btn-sm" onclick="deleteUser(${u.id}, '${escapeAttr(u.username)}')">Delete</button>` : ''}
          </td>
        </tr>
      `;
    });
    tbody.innerHTML = html;
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted" style="color: var(--danger);">Failed to load users.</td></tr>`;
  }
}

function openUserModal(user = null) {
  document.getElementById('user-modal-alert').classList.add('hidden');
  document.getElementById('user-id-input').value = user ? user.id : '';
  document.getElementById('user-username-input').value = user ? user.username : '';
  document.getElementById('user-password-input').value = '';
  document.getElementById('user-role-select').value = user ? user.role : 'staff';
  document.getElementById('modal-user-title').textContent = user ? 'Edit User' : 'Add User Account';

  populateSiteDropdowns();
  if (user && user.site_id) {
    document.getElementById('user-site-select').value = user.site_id;
  }

  onUserRoleChange();
  openModal('modal-user');
}

function onUserRoleChange() {
  const role = document.getElementById('user-role-select').value;
  const siteGroup = document.getElementById('user-site-group');
  const siteSelect = document.getElementById('user-site-select');

  if (role === 'staff') {
    siteGroup.classList.remove('hidden');
    siteSelect.required = true;
  } else {
    siteGroup.classList.add('hidden');
    siteSelect.required = false;
  }
}

async function submitUser(e) {
  e.preventDefault();
  const alert = document.getElementById('user-modal-alert');
  alert.classList.add('hidden');

  const userId = document.getElementById('user-id-input').value;
  const username = document.getElementById('user-username-input').value.trim();
  const password = document.getElementById('user-password-input').value;
  const role = document.getElementById('user-role-select').value;
  const site_id = document.getElementById('user-site-select').value;

  const isEdit = Boolean(userId);
  const url = isEdit ? `/api/admin/users/${userId}` : '/api/admin/users';
  const method = isEdit ? 'PUT' : 'POST';

  try {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username,
        password: password || undefined,
        role,
        site_id: role === 'staff' ? site_id : null,
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      alert.textContent = data.error || 'Failed to save user.';
      alert.classList.remove('hidden');
      return;
    }

    closeModal('modal-user');
    loadAdminUsers();
  } catch (e) {
    alert.textContent = 'Server error saving user.';
    alert.classList.remove('hidden');
  }
}

async function deleteUser(userId, username) {
  if (!confirm(`Are you sure you want to delete user account "${username}"?`)) {
    return;
  }

  try {
    const res = await fetch(`/api/admin/users/${userId}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Failed to delete user.');
      return;
    }
    loadAdminUsers();
  } catch (e) {
    alert('Failed to delete user.');
  }
}

// Company Settings Admin
async function loadAdminSettings() {
  try {
    const res = await fetch('/api/admin/settings');
    if (!res.ok) return;
    const s = await res.json();

    document.getElementById('setting-name').value = s.company_name || '';
    document.getElementById('setting-address').value = s.company_address || '';
    document.getElementById('setting-phone').value = s.company_phone || '';
    document.getElementById('setting-email').value = s.company_email || '';
    document.getElementById('setting-footer').value = s.footer_note || '';
  } catch (e) {}
}

async function saveCompanySettings(e) {
  e.preventDefault();
  const alert = document.getElementById('settings-alert');
  alert.classList.add('hidden');

  const company_name = document.getElementById('setting-name').value.trim();
  const company_address = document.getElementById('setting-address').value.trim();
  const company_phone = document.getElementById('setting-phone').value.trim();
  const company_email = document.getElementById('setting-email').value.trim();
  const footer_note = document.getElementById('setting-footer').value.trim();

  try {
    const res = await fetch('/api/admin/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        company_name,
        company_address,
        company_phone,
        company_email,
        footer_note,
      }),
    });

    const data = await res.json();
    if (res.ok) {
      alert.textContent = 'Company settings saved successfully!';
      alert.classList.remove('hidden');
      loadCompanySettings();
      setTimeout(() => alert.classList.add('hidden'), 3000);
    }
  } catch (e) {
    alert.textContent = 'Failed to save settings.';
    alert.className = 'alert alert-danger';
    alert.classList.remove('hidden');
  }
}

// License & Seats Admin
async function loadAdminLicense() {
  try {
    const res = await fetch('/api/license/status');
    if (!res.ok) return;
    const lic = await res.json();
    state.license = lic;
    updateLicenseDisplay();

    document.getElementById('lic-customer').textContent = lic.customer_name || 'Evaluation User';
    document.getElementById('lic-type-tag').textContent = lic.is_trial ? 'Evaluation Trial' : 'Full Commercial License';
    document.getElementById('lic-seats').textContent = lic.seats;
    document.getElementById('lic-seats-usage').textContent = `${lic.active_seats_in_use} of ${lic.seats} seats active`;
    document.getElementById('lic-days-remaining').textContent = lic.is_expired ? 'EXPIRED' : `${lic.days_remaining} Days`;
    document.getElementById('lic-expiry-date').textContent = `Expires: ${new Date(lic.expires_at).toLocaleDateString()}`;
  } catch (e) {}
}

function openLicenseModal() {
  if (state.currentUser.role === 'admin') {
    switchView('admin');
    switchAdminTab('license');
  } else {
    alert(`Current License: ${state.license ? state.license.customer_name : 'Trial'} (${state.license ? state.license.seats : 1} seats). Only administrators can activate new keys.`);
  }
}

async function handleActivateLicense(e) {
  e.preventDefault();
  const alert = document.getElementById('license-activate-alert');
  alert.classList.add('hidden');

  const key = document.getElementById('license-key-input').value.trim();

  try {
    const res = await fetch('/api/license/activate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ license_key: key }),
    });

    const data = await res.json();
    if (!res.ok) {
      alert.className = 'alert alert-danger';
      alert.textContent = data.error || 'License activation failed.';
      alert.classList.remove('hidden');
      return;
    }

    alert.className = 'alert alert-success';
    alert.textContent = data.message;
    alert.classList.remove('hidden');
    document.getElementById('license-key-input').value = '';

    await loadAdminLicense();
  } catch (e) {
    alert.className = 'alert alert-danger';
    alert.textContent = 'Server error during key activation.';
    alert.classList.remove('hidden');
  }
}

// -------------------------------------------------------------
// Modal & Utility Helpers
// -------------------------------------------------------------
function openModal(id) {
  const m = document.getElementById(id);
  if (m) m.classList.remove('hidden');
}

function closeModal(id) {
  const m = document.getElementById(id);
  if (m) m.classList.add('hidden');
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function escapeAttr(str) {
  if (!str) return '';
  return String(str).replace(/'/g, "\\'").replace(/"/g, '&quot;');
}
