// TENDENCIAS PARA PUBLICAR (día, semana y mes)
// Cruza tres fuentes gratis que lee la PC (sender/tendencias_ml.py) y arma, sin que nadie lo pida, el ranking de productos
// que de verdad están subiendo, con el texto listo para los grupos de WhatsApp y para Instagram:
//   1. Google Trends Argentina, "búsquedas en aumento" de semillas con intención de reventa ("por mayor", "mayorista",
//      "comprar", "precio"...): aparecen productos ANTES de llegar arriba en Mercado Libre.
//   2. Google Trends, curva diaria de 90 días de cada candidato: crecimiento del día, de la semana y del mes.
//   3. Mercado Libre: tendencias de búsqueda, "Más vendidos" por categoría y el listado (vendidos, competencia).
// Regla: solo números medidos. Si algo no se midió, no se escribe.
import { competencia, vendidosNum, claveML, NO_PRODUCTO, semanaDe } from "./candidatos.js";

const AR = 3 * 3600e3, DIA = 86400e3, H = 3600e3;
const corto = (t, n = 200) => String(t || "").replace(/\s+/g, " ").trim().slice(0, n);
const todas = async (env, sql, ...b) => { try { return (await env.DB.prepare(sql).bind(...b).all()).results || []; } catch { return []; } };
const kvGet = async (env, k) => (await env.DB.prepare("SELECT v FROM kv WHERE k=?").bind(k).first().catch(() => null))?.v ?? null;
const kvPut = (env, k, v) => env.DB.prepare("INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)").bind(k, String(v)).run();
const diaAR = (ts) => new Date(ts - AR).toISOString().slice(0, 10);
const prom = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const r2 = (x) => Math.round(x * 100) / 100;
export const PERIODOS = {
  dia: { nombre: "del día", ventana: 2 * DIA, reciente: 3, base: 14, comparacion: "últimos 3 días vs las 2 semanas anteriores" },
  semana: { nombre: "de la semana", ventana: 7 * DIA, reciente: 7, base: 28, comparacion: "últimos 7 días vs las 4 semanas anteriores" },
  mes: { nombre: "del mes", ventana: 30 * DIA, reciente: 30, base: 60, comparacion: "últimos 30 días vs los 2 meses anteriores" },
};
// Qué tiempo de Google corresponde a cada período para las "búsquedas en aumento"
const TIEMPOS = { dia: ["now 7-d"], semana: ["now 7-d"], mes: ["today 1-m"] };   // lo que pide la PC (más consultas → Google corta)

let listo = false;
export async function prepararTendencias(env) {
  if (listo) return;
  await env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS gt_desc (id TEXT PRIMARY KEY, ts INTEGER, dia TEXT, clave TEXT, palabra TEXT, semilla TEXT, tiempo TEXT, valor TEXT, crec INTEGER)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS gt_desc_ts ON gt_desc(ts)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS gt_serie (clave TEXT PRIMARY KEY, palabra TEXT, ts INTEGER, fin TEXT, valores TEXT)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT, exp INTEGER)"),
  ]);
  listo = true;
}

// "+3,500%" → 3500 · "Aumento" (Google dice "Breakout": más de 5000%) → 5000
export const crecDe = (v) => (/aumento|breakout|exponencial/i.test(String(v)) ? 5000 : Math.round(+String(v || "").replace(/[^\d]/g, "") || 0));

