const mongoose = require("mongoose");

const Partner = require("../schemas/PartnerSchema");
const CourseVersion = require("../schemas/CourseVersionSchema");
const CourseProgressEvent = require("../schemas/CourseProgressEventSchema");
const PartnerPoolConfig = require("../schemas/PartnerPoolConfigSchema");
const PartnerPoolConsumption = require("../schemas/PartnerPoolConsumptionSchema");
const PartnerPoolPeriod = require("../schemas/PartnerPoolPeriodSchema");
const PartnerPoolSettlement = require("../schemas/PartnerPoolSettlementSchema");
const PartnerPoolAuditLog = require("../schemas/PartnerPoolAuditLogSchema");
const { EVENT_TYPES } = require("../constants/eventTypes");
const { ACCESS_TYPES } = require("../constants/accessTypes");
const { httpError } = require("../utils/httpError");
const { runInTransaction } = require("../utils/db");
const { computeRevenue, hadEligiblePlan } = require("./partnerPoolRevenue");
const courseDurations = require("./courseDurationService");

// ══════════════════════════════════════════════════════════════════════
//  Partner Pool V1.2 — cálculo mensual, liquidaciones, ajustes y auditoría
//  (Especificación V1 + documento V1.2: ponderación dinámica por duración)
//
//  Separación obligatoria (V1.2, sección 6):
//   - PUNTOS BASE      → consumo y habilitación del fondo (nunca se ponderan)
//   - PUNTOS PONDERADOS → solo para repartir el fondo YA habilitado entre partners
//  La duración nunca agranda el fondo ni genera puntos base.
// ══════════════════════════════════════════════════════════════════════

const FORMULA_VERSION = "PP_V1.2.1"; // V1.2 + tope por curso, avance acumulado y orden de meses
const Decimal128 = mongoose.Types.Decimal128;
const EXCLUDED_ACCESS = new Set([ACCESS_TYPES.ADMIN, ACCESS_TYPES.TEST]);

// ─── Números ─────────────────────────────────────────────────────────
// Se calcula sin redondeos intermedios y se guarda en Decimal128.
// El único redondeo monetario es el del monto final de cada liquidación.
const SCORE_DIGITS = 12;
const toDec = (n, digits = SCORE_DIGITS) => Decimal128.fromString(Number(n || 0).toFixed(digits));
const toMoney = (n) => Decimal128.fromString((Math.round(Number(n || 0) * 100) / 100).toFixed(2));
const num = (d) => (d == null ? null : Number(d.toString()));

// Decimal128 → number en todo un objeto (para responder JSON legible)
function plain(value) {
    if (value == null) return value;
    if (value instanceof Decimal128 || value._bsontype === "Decimal128") return Number(value.toString());
    if (value instanceof mongoose.Types.ObjectId || value._bsontype === "ObjectId") return String(value);
    if (value instanceof Date) return value.toISOString();
    if (Array.isArray(value)) return value.map(plain);
    if (typeof value === "object") {
        const out = {};
        for (const [k, v] of Object.entries(value)) out[k] = plain(v);
        return out;
    }
    return value;
}

// ─── Período ─────────────────────────────────────────────────────────
// Meses de Argentina (UTC-3, sin horario de verano):
// "2026-10" = [2026-10-01 00:00 ART, 2026-11-01 00:00 ART)
const PERIOD_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;
const AR_OFFSET_HOURS = 3;

function parsePeriod(period) {
    const m = PERIOD_RE.exec(String(period || ""));
    if (!m) throw httpError(400, "Período inválido (formato AAAA-MM)");
    const y = Number(m[1]);
    const mo = Number(m[2]);
    return {
        period: `${m[1]}-${m[2]}`,
        from: new Date(Date.UTC(y, mo - 1, 1, AR_OFFSET_HOURS)),
        to: new Date(Date.UTC(y, mo, 1, AR_OFFSET_HOURS)),
    };
}

// ─── Configuración ───────────────────────────────────────────────────
async function getConfig() {
    const existing = await PartnerPoolConfig.findOne({ key: "active" }).lean();
    if (existing) return existing;
    try {
        return (await PartnerPoolConfig.create({ key: "active" })).toObject();
    } catch {
        return PartnerPoolConfig.findOne({ key: "active" }).lean(); // la creó otra request
    }
}

const RATE_FIELDS = ["maximumPoolRate", "progressWeight", "completionWeight", "consumptionTargetRate"];

async function updateConfig(changes, admin) {
    const current = await getConfig();
    const set = {};

    for (const f of RATE_FIELDS) {
        if (changes[f] === undefined) continue;
        const v = Number(changes[f]);
        if (!Number.isFinite(v) || v < 0 || v > 1) throw httpError(400, `${f} tiene que estar entre 0 y 1`);
        set[f] = v;
    }
    if (changes.defaultCourseWeight !== undefined) {
        const v = Number(changes.defaultCourseWeight);
        if (!Number.isFinite(v) || v <= 0) throw httpError(400, "defaultCourseWeight tiene que ser mayor a 0");
        set.defaultCourseWeight = v;
    }
    if (changes.revenue && typeof changes.revenue === "object") {
        const r = changes.revenue;
        if (r.mpFeeRate !== undefined) {
            const v = Number(r.mpFeeRate);
            if (!Number.isFinite(v) || v < 0 || v >= 1) throw httpError(400, "mpFeeRate inválido (entre 0 y 1)");
            set["revenue.mpFeeRate"] = v;
        }
        // eligiblePlans y basePlan no se cambian desde la API: son reglas de negocio fijas
    }

    const progressW = set.progressWeight ?? current.progressWeight;
    const completionW = set.completionWeight ?? current.completionWeight;
    if (Math.abs(progressW + completionW - 1) > 1e-9) {
        throw httpError(400, "progressWeight + completionWeight tiene que dar 1 (un recorrido completo = 1 punto)");
    }
    if (!Object.keys(set).length) throw httpError(400, "No hay cambios para guardar");

    set.updatedBy = admin.uid;
    const updated = await PartnerPoolConfig.findOneAndUpdate({ key: "active" }, { $set: set }, { returnDocument: "after" }).lean();

    await audit({ action: "CONFIG_UPDATED", admin, metadata: { before: plain(current), changes: set } });
    return updated;
}

// ─── Auditoría ───────────────────────────────────────────────────────
async function audit({ action, admin, period = null, settlementId = null, partnerId = null, metadata = {}, session = null }) {
    await PartnerPoolAuditLog.create(
        [
            {
                action,
                period,
                settlementId,
                partnerId,
                adminUserId: admin.uid,
                adminEmail: admin.email || null,
                metadata,
                occurredAt: new Date(),
            },
        ],
        { session }
    );
}

