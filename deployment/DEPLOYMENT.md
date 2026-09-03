# Wild Boar Creek CRM Deployment Guide

## Prerequisites

1. Node.js 16+ installed on the VPS
2. Nginx installed and running
3. SSL certificate for wildboarcreek.com (Let's Encrypt recommended)
4. Non-root user (e.g., `nodejs`) to run the application
5. Resend account with API key

## Installation Steps

### 1. Deploy Application Files

```bash
# Create application directory
sudo mkdir -p /home/nodejs/wildboarcreek-crm
sudo chown nodejs:nodejs /home/nodejs/wildboarcreek-crm

# Upload or clone your application
cd /home/nodejs/wildboarcreek-crm
# (transfer files or git clone)

# Install dependencies
npm install --production
```

### 2. Configure Environment

Create `/home/nodejs/wildboarcreek-crm/.env`:

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
FOLLOWUP_AUTOSEND=false

# Inbound Webhook Secret
WEBHOOK_SECRET=your_random_webhook_secret_here

# App Settings
PORT=3000
NODE_ENV=production
SESSION_SECRET=your_random_session_secret_here
```

**Generate secure secrets:**
```bash
# Generate random secrets
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 3. Seed the Database

```bash
cd /home/nodejs/wildboarcreek-crm
npm run seed
```

This will create `crm.db` with all 254 Texas counties.

### 4. Set Up Systemd Service

```bash
# Copy service file
sudo cp deployment/wildboarcreek-crm.service /etc/systemd/system/

# Create log directory
sudo mkdir -p /var/log/wildboarcreek-crm
sudo chown nodejs:nodejs /var/log/wildboarcreek-crm

# Reload systemd
sudo systemctl daemon-reload

# Enable and start service
sudo systemctl enable wildboarcreek-crm
sudo systemctl start wildboarcreek-crm

# Check status
sudo systemctl status wildboarcreek-crm
```

### 5. Configure Nginx

**Important:** The public Wild Boar Creek landing page should remain at `/var/www/wildboarcreek.com/public/index.html`. The CRM is only accessible via `/login` and `/app`.

```bash
# Copy nginx config
sudo cp deployment/nginx-wildboarcreek.conf /etc/nginx/sites-available/wildboarcreek.com

# Edit paths in the config
sudo nano /etc/nginx/sites-available/wildboarcreek.com
# Update SSL certificate paths and root directory

# Enable site
sudo ln -s /etc/nginx/sites-available/wildboarcreek.com /etc/nginx/sites-enabled/

# Test nginx config
sudo nginx -t

# Reload nginx
sudo systemctl reload nginx
```

### 6. Configure Resend Inbound Webhook

In your Resend dashboard:

1. Go to **Domains** → **wildboarcreek.com** → **Inbound**
2. Add an inbound rule:
   - **Match:** all emails to your domain (or specific addresses)
   - **Forward to:** `https://wildboarcreek.com/inbound`
   - **Custom Header:** `X-Webhook-Secret: your_webhook_secret_here`

When a TAC replies to an outreach email, Resend will POST to `/inbound` and the CRM will:
- Match the sender email to a county
- Update status to "Replied"
- Clear the follow-up date

## Verify Installation

1. **Public homepage:** Visit https://wildboarcreek.com - should show the Wild Boar Creek landing page
2. **CRM login:** Visit https://wildboarcreek.com/login - should show staff login
3. **Login:** Use james@wildboarcreek.com with your STAFF_PASSWORD
4. **Dashboard:** Should redirect to /app after successful login

## Maintenance

### View Logs

```bash
# Application logs
sudo journalctl -u wildboarcreek-crm -f

# Or from log files
tail -f /var/log/wildboarcreek-crm/app.log
tail -f /var/log/wildboarcreek-crm/error.log
```

### Restart Service

```bash
sudo systemctl restart wildboarcreek-crm
```

### Update Application

```bash
cd /home/nodejs/wildboarcreek-crm
git pull  # or upload new files
npm install --production
sudo systemctl restart wildboarcreek-crm
```

### Backup Database

```bash
# Backup crm.db regularly
cp /home/nodejs/wildboarcreek-crm/crm.db /backups/crm-$(date +%Y%m%d).db
```

## Security Checklist

- ✅ Application runs on localhost (127.0.0.1) only
- ✅ Nginx proxies /login, /app, /inbound to the Node app
- ✅ Public homepage at / serves static files (not the CRM)
- ✅ Strong STAFF_PASSWORD and SESSION_SECRET
- ✅ WEBHOOK_SECRET for inbound email authentication
- ✅ HTTPS enforced via Nginx
- ✅ No .env file in git repository

## Troubleshooting

**Service won't start:**
```bash
sudo systemctl status wildboarcreek-crm
sudo journalctl -u wildboarcreek-crm -n 50
```

**Can't access /login:**
- Check nginx config: `sudo nginx -t`
- Verify service is running: `curl http://127.0.0.1:3000/login`
- Check nginx logs: `sudo tail -f /var/log/nginx/wildboarcreek.error.log`

**Inbound webhook not working:**
- Verify WEBHOOK_SECRET matches Resend configuration
- Check application logs for inbound POST requests
- Test with curl: `curl -X POST -H "X-Webhook-Secret: your_secret" -H "Content-Type: application/json" -d '{"from":"test@example.com"}' https://wildboarcreek.com/inbound`
