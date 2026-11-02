// ─────────────────────────────────────────────────────────────────────
// Ingresos y suscripciones elegibles de un período, sacados de "payments".
// ÚNICO archivo del Partner Pool que toca la colección de pagos.
//
// ⚠️ Ajustá el require a donde tengas tu modelo de pagos.
// ─────────────────────────────────────────────────────────────────────

const PaymentsMongo = require("../../../models/Payments");

// Criterio (configurable en partnerPoolConfig.revenue):
//
// Ingresos netos elegibles (eligibleNetTrainingRevenue)
//   - status "approved", isTest false, fecha (date) dentro del período
//   - al menos un item que no esté en excludedItems (por defecto "voucher")
//   - isEnterprise solo si includeEnterprisePayments = true
//   - se suma netAmount (amount − comisión MP). Si el pago es viejo y no tiene
//     netAmount, se estima con mpFeeRate o defaultMpFeeRate.
//   - Pagos que mezclan un plan con items excluidos (ej. plan + voucher) se suman
//     completos y se informan aparte (mixedPayments) para revisarlos: el pago no
//     guarda el precio de cada item por separado.
//   - refunded / charged_back / rejected / etc. no suman (no son "approved").
//
// Suscripciones elegibles (eligibleSubscriptions)
//   - usuarios distintos (client_id) con un pago elegible cuyo plan estuvo vigente
//     en algún momento del período: date < fin del período y
//     expiresAt ≥ inicio del período (si no tiene expiresAt, debe haberse pagado
//     dentro del período).

async function computeRevenue({ from, to, revenueConfig }) {
    const excluded = new Set((revenueConfig.excludedItems || []).map((i) => String(i).toLowerCase()));
    const includeEnterprise = revenueConfig.includeEnterprisePayments === true;
    const defaultFee = Number(revenueConfig.defaultMpFeeRate ?? 0.05);

    const base = { status: "approved", isTest: { $ne: true } };

    const [periodPayments, activePlanPayments] = await Promise.all([
        PaymentsMongo.find({ ...base, date: { $gte: from, $lt: to } })
            .select("client_id items plan amount netAmount mpFeeRate mpFeeAmount isEnterprise date")
            .lean(),
        PaymentsMongo.find({
            ...base,
            date: { $lt: to },
            $or: [{ expiresAt: { $gte: from } }, { expiresAt: null, date: { $gte: from } }],
        })
            .select("client_id items plan isEnterprise")
            .lean(),
    ]);

    const itemsOf = (p) => {
        const list = Array.isArray(p.items) && p.items.length ? p.items : String(p.plan || "").split("+");
        return list.map((i) => String(i).trim().toLowerCase()).filter(Boolean);
    };
    const hasTrainingItem = (p) => itemsOf(p).some((i) => !excluded.has(i));
    const hasExcludedItem = (p) => itemsOf(p).some((i) => excluded.has(i));

    let gross = 0;
    let fees = 0;
    let net = 0;
    let paymentsCount = 0;
    let estimatedFeePayments = 0;
    let mixedPayments = 0;
    let mixedPaymentsAmount = 0;
    let excludedEnterprisePayments = 0;

    for (const p of periodPayments) {
        if (!hasTrainingItem(p)) continue;
        if (p.isEnterprise && !includeEnterprise) {
            excludedEnterprisePayments++;
            continue;
        }

        const amount = Number(p.amount) || 0;
        let paymentNet;
        if (typeof p.netAmount === "number") {
            paymentNet = p.netAmount;
        } else {
            const rate = typeof p.mpFeeRate === "number" ? p.mpFeeRate : defaultFee;
            paymentNet = amount * (1 - rate);
            estimatedFeePayments++;
        }

        paymentsCount++;
        gross += amount;
        fees += amount - paymentNet;
        net += paymentNet;

        if (hasExcludedItem(p)) {
            mixedPayments++;
            mixedPaymentsAmount += paymentNet;
        }
    }

    const subscribers = new Set();
    for (const p of activePlanPayments) {
        if (!hasTrainingItem(p)) continue;
        if (p.isEnterprise && !includeEnterprise) continue;
        subscribers.add(String(p.client_id));
    }

    return {
        eligibleNetTrainingRevenue: net,
        eligibleSubscriptions: subscribers.size,
        breakdown: {
            paymentsCount,
            grossAmount: gross,
            feesAmount: fees,
            estimatedFeePayments,
            mixedPayments,
            mixedPaymentsAmount,
            excludedEnterprisePayments,
        },
    };
}

module.exports = { computeRevenue };