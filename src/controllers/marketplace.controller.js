const Item = require('../models/Item');
const ClientJob = require('../models/ClientJob');
const mongoose = require('mongoose');

// Cache for active jobs - refreshes every 60 seconds
let jobCache = new Map();
let jobCacheTimestamp = 0;
const JOB_CACHE_TTL = 60000; // 60 seconds

async function getActiveJobsMap() {
  const now = Date.now();
  if (now - jobCacheTimestamp < JOB_CACHE_TTL && jobCache.size > 0) {
    return jobCache;
  }

  const jobs = await ClientJob.find({
    isOnlineSaleActive: { $ne: false }
  })
    .select('_id isOnlineSaleActive onlineSaleStartDate onlineSaleEndDate estateSaleDate')
    .lean();

  const newCache = new Map();
  for (const job of jobs) {
    newCache.set(job._id.toString(), job);
  }

  jobCache = newCache;
  jobCacheTimestamp = now;
  return jobCache;
}

function computeDisplayPrice(item, job) {
  const now = new Date();

  if (job) {
    const estateSaleDate = job.estateSaleDate ? new Date(job.estateSaleDate) : null;

    if (estateSaleDate && now >= estateSaleDate) {
      if (item.estateSalePrice && !Number.isNaN(item.estateSalePrice)) {
        return item.estateSalePrice;
      }
    }
  }

  if (typeof item.price === 'number' && !Number.isNaN(item.price)) {
    return item.price;
  }

  const low = item.priceLow ?? 0;
  const high = item.priceHigh ?? 0;
  if (low && high) return Math.round((low + high) / 2);
  if (high) return high;
  if (low) return low;
  return 0;
}

function checkSaleTimeframe(job) {
  if (!job) return { isActive: true, phase: 'online' };

  const now = new Date();

  const onlineSaleStart = job.onlineSaleStartDate ? new Date(job.onlineSaleStartDate) : null;
  const onlineSaleEnd = job.onlineSaleEndDate ? new Date(job.onlineSaleEndDate) : null;
  const estateSaleDate = job.estateSaleDate ? new Date(job.estateSaleDate) : null;

  if (estateSaleDate && now >= estateSaleDate) {
    return { isActive: true, phase: 'estate' };
  }

  if (onlineSaleStart && now < onlineSaleStart) {
    return { isActive: false, phase: 'before_online', message: 'Sale has not started yet' };
  }

  if (onlineSaleEnd && now > onlineSaleEnd) {
    if (!estateSaleDate || now < estateSaleDate) {
      return { isActive: false, phase: 'between', message: 'Online sale has ended' };
    }
  }

  return { isActive: true, phase: 'online' };
}

async function getJobWithSaleInfo(jobId) {
  if (!jobId) return null;

  try {
    const jobsMap = await getActiveJobsMap();
    return jobsMap.get(jobId.toString()) || null;
  } catch (err) {
    console.error('Error fetching job sale info:', err);
    return null;
  }
}

