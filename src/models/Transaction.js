const mongoose = require('mongoose');

const TransactionSchema = new mongoose.Schema({
  job: { type: mongoose.Schema.Types.ObjectId, ref: 'ClientJob', required: true, index: true },
  item: { type: mongoose.Schema.Types.ObjectId, ref: 'Item' }, 
  type: { type: String, enum: ['sale','fee','hauling','payout','refund'], required: true, index: true },
  amount: { type: Number, required: true }, 
  meta: { type: Object }, 
}, { timestamps: true });

module.exports = mongoose.model('Transaction', TransactionSchema);
