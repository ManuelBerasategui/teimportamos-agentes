// PostHog → mesa: cada 14 días se traen los insights guardados de PostHog (tendencias y embudos, contra los 14 días
// anteriores), se guardan como foto y la mesa corre con esos datos y avisa. Correr desde cotizador/: node ../tests/sim-posthog-mesa.mjs
import { DatabaseSync } from "node:sqlite";
import fs from "fs";
let ok = 0, mal = 0; const chk = (n, c) => { if (c) { ok++; console.log("✓ " + n); } else { mal++; console.log("FALLA: " + n); } };
const dir = fs.mkdtempSync("/tmp/phmesa-");
for (const f of fs.readdirSync("src")) fs.copyFileSync("src/" + f, dir + "/" + f);
const db = new DatabaseSync(":memory:");
const stmt = (sql, b = []) => ({ bind: (...x) => stmt(sql, x), run: async () => { db.prepare(sql).run(...b); return {}; }, first: async () => db.prepare(sql).get(...b) ?? null, all: async () => ({ results: db.prepare(sql).all(...b) }) });
const env = { DB: { prepare: (s) => stmt(s), batch: async (a) => { for (const x of a) await x.run(); } }, __captura: [], POSTHOG_PERSONAL_KEY: "phx_test", POSTHOG_PROJECT_ID: "123" };
const L = await import(dir + "/lector.js");
const T = await import(dir + "/tablero.js");
const M = await import(dir + "/mesa.js");
const P = await import(dir + "/posthog.js");
await L.prepararLector(env); await T.prepararTablero(env); await M.prepararMesa(env);
db.exec("CREATE TABLE IF NOT EXISTS ig_posts (id TEXT PRIMARY KEY, ts INTEGER, tipo TEXT, media TEXT, en_feed INTEGER, link TEXT, portada TEXT, texto TEXT, formato TEXT, gancho TEXT, alcance INTEGER, vistas INTEGER, guardados INTEGER, compartidos INTEGER, comentarios INTEGER, likes INTEGER, seguidores INTEGER, visitas INTEGER, tiempo_ms INTEGER, actualizado INTEGER)");
db.exec("CREATE TABLE IF NOT EXISTS tt_posts (id TEXT PRIMARY KEY, ts INTEGER, link TEXT, texto TEXT, duracion INTEGER, portada TEXT, vistas INTEGER, likes INTEGER, comentarios INTEGER, compartidos INTEGER, guardados INTEGER, seguidores INTEGER, actualizado INTEGER, guion TEXT)");
db.exec("CREATE TABLE IF NOT EXISTS prospectos (tel TEXT PRIMARY KEY, negocio TEXT, rubro TEXT, ciudad TEXT, estado TEXT, enviado_ts INTEGER, respuesta TEXT, temperatura TEXT, recontacto TEXT, proximo_mensaje TEXT, le_contestamos TEXT, nota TEXT, quien TEXT, act_ts INTEGER)");
db.exec("CREATE TABLE IF NOT EXISTS ig_refs (id TEXT PRIMARY KEY, ts INTEGER, link TEXT, nicho TEXT, que_pasa TEXT, por_que TEXT, usos INTEGER DEFAULT 0, quien TEXT)");
db.exec("CREATE TABLE IF NOT EXISTS ag_mem (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, tipo TEXT, texto TEXT)");

