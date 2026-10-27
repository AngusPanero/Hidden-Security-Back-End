const fs = require("fs");
const path = require("path");
const { STEP_TYPES, STEP_TYPE_LIST, QUIZ_STEP_TYPES } = require("../constants/stepTypes");

// Valida partner.config.js y course.config.js al arrancar.
// Si algo está mal, el curso NO se carga y el log dice exactamente qué corregir.

const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/; // minúsculas, números y guiones: cp-fdcs-m01-s01
const SLUG_RE = /^[A-Za-z0-9-]+$/;
const COURSE_STATUSES = ["ACTIVE", "DRAFT", "INACTIVE"];

const same = (a, b) => String(a || "").toLowerCase() === String(b || "").toLowerCase();

function fail(where, errors) {
    if (errors.length) {
        throw new Error(`${where} inválido:\n    - ${errors.join("\n    - ")}`);
    }
}

// ─── partner.config.js ───────────────────────────────────────────────
function validatePartnerConfig(pc, folderName) {
    const where = `${folderName}/partner.config.js`;
    if (!pc || typeof pc !== "object") fail(where, ["no exporta un objeto"]);

    const e = [];
    if (!ID_RE.test(pc.slug || "")) e.push(`slug "${pc.slug}" inválido (minúsculas, números y guiones)`);
    if (!same(pc.slug, folderName)) e.push(`slug "${pc.slug}" no coincide con la carpeta "${folderName}"`);
    if (!/^PT-\d{4}$/.test(pc.code || "")) e.push(`code "${pc.code}" inválido (formato PT-0001)`);
    if (!pc.name) e.push("falta name");
    fail(where, e);
}

// ─── quiz.questions.js (un quiz) ─────────────────────────────────────
function validateQuiz(quizId, quiz, where, e) {
    if (!quiz) return e.push(`${where}: quizId "${quizId}" no existe en quiz.questions.js`);
    if (!Array.isArray(quiz.questions) || !quiz.questions.length) {
        return e.push(`quiz "${quizId}": no tiene preguntas`);
    }

    const qIds = new Set();
    quiz.questions.forEach((q, qi) => {
        const qw = `quiz "${quizId}" pregunta #${qi + 1}`;
        if (!q.id) e.push(`${qw}: falta id`);
        else if (qIds.has(q.id)) e.push(`${qw}: id "${q.id}" repetido`);
        else qIds.add(q.id);

        if (!q.text) e.push(`${qw}: falta text`);

        if (!Array.isArray(q.options) || q.options.length < 2) {
            e.push(`${qw}: necesita al menos 2 opciones`);
            return;
        }
        const oIds = q.options.map((o) => o && o.id);
        if (oIds.some((x) => !x) || new Set(oIds).size !== oIds.length) {
            e.push(`${qw}: hay opciones sin id o con id repetido`);
        }
        if (!oIds.includes(q.correct)) {
            e.push(`${qw}: correct "${q.correct}" no coincide con ninguna opción`);
        }
    });
}

