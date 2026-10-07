const mongoose = require("mongoose");

// Un intento representa UNA rendición del examen. Solo puede haber un
// intento con status "in_progress" por usuario+certId a la vez — eso es lo
// que impide "empezarlo y seguirlo al otro día": si expira, se cierra
// automáticamente (se corrige con lo respondido) la próxima vez que se consulta.

// Una pregunta del examen armado para ESTE intento. El orden es aleatorio por
// intento y lo decide el servidor al hacer /start — nunca viene del front.
const sequenceItemSchema = new mongoose.Schema(
  {
    qid:       { type: String, required: true },                         // id (uuid) de la pregunta en el banco
    kind:      { type: String, enum: ["sjt", "exp", "ind"], required: true },
    caseId:    { type: String, default: null },                          // solo preguntas de caso
    posInCase: { type: Number, default: null },                          // 1..5 dentro del caso
  },
  { _id: false }
);

const certificationAttemptSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, index: true },
    certId: { type: String, required: true },

    status: {
      type: String,
      enum: ["in_progress", "passed", "failed"],
      default: "in_progress",
    },

    startedAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },

    // ── Examen armado por el servidor ─────────────────────────────────────
    // Las 80 preguntas sorteadas para este intento, en el orden en que se rinden.
    sequence: { type: [sequenceItemSchema], default: [] },

    // { qid: [2, 0, 3, 1] } — posición en pantalla → índice real de la opción.
    // El front solo conoce posiciones de pantalla; la traducción vive acá.
    optionOrder: { type: mongoose.Schema.Types.Mixed, default: {} },

    // ── Navegación (solo hacia adelante, controlada por el servidor) ──────
    // "exam": respondiendo en orden. "review": llegó al final y solo puede
    // volver a las preguntas que había marcado.
    phase:        { type: String, enum: ["exam", "review"], default: "exam" },
    currentIndex: { type: Number, default: 0 },
    reviewQueue:  { type: [String], default: [] }, // marcadas al llegar al final
    reviewIndex:  { type: Number, default: 0 },

    // { "<qid>": [1], "<qid>": [0, 3], ... } — qid → índices REALES elegidos
    // (array porque hay preguntas de selección múltiple)
    answers: { type: mongoose.Schema.Types.Mixed, default: {} },

    // qids (uuid) de preguntas que el alumno marcó para revisar antes de enviar
    flagged: { type: [String], default: [] },

    // score = puntos obtenidos / puntos posibles (ponderado, con crédito parcial)
    score:        { type: Number, default: null },
    pointsEarned: { type: Number, default: null },
    maxPoints:    { type: Number, default: null },
    correctCount: { type: Number, default: null }, // respuestas con puntaje completo
    completedAt:  { type: Date, default: null },

    // Motivo de cierre: "submitted", "time_expired", "legacy_engine" o una
    // violación de integridad (ej: "second_monitor_connected").
    terminationReason: { type: String, default: null },
  },
  { timestamps: true, minimize: false }
);

certificationAttemptSchema.index({ userId: 1, certId: 1, status: 1 });

module.exports = mongoose.model("CertificationAttempt", certificationAttemptSchema);