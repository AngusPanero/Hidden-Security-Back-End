const mongoose = require("mongoose");

const D = mongoose.Schema.Types.Decimal128;

// Colección "partnerPoolConsumption": snapshot mensual usuario/curso (sección 18).
// Congela los valores usados para liquidar. Un único documento por
// period + userId + courseId + courseVersion.

const PartnerPoolConsumptionSchema = new mongoose.Schema(
    {
        period: { type: String, required: true }, // "2026-10"
        userId: { type: String, required: true },
        courseId: { type: String, required: true },
        courseVersion: { type: Number, required: true },
        partnerId: { type: mongoose.Schema.Types.ObjectId, ref: "Partner", required: true },

        eligibility: {
            eligible: { type: Boolean, required: true },
            accessType: { type: String, default: null },
        },

        courseSnapshot: {
            title: { type: String, default: "" },
            totalEligibleSteps: { type: Number, required: true },
            estimatedDurationMinutes: { type: Number, default: null },
            moduleCount: { type: Number, default: 0 },
            courseWeight: { type: D, required: true },
        },

        consumption: {
            newCompletedSteps: { type: Number, required: true },
            progressDelta: { type: D, required: true },
            completedDuringPeriod: { type: Boolean, required: true },
            progressScore: { type: D, required: true },
            completionScore: { type: D, required: true },
            totalScore: { type: D, required: true },     // progreso + finalización (máx. 1 por recorrido)
            cappedBy: { type: D, default: null },        // puntos recortados por el tope de 1 por recorrido
            weightedScore: { type: D, required: true },  // totalScore × courseWeight (lo que suma al Partner)
        },

        formulaVersion: { type: String, required: true },
        calculatedAt: { type: Date, required: true },
    },
    { timestamps: true, collection: "partnerPoolConsumption" }
);

PartnerPoolConsumptionSchema.index({ period: 1, userId: 1, courseId: 1, courseVersion: 1 }, { unique: true });
PartnerPoolConsumptionSchema.index({ userId: 1, courseId: 1, courseVersion: 1, period: 1 });
PartnerPoolConsumptionSchema.index({ period: 1, partnerId: 1 });

module.exports =
    mongoose.models.PartnerPoolConsumption ||
    mongoose.model("PartnerPoolConsumption", PartnerPoolConsumptionSchema);