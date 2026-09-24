const express = require("express");
const adminClaimsRouter = express.Router();

const auth             = require("../config/firebase");
const adminMiddleware  = require("../middleware/adminMiddleware");
const AdminSignGuard   = require("../models/AdminSignGuard");
const AdminClaimsAudit = require("../models/AdminClaimsAudit");
const { verifyPin }    = require("../utils/signPin");
const {
    USER_PLANS,
    ENTERPRISE_PLANS,
    PURCHASE_CLAIMS,
    MAX_CLAIMS_BYTES,
    getActivePlan,
    buildUserPurchaseClaims,
    buildEnterprisePurchaseClaims,
    claimsByteSize,
} = require("../utils/planClaims");

// ─── Config ───────────────────────────────────────────────────────────────────
const VALID_ACTIONS = [
    "grant_user_plan",   // 1) compra de estudiante (starter/pro/elite/voucher)
    "set_enterprise",    // 2) isEnterprise + empresa + plan opcional (business/enterprise)
    "make_partner",      // 3) partner: true
    "clear_all",         // 4) reset total de claims
    "clear_purchases",   // 5) solo compras
];

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES        = 15;
const UID_REGEX           = /^[A-Za-z0-9_-]{1,128}$/;
const COMPANY_NAME_MAX    = 80;
const LOGO_URL_MAX        = 300;

// ─── Helpers ──────────────────────────────────────────────────────────────────
const getIp = (req) =>
    req.headers["cf-connecting-ip"] || req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.ip || null;

const isAdminClaims = (claims) => claims?.admin === true || claims?.isAdmin === true;

async function audit(req, data) {
    try {
        await AdminClaimsAudit.create({
            adminUid:   req.freshAdmin?.uid || req.user?.uid || "unknown",
            adminEmail: req.freshAdmin?.email || null,
            ip:         getIp(req),
            userAgent:  req.headers["user-agent"]?.slice(0, 300) || null,
            ...data,
        });
    } catch (err) {
        console.error("⚠️ [adminClaims] No se pudo guardar auditoría:", err.message);
    }
}

function sanitizeClaimsForResponse(claims) {
    const c = claims || {};
    return {
        admin:                 c.admin === true || c.isAdmin === true,
        isEnterprise:          !!c.isEnterprise,
        partner:               !!c.partner,
        companyName:           c.companyName ?? null,
        companyLogo:           c.companyLogo ?? null,
        purchases:             Array.isArray(c.purchases) ? c.purchases : [],
        purchaseExpiry:        c.purchaseExpiry || {},
        enterprisePlan:        c.enterprisePlan ?? null,
        enterprisePlanExpiry:  c.enterprisePlanExpiry ?? null,
        vacancyLimit:          c.vacancyLimit ?? null,
        vacanciesUsed:         c.vacanciesUsed ?? 0,
        otherClaims:           Object.keys(c).filter(k => ![
            "admin", "isAdmin", "isEnterprise", "partner", "companyName", "companyLogo",
            "purchases", "purchaseExpiry", "enterprisePlan", "enterprisePlanExpiry",
            "enterprisePurchasedAt", "vacancyLimit", "vacanciesUsed",
        ].includes(k)),
    };
}

function validateCompanyName(value) {
    if (typeof value !== "string") return null;
    const name = value.trim();
    if (name.length < 2 || name.length > COMPANY_NAME_MAX) return null;
    if (/[<>]/.test(name)) return null;
    return name;
}

function validateLogoUrl(value) {
    if (value === null || value === undefined || value === "") return { ok: true, url: null };
    if (typeof value !== "string" || value.length > LOGO_URL_MAX) return { ok: false };
    try {
        const url = new URL(value.trim());
        if (url.protocol !== "https:") return { ok: false };
        return { ok: true, url: url.toString() };
    } catch {
        return { ok: false };
    }
}

