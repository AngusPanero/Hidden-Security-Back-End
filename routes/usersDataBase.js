const express  = require("express");
const usersDbRouter = express.Router();

const { CV }               = require("../models/cvModel");
const enterpriseMiddleware = require("../middleware/enterpriseMiddleware");
const auth                 = require("../config/firebase");

const esProduccion = process.env.NODE_ENV === "production";

// ─── Rate limiting simple por IP ──────────────────────────────────────────────
// Evita que una empresa haga requests en loop y genere full-scans repetidos
const requestCounts = new Map();
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minuto
const RATE_LIMIT_MAX       = 30;        // máx 30 requests por minuto por IP

function rateLimiter(req, res, next) {
  const ip  = req.ip || req.headers["x-forwarded-for"] || "unknown";
  const now = Date.now();

  if (!requestCounts.has(ip)) {
    requestCounts.set(ip, { count: 1, windowStart: now });
    return next();
  }

  const entry = requestCounts.get(ip);

  if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    // Nueva ventana
    requestCounts.set(ip, { count: 1, windowStart: now });
    return next();
  }

  entry.count++;
  if (entry.count > RATE_LIMIT_MAX) {
    return res.status(429).json({ message: "Demasiadas solicitudes. Intentá en un momento." });
  }

  next();
}

// ─── Helper: formatear CV para empresa ───────────────────────────────────────
// No expone userId (Firebase UID interno)
function formatForEnterprise(cv, claims) {
  return {
    // userId intencionalmente omitido — la empresa no necesita el Firebase UID
    personalInfo:            cv.personalInfo,
    skills:                  cv.skills          || [],
    experience:              cv.experience       || [],
    education:               cv.education        || [],
    certifications:          cv.certifications   || [],
    languages:               cv.languages        || [],
    projects:                cv.projects         || [],
    availability:            cv.availability     || null,
    workPreferences:         cv.workPreferences  || {},  // salario siempre visible
    updatedAt:               cv.updatedAt,
    userCertificated:        !!claims.userCertificated,
    skillsCertifiedByHidden: Array.isArray(claims.skillsCertifiedByHidden)
      ? claims.skillsCertifiedByHidden
      : [],
  };
}

