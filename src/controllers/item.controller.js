const fs = require('fs/promises');
const { z } = require('zod');
const Item = require('../models/Item');
const ClientJob = require('../models/ClientJob');
const { User } = require('../models/User');
const { cloudinary } = require('../config/cloudinary');
const openai = require('../config/openai');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function transformCloudinaryUrl(u) {
  try {
    const parts = u.split('/upload/');
    if (parts.length !== 2) return u;
    const tail = parts[1];
    if (/^f_auto,?/.test(tail)) return u;
    return `${parts[0]}/upload/f_auto,q_auto,w_1280/${tail}`;
  } catch { return u; }
}

const markAsSoldSchema = z.object({
  itemNumber: z.number().int().positive(),
  estateSalePrice: z.number().positive(),
});

exports.markItemAsSold = async (req, res) => {
  try {
    const { id } = req.params;
    const input = markAsSoldSchema.parse(req.body);
    
    const item = await Item.findById(id).populate('job', 'client');
    if (!item) return res.status(404).json({ message: 'Item not found' });
    if (req.user.role !== 'agent') return res.status(403).json({ message: 'Agents only' });
    
    const approvedItem = item.approvedItems.find(ai => ai.itemNumber === input.itemNumber);
    if (!approvedItem) {
      return res.status(404).json({ message: 'Approved item not found' });
    }
    
    const photoIndices = approvedItem.photoIndices || [];
    
    const alreadySold = photoIndices.some(idx => item.soldPhotoIndices?.includes(idx));
    if (alreadySold) {
      return res.status(400).json({ message: 'Item is already marked as sold' });
    }
    
    approvedItem.estateSalePrice = input.estateSalePrice;
    approvedItem.estateSalePriceSetAt = new Date();
    approvedItem.estateSalePriceSetBy = req.user.sub;
    
    item.soldPhotoIndices = item.soldPhotoIndices || [];
    photoIndices.forEach(idx => {
      if (!item.soldPhotoIndices.includes(idx)) {
        item.soldPhotoIndices.push(idx);
      }
    });
    
    if (!item.soldAt) {
      item.soldAt = new Date();
    }
    
    await item.save();
    
    const jobId = item.job._id || item.job;
    const job = await ClientJob.findById(jobId);
    
    if (job) {
      job.finance = job.finance || {};
      job.finance.daily = job.finance.daily || [];
      
      job.finance.daily.push({
        label: `Estate Sale - ${approvedItem.title || `Item ${approvedItem.itemNumber}`}`,
        amount: input.estateSalePrice,
        at: new Date()
      });
      
      job.finance.gross = (job.finance.gross || 0) + input.estateSalePrice;
      
      const calculateKeptHouseCommission = (grossSales) => {
        let commission = 0;
        if (grossSales <= 7500) {
          commission = grossSales * 0.50;
        } else if (grossSales <= 20000) {
          commission = (7500 * 0.50) + ((grossSales - 7500) * 0.40);
        } else {
          commission = (7500 * 0.50) + (12500 * 0.40) + ((grossSales - 20000) * 0.30);
        }
        return Math.round(commission * 100) / 100;
      };
      
      job.finance.fees = calculateKeptHouseCommission(job.finance.gross);
      
      const serviceFee = (job.serviceFee && job.serviceFee > 0) ? job.serviceFee : 0;
      const depositPaid = (job.depositAmount && job.depositAmount > 0 && job.depositPaidAt) ? job.depositAmount : 0;
      const haulingCost = job.finance.haulingCost || 0;
      
      job.finance.net = job.finance.gross - serviceFee - job.finance.fees - haulingCost + depositPaid;
      
      await job.save();
    }
    
    res.json({
      success: true,
      message: 'Item marked as sold and added to finance',
      itemNumber: input.itemNumber,
      estateSalePrice: approvedItem.estateSalePrice,
      soldAt: item.soldAt,
      finance: job?.finance
    });
  } catch (err) {
    if (err?.issues) return res.status(400).json({ message: 'Invalid input', issues: err.issues });
    console.error('Mark as sold error:', err);
    res.status(500).json({ message: 'Failed to mark item as sold' });
  }
};

