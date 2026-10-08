// Pestaña "Redes" del panel: /panel/redes (Instagram).
// Los datos de Instagram los guarda el worker "instagram" en D1 (ig_posts, ig_dms, kv ig_cuenta) cada 2 horas;
// los DMs, cada 30 min. Acá solo se leen, se generan ideas y reportes con Gemini, y se charla con el agente.
// Nada de esto publica en Instagram ni le manda mensajes a nadie.
import { telegram } from "./lector.js";

// Copia idéntica de instagram/src/sync.js (la simulación verifica que sean iguales)
export const ESQUEMA_IG = [
  "CREATE TABLE IF NOT EXISTS ig_posts (id TEXT PRIMARY KEY, ts INTEGER, tipo TEXT, media TEXT, en_feed INTEGER, link TEXT, portada TEXT, texto TEXT, formato TEXT, gancho TEXT, alcance INTEGER, vistas INTEGER, guardados INTEGER, compartidos INTEGER, comentarios INTEGER, likes INTEGER, seguidores INTEGER, visitas INTEGER, tiempo_ms INTEGER, actualizado INTEGER)",
  "CREATE INDEX IF NOT EXISTS ig_posts_ts ON ig_posts(ts)",
  "CREATE TABLE IF NOT EXISTS ig_dms (conv TEXT PRIMARY KEY, usuario TEXT, usuario_id TEXT, ult_texto TEXT, ult_ts INTEGER, ult_yo INTEGER, actualizado INTEGER)",
  "CREATE INDEX IF NOT EXISTS ig_dms_pend ON ig_dms(ult_yo, ult_ts)",
];
const ESQUEMA_REDES = [
  "CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT, exp INTEGER)",
  "CREATE TABLE IF NOT EXISTS ig_ideas (id TEXT PRIMARY KEY, ts INTEGER, lote TEXT, titulo TEXT, formato TEXT, gancho TEXT, guion TEXT, cta TEXT, por_que TEXT, producto TEXT, hipotesis TEXT, estado TEXT DEFAULT 'nueva', pedido_por TEXT)",
  "CREATE INDEX IF NOT EXISTS ig_ideas_estado ON ig_ideas(estado, ts)",
  "CREATE TABLE IF NOT EXISTS ig_reportes (id TEXT PRIMARY KEY, ts INTEGER, datos TEXT, texto TEXT)",
  "CREATE INDEX IF NOT EXISTS ig_reportes_ts ON ig_reportes(ts)",
];
// Copia de instagram/src/sync.js
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
const PROHIBIDO = /\b(vapes?|vapers?|vapeador|elf ?bar|lost ?mary|pods? desechables?|puffs?|cigarrillos?|tabaco|nicotina|medicamentos?|f[aá]rmacos?|suplementos?|drogas?|marihuana|cannabis|thc|cbd|armas?|r[eé]plicas?)\b/i;
// Lo que aprendimos en el diagnóstico del 8/10/2026 (120 publicaciones). Se usa como base para las ideas.
const APRENDIZAJES_BASE = `- La historia real de un cliente contada a cámara es el mejor formato (mediana 22.503 cuentas vs ~1.500 del resto). La historia del estadio pasó de 3.726 a 22.503 y a 247.098 en tres versiones: repetir una idea que funcionó, mejorada, sirve.
- Un número o una pregunta concreta en el primer segundo ("vendí a 10.200, ¿querés saber cuánto me quedó?", "tres millones") hace que se queden. Reels con más de 18 s de tiempo visto promedio: mediana 2.052; con menos de 13 s: 492.
- La serie "Vendí esto por ML" se gastó: los primeros llegaron a 64 mil, después casi todos quedaron en 1.500 o menos.
- "ML vs China Parte 1" se subió 18 veces sin Parte 2: no funciona. Arrancar con una pantalla tampoco.
- Carruseles (mediana 828) y fotos (477) no traen gente nueva. Los reels de prueba de ~1.500 cuentas son el piso normal.`;
const NEGOCIO = `"Te Importamos" (Rosario, Argentina): importación por encargo, nos encargamos de todo (buscar proveedor, aduana, envío). No hay stock: todo por encargo. Orígenes: China (principal), EE. UU. (originales de marca), Paraguay, Brasil.
Tarifa China real: honorarios USD 80 por operación + handling USD 30 + flete aéreo USD 18/kg hasta 50 kg (50 a 250 kg USD 950 fijo) + impuestos aprox. 30%. Aéreo 10 a 15 días, barco 40 a 60. Mínimos: tecnología, bazar y perfumes 5 u.; ropa 10 u.; zapatillas 3 pares. Cupos: varios clientes se juntan para llegar al mínimo.
Clientes: revendedores chicos y emprendedores (el grueso), negocios que piden insumos, consumidor final que quiere algo original de EE. UU.
NUNCA: vapes, tabaco, fármacos, suplementos, drogas, armas, réplicas. No prometer ganancias ni "hacerse millonario", ni envío gratis, ni precios no confirmados, ni decir "tenemos stock". CTA siempre a DM o al WhatsApp 341 805-1515.`;

const AR = 3 * 3600e3;
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
const kvGet = async (env, k) => (await env.DB.prepare("SELECT v FROM kv WHERE k=?").bind(k).first())?.v ?? null;
const kvPut = (env, k, v) => env.DB.prepare("INSERT INTO kv (k,v,exp) VALUES (?,?,NULL) ON CONFLICT(k) DO UPDATE SET v=excluded.v, exp=NULL").bind(k, String(v)).run();
const id = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const fecha = (ts) => new Date(ts - AR).toISOString().slice(0, 16).replace("T", " ").replace(/^(\d+)-(\d+)-(\d+)/, "$3/$2");
const n0 = (v) => (v == null ? "-" : Math.round(v).toLocaleString("es-AR"));
const pct = (a, b) => (a == null || !b ? null : Math.round(((a - b) / b) * 100));
export function mediana(xs) { const v = xs.filter((x) => x != null).sort((a, b) => a - b); if (!v.length) return null; const m = v.length >> 1; return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2; }

const listo = new WeakSet();
export async function prepararRedes(env) {
  if (listo.has(env.DB)) return;
  await env.DB.batch([...ESQUEMA_REDES, ...ESQUEMA_IG].map((s) => env.DB.prepare(s)));
  listo.add(env.DB);
}

