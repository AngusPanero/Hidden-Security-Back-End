const mongoose = require("mongoose");

const D = mongoose.Schema.Types.Decimal128;

// Colección "partnerPoolPeriods": cálculo global de cada mes (sección 23).
// Estados: OPEN → CALCULATING → CALCULATED → APPROVED → CLOSED

const PERIOD_STATUSES = ["OPEN", "CALCULATING", "CALCULATED", "APPROVED", "CLOSED"];

const PartnerPoolPeriodSchema = new mongoose.Schema(
    {
        period: { type: String, required: true, unique: true }, // "2026-10"
        status: { type: String, enum: PERIOD_STATUSES, default: "OPEN" },
        formulaVersion: { type: String, default: "PP_V1" },

        range: {
            from: { type: Date, required: true },
            to: { type: Date, required: true },
        },

        configuration: {
            maximumPoolRate: { type: D },
            progressWeight: { type: D },
            completionWeight: { type: D },
            consumptionTargetRate: { type: D },
            enablementStrategy: { type: String },
            defaultCourseWeight: { type: D },
            revenue: { type: mongoose.Schema.Types.Mixed, default: {} },
        },

        financials: {
            eligibleNetTrainingRevenue: { type: D, default: null },
            maximumPoolAmount: { type: D, default: null },
            enabledPoolAmount: { type: D, default: null },
        },

        // Detalle de cómo se armaron los ingresos (para que el admin pueda revisarlos)
        revenueBreakdown: {
            paymentsCount: { type: Number, default: 0 },
            grossAmount: { type: D, default: null },
            feesAmount: { type: D, default: null },
            estimatedFeePayments: { type: Number, default: 0 },
            mixedPayments: { type: Number, default: 0 },      // traían items excluidos junto con un plan
            mixedPaymentsAmount: { type: D, default: null },
            excludedEnterprisePayments: { type: Number, default: 0 },
        },

        metrics: {
            eligibleSubscriptions: { type: Number, default: 0 },
            uniqueEligibleConsumers: { type: Number, default: 0 },
            participatingCourses: { type: Number, default: 0 },
            participatingPartners: { type: Number, default: 0 },
            totalConsumptionScore: { type: D, default: null },
            consumptionTarget: { type: D, default: null },
            enablementFactor: { type: D, default: null },
        },

        calculatedAt: { type: Date, default: null },
        calculatedBy: { type: String, default: null },
        approvedAt: { type: Date, default: null },
        approvedBy: { type: String, default: null },
        closedAt: { type: Date, default: null },
        closedBy: { type: String, default: null },
    },
    { timestamps: true, collection: "partnerPoolPeriods" }
);

PartnerPoolPeriodSchema.statics.STATUSES = PERIOD_STATUSES;

module.exports =
    mongoose.models.PartnerPoolPeriod || mongoose.model("PartnerPoolPeriod", PartnerPoolPeriodSchema);