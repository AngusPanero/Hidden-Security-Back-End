const express      = require("express");
const multer       = require("multer");
const Contact      = require("../models/ContactSchema");
const PaymentsMongo = require("../models/Payments");
const adminMiddleware = require("../middleware/adminMiddleware");
const { BrevoClient } = require("@getbrevo/brevo");

const mailRouter = express.Router();
const esProduccion = process.env.NODE_ENV === "production";

// ── BREVO CLIENT ──────────────────────────────────────────────
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

    await brevo.transactionalEmails.sendTransacEmail(payload);
}

// ── BLOQUES HTML COMPARTIDOS ──────────────────────────────────
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
            Recibiste este correo porque realizaste una compra en Hidden Security.<br/>
            Si creés que lo recibiste por error, por favor ignoralo.
        </p></td></tr>
    </table>
    </td></tr>
</table>
</body></html>`;

const tresColumnas = (cols) => `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr>
        ${cols.map(col => `
        <td width="33%" style="vertical-align:top; padding-right:20px;">
            <p style="font-family:'Montserrat',Arial,sans-serif; font-size:8px; font-weight:700; letter-spacing:3px; text-transform:uppercase; color:#ccff00; margin:0 0 10px; border-left:2px solid #ccff00; padding-left:8px;">${col.label}</p>
            <p style="font-family:'Montserrat',Arial,sans-serif; font-size:11px; color:rgba(255,255,255,0.4); line-height:1.65; margin:0;">${col.text}</p>
        </td>`).join('')}
        </tr>
    </table>`;

const divisor = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:32px;">
        <tr><td style="border-top:1px solid rgba(204,255,0,0.15);"></td></tr>
    </table>`;


