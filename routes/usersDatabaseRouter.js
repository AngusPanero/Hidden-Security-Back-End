const express = require("express");
const rateLimit = require("express-rate-limit");
const usersDatabaseRouter = express.Router();
const { CV } = require("../models/cvModel");
const auth = require("../config/firebase"); // mismo export que usa tu script certifySkills.js
const enterpriseMiddleware = require("../middleware/enterpriseMiddleware");
const { readCompletedCourses, getCourseSkillsFromClaims } = require("../config/courses");

const esProduccion = process.env.NODE_ENV === "production";

// ─── Validación de la query ────────────────────────────────────────────────────
// Express puede entregar un parámetro como string, como array (?a=1&a=2) o como
// objeto (?a[$ne]=x). Acá solo se aceptan strings: lo demás se ignora.
const SEARCH_MAX_LEN   = 100;  // largo máximo del texto de búsqueda
const SKILL_MAX_LEN    = 120;  // largo máximo de cada skill pedida
const SKILLS_MAX_COUNT = 30;   // skills pedidas como máximo por filtro

// Mismas opciones que el enum de cvModel y que el front
const AVAILABILITY_OPTIONS = ["Inmediata", "2 semanas", "1 mes", "No disponible"];
const MODALITY_OPTIONS     = ["Remoto", "Presencial", "Híbrido"];

const queryString = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");

const queryList = (v) =>
  typeof v === "string"
    ? v.split(",").map(s => s.trim()).filter(s => s && s.length <= SKILL_MAX_LEN).slice(0, SKILLS_MAX_COUNT)
    : [];

const queryOption = (v, options) => (typeof v === "string" && options.includes(v) ? v : "");

// Cada pedido lee todos los CVs y consulta Firebase: se limita por cuenta
const usersDatabaseLimiter = rateLimit({
  windowMs:        60 * 1000,
  max:             60,
  standardHeaders: true,
  legacyHeaders:   false,
  keyGenerator:    (req) => req.user?.uid || "anon",
  message:         { message: "Demasiadas búsquedas seguidas. Esperá un minuto." },
});

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

// ─── Helper: cursos externos para empresas (SOLO aprobados) ───────────────────
// Misma regla que formatExternalCourses de cvRouter.js (duplicado a propósito,
// igual que getCandidateValidations): las empresas ven solo los cursos que el
// candidato aprobó, con sus skills. Nunca intentos no aprobados ni sus notas.
// cv.externalCourses lo escribe únicamente el servidor (completionService).
function formatApprovedExternalCourses(ext) {
  if (!ext || typeof ext !== "object" || Array.isArray(ext)) return {};
  const out = {};
  for (const [partnerSlug, partner] of Object.entries(ext)) {
    const courses = {};
    for (const [courseSlug, c] of Object.entries(partner?.courses || {})) {
      if (!c || c.approved !== true) continue;
      courses[courseSlug] = {
        courseId:   c.courseId || null,
        title:      c.title    || courseSlug,
        approved:   true,
        score:      typeof c.score === "number" ? c.score : null,
        approvedAt: c.approvedAt || null,
        skills:     c.skills && typeof c.skills === "object" && !Array.isArray(c.skills) ? c.skills : {},
      };
    }
    if (Object.keys(courses).length) out[partnerSlug] = { partnerName: partner?.partnerName || partnerSlug, courses };
  }
  return out;
}

// Todas las skills de los cursos externos aprobados, en una lista plana
function externalCourseSkills(formatted) {
  const out = [];
  for (const partner of Object.values(formatted)) {
    for (const course of Object.values(partner.courses)) {
      for (const list of Object.values(course.skills)) {
        if (Array.isArray(list)) out.push(...list.filter(s => typeof s === "string"));
      }
    }
  }
  return out;
}

// ─── Helper: lee de Firebase las validaciones de Hidden para varios uids ──────
// Todo sale de las custom claims, en lotes de 100 (límite de getUsers):
// - skillsCertifiedByHidden: examen controlado
// - completedCourses:        ids de cursos completados (ej. ["modernSoc"])
// - courseSkills:            árbol de skills de esos cursos (config/courses.js)
async function getClaimsValidationsMap(userIds) {
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
      map[userRecord.uid] = {
        certifiedSkills:  Array.isArray(claims.skillsCertifiedByHidden) ? claims.skillsCertifiedByHidden : [],
        completedCourses: readCompletedCourses(claims),
        courseSkills:     getCourseSkillsFromClaims(claims),
      };
    }
  }

  return map;
}

// ─── GET /api/users-database ───────────────────────────────────────────────────
usersDatabaseRouter.get("/api/users-database", enterpriseMiddleware, usersDatabaseLimiter, async (req, res) => {
  try {
    const page  = Math.max(1, parseInt(queryString(req.query.page, 6))  || 1);
    const limit = Math.min(50, Math.max(1, parseInt(queryString(req.query.limit, 3)) || 15));

    // Solo strings: un array o un objeto con $ en la query se ignora
    const search          = queryString(req.query.search, SEARCH_MAX_LEN);
    const declaredSkills  = queryList(req.query.declaredSkills);
    const certifiedSkills = queryList(req.query.certifiedSkills);
    const certifiedOnly   = req.query.certifiedOnly === "true";
    const availability    = queryOption(req.query.availability, AVAILABILITY_OPTIONS);
    const modality        = queryOption(req.query.modality, MODALITY_OPTIONS);

    const mongoFilter = {};

    // Si hay término de búsqueda, además de filtrar en Mongo por nombre/email/
    // headline/skills declaradas, necesitamos saber si matchea alguna skill
    // otorgada por curso — pero esas NO viven en el documento del CV, salen de
    // las claims. Por eso guardamos el regex acá y hacemos el filtro combinado
    // (Mongo OR curso) después de leer las claims.
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
    // que ya tengamos las claims leídas.
    const mongoFilterForQuery = { ...mongoFilter };
    if (search) delete mongoFilterForQuery.$or;

    const allMatches = await CV.find(mongoFilterForQuery).lean();

    const userIds = allMatches.map(cv => cv.userId);
    const validationsMap = await getClaimsValidationsMap(userIds);

    let enriched = allMatches.map(cv => {
      const v = validationsMap[cv.userId];
      const skillsCertifiedByHidden = v?.certifiedSkills  || [];
      // Se mantiene el nombre modernSocSkills porque el front ya lo usa —
      // ahora son las skills de TODOS los cursos completados según la claim.
      const modernSocSkills         = v?.courseSkills     || [];
      const completedCourses        = v?.completedCourses || [];
      const externalCourses         = formatApprovedExternalCourses(cv.externalCourses);
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
        completedCourses,
        externalCourses,
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
        // Skills de cursos externos aprobados (también se ven en celeste en el front)
        const matchesExternal = externalCourseSkills(c.externalCourses).some(s => searchRegex.test(s));

        return matchesBasicFields || matchesDeclared || matchesCourse || matchesExternal;
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
usersDatabaseRouter.get("/api/users-database/skills-summary", enterpriseMiddleware, usersDatabaseLimiter, async (req, res) => {
  try {
    const allCVs = await CV.find({}, { userId: 1, skills: 1 }).lean();

    const declaredSet = new Set();
    for (const cv of allCVs) {
      for (const skill of flattenSkills(cv.skills)) declaredSet.add(skill);
    }

    const userIds = allCVs.map(cv => cv.userId);
    const validationsMap = await getClaimsValidationsMap(userIds);

    const certifiedSet = new Set();
    for (const uid of Object.keys(validationsMap)) {
      for (const skill of validationsMap[uid].certifiedSkills) certifiedSet.add(skill);
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