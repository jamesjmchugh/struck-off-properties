const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, 'crm.db');
const db = new Database(dbPath);

// Enable foreign keys
db.pragma('foreign_keys = ON');

// Initialize database schema
function initDatabase() {
  // Counties table
  db.exec(`
    CREATE TABLE IF NOT EXISTS counties (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      seat TEXT,
      fips TEXT NOT NULL UNIQUE,
      tac_name TEXT,
      tac_email TEXT,
      tac_phone TEXT,
      collection_firm TEXT,
      attorney_email TEXT,
      county_judge TEXT,
      judge_email TEXT,
      sheriff TEXT,
      sheriff_email TEXT,
      primary_outreach_email TEXT,
      primary_contact_office TEXT,
      research_status TEXT DEFAULT 'Not started',
      auction_officer TEXT,
      resale_type TEXT,
      struck_off_holder TEXT,
      inventory_url TEXT,
      outreach_status TEXT DEFAULT 'Not contacted',
      last_emailed TEXT,
      next_followup TEXT,
      notes TEXT,
      inventory_received_date TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Migration: Add new columns if they don't exist
  const migrations = [
    'attorney_email',
    'county_judge',
    'judge_email',
    'sheriff',
    'sheriff_email',
    'primary_outreach_email',
    'primary_contact_office',
    'research_status',
    'auction_officer',
    'resale_type',
    'struck_off_holder',
    'inventory_url',
    'last_replied'
  ];

  migrations.forEach(column => {
    try {
      db.exec(`ALTER TABLE counties ADD COLUMN ${column} TEXT`);
      console.log(`Added column: ${column}`);
    } catch (err) {
      // Column already exists, ignore
      if (!err.message.includes('duplicate column')) {
        console.error(`Error adding column ${column}:`, err.message);
      }
    }
  });

  // Set default for research_status if column was just added
  try {
    db.exec(`UPDATE counties SET research_status = 'Not started' WHERE research_status IS NULL`);
  } catch (err) {
    // Ignore
  }

  // Send logs table
  db.exec(`
    CREATE TABLE IF NOT EXISTS send_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      county_id INTEGER NOT NULL,
      sent_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      to_email TEXT NOT NULL,
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      FOREIGN KEY (county_id) REFERENCES counties(id) ON DELETE CASCADE
    )
  `);

  // Emails/tickets table - stores ALL inbound messages
  db.exec(`
    CREATE TABLE IF NOT EXISTS emails (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      from_addr TEXT NOT NULL,
      to_addr TEXT NOT NULL,
      subject TEXT,
      text TEXT,
      snippet TEXT,
      message_id TEXT,
      in_reply_to TEXT,
      county_id INTEGER,
      status TEXT DEFAULT 'unassigned',
      assigned_at TEXT,
      FOREIGN KEY (county_id) REFERENCES counties(id) ON DELETE SET NULL
    )
  `);

  // Activity log table - tracks all CRM actions
  db.exec(`
    CREATE TABLE IF NOT EXISTS activity_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      kind TEXT NOT NULL,
      county_id INTEGER,
      email_id INTEGER,
      detail TEXT,
      FOREIGN KEY (county_id) REFERENCES counties(id) ON DELETE SET NULL,
      FOREIGN KEY (email_id) REFERENCES emails(id) ON DELETE SET NULL
    )
  `);

  // Email template table
  db.exec(`
    CREATE TABLE IF NOT EXISTS email_template (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Insert default template if not exists
  const template = db.prepare('SELECT id FROM email_template WHERE id = 1').get();
  if (!template) {
    db.prepare(`
      INSERT INTO email_template (id, subject, body) VALUES (1, ?, ?)
    `).run(
      'Inquiry: Struck-off / Tax-Trust Property Inventory',
      `Dear {{tac_name}},

I am a local real estate operator based in Cypress / NW Harris County, Texas.

I am reaching out to inquire about the current struck-off and tax-trust property inventory for {{county}} County. Specifically, I would like to know:

1. What is the current inventory of struck-off / tax-trust properties?
2. Who holds title in trust for these properties?
3. Is private sale under Texas Tax Code §34.05 available for these properties?
4. What is the process to submit an offer on struck-off properties?

I would appreciate any information or guidance you can provide, as well as the appropriate contact if a different department handles these matters.

Thank you for your time and assistance.

Best regards,
James McHugh
Cypress, TX`
    );
  }

  console.log('Database initialized');
}

// Get all counties with filters
function getCounties(filters = {}) {
  let query = 'SELECT * FROM counties WHERE 1=1';
  const params = [];

  if (filters.status) {
    query += ' AND outreach_status = ?';
    params.push(filters.status);
  }

  if (filters.dueFollowup) {
    query += ' AND next_followup IS NOT NULL AND next_followup <= date(\'now\') AND outreach_status != \'Closed\'';
  }

  if (filters.hasInventory) {
    query += ' AND inventory_received_date IS NOT NULL';
  }

  query += ' ORDER BY name ASC';

  return db.prepare(query).all(...params);
}

// Get county by ID
function getCountyById(id) {
  return db.prepare('SELECT * FROM counties WHERE id = ?').get(id);
}

// Get county by name
function getCountyByName(name) {
  return db.prepare('SELECT * FROM counties WHERE name = ?').get(name);
}

// Get county by TAC email
function getCountyByEmail(email) {
  return db.prepare('SELECT * FROM counties WHERE LOWER(tac_email) = LOWER(?)').get(email);
}

