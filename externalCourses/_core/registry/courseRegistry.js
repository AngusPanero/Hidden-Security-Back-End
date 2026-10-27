const fs = require("fs");
const path = require("path");
const Partner = require("../schemas/PartnerSchema");
const { validatePartnerConfig, validateCourseConfig } = require("./validateConfig");
const { syncCourseVersion } = require("./syncCourseVersions");
const { STEP_TYPES, QUIZ_STEP_TYPES } = require("../constants/stepTypes");

// ─────────────────────────────────────────────────────────────────────
// Registro de cursos externos.
//
// Al arrancar escanea:
//   externalCourses/<empresa>/partner.config.js
//   externalCourses/<empresa>/<curso>/course.config.js
//   externalCourses/<empresa>/<curso>/quiz.questions.js
//   externalCourses/<empresa>/<curso>/content/...
//
// Las carpetas que empiezan con "_" o "." se ignoran (ej: _core).
// Un curso con errores NO tumba el server: se saltea y se loguea el motivo.
// ─────────────────────────────────────────────────────────────────────

const ROOT = path.resolve(__dirname, "..", ".."); // .../externalCourses

const coursesByKey = new Map(); // "ciberprisma/fundamentosdeciberseguridad" → course
const coursesById = new Map();  // "cp-fdcs" → course

const keyOf = (partnerSlug, courseSlug) =>
    `${String(partnerSlug).toLowerCase()}/${String(courseSlug).toLowerCase()}`;

function listDirs(dir) {
    return fs
        .readdirSync(dir, { withFileTypes: true })
        .filter((d) => d.isDirectory() && !d.name.startsWith("_") && !d.name.startsWith("."))
        .map((d) => d.name);
}

function freshRequire(file) {
    delete require.cache[require.resolve(file)];
    return require(file);
}

// ─── Partner ─────────────────────────────────────────────────────────
async function syncPartner(pc) {
    return Partner.findOneAndUpdate(
        { slug: pc.slug.toLowerCase() },
        {
            $set: { name: pc.name, email: pc.email || "", logoUrl: pc.logoUrl || "" },
            $setOnInsert: {
                code: pc.code,
                status: "ACTIVE",
                partnerPool: { enabled: true, enabledAt: new Date(), disabledAt: null },
            },
        },
        { upsert: true, returnDocument: "after" }
    ).lean();
}

// ─── Curso en memoria ────────────────────────────────────────────────
function buildPublicStructure(course) {
    return {
        partner: {
            slug: course.partnerSlug,
            name: course.partnerName,
            logoUrl: course.partnerLogoUrl,
        },
        course: {
            courseId: course.courseId,
            slug: course.courseSlug,
            version: course.version,
            title: course.title,
            description: course.description,
            status: course.status,
            estimatedDurationMinutes: course.estimatedDurationMinutes,
            sequential: course.sequential,
            moduleCount: course.modules.length,
            totalSteps: course.totalSteps,
            totalEligibleSteps: course.totalEligibleSteps,
        },
        modules: course.modules.map((m) => ({
            moduleId: m.moduleId,
            title: m.title,
            description: m.description,
            steps: m.steps.map((s) => {
                const out = {
                    stepId: s.stepId,
                    stepIndex: s.stepIndex,
                    type: s.type,
                    title: s.title,
                    required: s.required,
                    progressEligible: s.progressEligible,
                    durationMinutes: s.durationMinutes,
                };
                if (s.type === STEP_TYPES.CONTENT) out.hasFile = true; // la ruta real nunca sale
                if (s.type === STEP_TYPES.VIDEO) out.url = s.url;
                if (QUIZ_STEP_TYPES.includes(s.type)) {
                    const quiz = course.quizzes[s.quizId];
                    out.quiz = {
                        quizId: s.quizId,
                        title: quiz.title || s.title,
                        passScore: s.passScore,
                        maxAttempts: s.maxAttempts,
                        questionCount: quiz.questions.length,
                        // Sin "correct": las respuestas nunca salen del backend
                        questions: quiz.questions.map((q) => ({
                            id: q.id,
                            text: q.text,
                            options: q.options.map((o) => ({ id: o.id, text: o.text })),
                        })),
                    };
                }
                return out;
            }),
        })),
    };
}

