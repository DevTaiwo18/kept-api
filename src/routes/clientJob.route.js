const express = require('express');
const router = express.Router();
const { auth, allow } = require('../middlewares/auth');
const ctrl = require('../controllers/clientJob.controller');

router.use(auth);

router.post('/', allow('client','agent'), ctrl.createJob);
router.get('/', allow('client','agent'), ctrl.listJobs);
router.get('/:id', allow('client','agent'), ctrl.getJob);

router.post('/:id/upload-contract', allow('agent'), ctrl.uploadContract);
router.post('/:id/sign-contract', allow('client'), ctrl.signContract);
router.post('/:id/mark-welcome-sent', allow('agent'), ctrl.markWelcomeEmailSent);
router.post('/:id/request-deposit', allow('agent'), ctrl.requestDeposit);
router.post('/:id/deposit/checkout', allow('client','agent'), ctrl.createDepositCheckout);

router.patch('/:id/progress', allow('agent'), ctrl.updateProgress);
router.post('/:id/finance/daily', allow('agent'), ctrl.addDailySales);

module.exports = router;