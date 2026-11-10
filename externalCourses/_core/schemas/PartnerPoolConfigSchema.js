const mongoose = require("mongoose");

// Colección "partnerPoolConfig": parámetros de la fórmula (sección 35 de la especificación).
// Hay un solo documento activo (key: "active"). Se crea solo con los valores
// por defecto la primera vez que se calcula un período.
// Cada período copia la configuración al calcularse, así que cambiarla
// nunca altera liquidaciones ya calculadas.

const PartnerPoolConfigSchema = new mongoose.Schema(
    {
        key: { type: String, required: true, unique: true, default: "active" },

        formulaVersion: { type: String, default: "PP_V1.2" }, // informativo: el cálculo usa FORMULA_VERSION del servicio
        maximumPoolRate: { type: Number, default: 0.2 },
        progressWeight: { type: Number, default: 0.7 },
        completionWeight: { type: Number, default: 0.3 },
        consumptionTargetRate: { type: Number, default: 0.5 },
        enablementStrategy: { type: String, enum: ["COURSE_EQUIVALENT"], default: "COURSE_EQUIVALENT" },
        defaultCourseWeight: { type: Number, default: 1 },

        // Cómo se sacan los ingresos y suscripciones de la colección payments
        // (ver partnerPoolRevenue.js). Todo plan elegible se valúa como el plan base.
        revenue: {
            source: { type: String, enum: ["PAYMENTS"], default: "PAYMENTS" },
            eligiblePlans: { type: [String], default: ["starter", "pro", "elite"] },
            basePlan: { type: String, default: "starter" },
            mpFeeRate: { type: Number, default: 0.05 }, // comisión de Mercado Pago que se descuenta
        },

        updatedBy: { type: String, default: null },
    },
    { timestamps: true, collection: "partnerPoolConfig" }
);

module.exports =
    mongoose.models.PartnerPoolConfig || mongoose.model("PartnerPoolConfig", PartnerPoolConfigSchema);