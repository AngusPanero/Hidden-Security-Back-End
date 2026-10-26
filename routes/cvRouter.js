const express = require("express");
const mongoose = require("mongoose");
const cvRouter = express.Router();
const { CV } = require("../models/cvModel");
const { Vacancy } = require("../models/vacancyModel");
const verifyToken = require("../middleware/authMiddleware");
const enterpriseMiddleware = require("../middleware/enterpriseMiddleware");
const auth = require("../config/firebase");
const { readCompletedCourses, getCourseSkillsFromClaims } = require("../config/courses");

const esProduccion = process.env.NODE_ENV === "production";

// ─── Helper: sanitizar strings — elimina tags HTML ────────────────────────────
function sanitizeString(val) {
  if (typeof val !== "string") return val;
  return val.replace(/<[^>]*>/g, "").trim();
}

function sanitizeDeep(obj) {
  if (Array.isArray(obj)) return obj.map(sanitizeDeep);
  if (obj && typeof obj === "object") {
    const out = {};
    for (const key of Object.keys(obj)) {
      out[key] = sanitizeDeep(obj[key]);
    }
    return out;
  }
  return sanitizeString(obj);
}

// Estructura vacía por defecto para skills (evita undefined en clientes viejos)
const EMPTY_SKILLS = { roles: [], habilidades: [], herramientas: [] };

// ─── Helper: proyección limpia del CV para el propio usuario ─────────────────
// Excluye campos internos de Mongo (_id de subdocs, __v, etc.)
function formatCVForOwner(cv) {
  if (!cv) return null;
  return {
    userId:          cv.userId,
    personalInfo:    cv.personalInfo,
    skills:          cv.skills          || EMPTY_SKILLS,
    experience:      cv.experience      || [],
    education:       cv.education       || [],
    certifications:  cv.certifications  || [],
    languages:       cv.languages       || [],
    projects:        cv.projects        || [],
    availability:    cv.availability    || null,
    workPreferences: cv.workPreferences || {},
    updatedAt:       cv.updatedAt,
    createdAt:       cv.createdAt,
  };
}

// ─── Helper: proyección del CV para empresas ──────────────────────────────────
// Igual que owner pero sin workPreferences.salaryMin/Max (dato sensible opcional)
// y sin userId interno
function formatCVForEnterprise(cv) {
  if (!cv) return null;
  return {
    personalInfo:   cv.personalInfo,
    skills:         cv.skills         || EMPTY_SKILLS,
    experience:     cv.experience     || [],
    education:      cv.education      || [],
    certifications: cv.certifications || [],
    languages:      cv.languages      || [],
    projects:       cv.projects       || [],
    availability:   cv.availability   || null,
    workPreferences: {
      modality:     cv.workPreferences?.modality     || [],
      contractType: cv.workPreferences?.contractType || [],
      currency:     cv.workPreferences?.currency     || null,
      // salaryMin y salaryMax solo si el candidato eligió mostrarlos
      ...(cv.workPreferences?.showSalary && {
        salaryMin: cv.workPreferences.salaryMin,
        salaryMax: cv.workPreferences.salaryMax,
      }),
    },
    updatedAt: cv.updatedAt,
  };
}

