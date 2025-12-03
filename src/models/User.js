const mongoose = require('mongoose');

const ROLES = ['agent','client','buyer','vendor'];

const userSchema = new mongoose.Schema(
    {
        name: { type: String, required: true, trim: true },
        email: { type: String, required: true, unique: true, lowercase: true, index: true },
        passwordHash: { type: String, required: true },
        role: { type: String, enum: ROLES, default: 'client', index: true },
        vendorProfile: { type: mongoose.Schema.Types.ObjectId, ref: 'Vendor', default: null },
        resetPasswordToken: { type: String },
        resetPasswordExpires: { type: Date },
    },
    { timestamps: true }
);

module.exports = {
    User: mongoose.model('User', userSchema),
    ROLES
};