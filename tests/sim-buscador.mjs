// Simulación del buscador de proveedores (panel del cotizador + worker buscador) con D1 en memoria.
// Correr desde cotizador/:  node ../tests/sim-buscador.mjs
import { DatabaseSync } from "node:sqlite";
import fs from "fs";
import assert from "assert/strict";
fs.writeFileSync("/tmp/wk.mjs", fs.readFileSync("src/worker.js", "utf8"));
for (const f of ["lector.js", "lector-panel.js", "busquedas.js"]) fs.copyFileSync("src/" + f, "/tmp/" + f);
const W = (await import("/tmp/wk.mjs")).default;
const P = await import("/tmp/busquedas.js");
const B = await import("../buscador/src/buscador.js");

const db = new DatabaseSync(":memory:");
const stmt = (sql, b = []) => ({ bind: (...x) => stmt(sql, x), run: async () => { db.prepare(sql).run(...b); return {}; }, first: async () => db.prepare(sql).get(...b) ?? null, all: async () => ({ results: db.prepare(sql).all(...b) }) });
const DB = { prepare: (s) => stmt(s), batch: async (a) => { for (const x of a) await x.run(); } };
let ok = 0; const bien = (m) => { ok++; console.log("  ✓ " + m); };

// ---------- Internet simulado ----------
const llamadas = [], tgs = [];
let estadoRun = "RUNNING", apifyArranca = true, geminiCae = false;
const items1688 = [
  { offerId: "1", url: "https://detail.1688.com/offer/1.html", title: "AJ4复刻篮球鞋", titleEn: "AJ4 retro basketball sneakers men", currency: "CNY", priceTiers: [{ minQuantity: 2, price: 65 }, { minQuantity: 100, price: 60 }], minimumOrderQuantity: 2, companyName: "莆田鞋业", supplierUrl: "https://shop1.1688.com", city: "莆田市", province: "福建省", merchantSigns: { factory: true, powerfulMerchant: true }, goodRate: 98, soldCount: 5200, images: ["https://img/1.jpg"] },
  { offerId: "2", url: "https://detail.1688.com/offer/2.html", title: "AJ4鞋带", titleEn: "AJ4 replacement shoelaces", currency: "CNY", priceTiers: [{ minQuantity: 10, price: 3 }], minimumOrderQuantity: 10, companyName: "鞋带厂", images: [] },
  { offerId: "3", url: "https://detail.1688.com/offer/3.html", title: "AJ4运动鞋", titleEn: "AJ4 sports shoes high quality", currency: "CNY", priceTiers: [{ minQuantity: 200, price: 50 }], minimumOrderQuantity: 200, companyName: "大厂", images: ["https://img/3.jpg"] },
  { offerId: "4", url: "https://detail.1688.com/offer/4.html", title: "电子烟", titleEn: "disposable vape pods 6000 puffs", currency: "CNY", priceTiers: [{ minQuantity: 1, price: 10 }], minimumOrderQuantity: 1 },
  { offerId: "1", url: "https://detail.1688.com/offer/1.html", title: "duplicado", currency: "CNY", priceTiers: [{ minQuantity: 2, price: 65 }] },
];
const itemsAli = [
  { productId: "9", title: "AJ4 Retro Sneakers Men Basketball Shoes", productUrl: "https://www.alibaba.com/product-detail/9.html", imageUrl: "https://img/9.jpg", currency: "USD", minimumPrice: 12, maximumPrice: 15, minimumOrder: 20, priceTiers: [{ minimumQuantity: 20, price: 15 }, { minimumQuantity: 500, price: 12 }], supplierName: "Quanzhou Shoes Manufacturer Co.", supplierUrl: "https://qz.en.alibaba.com", supplierCountry: "China", supplierYears: 8, verifiedSupplier: true, rating: 4.9, reviewCount: 120 },
];
globalThis.fetch = async (u, o = {}) => {
  u = String(u); llamadas.push([o.method || "GET", u]);
  const R = (x, s = 200) => new Response(JSON.stringify(x), { status: s });
  if (u.includes("api.telegram.org") && u.includes("getUpdates")) return R({ ok: true, result: [{ message: { chat: { id: 777, first_name: "Manu" } } }] });
  if (u.includes("api.telegram.org")) { tgs.push(JSON.parse(o.body)); return R({ ok: true }); }
  if (u.includes("open.er-api.com")) return R({ rates: { CNY: 7.2 } });
  if (u.includes("generativelanguage") && u.includes("/models?")) return R({ models: [{ name: "models/gemini-2.5-flash", supportedGenerationMethods: ["generateContent"] }] });
  if (u.includes("generateContent")) {
    if (geminiCae) return R({ error: { message: "cuota" } }, 429);
    const p = JSON.parse(o.body).contents[0].parts[0].text;
    const r = p.includes('"zh"') ? { zh: "AJ4 复刻 篮球鞋", en: "AJ4 retro sneakers", peso_kg: 1.2, peso_motivo: "zapatilla con caja", nota: "" }
      : { p: [...p.matchAll(/^(\d+)\. (.*)$/gm)].map((m) => ({ i: +m[1], s: /laces|shoelace/i.test(m[2]) ? 1 : 9 })) };
    return R({ candidates: [{ content: { parts: [{ text: JSON.stringify(r) }] } }] });
  }
  if (u.includes("api.apify.com")) {
    assert.match(o.headers?.Authorization || "", /^Bearer tok-apify$/);
    if (u.includes("/users/me")) return R({ data: { username: "manu", plan: { id: "FREE" } } });
    if (o.method === "POST" && u.includes("/runs?")) {
      if (!apifyArranca) return R({ error: { message: "Monthly usage hard limit exceeded" } }, 402);
      const f = u.includes("1688") ? "1688" : "ali";
      assert.match(u, /maxTotalChargeUsd=0\.12/); assert.match(u, /maxItems=20/);
      return R({ data: { id: "run-" + f + "-" + llamadas.length, defaultDatasetId: "ds-" + f, status: "READY" } }, 201);
    }
    if (u.includes("/abort")) return R({ data: { status: "ABORTED" } });
    if (u.includes("/actor-runs/")) return R({ data: { status: estadoRun, usageTotalUsd: 0.051, defaultDatasetId: u.includes("1688") ? "ds-1688" : "ds-ali" } });
    if (u.includes("/datasets/ds-1688")) return R(items1688);
    if (u.includes("/datasets/ds-ali")) return R(itemsAli);
  }
  return R({});
};

