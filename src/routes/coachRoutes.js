// src/routes/coachRoutes.js
const express = require("express");
const router = express.Router();
const coachController = require("../controllers/coachController");

// Registros mensuales (metas + adelantos)
router.get("/:id/registros", coachController.getRegistrosMes);
router.put("/:id/registros", coachController.upsertRegistroMes);

// Inscritos atribuidos al coach
router.get("/:id/inscritos", coachController.getInscritosCoach);

// CRUD coaches (empleados con rol='couch')
router.get("/", coachController.getCoaches);
router.get("/:id", coachController.getCoachById);
router.post("/", coachController.createCoach);
router.put("/:id", coachController.updateCoach);
router.delete("/:id", coachController.deleteCoach);
router.patch("/:id/toggle-status", coachController.toggleCoachStatus);

module.exports = router;