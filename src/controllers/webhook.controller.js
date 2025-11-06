const Order = require('../models/Order');
const Item = require('../models/Item');
const Cart = require('../models/Cart');
const ClientJob = require('../models/ClientJob');
const { stripe } = require('../services/stripe');
const { createShippingLabel } = require('../services/fedex');

function calculateKeptHouseCommission(grossSales) {
  let commission = 0;
  
  if (grossSales <= 7500) {
    commission = grossSales * 0.50;
  } else if (grossSales <= 20000) {
    commission = (7500 * 0.50) + ((grossSales - 7500) * 0.40);
  } else {
    commission = (7500 * 0.50) + (12500 * 0.40) + ((grossSales - 20000) * 0.30);
  }
  
  return Math.round(commission * 100) / 100;
}

function parsePropertyAddress(propertyAddress) {
  const addressParts = propertyAddress.split(',').map(p => p.trim());
  
  let street = addressParts[0] || '';
  let city = '';
  let state = 'OH';
  let zipCode = '';
  
  if (addressParts.length >= 2) {
    const lastPart = addressParts[addressParts.length - 1];
    const stateZipMatch = lastPart.match(/([A-Z]{2})\s*(\d{5})/);
    
    if (stateZipMatch) {
      state = stateZipMatch[1];
      zipCode = stateZipMatch[2];
      city = addressParts[addressParts.length - 2] || '';
    } else {
      city = lastPart;
    }
  }
  
  return {
    address: street,
    city,
    state,
    zipCode,
    isValid: !!(city && zipCode && street)
  };
}

