const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");

const CourseDuration = require("../schemas/CourseDurationSchema");
const PartnerPoolAuditLog = require("../schemas/PartnerPoolAuditLogSchema");
const { STEP_TYPES, QUIZ_STEP_TYPES } = require("../constants/stepTypes");
const { httpError } = require("../utils/httpError");

// ══════════════════════════════════════════════════════════════════════
//  Duración formativa por versión de curso (Partner Pool V1.2)
//
//  Sin IA: la duración la ESTIMA el código a partir de lo que mide y la
//  APRUEBA Hidden desde el panel. Solo la duración aprobada entra al pool.
//
//  1. Al arrancar, cada versión ACTIVE queda registrada en courseDurations
//     y se mide en segundo plano (una sola vez por versión, nunca en cada
//     avance ni en cada liquidación).
//  2. Se mide: duración real de cada video (leyendo el archivo MP4), páginas
//     y palabras de cada PDF, y cantidad de preguntas de cada evaluación.
//     Los PDFs repetidos o casi iguales se marcan y NO suman horas.
//  3. Con eso se calcula una estimación con desglose (ESTIMATION_RULES).
//  4. Hidden la revisa: la aprueba tal cual, la modifica (con justificación),
//     la rechaza o hereda la de la versión anterior (con justificación).
//  5. Si el contenido cambia sin subir la versión (ej: se reemplaza un PDF),
//     la duración aprobada queda "en revisión" hasta volver a medir o confirmar.
// ══════════════════════════════════════════════════════════════════════

const Decimal128 = mongoose.Types.Decimal128;

// Reglas de la estimación. Se guardan copiadas en cada registro, así que
// cambiarlas nunca altera una estimación ya hecha.
const ESTIMATION_RULES = Object.freeze({
    readingWordsPerMinute: 150, // lectura de material técnico
    minMinutesPerPage: 1,       // piso por página/diapositiva (slides con poco texto)
    minutesPerQuestion: 1.5,    // resolver una pregunta de evaluación
    duplicateSimilarity: 0.9,   // desde este parecido un PDF se considera repetido
    minWordsForSimilarity: 40,  // con menos texto no se compara (slides de solo imágenes)
});

const STALE_MEASURING_MS = 15 * 60 * 1000; // una medición colgada se puede retomar
const MAX_HOURS = 2000;
const VIDEO_TIMEOUT_MS = 15000;
const VIDEO_HEAD_BYTES = 512 * 1024;
const VIDEO_TAIL_BYTES = 4 * 1024 * 1024;

const COURSE_ID_RE = /^[A-Za-z0-9_-]{1,80}$/;
const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;
const toDec = (n) => Decimal128.fromString(round2(n).toFixed(2));
const numOf = (d) => (d == null ? null : Number(d.toString()));
const sha256 = (data) => crypto.createHash("sha256").update(data).digest("hex");

// ─── Validación de parámetros (vienen de la URL) ─────────────────────
function parseKey(courseId, version) {
    const v = Number(version);
    if (typeof courseId !== "string" || !COURSE_ID_RE.test(courseId)) throw httpError(400, "Curso inválido");
    if (!Number.isInteger(v) || v < 1 || v > 100000) throw httpError(400, "Versión inválida");
    return { courseId, version: v };
}

function cleanText(value, max) {
    if (value == null) return "";
    if (typeof value !== "string") throw httpError(400, "El texto tiene que ser un string");
    return value.trim().slice(0, max);
}

// ─── Auditoría (misma colección inmutable que el pool) ───────────────
async function audit(action, admin, metadata) {
    try {
        await PartnerPoolAuditLog.create({
            action,
            adminUserId: admin?.uid || "system",
            adminEmail: admin?.email || null,
            metadata,
            occurredAt: new Date(),
        });
    } catch (err) {
        console.error("[courseDurations] no se pudo auditar:", err.message);
    }
}