// --- Resúmenes (sin red)
const t = P.resumirTendencia([
  { label: "whatsapp_click", breakdown_value: "Tarjetas NFC", count: 30, compare_label: "current" },
  { label: "whatsapp_click", breakdown_value: "Tarjetas NFC", count: 20, compare_label: "previous" },
  { label: "whatsapp_click", breakdown_value: "Termos", data: [1, 2, 3], compare_label: "current" },
]);
chk("tendencia: ordena por cantidad, compara contra los 14 días anteriores y suma la serie si no viene el total", t.lineas[0] === "total 36 (antes 20, +80%)" && t.lineas[1] === "Tarjetas NFC: 30 (antes 20, +50%)" && t.lineas[2] === "Termos: 6 (nuevo)");
const e = P.resumirEmbudo([{ name: "$pageview", count: 1000 }, { name: "add_to_cart", custom_name: "Agregó al carrito", count: 50 }, { name: "order_placed", count: 5 }]);
chk("embudo: paso a paso con % del anterior y conversión total", /Visitas 1000 → Agregó al carrito 50 \(5% del anterior\) → Compró 5 \(10% del anterior\)/.test(e.lineas[0]) && e.lineas[1] === "conversión total 0.5%");
chk("embudo con desglose: suma los grupos", P.resumirEmbudo([[{ name: "a", count: 10 }, { name: "b", count: 2 }], [{ name: "a", count: 30 }, { name: "b", count: 8 }]]).lineas[0] === "a 40 → b 10 (25% del anterior)");

const o = P.resumirTendencia([{ breakdown_value: "$$_posthog_breakdown_other_$$", count: 165, compare_label: "current" }, { breakdown_value: "NFC PARA RESEÑAS", count: 7, compare_label: "current" }, { breakdown_value: "NFC PARA RESEÑAS", count: 2, compare_label: "previous" }]);
chk("'Otros' de PostHog va con su nombre y al final; con menos de 5 antes no inventa porcentajes", o.filas[0].k === "NFC PARA RESEÑAS" && o.filas[1].k === "Otros" && o.filas[1].otro && o.lineas[1] === "NFC PARA RESEÑAS: 7 (antes 2)");
const muchas = P.resumirTendencia([...Array.from({ length: 20 }, (_, i) => ({ breakdown_value: "termo " + i, count: 40 - i, compare_label: "current" })), { breakdown_value: "$$_posthog_breakdown_other_$$", count: 100, compare_label: "current" }]);
chk("trae todas las filas para el panel, pero la mesa lee 8 y el resto sumado en Otros", muchas.filas.length === 21 && muchas.lineas.length === 10 && muchas.lineas[9] === "Otros: " + (100 + [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19].reduce((a, i) => a + 40 - i, 0)));
const j = P.juntarOtros(muchas.filas, 18);
chk("tocar Otros muestra 10 más: quedan 2 ocultas sumadas al Otros de PostHog", j.length === 19 && j[18].k === "Otros" && j[18].ocultas === 2 && j[18].v === 100 + 22 + 21 && P.juntarOtros(muchas.filas, 50)[20].ocultas === 0);
chk("usuarios activos por día se promedian, no se suman", P.resumirTendencia([{ label: "$pageview", data: [100, 80, 90], compare_label: "current" }], "dau").filas[0].v === 90);
chk("nombres en castellano para insights, eventos y orígenes", P.nombreInsight("whatsapp_click count by event's destino") === "Clics a WhatsApp por destino" && P.nombreInsight("Weekly active users (WAUs)") === "Usuarios activos por semana" && P.nombreInsight("Pageview → catalog_filter → add_to_cart → order_placed user conversion rate") === "Embudo de compra" && P.nombreValor("$direct") === "Directo (sin origen)" && P.nombreValor("l.instagram.com") === "instagram.com");

