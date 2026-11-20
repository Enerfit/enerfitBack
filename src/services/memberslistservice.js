// server/services/memberslistservice.js
const { query } = require("../../db");

// Importe registrado en ventas asociadas a la inscripción.
// En ventas de varias inscripciones, el total se prorratea por precio del detalle.
const PAYMENT_JOIN = `
  LEFT JOIN LATERAL (
    SELECT
      SUM(CASE WHEN x.cantidad_inscripciones = 1 THEN x.total
               WHEN x.precio_total > 0 THEN x.total * x.precio_inscripcion / x.precio_total
               ELSE NULL END) AS monto_pagado,
      BOOL_OR(x.cantidad_inscripciones > 1) AS monto_estimado,
      BOOL_OR(x.cantidad_inscripciones > 1 AND x.precio_total <= 0) AS monto_indeterminado
    FROM (
      SELECT vs.id, vs.total,
             COUNT(DISTINCT d.inscripcion_id) AS cantidad_inscripciones,
             SUM(d.precio) AS precio_total,
             SUM(d.precio) FILTER (WHERE d.inscripcion_id = c.inscripcion_id) AS precio_inscripcion
      FROM ventas_servicios vs
      INNER JOIN detalle_venta_servicios d ON d.venta_servicio_id = vs.id
      WHERE EXISTS (
        SELECT 1 FROM detalle_venta_servicios d2
        WHERE d2.venta_servicio_id = vs.id AND d2.inscripcion_id = c.inscripcion_id
      )
      GROUP BY vs.id, vs.total
    ) x
  ) pago ON TRUE
`;

// ============================================
// HELPER: construir WHERE base
// ============================================
function buildWhereConditions({
  searchTerm,
  serviceFilter,
  statusFilter,
  sucursalFilter,
  userSucursalId,
  userRol,
}) {
  const whereConditions = [];
  const queryParams = [];
  let paramCount = 0;

  const esAdmin = userRol === "admin";

  if (!esAdmin && userSucursalId) {
    paramCount++;
    whereConditions.push(`i.sucursal_id = $${paramCount}`);
    queryParams.push(parseInt(userSucursalId));
  } else if (sucursalFilter && sucursalFilter !== "all") {
    paramCount++;
    whereConditions.push(`i.sucursal_id = $${paramCount}`);
    queryParams.push(parseInt(sucursalFilter));
  }

  whereConditions.push(
    `p.id NOT IN (SELECT persona_id FROM empleados WHERE estado = 1)`
  );

  whereConditions.push(`p.estado = 0`);

  if (searchTerm && searchTerm.trim() !== "") {
    paramCount++;
    const normalizedSearch = searchTerm.trim().replace(/\s+/g, " ");

    whereConditions.push(`
      (
        unaccent(LOWER(REGEXP_REPLACE(TRIM(p.nombres), '\\s+', ' ', 'g'))) 
          ILIKE unaccent(LOWER($${paramCount}))
        OR unaccent(LOWER(REGEXP_REPLACE(TRIM(p.apellidos), '\\s+', ' ', 'g'))) 
          ILIKE unaccent(LOWER($${paramCount}))
        OR TRIM(p.ci) ILIKE $${paramCount}
        OR unaccent(LOWER(
          REGEXP_REPLACE(
            TRIM(CONCAT(
              REGEXP_REPLACE(TRIM(p.nombres), '\\s+', ' ', 'g'),
              ' ',
              REGEXP_REPLACE(TRIM(p.apellidos), '\\s+', ' ', 'g')
            )),
            '\\s+', ' ', 'g'
          )
        )) ILIKE unaccent(LOWER($${paramCount}))
        OR unaccent(LOWER(
          REGEXP_REPLACE(
            TRIM(CONCAT(
              REGEXP_REPLACE(TRIM(p.apellidos), '\\s+', ' ', 'g'),
              ' ',
              REGEXP_REPLACE(TRIM(p.nombres), '\\s+', ' ', 'g')
            )),
            '\\s+', ' ', 'g'
          )
        )) ILIKE unaccent(LOWER($${paramCount}))
      )
    `);

    queryParams.push(`%${normalizedSearch}%`);
  }

  if (serviceFilter && serviceFilter !== "all") {
    paramCount++;
    whereConditions.push(`s.nombre = $${paramCount}`);
    queryParams.push(serviceFilter);
  }

  if (statusFilter === "active" || statusFilter === "inactive") {
    const activeCondition = `EXISTS (
      SELECT 1 FROM inscripciones i2
      WHERE i2.persona_id = i.persona_id
        AND i2.sucursal_id = i.sucursal_id
        AND i2.estado = 1
        AND i2.estado_inscripcion = 'activo'
    )`;
    whereConditions.push(statusFilter === "active" ? activeCondition : `NOT ${activeCondition}`);
  }

  return { whereConditions, queryParams, paramCount };
}