const historyEntry = (action, admin, { hours = null, reason = null } = {}) => ({
    action,
    hours: hours == null ? null : toDec(hours),
    by: admin?.uid || "system",
    byEmail: admin?.email || null,
    at: new Date(),
    reason,
});

// ══════════════════════════════════════════════════════════════════════
//  HUELLA DEL CONTENIDO (barata: se calcula en cada arranque)
// ══════════════════════════════════════════════════════════════════════
async function contentHashOf(course) {
    const parts = [];
    for (const s of course.steps) {
        if (s.type === STEP_TYPES.CONTENT && s.file) {
            const abs = path.resolve(course.contentDir, s.file);
            if (!abs.startsWith(course.contentDir + path.sep)) throw new Error(`ruta inválida en ${s.stepId}`);
            parts.push([s.stepId, "pdf", sha256(await fs.promises.readFile(abs))]);
        } else if (s.type === STEP_TYPES.VIDEO) {
            parts.push([s.stepId, "video", s.url || "", s.durationMinutes ?? null]);
        } else if (QUIZ_STEP_TYPES.includes(s.type)) {
            const quiz = course.quizzes?.[s.quizId];
            parts.push([s.stepId, "quiz", sha256(JSON.stringify(quiz?.questions || []))]);
        }
    }
    return sha256(JSON.stringify(parts));
}

// ══════════════════════════════════════════════════════════════════════
//  MEDICIÓN
// ══════════════════════════════════════════════════════════════════════

// ── PDFs: páginas, palabras y texto normalizado ──────────────────────
// pdfjs-dist actual (no pdf-parse: trae un pdf.js viejo con una vulnerabilidad
// de ejecución de código al procesar PDFs maliciosos, CVE-2024-4367).
// isEvalSupported: false → nunca evalúa código armado a partir del PDF.
let pdfjs = null;
async function loadPdfjs() {
    if (pdfjs) return pdfjs;
    try {
        pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    } catch {
        throw new Error('Falta instalar la dependencia "pdfjs-dist" en el backend (npm i pdfjs-dist@4.10.38)');
    }
    return pdfjs;
}

const normalize = (text) =>
    String(text || "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .replace(/[^a-z0-9ñ]+/g, " ")
        .trim();

function shinglesOf(normalized) {
    const words = normalized.split(" ").filter(Boolean);
    const set = new Set();
    for (let i = 0; i + 5 <= words.length && set.size < 20000; i++) set.add(words.slice(i, i + 5).join(" "));
    return set;
}

function jaccard(a, b) {
    if (!a.size || !b.size) return 0;
    let inter = 0;
    const [small, big] = a.size < b.size ? [a, b] : [b, a];
    for (const x of small) if (big.has(x)) inter++;
    return inter / (a.size + b.size - inter);
}

async function measurePdf(absPath) {
    const lib = await loadPdfjs();
    const buffer = await fs.promises.readFile(absPath);
    const doc = await lib.getDocument({
        data: new Uint8Array(buffer),
        isEvalSupported: false,
        disableFontFace: true,
        useSystemFonts: false,
        verbosity: 0,
    }).promise;
    try {
        let text = "";
        for (let i = 1; i <= doc.numPages; i++) {
            const page = await doc.getPage(i);
            const content = await page.getTextContent();
            text += content.items.map((it) => it.str || "").join(" ") + "\n";
            page.cleanup();
        }
        const words = text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
        return { pages: doc.numPages, words, fileHash: sha256(buffer), normalized: normalize(text) };
    } finally {
        await doc.destroy();
    }
}

// ── Videos MP4: duración real leyendo la caja "mvhd" del archivo ─────
// Solo se piden unos KB con Range (no se descarga el video entero).
// Las URLs salen de course.config.js (las carga Hidden), igual se exige https.
async function fetchRange(url, start, end) {
    const res = await fetch(url, {
        headers: { Range: `bytes=${start}-${end}` },
        redirect: "follow",
        signal: AbortSignal.timeout(VIDEO_TIMEOUT_MS),
    });
    if (!res.url.startsWith("https://")) throw new Error("el video redirige a una URL que no es https");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    // Si el servidor ignora Range, se corta igual al llegar al límite
    const limit = end - start + 1;
    const chunks = [];
    let received = 0;
    const reader = res.body.getReader();
    while (received < limit) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;
    }
    try { await reader.cancel(); } catch { /* ya terminó */ }

    const range = /\/(\d+)$/.exec(res.headers.get("content-range") || "");
    const total = range ? Number(range[1]) : Number(res.headers.get("content-length")) || null;
    return { buf: Buffer.concat(chunks).subarray(0, limit), total, partial: res.status === 206 };
}

