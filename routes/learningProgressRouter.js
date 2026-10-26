const express = require("express");
const auth = require("../config/firebase");
const courseProgressSchema = require("../models/CourseSchema");
const CertificationRecord = require("../models/CertificationRecord");
const CertificationAttempt = require("../models/CertificationAttempt");
const { COURSES } = require("../config/courses");
const { CERTIFICATIONS } = require("../config/certifications");
const adminMiddleware = require("../middleware/authMiddleware");

const learningProgressRouter = express.Router();

// ─── Nombres visibles (fallback si la config no trae title/name) ─────────────
const PROGRAM_NAMES = {
  soc1:             "SOC — Modern Operations",
  "modernsoc-cert": "SOC Analyst",
};

// Records del motor de test viejo (5 preguntas) no cuentan: mismo criterio
// que isCurrentExamRecord en certificationRouter.
const MIN_EXAM_QUESTIONS = {
  "modernsoc-cert": 80,
};

// "abandoned" = intento del motor viejo cerrado al migrar (voucher devuelto):
// no fue una rendición real, no se muestra.
const IGNORED_RESULTS = new Set(["abandoned"]);

const DEFAULT_CERT_PASSING = 80;

// ─── Helpers ──────────────────────────────────────────────────────────────────
function isAdminClaims(claims) {
  return !!claims && (claims.admin === true || claims.isAdmin === true);
}

// Normaliza a 0-100: quizzes y examen guardan fracción (0.85); si algún dato
// viejo viene en porcentaje, se respeta. Redondeo a 1 decimal.
function toPct(n) {
  if (typeof n !== "number" || !isFinite(n)) return null;
  const v = n <= 1 ? n * 100 : n;
  return Math.round(Math.max(0, Math.min(100, v)) * 10) / 10;
}

// Nota del examen: puntos ponderados si están, si no el score guardado
function examScore(doc) {
  if (typeof doc.pointsEarned === "number" && typeof doc.maxPoints === "number" && doc.maxPoints > 0) {
    return toPct(doc.pointsEarned / doc.maxPoints);
  }
  return toPct(doc.score);
}

function toIso(d) {
  if (!d) return null;
  const date = d instanceof Date ? d : new Date(d);
  return isNaN(date.getTime()) ? null : date.toISOString();
}

function latestIso(...dates) {
  const times = dates.map(d => (d ? new Date(d).getTime() : 0)).filter(t => t && !isNaN(t));
  return times.length ? new Date(Math.max(...times)).toISOString() : null;
}

const timeOf = d => (d ? new Date(d).getTime() || 0 : 0);

// Firebase permite hasta 100 identificadores por getUsers
async function fetchUsersMap(uids) {
  const map = new Map();
  const unique = [...new Set(uids)].filter(Boolean);
  for (let i = 0; i < unique.length; i += 100) {
    const chunk = unique.slice(i, i + 100).map(uid => ({ uid }));
    const result = await auth.getUsers(chunk);
    for (const u of result.users) {
      map.set(u.uid, { email: u.email || null, displayName: u.displayName || null });
    }
  }
  return map;
}

// ─── Middleware: re-chequear admin contra Firebase ───────────────────────────
// No confiamos en lo que trae el token/cookie: leemos el usuario en vivo.
async function requireFreshAdmin(req, res, next) {
  const uid = req.user?.uid;
  if (!uid) {
    console.error("⚠️ [learningProgress] adminMiddleware no dejó req.user.uid");
    return res.status(401).json({ message: "SESIÓN_INVÁLIDA" });
  }
  try {
    const adminRecord = await auth.getUser(uid);
    if (adminRecord.disabled || !isAdminClaims(adminRecord.customClaims)) {
      return res.status(403).json({ message: "ACCESO_DENEGADO" });
    }
    next();
  } catch (err) {
    console.error("❌ [learningProgress] Error verificando admin:", err.message);
    return res.status(403).json({ message: "ACCESO_DENEGADO" });
  }
}

