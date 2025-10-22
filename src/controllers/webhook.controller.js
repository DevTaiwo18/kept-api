const Order = require('../models/Order');
const Item = require('../models/Item');
const Cart = require('../models/Cart');
const ClientJob = require('../models/ClientJob');
const { stripe } = require('../services/stripe');

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
    const orderId = session.metadata?.orderId;
    
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
        await Item.updateOne(
          { _id: it.itemDocId },
          { $addToSet: { soldPhotoIndices: it.photoIndex }, $set: { soldAt: new Date() } }
        );
        
        const fresh = await Item.findById(it.itemDocId).lean();
        const approvedCount = (fresh?.approvedItems || []).length;
        const soldCount = (fresh?.soldPhotoIndices || []).length;
        
        if (approvedCount && soldCount && approvedCount === soldCount) {
          await Item.updateOne({ _id: it.itemDocId }, { $set: { status: 'sold' } });
        }
      }

      order.paymentStatus = 'paid';
      order.stripe.paymentIntentId = session.payment_intent || order.stripe.paymentIntentId;
      await order.save();

      await Cart.findOneAndUpdate(
        { user: order.user }, 
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

          job.finance.net = job.finance.gross - (job.finance.fees || 0) - (job.finance.haulingCost || 0);
          
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
    const orderId = session.metadata?.orderId;
    
    try {
      await Order.updateOne({ _id: orderId }, { $set: { paymentStatus: 'failed' } });
    } catch (e) {}
  }

  res.json({ received: true });
};