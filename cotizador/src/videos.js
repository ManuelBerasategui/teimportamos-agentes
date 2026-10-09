// Creador de videos (pestaña Redes > Videos).
// 1) Subís clips desde el panel → se guardan en R2 (bucket teimportamos-videos, privado).
// 2) GitHub Actions (tools/editor/editar.py) los edita: corta silencios y tomas repetidas, subtítulos, gancho, 9:16.
// 3) Los revisás en el panel y aprobás → el worker de Instagram los publica como reel de prueba a las 19 h.
// Nada se publica sin aprobación. Tope de espacio: 8 GB (R2 gratis llega a 10 GB); se borra todo lo que ya no sirve.
import { telegram } from "./lector.js";

// Copia idéntica en instagram/src/publicar.js (la simulación verifica que sean iguales)
export const ESQUEMA_VIDEOS = [
  "CREATE TABLE IF NOT EXISTS ig_lotes (id TEXT PRIMARY KEY, ts INTEGER, quien TEXT, estado TEXT, clips TEXT, bytes INTEGER DEFAULT 0, intentos INTEGER DEFAULT 0, tomado_ts INTEGER, error TEXT)",
  "CREATE INDEX IF NOT EXISTS ig_lotes_estado ON ig_lotes(estado, ts)",
  "CREATE TABLE IF NOT EXISTS ig_videos (id TEXT PRIMARY KEY, lote TEXT, ts INTEGER, clave TEXT, portada TEXT, bytes INTEGER, duracion REAL, texto TEXT, transcripcion TEXT, caption TEXT, estado TEXT, programado_ts INTEGER, token TEXT, contenedor TEXT, media_id TEXT, link TEXT, error TEXT, aprobado_por TEXT, publicado_ts INTEGER, borrado INTEGER DEFAULT 0)",
  "CREATE INDEX IF NOT EXISTS ig_videos_estado ON ig_videos(estado, programado_ts)",
  "CREATE INDEX IF NOT EXISTS ig_videos_token ON ig_videos(token)",
];
export const VIDEOS = {
  tope: 8 * 1024 ** 3,          // nunca pasar de 8 GB guardados (R2 gratis: 10 GB)
  maxClip: 1024 ** 3,           // 1 GB por clip
  maxClips: 12,                 // clips por lote
  maxVideos: 6,                 // combinaciones gancho × cuerpo por lote
  parte: 20 * 1024 ** 2,        // subida en partes de 20 MB (Cloudflare acepta hasta 100 MB por pedido)
  horaAR: 19,                   // publicación a las 19 h (Argentina)
  borrarPublicadosDias: 3,      // el archivo final se borra 3 días después de publicado (queda el link)
  vencerRevisionDias: 21,       // si nadie lo revisa en 21 días, se borra
};
const AR = 3 * 3600e3;
const CTA = "Escribime al DM o al WhatsApp 341 805-1515";
const PROHIBIDO = /\b(vapes?|vapers?|vapeador|pods? desechables?|tabaco|nicotina|medicamentos?|f[aá]rmacos?|drogas?|armas?|r[eé]plicas?)\b/i;
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
const nuevoId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const kvGet = async (env, k) => (await env.DB.prepare("SELECT v FROM kv WHERE k=?").bind(k).first())?.v ?? null;
const kvPut = (env, k, v) => env.DB.prepare("INSERT INTO kv (k,v,exp) VALUES (?,?,NULL) ON CONFLICT(k) DO UPDATE SET v=excluded.v, exp=NULL").bind(k, String(v)).run();
const gb = (b) => (b / 1024 ** 3).toFixed(2).replace(".", ",") + " GB";

const listos = new WeakSet();
export async function prepararVideos(env) {
  if (listos.has(env.DB)) return;
  await env.DB.batch(["CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT, exp INTEGER)", ...ESQUEMA_VIDEOS].map((s) => env.DB.prepare(s)));
  listos.add(env.DB);
}

