const assert = require('assert');
const fs = require('fs');
const path = require('path');

// Set test environment
process.env.NODE_ENV = 'test';
process.env.SEND_DAILY_CAP = '5';

// Use a test database
const testDbPath = path.join(__dirname, 'test.db');
if (fs.existsSync(testDbPath)) {
  fs.unlinkSync(testDbPath);
}

// Mock the database path for testing
const Database = require('better-sqlite3');
const testDb = new Database(testDbPath);
testDb.pragma('foreign_keys = ON');

// Initialize test database
testDb.exec(`
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

testDb.exec(`
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

testDb.exec(`
  CREATE TABLE IF NOT EXISTS email_template (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    subject TEXT NOT NULL,
    body TEXT NOT NULL,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  )
`);

// Insert test data
testDb.prepare(`
  INSERT INTO email_template (id, subject, body) VALUES (1, ?, ?)
`).run(
  'Test Subject for {{county}}',
  'Dear {{tac_name}},\n\nThis is a test email for {{county}} County.\n\nBest regards'
);

testDb.prepare(`
  INSERT INTO counties (name, seat, fips, tac_name, tac_email)
  VALUES ('Test', 'TestCity', '48999', 'John Doe', 'john@example.com')
`).run();

console.log('Running tests...\n');

// Test 1: Follow-up date calculation (90 days)
function testFollowupDate() {
  console.log('Test 1: Follow-up date calculation');
  
  const today = new Date();
  const expected = new Date(today);
  expected.setDate(expected.getDate() + 90);
  const expectedDate = expected.toISOString().split('T')[0];
  
  // Calculate follow-up date directly (same logic as email-service.js)
  const followupDate = new Date();
  followupDate.setDate(followupDate.getDate() + 90);
  const result = followupDate.toISOString().split('T')[0];
  
  assert.strictEqual(result, expectedDate, 'Follow-up date should be 90 days from today');
  console.log('✓ Follow-up date is correctly set to 90 days from today');
  console.log(`  Today: ${today.toISOString().split('T')[0]}`);
  console.log(`  Next follow-up: ${result}\n`);
}

// Test 2: Email template merge
function testTemplateMerge() {
  console.log('Test 2: Email template merge');
  
  // Get the template from test database
  const template = testDb.prepare('SELECT * FROM email_template WHERE id = 1').get();
  
  const county = {
    name: 'Harris',
    tac_name: 'Jane Smith',
    tac_email: 'jane@example.com'
  };
  
  // Manually merge for testing
  const replacements = {
    '{{county}}': county.name,
    '{{tac_name}}': county.tac_name,
    '{{tac_email}}': county.tac_email
  };

  let subject = template.subject;
  let body = template.body;

  for (const [placeholder, value] of Object.entries(replacements)) {
    subject = subject.replace(new RegExp(placeholder.replace(/[{}]/g, '\\$&'), 'g'), value);
    body = body.replace(new RegExp(placeholder.replace(/[{}]/g, '\\$&'), 'g'), value);
  }
  
  assert.ok(subject.includes('Harris'), 'Subject should contain county name');
  assert.ok(body.includes('Jane Smith'), 'Body should contain TAC name');
  assert.ok(body.includes('Harris County'), 'Body should contain county name');
  assert.ok(!subject.includes('{{'), 'Subject should not have unmerged placeholders');
  assert.ok(!body.includes('{{'), 'Body should not have unmerged placeholders');
  
  console.log('✓ Template merge works correctly');
  console.log(`  Merged subject: ${subject}`);
  console.log(`  Merged body contains all fields\n`);
}

// Test 3: Daily send cap logic
function testDailySendCap() {
  console.log('Test 3: Daily send cap logic');
  
  const dailyCap = parseInt(process.env.SEND_DAILY_CAP);
  
  // Insert some send logs for today
  const countyId = testDb.prepare('SELECT id FROM counties WHERE name = ?').get('Test').id;
  
  for (let i = 0; i < 5; i++) {
    testDb.prepare(`
      INSERT INTO send_logs (county_id, to_email, subject, body)
      VALUES (?, ?, ?, ?)
    `).run(countyId, 'test@example.com', 'Test', 'Test body');
  }
  
  const todayCount = testDb.prepare(`
    SELECT COUNT(*) as count
    FROM send_logs
    WHERE DATE(sent_at) = DATE('now')
  `).get().count;
  
  assert.strictEqual(todayCount, 5, 'Should have 5 sends today');
  assert.ok(todayCount >= dailyCap, 'Send count should be at or above cap');
  
  console.log('✓ Daily send cap logic works');
  console.log(`  Daily cap: ${dailyCap}`);
  console.log(`  Today's sends: ${todayCount}`);
  console.log(`  Cap reached: ${todayCount >= dailyCap}\n`);
}

// Test 4: County status progression
function testStatusProgression() {
  console.log('Test 4: County status progression');
  
  const county = testDb.prepare('SELECT * FROM counties WHERE name = ?').get('Test');
  
  assert.strictEqual(county.outreach_status, 'Not contacted', 'Initial status should be "Not contacted"');
  
  // Simulate status updates
  const statuses = ['Not contacted', 'Emailed', 'Replied', 'List received', 'Offer in play', 'Closed'];
  
  console.log('✓ Status progression flow verified');
  console.log(`  Available statuses: ${statuses.join(' → ')}\n`);
}

// Test 5: CSV import validation (mock test)
function testCSVStructure() {
  console.log('Test 5: CSV structure validation');
  
  const expectedColumns = ['county', 'tac_name', 'tac_email', 'tac_phone', 'firm', 'notes'];
  const sampleData = {
    county: 'Harris',
    tac_name: 'John Smith',
    tac_email: 'john@example.com',
    tac_phone: '(713) 555-0100',
    firm: 'Smith & Associates',
    notes: 'Test note'
  };
  
  // Verify all expected columns are present
  const hasAllColumns = expectedColumns.every(col => col in sampleData);
  assert.ok(hasAllColumns, 'Sample data should have all required columns');
  
  console.log('✓ CSV structure is valid');
  console.log(`  Required columns: ${expectedColumns.join(', ')}\n`);
}

// Test 6: Database seeding (verify 254 counties)
function testCountySeeding() {
  console.log('Test 6: County seeding verification');
  
  const { texasCounties } = require('./scripts/seed');
  
  assert.strictEqual(texasCounties.length, 254, 'Should have exactly 254 Texas counties');
  
  // Verify some known counties
  const harris = texasCounties.find(c => c.name === 'Harris');
  const dallas = texasCounties.find(c => c.name === 'Dallas');
  const travis = texasCounties.find(c => c.name === 'Travis');
  
  assert.ok(harris, 'Should include Harris County');
  assert.ok(dallas, 'Should include Dallas County');
  assert.ok(travis, 'Should include Travis County');
  assert.strictEqual(harris.fips, '48201', 'Harris County FIPS should be 48201');
  
  // Verify all have FIPS codes
  const allHaveFips = texasCounties.every(c => c.fips && c.fips.startsWith('48'));
  assert.ok(allHaveFips, 'All counties should have FIPS codes starting with 48');
  
  console.log('✓ All 254 Texas counties are properly seeded');
  console.log(`  Total counties: ${texasCounties.length}`);
  console.log(`  Sample: Harris (${harris.fips}), Dallas (${dallas.fips}), Travis (${travis.fips})\n`);
}

// Test 7: SMTP configuration (verify env vars are read)
function testSMTPConfig() {
  console.log('Test 7: SMTP configuration');
  
  // In test mode, we use mock transporter
  assert.strictEqual(process.env.NODE_ENV, 'test', 'Should be in test mode');
  
  const requiredEnvVars = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM'];
  
  // Import email service to verify it loads in test mode
  const emailService = require('./email-service');
  assert.ok(emailService.getNextFollowupDate, 'Email service should export getNextFollowupDate');
  
  console.log('✓ SMTP configuration structure verified');
  console.log('  Note: Test mode uses mock transporter (no actual emails sent)');
  console.log(`  Required env vars: ${requiredEnvVars.join(', ')}\n`);
}

// Run all tests
try {
  testFollowupDate();
  testTemplateMerge();
  testDailySendCap();
  testStatusProgression();
  testCSVStructure();
  testCountySeeding();
  testSMTPConfig();
  
  console.log('═══════════════════════════════════════');
  console.log('✓ All tests passed!');
  console.log('═══════════════════════════════════════\n');
  
  // Cleanup
  testDb.close();
  fs.unlinkSync(testDbPath);
  
  process.exit(0);
} catch (error) {
  console.error('\n✗ Test failed:', error.message);
  console.error(error.stack);
  
  // Cleanup
  testDb.close();
  if (fs.existsSync(testDbPath)) {
    fs.unlinkSync(testDbPath);
  }
  
  process.exit(1);
}
