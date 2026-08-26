const { MODERN_SOC_OPERATIONS_VALIDATED_SKILLS } = require("../skills/modernSocSkills");

// routers las conozcan.
const COURSES = {
  soc1: {
    totalSteps:   13,
    passingScore: 0.70,
    quizSteps:    [3, 6, 9, 12],
    questionsPerQuiz: 20,
    skillTree: MODERN_SOC_OPERATIONS_VALIDATED_SKILLS,
  },
};

const VALID_COURSE_IDS = Object.keys(COURSES);

function flattenSkillTree(tree) {
  return Object.values(tree).flat();
}

module.exports = { COURSES, VALID_COURSE_IDS, flattenSkillTree };