function readMvhd(buf) {
    let from = 0;
    while (true) {
        const i = buf.indexOf("mvhd", from, "latin1");
        if (i < 0) return null;
        from = i + 4;
        const version = buf[i + 4];
        let timescale;
        let duration;
        if (version === 0 && i + 24 <= buf.length) {
            timescale = buf.readUInt32BE(i + 16);
            duration = buf.readUInt32BE(i + 20);
        } else if (version === 1 && i + 36 <= buf.length) {
            timescale = buf.readUInt32BE(i + 24);
            duration = Number(buf.readBigUInt64BE(i + 28));
        } else {
            continue;
        }
        const seconds = timescale > 0 ? duration / timescale : 0;
        if (seconds >= 1 && seconds <= 24 * 3600) return seconds;
    }
}

async function measureVideo(step) {
    const declared = Number(step.durationMinutes);
    const fallback = (note) =>
        Number.isFinite(declared) && declared > 0
            ? { seconds: declared * 60, source: "DECLARED", note: `${note} · se usa la duración declarada en course.config.js` }
            : { seconds: null, source: "UNKNOWN", note: `${note} · sin duración: cargala en course.config.js (durationMinutes) o corregí las horas al aprobar` };

    if (!step.url || !step.url.startsWith("https://")) return fallback("URL inválida");
    try {
        const head = await fetchRange(step.url, 0, VIDEO_HEAD_BYTES - 1);
        let seconds = readMvhd(head.buf);
        if (seconds == null && head.partial && head.total && head.total > VIDEO_HEAD_BYTES) {
            const start = Math.max(0, head.total - VIDEO_TAIL_BYTES);
            const tail = await fetchRange(step.url, start, head.total - 1);
            seconds = readMvhd(tail.buf);
        }
        if (seconds == null) return fallback("No se pudo leer la duración (¿no es MP4?)");
        return { seconds: Math.round(seconds), source: "MEASURED", note: null };
    } catch (err) {
        console.error(`[courseDurations] no se pudo medir el video ${step.stepId}:`, err.message);
        return fallback("No se pudo acceder al video");
    }
}

