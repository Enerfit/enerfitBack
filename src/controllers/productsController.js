const productsService = require("../services/productsService");
const { query } = require("../../db");
async function resolveUsuarioId(req) {
  if (req.user?.idusuario) return req.user.idusuario;
  if (req.user?.id && !req.user?.idempleado && !req.user?.empleado_id) return req.user.id;
  const empleadoId = req.user?.idempleado || req.user?.empleado_id;
  if (empleadoId) {
    try {
      const r = await query(`SELECT id FROM usuarios WHERE empleado_id = $1 AND estado = 1 LIMIT 1`, [empleadoId]);
      if (r.rows.length > 0) return r.rows[0].id;
    } catch (err) { console.error("Error resolviendo usuario desde empleado:", err); }
  }
  if (req.user?.username) {
    try {
      const r = await query(`SELECT id FROM usuarios WHERE username = $1 AND estado = 1 LIMIT 1`, [req.user.username]);
      if (r.rows.length > 0) return r.rows[0].id;
    } catch (err) { console.error("Error resolviendo usuario desde username:", err); }
  }
  return null;
}
const getProducts = async (req, res) => {
  try { const { sucursal } = req.query; res.json(await productsService.getAllProducts(sucursal)); }
  catch (error) { console.error("Error en getProducts:", error); res.status(500).json({error: error.message}); }
};
const getProductById = async (req, res) => {
  try { const product = await productsService.getProductById(req.params.id); if (!product) return res.status(404).json({error: "Producto no encontrado"}); res.json(product); }
  catch (error) { console.error("Error en getProductById:", error); res.status(500).json({error: error.message}); }
};
const createProduct = async (req, res) => {
  try {
    const { nombre, descripcion, precio_venta, sucursales, stock_por_sucursal, sin_stock, precio_compra, codigo, stock_minimo_por_sucursal, imagen, landing } = req.body;
    if (!nombre || !precio_venta) return res.status(400).json({error: "Nombre y precio_venta son obligatorios"});
    if (!sucursales || !Array.isArray(sucursales) || sucursales.length === 0) return res.status(400).json({error: "Debe seleccionar al menos una sucursal"});
    if (parseFloat(precio_venta) <= 0) return res.status(400).json({error: "El precio de venta debe ser mayor a 0"});
    if (precio_compra !== undefined && precio_compra !== null && parseFloat(precio_compra) <= 0) return res.status(400).json({error: "El precio de compra debe ser mayor a 0"});
    if (descripcion !== undefined && descripcion !== null && typeof descripcion !== "string") return res.status(400).json({error: "La descripción debe ser un texto"});
    const product = await productsService.createProduct({
      nombre, descripcion: descripcion === undefined ? undefined : (descripcion?.trim() || null), precio_venta, sucursales, stock_por_sucursal, sin_stock: sin_stock || false, precio_compra, codigo, stock_minimo_por_sucursal, imagen, landing: landing || false
    });
    res.status(201).json(product);
  } catch (error) { console.error("Error en createProduct:", error); res.status(500).json({error: error.message}); }
};
const updateProduct = async (req, res) => {
  try {
    const { nombre, descripcion, precio_venta, sucursales, stock_por_sucursal, sin_stock, precio_compra, codigo, stock_minimo_por_sucursal, imagen, landing } = req.body;
    if (!nombre || !precio_venta) return res.status(400).json({error: "Nombre y precio_venta son obligatorios"});
    if (!sucursales || !Array.isArray(sucursales) || sucursales.length === 0) return res.status(400).json({error: "Debe seleccionar al menos una sucursal"});
    if (parseFloat(precio_venta) <= 0) return res.status(400).json({error: "El precio de venta debe ser mayor a 0"});
    if (precio_compra !== undefined && precio_compra !== null && parseFloat(precio_compra) <= 0) return res.status(400).json({error: "El precio de compra debe ser mayor a 0"});
    if (descripcion !== undefined && descripcion !== null && typeof descripcion !== "string") return res.status(400).json({error: "La descripción debe ser un texto"});
    const product = await productsService.updateProduct(req.params.id, {
      nombre, descripcion: descripcion === undefined ? undefined : (descripcion?.trim() || null), precio_venta, sucursales, stock_por_sucursal, sin_stock: sin_stock || false, precio_compra, codigo, stock_minimo_por_sucursal, imagen, landing
    });
    res.json(product);
  } catch (error) { console.error("Error en updateProduct:", error); res.status(500).json({error: error.message}); }
};
const deleteProduct = async (req, res) => {
  try { await productsService.deleteProduct(req.params.id); res.status(204).send(); }
  catch (error) { console.error("Error en deleteProduct:", error); res.status(500).json({error: error.message}); }
};
const toggleProductStatus = async (req, res) => {
  try { const product = await productsService.toggleProductStatus(req.params.id); if (!product) return res.status(404).json({error: "Producto no encontrado"}); res.json(product); }
  catch (error) { console.error("Error en toggleProductStatus:", error); res.status(500).json({error: error.message}); }
};
const toggleProductLanding = async (req, res) => {
  try { const product = await productsService.toggleProductLanding(req.params.id); if (!product) return res.status(404).json({error: "Producto no encontrado"}); res.json(product); }
  catch (error) { console.error("Error en toggleProductLanding:", error); res.status(500).json({error: error.message}); }
};
const getProductStock = async (req, res) => {
  try { res.json(await productsService.getProductStock(req.params.id, req.query.sucursal)); }
  catch (error) { console.error("Error en getProductStock:", error); res.status(500).json({error: error.message}); }
};
const addStock = async (req, res) => {
  try {
    const { id } = req.params;
    const { sucursal_id, cantidad } = req.body;
    if (!sucursal_id) return res.status(400).json({error: "sucursal_id es obligatorio"});
    if (!cantidad || cantidad <= 0) return res.status(400).json({error: "cantidad debe ser mayor a 0"});
    const usuarioId = await resolveUsuarioId(req);
    if (!usuarioId) return res.status(401).json({error: "No se pudo identificar al usuario autenticado. Vuelve a iniciar sesión."});
    const result = await productsService.addStock(id, sucursal_id, cantidad, usuarioId);
    res.status(200).json({message: "Stock agregado correctamente", ...result});
  } catch (error) { console.error("Error en addStock:", error); res.status(500).json({error: error.message}); }
};
const getSucursales = async (req, res) => {
  try { res.json(await productsService.getSucursales()); }
  catch (error) { console.error("Error en getSucursales:", error); res.status(500).json({error: error.message}); }
};
module.exports = {getProducts, getProductById, createProduct, updateProduct, deleteProduct, toggleProductStatus, toggleProductLanding, getProductStock, addStock, getSucursales};
