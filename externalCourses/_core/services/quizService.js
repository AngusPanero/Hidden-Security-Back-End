const Progress = require("../schemas/ExternalCourseProgressSchema");
const { recordEvent } = require("./eventService");
const progressService = require("./progressService");
const { EVENT_TYPES } = require("../constants/eventTypes");
const { QUIZ_STEP_TYPES } = require("../constants/stepTypes");
const { httpError } = require("../utils/httpError");
const { runInTransaction, isDuplicateKey } = require("../utils/db");

// Corrige quizzes 100% en backend.
// - answers llega como { [questionId]: optionId }
// - nunca se devuelven las respuestas correctas
// - cada intento = QUIZ_COMPLETED (académico)
// - la primera aprobación = QUIZ_PASSED + STEP_COMPLETED (el que cuenta para el Pool)
// - repetir un quiz aprobado no genera nada nuevo

function grade(quiz, answers) {
    let correctCount = 0;
    for (const q of quiz.questions) {
        if (String(answers[q.id] ?? "") === String(q.correct)) correctCount++;
    }
    const total = quiz.questions.length;
    return { correctCount, total, score: total ? correctCount / total : 0 };
}

async function submit(ctx, quizId, answers) {
    const { course, user, access } = ctx;

    const step = course.steps.find((s) => s.quizId === quizId && QUIZ_STEP_TYPES.includes(s.type));
    if (!step) throw httpError(404, "Evaluación no encontrada");

    if (!answers || typeof answers !== "object" || Array.isArray(answers)) {
        throw httpError(400, "Formato de respuestas inválido");
    }

    const progress = await progressService.ensureProgress(ctx);
    const doneSet = new Set(progress.completedStepIds);
    progressService.assertUnlocked(course, doneSet, step);

    const prev = (progress.quizResults || {})[step.stepId] || null;

    if (prev && prev.passed) {
        return {
            passed: true,
            alreadyPassed: true,
            score: prev.bestScore,
            attempts: prev.attempts,
            attemptsLeft: null,
            progress: progressService.serialize(progress, course),
        };
    }

    const prevAttempts = prev ? prev.attempts : 0;
    if (step.maxAttempts && prevAttempts >= step.maxAttempts) {
        throw httpError(409, "No te quedan intentos para esta evaluación");
    }

    const { correctCount, total, score } = grade(course.quizzes[quizId], answers);
    const passed = score >= step.passScore;
    const attempts = prevAttempts + 1;
    const now = new Date();

    const result = {
        score,
        bestScore: Math.max(prev ? prev.bestScore : 0, score),
        passed,
        attempts,
        lastAttemptAt: now,
        passedAt: passed ? now : null,
    };

    try {
        await runInTransaction(async (session) => {
            await Progress.updateOne(
                { _id: progress._id },
                { $set: { [`quizResults.${step.stepId}`]: result } },
                { session }
            );

            await recordEvent({
                eventType: EVENT_TYPES.QUIZ_COMPLETED,
                userId: user.uid,
                course,
                step,
                access,
                session,
                occurredAt: now,
                metadata: { quizId, score, correctCount, total, attempt: attempts, passed },
            });

            if (passed) {
                await recordEvent({
                    eventType: EVENT_TYPES.QUIZ_PASSED,
                    userId: user.uid,
                    course,
                    step,
                    access,
                    session,
                    occurredAt: now,
                    metadata: { quizId, score, attempt: attempts },
                });
                await progressService.applyStepCompletion(ctx, step, session);
            }
        });
    } catch (err) {
        if (!isDuplicateKey(err)) throw err; // doble envío del mismo aprobado
    }

    return {
        passed,
        alreadyPassed: false,
        score,
        correctCount,
        total,
        passScore: step.passScore,
        attempts,
        attemptsLeft: step.maxAttempts ? Math.max(step.maxAttempts - attempts, 0) : null,
        progress: await progressService.get(ctx),
    };
}

module.exports = { submit };