// ─── Cursos: un documento courseProgressSchema = una inscripción ─────────────
function buildCourseEnrollment(doc) {
  const cfg = COURSES[doc.courseId] || null;
  const totalSteps = cfg?.totalSteps ?? null;
  const quizSteps = Array.isArray(cfg?.quizSteps) ? cfg.quizSteps : [];
  const quizResults = doc.quizResults || {};

  // Solo steps válidos y sin duplicados
  const completed = new Set(
    (doc.completedSteps || []).filter(s => Number.isInteger(s) && s >= 0 && (totalSteps === null || s < totalSteps))
  );

  const progress = doc.isCompleted
    ? 100
    : totalSteps
      ? Math.round((completed.size / totalSteps) * 100)
      : null;

  const quizzes = quizSteps.map((step, i) => {
    const r = quizResults[step] ?? quizResults[String(step)] ?? null;
    return {
      module:   i + 1,
      score:    r ? toPct(r.score) : null,
      passed:   !!r?.passed,
      attempts: Number.isInteger(r?.attempts) ? r.attempts : (r ? 1 : 0),
    };
  });

  const attemptsCount = quizzes.reduce((sum, q) => sum + q.attempts, 0);
  const scored = quizzes.map(q => q.score).filter(s => typeof s === "number");
  // En cursos la "nota" es el promedio de los quizzes rendidos
  const averageScore = scored.length
    ? Math.round((scored.reduce((a, b) => a + b, 0) / scored.length) * 10) / 10
    : null;

  let status = "not_started";
  if (doc.isCompleted) status = "completed";
  else if (completed.size > 0 || attemptsCount > 0) status = "in_progress";

  return {
    uid:            doc.userId,
    programId:      doc.courseId,
    programName:    cfg?.title || cfg?.name || PROGRAM_NAMES[doc.courseId] || doc.courseId,
    kind:           "course",
    status,
    progress,
    modulesDone:    quizzes.filter(q => q.passed).length,
    modulesTotal:   quizzes.length || null,
    attempts:       [],
    attemptsCount,
    quizzes,
    bestScore:      averageScore,
    passingScore:   typeof cfg?.passingScore === "number" ? toPct(cfg.passingScore) : null,
    enrolledAt:     toIso(doc.startedAt || doc.createdAt),
    lastActivityAt: latestIso(doc.updatedAt, doc.completedAt),
  };
}

// ─── Certificaciones ──────────────────────────────────────────────────────────
// Rendiciones terminadas → CertificationRecord (historial permanente).
// Rendición en curso      → CertificationAttempt con status "in_progress".
function isCurrentRecord(r) {
  if (IGNORED_RESULTS.has(r.result)) return false;
  const min = MIN_EXAM_QUESTIONS[r.certId];
  if (min && typeof r.totalQuestions === "number" && r.totalQuestions < min) return false;
  return true;
}

function attemptFromRecord(r) {
  return {
    id:                String(r.attemptId || r._id),
    startedAt:         toIso(r.startedAt || r.createdAt),
    finishedAt:        toIso(r.completedAt || r.updatedAt),
    durationSeconds:   typeof r.durationSeconds === "number" ? r.durationSeconds : null,
    score:             examScore(r),
    passed:            r.result === "passed",
    result:            r.result,                    // passed | failed | expired | violation
    terminationReason: r.terminationReason || null,
    passingScoreUsed:  toPct(r.passingScoreUsed),
  };
}

function attemptFromOpen(a, now) {
  const total = Array.isArray(a.sequence) ? a.sequence.length : 0;
  const expired = timeOf(a.expiresAt) <= now;
  return {
    id:                String(a._id),
    startedAt:         toIso(a.startedAt || a.createdAt),
    // Vencido pero todavía sin cerrar (se corrige en la próxima consulta del alumno)
    finishedAt:        expired ? toIso(a.expiresAt) : null,
    durationSeconds:   null,
    score:             null,
    passed:            false,
    result:            expired ? "pending_close" : "in_progress",
    terminationReason: null,
    expiresAt:         toIso(a.expiresAt),
    answered:          a.answers && typeof a.answers === "object" ? Object.keys(a.answers).length : 0,
    totalQuestions:    total,
    focusStrikes:      a.focusStrikes || 0,
  };
}

