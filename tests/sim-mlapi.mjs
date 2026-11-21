// Mercado Libre por la API oficial (cotizador/src/mlapi.js): conexión OAuth, lectura diaria de tendencias por categoría y
// listados, sin navegador. Correr desde cotizador/: node ../tests/sim-mlapi.mjs
import { DatabaseSync } from "node:sqlite";
import fs from "fs";
let ok = 0, mal = 0; const chk = (n, c) => { c ? ok++ : (mal++, console.log("FALLA:", n)); };
const dir = fs.mkdtempSync("/tmp/mlapi-");
for (const f of fs.readdirSync("src")) fs.copyFileSync("src/" + f, dir + "/" + f);
const db = new DatabaseSync(":memory:");
const stmt = (sql, b = []) => ({ bind: (...x) => stmt(sql, x), run: async () => { db.prepare(sql).run(...b); return {}; }, first: async () => db.prepare(sql).get(...b) ?? null, all: async () => ({ results: db.prepare(sql).all(...b) }) });
const base = { DB: { prepare: (s) => stmt(s), batch: async (a) => { for (const x of a) await x.run(); } } };
const env = { ...base, ML_APP_ID: "123", ML_SECRET: "sec" };
// Mercado Libre simulado
const llamadas = []; let tokenN = 0, vence401 = false;
globalThis.fetch = async (u, o = {}) => {
  u = String(u); llamadas.push(u);
  const res = (j, status = 200) => ({ ok: status < 300, status, json: async () => j });
  if (u.endsWith("/oauth/token")) { const b = new URLSearchParams(o.body); tokenN++; if (b.get("client_secret") !== "sec") return res({ message: "bad" }, 400); return res({ access_token: "AT" + tokenN, refresh_token: "RT" + tokenN, expires_in: 21600 }); }
  if (vence401) { vence401 = false; return res({ message: "expired" }, 401); }
  if (!/Bearer AT\d/.test(o.headers?.authorization || "")) return res({ message: "no token" }, 401);
  if (u.endsWith("/users/me")) return res({ nickname: "TEIMPORTAMOS" });
  if (u.endsWith("/sites/MLA/categories")) return res([{ id: "MLA1574", name: "Hogar, Muebles y Jardín" }, { id: "MLA1743", name: "Autos, Motos y Otros" }, { id: "MLA1276", name: "Deportes y Fitness" }]);
  if (/\/trends\/MLA(\/|$)/.test(u)) { const cat = u.split("/trends/MLA")[1] || ""; return res(Array.from({ length: 50 }, (_, i) => ({ keyword: `producto ${cat || "gral"} ${i + 1}`, url: "https://listado.mercadolibre.com.ar/x" }))); }
  if (u.includes("/sites/MLA/search")) return res({ paging: { total: 2400 }, results: [1, 2, 3].map((i) => ({ title: "Item " + i, price: 20000 + i, permalink: "https://articulo.mercadolibre.com.ar/MLA-" + i, sold_quantity: i === 1 ? 500 : 0, official_store_id: i === 2 ? 77 : null, shipping: { logistic_type: i === 1 ? "fulfillment" : "drop_off", free_shipping: true } })) });
  return res({}, 404);
};
const A = await import(dir + "/mlapi.js");
const M = await import(dir + "/mesa.js");
const T = await import(dir + "/tendencias.js");
await M.prepararMesa(base);

// 1) Conexión
const e0 = await A.estadoML(base);
chk("sin la app creada: dice qué falta y la URI de redirect a cargar", e0.falta.join() === "ML_APP_ID,ML_SECRET" && /\/ml\/callback$/.test(e0.redireccion) && !e0.url_conectar);
const e1 = await A.estadoML(env);
const state = new URL(e1.url_conectar).searchParams.get("state");
chk("con la app: link de autorización de Mercado Libre con state", e1.url_conectar.startsWith("https://auth.mercadolibre.com.ar/authorization?") && state && !e1.conectado);
const malo = await (await A.callbackML(env, new URL("https://x/ml/callback?code=C&state=otro"))).text();
chk("callback con state falso: no conecta", /no es válido/.test(malo) && !(await A.estadoML(env)).conectado);
const e2 = await A.estadoML(env); const st2 = new URL(e2.url_conectar).searchParams.get("state");
const bien = await (await A.callbackML(env, new URL(`https://x/ml/callback?code=C&state=${st2}`))).text();
chk("callback válido: conectado con el usuario", /conectado \(TEIMPORTAMOS\)/.test(bien) && (await A.estadoML(env)).conectado);

