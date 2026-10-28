// Fecha de hoy como texto 'YYYY-MM-DD' (hora local del servidor)
function hoy() {
  const d = new Date();
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mes}-${dia}`;
}

// Valida que el texto sea una fecha real con formato YYYY-MM-DD
function esFecha(texto) {
  if (typeof texto !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(texto)) return false;
  const d = new Date(texto + 'T00:00:00Z');
  return !isNaN(d) && d.toISOString().slice(0, 10) === texto;
}

// Cantidad de noches entre dos fechas
function noches(entrada, salida) {
  return Math.round(
    (Date.parse(salida + 'T00:00:00Z') - Date.parse(entrada + 'T00:00:00Z')) / 86400000
  );
}

// Error esperado por reglas del negocio: su mensaje se muestra al usuario
class ErrorNegocio extends Error {}

module.exports = { hoy, esFecha, noches, ErrorNegocio };