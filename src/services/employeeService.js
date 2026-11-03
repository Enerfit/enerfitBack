// backend/src/services/employeeService.js
const { query, pool } = require("../../db");
const bcrypt = require("bcrypt");

// ============================================
// SUCURSALES
// ============================================
exports.getBranches = async () => {
  const result = await query(
    "SELECT id, nombre, estado FROM sucursales WHERE estado = 1 ORDER BY nombre"
  );
  return result.rows;
};

// ============================================
// CAJAS
// ============================================
exports.getBoxes = async () => {
  const result = await query(
    "SELECT id, nombre, sucursal_id, estado_caja FROM cajas ORDER BY nombre"
  );

  return result.rows.map((row) => ({
    id: row.id,
    nombre: row.nombre,
    sucursal_id: row.sucursal_id,
    estado: 1,
    estado_caja: row.estado_caja,
  }));
};

// ============================================
// GET EMPLOYEES
// ============================================
exports.getEmployees = async () => {
  const result = await query(`
    SELECT 
      e.id,
      e.persona_id,
      p.nombres,
      p.apellidos,
      p.ci,
      p.telefono,
      e.rol,
      e.sucursal_id,
      s.nombre as sucursal_nombre,
      ec.caja_id,
      c.nombre as caja_nombre,
      e.estado,
      (p.huella_digital IS NOT NULL) as tiene_huella,
      u.username
    FROM empleados e
    INNER JOIN personas p ON e.persona_id = p.id
    LEFT JOIN sucursales s ON e.sucursal_id = s.id
    LEFT JOIN empleado_caja ec ON e.id = ec.empleado_id AND ec.estado = 1
    LEFT JOIN cajas c ON ec.caja_id = c.id
    LEFT JOIN usuarios u ON e.id = u.empleado_id
    WHERE e.estado IN (0, 1)
    ORDER BY p.nombres, p.apellidos
  `);

  const employeesWithHorarios = await Promise.all(
    result.rows.map(async (employee) => {
      const horariosResult = await query(
        `SELECT 
          he.dia_semana, 
          he.hora_ingreso, 
          he.hora_salida,
          he.sucursal_id,
          s.nombre as sucursal_nombre
         FROM horarios_empleado he
         LEFT JOIN sucursales s ON he.sucursal_id = s.id
         WHERE he.empleado_id = $1 
         ORDER BY he.dia_semana, he.hora_ingreso`,
        [employee.id]
      );

      return {
        ...employee,
        horarios: horariosResult.rows,
      };
    })
  );

  return employeesWithHorarios;
};