// ---------- Espacio usado (se mide en R2 de verdad, no se estima) ----------
export async function espacioUsado(env, forzar = false) {
  const c = JSON.parse((await kvGet(env, "videos_bytes")) || "null");
  if (!forzar && c && Date.now() - c.ts < 5 * 60e3) return c.bytes;
  let total = 0, cursor;
  do {
    const l = await env.VIDEOS.list({ cursor, limit: 1000 });
    for (const o of l.objects) total += o.size;
    cursor = l.truncated ? l.cursor : undefined;
  } while (cursor);
  // lo que se está subiendo todavía no aparece en la lista: se reserva
  const reservado = (await env.DB.prepare("SELECT COALESCE(SUM(bytes),0) b FROM ig_lotes WHERE estado='subiendo'").first())?.b || 0;
  await kvPut(env, "videos_bytes", JSON.stringify({ ts: Date.now(), bytes: total + reservado }));
  return total + reservado;
}
const sumarUsado = async (env, b) => { const c = JSON.parse((await kvGet(env, "videos_bytes")) || "null"); if (c) await kvPut(env, "videos_bytes", JSON.stringify({ ts: c.ts, bytes: Math.max(0, c.bytes + b) })); };

// ---------- Próximo horario libre (uno por día a las 19 h) ----------
export async function proximoHorario(env, ahora = Date.now()) {
  const ocupados = new Set(((await env.DB.prepare("SELECT programado_ts FROM ig_videos WHERE estado IN ('aprobado','publicando','publicado') AND programado_ts >= ?").bind(ahora - 86400e3).all()).results || [])
    .map((x) => new Date(x.programado_ts - AR).toISOString().slice(0, 10)));
  const d = new Date(ahora - AR);
  let dia = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  if (d.getUTCHours() * 60 + d.getUTCMinutes() > VIDEOS.horaAR * 60 - 15) dia += 86400e3;   // si ya pasaron las 18:45, mañana
  for (let i = 0; i < 365; i++, dia += 86400e3) {
    const k = new Date(dia).toISOString().slice(0, 10);
    if (!ocupados.has(k)) return dia + VIDEOS.horaAR * 3600e3 + AR;
  }
  return null;
}

// ---------- Borrar lo que ya no sirve ----------
async function borrarObjetos(env, claves) {
  const ks = claves.filter(Boolean);
  if (!ks.length) return;
  for (let i = 0; i < ks.length; i += 900) await env.VIDEOS.delete(ks.slice(i, i + 900));
}
async function cancelarLote(env, l, estado = "cancelado") {
  const clips = JSON.parse(l.clips || "[]");
  for (const c of clips) if (c.uploadId && !c.subido) await env.VIDEOS.resumeMultipartUpload(c.key, c.uploadId).abort().catch(() => {});
  await borrarObjetos(env, clips.map((c) => c.key));
  await env.DB.prepare("UPDATE ig_lotes SET estado=?, bytes=0 WHERE id=?").bind(estado, l.id).run();
}
export async function limpiezaVideos(env, ahora = Date.now()) {
  await prepararVideos(env);
  let n = 0;
  for (const l of (await env.DB.prepare("SELECT * FROM ig_lotes WHERE estado='subiendo' AND ts < ?").bind(ahora - 24 * 3600e3).all()).results || []) { await cancelarLote(env, l); n++; }
  for (const l of (await env.DB.prepare("SELECT * FROM ig_lotes WHERE estado IN ('error','cancelado','hecho') AND bytes > 0").all()).results || []) { await cancelarLote(env, l, l.estado); n++; }
  const viejos = (await env.DB.prepare("SELECT id, clave, portada FROM ig_videos WHERE borrado=0 AND ((estado='publicado' AND publicado_ts < ?) OR estado='descartado' OR (estado='revision' AND ts < ?))")
    .bind(ahora - VIDEOS.borrarPublicadosDias * 86400e3, ahora - VIDEOS.vencerRevisionDias * 86400e3).all()).results || [];
  if (viejos.length) {
    await borrarObjetos(env, viejos.flatMap((v) => [v.clave, v.portada]));
    await env.DB.batch(viejos.map((v) => env.DB.prepare("UPDATE ig_videos SET borrado=1, estado=CASE WHEN estado='revision' THEN 'vencido' ELSE estado END WHERE id=?").bind(v.id)));
    n += viejos.length;
  }
  const usado = await espacioUsado(env, true);
  if (usado > VIDEOS.tope * 0.9) await telegram(env, `⚠️ Videos: hay ${gb(usado)} guardados (tope ${gb(VIDEOS.tope)}). Revisá y aprobá o descartá los que esperan en Redes > Videos.`).catch(() => {});
  return { limpiados: n, usado };
}

