// src/services/coachService.js
const { query, pool } = require("../../db");

// ============================================
// HELPERS SQL
// ============================================

// Subquery reutilizable: cuenta inscripciones del mismo coach para la persona
// de la inscripción "i". Devuelve 1 para nueva, ≥2 para reinscripción.
const SQL_NUMERO_INSCRIPCION_COACH = `
  (
    SELECT COUNT(*)
    FROM detalle_venta_servicios dvs2
    INNER JOIN inscripciones i2 ON i2.id = dvs2.inscripcion_id
    INNER JOIN detalle_venta_servicios dvs_actual ON dvs_actual.id = dvs.id
    INNER JOIN inscripciones i_actual ON i_actual.id = dvs_actual.inscripcion_id
    WHERE dvs2.coach_id = dvs.coach_id
      AND i2.persona_id = i_actual.persona_id
      AND dvs2.coach_id IS NOT NULL
  )
`;

// ============================================
// GET COACHES (lista con stats del mes)
// ============================================
exports.getCoaches = async (mes) => {
  const mesParam = mes || new Date().toISOString().slice(0, 7);

  const result = await query(
    `
    SELECT
      e.id,
      e.persona_id,
      p.nombres,
      p.apellidos,
      p.ci,
      p.telefono,
      e.rol,
      e.sucursal_id,
      s.nombre AS sucursal_nombre,
      e.estado,
      (e.estado = 1) AS activo,
      NULL::text AS fecha_registro,

      COALESCE(cmm.meta_inscritos, 0) AS meta_inscritos,
      COALESCE(cmm.adelanto_monto, 0) AS adelanto_monto,

      COALESCE(mes_stats.total, 0) AS total_inscritos_mes,
      COALESCE(mes_stats.nuevas, 0) AS nuevas_mes,
      COALESCE(mes_stats.reinscripciones, 0) AS reinscripciones_mes,

      COALESCE(hist_stats.total, 0) AS total_historico,
      COALESCE(hist_stats.nuevas, 0) AS nuevas_historico,
      COALESCE(hist_stats.reinscripciones, 0) AS reinscripciones_historico

    FROM empleados e
    INNER JOIN personas p ON p.id = e.persona_id
    LEFT JOIN sucursales s ON s.id = e.sucursal_id
    LEFT JOIN coach_meta_mes cmm
      ON cmm.coach_id = e.id AND cmm.mes = $1

    LEFT JOIN LATERAL (
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE ${SQL_NUMERO_INSCRIPCION_COACH} = 1) AS nuevas,
        COUNT(*) FILTER (WHERE ${SQL_NUMERO_INSCRIPCION_COACH} > 1) AS reinscripciones
      FROM detalle_venta_servicios dvs
      INNER JOIN ventas_servicios vs ON vs.id = dvs.venta_servicio_id
      WHERE dvs.coach_id = e.id
        AND TO_CHAR(vs.fecha AT TIME ZONE 'America/La_Paz', 'YYYY-MM') = $1
    ) AS mes_stats ON TRUE

    LEFT JOIN LATERAL (
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE ${SQL_NUMERO_INSCRIPCION_COACH} = 1) AS nuevas,
        COUNT(*) FILTER (WHERE ${SQL_NUMERO_INSCRIPCION_COACH} > 1) AS reinscripciones
      FROM detalle_venta_servicios dvs
      WHERE dvs.coach_id = e.id
    ) AS hist_stats ON TRUE

    WHERE e.rol = 'couch'
      AND e.estado IN (0, 1)
    ORDER BY p.nombres, p.apellidos
    `,
    [mesParam]
  );

  return result.rows;
};

