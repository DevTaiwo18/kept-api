const Bid = require('../models/Bid');
const Vendor = require('../models/Vendor');
const ClientJob = require('../models/ClientJob');
const Item = require('../models/Item');
const { User } = require('../models/User');
const { cloudinary } = require('../config/cloudinary');
const { z } = require('zod');
const { sendEmail } = require('../utils/sendEmail');

// Email template helper
function getEmailTemplate(name, content) {
  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="margin: 0; padding: 0; background-color: #f4f4f4;">
        <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f4f4; padding: 20px 0;">
          <tr>
            <td align="center">
              <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
                <tr>
                  <td style="background: linear-gradient(135deg, #e6c35a 0%, #d4af37 100%); padding: 30px 40px; text-align: center;">
                    <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-family: Arial, sans-serif; font-weight: 600;">
                      Kept House
                    </h1>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 40px 40px 30px 40px;">
                    <h2 style="color: #101010; margin: 0 0 20px 0; font-size: 22px; font-family: Arial, sans-serif; font-weight: 500;">
                      Hi ${name},
                    </h2>
                    ${content}
                  </td>
                </tr>
                <tr>
                  <td style="background-color: #f9f9f9; padding: 25px 40px; border-top: 1px solid #e0e0e0;">
                    <p style="font-size: 14px; line-height: 1.6; color: #666; margin: 0 0 10px 0; font-family: Arial, sans-serif;">
                      Best regards,<br/>
                      <strong style="color: #333;">The Kept House Team</strong>
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
  `;
}

// ============================================
// BID ENDPOINTS
// ============================================

const createBidSchema = z.object({
  job: z.string().min(1, 'Job ID is required'),
  vendorId: z.string().min(1, 'Vendor ID is required'),
  amount: z.number().positive('Amount must be positive'),
  timelineDays: z.number().int().min(0).default(0),
  notes: z.string().optional(),
  // Payment info
  paymentMethod: z.enum(['cash', 'cashapp', 'bank'], { required_error: 'Payment method is required' }),
  cashAppHandle: z.string().optional(),
  bankDetails: z.object({
    bankName: z.string().min(1),
    accountNumber: z.string().min(1),
    routingNumber: z.string().min(1),
    accountHolderName: z.string().min(1)
  }).optional()
}).refine((data) => {
  // If cashapp, require cashAppHandle
  if (data.paymentMethod === 'cashapp' && !data.cashAppHandle) {
    return false;
  }
  // If bank, require bankDetails
  if (data.paymentMethod === 'bank' && !data.bankDetails) {
    return false;
  }
  return true;
}, {
  message: 'Cash App handle required for cashapp, bank details required for bank payment',
  path: ['paymentMethod']
});

// POST /api/vendors/bids - Hauler submits a bid for a job
exports.submitBid = async (req, res) => {
  try {
    const data = createBidSchema.parse(req.body);

    // Verify job exists
    const job = await ClientJob.findById(data.job);
    if (!job) {
      return res.status(404).json({ success: false, message: 'Job not found' });
    }

    // Verify vendor exists and is active
    const vendor = await Vendor.findById(data.vendorId);
    if (!vendor) {
      return res.status(404).json({ success: false, message: 'Vendor not found' });
    }
    if (!vendor.active) {
      return res.status(400).json({ success: false, message: 'Vendor is not active' });
    }

    // Determine bidType based on job stage
    const bidType = job.stage === 'donations' ? 'donation' : 'hauling';

    // Check if vendor already has a pending bid for this job AND same bidType
    const existingBid = await Bid.findOne({
      job: data.job,
      vendor: data.vendorId,
      bidType: bidType,
      status: 'submitted'
    });
    if (existingBid) {
      return res.status(400).json({
        success: false,
        message: `You already have a pending ${bidType} bid for this job`
      });
    }

    const bid = await Bid.create({
      job: data.job,
      vendor: data.vendorId,
      amount: data.amount,
      timelineDays: data.timelineDays,
      status: 'submitted',
      bidType: bidType,
      paymentMethod: data.paymentMethod,
      cashAppHandle: data.cashAppHandle || null,
      bankDetails: data.bankDetails || null
    });

    const populatedBid = await Bid.findById(bid._id)
      .populate('vendor', 'name type email phone')
      .populate('job', 'propertyAddress contractSignor stage');

    // Send email notification to all agents
    try {
      const agents = await User.find({ role: 'agent' }).select('name email');

      for (const agent of agents) {
        const content = `
          <p style="font-size: 16px; line-height: 1.6; color: #333; margin: 0 0 15px 0; font-family: Arial, sans-serif;">
            A new bid has been submitted for a job.
          </p>
          <div style="background-color: #f9f9f9; border-left: 4px solid #e6c35a; padding: 15px 20px; margin: 20px 0;">
            <p style="font-size: 14px; line-height: 1.6; color: #555; margin: 0; font-family: Arial, sans-serif;">
              <strong>Job:</strong> ${job.propertyAddress}<br/>
              <strong>Vendor:</strong> ${vendor.name}<br/>
              <strong>Vendor Type:</strong> ${vendor.type}<br/>
              <strong>Bid Amount:</strong> $${data.amount.toLocaleString()}<br/>
              <strong>Timeline:</strong> ${data.timelineDays} days
            </p>
          </div>
          <p style="font-size: 16px; line-height: 1.6; color: #333; margin: 20px 0 0 0; font-family: Arial, sans-serif;">
            Please log in to review and respond to this bid.
          </p>
        `;

        await sendEmail({
          to: agent.email,
          subject: `New Bid Received - ${job.propertyAddress}`,
          html: getEmailTemplate(agent.name, content),
          text: `Hi ${agent.name}, A new bid has been submitted. Job: ${job.propertyAddress}, Vendor: ${vendor.name}, Amount: $${data.amount}, Timeline: ${data.timelineDays} days. Please log in to review.`
        });
      }
    } catch (emailErr) {
      console.error('Failed to send bid notification email:', emailErr);
    }

    res.status(201).json({ success: true, bid: populatedBid });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ success: false, errors: err.errors });
    }
    console.error('submitBid error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// GET /api/vendors/bids/:jobId - Agent views bids for a specific job
exports.getBidsForJob = async (req, res) => {
  try {
    const { jobId } = req.params;
    const { status, type, bidType } = req.query;

    // Verify job exists
    const job = await ClientJob.findById(jobId);
    if (!job) {
      return res.status(404).json({ success: false, message: 'Job not found' });
    }

    const filter = { job: jobId };
    if (status) filter.status = status;
    if (bidType) filter.bidType = bidType;

    let bids = await Bid.find(filter)
      .populate('vendor', 'name type email phone serviceType')
      .sort({ createdAt: -1 });

    // Filter by vendor type if specified
    if (type) {
      bids = bids.filter(bid => bid.vendor && bid.vendor.type === type);
    }

    // Group bids by bidType for easier frontend consumption
    const donationBids = bids.filter(b => b.bidType === 'donation');
    const haulingBids = bids.filter(b => b.bidType === 'hauling');
    const legacyBids = bids.filter(b => !b.bidType);

    res.json({
      success: true,
      bids,
      grouped: {
        donation: donationBids,
        hauling: haulingBids,
        legacy: legacyBids
      }
    });
  } catch (err) {
    console.error('getBidsForJob error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// PATCH /api/vendors/bids/:id/accept - Agent selects a winning bid
exports.acceptBid = async (req, res) => {
  try {
    const { id } = req.params;

    const bid = await Bid.findById(id);
    if (!bid) {
      return res.status(404).json({ success: false, message: 'Bid not found' });
    }

    if (bid.status !== 'submitted') {
      return res.status(400).json({
        success: false,
        message: 'Bid has already been processed'
      });
    }

    // Accept this bid
    bid.status = 'accepted';
    await bid.save();

    // Reject all other submitted bids for this job with the same bidType
    // This allows a job to have both a donation vendor AND a hauling vendor
    const rejectFilter = {
      job: bid.job,
      _id: { $ne: bid._id },
      status: 'submitted'
    };
    // Only reject bids of the same type (if bidType exists)
    if (bid.bidType) {
      rejectFilter.bidType = bid.bidType;
    }
    await Bid.updateMany(rejectFilter, { $set: { status: 'rejected' } });

    const populatedBid = await Bid.findById(bid._id)
      .populate('vendor', 'name type email phone')
      .populate('job', 'propertyAddress contractSignor stage');

    // Send email notification to the winning vendor
    try {
      if (populatedBid.vendor && populatedBid.vendor.email) {
        const content = `
          <p style="font-size: 16px; line-height: 1.6; color: #333; margin: 0 0 15px 0; font-family: Arial, sans-serif;">
            Congratulations! Your bid has been <strong style="color: #28a745;">accepted</strong>.
          </p>
          <div style="background-color: #d4edda; border-left: 4px solid #28a745; padding: 15px 20px; margin: 20px 0;">
            <p style="font-size: 14px; line-height: 1.6; color: #155724; margin: 0; font-family: Arial, sans-serif;">
              <strong>Job:</strong> ${populatedBid.job.propertyAddress}<br/>
              <strong>Your Bid Amount:</strong> $${bid.amount.toLocaleString()}<br/>
              <strong>Timeline:</strong> ${bid.timelineDays} days
            </p>
          </div>
          <p style="font-size: 16px; line-height: 1.6; color: #333; margin: 20px 0 0 0; font-family: Arial, sans-serif;">
            The Kept House team will be in touch with next steps. Thank you for your partnership!
          </p>
        `;

        await sendEmail({
          to: populatedBid.vendor.email,
          subject: `Bid Accepted - ${populatedBid.job.propertyAddress}`,
          html: getEmailTemplate(populatedBid.vendor.name, content),
          text: `Hi ${populatedBid.vendor.name}, Congratulations! Your bid has been accepted. Job: ${populatedBid.job.propertyAddress}, Amount: $${bid.amount}, Timeline: ${bid.timelineDays} days. The Kept House team will be in touch with next steps.`
        });
      }
    } catch (emailErr) {
      console.error('Failed to send bid accepted email:', emailErr);
    }

    res.json({
      success: true,
      message: 'Bid accepted successfully',
      bid: populatedBid
    });
  } catch (err) {
    console.error('acceptBid error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// PATCH /api/vendors/bids/:id/reject - Agent rejects a bid
exports.rejectBid = async (req, res) => {
  try {
    const { id } = req.params;

    const bid = await Bid.findById(id);
    if (!bid) {
      return res.status(404).json({ success: false, message: 'Bid not found' });
    }

    if (bid.status !== 'submitted') {
      return res.status(400).json({
        success: false,
        message: 'Bid has already been processed'
      });
    }

    bid.status = 'rejected';
    await bid.save();

    const populatedBid = await Bid.findById(bid._id)
      .populate('vendor', 'name type email phone')
      .populate('job', 'propertyAddress contractSignor stage');

    // Send email notification to the rejected vendor
    try {
      if (populatedBid.vendor && populatedBid.vendor.email) {
        const content = `
          <p style="font-size: 16px; line-height: 1.6; color: #333; margin: 0 0 15px 0; font-family: Arial, sans-serif;">
            We regret to inform you that your bid has not been selected for this job.
          </p>
          <div style="background-color: #f8f9fa; border-left: 4px solid #6c757d; padding: 15px 20px; margin: 20px 0;">
            <p style="font-size: 14px; line-height: 1.6; color: #555; margin: 0; font-family: Arial, sans-serif;">
              <strong>Job:</strong> ${populatedBid.job.propertyAddress}<br/>
              <strong>Your Bid Amount:</strong> $${bid.amount.toLocaleString()}
            </p>
          </div>
          <p style="font-size: 16px; line-height: 1.6; color: #333; margin: 20px 0 0 0; font-family: Arial, sans-serif;">
            Thank you for your interest. We encourage you to continue bidding on future opportunities.
          </p>
        `;

        await sendEmail({
          to: populatedBid.vendor.email,
          subject: `Bid Update - ${populatedBid.job.propertyAddress}`,
          html: getEmailTemplate(populatedBid.vendor.name, content),
          text: `Hi ${populatedBid.vendor.name}, We regret to inform you that your bid has not been selected for the job at ${populatedBid.job.propertyAddress}. Thank you for your interest. We encourage you to continue bidding on future opportunities.`
        });
      }
    } catch (emailErr) {
      console.error('Failed to send bid rejected email:', emailErr);
    }

    res.json({
      success: true,
      message: 'Bid rejected',
      bid: populatedBid
    });
  } catch (err) {
    console.error('rejectBid error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// GET /api/vendors/bids - Get all bids (for vendor dashboard)
exports.getVendorBids = async (req, res) => {
  try {
    const { vendorId, status } = req.query;

    if (!vendorId) {
      return res.status(400).json({ success: false, message: 'vendorId is required' });
    }

    const filter = { vendor: vendorId };
    if (status) filter.status = status;

    const bids = await Bid.find(filter)
      .populate('job', 'propertyAddress contractSignor stage status')
      .sort({ createdAt: -1 });

    res.json({ success: true, bids });
  } catch (err) {
    console.error('getVendorBids error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// PATCH /api/vendors/bids/:id/pay - Agent marks bid as paid (after paying vendor outside app)
exports.markAsPaid = async (req, res) => {
  try {
    const { id } = req.params;
    const { paidAmount } = req.body;

    const bid = await Bid.findById(id).populate('vendor', 'name serviceType');
    if (!bid) {
      return res.status(404).json({ success: false, message: 'Bid not found' });
    }

    if (bid.status !== 'accepted') {
      return res.status(400).json({
        success: false,
        message: 'Can only mark accepted bids as paid'
      });
    }

    if (bid.isPaid) {
      return res.status(400).json({
        success: false,
        message: 'Bid has already been marked as paid'
      });
    }

    // Mark bid as paid
    bid.isPaid = true;
    bid.paidAt = new Date();
    bid.paidAmount = paidAmount || bid.amount;
    await bid.save();

    // Update job finance - add to haulingCost and create transaction
    const job = await ClientJob.findById(bid.job);
    if (job) {
      // Determine label based on vendor service type
      const isHauling = bid.vendor.serviceType === 'hauling' || bid.vendor.serviceType === 'both';
      const label = isHauling ? `Hauling - ${bid.vendor.name}` : `Donation - ${bid.vendor.name}`;

      // Add to haulingCost (used for net calculation)
      job.finance.haulingCost = (job.finance.haulingCost || 0) + bid.paidAmount;

      // Add transaction to daily array
      if (!job.finance.daily) {
        job.finance.daily = [];
      }
      job.finance.daily.push({
        label: label,
        amount: -bid.paidAmount, // Negative because it's an expense
        at: new Date()
      });

      await job.save();
    }

    const populatedBid = await Bid.findById(bid._id)
      .populate('vendor', 'name type email phone serviceType')
      .populate('job', 'propertyAddress contractSignor stage finance');

    res.json({
      success: true,
      message: 'Vendor payment recorded successfully',
      bid: populatedBid
    });
  } catch (err) {
    console.error('markAsPaid error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// PATCH /api/vendors/bids/:id/complete-work - Vendor marks work as completed
exports.completeWork = async (req, res) => {
  try {
    const { id } = req.params;

    const bid = await Bid.findById(id).populate('job', 'stage');
    if (!bid) {
      return res.status(404).json({ success: false, message: 'Bid not found' });
    }

    if (bid.status !== 'accepted') {
      return res.status(400).json({
        success: false,
        message: 'Can only complete work for accepted bids'
      });
    }

    if (bid.workCompleted) {
      return res.status(400).json({
        success: false,
        message: 'Work has already been marked as completed'
      });
    }

    // Mark work as completed
    bid.workCompleted = true;
    bid.workCompletedAt = new Date();
    await bid.save();

    const populatedBid = await Bid.findById(bid._id)
      .populate('vendor', 'name type email phone serviceType')
      .populate('job', 'propertyAddress contractSignor stage');

    // Determine work type for message
    const workType = bid.job.stage === 'donations' ? 'Donation' : 'Hauling';

    res.json({
      success: true,
      message: `${workType} work marked as completed. You can now upload your receipt.`,
      bid: populatedBid
    });
  } catch (err) {
    console.error('completeWork error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// POST /api/vendors/bids/:id/receipt - Vendor uploads receipt after job completion
exports.uploadVendorReceipt = async (req, res) => {
  try {
    const { id } = req.params;

    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Receipt file is required' });
    }

    const bid = await Bid.findById(id);
    if (!bid) {
      return res.status(404).json({ success: false, message: 'Bid not found' });
    }

    if (bid.status !== 'accepted') {
      return res.status(400).json({
        success: false,
        message: 'Can only upload receipt for accepted bids'
      });
    }

    // Update bid with receipt
    bid.receipt = {
      url: req.file.path,
      uploadedAt: new Date()
    };
    await bid.save();

    const populatedBid = await Bid.findById(bid._id)
      .populate('vendor', 'name type email phone')
      .populate('job', 'propertyAddress contractSignor stage');

    res.json({
      success: true,
      message: 'Receipt uploaded successfully',
      bid: populatedBid
    });
  } catch (err) {
    console.error('uploadVendorReceipt error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// GET /api/vendors/bids/:id/receipt - Get vendor receipt for a bid
exports.getVendorReceipt = async (req, res) => {
  try {
    const { id } = req.params;

    const bid = await Bid.findById(id)
      .populate('vendor', 'name type serviceType')
      .populate('job', 'propertyAddress contractSignor');

    if (!bid) {
      return res.status(404).json({ success: false, message: 'Bid not found' });
    }

    if (!bid.receipt || !bid.receipt.url) {
      return res.status(404).json({ success: false, message: 'No receipt uploaded for this bid' });
    }

    res.json({
      success: true,
      receipt: bid.receipt,
      vendor: bid.vendor,
      job: bid.job
    });
  } catch (err) {
    console.error('getVendorReceipt error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// GET /api/vendors/jobs/:jobId/receipts - Get all vendor receipts for a job (for client/agent view)
exports.getJobVendorReceipts = async (req, res) => {
  try {
    const { jobId } = req.params;

    // Verify job exists
    const job = await ClientJob.findById(jobId).select('propertyAddress contractSignor');
    if (!job) {
      return res.status(404).json({ success: false, message: 'Job not found' });
    }

    // Get all accepted bids for this job that have receipts
    const bidsWithReceipts = await Bid.find({
      job: jobId,
      status: 'accepted',
      'receipt.url': { $exists: true, $ne: null }
    })
      .populate('vendor', 'name type serviceType companyName')
      .select('vendor amount isPaid paidAt receipt bidType');

    res.json({
      success: true,
      job: {
        _id: job._id,
        propertyAddress: job.propertyAddress,
        contractSignor: job.contractSignor
      },
      receipts: bidsWithReceipts.map(bid => ({
        bidId: bid._id,
        bidType: bid.bidType,
        vendor: bid.vendor,
        amount: bid.amount,
        isPaid: bid.isPaid,
        paidAt: bid.paidAt,
        receipt: bid.receipt
      }))
    });
  } catch (err) {
    console.error('getJobVendorReceipts error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ============================================
// OPPORTUNITIES ENDPOINTS
// ============================================

// GET /api/vendors/opportunities - Get jobs open for bidding (for vendors)
exports.getOpportunities = async (req, res) => {
  try {
    const { vendorId } = req.query;
    const { stage } = req.query;

    // If vendorId provided, get vendor's service type to filter opportunities
    let vendorServiceType = null;
    if (vendorId) {
      const vendor = await Vendor.findById(vendorId).select('serviceType');
      if (vendor) {
        vendorServiceType = vendor.serviceType;
      }
    }

    // Determine which stages to show based on vendor's serviceType
    let stageFilter;
    if (stage) {
      stageFilter = stage;
    } else if (vendorServiceType === 'hauling') {
      stageFilter = 'hauling';
    } else if (vendorServiceType === 'donation') {
      stageFilter = 'donations';
    } else {
      // 'both' or no vendor - show all relevant stages
      stageFilter = { $in: ['hauling', 'donations'] };
    }

    // Get jobs in the appropriate stage(s)
    const filter = { stage: stageFilter };

    const jobs = await ClientJob.find(filter)
      .select('propertyAddress contractSignor stage status createdAt finance.gross')
      .sort({ createdAt: -1 });

    // Filter to only active jobs (case-insensitive)
    const activeJobs = jobs.filter(job =>
      job.status && job.status.toLowerCase() === 'active'
    );

    // Get accepted bids with their bidType to filter jobs correctly
    // A donation job should only be hidden if it has an accepted donation bid
    // A hauling job should only be hidden if it has an accepted hauling bid
    const acceptedBids = await Bid.find({ status: 'accepted' }).select('job bidType');

    // Create maps for donation and hauling accepted bids separately
    const donationAcceptedJobs = new Set();
    const haulingAcceptedJobs = new Set();
    acceptedBids.forEach(bid => {
      if (bid.bidType === 'donation') {
        donationAcceptedJobs.add(bid.job.toString());
      } else if (bid.bidType === 'hauling') {
        haulingAcceptedJobs.add(bid.job.toString());
      } else {
        // Legacy bids without bidType - exclude from both (conservative approach)
        donationAcceptedJobs.add(bid.job.toString());
        haulingAcceptedJobs.add(bid.job.toString());
      }
    });

    // Filter out jobs that already have an accepted bid for their current stage
    const availableJobs = activeJobs.filter(job => {
      if (job.stage === 'donations') {
        return !donationAcceptedJobs.has(job._id.toString());
      } else if (job.stage === 'hauling') {
        return !haulingAcceptedJobs.has(job._id.toString());
      }
      return true;
    });

    // Get item counts for each job
    const jobIds = availableJobs.map(job => job._id);
    const items = await Item.find({ job: { $in: jobIds } }).select('job approvedItems soldPhotoIndices');

    // Create a map of jobId -> available items count
    const itemCountMap = {};
    items.forEach(item => {
      if (item.approvedItems) {
        const soldPhotoIndicesSet = new Set(item.soldPhotoIndices || []);
        const availableCount = item.approvedItems.filter(ai => {
          if (ai.disposition && ai.disposition !== 'available') return false;
          const isSold = ai.photoIndices?.some(idx => soldPhotoIndicesSet.has(idx));
          return !isSold;
        }).length;
        itemCountMap[item.job.toString()] = availableCount;
      }
    });

    // If vendorId provided, mark which jobs vendor has already bid on (for current stage)
    let jobsWithBidStatus = availableJobs;
    if (vendorId) {
      const vendorBids = await Bid.find({ vendor: vendorId }).select('job status bidType');

      // Create bid maps per bidType
      const donationBidMap = {};
      const haulingBidMap = {};
      vendorBids.forEach(bid => {
        if (bid.bidType === 'donation') {
          donationBidMap[bid.job.toString()] = bid.status;
        } else if (bid.bidType === 'hauling') {
          haulingBidMap[bid.job.toString()] = bid.status;
        } else {
          // Legacy bids - add to both maps
          donationBidMap[bid.job.toString()] = bid.status;
          haulingBidMap[bid.job.toString()] = bid.status;
        }
      });

      jobsWithBidStatus = availableJobs.map(job => {
        const bidMap = job.stage === 'donations' ? donationBidMap : haulingBidMap;
        return {
          ...job.toObject(),
          vendorBidStatus: bidMap[job._id.toString()] || null,
          availableItemsCount: itemCountMap[job._id.toString()] || 0
        };
      });
    } else {
      jobsWithBidStatus = availableJobs.map(job => ({
        ...job.toObject(),
        availableItemsCount: itemCountMap[job._id.toString()] || 0
      }));
    }

    res.json({ success: true, opportunities: jobsWithBidStatus });
  } catch (err) {
    console.error('getOpportunities error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ============================================
// HAULER VIDEOS ENDPOINTS (for vendors to view)
// ============================================

// GET /api/vendors/jobs/:jobId/videos - Vendor views hauler videos and available items for a job
exports.getJobVideos = async (req, res) => {
  try {
    const { jobId } = req.params;

    const job = await ClientJob.findById(jobId)
      .select('haulerVideos propertyAddress contractSignor stage')
      .populate('haulerVideos.uploadedBy', 'name');

    if (!job) {
      return res.status(404).json({ success: false, message: 'Job not found' });
    }

    // Get available items for this job
    const item = await Item.findOne({ job: jobId });
    let availableItems = [];
    let itemSummary = { total: 0, available: 0, sold: 0, donated: 0, hauled: 0 };

    if (item && item.approvedItems) {
      // Get sold photo indices set for quick lookup
      const soldPhotoIndicesSet = new Set(item.soldPhotoIndices || []);

      // Helper to determine actual disposition
      const getActualDisposition = (approvedItem) => {
        if (approvedItem.disposition && approvedItem.disposition !== 'available') {
          return approvedItem.disposition;
        }
        const isSold = approvedItem.photoIndices?.some(idx => soldPhotoIndicesSet.has(idx));
        if (isSold) return 'sold';
        return approvedItem.disposition || 'available';
      };

      // Map all items with actual disposition
      const allItems = item.approvedItems.map(i => ({
        itemNumber: i.itemNumber,
        title: i.title,
        description: i.description,
        category: i.category,
        price: i.price,
        photo: item.photos[i.photoIndices?.[0]] || null,
        disposition: getActualDisposition(i)
      }));

      // Filter to only available items
      availableItems = allItems.filter(i => i.disposition === 'available');

      // Calculate summary
      itemSummary = {
        total: allItems.length,
        available: availableItems.length,
        sold: allItems.filter(i => i.disposition === 'sold').length,
        donated: allItems.filter(i => i.disposition === 'donated').length,
        hauled: allItems.filter(i => i.disposition === 'hauled').length
      };
    }

    res.json({
      success: true,
      job: {
        _id: job._id,
        propertyAddress: job.propertyAddress,
        contractSignor: job.contractSignor,
        stage: job.stage
      },
      videos: job.haulerVideos || [],
      items: availableItems,
      itemSummary
    });
  } catch (err) {
    console.error('getJobVideos error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ============================================
// DONATION ENDPOINTS
// ============================================

// POST /api/vendors/donations/receipt - Donation partner uploads PDF receipt
exports.uploadDonationReceipt = async (req, res) => {
  try {
    const { jobId } = req.body;

    if (!jobId) {
      return res.status(400).json({ success: false, message: 'jobId is required' });
    }

    if (!req.file) {
      return res.status(400).json({ success: false, message: 'PDF file is required' });
    }

    // Verify job exists
    const job = await ClientJob.findById(jobId);
    if (!job) {
      return res.status(404).json({ success: false, message: 'Job not found' });
    }

    // Add donation receipt to job
    if (!job.donationReceipts) {
      job.donationReceipts = [];
    }

    job.donationReceipts.push({
      url: req.file.path,
      uploadedAt: new Date(),
      uploadedBy: req.user.sub
    });

    await job.save();

    res.json({
      success: true,
      message: 'Donation receipt uploaded successfully',
      receipt: {
        url: req.file.path,
        uploadedAt: new Date()
      }
    });
  } catch (err) {
    console.error('uploadDonationReceipt error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// GET /api/vendors/donations/receipts/:jobId - Get donation receipts for a job
exports.getDonationReceipts = async (req, res) => {
  try {
    const { jobId } = req.params;

    const job = await ClientJob.findById(jobId).select('donationReceipts');
    if (!job) {
      return res.status(404).json({ success: false, message: 'Job not found' });
    }

    res.json({
      success: true,
      receipts: job.donationReceipts || []
    });
  } catch (err) {
    console.error('getDonationReceipts error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ============================================
// ITEM DISPOSITION ENDPOINTS
// ============================================

// PATCH /api/vendors/items/donated - Mark selected items as donated
exports.markItemsAsDonated = async (req, res) => {
  try {
    const { jobId, itemNumbers } = req.body;

    if (!jobId) {
      return res.status(400).json({ success: false, message: 'jobId is required' });
    }

    if (!itemNumbers || !Array.isArray(itemNumbers) || itemNumbers.length === 0) {
      return res.status(400).json({ success: false, message: 'itemNumbers array is required' });
    }

    // Find the item document for this job
    const item = await Item.findOne({ job: jobId });
    if (!item) {
      return res.status(404).json({ success: false, message: 'No items found for this job' });
    }

    // Initialize donatedPhotoIndices if not exists
    if (!item.donatedPhotoIndices) {
      item.donatedPhotoIndices = [];
    }

    // Update disposition for specified items in approvedItems array
    let updatedCount = 0;
    item.approvedItems.forEach(approvedItem => {
      if (itemNumbers.includes(approvedItem.itemNumber)) {
        approvedItem.disposition = 'donated';
        approvedItem.dispositionAt = new Date();
        approvedItem.dispositionBy = req.user.sub;
        updatedCount++;

        // Add photo indices to donatedPhotoIndices
        if (approvedItem.photoIndices && approvedItem.photoIndices.length > 0) {
          item.donatedPhotoIndices.push(...approvedItem.photoIndices);
        }
      }
    });

    if (updatedCount === 0) {
      return res.status(400).json({
        success: false,
        message: 'No matching items found to mark as donated'
      });
    }

    // Set donatedAt timestamp if first donation
    if (!item.donatedAt) {
      item.donatedAt = new Date();
    }

    await item.save();

    res.json({
      success: true,
      message: `${updatedCount} item(s) marked as donated`,
      updatedCount
    });
  } catch (err) {
    console.error('markItemsAsDonated error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// PATCH /api/vendors/items/hauled - Mark selected items as hauled
exports.markItemsAsHauled = async (req, res) => {
  try {
    const { jobId, itemNumbers } = req.body;

    if (!jobId) {
      return res.status(400).json({ success: false, message: 'jobId is required' });
    }

    if (!itemNumbers || !Array.isArray(itemNumbers) || itemNumbers.length === 0) {
      return res.status(400).json({ success: false, message: 'itemNumbers array is required' });
    }

    // Find the item document for this job
    const item = await Item.findOne({ job: jobId });
    if (!item) {
      return res.status(404).json({ success: false, message: 'No items found for this job' });
    }

    // Initialize hauledPhotoIndices if not exists
    if (!item.hauledPhotoIndices) {
      item.hauledPhotoIndices = [];
    }

    // Update disposition for specified items in approvedItems array
    let updatedCount = 0;
    item.approvedItems.forEach(approvedItem => {
      if (itemNumbers.includes(approvedItem.itemNumber)) {
        approvedItem.disposition = 'hauled';
        approvedItem.dispositionAt = new Date();
        approvedItem.dispositionBy = req.user.sub;
        updatedCount++;

        // Add photo indices to hauledPhotoIndices
        if (approvedItem.photoIndices && approvedItem.photoIndices.length > 0) {
          item.hauledPhotoIndices.push(...approvedItem.photoIndices);
        }
      }
    });

    if (updatedCount === 0) {
      return res.status(400).json({
        success: false,
        message: 'No matching items found to mark as hauled'
      });
    }

    // Set hauledAt timestamp if first hauling
    if (!item.hauledAt) {
      item.hauledAt = new Date();
    }

    await item.save();

    res.json({
      success: true,
      message: `${updatedCount} item(s) marked as hauled`,
      updatedCount
    });
  } catch (err) {
    console.error('markItemsAsHauled error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// GET /api/vendors/items/:jobId - Get all items for a job with their disposition status
exports.getJobItems = async (req, res) => {
  try {
    const { jobId } = req.params;
    const { disposition } = req.query;

    // Verify job exists
    const job = await ClientJob.findById(jobId).select('propertyAddress contractSignor stage');
    if (!job) {
      return res.status(404).json({ success: false, message: 'Job not found' });
    }

    // Find the item document for this job
    const item = await Item.findOne({ job: jobId });
    if (!item) {
      return res.json({
        success: true,
        job: {
          _id: job._id,
          propertyAddress: job.propertyAddress,
          contractSignor: job.contractSignor,
          stage: job.stage
        },
        items: [],
        summary: { total: 0, available: 0, sold: 0, donated: 0, hauled: 0 }
      });
    }

    // Get sold photo indices set for quick lookup
    const soldPhotoIndicesSet = new Set(item.soldPhotoIndices || []);

    // Helper to determine actual disposition (checking soldPhotoIndices for sold items)
    const getActualDisposition = (approvedItem) => {
      // If already has a disposition set, use it
      if (approvedItem.disposition && approvedItem.disposition !== 'available') {
        return approvedItem.disposition;
      }
      // Check if any of the item's photos are in soldPhotoIndices
      const isSold = approvedItem.photoIndices?.some(idx => soldPhotoIndicesSet.has(idx));
      if (isSold) {
        return 'sold';
      }
      return approvedItem.disposition || 'available';
    };

    // Map all items with actual disposition
    let allItems = (item.approvedItems || []).map(i => ({
      itemNumber: i.itemNumber,
      title: i.title,
      description: i.description,
      category: i.category,
      price: i.price,
      photo: item.photos[i.photoIndices?.[0]] || null,
      disposition: getActualDisposition(i),
      dispositionAt: i.dispositionAt,
      dispositionBy: i.dispositionBy
    }));

    // Calculate summary based on actual dispositions
    const summary = {
      total: allItems.length,
      available: allItems.filter(i => i.disposition === 'available').length,
      sold: allItems.filter(i => i.disposition === 'sold').length,
      donated: allItems.filter(i => i.disposition === 'donated').length,
      hauled: allItems.filter(i => i.disposition === 'hauled').length
    };

    // Filter by disposition if specified
    if (disposition) {
      allItems = allItems.filter(i => i.disposition === disposition);
    }

    res.json({
      success: true,
      job: {
        _id: job._id,
        propertyAddress: job.propertyAddress,
        contractSignor: job.contractSignor,
        stage: job.stage
      },
      items: allItems,
      summary
    });
  } catch (err) {
    console.error('getJobItems error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ============================================
// VENDOR CRUD (for agents to manage vendors)
// ============================================

// GET /api/vendors - List all vendors
exports.listVendors = async (req, res) => {
  try {
    const { type, active, search } = req.query;
    const filter = {};

    if (type) filter.type = type;
    if (active !== undefined) filter.active = active === 'true';
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }

    const vendors = await Vendor.find(filter).sort({ createdAt: -1 });
    res.json({ success: true, vendors });
  } catch (err) {
    console.error('listVendors error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// POST /api/vendors - Create a vendor
exports.createVendor = async (req, res) => {
  try {
    const { name, type, email, phone, notes } = req.body;

    if (!name) {
      return res.status(400).json({ success: false, message: 'Name is required' });
    }

    const vendor = await Vendor.create({
      name,
      type: type || 'other',
      email,
      phone,
      notes,
      active: true
    });

    res.status(201).json({ success: true, vendor });
  } catch (err) {
    console.error('createVendor error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// GET /api/vendors/:id - Get single vendor
exports.getVendor = async (req, res) => {
  try {
    const vendor = await Vendor.findById(req.params.id);
    if (!vendor) {
      return res.status(404).json({ success: false, message: 'Vendor not found' });
    }
    res.json({ success: true, vendor });
  } catch (err) {
    console.error('getVendor error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// PATCH /api/vendors/:id - Update vendor
exports.updateVendor = async (req, res) => {
  try {
    const { name, type, email, phone, notes, active } = req.body;

    const vendor = await Vendor.findByIdAndUpdate(
      req.params.id,
      { $set: { name, type, email, phone, notes, active } },
      { new: true, runValidators: true }
    );

    if (!vendor) {
      return res.status(404).json({ success: false, message: 'Vendor not found' });
    }

    res.json({ success: true, vendor });
  } catch (err) {
    console.error('updateVendor error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// DELETE /api/vendors/:id - Deactivate vendor
exports.deleteVendor = async (req, res) => {
  try {
    const vendor = await Vendor.findByIdAndUpdate(
      req.params.id,
      { $set: { active: false } },
      { new: true }
    );

    if (!vendor) {
      return res.status(404).json({ success: false, message: 'Vendor not found' });
    }

    res.json({ success: true, message: 'Vendor deactivated', vendor });
  } catch (err) {
    console.error('deleteVendor error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};
