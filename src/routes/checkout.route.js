const express = require('express');
const router = express.Router();
const { auth, allow } = require('../middlewares/auth');
const checkoutController = require('../controllers/checkout.controller');

router.use(auth);
router.use(allow('buyer'));

router.post('/calculate-totals', checkoutController.calculateCheckoutTotals);
router.post('/create-session', checkoutController.createCheckoutSession);

module.exports = router;