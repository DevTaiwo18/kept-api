const express = require('express');
const router = express.Router();
const { auth, allow } = require('../middlewares/auth');
const ctrl = require('../controllers/orders.controller');

router.use(auth);
router.get('/', allow('buyer'), ctrl.listMyOrders);
router.get('/:id', allow('buyer'), ctrl.getOrder);
router.patch('/:orderId/schedule', allow('buyer'), ctrl.saveDeliveryDetails);

module.exports = router;
