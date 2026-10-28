// Agente único (ventas + redes): datos verídicos en el prompt, misma memoria desde el panel y Telegram.
// Correr desde cotizador/: node ../tests/sim-agente.mjs
import { DatabaseSync } from "node:sqlite";
import fs from "fs";
let ok = 0, mal = 0; const chk = (n, c) => { c ? ok++ : (mal++, console.log("FALLA:", n)); };
const dir = fs.mkdtempSync("/tmp/ag-");
for (const f of fs.readdirSync("src")) fs.copyFileSync("src/" + f, dir + "/" + f);
const db = new DatabaseSync(":memory:");
const stmt = (sql, b = []) => ({ bind: (...x) => stmt(sql, x), run: async () => { db.prepare(sql).run(...b); return {}; }, first: async () => db.prepare(sql).get(...b) ?? null, all: async () => ({ results: db.prepare(sql).all(...b) }) });
const env = { DB: { prepare: (s) => stmt(s), batch: async (a) => { for (const x of a) await x.run(); } }, TELEGRAM_TOKEN: "x" };
const L = await import(dir + "/lector.js"); await L.prepararLector(env);
const R = await import(dir + "/redes.js");
await R.apiRedes(env, new Request("https://x/panel/api/redes/dms"), new URL("https://x/panel/api/redes/dms"), "manuel", async () => null, "https://x", null).catch(() => {});
db.exec("CREATE TABLE IF NOT EXISTS tt_posts (id TEXT PRIMARY KEY, ts INTEGER, link TEXT, texto TEXT, duracion INTEGER, portada TEXT, vistas INTEGER, likes INTEGER, comentarios INTEGER, compartidos INTEGER, guardados INTEGER, seguidores INTEGER, actualizado INTEGER)");
db.exec("INSERT OR REPLACE INTO kv VALUES ('telegram_chat','111',NULL)");
const D = 86400e3, h = Date.now();
db.prepare("INSERT INTO ig_posts (id, ts, tipo, link, texto, formato, gancho, alcance, tiempo_ms, en_feed) VALUES ('i1',?,'REELS','l1','Vendí termos','ml_vendi','¿Cuánto me quedó?',1200,9000,0),('i2',?,'REELS','l2','Auriculares de China','reaccion','No lo puedo creer',9000,21000,0)").run(h - 2 * D, h - 9 * D);
db.prepare("INSERT INTO tt_posts (id, ts, link, texto, vistas, likes, compartidos, guardados, duracion) VALUES ('t1',?,'tl1','Vendí termos',40000,900,120,300,32)").run(h - 2 * D);
db.prepare("INSERT INTO w_conv (conv, nombre, grupo, primer_ts, ult_ts, ult_yo, ult_cliente_ts, n, perfil, producto, etapa, origen) VALUES ('5493410000001','Ana',0,?,?,1,?,6,'A','termos','cotizado','reel termos')").run(h - 3 * D, h - 2 * D, h - 3 * D);
let prompt = "";
const ia = async (_e, p) => { if (p.includes("Sos el AGENTE")) { prompt = p; return { respuesta: "El cuello de botella es el seguimiento.", guardar: [{ tipo: "aprendizaje", texto: "Semana floja por falta de seguimiento" }] }; }
  if (p.includes("SECRETARIO")) return { nuevas: [], consulta: /ventas/.test(p) && /qué pasó/.test(p), respuesta: "" }; return null; };
const A = await import(dir + "/agente.js");
const r = await A.preguntarAgente(env, ia, "No cerramos ninguna venta en 7 días, ¿qué pasó?");
chk("responde", r.respuesta === "El cuello de botella es el seguimiento.");
chk("rol de ventas y contenido", prompt.includes("jefe de ventas y estratega de contenido para Instagram y TikTok"));
chk("manuales de ventas y de redes", prompt.includes("MANUAL DEL ASESOR") && prompt.includes("MANUAL DE CONTENIDO Y REDES") && prompt.includes("EL cuello de botella"));
chk("compara con la semana anterior", prompt.includes("los 7 dias anteriores (para comparar)") && prompt.includes("reels esta semana vs la anterior"));
chk("ve TikTok e Instagram cruzados", prompt.includes("TIKTOK · videos esta semana") && prompt.includes("40.000 vistas") && prompt.includes("FORMATOS EN CADA RED"));
chk("ve de dónde vienen los chats", prompt.includes("reel termos 1"));
chk("guarda la charla y la memoria", (await A.charlaAgente(env)).length === 2 && db.prepare("SELECT texto FROM ag_mem").get()?.texto.includes("seguimiento"));
// Telegram: la pregunta de negocio llega al mismo agente
const S = await import(dir + "/asistente.js");
const sec = await S.secretoTG(env), enviados = [];
globalThis.fetch = async (u, o) => { if (String(u).endsWith("/sendMessage")) enviados.push(JSON.parse(o.body).text); return { ok: true, json: async () => ({ ok: true }) }; };
const mandar = async (text) => { const ctx = { p: null, waitUntil(x) { this.p = x; } }; await S.rutaTelegram(env, { json: async () => ({ message: { chat: { id: 111 }, text } }), headers: { get: () => sec } }, new URL("https://x/tg/" + sec), ctx, ia); await ctx.p; };
prompt = ""; await mandar("che, ¿por qué bajaron las vistas de los reels?");
chk("Telegram: pregunta clara va directo al agente", prompt.includes("¿por qué bajaron las vistas") && enviados.at(-1) === "El cuello de botella es el seguimiento.");
chk("Telegram: misma memoria que el panel", (await A.charlaAgente(env)).length === 4);
prompt = ""; await mandar("no cerramos ventas, qué pasó, y anotame llamar a Pedro");
chk("Telegram: el secretario deriva la consulta y anota", prompt.includes("anotame llamar a Pedro") && enviados.at(-1).startsWith("El cuello de botella"));
prompt = ""; await mandar("chats");
chk("Telegram: pedir chats no va al agente", prompt === "" && enviados.at(-1).includes("805"));
const W = fs.readFileSync("src/worker.js", "utf8");
chk("panel: Agente, asistente del 805 y Redes van al mismo agente", W.includes('["/panel/api/agente/preguntar", "/panel/api/805/preguntar", "/panel/api/redes/preguntar"]') && W.includes("preguntarAgente(env, iaJSON"));
console.log(`sim-agente: ${ok} ok, ${mal} fallas`);
