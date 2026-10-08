/**
 * Métricas de Instagram (Fase 1 · Diagnóstico) · solo LECTURA, no publica nada.
 *
 * Rutas (todas con ?clave=VERIFY_TOKEN):
 *   /metricas          página: trae todo por partes y deja descargar un JSON
 *   /metricas/cuenta   datos de la cuenta + insights de los últimos 30 días y los 30 anteriores
 *   /metricas/posts    publicaciones con sus insights, de a 20 (&after= para la página siguiente)
 *
 * Cloudflare gratis permite ~50 consultas externas por pedido: por eso va por partes.
 * No escribe nada en D1. Necesita el permiso instagram_business_manage_insights en el token.
 */

const DIA = 86400;
const M_CUENTA = ["reach", "views", "accounts_engaged", "total_interactions", "likes", "comments", "saves", "shares", "replies", "follows_and_unfollows", "profile_links_taps"];
const M_FEED = ["reach", "views", "saved", "shares", "likes", "comments", "total_interactions", "profile_visits", "follows", "profile_activity"];
const M_REEL = ["reach", "views", "saved", "shares", "likes", "comments", "total_interactions", "ig_reels_avg_watch_time", "ig_reels_video_view_total_time"];
const M_BASE = ["reach", "saved", "shares", "likes", "comments", "total_interactions"];
const POR_PAGINA = 20;

