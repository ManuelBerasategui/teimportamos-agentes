/**
 * Buscador de proveedores · Te Importamos (v1.1: + búsqueda web multipaís con Tavily)
 *
 * Cómo funciona (todo asincrónico, para no pasar los ~30 s ni los 50 subpedidos de Cloudflare gratis):
 *   1. El panel (worker "cotizador") guarda una fila en la tabla "busquedas" con estado "nueva".
 *   2. Cada 2 minutos este worker toma las nuevas, arma las palabras en chino/inglés con Gemini
 *      y lanza las búsquedas en Apify (1688 y Alibaba). Estado → "buscando".
 *   3. En las vueltas siguientes revisa si Apify terminó, trae los resultados, descarta lo que no
 *      coincide, calcula el precio puesto en Argentina, puntúa y guarda los mejores en "proveedores".
 *   4. Deja una tarea "busqueda_lista" en Pendientes y avisa por Telegram a quien le tocó.
 *
 * Variables (Cloudflare > buscador > Settings > Variables and Secrets):
 *   Secret: TAVILY_KEY (búsqueda web, 1.000 gratis por mes), APIFY_TOKEN, GEMINI_KEY (de un proyecto de Google APARTE del cotizador), VERIFY_TOKEN, TELEGRAM_TOKEN
 *   Texto (opcionales): MAX_TAVILY_MES, MAX_BUSQUEDAS_DIA, MAX_USD_MES, MAX_RESULTADOS_FUENTE, RECARGO_1688, ACTOR_1688, ACTOR_ALIBABA, TELEGRAM_CHAT
 * Binding: DB (D1 "agente", la misma del cotizador)
 */

// =====================================================================
//  ✏️ ZONA EDITABLE
// =====================================================================
// Fórmula de cotización China (la misma del cotizador)
const T = { fleteKg: 18, handling: 30, honorarios: 80, factor: 1.3, aereoFijo: 950, aereoDesde: 50, aereoHasta: 250, barcoFijo: 100 };
// Topes de costo (Apify plan gratis = USD 5 por mes). Se pueden cambiar con variables en Cloudflare.
const TOPES = { busquedasPorDia: 3, usdPorMes: 4.5, resultadosPorFuente: 20, usdPorRun: 0.12, guardarMejores: 10, minutosMaxRun: 20, porVuelta: 2 };
// 1688 cotiza precio de mercado interno chino: falta el envío hasta el depósito del agente de compras y su comisión
const RECARGO_1688 = 0.10;
// Actores de Apify (dueño~nombre) y precio aproximado por resultado en el plan gratis (para presupuestar)
const ACTORES = {
  "1688": { id: "webdata_labs~1688-scraper", usdPorItem: 0.003 },
  alibaba: { id: "automation-lab~alibaba-products-scraper", usdPorItem: 0.003 },
};
const PROHIBIDO = /\b(vapes?|vapers?|vapeador|elf ?bar|lost ?mary|pods? desechables?|puffs?|cigarrillos?|tabaco|nicotina|medicamentos?|f[aá]rmacos?|drogas?|marihuana|cannabis|thc|cbd)\b/i;
// Búsqueda web (Tavily): países, idioma de las búsquedas y cuántas búsquedas por país
const PAISES = {
  ar: { nombre: "Argentina", tavily: "argentina", idioma: "español rioplatense", bandera: "🇦🇷" },
  py: { nombre: "Paraguay", tavily: "paraguay", idioma: "español (Paraguay, Ciudad del Este)", bandera: "🇵🇾" },
  br: { nombre: "Brasil", tavily: "brazil", idioma: "portugués de Brasil", bandera: "🇧🇷" },
  cl: { nombre: "Chile", tavily: "chile", idioma: "español de Chile", bandera: "🇨🇱" },
  us: { nombre: "EE. UU.", tavily: "united states", idioma: "inglés de EE. UU.", bandera: "🇺🇸" },
  cn: { nombre: "China", tavily: "china", idioma: "inglés (fábricas chinas que exportan)", bandera: "🇨🇳" },
};
const WEB = { consultasPorPais: 2, resultadosPorConsulta: 8, consultasPorVuelta: 5, guardarPorPais: 5, tavilyPorMes: 950 };
const VERSION = "buscador v1.1";
// =====================================================================

const AR = 3 * 3600e3;   // Argentina = UTC-3
const inicioDiaAR = (ts = Date.now()) => Math.floor((ts - AR) / 86400e3) * 86400e3 + AR;
const inicioMesAR = (ts = Date.now()) => { const d = new Date(ts - AR); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) + AR; };
const id6 = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const n = (v, def = 0) => (Number.isFinite(+v) && v !== "" && v !== null ? +v : def);
const red = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d;
const topes = (env) => ({
  busquedasPorDia: n(env.MAX_BUSQUEDAS_DIA, TOPES.busquedasPorDia),
  usdPorMes: n(env.MAX_USD_MES, TOPES.usdPorMes),
  resultadosPorFuente: Math.min(50, n(env.MAX_RESULTADOS_FUENTE, TOPES.resultadosPorFuente)),
});

// ---------------------------------------------------------------------------
// Tablas (el panel del cotizador tiene una copia idéntica de este esquema)
// ---------------------------------------------------------------------------
export const ESQUEMA = [
  "CREATE TABLE IF NOT EXISTS busquedas (id TEXT PRIMARY KEY, ts INTEGER, num INTEGER, producto TEXT, cantidad INTEGER, calidad TEXT, presupuesto TEXT, fuentes TEXT, solo_minimo INTEGER DEFAULT 1, asignado TEXT, creado_por TEXT, cliente TEXT, tel TEXT, tarea TEXT, estado TEXT, nota TEXT, consultas TEXT, peso_kg REAL, runs TEXT, costo REAL DEFAULT 0, lanzada_ts INTEGER, lista_ts INTEGER, n_prov INTEGER DEFAULT 0, mejor_u REAL, archivada INTEGER DEFAULT 0)",
  "CREATE INDEX IF NOT EXISTS busquedas_estado ON busquedas(estado, ts)",
  "CREATE INDEX IF NOT EXISTS busquedas_asignado ON busquedas(asignado, ts)",
  "CREATE TABLE IF NOT EXISTS proveedores (id TEXT PRIMARY KEY, busqueda TEXT, ts INTEGER, fuente TEXT, titulo TEXT, titulo_orig TEXT, link TEXT, foto TEXT, proveedor TEXT, prov_link TEXT, ubicacion TEXT, tipo TEXT, verificado INTEGER, anios INTEGER, ventas INTEGER, calif REAL, minimo INTEGER, tramos TEXT, moneda TEXT, precio_u REAL, precio_usd REAL, puesto_u REAL, total REAL, minimo_ok INTEGER, parecido INTEGER, puntaje REAL, contacto TEXT, estado TEXT DEFAULT 'nuevo', notas TEXT)",
  "CREATE INDEX IF NOT EXISTS proveedores_busqueda ON proveedores(busqueda, puntaje)",
  "CREATE TABLE IF NOT EXISTS tareas (id TEXT PRIMARY KEY, ts INTEGER, tipo TEXT, tel TEXT, nombre TEXT, titulo TEXT, detalle TEXT, datos TEXT, ref TEXT, estado TEXT)",
  "CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT, exp INTEGER)",
];
// Columnas agregadas después (si ya existen, el error se ignora). Copia idéntica en el panel.
export const MIGRACIONES = [
  "ALTER TABLE busquedas ADD COLUMN paises TEXT",
  "ALTER TABLE busquedas ADD COLUMN web TEXT",
  "ALTER TABLE proveedores ADD COLUMN pais TEXT",
  "ALTER TABLE proveedores ADD COLUMN calidad TEXT",
  "ALTER TABLE proveedores ADD COLUMN contactos TEXT",
  "ALTER TABLE proveedores ADD COLUMN resumen TEXT",
  "ALTER TABLE proveedores ADD COLUMN cant INTEGER",
];
let tablasListas = false;
async function prepararTablas(env) {
  if (tablasListas) return;
  await env.DB.batch(ESQUEMA.map((s) => env.DB.prepare(s)));
  for (const m of MIGRACIONES) await env.DB.prepare(m).run().catch(() => {});
  tablasListas = true;
}
const kvGet = async (env, k) => {
  const r = await env.DB.prepare("SELECT v, exp FROM kv WHERE k=?").bind(k).first();
  return r && (!r.exp || r.exp > Date.now()) ? r.v : null;
};
const kvPut = (env, k, v, segundos) => env.DB.prepare("INSERT INTO kv (k,v,exp) VALUES (?,?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v, exp=excluded.exp")
  .bind(k, String(v), segundos ? Date.now() + segundos * 1000 : null).run();