// ── Curso completo ───────────────────────────────────────────────────
async function measureCourse(course) {
    const R = ESTIMATION_RULES;
    const documents = [];
    const docInfo = []; // para comparar repetidos
    const videos = [];
    const quizzes = [];
    const warnings = [];

    for (const s of course.steps) {
        if (s.type === STEP_TYPES.CONTENT && s.file) {
            const abs = path.resolve(course.contentDir, s.file);
            if (!abs.startsWith(course.contentDir + path.sep)) throw new Error(`ruta inválida en ${s.stepId}`);
            const m = await measurePdf(abs);
            const shingles = m.words >= R.minWordsForSimilarity ? shinglesOf(m.normalized) : null;

            let duplicateOf = null;
            let similarity = null;
            for (const prev of docInfo) {
                let sim = 0;
                if (prev.fileHash === m.fileHash) sim = 1;
                else if (shingles && prev.shingles) sim = prev.normalized === m.normalized ? 1 : jaccard(shingles, prev.shingles);
                if (sim >= R.duplicateSimilarity) {
                    duplicateOf = prev.stepId;
                    similarity = Math.round(sim * 1000) / 1000;
                    break;
                }
            }
            docInfo.push({ stepId: s.stepId, fileHash: m.fileHash, normalized: m.normalized, shingles });

            const note =
                m.words < R.minWordsForSimilarity
                    ? "Casi sin texto (¿imágenes?): se estima por páginas y no se pudo comparar contra repetidos"
                    : null;
            documents.push({ stepId: s.stepId, title: s.title, pages: m.pages, words: m.words, duplicateOf, similarity, note });
        } else if (s.type === STEP_TYPES.VIDEO) {
            videos.push({ stepId: s.stepId, title: s.title, ...(await measureVideo(s)) });
        } else if (QUIZ_STEP_TYPES.includes(s.type)) {
            const quiz = course.quizzes?.[s.quizId];
            quizzes.push({ stepId: s.stepId, title: s.title, questions: quiz?.questions?.length || 0 });
        }
    }

    for (const v of videos) if (v.source !== "MEASURED") warnings.push(`Video "${v.title}": ${v.note}`);
    const imageOnly = documents.filter((d) => d.note).length;
    if (imageOnly) warnings.push(`${imageOnly} PDF(s) casi sin texto: revisá que la estimación por páginas sea razonable`);
    const duplicates = documents.filter((d) => d.duplicateOf).length;
    if (duplicates) warnings.push(`${duplicates} PDF(s) repetidos o casi iguales a otro: no suman horas`);

    return {
        videos,
        documents,
        quizzes,
        totals: {
            videoSeconds: videos.reduce((acc, v) => acc + (v.seconds || 0), 0),
            pages: documents.reduce((acc, d) => acc + d.pages, 0),
            words: documents.reduce((acc, d) => acc + d.words, 0),
            questions: quizzes.reduce((acc, q) => acc + q.questions, 0),
            duplicates,
        },
        warnings,
        measuredAt: new Date(),
    };
}

// ══════════════════════════════════════════════════════════════════════
//  ESTIMACIÓN (función pura: misma medición → mismas horas)
// ══════════════════════════════════════════════════════════════════════
function estimateFromMeasurement(measured, rules = ESTIMATION_RULES) {
    const videoHours = measured.videos.reduce((acc, v) => acc + (v.seconds || 0), 0) / 3600;

    const counted = measured.documents.filter((d) => !d.duplicateOf);
    const readingMinutes = counted.reduce(
        (acc, d) => acc + Math.max(d.words / rules.readingWordsPerMinute, d.pages * rules.minMinutesPerPage),
        0
    );
    const readingHours = readingMinutes / 60;

    const questions = measured.quizzes.reduce((acc, q) => acc + q.questions, 0);
    const assessmentHours = (questions * rules.minutesPerQuestion) / 60;

    const practiceHours = 0; // V1.2: los cursos todavía no tienen steps de práctica o laboratorio

    const totalHours = videoHours + readingHours + assessmentHours + practiceHours;
    const skipped = measured.documents.length - counted.length;

    return {
        videoHours: round2(videoHours),
        readingHours: round2(readingHours),
        assessmentHours: round2(assessmentHours),
        practiceHours,
        totalHours: round2(totalHours),
        rules: { ...rules },
        explanation: [
            `Videos: ${measured.videos.length} video(s), ${Math.round(videoHours * 60)} min de reproducción.`,
            `Lectura: ${counted.length} PDF(s), ${counted.reduce((a, d) => a + d.pages, 0)} páginas y ` +
                `${counted.reduce((a, d) => a + d.words, 0).toLocaleString("es-AR")} palabras; por cada PDF se toma lo mayor entre ` +
                `palabras ÷ ${rules.readingWordsPerMinute} por minuto y ${rules.minMinutesPerPage} min por página` +
                (skipped ? ` (${skipped} PDF repetido(s) no se cuentan).` : "."),
            `Evaluaciones: ${questions} pregunta(s) × ${String(rules.minutesPerQuestion).replace(".", ",")} min.`,
            "Prácticas y laboratorios: 0 h (todavía no hay steps de este tipo).",
            "Los módulos no multiplican nada: solo cuenta el tiempo de aprendizaje de cada material.",
        ],
        estimatedAt: new Date(),
    };
}

