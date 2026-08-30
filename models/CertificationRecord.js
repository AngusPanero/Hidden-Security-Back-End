const mongoose = require("mongoose");

// ─── Historial permanente de rendiciones de certificaciones ──────────────────
// A diferencia de CertificationAttempt (que es el estado transitorio de UN
// examen mientras se rinde y se puede purgar/archivar), este modelo es el
// registro de auditoría que nunca se borra: un documento por cada vez que
// un alumno arrancó una certificación, con su resultado final y una bitácora
// de eventos (para poder reconstruir qué pasó si hay una disputa — ej. "se
// desconectó", "cambió de pestaña", "se le venció el tiempo").
//
// Sirve como fuente de verdad para:
// - la vista de empresa (mostrar cuándo se certificó, no solo un booleano)
// - soporte/disputas ("¿por qué reprobé?")
// - métricas propias (tasa de aprobación, tiempo promedio, etc.)
const certificationRecordSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, index: true },
    certId: { type: String, required: true, index: true },

    // referencia al intento que generó este registro — por si en algún
    // momento hace falta cruzar contra el detalle de respuestas
    attemptId: { type: mongoose.Schema.Types.ObjectId, ref: "CertificationAttempt" },

    startedAt:   { type: Date, required: true },
    completedAt: { type: Date, default: null },

    // "passed" | "failed" | "expired" | "abandoned"
    // (expired: se acabó el tiempo sin submit; abandoned: reservado a futuro
    // si en algún momento se detecta cierre de pestaña sin submit)
    result: {
      type: String,
      enum: ["passed", "failed", "expired", "abandoned"],
      required: true,
    },

    score:        { type: Number, default: null }, // 0..1
    correctCount: { type: Number, default: null },
    totalQuestions: { type: Number, required: true },
    passingScoreUsed: { type: Number, required: true }, // snapshot del corte al momento de rendir
    durationSeconds:  { type: Number, default: null },  // cuánto tardó realmente

    // Bitácora de eventos del examen — cada entrada es liviana a propósito.
    // type ejemplos: "started", "tab_hidden", "tab_visible", "answer_saved",
    // "flag_toggled", "time_warning_shown", "submitted", "auto_expired".
    events: {
      type: [{
        type:      { type: String, required: true },
        at:        { type: Date, default: Date.now },
        meta:      { type: mongoose.Schema.Types.Mixed, default: {} },
      }],
      default: [],
    },
  },
  { timestamps: true }
);

certificationRecordSchema.index({ userId: 1, certId: 1, createdAt: -1 });

module.exports = mongoose.model("CertificationRecord", certificationRecordSchema);