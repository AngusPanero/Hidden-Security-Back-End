const mongoose = require("mongoose");

// Ejecuta fn(session) dentro de una transacción de Mongo.
// Si algo falla, se revierte todo (evento + progreso).
async function runInTransaction(fn) {
    const session = await mongoose.startSession();
    try {
        let result;
        await session.withTransaction(async () => {
            result = await fn(session);
        });
        return result;
    } finally {
        await session.endSession();
    }
}

// true si el error es por índice único (evento duplicado, doc ya existente)
function isDuplicateKey(err) {
    if (!err) return false;
    return err.code === 11000 || err?.cause?.code === 11000 || /E11000/.test(err.message || "");
}

module.exports = { runInTransaction, isDuplicateKey };