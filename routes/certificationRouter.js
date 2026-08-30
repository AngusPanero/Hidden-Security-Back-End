const express = require("express");
const certificationRouter = express.Router();
const CertificationAttempt = require("../models/CertificationAttempt");
const CertificationRecord  = require("../models/CertificationRecord");
const verifyToken    = require("../middleware/authMiddleware");
const auth            = require("../config/firebase");
const { CERTIFICATIONS } = require("../config/certifications");

const esProduccion = process.env.NODE_ENV === "production";

// Motivos de violación aceptados — mantiene el string libre acotado a algo
// controlado, en vez de dejar que el frontend mande cualquier texto.
const VALID_VIOLATION_REASONS = [
  "second_monitor_connected",
  "duplicate_tab_detected",
];

function getCert(certId, res) {
  const cert = CERTIFICATIONS[certId];
  if (!cert) { res.status(400).json({ message: "Certificación no válida" }); return null; }
  return cert;
}

function sanitizeQuestions(cert) {
  return cert.questions.map(q => ({
    id: q.id, moduleId: q.moduleId, question: q.question, options: q.options,
  }));
}

function attemptPublicPayload(cert, attempt) {
  return {
    attemptId: attempt._id,
    questions: sanitizeQuestions(cert),
    modules:   cert.modules,
    expiresAt: attempt.expiresAt,
    answers:   attempt.answers,
    flagged:   attempt.flagged,
    passingScore:               cert.passingScore,
    timeWarningEnabled:         cert.timeWarningEnabled,
    timeWarningPercent:         cert.timeWarningPercent,
    timeWarningDurationSeconds: cert.timeWarningDurationSeconds,
    timeLimitMinutes:           cert.timeLimitMinutes,
    showConfetti:               cert.showConfetti,
    confettiColors:             cert.confettiColors,
  };
}

async function consumeVoucher(uid) {
  const userRecord    = await auth.getUser(uid);
  const currentClaims = userRecord.customClaims || {};
  const purchases       = Array.isArray(currentClaims.purchases) ? [...currentClaims.purchases] : [];

  const idx = purchases.indexOf("voucher");
  if (idx === -1) throw new Error("NO_VOUCHER");
  purchases.splice(idx, 1);

  await auth.setCustomUserClaims(uid, { ...currentClaims, purchases });
}

async function refundVoucher(uid) {
  try {
    const userRecord    = await auth.getUser(uid);
    const currentClaims = userRecord.customClaims || {};
    const purchases       = Array.isArray(currentClaims.purchases) ? [...currentClaims.purchases, "voucher"] : ["voucher"];
    await auth.setCustomUserClaims(uid, { ...currentClaims, purchases });
  } catch (err) {
    console.error("refundVoucher error:", err.message);
  }
}

async function logEvent(attemptId, type, meta = {}) {
  try {
    await CertificationRecord.updateOne(
      { attemptId },
      { $push: { events: { type, meta, at: new Date() } } }
    );
  } catch (err) {
    console.error("logEvent error:", err.message);
  }
}

async function closeIfExpired(attempt, cert) {
  if (attempt.status !== "in_progress") return attempt;
  if (attempt.expiresAt > new Date()) return attempt;

  attempt.status       = "failed";
  attempt.completedAt  = new Date();
  attempt.score         = 0;
  attempt.correctCount  = 0;
  await attempt.save();

  await CertificationRecord.updateOne(
    { attemptId: attempt._id },
    {
      $set: {
        result:          "expired",
        completedAt:      attempt.completedAt,
        score:             0,
        correctCount:      0,
        durationSeconds:   Math.round((attempt.completedAt - attempt.startedAt) / 1000),
      },
      $push: { events: { type: "auto_expired", at: new Date() } },
    }
  );

  return attempt;
}

// ─── GET /api/certification/:certId/status ────────────────────────────────────
certificationRouter.get("/api/certification/:certId/status", verifyToken, async (req, res) => {
  try {
    const { certId } = req.params;
    const cert = getCert(certId, res);
    if (!cert) return;

    let attempt = await CertificationAttempt.findOne({
      userId: req.user.uid, certId, status: "in_progress",
    });

    if (!attempt) return res.json({ inProgress: false });

    attempt = await closeIfExpired(attempt, cert);
    if (attempt.status !== "in_progress") {
      return res.json({ inProgress: false, expired: true });
    }

    res.json({ inProgress: true, ...attemptPublicPayload(cert, attempt) });
  } catch (err) {
    console.error(esProduccion ? "Error GET /status" : `Error GET /status: ${err}`);
    res.status(500).json({ message: "Error al obtener estado del examen" });
  }
});

