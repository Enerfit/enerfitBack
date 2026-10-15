// src/routes/cuponesRoutes.js
const express = require("express");
const router = express.Router();
const cuponesController = require("../controllers/cuponesController");

router.get("/", cuponesController.getCupones);
router.get("/sucursales", cuponesController.getSucursales);
router.get("/empleados", cuponesController.getEmpleados); // ← NUEVO
router.post("/", cuponesController.createCupon);
router.put("/:id", cuponesController.updateCupon);
router.delete("/:id", cuponesController.deleteCupon);
router.patch("/:id/toggle-status", cuponesController.toggleCuponStatus);

module.exports = router;