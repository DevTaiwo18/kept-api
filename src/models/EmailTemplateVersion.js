const mongoose = require('mongoose');

const EmailTemplateVersionSchema = new mongoose.Schema(
  {
    template: { type: mongoose.Schema.Types.ObjectId, ref: 'EmailTemplate', required: true },
    key: { type: String, required: true },
    name: { type: String, required: true },
    subject: { type: String, required: true },
    html: { type: String, required: true },
    text: { type: String, required: true },
    description: { type: String },
    placeholders: [{ type: String }],
    version: { type: Number, required: true },
    savedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('EmailTemplateVersion', EmailTemplateVersionSchema);
