# Texas Struck-off Property CRM

A micro CRM for managing outreach to Texas county tax assessor-collectors regarding struck-off and tax-trust property inventories.

## Overview

This app helps manage email outreach to all 254 Texas counties on a ~90-day follow-up cadence. It tracks contact information, outreach status, and maintains a send log while respecting daily send limits.

**Key Features:**
- Pre-seeded with all 254 Texas counties (including FIPS codes)
- CSV import for tax assessor-collector contact information
- Email template with merge fields (county, TAC name, TAC email)
- SMTP-only email sending (works with cPanel/NixiHost mailboxes)
- Daily send cap (default: 5 emails per day)
- Automatic follow-up scheduling (90 days after send)
- Pipeline tracking: Not contacted → Emailed → Replied → List received → Offer in play → Closed
- Simple password authentication
- SQLite database (no hosted database required)

## IMPORTANT: Email Configuration

**This app uses SMTP ONLY.** It is designed to work with cPanel/NixiHost mailboxes and similar hosting providers.

**DO NOT USE:**
- Gmail
- Google APIs
- Google OAuth
- Any Google mail integration

**Use SMTP from your own domain mailbox.**

## Installation

### Prerequisites
- Node.js 16+ and npm

### Setup

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
# Set your app password (used for login)
APP_PASSWORD=your_secure_password_here

# SMTP Settings for cPanel/NixiHost mailbox
# For cPanel: host is typically mail.yourdomain.tld
SMTP_HOST=mail.yourdomain.tld
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=james@yourdomain.tld
SMTP_PASS=your_email_password
SMTP_FROM=james@yourdomain.tld
SMTP_FROM_NAME=James McHugh

# Daily send limit (default: 5)
SEND_DAILY_CAP=5
```

### cPanel/NixiHost SMTP Configuration

For cPanel or NixiHost email accounts, use these typical settings:

**SSL (Recommended):**
- Host: `mail.yourdomain.tld`
- Port: `465`
- Secure: `true`

**STARTTLS (Alternative):**
- Host: `mail.yourdomain.tld`
- Port: `587`
- Secure: `false` (STARTTLS will be used)

**Finding Your Mail Server:**
1. Log into cPanel
2. Go to Email Accounts
3. Look for "Mail Client Configuration" or "Configure Email Client"
4. Use the server hostname shown (typically `mail.yourdomain.tld`)

**Authentication:**
- Username: Your full email address (e.g., `james@yourdomain.tld`)
- Password: Your email account password

4. Seed the database with all 254 Texas counties:
```bash
npm run seed
```

5. Start the development server:
```bash
npm run dev
```

6. Open your browser to `http://localhost:3000` and login with your `APP_PASSWORD`.

## Usage

### First Time Setup

1. After seeding, all 254 Texas counties will be in the database with "Not contacted" status
2. Import TAC contact information using CSV (see CSV Import section)
3. Customize the email template if needed (Templates menu)

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
3. **Replied** - TAC responded to inquiry
4. **List received** - Received struck-off inventory list
5. **Offer in play** - Submitted offer on property/properties
6. **Closed** - Deal completed or outreach ended

### Email Template

The default template includes:
- Merge fields: `{{county}}`, `{{tac_name}}`, `{{tac_email}}`
- Professional inquiry about struck-off inventory
- Questions about title trust and Texas Tax Code §34.05
- Request for offer submission process

Edit the template via the "Edit Email Template" link on the dashboard.

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
- SMTP configuration (uses mock transporter in test mode)

## Security Notes

- **Authentication**: Simple password-based login via `APP_PASSWORD` environment variable
- **SMTP Credentials**: Never commit your `.env` file (it's in `.gitignore`)
- **No Email in Tests**: Tests use a mock transporter; no actual emails are sent during testing
- If exposing this app to the internet, use a strong password and consider additional security measures

## Project Structure

```
.
├── server.js              # Express server and routes
├── database.js            # SQLite database layer
├── email-service.js       # SMTP email sending logic
├── test.js               # Test suite
├── scripts/
│   └── seed.js           # County seeding script (all 254 Texas counties)
├── public/
│   └── styles.css        # UI styles
├── package.json          # Dependencies
├── .env.example          # Environment template
└── README.md             # This file
```

## Development

**Start development server with auto-reload:**
```bash
npm run dev
```

**Production mode:**
```bash
npm start
```

## Deployment

This app is designed to run locally but can be deployed to any Node.js hosting environment:

1. Set environment variables on your hosting platform
2. Run `npm install --production`
3. Run `npm run seed` to initialize the database
4. Run `npm start`

The SQLite database (`crm.db`) will be created in the project root. Back it up regularly.

## Texas Counties

All 254 Texas counties are pre-configured with:
- County name
- County seat
- FIPS code (5-digit: 48XXX format)

FIPS codes follow the official U.S. Census Bureau standard for Texas (state code 48).

## Why SMTP-Only?

This app is built for **paced, human-controlled outreach** using a mailbox you own and control:
- Sends from your domain (better deliverability)
- No OAuth complexity or API limits
- Works with standard cPanel/NixiHost hosting
- Full control over sending behavior
- No dependency on third-party services

**Never use this with Gmail or automated bulk sending services.**

## Support

For issues or questions, refer to the code comments or raise an issue in the repository.

## License

ISC