// ---------- Datos ----------
export function statsFormatos(posts) {
  const g = {};
  for (const p of posts) if (p.tipo === "REELS" && p.alcance != null) (g[p.formato || "sin_clasificar"] ||= []).push(p);
  return Object.entries(g).map(([f, ps]) => {
    const alc = ps.reduce((s, p) => s + (p.alcance || 0), 0);
    return { formato: f, nombre: FORMATOS[f] || "Sin clasificar", reels: ps.length, alcance_mediano: mediana(ps.map((p) => p.alcance)), mejor: Math.max(...ps.map((p) => p.alcance || 0)),
      tiempo_s: mediana(ps.map((p) => (p.tiempo_ms != null ? p.tiempo_ms / 1000 : null))), guardados_mil: alc ? Math.round((ps.reduce((s, p) => s + (p.guardados || 0), 0) / alc) * 10000) / 10 : null,
      compartidos_mil: alc ? Math.round((ps.reduce((s, p) => s + (p.compartidos || 0), 0) / alc) * 10000) / 10 : null };
  }).sort((a, b) => (b.alcance_mediano || 0) - (a.alcance_mediano || 0));
}
async function posts(env, dias) {
  return (await env.DB.prepare("SELECT id, ts, tipo, media, en_feed, link, portada, texto, formato, gancho, alcance, vistas, guardados, compartidos, comentarios, likes, seguidores, tiempo_ms FROM ig_posts WHERE ts > ? ORDER BY ts DESC LIMIT 400").bind(Date.now() - dias * 86400e3).all()).results || [];
}
async function dmsPendientes(env, limite = 200) {
  return (await env.DB.prepare("SELECT conv, usuario, ult_texto, ult_ts FROM ig_dms WHERE ult_yo = 0 AND ult_ts > ? ORDER BY ult_ts DESC LIMIT ?").bind(Date.now() - 30 * 86400e3, limite).all()).results || [];
}
async function demandaWhatsApp(env, dias = 14) {
  try { return (await env.DB.prepare("SELECT producto, COUNT(*) n FROM w_conv WHERE grupo=0 AND producto<>'' AND ult_ts>=? GROUP BY lower(producto) ORDER BY n DESC LIMIT 20").bind(Date.now() - dias * 86400e3).all()).results || []; }
  catch { return []; }
}
async function comentariosIG(env, dias = 14) {
  try { return ((await env.DB.prepare("SELECT texto FROM ig_comentarios WHERE ts > ? AND tipo IN ('interes','revisar') ORDER BY ts DESC LIMIT 40").bind(Date.now() - dias * 86400e3).all()).results || []).map((x) => x.texto); }
  catch { return []; }
}
const resumenPost = (p) => `${fecha(p.ts)} · ${FORMATOS[p.formato] || p.formato || "sin clasificar"}${p.en_feed === 0 ? " · de prueba" : ""} · alcance ${n0(p.alcance)} · tiempo visto ${p.tiempo_ms ? Math.round(p.tiempo_ms / 1000) + " s" : "-"} · guardados ${n0(p.guardados)} · compartidos ${n0(p.compartidos)}${p.gancho ? ` · gancho: "${p.gancho}"` : ""}${p.texto ? ` · texto: "${String(p.texto).replace(/#\S+/g, "").trim().slice(0, 80)}"` : ""}`;

export async function datosRedes(env) {
  await prepararRedes(env);
  const [cuentaTxt, p60, dms, demanda, comentarios, syncTs, dmsErr, dmsTs] = await Promise.all([kvGet(env, "ig_cuenta"), posts(env, 60), dmsPendientes(env), demandaWhatsApp(env), comentariosIG(env), kvGet(env, "ig_sync_ts"), kvGet(env, "ig_dms_error"), kvGet(env, "ig_dms_sync")]);
  const cuenta = cuentaTxt ? JSON.parse(cuentaTxt) : null;
  const reels = p60.filter((p) => p.tipo === "REELS" && p.alcance != null);
  const porAlcance = [...reels].sort((a, b) => b.alcance - a.alcance);
  return { cuenta, posts: p60, reels, top: porAlcance.slice(0, 8), peores: porAlcance.slice(-5).reverse(), formatos: statsFormatos(p60), dms, demanda, comentarios, sync_ts: +syncTs || null, dms_error: dmsErr || "", dms_ts: +dmsTs || null };
}

function kpis(d) {
  const c = d.cuenta || {}, a = c.d7 || {}, b = c.d7ant || {};
  const seg = (c.seguidores_dia || []).slice(-7).reduce((s, x) => s + (+x.valor || 0), 0);
  const hace7 = Date.now() - 7 * 86400e3;
  const r7 = d.reels.filter((p) => p.ts > hace7);
  return {
    alcance7: a.reach ?? null, alcance7_cambio: pct(a.reach, b.reach), vistas7: a.views ?? null, guardados7: a.saves ?? null, guardados7_cambio: pct(a.saves, b.saves),
    compartidos7: a.shares ?? null, seguidores7: c.seguidores_dia?.length ? seg : null, seguidores_total: c.perfil?.seguidores ?? null, clics_link7: a.profile_links_taps ?? null,
    reels7: r7.length, prueba7: r7.filter((p) => p.en_feed === 0).length, dms_pendientes: d.dms.length,
  };
}

