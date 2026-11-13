// Virales de otras cuentas (buscador/src/virales.js): qué se guarda, subtítulos, tope de gasto y cuándo corre.
// Correr desde cotizador/: node ../tests/sim-virales.mjs
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import path from "node:path";
let ok = 0, mal = 0; const chk = (n, c) => { c ? ok++ : (mal++, console.log("FALLA:", n)); };
const V = await import(pathToFileURL(path.resolve("../buscador/src/virales.js")).href);
const db = new DatabaseSync(":memory:");
db.exec("CREATE TABLE kv (k TEXT PRIMARY KEY, v TEXT, exp INTEGER)");
const stmt = (sql, b = []) => ({ bind: (...x) => stmt(sql, x), run: async () => { db.prepare(sql).run(...b); return {}; }, first: async () => db.prepare(sql).get(...b) ?? null, all: async () => ({ results: db.prepare(sql).all(...b) }) });
const env = { DB: { prepare: (s) => stmt(s), batch: async (a) => { for (const x of a) await x.run(); } }, APIFY_TOKEN: "x" };
const ahora = Date.parse("2026-11-16T08:10:00Z");   // lunes 05:10 AR
const dia = 86400e3, iso = (d) => new Date(ahora - d * dia).toISOString();
const item = (id, o) => ({ id, createTimeISO: iso(o.d ?? 3), text: o.t || "video " + id, playCount: o.v, shareCount: 10, collectCount: 20, diggCount: 30, authorMeta: { name: o.a || "otro", fans: o.f ?? 1000 }, webVideoUrl: "https://www.tiktok.com/@x/video/" + id, searchHashtag: { name: "importardechina" }, videoMeta: { duration: 30, subtitleLinks: o.sub ? [{ language: "eng-US", downloadLink: "https://s/en" }, { language: "spa-ES", downloadLink: "https://s/es" }] : [] } });

chk("se guarda el que tiene muchas vistas", V.filaViral(item("1", { v: 500000, f: 900000 }), { ahora })?.vistas === 500000);
chk("se guarda el que superó 5 veces a sus seguidores aunque no llegue al piso", V.filaViral(item("2", { v: 12000, f: 2000 }), { ahora }) !== null);
chk("no se guarda uno común", V.filaViral(item("3", { v: 8000, f: 5000 }), { ahora }) === null);
chk("no se guarda uno viejo ni uno nuestro", V.filaViral(item("4", { v: 900000, d: 90 }), { ahora }) === null && V.filaViral(item("5", { v: 900000, a: "te.importamos.arg" }), { propio: "te.importamos.arg", ahora }) === null);
chk("elige los subtítulos en español", V.filaViral(item("6", { v: 90000, sub: 1 }), { ahora }).sub === "https://s/es");
chk("subtítulos a texto corrido", V.textoSubtitulos("WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nCompré doscientos termos\n\n00:00:02.000 --> 00:00:04.000\nCompré doscientos termos\n\n2\n00:00:04.000 --> 00:00:06.000\n<c>y mirá</c> lo que pasó") === "Compré doscientos termos y mirá lo que pasó");

// Una vuelta completa con Apify simulado
const llamadas = [];
const apify = async (_e, ruta, o = {}) => {
  llamadas.push({ ruta, body: o.body ? JSON.parse(o.body) : null });
  if (/\/runs\?/.test(ruta)) return { ok: true, j: { data: { id: "run1" } } };
  if (/actor-runs\/run1$/.test(ruta)) return { ok: true, j: { data: { status: "SUCCEEDED", usageTotalUsd: 0.21, defaultDatasetId: "ds1" } } };
  if (/datasets\/ds1/.test(ruta)) return { ok: true, j: [item("10", { v: 700000, sub: 1, t: "Traje 200 termos" }), item("11", { v: 40000 }), item("12", { v: 900 }), item("10", { v: 700000 })] };
  return { ok: false, status: 404 };
};
const leerSubs = async () => ({ ok: true, text: async () => "WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nCompré doscientos termos a dos dólares" });
let gasto = 1;
const dep = { apify, gastoMes: async () => gasto, topeMes: 4.5, leerSubs };
chk("la primera vez lanza la lectura con hashtags y subtítulos", /lanzada/.test(await V.vueltaVirales(env, { ...dep, ahora })) && llamadas[0].body.hashtags.includes("importardechina") && llamadas[0].body.shouldDownloadSubtitles === true && /maxTotalChargeUsd=0\.5/.test(llamadas[0].ruta));
const res = await V.vueltaVirales(env, { ...dep, ahora: ahora + 4 * 60e3 });
const filas = db.prepare("SELECT * FROM virales ORDER BY vistas DESC").all();
chk("recoge: guarda 2 (sin repetir, sin el común) con lo que dice el video", /SUCCEEDED, 4 videos leídos, 2 guardados/.test(res) && filas.length === 2 && filas[0].guion === "Compré doscientos termos a dos dólares" && filas[0].fuente === "#importardechina");
chk("el gasto se suma a la cuenta del mes de Apify", +db.prepare("SELECT v FROM kv WHERE k LIKE 'tt_costo:%'").get().v === 0.21);
chk("no vuelve a leer hasta la semana siguiente", (await V.vueltaVirales(env, { ...dep, ahora: ahora + 2 * dia })) === "" && (await V.vueltaVirales(env, { ...dep, ahora: ahora + 6 * dia })) === "");
db.prepare("INSERT INTO kv (k,v) VALUES ('virales_fuentes', ?)").run(JSON.stringify({ hashtags: ["#alibaba"], perfiles: ["@otro.importador"] }));
db.prepare("INSERT INTO kv (k,v) VALUES ('vir_forzar','1')").run();
llamadas.length = 0;
chk("el panel puede pedir una lectura con sus fuentes", /lanzada/.test(await V.vueltaVirales(env, { ...dep, ahora: ahora + 2 * dia })) && llamadas[0].body.hashtags.join() === "alibaba" && llamadas[0].body.profiles.join() === "otro.importador" && !db.prepare("SELECT 1 FROM kv WHERE k='vir_forzar'").get());
db.exec("DELETE FROM kv WHERE k IN ('vir_run','vir_ultimo')"); gasto = 4.4;
chk("respeta el tope mensual de Apify", /tope/.test(await V.vueltaVirales(env, { ...dep, ahora })) && JSON.parse(db.prepare("SELECT v FROM kv WHERE k='vir_ultimo'").get().v).estado === "TOPE");
console.log(`\nsim-virales: ${ok} ok, ${mal} fallas`); if (mal) throw new Error("simulations failed");
