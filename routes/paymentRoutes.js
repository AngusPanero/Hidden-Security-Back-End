// Express y Router
const express = require("express")
const paymentsRouter = express.Router()
// Mongo
const PaymentsMongo = require("../models/Payments")
const Coupon = require("../models/CouponSchema")

const adminMiddleware      = require("../middleware/adminMiddleware")
const verifyToken          = require("../middleware/authMiddleware")
const auth                 = require("../config/firebase")

const { notifyNewSale } = require("../sseManager/sseManajer")

const esProduccion = (process.env.NODE_ENV === 'production');

// ─── Constantes ────────────────────────────────────────────────────────────────
const PLAN_DURATIONS = {
    starter:  3,
    pro:      6,
    elite:    12,
    business: 6,
    enterprise: 12,
    // voucher: undefined — sin vencimiento por tiempo
};

const VALID_PLANS = ['starter', 'pro', 'elite', 'voucher', 'business', 'enterprise'];

const PLAN_PRICES = {
    starter:  100000,
    pro:      200000,
    elite:    300000,
    voucher:  150000,
    business: 900000,
    enterprise: 1500000,
};

const BUNDLED_VOUCHERS = {
    'elite': 2,
    'pro':   1,
};

// Planes exclusivos por tipo de usuario
const ENTERPRISE_PLANS = ['business', 'enterprise'];
const USER_PLANS        = ['starter', 'pro', 'elite', 'voucher'];

// Límite de publicaciones por plan enterprise
const ENTERPRISE_VACANCY_LIMITS = {
    business: 3,    // 6 meses → 3 publicaciones
    enterprise: null, // 12 meses → ilimitadas (null = sin límite)
};

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
        if (!expiryStr) continue; // sin fecha registrada, ignorar

        const expiry = new Date(expiryStr);
        if (expiry > now) return planId; // plan vigente encontrado
    }
    return null;
}

// ─── Tickets del usuario ───────────────────────────────────────────────────────
paymentsRouter.post("/tickets", async (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: "All fields are required! 🔴" });
    try {
        const payments = await PaymentsMongo.find({ email });
        if (!payments) return res.status(404).json({ message: "Cannot find available tickets! 🔴" });
        return res.status(200).json(payments);
    } catch (error) {
        console.error("Error getting tickets!", error);
        res.status(500).json({ message: "Error getting tickets! 🔴" });
    }
});

paymentsRouter.get("/all-tickets", adminMiddleware, async (req, res) => {
    try {
        const allPayments = await PaymentsMongo.find().sort({ createdAt: -1 });
        if (!allPayments || allPayments.length === 0)
            return res.status(404).json({ message: "No sales records found! 🔴" });
        return res.status(200).json(allPayments);
    } catch (error) {
        console.error("Error fetching all tickets!", error);
        res.status(500).json({ message: "Internal Server Error 🔴" });
    }
});

