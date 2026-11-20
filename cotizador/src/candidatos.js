// CANDIDATOS PARA IMPORTAR Y VENDER EN MERCADO LIBRE
// Une tres piezas que ya existían: lo que lee la PC de Mercado Libre (ml_observaciones), el buscador de 1688 (worker
// "buscador", tablas busquedas/proveedores) y la cuenta de la calculadora de la web (autocot.js).
//
//   1. Filtro de Mercado Libre (sin IA, solo números): cada búsqueda observada pasa o no pasa checks objetivos.
//   2. Las que pasan se mandan a buscar a 1688 (como mucho ML_BUSQ_DIA por día, para cuidar el gasto de Apify).
//   3. Cuando el buscador termina: costo puesto en Argentina con la calculadora de la web y margen contra el precio de ML.
//
// Todo lo que se muestra en el panel trae el motivo de cada check: nada de "me parece".
import { configCalc, calcularWeb } from "./autocot.js";

const AR = 3 * 3600e3, DIA = 86400e3, SEMANA = 7 * DIA;
const corto = (t, n = 200) => String(t || "").replace(/\s+/g, " ").trim().slice(0, n);
const r2 = (x) => Math.round(x * 100) / 100;
const mediana = (xs) => { const v = xs.filter((x) => x != null && !isNaN(x)).sort((a, b) => a - b); if (!v.length) return null; const m = v.length >> 1; return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2; };
const num = (x, d) => { const v = Number(x); return isFinite(v) && v > 0 ? v : d; };
const todas = async (env, sql, ...b) => { try { return (await env.DB.prepare(sql).bind(...b).all()).results || []; } catch { return []; } };
const kvGet = async (env, k) => (await env.DB.prepare("SELECT v FROM kv WHERE k=?").bind(k).first().catch(() => null))?.v ?? null;
const kvPut = (env, k, v) => env.DB.prepare("INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)").bind(k, String(v)).run();
export const claveML = (s) => corto(String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim(), 80);
const diaAR = (ts) => new Date(ts - AR).toISOString().slice(0, 10);
export const semanaDe = (ts) => Math.floor((ts - AR + 3 * DIA) / SEMANA);   // semanas de lunes a domingo (hora AR)

// Umbrales: se cambian con variables en Cloudflare sin tocar código
export function umbrales(env = {}) {
  return {
    semanas: num(env.ML_SEMANAS, 3),                 // semanas distintas en que apareció (demanda estable, no moda)
    ventasTop: num(env.ML_VENTAS_MIN, 500),          // mediana de "+N vendidos" de las publicaciones de arriba
    oficialesMax: num(env.ML_OFICIALES_MAX, 0.6),    // si más del 60% de arriba son tiendas oficiales, es terreno de marcas
    calidadMax: num(env.ML_CALIDAD_MAX, 70),         // índice de qué tan profesional es la competencia (0-100): más alto = más difícil
    precioMin: num(env.ML_PRECIO_MIN, 12000),        // ARS: debajo de esto el costo fijo y el envío se comen todo
    precioMax: num(env.ML_PRECIO_MAX, 250000),       // ARS: arriba, mucho capital por unidad para una prueba
    pesoMax: num(env.ML_PESO_MAX, 1),                // kg por unidad: va por avión
    margenMin: num(env.ML_MARGEN_MIN, 0.2),          // margen neto mínimo sobre el precio de venta
    comision: num(env.ML_COMISION, 0.15),            // comisión de Mercado Libre (Premium ronda 14-17%)
    publicidad: num(env.ML_PUBLICIDAD, 0.07),        // Product Ads sobre el precio
    envioArs: num(env.ML_ENVIO_ARS, 7000),           // envío gratis obligatorio desde ML_UMBRAL_ENVIO
    umbralEnvio: num(env.ML_UMBRAL_ENVIO, 33000),
    fijoArs: num(env.ML_FIJO_ARS, 1500),             // costo fijo por unidad debajo del umbral de envío gratis
    lote: Math.round(num(env.ML_LOTE, 200)),         // unidades de la primera compra de prueba (los gastos fijos del envío pesan menos que con 100)
    busqDia: Math.round(num(env.ML_BUSQ_DIA, 3)),    // búsquedas en 1688 por día
  };
}

