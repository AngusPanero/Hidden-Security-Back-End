const mongoose = require("mongoose");

// Colección "partnerPoolConfig": parámetros de la fórmula (sección 35 de la especificación).
// Hay un solo documento activo (key: "active"). Se crea solo con los valores
// por defecto la primera vez que se calcula un período.
// Cada período copia la configuración al calcularse, así que cambiarla
// nunca altera liquidaciones ya calculadas.

const PartnerPoolConfigSchema = new mongoose.Schema(
    {
        key: { type: String, required: true, unique: true, default: "active" },

        formulaVersion: { type: String, default: "PP_V1" },
        maximumPoolRate: { type: Number, default: 0.2 },
        progressWeight: { type: Number, default: 0.7 },
        completionWeight: { type: Number, default: 0.3 },
        consumptionTargetRate: { type: Number, default: 0.5 },
        enablementStrategy: { type: String, enum: ["COURSE_EQUIVALENT"], default: "COURSE_EQUIVALENT" },
        defaultCourseWeight: { type: Number, default: 1 },

        // Cómo se sacan los ingresos y suscripciones de la colección payments
        revenue: {
            source: { type: String, enum: ["PAYMENTS"], default: "PAYMENTS" },
            // ⚠️ Confirmar con la clienta: los planes de empresa, ¿son formación o servicio corporativo?
            includeEnterprisePayments: { type: Boolean, default: false },
            // Items que no son formación (no suman ingresos ni suscripciones)
            excludedItems: { type: [String], default: ["voucher"] },
            // Comisión de MP que se asume en pagos viejos sin netAmount
            defaultMpFeeRate: { type: Number, default: 0.05 },
        },

        updatedBy: { type: String, default: null },
    },
    { timestamps: true, collection: "partnerPoolConfig" }
);

module.exports =
    mongoose.models.PartnerPoolConfig || mongoose.model("PartnerPoolConfig", PartnerPoolConfigSchema);