const express = require("express");
const corporativeMailingRouter = express.Router();
const { BrevoClient } = require("@getbrevo/brevo");

const esProduccion = process.env.NODE_ENV === "production";

// -- BREVO CLIENT --------------------------------------------------
const brevo = new BrevoClient({ apiKey: process.env.BREVO_API_KEY });

async function sendMail({ to, subject, html, attachments = [] }) {
    const payload = {
        sender:      { email: process.env.EMAIL_FROM, name: "Hidden Security" },
        to:          [{ email: to }],
        subject,
        htmlContent: html,
    };

    if (attachments.length > 0) {
        payload.attachment = attachments.map(a => ({
            name:    a.filename,
            content: a.content.toString("base64"),
        }));
    }

    console.log("[sendMail] payload a enviar (sin htmlContent):", {
        sender: payload.sender,
        to: payload.to,
        subject: payload.subject,
        attachmentsCount: payload.attachment?.length ?? 0,
    });

    try {
        const brevoResponse = await brevo.transactionalEmails.sendTransacEmail(payload);
        console.log("[sendMail] respuesta cruda de Brevo:", JSON.stringify(brevoResponse, null, 2));
        return brevoResponse;
    } catch (brevoError) {
        // Los errores de la API de Brevo suelen traer el detalle real en
        // brevoError.response.body o brevoError.body, no en brevoError.message
        console.error("[sendMail] ERROR crudo de Brevo:", brevoError);
        console.error("[sendMail] brevoError.message:", brevoError?.message);
        console.error("[sendMail] brevoError.response?.body:", brevoError?.response?.body);
        console.error("[sendMail] brevoError.body:", brevoError?.body);
        console.error("[sendMail] brevoError.response?.status:", brevoError?.response?.status);
        throw brevoError;
    }
}

// -- BLOQUES HTML COMPARTIDOS ----------------------------------------
// Copia exacta de los bloques de mailRouter.js, para mantener el mismo
// diseño visual (header amarillo/negro, firma, divisor) en todos los
// mailings del sistema.
const emailHead = (title) => `
<!DOCTYPE html>
<html lang="es" xmlns="http://www.w3.org/1999/xhtml">
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta http-equiv="X-UA-Compatible" content="IE=edge" />
    <title>${title}</title>
    <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;700;900&display=swap" rel="stylesheet">
    <style>* { box-sizing:border-box; margin:0; padding:0; } body { background-color:#111111; font-family:'Montserrat',Arial,sans-serif; }</style>
</head>
<body style="margin:0; padding:0; background-color:#111111;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#111111; padding:40px 16px;">
    <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0"
        style="max-width:600px; width:100%; background-color:#000000; border:1px solid #ccff00;">`;

const emailCabecera = (subtitulo) => `
    <tr>
        <td style="background-color:#ccff00; padding:28px 40px 24px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
            <td style="vertical-align:bottom;">
                <p style="font-family:'Montserrat',Arial,sans-serif; font-size:9px; font-weight:700; letter-spacing:4px; text-transform:uppercase; color:rgba(0,0,0,0.45); margin:0 0 6px;">// HIDDEN_SECURITY</p>
                <p style="font-family:'Montserrat',Arial,sans-serif; font-size:28px; font-weight:900; letter-spacing:-1.5px; text-transform:uppercase; color:#000000; line-height:1; margin:0;">HIDDEN<span style="font-weight:400;">SECURITY</span></p>
            </td>
            <td style="text-align:right; vertical-align:bottom;">
                <p style="font-family:'Montserrat',Arial,sans-serif; font-size:9px; font-weight:700; letter-spacing:2px; text-transform:uppercase; color:rgba(0,0,0,0.5); margin:0;">${subtitulo}</p>
            </td>
        </tr></table>
        </td>
    </tr>`;

