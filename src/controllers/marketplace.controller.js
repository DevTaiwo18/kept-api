const Item = require('../models/Item');

function computeDisplayPrice(item) {
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

    const base = { 
      status: 'approved', 
      approvedItems: { $exists: true, $ne: [] } 
    };
    
    if (jobId) base.job = jobId;

    const docs = await Item.find(base).sort({ createdAt: -1 }).lean();

    let allListings = [];
    
    docs.forEach(doc => {
      if (!doc.approvedItems || !doc.approvedItems.length) return;
      
      const soldIndices = doc.soldPhotoIndices || [];
      
      doc.approvedItems.forEach(approvedItem => {
        if (soldIndices.includes(approvedItem.photoIndex)) return;
        
        const photoUrl = doc.photos[approvedItem.photoIndex];
        if (!photoUrl) return;
        
        const listing = {
          _id: `${doc._id}_${approvedItem.photoIndex}`,
          itemId: doc._id,
          photoIndex: approvedItem.photoIndex,
          title: approvedItem.title || '',
          description: approvedItem.description || '',
          category: approvedItem.category || 'Misc',
          price: computeDisplayPrice(approvedItem),
          priceLow: approvedItem.priceLow ?? null,
          priceHigh: approvedItem.priceHigh ?? null,
          photo: photoUrl,
          job: doc.job,
          createdAt: doc.createdAt
        };
        
        allListings.push(listing);
      });
    });

    let filtered = allListings;

    if (category) {
      filtered = filtered.filter(item => 
        item.category.toLowerCase() === category.toLowerCase()
      );
    }

    if (q) {
      const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filtered = filtered.filter(item => 
        rx.test(item.title) || rx.test(item.description)
      );
    }

    if (min !== null || max !== null) {
      filtered = filtered.filter(item => {
        if (min !== null && item.price < min) return false;
        if (max !== null && item.price > max) return false;
        return true;
      });
    }

    const total = filtered.length;

    if (sortKey === 'price_asc') {
      filtered.sort((a, b) => a.price - b.price);
    } else if (sortKey === 'price_desc') {
      filtered.sort((a, b) => b.price - a.price);
    } else if (sortKey === 'new') {
      filtered.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    }

    const paginated = filtered.slice(skip, skip + limit);

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
    const photoIndex = parts.length > 1 ? parseInt(parts[1], 10) : null;

    const doc = await Item.findOne({ _id: itemId, status: 'approved' }).lean();
    if (!doc) return res.status(404).json({ message: 'Item not found' });

    const soldIndices = doc.soldPhotoIndices || [];

    if (photoIndex !== null) {
      if (soldIndices.includes(photoIndex)) {
        return res.status(404).json({ message: 'Item is no longer available' });
      }

      const approvedItem = doc.approvedItems?.find(
        item => item.photoIndex === photoIndex
      );
      
      if (!approvedItem) {
        return res.status(404).json({ message: 'Approved item not found' });
      }

      const photoUrl = doc.photos[approvedItem.photoIndex];
      
      return res.json({
        _id: `${doc._id}_${photoIndex}`,
        itemId: doc._id,
        photoIndex: approvedItem.photoIndex,
        title: approvedItem.title || '',
        description: approvedItem.description || '',
        category: approvedItem.category || 'Misc',
        price: computeDisplayPrice(approvedItem),
        priceLow: approvedItem.priceLow ?? null,
        priceHigh: approvedItem.priceHigh ?? null,
        photo: photoUrl,
        photos: [photoUrl],
        job: doc.job,
        createdAt: doc.createdAt
      });
    }

    if (doc.approvedItems && doc.approvedItems.length > 0) {
      const firstAvailable = doc.approvedItems.find(
        item => !soldIndices.includes(item.photoIndex)
      );

      if (!firstAvailable) {
        return res.status(404).json({ message: 'No items available' });
      }

      const photoUrl = doc.photos[firstAvailable.photoIndex];
      
      return res.json({
        _id: `${doc._id}_${firstAvailable.photoIndex}`,
        itemId: doc._id,
        photoIndex: firstAvailable.photoIndex,
        title: firstAvailable.title || '',
        description: firstAvailable.description || '',
        category: firstAvailable.category || 'Misc',
        price: computeDisplayPrice(firstAvailable),
        priceLow: firstAvailable.priceLow ?? null,
        priceHigh: firstAvailable.priceHigh ?? null,
        photo: photoUrl,
        photos: [photoUrl],
        job: doc.job,
        createdAt: doc.createdAt
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
    const photoIndex = parts.length > 1 ? parseInt(parts[1], 10) : null;

    const current = await Item.findOne({ _id: itemId, status: 'approved' }).lean();
    if (!current) return res.status(404).json({ message: 'Item not found' });

    let targetCategory = null;
    if (photoIndex !== null && current.approvedItems) {
      const approvedItem = current.approvedItems.find(
        item => item.photoIndex === photoIndex
      );
      targetCategory = approvedItem?.category;
    }

    const base = { 
      status: 'approved', 
      approvedItems: { $exists: true, $ne: [] },
      _id: { $ne: current._id }
    };

    const docs = await Item.find(base).sort({ createdAt: -1 }).limit(20).lean();

    let relatedListings = [];
    
    docs.forEach(doc => {
      if (!doc.approvedItems) return;
      
      const soldIndices = doc.soldPhotoIndices || [];
      
      doc.approvedItems.forEach(approvedItem => {
        if (soldIndices.includes(approvedItem.photoIndex)) return;
        
        if (targetCategory && approvedItem.category !== targetCategory) return;
        
        const photoUrl = doc.photos[approvedItem.photoIndex];
        if (!photoUrl) return;
        
        relatedListings.push({
          _id: `${doc._id}_${approvedItem.photoIndex}`,
          title: approvedItem.title || '',
          category: approvedItem.category || 'Misc',
          price: computeDisplayPrice(approvedItem),
          photo: photoUrl
        });
      });
    });

    relatedListings = relatedListings.slice(0, 12);

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

    const base = { 
      status: 'approved', 
      approvedItems: { $exists: true, $ne: [] } 
    };

    const docs = await Item.find(base).lean();

    const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

    let searchResults = [];
    
    docs.forEach(doc => {
      if (!doc.approvedItems || !doc.approvedItems.length) return;
      
      const soldIndices = doc.soldPhotoIndices || [];
      
      doc.approvedItems.forEach(approvedItem => {
        if (soldIndices.includes(approvedItem.photoIndex)) return;
        
        const titleMatch = rx.test(approvedItem.title || '');
        const descMatch = rx.test(approvedItem.description || '');
        
        if (!titleMatch && !descMatch) return;
        
        const photoUrl = doc.photos[approvedItem.photoIndex];
        if (!photoUrl) return;
        
        let relevanceScore = 0;
        const titleLower = (approvedItem.title || '').toLowerCase();
        const descLower = (approvedItem.description || '').toLowerCase();
        const queryLower = q.toLowerCase();
        
        if (titleLower === queryLower) relevanceScore += 100;
        else if (titleLower.startsWith(queryLower)) relevanceScore += 50;
        else if (titleMatch) relevanceScore += 25;
        
        if (descMatch) relevanceScore += 10;
        
        const listing = {
          _id: `${doc._id}_${approvedItem.photoIndex}`,
          itemId: doc._id,
          photoIndex: approvedItem.photoIndex,
          title: approvedItem.title || '',
          description: approvedItem.description || '',
          category: approvedItem.category || 'Misc',
          price: computeDisplayPrice(approvedItem),
          priceLow: approvedItem.priceLow ?? null,
          priceHigh: approvedItem.priceHigh ?? null,
          photo: photoUrl,
          job: doc.job,
          createdAt: doc.createdAt,
          relevanceScore
        };
        
        searchResults.push(listing);
      });
    });

    let filtered = searchResults;

    if (category) {
      filtered = filtered.filter(item => 
        item.category.toLowerCase() === category.toLowerCase()
      );
    }

    if (min !== null || max !== null) {
      filtered = filtered.filter(item => {
        if (min !== null && item.price < min) return false;
        if (max !== null && item.price > max) return false;
        return true;
      });
    }

    const total = filtered.length;

    if (sortKey === 'relevance') {
      filtered.sort((a, b) => b.relevanceScore - a.relevanceScore);
    } else if (sortKey === 'price_asc') {
      filtered.sort((a, b) => a.price - b.price);
    } else if (sortKey === 'price_desc') {
      filtered.sort((a, b) => b.price - a.price);
    } else if (sortKey === 'new') {
      filtered.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    }

    filtered = filtered.map(item => {
      const { relevanceScore, ...rest } = item;
      return rest;
    });

    const paginated = filtered.slice(skip, skip + limit);

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