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

// ─── Helper: verificar si un email existe en Firebase ─────────────────────────
async function emailExistsInFirebase(email) {
    try {
        await auth.getUserByEmail(email);
        return true;
    } catch (err) {
        if (err.code === "auth/user-not-found") return false;
        throw err;
    }
}

// ─── POST /register ───────────────────────────────────────────────────────────
// IP real del cliente detrás de Cloudflare + Render
const getClientIp = (req) => {
    const cfIp = req.headers["cf-connecting-ip"];
    if (cfIp) return String(cfIp);
    const forwarded = req.headers["x-forwarded-for"];
    if (forwarded) return String(forwarded).split(",")[0].trim();
    return req.ip || null;
};

authRouter.post("/register", async (req, res) => {
    const { email, password, acceptedLegal } = req.body
    const regex = /^(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+=[\]{};':"\\|,.<>/?`~-]).{10,}$/;
    try {
        if (!email || typeof password !== "string"){
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

        const userRecord = await auth.createUser({ email, password })

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

        // Enviar email de verificación — Firebase lo manda directamente
        try {
            await sendVerificationEmail(email);
        } catch (emailErr) {
            // No bloqueamos el registro si falla el envío del mail
            console.error("Error enviando email de verificación:", emailErr.message);
        }
        
        return res.status(201).send({ message: `User created successfully! 🟢` })
    } catch (error) {
        if (error.code === 'auth/email-already-exists') {
            return res.status(409).json({ 
                message: "This email is already registered! 🔴" 
            });
        }
        console.error(esProduccion ? `Error creating user! 🔴` : `Error creating user! 🔴 ${error}`);
        res.status(500).send({ message: `Error creating user! 🔴` })
    }
})

// ─── POST /login ──────────────────────────────────────────────────────────────
authRouter.post("/login", loginLimiter, async (req, res) => {
    const { email, password, acceptedLegal } = req.body;

    try {
        // 0. Verificar que el email existe antes de intentar autenticar
        // Así evitamos que mails inexistentes acumulen intentos y queden baneados
        const exists = await emailExistsInFirebase(email);
        if (!exists) {
            return res.status(404).json({
                code: "auth/user-not-found",
                message: "No existe ninguna cuenta registrada con ese email.",
            });
        }

        // 1. Validar credenciales contra la API de Firebase Auth
        const firebaseResponse = await axios.post(
            `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${process.env.FIREBASE_API_KEY}`,
            { email, password, returnSecureToken: true }
        );

        const { idToken, localId: uid } = firebaseResponse.data;

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

        // 5. Limpiar intentos fallidos y auditar login exitoso
        await Audit.findOneAndUpdate(
            { email: decoded.email, event: "login-failed" },
            { $set: { attempts: 0, lastAttemptAt: null } }
        );

        await Audit.create({
            uid: uid,
            email: decoded.email,
            event: "login",
            ip: req.ip,
            userAgent: req.headers["user-agent"]
        });

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
        const now = Date.now();

        console.log("DEBUG // Error detectado:", errorCode);

        const loginErrors = ["INVALID_PASSWORD", "EMAIL_NOT_FOUND", "INVALID_LOGIN_CREDENTIALS"];

        if (loginErrors.includes(errorCode)) {
            try {
                const userEmail = req.body.email;

                const attempt = await Audit.findOneAndUpdate(
                    { email: userEmail, event: "login-failed" },
                    { 
                        $inc: { attempts: 1 }, 
                        $set: { lastAttemptAt: now } 
                    },
                    { upsert: true, returnDocument: 'after' }
                );

                if (attempt.attempts >= 5) {
                    try {
                        const userRecord = await auth.getUserByEmail(userEmail);
                        // Merge con las claims existentes: setCustomUserClaims
                        // REEMPLAZA todo el objeto (borraría admin, purchases, etc.)
                        await auth.setCustomUserClaims(userRecord.uid, {
                            ...(userRecord.customClaims || {}),
                            banned: true,
                            bannedAt: now,
                            bannedReason: "Too many failed login attempts"
                        });
                        await auth.revokeRefreshTokens(userRecord.uid);
                        
                        return res.status(401).json({ 
                            code: "auth/too-many-attempts", 
                            banned: true 
                        });
                    } catch (getUserError) {
                        return res.status(401).json({ 
                            code: "auth/invalid-credential", 
                            attempts: attempt.attempts 
                        });
                    }
                }

                return res.status(401).json({ 
                    code: "auth/invalid-credential", 
                    attempts: attempt.attempts 
                });

            } catch (dbError) {
                console.error("DB_AUDIT_CRITICAL_ERROR 🔴", dbError);
                return res.status(401).json({ code: "auth/invalid-credential" });
            }
        }
        
        console.error("SYSTEM_LOGIN_ERROR 🔴", errorCode || error.message);
        return res.status(500).json({ message: "Internal Server Error" });
    }
})

// ─── POST /resend-verification ────────────────────────────────────────────────
authRouter.post("/resend-verification", async (req, res) => {
    const { email } = req.body;

    if (!email) {
        return res.status(400).json({ message: "Email es requerido." });
    }

    try {
        const userRecord = await auth.getUserByEmail(email);

        if (userRecord.emailVerified) {
            return res.status(400).json({ 
                code:    "auth/already-verified",
                message: "Este email ya está verificado." 
            });
        }

        await sendVerificationEmail(email);

        return res.status(200).json({ message: "Email de verificación reenviado. 🟢" });

    } catch (error) {
        if (error.code === "auth/user-not-found") {
            return res.status(404).json({ message: "No existe una cuenta con ese email." });
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
                ip: req.ip || req.headers['x-forwarded-for'],
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
        await Audit.findOneAndUpdate(
            { uid, event: "login-failed" },
            { $set: { attempts: 0, lastAttemptAt: null } }
        )
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

authRouter.post("/admin/verify-access", verifyToken, async (req, res) => {
    const decoded = req.user;
 
    // Admin real (según el token verificado y firmado por Firebase)
    if (decoded.admin === true && decoded.banned !== true) {
        return res.status(200).json({ ok: true });
    }
 
    const now = Date.now();
    const str = (v, max = 300) => (v == null ? null : String(v).slice(0, max));
 
    let userRecord = null;
    try {
        userRecord = await auth.getUser(decoded.uid);
    } catch (err) {
        console.error(esProduccion ? "verify-access getUser failed 🔴" : `verify-access getUser failed 🔴 ${err}`);
    }
 
    // Caso legítimo: lo acaban de hacer admin y su token todavía es el viejo.
    // No es un ataque → no se banea, solo se pide volver a iniciar sesión.
    if (userRecord?.customClaims?.admin === true && userRecord?.customClaims?.banned !== true) {
        return res.status(409).json({ code: "SESSION_REFRESH_REQUIRED", message: "Volvé a iniciar sesión." });
    }
 
    // ── Ban (merge: conserva compras y demás claims) ─────────────────────────
    let actionTaken = "banned";
    let actionError = null;
    try {
        if (decoded.banned === true || userRecord?.customClaims?.banned === true) {
            actionTaken = "already-banned";
        } else {
            await auth.setCustomUserClaims(decoded.uid, {
                ...(userRecord?.customClaims || {}),
                banned: true,
                bannedAt: now,
                bannedReason: "Unauthorized admin access attempt",
            });
        }
        await auth.revokeRefreshTokens(decoded.uid);
    } catch (err) {
        actionTaken = "ban-failed";
        actionError = str(err?.message, 500);
        console.error(esProduccion ? "verify-access ban failed 🔴" : `verify-access ban failed 🔴 ${err}`);
    }
 
    // ── Registro del incidente ───────────────────────────────────────────────
    let incidentId = null;
    try {
        const incident = await SecurityIncident.create({
            type:             "unauthorized-admin-access",
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
            metadata:  { reason: "unauthorized-admin-access", incidentId, actionTaken },
        });
    } catch (err) {
        console.error(esProduccion ? "Audit security-threat failed 🔴" : `Audit security-threat failed 🔴 ${err}`);
    }
 
    console.warn(`🚨 SECURITY_THREAT // unauthorized admin access uid=${decoded.uid} email=${decoded.email} ip=${getClientIp(req)} action=${actionTaken}`);
 
    // ── Cerrar la sesión en el navegador ─────────────────────────────────────
    res.clearCookie("idToken", esProduccion
        ? { httpOnly: true, sameSite: "lax", secure: true, domain: ".hidden-security.org", path: "/" }
        : { httpOnly: true, sameSite: "none", secure: true, path: "/" }
    );
 
    return res.status(403).json({
        code:    "SECURITY_THREAT",
        message: "Unauthorized admin access attempt detected.",
        incidentId,
    });
});


module.exports = authRouter