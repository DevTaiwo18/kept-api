const { z } = require('zod');
const ClientJob = require('../models/ClientJob');
const { User } = require('../models/User');
const { sendEmail } = require('../utils/sendEmail');

const servicesSchema = z.object({
  liquidation: z.boolean().optional(),
  donationClearout: z.boolean().optional(),
  cleaning: z.boolean().optional(),
  homeSale: z.boolean().optional(),
  homeRepair: z.boolean().optional(),
}).partial();

const createJobSchema = z.object({
  clientId: z.string().optional(),
  contractSignor: z.string().min(2),
  propertyAddress: z.string().min(3),
  contactPhone: z.string().min(5),
  contactEmail: z.string().email(),
  desiredCompletionDate: z.string().or(z.date()).optional(),
  services: servicesSchema.optional(),
  specialRequests: z.object({
    notForSale: z.string().optional(),
    restrictedAreas: z.string().optional(),
  }).partial().optional(),
  story: z.object({
    owner: z.string().optional(),
    inventory: z.string().optional(),
    property: z.string().optional(),
  }).partial().optional(),
  marketingPhotos: z.array(z.string().url()).optional(),
});

const listQuerySchema = z.object({
  stage: z.enum([
    'walkthrough','staging','online_sale','estate_sale','donations',
    'hauling','payout_processing','closing'
  ]).optional(),
  q: z.string().optional(),
  limit: z.coerce.number().min(1).max(50).default(20),
  cursor: z.string().optional(),
});

const stageSchema = z.object({
  progressStage: z.enum([
    'walkthrough','staging','online_sale','estate_sale','donations',
    'hauling','payout_processing','closing'
  ]),
});

const addNoteSchema = z.object({
  stage: stageSchema.shape.progressStage,
  note: z.string().min(1),
});

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

function ensureOwnershipOrAgent(job, req) {
  const isAgent = req.user.role === 'agent';
  const isOwner = String(job.client) === String(req.user.sub);
  if (!isAgent && !isOwner) {
    const err = new Error('Forbidden');
    err.status = 403;
    throw err;
  }
}

function getStageName(stage) {
  const stageNames = {
    walkthrough: 'Walkthrough',
    staging: 'Staging',
    online_sale: 'Online Sale',
    estate_sale: 'Estate Sale',
    donations: 'Donations',
    hauling: 'Hauling',
    payout_processing: 'Payout Processing',
    closing: 'Closing',
  };
  return stageNames[stage] || stage;
}

exports.createJob = async (req, res) => {
  try {
    const input = createJobSchema.parse(req.body);
    let clientId = req.user.sub;
    if (req.user.role === 'agent' && input.clientId) {
      clientId = input.clientId;
    } else if (req.user.role === 'agent' && !input.clientId) {
      return res.status(400).json({ message: 'clientId is required when creating as agent' });
    }

    const job = await ClientJob.create({
      client: clientId,
      accountManager: req.user.role === 'agent' ? req.user.sub : undefined,
      ...input,
      desiredCompletionDate: input.desiredCompletionDate
        ? new Date(input.desiredCompletionDate)
        : undefined,
    });

    try {
      const content = `
        <div style="text-align: center; padding: 20px 0;">
          <div style="display: inline-block; background-color: #e8f5e9; border-radius: 50%; width: 80px; height: 80px; line-height: 80px; margin-bottom: 20px;">
            <span style="font-size: 40px;">🎉</span>
          </div>
        </div>
        <p style="font-size: 16px; line-height: 1.6; color: #333; margin: 0 0 15px 0; font-family: Arial, sans-serif;">
          Great news! Your project at <strong style="color: #e6c35a;">${input.propertyAddress}</strong> has been successfully created.
        </p>
        <div style="background-color: #f9f9f9; border-left: 4px solid #e6c35a; padding: 15px 20px; margin: 20px 0; border-radius: 4px;">
          <p style="font-size: 14px; line-height: 1.6; color: #555; margin: 0; font-family: Arial, sans-serif;">
            <strong>Project Details:</strong><br/>
            Location: ${input.propertyAddress}<br/>
            Contact: ${input.contactEmail}<br/>
            Phone: ${input.contactPhone}
          </p>
        </div>
        <p style="font-size: 16px; line-height: 1.6; color: #333; margin: 20px 0 0 0; font-family: Arial, sans-serif;">
          We're here to make this process smooth and stress-free. Our team will reach out shortly with next steps. If you have any questions, feel free to reach out anytime.
        </p>
      `;

      await sendEmail({
        to: input.contactEmail,
        subject: 'Kept House — Your project has been created',
        html: getEmailTemplate(input.contractSignor, content),
        text: `Hi ${input.contractSignor}, Great news! Your project at ${input.propertyAddress} has been successfully created. We're here to make this process smooth and stress-free. Best regards, The Kept House Team`,
      });
    } catch (emailErr) {
      console.error('Failed to send job creation email:', emailErr);
    }

    res.status(201).json({ job });
  } catch (err) {
    if (err?.issues) return res.status(400).json({ message: 'Invalid input', issues: err.issues });
    res.status(err.status || 500).json({ message: err.message || 'Server error' });
  }
};