// ─── GET /api/users-database ──────────────────────────────────────────────────
usersDbRouter.get("/api/users-database", enterpriseMiddleware, rateLimiter, async (req, res) => {
  try {
    const {
      page             = 1,
      limit            = 15,
      search           = "",
      declaredSkills   = "",
      certifiedSkills  = "",
      certifiedOnly    = "false",
      availability     = "",
      modality         = "",
    } = req.query;

    const parsedPage  = parseInt(page);
    const parsedLimit = parseInt(limit);

    if (isNaN(parsedPage)  || parsedPage  < 1)                    return res.status(400).json({ message: "page debe ser un entero positivo" });
    if (isNaN(parsedLimit) || parsedLimit < 1 || parsedLimit > 50) return res.status(400).json({ message: "limit debe ser entre 1 y 50" });

    const declaredSkillsArr  = declaredSkills  ? declaredSkills.split(",").map(s => s.trim()).filter(Boolean)  : [];
    const certifiedSkillsArr = certifiedSkills ? certifiedSkills.split(",").map(s => s.trim()).filter(Boolean) : [];

    // ── Filtro Mongo ───────────────────────────────────────────────────────
    const filter = {};

    if (search) {
      const regex = new RegExp(search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      filter.$or = [
        { "personalInfo.firstName": regex },
        { "personalInfo.lastName":  regex },
        { "personalInfo.email":     regex },
        { "personalInfo.headline":  regex },
      ];
    }

    if (declaredSkillsArr.length > 0) filter.skills          = { $in: declaredSkillsArr };
    if (availability)                  filter.availability    = availability;
    if (modality)                      filter["workPreferences.modality"] = modality;

    // ── Traer matches de Mongo ─────────────────────────────────────────────
    // Necesario traer todos porque certifiedOnly y certifiedSkills dependen
    // de Firebase claims que no se pueden filtrar en Mongo.
    // Limitamos a 500 como techo absoluto para evitar full-scans ilimitados.
    const allMatches = await CV.find(filter).limit(500).lean();

    if (!allMatches.length) {
      return res.json({
        data: [],
        meta: { total: 0, page: parsedPage, limit: parsedLimit, totalPages: 0 },
        unmatchedSkills: { declared: [], certified: [] },
      });
    }

    // ── Traer claims de Firebase para cada usuario en paralelo ─────────────
    const withClaims = await Promise.all(
      allMatches.map(async (cv) => {
        let claims = {};
        try {
          const userRecord = await auth.getUser(cv.userId);
          claims = userRecord.customClaims || {};
        } catch (err) {
          console.error(`No se pudo obtener claims de ${cv.userId}: ${err.message}`);
        }
        return formatForEnterprise(cv, claims);
      })
    );

    // ── Filtros post-fetch (dependen de claims) ────────────────────────────
    let filtered = withClaims;

    if (certifiedOnly === "true") {
      filtered = filtered.filter(u => u.userCertificated);
    }

    if (certifiedSkillsArr.length > 0) {
      filtered = filtered.filter(u =>
        certifiedSkillsArr.some(skill => u.skillsCertifiedByHidden.includes(skill))
      );
    }

    // ── Skills sin resultados (para mensaje de UI) ─────────────────────────
    const allDeclaredInResults  = new Set(filtered.flatMap(u => u.skills));
    const allCertifiedInResults = new Set(filtered.flatMap(u => u.skillsCertifiedByHidden));

    const unmatchedDeclared  = declaredSkillsArr.filter(s  => !allDeclaredInResults.has(s));
    const unmatchedCertified = certifiedSkillsArr.filter(s => !allCertifiedInResults.has(s));

    // ── Ordenar: certificados primero, luego por última actualización ──────
    filtered.sort((a, b) => {
      if (a.userCertificated !== b.userCertificated) return a.userCertificated ? -1 : 1;
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });

    // ── Paginar ────────────────────────────────────────────────────────────
    const total      = filtered.length;
    const totalPages = Math.ceil(total / parsedLimit);
    const skip       = (parsedPage - 1) * parsedLimit;
    const pageData   = filtered.slice(skip, skip + parsedLimit);

    res.json({
      data: pageData,
      meta: { total, page: parsedPage, limit: parsedLimit, totalPages },
      unmatchedSkills: { declared: unmatchedDeclared, certified: unmatchedCertified },
    });

  } catch (err) {
    console.error(esProduccion ? "Error GET /users-database" : `Error GET /users-database: ${err}`);
    res.status(500).json({ message: "Error al obtener la base de usuarios" });
  }
});

// ─── GET /api/users-database/skills-summary ──────────────────────────────────
usersDbRouter.get("/api/users-database/skills-summary", enterpriseMiddleware, rateLimiter, async (req, res) => {
  try {
    // Límite de 500 CVs para el resumen — evita full-scan ilimitado
    const cvs = await CV.find({}, { skills: 1, userId: 1 }).limit(500).lean();

    const declaredSet  = new Set();
    const certifiedSet = new Set();

    cvs.forEach(cv => (cv.skills || []).forEach(s => declaredSet.add(s)));

    await Promise.all(cvs.map(async (cv) => {
      try {
        const userRecord = await auth.getUser(cv.userId);
        const claims = userRecord.customClaims || {};
        (claims.skillsCertifiedByHidden || []).forEach(s => certifiedSet.add(s));
      } catch { /* ignorar usuarios no encontrados */ }
    }));

    res.json({
      declaredSkills:  Array.from(declaredSet).sort(),
      certifiedSkills: Array.from(certifiedSet).sort(),
    });

  } catch (err) {
    console.error(esProduccion ? "Error GET /skills-summary" : `Error GET /skills-summary: ${err}`);
    res.status(500).json({ message: "Error al obtener resumen de skills" });
  }
});

module.exports = usersDbRouter;