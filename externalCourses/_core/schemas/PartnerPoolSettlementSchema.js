const crypto = require("crypto");
const mongoose = require("mongoose");

const D = mongoose.Schema.Types.Decimal128;

// Colección "partnerPoolSettlements": liquidación de cada Partner por mes (sección 24).
// Estados: DRAFT → CALCULATED → APPROVED → PAID / CANCELLED
// Un monto calculado nunca se edita: las correcciones van como ajustes (sección 25).

const SETTLEMENT_STATUSES = ["DRAFT", "CALCULATED", "APPROVED", "PAID", "CANCELLED"];

const AdjustmentSchema = new mongoose.Schema(
    {
        adjustmentId: { type: String, required: true, default: () => crypto.randomUUID() },
        type: { type: String, enum: ["CREDIT", "DEBIT"], required: true },
        amount: { type: D, required: true },
        reason: { type: String, required: true },
        createdBy: { type: String, required: true },
        createdAt: { type: Date, default: Date.now },
    },
    { _id: false }
);

const SettlementCourseSchema = new mongoose.Schema(
    {
        courseId: { type: String, required: true },
        courseVersion: { type: Number, required: true },
        title: { type: String, default: "" },
        enrollments: { type: Number, default: 0 },
        uniqueConsumers: { type: Number, default: 0 },
        completions: { type: Number, default: 0 },
        consumptionScore: { type: D, required: true },   // puntos BASE del curso
        // V1.2 — ponderación por duración
        approvedHours: { type: D, default: null },
        weightPct: { type: D, default: null },           // 0 a 1
        weightedScore: { type: D, default: null },       // puntos base × weightPct
        durationRecordId: { type: String, default: null },
    },
    { _id: false }
);

const PartnerPoolSettlementSchema = new mongoose.Schema(
    {
        settlementId: { type: String, required: true, unique: true }, // PPS-2026-10-PT0001
        period: { type: String, required: true },
        partnerId: { type: mongoose.Schema.Types.ObjectId, ref: "Partner", required: true },
        partnerSnapshot: {
            code: { type: String, default: "" },
            name: { type: String, default: "" },
            email: { type: String, default: "" },
        },
        formulaVersion: { type: String, required: true },

        courses: { type: [SettlementCourseSchema], default: [] },

        partnerBaseScore: { type: D, default: null },    // V1.2: puntos base del partner
        partnerScore: { type: D, required: true },       // puntos ponderados del partner (definen la participación)
        globalBaseScore: { type: D, default: null },     // V1.2: puntos base de todos los partners
        globalScore: { type: D, required: true },        // puntos ponderados de todos los partners
        referenceHours: { type: D, default: null },      // V1.2: referencia del mes (100%)
        partnerShare: { type: D, required: true },
        enabledPoolAmount: { type: D, required: true },
        settlementAmount: { type: D, required: true },
        adjustments: { type: [AdjustmentSchema], default: [] },
        finalAmount: { type: D, required: true },

        status: { type: String, enum: SETTLEMENT_STATUSES, default: "DRAFT" },
        calculatedAt: { type: Date, default: null },
        approvedAt: { type: Date, default: null },
        approvedBy: { type: String, default: null },
        paidAt: { type: Date, default: null },
        paidBy: { type: String, default: null },
        paymentReference: { type: String, default: null },
        cancelledAt: { type: Date, default: null },
        cancelledBy: { type: String, default: null },
        cancelReason: { type: String, default: null },
    },
    { timestamps: true, collection: "partnerPoolSettlements" }
);

PartnerPoolSettlementSchema.index({ period: 1, partnerId: 1 }, { unique: true });
PartnerPoolSettlementSchema.statics.STATUSES = SETTLEMENT_STATUSES;

module.exports =
    mongoose.models.PartnerPoolSettlement ||
    mongoose.model("PartnerPoolSettlement", PartnerPoolSettlementSchema);