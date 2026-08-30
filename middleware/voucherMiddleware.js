const auth = require("../config/firebase");
const { CERTIFICATIONS } = require("../config/certifications");

// ─── Middleware: exige al menos 1 'voucher' disponible en purchases ──────────
// Los vouchers NO son por certId — son un pool genérico dentro del mismo
// array `purchases` que usa paymentsRouter.js (cada entrada "voucher" es un
// ticket suelto, sin expiración, se compran solos o vienen bundleados con
// pro/elite). Acá solo VERIFICAMOS que exista al menos uno — el consumo
// real (sacarlo del array) pasa en /start, para no gastarlo si el alumno
// solo entró a mirar la pantalla de reglas y se arrepintió.
async function requireVoucher(req, res, next) {
  try {
    const { certId } = req.params;
    if (!CERTIFICATIONS[certId]) {
      return res.status(400).json({ message: "Certificación no válida" });
    }

    const uid        = req.user.uid;
    const userRecord = await auth.getUser(uid);
    const claims      = userRecord.customClaims || {};
    const purchases    = Array.isArray(claims.purchases) ? claims.purchases : [];

    const hasVoucher = purchases.includes("voucher");
    if (!hasVoucher) {
      return res.status(403).json({
        message: "SIN_VOUCHER_DISPONIBLE",
        detail:  "No tenés un voucher disponible para rendir esta certificación.",
        code:    "NO_VOUCHER",
      });
    }

    req.userClaims = claims;
    next();
  } catch (err) {
    console.error("requireVoucher error:", err.message);
    res.status(500).json({ message: "Error verificando voucher" });
  }
}

module.exports = requireVoucher;