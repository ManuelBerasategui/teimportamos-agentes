// ============================================================================
// VIRALES DE OTROS — qué se está pegando en TikTok en nuestro nicho (vía Apify)
// ----------------------------------------------------------------------------
// Una vez por semana (lunes 5 AR) o cuando el panel lo pide ("Leer ahora" en la pestaña Agentes), lanza el mismo
// lector de TikTok de Apify con una lista de hashtags y de cuentas (kv "virales_fuentes", editable desde el panel),
// se queda con los videos que se despegaron (muchas vistas, o muchas más vistas que seguidores tiene la cuenta)
// y los guarda en la tabla "virales" de la D1 "agente" con el texto del posteo y, si TikTok los tiene, los
// subtítulos (lo que se dice en el video). El agente de Redes de la mesa los cruza con lo que publicamos nosotros.
// El costo se suma al mismo tope mensual de Apify (MAX_USD_MES) que el buscador y el TikTok propio.
// ============================================================================

export const VIRALES = {
  actor: "clockworks~tiktok-scraper",
  porFuente: 12,            // videos por hashtag o cuenta
  maxFuentes: 12,
  usdPorRun: 0.4,           // tope de gasto de cada lectura (Apify corta ahí)
  cadaDias: 7,
  diaSemana: 1,             // lunes
  horaAR: 5,
  minutosMax: 25,
  minVistas: 30000,         // piso para guardar un video
  guardar: 40,              // como mucho por lectura
  dias: 60,                 // no guardar videos más viejos que esto
};
export const FUENTES_DEF = { hashtags: ["importardechina", "importaciones", "alibaba", "emprendedoresargentinos", "revender", "productosganadores", "mercadolibreargentina"], perfiles: [] };

export const ESQUEMA_VIRALES = [
  "CREATE TABLE IF NOT EXISTS virales (id TEXT PRIMARY KEY, ts INTEGER, red TEXT, autor TEXT, link TEXT, texto TEXT, duracion INTEGER, vistas INTEGER, likes INTEGER, comentarios INTEGER, compartidos INTEGER, guardados INTEGER, seguidores INTEGER, fuente TEXT, guion TEXT, leido INTEGER)",
  "CREATE INDEX IF NOT EXISTS virales_leido ON virales(leido)",
];

