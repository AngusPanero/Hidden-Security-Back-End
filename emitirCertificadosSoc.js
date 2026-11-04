// ─────────────────────────────────────────────────────────────────────────────
//  scripts/emitirCertificadosSoc.js — Hidden Security
//
//  Script de UNA SOLA VEZ: emite el certificado de finalización del curso
//  Modern SOC Operations (soc1) a los alumnos que ya lo completaron.
//  No forma parte de la app: se corre a mano desde la carpeta del back y,
//  cuando termina, se puede borrar.
//
//  Uso (desde la raíz del back, donde está tu .env):
//    node scripts/emitirCertificadosSoc.js            → simulación, no escribe nada
//    node scripts/emitirCertificadosSoc.js --guardar  → crea los certificados
//
//  Es idempotente: si un alumno ya tiene su certificado, devuelve el mismo
//  (no crea otro). Usa la misma función que la app (issueHiddenCourseCertificate),
//  así que el documento queda idéntico al que se crea al terminar el curso.
//
//  Seguridad: solo emite si en la DB el curso figura completo (todos los pasos
//  y todos los quizzes aprobados). Un email que no lo completó se saltea,
//  salvo que esté en FORZAR y se corra con --forzar (ver abajo).
// ─────────────────────────────────────────────────────────────────────────────
require("dotenv").config();
const mongoose = require("mongoose");

const auth           = require("./config/firebase");
const CourseProgress = require("./models/CourseSchema");
const { COURSES }    = require("./config/courses");
const { issueHiddenCourseCertificate } = require("./routes/publicCertificateRouter");

const COURSE_ID = "soc1";

// Alumnos que completaron el curso (panel Admin → Progresos → Completado)
const ALUMNOS = [
  "ferreiro.fer@gmail.com",
  "gon.vazquez.mail@gmail.com",
  "enzocoronelgabriel@gmail.com",
  "nicolasvigo39@gmail.com",
  "lic.echeberz@gmail.com",
  "marceloepanero@gmail.com",
  "mbelenarroyo96@gmail.com",
];

// Cuentas a las que se les emite aunque NO hayan completado el curso
// (por ejemplo, para ver cómo queda el certificado). Solo se usan con
// --forzar. Ojo: el certificado es público y verificable; si es de prueba,
// revocalo después (status: "revoked").
const FORZAR = [
  // "marceloepanero@gmail.com",
  // "mbelenarroyo96@gmail.com",
];

// ⚠️ Ajustá el nombre si tu .env usa otro para la conexión de Mongo
const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI || process.env.DB_URI;

const GUARDAR = process.argv.includes("--guardar");
const FORZADO = process.argv.includes("--forzar");

// Misma regla que courseRouter: todos los pasos hechos y todos los quizzes aprobados
function completo(progress, course) {
  if (progress.isCompleted) return true;
  const done = new Set(progress.completedSteps || []);
  const pasos = Array.from({ length: course.totalSteps }, (_, i) => i).every((i) => done.has(i));
  const quizzes = course.quizSteps.every((qi) => progress.quizResults?.[String(qi)]?.passed === true);
  return pasos && quizzes;
}

// Nota del curso = promedio de la mejor nota de cada quiz (igual que courseRouter)
function nota(progress, course) {
  const scores = course.quizSteps.map((qi) => {
    const r = progress.quizResults?.[String(qi)];
    return Math.max(Number(r?.bestScore) || 0, Number(r?.score) || 0);
  });
  return scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
}

async function main() {
  if (!MONGO_URI) throw new Error("No encontré la conexión de Mongo en el .env (MONGO_URI / MONGODB_URI / DB_URI)");
  const course = COURSES[COURSE_ID];
  if (!course) throw new Error(`El curso ${COURSE_ID} no está en config/courses.js`);

  await mongoose.connect(MONGO_URI);
  console.log(GUARDAR ? "▶ MODO GUARDAR: se crean los certificados\n" : "▶ SIMULACIÓN: no se escribe nada (agregá --guardar)\n");

  const resumen = [];
  for (const email of ALUMNOS) {
    try {
      const user = await auth.getUserByEmail(email);
      const progress = await CourseProgress.findOne({ userId: user.uid, courseId: COURSE_ID }).lean();
      const forzar = FORZADO && FORZAR.includes(email);

      if (!progress && !forzar) { resumen.push([email, "SALTEADO: nunca empezó el curso"]); continue; }
      if (progress && !completo(progress, course) && !forzar) {
        resumen.push([email, "SALTEADO: no completó el curso"]);
        continue;
      }

      const score = progress && completo(progress, course) ? nota(progress, course) : null;
      if (!GUARDAR) {
        resumen.push([email, `OK para emitir${forzar ? " (FORZADO)" : ""} · nota ${score === null ? "—" : Math.round(score * 100) + "%"}`]);
        continue;
      }

      const cert = await issueHiddenCourseCertificate({
        userId:   user.uid,
        courseId: COURSE_ID,
        score:    score ?? undefined,
        issuedAt: progress?.completedAt || new Date(),
      });
      if (!cert) { resumen.push([email, "ERROR: no se pudo emitir (mirá el log de arriba)"]); continue; }
      resumen.push([
        email,
        `${cert.created ? "CREADO" : "YA EXISTÍA"} · ${cert.credentialId}${cert.hasHolderName ? "" : " · SIN NOMBRE (se le pide al entrar al curso)"}`,
      ]);
    } catch (err) {
      resumen.push([email, err.code === "auth/user-not-found" ? "SALTEADO: no existe en Firebase" : `ERROR: ${err.message}`]);
    }
  }

  console.log("\nResultado:");
  for (const [email, estado] of resumen) console.log(` - ${email.padEnd(32)} ${estado}`);
}

main()
  .catch((err) => { console.error("Falló el script:", err.message); process.exitCode = 1; })
  .finally(() => mongoose.disconnect());