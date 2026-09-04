const { Resend } = require('resend');
const { getEmailTemplate, addSendLog, updateCounty } = require('./database');

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = process.env.MAIL_FROM || 'james@wildboarcreek.com';

// Create Resend client
function getResendClient() {
  // In development/test mode, return a mock client
  if (process.env.NODE_ENV === 'test' || !RESEND_API_KEY) {
    console.log('Using mock email client (no actual emails will be sent)');
    return {
      emails: {
        send: async (payload) => {
          console.log('MOCK EMAIL:', {
            from: payload.from,
            to: payload.to,
            subject: payload.subject,
            text_length: payload.text ? payload.text.length : 0
          });
          return { id: 'mock-' + Date.now() };
        }
      }
    };
  }

  return new Resend(RESEND_API_KEY);
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

// Send email to county via Resend
async function sendEmail(county) {
  if (!county.tac_email) {
    throw new Error('No TAC email address');
  }

  const { subject, body } = mergeTemplate(county);
  const resend = getResendClient();

  const payload = {
    from: FROM_EMAIL,
    to: county.tac_email,
    subject: subject,
    text: body
  };

  // Send the email via Resend
  const result = await resend.emails.send(payload);
  console.log(`Email sent to ${county.name} County via Resend: ${result.id}`);

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

  return result;
}

// Send reply to inbound email via Resend
async function sendReply({ county, to, subject, text, inReplyTo, references }) {
  const resend = getResendClient();

  const payload = {
    from: FROM_EMAIL,
    to: to,
    subject: subject,
    text: text,
    headers: {}
  };

  // Add threading headers if provided
  if (inReplyTo) {
    payload.headers['In-Reply-To'] = inReplyTo;
  }
  if (references) {
    payload.headers['References'] = references;
  }

  // Send the email via Resend
  const result = await resend.emails.send(payload);
  console.log(`Reply sent to ${to} via Resend: ${result.id}`);

  // Log the send
  const today = new Date().toISOString().split('T')[0];
  addSendLog(county.id, to, subject, text);

  // Update last_emailed (but NOT outreach_status)
  updateCounty(county.id, {
    last_emailed: today
  });

  return result;
}

module.exports = {
  sendEmail,
  sendReply,
  mergeTemplate,
  getNextFollowupDate
};