const n = (v) => (Number.isFinite(+v) ? +v : 0);
const AR = 3 * 3600e3, DIA = 86400e3;
const mesAR = (ts = Date.now()) => new Date(ts - AR).toISOString().slice(0, 7);
const kvGet = async (env, k) => (await env.DB.prepare("SELECT v FROM kv WHERE k=?").bind(k).first())?.v ?? null;
const kvPut = (env, k, v) => env.DB.prepare("INSERT INTO kv (k,v,exp) VALUES (?,?,NULL) ON CONFLICT(k) DO UPDATE SET v=excluded.v, exp=NULL").bind(k, String(v)).run();
const limpio = (s) => String(s || "").trim().replace(/^[@#]/, "").replace(/[^\w.\-áéíóúñ]/gi, "").slice(0, 40);

export async function fuentesVirales(env) {
  let f = null; try { f = JSON.parse((await kvGet(env, "virales_fuentes")) || "null"); } catch {}
  const hashtags = [...new Set((f?.hashtags || FUENTES_DEF.hashtags).map(limpio).filter(Boolean))], perfiles = [...new Set((f?.perfiles || FUENTES_DEF.perfiles).map(limpio).filter(Boolean))];
  return { hashtags: hashtags.slice(0, VIRALES.maxFuentes), perfiles: perfiles.slice(0, VIRALES.maxFuentes) };
}

// Un item del lector → fila de "virales" (o null si no se despegó)
export function filaViral(it, { propio = "", ahora = Date.now() } = {}) {
  const st = it.stats || {}, vm = it.videoMeta || {}, a = it.authorMeta || {}, as = it.authorStats || {};
  const ts = it.createTimeISO ? Date.parse(it.createTimeISO) : n(it.createTime) * 1000;
  const id = String(it.id || "").trim(), autor = String(a.name || a.uniqueId || it.author?.uniqueId || "").toLowerCase();
  if (!id || !ts || ahora - ts > VIRALES.dias * DIA) return null;
  if (autor && autor === String(propio).toLowerCase()) return null;
  const vistas = n(it.playCount ?? st.playCount), seguidores = n(a.fans ?? as.followerCount);
  // Se despegó: muchas vistas, o al menos 5 veces los seguidores de la cuenta con un piso de 10.000
  if (!(vistas >= VIRALES.minVistas || (seguidores && vistas >= 10000 && vistas >= seguidores * 5))) return null;
  const subs = Array.isArray(vm.subtitleLinks) ? vm.subtitleLinks : [];
  const sub = subs.find((s) => /^(es|spa)/i.test(s.language || "")) || subs[0] || null;
  return {
    id, ts, red: "tiktok", autor, link: it.webVideoUrl || `https://www.tiktok.com/@${autor}/video/${id}`, texto: String(it.text || it.desc || "").slice(0, 600), duracion: n(vm.duration || it.duration),
    vistas, likes: n(it.diggCount ?? st.diggCount), comentarios: n(it.commentCount ?? st.commentCount), compartidos: n(it.shareCount ?? st.shareCount), guardados: n(it.collectCount ?? st.collectCount), seguidores,
    fuente: String(it.searchHashtag?.name ? "#" + it.searchHashtag.name : it.input || "").slice(0, 60), sub: sub ? sub.downloadLink || sub.tiktokLink || "" : "",
  };
}

// Subtítulos WebVTT / SRT → texto corrido
export function textoSubtitulos(vtt) {
  const out = [];
  for (const l of String(vtt || "").split(/\r?\n/)) {
    const t = l.trim();
    if (!t || /^WEBVTT/i.test(t) || /-->/.test(t) || /^\d+$/.test(t) || /^(NOTE|STYLE|Kind:|Language:)/i.test(t)) continue;
    const s = t.replace(/<[^>]+>/g, "").trim();
    if (s && out[out.length - 1] !== s) out.push(s);
  }
  return out.join(" ").replace(/\s+/g, " ").trim().slice(0, 3000);
}

export async function guardarVirales(env, items, { propio = "", ahora = Date.now(), leerSubs = fetch } = {}) {
  const vistos = new Set();
  const filas = items.map((it) => filaViral(it, { propio, ahora })).filter((f) => f && !vistos.has(f.id) && vistos.add(f.id)).sort((a, b) => b.vistas - a.vistas).slice(0, VIRALES.guardar);
  if (!filas.length) return 0;
  // Subtítulos: solo de los 15 con más vistas (cada uno es un pedido aparte)
  for (const f of filas.slice(0, 15)) {
    if (!f.sub) continue;
    try { const r = await leerSubs(f.sub, { signal: AbortSignal.timeout(8000) }); if (r.ok) f.guion = textoSubtitulos(await r.text()); } catch {}
  }
  await env.DB.batch(filas.map((f) => env.DB.prepare(`INSERT INTO virales (id, ts, red, autor, link, texto, duracion, vistas, likes, comentarios, compartidos, guardados, seguidores, fuente, guion, leido) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET vistas=MAX(excluded.vistas, virales.vistas), likes=MAX(excluded.likes, virales.likes), comentarios=MAX(excluded.comentarios, virales.comentarios), compartidos=MAX(excluded.compartidos, virales.compartidos), guardados=MAX(excluded.guardados, virales.guardados), seguidores=excluded.seguidores, guion=COALESCE(NULLIF(excluded.guion,''), virales.guion), leido=excluded.leido`)
    .bind(f.id, f.ts, f.red, f.autor, f.link, f.texto, f.duracion, f.vistas, f.likes, f.comentarios, f.compartidos, f.guardados, f.seguidores, f.fuente, f.guion || null, ahora)));
  await env.DB.prepare("DELETE FROM virales WHERE ts < ?").bind(ahora - 120 * DIA).run().catch(() => {});
  return filas.length;
}

// Una vuelta (cron cada 2 min del buscador): sigue la lectura en curso o lanza una si toca.
export async function vueltaVirales(env, { apify, gastoMes, topeMes, ahora = Date.now(), forzar = false, leerSubs = fetch }) {
  if (!env.APIFY_TOKEN || env.VIRALES === "0") return "";
  const pedido = await kvGet(env, "vir_forzar");
  const run = JSON.parse((await kvGet(env, "vir_run")) || "null");
  if (pedido && !run) { await env.DB.prepare("DELETE FROM kv WHERE k='vir_forzar'").run(); forzar = true; }
  if (run) {
    const s = await apify(env, `/actor-runs/${run.id}`);
    const est = s.j?.data?.status;
    if (s.ok && ["SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"].includes(est)) {
      await env.DB.batch(ESQUEMA_VIRALES.map((x) => env.DB.prepare(x)));
      const costo = n(s.j.data.usageTotalUsd);
      // Se anota en la misma cuenta que el TikTok propio: el buscador ya la suma al tope del mes
      await kvPut(env, "tt_costo:" + mesAR(ahora), n(await kvGet(env, "tt_costo:" + mesAR(ahora))) + costo);
      let guardados = 0, leidos = 0;
      if (s.j.data.defaultDatasetId) {
        const d = await apify(env, `/datasets/${s.j.data.defaultDatasetId}/items?clean=true&limit=400`);
        if (d.ok && Array.isArray(d.j)) { leidos = d.j.length; guardados = await guardarVirales(env, d.j, { propio: env.TIKTOK_USUARIO || "te.importamos.arg", ahora, leerSubs }); }
      }
      await env.DB.prepare("DELETE FROM kv WHERE k='vir_run'").run();
      await kvPut(env, "vir_ultimo", JSON.stringify({ ts: ahora, estado: est, leidos, guardados, costo }));
      return `Virales: ${est}, ${leidos} videos leídos, ${guardados} guardados, USD ${costo.toFixed(3)}`;
    }
    if (ahora - run.desde > VIRALES.minutosMax * 60e3) { await apify(env, `/actor-runs/${run.id}/abort`, { method: "POST" }); await env.DB.prepare("DELETE FROM kv WHERE k='vir_run'").run(); await kvPut(env, "vir_ultimo", JSON.stringify({ ts: ahora, estado: "VENCIDA" })); return "Virales: lectura vencida, cortada"; }
    return "Virales: leyendo";
  }
  const ult = JSON.parse((await kvGet(env, "vir_ultimo")) || "null");
  const d = new Date(ahora - AR);
  // La primera vez va apenas puede; después, los lunes a las 5 (y nunca antes de 6 días y medio de la anterior)
  if (!forzar && ult && (ahora - ult.ts < (VIRALES.cadaDias - 0.5) * DIA || d.getUTCDay() !== VIRALES.diaSemana || d.getUTCHours() !== VIRALES.horaAR)) return "";
  const gasto = await gastoMes(env);
  if (gasto + VIRALES.usdPorRun > topeMes) { await kvPut(env, "vir_ultimo", JSON.stringify({ ts: ahora, estado: "TOPE", error: `tope de Apify del mes alcanzado (USD ${gasto.toFixed(2)} de ${topeMes})` })); return "Virales: tope de Apify del mes alcanzado"; }
  const f = await fuentesVirales(env);
  if (!f.hashtags.length && !f.perfiles.length) return "";
  const total = (f.hashtags.length + f.perfiles.length) * VIRALES.porFuente;
  const q = new URLSearchParams({ maxItems: String(total), maxTotalChargeUsd: String(Math.max(0.5, VIRALES.usdPorRun)), timeout: "900" });
  const r = await apify(env, `/acts/${env.ACTOR_TIKTOK || VIRALES.actor}/runs?${q}`, { method: "POST", body: JSON.stringify({
    hashtags: f.hashtags, profiles: f.perfiles, profileScrapeSections: ["videos"], profileSorting: "popular", resultsPerPage: VIRALES.porFuente,
    shouldDownloadVideos: false, shouldDownloadCovers: false, shouldDownloadSubtitles: true, shouldDownloadSlideshowImages: false, shouldDownloadAvatars: false,
  }) });
  if (!r.ok || !r.j?.data?.id) { await kvPut(env, "vir_ultimo", JSON.stringify({ ts: ahora, estado: "ERROR", error: String(r.err || r.status).slice(0, 200) })); return "Virales: no pude lanzar la lectura: " + (r.err || r.status); }
  await kvPut(env, "vir_run", JSON.stringify({ id: r.j.data.id, desde: ahora }));
  return "Virales: lectura lanzada";
}