// 2) Lectura diaria (07:00 AR = 10:00 UTC), de a 12 llamadas por minuto
const t0 = Date.parse("2026-11-21T10:00:00Z");
chk("antes de las 7 no hace nada", (await A.cronMLApi(env, t0 - 60e3)).motivo === "nada en cola");
let r = await A.cronMLApi(env, t0);
chk("a las 7 arma la cola y hace 12 llamadas", r.ok && r.hechas === 12 && r.pendientes > 0);
chk("saltea Autos (no es producto para revender)", !llamadas.some((u) => u.includes("/trends/MLA/MLA1743")));
let vueltas = 1; while (r.pendientes > 0 && vueltas < 30) { r = await A.cronMLApi(env, t0 + vueltas * 60e3); vueltas++; }
chk("termina en pocos minutos", r.pendientes === 0 && vueltas < 30);
const filas = db.prepare("SELECT palabra, tipo, puesto, categoria, resultados, top FROM ml_observaciones").all();
const conTop = filas.filter((f) => f.top && JSON.parse(f.top).length);
chk("guarda tendencias de las 3 listas (crecimiento, deseadas, populares)", ["mayor crecimiento", "más deseada", "más popular"].every((t) => filas.some((f) => f.tipo === t)));
const t = JSON.parse(conTop[0].top);
chk("listado por la API: precio, Full, tienda oficial y total de publicaciones", conTop.length > 0 && conTop[0].resultados === 2400 && t[0].full === true && t[1].oficial === true && t[0].vendidos_n === 500 && t[1].vendidos_n === null);
chk("tope de búsquedas por día", conTop.length <= 80);
const ult = JSON.parse(db.prepare("SELECT v FROM kv WHERE k='mlapi_ultima'").get().v);
chk("estado para el panel: tendencias y listados leídos", ult.trends === 150 && ult.busquedas === conTop.length && ult.pendientes === 0);
chk("no vuelve a armar la cola el mismo día", (await A.cronMLApi(env, t0 + 3600e3)).motivo === "nada en cola");

// 3) Token vencido y 401
db.prepare("UPDATE kv SET v=json_set(v,'$.vence',0) WHERE k='mlapi_token'").run();
const antes = tokenN;
r = await A.cronMLApi(env, Date.parse("2026-11-22T10:00:00Z"));
chk("token vencido: lo renueva solo con el refresh", tokenN === antes + 1 && r.hechas === 12);
vence401 = true;
r = await A.cronMLApi(env, Date.parse("2026-11-22T10:01:00Z"));
chk("si la API responde 401: deja el trabajo en cola y renueva en la próxima", r.ok && JSON.parse(db.prepare("SELECT v FROM kv WHERE k='mlapi_token'").get().v).vence === 0);

// 4) Con la PC: no abre Mercado Libre y mide en Google lo que trajo la API; lo que Google descubre se busca en ML
const pc = await A.estadoParaPC(env);
chk("la PC sabe que la API está conectada y recibe palabras para medir en Google", pc.api_conectada && pc.palabras.length > 10);
db.prepare("UPDATE kv SET v='[]' WHERE k='mlapi_cola'").run();
const g = await T.guardarGoogle(env, { descubiertas: [{ palabra: "burbujeros", semilla: "por mayor", tiempo: "now 7-d", valor: "+5,000%" }, { palabra: "auto usado", semilla: "comprar", tiempo: "now 7-d", valor: "+900%" }], series: [] });
const cola = JSON.parse(db.prepare("SELECT v FROM kv WHERE k='mlapi_cola'").get().v);
chk("lo que descubrió Google va a la cola de búsquedas en ML (sin autos)", g.a_mercado_libre === 1 && cola[0].fila.palabra === "burbujeros" && cola[0].fila.tipo === "google");
chk("sin app configurada no corre", (await A.cronMLApi(base, t0)).motivo === "sin app");

console.log(`sim-mlapi: ${ok} ok, ${mal} fallas`);
if (mal) process.exit(1);