// --- PostHog simulado: insights guardados como los de "My insights"
const llamadas = []; let listarFalla = false;
const INSIGHTS = [
  { id: 1, short_id: "a", name: "whatsapp_click count by event's producto", query: { kind: "InsightVizNode", source: { kind: "TrendsQuery", series: [{ event: "whatsapp_click" }], breakdownFilter: { breakdown: "producto" }, dateRange: { date_from: "-7d" } } } },
  { id: 2, short_id: "b", name: "Pageview → catalog_filter → add_to_cart → checkout_shipping_completed → order_placed user conversion rate", query: { kind: "InsightVizNode", source: { kind: "FunnelsQuery", series: [] } } },
  { id: 3, short_id: "c", name: "Tabla vieja", query: { kind: "DataTableNode", source: { kind: "EventsQuery" } } },
  { id: 4, short_id: "d", name: "Borrado", deleted: true, query: { kind: "InsightVizNode", source: { kind: "TrendsQuery" } } },
];
globalThis.fetch = async (url, o) => {
  url = String(url); const q = o?.body ? JSON.parse(o.body) : null; llamadas.push({ url, q, auth: o?.headers?.Authorization });
  if (url.includes("api.telegram.org")) return new Response("{}");
  if (url.includes("/insights/")) return listarFalla ? new Response(JSON.stringify({ detail: "API key missing required scope 'insight:read'" }), { status: 403 }) : new Response(JSON.stringify({ results: INSIGHTS }));
  const s = q?.query || {};
  if (s.kind === "TrendsQuery") return new Response(JSON.stringify({ results: [{ breakdown_value: "Tarjetas NFC", count: 42, compare_label: "current" }, { breakdown_value: "Tarjetas NFC", count: 21, compare_label: "previous" }, { breakdown_value: "Llaveros", count: 7, compare_label: "current" }] }));
  if (s.kind === "FunnelsQuery") return new Response(JSON.stringify({ results: [{ name: "$pageview", count: 800 }, { name: "add_to_cart", count: 40 }, { name: "order_placed", count: 4 }] }));
  const sql = s.query || "";
  if (/toDate/.test(sql)) return new Response(JSON.stringify({ results: [["2026-11-10", 100, 40]] }));
  if (/pathname/.test(sql)) return new Response(JSON.stringify({ results: [["/nfc", 60]] }));
  if (/referring/.test(sql)) return new Response(JSON.stringify({ results: [["instagram.com", 70]] }));
  if (/properties\.producto/.test(sql)) return new Response(JSON.stringify({ results: [["Tarjetas NFC", 12, 6]] }));
  if (/properties\.destino/.test(sql)) return new Response(JSON.stringify({ results: [["805", 9, 9]] }));
  if (/order_placed/.test(sql)) return new Response(JSON.stringify({ results: [["$pageview", 500], ["add_to_cart", 25], ["order_placed", 2]] }));
  return new Response(JSON.stringify({ results: [] }));
};

const f = await P.fotoWeb(env);
const qTrend = llamadas.find((l) => l.q?.query?.kind === "TrendsQuery")?.q.query;
chk("la foto trae los insights guardados (tendencias y embudos) y saltea tablas y borrados", f.ok && f.secciones.length === 3 && f.secciones[1].nombre === "Clics a WhatsApp por producto" && f.secciones[2].nombre === "Embudo de compra" && f.secciones[2].tipo === "embudo" && !/Tabla vieja|Borrado/.test(f.texto));
chk("recalcula cada insight con los últimos 14 días contra los 14 anteriores, conservando su desglose", qTrend.dateRange.date_from === "-14d" && qTrend.compareFilter.compare === true && qTrend.breakdownFilter.breakdown === "producto" && qTrend.breakdownFilter.breakdown_limit === 50);
chk("el texto para la mesa trae números y comparación", /Tarjetas NFC: 42 \(antes 21, \+100%\)/.test(f.texto) && /conversión total 0\.5%/.test(f.texto) && /instagram\.com 70/.test(f.texto));
chk("usa la clave personal contra la API de lectura", llamadas.every((l) => l.url.startsWith("https://us.posthog.com/api/projects/123/") && l.auth === "Bearer phx_test"));

listarFalla = true; llamadas.length = 0;
const f2 = await P.fotoWeb(env);
chk("si la clave no puede listar insights, usa las consultas de respaldo y avisa qué permiso falta", f2.ok && /Clics a WhatsApp por producto: Tarjetas NFC: 12 \(antes 6, \+100%\)/.test(f2.texto) && /Visitas 500 → Filtró el catálogo 0/.test(f2.texto) && /insight:read/.test(f2.avisos.join(" ")));
listarFalla = false;
chk("sin claves explica qué falta", /POSTHOG_PERSONAL_KEY/.test((await P.fotoWeb({})).falta) && (await M.cronFotoWeb({ DB: env.DB }, null, Date.now(), null, { forzar: true })).ok === false);

