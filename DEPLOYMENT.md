# Deployment Guide: Inventory Tracker

This guide covers production deployment of **Inventory Tracker** for:
1. **Local Windows Server** with Microsoft SQL Server (or Postgres) & PM2/IIS
2. **Cloud Hosting** (Render, Railway, Fly.io, Cloud Run) with Managed PostgreSQL
3. **Production Pre-Flight & Go-Live Checklist**

---

## 1. Environment Architecture & Database Switching

The application uses **Knex.js** with an isolated database adapter layer (`lib/db.js`).  
You can switch databases using a single environment variable:

```env
# Database Engine: 'mssql' (SQL Server) or 'pg' (PostgreSQL)
DB_CLIENT=mssql
```

---

## 2. Windows Server Deployment (On-Premises / LAN)

### Prerequisites on Windows Server
- Windows Server 2016 / 2019 / 2022
- **Node.js LTS (v20+ or v22+)**: [Download Windows Installer (.msi)](https://nodejs.org/)
- **Microsoft SQL Server** (2016, 2019, 2022, or SQL Server Express)
- **Git for Windows** or extract ZIP to `C:\apps\inventory-tracker`

### Step 2.1: Prepare SQL Server Database
Open SQL Server Management Studio (SSMS) or `sqlcmd` and run:

```sql
CREATE DATABASE InventoryTracker;
GO

-- Create a dedicated application login
CREATE LOGIN inv_app_user WITH PASSWORD = 'StrongPassword987!';
GO

USE InventoryTracker;
GO

CREATE USER inv_app_user FOR LOGIN inv_app_user;
ALTER ROLE db_owner ADD MEMBER inv_app_user;
GO
```

Ensure SQL Server TCP/IP is enabled:
1. Open **Sql Server Configuration Manager**.
2. Go to **SQL Server Network Configuration** > **Protocols for MSSQLSERVER** (or SQLEXPRESS).
3. Ensure **TCP/IP** is **Enabled** (Default port `1433`).
4. Restart SQL Server service if TCP/IP was previously disabled.

### Step 2.2: Configure `.env` on Windows Server
In `C:\apps\inventory-tracker\.env`:

```env
PORT=3000
HOST=0.0.0.0
NODE_ENV=production

# Database Settings for SQL Server
DB_CLIENT=mssql
DB_HOST=127.0.0.1
DB_PORT=1433
DB_USER=inv_app_user
DB_PASSWORD=StrongPassword987!
DB_NAME=InventoryTracker
DB_ENCRYPT=false

# Security & Sessions
SESSION_SECRET=a_very_long_cryptographically_secure_random_string_here
LICENSE_HMAC_SECRET=your_custom_private_vendor_hmac_secret_key
```

### Step 2.3: Install Dependencies and Initialize Database
Open PowerShell as Administrator in `C:\apps\inventory-tracker`:

```powershell
# Install production dependencies (pure JavaScript, no C++ compilation needed)
npm install --omit=dev

# Run database schema migration & initial seed
npm run seed
```

### Step 2.4: Running as a Windows Service (via PM2)
To run the server continuously, restart on boot, and log errors:

```powershell
# Install PM2 globally
npm install -g pm2
npm install -g pm2-windows-service

# Start the application with PM2
pm2 start server.js --name "inventory-tracker"

# Configure PM2 to start on Windows boot
pm2-service-install
pm2 save
```

### Step 2.5: (Optional) Expose via IIS Reverse Proxy
If users on your corporate LAN access the server via port 80/443:
1. Install **IIS** with **URL Rewrite** and **Application Request Routing (ARR)** modules.
2. In IIS Manager, enable Proxy in ARR.
3. Add a Reverse Proxy rule pointing inbound traffic to `http://localhost:3000`.

---

## 3. Cloud Deployment (PostgreSQL on Render / Railway / Fly.io)

### Managed PostgreSQL Setup
1. Create a managed PostgreSQL database instance (e.g. Render Postgres or Railway Postgres).
2. Note the database credentials or standard connection URL.

### Environment Variables for Cloud Hosting

| Variable | Recommended Production Value |
|---|---|
| `NODE_ENV` | `production` |
| `PORT` | `3000` (or injected by cloud provider) |
| `DB_CLIENT` | `pg` |
| `DB_HOST` | `<your-cloud-postgres-hostname>` |
| `DB_PORT` | `5432` |
| `DB_USER` | `<your-db-username>` |
| `DB_PASSWORD` | `<your-db-password>` |
| `DB_NAME` | `<your-db-database-name>` |
| `DB_SSL` | `true` |
| `SESSION_SECRET` | 64-character random string |
| `LICENSE_HMAC_SECRET` | Secret key shared only with your license generator |

### Cloud Build and Start Commands
- **Build Command**: `npm install --omit=dev && npm run seed`
- **Start Command**: `node server.js`

The application automatically runs schema initialization and migrations idempotently upon server launch.

---

## 4. Standalone License Generator Usage

> **CRITICAL SECURITY NOTE:**  
> The `license-keygen/` directory is an isolated vendor utility.  
> **DO NOT** deploy this folder to client servers or public cloud containers.

To issue a commercial license key for a customer:

```bash
cd license-keygen

# Issue 5 concurrent seats valid for 365 days
node generate-key.js --customer "Apex Logistics Ltd" --seats 5 --days 365
```

Output:
```text
===============================================================
  INVENTORY TRACKER — OFFICIAL SIGNED LICENSE KEY GENERATOR   
===============================================================
Customer:       Apex Logistics Ltd
Seats:          5 concurrent user(s)
Issued:         2026-09-12T...
Expires:        2027-09-12T... (365 days)
---------------------------------------------------------------
LICENSE KEY (Copy and paste into Admin > License Activation):

LIC-eyJjdXN0b21lciI6IkFwZXggTG9naXN0aWNzIEx0ZCIsInNlYXRzIjo1LCJpc3N1ZWQiOiIyMDI2LTA5LTEyVDE1OjI2OjM5LjMzMloiLCJleHBpcmVzIjoiMjAyNy0wOS0xMlQxNToyNjozOS4zMzJaIn0.4a3b...

===============================================================
```

Log in as `admin`, navigate to **⚙️ Administration > 🔑 License & Seats**, paste the key, and click **Activate License**.

---

## 5. Pre-Flight Go-Live Checklist

Before putting the system into active production use:

- [ ] **1. Change Default Passwords**:
  - Log in with `admin / admin123`
  - Navigate to **⚙️ Administration > 👥 Users**
  - Change password for `admin` and `staff1`, or create custom users and remove defaults.
- [ ] **2. Configure Company Settings**:
  - Navigate to **⚙️ Administration > 🏢 Company Settings**
  - Set Company Name, Address, Phone, Email, and Dispatch Note footer text (these appear on official PDF prints).
- [ ] **3. Set Warehouse Sites**:
  - Navigate to **⚙️ Administration > 🏢 Sites**
  - Rename or create your physical warehouses and distribution docks.
- [ ] **4. Configure Catalog SKUs**:
  - Navigate to **⚙️ Administration > 🏷️ Items Catalog**
  - Add your item SKUs, descriptions, units of measure, and reorder warning levels.
- [ ] **5. Rotate Cryptographic Secrets**:
  - Ensure `SESSION_SECRET` is set to a secure, random string in `.env`.
  - Ensure `LICENSE_HMAC_SECRET` is set and matches the vendor key generator.
- [ ] **6. Activate Production License**:
  - Default deployment starts in a 30-day evaluation trial (1 seat).
  - Activate your commercial license key to unlock your licensed concurrent seat count.
- [ ] **7. Setup Automated Database Backups**:
  - **SQL Server**: Configure SQL Server Agent for daily database backup maintenance plans.
  - **PostgreSQL**: Configure automated pg_dump cron jobs or cloud snapshot policies.
