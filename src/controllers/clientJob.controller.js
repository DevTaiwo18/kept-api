const { z } = require('zod');
const ClientJob = require('../models/ClientJob');
const { User } = require('../models/User');
const { stripe } = require('../services/stripe');
const { sendEmail } = require('../utils/sendEmail');

function calculateKeptHouseCommission(grossSales) {
  let commission = 0;
  
  if (grossSales <= 7500) {
    commission = grossSales * 0.50;
  } else if (grossSales <= 20000) {
    commission = (7500 * 0.50) + ((grossSales - 7500) * 0.40);
  } else {
    commission = (7500 * 0.50) + (12500 * 0.40) + ((grossSales - 20000) * 0.30);
  }
  
  return Math.round(commission * 100) / 100;
}

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

const requestDepositSchema = z.object({
  serviceFee: z.coerce.number().positive(),
  depositAmount: z.coerce.number().refine((val) => val === 250 || val === 500, {
    message: 'Deposit amount must be either 250 or 500'
  }),
  scopeNotes: z.string().optional(),
});

const listQuerySchema = z.object({
  stage: z.enum([
    'walkthrough', 'staging', 'online_sale', 'estate_sale', 'donations',
    'hauling', 'payout_processing', 'closing'
  ]).optional(),
  status: z.enum(['awaiting_deposit', 'active', 'completed', 'cancelled']).optional(),
  q: z.string().optional(),
  limit: z.coerce.number().min(1).max(50).default(20),
  cursor: z.string().optional(),
});

const stageEnum = z.enum([
  'walkthrough', 'staging', 'online_sale', 'estate_sale', 'donations',
  'hauling', 'payout_processing', 'closing'
]);

function ensureOwnershipOrAgent(job, req) {
  const isAgent = req.user.role === 'agent';
  const isOwner = String(job.client) === String(req.user.sub);
  if (!isAgent && !isOwner) {
    const err = new Error('Forbidden');
    err.status = 403;
    throw err;
  }
}

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

const STAGE_LABEL = {
  walkthrough: 'Walkthrough',
  staging: 'Staging / Prep',
  online_sale: 'Online Sale',
  estate_sale: 'Estate Sale',
  donations: 'Donations',
  hauling: 'Hauling',
  payout_processing: 'Payout Processing',
  closing: 'Closing'
};

