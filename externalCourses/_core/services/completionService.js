const Progress = require("../schemas/ExternalCourseProgressSchema");
const { recordEvent } = require("./eventService");
const { EVENT_TYPES } = require("../constants/eventTypes");
const { MIN_PASS_SCORE } = require("../constants/stepTypes");

// ⚠️ Ajustá estas dos rutas si tus archivos están en otro lugar
const { CV } = require("../../../models/cvModel");
const { issueExternalCourseCertificate } = require("../../../routes/publicCertificateRouter");

const esProduccion = process.env.NODE_ENV === "production";

// ─────────────────────────────────────────────────────────────────────
// 1) checkCompletion: decide si el curso quedó COMPLETO.
//    Lo llama SOLO el backend después de cada step completado.
//    Regla: todos los steps "required" completados. Un QUIZ / FINAL_EXAM
//    solo se completa aprobándolo (80% o más), así que quedan exigidos.
//
// 2) computeApproval: decide si el curso está APROBADO para el CV.
//    - Con examen final: la mejor nota del final tiene que ser 80% o más.
//    - Sin examen final: todas las evaluaciones aprobadas con 80% o más
//      (la nota del curso es el promedio de las mejores notas).
//
// 3) syncCourseRecord: guarda el resultado en el CV del alumno y emite el
//    certificado público. Solo puede mejorar: nunca baja la nota ni saca
//    una aprobación. Lo escribe únicamente el servidor.
// ─────────────────────────────────────────────────────────────────────

async function checkCompletion(ctx, progress, session) {
    if (progress.isCompleted) return progress;

    const done = new Set(progress.completedStepIds);
    const pending = ctx.course.steps.filter((s) => s.required && !done.has(s.stepId));
    if (pending.length) return progress;

    const now = new Date();
    const updated = await Progress.findOneAndUpdate(
        { _id: progress._id, isCompleted: false },
        { $set: { isCompleted: true, completedAt: now } },
        { session, returnDocument: "after" }
    ).lean();

    if (!updated) return progress; // otra request lo marcó primero

    await recordEvent({
        eventType: EVENT_TYPES.COURSE_COMPLETED,
        userId: ctx.user.uid,
        course: ctx.course,
        access: ctx.access,
        session,
        occurredAt: now,
        metadata: {
            completedSteps: done.size,
            totalSteps: ctx.course.totalSteps,
        },
    });

    return updated;
}

function computeApproval(course, progress) {
    const basis = course.finalExamStepId ? "FINAL_EXAM" : "ALL_QUIZZES";
    const empty = { completed: false, approved: false, score: null, basis, minScore: MIN_PASS_SCORE };
    if (!progress || !progress.isCompleted) return empty;

    const results = progress.quizResults || {};
    const best = (id) => {
        const r = results[id];
        return r && typeof r.bestScore === "number" ? r.bestScore : 0;
    };
    const ok = (id) => !!(results[id] && results[id].passed) && best(id) >= MIN_PASS_SCORE;

    let approved;
    let score;
    if (course.finalExamStepId) {
        approved = ok(course.finalExamStepId);
        score = best(course.finalExamStepId);
    } else if (course.quizStepIds.length) {
        approved = course.quizStepIds.every(ok);
        score = course.quizStepIds.reduce((acc, id) => acc + best(id), 0) / course.quizStepIds.length;
    } else {
        approved = true; // curso sin evaluaciones: completarlo es aprobarlo
        score = null;
    }

    return { completed: true, approved, score, basis, minScore: MIN_PASS_SCORE };
}

// externalCourses.<partnerSlug>.courses.<courseSlug> — los slugs ya están validados
// por el registry (letras, números y guiones), así que son claves seguras para Mongo.
async function writeCvRecord(userId, course, progress, approval) {
    const partnerPath = `externalCourses.${course.partnerSlug}`;
    const coursePath = `${partnerPath}.courses.${course.courseSlug}`;
    const now = new Date();

    const update = {
        $set: {
            [`${partnerPath}.partnerName`]: course.partnerName,
            [`${coursePath}.courseId`]: course.courseId,
            [`${coursePath}.title`]: course.title,
            [`${coursePath}.courseVersion`]: course.version,
            [`${coursePath}.basis`]: approval.basis,
            [`${coursePath}.updatedAt`]: now,
        },
        // $max: la aprobación (false < true) y la nota solo suben, nunca bajan
        $max: { [`${coursePath}.approved`]: approval.approved },
        $min: { [`${coursePath}.completedAt`]: progress.completedAt || now },
    };
    if (typeof approval.score === "number") update.$max[`${coursePath}.score`] = approval.score;
    if (approval.approved) {
        update.$set[`${coursePath}.skills`] = course.skills || {};
        update.$min[`${coursePath}.approvedAt`] = now;
    }

    try {
        await CV.updateOne({ userId }, update, { upsert: true });
    } catch (err) {
        // Dos upserts a la vez para un CV que no existía: el segundo ya encuentra el doc
        if (err?.code !== 11000) throw err;
        await CV.updateOne({ userId }, update);
    }
}

async function syncCourseRecord(ctx, progress) {
    const { course, user } = ctx;
    const approval = computeApproval(course, progress);
    if (!approval.completed) return { ...approval, certificate: null };

    try {
        await writeCvRecord(user.uid, course, progress, approval);
    } catch (err) {
        console.error("[externalCourses] no se pudo guardar la aprobación en el CV:", esProduccion ? err.message : err);
    }

    let certificate = null;
    if (approval.approved) {
        certificate = await issueExternalCourseCertificate({
            userId: user.uid,
            course,
            score: approval.score,
            issuedAt: progress.completedAt || new Date(),
        });
    }

    return { ...approval, certificate };
}

module.exports = { checkCompletion, computeApproval, syncCourseRecord };