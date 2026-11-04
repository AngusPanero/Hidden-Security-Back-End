const fs = require("fs");
const path = require("path");
const { STEP_TYPES, STEP_TYPE_LIST, QUIZ_STEP_TYPES, MIN_PASS_SCORE } = require("../constants/stepTypes");

// Valida partner.config.js y course.config.js al arrancar.
// Si algo está mal, el curso NO se carga y el log dice exactamente qué corregir.

const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/; // minúsculas, números y guiones: cp-fdcs-m01-s01
const SLUG_RE = /^[A-Za-z0-9-]+$/;
const COURSE_STATUSES = ["ACTIVE", "DRAFT", "INACTIVE"];

const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

function isSafeHttpsUrl(value) {
    if (typeof value !== "string" || value.length > 500 || /["'<>\s]/.test(value)) return false;
    try {
        return new URL(value).protocol === "https:";
    } catch {
        return false;
    }
}

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
    if (pc.email !== undefined && pc.email !== "" && !EMAIL_RE.test(String(pc.email))) {
        e.push(`email "${pc.email}" inválido (tiene que ser el email de la cuenta partner de Firebase)`);
    }
    if (pc.logoUrl !== undefined && pc.logoUrl !== "" && !isSafeHttpsUrl(pc.logoUrl)) {
        e.push("logoUrl tiene que ser una URL https:// válida (se muestra en los certificados)");
    }
    fail(where, e);
}

// ─── skills/<archivo>.js ─────────────────────────────────────────────
// Árbol de skills que valida el curso: { "Grupo": ["Skill", ...], ... }
const SKILLS_LIMITS = { groups: 30, perGroup: 80, total: 400, text: 120 };

function validateSkillsTree(tree, where) {
    const e = [];
    if (!tree || typeof tree !== "object" || Array.isArray(tree)) {
        fail(where, ["tiene que exportar un objeto { grupo: [skills] }"]);
    }
    const groups = Object.entries(tree);
    if (!groups.length) e.push("no tiene grupos");
    if (groups.length > SKILLS_LIMITS.groups) e.push(`tiene más de ${SKILLS_LIMITS.groups} grupos`);

    let total = 0;
    for (const [group, list] of groups) {
        if (!group.trim() || group.length > SKILLS_LIMITS.text || /[.$<>]/.test(group)) {
            e.push(`grupo "${group}" inválido (sin puntos, $, < ni >; hasta ${SKILLS_LIMITS.text} caracteres)`);
        }
        if (!Array.isArray(list) || !list.length) {
            e.push(`grupo "${group}": tiene que ser una lista con al menos una skill`);
            continue;
        }
        if (list.length > SKILLS_LIMITS.perGroup) e.push(`grupo "${group}": más de ${SKILLS_LIMITS.perGroup} skills`);
        list.forEach((skill, i) => {
            if (typeof skill !== "string" || !skill.trim() || skill.length > SKILLS_LIMITS.text || /[<>]/.test(skill)) {
                e.push(`grupo "${group}" skill #${i + 1} inválida`);
            }
        });
        if (new Set(list).size !== list.length) e.push(`grupo "${group}": tiene skills repetidas`);
        total += list.length;
    }
    if (total > SKILLS_LIMITS.total) e.push(`tiene más de ${SKILLS_LIMITS.total} skills en total`);
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
                // passScore es opcional: si falta se usa el mínimo (80%). Nunca puede ser menor.
                if (
                    s.passScore !== undefined &&
                    (typeof s.passScore !== "number" || s.passScore < MIN_PASS_SCORE || s.passScore > 1)
                ) {
                    e.push(`${sw}: passScore tiene que estar entre ${MIN_PASS_SCORE} y 1 (mínimo ${MIN_PASS_SCORE * 100}%)`);
                }
                // Los reintentos son siempre ilimitados
                if (s.maxAttempts != null) {
                    e.push(`${sw}: maxAttempts no está permitido (los reintentos son ilimitados), borralo`);
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

module.exports = { validatePartnerConfig, validateCourseConfig, validateSkillsTree, isSafeHttpsUrl };