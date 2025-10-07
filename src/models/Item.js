const mongoose = require('mongoose');

const ItemSchema = new mongoose.Schema({
  job: { type: mongoose.Schema.Types.ObjectId, ref: 'ClientJob', required: true, index: true },
  uploader: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true }, 

  photos: [{ type: String, required: true }], 
  status: {
    type: String,
    enum: ['draft','approved','listed','sold','donated'],
    default: 'draft',
    index: true
  },

  ai: {
    title: String,
    description: String,
    category: {
      type: String,
      enum: ['Furniture','Tools','Jewelry','Art','Electronics','Outdoor','Appliances','Kitchen','Collectibles','Books/Media','Clothing','Misc'],
      default: 'Misc'
    },
    priceLow: Number,
    priceHigh: Number,
    confidence: Number
  },

  title: String,
  description: String,
  category: String,
  price: Number,

  soldAt: { type: Date },
  donationReceiptUrl: { type: String },
}, { timestamps: true });

module.exports = mongoose.model('Item', ItemSchema);