// ============================================
// GET MEMBERS (paginado)
// ============================================
const getMembers = async (
  page = 1,
  limit = 10,
  searchTerm,
  serviceFilter,
  statusFilter,
  sucursalFilter,
  userSucursalId,
  userRol
) => {
  try {
    const itemsPerPage = 10;
    const currentPage = Math.max(1, parseInt(page) || 1);
    const offset = (currentPage - 1) * itemsPerPage;

    const { whereConditions, queryParams, paramCount } = buildWhereConditions({
      searchTerm,
      serviceFilter,
      statusFilter,
      sucursalFilter,
      userSucursalId,
      userRol,
    });

    const whereClause =
      whereConditions.length > 0
        ? `WHERE ${whereConditions.join(" AND ")}`
        : "";

    const membersQuery = `
      WITH inscripciones_calculadas AS (
        SELECT 
          i.id AS inscripcion_id,
          i.persona_id,
          i.servicio_id,
          i.sucursal_id,
          i.ingresos_disponibles,
          i.fecha_inicio,
          i.fecha_vencimiento,
          i.estado_inscripcion,
          s.nombre AS servicio_nombre,
          COALESCE(ts.nombre, 'general') AS tipo_servicio,
          CASE 
            WHEN i.estado_inscripcion = 'activo' THEN true 
            ELSE false 
          END AS es_activa
        FROM inscripciones i
        INNER JOIN servicios s ON i.servicio_id = s.id
        LEFT JOIN tipos_servicio ts ON s.tipo_servicio_id = ts.id
        INNER JOIN personas p ON i.persona_id = p.id
        INNER JOIN sucursales su ON i.sucursal_id = su.id AND su.estado = 1
        ${whereClause}
      ),
      candidatas AS (
        SELECT 
          ic.*,
          ROW_NUMBER() OVER (
            PARTITION BY ic.persona_id, ic.sucursal_id, ic.tipo_servicio
            ORDER BY 
              CASE WHEN ic.es_activa THEN 0 ELSE 1 END,
              ic.fecha_vencimiento DESC,
              ic.inscripcion_id DESC
          ) AS rn_por_tipo
        FROM inscripciones_calculadas ic
      ),
      PersonasUnicas AS (
        SELECT DISTINCT ON (c.persona_id, c.sucursal_id)
          c.persona_id,
          c.sucursal_id,
          su.nombre AS sucursal_name
        FROM candidatas c
        INNER JOIN sucursales su ON c.sucursal_id = su.id
        WHERE c.rn_por_tipo = 1
        ORDER BY c.persona_id, c.sucursal_id
      )
      SELECT 
        pu.persona_id AS id,
        CONCAT(p.nombres, ' ', p.apellidos) AS name,
        p.nombres AS nombres,
        p.apellidos AS apellidos,
        p.ci,
        p.telefono AS phone,
        TO_CHAR(p.fecha_nacimiento, 'YYYY-MM-DD') AS birthdate,
        pu.sucursal_id,
        pu.sucursal_name,
        TO_CHAR(MIN(c.fecha_inicio), 'YYYY-MM-DD') AS registrationdate,
        CASE 
          WHEN EXISTS (
            SELECT 1 FROM inscripciones i2 
            WHERE i2.persona_id = pu.persona_id 
            AND i2.sucursal_id = pu.sucursal_id
            AND i2.estado = 1
            AND i2.estado_inscripcion = 'activo'
          ) THEN 'active'
          ELSE 'inactive'
        END AS member_status
      FROM PersonasUnicas pu
      INNER JOIN personas p ON p.id = pu.persona_id
      LEFT JOIN candidatas c 
        ON c.persona_id = pu.persona_id 
        AND c.sucursal_id = pu.sucursal_id
        AND c.rn_por_tipo = 1
      GROUP BY pu.persona_id, p.nombres, p.apellidos, p.ci, p.telefono,
               p.fecha_nacimiento, pu.sucursal_id, pu.sucursal_name
      ORDER BY pu.persona_id, pu.sucursal_id
      LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}
    `;

    const countQuery = `
      WITH inscripciones_calculadas AS (
        SELECT 
          i.persona_id,
          i.sucursal_id,
          COALESCE(ts.nombre, 'general') AS tipo_servicio
        FROM inscripciones i
        INNER JOIN servicios s ON i.servicio_id = s.id
        LEFT JOIN tipos_servicio ts ON s.tipo_servicio_id = ts.id
        INNER JOIN personas p ON i.persona_id = p.id
        INNER JOIN sucursales su ON i.sucursal_id = su.id AND su.estado = 1
        ${whereClause}
      ),
      PersonasUnicas AS (
        SELECT DISTINCT persona_id, sucursal_id
        FROM inscripciones_calculadas
      )
      SELECT COUNT(*) AS total_count
      FROM PersonasUnicas
    `;

    queryParams.push(itemsPerPage, offset);

    const membersResult = await query(membersQuery, queryParams);
    const countResult = await query(countQuery, queryParams.slice(0, -2));

    const totalCount = parseInt(countResult.rows[0]?.total_count || 0);

    const uniqueIds = [...new Set(membersResult.rows.map((m) => m.id))];

    let allServices = [];

    if (uniqueIds.length > 0) {
      const placeholders = uniqueIds.map((_, i) => `$${i + 1}`).join(",");

      // ============================================
      // Trae también el coach asignado en la última venta
      // ============================================
      const allServicesQuery = `
        WITH inscripciones_calculadas AS (
          SELECT 
            i.id AS inscripcion_id,
            i.persona_id,
            i.servicio_id,
            i.sucursal_id,
            i.ingresos_disponibles,
            i.fecha_inicio,
            i.fecha_vencimiento,
            i.estado_inscripcion,
            s.nombre AS servicio_nombre,
            COALESCE(ts.nombre, 'general') AS tipo_servicio,
            CASE 
              WHEN i.estado_inscripcion = 'activo' THEN true 
              ELSE false 
            END AS es_activa
          FROM inscripciones i
          INNER JOIN servicios s ON i.servicio_id = s.id
          LEFT JOIN tipos_servicio ts ON s.tipo_servicio_id = ts.id
          WHERE i.estado = 1
            AND i.persona_id IN (${placeholders})
        ),
        candidatas AS (
          SELECT 
            ic.*,
            ROW_NUMBER() OVER (
              PARTITION BY ic.persona_id, ic.sucursal_id, ic.tipo_servicio
              ORDER BY 
                CASE WHEN ic.es_activa THEN 0 ELSE 1 END,
                ic.fecha_vencimiento DESC,
                ic.inscripcion_id DESC
            ) AS rn_por_tipo
          FROM inscripciones_calculadas ic
        ),
        -- Última venta asociada a cada inscripción
        venta_por_inscripcion AS (
          SELECT DISTINCT ON (dvs.inscripcion_id)
            dvs.inscripcion_id,
            dvs.coach_id,
            vs.id AS venta_id
          FROM detalle_venta_servicios dvs
          INNER JOIN ventas_servicios vs ON vs.id = dvs.venta_servicio_id
          ORDER BY dvs.inscripcion_id, vs.fecha DESC, vs.id DESC
        )
        SELECT 
          c.persona_id,
          c.sucursal_id,
          c.inscripcion_id,
          c.servicio_nombre,
          c.ingresos_disponibles,
          TO_CHAR(c.fecha_inicio, 'YYYY-MM-DD') AS fecha_inicio,
          TO_CHAR(c.fecha_vencimiento, 'YYYY-MM-DD') AS fecha_vencimiento,
          CASE WHEN c.es_activa THEN 'active' ELSE 'inactive' END AS servicio_status,
          c.tipo_servicio,
          vpi.coach_id,
           CASE WHEN pago.monto_indeterminado THEN NULL ELSE ROUND(pago.monto_pagado, 2) END AS monto_pagado,
           COALESCE(pago.monto_estimado, false) AS monto_estimado,
          CASE 
            WHEN vpi.coach_id IS NOT NULL 
              THEN CONCAT(pc.nombres, ' ', pc.apellidos)
            ELSE NULL
          END AS coach_nombre
        FROM candidatas c
        LEFT JOIN venta_por_inscripcion vpi 
          ON vpi.inscripcion_id = c.inscripcion_id
        LEFT JOIN empleados ec 
          ON ec.id = vpi.coach_id
        LEFT JOIN personas pc 
          ON pc.id = ec.persona_id
        ${PAYMENT_JOIN}
        WHERE c.rn_por_tipo = 1
        ORDER BY c.persona_id, c.sucursal_id, 
                 CASE WHEN c.es_activa THEN 0 ELSE 1 END,
                 c.tipo_servicio ASC,
                 c.fecha_vencimiento DESC
      `;

      const servicesResult = await query(allServicesQuery, uniqueIds);
      allServices = servicesResult.rows;
    }

    const servicesByMember = new Map();
    allServices.forEach((svc) => {
      const key = `${svc.persona_id}-${svc.sucursal_id}`;
      if (!servicesByMember.has(key)) {
        servicesByMember.set(key, []);
      }
      servicesByMember.get(key).push({
        inscripcionId: svc.inscripcion_id,
        name: svc.servicio_nombre,
        startDate: svc.fecha_inicio || "",
        expirationDate: svc.fecha_vencimiento,
        status: svc.servicio_status,
        ingresos_disponibles: svc.ingresos_disponibles,
        coachId: svc.coach_id || null,
        coachNombre: svc.coach_nombre || null,
          montoPagado: svc.monto_pagado == null ? null : Number(svc.monto_pagado),
          montoEstimado: svc.monto_estimado === true,
      });
    });

    const membersWithServices = membersResult.rows.map((member) => ({
      id: member.id.toString(),
      name: member.name || "",
      nombres: member.nombres || "",
      apellidos: member.apellidos || "",
      ci: member.ci || "",
      phone: member.phone || "",
      birthDate: member.birthdate || "",
      sucursal: member.sucursal_id ? member.sucursal_id.toString() : "",
      status: member.member_status || "inactive",
      registrationDate: member.registrationdate || "",
      services:
        servicesByMember.get(`${member.id}-${member.sucursal_id}`) || [],
    }));

    return {
      members: membersWithServices,
      totalCount,
      currentPage,
      totalPages: Math.ceil(totalCount / itemsPerPage),
      itemsPerPage,
    };
  } catch (error) {
    console.error("Error en getMembers service:", error);
    throw new Error(
      `Error al obtener miembros desde la base de datos: ${error.message}`
    );
  }
};

