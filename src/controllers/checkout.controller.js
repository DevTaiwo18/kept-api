const Cart = require('../models/Cart');
const Item = require('../models/Item');
const Order = require('../models/Order');
const ClientJob = require('../models/ClientJob');
const { stripe } = require('../services/stripe');
const { calculateShipping } = require('../services/fedex');

const TAX_RATE = 0.078;

function computePrice(a) {
    if (typeof a.price === 'number') return a.price;
    const low = a.priceLow ?? 0;
    const high = a.priceHigh ?? 0;
    if (low && high) return Math.round((low + high) / 2);
    return high || low || 0;
}

async function expandComposite(id) {
    const [docId, indexStr] = String(id).split('_');
    const itemNumber = Number(indexStr);
    if (!docId || Number.isNaN(itemNumber)) return null;
    
    const doc = await Item.findOne({ _id: docId, status: 'approved' }).lean();
    if (!doc || !Array.isArray(doc.approvedItems)) return null;
    
    const approved = doc.approvedItems.find(x => x.itemNumber === itemNumber);
    if (!approved) return null;
    
    const photoIndices = approved.photoIndices || [approved.photoIndex];
    const photos = photoIndices.map(idx => doc.photos[idx]).filter(Boolean);
    if (photos.length === 0) return null;
    
    const unitPrice = computePrice(approved);
    
    return {
        compositeId: id,
        itemDocId: doc._id,
        jobId: doc.job,
        itemNumber: approved.itemNumber,
        photoIndices: photoIndices,
        title: approved.title || 'Estate Item',
        photo: photos[0],
        photos: photos,
        unitPrice,
        quantity: 1,
        subtotal: unitPrice,
        dimensions: approved.dimensions || null,
        weight: approved.weight || null,
        material: approved.material || null,
        tags: approved.tags || []
    };
}

async function getOriginAddress(items) {
    const firstItem = items[0];
    if (!firstItem.jobId) {
        throw new Error('Item has no associated job');
    }
    
    const job = await ClientJob.findById(firstItem.jobId).lean();
    if (!job) {
        throw new Error('Job not found');
    }
    
    console.log('Raw propertyAddress from job:', job.propertyAddress);

    const addressParts = job.propertyAddress.split(',').map(p => p.trim());
    console.log('Address parts after split:', addressParts);

    const stateZip = addressParts[2] || '';
    console.log('State/Zip part:', stateZip);

    const stateZipParts = stateZip.split(' ');
    console.log('State/Zip parts after split:', stateZipParts);

    const originAddress = {
        jobId: job._id,
        address: addressParts[0] || job.propertyAddress,
        city: addressParts[1] || '',
        state: stateZipParts[0] || 'OH',
        zipCode: stateZipParts[1] || '',
        contactName: job.contractSignor || 'Estate Sale',
        phoneNumber: job.contactPhone || '(513) 609-4731'
    };

    console.log('Final origin address for FedEx:', JSON.stringify(originAddress, null, 2));

    return originAddress;
}

function toStripeLineItems(items, deliveryFee, taxAmount, currency = 'usd') {
    const lineItems = items.map(it => ({
        price_data: {
            currency,
            product_data: { 
                name: it.title, 
                images: it.photo ? [it.photo] : undefined 
            },
            unit_amount: Math.round(it.unitPrice * 100)
        },
        quantity: it.quantity
    }));

    if (deliveryFee > 0) {
        lineItems.push({
            price_data: {
                currency,
                product_data: { name: 'Shipping & Handling' },
                unit_amount: Math.round(deliveryFee * 100)
            },
            quantity: 1
        });
    }

    if (taxAmount > 0) {
        lineItems.push({
            price_data: {
                currency,
                product_data: { name: 'Sales Tax (7.8%)' },
                unit_amount: Math.round(taxAmount * 100)
            },
            quantity: 1
        });
    }

    return lineItems;
}

