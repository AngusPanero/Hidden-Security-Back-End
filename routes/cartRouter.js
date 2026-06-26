const express = require('express');
const cartRouter = express.Router();
const Coupon = require("../models/CouponSchema")
const verifyToken = require('../middleware/authMiddleware');
const adminMiddleware = require('../middleware/adminMiddleware');

const esProduccion = (process.env.NODE_ENV === 'production');

// ─── CREAR CUPÓN ──────────────────────────────────────────────────────────────
cartRouter.post("/api/coupons/create", adminMiddleware, async (req, res) => {
    const { couponData } = req.body;

    if (!couponData || typeof couponData !== 'object') {
        return res.status(400).json({ message: "Datos de cupón no proporcionados o formato inválido 🔴" });
    }

    const { code, discount, type, expiryDate, maxUses, scope, allowedPlans } = couponData;

    if (!code || !discount || !type) {
        return res.status(400).json({ message: "Faltan campos obligatorios: code, discount y type 🔴" });
    }

    const discountNum = Number(discount);
    if (isNaN(discountNum) || discountNum <= 0 || discountNum > 100) {
        return res.status(400).json({ message: "El descuento debe ser un número entre 1 y 100 🔴" });
    }

    const validTypes = ['single_use', 'date_limited', 'limited_uses'];
    if (!validTypes.includes(type)) {
        return res.status(400).json({ message: "Tipo de cupón inválido 🔴" });
    }

    if (type === 'date_limited') {
        if (!expiryDate || typeof expiryDate !== 'string') {
            return res.status(400).json({ message: "Los cupones por fecha requieren una 'expiryDate' 🔴" });
        }
        const date = new Date(expiryDate + "T23:59:59.000Z");
        if (isNaN(date.getTime()) || date <= new Date()) {
            return res.status(400).json({ message: "La fecha de expiración debe ser válida y futura 🔴" });
        }
    }

    if (type === 'limited_uses') {
        const maxUsesNum = Number(maxUses);
        if (!maxUses || isNaN(maxUsesNum) || !Number.isInteger(maxUsesNum) || maxUsesNum < 1) {
            return res.status(400).json({ message: "Los cupones con límite de usos requieren un maxUses entero >= 1 🔴" });
        }
    }

    const validScopes = ['all', 'plans'];
    const finalScope = scope || 'all';
    if (!validScopes.includes(finalScope)) {
        return res.status(400).json({ message: "Scope inválido. Use 'all' o 'plans' 🔴" });
    }

    if (finalScope === 'plans') {
        const validPlans = ['starter', 'pro', 'elite', 'voucher', 'b2b_seis', 'b2b_doce'];
        if (!Array.isArray(allowedPlans) || allowedPlans.length === 0) {
            return res.status(400).json({ message: "Debés especificar al menos un plan 🔴" });
        }
        const invalid = allowedPlans.filter(p => !validPlans.includes(p));
        if (invalid.length > 0) {
            return res.status(400).json({ message: `Planes inválidos: ${invalid.join(', ')} 🔴` });
        }
    }

    try {
        const sanitizedCode = code.trim().toUpperCase();

        const exists = await Coupon.findOne({ code: sanitizedCode });
        if (exists) {
            return res.status(409).json({ message: "El código de cupón ya existe 🔴" });
        }

        const newCoupon = await Coupon.create({
            code:         sanitizedCode,
            discount:     discountNum,
            type,
            expiryDate:   type === 'date_limited' ? new Date(expiryDate + "T23:59:59.000Z") : null,
            maxUses:      type === 'limited_uses'  ? Number(maxUses) : null,
            usesCount:    0,
            scope:        finalScope,
            allowedPlans: finalScope === 'plans' ? allowedPlans.map(p => p.toLowerCase()) : [],
            isActive:     true,
            usedBy:       []
        });

        res.status(201).json({ message: "Cupón creado con éxito 🟢", coupon: newCoupon });

    } catch (error) {
        console.error(esProduccion ? "ERROR_COUPON_CREATE" : `ERROR_COUPON_CREATE: ${error}`);
        res.status(500).json({ message: "Error interno al procesar el cupón 🔴" });
    }
});

