// Express y Router
const express = require("express")
const authRouter = express.Router()
// Firebase Admin SDK
const auth = require("../config/firebase")
// Models
const Audit = require("../models/AuditSchema")
const SecurityIncident = require("../models/SecurityIncidentSchema");
const { LegalConsent, LEGAL_DOCUMENTS } = require("../models/LegalConsent");
// Middlewares
const loginLimiter = require("../middleware/rateLimitMiddleware")
const checkBanned = require("../middleware/checkBanned")
const verifyToken = require("../middleware/authMiddleware")
const adminMiddleware = require("../middleware/adminMiddleware")
// Clave de firma del admin (mismo util que usa el script de generación del hash)
const { verifyPin } = require("../utils/signPin")
// Axios
const axios = require("axios")
// BREVO
const { BrevoClient } = require("@getbrevo/brevo");
// Entorno
const esProduccion = process.env.NODE_ENV === "production";

const brevo = new BrevoClient({ apiKey: process.env.BREVO_API_KEY });
 
async function sendVerificationEmail(email) {
    const frontendUrl = process.env.FRONT_END || process.env.LOCAL_HOST || "http://localhost:5173";
    
    console.log("[ENV CHECK] BREVO_API_KEY:", process.env.BREVO_API_KEY ? "✓ set" : "✗ MISSING");
    console.log("[ENV CHECK] EMAIL_FROM:", process.env.EMAIL_FROM ?? "✗ MISSING");

    // Admin SDK genera el link — no necesita idToken ni contraseña del usuario
    const link = await auth.generateEmailVerificationLink(email, {
        url: `${frontendUrl}/dashboard`,
    });
 
    const html = `
        <!DOCTYPE html>
        <html lang="es" xmlns="http://www.w3.org/1999/xhtml">
        <head>
            <meta charset="UTF-8" />
            <meta name="viewport" content="width=device-width, initial-scale=1.0" />
            <title>Verificá tu cuenta — Hidden Security</title>
            <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;700;900&display=swap" rel="stylesheet">
            <style>* { box-sizing:border-box; margin:0; padding:0; } body { background-color:#111111; font-family:'Montserrat',Arial,sans-serif; }</style>
        </head>
        <body style="margin:0; padding:0; background-color:#111111;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#111111; padding:40px 16px;">
            <tr><td align="center">
            <table role="presentation" width="600" cellpadding="0" cellspacing="0"
                style="max-width:600px; width:100%; background-color:#000000; border:1px solid #ccff00;">
        
                <tr>
                    <td style="background-color:#ccff00; padding:28px 40px 24px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
                        <td style="vertical-align:bottom;">
                            <p style="font-family:'Montserrat',Arial,sans-serif; font-size:9px; font-weight:700; letter-spacing:4px; text-transform:uppercase; color:rgba(0,0,0,0.45); margin:0 0 6px;">// HIDDEN_SECURITY</p>
                            <p style="font-family:'Montserrat',Arial,sans-serif; font-size:28px; font-weight:900; letter-spacing:-1.5px; text-transform:uppercase; color:#000000; line-height:1; margin:0;">HIDDEN<span style="font-weight:400;">SECURITY</span></p>
                        </td>
                        <td style="text-align:right; vertical-align:bottom;">
                            <p style="font-family:'Montserrat',Arial,sans-serif; font-size:9px; font-weight:700; letter-spacing:2px; text-transform:uppercase; color:rgba(0,0,0,0.5); margin:0;">VERIFICACIÓN<br/>DE CUENTA</p>
                        </td>
                    </tr></table>
                    </td>
                </tr>
        
                <tr><td style="background-color:#000000; padding:44px 40px 40px;">
        
                    <table role="presentation" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
                        <tr><td>
                        <span style="font-family:'Montserrat',Arial,sans-serif; font-size:9px; font-weight:700; letter-spacing:3px; text-transform:uppercase; color:#ccff00; border:1px solid rgba(204,255,0,0.35); padding:5px 14px; background:rgba(204,255,0,0.06); display:inline-block;">⚡ ACTIVACIÓN_REQUERIDA</span>
                        </td></tr>
                    </table>
        
                    <p style="font-family:'Montserrat',Arial,sans-serif; font-size:32px; font-weight:900; letter-spacing:-2px; text-transform:uppercase; color:#ffffff; line-height:1.05; margin:0 0 18px;">
                        CONFIRMÁ<br/><span style="color:#ccff00; font-weight:400;">TU CUENTA.</span>
                    </p>
        
                    <p style="font-family:'Montserrat',Arial,sans-serif; font-size:13px; color:rgba(255,255,255,0.55); line-height:1.85; margin:0 0 36px;">
                        Hacé click en el botón de abajo para activar tu cuenta y acceder a la plataforma Hidden Security. Este link es válido por 24 horas.
                    </p>
        
                    <table role="presentation" cellpadding="0" cellspacing="0" style="margin-bottom:36px;">
                        <tr>
                            <td style="background-color:#ccff00;">
                                <a href="${link}" style="display:block; padding:18px 40px; font-family:'Montserrat',Arial,sans-serif; font-size:11px; font-weight:900; letter-spacing:3px; text-transform:uppercase; color:#000000; text-decoration:none; white-space:nowrap;">
                                    VERIFICAR EMAIL →
                                </a>
                            </td>
                        </tr>
                    </table>
        
                    <p style="font-family:'Montserrat',Arial,sans-serif; font-size:8px; font-weight:700; letter-spacing:2px; text-transform:uppercase; color:rgba(255,255,255,0.2); margin:0 0 8px;">// Si el botón no funciona, copiá este link:</p>
                    <p style="font-family:'Montserrat',Arial,sans-serif; font-size:10px; color:rgba(255,255,255,0.25); word-break:break-all; line-height:1.6; margin:0;">${link}</p>
        
                </td></tr>
        
                <tr>
                    <td style="background-color:#0a0a0a; border-top:1px solid rgba(204,255,0,0.15); padding:24px 40px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
                        <td><p style="font-family:'Montserrat',Arial,sans-serif; font-size:13px; font-weight:700; letter-spacing:3px; text-transform:uppercase; color:#ccff00; margin:0 0 4px;">HIDDEN_SECURITY</p>
                        <p style="font-family:'Montserrat',Arial,sans-serif; font-size:9px; letter-spacing:2px; text-transform:uppercase; color:rgba(255,255,255,0.2); margin:0;">// CYBERSECURITY_TRAINING</p></td>
                        <td style="text-align:right;"><p style="font-family:'Montserrat',Arial,sans-serif; font-size:10px; color:rgba(255,255,255,0.2); margin:0; line-height:1.7;">Mensaje automático.<br/>No respondas a esta dirección.</p></td>
                    </tr></table>
                    </td>
                </tr>
                <tr>
                    <td style="background-color:#ccff00; padding:11px 40px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
                        <td><p style="font-family:'Montserrat',Arial,sans-serif; font-size:8px; font-weight:700; letter-spacing:2px; text-transform:uppercase; color:rgba(0,0,0,0.5); margin:0;">© ${new Date().getFullYear()} HIDDEN SECURITY · TODOS LOS DERECHOS RESERVADOS</p></td>
                        <td style="text-align:right;"><p style="font-family:'Montserrat',Arial,sans-serif; font-size:8px; font-weight:700; letter-spacing:2px; text-transform:uppercase; color:rgba(0,0,0,0.5); margin:0;">ARGENTINA</p></td>
                    </tr></table>
                    </td>
                </tr>
        
            </table>
            </td></tr>
        </table>
        </body></html>`;
        
    await brevo.transactionalEmails.sendTransacEmail({
        sender:      { email: process.env.EMAIL_FROM, name: "Hidden Security" },
        to:          [{ email }],
        subject:     "Verificá tu cuenta — Hidden Security",
        htmlContent: html,
    });
 
    console.log(`✅ Email de verificación enviado a ${email}`);
}

