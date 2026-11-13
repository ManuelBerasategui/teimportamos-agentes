// COTIZADOR AUTOMÁTICO: "esto puesto en Argentina te queda en tanto", sin armar PDF ni mandarle nada al cliente.
//  - La cuenta es la MISMA de la calculadora de la web (teimportamosarg.com/calculadora) y usa los valores que el dueño
//    carga en el admin de la web (tabla pública site_config): si cambia algo ahí, cambia acá solo.
//  - Los links de Alibaba que mandan los clientes se anotan solos en una cola (ali_cola) cuando entra el mensaje.
//  - Alibaba le pide el deslizador de verificación a cualquier navegador nuevo, y eso NO se esquiva. Los links los lee la PC
//    del dueño (sender/leer_alibaba.py) con un navegador donde él pasó la verificación una vez; el texto de la página llega
//    acá y la IA saca precio FOB por cantidad, peso y medidas.
//  - Con el link leído y la cantidad que dijo el cliente se calcula y queda en la pestaña Cotizar del panel.
//  - Si no se puede leer o falta un dato, queda a la vista qué falta y se completa a mano (FOB y peso): calcula al instante.
const WEB = "https://www.teimportamosarg.com", SUPABASE = "https://dybzgnmghisqapdzgknv.supabase.co";
const DIA = 86400e3, H = 3600e3;
const num = (v, def) => { const n = Number(String(v ?? "").replace(",", ".")); return v === undefined || v === null || String(v).trim() === "" || !Number.isFinite(n) || n < 0 ? def : n; };
const corto = (t, n = 200) => String(t || "").replace(/\s+/g, " ").trim().slice(0, n);
const r2 = (n) => Math.round(n * 100) / 100;
const kvGet = async (env, k) => { const r = await env.DB.prepare("SELECT v, exp FROM kv WHERE k=?").bind(k).first().catch(() => null); return r && (!r.exp || r.exp > Date.now()) ? r.v : null; };
const kvPut = (env, k, v, ttl) => env.DB.prepare("INSERT OR REPLACE INTO kv (k, v, exp) VALUES (?,?,?)").bind(k, String(v), ttl ? Date.now() + ttl : null).run().catch(() => {});
const todas = async (env, sql, ...b) => { try { return (await env.DB.prepare(sql).bind(...b).all()).results || []; } catch { return []; } };
export const RE_ALI = /https?:\/\/(?:[a-z0-9-]+\.)*alibaba\.com\/[^\s<>"']+/gi;
export const linksAlibaba = (t) => [...new Set((String(t || "").match(RE_ALI) || []).map((l) => l.replace(/[),.;]+$/, "")))];
// Mismo producto = mismo número de producto, venga del link largo, del corto o de otro idioma
export const claveLink = (l) => { const s = String(l || ""); const m = s.match(/(\d{9,})\.html/) || s.match(/\/x\/([A-Za-z0-9]+)/); return m ? m[1] : s.split("?")[0].slice(0, 200); };

export const ESQUEMA_AUTOCOT = [
  "CREATE TABLE IF NOT EXISTS ali_cola (clave TEXT PRIMARY KEY, link TEXT, conv TEXT, ts INTEGER, estado TEXT DEFAULT 'pendiente', intentos INTEGER DEFAULT 0, intento_ts INTEGER, datos TEXT, origen TEXT, cantidad INTEGER, error TEXT)",
  "CREATE INDEX IF NOT EXISTS ali_cola_estado ON ali_cola(estado, ts)",
  "CREATE TABLE IF NOT EXISTS autocot (id TEXT PRIMARY KEY, ts INTEGER, conv TEXT, nombre TEXT, items TEXT, via TEXT, total REAL, detalle TEXT, estado TEXT, falta TEXT)",
  "CREATE INDEX IF NOT EXISTS autocot_ts ON autocot(ts)",
];
let listo = false;
export async function prepararAutocot(env) {
  if (listo) return;
  await env.DB.batch(["CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT, exp INTEGER)", ...ESQUEMA_AUTOCOT].map((s) => env.DB.prepare(s)));
  listo = true;
}