// ---------- Ideas de contenido ----------
export async function generarIdeas(env, iaJSON, quien = "auto", cantidad = 7) {
  const d = await datosRedes(env);
  const previas = (await env.DB.prepare("SELECT titulo, formato, estado FROM ig_ideas ORDER BY ts DESC LIMIT 25").all()).results || [];
  const dmsTxt = d.dms.slice(0, 25).map((x) => String(x.ult_texto || "").slice(0, 120)).filter((t) => t && !t.startsWith("["));
  const r = await iaJSON(env, `Sos el estratega de contenido de Instagram de este negocio:
${NEGOCIO}

El dueño solo se graba; todo lo publica como REEL DE PRUEBA (le llega primero a gente que no lo sigue). Necesita ${cantidad} guiones para grabar esta semana.

LO QUE YA SABEMOS (diagnóstico de 120 publicaciones):
${APRENDIZAJES_BASE}

RENDIMIENTO POR FORMATO, ÚLTIMOS 60 DÍAS (datos reales de la API):
${d.formatos.map((f) => `- ${f.nombre}: ${f.reels} reels, alcance mediano ${n0(f.alcance_mediano)}, mejor ${n0(f.mejor)}, tiempo visto mediano ${f.tiempo_s ? Math.round(f.tiempo_s) + " s" : "-"}, guardados cada mil ${f.guardados_mil ?? "-"}`).join("\n") || "sin datos todavía"}

MEJORES REELS (60 días):
${d.top.map(resumenPost).join("\n") || "sin datos"}
PEORES REELS (60 días):
${d.peores.map(resumenPost).join("\n") || "sin datos"}

LO QUE MÁS PIDEN POR WHATSAPP (últimos 14 días, chats reales): ${d.demanda.map((x) => `${x.producto} (${x.n})`).join(", ") || "sin datos"}
LO QUE PREGUNTAN EN COMENTARIOS DE INSTAGRAM: ${d.comentarios.slice(0, 25).map((t) => `"${String(t).slice(0, 100)}"`).join(" | ") || "sin datos"}
LO QUE ESCRIBEN POR DM (sin responder): ${dmsTxt.map((t) => `"${t}"`).join(" | ") || "sin datos"}

IDEAS QUE YA SE DIERON (no repetir el mismo título; si una "grabada" funcionó, se puede proponer una versión mejorada):
${previas.map((x) => `- ${x.titulo} [${x.formato}] (${x.estado})`).join("\n") || "(ninguna)"}

Reglas para los guiones:
- Mezcla: al menos 2 historias de cliente a cámara (sacadas de lo que piden por WhatsApp o DM), al menos 2 con un número o pregunta concreta en el primer segundo, y al menos 1 de un producto de los más pedidos. Nada de "Parte 1" ni de arrancar con una pantalla.
- El gancho es el texto que va en pantalla en el primer segundo: corto, en minúscula o como habla un pibe de Rosario, que obligue a quedarse.
- Guion: 3 a 6 frases cortas tal como se dicen a cámara, español rioplatense, sin emojis. Duración 20 a 40 segundos.
- Números: solo de la tarifa real de arriba. Si hace falta un precio de producto que no sabés, escribí [precio real] para que lo complete el dueño. No inventes casos con datos falsos: si la historia es un ejemplo, que sea creíble y genérico ("un cliente de Córdoba que revende auriculares").
- "por_que": el dato concreto de arriba en el que te basás (con su número).
- "hipotesis": qué estamos probando con este reel, medible ("gancho con precio en pesos retiene más de 18 s").
Respondé SOLO JSON: {"ideas":[{"titulo":"...","formato":"${Object.keys(FORMATOS).join("|")}","gancho":"...","guion":["...","..."],"cta":"...","por_que":"...","producto":"... o vacío","hipotesis":"..."}]}`);
  const ideas = (r?.ideas || []).filter((x) => x?.titulo && x?.gancho && !PROHIBIDO.test(JSON.stringify(x))).slice(0, cantidad);
  if (!ideas.length) return { ok: false, error: "La IA no respondió o no dio ideas válidas. Probá de nuevo en un minuto." };
  const lote = id();
  await env.DB.batch(ideas.map((x) => env.DB.prepare("INSERT INTO ig_ideas (id, ts, lote, titulo, formato, gancho, guion, cta, por_que, producto, hipotesis, estado, pedido_por) VALUES (?,?,?,?,?,?,?,?,?,?,?,'nueva',?)")
    .bind(id(), Date.now(), lote, String(x.titulo).slice(0, 140), FORMATOS[x.formato] ? x.formato : "otro", String(x.gancho).slice(0, 160), JSON.stringify((Array.isArray(x.guion) ? x.guion : [String(x.guion || "")]).map((t) => String(t).slice(0, 300)).slice(0, 8)),
      String(x.cta || "").slice(0, 160), String(x.por_que || "").slice(0, 300), String(x.producto || "").slice(0, 80), String(x.hipotesis || "").slice(0, 240), quien)));
  return { ok: true, lote, cantidad: ideas.length };
}

// ---------- Reporte semanal ----------
export async function generarReporteRedes(env, iaJSON, { avisar = true, base = "" } = {}) {
  const d = await datosRedes(env);
  const k = kpis(d);
  const hace7 = Date.now() - 7 * 86400e3;
  const semana = d.reels.filter((p) => p.ts > hace7).sort((a, b) => b.alcance - a.alcance);
  const f30 = statsFormatos(d.posts.filter((p) => p.ts > Date.now() - 30 * 86400e3));
  const ia = await iaJSON(env, `Sos el analista de Instagram de ${NEGOCIO.split(":")[0]}. Con estos datos reales, escribí qué aprendimos esta semana y en qué enfocar la próxima. No inventes números: usá solo los de abajo. Español rioplatense, frases cortas, sin emojis.
CUENTA, últimos 7 días vs 7 anteriores: ${JSON.stringify({ alcance: k.alcance7, cambio_alcance_pct: k.alcance7_cambio, guardados: k.guardados7, cambio_guardados_pct: k.guardados7_cambio, compartidos: k.compartidos7, seguidores_nuevos: k.seguidores7, clics_link_perfil: k.clics_link7 })}
REELS DE ESTA SEMANA (${semana.length}, ${k.prueba7} de prueba):
${semana.map(resumenPost).join("\n") || "ninguno"}
FORMATOS, ÚLTIMOS 30 DÍAS: ${f30.map((f) => `${f.nombre}: ${f.reels} reels, mediana ${n0(f.alcance_mediano)}, tiempo visto ${f.tiempo_s ? Math.round(f.tiempo_s) + " s" : "-"}`).join(" | ") || "sin datos"}
DMS SIN RESPONDER: ${k.dms_pendientes}
LO QUE YA SABÍAMOS: ${APRENDIZAJES_BASE}
Respondé SOLO JSON: {"aprendimos":["3 frases, cada una con un número"],"foco":"una frase: qué grabar la semana que viene"}`);
  const datos = { kpis: k, mejores: semana.slice(0, 3).map((p) => ({ link: p.link, formato: p.formato, alcance: p.alcance, tiempo_s: p.tiempo_ms ? Math.round(p.tiempo_ms / 1000) : null, prueba: p.en_feed === 0 })), formatos30: f30.slice(0, 6), aprendimos: ia?.aprendimos || [], foco: ia?.foco || "" };
  const cambio = (v) => (v == null ? "" : ` (${v >= 0 ? "+" : ""}${v}% vs semana anterior)`);
  const lineas = [
    `📊 Instagram · semana al ${fecha(Date.now()).slice(0, 5)}`,
    `Alcance 7 días: ${n0(k.alcance7)}${cambio(k.alcance7_cambio)}`,
    `Seguidores nuevos: ${n0(k.seguidores7)} · Guardados: ${n0(k.guardados7)}${cambio(k.guardados7_cambio)}`,
    `Reels publicados: ${k.reels7} (${k.prueba7} de prueba) · DMs sin responder: ${k.dms_pendientes}`,
    semana[0] ? `Mejor reel: ${FORMATOS[semana[0].formato] || "sin clasificar"}, ${n0(semana[0].alcance)} cuentas ${semana[0].link}` : "",
    datos.aprendimos.length ? "\nQué aprendimos:\n" + datos.aprendimos.map((x) => "• " + x).join("\n") : "",
    datos.foco ? "\nFoco de la semana: " + datos.foco : "",
  ].filter(Boolean);
  const texto = lineas.join("\n");
  const rid = id();
  await env.DB.prepare("INSERT INTO ig_reportes (id, ts, datos, texto) VALUES (?,?,?,?)").bind(rid, Date.now(), JSON.stringify(datos), texto).run();
  if (avisar) await telegram(env, texto + (base ? `\n\nIdeas y DMs en el panel: ${base}/panel/redes` : "")).catch(() => false);
  return { ok: true, id: rid, texto, datos };
}

