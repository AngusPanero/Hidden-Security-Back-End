const applicantSseClients = new Set();

// ─── Notificar nueva postulación ──────────────────────────────────────────────
const notifyNewApplicant = (vacancyId, vacancyTitle, userId, applicantName = "") => {
    if (applicantSseClients.size === 0) return;

    const data = JSON.stringify({
        vacancyId,
        vacancyTitle,
        userId,
        applicantName,
        createdAt: new Date().toISOString(),
    });

    /* console.log(`📢 SSE applicant notify — clientes: ${applicantSseClients.size} — vacancy: ${vacancyTitle}`); */

    applicantSseClients.forEach((client) => {
        try { client.write(`data: ${data}\n\n`); }
        catch (_) { applicantSseClients.delete(client); }
    });
};

// ─── Handler SSE para empresas ────────────────────────────────────────────────
const applicantSseHandler = (req, res) => {
    /* console.log(`🔌 SSE applicant conectado — total: ${applicantSseClients.size + 1}`); */

    res.setHeader("Content-Type",      "text/event-stream");
    res.setHeader("Cache-Control",     "no-cache");
    res.setHeader("Connection",        "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    const ping = setInterval(() => {
        try { res.write(": ping\n\n"); }
        catch (_) { clearInterval(ping); applicantSseClients.delete(res); }
    }, 25_000);

    applicantSseClients.add(res);

    req.on("close", () => {
        clearInterval(ping);
        applicantSseClients.delete(res);
        /* console.log(`🔌 SSE applicant desconectado — total: ${applicantSseClients.size}`); */
    });
};

module.exports = { notifyNewApplicant, applicantSseHandler };