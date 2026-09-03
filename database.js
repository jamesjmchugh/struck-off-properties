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
      outreach_status TEXT DEFAULT 'Not contacted',
      last_emailed TEXT,
      next_followup TEXT,
      notes TEXT,
      inventory_received_date TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

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
    query += ' AND next_followup IS NOT NULL AND next_followup <= date("now") AND outreach_status != "Closed"';
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

// Update county
function updateCounty(id, data) {
  const fields = [];
  const values = [];

  const allowedFields = [
    'tac_name', 'tac_email', 'tac_phone', 'collection_firm',
    'outreach_status', 'last_emailed', 'next_followup', 'notes',
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
    'SELECT COUNT(*) as count FROM counties WHERE outreach_status = "Not contacted"'
  ).get().count;

  const dueFollowup = db.prepare(
    'SELECT COUNT(*) as count FROM counties WHERE next_followup <= date("now") AND outreach_status != "Closed"'
  ).get().count;

  const waiting = db.prepare(
    'SELECT COUNT(*) as count FROM counties WHERE outreach_status = "Emailed"'
  ).get().count;

  const hasInventory = db.prepare(
    'SELECT COUNT(*) as count FROM counties WHERE inventory_received_date IS NOT NULL'
  ).get().count;

  return { notContacted, dueFollowup, waiting, hasInventory };
}

module.exports = {
  db,
  initDatabase,
  getCounties,
  getCountyById,
  getCountyByName,
  updateCounty,
  getSendLogs,
  addSendLog,
  getTodaySendCount,
  getEmailTemplate,
  updateEmailTemplate,
  getDashboardStats
};
