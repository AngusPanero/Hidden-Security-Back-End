const mongoose = require("mongoose");

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

    skills: {
      type: [String],
      validate: {
        validator: (arr) =>
          arr.every((s) => IT_SKILLS.includes(s)),
        message: (props) =>
          `Skill inválida detectada en: ${props.value}`,
      },
      default: [],
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
      type: [String],
      default: [],
      comment:
        "Array de userIds (string) de perfiles básicos registrados que aplicaron a esta vacante",
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

    closesAt: {
      type: Date,
      default: null,
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
vacancySchema.index({ skills: 1 });
vacancySchema.index({ publishedBy: 1 });

const Vacancy = mongoose.model("Vacancy", vacancySchema);

module.exports = { Vacancy, IT_SKILLS };