// ── Contact ───────────────────────────────────────────────────
mailRouter.post("/contact", async (req, res) => {
    const { name, surname, email, tel, text } = req.body;

    if (!name || !surname || !email || !tel || !text) {
        return res.status(400).json({ message: "All required fields must be filled! 🔴" });
    }

    try {
        await Contact.create({ name, surname, email, tel, text });
    } catch (dbError) {
        console.error(esProduccion ? "Error saving contact 🔴" : `Error saving contact 🔴 ${dbError}`);
        return res.status(500).json({ message: "Error creating new contact! 🔴" });
    }

    try {
        await sendMail({
            to:      process.env.EMAIL_FROM,
            subject: `Nueva consulta — ${name} ${surname}`,
            html: `
            ${emailHead("Nueva consulta — Hidden Security")}
            ${emailCabecera("NUEVA<br/>CONSULTA")}

            <tr><td style="background-color:#000000; padding:44px 40px 40px;">

                <table role="presentation" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
                    <tr><td>
                    <span style="font-family:'Montserrat',Arial,sans-serif; font-size:9px; font-weight:700; letter-spacing:3px; text-transform:uppercase; color:#ccff00; border:1px solid rgba(204,255,0,0.35); padding:5px 14px; background:rgba(204,255,0,0.06); display:inline-block;">⚡ MENSAJE_RECIBIDO</span>
                    </td></tr>
                </table>

                <p style="font-family:'Montserrat',Arial,sans-serif; font-size:32px; font-weight:900; letter-spacing:-2px; text-transform:uppercase; color:#ffffff; line-height:1.05; margin:0 0 18px;">
                    NUEVO<br/><span style="color:#ccff00; font-weight:400;">CONTACTO.</span>
                </p>

                ${divisor}

                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
                    <tr><td style="background:rgba(204,255,0,0.04); border-left:3px solid #ccff00; padding:20px 22px;">
                        <p style="font-family:'Montserrat',Arial,sans-serif; font-size:8px; font-weight:700; letter-spacing:3px; text-transform:uppercase; color:rgba(204,255,0,0.5); margin:0 0 14px;">// DATOS_DEL_REMITENTE</p>
                        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                            <tr>
                                <td style="padding:6px 0; border-bottom:1px solid rgba(204,255,0,0.08); width:35%;">
                                    <p style="font-family:'Montserrat',Arial,sans-serif; font-size:9px; font-weight:700; letter-spacing:2px; text-transform:uppercase; color:rgba(255,255,255,0.3); margin:0;">NOMBRE</p>
                                </td>
                                <td style="padding:6px 0; border-bottom:1px solid rgba(204,255,0,0.08);">
                                    <p style="font-family:'Montserrat',Arial,sans-serif; font-size:13px; font-weight:700; color:#ffffff; margin:0;">${name} ${surname}</p>
                                </td>
                            </tr>
                            <tr>
                                <td style="padding:6px 0; border-bottom:1px solid rgba(204,255,0,0.08);">
                                    <p style="font-family:'Montserrat',Arial,sans-serif; font-size:9px; font-weight:700; letter-spacing:2px; text-transform:uppercase; color:rgba(255,255,255,0.3); margin:0;">EMAIL</p>
                                </td>
                                <td style="padding:6px 0; border-bottom:1px solid rgba(204,255,0,0.08);">
                                    <p style="font-family:'Montserrat',Arial,sans-serif; font-size:13px; font-weight:700; color:#ccff00; margin:0;">${email}</p>
                                </td>
                            </tr>
                            <tr>
                                <td style="padding:6px 0;">
                                    <p style="font-family:'Montserrat',Arial,sans-serif; font-size:9px; font-weight:700; letter-spacing:2px; text-transform:uppercase; color:rgba(255,255,255,0.3); margin:0;">TELÉFONO</p>
                                </td>
                                <td style="padding:6px 0;">
                                    <p style="font-family:'Montserrat',Arial,sans-serif; font-size:13px; font-weight:700; color:#ffffff; margin:0;">${tel}</p>
                                </td>
                            </tr>
                        </table>
                    </td></tr>
                </table>

                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:32px;">
                    <tr><td style="background:rgba(255,255,255,0.02); border:1px solid rgba(204,255,0,0.1); padding:20px 22px;">
                        <p style="font-family:'Montserrat',Arial,sans-serif; font-size:8px; font-weight:700; letter-spacing:3px; text-transform:uppercase; color:rgba(204,255,0,0.5); margin:0 0 12px;">// MENSAJE</p>
                        <p style="font-family:'Montserrat',Arial,sans-serif; font-size:13px; color:rgba(255,255,255,0.7); line-height:1.85; margin:0; white-space:pre-line;">${text}</p>
                    </td></tr>
                </table>

            </td></tr>

            ${emailFirma}`
        });
    } catch (mailError) {
        console.error(esProduccion ? "Error sending contact mail 🔴" : `Error sending contact mail 🔴 ${mailError}`);
    }

    return res.status(201).json({ message: "Contact form submitted successfully! 🟢" });
});

// ── Confirmación al comprador ─────────────────────────────────
mailRouter.post("/confirm-order", async (req, res) => {
    const { email } = req.body;

    if (!email) {
        return res.status(400).json({ message: "Email is required! 🔴" });
    }

    const html = `
    ${emailHead("Confirmación de compra — Hidden Security")}
    ${emailCabecera("CONFIRMACIÓN<br/>DE COMPRA")}

    <tr><td style="background-color:#000000; padding:44px 40px 40px;">

        <table role="presentation" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
            <tr><td>
            <span style="font-family:'Montserrat',Arial,sans-serif; font-size:9px; font-weight:700; letter-spacing:3px; text-transform:uppercase; color:#22c55e; border:1px solid rgba(34,197,94,0.35); padding:5px 14px; background:rgba(34,197,94,0.06); display:inline-block;">✓ PAGO_APROBADO</span>
            </td></tr>
        </table>

        <p style="font-family:'Montserrat',Arial,sans-serif; font-size:32px; font-weight:900; letter-spacing:-2px; text-transform:uppercase; color:#ffffff; line-height:1.05; margin:0 0 18px;">
            ACCESO<br/><span style="color:#ccff00; font-weight:400;">DESBLOQUEADO.</span>
        </p>

        <p style="font-family:'Montserrat',Arial,sans-serif; font-size:13px; color:rgba(255,255,255,0.55); line-height:1.85; margin:0 0 36px; letter-spacing:0.3px;">
            Tu compra fue procesada con éxito. En breve recibirás la factura correspondiente por este mismo correo. Bienvenido a la infraestructura de Hidden Security.
        </p>

        ${divisor}

        ${tresColumnas([
            { label: "01 // ACCESO",   text: "Tu plan fue activado en el sistema." },
            { label: "02 // FACTURA",  text: "Recibirás tu comprobante por correo en breve." },
            { label: "03 // SOPORTE",  text: "Respondé este correo ante cualquier consulta." }
        ])}

    </td></tr>

    ${emailFirma}`;

    try {
        await sendMail({ to: email, subject: "Confirmación de compra — Hidden Security", html });
        res.status(200).json({ success: true, message: "Correo enviado con éxito" });
    } catch (error) {
        console.error(esProduccion ? "Error sending mail 🔴" : `Error sending mail 🔴 ${error}`);
        res.status(500).json({ message: "Error al enviar el correo 🔴", error: error.message });
    }
});

