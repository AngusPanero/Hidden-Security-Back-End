const express = require("express");
const refreshClaimsRouter = express.Router();

const auth           = require("../config/firebase");            // Admin SDK (mismo que usa vacancyRouter)
const authMiddleware = require("../middleware/authMiddleware");  // verifica la cookie y setea req.user

const esProduccion = process.env.NODE_ENV === "production";

// ⚠️ Estos tres valores TIENEN que ser los mismos que usa tu ruta /login
// al crear la cookie. Copialos de ahí.
const SESSION_COOKIE_NAME = "session";
const SESSION_EXPIRES_MS  = 5 * 24 * 60 * 60 * 1000; // 5 días
const SESSION_COOKIE_OPTIONS = {
  maxAge:   SESSION_EXPIRES_MS,
  httpOnly: true,
  secure:   esProduccion,
  sameSite: esProduccion ? "none" : "lax",
  path:     "/",
};

// Claims que el front y los middlewares usan. Se comparan también las que
// pudieron haberse BORRADO de Firebase (por eso no alcanza con Object.keys).
const TRACKED_CLAIMS = [
  "admin", "partner", "isEnterprise", "userCertificated",
  "purchases", "purchaseExpiry",
  "enterprisePlan", "enterprisePlanExpiry", "vacancyLimit", "vacanciesUsed",
  "companyName", "companyLogo",
  "skillsCertifiedByHidden",
];

function claimsChanged(fromCookie, fromFirebase) {
  const keys = new Set([...TRACKED_CLAIMS, ...Object.keys(fromFirebase)]);
  for (const key of keys) {
    if (JSON.stringify(fromCookie[key] ?? null) !== JSON.stringify(fromFirebase[key] ?? null)) {
      return true;
    }
  }
  return false;
}

// Crea una cookie de sesión nueva desde el servidor:
// custom token → ID token (REST de Firebase Auth) → session cookie.
// El ID token resultante ya trae las custom claims actuales.
async function mintSessionCookie(uid) {
  const customToken = await auth.createCustomToken(uid);

  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${process.env.FIREBASE_API_KEY}`,
    {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ token: customToken, returnSecureToken: true }),
    }
  );

  const data = await response.json();
  if (!response.ok || !data.idToken) {
    throw new Error(`signInWithCustomToken falló: ${data?.error?.message ?? response.status}`);
  }

  return auth.createSessionCookie(data.idToken, { expiresIn: SESSION_EXPIRES_MS });
}

refreshClaimsRouter.get("/api/refresh-claims", authMiddleware, async (req, res) => {
  try {
    const uid    = req.user.uid;
    const record = await auth.getUser(uid);

    // Cuenta deshabilitada (ban) — se corta la sesión
    if (record.disabled) {
      res.clearCookie(SESSION_COOKIE_NAME, { ...SESSION_COOKIE_OPTIONS, maxAge: undefined });
      return res.status(401).json({ ok: false, code: "auth/user-banned" });
    }

    const freshClaims = record.customClaims || {};
    let sessionRefreshed = false;

    if (claimsChanged(req.user, freshClaims)) {
      try {
        const cookie = await mintSessionCookie(uid);
        res.cookie(SESSION_COOKIE_NAME, cookie, SESSION_COOKIE_OPTIONS);
        sessionRefreshed = true;
      } catch (mintErr) {
        // Si falla la renovación, la sesión actual sigue sirviendo — no se corta a nadie
        console.error(esProduccion ? "Error renovando cookie de sesión" : `Error renovando cookie de sesión: ${mintErr}`);
      }
    }

    res.json({
      ok: true,
      sessionRefreshed,
      // Compat con UserDashboard (ya lee estos dos campos)
      purchases:      freshClaims.purchases      ?? [],
      purchaseExpiry: freshClaims.purchaseExpiry ?? {},
    });
  } catch (err) {
    console.error(esProduccion ? "Error GET /refresh-claims" : `Error GET /refresh-claims: ${err}`);
    res.status(500).json({ ok: false, message: "Error al refrescar la sesión" });
  }
});

module.exports = refreshClaimsRouter;