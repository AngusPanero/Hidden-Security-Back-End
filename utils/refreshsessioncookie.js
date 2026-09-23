const axios = require("axios");
const auth  = require("../config/firebase");
const { SESSION_COOKIE_NAME, COOKIE_OPTIONS } = require("../config/sessionCookie");

async function refreshSessionCookie(uid, res) {
    if (!process.env.FIREBASE_API_KEY)
        throw new Error("FIREBASE_API_KEY no configurada");

    // 1. Custom token firmado con la cuenta de servicio
    const customToken = await auth.createCustomToken(uid);

    // 2. Se canjea por un ID token nuevo (mismo endpoint de Identity Toolkit que usa el login)
    const { data } = await axios.post(
        `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${process.env.FIREBASE_API_KEY}`,
        { token: customToken, returnSecureToken: true }
    );

    // 3. Mismo nombre y mismas opciones que el login → reemplaza la cookie actual
    res.cookie(SESSION_COOKIE_NAME, data.idToken, COOKIE_OPTIONS);
}

module.exports = { refreshSessionCookie };