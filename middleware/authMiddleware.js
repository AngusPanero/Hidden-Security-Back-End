const auth = require("../config/firebase")

const esProduccion = (process.env.NODE_ENV === 'production');

const verifyToken = async (req, res, next) => {
    try {
        const token =
        req.cookies?.idToken || // NAVEGADOR
        req.headers.authorization?.split(" ")[1]; // POSTMAN

        if(!token){
            return res.status(401).json({ message: "No credentials! 🔴" })
        }

        // checkRevoked = true → si se revocaron los refresh tokens (ban, unban,
        // cambio de claims), el idToken viejo deja de servir al instante en vez
        // de seguir siendo válido hasta 1 hora.
        const decoded = await auth.verifyIdToken(token, true)
        req.user = decoded // Le doy al user las custom claims verificadas

        next()
    } catch (error) {
        if (error?.code === "auth/id-token-revoked") {
            return res.status(401).json({ code: "auth/session-revoked", message: "Session revoked" });
        }
        console.error(esProduccion ? `Unauthorized! 🔴`: `Unauthorized! 🔴 ${error}`);
        return res.status(401).json({ message: "Unauthorized" });
    }
}

module.exports = verifyToken