/**
 * Sincronización de Instagram → D1 (solo LECTURA de la API oficial; no publica ni manda nada).
 *
 * - Publicaciones con sus métricas (tabla ig_posts), de a 20 por vuelta. La primera vez recorre todo el historial.
 * - Datos de la cuenta: 7 días, 7 anteriores, 30 días y seguidores nuevos por día (kv "ig_cuenta").
 * - DMs: última charla con cada persona y si la última palabra fue nuestra o del cliente (tabla ig_dms).
 * - Formato de cada reel nuevo: Gemini mira la portada y elige el formato (historia, reacción, etc.).
 *
 * Cloudflare gratis permite ~50 consultas externas por ejecución: todo pasa por un contador con tope.
 */

// Copia idéntica en cotizador/src/redes.js (la simulación verifica que sean iguales)
export const ESQUEMA_IG = [
  "CREATE TABLE IF NOT EXISTS ig_posts (id TEXT PRIMARY KEY, ts INTEGER, tipo TEXT, media TEXT, en_feed INTEGER, link TEXT, portada TEXT, texto TEXT, formato TEXT, gancho TEXT, alcance INTEGER, vistas INTEGER, guardados INTEGER, compartidos INTEGER, comentarios INTEGER, likes INTEGER, seguidores INTEGER, visitas INTEGER, tiempo_ms INTEGER, actualizado INTEGER)",
  "CREATE INDEX IF NOT EXISTS ig_posts_ts ON ig_posts(ts)",
  "CREATE TABLE IF NOT EXISTS ig_dms (conv TEXT PRIMARY KEY, usuario TEXT, usuario_id TEXT, ult_texto TEXT, ult_ts INTEGER, ult_yo INTEGER, actualizado INTEGER)",
  "CREATE INDEX IF NOT EXISTS ig_dms_pend ON ig_dms(ult_yo, ult_ts)",
];

export const FORMATOS = {
  historia: "Historia de cliente a cámara",
  reaccion: "Reacción con cara tapada (no lo puedo creer)",
  ml_vendi: "Vendí esto por Mercado Libre, ¿cuánto me quedó?",
  ml_vs_china: "ML vs China / buscando cosas de ML en China",
  producto: "Producto en mano mostrando qué es",
  pantalla: "Pantalla, web o calculadora",
  chatgpt: "Carteles o respuestas de ChatGPT",
  cronometro: "Cronómetro (horas buscando)",
  comentario: "Respuesta a un comentario",
  otro: "Otro",
};