// Lo que manda la PC
export async function guardarGoogle(env, b = {}) {
  await prepararTendencias(env);
  const ahora = Date.now(), dia = diaAR(ahora);
  const desc = (Array.isArray(b.descubiertas) ? b.descubiertas : []).slice(0, 400), series = (Array.isArray(b.series) ? b.series : []).slice(0, 120);
  const st = [];
  for (const d of desc) {
    const palabra = corto(d.palabra, 60), clave = claveML(palabra); if (!clave) continue;
    st.push(env.DB.prepare("INSERT OR REPLACE INTO gt_desc (id, ts, dia, clave, palabra, semilla, tiempo, valor, crec) VALUES (?,?,?,?,?,?,?,?,?)").bind(`${dia}|${clave}|${corto(d.semilla, 30)}|${corto(d.tiempo, 12)}`, ahora, dia, clave, palabra, corto(d.semilla, 30), corto(d.tiempo, 12), corto(d.valor, 20), crecDe(d.valor)));
  }
  for (const s of series) {
    const palabra = corto(s.palabra, 60), clave = claveML(palabra), v = (Array.isArray(s.valores) ? s.valores : []).map((x) => Math.max(0, Math.min(100, Math.round(+x || 0))));
    if (!clave || v.length < 30 || !/^\d{4}-\d{2}-\d{2}$/.test(String(s.fin || ""))) continue;
    st.push(env.DB.prepare("INSERT OR REPLACE INTO gt_serie (clave, palabra, ts, fin, valores) VALUES (?,?,?,?,?)").bind(clave, palabra, ahora, s.fin, JSON.stringify(v.slice(-120))));
  }
  for (let i = 0; i < st.length; i += 50) await env.DB.batch(st.slice(i, i + 50));
  await kvPut(env, "gt_ultima", JSON.stringify({ ts: ahora, descubiertas: desc.length, series: series.length, aviso: corto(b.aviso, 200) }));
  // Con la API de Mercado Libre conectada, el worker busca en ML lo que Google descubrió (competencia, precios)
  let aML = 0;
  if (await kvGet(env, "mlapi_token")) {
    let cola = []; try { cola = JSON.parse((await kvGet(env, "mlapi_cola")) || "[]"); } catch {}
    const vistos = new Set(cola.filter((q) => q.t === "search").map((q) => claveML(q.fila.palabra)));
    const orden = [...desc].sort((a, b) => crecDe(b.valor) - crecDe(a.valor));
    for (const d of orden) {
      const palabra = corto(d.palabra, 60), clave = claveML(palabra);
      if (!clave || vistos.has(clave) || NO_PRODUCTO.test(palabra) || aML >= 15) continue;
      vistos.add(clave); aML++;
      cola.push({ t: "search", fila: { palabra, tipo: "google", puesto: null, categoria: "google: " + corto(d.semilla, 30) } });
    }
    if (aML) await kvPut(env, "mlapi_cola", JSON.stringify(cola));
  }
  return { ok: true, guardadas: st.length, a_mercado_libre: aML };
}

// Crecimiento de una curva diaria de Google (0-100). Función pura.
export function curva(valores, p) {
  const v = (valores || []).map(Number);
  if (v.length < p.reciente + p.base) return null;
  const rec = v.slice(-p.reciente), base = v.slice(-(p.reciente + p.base), -p.reciente);
  const ult30 = v.slice(-30);
  const b = prom(base), r = prom(rec);
  return { ratio: b > 0 ? r2(r / b) : r > 0 ? 9.99 : 0, reciente: r2(r), base: r2(b), volumen: r2(prom(ult30)), ceros: r2(ult30.filter((x) => x === 0).length / ult30.length) };
}