// ─── POST /test-course-payment ─────────────────────────────────────────────────
paymentsRouter.post("/test-course-payment", verifyToken, async (req, res) => {
    const { payer, idempotencyKey, items, couponCode } = req.body;

    console.log("🧪 [CURSO_SIMULACIÓN] Iniciando proceso...");

    if (!payer?.email || !items || !Array.isArray(items) || items.length === 0)
        return res.status(400).json({ message: "Faltan datos: payer.email e items son requeridos 🔴" });

    const invalidItems = items.filter(i => !VALID_PLANS.includes(i));
    if (invalidItems.length > 0)
        return res.status(400).json({ message: `Plans inválidos: ${invalidItems.join(', ')} 🔴` });

    const sanitizedEmail = payer.email.trim().toLowerCase();
    const sanitizedPhone = payer.phone ? payer.phone.trim() : null;
    const uid            = req.user.uid;

    try {
        // ── 1. LEER CLAIMS ACTUALES ────────────────────────────────────────────
        const userRecord    = await auth.getUser(uid);
        const currentClaims = userRecord.customClaims || {};

        const isEnterprise      = !!currentClaims.isEnterprise;
        const existingPurchases = Array.isArray(currentClaims.purchases) ? currentClaims.purchases : [];
        const existingExpiry    = currentClaims.purchaseExpiry || {};

        // ── 2. VALIDAR TIPO DE USUARIO vs PLANES ──────────────────────────────
        // Enterprise no puede comprar planes de usuarios normales
        if (isEnterprise) {
            const forbiddenForEnterprise = items.filter(i => USER_PLANS.includes(i));
            if (forbiddenForEnterprise.length > 0) {
                return res.status(403).json({
                    message:  "TU_TIPO_DE_USUARIO_ESTÁ_INHABILITADO_PARA_ESTA_COMPRA",
                    detail:   "Las cuentas Enterprise no pueden adquirir planes de estudio individuales.",
                    code:     "ENTERPRISE_CANNOT_BUY_USER_PLANS",
                });
            }
        }

        // Usuario normal no puede comprar planes enterprise
        if (!isEnterprise) {
            const forbiddenForUser = items.filter(i => ENTERPRISE_PLANS.includes(i));
            if (forbiddenForUser.length > 0) {
                return res.status(403).json({
                    message:  "TU_TIPO_DE_USUARIO_ESTÁ_INHABILITADO_PARA_ESTA_COMPRA",
                    detail:   "Los planes B2B son exclusivos para cuentas Enterprise.",
                    code:     "USER_CANNOT_BUY_ENTERPRISE_PLANS",
                });
            }
        }

        // ── 3. VALIDAR PLAN ACTIVO (no permite re-compra mientras esté vigente) ─
        // Excepción: voucher siempre se puede acumular (solo usuarios normales)
        const itemsWithoutVoucher = items.filter(i => i !== 'voucher');

        if (itemsWithoutVoucher.length > 0) {
            const activePlan = getActivePlan(existingPurchases, existingExpiry);
            if (activePlan) {
                const expiresAt  = new Date(existingExpiry[activePlan]);
                const expiryStr  = expiresAt.toLocaleDateString('es-AR', { day: '2-digit', month: 'long', year: 'numeric' });
                return res.status(409).json({
                    message:     "YA_TENÉS_UN_PLAN_ACTIVO",
                    detail:      `Tu plan ${activePlan.toUpperCase()} está vigente hasta el ${expiryStr}. Podés renovar una vez que finalice.`,
                    code:        "ACTIVE_PLAN_EXISTS",
                    activePlan,
                    expiresAt:   existingExpiry[activePlan],
                });
            }
        }

        // ── 4. EXPANDIR ITEMS CON VOUCHERS BUNDLED ────────────────────────────
        const expandedItems = [];
        for (const item of items) {
            expandedItems.push(item);
            if (BUNDLED_VOUCHERS[item]) {
                const count = BUNDLED_VOUCHERS[item];
                for (let i = 0; i < count; i++) expandedItems.push('voucher');
                console.log(`✅ Plan ${item.toUpperCase()} incluye ${count} voucher(s) automático(s).`);
            }
        }
        console.log("📦 Items expandidos:", expandedItems);

        // ── 5. VALIDAR Y CONSUMIR CUPÓN ───────────────────────────────────────
        let appliedDiscount = 0;

        if (couponCode) {
            const sanitizedCode = couponCode.trim().toUpperCase();
            const coupon = await Coupon.findOne({ code: sanitizedCode, isActive: true });

            if (!coupon)
                return res.status(404).json({ message: "Cupón no encontrado o inactivo 🔴" });

            if (coupon.type === 'date_limited' && coupon.expiryDate < new Date()) {
                await Coupon.findByIdAndUpdate(coupon._id, { isActive: false });
                return res.status(400).json({ message: "El cupón expiró ⚠️" });
            }

            if (coupon.type === 'single_use' && coupon.usedBy.includes(sanitizedEmail))
                return res.status(400).json({ message: "Ya usaste este cupón 🔴" });

            if (coupon.type === 'limited_uses') {
                if (coupon.maxUses !== null && coupon.usesCount >= coupon.maxUses) {
                    await Coupon.findByIdAndUpdate(coupon._id, { isActive: false });
                    return res.status(400).json({ message: "El cupón alcanzó su límite de usos ⚠️" });
                }
            }

            if (coupon.scope === 'plans') {
                const applies = items.some(planId => coupon.allowedPlans.includes(planId));
                if (!applies)
                    return res.status(400).json({ message: "Este cupón no aplica a ninguno de los planes seleccionados 🔴" });
            }

            appliedDiscount = coupon.discount;
            console.log(`✅ Cupón ${sanitizedCode} válido. Descuento: ${appliedDiscount}%`);

            if (coupon.type === 'single_use') {
                await Coupon.findByIdAndUpdate(coupon._id, {
                    $addToSet: { usedBy: sanitizedEmail }, isActive: false
                });
            } else if (coupon.type === 'limited_uses') {
                const updated = await Coupon.findByIdAndUpdate(
                    coupon._id,
                    { $addToSet: { usedBy: sanitizedEmail }, $inc: { usesCount: 1 } },
                    { new: true }
                );
                if (updated.maxUses !== null && updated.usesCount >= updated.maxUses)
                    await Coupon.findByIdAndUpdate(coupon._id, { isActive: false });
            } else if (coupon.type === 'date_limited') {
                await Coupon.findByIdAndUpdate(coupon._id, { $addToSet: { usedBy: sanitizedEmail } });
            }

            console.log(`✅ Cupón ${couponCode.toUpperCase()} consumido.`);
        }

        // ── 6. CALCULAR MONTO ─────────────────────────────────────────────────
        const baseAmount  = items.reduce((acc, planId) => acc + (PLAN_PRICES[planId] || 0), 0);
        const finalAmount = appliedDiscount > 0
            ? Math.round(baseAmount * (1 - appliedDiscount / 100))
            : baseAmount;

        console.log(`💰 base: $${baseAmount} | descuento: ${appliedDiscount}% | final: $${finalAmount}`);

        // ── 7. SIMULAR MP ─────────────────────────────────────────────────────
        const fakeMPResult = {
            id:            "fake-course-" + Math.floor(Math.random() * 1000000),
            status:        "approved",
            status_detail: "accredited",
        };

        if (fakeMPResult.status !== "approved")
            return res.status(402).json({ message: "Pago rechazado", status: fakeMPResult.status });

        // ── 8. FIREBASE CUSTOM CLAIMS ─────────────────────────────────────────
        const newExpiry = { ...existingExpiry };

        if (isEnterprise) {
            // ── Claims enterprise ──────────────────────────────────────────────
            // Para enterprise seteamos: purchasedPlan, purchasedAt, vacancyLimit
            const planId      = items[0]; // siempre un solo plan enterprise
            const expiresAt   = calcExpiresAt(planId);
            const vacancyLimit = ENTERPRISE_VACANCY_LIMITS[planId]; // null = ilimitado

            newExpiry[planId] = expiresAt.toISOString();

            const updatedPurchases = [
                ...new Set([...existingPurchases, planId])
            ];

            await auth.setCustomUserClaims(uid, {
                ...currentClaims,
                purchases:       updatedPurchases,
                purchaseExpiry:  newExpiry,
                // Claims específicas enterprise:
                enterprisePlan:       planId,
                enterprisePlanExpiry: expiresAt.toISOString(),
                enterprisePurchasedAt: new Date().toISOString(),
                vacancyLimit,          // 3 para business, null para enterprise
                vacanciesUsed: currentClaims.vacanciesUsed ?? 0, // contador de publicaciones
            });

            console.log(`✅ Enterprise claims para ${uid}: plan=${planId}, vacancyLimit=${vacancyLimit ?? 'ilimitado'}, expiry=${expiresAt.toISOString()}`);

        } else {
            // ── Claims usuario normal ──────────────────────────────────────────
            const nonVoucherExisting = existingPurchases.filter(i => i !== 'voucher');
            const nonVoucherNew      = expandedItems.filter(i => i !== 'voucher');
            const voucherCount       = existingPurchases.filter(i => i === 'voucher').length
                                     + expandedItems.filter(i => i === 'voucher').length;

            const updatedPurchases = [
                ...new Set([...nonVoucherExisting, ...nonVoucherNew]),
                ...Array(voucherCount).fill('voucher'),
            ];

            for (const planId of items) {
                if (planId === 'voucher') continue;
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
        }

        // ── 9. GUARDAR EN DB ──────────────────────────────────────────────────
        const mainPlan    = items.find(i => i !== 'voucher') || items[0];
        const dbExpiresAt = calcExpiresAt(mainPlan);

        const nuevoPago = new PaymentsMongo({
            orderId:       idempotencyKey || `TEST-COURSE-${Date.now()}`,
            client_id:     uid,
            email:         sanitizedEmail,
            telefono:      sanitizedPhone,
            plan:          items.join('+'),
            amount:        finalAmount,
            mp_payment_id: fakeMPResult.id,
            status:        fakeMPResult.status,
            couponUsed:    couponCode ? couponCode.toUpperCase() : null,
            discount:      appliedDiscount,
            date:          new Date(),
            expiresAt:     dbExpiresAt,
            isEnterprise,
        });

        await nuevoPago.save();
        notifyNewSale(nuevoPago);
        console.log("✅ Pago guardado en DB.");

        // ── 10. RESPUESTA ─────────────────────────────────────────────────────
        return res.status(200).json({
            message:        "Simulación completada con éxito 🟢",
            mp_status:      fakeMPResult.status,
            mp_id:          fakeMPResult.id,
            purchases:      isEnterprise ? [items[0]] : undefined,
            purchaseExpiry: newExpiry,
            discount:       appliedDiscount > 0 ? `${appliedDiscount}%` : null,
            amount:         finalAmount,
            ...(isEnterprise && {
                enterprisePlan:  items[0],
                vacancyLimit:    ENTERPRISE_VACANCY_LIMITS[items[0]],
            }),
        });

    } catch (error) {
        console.error("❌ [SIMULACIÓN ERROR]:", error.message);
        return res.status(500).json({ error: "Error en la simulación", details: error.message });
    }
});

// ─── GET /api/refresh-claims ───────────────────────────────────────────────────
paymentsRouter.get("/api/refresh-claims", verifyToken, async (req, res) => {
    const uid = req.user.uid;

    try {
        const userRecord    = await auth.getUser(uid);
        const currentClaims = userRecord.customClaims || {};

        const purchases      = Array.isArray(currentClaims.purchases) ? currentClaims.purchases : [];
        const purchaseExpiry = currentClaims.purchaseExpiry || {};
        const isEnterprise   = !!currentClaims.isEnterprise;

        const now         = new Date();
        let   modified    = false;
        const expiredPlans = [];

        for (const [planId, expiresAtStr] of Object.entries(purchaseExpiry)) {
            const expiresAt = new Date(expiresAtStr);
            if (expiresAt < now) {
                expiredPlans.push(planId);
                modified = true;
                console.log(`🗑️  Plan ${planId.toUpperCase()} vencido — removiendo claims de ${uid}`);
            }
        }

        if (!modified) {
            return res.json({ ok: true, modified: false, purchases, purchaseExpiry });
        }

        const updatedPurchases = purchases.filter(p => !expiredPlans.includes(p));
        const updatedExpiry    = { ...purchaseExpiry };
        for (const planId of expiredPlans) delete updatedExpiry[planId];

        // Si venció el plan enterprise, limpiar claims enterprise también
        const enterprisePlanExpired = isEnterprise && expiredPlans.some(p => ENTERPRISE_PLANS.includes(p));
        const enterpriseCleanup     = enterprisePlanExpired
            ? { enterprisePlan: null, enterprisePlanExpiry: null, vacancyLimit: null, vacanciesUsed: 0 }
            : {};

        await auth.setCustomUserClaims(uid, {
            ...currentClaims,
            purchases:      updatedPurchases,
            purchaseExpiry: updatedExpiry,
            ...enterpriseCleanup,
        });

        console.log(`✅ Claims actualizadas para ${uid}. Planes removidos: ${expiredPlans.join(', ')}`);

        return res.json({
            ok:             true,
            modified:       true,
            expiredPlans,
            purchases:      updatedPurchases,
            purchaseExpiry: updatedExpiry,
        });

    } catch (error) {
        console.error("❌ [refresh-claims ERROR]:", error.message);
        return res.status(500).json({ error: "Error al refrescar claims", details: error.message });
    }
});

// ─── PATCH /api/payments/:id/checked ──────────────────────────────────────────
paymentsRouter.patch("/api/payments/:id/checked", adminMiddleware, async (req, res) => {
    await PaymentsMongo.findByIdAndUpdate(req.params.id, { checked: req.body.checked });
    res.json({ ok: true });
});

module.exports = paymentsRouter;