// ══════════════════════════════════════════════════════════════════════
//  CURSOS PUBLICABLES (un curso nuevo no se muestra sin duración aprobada)
// ══════════════════════════════════════════════════════════════════════
const PUBLISHABLE_TTL_MS = 60 * 1000;
let publishable = null; // Set de courseIds con al menos una versión aprobada
let publishableAt = 0;
let refreshing = null;

async function refreshPublishable() {
    if (refreshing) return refreshing;
    refreshing = (async () => {
        try {
            const ids = await CourseDuration.distinct("courseId", { "approved.hours": { $ne: null } });
            publishable = new Set(ids);
            publishableAt = Date.now();
        } catch (err) {
            console.error("[courseDurations] no se pudo actualizar la lista de cursos publicables:", err.message);
        } finally {
            refreshing = null;
        }
    })();
    return refreshing;
}

// Sincrónico (para el catálogo). Si la lista está vieja la refresca en segundo plano.
function isPublishable(courseId) {
    if (!publishable || Date.now() - publishableAt > PUBLISHABLE_TTL_MS) refreshPublishable();
    return !!publishable && publishable.has(courseId);
}

// ══════════════════════════════════════════════════════════════════════
//  FLUJO
// ══════════════════════════════════════════════════════════════════════

// Medición en segundo plano, de a una por vez (no sobrecarga el server al arrancar)
let queue = Promise.resolve();
const coursesInMemory = new Map(); // "courseId|version" → curso del registro (para re-medir)
const memKey = (courseId, version) => `${courseId}|${version}`;

function scheduleMeasurement(course, admin = null) {
    queue = queue.then(() => runMeasurement(course, admin)).catch(() => {});
    return queue;
}

// Se llama desde el registro al arrancar, por cada versión ACTIVE
async function registerVersion(course) {
    coursesInMemory.set(memKey(course.courseId, course.version), course);
    const currentHash = await contentHashOf(course);

    const doc = await CourseDuration.findOneAndUpdate(
        { courseId: course.courseId, version: course.version },
        {
            $setOnInsert: {
                partnerId: course.partnerId,
                partnerSlug: course.partnerSlug,
                status: "PENDING_MEASUREMENT",
                history: [historyEntry("REGISTERED", null)],
            },
            $set: { title: course.title, currentContentHash: currentHash },
        },
        { upsert: true, returnDocument: "after" }
    ).lean();

    // El contenido cambió sin subir la versión → la duración queda en revisión
    if (doc.contentHash && doc.contentHash !== currentHash && !doc.contentChanged) {
        await CourseDuration.updateOne(
            { _id: doc._id, contentChanged: false },
            {
                $set: { contentChanged: true },
                $push: {
                    history: historyEntry("CONTENT_CHANGED", null, {
                        reason: "Cambió el contenido (PDFs, videos o preguntas) sin subir la versión",
                    }),
                },
            }
        );
        await audit("DURATION_CONTENT_CHANGED", null, { courseId: course.courseId, version: course.version });
        console.warn(
            `[courseDurations] ${course.courseId} v${course.version}: el contenido cambió sin subir la versión. ` +
                "La duración aprobada queda en revisión."
        );
    } else if (doc.contentHash && doc.contentHash === currentHash && doc.contentChanged) {
        // Volvieron a poner el contenido original
        await CourseDuration.updateOne({ _id: doc._id }, { $set: { contentChanged: false } });
    }

    const stale = doc.status === "MEASURING" && Date.now() - new Date(doc.measurementStartedAt || 0).getTime() > STALE_MEASURING_MS;
    if (doc.status === "PENDING_MEASUREMENT" || stale) scheduleMeasurement(course);
}