// ---------------------------------------------------------------------------
// Cálculos: precio puesto en Argentina y puntaje
// ---------------------------------------------------------------------------
export const flete = (kg) => (kg > T.aereoHasta ? T.barcoFijo : kg >= T.aereoDesde ? T.aereoFijo : kg * T.fleteKg);
export function precioParaCantidad(tramos, cant) {
  const o = (tramos || []).filter((t) => t.precio > 0).sort((a, b) => a.desde - b.desde);
  if (!o.length) return null;
  let p = o[0].precio;
  for (const t of o) if (cant >= t.desde) p = t.precio;
  return p;
}
// precioUsd = precio unitario FOB en dólares (ya con recargo si es 1688)
export function puestoEnArgentina(precioUsd, cantidad, pesoKg) {
  const fob = precioUsd * cantidad, kg = pesoKg * cantidad, fl = flete(kg);
  const total = (fob + fl + T.handling) * T.factor + T.honorarios;
  return { fob, kg, flete: fl, total, unidad: total / cantidad };
}

// Confiabilidad de 0 a 10 según lo que publica cada sitio
function confiabilidad(p) {
  let s = 3;
  if (p.verificado) s += 2.5;
  if (p.tipo === "fábrica") s += 1.5;
  if (p.anios) s += Math.min(2, p.anios / 4);
  if (p.calif) s += p.calif >= 4.8 ? 1.5 : p.calif >= 4.5 ? 1 : 0;   // calificación 0 a 5
  if (p.ventas) s += Math.min(1.5, Math.log10(p.ventas + 1) / 3);
  return Math.min(10, s);
}
// Puntaje 1 a 10: precio 40% · confiabilidad 25% · mínimo 15% · parecido 15% · datos completos 5%
// Texto de cantidad para títulos y avisos ("x50" o "sin cantidad")
const qtxt = (b) => (n(b.cantidad) > 0 ? `x${b.cantidad}` : "(sin cantidad" + (presupuestoUsd(b) ? `, presupuesto USD ${presupuestoUsd(b)}` : "") + ")");
export const presupuestoUsd = (b) => { const m = String(b.presupuesto || "").replace(/\./g, "").replace(",", ".").match(/\d+(\.\d+)?/); return m ? +m[0] : 0; };
// Sin cantidad: con presupuesto, la mayor cantidad (desde el mínimo) que entra en el presupuesto; sin presupuesto, el mínimo del proveedor
export function cantidadSugerida(p, b, aUsd, peso) {
  const q0 = Math.max(1, n(p.minimo, 1)), tope = presupuestoUsd(b);
  if (!tope) return { q: q0, excede: false };
  let mejor = 0;
  for (let q = q0; q <= 20000; q += q < 200 ? 1 : q < 2000 ? 10 : 100) {
    const t = puestoEnArgentina(aUsd(precioParaCantidad(p.tramos, q)), q, peso).total;
    if (t <= tope) mejor = q;
  }
  return mejor ? { q: mejor, excede: false } : { q: q0, excede: true };
}
export function puntuar(lista, cantidad) {
  const conPrecio = lista.filter((p) => p.puesto_u > 0);
  const mejor = Math.min(...conPrecio.map((p) => p.puesto_u));
  for (const p of lista) {
    const precio = p.puesto_u > 0 ? 10 * (mejor / p.puesto_u) : 0;
    const minimo = !cantidad || !p.minimo || p.minimo <= cantidad ? 10 : Math.max(0, 10 * (cantidad / p.minimo));
    const parecido = p.parecido ?? 6;
    const datos = [p.puesto_u > 0, p.minimo, p.foto, p.prov_link || p.proveedor, p.tramos?.length > 1].filter(Boolean).length * 2;
    p.puntaje = red(Math.max(1, Math.min(10, precio * 0.4 + confiabilidad(p) * 0.25 + minimo * 0.15 + parecido * 0.15 + datos * 0.05)), 1);
  }
  return lista.sort((a, b) => b.puntaje - a.puntaje);
}

