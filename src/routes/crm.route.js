const express = require('express');
const router = express.Router();
const { auth, allow } = require('../middlewares/auth');
const ctrl = require('../controllers/crm.controller');

// All CRM routes require authentication and admin/agent role
router.use(auth);

// Get all contacts with optional filters
router.get('/contacts', allow('admin', 'agent'), ctrl.getContacts);

// Get single contact by ID
router.get('/contacts/:id', allow('admin', 'agent'), ctrl.getContactById);

// Get available contact types for filtering
router.get('/contact-types', allow('admin', 'agent'), ctrl.getContactTypes);

// Get available tags for filtering
router.get('/contact-tags', allow('admin', 'agent'), ctrl.getContactTags);

// Get CRM stats
router.get('/stats', allow('admin', 'agent'), ctrl.getCRMStats);

// Send bulk email to selected contacts
router.post('/send-email', allow('admin', 'agent'), ctrl.sendBulkEmail);

module.exports = router;
