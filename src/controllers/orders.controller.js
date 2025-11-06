const Order = require('../models/Order');

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
    const order = await Order.findOne({ 
      _id: req.params.id, 
      buyer: req.user.sub 
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
    const orders = await Order.find({ buyer: req.user.sub })
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
      buyer: req.user.sub 
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
    
    const order = await Order.findById(req.params.id);
    
    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }
    
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
    
    res.json({ 
      message: 'Order updated successfully', 
      order 
    });
  } catch (err) {
    console.error('Update order status error:', err);
    res.status(500).json({ message: 'Failed to update order' });
  }
};