async function sendPasswordResetEmailBrevo(email) {
    const frontendUrl = process.env.FRONT_END || process.env.LOCAL_HOST || "http://localhost:5173";
 
    // Admin SDK genera el link: el frontend ya no necesita el SDK cliente ni la API key
    const link = await auth.generatePasswordResetLink(email, { url: `${frontendUrl}/` });
 
    const html = `
        <!DOCTYPE html>
        <html lang="es" xmlns="http://www.w3.org/1999/xhtml">
        <head>
            <meta charset="UTF-8" />
            <meta name="viewport" content="width=device-width, initial-scale=1.0" />
            <title>Restablecé tu contraseña — Hidden Security</title>
            <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;700;900&display=swap" rel="stylesheet">
            <style>* { box-sizing:border-box; margin:0; padding:0; } body { background-color:#111111; font-family:'Montserrat',Arial,sans-serif; }</style>
        </head>
        <body style="margin:0; padding:0; background-color:#111111;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#111111; padding:40px 16px;">
            <tr><td align="center">
            <table role="presentation" width="600" cellpadding="0" cellspacing="0"
                style="max-width:600px; width:100%; background-color:#000000; border:1px solid #ccff00;">
        
                <tr>
                    <td style="background-color:#ccff00; padding:28px 40px 24px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
                        <td style="vertical-align:bottom;">
                            <p style="font-family:'Montserrat',Arial,sans-serif; font-size:9px; font-weight:700; letter-spacing:4px; text-transform:uppercase; color:rgba(0,0,0,0.45); margin:0 0 6px;">// HIDDEN_SECURITY</p>
                            <p style="font-family:'Montserrat',Arial,sans-serif; font-size:28px; font-weight:900; letter-spacing:-1.5px; text-transform:uppercase; color:#000000; line-height:1; margin:0;">HIDDEN<span style="font-weight:400;">SECURITY</span></p>
                        </td>
                        <td style="text-align:right; vertical-align:bottom;">
                            <p style="font-family:'Montserrat',Arial,sans-serif; font-size:9px; font-weight:700; letter-spacing:2px; text-transform:uppercase; color:rgba(0,0,0,0.5); margin:0;">RESTABLECER<br/>CONTRASEÑA</p>
                        </td>
                    </tr></table>
                    </td>
                </tr>
        
                <tr><td style="background-color:#000000; padding:44px 40px 40px;">
        
                    <table role="presentation" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
                        <tr><td>
                        <span style="font-family:'Montserrat',Arial,sans-serif; font-size:9px; font-weight:700; letter-spacing:3px; text-transform:uppercase; color:#ccff00; border:1px solid rgba(204,255,0,0.35); padding:5px 14px; background:rgba(204,255,0,0.06); display:inline-block;">⚡ SOLICITUD_DE_CAMBIO</span>
                        </td></tr>
                    </table>
        
                    <p style="font-family:'Montserrat',Arial,sans-serif; font-size:32px; font-weight:900; letter-spacing:-2px; text-transform:uppercase; color:#ffffff; line-height:1.05; margin:0 0 18px;">
                        NUEVA<br/><span style="color:#ccff00; font-weight:400;">CONTRASEÑA.</span>
                    </p>
        
                    <p style="font-family:'Montserrat',Arial,sans-serif; font-size:13px; color:rgba(255,255,255,0.55); line-height:1.85; margin:0 0 36px;">
                        Recibimos un pedido para restablecer la contraseña de tu cuenta. Hacé click en el botón de abajo para elegir una nueva. Si no fuiste vos, ignorá este mensaje: tu contraseña actual sigue funcionando.
                    </p>
        
                    <table role="presentation" cellpadding="0" cellspacing="0" style="margin-bottom:36px;">
                        <tr>
                            <td style="background-color:#ccff00;">
                                <a href="${link}" style="display:block; padding:18px 40px; font-family:'Montserrat',Arial,sans-serif; font-size:11px; font-weight:900; letter-spacing:3px; text-transform:uppercase; color:#000000; text-decoration:none; white-space:nowrap;">
                                    CAMBIAR CONTRASEÑA →
                                </a>
                            </td>
                        </tr>
                    </table>
        
                    <p style="font-family:'Montserrat',Arial,sans-serif; font-size:8px; font-weight:700; letter-spacing:2px; text-transform:uppercase; color:rgba(255,255,255,0.2); margin:0 0 8px;">// Si el botón no funciona, copiá este link:</p>
                    <p style="font-family:'Montserrat',Arial,sans-serif; font-size:10px; color:rgba(255,255,255,0.25); word-break:break-all; line-height:1.6; margin:0;">${link}</p>
        
                </td></tr>
        
                <tr>
                    <td style="background-color:#0a0a0a; border-top:1px solid rgba(204,255,0,0.15); padding:24px 40px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
                        <td><p style="font-family:'Montserrat',Arial,sans-serif; font-size:13px; font-weight:700; letter-spacing:3px; text-transform:uppercase; color:#ccff00; margin:0 0 4px;">HIDDEN_SECURITY</p>
                        <p style="font-family:'Montserrat',Arial,sans-serif; font-size:9px; letter-spacing:2px; text-transform:uppercase; color:rgba(255,255,255,0.2); margin:0;">// CYBERSECURITY_TRAINING</p></td>
                        <td style="text-align:right;"><p style="font-family:'Montserrat',Arial,sans-serif; font-size:10px; color:rgba(255,255,255,0.2); margin:0; line-height:1.7;">Mensaje automático.<br/>No respondas a esta dirección.</p></td>
                    </tr></table>
                    </td>
                </tr>
                <tr>
                    <td style="background-color:#ccff00; padding:11px 40px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
                        <td><p style="font-family:'Montserrat',Arial,sans-serif; font-size:8px; font-weight:700; letter-spacing:2px; text-transform:uppercase; color:rgba(0,0,0,0.5); margin:0;">© ${new Date().getFullYear()} HIDDEN SECURITY · TODOS LOS DERECHOS RESERVADOS</p></td>
                        <td style="text-align:right;"><p style="font-family:'Montserrat',Arial,sans-serif; font-size:8px; font-weight:700; letter-spacing:2px; text-transform:uppercase; color:rgba(0,0,0,0.5); margin:0;">ARGENTINA</p></td>
                    </tr></table>
                    </td>
                </tr>
        
            </table>
            </td></tr>
        </table>
        </body></html>`;
 
    await brevo.transactionalEmails.sendTransacEmail({
        sender:      { email: process.env.EMAIL_FROM, name: "Hidden Security" },
        to:          [{ email }],
        subject:     "Restablecé tu contraseña — Hidden Security",
        htmlContent: html,
    });
}

