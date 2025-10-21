const Order = require('../models/Order');
const Item = require('../models/Item');
const Cart = require('../models/Cart');
const { stripe } = require('../services/stripe');

exports.stripeWebhook = async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.rawBody,
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
      if (!order) return res.json({ received: true });
      if (order.paymentStatus === 'paid') return res.json({ received: true });

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

      await Cart.findOneAndUpdate({ user: order.user }, { $set: { items: [] } }, { upsert: true });

      return res.json({ received: true });
    } catch (e) {
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
