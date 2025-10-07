const mongoose = require('mongoose');

const BidSchema = new mongoose.Schema({
  job: { type: mongoose.Schema.Types.ObjectId, ref: 'ClientJob', required: true, index: true },
  vendor: { type: mongoose.Schema.Types.ObjectId, ref: 'Vendor', required: true, index: true },
  amount: { type: Number, required: true },
  timelineDays: { type: Number, default: 0 },
  status: { type: String, enum: ['submitted','accepted','rejected'], default: 'submitted', index: true },
}, { timestamps: true });

module.exports = mongoose.model('Bid', BidSchema);
