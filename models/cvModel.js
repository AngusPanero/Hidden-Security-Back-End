const mongoose = require("mongoose");

const cvSchema = new mongoose.Schema(
  {
    userId: {
      type:     String,
      required: [true, "userId es obligatorio"],
      unique:   true,   // un CV por usuario
      index:    true,
    },

    // ── Datos personales ───────────────────────────────────────
    personalInfo: {
      firstName:   { type: String, trim: true, default: "" },
      lastName:    { type: String, trim: true, default: "" },
      headline:    { type: String, trim: true, default: "" },
      email:       { type: String, trim: true, default: "" },
      phone:       { type: String, trim: true, default: "" },
      location:    { type: String, trim: true, default: "" },
      linkedin:    { type: String, trim: true, default: "" },
      github:      { type: String, trim: true, default: "" },
      portfolio:   { type: String, trim: true, default: "" },
      summary:     { type: String, trim: true, default: "" },
      photo:       { type: String, trim: true, default: "" },  // URL Cloudinary, opcional
    },

    // ── Experiencia laboral ────────────────────────────────────
    experience: [
      {
        company:     { type: String, trim: true, default: "" },
        position:    { type: String, trim: true, default: "" },
        location:    { type: String, trim: true, default: "" },
        startDate:   { type: String, default: "" },   // "2021-03"
        endDate:     { type: String, default: "" },   // "2023-08" o vacío si es actual
        current:     { type: Boolean, default: false },
        description: { type: String, trim: true, default: "" },
      },
    ],

    // ── Educación ──────────────────────────────────────────────
    education: [
      {
        institution: { type: String, trim: true, default: "" },
        degree:      { type: String, trim: true, default: "" },  // "Lic. Sistemas"
        field:       { type: String, trim: true, default: "" },  // "Ingeniería en Software"
        startDate:   { type: String, default: "" },
        endDate:     { type: String, default: "" },
        current:     { type: Boolean, default: false },
        description: { type: String, trim: true, default: "" },
      },
    ],

    // ── Certificaciones ────────────────────────────────────────
    certifications: [
      {
        name:         { type: String, trim: true, default: "" },
        issuer:       { type: String, trim: true, default: "" },
        date:         { type: String, default: "" },
        credentialId: { type: String, trim: true, default: "" },
        url:          { type: String, trim: true, default: "" },
      },
    ],

    // ── Skills técnicas ────────────────────────────────────────
    // Basado en el árbol de HS_SKILLS (skills.ts): áreas/roles,
    // habilidades y herramientas se guardan como arrays de strings
    // separados. El "grupo" de cada item se resuelve en el frontend
    // contra el catálogo (no se persiste), así el documento queda liviano.
    skills: {
      roles:        { type: [String], default: [] },
      habilidades:  { type: [String], default: [] },
      herramientas: { type: [String], default: [] },
    },

    // ── Idiomas ────────────────────────────────────────────────
    languages: [
      {
        language: { type: String, trim: true, default: "" },
        level:    {
          type:    String,
          enum:    ["Nativo", "Avanzado", "Intermedio", "Básico"],
          default: "Intermedio",
        },
      },
    ],

    // ── Proyectos ──────────────────────────────────────────────
    projects: [
      {
        name:        { type: String, trim: true, default: "" },
        description: { type: String, trim: true, default: "" },
        url:         { type: String, trim: true, default: "" },
        repoUrl:     { type: String, trim: true, default: "" },
        technologies:{ type: [String], default: [] },
      },
    ],

    // ── Disponibilidad ─────────────────────────────────────────
    availability: {
      type:    String,
      enum:    ["Inmediata", "2 semanas", "1 mes", "No disponible"],
      default: "Inmediata",
    },

    // ── Preferencias de trabajo ────────────────────────────────
    workPreferences: {
      modality:     { type: [String], default: [] },    // ["Remoto", "Híbrido"]
      contractType: { type: [String], default: [] },    // ["Full-time", "Freelance"]
      salaryMin:    { type: Number, default: null },
      salaryMax:    { type: Number, default: null },
      currency:     { type: String, default: "USD" },
    },
  },
  {
    timestamps: true,
    toJSON:     { virtuals: true },
    toObject:   { virtuals: true },
  }
);

const CV = mongoose.model("CV", cvSchema);
module.exports = { CV };