exports.listItems = async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page || '1', 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || '24', 10), 1), 48);
    const skip = (page - 1) * limit;

    const q = req.query.q?.trim();
    const category = req.query.category?.trim();
    const jobId = req.query.jobId?.trim();
    const sortKey = (req.query.sort || 'new').toLowerCase();
    const min = req.query.min ? Number(req.query.min) : null;
    const max = req.query.max ? Number(req.query.max) : null;

    // Pre-load all active jobs in one query (cached)
    const jobsMap = await getActiveJobsMap();
    const activeJobIds = Array.from(jobsMap.keys());

    // Build aggregation pipeline for server-side filtering
    const matchStage = {
      status: 'approved',
      approvedItems: { $exists: true, $ne: [] }
    };

    // Only include items from active jobs
    if (jobId) {
      matchStage.job = new mongoose.Types.ObjectId(jobId);
    } else if (activeJobIds.length > 0) {
      matchStage.job = { $in: activeJobIds.map(id => new mongoose.Types.ObjectId(id)) };
    }

    // Use aggregation for better performance
    const docs = await Item.find(matchStage)
      .select('_id job photos approvedItems soldPhotoIndices createdAt')
      .sort({ createdAt: -1 })
      .lean();

    let allListings = [];

    for (const doc of docs) {
      if (!doc.approvedItems || !doc.approvedItems.length) continue;

      const job = doc.job ? jobsMap.get(doc.job.toString()) : null;

      const isOnlineSaleActive = job?.isOnlineSaleActive ?? true;
      if (!isOnlineSaleActive) continue;

      const timeframeCheck = checkSaleTimeframe(job);
      if (!timeframeCheck.isActive) continue;

      const soldIndices = new Set(doc.soldPhotoIndices || []);

      for (const approvedItem of doc.approvedItems) {
        const photoIndices = approvedItem.photoIndices || [approvedItem.photoIndex];

        const isSold = photoIndices.some(idx => soldIndices.has(idx));
        if (isSold) continue;

        const photos = photoIndices.map(idx => doc.photos[idx]).filter(Boolean);
        if (photos.length === 0) continue;

        // Apply filters early to reduce memory
        const itemCategory = approvedItem.category || 'Misc';
        if (category && itemCategory.toLowerCase() !== category.toLowerCase()) continue;

        if (q) {
          const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
          if (!rx.test(approvedItem.title || '') && !rx.test(approvedItem.description || '')) continue;
        }

        const price = computeDisplayPrice(approvedItem, job);
        if (min !== null && price < min) continue;
        if (max !== null && price > max) continue;

        allListings.push({
          _id: `${doc._id}_${approvedItem.itemNumber}`,
          itemId: doc._id,
          itemNumber: approvedItem.itemNumber,
          photoIndices: photoIndices,
          title: approvedItem.title || '',
          description: approvedItem.description || '',
          category: itemCategory,
          price,
          priceLow: approvedItem.priceLow ?? null,
          priceHigh: approvedItem.priceHigh ?? null,
          photo: photos[0],
          photos: photos,
          allPhotos: doc.photos,
          job: doc.job,
          createdAt: doc.createdAt,
          salePhase: timeframeCheck.phase
        });
      }
    }

    const total = allListings.length;

    // Sort
    if (sortKey === 'price_asc') {
      allListings.sort((a, b) => a.price - b.price);
    } else if (sortKey === 'price_desc') {
      allListings.sort((a, b) => b.price - a.price);
    } else {
      allListings.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    }

    // Paginate
    const paginated = allListings.slice(skip, skip + limit);

    res.json({
      page,
      limit,
      total,
      count: paginated.length,
      items: paginated
    });
  } catch (err) {
    console.error('Marketplace list error:', err);
    res.status(500).json({ message: 'Marketplace list failed' });
  }
};

exports.getItem = async (req, res) => {
  try {
    const parts = req.params.id.split('_');
    const itemId = parts[0];
    const itemNumber = parts.length > 1 ? parseInt(parts[1], 10) : null;

    const doc = await Item.findOne({ _id: itemId, status: 'approved' }).lean();
    if (!doc) return res.status(404).json({ message: 'Item not found' });

    const job = await getJobWithSaleInfo(doc.job);
    
    const isOnlineSaleActive = job?.isOnlineSaleActive ?? true;
    if (!isOnlineSaleActive) {
      return res.status(404).json({ message: 'Item is not available at this time' });
    }
    
    const timeframeCheck = await checkSaleTimeframe(job);
    if (!timeframeCheck.isActive) {
      return res.status(404).json({ message: timeframeCheck.message || 'Item is not available at this time' });
    }

    const soldIndices = new Set(doc.soldPhotoIndices || []);

    if (itemNumber !== null) {
      const approvedItem = doc.approvedItems?.find(
        item => item.itemNumber === itemNumber
      );

      if (!approvedItem) {
        return res.status(404).json({ message: 'Approved item not found' });
      }

      const photoIndices = approvedItem.photoIndices || [approvedItem.photoIndex];
      const isSold = photoIndices.some(idx => soldIndices.has(idx));

      if (isSold) {
        return res.status(404).json({ message: 'Item is no longer available' });
      }

      const photos = photoIndices.map(idx => doc.photos[idx]).filter(Boolean);

      return res.json({
        _id: `${doc._id}_${itemNumber}`,
        itemId: doc._id,
        itemNumber: approvedItem.itemNumber,
        photoIndices: photoIndices,
        title: approvedItem.title || '',
        description: approvedItem.description || '',
        category: approvedItem.category || 'Misc',
        price: computeDisplayPrice(approvedItem, job),
        priceLow: approvedItem.priceLow ?? null,
        priceHigh: approvedItem.priceHigh ?? null,
        photo: photos[0],
        photos: photos,
        allPhotos: doc.photos,
        job: doc.job,
        createdAt: doc.createdAt,
        salePhase: timeframeCheck.phase
      });
    }

    if (doc.approvedItems && doc.approvedItems.length > 0) {
      const firstAvailable = doc.approvedItems.find(item => {
        const photoIndices = item.photoIndices || [item.photoIndex];
        return !photoIndices.some(idx => soldIndices.has(idx));
      });

      if (!firstAvailable) {
        return res.status(404).json({ message: 'No items available' });
      }

      const photoIndices = firstAvailable.photoIndices || [firstAvailable.photoIndex];
      const photos = photoIndices.map(idx => doc.photos[idx]).filter(Boolean);

      return res.json({
        _id: `${doc._id}_${firstAvailable.itemNumber}`,
        itemId: doc._id,
        itemNumber: firstAvailable.itemNumber,
        photoIndices: photoIndices,
        title: firstAvailable.title || '',
        description: firstAvailable.description || '',
        category: firstAvailable.category || 'Misc',
        price: computeDisplayPrice(firstAvailable, job),
        priceLow: firstAvailable.priceLow ?? null,
        priceHigh: firstAvailable.priceHigh ?? null,
        photo: photos[0],
        photos: photos,
        allPhotos: doc.photos,
        job: doc.job,
        createdAt: doc.createdAt,
        salePhase: timeframeCheck.phase
      });
    }

    res.status(404).json({ message: 'No approved items found' });
  } catch (err) {
    console.error('Get item error:', err);
    res.status(500).json({ message: 'Fetch failed' });
  }
};

