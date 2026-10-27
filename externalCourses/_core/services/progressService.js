const Progress = require("../schemas/ExternalCourseProgressSchema");
const { recordEvent } = require("./eventService");
const { checkCompletion } = require("./completionService");
const { EVENT_TYPES } = require("../constants/eventTypes");
const { DIRECT_COMPLETE_TYPES } = require("../constants/stepTypes");
const { ACCESS_TYPES } = require("../constants/accessTypes");
const { httpError } = require("../utils/httpError");
const { runInTransaction, isDuplicateKey } = require("../utils/db");

// ctx = { user, course, access }  (lo arma el router desde req)

// ─── Helpers ─────────────────────────────────────────────────────────
function computeDerived(course, doneSet) {
    let completedStepsCount = 0;
    let completedEligibleCount = 0;
    let next = null;

    for (const s of course.steps) {
        if (doneSet.has(s.stepId)) {
            completedStepsCount++;
            if (s.progressEligible) completedEligibleCount++;
        } else if (!next) {
            next = s;
        }
    }

    const progressPercentage = course.totalEligibleSteps
        ? Math.round((completedEligibleCount / course.totalEligibleSteps) * 10000) / 100
        : 0;

    return {
        completedStepsCount,
        completedEligibleCount,
        totalEligibleSteps: course.totalEligibleSteps,
        progressPercentage,
        currentStepId: next ? next.stepId : null,
        currentStepIndex: next ? next.stepIndex : course.steps.length,
    };
}

// Primer step required pendiente ANTES de este (si el curso es secuencial)
function getBlockingStep(course, doneSet, step) {
    if (!course.sequential) return null;
    return (
        course.steps.find(
            (s) => s.stepIndex < step.stepIndex && s.required && !doneSet.has(s.stepId)
        ) || null
    );
}

function assertUnlocked(course, doneSet, step) {
    const blocking = getBlockingStep(course, doneSet, step);
    if (blocking) {
        throw httpError(409, "Tenés que completar los pasos anteriores", {
            blockingStepId: blocking.stepId,
        });
    }
}

function isAdmin(ctx) {
    return ctx.access && ctx.access.accessType === ACCESS_TYPES.ADMIN;
}

function findProgress(userId, courseId, session = null) {
    const q = Progress.findOne({ userId, courseId });
    if (session) q.session(session);
    return q.lean();
}

// Lo que recibe el front
function serialize(p, course) {
    if (!p) {
        return {
            started: false,
            courseId: course.courseId,
            courseVersion: course.version,
            startedAt: null,
            completedStepIds: [],
            ...computeDerived(course, new Set()),
            totalSteps: course.totalSteps,
            quizResults: {},
            isCompleted: false,
            completedAt: null,
        };
    }

    // Se recalcula con la estructura actual (por si un DRAFT cambió steps)
    const valid = p.completedStepIds.filter((id) => course.stepsById.has(id));
    return {
        started: true,
        courseId: p.courseId,
        courseVersion: p.courseVersion,
        startedAt: p.startedAt,
        completedStepIds: valid,
        ...computeDerived(course, new Set(valid)),
        totalSteps: course.totalSteps,
        quizResults: p.quizResults || {},
        isCompleted: p.isCompleted,
        completedAt: p.completedAt,
    };
}

// ─── Migración de versión ────────────────────────────────────────────
// Como los stepId son estables, al pasar de V1 a V2 se conservan
// los steps que siguen existiendo. El historial queda en los eventos.
async function migrateVersion(ctx, progress) {
    const { course, user, access } = ctx;
    const valid = progress.completedStepIds.filter((id) => course.stepsById.has(id));
    const fromVersion = progress.courseVersion;

    const updated = await Progress.findOneAndUpdate(
        { _id: progress._id, courseVersion: fromVersion },
        {
            $set: {
                courseVersion: course.version,
                completedStepIds: valid,
                ...computeDerived(course, new Set(valid)),
            },
        },
        { returnDocument: "after" }
    ).lean();

    if (updated) {
        try {
            await recordEvent({
                eventType: EVENT_TYPES.COURSE_VERSION_MIGRATED,
                userId: user.uid,
                course,
                access,
                metadata: {
                    fromVersion,
                    toVersion: course.version,
                    keptSteps: valid.length,
                    droppedSteps: progress.completedStepIds.length - valid.length,
                },
            });
        } catch (err) {
            if (!isDuplicateKey(err)) throw err;
        }
        return updated;
    }
    return findProgress(user.uid, course.courseId);
}

