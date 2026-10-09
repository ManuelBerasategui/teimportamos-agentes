/**
 * Publicación de reels aprobados (Redes > Videos). SOLO publica videos con estado "aprobado" (los aprueba una
 * persona en el panel) cuya hora programada ya llegó. Los sube como REEL DE PRUEBA (le llega primero a gente que
 * no te sigue); si rinde bien, Instagram lo pasa solo a tus seguidores (graduation_strategy SS_PERFORMANCE).
 *
 * Instagram necesita bajar el video de un link público: el worker lo sirve en /v/<token>.mp4 con un token al azar
 * que solo existe mientras se publica. El bucket R2 sigue siendo privado.
 */

// Copia idéntica de cotizador/src/videos.js (la simulación verifica que sean iguales)
export const ESQUEMA_VIDEOS = [
  "CREATE TABLE IF NOT EXISTS ig_lotes (id TEXT PRIMARY KEY, ts INTEGER, quien TEXT, estado TEXT, clips TEXT, bytes INTEGER DEFAULT 0, intentos INTEGER DEFAULT 0, tomado_ts INTEGER, error TEXT)",
  "CREATE INDEX IF NOT EXISTS ig_lotes_estado ON ig_lotes(estado, ts)",
  "CREATE TABLE IF NOT EXISTS ig_videos (id TEXT PRIMARY KEY, lote TEXT, ts INTEGER, clave TEXT, portada TEXT, bytes INTEGER, duracion REAL, texto TEXT, transcripcion TEXT, caption TEXT, estado TEXT, programado_ts INTEGER, token TEXT, contenedor TEXT, media_id TEXT, link TEXT, error TEXT, aprobado_por TEXT, publicado_ts INTEGER, borrado INTEGER DEFAULT 0)",
  "CREATE INDEX IF NOT EXISTS ig_videos_estado ON ig_videos(estado, programado_ts)",
  "CREATE INDEX IF NOT EXISTS ig_videos_token ON ig_videos(token)",
];
export const BASE_PUBLICA = "https://instagram.berasateguimanuel07.workers.dev";
const dormir = (ms) => new Promise((ok) => setTimeout(ok, ms));
const listos = new WeakSet();
async function preparar(env) {
  if (listos.has(env.DB)) return;
  await env.DB.batch(ESQUEMA_VIDEOS.map((s) => env.DB.prepare(s)));
  listos.add(env.DB);
}
const tokenAzar = () => [...crypto.getRandomValues(new Uint8Array(24))].map((b) => b.toString(16).padStart(2, "0")).join("");

async function marcarError(env, v, msg, crearTarea) {
  await env.DB.prepare("UPDATE ig_videos SET estado='error', error=?, token=NULL WHERE id=?").bind(String(msg).slice(0, 400), v.id).run();
  if (crearTarea) await crearTarea(env, { tipo: "ig_revisar", tel: "ig:video", nombre: "Video de Instagram", titulo: "No se pudo publicar un reel", detalle: `${String(msg).slice(0, 300)}\n\nVolvé a aprobarlo desde Redes > Videos cuando esté resuelto.`, datos: {} }).catch(() => {});
}

// Revisa el contenedor; si está listo, publica. Devuelve el estado final de esta revisión.
async function terminar(env, ig, v, crearTarea) {
  const st = await ig(`/${v.contenedor}`, "GET", { fields: "status_code,status" });
  if (st.status_code === "FINISHED") {
    const pub = await ig("/me/media_publish", "POST", { creation_id: v.contenedor });
    let link = "";
    try { link = (await ig(`/${pub.id}`, "GET", { fields: "permalink" })).permalink || ""; } catch {}
    await env.DB.prepare("UPDATE ig_videos SET estado='publicado', media_id=?, link=?, publicado_ts=?, token=NULL WHERE id=?").bind(pub.id, link, Date.now(), v.id).run();
    return "publicado";
  }
  if (st.status_code === "ERROR" || st.status_code === "EXPIRED") { await marcarError(env, v, `Instagram rechazó el video: ${st.status || st.status_code}`, crearTarea); return "error"; }
  if (Date.now() - (v.programado_ts || 0) > 3 * 3600e3) { await marcarError(env, v, "Instagram no terminó de procesar el video en 3 horas", crearTarea); return "error"; }
  return "procesando";
}

