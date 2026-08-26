const express        = require("express");
const courseRouter   = express.Router();
const CourseProgress = require("../models/CourseSchema");
const verifyToken    = require("../middleware/authMiddleware");
const auth           = require("../config/firebase");
const { COURSES, VALID_COURSE_IDS } = require("../config/courses");

const esProduccion = process.env.NODE_ENV === "production";

// ─── Middleware: verificar plan activo ────────────────────────────────────────
async function requireActivePlan(req, res, next) {
  try {
    const uid        = req.user.uid;
    const userRecord = await auth.getUser(uid);
    const claims     = userRecord.customClaims || {};

    const purchases      = Array.isArray(claims.purchases) ? claims.purchases : [];
    const purchaseExpiry = claims.purchaseExpiry || {};
    const now            = new Date();

    const USER_PLANS    = ["starter", "pro", "elite"];
    const hasActivePlan = USER_PLANS.some(planId => {
      if (!purchases.includes(planId)) return false;
      const expiryStr = purchaseExpiry[planId];
      if (!expiryStr) return false;
      return new Date(expiryStr) > now;
    });

    if (!hasActivePlan) {
      return res.status(403).json({
        message: "SIN_MEMBRESÍA_ACTIVA",
        detail:  "Necesitás una membresía activa para acceder al contenido del curso.",
        code:    "NO_ACTIVE_MEMBERSHIP",
      });
    }

    req.userClaims = claims;
    next();
  } catch (err) {
    console.error("requireActivePlan error:", err.message);
    res.status(500).json({ message: "Error verificando membresía" });
  }
}

// ─── Helper: validar courseId contra whitelist ────────────────────────────────
function getCourse(courseId, res) {
  if (!VALID_COURSE_IDS.includes(courseId)) {
    res.status(400).json({ message: "Curso no válido" });
    return null;
  }
  return COURSES[courseId];
}

// ─── Helper: otorgar la claim de "usuario certificado" al completar un curso ──
// Es un booleano — a diferencia del árbol de skills, esto SÍ entra sin
// problema dentro del límite de 1000 bytes de Firebase custom claims, así
// que no hace falta derivarlo desde Mongo en cada request. Se escribe una
// sola vez, en el momento exacto de la transición a completado.
// Otras partes de la plataforma (certifiedMiddleware) dependen de esta
// claim para gatear funcionalidad del lado del alumno (aplicar a vacantes,
// ver notificaciones, etc.) — no confundir con el campo "userCertificated"
// que arma usersDatabaseRouter.js en su respuesta JSON, que es un valor
// calculado a partir de skillsCertifiedByHidden y significa algo distinto
// ("tiene al menos una skill certificada por examen").
async function grantCertifiedClaim(uid) {
  try {
    const userRecord    = await auth.getUser(uid);
    const currentClaims = userRecord.customClaims || {};

    // Ya la tenía — no hacemos un write innecesario a Firebase
    if (currentClaims.userCertificated === true) return;

    await auth.setCustomUserClaims(uid, {
      ...currentClaims,
      userCertificated: true,
    });

    console.log(`✅ Claim "userCertificated" activada para ${uid}`);
  } catch (err) {
    // No relanzamos: si falla la claim, el progreso del curso ya se guardó
    // correctamente en Mongo. Queda logueado para revisar manualmente.
    console.error(`Error otorgando claim userCertificated para ${uid}:`, err.message);
  }
}

// ─── GET /api/course/:courseId/progress ──────────────────────────────────────
courseRouter.get("/api/course/:courseId/progress", verifyToken, requireActivePlan, async (req, res) => {
  try {
    const { courseId } = req.params;
    const userId       = req.user.uid;

    const course = getCourse(courseId, res);
    if (!course) return;

    let progress = await CourseProgress.findOne({ userId, courseId });
    if (!progress) {
      progress = await CourseProgress.create({ userId, courseId });
    }

    res.json({ data: progress });
  } catch (err) {
    console.error(esProduccion ? "Error GET progress" : `Error GET progress: ${err}`);
    res.status(500).json({ message: "Error al obtener progreso" });
  }
});

// ─── PATCH /api/course/:courseId/progress/step ───────────────────────────────
courseRouter.patch("/api/course/:courseId/progress/step", verifyToken, requireActivePlan, async (req, res) => {
  try {
    const { courseId } = req.params;
    const userId       = req.user.uid;
    const { stepIndex } = req.body;

    const course = getCourse(courseId, res);
    if (!course) return;

    // stepIndex validado contra totalSteps del backend — no del cliente
    if (typeof stepIndex !== "number" || stepIndex < 0 || stepIndex >= course.totalSteps) {
      return res.status(400).json({ message: "stepIndex inválido" });
    }

    // Los steps de quiz no pueden avanzarse con esta ruta
    // Solo avanzan si el quiz está aprobado — eso se maneja en /quiz
    if (course.quizSteps.includes(stepIndex)) {
      return res.status(400).json({
        message: "Los quizzes solo avanzan al aprobarlos. Usá la ruta /quiz.",
      });
    }

    let progress = await CourseProgress.findOne({ userId, courseId });
    if (!progress) {
      progress = await CourseProgress.create({ userId, courseId });
    }

    if (!progress.completedSteps.includes(stepIndex)) {
      progress.completedSteps.push(stepIndex);
    }

    progress.currentStep = Math.max(progress.currentStep, stepIndex + 1);

    // Completado cuando todos los steps no-quiz están completados
    // Y todos los quizzes están aprobados
    const wasCompleted = progress.isCompleted;

    const allQuizzesPassed = course.quizSteps.every(qi => {
      const result = progress.quizResults?.[String(qi)];
      return result?.passed === true;
    });

    const totalCompleted = progress.completedSteps.length;
    const allStepsDone   = totalCompleted >= course.totalSteps;

    if (allStepsDone && allQuizzesPassed && !wasCompleted) {
      progress.isCompleted = true;
      progress.completedAt = new Date();
    }

    await progress.save();

    // Transición a completado detectada acá también (por si el step que
    // faltaba era un step normal, no un quiz) — otorgar claim de certificado.
    // Las skills que otorga el curso (modernSocSkills) NO se escriben acá —
    // se derivan en tiempo real desde usersDatabaseRouter leyendo isCompleted
    // directo de Mongo, evitando el límite de 1000 bytes de Firebase.
    if (!wasCompleted && progress.isCompleted) {
      await grantCertifiedClaim(userId);
    }

    res.json({ data: progress });
  } catch (err) {
    console.error(esProduccion ? "Error PATCH step" : `Error PATCH step: ${err}`);
    res.status(500).json({ message: "Error al guardar progreso" });
  }
});