// IP real del cliente detrás de Cloudflare + Render
const getClientIp = (req) => {
    const cfIp = req.headers["cf-connecting-ip"];
    if (cfIp) return String(cfIp);
    const forwarded = req.headers["x-forwarded-for"];
    if (forwarded) return String(forwarded).split(",")[0].trim();
    return req.ip || null;
};

// Email normalizado: "User@X.com " y "user@x.com" son la misma cuenta en
// Firebase, así que también tienen que compartir contador de intentos y cooldown
const normalizeEmail = (value) => (typeof value === "string" ? value.trim().toLowerCase() : "");
const isValidEmail   = (email) => !!email && email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

// ─── Rate limit de las rutas que crean cuentas o mandan mails (H-01) ──────────
// Por IP real (cf-connecting-ip). ipKeyGenerator existe desde express-rate-limit
// v8 y agrupa IPv6 por subred; en v7 se usa la IP tal cual.
const rateLimitLib   = require("express-rate-limit");
const rateLimit      = rateLimitLib.rateLimit || rateLimitLib;
const ipKeyGenerator = rateLimitLib.ipKeyGenerator || ((ip) => ip);

const makeLimiter = (limit, windowMs) => rateLimit({
    windowMs,
    limit,
    standardHeaders: "draft-7",
    legacyHeaders:   false,
    keyGenerator:    (req) => ipKeyGenerator(getClientIp(req) || "unknown"),
    handler:         (req, res) => res.status(429).json({
        code:    "auth/too-many-requests",
        message: "Demasiados intentos. Probá de nuevo en un rato.",
    }),
});

// 20 altas por hora por IP: deja registrarse a un aula entera detrás de la
// misma IP. La defensa fuerte contra bots es Turnstile, no este número.
const registerLimiter = makeLimiter(20, 60 * 60 * 1000);
// Reenvío de verificación y reset: 5 por hora por IP
const emailLimiter    = makeLimiter(5,  60 * 60 * 1000);

// ─── Cloudflare Turnstile (captcha) en el registro (H-01) ─────────────────────
// En producción sin TURNSTILE_SECRET el registro se rechaza (fail closed):
// configurá la variable en Render ANTES de deployar. En local sin clave se saltea.
async function verifyTurnstile(token, ip) {
    const secret = process.env.TURNSTILE_SECRET;
    if (!secret) {
        if (esProduccion) {
            console.error("TURNSTILE_SECRET missing — registro bloqueado 🔴");
            return false;
        }
        return true;
    }
    if (typeof token !== "string" || !token || token.length > 2048) return false;
    try {
        const params = new URLSearchParams({ secret, response: token });
        if (ip) params.append("remoteip", ip);
        const { data } = await axios.post(
            "https://challenges.cloudflare.com/turnstile/v0/siteverify",
            params.toString(),
            { headers: { "Content-Type": "application/x-www-form-urlencoded" }, timeout: 8000 }
        );
        return data?.success === true;
    } catch (err) {
        console.error(esProduccion ? "Turnstile verify failed 🔴" : `Turnstile verify failed 🔴 ${err}`);
        return false;
    }
}

// ─── Cooldown por email para los mails transaccionales (H-01) ─────────────────
// El rate limit es por IP: con muchas IPs se podría bombardear la casilla de
// una víctima usando Brevo. Esto limita a 1 mail de cada tipo por minuto por
// destinatario, venga de donde venga el pedido.
const EMAIL_COOLDOWN_MS = 60 * 1000;

async function emailCooldownOk(email, kind) {
    const now    = new Date();
    const filter = { email, event: "email-cooldown", "metadata.kind": kind };
    const last   = await Audit.findOne(filter).select("lastAttemptAt").lean();
    if (last?.lastAttemptAt && now - new Date(last.lastAttemptAt) < EMAIL_COOLDOWN_MS) {
        return false;
    }
    await Audit.updateOne(filter, { $set: { lastAttemptAt: now } }, { upsert: true });
    return true;
}

// Los mails de las rutas con respuesta genérica se mandan sin await: así el
// tiempo de respuesta no delata si la cuenta existe (oráculo por timing)
const sendInBackground = (promise, context) => {
    promise.catch((err) => {
        console.error(esProduccion ? `${context} 🔴` : `${context} 🔴 ${err}`);
    });
};

// ─── Bloqueo temporal del login (H-02) ────────────────────────────────────────
// Antes: 5 fallos = ban permanente → cualquiera que supiera un email podía
// banear esa cuenta. Ahora: 5 fallos = 15 min bloqueado, se desbloquea solo,
// y la respuesta es la misma exista o no la cuenta.
const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_LOCK_MS      = 15 * 60 * 1000;

const LOGIN_INVALID = {
    code:    "auth/invalid-credential",
    message: "Email o contraseña incorrectos.",
};
const LOGIN_LOCKED = {
    code:    "auth/too-many-attempts",
    message: "Demasiados intentos. Probá de nuevo en 15 minutos.",
};

