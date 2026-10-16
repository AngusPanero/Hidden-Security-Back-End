const express        = require("express");
const courseRouter   = express.Router();
const CourseProgress = require("../models/CourseSchema");
const verifyToken    = require("../middleware/authMiddleware");
const auth           = require("../config/firebase");
const { COURSES, VALID_COURSE_IDS, getQuizModuleNumber } = require("../config/courses");

const esProduccion = process.env.NODE_ENV === "production";

// --- Middleware: verificar plan activo -----------------------------------
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

// --- Helper: validar courseId contra whitelist -----------------------------
function getCourse(courseId, res) {
  if (!VALID_COURSE_IDS.includes(courseId)) {
    res.status(400).json({ message: "Curso no válido" });
    return null;
  }
  return COURSES[courseId];
}

// --- Helper: buscar o crear el progreso de forma ATÓMICA --------------------
// findOneAndUpdate con upsert:true es atómico a nivel de Mongo — evita el
// E11000 que generaba el doble fetch de React StrictMode en dev.
async function findOrCreateProgress(userId, courseId) {
  return CourseProgress.findOneAndUpdate(
    { userId, courseId },
    { $setOnInsert: { userId, courseId } },
    { returnDocument: "after", upsert: true, setDefaultsOnInsert: true }
  );
}

// --- Helper: ¿el alumno ya llegó a este step? -------------------------------
// Mismo criterio que usa el front para bloquear el aside: un step está
// disponible si ya lo completó o si no está por delante del currentStep.
// Evita que alguien pida (o intente responder) el quiz del módulo 8 sin
// haber pasado por los anteriores.
function isStepUnlocked(progress, stepIndex) {
  return stepIndex <= progress.currentStep || progress.completedSteps.includes(stepIndex);
}

// --- Helper: otorgar la claim de "usuario certificado" al completar un curso --
// Booleano — entra sin problema en el límite de 1000 bytes de Firebase.
// Se escribe una sola vez, en la transición a completado.
// No confundir con "userCertificated" que arma usersDatabaseRouter.js
// (valor calculado desde skillsCertifiedByHidden).
async function grantCourseCompletedClaim(uid, course) {
  try {
    const userRecord    = await auth.getUser(uid);
    const currentClaims = userRecord.customClaims || {};
    const completed     = Array.isArray(currentClaims.completedCourses) ? currentClaims.completedCourses : [];

    if (completed.includes(course.completionClaimId)) return;

    const { userCertificated, ...rest } = currentClaims; // limpia la claim vieja
    await auth.setCustomUserClaims(uid, {
      ...rest,
      completedCourses: [...completed, course.completionClaimId],
    });
  } catch (err) {
    console.error(`Error otorgando completedCourses para ${uid}:`, err.message);
  }
}

// --- GET /api/course/:courseId/progress -------------------------------------
courseRouter.get("/api/course/:courseId/progress", verifyToken, requireActivePlan, async (req, res) => {
  try {
    const { courseId } = req.params;
    const userId       = req.user.uid;

    const course = getCourse(courseId, res);
    if (!course) return;

    const progress = await findOrCreateProgress(userId, courseId);

    res.json({ data: progress });
  } catch (err) {
    console.error(esProduccion ? "Error GET progress" : `Error GET progress: ${err}`);
    res.status(500).json({ message: "Error al obtener progreso" });
  }
});

// --- GET /api/course/:courseId/quiz/:stepIndex ------------------------------
// Devuelve las preguntas del quiz del módulo SIN la respuesta correcta.
// El front las mezcla (preguntas y opciones) en cada intento.
courseRouter.get("/api/course/:courseId/quiz/:stepIndex", verifyToken, requireActivePlan, async (req, res) => {
  try {
    const { courseId } = req.params;
    const userId       = req.user.uid;
    const stepIndex    = Number(req.params.stepIndex);

    const course = getCourse(courseId, res);
    if (!course) return;

    const moduleNumber = Number.isInteger(stepIndex) ? getQuizModuleNumber(course, stepIndex) : null;
    if (!moduleNumber) {
      return res.status(400).json({ message: "stepIndex no corresponde a un quiz válido" });
    }

    const progress = await findOrCreateProgress(userId, courseId);
    if (!isStepUnlocked(progress, stepIndex)) {
      return res.status(403).json({ message: "Completá las etapas anteriores para acceder a este quiz" });
    }

    const questions = course.quizBank.getQuizForClient(moduleNumber);
    if (!questions) {
      return res.status(500).json({ message: "Quiz no disponible" });
    }

    res.set("Cache-Control", "no-store");
    res.json({
      data: {
        stepIndex,
        moduleNumber,
        passingScore: course.passingScore,
        questions,
      },
    });
  } catch (err) {
    console.error(esProduccion ? "Error GET quiz" : `Error GET quiz: ${err}`);
    res.status(500).json({ message: "Error al obtener el quiz" });
  }
});

