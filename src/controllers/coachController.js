// src/controllers/coachController.js
const coachService = require("../services/coachService");

function buildErrorResponse(error) {
  console.error("❌ Error en coachController:", {
    message: error.message,
    code: error.code,
    detail: error.detail,
    constraint: error.constraint,
    table: error.table,
    column: error.column,
  });

  if (error.code === "23505") {
    if (
      error.constraint === "personas_ci_key" ||
      error.message?.includes("personas_ci_key")
    ) {
      return { status: 400, message: "ci_unique" };
    }
    return {
      status: 400,
      message: `Valor duplicado: ${error.detail || error.message || "revisa los datos"}`,
    };
  }

  if (error.code === "23503") {
    return {
      status: 400,
      message: `No se puede modificar porque tiene registros asociados (${error.table || "otra tabla"}).`,
    };
  }

  if (error.code === "23514") {
    return { status: 400, message: error.message || "Restricción violada" };
  }

  if (error.code === "23502") {
    return {
      status: 400,
      message: `Falta un campo obligatorio: ${error.column || "desconocido"}`,
    };
  }

  if (error.code === "22P02") {
    return {
      status: 400,
      message: `Formato de dato inválido en algún campo: ${error.message}`,
    };
  }

  const fallback =
    error.message && error.message.trim().length > 0
      ? error.message
      : "Error desconocido en el servidor. Revisa los logs.";

  return { status: 400, message: fallback };
}

// ============================================
// GET COACHES
// ============================================
exports.getCoaches = async (req, res) => {
  try {
    const { mes } = req.query;
    const coaches = await coachService.getCoaches(mes || null);
    res.json(coaches);
  } catch (error) {
    const { status, message } = buildErrorResponse(error);
    res.status(status).json({ message });
  }
};

// ============================================
// GET COACH BY ID
// ============================================
exports.getCoachById = async (req, res) => {
  try {
    const { id } = req.params;
    const { mes } = req.query;
    const coach = await coachService.getCoachById(id, mes || null);
    res.json(coach);
  } catch (error) {
    const { status, message } = buildErrorResponse(error);
    res.status(status).json({ message });
  }
};

// ============================================
// CREATE COACH
// ============================================
exports.createCoach = async (req, res) => {
  try {
    const { nombres, apellidos, ci, telefono, sucursal_id, metaInscritos } = req.body;

    if (!nombres || !apellidos || !ci || !telefono) {
      return res.status(400).json({ message: "Todos los campos personales son obligatorios" });
    }
    if (!sucursal_id) {
      return res.status(400).json({ message: "Sucursal es obligatoria" });
    }
    if (!metaInscritos || Number(metaInscritos) <= 0) {
      return res.status(400).json({ message: "Meta de inscritos debe ser mayor a 0" });
    }

    const coach = await coachService.createCoach(req.body);
    res.status(201).json(coach);
  } catch (error) {
    const { status, message } = buildErrorResponse(error);
    res.status(status).json({ message });
  }
};

// ============================================
// UPDATE COACH
// ============================================
exports.updateCoach = async (req, res) => {
  try {
    const { id } = req.params;
    const { nombres, apellidos, ci, telefono, sucursal_id } = req.body;

    if (!nombres || !apellidos || !ci || !telefono) {
      return res.status(400).json({ message: "Todos los campos personales son obligatorios" });
    }
    if (!sucursal_id) {
      return res.status(400).json({ message: "Sucursal es obligatoria" });
    }

    const coach = await coachService.updateCoach(id, req.body);
    res.json(coach);
  } catch (error) {
    const { status, message } = buildErrorResponse(error);
    res.status(status).json({ message });
  }
};

// ============================================
// DELETE COACH (soft delete)
// ============================================
exports.deleteCoach = async (req, res) => {
  try {
    const { id } = req.params;
    await coachService.deleteCoach(id);
    res.status(204).send();
  } catch (error) {
    const { status, message } = buildErrorResponse(error);
    res.status(status).json({ message });
  }
};

// ============================================
// TOGGLE STATUS
// ============================================
exports.toggleCoachStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const coach = await coachService.toggleCoachStatus(id);
    res.json(coach);
  } catch (error) {
    const { status, message } = buildErrorResponse(error);
    res.status(status).json({ message });
  }
};

// ============================================
// REGISTROS MES
// ============================================
exports.getRegistrosMes = async (req, res) => {
  try {
    const { id } = req.params;
    const registros = await coachService.getRegistrosMes(id);
    res.json(registros);
  } catch (error) {
    const { status, message } = buildErrorResponse(error);
    res.status(status).json({ message });
  }
};

exports.upsertRegistroMes = async (req, res) => {
  try {
    const { id } = req.params;
    const { mes, metaInscritos, adelantoMonto } = req.body;

    if (!mes || !/^\d{4}-\d{2}$/.test(mes)) {
      return res.status(400).json({ message: "Formato de mes inválido (YYYY-MM)" });
    }
    if (metaInscritos == null || Number(metaInscritos) < 0) {
      return res.status(400).json({ message: "Meta inválida" });
    }
    if (adelantoMonto == null || Number(adelantoMonto) < 0) {
      return res.status(400).json({ message: "Adelanto inválido" });
    }

    const registro = await coachService.upsertRegistroMes(id, req.body);
    res.json(registro);
  } catch (error) {
    const { status, message } = buildErrorResponse(error);
    res.status(status).json({ message });
  }
};

// ============================================
// INSCRITOS DEL COACH
// ============================================
exports.getInscritosCoach = async (req, res) => {
  try {
    const { id } = req.params;
    const { mes } = req.query;
    const inscritos = await coachService.getInscritosCoach(id, mes || null);
    res.json(inscritos);
  } catch (error) {
    const { status, message } = buildErrorResponse(error);
    res.status(status).json({ message });
  }
};