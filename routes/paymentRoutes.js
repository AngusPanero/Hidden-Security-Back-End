// Express y Router
const express = require("express")
const paymentsRouter = express.Router()
// Mongo
const PaymentsMongo = require("../models/Payments")
const Coupon = require("../models/CouponSchema")

const adminMiddleware = require("../middleware/adminMiddleware")
const verifyToken = require("../middleware/authMiddleware")
const auth = require("../config/firebase")

const esProduccion = (process.env.NODE_ENV === 'production');

paymentsRouter.post("/tickets", async (req, res) => {
    const { email } = req.body
    
    if(!email){
        return res.status(400).json({ message: "All fields are required! 🔴" })
    }
    try {
        const payments = await PaymentsMongo.find({ email: email })
        if(!payments){
            return res.status(404).json({ message: "Cannot find availiable tickets! 🔴" })
        }
        return res.status(200).json(payments)
    } catch (error) {
        console.error(esProduccion ? "Error gettings tickets! 🔴" : "Error getting tickets!", error)
        res.status(500).json({ message: "Error gettings tickets! 🔴" })
    }
})

paymentsRouter.get("/all-tickets", adminMiddleware, async (req, res) => {
    try {
        // Buscamos todos los registros sin filtros, ordenados por fecha (más recientes primero)
        const allPayments = await PaymentsMongo.find().sort({ createdAt: -1 });

        if (!allPayments || allPayments.length === 0) {
            return res.status(404).json({ message: "No sales records found! 🔴" });
        }
        
        return res.status(200).json(allPayments);
    } catch (error) {
        console.error(esProduccion ? "Error fetching all tickets! 🔴" : "Error fetching all tickets!", error);
        res.status(500).json({ message: "Internal Server Error 🔴" });
    }
});

// TEST REAL PAYMENT
const VALID_PLANS = ['starter', 'pro', 'elite', 'voucher', 'b2b_seis', 'b2b_doce'];
 
// Planes que incluyen vouchers automáticos al comprarse
const BUNDLED_VOUCHERS = {
    'elite': 2,  // elite incluye 2 vouchers (re-intento)
    'pro':   1,  // pro incluye 1 voucher
};
 