// --- Cron: cada 14 días saca la foto y la mesa corre con esos datos
const prompts = [];
const ia = async (_e, p) => {
  prompts.push(p);
  if (/INTEGRADOR/.test(p)) return { lectura: "La web trae clics de NFC.", decisiones: [{ que: "Abrir cupo de NFC", quien: "Manuel", por_que: "42 clics a WhatsApp por NFC, el doble que antes" }], hipotesis: [], cambio_rumbo: "", mensaje: "NFC: 42 clics a WhatsApp desde la web (+100%). Abrir cupo." };
  if (/^DISCUSIÓN DE LA MESA/.test(p)) return null;
  return { resumen: "ok", hallazgos: [], hipotesis: [], ideas: [], para_manuel: [] };
};
const base = Date.UTC(2026, 10, 18, 15, 5);   // minuto 5
chk("fuera del minuto 5 no hace nada", (await M.cronFotoWeb(env, ia, base + 60e3)).motivo === "no es la hora" && !prompts.length);
const r1 = await M.cronFotoWeb(env, ia, base);
chk("la primera vez saca la foto y la guarda", r1.ok && JSON.parse(db.prepare("SELECT v FROM kv WHERE k='posthog_foto'").get().v).texto.includes("Tarjetas NFC: 42"));
chk("la mesa corre con los datos de la web (agentes de redes, productos e integrador)", r1.mesa && prompts.filter((p) => /WEB \(PostHog, foto del/.test(p) && /Tarjetas NFC: 42/.test(p)).length >= 3 && /AGENTE DE PRODUCTOS[\s\S]*WEB \(PostHog/.test(prompts.join("\n")) && /INTEGRADOR[\s\S]*WEB \(PostHog/.test(prompts.find((p) => /INTEGRADOR/.test(p))));
chk("el agente de WhatsApp no recibe la web (no cambia su foco)", !/WEB \(PostHog/.test(prompts.find((p) => /AGENTE DE WHATSAPP/.test(p)) || ""));
chk("avisa con las decisiones, marcando que son datos nuevos de la web", env.__captura.some((x) => /datos nuevos de la web \(PostHog, últimos 14 días\)/.test(x) && /42 clics/.test(x)));
const n1 = prompts.length;
chk("antes de 14 días no vuelve a consultar", (await M.cronFotoWeb(env, ia, base + 3 * 86400e3)).ok === false && prompts.length === n1);
const r3 = await M.cronFotoWeb(env, ia, base + 14 * 86400e3);
chk("a los 14 días saca otra foto y guarda la anterior", r3.ok && db.prepare("SELECT v FROM kv WHERE k='posthog_foto_ant'").get() && prompts.length > n1);
const est = await M.estadoFotoWeb(env);
chk("el panel ve la foto y cuándo toca la próxima", est.claves && est.foto?.texto && est.proxima === base + 28 * 86400e3);
const h = await M.hechos(env);
chk("las corridas de todos los días también ven la última foto", /WEB \(PostHog/.test(M.textoHechos(h)) && !/WEB \(PostHog/.test(M.textoHechos(h, ["embudo"])));
chk("la página del panel muestra la foto y el botón", /\/panel\/api\/web\/foto/.test(P.PANEL_WEB) && /Analizar ahora/.test(P.PANEL_WEB));
chk("la página del panel muestra cada insight en vivo (números, barras con variación y embudo)", /\/panel\/api\/web\/insights/.test(P.PANEL_WEB) && /function embudo/.test(P.PANEL_WEB) && /function kpi/.test(P.PANEL_WEB) && !/<pre/.test(P.PANEL_WEB));

console.log(`\nsim-posthog-mesa: ${ok} ok, ${mal} fallas`); process.exit(mal ? 1 : 0);