// Palabras que no son un producto importable por un revendedor (eventos, marcas, autos, inmuebles, línea blanca)
// Se mira el COMIENZO de la búsqueda: "auto usado" no, "cubre volante auto" sí.
export const NO_PRODUCTO = /^(ofertas?|navidad|buscar|black friday|cyber ?monday|hot ?sale|dia del (padre|nino|nina|madre)|regalos?)$|tienda oficial|^(autos?|motos?|camionetas?|cuatriciclos?|departamentos?|depto|casas?|terrenos?|alquiler|inmuebles?|lavarropas|heladeras?|freezer|aires? acondicionados?|televisor|smart tv|tv|notebooks?|celular(es)?|iphone|samsung|motorola|xiaomi|apple|sony|playstation|ps5|xbox|nintendo|nike|adidas|puma|album|figuritas|mercedes|toyota|volkswagen|ford|fiat|chevrolet|renault|peugeot)\b|\b(whisky|blue label|vinos?|cervezas?|medicamentos?|vapes?|vapers?|cigarrillos?|tabaco)\b/i;

// "+10mil vendidos" → 10000 · "+500 vendidos" → 500 · "+1 M vendidos" → 1000000
export function vendidosNum(s) {
  if (typeof s === "number") return s;
  const t = String(s || "").toLowerCase().replace(/\./g, "");
  const m = t.match(/(\d+(?:,\d+)?)\s*(mil|m\b|millon|millón|millones)?/);
  if (!m) return null;
  const base = parseFloat(m[1].replace(",", "."));
  return Math.round(m[2] === "mil" ? base * 1e3 : m[2] ? base * 1e6 : base);
}

// Señales de la página de resultados: qué tan profesional y concentrada está la competencia
export function competencia(top) {
  const org = (top || []).filter((x) => !x.ad && +x.precio > 0);
  if (!org.length) return null;
  const share = (f) => org.filter(f).length / org.length;
  const conDetalle = org.some((x) => "full" in x || "oficial" in x);
  const califs = org.map((x) => +x.calif).filter((x) => x > 0);
  const out = {
    n: org.length,
    precio: mediana(org.map((x) => +x.precio)),
    ventas: mediana(org.map((x) => vendidosNum(x.vendidos_n ?? x.vendidos))),
    full: conDetalle ? share((x) => x.full) : null,
    oficial: conDetalle ? share((x) => x.oficial) : null,
    calif: califs.length ? mediana(califs) : null,
  };
  // Índice 0-100: Full 40% + tiendas oficiales 35% + calificación alta 25%. Más alto = competencia más armada.
  out.calidad = conDetalle ? Math.round(out.full * 40 + out.oficial * 35 + (out.calif ? Math.max(0, Math.min(1, (out.calif - 4) / 0.8)) : 0.5) * 25) : null;
  return out;
}