async function runMeasurement(course, admin = null) {
    const key = { courseId: course.courseId, version: course.version };
    const staleBefore = new Date(Date.now() - STALE_MEASURING_MS);

    // Bloqueo atómico: una sola medición a la vez por versión (aunque haya varios servers)
    const locked = await CourseDuration.findOneAndUpdate(
        {
            ...key,
            $or: [
                { status: { $in: ["PENDING_MEASUREMENT", "PENDING_REVIEW", "REJECTED", "MEASUREMENT_FAILED"] } },
                { status: "APPROVED", contentChanged: true },
                { status: "MEASURING", measurementStartedAt: { $lt: staleBefore } },
            ],
        },
        { $set: { status: "MEASURING", measurementStartedAt: new Date() }, $inc: { measurementAttempts: 1 } },
        { returnDocument: "before" }
    ).lean();
    if (!locked) return null;

    try {
        const contentHash = await contentHashOf(course);
        const measured = await measureCourse(course);
        const estimate = estimateFromMeasurement(measured);

        await CourseDuration.updateOne(
            key,
            {
                $set: {
                    status: "PENDING_REVIEW",
                    measured,
                    estimate,
                    contentHash,
                    currentContentHash: contentHash,
                    contentChanged: false,
                    measurementError: null,
                },
                $push: { history: historyEntry("MEASURED", admin, { hours: estimate.totalHours }) },
            }
        );
        await audit("DURATION_MEASURED", admin, { ...key, estimatedHours: estimate.totalHours });
        console.log(`[courseDurations] ${key.courseId} v${key.version} medido: ${estimate.totalHours} h estimadas (falta aprobar)`);
        return estimate;
    } catch (err) {
        console.error(`[courseDurations] falló la medición de ${key.courseId} v${key.version}:`, err);
        const msg = /pdfjs-dist/.test(err.message) ? err.message : "No se pudo medir el contenido del curso. Revisá el log del servidor.";
        await CourseDuration.updateOne(
            key,
            {
                $set: { status: "MEASUREMENT_FAILED", measurementError: msg },
                $push: { history: historyEntry("MEASUREMENT_FAILED", admin, { reason: msg }) },
            }
        );
        return null;
    }
}

// ── Acciones del admin ───────────────────────────────────────────────
async function findOrFail(courseId, version) {
    const doc = await CourseDuration.findOne({ courseId, version }).lean();
    if (!doc) throw httpError(404, "No hay registro de duración para esa versión");
    return doc;
}

async function requestMeasurement(courseIdIn, versionIn, admin) {
    const { courseId, version } = parseKey(courseIdIn, versionIn);
    const doc = await findOrFail(courseId, version);
    const course = coursesInMemory.get(memKey(courseId, version));
    if (!course) throw httpError(409, "Esa versión no está cargada en el servidor (solo se mide la versión publicada)");
    if (doc.status === "MEASURING") throw httpError(409, "La medición ya está en curso");
    if (doc.status === "APPROVED" && !doc.contentChanged) {
        throw httpError(409, "La duración ya está aprobada y el contenido no cambió");
    }

    await CourseDuration.updateOne(
        { _id: doc._id },
        { $push: { history: historyEntry("MEASUREMENT_REQUESTED", admin) } }
    );
    await audit("DURATION_MEASUREMENT_REQUESTED", admin, { courseId, version });
    scheduleMeasurement(course, admin);
    return getDetail(courseId, version);
}

function parseHours(value) {
    const h = Number(value);
    if (!Number.isFinite(h) || h < 0.25 || h > MAX_HOURS) {
        throw httpError(400, `Las horas tienen que estar entre 0,25 y ${MAX_HOURS}`);
    }
    return round2(h);
}

