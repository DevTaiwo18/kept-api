const express = require('express');
const router = express.Router();
const { auth, allow } = require('../middlewares/auth');
const ctrl = require('../controllers/cart.controller');

router.use(auth);

router.post('/add', allow('buyer'), ctrl.addToCart);
router.get('/', allow('buyer'), ctrl.getCart);
router.delete('/remove/:itemId', allow('buyer'), ctrl.removeFromCart);
router.delete('/clear', allow('buyer'), ctrl.clearCart);

module.exports = router;