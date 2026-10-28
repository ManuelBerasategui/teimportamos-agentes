// TikTok: lectura del perfil con Apify (simulado), guardado en tt_posts, tope de gasto compartido y cruce con Instagram.
// Correr desde cotizador/: node ../tests/sim-tiktok.mjs
import { DatabaseSync } from "node:sqlite";
import fs from "fs";
let ok = 0, mal = 0; const chk = (n, c) => { c ? ok++ : (mal++, console.log("FALLA:", n)); };
const dir = fs.mkdtempSync("/tmp/tt-");
for (const f of fs.readdirSync("../buscador/src")) fs.copyFileSync("../buscador/src/" + f, dir + "/" + f);
for (const f of fs.readdirSync("src")) fs.copyFileSync("src/" + f, dir + "/c-" + f);
for (const f of fs.readdirSync(dir).filter((x) => x.startsWith("c-"))) fs.writeFileSync(dir + "/" + f, fs.readFileSync(dir + "/" + f, "utf8").replace(/from "\.\/([a-z-]+\.js)"/g, 'from "./c-$1"'));
const db = new DatabaseSync(":memory:");
const stmt = (sql, b = []) => ({ bind: (...x) => stmt(sql, x), run: async () => { db.prepare(sql).run(...b); return {}; }, first: async () => db.prepare(sql).get(...b) ?? null, all: async () => ({ results: db.prepare(sql).all(...b) }) });
const env = { DB: { prepare: (s) => stmt(s), batch: async (a) => { for (const x of a) await x.run(); } }, APIFY_TOKEN: "a" };
db.exec("CREATE TABLE kv (k TEXT PRIMARY KEY, v TEXT, exp INTEGER)");
const T = await import(dir + "/tiktok.js");
const D = 86400e3, hoy = Date.now();
const items = [
  { id: "t1", text: "Vendí 50 termos por Mercado Libre y me quedó esto #importacion", createTimeISO: new Date(hoy - 2 * D).toISOString(), webVideoUrl: "https://www.tiktok.com/@te.importamos.arg/video/t1", playCount: 40000, diggCount: 900, shareCount: 120, commentCount: 40, collectCount: 300, videoMeta: { duration: 32, coverUrl: "c1" }, authorMeta: { fans: 5000 } },
  { id: "t2", desc: "Auriculares que pedí a China llegaron así", createTime: Math.round((hoy - 6 * D) / 1000), stats: { playCount: 2000, diggCount: 30, shareCount: 1, commentCount: 2, collectCount: 4 } },
  { id: "t3", text: "Cuánto cuesta importar zapatillas", createTimeISO: new Date(hoy - 10 * D).toISOString(), playCount: 5000 },
];
let lanz = null, estado = "RUNNING";
const apify = async (_e, ruta, o) => {
  if (ruta.startsWith("/acts/")) { lanz = { ruta, body: JSON.parse(o.body) }; return { ok: true, j: { data: { id: "run1" } } }; }
  if (ruta === "/actor-runs/run1") return { ok: true, j: { data: { status: estado, usageTotalUsd: 0.04, defaultDatasetId: "ds1" } } };
  if (ruta.startsWith("/datasets/ds1/items")) return { ok: true, j: items };
  return { ok: false };
};
let gastoBuscador = 0;
const gastoMes = async (e) => gastoBuscador + (await T.gastoTikTokMes(e));
const a6 = Date.UTC(2026, 9, 28, 9, 10), a10 = Date.UTC(2026, 9, 28, 13, 0);   // 6:10 y 10:00 en Argentina
chk("fuera de hora no lanza", (await T.vueltaTikTok(env, { apify, gastoMes, topeMes: 4.5, ahora: a10 })) === "" && !lanz);
chk("a las 6 lanza la lectura", (await T.vueltaTikTok(env, { apify, gastoMes, topeMes: 4.5, ahora: a6 })) === "TikTok: lectura lanzada");
chk("pide el perfil propio, sin bajar videos y con tope por lectura", lanz.body.profiles[0] === "te.importamos.arg" && lanz.body.shouldDownloadVideos === false && lanz.ruta.includes("maxTotalChargeUsd=0.1") && lanz.ruta.includes("clockworks~tiktok-scraper"));
chk("mientras corre, espera", (await T.vueltaTikTok(env, { apify, gastoMes, topeMes: 4.5, ahora: a6 + 120e3 })) === "TikTok: leyendo");
estado = "SUCCEEDED";
chk("al terminar guarda los videos", (await T.vueltaTikTok(env, { apify, gastoMes, topeMes: 4.5, ahora: a6 + 240e3 })).includes("3 videos"));
const t1 = db.prepare("SELECT * FROM tt_posts WHERE id='t1'").get(), t2 = db.prepare("SELECT * FROM tt_posts WHERE id='t2'").get();
chk("métricas planas", t1.vistas === 40000 && t1.guardados === 300 && t1.duracion === 32 && t1.seguidores === 5000);
chk("métricas dentro de stats y fecha en segundos", t2.vistas === 2000 && t2.likes === 30 && Math.abs(t2.ts - (hoy - 6 * D)) < 2000 && t2.link.endsWith("/video/t2"));
chk("suma el costo al mes", Math.abs((await T.gastoTikTokMes(env)) - 0.04) < 1e-9);
lanz = null;
chk("no repite antes de 2 días", (await T.vueltaTikTok(env, { apify, gastoMes, topeMes: 4.5, ahora: a6 + D })) === "" && !lanz);
gastoBuscador = 4.45;
chk("respeta el tope de Apify del mes", (await T.vueltaTikTok(env, { apify, gastoMes, topeMes: 4.5, ahora: a6 + 2 * D })).includes("tope") && !lanz);
items[0].playCount = 100; await T.guardarTikTok(env, items);
chk("una lectura con menos vistas no pisa las anteriores", db.prepare("SELECT vistas FROM tt_posts WHERE id='t1'").get().vistas === 40000);
// ---- Cruce con Instagram ----
db.exec("CREATE TABLE ig_posts (id TEXT PRIMARY KEY, ts INTEGER, tipo TEXT, media TEXT, en_feed INTEGER, link TEXT, portada TEXT, texto TEXT, formato TEXT, gancho TEXT, alcance INTEGER, vistas INTEGER, guardados INTEGER, compartidos INTEGER, comentarios INTEGER, likes INTEGER, seguidores INTEGER, visitas INTEGER, tiempo_ms INTEGER, actualizado INTEGER)");
const ig = db.prepare("INSERT INTO ig_posts (id, ts, tipo, link, texto, formato, gancho, alcance, en_feed) VALUES (?,?,'REELS',?,?,?,?,?,0)");
ig.run("i1", hoy - 2.2 * D, "https://instagram.com/reel/i1", "Vendí 50 termos por Mercado Libre y me quedó esto", "ml_vendi", "¿Cuánto me quedó?", 1500);
ig.run("i2", hoy - 6 * D, "https://instagram.com/reel/i2", "Mis auriculares de China", "reaccion", "No lo puedo creer", 30000);
ig.run("i3", hoy - 20 * D, "https://instagram.com/reel/i3", "Otro tema", "historia", "", 3000);
const R = await import(dir + "/c-redes.js");
const c = await R.cruceRedes(env, 60);
const f1 = c.filas.find((f) => f.tt?.link.endsWith("/t1")), f2 = c.filas.find((f) => f.tt?.link.endsWith("/t2"));
chk("empareja por texto", f1?.ig?.link.endsWith("/i1"));
chk("empareja por fecha cuando hay uno solo ese día", f2?.ig?.link.endsWith("/i2"));
chk("cada red contra su mediana", c.mediana_tt === 5000 && c.mediana_ig === 3000 && f1.tt.rel === 8 && f1.ig.rel === 0.5);
chk("veredicto: funcionó en una sola red", f1.veredicto === "Solo TikTok" && f2.veredicto === "Solo Instagram");
chk("sin par queda solo", c.filas.some((f) => f.tt?.link.endsWith("/t3") && !f.ig) && c.filas.some((f) => f.ig?.link.endsWith("/i3") && !f.tt) && c.emparejados === 2);
chk("por formato en cada red", c.formatos.find((f) => f.formato === "ml_vendi")?.tt === 8 && c.formatos.find((f) => f.formato === "reaccion")?.ig === 10);
chk("mejores de cada red", c.mejores_tt[0].tt.vistas === 40000 && c.mejores_ig[0].ig.alcance === 30000);
console.log(`sim-tiktok: ${ok} ok, ${mal} fallas`);
