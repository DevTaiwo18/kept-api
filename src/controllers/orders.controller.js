const Order = require('../models/Order');
const { sendEmail } = require('../utils/sendEmail');

function formatDateTime(date) {
  if (!date) return 'Not scheduled';
  const d = new Date(date);
  return d.toLocaleDateString('en-US', { 
    weekday: 'long', 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
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

async function sendOrderStatusEmail({ buyerEmail, buyerName, orderNumber, oldStatus, newStatus, trackingNumber }) {
  const statusMessages = {
    pending: 'Your order has been received and is awaiting processing.',
    processing: 'Your order is currently being prepared.',
    ready: 'Your order is ready! You can now proceed with pickup or we will ship it soon.',
    shipped: trackingNumber 
      ? `Your order has been shipped! Tracking number: ${trackingNumber}` 
      : 'Your order has been shipped and is on its way to you.',
    delivered: 'Your order has been delivered. We hope you enjoy your purchase!',
    picked_up: 'Your order has been picked up. Thank you for your business!',
  };

  const statusMessage = statusMessages[newStatus] || `Your order status has been updated to: ${newStatus}`;

  const content = `
    <p style="font-size: 16px; line-height: 1.6; color: #333; margin: 0 0 15px 0; font-family: Arial, sans-serif;">
      Your order <strong>#${orderNumber}</strong> status has been updated.
    </p>
    <div style="background-color: #f9f9f9; border-left: 4px solid #e6c35a; padding: 20px; margin: 20px 0; border-radius: 4px;">
      <p style="font-size: 14px; line-height: 1.8; color: #333; margin: 0; font-family: Arial, sans-serif;">
        <strong style="color: #101010;">Previous Status:</strong> ${oldStatus || 'N/A'}<br/>
        <strong style="color: #101010;">New Status:</strong> ${newStatus}
      </p>
    </div>
    <p style="font-size: 16px; line-height: 1.6; color: #333; margin: 20px 0 15px 0; font-family: Arial, sans-serif;">
      ${statusMessage}
    </p>
    ${trackingNumber ? `
      <div style="background-color: #e8f5e9; border-left: 4px solid #4caf50; padding: 20px; margin: 20px 0; border-radius: 4px;">
        <p style="font-size: 14px; line-height: 1.6; color: #2e7d32; margin: 0; font-family: Arial, sans-serif;">
          <strong>📦 Tracking Number:</strong> ${trackingNumber}
        </p>
      </div>
    ` : ''}
    <p style="font-size: 14px; line-height: 1.6; color: #666; margin: 20px 0 0 0; font-family: Arial, sans-serif;">
      You can view your order details anytime in your account dashboard.
    </p>
  `;

  await sendEmail({
    to: buyerEmail,
    subject: `Order #${orderNumber} - ${newStatus.charAt(0).toUpperCase() + newStatus.slice(1)}`,
    html: getEmailTemplate(buyerName, content),
    text: `Order #${orderNumber} status has been updated from ${oldStatus || 'N/A'} to ${newStatus}. ${statusMessage}${trackingNumber ? ` Tracking: ${trackingNumber}` : ''}`
  });
}

exports.getOrder = async (req, res) => {
  try {
    const order = await Order.findOne({ 
      _id: req.params.id, 
      user: req.user.sub
    }).lean();
    
    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }
    
    res.json(order);
  } catch (err) {
    console.error('Get order error:', err);
    res.status(500).json({ message: 'Failed to fetch order' });
  }
};

exports.listMyOrders = async (req, res) => {
  try {
    const orders = await Order.find({ user: req.user.sub })
      .sort({ createdAt: -1 })
      .lean();
    
    res.json(orders);
  } catch (err) {
    console.error('List orders error:', err);
    res.status(500).json({ message: 'Failed to fetch orders' });
  }
};

exports.saveDeliveryDetails = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { type, scheduledAt, fullName, phoneNumber, email, address, city, state, zipCode, instructions } = req.body;
    
    const order = await Order.findOne({ 
      _id: orderId, 
      user: req.user.sub
    }).populate('items');
    
    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }
    
    order.deliveryDetails = {
      type,
      scheduledAt: scheduledAt ? new Date(scheduledAt) : undefined,
      fullName,
      phoneNumber,
      email,
      address,
      city,
      state,
      zipCode,
      instructions
    };
    
    await order.save();

    res.json({ 
      message: 'Delivery details saved', 
      deliveryDetails: order.deliveryDetails 
    });
  } catch (err) {
    console.error('Save delivery details error:', err);
    res.status(500).json({ message: 'Failed to save delivery details' });
  }
};

