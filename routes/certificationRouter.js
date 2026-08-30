const express = require("express");
const certificationRouter = express.Router();
const CertificationAttempt = require("../models/CertificationAttempt");
const CertificationRecord  = require("../models/CertificationRecord");
const verifyToken    = require("../middleware/authMiddleware");
const auth            = require("../config/firebase");
const { CERTIFICATIONS } = require("../config/certifications");

const esProduccion = process.env.NODE_ENV === "production";

function getCert(certId, res) {
  const cert = CERTIFICATIONS[certId];
  if (!cert) { res.status(400).json({ message: "Certificación no válida" }); return null; }
  return cert;
}

// Lo único que ve el frontend de cada pregunta — nunca el índice correcto
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

// Saca UNA ocurrencia de "voucher" del array purchases — mismo patrón que
// paymentsRouter.js usa para leer/escribir claims (spread + setCustomUserClaims).
async function consumeVoucher(uid) {
  const userRecord    = await auth.getUser(uid);
  const currentClaims = userRecord.customClaims || {};
  const purchases       = Array.isArray(currentClaims.purchases) ? [...currentClaims.purchases] : [];

  const idx = purchases.indexOf("voucher");
  if (idx === -1) throw new Error("NO_VOUCHER");
  purchases.splice(idx, 1);

  await auth.setCustomUserClaims(uid, { ...currentClaims, purchases });
}

// Si falla la creación del intento después de haber consumido el voucher,
// se lo devolvemos — el alumno no debe perder el ticket por un error nuestro.
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

// Escribe un evento en el CertificationRecord asociado a un attempt — se usa
// desde /answer (guardado silencioso) y desde /event (eventos de UI, como
// cambio de pestaña). No relanza: perder un evento de bitácora no debe
// romper la experiencia del alumno.
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

// Cierra automáticamente un intento vencido como reprobado — es lo que
// impide "empezarlo hoy y seguirlo mañana": si el tiempo pasó, listo.
// También cierra el CertificationRecord correspondiente con result="expired".
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
// Para saber si hay un intento en curso (ej: el alumno refrescó la pantalla
// durante el examen) sin gastar un voucher nuevo.
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
// Historial de rendiciones propias — para que el alumno vea sus intentos
// pasados (útil también más adelante para la vista de empresa vía otro router).
certificationRouter.get("/api/certification/:certId/history", verifyToken, async (req, res) => {
  try {
    const { certId } = req.params;
    if (!CERTIFICATIONS[certId]) return res.status(400).json({ message: "Certificación no válida" });

    const records = await CertificationRecord.find(
      { userId: req.user.uid, certId },
      { events: 0 } // el detalle de eventos no hace falta para el listado
    ).sort({ createdAt: -1 }).lean();

    res.json({ data: records });
  } catch (err) {
    console.error(esProduccion ? "Error GET /history" : `Error GET /history: ${err}`);
    res.status(500).json({ message: "Error al obtener historial" });
  }
});

// ─── POST /api/certification/:certId/start ────────────────────────────────────
// ⚠️ FIX aplicado: el chequeo de "intento ya en curso" corre ANTES de exigir
// voucher. Antes, requireVoucher se ejecutaba como middleware previo a la
// ruta — así que un alumno que ya gastó su único voucher, empezó el examen
// y refrescó la página, se topaba con un 403 "SIN_VOUCHER_DISPONIBLE" al
// intentar reanudar, aunque solo estuviera continuando algo que ya pagó.
// Ahora: primero se busca si hay un attempt "in_progress" — si lo hay, se
// devuelve directo, sin tocar el voucher. Solo si es un examen realmente
// nuevo se valida y consume el voucher.
certificationRouter.post("/api/certification/:certId/start", verifyToken, async (req, res) => {
  try {
    const { certId } = req.params;
    const uid = req.user.uid;
    const cert = getCert(certId, res);
    if (!cert) return;

    // 1) ¿Hay un intento vigente en curso? Si sí, lo devolvemos tal cual —
    //    esto cubre el refresh de la pantalla de reglas/examen y NO cobra
    //    voucher de nuevo.
    let existing = await CertificationAttempt.findOne({ userId: uid, certId, status: "in_progress" });
    if (existing) {
      existing = await closeIfExpired(existing, cert);
      if (existing.status === "in_progress") {
        return res.json(attemptPublicPayload(cert, existing));
      }
    }

    // 2) Recién acá, si NO hay intento en curso (es un examen nuevo o el
    //    anterior ya se cerró), se exige y consume el voucher.
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

      // Se crea el registro histórico en paralelo al intento — arranca sin
      // resultado, se completa en /submit o cuando closeIfExpired lo cierra.
      await CertificationRecord.create({
        userId: uid, certId,
        attemptId: attempt._id,
        startedAt: now,
        result: "failed", // placeholder hasta que se resuelva — se sobreescribe siempre antes de leerse como final
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
// Guarda cada respuesta (y el flag "marcada para revisar") al toque — así si
// se corta la conexión no se pierde lo ya contestado.
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
// Eventos de integridad del lado del cliente (cambio de pestaña, pérdida de
// foco, warning de tiempo mostrado, etc.) — solo se registran en la bitácora,
// nunca deciden por sí solos aprobar/reprobar (eso lo resuelve /submit con
// las respuestas reales). Sirve para poder auditar después si hace falta.
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