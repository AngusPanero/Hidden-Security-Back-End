const express = require("express");

const { getCatalog } = require("./registry/courseRegistry");
const resolveCourse = require("./middleware/resolveCourse");
const auth = require("./middleware/auth");
const requireCourseAccess = require("./middleware/requireCourseAccess");

const progressService = require("./services/progressService");
const quizService = require("./services/quizService");
const contentService = require("./services/contentService");

// ─────────────────────────────────────────────────────────────────────
// Router general de cursos de empresas externas.
// En index.js:  app.use(externalCoursesRouter)
//
// GET  /api/external-courses                                       catálogo (público)
// GET  /api/external-courses/:partnerSlug/:courseSlug/structure    módulos y steps
// GET  /api/external-courses/:partnerSlug/:courseSlug/progress     progreso del usuario
// POST /api/external-courses/:partnerSlug/:courseSlug/start        empezar curso
// POST /api/external-courses/:partnerSlug/:courseSlug/steps/:stepId/complete
// POST /api/external-courses/:partnerSlug/:courseSlug/quiz/:quizId/submit   body: { answers }
// GET  /api/external-courses/:partnerSlug/:courseSlug/content/:stepId       PDF
// ─────────────────────────────────────────────────────────────────────

const BASE = "/api/external-courses";

const router = express.Router();
const courseRouter = express.Router({ mergeParams: true });

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const ctxOf = (req) => ({ user: req.user, course: req.course, access: req.access });

// ─── Catálogo público ────────────────────────────────────────────────
router.get(BASE, (req, res) => {
    res.json({ courses: getCatalog() });
});

// ─── Un curso puntual: curso → sesión → acceso ───────────────────────
router.use(
    `${BASE}/:partnerSlug/:courseSlug`,
    resolveCourse,
    auth,
    requireCourseAccess,
    courseRouter
);

courseRouter.get("/structure", (req, res) => {
    res.json(req.course.publicStructure);
});

courseRouter.get(
    "/progress",
    wrap(async (req, res) => {
        res.json(await progressService.get(ctxOf(req)));
    })
);

courseRouter.post(
    "/start",
    wrap(async (req, res) => {
        res.json(await progressService.start(ctxOf(req)));
    })
);

courseRouter.post(
    "/steps/:stepId/complete",
    wrap(async (req, res) => {
        res.json(await progressService.completeStep(ctxOf(req), req.params.stepId));
    })
);

courseRouter.post(
    "/quiz/:quizId/submit",
    wrap(async (req, res) => {
        const answers = req.body ? req.body.answers : undefined;
        res.json(await quizService.submit(ctxOf(req), req.params.quizId, answers));
    })
);

courseRouter.get(
    "/content/:stepId",
    wrap(async (req, res) => {
        await contentService.streamPdf(ctxOf(req), req.params.stepId, res);
    })
);

courseRouter.use((req, res) => {
    res.status(404).json({ error: "Endpoint no encontrado" });
});

// ─── Errores (solo de este router) ───────────────────────────────────
router.use(BASE, (err, req, res, next) => {
    const status = err.status || 500;
    if (status === 500) console.error("[externalCourses]", err);
    if (res.headersSent) return res.end(); // falló a mitad de un PDF

    const body = { error: err.publicMessage || "Error interno" };
    if (err.extra) Object.assign(body, err.extra);
    res.status(status).json(body);
});

module.exports = router;