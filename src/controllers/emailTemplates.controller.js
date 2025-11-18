const { z } = require('zod');
const EmailTemplate = require('../models/EmailTemplate');
const EmailTemplateVersion = require('../models/EmailTemplateVersion');
const { sendEmail } = require('../utils/sendEmail');
const ClientJob = require('../models/ClientJob');
const axios = require('axios');

function getByPath(obj, path) {
  return path.split('.').reduce((acc, k) => (acc && acc[k] != null ? acc[k] : ''), obj);
}

function renderString(str, context = {}) {
  if (!str) return '';
  return str.replace(/{{\s*([\w.$[\]-]+)\s*}}/g, (_, p) => {
    const val = getByPath(context, p);
    return val == null ? '' : String(val);
  });
}

function renderTemplate(tpl, context) {
  return {
    subject: renderString(tpl.subject, context),
    html: renderString(tpl.html, context),
    text: renderString(tpl.text, context),
  };
}

const KeyEnum = z.enum(['welcome', 'progress_report', 'closeout']);

const upsertSchema = z.object({
  key: KeyEnum,
  name: z.string().min(2),
  subject: z.string().min(1),
  html: z.string().min(1),
  text: z.string().min(1),
  description: z.string().optional(),
  placeholders: z.array(z.string().min(1)).optional(),
});

const previewSchema = z.object({
  context: z.record(z.any()).default({}),
});

const rollbackSchema = z.object({
  version: z.number().int().positive(),
});

const toggleActiveSchema = z.object({
  isActive: z.boolean(),
});

async function snapshotVersion(liveDoc, savedBy) {
  await EmailTemplateVersion.create({
    template: liveDoc._id,
    key: liveDoc.key,
    name: liveDoc.name,
    subject: liveDoc.subject,
    html: liveDoc.html,
    text: liveDoc.text,
    description: liveDoc.description,
    placeholders: liveDoc.placeholders || [],
    version: liveDoc.version,
    savedBy,
  });
}

exports.list = async (req, res) => {
  try {
    const docs = await EmailTemplate.find().sort({ key: 1 }).lean();
    res.json({ templates: docs });
  } catch (error) {
    console.error('Error listing templates:', error);
    res.status(500).json({ message: 'Failed to retrieve templates', error: error.message });
  }
};

exports.getByKey = async (req, res) => {
  try {
    const key = KeyEnum.parse(req.params.key);
    const doc = await EmailTemplate.findOne({ key }).lean();
    if (!doc) return res.status(404).json({ message: 'Template not found' });
    res.json({ template: doc });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: 'Invalid template key', error: error.errors });
    }
    console.error('Error getting template:', error);
    res.status(500).json({ message: 'Failed to retrieve template', error: error.message });
  }
};

exports.upsert = async (req, res) => {
  try {
    const input = upsertSchema.parse(req.body);
    let existing = await EmailTemplate.findOne({ key: input.key });
    
    if (existing) {
      await snapshotVersion(existing, req.user?.sub);
      existing.set({
        ...input,
        version: (existing.version || 1) + 1,
        updatedBy: req.user?.sub,
      });
      const saved = await existing.save();
      return res.json({ template: saved.toObject(), versioned: true });
    }
    
    const created = await EmailTemplate.create({
      ...input,
      version: 1,
      createdBy: req.user?.sub,
      updatedBy: req.user?.sub,
      isActive: true,
    });
    await snapshotVersion(created, req.user?.sub);
    res.status(201).json({ template: created.toObject(), versioned: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: 'Validation error', errors: error.errors });
    }
    console.error('Error upserting template:', error);
    res.status(500).json({ message: 'Failed to save template', error: error.message });
  }
};

exports.preview = async (req, res) => {
  try {
    const key = KeyEnum.parse(req.params.key);
    const { context } = previewSchema.parse(req.body || {});
    const tpl = await EmailTemplate.findOne({ key }).lean();
    
    if (!tpl) return res.status(404).json({ message: 'Template not found' });
    
    const rendered = renderTemplate(tpl, context);
    res.json({ rendered, templateVersion: tpl.version, key });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: 'Validation error', errors: error.errors });
    }
    console.error('Error previewing template:', error);
    res.status(500).json({ message: 'Failed to preview template', error: error.message });
  }
};

exports.versions = async (req, res) => {
  try {
    const key = KeyEnum.parse(req.params.key);
    const list = await EmailTemplateVersion.find({ key })
      .select('version name subject createdAt savedBy')
      .sort({ version: -1 })
      .lean();
    res.json({ versions: list });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: 'Invalid template key', errors: error.errors });
    }
    console.error('Error getting versions:', error);
    res.status(500).json({ message: 'Failed to retrieve versions', error: error.message });
  }
};

