const express = require("express");
const usersDatabaseRouter = express.Router();
const { CV } = require("../models/cvModel");
const auth = require("../config/firebase"); // mismo export que usa tu script certifySkills.js
const enterpriseMiddleware = require("../middleware/enterpriseMiddleware");

const esProduccion = process.env.NODE_ENV === "production";

// ─── Helper: aplana la estructura de skills del CV a un array simple ──────────
// Soporta el formato nuevo { roles, habilidades, herramientas } y el legacy
// (array plano), igual que hicimos en el frontend.
function flattenSkills(skills) {
  if (!skills) return [];
  if (Array.isArray(skills)) return skills; // legacy
  return [
    ...(skills.roles        || []),
    ...(skills.habilidades  || []),
    ...(skills.herramientas || []),
  ];
}

// ─── Helper: trae las claims de certificación de Firebase para varios uids ────
// La fuente de verdad de "qué está certificado" es SIEMPRE Firebase Auth
// custom claims — nunca Mongo. auth.getUsers() acepta hasta 100 ids por
// llamada (límite del Admin SDK), por eso lotea.
async function getCertifiedSkillsMap(userIds) {
  const map = {};
  const uniqueIds = [...new Set(userIds)].filter(Boolean);
  const BATCH_SIZE = 100;

  for (let i = 0; i < uniqueIds.length; i += BATCH_SIZE) {
    const batch = uniqueIds.slice(i, i + BATCH_SIZE);
    const identifiers = batch.map(uid => ({ uid }));

    let result;
    try {
      result = await auth.getUsers(identifiers);
    } catch (err) {
      console.error(esProduccion ? "Error getUsers batch" : `Error getUsers batch: ${err}`);
      continue; // ese lote queda sin certificaciones antes que romper todo el request
    }

    for (const userRecord of result.users) {
      const claims = userRecord.customClaims || {};
      map[userRecord.uid] = Array.isArray(claims.skillsCertifiedByHidden)
        ? claims.skillsCertifiedByHidden
        : [];
    }
    // los uids en result.notFound quedan simplemente sin entrada en el map,
    // y más abajo se tratan como certifiedSkills: []
  }

  return map;
}