// ══════════════════════════════════════════════════════════════════════
//  CÁLCULO (función pura: misma entrada → mismo resultado)
// ══════════════════════════════════════════════════════════════════════
//
//  Reglas de puntos (V1.2 + criterios confirmados por Hidden, nov 2026):
//
//  - Tope: cada alumno suma como máximo 1 punto por CURSO, para siempre,
//    sin importar la versión. Si ya llegó a 1 en un curso, nunca más suma en
//    ese curso. Cursos distintos suman por separado (hasta 1 cada uno).
//
//  - Avance acumulado: el avance de un curso se mide sobre TODO lo que el
//    alumno hizo hasta ese momento (este mes y los anteriores):
//        avance   = pasos elegibles hechos / pasos elegibles de la versión
//                   (si cursó varias versiones, se toma la de mayor avance)
//        ganado   = avance × progressWeight (0,70) + completionWeight (0,30)
//                   si ya terminó el curso; con tope de 1
//    En cada mes se paga:  ganado − lo ya pagado en meses anteriores.
//
//  - "Ganado" se mide en el ÚLTIMO momento del mes en que el avance podía
//    sumar (alumno con plan pago vigente y empresa activa). Lo que hizo sin
//    plan o con la empresa suspendida no se pierde: se paga cuando vuelve a
//    avanzar con plan vigente, en ese mismo mes o en otro.
//
//  - Nunca suman: admin, partner, enterprise, accesos ADMIN/TEST. Tampoco los
//    cursos o empresas con partnerPool.enabled = false.
//
//  - Todo es PUNTO BASE: la ponderación por duración se aplica después, una
//    sola vez por curso (computeDurationWeighting).
//
//  Para respetar el tope, lo "ya pagado" sale de los meses anteriores
//  calculados: por eso un mes solo se calcula con todos los anteriores al día
//  (assertPreviousPeriods en calculatePeriod).

const keyOf = (userId, courseId) => `${userId}|${courseId}`;
const courseKeyOf = (courseId, version) => `${courseId}|${version}`;
const POOL_EVENT_TYPES = [EVENT_TYPES.STEP_COMPLETED, EVENT_TYPES.COURSE_COMPLETED, EVENT_TYPES.COURSE_STARTED];
const EPS = 1e-12;

/**
 * @param events          eventos del mes y, para el avance acumulado, los
 *                        anteriores de esos alumnos y cursos (occurredAt < from)
 * @param previousScores  Map "userId|courseId" → puntos ya pagados en meses anteriores
 * @param from            inicio del mes (sin él, todos los eventos son del mes)
 */
function computeConsumption({ events, versions, partners, previousScores, config, eligibility = null, from = null }) {
    const progressWeight = Number(config.progressWeight);
    const completionWeight = Number(config.completionWeight);
    const fromTime = from ? new Date(from).getTime() : -Infinity;

    const versionMap = new Map(versions.map((v) => [courseKeyOf(v.courseId, v.version), v]));
    const eligibleSteps = new Map(
        versions.map((v) => [
            courseKeyOf(v.courseId, v.version),
            new Set(v.steps.filter((s) => s.progressEligible).map((s) => s.stepId)),
        ])
    );
    const partnerMap = new Map(partners.map((p) => [String(p._id), p]));

    const participates = (v) => {
        const p = partnerMap.get(String(v.partnerId));
        return !!p && p.partnerPool?.enabled !== false && v.partnerPool?.enabled !== false;
    };

    const warnings = {
        unknownVersions: new Set(),
        nonEligibleEvents: 0,
        excludedAccessEvents: 0,
        excludedRoleEvents: 0,
        bannedPartnerEvents: 0,
        noPaidPlanEvents: 0,
    };

    const isStaff = (e) => {
        const role = e.metadata?.role ?? null;
        return role ? role !== "student" : !!eligibility?.staffUserIds?.has(String(e.userId));
    };

    // ¿En este momento el avance podía sumar? (plan vigente y empresa activa)
    // Solo se cuentan avisos de los eventos del mes.
    const canEarnAt = (e, inPeriod) => {
        if (e.metadata?.partnerBanned === true) {
            if (inPeriod) warnings.bannedPartnerEvents++;
            return false;
        }
        if (eligibility) {
            if (!hadEligiblePlan(eligibility.windowsByUser, e.userId, e.occurredAt)) {
                if (inPeriod) warnings.noPaidPlanEvents++;
                return false;
            }
            return true;
        }
        // Sin datos de pagos (solo tests): se usa la marca guardada en el evento
        if (e.metadata?.partnerPoolEligible !== true) {
            if (inPeriod) warnings.nonEligibleEvents++;
            return false;
        }
        return true;
    };

    const sorted = [...events].sort((a, b) => new Date(a.occurredAt) - new Date(b.occurredAt));
    const enrollments = new Map(); // courseKey → inscripciones del mes
    const perCourse = new Map();   // "userId|courseId" → estado acumulado

    for (const e of sorted) {
        const at = new Date(e.occurredAt).getTime();
        const inPeriod = at >= fromTime;

        const accessType = e.metadata?.accessType ?? null;
        if (accessType && EXCLUDED_ACCESS.has(accessType)) {
            if (inPeriod) warnings.excludedAccessEvents++;
            continue;
        }
        const cKey = courseKeyOf(e.courseId, e.courseVersion);
        const v = versionMap.get(cKey);
        if (!v) {
            if (inPeriod) warnings.unknownVersions.add(cKey);
            continue;
        }
        if (isStaff(e)) {
            if (inPeriod) warnings.excludedRoleEvents++;
            continue;
        }

        if (e.eventType === EVENT_TYPES.COURSE_STARTED) {
            if (inPeriod && canEarnAt(e, true)) enrollments.set(cKey, (enrollments.get(cKey) || 0) + 1);
            continue;
        }

        const key = keyOf(e.userId, e.courseId);
        if (!perCourse.has(key)) {
            perCourse.set(key, {
                userId: e.userId,
                courseId: e.courseId,
                stepsByVersion: new Map(),
                completedAt: null,
                periodNewSteps: 0,
                accessType,
                pay: null, // foto del avance en el último momento del mes en que podía sumar
            });
        }
        const s = perCourse.get(key);
        s.accessType = accessType || s.accessType;

        // El avance se acumula siempre (con o sin plan): lo hecho sin plan se paga después
        if (e.eventType === EVENT_TYPES.STEP_COMPLETED) {
            if (e.stepId && eligibleSteps.get(cKey).has(e.stepId)) {
                if (!s.stepsByVersion.has(cKey)) s.stepsByVersion.set(cKey, new Set());
                const set = s.stepsByVersion.get(cKey);
                if (!set.has(e.stepId)) {
                    set.add(e.stepId);
                    if (inPeriod) s.periodNewSteps++;
                }
            }
        } else if (e.eventType === EVENT_TYPES.COURSE_COMPLETED) {
            if (s.completedAt == null) s.completedAt = at;
        }

        if (inPeriod && canEarnAt(e, true)) {
            let progress = 0;
            for (const [vk, set] of s.stepsByVersion) {
                const total = versionMap.get(vk).totalEligibleSteps || 0;
                if (total) progress = Math.max(progress, Math.min(1, set.size / total));
            }
            s.pay = {
                version: e.courseVersion,
                progress,
                completed: s.completedAt != null,
                completedInPeriod: s.completedAt != null && s.completedAt >= fromTime,
                periodNewSteps: s.periodNewSteps,
            };
        }
    }

    const snapshots = [];
    for (const [key, s] of perCourse) {
        if (!s.pay) continue; // en el mes no hubo ningún momento en que pudiera sumar
        const v = versionMap.get(courseKeyOf(s.courseId, s.pay.version));
        if (!participates(v)) continue;
        const earnedProgress = s.pay.progress * progressWeight;
        const earnedCompletion = s.pay.completed ? completionWeight : 0;
        const rawEarned = earnedProgress + earnedCompletion;
        const earned = Math.min(1, rawEarned);

        const previous = previousScores.get(key) || 0;
        const totalScore = Math.max(0, earned - previous);
        // Sin nada para pagar y sin avance nuevo en el mes: no hay registro
        if (totalScore <= EPS && !s.pay.periodNewSteps && !s.pay.completedInPeriod) continue;

        // Desglose: lo pagado antes cubre primero el avance
        const progressScore = Math.min(totalScore, Math.max(0, earnedProgress - previous));
        const completionScore = Math.max(0, totalScore - progressScore);

        snapshots.push({
            userId: s.userId,
            courseId: s.courseId,
            courseVersion: s.pay.version,
            partnerId: String(v.partnerId),
            accessType: s.accessType,
            courseSnapshot: {
                title: v.title,
                totalEligibleSteps: v.totalEligibleSteps || 0,
                estimatedDurationMinutes: v.estimatedDurationMinutes ?? null,
                moduleCount: v.moduleCount ?? 0,
                courseWeight: 1, // V1.2: sin peso fijo por curso (campo histórico)
            },
            consumption: {
                newCompletedSteps: s.pay.periodNewSteps,
                progressDelta: progressWeight ? progressScore / progressWeight : 0,
                completedDuringPeriod: s.pay.completedInPeriod,
                progressScore,
                completionScore,
                totalScore,
                // lo que pasó del tope de 1 punto en el curso
                cappedBy: rawEarned - 1 > EPS ? rawEarned - 1 : null,
                weightedScore: totalScore, // campo histórico: = puntos base
            },
        });
    }

    // ── Consolidación: usuario → curso → Partner (sección 19) ────────
    const partnerAgg = new Map(); // partnerId → { score, courses: Map }
    const ensureCourse = (partnerId, courseId, version, title) => {
        if (!partnerAgg.has(partnerId)) partnerAgg.set(partnerId, { score: 0, courses: new Map() });
        const pa = partnerAgg.get(partnerId);
        const cKey = courseKeyOf(courseId, version);
        if (!pa.courses.has(cKey)) {
            pa.courses.set(cKey, {
                courseId,
                courseVersion: version,
                title,
                enrollments: 0,
                uniqueConsumers: 0,
                completions: 0,
                consumptionScore: 0,
            });
        }
        return pa.courses.get(cKey);
    };

    for (const s of snapshots) {
        const c = ensureCourse(s.partnerId, s.courseId, s.courseVersion, s.courseSnapshot.title);
        c.consumptionScore += s.consumption.totalScore; // puntos BASE del curso
        if (s.consumption.totalScore > 0) c.uniqueConsumers++;
        if (s.consumption.completedDuringPeriod) c.completions++;
        partnerAgg.get(s.partnerId).score += s.consumption.totalScore;
    }

    for (const [cKey, count] of enrollments) {
        const v = versionMap.get(cKey);
        if (!participates(v)) continue;
        ensureCourse(String(v.partnerId), v.courseId, v.version, v.title).enrollments += count;
    }

    const globalScore = [...partnerAgg.values()].reduce((acc, p) => acc + p.score, 0);
    const uniqueConsumers = new Set(snapshots.filter((s) => s.consumption.totalScore > 0).map((s) => s.userId));
    const participatingCourses = new Set(
        snapshots.filter((s) => s.consumption.totalScore > 0).map((s) => courseKeyOf(s.courseId, s.courseVersion))
    );

    return {
        snapshots,
        partners: [...partnerAgg.entries()].map(([partnerId, pa]) => ({
            partnerId,
            partnerBaseScore: pa.score,
            courses: [...pa.courses.values()],
        })),
        globalScore, // suma de PUNTOS BASE: es lo único que habilita el fondo
        metrics: {
            uniqueEligibleConsumers: uniqueConsumers.size,
            participatingCourses: participatingCourses.size,
            participatingPartners: [...partnerAgg.values()].filter((p) => p.score > 0).length,
        },
        warnings: {
            unknownVersions: [...warnings.unknownVersions],
            nonEligibleEvents: warnings.nonEligibleEvents,
            excludedAccessEvents: warnings.excludedAccessEvents,
            excludedRoleEvents: warnings.excludedRoleEvents,
            bannedPartnerEvents: warnings.bannedPartnerEvents,
            noPaidPlanEvents: warnings.noPaidPlanEvents,
        },
    };
}