// ---------------------------------------------------------------------------
// Normalizar lo que devuelve cada actor de Apify a un formato común
// ---------------------------------------------------------------------------
export function normalizar(fuente, it) {
  if (fuente === "1688") {
    const s = it.merchantSigns || {}, tags = (it.merchantTags || []).join(" ");
    let tramos = (it.priceTiers || []).map((t) => ({ desde: n(t.minQuantity, 1), precio: n(t.price) })).filter((t) => t.precio > 0);
    if (!tramos.length && n(it.priceMin)) tramos = [{ desde: n(it.minimumOrderQuantity, 1), precio: n(it.priceMax || it.priceMin) }];
    // Si varios "tramos" tienen la misma cantidad, en realidad son modelos/colores con distinto precio: se usa el más caro
    let variantes = "";
    const porCant = new Map();
    for (const t of tramos) porCant.set(t.desde, [...(porCant.get(t.desde) || []), t.precio]);
    if ([...porCant.values()].some((v) => v.length > 1)) {
      const todos = tramos.map((t) => t.precio);
      variantes = `Precio según modelo/color: ¥${Math.min(...todos)} a ¥${Math.max(...todos)} (se tomó el más caro; elegí el modelo en la publicación)`;
      tramos = [...porCant.entries()].map(([desde, v]) => ({ desde, precio: Math.max(...v) }));
    }
    return {
      fuente, titulo: it.titleEn || it.title || "", titulo_orig: it.title || "", link: it.url || (it.offerId ? `https://detail.1688.com/offer/${it.offerId}.html` : ""),
      foto: (it.images || [])[0] || "", proveedor: it.companyName || it.sellerLoginId || "", prov_link: it.supplierUrl || "",
      ubicacion: [it.city, it.province].filter(Boolean).join(", ") || it.location || "China",
      tipo: s.factory || /工厂|源头/.test(tags) ? "fábrica" : "trading", verificado: s.powerfulMerchant || s.trustPass ? 1 : 0,
      anios: null, ventas: n(it.soldCount) || null, calif: n(it.goodRate) ? red(n(it.goodRate) / 20, 2) : null,   // 1688 da % de buenas reseñas: se pasa a escala 0-5
      minimo: n(it.minimumOrderQuantity) || tramos[0]?.desde || null, tramos, moneda: it.currency || "CNY", contacto: "", resumen: variantes,
    };
  }
  // Alibaba
  let tramos = (it.priceTiers || []).map((t) => ({ desde: n(t.minimumQuantity, 1), precio: n(t.price) })).filter((t) => t.precio > 0);
  if (!tramos.length && n(it.minimumPrice)) tramos = [{ desde: n(it.minimumOrder, 1), precio: n(it.maximumPrice || it.minimumPrice) }];
  return {
    fuente, titulo: it.title || "", titulo_orig: it.title || "", link: it.productUrl || it.url || "", foto: it.imageUrl || (it.images || [])[0] || "",
    proveedor: it.supplierName || "", prov_link: it.supplierUrl || "", ubicacion: it.supplierCountry || "China",
    tipo: /manufactur|factory/i.test(`${it.supplierName} ${(it.badges || []).join(" ")}`) ? "fábrica" : "trading",
    verificado: it.verifiedSupplier || it.goldSupplier || it.assessedSupplier ? 1 : 0, anios: n(it.supplierYears) || null,
    ventas: n(it.soldCount) || null, calif: n(it.rating) || null, minimo: n(it.minimumOrder) || tramos[0]?.desde || null,
    tramos, moneda: it.currency || "USD", contacto: it.supplierUrl ? "Chat de Alibaba (botón Contact Supplier)" : "",
  };
}

