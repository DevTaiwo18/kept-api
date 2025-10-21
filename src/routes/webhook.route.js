const router = require('express').Router();
const { stripeWebhook } = require('../controllers/webhook.controller');

router.post('/stripe', stripeWebhook);

module.exports = router;
