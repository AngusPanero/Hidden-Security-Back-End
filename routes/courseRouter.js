const express        = require("express");
const rateLimit      = require("express-rate-limit");
const courseRouter   = express.Router();
const CourseProgress = require("../models/CourseSchema");
const verifyToken    = require("../middleware/authMiddleware");
const auth           = require("../config/firebase");
const { COURSES, VALID_COURSE_IDS, getQuizModuleNumber } = require("../config/courses");
const fs = require("fs");
const path = require("path");
const { pipeline } = require("stream/promises");
const { SOC1_CONTENT_DIR, SOC1_PDF_BY_STEP } = require("../config/soc1Content");
const { issueHiddenCourseCertificate } = require("./publicCertificateRouter");

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

// El admin revisa el contenido sin necesitar un plan
function requireActivePlanOrAdmin(req, res, next) {
  if (req.user?.admin === true) return next();
  return requireActivePlan(req, res, next);
}

// --- Nota mínima de aprobación ------------------------------------------------
// 80% en todos los quizzes de todos los cursos, sin importar lo que diga
// config/courses.js. Se decide acá (backend): el front solo la muestra.
const MIN_PASS_SCORE = 0.8;
const passScoreOf = (course) => Math.max(Number(course.passingScore) || 0, MIN_PASS_SCORE);

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

// --- Helper: ¿se completó el curso? (atómico) --------------------------------
// Todos los steps hechos + todos los quizzes aprobados. La transición a
// completado se hace con findOneAndUpdate({ isCompleted: false }): si llegan
// dos pedidos a la vez, solo uno la gana y la claim se otorga una sola vez.
async function markCompletedIfDone(progress, course, uid) {
  if (!progress || progress.isCompleted) return progress;

  const done = new Set(progress.completedSteps || []);
  const allStepsDone = Array.from({ length: course.totalSteps }, (_, i) => i).every(i => done.has(i));
  const allQuizzesPassed = course.quizSteps.every(qi => progress.quizResults?.[String(qi)]?.passed === true);
  if (!allStepsDone || !allQuizzesPassed) return progress;

  const updated = await CourseProgress.findOneAndUpdate(
    { _id: progress._id, isCompleted: false },
    { $set: { isCompleted: true, completedAt: new Date() } },
    { returnDocument: "after" }
  );
  if (!updated) return CourseProgress.findById(progress._id); // otro pedido lo completó primero

  await grantCourseCompletedClaim(uid, course);
  return updated;
}

// --- Helper: nota del curso = promedio de la MEJOR nota de cada quiz ----------
function courseScore(progress, course) {
  const scores = course.quizSteps.map(qi => {
    const r = progress.quizResults?.[String(qi)];
    return Math.max(Number(r?.bestScore) || 0, Number(r?.score) || 0);
  });
  return scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
}

// --- Helper: certificado de finalización del curso ---------------------------
// Idempotente: si ya existe devuelve el mismo link (y completa el nombre si el
// alumno lo cargó en el CV después). Nunca rompe la respuesta del progreso.
async function ensureCourseCertificate(progress, course, courseId, uid) {
  if (!progress?.isCompleted) return null;
  try {
    return await issueHiddenCourseCertificate({
      userId:   uid,
      courseId,
      score:    courseScore(progress, course),
      issuedAt: progress.completedAt || new Date(),
    });
  } catch (err) {
    console.error("Error emitiendo certificado del curso:", err.message);
    return null;
  }
}

// --- Rate limit de quizzes por usuario ---------------------------------------
// Los reintentos son ilimitados, pero sin límite de velocidad alguien podría
// automatizar envíos para deducir las respuestas por la nota de cada intento.
const quizLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.uid || "anon",
  message: { message: "Demasiados intentos seguidos. Esperá unos minutos y volvé a intentar." },
});

