const multer = require('multer');
const os = require('os');

const storage = multer.diskStorage({
  destination: os.tmpdir(),
  filename: (_req, file, cb) => cb(null, Date.now() + '-' + file.originalname),
});

const upload = multer({
  storage,
  limits: { fileSize: 12 * 1024 * 1024, files: 25 },
});

module.exports = upload;
