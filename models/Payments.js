const mongoose = require("mongoose");

const PaymentsSchema = new mongoose.Schema({
    // ── Identificación de la orden ──────────────────────────────────────────
    // orderId = idempotencyKey del checkout. Único: evita dos órdenes con la misma key
    // y es el external_reference que usa el webhook para encontrar la orden.
    orderId:    { type: String, required: true, unique: true },
    client_id:  { type: String, required: true },
    email:      { type: String, required: true },

    // ── Datos del comprador ─────────────────────────────────────────────────
    nombre:        { type: String, default: "N/A" },
    dni:           { type: String, default: "N/A" },
    domicilio:     { type: String, default: "N/A" },
    ciudad:        { type: String, default: "N/A" },
    provincia:     { type: String, default: "N/A" },
    codigoPostal:  { type: String, default: "N/A" },
    telefono:      { type: String, default: "N/A" },

    // ── Compra ──────────────────────────────────────────────────────────────
    plan:   { type: String, default: "general" }, // items unidos con '+', para mostrar
    items:  { type: [String] },                   // items reales, los usa la activación
    amount: { type: Number, required: true },
    cuotas: { type: Number, default: 1 },

    couponUsed: { type: String, default: null },
    discount:   { type: Number, default: 0 },
    date:       { type: Date,   default: Date.now },
    expiresAt:  { type: Date,   default: null },

    isEnterprise: { type: Boolean, default: false },
    isTest:       { type: Boolean, default: false },

    // ── Mercado Pago ────────────────────────────────────────────────────────
    // No es required: la orden se crea antes de cobrar y el id llega después
    mp_payment_id: { type: String, default: null },

    status: {
        type: String,
        enum: [
            'created',       // orden registrada, cobro en curso
            'approved',
            'pending',
            'in_process',
            'authorized',
            'rejected',
            'cancelled',
            'refunded',
            'charged_back',
            'in_mediation',
            'failed',        // MP rechazó el request (4xx): seguro no cobró
            'error',         // fallo de red / 5xx con MP: se reintenta con la misma key
        ],
        default: 'created',
    },
    status_detail:  { type: String, default: null },
    amountMismatch: { type: Boolean },

    // ── Activación (claims + cupón) ─────────────────────────────────────────
    // Sin default a propósito: los pagos viejos no tienen el campo,
    // así el webhook nunca los vuelve a activar.
    fulfillment: {
        type: String,
        enum: ['none', 'processing', 'done', 'error'],
    },
    fulfillmentStartedAt: { type: Date },
    fulfillmentError:     { type: String },
    fulfilledAt:          { type: Date },
    claimsApplied:        { type: Boolean },
    couponConsumed:       { type: Boolean },

    // ── Administración ──────────────────────────────────────────────────────
    checked:         { type: Boolean, default: false },
    invoiceSent:     { type: Boolean, default: false },
    invoiceSentAt:   { type: Date },
    invoiceFilename: { type: String },
}, { timestamps: true });

// Tickets del usuario y chequeo de "pago abierto" en el checkout
PaymentsSchema.index({ client_id: 1, status: 1 });

const PaymentsMongo = mongoose.model("payments", PaymentsSchema);

module.exports = PaymentsMongo;