// ─── VALIDAR CUPÓN ────────────────────────────────────────────────────────────
cartRouter.post("/api/coupons/validate", verifyToken, async (req, res) => {
    const { code, email, planId } = req.body;

    if (!code || typeof code !== 'string') {
        return res.status(400).json({ message: "El código debe ser un string 🔴" });
    }
    if (!email || typeof email !== 'string') {
        return res.status(400).json({ message: "El email debe ser un string 🔴" });
    }
    if (!planId) {
        return res.status(400).json({ message: "planId es requerido 🔴" });
    }

    const sanitizedCode  = code.trim().toUpperCase();
    const sanitizedEmail = email.trim().toLowerCase();

    const planIds = Array.isArray(planId)
        ? planId.map(p => p.trim().toLowerCase())
        : [planId.trim().toLowerCase()];

    try {
        const coupon = await Coupon.findOne({ code: sanitizedCode, isActive: true });

        if (!coupon) {
            return res.status(404).json({ message: "Cupón no encontrado o inactivo 🔴" });
        }

        if (coupon.type === 'date_limited') {
            if (coupon.expiryDate < new Date()) {
                await Coupon.findByIdAndUpdate(coupon._id, { isActive: false });
                return res.status(400).json({ message: "El cupón ha expirado ⚠️" });
            }
        }

        if (coupon.type === 'single_use') {
            if (coupon.usedBy.includes(sanitizedEmail)) {
                return res.status(400).json({ message: "Ya utilizaste este cupón 🔴" });
            }
        }

        if (coupon.type === 'limited_uses') {
            if (coupon.maxUses !== null && coupon.usesCount >= coupon.maxUses) {
                await Coupon.findByIdAndUpdate(coupon._id, { isActive: false });
                return res.status(400).json({ message: "Este cupón alcanzó su límite de usos ⚠️" });
            }
        }

        if (coupon.scope === 'plans') {
            const applies = planIds.some(p => coupon.allowedPlans.includes(p));
            if (!applies) {
                return res.status(400).json({
                    message: "Este cupón no aplica a ninguno de los planes seleccionados 🔴"
                });
            }
        }

        res.status(200).json({
            message: "Cupón aplicado con éxito 🟢",
            coupon: {
                code:         coupon.code,
                discount:     coupon.discount,
                type:         coupon.type,
                scope:        coupon.scope,
                allowedPlans: coupon.allowedPlans,
            }
        });

    } catch (error) {
        console.error(esProduccion ? "ERROR_COUPON_VALIDATE" : `ERROR_COUPON_VALIDATE: ${error}`);
        res.status(500).json({ message: "Error interno al validar cupón 🔴" });
    }
});

// ─── OBTENER CUPONES ──────────────────────────────────────────────────────────
cartRouter.get("/api/coupons/all", adminMiddleware, async (req, res) => {
    try {
        const coupons = await Coupon.find().sort({ createdAt: -1 });
        res.status(200).json(coupons);
    } catch (error) {
        console.error(esProduccion ? "ERROR_COUPON_ALL" : `ERROR_COUPON_ALL: ${error}`);
        res.status(500).json({ message: "Error al obtener cupones 🔴" });
    }
});

// ─── ELIMINAR CUPÓN ───────────────────────────────────────────────────────────
cartRouter.delete("/api/coupons/:id", adminMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        await Coupon.findByIdAndDelete(id);
        res.status(200).json({ message: "Cupón eliminado correctamente 🟢" });
    } catch (error) {
        console.error(esProduccion ? "ERROR_COUPON_DELETE" : `ERROR_COUPON_DELETE: ${error}`);
        res.status(500).json({ message: "Error al eliminar el cupón 🔴" });
    }
});

module.exports = cartRouter;