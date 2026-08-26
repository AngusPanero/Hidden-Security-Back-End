const MODERN_SOC_OPERATIONS_VALIDATED_SKILLS = {
  "Fundamentos": [
    "Gestión de superficie de ataque",
    "Gestión de controles de seguridad",
    "Identificación de riesgos",
    "Evaluación de riesgos",
    "Análisis de impacto",
    "Evaluación de controles",
    "Fundamentos de ciberseguridad"
  ],

  "Operaciones SOC": [
    "Monitoreo de alertas",
    "Triage de alertas",
    "Clasificación de incidentes",
    "Priorización de alertas",
    "Evaluación de severidad",
    "Validación de falsos positivos",
    "Correlación de eventos",
    "Enriquecimiento de alertas",
    "Escalamiento de incidentes",
    "Gestión de casos",
    "Documentación de alertas",
    "Seguimiento de tickets",
    "Handover entre turnos",
    "Análisis de logs",
    "Análisis de procesos",
    "Análisis de árbol de procesos",
    "Análisis de línea de comandos",
    "Análisis de autenticaciones",
    "Análisis de tráfico de red",
    "Análisis de DNS",
    "Análisis de correo electrónico",
    "Análisis de phishing",
    "Análisis básico de malware",
    "Análisis de comportamiento",
    "Construcción de líneas de tiempo",
    "Determinación de alcance",
    "Identificación de IOC",
    "Análisis de endpoints",
    "Análisis de actividad de usuarios"
  ],

  "Detección": [
    "Mapeo con MITRE ATT&CK",
    "Detección basada en IOC",
    "Detección basada en comportamiento",
    "Detección basada en TTP",
    "Detección de persistencia",
    "Detección de ejecución",
    "Detección de movimiento lateral",
    "Detección de exfiltración",
    "Detección de abuso de credenciales",
    "Detección de LOLBins",
    "Detección de living-off-the-land"
  ],

  "Threat Hunting": [
    "Análisis de PowerShell",
    "Análisis de LOLBins",
    "Análisis temporal",
    "Análisis de cadenas de ejecución",
    "Análisis de beaconing"
  ],

  "Incident Response": [
    "Matriz de escalamiento",
    "Identificación de incidentes",
    "Contención",
    "Coordinación de incidentes",
    "Comunicación de incidentes",
    "Preservación de evidencias",
    "Determinación de impacto",
    "Respuesta a ransomware",
    "Respuesta a phishing",
    "Respuesta a malware",
    "Respuesta a compromiso de cuentas",
    "Respuesta a fuga de información",
    "Respuesta a ataques web"
  ],

  "Threat Intelligence": [
    "Enriquecimiento de IOC",
    "Evaluación de confiabilidad",
    "Evaluación de relevancia"
  ],

  "Malware": [
    "Monitoreo de procesos",
    "Monitoreo de archivos",
    "Monitoreo de red",
    "Extracción de IOC"
  ],

  "Forense digital": [
    "Preservación de evidencia"
  ],

  "Redes": [
    "Modelo OSI",
    "TCP/IP",
    "Proxy",
    "Network Traffic Analysis",
    "Web Application Firewall",
    "DNS Security",
    "Email Security"
  ],

  "Programación y automatización": [
    "Automatización de tareas",
    "Automatización de respuesta",
    "Desarrollo de playbooks",
    "Orquestación"
  ],

  "IAM y PAM": [
    "Gestión de identidades",
    "Multi-Factor Authentication",
    "Access Reviews"
  ],

  "IA aplicada": [
    "IA para análisis de alertas",
    "IA para investigación de incidentes",
    "IA para enriquecimiento de IOC",
    "Generación asistida de queries",
    "Automatización asistida por IA",
    "Validación de respuestas generadas por IA",
    "Evaluación de alucinaciones",
    "Uso seguro de asistentes de IA"
  ],

  "Habilidades analíticas": [
    "Pensamiento analítico",
    "Pensamiento crítico",
    "Reconocimiento de patrones",
    "Formulación de hipótesis",
    "Resolución de problemas",
    "Toma de decisiones",
    "Priorización",
    "Manejo de incertidumbre",
    "Evaluación de evidencia",
    "Correlación de información",
    "Atención al detalle",
    "Orientación a riesgos",
    "Capacidad investigativa",
    "Curiosidad técnica"
  ],

  "Habilidades profesionales": [
    "Comunicación escrita",
    "Comunicación oral",
    "Redacción técnica",
    "Presentación de hallazgos",
    "Comunicación con equipos técnicos",
    "Traducción de riesgos técnicos",
    "Trabajo en equipo",
    "Colaboración interdisciplinaria",
    "Escucha activa",
    "Gestión del tiempo",
    "Organización",
    "Autonomía",
    "Adaptabilidad",
    "Aprendizaje continuo",
    "Responsabilidad",
    "Proactividad",
    "Manejo de prioridades",
    "Trabajo bajo presión",
    "Ética profesional",
    "Comunicación en crisis",
    "Manejo de stakeholders"
  ],

  "Tecnologías": [
    "Windows",
    "Linux",
    "Active Directory",
    "Microsoft Entra ID",
    "Microsoft 365",
    "TCP",
    "UDP",
    "DNS",
    "HTTP",
    "HTTPS",
    "SMB",
    "RDP",
    "Firewall"
  ],

  "Lenguajes de programación y scripting": [
    "PowerShell",
    "Bash"
  ],

  "Lenguajes de consulta y reglas": [
    "Regular Expressions"
  ],

  "Marcos y metodologías": [
    "MITRE ATT&CK",
    "Cyber Kill Chain",
    "NIST Incident Response",
    "SANS Incident Response Process"
  ]
};

module.exports = { MODERN_SOC_OPERATIONS_VALIDATED_SKILLS };