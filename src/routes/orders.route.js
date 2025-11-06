const express = require('express');
const router = express.Router();
const { auth, allow } = require('../middlewares/auth');
const ordersController = require('../controllers/orders.controller');

router.use(auth);

router.get('/', allow('buyer'), ordersController.listMyOrders);
router.get('/:id', allow('buyer'), ordersController.getOrder);
router.post('/:orderId/delivery', allow('buyer'), ordersController.saveDeliveryDetails);

router.get('/admin/all', allow('admin', 'agent'), ordersController.listAllOrders);
router.get('/admin/:id', allow('admin', 'agent'), ordersController.getOrderById);
router.patch('/admin/:id/status', allow('admin', 'agent'), ordersController.updateOrderStatus);

module.exports = router;