export async function publicarPendientes(env, ig, { crearTarea, base = BASE_PUBLICA, esperas = 3, pausaMs = 20000 } = {}) {
  await preparar(env);
  const out = [];
  // 1) Los que ya se mandaron a Instagram y están procesando
  for (const v of (await env.DB.prepare("SELECT * FROM ig_videos WHERE estado='publicando' AND contenedor IS NOT NULL ORDER BY programado_ts LIMIT 3").all()).results || []) {
    try { out.push({ id: v.id, estado: await terminar(env, ig, v, crearTarea) }); } catch (e) { out.push({ id: v.id, estado: "reintenta", error: e.message }); }
  }
  // 2) Uno nuevo por vuelta: el aprobado más viejo cuya hora ya llegó
  const v = await env.DB.prepare("SELECT * FROM ig_videos WHERE estado='aprobado' AND programado_ts <= ? AND borrado=0 ORDER BY programado_ts LIMIT 1").bind(Date.now()).first();
  if (!v) return out;
  const token = tokenAzar();
  await env.DB.prepare("UPDATE ig_videos SET estado='publicando', token=? WHERE id=? AND estado='aprobado'").bind(token, v.id).run();
  let cont;
  try {
    cont = await ig("/me/media", "POST", { media_type: "REELS", video_url: `${base}/v/${token}.mp4`, caption: v.caption || "", trial_params: JSON.stringify({ graduation_strategy: "SS_PERFORMANCE" }) });
  } catch (e) {
    const permiso = /permission|\(#10\)|\(#200\)|scope/i.test(e.message);
    await marcarError(env, v, permiso ? "Al token de Instagram le falta el permiso instagram_business_content_publish (ver pasos en Redes > Videos)" : e.message, crearTarea);
    out.push({ id: v.id, estado: "error", error: e.message });
    return out;
  }
  await env.DB.prepare("UPDATE ig_videos SET contenedor=? WHERE id=?").bind(cont.id, v.id).run();
  const w = { ...v, contenedor: cont.id, token };
  let estado = "procesando";
  for (let i = 0; i < esperas && estado === "procesando"; i++) {
    await dormir(pausaMs);
    try { estado = await terminar(env, ig, w, crearTarea); } catch (e) { estado = "procesando"; }
  }
  out.push({ id: v.id, estado });
  return out;
}

// GET /v/<token>.mp4 → el video, solo mientras se está publicando (Instagram lo baja de acá)
export async function servirParaInstagram(env, req, token) {
  if (!/^[0-9a-f]{48}$/.test(token) || !env.VIDEOS) return new Response("No encontrado", { status: 404 });
  await preparar(env);
  const v = await env.DB.prepare("SELECT clave FROM ig_videos WHERE token=? AND estado='publicando'").bind(token).first();
  if (!v) return new Response("No encontrado", { status: 404 });
  const cab = await env.VIDEOS.head(v.clave);
  if (!cab) return new Response("No encontrado", { status: 404 });
  const h = { "Content-Type": "video/mp4", "Accept-Ranges": "bytes", "Cache-Control": "no-store" };
  const m = (req.headers.get("range") || "").match(/bytes=(\d+)-(\d*)/);
  if (m) {
    const ini = +m[1], fin = m[2] ? Math.min(+m[2], cab.size - 1) : cab.size - 1;
    if (ini >= cab.size) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${cab.size}` } });
    const o = await env.VIDEOS.get(v.clave, { range: { offset: ini, length: fin - ini + 1 } });
    return new Response(o.body, { status: 206, headers: { ...h, "Content-Range": `bytes ${ini}-${fin}/${cab.size}`, "Content-Length": String(fin - ini + 1) } });
  }
  if (req.method === "HEAD") return new Response(null, { headers: { ...h, "Content-Length": String(cab.size) } });
  const o = await env.VIDEOS.get(v.clave);
  return new Response(o.body, { headers: { ...h, "Content-Length": String(cab.size) } });
}