// --- GET /api/course/:courseId/progress -------------------------------------
courseRouter.get("/api/course/:courseId/progress", verifyToken, requireActivePlan, async (req, res) => {
  try {
    const { courseId } = req.params;
    const userId       = req.user.uid;

    const course = getCourse(courseId, res);
    if (!course) return;

    let progress = await findOrCreateProgress(userId, courseId);
    // Repara alumnos que ya tenían todo hecho pero quedaron sin marcar completos
    progress = await markCompletedIfDone(progress, course, userId);

    // Curso completo: certificado de finalización (también para quienes
    // terminaron antes de que existiera)
    const certificate = await ensureCourseCertificate(progress, course, courseId, userId);

    res.json({
      data:        progress,
      score:       progress.isCompleted ? courseScore(progress, course) : null,
      passingScore: passScoreOf(course),
      certificate,
    });
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
        passingScore: passScoreOf(course),
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

    // Solo se puede marcar un step al que el alumno ya llegó. Sin esto, desde
    // Postman se podían marcar los 88 steps sin leer nada y completar el curso.
    if (!isStepUnlocked(progress, stepIndex)) {
      return res.status(403).json({ message: "Completá las etapas anteriores para avanzar" });
    }

    // Atómico: $addToSet no duplica y $max nunca hace retroceder currentStep,
    // aunque lleguen dos pedidos a la vez
    let updated = await CourseProgress.findOneAndUpdate(
      { _id: progress._id },
      { $addToSet: { completedSteps: stepIndex }, $max: { currentStep: stepIndex + 1 } },
      { returnDocument: "after" }
    );
    updated = await markCompletedIfDone(updated, course, userId);

    // Las skills del curso NO se escriben acá — usersDatabaseRouter las
    // deriva leyendo isCompleted desde Mongo (límite de 1000 bytes de Firebase).
    const certificate = await ensureCourseCertificate(updated, course, courseId, userId);

    res.json({ data: updated, certificate });
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
courseRouter.patch("/api/course/:courseId/progress/quiz", verifyToken, quizLimiter, requireActivePlan, async (req, res) => {
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
    const passed = score >= passScoreOf(course);

    const progress = await findOrCreateProgress(userId, courseId);

    if (!isStepUnlocked(progress, stepIndex)) {
      return res.status(403).json({ message: "Completá las etapas anteriores para rendir este quiz" });
    }

    // Reintentos ilimitados, también después de aprobar:
    // - un quiz aprobado NUNCA vuelve a quedar desaprobado
    // - se guarda siempre la MEJOR nota (bestScore)
    // Todo atómico ($inc / $max), así dos envíos en paralelo no se pisan.
    const key       = String(stepIndex);
    const prev      = progress.quizResults?.[key];
    const wasPassed = prev?.passed === true;
    const prevBest  = Math.max(Number(prev?.bestScore) || 0, Number(prev?.score) || 0);
    const base      = `quizResults.${key}`;

    const update = {
      $set: { [`${base}.score`]: score, [`${base}.lastAttemptAt`]: new Date() },
      $inc: { [`${base}.attempts`]: 1 },
      $max: { [`${base}.bestScore`]: Math.max(prevBest, score) },
    };
    if (passed || !prev) update.$set[`${base}.passed`] = passed || wasPassed;
    if (passed) {
      update.$addToSet = { completedSteps: stepIndex };
      update.$max.currentStep = stepIndex + 1;
    }

    let updated = await CourseProgress.findOneAndUpdate({ _id: progress._id }, update, { returnDocument: "after" });
    updated = await markCompletedIfDone(updated, course, userId);
    const certificate = await ensureCourseCertificate(updated, course, courseId, userId);

    res.json({
      data:          updated,
      passed,
      alreadyPassed: wasPassed,
      score,
      bestScore:     Math.max(prevBest, score),
      correct,
      total,
      passingScore:  passScoreOf(course),
      certificate,
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

    // Solo cursos que siguen existiendo en config/courses.js
    const summary = progressDocs.filter((p) => COURSES[p.courseId]).map((p) => {
      const course     = COURSES[p.courseId];
      const totalSteps = course.totalSteps ?? 0;
      const percent    = totalSteps > 0
        ? Math.min(100, Math.round((p.completedSteps.length / totalSteps) * 100))
        : 0;

      // Quizzes: se calculan acá con la mejor nota guardada (el front solo muestra)
      const quizSteps     = course.quizSteps || [];
      const taken         = quizSteps.filter((qi) => p.quizResults?.[String(qi)]);
      const quizzesPassed = quizSteps.filter((qi) => p.quizResults?.[String(qi)]?.passed === true).length;

      return {
        courseId:       p.courseId,
        currentStep:    p.currentStep,
        completedCount: p.completedSteps.length,
        totalSteps,
        percent,
        isCompleted:    p.isCompleted,
        startedAt:      p.startedAt,
        completedAt:    p.completedAt,
        quizzesTotal:   quizSteps.length,
        quizzesTaken:   taken.length,
        quizzesPassed,
        // Promedio de la mejor nota de los quizzes rendidos (null si no rindió ninguno).
        // Con el curso completo están todos rendidos: es la misma nota del certificado.
        score:          taken.length
          ? taken.reduce((acc, qi) => {
              const r = p.quizResults[String(qi)];
              return acc + Math.max(Number(r.bestScore) || 0, Number(r.score) || 0);
            }, 0) / taken.length
          : null,
        passingScore:   passScoreOf(course),
      };
    });

    res.json({ data: summary });
  } catch (err) {
    console.error("Error GET progress-summary:", err);
    res.status(500).json({ message: "Error al obtener resumen de progreso" });
  }
});

// ── PDF protegido del curso SOC ──────────────────────────────────────
// Solo con sesión, membresía activa y step desbloqueado.
courseRouter.get("/api/course/:courseId/content/:stepIndex", verifyToken, requireActivePlanOrAdmin, async (req, res) => {
    try {
        const { courseId } = req.params;
        const stepIndex = Number(req.params.stepIndex);

        if (courseId !== "soc1") return res.status(404).json({ message: "Curso no encontrado" });

        const relFile = SOC1_PDF_BY_STEP.get(stepIndex);
        if (!Number.isInteger(stepIndex) || !relFile) {
            return res.status(404).json({ message: "Contenido no encontrado" });
        }

        const user = req.user;
        const isAdmin = user.admin === true;

        // 1) MEMBRESÍA: la valida requireActivePlanOrAdmin en la ruta (la misma
        //    regla que el resto del curso). Antes alcanzaba con CUALQUIER plan que
        //    no fuera voucher, así que business/enterprise también entraban.

        // 2) STEP DESBLOQUEADO: mismo criterio que /quiz y /progress/step
        if (!isAdmin) {
            const progress = await CourseProgress.findOne({ userId: user.uid, courseId }).lean();
            if (!progress || !isStepUnlocked(progress, stepIndex)) {
                return res.status(403).json({ message: "Completá la etapa anterior para desbloquear." });
            }
        }

        const filePath = path.resolve(SOC1_CONTENT_DIR, relFile);
        if (!filePath.startsWith(SOC1_CONTENT_DIR + path.sep)) {
            return res.status(400).json({ message: "Ruta inválida" });
        }

        const stat = await fs.promises.stat(filePath).catch(() => null);
        if (!stat) return res.status(404).json({ message: "Archivo no encontrado" });

        res.set({
            "Content-Type": "application/pdf",
            "Content-Length": stat.size,
            "Content-Disposition": "inline",
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
        });

        await pipeline(fs.createReadStream(filePath), res);
    } catch (error) {
        console.error("Error sirviendo PDF:", error);
        if (!res.headersSent) res.status(500).json({ message: "Error interno" });
    }
});

module.exports = courseRouter;