const env = { DB, ESTADO: null, VERIFY_TOKEN: "k", PANEL_USUARIOS: "manuel:a, socio:b", APIFY_TOKEN: "tok-apify", GEMINI_KEY: "g", TELEGRAM_TOKEN: "tg", GEMINI_MODEL: "gemini-2.5-flash" };
const ctx = { waitUntil() {} };
const sesion = async (u, p) => (await W.fetch(new Request("https://x/login", { method: "POST", body: new URLSearchParams({ u, p }) }), env, ctx)).headers.get("set-cookie").split(";")[0];
const cM = await sesion("manuel", "a"), cS = await sesion("socio", "b");
const api = async (cookie, r, body) => (await W.fetch(new Request("https://x/panel/api/busquedas/" + r, { method: body ? "POST" : "GET", headers: { cookie, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }), env, ctx)).json();

console.log("1) Esquema y panel");
assert.deepEqual(P.ESQUEMA, B.ESQUEMA); bien("el esquema del panel y el del buscador son idénticos");
const pg = await W.fetch(new Request("https://x/panel/busquedas", { headers: { cookie: cM } }), env, ctx);
assert.equal(pg.status, 200); assert.match(await pg.text(), /Nueva búsqueda/); bien("la página /panel/busquedas carga con login");
assert.equal((await W.fetch(new Request("https://x/panel/api/busquedas/lista"), env, ctx)).status, 401); bien("sin login, la API responde 401");
const app = await (await W.fetch(new Request("https://x/panel", { headers: { cookie: cM } }), env, ctx)).text();
assert.match(app, /href="\/panel\/busquedas"/); assert.match(app, /busqueda_lista: "Búsqueda de proveedores lista"/); bien("el panel tiene el link a Búsquedas y entiende las tareas busqueda_lista");

console.log("2) Alta y reparto alternado");
let r = await api(cM, "nueva", { producto: "vapes elf bar 6000", cantidad: 10 }); assert.equal(r.ok, false); bien("vapers bloqueados: " + r.res);
r = await api(cM, "nueva", { producto: "zz", cantidad: 10 }); assert.equal(r.ok, false); bien("producto vacío rechazado");
db.prepare("INSERT INTO tareas (id,ts,tipo,tel,nombre,titulo,detalle,datos,ref,estado) VALUES ('t1',1,'proveedor','5493410000000','Juan','Buscar proveedor que venda 50 u de Jordan 4 retro (el actual pide mínimo 100)','El cliente quiere 50 unidades.','{}','','abierta')").run();
const pre = await api(cM, "tarea?id=t1"); assert.equal(pre.producto, "Jordan 4 retro"); assert.equal(pre.cantidad, 50); bien(`desde la tarea se completa: "${pre.producto}" x${pre.cantidad}, cliente ${pre.cliente}`);
const r1 = await api(cM, "nueva", { producto: "Jordan 4 retro", cantidad: 50, calidad: "replica", tarea: "t1" });
const r2 = await api(cS, "nueva", { producto: "licuadora portatil", cantidad: 20 });
const r3 = await api(cM, "nueva", { producto: "tarjetas NFC NTAG215", cantidad: 50 });
assert.deepEqual([r1.asignado, r2.asignado, r3.asignado], ["manuel", "socio", "manuel"]); bien("reparto: 1ª manuel, 2ª socio, 3ª manuel");
const rd = await api(cM, "nueva", { producto: "Jordan 4 retro", cantidad: 50 }); assert.equal(rd.id, r1.id); bien("la misma búsqueda repetida no se duplica");
let lm = await api(cM, "lista?f=mias"), ls = await api(cS, "lista?f=mias");
assert.equal(lm.busquedas.length, 2); assert.equal(ls.busquedas.length, 1); assert.equal((await api(cM, "lista?f=otros")).busquedas.length, 1); bien("filtros Mías / Del otro funcionan para cada uno");
assert.equal(lm.busquedas.find((b) => b.id === r1.id).cliente, "Juan"); bien("la búsqueda quedó vinculada al cliente de la tarea");

console.log("3) Telegram por persona");
r = await api(cM, "telegram", {}); assert.equal(r.ok, true); assert.equal(db.prepare("SELECT v FROM kv WHERE k='telegram_chat:manuel'").get().v, "777"); bien("Manuel conectó su Telegram (" + r.res + ")");

console.log("4) Worker buscador: lanzar (tope 2 por día para probar)");
env.MAX_BUSQUEDAS_DIA = "2";
let log = await B.vuelta(env); console.log("   ", log.join(" | "));
let b1 = db.prepare("SELECT * FROM busquedas WHERE id=?").get(r1.id);
assert.equal(b1.estado, "buscando"); assert.equal(JSON.parse(b1.runs).length, 2); assert.equal(JSON.parse(b1.consultas).zh, "AJ4 复刻 篮球鞋"); bien("búsqueda 1 lanzada en 1688 y Alibaba con palabras en chino e inglés");
const post1688 = llamadas.find(([m, u]) => m === "POST" && u.includes("webdata_labs~1688-scraper"));
assert.ok(post1688); bien("usa el actor webdata_labs/1688-scraper con tope de USD 0,12 por corrida");
log = await B.vuelta(env);
const b3 = db.prepare("SELECT * FROM busquedas WHERE id=?").get(r3.id);
assert.equal(b3.estado, "nueva"); assert.match(b3.nota, /tope 2/); bien("la 3ª queda en espera por el tope diario: " + b3.nota);
delete env.MAX_BUSQUEDAS_DIA;

console.log("5) Recoger resultados");
log = await B.vuelta(env); assert.ok(log.some((l) => l.includes("sigue buscando"))); bien("mientras Apify trabaja, espera");
estadoRun = "SUCCEEDED";
log = await B.vuelta(env); console.log("   ", log.join(" | "));
b1 = db.prepare("SELECT * FROM busquedas WHERE id=?").get(r1.id);
assert.equal(b1.estado, "lista");
const pv = db.prepare("SELECT * FROM proveedores WHERE busqueda=? ORDER BY puntaje DESC").all(r1.id);
console.table(pv.map((p) => ({ fuente: p.fuente, titulo: p.titulo.slice(0, 32), minimo: p.minimo, fob_usd: p.precio_usd, puesto_u: p.puesto_u, total: p.total, puntaje: p.puntaje })));
assert.ok(!pv.some((p) => /vape/i.test(p.titulo))); bien("descartó el vaper que vino en los resultados");
assert.ok(!pv.some((p) => /laces/i.test(p.titulo))); bien("descartó los cordones (no son lo pedido)");
assert.ok(!pv.some((p) => p.minimo > 50)); bien("descartó el de mínimo 200 (piden 50)");
assert.equal(pv.length, 2); bien("sin duplicados: quedan 2 proveedores");
// Cuenta a mano: 1688 tramo 2+ = ¥65 → /7,2 × 1,10 = 9,93 USD · 50 u × 1,2 kg = 60 kg → flete 950
const esperado = ((65 / 7.2) * 1.1 * 50 + 950 + 30) * 1.3 + 80;
const p1688 = pv.find((p) => p.fuente === "1688");
assert.equal(p1688.total, Math.round(esperado * 100) / 100); assert.equal(p1688.puesto_u, Math.round((esperado / 50) * 100) / 100);
bien(`precio puesto 1688 correcto: USD ${p1688.total} total, USD ${p1688.puesto_u}/u`);
const pAli = pv.find((p) => p.fuente === "alibaba");
assert.equal(pAli.total, Math.round(((15 * 50 + 950 + 30) * 1.3 + 80) * 100) / 100); bien(`precio puesto Alibaba correcto: USD ${pAli.puesto_u}/u (tramo 20+ a USD 15)`);
assert.ok(pv[0].puntaje >= pv[1].puntaje); bien("ordenados por puntaje");
assert.equal(b1.costo, 0.102); bien("guardó el costo real que informa Apify: USD " + b1.costo);
const tl = db.prepare("SELECT * FROM tareas WHERE tipo='busqueda_lista' AND ref=?").get("busq:" + r1.id);
assert.ok(tl); assert.match(tl.titulo, /2 proveedores/); bien("dejó la tarea en Pendientes: " + tl.titulo);
assert.equal(db.prepare("SELECT estado FROM tareas WHERE id='t1'").get().estado, "hecha"); bien("cerró la tarea 'Buscar proveedor' de origen");
const msgM = tgs.find((t) => t.chat_id === "777");
assert.ok(msgM && /Jordan 4 retro x50/.test(msgM.text)); bien("Telegram a Manuel: " + msgM.text.split("\n")[0]);
const b2 = db.prepare("SELECT * FROM busquedas WHERE id=?").get(r2.id);
assert.equal(b2.asignado, "socio"); assert.equal(b2.estado, "lista");
assert.ok(!tgs.some((t) => t.chat_id === "777" && /licuadora/.test(t.text))); bien("el socio sin Telegram conectado no recibe nada en el chat de Manuel (queda en Pendientes)");

console.log("6) Panel con resultados");
lm = await api(cM, "lista?f=mias");
const tarjeta = lm.busquedas.find((b) => b.id === r1.id);
assert.equal(tarjeta.proveedores.length, 2); assert.ok(Array.isArray(tarjeta.proveedores[0].tramos)); bien("el panel trae la búsqueda con sus proveedores");
r = await api(cM, "proveedor", { id: pv[1].id, estado: "descartado" }); assert.equal(db.prepare("SELECT estado FROM proveedores WHERE id=?").get(pv[1].id).estado, "descartado"); bien("descartar proveedor");
r = await api(cM, "proveedor", { id: pv[0].id, estado: "contactado" }); bien("cambiar estado a contactado");
r = await api(cM, "reasignar", { id: r1.id, a: "socio" }); assert.equal(db.prepare("SELECT asignado FROM busquedas WHERE id=?").get(r1.id).asignado, "socio"); bien("reasignar al socio");
assert.equal((await api(cS, "lista?f=mias")).busquedas.length, 2); bien("ahora el socio la ve en 'Mías'");

console.log("7) Fallas");
db.prepare("UPDATE busquedas SET lanzada_ts = 0").run();   // simula día nuevo
const r4 = await api(cS, "nueva", { producto: "caja de luz LED slim 50x70", cantidad: 20 });
apifyArranca = false; geminiCae = true;
log = await B.vuelta(env);
const b3e = db.prepare("SELECT * FROM busquedas WHERE id=?").get(r4.id);
assert.equal(b3e.estado, "error"); assert.match(b3e.nota, /no arrancó/); bien("Apify sin crédito → error claro: " + b3e.nota);
assert.match(JSON.parse(b3e.consultas).peso_motivo, /por defecto/); bien("si Gemini no responde, usa la palabra tal cual y 0,5 kg marcado como 'por defecto'");
apifyArranca = true; geminiCae = false; estadoRun = "RUNNING";
r = await api(cM, "busqueda", { id: r4.id, accion: "reintentar" }); assert.equal(r.ok, true);
await B.vuelta(env);
db.prepare("UPDATE busquedas SET runs = replace(runs, '\"desde\":', '\"desde\":0,\"x\":') WHERE id=?").run(r4.id);   // simula 30 min corriendo
log = await B.vuelta(env);
assert.ok(llamadas.some(([m, u]) => u.includes("/abort"))); bien("si Apify tarda más de 20 min, la corta y guarda lo que haya");
env.MAX_USD_MES = "0.2"; db.prepare("UPDATE busquedas SET lanzada_ts = 0 WHERE id<>?").run(r4.id); db.prepare("UPDATE busquedas SET lanzada_ts = ?, costo = 0.15 WHERE id=?").run(Date.now(), r4.id);
await api(cM, "nueva", { producto: "pistola masajeadora", cantidad: 20 });
log = await B.vuelta(env); assert.ok(log.some((l) => l.includes("tope mensual"))); bien("tope mensual de Apify respetado");
delete env.MAX_USD_MES;
r = await api(cM, "busqueda", { id: r2.id, accion: "archivar" }); assert.equal(db.prepare("SELECT estado FROM tareas WHERE ref=?").get("busq:" + r2.id).estado, "hecha"); bien("archivar cierra su pendiente");

console.log("8) Rutas del worker buscador");
const BW = B.default;
assert.equal((await BW.fetch(new Request("https://b/estado"), env)).status, 401); bien("/estado pide clave");
const est = await (await BW.fetch(new Request("https://b/estado?clave=k"), env)).json(); assert.equal(est.claves.apify, true); bien("/estado ok: gasto del mes USD " + est.gasto_mes_usd);
const pa = await (await BW.fetch(new Request("https://b/probar-apify?clave=k"), env)).json(); assert.equal(pa.usuario, "manu"); bien("/probar-apify reconoce la cuenta");

console.log(`\nTODO OK: ${ok} verificaciones`);
