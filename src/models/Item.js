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
  soldPhotoIndices: [Number],
  soldAt: Date,
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