exports.rollback = async (req, res) => {
  try {
    const key = KeyEnum.parse(req.params.key);
    const { version } = rollbackSchema.parse(req.body);
    
    const live = await EmailTemplate.findOne({ key });
    if (!live) return res.status(404).json({ message: 'Live template not found' });
    
    const target = await EmailTemplateVersion.findOne({ key, version }).lean();
    if (!target) return res.status(404).json({ message: 'Version not found' });
    
    await snapshotVersion(live, req.user?.sub);
    live.set({
      name: target.name,
      subject: target.subject,
      html: target.html,
      text: target.text,
      description: target.description,
      placeholders: target.placeholders || [],
      version: (live.version || 1) + 1,
      updatedBy: req.user?.sub,
    });
    
    const saved = await live.save();
    await snapshotVersion(saved, req.user?.sub);
    res.json({ template: saved.toObject(), rolledBackFrom: version });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: 'Validation error', errors: error.errors });
    }
    console.error('Error rolling back template:', error);
    res.status(500).json({ message: 'Failed to rollback template', error: error.message });
  }
};

exports.toggleActive = async (req, res) => {
  try {
    const key = KeyEnum.parse(req.params.key);
    const { isActive } = toggleActiveSchema.parse(req.body);
    
    const doc = await EmailTemplate.findOneAndUpdate(
      { key },
      { isActive, updatedBy: req.user?.sub },
      { new: true }
    ).lean();
    
    if (!doc) return res.status(404).json({ message: 'Template not found' });
    res.json({ template: doc });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: 'Validation error', errors: error.errors });
    }
    console.error('Error toggling template:', error);
    res.status(500).json({ message: 'Failed to toggle template', error: error.message });
  }
};

exports.getRenderedTemplate = async (key, context = {}) => {
  try {
    KeyEnum.parse(key);
    const tpl = await EmailTemplate.findOne({ key, isActive: true }).lean();
    if (!tpl) throw new Error(`Active template not found for key: ${key}`);
    return renderTemplate(tpl, context);
  } catch (error) {
    console.error(`Error rendering template ${key}:`, error);
    throw error;
  }
};

const sendEmailSchema = z.object({
  to: z.string().email(),
  subject: z.string().optional(),
  text: z.string().optional(),
  html: z.string().optional(),
  context: z.object({}).passthrough().optional(),
  attachments: z.array(z.object({
    filename: z.string(),
    path: z.string().optional(),
    content: z.any().optional(),
  })).optional(),
  cc: z.string().optional(),
  bcc: z.string().optional(),
  jobId: z.string().optional(),
});

exports.sendTemplateEmail = async (req, res) => {
  try {
    console.log('Send email request body:', JSON.stringify(req.body, null, 2));
    
    const key = KeyEnum.parse(req.params.key);
    const parsed = sendEmailSchema.parse(req.body);
    const { to, subject, text, html, context = {}, attachments = [], cc, bcc, jobId } = parsed;
    
    let emailContent;
    if (subject && (text || html)) {
      emailContent = {
        subject,
        text: text || '',
        html: html || (text ? text.replace(/\n/g, '<br>') : ''),
      };
    } else {
      const rendered = await exports.getRenderedTemplate(key, context);
      emailContent = rendered;
    }

    if (key === 'welcome' && jobId && attachments.length > 0) {
      const newContractUrl = attachments[0].path;
      
      await ClientJob.findByIdAndUpdate(jobId, {
        contractFileUrl: newContractUrl
      });

      console.log('✅ Updated contract URL in database:', newContractUrl);

      try {
        await axios.post(
          `${process.env.BACKEND_URL || 'http://localhost:4000'}/api/docusign/send-contract`,
          { jobId },
          {
            headers: {
              'Authorization': req.headers.authorization,
              'Content-Type': 'application/json'
            }
          }
        );

        console.log('✅ DocuSign envelope sent successfully for welcome email');

      } catch (docusignError) {
        console.error('❌ DocuSign error:', docusignError.message);
      }
    }
    
    const result = await sendEmail({
      to,
      subject: emailContent.subject,
      html: emailContent.html,
      text: emailContent.text,
      attachments: attachments,
      cc,
      bcc,
    });

    res.json({ 
      success: true, 
      messageId: result.messageId,
      message: 'Email sent successfully' 
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: 'Validation error', errors: error.errors });
    }
    console.error('Error sending template email:', error);
    res.status(500).json({ message: 'Failed to send email', error: error.message });
  }
};