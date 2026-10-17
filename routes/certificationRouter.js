const express = require("express");
const certificationRouter = express.Router();
const CertificationAttempt = require("../models/CertificationAttempt");
const CertificationRecord  = require("../models/CertificationRecord");
const verifyToken     = require("../middleware/authMiddleware");
const auth             = require("../config/firebase");
const { CERTIFICATIONS } = require("../config/certifications");
const engine           = require("../services/socExamEngine");

// Chequeo al arrancar el server: si los modelos son los del motor de test,
// Mongoose descartaría en silencio sequence/optionOrder/etc. y el examen
// rompería DESPUÉS de consumir el voucher. Mejor fallar al bootear.
(function assertModels() {
  const need = {
    CertificationAttempt: [CertificationAttempt, ["sequence", "optionOrder", "phase", "currentIndex", "reviewQueue", "reviewIndex", "pointsEarned", "focusStrikes", "leftAt", "leftTab"]],
    CertificationRecord:  [CertificationRecord,  ["byModule", "certifiedSkill", "claimGrantedAt", "pointsEarned"]],
  };
  const missing = [];
  for (const [name, [model, paths]] of Object.entries(need)) {
    if (!model.schema) continue; // (mocks de test)
    for (const p of paths) if (!model.schema.path(p)) missing.push(`${name}.${p}`);
  }
  const flagged = CertificationAttempt.schema?.path("flagged");
  if (flagged && flagged.caster && flagged.caster.instance !== "String") missing.push("CertificationAttempt.flagged debe ser [String]");
  if (missing.length) {
    throw new Error(`certificationRouter: modelos desactualizados, reemplazá models/CertificationAttempt.js y models/CertificationRecord.js. Falta: ${missing.join(", ")}`);
  }
})();


// Motivos de violación aceptados — mantiene el string libre acotado a algo
// controlado, en vez de dejar que el frontend mande cualquier texto.
const VALID_VIOLATION_REASONS = [
  "second_monitor_connected",
  "duplicate_tab_detected",
  "fullscreen_exit_confirmed", // confirmó los 2 avisos de salir de pantalla completa
  "tab_close_confirmed",       // confirmó los 2 avisos de cerrar la pestaña (Ctrl+W)
];
// "focus_limit_reached" y "tab_closed" NO van en esa lista: los decide solo
// el servidor (/strike y resolveLeftTab), el front no puede mandarlos.

// ── Integridad: salidas del examen ──────────────────────────────────────────
// Salidas permitidas (minimizar, cambiar de ventana/pestaña, salir de pantalla
// completa, capturas, extensiones inyectadas). A la última se cancela.
const MAX_FOCUS_STRIKES  = 2;
const VALID_STRIKE_KINDS = [
  "fullscreen_exit", "tab_hidden", "window_blur", "screenshot", "extension_injected",
];

// Eventos que solo puede escribir el servidor (el front no puede falsificarlos).
const RESERVED_EVENT_TYPES = [
  "started", "submitted", "auto_expired", "violation", "answer_saved",
  "flag_toggled", "review_started", "claim_granted", "claim_grant_failed",
  "focus_strike", "page_reloaded", "page_unloaded", "tab_closed_confirmed",
];

// Margen para la latencia de red: una respuesta/entrega que sale del navegador
// en 00:00:01 no debe rebotar por llegar al servidor 300 ms tarde.
const NETWORK_GRACE_MS = 5000;

function getCert(certId, res) {
  const cert = CERTIFICATIONS[certId];
  if (!cert) { res.status(400).json({ message: "Certificación no válida" }); return null; }
  if (!cert.bank?.blueprint) {
    // Config mal registrada (ej. entrada vieja del motor de test sin banco).
    console.error(`Certificación "${certId}" registrada sin banco: revisá config/certifications/index.js`);
    res.status(500).json({ message: "Certificación mal configurada" });
    return null;
  }
  return cert;
}

function attemptPublicPayload(cert, attempt) {
  return {
    attemptId: attempt._id,
    title:     cert.title,
    expiresAt: attempt.expiresAt,
    serverNow: new Date(),               // para corregir el reloj del cliente
    passingScore:               cert.passingScore,
    totalQuestions:             attempt.sequence.length,
    timeWarningEnabled:         cert.timeWarningEnabled,
    timeWarningPercent:         cert.timeWarningPercent,
    timeWarningDurationSeconds: cert.timeWarningDurationSeconds,
    timeLimitMinutes:           cert.timeLimitMinutes,
    showConfetti:               cert.showConfetti,
    confettiColors:             cert.confettiColors,
    focusStrikes:               attempt.focusStrikes ?? 0, // "SALIDAS 1/3" al retomar
    maxFocusStrikes:            MAX_FOCUS_STRIKES,
    view: engine.buildView(cert.bank, attempt),
  };
}