// ─── PATCH /api/course/:courseId/progress/quiz ───────────────────────────────
courseRouter.patch("/api/course/:courseId/progress/quiz", verifyToken, requireActivePlan, async (req, res) => {
  try {
    const { courseId }           = req.params;
    const userId                 = req.user.uid;
    const { stepIndex, answers } = req.body;

    const course = getCourse(courseId, res);
    if (!course) return;

    // stepIndex debe ser un quiz válido según el backend
    if (typeof stepIndex !== "number" || !course.quizSteps.includes(stepIndex)) {
      return res.status(400).json({ message: "stepIndex no corresponde a un quiz válido" });
    }

    // answers debe ser un array del tamaño correcto
    if (!Array.isArray(answers) || answers.length !== course.questionsPerQuiz) {
      return res.status(400).json({
        message: `Se esperan exactamente ${course.questionsPerQuiz} respuestas`,
      });
    }

    // Validar que todas las respuestas sean números enteros >= 0
    const allValid = answers.every(a => Number.isInteger(a) && a >= 0);
    if (!allValid) {
      return res.status(400).json({ message: "Todas las respuestas deben ser índices numéricos válidos" });
    }

    // ── Respuestas correctas — fuente de verdad en el backend ─────────────────
    const CORRECT_ANSWERS = {
      // Quiz Módulo 1 (step 3) — 20 preguntas
      3: [1,0,1,2,1,1,1,1,2,1,1,2,1,2,1,0,1,1,1,1],
      // Quiz Módulo 2 (step 6) — 20 preguntas
      6: [2,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0,1,1,1],
      // Quiz Módulo 3 (step 9) — 20 preguntas
      9: [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
      // Quiz Módulo 4 (step 12) — 20 preguntas
      12:[2,1,2,1,1,1,1,1,1,1,1,1,1,1,1,2,1,1,1,1],
    };

    const correctAnswers = CORRECT_ANSWERS[stepIndex];
    let correct = 0;
    answers.forEach((ans, i) => {
      if (ans === correctAnswers[i]) correct++;
    });

    const score  = correct / course.questionsPerQuiz;
    const passed = score >= course.passingScore;

    let progress = await CourseProgress.findOne({ userId, courseId });
    if (!progress) {
      progress = await CourseProgress.create({ userId, courseId });
    }

    // Capturamos el estado ANTES de tocar nada — es lo que nos permite
    // detectar la transición "recién ahora se completó el curso" más abajo,
    // sin volver a otorgar la claim en cada intento posterior de quiz.
    const wasCompleted = progress.isCompleted;

    const prevAttempts = progress.quizResults?.[String(stepIndex)]?.attempts ?? 0;

    progress.quizResults = {
      ...progress.quizResults,
      [String(stepIndex)]: {
        score,
        passed,
        attempts:      prevAttempts + 1,
        lastAttemptAt: new Date(),
      },
    };

    // Avanzar solo si aprobó
    if (passed) {
      if (!progress.completedSteps.includes(stepIndex)) {
        progress.completedSteps.push(stepIndex);
      }
      progress.currentStep = Math.max(progress.currentStep, stepIndex + 1);
    }

    // Verificar completado del curso
    const allQuizzesPassed = course.quizSteps.every(qi => {
      const result = progress.quizResults?.[String(qi)];
      return result?.passed === true;
    });
    const allStepsDone = progress.completedSteps.length >= course.totalSteps;

    if (allStepsDone && allQuizzesPassed && !wasCompleted) {
      progress.isCompleted = true;
      progress.completedAt = new Date();
    }

    await progress.save();

    // ── Recién completó el curso en este request → otorgar claim ───────────
    // Comparamos contra wasCompleted (capturado antes de guardar), así un
    // reintento de un quiz ya aprobado, o de cualquier otro después de
    // completado, nunca vuelve a disparar esto.
    if (!wasCompleted && progress.isCompleted) {
      await grantCertifiedClaim(userId);
    }

    res.json({
      data:        progress,
      passed,
      score,
      correct,
      total:       course.questionsPerQuiz,
      passingScore: course.passingScore,
    });
  } catch (err) {
    console.error(esProduccion ? "Error PATCH quiz" : `Error PATCH quiz: ${err}`);
    res.status(500).json({ message: "Error al guardar resultado del quiz" });
  }
});

module.exports = courseRouter;