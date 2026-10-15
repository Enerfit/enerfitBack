// src/services/suscripcionService.js
const { query } = require("../../db");

const verificarEstadoSuscripcion = async () => {
  try {
    // ⚠️ Según el schema.sql la tabla se llama "suscripcion" (minúscula)
    // y la columna "pagado" (minúscula). Sin comillas dobles.
    const result = await query(
      `SELECT pagado FROM public.suscripcion LIMIT 1`
    );

    // Si no hay registros, consideramos que no está pagado
    if (result.rows.length === 0) {
      return false;
    }

    const valorPagado = result.rows[0].pagado;

    // Si es undefined o null, retornar false
    if (valorPagado === undefined || valorPagado === null) {
      return false;
    }

    // Si ya es booleano (lo normal en PostgreSQL BOOLEAN)
    if (typeof valorPagado === "boolean") {
      return valorPagado;
    }

    // Fallbacks por si acaso
    if (typeof valorPagado === "number") {
      return valorPagado === 1;
    }

    if (typeof valorPagado === "string") {
      const v = valorPagado.toLowerCase().trim();
      return v === "true" || v === "1" || v === "t";
    }

    return false;
  } catch (error) {
    console.error("Error en verificarEstadoSuscripcion:", error);
    throw error;
  }
};

module.exports = {
  verificarEstadoSuscripcion,
};