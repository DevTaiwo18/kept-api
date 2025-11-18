const express = require('express');
const router = express.Router();
const { auth, allow } = require('../middlewares/auth');
const { upload } = require('../config/cloudinary');
const ctrl = require('../controllers/fileupload.controller');

router.use(auth);

router.post('/upload', allow('agent'), upload.array('files', 10), ctrl.uploadFiles);

router.post('/delete', allow('agent'), ctrl.deleteFile);

module.exports = router;