// ─── Middleware: re-chequear admin contra Firebase ───────────────────────────
// No confiamos en lo que trae el token/cookie: leemos el usuario en vivo.
async function requireFreshAdmin(req, res, next) {
    const uid = req.user?.uid;
    if (!uid) {
        console.error("⚠️ [adminClaims] adminMiddleware no dejó req.user.uid");
        return res.status(401).json({ message: "SESIÓN_INVÁLIDA" });
    }
    try {
        const adminRecord = await auth.getUser(uid);
        if (adminRecord.disabled || !isAdminClaims(adminRecord.customClaims)) {
            return res.status(403).json({ message: "ACCESO_DENEGADO" });
        }
        req.freshAdmin = { uid: adminRecord.uid, email: adminRecord.email || null };
        next();
    } catch (err) {
        console.error("❌ [adminClaims] Error verificando admin:", err.message);
        return res.status(403).json({ message: "ACCESO_DENEGADO" });
    }
}

// ─── Bloqueo por intentos fallidos ────────────────────────────────────────────
async function getLock(adminUid) {
    const guard = await AdminSignGuard.findOne({ adminUid }).lean();
    if (guard?.lockedUntil && guard.lockedUntil > new Date()) return guard.lockedUntil;
    return null;
}

async function registerFailedAttempt(adminUid) {
    const guard = await AdminSignGuard.findOneAndUpdate(
        { adminUid },
        { $inc: { failedCount: 1 }, $set: { lastFailedAt: new Date() } },
        { upsert: true, new: true }
    );
    if (guard.failedCount >= MAX_FAILED_ATTEMPTS) {
        const lockedUntil = new Date(Date.now() + LOCK_MINUTES * 60 * 1000);
        await AdminSignGuard.updateOne({ adminUid }, { $set: { lockedUntil, failedCount: 0 } });
        return { locked: true, lockedUntil, remaining: 0 };
    }
    return { locked: false, remaining: MAX_FAILED_ATTEMPTS - guard.failedCount };
}

