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
// Caso Palito: ya le contestaste un pedido viejo (link + 5 unidades); ahora manda otro link SIN cantidad → no se cotiza nada
db.prepare("INSERT INTO w_conv VALUES ('549345','Palito',0,0,?,?)").run(now - 60000, now - 120000);
msg("549345", "mirá este https://www.alibaba.com/product-detail/CajasViejas_1.html quiero 5 unidades", 600);
msg("549345", "mirá este otro https://www.alibaba.com/product-detail/NFC_Google_2.html", 1);
let aviso = 0; h.iaJSON = async () => { aviso++; return { items: [{ link: "https://www.alibaba.com/product-detail/CajasViejas_1.html", nombre: "Cajas", cantidad: 5 }] }; };
r = await C.cotizarAuto(env, h);
assert.equal(db.prepare("SELECT COUNT(*) n FROM tareas WHERE tel='549345'").get().n, 0); assert.equal(aviso, 0); console.log("✓ no recotiza lo que ya contestaste ni inventa cantidad: espera a que diga cuántos");
// Flujo nuevo: manda el link, el bot le pregunta cuántas unidades, contesta "50" → se cotiza el link de antes
db.prepare("INSERT INTO w_conv VALUES ('549346','Nico',0,0,?,?)").run(now - 60000, now - 20 * 60000);
msg("549346", "hola me cotizas esto? https://www.alibaba.com/product-detail/Termo_9.html", 30);
msg("549346", "50 unidades", 1);
h.iaJSON = async (e, p) => p.includes("Termo_9") ? { items: [{ link: "https://www.alibaba.com/product-detail/Termo_9.html", nombre: "Termo", cantidad: 50 }] } : { pesos: [0.5] };
r = await C.cotizarAuto(env, h);
assert.ok(r.some((x) => x.conv === "549346")); console.log("✓ link primero, cantidad después (respondiendo al bot): se cotiza solo");
r = await C.cotizarAuto(env, h); assert.ok(!r.some((x) => x.conv === "549346")); console.log("✓ y no lo vuelve a cotizar");
// Alibaba no deja leer la página: queda marcado para que el contestador le pida peso y FOB
db.prepare("INSERT INTO w_conv VALUES ('549347','Bloq',0,0,?,0)").run(now - 60000);
msg("549347", "cuanto me sale traer 200 de esto https://www.alibaba.com/product-detail/Bloqueado_5.html", 2);
db.prepare("INSERT INTO kv (k,v,exp) VALUES ('resp_auto:549347','1',NULL)").run();
h.iaJSON = async (e, p) => p.includes("Bloqueado") ? { items: [{ link: "https://www.alibaba.com/product-detail/Bloqueado_5.html", nombre: "X", cantidad: 200 }] } : { pesos: [] };
const leerAntes = h.leerPagina; h.leerPagina = async () => null;
await C.cotizarAuto(env, h); h.leerPagina = leerAntes;
const marca = db.prepare("SELECT v FROM kv WHERE k LIKE 'cotauto:549347:%'").get();
assert.ok(marca && marca.v.startsWith("no-se-pudo:")); assert.equal(db.prepare("SELECT COUNT(*) n FROM kv WHERE k='resp_auto:549347'").get().n, 0);
console.log("✓ página que no se puede leer: queda marcada y el contestador vuelve a mirar el chat");
// Caso cerradura (cotización 9): la IA no sabe qué producto es ("Producto Alibaba") → NO inventa peso ni cotiza sola
db.prepare("INSERT INTO w_conv VALUES ('549348','Ezequias',0,0,?,0)").run(now - 60000);
msg("549348", "45 unidades https://www.alibaba.com/product-detail/subject-1601360668710.html", 2);
let pidioPeso = 0;
h.iaJSON = async (e, p) => { if (p.includes("Estimá el peso")) { pidioPeso++; return { pesos: [2.5] }; } return { items: [{ link: "https://www.alibaba.com/product-detail/subject-1601360668710.html", nombre: "Producto Alibaba", cantidad: 45 }] }; };
h.leerPagina = async () => ({ datos: { nombre: null, tramos: [{ desde: 2, precio: 2.34 }], peso_kg: null } });
r = await C.cotizarAuto(env, h);
assert.equal(db.prepare("SELECT COUNT(*) n FROM tareas WHERE tel='549348'").get().n, 0); assert.equal(pidioPeso, 0);
assert.ok(db.prepare("SELECT v FROM kv WHERE k LIKE 'cotauto:549348:%'").get().v.startsWith("no-se-pudo:"));
console.log("✓ producto sin identificar: no se estima peso (antes 2,5 kg/u) ni se cotiza solo; se le pide el dato al cliente");
// Producto identificado sin peso en la página: estimación realista y acotada
db.prepare("INSERT INTO w_conv VALUES ('549349','Maxi',0,0,?,0)").run(now - 60000);
msg("549349", "20 unidades https://www.alibaba.com/product-detail/Mini-Cerradura-Electromagnetica_1601.html", 2);
h.iaJSON = async (e, p) => p.includes("Estimá el peso") ? { pesos: [0.09] } : { items: [{ link: "https://www.alibaba.com/product-detail/Mini-Cerradura-Electromagnetica_1601.html", nombre: "Mini cerradura electromagnética", cantidad: 20 }] };
r = await C.cotizarAuto(env, h); assert.equal(r.length, 1);
const d = JSON.parse(db.prepare("SELECT datos FROM cotiz_manual ORDER BY ts DESC LIMIT 1").get().datos); assert.equal(d.items[0].peso, 0.09);
console.log("✓ producto identificado: peso estimado realista (0,09 kg), marcado como estimado");
console.log("TODO OK");
