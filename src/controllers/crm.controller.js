const axios = require('axios');
const { sendEmail } = require('../utils/sendEmail');

const GHL_BASE_URL = 'https://services.leadconnectorhq.com';
const GHL_API_TOKEN = process.env.GHL_API_TOKEN;
const GHL_LOCATION_ID = process.env.GHL_LOCATION_ID;

function applyFilters(contacts, { type, search, tags }) {
  let filtered = contacts;

  if (type && type !== 'all') {
    filtered = filtered.filter(c => c.type === type);
  }

  if (search) {
    const searchLower = search.toLowerCase();
    filtered = filtered.filter(c =>
      (c.contactName && c.contactName.toLowerCase().includes(searchLower)) ||
      (c.email && c.email.toLowerCase().includes(searchLower)) ||
      (c.phone && c.phone.includes(search))
    );
  }

  if (tags) {
    const tagList = tags.split(',').map(t => t.trim().toLowerCase());
    filtered = filtered.filter(c =>
      c.tags && c.tags.some(tag => tagList.includes(tag.toLowerCase()))
    );
  }

  return filtered;
}

exports.getContacts = async (req, res) => {
  try {
    const {
      limit = 100,
      startAfter,
      startAfterId,
      type,
      search,
      tags,
      fetchAll
    } = req.query;

    let allContacts = [];
    let nextStartAfter = startAfter;
    let nextStartAfterId = startAfterId;
    let hasMore = true;

    if (fetchAll === 'true') {
      while (hasMore) {
        let url = `${GHL_BASE_URL}/contacts/?locationId=${GHL_LOCATION_ID}&limit=100`;

        if (nextStartAfter && nextStartAfterId) {
          url += `&startAfter=${nextStartAfter}&startAfterId=${nextStartAfterId}`;
        }

        const response = await axios.get(url, {
          headers: {
            'Authorization': `Bearer ${GHL_API_TOKEN}`,
            'Version': '2021-07-28',
            'Accept': 'application/json'
          }
        });

        const contacts = response.data.contacts || [];
        allContacts = [...allContacts, ...contacts];

        if (response.data.meta?.startAfterId && response.data.meta?.startAfter) {
          nextStartAfter = response.data.meta.startAfter;
          nextStartAfterId = response.data.meta.startAfterId;
        } else {
          hasMore = false;
        }

        if (allContacts.length >= 5000) {
          hasMore = false;
        }
      }

      let filteredContacts = applyFilters(allContacts, { type, search, tags });

      return res.json({
        contacts: filteredContacts,
        meta: { total: allContacts.length },
        total: allContacts.length
      });
    }

    let url = `${GHL_BASE_URL}/contacts/?locationId=${GHL_LOCATION_ID}&limit=${limit}`;

    if (startAfter && startAfterId) {
      url += `&startAfter=${startAfter}&startAfterId=${startAfterId}`;
    }

    const response = await axios.get(url, {
      headers: {
        'Authorization': `Bearer ${GHL_API_TOKEN}`,
        'Version': '2021-07-28',
        'Accept': 'application/json'
      }
    });

    let contacts = response.data.contacts || [];
    contacts = applyFilters(contacts, { type, search, tags });

    res.json({
      contacts,
      meta: response.data.meta,
      total: response.data.meta?.total || contacts.length
    });
  } catch (err) {
    console.error('Error fetching CRM contacts:', err.response?.data || err.message);
    res.status(500).json({
      message: 'Failed to fetch contacts from CRM',
      error: err.response?.data?.message || err.message
    });
  }
};

exports.getContactById = async (req, res) => {
  try {
    const { id } = req.params;

    const response = await axios.get(`${GHL_BASE_URL}/contacts/${id}`, {
      headers: {
        'Authorization': `Bearer ${GHL_API_TOKEN}`,
        'Version': '2021-07-28',
        'Accept': 'application/json'
      }
    });

    res.json({ contact: response.data.contact });
  } catch (err) {
    console.error('Error fetching contact:', err.response?.data || err.message);
    res.status(500).json({
      message: 'Failed to fetch contact',
      error: err.response?.data?.message || err.message
    });
  }
};

exports.getContactTypes = async (req, res) => {
  try {
    const response = await axios.get(
      `${GHL_BASE_URL}/contacts/?locationId=${GHL_LOCATION_ID}&limit=100`,
      {
        headers: {
          'Authorization': `Bearer ${GHL_API_TOKEN}`,
          'Version': '2021-07-28',
          'Accept': 'application/json'
        }
      }
    );

    const contacts = response.data.contacts || [];
    const types = [...new Set(contacts.map(c => c.type).filter(Boolean))];

    res.json({ types });
  } catch (err) {
    console.error('Error fetching contact types:', err.response?.data || err.message);
    res.status(500).json({ message: 'Failed to fetch contact types' });
  }
};

