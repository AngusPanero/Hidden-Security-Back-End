const mongoose = require("mongoose");

// Colección "partners": una empresa = un documento.
// Se crea sola al arrancar el server a partir de partner.config.js.
// status y partnerPool se manejan desde la DB (admin), no desde el config.

const PartnerSchema = new mongoose.Schema(
    {
        slug: { type: String, required: true, unique: true, lowercase: true, trim: true }, // = nombre de carpeta
        code: { type: String, required: true, unique: true },                              // PT-0001
        name: { type: String, required: true },
        email: { type: String, default: "" },
        logoUrl: { type: String, default: "" },
        status: {
            type: String,
            enum: ["ACTIVE", "INACTIVE", "SUSPENDED"],
            default: "ACTIVE",
        },
        partnerPool: {
            enabled: { type: Boolean, default: true },
            enabledAt: { type: Date, default: Date.now },
            disabledAt: { type: Date, default: null },
        },
    },
    { timestamps: true, collection: "partners" }
);

module.exports = mongoose.models.Partner || mongoose.model("Partner", PartnerSchema);