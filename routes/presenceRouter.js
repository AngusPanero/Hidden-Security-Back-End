const express = require("express");
const auth = require("../config/firebase");
const verifyToken = require("../middleware/authMiddleware");

const presenceRouter = express.Router();

// ─── Presencia en línea ───────────────────────────────────────────────────────
// Cada usuario logueado manda un "latido" cada minuto mientras tiene la app
// abierta y visible. Se considera en línea si su último latido tiene menos de
// ONLINE_WINDOW_MS. Se guarda en memoria: es un dato efímero, no hace falta
// persistirlo (si el server reinicia, en un minuto se vuelve a llenar solo).
// Si algún día el backend corre en varias instancias, esto pasa a Mongo/Redis.
const ONLINE_WINDOW_MS = 2 * 60 * 1000;    // 2 min sin latido = desconectado
const SWEEP_EVERY_MS   = 5 * 60 * 1000;    // limpieza de entradas viejas

const lastSeen = new Map(); // uid → timestamp (ms)

setInterval(() => {
  const limit = Date.now() - ONLINE_WINDOW_MS;
  for (const [uid, t] of lastSeen) if (t < limit) lastSeen.delete(uid);
}, SWEEP_EVERY_MS).unref();

function isAdminClaims(claims) {
  return !!claims && (claims.admin === true || claims.isAdmin === true);
}

function onlineUids() {
  const limit = Date.now() - ONLINE_WINDOW_MS;
  return [...lastSeen.entries()].filter(([, t]) => t >= limit).map(([uid]) => uid);
}

// ─── POST /api/presence/ping — latido del usuario logueado ────────────────────
presenceRouter.post("/api/presence/ping", verifyToken, (req, res) => {
  const uid = req.user?.uid;
  if (!uid) return res.status(401).json({ message: "SESIÓN_INVÁLIDA" });
  // Los admins no cuentan: ni se registran
  if (isAdminClaims(req.user)) return res.status(204).end();
  lastSeen.set(uid, Date.now());
  res.status(204).end();
});

// ─── POST /api/presence/leave — cerró la pestaña o la sesión ──────────────────
presenceRouter.post("/api/presence/leave", verifyToken, (req, res) => {
  if (req.user?.uid) lastSeen.delete(req.user.uid);
  res.status(204).end();
});

// ─── Middleware: admin verificado en vivo contra Firebase ─────────────────────
async function requireFreshAdmin(req, res, next) {
  const uid = req.user?.uid;
  if (!uid) return res.status(401).json({ message: "SESIÓN_INVÁLIDA" });
  try {
    const record = await auth.getUser(uid);
    if (record.disabled || !isAdminClaims(record.customClaims)) {
      return res.status(403).json({ message: "ACCESO_DENEGADO" });
    }
    next();
  } catch (err) {
    console.error("❌ [presence] Error verificando admin:", err.message);
    return res.status(403).json({ message: "ACCESO_DENEGADO" });
  }
}

// ─── GET /api/admin/presence — quién está en línea (sin admins) ───────────────
presenceRouter.get("/api/admin/presence", verifyToken, requireFreshAdmin, async (req, res) => {
  try {
    const uids = onlineUids();

    // Segundo filtro con las claims actuales: si alguien pasó a admin después
    // de su último latido, o lo deshabilitaron, no se cuenta.
    const online = [];
    for (let i = 0; i < uids.length; i += 100) {
      const result = await auth.getUsers(uids.slice(i, i + 100).map(uid => ({ uid })));
      for (const u of result.users) {
        if (u.disabled || isAdminClaims(u.customClaims)) continue;
        online.push({ uid: u.uid, lastSeen: new Date(lastSeen.get(u.uid)).toISOString() });
      }
    }

    res.set("Cache-Control", "no-store");
    res.json({ count: online.length, online, windowSeconds: ONLINE_WINDOW_MS / 1000 });
  } catch (err) {
    console.error("❌ [presence] Error armando presencia:", err);
    res.status(500).json({ message: "ERROR_PRESENCIA" });
  }
});

module.exports = presenceRouter;