// ─── Resultado vigente (calculado desde CertificationRecord) ──────────────
// No hay documento aparte: el mejor resultado se deriva del historial.
//   • bestScore = mayor score entre los intentos finalizados
//   • passed    = aprobó en algún intento (reprobar después no lo quita)
// "abandoned" (intentos del motor viejo, con voucher devuelto) no cuenta.
const COUNTED_RESULTS = ["passed", "failed", "expired", "violation"];

// Solo cuentan los records del examen actual (80 preguntas). Los del motor de
// test (5 preguntas, otro mínimo de aprobación) no son un resultado válido de
// esta certificación y no pueden marcarla como aprobada.
const isCurrentExamRecord = (r, cert) => r.totalQuestions === cert.totalQuestions;

function summarizeRecords(records, passingScore) {
  if (!records.length) return null;
  const sorted = [...records].sort((a, b) => new Date(a.completedAt) - new Date(b.completedAt));
  const last = sorted[sorted.length - 1];
  const firstPass = sorted.find(r => r.result === "passed");
  const bestScore = Math.max(0, ...sorted.filter(r => r.result !== "violation").map(r => r.score ?? 0));
  return {
    attempts:      sorted.length,
    passed:        !!firstPass,
    passedAt:      firstPass?.completedAt ?? null,
    bestScore,
    lastScore:     last.score ?? 0,
    lastResult:    last.result,
    lastAttemptAt: last.completedAt,
    passingScore:  passingScore ?? last.passingScoreUsed,
  };
}

async function findCountedRecords(userId, certId) {
  const filter = { userId, result: { $in: COUNTED_RESULTS }, completedAt: { $ne: null } };
  if (certId) filter.certId = certId;
  return CertificationRecord.find(filter, { certId: 1, result: 1, score: 1, completedAt: 1, passingScoreUsed: 1, totalQuestions: 1 }).lean();
}

async function getSummary(userId, certId, cert) {
  const records = (await findCountedRecords(userId, certId)).filter(r => isCurrentExamRecord(r, cert));
  return summarizeRecords(records, cert.passingScore);
}

function resultPayload(cert, record, history = null) {
  const passed = record.result === "passed";
  // history.before === undefined → no sabemos el estado previo (ej. cierre por
  // vencimiento visto desde /status): no se afirma "nuevo mejor" ni "seguía vigente".
  const known  = !!history && history.before !== undefined;
  const before = history?.before ?? null;
  const after  = history?.after ?? null;
  return {
    passed,
    expired:      record.result === "expired" || record.terminationReason === "time_expired",
    score:        record.score,
    correct:      record.correctCount,
    total:        record.totalQuestions,
    passingScore: record.passingScoreUsed,
    byModule:     record.byModule || [],
    certifiedSkill: passed ? record.certifiedSkill : null,
    showConfetti: passed && cert.showConfetti,
    confettiColors: cert.confettiColors,
    // Contexto de reintentos (calculado por el servidor):
    previousBest:      before ? before.bestScore : null,   // mejor % antes de este intento
    bestScore:         after ? after.bestScore : record.score,
    isNewBest:         known && !!after && !!before && after.bestScore > before.bestScore && record.result !== "violation",
    wasCertified:      !!before?.passed,                   // ya estaba aprobado antes de este intento
    certified:         !!after?.passed || passed,          // certificación vigente después del intento
    attempts:          after ? after.attempts : 1,
  };
}

const isExpired = (attempt, graceMs = 0) => attempt.expiresAt.getTime() + graceMs <= Date.now();

async function findInProgress(uid, certId) {
  const attempt = await CertificationAttempt.findOne({ userId: uid, certId, status: "in_progress" });
  if (!attempt || attempt.sequence?.length) return attempt;

  // Intento que quedó abierto con el motor de test (sin examen armado): no se
  // puede continuar con el motor nuevo. Se cierra como "abandoned" y se
  // devuelve el voucher, porque el corte fue del sistema, no del alumno.
  const closed = await CertificationAttempt.findOneAndUpdate(
    { _id: attempt._id, status: "in_progress" },
    { $set: { status: "failed", completedAt: new Date(), terminationReason: "legacy_engine" } },
    { returnDocument: 'after' }
  );
  if (closed) {
    await CertificationRecord.updateOne(
      { attemptId: attempt._id },
      { $set: { result: "abandoned", terminationReason: "legacy_engine", completedAt: closed.completedAt },
        $push: { events: { type: "legacy_attempt_closed", at: new Date(), meta: { voucherRefunded: true } } } }
    );
    await refundVoucher(uid);
  }
  return null;
}

