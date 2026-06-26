const express = require("express");
const cvRouter = express.Router();
const { CV } = require("../models/cvModel");
const verifyToken = require("../middleware/authMiddleware");
const enterpriseMiddleware = require("../middleware/enterpriseMiddleware");

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

// ─── Helper: proyección limpia del CV para el propio usuario ─────────────────
// Excluye campos internos de Mongo (_id de subdocs, __v, etc.)
function formatCVForOwner(cv) {
  if (!cv) return null;
  return {
    userId:          cv.userId,
    personalInfo:    cv.personalInfo,
    skills:          cv.skills          || [],
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
    skills:         cv.skills         || [],
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

// ─── GET /api/cv/user/:userId ─────────────────────────────────────────────────
// Solo empresas pueden ver el CV de un postulante específico
cvRouter.get("/api/cv/user/:userId", enterpriseMiddleware, async (req, res) => {
  try {
    const cv = await CV.findOne({ userId: req.params.userId }).lean();
    if (!cv) return res.status(404).json({ message: "CV no encontrado" });
    res.json({ data: formatCVForEnterprise(cv) });
  } catch (err) {
    console.error(esProduccion ? "Error GET /cv/user/:userId" : `Error GET /cv/user/:userId: ${err}`);
    res.status(500).json({ message: "Error al obtener el CV" });
  }
});

module.exports = cvRouter;