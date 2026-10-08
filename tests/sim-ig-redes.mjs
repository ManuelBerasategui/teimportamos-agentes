// Pestaña Redes: sincronización de Instagram (posts, cuenta, DMs, formatos), ideas, reporte, chat del agente y pantalla.
// Correr desde cotizador/: node ../tests/sim-ig-redes.mjs
import { DatabaseSync } from "node:sqlite";
import fs from "fs";
const dir = fs.mkdtempSync("/tmp/igr-");
fs.mkdirSync(dir + "/ig"); fs.mkdirSync(dir + "/co");
for (const f of ["instagram.js", "metricas.js", "sync.js", "formatos-iniciales.js"]) fs.copyFileSync(new URL("../instagram/src/" + f, import.meta.url), `${dir}/ig/${f}`);
for (const f of fs.readdirSync(new URL("../cotizador/src/", import.meta.url))) fs.copyFileSync(new URL("../cotizador/src/" + f, import.meta.url), `${dir}/co/${f}`);
let ok = 0, mal = 0; const chk = (n, c) => { c ? ok++ : (mal++, console.log("FALLA:", n)); };

const db = new DatabaseSync(":memory:");
const stmt = (sql, b = []) => ({ bind: (...x) => stmt(sql, x), run: async () => { db.prepare(sql).run(...b); return {}; }, first: async () => db.prepare(sql).get(...b) ?? null, all: async () => ({ results: db.prepare(sql).all(...b) }) });
const DB = { prepare: (s) => stmt(s), batch: async (a) => { for (const x of a) await x.run(); } };
const fila = (sql, ...b) => db.prepare(sql).get(...b);

// ---------- Instagram simulado ----------
const DIA = 86400e3, ahora = Date.now();
const TOTAL = 70;   // 70 publicaciones, una por día
const POSTS = Array.from({ length: TOTAL }, (_, i) => ({ id: "p" + i, caption: "post " + i + " #importaciones", media_type: i % 4 ? "VIDEO" : "CAROUSEL_ALBUM", media_product_type: i % 4 ? "REELS" : "FEED",
  permalink: "https://ig/p/" + i, timestamp: new Date(ahora - i * DIA - 3600e3).toISOString().replace("Z", "+0000"), like_count: 10, comments_count: 2, thumbnail_url: "https://cdn/p" + i + ".jpg", is_shared_to_feed: i % 3 !== 0 }));
