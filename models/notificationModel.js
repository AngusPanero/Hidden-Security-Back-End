const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema(
  {
    userId:       { type: String, required: true, index: true },
    type:         { type: String, required: true, default: "application_status" },
    vacancyId:    { type: String, required: true },
    vacancyTitle: { type: String, required: true },
    companyName:  { type: String, default: null },
    companyLogo:  { type: String, default: null },
    status:       { type: String, required: true },
    read:         { type: Boolean, default: false },
  },
  { timestamps: true }
);

// Índice compuesto — búsquedas por usuario ordenadas por fecha
notificationSchema.index({ userId: 1, createdAt: -1 });

// Nunca más de 50 notificaciones por usuario — borra las más viejas automáticamente
notificationSchema.post("save", async function () {
  const count = await mongoose.model("Notification").countDocuments({ userId: this.userId });
  if (count > 50) {
    const oldest = await mongoose.model("Notification")
      .find({ userId: this.userId })
      .sort({ createdAt: 1 })
      .limit(count - 50)
      .select("_id");
    await mongoose.model("Notification").deleteMany({ _id: { $in: oldest.map(d => d._id) } });
  }
});

module.exports = mongoose.model("Notification", notificationSchema);