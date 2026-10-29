// ============================================================================
// TIKTOK — métricas de la cuenta propia (@te.importamos.arg) vía Apify
// ----------------------------------------------------------------------------
// La primera vez lee apenas se publica (60 videos); después cada 2 días a las 6 AR lanza el lector de perfiles de TikTok de Apify con los
// últimos videos y guarda vistas, likes, comentarios, compartidos y guardados
// en la tabla tt_posts de la D1 "agente". El panel (Redes › Rendimiento) los
// cruza con Instagram. Solo lectura: no publica nada en TikTok.
// El costo se suma al mismo tope mensual de Apify que el buscador (MAX_USD_MES).
// ============================================================================

export const TIKTOK = {
  usuario: "te.importamos.arg",
  actor: "clockworks~tiktok-scraper",
  videos: 25,               // últimos videos por lectura (cubre ~3 semanas)
  videosPrimera: 60,        // la primera vez trae más historial (~2 meses) para poder comparar
  usdPrimera: 0.25,
  cadaDias: 2,
  horaAR: 6,
  usdPorRun: 0.1,           // tope de gasto de cada lectura (Apify corta ahí)
  minutosMax: 20,
};

export const ESQUEMA_TT = [
  "CREATE TABLE IF NOT EXISTS tt_posts (id TEXT PRIMARY KEY, ts INTEGER, link TEXT, texto TEXT, duracion INTEGER, portada TEXT, vistas INTEGER, likes INTEGER, comentarios INTEGER, compartidos INTEGER, guardados INTEGER, seguidores INTEGER, actualizado INTEGER)",
  "CREATE INDEX IF NOT EXISTS tt_posts_ts ON tt_posts(ts)",
  // Una foto por día de la cuenta (seguidores, likes totales, videos) para ver cómo crece
  "CREATE TABLE IF NOT EXISTS tt_cuenta (dia TEXT PRIMARY KEY, ts INTEGER, seguidores INTEGER, likes_total INTEGER, videos_total INTEGER)",
];

const n = (v) => (Number.isFinite(+v) ? +v : 0);
const AR = 3 * 3600e3;
const mesAR = (ts = Date.now()) => new Date(ts - AR).toISOString().slice(0, 7);
const kvGet = async (env, k) => (await env.DB.prepare("SELECT v FROM kv WHERE k=?").bind(k).first())?.v ?? null;
const kvPut = (env, k, v) => env.DB.prepare("INSERT INTO kv (k,v,exp) VALUES (?,?,NULL) ON CONFLICT(k) DO UPDATE SET v=excluded.v, exp=NULL").bind(k, String(v)).run();

// Lo gastado en TikTok este mes (se suma al gasto del buscador para respetar un solo tope)
export async function gastoTikTokMes(env) { return n(await kvGet(env, "tt_costo:" + mesAR())); }

// Un item del lector de Apify → fila de tt_posts (tolera las dos formas en que viene: plano o con "stats")
export function filaTikTok(it) {
  const st = it.stats || {}, vm = it.videoMeta || {};
  const ts = it.createTimeISO ? Date.parse(it.createTimeISO) : n(it.createTime) * 1000;
  const id = String(it.id || "").trim();
  if (!id || !ts) return null;
  return {
    id, ts, link: it.webVideoUrl || `https://www.tiktok.com/@${TIKTOK.usuario}/video/${id}`, texto: String(it.text || it.desc || "").slice(0, 600),
    duracion: n(vm.duration || it.duration), portada: vm.coverUrl || vm.originalCoverUrl || "",
    vistas: n(it.playCount ?? st.playCount), likes: n(it.diggCount ?? st.diggCount), comentarios: n(it.commentCount ?? st.commentCount),
    compartidos: n(it.shareCount ?? st.shareCount), guardados: n(it.collectCount ?? st.collectCount), seguidores: n(it.authorMeta?.fans ?? it.authorStats?.followerCount),
  };
}

// Datos de la cuenta que vienen dentro de cada video (authorMeta / authorStats)
export function cuentaTikTok(items) {
  for (const it of items || []) {
    const a = it.authorMeta || {}, s = it.authorStats || {};
    const seguidores = n(a.fans ?? s.followerCount);
    if (seguidores) return { seguidores, likes_total: n(a.heart ?? s.heartCount ?? s.heart), videos_total: n(a.video ?? s.videoCount) };
  }
  return null;
}

export async function guardarTikTok(env, items) {
  const filas = items.map(filaTikTok).filter(Boolean);
  if (!filas.length) return 0;
  const ahora = Date.now();
  const cta = cuentaTikTok(items);
  if (cta) await env.DB.prepare("INSERT INTO tt_cuenta (dia, ts, seguidores, likes_total, videos_total) VALUES (?,?,?,?,?) ON CONFLICT(dia) DO UPDATE SET ts=excluded.ts, seguidores=excluded.seguidores, likes_total=excluded.likes_total, videos_total=excluded.videos_total")
    .bind(new Date(ahora - AR).toISOString().slice(0, 10), ahora, cta.seguidores, cta.likes_total, cta.videos_total).run();
  await env.DB.batch(filas.map((f) => env.DB.prepare(`INSERT INTO tt_posts (id, ts, link, texto, duracion, portada, vistas, likes, comentarios, compartidos, guardados, seguidores, actualizado) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET texto=excluded.texto, portada=COALESCE(NULLIF(excluded.portada,''), tt_posts.portada), vistas=MAX(excluded.vistas, tt_posts.vistas), likes=MAX(excluded.likes, tt_posts.likes), comentarios=MAX(excluded.comentarios, tt_posts.comentarios), compartidos=MAX(excluded.compartidos, tt_posts.compartidos), guardados=MAX(excluded.guardados, tt_posts.guardados), seguidores=excluded.seguidores, actualizado=excluded.actualizado`)
    .bind(f.id, f.ts, f.link, f.texto, f.duracion, f.portada, f.vistas, f.likes, f.comentarios, f.compartidos, f.guardados, f.seguidores, ahora)));
  return filas.length;
}