paymentsRouter.post("/test-course-payment", verifyToken, async (req, res) => {
    const { transaction_amount, payer, idempotencyKey, items, couponCode } = req.body;
    // items: array de planIds: ["starter"] o ["starter", "voucher"]
 
    console.log("🧪 [CURSO_SIMULACIÓN] Iniciando proceso de prueba...");
 
    // ── validaciones básicas ──────────────────────────────────────────────────
    if (!transaction_amount || !payer?.email || !items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ message: "Faltan datos: transaction_amount, payer.email e items son requeridos 🔴" });
    }
 
    const invalidItems = items.filter(i => !VALID_PLANS.includes(i));
    if (invalidItems.length > 0) {
        return res.status(400).json({ message: `Plans inválidos: ${invalidItems.join(', ')} 🔴` });
    }
 
    const sanitizedEmail = payer.email.trim().toLowerCase();
    const uid            = req.user.uid;
 
    try {
 
        // ── 1. EXPANDIR ITEMS CON VOUCHERS INCLUIDOS EN EL PLAN ──────────────
        // Si compra elite → se agregan 2 vouchers automáticamente
        // Si compra pro   → se agrega 1 voucher automáticamente
        // Si compra starter + voucher manual → se respeta el voucher del frontend
        const expandedItems = [];
        for (const item of items) {
            expandedItems.push(item);
            if (BUNDLED_VOUCHERS[item]) {
                const count = BUNDLED_VOUCHERS[item];
                for (let i = 0; i < count; i++) {
                    expandedItems.push('voucher');
                }
                console.log(`✅ Plan ${item.toUpperCase()} incluye ${count} voucher(s) automático(s).`);
            }
        }
 
        console.log("📦 Items expandidos:", expandedItems);
 
        // ── 2. VALIDAR Y CONSUMIR CUPÓN ───────────────────────────────────────
        let appliedDiscount = 0;
 
        if (couponCode) {
            const sanitizedCode = couponCode.trim().toUpperCase();
            const coupon = await Coupon.findOne({ code: sanitizedCode, isActive: true });
 
            if (!coupon) {
                return res.status(404).json({ message: "Cupón no encontrado o inactivo 🔴" });
            }
 
            if (coupon.type === 'date_limited' && coupon.expiryDate < new Date()) {
                await Coupon.findByIdAndUpdate(coupon._id, { isActive: false });
                return res.status(400).json({ message: "El cupón expiró ⚠️" });
            }
 
            if (coupon.type === 'single_use' && coupon.usedBy.includes(sanitizedEmail)) {
                return res.status(400).json({ message: "Ya usaste este cupón 🔴" });
            }
 
            if (coupon.type === 'limited_uses') {
                if (coupon.maxUses !== null && coupon.usesCount >= coupon.maxUses) {
                    await Coupon.findByIdAndUpdate(coupon._id, { isActive: false });
                    return res.status(400).json({ message: "El cupón alcanzó su límite de usos ⚠️" });
                }
            }
 
            if (coupon.scope === 'plans') {
                const applies = items.some(planId => coupon.allowedPlans.includes(planId));
                if (!applies) {
                    return res.status(400).json({
                        message: `Este cupón no aplica a ninguno de los planes seleccionados 🔴`
                    });
                }
            }
 
            appliedDiscount = coupon.discount;
            console.log(`✅ Cupón ${sanitizedCode} válido. Descuento: ${appliedDiscount}%`);
 
            if (coupon.type === 'single_use') {
                await Coupon.findByIdAndUpdate(coupon._id, {
                    $addToSet: { usedBy: sanitizedEmail },
                    isActive: false
                });
            } else if (coupon.type === 'limited_uses') {
                const updated = await Coupon.findByIdAndUpdate(
                    coupon._id,
                    { $addToSet: { usedBy: sanitizedEmail }, $inc: { usesCount: 1 } },
                    { new: true }
                );
                if (updated.maxUses !== null && updated.usesCount >= updated.maxUses) {
                    await Coupon.findByIdAndUpdate(coupon._id, { isActive: false });
                    console.log(`⚠️ Cupón ${sanitizedCode} desactivado por límite de usos alcanzado.`);
                }
            } else if (coupon.type === 'date_limited') {
                await Coupon.findByIdAndUpdate(coupon._id, {
                    $addToSet: { usedBy: sanitizedEmail }
                });
            }
 
            console.log(`✅ Cupón ${sanitizedCode} consumido correctamente.`);
        }
 
        // ── 3. SIMULAR RESPUESTA DE MERCADO PAGO ─────────────────────────────
        const fakeMPResult = {
            id:            "fake-course-" + Math.floor(Math.random() * 1000000),
            status:        "approved",
            status_detail: "accredited"
        };
 
        console.log("🧪 [SIMULACIÓN] MP respondió:", fakeMPResult.status);
 
        if (fakeMPResult.status !== "approved") {
            return res.status(402).json({ message: "Pago rechazado en simulación", status: fakeMPResult.status });
        }
 
        // ── 4. SETEAR FIREBASE CUSTOM CLAIMS ────────────────────────────────
        const userRecord    = await auth.getUser(uid);
        const currentClaims = userRecord.customClaims || {};
        const existingItems = Array.isArray(currentClaims.purchases) ? currentClaims.purchases : [];
 
        // Merge: sin duplicados para planes normales, voucher se acumula
        const nonVoucherExisting = existingItems.filter(i => i !== 'voucher');
        const nonVoucherNew      = expandedItems.filter(i => i !== 'voucher');
        const voucherCount       = existingItems.filter(i => i === 'voucher').length
                                 + expandedItems.filter(i => i === 'voucher').length;
 
        const updatedPurchases = [
            ...new Set([...nonVoucherExisting, ...nonVoucherNew]),
            ...Array(voucherCount).fill('voucher')
        ];
 
        await auth.setCustomUserClaims(uid, {
            ...currentClaims,
            purchases: updatedPurchases
        });
 
        console.log(`✅ Firebase claims seteadas para ${uid}:`, updatedPurchases);
 
        // ── 5. GUARDAR PAGO EN DB ────────────────────────────────────────────
        const nuevoPago = new PaymentsMongo({
            orderId:       idempotencyKey || `TEST-COURSE-${Date.now()}`,
            client_id:     uid,
            email:         sanitizedEmail,
            plan:          items.join('+'),   // lo que realmente compró, sin los bundled
            amount:        Number(transaction_amount),
            mp_payment_id: fakeMPResult.id,
            status:        fakeMPResult.status,
            couponUsed:    couponCode ? couponCode.toUpperCase() : null,
            discount:      appliedDiscount,
            date:          new Date()
        });
 
        await nuevoPago.save();
        console.log("✅ Pago guardado en DB.");
 
        // ── 6. RESPUESTA ─────────────────────────────────────────────────────
        return res.status(200).json({
            message:    "Simulación de curso completada con éxito 🟢",
            mp_status:  fakeMPResult.status,
            mp_id:      fakeMPResult.id,
            purchases:  updatedPurchases,
            discount:   appliedDiscount > 0 ? `${appliedDiscount}%` : null,
        });
 
    } catch (error) {
        console.error("❌ [CURSO_SIMULACIÓN ERROR]:", error.message);
        return res.status(500).json({ error: "Error en la simulación de curso", details: error.message });
    }
});

module.exports = paymentsRouter