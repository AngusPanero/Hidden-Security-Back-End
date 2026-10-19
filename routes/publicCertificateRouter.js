/* ══════════════════════════════════════════════════════════════════════════
   publicCertificateRouter.js — certificados públicos verificables

   Todo lo de certificados vive en este archivo:
     • issueCertificate(...)          → se exporta y la llama certificationRouter
                                        en el momento en que valida la aprobación.
     • GET /api/public-certificates/:credentialId
                                      → PÚBLICA. La consume la página
                                        /certifications/modernSoc/:credentialId
                                        (y es lo que abre quien escanea el QR).
     • GET /api/certificates/mine     → con sesión. Devuelve los certificados del
                                        alumno con su link, para mostrarlos en el
                                        dashboard o en la pantalla de resultado.
                                        Si el alumno aprobó ANTES de que existiera
                                        este sistema, se le emite acá (backfill).

   Montaje en index.js:
     const { publicCertificateRouter } = require("./routes/publicCertificateRouter");
     app.use(publicCertificateRouter);
══════════════════════════════════════════════════════════════════════════ */
const express   = require("express");
const crypto    = require("crypto");
const rateLimit = require("express-rate-limit");

const PublicCertificate   = require("../models/PublicCertificate");
const CertificationRecord = require("../models/CertificationRecord");
const verifyToken         = require("../middleware/authMiddleware");
const auth                = require("../config/firebase");

const publicCertificateRouter = express.Router();
const esProduccion = process.env.NODE_ENV === "production";

// URL pública del front (con www, que es el dominio canónico).
const SITE_URL = (process.env.PUBLIC_SITE_URL || "https://www.hidden-security.org").replace(/\/+$/, "");

// ─── Catálogo de certificaciones que emiten certificado público ─────────────
// Cada certificación futura suma su entrada acá. La clave es el certId que ya
// usa certificationRouter ("modernsoc-cert").
const CERTIFICATE_CATALOG = {
  "modernsoc-cert": {
    slug:           "modernSoc",              // → /certifications/modernSoc/:credentialId
    prefix:         "MSOC",                   // → HS-MSOC-XXXX-XXXX-XXXX
    title:          "SOC Analyst",
    program:        "Modern SOC Operations",
    skill:          "SOC Analyst",
    totalQuestions: 80,                       // solo cuentan los intentos del examen real (no los de test)
  },
};

// ─── Utilidades ─────────────────────────────────────────────────────────────

// Sin 0/O, 1/I/L para que se pueda dictar o tipear sin errores.
const ID_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const CREDENTIAL_RE = /^HS-[A-Z]{2,8}-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/;

function randomBlock(len) {
  const bytes = crypto.randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i++) out += ID_ALPHABET[bytes[i] % ID_ALPHABET.length];
  return out;
}

function generateCredentialId(prefix) {
  return `HS-${prefix}-${randomBlock(4)}-${randomBlock(4)}-${randomBlock(4)}`;
}

function certificateUrl(doc) {
  return `${SITE_URL}/certifications/${doc.slug}/${doc.credentialId}`;
}

function cleanName(name) {
  if (typeof name !== "string") return null;
  const n = name.replace(/\s+/g, " ").trim().slice(0, 120);
  return n.length >= 2 ? n : null;
}

// Nombre del titular: el que pasa certificationRouter (idealmente el del CV);
// si no viene, el displayName de Firebase.
async function resolveHolderName(userId, holderName) {
  const fromParam = cleanName(holderName);
  if (fromParam) return fromParam;
  try {
    const user = await auth.getUser(userId);
    return cleanName(user.displayName);
  } catch {
    return null;
  }
}

/** Forma pública: lo único que ve cualquiera que abra el link o escanee el QR. */
function publicView(doc) {
  return {
    credentialId: doc.credentialId,
    slug:         doc.slug,
    holderName:   doc.holderName,
    title:        doc.title,
    program:      doc.program,
    skill:        doc.skill,
    issuedAt:     doc.issuedAt,
    status:       doc.status,
    revokedAt:    doc.status === "revoked" ? doc.revokedAt : null,
    url:          certificateUrl(doc),
  };
}

// ─── Emisión (exportada) ────────────────────────────────────────────────────
/**
 * Emite (o devuelve si ya existe) el certificado público de un alumno.
 * La llama certificationRouter justo después de validar la aprobación.
 *
 *  • Idempotente: una sola credencial por usuario + certificación.
 *    Reaprobar con mejor nota NO cambia el link ni la fecha de emisión
 *    (el QR que ya imprimió en un CV sigue valiendo); solo actualiza score.
 *  • Nunca tira error hacia afuera: si algo falla, loguea y devuelve null,
 *    para que un problema acá jamás rompa la aprobación del examen.
 *
 * @param {object} p
 * @param {string} p.userId      uid de Firebase
 * @param {string} p.certId      ej. "modernsoc-cert"
 * @param {string} [p.holderName] nombre completo (del CV); si falta usa displayName
 * @param {*}      [p.recordId]  _id del CertificationRecord aprobado
 * @param {*}      [p.attemptId] _id del CertificationAttempt
 * @param {number} [p.score]     0..1
 * @param {Date}   [p.issuedAt]  fecha de aprobación (default: ahora)
 * @returns {Promise<{credentialId:string, url:string, created:boolean}|null>}
 */
