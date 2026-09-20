const mongoose = require('mongoose');

const VALID_PLANS = ['starter', 'pro', 'elite', 'voucher', 'business', 'enterprise'];

const CouponSchema = new mongoose.Schema({
    code:     { type: String, required: true, unique: true, uppercase: true, trim: true },
    discount: { type: Number, required: true },

    type: {
        type:     String,
        enum:     ['single_use', 'date_limited', 'limited_uses'],
        required: true
    },

    expiryDate: { type: Date, default: null },

    maxUses:   { type: Number, default: null },
    usesCount: { type: Number, default: 0 },

    scope: {
        type:    String,
        enum:    ['all', 'plans'],
        default: 'all'
    },

    allowedPlans: [{
        type: String,
        enum: VALID_PLANS,
        lowercase: true
    }],

    isActive: { type: Boolean, default: true },
    usedBy:   [{ type: String }]   

}, { timestamps: true });

module.exports = mongoose.model('Coupon', CouponSchema);