// ============================================
// GET ALL MEMBERS (sin paginación)
// ============================================
const getAllMembers = async (
  searchTerm,
  serviceFilter,
  statusFilter,
  sucursalFilter,
  userSucursalId,
  userRol
) => {
  try {
    const { whereConditions, queryParams } = buildWhereConditions({
      searchTerm,
      serviceFilter,
      statusFilter,
      sucursalFilter,
      userSucursalId,
      userRol,
    });

    const whereClause =
      whereConditions.length > 0
        ? `WHERE ${whereConditions.join(" AND ")}`
        : "";

    const queryText = `
      WITH inscripciones_calculadas AS (
        SELECT 
          i.id AS inscripcion_id,
          i.persona_id,
          i.servicio_id,
          i.sucursal_id,
          i.ingresos_disponibles,
          i.fecha_inicio,
          i.fecha_vencimiento,
          i.estado_inscripcion,
          s.nombre AS servicio_nombre,
          COALESCE(ts.nombre, 'general') AS tipo_servicio,
          p.nombres,
          p.apellidos,
          p.ci,
          p.telefono,
          p.fecha_nacimiento,
          su.nombre AS sucursal_name,
          CASE 
            WHEN i.estado_inscripcion = 'activo' THEN true 
            ELSE false 
          END AS es_activa
        FROM inscripciones i
        INNER JOIN servicios s ON i.servicio_id = s.id
        LEFT JOIN tipos_servicio ts ON s.tipo_servicio_id = ts.id
        INNER JOIN personas p ON i.persona_id = p.id
        INNER JOIN sucursales su ON i.sucursal_id = su.id AND su.estado = 1
        ${whereClause}
      ),
      candidatas AS (
        SELECT 
          ic.*,
          ROW_NUMBER() OVER (
            PARTITION BY ic.persona_id, ic.sucursal_id, ic.tipo_servicio
            ORDER BY 
              CASE WHEN ic.es_activa THEN 0 ELSE 1 END,
              ic.fecha_vencimiento DESC,
              ic.inscripcion_id DESC
          ) AS rn_por_tipo
        FROM inscripciones_calculadas ic
      ),
      venta_por_inscripcion AS (
        SELECT DISTINCT ON (dvs.inscripcion_id)
          dvs.inscripcion_id,
          dvs.coach_id,
          vs.id AS venta_id
        FROM detalle_venta_servicios dvs
        INNER JOIN ventas_servicios vs ON vs.id = dvs.venta_servicio_id
        ORDER BY dvs.inscripcion_id, vs.fecha DESC, vs.id DESC
      )
      SELECT 
        c.persona_id,
        CONCAT(c.nombres, ' ', c.apellidos) AS name,
        c.nombres AS nombres,
        c.apellidos AS apellidos,
        c.ci,
        c.telefono AS phone,
        TO_CHAR(c.fecha_nacimiento, 'YYYY-MM-DD') AS birthdate,
        c.sucursal_id,
        c.sucursal_name,
        c.inscripcion_id,
        c.servicio_nombre,
        c.ingresos_disponibles,
        TO_CHAR(c.fecha_inicio, 'YYYY-MM-DD') AS fecha_inicio,
        TO_CHAR(c.fecha_vencimiento, 'YYYY-MM-DD') AS fecha_vencimiento,
        CASE WHEN c.es_activa THEN 'active' ELSE 'inactive' END AS servicio_status,
        vpi.coach_id,
           CASE WHEN pago.monto_indeterminado THEN NULL ELSE ROUND(pago.monto_pagado, 2) END AS monto_pagado,
           COALESCE(pago.monto_estimado, false) AS monto_estimado,
        CASE 
          WHEN vpi.coach_id IS NOT NULL 
            THEN CONCAT(pc.nombres, ' ', pc.apellidos)
          ELSE NULL
        END AS coach_nombre,
        CASE 
          WHEN EXISTS (
            SELECT 1 FROM inscripciones i2 
            WHERE i2.persona_id = c.persona_id 
            AND i2.sucursal_id = c.sucursal_id
            AND i2.estado = 1
            AND i2.estado_inscripcion = 'activo'
          ) THEN 'active'
          ELSE 'inactive'
        END AS member_status
      FROM candidatas c
      LEFT JOIN venta_por_inscripcion vpi 
        ON vpi.inscripcion_id = c.inscripcion_id
      LEFT JOIN empleados ec 
        ON ec.id = vpi.coach_id
      LEFT JOIN personas pc 
        ON pc.id = ec.persona_id
      ${PAYMENT_JOIN}
      WHERE c.rn_por_tipo = 1
      ORDER BY c.nombres, c.apellidos, c.sucursal_id,
               CASE WHEN c.es_activa THEN 0 ELSE 1 END,
               c.tipo_servicio ASC,
               c.fecha_vencimiento DESC
    `;

    const result = await query(queryText, queryParams);

    const membersMap = new Map();

    result.rows.forEach((row) => {
      const key = `${row.persona_id}-${row.sucursal_id}`;

      if (!membersMap.has(key)) {
        membersMap.set(key, {
          id: row.persona_id.toString(),
          name: row.name || "",
          nombres: row.nombres || "",
          apellidos: row.apellidos || "",
          ci: row.ci || "",
          phone: row.phone || "",
          birthDate: row.birthdate || "",
          sucursal: row.sucursal_id ? row.sucursal_id.toString() : "",
          status: row.member_status || "inactive",
          registrationDate: row.fecha_inicio || "",
          services: [],
        });
      }

      const member = membersMap.get(key);

      const servicioExistente = member.services.find(
        (service) =>
          service.inscripcionId === row.inscripcion_id ||
          service.name === row.servicio_nombre
      );

      if (!servicioExistente) {
        member.services.push({
          inscripcionId: row.inscripcion_id,
          name: row.servicio_nombre,
          startDate: row.fecha_inicio || "",
          expirationDate: row.fecha_vencimiento,
          status: row.servicio_status,
          ingresos_disponibles: row.ingresos_disponibles,
          coachId: row.coach_id || null,
          coachNombre: row.coach_nombre || null,
          montoPagado: row.monto_pagado == null ? null : Number(row.monto_pagado),
          montoEstimado: row.monto_estimado === true,
        });
      }
    });

    return Array.from(membersMap.values());
  } catch (error) {
    console.error("Error en getAllMembers service:", error);
    throw new Error(
      `Error al obtener todos los miembros desde la base de datos: ${error.message}`
    );
  }
};

