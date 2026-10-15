// ══════════════════════════════════════════════════════════════════════════════
//  bancoPreguntasModernSoc.js — Banco de preguntas del curso Modern SOC (soc1)
//
//  Fuente de verdad de las preguntas de los quizzes. El front NUNCA recibe la
//  respuesta correcta: la pide por GET /api/course/:courseId/quiz/:stepIndex
//  (solo enunciado + opciones), la mezcla en el cliente y devuelve el TEXTO
//  de la opción elegida junto al id de la pregunta. Acá se compara ese texto
//  contra la opción correcta.
//
//  Formato de cada pregunta:
//    id        → único dentro del módulo (es lo que el front devuelve)
//    type      → "multiple" | "truefalse"
//    question  → enunciado / escenario
//    prompt    → (opcional) la consigna "¿Cuál…?" que va debajo del escenario
//    statement → (opcional, V/F) la afirmación a evaluar
//    options   → opciones en el orden del documento de la clienta (A, B, C, D)
//    answer    → LETRA de la opción correcta tal como viene marcada con ✅
//                en el documento ("A", "B", "C"…). Para V/F: A = Verdadero,
//                B = Falso. Nunca sale del backend.
//
//  Para reemplazar los módulos 7 y 8: armá MODULO_7 / MODULO_8 con el mismo
//  formato y cambiá las dos líneas de BANCO_PREGUNTAS al final del árbol.
// ══════════════════════════════════════════════════════════════════════════════

const VF = ["Verdadero", "Falso"];

// ── Módulo 1 ────────────────────────────────────────────────────────────────
const MODULO_1 = [
  {
    id: "m1-q1",
    type: "multiple",
    question: "¿Cuál describe correctamente los tres objetivos operativos del SOC y su relación?",
    options: [
      "Prevenir, detectar y responder — se activan en paralelo: el SOC trabaja los tres simultáneamente en todo momento",
      "Monitorear, detectar y responder — se activan en secuencia: sin monitoreo no hay detección, y sin detección no hay respuesta",
      "Detectar, escalar y resolver — el SOC identifica el problema y lo resuelve en cada nivel antes de pasar al siguiente",
      "Monitorear, analizar y contener — el SOC no responde, solo recopila evidencia y coordina la contención con otros equipos",
    ],
    answer: "B",
  },
  {
    id: "m1-q2",
    type: "multiple",
    question: "¿Cuál es la diferencia entre un SOC interno y un MSSP?",
    prompt: "Un equipo de seguridad está evaluando si contratar un MSSP o mantener el SOC interno. ¿Qué afirmación es correcta?",
    options: [
      "El MSSP siempre ofrece mayor visibilidad sobre los activos internos porque tiene más herramientas disponibles",
      "Un SOC interno es preferible para organizaciones pequeñas porque el MSSP requiere infraestructura propia del cliente",
      "El SOC interno permite mayor control y alineación con el contexto del negocio, pero implica mayor costo operativo y necesidad de retener talento",
      "Ambos modelos son equivalentes en práctica; la diferencia es solo contractual y no afecta la calidad de la detección",
    ],
    answer: "C",
  },
  {
    id: "m1-q3",
    type: "multiple",
    question: "Un analista SOC recibe una alerta de múltiples intentos de login fallidos desde una IP extranjera. ¿Cuáles son los primeros pasos?",
    prompt: "¿Cuál es la secuencia más adecuada para el análisis inicial?",
    options: [
      "Bloquear la IP en el firewall y documentar el bloqueo como medida preventiva inmediata",
      "Validar si hubo login exitoso posterior, revisar la cuenta afectada, evaluar privilegios y reputación de la IP antes de tomar acción",
      "Confirmar si la cuenta tiene MFA activo; si lo tiene, cerrar la alerta porque el ataque fue bloqueado por el segundo factor",
      "Escalar directamente a L2 porque cualquier acceso desde IP extranjera supera el alcance del triage inicial",
    ],
    answer: "B",
  },
  {
    id: "m1-q4",
    type: "multiple",
    question: "¿Cuál es la diferencia entre log, evento, alerta e incidente?",
    prompt: "¿Cuál de estas afirmaciones es correcta?",
    options: [
      "Toda alerta es un incidente en potencia, por lo que deben tratarse con el mismo nivel de urgencia hasta descartarse",
      "El log es generado por el analista, el evento por la herramienta, la alerta por el SIEM y el incidente por el equipo de IR",
      "Un log es registro crudo, un evento le agrega contexto, una alerta se genera cuando coincide con una condición de detección, y un incidente requiere evidencia suficiente de afectación real",
      "La diferencia entre alerta e incidente es subjetiva: depende del criterio del analista que recibe el caso",
    ],
    answer: "C",
  },
  {
    id: "m1-q5",
    type: "truefalse",
    question: "¿Por qué es importante documentar el análisis incluso cuando la alerta resulta ser un falso positivo?",
    statement: "Documentar un falso positivo consume tiempo innecesario. Si la actividad fue validada como legítima, basta con cerrarlo en el sistema sin agregar notas, ya que no hay riesgo asociado.",
    options: VF,
    answer: "B",
  },
  {
    id: "m1-q6",
    type: "multiple",
    question: "¿Qué información debe incluir un escalamiento para que sea útil y accionable?",
    prompt: "¿Cuál de los siguientes escalamientos es más útil para quien lo recibe?",
    options: [
      "\"Alerta de PowerShell sospechoso en endpoint de Finanzas. Severidad alta. Adjunto captura del SIEM.\"",
      "\"Se observó PowerShell ejecutado por WINWORD.EXE con -nop -w hidden -enc en FIN-LAP-022 (usuario sin rol técnico). Actividad posterior: conexión externa y descarga de ejecutable. Sin ticket asociado. Se recomienda análisis forense del host.\"",
      "\"PowerShell detectado en equipo de usuario. MFA activo. Sin movimiento lateral confirmado. Posible falso positivo, pero escalo por precaución.\"",
      "\"Incidente confirmado en endpoint de Finanzas. Requiere contención inmediata y notificación al área legal.\"",
    ],
    answer: "B",
  },
  {
    id: "m1-q7",
    type: "truefalse",
    question: "¿Por qué decimos que 'ver no significa tener permiso para divulgar'?",
    statement: "Un analista SOC que detecta actividad sospechosa en la cuenta de un directivo puede avisar informalmente al responsable de IT para agilizar la respuesta, incluso antes de seguir el proceso formal.",
    options: VF,
    answer: "B",
  },
  {
    id: "m1-q8",
    type: "multiple",
    question: "Mencioná al menos 3 rutas de especialización o crecimiento posibles a partir del SOC.",
    prompt: "¿Cuál lista representa rutas de especialización reales y diferenciadas desde el SOC?",
    options: [
      "SOC L2, SOC L3, SOC Manager — todas dentro del mismo equipo, con responsabilidades progresivas",
      "Incident Response, Threat Intelligence, Ingeniería de Seguridad (SIEM/SOAR), Forense Digital, Cloud Security, Red Team",
      "Pentesting, Desarrollo seguro, Auditoría ISO 27001 — salidas naturales para quien ya tiene experiencia en detección",
      "CISO, Risk Manager, Compliance Officer — roles que requieren primero pasar por un SOC antes de acceder a posiciones estratégicas",
    ],
    answer: "B",
  },
];

