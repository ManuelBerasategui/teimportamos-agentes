// Cotizador automático (cotizador/src/autocot.js): la cuenta de la calculadora de la web, la cola de links de Alibaba,
// la lectura que manda la PC y la cotización por chat. Correr desde cotizador/: node ../tests/sim-autocot.mjs
import { DatabaseSync } from "node:sqlite";
import fs from "fs";
let ok = 0, mal = 0; const chk = (n, c) => { c ? ok++ : (mal++, console.log("FALLA:", n)); };
const dir = fs.mkdtempSync("/tmp/autocot-");
for (const f of fs.readdirSync("src")) fs.copyFileSync("src/" + f, dir + "/" + f);
const db = new DatabaseSync(":memory:");
const stmt = (sql, b = []) => ({ bind: (...x) => stmt(sql, x), run: async () => { db.prepare(sql).run(...b); return {}; }, first: async () => db.prepare(sql).get(...b) ?? null, all: async () => ({ results: db.prepare(sql).all(...b) }) });
const kv = new Map();
const ESTADO = { get: async (k) => kv.get(k) ?? null, put: async (k, v) => { kv.set(k, v); }, delete: async (k) => { kv.delete(k); }, list: async ({ prefix }) => ({ keys: [...kv.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })) }) };
const env = { DB: { prepare: (s) => stmt(s), batch: async (a) => { for (const x of a) await x.run(); } }, ESTADO, SUPABASE_KEY: "clave-publica" };
const A = await import(dir + "/autocot.js");
const L = await import(dir + "/lector.js");
await L.prepararLector(env);

// 1) Configuración: la de la web (lo que no está cargado usa el valor por defecto de la web)
const cfg = A.cfgDesdeWeb([{ clave: "calc_flete_kg", valor: "19" }, { clave: "calc_handling", valor: "30" }, { clave: "calc_impuestos_pct", valor: "55" }, { clave: "calc_aereo_fijo", valor: "950" }, { clave: "calc_aereo_desde", valor: "50" }, { clave: "calc_aereo_hasta", valor: "250" }, { clave: "calc_barco_desde", valor: "250" }, { clave: "dolar_cotizacion", valor: "1600" }]);
chk("toma los valores de la web y completa con los de la calculadora", cfg.fleteKg === 19 && cfg.impuestosPct === 55 && cfg.honorariosPct === 10 && cfg.honorariosTope === 250 && cfg.honorariosMin === 30 && cfg.barcoM3 === 151.52 && cfg.barcoGastosFijos === 1700 && cfg.dolar === 1600);

// 2) La cuenta, igual que la calculadora de la web
let c = A.calcularWeb([{ nombre: "tarjeta NFC", cantidad: 100, fob: 2, peso: 0.1 }], cfg);
// FOB 200 + flete 19x10=190 + manejo 30 = 420 · impuestos 55% = 231 · honorarios 10% = 20 → mínimo 30 · despachante 100 → 781
chk("aéreo por kilo: 100 u a USD 2 y 100 g → USD 781 (7,81 c/u)", c.ok && c.via === "aereo" && c.flete === 190 && c.impuestos === 231 && c.honorarios === 30 && c.despachante === 100 && c.total === 781 && c.items[0].unitario === 7.81 && c.totalArs === 1249600);
c = A.calcularWeb([{ nombre: "parlante", cantidad: 200, fob: 15, peso: 0.5 }], cfg);
// 100 kg → fijo 950 · base 3000+950+30=3980 · imp 2189 · hon 300→tope 250 · desp 200 (FOB>=2000) → 6619
chk("aéreo entre 50 y 250 kg: flete fijo, honorarios con tope y despachante por tramo", c.flete === 950 && c.honorarios === 250 && c.despachante === 200 && c.total === 6619);
c = A.calcularWeb([{ nombre: "silla", cantidad: 100, fob: 20, peso: 4 }], cfg);
chk("más de 250 kg va por barco y pide el volumen", !c.ok && c.via === "maritimo" && /m³/.test(c.falta.join(" ")));
c = A.calcularWeb([{ nombre: "silla", cantidad: 100, fob: 20, peso: 4, volumen: 5 }], cfg);
// barco: flete 5x151,52=757,6 · base 2000+757,6+30=2787,6 · imp 75% = 2090,7 · hon 200 · desp 200 · fijos 1700x1,21=2057 → 7335,3
chk("barco: flete por m³, 75% de impuestos y gastos fijos con IVA", c.ok && c.flete === 757.6 && c.impuestosPct === 75 && c.gastosFijos === 2057 && Math.abs(c.total - 7335.3) < 0.01 && /60 a 90/.test(c.plazo));
c = A.calcularWeb([{ nombre: "a", cantidad: 10, fob: 10, peso: 1 }, { nombre: "b", cantidad: 10, fob: 30, peso: 1 }], cfg);
chk("varios productos: los unitarios suman el total", Math.abs(c.items.reduce((s, i) => s + i.subtotal, 0) - c.total) < 0.05 && c.items[1].unitario > c.items[0].unitario);
chk("sin precio o sin peso no inventa: dice qué falta", !A.calcularWeb([{ nombre: "x", cantidad: 5, fob: 0, peso: 0 }], cfg).ok && /FOB/.test(A.textoResultado(A.calcularWeb([{ nombre: "x", cantidad: 5 }], cfg))));
chk("resumen en una línea", /100 x tarjeta NFC: USD 7,81 c\/u puesto/.test(A.textoResultado(A.calcularWeb([{ nombre: "tarjeta NFC", cantidad: 100, fob: 2, peso: 0.1 }], cfg))));