exports.listJobs = async (req, res) => {
  try {
    const q = listQuerySchema.parse(req.query);
    const filter = {};
    if (req.user.role !== 'agent') filter.client = req.user.sub;
    if (q.stage) filter.stage = q.stage;
    if (q.q) {
      filter.$or = [
        { contractSignor: new RegExp(q.q, 'i') },
        { propertyAddress: new RegExp(q.q, 'i') },
        { contactEmail: new RegExp(q.q, 'i') },
      ];
    }
    if (q.cursor) filter._id = { $lt: q.cursor };

    const jobs = await ClientJob.find(filter)
      .sort({ _id: -1 })
      .limit(q.limit + 1)
      .select('contractSignor propertyAddress stage desiredCompletionDate createdAt');

    let nextCursor = null;
    if (jobs.length > q.limit) {
      nextCursor = jobs[q.limit - 1]._id;
      jobs.pop();
    }

    res.json({ jobs, nextCursor });
  } catch (err) {
    if (err?.issues) return res.status(400).json({ message: 'Invalid query', issues: err.issues });
    res.status(500).json({ message: 'Server error' });
  }
};

exports.getJob = async (req, res) => {
  try {
    const job = await ClientJob.findById(req.params.id);
    if (!job) return res.status(404).json({ message: 'Not found' });
    ensureOwnershipOrAgent(job, req);
    res.json({ job });
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message || 'Server error' });
  }
};

exports.updateStage = async (req, res) => {
  try {
    const { progressStage } = stageSchema.parse(req.body);
    const job = await ClientJob.findById(req.params.id);
    if (!job) return res.status(404).json({ message: 'Not found' });
    if (req.user.role !== 'agent') return res.status(403).json({ message: 'Forbidden' });
    
    job.stage = progressStage;
    await job.save();

    try {
      const stageName = getStageName(progressStage);

      const stageIcons = {
        walkthrough: '🚶',
        staging: '🎬',
        online_sale: '🛒',
        estate_sale: '🏷️',
        donations: '🤝',
        hauling: '🚚',
        payout_processing: '💰',
        closing: '✅',
      };
      
      const content = `
        <div style="text-align: center; padding: 20px 0;">
          <div style="display: inline-block; background: linear-gradient(135deg, #e6c35a 0%, #d4af37 100%); border-radius: 50%; width: 80px; height: 80px; line-height: 80px; margin-bottom: 20px;">
            <span style="font-size: 40px;">${stageIcons[progressStage] || '📋'}</span>
          </div>
        </div>
        <p style="font-size: 16px; line-height: 1.6; color: #333; margin: 0 0 15px 0; font-family: Arial, sans-serif;">
          Great progress! Your project at <strong style="color: #e6c35a;">${job.propertyAddress}</strong> has moved to a new stage.
        </p>
        <div style="background: linear-gradient(135deg, #f9f9f9 0%, #ffffff 100%); border: 2px solid #e6c35a; border-radius: 8px; padding: 25px; text-align: center; margin: 25px 0;">
          <p style="font-size: 14px; color: #666; margin: 0 0 10px 0; font-family: Arial, sans-serif; text-transform: uppercase; letter-spacing: 1px;">
            Current Stage
          </p>
          <h2 style="color: #e6c35a; font-family: Arial, sans-serif; font-size: 28px; margin: 0; font-weight: 600;">
            ${stageName}
          </h2>
        </div>
        <p style="font-size: 16px; line-height: 1.6; color: #333; margin: 20px 0 0 0; font-family: Arial, sans-serif;">
          We'll keep you updated as things progress. If you have any questions about this stage, don't hesitate to reach out.
        </p>
      `;
      
      await sendEmail({
        to: job.contactEmail,
        subject: `Your project moved to ${stageName}`,
        html: getEmailTemplate(job.contractSignor, content),
        text: `Hi ${job.contractSignor}, Great progress! Your project at ${job.propertyAddress} has moved to the ${stageName} stage. We'll keep you updated as things progress. Best regards, The Kept House Team`,
      });
    } catch (emailErr) {
      console.error('Failed to send stage update email:', emailErr);
    }

    res.json({ job: { _id: job._id, stage: job.stage, updatedAt: job.updatedAt } });
  } catch (err) {
    if (err?.issues) return res.status(400).json({ message: 'Invalid input', issues: err.issues });
    res.status(500).json({ message: 'Server error' });
  }
};

exports.addStageNote = async (req, res) => {
  try {
    const input = addNoteSchema.parse(req.body);
    const job = await ClientJob.findById(req.params.id);
    if (!job) return res.status(404).json({ message: 'Not found' });
    ensureOwnershipOrAgent(job, req);
    job.stageNotes.push({ stage: input.stage, note: input.note, by: req.user.sub });
    await job.save();
    res.status(201).json({ ok: true });
  } catch (err) {
    if (err?.issues) return res.status(400).json({ message: 'Invalid input', issues: err.issues });
    res.status(err.status || 500).json({ message: err.message || 'Server error' });
  }
};

exports.addDailySales = async (req, res) => {
  try {
    const schema = z.object({
      label: z.string().min(1),
      amount: z.coerce.number().nonnegative(),
    });
    const input = schema.parse(req.body);
    const job = await ClientJob.findById(req.params.id);
    if (!job) return res.status(404).json({ message: 'Not found' });
    if (req.user.role !== 'agent') return res.status(403).json({ message: 'Forbidden' });
    job.finance.daily.push({ label: input.label, amount: input.amount });
    job.finance.gross = (job.finance.gross || 0) + input.amount;
    job.finance.net = (job.finance.gross || 0) - ((job.finance.fees || 0) + (job.finance.haulingCost || 0));
    await job.save();
    res.status(201).json({ finance: job.finance });
  } catch (err) {
    if (err?.issues) return res.status(400).json({ message: 'Invalid input', issues: err.issues });
    res.status(500).json({ message: 'Server error' });
  }
};