// Paso 1: agrupar lo observado y pasar los checks de Mercado Libre. Función pura (la simulación la prueba sola).
export function evaluarML(rows, feedback = [], ahora = Date.now(), U = umbrales(), google = new Map()) {
  const descartadas = new Set(feedback.filter((f) => f.estado === "descartada" && f.ts > ahora - 30 * DIA).map((f) => f.clave));
  const g = new Map();
  for (const r of rows) {
    if (!r.clave || descartadas.has(r.clave)) continue;
    const x = g.get(r.clave) || { clave: r.clave, palabra: r.palabra, categoria: r.categoria, semanas: new Set(), dias: new Set(), tipos: new Set(), ultima: 0, top: null, top_ts: 0, resultados: null };
    x.semanas.add(semanaDe(r.ts)); x.dias.add(r.dia); if (r.tipo) x.tipos.add(r.tipo);
    if (r.ts >= x.ultima) { x.ultima = r.ts; x.palabra = r.palabra; x.categoria = r.categoria || x.categoria; }
    let top = null; try { top = typeof r.top === "string" ? JSON.parse(r.top || "[]") : r.top; } catch {}
    if (Array.isArray(top) && top.some((t) => +t.precio > 0) && r.ts >= x.top_ts) { x.top = top; x.top_ts = r.ts; x.resultados = r.resultados; }
    g.set(r.clave, x);
  }
  return [...g.values()].map((x) => {
    const c = competencia(x.top);
    const checks = [];
    const add = (id, ok, texto) => checks.push({ id, ok, texto });
    add("producto", !NO_PRODUCTO.test(x.palabra), NO_PRODUCTO.test(x.palabra) ? "Es un evento, una marca, un auto, un inmueble o línea blanca: no se importa para revender" : "Es un producto genérico importable");
    // Estable: 3 semanas viéndolo en Mercado Libre, o la curva de 90 días de Google ya muestra que se sostiene (no es un pico)
    const gc = google.get(x.clave), gOk = !!gc && gc.ratio >= 1 && gc.volumen >= 5 && gc.ceros <= 0.4;
    add("estable", x.semanas.size >= U.semanas || gOk, x.semanas.size >= U.semanas ? `Apareció en ${x.semanas.size} semanas distintas en Mercado Libre: demanda que se sostiene, no una moda` : gOk ? `Google: los últimos 30 días buscan ${Math.round(gc.ratio * 100)}% de lo que buscaban los 2 meses anteriores, con volumen: se sostiene` : `Visto en ${x.semanas.size} semana(s) (mínimo ${U.semanas}) y Google no muestra que se sostenga: todavía puede ser una moda`);
    if (!c) add("datos", null, "Falta la lectura del listado (publicaciones, precios y vendidos). La PC la trae en la próxima vuelta.");
    else {
      add("ventas", c.ventas == null ? null : c.ventas >= U.ventasTop, c.ventas == null ? "Las publicaciones no muestran vendidos" : `Las de arriba venden +${c.ventas.toLocaleString("es-AR")} (mediana; mínimo ${U.ventasTop})`);
      add("precio", c.precio >= U.precioMin && c.precio <= U.precioMax, `Precio mediano $${Math.round(c.precio).toLocaleString("es-AR")} (rango sano $${U.precioMin.toLocaleString("es-AR")}–$${U.precioMax.toLocaleString("es-AR")})`);
      add("marcas", c.oficial == null ? null : c.oficial <= U.oficialesMax, c.oficial == null ? "Sin dato de tiendas oficiales (lectura vieja)" : `${Math.round(c.oficial * 100)}% de arriba son tiendas oficiales (máximo ${Math.round(U.oficialesMax * 100)}%)`);
      add("competencia", c.calidad == null ? null : c.calidad <= U.calidadMax, c.calidad == null ? "Sin dato de Full ni calificación (lectura vieja)" : `Competencia ${c.calidad}/100 (Full ${Math.round(c.full * 100)}%, oficiales ${Math.round(c.oficial * 100)}%${c.calif ? `, calificación ${c.calif}` : ""}; máximo ${U.calidadMax})`);
    }
    const falla = checks.some((k) => k.ok === false), falta = checks.some((k) => k.ok === null);
    // Puntaje 0-100 para ordenar: semanas 30 · ventas 30 · competencia floja 25 · precio en rango 15
    const puntaje = Math.round(Math.min(1, x.semanas.size / 6) * 30 + (c?.ventas ? Math.min(1, Math.log10(c.ventas) / 4) * 30 : 0) + (c?.calidad != null ? (1 - c.calidad / 100) * 25 : 0) + (c && c.precio >= U.precioMin && c.precio <= U.precioMax ? 15 : 0));
    return { clave: x.clave, palabra: x.palabra, categoria: x.categoria, semanas: x.semanas.size, dias: x.dias.size, tipos: [...x.tipos], ultima: x.ultima, resultados: x.resultados, competencia: c, top: (x.top || []).filter((t) => !t.ad).slice(0, 3), checks, pasa_ml: !falla && !falta, estado_ml: falla ? "descartado" : falta ? "observando" : "pasa", puntaje };
  }).sort((a, b) => (b.pasa_ml - a.pasa_ml) || b.puntaje - a.puntaje);
}

// Paso 3: margen por unidad con la cuenta de la web. precioArs = mediana de ML. Función pura.
export function margen({ precioArs, fobUsd, pesoKg, cantidad, minimo }, cfg, U = umbrales()) {
  const q = Math.max(cantidad || U.lote, minimo || 0);
  const calc = calcularWeb([{ nombre: "producto", cantidad: q, fob: fobUsd, peso: pesoKg }], cfg, { via: "aereo" });
  if (!calc.ok) return { ok: false, falta: calc.falta };
  if (!(cfg.dolar > 0)) return { ok: false, falta: ["el dólar de la web"] };
  const costoArs = (calc.total / q) * cfg.dolar;   // sin redondear el unitario
  const comision = precioArs * U.comision, publicidad = precioArs * U.publicidad, envio = precioArs >= U.umbralEnvio ? U.envioArs : U.fijoArs;
  const neto = precioArs - comision - publicidad - envio - costoArs;
  return { ok: true, cantidad: q, kg: calc.kg, unitario_usd: calc.items[0].unitario, costo_ars: Math.round(costoArs), comision: Math.round(comision), publicidad: Math.round(publicidad), envio, neto_ars: Math.round(neto), margen: r2(neto / precioArs), inversion_usd: calc.total, inversion_ars: calc.totalArs };
}