let llamadas = [], dmsModo = "ok", rechazaExpansion = false;
const igFake = async (ruta, _m, p = {}) => {
  llamadas.push(ruta);
  if (ruta === "/me") return { user_id: "999", username: "te.importamos.arg", followers_count: 6543, media_count: TOTAL };
  if (ruta === "/me/media") { const d = +(p.after || 0), n = +p.limit; return { data: POSTS.slice(d, d + n), paging: d + n < TOTAL ? { next: "x", cursors: { after: String(d + n) } } : {} }; }
  if (ruta === "/me/insights") {
    if (p.metric === "follower_count") return { data: [{ name: "follower_count", values: Array.from({ length: 30 }, (_, i) => ({ value: 10 + i, end_time: "2026-09-" + String(i + 1).padStart(2, "0") + "T07:00:00+0000" })) }] };
    const base = +p.since > ahora / 1000 - 8 * 86400 ? 2000 : 1000;   // la última semana duplica a la anterior
    return { data: p.metric.split(",").map((m) => ({ name: m, total_value: { value: base } })) };
  }
  if (ruta.endsWith("/insights")) { const i = +ruta.match(/p(\d+)/)[1]; return { data: p.metric.split(",").map((m) => ({ name: m, values: [{ value: m === "ig_reels_avg_watch_time" ? 15000 + i * 10 : m === "reach" ? 1000 + (i === 2 ? 50000 : i * 3) : 5 }] })) }; }
  if (ruta === "/me/conversations") {
    if (dmsModo === "permiso") throw new Error("Instagram /me/conversations: (#3) Application does not have the capability to make this API call. permission");
    if (p.fields.includes("messages") && rechazaExpansion) throw new Error("Instagram /me/conversations: (#100) Unknown field messages");
    const convs = [
      { id: "c1", participants: { data: [{ username: "te.importamos.arg", id: "999" }, { username: "juan_revende", id: "111" }] }, messages: { data: [{ id: "m1", from: { username: "juan_revende", id: "111" }, message: "hola, cuánto sale traer auriculares A9 Pro?", created_time: new Date(ahora - 2 * 3600e3).toISOString() }] } },
      { id: "c2", participants: { data: [{ username: "te.importamos.arg", id: "999" }, { username: "ana_tienda", id: "222" }] }, messages: { data: [{ id: "m2", from: { username: "te.importamos.arg", id: "999" }, message: "te paso al whatsapp", created_time: new Date(ahora - 5 * 3600e3).toISOString() }] } },
      { id: "c3", participants: { data: [{ username: "te.importamos.arg", id: "999" }, { username: "pepe", id: "333" }] }, messages: { data: [{ id: "m3", from: { username: "pepe", id: "333" }, created_time: new Date(ahora - 1 * 3600e3).toISOString() }] } },
    ];
    return { data: p.fields.includes("messages") ? convs : convs.map(({ messages, ...c }) => c) };
  }
  if (ruta === "/c2") return { messages: { data: [{ id: "my", from: { username: "te.importamos.arg", id: "999" }, message: "te paso al whatsapp", created_time: new Date(ahora).toISOString() }] } };
  if (/^\/c\d$/.test(ruta)) return { messages: { data: [{ id: "mx", from: { username: "juan_revende", id: "111" }, message: "sigo esperando", created_time: new Date(ahora).toISOString() }] } };
  throw new Error("ruta desconocida " + ruta);
};
globalThis.fetch = async (u) => {
  const s = String(u);
  if (s.startsWith("https://cdn/")) return new Response(new Uint8Array([255, 216, 255]), { headers: { "content-type": "image/jpeg" } });
  if (s.includes("api.telegram.org")) { tg.push(s); return new Response("{}"); }
  return new Response("{}", { status: 404 });
};
const tg = [];
const env = { DB, VERIFY_TOKEN: "k", TELEGRAM_TOKEN: "t", TELEGRAM_CHAT: "1" };
const ESQUEMA_BASE = ["CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT, exp INTEGER)"];
for (const s of ESQUEMA_BASE) db.exec(s);

const S = await import(`${dir}/ig/sync.js`);
const { FORMATOS_INICIALES } = await import(`${dir}/ig/formatos-iniciales.js`);
let vistas = 0;
const iaImagen = async () => { vistas++; return { formato: "historia", gancho: "había un flaco que necesitaba" }; };