// ─── Helper: PIN de firma del admin en el login ───────────────────────────────
// 4 dígitos = 10.000 combinaciones: sin límite de intentos se adivina en minutos.
// Por eso: 5 intentos y bloqueo temporal de 15 min (nunca ban: no te podés
// dejar afuera vos mismo). Llegar al límite significa que la contraseña del
// admin está filtrada → se revocan sus sesiones y queda un security-threat.
const ADMIN_PIN_MAX_ATTEMPTS = 5;
const ADMIN_PIN_LOCK_MS      = 15 * 60 * 1000;

async function checkAdminPin({ uid, email, adminPin, req }) {
    // Sin PIN: se le pide al front que lo muestre. No cuenta como intento.
    if (adminPin === undefined || adminPin === null || adminPin === "") {
        return { ok: false, status: 403, body: {
            code: "auth/admin-pin-required",
            message: "Ingresá tu clave de firma.",
        }};
    }

    // Solo un string de 4 dígitos (frena objetos tipo {"$ne": null} y basura)
    if (typeof adminPin !== "string" || !/^\d{4}$/.test(adminPin)) {
        return { ok: false, status: 400, body: {
            code: "auth/admin-pin-format",
            message: "La clave de firma son 4 dígitos.",
        }};
    }

    const now    = new Date();
    const filter = { uid, event: "admin-pin-failed" };

    // Si el último intento fue hace más de 15 min, el contador vuelve a cero
    await Audit.updateOne(
        { ...filter, lastAttemptAt: { $lt: new Date(now.getTime() - ADMIN_PIN_LOCK_MS) } },
        { $set: { attempts: 0 } }
    );

    // El intento se reserva ANTES de verificar y de forma atómica: así 100
    // pedidos en paralelo no consiguen 100 intentos (leer-chequear-guardar no sirve)
    const attempt = await Audit.findOneAndUpdate(
        filter,
        { $inc: { attempts: 1 }, $set: { lastAttemptAt: now, email } },
        { upsert: true, returnDocument: "after" }
    );

    if (attempt.attempts > ADMIN_PIN_MAX_ATTEMPTS) {
        return { ok: false, status: 429, body: {
            code: "auth/admin-pin-locked",
            message: "Clave de firma bloqueada. Probá de nuevo en 15 minutos.",
        }};
    }

    const valid = await verifyPin(adminPin);

    if (valid) {
        await Audit.updateOne(filter, { $set: { attempts: 0, lastAttemptAt: null } });
        return { ok: true };
    }

    const remaining = ADMIN_PIN_MAX_ATTEMPTS - attempt.attempts;

    if (remaining <= 0) {
        // Alguien tiene la contraseña del admin y está probando PINs
        try {
            await auth.revokeRefreshTokens(uid);
        } catch (err) {
            console.error(esProduccion ? "Admin PIN lock revoke failed 🔴" : `Admin PIN lock revoke failed 🔴 ${err}`);
        }
        try {
            await Audit.create({
                uid,
                email,
                event:     "security-threat",
                ip:        getClientIp(req),
                userAgent: req.headers["user-agent"],
                metadata:  { reason: "admin-pin-bruteforce", actionTaken: "locked-15m" },
            });
        } catch (err) {
            console.error(esProduccion ? "Audit admin-pin-bruteforce failed 🔴" : `Audit admin-pin-bruteforce failed 🔴 ${err}`);
        }
        console.warn(`🚨 SECURITY_THREAT // admin-pin-bruteforce uid=${uid} ip=${getClientIp(req)}`);

        return { ok: false, status: 429, body: {
            code: "auth/admin-pin-locked",
            message: "Clave de firma bloqueada. Probá de nuevo en 15 minutos.",
        }};
    }

    return { ok: false, status: 401, body: {
        code: "auth/admin-pin-invalid",
        remaining,
    }};
}

