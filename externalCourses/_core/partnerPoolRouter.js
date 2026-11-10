const express = require("express");
const rateLimit = require("express-rate-limit");

const { getCatalog, getCourseById } = require("./registry/courseRegistry");
const auth = require("./middleware/auth");

const Partner = require("./schemas/PartnerSchema");
const CourseProgressEvent = require("./schemas/CourseProgressEventSchema");
const { EVENT_TYPES } = require("./constants/eventTypes");
const { ACCESS_TYPES } = require("./constants/accessTypes");
const pool = require("./services/partnerPoolService");
const courseDurations = require("./services/courseDurationService");
// ⚠️ Ajustá la ruta si signPin.js está en otro lugar (desde externalCourses/_core/)
const { verifyPin, PIN_REGEX } = require("../../utils/signPin");

// ─────────────────────────────────────────────────────────────────────
// Partner Pool — rutas de administración (solo claim admin = true).
// Se monta DENTRO de externalCoursesRouter, antes de /:partnerSlug/:courseSlug.
//
// Métricas en vivo
//   GET  /api/external-courses/admin/partner-pool?from=&to=
//
// Liquidaciones (Especificación V1)
//   GET  /api/external-courses/admin/partner-pool/config
//   PUT  /api/external-courses/admin/partner-pool/config
//   GET  /api/external-courses/admin/partner-pool/periods
//   GET  /api/external-courses/admin/partner-pool/periods/:period            detalle + liquidaciones + auditoría
//   POST /api/external-courses/admin/partner-pool/periods/:period/calculate
//   POST /api/external-courses/admin/partner-pool/periods/:period/approve
//   POST /api/external-courses/admin/partner-pool/periods/:period/close
//   POST /api/external-courses/admin/partner-pool/periods/:period/reopen      body: { reason }
//   POST /api/external-courses/admin/partner-pool/settlements/:settlementId/adjustments  body: { type, amount, reason }
//   POST /api/external-courses/admin/partner-pool/settlements/:settlementId/pay          body: { paymentReference }
//   POST /api/external-courses/admin/partner-pool/settlements/:settlementId/cancel       body: { reason }
//
// Duración formativa por versión (V1.2, sin IA: la estima el código y la aprueba Hidden)
//   GET  /api/external-courses/admin/partner-pool/durations
//   GET  /api/external-courses/admin/partner-pool/durations/:courseId/:version
//   POST /api/external-courses/admin/partner-pool/durations/:courseId/:version/measure          volver a medir
//   POST /api/external-courses/admin/partner-pool/durations/:courseId/:version/approve          body: { hours?, justification?, signPin }
//   POST /api/external-courses/admin/partner-pool/durations/:courseId/:version/reject           body: { reason }
//   POST /api/external-courses/admin/partner-pool/durations/:courseId/:version/inherit          body: { reason, signPin }
//   POST /api/external-courses/admin/partner-pool/durations/:courseId/:version/confirm-content  body: { reason, signPin }
//   Las tres rutas que dejan una duración APROBADA (la que mueve plata) piden la clave de firma.
//
// Vista del partner (claim partner = true; la empresa sale del email de la sesión)
//   GET  /api/external-courses/partner/partner-pool/settlements
// ─────────────────────────────────────────────────────────────────────

const ADMIN_BASE = "/api/external-courses/admin/partner-pool";

const partnerPoolRouter = express.Router();

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const adminOf = (req) => ({ uid: req.user.uid, email: req.user.email || null });

const requireAdmin = (req, res, next) => {
    if (req.user && req.user.admin === true) return next();
    return res.status(403).json({ error: "Acceso solo para administradores" });
};

partnerPoolRouter.use(ADMIN_BASE, auth, requireAdmin, (req, res, next) => {
    res.set("Cache-Control", "private, no-store");
    next();
});

// ── Vista del partner: solo sus propias liquidaciones ────────────────
const PARTNER_BASE = "/api/external-courses/partner/partner-pool";
partnerPoolRouter.get(
    `${PARTNER_BASE}/settlements`,
    auth,
    wrap(async (req, res) => {
        res.set("Cache-Control", "private, no-store");
        res.json(await pool.getPartnerSettlements(req.user));
    })
);

// ══════════════════════════════════════════════════════════════════════
//  Métricas en vivo (no liquidan nada, sirven para seguir el mes en curso)
// ══════════════════════════════════════════════════════════════════════
const EXCLUDED_ACCESS = [ACCESS_TYPES.ADMIN, ACCESS_TYPES.TEST];
const MAX_RANGE_MS = 366 * 24 * 60 * 60 * 1000;

