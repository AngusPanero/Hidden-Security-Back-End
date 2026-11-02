const fs = require("fs");
const path = require("path");
const { pipeline } = require("stream/promises");
const progressService = require("./progressService");
const { STEP_TYPES } = require("../constants/stepTypes");
const { httpError } = require("../utils/httpError");

// Sirve los PDFs de content/ SOLO a usuarios con acceso y con el step desbloqueado.
// El front nunca conoce la ruta real del archivo, solo el stepId.
// Admin puede ver cualquier PDF sin respetar el orden (para revisar contenido).

async function streamPdf(ctx, stepId, res) {
    const { course, user } = ctx;

    const step = course.stepsById.get(stepId);
    if (!step || step.type !== STEP_TYPES.CONTENT || !step.file) {
        throw httpError(404, "Contenido no encontrado");
    }

    if (!progressService.isAdmin(ctx)) {
        const progress = await progressService.findProgress(user.uid, course.courseId);
        const doneSet = new Set(progress ? progress.completedStepIds : []);
        progressService.assertUnlocked(course, doneSet, step);
    }

    const filePath = path.resolve(course.contentDir, step.file);
    if (!filePath.startsWith(course.contentDir + path.sep)) {
        throw httpError(400, "Ruta inválida");
    }

    let stat;
    try {
        stat = await fs.promises.stat(filePath);
    } catch {
        throw httpError(404, "Archivo no encontrado");
    }

    res.set({
        "Content-Type": "application/pdf",
        "Content-Length": stat.size,
        "Content-Disposition": `inline; filename="${path.basename(filePath)}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
    });

    await pipeline(fs.createReadStream(filePath), res);
}

module.exports = { streamPdf };