const { z } = require('zod');
const ClientJob = require('../models/ClientJob');
const { User } = require('../models/User');

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

function ensureOwnershipOrAgent(job, req) {
  const isAgent = req.user.role === 'agent';
  const isOwner = String(job.client) === String(req.user.sub);
  if (!isAgent && !isOwner) {
    const err = new Error('Forbidden');
    err.status = 403;
    throw err;
  }
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
