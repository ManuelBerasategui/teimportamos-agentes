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
    return { ok: true, dias: n, serie: serie.map(([d, v, u]) => ({ d, vistas: +v, visitantes: +u })), paginas: paginas.map(([p, c]) => ({ p: p || "/", c: +c })), fuentes: fuentes.map(([f, c]) => ({ f: nombreValor(f), c: +c })), eventos: eventos.map(([e, c]) => ({ e, n: nombreEvento(e), c: +c })) };
  } catch (e) { return { ok: false, falta: "No pude leer PostHog: " + String(e?.message || e).slice(0, 200) }; }
}
export const PANEL_WEB = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Métricas de la web</title>
<style>
:root{--bg:#f9f9f7;--ca:#fcfcfb;--tx:#0b0b0b;--tx2:#52514e;--mu:#898781;--bo:rgba(11,11,11,.10);--grid:#e1e0d9;--bar:#2a78d6;--otro:#c3c2b7;--up:#006300;--down:#d03b3b;--chip:#f0efec}
@media(prefers-color-scheme:dark){:root{--bg:#0d0d0d;--ca:#1a1a19;--tx:#f0efec;--tx2:#c3c2b7;--mu:#898781;--bo:rgba(255,255,255,.10);--grid:#2c2c2a;--bar:#3987e5;--otro:#55554f;--up:#0ca30c;--down:#e66767;--chip:#262624}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--tx);font:14px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}
.w{max-width:1120px;margin:0 auto;padding:16px 16px 40px}a{color:var(--bar);text-decoration:none}
.top{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;flex-wrap:wrap;margin:6px 0 16px}.top h1{font-size:22px;margin:4px 0 2px;letter-spacing:-.01em}.sub{color:var(--mu);font-size:13px}
.seg{display:inline-flex;background:var(--ca);border:1px solid var(--bo);border-radius:10px;padding:3px}.seg button{border:0;background:none;color:var(--tx2);font:inherit;font-size:13px;padding:6px 12px;border-radius:7px;cursor:pointer}.seg button.on{background:var(--chip);color:var(--tx);font-weight:600}
.ca{background:var(--ca);border:1px solid var(--bo);border-radius:14px;padding:16px 18px}
.mesa{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:16px;padding:12px 16px}.mesa p{margin:0;color:var(--tx2);font-size:13px}.mesa b{color:var(--tx)}
.btn{border:0;background:var(--bar);color:#fff;font:inherit;font-size:13px;font-weight:600;padding:8px 14px;border-radius:9px;cursor:pointer}.btn:disabled{opacity:.6;cursor:wait}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(150px,100%),1fr));gap:12px;margin-bottom:16px}.kpi .l{color:var(--tx2);font-size:13px}.kpi .n{font-size:28px;font-weight:650;letter-spacing:-.02em;margin:4px 0 2px;font-variant-numeric:tabular-nums}.kpi .u{color:var(--mu);font-size:12px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(330px,100%),1fr));gap:16px;margin-bottom:16px}.grid>*,.kpis>*{min-width:0}.full{margin-bottom:16px}
h2{font-size:15px;margin:0;font-weight:650}.hd{display:flex;align-items:baseline;justify-content:space-between;gap:4px 10px;flex-wrap:wrap;margin-bottom:12px}.hd .t{font-size:13px;color:var(--tx2);white-space:nowrap;font-variant-numeric:tabular-nums}.hd .t b{color:var(--tx);font-size:15px}
.it{margin:0 0 10px}.it:last-child{margin-bottom:0}.it .r{display:flex;justify-content:space-between;gap:10px;font-size:13px;margin-bottom:4px}.it .k{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--tx)}.it .v{white-space:nowrap;font-variant-numeric:tabular-nums;color:var(--tx)}
.tr{height:6px;background:var(--grid);border-radius:4px}.tr i{display:block;height:100%;background:var(--bar);border-radius:4px;min-width:2px}.otro .tr i{background:var(--otro)}.otro .k{color:var(--mu)}
.d{display:inline-block;font-size:11.5px;font-weight:600;margin-left:6px;padding:1px 6px;border-radius:6px;background:var(--chip)}.d.up{color:var(--up)}.d.down{color:var(--down)}.d.nu{color:var(--mu);font-weight:500}
.fun .st{margin-bottom:6px}.fun .st .r{display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px}.fun .st .tr{height:22px;border-radius:5px}.fun .st .tr i{border-radius:5px}.fun .pa{color:var(--mu);font-size:12px;margin:2px 0 8px 2px}.fun .tot{margin-top:10px;font-size:13px;color:var(--tx2)}.fun .tot b{color:var(--tx)}
.cols{position:relative;display:flex;align-items:flex-end;gap:3px;height:150px;border-bottom:1px solid var(--grid);padding-top:14px}.cols div{flex:1;background:var(--bar);border-radius:4px 4px 0 0;min-height:2px}.cols div:hover{opacity:.8}.cols .mx{position:absolute;left:0;right:0;top:14px;border-top:1px dashed var(--grid);font-size:11px;color:var(--mu)}.cols .mx span{position:absolute;right:0;top:-15px}
.eje{display:flex;justify-content:space-between;color:var(--mu);font-size:11px;margin-top:6px}
.nota{color:var(--mu);font-size:12px;margin-top:10px}.av{color:var(--mu)}.vacio{color:var(--mu);font-size:13px}
@media(max-width:520px){.w{padding:12px 16px 32px}.ca{padding:14px}.seg button{padding:6px 9px}.kpi .n{font-size:24px}.top h1{font-size:20px}}
</style></head><body><div class="w">
<a href="/panel">← Panel</a>
<div class="top"><div><h1>Métricas de la web</h1><div class="sub" id="sub">Datos de PostHog</div></div>
<div class="seg" id="seg"><button data-d="7">7 días</button><button data-d="14" class="on">14 días</button><button data-d="30">30 días</button><button data-d="90">90 días</button></div></div>
<div id="mesa" class="ca mesa"><p class="av">Cargando…</p></div>
<div id="x"><p class="av">Leyendo PostHog…</p></div>
</div>
<script>
var $=function(s){return document.querySelector(s)},D=14,esc=function(s){return String(s==null?"":s).replace(/[&<>"]/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]})};
var fmt=function(x){return Math.round(+x||0).toLocaleString("es-AR")},dm=function(d){var p=String(d).split("-");return p[2]+"/"+p[1]};
function delta(a,b){if(b==null)return "";if(!b)return a?'<span class="d nu" title="no había datos antes">nuevo</span>':"";if(b<5)return '<span class="d nu" title="antes '+fmt(b)+'">antes '+fmt(b)+'</span>';var p=Math.round((a-b)/b*100);if(!p)return '<span class="d nu" title="antes '+fmt(b)+'">= igual</span>';return '<span class="d '+(p>0?"up":"down")+'" title="antes '+fmt(b)+'">'+(p>0?"▲ +":"▼ ")+p+'%</span>'}
function barras(t,filas,o){o=o||{};if(!filas||!filas.length)return '<div class="ca"><div class="hd"><h2>'+esc(t)+'</h2></div><div class="vacio">Sin datos en este período.</div></div>';
 var mx=Math.max.apply(null,filas.filter(function(f){return !f.otro}).map(function(f){return f.v}).concat([1]));
 return '<div class="ca"><div class="hd"><h2>'+esc(t)+'</h2>'+(o.total!=null?'<span class="t"><b>'+fmt(o.total)+'</b> en total'+delta(o.total,o.totalAntes)+'</span>':'')+'</div>'+filas.map(function(f){return '<div class="it'+(f.otro?" otro":"")+'" title="'+esc(f.k)+": "+fmt(f.v)+(f.antes!=null?" (antes "+fmt(f.antes)+")":"")+'"><div class="r"><span class="k">'+esc(f.k)+'</span><span class="v">'+fmt(f.v)+delta(f.v,f.antes)+'</span></div><div class="tr"><i style="width:'+Math.min(100,Math.round(100*f.v/mx))+'%"></i></div></div>'}).join('')+(o.nota?'<div class="nota">'+esc(o.nota)+'</div>':'')+'</div>'}
function embudo(s){var p=s.pasos||[];if(!p.length)return barras(s.nombre,[]);var p0=p[0].v||1;
 return '<div class="ca fun full"><div class="hd"><h2>'+esc(s.nombre)+'</h2><span class="t">personas por paso</span></div>'+p.map(function(x,i){return (i?'<div class="pa">↓ '+(p[i-1].v?Math.round(x.v/p[i-1].v*100):0)+'% sigue al paso siguiente</div>':'')+'<div class="st" title="'+esc(x.k)+": "+fmt(x.v)+'"><div class="r"><span>'+esc(x.k)+'</span><b>'+fmt(x.v)+'</b></div><div class="tr"><i style="width:'+Math.max(1,Math.round(100*x.v/p0))+'%"></i></div></div>'}).join('')+(p.length>1?'<div class="tot">Conversión total: <b>'+(Math.round((p[p.length-1].v/p0)*1000)/10).toLocaleString("es-AR")+'%</b></div>':'')+(s.nota?'<div class="nota">'+esc(s.nota)+'</div>':'')+'</div>'}
function kpi(l,v,b,u){return '<div class="ca kpi"><div class="l">'+esc(l)+'</div><div class="n">'+fmt(v)+'</div><div class="u">'+(delta(v,b)||"")+(u?' '+esc(u):'')+'</div></div>'}
function pintar(m,ins){var h="",sec=(ins&&ins.ok?ins.secciones:[]).filter(function(s){return s.nombre!=="Tráfico de la web"});
 $("#sub").textContent="Datos de PostHog · últimos "+D+" días"+(ins&&ins.ok?", comparados con los "+D+" anteriores":"");
 var tiles=sec.filter(function(s){return s.tipo==="tendencia"&&s.filas&&s.filas.length===1&&!s.desglose}),listas=sec.filter(function(s){return s.tipo==="tendencia"&&tiles.indexOf(s)<0}),funs=sec.filter(function(s){return s.tipo==="embudo"});
 var k="";if(m&&m.ok&&!tiles.some(function(s){return /^Vistas de página/.test(s.nombre)})){var vis=m.serie.reduce(function(a,x){return a+x.vistas},0);k+=kpi("Vistas de página",vis,null,"en "+D+" días")}
 tiles.forEach(function(s){k+=kpi(s.nombre,s.filas[0].v,s.filas[0].antes,s.unidad||"")});
 if(k)h+='<div class="kpis">'+k+'</div>';
 if(m&&m.ok&&m.serie.length){var mx=Math.max.apply(null,m.serie.map(function(x){return x.vistas}).concat([1])),mid=m.serie[Math.floor(m.serie.length/2)];
  h+='<div class="ca full"><div class="hd"><h2>Vistas por día</h2><span class="t">pasá el mouse por cada barra</span></div><div class="cols"><div class="mx"><span>'+fmt(mx)+'</span></div>'+m.serie.map(function(x){return '<div title="'+dm(x.d)+': '+fmt(x.vistas)+' vistas, '+fmt(x.visitantes)+' visitantes" style="height:'+Math.max(1,Math.round(100*x.vistas/mx))+'%"></div>'}).join('')+'</div><div class="eje"><span>'+dm(m.serie[0].d)+'</span><span>'+dm(mid.d)+'</span><span>'+dm(m.serie[m.serie.length-1].d)+'</span></div></div>'}
 funs.forEach(function(s){h+=embudo(s)});
 if(listas.length)h+='<div class="grid">'+listas.map(function(s){return barras(s.nombre,s.filas,{total:s.filas.length>1?s.total:null,totalAntes:s.totalAntes,nota:s.unidad})}).join('')+'</div>';
 if(m&&m.ok){var hayRef=listas.some(function(s){return /De dónde llegan/.test(s.nombre)});
  h+='<div class="grid">'+barras("Páginas más vistas",m.paginas.map(function(x){return{k:x.p,v:x.c}}))+(hayRef?"":barras("De dónde llegan",m.fuentes.map(function(x){return{k:x.f,v:x.c}})))+barras("Lo que hace la gente en la página",m.eventos.map(function(x){return{k:x.n||x.e,v:x.c}}))+'</div>'}
 else if(m&&m.falta)h+='<div class="ca full">'+esc(m.falta)+'</div>';
 var av=(ins&&ins.avisos||[]).concat(ins&&!ins.ok&&ins.falta?[ins.falta]:[]);if(av.length)h+='<p class="nota">'+av.map(esc).join('<br>')+'</p>';
 $("#x").innerHTML=h||'<div class="ca">PostHog no devolvió datos.</div>'}
var J=function(u,o){return fetch(u,o).then(function(r){return r.json()}).catch(function(){return null})};
function cargar(){$("#x").innerHTML='<p class="av">Leyendo PostHog…</p>';Promise.all([J("/panel/api/web/metricas?d="+D),J("/panel/api/web/insights?d="+D)]).then(function(r){pintar(r[0],r[1])})}
function mesa(){J("/panel/api/web/foto").then(function(e){if(!e){$("#mesa").innerHTML='<p>No se pudo cargar.</p>';return}
 if(!e.claves){$("#mesa").innerHTML='<p>Faltan POSTHOG_PERSONAL_KEY y POSTHOG_PROJECT_ID en Cloudflare.</p>';return}
 var f=e.foto,pr=e.proxima?new Date(e.proxima).toLocaleDateString("es-AR",{day:"2-digit",month:"2-digit"}):"en la próxima hora";
 $("#mesa").innerHTML='<p><b>La mesa de agentes analiza estos datos cada '+e.cada_dias+' días</b> y te manda decisiones.<br>'+(f?'Último análisis: '+dm(f.dia)+' · próximo: '+pr:'Todavía no analizó la web.')+'</p><button class="btn" id="fb">Analizar ahora</button>';
 $("#fb").onclick=function(){var b=this;b.disabled=true;b.textContent="Analizando (1 o 2 minutos)…";J("/panel/api/web/foto",{method:"POST"}).then(function(x){if(!x||!x.ok)alert((x&&(x.falta||x.motivo))||"No se pudo");mesa()})}})}
[].forEach.call(document.querySelectorAll("#seg button"),function(b){b.onclick=function(){D=+b.dataset.d;[].forEach.call(document.querySelectorAll("#seg button"),function(x){x.className=x===b?"on":""});cargar()}});
cargar();mesa();
</script></body></html>`;

// ---------------------------------------------------------------------------------------------------------------
// FOTO PARA LA MESA (cada 14 días): trae los insights guardados en PostHog (los de "My insights": clics a WhatsApp por
// producto y destino, categorías más vistas, qué buscan, el embudo de compra, y cualquiera que se agregue después),
// los recalcula para los últimos 14 días contra los 14 anteriores y deja un resumen en texto para los agentes de la mesa.
// El panel /panel/web usa lo mismo en vivo (filas y pasos ya con nombres en castellano).
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
// Con menos de 5 en el período anterior el % no dice nada (ej. el tracking recién empezaba): se muestra solo "antes N"
const variacion = (a, b) => (b == null ? "" : !b ? (a ? " (nuevo)" : "") : b < 5 ? ` (antes ${n(b)})` : ` (antes ${n(b)}, ${a >= b ? "+" : ""}${Math.round(((a - b) / b) * 100)}%)`);

// Nombres en castellano: eventos de la página, valores de PostHog e insights por defecto
const EVENTOS = { $pageview: "Visitas", $screen: "Pantallas", $autocapture: "Clics", "Viewed a page": "Vio una página", "Clicked something": "Hizo clic en algo",
  whatsapp_click: "Clics a WhatsApp", catalog_filter: "Filtró el catálogo", catalog_search: "Buscó en el catálogo", add_to_cart: "Agregó al carrito", checkout_shipping_completed: "Completó el envío", order_placed: "Compró",
  home_quiz_answer: "Respondió el quiz", home_quiz_rubro: "Eligió rubro en el quiz", import_method_selected: "Eligió cómo importar", import_quote_calculated: "Calculó una cotización", import_link_whatsapp: "WhatsApp desde Importar",
  import_screenshot_uploaded: "Subió una captura para importar", minimos_categoria_click: "Vio mínimos por categoría", home_combos_ver_todos: "Vio todos los combos", home_whatsapp_flotante: "Tocó el WhatsApp flotante", home_hero_producto: "Tocó el producto destacado" };
export const nombreEvento = (e) => EVENTOS[e] || String(e || "").replace(/^\$/, "").replace(/_/g, " ");
const PROPS = { producto: "producto", destino: "destino", categoria: "categoría", category: "categoría", query: "búsqueda", termino: "búsqueda", search: "búsqueda", $referring_domain: "origen", $pathname: "página" };
export const nombreValor = (v) => {
  const s = Array.isArray(v) ? v.join(" / ") : String(v ?? "");
  if (/^\$\$_posthog_breakdown_other_\$\$$/.test(s)) return "Otros";
  if (/^\$\$_posthog_breakdown_null_\$\$$/.test(s) || s === "") return "(sin dato)";
  if (s === "$direct") return "Directo (sin origen)";
  return s.replace(/^www\./, "").replace(/^(l|lm|m)\.(instagram|facebook)\.com$/, "$2.com").slice(0, 70);
};
export function nombreInsight(nombre) {
  const s = String(nombre || "").trim();
  const m = s.match(/^(.+?) count by event's (.+)$/i); if (m) return `${nombreEvento(m[1])} por ${PROPS[m[2]] || m[2].replace(/_/g, " ")}`;
  const c = s.match(/^([\w$]+) count$/i); if (c) return nombreEvento(c[1]);
  if (/→/.test(s) && /order_placed/.test(s)) return "Embudo de compra";
  for (const [re, t] of [[/^weekly active users/i, "Usuarios activos por semana"], [/^daily active users/i, "Usuarios activos por día"], [/^pageviews/i, "Vistas de página"], [/^sessions/i, "Sesiones"], [/^active users/i, "Usuarios activos"], [/^top referrers/i, "De dónde llegan"], [/^visit to interaction funnel/i, "De la visita a la interacción"], [/^retention/i, "Retención"]]) if (re.test(s)) return t;
  return s.replace(/\s*\((last|últimos) [^)]*\)\s*$/i, "").slice(0, 120);
};

// El valor de una serie según cómo cuenta PostHog: usuarios por día se promedian, por semana o por mes se toma el último dato; lo demás se suma
const MATH = { dau: "promedio por día", weekly_active: "en la última semana", monthly_active: "en el último mes" };
const valorSerie = (s, math) => {
  const d = (s.data || []).map((x) => +x || 0);
  if (math === "dau" && d.length) return d.reduce((a, x) => a + x, 0) / d.length;
  if ((math === "weekly_active" || math === "monthly_active") && d.length) return d[d.length - 1];
  return s.aggregated_value != null ? +s.aggregated_value : s.count != null ? +s.count : d.reduce((a, x) => a + x, 0);
};

// Una tendencia: top 8 valores del período actual (más "Otros" al final) con la comparación contra el período anterior
export function resumirTendencia(res, math = null) {
  const actual = {}, antes = {};
  let desglose = false;
  for (const s of res || []) {
    if (s.breakdown_value != null) desglose = true;
    const k = s.breakdown_value != null ? nombreValor(s.breakdown_value) : nombreEvento(s.action?.custom_name || s.label || "total");
    const d = s.compare_label === "previous" ? antes : actual; d[k] = (d[k] || 0) + valorSerie(s, math);
  }
  const todas = Object.entries(actual).map(([k, v]) => ({ k, v: Math.round(v), antes: k in antes ? Math.round(antes[k]) : Object.keys(antes).length ? 0 : null, otro: k === "Otros" }));
  if (!todas.length) return { filas: [], desglose, lineas: ["sin datos"] };
  const filas = [...todas.filter((f) => !f.otro).sort((a, b) => b.v - a.v).slice(0, 8), ...todas.filter((f) => f.otro)];
  const total = todas.reduce((a, f) => a + f.v, 0), totalAntes = Object.keys(antes).length ? Math.round(Object.values(antes).reduce((a, v) => a + v, 0)) : null;
  const unidad = MATH[math] || "";
  const lineas = filas.map((f) => `${f.k}: ${f.v}${variacion(f.v, f.antes)}`);
  return { filas, total, totalAntes, desglose, unidad, lineas: filas.length > 1 ? [`total ${total}${variacion(total, totalAntes)}`, ...lineas] : lineas.map((l) => l + (unidad ? ` (${unidad})` : "")) };
}
// Un embudo: cada paso con su cantidad y el % que pasa desde el paso anterior, más la conversión total
export function resumirEmbudo(res) {
  let pasos = res || [];
  if (Array.isArray(pasos[0])) pasos = pasos[0].map((p, i) => ({ ...p, count: pasos.reduce((a, b) => a + (+b[i]?.count || 0), 0) }));   // con desglose: se suman los grupos
  const p = pasos.map((x, i) => ({ k: nombreEvento(x.custom_name || x.name || "paso " + (i + 1)), v: n(x.count) }));
  if (!p.length) return { pasos: [], lineas: ["sin datos"] };
  const lineas = [p.map((x, i) => `${x.k} ${x.v}${i ? ` (${p[i - 1].v ? Math.round((x.v / p[i - 1].v) * 100) : 0}% del anterior)` : ""}`).join(" → ")];
  if (p.length > 1) lineas.push(`conversión total ${p[0].v ? Math.round((p[p.length - 1].v / p[0].v) * 1000) / 10 : 0}%`);
  return { pasos: p, lineas };
}

async function insightsGuardados(env) {
  const j = await api(env, "insights/?saved=true&limit=40");
  return (j.results || []).filter((i) => !i.deleted && /^(TrendsQuery|FunnelsQuery)$/.test(i.query?.source?.kind || "")).slice(0, 15);
}
const porProp = (prop, d) => `SELECT coalesce(nullIf(toString(properties.${prop}), ''), '(sin ${prop})') k, countIf(timestamp >= now() - INTERVAL ${d} DAY) a, countIf(timestamp < now() - INTERVAL ${d} DAY) b FROM events WHERE event = 'whatsapp_click' AND timestamp >= now() - INTERVAL ${2 * d} DAY GROUP BY k ORDER BY a DESC LIMIT 8`;
const personasPorPaso = (eventos, d) => `SELECT event k, count(DISTINCT person_id) a FROM events WHERE event IN (${eventos.map((e) => `'${String(e).replace(/'/g, "")}'`).join(",")}) AND timestamp >= now() - INTERVAL ${d} DAY GROUP BY k`;
const ORDEN_EMBUDO = ["$pageview", "catalog_filter", "add_to_cart", "checkout_shipping_completed", "order_placed"];
const RESPALDO = [
  { nombre: "Clics a WhatsApp por producto", tipo: "tendencia", sql: (d) => porProp("producto", d) },
  { nombre: "Clics a WhatsApp por destino", tipo: "tendencia", sql: (d) => porProp("destino", d) },
  { nombre: "Embudo de compra", tipo: "embudo", eventos: ORDEN_EMBUDO },
];
// Si PostHog devuelve un embudo vacío (pasa con embudos con ventana o filtros estrictos), se cuentan las personas de cada paso sin exigir el orden
async function embudoSuelto(env, eventos, dias) {
  const filas = (await api(env, "query/", { query: { kind: "HogQLQuery", query: personasPorPaso(eventos, dias) } })).results || [];
  const m = Object.fromEntries(filas.map(([k, a]) => [k, +a]));
  return resumirEmbudo(eventos.map((e) => ({ name: e, count: m[e] || 0 })));
}

export async function fotoWeb(env, { dias = FOTO_CADA_DIAS, ahora = Date.now() } = {}) {
  if (!env.POSTHOG_PERSONAL_KEY || !env.POSTHOG_PROJECT_ID) return { ok: false, falta: "Faltan las variables POSTHOG_PERSONAL_KEY y POSTHOG_PROJECT_ID en Cloudflare." };
  const secciones = [], avisos = [];
  let lista = [];
  try { lista = await insightsGuardados(env); } catch (e) { avisos.push("No pude listar los insights guardados (" + String(e?.message || e).slice(0, 120) + "); usé las consultas de respaldo. Revisá que la clave personal tenga permiso de lectura de insights."); }
  for (const ins of lista) {
    const src = { ...ins.query.source, dateRange: { date_from: `-${dias}d`, date_to: null } };
    const embudo = src.kind === "FunnelsQuery", nombre = nombreInsight(ins.name || ins.derived_name || "Insight " + ins.short_id);
    if (!embudo) src.compareFilter = { compare: true };
    try {
      const r = await api(env, "query/", { query: src });
      if (!embudo) { secciones.push({ nombre, tipo: "tendencia", ...resumirTendencia(r.results, src.series?.[0]?.math) }); continue; }
      let e = resumirEmbudo(r.results);
      const eventos = (src.series || []).map((s) => s.event).filter(Boolean);
      if (!e.pasos.length && eventos.length > 1) e = { ...(await embudoSuelto(env, eventos, dias)), nota: "PostHog no devolvió el embudo con sus filtros; son las personas que hicieron cada paso, sin exigir el orden." };
      secciones.push({ nombre, tipo: "embudo", ...e });
    } catch (e) { avisos.push(`"${nombre}" no se pudo calcular: ${String(e?.message || e).slice(0, 100)}`); }
  }
  if (!secciones.length) for (const q of RESPALDO) {
    try {
      if (q.tipo === "embudo") { secciones.push({ nombre: q.nombre, tipo: "embudo", ...(await embudoSuelto(env, q.eventos, dias)), nota: "Personas que hicieron cada paso, sin exigir el orden." }); continue; }
      const filas = (await api(env, "query/", { query: { kind: "HogQLQuery", query: q.sql(dias) } })).results || [];
      const f = filas.map(([k, a, b]) => ({ k: nombreValor(k), v: n(a), antes: n(b) }));
      secciones.push({ nombre: q.nombre, tipo: "tendencia", desglose: true, filas: f, total: f.reduce((a, x) => a + x.v, 0), totalAntes: f.reduce((a, x) => a + x.antes, 0), lineas: f.length ? f.map((x) => `${x.k}: ${x.v}${variacion(x.v, x.antes)}`) : ["sin datos"] });
    } catch (e) { avisos.push(`${q.nombre}: ${String(e?.message || e).slice(0, 100)}`); }
  }
  const web = await metricasWeb(env, dias).catch(() => null);
  if (web?.ok) secciones.unshift({ nombre: "Tráfico de la web", tipo: "tendencia", lineas: [`${web.serie.reduce((a, x) => a + x.vistas, 0)} vistas de página`, `de dónde llegan: ${web.fuentes.slice(0, 5).map((f) => `${f.f} ${f.c}`).join(", ") || "-"}`, `páginas más vistas: ${web.paginas.slice(0, 5).map((p) => `${p.p} ${p.c}`).join(", ") || "-"}`] });
  if (!secciones.length) return { ok: false, falta: avisos.join(" · ") || "PostHog no devolvió datos." };
  const dia = new Date(ahora - 3 * 3600e3).toISOString().slice(0, 10);
  const texto = secciones.map((s) => `${s.nombre}${s.tipo === "embudo" ? " (embudo)" : ""}: ${s.lineas.join(" · ")}`).join("\n").slice(0, 6000);
  return { ok: true, ts: ahora, dia, dias, secciones, avisos, texto };
}