// ── Módulo 2 ────────────────────────────────────────────────────────────────
const MODULO_2 = [
  {
    id: "m2-q1",
    type: "multiple",
    question: "Un usuario de marketing clona un repositorio de código productivo a las 2:00 AM desde un dispositivo personal. ¿Qué información necesitás revisar antes de clasificar la alerta?",
    prompt: "¿Cuál es el conjunto de información más relevante para clasificar esta alerta?",
    options: [
      "Confirmar si el usuario tiene acceso autorizado al repositorio y si el dispositivo personal está registrado en el MDM corporativo",
      "Verificar el volumen clonado, el lenguaje del repositorio y si hay otros usuarios del área de marketing con el mismo comportamiento esa noche",
      "Revisar el rol del usuario vs. el tipo de repositorio, el horario y dispositivo, si hubo actividad posterior al clon (push, descarga, reenvío), y si existe algún contexto operativo que lo justifique",
      "Consultar con el equipo de desarrollo si el repositorio fue modificado después del clon, ya que el riesgo real está en la integridad del código, no en la descarga",
    ],
    answer: "C",
  },
  {
    id: "m2-q2",
    type: "multiple",
    question: "¿Qué diferencia existe entre que una acción fue 'bloqueada' y que la situación fue 'resuelta'?",
    prompt: "¿Cuál de estas afirmaciones describe mejor la diferencia?",
    options: [
      "Son equivalentes en la práctica: si el control bloqueó la acción, el riesgo dejó de existir y el caso puede cerrarse",
      "'Bloqueada' significa que el control actuó sobre ese evento específico, pero no necesariamente resuelve el origen, el alcance ni la posible actividad relacionada",
      "La diferencia es semántica: 'bloqueada' la usa el EDR y 'resuelta' la usa el analista al cerrar el ticket",
      "Una acción bloqueada requiere escalamiento automático a L2; una resuelta puede cerrarse directamente desde L1",
    ],
    answer: "B",
  },
  {
    id: "m2-q3",
    type: "multiple",
    question: "Describí cómo un mismo evento (modificación de permisos en una carpeta compartida) puede tener impacto bajo en un caso y alto en otro.",
    prompt: "¿Cuál par de escenarios demuestra mejor que el impacto no lo define el evento sino el contexto?",
    options: [
      "Caso bajo: el cambio fue realizado por un admin. Caso alto: fue realizado por un usuario sin privilegios",
      "Caso bajo: la carpeta tiene 10 archivos. Caso alto: la carpeta tiene 10.000 archivos",
      "Caso bajo: admin aplica cambio aprobado en carpeta de pruebas en horario laboral. Caso alto: cuenta comprometida modifica permisos en carpeta financiera sin ticket, y usuarios externos acceden después",
      "Caso bajo: el cambio amplió permisos de lectura. Caso alto: el cambio otorgó permisos de escritura a usuarios externos",
    ],
    answer: "C",
  },
  {
    id: "m2-q4",
    type: "multiple",
    question: "¿Cuál es la diferencia entre un IOC y un IOA? ¿Por qué un analista no debería depender exclusivamente de IOC?",
    prompt: "¿Cuál afirmación es correcta?",
    options: [
      "Los IOC detectan ataques en tiempo real; los IOA detectan compromisos que ya ocurrieron. Depender solo de IOC genera retrasos en la respuesta",
      "Los IOA son más confiables que los IOC porque provienen del comportamiento observado, mientras que los IOC pueden estar desactualizados o ser genéricos",
      "Un IOC identifica un artefacto asociado a una amenaza conocida; un IOA identifica comportamiento compatible con una técnica de ataque. Depender solo de IOC deja puntos ciegos ante amenazas nuevas o que cambian sus indicadores",
      "La diferencia es operativa: los IOC los consume el SIEM y los IOA los consume el EDR. Un analista que solo trabaja con SIEM naturalmente depende de IOC",
    ],
    answer: "C",
  },
  {
    id: "m2-q5",
    type: "multiple",
    question: "El SIEM detecta múltiples intentos fallidos de login seguidos de un login exitoso en una cuenta sin MFA a las 3 AM. Usá amenaza, vulnerabilidad, riesgo e impacto para describir la situación.",
    prompt: "¿Cuál descripción aplica correctamente los cuatro conceptos?",
    options: [
      "Amenaza: fuerza bruta. Vulnerabilidad: contraseña débil. Riesgo: cuenta bloqueada por reintentos. Impacto: pérdida de disponibilidad de la cuenta",
      "Amenaza: actor intentando acceso no autorizado. Vulnerabilidad: cuenta sin MFA. Riesgo: acceso exitoso con credenciales comprometidas. Impacto: depende de los privilegios y la actividad posterior",
      "Amenaza: ausencia de MFA. Vulnerabilidad: política de contraseñas débil. Riesgo: alto por horario nocturno. Impacto: posible exfiltración de datos si el usuario tiene acceso a información sensible",
      "Amenaza: login exitoso sospechoso. Vulnerabilidad: monitoreo insuficiente. Riesgo: sin MFA el atacante puede reingresar. Impacto: requiere confirmación antes de evaluarse",
    ],
    answer: "B",
  },
  {
    id: "m2-q6",
    type: "truefalse",
    question: "Un servidor con una vulnerabilidad crítica está expuesto a internet y recibe intentos de explotación. El WAF bloqueó todos los requests. ¿Cerrás la alerta?",
    statement: "Si el WAF bloqueó todos los requests de explotación, el servidor no fue comprometido y la alerta puede cerrarse. La vulnerabilidad queda pendiente para el equipo de gestión de vulnerabilidades.",
    options: VF,
    answer: "B",
  },
  {
    id: "m2-q7",
    type: "multiple",
    question: "¿Qué significa que una organización tiene una gran 'superficie de ataque'? ¿Cómo influye eso en el trabajo diario del analista SOC?",
    prompt: "¿Cuál afirmación describe mejor la implicancia operativa de una superficie de ataque amplia?",
    options: [
      "Que la organización tiene muchos empleados y por lo tanto mayor probabilidad de error humano, lo que requiere más campañas de concientización",
      "Que hay más activos expuestos, más vectores posibles y más fuentes de eventos a monitorear, lo que obliga al analista a priorizar por criticidad y contexto en lugar de tratar todas las alertas igual",
      "Que el perímetro de red es difícil de defender, por lo que el SOC debería concentrar sus recursos en firewall y WAF antes que en endpoints o identidad",
      "Que la organización tiene deuda técnica acumulada, lo que hace que el volumen de vulnerabilidades supere la capacidad del equipo de parcheo",
    ],
    answer: "B",
  },
  {
    id: "m2-q8",
    type: "multiple",
    question: "¿Cuál es la diferencia entre impacto potencial e impacto confirmado?",
    prompt: "¿Cuál par de afirmaciones refleja correctamente la distinción?",
    options: [
      "Potencial: el analista cree que hubo daño. Confirmado: L2 validó que hubo daño. La diferencia es quién lo determina, no la evidencia",
      "Potencial: el evento ocurrió en un activo crítico. Confirmado: el evento ocurrió en un activo crítico y fue bloqueado. La criticidad del activo define si el impacto se confirma",
      "Potencial: hay evidencia de actividad que podría haber afectado la seguridad, pero no se confirmó daño real. Confirmado: existe evidencia concreta de afectación. La diferencia cambia cómo se documenta y cómo se escala",
      "Potencial: el incidente todavía está en curso. Confirmado: el incidente fue contenido. La diferencia indica el estado operativo del caso, no el tipo de evidencia disponible",
    ],
    answer: "C",
  },
];

