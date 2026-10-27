// Tipos de step que puede tener un curso externo.
// CONTENT y VIDEO se completan directo; QUIZ y FINAL_EXAM solo aprobando.

const STEP_TYPES = Object.freeze({
    CONTENT: "CONTENT",       // PDF
    VIDEO: "VIDEO",           // URL de video
    QUIZ: "QUIZ",             // evaluación de módulo
    FINAL_EXAM: "FINAL_EXAM", // evaluación final
});

const STEP_TYPE_LIST = Object.values(STEP_TYPES);

// Steps que se completan con POST /steps/:stepId/complete
const DIRECT_COMPLETE_TYPES = [STEP_TYPES.CONTENT, STEP_TYPES.VIDEO];

// Steps que se completan solo aprobando en POST /quiz/:quizId/submit
const QUIZ_STEP_TYPES = [STEP_TYPES.QUIZ, STEP_TYPES.FINAL_EXAM];

module.exports = { STEP_TYPES, STEP_TYPE_LIST, DIRECT_COMPLETE_TYPES, QUIZ_STEP_TYPES };