// ── Factura adjunta al comprador ──────────────────────────────
const upload = multer({ storage: multer.memoryStorage() });

mailRouter.post("/:id/send-invoice", upload.single("invoice"), adminMiddleware, async (req, res) => {
    const { id }    = req.params;
    const { email } = req.body;
    const file      = req.file;

    if (!email || !file) {
        return res.status(400).json({ message: "Email y archivo son requeridos 🔴" });
    }

    const html = `
    ${emailHead("Factura — Hidden Security")}
    ${emailCabecera("COMPROBANTE<br/>DE COMPRA")}

    <tr><td style="background-color:#000000; padding:44px 40px 40px;">

        <p style="font-family:'Montserrat',Arial,sans-serif; font-size:32px; font-weight:900; letter-spacing:-2px; text-transform:uppercase; color:#ffffff; line-height:1.05; margin:0 0 18px;">
            TU FACTURA<br/><span style="color:#ccff00; font-weight:400;">ESTÁ LISTA.</span>
        </p>

        <p style="font-family:'Montserrat',Arial,sans-serif; font-size:13px; color:rgba(255,255,255,0.55); line-height:1.85; margin:0 0 36px; letter-spacing:0.3px;">
            Encontrás adjunto el comprobante correspondiente a tu compra. Guardalo como respaldo ante cualquier consulta o gestión futura.
        </p>

        ${divisor}

        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:32px;">
            <tr><td style="background:rgba(204,255,0,0.04); border-left:3px solid #ccff00; padding:18px 22px;">
                <p style="font-family:'Montserrat',Arial,sans-serif; font-size:8px; font-weight:700; letter-spacing:3px; text-transform:uppercase; color:rgba(204,255,0,0.5); margin:0 0 8px;">// ARCHIVO_ADJUNTO</p>
                <p style="font-family:'Montserrat',Arial,sans-serif; font-size:14px; font-weight:700; color:#ffffff; margin:0;">Factura de compra · <span style="color:#ccff00;">Hidden Security</span></p>
                <p style="font-family:'Montserrat',Arial,sans-serif; font-size:11px; color:rgba(255,255,255,0.3); margin:6px 0 0;">PDF / PNG / JPEG según el formato enviado</p>
            </td></tr>
        </table>

        ${divisor}

        ${tresColumnas([
            { label: "01 // RESPALDO", text: "Guardá este comprobante en un lugar seguro." },
            { label: "02 // ACCESO",   text: "Tu plan ya está activo en el sistema." },
            { label: "03 // SOPORTE",  text: "Respondé este mail ante cualquier consulta." }
        ])}

    </td></tr>

    ${emailFirma}`;

    try {
        await sendMail({
            to:      email,
            subject: "Factura de tu compra — Hidden Security",
            html,
            attachments: [{
                filename: file.originalname,
                content:  file.buffer,
            }]
        });

        await PaymentsMongo.findByIdAndUpdate(id, {
            invoiceSent:     true,
            invoiceSentAt:   new Date(),
            invoiceFilename: file.originalname,
        });

        res.json({ ok: true });

    } catch (error) {
        console.error(esProduccion ? "Error sending invoice 🔴" : `Error sending invoice 🔴 ${error}`);
        res.status(500).json({ message: "Error al enviar la factura 🔴", error: error.message });
    }
});

module.exports = mailRouter;