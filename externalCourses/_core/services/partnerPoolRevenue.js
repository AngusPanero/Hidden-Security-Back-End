// ─────────────────────────────────────────────────────────────────────
// Ingresos, suscripciones y alumnos elegibles del Partner Pool,
// sacados de la colección de pagos. ÚNICO archivo del pool que toca pagos.
//
// ⚠️ Ajustá estas rutas si tus archivos están en otro lugar
// ─────────────────────────────────────────────────────────────────────
const PaymentsMongo = require("../../../models/Payments");
const Coupon = require("../../../models/CouponSchema");
const auth = require("../../../config/firebase");
const { PLAN_PRICES, PLAN_DURATIONS } = require("../../../routes/paymentRoutes");
const { POOL_PLANS } = require("../constants/accessTypes");

// ═════════════════════════════════════════════════════════════════════
//  REGLAS
//
//  Qué pago cuenta (un "plan elegible")
//   - status "approved", no es de prueba (isTest), monto mayor a $0
//     (un cupón del 100% no genera ingreso → no suma nada, ni puntos)
//   - incluye starter, pro o elite (voucher, business y enterprise no cuentan)
//   - el comprador es un alumno: admin, partner y enterprise nunca cuentan
//
//  Cuánto vale (todo plan se valúa como un starter)
//   valor = mínimo entre lo que pagó y el starter con el % de cupón aplicado
//           (nunca supera lo abonado; el voucher y la duración no suman)
//   neto  = valor − comisión de Mercado Pago (5%, configurable)
//   El neto se reparte en partes iguales por día, desde que el plan se activó
//   (cuando el alumno puede empezar a sumar puntos) hasta que vence.
//   Cada mes toma solo los días de ese mes: a lo largo de toda la vigencia el
//   plan suma exactamente su neto, nunca más.
//
//  Ejemplos (starter = $100.000, comisión 5%)
//   starter sin cupón    → $100.000 → neto $95.000 en sus 3 meses
//   elite sin cupón      → $100.000 → neto $95.000 en sus 12 meses
//   starter con cupón 20%→ $80.000  → neto $76.000
//   pro con cupón 100%   → $0       → no cuenta
//
//  Suscripciones elegibles del mes: alumnos distintos con un plan elegible
//  vigente al menos un día del mes.
//
//  Puntos: un avance del alumno suma solo si en ese momento tenía un plan
//  elegible vigente (windowsByUser). Lo que hizo con el plan vigente se
//  mantiene aunque después venza.
// ═════════════════════════════════════════════════════════════════════

function addMonths(date, months) {
    const d = new Date(date);
    d.setMonth(d.getMonth() + months);
    return d;
}

const itemsOf = (p) => {
    const list = Array.isArray(p.items) && p.items.length ? p.items : String(p.plan || "").split("+");
    return list.map((i) => String(i).trim().toLowerCase()).filter(Boolean);
};

// Roles de staff según las claims de Firebase (lotes de 100)
async function fetchStaffUids(uids) {
    const staff = new Set();
    const unique = [...new Set(uids)].filter(Boolean);
    for (let i = 0; i < unique.length; i += 100) {
        const chunk = unique.slice(i, i + 100).map((uid) => ({ uid }));
        const result = await auth.getUsers(chunk);
        for (const u of result.users) {
            const c = u.customClaims || {};
            if (c.admin === true || c.isAdmin === true || c.partner === true || c.isEnterprise === true) {
                staff.add(u.uid);
            }
        }
    }
    return staff;
}

