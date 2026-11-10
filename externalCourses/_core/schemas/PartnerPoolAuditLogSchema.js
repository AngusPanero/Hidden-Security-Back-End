const crypto = require("crypto");
const mongoose = require("mongoose");

// Colección "partnerPoolAuditLogs": auditoría administrativa y económica (sección 25).
// Solo inserts: updates y deletes están bloqueados.

const AUDIT_ACTIONS = [
    "CALCULATED",
    "APPROVED",
    "ADJUSTED",
    "CLOSED",
    "PAID",
    "REOPENED",
    "CANCELLED",
    "CONFIG_UPDATED",
    // Duración formativa por versión de curso (V1.2)
    "DURATION_MEASURED",
    "DURATION_MEASUREMENT_REQUESTED",
    "DURATION_APPROVED",
    "DURATION_REJECTED",
    "DURATION_INHERITED",
    "DURATION_CONTENT_CHANGED",
    "DURATION_CONTENT_CONFIRMED",
];

const PartnerPoolAuditLogSchema = new mongoose.Schema(
    {
        logId: { type: String, required: true, unique: true, default: () => crypto.randomUUID() },
        action: { type: String, enum: AUDIT_ACTIONS, required: true },
        period: { type: String, default: null },
        settlementId: { type: String, default: null },
        partnerId: { type: mongoose.Schema.Types.ObjectId, ref: "Partner", default: null },
        adminUserId: { type: String, required: true },
        adminEmail: { type: String, default: null },
        metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
        occurredAt: { type: Date, required: true, default: Date.now },
    },
    { timestamps: { createdAt: true, updatedAt: false }, collection: "partnerPoolAuditLogs", minimize: false }
);

PartnerPoolAuditLogSchema.index({ period: 1, occurredAt: -1 });
PartnerPoolAuditLogSchema.index({ settlementId: 1, occurredAt: -1 });

const blocked = function () {
    throw new Error("partnerPoolAuditLogs es inmutable: solo se permiten inserts");
};
PartnerPoolAuditLogSchema.pre(
    ["updateOne", "updateMany", "findOneAndUpdate", "findOneAndReplace", "replaceOne", "deleteOne", "deleteMany", "findOneAndDelete"],
    blocked
);

PartnerPoolAuditLogSchema.statics.ACTIONS = AUDIT_ACTIONS;

module.exports =
    mongoose.models.PartnerPoolAuditLog || mongoose.model("PartnerPoolAuditLog", PartnerPoolAuditLogSchema);