// 3) Links: mismo producto aunque cambie el link; un mensaje del cliente con link entra solo a la cola
chk("clave por número de producto", A.claveLink("https://spanish.alibaba.com/product-detail/subject-1601673039709.html?from=share") === "1601673039709" && A.claveLink("https://www.alibaba.com/product-detail/NFC-Card_1601673039709.html") === "1601673039709" && A.claveLink("https://www.alibaba.com/x/B2g7TV?ck=pdp") === "B2g7TV");
const ahora = Date.now();
const entra = async (conv, yo, texto, ts) => { db.prepare("INSERT INTO w_msg (id,conv,grupo,yo,texto,ts,hist,tipo) VALUES (?,?,0,?,?,?,0,'text')").run("m" + Math.random(), conv, yo, texto, ts); if (!yo) await env.DB.batch(A.opsLinks(env, conv, texto, ts)); };
db.prepare("INSERT INTO w_conv (conv,nombre,grupo,primer_ts,ult_ts,ult_yo,n) VALUES ('5493410000050','Sam',0,?,?,0,2)").run(ahora, ahora);
await entra("5493410000050", 0, "Hola! Quiero cotizar esto: https://www.alibaba.com/product-detail/NFC-Card_1601673039709.html", ahora - 5 * 60e3);
await entra("5493410000050", 1, "dale, cuantas unidades?", ahora - 4 * 60e3);
await entra("5493410000050", 0, "100 unidades", ahora - 3 * 60e3);
chk("el link del cliente queda en la cola para la PC", (await A.pendientesPC(env)).links.length === 1 && db.prepare("SELECT conv, estado FROM ali_cola").get().conv === "5493410000050");

// 4) La PC: si Alibaba pide verificación no se lee nada y se reintenta después; cuando lee, la IA saca los datos y se cotiza
globalThis.fetch = async (u) => ({ ok: true, json: async () => [{ clave: "calc_flete_kg", valor: "19" }, { clave: "calc_impuestos_pct", valor: "55" }, { clave: "dolar_cotizacion", valor: "1600" }], text: async () => "" });
const prompts = [];
const ia = async (_e, p) => {
  prompts.push(p);
  if (/texto visible de una página de producto de Alibaba/.test(p)) return { nombre: "Tarjeta NFC para reseñas", tramos: [{ desde: 50, precio: 2.5 }, { desde: 100, precio: 2 }, { desde: 1000, precio: 1.6 }], moneda: "USD", moq: 50, unidad: "unidad", peso_kg: 0.1, paquete_cm: [10, 10, 2], unidades_por_paquete: 1 };
  if (/QUÉ CANTIDAD pidió/.test(p)) return { cantidades: [100] };
  return null;
};
const link = "https://www.alibaba.com/product-detail/NFC-Card_1601673039709.html";
chk("verificación de Alibaba: se anota el intento y no se inventa nada", (await A.linkLeido(env, ia, { link, bloqueado: true })).estado === "bloqueado" && db.prepare("SELECT estado, intentos FROM ali_cola").get().intentos === 1 && prompts.length === 0 && (await A.pendientesPC(env)).links.length === 0);
db.prepare("UPDATE ali_cola SET intento_ts=0").run();
const r = await A.linkLeido(env, ia, { link, titulo: "NFC Card - Buy NFC", texto: "100 - 999 pieces US$2.00 ... Single gross weight: 0.100 kg" });
chk("página leída: precio por cantidad, peso y medidas", r.estado === "leido" && r.datos.tramos.length === 3 && r.datos.peso === 0.1 && r.datos.m3 === 0.0002);
chk("la cantidad sale de lo que escribió el cliente", /CLIENTE: 100 unidades/.test(prompts.at(-1)) && /NOSOTROS: dale, cuantas unidades/.test(prompts.at(-1)));
const fila = db.prepare("SELECT * FROM autocot").get(), det = JSON.parse(fila.detalle);
chk("cotización automática lista: 100 u a USD 2 → USD 781 puesto, ligada al chat", fila.estado === "lista" && fila.conv === "5493410000050" && fila.nombre === "Sam" && fila.total === 781 && det.items[0].unitario === 7.81 && r.cotizacion.total === 781);

