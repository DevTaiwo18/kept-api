const Order = require('../models/Order');

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
    const { type, scheduledAt, address, instructions } = req.body;
    const order = await Order.findOne({ _id: orderId, user: req.user.sub });
    if (!order) return res.status(404).json({ message: 'Order not found' });
    order.deliveryDetails = {
      type,
      scheduledAt: scheduledAt ? new Date(scheduledAt) : undefined,
      address,
      instructions
    };
    await order.save();
    res.json({ message: 'Scheduling saved', deliveryDetails: order.deliveryDetails });
  } catch (err) {
    res.status(500).json({ message: 'Failed to save scheduling' });
  }
};