// ─── course.config.js ────────────────────────────────────────────────
function validateCourseConfig({ config, quizzes, partnerFolder, courseFolder, contentDir }) {
    const where = `${partnerFolder}/${courseFolder}/course.config.js`;
    if (!config || typeof config !== "object") fail(where, ["no exporta un objeto"]);

    const e = [];

    if (!same(config.partnerSlug, partnerFolder)) {
        e.push(`partnerSlug "${config.partnerSlug}" no coincide con la carpeta "${partnerFolder}"`);
    }
    if (!SLUG_RE.test(config.courseSlug || "")) e.push(`courseSlug "${config.courseSlug}" inválido`);
    if (!same(config.courseSlug, courseFolder)) {
        e.push(`courseSlug "${config.courseSlug}" no coincide con la carpeta "${courseFolder}"`);
    }
    if (!ID_RE.test(config.courseId || "")) e.push(`courseId "${config.courseId}" inválido (ej: cp-fdcs)`);
    if (!Number.isInteger(config.version) || config.version < 1) e.push("version tiene que ser un entero >= 1");
    if (!config.title) e.push("falta title");
    if (!COURSE_STATUSES.includes(config.status)) {
        e.push(`status "${config.status}" inválido (${COURSE_STATUSES.join(" | ")})`);
    }
    if (config.access && config.access.plans !== undefined) {
        const p = config.access.plans;
        if (p !== "ANY" && !(Array.isArray(p) && p.length)) {
            e.push('access.plans tiene que ser "ANY" o un array de planes');
        }
    }

    if (!Array.isArray(config.modules) || !config.modules.length) {
        e.push("modules está vacío");
        fail(where, e);
    }

    const contentRoot = path.resolve(contentDir);
    const moduleIds = new Set();
    const stepIds = new Set();
    const usedQuizIds = new Set();
    let eligibleCount = 0;

    config.modules.forEach((m, mi) => {
        const mw = `módulo #${mi + 1}`;

        if (!ID_RE.test(m.moduleId || "")) e.push(`${mw}: moduleId "${m.moduleId}" inválido (ej: m01)`);
        else if (moduleIds.has(m.moduleId)) e.push(`${mw}: moduleId "${m.moduleId}" repetido`);
        else moduleIds.add(m.moduleId);

        if (!m.title) e.push(`${mw}: falta title`);

        if (!Array.isArray(m.steps) || !m.steps.length) {
            e.push(`${mw}: no tiene steps`);
            return;
        }

        m.steps.forEach((s, si) => {
            const sw = `${m.moduleId || mw} step #${si + 1} (${s.stepId || "sin stepId"})`;

            if (!ID_RE.test(s.stepId || "")) {
                e.push(`${sw}: stepId inválido`);
            } else {
                if (!s.stepId.startsWith(`${config.courseId}-`)) {
                    e.push(`${sw}: el stepId tiene que empezar con "${config.courseId}-"`);
                }
                if (stepIds.has(s.stepId)) e.push(`${sw}: stepId repetido`);
                stepIds.add(s.stepId);
            }

            if (!STEP_TYPE_LIST.includes(s.type)) {
                e.push(`${sw}: type "${s.type}" inválido (${STEP_TYPE_LIST.join(" | ")})`);
                return;
            }
            if (!s.title) e.push(`${sw}: falta title`);
            if (s.progressEligible !== false) eligibleCount++;

            if (s.type === STEP_TYPES.CONTENT) {
                if (!s.file || typeof s.file !== "string") {
                    e.push(`${sw}: falta file`);
                } else if (!s.file.toLowerCase().endsWith(".pdf")) {
                    e.push(`${sw}: file tiene que ser .pdf`);
                } else {
                    const abs = path.resolve(contentRoot, s.file);
                    if (!abs.startsWith(contentRoot + path.sep)) e.push(`${sw}: file apunta fuera de content/`);
                    else if (!fs.existsSync(abs)) e.push(`${sw}: no existe content/${s.file}`);
                }
            }

            if (s.type === STEP_TYPES.VIDEO && !/^https:\/\//.test(s.url || "")) {
                e.push(`${sw}: url de video inválida (tiene que empezar con https://)`);
            }

            if (QUIZ_STEP_TYPES.includes(s.type)) {
                if (!s.quizId) {
                    e.push(`${sw}: falta quizId`);
                } else if (usedQuizIds.has(s.quizId)) {
                    e.push(`${sw}: quizId "${s.quizId}" ya está usado en otro step`);
                } else {
                    usedQuizIds.add(s.quizId);
                    validateQuiz(s.quizId, quizzes && quizzes[s.quizId], sw, e);
                }
                if (typeof s.passScore !== "number" || s.passScore <= 0 || s.passScore > 1) {
                    e.push(`${sw}: passScore tiene que ser un número entre 0 y 1 (ej: 0.7)`);
                }
                if (s.maxAttempts != null && (!Number.isInteger(s.maxAttempts) || s.maxAttempts < 1)) {
                    e.push(`${sw}: maxAttempts tiene que ser un entero >= 1 o null`);
                }
            }
        });
    });

    if (!eligibleCount) e.push("no hay ningún step con progressEligible");

    fail(where, e);

    // Avisos (no bloquean)
    Object.keys(quizzes || {}).forEach((id) => {
        if (!usedQuizIds.has(id)) {
            console.warn(`[externalCourses] aviso: ${partnerFolder}/${courseFolder} quiz "${id}" no se usa en ningún step`);
        }
    });
}

module.exports = { validatePartnerConfig, validateCourseConfig };