const emailFirma = `
    <tr>
        <td style="background-color:#0a0a0a; border-top:1px solid rgba(204,255,0,0.15); padding:24px 40px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
            <td style="vertical-align:middle;">
                <p style="font-family:'Montserrat',Arial,sans-serif; font-size:13px; font-weight:700; letter-spacing:3px; text-transform:uppercase; color:#ccff00; margin:0 0 4px;">HIDDEN_SECURITY</p>
                <p style="font-family:'Montserrat',Arial,sans-serif; font-size:9px; letter-spacing:2px; text-transform:uppercase; color:rgba(255,255,255,0.2); margin:0;">// CYBERSECURITY_TRAINING</p>
            </td>
            <td style="text-align:right; vertical-align:middle;">
                <p style="font-family:'Montserrat',Arial,sans-serif; font-size:10px; color:rgba(255,255,255,0.2); margin:0; line-height:1.7;">Mensaje automático.<br/>No respondas a esta dirección.</p>
            </td>
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
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px; width:100%; margin-top:20px;">
        <tr><td><p style="font-family:'Montserrat',Arial,sans-serif; font-size:10px; color:rgba(255,255,255,0.2); text-align:center; line-height:1.7; margin:0;">
            Recibiste este correo porque se completó una solicitud de acceso corporativo/trainee en Hidden Security.
        </p></td></tr>
    </table>
    </td></tr>
</table>
</body></html>`;