exports.listAllOrders = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    
    const status = req.query.status;
    const fulfillmentStatus = req.query.fulfillmentStatus;
    
    const filter = {};
    if (status) filter.paymentStatus = status;
    if (fulfillmentStatus) filter.fulfillmentStatus = fulfillmentStatus;
    
    const orders = await Order.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();
    
    const total = await Order.countDocuments(filter);
    
    res.json({
      orders,
      page,
      limit,
      total,
      pages: Math.ceil(total / limit)
    });
  } catch (err) {
    console.error('List all orders error:', err);
    res.status(500).json({ message: 'Failed to fetch orders' });
  }
};

exports.getOrderById = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id).lean();
    
    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }
    
    res.json(order);
  } catch (err) {
    console.error('Get order by ID error:', err);
    res.status(500).json({ message: 'Failed to fetch order' });
  }
};

exports.updateOrderStatus = async (req, res) => {
  try {
    const { fulfillmentStatus, trackingNumber, notes } = req.body;
    
    const order = await Order.findById(req.params.id).populate({
      path: 'user',
      select: 'email name'
    });
    
    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }
    
    const oldStatus = order.fulfillmentStatus;
    
    if (fulfillmentStatus) {
      order.fulfillmentStatus = fulfillmentStatus;
    }
    
    if (trackingNumber) {
      order.shippingDetails = order.shippingDetails || {};
      order.shippingDetails.trackingNumber = trackingNumber;
    }
    
    if (notes) {
      order.adminNotes = order.adminNotes || [];
      order.adminNotes.push({
        note: notes,
        addedBy: req.user.sub,
        addedAt: new Date()
      });
    }
    
    await order.save();
    
    console.log('>>> Order status update - checking email send');
    console.log('>>> fulfillmentStatus:', fulfillmentStatus);
    console.log('>>> oldStatus:', oldStatus);
    console.log('>>> order.user:', order.user);
    console.log('>>> order.user?.email:', order.user?.email);

    if (fulfillmentStatus && fulfillmentStatus !== oldStatus && order.user?.email) {
      console.log('>>> Sending status update email to:', order.user.email);
      try {
        await sendOrderStatusEmail({
          buyerEmail: order.user.email,
          buyerName: order.user.name || 'Customer',
          orderNumber: order._id.toString().slice(-8).toUpperCase(),
          oldStatus,
          newStatus: fulfillmentStatus,
          trackingNumber: trackingNumber || order.shippingDetails?.trackingNumber,
        });
        console.log('>>> Status email sent successfully');
      } catch (emailErr) {
        console.error('Failed to send order status email:', emailErr);
      }
    } else {
      console.log('>>> Email NOT sent - missing condition');
      if (!fulfillmentStatus) console.log('>>>   - No fulfillmentStatus');
      if (fulfillmentStatus === oldStatus) console.log('>>>   - Status unchanged');
      if (!order.user?.email) console.log('>>>   - No user email');
    }
    
    res.json({ 
      message: 'Order updated successfully', 
      order 
    });
  } catch (err) {
    console.error('Update order status error:', err);
    res.status(500).json({ message: 'Failed to update order' });
  }
};