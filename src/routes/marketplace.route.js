const express = require('express');
const { listItems, getItem, getRelated, searchItems } = require('../controllers/marketplace.controller');

const router = express.Router();

router.get('/items', listItems);
router.get('/items/search', searchItems);
router.get('/items/:id', getItem);
router.get('/items/:id/related', getRelated);

module.exports = router;