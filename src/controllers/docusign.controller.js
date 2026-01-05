const docusign = require('docusign-esign');
const fs = require('fs');
const path = require('path');
const ClientJob = require('../models/ClientJob');
const axios = require('axios');
const { sendEmail } = require('../utils/sendEmail');

function getEmailTemplate(name, content) {
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
                      Hi ${name},
                    </h2>
                    ${content}
                  </td>
                </tr>
                <tr>
                  <td style="background-color: #f9f9f9; padding: 25px 40px; border-top: 1px solid #e0e0e0;">
                    <p style="font-size: 14px; line-height: 1.6; color: #666; margin: 0 0 10px 0; font-family: Arial, sans-serif;">
                      Best regards,<br/>
                      <strong style="color: #333;">The Kept House Team</strong>
                    </p>
                    <p style="font-size: 12px; line-height: 1.5; color: #999; margin: 15px 0 0 0; font-family: Arial, sans-serif;">
                      If you have any questions, feel free to contact us at admin@keptestate.com
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

const DOCUSIGN_INTEGRATION_KEY = process.env.DOCUSIGN_INTEGRATION_KEY;
const DOCUSIGN_USER_ID = process.env.DOCUSIGN_USER_ID;
const DOCUSIGN_ACCOUNT_ID = process.env.DOCUSIGN_ACCOUNT_ID;
const DOCUSIGN_PRIVATE_KEY_PATH = process.env.DOCUSIGN_PRIVATE_KEY_PATH;
const DOCUSIGN_PRIVATE_KEY = process.env.DOCUSIGN_PRIVATE_KEY;
const DOCUSIGN_BASE_PATH = process.env.DOCUSIGN_BASE_PATH;

const getApiClient = async () => {
  const apiClient = new docusign.ApiClient();
  apiClient.setBasePath(DOCUSIGN_BASE_PATH);

  // Support both: env variable (for production) or file path (for local dev)
  let privateKey;
  if (DOCUSIGN_PRIVATE_KEY) {
    // Handle both base64 encoded and \n-escaped formats
    if (DOCUSIGN_PRIVATE_KEY.startsWith('LS0t')) {
      privateKey = Buffer.from(DOCUSIGN_PRIVATE_KEY, 'base64').toString('utf8');
    } else {
      privateKey = DOCUSIGN_PRIVATE_KEY.replace(/\\n/g, '\n');
    }
  } else {
    privateKey = fs.readFileSync(path.resolve(DOCUSIGN_PRIVATE_KEY_PATH), 'utf8');
  }

  const results = await apiClient.requestJWTUserToken(
    DOCUSIGN_INTEGRATION_KEY,
    DOCUSIGN_USER_ID,
    ['signature', 'impersonation'],
    privateKey,
    3600
  );

  const accessToken = results.body.access_token;
  apiClient.addDefaultHeader('Authorization', 'Bearer ' + accessToken);

  return apiClient;
};

const downloadFile = async (url) => {
  const response = await axios.get(url, { responseType: 'arraybuffer' });
  return Buffer.from(response.data);
};

exports.sendContractForSigning = async (req, res) => {
  try {
    const { jobId } = req.body;

    const job = await ClientJob.findById(jobId).populate('client accountManager');
    
    if (!job) {
      return res.status(404).json({ message: 'Job not found' });
    }

    if (!job.contractFileUrl) {
      return res.status(400).json({ message: 'No contract file uploaded' });
    }

    const apiClient = await getApiClient();
    const envelopesApi = new docusign.EnvelopesApi(apiClient);

    const contractPdfBytes = await downloadFile(job.contractFileUrl);

    const envelope = {
      emailSubject: `Contract Agreement - ${job.propertyAddress}`,
      emailBlurb: 'Please review and sign your estate sale contract.',
      documents: [{
        documentBase64: contractPdfBytes.toString('base64'),
        name: 'Estate Sale Contract',
        fileExtension: 'pdf',
        documentId: '1'
      }],
      recipients: {
        signers: [{
          email: job.client.email,
          name: job.client.name,
          recipientId: '1',
          routingOrder: '1',
          clientUserId: job.client._id.toString(),
          tabs: {
            signHereTabs: [
              {
                documentId: '1',
                anchorString: 'Client Signature:',
                anchorUnits: 'pixels',
                anchorXOffset: '160',
                anchorYOffset: '-10',
                tabLabel: 'Client Signature'
              },
              {
                documentId: '1',
                anchorString: 'Seller Signature',
                anchorUnits: 'pixels',
                anchorXOffset: '160',
                anchorYOffset: '-30',
                tabLabel: 'Seller Signature'
              },
              {
                documentId: '1',
                anchorString: 'Owner Signature',
                anchorUnits: 'pixels',
                anchorXOffset: '160',
                anchorYOffset: '-30',
                tabLabel: 'Owner Signature'
              }
            ],
            dateSignedTabs: [
              {
                documentId: '1',
                anchorString: 'Client Signature:',
                anchorUnits: 'pixels',
                anchorXOffset: '400',
                anchorYOffset: '-10',
                tabLabel: 'Client Date'
              },
              {
                documentId: '1',
                anchorString: 'Seller Signature',
                anchorUnits: 'pixels',
                anchorXOffset: '400',
                anchorYOffset: '-30',
                tabLabel: 'Seller Date'
              },
              {
                documentId: '1',
                anchorString: 'Owner Signature',
                anchorUnits: 'pixels',
                anchorXOffset: '400',
                anchorYOffset: '-30',
                tabLabel: 'Owner Date'
              }
            ]
          }
        }]
      },
      status: 'sent'
    };

    const results = await envelopesApi.createEnvelope(DOCUSIGN_ACCOUNT_ID, {
      envelopeDefinition: envelope
    });

    job.docusignEnvelopeId = results.envelopeId;
    job.docusignStatus = 'sent';
    await job.save();

    res.json({
      success: true,
      envelopeId: results.envelopeId,
      message: 'Contract sent for signing'
    });

  } catch (error) {
    console.error('DocuSign Send Error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to send contract'
    });
  }
};