// ══════════════════════════════════════════════════════════════════════
//  PONDERACIÓN DINÁMICA POR DURACIÓN (V1.2, secciones 3 a 5)
//
//  - Participan los cursos (versión) con puntos base > 0 en el período.
//  - Referencia del mes (100%) = mayor duración APROBADA entre esos cursos.
//    Un curso sin consumo no mueve la referencia. Empates → todos 100%.
//  - % del curso = horas del curso / horas de referencia (sin redondear)
//  - Puntos ponderados = puntos base del curso × %   (una sola vez, por curso)
//  - Participación del partner = sus ponderados / ponderados totales
//  - Un curso con puntos y SIN duración aprobada no recibe % automático:
//    el período queda "requiere revisión" y no se puede aprobar.
// ══════════════════════════════════════════════════════════════════════
function computeDurationWeighting({ partners, durations }) {
    const EPS = 1e-9;
    const missingDurations = [];
    const all = [];

    for (const p of partners) {
        for (const c of p.courses) {
            if (!(c.consumptionScore > 0)) continue;
            const d = durations.get(courseKeyOf(c.courseId, c.courseVersion));
            const hours = d?.hours ?? null;
            if (hours == null) {
                missingDurations.push({
                    courseId: c.courseId,
                    courseVersion: c.courseVersion,
                    title: c.title,
                    partnerId: p.partnerId,
                    reason: !d ? "SIN_REGISTRO" : d.contentChanged ? "CONTENIDO_CAMBIADO" : d.status,
                });
            }
            all.push({ partnerId: p.partnerId, course: c, hours, recordId: d?.recordId ?? null });
        }
    }

    const withHours = all.filter((x) => x.hours != null && x.hours > 0);
    const referenceHours = withHours.length ? Math.max(...withHours.map((x) => x.hours)) : null;

    const weightOf = new Map(); // courseKey → { approvedHours, weightPct, weightedScore, durationRecordId }
    for (const x of all) {
        const weightPct = x.hours != null && referenceHours ? x.hours / referenceHours : 0;
        weightOf.set(courseKeyOf(x.course.courseId, x.course.courseVersion), {
            approvedHours: x.hours,
            weightPct: x.hours != null ? weightPct : null,
            weightedScore: x.course.consumptionScore * weightPct,
            durationRecordId: x.recordId,
        });
    }

    const outPartners = partners.map((p) => {
        const courses = p.courses.map((c) => {
            const w = weightOf.get(courseKeyOf(c.courseId, c.courseVersion));
            return {
                ...c,
                approvedHours: w ? w.approvedHours : null,
                weightPct: w ? w.weightPct : null,
                weightedScore: w ? w.weightedScore : 0,
                durationRecordId: w ? w.durationRecordId : null,
            };
        });
        return {
            partnerId: p.partnerId,
            partnerBaseScore: p.partnerBaseScore,
            partnerWeightedScore: courses.reduce((acc, c) => acc + c.weightedScore, 0),
            courses,
        };
    });

    const totalBaseScore = outPartners.reduce((acc, p) => acc + p.partnerBaseScore, 0);
    const totalWeightedScore = outPartners.reduce((acc, p) => acc + p.partnerWeightedScore, 0);
    for (const p of outPartners) {
        p.partnerShare = totalWeightedScore > 0 ? p.partnerWeightedScore / totalWeightedScore : 0;
    }

    const courseRows = all.map((x) => {
        const w = weightOf.get(courseKeyOf(x.course.courseId, x.course.courseVersion));
        return {
            courseId: x.course.courseId,
            courseVersion: x.course.courseVersion,
            title: x.course.title,
            partnerId: x.partnerId,
            approvedHours: x.hours,
            durationRecordId: x.recordId,
            weightPct: w.weightPct,
            baseScore: x.course.consumptionScore,
            weightedScore: w.weightedScore,
            isReference: referenceHours != null && x.hours != null && Math.abs(x.hours - referenceHours) < EPS,
        };
    });

    return {
        referenceHours,
        referenceCourses: courseRows.filter((c) => c.isReference),
        courses: courseRows,
        partners: outPartners,
        totalBaseScore,
        totalWeightedScore,
        requiresReview: missingDurations.length > 0,
        missingDurations,
    };
}

