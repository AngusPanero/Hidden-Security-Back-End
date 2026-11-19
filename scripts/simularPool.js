/**
 * scripts/simularPool.js — Simulación del Partner Pool V1.2 (SOLO DEV)
 *
 * Carga alumnos falsos con pagos y avances en los 4 cursos de prueba
 * (ciberprisma, ciberprisma2, ciberprisma3, ciberprisma4) para probar el
 * cálculo del pool sin crear cuentas ni hacer los cursos a mano.
 * Después compara lo que calculó el panel con lo que debería dar.
 *
 * Qué toca en la base (y nada más):
 *   - courseProgressEvents: eventos con userId "sim-pool-…"
 *   - la colección de pagos: pagos con client_id "sim-pool-…" y simulation: true
 * No crea cuentas en Firebase, ni CVs, ni certificados, ni progreso del alumno.
 *
 * Meses que usa (tienen que estar cerrados, el pool no calcula el mes en curso):
 *   - MES B (--mes, por defecto el mes pasado): el grueso de la simulación.
 *   - MES A (el anterior a B): pocos avances, para probar la habilitación
 *     parcial del fondo y el tope de 1 punto entre períodos.
 *
 * Uso (desde la carpeta del back):
 *   node scripts/simularPool.js cargar                 → muestra qué va a cargar
 *   node scripts/simularPool.js cargar --confirmar     → lo carga
 *   (en el panel: LIQUIDACIONES → calcular MES A y después MES B)
 *   node scripts/simularPool.js verificar              → compara esperado vs calculado
 *   node scripts/simularPool.js limpiar                → muestra qué va a borrar
 *   node scripts/simularPool.js limpiar --confirmar    → borra lo simulado
 *   node scripts/simularPool.js limpiar --confirmar --periodos
 *        → además borra los períodos y liquidaciones de MES A y MES B
 *
 * Opciones: --mes=AAAA-MM   --semilla=2026 (misma semilla = mismos alumnos)
 */

require("dotenv").config();
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");

const ROOT = path.join(__dirname, "..");
const CORE = path.join(ROOT, "externalCourses", "_core");

const CourseVersion = require(path.join(CORE, "schemas", "CourseVersionSchema"));
const Partner = require(path.join(CORE, "schemas", "PartnerSchema"));
const CourseDuration = require(path.join(CORE, "schemas", "CourseDurationSchema"));
const CourseProgressEvent = require(path.join(CORE, "schemas", "CourseProgressEventSchema"));
const PartnerPoolConsumption = require(path.join(CORE, "schemas", "PartnerPoolConsumptionSchema"));
const PartnerPoolPeriod = require(path.join(CORE, "schemas", "PartnerPoolPeriodSchema"));
const PartnerPoolSettlement = require(path.join(CORE, "schemas", "PartnerPoolSettlementSchema"));
const Payments = require(path.join(ROOT, "models", "Payments"));

// ─── Configuración de la simulación ──────────────────────────────────────────
const PARTNER_SLUGS = ["ciberprisma", "ciberprisma2", "ciberprisma3", "ciberprisma4"];
const POPULARITY = [0.4, 0.25, 0.2, 0.15]; // para que cada empresa tenga distinta participación
const TOTAL_STUDENTS = 300;
const COMPLETED_STUDENTS = 200;   // terminan su curso principal
const MULTI_COURSE_STUDENTS = 100; // hacen más de un curso
const INCOMPLETE_STAGES = [0, 0.1, 0.25, 0.5, 0.75, 0.9, "ALL_BUT_LAST"]; // 0 = solo empezó
const COUPON_RATE = 0.2;          // % de los alumnos con cupón del 20%
const SIM = "sim-pool-";
const SIM_RE = /^sim-pool-/;
const AR_OFFSET_HOURS = 3;
const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

// ─── CLI ─────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const command = args[0];
const flag = (name) => args.includes(`--${name}`);
const option = (name) => {
    const a = args.find((x) => x.startsWith(`--${name}=`));
    return a ? a.slice(name.length + 3) : null;
};
const CONFIRM = flag("confirmar");
const SEED = Number(option("semilla") || 2026);

