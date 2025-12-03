const mongoose = require('mongoose');

const itemSchema = new mongoose.Schema({
  job: { type: mongoose.Schema.Types.ObjectId, ref: 'ClientJob', required: true },
  uploader: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  uploaderRole: { type: String, enum: ['client', 'agent'], required: true },
  photos: [String],
  photoGroups: [{
    itemNumber: { type: Number, required: true },
    title: { type: String, default: '' },
    startIndex: { type: Number, required: true },
    endIndex: { type: Number, required: true },
    photoCount: { type: Number, required: true }
  }],
  analyzedGroupIndices: [Number],
  ai: [{
    itemNumber: Number,
    photoIndices: [Number],
    title: String,
    description: String,
    category: String,
    priceLow: Number,
    priceHigh: Number,
    confidence: Number,
    dimensions: {
      length: { type: Number },
      width: { type: Number },
      height: { type: Number },
      unit: { type: String, enum: ['inches', 'cm'], default: 'inches' }
    },
    weight: {
      value: { type: Number },
      unit: { type: String, enum: ['lbs', 'kg'], default: 'lbs' }
    },
    material: { type: String },
    tags: [String]
  }],
  approvedItems: [{
    itemNumber: Number,
    photoIndices: [Number],
    title: String,
    description: String,
    category: String,
    priceLow: Number,
    priceHigh: Number,
    price: Number,
    estateSalePrice: { type: Number, default: null },
    estateSalePriceSetAt: { type: Date, default: null },
    estateSalePriceSetBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    dimensions: {
      length: { type: Number },
      width: { type: Number },
      height: { type: Number },
      unit: { type: String, enum: ['inches', 'cm'], default: 'inches' }
    },
    weight: {
      value: { type: Number },
      unit: { type: String, enum: ['lbs', 'kg'], default: 'lbs' }
    },
    material: { type: String },
    tags: [String],
    // Item disposition tracking
    disposition: {
      type: String,
      enum: ['available', 'sold', 'donated', 'hauled'],
      default: 'available'
    },
    dispositionAt: { type: Date, default: null },
    dispositionBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }
  }],
  soldPhotoIndices: [Number],
  soldAt: Date,
  donatedPhotoIndices: [Number],
  donatedAt: Date,
  hauledPhotoIndices: [Number],
  hauledAt: Date,
  status: { 
    type: String, 
    enum: ['draft', 'pending', 'approved', 'needs_review'], 
    default: 'draft' 
  },
  reopenHistory: [{
    reopenedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reason: String,
    reopenedAt: { type: Date, default: Date.now }
  }]
}, { timestamps: true });

module.exports = mongoose.model('Item', itemSchema);