async function resetAttempts(adminUid) {
    await AdminSignGuard.updateOne(
        { adminUid },
        { $set: { failedCount: 0, lockedUntil: null } }
    );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  GET /admin/claims/:uid — lectura (sin clave de firma, no modifica nada)
// ═══════════════════════════════════════════════════════════════════════════════
adminClaimsRouter.get("/admin/claims/:uid", adminMiddleware, requireFreshAdmin, async (req, res) => {
    const { uid } = req.params;
    if (!UID_REGEX.test(uid)) return res.status(400).json({ message: "UID_INVÁLIDO" });

    try {
        const target = await auth.getUser(uid);
        return res.json({
            uid:    target.uid,
            email:  target.email || null,
            claims: sanitizeClaimsForResponse(target.customClaims),
        });
    } catch (err) {
        if (err.code === "auth/user-not-found") return res.status(404).json({ message: "USUARIO_NO_ENCONTRADO" });
        console.error("❌ [adminClaims GET]:", err.message);
        return res.status(500).json({ message: "ERROR_LEYENDO_CLAIMS" });
    }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  POST /admin/claims/:uid — aplicar acción
//  body: { action, pin, plan?, companyName?, companyLogo? }
// ═══════════════════════════════════════════════════════════════════════════════
adminClaimsRouter.post("/admin/claims/:uid", adminMiddleware, requireFreshAdmin, async (req, res) => {
    const adminUid  = req.freshAdmin.uid;
    const targetUid = req.params.uid;
    const { action, pin } = req.body || {};

    // ── 1. Bloqueo vigente ────────────────────────────────────────────────────
    try {
        const lockedUntil = await getLock(adminUid);
        if (lockedUntil) {
            await audit(req, { targetUid, action: String(action).slice(0, 40), result: "locked" });
            return res.status(429).json({
                message:     "CLAVE_BLOQUEADA",
                detail:      `Demasiados intentos fallidos. Reintentá después de las ${lockedUntil.toLocaleTimeString("es-AR")}.`,
                lockedUntil,
            });
        }
    } catch (err) {
        console.error("❌ [adminClaims] Error leyendo bloqueo:", err.message);
        return res.status(500).json({ message: "ERROR_INTERNO" });
    }

    // ── 2. Clave de firma (antes de validar cualquier otra cosa) ───────────────
    let pinOk = false;
    try {
        pinOk = await verifyPin(typeof pin === "string" ? pin : "");
    } catch (err) {
        console.error("❌ [adminClaims] Configuración de clave:", err.message);
        return res.status(500).json({ message: "CLAVE_NO_CONFIGURADA" });
    }

    if (!pinOk) {
        const attempt = await registerFailedAttempt(adminUid);
        await audit(req, { targetUid, action: String(action).slice(0, 40), result: "bad_pin" });
        if (attempt.locked) {
            return res.status(429).json({
                message: "CLAVE_BLOQUEADA",
                detail:  `Clave incorrecta. Bloqueado por ${LOCK_MINUTES} minutos.`,
            });
        }
        return res.status(401).json({
            message:   "CLAVE_INCORRECTA",
            detail:    `Te quedan ${attempt.remaining} intento(s).`,
            remaining: attempt.remaining,
        });
    }
    await resetAttempts(adminUid);

    // ── 3. Validar acción y destino ───────────────────────────────────────────
    if (!VALID_ACTIONS.includes(action)) {
        return res.status(400).json({ message: "ACCIÓN_INVÁLIDA" });
    }
    if (!UID_REGEX.test(targetUid)) {
        return res.status(400).json({ message: "UID_INVÁLIDO" });
    }
    if (targetUid === adminUid) {
        await audit(req, { targetUid, action, result: "rejected", detail: "self" });
        return res.status(403).json({ message: "NO_PODÉS_MODIFICAR_TU_PROPIA_CUENTA" });
    }

    let target;
    try {
        target = await auth.getUser(targetUid);
    } catch (err) {
        if (err.code === "auth/user-not-found") return res.status(404).json({ message: "USUARIO_NO_ENCONTRADO" });
        console.error("❌ [adminClaims] getUser target:", err.message);
        return res.status(500).json({ message: "ERROR_INTERNO" });
    }

    const currentClaims = { ...(target.customClaims || {}) };

    if (isAdminClaims(currentClaims)) {
        await audit(req, { targetUid, targetEmail: target.email, action, result: "rejected", detail: "target_is_admin" });
        return res.status(403).json({ message: "NO_SE_PUEDEN_MODIFICAR_CUENTAS_ADMIN" });
    }

    const purchases      = Array.isArray(currentClaims.purchases) ? currentClaims.purchases : [];
    const purchaseExpiry = currentClaims.purchaseExpiry || {};
    const isEnterprise   = !!currentClaims.isEnterprise;

    // ── 4. Construir claims nuevas según la acción ────────────────────────────
    let newClaims;            // objeto completo a setear (o null para borrar todo)
    let auditPayload = null;  // lo que se registra (sin pin)
    let revokeSessions = false;

    const reject = async (status, message, detail) => {
        await audit(req, { targetUid, targetEmail: target.email, action, payload: auditPayload, result: "rejected", detail: message });
        return res.status(status).json({ message, detail });
    };

    switch (action) {

        // ── 1) Plan de estudiante ─────────────────────────────────────────────
        case "grant_user_plan": {
            const plan = req.body.plan;
            auditPayload = { plan };

            if (!USER_PLANS.includes(plan)) {
                return reject(400, "PLAN_INVÁLIDO", `Planes válidos: ${USER_PLANS.join(", ")}`);
            }
            if (isEnterprise) {
                return reject(409, "USUARIO_ES_ENTERPRISE", "Una cuenta Enterprise no puede tener planes de estudiante. Reseteá el usuario primero.");
            }
            if (plan !== "voucher") {
                const active = getActivePlan(purchases, purchaseExpiry);
                if (active) {
                    return reject(409, "PLAN_ACTIVO_EXISTENTE", `Tiene ${active.toUpperCase()} vigente hasta ${new Date(purchaseExpiry[active]).toLocaleDateString("es-AR")}. Limpiá las compras primero si querés reemplazarlo.`);
                }
            }

            newClaims = { ...currentClaims, ...buildUserPurchaseClaims(currentClaims, [plan]) };
            break;
        }

        // ── 2) Enterprise (+ plan opcional) ───────────────────────────────────
        case "set_enterprise": {
            const companyName = validateCompanyName(req.body.companyName);
            const logo        = validateLogoUrl(req.body.companyLogo);
            const plan        = req.body.plan || null;
            auditPayload = { companyName, companyLogo: logo.url ?? null, plan };

            if (!companyName) {
                return reject(400, "NOMBRE_DE_EMPRESA_INVÁLIDO", `Entre 2 y ${COMPANY_NAME_MAX} caracteres.`);
            }
            if (!logo.ok) {
                return reject(400, "LOGO_INVÁLIDO", `Debe ser una URL https de hasta ${LOGO_URL_MAX} caracteres.`);
            }
            if (plan !== null && !ENTERPRISE_PLANS.includes(plan)) {
                return reject(400, "PLAN_INVÁLIDO", `Planes válidos: ${ENTERPRISE_PLANS.join(", ")}`);
            }
            if (purchases.some(p => USER_PLANS.includes(p))) {
                return reject(409, "TIENE_COMPRAS_DE_ESTUDIANTE", "Limpiá sus compras antes de convertirlo en Enterprise.");
            }
            if (plan) {
                const active = getActivePlan(purchases, purchaseExpiry);
                if (active) {
                    return reject(409, "PLAN_ACTIVO_EXISTENTE", `Tiene ${active.toUpperCase()} vigente hasta ${new Date(purchaseExpiry[active]).toLocaleDateString("es-AR")}. Limpiá las compras primero si querés reemplazarlo.`);
                }
            }

            newClaims = {
                ...currentClaims,
                isEnterprise: true,
                companyName,
                companyLogo:  logo.url,
                ...(plan ? buildEnterprisePurchaseClaims(currentClaims, plan) : {}),
            };
            break;
        }

        // ── 3) Partner ────────────────────────────────────────────────────────
        case "make_partner": {
            newClaims = { ...currentClaims, partner: true };
            break;
        }

        // ── 4) Reset total ────────────────────────────────────────────────────
        // Todas las custom claims son de la app (Firebase no guarda nada nativo
        // ahí), así que borrar todo es más seguro que mantener una lista.
        case "clear_all": {
            newClaims = null;
            revokeSessions = true;
            break;
        }

        // ── 5) Solo compras ───────────────────────────────────────────────────
        case "clear_purchases": {
            newClaims = { ...currentClaims };
            for (const key of PURCHASE_CLAIMS) delete newClaims[key];
            break;
        }
    }

    // ── 5. Límite de tamaño de Firebase ───────────────────────────────────────
    if (newClaims && claimsByteSize(newClaims) > MAX_CLAIMS_BYTES) {
        return reject(413, "CLAIMS_DEMASIADO_GRANDES", `Firebase admite hasta ${MAX_CLAIMS_BYTES} bytes. Acortá el nombre/URL del logo o limpiá compras viejas.`);
    }

    // ── 6. Aplicar ────────────────────────────────────────────────────────────
    try {
        await auth.setCustomUserClaims(targetUid, newClaims);
        if (revokeSessions) await auth.revokeRefreshTokens(targetUid);

        const updated = await auth.getUser(targetUid);

        await audit(req, { targetUid, targetEmail: target.email, action, payload: auditPayload, result: "success" });
        console.log(`✅ [adminClaims] ${req.freshAdmin.email} → ${action} sobre ${target.email}`);

        return res.json({
            message: "CLAIMS_ACTUALIZADAS",
            action,
            claims:  sanitizeClaimsForResponse(updated.customClaims),
        });
    } catch (err) {
        await audit(req, { targetUid, targetEmail: target.email, action, payload: auditPayload, result: "error", detail: err.message?.slice(0, 200) });
        console.error("❌ [adminClaims] setCustomUserClaims:", err.message);
        return res.status(500).json({ message: "ERROR_APLICANDO_CLAIMS" });
    }
});

module.exports = adminClaimsRouter;