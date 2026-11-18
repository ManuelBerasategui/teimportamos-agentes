// Candidatos para importar (cotizador/src/candidatos.js): filtro objetivo de Mercado Libre → búsqueda en 1688 → margen
// con la calculadora de la web. Correr desde cotizador/: node ../tests/sim-candidatos.mjs
import { DatabaseSync } from "node:sqlite";
import fs from "fs";
let ok = 0, mal = 0; const chk = (n, c) => { c ? ok++ : (mal++, console.log("FALLA:", n)); };
const dir = fs.mkdtempSync("/tmp/cand-");
for (const f of fs.readdirSync("src")) fs.copyFileSync("src/" + f, dir + "/" + f);
const db = new DatabaseSync(":memory:");
const stmt = (sql, b = []) => ({ bind: (...x) => stmt(sql, x), run: async () => { db.prepare(sql).run(...b); return {}; }, first: async () => db.prepare(sql).get(...b) ?? null, all: async () => ({ results: db.prepare(sql).all(...b) }) });
const env = { DB: { prepare: (s) => stmt(s), batch: async (a) => { for (const x of a) await x.run(); } }, SUPABASE_KEY: "clave-publica" };
globalThis.fetch = async () => ({ ok: true, json: async () => [{ clave: "calc_flete_kg", valor: "19" }, { clave: "calc_impuestos_pct", valor: "55" }, { clave: "dolar_cotizacion", valor: "1500" }], text: async () => "" });
const C = await import(dir + "/candidatos.js");
const M = await import(dir + "/mesa.js");
const B = await import(dir + "/busquedas.js");
for (const s of B.ESQUEMA) db.exec(s);
for (const s of B.MIGRACIONES) { try { db.exec(s); } catch {} }
await M.prepararMesa(env);

// 1) Lectura de los textos de Mercado Libre
chk("vendidos: +10mil, +500, Más de 5mil productos vendidos", C.vendidosNum("+10mil vendidos") === 10000 && C.vendidosNum("+500 vendidos") === 500 && C.vendidosNum("Más de 5mil productos vendidos") === 5000 && C.vendidosNum("") === null);

// 2) Lo que manda la PC: la tarjeta trae Full, tienda oficial, aviso, calificación (guardarML los conserva)
const tarjeta = (titulo, precio, v, extra = {}) => ({ titulo, precio, vendidos: `+${v} vendidos`, vendidos_n: v, calif: 4.6, full: false, oficial: false, ad: false, gratis: true, mas_vendido: false, url: "https://www.mercadolibre.com.ar/x/p/MLA1", ...extra });
const DIA = 86400e3, ahora = Date.parse("2026-11-18T15:00:00Z");
const floja = [tarjeta("Organizador cables A", 18000, 1000), tarjeta("Organizador cables B", 17500, 500, { full: true }), tarjeta("Organizador cables C", 19000, 5000), tarjeta("Aviso", 9000, 50000, { ad: true, oficial: true, full: true })];
const marcas = [1, 2, 3, 4].map((i) => tarjeta("Zapatilla " + i, 90000, 10000, { full: true, oficial: true, calif: 4.8 }));
const mandar = async (ts, items) => { const real = Date.now; Date.now = () => ts; try { return await M.guardarML(env, { items }); } finally { Date.now = real; } };
// organizador: 3 semanas distintas · zapatilla de marca: 3 semanas · ofertas: evento · moda: 1 semana
for (const s of [0, 7, 14]) await mandar(ahora - s * DIA, [
  { palabra: "Organizador de cables", tipo: "mayor crecimiento", puesto: 5, resultados: 2400, top: floja },
  { palabra: "Zapatillas running", tipo: "más deseada", puesto: 3, resultados: 9000, top: marcas },
  { palabra: "Ofertas", tipo: "mayor crecimiento", puesto: 1, top: floja },
]);
await mandar(ahora, [{ palabra: "Pelota mundial", tipo: "mayor crecimiento", puesto: 2, top: floja }]);
const guardada = JSON.parse(db.prepare("SELECT top FROM ml_observaciones WHERE clave='organizador de cables' LIMIT 1").get().top);
chk("guardarML conserva Full, oficial, aviso y calificación", guardada.length === 4 && guardada[1].full === true && guardada[3].ad === true && guardada[0].calif === 4.6 && guardada[0].vendidos_n === 1000);