function parseRange(query) {
    const now = new Date();
    const from = query.from ? new Date(query.from) : new Date(now.getFullYear(), now.getMonth(), 1);
    const to = query.to ? new Date(query.to) : now;
    const invalid = (msg) => Object.assign(new Error(msg), { status: 400, publicMessage: msg });
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from >= to) throw invalid("Rango de fechas inválido");
    if (to - from > MAX_RANGE_MS) throw invalid("El rango no puede superar un año");
    return { from, to };
}

const emptyCourseStats = () => ({
    started: 0,
    stepsCompleted: 0,
    eligibleSteps: 0,
    weightedUnits: 0,
    completions: 0,
    quizAttempts: 0,
    quizPassed: 0,
    quizScoreSum: 0,
    allTimeStarted: 0,
    allTimeCompleted: 0,
});

partnerPoolRouter.get(
    ADMIN_BASE,
    wrap(async (req, res) => {
        const { from, to } = parseRange(req.query);
        const realAccess = { "metadata.accessType": { $nin: EXCLUDED_ACCESS } };

        const [partners, periodRows, studentRows, allTimeRows] = await Promise.all([
            Partner.find({}).lean(),
            CourseProgressEvent.aggregate([
                { $match: { partnerId: { $ne: null }, occurredAt: { $gte: from, $lt: to }, ...realAccess } },
                {
                    $group: {
                        _id: { partnerId: "$partnerId", courseId: "$courseId", eventType: "$eventType" },
                        count: { $sum: 1 },
                        eligible: { $sum: { $cond: [{ $eq: ["$metadata.partnerPoolEligible", true] }, 1, 0] } },
                        scoreSum: { $sum: { $ifNull: ["$metadata.score", 0] } },
                    },
                },
            ]),
            CourseProgressEvent.aggregate([
                { $match: { partnerId: { $ne: null }, occurredAt: { $gte: from, $lt: to }, ...realAccess } },
                { $group: { _id: { partnerId: "$partnerId", userId: "$userId" } } },
                { $group: { _id: "$_id.partnerId", students: { $sum: 1 } } },
            ]),
            CourseProgressEvent.aggregate([
                {
                    $match: {
                        partnerId: { $ne: null },
                        eventType: { $in: [EVENT_TYPES.COURSE_STARTED, EVENT_TYPES.COURSE_COMPLETED] },
                        ...realAccess,
                    },
                },
                {
                    $group: {
                        _id: { partnerId: "$partnerId", courseId: "$courseId", eventType: "$eventType" },
                        count: { $sum: 1 },
                    },
                },
            ]),
        ]);

        const byPartner = new Map();
        const courseStats = (partnerId, courseId) => {
            const pKey = String(partnerId);
            if (!byPartner.has(pKey)) byPartner.set(pKey, new Map());
            const courses = byPartner.get(pKey);
            if (!courses.has(courseId)) courses.set(courseId, emptyCourseStats());
            return courses.get(courseId);
        };

        const partnerIdBySlug = new Map(partners.map((p) => [p.slug, String(p._id)]));
        for (const c of getCatalog()) {
            const pid = partnerIdBySlug.get(String(c.partnerSlug).toLowerCase());
            if (pid) courseStats(pid, c.courseId);
        }

        for (const row of periodRows) {
            const s = courseStats(row._id.partnerId, row._id.courseId);
            switch (row._id.eventType) {
                case EVENT_TYPES.COURSE_STARTED:
                    s.started += row.count;
                    break;
                case EVENT_TYPES.STEP_COMPLETED: {
                    // V1.2: no hay peso fijo por curso; la ponderación por duración se aplica al liquidar
                    const weight = 1;
                    s.stepsCompleted += row.count;
                    s.eligibleSteps += row.eligible;
                    s.weightedUnits += row.eligible * weight;
                    break;
                }
                case EVENT_TYPES.COURSE_COMPLETED:
                    s.completions += row.count;
                    break;
                case EVENT_TYPES.QUIZ_COMPLETED:
                    s.quizAttempts += row.count;
                    s.quizScoreSum += row.scoreSum;
                    break;
                case EVENT_TYPES.QUIZ_PASSED:
                    s.quizPassed += row.count;
                    break;
                default:
                    break;
            }
        }

        for (const row of allTimeRows) {
            const s = courseStats(row._id.partnerId, row._id.courseId);
            if (row._id.eventType === EVENT_TYPES.COURSE_STARTED) s.allTimeStarted += row.count;
            else s.allTimeCompleted += row.count;
        }

        const studentsByPartner = new Map(studentRows.map((r) => [String(r._id), r.students]));

        const result = partners.map((p) => {
            const pid = String(p._id);
            const poolEnabled = p.status === "ACTIVE" && p.partnerPool?.enabled !== false;
            const courses = [...(byPartner.get(pid) || new Map()).entries()].map(([courseId, s]) => {
                const course = getCourseById(courseId);
                return {
                    courseId,
                    title: course?.title || courseId,
                    status: course?.status || "NO_CARGADO",
                    courseWeight: course?.partnerPool?.courseWeight ?? 1,
                    started: s.started,
                    stepsCompleted: s.stepsCompleted,
                    eligibleSteps: s.eligibleSteps,
                    weightedUnits: s.weightedUnits,
                    completions: s.completions,
                    quizAttempts: s.quizAttempts,
                    quizPassed: s.quizPassed,
                    avgQuizScore: s.quizAttempts ? s.quizScoreSum / s.quizAttempts : null,
                    allTimeStarted: s.allTimeStarted,
                    allTimeCompleted: s.allTimeCompleted,
                };
            });

            const sum = (k) => courses.reduce((acc, c) => acc + (c[k] || 0), 0);
            const quizAttempts = sum("quizAttempts");
            const quizScoreSum = courses.reduce((acc, c) => acc + (c.avgQuizScore ?? 0) * c.quizAttempts, 0);

            return {
                partnerId: pid,
                slug: p.slug,
                code: p.code,
                name: p.name,
                logoUrl: p.logoUrl || "",
                status: p.status,
                poolEnabled,
                students: studentsByPartner.get(pid) || 0,
                started: sum("started"),
                stepsCompleted: sum("stepsCompleted"),
                eligibleSteps: sum("eligibleSteps"),
                weightedUnits: poolEnabled ? sum("weightedUnits") : 0,
                completions: sum("completions"),
                quizAttempts,
                quizPassed: sum("quizPassed"),
                avgQuizScore: quizAttempts ? quizScoreSum / quizAttempts : null,
                allTimeStarted: sum("allTimeStarted"),
                allTimeCompleted: sum("allTimeCompleted"),
                poolShare: 0,
                courses,
            };
        });

        const totalUnits = result.reduce((acc, p) => acc + p.weightedUnits, 0);
        for (const p of result) p.poolShare = totalUnits ? p.weightedUnits / totalUnits : 0;
        result.sort((a, b) => b.weightedUnits - a.weightedUnits || a.name.localeCompare(b.name));

        res.json({
            period: { from: from.toISOString(), to: to.toISOString() },
            totals: {
                partners: result.length,
                activePartners: result.filter((p) => p.poolEnabled).length,
                students: result.reduce((acc, p) => acc + p.students, 0),
                eligibleSteps: result.reduce((acc, p) => acc + p.eligibleSteps, 0),
                weightedUnits: totalUnits,
                completions: result.reduce((acc, p) => acc + p.completions, 0),
            },
            partners: result,
        });
    })
);