// ============================================
// EDIT MEMBER
// ============================================
const editMember = async (id, nombres, apellidos, ci, phone) => {
  try {
    const checkCiQuery = `
      SELECT id, nombres, apellidos, ci, telefono, fecha_nacimiento
      FROM personas WHERE ci = $1 AND id != $2 AND estado = 0
    `;
    const ciResult = await query(checkCiQuery, [ci, id]);

    if (ciResult.rows.length > 0) {
      const existingPerson = ciResult.rows[0];
      const error = new Error("La persona ya existe con este número de cédula");
      error.existingPerson = existingPerson;
      throw error;
    }

    const updateQuery = `
      UPDATE personas 
      SET nombres = TRIM($1), apellidos = TRIM($2), ci = TRIM($3), telefono = TRIM($4)
      WHERE id = $5 AND estado = 0
      RETURNING *
    `;

    const result = await query(updateQuery, [
      nombres,
      apellidos,
      ci,
      phone,
      id,
    ]);

    if (result.rows.length === 0) {
      throw new Error("Miembro no encontrado o ya está eliminado");
    }

    return result.rows[0];
  } catch (error) {
    console.error("Error en editMember service:", error);
    if (error.message.includes("La persona ya existe")) {
      throw error;
    }
    throw new Error(
      `Error al editar miembro en la base de datos: ${error.message}`
    );
  }
};

