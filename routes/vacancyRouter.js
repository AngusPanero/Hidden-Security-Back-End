const express = require("express");
const vacancyRouter  = express.Router();

const { Vacancy, IT_SKILLS } = require("../models/vacancyModel");
const enterpriseMiddleware = require("../middleware/enterpriseMiddleware");
const esProduccion = process.env.NODE_ENV === "production";

// ─── Helpers de validación ────────────────────────────────────────────────────

const VALID_EXPERIENCE = ["Junior", "Semi-Senior", "Senior", "Lead", "Manager"];
const VALID_MODALITY   = ["Remoto", "Presencial", "Híbrido"];
const VALID_CONTRACT   = ["Full-time", "Part-time", "Freelance", "Pasantía"];
const VALID_STATUS     = ["active", "paused", "closed"];
const VALID_CURRENCIES = ["USD", "ARS", "EUR", "BRL"];

/**
 * @param {object} body     - req.body
 * @param {boolean} partial - true para PUT (solo campos enviados), false para POST (todos requeridos)
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateVacancyBody(body, partial = false) {
  const errors = [];
  const has = (key) => body[key] !== undefined && body[key] !== null;

  if (!partial || has("title")) {
    if (!has("title") || typeof body.title !== "string" || !body.title.trim()) {
      errors.push("title: requerido y debe ser un string no vacío");
    } else if (body.title.trim().length > 120) {
      errors.push("title: máximo 120 caracteres");
    }
  }

  if (!partial || has("description")) {
    if (!has("description") || typeof body.description !== "string" || !body.description.trim()) {
      errors.push("description: requerido y debe ser un string no vacío");
    }
  }

  if (!partial || has("requirements")) {
    if (!has("requirements") || typeof body.requirements !== "string" || !body.requirements.trim()) {
      errors.push("requirements: requerido y debe ser un string no vacío");
    }
  }

  if (has("skills")) {
    if (!Array.isArray(body.skills)) {
      errors.push("skills: debe ser un array");
    } else {
      const invalid = body.skills.filter((s) => !IT_SKILLS.includes(s));
      if (invalid.length > 0) {
        errors.push(`skills: valores no permitidos → ${invalid.join(", ")}`);
      }
    }
  }

  if (!partial || has("experienceLevel")) {
    if (!has("experienceLevel") || typeof body.experienceLevel !== "string") {
      errors.push(`experienceLevel: requerido. Opciones: ${VALID_EXPERIENCE.join(", ")}`);
    } else if (!VALID_EXPERIENCE.includes(body.experienceLevel)) {
      errors.push(`experienceLevel: "${body.experienceLevel}" no es válido. Opciones: ${VALID_EXPERIENCE.join(", ")}`);
    }
  }

  if (!partial || has("modality")) {
    if (!has("modality") || typeof body.modality !== "string") {
      errors.push(`modality: requerido. Opciones: ${VALID_MODALITY.join(", ")}`);
    } else if (!VALID_MODALITY.includes(body.modality)) {
      errors.push(`modality: "${body.modality}" no es válido. Opciones: ${VALID_MODALITY.join(", ")}`);
    }
  }

  if (!partial || has("contractType")) {
    if (!has("contractType") || typeof body.contractType !== "string") {
      errors.push(`contractType: requerido. Opciones: ${VALID_CONTRACT.join(", ")}`);
    } else if (!VALID_CONTRACT.includes(body.contractType)) {
      errors.push(`contractType: "${body.contractType}" no es válido. Opciones: ${VALID_CONTRACT.join(", ")}`);
    }
  }

  if (has("location") && typeof body.location !== "string") {
    errors.push("location: debe ser un string");
  }

  if (has("salaryRange")) {
    const sr = body.salaryRange;
    if (typeof sr !== "object" || Array.isArray(sr)) {
      errors.push("salaryRange: debe ser un objeto { min, max, currency, visible }");
    } else {
      if (sr.min !== undefined && sr.min !== null && sr.min !== "") {
        const min = Number(sr.min);
        if (isNaN(min) || min < 0) errors.push("salaryRange.min: debe ser un número positivo");
      }
      if (sr.max !== undefined && sr.max !== null && sr.max !== "") {
        const max = Number(sr.max);
        if (isNaN(max) || max < 0) errors.push("salaryRange.max: debe ser un número positivo");
      }
      if (sr.min && sr.max && Number(sr.min) > Number(sr.max)) {
        errors.push("salaryRange: min no puede ser mayor que max");
      }
      if (sr.currency && !VALID_CURRENCIES.includes(sr.currency)) {
        errors.push(`salaryRange.currency: opciones válidas → ${VALID_CURRENCIES.join(", ")}`);
      }
      if (sr.visible !== undefined && typeof sr.visible !== "boolean") {
        errors.push("salaryRange.visible: debe ser boolean");
      }
    }
  }

  if (has("closesAt") && body.closesAt !== "") {
    const d = new Date(body.closesAt);
    if (isNaN(d.getTime())) {
      errors.push("closesAt: fecha inválida");
    } else {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (d < today) errors.push("closesAt: la fecha de cierre no puede ser en el pasado");
    }
  }

  return { valid: errors.length === 0, errors };
}

vacancyRouter.get("/api/skills-list", enterpriseMiddleware, async (req, res) => {
  res.json({ skills: IT_SKILLS });
});

vacancyRouter.get("/api/vacancies", enterpriseMiddleware, async (req, res) => {
  try {
    const {
      status,
      skill,
      experienceLevel,
      page  = 1,
      limit = 10,
    } = req.query;

    const parsedPage  = parseInt(page);
    const parsedLimit = parseInt(limit);

    if (isNaN(parsedPage)  || parsedPage  < 1) return res.status(400).json({ message: "page debe ser un entero positivo" });
    if (isNaN(parsedLimit) || parsedLimit < 1 || parsedLimit > 100) return res.status(400).json({ message: "limit debe ser entre 1 y 100" });

    const filter = { publishedBy: req.user.uid };

    if (status) {
      if (!VALID_STATUS.includes(status)) {
        return res.status(400).json({ message: `status inválido. Opciones: ${VALID_STATUS.join(", ")}` });
      }
      filter.status = status;
    }

    if (experienceLevel) {
      if (!VALID_EXPERIENCE.includes(experienceLevel)) {
        return res.status(400).json({ message: `experienceLevel inválido. Opciones: ${VALID_EXPERIENCE.join(", ")}` });
      }
      filter.experienceLevel = experienceLevel;
    }

    if (skill) {
      if (typeof skill !== "string") return res.status(400).json({ message: "skill debe ser un string" });
      filter.skills = { $in: [skill] };
    }

    const skip = (parsedPage - 1) * parsedLimit;

    const [vacancies, total] = await Promise.all([
      Vacancy.find(filter).sort({ createdAt: -1 }).skip(skip).limit(parsedLimit).lean(),
      Vacancy.countDocuments(filter),
    ]);

    res.json({
      data: vacancies,
      meta: {
        total,
        page:       parsedPage,
        limit:      parsedLimit,
        totalPages: Math.ceil(total / parsedLimit),
      },
    });
  } catch (err) {
    console.error(esProduccion ? "Error GET /vacancies" : `Error GET /vacancies: ${err}`);
    res.status(500).json({ message: "Error al obtener vacantes" });
  }
});

vacancyRouter.get("/api/vacancy/:id", enterpriseMiddleware, async (req, res) => {
  try {
    const vacancy = await Vacancy.findOne({
      _id:         req.params.id,
      publishedBy: req.user.uid,  
    }).lean();

    if (!vacancy) return res.status(404).json({ message: "Vacante no encontrada" });
    res.json(vacancy);
  } catch (err) {
    if (err.name === "CastError") return res.status(400).json({ message: "ID inválido" });
    console.error(esProduccion ? "Error GET /vacancies/:id" : `Error GET /vacancies/:id: ${err}`);
    res.status(500).json({ message: "Error al obtener la vacante" });
  }
});

vacancyRouter.post("/api/vacancy", enterpriseMiddleware, async (req, res) => {
    console.log(req.body);
    
  try {
    const { valid, errors } = validateVacancyBody(req.body, false);
    if (!valid) return res.status(400).json({ message: "Error de validación", errors });

    const {
      title, description, requirements, skills,
      experienceLevel, modality, contractType,
      location, salaryRange, closesAt,
    } = req.body;

    const vacancy = new Vacancy({
        title:           title.trim(),
        description:     description.trim(),
        requirements:    requirements.trim(),
        skills:          skills || [],
        experienceLevel,
        modality,
        contractType,
        location:        location?.trim() || "Remoto",
        salaryRange:     salaryRange || { min: null, max: null, currency: "USD", visible: true },
        closesAt:        closesAt || null,
        publishedBy: req.user.uid,
        companyName:     req.user.companyName || req.user.displayName || null,  
        companyLogo:     req.user.companyLogo || req.user.photoURL   || null, 
        });

    const saved = await vacancy.save();
    res.status(201).json({ message: "Vacante creada exitosamente", data: saved });
  } catch (err) {

        console.log("ERROR RESPONSE:", err);
    if (err.name === "ValidationError") {
      const errors = Object.values(err.errors).map((e) => e.message);
      return res.status(400).json({ message: "Error de validación en modelo", errors });
    }
    console.error(esProduccion ? "Error POST /vacancies" : `Error POST /vacancies: ${err}`);
    res.status(500).json({ message: "Error al crear la vacante" });
  }
});

vacancyRouter.put("/api/vacancy/:id", enterpriseMiddleware, async (req, res) => {
  try {
    const { valid, errors } = validateVacancyBody(req.body, true);
    if (!valid) return res.status(400).json({ message: "Error de validación", errors });

    const EDITABLE_FIELDS = [
      "title", "description", "requirements", "skills",
      "experienceLevel", "modality", "contractType",
      "location", "salaryRange", "closesAt",
    ];

    const updates = {};
    EDITABLE_FIELDS.forEach((field) => {
      if (req.body[field] !== undefined) {
        updates[field] = typeof req.body[field] === "string"
          ? req.body[field].trim()
          : req.body[field];
      }
    });

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ message: "No se enviaron campos para actualizar" });
    }

    const updated = await Vacancy.findOneAndUpdate(
      { _id: req.params.id, publishedBy: req.user.uid },  
      { $set: updates },
      { new: true, runValidators: true }
    );

    if (!updated) return res.status(404).json({ message: "Vacante no encontrada o no autorizado" });
    res.json({ message: "Vacante actualizada", data: updated });
  } catch (err) {
    if (err.name === "CastError") return res.status(400).json({ message: "ID inválido" });
    if (err.name === "ValidationError") {
      const errors = Object.values(err.errors).map((e) => e.message);
      return res.status(400).json({ message: "Error de validación en modelo", errors });
    }
    console.error(esProduccion ? "Error PUT /vacancies/:id" : `Error PUT /vacancies/:id: ${err}`);
    res.status(500).json({ message: "Error al actualizar la vacante" });
  }
});

vacancyRouter.patch("/api/vacancy/:id/status", enterpriseMiddleware, async (req, res) => {
  try {
    const { status } = req.body;

    if (!status) return res.status(400).json({ message: "status es requerido" });
    if (typeof status !== "string") return res.status(400).json({ message: "status debe ser un string" });
    if (!VALID_STATUS.includes(status)) {
      return res.status(400).json({ message: `status inválido. Opciones: ${VALID_STATUS.join(", ")}` });
    }

    const updated = await Vacancy.findOneAndUpdate(
      { _id: req.params.id, publishedBy: req.user.uid },
      { $set: { status } },
      { new: true }
    );

    if (!updated) return res.status(404).json({ message: "Vacante no encontrada o no autorizado" });
    res.json({ message: `Estado cambiado a "${status}"`, data: updated });
  } catch (err) {
    if (err.name === "CastError") return res.status(400).json({ message: "ID inválido" });
    console.error(esProduccion ? "Error PATCH /status" : `Error PATCH /status: ${err}`);
    res.status(500).json({ message: "Error al cambiar estado" });
  }
});

vacancyRouter.patch("/api/vacancy/:id/applicants", async (req, res) => {
  try {
    const { userId } = req.body;

    if (!userId) return res.status(400).json({ message: "userId es requerido" });
    if (typeof userId !== "string" || !userId.trim()) {
      return res.status(400).json({ message: "userId debe ser un string no vacío" });
    }

    const vacancy = await Vacancy.findById(req.params.id);
    if (!vacancy) return res.status(404).json({ message: "Vacante no encontrada" });
    if (vacancy.status !== "active") {
      return res.status(400).json({ message: "No se puede aplicar a una vacante que no está activa" });
    }
    if (vacancy.applicants.includes(userId.trim())) {
      return res.status(409).json({ message: "El usuario ya aplicó a esta vacante" });
    }

    const updated = await Vacancy.findByIdAndUpdate(
      req.params.id,
      { $addToSet: { applicants: userId.trim() } },
      { new: true }
    );

    res.json({ message: "Aplicante registrado", applicantsCount: updated.applicants.length });
  } catch (err) {
    if (err.name === "CastError") return res.status(400).json({ message: "ID inválido" });
    console.error(esProduccion ? "Error PATCH /applicants" : `Error PATCH /applicants: ${err}`);
    res.status(500).json({ message: "Error al registrar aplicante" });
  }
});

vacancyRouter.delete("/api/vacancy/:id", enterpriseMiddleware, async (req, res) => {
  try {
    const deleted = await Vacancy.findOneAndDelete({
      _id: req.params.id,
      publishedBy: req.user.uid,   
    });

    if (!deleted) return res.status(404).json({ message: "Vacante no encontrada o no autorizado" });
    res.json({ message: "Vacante eliminada correctamente" });
  } catch (err) {
    if (err.name === "CastError") return res.status(400).json({ message: "ID inválido" });
    console.error(esProduccion ? "Error DELETE /vacancies/:id" : `Error DELETE /vacancies/:id: ${err}`);
    res.status(500).json({ message: "Error al eliminar la vacante" });
  }
});

module.exports = vacancyRouter;