async function aiAnalyzeSinglePhoto(url, prompt, maxRetries = 4) {
  let delay = 500;
  let lastErr = null;
  let currentUrl = url;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const resp = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: currentUrl } }
            ],
          },
        ],
        temperature: 0.2,
        max_tokens: 400,
      });
      const raw = resp.choices?.[0]?.message?.content || '{}';
      let parsed;
      try { parsed = JSON.parse(raw); }
      catch {
        const m = raw.match(/```json([\s\S]*?)```/i);
        parsed = m ? JSON.parse(m[1]) : null;
      }
      if (!parsed) throw new Error('parse_error');
      return parsed;
    } catch (e) {
      lastErr = e;
      const msg = String(e?.message || e);
      if (msg.includes('Failed to download image') || msg.toLowerCase().includes('download image')) {
        currentUrl = transformCloudinaryUrl(currentUrl);
      }
      if (e.status === 429 || msg.toLowerCase().includes('rate limit') || msg.includes('TPM')) {
        await sleep(delay);
        delay = Math.min(delay * 2, 4000);
        continue;
      }
      if (msg.includes('ENOTFOUND') || msg.includes('fetch failed')) {
        await sleep(delay);
        delay = Math.min(delay * 2, 4000);
        continue;
      }
      if (attempt < maxRetries) {
        await sleep(delay);
        delay = Math.min(delay * 2, 4000);
        continue;
      }
      throw e;
    }
  }
  throw lastErr || new Error('ai_analyze_failed');
}

const createItemSchema = z.object({
  jobId: z.string(),
});

const updateEstateSalePriceSchema = z.object({
  itemNumber: z.number().int().positive(),
  estateSalePrice: z.number().positive().optional().nullable(),
});

exports.createItem = async (req, res) => {
  try {
    const input = createItemSchema.parse(req.body);
    const job = await ClientJob.findById(input.jobId).select('_id client');
    if (!job) return res.status(404).json({ message: 'Job not found' });
    if (req.user.role === 'client' && String(job.client) !== req.user.sub) return res.status(403).json({ message: 'Forbidden' });

    let item = await Item.findOne({ job: job._id });

    if (item) {
      return res.status(200).json(item);
    }

    const doc = await Item.create({
      job: job._id,
      uploader: req.user.sub,
      uploaderRole: req.user.role,
      photos: [],
      photoGroups: [],
      analyzedGroupIndices: [],
      status: 'draft',
    });
    res.status(201).json(doc);
  } catch (err) {
    if (err?.issues) return res.status(400).json({ message: 'Invalid input', issues: err.issues });
    res.status(500).json({ message: 'Server error' });
  }
};

