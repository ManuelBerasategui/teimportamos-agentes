// Creador de videos: subida al panel, tope de espacio, editor de GitHub, revisión, aprobación, publicación a las 19 h y limpieza.
// Correr desde cotizador/: node ../tests/sim-videos.mjs
import { DatabaseSync } from "node:sqlite";
import fs from "fs";
const dir = fs.mkdtempSync("/tmp/vid-");
fs.mkdirSync(dir + "/co"); fs.mkdirSync(dir + "/ig");
for (const f of fs.readdirSync(new URL("../cotizador/src/", import.meta.url))) fs.copyFileSync(new URL("../cotizador/src/" + f, import.meta.url), `${dir}/co/${f}`);
for (const f of fs.readdirSync(new URL("../instagram/src/", import.meta.url))) fs.copyFileSync(new URL("../instagram/src/" + f, import.meta.url), `${dir}/ig/${f}`);
let ok = 0, mal = 0; const chk = (n, c) => { c ? ok++ : (mal++, console.log("FALLA:", n)); };

const db = new DatabaseSync(":memory:");
const stmt = (sql, b = []) => ({ bind: (...x) => stmt(sql, x), run: async () => { db.prepare(sql).run(...b); return {}; }, first: async () => db.prepare(sql).get(...b) ?? null, all: async () => ({ results: db.prepare(sql).all(...b) }) });
const DB = { prepare: (s) => stmt(s), batch: async (a) => { for (const x of a) await x.run(); } };
const fila = (sql, ...b) => db.prepare(sql).get(...b);

// ---------- R2 simulado ----------
const objs = new Map(), multis = new Map();
const leer = async (body) => (body == null ? new Uint8Array() : body instanceof Uint8Array ? body : new Uint8Array(await new Response(body).arrayBuffer()));
const R2 = {
  async put(k, body, o = {}) { const d = await leer(body); objs.set(k, { d, size: d.length, httpMetadata: o.httpMetadata || {} }); return {}; },
  async head(k) { const o = objs.get(k); return o ? { size: o.size, httpMetadata: o.httpMetadata } : null; },
  async get(k, o = {}) { const x = objs.get(k); if (!x) return null; const d = o.range ? x.d.slice(o.range.offset, o.range.offset + o.range.length) : x.d; return { body: d, size: x.size, httpMetadata: x.httpMetadata }; },
  async delete(ks) { for (const k of [].concat(ks)) objs.delete(k); },
  async list({ cursor } = {}) { const t = [...objs.entries()].map(([key, o]) => ({ key, size: o.size })); const i = +(cursor || 0); return { objects: t.slice(i, i + 1000), truncated: i + 1000 < t.length, cursor: String(i + 1000) }; },
  async createMultipartUpload(k, o = {}) { const id = "up" + Math.random(); multis.set(id, { k, partes: new Map(), meta: o.httpMetadata }); return { uploadId: id }; },
  resumeMultipartUpload(k, id) { const m = multis.get(id); return {
    async uploadPart(n, body) { const d = await leer(body); m.partes.set(n, d); return { partNumber: n, etag: "e" + n }; },
    async complete(ps) { const d = new Uint8Array(ps.reduce((s, p) => s + m.partes.get(p.partNumber).length, 0)); let o = 0; for (const p of ps) { d.set(m.partes.get(p.partNumber), o); o += m.partes.get(p.partNumber).length; } objs.set(k, { d, size: d.length, httpMetadata: m.meta || {} }); multis.delete(id); },
    async abort() { multis.delete(id); } }; },
};
const tg = [];
globalThis.fetch = async (u) => { if (String(u).includes("telegram")) tg.push(String(u)); return new Response("{}"); };
const env = { DB, VIDEOS: R2, VERIFY_TOKEN: "k", TELEGRAM_TOKEN: "t", TELEGRAM_CHAT: "1" };
db.exec("CREATE TABLE kv (k TEXT PRIMARY KEY, v TEXT, exp INTEGER)");

