// SOLO BACKEND: "correct" nunca se envía al front.
// La clave de cada quiz = quizId del step en course.config.js.
//
// SIMULACIÓN: mismas preguntas y respuestas que los módulos 1 a 3 de ModernSoc
// (bancoPreguntasModernSoc.js). Se reemplaza cuando llegue el contenido real de Ciberprisma.

module.exports = {
    "m01-quiz": {
        title: "Evaluación módulo 1",
        questions: [
            {
                id: "q1",
                text: "¿Cuál describe correctamente los tres objetivos operativos del SOC y su relación?",
                options: [
                    { id: "a", text: "Prevenir, detectar y responder — se activan en paralelo: el SOC trabaja los tres simultáneamente en todo momento" },
                    { id: "b", text: "Monitorear, detectar y responder — se activan en secuencia: sin monitoreo no hay detección, y sin detección no hay respuesta" },
                    { id: "c", text: "Detectar, escalar y resolver — el SOC identifica el problema y lo resuelve en cada nivel antes de pasar al siguiente" },
                    { id: "d", text: "Monitorear, analizar y contener — el SOC no responde, solo recopila evidencia y coordina la contención con otros equipos" },
                ],
                correct: "b",
            },
            {
                id: "q2",
                text: "¿Cuál es la diferencia entre un SOC interno y un MSSP?\n\nUn equipo de seguridad está evaluando si contratar un MSSP o mantener el SOC interno. ¿Qué afirmación es correcta?",
                options: [
                    { id: "a", text: "El MSSP siempre ofrece mayor visibilidad sobre los activos internos porque tiene más herramientas disponibles" },
                    { id: "b", text: "Un SOC interno es preferible para organizaciones pequeñas porque el MSSP requiere infraestructura propia del cliente" },
                    { id: "c", text: "El SOC interno permite mayor control y alineación con el contexto del negocio, pero implica mayor costo operativo y necesidad de retener talento" },
                    { id: "d", text: "Ambos modelos son equivalentes en práctica; la diferencia es solo contractual y no afecta la calidad de la detección" },
                ],
                correct: "c",
            },
            {
                id: "q3",
                text: "Un analista SOC recibe una alerta de múltiples intentos de login fallidos desde una IP extranjera. ¿Cuáles son los primeros pasos?\n\n¿Cuál es la secuencia más adecuada para el análisis inicial?",
                options: [
                    { id: "a", text: "Bloquear la IP en el firewall y documentar el bloqueo como medida preventiva inmediata" },
                    { id: "b", text: "Validar si hubo login exitoso posterior, revisar la cuenta afectada, evaluar privilegios y reputación de la IP antes de tomar acción" },
                    { id: "c", text: "Confirmar si la cuenta tiene MFA activo; si lo tiene, cerrar la alerta porque el ataque fue bloqueado por el segundo factor" },
                    { id: "d", text: "Escalar directamente a L2 porque cualquier acceso desde IP extranjera supera el alcance del triage inicial" },
                ],
                correct: "b",
            },
            {
                id: "q4",
                text: "¿Cuál es la diferencia entre log, evento, alerta e incidente?\n\n¿Cuál de estas afirmaciones es correcta?",
                options: [
                    { id: "a", text: "Toda alerta es un incidente en potencia, por lo que deben tratarse con el mismo nivel de urgencia hasta descartarse" },
                    { id: "b", text: "El log es generado por el analista, el evento por la herramienta, la alerta por el SIEM y el incidente por el equipo de IR" },
                    { id: "c", text: "Un log es registro crudo, un evento le agrega contexto, una alerta se genera cuando coincide con una condición de detección, y un incidente requiere evidencia suficiente de afectación real" },
                    { id: "d", text: "La diferencia entre alerta e incidente es subjetiva: depende del criterio del analista que recibe el caso" },
                ],
                correct: "c",
            },
            {
                id: "q5",
                text: "¿Por qué es importante documentar el análisis incluso cuando la alerta resulta ser un falso positivo?\n\nAfirmación: \"Documentar un falso positivo consume tiempo innecesario. Si la actividad fue validada como legítima, basta con cerrarlo en el sistema sin agregar notas, ya que no hay riesgo asociado.\"",
                options: [
                    { id: "a", text: "Verdadero" },
                    { id: "b", text: "Falso" },
                ],
                correct: "b",
            },
            {
                id: "q6",
                text: "¿Qué información debe incluir un escalamiento para que sea útil y accionable?\n\n¿Cuál de los siguientes escalamientos es más útil para quien lo recibe?",
                options: [
                    { id: "a", text: "\"Alerta de PowerShell sospechoso en endpoint de Finanzas. Severidad alta. Adjunto captura del SIEM.\"" },
                    { id: "b", text: "\"Se observó PowerShell ejecutado por WINWORD.EXE con -nop -w hidden -enc en FIN-LAP-022 (usuario sin rol técnico). Actividad posterior: conexión externa y descarga de ejecutable. Sin ticket asociado. Se recomienda análisis forense del host.\"" },
                    { id: "c", text: "\"PowerShell detectado en equipo de usuario. MFA activo. Sin movimiento lateral confirmado. Posible falso positivo, pero escalo por precaución.\"" },
                    { id: "d", text: "\"Incidente confirmado en endpoint de Finanzas. Requiere contención inmediata y notificación al área legal.\"" },
                ],
                correct: "b",
            },
            {
                id: "q7",
                text: "¿Por qué decimos que 'ver no significa tener permiso para divulgar'?\n\nAfirmación: \"Un analista SOC que detecta actividad sospechosa en la cuenta de un directivo puede avisar informalmente al responsable de IT para agilizar la respuesta, incluso antes de seguir el proceso formal.\"",
                options: [
                    { id: "a", text: "Verdadero" },
                    { id: "b", text: "Falso" },
                ],
                correct: "b",
            },
            {
                id: "q8",
                text: "Mencioná al menos 3 rutas de especialización o crecimiento posibles a partir del SOC.\n\n¿Cuál lista representa rutas de especialización reales y diferenciadas desde el SOC?",
                options: [
                    { id: "a", text: "SOC L2, SOC L3, SOC Manager — todas dentro del mismo equipo, con responsabilidades progresivas" },
                    { id: "b", text: "Incident Response, Threat Intelligence, Ingeniería de Seguridad (SIEM/SOAR), Forense Digital, Cloud Security, Red Team" },
                    { id: "c", text: "Pentesting, Desarrollo seguro, Auditoría ISO 27001 — salidas naturales para quien ya tiene experiencia en detección" },
                    { id: "d", text: "CISO, Risk Manager, Compliance Officer — roles que requieren primero pasar por un SOC antes de acceder a posiciones estratégicas" },
                ],
                correct: "b",
            },
        ],
    },

    "m02-quiz": {
        title: "Evaluación módulo 2",
        questions: [
            {
                id: "q1",
                text: "Un usuario de marketing clona un repositorio de código productivo a las 2:00 AM desde un dispositivo personal. ¿Qué información necesitás revisar antes de clasificar la alerta?\n\n¿Cuál es el conjunto de información más relevante para clasificar esta alerta?",
                options: [
                    { id: "a", text: "Confirmar si el usuario tiene acceso autorizado al repositorio y si el dispositivo personal está registrado en el MDM corporativo" },
                    { id: "b", text: "Verificar el volumen clonado, el lenguaje del repositorio y si hay otros usuarios del área de marketing con el mismo comportamiento esa noche" },
                    { id: "c", text: "Revisar el rol del usuario vs. el tipo de repositorio, el horario y dispositivo, si hubo actividad posterior al clon (push, descarga, reenvío), y si existe algún contexto operativo que lo justifique" },
                    { id: "d", text: "Consultar con el equipo de desarrollo si el repositorio fue modificado después del clon, ya que el riesgo real está en la integridad del código, no en la descarga" },
                ],
                correct: "c",
            },
            {
                id: "q2",
                text: "¿Qué diferencia existe entre que una acción fue 'bloqueada' y que la situación fue 'resuelta'?\n\n¿Cuál de estas afirmaciones describe mejor la diferencia?",
                options: [
                    { id: "a", text: "Son equivalentes en la práctica: si el control bloqueó la acción, el riesgo dejó de existir y el caso puede cerrarse" },
                    { id: "b", text: "'Bloqueada' significa que el control actuó sobre ese evento específico, pero no necesariamente resuelve el origen, el alcance ni la posible actividad relacionada" },
                    { id: "c", text: "La diferencia es semántica: 'bloqueada' la usa el EDR y 'resuelta' la usa el analista al cerrar el ticket" },
                    { id: "d", text: "Una acción bloqueada requiere escalamiento automático a L2; una resuelta puede cerrarse directamente desde L1" },
                ],
                correct: "b",
            },
            {
                id: "q3",
                text: "Describí cómo un mismo evento (modificación de permisos en una carpeta compartida) puede tener impacto bajo en un caso y alto en otro.\n\n¿Cuál par de escenarios demuestra mejor que el impacto no lo define el evento sino el contexto?",
                options: [
                    { id: "a", text: "Caso bajo: el cambio fue realizado por un admin. Caso alto: fue realizado por un usuario sin privilegios" },
                    { id: "b", text: "Caso bajo: la carpeta tiene 10 archivos. Caso alto: la carpeta tiene 10.000 archivos" },
                    { id: "c", text: "Caso bajo: admin aplica cambio aprobado en carpeta de pruebas en horario laboral. Caso alto: cuenta comprometida modifica permisos en carpeta financiera sin ticket, y usuarios externos acceden después" },
                    { id: "d", text: "Caso bajo: el cambio amplió permisos de lectura. Caso alto: el cambio otorgó permisos de escritura a usuarios externos" },
                ],
                correct: "c",
            },
            {
                id: "q4",
                text: "¿Cuál es la diferencia entre un IOC y un IOA? ¿Por qué un analista no debería depender exclusivamente de IOC?\n\n¿Cuál afirmación es correcta?",
                options: [
                    { id: "a", text: "Los IOC detectan ataques en tiempo real; los IOA detectan compromisos que ya ocurrieron. Depender solo de IOC genera retrasos en la respuesta" },
                    { id: "b", text: "Los IOA son más confiables que los IOC porque provienen del comportamiento observado, mientras que los IOC pueden estar desactualizados o ser genéricos" },
                    { id: "c", text: "Un IOC identifica un artefacto asociado a una amenaza conocida; un IOA identifica comportamiento compatible con una técnica de ataque. Depender solo de IOC deja puntos ciegos ante amenazas nuevas o que cambian sus indicadores" },
                    { id: "d", text: "La diferencia es operativa: los IOC los consume el SIEM y los IOA los consume el EDR. Un analista que solo trabaja con SIEM naturalmente depende de IOC" },
                ],
                correct: "c",
            },
            {
                id: "q5",
                text: "El SIEM detecta múltiples intentos fallidos de login seguidos de un login exitoso en una cuenta sin MFA a las 3 AM. Usá amenaza, vulnerabilidad, riesgo e impacto para describir la situación.\n\n¿Cuál descripción aplica correctamente los cuatro conceptos?",
                options: [
                    { id: "a", text: "Amenaza: fuerza bruta. Vulnerabilidad: contraseña débil. Riesgo: cuenta bloqueada por reintentos. Impacto: pérdida de disponibilidad de la cuenta" },
                    { id: "b", text: "Amenaza: actor intentando acceso no autorizado. Vulnerabilidad: cuenta sin MFA. Riesgo: acceso exitoso con credenciales comprometidas. Impacto: depende de los privilegios y la actividad posterior" },
                    { id: "c", text: "Amenaza: ausencia de MFA. Vulnerabilidad: política de contraseñas débil. Riesgo: alto por horario nocturno. Impacto: posible exfiltración de datos si el usuario tiene acceso a información sensible" },
                    { id: "d", text: "Amenaza: login exitoso sospechoso. Vulnerabilidad: monitoreo insuficiente. Riesgo: sin MFA el atacante puede reingresar. Impacto: requiere confirmación antes de evaluarse" },
                ],
                correct: "b",
            },
            {
                id: "q6",
                text: "Un servidor con una vulnerabilidad crítica está expuesto a internet y recibe intentos de explotación. El WAF bloqueó todos los requests. ¿Cerrás la alerta?\n\nAfirmación: \"Si el WAF bloqueó todos los requests de explotación, el servidor no fue comprometido y la alerta puede cerrarse. La vulnerabilidad queda pendiente para el equipo de gestión de vulnerabilidades.\"",
                options: [
                    { id: "a", text: "Verdadero" },
                    { id: "b", text: "Falso" },
                ],
                correct: "b",
            },
            {
                id: "q7",
                text: "¿Qué significa que una organización tiene una gran 'superficie de ataque'? ¿Cómo influye eso en el trabajo diario del analista SOC?\n\n¿Cuál afirmación describe mejor la implicancia operativa de una superficie de ataque amplia?",
                options: [
                    { id: "a", text: "Que la organización tiene muchos empleados y por lo tanto mayor probabilidad de error humano, lo que requiere más campañas de concientización" },
                    { id: "b", text: "Que hay más activos expuestos, más vectores posibles y más fuentes de eventos a monitorear, lo que obliga al analista a priorizar por criticidad y contexto en lugar de tratar todas las alertas igual" },
                    { id: "c", text: "Que el perímetro de red es difícil de defender, por lo que el SOC debería concentrar sus recursos en firewall y WAF antes que en endpoints o identidad" },
                    { id: "d", text: "Que la organización tiene deuda técnica acumulada, lo que hace que el volumen de vulnerabilidades supere la capacidad del equipo de parcheo" },
                ],
                correct: "b",
            },
            {
                id: "q8",
                text: "¿Cuál es la diferencia entre impacto potencial e impacto confirmado?\n\n¿Cuál par de afirmaciones refleja correctamente la distinción?",
                options: [
                    { id: "a", text: "Potencial: el analista cree que hubo daño. Confirmado: L2 validó que hubo daño. La diferencia es quién lo determina, no la evidencia" },
                    { id: "b", text: "Potencial: el evento ocurrió en un activo crítico. Confirmado: el evento ocurrió en un activo crítico y fue bloqueado. La criticidad del activo define si el impacto se confirma" },
                    { id: "c", text: "Potencial: hay evidencia de actividad que podría haber afectado la seguridad, pero no se confirmó daño real. Confirmado: existe evidencia concreta de afectación. La diferencia cambia cómo se documenta y cómo se escala" },
                    { id: "d", text: "Potencial: el incidente todavía está en curso. Confirmado: el incidente fue contenido. La diferencia indica el estado operativo del caso, no el tipo de evidencia disponible" },
                ],
                correct: "c",
            },
        ],
    },

    "m03-quiz": {
        title: "Evaluación módulo 3",
        questions: [
            {
                id: "q1",
                text: "Un endpoint genera conexiones HTTPS cada 45 segundos hacia sync-cloud-check.net. El proceso es update_service.exe ubicado en AppData\\Roaming, sin firma digital y visto por primera vez hoy. ¿Qué hipótesis plantearías y qué validarías?\n\n¿Cuál es el conjunto de hipótesis y pasos de validación más completo y correcto?",
                options: [
                    { id: "a", text: "Hipótesis: posible falso positivo de herramienta de actualización corporativa. Validar: consultar con el equipo de IT si desplegaron algo nuevo y cerrar si confirman" },
                    { id: "b", text: "Hipótesis: beaconing compatible con C2. Validar: reputación del dominio, proceso padre de update_service.exe, si el archivo es nuevo en el host, si hay otros endpoints con el mismo proceso, y actividad previa que explique su origen" },
                    { id: "c", text: "Hipótesis: malware confirmado. Acción: aislar inmediatamente el endpoint y escalar a IR sin más análisis porque el patrón periódico y la ruta son concluyentes" },
                    { id: "d", text: "Hipótesis: exfiltración de datos. Validar: volumen de datos transferidos por sesión, porque si es menor a 1MB probablemente sea legítimo" },
                ],
                correct: "b",
            },
            {
                id: "q2",
                text: "El EDR detecta WINWORD.EXE → powershell.exe -nop -w hidden -enc → conexión a raw.githubusercontent.com → archivo creado en C:\\Users\\Public. El usuario pertenece a RRHH. ¿Qué hace que esta alerta sea de alta prioridad?\n\n¿Cuál combinación de factores justifica la alta prioridad?",
                options: [
                    { id: "a", text: "El dominio raw.githubusercontent.com tiene mala reputación y cualquier conexión hacia él desde un endpoint corporativo es crítica" },
                    { id: "b", text: "PowerShell con parámetros de evasión iniciado por Word indica posible ejecución de macro maliciosa; el usuario no técnico no tiene razón para que Word ejecute comandos codificados, y el archivo creado en ruta pública puede ser un payload" },
                    { id: "c", text: "La alta prioridad viene del parámetro -enc, que siempre indica actividad maliciosa porque es el único parámetro que oculta comandos en Base64" },
                    { id: "d", text: "Es alta prioridad porque el archivo fue creado en C:\\Users\\Public, que es una ruta restringida donde solo pueden escribir procesos con privilegios elevados" },
                ],
                correct: "b",
            },
            {
                id: "q3",
                text: "Un host genera 480 consultas DNS en 15 minutos con patrones como 'akd92kdkd-check.com', 'plq77smmx-update.net'. Todas responden NXDOMAIN. ¿Qué patrón podría representar y qué pasos seguirías?\n\n¿Cuál análisis es correcto?",
                options: [
                    { id: "a", text: "Es tráfico de spam o malvertising: el navegador cargó páginas con muchos trackers. Validar que el usuario no esté en sitios sospechosos y cerrar si no hay descarga asociada" },
                    { id: "b", text: "El patrón de subdominios aleatorios con NXDOMAIN puede indicar un algoritmo de generación de dominios (DGA) intentando contactar su C2. Validar: proceso que genera las consultas, si el volumen es inusual para ese host, si ocurre en otros endpoints y si hay alguna conexión exitosa entre las fallidas" },
                    { id: "c", text: "NXDOMAIN confirma que los dominios no existen y que ninguna conexión fue exitosa, por lo que el riesgo real es bajo. Registrar y monitorear sin escalar" },
                    { id: "d", text: "Son dominios con patrones de typosquatting orientados a phishing. Validar si el usuario intentó ingresar a alguno manualmente y si hay credenciales comprometidas en los logs de autenticación" },
                ],
                correct: "b",
            },
            {
                id: "q4",
                text: "¿Cuál es la diferencia entre un firewall que muestra 'Action: Blocked' y un caso cerrado? ¿Qué información adicional necesitaría un analista antes de cerrar?\n\nAfirmación: \"Si el firewall registra 'Action: Blocked' para una conexión saliente hacia un dominio sospechoso, el riesgo quedó mitigado por el control y el analista puede cerrar la alerta documentando que fue bloqueada.\"",
                options: [
                    { id: "a", text: "Verdadero" },
                    { id: "b", text: "Falso" },
                ],
                correct: "b",
            },
            {
                id: "q5",
                text: "Describí cómo diferenciarías actividad legítima de IT (despliegue masivo de software) de movimiento lateral usando SMB. ¿Qué elementos validarías en cada caso?\n\n¿Cuál par de descripciones refleja correctamente los elementos diferenciadores?",
                options: [
                    { id: "a", text: "Legítimo: muchos destinos conectados. Sospechoso: pocos destinos conectados. La cantidad de hosts afectados es el indicador principal" },
                    { id: "b", text: "Legítimo: ticket de cambio aprobado, host origen administrativo, herramienta corporativa firmada, ventana de mantenimiento, destinos dentro del alcance del ticket. Sospechoso: origen desde endpoint de usuario, cuenta sin privilegios habituales para esa acción, sin ticket, fuera de horario, con acceso a shares administrativos como ADMIN$ o C$" },
                    { id: "c", text: "Legítimo: el proceso usa puertos estándar SMB (445). Sospechoso: el proceso usa puertos alternativos o no estándar para la transferencia. El puerto es el elemento más discriminante en este caso" },
                    { id: "d", text: "Legítimo: el despliegue se hace con credenciales de dominio. Sospechoso: el movimiento lateral siempre requiere credenciales locales o hashes robados, lo que lo hace detectable por el tipo de autenticación" },
                ],
                correct: "b",
            },
            {
                id: "q6",
                text: "El firewall muestra una conexión de USER-LAP-088 hacia suspicious-domain.com puerto 443 permitida. El EDR no está disponible en ese endpoint. ¿Cómo documentarías las limitaciones y qué próximos pasos recomendarías?\n\n¿Cuál documentación y plan de acción es más correcto?",
                options: [
                    { id: "a", text: "Documentar que el EDR no detectó actividad maliciosa en el endpoint y cerrar, ya que la ausencia de alerta del EDR indica que no hubo ejecución de código" },
                    { id: "b", text: "Documentar que la visibilidad está limitada a nivel de red (firewall): se tiene IP, destino y acción, pero no el proceso que generó la conexión ni actividad en el endpoint. Recomendar: buscar el host en otras fuentes disponibles (DNS, proxy, SIEM), verificar reputación del dominio, evaluar si el host puede obtener agente EDR, y escalar si el dominio tiene reputación maliciosa confirmada" },
                    { id: "c", text: "Documentar que el dominio fue contactado exitosamente y escalar como incidente confirmado porque la conexión fue permitida hacia un dominio sospechoso, lo que prueba que hubo comunicación maliciosa" },
                    { id: "d", text: "Recomendar instalar el EDR antes de continuar el análisis, ya que sin visibilidad de endpoint no es posible determinar nada y cualquier conclusión sería especulativa" },
                ],
                correct: "b",
            },
            {
                id: "q7",
                text: "¿Por qué el modelo OSI es útil para el trabajo SOC? Usá el ejemplo de 'un usuario no puede acceder a una aplicación' para mostrar cómo ayudaría a ordenar el diagnóstico.\n\n¿Cuál respuesta demuestra el uso correcto del modelo OSI como herramienta de diagnóstico?",
                options: [
                    { id: "a", text: "El modelo OSI es útil para saber qué protocolo está fallando. En el ejemplo, hay que revisar directamente la capa 7 (aplicación) porque el problema es de acceso a una aplicación" },
                    { id: "b", text: "El modelo OSI permite descartar capas de forma ordenada: primero verificar si hay conectividad (capas 1-3), luego si el puerto responde (capa 4), si la sesión se establece (capa 5), si hay problema de cifrado o certificado (capa 6), y finalmente si la aplicación responde correctamente con las credenciales del usuario (capa 7). Cada capa descartada reduce el espacio del problema" },
                    { id: "c", text: "El modelo OSI es útil principalmente para el equipo de redes, no para el SOC. En el ejemplo, el analista debería escalar directamente al equipo de infraestructura porque el problema puede estar en cualquier capa" },
                    { id: "d", text: "El modelo OSI ayuda a identificar si el problema es de red o de aplicación. En el ejemplo, si el ping responde, el problema está en capa 7 y el SOC no tiene responsabilidad de diagnóstico" },
                ],
                correct: "b",
            },
            {
                id: "q8",
                text: "Una cuenta admin.backup inicia sesión a las 3 AM desde una notebook de usuario sin MFA, accede a 12 servidores y crea un servicio remoto. Analizá usando los conceptos del módulo.\n\n¿Cuál análisis aplica correctamente los conceptos de protocolo, movimiento lateral, autenticación y visibilidad?",
                options: [
                    { id: "a", text: "La cuenta admin.backup puede tener actividad nocturna normal para tareas de backup. Validar si existe un job programado que explique el horario y los accesos, y cerrar si se confirma" },
                    { id: "b", text: "El acceso desde notebook de usuario (no host administrativo), sin MFA en cuenta privilegiada, con propagación a 12 servidores y creación de servicio remoto a las 3 AM sin ticket visible combina múltiples señales de movimiento lateral. Validar: ticket de cambio, proceso que creó el servicio, binario instalado, si la cuenta tenía historial de este comportamiento, y correlacionar con alertas previas en los hosts destino" },
                    { id: "c", text: "Es un incidente confirmado de movimiento lateral porque ninguna cuenta de backup legítima necesita crear servicios remotos. Aislar todos los servidores afectados y revocar la cuenta de inmediato" },
                    { id: "d", text: "El principal indicador de compromiso es la ausencia de MFA, porque todos los demás comportamientos podrían explicarse operativamente. Habilitar MFA en la cuenta y monitorear si la actividad continúa" },
                ],
                correct: "b",
            },
        ],
    },
};