exports.getRelated = async (req, res) => {
  try {
    const parts = req.params.id.split('_');
    const itemId = parts[0];
    const itemNumber = parts.length > 1 ? parseInt(parts[1], 10) : null;

    const current = await Item.findOne({ _id: itemId, status: 'approved' })
      .select('approvedItems')
      .lean();
    if (!current) return res.status(404).json({ message: 'Item not found' });

    let targetCategory = null;
    if (itemNumber !== null && current.approvedItems) {
      const approvedItem = current.approvedItems.find(
        item => item.itemNumber === itemNumber
      );
      targetCategory = approvedItem?.category;
    }

    // Pre-load jobs (cached)
    const jobsMap = await getActiveJobsMap();
    const activeJobIds = Array.from(jobsMap.keys());

    const base = {
      status: 'approved',
      approvedItems: { $exists: true, $ne: [] },
      _id: { $ne: current._id }
    };

    if (activeJobIds.length > 0) {
      base.job = { $in: activeJobIds.map(id => new mongoose.Types.ObjectId(id)) };
    }

    const docs = await Item.find(base)
      .select('_id job photos approvedItems soldPhotoIndices')
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    let categoryMatches = [];
    let otherItems = [];

    for (const doc of docs) {
      if (!doc.approvedItems) continue;

      const job = doc.job ? jobsMap.get(doc.job.toString()) : null;

      const isOnlineSaleActive = job?.isOnlineSaleActive ?? true;
      if (!isOnlineSaleActive) continue;

      const timeframeCheck = checkSaleTimeframe(job);
      if (!timeframeCheck.isActive) continue;

      const soldIndices = new Set(doc.soldPhotoIndices || []);

      for (const approvedItem of doc.approvedItems) {
        const photoIndices = approvedItem.photoIndices || [approvedItem.photoIndex];
        const isSold = photoIndices.some(idx => soldIndices.has(idx));

        if (isSold) continue;

        const photos = photoIndices.map(idx => doc.photos[idx]).filter(Boolean);
        if (photos.length === 0) continue;

        const listing = {
          _id: `${doc._id}_${approvedItem.itemNumber}`,
          itemId: doc._id,
          itemNumber: approvedItem.itemNumber,
          photoIndices: photoIndices,
          title: approvedItem.title || '',
          category: approvedItem.category || 'Misc',
          description: approvedItem.description || '',
          price: computeDisplayPrice(approvedItem, job),
          photo: photos[0],
          photos: photos,
          allPhotos: doc.photos
        };

        if (targetCategory && approvedItem.category === targetCategory) {
          categoryMatches.push(listing);
        } else {
          otherItems.push(listing);
        }
      }
    }

    let relatedListings = [];

    if (targetCategory && categoryMatches.length > 0) {
      relatedListings = categoryMatches.slice(0, 12);

      if (relatedListings.length < 12) {
        const needed = 12 - relatedListings.length;
        relatedListings = [...relatedListings, ...otherItems.slice(0, needed)];
      }
    } else {
      relatedListings = otherItems.slice(0, 12);
    }

    res.json({ items: relatedListings });
  } catch (err) {
    console.error('Get related error:', err);
    res.status(500).json({ message: 'Fetch related failed' });
  }
};