// ── Módulo 3 ────────────────────────────────────────────────────────────────
const MODULO_3 = [
  {
    id: "m3-q1",
    type: "multiple",
    question: "Un endpoint genera conexiones HTTPS cada 45 segundos hacia sync-cloud-check.net. El proceso es update_service.exe ubicado en AppData\\Roaming, sin firma digital y visto por primera vez hoy. ¿Qué hipótesis plantearías y qué validarías?",
    prompt: "¿Cuál es el conjunto de hipótesis y pasos de validación más completo y correcto?",
    options: [
      "Hipótesis: posible falso positivo de herramienta de actualización corporativa. Validar: consultar con el equipo de IT si desplegaron algo nuevo y cerrar si confirman",
      "Hipótesis: beaconing compatible con C2. Validar: reputación del dominio, proceso padre de update_service.exe, si el archivo es nuevo en el host, si hay otros endpoints con el mismo proceso, y actividad previa que explique su origen",
      "Hipótesis: malware confirmado. Acción: aislar inmediatamente el endpoint y escalar a IR sin más análisis porque el patrón periódico y la ruta son concluyentes",
      "Hipótesis: exfiltración de datos. Validar: volumen de datos transferidos por sesión, porque si es menor a 1MB probablemente sea legítimo",
    ],
    answer: "B",
  },
  {
    id: "m3-q2",
    type: "multiple",
    question: "El EDR detecta WINWORD.EXE → powershell.exe -nop -w hidden -enc → conexión a raw.githubusercontent.com → archivo creado en C:\\Users\\Public. El usuario pertenece a RRHH. ¿Qué hace que esta alerta sea de alta prioridad?",
    prompt: "¿Cuál combinación de factores justifica la alta prioridad?",
    options: [
      "El dominio raw.githubusercontent.com tiene mala reputación y cualquier conexión hacia él desde un endpoint corporativo es crítica",
      "PowerShell con parámetros de evasión iniciado por Word indica posible ejecución de macro maliciosa; el usuario no técnico no tiene razón para que Word ejecute comandos codificados, y el archivo creado en ruta pública puede ser un payload",
      "La alta prioridad viene del parámetro -enc, que siempre indica actividad maliciosa porque es el único parámetro que oculta comandos en Base64",
      "Es alta prioridad porque el archivo fue creado en C:\\Users\\Public, que es una ruta restringida donde solo pueden escribir procesos con privilegios elevados",
    ],
    answer: "B",
  },
  {
    id: "m3-q3",
    type: "multiple",
    question: "Un host genera 480 consultas DNS en 15 minutos con patrones como 'akd92kdkd-check.com', 'plq77smmx-update.net'. Todas responden NXDOMAIN. ¿Qué patrón podría representar y qué pasos seguirías?",
    prompt: "¿Cuál análisis es correcto?",
    options: [
      "Es tráfico de spam o malvertising: el navegador cargó páginas con muchos trackers. Validar que el usuario no esté en sitios sospechosos y cerrar si no hay descarga asociada",
      "El patrón de subdominios aleatorios con NXDOMAIN puede indicar un algoritmo de generación de dominios (DGA) intentando contactar su C2. Validar: proceso que genera las consultas, si el volumen es inusual para ese host, si ocurre en otros endpoints y si hay alguna conexión exitosa entre las fallidas",
      "NXDOMAIN confirma que los dominios no existen y que ninguna conexión fue exitosa, por lo que el riesgo real es bajo. Registrar y monitorear sin escalar",
      "Son dominios con patrones de typosquatting orientados a phishing. Validar si el usuario intentó ingresar a alguno manualmente y si hay credenciales comprometidas en los logs de autenticación",
    ],
    answer: "B",
  },
  {
    id: "m3-q4",
    type: "truefalse",
    question: "¿Cuál es la diferencia entre un firewall que muestra 'Action: Blocked' y un caso cerrado? ¿Qué información adicional necesitaría un analista antes de cerrar?",
    statement: "Si el firewall registra 'Action: Blocked' para una conexión saliente hacia un dominio sospechoso, el riesgo quedó mitigado por el control y el analista puede cerrar la alerta documentando que fue bloqueada.",
    options: VF,
    answer: "B",
  },
  {
    id: "m3-q5",
    type: "multiple",
    question: "Describí cómo diferenciarías actividad legítima de IT (despliegue masivo de software) de movimiento lateral usando SMB. ¿Qué elementos validarías en cada caso?",
    prompt: "¿Cuál par de descripciones refleja correctamente los elementos diferenciadores?",
    options: [
      "Legítimo: muchos destinos conectados. Sospechoso: pocos destinos conectados. La cantidad de hosts afectados es el indicador principal",
      "Legítimo: ticket de cambio aprobado, host origen administrativo, herramienta corporativa firmada, ventana de mantenimiento, destinos dentro del alcance del ticket. Sospechoso: origen desde endpoint de usuario, cuenta sin privilegios habituales para esa acción, sin ticket, fuera de horario, con acceso a shares administrativos como ADMIN$ o C$",
      "Legítimo: el proceso usa puertos estándar SMB (445). Sospechoso: el proceso usa puertos alternativos o no estándar para la transferencia. El puerto es el elemento más discriminante en este caso",
      "Legítimo: el despliegue se hace con credenciales de dominio. Sospechoso: el movimiento lateral siempre requiere credenciales locales o hashes robados, lo que lo hace detectable por el tipo de autenticación",
    ],
    answer: "B",
  },
  {
    id: "m3-q6",
    type: "multiple",
    question: "El firewall muestra una conexión de USER-LAP-088 hacia suspicious-domain.com puerto 443 permitida. El EDR no está disponible en ese endpoint. ¿Cómo documentarías las limitaciones y qué próximos pasos recomendarías?",
    prompt: "¿Cuál documentación y plan de acción es más correcto?",
    options: [
      "Documentar que el EDR no detectó actividad maliciosa en el endpoint y cerrar, ya que la ausencia de alerta del EDR indica que no hubo ejecución de código",
      "Documentar que la visibilidad está limitada a nivel de red (firewall): se tiene IP, destino y acción, pero no el proceso que generó la conexión ni actividad en el endpoint. Recomendar: buscar el host en otras fuentes disponibles (DNS, proxy, SIEM), verificar reputación del dominio, evaluar si el host puede obtener agente EDR, y escalar si el dominio tiene reputación maliciosa confirmada",
      "Documentar que el dominio fue contactado exitosamente y escalar como incidente confirmado porque la conexión fue permitida hacia un dominio sospechoso, lo que prueba que hubo comunicación maliciosa",
      "Recomendar instalar el EDR antes de continuar el análisis, ya que sin visibilidad de endpoint no es posible determinar nada y cualquier conclusión sería especulativa",
    ],
    answer: "B",
  },
  {
    id: "m3-q7",
    type: "multiple",
    question: "¿Por qué el modelo OSI es útil para el trabajo SOC? Usá el ejemplo de 'un usuario no puede acceder a una aplicación' para mostrar cómo ayudaría a ordenar el diagnóstico.",
    prompt: "¿Cuál respuesta demuestra el uso correcto del modelo OSI como herramienta de diagnóstico?",
    options: [
      "El modelo OSI es útil para saber qué protocolo está fallando. En el ejemplo, hay que revisar directamente la capa 7 (aplicación) porque el problema es de acceso a una aplicación",
      "El modelo OSI permite descartar capas de forma ordenada: primero verificar si hay conectividad (capas 1-3), luego si el puerto responde (capa 4), si la sesión se establece (capa 5), si hay problema de cifrado o certificado (capa 6), y finalmente si la aplicación responde correctamente con las credenciales del usuario (capa 7). Cada capa descartada reduce el espacio del problema",
      "El modelo OSI es útil principalmente para el equipo de redes, no para el SOC. En el ejemplo, el analista debería escalar directamente al equipo de infraestructura porque el problema puede estar en cualquier capa",
      "El modelo OSI ayuda a identificar si el problema es de red o de aplicación. En el ejemplo, si el ping responde, el problema está en capa 7 y el SOC no tiene responsabilidad de diagnóstico",
    ],
    answer: "B",
  },
  {
    id: "m3-q8",
    type: "multiple",
    question: "Una cuenta admin.backup inicia sesión a las 3 AM desde una notebook de usuario sin MFA, accede a 12 servidores y crea un servicio remoto. Analizá usando los conceptos del módulo.",
    prompt: "¿Cuál análisis aplica correctamente los conceptos de protocolo, movimiento lateral, autenticación y visibilidad?",
    options: [
      "La cuenta admin.backup puede tener actividad nocturna normal para tareas de backup. Validar si existe un job programado que explique el horario y los accesos, y cerrar si se confirma",
      "El acceso desde notebook de usuario (no host administrativo), sin MFA en cuenta privilegiada, con propagación a 12 servidores y creación de servicio remoto a las 3 AM sin ticket visible combina múltiples señales de movimiento lateral. Validar: ticket de cambio, proceso que creó el servicio, binario instalado, si la cuenta tenía historial de este comportamiento, y correlacionar con alertas previas en los hosts destino",
      "Es un incidente confirmado de movimiento lateral porque ninguna cuenta de backup legítima necesita crear servicios remotos. Aislar todos los servidores afectados y revocar la cuenta de inmediato",
      "El principal indicador de compromiso es la ausencia de MFA, porque todos los demás comportamientos podrían explicarse operativamente. Habilitar MFA en la cuenta y monitorear si la actividad continúa",
    ],
    answer: "B",
  },
];

