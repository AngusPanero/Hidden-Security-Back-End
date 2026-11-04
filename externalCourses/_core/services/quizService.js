const Progress = require("../schemas/ExternalCourseProgressSchema");
const { recordEvent } = require("./eventService");
const progressService = require("./progressService");
const { EVENT_TYPES } = require("../constants/eventTypes");
const { QUIZ_STEP_TYPES, MIN_PASS_SCORE } = require("../constants/stepTypes");
const { httpError } = require("../utils/httpError");
const { runInTransaction, isDuplicateKey } = require("../utils/db");

// Corrige quizzes 100% en backend.
// - answers llega como { [questionId]: optionId }
// - nunca se devuelven las respuestas correctas
// - se aprueba con 80% o más (mínimo de la plataforma)
// - reintentos ilimitados, también después de aprobar: se guarda siempre la MEJOR nota
//   y una evaluación aprobada nunca vuelve a quedar desaprobada
// - cada intento = QUIZ_COMPLETED (académico)
// - la primera aprobación = QUIZ_PASSED + STEP_COMPLETED (lo único que cuenta para el Pool).
//   Reintentar no genera puntos nuevos.

const MAX_ANSWERS = 500;

function grade(quiz, answers) {
    let correctCount = 0;
    for (const q of quiz.questions) {
        const given = answers[q.id];
        if (typeof given === "string" && given === String(q.correct)) correctCount++;
    }
    const total = quiz.questions.length;
    return { correctCount, total, score: total ? correctCount / total : 0 };
}

async function submit(ctx, quizId, answers) {
    const { course, user, access } = ctx;

    if (typeof quizId !== "string") throw httpError(404, "Evaluación no encontrada");
    const step = course.steps.find((s) => s.quizId === quizId && QUIZ_STEP_TYPES.includes(s.type));
    if (!step) throw httpError(404, "Evaluación no encontrada");

    // Solo un objeto plano { questionId: "optionId" }: nada de arrays, objetos anidados ni $operadores
    if (!answers || typeof answers !== "object" || Array.isArray(answers)) {
        throw httpError(400, "Formato de respuestas inválido");
    }
    const keys = Object.keys(answers);
    if (keys.length > MAX_ANSWERS || keys.some((k) => typeof answers[k] !== "string" || answers[k].length > 100)) {
        throw httpError(400, "Formato de respuestas inválido");
    }

    const progress = await progressService.ensureProgress(ctx);
    const doneSet = new Set(progress.completedStepIds);
    progressService.assertUnlocked(course, doneSet, step);

    const prev = (progress.quizResults || {})[step.stepId] || null;
    const alreadyPassed = !!(prev && prev.passed);

    const passScore = Math.max(step.passScore ?? MIN_PASS_SCORE, MIN_PASS_SCORE);
    const { correctCount, total, score } = grade(course.quizzes[quizId], answers);
    const passedThisAttempt = score >= passScore;
    const now = new Date();

    const prevBest = prev ? prev.bestScore || 0 : 0;
    const bestScore = Math.max(prevBest, score);
    const passed = alreadyPassed || passedThisAttempt;

    // Atómico: $inc para los intentos, $max para la mejor nota (dos envíos en paralelo
    // nunca pisan una nota mejor ni pierden un intento).
    const base = `quizResults.${step.stepId}`;
    const update = {
        $inc: { [`${base}.attempts`]: 1 },
        $max: { [`${base}.bestScore`]: score },
        $set: {
            [`${base}.score`]: score,
            [`${base}.lastAttemptAt`]: now,
        },
    };
    if (passed) update.$set[`${base}.passed`] = true;
    if (passedThisAttempt && !alreadyPassed) update.$set[`${base}.passedAt`] = now;
    if (!prev) {
        update.$set[`${base}.passed`] = passed;
        if (!passedThisAttempt) update.$set[`${base}.passedAt`] = null;
    }

    const attemptNumber = (prev ? prev.attempts : 0) + 1;

    try {
        await runInTransaction(async (session) => {
            await Progress.updateOne({ _id: progress._id }, update, { session });

            await recordEvent({
                eventType: EVENT_TYPES.QUIZ_COMPLETED,
                userId: user.uid,
                course,
                step,
                access,
                session,
                occurredAt: now,
                metadata: { quizId, score, correctCount, total, attempt: attemptNumber, passed: passedThisAttempt },
            });

            if (passedThisAttempt && !alreadyPassed) {
                await recordEvent({
                    eventType: EVENT_TYPES.QUIZ_PASSED,
                    userId: user.uid,
                    course,
                    step,
                    access,
                    session,
                    occurredAt: now,
                    metadata: { quizId, score, attempt: attemptNumber },
                });
                await progressService.applyStepCompletion(ctx, step, session);
            }
        });
    } catch (err) {
        if (!isDuplicateKey(err)) throw err; // doble envío del mismo aprobado
    }

    // progressService.get guarda la aprobación en el CV y emite el certificado
    // (fuera de la transacción: si falla, el intento ya quedó guardado y se
    // vuelve a intentar en la próxima carga del curso)
    const progressOut = await progressService.get(ctx);

    return {
        passed: passedThisAttempt,
        alreadyPassed,
        score,
        bestScore,
        correctCount,
        total,
        passScore,
        attempts: attemptNumber,
        attemptsLeft: null,
        courseApproval: progressOut.approval,
        progress: progressOut,
    };
}

module.exports = { submit };