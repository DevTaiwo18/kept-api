const express = require('express');
const router = express.Router();
const { auth, allow } = require('../middlewares/auth');
const { createCheckoutSession } = require('../controllers/checkout.controller');

router.use(auth);
router.post('/create-session', allow('buyer'), createCheckoutSession);

module.exports = router;