// ── Módulo 4 ────────────────────────────────────────────────────────────────
const MODULO_4 = [
  {
    id: "m4-q1",
    type: "multiple",
    question: "Un EDR genera la alerta 'Trojan.Generic' sobre un archivo en Downloads. La acción fue 'Blocked'. ¿Qué pasos de análisis debería hacer antes de cerrar el caso?",
    prompt: "¿Cuál es el conjunto de pasos más completo y correcto antes de cerrar?",
    options: [
      "Verificar que la acción fue 'Blocked', confirmar que el archivo está en cuarentena y cerrar el caso documentando que el control actuó correctamente",
      "Consultar la reputación del hash en VirusTotal — si hay más de 10 detecciones, escalar; si hay menos, cerrar",
      "Revisar el proceso padre del archivo, si hubo actividad posterior (conexiones, archivos creados, persistencia), buscar el mismo hash en otros endpoints y validar si hubo ejecución previa al bloqueo",
      "Revisar si el usuario tiene historial de alertas similares — si es recurrente, es probable que sea un falso positivo del EDR",
    ],
    answer: "C",
  },
  {
    id: "m4-q2",
    type: "multiple",
    question: "Observás la secuencia: WINWORD.EXE → powershell.exe -nop -w hidden -enc → HTTPS a un dominio nuevo → creación de update.exe en C:\\Users\\Public. ¿Qué hipótesis plantearías y qué decisión tomarías?",
    prompt: "¿Cuál hipótesis y decisión son correctas para esta secuencia?",
    options: [
      "Hipótesis: el usuario ejecutó un script de actualización desde un adjunto. Decisión: validar con el usuario si esperaba una actualización antes de escalar",
      "Hipótesis: secuencia compatible con ejecución inicial mediante documento, descarga de payload y posible C2. Decisión: escalar con evidencia completa y evaluar aislamiento del endpoint",
      "Hipótesis: posible falso positivo de macro corporativa. Decisión: revisar si existe un ticket de cambio que justifique la actividad de PowerShell antes de tomar cualquier acción",
      "Hipótesis: malware confirmado tipo ransomware. Decisión: aislar el endpoint de inmediato y notificar al área de negocio sobre posible cifrado de archivos",
    ],
    answer: "B",
  },
  {
    id: "m4-q3",
    type: "multiple",
    question: "El SOC recibe una alerta: schtasks.exe creó la tarea 'OneDriveUpdate' que ejecuta C:\\Users\\Public\\svcupdate.exe cada 10 minutos. ¿Por qué es sospechoso? ¿Qué verificarías?",
    prompt: "¿Cuál análisis identifica correctamente los indicadores de sospecha?",
    options: [
      "Es sospechoso porque OneDrive no debería actualizarse tan frecuentemente. Verificar si la versión de OneDrive está desactualizada y si hay un ticket de actualización activo",
      "Es sospechoso porque schtasks.exe solo es usado por malware. Verificar si existe la tarea en el registro de tareas programadas del sistema",
      "Es sospechoso por la combinación de nombre engañoso (simula ser de OneDrive), binario en ruta pública no estándar y frecuencia de ejecución alta. Verificar proceso que creó la tarea, hash y firma de svcupdate.exe, y si hay conexiones externas posteriores",
      "Es sospechoso porque las tareas programadas no deberían ejecutarse con frecuencia menor a 30 minutos. Verificar si la tarea fue creada durante el horario laboral o fuera de él",
    ],
    answer: "C",
  },
  {
    id: "m4-q4",
    type: "truefalse",
    question: "Un host muestra beaconing cada 60 segundos hacia cdn-health-check.net. El proceso es update.exe en C:\\Users\\Public\\ sin firma digital, creado hoy. ¿Qué diferencia esto de un agente de seguridad legítimo?",
    statement: "Si el dominio cdn-health-check.net no aparece como malicioso en ninguna fuente de Threat Intelligence, el beaconing puede considerarse legítimo y el caso puede cerrarse.",
    options: VF,
    answer: "B",
  },
  {
    id: "m4-q5",
    type: "multiple",
    question: "Ves: rrhh.silva desde HR-LAP-044 conecta por SMB a 37 servidores en 6 minutos con 21 autenticaciones fallidas. Un ejecutable invoice_update.exe fue detectado 20 minutos antes en ese host. ¿Qué hipótesis plantearías?",
    prompt: "¿Cuál hipótesis es más correcta para esta combinación de eventos?",
    options: [
      "El usuario puede estar haciendo un inventario de red autorizado. La hipótesis principal es actividad administrativa no documentada — solicitar que el usuario justifique la actividad antes de escalar",
      "Las 21 autenticaciones fallidas sugieren que las credenciales del usuario están bloqueadas y el sistema está reintentando. Hipótesis: problema de autenticación de dominio en el endpoint",
      "La combinación de ejecución de invoice_update.exe y conexión SMB masiva posterior desde un usuario no técnico a 37 servidores es compatible con movimiento lateral post-compromiso, posiblemente con credenciales robadas o hash dumping",
      "La hipótesis más probable es un gusano de red (worm) que se propaga automáticamente, ya que los 37 servidores y los intentos fallidos son indicadores típicos de propagación automatizada sin intervención humana",
    ],
    answer: "C",
  },
  {
    id: "m4-q6",
    type: "multiple",
    question: "El usuario legal.romero subió 4.8GB a drive.google.com desde chrome.exe. Antes accedió a Contratos_Confidenciales y creó contratos.zip. ¿Es exfiltración confirmada? ¿Qué deberías validar?",
    prompt: "¿Cuál respuesta aplica correctamente el criterio de \"hipótesis, no afirmación\"?",
    options: [
      "Sí, es exfiltración confirmada: el acceso a carpeta sensible, la compresión y la subida de alto volumen a cuenta personal son evidencia directa y suficiente para confirmar",
      "No es exfiltración — drive.google.com está permitido en la organización. Sin bloqueo del proxy, no hay evidencia de actividad maliciosa",
      "No está confirmada aún: la actividad es compatible con posible exfiltración, pero se debe validar si el destino es cuenta personal o corporativa, si el usuario tenía autorización para acceder y comprimir esos archivos, y si existe contexto operativo que lo justifique",
      "No es exfiltración porque el proceso fue chrome.exe, que es un navegador legítimo. Los controles de DLP deberían haber bloqueado la transferencia si fuera realmente sensible",
    ],
    answer: "C",
  },
  {
    id: "m4-q7",
    type: "multiple",
    question: "Describí la diferencia entre una alerta WAF de 'SQL Injection - Blocked' (respuesta 403) y una de 'Command Injection - Alert Only' donde el EDR muestra apache2→bash→curl. ¿Qué harías en cada caso?",
    prompt: "¿Cuál describe correctamente la diferencia y la acción apropiada en cada caso?",
    options: [
      "Ambas son igualmente prioritarias porque involucran ataques de inyección. En los dos casos escalar inmediatamente a IR sin distinción",
      "SQL Injection bloqueada: escalar porque el intento llegó al servidor. Command Injection en alert only: monitorear ya que el WAF no la marcó como crítica",
      "SQL Injection bloqueada (403): el WAF actuó, el servidor no procesó el payload — documentar el intento, monitorear el origen y validar si hay patrón. Command Injection en alert only con apache2→bash→curl: el WAF no bloqueó y el EDR muestra ejecución real en el servidor — escalar inmediatamente",
      "SQL Injection bloqueada: cerrar porque el control fue efectivo. Command Injection en alert only: revisar si el curl tuvo respuesta exitosa, y solo escalar si se confirma descarga de payload",
    ],
    answer: "C",
  },
  {
    id: "m4-q8",
    type: "multiple",
    question: "¿Qué significa clasificar malware por comportamiento en lugar de por nombre de detección? Dá un ejemplo con la diferencia entre 'Es ransomware' y la forma correcta de documentarlo.",
    prompt: "¿Cuál opción ejemplifica correctamente la distinción entre afirmación y clasificación por comportamiento?",
    options: [
      "Clasificar por comportamiento significa esperar a que el fabricante del EDR confirme la familia antes de documentar. \"Es ransomware\" es incorrecto hasta que haya un análisis forense externo",
      "Clasificar por comportamiento significa describir lo que ocurrió técnicamente: \"La actividad es compatible con ransomware, basado en modificación masiva de archivos, cambio de extensión y eliminación de shadow copies\" en lugar de afirmar \"Es ransomware\" sin evidencia completa",
      "La diferencia es semántica: ambas formas de documentar son válidas, pero \"Es ransomware\" es preferible porque es más claro para el escalamiento a IR y al área de negocio",
      "Clasificar por comportamiento significa que el analista no puede nombrar el tipo de malware hasta tener el hash analizado en un sandbox, independientemente de la evidencia observable en logs y EDR",
    ],
    answer: "B",
  },
];