// ---------------------------------------------------------------------------
// 1) CONFIGURACIÓN: la de la calculadora de la web. Valores por defecto = los del código de la web.
export const CFG_DEF = { fleteKg: 22, handling: 30, honorariosPct: 10, honorariosTope: 250, honorariosMin: 30, despachanteTramos: "0:100, 1000:150, 2000:200", impuestosPct: 70,
  aereoFijo: 950, aereoDesde: 50, aereoHasta: 250, barcoM3: 151.52, impuestosBarcoPct: 75, barcoGastosFijos: 1700, barcoDesde: 250, dolar: 0, plazoAereo: "25 a 40 días", plazoMaritimo: "60 a 90 días", senaPct: 50 };
export function cfgDesdeWeb(filas) {
  const t = Object.fromEntries((filas || []).map((f) => [f.clave, f.valor]));
  const pos = (v, d) => { const n = num(v, 0); return n > 0 ? n : d; };   // igual que la web: Number(x) || defecto
  return { fleteKg: pos(t.calc_flete_kg, CFG_DEF.fleteKg), handling: pos(t.calc_handling, CFG_DEF.handling), honorariosPct: pos(t.calc_honorarios_pct, CFG_DEF.honorariosPct), honorariosTope: pos(t.calc_honorarios_tope, CFG_DEF.honorariosTope),
    honorariosMin: num(t.calc_honorarios_min, CFG_DEF.honorariosMin), despachanteTramos: String(t.calc_despachante_tramos || CFG_DEF.despachanteTramos), impuestosPct: pos(t.calc_impuestos_pct, CFG_DEF.impuestosPct),
    aereoFijo: pos(t.calc_aereo_fijo, CFG_DEF.aereoFijo), aereoDesde: pos(t.calc_aereo_desde, CFG_DEF.aereoDesde), aereoHasta: pos(t.calc_aereo_hasta, CFG_DEF.aereoHasta), barcoM3: pos(t.calc_barco_m3, CFG_DEF.barcoM3),
    impuestosBarcoPct: pos(t.calc_impuestos_barco_pct, CFG_DEF.impuestosBarcoPct), barcoGastosFijos: num(t.calc_barco_gastos_fijos, CFG_DEF.barcoGastosFijos), barcoDesde: pos(t.calc_barco_desde, CFG_DEF.barcoDesde),
    dolar: num(t.dolar_cotizacion, 0), plazoAereo: t.calc_cond_plazo_aereo || CFG_DEF.plazoAereo, plazoMaritimo: t.calc_cond_plazo_maritimo || CFG_DEF.plazoMaritimo, senaPct: pos(t.calc_cond_sena_pct, CFG_DEF.senaPct) };
}
async function claveWeb(env) {
  if (env.SUPABASE_KEY) return env.SUPABASE_KEY;
  const g = await kvGet(env, "sbkey"); if (g) return g;
  const RE = /sb_publishable_[\w-]+|eyJ[\w-]{20,}\.[\w-]{20,}\.[\w-]{20,}/;
  const html = await (await fetch(WEB + "/calculadora")).text();
  const vistos = new Set(), cola = [...html.matchAll(/(?:src|href)="([^"]+\.js)"/g)].map((m) => new URL(m[1], WEB).href);
  for (let i = 0; i < cola.length && i < 12; i++) {
    if (vistos.has(cola[i])) continue; vistos.add(cola[i]);
    const js = await (await fetch(cola[i])).text().catch(() => "");
    const m = js.match(RE); if (m) { await kvPut(env, "sbkey", m[0], 7 * DIA); return m[0]; }
    for (const c of js.matchAll(/assets\/(?:constants|index|env)[\w.-]*\.js/g)) cola.push(WEB + "/" + c[0]);   // la clave pública suele estar en un archivo aparte
  }
  return null;
}
export async function configCalc(env, { forzar = false } = {}) {
  await prepararAutocot(env);
  if (!forzar) { try { const g = JSON.parse((await kvGet(env, "calc_cfg")) || "null"); if (g) return g; } catch {} }
  let cfg = null, origen = "defecto";
  try {
    const k = await claveWeb(env);
    if (k) { const r = await fetch(`${SUPABASE}/rest/v1/site_config?select=clave,valor`, { headers: { apikey: k, Authorization: `Bearer ${k}` }, signal: AbortSignal.timeout(8000) }); if (r.ok) { cfg = cfgDesdeWeb(await r.json()); origen = "web"; } }
  } catch {}
  if (!cfg) { try { cfg = JSON.parse((await kvGet(env, "calc_cfg_ult")) || "null"); origen = "última leída"; } catch {} }
  cfg = { ...(cfg || CFG_DEF), origen, leido: Date.now() };
  await kvPut(env, "calc_cfg", JSON.stringify(cfg), origen === "web" ? 3 * H : 10 * 60e3);
  if (origen === "web") await kvPut(env, "calc_cfg_ult", JSON.stringify(cfg));
  return cfg;
}

