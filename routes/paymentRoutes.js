// Express y Router
const express = require("express")
const crypto  = require("crypto")
const paymentsRouter = express.Router()
// Mongo
const PaymentsMongo = require("../models/Payments")
const Coupon        = require("../models/CouponSchema")

const adminMiddleware = require("../middleware/adminMiddleware")
const verifyToken     = require("../middleware/authMiddleware")
const auth            = require("../config/firebase")

const { notifyNewSale }        = require("../sseManager/sseManajer")
const { refreshSessionCookie } = require("../utils/refreshsessioncookie")

// ─── Mercado Pago SDK ────────────────────────────────────────────────────────
const { MercadoPagoConfig, Payment } = require("mercadopago")

const mpClient = new MercadoPagoConfig({
    accessToken: process.env.MP_ACCESS_TOKEN
});

const paymentInstance = new Payment(mpClient);

const esProduccion = (process.env.NODE_ENV === 'production');

// ─── Constantes ────────────────────────────────────────────────────────────────
const PLAN_DURATIONS = {
    starter:    3,
    pro:        6,
    elite:      12,
    business:   6,
    enterprise: 12,
    // voucher: undefined — sin vencimiento por tiempo
};

const VALID_PLANS = ['starter', 'pro', 'elite', 'voucher', 'business', 'enterprise'];

const PLAN_PRICES = {
    starter:    100000,
    pro:        200000,
    elite:      300000,
    voucher:    150000,
    business:   900000,
    enterprise: 1500000,
};

const BUNDLED_VOUCHERS = {
    'elite': 2,
    'pro':   1,
};

// Recargo por cuotas — debe reflejar exactamente lo que muestra el checkout
const INTERES_RATES = { "1": 0, "3": 0.05, "6": 0.10, "12": 0.20 };

// Cuotas sin interés por plan. Si un plan no está listado se asume 1,
// para no otorgar un beneficio por accidente en planes/promos nuevas.
const PLAN_CUOTAS_SIN_INTERES = {
    starter:    6,
    pro:        6,
    elite:      6,
    voucher:    6,
    business:   6,
    enterprise: 6,
};

// Planes exclusivos por tipo de usuario
const ENTERPRISE_PLANS = ['business', 'enterprise'];
const USER_PLANS       = ['starter', 'pro', 'elite', 'voucher'];

// Planes que admiten el voucher como add-on (pro y elite ya lo incluyen)
const PLANS_WITH_VOUCHER_ADDON = ['starter'];

// Límite de publicaciones por plan enterprise
const ENTERPRISE_VACANCY_LIMITS = {
    business:   3,    // 6 meses → 3 publicaciones
    enterprise: null, // 12 meses → ilimitadas (null = sin límite)
};

// Estados de MP que todavía pueden terminar aprobados
const PENDING_STATUSES = ['pending', 'in_process', 'authorized'];
// Estados que cuentan como "compra" para el usuario y el admin
const VISIBLE_STATUSES = ['approved', ...PENDING_STATUSES];
// Ventana en la que una orden 'created' se considera en curso
const ORDER_IN_FLIGHT_MS   = 15 * 60 * 1000;
// Tiempo tras el cual una activación 'processing' se considera colgada y se reintenta
const FULFILLMENT_STALE_MS = 2 * 60 * 1000;


// ═══════════════════════════════════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Helper: calcular fecha de expiración ──────────────────────────────────────
function calcExpiresAt(planId) {
    const months = PLAN_DURATIONS[planId];
    if (!months) return null; // voucher → null
    const d = new Date();
    d.setMonth(d.getMonth() + months);
    return d;
}

// ─── Helper: chequear si el usuario tiene un plan activo no vencido ────────────
// Retorna el planId activo, o null si no hay ninguno
function getActivePlan(purchases, purchaseExpiry) {
    if (!Array.isArray(purchases)) return null;
    const now = new Date();
    for (const planId of purchases) {
        if (planId === 'voucher') continue; // voucher no bloquea
        const expiryStr = purchaseExpiry?.[planId];
        if (!expiryStr) continue;
        if (new Date(expiryStr) > now) return planId;
    }
    return null;
}

// ─── Helper: cuotas sin interés según el plan principal de la compra ───────────
function getCuotasSinInteresParaCompra(items) {
    const mainItem = items.find(i => i !== 'voucher') || items[0];
    return PLAN_CUOTAS_SIN_INTERES[mainItem] ?? 1;
}

