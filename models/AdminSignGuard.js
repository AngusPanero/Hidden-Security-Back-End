const mongoose = require("mongoose");

const AdminSignGuardSchema = new mongoose.Schema(
    {
        adminUid:     { type: String, required: true, unique: true, index: true },
        failedCount:  { type: Number, default: 0 },
        lockedUntil:  { type: Date,   default: null },
        lastFailedAt: { type: Date,   default: null },
    },
    { timestamps: true }
);

module.exports = mongoose.model("AdminSignGuard", AdminSignGuardSchema);