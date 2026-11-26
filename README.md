# Wellora Website + Double Opt-In Backend (v1.1)

This update preserves the previous Wellora frontend and its existing Node.js/Express + SQLite backend. It does NOT replace the backend with Keila.

## Included
- Existing multi-page Wellora design, responsive refinements and interactive signup states.
- Node.js 20+ / Express backend and SQLite subscriber database.
- Double opt-in with random 256-bit tokens, SHA-256 token hashes and 24-hour expiry.
- Unsubscribe endpoint and rate limits.
- Explicit consent checkbox enforced in both frontend and backend.
- Generic configurable SMTP via environment variables.
- Protected SMTP diagnostic endpoint.
- Helmet security headers. No public subscriber-list endpoint.

## Run locally
1. Install Node.js 20+.
2. Copy `.env.example` to `.env`.
3. Set `BASE_URL=http://localhost:3000` and valid SMTP values.
4. Run `npm install` then `npm start`.
5. Open `http://localhost:3000`.

## SMTP configuration
Required:
- `SMTP_HOST`: SMTP server hostname.
- `SMTP_PORT`: usually 587 (STARTTLS) or 465 (implicit TLS).
- `SMTP_SECURE`: `false` for 587; `true` for 465.
- `SMTP_USER`: SMTP login.
- `SMTP_PASS`: provider SMTP key/password or app password.
- `MAIL_FROM`: sender identity verified by the provider.

Recommended port 587:
```env
SMTP_HOST=smtp.your-provider.example
SMTP_PORT=587
SMTP_SECURE=false
SMTP_REQUIRE_TLS=true
SMTP_USER=your-smtp-login
SMTP_PASS=your-smtp-secret
MAIL_FROM="Wellora <newsletter@yourdomain.com>"
```
Port 465:
```env
SMTP_HOST=smtp.your-provider.example
SMTP_PORT=465
SMTP_SECURE=true
SMTP_REQUIRE_TLS=false
```

Provider examples (check current account-specific settings with the provider):
- Brevo: `smtp-relay.brevo.com`, port 587, SMTP login and SMTP key.
- Gmail: `smtp.gmail.com`, port 587, Google account and App Password (2-Step Verification required; availability depends on account policy).
- Do not use your normal Gmail password. Never commit `.env` or expose credentials in frontend code.

## Test SMTP
Set a strong random `ADMIN_API_TOKEN`. Then run:
```bash
curl -X POST http://localhost:3000/api/admin/smtp-test \
  -H "Content-Type: application/json" \
  -H "x-admin-token: YOUR_ADMIN_API_TOKEN" \
  -d '{"to":"you@example.com"}'
```
The endpoint verifies SMTP connectivity and attempts to send a test message. Use HTTPS in production and keep the token secret. `/api/health` only checks the web process, not email delivery.

## Double opt-in
Visitor submits email and explicitly agrees to receive Wellora email. Backend validates consent, stores a pending subscriber, sends a confirmation link, and changes status to confirmed only after a valid link is clicked. Link expires after 24 hours.

## Production requirements
- Node.js host that supports a continuously running Express app.
- `BASE_URL` set to the final HTTPS domain.
- Persistent disk for SQLite (`DB_FILE`).
- Verified sender domain and SPF, DKIM, DMARC records.
- HTTPS, strong admin token, backups and restore testing.
- SMTP acceptance does not guarantee inbox placement; monitor provider logs and spam placement.

## Scope
- This package keeps the existing custom backend. Keila is not installed or integrated.
- It handles signup, confirmation and unsubscribe; it does not include bulk campaign composition/sending or a full admin dashboard.
- SQLite on ephemeral/serverless filesystems can lose data; use persistent disk or migrate to managed PostgreSQL for multi-instance scale.
- Sample reviews are illustrative placeholders; replace with genuine permissioned feedback.
- Replace placeholder contact details and review legal pages before launch. Health content is informational, not medical advice.