async function notifyClient(job, { stage, note, byUserName }) {
  const clientEmail = job?.client?.email || job?.contactEmail;
  const clientName = job?.client?.name || job?.contractSignor || 'there';
  if (!clientEmail) return;

  const stageLabel = STAGE_LABEL[stage] ?? stage;
  const hasNote = !!(note && note.trim());

  const subject = hasNote
    ? `Update on ${stageLabel}: A new note was added`
    : `Project Update: Status moved to ${stageLabel}`;

  const content = hasNote
    ? `
      <p>Your project at <strong>${job.propertyAddress}</strong> has a new update on <strong>${stageLabel}</strong>.</p>
      <div style="background:#f9f9f9;border-left:4px solid #e6c35a;padding:16px;border-radius:4px;margin:16px 0">
        <p style="margin:0;white-space:pre-wrap">${note}</p>
      </div>
      ${byUserName ? `<p><em>Posted by ${byUserName}</em></p>` : ''}
      <p>Visit your dashboard for details and next steps.</p>`
    : `
      <p>Your project at <strong>${job.propertyAddress}</strong> has moved to: <strong>${stageLabel}</strong>.</p>
      <p>You can view the latest progress in your dashboard.</p>`;

  await sendEmail({
    to: clientEmail,
    subject,
    html: getEmailTemplate(clientName, content),
    text: hasNote
      ? `A new note was added on ${stageLabel} for your project at ${job.propertyAddress}:\n\n${note}`
      : `Your project at ${job.propertyAddress} is now at: ${stageLabel}.`
  });
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
      status: 'awaiting_deposit',
    });

    const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@keptestate.com';

    const adminContent = `
      <p style="font-size: 16px; line-height: 1.6; color: #333; margin: 0 0 15px 0; font-family: Arial, sans-serif;">
        A new client has just joined the Kept House platform!
      </p>
      <div style="background-color: #f9f9f9; border-left: 4px solid #e6c35a; padding: 20px; margin: 20px 0; border-radius: 4px;">
        <p style="font-size: 14px; line-height: 1.8; color: #333; margin: 0; font-family: Arial, sans-serif;">
          <strong style="color: #101010;">Client Name:</strong> ${input.contractSignor}<br/>
          <strong style="color: #101010;">Client Email:</strong> ${input.contactEmail}<br/>
          <strong style="color: #101010;">Phone:</strong> ${input.contactPhone}<br/>
          <strong style="color: #101010;">Property Address:</strong> ${input.propertyAddress}
        </p>
      </div>
      <div style="background-color: #fff9e6; border-left: 4px solid #ffc107; padding: 20px; margin: 20px 0; border-radius: 4px;">
        <p style="font-size: 14px; line-height: 1.6; color: #856404; margin: 0 0 10px 0; font-family: Arial, sans-serif;">
          <strong>📋 To proceed with this project:</strong>
        </p>
        <p style="font-size: 14px; line-height: 1.6; color: #856404; margin: 0; font-family: Arial, sans-serif;">
          Please login to your dashboard and search by client name <strong>${input.contractSignor}</strong> to locate the project.
        </p>
      </div>
      <p style="font-size: 16px; line-height: 1.6; color: #333; margin: 20px 0 15px 0; font-family: Arial, sans-serif;">
        <strong>Next Steps:</strong>
      </p>
      <ul style="font-size: 16px; line-height: 1.8; color: #333; margin: 0 0 25px 20px; font-family: Arial, sans-serif; padding: 0;">
        <li style="margin-bottom: 8px;">Review the project details</li>
        <li style="margin-bottom: 8px;">Set the service fee and deposit amount</li>
        <li style="margin-bottom: 8px;">Send deposit request to client</li>
        <li style="margin-bottom: 8px;">Send personal welcome email to the client</li>
      </ul>
    `;

    try {
      await sendEmail({
        to: ADMIN_EMAIL,
        subject: `New Client Registration: ${input.contractSignor}`,
        html: getEmailTemplate('Admin', adminContent),
        text: `New Client Registration - A new client has just joined the Kept House platform! Client Name: ${input.contractSignor}, Client Email: ${input.contactEmail}, Phone: ${input.contactPhone}, Property Address: ${input.propertyAddress}. To proceed with this project: Please login to your dashboard and search by client name ${input.contractSignor} to locate the project. Next Steps: Review the project details, Set the service fee and deposit amount, Send deposit request to client, Send personal welcome email to the client.`,
      });
    } catch (emailErr) {
      console.error('Failed to send admin notification:', emailErr);
    }

    res.status(201).json({ job });
  } catch (err) {
    if (err?.issues) return res.status(400).json({ message: 'Invalid input', issues: err.issues });
    res.status(err.status || 500).json({ message: err.message || 'Server error' });
  }
};

exports.requestDeposit = async (req, res) => {
  try {
    const input = requestDepositSchema.parse(req.body);
    const job = await ClientJob.findById(req.params.id);

    if (!job) return res.status(404).json({ message: 'Not found' });
    if (req.user.role !== 'agent') return res.status(403).json({ message: 'Agents only' });

    if (input.depositAmount > input.serviceFee) {
      return res.status(400).json({ message: 'Deposit amount cannot exceed service fee' });
    }

    job.serviceFee = input.serviceFee;
    job.depositAmount = input.depositAmount;
    job.scopeNotes = input.scopeNotes || '';
    job.status = 'awaiting_deposit';

    await job.save();

    res.json({
      message: 'Deposit request sent',
      job: {
        _id: job._id,
        serviceFee: job.serviceFee,
        depositAmount: job.depositAmount,
        scopeNotes: job.scopeNotes,
        status: job.status
      }
    });
  } catch (err) {
    if (err?.issues) return res.status(400).json({ message: 'Invalid input', issues: err.issues });
    res.status(err.status || 500).json({ message: err.message || 'Server error' });
  }
};