// Lunes 9:05 (hora Argentina): reporte + ideas nuevas. Lo llama el cron de cada minuto del worker principal.
export async function cronRedes(env, iaJSON, scheduledTime = Date.now(), base = "") {
  const t = new Date(scheduledTime - AR);
  if (t.getUTCDay() !== 1 || t.getUTCHours() !== 9 || t.getUTCMinutes() !== 5) return false;
  const clave = t.toISOString().slice(0, 10);
  await prepararRedes(env);
  if ((await kvGet(env, "redes_semanal")) === clave) return false;
  await kvPut(env, "redes_semanal", clave);
  await generarIdeas(env, iaJSON, "auto").catch((e) => console.log("redes ideas", e?.stack || e));
  await generarReporteRedes(env, iaJSON, { base }).catch((e) => console.log("redes reporte", e?.stack || e));
  return true;
}

// ---------- Charla con el agente de Instagram ----------
export async function preguntarRedes(env, iaJSON, pregunta, historial = []) {
  const q = String(pregunta || "").slice(0, 600);
  const d = await datosRedes(env);
  const ideas = (await env.DB.prepare("SELECT titulo, formato, gancho, estado FROM ig_ideas WHERE estado IN ('nueva','grabada') ORDER BY ts DESC LIMIT 20").all()).results || [];
  const rep = await env.DB.prepare("SELECT texto, ts FROM ig_reportes ORDER BY ts DESC LIMIT 1").first();
  const conv = (historial || []).slice(-6).map((h) => `${h.r === "u" ? "YO" : "AGENTE"}: ${String(h.t).slice(0, 600)}`).join("\n");
  const r = await iaJSON(env, `Sos el agente de Instagram de este negocio y le respondés al dueño en el panel interno. Ahora es ${fecha(Date.now())} (hora Argentina).
${NEGOCIO}
Reglas: usá SOLO los datos de abajo, no inventes números; si no alcanzan, decilo y decí cómo averiguarlo. Primero la respuesta directa, después una lista corta si hace falta. Español rioplatense, sin emojis. Si te pide ideas o guiones, dalos completos (gancho, guion de 3 a 5 frases, por qué). Para DMs, nombrá el @usuario y lo que escribió.
${conv ? "CHARLA PREVIA:\n" + conv + "\n" : ""}
DATOS:
CUENTA: ${JSON.stringify(kpis(d))}
LO QUE YA SABEMOS: ${APRENDIZAJES_BASE}
FORMATOS (60 días): ${d.formatos.map((f) => `${f.nombre}: ${f.reels} reels, mediana ${n0(f.alcance_mediano)}, mejor ${n0(f.mejor)}, tiempo ${f.tiempo_s ? Math.round(f.tiempo_s) + " s" : "-"}`).join(" | ")}
MEJORES REELS: ${d.top.map(resumenPost).join("\n")}
PEORES REELS: ${d.peores.map(resumenPost).join("\n")}
ÚLTIMOS REELS: ${d.reels.slice(0, 10).map(resumenPost).join("\n")}
DMS SIN RESPONDER (${d.dms.length}): ${d.dms.slice(0, 40).map((x) => `@${x.usuario || "?"} hace ${Math.round((Date.now() - x.ult_ts) / 3600e3)} h: "${String(x.ult_texto || "").slice(0, 140)}"`).join("\n") || (d.dms_error ? "no se pueden leer: " + d.dms_error : "ninguno")}
PEDIDOS POR WHATSAPP (14 días): ${d.demanda.map((x) => `${x.producto} (${x.n})`).join(", ") || "sin datos"}
IDEAS GUARDADAS: ${ideas.map((x) => `${x.titulo} [${x.estado}]: "${x.gancho}"`).join(" | ") || "ninguna"}
ÚLTIMO REPORTE: ${rep?.texto || "todavía no hay"}

PREGUNTA: ${q}
Respondé JSON: {"respuesta":"texto"}`);
  return { respuesta: r?.respuesta || "No pude responder ahora (la IA no contestó). Probá de nuevo en un minuto." };
}

// Llama al worker de Instagram por el binding IG (para actualizar al toque desde el panel)
async function llamarIG(env, ruta) {
  if (!env.IG?.fetch) return { ok: false, error: "El panel todavía no está conectado al worker de Instagram (falta el binding IG)." };
  const r = await env.IG.fetch(new Request(`https://instagram${ruta}?clave=${encodeURIComponent(env.VERIFY_TOKEN || "")}`)).catch((e) => ({ ok: false, status: 0, json: async () => ({ error: String(e) }) }));
  const j = await r.json().catch(() => ({ error: "respuesta rara del worker de Instagram (" + r.status + ")" }));
  return r.ok ? { ok: true, ...j } : { ok: false, error: j.error || "error " + r.status };
}