const V = await import(`${dir}/co/videos.js`);
const P = await import(`${dir}/ig/publicar.js`);
chk("esquema igual en los dos workers", JSON.stringify(V.ESQUEMA_VIDEOS) === JSON.stringify(P.ESQUEMA_VIDEOS));
let iaResp = null;
const iaJSON = async (_e, p) => iaResp !== null ? iaResp : { clips: [{ n: 2, mantener: [1, 2] }], videos: [{ j: 0, texto: "me escribió un flaco", caption: "Un cliente armó su cupo.\nEscribime al DM\n#importaciones" }, { j: 1, texto: "nadie te cuenta esto", caption: "Otro gancho.\n#pormayor" }] };
const panel = async (r, body, metodo, headers = {}) => {
  const init = { method: metodo || (body !== undefined ? "POST" : "GET"), headers };
  if (body !== undefined) init.body = body instanceof Uint8Array ? body : JSON.stringify(body);
  const res = await V.apiVideos(env, new Request("https://x/panel/api/videos/" + r, init), new URL("https://x/panel/api/videos/" + r), "manuel");
  return res.headers.get("content-type")?.includes("json") ? res.json() : res;
};
const editor = async (r, body, metodo, clave = "k") => {
  const init = { method: metodo || (body !== undefined ? "POST" : "GET"), headers: { "x-clave": clave } };
  if (body !== undefined) { init.body = body instanceof Uint8Array ? body : JSON.stringify(body); if (body instanceof Uint8Array) init.headers["content-length"] = String(body.length); }
  const res = await V.rutaVideosEditor(env, new Request("https://x/videos/" + r, init), new URL("https://x/videos/" + r), iaJSON, "https://panel");
  return res.headers.get("content-type")?.includes("json") ? res.json() : res;
};
const MB = 1024 ** 2;

// 1) Tope de espacio
await R2.put("relleno/viejo.mp4", new Uint8Array(10));
objs.get("relleno/viejo.mp4").size = 7.9 * 1024 ** 3;   // simula 7,9 GB guardados
const lleno = await panel("lote-nuevo", { clips: [{ nombre: "a.mp4", tipo: "completo", bytes: 300 * MB }] });
chk("no deja subir si pasaría de 8 GB", !lleno.lote && /No hay lugar/.test(lleno.error));
objs.delete("relleno/viejo.mp4");
chk("clip de más de 1 GB rechazado", !!(await panel("lote-nuevo", { clips: [{ nombre: "x.mp4", tipo: "completo", bytes: 1.5 * 1024 ** 3 }] })).error);
chk("más de 12 clips rechazado", !!(await panel("lote-nuevo", { clips: Array.from({ length: 13 }, () => ({ nombre: "x.mp4", bytes: 10 })) })).error);

// 2) Subida: un clip chico (directo) y uno en partes
const g1 = new Uint8Array(1000).fill(1), g2 = new Uint8Array(900).fill(2), cuerpo = new Uint8Array(2500).fill(3);
const ln = await panel("lote-nuevo", { clips: [{ nombre: "gancho1.mp4", tipo: "gancho", bytes: g1.length }, { nombre: "gancho2.mov", tipo: "gancho", bytes: g2.length }, { nombre: "cuerpo.mp4", tipo: "cuerpo", bytes: cuerpo.length }] });
chk("lote creado con 3 clips", ln.lote && ln.clips.length === 3 && ln.clips[1].key.endsWith(".mov"));
const L = ln.lote;
chk("espacio reservado mientras sube", (await panel("estado")).usado >= 4400);
await panel(`subir-simple?lote=${L}&n=0`, g1, "PUT", { "content-length": "1000" });
await panel(`subir-simple?lote=${L}&n=1`, g2, "PUT", { "content-length": "900" });
chk("lote no queda listo si falta un clip", !!(await panel("lote-listo", { lote: L })).error);
const ini = await panel(`subir-inicio?lote=${L}&n=2`, {});
const p1 = await panel(`subir-parte?lote=${L}&n=2&parte=1`, cuerpo.slice(0, 1500), "PUT");
const p2 = await panel(`subir-parte?lote=${L}&n=2&parte=2`, cuerpo.slice(1500), "PUT");
await panel(`subir-fin?lote=${L}&n=2`, { partes: [p1, p2] });
chk("subida en partes arma el archivo completo", ini.uploadId && objs.get(ln.clips[2].key).size === 2500 && objs.get(ln.clips[2].key).d[2499] === 3);
const gh = [];
globalThis.fetch = async (u, o = {}) => { if (String(u).includes("telegram")) tg.push(String(u)); if (String(u).includes("api.github.com")) { gh.push([String(u), o.headers?.Authorization, o.body]); return new Response(null, { status: 204 }); } return new Response("{}"); };
env.GH_TOKEN = "ghp_prueba";
const listo = await panel("lote-listo", { lote: L });
chk("lote listo para editar", listo.ok && fila("SELECT estado FROM ig_lotes WHERE id=?", L).estado === "en_cola");
chk("despierta al editor de GitHub al toque", listo.editor === "ya" && gh.length === 1 && gh[0][0].endsWith("/actions/workflows/videos.yml/dispatches") && gh[0][1] === "Bearer ghp_prueba" && JSON.parse(gh[0][2]).ref === "main");
delete env.GH_TOKEN;
chk("no se puede subir más a un lote listo", !!(await panel(`subir-simple?lote=${L}&n=0`, g1, "PUT")).error);