// ─── Vouchers ────────────────────────────────────────────────────────────
async function consumeVoucher(uid) {
  const userRecord    = await auth.getUser(uid);
  const currentClaims = userRecord.customClaims || {};
  const purchases     = Array.isArray(currentClaims.purchases) ? [...currentClaims.purchases] : [];

  const idx = purchases.indexOf("voucher");
  if (idx === -1) throw new Error("NO_VOUCHER");
  purchases.splice(idx, 1);

  await auth.setCustomUserClaims(uid, { ...currentClaims, purchases });
}

async function refundVoucher(uid) {
  try {
    const userRecord    = await auth.getUser(uid);
    const currentClaims = userRecord.customClaims || {};
    const purchases     = Array.isArray(currentClaims.purchases) ? [...currentClaims.purchases, "voucher"] : ["voucher"];
    await auth.setCustomUserClaims(uid, { ...currentClaims, purchases });
  } catch (err) {
    console.error("refundVoucher error:", err.message);
  }
}

// ─── Claim de skill certificada ──────────────────────────────────────────
// Suma la skill a skillsCertifiedByHidden (crea el array si no existe) sin
// pisar el resto de los claims (purchases, etc.).
async function grantCertifiedSkill(uid, skill) {
  const userRecord    = await auth.getUser(uid);
  const currentClaims = userRecord.customClaims || {};
  const existing = Array.isArray(currentClaims.skillsCertifiedByHidden) ? currentClaims.skillsCertifiedByHidden : [];
  if (existing.includes(skill)) return;
  const merged = [...new Set([...existing, skill])];
  await auth.setCustomUserClaims(uid, { ...currentClaims, skillsCertifiedByHidden: merged });
}

