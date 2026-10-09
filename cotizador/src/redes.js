// Pestaña "Redes" del panel: /panel/redes (Instagram).
// Los datos de Instagram los guarda el worker "instagram" en D1 (ig_posts, ig_dms, kv ig_cuenta) cada 2 horas;
// los DMs, cada 30 min. Acá solo se leen, se generan ideas y reportes con Gemini, y se charla con el agente.
// Nada de esto publica en Instagram ni le manda mensajes a nadie.
import { telegram } from "./lector.js";
import { calcular } from "./cotizar.js";
import { CARR_CSS, CARR_HTML, CARR_JS } from "./carruseles-ui.js";

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
  "CREATE TABLE IF NOT EXISTS ig_historias (id TEXT PRIMARY KEY, ts INTEGER, lote TEXT, tipo TEXT, titulo TEXT, mostrar TEXT, texto TEXT, sticker TEXT, por_que TEXT, producto TEXT, refs TEXT, clave TEXT, estado TEXT DEFAULT 'nueva', pedido_por TEXT)",
  "CREATE INDEX IF NOT EXISTS ig_historias_estado ON ig_historias(estado, ts)",
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
export async function generarIdeas(env, iaJSON, quien = "auto", cantidad = 7, T = null) {
  const d = await datosRedes(env);
  const w = await datosWhatsApp(env, T);
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

LO QUE PASA EN EL WHATSAPP 805 (datos reales):
${resumenWA(w)}
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

// ---------- Lo que pasa en el WhatsApp 805 (para historias, ideas y el agente) ----------
const normal = (t) => String(t || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9ñ ]+/g, " ").replace(/\s+/g, " ").trim();
const sinDatosPersonales = (t) => String(t || "").replace(/\+?\d[\d\s-]{7,}\d/g, "[número]").replace(/@[a-z0-9._]+/gi, "@usuario");
export async function datosWhatsApp(env, T) {
  const ahora = Date.now(), d7 = ahora - 7 * 86400e3, q = async (sql, ...b) => { try { return (await env.DB.prepare(sql).bind(...b).all()).results || []; } catch { return []; } };
  const [manual, cotWA, ventas, dem14, dem3] = await Promise.all([
    q("SELECT id, num, ts, datos FROM cotiz_manual WHERE ts >= ? ORDER BY ts DESC LIMIT 20", d7),
    q("SELECT h.ts, h.dato, c.producto FROM w_hito h LEFT JOIN w_conv c ON c.conv=h.conv WHERE h.tipo='cotizacion' AND h.ts >= ? ORDER BY h.ts DESC LIMIT 60", d7),
    q("SELECT c.producto FROM w_hito h LEFT JOIN w_conv c ON c.conv=h.conv WHERE h.tipo='venta' AND h.ts >= ? AND COALESCE(h.oculto,0)=0", d7),
    q("SELECT producto, COUNT(*) n FROM w_conv WHERE grupo=0 AND producto<>'' AND ult_ts>=? GROUP BY lower(producto) ORDER BY n DESC LIMIT 15", ahora - 14 * 86400e3),
    q("SELECT producto, COUNT(*) n FROM w_conv WHERE grupo=0 AND producto<>'' AND ult_ts>=? GROUP BY lower(producto) ORDER BY n DESC LIMIT 8", ahora - 3 * 86400e3),
  ]);
  const cotizaciones = manual.map((c) => {
    let d = {}; try { d = JSON.parse(c.datos || "{}"); } catch {}
    const items = (d.items || []).filter((i) => i.nombre);
    let total = null; try { if (T && items.length) total = Math.round(calcular(items, d, T).total); } catch {}
    return { id: c.id, num: c.num, ts: c.ts, items: items.slice(0, 5).map((i) => ({ nombre: String(i.nombre).slice(0, 60), cantidad: i.cantidad })), total };
  }).filter((c) => c.items.length);
  const porProducto = {};
  for (const c of cotWA) { const k = c.producto || "sin producto"; porProducto[k] = (porProducto[k] || 0) + 1; }
  return {
    cotizaciones, cotizaciones_chat: cotWA.length,
    cotizados: Object.entries(porProducto).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([producto, n]) => ({ producto, n })),
    muestras_chat: cotWA.slice(0, 8).map((c) => sinDatosPersonales(c.dato).slice(0, 200)),
    ventas: ventas.length, vendidos: [...new Set(ventas.map((v) => v.producto).filter(Boolean))].slice(0, 8),
    demanda14: dem14, demanda3: dem3,
  };
}
const resumenWA = (w) => `COTIZACIONES ARMADAS EN EL PANEL (últimos 7 días, ${w.cotizaciones.length}): ${w.cotizaciones.map((c) => `[id ${c.id}] N° ${c.num}: ${c.items.map((i) => `${i.cantidad} × ${i.nombre}`).join(" + ")}${c.total ? ` = USD ${c.total} puesto en Argentina` : ""}`).join(" | ") || "ninguna"}
COTIZACIONES MANDADAS POR WHATSAPP (7 días): ${w.cotizaciones_chat}; productos: ${w.cotizados.map((x) => `${x.producto} (${x.n})`).join(", ") || "sin datos"}
EJEMPLOS DE COTIZACIONES MANDADAS: ${w.muestras_chat.map((t) => `"${t}"`).join(" | ") || "ninguno"}
VENTAS CERRADAS (7 días): ${w.ventas}${w.vendidos.length ? ` (${w.vendidos.join(", ")})` : ""}
LO MÁS CONSULTADO POR WHATSAPP, 14 DÍAS: ${w.demanda14.map((x) => `${x.producto} (${x.n})`).join(", ") || "sin datos"}
LO MÁS CONSULTADO, ÚLTIMOS 3 DÍAS: ${w.demanda3.map((x) => `${x.producto} (${x.n})`).join(", ") || "sin datos"}`;