// Ranking de un período. Función pura: recibe filas ya leídas.
export function ranking({ desc = [], series = [], ml = [], feedback = [] }, periodo = "semana", ahora = Date.now(), n = 10) {
  const P = PERIODOS[periodo]; if (!P) return [];
  const desde = ahora - P.ventana - 6 * H, tiempos = TIEMPOS[periodo];
  const fuera = new Set(feedback.filter((f) => f.estado === "descartada" && f.ts > ahora - 30 * DIA).map((f) => f.clave));
  const g = new Map(), item = (clave, palabra) => { if (!g.has(clave)) g.set(clave, { clave, palabra, fuentes: new Set(), rising: [], ml: { tendencia: null, mas_vendido: null, top: null, top_ts: 0 }, serie: null }); return g.get(clave); };
  for (const d of desc) if (d.ts >= desde && tiempos.includes(d.tiempo)) { const x = item(d.clave, d.palabra); x.fuentes.add("google_aumento"); x.rising.push({ semilla: d.semilla, valor: d.valor, crec: d.crec }); }
  for (const r of ml) {
    if (r.ts < desde) continue;
    const x = item(r.clave, r.palabra);
    if (r.tipo === "más vendido") { x.fuentes.add("ml_mas_vendido"); x.ml.mas_vendido = Math.min(x.ml.mas_vendido || 99, r.puesto || 99); }
    else if (r.tipo && r.tipo !== "google") { x.fuentes.add("ml_tendencia"); x.ml.tendencia = Math.min(x.ml.tendencia || 99, r.puesto || 99); }
    let top = null; try { top = typeof r.top === "string" ? JSON.parse(r.top || "[]") : r.top; } catch {}
    if (Array.isArray(top) && top.some((t) => +t.precio > 0) && r.ts >= x.ml.top_ts) { x.ml.top = top; x.ml.top_ts = r.ts; }
  }
  const serie = new Map(series.map((s) => [s.clave, s]));
  const out = [];
  for (const x of g.values()) {
    if (fuera.has(x.clave) || NO_PRODUCTO.test(x.palabra)) continue;
    const s = serie.get(x.clave);
    let vals = null; try { vals = s ? (typeof s.valores === "string" ? JSON.parse(s.valores) : s.valores) : null; } catch {}
    const c = vals ? curva(vals, P) : null;
    if (c) x.fuentes.add("google_curva");
    const comp = x.ml.top ? competencia(x.ml.top) : null;
    const crecMax = Math.max(0, ...x.rising.map((r) => r.crec || 0));
    // Es tendencia si la curva sube al menos 15% en el período, o si Google la marca "en aumento" en ese período.
    // Una curva que baja (menos de 0,9) descarta aunque haya aparecido en una lista: ya pasó.
    const sube = c ? c.ratio >= 1.15 : false, baja = c ? c.ratio < 0.9 : false;
    if (baja || (!sube && !crecMax && !(x.ml.tendencia && x.ml.tendencia <= 10))) continue;
    const pocoVolumen = c ? c.volumen < 5 || c.ceros > 0.4 : false;
    let puntaje = (c ? Math.min(1, Math.max(0, Math.log2(Math.max(c.ratio, 1))) / 2) * 40 : 0)
      + (crecMax ? Math.min(1, Math.log10(crecMax + 1) / 3.7) * 20 : 0)
      + (x.ml.tendencia ? Math.max(0, 10 - x.ml.tendencia / 5) : 0) + (x.ml.mas_vendido ? 10 - Math.min(9, x.ml.mas_vendido) : 0)
      + (comp?.ventas ? Math.min(1, Math.log10(comp.ventas) / 4) * 10 : 0);
    const fuentesDistintas = new Set([...x.fuentes].map((f) => f.split("_")[0])).size;   // google y ml
    if (fuentesDistintas >= 2) puntaje += 12;
    if (pocoVolumen) puntaje *= 0.6;
    const motivos = [];
    if (c) motivos.push(`Google: búsquedas ${c.ratio >= 9.99 ? "nuevas (antes casi 0)" : (c.ratio >= 1 ? "+" : "") + Math.round((c.ratio - 1) * 100) + "%"} (${P.comparacion})${pocoVolumen ? ", todavía con poco volumen" : ""}`);
    if (crecMax) { const r = x.rising.sort((a, b) => b.crec - a.crec)[0]; motivos.push(`Google "en aumento" al buscar "${r.semilla}": ${r.crec >= 5000 ? "más de +5000%" : "+" + r.crec + "%"}`); }
    if (x.ml.tendencia) motivos.push(`Mercado Libre: tendencia de búsqueda (puesto ${x.ml.tendencia})`);
    if (x.ml.mas_vendido) motivos.push(`Mercado Libre: ${x.ml.mas_vendido}º más vendido de su categoría`);
    if (comp?.ventas) motivos.push(`Los primeros en Mercado Libre venden +${comp.ventas.toLocaleString("es-AR")} · precio mediano $${Math.round(comp.precio).toLocaleString("es-AR")}`);
    out.push({ clave: x.clave, palabra: x.palabra, puntaje: Math.round(puntaje), fuentes: [...x.fuentes], cruce: fuentesDistintas >= 2, poco_volumen: pocoVolumen, curva: c, crec_google: crecMax || null, ml: { tendencia: x.ml.tendencia, mas_vendido: x.ml.mas_vendido, ventas: comp?.ventas || null, precio: comp?.precio || null, competencia: comp?.calidad ?? null }, motivos });
  }
  return out.sort((a, b) => b.puntaje - a.puntaje).slice(0, n);
}

const Mayus = (s) => String(s || "").charAt(0).toUpperCase() + String(s || "").slice(1);
const subida = (x) => (x.curva && x.curva.ratio < 9.99 ? `+${Math.round((x.curva.ratio - 1) * 100)}% de búsquedas` : x.crec_google ? "búsquedas disparadas" : x.ml.tendencia ? "tendencia en Mercado Libre" : "en alza");
// Textos listos para copiar. Sin precios inventados ni promesas de ganancia: solo lo medido.
export function textos(lista, periodo) {
  const P = PERIODOS[periodo], top = lista.filter((x) => !x.poco_volumen).slice(0, 5);
  const usar = top.length >= 3 ? top : lista.slice(0, 5);
  if (!usar.length) return { whatsapp: "", instagram: "" };
  const lineas = usar.map((x, i) => `${i + 1}. *${Mayus(x.palabra)}* — ${subida(x)}${x.ml.ventas ? ` · los primeros en Mercado Libre venden +${x.ml.ventas.toLocaleString("es-AR")}` : ""}`);
  const whatsapp = `🔥 *Productos en tendencia ${P.nombre}* (Argentina)\n\n${lineas.join("\n")}\n\n📊 Medido con Google Trends y Mercado Libre (${P.comparacion}).\n¿Querés traer alguno directo de China? Mandanos la foto por privado y te pasamos el costo puesto en Argentina 📲`;
  const instagram = `Lo que más está creciendo ${P.nombre} en Argentina 📈\n\n${usar.map((x, i) => `${i + 1}. ${Mayus(x.palabra)} (${subida(x)})`).join("\n")}\n\nDatos de Google Trends y Mercado Libre: ${P.comparacion}.\n\n¿Cuál traerías? Comentá WHATSAPP y te pasamos el costo puesto en Argentina.\n\n#importacion #china #emprendedores #mercadolibre #revendedores #tendencias #argentina`;
  return { whatsapp, instagram };
}