// ---------------------------------------------------------------------------
// Base y cron
let listo = false;
export async function prepararCandidatos(env) {
  if (listo) return;
  await env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS ml_cand (clave TEXT PRIMARY KEY, palabra TEXT, ts INTEGER, busqueda TEXT, estado TEXT, datos TEXT)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT, exp INTEGER)"),
  ]);
  listo = true;
}
const leerObs = (env, ahora) => Promise.all([
  todas(env, "SELECT ts, dia, clave, palabra, categoria, tipo, resultados, top FROM ml_observaciones WHERE ts>=? ORDER BY ts", ahora - 56 * DIA),
  todas(env, "SELECT clave, estado, nota, ts FROM ml_feedback"),
]);

// Manda a buscar a 1688 los que pasan Mercado Libre y todavía no se buscaron (o se buscaron hace más de 30 días)
export async function lanzarBusquedas(env, ahora = Date.now(), U = umbrales(env)) {
  await prepararCandidatos(env);
  const [rows, fb] = await leerObs(env, ahora);
  const { curvasGoogle } = await import("./tendencias.js");
  const lista = evaluarML(rows, fb, ahora, U, await curvasGoogle(env)).filter((c) => c.pasa_ml);
  const hechas = new Map((await todas(env, "SELECT clave, ts, busqueda FROM ml_cand")).map((x) => [x.clave, x]));
  const dia = diaAR(ahora), claveDia = `ml_busq_${dia}`;
  let hoy = +((await kvGet(env, claveDia)) || 0);
  const lanzadas = [];
  for (const c of lista) {
    if (hoy >= U.busqDia) break;
    const h = hechas.get(c.clave);
    if (h?.busqueda && ahora - h.ts < 30 * DIA) continue;
    const id = "ml" + ahora.toString(36) + Math.random().toString(36).slice(2, 5);
    const ok = await env.DB.prepare(`INSERT INTO busquedas (id, ts, num, producto, cantidad, calidad, presupuesto, fuentes, paises, solo_minimo, asignado, creado_por, cliente, tel, tarea, estado, nota, costo, n_prov, archivada)
      VALUES (?,?,0,?,?,'indistinto','',?,'[]',0,?,'agente ML','Mercado Libre','',NULL,'nueva','',0,0,0)`).bind(id, ahora, corto(c.palabra, 120), U.lote, JSON.stringify(["1688"]), env.ML_ASIGNADO || "manuel").run().then(() => true).catch((e) => (console.log("ML → 1688:", e?.message || e), false));
    if (!ok) continue;
    await env.DB.prepare("INSERT OR REPLACE INTO ml_cand (clave, palabra, ts, busqueda, estado, datos) VALUES (?,?,?,?,?,?)").bind(c.clave, c.palabra, ahora, id, "buscando", JSON.stringify({ ml: c })).run();
    lanzadas.push(c.palabra); hoy++;
  }
  await kvPut(env, claveDia, hoy);
  return { lanzadas, pasan_ml: lista.length };
}