exports.uploadPhotos = async (req, res) => {
  try {
    const { id } = req.params;
    const { itemNumber } = req.body;
    const item = await Item.findById(id).populate('job', 'client accountManager propertyAddress contractSignor');
    if (!item) return res.status(404).json({ message: 'Item not found' });
    if (req.user.role === 'client' && String(item.job.client) !== req.user.sub) return res.status(403).json({ message: 'Forbidden' });
    if (!req.files?.length) return res.status(400).json({ message: 'No files uploaded' });

    const added = [];
    const failed = [];

    for (let i = 0; i < req.files.length; i++) {
      const file = req.files[i];
      const original = file.originalname || 'unknown';

      try {
        const result = await cloudinary.uploader.upload(file.path, {
          folder: 'kept-house/items',
          resource_type: 'image',
          overwrite: false,
          timeout: 120000,
          chunk_size: 6000000,
        });

        added.push(result.secure_url);

        await fs.unlink(file.path).catch(() => { });

        if (i < req.files.length - 1) {
          await sleep(200);
        }

      } catch (error) {
        console.error(`Failed to upload ${original}:`, error);

        await fs.unlink(file.path).catch(() => { });

        let errorMsg = error?.message || 'upload failed';
        if (error?.code === 'ENOTFOUND') {
          errorMsg = 'Network error: Cannot reach Cloudinary servers. Please check your internet connection.';
        } else if (error?.code === 'ETIMEDOUT') {
          errorMsg = 'Upload timeout: Connection to Cloudinary timed out.';
        } else if (error?.code === 'ECONNREFUSED') {
          errorMsg = 'Connection refused: Cloudinary servers are not responding.';
        } else if (error?.http_code === 401) {
          errorMsg = 'Authentication error: Invalid Cloudinary credentials.';
        } else if (error?.http_code === 403) {
          errorMsg = 'Permission denied: Check your Cloudinary account settings.';
        } else if (error?.http_code === 420 || error?.http_code === 429) {
          errorMsg = 'Rate limit exceeded. Please try uploading fewer files at once.';
        }

        failed.push({
          file: original,
          reason: errorMsg,
          code: error?.code,
          httpCode: error?.http_code
        });
      }
    }

    if (added.length) {
      if (itemNumber) {
        const existingGroup = item.photoGroups.find(g => g.itemNumber === parseInt(itemNumber));

        if (existingGroup) {
          const startIndex = item.photos.length;
          item.photos.push(...added);
          existingGroup.endIndex = item.photos.length - 1;
          existingGroup.photoCount += added.length;
        } else {
          return res.status(404).json({ message: 'Item number not found' });
        }
      } else {
        const startIndex = item.photos.length;
        item.photos.push(...added);
        const endIndex = item.photos.length - 1;

        const nextItemNumber = item.photoGroups.length + 1;

        item.photoGroups.push({
          itemNumber: nextItemNumber,
          title: `Item ${nextItemNumber}`,
          startIndex: startIndex,
          endIndex: endIndex,
          photoCount: added.length
        });
      }

      if (req.user.role === 'agent' && item.status === 'approved') {
        item.status = 'needs_review';
      }

      await item.save();
    }

    const finalPhotoCount = item.photos.length;

    res.status(failed.length && !added.length ? 502 : 200).json({
      uploaded: added.length,
      failed: failed.length,
      photos: item.photos,
      photoGroups: item.photoGroups,
      status: item.status,
      photoCount: finalPhotoCount,
      errors: failed.length > 0 ? failed : undefined,
    });
  } catch (err) {
    console.error('Upload handler error:', err);
    res.status(500).json({ message: 'Upload failed', error: String(err?.message || err) });
  }
};