// Intenta otorgar el claim y deja constancia en el record. Si Firebase falla,
// el record queda con claimGrantedAt = null y se reintenta en el próximo /status.
async function grantClaimForRecord(record) {
  if (record.result !== "passed" || !record.certifiedSkill || record.claimGrantedAt) return;
  for (let i = 0; i < 3; i++) {
    try {
      await grantCertifiedSkill(record.userId, record.certifiedSkill);
      await CertificationRecord.updateOne(
        { _id: record._id },
        { $set: { claimGrantedAt: new Date() }, $push: { events: { type: "claim_granted", at: new Date(), meta: { skill: record.certifiedSkill } } } }
      );
      return;
    } catch (err) {
      console.error(`grantCertifiedSkill intento ${i + 1}:`, err.message);
      if (i === 2) await logEvent(record.attemptId, "claim_grant_failed", { message: err.message });
      else await new Promise(r => setTimeout(r, 500 * (i + 1)));
    }
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

// ─── Cierre y corrección (único lugar donde se decide aprobar) ───────────
/**
 * Corrige el intento con las respuestas guardadas en el servidor y lo cierra.
 * Es idempotente: si dos requests llegan a la vez (timer + click), solo la
 * que gana el update condicional corrige; la otra recibe el record ya cerrado.
 */
async function finalizeAttempt(cert, attempt, { timedOut = false } = {}) {
  const g = engine.grade(cert.bank, attempt);
  const passed = g.score >= cert.passingScore;
  const completedAt = new Date();
  // Si se agotó el tiempo, el cierre se registra en la hora de vencimiento.
  const effectiveEnd = timedOut ? new Date(Math.min(completedAt, attempt.expiresAt)) : completedAt;

  const closed = await CertificationAttempt.findOneAndUpdate(
    { _id: attempt._id, status: "in_progress" },
    {
      $set: {
        status: passed ? "passed" : "failed",
        score: g.score, pointsEarned: g.pointsEarned, maxPoints: g.maxPoints,
        correctCount: g.correctCount, completedAt: effectiveEnd,
        terminationReason: timedOut ? "time_expired" : "submitted",
      },
    },
    { returnDocument: 'after' }
  );

  let history = null;
  if (closed) {
    // Resultado vigente ANTES de este intento (su record todavía no tiene
    // completedAt, así que no entra en el cálculo).
    const before = await getSummary(attempt.userId, attempt.certId, cert);
    history = { before };

    await CertificationRecord.updateOne(
      { attemptId: attempt._id },
      {
        $set: {
          result: passed ? "passed" : (timedOut ? "expired" : "failed"),
          score: g.score, pointsEarned: g.pointsEarned, maxPoints: g.maxPoints,
          correctCount: g.correctCount, totalQuestions: g.totalQuestions,
          byModule: g.byModule,
          completedAt: effectiveEnd,
          durationSeconds: Math.round((effectiveEnd - attempt.startedAt) / 1000),
          terminationReason: timedOut ? "time_expired" : "submitted",
          certifiedSkill: passed ? cert.certifiedSkill : null,
        },
        $push: { events: { type: timedOut ? "auto_expired" : "submitted", at: completedAt, meta: { score: g.score, passed } } },
      }
    );
  }

  const record = await CertificationRecord.findOne({ attemptId: attempt._id }).lean();
  if (closed && record) history.after = await getSummary(attempt.userId, attempt.certId, cert);
  if (record?.result === "passed") await grantClaimForRecord(record);
  return { record, history };
}

async function closeIfExpired(attempt, cert) {
  if (attempt.status !== "in_progress") return attempt;
  if (!isExpired(attempt, NETWORK_GRACE_MS)) return attempt;
  await finalizeAttempt(cert, attempt, { timedOut: true });
  return CertificationAttempt.findById(attempt._id);
}

// ─── Cierre por violación (único lugar) ──────────────────────────────────
// No corrige respuestas: resultado 0, motivo registrado, voucher NO se
// devuelve. Idempotente: si otro request ya lo cerró, devuelve el actual.
async function closeAsViolation(attempt, reason) {
  const completedAt = new Date();
  const closed = await CertificationAttempt.findOneAndUpdate(
    { _id: attempt._id, status: "in_progress" },
    { $set: { status: "failed", score: 0, correctCount: 0, completedAt, terminationReason: reason } },
    { returnDocument: 'after' }
  );
  if (!closed) return CertificationAttempt.findById(attempt._id);

  await CertificationRecord.updateOne(
    { attemptId: closed._id },
    {
      $set: {
        result:            "violation",
        terminationReason: reason,
        completedAt,
        score:             0,
        correctCount:      0,
        durationSeconds:   Math.round((completedAt - closed.startedAt) / 1000),
      },
      $push: { events: { type: "violation", at: completedAt, meta: { reason } } },
    }
  );
  return closed;
}

// ─── Aviso de cierre de pestaña pendiente (leftAt) ───────────────────────
// El front manda /leave (sendBeacon) cuando la página se descarga DESPUÉS de
// que el alumno confirmó el aviso del navegador. Se decide cuando vuelve:
//  - misma pestaña (recarga)       → sigue, cuenta como salida
//  - otra pestaña / otro navegador → cerró a propósito → violación "tab_closed"
//  - sin aviso (corte de luz)      → no se toca, se retoma normalmente
async function resolveLeftTab(attempt, tab) {
  if (!attempt?.leftAt || attempt.status !== "in_progress") return attempt;
  if (!tab) return attempt; // cliente sin id de pestaña: no se decide nada

  if (attempt.leftTab && tab === attempt.leftTab) {
    const updated = await CertificationAttempt.findOneAndUpdate(
      { _id: attempt._id, status: "in_progress", leftAt: { $ne: null } },
      { $set: { leftAt: null, leftTab: null }, $inc: { focusStrikes: 1 } },
      { returnDocument: 'after' }
    );
    if (!updated) return CertificationAttempt.findById(attempt._id);
    await logEvent(updated._id, "page_reloaded", { strikes: updated.focusStrikes });
    if (updated.focusStrikes >= MAX_FOCUS_STRIKES) return closeAsViolation(updated, "focus_limit_reached");
    return updated;
  }

  await logEvent(attempt._id, "tab_closed_confirmed", { leftAt: attempt.leftAt });
  return closeAsViolation(attempt, "tab_closed");
}

const tabFrom = (v) => String(v || "").slice(0, 64);

// ─── GET /api/certification/:certId/status ───────────────────────────────
certificationRouter.get("/api/certification/:certId/status", verifyToken, async (req, res) => {
  try {
    const { certId } = req.params;
    const cert = getCert(certId, res);
    if (!cert) return;

    // Auto-reparación: si un aprobado quedó sin claim por una falla de Firebase.
    const pending = await CertificationRecord.find(
      { userId: req.user.uid, certId, result: "passed", claimGrantedAt: null }, { events: 0 }
    ).lean();
    for (const r of pending) await grantClaimForRecord(r);

    const previousOf = () => getSummary(req.user.uid, certId, cert);

    let attempt = await findInProgress(req.user.uid, certId);
    // previous = intentos anteriores (para mostrar "ya rendiste" antes de gastar otro voucher)
    if (!attempt) return res.json({ inProgress: false, previous: await previousOf() });

    // Recarga vs. pestaña cerrada a propósito (ver resolveLeftTab)
    attempt = await resolveLeftTab(attempt, tabFrom(req.query.tab));
    if (attempt.status !== "in_progress" && attempt.terminationReason !== "time_expired" && attempt.terminationReason !== "submitted") {
      return res.json({ inProgress: false, suspended: true, reason: attempt.terminationReason, previous: await previousOf() });
    }

    attempt = await closeIfExpired(attempt, cert);
    if (attempt.status !== "in_progress") {
      const record = await CertificationRecord.findOne({ attemptId: attempt._id }).lean();
      const previous = await previousOf();
      return res.json({
        inProgress: false, expired: true, previous,
        result: record ? resultPayload(cert, record, { after: previous }) : null,
      });
    }

    res.json({ inProgress: true, ...attemptPublicPayload(cert, attempt) });
  } catch (err) {
    console.error(esProduccion ? "Error GET /status" : `Error GET /status: ${err}`);
    res.status(500).json({ message: "Error al obtener estado del examen" });
  }
});

// ─── GET /api/certification/summary ──────────────────────────────────────
// Resultado vigente del usuario en TODAS las certificaciones (para el
// catálogo: filtros Rendidas / Aprobadas / No aprobadas y % en cada card).
// Responde { data: { [certId]: summary | null } }.
certificationRouter.get("/api/certification/summary", verifyToken, async (req, res) => {
  try {
    const records = await findCountedRecords(req.user.uid); // una sola consulta para todas
    const data = {};
    for (const [certId, cert] of Object.entries(CERTIFICATIONS)) {
      const summary = summarizeRecords(
        records.filter(r => r.certId === certId && isCurrentExamRecord(r, cert)),
        cert.passingScore
      );
      // Nombre visible + skill que otorga, para badges y modales del front
      data[certId] = summary ? { ...summary, title: cert.title, certifiedSkill: cert.certifiedSkill } : null;
    }
    res.json({ data });
  } catch (err) {
    console.error(esProduccion ? "Error GET /summary" : `Error GET /summary: ${err}`);
    res.status(500).json({ message: "Error al obtener resultados" });
  }
});

// ─── GET /api/certification/my-skills ────────────────────────────────────
// Lee skillsCertifiedByHidden DIRECTO de Firebase (no de la cookie de sesión,
// que puede tener claims viejas). Responde { data: ["SOC Analyst", ...] }.
certificationRouter.get("/api/certification/my-skills", verifyToken, async (req, res) => {
  try {
    const { customClaims = {} } = await auth.getUser(req.user.uid);
    const skills = Array.isArray(customClaims.skillsCertifiedByHidden)
      ? customClaims.skillsCertifiedByHidden.filter(s => typeof s === "string" && s.trim())
      : [];
    res.json({ data: skills });
  } catch (err) {
    console.error(esProduccion ? "Error GET /my-skills" : `Error GET /my-skills: ${err}`);
    res.status(500).json({ message: "Error al obtener skills certificadas" });
  }
});

// ─── GET /api/certification/:certId/history ──────────────────────────────
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

// ─── POST /api/certification/:certId/start ───────────────────────────────
certificationRouter.post("/api/certification/:certId/start", verifyToken, async (req, res) => {
  try {
    const { certId } = req.params;
    const uid = req.user.uid;
    const cert = getCert(certId, res);
    if (!cert) return;

    let existing = await findInProgress(uid, certId);
    if (existing) {
      existing = await resolveLeftTab(existing, tabFrom(req.body?.tab));
      if (existing.status !== "in_progress" && existing.terminationReason !== "time_expired" && existing.terminationReason !== "submitted") {
        // Cerrado por violación: nunca se arranca uno nuevo en silencio (consumiría otro voucher)
        return res.status(409).json({ code: "ATTEMPT_CLOSED", reason: existing.terminationReason });
      }
      existing = await closeIfExpired(existing, cert);
      if (existing.status === "in_progress") {
        return res.json(attemptPublicPayload(cert, existing));
      }
    }

    const userRecord = await auth.getUser(uid);
    const claims     = userRecord.customClaims || {};
    const purchases  = Array.isArray(claims.purchases) ? claims.purchases : [];

    if (!purchases.includes("voucher")) {
      return res.status(403).json({
        message: "SIN_VOUCHER_DISPONIBLE",
        detail:  "No tenés un voucher disponible para rendir esta certificación.",
        code:    "NO_VOUCHER",
      });
    }

    // El examen se arma ANTES de consumir el voucher: si el banco tuviera un
    // problema, falla acá sin cobrarle nada al alumno.
    const plan = engine.buildAttemptPlan(cert.bank);
    if (plan.sequence.length !== cert.totalQuestions) throw new Error("Blueprint inconsistente");

    await consumeVoucher(uid);

    const now       = new Date();
    const expiresAt = new Date(now.getTime() + cert.timeLimitMinutes * 60 * 1000);

    let attempt;
    try {
      attempt = await CertificationAttempt.create({
        userId: uid, certId, status: "in_progress", startedAt: now, expiresAt,
        sequence: plan.sequence, optionOrder: plan.optionOrder,
        phase: "exam", currentIndex: 0, answers: {}, flagged: [],
      });

      await CertificationRecord.create({
        userId: uid, certId,
        attemptId: attempt._id,
        startedAt: now,
        result: "failed", // placeholder — se sobreescribe siempre antes de leerse como final
        totalQuestions:   plan.sequence.length,
        passingScoreUsed: cert.passingScore,
        events: [{ type: "started", at: now, meta: { questionIds: plan.sequence.map(s => s.qid) } }],
      });
    } catch (createErr) {
      if (attempt) await CertificationAttempt.deleteOne({ _id: attempt._id }).catch(() => {});
      await refundVoucher(uid);
      throw createErr;
    }

    // Defensa extra: si el examen no quedó persistido, no se cobra el voucher.
    if (!attempt.sequence?.length) {
      await CertificationAttempt.deleteOne({ _id: attempt._id }).catch(() => {});
      await CertificationRecord.deleteOne({ attemptId: attempt._id }).catch(() => {});
      await refundVoucher(uid);
      throw new Error("El intento se creó sin sequence: revisá el modelo CertificationAttempt");
    }

    res.status(201).json(attemptPublicPayload(cert, attempt));
  } catch (err) {
    console.error(esProduccion ? "Error POST /start" : `Error POST /start: ${err}`);
    res.status(500).json({ message: "Error al iniciar el examen" });
  }
});

// Carga el intento en curso y corta con el status HTTP correcto si no aplica.
async function loadActiveAttempt(req, res, cert) {
  let attempt = await findInProgress(req.user.uid, req.params.certId);
  if (!attempt) { res.status(404).json({ message: "No hay un examen en curso" }); return null; }
  attempt = await closeIfExpired(attempt, cert);
  if (attempt.status !== "in_progress") { res.status(410).json({ message: "El tiempo del examen expiró" }); return null; }
  return attempt;
}

// ¿Puede el alumno tocar esta pregunta ahora? Solo la actual (fase examen) o
// una de las marcadas al llegar al final (fase revisión). Nunca una futura,
// nunca una anterior no marcada.
function editableFilter(attempt, questionId) {
  if (attempt.phase === "exam") {
    const current = attempt.sequence[attempt.currentIndex];
    if (!current || current.qid !== questionId) return null;
    return { phase: "exam", currentIndex: attempt.currentIndex };
  }
  if (attempt.phase === "review" && attempt.reviewQueue.includes(questionId)) {
    return { phase: "review", reviewQueue: questionId };
  }
  return null;
}

// ─── PATCH /api/certification/:certId/answer ─────────────────────────────
// Body: { questionId: string, selected?: number[] (índices de pantalla), flagged?: boolean }
certificationRouter.patch("/api/certification/:certId/answer", verifyToken, async (req, res) => {
  try {
    const cert = getCert(req.params.certId, res);
    if (!cert) return;
    const { questionId, selected, flagged } = req.body;
    if (typeof questionId !== "string") return res.status(400).json({ message: "questionId inválido" });

    const attempt = await loadActiveAttempt(req, res, cert);
    if (!attempt) return;

    const filter = editableFilter(attempt, questionId);
    if (!filter) return res.status(409).json({ message: "Esa pregunta ya no puede modificarse", code: "LOCKED", view: engine.buildView(cert.bank, attempt) });

    const update = {};
    let original;
    if (selected !== undefined) {
      try { original = engine.displayToOriginal(cert.bank, attempt, questionId, selected); }
      catch { return res.status(400).json({ message: "selected inválido" }); }
      update.$set = { [`answers.${questionId}`]: original };
    }
    if (typeof flagged === "boolean") {
      update[flagged ? "$addToSet" : "$pull"] = { flagged: questionId };
    }
    if (!Object.keys(update).length) return res.status(400).json({ message: "Nada para guardar" });

    // Update condicional: si en paralelo se avanzó de pregunta, no se guarda.
    const saved = await CertificationAttempt.findOneAndUpdate(
      { _id: attempt._id, status: "in_progress", ...filter },
      update,
      { returnDocument: 'after' }
    );
    if (!saved) return res.status(409).json({ message: "Esa pregunta ya no puede modificarse", code: "LOCKED" });

    if (original) logEvent(attempt._id, "answer_saved", { questionId, selected: original, phase: attempt.phase });
    if (typeof flagged === "boolean") logEvent(attempt._id, "flag_toggled", { questionId, flagged });

    res.json({ view: engine.buildView(cert.bank, saved) });
  } catch (err) {
    console.error(esProduccion ? "Error PATCH /answer" : `Error PATCH /answer: ${err}`);
    res.status(500).json({ message: "Error al guardar respuesta" });
  }
});

// ─── POST /api/certification/:certId/next ────────────────────────────────
// Avanza a la siguiente pregunta (sin vuelta atrás). Body: { questionId }
// Requiere que la actual esté respondida o marcada para revisar.
certificationRouter.post("/api/certification/:certId/next", verifyToken, async (req, res) => {
  try {
    const cert = getCert(req.params.certId, res);
    if (!cert) return;
    const { questionId } = req.body;

    const attempt = await loadActiveAttempt(req, res, cert);
    if (!attempt) return;

    const current = attempt.sequence[attempt.currentIndex];
    // Idempotencia: un doble click no debe saltear una pregunta.
    if (attempt.phase !== "exam" || current?.qid !== questionId) {
      return res.json({ view: engine.buildView(cert.bank, attempt) });
    }
    if (!engine.isAnswered(attempt, current.qid) && !attempt.flagged.includes(current.qid)) {
      return res.status(400).json({ message: "Respondé la pregunta o marcala para revisar antes de avanzar", code: "UNANSWERED" });
    }

    const isLast = attempt.currentIndex >= attempt.sequence.length - 1;
    const update = isLast
      ? { $set: { phase: "review", reviewQueue: [...attempt.flagged], reviewIndex: 0 } }
      : { $inc: { currentIndex: 1 } };

    const saved = await CertificationAttempt.findOneAndUpdate(
      { _id: attempt._id, status: "in_progress", phase: "exam", currentIndex: attempt.currentIndex },
      update,
      { returnDocument: 'after' }
    );
    const fresh = saved || await CertificationAttempt.findById(attempt._id);
    if (saved && isLast) logEvent(attempt._id, "review_started", { flagged: attempt.flagged.length });

    res.json({ view: engine.buildView(cert.bank, fresh) });
  } catch (err) {
    console.error(esProduccion ? "Error POST /next" : `Error POST /next: ${err}`);
    res.status(500).json({ message: "Error al avanzar" });
  }
});

// ─── POST /api/certification/:certId/review/goto ─────────────────────────
// Navega entre las preguntas marcadas durante la revisión final. Body: { index }
certificationRouter.post("/api/certification/:certId/review/goto", verifyToken, async (req, res) => {
  try {
    const cert = getCert(req.params.certId, res);
    if (!cert) return;
    const { index } = req.body;

    const attempt = await loadActiveAttempt(req, res, cert);
    if (!attempt) return;
    if (attempt.phase !== "review") return res.status(409).json({ message: "La revisión todavía no empezó" });
    if (!Number.isInteger(index) || index < 0 || index >= attempt.reviewQueue.length) {
      return res.status(400).json({ message: "index inválido" });
    }

    const saved = await CertificationAttempt.findOneAndUpdate(
      { _id: attempt._id, status: "in_progress", phase: "review" },
      { $set: { reviewIndex: index } },
      { returnDocument: 'after' }
    );
    res.json({ view: engine.buildView(cert.bank, saved || attempt) });
  } catch (err) {
    console.error(esProduccion ? "Error POST /review/goto" : `Error POST /review/goto: ${err}`);
    res.status(500).json({ message: "Error al navegar la revisión" });
  }
});

// ─── POST /api/certification/:certId/event ───────────────────────────────
certificationRouter.post("/api/certification/:certId/event", verifyToken, async (req, res) => {
  try {
    const { certId } = req.params;
    const { type, meta } = req.body;
    if (!CERTIFICATIONS[certId]) return res.status(400).json({ message: "Certificación no válida" });
    if (typeof type !== "string" || !type.trim() || type.length > 64) return res.status(400).json({ message: "type inválido" });
    const safeMeta = meta && typeof meta === "object" && JSON.stringify(meta).length <= 2048 ? meta : {};

    const attempt = await findInProgress(req.user.uid, certId);
    if (!attempt) return res.status(404).json({ message: "No hay un examen en curso" });

    if (RESERVED_EVENT_TYPES.includes(type)) return res.status(400).json({ message: "type reservado" });
    await logEvent(attempt._id, type, safeMeta);
    res.json({ ok: true });
  } catch (err) {
    console.error(esProduccion ? "Error POST /event" : `Error POST /event: ${err}`);
    res.status(500).json({ message: "Error al registrar evento" });
  }
});

// ─── POST /api/certification/:certId/violation ───────────────────────────
// Cancela el examen de forma inmediata por una infracción de integridad
// (ej: segundo monitor no desconectado dentro de los 30s de gracia). A
// diferencia de /submit, acá NO se corrigen respuestas — el resultado se
// fuerza a "violation" con un motivo registrado, y el intento se cierra.
// El voucher NO se reembolsa: la infracción es responsabilidad del alumno.
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

    await closeAsViolation(attempt, reason);
    res.json({ suspended: true, reason });
  } catch (err) {
    console.error(esProduccion ? "Error POST /violation" : `Error POST /violation: ${err}`);
    res.status(500).json({ message: "Error al procesar la violación de integridad" });
  }
});

