const Order = require('../models/Order');
const { sendEmail } = require('../utils/sendEmail');

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
                      If you have any questions, feel free to contact us at support@kepthouse.com
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

exports.getOrder = async (req, res) => {
  try {
    const order = await Order.findOne({ _id: req.params.id, user: req.user.sub });
    if (!order) return res.status(404).json({ message: 'Order not found' });
    res.json(order);
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch order' });
  }
};

exports.listMyOrders = async (req, res) => {
  try {
    const orders = await Order.find({ user: req.user.sub }).sort({ createdAt: -1 });
    res.json(orders);
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch orders' });
  }
};

exports.saveDeliveryDetails = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { type, scheduledAt, fullName, phoneNumber, email, address, city, state, zipCode, instructions } = req.body;
    
    const order = await Order.findOne({ _id: orderId, user: req.user.sub }).populate('items');
    if (!order) return res.status(404).json({ message: 'Order not found' });
    
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

    setImmediate(async () => {
      try {
        const deliveryType = type === 'pickup' ? 'Pickup' : 'Delivery';
        const fullAddress = type === 'delivery' 
          ? `${address}, ${city}, ${state} ${zipCode}`
          : 'Pickup location will be provided';
        
        let itemImagesHtml = '';
        if (order.items && order.items.length > 0) {
          const itemImages = order.items
            .filter(item => item.photo)
            .slice(0, 3)
            .map(item => `
              <td style="padding: 5px;">
                <img src="${item.photo}" alt="${item.title || 'Item'}" style="width: 150px; height: 150px; object-fit: cover; border-radius: 8px; border: 2px solid #e6c35a;">
              </td>
            `).join('');
          
          if (itemImages) {
            itemImagesHtml = `
              <div style="margin: 20px 0;">
                <p style="font-size: 14px; color: #666; margin: 0 0 10px 0; font-family: Arial, sans-serif;">
                  <strong>Your Items:</strong>
                </p>
                <table cellpadding="0" cellspacing="0">
                  <tr>
                    ${itemImages}
                  </tr>
                </table>
              </div>
            `;
          }
        }

        const content = `
          <div style="text-align: center; padding: 20px 0;">
            <div style="display: inline-block; background: linear-gradient(135deg, #e6c35a 0%, #d4af37 100%); border-radius: 50%; width: 80px; height: 80px; line-height: 80px; margin-bottom: 20px;">
              <span style="font-size: 40px;">${type === 'pickup' ? '📦' : '🚚'}</span>
            </div>
          </div>
          <p style="font-size: 16px; line-height: 1.6; color: #333; margin: 0 0 15px 0; font-family: Arial, sans-serif;">
            Your <strong style="color: #e6c35a;">${deliveryType}</strong> has been scheduled successfully!
          </p>
          <div style="background-color: #f9f9f9; border-left: 4px solid #e6c35a; padding: 15px 20px; margin: 20px 0; border-radius: 4px;">
            <p style="font-size: 14px; line-height: 1.8; color: #555; margin: 0; font-family: Arial, sans-serif;">
              <strong>Order ID:</strong> ${order._id}<br/>
              <strong>Type:</strong> ${deliveryType}<br/>
              <strong>Scheduled:</strong> ${formatDateTime(scheduledAt)}<br/>
              <strong>Name:</strong> ${fullName}<br/>
              <strong>Phone:</strong> ${phoneNumber}<br/>
              ${type === 'delivery' ? `<strong>Address:</strong> ${fullAddress}<br/>` : ''}
              ${instructions ? `<strong>Special Instructions:</strong> ${instructions}` : ''}
            </p>
          </div>
          ${itemImagesHtml}
          <p style="font-size: 16px; line-height: 1.6; color: #333; margin: 20px 0 0 0; font-family: Arial, sans-serif;">
            We'll send you a reminder closer to your scheduled ${deliveryType.toLowerCase()} time. If you need to make any changes, please contact us as soon as possible.
          </p>
        `;

        await sendEmail({
          to: email,
          subject: `${deliveryType} Scheduled - Order #${order._id}`,
          html: getEmailTemplate(fullName, content),
          text: `Hi ${fullName}, Your ${deliveryType.toLowerCase()} has been scheduled for ${formatDateTime(scheduledAt)}. Order ID: ${order._id}. ${type === 'delivery' ? `Address: ${fullAddress}` : ''} Best regards, The Kept House Team`,
        });

        const adminContent = `
          <div style="text-align: center; padding: 20px 0;">
            <div style="display: inline-block; background-color: #e3f2fd; border-radius: 50%; width: 80px; height: 80px; line-height: 80px; margin-bottom: 20px;">
              <span style="font-size: 40px;">🔔</span>
            </div>
          </div>
          <p style="font-size: 16px; line-height: 1.6; color: #333; margin: 0 0 15px 0; font-family: Arial, sans-serif;">
            A new <strong style="color: #e6c35a;">${deliveryType}</strong> has been scheduled.
          </p>
          <div style="background-color: #e3f2fd; border-left: 4px solid #2196f3; padding: 15px 20px; margin: 20px 0; border-radius: 4px;">
            <p style="font-size: 14px; line-height: 1.8; color: #555; margin: 0; font-family: Arial, sans-serif;">
              <strong>Order ID:</strong> ${order._id}<br/>
              <strong>Customer:</strong> ${fullName}<br/>
              <strong>Phone:</strong> ${phoneNumber}<br/>
              <strong>Email:</strong> ${email}<br/>
              <strong>Type:</strong> ${deliveryType}<br/>
              <strong>Scheduled:</strong> ${formatDateTime(scheduledAt)}<br/>
              ${type === 'delivery' ? `<strong>Address:</strong> ${fullAddress}<br/>` : ''}
              ${instructions ? `<strong>Instructions:</strong> ${instructions}` : ''}
            </p>
          </div>
          ${itemImagesHtml}
        `;

        await sendEmail({
          to: 'Admin@keptestate.com',
          subject: `New ${deliveryType} Scheduled - Order #${order._id}`,
          html: getEmailTemplate('Admin', adminContent),
          text: `New ${deliveryType.toLowerCase()} scheduled. Order: ${order._id}, Customer: ${fullName}, Phone: ${phoneNumber}, Scheduled: ${formatDateTime(scheduledAt)}`,
        });

      } catch (emailErr) {
        console.error('Failed to send delivery confirmation email:', emailErr);
      }
    });

    res.json({ message: 'Delivery details saved', deliveryDetails: order.deliveryDetails });
  } catch (err) {
    console.error('Save delivery details error:', err);
    res.status(500).json({ message: 'Failed to save delivery details' });
  }
};