// Enablement Factor — estrategia COURSE_EQUIVALENT (secciones 21 a 23)
//   maximumPoolAmount = ingresos netos elegibles × maximumPoolRate (20%)
//   consumptionTarget = suscripciones elegibles × consumptionTargetRate (50%)
//   enablementFactor  = min(1, consumo total / consumptionTarget)
//   enabledPoolAmount = maximumPoolAmount × enablementFactor
//   Ejemplo del documento: 10.000.000 × 20% = 2.000.000 · meta 1.000 × 0,5 = 500 ·
//   factor 300 / 500 = 0,60 · pool habilitado 1.200.000
function computeFinancials({ revenue, eligibleSubscriptions, totalConsumptionScore, config }) {
    if (config.enablementStrategy !== "COURSE_EQUIVALENT") {
        throw httpError(500, `Estrategia de habilitación no soportada: ${config.enablementStrategy}`);
    }
    const maximumPoolAmount = revenue * Number(config.maximumPoolRate);
    const consumptionTarget = eligibleSubscriptions * Number(config.consumptionTargetRate);
    const enablementFactor = consumptionTarget > 0 ? Math.min(1, totalConsumptionScore / consumptionTarget) : 0;
    return {
        maximumPoolAmount,
        consumptionTarget,
        enablementFactor,
        enabledPoolAmount: maximumPoolAmount * enablementFactor,
    };
}

const finalAmountOf = (settlementAmount, adjustments) =>
    adjustments.reduce(
        (acc, a) => acc + (a.type === "CREDIT" ? 1 : -1) * Number(a.amount.toString()),
        Number(settlementAmount.toString())
    );