// 3) Filtro de Mercado Libre (sin IA)
const rows = db.prepare("SELECT ts, dia, clave, palabra, categoria, tipo, resultados, top FROM ml_observaciones").all();
const ev = C.evaluarML(rows, [], ahora, C.umbrales({}));
const por = Object.fromEntries(ev.map((x) => [x.clave, x]));
const org = por["organizador de cables"];
chk("organizador pasa: 3 semanas, vendidos, precio en rango, pocas oficiales", org.pasa_ml && org.semanas === 3 && org.competencia.ventas === 1000 && org.competencia.precio === 18000 && org.competencia.full < 0.5);
chk("el aviso pago no cuenta para medir la competencia", org.competencia.n === 3 && org.competencia.oficial === 0);
chk("zapatillas: terreno de marcas (todas tiendas oficiales) → descartado", por["zapatillas running"].estado_ml === "descartado" && por["zapatillas running"].checks.some((k) => k.id === "marcas" && k.ok === false));
chk("'Ofertas' no es un producto → descartado", por["ofertas"].estado_ml === "descartado");
chk("una moda de una sola semana no pasa", !por["pelota mundial"].pasa_ml && por["pelota mundial"].checks.some((k) => k.id === "estable" && k.ok === false));
chk("cada check trae su motivo en texto", org.checks.every((k) => k.texto.length > 10));
chk("'cubre volante auto' sí es producto; 'auto usado' no", C.evaluarML([{ ts: ahora, dia: "2026-11-18", clave: "cubre volante auto", palabra: "Cubre volante auto", top: "[]" }, { ts: ahora, dia: "2026-11-18", clave: "auto usado", palabra: "Auto usado", top: "[]" }], [], ahora).find((x) => x.clave === "cubre volante auto").checks[0].ok === true);
const desc = C.evaluarML(rows, [{ clave: "organizador de cables", estado: "descartada", ts: ahora - DIA }], ahora);
chk("lo que el dueño descartó no vuelve por 30 días", !desc.some((x) => x.clave === "organizador de cables"));

// 4) Los que pasan van a 1688 (tope por día, sin duplicar)
const U = C.umbrales({ ML_BUSQ_DIA: "1" });
let l = await C.lanzarBusquedas(env, ahora, U);
const bq = db.prepare("SELECT * FROM busquedas").all();
chk("lanza la búsqueda en 1688 para el que pasa", l.lanzadas.length === 1 && bq.length === 1 && bq[0].estado === "nueva" && JSON.parse(bq[0].fuentes)[0] === "1688" && bq[0].cantidad === 200 && /Organizador/.test(bq[0].producto));
l = await C.lanzarBusquedas(env, ahora + 3600e3, U);
chk("no repite ni pasa el tope del día", l.lanzadas.length === 0 && db.prepare("SELECT COUNT(*) n FROM busquedas").get().n === 1);

