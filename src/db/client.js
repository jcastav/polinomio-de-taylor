const { createClient } = require('@supabase/supabase-js');

let client = null;

// Cliente con service_role: SOLO se usa en el servidor (§5.4 del plan).
// Se crea perezosamente para no romper el arranque sin .env.
function sb() {
  if (!client) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      throw new Error(
        'Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY. Copia .env.example a .env y complétalo.'
      );
    }
    client = createClient(url, key, { auth: { persistSession: false } });
  }
  return client;
}

// Lanza si la respuesta trae error y devuelve los datos.
function unwrap(result) {
  if (result.error) {
    const err = new Error(result.error.message || 'Error de Supabase');
    err.code = result.error.code;
    throw err;
  }
  return result.data;
}

module.exports = { sb, unwrap };
