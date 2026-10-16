// ══════════════════════════════════════════════════════════════════════════════
//  addCompletedCourse.js — agrega o quita un curso de la claim completedCourses
//
//  Uso (desde la carpeta del backend):
//    node addCompletedCourse.js testCourse            → agrega "testCourse"
//    node addCompletedCourse.js modernSoc             → agrega "modernSoc"
//    node addCompletedCourse.js testCourse --remove   → lo saca
//
//  El usuario se toma de CERTIFICATED_USER en el .env.
//  Después cerrá sesión y volvé a entrar (o recargá el dashboard: refresh-claims
//  renueva la cookie solo).
// ══════════════════════════════════════════════════════════════════════════════
require("dotenv").config();
const auth = require("./config/firebase");

const courseId = process.argv[2];
const remove   = process.argv.includes("--remove");
const uid      = process.env.COMPLETED_MODERN_SOC_USER;

const run = async () => {
    try {
        if (!uid)      throw new Error("Falta COMPLETED_MODERN_SOC_USER en el .env");
        if (!courseId || courseId.startsWith("--")) {
            throw new Error("Indicá el id del curso. Ej: node addCompletedCourse.js testCourse");
        }

        const user = await auth.getUser(uid);
        const existingClaims = user.customClaims || {};

        const completed = Array.isArray(existingClaims.completedCourses)
            ? existingClaims.completedCourses
            : [];

        // Saca la claim vieja si la tenía
        const { userCertificated, ...rest } = existingClaims;

        const updated = remove
            ? completed.filter(id => id !== courseId)
            : [...new Set([...completed, courseId])];

        await auth.setCustomUserClaims(uid, { ...rest, completedCourses: updated });

        console.log(`✅ ${user.email ?? uid} → completedCourses:`, updated);
    } catch (error) {
        console.error("Error actualizando completedCourses! 🔴", error.message);
        process.exitCode = 1;
    }
};

run().then(() => process.exit());