// ─── API ─────────────────────────────────────────────────────────────
async function get(ctx) {
    let p = await findProgress(ctx.user.uid, ctx.course.courseId);
    if (p && p.courseVersion !== ctx.course.version) p = await migrateVersion(ctx, p);
    return serialize(p, ctx.course);
}

async function start(ctx) {
    const { user, course, access } = ctx;
    const existing = await findProgress(user.uid, course.courseId);
    if (existing) return get(ctx);

    try {
        await runInTransaction(async (session) => {
            const now = new Date();
            await Progress.create(
                [
                    {
                        userId: user.uid,
                        courseId: course.courseId,
                        partnerId: course.partnerId,
                        courseVersion: course.version,
                        startedAt: now,
                        completedStepIds: [],
                        ...computeDerived(course, new Set()),
                    },
                ],
                { session }
            );
            await recordEvent({
                eventType: EVENT_TYPES.COURSE_STARTED,
                userId: user.uid,
                course,
                access,
                session,
                occurredAt: now,
            });
        });
    } catch (err) {
        if (!isDuplicateKey(err)) throw err; // doble click en "empezar"
    }
    return get(ctx);
}

// Devuelve el doc de progreso (lean), creándolo o migrándolo si hace falta
async function ensureProgress(ctx) {
    let p = await findProgress(ctx.user.uid, ctx.course.courseId);
    if (!p) {
        await start(ctx);
        p = await findProgress(ctx.user.uid, ctx.course.courseId);
    } else if (p.courseVersion !== ctx.course.version) {
        p = await migrateVersion(ctx, p);
    }
    return p;
}

// Núcleo: marca un step como completado DENTRO de una transacción.
// Lo usan completeStep (PDF/video) y quizService (al aprobar).
async function applyStepCompletion(ctx, step, session) {
    const { user, course, access } = ctx;

    const before = await Progress.findOne({
        userId: user.uid,
        courseId: course.courseId,
        completedStepIds: { $ne: step.stepId },
    })
        .session(session)
        .lean();

    if (!before) return null; // ya estaba completado

    const doneSet = new Set(before.completedStepIds);
    doneSet.add(step.stepId);

    await recordEvent({
        eventType: EVENT_TYPES.STEP_COMPLETED,
        userId: user.uid,
        course,
        step,
        access,
        session,
    });

    const updated = await Progress.findOneAndUpdate(
        { _id: before._id, completedStepIds: { $ne: step.stepId } },
        {
            $addToSet: { completedStepIds: step.stepId },
            $set: computeDerived(course, doneSet),
        },
        { session, returnDocument: "after" }
    ).lean();

    if (!updated) {
        // Carrera con otra request: se revierte el evento
        const err = new Error("step completado en paralelo");
        err.code = 11000;
        throw err;
    }

    return checkCompletion(ctx, updated, session);
}

async function completeStep(ctx, stepId) {
    const { course } = ctx;
    const step = course.stepsById.get(stepId);
    if (!step) throw httpError(404, "Paso no encontrado");
    if (!DIRECT_COMPLETE_TYPES.includes(step.type)) {
        throw httpError(400, "Este paso se completa aprobando su evaluación");
    }

    const progress = await ensureProgress(ctx);
    const doneSet = new Set(progress.completedStepIds);
    if (doneSet.has(stepId)) return serialize(progress, course); // idempotente

    assertUnlocked(course, doneSet, step);

    try {
        await runInTransaction((session) => applyStepCompletion(ctx, step, session));
    } catch (err) {
        if (!isDuplicateKey(err)) throw err;
    }
    return get(ctx);
}

module.exports = {
    get,
    start,
    completeStep,
    // usados por otros services
    ensureProgress,
    applyStepCompletion,
    assertUnlocked,
    getBlockingStep,
    serialize,
    isAdmin,
    findProgress,
};