// 3) Editor de GitHub
chk("editor sin clave: 401", (await V.rutaVideosEditor(env, new Request("https://x/videos/hay"), new URL("https://x/videos/hay"), iaJSON)).status === 401);
chk("editor ve 1 lote en cola", (await editor("hay")).n === 1);
const tr = await editor("trabajo", {});
chk("editor toma el lote", tr.lote === L && tr.clips.length === 3 && fila("SELECT estado FROM ig_lotes WHERE id=?", L).estado === "procesando");
chk("no lo toma dos veces", !(await editor("trabajo", {})).lote);
const arch = await editor(tr.clips[2].url.replace("/videos/", "").replace(/^/, ""));
chk("editor baja el clip", (await arch.arrayBuffer()).byteLength === 2500);
chk("editor no puede bajar otra cosa", (await editor("archivo?key=" + encodeURIComponent("final/x.mp4"))).error);
const dec = await editor("decidir", { lote: L, clips: [{ n: 0, tipo: "gancho", frases: [{ i: 0, texto: "me escribió un flaco" }] }, { n: 1, tipo: "gancho", frases: [{ i: 0, texto: "nadie te cuenta esto" }] }, { n: 2, tipo: "cuerpo", frases: [{ i: 0, texto: "quería traer veinte" }, { i: 1, texto: "quería traer veinte camisetas" }, { i: 2, texto: "escribime al dm" }] }] });
chk("2 ganchos × 1 cuerpo = 2 videos", dec.videos.length === 2 && dec.videos[0].partes.join() === "0,2" && dec.videos[1].partes.join() === "1,2");
chk("saca la toma repetida", dec.clips.find((c) => c.n === 2).mantener.join() === "1,2" && dec.clips.find((c) => c.n === 0).mantener.join() === "0");
chk("caption con CTA", /DM/.test(dec.videos[0].caption));
iaResp = null; const d0 = iaResp;
iaResp = { videos: [{ j: 0, texto: "réplicas baratas", caption: "réplicas de zapatillas" }] };
const decMal = await editor("decidir", { lote: L, clips: [{ n: 0, tipo: "completo", frases: [{ i: 0, texto: "Hola cómo andan hoy les cuento algo" }] }] });
chk("texto prohibido se reemplaza", !/r[eé]plica/i.test(decMal.videos[0].texto + decMal.videos[0].caption) && /805/.test(decMal.videos[0].caption));
iaResp = { nada: 1 };
const decCaida = await editor("decidir", { lote: L, clips: [{ n: 0, tipo: "completo", frases: [{ i: 0, texto: "Hola" }, { i: 1, texto: "chau" }] }] });
chk("IA caída: deja todo y arma texto", decCaida.clips[0].mantener.join() === "0,1" && decCaida.videos[0].texto === "hola chau");
iaResp = d0;
chk("combinaciones con tope de 6", V.combinaciones([0, 1, 2, 3].map((n) => ({ n, tipo: "gancho" })).concat([4, 5].map((n) => ({ n, tipo: "cuerpo" })))).length === 6);
const mp4 = new Uint8Array(3000).fill(7), jpg = new Uint8Array(200).fill(8);
const k0 = (await editor(`resultado?lote=${L}&j=0&tipo=mp4`, mp4, "PUT")).key, kp0 = (await editor(`resultado?lote=${L}&j=0&tipo=jpg`, jpg, "PUT")).key;
const k1 = (await editor(`resultado?lote=${L}&j=1&tipo=mp4`, mp4, "PUT")).key;
chk("resultados guardados", k0 === `final/${L}-0.mp4` && kp0 === `final/${L}-0.jpg` && objs.has(k1));
tg.length = 0;
const fin = await editor("fin", { lote: L, videos: [{ key: k0, portada: kp0, bytes: 3000, duracion: 21.4, texto: "me escribió un flaco", caption: "c0", transcripcion: "..." }, { key: k1, bytes: 3000, duracion: 20, texto: "nadie te cuenta esto", caption: "c1" }, { key: "otra/cosa.mp4" }] });
chk("fin: 2 videos para revisar (ignora claves ajenas)", fin.videos === 2 && fila("SELECT COUNT(*) n FROM ig_videos WHERE estado='revision'").n === 2);
chk("fin: borra los clips crudos", ![...objs.keys()].some((k) => k.startsWith("lotes/")) && fila("SELECT estado, bytes FROM ig_lotes WHERE id=?", L).estado === "hecho");
chk("fin: aviso por Telegram", tg.length === 1);

