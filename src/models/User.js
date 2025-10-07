const mongoose = require('mongoose');

const ROLES = ['agent', 'client', 'shopper', 'vendor'];

const userSchema = new mongoose.Schema(
    {
        name: { type: String, required: true, trim: true },
        email: { type: String, required: true, unique: true, lowercase: true, index: true },
        passwordHash: { type: String, required: true },
        role: { type: String, enum: ROLES, default: 'client', index: true },
    },
    { timestamps: true }
);

module.exports = {
    User: mongoose.model('User', userSchema),
    ROLES
};
