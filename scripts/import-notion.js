#!/usr/bin/env node
// Import/upsert Texas counties from Notion export JSON
const fs = require('fs');
const path = require('path');

// Get database from parent directory
const dbModule = require(path.join(__dirname, '..', 'database'));
const { initDatabase, getCountyByName, updateCounty, db } = dbModule;

const jsonPath = path.join(__dirname, 'notion-counties.json');

if (!fs.existsSync(jsonPath)) {
  console.error(`Error: ${jsonPath} not found`);
  console.log('Place your Notion export as scripts/notion-counties.json');
  console.log('Expected format: array of objects with snake_case keys matching database columns');
  process.exit(1);
}

initDatabase();

const data = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));

if (!Array.isArray(data)) {
  console.error('Error: JSON must be an array of county objects');
  process.exit(1);
}

console.log(`Importing ${data.length} counties from Notion export...`);

let updated = 0;
let notFound = 0;

for (const record of data) {
  // Find county by name or FIPS
  let county = null;
  
  if (record.name) {
    county = getCountyByName(record.name);
  }
  
  if (!county && record.fips) {
    county = db.prepare('SELECT * FROM counties WHERE fips = ?').get(record.fips);
  }
  
  if (!county) {
    console.log(`⚠ County not found: ${record.name || record.fips}`);
    notFound++;
    continue;
  }
  
  // Update with all provided fields
  const updates = {};
  const fields = [
    'tac_name', 'tac_email', 'tac_phone', 'collection_firm',
    'attorney_email', 'county_judge', 'judge_email', 'sheriff', 'sheriff_email',
    'primary_outreach_email', 'primary_contact_office',
    'research_status', 'auction_officer', 'resale_type', 'struck_off_holder',
    'inventory_url', 'outreach_status', 'last_emailed', 'last_replied',
    'next_followup', 'notes', 'inventory_received_date'
  ];
  
  fields.forEach(field => {
    if (record[field] !== undefined) {
      updates[field] = record[field];
    }
  });
  
  if (Object.keys(updates).length > 0) {
    updateCounty(county.id, updates);
    updated++;
    console.log(`✓ Updated ${county.name} County (${Object.keys(updates).length} fields)`);
  }
}

console.log(`\n✓ Import complete`);
console.log(`  Updated: ${updated}`);
console.log(`  Not found: ${notFound}`);
console.log(`  Total processed: ${data.length}`);