// 4) Errores del editor: reintenta 3 veces
const l2 = (await panel("lote-nuevo", { clips: [{ nombre: "z.mp4", tipo: "completo", bytes: 10 }] })).lote;
await panel(`subir-simple?lote=${l2}&n=0`, new Uint8Array(10), "PUT"); await panel("lote-listo", { lote: l2 });
for (let i = 0; i < 3; i++) { await editor("trabajo", {}); await editor("error", { lote: l2, error: "ffmpeg falló" }); }
chk("tras 3 errores queda en error y NO borra el clip", fila("SELECT estado FROM ig_lotes WHERE id=?", l2).estado === "error" && [...objs.keys()].some((k) => k.startsWith("lotes/" + l2)));
const re = await panel("lote-reintentar", { lote: l2 });
chk("reintentar vuelve a la cola", re.ok && fila("SELECT estado, intentos FROM ig_lotes WHERE id=?", l2).estado === "en_cola" && fila("SELECT intentos FROM ig_lotes WHERE id=?", l2).intentos === 0);
chk("no se reintenta un lote que no tiene error", !!(await panel("lote-reintentar", { lote: l2 })).error);
for (let i = 0; i < 3; i++) { await editor("trabajo", {}); await editor("error", { lote: l2, error: "ffmpeg falló" }); }
db.prepare("UPDATE ig_lotes SET ts=? WHERE id=?").run(Date.now() - 8 * 86400e3, l2);

