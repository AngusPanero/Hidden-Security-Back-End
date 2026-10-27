// Tipo de acceso del alumno al momento de cada evento.
// Se guarda en metadata del evento para que el cálculo mensual del
// Partner Pool sepa si ese consumo genera obligación económica.

const ACCESS_TYPES = Object.freeze({
    PAID_PLAN: "PAID_PLAN",
    COMPANY_PLAN: "COMPANY_PLAN",
    PROMOTION: "PROMOTION",
    SCHOLARSHIP: "SCHOLARSHIP",
    ADMIN: "ADMIN",
    TEST: "TEST",
});

// Política comercial: qué accesos participan del Partner Pool.
// ⚠️ Confirmar con la clienta PROMOTION, SCHOLARSHIP y COMPANY_PLAN.
const POOL_ELIGIBILITY = Object.freeze({
    PAID_PLAN: true,
    COMPANY_PLAN: true,
    PROMOTION: false,
    SCHOLARSHIP: false,
    ADMIN: false,
    TEST: false,
});

// Planes que se consideran contratados por una empresa
const COMPANY_PLANS = ["business", "enterprise"];

// Compras que no son planes (no dan acceso a cursos)
const NON_PLAN_PURCHASES = ["voucher"];

module.exports = { ACCESS_TYPES, POOL_ELIGIBILITY, COMPANY_PLANS, NON_PLAN_PURCHASES };