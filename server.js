require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const multer = require('multer');
const fs = require('fs');

const db = require('./database');
const emailService = require('./email-service');

const app = express();
const PORT = process.env.PORT || 3000;
const STAFF_EMAIL = process.env.STAFF_EMAIL || 'james@wildboarcreek.com';
const STAFF_PASSWORD = process.env.STAFF_PASSWORD || process.env.APP_PASSWORD || 'changeme123';
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'change-this-secret';

// Initialize database
db.initDatabase();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Session middleware for auth
app.use(session({
  secret: process.env.SESSION_SECRET || 'texas-crm-secret-key-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: { 
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production'
  }
}));

// Auth middleware
function requireAuth(req, res, next) {
  if (req.session.authenticated) {
    return next();
  }
  res.redirect('/login');
}

// Setup multer for CSV uploads
const upload = multer({ dest: 'uploads/' });

// Helper: render HTML page with Wild Boar Creek styling
function renderPage(title, content, showNav = true) {
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${title} - Wild Boar Creek CRM</title>
      <link rel="preconnect" href="https://fonts.googleapis.com">
      <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
      <link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600;9..144,700&family=Outfit:wght@300;400;500;600&display=swap" rel="stylesheet">
      <link rel="stylesheet" href="/styles.css">
    </head>
    <body>
      ${showNav ? `
        <nav>
          <h1>Wild Boar Creek CRM</h1>
          <div class="nav-links">
            <a href="/app">Dashboard</a> |
            <a href="/app/counties">Counties</a> |
            <a href="/logout">Logout</a>
          </div>
        </nav>
      ` : ''}
      ${content}
    </body>
    </html>
  `;
}

// Routes

// Login page
app.get('/login', (req, res) => {
  if (req.session.authenticated) {
    return res.redirect('/app');
  }
  
  const content = `
    <div class="container">
      <div class="login-box">
        <div class="logo">
          <svg width="80" height="80" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="50" cy="50" r="45" fill="#002147"/>
            <path d="M 30 60 Q 40 40, 50 50 Q 60 60, 70 40" stroke="#f7f3ea" stroke-width="3" fill="none"/>
            <circle cx="42" cy="45" r="3" fill="#f7f3ea"/>
            <circle cx="58" cy="45" r="3" fill="#f7f3ea"/>
          </svg>
        </div>
        <h1>Wild Boar Creek</h1>
        <p class="tagline">Staff Login</p>
        ${req.query.error ? '<p class="error">Invalid email or password</p>' : ''}
        <form method="POST" action="/login">
          <label>Email</label>
          <input type="email" name="email" placeholder="james@wildboarcreek.com" required autofocus value="${STAFF_EMAIL}">
          <label>Password</label>
          <input type="password" name="password" placeholder="Password" required>
          <button type="submit">Login</button>
        </form>
      </div>
    </div>
  `;
  
  res.send(renderPage('Login', content, false));
});

app.post('/login', (req, res) => {
  const { email, password } = req.body;
  if (email === STAFF_EMAIL && password === STAFF_PASSWORD) {
    req.session.authenticated = true;
    req.session.email = email;
    res.redirect('/app');
  } else {
    res.redirect('/login?error=1');
  }
});

app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});

// Inbound webhook for email replies
app.post('/inbound', (req, res) => {
  // Verify webhook secret
  const secret = req.headers['x-webhook-secret'] || req.headers['authorization'];
  if (secret !== WEBHOOK_SECRET && secret !== `Bearer ${WEBHOOK_SECRET}`) {
    console.log('Invalid webhook secret');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { from, to, subject, text, date } = req.body;
  
  if (!from) {
    return res.status(400).json({ error: 'Missing from field' });
  }

  // Extract email address from "Name <email@domain.com>" format
  const emailMatch = from.match(/<(.+?)>/) || [null, from];
  const senderEmail = emailMatch[1].toLowerCase().trim();

  console.log(`Inbound email from: ${senderEmail}`);

  // Find county by TAC email
  const county = db.getCountyByEmail(senderEmail);
  
  if (county) {
    console.log(`Matched to ${county.name} County`);
    
    // Update county status to Replied and clear follow-up
    db.updateCounty(county.id, {
      outreach_status: 'Replied',
      next_followup: null
    });

    // Log the inbound email (you could add an inbound_logs table if needed)
    console.log(`County ${county.name} marked as Replied`);
    
    return res.json({ 
      success: true, 
      county: county.name,
      message: 'County marked as Replied'
    });
  } else {
    console.log(`No county found for email: ${senderEmail}`);
    return res.json({ 
      success: false, 
      message: 'No matching county found' 
    });
  }
});

// Home redirect
app.get('/', (req, res) => {
  if (req.session.authenticated) {
    res.redirect('/app');
  } else {
    res.redirect('/login');
  }
});

// Dashboard
app.get('/app', requireAuth, (req, res) => {
  const stats = db.getDashboardStats();
  
  const content = `
    <div class="container">
      <h2>Dashboard</h2>
      
      <div class="stats-grid">
        <div class="stat-card">
          <h3>${stats.notContacted}</h3>
          <p>Not Contacted</p>
          <a href="/app/counties?filter=not_contacted">View</a>
        </div>
        
        <div class="stat-card highlight">
          <h3>${stats.dueFollowup}</h3>
          <p>Due Follow-up</p>
          <a href="/app/counties?filter=due_followup">View</a>
        </div>
        
        <div class="stat-card">
          <h3>${stats.waiting}</h3>
          <p>Waiting (Emailed)</p>
          <a href="/app/counties?filter=emailed">View</a>
        </div>
        
        <div class="stat-card success">
          <h3>${stats.hasInventory}</h3>
          <p>Has Inventory</p>
          <a href="/app/counties?filter=has_inventory">View</a>
        </div>
      </div>
      
      <div class="actions">
        <a href="/app/counties" class="btn">View All Counties</a>
        <a href="/app/import" class="btn">Import CSV</a>
        <a href="/app/template" class="btn">Edit Email Template</a>
      </div>
    </div>
  `;
  
  res.send(renderPage('Dashboard', content));
});

// Counties list
app.get('/app/counties', requireAuth, (req, res) => {
  const { filter } = req.query;
  let counties = [];
  let title = 'All Counties';

  switch (filter) {
    case 'not_contacted':
      counties = db.getCounties({ status: 'Not contacted' });
      title = 'Not Contacted';
      break;
    case 'due_followup':
      counties = db.getCounties({ dueFollowup: true });
      title = 'Due Follow-up';
      break;
    case 'emailed':
      counties = db.getCounties({ status: 'Emailed' });
      title = 'Waiting (Emailed)';
      break;
    case 'has_inventory':
      counties = db.getCounties({ hasInventory: true });
      title = 'Has Inventory';
      break;
    default:
      counties = db.getCounties();
      title = 'All Counties';
  }

  const rows = counties.map(c => `
    <tr>
      <td><a href="/app/county/${c.id}">${c.name}</a></td>
      <td>${c.seat || ''}</td>
      <td>${c.fips}</td>
      <td>${c.tac_email || ''}</td>
      <td><span class="badge badge-${c.outreach_status.toLowerCase().replace(' ', '-')}">${c.outreach_status}</span></td>
      <td>${c.last_emailed || '-'}</td>
      <td>${c.next_followup || '-'}</td>
    </tr>
  `).join('');

  const content = `
    <div class="container">
      <h2>${title} (${counties.length})</h2>
      
      <table>
        <thead>
          <tr>
            <th>County</th>
            <th>Seat</th>
            <th>FIPS</th>
            <th>TAC Email</th>
            <th>Status</th>
            <th>Last Emailed</th>
            <th>Next Follow-up</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    </div>
  `;
  
  res.send(renderPage(title, content));
});

// County detail
app.get('/app/county/:id', requireAuth, (req, res) => {
  const county = db.getCountyById(req.params.id);
  if (!county) {
    return res.status(404).send('County not found');
  }

  const logs = db.getSendLogs(county.id);
  const todaySends = db.getTodaySendCount();
  const dailyCap = parseInt(process.env.SEND_DAILY_CAP || '5');
  const canSend = todaySends < dailyCap && county.tac_email;

  const logsHtml = logs.length > 0 ? logs.map(log => `
    <div class="log-entry">
      <strong>${new Date(log.sent_at).toLocaleString()}</strong><br>
      To: ${log.to_email}<br>
      Subject: ${log.subject}
    </div>
  `).join('') : '<p>No emails sent yet</p>';

  const content = `
    <div class="container">
      <h2>${county.name} County</h2>
      
      <div class="county-details">
        <p><strong>County Seat:</strong> ${county.seat}</p>
        <p><strong>FIPS:</strong> ${county.fips}</p>
        <p><strong>Status:</strong> <span class="badge badge-${county.outreach_status.toLowerCase().replace(' ', '-')}">${county.outreach_status}</span></p>
        ${county.last_emailed ? `<p><strong>Last Emailed:</strong> ${county.last_emailed}</p>` : ''}
        ${county.next_followup ? `<p><strong>Next Follow-up:</strong> ${county.next_followup}</p>` : ''}
        ${county.inventory_received_date ? `<p><strong>Inventory Received:</strong> ${county.inventory_received_date}</p>` : ''}
      </div>

      <h3>TAC Contact Information</h3>
      <form method="POST" action="/app/county/${county.id}/update">
        <label>TAC Name</label>
        <input type="text" name="tac_name" value="${county.tac_name || ''}" placeholder="Tax Assessor-Collector Name">
        
        <label>TAC Email</label>
        <input type="email" name="tac_email" value="${county.tac_email || ''}" placeholder="tac@example.com">
        
        <label>TAC Phone</label>
        <input type="tel" name="tac_phone" value="${county.tac_phone || ''}" placeholder="(555) 123-4567">
        
        <label>Collection Firm</label>
        <input type="text" name="collection_firm" value="${county.collection_firm || ''}" placeholder="Collection firm name">
        
        <label>Outreach Status</label>
        <select name="outreach_status">
          <option value="Not contacted" ${county.outreach_status === 'Not contacted' ? 'selected' : ''}>Not contacted</option>
          <option value="Emailed" ${county.outreach_status === 'Emailed' ? 'selected' : ''}>Emailed</option>
          <option value="Replied" ${county.outreach_status === 'Replied' ? 'selected' : ''}>Replied</option>
          <option value="List received" ${county.outreach_status === 'List received' ? 'selected' : ''}>List received</option>
          <option value="Offer in play" ${county.outreach_status === 'Offer in play' ? 'selected' : ''}>Offer in play</option>
          <option value="Closed" ${county.outreach_status === 'Closed' ? 'selected' : ''}>Closed</option>
        </select>
        
        <label>Inventory Received Date</label>
        <input type="date" name="inventory_received_date" value="${county.inventory_received_date || ''}">
        
        <label>Notes</label>
        <textarea name="notes" rows="4" placeholder="Internal notes...">${county.notes || ''}</textarea>
        
        <button type="submit">Update County</button>
      </form>

      ${canSend ? `
        <h3>Send Email</h3>
        <form method="POST" action="/app/county/${county.id}/preview" target="_blank">
          <button type="submit" class="btn btn-primary">Preview Email</button>
        </form>
        <form method="POST" action="/app/county/${county.id}/send" onsubmit="return confirm('Send email to ${county.tac_email}?');">
          <button type="submit" class="btn btn-success">Send Email Now</button>
        </form>
        <p class="info">Daily sends: ${todaySends}/${dailyCap}</p>
      ` : `
        <div class="warning">
          ${!county.tac_email ? '<p>⚠ No TAC email address on file</p>' : ''}
          ${todaySends >= dailyCap ? `<p>⚠ Daily send cap reached (${todaySends}/${dailyCap})</p>` : ''}
        </div>
      `}

      <h3>Send History</h3>
      <div class="logs">
        ${logsHtml}
      </div>
    </div>
  `;
  
  res.send(renderPage(county.name + ' County', content));
});

// Update county
app.post('/app/county/:id/update', requireAuth, (req, res) => {
  db.updateCounty(req.params.id, req.body);
  res.redirect(`/app/county/${req.params.id}`);
});

// Preview email
app.post('/app/county/:id/preview', requireAuth, (req, res) => {
  const county = db.getCountyById(req.params.id);
  if (!county) {
    return res.status(404).send('County not found');
  }

  const { subject, body } = emailService.mergeTemplate(county);

  const content = `
    <div class="container">
      <h2>Email Preview: ${county.name} County</h2>
      <div class="email-preview">
        <p><strong>To:</strong> ${county.tac_email}</p>
        <p><strong>Subject:</strong> ${subject}</p>
        <hr>
        <pre>${body}</pre>
      </div>
      <button onclick="window.close()">Close</button>
    </div>
  `;
  
  res.send(renderPage('Email Preview', content, false));
});

// Send email
app.post('/app/county/:id/send', requireAuth, async (req, res) => {
  const dailyCap = parseInt(process.env.SEND_DAILY_CAP || '5');
  const todaySends = db.getTodaySendCount();

  if (todaySends >= dailyCap) {
    return res.status(429).send(`Daily send cap reached (${todaySends}/${dailyCap})`);
  }

  const county = db.getCountyById(req.params.id);
  if (!county || !county.tac_email) {
    return res.status(400).send('County or TAC email not found');
  }

  try {
    const result = await emailService.sendEmail(county);
    res.redirect(`/app/county/${req.params.id}?sent=1`);
  } catch (error) {
    console.error('Send error:', error);
    res.status(500).send(`Failed to send email: ${error.message}`);
  }
});

// CSV Import page
app.get('/app/import', requireAuth, (req, res) => {
  const content = `
    <div class="container">
      <h2>Import TAC Contacts from CSV</h2>
      
      <div class="info-box">
        <h3>CSV Format</h3>
        <p>Upload a CSV file with the following columns:</p>
        <ul>
          <li><strong>county</strong> - County name (must match existing county)</li>
          <li><strong>tac_name</strong> - Tax Assessor-Collector name</li>
          <li><strong>tac_email</strong> - TAC email address</li>
          <li><strong>tac_phone</strong> - TAC phone number (optional)</li>
          <li><strong>firm</strong> - Collection firm name (optional)</li>
          <li><strong>notes</strong> - Internal notes (optional)</li>
        </ul>
        <p><a href="/sample.csv" download>Download sample CSV</a></p>
      </div>

      <form method="POST" action="/app/import" enctype="multipart/form-data">
        <label>CSV File</label>
        <input type="file" name="csvfile" accept=".csv" required>
        <button type="submit">Import</button>
      </form>
    </div>
  `;
  
  res.send(renderPage('CSV Import', content));
});

// Handle CSV import
app.post('/app/import', requireAuth, upload.single('csvfile'), async (req, res) => {
  if (!req.file) {
    return res.status(400).send('No file uploaded');
  }

  try {
    const csvContent = fs.readFileSync(req.file.path, 'utf-8');
    const { parse } = require('csv-parse/sync');
    
    const records = parse(csvContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true
    });

    let imported = 0;
    let errors = [];

    for (const record of records) {
      const county = db.getCountyByName(record.county);
      if (!county) {
        errors.push(`County not found: ${record.county}`);
        continue;
      }

      db.updateCounty(county.id, {
        tac_name: record.tac_name || null,
        tac_email: record.tac_email || null,
        tac_phone: record.tac_phone || null,
        collection_firm: record.firm || null,
        notes: record.notes || null
      });

      imported++;
    }

    // Clean up uploaded file
    fs.unlinkSync(req.file.path);

    const content = `
      <div class="container">
        <h2>Import Complete</h2>
        <p class="success">✓ Imported ${imported} records</p>
        ${errors.length > 0 ? `
          <div class="warning">
            <h3>Errors:</h3>
            <ul>${errors.map(e => `<li>${e}</li>`).join('')}</ul>
          </div>
        ` : ''}
        <a href="/app/counties" class="btn">View Counties</a>
      </div>
    `;
    
    res.send(renderPage('Import Complete', content));
  } catch (error) {
    // Clean up on error
    if (req.file) {
      fs.unlinkSync(req.file.path);
    }
    res.status(500).send(`Import failed: ${error.message}`);
  }
});

// Email template editor
app.get('/app/template', requireAuth, (req, res) => {
  const template = db.getEmailTemplate();
  
  const content = `
    <div class="container">
      <h2>Email Template</h2>
      
      <div class="info-box">
        <h3>Available Merge Fields</h3>
        <ul>
          <li><code>${'{{county}}'}</code> - County name</li>
          <li><code>${'{{tac_name}}'}</code> - TAC name</li>
          <li><code>${'{{tac_email}}'}</code> - TAC email</li>
        </ul>
      </div>

      <form method="POST" action="/app/template">
        <label>Subject</label>
        <input type="text" name="subject" value="${template.subject}" required>
        
        <label>Body</label>
        <textarea name="body" rows="20" required>${template.body}</textarea>
        
        <button type="submit">Save Template</button>
      </form>
    </div>
  `;
  
  res.send(renderPage('Email Template', content));
});

app.post('/app/template', requireAuth, (req, res) => {
  const { subject, body } = req.body;
  db.updateEmailTemplate(subject, body);
  res.redirect('/app/template?saved=1');
});

// Sample CSV download
app.get('/sample.csv', requireAuth, (req, res) => {
  const csv = `county,tac_name,tac_email,tac_phone,firm,notes
Harris,John Smith,john.smith@co.harris.tx.us,(713) 555-0100,Smith & Associates,Primary contact
Dallas,Jane Doe,jane.doe@dallascounty.org,(214) 555-0200,,"Prefers email"
Travis,Bob Johnson,bjohnson@traviscountytx.gov,(512) 555-0300,Travis Tax Services,`;

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=sample.csv');
  res.send(csv);
});

// Start server
const HOST = process.env.NODE_ENV === 'production' ? '127.0.0.1' : '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`✓ Wild Boar Creek CRM running on http://${HOST}:${PORT}`);
  console.log(`✓ Login at http://${HOST}:${PORT}/login`);
  console.log(`✓ Staff: ${STAFF_EMAIL}`);
});