// ============================================
// GET COACH BY ID
// ============================================
exports.getCoachById = async (id, mes) => {
  const mesParam = mes || new Date().toISOString().slice(0, 7);

  const result = await query(
    `
    SELECT
      e.id, e.persona_id, p.nombres, p.apellidos, p.ci, p.telefono,
      e.rol, e.sucursal_id, s.nombre AS sucursal_nombre, e.estado,
      (e.estado = 1) AS activo,
      NULL::text AS fecha_registro,
      COALESCE(cmm.meta_inscritos, 0) AS meta_inscritos,
      COALESCE(cmm.adelanto_monto, 0) AS adelanto_monto,
      COALESCE(mes_stats.total, 0) AS total_inscritos_mes,
      COALESCE(mes_stats.nuevas, 0) AS nuevas_mes,
      COALESCE(mes_stats.reinscripciones, 0) AS reinscripciones_mes,
      COALESCE(hist_stats.total, 0) AS total_historico,
      COALESCE(hist_stats.nuevas, 0) AS nuevas_historico,
      COALESCE(hist_stats.reinscripciones, 0) AS reinscripciones_historico
    FROM empleados e
    INNER JOIN personas p ON p.id = e.persona_id
    LEFT JOIN sucursales s ON s.id = e.sucursal_id
    LEFT JOIN coach_meta_mes cmm ON cmm.coach_id = e.id AND cmm.mes = $1

    LEFT JOIN LATERAL (
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE ${SQL_NUMERO_INSCRIPCION_COACH} = 1) AS nuevas,
        COUNT(*) FILTER (WHERE ${SQL_NUMERO_INSCRIPCION_COACH} > 1) AS reinscripciones
      FROM detalle_venta_servicios dvs
      INNER JOIN ventas_servicios vs ON vs.id = dvs.venta_servicio_id
      WHERE dvs.coach_id = e.id
        AND TO_CHAR(vs.fecha AT TIME ZONE 'America/La_Paz', 'YYYY-MM') = $1
    ) AS mes_stats ON TRUE

    LEFT JOIN LATERAL (
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE ${SQL_NUMERO_INSCRIPCION_COACH} = 1) AS nuevas,
        COUNT(*) FILTER (WHERE ${SQL_NUMERO_INSCRIPCION_COACH} > 1) AS reinscripciones
      FROM detalle_venta_servicios dvs
      WHERE dvs.coach_id = e.id
    ) AS hist_stats ON TRUE

    WHERE e.id = $2 AND e.rol = 'couch'
    `,
    [mesParam, id]
  );

  if (result.rows.length === 0) {
    throw new Error("Coach no encontrado");
  }
  return result.rows[0];
};

// ============================================
// CREATE COACH
// ============================================
exports.createCoach = async (data) => {
  const { nombres, apellidos, ci, telefono, sucursal_id, metaInscritos } = data;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1) Persona
    const personaResult = await client.query(
      `INSERT INTO personas (nombres, apellidos, ci, telefono, estado)
       VALUES ($1, $2, $3, $4, 1) RETURNING id`,
      [nombres, apellidos, ci, telefono]
    );
    const personaId = personaResult.rows[0].id;

    // 2) Empleado con rol couch
    const empleadoResult = await client.query(
      `INSERT INTO empleados (persona_id, rol, sucursal_id, estado)
       VALUES ($1, 'couch', $2, 1) RETURNING id`,
      [personaId, sucursal_id]
    );
    const empleadoId = empleadoResult.rows[0].id;

    // 3) Meta del mes actual
    const mesActual = new Date().toISOString().slice(0, 7);
    await client.query(
      `INSERT INTO coach_meta_mes (coach_id, mes, meta_inscritos, adelanto_monto)
       VALUES ($1, $2, $3, 0)`,
      [empleadoId, mesActual, metaInscritos]
    );

    await client.query("COMMIT");

    return await exports.getCoachById(empleadoId, mesActual);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