// ---------------------------------------------------------------------------
// Servicios externos: Gemini, tipo de cambio, Apify, Telegram
// ---------------------------------------------------------------------------
async function modelos(env) {
  if (env.GEMINI_MODEL) return [env.GEMINI_MODEL];
  const g = await kvGet(env, "buscador:modelos");
  if (g) return JSON.parse(g);
  const j = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", { headers: { "x-goog-api-key": env.GEMINI_KEY } }).then((r) => r.json()).catch(() => ({}));
  const lista = (j.models || []).filter((m) => /flash/i.test(m.name) && !/image|tts|audio|live|embedding|thinking/i.test(m.name) && (m.supportedGenerationMethods || []).includes("generateContent"))
    .map((m) => m.name.replace("models/", "")).sort((a, b) => (/preview/.test(a) - /preview/.test(b)) || b.localeCompare(a, undefined, { numeric: true }));
  const final = lista.length ? lista.slice(0, 4) : ["gemini-flash-latest"];
  await kvPut(env, "buscador:modelos", JSON.stringify(final), 43200);
  return final;
}
export async function iaJSON(env, prompt) {
  if (!env.GEMINI_KEY) return null;
  const parsear = (t) => { const m = (t || "").match(/\{[\s\S]*\}/); try { return m ? JSON.parse(m[0]) : null; } catch { return null; } };
  for (const m of (await modelos(env)).slice(0, 3)) {
    if (await kvGet(env, `buscador:agotado:${m}`)) continue;
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, {
      method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_KEY },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: "application/json", temperature: 0.2 } }),
    }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : {};
    if (!r?.ok || j.error) { if (r?.status === 429) await kvPut(env, `buscador:agotado:${m}`, "1", 3 * 3600); continue; }
    const res = parsear((j.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join(""));
    if (res) return res;
  }
  return null;
}
async function yuanesPorDolar(env) {
  const g = await kvGet(env, "buscador:cny");
  if (g) return +g;
  const j = await fetch("https://open.er-api.com/v6/latest/USD").then((r) => r.json()).catch(() => null);
  const v = +j?.rates?.CNY;
  if (v > 3 && v < 15) { await kvPut(env, "buscador:cny", v, 12 * 3600); return v; }
  return n(env.CNY_POR_USD, 7.15);
}
const APIFY = "https://api.apify.com/v2";
async function apify(env, ruta, opciones = {}) {
  const r = await fetch(APIFY + ruta, { ...opciones, headers: { Authorization: `Bearer ${env.APIFY_TOKEN}`, "Content-Type": "application/json", ...(opciones.headers || {}) } }).catch((e) => ({ ok: false, status: 0, _err: String(e) }));
  const j = r.json ? await r.json().catch(() => null) : null;
  return { ok: !!r.ok, status: r.status, j, err: r._err || j?.error?.message || "" };
}
export async function telegram(env, usuario, texto) {
  if (!env.TELEGRAM_TOKEN) return false;
  const propio = usuario ? await kvGet(env, `telegram_chat:${usuario}`) : null;
  const chat = propio || env.TELEGRAM_CHAT || (await kvGet(env, "telegram_chat"));
  if (!chat) return false;
  const cuerpo = propio || !usuario ? texto : `Para ${usuario}: ${texto}`;
  const r = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/sendMessage`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chat, text: String(cuerpo).slice(0, 4000), disable_web_page_preview: true }),
  }).catch(() => null);
  return !!r?.ok;
}

// ---------------------------------------------------------------------------
// Paso 1: lanzar las búsquedas nuevas en Apify
// ---------------------------------------------------------------------------
async function gastoMes(env) {
  return n((await env.DB.prepare("SELECT SUM(costo) c FROM busquedas WHERE lanzada_ts >= ?").bind(inicioMesAR()).first())?.c);
}
async function lanzadasHoy(env) {
  return n((await env.DB.prepare("SELECT COUNT(*) c FROM busquedas WHERE lanzada_ts >= ? AND runs LIKE '%\"id\":%'").bind(inicioDiaAR()).first())?.c);
}

const CALIDAD_TXT = { replica: "RÉPLICA (copia de marca, 1:1, AAA)", original: "ORIGINAL (de marca, nuevo)", reacondicionado: "REACONDICIONADO / refurbished (original usado o reparado)", indistinto: "cualquier calidad" };
function consultasWebPorDefecto(b, paises) {
  const p = b.producto, extra = { replica: "réplica", original: "original", reacondicionado: "reacondicionado" }[b.calidad] || "";
  const base = { ar: [`${p} ${extra} por mayor mayorista`, `${p} mayorista whatsapp`], py: [`${p} ${extra} por mayor Ciudad del Este`, `${p} mayorista Paraguay`],
    br: [`${p} atacado fornecedor`, `${p} atacado whatsapp`], cl: [`${p} ${extra} mayorista Chile`, `${p} por mayor Santiago`],
    us: [`${p} wholesale distributor`, b.calidad === "reacondicionado" ? `${p} refurbished wholesale` : `${p} bulk supplier`], cn: [`${p} factory manufacturer`, `${p} wholesale supplier China`] };
  return Object.fromEntries(paises.map((k) => [k, base[k].map((x) => x.replace(/\s+/g, " ").trim())]));
}
async function prepararConsultas(env, b) {
  const paises = JSON.parse(b.paises || "[]").filter((k) => PAISES[k]);
  const web = JSON.parse(b.fuentes || "[]").includes("web") && paises.length;
  const r = await iaJSON(env, `Sos comprador de una importadora argentina. Un cliente pide este producto:
PRODUCTO: "${b.producto}"
CANTIDAD: ${n(b.cantidad) > 0 ? b.cantidad + " unidades" : "todavía no definida"} · CALIDAD: ${b.calidad || "indistinto"}${b.presupuesto ? ` · PRESUPUESTO: ${b.presupuesto}` : ""}

Devolvé SOLO este JSON:
{"zh": "palabras de búsqueda para 1688.com en chino simplificado, cortas (2 a 6 palabras), como las escribe un comprador chino",
 "en": "search keywords for Alibaba.com in English, short (2 to 6 words), wholesale style",
 "peso_kg": peso bruto estimado de UNA unidad con su caja, en kg (número),
 "peso_motivo": "una frase corta de por qué ese peso",
 "nota": "una advertencia corta si aplica (por ejemplo: si piden ORIGINAL, en 1688/Alibaba casi todo es genérico o réplica; si el producto es muy pesado o frágil), o vacío"${web ? `,
 "web": {${paises.map((k) => `"${k}": ["búsqueda 1", "búsqueda 2"]`).join(", ")}}` : ""}}
${web ? `Para "web": ${WEB.consultasPorPais} búsquedas de Google por país para encontrar PROVEEDORES (fábricas, mayoristas, distribuidores, importadores que venden por mayor) de este producto, en el idioma y la jerga de cada país: ${paises.map((k) => `${k} = ${PAISES[k].nombre}, en ${PAISES[k].idioma}`).join("; ")}. Calidad buscada: ${CALIDAD_TXT[b.calidad] || CALIDAD_TXT.indistinto}. Usá palabras como "por mayor", "mayorista", "atacado", "wholesale", "distributor", "factory" según el país; podés sumar "whatsapp" o "catálogo" para encontrar contactos.` : ""}
Reglas: no traduzcas marcas registradas como si fueran genéricas si piden réplica; usá el nombre del modelo (por ejemplo "AJ4" para Jordan 4). Nada de texto fuera del JSON.`);
  const peso = n(r?.peso_kg);
  return {
    zh: String(r?.zh || b.producto).slice(0, 80), en: String(r?.en || b.producto).slice(0, 80),
    peso_kg: peso > 0 && peso < 2000 ? peso : 0.5, peso_motivo: r ? String(r.peso_motivo || "").slice(0, 160) : "Gemini no respondió: se usa 0,5 kg por defecto",
    nota: String(r?.nota || "").slice(0, 300), ia: !!r,
    web: web ? Object.fromEntries(Object.entries({ ...consultasWebPorDefecto(b, paises), ...(r?.web || {}) }).filter(([k, v]) => paises.includes(k) && Array.isArray(v))
      .map(([k, v]) => [k, v.map((x) => String(x).slice(0, 120)).filter(Boolean).slice(0, WEB.consultasPorPais)])) : null,
  };
}

function entradaActor(fuente, b, c, max) {
  const filtroMinimo = b.solo_minimo && b.cantidad > 0;
  if (fuente === "1688") return { searchQueries: [c.zh], maxProducts: max, translateTitles: true, sortBy: "relevance", ...(filtroMinimo ? { minOrderQuantity: b.cantidad } : {}) };
  return { queries: [c.en], maxItems: max, maxPagesPerQuery: 2, ...(filtroMinimo ? { maxMinimumOrder: b.cantidad } : {}) };
}

async function tavilyUsadosMes(env) { return n(await kvGet(env, `buscador:tavily:${new Date(Date.now() - AR).toISOString().slice(0, 7)}`)); }
async function sumarTavily(env, k) { const c = `buscador:tavily:${new Date(Date.now() - AR).toISOString().slice(0, 7)}`; await kvPut(env, c, (await tavilyUsadosMes(env)) + k, 40 * 86400); }

export async function lanzarNuevas(env, log = []) {
  const nuevas = (await env.DB.prepare("SELECT * FROM busquedas WHERE estado='nueva' AND archivada=0 ORDER BY ts LIMIT ?").bind(TOPES.porVuelta).all()).results || [];
  const tp = topes(env);
  for (const b of nuevas) {
    if (PROHIBIDO.test(b.producto)) {
      await env.DB.prepare("UPDATE busquedas SET estado='error', nota=? WHERE id=?").bind("Producto que no trabajamos (vapers, tabaco, fármacos o drogas): no se busca.", b.id).run();
      log.push(`${b.id}: prohibido`); continue;
    }
    const todas = JSON.parse(b.fuentes || '["1688","alibaba"]');
    let fuentes = todas.filter((f) => ACTORES[f]);
    const notas = [];
    // Apify (1688 / Alibaba): con topes de costo
    if (fuentes.length) {
      const estimado = fuentes.reduce((s, f) => s + ACTORES[f].usdPorItem * tp.resultadosPorFuente, 0);
      const [hoy, mes] = await Promise.all([lanzadasHoy(env), gastoMes(env)]);
      let motivo = "";
      if (!env.APIFY_TOKEN) motivo = "Falta cargar APIFY_TOKEN en el worker buscador.";
      else if (hoy >= tp.busquedasPorDia) motivo = `ya se hicieron ${hoy} búsquedas en 1688/Alibaba hoy (tope ${tp.busquedasPorDia})`;
      else if (mes + estimado > tp.usdPorMes) motivo = `este mes ya se gastaron USD ${red(mes)} de USD ${tp.usdPorMes} en Apify`;
      if (motivo) {
        if (!todas.includes("web")) {   // sin web, espera a que haya cupo
          await env.DB.prepare("UPDATE busquedas SET nota=? WHERE id=?").bind(`En espera: ${motivo}. Sale sola cuando haya cupo.`, b.id).run();
          log.push(`${b.id}: ${/hoy/.test(motivo) ? "tope diario" : /mes/.test(motivo) ? "tope mensual" : "sin token"}`); continue;
        }
        notas.push(`1688/Alibaba salteado: ${motivo}`); fuentes = [];
      }
    }
    // Web (Tavily): gratis hasta 1.000 por mes
    let usarWeb = todas.includes("web") && JSON.parse(b.paises || "[]").length > 0;
    if (usarWeb && !env.TAVILY_KEY) { notas.push("Web salteada: falta cargar TAVILY_KEY en el worker buscador."); usarWeb = false; }
    if (usarWeb && (await tavilyUsadosMes(env)) >= n(env.MAX_TAVILY_MES, WEB.tavilyPorMes)) { notas.push("Web salteada: se terminaron las búsquedas gratis de Tavily de este mes."); usarWeb = false; }
    if (!fuentes.length && !usarWeb) {
      await env.DB.prepare("UPDATE busquedas SET estado='error', nota=? WHERE id=?").bind(notas.join(" · ") || "No hay fuentes para buscar.", b.id).run();
      log.push(`${b.id}: error (sin fuentes)`); continue;
    }

    const c = await prepararConsultas(env, { ...b, fuentes: JSON.stringify(usarWeb ? ["web"] : []) });
    const runs = [];
    for (const f of fuentes) {
      const q = new URLSearchParams({ maxItems: String(tp.resultadosPorFuente), maxTotalChargeUsd: String(TOPES.usdPorRun), timeout: "600" });
      const actor = (f === "1688" ? env.ACTOR_1688 : env.ACTOR_ALIBABA) || ACTORES[f].id;
      const r = await apify(env, `/acts/${actor}/runs?${q}`, { method: "POST", body: JSON.stringify(entradaActor(f, b, c, tp.resultadosPorFuente)) });
      if (r.ok && r.j?.data?.id) runs.push({ fuente: f, id: r.j.data.id, ds: r.j.data.defaultDatasetId, estado: "RUNNING", desde: Date.now() });
      else runs.push({ fuente: f, estado: "NO_ARRANCO", error: `${r.status} ${r.err}`.trim().slice(0, 200) });
    }
    const web = usarWeb && c.web ? { pend: Object.entries(c.web).flatMap(([pais, qs]) => qs.map((q) => ({ pais, q }))), cands: [], creditos: 0, errores: [] } : null;
    const arrancaron = runs.some((r) => r.id) || !!web?.pend.length;
    const nota = [c.nota, ...notas, ...runs.filter((r) => !r.id).map((r) => `${r.fuente}: no arrancó (${r.error})`)].filter(Boolean).join(" · ");
    await env.DB.prepare("UPDATE busquedas SET estado=?, consultas=?, peso_kg=?, runs=?, web=?, lanzada_ts=?, nota=? WHERE id=?")
      .bind(arrancaron ? "buscando" : "error", JSON.stringify(c), c.peso_kg, JSON.stringify(runs), web ? JSON.stringify(web) : null, Date.now(), nota, b.id).run();
    log.push(`${b.id}: ${arrancaron ? "lanzada" : "error"} (${[...runs.map((r) => r.fuente + ":" + r.estado), web ? `web:${web.pend.length} búsquedas` : ""].filter(Boolean).join(", ")})`);
  }
  return log;
}

// ---------------------------------------------------------------------------
// Paso 2: recoger los resultados de Apify, filtrar, calcular, puntuar y guardar
// ---------------------------------------------------------------------------
const TERMINADO = new Set(["SUCCEEDED", "FAILED", "TIMED-OUT", "ABORTED", "NO_ARRANCO", "VENCIDO"]);

async function filtrarParecidos(env, b, lista) {
  if (!lista.length) return lista;
  const r = await iaJSON(env, `Pedido del cliente: "${b.producto}" (calidad: ${b.calidad || "indistinto"}, cantidad ${n(b.cantidad) > 0 ? b.cantidad : "a definir"}).
Puntuá de 0 a 10 cuánto coincide cada publicación con lo pedido (10 = es exactamente eso; 0 = otra cosa, un repuesto, un accesorio o una funda).
${lista.map((p, i) => `${i}. ${String(p.titulo).slice(0, 140)}`).join("\n")}
Devolvé SOLO: {"p":[{"i":0,"s":8,"t":"título corto en español (máx. 12 palabras)"}, ...]} con todas las publicaciones.`);
  const m = new Map((r?.p || []).map((x) => [n(x.i, -1), x]));
  for (let i = 0; i < lista.length; i++) {
    const x = m.get(i);
    lista[i].parecido = x ? Math.max(0, Math.min(10, n(x.s, 6))) : null;
    if (x?.t && /[\u4e00-\u9fff]/.test(lista[i].titulo)) lista[i].titulo = String(x.t).slice(0, 160);   // traducir títulos que quedaron en chino
  }
  return lista.filter((p) => p.parecido === null || p.parecido >= 4);
}

export async function procesarResultados(env, b, items) {
  const cny = await yuanesPorDolar(env);
  const recargo = n(env.RECARGO_1688, RECARGO_1688);
  const peso = n(b.peso_kg, 0.5);
  const cantPedida = n(b.cantidad, 0);
  const vistos = new Set();
  const aUsd = (pu) => (/CNY|RMB/i.test(lista0moneda) ? (pu / cny) * (1 + recargo) : pu);
  let lista0moneda = "CNY";
  let lista = [];
  for (const { fuente, item } of items) {
    const p = normalizar(fuente, item);
    if (!p.link || vistos.has(p.link) || !p.tramos.length) continue;
    vistos.add(p.link);
    if (PROHIBIDO.test(p.titulo)) continue;
    lista0moneda = p.moneda;
    let cant = cantPedida, nota = "";
    if (!cant) {
      const sg = cantidadSugerida(p, b, aUsd, peso); cant = sg.q;
      nota = sg.excede ? `Con USD ${presupuestoUsd(b)} no alcanza: el mínimo de ${cant} u sale más` : presupuestoUsd(b) ? `Con USD ${presupuestoUsd(b)} te alcanza para ${cant} u` : `Calculado para el mínimo del proveedor (${cant} u)`;
    }
    const pu = precioParaCantidad(p.tramos, cant);
    const enUsd = aUsd(pu);
    const c = puestoEnArgentina(enUsd, cant, peso);
    Object.assign(p, { cant, precio_u: pu, precio_usd: red(enUsd, 3), puesto_u: red(c.unidad), total: red(c.total), minimo_ok: !cantPedida || !p.minimo || p.minimo <= cantPedida ? 1 : 0,
      resumen: [p.resumen, nota].filter(Boolean).join(" · ") });
    lista.push(p);
  }
  if (b.solo_minimo && cantPedida) lista = lista.filter((p) => p.minimo_ok);
  lista = await filtrarParecidos(env, b, lista.slice(0, 60));
  lista = puntuar(lista, cantPedida).slice(0, TOPES.guardarMejores);
  return lista;
}

async function guardar(env, b, lista, runs, listaWeb = [], web = null) {
  const ahora = Date.now();
  const costo = red(runs.reduce((s, r) => s + n(r.costo), 0), 4);
  const mejor = lista.length ? Math.min(...lista.map((p) => p.puesto_u).filter((v) => v > 0)) : null;
  const todos = [...lista.map((p) => ({ ...p, pais: "cn", calidad: null, contactos: null, resumen: p.resumen || "" })), ...listaWeb];
  const ops = [env.DB.prepare("DELETE FROM proveedores WHERE busqueda=?").bind(b.id)];
  for (const p of todos) {
    ops.push(env.DB.prepare(`INSERT INTO proveedores (id,busqueda,ts,fuente,titulo,titulo_orig,link,foto,proveedor,prov_link,ubicacion,tipo,verificado,anios,ventas,calif,minimo,tramos,moneda,precio_u,precio_usd,puesto_u,total,minimo_ok,parecido,puntaje,contacto,estado,notas,pais,calidad,contactos,resumen,cant)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'nuevo','',?,?,?,?,?)`).bind(
      id6(), b.id, ahora, p.fuente, String(p.titulo).slice(0, 300), String(p.titulo_orig).slice(0, 300), p.link, p.foto, String(p.proveedor).slice(0, 160), p.prov_link,
      p.ubicacion, p.tipo, p.verificado, p.anios, p.ventas, p.calif, p.minimo, JSON.stringify((p.tramos || []).slice(0, 6)), p.moneda, p.precio_u, p.precio_usd, p.puesto_u, p.total,
      p.minimo_ok, p.parecido, p.puntaje, p.contacto, p.pais, p.calidad, p.contactos ? JSON.stringify(p.contactos) : null, p.resumen || "", p.cant || null));
  }
  const fallas = runs.filter((r) => r.estado !== "SUCCEEDED").map((r) => `${r.fuente}: ${r.estado.toLowerCase()}`);
  if (web?.errores?.length) fallas.push(`web con errores (${uniq(web.errores).slice(0, 2).join("; ")})`);
  const notaPrev = String(b.nota || "").split(" · ").filter((x) => x && !/^(1688|alibaba):|^web con errores/.test(x));
  const nota = [...notaPrev, ...fallas, todos.length ? "" : "No apareció nada que coincida. Probá con otras palabras o sacá el filtro de mínimo."].filter(Boolean).join(" · ");
  ops.push(env.DB.prepare("UPDATE busquedas SET estado='lista', runs=?, web=?, costo=?, lista_ts=?, n_prov=?, mejor_u=?, nota=? WHERE id=?")
    .bind(JSON.stringify(runs), web ? JSON.stringify(web) : null, costo, ahora, todos.length, mejor, nota, b.id));
  // Pendientes: una tarea para quien le tocó
  const conWa = listaWeb.filter((p) => p.contactos?.wa?.length).length;
  const partes = [lista.length ? `${lista.length} en China con precio (mejor USD ${mejor.toFixed(2)}/u puesto)` : "", listaWeb.length ? `${listaWeb.length} en la web${conWa ? `, ${conWa} con WhatsApp` : ""}` : ""].filter(Boolean);
  const titulo = todos.length ? `Búsqueda lista: ${b.producto} ${qtxt(b)} · ${partes.join(" · ")}` : `Búsqueda sin resultados: ${b.producto} ${qtxt(b)}`;
  const porPais = uniq(listaWeb.map((p) => p.pais)).map((k) => `${PAISES[k]?.bandera || ""} ${PAISES[k]?.nombre || k}: ${listaWeb.filter((p) => p.pais === k).length}`).join(" · ");
  const detalle = `Asignada a: ${b.asignado || "-"}${b.cliente ? `\nCliente: ${b.cliente}` : ""}\n` + lista.slice(0, 3).map((p, i) => `${i + 1}. ${p.fuente} · USD ${p.puesto_u}/u puesto${n(b.cantidad) ? "" : ` (x${p.cant})`} · mín ${p.minimo || "?"} · ${String(p.titulo).slice(0, 70)}`).join("\n") + (porPais ? `\nWeb: ${porPais}` : "");
  ops.push(env.DB.prepare("INSERT INTO tareas (id, ts, tipo, tel, nombre, titulo, detalle, datos, ref, estado) VALUES (?,?,?,?,?,?,?,?,?,'abierta')")
    .bind(id6(), ahora, "busqueda_lista", b.tel || "", b.asignado ? `Para ${b.asignado}` : "", titulo, detalle, JSON.stringify({ busqueda: b.id, asignado: b.asignado }), `busq:${b.id}`));
  if (b.tarea) ops.push(env.DB.prepare("UPDATE tareas SET estado='hecha' WHERE id=? AND tipo='proveedor'").bind(b.tarea));
  await env.DB.batch(ops);
  const url = `${env.PANEL_URL || "https://cotizador.berasateguimanuel07.workers.dev"}/panel/busquedas#${b.id}`;
  await telegram(env, b.asignado, todos.length
    ? `🔎 Te dejé una búsqueda nueva: ${b.producto} ${qtxt(b)}\n${partes.join("\n")}${porPais ? `\n${porPais}` : ""}\n${url}`
    : `🔎 La búsqueda "${b.producto}" no encontró nada que coincida.\n${url}`);
  return { costo, n: todos.length, mejor };
}

