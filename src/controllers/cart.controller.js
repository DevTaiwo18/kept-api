const Item = require('../models/Item');
const Cart = require('../models/Cart');

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

async function validateAndGetItem(itemId) {
    const parts = itemId.split('_');
    const docId = parts[0];
    const photoIndex = parts.length > 1 ? parseInt(parts[1], 10) : null;

    const doc = await Item.findOne({ _id: docId, status: 'approved' }).lean();
    if (!doc) return null;

    if (photoIndex === null || !doc.approvedItems) return null;

    const approvedItem = doc.approvedItems.find(
        item => item.photoIndex === photoIndex
    );

    if (!approvedItem) return null;

    const photoUrl = doc.photos[approvedItem.photoIndex];
    if (!photoUrl) return null;

    return {
        _id: itemId,
        itemId: docId,
        photoIndex: approvedItem.photoIndex,
        title: approvedItem.title || '',
        description: approvedItem.description || '',
        category: approvedItem.category || 'Misc',
        price: computeDisplayPrice(approvedItem),
        photo: photoUrl,
        quantity: 1
    };
}

exports.addToCart = async (req, res) => {
    try {
        const { itemId } = req.body;
        const userId = req.user.sub;

        if (!itemId) {
            return res.status(400).json({ message: 'Item ID required' });
        }

        const validatedItem = await validateAndGetItem(itemId);
        if (!validatedItem) {
            return res.status(404).json({ message: 'Item not found or unavailable' });
        }

        let cart = await Cart.findOne({ user: userId });

        if (!cart) {
            cart = new Cart({
                user: userId,
                items: [{ itemId }]
            });
        } else {
            const existingItem = cart.items.find(item => item.itemId === itemId);
            if (existingItem) {
                return res.status(400).json({ message: 'Item already in cart' });
            }
            cart.items.push({ itemId });
        }

        await cart.save();

        res.json({
            message: 'Item added to cart',
            item: validatedItem,
            cartItemCount: cart.items.length
        });
    } catch (err) {
        console.error('Add to cart error:', err);
        res.status(500).json({ message: 'Failed to add item to cart' });
    }
};

exports.getCart = async (req, res) => {
    try {
        const userId = req.user.sub;

        const cart = await Cart.findOne({ user: userId });

        if (!cart || cart.items.length === 0) {
            return res.json({ items: [], total: 0, count: 0 });
        }

        const cartItems = [];
        let total = 0;

        for (const cartItem of cart.items) {
            const validatedItem = await validateAndGetItem(cartItem.itemId);
            if (validatedItem) {
                cartItems.push({
                    ...validatedItem,
                    addedAt: cartItem.addedAt
                });
                total += validatedItem.price;
            }
        }

        res.json({
            items: cartItems,
            total,
            count: cartItems.length
        });
    } catch (err) {
        console.error('Get cart error:', err);
        res.status(500).json({ message: 'Failed to fetch cart' });
    }
};

exports.removeFromCart = async (req, res) => {
    try {
        const { itemId } = req.params;
        const userId = req.user.sub;

        const cart = await Cart.findOne({ user: userId });

        if (!cart) {
            return res.status(404).json({ message: 'Cart not found' });
        }

        const itemIndex = cart.items.findIndex(item => item.itemId === itemId);

        if (itemIndex === -1) {
            return res.status(404).json({ message: 'Item not in cart' });
        }

        cart.items.splice(itemIndex, 1);
        await cart.save();

        res.json({
            message: 'Item removed from cart',
            cartItemCount: cart.items.length
        });
    } catch (err) {
        console.error('Remove from cart error:', err);
        res.status(500).json({ message: 'Failed to remove item from cart' });
    }
};

exports.clearCart = async (req, res) => {
    try {
        const userId = req.user.sub;

        await Cart.findOneAndUpdate(
            { user: userId },
            { items: [] },
            { upsert: true }
        );

        res.json({ message: 'Cart cleared successfully' });
    } catch (err) {
        console.error('Clear cart error:', err);
        res.status(500).json({ message: 'Failed to clear cart' });
    }
};