const mongoose = require("mongoose");

// Colección "courseVersions": foto inmutable de cada versión publicada (ACTIVE).
// La genera el registro al arrancar. Sirve para que los cálculos históricos
// del Partner Pool usen siempre la estructura de la versión en la que ocurrió
// el consumo (V1 nunca se recalcula con V2).

const VersionStepSchema = new mongoose.Schema(
    {
        stepId: { type: String, required: true },
        stepIndex: { type: Number, required: true },
        moduleId: { type: String, required: true },
        type: { type: String, required: true },
        title: { type: String, default: "" },
        required: { type: Boolean, required: true },
        progressEligible: { type: Boolean, required: true },
        quizId: { type: String, default: null },
    },
    { _id: false }
);

const CourseVersionSchema = new mongoose.Schema(
    {
        courseId: { type: String, required: true },
        version: { type: Number, required: true },
        partnerId: { type: mongoose.Schema.Types.ObjectId, ref: "Partner", required: true },
        partnerSlug: { type: String, required: true },
        courseSlug: { type: String, required: true },
        title: { type: String, required: true },
        hash: { type: String, required: true }, // hash de la estructura (detecta cambios sin subir versión)
        estimatedDurationMinutes: { type: Number, default: null },
        moduleCount: { type: Number, required: true },
        totalSteps: { type: Number, required: true },
        totalEligibleSteps: { type: Number, required: true },
        partnerPool: {
            enabled: { type: Boolean, required: true },
            courseWeight: { type: Number, default: 1 },
        },
        steps: { type: [VersionStepSchema], default: [] },
        publishedAt: { type: Date, default: Date.now },
    },
    { timestamps: true, collection: "courseVersions" }
);

CourseVersionSchema.index({ courseId: 1, version: 1 }, { unique: true });
CourseVersionSchema.index({ partnerId: 1 });

module.exports =
    mongoose.models.CourseVersion || mongoose.model("CourseVersion", CourseVersionSchema);