// ─── POST /api/certification/:certId/strike ──────────────────────────────
// Una salida del examen. El contador vive en el servidor (recargar no lo
// resetea) y a la última se cancela acá mismo, sin depender del front.
// Body: { kind }
certificationRouter.post("/api/certification/:certId/strike", verifyToken, async (req, res) => {
  try {
    const { certId } = req.params;
    const cert = getCert(certId, res);
    if (!cert) return;

    const kind = VALID_STRIKE_KINDS.includes(req.body?.kind) ? req.body.kind : "unknown";

    const attempt = await loadActiveAttempt(req, res, cert);
    if (!attempt) return;

    const updated = await CertificationAttempt.findOneAndUpdate(
      { _id: attempt._id, status: "in_progress" },
      { $inc: { focusStrikes: 1 } },
      { returnDocument: 'after' }
    );
    if (!updated) return res.status(410).json({ message: "El examen ya no está en curso" });

    await logEvent(updated._id, "focus_strike", { kind, strikes: updated.focusStrikes });

    if (updated.focusStrikes >= MAX_FOCUS_STRIKES) {
      await closeAsViolation(updated, "focus_limit_reached");
      return res.json({
        strikes: updated.focusStrikes, limit: MAX_FOCUS_STRIKES,
        terminated: true, reason: "focus_limit_reached",
      });
    }

    res.json({ strikes: updated.focusStrikes, limit: MAX_FOCUS_STRIKES, terminated: false });
  } catch (err) {
    console.error(esProduccion ? "Error POST /strike" : `Error POST /strike: ${err}`);
    res.status(500).json({ message: "Error al registrar la salida" });
  }
});

