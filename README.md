# Wild Boar Creek CRM

A micro CRM for managing outreach to Texas county tax assessor-collectors regarding struck-off and tax-trust property inventories.

## Overview

This staff-only application helps James McHugh manage email outreach to all 254 Texas counties on a ~90-day follow-up cadence. It tracks contact information, outreach status, and maintains a send log while respecting daily send limits.

**Key Features:**
- Pre-seeded with all 254 Texas counties (including FIPS codes)
- CSV import for tax assessor-collector contact information
- Email template with merge fields (county, TAC name, TAC email)
- **Resend HTTP API** for email sending (no SMTP, no Gmail, no Google)
- Daily send cap (default: 5 emails per day)
- Automatic 90-day follow-up scheduling
- Inbound webhook for email replies (auto-marks counties as "Replied")
- Pipeline tracking: Not contacted → Emailed → Replied → List received → Offer in play → Closed
- Email + password authentication
- SQLite database (no hosted database required)
- Production-ready with systemd + nginx configuration

## IMPORTANT: Email Configuration

**This app uses Resend HTTP API ONLY.** No SMTP. No Gmail. No Google APIs. No Google OAuth.

### Why Resend?

- **HTTP API** - Simple REST calls, no SMTP complexity
- **Domain sending** - Sends from james@wildboarcreek.com
- **Inbound webhooks** - Automatically processes replies
- **Better deliverability** - SPF/DKIM/DMARC configured at the domain level
- **No Gmail dependency** - Completely independent from Google

