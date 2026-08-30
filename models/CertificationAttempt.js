const mongoose = require("mongoose");

// Un intento representa UNA rendición del examen. Solo puede haber un
// intento con status "in_progress" por usuario+certId a la vez — eso es lo
// que impide "empezarlo y seguirlo al otro día": si expira, se cierra
// automáticamente como "failed" la próxima vez que se consulta.
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

    // { "1": 2, "3": 0, ... } — questionId (string) → índice de opción elegida
    answers: { type: mongoose.Schema.Types.Mixed, default: {} },

    // ids de preguntas que el alumno marcó para revisar antes de enviar
    flagged: { type: [Number], default: [] },

    score:        { type: Number, default: null },
    correctCount: { type: Number, default: null },
    completedAt:  { type: Date, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model("CertificationAttempt", certificationAttemptSchema);