// ─── Helper: escribir las claims de la compra ─────────────────────────────────
// Lee las claims frescas del usuario y le suma lo comprado.
// Lo usan /test-course-payment y la activación de /course-payment + webhook.
// Retorna la fecha de vencimiento del plan principal (para guardar en DB).
async function applyPurchaseClaims(order) {
    const uid   = order.client_id;
    const items = order.items;

    const userRecord        = await auth.getUser(uid);
    const currentClaims     = userRecord.customClaims || {};
    const existingPurchases = Array.isArray(currentClaims.purchases) ? currentClaims.purchases : [];
    const newExpiry         = { ...(currentClaims.purchaseExpiry || {}) };

    // ── Claims enterprise ─────────────────────────────────────────────────────
    if (order.isEnterprise) {
        const planId       = items[0]; // siempre un solo plan enterprise
        const expiresAt    = calcExpiresAt(planId);
        const vacancyLimit = ENTERPRISE_VACANCY_LIMITS[planId]; // null = ilimitado

        newExpiry[planId] = expiresAt.toISOString();

        await auth.setCustomUserClaims(uid, {
            ...currentClaims,
            purchases:             [...new Set([...existingPurchases, planId])],
            purchaseExpiry:        newExpiry,
            enterprisePlan:        planId,
            enterprisePlanExpiry:  expiresAt.toISOString(),
            enterprisePurchasedAt: new Date().toISOString(),
            vacancyLimit,                                    // 3 para business, null para enterprise
            vacanciesUsed:         currentClaims.vacanciesUsed ?? 0,
        });

        console.log(`✅ Enterprise claims para ${uid}: plan=${planId}, vacancyLimit=${vacancyLimit ?? 'ilimitado'}`);
        return expiresAt;
    }

    // ── Claims usuario normal ─────────────────────────────────────────────────
    // Expandir vouchers incluidos (pro → +1, elite → +2)
    const expandedItems = [];
    for (const item of items) {
        expandedItems.push(item);
        const count = BUNDLED_VOUCHERS[item] || 0;
        for (let i = 0; i < count; i++) expandedItems.push('voucher');
    }

    const nonVoucherExisting = existingPurchases.filter(i => i !== 'voucher');
    const nonVoucherNew      = expandedItems.filter(i => i !== 'voucher');
    const voucherCount       = existingPurchases.filter(i => i === 'voucher').length
                             + expandedItems.filter(i => i === 'voucher').length;

    const updatedPurchases = [
        ...new Set([...nonVoucherExisting, ...nonVoucherNew]),
        ...Array(voucherCount).fill('voucher'),
    ];

    for (const planId of items) {
        const expiresAt = calcExpiresAt(planId);
        if (!expiresAt) continue;
        newExpiry[planId] = expiresAt.toISOString();
        console.log(`📅 ${planId.toUpperCase()} expira: ${expiresAt.toISOString()}`);
    }

    await auth.setCustomUserClaims(uid, {
        ...currentClaims,
        purchases:      updatedPurchases,
        purchaseExpiry: newExpiry,
    });

    console.log(`✅ User claims para ${uid}:`, updatedPurchases);

    const mainPlan = items.find(i => i !== 'voucher') || items[0];
    return calcExpiresAt(mainPlan);
}

// ─── Helper: consumir cupón (solo con el pago ya aprobado) ────────────────────
// El cobro ya ocurrió, así que se honra el cupón aunque en el medio se haya agotado.
async function consumeCoupon(code, email) {
    const coupon = await Coupon.findOne({ code });
    if (!coupon) {
        console.warn(`⚠️ Cupón ${code} no encontrado al consumirlo (pago ya aprobado).`);
        return;
    }

    if (coupon.type === 'single_use') {
        await Coupon.updateOne({ _id: coupon._id }, { $addToSet: { usedBy: email }, $set: { isActive: false } });
    } else if (coupon.type === 'limited_uses') {
        const updated = await Coupon.findByIdAndUpdate(
            coupon._id,
            { $addToSet: { usedBy: email }, $inc: { usesCount: 1 } },
            { returnDocument: 'after' }
        );
        if (updated.maxUses !== null && updated.usesCount >= updated.maxUses)
            await Coupon.updateOne({ _id: coupon._id }, { $set: { isActive: false } });
    } else if (coupon.type === 'date_limited') {
        await Coupon.updateOne({ _id: coupon._id }, { $addToSet: { usedBy: email } });
    }

    console.log(`✅ Cupón ${code} consumido.`);
}

// ─── Helper: activar una orden aprobada (claims + cupón) ──────────────────────
// Lo llaman /course-payment y el webhook. Por eso es una función aparte:
// el lock sobre `fulfillment` garantiza que se active UNA sola vez aunque
// lleguen los dos al mismo tiempo. Los flags claimsApplied / couponConsumed
// permiten reintentar sin repetir pasos que ya se hicieron.
async function fulfillOrder(orderMongoId) {
    const staleLimit = new Date(Date.now() - FULFILLMENT_STALE_MS);

    // 1. Tomar el lock (solo si está aprobada y nadie la está activando)
    const order = await PaymentsMongo.findOneAndUpdate(
        {
            _id: orderMongoId,
            status: 'approved',
            $or: [
                { fulfillment: { $in: ['none', 'error'] } },
                { fulfillment: 'processing', fulfillmentStartedAt: { $lt: staleLimit } },
            ],
        },
        { $set: { fulfillment: 'processing', fulfillmentStartedAt: new Date() } },
        { returnDocument: 'after' }
    );

    if (!order) {
        // Otro proceso ya la activó o la está activando
        const current = await PaymentsMongo.findById(orderMongoId).select('fulfillment').lean();
        return { ok: current?.fulfillment === 'done' };
    }

    try {
        // 2. Claims
        if (!order.claimsApplied) {
            order.expiresAt     = await applyPurchaseClaims(order);
            order.claimsApplied = true;
            await order.save();
        }

        // 3. Cupón
        if (order.couponUsed && !order.couponConsumed) {
            await consumeCoupon(order.couponUsed, order.email);
            order.couponConsumed = true;
            await order.save();
        }

        // 4. Listo
        order.fulfillment      = 'done';
        order.fulfilledAt      = new Date();
        order.fulfillmentError = null;
        await order.save();

        try { notifyNewSale(order); } catch (e) { console.error("⚠️ notifyNewSale falló:", e.message); }

        console.log(`✅ Orden ${order.orderId} activada.`);
        return { ok: true };

    } catch (error) {
        console.error(`❌ Falló la activación de la orden ${order.orderId}:`, error.message);
        await PaymentsMongo.updateOne(
            { _id: order._id },
            { $set: { fulfillment: 'error', fulfillmentError: error.message } }
        );
        return { ok: false };
    }
}