// ============================================
// UPDATE INSCRIPTION DATES
// ============================================
const updateInscriptionDates = async (
  personaId,
  serviceName,
  startDate,
  expirationDate,
  userContext = {}
) => {
  try {
    const { usuarioId, sucursalId } = userContext;

    if (!usuarioId) {
      throw new Error(
        "No se pudo identificar al usuario que realiza el cambio"
      );
    }

    const findQuery = `
      SELECT 
        i.id, 
        i.persona_id,
        i.servicio_id,
        i.sucursal_id,
        TO_CHAR(i.fecha_inicio, 'YYYY-MM-DD') AS fecha_inicio,
        TO_CHAR(i.fecha_vencimiento, 'YYYY-MM-DD') AS fecha_vencimiento,
        i.estado_inscripcion
      FROM inscripciones i
      INNER JOIN servicios s ON i.servicio_id = s.id
      WHERE i.persona_id = $1 AND s.nombre = $2 AND i.estado = 1
      ORDER BY i.id DESC
      LIMIT 1
    `;

    const findResult = await query(findQuery, [personaId, serviceName]);

    if (findResult.rows.length === 0) {
      throw new Error(
        `No se encontró inscripción para la persona ${personaId} con el servicio ${serviceName}`
      );
    }

    const inscripcion = findResult.rows[0];
    const fechaInicioAnterior = inscripcion.fecha_inicio;
    const fechaVencimientoAnterior = inscripcion.fecha_vencimiento;

    const updateQuery = `
      UPDATE inscripciones
      SET fecha_inicio = $1::date, fecha_vencimiento = $2::date
      WHERE id = $3
      RETURNING 
        id, 
        TO_CHAR(fecha_inicio, 'YYYY-MM-DD') AS fecha_inicio, 
        TO_CHAR(fecha_vencimiento, 'YYYY-MM-DD') AS fecha_vencimiento
    `;

    const result = await query(updateQuery, [
      startDate,
      expirationDate,
      inscripcion.id,
    ]);

    const updated = result.rows[0];

    const sucursalMovimiento =
      inscripcion.sucursal_id || (sucursalId ? Number(sucursalId) : null);

    if (sucursalMovimiento) {
      const descripcion = [
        `Cambio de fechas del servicio "${serviceName}"`,
        `Inicio: ${fechaInicioAnterior || "—"} → ${updated.fecha_inicio}`,
        `Vencimiento: ${fechaVencimientoAnterior || "—"} → ${updated.fecha_vencimiento}`,
      ].join(" | ");

      const insertMovQuery = `
        INSERT INTO movimientos_fechas_inscripcion (
          inscripcion_id,
          persona_id,
          servicio_id,
          sucursal_id,
          usuario_id,
          fecha_inicio_anterior,
          fecha_inicio_nueva,
          fecha_vencimiento_anterior,
          fecha_vencimiento_nueva,
          descripcion
        ) VALUES (
          $1, $2, $3, $4, $5,
          $6::date, $7::date, $8::date, $9::date,
          $10
        )
        RETURNING id
      `;

      await query(insertMovQuery, [
        inscripcion.id,
        inscripcion.persona_id,
        inscripcion.servicio_id,
        sucursalMovimiento,
        usuarioId,
        fechaInicioAnterior,
        updated.fecha_inicio,
        fechaVencimientoAnterior,
        updated.fecha_vencimiento,
        descripcion,
      ]);
    } else {
      console.warn("⚠️ No se pudo registrar el movimiento: falta sucursal_id");
    }

    return updated;
  } catch (error) {
    console.error("Error en updateInscriptionDates service:", error);
    throw new Error(
      `Error al actualizar fechas de inscripción: ${error.message}`
    );
  }
};