// ─── POST /api/certification/:certId/leave ───────────────────────────────
// Lo manda navigator.sendBeacon al descargarse la página, DESPUÉS de que el
// alumno confirmó el aviso del navegador (cerrar pestaña, Alt+F4, recargar).
// Solo deja la marca: qué pasó se decide cuando vuelve (resolveLeftTab).
// Llega como text/plain para evitar el preflight de CORS del beacon.
certificationRouter.post(
  "/api/certification/:certId/leave",
  express.text({ type: "*/*", limit: "1kb" }),
  verifyToken,
  async (req, res) => {
    try {
      let tab = "";
      try {
        const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
        tab = tabFrom(body.tab);
      } catch { /* body inválido */ }
      if (!tab) return res.status(204).end();

      const attempt = await CertificationAttempt.findOneAndUpdate(
        { userId: req.user.uid, certId: req.params.certId, status: "in_progress" },
        { $set: { leftAt: new Date(), leftTab: tab } },
        { returnDocument: 'after' }
      );
      if (attempt) await logEvent(attempt._id, "page_unloaded", { tab });
      res.status(204).end();
    } catch (err) {
      console.error(esProduccion ? "Error POST /leave" : `Error POST /leave: ${err}`);
      res.status(204).end(); // el navegador ignora la respuesta del beacon
    }
  }
);