exports.searchItems = async (req, res) => {
  try {
    const q = req.query.q?.trim();

    if (!q) {
      return res.status(400).json({ message: 'Search query required' });
    }

    const page = Math.max(parseInt(req.query.page || '1', 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || '24', 10), 1), 48);
    const skip = (page - 1) * limit;

    const category = req.query.category?.trim();
    const sortKey = (req.query.sort || 'relevance').toLowerCase();
    const min = req.query.min ? Number(req.query.min) : null;
    const max = req.query.max ? Number(req.query.max) : null;

    // Pre-load jobs (cached)
    const jobsMap = await getActiveJobsMap();
    const activeJobIds = Array.from(jobsMap.keys());

    const base = {
      status: 'approved',
      approvedItems: { $exists: true, $ne: [] }
    };

    if (activeJobIds.length > 0) {
      base.job = { $in: activeJobIds.map(id => new mongoose.Types.ObjectId(id)) };
    }

    const docs = await Item.find(base)
      .select('_id job photos approvedItems soldPhotoIndices createdAt')
      .lean();

    const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const queryLower = q.toLowerCase();

    let searchResults = [];

    for (const doc of docs) {
      if (!doc.approvedItems || !doc.approvedItems.length) continue;

      const job = doc.job ? jobsMap.get(doc.job.toString()) : null;

      const isOnlineSaleActive = job?.isOnlineSaleActive ?? true;
      if (!isOnlineSaleActive) continue;

      const timeframeCheck = checkSaleTimeframe(job);
      if (!timeframeCheck.isActive) continue;

      const soldIndices = new Set(doc.soldPhotoIndices || []);

      for (const approvedItem of doc.approvedItems) {
        const photoIndices = approvedItem.photoIndices || [approvedItem.photoIndex];
        const isSold = photoIndices.some(idx => soldIndices.has(idx));

        if (isSold) continue;

        const titleMatch = rx.test(approvedItem.title || '');
        const descMatch = rx.test(approvedItem.description || '');

        if (!titleMatch && !descMatch) continue;

        const photos = photoIndices.map(idx => doc.photos[idx]).filter(Boolean);
        if (photos.length === 0) continue;

        // Apply category filter early
        const itemCategory = approvedItem.category || 'Misc';
        if (category && itemCategory.toLowerCase() !== category.toLowerCase()) continue;

        const price = computeDisplayPrice(approvedItem, job);
        if (min !== null && price < min) continue;
        if (max !== null && price > max) continue;

        let relevanceScore = 0;
        const titleLower = (approvedItem.title || '').toLowerCase();

        if (titleLower === queryLower) relevanceScore += 100;
        else if (titleLower.startsWith(queryLower)) relevanceScore += 50;
        else if (titleMatch) relevanceScore += 25;

        if (descMatch) relevanceScore += 10;

        searchResults.push({
          _id: `${doc._id}_${approvedItem.itemNumber}`,
          itemId: doc._id,
          itemNumber: approvedItem.itemNumber,
          photoIndices: photoIndices,
          title: approvedItem.title || '',
          description: approvedItem.description || '',
          category: itemCategory,
          price,
          priceLow: approvedItem.priceLow ?? null,
          priceHigh: approvedItem.priceHigh ?? null,
          photo: photos[0],
          photos: photos,
          allPhotos: doc.photos,
          job: doc.job,
          createdAt: doc.createdAt,
          relevanceScore
        });
      }
    }

    const total = searchResults.length;

    // Sort
    if (sortKey === 'relevance') {
      searchResults.sort((a, b) => b.relevanceScore - a.relevanceScore);
    } else if (sortKey === 'price_asc') {
      searchResults.sort((a, b) => a.price - b.price);
    } else if (sortKey === 'price_desc') {
      searchResults.sort((a, b) => b.price - a.price);
    } else if (sortKey === 'new') {
      searchResults.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    }

    // Remove relevanceScore before returning
    const paginated = searchResults.slice(skip, skip + limit).map(({ relevanceScore, ...rest }) => rest);

    res.json({
      query: q,
      page,
      limit,
      total,
      count: paginated.length,
      items: paginated
    });
  } catch (err) {
    console.error('Search error:', err);
    res.status(500).json({ message: 'Search failed' });
  }
};