function buildRuntimeCourse({ config, quizzes, partner, contentDir }) {
    const steps = [];
    let index = 0;

    const modules = config.modules.map((m, moduleIndex) => {
        const moduleSteps = m.steps.map((s) => {
            const step = Object.freeze({
                stepId: s.stepId,
                stepIndex: index++,
                moduleId: m.moduleId,
                moduleIndex,
                type: s.type,
                title: s.title,
                required: s.required !== false,
                progressEligible: s.progressEligible !== false,
                file: s.file || null,
                url: s.url || null,
                quizId: s.quizId || null,
                passScore: s.passScore ?? null,
                maxAttempts: s.maxAttempts ?? null,
                durationMinutes: s.durationMinutes ?? null,
            });
            steps.push(step);
            return step;
        });
        return { moduleId: m.moduleId, title: m.title, description: m.description || "", steps: moduleSteps };
    });

    const course = {
        partnerId: partner._id,
        partnerSlug: partner.slug,
        partnerName: partner.name,
        partnerLogoUrl: partner.logoUrl || "",

        courseId: config.courseId,
        courseSlug: config.courseSlug,
        version: config.version,
        status: config.status,
        title: config.title,
        description: config.description || "",
        estimatedDurationMinutes: config.estimatedDurationMinutes ?? null,
        sequential: config.sequential !== false,

        partnerPool: {
            enabled: partner.partnerPool?.enabled !== false && config.partnerPool?.enabled !== false,
            courseWeight: config.partnerPool?.courseWeight ?? 1,
        },
        access: { plans: config.access?.plans ?? "ANY" },

        modules,
        steps,
        stepsById: new Map(steps.map((s) => [s.stepId, s])),
        quizzes,
        contentDir: path.resolve(contentDir),

        totalSteps: steps.length,
        totalEligibleSteps: steps.filter((s) => s.progressEligible).length,
    };

    course.publicStructure = buildPublicStructure(course);
    course.catalogEntry = {
        partnerSlug: course.partnerSlug,
        partnerName: course.partnerName,
        partnerLogoUrl: course.partnerLogoUrl,
        courseSlug: course.courseSlug,
        courseId: course.courseId,
        title: course.title,
        description: course.description,
        estimatedDurationMinutes: course.estimatedDurationMinutes,
        moduleCount: course.modules.length,
        totalSteps: course.totalSteps,
    };

    return Object.freeze(course);
}

async function loadCourse({ partner, partnerFolder, courseFolder, courseDir }) {
    const configPath = path.join(courseDir, "course.config.js");
    if (!fs.existsSync(configPath)) return null; // carpeta sin curso todavía

    const config = freshRequire(configPath);
    if (config && config.status === "INACTIVE") {
        throw new Error("status INACTIVE (no se carga)");
    }

    const quizzesPath = path.join(courseDir, "quiz.questions.js");
    const quizzes = fs.existsSync(quizzesPath) ? freshRequire(quizzesPath) : {};
    const contentDir = path.join(courseDir, "content");

    validateCourseConfig({ config, quizzes, partnerFolder, courseFolder, contentDir });

    const course = buildRuntimeCourse({ config, quizzes, partner, contentDir });

    // Solo los cursos publicados quedan congelados. DRAFT se puede seguir editando.
    if (course.status === "ACTIVE") await syncCourseVersion(course);

    return course;
}

// ─── Carga general (se llama una vez al arrancar) ────────────────────
async function loadCourses() {
    coursesByKey.clear();
    coursesById.clear();

    const loaded = [];
    const skipped = [];

    for (const partnerFolder of listDirs(ROOT)) {
        const partnerDir = path.join(ROOT, partnerFolder);
        const partnerConfigPath = path.join(partnerDir, "partner.config.js");

        if (!fs.existsSync(partnerConfigPath)) {
            skipped.push({ path: partnerFolder, reason: "falta partner.config.js" });
            continue;
        }

        let partner;
        try {
            const pc = freshRequire(partnerConfigPath);
            validatePartnerConfig(pc, partnerFolder);
            partner = await syncPartner(pc);
        } catch (err) {
            skipped.push({ path: partnerFolder, reason: err.message });
            continue;
        }

        if (partner.status !== "ACTIVE") {
            skipped.push({ path: partnerFolder, reason: `partner ${partner.status} en la DB` });
            continue;
        }

        for (const courseFolder of listDirs(partnerDir)) {
            const where = `${partnerFolder}/${courseFolder}`;
            try {
                const course = await loadCourse({
                    partner,
                    partnerFolder,
                    courseFolder,
                    courseDir: path.join(partnerDir, courseFolder),
                });
                if (!course) continue;

                if (coursesById.has(course.courseId)) {
                    throw new Error(`courseId "${course.courseId}" ya lo usa otro curso`);
                }

                coursesByKey.set(keyOf(course.partnerSlug, course.courseSlug), course);
                coursesById.set(course.courseId, course);
                loaded.push(`${where} (${course.courseId} v${course.version} ${course.status}, ${course.totalSteps} steps)`);
            } catch (err) {
                skipped.push({ path: where, reason: err.message });
            }
        }
    }

    console.log(`[externalCourses] cursos cargados: ${loaded.length}`);
    loaded.forEach((l) => console.log(`  ✓ ${l}`));
    skipped.forEach((s) => console.error(`  ✗ ${s.path}: ${s.reason}`));

    return { loaded, skipped };
}

// ─── Consultas ───────────────────────────────────────────────────────
function getCourse(partnerSlug, courseSlug) {
    return coursesByKey.get(keyOf(partnerSlug, courseSlug)) || null;
}

function getCourseById(courseId) {
    return coursesById.get(courseId) || null;
}

function getCatalog() {
    return [...coursesByKey.values()]
        .filter((c) => c.status === "ACTIVE")
        .map((c) => c.catalogEntry);
}

module.exports = { loadCourses, getCourse, getCourseById, getCatalog };