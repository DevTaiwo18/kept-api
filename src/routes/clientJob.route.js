const express = require('express');
const router = express.Router();
const { auth, allow } = require('../middlewares/auth');
const ctrl = require('../controllers/clientJob.controller');

router.use(auth);

router.post('/', allow('client','agent'), ctrl.createJob);
router.get('/', allow('client','agent'), ctrl.listJobs);
router.get('/:id', allow('client','agent'), ctrl.getJob);
router.patch('/:id/status', allow('agent'), ctrl.updateStage);
router.post('/:id/notes', allow('client','agent'), ctrl.addStageNote);
router.post('/:id/finance/daily', allow('agent'), ctrl.addDailySales);

module.exports = router;