// 5) Revisión, aprobación y horarios (19 h, uno por día)
const est = await panel("estado");
const [va, vb] = est.videos.filter((v) => v.estado === "revision").sort((a, b) => a.texto.localeCompare(b.texto));
const ver = await panel(`ver?id=${va.id}`, undefined, "GET", { range: "bytes=0-99" });
chk("vista previa con rango (para el celular)", ver.status === 206 && ver.headers.get("content-range") === "bytes 0-99/3000");
chk("descargar para TikTok", (await panel(`bajar?id=${va.id}`)).headers.get("content-disposition").includes("attachment"));
const ap1 = await panel("aprobar", { id: va.id, caption: "Texto editado\nEscribime al DM" });
const ap2 = await panel("aprobar", { id: vb.id });
const h1 = new Date(ap1.programado_ts - 3 * 3600e3), h2 = new Date(ap2.programado_ts - 3 * 3600e3);
chk("aprobado sale a las 19 h", h1.getUTCHours() === 19 && h1.getUTCMinutes() === 0 && fila("SELECT caption FROM ig_videos WHERE id=?", va.id).caption.startsWith("Texto editado"));
chk("el segundo sale al día siguiente", ap2.programado_ts - ap1.programado_ts === 86400e3 && h2.getUTCHours() === 19);
const tarde = Date.UTC(2026, 9, 9, 22, 0);   // 19:00 Argentina
const sigTarde = await V.proximoHorario(env, tarde);
chk("aprobado después de las 18:45 pasa a otro día", new Date(sigTarde - 3 * 3600e3).getUTCHours() === 19 && sigTarde > tarde);
chk("no se aprueba dos veces", !!(await panel("aprobar", { id: va.id })).error);
await panel("desaprobar", { id: vb.id });
chk("frenar un programado vuelve a revisión", fila("SELECT estado FROM ig_videos WHERE id=?", vb.id).estado === "revision");
await panel("descartar", { id: vb.id });
chk("descartar borra el archivo", fila("SELECT estado FROM ig_videos WHERE id=?", vb.id).estado === "descartado" && !objs.has(k1));

// 6) Publicación (worker de Instagram)
const llamadas = []; let estadoCont = "IN_PROGRESS", sinPermiso = false;
const ig = async (ruta, metodo, p = {}) => {
  llamadas.push([ruta, metodo, p]);
  if (ruta === "/me/media" && metodo === "POST") { if (sinPermiso) throw new Error("Instagram /me/media: (#10) Application does not have permission"); return { id: "CONT1" }; }
  if (ruta === "/CONT1") return { status_code: estadoCont };
  if (ruta === "/me/media_publish") return { id: "MEDIA1" };
  if (ruta === "/MEDIA1") return { permalink: "https://instagram.com/reel/ABC/" };
  throw new Error("ruta " + ruta);
};
const opt = { esperas: 1, pausaMs: 0 };
db.prepare("INSERT INTO ig_videos (id, ts, clave, estado, caption, borrado) VALUES ('sinaprobar', 1, 'final/x.mp4', 'revision', 'x', 0)").run();
db.prepare("UPDATE ig_videos SET programado_ts=? WHERE id=?").run(Date.now() + 3600e3, va.id);
chk("antes de la hora no publica", (await P.publicarPendientes(env, ig, opt)).length === 0 && !llamadas.length);
db.prepare("UPDATE ig_videos SET programado_ts=? WHERE id=?").run(Date.now() - 60e3, va.id);
const r1 = await P.publicarPendientes(env, ig, opt);
const crear = llamadas.find((x) => x[0] === "/me/media");
const tok = fila("SELECT token FROM ig_videos WHERE id=?", va.id).token;
chk("crea reel de prueba con link temporal", r1[0].estado === "procesando" && crear[2].media_type === "REELS" && JSON.parse(crear[2].trial_params).graduation_strategy === "SS_PERFORMANCE" && crear[2].video_url.endsWith(`/v/${tok}.mp4`) && crear[2].caption.startsWith("Texto editado"));
const vid = await P.servirParaInstagram(env, new Request("https://ig/v/" + tok + ".mp4"), tok);
chk("Instagram puede bajar el video del link temporal", vid.status === 200 && (await vid.arrayBuffer()).byteLength === 3000);
chk("link con token falso: 404", (await P.servirParaInstagram(env, new Request("https://ig/v/x"), "0".repeat(48))).status === 404);
estadoCont = "FINISHED";
const r2 = await P.publicarPendientes(env, ig, opt);
const pub = fila("SELECT estado, link, token, media_id FROM ig_videos WHERE id=?", va.id);
chk("publica cuando Instagram termina", r2[0].estado === "publicado" && pub.estado === "publicado" && pub.link.includes("/reel/ABC") && pub.token === null);
chk("después de publicar el link temporal deja de andar", (await P.servirParaInstagram(env, new Request("https://ig/v/" + tok + ".mp4"), tok)).status === 404);
chk("nunca publica uno sin aprobar", fila("SELECT estado FROM ig_videos WHERE id='sinaprobar'").estado === "revision" && !llamadas.some((x) => x[0] === "/me/media" && x[2].caption === "x"));
// sin permiso de publicar
db.prepare("INSERT INTO ig_videos (id, ts, clave, estado, caption, programado_ts, borrado) VALUES ('v3', 1, 'final/y.mp4', 'aprobado', 'y', ?, 0)").run(Date.now() - 1000);
sinPermiso = true; const tareas = [];
await P.publicarPendientes(env, ig, { ...opt, crearTarea: async (_e, t) => tareas.push(t) });
chk("sin permiso: error claro y tarea en Pendientes", /instagram_business_content_publish/.test(fila("SELECT error FROM ig_videos WHERE id='v3'").error) && tareas.length === 1);