// ---------- Decidir cortes, combinaciones y textos (lo pide el editor de GitHub) ----------
export function combinaciones(clips) {
  const g = clips.filter((c) => c.tipo === "gancho"), cu = clips.filter((c) => c.tipo === "cuerpo"), co = clips.filter((c) => c.tipo === "completo" || !["gancho", "cuerpo"].includes(c.tipo));
  const out = co.map((c) => [c.n]);
  if (cu.length) for (const c of cu) { if (g.length) for (const x of g) out.push([x.n, c.n]); else out.push([c.n]); }
  else for (const x of g) out.push([x.n]);
  return out.slice(0, VIDEOS.maxVideos);
}
export async function decidir(env, iaJSON, body) {
  const clips = (body.clips || []).map((c) => ({ n: +c.n, tipo: c.tipo, frases: (c.frases || []).slice(0, 200).map((f) => ({ i: +f.i, texto: String(f.texto || "").slice(0, 300) })) }));
  const combos = combinaciones(clips);
  const r = await iaJSON(env, `Sos el editor de reels de "Te Importamos" (importación por encargo, Rosario). Te paso la transcripción de clips grabados a cámara, frase por frase.
1) Para cada clip, decidí qué frases quedan. Regla: si una frase se repite (entera o empezada y cortada) porque se volvió a grabar, quedate SOLO con la última versión completa. Sacá frases que sean solo muletillas ("eh", "bueno", "a ver") o pruebas ("¿se escucha?", "arranco"). No saques nada que no esté repetido. No cambies el orden.
2) Para cada video (combinación de clips), escribí:
- "texto": el texto que va arriba en pantalla todo el video, de 3 a 7 palabras, en minúscula, como hablan en Rosario, que obligue a quedarse (ej: "es tremendo esto", "no me quedó nada"). Sin emojis. Sin precios.
- "caption": 1 o 2 frases cortas sobre el video + "${CTA}" + 3 hashtags (#importaciones #pormayor #proveedores u otros del tema). Sin precios, sin prometer ganancias, sin "tenemos stock".
CLIPS:
${clips.map((c) => `Clip ${c.n} (${c.tipo}):\n${c.frases.map((f) => `  [${f.i}] ${f.texto}`).join("\n")}`).join("\n")}
VIDEOS: ${combos.map((p, j) => `video ${j} = clips ${p.join(" + ")}`).join("; ")}
Respondé SOLO JSON: {"clips":[{"n":0,"mantener":[0,2]}],"videos":[{"j":0,"texto":"...","caption":"..."}]}`).catch(() => null);
  const mantener = new Map((r?.clips || []).map((c) => [+c.n, (c.mantener || []).map(Number)]));
  const textos = new Map((r?.videos || []).map((v) => [+v.j, v]));
  const primeras = (n) => (clips.find((c) => c.n === n)?.frases || []).map((f) => f.texto).join(" ").split(/\s+/).slice(0, 6).join(" ").toLowerCase().replace(/[.,!?¿¡]/g, "");
  return {
    clips: clips.map((c) => ({ n: c.n, mantener: (mantener.get(c.n) || []).filter((i) => c.frases.some((f) => f.i === i)).length ? mantener.get(c.n) : c.frases.map((f) => f.i) })),
    videos: combos.map((partes, j) => {
      const t = textos.get(j) || {};
      let texto = String(t.texto || "").slice(0, 60), caption = String(t.caption || "").slice(0, 1500);
      if (!texto || PROHIBIDO.test(texto)) texto = primeras(partes[0]);
      if (!caption || PROHIBIDO.test(caption)) caption = `${CTA}\n#importaciones #pormayor #proveedores`;
      else if (!/805|dm/i.test(caption)) caption += `\n${CTA}`;
      return { j, partes, texto, caption };
    }),
  };
}

