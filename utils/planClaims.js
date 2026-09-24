// ═══════════════════════════════════════════════════════════════════════════════
//  planClaims.js — Fuente única de verdad para planes y claims de compra
//  Lo usan adminClaimsRoutes.js y (idealmente) paymentRoutes.js, para que la
//  lógica de vencimientos / vouchers / vacantes nunca se desincronice.
// ═══════════════════════════════════════════════════════════════════════════════

const USER_PLANS       = ["starter", "pro", "elite", "voucher"];
const ENTERPRISE_PLANS = ["business", "enterprise"];

// Meses de vigencia por plan (voucher no vence por tiempo)
const PLAN_DURATIONS = {
    starter:    3,
    pro:        6,
    elite:      12,
    business:   6,
    enterprise: 12,
};

// Vouchers que se suman automáticamente al comprar el plan
const BUNDLED_VOUCHERS = {
    elite: 2,
    pro:   1,
};

// Límite de publicaciones de vacantes por plan enterprise (null = ilimitado)
const ENTERPRISE_VACANCY_LIMITS = {
    business:   3,
    enterprise: null,
};

// Claims que representan una COMPRA (se borran en "limpiar compras").
// isEnterprise / companyName / companyLogo / partner / certificaciones NO son compras.
const PURCHASE_CLAIMS = [
    "purchases",
    "purchaseExpiry",
    "enterprisePlan",
    "enterprisePlanExpiry",
    "enterprisePurchasedAt",
    "vacancyLimit",
    "vacanciesUsed",
];

// Firebase rechaza custom claims de más de 1000 bytes serializados
const MAX_CLAIMS_BYTES = 1000;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function calcExpiresAt(planId, from = new Date()) {
    const months = PLAN_DURATIONS[planId];
    if (!months) return null; // voucher → sin vencimiento
    const d = new Date(from);
    d.setMonth(d.getMonth() + months);
    return d;
}

// Devuelve el primer plan (no voucher) que siga vigente, o null
function getActivePlan(purchases, purchaseExpiry) {
    if (!Array.isArray(purchases)) return null;
    const now = new Date();
    for (const planId of purchases) {
        if (planId === "voucher") continue;
        const expiryStr = purchaseExpiry?.[planId];
        if (!expiryStr) continue;
        if (new Date(expiryStr) > now) return planId;
    }
    return null;
}

// Arma purchases + purchaseExpiry para un usuario normal, idéntico a payments:
// planes no-voucher sin duplicar, vouchers acumulados, bundled expandidos.
function buildUserPurchaseClaims(currentClaims, items) {
    const existingPurchases = Array.isArray(currentClaims.purchases) ? currentClaims.purchases : [];
    const existingExpiry    = currentClaims.purchaseExpiry || {};

    const expandedItems = [];
    for (const item of items) {
        expandedItems.push(item);
        const bundled = BUNDLED_VOUCHERS[item] || 0;
        for (let i = 0; i < bundled; i++) expandedItems.push("voucher");
    }

    const nonVoucherExisting = existingPurchases.filter(i => i !== "voucher");
    const nonVoucherNew      = expandedItems.filter(i => i !== "voucher");
    const voucherCount       = existingPurchases.filter(i => i === "voucher").length
                             + expandedItems.filter(i => i === "voucher").length;

    const purchases = [
        ...new Set([...nonVoucherExisting, ...nonVoucherNew]),
        ...Array(voucherCount).fill("voucher"),
    ];

    const purchaseExpiry = { ...existingExpiry };
    for (const planId of items) {
        const expiresAt = calcExpiresAt(planId);
        if (expiresAt) purchaseExpiry[planId] = expiresAt.toISOString();
    }

    return { purchases, purchaseExpiry };
}

// Arma las claims de compra enterprise, idéntico a payments
function buildEnterprisePurchaseClaims(currentClaims, planId) {
    const existingPurchases = Array.isArray(currentClaims.purchases) ? currentClaims.purchases : [];
    const existingExpiry    = currentClaims.purchaseExpiry || {};
    const expiresAt         = calcExpiresAt(planId);

    return {
        purchases:             [...new Set([...existingPurchases, planId])],
        purchaseExpiry:        { ...existingExpiry, [planId]: expiresAt.toISOString() },
        enterprisePlan:        planId,
        enterprisePlanExpiry:  expiresAt.toISOString(),
        enterprisePurchasedAt: new Date().toISOString(),
        vacancyLimit:          ENTERPRISE_VACANCY_LIMITS[planId],
        vacanciesUsed:         currentClaims.vacanciesUsed ?? 0,
    };
}

function claimsByteSize(claims) {
    return Buffer.byteLength(JSON.stringify(claims || {}), "utf8");
}

module.exports = {
    USER_PLANS,
    ENTERPRISE_PLANS,
    PLAN_DURATIONS,
    BUNDLED_VOUCHERS,
    ENTERPRISE_VACANCY_LIMITS,
    PURCHASE_CLAIMS,
    MAX_CLAIMS_BYTES,
    calcExpiresAt,
    getActivePlan,
    buildUserPurchaseClaims,
    buildEnterprisePurchaseClaims,
    claimsByteSize,
};