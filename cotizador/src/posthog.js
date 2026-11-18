// PostHog: eventos del embudo del negocio para ver gráficos (consultas, respuestas del agente, cotizaciones armadas, enviadas y revisadas).
// Privacidad: nunca se mandan teléfonos, nombres ni textos de mensajes; el cliente se identifica con una huella (hash) irreconocible.
// Si falta la variable POSTHOG_KEY no hace nada (el agente anda igual). Variables en Cloudflare: POSTHOG_KEY (la "Project API key", empieza con phc_)
// y, si tu cuenta es de Europa, POSTHOG_HOST = https://eu.i.posthog.com (por defecto https://us.i.posthog.com).
const huellaDe = async (conv) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("ph:" + conv)))).slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");
export async function evento(env, nombre, props = {}, conv = "") {
  if (!env?.POSTHOG_KEY) return false;
  try {
    const host = String(env.POSTHOG_HOST || "https://us.i.posthog.com").replace(/\/+$/, "");
    const limpias = {};
    for (const [k, v] of Object.entries(props)) if (v !== undefined && v !== null && !/tel|phone|conv|nombre|texto|mensaje/i.test(k)) limpias[k] = typeof v === "string" ? v.slice(0, 120) : v;
    const r = await fetch(`${host}/capture/`, { method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(2500),
      body: JSON.stringify({ api_key: env.POSTHOG_KEY, event: nombre, distinct_id: conv ? await huellaDe(conv) : "agente", properties: { ...limpias, $lib: "teimportamos-agente" }, timestamp: new Date().toISOString() }) });
    return r.ok;
  } catch { return false; }
}