// ─── POST /api/certification/:certId/submit ──────────────────────────────
// No recibe NADA del front: corrige con las respuestas guardadas en el servidor.
certificationRouter.post("/api/certification/:certId/submit", verifyToken, async (req, res) => {
  try {
    const { certId } = req.params;
    const cert = getCert(certId, res);
    if (!cert) return;

    const attempt = await findInProgress(req.user.uid, certId);
    if (!attempt) {
      // El intento ya se cerró antes de este request: el timer y el botón
      // dispararon a la vez, o una respuesta/avance llegó vencida y el servidor
      // ya lo corrigió (closeIfExpired). Se devuelve el resultado del ÚLTIMO
      // intento de esta certificación.
      // (Antes se buscaba por completedAt de los últimos 10 min, pero al vencer
      // completedAt se registra en la hora de vencimiento, así que el resultado
      // ya calificado podía quedar afuera y el alumno veía un error.)
      const lastAttempt = await CertificationAttempt.findOne(
        { userId: req.user.uid, certId }, { _id: 1, terminationReason: 1 }
      ).sort({ startedAt: -1 }).lean();
      const last = lastAttempt && await CertificationRecord.findOne(
        { attemptId: lastAttempt._id, completedAt: { $ne: null } }, { events: 0 }
      ).lean();

      if (last && ["passed", "failed", "expired"].includes(last.result)) {
        const after = await getSummary(req.user.uid, certId, cert);
        return res.json(resultPayload(cert, last, { after }));
      }
      if (last && last.result === "violation") {
        return res.status(409).json({ code: "ATTEMPT_CLOSED", reason: last.terminationReason });
      }
      return res.status(404).json({ message: "No hay un examen en curso" });
    }

    const timedOut = isExpired(attempt, NETWORK_GRACE_MS);
    const { record, history } = await finalizeAttempt(cert, attempt, { timedOut });
    res.json(resultPayload(cert, record, history));
  } catch (err) {
    console.error(esProduccion ? "Error POST /submit" : `Error POST /submit: ${err}`);
    res.status(500).json({ message: "Error al finalizar el examen" });
  }
});

module.exports = certificationRouter;