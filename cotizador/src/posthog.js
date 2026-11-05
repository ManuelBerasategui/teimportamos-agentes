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
<a href="/panel">← Panel</a><h1>Métricas de la web <select id="d"><option value="7">7 días</option><option value="14" selected>14 días</option><option value="30">30 días</option><option value="90">90 días</option></select></h1><div id="x" class="av">Cargando…</div>
<script>
var $=function(s){return document.querySelector(s)},esc=function(s){return String(s).replace(/[&<>"]/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]})};
function barras(t,l,k,v){var m=Math.max.apply(null,l.map(function(x){return x[v]}).concat([1]));return '<div class="ca"><h2>'+t+'</h2>'+(l.length?l.map(function(x){return '<div class="fila"><span class="n" title="'+esc(x[k])+'">'+esc(x[k])+'</span><span class="b"><i style="width:'+Math.round(100*x[v]/m)+'%"></i></span><span class="v">'+x[v]+'</span></div>'}).join(''):'<span class="av">Sin datos en este período.</span>')+'</div>'}
function cargar(){$("#x").innerHTML='<span class="av">Cargando…</span>';fetch("/panel/api/web/metricas?d="+$("#d").value).then(function(r){return r.json()}).then(function(m){
 if(!m.ok){$("#x").innerHTML='<div class="ca">'+esc(m.falta||"No se pudo leer PostHog")+'</div>';return}
 var vis=m.serie.reduce(function(a,x){return a+x.vistas},0),uni=m.serie.reduce(function(a,x){return a+x.visitantes},0),mx=Math.max.apply(null,m.serie.map(function(x){return x.vistas}).concat([1]));
 $("#x").innerHTML='<div class="ca"><div class="k"><div><b>'+vis+'</b><span>vistas de página</span></div><div><b>'+uni+'</b><span>visitantes (suma por día)</span></div></div><div class="cols">'+m.serie.map(function(x){return '<div title="'+x.d+': '+x.vistas+' vistas, '+x.visitantes+' visitantes" style="height:'+Math.round(100*x.vistas/mx)+'%"></div>'}).join('')+'</div><div class="eje"><span>'+(m.serie[0]?m.serie[0].d:'')+'</span><span>'+(m.serie.length?m.serie[m.serie.length-1].d:'')+'</span></div></div>'+barras('Páginas más vistas',m.paginas,'p','c')+barras('De dónde llegan',m.fuentes,'f','c')+barras('Eventos de la página (clics, formularios, etc.)',m.eventos,'e','c')}).catch(function(){$("#x").innerHTML='<div class="ca">No se pudo cargar.</div>'})}
$("#d").onchange=cargar;cargar();
</script></body></html>`;
