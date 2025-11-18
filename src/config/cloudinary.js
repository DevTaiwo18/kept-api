const cloudinary = require('cloudinary').v2;
const multer = require('multer');
const { CloudinaryStorage } = require('multer-storage-cloudinary');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: async (req, file) => {
    const ext = file.originalname.split('.').pop().toLowerCase();
    const isPdf = ext === 'pdf';
    const timestamp = Date.now();
    const originalName = file.originalname.split('.')[0];
    
    return {
      folder: 'email-attachments',
      resource_type: isPdf ? 'raw' : 'auto',
      access_mode: 'public',
      type: 'upload',
      public_id: `${timestamp}-${originalName}.${ext}`,
    };
  },
});

const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 25 * 1024 * 1024,
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['pdf', 'doc', 'docx', 'jpg', 'jpeg', 'png', 'xlsx', 'xls'];
    const ext = file.originalname.split('.').pop().toLowerCase();
    
    if (allowedTypes.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`File type .${ext} not allowed. Allowed types: ${allowedTypes.join(', ')}`));
    }
  }
});

module.exports = {
  cloudinary,
  upload,
};