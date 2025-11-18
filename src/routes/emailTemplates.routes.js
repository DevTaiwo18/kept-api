const express = require('express');
const router = express.Router();
const { auth, allow } = require('../middlewares/auth');
const ctrl = require('../controllers/emailTemplates.controller');

router.use(auth);

router.get('/', allow('agent'), ctrl.list);
router.get('/:key', allow('agent'), ctrl.getByKey);
router.post('/', allow('agent'), ctrl.upsert);
router.post('/:key/preview', allow('agent'), ctrl.preview);
router.post('/:key/send', allow('agent'), ctrl.sendTemplateEmail);
router.get('/:key/versions', allow('agent'), ctrl.versions);
router.post('/:key/rollback', allow('agent'), ctrl.rollback);
router.post('/:key/toggle', allow('agent'), ctrl.toggleActive);

module.exports = router;