exports.createDepositCheckout = async (req, res) => {
  try {
    const job = await ClientJob.findById(req.params.id).populate('client', 'email name');

    if (!job) return res.status(404).json({ message: 'Job not found' });

    const isOwner = String(job.client._id) === String(req.user.sub);
    if (!isOwner && req.user.role !== 'agent') {
      return res.status(403).json({ message: 'Forbidden' });
    }

    if (job.status !== 'awaiting_deposit') {
      return res.status(400).json({ message: 'Deposit already paid or not requested' });
    }

    if (!job.serviceFee || job.serviceFee <= 0) {
      return res.status(400).json({ message: 'Service fee not set. Agent must request deposit first.' });
    }

    if (!job.depositAmount || job.depositAmount <= 0) {
      return res.status(400).json({ message: 'Deposit amount not set. Agent must request deposit first.' });
    }

    const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: process.env.CURRENCY || 'usd',
          product_data: {
            name: `Initial Deposit - ${job.propertyAddress}`,
            description: `Service Fee: $${job.serviceFee.toFixed(2)} | Deposit: $${job.depositAmount.toFixed(2)}`
          },
          unit_amount: Math.round(job.depositAmount * 100)
        },
        quantity: 1
      }],
      success_url: `${FRONTEND_URL}/client/project/${job._id}?payment=success`,
      cancel_url: `${FRONTEND_URL}/client/project/${job._id}?payment=cancelled`,
      customer_email: job.client.email || job.contactEmail,
      metadata: {
        jobId: String(job._id),
        userId: String(job.client._id),
        depositType: 'initial_deposit',
        serviceFee: String(job.serviceFee),
        depositAmount: String(job.depositAmount)
      }
    });

    job.stripe = job.stripe || {};
    job.stripe.sessionId = session.id;
    await job.save();

    res.json({ url: session.url, sessionId: session.id, jobId: String(job._id) });

  } catch (err) {
    console.error('Deposit checkout error:', err);
    res.status(500).json({ message: 'Failed to create checkout session' });
  }
};

exports.listJobs = async (req, res) => {
  try {
    const q = listQuerySchema.parse(req.query);
    const filter = {};
    if (req.user.role !== 'agent') filter.client = req.user.sub;
    if (q.stage) filter.stage = q.stage;
    if (q.status) filter.status = q.status;
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
      .select('contractSignor propertyAddress stage status desiredCompletionDate createdAt finance serviceFee depositAmount depositPaidAt');

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

exports.updateProgress = async (req, res) => {
  try {
    const body = z.object({
      progressStage: stageEnum,
      note: z.string().optional()
    }).parse(req.body);

    const job = await ClientJob.findById(req.params.id).populate('client', 'email name');
    if (!job) return res.status(404).json({ message: 'Not found' });
    if (req.user.role !== 'agent') return res.status(403).json({ message: 'Forbidden' });
    if (job.status === 'awaiting_deposit') {
      return res.status(400).json({ message: 'Cannot update stage before deposit is received' });
    }

    job.stage = body.progressStage;
    if (body.note?.trim()) {
      job.stageNotes.push({ stage: body.progressStage, note: body.note.trim(), by: req.user.sub });
    }
    await job.save();

    let byUserName;
    if (req.user.role === 'agent') {
      const agent = await User.findById(req.user.sub).select('name').lean();
      byUserName = agent?.name;
    }

    await notifyClient(job, {
      stage: body.progressStage,
      note: body.note,
      byUserName
    });

    res.json({ ok: true, job: { _id: job._id, stage: job.stage, updatedAt: job.updatedAt } });
  } catch (err) {
    if (err?.issues) return res.status(400).json({ message: 'Invalid input', issues: err.issues });
    res.status(500).json({ message: err.message || 'Server error' });
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

    const keptHouseCommission = calculateKeptHouseCommission(job.finance.gross);
    job.finance.fees = keptHouseCommission;

    const serviceFee = (job.serviceFee && job.serviceFee > 0) ? job.serviceFee : 0;
    const depositPaid = (job.depositAmount && job.depositAmount > 0 && job.depositPaidAt) ? job.depositAmount : 0;
    const haulingCost = job.finance.haulingCost || 0;

    job.finance.net = job.finance.gross - serviceFee - keptHouseCommission - haulingCost + depositPaid;

    await job.save();

    res.status(201).json({ finance: job.finance });
  } catch (err) {
    if (err?.issues) return res.status(400).json({ message: 'Invalid input', issues: err.issues });
    res.status(500).json({ message: 'Server error' });
  }
};