exports.getContactTags = async (req, res) => {
  try {
    const response = await axios.get(
      `${GHL_BASE_URL}/contacts/?locationId=${GHL_LOCATION_ID}&limit=100`,
      {
        headers: {
          'Authorization': `Bearer ${GHL_API_TOKEN}`,
          'Version': '2021-07-28',
          'Accept': 'application/json'
        }
      }
    );

    const contacts = response.data.contacts || [];
    const allTags = contacts.flatMap(c => c.tags || []);
    const uniqueTags = [...new Set(allTags)];

    res.json({ tags: uniqueTags });
  } catch (err) {
    console.error('Error fetching contact tags:', err.response?.data || err.message);
    res.status(500).json({ message: 'Failed to fetch contact tags' });
  }
};

exports.sendBulkEmail = async (req, res) => {
  try {
    const { contactIds, subject, message, htmlContent } = req.body;

    if (!contactIds || !contactIds.length) {
      return res.status(400).json({ message: 'No contacts selected' });
    }

    if (!subject || !message) {
      return res.status(400).json({ message: 'Subject and message are required' });
    }

    const contactPromises = contactIds.map(id =>
      axios.get(`${GHL_BASE_URL}/contacts/${id}`, {
        headers: {
          'Authorization': `Bearer ${GHL_API_TOKEN}`,
          'Version': '2021-07-28',
          'Accept': 'application/json'
        }
      }).catch(err => {
        console.error(`Failed to fetch contact ${id}:`, err.message);
        return null;
      })
    );

    const contactResponses = await Promise.all(contactPromises);
    const contacts = contactResponses
      .filter(r => r && r.data && r.data.contact)
      .map(r => r.data.contact);

    const contactsWithEmail = contacts.filter(c => c.email);

    if (!contactsWithEmail.length) {
      return res.status(400).json({
        message: 'None of the selected contacts have email addresses'
      });
    }

    const emailHtml = htmlContent || generateEmailTemplate(message);

    const emailPromises = contactsWithEmail.map(contact =>
      sendEmail({
        to: contact.email,
        subject,
        html: emailHtml.replace('{{name}}', contact.firstName || contact.contactName || 'Valued Customer'),
        text: message.replace('{{name}}', contact.firstName || contact.contactName || 'Valued Customer')
      }).catch(err => {
        console.error(`Failed to send email to ${contact.email}:`, err.message);
        return { error: true, email: contact.email };
      })
    );

    const results = await Promise.all(emailPromises);
    const failures = results.filter(r => r && r.error);
    const successes = results.length - failures.length;

    res.json({
      message: `Email sent to ${successes} contacts`,
      sent: successes,
      failed: failures.length,
      failedEmails: failures.map(f => f.email)
    });
  } catch (err) {
    console.error('Error sending bulk email:', err);
    res.status(500).json({
      message: 'Failed to send emails',
      error: err.message
    });
  }
};

function generateEmailTemplate(message) {
  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="margin: 0; padding: 0; background-color: #f4f4f4;">
        <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f4f4; padding: 20px 0;">
          <tr>
            <td align="center">
              <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
                <tr>
                  <td style="background: linear-gradient(135deg, #e6c35a 0%, #d4af37 100%); padding: 30px 40px; text-align: center;">
                    <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-family: Arial, sans-serif; font-weight: 600;">
                      Kept House
                    </h1>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 40px 40px 30px 40px;">
                    <h2 style="color: #101010; margin: 0 0 20px 0; font-size: 22px; font-family: Arial, sans-serif; font-weight: 500;">
                      Hi {{name}},
                    </h2>
                    <div style="font-size: 16px; line-height: 1.6; color: #333; font-family: Arial, sans-serif;">
                      ${message.replace(/\n/g, '<br/>')}
                    </div>
                  </td>
                </tr>
                <tr>
                  <td style="background-color: #f9f9f9; padding: 25px 40px; border-top: 1px solid #e0e0e0;">
                    <p style="font-size: 14px; line-height: 1.6; color: #666; margin: 0 0 10px 0; font-family: Arial, sans-serif;">
                      Best regards,<br/>
                      <strong style="color: #333;">The Kept House Team</strong>
                    </p>
                    <p style="font-size: 12px; line-height: 1.5; color: #999; margin: 15px 0 0 0; font-family: Arial, sans-serif;">
                      If you have any questions, feel free to contact us at support@kepthouse.com
                    </p>
                  </td>
                </tr>
              </table>
              <table width="600" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding: 20px; text-align: center;">
                    <p style="font-size: 12px; color: #999; margin: 0; font-family: Arial, sans-serif;">
                      © ${new Date().getFullYear()} Kept House. All rights reserved.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
  `;
}

exports.getCRMStats = async (req, res) => {
  try {
    const response = await axios.get(
      `${GHL_BASE_URL}/contacts/?locationId=${GHL_LOCATION_ID}&limit=1`,
      {
        headers: {
          'Authorization': `Bearer ${GHL_API_TOKEN}`,
          'Version': '2021-07-28',
          'Accept': 'application/json'
        }
      }
    );

    res.json({
      totalContacts: response.data.meta?.total || 0
    });
  } catch (err) {
    console.error('Error fetching CRM stats:', err.response?.data || err.message);
    res.status(500).json({ message: 'Failed to fetch CRM stats' });
  }
};