// ══════════════════════════════════════════════════════════════════════
//  ORDEN DE LOS MESES
//  El tope de 1 punto por curso descuenta lo pagado en meses anteriores, así
//  que un mes solo se calcula, aprueba o cierra con los anteriores al día.
//  Solo cuentan los meses que tuvieron avances de cursos de partners.
// ══════════════════════════════════════════════════════════════════════
const MONTHS_ES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const periodLabel = (period) => {
    const [y, m] = period.split("-").map(Number);
    return `${MONTHS_ES[m - 1]} ${y}`;
};
const shiftPeriod = (period, delta) => {
    const [y, m] = period.split("-").map(Number);
    const d = new Date(Date.UTC(y, m - 1 + delta, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};
// Mes argentino de una fecha
const periodOfDate = (date) => {
    const d = new Date(new Date(date).getTime() - AR_OFFSET_HOURS * 3600 * 1000);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};

const READY_FOR = {
    calculate: { statuses: ["CALCULATED", "APPROVED", "CLOSED"], verb: "calculá" },
    approve: { statuses: ["APPROVED", "CLOSED"], verb: "aprobá" },
    close: { statuses: ["CLOSED"], verb: "cerrá" },
};

/**
 * Primer mes anterior a `period` que tuvo avances y no está listo para `action`.
 * Devuelve el motivo (texto para el panel) o null si está todo al día.
 */
async function previousPeriodBlocker(period, from, action) {
    const rule = READY_FOR[action];
    const first = await CourseProgressEvent.findOne({
        partnerId: { $ne: null },
        occurredAt: { $lt: from },
        eventType: { $in: POOL_EVENT_TYPES },
    })
        .sort({ occurredAt: 1 })
        .select("occurredAt")
        .lean();
    if (!first) return null;

    const months = [];
    for (let p = periodOfDate(first.occurredAt); p < period && months.length < 240; p = shiftPeriod(p, 1)) months.push(p);
    if (!months.length) return null;

    const docs = await PartnerPoolPeriod.find({ period: { $in: months } })
        .select("period status needsRecalculation")
        .lean();
    const byPeriod = new Map(docs.map((d) => [d.period, d]));

    for (const m of months) {
        const doc = byPeriod.get(m);
        if (doc && rule.statuses.includes(doc.status) && !doc.needsRecalculation) continue;

        const range = parsePeriod(m);
        const hadEvents = await CourseProgressEvent.findOne({
            partnerId: { $ne: null },
            occurredAt: { $gte: range.from, $lt: range.to },
            eventType: { $in: POOL_EVENT_TYPES },
        })
            .select("_id")
            .lean();
        if (!hadEvents) continue;

        if (doc?.needsRecalculation) {
            return `Primero recalculá ${periodLabel(m)}: quedó desactualizado.`;
        }
        return `Primero ${rule.verb} ${periodLabel(m)}: tiene avances de alumnos y todavía no está ${
            action === "calculate" ? "calculado" : action === "approve" ? "aprobado" : "cerrado"
        }.`;
    }
    return null;
}

// Mes posterior que impide recalcular `period` (se está calculando, o ya está aprobado/cerrado)
async function laterPeriodBlocker(period) {
    const later = await PartnerPoolPeriod.findOne({
        period: { $gt: period },
        status: { $in: ["CALCULATING", "APPROVED", "CLOSED"] },
    })
        .sort({ period: 1 })
        .select("period status")
        .lean();
    if (!later) return null;
    return later.status === "CALCULATING"
        ? `Se está calculando ${periodLabel(later.period)}: esperá a que termine.`
        : `${periodLabel(later.period)} ya está ${later.status === "APPROVED" ? "aprobado" : "cerrado"}: reabrilo antes de recalcular este mes.`;
}

// ══════════════════════════════════════════════════════════════════════
//  FLUJO
// ══════════════════════════════════════════════════════════════════════

async function calculatePeriod(periodInput, admin) {
    const { period, from, to } = parsePeriod(periodInput);
    if (to > new Date()) throw httpError(409, "El período todavía no terminó: se calcula cuando cierra el mes");

    // Orden de los meses: los anteriores calculados y ninguno posterior aprobado
    const blockedBefore = await previousPeriodBlocker(period, from, "calculate");
    if (blockedBefore) throw httpError(409, blockedBefore);
    const blockedAfter = await laterPeriodBlocker(period);
    if (blockedAfter) throw httpError(409, blockedAfter);

    // Bloqueo: solo un cálculo a la vez y nunca sobre períodos aprobados o cerrados
    let previousStatus = "OPEN";
    let createdNow = false;
    let locked = await PartnerPoolPeriod.findOneAndUpdate(
        { period, status: { $in: ["OPEN", "CALCULATED"] } },
        { $set: { status: "CALCULATING" } },
        { returnDocument: "before" }
    ).lean();

    if (locked) {
        previousStatus = locked.status;
    } else {
        const existing = await PartnerPoolPeriod.findOne({ period }).lean();
        if (existing) {
            throw httpError(
                409,
                existing.status === "CALCULATING"
                    ? "El período ya se está calculando"
                    : "El período está aprobado o cerrado: reabrilo para recalcular"
            );
        }
        try {
            await PartnerPoolPeriod.create({ period, status: "CALCULATING", range: { from, to } });
            createdNow = true;
        } catch {
            throw httpError(409, "El período ya se está calculando");
        }
    }

    // Un solo cálculo a la vez en todo el pool: un mes usa lo pagado en los
    // anteriores, así que dos meses calculándose juntos podrían pisarse
    const other = await PartnerPoolPeriod.findOne({ period: { $ne: period }, status: "CALCULATING" })
        .select("period")
        .lean();
    if (other) {
        if (createdNow) await PartnerPoolPeriod.deleteOne({ period, status: "CALCULATING" });
        else await PartnerPoolPeriod.updateOne({ period, status: "CALCULATING" }, { $set: { status: previousStatus } });
        throw httpError(409, `Se está calculando ${periodLabel(other.period)}: esperá a que termine y volvé a intentar.`);
    }

    try {
        const config = await getConfig();

        const [partners, events] = await Promise.all([
            Partner.find({}).lean(),
            CourseProgressEvent.find({
                partnerId: { $ne: null },
                occurredAt: { $gte: from, $lt: to },
                eventType: { $in: [EVENT_TYPES.STEP_COMPLETED, EVENT_TYPES.COURSE_COMPLETED, EVENT_TYPES.COURSE_STARTED] },
            })
                .select("userId courseId courseVersion partnerId eventType stepId metadata occurredAt")
                .lean(),
        ]);

        // Avance acumulado: lo que esos alumnos hicieron antes en esos cursos
        const userIds = [...new Set(events.map((e) => e.userId))];
        const courseIds = [...new Set(events.map((e) => e.courseId))];
        const history = userIds.length
            ? await CourseProgressEvent.find({
                  partnerId: { $ne: null },
                  userId: { $in: userIds },
                  courseId: { $in: courseIds },
                  occurredAt: { $lt: from },
                  eventType: { $in: [EVENT_TYPES.STEP_COMPLETED, EVENT_TYPES.COURSE_COMPLETED] },
              })
                  .select("userId courseId courseVersion partnerId eventType stepId metadata occurredAt")
                  .lean()
            : [];
        const allEvents = [...history, ...events];

        const pairs = [...new Set(allEvents.map((e) => courseKeyOf(e.courseId, e.courseVersion)))].map((k) => {
            const [courseId, version] = k.split("|");
            return { courseId, version: Number(version) };
        });
        const versions = pairs.length ? await CourseVersion.find({ $or: pairs }).lean() : [];

        // Puntos ya pagados en meses anteriores, por alumno y CURSO (todas las versiones)
        const previousRows = userIds.length
            ? await PartnerPoolConsumption.aggregate([
                  { $match: { period: { $lt: period }, userId: { $in: userIds }, courseId: { $in: courseIds } } },
                  { $group: { _id: { u: "$userId", c: "$courseId" }, total: { $sum: "$consumption.totalScore" } } },
              ])
            : [];
        const previousScores = new Map(previousRows.map((r) => [keyOf(r._id.u, r._id.c), num(r.total)]));

        // Ingresos, suscripciones y planes vigentes de cada alumno (desde los pagos)
        const revenue = await computeRevenue({ from, to, revenueConfig: config.revenue || {} });

        const result = computeConsumption({
            events: allEvents,
            from,
            versions,
            partners,
            previousScores,
            config,
            eligibility: { windowsByUser: revenue.windowsByUser, staffUserIds: revenue.staffUserIds },
        });
        // La habilitación del fondo usa SOLO puntos base (V1.2, sección 6)
        const fin = computeFinancials({
            revenue: revenue.eligibleNetTrainingRevenue,
            eligibleSubscriptions: revenue.eligibleSubscriptions,
            totalConsumptionScore: result.globalScore,
            config,
        });

        // Ponderación por duración: se usa la duración APROBADA de la versión que
        // generó los puntos (no la del curso actual)
        const pairsWithPoints = [];
        for (const p of result.partners) {
            for (const c of p.courses) {
                if (c.consumptionScore > 0) pairsWithPoints.push({ courseId: c.courseId, version: c.courseVersion });
            }
        }
        const durations = await courseDurations.getDurationsFor(pairsWithPoints);
        const weighting = computeDurationWeighting({ partners: result.partners, durations });

        const now = new Date();
        const partnerMap = new Map(partners.map((p) => [String(p._id), p]));

        await runInTransaction(async (session) => {
            // Snapshots: se reemplazan enteros (el período no está aprobado ni cerrado)
            await PartnerPoolConsumption.deleteMany({ period }, { session });
            if (result.snapshots.length) {
                await PartnerPoolConsumption.insertMany(
                    result.snapshots.map((s) => ({
                        period,
                        userId: s.userId,
                        courseId: s.courseId,
                        courseVersion: s.courseVersion,
                        partnerId: s.partnerId,
                        eligibility: { eligible: true, accessType: s.accessType },
                        courseSnapshot: { ...s.courseSnapshot, courseWeight: toDec(s.courseSnapshot.courseWeight) },
                        consumption: {
                            newCompletedSteps: s.consumption.newCompletedSteps,
                            progressDelta: toDec(s.consumption.progressDelta),
                            completedDuringPeriod: s.consumption.completedDuringPeriod,
                            progressScore: toDec(s.consumption.progressScore),
                            completionScore: toDec(s.consumption.completionScore),
                            totalScore: toDec(s.consumption.totalScore),
                            cappedBy: s.consumption.cappedBy == null ? null : toDec(s.consumption.cappedBy),
                            weightedScore: toDec(s.consumption.weightedScore),
                        },
                        formulaVersion: FORMULA_VERSION,
                        calculatedAt: now,
                    })),
                    { session }
                );
            }

            // Liquidaciones: se actualizan conservando ajustes y cancelaciones
            const existing = await PartnerPoolSettlement.find({ period }).session(session).lean();
            const existingByPartner = new Map(existing.map((s) => [String(s.partnerId), s]));
            const computedPartners = new Set(weighting.partners.map((p) => p.partnerId));

            const zeroFor = (partnerId) => ({
                partnerId,
                partnerBaseScore: 0,
                partnerWeightedScore: 0,
                partnerShare: 0,
                courses: [],
            });
            const toWrite = [
                ...weighting.partners.filter((p) => p.partnerBaseScore > 0 || existingByPartner.has(p.partnerId)),
                ...[...existingByPartner.keys()].filter((id) => !computedPartners.has(id)).map(zeroFor),
            ];

            for (const p of toWrite) {
                const partner = partnerMap.get(p.partnerId);
                const prev = existingByPartner.get(p.partnerId);
                const adjustments = prev?.adjustments || [];
                const settlementAmount = toMoney(fin.enabledPoolAmount * p.partnerShare);
                const finalAmount = toMoney(finalAmountOf(settlementAmount, adjustments));
                const code = (partner?.code || p.partnerId).replace(/[^A-Za-z0-9]/g, "");

                await PartnerPoolSettlement.updateOne(
                    { period, partnerId: p.partnerId },
                    {
                        $set: {
                            partnerSnapshot: {
                                code: partner?.code || "",
                                name: partner?.name || "",
                                email: partner?.email || "",
                            },
                            formulaVersion: FORMULA_VERSION,
                            courses: p.courses.map((c) => ({
                                courseId: c.courseId,
                                courseVersion: c.courseVersion,
                                title: c.title,
                                enrollments: c.enrollments,
                                uniqueConsumers: c.uniqueConsumers,
                                completions: c.completions,
                                consumptionScore: toDec(c.consumptionScore), // puntos base
                                approvedHours: c.approvedHours == null ? null : toDec(c.approvedHours, 2),
                                weightPct: c.weightPct == null ? null : toDec(c.weightPct),
                                weightedScore: toDec(c.weightedScore || 0),
                                durationRecordId: c.durationRecordId || null,
                            })),
                            partnerBaseScore: toDec(p.partnerBaseScore),
                            partnerScore: toDec(p.partnerWeightedScore), // ponderados: definen la participación
                            globalBaseScore: toDec(weighting.totalBaseScore),
                            globalScore: toDec(weighting.totalWeightedScore),
                            partnerShare: toDec(p.partnerShare),
                            referenceHours: weighting.referenceHours == null ? null : toDec(weighting.referenceHours, 2),
                            enabledPoolAmount: toMoney(fin.enabledPoolAmount),
                            settlementAmount,
                            finalAmount,
                            status: prev?.status === "CANCELLED" ? "CANCELLED" : "CALCULATED",
                            calculatedAt: now,
                            approvedAt: null,
                            approvedBy: null,
                        },
                        $setOnInsert: { settlementId: `PPS-${period}-${code}`, adjustments: [] },
                    },
                    { upsert: true, session }
                );
            }

            await PartnerPoolPeriod.updateOne(
                { period },
                {
                    $set: {
                        status: "CALCULATED",
                        formulaVersion: FORMULA_VERSION,
                        range: { from, to },
                        // Copia inalterable de la referencia y los porcentajes usados (V1.2, sección 7)
                        durationWeighting: {
                            referenceHours: weighting.referenceHours == null ? null : toDec(weighting.referenceHours, 2),
                            referenceCourses: weighting.referenceCourses.map((c) => ({
                                courseId: c.courseId,
                                courseVersion: c.courseVersion,
                                title: c.title,
                                partnerId: c.partnerId,
                                partnerName: partnerMap.get(c.partnerId)?.name || "",
                            })),
                            courses: weighting.courses.map((c) => ({
                                courseId: c.courseId,
                                courseVersion: c.courseVersion,
                                title: c.title,
                                partnerId: c.partnerId,
                                partnerName: partnerMap.get(c.partnerId)?.name || "",
                                approvedHours: c.approvedHours == null ? null : toDec(c.approvedHours, 2),
                                durationRecordId: c.durationRecordId,
                                weightPct: c.weightPct == null ? null : toDec(c.weightPct),
                                baseScore: toDec(c.baseScore),
                                weightedScore: toDec(c.weightedScore),
                                isReference: c.isReference,
                            })),
                            totalBaseScore: toDec(weighting.totalBaseScore),
                            totalWeightedScore: toDec(weighting.totalWeightedScore),
                            requiresReview: weighting.requiresReview,
                            missingDurations: weighting.missingDurations.map((m) => ({
                                ...m,
                                partnerName: partnerMap.get(m.partnerId)?.name || "",
                            })),
                        },
                        configuration: {
                            maximumPoolRate: toDec(config.maximumPoolRate),
                            progressWeight: toDec(config.progressWeight),
                            completionWeight: toDec(config.completionWeight),
                            consumptionTargetRate: toDec(config.consumptionTargetRate),
                            enablementStrategy: config.enablementStrategy,
                            defaultCourseWeight: toDec(config.defaultCourseWeight ?? 1),
                            revenue: plain(config.revenue || {}),
                        },
                        financials: {
                            eligibleNetTrainingRevenue: toMoney(revenue.eligibleNetTrainingRevenue),
                            maximumPoolAmount: toMoney(fin.maximumPoolAmount),
                            enabledPoolAmount: toMoney(fin.enabledPoolAmount),
                        },
                        revenueBreakdown: {
                            activePlans: revenue.breakdown.activePlans,
                            planCounts: revenue.breakdown.planCounts,
                            discountedPlans: revenue.breakdown.discountedPlans,
                            excludedFreePayments: revenue.breakdown.excludedFreePayments,
                            excludedStaffPlans: revenue.breakdown.excludedStaffPlans,
                            basePlan: revenue.breakdown.basePlan,
                            basePlanPrice: toMoney(revenue.breakdown.basePlanPrice),
                            mpFeeRate: toDec(revenue.breakdown.mpFeeRate),
                            grossAmount: toMoney(revenue.breakdown.grossAmount),
                            feesAmount: toMoney(revenue.breakdown.feesAmount),
                        },
                        metrics: {
                            eligibleSubscriptions: revenue.eligibleSubscriptions,
                            uniqueEligibleConsumers: result.metrics.uniqueEligibleConsumers,
                            participatingCourses: result.metrics.participatingCourses,
                            participatingPartners: result.metrics.participatingPartners,
                            totalConsumptionScore: toDec(result.globalScore),
                            consumptionTarget: toDec(fin.consumptionTarget),
                            enablementFactor: toDec(fin.enablementFactor),
                        },
                        calculatedAt: now,
                        calculatedBy: admin.uid,
                        approvedAt: null,
                        approvedBy: null,
                        closedAt: null,
                        closedBy: null,
                        needsRecalculation: null, // recién calculado: queda al día
                    },
                },
                { session }
            );

            // Los meses posteriores ya calculados usaron lo pagado en este mes:
            // quedan marcados y no se aprueban hasta recalcularlos
            const stale = await PartnerPoolPeriod.find({ period: { $gt: period }, status: "CALCULATED" })
                .session(session)
                .select("period")
                .lean();
            if (stale.length) {
                await PartnerPoolPeriod.updateMany(
                    { period: { $in: stale.map((p) => p.period) }, status: "CALCULATED" },
                    { $set: { needsRecalculation: { since: now, causedBy: period } } },
                    { session }
                );
            }

            await audit({
                action: "CALCULATED",
                admin,
                period,
                session,
                metadata: {
                    recalculation: previousStatus === "CALCULATED",
                    events: events.length,
                    snapshots: result.snapshots.length,
                    globalScore: result.globalScore,
                    totalWeightedScore: weighting.totalWeightedScore,
                    referenceHours: weighting.referenceHours,
                    requiresReview: weighting.requiresReview,
                    enabledPoolAmount: fin.enabledPoolAmount,
                    warnings: result.warnings,
                    historyEvents: history.length,
                    markedForRecalculation: stale.map((p) => p.period),
                },
            });
        });

        return { warnings: { ...result.warnings, missingDurations: weighting.missingDurations } };
    } catch (err) {
        // Si algo falló, el período vuelve al estado anterior
        await PartnerPoolPeriod.updateOne({ period, status: "CALCULATING" }, { $set: { status: previousStatus } });
        throw err;
    }
}

async function approvePeriod(periodInput, admin) {
    const { period, from } = parsePeriod(periodInput);
    // Orden de los meses: no se aprueba con un mes anterior sin aprobar
    const blockedBefore = await previousPeriodBlocker(period, from, "approve");
    if (blockedBefore) throw httpError(409, blockedBefore);

    await runInTransaction(async (session) => {
        const now = new Date();
        // V1.2: no se aprueba si hay cursos con puntos y sin duración aprobada,
        // ni si quedó desactualizado por el recálculo de un mes anterior
        const updated = await PartnerPoolPeriod.findOneAndUpdate(
            {
                period,
                status: "CALCULATED",
                "durationWeighting.requiresReview": { $ne: true },
                needsRecalculation: null,
            },
            { $set: { status: "APPROVED", approvedAt: now, approvedBy: admin.uid } },
            { session, returnDocument: "after" }
        ).lean();
        if (!updated) {
            const current = await PartnerPoolPeriod.findOne({ period }).session(session).lean();
            if (current?.status === "CALCULATED" && current?.needsRecalculation) {
                throw httpError(
                    409,
                    `Este mes quedó desactualizado porque se recalculó ${periodLabel(current.needsRecalculation.causedBy)}. Recalculalo antes de aprobar.`
                );
            }
            if (current?.status === "CALCULATED" && current?.durationWeighting?.requiresReview) {
                throw httpError(
                    409,
                    "Hay cursos con consumo y sin duración aprobada. Aprobá sus duraciones en la pestaña Duraciones y recalculá el período."
                );
            }
            throw httpError(409, "Solo se aprueba un período calculado");
        }

        await PartnerPoolSettlement.updateMany(
            { period, status: "CALCULATED" },
            { $set: { status: "APPROVED", approvedAt: now, approvedBy: admin.uid } },
            { session }
        );
        await audit({
            action: "APPROVED",
            admin,
            period,
            session,
            metadata: { enabledPoolAmount: num(updated.financials.enabledPoolAmount) },
        });
    });
}

async function closePeriod(periodInput, admin) {
    const { period, from } = parsePeriod(periodInput);
    const blockedBefore = await previousPeriodBlocker(period, from, "close");
    if (blockedBefore) throw httpError(409, blockedBefore);
    await runInTransaction(async (session) => {
        const updated = await PartnerPoolPeriod.findOneAndUpdate(
            { period, status: "APPROVED" },
            { $set: { status: "CLOSED", closedAt: new Date(), closedBy: admin.uid } },
            { session, returnDocument: "after" }
        ).lean();
        if (!updated) throw httpError(409, "Solo se cierra un período aprobado");
        await audit({ action: "CLOSED", admin, period, session });
    });
}

async function reopenPeriod(periodInput, reason, admin) {
    const { period } = parsePeriod(periodInput);
    if (!reason || String(reason).trim().length < 5) throw httpError(400, "Indicá el motivo de la reapertura");

    await runInTransaction(async (session) => {
        const paid = await PartnerPoolSettlement.countDocuments({ period, status: "PAID" }).session(session);
        if (paid) throw httpError(409, "Hay liquidaciones pagadas: el período no se puede reabrir. Usá ajustes en el período siguiente.");

        const before = await PartnerPoolPeriod.findOneAndUpdate(
            { period, status: { $in: ["APPROVED", "CLOSED"] } },
            { $set: { status: "CALCULATED", approvedAt: null, approvedBy: null, closedAt: null, closedBy: null } },
            { session, returnDocument: "before" }
        ).lean();
        if (!before) throw httpError(409, "Solo se reabre un período aprobado o cerrado");

        await PartnerPoolSettlement.updateMany(
            { period, status: "APPROVED" },
            { $set: { status: "CALCULATED", approvedAt: null, approvedBy: null } },
            { session }
        );
        await audit({
            action: "REOPENED",
            admin,
            period,
            session,
            metadata: { from: before.status, reason: String(reason).trim() },
        });
    });
}

// ─── Liquidaciones ───────────────────────────────────────────────────
async function findSettlementOrFail(settlementId, session) {
    const s = await PartnerPoolSettlement.findOne({ settlementId }).session(session).lean();
    if (!s) throw httpError(404, "Liquidación no encontrada");
    const p = await PartnerPoolPeriod.findOne({ period: s.period }).session(session).lean();
    return { settlement: s, periodDoc: p };
}

async function addAdjustment(settlementId, { type, amount, reason }, admin) {
    if (!["CREDIT", "DEBIT"].includes(type)) throw httpError(400, "El tipo de ajuste es CREDIT o DEBIT");
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) throw httpError(400, "El monto del ajuste tiene que ser mayor a 0");
    if (!reason || String(reason).trim().length < 5) throw httpError(400, "Indicá el motivo del ajuste");

    await runInTransaction(async (session) => {
        const { settlement, periodDoc } = await findSettlementOrFail(settlementId, session);
        if (!["CALCULATED", "APPROVED"].includes(settlement.status)) {
            throw httpError(409, "Solo se ajustan liquidaciones calculadas o aprobadas");
        }
        if (periodDoc?.status === "CLOSED") throw httpError(409, "El período está cerrado: reabrilo para ajustar");

        const adjustment = {
            type,
            amount: toMoney(value),
            reason: String(reason).trim(),
            createdBy: admin.uid,
            createdAt: new Date(),
        };
        const adjustments = [...settlement.adjustments, adjustment];
        const final = finalAmountOf(settlement.settlementAmount, adjustments);
        if (final < 0) throw httpError(400, "El ajuste dejaría el monto final en negativo");

        const updated = await PartnerPoolSettlement.findOneAndUpdate(
            { settlementId, status: settlement.status },
            { $push: { adjustments: adjustment }, $set: { finalAmount: toMoney(final) } },
            { session, returnDocument: "after" }
        ).lean();
        if (!updated) throw httpError(409, "La liquidación cambió mientras se ajustaba, probá de nuevo");

        const created = updated.adjustments[updated.adjustments.length - 1];
        await audit({
            action: "ADJUSTED",
            admin,
            period: settlement.period,
            settlementId,
            partnerId: settlement.partnerId,
            session,
            metadata: {
                adjustmentId: created.adjustmentId,
                type,
                amount: value,
                reason: adjustment.reason,
                finalAmountBefore: num(settlement.finalAmount),
                finalAmountAfter: final,
            },
        });
    });
}

async function markPaid(settlementId, paymentReference, admin) {
    if (!paymentReference || String(paymentReference).trim().length < 3) {
        throw httpError(400, "Indicá la referencia del pago (transferencia, comprobante)");
    }
    await runInTransaction(async (session) => {
        const { settlement, periodDoc } = await findSettlementOrFail(settlementId, session);
        if (settlement.status !== "APPROVED") throw httpError(409, "Solo se paga una liquidación aprobada");
        if (periodDoc?.status !== "CLOSED") throw httpError(409, "Primero hay que cerrar el período");

        await PartnerPoolSettlement.updateOne(
            { settlementId, status: "APPROVED" },
            {
                $set: {
                    status: "PAID",
                    paidAt: new Date(),
                    paidBy: admin.uid,
                    paymentReference: String(paymentReference).trim(),
                },
            },
            { session }
        );
        await audit({
            action: "PAID",
            admin,
            period: settlement.period,
            settlementId,
            partnerId: settlement.partnerId,
            session,
            metadata: { finalAmount: num(settlement.finalAmount), paymentReference: String(paymentReference).trim() },
        });
    });
}

async function cancelSettlement(settlementId, reason, admin) {
    if (!reason || String(reason).trim().length < 5) throw httpError(400, "Indicá el motivo de la cancelación");
    await runInTransaction(async (session) => {
        const { settlement, periodDoc } = await findSettlementOrFail(settlementId, session);
        if (!["CALCULATED", "APPROVED"].includes(settlement.status)) {
            throw httpError(409, "Solo se cancela una liquidación calculada o aprobada");
        }
        if (periodDoc?.status === "CLOSED") throw httpError(409, "El período está cerrado: reabrilo para cancelar");

        await PartnerPoolSettlement.updateOne(
            { settlementId, status: settlement.status },
            {
                $set: {
                    status: "CANCELLED",
                    cancelledAt: new Date(),
                    cancelledBy: admin.uid,
                    cancelReason: String(reason).trim(),
                },
            },
            { session }
        );
        await audit({
            action: "CANCELLED",
            admin,
            period: settlement.period,
            settlementId,
            partnerId: settlement.partnerId,
            session,
            metadata: { reason: String(reason).trim(), finalAmount: num(settlement.finalAmount) },
        });
    });
}

// ─── Vista del partner: SOLO sus liquidaciones ───────────────────────
// La empresa sale del email verificado de la sesión (cuenta partner de
// Firebase = email de partner.config.js), nunca de un parámetro: así nadie
// puede ver la liquidación de otra empresa cambiando un ID.
// Solo se muestran liquidaciones aprobadas o pagadas (las calculadas todavía
// pueden cambiar) y nunca datos de otras empresas.
async function getPartnerSettlements(user) {
    const email = String(user?.email || "").trim().toLowerCase();
    if (user?.partner !== true || !email || user?.email_verified === false) {
        throw httpError(403, "Acceso solo para cuentas partner verificadas");
    }
    const partner = await Partner.findOne({ email }).lean();
    if (!partner) throw httpError(403, "Tu cuenta no está vinculada a ninguna empresa partner");

    const settlements = await PartnerPoolSettlement.find({
        partnerId: partner._id,
        status: { $in: ["APPROVED", "PAID"] },
    })
        .sort({ period: -1 })
        .limit(36)
        .lean();

    return plain({
        partner: { name: partner.name, code: partner.code },
        settlements: settlements.map((s) => ({
            settlementId: s.settlementId,
            period: s.period,
            status: s.status,
            formulaVersion: s.formulaVersion,
            referenceHours: s.referenceHours ?? null,
            courses: (s.courses || []).map((c) => ({
                title: c.title,
                courseVersion: c.courseVersion,
                approvedHours: c.approvedHours ?? null,
                weightPct: c.weightPct ?? null,
                baseScore: c.consumptionScore,
                weightedScore: c.weightedScore ?? c.consumptionScore,
                uniqueConsumers: c.uniqueConsumers,
                completions: c.completions,
            })),
            partnerBaseScore: s.partnerBaseScore ?? s.partnerScore,
            partnerWeightedScore: s.partnerScore,
            partnerShare: s.partnerShare,
            settlementAmount: s.settlementAmount,
            adjustments: (s.adjustments || []).map((a) => ({ type: a.type, amount: a.amount, reason: a.reason, createdAt: a.createdAt })),
            finalAmount: s.finalAmount,
            approvedAt: s.approvedAt,
            paidAt: s.paidAt,
        })),
    });
}

// ─── Lecturas ────────────────────────────────────────────────────────
async function listPeriods() {
    const [periods, totals] = await Promise.all([
        PartnerPoolPeriod.find({}).sort({ period: -1 }).limit(36).lean(),
        PartnerPoolSettlement.aggregate([
            { $match: { status: { $ne: "CANCELLED" } } },
            {
                $group: {
                    _id: "$period",
                    settlements: { $sum: 1 },
                    paid: { $sum: { $cond: [{ $eq: ["$status", "PAID"] }, 1, 0] } },
                    totalFinal: { $sum: "$finalAmount" },
                },
            },
        ]),
    ]);
    const byPeriod = new Map(totals.map((t) => [t._id, t]));
    return periods.map((p) => {
        const t = byPeriod.get(p.period);
        return plain({
            period: p.period,
            status: p.status,
            enabledPoolAmount: p.financials?.enabledPoolAmount ?? null,
            eligibleNetTrainingRevenue: p.financials?.eligibleNetTrainingRevenue ?? null,
            settlements: t?.settlements ?? 0,
            paid: t?.paid ?? 0,
            totalFinal: t?.totalFinal ?? null,
            calculatedAt: p.calculatedAt,
            needsRecalculation: p.needsRecalculation || null,
        });
    });
}

async function getPeriodDetail(periodInput) {
    const { period, from, to } = parsePeriod(periodInput);
    const [doc, settlements, auditLogs] = await Promise.all([
        PartnerPoolPeriod.findOne({ period }).lean(),
        PartnerPoolSettlement.find({ period }).sort({ finalAmount: -1 }).lean(),
        PartnerPoolAuditLog.find({ period }).sort({ occurredAt: -1 }).limit(100).lean(),
    ]);
    // Motivos por los que el panel no deja calcular / aprobar / cerrar (orden de meses)
    const status = doc?.status || "OPEN";
    const [calculateBlocked, approveBlocked, closeBlocked] = await Promise.all([
        ["OPEN", "CALCULATED"].includes(status) && to <= new Date()
            ? previousPeriodBlocker(period, from, "calculate").then((r) => r || laterPeriodBlocker(period))
            : null,
        status === "CALCULATED" ? previousPeriodBlocker(period, from, "approve") : null,
        status === "APPROVED" ? previousPeriodBlocker(period, from, "close") : null,
    ]);
    return plain({
        period: doc || { period, status: "OPEN", range: { from, to } },
        canCalculate: to <= new Date(),
        blockedReasons: {
            calculate: calculateBlocked || null,
            approve: approveBlocked || null,
            close: closeBlocked || null,
        },
        settlements,
        auditLogs,
    });
}

module.exports = {
    // flujo
    calculatePeriod,
    approvePeriod,
    closePeriod,
    reopenPeriod,
    addAdjustment,
    markPaid,
    cancelSettlement,
    // lecturas
    getPartnerSettlements,
    listPeriods,
    getPeriodDetail,
    getConfig,
    updateConfig,
    // puras (tests)
    computeConsumption,
    computeFinancials,
    computeDurationWeighting,
    parsePeriod,
    FORMULA_VERSION,
    plain,
};