// ---------- Ideas de historias ----------
export const TIPOS_HISTORIA = { cotizaciones: "Cotizaciones reales", producto: "Producto", encuesta: "Encuesta", pregunta: "Caja de preguntas", quiz: "Quiz", cupo: "Cupo abierto", detras: "Detrás de escena", resultado: "Pedido entregado", consejo: "Consejo" };
export async function generarHistorias(env, iaJSON, { T, quien = "auto", cantidad = 4 } = {}) {
  await prepararRedes(env);
  const w = await datosWhatsApp(env, T);
  const hace21 = Date.now() - 21 * 86400e3;
  const previas = (await env.DB.prepare("SELECT tipo, titulo, clave, refs, estado FROM ig_historias WHERE ts > ? ORDER BY ts DESC LIMIT 80").bind(hace21).all()).results || [];
  const usadas = new Set(previas.map((x) => x.clave));
  const cotUsadas = new Set(previas.flatMap((x) => { try { return JSON.parse(x.refs || "[]"); } catch { return []; } }));
  const cotLibres = w.cotizaciones.filter((c) => !cotUsadas.has(c.id));
  const [dms, coms] = await Promise.all([dmsPendientes(env, 30), comentariosIG(env, 7)]);
  const r = await iaJSON(env, `Sos quien maneja las HISTORIAS de Instagram de este negocio:
${NEGOCIO}

Proponé ${cantidad} historias para subir HOY, sacadas de lo que pasa de verdad en el WhatsApp y en Instagram. Las historias son para gente que ya te sigue: generan confianza y llevan al DM o al WhatsApp.

DATOS REALES:
${resumenWA({ ...w, cotizaciones: cotLibres })}
PREGUNTAS POR DM DE INSTAGRAM: ${dms.slice(0, 15).map((x) => `"${sinDatosPersonales(x.ult_texto).slice(0, 100)}"`).join(" | ") || "sin datos"}
COMENTARIOS DE INSTAGRAM: ${coms.slice(0, 15).map((t) => `"${sinDatosPersonales(t).slice(0, 100)}"`).join(" | ") || "sin datos"}

HISTORIAS QUE YA SE PROPUSIERON (NO repetir el mismo producto con el mismo tipo, ni la misma encuesta, ni las mismas cotizaciones):
${previas.map((x) => `- [${x.tipo}] ${x.titulo} (${x.estado})`).join("\n") || "(ninguna)"}

Tipos posibles: ${Object.entries(TIPOS_HISTORIA).map(([k, v]) => `"${k}" (${v})`).join(", ")}.
Reglas:
- Variá los tipos. Si hay cotizaciones armadas, una historia "cotizaciones" que muestre varias juntas (captura del PDF o lista), con los ids en "cotizaciones". Si hay un producto que se consultó mucho, una "producto" o una "encuesta" sobre eso.
- Para encuesta o quiz: pregunta corta y 2 opciones (hasta 4 en quiz). Para caja de preguntas: la pregunta del sticker.
- "mostrar": qué grabar o capturar, concreto y que se haga en 2 minutos con el celular.
- "texto": lo que va escrito en la historia, corto, como habla un pibe de Rosario, sin emojis.
- NUNCA nombres, teléfonos ni usuarios de clientes. En capturas de cotizaciones, tapar nombre y número del cliente.
- Precios: solo los de las cotizaciones de arriba (son "puesto en Argentina", del día). No inventes precios ni prometas ganancias.
- "por_que": el dato de arriba en el que te basás, con su número.
Respondé SOLO JSON: {"historias":[{"tipo":"...","titulo":"...","mostrar":"...","texto":"...","sticker":{"tipo":"encuesta|pregunta|quiz|link|ninguno","pregunta":"...","opciones":["..",".."]},"por_que":"...","producto":"... o vacío","cotizaciones":["id"]}]}`);
  const ids = new Set(cotLibres.map((c) => c.id));
  const nuevas = [], claves = new Set(usadas);
  for (const x of r?.historias || []) {
    if (!x?.titulo || !TIPOS_HISTORIA[x.tipo] || PROHIBIDO.test(JSON.stringify(x))) continue;
    const refs = (x.cotizaciones || []).map(String).filter((i) => ids.has(i));
    if (x.tipo === "cotizaciones" && !refs.length) continue;
    const st = x.sticker && ["encuesta", "pregunta", "quiz", "link"].includes(x.sticker.tipo) ? { tipo: x.sticker.tipo, pregunta: String(x.sticker.pregunta || "").slice(0, 120), opciones: (x.sticker.opciones || []).map((o) => String(o).slice(0, 40)).slice(0, 4) } : null;
    const clave = refs.length ? "cot:" + refs.sort().join(",") : ["encuesta", "quiz", "pregunta"].includes(x.tipo) ? x.tipo + ":" + normal(st?.pregunta || x.titulo).slice(0, 60) : x.tipo + ":" + normal(x.producto || x.titulo).slice(0, 60);
    if (claves.has(clave) || refs.some((i) => cotUsadas.has(i))) continue;
    claves.add(clave); refs.forEach((i) => cotUsadas.add(i));
    nuevas.push({ ...x, refs, st, clave });
  }
  if (!nuevas.length) return { ok: false, error: r ? "No salieron historias nuevas (todo lo de esta semana ya se propuso)." : "La IA no respondió. Probá de nuevo en un minuto." };
  const lote = id();
  await env.DB.batch(nuevas.map((x) => env.DB.prepare("INSERT INTO ig_historias (id, ts, lote, tipo, titulo, mostrar, texto, sticker, por_que, producto, refs, clave, estado, pedido_por) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'nueva',?)")
    .bind(id(), Date.now(), lote, x.tipo, String(x.titulo).slice(0, 140), String(x.mostrar || "").slice(0, 400), String(x.texto || "").slice(0, 300), x.st ? JSON.stringify(x.st) : null, String(x.por_que || "").slice(0, 300), String(x.producto || "").slice(0, 80), JSON.stringify(x.refs), x.clave, quien)));
  return { ok: true, lote, cantidad: nuevas.length, historias: nuevas.map((x) => ({ tipo: x.tipo, titulo: x.titulo })) };
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
export async function cronRedes(env, iaJSON, scheduledTime = Date.now(), base = "", T = null) {
  const t = new Date(scheduledTime - AR), dia = t.toISOString().slice(0, 10), hm = t.getUTCHours() * 60 + t.getUTCMinutes();
  if (hm === 9 * 60 + 10) {   // todos los días 9:10: historias del día
    await prepararRedes(env);
    if ((await kvGet(env, "redes_historias")) === dia) return false;
    await kvPut(env, "redes_historias", dia);
    const h = await generarHistorias(env, iaJSON, { T }).catch((e) => ({ ok: false, error: String(e) }));
    if (h.ok) await telegram(env, `Historias para hoy:\n${h.historias.map((x) => "• " + x.titulo).join("\n")}\n\n${base}/panel/redes#ideas`).catch(() => {});
    return true;
  }
  if (t.getUTCDay() !== 1 || hm !== 9 * 60 + 5) return false;   // lunes 9:05: ideas de reels + reporte
  await prepararRedes(env);
  if ((await kvGet(env, "redes_semanal")) === dia) return false;
  await kvPut(env, "redes_semanal", dia);
  await generarIdeas(env, iaJSON, "auto", 7, T).catch((e) => console.log("redes ideas", e?.stack || e));
  await generarReporteRedes(env, iaJSON, { base }).catch((e) => console.log("redes reporte", e?.stack || e));
  return true;
}

// ---------- Charla con el agente de Instagram ----------
export async function preguntarRedes(env, iaJSON, pregunta, historial = [], T = null) {
  const q = String(pregunta || "").slice(0, 600);
  const d = await datosRedes(env);
  const w = await datosWhatsApp(env, T);
  const hist = (await env.DB.prepare("SELECT tipo, titulo, estado FROM ig_historias ORDER BY ts DESC LIMIT 15").all()).results || [];
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
${resumenWA(w)}
HISTORIAS PROPUESTAS: ${hist.map((x) => `[${x.tipo}] ${x.titulo} (${x.estado})`).join(" | ") || "ninguna"}
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
export async function apiRedes(env, req, url, quien, iaJSON, base = "", T = null) {
  await prepararRedes(env);
  const r = url.pathname.replace("/panel/api/redes/", "");
  const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
  if (r === "resumen") {
    const d = await datosRedes(env);
    const rep = await env.DB.prepare("SELECT id, ts, texto, datos FROM ig_reportes ORDER BY ts DESC LIMIT 1").first();
    const nuevas = (await env.DB.prepare("SELECT COUNT(*) n FROM ig_ideas WHERE estado='nueva'").first())?.n || 0;
    const histNuevas = (await env.DB.prepare("SELECT COUNT(*) n FROM ig_historias WHERE estado='nueva' AND ts > ?").bind(Date.now() - 3 * 86400e3).first())?.n || 0;
    return json({ kpis: kpis(d), perfil: d.cuenta?.perfil || null, formatos: d.formatos, reporte: rep ? { ...rep, datos: JSON.parse(rep.datos || "{}") } : null, ideas_nuevas: nuevas, historias_nuevas: histNuevas, sync_ts: d.sync_ts, dms_ts: d.dms_ts, dms_error: d.dms_error, hay_datos: d.posts.length > 0 });
  }
  if (r === "ideas") {
    const est = ["nueva", "grabada", "descartada"].includes(url.searchParams.get("estado")) ? url.searchParams.get("estado") : "nueva";
    const l = (await env.DB.prepare("SELECT * FROM ig_ideas WHERE estado=? ORDER BY ts DESC LIMIT 60").bind(est).all()).results || [];
    return json(l.map((x) => ({ ...x, guion: JSON.parse(x.guion || "[]") })));
  }
  if (r === "generar-ideas" && req.method === "POST") return json(await generarIdeas(env, iaJSON, quien || "panel", 7, T));
  if (r === "historias") {
    const est = ["nueva", "subida", "descartada"].includes(url.searchParams.get("estado")) ? url.searchParams.get("estado") : "nueva";
    const l = (await env.DB.prepare("SELECT * FROM ig_historias WHERE estado=? ORDER BY ts DESC LIMIT 40").bind(est).all()).results || [];
    const nums = {};
    for (const c of (await env.DB.prepare("SELECT id, num FROM cotiz_manual WHERE ts > ?").bind(Date.now() - 30 * 86400e3).all().catch(() => ({ results: [] }))).results || []) nums[c.id] = c.num;
    return json(l.map((x) => ({ ...x, sticker: x.sticker ? JSON.parse(x.sticker) : null, refs: JSON.parse(x.refs || "[]").map((i) => ({ id: i, num: nums[i] || null })) })));
  }
  if (r === "generar-historias" && req.method === "POST") return json(await generarHistorias(env, iaJSON, { T, quien: quien || "panel" }));
  if (r === "historia-estado" && req.method === "POST") {
    if (!["nueva", "subida", "descartada"].includes(body.estado)) return json({ error: "estado inválido" }, 400);
    await env.DB.prepare("UPDATE ig_historias SET estado=? WHERE id=?").bind(body.estado, String(body.id || "")).run();
    return json({ ok: true });
  }
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
  if (r === "preguntar" && req.method === "POST") return json(await preguntarRedes(env, iaJSON, body.pregunta, body.historial, T));
  return json({ error: "ruta desconocida" }, 404);
}

export const PANEL_REDES = String.raw`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Redes · Te Importamos</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Patrick+Hand&display=swap" rel="stylesheet">
<style>
:root{--nar:#EA5B0C;--fondo:#f5f7fb;--borde:#e3e8f0;--txt:#0f172a;--gris:#64748b;--rojo:#dc2626;--verde:#16a34a;--ambar:#d97706}
*{box-sizing:border-box}body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:var(--fondo);color:var(--txt)}
header{display:flex;align-items:center;gap:12px;padding:10px 16px;padding-top:max(10px,env(safe-area-inset-top));background:#0B0B0B;position:sticky;top:0;z-index:5}
header b{color:#fff;font-size:17px;white-space:nowrap}header b span{color:var(--nar)}
.volver{display:inline-flex;align-items:center;gap:4px;color:#D1D5DB;text-decoration:none;font-weight:600;font-size:14px;padding:6px 8px 6px 2px;border-radius:8px}.volver:hover{color:#fff}
.sync{margin-left:auto;color:#9CA3AF;font-size:12px;text-align:right}
.ic{width:18px;height:18px;flex:none;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;vertical-align:-4px}
.btn .ic{margin-right:6px}.btn[aria-label] .ic{margin-right:0}
.modos{display:flex;gap:6px;margin-bottom:14px}
.modos button{flex:1;display:flex;align-items:center;justify-content:center;gap:8px;border:1px solid var(--borde);background:#fff;padding:10px 12px;border-radius:10px;font-weight:700;font-size:14px;color:var(--gris);cursor:pointer;min-width:0;font-family:inherit}
.modos button:hover{color:var(--txt)}.modos button.on{background:var(--nar);color:#fff;border-color:var(--nar)}
.modos .ico{position:relative;display:inline-flex}.modos .ic{width:20px;height:20px;vertical-align:0}.modos .ct{display:none}.modos .lg{white-space:nowrap}
.modos .bd{position:absolute;top:-8px;left:-13px;min-width:18px;height:18px;padding:0 5px;border-radius:99px;background:var(--rojo);color:#fff;font-size:11px;line-height:18px;text-align:center;font-weight:800;box-shadow:0 0 0 2px #fff}
.modos button.on .bd{box-shadow:0 0 0 2px var(--nar)}
.barraher{display:flex;gap:8px;align-items:center}.barraher select{flex:none;max-width:none;padding:9px 10px;font-size:14px;border-radius:8px}.ayuda{margin:8px 0 12px}
.chips{display:flex;gap:8px;margin-top:8px;overflow-x:auto;padding-bottom:4px;scrollbar-width:none}.chips::-webkit-scrollbar{display:none}.chips .btn{white-space:nowrap;border-radius:99px;flex:none}
.espacio{display:flex;align-items:center;gap:10px;margin-bottom:12px}.espacio .estado{white-space:nowrap}.espacio .barra{flex:1}
.drop{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;text-align:center;border:2px dashed #f4b593;background:#fff7f2;border-radius:14px;padding:22px 16px;cursor:pointer;transition:background .15s,border-color .15s}
.drop:hover,.drop.sobre{background:#ffedd5;border-color:var(--nar)}.drop{position:relative}.drop input{position:absolute;inset:0;width:100%;height:100%;opacity:0;cursor:pointer;font-size:0}
.drop-ic{width:52px;height:52px;border-radius:50%;background:var(--nar);color:#fff;display:flex;align-items:center;justify-content:center;margin-bottom:6px}.drop-ic .ic{width:26px;height:26px;vertical-align:0}
.drop b{font-size:16px}
.cl{display:grid;grid-template-columns:40px 1fr auto;gap:10px;align-items:center;border:1px solid var(--borde);border-radius:12px;padding:10px;margin-top:10px;background:#fff}
.cl-ic{width:40px;height:40px;border-radius:10px;background:#f1f5f9;color:var(--gris);display:flex;align-items:center;justify-content:center}.cl-ic .ic{vertical-align:0}
.cl-n{min-width:0}.cl-n b{display:block;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.cl-n .estado{font-size:12px}
.quitar{width:34px;height:34px;border:0;background:none;color:var(--gris);border-radius:8px;cursor:pointer;display:flex;align-items:center;justify-content:center}.quitar:hover{background:#f1f5f9;color:var(--rojo)}.quitar .ic{vertical-align:0}
.seg{grid-column:1/-1;display:flex;background:#f1f5f9;border-radius:10px;padding:3px;gap:3px}
.seg button{flex:1;border:0;background:none;padding:8px 4px;border-radius:8px;font-weight:700;font-size:13px;color:var(--gris);cursor:pointer;font-family:inherit}.seg button.on{background:#fff;color:var(--nar);box-shadow:0 1px 3px rgba(15,23,42,.12)}
.seg button:disabled{cursor:default}
.cprog{grid-column:1/-1;height:4px;background:#f1f5f9;border-radius:99px;overflow:hidden;display:none}.cprog i{display:block;height:100%;width:0;background:var(--nar);transition:width .3s}.cprog.ok i{background:var(--verde)}
.resumensel{display:flex;justify-content:space-between;margin-top:10px;font-size:13px;color:var(--gris)}
.btn.grande{width:100%;padding:13px;font-size:16px;border-radius:12px;margin-top:12px;display:flex;align-items:center;justify-content:center}
.btn.grande .ic{width:20px;height:20px;vertical-align:0}
.prog{margin-top:8px;text-align:center}
details.reglas summary{cursor:pointer;font-weight:700}details.reglas[open] summary{margin-bottom:6px}

main{padding:16px;max-width:1100px;margin:0 auto}
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
.vgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px}.vcard{border:1px solid var(--borde);border-radius:12px;padding:10px;background:#fff;display:flex;flex-direction:column;gap:8px}
.vcard video{width:100%;aspect-ratio:9/16;background:#000;border-radius:8px;object-fit:contain}.vcard textarea{width:100%;min-height:90px;border:1px solid var(--borde);border-radius:8px;padding:8px;font:inherit;font-size:13px}
.barra{height:8px;background:#eef2f7;border-radius:99px;overflow:hidden}.barra i{display:block;height:100%;background:var(--nar)}.barra.ok i{background:var(--verde)}
.clip{display:grid;grid-template-columns:1fr auto;gap:8px;align-items:center;padding:6px 0;border-bottom:1px solid #f0f2f6;font-size:14px}.clip .nom{overflow-wrap:anywhere}
.reglas{font-size:13px;color:#334155;line-height:1.55;background:#fafbfd;border:1px solid var(--borde);border-radius:10px;padding:10px 12px;margin-top:12px}
.prog{font-size:13px;color:var(--gris)}
.tabs2{margin-bottom:12px}.tabs2 button{font-size:14px;padding:10px 6px}.bd2{display:inline-block;min-width:18px;margin-left:6px;padding:0 5px;border-radius:99px;background:var(--rojo);color:#fff;font-size:11px;line-height:18px}.bd2:empty{display:none}
.sticker{border:1px dashed #c4b5fd;background:#f5f3ff;border-radius:10px;padding:10px 12px;margin:8px 0}.sticker small{display:block;color:#6d28d9;font-size:11px;font-weight:700;letter-spacing:.04em;margin-bottom:4px}
.sticker .ops{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px}.sticker .ops span{background:#fff;border:1px solid #ddd6fe;border-radius:99px;padding:4px 10px;font-size:13px;font-weight:600}
.refs{display:flex;gap:6px;flex-wrap:wrap;margin:6px 0}
.idea .tit{display:flex;align-items:flex-start;justify-content:space-between;gap:8px}.idea .tit h3{flex:1}
${CARR_CSS}
.aviso{position:fixed;left:50%;bottom:18px;transform:translateX(-50%);background:#0f172a;color:#fff;padding:10px 16px;border-radius:10px;font-size:14px;display:none;z-index:20;max-width:90vw}
.acciones .btn{display:inline-flex;align-items:center}
@media(max-width:760px){
  body{padding-bottom:calc(70px + env(safe-area-inset-bottom))}
  main{padding:12px 12px 16px}
  header{padding:10px 12px;gap:8px}header b{font-size:16px}.volver span{display:none}.sync{font-size:11px;max-width:40%}
  .modos{position:fixed;left:0;right:0;bottom:0;z-index:10;margin:0;gap:0;background:#0B0B0B;padding:6px 4px calc(6px + env(safe-area-inset-bottom));box-shadow:0 -2px 12px rgba(0,0,0,.25)}
  .modos button{flex-direction:column;gap:3px;border:0;background:none;color:#9CA3AF;padding:6px 2px;border-radius:10px;font-size:11px;font-weight:600}
  .modos button.on{background:none;color:var(--nar)}.modos button.on .ico{background:rgba(234,91,12,.16)}
  .modos .ico{padding:3px 12px;border-radius:99px}.modos .ic{width:22px;height:22px}
  .modos .lg{display:none}.modos .ct{display:block}
  .modos .bd{top:-4px;left:auto;right:2px;box-shadow:0 0 0 2px #0B0B0B}.modos button.on .bd{box-shadow:0 0 0 2px #0B0B0B}
  .sololg{display:none}
  .kpis{grid-template-columns:1fr 1fr;gap:8px}.kpi{padding:10px}.kpi b{font-size:21px}
  .card{padding:12px;border-radius:14px}
  .card>.fila:first-child{flex-direction:column;align-items:stretch}.card>.fila:first-child h2{margin-bottom:8px}
  .acciones{display:grid;grid-template-columns:1fr 1fr}.acciones .btn{justify-content:center;padding:10px 8px;font-size:13px}
  .barraher .btn{flex:1;display:inline-flex;align-items:center;justify-content:center;padding:10px}
  .idea{padding:12px}.idea .fila .btn{flex:1;text-align:center}.gancho{font-size:17px}
  .dm{grid-template-columns:1fr}.dm .btn{text-align:center;padding:9px}
  .vgrid{grid-template-columns:1fr}.vcard video{max-height:70vh}.vcard .fila .btn{flex:1;text-align:center}
  .hilo{height:calc(100vh - 330px);min-height:280px}.burb{max-width:90%}.preg input{font-size:16px}
  .tabla.cards table,.tabla.cards tbody,.tabla.cards tr,.tabla.cards td{display:block}
  .tabla.cards tr:first-child{display:none}
  .tabla.cards tr{display:grid;grid-template-columns:repeat(3,1fr);gap:8px 10px;border:1px solid var(--borde);border-radius:12px;padding:10px;margin-bottom:8px}
  .tabla.cards td{padding:0;border:0;text-align:left!important;white-space:normal!important;font-size:14px}
  .tabla.cards td[data-l]::before{content:attr(data-l);display:block;font-size:11px;color:var(--gris);font-weight:600;margin-bottom:1px}
  .tabla.cards td.t1{grid-column:1/-1;font-weight:700}.tabla.cards td.t0{grid-column:span 2;white-space:nowrap!important;font-weight:600}.tabla.cards td.t2{grid-column:span 1;text-align:right!important}.tabla.cards td.t3{grid-column:1/-1}.tabla.cards td.t3 select{max-width:none;width:100%;padding:8px;font-size:14px}
  .tabla.cards td.ver{grid-column:1/-1}.tabla.cards td.ver .btn{display:block;text-align:center}
  .aviso{bottom:calc(84px + env(safe-area-inset-bottom))}
  .clip{grid-template-columns:1fr}.clip .fila{justify-content:flex-start}
}
</style></head><body>
<header><a class="volver" href="/panel" aria-label="Volver al panel"><svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg><span>Panel</span></a><b>Te Importamos · <span>Redes</span></b><span class="sync" id="sync"></span></header>
<main>
<nav class="modos" id="modos"><button data-m="resumen" class="on"><span class="ico"><svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 20h18"/><rect x="5" y="11" width="3" height="6" rx="1"/><rect x="10.5" y="7" width="3" height="10" rx="1"/><rect x="16" y="4" width="3" height="13" rx="1"/></svg></span><span class="lg">Resumen</span><span class="ct">Resumen</span></button><button data-m="ideas"><span class="ico"><svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18h6M10 21.5h4"/><path d="M12 2.5a6.5 6.5 0 0 0-3.9 11.7c.6.5.9 1.2.9 1.9V17h6v-.9c0-.7.3-1.4.9-1.9A6.5 6.5 0 0 0 12 2.5z"/></svg><span class="bd" id="bIdeas" style="display:none"></span></span><span class="lg">Ideas para grabar</span><span class="ct">Ideas</span></button><button data-m="dms"><span class="ico"><svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 12a8.5 8.5 0 0 1-12.3 7.6L3.5 21l1.4-4.6A8.5 8.5 0 1 1 20.5 12z"/></svg><span class="bd" id="bDms" style="display:none"></span></span><span class="lg">DMs sin responder</span><span class="ct">DMs</span></button><button data-m="videos"><span class="ico"><svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><rect x="2.5" y="6" width="13" height="12" rx="2.5"/><path d="M15.5 10.2l6-3.2v10l-6-3.2z"/></svg><span class="bd" id="bVid" style="display:none"></span></span><span class="lg">Videos</span><span class="ct">Videos</span></button><button data-m="carr"><span class="ico"><svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><rect x="6.5" y="4" width="11" height="16" rx="2.5"/><path d="M3 7v10M21 7v10"/></svg></span><span class="lg">Carruseles</span><span class="ct">Carrusel</span></button><button data-m="reels"><span class="ico"><svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="4.5"/><path d="M3 8.5h18M8.5 3l2.5 5.5M14 3l2.5 5.5"/><path d="M10.2 12.2v5.6l4.8-2.8z"/></svg></span><span class="lg">Reels</span><span class="ct">Reels</span></button><button data-m="agente"><span class="ico"><svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="8" width="16" height="12" rx="3.5"/><path d="M12 8V4.5"/><circle cx="12" cy="3.5" r="1"/><path d="M9 13.5v1.5M15 13.5v1.5M1.5 13v3M22.5 13v3"/></svg></span><span class="lg">Preguntale al agente</span><span class="ct">Agente</span></button></nav>

<div id="m-resumen">
  <div class="nota" id="sinDatos" style="display:none">Todavía no hay datos guardados. El agente de Instagram los trae solo cada 2 horas, o tocá <b>Traer datos ahora</b>.</div>
  <div class="kpis" id="kpis"></div>
  <section class="card"><div class="fila" style="justify-content:space-between"><h2>Reporte semanal <span class="estado" id="repFecha"></span></h2><span class="fila acciones"><button class="btn" id="bTraer"><svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 0 0-14.3-4.9L4 8M4 4v4h4M4 13a8 8 0 0 0 14.3 4.9L20 16M20 20v-4h-4"/></svg>Traer datos ahora</button><button class="btn p" id="bReporte"><svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/></svg>Generar reporte</button></span></div>
    <div id="reporte" class="vacio">Sale solo los lunes a las 9 y te llega por Telegram.</div></section>
  <section class="card"><h2>Qué formato funciona <span class="estado">reels de los últimos 60 días</span></h2><div class="tabla" id="formatos"></div></section>
</div>

<div id="m-ideas" style="display:none">
  <div class="seg tabs2" id="ideasTipo"><button data-k="reels" class="on">Reels para grabar<span class="bd2" id="bIR"></span></button><button data-k="hist">Historias de hoy<span class="bd2" id="bIH"></span></button></div>
  <div id="i-reels">
  <div class="barraher"><button class="btn p" id="bIdeasGen"><svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/></svg>Generar ideas nuevas</button><select id="fIdeas"><option value="nueva">Para grabar</option><option value="grabada">Ya grabadas</option><option value="descartada">Descartadas</option></select></div>
  <p class="estado ayuda">Salen solas cada lunes a las 9, cruzando métricas, formatos y lo que piden por WhatsApp, comentarios y DMs.</p>
  <div id="ideas"><div class="vacio">Cargando...</div></div>
</div>
  <div id="i-hist" style="display:none">
  <div class="barraher"><button class="btn p" id="bHistGen"><svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/></svg>Generar historias</button><select id="fHist"><option value="nueva">Para subir</option><option value="subida">Ya subidas</option><option value="descartada">Descartadas</option></select></div>
  <p class="estado ayuda">Salen solas todos los días a las 9 con lo que pasa en el WhatsApp: cotizaciones que mandaste, lo más consultado y lo que preguntan. No se repiten.</p>
  <div id="historias"><div class="vacio">Cargando...</div></div>
  </div>
</div>

<div id="m-dms" style="display:none">
  <div class="nota" id="dmErr" style="display:none"></div>
  <section class="card"><div class="fila" style="justify-content:space-between"><h2>DMs sin responder <span class="estado" id="dmTs"></span></h2><button class="btn" id="bDmAct"><svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 0 0-14.3-4.9L4 8M4 4v4h4M4 13a8 8 0 0 0 14.3 4.9L20 16M20 20v-4h-4"/></svg>Actualizar</button></div>
  <div id="dms"><div class="vacio">Cargando...</div></div></section>
</div>

<div id="m-videos" style="display:none">
  <section class="card"><h2>Subir clips <span class="estado">se editan solos y te llegan acá para aprobar</span></h2>
    <div class="espacio"><span class="estado" id="vEspacio">Espacio</span><div class="barra" id="vBarra"><i style="width:0"></i></div></div>
    <div class="drop" id="vDrop"><input type="file" id="vArch" accept="video/*,.mov,.mp4,.m4v" multiple>
      <span class="drop-ic"><svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V4M7.5 8.5L12 4l4.5 4.5"/><path d="M4 14.5V18a2.5 2.5 0 0 0 2.5 2.5h11A2.5 2.5 0 0 0 20 18v-3.5"/></svg></span>
      <b>Elegí tus clips</b><span class="estado"><span class="sololg">o arrastralos acá · </span>podés elegir varios a la vez</span></div>
    <div class="estado" style="margin-top:8px;text-align:center">¿No aparecen los clips? Usá este botón común: <input type="file" id="vArch2" multiple style="max-width:100%;font-size:14px;margin-top:6px"></div>
    <div class="estado" id="vDiag" style="text-align:center;margin-top:4px"></div>
    <div id="vSel"></div>
    <button class="btn p grande" id="bSubir" disabled><svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V4M7.5 8.5L12 4l4.5 4.5"/><path d="M4 14.5V18a2.5 2.5 0 0 0 2.5 2.5h11A2.5 2.5 0 0 0 20 18v-3.5"/></svg>Subir y editar</button><div class="prog" id="vProg"></div>
    <details class="reglas"><summary>Cómo grabar para que salga bien</summary><br>• Marcá cada clip: <b>Gancho</b> (el arranque), <b>Cuerpo</b> (el resto, con el cierre adentro) o <b>Completo</b> (gancho y cuerpo juntos).<br>• Si subís varios ganchos y un cuerpo, sale un reel por cada gancho: así probamos cuál retiene más.<br>• Si te equivocás, hacé una pausa de 2 segundos y repetí la frase desde el principio: queda la última toma.<br>• Los silencios se cortan solos. Grabá vertical y con buena luz.</details>
  </section>
  <section class="card"><h2>En edición</h2><div id="vLotes"><div class="vacio">Nada en edición.</div></div></section>
  <section class="card"><h2>Para revisar <span class="estado">al aprobar, sale el próximo día libre a las 19 h como reel de prueba</span></h2><div class="nota" id="vPermiso" style="display:none"></div><div class="vgrid" id="vRev"><div class="vacio">Cargando...</div></div></section>
  <section class="card"><h2>Programados y publicados</h2><div id="vProx"></div></section>
</div>
${CARR_HTML}
<div id="m-reels" style="display:none">
  <section class="card"><div class="fila" style="justify-content:space-between"><h2>Reels y publicaciones</h2><select id="fDias"><option value="30">30 días</option><option value="60" selected>60 días</option><option value="120">120 días</option></select></div>
  <p class="estado" style="margin-top:0">Si el formato está mal, cambialo: así las ideas aprenden de lo que de verdad funcionó.</p>
  <div class="tabla" id="reels"></div></section>
</div>

<div id="m-agente" style="display:none">
  <section class="card"><h2>Agente de Instagram <span class="estado">conoce tus métricas, formatos, DMs, ideas y lo que piden por WhatsApp</span></h2>
  <div class="hilo" id="hilo"></div>
  <div class="chips" id="sug"><button class="btn ch">¿Qué grabo hoy?</button><button class="btn ch">¿Qué formato rindió mejor este mes?</button><button class="btn ch">¿A quién le debo respuesta por DM?</button><button class="btn ch">¿Qué producto conviene mostrar esta semana?</button></div>
  <form class="preg" id="fPreg"><input id="pregunta" placeholder="Preguntale lo que quieras" autocomplete="off"><button class="btn p" aria-label="Enviar"><svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M21.5 2.5L10.5 13.5M21.5 2.5l-7 19-4-8-8-4z"/></svg><span class="sololg">Enviar</span></button></form></section>
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
  ["resumen", "ideas", "dms", "videos", "carr", "reels", "agente"].forEach(function (x) { $("#m-" + x).style.display = x === m ? "" : "none"; });
  if (location.hash.slice(1) !== m) history.replaceState(null, "", "#" + m);
  if (m === "ideas") ideasTipo(IDEAS_K); if (m === "dms") cargarDms(); if (m === "reels") cargarReels(); if (m === "videos") cargarVideos(); if (m === "carr") cargarCarr(); if (m === "agente") pintarHilo();
}
document.querySelectorAll("#modos button").forEach(function (b) { b.onclick = function () { modo(b.dataset.m); }; });

function cargarResumen() {
  api("resumen").then(function (r) {
    var k = r.kpis || {};
    $("#sinDatos").style.display = r.hay_datos ? "none" : "";
    $("#sync").textContent = "Datos de Instagram: " + hace(r.sync_ts);
    $("#kpis").innerHTML = [["Alcance 7 días", num(k.alcance7), cambio(k.alcance7_cambio)], ["Seguidores nuevos 7 días", num(k.seguidores7), k.seguidores_total ? "<i>" + num(k.seguidores_total) + " en total</i>" : ""],
      ["Guardados 7 días", num(k.guardados7), cambio(k.guardados7_cambio)], ["DMs sin responder", r.dms_error ? "?" : num(k.dms_pendientes), r.dms_error ? '<i class="baja">falta permiso</i>' : ""]].map(function (x) { return '<div class="kpi"><small>' + x[0] + "</small><b>" + x[1] + "</b>" + x[2] + "</div>"; }).join("");
    badge("#bIdeas", (r.ideas_nuevas || 0) + (r.historias_nuevas || 0)); $("#bIR").textContent = r.ideas_nuevas || ""; $("#bIH").textContent = r.historias_nuevas || ""; badge("#bDms", r.dms_error ? 0 : k.dms_pendientes);
    if (r.reporte) { $("#reporte").className = "reporte"; $("#reporte").textContent = String(r.reporte.texto || "").replace(/^[\u2600-\u27BF\uD83C-\uDBFF\uDC00-\uDFFF\uFE0F]+\s*/, ""); $("#repFecha").textContent = fecha(r.reporte.ts); }
    var f = r.formatos || [];
    $("#formatos").className = "tabla cards"; $("#formatos").innerHTML = f.length ? "<table><tr><th>Formato</th><th class=\"n\">Reels</th><th class=\"n\">Alcance mediano</th><th class=\"n\">Mejor</th><th class=\"n\">Tiempo visto</th><th class=\"n\">Guardados cada mil</th></tr>" + f.map(function (x) {
      return '<tr><td class="t1">' + esc(FORMATOS[x.formato] || x.nombre) + '</td><td class="n" data-l="Reels">' + x.reels + '</td><td class="n" data-l="Alcance mediano"><b>' + num(x.alcance_mediano) + '</b></td><td class="n" data-l="Mejor">' + num(x.mejor) + '</td><td class="n" data-l="Tiempo visto">' + (x.tiempo_s ? Math.round(x.tiempo_s) + " s" : "-") + '</td><td class="n" data-l="Guardados ‰">' + (x.guardados_mil == null ? "-" : x.guardados_mil) + "</td></tr>"; }).join("") + "</table>" : '<div class="vacio">Sin reels guardados todavía.</div>';
  }).catch(function () {});
}
function badge(s, n) { var b = $(s); b.style.display = n ? "" : "none"; b.textContent = n || ""; }
$("#bReporte").onclick = function () { var b = this; b.disabled = true; b.lastChild.textContent = "Generando..."; api("reporte", { telegram: confirm("¿Mandarlo también por Telegram?") }).then(function (r) { b.disabled = false; b.lastChild.textContent = "Generar reporte"; if (!r.ok) return aviso(r.error || "No se pudo"); cargarResumen(); aviso("Reporte listo"); }); };
$("#bTraer").onclick = function () { var b = this; b.disabled = true; b.lastChild.textContent = "Trayendo..."; api("actualizar", { todo: true }).then(function (r) { b.disabled = false; b.lastChild.textContent = "Traer datos ahora"; aviso(r.ok ? "Listo: " + ((r.posts && r.posts.guardadas) || 0) + " publicaciones actualizadas" : "No se pudo: " + r.error); cargarResumen(); }); };

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
$("#bIdeasGen").onclick = function () { var b = this; b.disabled = true; b.lastChild.textContent = "Pensando ideas..."; api("generar-ideas", {}).then(function (r) { b.disabled = false; b.lastChild.textContent = "Generar ideas nuevas"; if (!r.ok) return aviso(r.error); $("#fIdeas").value = "nueva"; cargarIdeas(); cargarResumen(); aviso(r.cantidad + " ideas nuevas"); }); };

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
    $("#reels").className = "tabla cards"; $("#reels").innerHTML = l.length ? "<table><tr><th>Fecha</th><th>Tipo</th><th>Formato</th><th class=\"n\">Alcance</th><th class=\"n\">Tiempo visto</th><th class=\"n\">Guardados</th><th class=\"n\">Compartidos</th><th class=\"n\">Coment.</th><th></th></tr>" + l.map(function (p) {
      var tipo = p.tipo === "REELS" ? (p.en_feed === 0 ? '<span class="pill pr">Reel de prueba</span>' : '<span class="pill">Reel</span>') : '<span class="pill">' + (p.media === "CAROUSEL_ALBUM" ? "Carrusel" : p.media === "IMAGE" ? "Foto" : "Publicación") + "</span>";
      var sel = p.tipo === "REELS" ? '<select data-id="' + esc(p.id) + '">' + (p.formato ? "" : '<option value="">Sin clasificar</option>') + ops.map(function (k) { return '<option value="' + k + '"' + (p.formato === k ? " selected" : "") + ">" + FORMATOS[k] + "</option>"; }).join("") + "</select>" + (p.gancho ? '<div class="estado" style="margin-top:3px">"' + esc(p.gancho) + '"</div>' : "") : "";
      return '<tr><td class="t0" style="white-space:nowrap">' + fecha(p.ts) + '</td><td class="t2">' + tipo + '</td><td class="t3">' + sel + '</td><td class="n" data-l="Alcance"><b>' + num(p.alcance) + '</b></td><td class="n" data-l="Tiempo visto">' + (p.tiempo_ms ? Math.round(p.tiempo_ms / 1000) + " s" : "-") + '</td><td class="n" data-l="Guardados">' + num(p.guardados) + '</td><td class="n" data-l="Compartidos">' + num(p.compartidos) + '</td><td class="n" data-l="Comentarios">' + num(p.comentarios) + '</td><td class="ver"><a class="btn ch" target="_blank" rel="noopener" href="' + esc(p.link) + '">Ver en Instagram</a></td></tr>';
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

// ---------- Historias ----------
var TIPOS_H = { cotizaciones: "Cotizaciones reales", producto: "Producto", encuesta: "Encuesta", pregunta: "Caja de preguntas", quiz: "Quiz", cupo: "Cupo abierto", detras: "Detrás de escena", resultado: "Pedido entregado", consejo: "Consejo" };
var STK = { encuesta: "STICKER DE ENCUESTA", pregunta: "STICKER DE PREGUNTAS", quiz: "STICKER DE QUIZ", link: "STICKER DE ENLACE (WhatsApp 805)" };
var IDEAS_K = "reels";
function ideasTipo(k) {
  IDEAS_K = k; document.querySelectorAll("#ideasTipo button").forEach(function (b) { b.classList.toggle("on", b.dataset.k === k); });
  $("#i-reels").style.display = k === "reels" ? "" : "none"; $("#i-hist").style.display = k === "hist" ? "" : "none";
  if (k === "hist") cargarHist(); else cargarIdeas();
}
$("#ideasTipo").onclick = function (ev) { var b = ev.target.closest("button"); if (b) ideasTipo(b.dataset.k); };
function cargarHist() {
  api("historias?estado=" + $("#fHist").value).then(function (l) {
    window.__hist = l;
    $("#historias").innerHTML = l.length ? l.map(function (x) {
      var st = x.sticker;
      return '<div class="idea" data-id="' + esc(x.id) + '"><div class="tit"><h3>' + esc(x.titulo) + '</h3><span class="pill n">' + esc(TIPOS_H[x.tipo] || x.tipo) + "</span></div>" +
        (x.mostrar ? '<div class="pq" style="color:var(--txt);font-size:14px"><b>Qué mostrar:</b> ' + esc(x.mostrar) + "</div>" : "") +
        (x.texto ? '<div class="gancho"><small>TEXTO EN LA HISTORIA</small>' + esc(x.texto) + "</div>" : "") +
        (st ? '<div class="sticker"><small>' + (STK[st.tipo] || "STICKER") + "</small>" + (st.pregunta ? "<b>" + esc(st.pregunta) + "</b>" : "") + (st.opciones && st.opciones.length ? '<div class="ops">' + st.opciones.map(function (o) { return "<span>" + esc(o) + "</span>"; }).join("") + "</div>" : "") + "</div>" : "") +
        (x.refs && x.refs.length ? '<div class="refs">' + x.refs.map(function (c) { return '<a class="btn ch" target="_blank" rel="noopener" href="/panel/cotizar/pdf?id=' + encodeURIComponent(c.id) + '">Ver cotización' + (c.num ? " N° " + c.num : "") + "</a>"; }).join("") + "</div>" : "") +
        '<div class="pq"><b>Por qué:</b> ' + esc(x.por_que) + "</div>" +
        '<div class="fila" style="margin-top:10px">' + (x.estado !== "subida" ? '<button class="btn p ch" data-e="subida">Ya la subí</button>' : "") + (x.estado !== "descartada" ? '<button class="btn ch" data-e="descartada">Descartar</button>' : "") + (x.estado !== "nueva" ? '<button class="btn ch" data-e="nueva">Volver a pendientes</button>' : "") + (x.texto ? '<button class="btn ch" data-c="1">Copiar texto</button>' : "") + "</div></div>";
    }).join("") : '<div class="vacio">No hay historias acá. Tocá <b>Generar historias</b>.</div>';
  });
}
$("#fHist").onchange = cargarHist;
$("#historias").onclick = function (ev) {
  var b = ev.target.closest("button"); if (!b) return; var card = b.closest(".idea"), idv = card.dataset.id;
  if (b.dataset.c) { var x = (window.__hist || []).filter(function (i) { return i.id === idv; })[0]; if (x) navigator.clipboard.writeText(x.texto + (x.sticker && x.sticker.pregunta ? "\n\n" + x.sticker.pregunta + (x.sticker.opciones && x.sticker.opciones.length ? "\n" + x.sticker.opciones.join(" / ") : "") : "")).then(function () { aviso("Texto copiado"); }); return; }
  api("historia-estado", { id: idv, estado: b.dataset.e }).then(function () { card.remove(); cargarResumen(); });
};
$("#bHistGen").onclick = function () { var b = this; b.disabled = true; var t = b.lastChild.textContent; b.lastChild.textContent = "Pensando historias..."; api("generar-historias", {}).then(function (r) { b.disabled = false; b.lastChild.textContent = t; if (!r.ok) return aviso(r.error); $("#fHist").value = "nueva"; cargarHist(); cargarResumen(); aviso(r.cantidad + " historias nuevas"); }); };

// ---------- Videos ----------
var VAPI = function (r, body, metodo, extra) { return fetch("/panel/api/videos/" + r, { method: metodo || (body ? "POST" : "GET"), headers: Object.assign(body && !(body instanceof Blob) ? { "Content-Type": "application/json" } : {}, extra || {}), body: body instanceof Blob ? body : body ? JSON.stringify(body) : undefined }).then(function (x) { if (x.status === 401) { location.href = "/login?volver=/panel/redes%23videos"; throw 0; } return x.json(); }); };
var VSEL = [], VEST = null, vTimer = null, SUBIENDO = false;
function gbs(b) { return b < 1073741824 ? Math.max(1, Math.round(b / 1048576)) + " MB" : (b / 1073741824).toFixed(2).replace(".", ",") + " GB"; }
function cuando(ts) { var d = new Date(ts); return d.toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "numeric" }) + " " + d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" }) + " h"; }
function tipoInicial(f, i, todos) { var n = f.name.toLowerCase(); return /gancho|hook/.test(n) ? "gancho" : /cuerpo|body/.test(n) ? "cuerpo" : todos.length === 1 ? "completo" : i === 0 ? "gancho" : "cuerpo"; }
function agregarArchivos(lista) {
  if (SUBIENDO) return;
  var nuevos = Array.prototype.slice.call(lista || []).filter(function (f) { return f && f.size > 0 && !/^image\//.test(f.type || ""); });
  if (!nuevos.length) return aviso(lista && lista.length ? "Esos archivos no son videos" : "No llegó ningún archivo: probá de nuevo");
  var todos = VSEL.map(function (x) { return x.f; }).concat(nuevos);
  VSEL = VSEL.concat(nuevos.map(function (f, i) { return { f: f, tipo: tipoInicial(f, VSEL.length + i, todos) }; })).slice(0, 12);
  pintarSel();
}
var ultSel = "";
function tomarArchivos(inp) { var fs = inp.files; if (!fs || !fs.length) return; esperandoGaleria = false; var firma = Array.prototype.map.call(fs, function (f) { return f.name + f.size; }).join("|"); if (firma === ultSel) return; ultSel = firma; agregarArchivos(fs); setTimeout(function () { inp.value = ""; ultSel = ""; }, 1500); }
function diag(inp, ev) { var fs = inp.files || []; $("#vDiag").textContent = "v4 · " + ev + ": recibí " + fs.length + " archivo" + (fs.length === 1 ? "" : "s") + (fs.length ? " (" + Array.prototype.map.call(fs, function (f) { return (f.type || "sin tipo") + " " + Math.round(f.size / 1048576) + " MB"; }).join(", ") + ")" : ""); }
$("#vArch").addEventListener("change", function () { diag(this, "change"); tomarArchivos(this); });
$("#vArch2").addEventListener("change", function () { diag(this, "botón común"); tomarArchivos(this); });
$("#vArch").addEventListener("input", function () { diag(this, "input"); tomarArchivos(this); });
var esperandoGaleria = false;
$("#vArch").addEventListener("click", function () { esperandoGaleria = true; });
window.addEventListener("focus", function () { if (!esperandoGaleria) return; setTimeout(function () { if (esperandoGaleria && !VSEL.length) aviso("El teléfono no entregó los videos. Probá elegir de a uno, o desde Archivos en vez de Fotos."); esperandoGaleria = false; }, 2500); });
var DROP = $("#vDrop");
["dragenter", "dragover"].forEach(function (e) { DROP.addEventListener(e, function (ev) { ev.preventDefault(); DROP.classList.add("sobre"); }); });
["dragleave", "drop"].forEach(function (e) { DROP.addEventListener(e, function (ev) { ev.preventDefault(); DROP.classList.remove("sobre"); }); });
DROP.addEventListener("drop", function (ev) { if (ev.dataTransfer && ev.dataTransfer.files) agregarArchivos(ev.dataTransfer.files); });
function pl(n, a, b) { return n + " " + (n === 1 ? a : b); }
var TIPOS = [["gancho", "Gancho"], ["cuerpo", "Cuerpo"], ["completo", "Completo"]];
function pintarSel() {
  var tot = VSEL.reduce(function (s, x) { return s + x.f.size; }, 0);
  $("#vSel").innerHTML = VSEL.map(function (x, i) {
    return '<div class="cl" data-i="' + i + '"><span class="cl-ic"><svg class=\"ic\" viewBox=\"0 0 24 24\" aria-hidden=\"true\"><rect x=\"2.5\" y=\"6\" width=\"13\" height=\"12\" rx=\"2.5\"/><path d=\"M15.5 10.2l6-3.2v10l-6-3.2z\"/></svg></span><span class="cl-n"><b>' + esc(x.f.name) + '</b><span class="estado" id="vp' + i + '">' + (x.f.size / 1048576).toFixed(0) + ' MB</span></span>' +
      (SUBIENDO ? "<span></span>" : '<button class="quitar" data-q="' + i + '" aria-label="Quitar clip"><svg class=\"ic\" viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M6 6l12 12M18 6L6 18\"/></svg></button>') +
      '<div class="seg">' + TIPOS.map(function (t) { return '<button data-t="' + t[0] + '"' + (x.tipo === t[0] ? ' class="on"' : "") + (SUBIENDO ? " disabled" : "") + ">" + t[1] + "</button>"; }).join("") + '</div><div class="cprog" id="vb' + i + '"><i></i></div></div>';
  }).join("") + (VSEL.length ? '<div class="resumensel"><span>' + VSEL.length + " clip" + (VSEL.length === 1 ? "" : "s") + " · " + gbs(tot) + "</span><span>" + pl(VSEL.filter(function (x) { return x.tipo === "gancho"; }).length, "gancho", "ganchos") + " · " + pl(VSEL.filter(function (x) { return x.tipo === "cuerpo"; }).length, "cuerpo", "cuerpos") + "</span></div>" : "");
  $("#bSubir").disabled = !VSEL.length || SUBIENDO;
  $("#vDrop").style.display = SUBIENDO ? "none" : "";
}
$("#vSel").onclick = function (ev) {
  var b = ev.target.closest("button"); if (!b || SUBIENDO) return;
  if (b.dataset.q != null) { VSEL.splice(+b.dataset.q, 1); pintarSel(); return; }
  var c = b.closest(".cl"); if (b.dataset.t && c) { VSEL[+c.dataset.i].tipo = b.dataset.t; pintarSel(); }
};
function subirClip(lote, i, x, parteTam) {
  var f = x.f, tipo = f.type || "video/mp4", base = "lote=" + lote + "&n=" + i, el = $("#vp" + i), bar = $("#vb" + i), mb = (f.size / 1048576).toFixed(0) + " MB";
  function marca(p, pc) { if (el) el.textContent = mb + " · " + p; if (bar) { bar.style.display = "block"; bar.firstChild.style.width = (pc == null ? 100 : pc) + "%"; bar.classList.toggle("ok", pc == null); } }
  if (f.size <= parteTam) { marca("subiendo...", 50); return VAPI("subir-simple?" + base, f, "PUT", { "x-tipo": tipo }).then(function (r) { if (!r.ok) throw new Error(r.error || "error"); marca("subido"); }); }
  return VAPI("subir-inicio?" + base, {}, "POST", { "x-tipo": tipo }).then(function (r) {
    if (!r.uploadId) throw new Error(r.error || "no se pudo empezar");
    var total = Math.ceil(f.size / parteTam), partes = [], k = 0;
    function sig() {
      if (k >= total) return VAPI("subir-fin?" + base, { partes: partes }).then(function (z) { if (!z.ok) throw new Error(z.error || "error al cerrar"); marca("subido"); });
      var n = k + 1, trozo = f.slice(k * parteTam, Math.min(f.size, (k + 1) * parteTam));
      marca("subiendo " + Math.round((k / total) * 100) + "%", Math.max(4, Math.round((k / total) * 100)));
      return VAPI("subir-parte?" + base + "&parte=" + n, trozo, "PUT").then(function (p) { if (!p.etag) throw new Error(p.error || "parte fallida"); partes.push(p); k++; return sig(); });
    }
    return sig();
  });
}
$("#bSubir").onclick = function () {
  if (!VSEL.length || SUBIENDO) return; SUBIENDO = true; pintarSel(); $("#vProg").textContent = "Preparando...";
  var lote;
  VAPI("lote-nuevo", { clips: VSEL.map(function (x) { return { nombre: x.f.name, tipo: x.tipo, bytes: x.f.size }; }) }).then(function (r) {
    if (!r.lote) throw new Error(r.error || "No se pudo crear el lote");
    lote = r.lote; var parte = (VEST && VEST.parte) || 20971520, i = 0;
    function sig() { if (i >= VSEL.length) return; var j = i++; $("#vProg").textContent = "Subiendo clip " + (j + 1) + " de " + VSEL.length + " (no cierres esta pantalla)"; return subirClip(lote, j, VSEL[j], parte).then(sig); }
    return sig();
  }).then(function () { return VAPI("lote-listo", { lote: lote }); }).then(function (r) {
    if (!r.ok) throw new Error(r.error || "error");
    SUBIENDO = false; VSEL = []; $("#vArch").value = ""; pintarSel(); $("#vProg").textContent = r.editor === "ya" ? "Listo. Ya se están editando: en 10 a 15 minutos te aviso por Telegram." : "Listo. Se editan en la próxima vuelta del editor y te aviso por Telegram."; cargarVideos();
  }).catch(function (e) {
    SUBIENDO = false; pintarSel(); $("#vProg").textContent = "No se pudo subir: " + (e && e.message ? e.message : "error");
    if (lote) VAPI("lote-cancelar", { lote: lote }).catch(function () {});
  });
};
var ESTL = { subiendo: "Subiendo", en_cola: "En cola para editar", procesando: "Editando...", error: "Error" };
function cargarVideos() {
  VAPI("estado").then(function (r) {
    VEST = r; if (r.error) { $("#vRev").innerHTML = '<div class="vacio">' + esc(r.error) + "</div>"; return; }
    var pc = Math.min(100, Math.round((r.usado / r.tope) * 100));
    $("#vEspacio").textContent = "Espacio: " + gbs(r.usado) + " de " + gbs(r.tope);
    $("#vBarra").className = "barra" + (pc < 70 ? " ok" : ""); $("#vBarra").firstChild.style.width = pc + "%";
    $("#vLotes").innerHTML = r.lotes.length ? r.lotes.map(function (l) { return '<div class="clip"><span>' + l.clips.length + " clips (" + l.clips.map(function (c) { return c.tipo; }).join(", ") + ') <span class="estado">' + hace(l.ts) + "</span>" + (l.error ? '<div class="estado" style="color:var(--rojo)">' + esc(l.error) + "</div>" : "") + '</span><span class="fila"><span class="pill' + (l.estado === "error" ? "" : " n") + '">' + (ESTL[l.estado] || l.estado) + "</span>" + (l.estado === "error" ? '<button class="btn p ch" data-retry="' + l.id + '">Reintentar</button>' : "") + (l.estado !== "procesando" ? '<button class="btn ch" data-cancel="' + l.id + '">Cancelar</button>' : "") + "</span></div>"; }).join("") : '<div class="vacio">Nada en edición.</div>';
    var rev = r.videos.filter(function (v) { return v.estado === "revision" || v.estado === "error"; });
    badge("#bVid", rev.length);
    var perm = r.videos.filter(function (v) { return v.estado === "error" && /instagram_business_content_publish/.test(v.error || ""); }).length;
    $("#vPermiso").style.display = perm ? "" : "none";
    $("#vPermiso").innerHTML = "<b>Para publicar falta un permiso.</b> developers.facebook.com → tu app → Casos de uso → Instagram → Personalizar → agregá <b>instagram_business_content_publish</b>. Generá un token nuevo y pegalo en Cloudflare → Workers → instagram → Settings → Variables and Secrets → IG_TOKEN. Después volvé a aprobar el video.";
    $("#vRev").innerHTML = rev.length ? rev.map(function (v) {
      return '<div class="vcard" data-id="' + v.id + '"><video controls playsinline preload="metadata" poster="/panel/api/videos/ver?q=portada&id=' + v.id + '" src="/panel/api/videos/ver?id=' + v.id + '"></video>' +
        '<div class="fila" style="justify-content:space-between"><b>' + esc(v.texto || "") + '</b><span class="estado">' + Math.round(v.duracion || 0) + " s</span></div>" +
        (v.estado === "error" ? '<div class="nota" style="margin:0">No se pudo publicar: ' + esc(v.error || "") + "</div>" : "") +
        '<label class="estado">Texto del posteo</label><textarea data-cap="1">' + esc(v.caption || "") + "</textarea>" +
        '<div class="fila"><button class="btn p ch" data-a="aprobar"><svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg>Aprobar para las ' + r.hora + ' h</button><a class="btn ch" href="/panel/api/videos/bajar?id=' + v.id + '"><svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M7.5 10.5L12 15l4.5-4.5"/><path d="M4 15.5V18a2.5 2.5 0 0 0 2.5 2.5h11A2.5 2.5 0 0 0 20 18v-2.5"/></svg>Descargar</a><button class="btn ch" data-a="descartar">Descartar</button></div></div>';
    }).join("") : '<div class="vacio">No hay videos esperando revisión.</div>';
    var prox = r.videos.filter(function (v) { return ["aprobado", "publicando", "publicado"].indexOf(v.estado) >= 0; });
    $("#vProx").innerHTML = prox.length ? prox.map(function (v) {
      var est = v.estado === "aprobado" ? '<span class="pill n">Sale el ' + cuando(v.programado_ts) + "</span>" : v.estado === "publicando" ? '<span class="pill n">Publicando...</span>' : '<span class="pill pr">Publicado como reel de prueba</span>';
      return '<div class="clip" data-id="' + v.id + '"><span><b>' + esc(v.texto || "Video") + "</b> " + est + "</span><span class=\"fila\">" + (v.link ? '<a class="btn ch" target="_blank" rel="noopener" href="' + esc(v.link) + '">Ver en Instagram</a>' : "") + (!v.borrado ? '<a class="btn ch" href="/panel/api/videos/bajar?id=' + v.id + '">Descargar</a>' : "") + (v.estado === "aprobado" ? '<button class="btn ch" data-a="desaprobar">Frenar</button>' : "") + "</span></div>";
    }).join("") : '<div class="vacio">Nada programado todavía.</div>';
    clearTimeout(vTimer);
    if (r.lotes.some(function (l) { return l.estado === "en_cola" || l.estado === "procesando"; }) && $("#m-videos").style.display !== "none") vTimer = setTimeout(cargarVideos, 60000);
  }).catch(function () {});
}
$("#m-videos").onclick = function (ev) {
  var b = ev.target.closest("button"); if (!b) return;
  if (b.dataset.retry) { b.disabled = true; VAPI("lote-reintentar", { lote: b.dataset.retry }).then(function (r) { if (!r.ok) { b.disabled = false; return aviso(r.error || "No se pudo"); } aviso("Reintentando: en 10 a 15 minutos te aviso"); cargarVideos(); }); return; }
  if (b.dataset.cancel) { if (!confirm("¿Cancelar este lote? Se borran los clips.")) return; VAPI("lote-cancelar", { lote: b.dataset.cancel }).then(cargarVideos); return; }
  var card = b.closest("[data-id]"); if (!card || !b.dataset.a) return;
  var ta = card.querySelector("textarea"), a = b.dataset.a;
  if (a === "descartar" && !confirm("¿Descartar este video? Se borra.")) return;
  b.disabled = true;
  VAPI(a, { id: card.dataset.id, caption: ta ? ta.value : undefined }).then(function (r) { if (!r.ok) { b.disabled = false; return aviso(r.error || "No se pudo"); } if (a === "aprobar") aviso("Programado: sale el " + cuando(r.programado_ts)); cargarVideos(); });
};
$("#m-videos").addEventListener("change", function (ev) { var t = ev.target; if (!t.dataset.cap) return; var card = t.closest("[data-id]"); VAPI("caption", { id: card.dataset.id, caption: t.value }).then(function (r) { if (r.ok) aviso("Texto guardado"); }); });
VAPI("estado").then(function (r) { if (r.videos) badge("#bVid", r.videos.filter(function (v) { return v.estado === "revision" || v.estado === "error"; }).length); }).catch(function () {});

${CARR_JS}
cargarResumen();
api("dms").then(function (r) { badge("#bDms", r.error ? 0 : r.dms.length); }).catch(function () {});
function desdeHash() { var h = location.hash.slice(1); modo(["resumen", "ideas", "dms", "videos", "carr", "reels", "agente"].indexOf(h) >= 0 ? h : "resumen"); }
window.addEventListener("hashchange", desdeHash);
desdeHash();
</script></body></html>`;
