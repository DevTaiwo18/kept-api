const { z } = require('zod');
const EmailTemplate = require('../models/EmailTemplate');
const EmailTemplateVersion = require('../models/EmailTemplateVersion');

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
  const docs = await EmailTemplate.find().sort({ key: 1 }).lean();
  res.json({ templates: docs });
};

exports.getByKey = async (req, res) => {
  const key = KeyEnum.parse(req.params.key);
  const doc = await EmailTemplate.findOne({ key }).lean();
  if (!doc) return res.status(404).json({ message: 'Not found' });
  res.json({ template: doc });
};

exports.upsert = async (req, res) => {
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
};

exports.preview = async (req, res) => {
  const key = KeyEnum.parse(req.params.key);
  const { context } = previewSchema.parse(req.body || {});
  const tpl = await EmailTemplate.findOne({ key }).lean();
  if (!tpl) return res.status(404).json({ message: 'Not found' });
  const rendered = renderTemplate(tpl, context);
  res.json({ rendered, templateVersion: tpl.version, key });
};

exports.versions = async (req, res) => {
  const key = KeyEnum.parse(req.params.key);
  const list = await EmailTemplateVersion.find({ key })
    .select('version name subject createdAt savedBy')
    .sort({ version: -1 })
    .lean();
  res.json({ versions: list });
};

exports.rollback = async (req, res) => {
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
};

exports.toggleActive = async (req, res) => {
  const key = KeyEnum.parse(req.params.key);
  const { isActive } = toggleActiveSchema.parse(req.body);
  const doc = await EmailTemplate.findOneAndUpdate(
    { key },
    { isActive, updatedBy: req.user?.sub },
    { new: true }
  ).lean();
  if (!doc) return res.status(404).json({ message: 'Not found' });
  res.json({ template: doc });
};

exports.getRenderedTemplate = async (key, context = {}) => {
  KeyEnum.parse(key);
  const tpl = await EmailTemplate.findOne({ key, isActive: true }).lean();
  if (!tpl) throw new Error(`Active template not found for key: ${key}`);
  return renderTemplate(tpl, context);
};