// ── Módulo 5 ────────────────────────────────────────────────────────────────
const MODULO_5 = [
  {
    id: "m5-q1",
    type: "multiple",
    question: "Llega una alerta Severity:High por PowerShell ejecutado por soporte.admin en IT-ADM-02 con un ticket aprobado de despliegue de agente. ¿Cómo la analizarías y qué decisión tomarías?",
    prompt: "¿Cuál es el análisis y la decisión más correcta?",
    options: [
      "Revisar que el ticket exista, verificar que el host y el usuario coincidan con el alcance, confirmar que no hubo actividad sospechosa posterior y cerrar como actividad autorizada documentando el contexto",
      "Cerrar de inmediato porque si hay ticket aprobado el riesgo queda mitigado y la severidad alta es solo resultado de la regla genérica de PowerShell",
      "Escalar porque cualquier alerta Severity:High en un host administrativo debe revisarse por un nivel superior antes de cerrar, independientemente del contexto disponible",
      "Cerrar como falso positivo porque soporte.admin es un usuario técnico conocido y la actividad de despliegue de agentes es habitual en esa área",
    ],
    answer: "A",
  },
  {
    id: "m5-q2",
    type: "multiple",
    question: "La misma alerta de PowerShell aparece para rrhh.silva en HR-LAP-044, con Parent Process WINWORD.EXE, comando codificado y conexión externa. ¿Qué cambia en el análisis?",
    prompt: "¿Cuál describe correctamente qué cambia y por qué?",
    options: [
      "Cambia la severidad asignada por la herramienta, que en este caso debería ser más alta porque el usuario no es técnico y el host es un laptop de usuario",
      "Cambia el contexto completo: el proceso padre Office, el parámetro -enc y la conexión externa son señales independientes que juntas forman una cadena compatible con ejecución inicial — escalar con prioridad",
      "Cambia el host de destino porque HR-LAP-044 no es un servidor crítico, lo que reduce la urgencia respecto a un servidor productivo o un controlador de dominio",
      "Cambia solo el usuario involucrado, pero el análisis de PowerShell sigue siendo igual porque la línea de comandos y el proceso padre aplican las mismas reglas en cualquier contexto",
    ],
    answer: "B",
  },
  {
    id: "m5-q3",
    type: "truefalse",
    question: "Un login exitoso con MFA aparece desde una IP extranjera. Después se crea una regla de correo y se descargan 1,200 archivos de SharePoint. ¿MFA exitoso descarta compromiso? ¿Qué decidís?",
    statement: "MFA exitoso desde una IP extranjera descarta compromiso porque el segundo factor garantiza que la persona detrás de la cuenta autorizó el acceso. La regla de correo y la descarga posterior son actividad normal que puede cerrarse sin escalar.",
    options: VF,
    answer: "B",
  },
  {
    id: "m5-q4",
    type: "multiple",
    question: "Se detecta una conexión periódica cada 60 segundos desde svcupdate.exe en C:\\Users\\Public\\ hacia un dominio poco frecuente. No hay EDR disponible. ¿Podés confirmar C2? ¿Qué hacés?",
    prompt: "¿Cuál respuesta aplica correctamente el manejo de incertidumbre y la decisión?",
    options: [
      "No se puede confirmar C2 sin EDR, por lo que lo correcto es esperar a tener visibilidad completa antes de tomar cualquier acción o documentar el caso",
      "Sí se puede confirmar C2 porque la periodicidad de 60 segundos, la ruta pública y el dominio poco frecuente son suficientes para concluir que hay comunicación maliciosa activa",
      "No se confirma C2, pero el patrón es compatible con posible comunicación externa automatizada. Documentar la limitación de visibilidad, buscar el dominio en otras fuentes y escalar preventivamente dado el riesgo potencial",
      "No se puede confirmar C2 sin EDR, por eso lo correcto es cerrar con una nota de falta de visibilidad y reabrir si el dominio aparece en fuentes de Threat Intelligence",
    ],
    answer: "C",
  },
  {
    id: "m5-q5",
    type: "multiple",
    question: "Un WAF alerta por Command Injection y el payload fue permitido (respuesta 200). El EDR muestra nginx→bash→curl y creación de /tmp/a.sh. ¿Es solo una alerta WAF? ¿Qué decidís?",
    prompt: "¿Cuál análisis y decisión son correctos?",
    options: [
      "Es una alerta WAF que requiere monitoreo porque aunque el payload fue permitido, el EDR no confirma que el script descargado haya sido ejecutado completamente",
      "No es solo una alerta WAF. La respuesta 200 indica que el payload fue procesado, y el EDR muestra ejecución real en el servidor con proceso web iniciando bash y curl hacia destino externo. Escalar de forma inmediata",
      "Es una alerta WAF de media prioridad porque Command Injection con respuesta 200 es frecuente en aplicaciones no actualizadas y no siempre resulta en ejecución de comandos real",
      "No es solo una alerta WAF pero tampoco confirma compromiso porque /tmp/a.sh fue creado y no necesariamente ejecutado. Esperar evidencia de ejecución antes de escalar",
    ],
    answer: "B",
  },
  {
    id: "m5-q6",
    type: "multiple",
    question: "proyectos.luna subió 6.2 GB a Dropbox. El usuario confirma que era para un proveedor. No hay señales de compromiso de cuenta. ¿Cerrás como falso positivo? ¿Qué falta revisar?",
    prompt: "¿Cuál es la categoría de cierre y las validaciones pendientes correctas?",
    options: [
      "Sí es falso positivo porque el usuario confirmó la actividad, no hay señales de compromiso de cuenta y Dropbox es un servicio permitido en muchas organizaciones",
      "No es falso positivo. Es actividad legítima pero posiblemente fuera de política. Falta validar si el destino era cuenta personal o corporativa, si los archivos subidos eran información sensible del proyecto y si existe política aplicable",
      "Sí es falso positivo porque sin señales de compromiso de cuenta la transferencia de datos no puede considerarse exfiltración, independientemente del volumen o el contenido",
      "No es falso positivo y debe escalarse a IR porque cualquier transferencia de más de 1 GB hacia servicios de almacenamiento externos es exfiltración probable que requiere análisis forense",
    ],
    answer: "B",
  },
  {
    id: "m5-q7",
    type: "multiple",
    question: "Un analista escribe 'Falso positivo' como cierre de una alerta de PowerShell sin más detalle. ¿Qué problemas tiene esa documentación y cómo la mejorarías?",
    prompt: "¿Cuál identifica correctamente los problemas y la mejora?",
    options: [
      "El único problema es que 'Falso positivo' puede ser impreciso — sería mejor escribir 'actividad autorizada' o 'benigno confirmado' dependiendo del contexto, sin necesidad de agregar más información",
      "No tiene problemas si el analista revisó el caso correctamente. La etiqueta de cierre es suficiente para el registro y la documentación detallada solo aplica cuando se escala el caso",
      "No permite saber qué se revisó, qué evidencia lo justifica ni qué limitaciones existían. Una mejora incluiría qué proceso disparó la alerta, qué ticket o contexto lo valida, qué actividad posterior se revisó y por qué se concluye que no hay riesgo",
      "El problema es que 'Falso positivo' no es una etiqueta estándar en todos los SIEMs, lo que dificulta el reporting. La mejora sería usar la terminología del sistema de tickets en lugar de lenguaje descriptivo libre",
    ],
    answer: "C",
  },
  {
    id: "m5-q8",
    type: "multiple",
    question: "Describí cuándo usarías cada una de las cuatro decisiones posibles (cerrar, monitorear, validar, escalar) y qué información necesitás para tomar cada una.",
    prompt: "¿Cuál describe correctamente las cuatro decisiones y sus condiciones?",
    options: [
      "Cerrar: sin evidencia técnica. Monitorear: evidencia débil con activo crítico. Validar: hay ticket pero la actividad no coincide. Escalar: cuando el analista no tiene experiencia suficiente para tomar la decisión solo",
      "Cerrar: actividad benigna o bloqueada sin señales adicionales, con contexto validado. Monitorear: evidencia insuficiente para escalar pero no suficiente para cerrar. Validar: contexto operativo puede cambiar la interpretación. Escalar: evidencia indica riesgo o posible compromiso",
      "Cerrar: cuando la alerta fue bloqueada por el control. Monitorear: cuando el dominio o IP no tiene reputación negativa. Validar: cuando el usuario involucrado es técnico y puede explicar la actividad. Escalar: solo en alertas de severidad alta o crítica",
      "Cerrar: cuando el analista no encontró nada relevante en el tiempo disponible. Monitorear: cuando la alerta se repite con frecuencia y parece ruido. Validar: cuando el ticket existe pero no cubre exactamente lo que se observó. Escalar: cuando hay actividad posterior confirmada",
    ],
    answer: "B",
  },
];

