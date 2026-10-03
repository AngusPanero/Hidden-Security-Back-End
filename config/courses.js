const { MODERN_SOC_OPERATIONS_VALIDATED_SKILLS } = require("../skills/modernSocSkills");

const SOC1_MODULE_SIZES = [8, 9, 10, 8, 8, 8, 8, 8];

// El quiz de cada módulo es siempre su último step — se calcula acumulando
// los tamaños de SOC1_MODULE_SIZES en orden.
const soc1QuizSteps = [];
let soc1Cursor = 0;
for (const size of SOC1_MODULE_SIZES) {
  soc1Cursor += size;
  soc1QuizSteps.push(soc1Cursor - 1);
}
// → [7, 16, 26, 34, 42, 50, 58, 66]

const soc1TotalSteps = SOC1_MODULE_SIZES.reduce((sum, size) => sum + size, 0);
// → 67

const COURSES = {
  soc1: {
    totalSteps:       soc1TotalSteps, // 67
    quizSteps:        soc1QuizSteps,  // [7,16,26,34,42,50,58,66]
    questionsPerQuiz: 8,
    passingScore:     0.70,
    // Skills que otorga el curso al completarse — usersDatabaseRouter las
    // deriva desde acá leyendo CourseProgress.isCompleted
    skillTree:        MODERN_SOC_OPERATIONS_VALIDATED_SKILLS,
  },
};

const VALID_COURSE_IDS = Object.keys(COURSES);

// { grupo: [skills] } → [skills] sin duplicados. Devuelve [] si el árbol
// falta, para que un curso mal configurado no tire abajo la base de candidatos.
function flattenSkillTree(tree) {
  if (!tree || typeof tree !== "object") return [];
  return [...new Set(Object.values(tree).flat())];
}

module.exports = { COURSES, VALID_COURSE_IDS, flattenSkillTree };