Get your API key at [resend.com/api-keys](https://resend.com/api-keys).

## Installation

### Prerequisites
- Node.js 16+ and npm
- Resend account with verified domain (wildboarcreek.com)

### Local Development Setup

1. Clone this repository and install dependencies:
```bash
npm install
```

2. Copy the example environment file:
```bash
cp .env.example .env
```

3. Edit `.env` and configure your settings:
```bash
# Staff Authentication
STAFF_EMAIL=james@wildboarcreek.com
STAFF_PASSWORD=your_secure_password_here

# Resend Email API
RESEND_API_KEY=re_your_resend_api_key_here
MAIL_FROM=james@wildboarcreek.com

# Send Limits
SEND_DAILY_CAP=5

# Follow-up Auto-send (default: false)
# Set to true ONLY if you want 90-day follow-ups to send automatically
FOLLOWUP_AUTOSEND=false

# Inbound Webhook Secret
WEBHOOK_SECRET=your_random_webhook_secret_here

# App Settings
PORT=3000
NODE_ENV=development
SESSION_SECRET=your_random_session_secret_here
```

4. Seed the database with all 254 Texas counties:
```bash
npm run seed
```

5. Start the development server:
```bash
npm run dev
```

6. Open your browser to `http://localhost:3000/login` and login with your staff email and password.

## Usage

### First Time Setup

1. After seeding, all 254 Texas counties will be in the database with "Not contacted" status
2. **Review and customize the email template** (Templates menu) - James must sign off on this before any emails are sent
3. Import TAC contact information using CSV (see CSV Import section below)

### Important: Email Sending Rules

**The first 254 outreach emails MUST only send when James clicks "Send" on a specific county.**

- No bulk blast button
- No automatic sends on the initial wave
- Preview required before every send
- Daily cap enforced (default: 5)

**90-day follow-ups:**
- Automatically scheduled (next_follow_up = sent_at + 90 days)
- Will NOT auto-send unless `FOLLOWUP_AUTOSEND=true` (default: false)
- Follow-ups appear in the "Due Follow-up" queue for manual review

### Sending Emails

1. Navigate to a county detail page
2. Ensure TAC email is populated
3. Click "Preview Email" to review the merged content
4. Click "Send Email Now" to send (requires confirmation)
5. After sending:
   - Status changes to "Emailed"
   - Last emailed date is set to today
   - Next follow-up is automatically set to 90 days from today
   - Send is logged in the county's history

**Daily Send Cap:** The app enforces a daily send limit (default: 5). Once reached, the send button is disabled until the next day.

### CSV Import

Import TAC contact information via CSV with these columns:

| Column | Required | Description |
|--------|----------|-------------|
| `county` | Yes | County name (must match existing county) |
| `tac_name` | No | Tax Assessor-Collector name |
| `tac_email` | No | TAC email address |
| `tac_phone` | No | TAC phone number |
| `firm` | No | Collection firm name |
| `notes` | No | Internal notes |

**Example CSV:**
```csv
county,tac_name,tac_email,tac_phone,firm,notes
Harris,John Smith,john.smith@co.harris.tx.us,(713) 555-0100,Smith & Associates,Primary contact
Dallas,Jane Doe,jane.doe@dallascounty.org,(214) 555-0200,,"Prefers email"
```

Download a sample CSV from the Import page in the app.

### Dashboard Views

- **Not Contacted**: Counties that haven't been emailed yet
- **Due Follow-up**: Counties where next_followup date ≤ today (excludes Closed)
- **Waiting (Emailed)**: Counties with status "Emailed"
- **Has Inventory**: Counties with an inventory received date

### Pipeline Statuses

1. **Not contacted** - Initial state, no outreach yet
2. **Emailed** - Email sent, awaiting response
3. **Replied** - TAC responded to inquiry (auto-set via inbound webhook)
4. **List received** - Received struck-off inventory list
5. **Offer in play** - Submitted offer on property/properties
6. **Closed** - Deal completed or outreach ended

### Email Template

The default template includes:
- Merge fields: `{{county}}`, `{{tac_name}}`, `{{tac_email}}`
- Professional inquiry about struck-off inventory
- Questions about title trust and Texas Tax Code §34.05
- Request for offer submission process

**Important:** James should review and customize this template before sending any emails. Edit via the "Edit Email Template" link on the dashboard.

### Inbound Email Handling

When a TAC replies to an outreach email, the CRM automatically:
1. Receives the reply via Resend's inbound webhook (`POST /inbound`)
2. Matches the sender email to the county
3. Updates the county status to "Replied"
4. Clears the follow-up date (no need to follow up if they replied)

**Setup:** Configure in your Resend dashboard under Domains → wildboarcreek.com → Inbound.

## Production Deployment

This app is designed to sit behind `https://wildboarcreek.com/login/` on a NixiHost VPS, while the public Wild Boar Creek landing page remains at the root.

### Architecture

- **Public homepage:** Nginx serves static files at `/` (the Wild Boar Creek ranch page)
- **CRM login:** Nginx proxies `/login` to Node app on `127.0.0.1:3000`
- **CRM app:** Nginx proxies `/app/*` to Node app
- **Inbound webhook:** Nginx proxies `/inbound` to Node app

See `deployment/DEPLOYMENT.md` for complete production setup instructions including:
- Systemd service configuration
- Nginx reverse proxy setup
- SSL certificate configuration
- Environment variable setup
- Database seeding

Quick deployment:
```bash
# Install and seed
npm install --production
npm run seed

# Configure systemd service
sudo cp deployment/wildboarcreek-crm.service /etc/systemd/system/
sudo systemctl enable wildboarcreek-crm
sudo systemctl start wildboarcreek-crm

# Configure nginx
sudo cp deployment/nginx-wildboarcreek.conf /etc/nginx/sites-available/wildboarcreek.com
# Edit paths in config, then:
sudo ln -s /etc/nginx/sites-available/wildboarcreek.com /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

## Testing

Run the test suite to verify send cap logic, follow-up date calculations, and data integrity:

```bash
npm test
```

Tests verify:
- 90-day follow-up date calculation
- Email template merge functionality
- Daily send cap enforcement
- All 254 Texas counties are seeded with FIPS codes
- CSV structure validation
- Resend configuration (uses mock client in test mode)
- Inbound email matching (case-insensitive)
- Reply status updates

**Important:** Tests use a mock Resend client. No actual emails are sent during testing.

## Security Notes

- **Authentication**: Email + password login via `STAFF_EMAIL` and `STAFF_PASSWORD` environment variables
- **Session cookies**: httpOnly, secure in production
- **Resend API key**: Never commit to repository (in `.gitignore`)
- **Webhook secret**: Validates inbound POST requests from Resend
- **Localhost binding**: In production, app binds to `127.0.0.1` (not public)
- **Nginx proxy**: Public access only via specific routes (`/login`, `/app`, `/inbound`)

If exposing this app, ensure:
- Strong `STAFF_PASSWORD` and `SESSION_SECRET`
- HTTPS enforced via Nginx
- `WEBHOOK_SECRET` matches Resend configuration
- Regular database backups

## Project Structure

```
.
├── server.js              # Express server with all routes and UI
├── database.js            # SQLite database layer
├── email-service.js       # Resend email sending and template merging
├── scripts/
│   └── seed.js           # Seeds all 254 Texas counties with FIPS codes
├── test.js               # Test suite (9 tests)
├── public/
│   └── styles.css        # UI styles (Wild Boar Creek branding)
├── deployment/
│   ├── wildboarcreek-crm.service  # Systemd service unit
│   ├── nginx-wildboarcreek.conf   # Nginx configuration
│   └── DEPLOYMENT.md              # Production deployment guide
├── package.json          # Dependencies and scripts
├── .env.example          # Environment template
└── README.md             # This file
```

## Environment Variables

### Required

- `STAFF_EMAIL` - Staff login email (default: james@wildboarcreek.com)
- `STAFF_PASSWORD` - Staff login password
- `RESEND_API_KEY` - Resend API key (get from resend.com)
- `MAIL_FROM` - Sender email address (james@wildboarcreek.com)

### Optional

- `SEND_DAILY_CAP` - Daily send limit (default: 5)
- `FOLLOWUP_AUTOSEND` - Auto-send 90-day follow-ups (default: false)
- `WEBHOOK_SECRET` - Inbound webhook authentication
- `PORT` - Server port (default: 3000)
- `NODE_ENV` - Environment (development/production/test)
- `SESSION_SECRET` - Session cookie secret

## Development

**Start development server with auto-reload:**
```bash
npm run dev
```

**Production mode:**
```bash
NODE_ENV=production npm start
```

**Run tests:**
```bash
npm test
```

## Texas Counties

All 254 Texas counties are pre-configured with:
- County name
- County seat
- FIPS code (5-digit: 48XXX format)

FIPS codes follow the official U.S. Census Bureau standard for Texas (state code 48).

## Why No Gmail / Google?

This app is built for **paced, human-controlled outreach** using a mailbox on your own domain:

✅ **Resend advantages:**
- HTTP API (no SMTP complexity)
- Better deliverability (domain-based)
- Inbound webhook support
- No OAuth complexity
- Full control over sending behavior

❌ **Never use:**
- Gmail SMTP
- Google APIs
- Google OAuth
- Any Google mail integration
- Automated bulk sending services

**This is a deliberate design choice** to ensure proper outreach practices and maintain sender reputation.

## Maintenance

### View Logs

```bash
# Application logs (production)
sudo journalctl -u wildboarcreek-crm -f
```

### Restart Service

```bash
sudo systemctl restart wildboarcreek-crm
```

### Backup Database

```bash
# Backup crm.db regularly
cp crm.db crm-backup-$(date +%Y%m%d).db
```

The SQLite database (`crm.db`) contains all counties, contacts, and send history. Back it up regularly.

## Troubleshooting

**Can't login:**
- Check `STAFF_EMAIL` and `STAFF_PASSWORD` in `.env`
- Verify session secret is set

**Emails not sending:**
- Verify `RESEND_API_KEY` is valid
- Check Resend dashboard for delivery status
- Look for errors in application logs

**Inbound webhook not working:**
- Verify `WEBHOOK_SECRET` matches Resend configuration
- Check Resend dashboard → Domains → Inbound settings
- Test webhook with curl (see DEPLOYMENT.md)

**Daily cap not resetting:**
- Cap resets at midnight UTC
- Check system timezone

## Support

For issues or questions, refer to:
- Code comments in source files
- `deployment/DEPLOYMENT.md` for production setup
- Test suite (`test.js`) for examples

## License

ISC
