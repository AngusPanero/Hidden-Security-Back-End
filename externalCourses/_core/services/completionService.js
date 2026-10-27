const Progress = require("../schemas/ExternalCourseProgressSchema");
const { recordEvent } = require("./eventService");
const { EVENT_TYPES } = require("../constants/eventTypes");

// Decide si el curso quedó aprobado. Lo llama SOLO el backend
// después de cada step completado (nunca el front).
//
// Regla: todos los steps "required" completados.
// Un QUIZ / FINAL_EXAM required solo se completa aprobándolo,
// así que con esto ya quedan exigidos los quizzes y el examen final.

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

module.exports = { checkCompletion };