// ---------------------------------------------------------------------------
// Búsqueda web (Tavily): busca, saca contactos de cada página y la IA clasifica
// ---------------------------------------------------------------------------
const uniq = (a) => [...new Set(a.filter(Boolean))];
export function sacarContactos(texto, url = "") {
  const t = `${texto || ""} ${url}`;
  const dig = (x) => String(x).replace(/\D/g, "");
  const wa = uniq([
    ...[...t.matchAll(/(?:wa\.me\/|wa\.link\/|whatsapp\.com\/send\/?\?phone=|whatsapp\.com\/send\?phone=)\+?(\d{8,15})/gi)].map((m) => m[1]),
    ...[...t.matchAll(/whats?\s?app[^0-9+\n]{0,25}(\+?\d[\d\s().-]{7,18}\d)/gi)].map((m) => dig(m[1])),
  ].filter((x) => x.length >= 8 && x.length <= 15));
  const ig = uniq([...t.matchAll(/instagram\.com\/([A-Za-z0-9_.]{2,30})/gi)].map((m) => m[1].replace(/\.$/, "")).filter((x) => !/^(p|reel|reels|explore|accounts|stories|tv|direct|share)$/i.test(x)));
  const mail = uniq([...t.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)].map((m) => m[0].toLowerCase()).filter((x) => !/\.(png|jpe?g|gif|webp|svg)$|example\.|sentry|wixpress|@2x/.test(x)));
  const tel = uniq([...t.matchAll(/(?:tel:|tel[eé]fono:?|phone:?|cel(?:ular)?:?)\s*(\+?\d[\d\s().-]{7,18}\d)/gi)].map((m) => dig(m[1])).filter((x) => x.length >= 8 && x.length <= 15 && !wa.includes(x)));
  const wechat = uniq([...t.matchAll(/we\s?chat(?:\s?id)?[:：\s]+([A-Za-z][A-Za-z0-9_-]{4,19})/gi)].map((m) => m[1]));
  return { wa: wa.slice(0, 3), ig: ig.slice(0, 2), mail: mail.slice(0, 2), tel: tel.slice(0, 2), wechat: wechat.slice(0, 2) };
}
const paisDeDominio = (u) => { try { const h = new URL(u).hostname; return h.endsWith(".py") ? "py" : h.endsWith(".ar") ? "ar" : h.endsWith(".br") ? "br" : h.endsWith(".cl") ? "cl" : h.endsWith(".cn") ? "cn" : ""; } catch { return ""; } };
const hayContacto = (c) => !!(c && (c.wa.length || c.ig.length || c.mail.length || c.tel.length || c.wechat.length));

