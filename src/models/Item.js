const mongoose = require('mongoose');

const ItemSchema = new mongoose.Schema(
  {
    job: { type: mongoose.Schema.Types.ObjectId, ref: 'ClientJob', required: true, index: true },
    uploader: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    uploaderRole: { type: String, enum: ['client', 'agent'], index: true },

    photos: [{ type: String, required: true }],
    analyzedPhotoIndices: [{ type: Number }],

    status: {
      type: String,
      enum: ['draft', 'needs_review', 'approved', 'listed', 'sold', 'donated'],
      default: 'draft',
      index: true,
    },

    ai: [{
      photoIndex: Number,
      photoUrl: String,
      title: String,
      description: String,
      category: {
        type: String,
        enum: [
          'Furniture',
          'Tools',
          'Jewelry',
          'Art',
          'Electronics',
          'Outdoor',
          'Appliances',
          'Kitchen',
          'Collectibles',
          'Books/Media',
          'Clothing',
          'Misc',
        ],
        default: 'Misc',
      },
      priceLow: Number,
      priceHigh: Number,
      confidence: Number,
    }],

    approvedItems: [{
      photoIndex: Number,
      title: String,
      description: String,
      category: String,
      priceLow: Number,
      priceHigh: Number,
      price: Number,
    }],

    reopenHistory: [{
      reopenedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      reason: String,
      reopenedAt: { type: Date, default: Date.now }
    }],

    title: String,
    description: String,
    category: String,
    price: Number,

    soldAt: { type: Date },
    donationReceiptUrl: { type: String },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Item', ItemSchema);