const json = (o, s = 200) => new Response(JSON.stringify(o, null, 1), { status: s, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const esPermiso = (m = "") => /permission|permiso|scope|\(#10\)|\(#200\)|OAuth/i.test(m);

// Valores de /insights → { metrica: numero | objeto }
function aplanar(data = []) {
  const o = {};
  for (const d of data) {
    if (d.total_value) o[d.name] = d.total_value.breakdowns?.length ? d.total_value : d.total_value.value;
    else if (d.values) o[d.name] = d.values.length === 1 ? d.values[0].value : d.values.map((v) => ({ fecha: v.end_time?.slice(0, 10), valor: v.value }));
  }
  return o;
}

// Pide varias métricas juntas; si falla, prueba una por una (y recuerda cuáles no existen).
async function insightsCuenta(ig, metricas, params, malas) {
  const pedir = metricas.filter((m) => !malas.has(m));
  const out = { valores: {}, errores: {} };
  try {
    out.valores = aplanar((await ig("/me/insights", "GET", { metric: pedir.join(","), ...params })).data);
    return out;
  } catch (e) {
    if (esPermiso(e.message)) { out.errores._permiso = e.message; return out; }
  }
  for (const m of pedir) {
    try { Object.assign(out.valores, aplanar((await ig("/me/insights", "GET", { metric: m, ...params })).data)); }
    catch (e) { out.errores[m] = e.message; malas.add(m); if (esPermiso(e.message)) { out.errores._permiso = e.message; break; } }
  }
  return out;
}

export async function cuenta(ig, ahora = Math.floor(Date.now() / 1000)) {
  const r = { generado: new Date(ahora * 1000).toISOString(), permisos: { insights: null, detalle: "" } };
  r.perfil = await ig("/me", "GET", { fields: "user_id,username,name,biography,followers_count,follows_count,media_count" });
  const malas = new Set();
  const hasta = ahora, desde = ahora - 30 * DIA;
  const ult = await insightsCuenta(ig, M_CUENTA, { period: "day", metric_type: "total_value", since: String(desde), until: String(hasta) }, malas);
  if (ult.errores._permiso) {
    r.permisos = { insights: false, detalle: ult.errores._permiso };
    return r;
  }
  r.permisos = { insights: true, detalle: "ok" };
  const ant = await insightsCuenta(ig, M_CUENTA, { period: "day", metric_type: "total_value", since: String(desde - 30 * DIA), until: String(desde) }, malas);
  r.ultimos30 = ult.valores; r.anteriores30 = ant.valores;
  r.metricas_no_disponibles = Object.keys({ ...ult.errores, ...ant.errores });
  // Series diarias (alcance y seguidores ganados por día)
  r.series = {};
  for (const m of ["reach", "follower_count"]) {
    try { r.series[m] = aplanar((await ig("/me/insights", "GET", { metric: m, period: "day", since: String(desde), until: String(hasta) })).data)[m]; }
    catch (e) { r.series[m] = { error: e.message }; }
  }
  // Público (requiere 100+ seguidores)
  r.publico = {};
  for (const b of ["age", "gender", "city", "country"]) {
    let v = null, err = "";
    for (const extra of [{}, { timeframe: "this_month" }]) {
      try { v = aplanar((await ig("/me/insights", "GET", { metric: "follower_demographics", period: "lifetime", metric_type: "total_value", breakdown: b, ...extra })).data).follower_demographics; break; }
      catch (e) { err = e.message; }
    }
    r.publico[b] = v ?? { error: err };
  }
  try { r.publico.horarios_online = aplanar((await ig("/me/insights", "GET", { metric: "online_followers", period: "lifetime" })).data).online_followers; }
  catch (e) { r.publico.horarios_online = { error: e.message }; }
  return r;
}

// Recuerda por tipo si el set completo de métricas falló, para no gastar consultas.
const setFalla = { REELS: false, FEED: false };

export async function posts(ig, after = "") {
  const p = { fields: "id,caption,media_type,media_product_type,permalink,timestamp,like_count,comments_count,thumbnail_url", limit: String(POR_PAGINA) };
  if (after) p.after = after;
  const lista = await ig("/me/media", "GET", p);
  const items = [];
  let sinPermiso = "";
  for (const m of lista.data || []) {
    const tipo = m.media_product_type === "REELS" ? "REELS" : m.media_product_type === "STORY" ? "STORY" : "FEED";
    const it = {
      id: m.id, fecha: m.timestamp, tipo, formato: m.media_type, link: m.permalink,
      texto: (m.caption || "").slice(0, 600), likes: m.like_count ?? null, comentarios: m.comments_count ?? null, insights: {},
    };
    if (tipo !== "STORY" && !sinPermiso) {
      const completo = tipo === "REELS" ? M_REEL : M_FEED;
      const sets = setFalla[tipo] ? [M_BASE] : [completo, M_BASE];
      for (const s of sets) {
        try { it.insights = aplanar((await ig(`/${m.id}/insights`, "GET", { metric: s.join(",") })).data); break; }
        catch (e) {
          if (esPermiso(e.message)) { sinPermiso = e.message; break; }
          if (s === completo) setFalla[tipo] = true;
          it.insights_error = e.message;
        }
      }
      if (Object.keys(it.insights).length) delete it.insights_error;
    }
    items.push(it);
  }
  return { items, siguiente: lista.paging?.next ? lista.paging?.cursors?.after || "" : "", sin_permiso: sinPermiso || undefined };
}

export async function rutasMetricas(env, url, ig) {
  const ruta = url.pathname.replace(/\/+$/, "");
  if (ruta === "/metricas") return new Response(PAGINA, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
  if (ruta === "/metricas/cuenta") return json(await cuenta(ig));
  if (ruta === "/metricas/posts") return json(await posts(ig, url.searchParams.get("after") || ""));
  return null;
}

export const PAGINA = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Métricas Instagram</title><style>
body{margin:0;background:#0B0B0B;color:#fff;font:16px/1.5 system-ui,sans-serif}main{max-width:640px;margin:0 auto;padding:24px 16px}
h1{font-size:22px;margin:0 0 4px}h1 b{color:#EA5B0C}p{color:#bbb}button{background:#EA5B0C;color:#fff;border:0;border-radius:10px;padding:14px 20px;font-size:16px;font-weight:600;cursor:pointer;width:100%;margin-top:12px}
button:disabled{opacity:.5}.caja{background:#161616;border:1px solid #2a2a2a;border-radius:12px;padding:14px;margin-top:16px;white-space:pre-wrap;font-size:14px}.ok{color:#4ade80}.mal{color:#f87171}</style></head>
<body><main><h1>Te Importamos · <b>Métricas de Instagram</b></h1>
<p>Solo lectura: trae los datos por la API oficial. No publica ni cambia nada.</p>
<label>Cuántas publicaciones traer: <select id="max"><option>60</option><option selected>120</option><option>200</option></select></label>
<button id="ir">Traer métricas</button><div class="caja" id="log">Listo para empezar.</div><button id="bajar" style="display:none">Descargar archivo .json</button></main>
<script>
var clave=new URLSearchParams(location.search).get("clave")||"";var datos=null;var log=document.getElementById("log");
function l(t,c){var d=document.createElement("div");if(c)d.className=c;d.textContent=t;log.appendChild(d)}
async function traer(p){var r=await fetch(p+(p.indexOf("?")<0?"?":"&")+"clave="+encodeURIComponent(clave));var j=await r.json().catch(function(){return{error:"respuesta rara ("+r.status+")"}});if(!r.ok||j.error)throw new Error(j.error||("error "+r.status));return j}
document.getElementById("ir").onclick=async function(){var b=this;b.disabled=true;log.textContent="";var max=+document.getElementById("max").value;
try{l("Leyendo la cuenta...");var c=await traer("/metricas/cuenta");l("Cuenta @"+c.perfil.username+" · "+c.perfil.followers_count+" seguidores · "+c.perfil.media_count+" publicaciones");
if(c.permisos.insights)l("Permiso de estadísticas: OK","ok");else l("Falta el permiso de estadísticas (instagram_business_manage_insights). Detalle: "+c.permisos.detalle,"mal");
var items=[],after="",pag=0,sinp="";do{pag++;l("Publicaciones, página "+pag+"...");var p=await traer("/metricas/posts"+(after?"?after="+encodeURIComponent(after):""));items=items.concat(p.items);after=p.siguiente;if(p.sin_permiso)sinp=p.sin_permiso}while(after&&items.length<max);
var conIns=items.filter(function(x){return Object.keys(x.insights).length}).length;l(items.length+" publicaciones leídas, "+conIns+" con estadísticas.",conIns?"ok":"mal");if(sinp)l("Sin permiso para estadísticas por publicación: "+sinp,"mal");
datos={cuenta:c,publicaciones:items};var bj=document.getElementById("bajar");bj.style.display="block";l("Listo. Descargá el archivo y adjuntalo en el chat con Claude.","ok")}
catch(e){l("Error: "+e.message,"mal")}b.disabled=false};
document.getElementById("bajar").onclick=function(){var a=document.createElement("a");a.href=URL.createObjectURL(new Blob([JSON.stringify(datos)],{type:"application/json"}));a.download="ig-metricas-"+new Date().toISOString().slice(0,10)+".json";a.click()};
</script></body></html>`;
