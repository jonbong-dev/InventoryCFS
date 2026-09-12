# Inventory Tracker — Project Backlog

## Phase 1 — Foundation
- [ ] Backend architecture: Node.js + Express, plain CommonJS (`require`), zero client framework / bundlers
- [ ] Database layer (`lib/db.js`): Knex query builder supporting Postgres (`pg`), SQL Server (`tedious`), and disposable SQLite (`sqlite3`) via `DB_CLIENT` env var
- [ ] Engine-agnostic unique constraint helper (`lib/db-errors.js` for Postgres 23505, MSSQL 2601/2627, SQLite 19)
- [ ] Database schema & migrations:
  - `sites` (id, name, created_at, updated_at)
  - `users` (id, username, password_hash, role: admin/staff, site_id, created_at, updated_at)
  - `items` (id, sku, description, unit, reorder_level, created_at, updated_at)
  - `purchase_orders` (id, po_number, site_id, status, notes, created_at, updated_at)
  - `documents` (id, doc_type: collection_note/delivery_note, doc_number, site_id, customer_or_supplier, po_number, notes, created_by_user_id, created_at)
  - `stock_movements` (append-only ledger: id, item_id, site_id, movement_type: IN/OUT, qty, po_id, document_id, created_by_user_id, notes, created_at)
  - `settings` (key, value, updated_at)
  - `license_state` (id, license_key, customer_name, seats, expires_at, activated_at)
  - Derived `stock_levels` view / computed query summing the ledger (current qty on hand = sum of IN - OUT, never stored directly)
- [ ] Idempotent schema creation + seed script (`scripts/migrate-and-seed.js`) safe to re-run anytime
- [ ] Session-based authentication with `express-session` & `bcryptjs`
- [ ] Basic auth routes: Login, Logout, Session state check

## Phase 2 — Core Workflows
- [ ] Record stock movement (item + site + IN/OUT + qty + optional PO number) with site permission validation
- [ ] Create Collection Note / Delivery Note: Single database transaction inserting document row (with unique temp placeholder before ID sequence assignment for SQL Server compatibility) + stock movement lines
- [ ] Printable PDF generation using `pdfkit`:
  - Company header (name, address from settings)
  - Date, site, PO number, doc type, sequential number
  - Clean line items table
  - Signature blocks (authorized by, received by, date)
  - Optional footer note
- [ ] Stock levels screen: current qty on hand per item per site, alert on reorder level
- [ ] Raw stock movement ledger history log with filtering by site, item, type, and date

## Phase 3 — Admin & Access Control
- [ ] Sites management: list, create, rename
- [ ] Items management: list, create, edit, reorder levels
- [ ] Purchase Orders: list, create, link to site
- [ ] User management: create, edit, delete; roles: admin (all sites) and staff (strictly restricted to assigned site for any write action, server-side enforced)
- [ ] Company settings: company name, address, default footer notes for PDF documents

## Phase 4 — Licensing Subsystem
- [ ] HMAC-SHA256 self-contained license key scheme (no phone-home) encoding customer name, issue date, expiry date, seat count
- [ ] Separate standalone license generator project (`license-keygen/` with its own `package.json` and CLI tool) strictly isolated outside the deployable runtime app
- [ ] Auto-activating 30-day, 1-seat default trial license on fresh install
- [ ] Seat management: concurrent login tracking, evicting oldest session when seat limit is exceeded; re-login by same user replaces existing session without consuming extra seat
- [ ] Admin license UI: view license validity, customer name, expiry, seat usage, and form to activate new license key

## Phase 5 — Reporting
- [ ] Combined Inventory Report view: current stock levels + full item catalog + reorder status
- [ ] Inventory report export as downloadable PDF
- [ ] Inventory report export as downloadable CSV

## Phase 6 — Polish & Deployment
- [ ] Clean, fast, mobile-responsive UI (~375px verified) with pure CSS / Tailwind utility classes, high contrast, clean data tables, responsive action drawers/modals
- [ ] Automated smoke-test suite (`npm test`) using `supertest` covering:
  - Authentication & session eviction
  - Site, item, user CRUD
  - Staff site restriction enforcement
  - Document creation transaction & ledger synchronization
  - Derived stock levels calculation
  - License validation & trial activation
- [ ] Comprehensive deployment documentation (`DEPLOYMENT.md`):
  - Free cloud hosting setup (e.g. Render, Railway, Fly.io, Cloud Run)
  - Local Windows Server deployment as Windows Service via NSSM
  - Explicit tradeoffs analysis (local network reachability vs cloud accessibility)