// ============================================
// UPDATE SERVICE COACH
// Actualiza detalle_venta_servicios.coach_id para la última venta
// asociada a la inscripción indicada.
// - Si coachId es null => quita el coach.
// - Verifica que la inscripción pertenezca a la persona.
// - Verifica que el coach exista y tenga rol 'couch'.
// ============================================
const updateServiceCoach = async (personaId, inscripcionId, coachId) => {
  try {
    // 1) Verificar que la inscripción pertenece a la persona
    const checkInscripcion = await query(
      `SELECT id, persona_id FROM inscripciones WHERE id = $1 AND estado = 1`,
      [inscripcionId]
    );

    if (checkInscripcion.rows.length === 0) {
      throw new Error("Inscripción no encontrada");
    }

    if (checkInscripcion.rows[0].persona_id.toString() !== personaId.toString()) {
      throw new Error("La inscripción no pertenece a la persona indicada");
    }

    // 2) Si hay coach, validar que exista y sea rol 'couch'
    if (coachId !== null && coachId !== undefined) {
      const checkCoach = await query(
        `SELECT id, rol FROM empleados WHERE id = $1 AND estado IN (0, 1)`,
        [coachId]
      );

      if (checkCoach.rows.length === 0) {
        throw new Error("Coach no encontrado");
      }

      if (checkCoach.rows[0].rol !== "couch") {
        throw new Error(
          `El empleado seleccionado no tiene rol "couch" (rol actual: ${checkCoach.rows[0].rol})`
        );
      }
    }

    // 3) Buscar el detalle de venta más reciente para esta inscripción
    const findDetalle = await query(
      `
      SELECT dvs.id AS detalle_id, dvs.venta_servicio_id, vs.fecha
      FROM detalle_venta_servicios dvs
      INNER JOIN ventas_servicios vs ON vs.id = dvs.venta_servicio_id
      WHERE dvs.inscripcion_id = $1
      ORDER BY vs.fecha DESC, vs.id DESC
      LIMIT 1
      `,
      [inscripcionId]
    );

    if (findDetalle.rows.length === 0) {
      throw new Error(
        "No se encontró una venta asociada a esta inscripción para actualizar el coach"
      );
    }

    const detalleId = findDetalle.rows[0].detalle_id;

    // 4) Actualizar coach_id
    const update = await query(
      `
      UPDATE detalle_venta_servicios
      SET coach_id = $1
      WHERE id = $2
      RETURNING id, inscripcion_id, coach_id
      `,
      [coachId === null ? null : coachId, detalleId]
    );

    return update.rows[0];
  } catch (error) {
    console.error("Error en updateServiceCoach service:", error);
    throw new Error(`Error al actualizar coach: ${error.message}`);
  }
};

