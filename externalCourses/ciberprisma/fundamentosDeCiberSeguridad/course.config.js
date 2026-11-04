// Curso de Ciberprisma — Fundamentos de Ciberseguridad (cp-fdcs)
//
// SIMULACIÓN: usa los PDFs y las preguntas de los módulos 1 a 3 de ModernSoc.
// Cada módulo = socIntro + soc1…socN + socFinal + quiz (mismo orden que ModernSoc).
// Todas las evaluaciones piden 80% (es el mínimo de la plataforma) y se pueden
// reintentar sin límite. Las skills que valida el curso están en skills/.
// Regla de oro: un stepId nunca se reutiliza ni se renombra. Si cambia la
// estructura, se sube "version".

module.exports = {
    partnerSlug: "ciberprisma",
    courseSlug: "fundamentosDeCiberSeguridad",
    courseId: "cp-fdcs",
    version: 2,
    title: "Fundamentos de Ciberseguridad",
    description: "Curso de prueba armado con el contenido de los módulos 1 a 3 de Modern SOC Operations.",
    status: "ACTIVE",
    estimatedDurationMinutes: 600,
    partnerPool: { enabled: true, courseWeight: 1 },
    approval: {
        requireAllRequiredSteps: true,
        requireAllQuizzesPassed: true,
        finalExam: null,
    },
    modules: [
        {
            moduleId: "m01",
            title: "Fundamentos del SOC",
            steps: [
                { stepId: "cp-fdcs-m01-s01", type: "CONTENT", title: "Introducción", file: "module-01/socIntro.pdf", required: true, progressEligible: true },
                { stepId: "cp-fdcs-m01-s02", type: "CONTENT", title: "Contenido 1", file: "module-01/soc1.pdf", required: true, progressEligible: true },
                { stepId: "cp-fdcs-m01-s03", type: "CONTENT", title: "Contenido 2", file: "module-01/soc2.pdf", required: true, progressEligible: true },
                { stepId: "cp-fdcs-m01-s04", type: "CONTENT", title: "Contenido 3", file: "module-01/soc3.pdf", required: true, progressEligible: true },
                { stepId: "cp-fdcs-m01-s05", type: "CONTENT", title: "Contenido 4", file: "module-01/soc4.pdf", required: true, progressEligible: true },
                { stepId: "cp-fdcs-m01-s06", type: "CONTENT", title: "Contenido 5", file: "module-01/soc5.pdf", required: true, progressEligible: true },
                { stepId: "cp-fdcs-m01-s07", type: "CONTENT", title: "Contenido 6", file: "module-01/soc6.pdf", required: true, progressEligible: true },
                { stepId: "cp-fdcs-m01-s08", type: "CONTENT", title: "Cierre del módulo", file: "module-01/socFinal.pdf", required: true, progressEligible: true },
                { stepId: "cp-fdcs-m01-q01", type: "QUIZ", title: "Evaluación módulo 1", quizId: "m01-quiz", passScore: 0.8, required: true, progressEligible: true },
            ],
        },
        {
            moduleId: "m02",
            title: "Amenazas, riesgo e impacto",
            steps: [
                { stepId: "cp-fdcs-m02-s01", type: "CONTENT", title: "Introducción", file: "module-02/socIntro.pdf", required: true, progressEligible: true },
                { stepId: "cp-fdcs-m02-s02", type: "CONTENT", title: "Contenido 1", file: "module-02/soc1.pdf", required: true, progressEligible: true },
                { stepId: "cp-fdcs-m02-s03", type: "CONTENT", title: "Contenido 2", file: "module-02/soc2.pdf", required: true, progressEligible: true },
                { stepId: "cp-fdcs-m02-s04", type: "CONTENT", title: "Contenido 3", file: "module-02/soc3.pdf", required: true, progressEligible: true },
                { stepId: "cp-fdcs-m02-s05", type: "CONTENT", title: "Contenido 4", file: "module-02/soc4.pdf", required: true, progressEligible: true },
                { stepId: "cp-fdcs-m02-s06", type: "CONTENT", title: "Contenido 5", file: "module-02/soc5.pdf", required: true, progressEligible: true },
                { stepId: "cp-fdcs-m02-s07", type: "CONTENT", title: "Contenido 6", file: "module-02/soc6.pdf", required: true, progressEligible: true },
                { stepId: "cp-fdcs-m02-s08", type: "CONTENT", title: "Contenido 7", file: "module-02/soc7.pdf", required: true, progressEligible: true },
                { stepId: "cp-fdcs-m02-s09", type: "CONTENT", title: "Contenido 8", file: "module-02/soc8.pdf", required: true, progressEligible: true },
                { stepId: "cp-fdcs-m02-s10", type: "CONTENT", title: "Cierre del módulo", file: "module-02/socFinal.pdf", required: true, progressEligible: true },
                { stepId: "cp-fdcs-m02-q01", type: "QUIZ", title: "Evaluación módulo 2", quizId: "m02-quiz", passScore: 0.8, required: true, progressEligible: true },
            ],
        },
        {
            moduleId: "m03",
            title: "Redes, protocolos y visibilidad",
            steps: [
                { stepId: "cp-fdcs-m03-s01", type: "CONTENT", title: "Introducción", file: "module-03/socIntro.pdf", required: true, progressEligible: true },
                { stepId: "cp-fdcs-m03-s02", type: "CONTENT", title: "Contenido 1", file: "module-03/soc1.pdf", required: true, progressEligible: true },
                { stepId: "cp-fdcs-m03-s03", type: "CONTENT", title: "Contenido 2", file: "module-03/soc2.pdf", required: true, progressEligible: true },
                { stepId: "cp-fdcs-m03-s04", type: "CONTENT", title: "Contenido 3", file: "module-03/soc3.pdf", required: true, progressEligible: true },
                { stepId: "cp-fdcs-m03-s05", type: "CONTENT", title: "Contenido 4", file: "module-03/soc4.pdf", required: true, progressEligible: true },
                { stepId: "cp-fdcs-m03-s06", type: "CONTENT", title: "Contenido 5", file: "module-03/soc5.pdf", required: true, progressEligible: true },
                { stepId: "cp-fdcs-m03-s07", type: "CONTENT", title: "Contenido 6", file: "module-03/soc6.pdf", required: true, progressEligible: true },
                { stepId: "cp-fdcs-m03-s08", type: "CONTENT", title: "Contenido 7", file: "module-03/soc7.pdf", required: true, progressEligible: true },
                { stepId: "cp-fdcs-m03-s09", type: "CONTENT", title: "Contenido 8", file: "module-03/soc8.pdf", required: true, progressEligible: true },
                { stepId: "cp-fdcs-m03-s10", type: "CONTENT", title: "Contenido 9", file: "module-03/soc9.pdf", required: true, progressEligible: true },
                { stepId: "cp-fdcs-m03-s11", type: "CONTENT", title: "Cierre del módulo", file: "module-03/socFinal.pdf", required: true, progressEligible: true },
                { stepId: "cp-fdcs-m03-q01", type: "QUIZ", title: "Evaluación módulo 3", quizId: "m03-quiz", passScore: 0.8, required: true, progressEligible: true },
            ],
        },
    ],
};