// ============================================
// CREATE EMPLOYEE
// ============================================
exports.createEmployee = async (employeeData) => {
  const {
    nombres,
    apellidos,
    ci,
    telefono,
    cargo,
    sucursal_id,
    caja_id,
    horarios,
    username,
    password,
  } = employeeData;

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const personaResult = await client.query(
      `INSERT INTO personas (nombres, apellidos, ci, telefono, estado) 
       VALUES ($1, $2, $3, $4, 1) RETURNING id`,
      [nombres, apellidos, ci, telefono]
    );
    const personaId = personaResult.rows[0].id;

    // ✅ CAMBIO: TODOS los roles guardan sucursal (incluido admin)
    const empleadoResult = await client.query(
      `INSERT INTO empleados (persona_id, rol, sucursal_id, estado) 
       VALUES ($1, $2, $3, 1) RETURNING id`,
      [personaId, cargo, sucursal_id]
    );
    const empleadoId = empleadoResult.rows[0].id;

    // ✅ CAMBIO: admin y recepcionista guardan caja
    if (caja_id && ["admin", "recepcionista"].includes(cargo)) {
      await client.query(
        `INSERT INTO empleado_caja (empleado_id, caja_id, estado) 
         VALUES ($1, $2, 1)`,
        [empleadoId, caja_id]
      );
    }

    // ✅ CAMBIO: solo roles que requieren horarios los guardan (admin NO)
    if (cargo !== "admin" && horarios && horarios.length > 0) {
      for (const horario of horarios) {
        if (horario.hora_ingreso && horario.hora_salida) {
          await client.query(
            `INSERT INTO horarios_empleado 
              (empleado_id, dia_semana, hora_ingreso, hora_salida, sucursal_id) 
             VALUES ($1, $2, $3, $4, $5)`,
            [
              empleadoId,
              horario.dia_semana,
              horario.hora_ingreso,
              horario.hora_salida,
              horario.sucursal_id || sucursal_id || null,
            ]
          );
        }
      }
    }

    if (username && password && ["admin", "recepcionista"].includes(cargo)) {
      const hashedPassword = await bcrypt.hash(password, 10);
      await client.query(
        `INSERT INTO usuarios (username, password_hash, empleado_id, estado) 
         VALUES ($1, $2, $3, 1)`,
        [username, hashedPassword, empleadoId]
      );
    }

    await client.query("COMMIT");

    const newEmployee = await exports.getEmployeeById(empleadoId);
    return newEmployee;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

// ============================================
// UPDATE EMPLOYEE
// ============================================
exports.updateEmployee = async (id, employeeData) => {
  const {
    nombres,
    apellidos,
    ci,
    telefono,
    cargo,
    sucursal_id,
    caja_id,
    horarios,
    username,
    password,
  } = employeeData;

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const empleadoResult = await client.query(
      "SELECT persona_id FROM empleados WHERE id = $1",
      [id]
    );

    if (empleadoResult.rows.length === 0) {
      throw new Error("Empleado no encontrado");
    }

    const personaId = empleadoResult.rows[0].persona_id;

    await client.query(
      `UPDATE personas SET nombres = $1, apellidos = $2, ci = $3, telefono = $4 
       WHERE id = $5`,
      [nombres, apellidos, ci, telefono, personaId]
    );

    // ✅ CAMBIO: TODOS los roles guardan sucursal (incluido admin)
    await client.query(
      `UPDATE empleados SET rol = $1, sucursal_id = $2 WHERE id = $3`,
      [cargo, sucursal_id, id]
    );

    // ✅ CAMBIO: admin y recepcionista guardan caja
    if (["admin", "recepcionista"].includes(cargo) && caja_id) {
      const asignacionExistente = await client.query(
        "SELECT id FROM empleado_caja WHERE empleado_id = $1 AND estado = 1",
        [id]
      );

      if (asignacionExistente.rows.length > 0) {
        await client.query(
          "UPDATE empleado_caja SET caja_id = $1 WHERE empleado_id = $2 AND estado = 1",
          [caja_id, id]
        );
      } else {
        await client.query(
          `INSERT INTO empleado_caja (empleado_id, caja_id, estado) 
           VALUES ($1, $2, 1)`,
          [id, caja_id]
        );
      }
    } else {
      await client.query(
        "UPDATE empleado_caja SET estado = 0 WHERE empleado_id = $1",
        [id]
      );
    }

    // ✅ CAMBIO: manejo de horarios según rol (admin NO tiene horarios)
    await client.query(
      "DELETE FROM horarios_empleado WHERE empleado_id = $1",
      [id]
    );

    if (cargo !== "admin" && horarios && horarios.length > 0) {
      for (const horario of horarios) {
        if (horario.hora_ingreso && horario.hora_salida) {
          await client.query(
            `INSERT INTO horarios_empleado 
              (empleado_id, dia_semana, hora_ingreso, hora_salida, sucursal_id) 
             VALUES ($1, $2, $3, $4, $5)`,
            [
              id,
              horario.dia_semana,
              horario.hora_ingreso,
              horario.hora_salida,
              horario.sucursal_id || sucursal_id || null,
            ]
          );
        }
      }
    }

    if (["admin", "recepcionista"].includes(cargo)) {
      const usuarioExistente = await client.query(
        "SELECT id FROM usuarios WHERE empleado_id = $1",
        [id]
      );

      if (usuarioExistente.rows.length > 0) {
        if (password) {
          const hashedPassword = await bcrypt.hash(password, 10);
          await client.query(
            `UPDATE usuarios 
             SET username = $1, password_hash = $2, estado = 1 
             WHERE empleado_id = $3`,
            [username, hashedPassword, id]
          );
        } else {
          await client.query(
            `UPDATE usuarios 
             SET username = $1, estado = 1 
             WHERE empleado_id = $2`,
            [username, id]
          );
        }
      } else if (username && password) {
        const hashedPassword = await bcrypt.hash(password, 10);
        await client.query(
          `INSERT INTO usuarios (username, password_hash, empleado_id, estado) 
           VALUES ($1, $2, $3, 1)`,
          [username, hashedPassword, id]
        );
      }
    } else {
      await client.query(
        "UPDATE usuarios SET estado = 0 WHERE empleado_id = $1",
        [id]
      );
    }

    await client.query("COMMIT");

    const updatedEmployee = await exports.getEmployeeById(id);
    return updatedEmployee;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

// ============================================
// DELETE EMPLOYEE (soft delete)
// ============================================
exports.deleteEmployee = async (id) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const result = await client.query(
      "UPDATE empleados SET estado = 2 WHERE id = $1 RETURNING id",
      [id]
    );

    if (result.rows.length === 0) {
      throw new Error("Empleado no encontrado");
    }

    await client.query(
      "UPDATE usuarios SET estado = 0 WHERE empleado_id = $1",
      [id]
    );

    await client.query(
      "UPDATE empleado_caja SET estado = 0 WHERE empleado_id = $1",
      [id]
    );

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

// ============================================
// TOGGLE EMPLOYEE STATUS
// ============================================
exports.toggleEmployeeStatus = async (id) => {
  const result = await query(
    `UPDATE empleados 
     SET estado = CASE WHEN estado = 1 THEN 0 ELSE 1 END 
     WHERE id = $1 
     RETURNING id, estado`,
    [id]
  );

  if (result.rows.length === 0) {
    throw new Error("Empleado no encontrado");
  }

  const updatedEmployee = await exports.getEmployeeById(id);
  return updatedEmployee;
};

// ============================================
// REGISTER FINGERPRINT (compat)
// ============================================
exports.registerFingerprint = async (id) => {
  const numericId = Number(id);

  if (Number.isNaN(numericId) || numericId <= 0) {
    throw new Error(`ID inválido para registrar huella: ${id}`);
  }

  const asEmpleado = await query(
    "SELECT id, persona_id FROM empleados WHERE id = $1 AND estado IN (0, 1, 2)",
    [numericId]
  );

  if (asEmpleado.rows.length > 0) {
    const personaId = asEmpleado.rows[0].persona_id;
    console.log(
      `🟢 Huella: input id=${numericId} → interpretado como empleado_id → persona_id=${personaId}`
    );
    await query(
      "UPDATE personas SET huella_digital = $1 WHERE id = $2",
      [Buffer.from("simulated_fingerprint_data"), personaId]
    );
    return {
      personaId,
      resolvedAs: "empleado_id",
      empleadoId: asEmpleado.rows[0].id,
    };
  }

  const asPersona = await query(
    "SELECT id, nombres, apellidos FROM personas WHERE id = $1 AND estado IN (0, 1)",
    [numericId]
  );

  if (asPersona.rows.length > 0) {
    console.log(
      `🟢 Huella: input id=${numericId} → interpretado como persona_id (${asPersona.rows[0].nombres} ${asPersona.rows[0].apellidos})`
    );
    await query(
      "UPDATE personas SET huella_digital = $1 WHERE id = $2",
      [Buffer.from("simulated_fingerprint_data"), numericId]
    );
    return {
      personaId: numericId,
      resolvedAs: "persona_id",
      empleadoId: null,
    };
  }

  throw new Error(
    `No se encontró empleado ni persona con id=${numericId}. No se registró la huella.`
  );
};

// ============================================
// REGISTER FINGERPRINT BY PERSONA ID
// ============================================
exports.registerFingerprintByPersonaId = async (personaId) => {
  const numericId = Number(personaId);

  if (Number.isNaN(numericId) || numericId <= 0) {
    throw new Error(`persona_id inválido: ${personaId}`);
  }

  const personaResult = await query(
    "SELECT id, nombres, apellidos FROM personas WHERE id = $1 AND estado IN (0, 1)",
    [numericId]
  );

  if (personaResult.rows.length === 0) {
    throw new Error(`Persona no encontrada o inactiva (persona_id=${numericId})`);
  }

  const persona = personaResult.rows[0];

  await query(
    "UPDATE personas SET huella_digital = $1 WHERE id = $2",
    [Buffer.from("simulated_fingerprint_data"), numericId]
  );

  const empleadoResult = await query(
    "SELECT id FROM empleados WHERE persona_id = $1 AND estado = 1",
    [numericId]
  );

  console.log(
    `🟢 Huella registrada por persona_id=${numericId} (${persona.nombres} ${persona.apellidos})` +
      (empleadoResult.rows.length > 0
        ? ` → empleado_id=${empleadoResult.rows[0].id}`
        : " (sin empleado activo)")
  );

  return {
    persona_id: numericId,
    nombres: persona.nombres,
    apellidos: persona.apellidos,
    empleado_id:
      empleadoResult.rows.length > 0 ? empleadoResult.rows[0].id : null,
  };
};

// ============================================
// GET EMPLOYEE BY ID
// ============================================
exports.getEmployeeById = async (id) => {
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
      s.nombre as sucursal_nombre,
      ec.caja_id,
      c.nombre as caja_nombre,
      e.estado,
      (p.huella_digital IS NOT NULL) as tiene_huella,
      u.username
    FROM empleados e
    INNER JOIN personas p ON e.persona_id = p.id
    LEFT JOIN sucursales s ON e.sucursal_id = s.id
    LEFT JOIN empleado_caja ec ON e.id = ec.empleado_id AND ec.estado = 1
    LEFT JOIN cajas c ON ec.caja_id = c.id
    LEFT JOIN usuarios u ON e.id = u.empleado_id
    WHERE e.id = $1
  `,
    [id]
  );

  if (result.rows.length === 0) {
    throw new Error("Empleado no encontrado");
  }

  const horariosResult = await query(
    `SELECT 
      he.dia_semana, 
      he.hora_ingreso, 
      he.hora_salida,
      he.sucursal_id,
      s.nombre as sucursal_nombre
     FROM horarios_empleado he
     LEFT JOIN sucursales s ON he.sucursal_id = s.id
     WHERE he.empleado_id = $1 
     ORDER BY he.dia_semana, he.hora_ingreso`,
    [id]
  );

  return {
    ...result.rows[0],
    horarios: horariosResult.rows,
  };
};