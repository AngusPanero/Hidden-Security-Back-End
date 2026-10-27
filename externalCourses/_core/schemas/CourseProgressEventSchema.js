const crypto = require("crypto");
const mongoose = require("mongoose");
const { EVENT_TYPE_LIST } = require("../constants/eventTypes");

// Colección "courseProgressEvents": HISTORIAL INMUTABLE.
// Es la fuente del cálculo mensual del Partner Pool.
// Solo se inserta; updates y deletes están bloqueados.

const CourseProgressEventSchema = new mongoose.Schema(
    {
        eventId: { type: String, required: true, unique: true, default: () => crypto.randomUUID() },
        userId: { type: String, required: true },
        courseId: { type: String, required: true },
        courseVersion: { type: Number, required: true },
        partnerId: { type: mongoose.Schema.Types.ObjectId, ref: "Partner", default: null },

        eventType: { type: String, enum: EVENT_TYPE_LIST, required: true },
        stepId: { type: String, default: null },
        stepIndex: { type: Number, default: null },
        moduleId: { type: String, default: null },

        // accessType, partnerPoolEligible, plan, score, etc.
        metadata: { type: mongoose.Schema.Types.Mixed, default: {} },

        occurredAt: { type: Date, required: true }, // hora del servidor, nunca del front

        // Clave de idempotencia: solo la tienen los eventos que pueden existir una vez
        // (STEP_COMPLETED, QUIZ_PASSED, COURSE_STARTED, COURSE_COMPLETED...).
        dedupeKey: { type: String },
    },
    {
        timestamps: { createdAt: true, updatedAt: false },
        collection: "courseProgressEvents",
        minimize: false,
    }
);

CourseProgressEventSchema.index({ userId: 1, courseId: 1, occurredAt: 1 });
CourseProgressEventSchema.index({ partnerId: 1, occurredAt: 1 });    // cálculo por período
CourseProgressEventSchema.index({ eventType: 1, occurredAt: 1 });
CourseProgressEventSchema.index(
    { dedupeKey: 1 },
    { unique: true, partialFilterExpression: { dedupeKey: { $type: "string" } } }
);

// Inmutabilidad
const blocked = function () {
    throw new Error("courseProgressEvents es inmutable: solo se permiten inserts");
};
CourseProgressEventSchema.pre(
    [
        "updateOne",
        "updateMany",
        "findOneAndUpdate",
        "findOneAndReplace",
        "replaceOne",
        "deleteOne",
        "deleteMany",
        "findOneAndDelete",
    ],
    blocked
);

module.exports =
    mongoose.models.CourseProgressEvent ||
    mongoose.model("CourseProgressEvent", CourseProgressEventSchema);