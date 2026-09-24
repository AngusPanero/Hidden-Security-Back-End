const mongoose = require("mongoose");

const AdminClaimsAuditSchema = new mongoose.Schema(
    {
        adminUid:    { type: String, required: true, index: true },
        adminEmail:  { type: String, default: null },
        targetUid:   { type: String, default: null, index: true },
        targetEmail: { type: String, default: null },
        action:      { type: String, required: true },
        payload:     { type: mongoose.Schema.Types.Mixed, default: null },
        result:      { type: String, enum: ["success", "bad_pin", "locked", "rejected", "error"], required: true },
        detail:      { type: String, default: null },
        ip:          { type: String, default: null },
        userAgent:   { type: String, default: null },
    },
    { timestamps: true }
);

module.exports = mongoose.model("AdminClaimsAudit", AdminClaimsAuditSchema);