const axios = require("axios");
const auth  = require("../config/firebase");
const { SESSION_COOKIE_NAME, COOKIE_OPTIONS } = require("../config/sessionCookie");

async function refreshSessionCookie(uid, res) {
    console.log(`🔄 [SESSION_REFRESH] Iniciando para ${uid}...`);

    if (!process.env.FIREBASE_API_KEY)
        throw new Error("FIREBASE_API_KEY no configurada");

    // 1. Custom token firmado con la cuenta de servicio
    const customToken = await auth.createCustomToken(uid);
    console.log("🔄 [SESSION_REFRESH] 1/4 custom token creado");

    // 2. Se canjea por un ID token nuevo (mismo endpoint de Identity Toolkit que usa el login)
    const { data } = await axios.post(
        `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${process.env.FIREBASE_API_KEY}`,
        { token: customToken, returnSecureToken: true }
    );
    console.log("🔄 [SESSION_REFRESH] 2/4 ID token nuevo obtenido");

    // 3. Verificar que el token nuevo realmente trae las claims actualizadas
    const decoded = await auth.verifyIdToken(data.idToken);
    console.log("🔄 [SESSION_REFRESH] 3/4 claims dentro del token nuevo:", {
        purchases:      decoded.purchases ?? [],
        purchaseExpiry: decoded.purchaseExpiry ?? {},
        ...(decoded.isEnterprise && { enterprisePlan: decoded.enterprisePlan, vacancyLimit: decoded.vacancyLimit }),
    });

    // 4. Mismo nombre y mismas opciones que el login → reemplaza la cookie actual
    res.cookie(SESSION_COOKIE_NAME, data.idToken, COOKIE_OPTIONS);
    console.log(`✅ [SESSION_REFRESH] 4/4 cookie "${SESSION_COOKIE_NAME}" renovada`, {
        sameSite: COOKIE_OPTIONS.sameSite,
        domain:   COOKIE_OPTIONS.domain ?? "(host actual)",
        maxAge:   COOKIE_OPTIONS.maxAge ?? "(sesión del navegador)",
    });
}

module.exports = { refreshSessionCookie };