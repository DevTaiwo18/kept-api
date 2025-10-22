const fs = require('fs/promises');
const { z } = require('zod');
const Item = require('../models/Item');
const ClientJob = require('../models/ClientJob');
const { User } = require('../models/User');
const { sendEmail } = require('../utils/sendEmail');
const cloudinary = require('../config/cloudinary');
const openai = require('../config/openai');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
                    <p style="font-size: 12px; line-height: 1.5; color: #999; margin: 15px 0 0 0; font-family: Arial, sans-serif;">
                      If you have any questions, feel free to contact us at support@kepthouse.com
                    </p>
                  </td>
                </tr>
              </table>
              <table width="600" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding: 20px; text-align: center;">
                    <p style="font-size: 12px; color: #999; margin: 0; font-family: Arial, sans-serif;">
                      © ${new Date().getFullYear()} Kept House. All rights reserved.
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

const lastPhotoEmailSent = new Map();

function shouldSendPhotoEmail(itemId, totalPhotos) {
  const key = String(itemId);
  const now = Date.now();
  const lastSent = lastPhotoEmailSent.get(key);
  
  if (lastSent && (now - lastSent) < 3600000) {
    return false;
  }
  
  const milestones = [10, 20, 50];
  if (milestones.includes(totalPhotos)) {
    lastPhotoEmailSent.set(key, now);
    return true;
  }
  
  return false;
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
    const item = await Item.findById(id).populate('job', 'client accountManager propertyAddress contractSignor');
    if (!item) return res.status(404).json({ message: 'Item not found' });
    if (req.user.role === 'client' && String(item.job.client) !== req.user.sub) return res.status(403).json({ message: 'Forbidden' });
    if (!req.files?.length) return res.status(400).json({ message: 'No files uploaded' });

    const added = [];
    const failed = [];
    const BATCH = 3;

    for (let i = 0; i < req.files.length; i += BATCH) {
      const slice = req.files.slice(i, i + BATCH);
      const results = await Promise.allSettled(
        slice.map(f =>
          cloudinary.uploader.upload(f.path, {
            folder: 'kept-house/items',
            resource_type: 'image',
            overwrite: false,
            timeout: 120000,
            chunk_size: 6000000,
          })
        )
      );
      
      await Promise.allSettled(slice.map(f => fs.unlink(f.path).catch(() => {})));
      
      results.forEach((r, idx) => {
        const original = slice[idx]?.originalname || 'unknown';
        if (r.status === 'fulfilled') {
          added.push(r.value.secure_url);
        } else {
          const error = r.reason;
          console.error(`Failed to upload ${original}:`, error);
          
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
          }
          
          failed.push({ 
            file: original, 
            reason: errorMsg,
            code: error?.code,
            httpCode: error?.http_code
          });
        }
      });
    }

    if (added.length) {
      item.photos.push(...added);
      
      if (req.user.role === 'agent' && item.status === 'approved') {
        item.status = 'needs_review';
      }
      
      await item.save();

      setImmediate(async () => {
        try {
          const totalPhotos = item.photos.length;
          
          if (shouldSendPhotoEmail(item._id, totalPhotos)) {
            const itemTitle = item.title || `Item at ${item.job?.propertyAddress || 'property'}`;
            
            const content = `
              <div style="text-align: center; padding: 20px 0;">
                <div style="display: inline-block; background: linear-gradient(135deg, #e6c35a 0%, #d4af37 100%); border-radius: 50%; width: 80px; height: 80px; line-height: 80px; margin-bottom: 20px;">
                  <span style="font-size: 40px;">📸</span>
                </div>
              </div>
              <p style="font-size: 16px; line-height: 1.6; color: #333; margin: 0 0 15px 0; font-family: Arial, sans-serif;">
                New photos have been uploaded and are ready for your review.
              </p>
              <div style="background-color: #f9f9f9; border-left: 4px solid #e6c35a; padding: 15px 20px; margin: 20px 0; border-radius: 4px;">
                <p style="font-size: 14px; line-height: 1.6; color: #555; margin: 0; font-family: Arial, sans-serif;">
                  <strong>Item:</strong> ${itemTitle}<br/>
                  <strong>New Photos:</strong> ${added.length}<br/>
                  <strong>Total Photos:</strong> ${totalPhotos}
                </p>
              </div>
              <p style="font-size: 16px; line-height: 1.6; color: #333; margin: 20px 0 0 0; font-family: Arial, sans-serif;">
                Please review these photos when you get a chance and approve or request changes as needed.
              </p>
            `;

            await sendEmail({
              to: 'Admin@keptestate.com',
              subject: 'New item photos ready for review',
              html: getEmailTemplate('Admin', content),
              text: `Hi Admin, New photos (${added.length}) have been uploaded to item ${itemTitle}. Total photos: ${totalPhotos}. Please review when ready. Best regards, The Kept House Team`,
            });
          }
        } catch (emailErr) {
          console.error('Failed to send photo upload email:', emailErr);
        }
      });
    }

    res.status(failed.length && !added.length ? 502 : 200).json({
      uploaded: added.length,
      failed: failed.length,
      photos: item.photos,
      status: item.status,
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
    const item = await Item.findById(id).populate('job', 'client accountManager');
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
    const item = await Item.findById(id).populate('job', 'client contactEmail contractSignor');
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

    try {
      const clientEmail = item.job.contactEmail;
      const clientName = item.job.contractSignor;
      
      if (clientEmail) {
        const content = `
          <div style="text-align: center; padding: 20px 0;">
            <div style="display: inline-block; background-color: #e8f5e9; border-radius: 50%; width: 80px; height: 80px; line-height: 80px; margin-bottom: 20px;">
              <span style="font-size: 40px;">✅</span>
            </div>
          </div>
          <p style="font-size: 16px; line-height: 1.6; color: #333; margin: 0 0 15px 0; font-family: Arial, sans-serif;">
            Great news! <strong style="color: #e6c35a;">${item.title || 'An item'}</strong> in your project has been approved and is moving forward.
          </p>
          <div style="background-color: #e8f5e9; border-left: 4px solid #4caf50; padding: 15px 20px; margin: 20px 0; border-radius: 4px;">
            <p style="font-size: 14px; line-height: 1.6; color: #2e7d32; margin: 0; font-family: Arial, sans-serif;">
              ✓ <strong>Status:</strong> Approved<br/>
              ✓ <strong>Items Approved:</strong> ${newApprovedItems.length}
            </p>
          </div>
          <p style="font-size: 16px; line-height: 1.6; color: #333; margin: 20px 0 0 0; font-family: Arial, sans-serif;">
            Your project is progressing smoothly. We'll keep you updated with any further developments.
          </p>
        `;

        await sendEmail({
          to: clientEmail,
          subject: 'An item in your project was approved',
          html: getEmailTemplate(clientName, content),
          text: `Hi ${clientName}, Good news! ${item.title || 'An item'} in your project has been approved and is moving forward. Best regards, The Kept House Team`,
        });
      }
    } catch (emailErr) {
      console.error('Failed to send item approval email:', emailErr);
    }
    
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