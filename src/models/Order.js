const mongoose = require('mongoose');

const OrderItemSchema = new mongoose.Schema({
  compositeId: { type: String, required: true, index: true },
  itemDocId: { type: mongoose.Schema.Types.ObjectId, ref: 'Item', required: true },
  photoIndex: { type: Number, required: true },
  title: { type: String, required: true },
  photo: { type: String, default: '' },
  unitPrice: { type: Number, required: true },
  quantity: { type: Number, default: 1 },
  subtotal: { type: Number, required: true }
}, { _id: false });

const DeliveryDetailsSchema = new mongoose.Schema({
  type: { type: String, enum: ['pickup', 'delivery'], default: 'pickup' },
  scheduledAt: { type: Date },
  address: { type: String },
  instructions: { type: String }
}, { _id: false });

const OrderSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  items: { type: [OrderItemSchema], required: true },
  currency: { type: String, default: 'usd' },
  totalAmount: { type: Number, required: true },
  paymentStatus: { type: String, enum: ['pending', 'paid', 'failed', 'refunded', 'canceled'], default: 'pending', index: true },
  paymentProvider: { type: String, default: 'stripe' },
  stripe: {
    sessionId: { type: String, index: true, unique: true, sparse: true },
    paymentIntentId: { type: String },
    customerEmail: { type: String }
  },
  deliveryDetails: { type: DeliveryDetailsSchema, default: undefined }
}, { timestamps: true });

module.exports = mongoose.model('Order', OrderSchema);