function buildCertEnrollment(uid, certId, attempts) {
  const cert = CERTIFICATIONS[certId] || null;
  attempts.sort((a, b) => timeOf(a.startedAt) - timeOf(b.startedAt));

  const scores = attempts.map(a => a.score).filter(s => typeof s === "number");
  const bestScore = scores.length ? Math.max(...scores) : null;

  let status = "not_started";
  if (attempts.some(a => a.passed)) status = "passed";
  else if (attempts.some(a => a.result === "in_progress")) status = "in_progress";
  else if (attempts.length) status = "failed";

  // Nota de aprobación: la que se usó en la última rendición corregida
  const lastGraded = [...attempts].reverse().find(a => typeof a.passingScoreUsed === "number");
  const passingScore =
    lastGraded?.passingScoreUsed ??
    (typeof cert?.passingScore === "number" ? toPct(cert.passingScore) : DEFAULT_CERT_PASSING);

  const first = attempts[0];
  const last = attempts[attempts.length - 1];

  return {
    uid,
    programId:      certId,
    programName:    cert?.title || cert?.name || PROGRAM_NAMES[certId] || certId,
    kind:           "certification",
    status,
    attempts,
    attemptsCount:  attempts.length,
    bestScore,
    passingScore,
    enrolledAt:     first?.startedAt || null,
    lastActivityAt: latestIso(last?.finishedAt, last?.startedAt),
  };
}

// ─── GET /admin/learning-progress ─────────────────────────────────────────────
learningProgressRouter.get("/admin/learning-progress", adminMiddleware, requireFreshAdmin, async (req, res) => {
  try {
    const now = Date.now();

    const [progressDocs, certRecords, openAttempts] = await Promise.all([
      courseProgressSchema.find({})
        .select("userId courseId completedSteps quizResults startedAt completedAt isCompleted createdAt updatedAt")
        .lean(),
      CertificationRecord.find({})
        .select("userId certId attemptId startedAt completedAt result score pointsEarned maxPoints totalQuestions passingScoreUsed durationSeconds terminationReason createdAt updatedAt")
        .lean(),
      CertificationAttempt.find({ status: "in_progress" })
        .select("userId certId startedAt expiresAt sequence.qid answers focusStrikes createdAt")
        .lean(),
    ]);

    const courseEnrollments = progressDocs.map(buildCourseEnrollment);

    // Agrupar por usuario + certificación
    const groups = new Map();
    const push = (userId, certId, attempt) => {
      const key = `${userId}__${certId}`;
      if (!groups.has(key)) groups.set(key, { uid: userId, certId, attempts: [] });
      groups.get(key).attempts.push(attempt);
    };

    // Si un intento abierto ya tiene su record cerrado, manda el record
    const closedAttemptIds = new Set();
    for (const r of certRecords) {
      if (!r.userId || !r.certId || !isCurrentRecord(r)) continue;
      if (r.attemptId) closedAttemptIds.add(String(r.attemptId));
      push(r.userId, r.certId, attemptFromRecord(r));
    }
    for (const a of openAttempts) {
      if (!a.userId || !a.certId || closedAttemptIds.has(String(a._id))) continue;
      push(a.userId, a.certId, attemptFromOpen(a, now));
    }

    const certEnrollments = [...groups.values()].map(g =>
      buildCertEnrollment(g.uid, g.certId, g.attempts)
    );

    const enrollments = [...courseEnrollments, ...certEnrollments];

    // Email y nombre se leen de Firebase (no se guardan en Mongo)
    const users = await fetchUsersMap(enrollments.map(e => e.uid));
    for (const e of enrollments) {
      const u = users.get(e.uid);
      e.email = u?.email || "(usuario eliminado)";
      e.displayName = u?.displayName || null;
    }

    res.set("Cache-Control", "no-store");
    return res.json({ enrollments, generatedAt: new Date(now).toISOString() });
  } catch (err) {
    console.error("❌ [learningProgress] Error armando el progreso:", err);
    return res.status(500).json({ message: "ERROR_PROGRESO" });
  }
});

module.exports = learningProgressRouter;