// 7) Limpieza
db.prepare("UPDATE ig_videos SET publicado_ts=? WHERE id=?").run(Date.now() - 4 * 86400e3, va.id);
db.prepare("INSERT INTO ig_lotes (id, ts, estado, clips, bytes) VALUES ('viejo', ?, 'subiendo', ?, 50)").run(Date.now() - 3 * 86400e3, JSON.stringify([{ n: 0, key: "lotes/viejo/0.mp4", subido: true }]));
await R2.put("lotes/viejo/0.mp4", new Uint8Array(50));
const lim = await V.limpiezaVideos(env);
chk("borra el video publicado hace más de 3 días (queda el link)", !objs.has(k0) && !objs.has(kp0) && fila("SELECT borrado, link FROM ig_videos WHERE id=?", va.id).borrado === 1);
chk("lote con error de más de 7 días se borra", ![...objs.keys()].some((k) => k.startsWith("lotes/" + l2)));
chk("cancela subidas abandonadas", !objs.has("lotes/viejo/0.mp4") && fila("SELECT estado FROM ig_lotes WHERE id='viejo'").estado === "cancelado");
chk("recalcula el espacio real", lim.usado === [...objs.values()].reduce((s, o) => s + o.size, 0));
chk("cron de limpieza solo a las 4:10", (await V.cronVideos(env, Date.UTC(2026, 9, 10, 15, 0))) === false && (await V.cronVideos(env, Date.UTC(2026, 9, 10, 7, 10))) === true);

// 8) Pantalla y conexiones
const R = await import(`${dir}/co/redes.js`);
const sc = R.PANEL_REDES.match(/<script>([\s\S]*)<\/script>/)[1];
try { new Function(sc); chk("js de la pantalla compila", true); } catch (e) { chk("js: " + e.message, false); }
chk("pantalla tiene la sección Videos", R.PANEL_REDES.includes('id="m-videos"') && R.PANEL_REDES.includes("subir-parte"));
const wk = fs.readFileSync(`${dir}/co/worker.js`, "utf8"), ins = fs.readFileSync(`${dir}/ig/instagram.js`, "utf8");
chk("panel monta las rutas de videos", wk.includes('startsWith("/videos/")') && wk.includes('startsWith("/panel/api/videos/")') && wk.includes("cronVideos("));
chk("instagram publica en el cron y sirve /v/", ins.includes("publicarPendientes(") && ins.includes("servirParaInstagram("));
for (const w of ["cotizador", "instagram"]) chk(`bucket R2 en ${w}`, fs.readFileSync(new URL(`../${w}/wrangler.jsonc`, import.meta.url), "utf8").includes('"bucket_name": "teimportamos-videos"'));
const wf = fs.readFileSync(new URL("../.github/workflows/videos.yml", import.meta.url), "utf8");
chk("GitHub corre cada 10 min y usa el secret", wf.includes('cron: "*/10 * * * *"') && wf.includes("secrets.TI_CLAVE") && !/TI_CLAVE:\s*[a-z0-9]{8,}/i.test(wf.replace("${{ secrets.TI_CLAVE }}", "")));

console.log(`sim-videos: ${ok} ok, ${mal} fallas`);
if (mal) process.exit(1);
