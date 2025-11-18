const { cloudinary } = require('../config/cloudinary');

exports.uploadFiles = async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ message: 'No files uploaded' });
    }

    const uploadedFiles = req.files.map(file => ({
      filename: file.originalname,
      path: file.path,
      size: file.size,
      mimetype: file.mimetype,
      cloudinaryId: file.filename,
    }));

    res.json({
      success: true,
      files: uploadedFiles,
      message: 'Files uploaded successfully',
    });
  } catch (error) {
    console.error('Error uploading files:', error);
    res.status(500).json({ 
      message: 'Failed to upload files', 
      error: error.message 
    });
  }
};

exports.deleteFile = async (req, res) => {
  try {
    const { cloudinaryId } = req.body;

    if (!cloudinaryId) {
      return res.status(400).json({ message: 'Cloudinary ID is required' });
    }

    await cloudinary.uploader.destroy(cloudinaryId);

    res.json({
      success: true,
      message: 'File deleted successfully',
    });
  } catch (error) {
    console.error('Error deleting file:', error);
    res.status(500).json({ 
      message: 'Failed to delete file', 
      error: error.message 
    });
  }
};