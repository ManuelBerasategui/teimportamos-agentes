// Las funciones "preparar..." (CREATE TABLE / ALTER TABLE) corrían enteras cada vez que Cloudflare arrancaba una copia
// nueva del worker: unas 1.700 veces por día, decenas de consultas cada vez (un tercio de todas las llamadas a D1).
// Ahora se guarda en kv una huella del código de cada función: si no cambió, se saltea con UNA sola lectura.
// La huella sale del texto de la función, así que al agregar una tabla o columna se vuelve a correr sola (no hay que acordarse de nada).
// Ojo: si se borra una tabla a mano en Cloudflare, hay que borrar también las filas "esquema:..." de kv para que se recree.
function huella(fn) { let h = 2166136261; for (const c of String(fn)) { h ^= c.codePointAt(0); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }

export async function esquemaAlDia(env, nombre, fn) {
  try { return (await env.DB.prepare("SELECT v FROM kv WHERE k=?").bind("esquema:" + nombre).first())?.v === huella(fn); }
  catch { return false; }   // todavía no existe ni la tabla kv
}
export function marcarEsquema(env, nombre, fn) {
  return env.DB.prepare("INSERT INTO kv (k,v,exp) VALUES (?,?,NULL) ON CONFLICT(k) DO UPDATE SET v=excluded.v, exp=NULL").bind("esquema:" + nombre, huella(fn)).run().catch(() => {});
}
// Para los ALTER TABLE ... ADD COLUMN: "ya existe" está bien; cualquier otro error (por ejemplo, la tabla todavía no existe) NO se da por hecho
export const columnaYaEsta = (e) => /duplicate column/i.test(String(e?.message || e));
