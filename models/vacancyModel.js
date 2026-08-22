const mongoose = require("mongoose");

// Lista plana legacy — la dejo por si /api/skills-list u otra parte del
// sistema todavía la consume. YA NO se usa para validar vacancy.skills.
const IT_SKILLS = [
  "JavaScript", "TypeScript", "Python", "Java", "C#", "C++", "Go", "Rust", "PHP", "Ruby",
  "React", "Vue.js", "Angular", "Next.js", "Nuxt.js", "Svelte",
  "Node.js", "Express.js", "NestJS", "Django", "FastAPI", "Spring Boot", "Laravel",
  "MongoDB", "PostgreSQL", "MySQL", "Redis", "Elasticsearch", "Firebase",
  "Docker", "Kubernetes", "AWS", "Google Cloud", "Azure", "Terraform",
  "Git", "GitHub", "GitLab", "CI/CD", "Jenkins", "GitHub Actions",
  "Linux", "Bash", "PowerShell",
  "REST APIs", "GraphQL", "WebSockets", "gRPC", "Microservices",
  "Cybersecurity", "Ethical Hacking", "Pentesting", "OSINT", "SOC", "SIEM",
  "Networking", "TCP/IP", "Firewalls", "VPN", "SSL/TLS",
  "Machine Learning", "Deep Learning", "TensorFlow", "PyTorch", "Data Science",
  "Agile", "Scrum", "Kanban", "Jira", "Confluence",
  "React Native", "Flutter", "iOS", "Android",
  "Figma", "UI/UX", "Tailwind CSS", "SASS",
  "Selenium", "Cypress", "Jest", "Testing", "QA",
  "Blockchain", "Web3", "Solidity",
  "SAP", "Salesforce", "Power BI", "Tableau"
];

const vacancySchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, "El título de la vacante es obligatorio"],
      trim: true,
      maxlength: [120, "El título no puede superar los 120 caracteres"],
    },

    description: {
      type: String,
      required: [true, "La descripción es obligatoria"],
      trim: true,
    },

    requirements: {
      type: String,
      required: [true, "Los requisitos son obligatorios"],
      trim: true,
    },

    // Skills requeridas para el puesto — mismo árbol que HS_SKILLS (skills.ts):
    // áreas/roles, habilidades y herramientas guardadas por separado.
    skills: {
      roles:        { type: [String], default: [] },
      habilidades:  { type: [String], default: [] },
      herramientas: { type: [String], default: [] },
    },

    experienceLevel: {
      type: String,
      required: [true, "El nivel de experiencia es obligatorio"],
      enum: {
        values: ["Junior", "Semi-Senior", "Senior", "Lead", "Manager"],
        message: "Nivel no válido: {VALUE}",
      },
    },

    modality: {
      type: String,
      required: [true, "La modalidad es obligatoria"],
      enum: {
        values: ["Remoto", "Presencial", "Híbrido"],
        message: "Modalidad no válida: {VALUE}",
      },
    },

    contractType: {
      type: String,
      required: [true, "El tipo de contrato es obligatorio"],
      enum: {
        values: ["Full-time", "Part-time", "Freelance", "Pasantía"],
        message: "Tipo de contrato no válido: {VALUE}",
      },
    },

    location: {
      type: String,
      trim: true,
      default: "Remoto",
    },

    salaryRange: {
      min: { type: Number, default: null },
      max: { type: Number, default: null },
      currency: { type: String, default: "USD" },
      visible: { type: Boolean, default: true },
    },

    applicants: {
      type: [
        {
          userId:         { type: String, required: true },
          applicantName:  { type: String, trim: true, default: "" },
          applicantEmail: { type: String, trim: true, default: "" },
          applicantPhone: { type: String, trim: true, default: "" },
          status:    {
            type:    String,
            enum:    ["pending", "cv_read", "filter_1", "filter_2", "filter_3", "contact", "rejected"],
            default: "pending",
          },
          appliedAt: { type: Date, default: Date.now },
        }
      ],
      default: [],
    },

    status: {
      type: String,
      enum: {
        values: ["active", "paused", "closed"],
        message: "Estado no válido: {VALUE}",
      },
      default: "active",
    },

    publishedBy: {
      type: String,
      required: [true, "El ID de la empresa publicadora es obligatorio"],
    },

    companyName: {
      type: String,
      trim: true,
      default: null,
    },

    companyLogo: {
      type: String,
      trim: true,
      default: null,
    },

    closesAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

vacancySchema.virtual("applicantsCount").get(function () {
  return this.applicants.length;
});

vacancySchema.index({ status: 1, createdAt: -1 });
vacancySchema.index({ "skills.roles": 1 });
vacancySchema.index({ "skills.habilidades": 1 });
vacancySchema.index({ "skills.herramientas": 1 });
vacancySchema.index({ publishedBy: 1 });

const Vacancy = mongoose.model("Vacancy", vacancySchema);

module.exports = { Vacancy, IT_SKILLS };