// ─── GET /api/certification/:certId/history ───────────────────────────────────
certificationRouter.get("/api/certification/:certId/history", verifyToken, async (req, res) => {
  try {
    const { certId } = req.params;
    if (!CERTIFICATIONS[certId]) return res.status(400).json({ message: "Certificación no válida" });

    const records = await CertificationRecord.find(
      { userId: req.user.uid, certId },
      { events: 0 }
    ).sort({ createdAt: -1 }).lean();

    res.json({ data: records });
  } catch (err) {
    console.error(esProduccion ? "Error GET /history" : `Error GET /history: ${err}`);
    res.status(500).json({ message: "Error al obtener historial" });
  }
});

// ─── POST /api/certification/:certId/start ────────────────────────────────────
certificationRouter.post("/api/certification/:certId/start", verifyToken, async (req, res) => {
  try {
    const { certId } = req.params;
    const uid = req.user.uid;
    const cert = getCert(certId, res);
    if (!cert) return;

    let existing = await CertificationAttempt.findOne({ userId: uid, certId, status: "in_progress" });
    if (existing) {
      existing = await closeIfExpired(existing, cert);
      if (existing.status === "in_progress") {
        return res.json(attemptPublicPayload(cert, existing));
      }
    }

    const userRecord = await auth.getUser(uid);
    const claims      = userRecord.customClaims || {};
    const purchases    = Array.isArray(claims.purchases) ? claims.purchases : [];

    if (!purchases.includes("voucher")) {
      return res.status(403).json({
        message: "SIN_VOUCHER_DISPONIBLE",
        detail:  "No tenés un voucher disponible para rendir esta certificación.",
        code:    "NO_VOUCHER",
      });
    }

    await consumeVoucher(uid);

    const now       = new Date();
    const expiresAt = new Date(now.getTime() + cert.timeLimitMinutes * 60 * 1000);

    let attempt;
    try {
      attempt = await CertificationAttempt.create({
        userId: uid, certId, status: "in_progress", startedAt: now, expiresAt,
      });

      await CertificationRecord.create({
        userId: uid, certId,
        attemptId: attempt._id,
        startedAt: now,
        result: "failed", // placeholder — se sobreescribe siempre antes de leerse como final
        totalQuestions:    cert.totalQuestions,
        passingScoreUsed:  cert.passingScore,
        events: [{ type: "started", at: now }],
      });
    } catch (createErr) {
      await refundVoucher(uid);
      throw createErr;
    }

    res.status(201).json(attemptPublicPayload(cert, attempt));
  } catch (err) {
    console.error(esProduccion ? "Error POST /start" : `Error POST /start: ${err}`);
    res.status(500).json({ message: "Error al iniciar el examen" });
  }
});

// ─── PATCH /api/certification/:certId/answer ──────────────────────────────────
certificationRouter.patch("/api/certification/:certId/answer", verifyToken, async (req, res) => {
  try {
    const { certId } = req.params;
    const { questionId, selected, flagged } = req.body;
    const cert = getCert(certId, res);
    if (!cert) return;

    if (typeof questionId !== "number" || !cert.questions.some(q => q.id === questionId)) {
      return res.status(400).json({ message: "questionId inválido" });
    }

    let attempt = await CertificationAttempt.findOne({ userId: req.user.uid, certId, status: "in_progress" });
    if (!attempt) return res.status(404).json({ message: "No hay un examen en curso" });

    attempt = await closeIfExpired(attempt, cert);
    if (attempt.status !== "in_progress") {
      return res.status(410).json({ message: "El tiempo del examen expiró" });
    }

    if (selected !== undefined) {
      if (typeof selected !== "number" || selected < 0) {
        return res.status(400).json({ message: "selected inválido" });
      }
      attempt.answers = { ...attempt.answers, [String(questionId)]: selected };
      logEvent(attempt._id, "answer_saved", { questionId, selected });
    }

    if (typeof flagged === "boolean") {
      const set = new Set(attempt.flagged);
      if (flagged) set.add(questionId); else set.delete(questionId);
      attempt.flagged = [...set];
      logEvent(attempt._id, "flag_toggled", { questionId, flagged });
    }

    await attempt.save();
    res.json({ answers: attempt.answers, flagged: attempt.flagged });
  } catch (err) {
    console.error(esProduccion ? "Error PATCH /answer" : `Error PATCH /answer: ${err}`);
    res.status(500).json({ message: "Error al guardar respuesta" });
  }
});

