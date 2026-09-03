const nodemailer = require('nodemailer');
const { getEmailTemplate, addSendLog, updateCounty } = require('./database');

// SMTP Configuration from environment variables
const SMTP_CONFIG = {
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || '465'),
  secure: process.env.SMTP_SECURE === 'true' || process.env.SMTP_PORT === '465',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
};

const FROM_EMAIL = process.env.SMTP_FROM;
const FROM_NAME = process.env.SMTP_FROM_NAME || 'James McHugh';

// Create transporter
function createTransporter() {
  // In development/test mode, return a mock transporter
  if (process.env.NODE_ENV === 'test' || !SMTP_CONFIG.host) {
    console.log('Using mock email transporter (no actual emails will be sent)');
    return {
      sendMail: async (mailOptions) => {
        console.log('MOCK EMAIL:', {
          from: mailOptions.from,
          to: mailOptions.to,
          subject: mailOptions.subject,
          body_length: mailOptions.text.length
        });
        return { messageId: 'mock-' + Date.now() };
      }
    };
  }

  return nodemailer.createTransport(SMTP_CONFIG);
}

// Merge template with county data
function mergeTemplate(county) {
  const template = getEmailTemplate();
  
  const replacements = {
    '{{county}}': county.name,
    '{{tac_name}}': county.tac_name || 'Tax Assessor-Collector',
    '{{tac_email}}': county.tac_email || ''
  };

  let subject = template.subject;
  let body = template.body;

  for (const [placeholder, value] of Object.entries(replacements)) {
    subject = subject.replace(new RegExp(placeholder, 'g'), value);
    body = body.replace(new RegExp(placeholder, 'g'), value);
  }

  return { subject, body };
}

// Calculate next follow-up date (90 days from today)
function getNextFollowupDate() {
  const today = new Date();
  const followup = new Date(today);
  followup.setDate(followup.getDate() + 90);
  return followup.toISOString().split('T')[0]; // YYYY-MM-DD format
}

// Send email to county
async function sendEmail(county) {
  if (!county.tac_email) {
    throw new Error('No TAC email address');
  }

  const { subject, body } = mergeTemplate(county);
  const transporter = createTransporter();

  const mailOptions = {
    from: `"${FROM_NAME}" <${FROM_EMAIL}>`,
    to: county.tac_email,
    subject: subject,
    text: body
  };

  // Send the email
  const info = await transporter.sendMail(mailOptions);
  console.log(`Email sent to ${county.name} County: ${info.messageId}`);

  // Log the send
  const today = new Date().toISOString().split('T')[0];
  const nextFollowup = getNextFollowupDate();

  addSendLog(county.id, county.tac_email, subject, body);

  // Update county status
  updateCounty(county.id, {
    outreach_status: 'Emailed',
    last_emailed: today,
    next_followup: nextFollowup
  });

  return info;
}

module.exports = {
  sendEmail,
  mergeTemplate,
  getNextFollowupDate
};
