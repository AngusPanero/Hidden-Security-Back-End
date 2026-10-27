const isMaintenance = () => (process.env.IN_DEVELOPMENT || "").trim().toUpperCase() === "NOT_WORKING";

// Rutas que siguen funcionando durante el mantenimiento.
// ⚠️ Si tenés webhooks (ej: Mercado Pago), agregá su ruta acá para no perder notificaciones de pagos.
const ALLOWED_PATHS = ["/api/status"];

function statusRoute(req, res) {
    res.set("Cache-Control", "no-store");
    res.json({ maintenance: isMaintenance() });
}

function maintenanceGuard(req, res, next) {
    if (!isMaintenance()) return next();
    if (req.method === "OPTIONS") return next(); // preflight de CORS
    if (ALLOWED_PATHS.some((p) => req.path === p || req.path.startsWith(`${p}/`))) return next();

    res.set("Retry-After", "600");
    return res.status(503).json({ maintenance: true, message: "Sitio en mantenimiento" });
}

module.exports = { statusRoute, maintenanceGuard, isMaintenance };