// ══════════════════════════════════════════════════════════════════════
//  Liquidaciones
// ══════════════════════════════════════════════════════════════════════
partnerPoolRouter.get(
    `${ADMIN_BASE}/config`,
    wrap(async (req, res) => {
        res.json(pool.plain(await pool.getConfig()));
    })
);

partnerPoolRouter.put(
    `${ADMIN_BASE}/config`,
    wrap(async (req, res) => {
        res.json(pool.plain(await pool.updateConfig(req.body || {}, adminOf(req))));
    })
);

partnerPoolRouter.get(
    `${ADMIN_BASE}/periods`,
    wrap(async (req, res) => {
        res.json({ periods: await pool.listPeriods() });
    })
);

partnerPoolRouter.get(
    `${ADMIN_BASE}/periods/:period`,
    wrap(async (req, res) => {
        res.json(await pool.getPeriodDetail(req.params.period));
    })
);

const periodAction = (fn) =>
    wrap(async (req, res) => {
        const extra = await fn(req);
        res.json({ ...(extra || {}), ...(await pool.getPeriodDetail(req.params.period)) });
    });

partnerPoolRouter.post(
    `${ADMIN_BASE}/periods/:period/calculate`,
    periodAction((req) => pool.calculatePeriod(req.params.period, adminOf(req)))
);
partnerPoolRouter.post(
    `${ADMIN_BASE}/periods/:period/approve`,
    periodAction((req) => pool.approvePeriod(req.params.period, adminOf(req)))
);
partnerPoolRouter.post(
    `${ADMIN_BASE}/periods/:period/close`,
    periodAction((req) => pool.closePeriod(req.params.period, adminOf(req)))
);
partnerPoolRouter.post(
    `${ADMIN_BASE}/periods/:period/reopen`,
    periodAction((req) => pool.reopenPeriod(req.params.period, req.body?.reason, adminOf(req)))
);

const SettlementModel = require("./schemas/PartnerPoolSettlementSchema");
const settlementAction = (fn) =>
    wrap(async (req, res) => {
        await fn(req);
        const s = await SettlementModel.findOne({ settlementId: req.params.settlementId }).select("period").lean();
        res.json(await pool.getPeriodDetail(s.period));
    });

