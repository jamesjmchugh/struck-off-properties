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

// Trust proxy (required for Cloudflare Flexible SSL)
// This allows Express to trust X-Forwarded-Proto header
app.set('trust proxy', 1);

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
    secure: true,
    sameSite: 'lax'
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
  const unassignedCount = showNav ? db.getUnassignedCount() : 0;
  const badge = unassignedCount > 0 ? ` <span class="badge-count">${unassignedCount}</span>` : '';
  
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${title} - Wild Boar Creek CRM</title>
      <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png">
      <link rel="icon" type="image/png" href="/favicon.png">
      <link rel="apple-touch-icon" href="/apple-touch-icon.png">
      <link rel="preconnect" href="https://fonts.googleapis.com">
      <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
      <link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&family=Outfit:wght@300;400;500&display=swap" rel="stylesheet">
      <link rel="stylesheet" href="/styles.css">
    </head>
    <body>
      ${showNav ? `
        <nav>
          <h1><a href="/app">Wild Boar Creek CRM</a></h1>
          <div class="nav-links">
            <a href="/app">Dashboard</a> |
            <a href="/app/counties">Counties</a> |
            <a href="/app/inbox">Inbox${badge}</a> |
            <a href="/logout">Logout</a>
          </div>
        </nav>
      ` : ''}
      <main>
        ${content}
      </main>
      <footer>
        <p class="name">Wild Boar Creek</p>
        <p>16518 House Hahl Rd #106<br />Cypress, TX 77433</p>
        <p><a href="mailto:james@wildboarcreek.com">james@wildboarcreek.com</a></p>
        <p class="fine">Established for the long haul</p>
      </footer>
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

  const { from, to, subject, messageId, inReplyTo, references, date, raw } = req.body;
  
  if (!from) {
    return res.status(400).json({ error: 'Missing from field' });
  }

  // Extract email addresses
  const extractEmail = (str) => {
    const match = str.match(/<(.+?)>/) || [null, str];
    return match[1].toLowerCase().trim();
  };

  const fromAddr = extractEmail(from);
  const toAddr = to ? extractEmail(to) : 'james@wildboarcreek.com';

  console.log(`Inbound email from: ${fromAddr} to: ${toAddr}`);

  // Parse text from raw (simple version - could be enhanced)
  let text = '';
  let snippet = '';
  if (raw) {
    // Very basic text extraction from raw email
    text = raw.substring(0, 10000); // Limit size
    snippet = (subject || text.substring(0, 200)).substring(0, 200);
  } else {
    snippet = subject ? subject.substring(0, 200) : '';
  }

  // Smart routing: Try to match to a county
  let matchedCounty = null;
  let matchReason = 'unmatched';

  // 1. Try matching by email address (any county email field)
  const emailColumns = ['tac_email', 'primary_outreach_email', 'sheriff_email', 'judge_email', 'attorney_email'];
  for (const column of emailColumns) {
    const county = db.db.prepare(`SELECT * FROM counties WHERE LOWER(${column}) = ?`).get(fromAddr);
    if (county) {
      matchedCounty = county;
      matchReason = `matched by ${column}`;
      break;
    }
  }

  // 2. If no email match, try matching county name in subject or body
  if (!matchedCounty && (subject || text)) {
    const searchText = `${subject} ${text}`.toLowerCase();
    const allCounties = db.getCounties();
    
    for (const county of allCounties) {
      const countyName = county.name.toLowerCase();
      if (searchText.includes(countyName + ' county') || searchText.includes(countyName)) {
        matchedCounty = county;
        matchReason = 'matched by name in subject/body';
        break;
      }
    }
  }

  const today = new Date().toISOString().split('T')[0];

  // Store email in database
  const emailData = {
    from_addr: fromAddr,
    to_addr: toAddr,
    subject: subject || '',
    text: text,
    snippet: snippet,
    message_id: messageId,
    in_reply_to: inReplyTo,
    county_id: matchedCounty ? matchedCounty.id : null,
    status: matchedCounty ? 'assigned' : 'unassigned',
    assigned_at: matchedCounty ? today : null
  };

  const result = db.addEmail(emailData);
  const emailId = result.lastInsertRowid;

  console.log(`Stored email ID ${emailId}, ${matchReason}`);

  // If matched to county, update county status and log activity
  if (matchedCounty) {
    console.log(`Matched to ${matchedCounty.name} County`);
    
    // Update county: mark as Replied, set last_replied, clear follow-up
    db.updateCounty(matchedCounty.id, {
      outreach_status: 'Replied',
      last_replied: today,
      next_followup: null
    });

    // Log activity: replied
    db.addActivity('replied', matchedCounty.id, emailId, `Reply from ${fromAddr}`);

    console.log(`County ${matchedCounty.name} marked as Replied, last_replied set to ${today}`);
    
    return res.json({ 
      success: true, 
      county: matchedCounty.name,
      email_id: emailId,
      message: 'Email stored and assigned to county'
    });
  } else {
    // Log activity: inbound unmatched
    db.addActivity('inbound', null, emailId, `Unmatched email from ${fromAddr} to ${toAddr}`);
    
    console.log(`No county match, stored as unassigned ticket`);
    
    return res.json({ 
      success: true,
      email_id: emailId,
      message: 'Email stored as unassigned ticket' 
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
  const recentActivity = db.getRecentActivity(50);
  
  const activityHtml = recentActivity.map(act => {
    let text = '';
    const time = new Date(act.at).toLocaleString();
    
    switch(act.kind) {
      case 'emailed':
        text = act.county_name ? 
          `<a href="/app/county/${act.county_id}">${act.county_name}</a> emailed` :
          'Email sent';
        break;
      case 'replied':
        text = act.county_name ?
          `<a href="/app/county/${act.county_id}">${act.county_name}</a> replied` :
          'Reply received';
        break;
      case 'assigned':
        text = act.county_name ?
          `Email assigned to <a href="/app/county/${act.county_id}">${act.county_name}</a>` :
          'Email assigned';
        break;
      case 'inbound':
        text = `<a href="/app/inbox/${act.email_id}">Unassigned mail</a> from ${act.detail || 'unknown'}`;
        break;
      case 'status_changed':
        text = act.county_name ?
          `<a href="/app/county/${act.county_id}">${act.county_name}</a> status changed` :
          'Status changed';
        break;
      default:
        text = act.kind;
    }
    
    return `<div class="activity-item"><span class="time">${time}</span> ${text}</div>`;
  }).join('');
  
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
        <a href="/app/inbox" class="btn">View Inbox</a>
        <a href="/app/import" class="btn">Import CSV</a>
        <a href="/app/template" class="btn">Edit Email Template</a>
      </div>
      
      <h3>Recent Activity</h3>
      <div class="activity-feed">
        ${activityHtml || '<p>No recent activity</p>'}
      </div>
    </div>
  `;
  
  res.send(renderPage('Dashboard', content));
});

// Counties list - FULL IMPLEMENTATION with map + filters
app.get('/app/counties', requireAuth, (req, res) => {
  // Get ALL counties with all fields - will filter client-side
  const counties = db.getCounties();
  
  const content = `
    <div class="container-full">
      <h2>All Texas Counties <span class="count-badge" id="count-display">254 of 254</span></h2>
      
      <!-- Map Container -->
      <div id="map" style="height: 400px; margin-bottom: 2rem; border-radius: 12px; overflow: hidden;"></div>
      
      <!-- Controls -->
      <div class="counties-controls">
        <div class="control-row">
          <div class="control-group">
            <label>Search:</label>
            <select id="search-column">
              <option value="_all">All Columns</option>
              <option value="name">County</option>
              <option value="seat">Seat</option>
              <option value="tac_name">TAC Name</option>
              <option value="tac_email">TAC Email</option>
              <option value="county_judge">Judge</option>
              <option value="sheriff">Sheriff</option>
              <option value="notes">Notes</option>
            </select>
            <input type="text" id="search-input" placeholder="Search..." />
            <button onclick="clearFilters()">Clear</button>
          </div>
          
          <div class="control-group">
            <label>Last Emailed:</label>
            <select id="filter-emailed" onchange="applyFilters()">
              <option value="any">Any</option>
              <option value="never">Never</option>
              <option value="7">Last 7 days</option>
              <option value="30">Last 30 days</option>
              <option value="90">Last 90 days</option>
              <option value="over90">Over 90 days</option>
            </select>
          </div>
          
          <div class="control-group">
            <label>Last Replied:</label>
            <select id="filter-replied" onchange="applyFilters()">
              <option value="any">Any</option>
              <option value="never">Never</option>
              <option value="7">Last 7 days</option>
              <option value="30">Last 30 days</option>
              <option value="90">Last 90 days</option>
              <option value="over90">Over 90 days</option>
            </select>
          </div>
          
          <button onclick="toggleColumnPicker()" class="btn-secondary">Columns</button>
        </div>
      </div>
      
      <!-- Column Picker -->
      <div id="column-picker" class="column-picker" style="display:none;">
        <h4>Show/Hide Columns</h4>
        <div class="column-grid" id="column-checkboxes"></div>
      </div>
      
      <!-- Table -->
      <div class="table-container">
        <table id="counties-table">
          <thead>
            <tr id="table-header"></tr>
          </thead>
          <tbody id="table-body"></tbody>
        </table>
      </div>
    </div>
    
    <!-- Data -->
    <script type="application/json" id="counties-data">
    ${JSON.stringify(counties)}
    </script>
    
    <!-- Leaflet CSS/JS -->
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
    
    <script>
    // Parse data
    const countiesData = JSON.parse(document.getElementById('counties-data').textContent);
    
    // Column definitions
    const columns = [
      {id: 'name', label: 'County', defaultVisible: true, sticky: true},
      {id: 'seat', label: 'Seat', defaultVisible: true},
      {id: 'fips', label: 'FIPS', defaultVisible: false},
      {id: 'outreach_status', label: 'Status', defaultVisible: true},
      {id: 'research_status', label: 'Research', defaultVisible: false},
      {id: 'tac_name', label: 'TAC', defaultVisible: true},
      {id: 'tac_email', label: 'TAC Email', defaultVisible: true},
      {id: 'tac_phone', label: 'TAC Phone', defaultVisible: false},
      {id: 'county_judge', label: 'Judge', defaultVisible: true},
      {id: 'judge_email', label: 'Judge Email', defaultVisible: false},
      {id: 'sheriff', label: 'Sheriff', defaultVisible: true},
      {id: 'sheriff_email', label: 'Sheriff Email', defaultVisible: false},
      {id: 'attorney_email', label: 'Attorney Email', defaultVisible: false},
      {id: 'collection_firm', label: 'Collection Firm', defaultVisible: false},
      {id: 'primary_outreach_email', label: 'Primary Email', defaultVisible: false},
      {id: 'primary_contact_office', label: 'Primary Office', defaultVisible: false},
      {id: 'auction_officer', label: 'Auction Officer', defaultVisible: false},
      {id: 'resale_type', label: 'Resale Type', defaultVisible: false},
      {id: 'struck_off_holder', label: 'Struck-off Holder', defaultVisible: false},
      {id: 'inventory_url', label: 'Inventory URL', defaultVisible: false},
      {id: 'last_emailed', label: 'Last Emailed', defaultVisible: true},
      {id: 'last_replied', label: 'Last Replied', defaultVisible: false},
      {id: 'next_followup', label: 'Next Follow-up', defaultVisible: true},
      {id: 'inventory_received_date', label: 'Inventory Date', defaultVisible: false}
    ];
    
    // Load column visibility from localStorage
    const savedColumns = localStorage.getItem('counties-columns');
    const visibleColumns = savedColumns ? JSON.parse(savedColumns) : 
      columns.filter(c => c.defaultVisible).map(c => c.id);
    
    let filteredCounties = [...countiesData];
    let map, geoJsonLayer;
    
    // Status colors (Wild Boar Creek palette)
    const statusColors = {
      'Not contacted': '#e9ecef',
      'Emailed': '#cce5ff',
      'Replied': '#c8e6f5',
      'List received': '#d4f4dd',
      'Offer in play': '#fff3cd',
      'Closed': '#d6d8db'
    };
    
    // Initialize map
    function initMap() {
      map = L.map('map').setView([31.5, -99.5], 6);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap'
      }).addTo(map);
      
      fetch('/geojson/texas-counties.json')
        .then(r => r.json())
        .then(geojson => {
          geoJsonLayer = L.geoJSON(geojson, {
            style: feature => ({
              fillColor: getCountyColor(feature.properties.FIPS),
              fillOpacity: 0.7,
              color: '#002147',
              weight: 1
            }),
            onEachFeature: (feature, layer) => {
              const county = countiesData.find(c => c.fips === feature.properties.FIPS);
              if (county) {
                layer.bindTooltip(\`\${county.name}: \${county.outreach_status}\`);
                layer.on('click', () => {
                  if (isCountyVisible(county)) {
                    window.location.href = \`/app/county/\${county.id}\`;
                  }
                });
              }
            }
          }).addTo(map);
          updateMapColors();
        });
    }
    
    function getCountyColor(fips) {
      const county = countiesData.find(c => c.fips === fips);
      if (!county) return '#ccc';
      const visible = isCountyVisible(county);
      const color = statusColors[county.outreach_status] || '#ccc';
      return visible ? color : '#f5f5f5';
    }
    
    function isCountyVisible(county) {
      return filteredCounties.some(c => c.id === county.id);
    }
    
    function updateMapColors() {
      if (geoJsonLayer) {
        geoJsonLayer.eachLayer(layer => {
          const fips = layer.feature.properties.FIPS;
          layer.setStyle({
            fillColor: getCountyColor(fips),
            fillOpacity: isCountyVisible(countiesData.find(c => c.fips === fips)) ? 0.7 : 0.2
          });
        });
      }
    }
    
    // Render table
    function renderTable() {
      const header = document.getElementById('table-header');
      const body = document.getElementById('table-body');
      
      // Header
      header.innerHTML = columns
        .filter(c => visibleColumns.includes(c.id))
        .map(c => \`<th class="\${c.sticky ? 'sticky-col' : ''}">\${c.label}</th>\`)
        .join('');
      
      // Body
      body.innerHTML = filteredCounties.map(county => {
        const cells = columns
          .filter(c => visibleColumns.includes(c.id))
          .map(c => {
            let value = county[c.id] || '';
            if (c.id === 'name') {
              value = \`<a href="/app/county/\${county.id}">\${value}</a>\`;
            } else if (c.id === 'outreach_status') {
              value = \`<span class="badge badge-\${value.toLowerCase().replace(' ', '-')}">\${value}</span>\`;
            } else if (c.id === 'inventory_url' && value) {
              value = \`<a href="\${value}" target="_blank">View</a>\`;
            }
            return \`<td class="\${c.sticky ? 'sticky-col' : ''}">\${value}</td>\`;
          }).join('');
        return \`<tr>\${cells}</tr>\`;
      }).join('');
      
      document.getElementById('count-display').textContent = \`\${filteredCounties.length} of \${countiesData.length}\`;
    }
    
    // Render column picker
    function renderColumnPicker() {
      const container = document.getElementById('column-checkboxes');
      container.innerHTML = columns.map(c => \`
        <label class="\${c.sticky ? 'disabled' : ''}">
          <input type="checkbox" 
            value="\${c.id}" 
            \${visibleColumns.includes(c.id) ? 'checked' : ''}
            \${c.sticky ? 'disabled' : ''}
            onchange="toggleColumn('\${c.id}')">
          \${c.label}
        </label>
      \`).join('');
    }
    
    function toggleColumn(columnId) {
      const index = visibleColumns.indexOf(columnId);
      if (index > -1) {
        visibleColumns.splice(index, 1);
      } else {
        visibleColumns.push(columnId);
      }
      localStorage.setItem('counties-columns', JSON.stringify(visibleColumns));
      renderTable();
    }
    
    function toggleColumnPicker() {
      const picker = document.getElementById('column-picker');
      picker.style.display = picker.style.display === 'none' ? 'block' : 'none';
    }
    
    // Filters
    function applyFilters() {
      const searchCol = document.getElementById('search-column').value;
      const searchTerm = document.getElementById('search-input').value.toLowerCase();
      const emailedFilter = document.getElementById('filter-emailed').value;
      const repliedFilter = document.getElementById('filter-replied').value;
      
      filteredCounties = countiesData.filter(county => {
        // Search
        if (searchTerm) {
          if (searchCol === '_all') {
            const allText = Object.values(county).join(' ').toLowerCase();
            if (!allText.includes(searchTerm)) return false;
          } else {
            const val = (county[searchCol] || '').toLowerCase();
            if (!val.includes(searchTerm)) return false;
          }
        }
        
        // Last emailed
        if (!matchesDateFilter(county.last_emailed, emailedFilter)) return false;
        
        // Last replied
        if (!matchesDateFilter(county.last_replied, repliedFilter)) return false;
        
        return true;
      });
      
      renderTable();
      updateMapColors();
    }
    
    function matchesDateFilter(dateStr, filter) {
      if (filter === 'any') return true;
      if (filter === 'never') return !dateStr;
      if (!dateStr) return false;
      
      const date = new Date(dateStr);
      const now = new Date();
      const daysDiff = Math.floor((now - date) / (1000 * 60 * 60 * 24));
      
      if (filter === '7') return daysDiff <= 7;
      if (filter === '30') return daysDiff <= 30;
      if (filter === '90') return daysDiff <= 90;
      if (filter === 'over90') return daysDiff > 90;
      
      return true;
    }
    
    function clearFilters() {
      document.getElementById('search-input').value = '';
      document.getElementById('search-column').value = '_all';
      document.getElementById('filter-emailed').value = 'any';
      document.getElementById('filter-replied').value = 'any';
      applyFilters();
    }
    
    // Event listeners
    document.getElementById('search-input').addEventListener('input', applyFilters);
    document.getElementById('search-column').addEventListener('change', applyFilters);
    
    // Initialize
    initMap();
    renderColumnPicker();
    renderTable();
    </script>
  `;
  
  res.send(renderPage('All Counties', content));
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
    
    // Log activity: emailed
    db.addActivity('emailed', county.id, null, `Sent to ${county.tac_email}`);
    
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

// Inbox list
app.get('/app/inbox', requireAuth, (req, res) => {
  const { status, search } = req.query;
  
  const filters = {};
  if (status) filters.status = status;
  if (search) filters.search = search;
  
  const emails = db.getEmails(filters);
  const totalCount = db.db.prepare('SELECT COUNT(*) as count FROM emails').get().count;
  
  const rows = emails.map(email => {
    const statusClass = email.status.replace(' ', '-');
    const countyLink = email.county_id ? 
      `<a href="/app/county/${email.county_id}">${email.county_name}</a>` :
      '<span class="muted">Unassigned</span>';
    
    return `
      <tr>
        <td><a href="/app/inbox/${email.id}">${new Date(email.received_at).toLocaleString()}</a></td>
        <td><strong>${email.from_addr}</strong></td>
        <td><span class="to-addr">${email.to_addr}</span></td>
        <td>${email.subject || '(no subject)'}</td>
        <td>${countyLink}</td>
        <td><span class="badge badge-${statusClass}">${email.status}</span></td>
      </tr>
    `;
  }).join('');

  const content = `
    <div class="container">
      <h2>Inbox (${emails.length}${emails.length < totalCount ? ` of ${totalCount}` : ''})</h2>
      
      <div class="inbox-filters">
        <div class="filter-group">
          <a href="/app/inbox" class="filter-btn ${!status ? 'active' : ''}">All</a>
          <a href="/app/inbox?status=unassigned" class="filter-btn ${status === 'unassigned' ? 'active' : ''}">Unassigned</a>
          <a href="/app/inbox?status=assigned" class="filter-btn ${status === 'assigned' ? 'active' : ''}">Assigned</a>
          <a href="/app/inbox?status=closed" class="filter-btn ${status === 'closed' ? 'active' : ''}">Closed</a>
        </div>
        
        <form method="GET" action="/app/inbox" class="search-form">
          ${status ? `<input type="hidden" name="status" value="${status}">` : ''}
          <input type="text" name="search" placeholder="Search from, to, subject..." value="${search || ''}" />
          <button type="submit">Search</button>
          ${search ? '<a href="/app/inbox" class="btn-clear">Clear</a>' : ''}
        </form>
      </div>
      
      <table>
        <thead>
          <tr>
            <th>Received</th>
            <th>From</th>
            <th>To</th>
            <th>Subject</th>
            <th>County</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          ${rows || '<tr><td colspan="6">No emails</td></tr>'}
        </tbody>
      </table>
    </div>
  `;
  
  res.send(renderPage('Inbox', content));
});

// Inbox detail
app.get('/app/inbox/:id', requireAuth, (req, res) => {
  const email = db.getEmailById(req.params.id);
  if (!email) {
    return res.status(404).send('Email not found');
  }

  const allCounties = db.getCounties();
  const countyOptions = allCounties.map(c => 
    `<option value="${c.id}" ${email.county_id === c.id ? 'selected' : ''}>${c.name}</option>`
  ).join('');

  const content = `
    <div class="container">
      <h2>Email Detail</h2>
      
      <div class="email-detail">
        <p><strong>From:</strong> ${email.from_addr}</p>
        <p><strong>To:</strong> ${email.to_addr}</p>
        <p><strong>Received:</strong> ${new Date(email.received_at).toLocaleString()}</p>
        <p><strong>Subject:</strong> ${email.subject || '(no subject)'}</p>
        ${email.message_id ? `<p><strong>Message ID:</strong> <code>${email.message_id}</code></p>` : ''}
        ${email.in_reply_to ? `<p><strong>In Reply To:</strong> <code>${email.in_reply_to}</code></p>` : ''}
        
        <hr>
        
        <h3>Message</h3>
        <pre class="email-body">${email.text || email.snippet || '(no content)'}</pre>
      </div>
      
      <h3>Actions</h3>
      <form method="POST" action="/app/inbox/${email.id}/assign" class="inline-form">
        <label>Assign to County</label>
        <select name="county_id" required>
          <option value="">-- Select County --</option>
          ${countyOptions}
        </select>
        <button type="submit">Assign</button>
      </form>
      
      ${email.county_id ? `
        <p class="info">Currently assigned to <a href="/app/county/${email.county_id}">${email.county_name}</a></p>
      ` : ''}
      
      ${email.status !== 'closed' ? `
        <form method="POST" action="/app/inbox/${email.id}/close" class="inline-form">
          <button type="submit" class="btn-secondary">Close Ticket</button>
        </form>
      ` : '<p class="info">This ticket is closed</p>'}
      
      <a href="/app/inbox" class="btn">← Back to Inbox</a>
    </div>
  `;
  
  res.send(renderPage('Email Detail', content));
});

// Assign email to county
app.post('/app/inbox/:id/assign', requireAuth, (req, res) => {
  const { county_id } = req.body;
  const email = db.getEmailById(req.params.id);
  
  if (!email) {
    return res.status(404).send('Email not found');
  }
  
  const county = db.getCountyById(county_id);
  if (!county) {
    return res.status(400).send('Invalid county');
  }
  
  const today = new Date().toISOString().split('T')[0];
  
  // Update email
  db.updateEmail(email.id, {
    county_id: county_id,
    status: 'assigned',
    assigned_at: today
  });
  
  // Update county if this is a reply
  if (email.from_addr) {
    db.updateCounty(county_id, {
      outreach_status: 'Replied',
      last_replied: today,
      next_followup: null
    });
  }
  
  // Log activity
  db.addActivity('assigned', county_id, email.id, `Manually assigned email from ${email.from_addr}`);
  
  res.redirect(`/app/inbox/${email.id}`);
});

// Close email ticket
app.post('/app/inbox/:id/close', requireAuth, (req, res) => {
  db.updateEmail(req.params.id, { status: 'closed' });
  res.redirect(`/app/inbox/${req.params.id}`);
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
