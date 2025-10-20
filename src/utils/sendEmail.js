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
  const mailOptions = {
    from: from || process.env.MAIL_FROM || process.env.SMTP_USER,
    to,
    subject,
    html,
    text,
    cc,
    bcc,
    replyTo,
    attachments,
    headers,
  };

  const info = await getTransporter().sendMail(mailOptions);
  return { messageId: info.messageId, accepted: info.accepted, rejected: info.rejected };
}

module.exports = { sendEmail };
