# Standalone License Key Generator

This is an **offline, vendor-only licensing tool**.

## Security Notice
- **DO NOT BUNDLE OR DEPLOY** this folder with the client application.
- The client application contains only the verification logic. It cannot generate licenses.
- The HMAC secret used here (`LICENSE_HMAC_SECRET`) must match the one configured on the target production deployment.

## Usage
Generate a 5-seat key valid for 1 year:
```bash
node generate-key.js --customer "Global Freight Corp" --seats 5 --days 365
```

Generate a 10-seat key with a custom HMAC secret:
```bash
node generate-key.js -c "Logistics Direct" -s 10 -d 180 --secret "your-production-secret"
```