// ---------------------------------------------------------------------------
// 2) LA CUENTA (copia de la calculadora de la web):
//    base = FOB + flete + handling · impuestos = % de la base · honorarios = % del FOB con mínimo y tope ·
//    despachante = monto fijo según el FOB · por barco se suman los gastos fijos + 21% de IVA.
//    Aéreo: entre aereoDesde y aereoHasta kg es un fijo; si no, kg × tarifa. Más de barcoDesde kg va por barco (flete por m³).
const tramosDesp = (s) => String(s || "").slice(0, 400).split(",").map((x) => x.split(":")).filter((x) => x.length === 2).map(([a, b]) => ({ desde: Number(a.trim()), monto: Number(b.trim()) })).filter((x) => Number.isFinite(x.desde) && x.desde >= 0 && Number.isFinite(x.monto) && x.monto >= 0).sort((a, b) => a.desde - b.desde);
export function calcularWeb(itemsIn, cfg, opc = {}) {
  const items = (itemsIn || []).map((i) => ({ nombre: corto(i.nombre, 90), link: i.link || "", cantidad: Math.max(0, Math.round(num(i.cantidad, 0))), fob: num(i.fob ?? i.precio, 0), peso: num(i.peso, 0), volumen: num(i.volumen, 0) })).filter((i) => i.cantidad > 0);
  const falta = [];
  if (!items.length) return { ok: false, falta: ["la cantidad"], items: [] };
  for (const i of items) { if (!(i.fob > 0)) falta.push(`precio FOB de ${i.nombre || "el producto"}`); if (!(i.peso > 0)) falta.push(`peso por unidad de ${i.nombre || "el producto"}`); }
  const kg = items.reduce((s, i) => s + i.cantidad * i.peso, 0), fob = items.reduce((s, i) => s + i.cantidad * i.fob, 0), m3 = items.reduce((s, i) => s + i.volumen, 0);
  const barco = opc.via === "maritimo" || (opc.via !== "aereo" && kg > cfg.barcoDesde);
  if (barco && items.some((i) => !(i.volumen > 0))) falta.push(`volumen total en m³ (CBM) de la carga: ${kg > cfg.barcoDesde ? `pesa ${Math.round(kg)} kg, más de ${cfg.barcoDesde} kg va por barco y el flete se cobra por volumen` : "por barco el flete se cobra por volumen"}`);
  if (falta.length) return { ok: false, falta, items, kg: r2(kg), fob: r2(fob), via: barco ? "maritimo" : "aereo" };
  const flete = barco ? r2(m3 * cfg.barcoM3) : cfg.aereoHasta > 0 && kg >= cfg.aereoDesde && kg <= cfg.aereoHasta ? cfg.aereoFijo : cfg.fleteKg * kg;
  const impPct = barco ? cfg.impuestosBarcoPct : cfg.impuestosPct, fijos = barco ? Math.round(cfg.barcoGastosFijos * 121) / 100 : 0;
  const base = fob + flete + cfg.handling, imp = (impPct / 100) * base;
  const honBruto = Math.round(fob * cfg.honorariosPct) / 100, hon = fob > 0 ? Math.max(cfg.honorariosTope > 0 ? Math.min(honBruto, cfg.honorariosTope) : honBruto, cfg.honorariosMin || 0) : 0;
  let desp = 0; for (const t of (tramosDesp(cfg.despachanteTramos).length ? tramosDesp(cfg.despachanteTramos) : tramosDesp(CFG_DEF.despachanteTramos))) if (fob >= t.desde) desp = t.monto;
  const total = base + imp + hon + desp + fijos;
  // Unitario puesto: el flete se reparte por peso (o por volumen en barco) y todo lo demás por valor
  const filas = items.map((i) => {
    const pv = fob ? (i.cantidad * i.fob) / fob : 1 / items.length, pf = barco ? (m3 ? i.volumen / m3 : pv) : kg ? (i.cantidad * i.peso) / kg : pv;
    const sub = (i.cantidad * i.fob + flete * pf + cfg.handling * pv) * (1 + impPct / 100) + (hon + desp + fijos) * pv;
    return { ...i, subtotal: r2(sub), unitario: r2(sub / i.cantidad), veces: i.fob ? r2(sub / i.cantidad / i.fob) : null };
  });
  return { ok: true, via: barco ? "maritimo" : "aereo", plazo: barco ? cfg.plazoMaritimo : cfg.plazoAereo, items: filas, kg: r2(kg), m3: r2(m3), fob: r2(fob), flete: r2(flete), handling: cfg.handling, impuestosPct: impPct, impuestos: r2(imp), honorarios: r2(hon), despachante: desp, gastosFijos: fijos,
    total: r2(total), totalArs: cfg.dolar > 0 ? Math.round(total * cfg.dolar) : null, sena: r2(total * (cfg.senaPct / 100)), dolar: cfg.dolar || null,
    aviso: !barco && kg > cfg.barcoDesde ? `Pesa ${Math.round(kg)} kg: por regla va por barco.` : "" };
}
// El resultado en una línea, como lo diría el dueño
export function textoResultado(c) {
  if (!c?.ok) return `Falta: ${(c?.falta || ["datos"]).join("; ")}.`;
  const u = (n) => "USD " + Number(n).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${c.items.map((i) => `${i.cantidad} x ${i.nombre || "producto"}: ${u(i.unitario)} c/u puesto (FOB ${u(i.fob)})`).join(" · ")} · TOTAL ${u(c.total)}${c.totalArs ? ` (~$${c.totalArs.toLocaleString("es-AR")})` : ""} por ${c.via === "maritimo" ? "barco" : "avión"}, ${c.plazo}. Mercadería ${u(c.fob)} + flete ${u(c.flete)} + manejo ${u(c.handling)} + impuestos ${c.impuestosPct}% ${u(c.impuestos)} + honorarios ${u(c.honorarios)} + despachante ${u(c.despachante)}${c.gastosFijos ? ` + gastos fijos de barco ${u(c.gastosFijos)}` : ""}.`;
}

// ---------------------------------------------------------------------------
// 3) COLA DE LINKS: se anota cada link de Alibaba que manda un cliente (lo llama el lector al guardar el mensaje)
export function opsLinks(env, conv, texto, ts) {
  if (!/alibaba\.com/i.test(texto || "")) return [];
  return linksAlibaba(texto).slice(0, 6).map((l) => env.DB.prepare("INSERT INTO ali_cola (clave, link, conv, ts, estado, intentos, origen) VALUES (?,?,?,?,'pendiente',0,'chat') ON CONFLICT(clave) DO UPDATE SET conv=excluded.conv, ts=excluded.ts WHERE ali_cola.estado NOT IN ('leido') OR ali_cola.conv<>excluded.conv")
    .bind(claveLink(l), l.slice(0, 600), String(conv), ts));
}
// Lo que la PC tiene que leer ahora (los más nuevos primero; cada link se intenta hasta 4 veces)
export async function pendientesPC(env, limite = 8) {
  await prepararAutocot(env);
  const l = await todas(env, "SELECT clave, link FROM ali_cola WHERE estado='pendiente' AND ts>=? AND intentos<4 AND COALESCE(intento_ts,0)<? ORDER BY ts DESC LIMIT ?", Date.now() - 6 * DIA, Date.now() - 10 * 60e3, Math.min(20, limite));
  return { links: l };
}

// La IA lee el texto visible de la página y devuelve solo lo que está escrito
async function leerTextoAlibaba(env, iaJSON, titulo, texto) {
  const r = await iaJSON(env, `Abajo está el texto visible de una página de producto de Alibaba. Sacá los datos para cotizar una importación. NO inventes nada: si un dato no está escrito, poné null.
- nombre: qué producto es, corto y claro en español (3 a 7 palabras).
- tramos: los precios por cantidad tal como figuran (ej. "100 - 499 unidades US$1,20" → {"desde":100,"precio":1.2}). Si hay un solo precio, un solo tramo con "desde" = pedido mínimo. Si hay un rango sin cantidades ("US$1-3"), poné los dos extremos en "rango" y dejá tramos [].
- moneda: la moneda de esos precios ("USD", "ARS", "EUR"...).
- moq: pedido mínimo (número) y unidad de venta (unidad, par, set, caja).
- peso_kg: peso bruto de UNA unidad de venta en kilos (buscá "peso bruto individual", "single gross weight", "peso del paquete"). Si está en gramos, pasalo a kg.
- paquete_cm: medidas del paquete individual [largo, ancho, alto] en centímetros ("single package size", "tamaño del paquete individual").
- unidades_por_paquete: cuántas unidades trae ese paquete (1 si no dice).
Respondé SOLO JSON: {"nombre":"","tramos":[{"desde":1,"precio":0}],"rango":[null,null],"moneda":"USD","moq":1,"unidad":"unidad","peso_kg":null,"paquete_cm":[null,null,null],"unidades_por_paquete":1}

TÍTULO: ${corto(titulo, 200)}
TEXTO DE LA PÁGINA:
${String(texto || "").slice(0, 14000)}`, { prioridad: true }).catch(() => null);
  if (!r || typeof r !== "object") return null;
  const tramos = (Array.isArray(r.tramos) ? r.tramos : []).map((t) => ({ desde: Math.max(1, Math.round(num(t.desde, 1))), precio: num(t.precio ?? t.precio_usd, 0) })).filter((t) => t.precio > 0 && t.precio < 100000).sort((a, b) => a.desde - b.desde).slice(0, 8);
  const pq = (Array.isArray(r.paquete_cm) ? r.paquete_cm : []).map((x) => num(x, 0)), up = Math.max(1, num(r.unidades_por_paquete, 1));
  const peso = num(r.peso_kg, 0);
  return { nombre: corto(r.nombre || titulo, 90), tramos, rango: (Array.isArray(r.rango) ? r.rango : []).map((x) => num(x, 0)).filter((x) => x > 0).slice(0, 2), moneda: String(r.moneda || "USD").toUpperCase().slice(0, 4), moq: Math.max(1, Math.round(num(r.moq, tramos[0]?.desde || 1))), unidad: corto(r.unidad, 20),
    peso: peso > 0 && peso < 2000 ? r2(peso / up * 1000) / 1000 : 0, m3: pq.length === 3 && pq.every((x) => x > 0 && x < 500) ? Math.round((pq[0] * pq[1] * pq[2]) / up) / 1e6 : 0 };
}
const precioPara = (tramos, cant) => { let p = tramos[0]?.precio || 0; for (const t of tramos) if (cant >= t.desde) p = t.precio; return p; };

// La PC manda lo que leyó de un link. Si Alibaba pidió verificación, se anota el intento y nada más.
export async function linkLeido(env, iaJSON, b) {
  await prepararAutocot(env);
  const clave = claveLink(b.link), fila = await env.DB.prepare("SELECT * FROM ali_cola WHERE clave=?").bind(clave).first().catch(() => null);
  if (!fila) return { ok: false, error: "ese link no estaba en la cola" };
  if (b.bloqueado || !String(b.texto || "").trim()) {
    await env.DB.prepare("UPDATE ali_cola SET intentos=intentos+1, intento_ts=?, error=?, estado=CASE WHEN intentos>=3 THEN 'fallo' ELSE estado END WHERE clave=?").bind(Date.now(), corto(b.error || "Alibaba pidió verificación", 120), clave).run();
    return { ok: true, estado: "bloqueado" };
  }
  const d = await leerTextoAlibaba(env, iaJSON, b.titulo, b.texto);
  if (!d) { await env.DB.prepare("UPDATE ali_cola SET intentos=intentos+1, intento_ts=?, error='la IA no respondió' WHERE clave=?").bind(Date.now(), clave).run(); return { ok: true, estado: "sin IA" }; }
  await env.DB.prepare("UPDATE ali_cola SET estado='leido', intento_ts=?, datos=?, error=NULL WHERE clave=?").bind(Date.now(), JSON.stringify(d), clave).run();
  const cot = await cotizarLinks(env, iaJSON, fila.conv || "", { soloClave: fila.conv ? null : clave }).catch((e) => ({ error: String(e?.message || e) }));
  return { ok: true, estado: "leido", datos: d, cotizacion: cot };
}

// Arma la cotización de un chat con sus links ya leídos y la cantidad que pidió el cliente
export async function cotizarLinks(env, iaJSON, conv, { soloClave = null } = {}) {
  const cfg = await configCalc(env);
  const filas = soloClave ? await todas(env, "SELECT * FROM ali_cola WHERE clave=?", soloClave) : await todas(env, "SELECT * FROM ali_cola WHERE conv=? AND estado='leido' AND ts>=? ORDER BY ts", conv, Date.now() - 6 * DIA);
  if (!filas.length) return null;
  let nombre = "", cant = {};
  for (const f of filas) if (f.cantidad > 0) cant[f.clave] = f.cantidad;
  if (conv) {
    const c = await env.DB.prepare("SELECT nombre FROM w_conv WHERE conv=?").bind(conv).first().catch(() => null); nombre = c?.nombre || "";
    const desde = Math.min(...filas.map((f) => f.ts)) - 60e3;
    const ms = await todas(env, "SELECT yo, texto, ts FROM w_msg INDEXED BY w_msg_conv WHERE conv=? AND ts>=? AND COALESCE(texto,'')<>'' ORDER BY ts LIMIT 40", conv, desde);
    const prods = filas.map((f, i) => { let d = {}; try { d = JSON.parse(f.datos || "{}"); } catch {} return `${i + 1}. ${d.nombre || "producto"} · link ${f.link.slice(0, 120)}`; }).join("\n");
    const r = await iaJSON(env, `Un cliente de una importadora mandó links de productos de Alibaba por WhatsApp. Decime QUÉ CANTIDAD pidió de cada producto. Solo lo que el cliente escribió: si no dijo cantidad para un producto, poné 0 (no uses el mínimo del proveedor ni adivines). Si dio una sola cantidad y hay un solo producto, es para ese. Si dijo "docena" son 12, "un par de cientos" no es un número: 0.
PRODUCTOS:
${prods}
CHARLA (CLIENTE = el cliente, NOSOTROS = la importadora):
${ms.map((m) => `${m.yo ? "NOSOTROS" : "CLIENTE"}: ${corto(m.texto, 300)}`).join("\n")}
Respondé SOLO JSON: {"cantidades":[número por producto, en el mismo orden]}`, { prioridad: true }).catch(() => null);
    (Array.isArray(r?.cantidades) ? r.cantidades : []).forEach((q, i) => { const n = Math.round(num(q, 0)); if (filas[i] && n > 0 && n < 1e7) cant[filas[i].clave] = n; });
  }
  const items = [], falta = [];
  for (const f of filas) {
    let d = {}; try { d = JSON.parse(f.datos || "{}"); } catch {}
    const q = cant[f.clave] || 0;
    if (!q) falta.push(`la cantidad de ${d.nombre || "un producto"} (el proveedor pide mínimo ${d.moq || 1})`);
    if (d.moneda && d.moneda !== "USD") falta.push(`el precio de ${d.nombre || "un producto"} salió en ${d.moneda}, hace falta en dólares`);
    else if (!(d.tramos || []).length) falta.push(`el precio FOB de ${d.nombre || "un producto"}${d.rango?.length ? ` (la página solo muestra un rango de USD ${d.rango.join(" a ")})` : ""}`);
    items.push({ clave: f.clave, link: f.link, nombre: d.nombre || "", cantidad: q, fob: d.moneda && d.moneda !== "USD" ? 0 : precioPara(d.tramos || [], q || d.moq || 1), peso: d.peso || 0, volumen: d.m3 && q ? r2(d.m3 * q * 10000) / 10000 : 0, moq: d.moq || 1, tramos: d.tramos || [] });
    if (q && d.moq && q < d.moq) falta.push(`${d.nombre || "un producto"}: pidió ${q} y el proveedor vende desde ${d.moq}`);
  }
  const calc = calcularWeb(items.filter((i) => i.cantidad > 0), cfg);
  const todo = [...falta.filter((x) => !/vende desde/.test(x)), ...(calc.ok ? [] : calc.falta || [])];
  const avisos = falta.filter((x) => /vende desde/.test(x));
  const id = "ac:" + (conv || soloClave) + ":" + filas.map((f) => f.clave).sort().join("|").slice(0, 120);
  await env.DB.prepare("INSERT OR REPLACE INTO autocot (id, ts, conv, nombre, items, via, total, detalle, estado, falta) VALUES (?,?,?,?,?,?,?,?,?,?)")
    .bind(id, Date.now(), conv || "", nombre, JSON.stringify(items), calc.via || "", calc.ok ? calc.total : null, JSON.stringify(calc.ok ? { ...calc, avisos } : { avisos }), calc.ok && !todo.length ? "lista" : "falta", [...new Set(todo)].join("; ").slice(0, 600)).run();
  return { id, estado: calc.ok && !todo.length ? "lista" : "falta", total: calc.ok ? calc.total : null, falta: todo };
}

// ---------------------------------------------------------------------------
// 4) PANEL (pestaña Cotizar)
export async function apiAutocot(env, req, url, iaJSON, body = {}) {
  await prepararAutocot(env);
  const json = (d) => Response.json(d, { headers: { "Cache-Control": "no-store" } });
  if (req.method !== "POST") {
    const cfg = await configCalc(env, { forzar: url.searchParams.get("refrescar") === "1" });
    const lista = (await todas(env, "SELECT * FROM autocot ORDER BY ts DESC LIMIT 40")).map((f) => { let items = [], det = {}; try { items = JSON.parse(f.items || "[]"); det = JSON.parse(f.detalle || "{}"); } catch {} return { id: f.id, ts: f.ts, conv: f.conv, nombre: f.nombre, estado: f.estado, falta: f.falta, total: f.total, via: f.via, items, detalle: det, texto: det.ok ? textoResultado(det) : "" }; });
    const cola = await todas(env, "SELECT clave, link, conv, ts, estado, intentos, error FROM ali_cola WHERE estado IN ('pendiente','fallo') AND ts>=? ORDER BY ts DESC LIMIT 40", Date.now() - 6 * DIA);
    let pc = null; try { pc = JSON.parse((await kvGet(env, "ali_pc")) || "null"); } catch {}
    return json({ cfg, lista, cola, pc });
  }
  const b = body || {};
  if (b.accion === "calcular") { const cfg = await configCalc(env); const c = calcularWeb(b.items, cfg, { via: b.via }); return json({ ...c, texto: textoResultado(c) }); }
  if (b.accion === "links") {   // pegar links a mano: entran a la cola para que los lea la PC
    const ls = linksAlibaba(b.texto); if (!ls.length) return json({ error: "No encontré links de Alibaba en lo que pegaste" });
    const q = Math.round(num(b.cantidad, 0));
    await env.DB.batch(ls.slice(0, 15).map((l) => env.DB.prepare("INSERT INTO ali_cola (clave, link, conv, ts, estado, intentos, origen, cantidad) VALUES (?,?,'',?,'pendiente',0,'panel',?) ON CONFLICT(clave) DO UPDATE SET ts=excluded.ts, cantidad=excluded.cantidad, estado=CASE WHEN ali_cola.estado='fallo' THEN 'pendiente' ELSE ali_cola.estado END, intentos=0").bind(claveLink(l), l.slice(0, 600), Date.now(), q || null)));
    for (const l of ls.slice(0, 15)) { const f = await env.DB.prepare("SELECT estado FROM ali_cola WHERE clave=?").bind(claveLink(l)).first(); if (f?.estado === "leido") await cotizarLinks(env, iaJSON, "", { soloClave: claveLink(l) }).catch(() => {}); }
    return json({ ok: true, anotados: ls.length });
  }
  if (b.accion === "completar" && b.id) {   // el dueño completa lo que faltaba (cantidad, FOB, peso, volumen) y se recalcula
    const f = await env.DB.prepare("SELECT * FROM autocot WHERE id=?").bind(String(b.id)).first(); if (!f) return json({ error: "no existe" });
    const cfg = await configCalc(env); let items = []; try { items = JSON.parse(f.items || "[]"); } catch {}
    items = items.map((i, n) => ({ ...i, ...(b.items?.[n] ? { cantidad: Math.round(num(b.items[n].cantidad, i.cantidad)), fob: num(b.items[n].fob, i.fob), peso: num(b.items[n].peso, i.peso), volumen: num(b.items[n].volumen, i.volumen), nombre: corto(b.items[n].nombre || i.nombre, 90) } : {}) }));
    const c = calcularWeb(items, cfg, { via: b.via });
    await env.DB.prepare("UPDATE autocot SET items=?, via=?, total=?, detalle=?, estado=?, falta=?, ts=? WHERE id=?").bind(JSON.stringify(items), c.via || "", c.ok ? c.total : null, JSON.stringify(c.ok ? c : {}), c.ok ? "lista" : "falta", c.ok ? "" : (c.falta || []).join("; ").slice(0, 600), Date.now(), f.id).run();
    return json({ ...c, texto: textoResultado(c) });
  }
  if (b.accion === "borrar" && b.id) { await env.DB.prepare("DELETE FROM autocot WHERE id=?").bind(String(b.id)).run(); return json({ ok: true }); }
  if (b.accion === "quitar_link" && b.clave) { await env.DB.prepare("DELETE FROM ali_cola WHERE clave=?").bind(String(b.clave)).run(); return json({ ok: true }); }
  if (b.accion === "reintentar" && b.clave) { await env.DB.prepare("UPDATE ali_cola SET estado='pendiente', intentos=0, intento_ts=0, error=NULL WHERE clave=?").bind(String(b.clave)).run(); return json({ ok: true }); }
  return json({ error: "acción desconocida" });
}
// La PC avisa cómo le fue (para que el panel diga si está leyendo o trabada en la verificación)
export async function latidoPC(env, b) { await prepararAutocot(env); await kvPut(env, "ali_pc", JSON.stringify({ ts: Date.now(), estado: corto(b?.estado, 40), detalle: corto(b?.detalle, 160) }), 2 * DIA); return { ok: true }; }