// ─── GET /api/users-database ───────────────────────────────────────────────────
// Solo empresas — lista de candidatos con filtros combinados (Mongo + Firebase)
usersDatabaseRouter.get("/api/users-database", enterpriseMiddleware, async (req, res) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 15));

    const search          = (req.query.search || "").trim();
    const declaredSkills  = req.query.declaredSkills  ? req.query.declaredSkills.split(",").filter(Boolean)  : [];
    const certifiedSkills = req.query.certifiedSkills ? req.query.certifiedSkills.split(",").filter(Boolean) : [];
    const certifiedOnly   = req.query.certifiedOnly === "true";
    const availability    = req.query.availability || "";
    const modality        = req.query.modality || "";

    // ── Filtros que Mongo puede resolver directamente ──────────────────────
    const mongoFilter = {};

    if (search) {
      const safe  = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); // escapa regex
      const regex = new RegExp(safe, "i");
      mongoFilter.$or = [
        { "personalInfo.firstName": regex },
        { "personalInfo.lastName":  regex },
        { "personalInfo.email":     regex },
        { "personalInfo.headline":  regex },
      ];
    }

    if (availability) mongoFilter.availability = availability;
    if (modality)      mongoFilter["workPreferences.modality"] = modality;

    if (declaredSkills.length > 0) {
      // cada skill pedida tiene que estar en alguna de las 3 ramas
      // (o en el array legacy, para candidatos que aún no migraron)
      mongoFilter.$and = (mongoFilter.$and || []).concat(
        declaredSkills.map(skill => ({
          $or: [
            { "skills.roles":        skill },
            { "skills.habilidades":  skill },
            { "skills.herramientas": skill },
            { skills: skill },
          ],
        }))
      );
    }

    // Traemos todo lo que matchea el filtro de Mongo. El filtro por
    // certificación depende de Firebase, así que se aplica después,
    // ANTES de paginar, para que la paginación quede consistente.
    const allMatches = await CV.find(mongoFilter).lean();

    // ── Enriquecer con certificaciones reales de Firebase ───────────────────
    const userIds = allMatches.map(cv => cv.userId);
    const certifiedMap = await getCertifiedSkillsMap(userIds);

    let enriched = allMatches.map(cv => {
      const skillsCertifiedByHidden = certifiedMap[cv.userId] || [];
      return {
        id:                      cv.userId,
        personalInfo:            cv.personalInfo,
        skills:                  cv.skills || { roles: [], habilidades: [], herramientas: [] },
        experience:              cv.experience      || [],
        education:               cv.education       || [],
        certifications:          cv.certifications  || [],
        languages:               cv.languages       || [],
        projects:                cv.projects        || [],
        availability:            cv.availability,
        workPreferences:         cv.workPreferences || {},
        updatedAt:               cv.updatedAt,
        skillsCertifiedByHidden,
        userCertificated:        skillsCertifiedByHidden.length > 0,
      };
    });

    // ── Filtros que solo se pueden aplicar después de leer Firebase ────────
    if (certifiedOnly) {
      enriched = enriched.filter(c => c.userCertificated);
    }

    if (certifiedSkills.length > 0) {
      enriched = enriched.filter(c =>
        certifiedSkills.every(skill => c.skillsCertifiedByHidden.includes(skill))
      );
    }

    // ── Skills pedidas que nadie tiene, para el warning del frontend ───────
    const declaredInResults  = new Set(enriched.flatMap(c => flattenSkills(c.skills)));
    const certifiedInResults = new Set(enriched.flatMap(c => c.skillsCertifiedByHidden));

    const unmatchedSkills = {
      declared:  declaredSkills.filter(s  => !declaredInResults.has(s)),
      certified: certifiedSkills.filter(s => !certifiedInResults.has(s)),
    };

    // ── Paginación en memoria (ya filtrado por completo) ────────────────────
    const total      = enriched.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const start      = (page - 1) * limit;
    const pageData    = enriched.slice(start, start + limit);

    res.json({
      data: pageData,
      meta: { total, page, limit, totalPages },
      unmatchedSkills,
    });
  } catch (err) {
    console.error(esProduccion ? "Error GET /users-database" : `Error GET /users-database: ${err}`);
    res.status(500).json({ message: "Error al obtener candidatos" });
  }
});

// ─── GET /api/users-database/skills-summary ────────────────────────────────────
// Universo completo de skills declaradas y certificadas, para poblar los
// dropdowns de filtro del frontend sin depender de la página actual.
usersDatabaseRouter.get("/api/users-database/skills-summary", enterpriseMiddleware, async (req, res) => {
  try {
    const allCVs = await CV.find({}, { userId: 1, skills: 1 }).lean();

    const declaredSet = new Set();
    for (const cv of allCVs) {
      for (const skill of flattenSkills(cv.skills)) declaredSet.add(skill);
    }

    const userIds = allCVs.map(cv => cv.userId);
    const certifiedMap = await getCertifiedSkillsMap(userIds);

    const certifiedSet = new Set();
    for (const uid of Object.keys(certifiedMap)) {
      for (const skill of certifiedMap[uid]) certifiedSet.add(skill);
    }

    res.json({
      declaredSkills:  [...declaredSet].sort((a, b) => a.localeCompare(b)),
      certifiedSkills: [...certifiedSet].sort((a, b) => a.localeCompare(b)),
    });
  } catch (err) {
    console.error(esProduccion ? "Error GET /skills-summary" : `Error GET /skills-summary: ${err}`);
    res.status(500).json({ message: "Error al obtener resumen de skills" });
  }
});

module.exports = usersDatabaseRouter;