async function approve(courseIdIn, versionIn, body, admin) {
    const { courseId, version } = parseKey(courseIdIn, versionIn);
    const doc = await findOrFail(courseId, version);

    if (doc.status === "MEASURING") throw httpError(409, "Esperá a que termine la medición");
    if (doc.contentChanged) {
        throw httpError(409, "El contenido cambió sin subir la versión: volvé a medir o confirmá que la duración sigue valiendo");
    }

    const estimateHours = doc.estimate?.totalHours ?? null;
    const hours = body?.hours === undefined || body?.hours === null || body?.hours === ""
        ? (estimateHours != null ? parseHours(estimateHours) : null)
        : parseHours(body.hours);
    if (hours == null) throw httpError(400, "No hay estimación: indicá las horas a mano");

    const justification = cleanText(body?.justification, 1000);
    const differs = estimateHours == null || Math.abs(hours - estimateHours) > 0.005;
    if (differs && justification.length < 10) {
        throw httpError(400, "Si las horas difieren de la estimación, escribí una justificación (mínimo 10 caracteres)");
    }
    const source = differs ? "MODIFIED" : "ESTIMATE";
    const previous = numOf(doc.approved?.hours);

    const updated = await CourseDuration.findOneAndUpdate(
        { _id: doc._id, status: doc.status, contentChanged: false },
        {
            $set: {
                status: "APPROVED",
                approved: {
                    hours: toDec(hours),
                    source,
                    justification: justification || null,
                    approvedBy: admin.uid,
                    approvedByEmail: admin.email || null,
                    approvedAt: new Date(),
                },
            },
            $push: { history: historyEntry("APPROVED", admin, { hours, reason: justification || null }) },
        },
        { returnDocument: "after" }
    ).lean();
    if (!updated) throw httpError(409, "La duración cambió mientras se aprobaba, probá de nuevo");

    await audit("DURATION_APPROVED", admin, { courseId, version, hours, previousHours: previous, estimateHours, source, justification });
    await refreshPublishable();
    return getDetail(courseId, version);
}

async function reject(courseIdIn, versionIn, reasonIn, admin) {
    const { courseId, version } = parseKey(courseIdIn, versionIn);
    const reason = cleanText(reasonIn, 1000);
    if (reason.length < 5) throw httpError(400, "Indicá el motivo del rechazo");
    const doc = await findOrFail(courseId, version);
    if (!["PENDING_REVIEW", "MEASUREMENT_FAILED"].includes(doc.status)) {
        throw httpError(409, "Solo se rechaza una estimación pendiente de revisión");
    }
    const updated = await CourseDuration.findOneAndUpdate(
        { _id: doc._id, status: doc.status },
        { $set: { status: "REJECTED" }, $push: { history: historyEntry("REJECTED", admin, { reason }) } },
        { returnDocument: "after" }
    ).lean();
    if (!updated) throw httpError(409, "La duración cambió mientras se rechazaba, probá de nuevo");
    await audit("DURATION_REJECTED", admin, { courseId, version, reason });
    return getDetail(courseId, version);
}

async function inheritPrevious(courseIdIn, versionIn, reasonIn, admin) {
    const { courseId, version } = parseKey(courseIdIn, versionIn);
    const reason = cleanText(reasonIn, 1000);
    if (reason.length < 10) throw httpError(400, "Explicá por qué la duración no cambió (mínimo 10 caracteres)");

    const doc = await findOrFail(courseId, version);
    if (doc.status === "MEASURING") throw httpError(409, "Esperá a que termine la medición");
    const prev = await CourseDuration.findOne({ courseId, version: { $lt: version }, "approved.hours": { $ne: null } })
        .sort({ version: -1 })
        .lean();
    if (!prev) throw httpError(409, "No hay una versión anterior con duración aprobada");
    const hours = numOf(prev.approved.hours);

    const updated = await CourseDuration.findOneAndUpdate(
        { _id: doc._id, status: doc.status },
        {
            $set: {
                status: "APPROVED",
                contentChanged: false,
                contentHash: doc.currentContentHash || doc.contentHash,
                approved: {
                    hours: toDec(hours),
                    source: "INHERITED",
                    justification: `Heredada de v${prev.version}: ${reason}`,
                    approvedBy: admin.uid,
                    approvedByEmail: admin.email || null,
                    approvedAt: new Date(),
                },
            },
            $push: { history: historyEntry("INHERITED", admin, { hours, reason: `v${prev.version}: ${reason}` }) },
        },
        { returnDocument: "after" }
    ).lean();
    if (!updated) throw httpError(409, "La duración cambió mientras se heredaba, probá de nuevo");

    await audit("DURATION_INHERITED", admin, { courseId, version, fromVersion: prev.version, hours, reason });
    await refreshPublishable();
    return getDetail(courseId, version);
}