const DIA = 86400;
const M_CUENTA = ["reach", "views", "accounts_engaged", "total_interactions", "likes", "comments", "saves", "shares", "profile_links_taps"];
const M_FEED = ["reach", "views", "saved", "shares", "likes", "comments", "total_interactions", "profile_visits", "follows"];
const M_REEL = ["reach", "views", "saved", "shares", "likes", "comments", "total_interactions", "ig_reels_avg_watch_time"];
const M_BASE = ["reach", "saved", "shares", "likes", "comments"];
export const SYNC = { porPagina: 20, diasRefrescar: 45, tope: 42, clasificarPorVuelta: 3 };
const esPermiso = (m = "") => /permission|permiso|scope|\(#10\)|\(#200\)|\(#3\)|OAuth/i.test(m);

// Envuelve la función ig() con un tope de consultas por ejecución
export function conTope(ig, tope = SYNC.tope) {
  let n = 0;
  const f = async (...a) => { if (++n > tope) throw new Error("TOPE_CONSULTAS"); return ig(...a); };
  f.usadas = () => n;
  f.sumar = (k = 1) => { n += k; };
  return f;
}

function aplanar(data = []) {
  const o = {};
  for (const d of data) {
    if (d.total_value) o[d.name] = d.total_value.value;
    else if (d.values) o[d.name] = d.values.length === 1 ? d.values[0].value : d.values.map((v) => ({ fecha: v.end_time?.slice(0, 10), valor: v.value }));
  }
  return o;
}

const kvGet = async (env, k) => (await env.DB.prepare("SELECT v FROM kv WHERE k = ?").bind(k).first())?.v ?? null;
const kvPut = (env, k, v) => env.DB.prepare("INSERT INTO kv (k, v, exp) VALUES (?, ?, NULL) ON CONFLICT(k) DO UPDATE SET v = excluded.v").bind(k, String(v)).run();
const preparado = new WeakSet();
export async function prepararSync(env) {
  if (preparado.has(env.DB)) return;
  await env.DB.batch([env.DB.prepare("CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT, exp INTEGER)"), ...ESQUEMA_IG.map((s) => env.DB.prepare(s))]);
  preparado.add(env.DB);
}

export async function yo(env, ig, refrescar = false) {
  const g = !refrescar && (await kvGet(env, "ig_yo"));
  if (g) return JSON.parse(g);
  let r;
  try { r = await ig("/me", "GET", { fields: "user_id,username,followers_count,media_count,profile_picture_url" }); }
  catch (e) { if (e.message === "TOPE_CONSULTAS") throw e; r = await ig("/me", "GET", { fields: "user_id,username,followers_count,media_count" }); }
  const y = { id: String(r.user_id || r.id), username: r.username, seguidores: r.followers_count ?? null, publicaciones: r.media_count ?? null, foto: r.profile_picture_url || null };
  await kvPut(env, "ig_yo", JSON.stringify(y));
  return y;
}

// ---------- Cuenta ----------
export async function syncCuenta(env, ig, ahora = Math.floor(Date.now() / 1000)) {
  const perfil = await yo(env, ig, true);
  const ventana = async (desde, hasta) => {
    try { return aplanar((await ig("/me/insights", "GET", { metric: M_CUENTA.join(","), period: "day", metric_type: "total_value", since: String(desde), until: String(hasta) })).data); }
    catch (e) { if (esPermiso(e.message)) throw e; return { error: e.message }; }
  };
  const c = { ts: Date.now(), perfil };
  c.d7 = await ventana(ahora - 7 * DIA, ahora);
  c.d7ant = await ventana(ahora - 14 * DIA, ahora - 7 * DIA);
  c.d30 = await ventana(ahora - 30 * DIA, ahora);
  try { c.seguidores_dia = aplanar((await ig("/me/insights", "GET", { metric: "follower_count", period: "day", since: String(ahora - 30 * DIA), until: String(ahora) })).data).follower_count || []; }
  catch (e) { c.seguidores_dia = []; }
  await kvPut(env, "ig_cuenta", JSON.stringify(c));
  return c;
}

// ---------- Publicaciones ----------
let fallaCompleto = { REELS: false, FEED: false };
async function insightsDe(ig, m, tipo) {
  const completo = tipo === "REELS" ? M_REEL : M_FEED;
  for (const s of fallaCompleto[tipo] ? [M_BASE] : [completo, M_BASE]) {
    try { return aplanar((await ig(`/${m.id}/insights`, "GET", { metric: s.join(",") })).data); }
    catch (e) { if (esPermiso(e.message) || e.message === "TOPE_CONSULTAS") throw e; if (s === completo) fallaCompleto[tipo] = true; }
  }
  return null;
}

export async function syncPosts(env, ig, iniciales = {}) {
  const after = (await kvGet(env, "ig_sync_after")) || "";
  const historialListo = (await kvGet(env, "ig_sync_historial")) === "si";
  const campos = "id,caption,media_type,media_product_type,permalink,timestamp,like_count,comments_count,thumbnail_url,media_url";
  const p = { fields: campos + ",is_shared_to_feed", limit: String(SYNC.porPagina) };
  if (after) p.after = after;
  let lista;
  try { lista = await ig("/me/media", "GET", p); }
  catch (e) { if (esPermiso(e.message) || e.message === "TOPE_CONSULTAS") throw e; lista = await ig("/me/media", "GET", { ...p, fields: campos }); }
  const items = lista.data || [];
  const ids = items.map((m) => m.id);
  const ya = new Map();
  if (ids.length) for (const r of (await env.DB.prepare(`SELECT id, actualizado FROM ig_posts WHERE id IN (${ids.map(() => "?").join(",")})`).bind(...ids).all()).results || []) ya.set(r.id, r.actualizado);
  const limite = Date.now() - SYNC.diasRefrescar * 86400e3;
  const filas = [];
  let masViejo = Date.now(), cortado = false;
  for (const m of items) {
    const ts = Date.parse(m.timestamp) || 0;
    masViejo = Math.min(masViejo, ts);
    const tipo = m.media_product_type === "REELS" ? "REELS" : m.media_product_type === "STORY" ? "STORY" : "FEED";
    let ins = null;
    // Lo viejo ya guardado no cambia: no se gasta consulta
    if (tipo !== "STORY" && !(ya.get(m.id) && ts < limite)) {
      try { ins = await insightsDe(ig, m, tipo); }
      catch (e) { if (e.message === "TOPE_CONSULTAS") { cortado = true; break; } throw e; }
    }
    filas.push({ m, ts, tipo, ins });
  }
  const st = filas.map(({ m, ts, tipo, ins }) => env.DB.prepare(
    `INSERT INTO ig_posts (id, ts, tipo, media, en_feed, link, portada, texto, formato, alcance, vistas, guardados, compartidos, comentarios, likes, seguidores, visitas, tiempo_ms, actualizado)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET formato = COALESCE(ig_posts.formato, excluded.formato), en_feed = COALESCE(excluded.en_feed, ig_posts.en_feed), portada = COALESCE(excluded.portada, ig_posts.portada), texto = excluded.texto,
       alcance = COALESCE(excluded.alcance, ig_posts.alcance), vistas = COALESCE(excluded.vistas, ig_posts.vistas), guardados = COALESCE(excluded.guardados, ig_posts.guardados),
       compartidos = COALESCE(excluded.compartidos, ig_posts.compartidos), comentarios = COALESCE(excluded.comentarios, ig_posts.comentarios), likes = COALESCE(excluded.likes, ig_posts.likes),
       seguidores = COALESCE(excluded.seguidores, ig_posts.seguidores), visitas = COALESCE(excluded.visitas, ig_posts.visitas), tiempo_ms = COALESCE(excluded.tiempo_ms, ig_posts.tiempo_ms),
       actualizado = COALESCE(excluded.actualizado, ig_posts.actualizado)`
  ).bind(m.id, ts, tipo, m.media_type || "", m.is_shared_to_feed == null ? null : m.is_shared_to_feed ? 1 : 0, m.permalink || "", m.thumbnail_url || (m.media_type === "IMAGE" ? m.media_url : null) || null,
    String(m.caption || "").slice(0, 600), iniciales[m.id] || null,
    ins?.reach ?? null, ins?.views ?? null, ins?.saved ?? null, ins?.shares ?? null, ins?.comments ?? m.comments_count ?? null, ins?.likes ?? m.like_count ?? null,
    ins?.follows ?? null, ins?.profile_visits ?? null, ins?.ig_reels_avg_watch_time ?? null, ins ? Date.now() : null));
  if (st.length) await env.DB.batch(st);
  // Próxima página: seguir mientras haya historial por recorrer o publicaciones recientes; si no, volver a empezar por lo más nuevo
  const sigue = lista.paging?.next && lista.paging?.cursors?.after;
  let proximo = "";
  if (cortado) proximo = after;   // se cortó por el tope: se repite esta página
  else if (sigue && (!historialListo || masViejo > limite)) proximo = lista.paging.cursors.after;
  if (!sigue && !cortado) await kvPut(env, "ig_sync_historial", "si");
  await kvPut(env, "ig_sync_after", proximo);
  return { leidas: items.length, guardadas: filas.length, conMetricas: filas.filter((f) => f.ins).length, proximo, cortado };
}

// ---------- DMs ----------
export async function syncDMs(env, ig, { reintentoUnoPorUno = true } = {}) {
  const y = await yo(env, ig);
  let convs = [];
  try {
    const r = await ig("/me/conversations", "GET", { platform: "instagram", fields: "id,updated_time,participants,messages.limit(1){id,from,to,message,created_time}", limit: "50" });
    convs = r.data || [];
  } catch (e) {
    if (esPermiso(e.message)) { await kvPut(env, "ig_dms_error", e.message); return { ok: false, error: e.message }; }
    if (!reintentoUnoPorUno || e.message === "TOPE_CONSULTAS") return { ok: false, error: e.message };
    // Sin expansión de campos: lista y después el último mensaje de cada charla (hasta 20)
    const r = await ig("/me/conversations", "GET", { platform: "instagram", fields: "id,updated_time,participants", limit: "20" });
    for (const c of r.data || []) {
      try { const d = await ig(`/${c.id}`, "GET", { fields: "messages.limit(1){id,from,to,message,created_time}" }); convs.push({ ...c, messages: d.messages }); }
      catch (e2) { if (e2.message === "TOPE_CONSULTAS") break; }
    }
  }
  const esYo = (u) => u && (String(u.id) === y.id || (u.username && u.username === y.username));
  const st = [];
  for (const c of convs) {
    const msg = c.messages?.data?.[0];
    const otro = (c.participants?.data || []).find((u) => !esYo(u)) || (msg && !esYo(msg.from) ? msg.from : msg?.to?.data?.[0]) || {};
    if (!msg) continue;
    st.push(env.DB.prepare("INSERT INTO ig_dms (conv, usuario, usuario_id, ult_texto, ult_ts, ult_yo, actualizado) VALUES (?,?,?,?,?,?,?) ON CONFLICT(conv) DO UPDATE SET usuario = excluded.usuario, usuario_id = excluded.usuario_id, ult_texto = excluded.ult_texto, ult_ts = excluded.ult_ts, ult_yo = excluded.ult_yo, actualizado = excluded.actualizado")
      .bind(c.id, otro.username || "", String(otro.id || ""), String(msg.message || "[foto, video o audio]").slice(0, 400), Date.parse(msg.created_time || c.updated_time) || Date.now(), esYo(msg.from) ? 1 : 0, Date.now()));
  }
  if (st.length) await env.DB.batch(st);
  await kvPut(env, "ig_dms_error", "");
  await kvPut(env, "ig_dms_sync", Date.now());
  return { ok: true, charlas: st.length, pendientes: st.length ? (await env.DB.prepare("SELECT COUNT(*) n FROM ig_dms WHERE ult_yo = 0 AND ult_ts > ?").bind(Date.now() - 30 * 86400e3).first()).n : 0 };
}

// ---------- Formato de cada reel (Gemini mira la portada) ----------
export async function clasificar(env, ig, iaImagen, maximo = SYNC.clasificarPorVuelta) {
  const pend = (await env.DB.prepare("SELECT id, portada, texto FROM ig_posts WHERE tipo = 'REELS' AND formato IS NULL AND portada IS NOT NULL AND ts > ? ORDER BY ts DESC LIMIT ?").bind(Date.now() - 90 * 86400e3, maximo).all()).results || [];
  let n = 0;
  for (const p of pend) {
    if (ig.usadas() + 3 > SYNC.tope) break;
    ig.sumar(3);   // portada + hasta 2 intentos de Gemini
    const img = await fetch(p.portada).then(async (r) => (r.ok ? { tipo: r.headers.get("content-type") || "image/jpeg", datos: await r.arrayBuffer() } : null)).catch(() => null);
    if (!img) { await env.DB.prepare("UPDATE ig_posts SET formato = 'otro' WHERE id = ?").bind(p.id).run(); continue; }
    const r = await iaImagen(env, `Esta es la portada (primer cuadro) de un reel de "Te Importamos", una cuenta de importación por encargo de Argentina. Texto del posteo: "${String(p.texto || "").slice(0, 200)}".
Elegí UN formato: ${Object.entries(FORMATOS).map(([k, v]) => `"${k}" = ${v}`).join("; ")}.
Pistas: "historia" = persona a cámara contando algo que le pasó con un cliente; "reaccion" = persona tapándose la cara o sorprendida con texto tipo "no lo puedo creer"; "ml_vendi" = producto en mano con texto "vendí esto por Mercado Libre"; "pantalla" = arranca mostrando una pantalla.
Copiá también el texto grande que se lee arriba (el gancho), tal cual.
Respondé SOLO JSON: {"formato":"clave","gancho":"texto o vacío"}`, img);
    if (!r) break;   // Gemini no respondió (ej. cupo agotado): queda sin clasificar para la próxima vuelta
    const f = FORMATOS[r.formato] ? r.formato : "otro";
    await env.DB.prepare("UPDATE ig_posts SET formato = ?, gancho = ? WHERE id = ?").bind(f, String(r.gancho || "").slice(0, 160), p.id).run();
    n++;
  }
  return n;
}

// Una vuelta completa (cron cada 2 horas o botón del panel)
export async function syncCompleto(env, igBase, iaImagen, iniciales = {}) {
  await prepararSync(env);
  const ig = conTope(igBase);
  const out = {};
  try { out.cuenta = !!(await syncCuenta(env, ig)); } catch (e) { out.cuenta = e.message; }
  try { out.posts = await syncPosts(env, ig, iniciales); } catch (e) { out.posts = e.message; }
  try { out.dms = await syncDMs(env, ig); } catch (e) { out.dms = e.message; }
  try { out.clasificados = await clasificar(env, ig, iaImagen); } catch (e) { out.clasificados = e.message; }
  out.consultas = ig.usadas();
  await kvPut(env, "ig_sync_ts", Date.now());
  return out;
}
