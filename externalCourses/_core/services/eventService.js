const crypto = require("crypto");
const CourseProgressEvent = require("../schemas/CourseProgressEventSchema");
const { EVENT_TYPES } = require("../constants/eventTypes");

// Inserta eventos en courseProgressEvents.
// Los eventos que solo pueden existir una vez llevan dedupeKey (índice único):
// si el front reintenta, el segundo insert falla con E11000 y no se duplica consumo.

function buildDedupeKey({ eventType, userId, courseId, courseVersion, stepId }) {
    switch (eventType) {
        case EVENT_TYPES.COURSE_STARTED:
            return `${eventType}|${userId}|${courseId}`;
        case EVENT_TYPES.STEP_COMPLETED:
        case EVENT_TYPES.QUIZ_PASSED:
            return `${eventType}|${userId}|${courseId}|v${courseVersion}|${stepId}`;
        case EVENT_TYPES.COURSE_COMPLETED:
        case EVENT_TYPES.COURSE_VERSION_MIGRATED:
            return `${eventType}|${userId}|${courseId}|v${courseVersion}`;
        default:
            return undefined; // QUIZ_COMPLETED: un evento por intento
    }
}

async function recordEvent({
    eventType,
    userId,
    course,
    step = null,
    access = null,
    metadata = {},
    session = null,
    occurredAt = new Date(),
}) {
    const doc = {
        eventId: crypto.randomUUID(),
        userId,
        courseId: course.courseId,
        courseVersion: course.version,
        partnerId: course.partnerId,
        eventType,
        stepId: step ? step.stepId : null,
        stepIndex: step ? step.stepIndex : null,
        moduleId: step ? step.moduleId : null,
        metadata: {
            ...metadata,
            courseStatus: course.status,
            ...(access
                ? {
                      accessType: access.accessType,
                      plan: access.plan ?? null,
                      partnerPoolEligible: access.partnerPoolEligible === true,
                  }
                : {}),
        },
        occurredAt,
    };

    const dedupeKey = buildDedupeKey({
        eventType,
        userId,
        courseId: course.courseId,
        courseVersion: course.version,
        stepId: doc.stepId,
    });
    if (dedupeKey) doc.dedupeKey = dedupeKey;

    const [created] = await CourseProgressEvent.create([doc], { session });
    return created;
}

module.exports = { recordEvent, buildDedupeKey };