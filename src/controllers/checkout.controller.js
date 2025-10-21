const Cart = require('../models/Cart');
const Item = require('../models/Item');
const Order = require('../models/Order');
const { stripe } = require('../services/stripe');

function computePrice(a) {
    if (typeof a.price === 'number') return a.price;
    const low = a.priceLow ?? 0;
    const high = a.priceHigh ?? 0;
    if (low && high) return Math.round((low + high) / 2);
    return high || low || 0;
}

async function expandComposite(id) {
    const [docId, indexStr] = String(id).split('_');
    const photoIndex = Number(indexStr);
    if (!docId || Number.isNaN(photoIndex)) return null;
    const doc = await Item.findOne({ _id: docId, status: 'approved' }).lean();
    if (!doc || !Array.isArray(doc.approvedItems)) return null;
    const approved = doc.approvedItems.find(x => x.photoIndex === photoIndex);
    if (!approved) return null;
    const photo = doc.photos?.[approved.photoIndex];
    if (!photo) return null;
    const unitPrice = computePrice(approved);
    return {
        compositeId: id,
        itemDocId: doc._id,
        photoIndex: approved.photoIndex,
        title: approved.title || 'Estate Item',
        photo,
        unitPrice,
        quantity: 1,
        subtotal: unitPrice
    };
}

function toStripeLineItems(items, currency = process.env.CURRENCY || 'usd') {
    return items.map(it => ({
        price_data: {
            currency,
            product_data: { name: it.title, images: it.photo ? [it.photo] : undefined },
            unit_amount: Math.round(it.unitPrice * 100)
        },
        quantity: it.quantity
    }));
}

exports.createCheckoutSession = async (req, res) => {
    try {
        const userId = req.user.sub;
        const email = req.user.email;
        const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
        const cart = await Cart.findOne({ user: userId }).lean();
        if (!cart || !cart.items.length) return res.status(400).json({ message: 'Cart empty' });
        const expanded = [];
        for (const c of cart.items) {
            const x = await expandComposite(c.itemId);
            if (!x) return res.status(400).json({ message: `Item unavailable ${c.itemId}` });
            expanded.push(x);
        }
        const totalAmount = expanded.reduce((s, it) => s + it.subtotal, 0);
        const order = await Order.create({
            user: userId,
            items: expanded,
            currency: process.env.CURRENCY || 'usd',
            totalAmount,
            paymentStatus: 'pending',
            paymentProvider: 'stripe',
            stripe: { customerEmail: email || undefined }
        });
        const session = await stripe.checkout.sessions.create({
            mode: 'payment',
            payment_method_types: ['card'],
            line_items: toStripeLineItems(expanded),
            success_url: `${FRONTEND_URL}/order-success?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${FRONTEND_URL}/cart`,
            customer_email: email,
            metadata: { orderId: String(order._id), userId: String(userId) }
        });
        await Order.updateOne({ _id: order._id }, { $set: { 'stripe.sessionId': session.id } });
        res.json({ sessionId: session.id, orderId: String(order._id) });

    } catch (e) {
        res.status(500).json({ message: 'Checkout failed' });
    }
};
