const esProduccion = process.env.NODE_ENV === "production";

const SESSION_COOKIE_NAME = "idToken";


const BASE_COOKIE_OPTIONS = esProduccion
    ? {
        // Producción: front y api bajo hidden-security.org
        httpOnly: true,
        secure:   true,
        sameSite: "lax",
        domain:   ".hidden-security.org",
        path:     "/",
    }
    : {
        // Desarrollo: front y back en orígenes distintos (localhost / Render)
        httpOnly: true,
        secure:   true,
        sameSite: "none",
        path:     "/",
    };

// Para res.cookie (login y refresh)
const COOKIE_OPTIONS = esProduccion
    ? { ...BASE_COOKIE_OPTIONS, maxAge: 60 * 60 * 1000 } // 1 h, igual que la vida del ID token
    : { ...BASE_COOKIE_OPTIONS };

// Para res.clearCookie (logout). Sin maxAge a propósito:
// en Express 4, un maxAge en clearCookie pisa la expiración y la cookie NO se borra.
const CLEAR_COOKIE_OPTIONS = { ...BASE_COOKIE_OPTIONS };

module.exports = {
    SESSION_COOKIE_NAME,
    COOKIE_OPTIONS,
    CLEAR_COOKIE_OPTIONS,
};