const nodemailer = require('nodemailer');

let transporter;
let lastUsed = 0;
const CONNECTION_TIMEOUT = 30000; // Reset connection after 30 seconds of inactivity

function createTransporter() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: Number(process.env.SMTP_PORT || 465),
    secure: true,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
    pool: false, // Disable pooling to avoid stale connections
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 30000,
  });
}

function getTransporter() {
  const now = Date.now();

  // Create new transporter if none exists or connection is stale
  if (!transporter || (now - lastUsed > CONNECTION_TIMEOUT)) {
    if (transporter) {
      try {
        transporter.close();
      } catch (e) {
        // Ignore close errors
      }
    }
    transporter = createTransporter();
    console.log('SMTP Server ready');
  }

  lastUsed = now;
  return transporter;
}

async function sendEmail({
  to,
  subject,
  html,
  text,
  cc,
  bcc,
  replyTo,
  attachments,
  headers,
  from,
}) {
  const fromAddress = from || process.env.MAIL_FROM || `"Kept House" <${process.env.SMTP_USER}>`;

  const mailOptions = {
    from: fromAddress,
    to,
    subject,
    html,
    text,
    cc,
    bcc,
    replyTo,
    attachments,
    headers: {
      'X-Mailer': 'Kept House',
      ...headers,
    },
  };

  // Retry logic for connection errors
  let lastError;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const info = await getTransporter().sendMail(mailOptions);
      console.log('Email sent:', info.messageId);
      return {
        success: true,
        messageId: info.messageId,
        accepted: info.accepted,
        rejected: info.rejected
      };
    } catch (error) {
      lastError = error;
      console.error(`Email send attempt ${attempt} failed:`, error.message);

      // If connection error, reset transporter and retry
      if (error.code === 'ESOCKET' || error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') {
        transporter = null; // Force new connection on next attempt
        if (attempt < 2) {
          console.log('Retrying email send with fresh connection...');
          await new Promise(r => setTimeout(r, 1000)); // Wait 1 second before retry
        }
      } else {
        // Non-connection error, don't retry
        break;
      }
    }
  }

  console.error('Email send failed after retries:', lastError);
  throw lastError;
}

module.exports = { sendEmail };