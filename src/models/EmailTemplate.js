const mongoose = require('mongoose');

const TEMPLATE_KEYS = ['welcome', 'progress_report', 'closeout'];

const EmailTemplateSchema = new mongoose.Schema(
  {
    key: { type: String, enum: TEMPLATE_KEYS, required: true, unique: true },
    name: { type: String, required: true },
    subject: { type: String, required: true },
    html: { type: String, required: true },
    text: { type: String, required: true },
    description: { type: String },
    placeholders: [{ type: String }], 
    version: { type: Number, default: 1 },
    isActive: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('EmailTemplate', EmailTemplateSchema);
module.exports.TEMPLATE_KEYS = TEMPLATE_KEYS;