// ── Módulo 6 ────────────────────────────────────────────────────────────────
const MODULO_6 = [
  {
    id: "m6-q1",
    type: "multiple",
    question: "¿Cuál es la diferencia entre analizar una alerta y responder inicialmente a un posible incidente?",
    prompt: "¿Cuál describe correctamente la diferencia y da un ejemplo de cada uno?",
    options: [
      "Analizar es lo que hace el SOC y responder es lo que hace IR — son responsabilidades de equipos distintos que no se superponen en ningún momento del proceso",
      "Analizar responde '¿qué está pasando?' usando logs, contexto y evidencia. Responder inicialmente responde '¿qué hacemos ahora?' coordinando acciones con criterio operativo",
      "La diferencia es temporal: analizar ocurre antes y responder ocurre después. Una vez que se escala, el análisis termina y solo existe la respuesta",
      "Son lo mismo con distintos nombres: toda alerta requiere las mismas acciones independientemente de si hay evidencia suficiente de compromiso",
    ],
    answer: "B",
  },
  {
    id: "m6-q2",
    type: "multiple",
    question: "Clasificá estas acciones: (A) revisar process tree, (B) aislar un servidor de pagos, (C) exportar logs del SIEM, (D) borrar el archivo sospechoso, (E) consultar reputación del hash.",
    prompt: "¿Cuál clasificación es correcta?",
    options: [
      "A=segura, B=segura, C=segura, D=requiere autorización, E=segura — borrar el archivo sospechoso siempre requiere coordinación pero no destruye evidencia si el EDR ya lo capturó",
      "A=segura, B=requiere autorización, C=segura, D=no recomendada sin preservar primero, E=segura",
      "A=segura, B=requiere autorización, C=requiere autorización, D=no recomendada sin preservar, E=segura — exportar logs puede afectar el rendimiento del SIEM y requiere coordinación",
      "Todas son seguras excepto B — cualquier acción que no modifique el endpoint del usuario puede realizarse sin autorización previa",
    ],
    answer: "B",
  },
  {
    id: "m6-q3",
    type: "multiple",
    question: "Se detecta update.exe en C:\\Users\\Public\\ con conexión periódica externa y tarea programada. ¿Qué evidencia preservarías antes de aislar el endpoint? ¿Qué podría perderse si reiniciás el equipo antes de registrar algo?",
    prompt: "¿Cuál respuesta aplica correctamente los criterios de preservación?",
    options: [
      "Preservar el hash del archivo y el nombre de la tarea programada. Si se reinicia el equipo, puede perderse la configuración de red, pero el EDR guarda automáticamente toda la información de procesos",
      "Preservar process tree, command line, hash, ruta, tarea programada, IPs de conexión y timestamps. Si se reinicia, se pierden: procesos activos, conexiones abiertas, estado en memoria y archivos temporales que el malware pueda haber creado",
      "Preservar únicamente el hash del archivo para análisis de reputación. La tarea programada puede reconstruirse desde los logs del sistema, y el reinicio no afecta la información que ya fue registrada por el SIEM",
      "Preservar la tarea programada y la conexión externa. El reinicio puede afectar la tarea, pero no la actividad de red porque el firewall ya registró las conexiones y ese dato no es volátil",
    ],
    answer: "B",
  },
  {
    id: "m6-q4",
    type: "multiple",
    question: "legal.romero tiene un login anómalo con regla de reenvío externa y descarga de 1,200 archivos. ¿Qué equipos involucrarías y en qué orden? ¿Cuál es el impacto técnico vs el impacto de negocio de este caso?",
    prompt: "¿Cuál describe correctamente los equipos y la distinción de impacto?",
    options: [
      "Involucrar primero a IT para validar el login, luego a negocio para confirmar si los archivos eran sensibles. El impacto técnico y de negocio son equivalentes en este caso porque la cuenta accede a información legal",
      "Involucrar a Identidad/IAM para revocar sesiones y revisar OAuth, a IR para análisis del posible compromiso, y a negocio para evaluar qué información fue accedida. Impacto técnico: cuenta comprometida con regla de exfiltración y OAuth activo. Impacto de negocio: exposición de información legal sensible con posible incumplimiento regulatorio",
      "Involucrar solo a IR porque es un posible incidente de seguridad. Identidad y negocio solo participan si IR confirma el compromiso. El impacto de negocio no puede evaluarse hasta tener la confirmación técnica",
      "Involucrar a negocio primero porque la cuenta accede a información legal. Luego a IT para el bloqueo de la cuenta. El impacto técnico es bajo porque el MFA fue exitoso, lo que reduce significativamente el riesgo de acceso no autorizado",
    ],
    answer: "B",
  },
  {
    id: "m6-q5",
    type: "multiple",
    question: "Redactá un escalamiento útil para el caso FIN-LAP-022 / finanzas.paz / WINWORD→PS -enc / update.exe en Public / conexión a billing-check-update.net / Allowed / sin ticket. El anterior decía: 'PowerShell sospechoso, revisar.'",
    prompt: "¿Cuál es el escalamiento más útil y accionable?",
    options: [
      "\"Alerta de PowerShell en FIN-LAP-022, usuario finanzas.paz. El EDR lo detectó como sospechoso. Severidad alta según la herramienta. Se recomienda revisión urgente por el equipo de IR.\"",
      "\"Se observó WINWORD.EXE ejecutando powershell.exe con -enc en FIN-LAP-022 (finanzas.paz). Se creó update.exe en C:\\Users\\Public\\ y se detecta conexión periódica hacia billing-check-update.net (Allowed). Sin ticket asociado. Se recomienda análisis del archivo y evaluación de aislamiento del endpoint.\"",
      "\"Malware confirmado en FIN-LAP-022. Usuario de Finanzas comprometido. Posible C2 activo. Se requiere aislamiento inmediato del equipo y notificación al área de negocio sobre posible impacto operativo.\"",
      "\"PowerShell con parámetro -enc ejecutado por finanzas.paz. Esto indica evasión de controles de seguridad. El parámetro -enc siempre confirma actividad maliciosa. Se escaló para análisis forense completo.\"",
    ],
    answer: "B",
  },
  {
    id: "m6-q6",
    type: "truefalse",
    question: "WEB-PAY-01 muestra w3wp.exe→cmd.exe→whoami y shell.aspx en /uploads. ¿Por qué no deberías apagar el servidor inmediatamente? ¿Qué acciones iniciales harías y con qué equipos?",
    statement: "Ante un posible web shell en WEB-PAY-01 (portal de pagos activo), la primera acción correcta es apagar el servidor para contener la amenaza, ya que aislar el riesgo técnico siempre tiene prioridad sobre la continuidad operativa.",
    options: VF,
    answer: "B",
  },
  {
    id: "m6-q7",
    type: "multiple",
    question: "¿Cuándo corresponde escalar con evidencia incompleta? Dá dos ejemplos de situaciones donde esperar certeza perfecta sería un error.",
    prompt: "¿Cuál describe correctamente cuándo escalar con limitaciones y da los ejemplos más apropiados?",
    options: [
      "Solo corresponde escalar con evidencia incompleta cuando hay más de tres indicadores sospechosos simultáneos. Con menos, lo correcto es monitorear hasta tener certeza suficiente para no generar falsas alarmas",
      "Corresponde escalar cuando el riesgo potencial supera el costo de esperar más evidencia, documentando las limitaciones. Ejemplo 1: activo crítico (DC o servidor de pagos) con poca evidencia — el impacto potencial justifica escalar. Ejemplo 2: ransomware posible en curso — esperar más evidencia puede permitir que el cifrado continúe",
      "Escalar con evidencia incompleta siempre es un error porque genera carga operativa innecesaria en IR. Lo correcto es monitorear hasta poder confirmar técnicamente antes de involucrar a otros equipos",
      "Corresponde escalar cuando la herramienta asigna severidad alta, independientemente de la evidencia disponible. La severidad de la herramienta es el criterio más confiable para definir cuándo actuar sin esperar más contexto",
    ],
    answer: "B",
  },
  {
    id: "m6-q8",
    type: "multiple",
    question: "Describí los 7 pasos de la secuencia operativa y explicá qué puede ocurrir en paralelo en casos de alta urgencia.",
    prompt: "¿Cuál describe correctamente los 7 pasos y el comportamiento en paralelo?",
    options: [
      "Los 7 pasos son: detectar, alertar, clasificar, escalar, contener, remediar y cerrar. En casos de alta urgencia todos los pasos pueden ocurrir simultáneamente si el equipo tiene capacidad suficiente",
      "Los 7 pasos son: confirmar lo básico, revisar evidencia mínima, evaluar criticidad e impacto, preservar lo indispensable, decidir según playbook, escalar/validar/contener, y comunicar próximos pasos. En casos críticos, preservar puede ocurrir mientras se escala, y coordinar con negocio puede suceder mientras se prepara la contención",
      "Los 7 pasos son: detectar, analizar, documentar, validar, escalar, contener y comunicar. En casos de alta urgencia se saltean los pasos de análisis y validación para reducir el tiempo de respuesta",
      "Los 7 pasos aplican solo en incidentes confirmados. Para alertas que todavía están en análisis, la secuencia no aplica porque no hay suficiente certeza para iniciar una respuesta estructurada",
    ],
    answer: "B",
  },
];

