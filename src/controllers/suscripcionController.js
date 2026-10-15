// src/controllers/suscripcionController.js
const suscripcionService = require("../services/suscripcionService");

const getEstadoSuscripcion = async (req, res) => {
  try {
    const estado = await suscripcionService.verificarEstadoSuscripcion();

    res.json({
      pagado: estado,
    });
  } catch (error) {
    console.error("Error en getEstadoSuscripcion:", error);

    // Error de conexión a la base de datos
    if (
      error.code === "ETIMEDOUT" ||
      error.code === "ECONNREFUSED" ||
      error.code === "ENOTFOUND" ||
      error.code === "ECONNRESET" ||
      error.message?.includes("timeout") ||
      error.message?.includes("TIMEDOUT")
    ) {
      return res.status(503).json({
        error: "Error de conexión a la base de datos",
        code: error.code,
        message: "El servicio de base de datos no está disponible",
      });
    }

    // Para otros errores, devolver 500 con el mensaje real
    res.status(500).json({
      error: "Error al verificar estado de suscripción",
      message: error.message,
      code: error.code,
      detail: error.detail,
      hint: error.hint,
    });
  }
};

module.exports = {
  getEstadoSuscripcion,
};