async function tavily(env, q, pais) {
  const r = await fetch("https://api.tavily.com/search", {
    method: "POST", headers: { Authorization: `Bearer ${env.TAVILY_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: q, search_depth: "basic", max_results: WEB.resultadosPorConsulta, include_raw_content: "markdown", topic: "general", ...(PAISES[pais]?.tavily ? { country: PAISES[pais].tavily } : {}) }),
  }).catch((e) => ({ ok: false, status: 0, json: async () => ({ detail: String(e) }) }));
  const j = await r.json().catch(() => ({}));
  return { ok: !!r.ok, status: r.status, resultados: j.results || [], error: r.ok ? "" : String(j.detail?.error || j.detail || j.error || r.status).slice(0, 160) };
}

// Hace hasta WEB.consultasPorVuelta búsquedas (en paralelo) y guarda los candidatos con sus contactos
export async function pasoWeb(env, web) {
  const tanda = web.pend.splice(0, WEB.consultasPorVuelta);
  const res = await Promise.all(tanda.map((x) => tavily(env, x.q, x.pais)));
  const clave = (u) => String(u).replace(/[?#].*$/, "").replace(/\/$/, "");
  const porClave = new Map(web.cands.map((c) => [clave(c.url), c]));
  let usados = 0;
  res.forEach((r, i) => {
    if (!r.ok) { web.errores.push(`${tanda[i].pais}: ${r.error}`); return; }
    usados++;
    for (const it of r.resultados) {
      const url = String(it.url || "");
      if (!url) continue;
      const texto = String(it.raw_content || "").slice(0, 40000);
      const precios = uniq([...`${it.content} ${texto}`.matchAll(/(?:US?\$|R\$|\$|USD|U\$S|Gs\.?|₲|¥|RMB)\s?\d[\d.,]{0,9}/g)].map((m) => m[0])).slice(0, 4);
      const nuevo = { pais: paisDeDominio(url) || tanda[i].pais, url: url.replace(/[?#].*$/, ""), titulo: String(it.title || "").slice(0, 160), resumen: String(it.content || "").slice(0, 350), contactos: sacarContactos(texto + " " + (it.content || ""), url), precios };
      const ya = porClave.get(clave(url));
      if (!ya) { porClave.set(clave(url), nuevo); web.cands.push(nuevo); continue; }
      // La misma página salió dos veces: se juntan los contactos y se queda el texto más completo
      for (const k of Object.keys(ya.contactos)) ya.contactos[k] = uniq([...ya.contactos[k], ...nuevo.contactos[k]]).slice(0, 3);
      ya.precios = uniq([...ya.precios, ...nuevo.precios]).slice(0, 4);
      if (nuevo.resumen.length > ya.resumen.length) { ya.resumen = nuevo.resumen; ya.titulo = nuevo.titulo; }
    }
  });
  web.creditos += usados;
  if (usados) await sumarTavily(env, usados);
  web.cands = web.cands.slice(0, 120);
  return web;
}

const PESO_TIPO = { "fábrica": 10, mayorista: 9, distribuidor: 9, importador: 8, comercio: 5, marketplace: 4 };
export async function clasificarWeb(env, b, cands) {
  if (!cands.length) return [];
  const lote = cands.filter((c) => !PROHIBIDO.test(c.titulo + " " + c.resumen)).slice(0, 60);
  const r = await iaJSON(env, `Pedido del cliente: "${b.producto}" ${qtxt(b)} · calidad buscada: ${CALIDAD_TXT[b.calidad] || CALIDAD_TXT.indistinto}.
Estas son páginas que salieron en Google. Para cada una decidí si es un PROVEEDOR que vende ese producto (o productos de ese rubro) y cómo es.
${lote.map((c, i) => `${i}. [${c.pais}] ${c.titulo} | ${c.url} | ${c.resumen.slice(0, 220).replace(/\s+/g, " ")}${c.precios.length ? " | precios: " + c.precios.join(", ") : ""}`).join("\n")}
Devolvé SOLO: {"p":[{"i":0,"tipo":"fábrica|mayorista|distribuidor|importador|comercio|marketplace|nada","calidad":"réplica|original|reacondicionado|genérico|no se sabe","parecido":0-10,"nombre":"nombre del negocio","minimo":número o null,"precio":"precio por unidad o por mayor si se ve, o vacío"}]}
"nada" = notas de prensa, blogs, foros, tutoriales, páginas que no venden. "parecido" = cuánto coincide con lo pedido (10 = vende exactamente eso).`);
  const m = new Map((r?.p || []).map((x) => [n(x.i, -1), x]));
  const out = [];
  lote.forEach((c, i) => {
    const x = m.get(i);
    if (r && (!x || x.tipo === "nada" || n(x.parecido) < 4)) return;
    if (!r && !hayContacto(c.contactos)) return;   // sin IA: solo los que tienen algún contacto
    const tipo = x?.tipo || "no se sabe", calidad = x?.calidad || "no se sabe", parecido = x ? Math.round(n(x.parecido, 6)) : null;
    const k = c.contactos;
    const contacto = k.wa.length ? 10 : k.ig.length || k.tel.length || k.wechat.length ? 7 : k.mail.length ? 5 : 2;
    const coincideCalidad = !b.calidad || b.calidad === "indistinto" || calidad.startsWith(b.calidad.slice(0, 5)) ? 10 : calidad === "no se sabe" ? 6 : 2;
    const puntaje = red(Math.max(1, Math.min(10, (parecido ?? 6) * 0.35 + (PESO_TIPO[tipo] ?? 5) * 0.25 + contacto * 0.25 + coincideCalidad * 0.1 + (x?.precio || c.precios.length ? 10 : 0) * 0.05)), 1);
    let host = ""; try { host = new URL(c.url).hostname.replace(/^www\./, ""); } catch {}
    out.push({
      fuente: "web", pais: c.pais, titulo: c.titulo, titulo_orig: c.titulo, link: c.url, foto: "", proveedor: String(x?.nombre || host).slice(0, 120), prov_link: "",
      ubicacion: PAISES[c.pais]?.nombre || c.pais, tipo, calidad, verificado: 0, anios: null, ventas: null, calif: null, minimo: n(x?.minimo) || null, tramos: [], moneda: "",
      precio_u: null, precio_usd: null, puesto_u: null, total: null, minimo_ok: !n(b.cantidad) || !n(x?.minimo) || n(x?.minimo) <= b.cantidad ? 1 : 0, parecido, puntaje,
      contacto: [k.wa.length ? "WhatsApp" : "", k.ig.length ? "Instagram" : "", k.mail.length ? "mail" : "", k.tel.length ? "teléfono" : "", k.wechat.length ? "WeChat" : ""].filter(Boolean).join(", "),
      contactos: k, resumen: [String(x?.precio || c.precios.join(" · ")).slice(0, 120), c.resumen.slice(0, 260)].filter(Boolean).join(" — "),
    });
  });
  // Los mejores por país
  const porPais = {};
  for (const p of out.sort((a, z) => z.puntaje - a.puntaje)) (porPais[p.pais] = porPais[p.pais] || []).push(p);
  return Object.values(porPais).flatMap((l) => l.slice(0, WEB.guardarPorPais));
}

export async function recogerResultados(env, log = []) {
  const activas = (await env.DB.prepare("SELECT * FROM busquedas WHERE estado='buscando' ORDER BY lanzada_ts LIMIT ?").bind(TOPES.porVuelta).all()).results || [];
  for (const b of activas) {
    const runs = JSON.parse(b.runs || "[]");
    for (const r of runs.filter((x) => x.id && !TERMINADO.has(x.estado))) {
      const s = await apify(env, `/actor-runs/${r.id}`);
      if (s.ok && s.j?.data) {
        r.estado = s.j.data.status; r.costo = n(s.j.data.usageTotalUsd);
        if (s.j.data.defaultDatasetId) r.ds = s.j.data.defaultDatasetId;
      }
      if (!TERMINADO.has(r.estado) && Date.now() - r.desde > TOPES.minutosMaxRun * 60e3) {
        await apify(env, `/actor-runs/${r.id}/abort`, { method: "POST" });
        r.estado = "VENCIDO";
      }
    }
    let web = b.web ? JSON.parse(b.web) : null;
    if (web?.pend.length) web = await pasoWeb(env, web);
    if (!runs.every((r) => TERMINADO.has(r.estado)) || web?.pend.length) {
      await env.DB.prepare("UPDATE busquedas SET runs=?, web=? WHERE id=?").bind(JSON.stringify(runs), web ? JSON.stringify(web) : null, b.id).run();
      log.push(`${b.id}: sigue buscando${web ? ` (web: faltan ${web.pend.length})` : ""}`); continue;
    }
    // Todos terminaron: traer lo que haya (también de los que se cortaron, Apify guarda lo parcial)
    const items = [];
    for (const r of runs.filter((x) => x.ds)) {
      const d = await apify(env, `/datasets/${r.ds}/items?clean=true&limit=60`);
      if (d.ok && Array.isArray(d.j)) { r.items = d.j.length; for (const it of d.j) items.push({ fuente: r.fuente, item: it }); }
    }
    const lista = items.length ? await procesarResultados(env, b, items) : [];
    const listaWeb = web ? await clasificarWeb(env, b, web.cands) : [];
    if (web) { web.cands = []; }   // no hace falta guardar los crudos
    const res = await guardar(env, b, lista, runs, listaWeb, web);
    log.push(`${b.id}: lista con ${res.n} proveedores (${lista.length} China con precio, ${listaWeb.length} web), costo USD ${res.costo}`);
  }
  return log;
}

export async function vuelta(env) {
  await prepararTablas(env);
  const log = [];
  await recogerResultados(env, log).catch((e) => log.push("Error recogiendo: " + (e?.stack || e)));
  await lanzarNuevas(env, log).catch((e) => log.push("Error lanzando: " + (e?.stack || e)));
  if (log.length) console.log(log.join("\n"));
  return log;
}

// ---------------------------------------------------------------------------
// Entradas del worker
// ---------------------------------------------------------------------------
export default {
  async scheduled(evento, env, ctx) {
    ctx.waitUntil(vuelta(env));
  },
  async fetch(req, env) {
    const url = new URL(req.url);
    const clave = url.searchParams.get("clave");
    if (url.pathname === "/") return new Response(`${VERSION} · funcionando. Las búsquedas se hacen desde el panel del cotizador (pestaña Búsquedas).`, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
    if (!env.VERIFY_TOKEN || clave !== env.VERIFY_TOKEN) return new Response("Falta ?clave=", { status: 401 });
    await prepararTablas(env);
    if (url.pathname === "/correr") return Response.json({ log: await vuelta(env) });
    if (url.pathname === "/estado") {
      const tp = topes(env);
      return Response.json({
        version: VERSION, hoy: await lanzadasHoy(env), gasto_mes_usd: red(await gastoMes(env), 3), topes: tp,
        claves: { apify: !!env.APIFY_TOKEN, tavily: !!env.TAVILY_KEY, gemini: !!env.GEMINI_KEY, telegram: !!env.TELEGRAM_TOKEN }, tavily_usadas_mes: await tavilyUsadosMes(env),
        cola: (await env.DB.prepare("SELECT estado, COUNT(*) n FROM busquedas GROUP BY estado").all()).results,
      });
    }
    if (url.pathname === "/probar-apify") {
      const r = await apify(env, "/users/me");
      return Response.json({ ok: r.ok, status: r.status, usuario: r.j?.data?.username || null, plan: r.j?.data?.plan?.id || null, error: r.err || null });
    }
    // Prueba de IA simple (sin búsqueda): ¿la clave de Gemini tiene cupo gratis?
    if (url.pathname === "/probar-ia") {
      const res = [];
      for (const m of await modelos(env)) {
        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, {
          method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_KEY },
          body: JSON.stringify({ contents: [{ parts: [{ text: "Traducí al chino: zapatillas de básquet" }] }] }),
        }).catch(() => null);
        const j = r ? await r.json().catch(() => ({})) : {};
        res.push({ modelo: m, ok: !!r?.ok, status: r?.status, respuesta: (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("").slice(0, 120), error: (j.error?.message || "").slice(0, 200) || null });
        if (r?.ok) break;
      }
      return Response.json(res);
    }
    // Prueba de búsqueda web con Tavily: ?q=texto&pais=py
    if (url.pathname === "/probar-web") {
      if (!env.TAVILY_KEY) return Response.json({ ok: false, error: "Falta TAVILY_KEY" });
      const pais = url.searchParams.get("pais") || "ar";
      const r = await tavily(env, url.searchParams.get("q") || "zapatillas por mayor mayorista whatsapp", pais);
      if (r.ok) await sumarTavily(env, 1);
      return Response.json({ ok: r.ok, error: r.error || null, usadas_este_mes: await tavilyUsadosMes(env),
        resultados: r.resultados.map((x) => ({ titulo: x.title, url: x.url, contactos: sacarContactos(`${x.raw_content || ""} ${x.content || ""}`, x.url) })) });
    }
    return new Response("No existe", { status: 404 });
  },
};
