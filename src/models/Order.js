const mongoose = require('mongoose');

const OrderItemSchema = new mongoose.Schema({
  compositeId: { type: String, required: true, index: true },
  itemDocId: { type: mongoose.Schema.Types.ObjectId, ref: 'Item', required: true },
  itemNumber: { type: Number, required: true },
  photoIndices: [{ type: Number }],
  title: { type: String, required: true },
  photo: { type: String, default: '' },
  photos: [{ type: String }],
  unitPrice: { type: Number, required: true },
  quantity: { type: Number, default: 1 },
  subtotal: { type: Number, required: true }
}, { _id: false });

const DeliveryDetailsSchema = new mongoose.Schema({
  type: { type: String, enum: ['pickup', 'shipping'], required: true },
  scheduledAt: { type: Date },
  
  fullName: { type: String, required: true },
  phoneNumber: { type: String, required: true },
  email: { type: String },
  
  address: { type: String },
  city: { type: String },
  state: { type: String },
  zipCode: { type: String },
  
  instructions: { type: String }
}, { _id: false });

const ShippingDetailsSchema = new mongoose.Schema({
  carrier: { type: String },
  service: { type: String },
  rate: { type: Number },
  estimatedDays: { type: Number },
  trackingNumber: { type: String },
  labelUrl: { type: String }
}, { _id: false });

const OrderSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  job: { type: mongoose.Schema.Types.ObjectId, ref: 'Job', required: true, index: true },
  items: { type: [OrderItemSchema], required: true },
  currency: { type: String, default: 'usd' },
  
  subtotal: { type: Number, required: true },
  deliveryFee: { type: Number, default: 0 },
  taxAmount: { type: Number, default: 0 },
  totalAmount: { type: Number, required: true },
  
  paymentStatus: { 
    type: String, 
    enum: ['pending', 'paid', 'failed', 'refunded', 'canceled'], 
    default: 'pending', 
    index: true 
  },
  paymentProvider: { type: String, default: 'stripe' },
  
  stripe: {
    sessionId: { type: String, index: true, unique: true, sparse: true },
    paymentIntentId: { type: String },
    customerEmail: { type: String }
  },
  
  deliveryDetails: { type: DeliveryDetailsSchema },
  shippingDetails: { type: ShippingDetailsSchema },
  
  fulfillmentStatus: {
    type: String,
    enum: ['pending', 'processing', 'ready', 'shipped', 'delivered', 'picked_up'],
    default: 'pending'
  }
}, { timestamps: true });

module.exports = mongoose.model('Order', OrderSchema);