const {
    ACCESS_TYPES,
    POOL_ELIGIBILITY,
    COMPANY_PLANS,
    NON_PLAN_PURCHASES,
} = require("../constants/accessTypes");

// ⚠️ Ajustá la ruta si tu config de Firebase está en otro lugar
const auth = require("../../../config/firebase");

// ─────────────────────────────────────────────────────────────────────
// Decide si req.user puede cursar req.course y con qué tipo de acceso.
// Deja req.access = { accessType, plan, role, partnerBanned, partnerPoolEligible }
// que después se guarda en cada evento (historial inmutable).
//
// Reglas de acceso:
// - admin           → entra siempre (también a cursos DRAFT), no suma al Pool
// - test            → entra siempre, no suma al Pool
// - curso DRAFT     → solo admin/test (el resto recibe 404)
// - resto           → necesita un plan vigente (purchases + purchaseExpiry)
//
// Para el Pool se guarda además, en el momento del avance:
// - role:          student | admin | partner | enterprise  (solo "student" suma)
// - partnerBanned: si la cuenta partner de la empresa estaba baneada desde
//                  ClaimsManager. Lo hecho durante un ban nunca suma, aunque
//                  después se la desbanee.
// La plata y la elegibilidad final se verifican contra los PAGOS al liquidar
// (partnerPoolRevenue.js): un plan dado a mano o con cupón 100% no suma.
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

function roleOf(user) {
    if (user.admin === true || user.isAdmin === true) return "admin";
    if (user.partner === true) return "partner";
    if (user.isEnterprise === true) return "enterprise";
    return "student";
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

    const personal = activePlans.find((p) => !COMPANY_PLANS.includes(p));
    return {
        allowed: true,
        accessType: personal ? ACCESS_TYPES.PAID_PLAN : ACCESS_TYPES.COMPANY_PLAN,
        plan: personal || activePlans[0],
    };
}

// ─── ¿La empresa está baneada ahora? ─────────────────────────────────
// Se busca la cuenta partner de Firebase por el email de partner.config.js.
// Caché corta (60 s) para no consultar Firebase en cada paso del alumno.
const BAN_CACHE_MS = 60 * 1000;
const banCache = new Map(); // email → { banned, at }

async function isPartnerBanned(email) {
    if (!email) return false; // sin email configurado no hay cuenta que banear
    const cached = banCache.get(email);
    if (cached && Date.now() - cached.at < BAN_CACHE_MS) return cached.banned;

    let banned;
    try {
        const record = await auth.getUserByEmail(email);
        banned = record.customClaims?.banned === true || record.disabled === true;
    } catch (err) {
        if (err?.code === "auth/user-not-found") {
            banned = false;
        } else {
            // Firebase no respondió: no se cachea y el evento queda marcado como desconocido
            console.error("[externalCourses] no se pudo verificar el ban del partner:", err.message);
            return null;
        }
    }
    banCache.set(email, { banned, at: Date.now() });
    return banned;
}

module.exports = async function requireCourseAccess(req, res, next) {
    try {
        const access = resolveAccess(req.user, req.course);

        if (!access.allowed) {
            return res.status(access.status).json({ error: access.message });
        }

        const role = roleOf(req.user);
        const partnerBanned = await isPartnerBanned(req.course.partnerEmail);

        req.access = {
            accessType: access.accessType,
            plan: access.plan,
            role,
            partnerBanned,
            partnerPoolEligible:
                POOL_ELIGIBILITY[access.accessType] === true &&
                role === "student" &&
                partnerBanned === false &&
                req.course.partnerPool.enabled &&
                req.course.status === "ACTIVE",
        };
        next();
    } catch (err) {
        next(err);
    }
};

module.exports.resolveAccess = resolveAccess;
module.exports.isPartnerBanned = isPartnerBanned;