const mongoose = require("mongoose");

const D = mongoose.Schema.Types.Decimal128;

// ─────────────────────────────────────────────────────────────────────
// Colección "courseDurations": duración formativa de cada VERSIÓN de un curso
// (Partner Pool V1.2 — ponderación dinámica por duración formativa).
//
// Un documento por curso + versión. Guarda:
//  - lo medido por código (videos, PDFs, preguntas)
//  - la estimación calculada por código con su desglose (no hay IA)
//  - la duración APROBADA por Hidden (la única que usa el Partner Pool)
//  - el historial de cambios (solo se agregan entradas, nunca se editan)
//
// La duración aprobada nunca se borra: cada cambio deja una entrada en
// "history" y en partnerPoolAuditLogs. Los períodos del pool guardan una
// copia de las horas que usaron, así que cambiarla nunca altera un mes ya
// calculado y aprobado.
// ─────────────────────────────────────────────────────────────────────

const DURATION_STATUSES = [
    "PENDING_MEASUREMENT", // registrada, esperando la medición
    "MEASURING",           // medición en curso (bloqueo entre instancias del server)
    "PENDING_REVIEW",      // hay estimación: falta que Hidden la revise
    "APPROVED",            // duración aprobada: el pool la puede usar
    "REJECTED",            // Hidden rechazó la estimación: corregir el curso o cargarla a mano
    "MEASUREMENT_FAILED",  // la medición falló: se puede reintentar o cargar a mano
];

// ESTIMATE  = aprobó la estimación del código tal cual
// MODIFIED  = aprobó otras horas (con justificación)
// INHERITED = copió la duración aprobada de la versión anterior (con justificación)
const APPROVAL_SOURCES = ["ESTIMATE", "MODIFIED", "INHERITED"];

const HISTORY_ACTIONS = [
    "REGISTERED",
    "MEASURED",
    "MEASUREMENT_FAILED",
    "MEASUREMENT_REQUESTED",
    "APPROVED",
    "REJECTED",
    "INHERITED",
    "CONTENT_CHANGED",
    "CONTENT_CONFIRMED",
];

const MeasuredVideoSchema = new mongoose.Schema(
    {
        stepId: String,
        title: String,
        seconds: { type: Number, default: null },
        source: { type: String, enum: ["MEASURED", "DECLARED", "UNKNOWN"], default: "UNKNOWN" },
        note: { type: String, default: null },
    },
    { _id: false }
);

const MeasuredDocumentSchema = new mongoose.Schema(
    {
        stepId: String,
        title: String,
        pages: { type: Number, default: 0 },
        words: { type: Number, default: 0 },
        duplicateOf: { type: String, default: null }, // stepId con el mismo contenido (o casi)
        similarity: { type: Number, default: null },  // 0 a 1 contra duplicateOf
        note: { type: String, default: null },
    },
    { _id: false }
);

const MeasuredQuizSchema = new mongoose.Schema(
    {
        stepId: String,
        title: String,
        questions: { type: Number, default: 0 },
    },
    { _id: false }
);

const HistorySchema = new mongoose.Schema(
    {
        action: { type: String, enum: HISTORY_ACTIONS, required: true },
        hours: { type: D, default: null },
        by: { type: String, required: true }, // uid del admin o "system"
        byEmail: { type: String, default: null },
        at: { type: Date, required: true, default: Date.now },
        reason: { type: String, default: null },
    },
    { _id: false }
);

const CourseDurationSchema = new mongoose.Schema(
    {
        courseId: { type: String, required: true },
        version: { type: Number, required: true },
        partnerId: { type: mongoose.Schema.Types.ObjectId, ref: "Partner", required: true },
        partnerSlug: { type: String, required: true },
        title: { type: String, default: "" },

        status: { type: String, enum: DURATION_STATUSES, default: "PENDING_MEASUREMENT" },

        // Huella del contenido (PDFs, videos y preguntas). Si el contenido cambia
        // sin subir la versión, la duración aprobada queda en revisión.
        contentHash: { type: String, default: null },        // con el que se midió / aprobó
        currentContentHash: { type: String, default: null }, // el último visto al arrancar
        contentChanged: { type: Boolean, default: false },

        measured: {
            videos: { type: [MeasuredVideoSchema], default: [] },
            documents: { type: [MeasuredDocumentSchema], default: [] },
            quizzes: { type: [MeasuredQuizSchema], default: [] },
            totals: {
                videoSeconds: { type: Number, default: 0 },
                pages: { type: Number, default: 0 },
                words: { type: Number, default: 0 },
                questions: { type: Number, default: 0 },
                duplicates: { type: Number, default: 0 },
            },
            warnings: { type: [String], default: [] },
            measuredAt: { type: Date, default: null },
        },

        // Estimación calculada por código a partir de lo medido (ver courseDurationService)
        estimate: {
            videoHours: { type: Number, default: null },
            readingHours: { type: Number, default: null },
            assessmentHours: { type: Number, default: null },
            practiceHours: { type: Number, default: null },
            totalHours: { type: Number, default: null },
            rules: { type: mongoose.Schema.Types.Mixed, default: null }, // reglas usadas (copia)
            explanation: { type: [String], default: [] },
            estimatedAt: { type: Date, default: null },
        },
        measurementError: { type: String, default: null },
        measurementAttempts: { type: Number, default: 0 },
        measurementStartedAt: { type: Date, default: null },

        approved: {
            hours: { type: D, default: null },
            source: { type: String, enum: [...APPROVAL_SOURCES, null], default: null },
            justification: { type: String, default: null },
            approvedBy: { type: String, default: null },
            approvedByEmail: { type: String, default: null },
            approvedAt: { type: Date, default: null },
        },

        history: { type: [HistorySchema], default: [] },
    },
    { timestamps: true, collection: "courseDurations" }
);

CourseDurationSchema.index({ courseId: 1, version: 1 }, { unique: true });
CourseDurationSchema.index({ status: 1, updatedAt: -1 });

CourseDurationSchema.statics.STATUSES = DURATION_STATUSES;

module.exports =
    mongoose.models.CourseDuration || mongoose.model("CourseDuration", CourseDurationSchema);