// ── Placeholder: copia un módulo con ids propios del módulo destino ─────────
// Así, cuando lleguen las preguntas reales de 7 y 8, solo cambia el array:
// los ids ya tienen el prefijo correcto y nada más del sistema se entera.
function placeholderFrom(sourceQuestions, targetModule) {
  return sourceQuestions.map((q, i) => ({ ...q, id: `m${targetModule}-q${i + 1}` }));
}

// ══════════════════════════════════════════════════════════════════════════════
//  ÁRBOL DE PREGUNTAS — una entrada por módulo, en orden (modulo1 … modulo8)
// ══════════════════════════════════════════════════════════════════════════════
const BANCO_PREGUNTAS = {
  modulo1: MODULO_1,
  modulo2: MODULO_2,
  modulo3: MODULO_3,
  modulo4: MODULO_4,
  modulo5: MODULO_5,
  modulo6: MODULO_6,
  modulo7: placeholderFrom(MODULO_6, 7), // ⚠️ PLACEHOLDER — reemplazar por MODULO_7
  modulo8: placeholderFrom(MODULO_6, 8), // ⚠️ PLACEHOLDER — reemplazar por MODULO_8
};

// ══════════════════════════════════════════════════════════════════════════════
//  Helpers internos — normalización, validación al arrancar y corrección
// ══════════════════════════════════════════════════════════════════════════════

