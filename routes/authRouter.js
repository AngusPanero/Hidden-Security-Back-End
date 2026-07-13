// Express y Router
const express = require("express")
const authRouter = express.Router()
// Firebase Admin SDK
const auth = require("../config/firebase")
// Models
const Audit = require("../models/AuditSchema")
// Middlewares
const loginLimiter = require("../middleware/rateLimitMiddleware")
const checkBanned = require("../middleware/checkBanned")
const verifyToken = require("../middleware/authMiddleware")
const adminMiddleware = require("../middleware/adminMiddleware")
// Axios
const axios = require("axios")
// Nodemailer — mismo transporter que mailRouter
const nodemailer = require("nodemailer")

const esProduccion = (process.env.NODE_ENV === 'production');

const createTransporter = () => nodemailer.createTransport({
    service: "gmail",
    auth: {
        user: process.env.EMAIL_FROM,
        pass: process.env.PASS_EMAIL,
    },
});

// ─── Helper: enviar email de verificación ─────────────────────────────────────
async function sendVerificationEmail(email) {
    const frontendUrl = process.env.FRONT_END || process.env.LOCAL_HOST || "http://localhost:5173";

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

    const transporter = createTransporter();
    await transporter.sendMail({
        from:    process.env.EMAIL_FROM,
        to:      email,
        subject: "Verificá tu cuenta — Hidden Security",
        html,
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
authRouter.post("/register", async (req, res) => {
    const { email, password } = req.body
    const regex = /^(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{10,}$/;
    try {
        if(!email || !password){
            return res.status(400).json({ message: "All fields are required to create an user! 🔴" })
        }

        if (!regex.test(password)) {
            return res.status(400).json({ message: "Password does not meet security requirements! 🔴" });
        }

        await auth.createUser({ email, password })

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
    const { email, password } = req.body; 

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
        console.log("DECODED ADMIN:", decoded.admin);
        console.log("DECODED EMAIL:", decoded.email);
        console.log("ALL CLAIMS:", JSON.stringify(decoded));

        // 3. Control de Baneo
        if (decoded.banned) {
            return res.status(403).json({ code: "auth/user-banned", message: "User is banned" });
        }

        // 4. Verificar email confirmado (solo usuarios normales)
        // Admin y Enterprise quedan exentos de esta validación
        const isAdmin      = decoded.admin      === true;
        const isEnterprise = !!decoded.isEnterprise;

        if (!isAdmin && !isEnterprise) {
            const userRecord = await auth.getUser(uid);
            if (!userRecord.emailVerified) {
                return res.status(403).json({
                    code:    "auth/email-not-verified",
                    message: "Debés verificar tu email antes de ingresar.",
                });
            }
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
        res.cookie("idToken", idToken, {
            httpOnly: true,
            sameSite: "lax",
            secure: true,
            domain: ".hidden-security.org",
            maxAge: 60 * 60 * 1000,
            path: "/"
        });

        /* res.cookie("idToken", idToken, {
            httpOnly: true,
            sameSite: "none",
            secure: true,
            path: "/" 
        }); */

        // ── Objeto de usuario propio — nunca mandar decoded directo ──────────
        const userPayload = {
            uid:                   decoded.uid,
            email:                 decoded.email,
            nombre:                decoded.nombre                || null,
            // Roles
            admin:                 decoded.admin                 === true,
            isEnterprise:          !!decoded.isEnterprise,
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
                        await auth.setCustomUserClaims(userRecord.uid, {
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

        res.clearCookie("idToken", {
            httpOnly: true,
            sameSite: "lax",
            secure: true,
            domain: ".hidden-security.org",
            path: "/" 
        });

        /* res.clearCookie("idToken", {
            httpOnly: true,
            sameSite: "none",
            secure: true,
            path: "/" 
        }); */

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
        await auth.setCustomUserClaims(user.uid, {
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
        await auth.setCustomUserClaims(uid, { banned: false })
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
    const idToken = req.cookies.idToken;
    if (!idToken) {
        return res.status(401).json({ authenticated: false });
    }
    try {
        const decoded = await auth.verifyIdToken(idToken);

        const userPayload = {
            uid:                   decoded.uid,
            email:                 decoded.email,
            nombre:                decoded.nombre                || null,
            admin:                 decoded.admin                 === true,
            isEnterprise:          !!decoded.isEnterprise,
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
        });
    } catch (error) {
        return res.status(401).json({ authenticated: false });
    }
});

// ─── GET /me ──────────────────────────────────────────────────────────────────
authRouter.get("/me", verifyToken, checkBanned, async (req, res) => {
    const idToken = req.cookies.idToken; 
    if (!idToken) return res.status(401).json({ message: "No token" });
    try {
        const decoded = await auth.verifyIdToken(idToken);
        if (decoded.banned) {
            return res.status(403).json({ message: "Banned" });
        }

        const userPayload = {
            uid:                   decoded.uid,
            email:                 decoded.email,
            nombre:                decoded.nombre                || null,
            admin:                 decoded.admin                 === true,
            isEnterprise:          !!decoded.isEnterprise,
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

module.exports = authRouter