// 5) Sin cantidad: no se adivina; queda a la vista qué falta y se completa en el panel
db.prepare("INSERT INTO w_conv (conv,nombre,grupo,primer_ts,ult_ts,ult_yo,n) VALUES ('5493410000051','Lu',0,?,?,0,1)").run(ahora, ahora);
await entra("5493410000051", 0, "cuanto sale esto? https://www.alibaba.com/product-detail/Termo_1600000000001.html", ahora - 2 * 60e3);
const ia2 = async (e, p) => (/QUÉ CANTIDAD/.test(p) ? { cantidades: [0] } : /texto visible/.test(p) ? { nombre: "Termo 1 litro", tramos: [], rango: [3, 5], moneda: "USD", moq: 24, peso_kg: null, paquete_cm: [null, null, null] } : null);
const r2 = await A.linkLeido(env, ia2, { link: "https://www.alibaba.com/product-detail/Termo_1600000000001.html", titulo: "Termo", texto: "US$3-5" });
chk("falta cantidad, precio y peso: lo dice y no calcula", r2.cotizacion.estado === "falta" && /cantidad de Termo/.test(r2.cotizacion.falta.join(" ")) && /precio FOB/.test(r2.cotizacion.falta.join(" ")) && r2.cotizacion.total === null);
const api = async (m, b, q = "") => (await A.apiAutocot(env, { method: m }, new URL("https://x/panel/p/api/cotizar" + q), ia2, b)).json();
const est = await api("GET");
chk("panel: valores de la web, cotizaciones y cola", est.cfg.origen === "web" && est.cfg.fleteKg === 19 && est.lista.length === 2 && est.lista.some((x) => x.estado === "lista" && /TOTAL USD 781,00/.test(x.texto)) && est.cola.length === 0);
const comp = await api("POST", { accion: "completar", id: r2.cotizacion.id, items: [{ cantidad: 48, fob: 4, peso: 0.6 }] });
// FOB 192 + flete 19x28,8=547,2 + 30 = 769,2 · imp 423,06 · hon 30 · desp 100 → 1322,26
chk("completar a mano recalcula al instante", comp.ok && comp.total === 1322.26 && db.prepare("SELECT estado FROM autocot WHERE id=?").get(r2.cotizacion.id).estado === "lista");
chk("calculadora del panel", (await api("POST", { accion: "calcular", items: [{ nombre: "x", cantidad: 100, fob: 2, peso: 0.1 }] })).total === 781);
chk("pegar links a mano los pone en la cola con su cantidad", (await api("POST", { accion: "links", texto: "mirá https://www.alibaba.com/product-detail/Mate_1600000000002.html", cantidad: "200" })).anotados === 1 && db.prepare("SELECT cantidad, origen FROM ali_cola WHERE clave='1600000000002'").get().cantidad === 200 && (await api("POST", { accion: "links", texto: "nada" })).error);

// 6) El panel tiene la pestaña Cotizar y su JS compila
const { PANEL_P } = await import(dir + "/panel-p.js");
chk("pestaña Cotizar", PANEL_P.includes('data-v="cot"') && PANEL_P.includes('id="v-cot"') && PANEL_P.includes('id="cotLista"'));
new Function(PANEL_P.match(/<script>([\s\S]*)<\/script>/)[1]);
console.log(`\nsim-autocot: ${ok} ok, ${mal} fallas`); if (mal) throw new Error("simulations failed");