// ─── POST /register ───────────────────────────────────────────────────────────
authRouter.post("/register", registerLimiter, async (req, res) => {
    const { password, acceptedLegal, turnstileToken } = req.body || {};
    const email = normalizeEmail(req.body?.email);
    const regex = /^(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+=[\]{};':"\\|,.<>/?`~-]).{10,}$/;
    // Misma respuesta para cuenta nueva y para email ya registrado (H-02)
    const genericCreated = { message: `User created successfully! 🟢` };
    try {
        if (!isValidEmail(email) || typeof password !== "string" || password.length > 128){
            return res.status(400).json({ message: "All fields are required to create an user! 🔴" })
        }

        if (!regex.test(password)) {
            return res.status(400).json({ message: "Password does not meet security requirements! 🔴" });
        }

        // Estricto: tiene que llegar exactamente true (no "true", no 1)
        if (acceptedLegal !== true) {
            return res.status(400).json({
                code: "LEGAL_NOT_ACCEPTED",
                message: "Legal documents must be accepted to register! 🔴"
            });
        }

        // Anti-bot: el token de Turnstile se valida contra Cloudflare (H-01)
        const human = await verifyTurnstile(turnstileToken, getClientIp(req));
        if (!human) {
            return res.status(400).json({
                code:    "auth/captcha-failed",
                message: "No pudimos verificar que seas una persona. Probá de nuevo.",
            });
        }

        let userRecord;
        try {
            userRecord = await auth.createUser({ email, password });
        } catch (createErr) {
            if (createErr.code !== "auth/email-already-exists") throw createErr;

            // El email ya tiene cuenta: se responde igual que un alta nueva para
            // no revelarlo, y el dueño real recibe un mail útil en su casilla:
            // sin verificar → verificación de nuevo; verificada → link de reset.
            try {
                const existing = await auth.getUserByEmail(email);
                const blocked  = existing.disabled || existing.customClaims?.banned === true;
                if (!blocked) {
                    const kind = existing.emailVerified ? "reset" : "verify";
                    if (await emailCooldownOk(email, kind)) {
                        sendInBackground(
                            existing.emailVerified ? sendPasswordResetEmailBrevo(email) : sendVerificationEmail(email),
                            "Register existing-account email failed"
                        );
                    }
                }
            } catch (existingErr) {
                console.error(esProduccion ? "Register existing-account check failed 🔴" : `Register existing-account check failed 🔴 ${existingErr}`);
            }
            return res.status(201).send(genericCreated);
        }

        // Guardar el consentimiento. Si falla, se borra el usuario:
        // no puede existir una cuenta sin constancia de aceptación.
        try {
            await LegalConsent.create({
                uid: userRecord.uid,
                email,
                accepted: true,
                source: "register",
                documents: Object.entries(LEGAL_DOCUMENTS).map(([type, doc]) => ({
                    type,
                    version: doc.version,
                    url: doc.url,
                })),
                ip: getClientIp(req),
                userAgent: req.headers["user-agent"]?.slice(0, 500) || null,
            });
        } catch (consentErr) {
            console.error(esProduccion ? "Error saving legal consent! 🔴" : `Error saving legal consent! 🔴 ${consentErr}`);
            try {
                await auth.deleteUser(userRecord.uid);
            } catch (rollbackErr) {
                console.error(esProduccion ? "Rollback failed! 🔴" : `Rollback failed! 🔴 ${rollbackErr}`);
            }
            return res.status(500).send({ message: `Error creating user! 🔴` })
        }

        // Email de verificación: link de Firebase enviado por Brevo.
        // Marca el cooldown para que un "reenviar" inmediato no duplique el mail.
        try {
            await emailCooldownOk(email, "verify");
            await sendVerificationEmail(email);
        } catch (emailErr) {
            // No bloqueamos el registro si falla el envío del mail
            console.error("Error enviando email de verificación:", emailErr.message);
        }

        return res.status(201).send(genericCreated)
    } catch (error) {
        console.error(esProduccion ? `Error creating user! 🔴` : `Error creating user! 🔴 ${error}`);
        res.status(500).send({ message: `Error creating user! 🔴` })
    }
})

// ─── POST /login ──────────────────────────────────────────────────────────────
authRouter.post("/login", loginLimiter, async (req, res) => {
    const { password, acceptedLegal, adminPin } = req.body || {};
    const rawEmail = req.body?.email;

    // Tipos estrictos: un objeto en email terminaría como filtro de Mongo en la auditoría
    if (typeof rawEmail !== "string" || typeof password !== "string" || !rawEmail || !password
        || rawEmail.length > 254 || password.length > 128) {
        return res.status(400).json({ code: "auth/invalid-input", message: "Email y contraseña son requeridos." });
    }

    const email      = normalizeEmail(rawEmail);
    const failFilter = { email, event: "login-failed" };

    // Formato inválido → 400 antes de tocar Firebase (si no, INVALID_EMAIL daba 500).
    // Validar el formato no revela si la cuenta existe.
    if (!isValidEmail(email)) {
        return res.status(400).json({ code: "auth/invalid-input", message: "Email y contraseña son requeridos." });
    }

    try {
        // 0. Bloqueo temporal por email (H-02). Se aplica exista o no la cuenta,
        // así el bloqueo tampoco sirve para averiguar qué emails están registrados.
        // Si el último intento fue hace más de 15 min, el contador vuelve a cero.
        const now = new Date();
        await Audit.updateOne(
            { ...failFilter, lastAttemptAt: { $lt: new Date(now.getTime() - LOGIN_LOCK_MS) } },
            { $set: { attempts: 0 } }
        );

        // El intento se reserva ANTES de validar y de forma atómica (como el PIN):
        // 100 pedidos en paralelo no consiguen 100 intentos.
        const attempt = await Audit.findOneAndUpdate(
            failFilter,
            { $inc: { attempts: 1 }, $set: { lastAttemptAt: now } },
            { upsert: true, returnDocument: "after" }
        );

        if (attempt.attempts > LOGIN_MAX_ATTEMPTS) {
            return res.status(429).json(LOGIN_LOCKED);
        }

        // 1. Validar credenciales contra la API de Firebase Auth
        const firebaseResponse = await axios.post(
            `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${process.env.FIREBASE_API_KEY}`,
            { email, password, returnSecureToken: true },
            { timeout: 8000 } // si Google tarda, no se cuelga el worker
        );

        const { idToken, localId: uid } = firebaseResponse.data;

        // Contraseña correcta → contador a cero. Va acá y no al final porque los
        // pasos siguientes (PIN, legales, email sin verificar) cortan antes y no
        // tienen que sumar intentos a quien sí sabe la contraseña.
        await Audit.updateOne(failFilter, { $set: { attempts: 0, lastAttemptAt: null } });

        // 2. Verificar el token obtenido y obtener claims
        const decoded = await auth.verifyIdToken(idToken);

        // 3. Control de Baneo
        if (decoded.banned) {
            return res.status(403).json({ code: "auth/user-banned", message: "User is banned" });
        }

        // 4. Verificar email confirmado (solo usuarios normales)
        // Admin y Enterprise quedan exentos de esta validación
        const isAdmin      = decoded.admin      === true;
        const isEnterprise = !!decoded.isEnterprise;
        const isPartner = !!decoded.partner;

        if (!isAdmin && !isEnterprise && !isPartner) {
            const userRecord = await auth.getUser(uid);
            if (!userRecord.emailVerified) {
                return res.status(403).json({
                    code:    "auth/email-not-verified",
                    message: "Debés verificar tu email antes de ingresar.",
                });
            }
        }

        // 4.2 Segundo factor del admin: clave de firma. Va ANTES de emitir la
        // cookie: con la contraseña sola no se obtiene sesión de admin.
        if (isAdmin) {
            const pinCheck = await checkAdminPin({ uid, email: decoded.email, adminPin, req });
            if (!pinCheck.ok) {
                return res.status(pinCheck.status).json(pinCheck.body);
            }
        }

        // 4.5 Verificar aceptación de documentos legales (versiones vigentes)
        const hasValidConsent = await LegalConsent.exists({
            uid,
            $and: Object.entries(LEGAL_DOCUMENTS).map(([type, doc]) => ({
                documents: { $elemMatch: { type, version: doc.version } }
            }))
        });

        if (!hasValidConsent) {
            if (acceptedLegal !== true) {
                return res.status(403).json({
                    code:    "auth/legal-not-accepted",
                    message: "Debés aceptar los documentos legales para ingresar.",
                });
            }

            await LegalConsent.create({
                uid,
                email:     decoded.email,
                accepted:  true,
                source:    "reaccept",
                documents: Object.entries(LEGAL_DOCUMENTS).map(([type, doc]) => ({
                    type,
                    version: doc.version,
                    url:     doc.url,
                })),
                ip:        getClientIp(req),
                userAgent: req.headers["user-agent"]?.slice(0, 500) || null,
            });
        }

        // 5. Auditar login exitoso (el contador ya se limpió en el paso 1)
        await Audit.create({
            uid: uid,
            email: decoded.email,
            event: "login",
            ip: getClientIp(req), // IP real detrás de Cloudflare + Render
            userAgent: req.headers["user-agent"]
        });

        // 5.5 Atar la sesión de admin a ESTE login con PIN.
        // auth_time es el momento del inicio de sesión en Firebase y se mantiene
        // en los refrescos del token. Si alguien consigue un idToken del admin
        // por otro lado (signInWithPassword directo), tiene otro auth_time y
        // adminMiddleware lo rechaza. Un login nuevo reemplaza al anterior.
        if (isAdmin) {
            await Audit.findOneAndUpdate(
                { uid, event: "admin-pin-session" },
                { $set: {
                    email:         decoded.email,
                    metadata:      { authTime: decoded.auth_time },
                    ip:            getClientIp(req),
                    userAgent:     req.headers["user-agent"]?.slice(0, 500) || null,
                    lastAttemptAt: new Date(),
                }},
                { upsert: true }
            );
        }

        // 6. Configurar Cookie
        if (esProduccion) {
            res.cookie("idToken", idToken, {
                httpOnly: true,
                sameSite: "lax",
                secure: true,
                domain: ".hidden-security.org",
                maxAge: 60 * 60 * 1000,
                path: "/"
            });
        } else {
            res.cookie("idToken", idToken, {
                httpOnly: true,
                sameSite: "none",
                secure: true,
                path: "/" 
            });
        }

        // ── Objeto de usuario propio — nunca mandar decoded directo ──────────
        const userPayload = {
            uid:                   decoded.uid,
            email:                 decoded.email,
            nombre:                decoded.nombre                || null,
            // Roles
            admin:                 decoded.admin                 === true,
            isEnterprise:          !!decoded.isEnterprise,
            partner:                !!decoded.partner,
            userCertificated:      !!decoded.userCertificated,
            // Planes usuario normal
            purchases:             Array.isArray(decoded.purchases) ? decoded.purchases : [],
            purchaseExpiry:        decoded.purchaseExpiry        || {},
            // Planes enterprise
            enterprisePlan:        decoded.enterprisePlan        || null,
            enterprisePlanExpiry:  decoded.enterprisePlanExpiry  || null,
            vacancyLimit:          decoded.vacancyLimit          ?? null,
            vacanciesUsed:         decoded.vacanciesUsed         ?? 0,
            // Empresa
            companyName:           decoded.companyName           || null,
            companyLogo:           decoded.companyLogo           || null,
        };

        return res.status(200).json({ 
            user:        userPayload,
            isAdmin:     userPayload.admin,
            isEnterprise: userPayload.isEnterprise,
            partner: userPayload.partner,
        });

    } catch (error) {
        const errorData = error.response?.data?.error?.message;
        const errorCode = errorData ? errorData.split(' ')[0] : null;

        // Email inexistente, contraseña incorrecta o cuenta deshabilitada:
        // MISMO status, MISMO código, MISMO mensaje y sin contador (H-02).
        // El intento ya quedó sumado en el paso 0.
        const loginErrors = ["INVALID_PASSWORD", "EMAIL_NOT_FOUND", "INVALID_LOGIN_CREDENTIALS", "USER_DISABLED", "INVALID_EMAIL"];
        if (loginErrors.includes(errorCode)) {
            return res.status(401).json(LOGIN_INVALID);
        }

        // Firebase también frena por su cuenta cuando detecta fuerza bruta
        if (errorCode === "TOO_MANY_ATTEMPTS_TRY_LATER") {
            return res.status(429).json(LOGIN_LOCKED);
        }

        console.error("SYSTEM_LOGIN_ERROR 🔴", errorCode || error.message);
        return res.status(500).json({ message: "Internal Server Error" });
    }
})

// ─── POST /resend-verification ────────────────────────────────────────────────
// Rate limit por IP + cooldown por email: sin esto cualquiera puede disparar
// mails de Brevo en loop. Respuesta única: no revela si la cuenta existe ni si
// ya está verificada (antes daba 404 / 400 distintos = oráculo).
authRouter.post("/resend-verification", loginLimiter, emailLimiter, async (req, res) => {
    const email = normalizeEmail(req.body?.email);

    if (!isValidEmail(email)) {
        return res.status(400).json({ code: "auth/invalid-email", message: "Email inválido." });
    }

    const genericOk = { message: "Si la cuenta existe y no está verificada, te reenviamos el email. 🟢" };

    try {
        const userRecord = await auth.getUserByEmail(email);
        const canSend = !userRecord.emailVerified
            && !userRecord.disabled
            && userRecord.customClaims?.banned !== true;

        if (canSend && await emailCooldownOk(email, "verify")) {
            sendInBackground(sendVerificationEmail(email), "Error reenviando verificación");
        }

        return res.status(200).json(genericOk);

    } catch (error) {
        if (error.code === "auth/user-not-found") {
            return res.status(200).json(genericOk);
        }
        console.error("Error reenviando verificación:", error.message);
        return res.status(500).json({ message: "Error al reenviar el email." });
    }
});

// ─── POST /logout ─────────────────────────────────────────────────────────────
authRouter.post("/logout", async (req, res) => {
    const idToken = req.cookies.idToken;
    try {
        if(idToken){
            const decoded = await auth.verifyIdToken(idToken)
            await Audit.create({
                uid: decoded.uid,
                email: decoded.email,
                event: "logout",
                ip: getClientIp(req), // IP real detrás de Cloudflare + Render
                userAgent: req.headers["user-agent"]
            });
        }

        if(esProduccion){
            res.clearCookie("idToken", {
                httpOnly: true,
                sameSite: "lax",
                secure: true,
                domain: ".hidden-security.org",
                path: "/" 
            });
        } else{
            res.clearCookie("idToken", {
                httpOnly: true,
                sameSite: "none",
                secure: true,
                path: "/" 
            });
        }

        return res.status(200).json({ message: "Logout audited! 🟢" })
    } catch (error) {
        console.error(esProduccion ? `Logout fallback! 🔴` : `Logout fallback! 🔴 ${error}`);
        return res.status(200).json({ message: "Logout fallback! 🟡" });
    }
})

// ─── POST /admin/ban-user ─────────────────────────────────────────────────────
authRouter.post("/admin/ban-user", adminMiddleware, async (req, res) => {
    const { email } = req.body
    if(!email){
        return res.status(400).json({ message: "Email is required to audit failed login! 🔴" })
    }
    try {
        const now = Date.now()
        const user = await auth.getUserByEmail(email)
        // Merge con las claims existentes para no perder roles ni compras
        await auth.setCustomUserClaims(user.uid, {
            ...(user.customClaims || {}),
            banned: true,
            bannedAt: now,
            bannedReason: "Banned directly by admin."
        })
        await auth.revokeRefreshTokens(user.uid)
        return res.status(200).json({ message: "User banned successfully! 🟢" })
    } catch (error) {
        console.error(esProduccion ? `Error auditing failed login 🔴` : `Error auditing failed login 🔴 ${error}`);
        return res.status(500).json({ message: "Error auditing failed login! 🔴" });  
    }
})

// ─── POST /unban-user ─────────────────────────────────────────────────────────
authRouter.post("/unban-user", adminMiddleware, async (req, res) => {
    const { uid } = req.body
    if(!uid){
        return res.status(400).json({ message: "User UID is required! 🔴" })
    }
    try {
        const user = await auth.getUser(uid)
        // Quita solo los datos del baneo y conserva el resto de las claims
        const { banned, bannedAt, bannedReason, ...restClaims } = user.customClaims || {};
        await auth.setCustomUserClaims(uid, { ...restClaims, banned: false })
        await auth.revokeRefreshTokens(uid)
        // El contador de login está guardado por email (no por uid): antes este
        // filtro nunca encontraba nada. Ahora el desbaneo también levanta el bloqueo.
        if (user.email) {
            await Audit.updateOne(
                { email: normalizeEmail(user.email), event: "login-failed" },
                { $set: { attempts: 0, lastAttemptAt: null } }
            )
        }
        await Audit.create({
            uid,
            email: user.email,
            event: "forced_logout",
            metadata: { action: "unban", by: "admin" }
        });
        return res.status(200).json({ message: "User unbanned successfully! 🟢" });
    } catch (error) {
        console.error(esProduccion ? `Error unbanning user! 🔴` : `Error unbanning user! 🔴 ${error}`);
        return res.status(500).json({ message: "Error unbanning user! 🔴" });
    }
})

// ─── GET /check-auth ──────────────────────────────────────────────────────────
authRouter.get("/check-auth", verifyToken, async (req, res) => {
    try {
        // verifyToken ya validó el token (con checkRevoked) y dejó las claims en req.user
        const decoded = req.user;
        if (!decoded?.uid) {
            return res.status(401).json({ authenticated: false });
        }

        const userPayload = {
            uid:                   decoded.uid,
            email:                 decoded.email,
            nombre:                decoded.nombre                || null,
            admin:                 decoded.admin                 === true,
            isEnterprise:          !!decoded.isEnterprise,
            partner:                !!decoded.partner,
            userCertificated:      !!decoded.userCertificated,
            purchases:             Array.isArray(decoded.purchases) ? decoded.purchases : [],
            purchaseExpiry:        decoded.purchaseExpiry        || {},
            enterprisePlan:        decoded.enterprisePlan        || null,
            enterprisePlanExpiry:  decoded.enterprisePlanExpiry  || null,
            vacancyLimit:          decoded.vacancyLimit          ?? null,
            vacanciesUsed:         decoded.vacanciesUsed         ?? 0,
            companyName:           decoded.companyName           || null,
            companyLogo:           decoded.companyLogo           || null,
        };

        return res.status(200).json({ 
            authenticated: true, 
            user:        userPayload,
            isAdmin:     userPayload.admin,
            isEnterprise: userPayload.isEnterprise,
            partner: userPayload.partner,
        });
    } catch (error) {
        return res.status(401).json({ authenticated: false });
    }
});

// ─── GET /me ──────────────────────────────────────────────────────────────────
authRouter.get("/me", verifyToken, checkBanned, async (req, res) => {
    try {
        // verifyToken ya validó el token (con checkRevoked) y dejó las claims en req.user
        const decoded = req.user;
        if (!decoded?.uid) return res.status(401).json({ message: "No token" });
        if (decoded.banned) {
            return res.status(403).json({ message: "Banned" });
        }

        const userPayload = {
            uid:                   decoded.uid,
            email:                 decoded.email,
            nombre:                decoded.nombre                || null,
            admin:                 decoded.admin                 === true,
            isEnterprise:          !!decoded.isEnterprise,
            partner:                !!decoded.partner,
            userCertificated:      !!decoded.userCertificated,
            purchases:             Array.isArray(decoded.purchases) ? decoded.purchases : [],
            purchaseExpiry:        decoded.purchaseExpiry        || {},
            enterprisePlan:        decoded.enterprisePlan        || null,
            enterprisePlanExpiry:  decoded.enterprisePlanExpiry  || null,
            vacancyLimit:          decoded.vacancyLimit          ?? null,
            vacanciesUsed:         decoded.vacanciesUsed         ?? 0,
            companyName:           decoded.companyName           || null,
            companyLogo:           decoded.companyLogo           || null,
        };

        return res.status(200).json({ user: userPayload });
    } catch (error) {
        return res.status(401).json({ message: "Invalid token" });
    }
});

const PROTECTED_ZONES = {
    admin: {
        claim:  "admin",
        type:   "unauthorized-admin-access",
        reason: "Unauthorized admin access attempt",
    },
    enterprise: {
        claim:  "isEnterprise",
        type:   "unauthorized-enterprise-access",
        reason: "Unauthorized enterprise access attempt",
    },
    partner: {
        claim:  "partner",
        type:   "unauthorized-partner-access",
        reason: "Unauthorized partner access attempt",
    },
};
 
// Lo llama cada dashboard protegido al montar. Si el token firmado NO tiene
// el rol de la zona, alguien llegó al panel manipulando respuestas (Burp):
// se registra el incidente, se banea la cuenta, se revocan sus sesiones y
// se borra la cookie.
const verifyZoneAccess = (zoneKey) => async (req, res) => {
    const zone    = PROTECTED_ZONES[zoneKey];
    const decoded = req.user;
 
    // Acceso legítimo (según el token verificado y firmado por Firebase)
    if (decoded[zone.claim] === true && decoded.banned !== true) {
        return res.status(200).json({ ok: true });
    }
 
    const now = Date.now();
    const str = (v, max = 300) => (v == null ? null : String(v).slice(0, max));
 
    let userRecord = null;
    try {
        userRecord = await auth.getUser(decoded.uid);
    } catch (err) {
        console.error(esProduccion ? "verify-zone getUser failed 🔴" : `verify-zone getUser failed 🔴 ${err}`);
    }
    const currentClaims = userRecord?.customClaims || {};
 
    // Caso legítimo: le acaban de dar el rol y su token todavía es el viejo.
    // No es un ataque → no se banea, solo se pide volver a iniciar sesión.
    if (currentClaims[zone.claim] === true && currentClaims.banned !== true) {
        return res.status(409).json({ code: "SESSION_REFRESH_REQUIRED", message: "Volvé a iniciar sesión." });
    }
 
    // ── Ban (merge: conserva compras y demás claims) ─────────────────────────
    // Nunca se banea automáticamente una cuenta admin: se registra el
    // incidente igual, pero así no te podés dejar afuera vos mismo.
    let actionTaken = "banned";
    let actionError = null;
    try {
        if (currentClaims.admin === true || decoded.admin === true) {
            actionTaken = "skipped-admin";
        } else if (decoded.banned === true || currentClaims.banned === true) {
            actionTaken = "already-banned";
            await auth.revokeRefreshTokens(decoded.uid);
        } else {
            await auth.setCustomUserClaims(decoded.uid, {
                ...currentClaims,
                banned:       true,
                bannedAt:     now,
                bannedReason: zone.reason,
            });
            await auth.revokeRefreshTokens(decoded.uid);
        }
    } catch (err) {
        actionTaken = "ban-failed";
        actionError = str(err?.message, 500);
        console.error(esProduccion ? "verify-zone ban failed 🔴" : `verify-zone ban failed 🔴 ${err}`);
    }
 
    // ── Registro del incidente ───────────────────────────────────────────────
    let incidentId = null;
    try {
        const incident = await SecurityIncident.create({
            type:             zone.type,
            zone:             zoneKey,
            uid:              decoded.uid,
            email:            decoded.email || userRecord?.email || null,
            emailVerified:    userRecord?.emailVerified ?? decoded.email_verified ?? null,
            accountCreatedAt: userRecord?.metadata?.creationTime ? new Date(userRecord.metadata.creationTime) : null,
            lastSignInAt:     userRecord?.metadata?.lastSignInTime ? new Date(userRecord.metadata.lastSignInTime) : null,
 
            ip:             getClientIp(req),
            ipChain:        str(req.headers["x-forwarded-for"]),
            country:        str(req.headers["cf-ipcountry"], 10),
            userAgent:      str(req.headers["user-agent"], 500),
            acceptLanguage: str(req.headers["accept-language"], 200),
            referer:        str(req.headers["referer"], 500),
            origin:         str(req.headers["origin"], 200),
 
            method:        req.method,
            endpoint:      str(req.originalUrl, 200),
            attemptedPath: str(req.body?.path, 200),
            attemptedTab:  str(req.body?.tab, 50),
 
            tokenClaims: {
                admin:        decoded.admin === true,
                isEnterprise: !!decoded.isEnterprise,
                partner:      !!decoded.partner,
                banned:       decoded.banned === true,
            },
            signInProvider: str(decoded.firebase?.sign_in_provider, 50),
            tokenIssuedAt:  decoded.iat ? new Date(decoded.iat * 1000) : null,
            tokenAuthTime:  decoded.auth_time ? new Date(decoded.auth_time * 1000) : null,
 
            actionTaken,
            actionError,
            detectedAt: new Date(now),
        });
        incidentId = String(incident._id);
    } catch (err) {
        console.error(esProduccion ? "SECURITY_INCIDENT save failed 🔴" : `SECURITY_INCIDENT save failed 🔴 ${err}`);
    }
 
    // Queda también en tu auditoría general
    try {
        await Audit.create({
            uid:       decoded.uid,
            email:     decoded.email,
            event:     "security-threat",
            ip:        getClientIp(req),
            userAgent: req.headers["user-agent"],
            metadata:  { reason: zone.type, incidentId, actionTaken },
        });
    } catch (err) {
        console.error(esProduccion ? "Audit security-threat failed 🔴" : `Audit security-threat failed 🔴 ${err}`);
    }
 
    console.warn(`🚨 SECURITY_THREAT // ${zone.type} uid=${decoded.uid} email=${decoded.email} ip=${getClientIp(req)} action=${actionTaken}`);
 
    // ── Cerrar la sesión en el navegador (salvo admin, que no se banea) ──────
    if (actionTaken !== "skipped-admin") {
        res.clearCookie("idToken", esProduccion
            ? { httpOnly: true, sameSite: "lax", secure: true, domain: ".hidden-security.org", path: "/" }
            : { httpOnly: true, sameSite: "none", secure: true, path: "/" }
        );
    }
 
    return res.status(403).json({
        code:    "SECURITY_THREAT",
        message: "Unauthorized access attempt detected.",
        incidentId,
    });
};
 
// ─── POST /admin/verify-access ─────────────────────────────────── (AdminDashboard)
authRouter.post("/admin/verify-access", verifyToken, verifyZoneAccess("admin"));
 
// ─── POST /security/verify-enterprise-access ───────────────── (EnterpriseDashboard)
authRouter.post("/security/verify-enterprise-access", verifyToken, verifyZoneAccess("enterprise"));

authRouter.post("/security/verify-partner-access", verifyToken, verifyZoneAccess("partner"));

authRouter.post("/reset-password", loginLimiter, emailLimiter, async (req, res) => {
    const email = normalizeEmail(req.body?.email);

    if (!isValidEmail(email)) {
        return res.status(400).json({ code: "auth/invalid-email", message: "Invalid email" });
    }
 
    const genericOk = { message: "Si el email está registrado, vas a recibir un link para restablecer la contraseña. 🟢" };
 
    try {
        const userRecord = await auth.getUserByEmail(email);
 
        // Baneados y cuentas deshabilitadas no reciben link (respuesta igual)
        if (userRecord.disabled || userRecord.customClaims?.banned === true) {
            return res.status(200).json(genericOk);
        }
 
        // Cooldown por destinatario + envío sin await (mismo tiempo de respuesta
        // exista o no la cuenta)
        if (await emailCooldownOk(email, "reset")) {
            sendInBackground(sendPasswordResetEmailBrevo(email), "Error sending password reset");
        }
        return res.status(200).json(genericOk);
    } catch (error) {
        if (error?.code === "auth/user-not-found") {
            return res.status(200).json(genericOk);
        }
        console.error(esProduccion ? "Error sending password reset 🔴" : `Error sending password reset 🔴 ${error}`);
        return res.status(500).json({ message: "Error sending email" });
    }
});

module.exports = authRouter