// --- PATCH /api/course/:courseId/progress/step -------------------------------
courseRouter.patch("/api/course/:courseId/progress/step", verifyToken, requireActivePlan, async (req, res) => {
  try {
    const { courseId } = req.params;
    const userId       = req.user.uid;
    const { stepIndex } = req.body;

    const course = getCourse(courseId, res);
    if (!course) return;

    // stepIndex validado contra totalSteps del backend — no del cliente
    if (!Number.isInteger(stepIndex) || stepIndex < 0 || stepIndex >= course.totalSteps) {
      return res.status(400).json({ message: "stepIndex inválido" });
    }

    // Los quizzes solo avanzan al aprobarlos — eso se maneja en /quiz
    if (course.quizSteps.includes(stepIndex)) {
      return res.status(400).json({
        message: "Los quizzes solo avanzan al aprobarlos. Usá la ruta /quiz.",
      });
    }

    const progress = await findOrCreateProgress(userId, courseId);

    if (!progress.completedSteps.includes(stepIndex)) {
      progress.completedSteps.push(stepIndex);
    }

    progress.currentStep = Math.max(progress.currentStep, stepIndex + 1);

    const wasCompleted = progress.isCompleted;

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

    // Las skills del curso NO se escriben acá — usersDatabaseRouter las
    // deriva leyendo isCompleted desde Mongo (límite de 1000 bytes de Firebase).
    if (!wasCompleted && progress.isCompleted) {
    await grantCourseCompletedClaim(userId, course);
  }

    res.json({ data: progress });
  } catch (err) {
    console.error(esProduccion ? "Error PATCH step" : `Error PATCH step: ${err}`);
    res.status(500).json({ message: "Error al guardar progreso" });
  }
});

// --- PATCH /api/course/:courseId/progress/quiz -------------------------------
// Body: { stepIndex, answers: [{ questionId, answer }] }
//   - answers puede venir en cualquier orden (el front mezcla las preguntas)
//   - answer es el TEXTO de la opción elegida, no un índice
// La corrección vive en el banco (gradeQuiz): compara el texto contra la
// opción correcta, que nunca sale del backend.
courseRouter.patch("/api/course/:courseId/progress/quiz", verifyToken, requireActivePlan, async (req, res) => {
  try {
    const { courseId }           = req.params;
    const userId                 = req.user.uid;
    const { stepIndex, answers } = req.body;

    const course = getCourse(courseId, res);
    if (!course) return;

    const moduleNumber = Number.isInteger(stepIndex) ? getQuizModuleNumber(course, stepIndex) : null;
    if (!moduleNumber) {
      return res.status(400).json({ message: "stepIndex no corresponde a un quiz válido" });
    }

    const grading = course.quizBank.gradeQuiz(moduleNumber, answers);
    if (!grading.ok) {
      return res.status(400).json({ message: grading.error });
    }

    const { correct, total } = grading;
    const score  = correct / total;
    const passed = score >= course.passingScore;

    const progress = await findOrCreateProgress(userId, courseId);

    if (!isStepUnlocked(progress, stepIndex)) {
      return res.status(403).json({ message: "Completá las etapas anteriores para rendir este quiz" });
    }

    // Estado ANTES de tocar nada — para detectar la transición a completado
    // sin volver a otorgar la claim en reintentos posteriores.
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

    if (passed) {
      if (!progress.completedSteps.includes(stepIndex)) {
        progress.completedSteps.push(stepIndex);
      }
      progress.currentStep = Math.max(progress.currentStep, stepIndex + 1);
    }

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

    if (!wasCompleted && progress.isCompleted) {
      await grantCourseCompletedClaim(userId, course);
    }

    res.json({
      data:         progress,
      passed,
      score,
      correct,
      total,
      passingScore: course.passingScore,
    });
  } catch (err) {
    console.error(esProduccion ? "Error PATCH quiz" : `Error PATCH quiz: ${err}`);
    res.status(500).json({ message: "Error al guardar resultado del quiz" });
  }
});

// --- GET /api/course/progress-summary ----------------------------------------
// Resumen de progreso de TODOS los cursos del usuario autenticado.
courseRouter.get("/api/course/progress-summary", verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const progressDocs = await CourseProgress.find({ userId }).lean();

    const summary = progressDocs.map((p) => {
      const course     = COURSES[p.courseId];
      const totalSteps = course?.totalSteps ?? 0;
      const percent    = totalSteps > 0
        ? Math.round((p.completedSteps.length / totalSteps) * 100)
        : 0;

      return {
        courseId:       p.courseId,
        currentStep:    p.currentStep,
        completedCount: p.completedSteps.length,
        totalSteps,
        percent,
        isCompleted:    p.isCompleted,
        startedAt:      p.startedAt,
        completedAt:    p.completedAt,
      };
    });

    res.json({ data: summary });
  } catch (err) {
    console.error("Error GET progress-summary:", err);
    res.status(500).json({ message: "Error al obtener resumen de progreso" });
  }
});

module.exports = courseRouter;