const divisor = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:32px;">
        <tr><td style="border-top:1px solid rgba(204,255,0,0.15);"></td></tr>
    </table>`;

// -- Copy del tipo de solicitud -- mismo mapeo que REQUEST_TYPE_COPY en Pricing.tsx
const REQUEST_TYPE_LABELS = {
    empresa: "EMPRESA",
    trainee: "TRAINEE / SPONSOR",
};

// -- POST /request ------------------------------------------------
// Recibe el formulario de solicitud de acceso (Empresa / Trainee-Sponsor)
// desde Pricing.tsx y te lo reenvía a vos (EMAIL_FROM) con el mismo diseño
// visual que el resto de los mailings del sistema.
corporativeMailingRouter.post("/corporate-mailing/request", async (req, res) => {
    console.log("[POST /request] body recibido:", req.body);

    const { requestType, email, fullName, company, country } = req.body;

    if (!requestType || !email || !fullName || !company || !country) {
        console.log("[POST /request] faltan campos:", { requestType, email, fullName, company, country });
        return res.status(400).json({ message: "All required fields must be filled! 🔴" });
    }

    if (!["empresa", "trainee"].includes(requestType)) {
        console.log("[POST /request] requestType inválido:", requestType);
        return res.status(400).json({ message: "Invalid requestType! 🔴" });
    }

    const requestTypeLabel = REQUEST_TYPE_LABELS[requestType];
    const destinatario = process.env.EMAIL_FROM;
    console.log("[POST /request] voy a enviar a:", destinatario, "| tipo:", requestTypeLabel);

    try {
        await sendMail({
            to:      destinatario,
            subject: `Nueva solicitud de acceso (${requestTypeLabel}) — ${fullName}`,
            html: `
            ${emailHead("Nueva solicitud de acceso — Hidden Security")}
            ${emailCabecera("SOLICITUD<br/>DE ACCESO")}

            <tr><td style="background-color:#000000; padding:44px 40px 40px;">

                <table role="presentation" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
                    <tr><td>
                    <span style="font-family:'Montserrat',Arial,sans-serif; font-size:9px; font-weight:700; letter-spacing:3px; text-transform:uppercase; color:#ccff00; border:1px solid rgba(204,255,0,0.35); padding:5px 14px; background:rgba(204,255,0,0.06); display:inline-block;">⚡ ${requestTypeLabel}</span>
                    </td></tr>
                </table>

                <p style="font-family:'Montserrat',Arial,sans-serif; font-size:32px; font-weight:900; letter-spacing:-2px; text-transform:uppercase; color:#ffffff; line-height:1.05; margin:0 0 18px;">
                    NUEVA SOLICITUD<br/><span style="color:#ccff00; font-weight:400;">DE ACCESO.</span>
                </p>

                ${divisor}

                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:32px;">
                    <tr><td style="background:rgba(204,255,0,0.04); border-left:3px solid #ccff00; padding:20px 22px;">
                        <p style="font-family:'Montserrat',Arial,sans-serif; font-size:8px; font-weight:700; letter-spacing:3px; text-transform:uppercase; color:rgba(204,255,0,0.5); margin:0 0 14px;">// DATOS_DEL_SOLICITANTE</p>
                        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                            <tr>
                                <td style="padding:6px 0; border-bottom:1px solid rgba(204,255,0,0.08); width:35%;">
                                    <p style="font-family:'Montserrat',Arial,sans-serif; font-size:9px; font-weight:700; letter-spacing:2px; text-transform:uppercase; color:rgba(255,255,255,0.3); margin:0;">TIPO</p>
                                </td>
                                <td style="padding:6px 0; border-bottom:1px solid rgba(204,255,0,0.08);">
                                    <p style="font-family:'Montserrat',Arial,sans-serif; font-size:13px; font-weight:700; color:#ccff00; margin:0;">${requestTypeLabel}</p>
                                </td>
                            </tr>
                            <tr>
                                <td style="padding:6px 0; border-bottom:1px solid rgba(204,255,0,0.08);">
                                    <p style="font-family:'Montserrat',Arial,sans-serif; font-size:9px; font-weight:700; letter-spacing:2px; text-transform:uppercase; color:rgba(255,255,255,0.3); margin:0;">NOMBRE</p>
                                </td>
                                <td style="padding:6px 0; border-bottom:1px solid rgba(204,255,0,0.08);">
                                    <p style="font-family:'Montserrat',Arial,sans-serif; font-size:13px; font-weight:700; color:#ffffff; margin:0;">${fullName}</p>
                                </td>
                            </tr>
                            <tr>
                                <td style="padding:6px 0; border-bottom:1px solid rgba(204,255,0,0.08);">
                                    <p style="font-family:'Montserrat',Arial,sans-serif; font-size:9px; font-weight:700; letter-spacing:2px; text-transform:uppercase; color:rgba(255,255,255,0.3); margin:0;">EMAIL_CORPORATIVO</p>
                                </td>
                                <td style="padding:6px 0; border-bottom:1px solid rgba(204,255,0,0.08);">
                                    <p style="font-family:'Montserrat',Arial,sans-serif; font-size:13px; font-weight:700; color:#ccff00; margin:0;">${email}</p>
                                </td>
                            </tr>
                            <tr>
                                <td style="padding:6px 0; border-bottom:1px solid rgba(204,255,0,0.08);">
                                    <p style="font-family:'Montserrat',Arial,sans-serif; font-size:9px; font-weight:700; letter-spacing:2px; text-transform:uppercase; color:rgba(255,255,255,0.3); margin:0;">EMPRESA</p>
                                </td>
                                <td style="padding:6px 0; border-bottom:1px solid rgba(204,255,0,0.08);">
                                    <p style="font-family:'Montserrat',Arial,sans-serif; font-size:13px; font-weight:700; color:#ffffff; margin:0;">${company}</p>
                                </td>
                            </tr>
                            <tr>
                                <td style="padding:6px 0;">
                                    <p style="font-family:'Montserrat',Arial,sans-serif; font-size:9px; font-weight:700; letter-spacing:2px; text-transform:uppercase; color:rgba(255,255,255,0.3); margin:0;">PAÍS</p>
                                </td>
                                <td style="padding:6px 0;">
                                    <p style="font-family:'Montserrat',Arial,sans-serif; font-size:13px; font-weight:700; color:#ffffff; margin:0;">${country}</p>
                                </td>
                            </tr>
                        </table>
                    </td></tr>
                </table>

            </td></tr>

            ${emailFirma}`
        });

        console.log("[POST /request] sendMail terminó sin lanzar excepción — revisar log de [sendMail] respuesta cruda arriba para confirmar el estado real en Brevo.");
    } catch (mailError) {
        console.error(esProduccion ? "Error sending corporative request mail 🔴" : `Error sending corporative request mail 🔴 ${mailError}`);
        console.error("[POST /request] mailError completo:", mailError);
        return res.status(500).json({ message: "Error al enviar la solicitud 🔴", error: mailError.message });
    }

    return res.status(201).json({ message: "Request submitted successfully! 🟢" });
});

module.exports = corporativeMailingRouter;