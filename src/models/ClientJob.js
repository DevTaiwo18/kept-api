const mongoose = require('mongoose');

const ServicesSchema = new mongoose.Schema({
  liquidation: { type: Boolean, default: false },
  donationClearout: { type: Boolean, default: false },
  cleaning: { type: Boolean, default: false },
  homeSale: { type: Boolean, default: false },
  homeRepair: { type: Boolean, default: false },
}, { _id: false });

const ClientJobSchema = new mongoose.Schema({
  client: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true }, // role=client
  accountManager: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true }, // role=agent

  contractSignor: { type: String, required: true, trim: true },
  propertyAddress: { type: String, required: true },
  contactPhone: { type: String, required: true },
  contactEmail: { type: String, required: true, lowercase: true },

  desiredCompletionDate: { type: Date },
  services: { type: ServicesSchema, default: () => ({}) },

  specialRequests: {
    notForSale: { type: String, default: '' },
    restrictedAreas: { type: String, default: '' },
  },

  story: {
    owner: { type: String, default: '' },
    inventory: { type: String, default: '' },
    property: { type: String, default: '' },
  },

  stage: {
    type: String,
    enum: ['walkthrough','staging','online_sale','estate_sale','donations','hauling','payout_processing','closing'],
    default: 'walkthrough',
    index: true
  },

  finance: {
    gross: { type: Number, default: 0 },
    fees: { type: Number, default: 0 },
    haulingCost: { type: Number, default: 0 },
    net: { type: Number, default: 0 },
    daily: [{
      label: { type: String }, 
      amount: { type: Number, default: 0 },
      at: { type: Date, default: Date.now }
    }]
  },

  stageNotes: [{
    stage: { type: String },
    note: { type: String },
    at: { type: Date, default: Date.now },
    by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
  }],

  marketingPhotos: [{ type: String }], 
}, { timestamps: true });

module.exports = mongoose.model('ClientJob', ClientJobSchema);