// ============================================
// UPDATE COACH
// ============================================
exports.updateCoach = async (id, data) => {
  const { nombres, apellidos, ci, telefono, sucursal_id } = data;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const emplResult = await client.query(
      "SELECT persona_id, rol FROM empleados WHERE id = $1 AND rol = 'couch'",
      [id]
    );
    if (emplResult.rows.length === 0) {
      throw new Error("Coach no encontrado");
    }
    const personaId = emplResult.rows[0].persona_id;

    await client.query(
      `UPDATE personas SET nombres = $1, apellidos = $2, ci = $3, telefono = $4
       WHERE id = $5`,
      [nombres, apellidos, ci, telefono, personaId]
    );

    await client.query(
      `UPDATE empleados SET sucursal_id = $1 WHERE id = $2`,
      [sucursal_id, id]
    );

    await client.query("COMMIT");

    return await exports.getCoachById(id);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

// ============================================
// DELETE COACH (soft)
// ============================================
exports.deleteCoach = async (id) => {
  const result = await query(
    `UPDATE empleados SET estado = 2 WHERE id = $1 AND rol = 'couch' RETURNING id`,
    [id]
  );
  if (result.rows.length === 0) {
    throw new Error("Coach no encontrado");
  }
};

// ============================================
// TOGGLE STATUS
// ============================================
exports.toggleCoachStatus = async (id) => {
  const result = await query(
    `UPDATE empleados
     SET estado = CASE WHEN estado = 1 THEN 0 ELSE 1 END
     WHERE id = $1 AND rol = 'couch'
     RETURNING id`,
    [id]
  );
  if (result.rows.length === 0) {
    throw new Error("Coach no encontrado");
  }
  return await exports.getCoachById(id);
};

// ============================================
// REGISTROS MES
// ============================================
exports.getRegistrosMes = async (coachId) => {
  const result = await query(
    `SELECT id, coach_id, mes, meta_inscritos, adelanto_monto, fecha_actualizacion
     FROM coach_meta_mes
     WHERE coach_id = $1
     ORDER BY mes DESC`,
    [coachId]
  );
  return result.rows;
};

exports.upsertRegistroMes = async (coachId, { mes, metaInscritos, adelantoMonto }) => {
  const result = await query(
    `INSERT INTO coach_meta_mes (coach_id, mes, meta_inscritos, adelanto_monto, fecha_actualizacion)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (coach_id, mes)
     DO UPDATE SET
       meta_inscritos = EXCLUDED.meta_inscritos,
       adelanto_monto = EXCLUDED.adelanto_monto,
       fecha_actualizacion = NOW()
     RETURNING id, coach_id, mes, meta_inscritos, adelanto_monto, fecha_actualizacion`,
    [coachId, mes, metaInscritos, adelantoMonto]
  );
  return result.rows[0];
};

// ============================================
// INSCRITOS DEL COACH
// ============================================
exports.getInscritosCoach = async (coachId, mes) => {
  const params = [coachId];
  let filtroMes = "";
  if (mes) {
    params.push(mes);
    filtroMes = `AND TO_CHAR(vs.fecha AT TIME ZONE 'America/La_Paz', 'YYYY-MM') = $2`;
  }

  const result = await query(
    `
    SELECT
      dvs.id AS detalle_id,
      vs.id AS venta_servicio_id,
      i.id AS inscripcion_id,
      i.persona_id,
      (p.nombres || ' ' || p.apellidos) AS persona_nombre,
      p.ci AS persona_ci,
      s.nombre AS servicio_nombre,
      suc.nombre AS sucursal_nombre,
      vs.fecha AS fecha_venta,
      i.fecha_inicio,
      i.fecha_vencimiento,
      vs.total AS total_venta,
      CASE
        WHEN ${SQL_NUMERO_INSCRIPCION_COACH} = 1 THEN 'nueva'
        ELSE 'reinscripcion'
      END AS tipo,
      ${SQL_NUMERO_INSCRIPCION_COACH} AS numero_inscripcion_coach
    FROM detalle_venta_servicios dvs
    INNER JOIN ventas_servicios vs ON vs.id = dvs.venta_servicio_id
    INNER JOIN inscripciones i ON i.id = dvs.inscripcion_id
    INNER JOIN personas p ON p.id = i.persona_id
    INNER JOIN servicios s ON s.id = i.servicio_id
    INNER JOIN sucursales suc ON suc.id = vs.sucursal_id
    WHERE dvs.coach_id = $1
      ${filtroMes}
    ORDER BY vs.fecha DESC, dvs.id DESC
    `,
    params
  );

  return result.rows;
};