// ---------------------------------------------------------------------------------------------------------------
// LEER las métricas de la página desde PostHog (visitas, páginas, fuentes, eventos) para verlas en el panel: /panel/web
// Variables en Cloudflare (secretas): POSTHOG_PERSONAL_KEY (una "Personal API key" con permiso de lectura de consultas, empieza con phx_)
// y POSTHOG_PROJECT_ID (el número del proyecto, está en la URL de PostHog). POSTHOG_HOST como arriba. Solo se lee, nunca se escribe.
const hogql = async (env, consulta) => {
  const host = String(env.POSTHOG_HOST || "https://us.i.posthog.com").replace(/\/+$/, "").replace("i.posthog.com", "posthog.com");   // la API de lectura está en us.posthog.com / eu.posthog.com
  const r = await fetch(`${host}/api/projects/${encodeURIComponent(env.POSTHOG_PROJECT_ID)}/query/`, { method: "POST", signal: AbortSignal.timeout(20000),
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + env.POSTHOG_PERSONAL_KEY }, body: JSON.stringify({ query: { kind: "HogQLQuery", query: consulta } }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.detail || j?.error || `PostHog respondió ${r.status}`);
  return j.results || [];
};
export async function metricasWeb(env, dias = 14) {
  if (!env.POSTHOG_PERSONAL_KEY || !env.POSTHOG_PROJECT_ID) return { ok: false, falta: "Faltan las variables POSTHOG_PERSONAL_KEY y POSTHOG_PROJECT_ID en Cloudflare." };
  const n = Math.min(Math.max(Math.round(+dias) || 14, 1), 90), desde = `timestamp >= now() - INTERVAL ${n} DAY`;
  try {
    const [serie, paginas, fuentes, eventos] = await Promise.all([
      hogql(env, `SELECT toString(toDate(timestamp)) d, count() vistas, count(DISTINCT person_id) visitantes FROM events WHERE event = '$pageview' AND ${desde} GROUP BY d ORDER BY d`),
      hogql(env, `SELECT properties.$pathname p, count() c FROM events WHERE event = '$pageview' AND ${desde} GROUP BY p ORDER BY c DESC LIMIT 10`),
      hogql(env, `SELECT coalesce(nullIf(properties.$referring_domain, ''), '(directo)') f, count() c FROM events WHERE event = '$pageview' AND ${desde} GROUP BY f ORDER BY c DESC LIMIT 10`),
      hogql(env, `SELECT event, count() c FROM events WHERE ${desde} AND NOT startsWith(event, '$') AND event NOT IN ('agente_decision','cotizacion_armada','cotizacion_enviada','cotizacion_revisada') GROUP BY event ORDER BY c DESC LIMIT 15`),
    ]);
    return { ok: true, dias: n, serie: serie.map(([d, v, u]) => ({ d, vistas: +v, visitantes: +u })), paginas: paginas.map(([p, c]) => ({ p: p || "/", c: +c })), fuentes: fuentes.map(([f, c]) => ({ f, c: +c })), eventos: eventos.map(([e, c]) => ({ e, c: +c })) };
  } catch (e) { return { ok: false, falta: "No pude leer PostHog: " + String(e?.message || e).slice(0, 200) }; }
}
export const PANEL_WEB = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Métricas de la web</title>
<style>:root{--bg:#f6f7f9;--tx:#16181d;--mu:#6b7280;--bar:#2f6fed;--ca:#fff;--bo:#e5e7eb}@media(prefers-color-scheme:dark){:root{--bg:#0f1115;--tx:#e8eaee;--mu:#9aa3b2;--bar:#6b9bff;--ca:#171a21;--bo:#262b36}}
body{margin:0;background:var(--bg);color:var(--tx);font:15px system-ui,sans-serif;padding:16px;max-width:900px;margin-inline:auto}a{color:var(--bar)}h1{font-size:20px;margin:6px 0 14px}h2{font-size:15px;margin:0 0 10px}
.ca{background:var(--ca);border:1px solid var(--bo);border-radius:12px;padding:14px;margin-bottom:14px}.fila{display:flex;align-items:center;gap:8px;margin:5px 0;font-size:13px}.fila .n{width:44%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fila .b{flex:1;background:var(--bo);border-radius:4px;height:14px}.fila .b i{display:block;height:100%;background:var(--bar);border-radius:4px}.fila .v{width:48px;text-align:right;color:var(--mu)}
.cols{display:flex;align-items:flex-end;gap:3px;height:120px}.cols div{flex:1;background:var(--bar);border-radius:3px 3px 0 0;min-height:2px}.eje{display:flex;justify-content:space-between;color:var(--mu);font-size:11px;margin-top:4px}
.k{display:flex;gap:18px;flex-wrap:wrap;margin-bottom:10px}.k b{font-size:22px;display:block}.k span{color:var(--mu);font-size:12px}select{padding:6px;border-radius:8px;border:1px solid var(--bo);background:var(--ca);color:var(--tx)}.av{color:var(--mu)}</style></head><body>
<a href="/panel">← Panel</a><h1>Métricas de la web <select id="d"><option value="7">7 días</option><option value="14" selected>14 días</option><option value="30">30 días</option><option value="90">90 días</option></select></h1><div id="foto" class="ca av">Cargando la foto para la mesa…</div><div id="ins" class="av">Cargando tus insights de PostHog…</div><div id="x" class="av">Cargando…</div>
<script>
var $=function(s){return document.querySelector(s)},esc=function(s){return String(s).replace(/[&<>"]/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]})};
function barras(t,l,k,v){var m=Math.max.apply(null,l.map(function(x){return x[v]}).concat([1]));return '<div class="ca"><h2>'+t+'</h2>'+(l.length?l.map(function(x){return '<div class="fila"><span class="n" title="'+esc(x[k])+'">'+esc(x[k])+'</span><span class="b"><i style="width:'+Math.round(100*x[v]/m)+'%"></i></span><span class="v">'+x[v]+'</span></div>'}).join(''):'<span class="av">Sin datos en este período.</span>')+'</div>'}
function cargar(){$("#x").innerHTML='<span class="av">Cargando…</span>';fetch("/panel/api/web/metricas?d="+$("#d").value).then(function(r){return r.json()}).then(function(m){
 if(!m.ok){$("#x").innerHTML='<div class="ca">'+esc(m.falta||"No se pudo leer PostHog")+'</div>';return}
 var vis=m.serie.reduce(function(a,x){return a+x.vistas},0),uni=m.serie.reduce(function(a,x){return a+x.visitantes},0),mx=Math.max.apply(null,m.serie.map(function(x){return x.vistas}).concat([1]));
 $("#x").innerHTML='<div class="ca"><div class="k"><div><b>'+vis+'</b><span>vistas de página</span></div><div><b>'+uni+'</b><span>visitantes (suma por día)</span></div></div><div class="cols">'+m.serie.map(function(x){return '<div title="'+x.d+': '+x.vistas+' vistas, '+x.visitantes+' visitantes" style="height:'+Math.round(100*x.vistas/mx)+'%"></div>'}).join('')+'</div><div class="eje"><span>'+(m.serie[0]?m.serie[0].d:'')+'</span><span>'+(m.serie.length?m.serie[m.serie.length-1].d:'')+'</span></div></div>'+barras('Páginas más vistas',m.paginas,'p','c')+barras('De dónde llegan',m.fuentes,'f','c')+barras('Eventos de la página (clics, formularios, etc.)',m.eventos,'e','c')}).catch(function(){$("#x").innerHTML='<div class="ca">No se pudo cargar.</div>'})}
function fotoHtml(e){if(!e.claves)return '<h2>Foto para la mesa</h2>Faltan POSTHOG_PERSONAL_KEY y POSTHOG_PROJECT_ID en Cloudflare.';var f=e.foto,pr=e.proxima?new Date(e.proxima).toLocaleDateString("es-AR"):"en la próxima hora";
 return '<h2>Foto para la mesa (cada '+e.cada_dias+' días)</h2><p>'+(f?'Última: '+esc(f.dia)+' · próxima: '+pr:'Todavía no hay foto.')+' <button id="fb">Sacar ahora y que la mesa decida</button></p>'+(f&&f.avisos&&f.avisos.length?'<p class="av">'+f.avisos.map(esc).join('<br>')+'</p>':'')}
function insights(){$("#ins").innerHTML='<span class="av">Cargando tus insights de PostHog…</span>';fetch("/panel/api/web/insights?d="+$("#d").value).then(function(r){return r.json()}).then(function(m){
 if(!m.ok){$("#ins").innerHTML='<div class="ca">'+esc(m.falta||"No se pudieron leer los insights")+'</div>';return}
 $("#ins").innerHTML='<h2 style="margin:18px 0 10px">Tus insights de PostHog (últimos '+m.dias+' días contra los '+m.dias+' anteriores)</h2>'+m.secciones.filter(function(s){return s.nombre!=="Tráfico de la web"}).map(function(s){return '<div class="ca"><h2>'+esc(s.nombre)+(s.tipo==="embudo"?' (embudo)':'')+'</h2>'+(s.tipo==="embudo"?'<p>'+s.lineas.map(esc).join('<br>')+'</p>':'<ol style="margin:0;padding-left:20px">'+s.lineas.map(function(l){return '<li>'+esc(l)+'</li>'}).join('')+'</ol>')+'</div>'}).join('')+(m.avisos&&m.avisos.length?'<p class="av">'+m.avisos.map(esc).join('<br>')+'</p>':'')}).catch(function(){$("#ins").innerHTML='<div class="ca">No se pudieron cargar los insights.</div>'})}
function foto(){fetch("/panel/api/web/foto").then(function(r){return r.json()}).then(function(e){$("#foto").innerHTML=fotoHtml(e);var b=$("#fb");if(b)b.onclick=function(){b.disabled=true;b.textContent="Leyendo PostHog y corriendo la mesa (1 o 2 minutos)…";fetch("/panel/api/web/foto",{method:"POST"}).then(function(r){return r.json()}).then(function(x){if(!x.ok)alert(x.falta||x.motivo||"No se pudo");foto()}).catch(function(){alert("No se pudo");foto()})}}).catch(function(){$("#foto").textContent="No se pudo cargar la foto."})}
$("#d").onchange=function(){cargar();insights()};cargar();foto();insights();
</script></body></html>`;

// ---------------------------------------------------------------------------------------------------------------
// FOTO PARA LA MESA (cada 14 días): trae los insights guardados en PostHog (los de "My insights": clics a WhatsApp por
// producto y destino, categorías más vistas, qué buscan, el embudo de compra, y cualquiera que se agregue después),
// los recalcula para los últimos 14 días contra los 14 anteriores y deja un resumen en texto para los agentes de la mesa.
// La clave personal necesita permiso de lectura de insights además del de consultas. Si no puede listar los insights,
// usa consultas fijas de respaldo (clics a WhatsApp y embudo de la tienda).
export const FOTO_CADA_DIAS = 14;
const hostApi = (env) => String(env.POSTHOG_HOST || "https://us.i.posthog.com").replace(/\/+$/, "").replace("i.posthog.com", "posthog.com");
const api = async (env, ruta, cuerpo = null) => {
  const r = await fetch(`${hostApi(env)}/api/projects/${encodeURIComponent(env.POSTHOG_PROJECT_ID)}/${ruta}`, { method: cuerpo ? "POST" : "GET", signal: AbortSignal.timeout(25000),
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + env.POSTHOG_PERSONAL_KEY }, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.detail || j?.error || `PostHog respondió ${r.status}`);
  return j;
};
const n = (x) => Math.round(+x || 0);
const variacion = (a, b) => (b ? ` (antes ${n(b)}, ${a >= b ? "+" : ""}${Math.round(((a - b) / b) * 100)}%)` : b === 0 && a ? " (antes 0)" : "");
const etiqueta = (s) => { const b = s.breakdown_value; const v = Array.isArray(b) ? b.join(" / ") : b; return String(v != null && v !== "" ? v : s.label || s.action?.name || "total").slice(0, 60); };
const totalSerie = (s) => (s.aggregated_value != null ? +s.aggregated_value : s.count != null ? +s.count : (s.data || []).reduce((a, x) => a + (+x || 0), 0));

// Una tendencia: top 8 valores del período actual con la comparación contra los 14 días anteriores
export function resumirTendencia(res) {
  const actual = {}, antes = {};
  for (const s of res || []) { const d = s.compare_label === "previous" ? antes : actual, k = etiqueta(s); d[k] = (d[k] || 0) + totalSerie(s); }
  const filas = Object.entries(actual).sort((a, b) => b[1] - a[1]);
  const total = filas.reduce((a, [, v]) => a + v, 0), totalAntes = Object.values(antes).reduce((a, v) => a + v, 0);
  const lineas = filas.slice(0, 8).map(([k, v]) => `${k}: ${n(v)}${k in antes ? variacion(v, antes[k]) : ""}`);
  if (!lineas.length) return { lineas: ["sin datos"] };
  return { lineas: filas.length > 1 ? [`total ${n(total)}${Object.keys(antes).length ? variacion(total, totalAntes) : ""}`, ...lineas] : lineas };
}
// Un embudo: cada paso con su cantidad y el % que pasa desde el paso anterior, más la conversión total
export function resumirEmbudo(res) {
  let pasos = res || [];
  if (Array.isArray(pasos[0])) pasos = pasos[0].map((p, i) => ({ ...p, count: pasos.reduce((a, b) => a + (+b[i]?.count || 0), 0) }));   // con desglose: se suman los grupos
  if (!pasos.length) return { lineas: ["sin datos"] };
  const primero = +pasos[0].count || 0;
  const lineas = [pasos.map((p, i) => `${p.custom_name || p.name || "paso " + (i + 1)} ${n(p.count)}${i ? ` (${pasos[i - 1].count ? Math.round((p.count / pasos[i - 1].count) * 100) : 0}% del anterior)` : ""}`).join(" → ")];
  if (pasos.length > 1) lineas.push(`conversión total ${primero ? Math.round(((+pasos[pasos.length - 1].count || 0) / primero) * 1000) / 10 : 0}%`);
  return { lineas };
}

async function insightsGuardados(env) {
  const j = await api(env, "insights/?saved=true&limit=40");
  return (j.results || []).filter((i) => !i.deleted && /^(TrendsQuery|FunnelsQuery)$/.test(i.query?.source?.kind || "")).slice(0, 15);
}
const porProp = (prop, d) => `SELECT coalesce(nullIf(toString(properties.${prop}), ''), '(sin ${prop})') k, countIf(timestamp >= now() - INTERVAL ${d} DAY) a, countIf(timestamp < now() - INTERVAL ${d} DAY) b FROM events WHERE event = 'whatsapp_click' AND timestamp >= now() - INTERVAL ${2 * d} DAY GROUP BY k ORDER BY a DESC LIMIT 8`;
const ORDEN_EMBUDO = ["$pageview", "catalog_filter", "add_to_cart", "checkout_shipping_completed", "order_placed"];
const RESPALDO = [
  { nombre: "Clics a WhatsApp por producto", tipo: "tendencia", sql: (d) => porProp("producto", d) },
  { nombre: "Clics a WhatsApp por destino", tipo: "tendencia", sql: (d) => porProp("destino", d) },
  { nombre: "Embudo de la tienda (personas por paso)", tipo: "embudo", sql: (d) => `SELECT event k, count(DISTINCT person_id) a FROM events WHERE event IN (${ORDEN_EMBUDO.map((e) => `'${e}'`).join(",")}) AND timestamp >= now() - INTERVAL ${d} DAY GROUP BY k` },
];

export async function fotoWeb(env, { dias = FOTO_CADA_DIAS, ahora = Date.now() } = {}) {
  if (!env.POSTHOG_PERSONAL_KEY || !env.POSTHOG_PROJECT_ID) return { ok: false, falta: "Faltan las variables POSTHOG_PERSONAL_KEY y POSTHOG_PROJECT_ID en Cloudflare." };
  const secciones = [], avisos = [];
  let lista = [];
  try { lista = await insightsGuardados(env); } catch (e) { avisos.push("No pude listar los insights guardados (" + String(e?.message || e).slice(0, 120) + "); usé las consultas de respaldo. Revisá que la clave personal tenga permiso de lectura de insights."); }
  for (const ins of lista) {
    const src = { ...ins.query.source, dateRange: { date_from: `-${dias}d`, date_to: null } };
    const embudo = src.kind === "FunnelsQuery";
    if (!embudo) src.compareFilter = { compare: true };
    try {
      const r = await api(env, "query/", { query: src });
      secciones.push({ nombre: String(ins.name || ins.derived_name || "Insight " + ins.short_id).slice(0, 120), tipo: embudo ? "embudo" : "tendencia", ...(embudo ? resumirEmbudo(r.results) : resumirTendencia(r.results)) });
    } catch (e) { avisos.push(`"${ins.name || ins.derived_name || ins.short_id}" no se pudo calcular: ${String(e?.message || e).slice(0, 100)}`); }
  }
  if (!secciones.length) for (const q of RESPALDO) {
    try {
      const filas = (await api(env, "query/", { query: { kind: "HogQLQuery", query: q.sql(dias) } })).results || [];
      if (q.tipo === "embudo") { const m = Object.fromEntries(filas.map(([k, a]) => [k, +a])); secciones.push({ nombre: q.nombre, tipo: "embudo", ...resumirEmbudo(ORDEN_EMBUDO.map((k) => ({ name: k === "$pageview" ? "visitas" : k, count: m[k] || 0 }))) }); }
      else secciones.push({ nombre: q.nombre, tipo: "tendencia", lineas: filas.length ? filas.map(([k, a, b]) => `${k}: ${n(a)}${variacion(+a, +b)}`) : ["sin datos"] });
    } catch (e) { avisos.push(`${q.nombre}: ${String(e?.message || e).slice(0, 100)}`); }
  }
  const web = await metricasWeb(env, dias).catch(() => null);
  if (web?.ok) secciones.unshift({ nombre: "Tráfico de la web", tipo: "tendencia", lineas: [`${web.serie.reduce((a, x) => a + x.vistas, 0)} vistas de página`, `de dónde llegan: ${web.fuentes.slice(0, 5).map((f) => `${f.f} ${f.c}`).join(", ") || "-"}`, `páginas más vistas: ${web.paginas.slice(0, 5).map((p) => `${p.p} ${p.c}`).join(", ") || "-"}`] });
  if (!secciones.length) return { ok: false, falta: avisos.join(" · ") || "PostHog no devolvió datos." };
  const dia = new Date(ahora - 3 * 3600e3).toISOString().slice(0, 10);
  const texto = secciones.map((s) => `${s.nombre}${s.tipo === "embudo" ? " (embudo)" : ""}: ${s.lineas.join(" · ")}`).join("\n").slice(0, 6000);
  return { ok: true, ts: ahora, dia, dias, secciones, avisos, texto };
}