// 5) La cuenta: costo puesto con la calculadora de la web y margen neto
const cfg = { fleteKg: 19, handling: 30, honorariosPct: 10, honorariosTope: 250, honorariosMin: 30, despachanteTramos: "0:100, 1000:150, 2000:200", impuestosPct: 55, aereoFijo: 950, aereoDesde: 50, aereoHasta: 250, barcoM3: 151.52, impuestosBarcoPct: 75, barcoGastosFijos: 1700, barcoDesde: 250, dolar: 1500, senaPct: 50 };
const m = C.margen({ precioArs: 18000, fobUsd: 1.2, pesoKg: 0.15, cantidad: 100 }, cfg);
// FOB 120 + flete 15kg×19=285 + 30 = 435 · imp 55% = 239,25 · hon 12→mín 30 · desp 100 → 804,25 → 8,04 c/u → $12.064
chk("costo puesto igual a la calculadora: USD 8,04 c/u", m.ok && Math.abs(m.unitario_usd - 8.04) < 0.01 && m.costo_ars === 12064);
// 18000 − 15% (2700) − 7% (1260) − fijo 1500 (debajo de $33.000) − 12064 = 476 → 3%
chk("margen neto después de comisión, publicidad y envío", m.neto_ars === 476 && m.margen === 0.03);
chk("sin dólar no inventa el margen", !C.margen({ precioArs: 18000, fobUsd: 1.2, pesoKg: 0.15 }, { ...cfg, dolar: 0 }).ok);

// 6) El buscador terminó: elige el proveedor que coincide y deja el veredicto
const id = bq[0].id;
db.prepare("UPDATE busquedas SET estado='lista', peso_kg=0.15 WHERE id=?").run(id);
const prov = (pid, titulo, precio, parecido, minimo = 50) => db.prepare("INSERT INTO proveedores (id,busqueda,ts,fuente,titulo,link,precio_usd,minimo,parecido,puntaje) VALUES (?,?,?,?,?,?,?,?,?,?)").run(pid, id, ahora, "1688", titulo, "https://detail.1688.com/offer/" + pid + ".html", precio, minimo, parecido, 8);
prov("1", "理线器 organizador", 0.35, 9); prov("2", "otra cosa parecida", 0.2, 4); prov("3", "organizador caro", 0.9, 8);
// Lote de 300: los gastos fijos del envío (manejo, despachante, honorarios mínimos) se reparten mejor que en 100
let c = await C.completarCandidatos(env, ahora + 2 * 3600e3, C.umbrales({ ML_LOTE: "300" }));
let fila = db.prepare("SELECT estado, datos FROM ml_cand").get(), d = JSON.parse(fila.datos);
chk("toma el que coincide y deja más margen (no el que no se parece)", c.completados === 1 && d.china.mejor.link.includes("/1.html") && d.china.cuenta.ok);
chk("con USD 0,35 FOB, 150 g y lote de 300 el margen supera 20% → ganador", fila.estado === "ganador" && d.china.cuenta.margen >= 0.2 && d.china.checks.every((k) => k.ok));
const lista = await C.listaCandidatos({ ...env, ML_LOTE: "300" }, ahora + 2 * 3600e3);
chk("el panel muestra primero al ganador, con sus motivos", lista.items[0].estado === "ganador" && lista.items[0].checks.length >= 5 && lista.resumen.ganadores === 1 && lista.descartados >= 2);

// 7) Si en 1688 no aparece nada que coincida, lo dice
db.prepare("UPDATE ml_cand SET estado='buscando'").run(); db.prepare("DELETE FROM proveedores").run(); prov("9", "funda de celular", 0.1, 2);
await C.completarCandidatos(env, ahora + 3 * 3600e3, C.umbrales({ ML_LOTE: "300" }));
chk("sin proveedor que coincida → sin_proveedor, con el motivo", db.prepare("SELECT estado FROM ml_cand").get().estado === "sin_proveedor");

// 8) Cron: solo al minuto 20 y apagable
chk("cron fuera de hora no hace nada", (await C.cronCandidatos(env, Date.parse("2026-11-18T15:05:00Z"))).motivo === "no es la hora");
chk("ML_CANDIDATOS=0 lo apaga", (await C.cronCandidatos({ ...env, ML_CANDIDATOS: "0" }, Date.parse("2026-11-18T15:20:00Z"))).motivo === "apagado");

console.log(`sim-candidatos: ${ok} ok, ${mal} fallas`);
if (mal) process.exit(1);