// ─── Helper: claims actuales para devolver al front ───────────────────────────
async function getFreshPurchaseClaims(uid) {
    const { customClaims = {} } = await auth.getUser(uid);
    return {
        purchases:      customClaims.purchases ?? [],
        purchaseExpiry: customClaims.purchaseExpiry ?? {},
        ...(customClaims.isEnterprise && {
            enterprisePlan: customClaims.enterprisePlan ?? null,
            vacancyLimit:   customClaims.vacancyLimit ?? null,
        }),
    };
}

// ─── Helper: renovar la cookie con las claims nuevas ──────────────────────────
// Si falla no rompe la compra: /api/refresh-claims lo reintenta en la próxima carga.
async function safeRefreshSession(uid, res) {
    try {
        await refreshSessionCookie(uid, res);
    } catch (error) {
        console.error("⚠️ No se pudo renovar la cookie de sesión:", error.message);
    }
}

// ─── Helper: validar la firma del webhook de Mercado Pago ─────────────────────
function verifyMpSignature(req, dataId) {
    const secret = process.env.MP_WEBHOOK_SECRET;
    if (!secret) {
        console.error("❌ MP_WEBHOOK_SECRET no configurado");
        return false;
    }

    const xSignature = req.headers['x-signature'];
    const xRequestId = req.headers['x-request-id'];
    if (!xSignature) return false;

    const parts = {};
    for (const part of String(xSignature).split(',')) {
        const [key, value] = part.split('=').map(s => s?.trim());
        if (key && value) parts[key] = value;
    }
    if (!parts.ts || !parts.v1) return false;

    const id = /^[a-z0-9]+$/i.test(String(dataId)) ? String(dataId).toLowerCase() : String(dataId);
    let manifest = `id:${id};`;
    if (xRequestId) manifest += `request-id:${xRequestId};`;
    manifest += `ts:${parts.ts};`;

    const expected = crypto.createHmac('sha256', secret).update(manifest).digest('hex');
    return parts.v1.length === expected.length
        && crypto.timingSafeEqual(Buffer.from(parts.v1), Buffer.from(expected));
}


// ═══════════════════════════════════════════════════════════════════════════════
//  TICKETS
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Tickets del usuario (solo los propios) ────────────────────────────────────
paymentsRouter.get("/tickets", verifyToken, async (req, res) => {
    try {
        const payments = await PaymentsMongo
            .find({ client_id: req.user.uid, status: { $in: VISIBLE_STATUSES } })
            .sort({ date: -1 })
            .select('-__v');
        return res.status(200).json(payments);
    } catch (error) {
        console.error("Error getting tickets!", error);
        return res.status(500).json({ message: "Error getting tickets! 🔴" });
    }
});

paymentsRouter.get("/all-tickets", adminMiddleware, async (req, res) => {
    try {
        const allPayments = await PaymentsMongo
            .find({ status: { $in: VISIBLE_STATUSES } })
            .sort({ createdAt: -1 });
        if (!allPayments || allPayments.length === 0)
            return res.status(404).json({ message: "No sales records found! 🔴" });
        return res.status(200).json(allPayments);
    } catch (error) {
        console.error("Error fetching all tickets!", error);
        res.status(500).json({ message: "Internal Server Error 🔴" });
    }
});