// Update county
function updateCounty(id, data) {
  const fields = [];
  const values = [];

  const allowedFields = [
    'tac_name', 'tac_email', 'tac_phone', 'collection_firm',
    'attorney_email', 'county_judge', 'judge_email', 'sheriff', 'sheriff_email',
    'primary_outreach_email', 'primary_contact_office',
    'research_status', 'auction_officer', 'resale_type', 'struck_off_holder',
    'inventory_url',
    'outreach_status', 'last_emailed', 'last_replied', 'next_followup', 'notes',
    'inventory_received_date'
  ];

  allowedFields.forEach(field => {
    if (data[field] !== undefined) {
      fields.push(`${field} = ?`);
      values.push(data[field]);
    }
  });

  fields.push('updated_at = CURRENT_TIMESTAMP');
  values.push(id);

  const query = `UPDATE counties SET ${fields.join(', ')} WHERE id = ?`;
  return db.prepare(query).run(...values);
}

// Get send logs for a county
function getSendLogs(countyId) {
  return db.prepare('SELECT * FROM send_logs WHERE county_id = ? ORDER BY sent_at DESC').all(countyId);
}

// Add send log
function addSendLog(countyId, toEmail, subject, body) {
  return db.prepare(`
    INSERT INTO send_logs (county_id, to_email, subject, body)
    VALUES (?, ?, ?, ?)
  `).run(countyId, toEmail, subject, body);
}

// Get sends count for today
function getTodaySendCount() {
  const result = db.prepare(`
    SELECT COUNT(*) as count
    FROM send_logs
    WHERE DATE(sent_at) = DATE('now')
  `).get();
  return result.count;
}

// Get email template
function getEmailTemplate() {
  return db.prepare('SELECT * FROM email_template WHERE id = 1').get();
}

// Update email template
function updateEmailTemplate(subject, body) {
  return db.prepare(`
    UPDATE email_template
    SET subject = ?, body = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = 1
  `).run(subject, body);
}

// Get dashboard stats
function getDashboardStats() {
  const notContacted = db.prepare(
    'SELECT COUNT(*) as count FROM counties WHERE outreach_status = \'Not contacted\''
  ).get().count;

  const dueFollowup = db.prepare(
    'SELECT COUNT(*) as count FROM counties WHERE next_followup <= date(\'now\') AND outreach_status != \'Closed\''
  ).get().count;

  const waiting = db.prepare(
    'SELECT COUNT(*) as count FROM counties WHERE outreach_status = \'Emailed\''
  ).get().count;

  const hasInventory = db.prepare(
    'SELECT COUNT(*) as count FROM counties WHERE inventory_received_date IS NOT NULL'
  ).get().count;

  return { notContacted, dueFollowup, waiting, hasInventory };
}

// Email/inbox functions
function addEmail(data) {
  return db.prepare(`
    INSERT INTO emails (from_addr, to_addr, subject, text, snippet, message_id, in_reply_to, county_id, status, assigned_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    data.from_addr,
    data.to_addr,
    data.subject,
    data.text,
    data.snippet,
    data.message_id,
    data.in_reply_to,
    data.county_id || null,
    data.status || 'unassigned',
    data.assigned_at || null
  );
}

function getEmails(filters = {}) {
  let query = 'SELECT emails.*, counties.name as county_name FROM emails LEFT JOIN counties ON emails.county_id = counties.id WHERE 1=1';
  const params = [];

  if (filters.status) {
    query += ' AND emails.status = ?';
    params.push(filters.status);
  }

  if (filters.search) {
    query += ' AND (emails.from_addr LIKE ? OR emails.subject LIKE ? OR emails.to_addr LIKE ?)';
    const searchTerm = `%${filters.search}%`;
    params.push(searchTerm, searchTerm, searchTerm);
  }

  query += ' ORDER BY emails.received_at DESC LIMIT ?';
  params.push(filters.limit || 100);

  return db.prepare(query).all(...params);
}

function getEmailById(id) {
  return db.prepare(`
    SELECT emails.*, counties.name as county_name 
    FROM emails 
    LEFT JOIN counties ON emails.county_id = counties.id 
    WHERE emails.id = ?
  `).get(id);
}

function updateEmail(id, data) {
  const fields = [];
  const values = [];

  ['county_id', 'status', 'assigned_at'].forEach(field => {
    if (data[field] !== undefined) {
      fields.push(`${field} = ?`);
      values.push(data[field]);
    }
  });

  values.push(id);
  const query = `UPDATE emails SET ${fields.join(', ')} WHERE id = ?`;
  return db.prepare(query).run(...values);
}

function getUnassignedCount() {
  return db.prepare('SELECT COUNT(*) as count FROM emails WHERE status = \'unassigned\'').get().count;
}

// Activity log functions
function addActivity(kind, county_id = null, email_id = null, detail = null) {
  return db.prepare(`
    INSERT INTO activity_log (kind, county_id, email_id, detail)
    VALUES (?, ?, ?, ?)
  `).run(kind, county_id, email_id, detail);
}

function getRecentActivity(limit = 50) {
  return db.prepare(`
    SELECT 
      activity_log.*,
      counties.name as county_name,
      emails.from_addr as email_from
    FROM activity_log
    LEFT JOIN counties ON activity_log.county_id = counties.id
    LEFT JOIN emails ON activity_log.email_id = emails.id
    ORDER BY activity_log.at DESC
    LIMIT ?
  `).all(limit);
}

module.exports = {
  db,
  initDatabase,
  getCounties,
  getCountyById,
  getCountyByName,
  getCountyByEmail,
  updateCounty,
  getSendLogs,
  addSendLog,
  getTodaySendCount,
  getEmailTemplate,
  updateEmailTemplate,
  getDashboardStats,
  addEmail,
  getEmails,
  getEmailById,
  updateEmail,
  getUnassignedCount,
  addActivity,
  getRecentActivity
};
