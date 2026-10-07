/* ══════════════════════════════════════════════════════════════════════════
   Certificación SOC Analyst — configuración
   El banco (socAnalystBank.json) se genera con scripts/buildSocAnalystBank.js
   y contiene las respuestas correctas: NUNCA se expone por ninguna ruta.
══════════════════════════════════════════════════════════════════════════ */
const bank = require("../bancoPreguntasCertif/socAnalystBank.json");

const bp = bank.blueprint;
const totalQuestions =
  (bp.sjtCases + bp.expCases) * bp.questionsPerCase +
  Object.values(bp.individual).reduce((a, n) => a + n, 0);

module.exports = {
  id:    "modernsoc-cert", // debe coincidir con el certId que usa el front en la URL
  title: "SOC Analyst",
  bank,

  timeLimitMinutes: 120,  // 2 horas
  passingScore:     0.8,  // 80 % de los puntos ponderados
  totalQuestions,         // 80 (3 SJT×5 + 2 Exploratorios×5 + 55 individuales)

  // Skill que se agrega al claim skillsCertifiedByHidden al aprobar.
  certifiedSkill: "SOC Analyst",

  timeWarningEnabled:         true,
  timeWarningPercent:         10,  // aviso cuando queda el 10 % del tiempo (12 min)
  timeWarningDurationSeconds: 8,
  showConfetti:   true,
  confettiColors: {
    dark:  ["#ccff00", "#ffffff", "#22c55e"],
    light: ["#ff5500", "#000000", "#facc15"],
  },
};