// ============================================
// DELETE MEMBER
// ============================================
const deleteMember = async (id) => {
  try {
    const checkQuery = "SELECT * FROM personas WHERE id = $1 AND estado = 0";
    const checkResult = await query(checkQuery, [id]);

    if (checkResult.rows.length === 0) {
      throw new Error("Miembro no encontrado o ya está eliminado");
    }

    const result = await query(
      "UPDATE personas SET estado = 1 WHERE id = $1 AND estado = 0 RETURNING *",
      [id]
    );

    return result.rows[0];
  } catch (error) {
    console.error("Error en deleteMember service:", error);
    throw new Error(
      `Error al eliminar miembro de la base de datos: ${error.message}`
    );
  }
};

// ============================================
// GET AVAILABLE SERVICES
// ============================================
const getAvailableServices = async () => {
  try {
    const queryText = `
      SELECT nombre 
      FROM servicios 
      WHERE estado = 1 
      ORDER BY nombre
    `;
    const result = await query(queryText);
    return result.rows.map((row) => row.nombre);
  } catch (error) {
    console.error("Error en getAvailableServices service:", error);
    throw new Error(
      `Error al obtener servicios disponibles desde la base de datos: ${error.message}`
    );
  }
};

// ============================================
// GET AVAILABLE BRANCHES
// ============================================
const getAvailableBranches = async () => {
  try {
    const queryText = `
      SELECT id, nombre 
      FROM sucursales 
      WHERE estado = 1 
      ORDER BY nombre
    `;
    const result = await query(queryText);
    return result.rows.map((row) => ({
      id: row.id.toString(),
      name: row.nombre,
    }));
  } catch (error) {
    console.error("Error en getAvailableBranches service:", error);
    throw new Error(
      `Error al obtener sucursales disponibles desde la base de datos: ${error.message}`
    );
  }
};

module.exports = {
  getMembers,
  getAllMembers,
  editMember,
  deleteMember,
  updateInscriptionDates,
  updateServiceCoach,
  getAvailableServices,
  getAvailableBranches,
};