// ─── POST /api/certification/:certId/event ────────────────────────────────────
certificationRouter.post("/api/certification/:certId/event", verifyToken, async (req, res) => {
  try {
    const { certId } = req.params;
    const { type, meta } = req.body;
    if (!CERTIFICATIONS[certId]) return res.status(400).json({ message: "Certificación no válida" });
    if (typeof type !== "string" || !type.trim()) return res.status(400).json({ message: "type requerido" });

    const attempt = await CertificationAttempt.findOne({ userId: req.user.uid, certId, status: "in_progress" });
    if (!attempt) return res.status(404).json({ message: "No hay un examen en curso" });

    await logEvent(attempt._id, type, meta || {});
    res.json({ ok: true });
  } catch (err) {
    console.error(esProduccion ? "Error POST /event" : `Error POST /event: ${err}`);
    res.status(500).json({ message: "Error al registrar evento" });
  }
});

// ─── POST /api/certification/:certId/violation ────────────────────────────────
// Cancela el examen de forma inmediata por una infracción de integridad
// (ej: segundo monitor no desconectado dentro de los 30s de gracia). A
// diferencia de /submit, acá NO se corrigen respuestas — el resultado se
// fuerza a "failed" con un motivo registrado, y el intento se cierra.
// El voucher NO se reembolsa: la infracción es responsabilidad del alumno,
// no un error del sistema (a diferencia de una falla técnica nuestra).
certificationRouter.post("/api/certification/:certId/violation", verifyToken, async (req, res) => {
  try {
    const { certId } = req.params;
    const { reason } = req.body;
    const cert = getCert(certId, res);
    if (!cert) return;

    if (!VALID_VIOLATION_REASONS.includes(reason)) {
      return res.status(400).json({ message: "Motivo de violación inválido" });
    }

    const attempt = await CertificationAttempt.findOne({ userId: req.user.uid, certId, status: "in_progress" });
    if (!attempt) return res.status(404).json({ message: "No hay un examen en curso" });

    const completedAt = new Date();

    attempt.status             = "failed";
    attempt.score               = 0;
    attempt.correctCount        = 0;
    attempt.completedAt         = completedAt;
    attempt.terminationReason   = reason;
    await attempt.save();

    await CertificationRecord.updateOne(
      { attemptId: attempt._id },
      {
        $set: {
          result:             "violation",
          terminationReason:   reason,
          completedAt,
          score:                0,
          correctCount:         0,
          durationSeconds:      Math.round((completedAt - attempt.startedAt) / 1000),
        },
        $push: { events: { type: "violation", at: completedAt, meta: { reason } } },
      }
    );

    res.json({ suspended: true, reason });
  } catch (err) {
    console.error(esProduccion ? "Error POST /violation" : `Error POST /violation: ${err}`);
    res.status(500).json({ message: "Error al procesar la violación de integridad" });
  }
});

// ─── POST /api/certification/:certId/submit ───────────────────────────────────
certificationRouter.post("/api/certification/:certId/submit", verifyToken, async (req, res) => {
  try {
    const { certId } = req.params;
    const cert = getCert(certId, res);
    if (!cert) return;

    let attempt = await CertificationAttempt.findOne({ userId: req.user.uid, certId, status: "in_progress" });
    if (!attempt) return res.status(404).json({ message: "No hay un examen en curso" });

    const expired = attempt.expiresAt <= new Date();

    let correct = 0;
    cert.questions.forEach(q => {
      const given = attempt.answers[String(q.id)];
      if (given === q.answer) correct++;
    });

    const score  = correct / cert.totalQuestions;
    const passed = !expired && score >= cert.passingScore;
    const completedAt = new Date();

    attempt.status       = passed ? "passed" : "failed";
    attempt.score         = score;
    attempt.correctCount  = correct;
    attempt.completedAt   = completedAt;
    await attempt.save();

    await CertificationRecord.updateOne(
      { attemptId: attempt._id },
      {
        $set: {
          result:            expired ? "expired" : (passed ? "passed" : "failed"),
          completedAt,
          score,
          correctCount:       correct,
          durationSeconds:    Math.round((completedAt - attempt.startedAt) / 1000),
        },
        $push: { events: { type: "submitted", at: completedAt, meta: { expired } } },
      }
    );

    res.json({
      passed, score, correct, total: cert.totalQuestions,
      passingScore: cert.passingScore, expired,
      showConfetti: passed && cert.showConfetti,
      confettiColors: cert.confettiColors,
    });
  } catch (err) {
    console.error(esProduccion ? "Error POST /submit" : `Error POST /submit: ${err}`);
    res.status(500).json({ message: "Error al finalizar el examen" });
  }
});

module.exports = certificationRouter;