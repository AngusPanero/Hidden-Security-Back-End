const express = require("express");
const usersDatabaseRouter = express.Router();
const { CV } = require("../models/cvModel");
const CourseProgress = require("../models/CourseSchema");
const auth = require("../config/firebase"); // mismo export que usa tu script certifySkills.js
const enterpriseMiddleware = require("../middleware/enterpriseMiddleware");
const { COURSES, flattenSkillTree } = require("../config/courses");

const esProduccion = process.env.NODE_ENV === "production";

// ─── Helper: arma un regex tolerante a acentos y mayúsculas ──────────────────
function buildFlexibleRegex(str) {
  const escaped = str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const ACCENT_MAP = {
    a: "[aá]", e: "[eé]", i: "[ií]", o: "[oó]", u: "[uúü]", n: "[nñ]",
    A: "[AÁ]", E: "[EÉ]", I: "[IÍ]", O: "[OÓ]", U: "[UÚÜ]", N: "[NÑ]",
  };
  const flexible = escaped.replace(/[aeiounAEIOUN]/g, ch => ACCENT_MAP[ch]);
  return new RegExp(flexible, "i");
}

// ─── Helper: aplana la estructura de skills del CV a un array simple ──────────
function flattenSkills(skills) {
  if (!skills) return [];
  if (Array.isArray(skills)) return skills; // legacy
  return [
    ...(skills.roles        || []),
    ...(skills.habilidades  || []),
    ...(skills.herramientas || []),
  ];
}

// ─── Helper: trae skillsCertifiedByHidden de Firebase para varios uids ────────
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
      continue;
    }

    for (const userRecord of result.users) {
      const claims = userRecord.customClaims || {};
      map[userRecord.uid] = Array.isArray(claims.skillsCertifiedByHidden)
        ? claims.skillsCertifiedByHidden
        : [];
    }
  }

  return map;
}

// ─── Helper: deriva las skills otorgadas por cursos completados ───────────────
async function getCourseSkillsMap(userIds) {
  const map = {};
  const uniqueIds = [...new Set(userIds)].filter(Boolean);
  if (uniqueIds.length === 0) return map;

  const completedProgress = await CourseProgress.find(
    { userId: { $in: uniqueIds }, isCompleted: true },
    { userId: 1, courseId: 1 }
  ).lean();

  for (const uid of uniqueIds) map[uid] = new Set();

  for (const p of completedProgress) {
    const course = COURSES[p.courseId];
    if (!course) continue;
    const skills = flattenSkillTree(course.skillTree);
    for (const skill of skills) map[p.userId].add(skill);
  }

  const result = {};
  for (const uid of uniqueIds) result[uid] = [...map[uid]];
  return result;
}

// ─── GET /api/users-database ───────────────────────────────────────────────────
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

    const mongoFilter = {};

    // Si hay término de búsqueda, además de filtrar en Mongo por nombre/email/
    // headline/skills declaradas, necesitamos saber si matchea alguna skill
    // otorgada por curso — pero esas NO viven en el documento de Mongo, se
    // calculan en memoria más abajo. Por eso guardamos el regex acá y hacemos
    // el filtro combinado (Mongo OR curso) después de tener courseSkillsMap.
    let searchRegex = null;

    if (search) {
      searchRegex = buildFlexibleRegex(search);
      mongoFilter.$or = [
        { "personalInfo.firstName": searchRegex },
        { "personalInfo.lastName":  searchRegex },
        { "personalInfo.email":     searchRegex },
        { "personalInfo.headline":  searchRegex },
        { "skills.roles":        { $elemMatch: { $regex: searchRegex } } },
        { "skills.habilidades":  { $elemMatch: { $regex: searchRegex } } },
        { "skills.herramientas": { $elemMatch: { $regex: searchRegex } } },
      ];
    }

    if (availability) mongoFilter.availability = availability;
    if (modality)      mongoFilter["workPreferences.modality"] = modality;

    if (declaredSkills.length > 0) {
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

    // Cuando hay búsqueda por texto, no podemos dejar que Mongo excluya de
    // entrada a quien solo matchea por una skill de curso (esas no están en
    // el documento). Por eso, SI hay search, traemos el universo completo
    // (sin el filtro $or de search) y filtramos en memoria más abajo, una vez
    // que ya tengamos courseSkillsMap calculado.
    const mongoFilterForQuery = { ...mongoFilter };
    if (search) delete mongoFilterForQuery.$or;

    const allMatches = await CV.find(mongoFilterForQuery).lean();

    const userIds = allMatches.map(cv => cv.userId);
    const [certifiedMap, courseSkillsMap] = await Promise.all([
      getCertifiedSkillsMap(userIds),
      getCourseSkillsMap(userIds),
    ]);

    let enriched = allMatches.map(cv => {
      const skillsCertifiedByHidden = certifiedMap[cv.userId] || [];
      const modernSocSkills         = courseSkillsMap[cv.userId] || [];
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
        modernSocSkills,
        userCertificated:        skillsCertifiedByHidden.length > 0,
      };
    });

    // ── Filtros que solo se pueden aplicar después de leer Firebase/Mongo ──
    if (certifiedOnly) {
      enriched = enriched.filter(c => c.userCertificated);
    }

    if (certifiedSkills.length > 0) {
      enriched = enriched.filter(c =>
        certifiedSkills.every(skill => c.skillsCertifiedByHidden.includes(skill))
      );
    }

    // Si había término de búsqueda, filtramos acá combinando lo que Mongo ya
    // sabía resolver (nombre/email/headline/skills declaradas) con las skills
    // otorgadas por curso — para que "escribir una skill celeste" también
    // encuentre candidatos, aunque no la hayan declarado en su CV.
    if (searchRegex) {
      enriched = enriched.filter(c => {
        const p = c.personalInfo || {};
        const matchesBasicFields =
          searchRegex.test(p.firstName || "") ||
          searchRegex.test(p.lastName  || "") ||
          searchRegex.test(p.email     || "") ||
          searchRegex.test(p.headline  || "");

        const declaredFlat = flattenSkills(c.skills);
        const matchesDeclared = declaredFlat.some(s => searchRegex.test(s));
        const matchesCourse   = (c.modernSocSkills || []).some(s => searchRegex.test(s));

        return matchesBasicFields || matchesDeclared || matchesCourse;
      });
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