const docusign = require('docusign-esign');
const fs = require('fs');
const path = require('path');
const ClientJob = require('../models/ClientJob');
const axios = require('axios');

const DOCUSIGN_INTEGRATION_KEY = process.env.DOCUSIGN_INTEGRATION_KEY;
const DOCUSIGN_USER_ID = process.env.DOCUSIGN_USER_ID;
const DOCUSIGN_ACCOUNT_ID = process.env.DOCUSIGN_ACCOUNT_ID;
const DOCUSIGN_PRIVATE_KEY_PATH = process.env.DOCUSIGN_PRIVATE_KEY_PATH;
const DOCUSIGN_BASE_PATH = process.env.DOCUSIGN_BASE_PATH;

const getApiClient = async () => {
  const apiClient = new docusign.ApiClient();
  apiClient.setBasePath(DOCUSIGN_BASE_PATH);

  const privateKey = fs.readFileSync(path.resolve(DOCUSIGN_PRIVATE_KEY_PATH), 'utf8');
  
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
            signHereTabs: [{
              documentId: '1',
              pageNumber: '1',
              xPosition: '100',
              yPosition: '600',
              tabLabel: 'Client Signature'
            }],
            textTabs: [{
              documentId: '1',
              pageNumber: '1',
              xPosition: '100',
              yPosition: '150',
              width: '200',
              height: '20',
              tabLabel: 'Client Name',
              value: job.client.name,
              locked: 'false',
              required: 'true'
            }],
            dateSignedTabs: [{
              documentId: '1',
              pageNumber: '1',
              xPosition: '100',
              yPosition: '200',
              width: '100',
              height: '20',
              tabLabel: 'Date Signed'
            }]
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

    console.log(`📋 DocuSign Status for Job ${jobId}:`, envelope.status);

    if (envelope.status === 'completed') {
      job.contractSignedByClient = true;
      job.contractSignedAt = new Date();
      job.docusignStatus = 'completed';
      await job.save();

      console.log(`✅ Job ${jobId} marked as signed`);

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