// 1) Primera vuelta completa
const r1 = await S.syncCompleto(env, igFake, iaImagen, { p1: "ml_vendi" });
chk("cuenta guardada", r1.cuenta === true && JSON.parse(fila("SELECT v FROM kv WHERE k='ig_cuenta'").v).d7.reach === 2000);
chk("20 posts guardados con métricas", r1.posts.guardadas === 20 && r1.posts.conMetricas === 20);
chk("formato inicial aplicado", fila("SELECT formato FROM ig_posts WHERE id='p1'").formato === "ml_vendi");
chk("reel de prueba marcado", fila("SELECT en_feed FROM ig_posts WHERE id='p3'").en_feed === 0 && fila("SELECT en_feed FROM ig_posts WHERE id='p1'").en_feed === 1);
chk("tiempo visto guardado", fila("SELECT tiempo_ms FROM ig_posts WHERE id='p1'").tiempo_ms === 15010);
chk("DMs: 2 pendientes (cliente habló último)", r1.dms.ok && r1.dms.pendientes === 2 && fila("SELECT ult_yo FROM ig_dms WHERE conv='c2'").ult_yo === 1);
chk("DM sin texto queda como adjunto", fila("SELECT ult_texto FROM ig_dms WHERE conv='c3'").ult_texto.startsWith("["));
chk("clasifica reels sin formato con la portada", r1.clasificados >= 1 && vistas === r1.clasificados);
chk("no pasa el tope de 50 consultas", r1.consultas <= 45);
// 2) Sigue recorriendo el historial hasta el final
let r = r1, vueltas = 1;
while (fila("SELECT v FROM kv WHERE k='ig_sync_historial'")?.v !== "si" && vueltas < 10) { r = await S.syncCompleto(env, igFake, iaImagen, {}); vueltas++; chk("vuelta " + vueltas + " dentro del tope", r.consultas <= 45); }
chk("historial completo en 4 vueltas", vueltas === 4 && fila("SELECT COUNT(*) n FROM ig_posts").n === TOTAL);
// 3) Después: solo refresca lo reciente (los posts de más de 45 días no gastan consultas)
llamadas = [];
const rA = await S.syncCompleto(env, igFake, iaImagen, {});
const rB = await S.syncCompleto(env, igFake, iaImagen, {});
const rC = await S.syncCompleto(env, igFake, iaImagen, {});
chk("refresco reciente vuelve al principio", rA.posts.proximo === "20" && rB.posts.proximo === "40" && rC.posts.proximo === "");
chk("posts viejos no piden métricas", !llamadas.some((x) => x === "/p60/insights"));
// 4) DMs: sin permiso, y sin expansión de campos
dmsModo = "permiso";
const d1 = await S.syncDMs(env, S.conTope(igFake));
chk("DMs sin permiso: guarda el error", !d1.ok && /permission/.test(fila("SELECT v FROM kv WHERE k='ig_dms_error'").v));
dmsModo = "ok"; rechazaExpansion = true;
const d2 = await S.syncDMs(env, S.conTope(igFake));
chk("DMs sin expansión: uno por uno", d2.ok && fila("SELECT ult_texto FROM ig_dms WHERE conv='c1'").ult_texto === "sigo esperando" && fila("SELECT v FROM kv WHERE k='ig_dms_error'").v === "");
const d3 = await S.syncDMs(env, S.conTope(igFake, 4), { reintentoUnoPorUno: false });
chk("DMs cada 30 min no reintenta", !d3.ok);
rechazaExpansion = false;

// 5) Esquemas iguales en los dos workers
const R = await import(`${dir}/co/redes.js`);
chk("esquema ig igual en los dos workers", JSON.stringify(R.ESQUEMA_IG) === JSON.stringify(S.ESQUEMA_IG));
chk("formatos iguales en los dos workers", JSON.stringify(R.FORMATOS) === JSON.stringify(S.FORMATOS));
chk("formatos iniciales válidos", Object.values(FORMATOS_INICIALES).every((f) => S.FORMATOS[f]) && Object.keys(FORMATOS_INICIALES).length === 91);

// 6) Panel: API de Redes
db.exec("CREATE TABLE w_conv (conv TEXT, grupo INTEGER, producto TEXT, ult_ts INTEGER)");
db.prepare("INSERT INTO w_conv VALUES ('1',0,'auriculares A9 Pro',?),('2',0,'auriculares a9 pro',?),('3',0,'zapatillas jordan 4',?)").run(ahora, ahora, ahora);
const prompts = [];
let iaResp = null;
const iaJSON = async (_e, p) => {
  prompts.push(p);
  if (iaResp) return iaResp;
  if (p.includes('"ideas"')) return { ideas: [
    { titulo: "El revendedor de Córdoba", formato: "historia", gancho: "me escribió un flaco de córdoba", guion: ["uno", "dos", "tres"], cta: "escribime al dm", por_que: "historia: mediana 22.503", producto: "auriculares A9 Pro", hipotesis: "historia retiene +18 s" },
    { titulo: "Vapes por mayor", formato: "producto", gancho: "vapes baratos", guion: ["x"], cta: "dm", por_que: "x", producto: "vapes", hipotesis: "x" },
    { titulo: "Cuánto sale traer 10 auriculares", formato: "producto", gancho: "10 auriculares puestos en rosario", guion: ["a", "b"], cta: "al 805", por_que: "pedido 2 veces por WhatsApp", producto: "auriculares", hipotesis: "número en el gancho" },
  ] };
  if (p.includes('"aprendimos"')) return { aprendimos: ["el alcance subió 100%", "la historia rindió 51 mil", "los reels de prueba quedan en 1.000"], foco: "grabar 2 historias" };
  if (p.includes('"respuesta"')) return { respuesta: "Hoy grabá la historia del revendedor. @juan_revende te espera por DM." };
  return null;
};
const req = (r, b) => new Request("https://x/panel/api/redes/" + r, b ? { method: "POST", body: JSON.stringify(b) } : {});
const api = async (r, b) => (await R.apiRedes(env, req(r, b), new URL("https://x/panel/api/redes/" + r), "manuel", iaJSON, "https://panel")).json();

