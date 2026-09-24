require("dotenv").config();
const crypto   = require("crypto");
const readline = require("readline");

if (!process.env.ADMIN_SIGN_PEPPER) {
    process.env.ADMIN_SIGN_PEPPER = crypto.randomBytes(32).toString("hex");
    console.log("\n⚠️  No había ADMIN_SIGN_PEPPER — se generó uno nuevo.\n");
}

const { hashPin } = require("../utils/signPin");

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

// Oculta lo que se tipea
rl._writeToOutput = function (str) {
    if (rl.stdoutMuted) rl.output.write("*");
    else rl.output.write(str);
};

rl.question("Clave de firma (4 dígitos): ", async (pin) => {
    rl.close();
    console.log("");
    try {
        const hash = await hashPin(pin.trim());
        console.log("\n✅ Copiá estas dos variables en .env y en Render:\n");
        console.log(`ADMIN_SIGN_PEPPER=${process.env.ADMIN_SIGN_PEPPER}`);
        console.log(`ADMIN_SIGN_PIN_HASH=${hash}\n`);
        console.log("🔒 Si cambiás el pepper, tenés que regenerar el hash.\n");
    } catch (err) {
        console.error("❌", err.message);
        process.exit(1);
    }
})
rl.stdoutMuted = true;