// Cuando el buscador termina: elige el proveedor de 1688 que más se parece y es más barato, y calcula el margen
export async function completarCandidatos(env, ahora = Date.now(), U = umbrales(env)) {
  await prepararCandidatos(env);
  const pend = await todas(env, "SELECT c.clave, c.palabra, c.busqueda, c.datos, b.estado AS b_estado, b.peso_kg, b.nota AS b_nota FROM ml_cand c JOIN busquedas b ON b.id=c.busqueda WHERE c.estado='buscando' AND b.estado IN ('lista','error')");
  if (!pend.length) return { completados: 0 };
  const cfg = await configCalc(env).catch(() => null);
  let n = 0;
  for (const p of pend) {
    let datos = {}; try { datos = JSON.parse(p.datos || "{}"); } catch {}
    const precioArs = datos.ml?.competencia?.precio;
    const provs = await todas(env, "SELECT id, titulo, link, foto, precio_usd, minimo, parecido, puntaje, tramos FROM proveedores WHERE busqueda=? AND fuente LIKE '1688%' AND precio_usd>0 ORDER BY puntaje DESC LIMIT 20", p.busqueda);
    const parecidos = provs.filter((x) => x.parecido == null || x.parecido >= 7);
    const peso = +p.peso_kg || 0.5;
    const checks = [];
    let estado = "no_da", mejor = null, cuenta = null;
    if (p.b_estado === "error" || !parecidos.length) { estado = "sin_proveedor"; checks.push({ id: "china", ok: false, texto: p.b_estado === "error" ? `El buscador falló: ${corto(p.b_nota, 120)}` : "En 1688 no apareció nada que coincida (parecido 7/10 o más)" }); }
    else {
      // El que deja más margen entre los 3 mejores puntuados que coinciden
      const opciones = parecidos.slice(0, 3).map((x) => ({ x, m: cfg ? margen({ precioArs, fobUsd: x.precio_usd, pesoKg: peso, cantidad: U.lote, minimo: x.minimo }, cfg, U) : { ok: false, falta: ["la configuración de la web"] } }));
      const conCuenta = opciones.filter((o) => o.m.ok).sort((a, b) => b.m.margen - a.m.margen);
      const elegido = conCuenta[0] || opciones[0];
      mejor = { titulo: corto(elegido.x.titulo, 120), link: elegido.x.link, foto: elegido.x.foto, fob_usd: elegido.x.precio_usd, minimo: elegido.x.minimo, parecido: elegido.x.parecido };
      cuenta = elegido.m;
      checks.push({ id: "peso", ok: peso <= U.pesoMax, texto: `Peso estimado ${peso} kg por unidad (máximo ${U.pesoMax} kg para avión)` });
      if (!cuenta.ok) { estado = "falta_dato"; checks.push({ id: "margen", ok: null, texto: `No se pudo calcular: falta ${cuenta.falta.join(", ")}` }); }
      else {
        checks.push({ id: "margen", ok: cuenta.margen >= U.margenMin, texto: `Margen neto ${Math.round(cuenta.margen * 100)}% (mínimo ${Math.round(U.margenMin * 100)}%): vende a $${Math.round(precioArs).toLocaleString("es-AR")}, te cuesta $${cuenta.costo_ars.toLocaleString("es-AR")} puesto, quedan $${cuenta.neto_ars.toLocaleString("es-AR")} por unidad después de comisión, envío y publicidad` });
        estado = checks.every((k) => k.ok) ? "ganador" : "no_da";
      }
    }
    await env.DB.prepare("UPDATE ml_cand SET estado=?, datos=?, ts=? WHERE clave=?").bind(estado, JSON.stringify({ ...datos, china: { mejor, cuenta, checks, peso_kg: peso, opciones: parecidos.length } }), ahora, p.clave).run();
    n++;
  }
  return { completados: n };
}

// Cada hora (minuto 20): completa lo que terminó y lanza las búsquedas nuevas del día
export async function cronCandidatos(env, ts = Date.now(), { forzar = false } = {}) {
  if (!env.DB || env.ML_CANDIDATOS === "0") return { ok: false, motivo: "apagado" };
  if (!forzar && new Date(ts).getUTCMinutes() !== 20) return { ok: false, motivo: "no es la hora" };
  const c = await completarCandidatos(env, ts);
  const l = await lanzarBusquedas(env, ts);
  return { ok: true, ...c, ...l };
}

// Lo que ve el panel: los que ya tienen cuenta de China primero, después los que pasan ML, después los que se observan
export async function listaCandidatos(env, ahora = Date.now()) {
  await prepararCandidatos(env);
  const U = umbrales(env);
  const [rows, fb] = await leerObs(env, ahora);
  const { curvasGoogle } = await import("./tendencias.js");
  const ml = evaluarML(rows, fb, ahora, U, await curvasGoogle(env));
  const cand = new Map((await todas(env, "SELECT clave, ts, busqueda, estado, datos FROM ml_cand")).map((x) => { let d = {}; try { d = JSON.parse(x.datos || "{}"); } catch {} return [x.clave, { ...x, china: d.china || null }]; }));
  const orden = { ganador: 0, no_da: 1, falta_dato: 2, buscando: 3, sin_proveedor: 4 };
  const items = ml.map((m) => { const c = cand.get(m.clave); return { ...m, estado: c?.estado || (m.pasa_ml ? "en_cola" : m.estado_ml), busqueda: c?.busqueda || null, china: c?.china || null }; })
    .sort((a, b) => (orden[a.estado] ?? 9) - (orden[b.estado] ?? 9) || b.puntaje - a.puntaje);
  const resumen = { observados: ml.length, pasan_ml: ml.filter((x) => x.pasa_ml).length, ganadores: items.filter((x) => x.estado === "ganador").length, buscando: items.filter((x) => x.estado === "buscando").length, semanas_con_datos: new Set(rows.map((r) => semanaDe(r.ts))).size };
  return { umbrales: U, resumen, items: items.filter((x) => x.estado !== "descartado").slice(0, 40), descartados: items.filter((x) => x.estado === "descartado").length };
}
