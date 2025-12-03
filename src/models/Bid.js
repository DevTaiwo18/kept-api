const mongoose = require('mongoose');

const BidSchema = new mongoose.Schema({
  job: { type: mongoose.Schema.Types.ObjectId, ref: 'ClientJob', required: true, index: true },
  vendor: { type: mongoose.Schema.Types.ObjectId, ref: 'Vendor', required: true, index: true },
  amount: { type: Number, required: true },
  timelineDays: { type: Number, default: 0 },
  status: { type: String, enum: ['submitted','accepted','rejected'], default: 'submitted', index: true },

  // Bid type based on job stage when bid was submitted
  bidType: { type: String, enum: ['donation', 'hauling'], required: true, index: true },

  // Payment information (submitted with bid)
  paymentMethod: { type: String, enum: ['cash', 'cashapp', 'bank'], required: true },
  cashAppHandle: { type: String, trim: true },
  bankDetails: {
    bankName: { type: String, trim: true },
    accountNumber: { type: String, trim: true },
    routingNumber: { type: String, trim: true },
    accountHolderName: { type: String, trim: true }
  },

  // Work completion tracking (vendor marks when done with donation/hauling)
  workCompleted: { type: Boolean, default: false },
  workCompletedAt: { type: Date },

  // Payment tracking (updated by agent after paying vendor)
  isPaid: { type: Boolean, default: false },
  paidAt: { type: Date },
  paidAmount: { type: Number },

  // Receipt (uploaded by vendor after job completion)
  receipt: {
    url: { type: String },
    uploadedAt: { type: Date }
  }
}, { timestamps: true });

module.exports = mongoose.model('Bid', BidSchema);
