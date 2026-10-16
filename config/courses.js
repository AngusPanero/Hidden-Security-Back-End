const { MODERN_SOC_OPERATIONS_VALIDATED_SKILLS } = require("../skills/modernSocSkills");
const modernSocBank = require("../bancoPreguntasModernSocCurso/bancoPreguntasModernSoc");

// Steps por módulo = PDFs del módulo + 1 quiz final.
// Cada módulo tiene socIntro + socN… + socFinal, y cierra con su quiz.
//   M1:  8 PDFs (intro, soc1-soc6,  final) + quiz =  9
//   M2: 10 PDFs (intro, soc1-soc8,  final) + quiz = 11
//   M3: 11 PDFs (intro, soc1-soc9,  final) + quiz = 12
//   M4: 13 PDFs (intro, soc1-soc11, final) + quiz = 14
//   M5: 10 PDFs (intro, soc1-soc8,  final) + quiz = 11
//   M6:  9 PDFs (intro, soc1-soc7,  final) + quiz = 10
//   M7:  9 PDFs (intro, soc1-soc7,  final) + quiz = 10
//   M8:  9 PDFs (intro, soc1-soc7,  final) + quiz = 10
// ⚠️ Tiene que coincidir 1:1 con MODULES_CONFIG del front (Soc1Course.tsx).
const SOC1_MODULE_SIZES = [9, 11, 12, 14, 11, 10, 10, 10];

// El quiz de cada módulo es siempre su último step — se calcula acumulando
// los tamaños de SOC1_MODULE_SIZES en orden.
const soc1QuizSteps = [];
let soc1Cursor = 0;
for (const size of SOC1_MODULE_SIZES) {
  soc1Cursor += size;
  soc1QuizSteps.push(soc1Cursor - 1);
}
// → [8, 19, 31, 45, 56, 66, 76, 86]

const soc1TotalSteps = SOC1_MODULE_SIZES.reduce((sum, size) => sum + size, 0);
// → 87

// Un quiz por módulo → el banco tiene que tener exactamente un módulo por quiz.
if (modernSocBank.moduleCount() !== soc1QuizSteps.length) {
  throw new Error(
    `[courses] soc1 tiene ${soc1QuizSteps.length} quizzes pero el banco tiene ` +
    `${modernSocBank.moduleCount()} módulos`
  );
}

const COURSES = {
  soc1: {
    title:             "Modern SOC Operations",
    // Valor que entra en la claim completedCourses al terminar el curso.
    // Es la fuente de verdad de "qué cursos completó" y de qué árbol de
    // skills le corresponde (ver getCourseSkillsFromClaims).
    completionClaimId: "modernSoc",
    totalSteps:   soc1TotalSteps, // 87
    quizSteps:    soc1QuizSteps,  // [8,19,31,45,56,66,76,86]
    passingScore: 0.70,
    // Banco de preguntas propio del curso — el router lo usa para servir el
    // quiz (sin respuestas) y para corregir. Cada curso futuro trae el suyo.
    quizBank:     modernSocBank,
    // Skills que otorga el curso al completarse — usersDatabaseRouter las
    // deriva desde acá leyendo CourseProgress.isCompleted
    skillTree:    MODERN_SOC_OPERATIONS_VALIDATED_SKILLS,
  },
};

const VALID_COURSE_IDS = Object.keys(COURSES);

// stepIndex de quiz → número de módulo (1-based). null si no es un quiz.
function getQuizModuleNumber(course, stepIndex) {
  const idx = course.quizSteps.indexOf(stepIndex);
  return idx === -1 ? null : idx + 1;
}

// { grupo: [skills] } → [skills] sin duplicados. Devuelve [] si el árbol
// falta, para que un curso mal configurado no tire abajo la base de candidatos.
function flattenSkillTree(tree) {
  if (!tree || typeof tree !== "object") return [];
  return [...new Set(Object.values(tree).flat())];
}

// completionClaimId → curso. Ej: "modernSoc" → COURSES.soc1
const COURSES_BY_CLAIM_ID = Object.fromEntries(
  Object.values(COURSES).map(course => [course.completionClaimId, course])
);

// Lee la claim completedCourses de forma segura (array de strings o []).
function readCompletedCourses(claims) {
  const list = claims?.completedCourses;
  return Array.isArray(list) ? list.filter(id => typeof id === "string") : [];
}

// Claims del usuario → skills que le otorgan los cursos completados.
// Ids desconocidos (curso borrado o mal escrito) se ignoran sin romper.
function getCourseSkillsFromClaims(claims) {
  const skills = new Set();
  for (const claimId of readCompletedCourses(claims)) {
    const course = COURSES_BY_CLAIM_ID[claimId];
    if (!course) continue;
    for (const skill of flattenSkillTree(course.skillTree)) skills.add(skill);
  }
  return [...skills];
}

module.exports = {
  COURSES,
  VALID_COURSE_IDS,
  getQuizModuleNumber,
  flattenSkillTree,
  readCompletedCourses,
  getCourseSkillsFromClaims,
};