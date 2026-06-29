const express              = require("express");
const notificationRouter   = express.Router();
const Notification         = require("../models/notificationModel");
const verifyToken          = require("../middleware/authMiddleware");
const certifiedMiddleware  = require("../middleware/certificatedMiddleware");

const esProduccion = process.env.NODE_ENV === "production";

// ─── Helper: proyección limpia — nunca exponer userId ni __v ─────────────────
function formatNotification(n) {
  return {
    id:           n._id,
    type:         n.type,
    vacancyId:    n.vacancyId,
    vacancyTitle: n.vacancyTitle,
    companyName:  n.companyName  || null,
    companyLogo:  n.companyLogo  || null,
    status:       n.status,
    read:         n.read,
    createdAt:    n.createdAt,
  };
}

// ─── GET /api/notifications ───────────────────────────────────────────────────
// Devuelve las notificaciones del usuario autenticado — máx 50, más recientes primero
notificationRouter.get("/api/notifications", certifiedMiddleware, async (req, res) => {
  try {
    const notifications = await Notification.find({ userId: req.user.uid })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    const unreadCount = notifications.filter(n => !n.read).length;

    res.json({
      data:        notifications.map(formatNotification),
      unreadCount,
    });
  } catch (err) {
    console.error(esProduccion ? "Error GET /notifications" : `Error GET /notifications: ${err}`);
    res.status(500).json({ message: "Error al obtener notificaciones" });
  }
});

// ─── PATCH /api/notifications/read-all ───────────────────────────────────────
// Marca todas las notificaciones del usuario como leídas
notificationRouter.patch("/api/notifications/read-all", certifiedMiddleware, async (req, res) => {
  try {
    await Notification.updateMany(
      { userId: req.user.uid, read: false },
      { $set: { read: true } }
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(esProduccion ? "Error PATCH /notifications/read-all" : `Error PATCH /notifications/read-all: ${err}`);
    res.status(500).json({ message: "Error al marcar notificaciones como leídas" });
  }
});

// ─── PATCH /api/notifications/:id/read ───────────────────────────────────────
// Marca una notificación específica como leída
notificationRouter.patch("/api/notifications/:id/read", certifiedMiddleware, async (req, res) => {
  try {
    const notification = await Notification.findOneAndUpdate(
      // userId en el filtro — un usuario solo puede marcar sus propias notificaciones
      { _id: req.params.id, userId: req.user.uid },
      { $set: { read: true } },
      { returnDocument: "after" }
    );

    if (!notification) return res.status(404).json({ message: "Notificación no encontrada" });
    res.json({ ok: true, data: formatNotification(notification) });
  } catch (err) {
    if (err.name === "CastError") return res.status(400).json({ message: "ID inválido" });
    console.error(esProduccion ? "Error PATCH /notifications/:id/read" : `Error PATCH /notifications/:id/read: ${err}`);
    res.status(500).json({ message: "Error al marcar notificación" });
  }
});

// ─── DELETE /api/notifications/:id ───────────────────────────────────────────
// Elimina una notificación específica
notificationRouter.delete("/api/notifications/:id", certifiedMiddleware, async (req, res) => {
  try {
    const deleted = await Notification.findOneAndDelete({
      _id:    req.params.id,
      userId: req.user.uid,  // solo puede borrar las propias
    });

    if (!deleted) return res.status(404).json({ message: "Notificación no encontrada" });
    res.json({ ok: true });
  } catch (err) {
    if (err.name === "CastError") return res.status(400).json({ message: "ID inválido" });
    console.error(esProduccion ? "Error DELETE /notifications/:id" : `Error DELETE /notifications/:id: ${err}`);
    res.status(500).json({ message: "Error al eliminar notificación" });
  }
});

// ─── DELETE /api/notifications ────────────────────────────────────────────────
// Elimina todas las notificaciones del usuario
notificationRouter.delete("/api/notifications", certifiedMiddleware, async (req, res) => {
  try {
    await Notification.deleteMany({ userId: req.user.uid });
    res.json({ ok: true });
  } catch (err) {
    console.error(esProduccion ? "Error DELETE /notifications" : `Error DELETE /notifications: ${err}`);
    res.status(500).json({ message: "Error al eliminar notificaciones" });
  }
});

module.exports = notificationRouter;