// ---------- Rutas para el editor de GitHub (/videos/..., con encabezado x-clave) ----------
export async function rutaVideosEditor(env, req, url, iaJSON, base = "") {
  if (!env.VIDEOS) return json({ error: "Falta el bucket VIDEOS en este worker" }, 500);
  if ((req.headers.get("x-clave") || "") !== env.VERIFY_TOKEN || !env.VERIFY_TOKEN) return json({ error: "clave incorrecta" }, 401);
  await prepararVideos(env);
  const r = url.pathname.replace("/videos/", "");
  const vencido = Date.now() - 45 * 60e3;
  if (r === "hay") return json({ n: (await env.DB.prepare("SELECT COUNT(*) n FROM ig_lotes WHERE (estado='en_cola' OR (estado='procesando' AND tomado_ts < ?)) AND intentos < 3").bind(vencido).first()).n });
  if (r === "trabajo") {
    const l = await env.DB.prepare("SELECT * FROM ig_lotes WHERE (estado='en_cola' OR (estado='procesando' AND tomado_ts < ?)) AND intentos < 3 ORDER BY ts LIMIT 1").bind(vencido).first();
    if (!l) return json({});
    await env.DB.prepare("UPDATE ig_lotes SET estado='procesando', tomado_ts=?, intentos=intentos+1 WHERE id=?").bind(Date.now(), l.id).run();
    return json({ lote: l.id, clips: JSON.parse(l.clips).map((c) => ({ n: c.n, tipo: c.tipo, nombre: c.nombre, url: "/videos/archivo?key=" + encodeURIComponent(c.key) })) });
  }
  if (r === "archivo") {
    const key = url.searchParams.get("key") || "";
    if (!key.startsWith("lotes/")) return json({ error: "clave de archivo inválida" }, 400);
    const o = await env.VIDEOS.get(key);
    if (!o) return json({ error: "no existe" }, 404);
    return new Response(o.body, { headers: { "Content-Type": o.httpMetadata?.contentType || "application/octet-stream", "Content-Length": String(o.size) } });
  }
  if (r === "decidir" && req.method === "POST") return json(await decidir(env, iaJSON, await req.json()));
  if (r === "resultado" && req.method === "PUT") {
    const lote = url.searchParams.get("lote") || "", j = +url.searchParams.get("j") || 0, tipo = url.searchParams.get("tipo") === "jpg" ? "jpg" : "mp4";
    const l = await env.DB.prepare("SELECT id FROM ig_lotes WHERE id=? AND estado='procesando'").bind(lote).first();
    if (!l) return json({ error: "lote no está en edición" }, 400);
    const largo = +req.headers.get("content-length") || 0;
    if (largo > 95 * 1024 ** 2) return json({ error: "video final demasiado grande" }, 413);
    if ((await espacioUsado(env)) + largo > VIDEOS.tope + 1024 ** 3) return json({ error: "sin espacio" }, 507);   // el editor puede usar 1 GB del margen
    const key = `final/${lote}-${j}.${tipo}`;
    await env.VIDEOS.put(key, req.body, { httpMetadata: { contentType: tipo === "jpg" ? "image/jpeg" : "video/mp4" } });
    await sumarUsado(env, largo);
    return json({ key });
  }
  if (r === "fin" && req.method === "POST") {
    const b = await req.json();
    const l = await env.DB.prepare("SELECT * FROM ig_lotes WHERE id=?").bind(String(b.lote || "")).first();
    if (!l) return json({ error: "lote desconocido" }, 404);
    const vs = (b.videos || []).filter((v) => String(v.key || "").startsWith(`final/${l.id}-`)).slice(0, VIDEOS.maxVideos);
    await env.DB.batch(vs.map((v) => env.DB.prepare("INSERT INTO ig_videos (id, lote, ts, clave, portada, bytes, duracion, texto, transcripcion, caption, estado) VALUES (?,?,?,?,?,?,?,?,?,?,'revision')")
      .bind(nuevoId(), l.id, Date.now(), v.key, String(v.portada || "").startsWith(`final/${l.id}-`) ? v.portada : null, +v.bytes || 0, +v.duracion || 0, String(v.texto || "").slice(0, 80), String(v.transcripcion || "").slice(0, 4000), String(v.caption || "").slice(0, 2200))));
    await cancelarLote(env, l, "hecho");   // los clips crudos se borran apenas termina la edición
    await telegram(env, `🎬 ${vs.length} video${vs.length === 1 ? "" : "s"} listo${vs.length === 1 ? "" : "s"} para revisar.\n${base}/panel/redes#videos`).catch(() => {});
    return json({ ok: true, videos: vs.length });
  }
  if (r === "error" && req.method === "POST") {
    const b = await req.json();
    const l = await env.DB.prepare("SELECT * FROM ig_lotes WHERE id=?").bind(String(b.lote || "")).first();
    if (!l) return json({ error: "lote desconocido" }, 404);
    const final = l.intentos >= 3;
    await env.DB.prepare("UPDATE ig_lotes SET estado=?, error=? WHERE id=?").bind(final ? "error" : "en_cola", String(b.error || "").slice(0, 400), l.id).run();
    if (final) { await cancelarLote(env, { ...l }, "error"); await telegram(env, `⚠️ No pude editar un lote de videos: ${String(b.error || "").slice(0, 200)}`).catch(() => {}); }
    return json({ ok: true, reintenta: !final });
  }
  return json({ error: "ruta desconocida" }, 404);
}

