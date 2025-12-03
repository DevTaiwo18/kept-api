const express = require('express');
const router = express.Router();
const { auth, allow } = require('../middlewares/auth');
const ctrl = require('../controllers/vendor.controller');
const { upload } = require('../config/cloudinary');

// All routes require authentication
router.use(auth);

// ============================================
// BID ROUTES
// ============================================

// POST /api/vendors/bids - Hauler submits a bid
router.post('/bids', allow('vendor'), ctrl.submitBid);

// GET /api/vendors/bids - Get vendor's own bids (vendor dashboard)
router.get('/bids', allow('vendor'), ctrl.getVendorBids);

// GET /api/vendors/bids/:jobId - Agent views bids for a job
router.get('/bids/:jobId', allow('agent'), ctrl.getBidsForJob);

// PATCH /api/vendors/bids/:id/accept - Agent accepts a bid
router.patch('/bids/:id/accept', allow('agent'), ctrl.acceptBid);

// PATCH /api/vendors/bids/:id/reject - Agent rejects a bid
router.patch('/bids/:id/reject', allow('agent'), ctrl.rejectBid);

// PATCH /api/vendors/bids/:id/pay - Agent marks vendor as paid
router.patch('/bids/:id/pay', allow('agent'), ctrl.markAsPaid);

// PATCH /api/vendors/bids/:id/complete-work - Vendor marks work as completed
router.patch('/bids/:id/complete-work', allow('vendor'), ctrl.completeWork);

// POST /api/vendors/bids/:id/receipt - Vendor uploads receipt after job done
router.post('/bids/:id/receipt', allow('vendor'), upload.single('receipt'), ctrl.uploadVendorReceipt);

// GET /api/vendors/bids/:id/receipt - Get vendor receipt (client, agent, vendor can view)
router.get('/bids/:id/receipt', allow('client', 'agent', 'vendor'), ctrl.getVendorReceipt);

// GET /api/vendors/jobs/:jobId/receipts - Get all vendor receipts for a job (client/agent)
router.get('/jobs/:jobId/receipts', allow('client', 'agent'), ctrl.getJobVendorReceipts);

// ============================================
// OPPORTUNITIES ROUTES
// ============================================

// GET /api/vendors/opportunities - Get jobs open for bidding
router.get('/opportunities', allow('vendor'), ctrl.getOpportunities);

// ============================================
// HAULER VIDEOS ROUTES (for vendors to view)
// ============================================

// GET /api/vendors/jobs/:jobId/videos - Vendor views hauler videos for a job
router.get('/jobs/:jobId/videos', allow('vendor'), ctrl.getJobVideos);

// ============================================
// DONATION ROUTES
// ============================================

// POST /api/vendors/donations/receipt - Upload donation receipt PDF
router.post('/donations/receipt', allow('vendor'), upload.single('receipt'), ctrl.uploadDonationReceipt);

// GET /api/vendors/donations/receipts/:jobId - Get receipts for a job
router.get('/donations/receipts/:jobId', allow('agent', 'client', 'vendor'), ctrl.getDonationReceipts);

// ============================================
// ITEM DISPOSITION ROUTES
// ============================================

// GET /api/vendors/items/:jobId - Get items for a job with disposition status
router.get('/items/:jobId', allow('agent', 'vendor'), ctrl.getJobItems);

// PATCH /api/vendors/items/donated - Mark items as donated
router.patch('/items/donated', allow('agent', 'vendor'), ctrl.markItemsAsDonated);

// PATCH /api/vendors/items/hauled - Mark items as hauled
router.patch('/items/hauled', allow('agent', 'vendor'), ctrl.markItemsAsHauled);

// ============================================
// VENDOR CRUD ROUTES (agent manages vendors)
// ============================================

// GET /api/vendors - List all vendors
router.get('/', allow('agent', 'vendor'), ctrl.listVendors);

// POST /api/vendors - Create a vendor
router.post('/', allow('agent'), ctrl.createVendor);

// GET /api/vendors/:id - Get single vendor
router.get('/:id', allow('agent', 'vendor'), ctrl.getVendor);

// PATCH /api/vendors/:id - Update vendor
router.patch('/:id', allow('agent'), ctrl.updateVendor);

// DELETE /api/vendors/:id - Deactivate vendor
router.delete('/:id', allow('agent'), ctrl.deleteVendor);

module.exports = router;
