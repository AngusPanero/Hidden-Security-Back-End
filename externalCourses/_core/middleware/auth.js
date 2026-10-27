// ─────────────────────────────────────────────────────────────────────
// Adaptador de autenticación.
// ÚNICO archivo de externalCourses que toca la auth del proyecto.
// Usa el mismo middleware que el resto de los routers (verifica la cookie
// de sesión y deja el token decodificado en req.user).
// ─────────────────────────────────────────────────────────────────────

const verifyToken = require("../../../middleware/authMiddleware");

function getUser(req) {
    const user = req.user;
    if (!user) return null;
    // Firebase deja el uid en "uid"; "user_id" es el mismo valor en el token crudo
    if (!user.uid && user.user_id) user.uid = user.user_id;
    return user;
}

module.exports = function auth(req, res, next) {
    verifyToken(req, res, (err) => {
        if (err) return next(err);
        const user = getUser(req);
        if (!user || !user.uid) {
            return res.status(401).json({ error: "No autenticado" });
        }
        req.user = user;
        next();
    });
};