exports.analyzeWithAI = async (req, res) => {
  try {
    const { id } = req.params;
    const { itemNumber } = req.body;
    const item = await Item.findById(id).populate('job', 'client accountManager');
    if (!item) return res.status(404).json({ message: 'Item not found' });
    if (req.user.role === 'client' && String(item.job.client) !== req.user.sub) return res.status(403).json({ message: 'Forbidden' });

    if (!item.photoGroups || item.photoGroups.length === 0) {
      return res.status(400).json({ message: 'No photo groups to analyze' });
    }

    const catList = ['Furniture', 'Tools', 'Jewelry', 'Art', 'Electronics', 'Outdoor', 'Appliances', 'Kitchen', 'Collectibles', 'Books/Media', 'Clothing', 'Misc'];

    const analyzedGroups = new Set(item.analyzedGroupIndices || []);

    let groupsToAnalyze;

    if (itemNumber) {
      const photoGroup = item.photoGroups.find(g => g.itemNumber === parseInt(itemNumber));
      if (!photoGroup) {
        return res.status(404).json({ message: 'Item number not found' });
      }

      if (analyzedGroups.has(photoGroup.itemNumber)) {
        return res.status(400).json({ message: 'This item group has already been analyzed' });
      }

      groupsToAnalyze = [photoGroup];
    } else {
      groupsToAnalyze = item.photoGroups.filter(g => !analyzedGroups.has(g.itemNumber));
    }

    if (!groupsToAnalyze.length) {
      return res.status(400).json({ message: 'All photo groups already analyzed' });
    }

    const aiResults = [];

    for (const group of groupsToAnalyze) {
      const groupPhotos = item.photos.slice(group.startIndex, group.endIndex + 1);

      if (groupPhotos.length === 0) continue;

      const firstPhoto = groupPhotos[0];

      const prompt =
        `You are helping catalog estate-sale items.\n` +
        `This item has ${groupPhotos.length} photo(s). Analyze the first photo and return strict JSON with keys:\n` +
        `- title (string): Short product name\n` +
        `- description (string): Brief description\n` +
        `- category (string): Must be one of: ${catList.join(', ')}\n` +
        `- priceLow (number): Low price estimate in USD\n` +
        `- priceHigh (number): High price estimate in USD\n` +
        `- confidence (number): 0-1 confidence score\n` +
        `- dimensions (object): { length: number, width: number, height: number } in inches (estimate if not visible)\n` +
        `- weight (number): weight in lbs (estimate)\n` +
        `- material (string): primary material (e.g., "Wood", "Metal", "Plastic", "Fabric", "Glass")\n` +
        `- tags (array): 3-5 specific descriptive tags (e.g., ["Mid-Century Modern", "Teak", "Danish Design"] NOT ["Furniture", "Chair"])\n\n` +
        `Use specific, descriptive tags. Avoid generic categories. Be concise. No extra fields.`;

      try {
        const parsed = await aiAnalyzeSinglePhoto(firstPhoto, prompt);
        if (!catList.includes(parsed.category)) parsed.category = 'Misc';

        aiResults.push({
          itemNumber: group.itemNumber,
          photoIndices: Array.from({ length: groupPhotos.length }, (_, i) => group.startIndex + i),
          title: parsed.title || group.title || `Item ${group.itemNumber}`,
          description: parsed.description || '',
          category: parsed.category,
          priceLow: Number(parsed.priceLow) || 0,
          priceHigh: Number(parsed.priceHigh) || 0,
          confidence: Number(parsed.confidence) || 0,
          dimensions: {
            length: Number(parsed.dimensions?.length) || null,
            width: Number(parsed.dimensions?.width) || null,
            height: Number(parsed.dimensions?.height) || null,
            unit: 'inches'
          },
          weight: {
            value: Number(parsed.weight) || null,
            unit: 'lbs'
          },
          material: parsed.material || '',
          tags: Array.isArray(parsed.tags) ? parsed.tags.filter(t => t && typeof t === 'string') : []
        });

        analyzedGroups.add(group.itemNumber);
      } catch (err) {
        console.error(`Failed to analyze group ${group.itemNumber}:`, err);
      }

      await sleep(500);
    }

    if (!aiResults.length) return res.status(502).json({ message: 'Failed to analyze photo groups' });

    item.ai = [...(item.ai || []), ...aiResults];
    item.analyzedGroupIndices = Array.from(analyzedGroups);

    await item.save();

    res.json({
      ai: item.ai,
      status: item.status,
      totalAnalyzed: aiResults.length,
      newAnalysis: aiResults
    });
  } catch (err) {
    console.error('AI analysis error:', err);
    res.status(500).json({ message: 'AI analysis failed' });
  }
};

