const mongoose = require("mongoose");

// Colección "externalCourseProgress": ESTADO ACTUAL del alumno en un curso externo.
// Un solo documento por usuario + curso (sirve para todas las empresas).
// La evidencia histórica vive en courseProgressEvents, nunca acá.

const QuizResultSchema = new mongoose.Schema(
    {
        score: { type: Number, default: 0 },      // último intento (0 a 1)
        bestScore: { type: Number, default: 0 },  // mejor intento (0 a 1)
        passed: { type: Boolean, default: false },
        attempts: { type: Number, default: 0 },
        lastAttemptAt: { type: Date, default: null },
        passedAt: { type: Date, default: null },
    },
    { _id: false }
);

const ExternalCourseProgressSchema = new mongoose.Schema(
    {
        userId: { type: String, required: true },   // uid de Firebase
        courseId: { type: String, required: true },
        partnerId: { type: mongoose.Schema.Types.ObjectId, ref: "Partner", required: true },
        courseVersion: { type: Number, required: true },

        startedAt: { type: Date, required: true },
        currentStepId: { type: String, default: null },
        currentStepIndex: { type: Number, default: 0 },

        completedStepIds: { type: [String], default: [] },
        completedStepsCount: { type: Number, default: 0 },
        completedEligibleCount: { type: Number, default: 0 },
        totalEligibleSteps: { type: Number, default: 0 },
        progressPercentage: { type: Number, default: 0 }, // solo visual; el Pool usa eventos

        quizResults: { type: Map, of: QuizResultSchema, default: {} }, // clave = stepId

        isCompleted: { type: Boolean, default: false },
        completedAt: { type: Date, default: null },
    },
    { timestamps: true, collection: "externalCourseProgress" }
);

ExternalCourseProgressSchema.index({ userId: 1, courseId: 1 }, { unique: true });
ExternalCourseProgressSchema.index({ partnerId: 1, courseId: 1 });

module.exports =
    mongoose.models.ExternalCourseProgress ||
    mongoose.model("ExternalCourseProgress", ExternalCourseProgressSchema);