const res = await api("resumen");
chk("resumen: KPIs de la cuenta", res.kpis.alcance7 === 2000 && res.kpis.alcance7_cambio === 100 && res.kpis.seguidores7 === 33 + 34 + 35 + 36 + 37 + 38 + 39);
chk("resumen: DMs pendientes", res.kpis.dms_pendientes === 2 && res.dms_error === "");
chk("resumen: formatos ordenados por mediana", res.formatos.length > 0 && res.formatos[0].alcance_mediano >= res.formatos.at(-1).alcance_mediano);
const gi = await api("generar-ideas", {});
chk("ideas: guarda 2 y filtra la prohibida", gi.ok && gi.cantidad === 2 && fila("SELECT COUNT(*) n FROM ig_ideas WHERE titulo LIKE '%Vapes%'").n === 0);
const pi = prompts.at(-1);
chk("ideas: el prompt cruza WhatsApp, DMs y formatos", pi.includes("auriculares A9 Pro (2)") && pi.includes("sigo esperando") && pi.includes("Historia de cliente a cámara") && pi.includes("[precio real]"));
const li = await api("ideas?estado=nueva");
chk("ideas: lista con guion", li.length === 2 && Array.isArray(li[0].guion) && li[0].guion.length >= 2);
await api("idea-estado", { id: li[0].id, estado: "grabada" });
chk("ideas: marcar grabada", (await api("ideas?estado=grabada")).length === 1 && (await api("ideas?estado=nueva")).length === 1);
chk("ideas: estado inválido rechazado", !!(await api("idea-estado", { id: li[0].id, estado: "x" })).error);
await api("generar-ideas", {});
chk("ideas: el prompt recuerda las ideas previas", prompts.at(-1).includes("El revendedor de Córdoba") && prompts.at(-1).includes("(grabada)"));
iaResp = { nada: 1 }; chk("ideas: IA caída → error claro", !(await api("generar-ideas", {})).ok); iaResp = null;
const dm = await api("dms");
chk("dms: lista pendientes", dm.dms.length === 2 && dm.dms.some((x) => x.usuario === "juan_revende"));
const rl = await api("reels?dias=30");
chk("reels: últimos 30 días", rl.length >= 29 && rl.length <= 31);
await api("post-formato", { id: "p2", formato: "historia" });
chk("reels: corregir formato", fila("SELECT formato FROM ig_posts WHERE id='p2'").formato === "historia");
chk("reels: formato inválido rechazado", !!(await api("post-formato", { id: "p2", formato: "cualquiera" })).error);
tg.length = 0;
const rep = await api("reporte", { telegram: true });
chk("reporte: texto con números y aprendizajes", rep.ok && rep.texto.includes("Alcance 7 días: 2.000") && rep.texto.includes("+100%") && rep.texto.includes("la historia rindió"));
chk("reporte: va por Telegram con link al panel", tg.length === 1);
chk("reporte: queda guardado", (await api("reportes")).length === 1 && (await api("resumen")).reporte.texto === rep.texto);
const pr = await api("preguntar", { pregunta: "¿qué grabo hoy?", historial: [{ r: "u", t: "hola" }] });
chk("agente responde", pr.respuesta.includes("juan_revende"));
chk("agente recibe DMs, ideas y reporte", prompts.at(-1).includes("@juan_revende") && prompts.at(-1).includes("IDEAS GUARDADAS") && prompts.at(-1).includes("Qué aprendimos"));
chk("actualizar sin binding: error claro", /binding IG/.test((await api("actualizar", {})).error));
let llamadoIG = "";
env.IG = { fetch: async (rq) => { llamadoIG = rq.url; return new Response(JSON.stringify({ ok: true, charlas: 3 })); } };
const ac = await api("actualizar", { todo: true });
chk("actualizar llama al worker de Instagram con la clave", ac.ok && llamadoIG === "https://instagram/sync?clave=k");
chk("ruta desconocida", (await R.apiRedes(env, req("nada"), new URL("https://x/panel/api/redes/nada"), "m", iaJSON)).status === 404);