// ---------- Ver un video o portada (con rangos, para que el video se pueda adelantar en el celular) ----------
export async function servirObjeto(env, req, key, descargar = "") {
  const rango = req.headers.get("range");
  const cab = await env.VIDEOS.head(key);
  if (!cab) return new Response("No existe (puede que ya se haya borrado)", { status: 404 });
  const h = { "Content-Type": cab.httpMetadata?.contentType || "application/octet-stream", "Accept-Ranges": "bytes", "Cache-Control": "private, max-age=3600" };
  if (descargar) h["Content-Disposition"] = `attachment; filename="${descargar}"`;
  const m = rango && rango.match(/bytes=(\d*)-(\d*)/);
  if (m && (m[1] || m[2])) {
    let ini = m[1] ? +m[1] : Math.max(0, cab.size - +m[2]), fin = m[1] && m[2] ? Math.min(+m[2], cab.size - 1) : cab.size - 1;
    if (ini >= cab.size) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${cab.size}` } });
    const o = await env.VIDEOS.get(key, { range: { offset: ini, length: fin - ini + 1 } });
    return new Response(o.body, { status: 206, headers: { ...h, "Content-Range": `bytes ${ini}-${fin}/${cab.size}`, "Content-Length": String(fin - ini + 1) } });
  }
  const o = await env.VIDEOS.get(key);
  return new Response(o.body, { headers: { ...h, "Content-Length": String(cab.size) } });
}

// ---------- API del panel (/panel/api/videos/...) ----------
export async function apiVideos(env, req, url, quien) {
  if (!env.VIDEOS) return json({ error: "Falta conectar el bucket de videos (R2) al panel." }, 500);
  await prepararVideos(env);
  const r = url.pathname.replace("/panel/api/videos/", "");
  const q = (k) => url.searchParams.get(k) || "";
  const lote = async (id) => (id ? await env.DB.prepare("SELECT * FROM ig_lotes WHERE id=?").bind(id).first() : null);
  const guardarClips = (id, clips) => env.DB.prepare("UPDATE ig_lotes SET clips=? WHERE id=?").bind(JSON.stringify(clips), id).run();

  if (r === "estado") {
    const usado = await espacioUsado(env);
    const lotes = (await env.DB.prepare("SELECT id, ts, estado, clips, error, intentos FROM ig_lotes WHERE estado IN ('subiendo','en_cola','procesando','error') AND ts > ? ORDER BY ts DESC LIMIT 20").bind(Date.now() - 7 * 86400e3).all()).results || [];
    const vids = (await env.DB.prepare("SELECT id, lote, ts, duracion, texto, caption, estado, programado_ts, link, error, publicado_ts, bytes, borrado FROM ig_videos WHERE estado IN ('revision','aprobado','publicando','error') OR (estado='publicado' AND publicado_ts > ?) ORDER BY COALESCE(programado_ts, ts) DESC LIMIT 60").bind(Date.now() - 14 * 86400e3).all()).results || [];
    return json({ usado, tope: VIDEOS.tope, parte: VIDEOS.parte, hora: VIDEOS.horaAR, lotes: lotes.map((l) => ({ ...l, clips: JSON.parse(l.clips || "[]").map((c) => ({ n: c.n, tipo: c.tipo, nombre: c.nombre, subido: !!c.subido })) })), videos: vids });
  }
  if (r === "lote-nuevo" && req.method === "POST") {
    const b = await req.json().catch(() => ({}));
    const clips = (b.clips || []).slice(0, VIDEOS.maxClips + 1);
    if (!clips.length) return json({ error: "Elegí al menos un clip" }, 400);
    if (clips.length > VIDEOS.maxClips) return json({ error: `Máximo ${VIDEOS.maxClips} clips por lote` }, 400);
    const total = clips.reduce((s, c) => s + (+c.bytes || 0), 0);
    if (clips.some((c) => !(+c.bytes > 0) || +c.bytes > VIDEOS.maxClip)) return json({ error: "Cada clip tiene que pesar menos de 1 GB" }, 400);
    const usado = await espacioUsado(env, true);
    if (usado + total > VIDEOS.tope) return json({ error: `No hay lugar: hay ${gb(usado)} guardados y este lote pesa ${gb(total)} (tope ${gb(VIDEOS.tope)}). Aprobá o descartá videos que esperan revisión para liberar espacio.` }, 507);
    const id = nuevoId();
    const lista = clips.map((c, n) => {
      const ext = (String(c.nombre || "").match(/\.(mp4|mov|m4v|webm|3gp|mkv)$/i)?.[1] || "mp4").toLowerCase();
      return { n, tipo: ["gancho", "cuerpo", "completo"].includes(c.tipo) ? c.tipo : "completo", nombre: String(c.nombre || "clip").slice(0, 80), bytes: +c.bytes, key: `lotes/${id}/${n}.${ext}`, subido: false };
    });
    await env.DB.prepare("INSERT INTO ig_lotes (id, ts, quien, estado, clips, bytes) VALUES (?,?,?,'subiendo',?,?)").bind(id, Date.now(), quien || "", JSON.stringify(lista), total).run();
    await sumarUsado(env, total);
    return json({ lote: id, clips: lista.map((c) => ({ n: c.n, key: c.key })) });
  }
  if (["subir-simple", "subir-inicio", "subir-parte", "subir-fin"].includes(r)) {
    const l = await lote(q("lote"));
    if (!l || l.estado !== "subiendo") return json({ error: "Ese lote ya no acepta archivos" }, 400);
    const clips = JSON.parse(l.clips), c = clips.find((x) => x.n === +q("n"));
    if (!c) return json({ error: "clip desconocido" }, 400);
    const tipo = req.headers.get("x-tipo") || "video/mp4";
    if (r === "subir-simple" && req.method === "PUT") {
      if ((+req.headers.get("content-length") || 0) > c.bytes + 1024) return json({ error: "El archivo es más grande de lo declarado" }, 400);
      await env.VIDEOS.put(c.key, req.body, { httpMetadata: { contentType: tipo } });
      c.subido = true; await guardarClips(l.id, clips); return json({ ok: true });
    }
    if (r === "subir-inicio" && req.method === "POST") {
      const m = await env.VIDEOS.createMultipartUpload(c.key, { httpMetadata: { contentType: tipo } });
      c.uploadId = m.uploadId; await guardarClips(l.id, clips); return json({ uploadId: m.uploadId });
    }
    if (r === "subir-parte" && req.method === "PUT") {
      const parte = +q("parte");
      if (!c.uploadId || !(parte >= 1 && parte <= 60)) return json({ error: "parte inválida" }, 400);
      const p = await env.VIDEOS.resumeMultipartUpload(c.key, c.uploadId).uploadPart(parte, req.body);
      return json({ partNumber: p.partNumber, etag: p.etag });
    }
    if (r === "subir-fin" && req.method === "POST") {
      const b = await req.json().catch(() => ({}));
      await env.VIDEOS.resumeMultipartUpload(c.key, c.uploadId).complete((b.partes || []).map((p) => ({ partNumber: +p.partNumber, etag: String(p.etag) })));
      c.subido = true; await guardarClips(l.id, clips); return json({ ok: true });
    }
  }
  if (r === "lote-listo" && req.method === "POST") {
    const b = await req.json().catch(() => ({}));
    const l = await lote(b.lote);
    if (!l || l.estado !== "subiendo") return json({ error: "lote inválido" }, 400);
    const clips = JSON.parse(l.clips);
    for (const c of clips) if (!c.subido || !(await env.VIDEOS.head(c.key))) return json({ error: `Falta subir ${c.nombre}` }, 400);
    await env.DB.prepare("UPDATE ig_lotes SET estado='en_cola' WHERE id=?").bind(l.id).run();
    return json({ ok: true });
  }
  if (r === "lote-cancelar" && req.method === "POST") {
    const b = await req.json().catch(() => ({}));
    const l = await lote(b.lote);
    if (!l || l.estado === "procesando") return json({ error: l ? "Se está editando, esperá que termine" : "lote inválido" }, 400);
    await cancelarLote(env, l); await espacioUsado(env, true); return json({ ok: true });
  }
  const video = async (id) => (id ? await env.DB.prepare("SELECT * FROM ig_videos WHERE id=?").bind(id).first() : null);
  if (r === "ver" || r === "bajar") {
    const v = await video(q("id"));
    if (!v || v.borrado) return new Response("Ese video ya no está guardado", { status: 404 });
    const key = q("q") === "portada" ? v.portada : v.clave;
    if (!key) return new Response("Sin portada", { status: 404 });
    return servirObjeto(env, req, key, r === "bajar" ? `te-importamos-${v.id}.mp4` : "");
  }
  if (req.method === "POST" && ["aprobar", "desaprobar", "descartar", "caption"].includes(r)) {
    const b = await req.json().catch(() => ({}));
    const v = await video(b.id);
    if (!v) return json({ error: "video desconocido" }, 404);
    const caption = b.caption != null ? String(b.caption).slice(0, 2200) : v.caption;
    if (r === "caption") { await env.DB.prepare("UPDATE ig_videos SET caption=? WHERE id=?").bind(caption, v.id).run(); return json({ ok: true }); }
    if (r === "aprobar") {
      if (!["revision", "error"].includes(v.estado) || v.borrado) return json({ error: "Este video no se puede aprobar ahora" }, 400);
      const cuando = await proximoHorario(env);
      await env.DB.prepare("UPDATE ig_videos SET estado='aprobado', caption=?, programado_ts=?, aprobado_por=?, error=NULL, contenedor=NULL, token=NULL WHERE id=?").bind(caption, cuando, quien || "", v.id).run();
      return json({ ok: true, programado_ts: cuando });
    }
    if (r === "desaprobar") {
      if (v.estado !== "aprobado") return json({ error: "Solo se puede frenar un video programado que no salió" }, 400);
      await env.DB.prepare("UPDATE ig_videos SET estado='revision', programado_ts=NULL WHERE id=?").bind(v.id).run();
      return json({ ok: true });
    }
    if (r === "descartar") {
      if (["publicando", "publicado"].includes(v.estado)) return json({ error: "Ya está publicado o publicándose" }, 400);
      await borrarObjetos(env, [v.clave, v.portada]);
      await env.DB.prepare("UPDATE ig_videos SET estado='descartado', borrado=1 WHERE id=?").bind(v.id).run();
      await sumarUsado(env, -(v.bytes || 0));
      return json({ ok: true });
    }
  }
  return json({ error: "ruta desconocida" }, 404);
}

// Limpieza diaria a las 4:10 (hora Argentina). La llama el cron de cada minuto del worker principal.
export async function cronVideos(env, scheduledTime = Date.now()) {
  if (!env.VIDEOS || !env.DB) return false;
  const t = new Date(scheduledTime - AR);
  if (t.getUTCHours() !== 4 || t.getUTCMinutes() !== 10) return false;
  await limpiezaVideos(env);
  return true;
}
