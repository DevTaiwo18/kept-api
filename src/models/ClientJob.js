const mongoose = require('mongoose');

const ServicesSchema = new mongoose.Schema({
  liquidation: { type: Boolean, default: false },
  donationClearout: { type: Boolean, default: false },
  cleaning: { type: Boolean, default: false },
  homeSale: { type: Boolean, default: false },
  homeRepair: { type: Boolean, default: false },
}, { _id: false });

const ClientJobSchema = new mongoose.Schema({
  client: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  accountManager: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },

  contractSignor: { type: String, required: true, trim: true },
  propertyAddress: { type: String, required: true },
  contactPhone: { type: String, required: true },
  contactEmail: { type: String, required: true, lowercase: true },

  desiredCompletionDate: { type: Date },
  services: { type: ServicesSchema, default: () => ({}) },
  
  serviceFee: { type: Number, default: 0 }, 
  depositAmount: { type: Number, default: 0 }, 
  depositPaidAt: { type: Date },
  
  contractFileUrl: { type: String, default: '' },
  contractUploadedAt: { type: Date },
  contractSignedByClient: { type: Boolean, default: false },
  contractSignedAt: { type: Date },
  contractSignatureImage: { type: String, default: '' },
  welcomeEmailSentAt: { type: Date },
  
  docusignEnvelopeId: { type: String, default: null },
  docusignStatus: { 
    type: String, 
    enum: ['not_sent', 'sent', 'delivered', 'completed', 'declined', 'voided'],
    default: 'not_sent'
  },
  
  scopeNotes: { type: String, default: '' },

  status: {
    type: String,
    enum: ['awaiting_deposit', 'active', 'completed', 'cancelled'],
    default: 'awaiting_deposit',
  },

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

  isOnlineSaleActive: {
    type: Boolean,
    default: true, 
  },

  onlineSaleStartDate: { type: Date, default: null },
  onlineSaleEndDate: { type: Date, default: null },
  estateSaleDate: { type: Date, default: null },
  estateSaleStartTime: { type: String, default: '' }, 
  estateSaleEndTime: { type: String, default: '' },   

  haulerVideos: [{
    url: { type: String },
    title: { type: String, default: '' },
    description: { type: String, default: '' },
    uploadedAt: { type: Date, default: Date.now },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
  }],

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

  stripe: {
    sessionId: { type: String },
    paymentIntentId: { type: String },
    sessionStatus: { type: String }
  }

}, { timestamps: true });

ClientJobSchema.pre('save', function(next) {
  if (this.finance) {
    const gross = this.finance.gross || 0;
    const fees = this.finance.fees || 0;
    const haulingCost = this.finance.haulingCost || 0;
    const serviceFee = this.serviceFee || 0;
    const depositPaid = this.depositAmount || 0;
    
    this.finance.net = gross - fees - haulingCost - serviceFee + depositPaid;
  }
  next();
});

module.exports = mongoose.model('ClientJob', ClientJobSchema);