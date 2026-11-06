const express = require("express");
const router = express.Router();
const remindersController = require("../controllers/reminderscontroller");

// Rutas para recordatorios
router.get("/new-members/:sucursalId", remindersController.getNewMembers);
router.get("/expiring-members/:sucursalId", remindersController.getExpiringMembers);
router.get("/birthday-members/:sucursalId", remindersController.getBirthdayMembers);

// Todas las personas inscritas (solo clientes).
// Soporta query param ?service=NombreDelServicio
router.get("/all-persons/:sucursalId", remindersController.getAllPersons);

// Lista de servicios disponibles para filtro (dropdown)
router.get("/services/:sucursalId", remindersController.getServiceNames);

module.exports = router;