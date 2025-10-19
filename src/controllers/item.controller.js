const fs = require('fs/promises');
const { z } = require('zod');
const Item = require('../models/Item');
const ClientJob = require('../models/ClientJob');
const cloudinary = require('../config/cloudinary');
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
        max_tokens: 250,
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
  title: z.string().optional(),
  description: z.string().optional(),
});

exports.createItem = async (req, res) => {
  try {
    const input = createItemSchema.parse(req.body);
    const job = await ClientJob.findById(input.jobId).select('_id client');
    if (!job) return res.status(404).json({ message: 'Job not found' });
    if (req.user.role === 'client' && String(job.client) !== req.user.sub) return res.status(403).json({ message: 'Forbidden' });
    const doc = await Item.create({
      job: job._id,
      uploader: req.user.sub,
      uploaderRole: req.user.role,
      title: input.title || '',
      description: input.description || '',
      photos: [],
      analyzedPhotoIndices: [],
      status: req.user.role === 'agent' ? 'approved' : 'draft',
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
    const item = await Item.findById(id).populate('job', 'client');
    if (!item) return res.status(404).json({ message: 'Item not found' });
    if (req.user.role === 'client' && String(item.job.client) !== req.user.sub) return res.status(403).json({ message: 'Forbidden' });
    if (!req.files?.length) return res.status(400).json({ message: 'No files uploaded' });

    const added = [];
    const failed = [];
    const BATCH = 4;

    for (let i = 0; i < req.files.length; i += BATCH) {
      const slice = req.files.slice(i, i + BATCH);
      const results = await Promise.allSettled(
        slice.map(f =>
          cloudinary.uploader.upload(f.path, {
            folder: 'kept-house/items',
            resource_type: 'image',
            overwrite: false,
          })
        )
      );
      await Promise.allSettled(slice.map(f => fs.unlink(f.path).catch(() => {})));
      results.forEach((r, idx) => {
        const original = slice[idx]?.originalname || 'unknown';
        if (r.status === 'fulfilled') added.push(r.value.secure_url);
        else failed.push({ file: original, reason: r.reason?.message || 'upload failed' });
      });
    }

    if (added.length) {
      item.photos.push(...added);
      
      if (req.user.role === 'agent' && item.status === 'approved') {
        item.status = 'needs_review';
      }
      
      await item.save();
    }

    res.status(failed.length && !added.length ? 502 : 200).json({
      uploaded: added.length,
      failed: failed.length,
      photos: item.photos,
      status: item.status,
      errors: failed,
    });
  } catch (err) {
    res.status(500).json({ message: 'Upload failed', error: String(err?.message || err) });
  }
};

exports.analyzeWithAI = async (req, res) => {
  try {
    const { id } = req.params;
    const item = await Item.findById(id).populate('job', 'client');
    if (!item) return res.status(404).json({ message: 'Item not found' });
    if (req.user.role === 'client' && String(item.job.client) !== req.user.sub) return res.status(403).json({ message: 'Forbidden' });
    if (!item.photos.length) return res.status(400).json({ message: 'No photos to analyze' });

    const catList = ['Furniture','Tools','Jewelry','Art','Electronics','Outdoor','Appliances','Kitchen','Collectibles','Books/Media','Clothing','Misc'];
    const prompt =
      `You are helping catalog estate-sale items.\n` +
      `Analyze this single image and return strict JSON with keys: title, description, category, priceLow, priceHigh, confidence (0-1).\n` +
      `Category must be one of: ${catList.join(', ')}.\n` +
      `Be concise. No extra fields. If uncertain, category "Misc" with lower confidence.`;

    const analyzedIndices = new Set(item.analyzedPhotoIndices || []);
    
    const photosToAnalyze = item.photos
      .map((photo, index) => ({ photo, index }))
      .filter(({ index }) => !analyzedIndices.has(index));

    if (!photosToAnalyze.length) {
      return res.status(400).json({ message: 'All photos already analyzed' });
    }

    const aiResults = [];
    for (const { photo, index } of photosToAnalyze) {
      try {
        const parsed = await aiAnalyzeSinglePhoto(photo, prompt);
        if (!catList.includes(parsed.category)) parsed.category = 'Misc';
        aiResults.push({
          photoIndex: index,
          photoUrl: photo,
          title: parsed.title || '',
          description: parsed.description || '',
          category: parsed.category,
          priceLow: Number(parsed.priceLow) || 0,
          priceHigh: Number(parsed.priceHigh) || 0,
          confidence: Number(parsed.confidence) || 0,
        });
        analyzedIndices.add(index);
      } catch {}
      await sleep(500);
    }

    if (!aiResults.length) return res.status(502).json({ message: 'Failed to analyze new photos' });

    item.ai = [...(item.ai || []), ...aiResults];
    item.analyzedPhotoIndices = Array.from(analyzedIndices);
    
    await item.save();
    res.json({ 
      ai: item.ai, 
      status: item.status, 
      totalAnalyzed: aiResults.length,
      newAnalysis: aiResults 
    });
  } catch (err) {
    res.status(500).json({ message: 'AI analysis failed' });
  }
};

exports.approveItem = async (req, res) => {
  try {
    const { id } = req.params;
    const { items } = req.body;
    const item = await Item.findById(id).populate('job', 'client');
    if (!item) return res.status(404).json({ message: 'Item not found' });
    if (req.user.role !== 'agent') return res.status(403).json({ message: 'Agents only' });
    if (!items || !Array.isArray(items) || items.length === 0) return res.status(400).json({ message: 'No items to approve' });

    const newApprovedItems = items.map(itm => ({
      photoIndex: itm.photoIndex,
      title: itm.title,
      description: itm.description,
      category: itm.category,
      priceLow: itm.priceLow,
      priceHigh: itm.priceHigh,
      price: itm.price
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