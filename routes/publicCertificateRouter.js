/* ══════════════════════════════════════════════════════════════════════════
   publicCertificateRouter.js — certificados públicos verificables

   Todo lo de certificados vive en este archivo:
     • issueCertificate(...)          → se exporta y la llama certificationRouter
                                        en el momento en que valida la aprobación.
     • issueExternalCourseCertificate(...)
                                      → se exporta y la llama externalCourses
                                        (completionService) cuando un alumno
                                        aprueba un curso de una empresa partner.
     • GET /api/public-certificates/:credentialId
                                      → PÚBLICA. La consume la página
                                        /certifications/modernSoc/:credentialId
                                        y, para cursos de partners,
                                        /cursos/:partnerSlug/:courseSlug/certificado/:credentialId
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

const PublicCertificate   = require("../models/Publiccertificate");
const CertificationRecord = require("../models/CertificationRecord");
const { CV }              = require("../models/cvModel");
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

// Certificados de CURSO terminado (no de examen):
//  • kind "external" → cursos de empresas partner   (certId "ext:<courseId>")
//  • kind "course"   → cursos propios de Hidden      (certId "course:<courseId>")
// Los dos usan la ruta /cursos/:partnerSlug/:courseSlug/certificado/:credentialId
const EXTERNAL_PREFIX = "ext:";
const HIDDEN_COURSE_PREFIX = "course:";
const isExternal = (doc) => doc?.kind === "external" || doc?.kind === "course";

// Cursos propios de Hidden que emiten certificado de finalización.
// Cada curso nuevo de Hidden suma su entrada acá (la clave es el courseId de config/courses.js).
const HIDDEN_COURSE_CATALOG = {
  soc1: {
    courseSlug: "modernSoc",                 // → /cursos/hidden-security/modernSoc/certificado/:id
    prefix:     "CMSOC",                     // → HS-CMSOC-XXXX-XXXX-XXXX (el examen usa MSOC)
    title:      "Modern SOC Operations",
    facts:      ["8 módulos", "Evaluación por módulo", "Aprobación mínima 80%"],
  },
};
const HIDDEN_ISSUER = { partnerSlug: "hidden-security", partnerName: "Hidden Security" };

function certificateUrl(doc) {
  if (isExternal(doc)) {
    return `${SITE_URL}/cursos/${encodeURIComponent(doc.partnerSlug)}/${encodeURIComponent(doc.courseSlug)}/certificado/${doc.credentialId}`;
  }
  return `${SITE_URL}/certifications/${doc.slug}/${doc.credentialId}`;
}

function cleanName(name) {
  if (typeof name !== "string") return null;
  const n = name.replace(/\s+/g, " ").trim().slice(0, 120);
  return n.length >= 2 ? n : null;
}

// Nombre y apellido cargados en el CV (null si falta alguno de los dos)
async function nameFromCv(userId) {
  try {
    const cv = await CV.findOne({ userId }).select("personalInfo.firstName personalInfo.lastName").lean();
    const first = cleanName(cv?.personalInfo?.firstName);
    const last  = cleanName(cv?.personalInfo?.lastName);
    return first && last ? cleanName(`${first} ${last}`) : null;
  } catch {
    return null;
  }
}

// Nombre del titular: el que pasa certificationRouter; si no viene, el del CV
// (nombre y apellido) y, como último recurso, el displayName de Firebase.
// Para cursos de partners se pide SIEMPRE el del CV (useDisplayName = false):
// si falta, el front muestra un formulario para cargarlo.
async function resolveHolderName(userId, holderName, useDisplayName = true) {
  const fromParam = cleanName(holderName);
  if (fromParam) return fromParam;
  const fromCv = await nameFromCv(userId);
  if (fromCv || !useDisplayName) return fromCv;
  try {
    const user = await auth.getUser(userId);
    return cleanName(user.displayName);
  } catch {
    return null;
  }
}

/** Forma pública: lo único que ve cualquiera que abra el link o escanee el QR. */
function publicView(doc) {
  const base = {
    credentialId: doc.credentialId,
    kind:         doc?.kind === "external" || doc?.kind === "course" ? doc.kind : "hidden",
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
  if (!isExternal(doc)) return base;
  return {
    ...base,
    partnerSlug:    doc.partnerSlug,
    partnerName:    doc.partnerName,
    partnerLogoUrl: doc.partnerLogoUrl || null,
    courseSlug:     doc.courseSlug,
    facts:          Array.isArray(doc.facts) ? doc.facts : [],
  };
}

// ─── Emisión ────────────────────────────────────────────────────────────────
/**
 * Núcleo común: emite (o devuelve si ya existe) el certificado de un alumno.
 *  • Idempotente: una sola credencial por usuario + certId.
 *    Reaprobar con mejor nota NO cambia el link ni la fecha de emisión
 *    (el QR que ya imprimió en un CV sigue valiendo); solo actualiza score.
 *  • Si al emitirlo faltaba el nombre, se completa la próxima vez que se llame.
 *  • Nunca tira error hacia afuera: si algo falla, loguea y devuelve null.
 */
async function issueWithConfig({ userId, certId, cfg, holderName, useDisplayName = true, recordId, attemptId, score, issuedAt }) {
  try {
    if (!userId || !certId || !cfg) {
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
        const name = await resolveHolderName(userId, holderName, useDisplayName);
        if (name) update.holderName = name;
      }
      // El logo de la empresa se completa si al emitir todavía no estaba cargado
      if (cfg.extra?.partnerLogoUrl && !existing.partnerLogoUrl) update.partnerLogoUrl = cfg.extra.partnerLogoUrl;
      if (Object.keys(update).length) await PublicCertificate.updateOne({ _id: existing._id }, { $set: update });
      const holder = update.holderName || existing.holderName || null;
      return { credentialId: existing.credentialId, url: certificateUrl(existing), created: false, hasHolderName: !!holder };
    }

    const name = await resolveHolderName(userId, holderName, useDisplayName);

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
          ...(cfg.extra || {}),
        });
        return { credentialId: doc.credentialId, url: certificateUrl(doc), created: true, hasHolderName: !!name };
      } catch (err) {
        if (err?.code !== 11000) throw err;
        // Duplicado por userId+certId → otra llamada en paralelo ya lo creó.
        if (err.keyPattern?.userId || err.keyPattern?.certId) {
          const doc = await PublicCertificate.findOne({ userId, certId });
          if (doc) return { credentialId: doc.credentialId, url: certificateUrl(doc), created: false, hasHolderName: !!doc.holderName };
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

/**
 * Certificaciones de Hidden (examen). La llama certificationRouter.
 * @param {object} p
 * @param {string} p.userId      uid de Firebase
 * @param {string} p.certId      ej. "modernsoc-cert"
 * @param {string} [p.holderName] nombre completo (del CV); si falta usa el CV o el displayName
 * @param {*}      [p.recordId]  _id del CertificationRecord aprobado
 * @param {*}      [p.attemptId] _id del CertificationAttempt
 * @param {number} [p.score]     0..1
 * @param {Date}   [p.issuedAt]  fecha de aprobación (default: ahora)
 */
async function issueCertificate({ userId, certId, holderName, recordId, attemptId, score, issuedAt } = {}) {
  const cfg = CERTIFICATE_CATALOG[certId];
  if (!cfg) {
    console.error(`issueCertificate: certId desconocido (${certId})`);
    return null;
  }
  return issueWithConfig({ userId, certId, cfg, holderName, recordId, attemptId, score, issuedAt });
}

// Prefijo del credentialId para un curso de partner: las letras del courseId
// ("cp-fdcs" → "CPFDCS"), entre 2 y 8, para que valide contra CREDENTIAL_RE.
function externalPrefix(courseId) {
  const letters = String(courseId || "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 8);
  return letters.length >= 2 ? letters : "EXT";
}

/**
 * Cursos de empresas partner. La llama externalCourses (completionService)
 * cuando el alumno aprueba el curso. El nombre sale SIEMPRE del CV.
 * @param {object} p
 * @param {string} p.userId
 * @param {object} p.course   curso cargado por el registry de externalCourses
 * @param {number} [p.score]  0..1
 * @param {Date}   [p.issuedAt]
 */
async function issueExternalCourseCertificate({ userId, course, score, issuedAt } = {}) {
  if (!course?.courseId) return null;
  const facts = [
    `${course.modules.length} módulo${course.modules.length === 1 ? "" : "s"}`,
    course.finalExamStepId ? "Examen final" : "Evaluación por módulo",
    "Aprobación mínima 80%",
  ];
  const cfg = {
    slug:    course.courseSlug,
    prefix:  externalPrefix(course.courseId),
    title:   course.title,
    program: course.partnerName,
    skill:   course.title,
    extra: {
      kind:           "external",
      partnerSlug:    course.partnerSlug,
      partnerName:    course.partnerName,
      partnerLogoUrl: course.partnerLogoUrl || null,
      courseSlug:     course.courseSlug,
      facts,
    },
  };
  return issueWithConfig({
    userId,
    certId: `${EXTERNAL_PREFIX}${course.courseId}`,
    cfg,
    useDisplayName: false,
    score,
    issuedAt,
  });
}

/**
 * Cursos propios de Hidden (Modern SOC Operations). La llama courseRouter
 * cuando el alumno completa el curso. El nombre sale SIEMPRE del CV.
 * @param {object} p
 * @param {string} p.userId
 * @param {string} p.courseId  ej. "soc1"
 * @param {number} [p.score]   0..1
 * @param {Date}   [p.issuedAt]
 */
async function issueHiddenCourseCertificate({ userId, courseId, score, issuedAt } = {}) {
  const c = HIDDEN_COURSE_CATALOG[courseId];
  if (!c) {
    console.error(`issueHiddenCourseCertificate: curso sin certificado (${courseId})`);
    return null;
  }
  const cfg = {
    slug:    c.courseSlug,
    prefix:  c.prefix,
    title:   c.title,
    program: HIDDEN_ISSUER.partnerName,
    skill:   c.title,
    extra: {
      kind:           "course",
      partnerSlug:    HIDDEN_ISSUER.partnerSlug,
      partnerName:    HIDDEN_ISSUER.partnerName,
      partnerLogoUrl: null,               // el front usa el logo de Hidden
      courseSlug:     c.courseSlug,
      facts:          c.facts,
    },
  };
  return issueWithConfig({
    userId,
    certId: `${HIDDEN_COURSE_PREFIX}${courseId}`,
    cfg,
    useDisplayName: false,
    score,
    issuedAt,
  });
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

    // Certificados emitidos sin nombre (el CV no lo tenía): si ya lo cargó, se completa
    const missingName = await PublicCertificate.find({ userId: uid, holderName: null }).select("_id certId").lean();
    if (missingName.length) {
      const fromCv = await nameFromCv(uid);
      if (fromCv) {
        await PublicCertificate.updateMany(
          { _id: { $in: missingName.map(d => d._id) }, holderName: null },
          { $set: { holderName: fromCv } }
        );
      }
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

module.exports = {
  publicCertificateRouter,
  issueCertificate,
  issueExternalCourseCertificate,
  issueHiddenCourseCertificate,
  CERTIFICATE_CATALOG,
  HIDDEN_COURSE_CATALOG,
};