// Una vuelta (la llama el cron cada 2 min): si hay una lectura en curso la sigue; si toca, lanza otra.
// apify(env, ruta, opciones) y topeMes(env) vienen del buscador.
// Si no se pudo leer (sin clave, tope del mes), queda anotado para que el panel diga por qué no hay datos nuevos
const avisar = async (env, texto, ahora) => { await kvPut(env, "tt_aviso", JSON.stringify({ ts: ahora, texto })); return texto; };
export async function vueltaTikTok(env, { apify, gastoMes, topeMes, ahora = Date.now(), forzar = false }) {
  if (!env.APIFY_TOKEN) { await avisar(env, "TikTok: falta la clave de Apify (APIFY_TOKEN) en el worker buscador", ahora).catch(() => {}); return "sin APIFY_TOKEN"; }
  await env.DB.batch(ESQUEMA_TT.map((s) => env.DB.prepare(s)));
  // "Actualizar TikTok" del panel: deja un pedido en kv y la próxima vuelta (cada 2 min) lo atiende
  const pedido = await kvGet(env, "tt_forzar");
  if (pedido && !(await kvGet(env, "tt_run"))) { await env.DB.prepare("DELETE FROM kv WHERE k='tt_forzar'").run(); forzar = true; }
  const run = JSON.parse((await kvGet(env, "tt_run")) || "null");
  if (run) {
    const s = await apify(env, `/actor-runs/${run.id}`);
    const est = s.j?.data?.status;
    if (s.ok && ["SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"].includes(est)) {
      const costo = n(s.j.data.usageTotalUsd);
      await kvPut(env, "tt_costo:" + mesAR(ahora), n(await kvGet(env, "tt_costo:" + mesAR(ahora))) + costo);
      let guardados = 0;
      if (s.j.data.defaultDatasetId) {
        const d = await apify(env, `/datasets/${s.j.data.defaultDatasetId}/items?clean=true&limit=${TIKTOK.videosPrimera + 10}`);
        if (d.ok && Array.isArray(d.j)) guardados = await guardarTikTok(env, d.j);
      }
      await env.DB.prepare("DELETE FROM kv WHERE k='tt_run'").run();
      await kvPut(env, "tt_ultimo", JSON.stringify({ ts: ahora, estado: est, videos: guardados, costo }));
      if (est === "SUCCEEDED" && guardados) await env.DB.prepare("DELETE FROM kv WHERE k='tt_aviso'").run();
      else await avisar(env, est === "SUCCEEDED" ? "TikTok: la lectura terminó pero no trajo videos (¿cambió el usuario o la cuenta está privada?)" : `TikTok: la lectura de Apify terminó en ${est}`, ahora);
      return `TikTok: ${est}, ${guardados} videos, USD ${costo.toFixed(3)}`;
    }
    if (ahora - run.desde > TIKTOK.minutosMax * 60e3) { await apify(env, `/actor-runs/${run.id}/abort`, { method: "POST" }); await env.DB.prepare("DELETE FROM kv WHERE k='tt_run'").run(); return "TikTok: lectura vencida, cortada"; }
    return "TikTok: leyendo";
  }
  const ult = JSON.parse((await kvGet(env, "tt_ultimo")) || "null");
  const hAR = new Date(ahora - AR).getUTCHours();
  // La primera lectura (o si la anterior falló hace más de 6 h) va apenas puede; después, cada 2 días a las 6
  const primera = !ult || (ult.estado === "ERROR" && ahora - ult.ts > 6 * 3600e3);
  if (!forzar && !primera && (hAR !== TIKTOK.horaAR || ahora - ult.ts < (TIKTOK.cadaDias - 0.5) * 86400e3)) return "";
  const cuantos = !ult ? TIKTOK.videosPrimera : TIKTOK.videos, tope = !ult ? TIKTOK.usdPrimera : TIKTOK.usdPorRun;
  const gasto = await gastoMes(env);
  if (gasto + tope > topeMes) return avisar(env, `TikTok: tope de Apify del mes alcanzado (USD ${gasto.toFixed(2)} de ${topeMes}). Vuelve a leer el mes que viene o subí MAX_USD_MES.`, ahora);
  const q = new URLSearchParams({ maxItems: String(cuantos), maxTotalChargeUsd: String(tope), timeout: "600" });
  const r = await apify(env, `/acts/${env.ACTOR_TIKTOK || TIKTOK.actor}/runs?${q}`, { method: "POST", body: JSON.stringify({
    profiles: [env.TIKTOK_USUARIO || TIKTOK.usuario], profileScrapeSections: ["videos"], profileSorting: "latest", resultsPerPage: cuantos,
    shouldDownloadVideos: false, shouldDownloadCovers: false, shouldDownloadSubtitles: false, shouldDownloadSlideshowImages: false, shouldDownloadAvatars: false,
  }) });
  if (!r.ok || !r.j?.data?.id) { await avisar(env, "TikTok: Apify no aceptó la lectura (" + String(r.err || r.status).slice(0, 150) + ")", ahora); await kvPut(env, "tt_ultimo", JSON.stringify({ ts: ahora, estado: "ERROR", error: String(r.err || r.status).slice(0, 200) })); return "TikTok: no pude lanzar la lectura: " + (r.err || r.status); }
  await kvPut(env, "tt_run", JSON.stringify({ id: r.j.data.id, desde: ahora }));
  return "TikTok: lectura lanzada";
}