// ---------- API del panel (/panel/api/redes/...) ----------
export async function apiRedes(env, req, url, quien, iaJSON, base = "") {
  await prepararRedes(env);
  const r = url.pathname.replace("/panel/api/redes/", "");
  const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
  if (r === "resumen") {
    const d = await datosRedes(env);
    const rep = await env.DB.prepare("SELECT id, ts, texto, datos FROM ig_reportes ORDER BY ts DESC LIMIT 1").first();
    const nuevas = (await env.DB.prepare("SELECT COUNT(*) n FROM ig_ideas WHERE estado='nueva'").first())?.n || 0;
    return json({ kpis: kpis(d), perfil: d.cuenta?.perfil || null, formatos: d.formatos, reporte: rep ? { ...rep, datos: JSON.parse(rep.datos || "{}") } : null, ideas_nuevas: nuevas, sync_ts: d.sync_ts, dms_ts: d.dms_ts, dms_error: d.dms_error, hay_datos: d.posts.length > 0 });
  }
  if (r === "ideas") {
    const est = ["nueva", "grabada", "descartada"].includes(url.searchParams.get("estado")) ? url.searchParams.get("estado") : "nueva";
    const l = (await env.DB.prepare("SELECT * FROM ig_ideas WHERE estado=? ORDER BY ts DESC LIMIT 60").bind(est).all()).results || [];
    return json(l.map((x) => ({ ...x, guion: JSON.parse(x.guion || "[]") })));
  }
  if (r === "generar-ideas" && req.method === "POST") return json(await generarIdeas(env, iaJSON, quien || "panel"));
  if (r === "idea-estado" && req.method === "POST") {
    if (!["nueva", "grabada", "descartada"].includes(body.estado)) return json({ error: "estado inválido" }, 400);
    await env.DB.prepare("UPDATE ig_ideas SET estado=? WHERE id=?").bind(body.estado, String(body.id || "")).run();
    return json({ ok: true });
  }
  if (r === "dms") { const d = await dmsPendientes(env); return json({ dms: d, error: (await kvGet(env, "ig_dms_error")) || "", ts: +(await kvGet(env, "ig_dms_sync")) || null }); }
  if (r === "actualizar" && req.method === "POST") return json(await llamarIG(env, body.todo ? "/sync" : "/sync-dms"));
  if (r === "reels") {
    const dias = Math.min(365, Math.max(7, +url.searchParams.get("dias") || 60));
    return json((await posts(env, dias)).map((p) => ({ ...p, texto: String(p.texto || "").slice(0, 120) })));
  }
  if (r === "post-formato" && req.method === "POST") {
    if (!FORMATOS[body.formato]) return json({ error: "formato inválido" }, 400);
    await env.DB.prepare("UPDATE ig_posts SET formato=? WHERE id=?").bind(body.formato, String(body.id || "")).run();
    return json({ ok: true });
  }
  if (r === "reporte" && req.method === "POST") return json(await generarReporteRedes(env, iaJSON, { avisar: !!body.telegram, base }));
  if (r === "reportes") return json(((await env.DB.prepare("SELECT id, ts, texto FROM ig_reportes ORDER BY ts DESC LIMIT 12").all()).results || []));
  if (r === "preguntar" && req.method === "POST") return json(await preguntarRedes(env, iaJSON, body.pregunta, body.historial));
  return json({ error: "ruta desconocida" }, 404);
}

