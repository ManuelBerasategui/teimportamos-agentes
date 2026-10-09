// Simulación de la cotización automática desde el 805. Correr desde cotizador/: node ../tests/sim-cotizauto.mjs
import { DatabaseSync } from "node:sqlite";
import fs from "fs"; import assert from "assert/strict";
fs.copyFileSync("src/cotizar.js", "/tmp/cotizar-sim.mjs");
const C = await import("/tmp/cotizar-sim.mjs");
const db = new DatabaseSync(":memory:");
const stmt = (sql, b = []) => ({ bind: (...x) => stmt(sql, x), run: async () => { db.prepare(sql).run(...b); return {}; }, first: async () => db.prepare(sql).get(...b) ?? null, all: async () => ({ results: db.prepare(sql).all(...b) }) });
const env = { DB: { prepare: (s) => stmt(s), batch: async (a) => { for (const x of a) await x.run(); } } };
for (const q of ["CREATE TABLE w_msg (id TEXT, conv TEXT, grupo INTEGER, yo INTEGER, texto TEXT, ts INTEGER)", "CREATE TABLE w_conv (conv TEXT, nombre TEXT, grupo INTEGER, archivado INTEGER, ult_cliente_ts INTEGER, ult_yo_ts INTEGER)",
  "CREATE TABLE kv (k TEXT PRIMARY KEY, v TEXT, exp INTEGER)", "CREATE TABLE tareas (id TEXT PRIMARY KEY, ts INTEGER, tipo TEXT, tel TEXT, nombre TEXT, titulo TEXT, detalle TEXT, datos TEXT, ref TEXT, estado TEXT)"]) db.prepare(q).run();
const now = Date.now(), msg = (conv, t, min) => db.prepare("INSERT INTO w_msg VALUES (?,?,0,0,?,?)").run(Math.random() + "", conv, t, now - min * 60000);
db.prepare("INSERT INTO w_conv VALUES ('549341','Juan',0,0,?,0)").run(now); msg("549341", "hola, cuanto sale esto? https://www.alibaba.com/product-detail/Inflador_1600.html?spm=x", 30); msg("549341", "100 unidades", 20);
db.prepare("INSERT INTO w_conv VALUES ('549342','Ana',0,0,?,0)").run(now); msg("549342", "me pasas precio https://www.alibaba.com/product-detail/Lampara_77.html", 10);
db.prepare("INSERT INTO w_conv VALUES ('549343','Leo',0,0,?,0)").run(now); msg("549343", "quiero 50 de este https://detail.1688.com/offer/123.html", 10);
db.prepare("INSERT INTO w_conv VALUES ('549344','Sol',0,0,?,0)").run(now); msg("549344", "(image) cuanto 50 unidades", 10);
const T = { fleteKg: 18, handling: 30, honorarios: 80, factor: 1.3, aereoFijo: 950, aereoDesde: 50, aereoHasta: 250, barcoFijo: 100 };
const h = { T,
  iaJSON: async (e, p) => p.includes("Inflador") ? { items: [{ link: "https://www.alibaba.com/product-detail/Inflador_1600.html", nombre: "Inflador de auto", cantidad: 100 }] } : p.includes("Lampara") ? { items: [{ link: "https://www.alibaba.com/product-detail/Lampara_77.html", nombre: "Lámpara", cantidad: 0 }] } : { pesos: [0.3] },
  leerPagina: async (l) => ({ datos: { nombre: "Inflador", tramos: [{ desde: 2, precio: 0.75 }], peso_kg: 0.06 } }), iaConImagenes: async () => ({}) };
let r = await C.cotizarAuto(env, h);
assert.equal(r.length, 1); assert.equal(r[0].conv, "549341");
const tot = r[0].total; assert.equal(Math.round(tot * 100) / 100, Math.round(((0.75 * 100 + 6 * 18 + 30) * 1.3 + 80) * 100) / 100);
console.log("✓ link de Alibaba + 100 unidades → cotización automática USD", tot.toFixed(2), "(misma cuenta que la calculadora: 356,90)");
const t = db.prepare("SELECT * FROM tareas").get(); assert.equal(t.tipo, "cotizacion_auto"); assert.equal(t.tel, "549341"); console.log("✓ tarea en Pendientes:", t.titulo);
assert.equal(db.prepare("SELECT COUNT(*) n FROM tareas WHERE tel IN ('549342','549343','549344')").get().n, 0); console.log("✓ sin cantidad, link de 1688 o solo foto: no se cotiza solo");
r = await C.cotizarAuto(env, h); assert.equal(r.length, 0); console.log("✓ no repite la misma cotización");
msg("549342", "30 unidades", 1);
h.iaJSON = async (e, p) => p.includes("Lampara") ? { items: [{ link: "https://www.alibaba.com/product-detail/Lampara_77.html", nombre: "Lámpara", cantidad: 30 }] } : { pesos: [0.5] };
r = await C.cotizarAuto(env, h); assert.equal(r.length, 1); assert.equal(r[0].conv, "549342"); console.log("✓ cuando el cliente después dice la cantidad, la cotiza");
const html = await (await C.paginaCotizacion(env, r[0].id, T)).text(); assert.match(html, /Lámpara/); assert.match(html, /peso/i); console.log("✓ PDF listo (/panel/cotizar/pdf)");
console.log("TODO OK");
