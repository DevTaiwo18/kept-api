const mongoose = require('mongoose');

const cartItemSchema = new mongoose.Schema({
  itemId: { 
    type: String, 
    required: true 
  },
  addedAt: { 
    type: Date, 
    default: Date.now 
  }
}, { _id: false });

const cartSchema = new mongoose.Schema({
  user: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: true,
    unique: true
  },
  items: [cartItemSchema],
  updatedAt: { 
    type: Date, 
    default: Date.now 
  }
}, {
  timestamps: true
});

cartSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model('Cart', cartSchema);