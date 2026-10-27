const {
    ACCESS_TYPES,
    POOL_ELIGIBILITY,
    COMPANY_PLANS,
    NON_PLAN_PURCHASES,
} = require("../constants/accessTypes");

// ─────────────────────────────────────────────────────────────────────
// Decide si req.user puede cursar req.course y con qué tipo de acceso.
// Deja req.access = { accessType, plan, partnerPoolEligible }
// que después se guarda en cada evento.
//
// Reglas actuales:
// - admin           → entra siempre (también a cursos DRAFT), no suma al Pool
// - test            → entra siempre, no suma al Pool
// - curso DRAFT     → solo admin/test (el resto recibe 404)
// - resto           → necesita un plan vigente (purchases + purchaseExpiry)
//                     y que ese plan esté en course.access.plans ("ANY" = cualquiera)
// ⚠️ Confirmar con la clienta qué planes dan acceso a cursos de partners.
// ─────────────────────────────────────────────────────────────────────

function getActivePlans(claims) {
    const purchases = Array.isArray(claims.purchases) ? claims.purchases : [];
    const expiry = claims.purchaseExpiry || {};
    const now = Date.now();

    return purchases
        .map(String)
        .filter((p) => !NON_PLAN_PURCHASES.includes(p))
        .filter((p) => {
            const e = expiry[p];
            return e && new Date(e).getTime() > now;
        });
}

function resolveAccess(user, course) {
    if (user.admin === true) {
        return { allowed: true, accessType: ACCESS_TYPES.ADMIN, plan: null };
    }
    if (user.test === true) {
        return { allowed: true, accessType: ACCESS_TYPES.TEST, plan: null };
    }
    if (course.status !== "ACTIVE") {
        return { allowed: false, status: 404, message: "Curso no encontrado" };
    }

    const allowedPlans = course.access.plans;
    const activePlans = getActivePlans(user).filter(
        (p) => allowedPlans === "ANY" || allowedPlans.includes(p)
    );

    if (!activePlans.length) {
        return {
            allowed: false,
            status: 403,
            message: "Necesitás un plan activo para acceder a este curso",
        };
    }

    // Si tiene algún plan personal, cuenta como PAID_PLAN; si solo tiene planes de empresa, COMPANY_PLAN
    const personal = activePlans.find((p) => !COMPANY_PLANS.includes(p));
    return {
        allowed: true,
        accessType: personal ? ACCESS_TYPES.PAID_PLAN : ACCESS_TYPES.COMPANY_PLAN,
        plan: personal || activePlans[0],
    };
}

module.exports = function requireCourseAccess(req, res, next) {
    const access = resolveAccess(req.user, req.course);

    if (!access.allowed) {
        return res.status(access.status).json({ error: access.message });
    }

    req.access = {
        accessType: access.accessType,
        plan: access.plan,
        partnerPoolEligible:
            POOL_ELIGIBILITY[access.accessType] === true &&
            req.course.partnerPool.enabled &&
            req.course.status === "ACTIVE",
    };
    next();
};

module.exports.resolveAccess = resolveAccess;