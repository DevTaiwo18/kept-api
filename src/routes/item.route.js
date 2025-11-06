const express = require('express');
const { auth, allow } = require('../middlewares/auth');
const upload = require('../middlewares/upload');
const {
  createItem,
  uploadPhotos,
  analyzeWithAI,
  approveItem,
  reopenItem,
  listByJob,
  getOne,
} = require('../controllers/item.controller');

const router = express.Router();

router.post('/', auth, allow('client', 'agent'), createItem);
router.post('/:id/photos', auth, allow('client', 'agent'), upload.array('photos'), uploadPhotos);
router.post('/:id/ai/analyze', auth, allow('client', 'agent'), analyzeWithAI);
router.patch('/:id/approve', auth, allow('agent'), approveItem);
router.post('/:id/reopen', auth, allow('agent'), reopenItem);
router.get('/job/:jobId', auth, allow('client', 'agent'), listByJob);
router.get('/:id', auth, allow('client', 'agent'), getOne);

module.exports = router;