// ─── Helper: validaciones de Hidden para un candidato ─────────────────────────
// Duplicado a propósito de usersDatabaseRouter — se unifica al sumar otro curso.
// Todo sale de las custom claims de Firebase:
// - skillsCertifiedByHidden: examen controlado
// - completedCourses:        ids de cursos completados (ej. ["modernSoc"])
// - modernSocSkills:         árbol de skills de esos cursos (config/courses.js).
//   Se mantiene el nombre porque el front ya lo usa.
async function getCandidateValidations(userId) {
  let claims = {};
  try {
    const userRecord = await auth.getUser(userId);
    claims = userRecord.customClaims || {};
  } catch (err) {
    console.error(esProduccion ? "Error leyendo claims del candidato" : `Error leyendo claims de ${userId}: ${err.message}`);
  }

  const skillsCertifiedByHidden = Array.isArray(claims.skillsCertifiedByHidden)
    ? claims.skillsCertifiedByHidden
    : [];

  return {
    skillsCertifiedByHidden,
    completedCourses: readCompletedCourses(claims),
    modernSocSkills:  getCourseSkillsFromClaims(claims),
    userCertificated: skillsCertifiedByHidden.length > 0,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// MATCHEO vacante ↔ CV
// ══════════════════════════════════════════════════════════════════════════════
const SKILL_CATEGORIES = ["roles", "habilidades", "herramientas"];

// Peso de cada categoría en la compatibilidad (se renormaliza con las que la
// vacante pide: si no pide herramientas, roles+habilidades suman el 100 %).
const CATEGORY_WEIGHTS = { roles: 0.30, habilidades: 0.40, herramientas: 0.30 };

// ┌──────────────────────────────────────────────────────────────────────────┐
// │ COMPATIBILIDAD MÍNIMA DEL TALENTO SUGERIDO (0-100).                      │
// │ Cambiá solo este número. Solo afecta a los NO postulados: nadie por     │
// │ debajo se sugiere. Los postulados se devuelven siempre todos.           │
// │ El front lo recibe en la respuesta (minScore), no hace falta tocarlo.   │
// └──────────────────────────────────────────────────────────────────────────┘
const MIN_MATCH_SCORE = 50;

const MAX_SUGGESTIONS      = 100;  // tope de sugeridos que se devuelven (el front pagina)
const MAX_SUGGESTION_SCAN  = 500;  // CVs que se evalúan como máximo
const VERIFIED_BONUS_EACH  = 2;    // por skill pedida que Hidden validó
const VERIFIED_BONUS_MAX   = 6;
const PREFERENCE_BONUS     = 2;    // modalidad / tipo de contrato coinciden

// Minúsculas, sin tildes ni espacios extra: "Análisis de Logs " = "analisis de logs"
const norm = (s) =>
  typeof s === "string"
    ? s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim()
    : "";

// Aplana arrays o árboles { grupo: [skills] } a una lista de strings
function flattenSkills(x) {
  if (!x) return [];
  if (typeof x === "string") return [x];
  if (Array.isArray(x)) return x.flatMap(flattenSkills);
  if (typeof x === "object") return Object.values(x).flatMap(flattenSkills);
  return [];
}

function isStaffClaims(claims) {
  return !!claims && (claims.admin === true || claims.isAdmin === true || claims.isEnterprise === true);
}

// Firebase permite hasta 100 identificadores por getUsers
async function fetchAuthMap(uids) {
  const map = new Map();
  const unique = [...new Set(uids)].filter(Boolean);
  for (let i = 0; i < unique.length; i += 100) {
    const chunk = unique.slice(i, i + 100).map(uid => ({ uid }));
    const result = await auth.getUsers(chunk);
    for (const u of result.users) {
      map.set(u.uid, { claims: u.customClaims || {}, disabled: !!u.disabled });
    }
  }
  return map;
}

// Skills que Hidden validó (examen + cursos completados), normalizadas
function verifiedSetFromClaims(claims) {
  const certified = Array.isArray(claims?.skillsCertifiedByHidden) ? claims.skillsCertifiedByHidden : [];
  let course = [];
  try { course = flattenSkills(getCourseSkillsFromClaims(claims || {})); } catch { course = []; }
  return new Set([...certified, ...course].map(norm).filter(Boolean));
}

// Datos visibles del candidato (nombre, titular, foto, ubicación)
function publicProfile(cv, fallbackName = "") {
  const pi = cv?.personalInfo || {};
  const composed = [pi.firstName, pi.lastName].filter(Boolean).join(" ");
  return {
    name:     pi.fullName || pi.name || composed || fallbackName || "Sin nombre",
    headline: pi.headline || pi.title || pi.position || null,
    photo:    pi.photo || pi.photoUrl || pi.avatar || null,
    location: pi.location || pi.city || null,
  };
}

/**
 * Compatibilidad de un CV con la vacante.
 * score = cobertura ponderada de lo pedido (hasta 90)
 *       + skills pedidas validadas por Hidden (hasta 6)
 *       + modalidad y tipo de contrato que coinciden (2 + 2)
 * Una skill pedida cuenta como cubierta si está en el CV o si Hidden la validó.
 */
function computeMatch(vacancy, cv, verifiedSet) {
  const required = {};
  for (const cat of SKILL_CATEGORIES) {
    const list = Array.isArray(vacancy.skills?.[cat]) ? vacancy.skills[cat] : [];
    // Sin duplicados, manteniendo el texto original para mostrar
    const seen = new Map();
    for (const s of list) { const k = norm(s); if (k && !seen.has(k)) seen.set(k, s); }
    required[cat] = seen;
  }

  const activeCats = SKILL_CATEGORIES.filter(cat => required[cat].size > 0);
  if (!activeCats.length) return null; // la vacante no pidió skills

  const breakdown = {};
  const verifiedMatches = [];
  let weighted = 0;
  let weightSum = 0;

  for (const cat of SKILL_CATEGORIES) {
    const cvSet = new Set((cv?.skills?.[cat] || []).map(norm));
    const matched = [];
    const missing = [];
    for (const [key, label] of required[cat]) {
      const inCv = cvSet.has(key);
      const verified = verifiedSet.has(key);
      if (inCv || verified) {
        matched.push({ skill: label, verified });
        if (verified) verifiedMatches.push(label);
      } else {
        missing.push(label);
      }
    }
    breakdown[cat] = { required: required[cat].size, matched, missing };

    if (required[cat].size > 0) {
      weighted  += CATEGORY_WEIGHTS[cat] * (matched.length / required[cat].size);
      weightSum += CATEGORY_WEIGHTS[cat];
    }
  }

  const coverage = weightSum ? weighted / weightSum : 0;

  const prefs = cv?.workPreferences || {};
  const modalityMatch = Array.isArray(prefs.modality) && prefs.modality.map(norm).includes(norm(vacancy.modality));
  const contractMatch = Array.isArray(prefs.contractType) && prefs.contractType.map(norm).includes(norm(vacancy.contractType));

  const verifiedBonus = Math.min(VERIFIED_BONUS_MAX, verifiedMatches.length * VERIFIED_BONUS_EACH);
  const bonus = verifiedBonus + (modalityMatch ? PREFERENCE_BONUS : 0) + (contractMatch ? PREFERENCE_BONUS : 0);

  const totalMatched = SKILL_CATEGORIES.reduce((n, c) => n + breakdown[c].matched.length, 0);
  const totalRequired = SKILL_CATEGORIES.reduce((n, c) => n + breakdown[c].required, 0);

  return {
    // Sin ninguna skill en común no hay compatibilidad, aunque coincidan preferencias
    score: totalMatched === 0 ? 0 : Math.min(100, Math.round(coverage * 90 + bonus)),
    coverage: Math.round(coverage * 100),
    totalMatched,
    totalRequired,
    breakdown,
    verifiedMatches,
    modalityMatch,
    contractMatch,
  };
}

const byScoreDesc = (a, b) => (b.match?.score ?? -1) - (a.match?.score ?? -1);

// ─── GET /api/cv/me ───────────────────────────────────────────────────────────
cvRouter.get("/api/cv/me", verifyToken, async (req, res) => {
  try {
    const cv = await CV.findOne({ userId: req.user.uid }).lean();
    res.json({ data: formatCVForOwner(cv) });
  } catch (err) {
    console.error(esProduccion ? "Error GET /cv/me" : `Error GET /cv/me: ${err}`);
    res.status(500).json({ message: "Error al obtener el CV" });
  }
});

// ─── PUT /api/cv/me ───────────────────────────────────────────────────────────
cvRouter.put("/api/cv/me", verifyToken, async (req, res) => {
  try {
    const {
      personalInfo,
      experience,
      education,
      certifications,
      skills,
      languages,
      projects,
      availability,
      workPreferences,
    } = req.body;

    // Sanitizar todo el contenido antes de guardar — elimina HTML/scripts
    // sanitizeDeep es recursivo, así que soporta el objeto anidado
    // { roles: [], habilidades: [], herramientas: [] } sin cambios.
    const update = {};
    if (personalInfo    !== undefined) update.personalInfo    = sanitizeDeep(personalInfo);
    if (experience      !== undefined) update.experience      = sanitizeDeep(experience);
    if (education       !== undefined) update.education       = sanitizeDeep(education);
    if (certifications  !== undefined) update.certifications  = sanitizeDeep(certifications);
    if (skills          !== undefined) update.skills          = sanitizeDeep(skills);
    if (languages       !== undefined) update.languages       = sanitizeDeep(languages);
    if (projects        !== undefined) update.projects        = sanitizeDeep(projects);
    if (availability    !== undefined) update.availability    = sanitizeString(availability);
    if (workPreferences !== undefined) update.workPreferences = sanitizeDeep(workPreferences);

    const cv = await CV.findOneAndUpdate(
      { userId: req.user.uid },
      { $set: update },
      { upsert: true, returnDocument: "after", runValidators: true }
    );

    res.json({ message: "CV guardado correctamente", data: formatCVForOwner(cv) });
  } catch (err) {
    if (err.name === "ValidationError") {
      const errors = Object.values(err.errors).map((e) => e.message);
      return res.status(400).json({ message: "Error de validación", errors });
    }
    console.error(esProduccion ? "Error PUT /cv/me" : `Error PUT /cv/me: ${err}`);
    res.status(500).json({ message: "Error al guardar el CV" });
  }
});

// ─── DELETE /api/cv/me ────────────────────────────────────────────────────────
cvRouter.delete("/api/cv/me", verifyToken, async (req, res) => {
  try {
    await CV.findOneAndDelete({ userId: req.user.uid });
    res.json({ message: "CV eliminado" });
  } catch (err) {
    console.error(esProduccion ? "Error DELETE /cv/me" : `Error DELETE /cv/me: ${err}`);
    res.status(500).json({ message: "Error al eliminar el CV" });
  }
});

// ─── GET /api/cv/matches/:vacancyId ───────────────────────────────────────────
// Compatibilidad de los postulados de una vacante + candidatos con CV que
// todavía no se postularon. Solo la empresa dueña de la vacante.
cvRouter.get("/api/cv/matches/:vacancyId", enterpriseMiddleware, async (req, res) => {
  try {
    const companyUid = req.user?.uid;
    if (!companyUid) return res.status(401).json({ message: "SESIÓN_INVÁLIDA" });

    const { vacancyId } = req.params;
    if (!mongoose.isValidObjectId(vacancyId)) {
      return res.status(400).json({ message: "Vacante inválida" });
    }

    const vacancy = await Vacancy.findById(vacancyId)
      .select("title skills modality contractType experienceLevel applicants publishedBy")
      .lean();
    if (!vacancy) return res.status(404).json({ message: "Vacante no encontrada" });
    if (vacancy.publishedBy !== companyUid) {
      return res.status(403).json({ message: "ACCESO_DENEGADO" });
    }

    const applicants = Array.isArray(vacancy.applicants) ? vacancy.applicants : [];
    const applicantIds = [...new Set(applicants.map(a => a.userId).filter(Boolean))];

    // Valores pedidos tal cual se guardan (mismo catálogo HS_SKILLS que el CV)
    const reqLists = SKILL_CATEGORIES.map(cat => [cat, Array.isArray(vacancy.skills?.[cat]) ? vacancy.skills[cat] : []]);
    const hasRequirements = reqLists.some(([, list]) => list.length > 0);

    const cvProjection = "userId personalInfo skills workPreferences updatedAt";

    const [applicantCvs, candidateCvs] = await Promise.all([
      applicantIds.length
        ? CV.find({ userId: { $in: applicantIds } }).select(cvProjection).lean()
        : [],
      // Prefiltro en Mongo: CVs con al menos una skill pedida, sin los postulados
      hasRequirements
        ? CV.find({
            userId: { $nin: [...applicantIds, companyUid] },
            $or: reqLists
              .filter(([, list]) => list.length)
              .map(([cat, list]) => ({ [`skills.${cat}`]: { $in: list } })),
          })
            .select(cvProjection)
            .sort({ updatedAt: -1 })
            .limit(MAX_SUGGESTION_SCAN)
            .lean()
        : [],
    ]);

    const authMap = await fetchAuthMap([
      ...applicantIds,
      ...candidateCvs.map(cv => cv.userId),
    ]);

    // ── Postulados (todos, con o sin CV) ──
    const cvByUser = new Map(applicantCvs.map(cv => [cv.userId, cv]));
    const rankedApplicants = applicants.map(a => {
      const cv = cvByUser.get(a.userId) || null;
      const verified = verifiedSetFromClaims(authMap.get(a.userId)?.claims);
      return {
        userId:    a.userId,
        ...publicProfile(cv, a.applicantName),
        email:     a.applicantEmail || null,
        status:    a.status,
        appliedAt: a.appliedAt,
        hasCv:     !!cv,
        match:     cv ? computeMatch(vacancy, cv, verified) : null,
      };
    }).sort(byScoreDesc);

    // ── Sugeridos: no postulados, cuenta activa, no empresas/admins ──
    const suggestions = candidateCvs
      .filter(cv => {
        const info = authMap.get(cv.userId);
        return info && !info.disabled && !isStaffClaims(info.claims);
      })
      .map(cv => ({
        userId:    cv.userId,
        ...publicProfile(cv),
        cvUpdatedAt: cv.updatedAt,
        match:     computeMatch(vacancy, cv, verifiedSetFromClaims(authMap.get(cv.userId)?.claims)),
      }))
      .filter(s => s.match && s.match.score >= MIN_MATCH_SCORE)
      .sort(byScoreDesc)
      .slice(0, MAX_SUGGESTIONS);

    res.set("Cache-Control", "no-store");
    res.json({
      data: {
        vacancy: {
          id:              String(vacancy._id),
          title:           vacancy.title,
          skills:          vacancy.skills || EMPTY_SKILLS,
          modality:        vacancy.modality,
          contractType:    vacancy.contractType,
          experienceLevel: vacancy.experienceLevel,
        },
        hasRequirements,
        minScore:    MIN_MATCH_SCORE,
        applicants:  rankedApplicants,
        suggestions,
      },
    });
  } catch (err) {
    console.error(esProduccion ? "Error GET /cv/matches" : `Error GET /cv/matches/:vacancyId: ${err}`);
    res.status(500).json({ message: "Error al calcular compatibilidad" });
  }
});

// ─── GET /api/cv/user/:userId ─────────────────────────────────────────────────
// Solo empresas pueden ver el CV de un postulante específico
cvRouter.get("/api/cv/user/:userId", enterpriseMiddleware, async (req, res) => {
  try {
    const cv = await CV.findOne({ userId: req.params.userId }).lean();
    if (!cv) return res.status(404).json({ message: "CV no encontrado" });

    // Se suman las skills certificadas por examen y las validadas por curso
    const validations = await getCandidateValidations(req.params.userId);
    res.json({ data: { ...formatCVForEnterprise(cv), ...validations } });
  } catch (err) {
    console.error(esProduccion ? "Error GET /cv/user/:userId" : `Error GET /cv/user/:userId: ${err}`);
    res.status(500).json({ message: "Error al obtener el CV" });
  }
});

module.exports = cvRouter;