// 7) Cron del lunes 9:05 (una sola vez por semana)
const lunes = Date.UTC(2026, 9, 12, 12, 5);   // lunes 12/10 9:05 Argentina
chk("cron: no corre otro día", (await R.cronRedes(env, iaJSON, lunes + DIA)) === false);
chk("cron: corre el lunes 9:05", (await R.cronRedes(env, iaJSON, lunes)) === true);
chk("cron: no repite", (await R.cronRedes(env, iaJSON, lunes)) === false);

// 8) Pantalla
const sc = R.PANEL_REDES.match(/<script>([\s\S]*)<\/script>/)[1];
try { new Function(sc); chk("js de la pantalla compila", true); } catch (e) { chk("js: " + e.message, false); }
chk("pantalla tiene las 5 secciones", ["m-resumen", "m-ideas", "m-dms", "m-reels", "m-agente"].every((x) => R.PANEL_REDES.includes('id="' + x + '"')));
const wk = fs.readFileSync(`${dir}/co/worker.js`, "utf8");
chk("panel principal tiene la pestaña Redes", wk.includes('href="/panel/redes"') && wk.includes('url.pathname === "/panel/redes"'));
chk("binding IG en wrangler", fs.readFileSync(new URL("../cotizador/wrangler.jsonc", import.meta.url), "utf8").includes('"binding": "IG", "service": "instagram"'));

// 9) Worker de Instagram: el cron de cada 2 horas sincroniza aunque el agente de comentarios esté pausado
const db2 = new DatabaseSync(":memory:");
const st2 = (sql, b = []) => ({ bind: (...x) => st2(sql, x), run: async () => { db2.prepare(sql).run(...b); return {}; }, first: async () => db2.prepare(sql).get(...b) ?? null, all: async () => ({ results: db2.prepare(sql).all(...b) }) });
const DB2 = { prepare: (s) => st2(s), batch: async (a) => { for (const x of a) await x.run(); } };
globalThis.fetch = async (u) => {
  const url = new URL(String(u));
  if (url.hostname === "graph.instagram.com" && url.pathname.includes("refresh_access_token")) return new Response("{}");
  if (url.hostname === "graph.instagram.com") {
    const ruta = url.pathname.replace("/v21.0", ""), p = Object.fromEntries(url.searchParams);
    try { return new Response(JSON.stringify(await igFake(ruta, "GET", p))); } catch (e) { return new Response(JSON.stringify({ error: { message: e.message } }), { status: 400 }); }
  }
  return new Response("{}");
};
const W = (await import(`${dir}/ig/instagram.js`)).default;
const env2 = { DB: DB2, IG_TOKEN: "tok_AAAAAAAAAAAAAA", VERIFY_TOKEN: "k" };
await DB2.prepare("CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT, exp INTEGER)").run();
await DB2.prepare("INSERT INTO kv (k,v) VALUES ('ig_pausa','si')").run();
const ctx = { w: [], waitUntil(p) { this.w.push(p); } };
await W.scheduled({ cron: "17 */2 * * *" }, env2, ctx); await Promise.all(ctx.w);
chk("cron de 2 h guarda publicaciones aunque esté pausado", db2.prepare("SELECT COUNT(*) n FROM ig_posts").get().n === 20);
ctx.w = [];
await W.scheduled({ cron: "*/30 * * * *" }, env2, ctx); await Promise.all(ctx.w);
chk("cron de 30 min trae DMs", db2.prepare("SELECT COUNT(*) n FROM ig_dms WHERE ult_yo=0").get().n === 2);
const sd = await (await W.fetch(new Request("https://x/sync-dms?clave=k"), env2)).json();
chk("ruta /sync-dms", sd.ok && sd.pendientes === 2);
chk("ruta /sync pide clave", (await W.fetch(new Request("https://x/sync"), env2)).status === 401);

console.log(`sim-ig-redes: ${ok} ok, ${mal} fallas`);
if (mal) process.exit(1);
