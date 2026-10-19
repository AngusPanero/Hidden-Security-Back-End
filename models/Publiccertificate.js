const mongoose = require("mongoose");

// ─── Certificado público verificable ─────────────────────────────────────────
// Una credencial por usuario + certificación. Es una "foto" de lo que se
// certificó en el momento de aprobar: nombre del titular, título, fecha.
// Si mañana el alumno cambia su CV o su displayName, el certificado no cambia.
//
// El credentialId es lo único que viaja en la URL pública y en el QR:
//   https://www.hidden-security.org/certifications/modernSoc/HS-MSOC-7K3F-Q9XA-M2PD
// No contiene datos personales ni el uid, y es aleatorio (no correlativo),
// así nadie puede recorrer certificados de otros cambiando un número.
//
// No tiene vencimiento: el QR apunta siempre a la misma URL. La única forma de
// que deje de mostrarse como válido es marcarlo "revoked" (ej. fraude comprobado).
const publicCertificateSchema = new mongoose.Schema(
  {
    credentialId: { type: String, required: true, unique: true },

    userId: { type: String, required: true },   // uid de Firebase — NUNCA se expone en la ruta pública
    certId: { type: String, required: true },   // ej. "modernsoc-cert"
    slug:   { type: String, required: true },   // segmento de la URL, ej. "modernSoc"

    holderName: { type: String, default: null },
    title:      { type: String, required: true }, // ej. "SOC Analyst"
    program:    { type: String, required: true }, // ej. "Modern SOC Operations"
    skill:      { type: String, required: true }, // skill que suma a skillsCertifiedByHidden

    // Referencia al intento aprobado que respalda la credencial (auditoría).
    recordId:  { type: mongoose.Schema.Types.ObjectId, ref: "CertificationRecord", default: null },
    attemptId: { type: mongoose.Schema.Types.ObjectId, ref: "CertificationAttempt", default: null },
    score:     { type: Number, default: null },   // se guarda, no se publica

    issuedAt: { type: Date, required: true },     // primera aprobación — no cambia con reintentos

    status:        { type: String, enum: ["active", "revoked"], default: "active" },
    revokedAt:     { type: Date, default: null },
    revokedReason: { type: String, default: null },
  },
  { timestamps: true }
);

publicCertificateSchema.index({ userId: 1, certId: 1 }, { unique: true });

module.exports = mongoose.model("PublicCertificate", publicCertificateSchema);