exports.calculateCheckoutTotals = async (req, res) => {
    try {
        const userId = req.user.sub;
        const { deliveryType, address, city, state, zipCode } = req.body;

        const cart = await Cart.findOne({ user: userId }).lean();
        if (!cart || !cart.items.length) {
            return res.status(400).json({ message: 'Cart is empty' });
        }

        const expanded = [];
        for (const c of cart.items) {
            const x = await expandComposite(c.itemId);
            if (!x) {
                return res.status(400).json({ message: `Item unavailable: ${c.itemId}` });
            }
            expanded.push(x);
        }

        const subtotal = expanded.reduce((s, it) => s + it.subtotal, 0);

        let deliveryFee = 0;
        let shippingDetails = null;
        let originAddress = null;
        let shippingBreakdown = null;

        if (deliveryType === 'shipping') {
            if (!address || !city || !state || !zipCode) {
                return res.status(400).json({ message: 'Shipping address required' });
            }

            try {
                originAddress = await getOriginAddress(expanded);
                
                shippingDetails = await calculateShipping({
                    originAddress,
                    destinationAddress: { address, city, state, zipCode },
                    items: expanded
                });
                
                deliveryFee = shippingDetails.rate || 0;
                
                shippingBreakdown = {
                    fedexRate: shippingDetails.fedexRate || 0,
                    handlingFee: shippingDetails.handlingFee || 0,
                    total: deliveryFee,
                    carrier: shippingDetails.carrier,
                    service: shippingDetails.service,
                    estimatedDays: shippingDetails.estimatedDays
                };
            } catch (error) {
                console.error('Shipping calculation error:', error);
                return res.status(400).json({ message: error.message || 'Unable to calculate shipping' });
            }
        } else if (deliveryType === 'pickup') {
            try {
                originAddress = await getOriginAddress(expanded);
            } catch (error) {
                console.error('Failed to get pickup address:', error);
            }
        }

        const taxAmount = Math.round((subtotal + deliveryFee) * TAX_RATE * 100) / 100;
        const grandTotal = subtotal + deliveryFee + taxAmount;

        res.json({
            subtotal: Math.round(subtotal * 100) / 100,
            deliveryFee: Math.round(deliveryFee * 100) / 100,
            taxAmount,
            grandTotal: Math.round(grandTotal * 100) / 100,
            breakdown: {
                itemsSubtotal: Math.round(subtotal * 100) / 100,
                shipping: shippingBreakdown,
                tax: {
                    rate: TAX_RATE,
                    amount: taxAmount,
                    description: 'Sales Tax (7.8%)'
                },
                total: Math.round(grandTotal * 100) / 100
            },
            shippingDetails,
            originAddress: deliveryType === 'pickup' ? originAddress : null,
            items: expanded
        });
    } catch (err) {
        console.error('Calculate totals error:', err);
        res.status(500).json({ message: 'Failed to calculate totals' });
    }
};

exports.createCheckoutSession = async (req, res) => {
    try {
        const userId = req.user.sub;
        const email = req.user.email;
        const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
        
        const { 
            deliveryType, 
            scheduledAt, 
            fullName, 
            phoneNumber, 
            address, 
            city, 
            state, 
            zipCode, 
            instructions 
        } = req.body;

        if (!deliveryType || !fullName || !phoneNumber) {
            return res.status(400).json({ message: 'Delivery type, full name, and phone number required' });
        }

        if (deliveryType === 'shipping' && (!address || !city || !state || !zipCode)) {
            return res.status(400).json({ message: 'Shipping address required' });
        }

        const cart = await Cart.findOne({ user: userId }).lean();
        if (!cart || !cart.items.length) {
            return res.status(400).json({ message: 'Cart is empty' });
        }

        const expanded = [];
        for (const c of cart.items) {
            const x = await expandComposite(c.itemId);
            if (!x) {
                return res.status(400).json({ message: `Item unavailable: ${c.itemId}` });
            }
            expanded.push(x);
        }

        const subtotal = expanded.reduce((s, it) => s + it.subtotal, 0);

        let deliveryFee = 0;
        let shippingDetails = null;
        let originAddress = null;

        try {
            originAddress = await getOriginAddress(expanded);
        } catch (error) {
            console.error('Failed to get origin address:', error);
            return res.status(400).json({ message: error.message });
        }

        if (deliveryType === 'shipping') {
            try {
                shippingDetails = await calculateShipping({
                    originAddress,
                    destinationAddress: { address, city, state, zipCode },
                    items: expanded
                });
                deliveryFee = shippingDetails.rate || 0;
            } catch (error) {
                console.error('Shipping calculation error:', error);
                return res.status(400).json({ message: error.message || 'Unable to calculate shipping' });
            }
        }

        const taxAmount = Math.round((subtotal + deliveryFee) * TAX_RATE * 100) / 100;
        const grandTotal = subtotal + deliveryFee + taxAmount;

        const order = await Order.create({
            user: userId,
            job: originAddress.jobId,
            items: expanded,
            currency: process.env.CURRENCY || 'usd',
            subtotal: Math.round(subtotal * 100) / 100,
            deliveryFee: Math.round(deliveryFee * 100) / 100,
            taxAmount,
            totalAmount: Math.round(grandTotal * 100) / 100,
            paymentStatus: 'pending',
            paymentProvider: 'stripe',
            deliveryDetails: {
                type: deliveryType,
                scheduledAt: scheduledAt ? new Date(scheduledAt) : undefined,
                fullName,
                phoneNumber,
                email: email || undefined,
                address: deliveryType === 'shipping' ? address : undefined,
                city: deliveryType === 'shipping' ? city : undefined,
                state: deliveryType === 'shipping' ? state : undefined,
                zipCode: deliveryType === 'shipping' ? zipCode : undefined,
                instructions
            },
            shippingDetails,
            stripe: { customerEmail: email || undefined }
        });

        const session = await stripe.checkout.sessions.create({
            mode: 'payment',
            payment_method_types: ['card'],
            line_items: toStripeLineItems(expanded, deliveryFee, taxAmount),
            success_url: `${FRONTEND_URL}/order-success?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${FRONTEND_URL}/checkout`,
            customer_email: email,
            metadata: { 
                orderId: String(order._id), 
                userId: String(userId) 
            }
        });

        await Order.updateOne(
            { _id: order._id }, 
            { $set: { 'stripe.sessionId': session.id } }
        );

        res.json({ 
            sessionId: session.id, 
            orderId: String(order._id) 
        });

    } catch (e) {
        console.error('Checkout error:', e);
        res.status(500).json({ message: 'Checkout failed' });
    }
};