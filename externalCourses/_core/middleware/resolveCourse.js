const { getCourse } = require("../registry/courseRegistry");

// Toma :partnerSlug y :courseSlug de la URL, busca el curso en el registro
// (en memoria, sin consulta a Mongo) y lo deja en req.course.
// Mayúsculas/minúsculas no importan.

module.exports = function resolveCourse(req, res, next) {
    const { partnerSlug, courseSlug } = req.params;
    const course = getCourse(partnerSlug, courseSlug);

    if (!course) {
        return res.status(404).json({ error: "Curso no encontrado" });
    }

    req.course = course;
    next();
};