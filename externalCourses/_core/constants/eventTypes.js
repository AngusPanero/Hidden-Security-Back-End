// Eventos que se guardan en courseProgressEvents (historial inmutable).

const EVENT_TYPES = Object.freeze({
    COURSE_STARTED: "COURSE_STARTED",
    STEP_COMPLETED: "STEP_COMPLETED",               // evento económico del Partner Pool
    QUIZ_COMPLETED: "QUIZ_COMPLETED",               // cada intento (académico)
    QUIZ_PASSED: "QUIZ_PASSED",                     // primera aprobación (académico)
    COURSE_COMPLETED: "COURSE_COMPLETED",           // lo genera solo el backend
    COURSE_VERSION_MIGRATED: "COURSE_VERSION_MIGRATED", // el alumno pasó a una versión nueva del curso
});

const EVENT_TYPE_LIST = Object.values(EVENT_TYPES);

module.exports = { EVENT_TYPES, EVENT_TYPE_LIST };