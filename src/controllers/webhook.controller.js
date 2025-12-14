const Order = require('../models/Order');
const Item = require('../models/Item');
const Cart = require('../models/Cart');
const ClientJob = require('../models/ClientJob');
const { stripe } = require('../services/stripe');
const { createShippingLabel } = require('../services/fedex');
const { sendEmail } = require('../utils/sendEmail');

const ADMIN_EMAIL = 'admin@keptestate.com';

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

function getEmailTemplate(name, content) {
  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="margin: 0; padding: 0; background-color: #f4f4f4;">
        <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f4f4; padding: 20px 0;">
          <tr>
            <td align="center">
              <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
                <tr>
                  <td style="background: linear-gradient(135deg, #e6c35a 0%, #d4af37 100%); padding: 30px 40px; text-align: center;">
                    <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-family: Arial, sans-serif; font-weight: 600;">
                      Kept House
                    </h1>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 40px 40px 30px 40px;">
                    <h2 style="color: #101010; margin: 0 0 20px 0; font-size: 22px; font-family: Arial, sans-serif; font-weight: 500;">
                      Hi ${name},
                    </h2>
                    ${content}
                  </td>
                </tr>
                <tr>
                  <td style="background-color: #f9f9f9; padding: 25px 40px; border-top: 1px solid #e0e0e0;">
                    <p style="font-size: 14px; line-height: 1.6; color: #666; margin: 0 0 10px 0; font-family: Arial, sans-serif;">
                      Best regards,<br/>
                      <strong style="color: #333;">The Kept House Team</strong>
                    </p>
                    <p style="font-size: 12px; line-height: 1.5; color: #999; margin: 15px 0 0 0; font-family: Arial, sans-serif;">
                      If you have any questions, feel free to contact us at admin@keptestate.com
                    </p>
                  </td>
                </tr>
              </table>
              <table width="600" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding: 20px; text-align: center;">
                    <p style="font-size: 12px; color: #999; margin: 0; font-family: Arial, sans-serif;">
                      © ${new Date().getFullYear()} Kept House. All rights reserved.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
  `;
}

async function sendAgentOrderNotification(order) {
  const orderNumber = order._id.toString().slice(-8).toUpperCase();
  const deliveryType = order.deliveryDetails?.type === 'shipping' ? '🚚 Shipping' : '📦 Pickup';
  const itemCount = order.items?.length || 0;
  
  const content = `
    <div style="background-color: #fff3cd; border-left: 4px solid #ffc107; padding: 20px; margin: 20px 0; border-radius: 4px;">
      <p style="font-size: 16px; line-height: 1.6; color: #856404; margin: 0; font-family: Arial, sans-serif;">
        <strong>🔔 New Order Alert!</strong>
      </p>
    </div>
    
    <p style="font-size: 16px; line-height: 1.6; color: #333; margin: 20px 0; font-family: Arial, sans-serif;">
      You have received a new order that requires your attention.
    </p>
    
    <div style="background-color: #f9f9f9; border-left: 4px solid #e6c35a; padding: 20px; margin: 20px 0; border-radius: 4px;">
      <p style="font-size: 14px; line-height: 1.8; color: #333; margin: 0; font-family: Arial, sans-serif;">
        <strong style="color: #101010;">Order #:</strong> ${orderNumber}<br/>
        <strong style="color: #101010;">Items:</strong> ${itemCount}<br/>
        <strong style="color: #101010;">Total:</strong> $${order.totalAmount.toFixed(2)}<br/>
        <strong style="color: #101010;">Delivery:</strong> ${deliveryType}<br/>
        <strong style="color: #101010;">Status:</strong> Payment Confirmed ✅
      </p>
    </div>
    
    <p style="font-size: 16px; line-height: 1.6; color: #333; margin: 20px 0; font-family: Arial, sans-serif;">
      <strong>⚡ Action Required:</strong> Please check your dashboard to view full order details and take necessary action.
    </p>
    
    <p style="font-size: 14px; line-height: 1.6; color: #666; margin: 20px 0 0 0; font-family: Arial, sans-serif;">
      Log in to your agent dashboard to manage this order and prepare for ${order.deliveryDetails?.type === 'shipping' ? 'shipment' : 'customer pickup'}.
    </p>
  `;

  try {
    await sendEmail({
      to: ADMIN_EMAIL,
      subject: `🔔 New Order #${orderNumber} - Action Required`,
      html: getEmailTemplate('Agent', content),
      text: `New Order Alert! Order #${orderNumber} has been placed. ${itemCount} item(s), $${order.totalAmount.toFixed(2)} total. Delivery: ${deliveryType}. Please check your dashboard to view details and take action.`
    });
    
    console.log(`Agent notification sent to ${ADMIN_EMAIL} for order ${orderNumber}`);
  } catch (error) {
    console.error('Failed to send agent notification email:', error);
  }
}

exports.stripeWebhook = async (req, res) => {
  console.log('=== STRIPE WEBHOOK RECEIVED ===');
  const sig = req.headers['stripe-signature'];
  console.log('Signature present:', !!sig);
  console.log('Webhook secret configured:', !!process.env.STRIPE_WEBHOOK_SECRET);

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
    console.log('Webhook event verified successfully');
    console.log('Event type:', event.type);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const metadata = session.metadata || {};
    console.log('Session metadata:', metadata);

    if (metadata.depositType === 'initial_deposit') {
      const jobId = metadata.jobId;
      console.log('Processing DEPOSIT for job:', jobId);

      try {
        const job = await ClientJob.findById(jobId);

        if (!job) {
          console.log('Job not found:', jobId);
          return res.json({ received: true });
        }

        if (job.status === 'active' && job.depositPaidAt) {
          console.log('Job already active, skipping');
          return res.json({ received: true });
        }

        const depositAmount = parseFloat(metadata.depositAmount);
        const serviceFee = parseFloat(metadata.serviceFee);
        console.log('Deposit amount:', depositAmount, 'Service fee:', serviceFee);

        job.depositAmount = depositAmount;
        job.depositPaidAt = new Date();
        job.status = 'active';
        job.stripe = job.stripe || {};
        job.stripe.paymentIntentId = session.payment_intent;
        job.stripe.sessionId = session.id;

        const keptHouseCommission = calculateKeptHouseCommission(job.finance.gross || 0);
        job.finance.fees = keptHouseCommission;

        const haulingCost = job.finance.haulingCost || 0;
        job.finance.net = (job.finance.gross || 0) - serviceFee - keptHouseCommission - haulingCost + depositAmount;

        await job.save();
        console.log('Job updated successfully! Status:', job.status);

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

          const keptHouseCommission = calculateKeptHouseCommission(job.finance.gross);
          job.finance.fees = keptHouseCommission;

          const serviceFee = (job.serviceFee && job.serviceFee > 0) ? job.serviceFee : 0;
          const depositPaid = (job.depositAmount && job.depositAmount > 0 && job.depositPaidAt) ? job.depositAmount : 0;
          const haulingCost = job.finance.haulingCost || 0;

          job.finance.net = job.finance.gross - serviceFee - keptHouseCommission - haulingCost + depositPaid;
          
          await job.save();
        }
      }

      await sendAgentOrderNotification(order);

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