// ═══════════════════════════════════════════════════════════════════════════════
//  🔧 DEV — POST /test-course-payment
// ═══════════════════════════════════════════════════════════════════════════════
// Sin validaciones de negocio: acepta cualquier combinación de planes y datos,
// no cobra, no consume cupones y siempre aprueba. Sí escribe claims reales,
// guarda el pago (isTest: true), notifica al admin y renueva la cookie.
// ⚠️ Para producción: comentar o eliminar esta ruta completa.
paymentsRouter.post("/test-course-payment", verifyToken, async (req, res) => {
    const { payer = {}, couponCode, installments } = req.body;
    const uid = req.user.uid;

    console.log("🧪 [CURSO_SIMULACIÓN] Iniciando proceso...");

    // ── 1. ITEMS: único requisito, que sean planes que existan ────────────────
    const items = (Array.isArray(req.body.items) ? req.body.items : []).filter(i => VALID_PLANS.includes(i));
    if (items.length === 0)
        return res.status(400).json({ message: `Mandá al menos un plan válido: ${VALID_PLANS.join(', ')} 🔴`, code: "INVALID_PLAN" });

    // Cualquier dato vacío queda en "N/A"
    const testValue = (v) => (v === undefined || v === null || String(v).trim() === '') ? "N/A" : String(v).trim();

    try {
        // ── 2. LEER CLAIMS ────────────────────────────────────────────────────
        const userRecord    = await auth.getUser(uid);
        const currentClaims = userRecord.customClaims || {};

        // ── 3. CUPÓN OPCIONAL (se aplica si existe, nunca se consume) ─────────
        let appliedDiscount    = 0;
        let couponScope        = null;
        let couponAllowedPlans = [];
        let couponCodeUsed     = null;

        if (couponCode) {
            const coupon = await Coupon.findOne({ code: String(couponCode).trim().toUpperCase(), isActive: true });
            if (coupon) {
                appliedDiscount    = coupon.discount;
                couponScope        = coupon.scope;
                couponAllowedPlans = coupon.allowedPlans || [];
                couponCodeUsed     = coupon.code;
            }
        }

        // ── 4. CALCULAR MONTO (cuotas inválidas → 1 pago) ─────────────────────
        const cuotas = INTERES_RATES.hasOwnProperty(String(installments)) ? Number(installments) : 1;

        const baseAmount       = items.reduce((acc, planId) => acc + (PLAN_PRICES[planId] || 0), 0);
        const cuotasSinInteres = getCuotasSinInteresParaCompra(items);
        const tasaInteres      = (cuotas > 1 && cuotas > cuotasSinInteres) ? (INTERES_RATES[String(cuotas)] || 0) : 0;
        const totalConInteres  = baseAmount * (1 + tasaInteres);

        let discountAmount = 0;
        if (appliedDiscount > 0) {
            if (couponScope === 'plans') {
                const discountableBase = items
                    .filter(i => couponAllowedPlans.includes(i))
                    .reduce((acc, i) => acc + (PLAN_PRICES[i] || 0), 0);
                discountAmount = discountableBase * (appliedDiscount / 100);
            } else {
                discountAmount = totalConInteres * (appliedDiscount / 100);
            }
        }

        const finalAmount = Math.round(totalConInteres - discountAmount);

        console.log(`💰 base: $${baseAmount} | cuotas: ${cuotas} (recargo ${(tasaInteres * 100).toFixed(0)}%) | descuento: ${appliedDiscount}% | final: $${finalAmount}`);

        // ── 5. ARMAR LA ORDEN ─────────────────────────────────────────────────
        // Rama enterprise solo si la cuenta es enterprise Y el primer item es B2B
        const isEnterpriseOrder = !!currentClaims.isEnterprise && ENTERPRISE_PLANS.includes(items[0]);

        const nuevoPago = new PaymentsMongo({
            orderId:        `TEST-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
            client_id:      uid,
            email:          testValue(payer.email || req.user.email).toLowerCase(),
            nombre:         testValue(payer.nombre),
            dni:            testValue(payer.dni),
            domicilio:      testValue(payer.domicilio),
            ciudad:         testValue(payer.ciudad),
            provincia:      testValue(payer.provincia),
            codigoPostal:   testValue(payer.codigoPostal),
            telefono:       testValue(payer.telefono),
            plan:           items.join('+'),
            items,
            amount:         finalAmount,
            cuotas,
            couponUsed:     couponCodeUsed,
            discount:       appliedDiscount,
            date:           new Date(),
            isEnterprise:   isEnterpriseOrder,
            isTest:         true,
            status:         'approved',
            status_detail:  'accredited',
            mp_payment_id:  "fake-course-" + Math.floor(Math.random() * 1000000),
            couponConsumed: false,
        });

        // ── 6. FIREBASE CUSTOM CLAIMS ─────────────────────────────────────────
        nuevoPago.expiresAt     = await applyPurchaseClaims(nuevoPago);
        nuevoPago.claimsApplied = true;
        nuevoPago.fulfillment   = 'done';
        nuevoPago.fulfilledAt   = new Date();

        // ── 7. GUARDAR EN DB Y NOTIFICAR ──────────────────────────────────────
        await nuevoPago.save();
        try { notifyNewSale(nuevoPago); } catch (e) { console.error("⚠️ notifyNewSale falló:", e.message); }
        console.log("✅ Pago de prueba guardado en DB.");

        // ── 8. RENOVAR COOKIE (claims nuevas sin re-login) ────────────────────
        await safeRefreshSession(uid, res);

        // ── 9. RESPUESTA ──────────────────────────────────────────────────────
        return res.status(200).json({
            message:   "Simulación completada con éxito 🟢",
            isTest:    true,
            mp_status: 'approved',
            mp_id:     nuevoPago.mp_payment_id,
            amount:    finalAmount,
            discount:  appliedDiscount > 0 ? `${appliedDiscount}%` : null,
            ...(await getFreshPurchaseClaims(uid)),
        });

    } catch (error) {
        console.error("❌ [SIMULACIÓN ERROR]:", error.message);
        return res.status(500).json({ message: "Error en la simulación 🔴", code: "INTERNAL_ERROR", details: error.message });
    }
});


// ═══════════════════════════════════════════════════════════════════════════════
//  🚀 PROD — POST /course-payment — COBRO REAL CON MERCADO PAGO
// ═══════════════════════════════════════════════════════════════════════════════
paymentsRouter.post("/course-payment", verifyToken, async (req, res) => {
    const { payer, idempotencyKey, items, couponCode, token, issuer_id, payment_method_id, installments } = req.body;
    const uid = req.user.uid;

    console.log("💳 [CURSO_PAGO_REAL] Iniciando proceso...");

    // ── 0. DATOS BÁSICOS ──────────────────────────────────────────────────────
    if (!payer?.email || !Array.isArray(items) || items.length === 0)
        return res.status(400).json({ message: "Faltan datos: payer.email e items son requeridos 🔴", code: "MISSING_DATA" });

    if (!token || !payment_method_id || !installments)
        return res.status(400).json({ message: "Faltan datos de pago (token, payment_method_id, installments) 🔴", code: "MISSING_PAYMENT_DATA" });

    if (!idempotencyKey)
        return res.status(400).json({ message: "Falta idempotencyKey 🔴", code: "MISSING_IDEMPOTENCY_KEY" });

    const invalidItems = items.filter(i => !VALID_PLANS.includes(i));
    if (invalidItems.length > 0)
        return res.status(400).json({ message: `Planes inválidos: ${invalidItems.join(', ')} 🔴`, code: "INVALID_PLAN" });

    if (new Set(items).size !== items.length)
        return res.status(400).json({ message: "La compra tiene items duplicados 🔴", code: "DUPLICATED_ITEMS" });

    const sanitizedEmail        = payer.email.trim().toLowerCase();
    const sanitizedPhone        = payer.telefono ? String(payer.telefono).trim() : "N/A";
    const sanitizedNombre       = payer.nombre ? payer.nombre.trim() : "N/A";
    const sanitizedDni          = payer.dni ? String(payer.dni).trim() : "N/A";
    const sanitizedDomicilio    = payer.domicilio ? payer.domicilio.trim() : "N/A";
    const sanitizedCiudad       = payer.ciudad ? payer.ciudad.trim() : "N/A";
    const sanitizedProvincia    = payer.provincia ? payer.provincia.trim() : "N/A";
    const sanitizedCodigoPostal = payer.codigoPostal ? String(payer.codigoPostal).trim() : "N/A";

    try {
        // ── 1. IDEMPOTENCIA: ¿esta key ya se usó? ─────────────────────────────
        // Va primero: si el pago ya se aprobó, el usuario ahora tiene plan activo
        // y el reintento tiene que devolver el resultado, no un "ya tenés plan".
        let order = await PaymentsMongo.findOne({ orderId: idempotencyKey });

        if (order) {
            if (order.client_id !== uid)
                return res.status(409).json({ message: "Operación inválida 🔴", code: "IDEMPOTENCY_KEY_USED" });

            if (order.status === 'approved')
                return res.status(200).json({
                    message:   "Este pago ya fue procesado 🟢",
                    mp_status: 'approved',
                    mp_id:     order.mp_payment_id,
                    amount:    order.amount,
                    ...(await getFreshPurchaseClaims(uid)),
                });

            if (PENDING_STATUSES.includes(order.status))
                return res.status(202).json({
                    message: "Pago en revisión 🟡", code: "PAYMENT_PENDING",
                    mp_status: order.status, mp_id: order.mp_payment_id, amount: order.amount,
                });

            if (order.status === 'created')
                return res.status(409).json({ message: "Ya hay un pago en curso con esta operación 🟡", code: "PAYMENT_IN_PROGRESS" });

            if (order.status !== 'error')
                // rechazado / cancelado / fallido: la key murió, el front genera otra
                return res.status(409).json({ message: "Esta operación ya fue cerrada 🔴", code: "IDEMPOTENCY_KEY_USED" });

            // status 'error' (fallo de red con MP): se reintenta con la misma key, sin riesgo de doble cobro
        }

        // ── 2. LEER CLAIMS ACTUALES ───────────────────────────────────────────
        const userRecord    = await auth.getUser(uid);
        const currentClaims = userRecord.customClaims || {};

        const isEnterprise      = !!currentClaims.isEnterprise;
        const existingPurchases = Array.isArray(currentClaims.purchases) ? currentClaims.purchases : [];
        const existingExpiry    = currentClaims.purchaseExpiry || {};

        // ── 3. VALIDAR TIPO DE USUARIO vs PLANES ──────────────────────────────
        if (isEnterprise) {
            // Enterprise no puede comprar planes de usuarios normales
            if (items.some(i => USER_PLANS.includes(i)))
                return res.status(403).json({
                    message: "TU_TIPO_DE_USUARIO_ESTÁ_INHABILITADO_PARA_ESTA_COMPRA",
                    detail:  "Las cuentas Enterprise no pueden adquirir planes de estudio individuales.",
                    code:    "ENTERPRISE_CANNOT_BUY_USER_PLANS",
                });

            // Enterprise compra un solo plan por operación
            if (items.length !== 1)
                return res.status(400).json({ message: "Las cuentas Enterprise pueden comprar un solo plan por operación 🔴", code: "ENTERPRISE_SINGLE_ITEM_ONLY" });
        } else {
            // Usuario normal no puede comprar planes enterprise
            if (items.some(i => ENTERPRISE_PLANS.includes(i)))
                return res.status(403).json({
                    message: "TU_TIPO_DE_USUARIO_ESTÁ_INHABILITADO_PARA_ESTA_COMPRA",
                    detail:  "Los planes B2B son exclusivos para cuentas Enterprise.",
                    code:    "USER_CANNOT_BUY_ENTERPRISE_PLANS",
                });

            // ── 4. VALIDAR ESTRUCTURA DEL CARRITO (usuario normal) ────────────
            const mainPlans = items.filter(i => i !== 'voucher');

            // Un solo plan principal por compra
            if (mainPlans.length > 1)
                return res.status(400).json({ message: "Solo podés comprar un plan por operación 🔴", code: "SINGLE_PLAN_ONLY" });

            // Voucher como add-on solo en planes que no lo incluyen
            if (mainPlans.length === 1 && items.includes('voucher') && !PLANS_WITH_VOUCHER_ADDON.includes(mainPlans[0]))
                return res.status(400).json({ message: `El plan ${mainPlans[0].toUpperCase()} no admite voucher adicional 🔴`, code: "VOUCHER_ADDON_NOT_ALLOWED" });

            // No se puede comprar voucher si ya tiene uno sin usar
            if (items.includes('voucher') && existingPurchases.includes('voucher'))
                return res.status(409).json({
                    message: "YA_TENÉS_UN_VOUCHER_DISPONIBLE",
                    detail:  "Tenés un voucher de certificación sin usar. Usalo para rendir antes de comprar uno nuevo.",
                    code:    "VOUCHER_ALREADY_AVAILABLE",
                });
        }

        // ── 5. VALIDAR PLAN ACTIVO (no permite re-compra mientras esté vigente) ─
        if (items.some(i => i !== 'voucher')) {
            const activePlan = getActivePlan(existingPurchases, existingExpiry);
            if (activePlan) {
                const expiryStr = new Date(existingExpiry[activePlan])
                    .toLocaleDateString('es-AR', { day: '2-digit', month: 'long', year: 'numeric' });
                return res.status(409).json({
                    message:   "YA_TENÉS_UN_PLAN_ACTIVO",
                    detail:    `Tu plan ${activePlan.toUpperCase()} está vigente hasta el ${expiryStr}. Podés renovar una vez que finalice.`,
                    code:      "ACTIVE_PLAN_EXISTS",
                    activePlan,
                    expiresAt: existingExpiry[activePlan],
                });
            }
        }

        // ── 6. VALIDAR QUE NO HAYA OTRA COMPRA ABIERTA ────────────────────────
        const openOrder = await PaymentsMongo.exists({
            client_id: uid,
            orderId:   { $ne: idempotencyKey },
            $or: [
                { status: { $in: PENDING_STATUSES } },
                { status: 'created', date: { $gt: new Date(Date.now() - ORDER_IN_FLIGHT_MS) } },
            ],
        });
        if (openOrder)
            return res.status(409).json({
                message: "YA_TENÉS_UN_PAGO_EN_REVISIÓN",
                detail:  "Tenés un pago en revisión. Esperá a que se acredite o se rechace antes de hacer otra compra.",
                code:    "PENDING_PAYMENT_EXISTS",
            });

        // ── 7. VALIDAR CUPÓN (NO se consume acá: se consume al aprobarse el pago) ─
        let appliedDiscount    = 0;
        let couponScope        = null;
        let couponAllowedPlans = [];
        let couponCodeUsed     = null;

        if (couponCode) {
            const sanitizedCode = couponCode.trim().toUpperCase();
            const coupon = await Coupon.findOne({ code: sanitizedCode, isActive: true });

            if (!coupon)
                return res.status(404).json({ message: "Cupón no encontrado o inactivo 🔴", code: "COUPON_NOT_FOUND" });

            if (coupon.type === 'date_limited' && coupon.expiryDate < new Date()) {
                await Coupon.findByIdAndUpdate(coupon._id, { isActive: false });
                return res.status(400).json({ message: "El cupón expiró ⚠️", code: "COUPON_EXPIRED" });
            }

            if (coupon.type === 'single_use' && coupon.usedBy?.includes(sanitizedEmail))
                return res.status(400).json({ message: "Ya usaste este cupón 🔴", code: "COUPON_ALREADY_USED" });

            if (coupon.type === 'limited_uses' && coupon.maxUses !== null && coupon.usesCount >= coupon.maxUses) {
                await Coupon.findByIdAndUpdate(coupon._id, { isActive: false });
                return res.status(400).json({ message: "El cupón alcanzó su límite de usos ⚠️", code: "COUPON_EXHAUSTED" });
            }

            if (coupon.scope === 'plans' && !items.some(planId => (coupon.allowedPlans || []).includes(planId)))
                return res.status(400).json({ message: "Este cupón no aplica a ninguno de los planes seleccionados 🔴", code: "COUPON_NOT_APPLICABLE" });

            appliedDiscount    = coupon.discount;
            couponScope        = coupon.scope;
            couponAllowedPlans = coupon.allowedPlans || [];
            couponCodeUsed     = coupon.code;
            console.log(`✅ Cupón ${sanitizedCode} válido. Descuento: ${appliedDiscount}%`);
        }

        // ── 8. CALCULAR MONTO ─────────────────────────────────────────────────
        const cuotas = Number(installments) || 1;
        if (!INTERES_RATES.hasOwnProperty(String(cuotas)))
            return res.status(400).json({ message: "Cantidad de cuotas inválida 🔴", code: "INVALID_INSTALLMENTS" });

        const baseAmount       = items.reduce((acc, planId) => acc + (PLAN_PRICES[planId] || 0), 0);
        const cuotasSinInteres = getCuotasSinInteresParaCompra(items);
        const tasaInteres      = (cuotas > 1 && cuotas > cuotasSinInteres) ? (INTERES_RATES[String(cuotas)] || 0) : 0;
        const totalConInteres  = baseAmount * (1 + tasaInteres);

        // scope 'plans': descuenta sobre precio de lista de los items permitidos.
        // cualquier otro scope: descuenta sobre el total con recargo.
        let discountAmount = 0;
        if (appliedDiscount > 0) {
            if (couponScope === 'plans') {
                const discountableBase = items
                    .filter(i => couponAllowedPlans.includes(i))
                    .reduce((acc, i) => acc + (PLAN_PRICES[i] || 0), 0);
                discountAmount = discountableBase * (appliedDiscount / 100);
            } else {
                discountAmount = totalConInteres * (appliedDiscount / 100);
            }
        }

        const finalAmount = Math.round(totalConInteres - discountAmount);

        console.log(`💰 base: $${baseAmount} | cuotas: ${cuotas} (recargo ${(tasaInteres * 100).toFixed(0)}%) | descuento: ${appliedDiscount}% | final: $${finalAmount}`);

        // ── 9. REGISTRAR LA ORDEN ANTES DE COBRAR ─────────────────────────────
        // Si algo se cae después del cobro, el webhook la encuentra por external_reference.
        const orderData = {
            orderId:        idempotencyKey,
            client_id:      uid,
            nombre:         sanitizedNombre,
            dni:            sanitizedDni,
            email:          sanitizedEmail,
            telefono:       sanitizedPhone,
            domicilio:      sanitizedDomicilio,
            ciudad:         sanitizedCiudad,
            provincia:      sanitizedProvincia,
            codigoPostal:   sanitizedCodigoPostal,
            plan:           items.join('+'),
            items,
            amount:         finalAmount,
            cuotas,
            couponUsed:     couponCodeUsed,
            discount:       appliedDiscount,
            date:           new Date(),
            isEnterprise,
            isTest:         false,
            status:         'created',
            status_detail:  null,
            mp_payment_id:  null,
            fulfillment:    'none',
            claimsApplied:  false,
            couponConsumed: false,
        };

        if (order) {
            // Reintento de una orden que quedó en 'error'
            order.set(orderData);
            await order.save();
        } else {
            try {
                order = await PaymentsMongo.create(orderData);
            } catch (e) {
                // Doble click: dos requests con la misma key al mismo tiempo
                if (e.code === 11000)
                    return res.status(409).json({ message: "Ya hay un pago en curso con esta operación 🟡", code: "PAYMENT_IN_PROGRESS" });
                throw e;
            }
        }

        // ── 10. PROCESAR PAGO REAL EN MERCADO PAGO ────────────────────────────
        let mpResult;
        try {
            mpResult = await paymentInstance.create({
                body: {
                    transaction_amount: finalAmount,
                    token,
                    description:        "Hidden Security - " + items.join('+'),
                    installments:       cuotas,
                    payment_method_id,
                    issuer_id:          issuer_id ? String(issuer_id) : undefined,
                    external_reference: idempotencyKey, // vínculo con la orden para el webhook
                    payer: {
                        email:          sanitizedEmail,
                        identification: payer.identification,
                    },
                },
                requestOptions: {
                    idempotencyKey,
                },
            });
        } catch (mpError) {
            // 4xx de MP = request rechazado, seguro que no cobró → la key muere.
            // 5xx / red = no sabemos si cobró → se conserva la key para reintentar seguro.
            const mpStatusCode = mpError?.status ?? mpError?.response?.status;
            const definitive   = mpStatusCode >= 400 && mpStatusCode < 500;

            console.error(esProduccion ? "Error MP" : "Error MP:", mpError?.cause || mpError?.message);

            await PaymentsMongo.updateOne(
                { _id: order._id },
                { $set: { status: definitive ? 'failed' : 'error', status_detail: mpError?.message ?? null } }
            );

            return definitive
                ? res.status(400).json({ message: "Mercado Pago rechazó los datos del pago 🔴", code: "PAYMENT_REQUEST_REJECTED" })
                : res.status(502).json({ message: "Error de comunicación con Mercado Pago 🔴", code: "PAYMENT_PROVIDER_ERROR" });
        }

        order.mp_payment_id = String(mpResult.id);
        order.status        = mpResult.status;
        order.status_detail = mpResult.status_detail ?? null;
        await order.save();

        // ── 11a. APROBADO → activar (claims + cupón) y renovar cookie ─────────
        if (mpResult.status === 'approved') {
            const result = await fulfillOrder(order._id);

            if (!result.ok)
                // Cobrado pero la activación falló: el webhook la reintenta
                return res.status(202).json({
                    message:   "Pago aprobado. Estamos activando tu plan 🟡",
                    code:      "ACTIVATION_PENDING",
                    mp_status: 'approved',
                    mp_id:     mpResult.id,
                    amount:    finalAmount,
                });

            await safeRefreshSession(uid, res);

            return res.status(200).json({
                message:   "Pago procesado con éxito 🟢",
                mp_status: 'approved',
                mp_id:     mpResult.id,
                amount:    finalAmount,
                discount:  appliedDiscount > 0 ? `${appliedDiscount}%` : null,
                ...(await getFreshPurchaseClaims(uid)),
            });
        }

        // ── 11b. PENDIENTE → lo resuelve el webhook ───────────────────────────
        if (PENDING_STATUSES.includes(mpResult.status))
            return res.status(202).json({
                message:   "Pago en revisión 🟡",
                code:      "PAYMENT_PENDING",
                mp_status: mpResult.status,
                mp_id:     mpResult.id,
                amount:    finalAmount,
            });

        // ── 11c. RECHAZADO ────────────────────────────────────────────────────
        return res.status(402).json({
            message:       "Pago rechazado",
            code:          "PAYMENT_REJECTED",
            status:        mpResult.status,
            status_detail: mpResult.status_detail,
        });

    } catch (error) {
        console.error("❌ [PAGO_REAL ERROR]:", error.message);
        return res.status(500).json({
            message: "Error al procesar el pago 🔴",
            code:    "INTERNAL_ERROR",
            ...(!esProduccion && { details: error.message }),
        });
    }
});


// ═══════════════════════════════════════════════════════════════════════════════
//  POST /webhooks/mercadopago — respaldo de fallos y pagos pendientes
// ═══════════════════════════════════════════════════════════════════════════════
// Sin verifyToken: lo llama Mercado Pago. Se autentica con la firma x-signature.
paymentsRouter.post("/webhooks/mercadopago", async (req, res) => {
    const type   = req.query.type || req.body?.type || req.query.topic;
    const dataId = req.query['data.id'] || req.body?.data?.id || req.query.id;
 
    console.log(`📩 Webhook MP recibido: type=${type ?? '-'} | id=${dataId ?? '-'}`);
 
    // ── 1. Solo eventos de pago (el resto: 200 para que MP no reintente) ──────
    if (type !== 'payment' || !dataId) return res.sendStatus(200);
 
    // ── 2. Firma ──────────────────────────────────────────────────────────────
    if (!verifyMpSignature(req, dataId)) {
        console.warn("⚠️ Webhook MP con firma inválida");
        return res.sendStatus(401);
    }
 
    try {
        // ── 3. Estado real del pago (nunca confiar en el body) ────────────────
        let mpPayment;
        try {
            mpPayment = await paymentInstance.get({ id: dataId });
        } catch (e) {
            // Pago inexistente (p. ej. id ficticio de una simulación): 200 para que MP no reintente
            if ((e?.status ?? e?.response?.status) === 404) {
                console.warn(`⚠️ Webhook MP: el pago ${dataId} no existe en MP, se ignora`);
                return res.sendStatus(200);
            }
            throw e;
        }
 
        const orderId = mpPayment.external_reference;
 
        if (!orderId) {
            // Pago viejo, simulado o ajeno a este flujo
            console.log(`ℹ️ Webhook MP: pago ${dataId} sin external_reference, se ignora`);
            return res.sendStatus(200);
        }
 
        // ── 4. Buscar la orden ────────────────────────────────────────────────
        const order = await PaymentsMongo.findOne({ orderId });
        if (!order) {
            console.warn(`⚠️ Webhook MP: sin orden para external_reference ${orderId}`);
            return res.sendStatus(200);
        }
 
        // ── 5. Chequear monto ─────────────────────────────────────────────────
        if (Math.round(Number(mpPayment.transaction_amount)) !== Math.round(order.amount)) {
            console.error(`❌ Webhook MP: monto no coincide en orden ${orderId} (MP ${mpPayment.transaction_amount} vs orden ${order.amount})`);
            await PaymentsMongo.updateOne({ _id: order._id }, { $set: { amountMismatch: true } });
            return res.sendStatus(200);
        }
 
        // ── 6. Actualizar estado ──────────────────────────────────────────────
        order.mp_payment_id = String(mpPayment.id);
        order.status        = mpPayment.status;
        order.status_detail = mpPayment.status_detail ?? null;
        await order.save();
 
        console.log(`🔔 Webhook MP: orden ${orderId} → ${mpPayment.status}`);
 
        // ── 7. Si quedó aprobado, activar ─────────────────────────────────────
        if (mpPayment.status === 'approved') {
            const result = await fulfillOrder(order._id);
            // 500 → MP reintenta más tarde
            if (!result.ok) return res.sendStatus(500);
        }
 
        return res.sendStatus(200);
 
    } catch (error) {
        console.error("❌ [WEBHOOK MP ERROR]:", error.message);
        return res.sendStatus(500);
    }
});


// ═══════════════════════════════════════════════════════════════════════════════
//  GET /api/refresh-claims
// ═══════════════════════════════════════════════════════════════════════════════
// Limpia planes vencidos y, si la cookie quedó con claims viejas
// (p. ej. un pago pendiente que se aprobó por webhook), la renueva.
paymentsRouter.get("/api/refresh-claims", verifyToken, async (req, res) => {
    const uid = req.user.uid;

    try {
        const userRecord    = await auth.getUser(uid);
        const currentClaims = userRecord.customClaims || {};

        const purchases      = Array.isArray(currentClaims.purchases) ? currentClaims.purchases : [];
        const purchaseExpiry = currentClaims.purchaseExpiry || {};
        const isEnterprise   = !!currentClaims.isEnterprise;

        // ── 1. Detectar planes vencidos ───────────────────────────────────────
        const now          = new Date();
        const expiredPlans = [];
        for (const [planId, expiresAtStr] of Object.entries(purchaseExpiry)) {
            if (new Date(expiresAtStr) < now) {
                expiredPlans.push(planId);
                console.log(`🗑️  Plan ${planId.toUpperCase()} vencido — removiendo claims de ${uid}`);
            }
        }

        let finalPurchases = purchases;
        let finalExpiry    = purchaseExpiry;

        // ── 2. Removerlos de las claims ───────────────────────────────────────
        if (expiredPlans.length > 0) {
            finalPurchases = purchases.filter(p => !expiredPlans.includes(p));
            finalExpiry    = { ...purchaseExpiry };
            for (const planId of expiredPlans) delete finalExpiry[planId];

            // Si venció el plan enterprise, limpiar claims enterprise también
            const enterprisePlanExpired = isEnterprise && expiredPlans.some(p => ENTERPRISE_PLANS.includes(p));
            const enterpriseCleanup     = enterprisePlanExpired
                ? { enterprisePlan: null, enterprisePlanExpiry: null, vacancyLimit: null, vacanciesUsed: 0 }
                : {};

            await auth.setCustomUserClaims(uid, {
                ...currentClaims,
                purchases:      finalPurchases,
                purchaseExpiry: finalExpiry,
                ...enterpriseCleanup,
            });

            console.log(`✅ Claims actualizadas para ${uid}. Planes removidos: ${expiredPlans.join(', ')}`);
        }

        // ── 3. ¿La cookie tiene claims viejas? → renovarla ────────────────────
        const cookieStale =
            JSON.stringify(req.user.purchases ?? [])      !== JSON.stringify(finalPurchases) ||
            JSON.stringify(req.user.purchaseExpiry ?? {}) !== JSON.stringify(finalExpiry);

        const sessionRefreshed = expiredPlans.length > 0 || cookieStale;
        if (sessionRefreshed) await safeRefreshSession(uid, res);

        return res.json({
            ok:             true,
            modified:       expiredPlans.length > 0,
            sessionRefreshed,
            expiredPlans,
            purchases:      finalPurchases,
            purchaseExpiry: finalExpiry,
        });

    } catch (error) {
        console.error("❌ [refresh-claims ERROR]:", error.message);
        return res.status(500).json({ error: "Error al refrescar claims", ...(!esProduccion && { details: error.message }) });
    }
});

// ─── PATCH /api/payments/:id/checked ──────────────────────────────────────────
paymentsRouter.patch("/api/payments/:id/checked", adminMiddleware, async (req, res) => {
    await PaymentsMongo.findByIdAndUpdate(req.params.id, { checked: req.body.checked });
    res.json({ ok: true });
});

module.exports = paymentsRouter;