async function confirmContent(courseIdIn, versionIn, reasonIn, admin) {
    const { courseId, version } = parseKey(courseIdIn, versionIn);
    const reason = cleanText(reasonIn, 1000);
    if (reason.length < 10) throw httpError(400, "Explicá por qué la duración sigue valiendo (mínimo 10 caracteres)");
    const doc = await findOrFail(courseId, version);
    if (!doc.contentChanged) throw httpError(409, "El contenido no cambió");

    const updated = await CourseDuration.findOneAndUpdate(
        { _id: doc._id, contentChanged: true, currentContentHash: doc.currentContentHash },
        {
            $set: { contentChanged: false, contentHash: doc.currentContentHash },
            $push: { history: historyEntry("CONTENT_CONFIRMED", admin, { hours: numOf(doc.approved?.hours), reason }) },
        },
        { returnDocument: "after" }
    ).lean();
    if (!updated) throw httpError(409, "La duración cambió mientras se confirmaba, probá de nuevo");
    await audit("DURATION_CONTENT_CONFIRMED", admin, { courseId, version, reason });
    return getDetail(courseId, version);
}

// ── Lecturas ─────────────────────────────────────────────────────────
const serialize = (d) => ({
    ...d,
    _id: String(d._id),
    partnerId: String(d.partnerId),
    approved: { ...(d.approved || {}), hours: numOf(d.approved?.hours) },
    history: (d.history || []).map((h) => ({ ...h, hours: numOf(h.hours) })).reverse(),
});

async function list() {
    const docs = await CourseDuration.find({})
        .select("-measured.documents -measured.videos -measured.quizzes -history -estimate.rules")
        .sort({ updatedAt: -1 })
        .limit(500)
        .lean();
    return docs.map((d) => ({
        ...serialize({ ...d, history: [] }),
        isPublished: coursesInMemory.has(memKey(d.courseId, d.version)),
    }));
}

async function getDetail(courseIdIn, versionIn) {
    const { courseId, version } = parseKey(courseIdIn, versionIn);
    const doc = await findOrFail(courseId, version);
    return { ...serialize(doc), isPublished: coursesInMemory.has(memKey(courseId, version)) };
}

// ── Para el Partner Pool ─────────────────────────────────────────────
// Devuelve, por "courseId|version", la duración usable en un cálculo:
// solo cuenta si está APROBADA y el contenido no cambió desde la aprobación.
async function getDurationsFor(pairs) {
    if (!pairs.length) return new Map();
    const docs = await CourseDuration.find({ $or: pairs.map((p) => ({ courseId: p.courseId, version: p.version })) })
        .select("courseId version status contentChanged approved")
        .lean();
    return new Map(
        docs.map((d) => [
            `${d.courseId}|${d.version}`,
            {
                recordId: String(d._id),
                status: d.status,
                contentChanged: !!d.contentChanged,
                hours: d.status === "APPROVED" && !d.contentChanged ? numOf(d.approved?.hours) : null,
                approvedAt: d.approved?.approvedAt || null,
            },
        ])
    );
}

module.exports = {
    ESTIMATION_RULES,
    // registro
    registerVersion,
    refreshPublishable,
    isPublishable,
    // admin
    list,
    getDetail,
    requestMeasurement,
    approve,
    reject,
    inheritPrevious,
    confirmContent,
    // pool
    getDurationsFor,
    // puras / tests
    estimateFromMeasurement,
    readMvhd,
    jaccard,
    shinglesOf,
    normalize,
    measureCourse,
    contentHashOf,
};