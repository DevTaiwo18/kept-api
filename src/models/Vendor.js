const mongoose = require('mongoose');

const VendorSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  companyName: { type: String, trim: true },
  type: { type: String, enum: ['donation_partner','hauler','cleaner','other'], default: 'donation_partner', index: true },
  serviceType: { type: String, enum: ['hauling', 'donation', 'both'], default: 'both', index: true },
  email: { type: String, lowercase: true },
  phone: { type: String },
  serviceArea: { type: String, trim: true },
  notes: { type: String },
  active: { type: Boolean, default: true }
}, { timestamps: true });

module.exports = mongoose.model('Vendor', VendorSchema);
