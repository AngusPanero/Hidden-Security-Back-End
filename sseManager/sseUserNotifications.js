const Notification = require("../models/notificationModel");

// Mapa uid → Set de res (un usuario puede tener varias pestañas abiertas)
const userSseClients = new Map();

// ─── Notificar a un usuario específico ───────────────────────────────────────
// Guarda en DB y manda por SSE si el usuario está conectado
const notifyUser = async (userId, payload) => {
  try {
    // 1. Guardar en DB siempre — persiste aunque el usuario no esté online
    const saved = await Notification.create({
      userId,
      type:         payload.type         || "application_status",
      vacancyId:    payload.vacancyId,
      vacancyTitle: payload.vacancyTitle,
      companyName:  payload.companyName  || null,
      companyLogo:  payload.companyLogo  || null,
      status:       payload.status,
      read:         false,
    });

    // 2. Mandar por SSE solo si tiene clientes conectados
    const clients = userSseClients.get(userId);
    if (clients && clients.size > 0) {
      const data = JSON.stringify({
        id:           saved._id,
        type:         saved.type,
        vacancyId:    saved.vacancyId,
        vacancyTitle: saved.vacancyTitle,
        companyName:  saved.companyName,
        companyLogo:  saved.companyLogo,
        status:       saved.status,
        read:         saved.read,
        createdAt:    saved.createdAt.toISOString(),
      });

      clients.forEach((client) => {
        try { client.write(`data: ${data}\n\n`); }
        catch (_) { clients.delete(client); }
      });

      if (clients.size === 0) userSseClients.delete(userId);
    }
  } catch (err) {
    console.error("notifyUser error:", err.message);
  }
};

// ─── Handler SSE para usuarios autenticados ───────────────────────────────────
const userSseHandler = (req, res) => {
  const userId = req.user?.uid;
  if (!userId) return res.status(401).end();

  res.setHeader("Content-Type",      "text/event-stream");
  res.setHeader("Cache-Control",     "no-cache");
  res.setHeader("Connection",        "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  if (!userSseClients.has(userId)) userSseClients.set(userId, new Set());
  userSseClients.get(userId).add(res);

  const ping = setInterval(() => {
    try { res.write(": ping\n\n"); }
    catch (_) { clearInterval(ping); userSseClients.get(userId)?.delete(res); }
  }, 25_000);

  req.on("close", () => {
    clearInterval(ping);
    userSseClients.get(userId)?.delete(res);
    if (userSseClients.get(userId)?.size === 0) userSseClients.delete(userId);
  });
};

module.exports = { notifyUser, userSseHandler };