// Normaliza el texto para que diferencias invisibles (espacios dobles,
// saltos de línea, formas Unicode distintas de la misma tilde) no hagan
// fallar una respuesta correcta.
function normalize(text) {
  return String(text).normalize("NFC").replace(/\s+/g, " ").trim();
}

const MAX_ANSWER_LENGTH = 3000;

// Se arma UNA vez al cargar el módulo. Si algo del banco está mal escrito
// (letra inexistente, opciones duplicadas, ids repetidos) el servidor no
// arranca y el error dice exactamente qué pregunta revisar — mejor eso que
// descubrirlo cuando un alumno no puede aprobar.
const COMPILED = {};

for (const [moduleKey, questions] of Object.entries(BANCO_PREGUNTAS)) {
  if (!Array.isArray(questions) || questions.length === 0) {
    throw new Error(`[bancoPreguntasModernSoc] ${moduleKey} no tiene preguntas`);
  }

  const byId = new Map();

  for (const q of questions) {
    const where = `[bancoPreguntasModernSoc] ${moduleKey} → ${q.id ?? "(sin id)"}`;

    if (!q.id || typeof q.id !== "string")        throw new Error(`${where}: falta id`);
    if (byId.has(q.id))                            throw new Error(`${where}: id duplicado`);
    if (!q.question)                               throw new Error(`${where}: falta question`);
    if (!Array.isArray(q.options) || q.options.length < 2) {
      throw new Error(`${where}: necesita al menos 2 opciones`);
    }

    const normalizedOptions = q.options.map(normalize);
    if (new Set(normalizedOptions).size !== normalizedOptions.length) {
      throw new Error(`${where}: hay opciones repetidas (la corrección por texto sería ambigua)`);
    }

    const correctIndex = typeof q.answer === "string"
      ? q.answer.trim().toUpperCase().charCodeAt(0) - 65
      : -1;
    if (correctIndex < 0 || correctIndex >= q.options.length) {
      throw new Error(`${where}: answer "${q.answer}" no corresponde a ninguna opción`);
    }

    byId.set(q.id, {
      ...q,
      correctNormalized: normalizedOptions[correctIndex],
    });
  }

  COMPILED[moduleKey] = { questions, byId };
}

function getModule(moduleNumber) {
  return COMPILED[`modulo${moduleNumber}`] ?? null;
}

// Cantidad de módulos cargados — courses.js lo usa para validar que coincida
// con la cantidad de quizzes del curso.
function moduleCount() {
  return Object.keys(COMPILED).length;
}

// Lo que viaja al front: enunciado y opciones, NUNCA la respuesta.
// El orden acá es el del documento; el front lo mezcla en cada intento.
function getQuizForClient(moduleNumber) {
  const mod = getModule(moduleNumber);
  if (!mod) return null;

  return mod.questions.map(q => ({
    id:       q.id,
    type:     q.type,
    question: q.question,
    ...(q.prompt    ? { prompt:    q.prompt }    : {}),
    ...(q.statement ? { statement: q.statement } : {}),
    options:  [...q.options],
  }));
}

// Corrige un intento. `answers` = [{ questionId, answer }] en cualquier orden.
// Devuelve { ok: true, correct, total } o { ok: false, error } si el payload
// no es válido (el router responde 400 con ese mensaje).
function gradeQuiz(moduleNumber, answers) {
  const mod = getModule(moduleNumber);
  if (!mod) return { ok: false, error: "Módulo sin banco de preguntas" };

  const total = mod.questions.length;

  if (!Array.isArray(answers) || answers.length !== total) {
    return { ok: false, error: `Se esperan exactamente ${total} respuestas` };
  }

  const seen = new Set();
  let correct = 0;

  for (const item of answers) {
    if (!item || typeof item !== "object") {
      return { ok: false, error: "Formato de respuesta inválido" };
    }

    const { questionId, answer } = item;

    if (typeof questionId !== "string" || !mod.byId.has(questionId)) {
      return { ok: false, error: "Pregunta inexistente en este quiz" };
    }
    if (seen.has(questionId)) {
      return { ok: false, error: "Pregunta respondida más de una vez" };
    }
    if (typeof answer !== "string" || answer.length === 0 || answer.length > MAX_ANSWER_LENGTH) {
      return { ok: false, error: "Todas las preguntas deben tener una respuesta válida" };
    }

    seen.add(questionId);

    if (normalize(answer) === mod.byId.get(questionId).correctNormalized) {
      correct++;
    }
  }

  return { ok: true, correct, total };
}

module.exports = {
  BANCO_PREGUNTAS,
  moduleCount,
  getQuizForClient,
  gradeQuiz,
};