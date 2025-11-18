const nodemailer = require('nodemailer');

let transporter;

function getTransporter() {
  if (transporter) return transporter;
  
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: Number(process.env.SMTP_PORT || 465),
    secure: true,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
    pool: true,
    maxConnections: 5,
  });
  
  transporter.verify((error) => {
    if (error) {
      console.error('SMTP Configuration Error:', error);
    } else {
      console.log('SMTP Server ready');
    }
  });

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
    console.error('Email send failed:', error);
    throw error;
  }
}

module.exports = { sendEmail };