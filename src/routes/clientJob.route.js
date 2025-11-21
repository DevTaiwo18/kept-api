const express = require('express');
const router = express.Router();
const { auth, allow } = require('../middlewares/auth');
const ctrl = require('../controllers/clientJob.controller');
const fileUpload = require('express-fileupload');

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
router.patch('/:id/toggle-online-sale', allow('agent'), ctrl.toggleOnlineSale);

router.put('/:id/sale-timeframes', allow('agent'), ctrl.updateSaleTimeframes);

router.post('/:id/hauler-videos', 
  allow('agent'), 
  fileUpload({
    limits: { fileSize: 500 * 1024 * 1024 },
    useTempFiles: true,
    tempFileDir: '/tmp/'
  }),
  ctrl.addHaulerVideo
);
router.delete('/:id/hauler-videos/:videoId', allow('agent'), ctrl.deleteHaulerVideo);
router.get('/:id/hauler-videos', ctrl.getHaulerVideos);

module.exports = router;