export const PANEL_REDES = String.raw`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Redes · Te Importamos</title>
<style>
:root{--nar:#EA5B0C;--fondo:#f5f7fb;--borde:#e3e8f0;--txt:#0f172a;--gris:#64748b;--rojo:#dc2626;--verde:#16a34a;--ambar:#d97706}
*{box-sizing:border-box}body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:var(--fondo);color:var(--txt)}
header{display:flex;align-items:center;gap:14px;padding:12px 16px;background:#0B0B0B;position:sticky;top:0;z-index:5;flex-wrap:wrap}
header b{color:#fff;font-size:18px}header b span{color:var(--nar)}header a{color:#D1D5DB;text-decoration:none;font-weight:600;margin-left:auto}
main{padding:16px;max-width:1100px;margin:0 auto}
.modos{display:flex;gap:6px;margin-bottom:14px;overflow-x:auto}.modos button{flex:1;min-width:max-content;border:1px solid var(--borde);background:#fff;padding:10px 14px;border-radius:10px;font-weight:700;font-size:15px;color:var(--gris);cursor:pointer}
.modos button.on{background:var(--nar);color:#fff;border-color:var(--nar)}.modos .bd{display:inline-block;min-width:20px;padding:0 6px;margin-left:6px;border-radius:99px;background:#fee2e2;color:var(--rojo);font-size:12px;line-height:20px}
.modos button.on .bd{background:#fff}
.card{background:#fff;border:1px solid var(--borde);border-radius:12px;padding:14px;margin-bottom:12px;min-width:0}
h2{font-size:16px;margin:0 0 10px}.estado{font-size:13px;color:var(--gris);font-weight:400}
.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:12px}.kpi{background:#fff;border:1px solid var(--borde);border-radius:12px;padding:12px}
.kpi small{display:block;color:var(--gris);font-size:12px;font-weight:600}.kpi b{display:block;font-size:24px;margin-top:4px}.kpi i{font-style:normal;font-size:12px;font-weight:700}.sube{color:var(--verde)}.baja{color:var(--rojo)}
.btn{border:1px solid var(--borde);background:#fff;padding:8px 12px;border-radius:8px;cursor:pointer;font-weight:600;font-size:14px;color:var(--txt);text-decoration:none;display:inline-block}
.btn.p{background:var(--nar);color:#fff;border-color:var(--nar)}.btn:disabled{opacity:.5;cursor:wait}.btn.ch{padding:5px 10px;font-size:13px}
.fila{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
table{width:100%;border-collapse:collapse;font-size:14px}th{text-align:left;color:var(--gris);font-size:12px;font-weight:700;padding:6px 8px;border-bottom:1px solid var(--borde);white-space:nowrap}
td{padding:8px;border-bottom:1px solid #f0f2f6;vertical-align:top}th.n,td.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}.tabla{overflow-x:auto}
.pill{display:inline-block;padding:2px 8px;border-radius:99px;font-size:12px;font-weight:700;background:#eef2f7;color:var(--gris);white-space:nowrap}.pill.n{background:#ffedd5;color:#c2410c}.pill.pr{background:#ede9fe;color:#6d28d9}
.reporte{white-space:pre-wrap;overflow-wrap:anywhere;font-size:14px;line-height:1.5;background:#fafbfd;border:1px solid var(--borde);border-radius:10px;padding:12px}
.idea{border:1px solid var(--borde);border-radius:12px;padding:14px;margin-bottom:10px;background:#fff}
.idea h3{margin:0 0 6px;font-size:16px}.gancho{background:#0B0B0B;color:#fff;border-radius:10px;padding:12px 14px;font-size:18px;font-weight:800;margin:8px 0;line-height:1.3}
.gancho small{display:block;color:var(--nar);font-size:11px;font-weight:700;letter-spacing:.04em;margin-bottom:4px}
.idea ol{margin:6px 0 8px;padding-left:22px;line-height:1.5;font-size:15px}.idea .pq{font-size:13px;color:var(--gris);margin-top:4px;line-height:1.4}
.dm{display:grid;grid-template-columns:1fr auto;gap:10px;align-items:center;padding:10px 0;border-bottom:1px solid #f0f2f6}.dm:last-child{border-bottom:0}
.dm b{font-size:15px}.dm .t{font-size:14px;color:#334155;margin-top:2px;overflow-wrap:anywhere}.dm .h{font-size:12px;color:var(--gris)}
.nota{background:#fffbeb;border:1px solid #fde68a;color:#92400e;border-radius:8px;padding:10px 12px;font-size:14px;margin-bottom:12px;line-height:1.45}
.vacio{color:var(--gris);font-size:14px;padding:10px 0}
.hilo{height:52vh;overflow-y:auto;display:flex;flex-direction:column;gap:8px;padding:4px}.burb{max-width:85%;padding:10px 12px;border-radius:12px;font-size:15px;line-height:1.45;white-space:pre-wrap}
.burb.u{align-self:flex-end;background:var(--nar);color:#fff}.burb.a{align-self:flex-start;background:#f1f5f9}
.preg{display:flex;gap:8px;margin-top:10px}.preg input{flex:1;padding:10px;border:1px solid var(--borde);border-radius:8px;font-size:15px;font-family:inherit}
select{padding:5px 6px;border:1px solid var(--borde);border-radius:6px;font-size:13px;background:#fff;color:var(--txt);max-width:170px}
.aviso{position:fixed;left:50%;bottom:18px;transform:translateX(-50%);background:#0f172a;color:#fff;padding:10px 16px;border-radius:10px;font-size:14px;display:none;z-index:20;max-width:90vw}
@media(max-width:760px){main{padding:10px}.kpis{grid-template-columns:1fr 1fr}.kpi b{font-size:20px}}
</style></head><body>
<header><b>Te Importamos · <span>Redes</span></b><span class="estado" id="sync" style="color:#9CA3AF"></span><a href="/panel">← Panel</a></header>
<main>
<div class="modos" id="modos"><button data-m="resumen" class="on">Resumen</button><button data-m="ideas">Ideas para grabar<span class="bd" id="bIdeas" style="display:none"></span></button><button data-m="dms">DMs sin responder<span class="bd" id="bDms" style="display:none"></span></button><button data-m="reels">Reels</button><button data-m="agente">Preguntale al agente</button></div>

<div id="m-resumen">
  <div class="nota" id="sinDatos" style="display:none">Todavía no hay datos guardados. El agente de Instagram los trae solo cada 2 horas, o tocá <b>Traer datos ahora</b>.</div>
  <div class="kpis" id="kpis"></div>
  <section class="card"><div class="fila" style="justify-content:space-between"><h2>Reporte semanal <span class="estado" id="repFecha"></span></h2><span class="fila"><button class="btn" id="bTraer">Traer datos ahora</button><button class="btn p" id="bReporte">Generar reporte</button></span></div>
    <div id="reporte" class="vacio">Sale solo los lunes a las 9 y te llega por Telegram.</div></section>
  <section class="card"><h2>Qué formato funciona <span class="estado">reels de los últimos 60 días</span></h2><div class="tabla" id="formatos"></div></section>
</div>

<div id="m-ideas" style="display:none">
  <div class="fila" style="margin-bottom:12px"><button class="btn p" id="bIdeasGen">Generar ideas nuevas</button><select id="fIdeas"><option value="nueva">Para grabar</option><option value="grabada">Ya grabadas</option><option value="descartada">Descartadas</option></select>
  <span class="estado">Salen solas cada lunes a las 9, cruzando métricas, formatos y lo que piden por WhatsApp, comentarios y DMs.</span></div>
  <div id="ideas"><div class="vacio">Cargando...</div></div>
</div>

<div id="m-dms" style="display:none">
  <div class="nota" id="dmErr" style="display:none"></div>
  <section class="card"><div class="fila" style="justify-content:space-between"><h2>DMs sin responder <span class="estado" id="dmTs"></span></h2><button class="btn" id="bDmAct">Actualizar ahora</button></div>
  <div id="dms"><div class="vacio">Cargando...</div></div></section>
</div>

<div id="m-reels" style="display:none">
  <section class="card"><div class="fila" style="justify-content:space-between"><h2>Reels y publicaciones</h2><select id="fDias"><option value="30">30 días</option><option value="60" selected>60 días</option><option value="120">120 días</option></select></div>
  <p class="estado" style="margin-top:0">Si el formato está mal, cambialo: así las ideas aprenden de lo que de verdad funcionó.</p>
  <div class="tabla" id="reels"></div></section>
</div>

<div id="m-agente" style="display:none">
  <section class="card"><h2>Agente de Instagram <span class="estado">conoce tus métricas, formatos, DMs, ideas y lo que piden por WhatsApp</span></h2>
  <div class="hilo" id="hilo"></div>
  <div class="fila" id="sug" style="margin-top:8px"><button class="btn ch">¿Qué grabo hoy?</button><button class="btn ch">¿Qué formato rindió mejor este mes?</button><button class="btn ch">¿A quién le debo respuesta por DM?</button><button class="btn ch">¿Qué producto conviene mostrar esta semana?</button></div>
  <form class="preg" id="fPreg"><input id="pregunta" placeholder="Preguntale lo que quieras" autocomplete="off"><button class="btn p">Enviar</button></form></section>
</div>
</main>
<div class="aviso" id="aviso"></div>
<script>
var $ = function (s) { return document.querySelector(s); };
var FORMATOS = { historia: "Historia de cliente a cámara", reaccion: "Reacción cara tapada", ml_vendi: "Vendí esto por ML", ml_vs_china: "ML vs China", producto: "Producto en mano", pantalla: "Pantalla / calculadora", chatgpt: "Carteles ChatGPT", cronometro: "Cronómetro buscando", comentario: "Responder comentario", otro: "Otro", sin_clasificar: "Sin clasificar" };
var HIST = [];
function esc(t) { return String(t == null ? "" : t).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
function aviso(t) { var a = $("#aviso"); a.textContent = t; a.style.display = "block"; clearTimeout(a._t); a._t = setTimeout(function () { a.style.display = "none"; }, 3500); }
function api(r, body) { return fetch("/panel/api/redes/" + r, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}).then(function (x) { if (x.status === 401) { location.href = "/login?volver=/panel/redes"; throw 0; } return x.json(); }); }
function num(v) { return v == null ? "-" : Math.round(v).toLocaleString("es-AR"); }
function hace(ms) { if (!ms) return "nunca"; var m = Math.round((Date.now() - ms) / 60000); return m < 60 ? "hace " + m + " min" : m < 1440 ? "hace " + Math.round(m / 60) + " h" : "hace " + Math.round(m / 1440) + " d"; }
function fecha(ts) { var d = new Date(ts); return d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" }) + " " + d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" }); }
function cambio(v) { return v == null ? "" : '<i class="' + (v >= 0 ? "sube" : "baja") + '">' + (v >= 0 ? "+" : "") + v + "% vs semana anterior</i>"; }
function modo(m) {
  document.querySelectorAll("#modos button").forEach(function (b) { b.classList.toggle("on", b.dataset.m === m); });
  ["resumen", "ideas", "dms", "reels", "agente"].forEach(function (x) { $("#m-" + x).style.display = x === m ? "" : "none"; });
  if (location.hash.slice(1) !== m) history.replaceState(null, "", "#" + m);
  if (m === "ideas") cargarIdeas(); if (m === "dms") cargarDms(); if (m === "reels") cargarReels(); if (m === "agente") pintarHilo();
}
document.querySelectorAll("#modos button").forEach(function (b) { b.onclick = function () { modo(b.dataset.m); }; });

function cargarResumen() {
  api("resumen").then(function (r) {
    var k = r.kpis || {};
    $("#sinDatos").style.display = r.hay_datos ? "none" : "";
    $("#sync").textContent = "Datos de Instagram: " + hace(r.sync_ts);
    $("#kpis").innerHTML = [["Alcance 7 días", num(k.alcance7), cambio(k.alcance7_cambio)], ["Seguidores nuevos 7 días", num(k.seguidores7), k.seguidores_total ? "<i>" + num(k.seguidores_total) + " en total</i>" : ""],
      ["Guardados 7 días", num(k.guardados7), cambio(k.guardados7_cambio)], ["DMs sin responder", r.dms_error ? "?" : num(k.dms_pendientes), r.dms_error ? '<i class="baja">falta permiso</i>' : ""]].map(function (x) { return '<div class="kpi"><small>' + x[0] + "</small><b>" + x[1] + "</b>" + x[2] + "</div>"; }).join("");
    badge("#bIdeas", r.ideas_nuevas); badge("#bDms", r.dms_error ? 0 : k.dms_pendientes);
    if (r.reporte) { $("#reporte").className = "reporte"; $("#reporte").textContent = r.reporte.texto; $("#repFecha").textContent = fecha(r.reporte.ts); }
    var f = r.formatos || [];
    $("#formatos").innerHTML = f.length ? "<table><tr><th>Formato</th><th class=\"n\">Reels</th><th class=\"n\">Alcance mediano</th><th class=\"n\">Mejor</th><th class=\"n\">Tiempo visto</th><th class=\"n\">Guardados cada mil</th></tr>" + f.map(function (x) {
      return "<tr><td>" + esc(FORMATOS[x.formato] || x.nombre) + '</td><td class="n">' + x.reels + '</td><td class="n"><b>' + num(x.alcance_mediano) + '</b></td><td class="n">' + num(x.mejor) + '</td><td class="n">' + (x.tiempo_s ? Math.round(x.tiempo_s) + " s" : "-") + '</td><td class="n">' + (x.guardados_mil == null ? "-" : x.guardados_mil) + "</td></tr>"; }).join("") + "</table>" : '<div class="vacio">Sin reels guardados todavía.</div>';
  }).catch(function () {});
}
function badge(s, n) { var b = $(s); b.style.display = n ? "" : "none"; b.textContent = n || ""; }
$("#bReporte").onclick = function () { var b = this; b.disabled = true; b.textContent = "Generando..."; api("reporte", { telegram: confirm("¿Mandarlo también por Telegram?") }).then(function (r) { b.disabled = false; b.textContent = "Generar reporte"; if (!r.ok) return aviso(r.error || "No se pudo"); cargarResumen(); aviso("Reporte listo"); }); };
$("#bTraer").onclick = function () { var b = this; b.disabled = true; b.textContent = "Trayendo..."; api("actualizar", { todo: true }).then(function (r) { b.disabled = false; b.textContent = "Traer datos ahora"; aviso(r.ok ? "Listo: " + ((r.posts && r.posts.guardadas) || 0) + " publicaciones actualizadas" : "No se pudo: " + r.error); cargarResumen(); }); };

function cargarIdeas() {
  api("ideas?estado=" + $("#fIdeas").value).then(function (l) {
    $("#ideas").innerHTML = l.length ? l.map(function (x) {
      return '<div class="idea" data-id="' + esc(x.id) + '"><div class="fila" style="justify-content:space-between"><h3>' + esc(x.titulo) + '</h3><span class="fila"><span class="pill n">' + esc(FORMATOS[x.formato] || x.formato) + "</span>" + (x.producto ? '<span class="pill">' + esc(x.producto) + "</span>" : "") + "</span></div>" +
        '<div class="gancho"><small>TEXTO EN PANTALLA, PRIMER SEGUNDO</small>' + esc(x.gancho) + "</div><ol>" + (x.guion || []).map(function (t) { return "<li>" + esc(t) + "</li>"; }).join("") + "</ol>" +
        (x.cta ? "<div><b>Cierre:</b> " + esc(x.cta) + "</div>" : "") + '<div class="pq"><b>Por qué:</b> ' + esc(x.por_que) + "</div>" + (x.hipotesis ? '<div class="pq"><b>Qué probamos:</b> ' + esc(x.hipotesis) + "</div>" : "") +
        '<div class="fila" style="margin-top:10px">' + (x.estado !== "grabada" ? '<button class="btn p ch" data-e="grabada">Ya lo grabé</button>' : "") + (x.estado !== "descartada" ? '<button class="btn ch" data-e="descartada">Descartar</button>' : "") + (x.estado !== "nueva" ? '<button class="btn ch" data-e="nueva">Volver a pendientes</button>' : "") + '<button class="btn ch" data-c="1">Copiar guion</button></div></div>';
    }).join("") : '<div class="vacio">No hay ideas acá. Tocá <b>Generar ideas nuevas</b>.</div>';
    window.__ideas = l;
  });
}
$("#fIdeas").onchange = cargarIdeas;
$("#ideas").onclick = function (ev) {
  var b = ev.target.closest("button"); if (!b) return; var card = b.closest(".idea"), idv = card.dataset.id;
  if (b.dataset.c) { var x = (window.__ideas || []).filter(function (i) { return i.id === idv; })[0]; if (!x) return; navigator.clipboard.writeText("GANCHO: " + x.gancho + "\n\n" + (x.guion || []).map(function (t, i) { return (i + 1) + ". " + t; }).join("\n") + (x.cta ? "\n\nCIERRE: " + x.cta : "")).then(function () { aviso("Guion copiado"); }); return; }
  api("idea-estado", { id: idv, estado: b.dataset.e }).then(function () { card.remove(); cargarResumen(); });
};
$("#bIdeasGen").onclick = function () { var b = this; b.disabled = true; b.textContent = "Pensando ideas..."; api("generar-ideas", {}).then(function (r) { b.disabled = false; b.textContent = "Generar ideas nuevas"; if (!r.ok) return aviso(r.error); $("#fIdeas").value = "nueva"; cargarIdeas(); cargarResumen(); aviso(r.cantidad + " ideas nuevas"); }); };

function cargarDms() {
  api("dms").then(function (r) {
    $("#dmTs").textContent = "actualizado " + hace(r.ts);
    var e = $("#dmErr");
    if (r.error) { e.style.display = ""; e.innerHTML = "<b>No puedo leer los DMs todavía.</b> Al token de Instagram le falta el permiso <b>instagram_business_manage_messages</b>.<br>1. developers.facebook.com → tu app → Casos de uso → Instagram → Personalizar → agregá ese permiso.<br>2. En Configuración de la API con inicio de sesión de Instagram, generá un token nuevo.<br>3. Cloudflare → Workers → instagram → Settings → Variables and Secrets → editá IG_TOKEN → Deploy.<br><small>Detalle: " + esc(r.error) + "</small>"; }
    else e.style.display = "none";
    badge("#bDms", r.error ? 0 : r.dms.length);
    $("#dms").innerHTML = r.dms.length ? r.dms.map(function (d) {
      return '<div class="dm"><div><b>@' + esc(d.usuario || "sin usuario") + '</b> <span class="h">' + hace(d.ult_ts) + '</span><div class="t">' + esc(d.ult_texto) + "</div></div>" +
        (d.usuario ? '<a class="btn p ch" target="_blank" rel="noopener" href="https://ig.me/m/' + encodeURIComponent(d.usuario) + '">Responder</a>' : '<a class="btn ch" target="_blank" rel="noopener" href="https://www.instagram.com/direct/inbox/">Abrir DMs</a>') + "</div>";
    }).join("") : '<div class="vacio">' + (r.error ? "" : "No hay DMs esperando respuesta.") + "</div>";
  });
}
$("#bDmAct").onclick = function () { var b = this; b.disabled = true; api("actualizar", {}).then(function (r) { b.disabled = false; if (!r.ok) aviso("No se pudo: " + r.error); cargarDms(); }); };

function cargarReels() {
  api("reels?dias=" + $("#fDias").value).then(function (l) {
    var ops = Object.keys(FORMATOS).filter(function (k) { return k !== "sin_clasificar"; });
    $("#reels").innerHTML = l.length ? "<table><tr><th>Fecha</th><th>Tipo</th><th>Formato</th><th class=\"n\">Alcance</th><th class=\"n\">Tiempo visto</th><th class=\"n\">Guardados</th><th class=\"n\">Compartidos</th><th class=\"n\">Coment.</th><th></th></tr>" + l.map(function (p) {
      var tipo = p.tipo === "REELS" ? (p.en_feed === 0 ? '<span class="pill pr">Reel de prueba</span>' : '<span class="pill">Reel</span>') : '<span class="pill">' + (p.media === "CAROUSEL_ALBUM" ? "Carrusel" : p.media === "IMAGE" ? "Foto" : "Publicación") + "</span>";
      var sel = p.tipo === "REELS" ? '<select data-id="' + esc(p.id) + '">' + (p.formato ? "" : '<option value="">Sin clasificar</option>') + ops.map(function (k) { return '<option value="' + k + '"' + (p.formato === k ? " selected" : "") + ">" + FORMATOS[k] + "</option>"; }).join("") + "</select>" + (p.gancho ? '<div class="estado" style="margin-top:3px">"' + esc(p.gancho) + '"</div>' : "") : "";
      return "<tr><td style=\"white-space:nowrap\">" + fecha(p.ts) + "</td><td>" + tipo + "</td><td>" + sel + '</td><td class="n"><b>' + num(p.alcance) + '</b></td><td class="n">' + (p.tiempo_ms ? Math.round(p.tiempo_ms / 1000) + " s" : "-") + '</td><td class="n">' + num(p.guardados) + '</td><td class="n">' + num(p.compartidos) + '</td><td class="n">' + num(p.comentarios) + '</td><td><a class="btn ch" target="_blank" rel="noopener" href="' + esc(p.link) + '">Ver</a></td></tr>';
    }).join("") + "</table>" : '<div class="vacio">Sin publicaciones guardadas en este período.</div>';
  });
}
$("#fDias").onchange = cargarReels;
$("#reels").onchange = function (ev) { var s = ev.target; if (!s.dataset.id || !s.value) return; api("post-formato", { id: s.dataset.id, formato: s.value }).then(function (r) { aviso(r.ok ? "Formato guardado" : r.error); }); };

function pintarHilo() {
  var h = HIST.length ? HIST : [{ r: "a", t: "Preguntame lo que quieras sobre tu Instagram: qué grabar, qué funcionó, qué DMs quedaron sin responder o qué producto conviene mostrar." }];
  $("#hilo").innerHTML = h.map(function (m) { return '<div class="burb ' + (m.r === "u" ? "u" : "a") + '">' + esc(m.t) + "</div>"; }).join("");
  $("#hilo").scrollTop = 1e9;
}
function preguntar(q) {
  if (!q.trim()) return; $("#pregunta").value = "";
  var previo = HIST.slice(-6); HIST.push({ r: "u", t: q }, { r: "a", t: "Pensando..." }); pintarHilo();
  api("preguntar", { pregunta: q, historial: previo }).then(function (r) { HIST[HIST.length - 1] = { r: "a", t: r.respuesta }; pintarHilo(); }).catch(function () { HIST[HIST.length - 1] = { r: "a", t: "No pude responder. Probá de nuevo." }; pintarHilo(); });
}
$("#fPreg").onsubmit = function (e) { e.preventDefault(); preguntar($("#pregunta").value); };
$("#sug").onclick = function (ev) { var b = ev.target.closest("button"); if (b) preguntar(b.textContent); };

cargarResumen();
api("dms").then(function (r) { badge("#bDms", r.error ? 0 : r.dms.length); }).catch(function () {});
function desdeHash() { var h = location.hash.slice(1); modo(["resumen", "ideas", "dms", "reels", "agente"].indexOf(h) >= 0 ? h : "resumen"); }
window.addEventListener("hashchange", desdeHash);
desdeHash();
</script></body></html>`;
