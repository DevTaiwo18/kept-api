const express = require('express');
const router = express.Router();
const { auth, allow } = require('../middlewares/auth');
const docusignCtrl = require('../controllers/docusign.controller');

router.post('/send-contract', auth, allow('agent'), docusignCtrl.sendContractForSigning);
router.get('/signing-url/:jobId', auth, allow('client'), docusignCtrl.getSigningUrl);
router.get('/check-status/:jobId', auth, docusignCtrl.checkContractStatus);
router.post('/webhook', docusignCtrl.docusignWebhook);

module.exports = router;