async function leer(env, ahora) {
  await prepararTendencias(env);
  const [desc, series, ml, feedback] = await Promise.all([
    todas(env, "SELECT ts, clave, palabra, semilla, tiempo, valor, crec FROM gt_desc WHERE ts>=?", ahora - 32 * DIA),
    todas(env, "SELECT clave, palabra, ts, fin, valores FROM gt_serie WHERE ts>=?", ahora - 10 * DIA),
    todas(env, "SELECT ts, clave, palabra, tipo, puesto, top FROM ml_observaciones WHERE ts>=? ORDER BY ts", ahora - 32 * DIA),
    todas(env, "SELECT clave, estado, ts FROM ml_feedback"),
  ]);
  return { desc, series, ml, feedback };
}

export async function tendenciasPanel(env, periodo = "semana", ahora = Date.now()) {
  const datos = await leer(env, ahora);
  const lista = ranking(datos, periodo, ahora, 15);
  let ultima = null; try { ultima = JSON.parse((await kvGet(env, "gt_ultima")) || "null"); } catch {}
  return { periodo, comparacion: PERIODOS[periodo]?.comparacion, ultima, lista, textos: textos(lista, periodo), fuentes: { google_aumento: datos.desc.length, google_curvas: datos.series.length, mercado_libre: datos.ml.length } };
}

// Curvas de Google por clave (para que candidatos.js considere "estable" lo que Google ya muestra sostenido)
export async function curvasGoogle(env) {
  await prepararTendencias(env);
  const m = new Map();
  for (const s of await todas(env, "SELECT clave, valores FROM gt_serie")) { try { const c = curva(JSON.parse(s.valores), PERIODOS.mes); if (c) m.set(s.clave, c); } catch {} }
  return m;
}

// Envío automático: todos los días 09:10 (AR) el del día; los lunes además el de la semana; el día 1 el del mes.
export async function cronTendencias(env, ts = Date.now(), avisar = null, { forzar = null } = {}) {
  if (!env.DB || env.TENDENCIAS === "0" || typeof avisar !== "function") return { ok: false, motivo: "apagado" };
  const d = new Date(ts - AR);
  if (!forzar && !(d.getUTCHours() === 9 && d.getUTCMinutes() === 10)) return { ok: false, motivo: "no es la hora" };
  const periodos = forzar ? [forzar] : ["dia", ...(d.getUTCDay() === 1 ? ["semana"] : []), ...(d.getUTCDate() === 1 ? ["mes"] : [])];
  let ultima = null; try { ultima = JSON.parse((await kvGet(env, "gt_ultima")) || "null"); } catch {}
  const viejo = !ultima || ts - ultima.ts > 36 * H;
  const enviados = [];
  for (const p of periodos) {
    const k = `tend_env_${p}_${diaAR(ts)}`;
    if (!forzar && (await kvGet(env, k))) continue;
    const r = await tendenciasPanel(env, p, ts);
    let msg;
    if (!r.lista.length) msg = `Tendencias ${PERIODOS[p].nombre}: sin productos que pasen el filtro.${viejo ? " La PC no mandó datos en las últimas 36 h: revisá que tendencias_ml.bat esté corriendo." : ""}`;
    else msg = `${r.textos.whatsapp}\n\n— — —\nPara Instagram:\n${r.textos.instagram}${viejo ? "\n\n⚠️ Datos de hace más de 36 h: revisá que tendencias_ml.bat esté corriendo en la PC." : ""}`;
    await avisar(env, msg.slice(0, 3900));
    await kvPut(env, k, "1");
    enviados.push(p);
  }
  return { ok: true, enviados };
}
