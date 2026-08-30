// ─── Catálogo de certificaciones — fuente de verdad del backend ──────────────
// Preguntas, respuestas correctas, tiempo límite y nota de corte NUNCA salen
// del backend hacia el cliente antes de rendir. El frontend solo recibe lo
// que sanitizeQuestions() expone (texto + opciones, sin el índice correcto).
//
// La lógica de examen (start/answer/submit/timers/guardas de dispositivo) es
// GENÉRICA para cualquier certId — lo único que cambia entre certificaciones
// es este objeto de contenido, y del lado del frontend, qué componente de
// "reglas/intro" se muestra antes de arrancar.
const MODERNSOC_CERTIFICATION = {
  id:               "modernsoc-cert",
  relatedCourseId:  "soc1",
  title:            "Certificación Hidden Security — Modern SOC Operations",
  totalQuestions:   5,

  // ⚠️ VALOR DE PRUEBA — subir antes de producción real
  timeLimitMinutes: 5,

  // 80% de 5 preguntas = 4/5 exacto, sin ambigüedad de redondeo
  passingScore:     0.80,

  showConfetti:               true,
  timeWarningEnabled:         true,
  timeWarningPercent:         15, // aviso cuando quede <= 15% del tiempo total
  timeWarningDurationSeconds: 10,

  confettiColors: {
    dark:  ["#000000", "#ffffff", "#ccff00"],
    light: ["#f5f5f5", "#ffffff", "#ff5500"],
  },

  modules: [
    { id: 1, title: "Módulo 1 — Fundamentos" },
    { id: 2, title: "Módulo 2 — Operaciones SOC" },
    { id: 3, title: "Módulo 3 — Detección" },
    { id: 4, title: "Módulo 4 — Respuesta a Incidentes" },
    { id: 5, title: "Módulo 5 — Threat Intelligence" },
  ],

  questions: [
    {
      id: 1, moduleId: 1,
      question: "¿Cuál es el objetivo principal de la gestión de superficie de ataque?",
      options: [
        "Aumentar la cantidad de servicios expuestos",
        "Identificar y reducir los puntos de exposición de la organización",
        "Eliminar todos los firewalls",
        "Migrar todos los sistemas a la nube",
      ],
      answer: 1,
    },
    {
      id: 2, moduleId: 2,
      question: "En operaciones SOC, ¿qué es el 'triage de alertas'?",
      options: [
        "Eliminar alertas sin revisarlas",
        "La priorización inicial de alertas según su severidad y contexto",
        "Un tipo de malware",
        "Un protocolo de red",
      ],
      answer: 1,
    },
    {
      id: 3, moduleId: 3,
      question: "El framework MITRE ATT&CK se utiliza principalmente para:",
      options: [
        "Gestionar contraseñas",
        "Describir tácticas, técnicas y procedimientos de atacantes",
        "Configurar firewalls",
        "Emitir certificados SSL",
      ],
      answer: 1,
    },
    {
      id: 4, moduleId: 4,
      question: "¿Cuál es el objetivo de la fase de 'contención' en respuesta a incidentes?",
      options: [
        "Eliminar completamente la amenaza",
        "Limitar el alcance y propagación del incidente sin perder evidencia",
        "Notificar a los medios",
        "Restaurar backups",
      ],
      answer: 1,
    },
    {
      id: 5, moduleId: 5,
      question: "Un 'IOC' (Indicator of Compromise) es:",
      options: [
        "Un protocolo de autenticación",
        "Una evidencia técnica de que un sistema fue comprometido",
        "Un tipo de firewall",
        "Un estándar de cifrado",
      ],
      answer: 1,
    },
  ],
};

// Solo modernsoc-cert está disponible por ahora — agregar acá cuando haya más
const CERTIFICATIONS = {
  "modernsoc-cert": MODERNSOC_CERTIFICATION,
};

const VALID_CERT_IDS = Object.keys(CERTIFICATIONS);

module.exports = { CERTIFICATIONS, VALID_CERT_IDS };