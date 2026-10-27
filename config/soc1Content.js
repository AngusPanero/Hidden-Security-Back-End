const path = require("path");

// ⚠️ Tiene que coincidir con MODULES_CONFIG de Soc1Course.tsx
// steps del módulo = [video] + socIntro + contents + socFinal + quiz
const SOC1_MODULES = [
    { contents: 6, introVideo: true }, // Módulo 1
    { contents: 8 },                   // Módulo 2
    { contents: 9 },                   // Módulo 3
    { contents: 11 },                  // Módulo 4
    { contents: 8 },                   // Módulo 5
    { contents: 7 },                   // Módulo 6
    { contents: 7 },                   // Módulo 7
    { contents: 7 },                   // Módulo 8
];

// Carpeta privada del backend (fuera de /public del front)
const SOC1_CONTENT_DIR = path.join(__dirname, "..", "privateContent", "modernSoc");

// stepIndex → "Modulo3/soc4.pdf"  (solo los steps que son PDF)
const SOC1_PDF_BY_STEP = (() => {
    const map = new Map();
    let i = 0;
    SOC1_MODULES.forEach((m, idx) => {
        const mod = `Modulo${idx + 1}`;
        if (m.introVideo) i++;                          // video
        map.set(i++, `${mod}/socIntro.pdf`);            // intro
        for (let n = 1; n <= m.contents; n++) {
            map.set(i++, `${mod}/soc${n}.pdf`);         // contenidos
        }
        map.set(i++, `${mod}/socFinal.pdf`);            // cierre
        i++;                                            // quiz
    });
    return map;
})();

module.exports = { SOC1_CONTENT_DIR, SOC1_PDF_BY_STEP };