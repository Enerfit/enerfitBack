const express = require("express");
const cors = require("cors");
const { connectDB } = require("./db");
const { startInscripcionesCron } = require("./src/jobs/updateInscripcionesEstados");

const app = express();

const allowedOrigins = new Set([
  "http://localhost:8080",
  "https://enerfitback.onrender.com",
  "https://enerfit.spiderlabsystems.com",
]);

const corsOptions = {
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.has(origin)) return callback(null, true);
    return callback(new Error(`El origen ${origin} no tiene permiso de acceso.`), false);
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
};

app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions));

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ limit: "10mb", extended: true }));

// Rutas
const loginRoutes = require("./src/routes/loginroutes");
const remindersRoutes = require("./src/routes/remindersroutes");
const membersListRoutes = require("./src/routes/memberslistroutes");
const ProductRoutes = require("./src/routes/productsRoutes");
const EmployeeRoutes = require("./src/routes/employeeRoutes");
const cashRoutes = require("./src/routes/cashRoutes");
const servicesRoutes = require("./src/routes/servicesRoutes");
const ReportsRoutes = require("./src/routes/reportsRoutes");
const AccessRoutes = require("./src/routes/accessRoutes");
const RegisterMemberRoutes = require("./src/routes/RegisterMemberRoutes");
const salesControlRoutes = require("./src/routes/salescontrolRoutes");
const newtransactionRoutes = require("./src/routes/newtransactionRoutes");
const sellProductsRoutes = require("./src/routes/sellProductsRoutes");
const suscripcionRoutes = require("./src/routes/suscripcionRoutes");
const pendientesRoutes = require("./src/routes/pendientesRoutes");
const UneteAhoraRoutes = require("./src/routes/UneteAhoraRoutes");
const Planes = require("./src/routes/PlanesRoutes");
const sidebarPasswordRoutes = require("./src/routes/sidebarPasswordRoutes");
const cuponesRoutes = require("./src/routes/cuponesRoutes");
const zumbaRoutes = require("./src/routes/zumbaRoutes");
const coachRoutes = require("./src/routes/coachRoutes"); // ✅ NUEVO

app.use("/api/reminders", remindersRoutes);
app.use("/api/login", loginRoutes);
app.use("/api/members", membersListRoutes);
app.use("/api/products", ProductRoutes);
app.use("/api/employees", EmployeeRoutes);
app.use("/api/cash", cashRoutes);
app.use("/api/services", servicesRoutes);
app.use("/api/reports", ReportsRoutes);
app.use("/api/access", AccessRoutes);
app.use("/api/inscription", RegisterMemberRoutes);
app.use("/api/sales", salesControlRoutes);
app.use("/api", newtransactionRoutes);
app.use("/api/sell-products", sellProductsRoutes);
app.use("/api/suscripcion", suscripcionRoutes);
app.use("/api/pendientes", pendientesRoutes);
app.use("/api/unete-ahora", UneteAhoraRoutes);
app.use("/api/planes", Planes);
app.use("/api/password", sidebarPasswordRoutes);
app.use("/api/cupones", cuponesRoutes);
app.use("/api/zumba", zumbaRoutes);
app.use("/api/coaches", coachRoutes); // ✅ NUEVO

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    success: false,
    message: "Error interno del servidor",
    error: process.env.NODE_ENV === "development" ? err.message : undefined,
  });
});

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Ruta no encontrada: ${req.originalUrl}`,
  });
});

const startServer = async () => {
  try {
    await connectDB();
    const PORT = process.env.PORT || 5000;
    app.listen(PORT, () => {
      console.log(`Servidor corriendo en el puerto ${PORT}`);
    });
    startInscripcionesCron();
  } catch (error) {
    console.error("Error al iniciar el servidor:", error);
    process.exit(1);
  }
};

startServer();