// Ventanas de plan elegible de una lista de pagos (sin filtrar por período)
async function buildWindows(payments, revenueConfig) {
    const eligiblePlans = (revenueConfig.eligiblePlans || POOL_PLANS).map((p) => String(p).toLowerCase());
    const basePlan = String(revenueConfig.basePlan || "starter").toLowerCase();
    const baseValue = Number(PLAN_PRICES[basePlan]);
    if (!Number.isFinite(baseValue) || baseValue <= 0) {
        throw new Error(`Precio del plan base "${basePlan}" no definido en paymentRoutes`);
    }

    // Cupones usados (para saber si el descuento aplicó al plan)
    const codes = [...new Set(payments.map((p) => p.couponUsed).filter(Boolean))];
    const coupons = codes.length
        ? await Coupon.find({ code: { $in: codes } }).select("code scope allowedPlans").lean()
        : [];
    const couponByCode = new Map(coupons.map((c) => [c.code, c]));

    const windows = [];
    let excludedFree = 0;

    for (const p of payments) {
        const plan = itemsOf(p).find((i) => eligiblePlans.includes(i));
        if (!plan) continue;

        const amount = Number(p.amount) || 0;
        if (amount <= 0) {
            excludedFree++;
            continue;
        }

        // % de cupón sobre el plan. Si el cupón ya no existe se asume que aplicó
        // (es lo más prudente: valúa el plan más bajo).
        let discountRate = 0;
        const pct = Number(p.discount) || 0;
        if (p.couponUsed && pct > 0) {
            const c = couponByCode.get(p.couponUsed);
            const applies = !c || c.scope !== "plans" || (c.allowedPlans || []).includes(plan);
            if (applies) discountRate = Math.min(Math.max(pct / 100, 0), 1);
        }

        const value = Math.min(amount, baseValue * (1 - discountRate));
        if (value <= 0) {
            excludedFree++;
            continue;
        }

        const start = new Date(p.fulfilledAt || p.date);
        const end = p.expiresAt ? new Date(p.expiresAt) : addMonths(start, PLAN_DURATIONS[plan] || 0);
        if (!(end > start)) continue;

        windows.push({
            userId: String(p.client_id),
            plan,
            start,
            end,
            value,
            discountRate,
            paymentId: String(p._id),
        });
    }

    return { windows, excludedFree };
}

/**
 * Calcula ingresos y suscripciones elegibles del período [from, to)
 * y las ventanas de plan elegible de los alumnos (para validar los puntos).
 */
async function computeRevenue({ from, to, revenueConfig = {} }) {
    const mpFeeRate = Number(revenueConfig.mpFeeRate ?? 0.05);
    const eligiblePlans = (revenueConfig.eligiblePlans || POOL_PLANS).map((p) => String(p).toLowerCase());

    // Pagos de planes elegibles vigentes en algún momento del período
    // (los pagos viejos sin "items" se buscan por el campo "plan": "starter+voucher")
    const planRegex = eligiblePlans.map((p) => new RegExp(`(^|\\+)${p}(\\+|$)`));
    const payments = await PaymentsMongo.find({
        status: "approved",
        isTest: { $ne: true },
        amount: { $gt: 0 },
        date: { $lt: to },
        $and: [
            { $or: [{ items: { $in: eligiblePlans } }, { plan: { $in: planRegex } }] },
            { $or: [{ expiresAt: { $gte: from } }, { expiresAt: null }] },
        ],
    })
        .select("client_id items plan amount couponUsed discount date fulfilledAt expiresAt")
        .lean();

    const { windows: allWindows, excludedFree } = await buildWindows(payments, revenueConfig);

    const staff = await fetchStaffUids(allWindows.map((w) => w.userId));
    const windows = allWindows.filter((w) => !staff.has(w.userId));

    let gross = 0;
    const subscribers = new Set();
    const planCounts = {};
    let discountedPlans = 0;

    for (const w of windows) {
        const overlap = Math.min(w.end, to) - Math.max(w.start, from);
        if (overlap <= 0) continue;
        const fraction = overlap / (w.end - w.start);
        gross += w.value * fraction;
        subscribers.add(w.userId);
        planCounts[w.plan] = (planCounts[w.plan] || 0) + 1;
        if (w.discountRate > 0) discountedPlans++;
    }

    const fees = gross * mpFeeRate;

    const windowsByUser = new Map();
    for (const w of windows) {
        if (!windowsByUser.has(w.userId)) windowsByUser.set(w.userId, []);
        windowsByUser.get(w.userId).push({ start: w.start, end: w.end });
    }

    return {
        eligibleNetTrainingRevenue: gross - fees,
        eligibleSubscriptions: subscribers.size,
        windowsByUser,
        staffUserIds: staff,
        breakdown: {
            activePlans: subscribers.size,
            planCounts,
            discountedPlans,
            excludedFreePayments: excludedFree,
            excludedStaffPlans: allWindows.length - windows.length,
            grossAmount: gross,
            feesAmount: fees,
            basePlan: String(revenueConfig.basePlan || "starter").toLowerCase(),
            basePlanPrice: Number(PLAN_PRICES[String(revenueConfig.basePlan || "starter").toLowerCase()]),
            mpFeeRate,
        },
    };
}

// ¿El alumno tenía un plan elegible vigente en ese momento?
function hadEligiblePlan(windowsByUser, userId, at) {
    const list = windowsByUser.get(String(userId));
    if (!list) return false;
    const t = new Date(at).getTime();
    return list.some((w) => t >= w.start.getTime() && t < w.end.getTime());
}

module.exports = { computeRevenue, hadEligiblePlan, buildWindows };