partnerPoolRouter.post(
    `${ADMIN_BASE}/settlements/:settlementId/adjustments`,
    settlementAction((req) => pool.addAdjustment(req.params.settlementId, req.body || {}, adminOf(req)))
);
partnerPoolRouter.post(
    `${ADMIN_BASE}/settlements/:settlementId/pay`,
    settlementAction((req) => pool.markPaid(req.params.settlementId, req.body?.paymentReference, adminOf(req)))
);
partnerPoolRouter.post(
    `${ADMIN_BASE}/settlements/:settlementId/cancel`,
    settlementAction((req) => pool.cancelSettlement(req.params.settlementId, req.body?.reason, adminOf(req)))
);

// ══════════════════════════════════════════════════════════════════════
//  Duración formativa por versión (V1.2)
// ══════════════════════════════════════════════════════════════════════
// Medir lee todos los PDFs y consulta los videos: límite por admin
const measureLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.user?.uid || "anon",
    message: { error: "Demasiadas mediciones seguidas. Probá de nuevo en un rato." },
});

// ── Clave de firma (signPin) ─────────────────────────────────────────
// Aprobar, heredar o confirmar una duración define cuánto cobra cada empresa,
// así que pide la clave de 4 dígitos además de la sesión de admin.
// Son solo 10.000 combinaciones: tras 5 claves incorrectas en 15 minutos se
// bloquea a ese admin (los intentos correctos no cuentan).
const signPinLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    skipSuccessfulRequests: true,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.user?.uid || "anon",
    message: { error: "Demasiados intentos con la clave de firma. Esperá 15 minutos." },
});

async function requireSignPin(req, res, next) {
    const pin = req.body?.signPin;
    if (typeof pin !== "string" || !PIN_REGEX.test(pin)) {
        return res.status(400).json({ error: "Ingresá tu clave de firma de 4 dígitos" });
    }
    let ok = false;
    try {
        ok = await verifyPin(pin);
    } catch (err) {
        // Falta ADMIN_SIGN_PEPPER o ADMIN_SIGN_PIN_HASH en el .env (nunca se loguea la clave)
        console.error("[partnerPool] clave de firma no configurada:", err.message);
        return res.status(500).json({ error: "La firma no está configurada en el servidor" });
    }
    // 403 y no 401: un 401 haría que el front cierre la sesión del admin
    if (!ok) return res.status(403).json({ error: "Clave de firma incorrecta" });
    delete req.body.signPin; // no sigue viajando ni se guarda en ningún lado
    req.signedWithPin = true;
    next();
}

const signedAdminOf = (req) => ({ ...adminOf(req), signedWithPin: req.signedWithPin === true });

partnerPoolRouter.get(
    `${ADMIN_BASE}/durations`,
    wrap(async (req, res) => {
        res.json({ durations: await courseDurations.list(), rules: courseDurations.ESTIMATION_RULES });
    })
);

partnerPoolRouter.get(
    `${ADMIN_BASE}/durations/:courseId/:version`,
    wrap(async (req, res) => {
        res.json(await courseDurations.getDetail(req.params.courseId, req.params.version));
    })
);

partnerPoolRouter.post(
    `${ADMIN_BASE}/durations/:courseId/:version/measure`,
    measureLimiter,
    wrap(async (req, res) => {
        res.json(await courseDurations.requestMeasurement(req.params.courseId, req.params.version, adminOf(req)));
    })
);

partnerPoolRouter.post(
    `${ADMIN_BASE}/durations/:courseId/:version/approve`,
    signPinLimiter,
    requireSignPin,
    wrap(async (req, res) => {
        const { hours, justification } = req.body || {};
        res.json(await courseDurations.approve(req.params.courseId, req.params.version, { hours, justification }, signedAdminOf(req)));
    })
);

partnerPoolRouter.post(
    `${ADMIN_BASE}/durations/:courseId/:version/reject`,
    wrap(async (req, res) => {
        res.json(await courseDurations.reject(req.params.courseId, req.params.version, req.body?.reason, adminOf(req)));
    })
);

partnerPoolRouter.post(
    `${ADMIN_BASE}/durations/:courseId/:version/inherit`,
    signPinLimiter,
    requireSignPin,
    wrap(async (req, res) => {
        res.json(await courseDurations.inheritPrevious(req.params.courseId, req.params.version, req.body?.reason, signedAdminOf(req)));
    })
);

partnerPoolRouter.post(
    `${ADMIN_BASE}/durations/:courseId/:version/confirm-content`,
    signPinLimiter,
    requireSignPin,
    wrap(async (req, res) => {
        res.json(await courseDurations.confirmContent(req.params.courseId, req.params.version, req.body?.reason, signedAdminOf(req)));
    })
);

module.exports = partnerPoolRouter;