// ─── Utilidades ──────────────────────────────────────────────────────────────
function periodRange(period) {
    const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(String(period || ""));
    if (!m) throw new Error(`Mes inválido "${period}" (formato AAAA-MM)`);
    const y = Number(m[1]);
    const mo = Number(m[2]);
    return {
        period: `${m[1]}-${m[2]}`,
        from: new Date(Date.UTC(y, mo - 1, 1, AR_OFFSET_HOURS)),
        to: new Date(Date.UTC(y, mo, 1, AR_OFFSET_HOURS)),
    };
}
function shiftPeriod(period, delta) {
    const [y, m] = period.split("-").map(Number);
    const d = new Date(Date.UTC(y, m - 1 + delta, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
function lastClosedPeriod() {
    const now = new Date(Date.now() - AR_OFFSET_HOURS * HOUR); // hora argentina
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
function addMonths(date, months) {
    const d = new Date(date);
    d.setMonth(d.getMonth() + months);
    return d;
}
const num = (v) => (v == null ? null : Number(v.toString()));
const fmt = (n, d = 4) => (n == null || Number.isNaN(n) ? "—" : Number(n).toFixed(d));
const money = (n) => (n == null ? "—" : `$${Number(n).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;
const courseKey = (courseId, version) => `${courseId}|${version}`;
const userKey = (userId, courseId, version) => `${userId}|${courseId}|${version}`;

// PRNG con semilla: misma semilla → mismos alumnos y fechas
function makeRandom(seed) {
    let a = seed >>> 0;
    const next = () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    return {
        next,
        int: (min, max) => min + Math.floor(next() * (max - min + 1)),
        pick: (list) => list[Math.floor(next() * list.length)],
        weighted: (list, weights) => {
            const r = next() * weights.reduce((s, w) => s + w, 0);
            let acc = 0;
            for (let i = 0; i < list.length; i++) {
                acc += weights[i];
                if (r < acc) return list[i];
            }
            return list[list.length - 1];
        },
        shuffle: (list) => {
            const out = [...list];
            for (let i = out.length - 1; i > 0; i--) {
                const j = Math.floor(next() * (i + 1));
                [out[i], out[j]] = [out[j], out[i]];
            }
            return out;
        },
    };
}

// n fechas ordenadas al azar dentro de [from, to), con 1 h de margen
function randomTimes(rnd, n, from, to) {
    const a = from.getTime() + HOUR;
    const b = to.getTime() - HOUR;
    if (b <= a) throw new Error("Ventana de fechas vacía");
    return Array.from({ length: n }, () => a + rnd.next() * (b - a))
        .sort((x, y) => x - y)
        .map((t) => new Date(t));
}

async function connect() {
    if (process.env.NODE_ENV === "production") {
        throw new Error("NODE_ENV=production: este script es solo para dev.");
    }
    const uri = process.env.MONGO_URI || process.env.MONGODB_URI || process.env.DB_URI;
    if (!uri) throw new Error("Falta MONGO_URI en el .env");
    await mongoose.connect(uri);
    console.log(`Base: ${mongoose.connection.name}\n`);
}

// Última versión registrada de cada curso de prueba
async function loadCourses() {
    const courses = [];
    for (const slug of PARTNER_SLUGS) {
        const v = await CourseVersion.findOne({ partnerSlug: slug }).sort({ version: -1 }).lean();
        if (!v) throw new Error(`No hay versión registrada para "${slug}": reiniciá el back para que la registre.`);
        const eligibleSteps = v.steps
            .filter((s) => s.progressEligible)
            .sort((a, b) => a.stepIndex - b.stepIndex);
        if (!eligibleSteps.length) throw new Error(`${v.courseId} v${v.version} no tiene pasos que sumen al pool`);
        courses.push({ slug, version: v, eligibleSteps });
    }
    return courses;
}

// ═════════════════════════════════════════════════════════════════════════════
//  GENERACIÓN
// ═════════════════════════════════════════════════════════════════════════════
function buildSimulation({ courses, A, B, prices, durations, rnd }) {
    const events = [];
    const payments = [];
    const students = []; // resumen para mostrar

    const event = (userId, course, eventType, at, { step = null, meta = {}, dedupe = true } = {}) => {
        const v = course.version;
        const doc = {
            eventId: crypto.randomUUID(),
            userId,
            courseId: v.courseId,
            courseVersion: v.version,
            partnerId: v.partnerId,
            eventType,
            stepId: step ? step.stepId : null,
            stepIndex: step ? step.stepIndex : null,
            moduleId: step ? step.moduleId : null,
            metadata: {
                accessType: "PAID_PLAN",
                role: "student",
                partnerPoolEligible: true,
                partnerBanned: false,
                plan: "starter",
                simulation: true,
                ...meta,
            },
            occurredAt: at,
            createdAt: new Date(),
        };
        if (dedupe) doc.dedupeKey = `sim:${doc.eventId}`;
        events.push(doc);
    };

    // Un recorrido: COURSE_STARTED (opcional) + los primeros N pasos + COURSE_COMPLETED (opcional)
    const run = (userId, course, { steps, completed, from, to, started = true, meta = {}, duplicateSteps = false }) => {
        const list = course.eligibleSteps.slice(0, steps);
        const times = randomTimes(rnd, list.length * (duplicateSteps ? 2 : 1) + 2, from, to);
        let t = 0;
        if (started) event(userId, course, "COURSE_STARTED", times[t++], { meta });
        for (const s of list) {
            event(userId, course, "STEP_COMPLETED", times[t++], { step: s, meta });
            if (duplicateSteps) event(userId, course, "STEP_COMPLETED", times[t++], { step: s, meta, dedupe: false });
        }
        if (completed) event(userId, course, "COURSE_COMPLETED", times[t++], { meta });
    };

    const stageSteps = (course, stage) =>
        stage === "ALL_BUT_LAST" ? course.eligibleSteps.length - 1 : Math.round(stage * course.eligibleSteps.length);

    const payment = (userId, { plan = "starter", items = null, amount = null, coupon = 0, start, months = null, isTest = false, simCase }) => {
        const list = items || [plan];
        const listPrice = list.reduce((s, i) => s + (Number(prices[i]) || 0), 0);
        const end = addMonths(start, months ?? (durations[plan] || 3));
        payments.push({
            orderId: `SIMPOOL-${crypto.randomBytes(6).toString("hex")}`,
            client_id: userId,
            email: `${userId}@sim.local`,
            nombre: `Alumno simulado ${userId.slice(SIM.length)}`,
            plan: list.join("+"),
            items: list,
            amount: amount ?? Math.round(listPrice * (1 - coupon)),
            listAmount: listPrice,
            status: "approved",
            fulfillment: "done",
            isTest,
            couponUsed: coupon > 0 ? `SIMPOOL${Math.round(coupon * 100)}` : null,
            discount: coupon > 0 ? Math.round(coupon * 100) : 0,
            date: start,
            fulfilledAt: start,
            expiresAt: end,
            simulation: true,
            simCase,
        });
        return { start, end };
    };

    const clamp = (w) => ({ from: new Date(Math.max(w.from, B.from)), to: new Date(Math.min(w.to, B.to)) });

    // ── 300 alumnos ─────────────────────────────────────────────────────────
    const multi = new Set([
        ...rnd.shuffle([...Array(COMPLETED_STUDENTS).keys()]).slice(0, MULTI_COURSE_STUDENTS / 2),
        ...rnd
            .shuffle([...Array(TOTAL_STUDENTS - COMPLETED_STUDENTS).keys()].map((i) => i + COMPLETED_STUDENTS))
            .slice(0, MULTI_COURSE_STUDENTS / 2),
    ]);

    for (let i = 0; i < TOTAL_STUDENTS; i++) {
        const userId = `${SIM}a${String(i + 1).padStart(3, "0")}`;
        const plan = rnd.weighted(["starter", "pro", "elite"], [0.7, 0.2, 0.1]);
        const coupon = rnd.next() < COUPON_RATE ? 0.2 : 0;
        // El plan arranca entre ~25 días antes del MES A y el día 12 del MES B
        const start = new Date(A.from.getTime() - 25 * DAY + rnd.next() * (B.from - A.from + 37 * DAY));
        const simCase = coupon ? `normal-cupon20-${plan}` : `normal-${plan}`;
        const w = payment(userId, { plan, coupon, start, simCase });
        const window = clamp({ from: w.start, to: w.end });
        const meta = { plan, simCase };

        const main = rnd.weighted(courses, POPULARITY);
        const completed = i < COMPLETED_STUDENTS;
        const stage = completed ? 1 : INCOMPLETE_STAGES[(i - COMPLETED_STUDENTS) % INCOMPLETE_STAGES.length];
        run(userId, main, {
            steps: completed ? main.eligibleSteps.length : stageSteps(main, stage),
            completed,
            ...window,
            meta,
        });
        const taken = [{ course: main.slug, completed, stage }];

        if (multi.has(i)) {
            const extra = rnd.shuffle(courses.filter((c) => c !== main)).slice(0, rnd.int(1, 3));
            for (const c of extra) {
                const done = rnd.next() < 0.5;
                const st = done ? 1 : rnd.pick(INCOMPLETE_STAGES);
                run(userId, c, { steps: done ? c.eligibleSteps.length : stageSteps(c, st), completed: done, ...window, meta });
                taken.push({ course: c.slug, completed: done, stage: st });
            }
        }
        students.push({ userId, plan, coupon, taken });
    }

    // ── Casos especiales (además de los 300) ─────────────────────────────────
    const special = [];
    const caseUser = (name, n) => `${SIM}caso-${name}-${n}`;
    const anyCourse = () => rnd.pick(courses);
    const fullPlan = (userId, simCase, extra = {}) =>
        payment(userId, { plan: "starter", start: new Date(A.from.getTime() - 20 * DAY), simCase, ...extra });
    const addCase = (name, description, count, fn) => {
        for (let n = 1; n <= count; n++) fn(caseUser(name, n), `caso-${name}`);
        special.push({ name: `caso-${name}`, description, count });
    };

    addCase("septiembre-y-octubre", "Hace la mitad en el MES A y termina en el MES B (puntos repartidos en dos meses)", 6, (u, simCase) => {
        fullPlan(u, simCase);
        const c = anyCourse();
        const half = Math.floor(c.eligibleSteps.length / 2);
        const meta = { simCase };
        const tA = randomTimes(rnd, half + 1, A.from, A.to);
        event(u, c, "COURSE_STARTED", tA[0], { meta });
        c.eligibleSteps.slice(0, half).forEach((s, k) => event(u, c, "STEP_COMPLETED", tA[k + 1], { step: s, meta }));
        const rest = c.eligibleSteps.slice(half);
        const tB = randomTimes(rnd, rest.length + 1, B.from, B.to);
        rest.forEach((s, k) => event(u, c, "STEP_COMPLETED", tB[k], { step: s, meta }));
        event(u, c, "COURSE_COMPLETED", tB[rest.length], { meta });
    });

    addCase("tope", "Termina el curso en el MES A y en el MES B repite pasos: el tope de 1 punto no lo deja sumar más", 2, (u, simCase) => {
        fullPlan(u, simCase);
        const c = anyCourse();
        const meta = { simCase };
        run(u, c, { steps: c.eligibleSteps.length, completed: true, from: A.from, to: A.to, meta });
        const tB = randomTimes(rnd, 10, B.from, B.to);
        c.eligibleSteps.slice(0, 10).forEach((s, k) => event(u, c, "STEP_COMPLETED", tB[k], { step: s, meta, dedupe: false }));
    });

    addCase("pasos-duplicados", "Cada paso aparece dos veces en el mes: cuenta una sola vez", 2, (u, simCase) => {
        fullPlan(u, simCase);
        const c = anyCourse();
        run(u, c, { steps: c.eligibleSteps.length, completed: true, from: B.from, to: B.to, meta: { simCase }, duplicateSteps: true });
    });

    addCase("sin-pago", "Avanza sin ningún pago guardado: no suma", 2, (u, simCase) => {
        const c = anyCourse();
        run(u, c, { steps: c.eligibleSteps.length, completed: true, from: B.from, to: B.to, meta: { simCase } });
    });

    addCase("pago-a-mitad-de-mes", "El plan arranca el día 15 del MES B: solo suma lo que hizo después", 2, (u, simCase) => {
        const start = new Date(B.from.getTime() + 14 * DAY);
        payment(u, { plan: "starter", start, simCase });
        const c = anyCourse();
        run(u, c, { steps: c.eligibleSteps.length, completed: true, from: B.from, to: B.to, meta: { simCase } });
    });

    addCase("plan-vencido", "El plan vence el día 12 del MES B: solo suma lo que hizo antes (y la plata se prorratea hasta ese día)", 2, (u, simCase) => {
        const end = new Date(B.from.getTime() + 11 * DAY);
        payment(u, { plan: "starter", start: addMonths(end, -3), months: 3, simCase });
        const c = anyCourse();
        run(u, c, { steps: c.eligibleSteps.length, completed: true, from: B.from, to: B.to, meta: { simCase } });
    });

    addCase("cupon-100", "Pagó $0 con cupón del 100%: no suma (salvo TEST_COUNT_FREE_PAYMENTS = true)", 2, (u, simCase) => {
        payment(u, { plan: "starter", amount: 0, coupon: 1, start: new Date(A.from.getTime() - 10 * DAY), simCase });
        const c = anyCourse();
        run(u, c, { steps: c.eligibleSteps.length, completed: true, from: B.from, to: B.to, meta: { simCase } });
    });

    addCase("pago-de-prueba", "Pago marcado isTest: no suma ni cuenta como ingreso", 2, (u, simCase) => {
        payment(u, { plan: "starter", isTest: true, start: new Date(A.from.getTime() - 10 * DAY), simCase });
        const c = anyCourse();
        run(u, c, { steps: c.eligibleSteps.length, completed: true, from: B.from, to: B.to, meta: { simCase } });
    });

    addCase("solo-voucher", "Compró solo un voucher (no es un plan): no suma", 1, (u, simCase) => {
        payment(u, { plan: "voucher", items: ["voucher"], start: new Date(A.from.getTime() - 10 * DAY), months: 12, simCase });
        const c = anyCourse();
        run(u, c, { steps: c.eligibleSteps.length, completed: true, from: B.from, to: B.to, meta: { simCase } });
    });

    addCase("plan-empresa", "Accede con plan business de una empresa: no suma", 1, (u, simCase) => {
        payment(u, { plan: "business", items: ["business"], start: new Date(A.from.getTime() - 10 * DAY), months: 6, simCase });
        const c = anyCourse();
        run(u, c, { steps: c.eligibleSteps.length, completed: true, from: B.from, to: B.to, meta: { simCase, accessType: "COMPANY_PLAN", plan: "business" } });
    });

    addCase("empresa-baneada", "La empresa del curso estaba baneada cuando avanzó: no suma (el pago sí cuenta como ingreso)", 2, (u, simCase) => {
        fullPlan(u, simCase);
        const c = anyCourse();
        run(u, c, { steps: c.eligibleSteps.length, completed: true, from: B.from, to: B.to, meta: { simCase, partnerBanned: true } });
    });

    addCase("rol-admin", "Cuenta admin: no suma ni cuenta como inscripción", 1, (u, simCase) => {
        const c = anyCourse();
        run(u, c, { steps: c.eligibleSteps.length, completed: true, from: B.from, to: B.to, meta: { simCase, role: "admin", accessType: "ADMIN" } });
    });

    addCase("rol-partner", "Cuenta partner con pago: no suma puntos", 1, (u, simCase) => {
        fullPlan(u, simCase);
        const c = anyCourse();
        run(u, c, { steps: c.eligibleSteps.length, completed: true, from: B.from, to: B.to, meta: { simCase, role: "partner" } });
    });

    addCase("acceso-test", "Cuenta de test: no suma", 1, (u, simCase) => {
        const c = anyCourse();
        run(u, c, { steps: c.eligibleSteps.length, completed: true, from: B.from, to: B.to, meta: { simCase, accessType: "TEST" } });
    });

    return { events, payments, students, special };
}

// Completa los campos obligatorios/únicos del modelo de pagos que la
// simulación no conoce (así el insert no choca con índices únicos)
function fillPaymentSchema(doc, i) {
    const out = { ...doc };
    const uniqueIdx = new Set(
        Payments.schema
            .indexes()
            .filter(([, opts]) => opts && opts.unique)
            .flatMap(([fields]) => Object.keys(fields))
    );
    for (const [p, st] of Object.entries(Payments.schema.paths)) {
        if (p === "_id" || p === "__v" || p.includes(".")) continue;
        const needs = st.options?.required || st.options?.unique || uniqueIdx.has(p);
        if (!needs || out[p] !== undefined) continue;
        if (st.instance === "String") out[p] = `sim-${i}-${crypto.randomBytes(4).toString("hex")}`;
        else if (st.instance === "Number") out[p] = 0;
        else if (st.instance === "Date") out[p] = doc.date;
        else if (st.instance === "Boolean") out[p] = false;
        else if (st.instance === "Array") out[p] = [];
    }
    return out;
}

async function cmdCargar() {
    const B = periodRange(option("mes") || lastClosedPeriod());
    const A = periodRange(shiftPeriod(B.period, -1));
    if (B.to > new Date()) throw new Error(`${B.period} todavía no terminó: el pool solo calcula meses cerrados. Usá --mes con un mes anterior.`);

    await connect();
    const courses = await loadCourses();

    const existing = await CourseProgressEvent.countDocuments({ userId: SIM_RE });
    if (existing) throw new Error(`Ya hay ${existing} eventos simulados. Corré "limpiar --confirmar" antes de volver a cargar.`);

    let prices;
    let durations;
    try {
        ({ PLAN_PRICES: prices, PLAN_DURATIONS: durations } = require(path.join(ROOT, "routes", "paymentRoutes")));
    } catch (err) {
        throw new Error(`No pude leer PLAN_PRICES de routes/paymentRoutes: ${err.message}`);
    }

    const rnd = makeRandom(SEED);
    const sim = buildSimulation({ courses, A, B, prices, durations, rnd });

    console.log(`MES A (poca actividad, tope entre meses): ${A.period}`);
    console.log(`MES B (simulación principal):            ${B.period}\n`);
    console.log("Cursos:");
    for (const c of courses) {
        console.log(`  ${c.slug.padEnd(13)} ${c.version.courseId} v${c.version.version} · ${c.eligibleSteps.length} pasos que suman`);
    }

    const perCourse = new Map(courses.map((c) => [c.slug, { done: 0, partial: 0 }]));
    for (const s of sim.students) for (const t of s.taken) perCourse.get(t.course)[t.completed ? "done" : "partial"]++;
    const multi = sim.students.filter((s) => s.taken.length > 1).length;
    console.log(`\n${sim.students.length} alumnos · ${COMPLETED_STUDENTS} terminan su curso principal · ${sim.students.length - COMPLETED_STUDENTS} lo dejan incompleto · ${multi} hacen más de un curso`);
    for (const [slug, c] of perCourse) console.log(`  ${slug.padEnd(13)} ${String(c.done).padStart(3)} completos · ${String(c.partial).padStart(3)} incompletos`);
    const coupons = sim.students.filter((s) => s.coupon > 0).length;
    const plans = sim.students.reduce((acc, s) => ((acc[s.plan] = (acc[s.plan] || 0) + 1), acc), {});
    console.log(`  planes: ${Object.entries(plans).map(([p, n]) => `${n} ${p}`).join(" · ")} · ${coupons} con cupón del 20%`);

    console.log("\nCasos especiales:");
    for (const c of sim.special) console.log(`  ${String(c.count).padStart(2)} × ${c.name.padEnd(28)} ${c.description}`);
    console.log(`\nTotal: ${sim.events.length} eventos · ${sim.payments.length} pagos`);

    if (!CONFIRM) {
        console.log("\nNo se cargó nada. Para cargarlo: node scripts/simularPool.js cargar --confirmar");
        return;
    }

    for (let i = 0; i < sim.events.length; i += 1000) {
        await CourseProgressEvent.collection.insertMany(sim.events.slice(i, i + 1000), { ordered: false });
    }
    await Payments.collection.insertMany(sim.payments.map(fillPaymentSchema), { ordered: false });

    console.log("\n✓ Cargado.");
    console.log("Ahora, en el panel del pool:");
    console.log("  1. DURACIONES: los 4 cursos tienen que estar aprobados (con horas distintas para probar la ponderación).");
    console.log(`  2. LIQUIDACIONES: calculá ${A.period} y después ${B.period} (en ese orden: B usa los puntos de A para el tope).`);
    console.log(`  3. node scripts/simularPool.js verificar${option("mes") ? ` --mes=${B.period}` : ""}`);
}

// ═════════════════════════════════════════════════════════════════════════════
//  RESULTADO ESPERADO (reglas del documento V1.2, escrito aparte del service)
// ═════════════════════════════════════════════════════════════════════════════
const POOL_PLANS = ["starter", "pro", "elite"];
const EXCLUDED_ACCESS = new Set(["ADMIN", "TEST"]);

function expectedPeriod({ range, events, payments, versions, partners, durations, config, previous, freeFlag }) {
    const { from, to } = range;
    const pw = config.progressWeight;
    const cw = config.completionWeight;
    const eligiblePlans = (config.revenue?.eligiblePlans || POOL_PLANS).map((p) => String(p).toLowerCase());

    // ── Pagos: qué planes cuentan y cuánto valen ──
    const windows = [];
    let excludedFree = 0;
    for (const p of payments) {
        const items = (Array.isArray(p.items) && p.items.length ? p.items : String(p.plan || "").split("+")).map((i) => String(i).toLowerCase());
        const plan = items.find((i) => eligiblePlans.includes(i));
        const amount = Number(p.amount) || 0;
        const loaded =
            p.status === "approved" &&
            p.isTest !== true &&
            (freeFlag ? amount >= 0 : amount > 0) &&
            new Date(p.date) < to &&
            (!p.expiresAt || new Date(p.expiresAt) >= from) &&
            !!plan;
        if (!loaded) continue;
        if (amount <= 0 && !freeFlag) {
            excludedFree++;
            continue;
        }
        const d = p.couponUsed && Number(p.discount) > 0 ? Math.min(Math.max(Number(p.discount) / 100, 0), 1) : 0;
        const value = Math.min(amount, config.basePlanPrice * (1 - d));
        if (value <= 0 && !freeFlag) {
            excludedFree++;
            continue;
        }
        const start = new Date(p.fulfilledAt || p.date);
        const end = new Date(p.expiresAt);
        if (!(end > start)) continue;
        windows.push({ userId: String(p.client_id), start, end, value, discounted: d > 0 });
    }
    const inWindow = (userId, at) =>
        windows.some((w) => w.userId === String(userId) && at >= w.start.getTime() && at < w.end.getTime());

    let gross = 0;
    const subscribers = new Set();
    let discountedPlans = 0;
    for (const w of windows) {
        const overlap = Math.min(w.end, to) - Math.max(w.start, from);
        if (overlap <= 0) continue;
        gross += (w.value * overlap) / (w.end - w.start);
        subscribers.add(w.userId);
        if (w.discounted) discountedPlans++;
    }
    const fees = gross * config.mpFeeRate;

    // ── Puntos base por alumno y curso ──
    const versionMap = new Map(versions.map((v) => [courseKey(v.courseId, v.version), v]));
    const partnerMap = new Map(partners.map((p) => [String(p._id), p]));
    const participates = (v) => {
        const p = partnerMap.get(String(v.partnerId));
        return !!p && p.partnerPool?.enabled !== false && v.partnerPool?.enabled !== false;
    };
    const enrollments = new Map();
    const perUser = new Map();
    for (const e of events) {
        const at = new Date(e.occurredAt).getTime();
        if (at < from.getTime() || at >= to.getTime()) continue;
        if (EXCLUDED_ACCESS.has(e.metadata?.accessType)) continue;
        const cKey = courseKey(e.courseId, e.courseVersion);
        const v = versionMap.get(cKey);
        if (!v) continue;
        if ((e.metadata?.role ?? "student") !== "student") continue;
        if (e.metadata?.partnerBanned === true) continue;
        if (!inWindow(e.userId, at)) continue;
        if (e.eventType === "COURSE_STARTED") {
            enrollments.set(cKey, (enrollments.get(cKey) || 0) + 1);
            continue;
        }
        const uKey = userKey(e.userId, e.courseId, e.courseVersion);
        if (!perUser.has(uKey)) perUser.set(uKey, { userId: e.userId, cKey, steps: new Set(), completed: false });
        const u = perUser.get(uKey);
        if (e.eventType === "STEP_COMPLETED") {
            const step = v.steps.find((s) => s.stepId === e.stepId);
            if (step && step.progressEligible) u.steps.add(e.stepId);
        } else if (e.eventType === "COURSE_COMPLETED") {
            u.completed = true;
        }
    }

    const scores = new Map(); // userKey → totalScore
    const courseAgg = new Map(); // cKey → { base, consumers, completions, enrollments }
    const ensure = (cKey) => {
        if (!courseAgg.has(cKey)) courseAgg.set(cKey, { base: 0, consumers: 0, completions: 0, enrollments: 0 });
        return courseAgg.get(cKey);
    };
    for (const [uKey, u] of perUser) {
        const v = versionMap.get(u.cKey);
        if (!participates(v)) continue;
        if (!u.steps.size && !u.completed) continue;
        const raw = (u.steps.size / v.totalEligibleSteps) * pw + (u.completed ? cw : 0);
        const total = Math.min(raw, Math.max(0, 1 - (previous.get(uKey) || 0)));
        scores.set(uKey, total);
        const c = ensure(u.cKey);
        c.base += total;
        if (total > 0) c.consumers++;
        if (u.completed) c.completions++;
    }
    for (const [cKey, n] of enrollments) if (participates(versionMap.get(cKey))) ensure(cKey).enrollments += n;

    // ── Ponderación por duración ──
    const withPoints = [...courseAgg.entries()].filter(([, c]) => c.base > 0);
    const hoursOf = (cKey) => durations.get(cKey) ?? null;
    const known = withPoints.map(([k]) => hoursOf(k)).filter((h) => h != null && h > 0);
    const referenceHours = known.length ? Math.max(...known) : null;
    const missing = withPoints.filter(([k]) => hoursOf(k) == null).map(([k]) => k);
    for (const [k, c] of courseAgg) {
        const h = hoursOf(k);
        c.weightPct = c.base > 0 && h != null && referenceHours ? h / referenceHours : c.base > 0 && h != null ? 0 : null;
        c.weighted = c.base > 0 ? c.base * (c.weightPct || 0) : 0;
    }

    const partnerAgg = new Map();
    for (const [k, c] of courseAgg) {
        const pid = String(versionMap.get(k).partnerId);
        if (!partnerAgg.has(pid)) partnerAgg.set(pid, { base: 0, weighted: 0 });
        partnerAgg.get(pid).base += c.base;
        partnerAgg.get(pid).weighted += c.weighted;
    }
    const totalBase = [...partnerAgg.values()].reduce((s, p) => s + p.base, 0);
    const totalWeighted = [...partnerAgg.values()].reduce((s, p) => s + p.weighted, 0);

    // ── Habilitación del fondo ──
    const net = gross - fees;
    const maximumPoolAmount = net * config.maximumPoolRate;
    const consumptionTarget = subscribers.size * config.consumptionTargetRate;
    const enablementFactor = consumptionTarget > 0 ? Math.min(1, totalBase / consumptionTarget) : 0;
    const enabledPoolAmount = maximumPoolAmount * enablementFactor;
    for (const p of partnerAgg.values()) {
        p.share = totalWeighted > 0 ? p.weighted / totalWeighted : 0;
        p.amount = round2(enabledPoolAmount * p.share);
    }

    return {
        scores,
        courseAgg,
        partnerAgg,
        referenceHours,
        requiresReview: missing.length > 0,
        missing,
        totalBase,
        totalWeighted,
        revenue: { gross, fees, net, subscriptions: subscribers.size, discountedPlans, excludedFree },
        financials: { maximumPoolAmount, consumptionTarget, enablementFactor, enabledPoolAmount },
        uniqueConsumers: new Set([...scores.entries()].filter(([, s]) => s > 0).map(([k]) => k.split("|")[0])).size,
    };
}

// ═════════════════════════════════════════════════════════════════════════════
//  VERIFICAR
// ═════════════════════════════════════════════════════════════════════════════
function makeReport() {
    const r = { ok: 0, fail: 0 };
    r.check = (label, expected, actual, tol = 1e-6, show = fmt) => {
        const good =
            expected == null || actual == null
                ? expected == null && actual == null
                : typeof expected === "boolean"
                ? expected === actual
                : Math.abs(Number(expected) - Number(actual)) <= tol;
        good ? r.ok++ : r.fail++;
        const e = typeof expected === "boolean" ? String(expected) : show(expected);
        const a = typeof actual === "boolean" ? String(actual) : show(actual);
        console.log(`  ${good ? "✓" : "✗"} ${label.padEnd(44)} esperado ${String(e).padStart(16)} · calculado ${String(a).padStart(16)}`);
        return good;
    };
    return r;
}

async function cmdVerificar() {
    const B = periodRange(option("mes") || lastClosedPeriod());
    const A = periodRange(shiftPeriod(B.period, -1));
    await connect();

    const [events, payments] = await Promise.all([
        CourseProgressEvent.collection.find({ userId: SIM_RE }).toArray(),
        Payments.collection.find({ client_id: SIM_RE }).toArray(),
    ]);
    if (!events.length) throw new Error('No hay datos simulados: corré "cargar --confirmar" primero.');

    const versionPairs = [...new Set(events.map((e) => courseKey(e.courseId, e.courseVersion)))].map((k) => {
        const [courseId, version] = k.split("|");
        return { courseId, version: Number(version) };
    });
    const versions = await CourseVersion.find({ $or: versionPairs }).lean();
    const partners = await Partner.find({ _id: { $in: versions.map((v) => v.partnerId) } }).lean();
    const partnerName = new Map(partners.map((p) => [String(p._id), p.name]));
    const courseTitle = new Map(versions.map((v) => [courseKey(v.courseId, v.version), `${v.courseId} v${v.version}`]));

    const durationDocs = await CourseDuration.find({ $or: versionPairs }).lean();
    const durations = new Map(
        durationDocs
            .filter((d) => d.status === "APPROVED" && !d.contentChanged && d.approved?.hours != null)
            .map((d) => [courseKey(d.courseId, d.version), num(d.approved.hours)])
    );

    // ¿El pool cuenta los pagos de $0? (interruptor de prueba en partnerPoolRevenue.js)
    let freeFlag = false;
    try {
        const src = fs.readFileSync(path.join(CORE, "services", "partnerPoolRevenue.js"), "utf8");
        freeFlag = /TEST_COUNT_FREE_PAYMENTS\s*=\s*true/.test(src);
    } catch {
        /* sin el archivo se asume false */
    }
    if (freeFlag) console.log("⚠️  TEST_COUNT_FREE_PAYMENTS = true: los cupones del 100% cuentan.\n");

    const report = makeReport();
    const userIds = [...new Set(events.map((e) => e.userId))];
    const results = {};

    for (const range of [A, B]) {
        console.log(`\n══════════ ${range.period} ══════════`);
        const period = await PartnerPoolPeriod.findOne({ period: range.period }).lean();
        if (!period || !["CALCULATED", "APPROVED", "CLOSED"].includes(period.status)) {
            console.log(`  Falta calcularlo: en el panel, LIQUIDACIONES → calcular ${range.period}.`);
            continue;
        }

        const cfg = period.configuration || {};
        const config = {
            progressWeight: num(cfg.progressWeight),
            completionWeight: num(cfg.completionWeight),
            maximumPoolRate: num(cfg.maximumPoolRate),
            consumptionTargetRate: num(cfg.consumptionTargetRate),
            mpFeeRate: num(period.revenueBreakdown?.mpFeeRate) ?? 0.05,
            basePlanPrice: num(period.revenueBreakdown?.basePlanPrice),
            revenue: cfg.revenue || {},
        };

        // Puntos de meses anteriores (lo que el cálculo usa para el tope)
        const prevRows = await PartnerPoolConsumption.find({ period: { $lt: range.period }, userId: { $in: userIds } }).lean();
        const previous = new Map();
        for (const r of prevRows) {
            const k = userKey(r.userId, r.courseId, r.courseVersion);
            previous.set(k, (previous.get(k) || 0) + num(r.consumption.totalScore));
        }

        // ¿Hay datos reales en el mes? (entonces los totales no son comparables)
        const realEvents = await CourseProgressEvent.collection.countDocuments({
            userId: { $not: SIM_RE },
            partnerId: { $ne: null },
            occurredAt: { $gte: range.from, $lt: range.to },
        });
        const realPayments = await Payments.collection.countDocuments({
            client_id: { $not: SIM_RE },
            status: "approved",
            isTest: { $ne: true },
            date: { $lt: range.to },
            $or: [{ expiresAt: { $gte: range.from } }, { expiresAt: null }],
        });
        if (realEvents) console.log(`  ⚠️  Hay ${realEvents} avances reales en el mes: solo comparo los puntos de los alumnos simulados.`);
        if (realPayments) console.log(`  ⚠️  Hay ${realPayments} pagos reales vigentes en el mes: no comparo la plata.`);

        const exp = expectedPeriod({ range, events, payments, versions, partners, durations, config, previous, freeFlag });
        results[range.period] = exp;

        // 1) Puntos de cada alumno simulado y curso
        const stored = await PartnerPoolConsumption.find({ period: range.period, userId: SIM_RE }).lean();
        const storedScores = new Map(stored.map((r) => [userKey(r.userId, r.courseId, r.courseVersion), num(r.consumption.totalScore)]));
        const keys = new Set([...exp.scores.keys(), ...storedScores.keys()]);
        const bad = [...keys].filter((k) => Math.abs((exp.scores.get(k) || 0) - (storedScores.get(k) || 0)) > 1e-6);
        console.log("\n  Puntos por alumno y curso");
        report.check(`${keys.size} recorridos sin diferencias`, keys.size, keys.size - bad.length, 0, (n) => String(n));
        for (const k of bad.slice(0, 15)) {
            const [u, c, v] = k.split("|");
            console.log(`      ${u} · ${c} v${v}: esperado ${fmt(exp.scores.get(k) || 0)} · calculado ${fmt(storedScores.get(k) || 0)}`);
        }
        if (bad.length > 15) console.log(`      … y ${bad.length - 15} más`);
        results[range.period].storedScores = storedScores;

        if (realEvents) continue;

        // 2) Por curso
        const settlements = await PartnerPoolSettlement.find({ period: range.period }).lean();
        const storedCourses = new Map();
        for (const s of settlements) for (const c of s.courses || []) storedCourses.set(courseKey(c.courseId, c.courseVersion), c);
        for (const [k, c] of exp.courseAgg) {
            const s = storedCourses.get(k) || {};
            console.log(`\n  ${courseTitle.get(k)} (${partnerName.get(String(versions.find((v) => courseKey(v.courseId, v.version) === k).partnerId))})`);
            report.check("inscripciones", c.enrollments, s.enrollments ?? 0, 0, (n) => String(n));
            report.check("alumnos que sumaron", c.consumers, s.uniqueConsumers ?? 0, 0, (n) => String(n));
            report.check("completaron en el mes", c.completions, s.completions ?? 0, 0, (n) => String(n));
            report.check("puntos base", c.base, num(s.consumptionScore) ?? 0);
            report.check("horas aprobadas", c.base > 0 ? durations.get(k) ?? null : null, num(s.approvedHours), 0.01, (n) => fmt(n, 2));
            report.check("% de duración", c.weightPct, num(s.weightPct));
            report.check("puntos ponderados", c.weighted, num(s.weightedScore) ?? 0);
        }

        // 3) Ponderación del mes
        const dw = period.durationWeighting || {};
        console.log("\n  Ponderación del mes");
        report.check("horas de referencia (100%)", exp.referenceHours, num(dw.referenceHours), 0.01, (n) => fmt(n, 2));
        report.check("puntos base totales", exp.totalBase, num(dw.totalBaseScore));
        report.check("puntos ponderados totales", exp.totalWeighted, num(dw.totalWeightedScore));
        report.check("requiere revisión (falta duración)", exp.requiresReview, dw.requiresReview === true);
        if (exp.missing.length) console.log(`      sin duración aprobada: ${exp.missing.map((k) => courseTitle.get(k)).join(", ")}`);

        // 4) Plata y habilitación
        if (realPayments) continue;
        const m = period.metrics || {};
        const f = period.financials || {};
        const rb = period.revenueBreakdown || {};
        console.log("\n  Ingresos y habilitación del fondo");
        report.check("suscripciones elegibles", exp.revenue.subscriptions, m.eligibleSubscriptions, 0, (n) => String(n));
        report.check("planes con cupón", exp.revenue.discountedPlans, rb.discountedPlans, 0, (n) => String(n));
        report.check("pagos de $0 excluidos", exp.revenue.excludedFree, rb.excludedFreePayments, 0, (n) => String(n));
        report.check("ingreso bruto del mes", exp.revenue.gross, num(rb.grossAmount), 0.011, money);
        report.check("comisión Mercado Pago", exp.revenue.fees, num(rb.feesAmount), 0.011, money);
        report.check("ingreso neto elegible", exp.revenue.net, num(f.eligibleNetTrainingRevenue), 0.011, money);
        report.check("fondo máximo (20%)", exp.financials.maximumPoolAmount, num(f.maximumPoolAmount), 0.011, money);
        report.check("meta de consumo", exp.financials.consumptionTarget, num(m.consumptionTarget));
        report.check("puntos totales del mes", exp.totalBase, num(m.totalConsumptionScore));
        report.check("factor de habilitación", exp.financials.enablementFactor, num(m.enablementFactor));
        report.check("fondo habilitado", exp.financials.enabledPoolAmount, num(f.enabledPoolAmount), 0.011, money);
        report.check("alumnos que sumaron", exp.uniqueConsumers, m.uniqueEligibleConsumers, 0, (n) => String(n));

        console.log("\n  Liquidación por empresa");
        const byPartner = new Map(settlements.map((s) => [String(s.partnerId), s]));
        for (const [pid, p] of exp.partnerAgg) {
            const s = byPartner.get(pid) || {};
            console.log(`   ${partnerName.get(pid)}`);
            report.check("puntos base", p.base, num(s.partnerBaseScore) ?? 0);
            report.check("puntos ponderados", p.weighted, num(s.partnerScore) ?? 0);
            report.check("participación", p.share, num(s.partnerShare) ?? 0);
            report.check("monto a liquidar", p.amount, num(s.settlementAmount) ?? 0, 0.011, money);
        }
    }

    // 5) Casos especiales: qué sumó cada uno
    console.log("\n══════════ Casos especiales ══════════");
    const cases = new Map();
    for (const e of events) {
        const c = e.metadata?.simCase;
        if (!c || !c.startsWith("caso-")) continue;
        if (!cases.has(c)) cases.set(c, new Set());
        cases.get(c).add(userKey(e.userId, e.courseId, e.courseVersion));
    }
    for (const [name, keys] of cases) {
        console.log(`  ${name}`);
        for (const k of keys) {
            const parts = [A, B].map((r) => {
                const res = results[r.period];
                if (!res) return `${r.period}: sin calcular`;
                const e = res.scores.get(k) || 0;
                const s = res.storedScores?.get(k) || 0;
                return `${r.period}: ${Math.abs(e - s) <= 1e-6 ? "✓" : "✗"} ${fmt(s)} (esperado ${fmt(e)})`;
            });
            console.log(`    ${k.split("|")[0].padEnd(36)} ${parts.join("   ")}`);
        }
    }

    console.log(`\n${report.fail ? "✗" : "✓"} ${report.ok} controles bien · ${report.fail} con diferencias`);
    if (report.fail) process.exitCode = 1;
}

// ═════════════════════════════════════════════════════════════════════════════
//  LIMPIAR
// ═════════════════════════════════════════════════════════════════════════════
async function cmdLimpiar() {
    const B = periodRange(option("mes") || lastClosedPeriod());
    const A = periodRange(shiftPeriod(B.period, -1));
    const periods = flag("periodos") ? [A.period, B.period] : [];
    await connect();

    const counts = {
        eventos: await CourseProgressEvent.collection.countDocuments({ userId: SIM_RE }),
        pagos: await Payments.collection.countDocuments({ client_id: SIM_RE, simulation: true }),
        "puntos calculados": await PartnerPoolConsumption.collection.countDocuments({ userId: SIM_RE }),
    };
    if (periods.length) {
        counts[`períodos ${periods.join(" y ")}`] = await PartnerPoolPeriod.collection.countDocuments({ period: { $in: periods } });
        counts[`liquidaciones ${periods.join(" y ")}`] = await PartnerPoolSettlement.collection.countDocuments({ period: { $in: periods } });
    }
    for (const [k, n] of Object.entries(counts)) console.log(`  ${k.padEnd(32)} ${n}`);

    if (!CONFIRM) {
        console.log("\nNo se borró nada. Para borrarlo: node scripts/simularPool.js limpiar --confirmar" + (periods.length ? " --periodos" : ""));
        return;
    }

    // Los eventos son inmutables para la app (hooks de mongoose): acá se borra
    // directo en la colección y SOLO lo simulado
    await CourseProgressEvent.collection.deleteMany({ userId: SIM_RE });
    await Payments.collection.deleteMany({ client_id: SIM_RE, simulation: true });
    await PartnerPoolConsumption.collection.deleteMany({ userId: SIM_RE });
    if (periods.length) {
        await PartnerPoolSettlement.collection.deleteMany({ period: { $in: periods } });
        await PartnerPoolPeriod.collection.deleteMany({ period: { $in: periods } });
    }
    console.log("\n✓ Borrado.");
    if (!periods.length) console.log(`Recalculá ${A.period} y ${B.period} en el panel para que las liquidaciones queden sin lo simulado.`);
}

// ─────────────────────────────────────────────────────────────────────────────
const commands = { cargar: cmdCargar, verificar: cmdVerificar, limpiar: cmdLimpiar };

if (require.main === module) {
    (async () => {
        if (!commands[command]) {
            console.log("Uso: node scripts/simularPool.js <cargar|verificar|limpiar> [--confirmar] [--mes=AAAA-MM] [--semilla=N] [--periodos]");
            process.exitCode = 1;
            return;
        }
        try {
            await commands[command]();
        } catch (err) {
            console.error(`\n✗ ${err.message}`);
            process.exitCode = 1;
        } finally {
            await mongoose.disconnect().catch(() => {});
            // Firebase u otros módulos del back pueden dejar conexiones abiertas
            process.exit(process.exitCode || 0);
        }
    })();
}

module.exports = { buildSimulation, expectedPeriod, makeRandom, periodRange, shiftPeriod, loadCourses, commands };