async function issueCertificate({ userId, certId, holderName, recordId, attemptId, score, issuedAt } = {}) {
  try {
    const cfg = CERTIFICATE_CATALOG[certId];
    if (!userId || !cfg) {
      console.error(`issueCertificate: datos inválidos (userId=${!!userId}, certId=${certId})`);
      return null;
    }

    const existing = await PublicCertificate.findOne({ userId, certId });
    if (existing) {
      const update = {};
      if (typeof score === "number" && (existing.score == null || score > existing.score)) {
        update.score = score;
        if (recordId)  update.recordId  = recordId;
        if (attemptId) update.attemptId = attemptId;
      }
      if (!existing.holderName) {
        const name = await resolveHolderName(userId, holderName);
        if (name) update.holderName = name;
      }
      if (Object.keys(update).length) await PublicCertificate.updateOne({ _id: existing._id }, { $set: update });
      return { credentialId: existing.credentialId, url: certificateUrl(existing), created: false };
    }

    const name = await resolveHolderName(userId, holderName);

    // Reintenta si (casi imposible) el credentialId sorteado ya existe.
    for (let i = 0; i < 5; i++) {
      try {
        const doc = await PublicCertificate.create({
          credentialId: generateCredentialId(cfg.prefix),
          userId, certId,
          slug:    cfg.slug,
          title:   cfg.title,
          program: cfg.program,
          skill:   cfg.skill,
          holderName: name,
          recordId:  recordId  || null,
          attemptId: attemptId || null,
          score:     typeof score === "number" ? score : null,
          issuedAt:  issuedAt ? new Date(issuedAt) : new Date(),
        });
        return { credentialId: doc.credentialId, url: certificateUrl(doc), created: true };
      } catch (err) {
        if (err?.code !== 11000) throw err;
        // Duplicado por userId+certId → otra llamada en paralelo ya lo creó.
        if (err.keyPattern?.userId || err.keyPattern?.certId) {
          const doc = await PublicCertificate.findOne({ userId, certId });
          if (doc) return { credentialId: doc.credentialId, url: certificateUrl(doc), created: false };
        }
        // Duplicado de credentialId → se sortea otro.
      }
    }
    throw new Error("No se pudo generar un credentialId único");
  } catch (err) {
    console.error("issueCertificate falló 🔴", esProduccion ? "" : err);
    return null;
  }
}

// ─── Rutas ──────────────────────────────────────────────────────────────────

const publicLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Demasiadas consultas, probá en un minuto" },
});

// PÚBLICA — verificación del certificado (link compartido o QR escaneado)
publicCertificateRouter.get("/api/public-certificates/:credentialId", publicLimiter, async (req, res) => {
  try {
    const credentialId = String(req.params.credentialId || "").toUpperCase();
    if (!CREDENTIAL_RE.test(credentialId)) {
      return res.status(404).json({ message: "Certificado no encontrado" });
    }

    const doc = await PublicCertificate.findOne({ credentialId }).lean();
    if (!doc) return res.status(404).json({ message: "Certificado no encontrado" });

    res.set("Cache-Control", "public, max-age=300");
    res.json(publicView(doc));
  } catch (err) {
    console.error("Error leyendo certificado público 🔴", esProduccion ? "" : err);
    res.status(500).json({ message: "Error al obtener el certificado" });
  }
});

// CON SESIÓN — certificados del alumno logueado (+ backfill de aprobados viejos)
publicCertificateRouter.get("/api/certificates/mine", verifyToken, async (req, res) => {
  try {
    const uid = req.user.uid;

    for (const [certId, cfg] of Object.entries(CERTIFICATE_CATALOG)) {
      const has = await PublicCertificate.exists({ userId: uid, certId });
      if (has) continue;

      const best = await CertificationRecord.findOne({
        userId: uid, certId, result: "passed", totalQuestions: cfg.totalQuestions,
      }).sort({ score: -1 }).lean();
      if (!best) continue;

      const firstPass = await CertificationRecord.findOne({
        userId: uid, certId, result: "passed", totalQuestions: cfg.totalQuestions,
      }).sort({ completedAt: 1 }).select("completedAt").lean();

      await issueCertificate({
        userId: uid, certId,
        recordId: best._id, attemptId: best.attemptId, score: best.score,
        issuedAt: firstPass?.completedAt || best.completedAt || best.createdAt,
      });
    }

    const docs = await PublicCertificate.find({ userId: uid }).sort({ issuedAt: -1 }).lean();
    // certId solo en esta ruta privada (la pública no lo expone): el front
    // lo usa para saber qué card del catálogo corresponde a cada certificado.
    res.json({ certificates: docs.map(d => ({ ...publicView(d), certId: d.certId })) });
  } catch (err) {
    console.error("Error listando certificados 🔴", esProduccion ? "" : err);
    res.status(500).json({ message: "Error al obtener tus certificados" });
  }
});

module.exports = { publicCertificateRouter, issueCertificate, CERTIFICATE_CATALOG };