exports.getSigningUrl = async (req, res) => {
  try {
    const { jobId } = req.params;
    const job = await ClientJob.findById(jobId).populate('client');

    if (!job) {
      return res.status(404).json({ message: 'Job not found' });
    }

    if (!job.docusignEnvelopeId) {
      return res.status(404).json({ message: 'Contract not sent yet' });
    }

    const apiClient = await getApiClient();
    const envelopesApi = new docusign.EnvelopesApi(apiClient);

    const viewRequest = {
      returnUrl: `${process.env.FRONTEND_URL}/client/waiting/${jobId}`,
      authenticationMethod: 'none',
      email: job.client.email,
      userName: job.client.name,
      clientUserId: job.client._id.toString()
    };

    const results = await envelopesApi.createRecipientView(
      DOCUSIGN_ACCOUNT_ID,
      job.docusignEnvelopeId,
      { recipientViewRequest: viewRequest }
    );

    res.json({
      success: true,
      signingUrl: results.url
    });

  } catch (error) {
    console.error('DocuSign Signing URL Error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

exports.checkContractStatus = async (req, res) => {
  try {
    const { jobId } = req.params;

    const job = await ClientJob.findById(jobId);
    
    if (!job) {
      return res.status(404).json({ 
        success: false,
        message: 'Job not found' 
      });
    }

    if (!job.docusignEnvelopeId) {
      return res.status(400).json({ 
        success: false,
        message: 'No DocuSign envelope found for this job' 
      });
    }

    const apiClient = await getApiClient();
    const envelopesApi = new docusign.EnvelopesApi(apiClient);

    const envelope = await envelopesApi.getEnvelope(DOCUSIGN_ACCOUNT_ID, job.docusignEnvelopeId);

    if (envelope.status === 'completed') {
      const wasAlreadySigned = job.contractSignedByClient;

      job.contractSignedByClient = true;
      job.contractSignedAt = new Date();
      job.docusignStatus = 'completed';
      await job.save();

      // Only send emails if this is the first time detecting the signature
      if (!wasAlreadySigned) {
        const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@keptestate.com';

        const adminContent = `
          <p style="font-size: 16px; line-height: 1.6; color: #333; margin: 0 0 15px 0; font-family: Arial, sans-serif;">
            Great news! <strong>${job.contractSignor}</strong> has signed the contract.
          </p>
          <div style="background-color: #f9f9f9; border-left: 4px solid #e6c35a; padding: 20px; margin: 20px 0; border-radius: 4px;">
            <p style="font-size: 14px; line-height: 1.8; color: #333; margin: 0; font-family: Arial, sans-serif;">
              <strong style="color: #101010;">Client Name:</strong> ${job.contractSignor}<br/>
              <strong style="color: #101010;">Property Address:</strong> ${job.propertyAddress}<br/>
              <strong style="color: #101010;">Email:</strong> ${job.contactEmail}<br/>
              <strong style="color: #101010;">Phone:</strong> ${job.contactPhone}
            </p>
          </div>
          <div style="background-color: #e8f5e9; border-left: 4px solid #4caf50; padding: 20px; margin: 20px 0; border-radius: 4px;">
            <p style="font-size: 14px; line-height: 1.6; color: #2e7d32; margin: 0; font-family: Arial, sans-serif;">
              <strong>Next Step:</strong> Go to the dashboard to continue the next steps and update the project status accordingly.
            </p>
          </div>
        `;

        const clientContent = `
          <p style="font-size: 16px; line-height: 1.6; color: #333; margin: 0 0 15px 0; font-family: Arial, sans-serif;">
            We have received your signed contract for the property at:
          </p>
          <div style="background-color: #f9f9f9; border-left: 4px solid #e6c35a; padding: 20px; margin: 20px 0; border-radius: 4px;">
            <p style="font-size: 14px; line-height: 1.8; color: #333; margin: 0; font-family: Arial, sans-serif;">
              <strong style="color: #101010;">${job.propertyAddress}</strong>
            </p>
          </div>
          <div style="background-color: #e8f5e9; border-left: 4px solid #4caf50; padding: 20px; margin: 20px 0; border-radius: 4px;">
            <p style="font-size: 14px; line-height: 1.6; color: #2e7d32; margin: 0; font-family: Arial, sans-serif;">
              <strong>Next Step:</strong> You can go to your dashboard to continue with the next action.
            </p>
          </div>
          <p style="font-size: 16px; line-height: 1.6; color: #333; margin: 20px 0 0 0; font-family: Arial, sans-serif;">
            Thank you for choosing Kept House!
          </p>
        `;

        // Send email to Admin
        try {
          await sendEmail({
            to: ADMIN_EMAIL,
            subject: `Contract Signed - ${job.contractSignor}`,
            html: getEmailTemplate('Admin', adminContent)
          });
        } catch (emailErr) {
          console.error('Failed to send admin notification:', emailErr.message);
        }

        // Send email to Client
        try {
          await sendEmail({
            to: job.contactEmail,
            subject: 'Thank You for Signing Your Contract - Kept House',
            html: getEmailTemplate(job.contractSignor, clientContent)
          });
        } catch (emailErr) {
          console.error('Failed to send client confirmation:', emailErr.message);
        }
      }

      return res.json({
        success: true,
        signed: true,
        status: 'completed',
        message: 'Contract has been signed successfully!'
      });
    }

    job.docusignStatus = envelope.status;
    await job.save();

    return res.json({
      success: true,
      signed: false,
      status: envelope.status,
      message: getStatusMessage(envelope.status)
    });

  } catch (error) {
    console.error('❌ Check Contract Status Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to check contract status. Please try again.'
    });
  }
};

const getStatusMessage = (status) => {
  const messages = {
    'sent': 'Contract has been sent. Please check your email.',
    'delivered': 'Contract has been delivered. Please sign it.',
    'declined': 'Contract was declined.',
    'voided': 'Contract was cancelled.',
  };
  return messages[status] || 'Contract is being processed.';
};

exports.docusignWebhook = async (req, res) => {
  try {
    const event = req.body;

    if (event.event === 'envelope-completed') {
      const envelopeId = event.data.envelopeId;

      await ClientJob.findOneAndUpdate(
        { docusignEnvelopeId: envelopeId },
        {
          contractSignedByClient: true,
          contractSignedAt: new Date(),
          docusignStatus: 'completed'
        }
      );
    }

    if (event.event === 'envelope-sent') {
      await ClientJob.findOneAndUpdate(
        { docusignEnvelopeId: event.data.envelopeId },
        { docusignStatus: 'sent' }
      );
    }

    if (event.event === 'envelope-delivered') {
      await ClientJob.findOneAndUpdate(
        { docusignEnvelopeId: event.data.envelopeId },
        { docusignStatus: 'delivered' }
      );
    }

    res.json({ received: true });

  } catch (error) {
    console.error('Webhook Error:', error);
    res.status(500).json({ received: false });
  }
};

module.exports = exports;