exports.approveItem = async (req, res) => {
  try {
    const { id } = req.params;
    const { items } = req.body;
    const item = await Item.findById(id).populate('job', 'client contactEmail contractSignor');
    if (!item) return res.status(404).json({ message: 'Item not found' });
    if (req.user.role !== 'agent') return res.status(403).json({ message: 'Agents only' });
    if (!items || !Array.isArray(items) || items.length === 0) return res.status(400).json({ message: 'No items to approve' });

    const newApprovedItems = items.map(itm => ({
      itemNumber: itm.itemNumber,
      photoIndices: itm.photoIndices || [],
      title: itm.title,
      description: itm.description,
      category: itm.category,
      priceLow: itm.priceLow,
      priceHigh: itm.priceHigh,
      price: itm.price,
      dimensions: itm.dimensions || { length: null, width: null, height: null, unit: 'inches' },
      weight: itm.weight || { value: null, unit: 'lbs' },
      material: itm.material || '',
      tags: itm.tags || []
    }));

    if (item.status === 'needs_review') {
      item.approvedItems = [...(item.approvedItems || []), ...newApprovedItems];
    } else {
      item.approvedItems = newApprovedItems;
    }

    item.status = 'approved';
    await item.save();

    res.json({
      status: item.status,
      approvedCount: newApprovedItems.length,
      totalApprovedItems: item.approvedItems.length,
      approvedItems: item.approvedItems
    });
  } catch (err) {
    console.error('Approve error:', err);
    res.status(500).json({ message: 'Approve failed' });
  }
};

exports.reopenItem = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const item = await Item.findById(id).populate('job', 'client');
    if (!item) return res.status(404).json({ message: 'Item not found' });
    if (req.user.role !== 'agent') return res.status(403).json({ message: 'Agents only' });
    if (!reason) return res.status(400).json({ message: 'Reason required' });

    item.status = 'needs_review';
    item.reopenHistory = item.reopenHistory || [];
    item.reopenHistory.push({
      reopenedBy: req.user.sub,
      reason,
      reopenedAt: new Date()
    });

    await item.save();
    res.json({ status: item.status, message: 'Item reopened for edits' });
  } catch (err) {
    res.status(500).json({ message: 'Reopen failed' });
  }
};

exports.updateEstateSalePrice = async (req, res) => {
  try {
    const { id } = req.params;
    const input = updateEstateSalePriceSchema.parse(req.body);

    const item = await Item.findById(id).populate('job', 'client');
    if (!item) return res.status(404).json({ message: 'Item not found' });
    if (req.user.role !== 'agent') return res.status(403).json({ message: 'Agents only' });

    const approvedItem = item.approvedItems.find(ai => ai.itemNumber === input.itemNumber);
    if (!approvedItem) {
      return res.status(404).json({ message: 'Approved item not found' });
    }

    approvedItem.estateSalePrice = input.estateSalePrice;
    approvedItem.estateSalePriceSetAt = new Date();
    approvedItem.estateSalePriceSetBy = req.user.sub;

    await item.save();

    res.json({
      success: true,
      message: 'Estate sale price updated',
      itemNumber: input.itemNumber,
      estateSalePrice: approvedItem.estateSalePrice,
      estateSalePriceSetAt: approvedItem.estateSalePriceSetAt
    });
  } catch (err) {
    if (err?.issues) return res.status(400).json({ message: 'Invalid input', issues: err.issues });
    console.error('Update estate sale price error:', err);
    res.status(500).json({ message: 'Update failed' });
  }
};

exports.listByJob = async (req, res) => {
  try {
    const { jobId } = req.params;
    const { status, uploaderRole } = req.query;
    const job = await ClientJob.findById(jobId).select('_id client');
    if (!job) return res.status(404).json({ message: 'Job not found' });
    if (req.user.role === 'client' && String(job.client) !== req.user.sub) return res.status(403).json({ message: 'Forbidden' });
    const q = { job: job._id };
    if (status) q.status = status;
    if (uploaderRole) q.uploaderRole = uploaderRole;
    const items = await Item.find(q).sort({ createdAt: -1 });
    res.json(items);
  } catch (err) {
    res.status(500).json({ message: 'Fetch failed' });
  }
};

exports.getOne = async (req, res) => {
  try {
    const item = await Item.findById(req.params.id).populate('job', 'client');
    if (!item) return res.status(404).json({ message: 'Item not found' });
    if (req.user.role === 'client' && String(item.job.client) !== req.user.sub) return res.status(403).json({ message: 'Forbidden' });
    res.json(item);
  } catch (err) {
    res.status(500).json({ message: 'Fetch failed' });
  }
};