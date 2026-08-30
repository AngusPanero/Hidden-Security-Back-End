const mongoose = require("mongoose");

// ─── Historial permanente de rendiciones de certificaciones ──────────────────
// A diferencia de CertificationAttempt (que es el estado transitorio de UN
// examen mientras se rinde y se puede purgar/archivar), este modelo es el
// registro de auditoría que nunca se borra: un documento por cada vez que
// un alumno arrancó una certificación, con su resultado final y una bitácora
// de eventos (para poder reconstruir qué pasó si hay una disputa — ej. "se
// desconectó", "cambió de pestaña", "se le venció el tiempo", "conectó un
// segundo monitor y no lo desconectó a tiempo").
const certificationRecordSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, index: true },
    certId: { type: String, required: true, index: true },

    attemptId: { type: mongoose.Schema.Types.ObjectId, ref: "CertificationAttempt" },

    startedAt:   { type: Date, required: true },
    completedAt: { type: Date, default: null },

    // "violation": el examen se canceló por una infracción de integridad
    // detectada mientras se rendía (ej. segundo monitor no desconectado
    // dentro de los 30s de gracia) — distinto de "failed" (respondió mal)
    // o "expired" (se acabó el tiempo).
    result: {
      type: String,
      enum: ["passed", "failed", "expired", "abandoned", "violation"],
      required: true,
    },

    score:        { type: Number, default: null },
    correctCount: { type: Number, default: null },
    totalQuestions: { type: Number, required: true },
    passingScoreUsed: { type: Number, required: true },
    durationSeconds:  { type: Number, default: null },

    // Motivo puntual cuando result==="violation" — ej: "second_monitor_connected"
    terminationReason: { type: String, default: null },

    // Bitácora de eventos del examen. type ejemplos: "started", "tab_hidden",
    // "tab_visible", "answer_saved", "flag_toggled", "time_warning_shown",
    // "submitted", "auto_expired", "second_monitor_detected_during_exam",
    // "second_monitor_disconnected", "second_monitor_kicked_to_device_check".
    events: {
      type: [{
        type: { type: String, required: true },
        at:   { type: Date, default: Date.now },
        meta: { type: mongoose.Schema.Types.Mixed, default: {} },
      }],
      default: [],
    },
  },
  { timestamps: true }
);

certificationRecordSchema.index({ userId: 1, certId: 1, createdAt: -1 });

module.exports = mongoose.model("CertificationRecord", certificationRecordSchema);