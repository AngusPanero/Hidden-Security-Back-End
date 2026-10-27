// Error con status HTTP y mensaje seguro para mostrar al front.
// El error handler del router lo devuelve como { error: publicMessage }.

function httpError(status, publicMessage, extra = null) {
    const err = new Error(publicMessage);
    err.status = status;
    err.publicMessage = publicMessage;
    if (extra) err.extra = extra;
    return err;
}

module.exports = { httpError };