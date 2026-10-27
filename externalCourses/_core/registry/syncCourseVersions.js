const crypto = require("crypto");
const CourseVersion = require("../schemas/CourseVersionSchema");
const { isDuplicateKey } = require("../utils/db");

// Congela cada versión ACTIVE de un curso en la colección courseVersions.
//
// Reglas:
// - Si la versión no existe → se crea la foto.
// - Si existe y la estructura es igual → OK.
// - Si existe y la estructura cambió → ERROR: hay que subir "version".
// - Un stepId nunca puede reutilizarse con otro tipo.
//
// Los títulos no cuentan como estructura (se pueden corregir sin subir versión).

function structuralHash(course) {
    const structure = course.steps.map((s) => [
        s.stepId,
        s.moduleId,
        s.type,
        s.required,
        s.progressEligible,
        s.quizId,
    ]);
    return crypto.createHash("sha256").update(JSON.stringify(structure)).digest("hex");
}

async function syncCourseVersion(course) {
    const hash = structuralHash(course);

    const existing = await CourseVersion.findOne({
        courseId: course.courseId,
        version: course.version,
    }).lean();

    if (existing) {
        if (existing.hash !== hash) {
            throw new Error(
                `la estructura de ${course.courseId} v${course.version} cambió y esa versión ya está publicada. ` +
                    `Subí "version" a ${course.version + 1} en course.config.js`
            );
        }
        return existing;
    }

    const previous = await CourseVersion.find({ courseId: course.courseId })
        .sort({ version: -1 })
        .lean();

    if (previous.length && previous[0].version > course.version) {
        throw new Error(
            `version ${course.version} es menor a la última publicada (v${previous[0].version})`
        );
    }

    const knownTypes = new Map();
    for (const v of previous) {
        for (const s of v.steps) if (!knownTypes.has(s.stepId)) knownTypes.set(s.stepId, s.type);
    }
    const conflicts = course.steps.filter(
        (s) => knownTypes.has(s.stepId) && knownTypes.get(s.stepId) !== s.type
    );
    if (conflicts.length) {
        throw new Error(
            `stepIds reutilizados con otro tipo: ${conflicts.map((s) => s.stepId).join(", ")}. ` +
                "Un stepId no se reutiliza nunca: usá uno nuevo"
        );
    }

    try {
        const created = await CourseVersion.create({
            courseId: course.courseId,
            version: course.version,
            partnerId: course.partnerId,
            partnerSlug: course.partnerSlug,
            courseSlug: course.courseSlug,
            title: course.title,
            hash,
            estimatedDurationMinutes: course.estimatedDurationMinutes,
            moduleCount: course.modules.length,
            totalSteps: course.totalSteps,
            totalEligibleSteps: course.totalEligibleSteps,
            partnerPool: course.partnerPool,
            steps: course.steps.map((s) => ({
                stepId: s.stepId,
                stepIndex: s.stepIndex,
                moduleId: s.moduleId,
                type: s.type,
                title: s.title,
                required: s.required,
                progressEligible: s.progressEligible,
                quizId: s.quizId,
            })),
        });
        console.log(`[externalCourses] versión publicada: ${course.courseId} v${course.version}`);
        return created.toObject();
    } catch (err) {
        // Otra instancia del server la creó al mismo tiempo → revalidar
        if (isDuplicateKey(err)) return syncCourseVersion(course);
        throw err;
    }
}

module.exports = { syncCourseVersion, structuralHash };