exports.stripeWebhook = async (req, res) => {
  const sig = req.headers['stripe-signature'];
  
  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const metadata = session.metadata || {};
    
    if (metadata.depositType === 'initial_deposit') {
      const jobId = metadata.jobId;
      
      try {
        const job = await ClientJob.findById(jobId);
        
        if (!job) {
          return res.json({ received: true });
        }
        
        if (job.status === 'active' && job.depositPaidAt) {
          return res.json({ received: true });
        }

        const depositAmount = parseFloat(metadata.depositAmount);
        const serviceFee = parseFloat(metadata.serviceFee);

        job.depositAmount = depositAmount;
        job.depositPaidAt = new Date();
        job.status = 'active';
        job.stripe = job.stripe || {};
        job.stripe.paymentIntentId = session.payment_intent;
        job.stripe.sessionId = session.id;

        // Calculate Kept House Commission (tiered)
        const keptHouseCommission = calculateKeptHouseCommission(job.finance.gross || 0);
        job.finance.fees = keptHouseCommission;

        const haulingCost = job.finance.haulingCost || 0;
        job.finance.net = (job.finance.gross || 0) - serviceFee - keptHouseCommission - haulingCost + depositAmount;

        await job.save();

        return res.json({ received: true });
        
      } catch (e) {
        console.error('Deposit webhook error:', e);
        return res.status(500).json({ message: 'Webhook handling failed' });
      }
    }

    const orderId = metadata.orderId;
    
    try {
      const order = await Order.findById(orderId);
      
      if (!order) {
        return res.json({ received: true });
      }
      
      if (order.paymentStatus === 'paid') {
        return res.json({ received: true });
      }

      const itemDocIds = [...new Set(order.items.map(it => it.itemDocId.toString()))];
      const items = await Item.find({ _id: { $in: itemDocIds } }).lean();
      const itemMap = new Map(items.map(item => [item._id.toString(), item]));

      for (const it of order.items) {
        const photoIndices = it.photoIndices || [it.photoIndex];
        
        await Item.updateOne(
          { _id: it.itemDocId },
          { 
            $addToSet: { soldPhotoIndices: { $each: photoIndices } }, 
            $set: { soldAt: new Date() } 
          }
        );
      }

      order.paymentStatus = 'paid';
      order.stripe.paymentIntentId = session.payment_intent || order.stripe.paymentIntentId;

      if (order.deliveryDetails && order.deliveryDetails.type === 'shipping') {
        try {
          const job = await ClientJob.findById(order.job);
          if (job && job.propertyAddress) {
            const parsedAddress = parsePropertyAddress(job.propertyAddress);
            
            if (parsedAddress.isValid) {
              const originAddress = {
                address: parsedAddress.address,
                city: parsedAddress.city,
                state: parsedAddress.state,
                zipCode: parsedAddress.zipCode,
                contactName: job.contractSignor || 'Estate Sale',
                phoneNumber: job.contactPhone || '(513) 609-4731'
              };
              
              const labelInfo = await createShippingLabel(order, originAddress);
              
              order.shippingDetails = order.shippingDetails || {};
              order.shippingDetails.trackingNumber = labelInfo.trackingNumber;
              order.shippingDetails.labelUrl = labelInfo.labelUrl;
              order.fulfillmentStatus = 'processing';
            } else {
              console.log('Invalid origin address, skipping label creation. Admin must create manually.');
              order.fulfillmentStatus = 'pending';
              order.shippingDetails = order.shippingDetails || {};
              order.shippingDetails.note = 'Awaiting manual label creation';
            }
          }
        } catch (error) {
          console.error('Label creation error:', error.response?.data || error.message);
          order.fulfillmentStatus = 'pending';
          order.shippingDetails = order.shippingDetails || {};
          order.shippingDetails.note = 'Label creation failed - manual creation required';
        }
      } else if (order.deliveryDetails && order.deliveryDetails.type === 'pickup') {
        order.fulfillmentStatus = 'ready';
      }

      await order.save();

      await Cart.findOneAndUpdate(
        { user: order.buyer }, 
        { $set: { items: [] } }, 
        { upsert: true }
      );

      const jobRevenue = new Map();
      
      for (const it of order.items) {
        const item = itemMap.get(it.itemDocId.toString());
        if (item && item.job) {
          const jobId = item.job.toString();
          const currentRevenue = jobRevenue.get(jobId) || { total: 0, count: 0 };
          jobRevenue.set(jobId, {
            total: currentRevenue.total + it.unitPrice,
            count: currentRevenue.count + 1
          });
        }
      }

      for (const [jobId, revenue] of jobRevenue.entries()) {
        const job = await ClientJob.findById(jobId);
        if (job) {
          job.finance.gross = (job.finance.gross || 0) + revenue.total;
          
          job.finance.daily.push({
            label: `Online Sale - Order #${order._id.toString().slice(-8).toUpperCase()} - ${revenue.count} item${revenue.count > 1 ? 's' : ''}`,
            amount: revenue.total,
            at: new Date()
          });

          // Calculate Kept House Commission (tiered)
          const keptHouseCommission = calculateKeptHouseCommission(job.finance.gross);
          job.finance.fees = keptHouseCommission;

          const serviceFee = (job.serviceFee && job.serviceFee > 0) ? job.serviceFee : 0;
          const depositPaid = (job.depositAmount && job.depositAmount > 0 && job.depositPaidAt) ? job.depositAmount : 0;
          const haulingCost = job.finance.haulingCost || 0;

          job.finance.net = job.finance.gross - serviceFee - keptHouseCommission - haulingCost + depositPaid;
          
          await job.save();
        }
      }

      return res.json({ received: true });
      
    } catch (e) {
      console.error('Webhook error:', e);
      return res.status(500).json({ message: 'Webhook handling failed' });
    }
  }

  if (event.type === 'checkout.session.expired' || event.type === 'checkout.session.async_payment_failed') {
    const session = event.data.object;
    const metadata = session.metadata || {};
    
    if (metadata.depositType === 'initial_deposit') {
      const jobId = metadata.jobId;
      try {
        await ClientJob.updateOne({ _id: jobId }, { $set: { 'stripe.sessionStatus': 'failed' } });
      } catch (e) {}
    } else {
      const orderId = metadata.orderId;
      try {
        await Order.updateOne({ _id: orderId }, { $set: { paymentStatus: 'failed' } });
      } catch (e) {}
    }
  }

  res.json({ received: true });
};