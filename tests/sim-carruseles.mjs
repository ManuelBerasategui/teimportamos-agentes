// Creador de carruseles: ideas, estructura (con cuentas en código), chat que aprende reglas, slides, aprobación a las 12 h,
// publicación en Instagram y limpieza. Correr desde cotizador/: node ../tests/sim-carruseles.mjs
import { DatabaseSync } from "node:sqlite";
import fs from "fs";
const dir = fs.mkdtempSync("/tmp/car-");
fs.mkdirSync(dir + "/co"); fs.mkdirSync(dir + "/ig");
for (const f of fs.readdirSync(new URL("../cotizador/src/", import.meta.url))) fs.copyFileSync(new URL("../cotizador/src/" + f, import.meta.url), `${dir}/co/${f}`);
for (const f of fs.readdirSync(new URL("../instagram/src/", import.meta.url))) fs.copyFileSync(new URL("../instagram/src/" + f, import.meta.url), `${dir}/ig/${f}`);
let ok = 0, mal = 0; const chk = (n, c) => { c ? ok++ : (mal++, console.log("FALLA:", n)); };
const db = new DatabaseSync(":memory:");
const stmt = (sql, b = []) => ({ bind: (...x) => stmt(sql, x), run: async () => { db.prepare(sql).run(...b); return {}; }, first: async () => db.prepare(sql).get(...b) ?? null, all: async () => ({ results: db.prepare(sql).all(...b) }) });
const DB = { prepare: (s) => stmt(s), batch: async (a) => { for (const x of a) await x.run(); } };
const fila = (sql, ...b) => db.prepare(sql).get(...b);
const objs = new Map();
const leer = async (body) => (body == null ? new Uint8Array() : body instanceof Uint8Array ? body : new Uint8Array(await new Response(body).arrayBuffer()));
const R2 = {
  async put(k, body, o = {}) { const d = await leer(body); objs.set(k, { d, size: d.length, httpMetadata: o.httpMetadata || {} }); },
  async head(k) { const o = objs.get(k); return o ? { size: o.size, httpMetadata: o.httpMetadata } : null; },
  async get(k) { const o = objs.get(k); return o ? { body: o.d, size: o.size, httpMetadata: o.httpMetadata } : null; },
  async delete(ks) { for (const k of [].concat(ks)) objs.delete(k); },
  async list({ prefix = "" } = {}) { return { objects: [...objs].filter(([k]) => k.startsWith(prefix)).map(([key, o]) => ({ key, size: o.size })), truncated: false }; },
};
globalThis.fetch = async (u) => { if (String(u).startsWith("https://cdn/perfil")) return new Response(new Uint8Array([9, 9, 9])); return new Response("{}"); };
const env = { DB, VIDEOS: R2, VERIFY_TOKEN: "k" };
db.exec("CREATE TABLE kv (k TEXT PRIMARY KEY, v TEXT, exp INTEGER)");
db.prepare("INSERT INTO kv (k,v) VALUES ('ig_yo', ?)").run(JSON.stringify({ username: "te.importamos.arg", foto: "https://cdn/perfil.jpg" }));
const C = await import(`${dir}/co/carruseles.js`);
const P = await import(`${dir}/ig/publicar.js`);
chk("esquema igual en los dos workers", JSON.stringify(C.ESQUEMA_CARR) === JSON.stringify(P.ESQUEMA_CARR));

// Cuentas en código
const d = C.calcularDatos({ precio_ml: 42585, costo: 20268, cantidad: 50 });
chk("cuentas: diferencia y total", d.diferencia === 22317 && d.total === 1115850);
chk("rellenar con formato argentino", C.rellenar("{diferencia} de diferencia · {total} en {cantidad}", d) === "$22.317 de diferencia · $1.115.850 en 50");
chk("rellenar avisa lo que falta", C.rellenar("sale {precio_ml}", {}) === "sale [precio ml]");
chk("datos: limpia '$42.585' a número", C.limpiarDatos({ precio_ml: "$42.585", costo: "20.268", cantidad: "50" }).precio_ml === 42585);
chk("slides: descarta tipos raros y recorta a 10", C.limpiarSlides([{ tipo: "x" }, ...Array(12).fill({ tipo: "texto", titulo: "a", parrafos: "b\nc" })]).length === 10 && C.limpiarSlides([{ tipo: "texto", titulo: "a", parrafos: "b\nc" }])[0].parrafos.length === 2);

// IA simulada
const prompts = []; let resp = {};
const ia = async (_e, p) => { prompts.push(p); return typeof resp === "function" ? resp(p) : resp; };
const T = { fleteKg: 18, handling: 30, honorarios: 80, factor: 1.3, aereoFijo: 950, aereoDesde: 50, aereoHasta: 250, barcoFijo: 100 };
const api = async (r, body, metodo, headers = {}) => {
  const init = { method: metodo || (body !== undefined ? "POST" : "GET"), headers };
  if (body !== undefined) init.body = body instanceof Uint8Array ? body : JSON.stringify(body);
  const res = await C.apiCarruseles(env, new Request("https://x/panel/api/carruseles/" + r, init), new URL("https://x/panel/api/carruseles/" + r), "manuel", ia, T);
  return res.headers.get("content-type")?.includes("json") ? res.json() : res;
};
resp = { ideas: [{ titulo: "Ventilador de mano: ML vs China", producto: "ventilador de mano", angulo: "comparacion_ml", por_que: "consultado 5 veces" }, { titulo: "Réplicas baratas", producto: "réplicas", angulo: "otro", por_que: "x" }, { titulo: "Auriculares A9", producto: "auriculares A9", angulo: "comparacion_ml", por_que: "x" }] };
const gi = await api("generar-ideas", {});
chk("ideas: guarda 2 y filtra la prohibida", gi.ok && gi.cantidad === 2);
chk("ideas: el prompt conoce el estilo ganador", prompts.at(-1).includes("EL ESTILO QUE MEJOR FUNCIONÓ"));
await api("generar-ideas", {});
chk("ideas: no repite productos", fila("SELECT COUNT(*) n FROM ig_carruseles").n === 2);
const lista = await api("lista");
const idA = lista.carruseles.find((c) => c.producto === "ventilador de mano").id;
chk("lista con usuario y tipos", lista.usuario === "te.importamos.arg" && lista.tipos.barras.campos.includes("a_valor"));

// Estructura
resp = { slides: [{ tipo: "portada", titulo: "En MercadoLibre sale {precio_ml}.", subtitulo: "¿Cuánto cuesta traerlo?" }, { tipo: "barras", titulo: "La diferencia", a_label: "Importado", a_valor: "{costo}", b_label: "En ML", b_valor: "{precio_ml}", conclusion: "{diferencia} por unidad" }, { tipo: "multiplicacion", arriba: "Multiplicalo.", linea: "{cantidad} × {diferencia}", numero: "{total}", abajo: "en un lote" }, { tipo: "cta", texto: "¿Querés saber?", palabra: "costo", abajo: "te lo cotizo" }], caption: "Comentá COSTO #importaciones" };
const e = await api("estructura", { id: idA });
chk("estructura armada", e.ok && e.estado === "estructura" && e.slides.length === 4 && e.chat.length === 1);
chk("estructura: el prompt trae el ejemplo ganador y prohíbe números", prompts.at(-1).includes("Traído de China, puesto en Argentina") && prompts.at(-1).includes("NUNCA escribas un precio con números"));
resp = { slides: [{ tipo: "texto", titulo: "Ganá millonarios", parrafos: ["x"] }, { tipo: "texto", titulo: "b" }, { tipo: "texto", titulo: "c" }] };
const idB = lista.carruseles.find((c) => c.producto !== "ventilador de mano").id;
chk("estructura con texto prohibido: rechazada", !(await api("estructura", { id: idB })).ok);

// Guardar datos y editar
const g = await api("guardar", { id: idA, datos: { producto: "ventilador", precio_ml: "42585", costo: "20268", cantidad: "50" } });
chk("guardar datos", g.ok && g.datos.precio_ml === 42585 && g.datos.cantidad === 50);

// Chat: cambia slides y aprende regla
resp = (p) => ({ respuesta: "Cambié el título del slide 1", slides: JSON.parse(p.match(/SLIDES ACTUALES \(numerados desde 1\): (\[.*?\])\n/)[1]).map((s, i) => (i === 0 ? { ...s, titulo: "Mirá cuánto sale en ML: {precio_ml}" } : s)), regla: "Siempre poner el precio de ML en el título de la portada", caption: null, datos: null });
const ch = await api("chat", { id: idA, mensaje: "siempre poné el precio de ML en el título de la portada" });
chk("chat: aplica el cambio", ch.ok && ch.slides[0].titulo.startsWith("Mirá cuánto") && ch.chat.at(-1).t.includes("Lo guardo"));
chk("chat: guarda la regla", JSON.parse(fila("SELECT v FROM kv WHERE k='ig_reglas_carrusel'").v).length === 1);
chk("chat: el prompt ve los datos calculados", prompts.at(-1).includes('"diferencia":22317'));
await api("estructura", { id: idB }).catch(() => {});
resp = { slides: [{ tipo: "texto", titulo: "a" }, { tipo: "texto", titulo: "b" }, { tipo: "texto", titulo: "c" }], caption: "" };
const eB = await api("estructura", { id: idB });
chk("las reglas aprendidas van a los próximos carruseles", eB.ok && prompts.at(-1).includes("Siempre poner el precio de ML en el título"));
chk("borrar regla", (await api("regla-borrar", { i: 0 })).reglas.length === 0);

// Fase slides, fotos e imágenes
chk("no aprueba en fase estructura", !!(await api("aprobar", { id: idA })).error);
const f = await api("fase", { id: idA, a: "slides" });
chk("confirmar estructura → slides", f.ok && f.estado === "slides");
chk("foto: rechaza no imagen", !!(await api(`foto?id=${idA}&n=0`, new Uint8Array([1]), "PUT", { "content-type": "text/plain" })).error);
const ft = await api(`foto?id=${idA}&n=0`, new Uint8Array([1, 2, 3]), "PUT", { "content-type": "image/png", "content-length": "3" });
chk("foto: guardada para el slide 1", ft.ok && ft.key === `carruseles/${idA}/foto-0.png` && JSON.parse(fila("SELECT datos FROM ig_carruseles WHERE id=?", idA).datos).fotos["0"] === ft.key);
chk("img: sirve la foto", (await api("img?key=" + encodeURIComponent(ft.key))).status === 200);
chk("img: no sirve claves ajenas", (await api("img?key=" + encodeURIComponent("lotes/x/0.mp4"))).status === 400);
chk("logo: baja y guarda la foto de perfil", (await api("logo")).status === 200 && objs.has("marca/perfil.jpg"));
chk("aprobar sin las imágenes: error claro", /slide 1/.test((await api("aprobar", { id: idA })).error));
for (let i = 0; i < 4; i++) await api(`slide?id=${idA}&n=${i}`, new Uint8Array([255, 216, i]), "PUT", { "content-length": "3" });
db.prepare("UPDATE ig_carruseles SET datos=? WHERE id=?").run(JSON.stringify({ producto: "v", precio_ml: 42585, fotos: { 0: ft.key } }), idA);
chk("aprobar sin el costo: error claro", /costo/.test((await api("aprobar", { id: idA })).error));
db.prepare("UPDATE ig_carruseles SET datos=? WHERE id=?").run(JSON.stringify({ producto: "v", precio_ml: 42585, costo: 20268, cantidad: 50, fotos: {} }), idA);
chk("aprobar sin la foto de portada: error claro", /foto del slide 1/.test((await api("aprobar", { id: idA })).error));
db.prepare("UPDATE ig_carruseles SET datos=? WHERE id=?").run(JSON.stringify({ producto: "v", precio_ml: 42585, costo: 20268, cantidad: 50, fotos: { 0: ft.key } }), idA);
const ap = await api("aprobar", { id: idA, caption: "Comentá COSTO" });
const h = new Date(ap.programado_ts - 3 * 3600e3);
chk("aprobado sale a las 12 h", ap.ok && h.getUTCHours() === 12 && fila("SELECT n_slides, estado FROM ig_carruseles WHERE id=?", idA).n_slides === 4);
chk("no se edita aprobado", !!(await api("guardar", { id: idA, caption: "x" })).error);
const otro = await C.proximoHorarioCarr(env);
chk("el siguiente va otro día", otro - ap.programado_ts === 86400e3);

// Publicación
const llam = []; let st = "IN_PROGRESS";
const ig = async (ruta, metodo, p = {}) => { llam.push([ruta, metodo, p]); if (ruta === "/me/media" && p.is_carousel_item) return { id: "hijo" + llam.length }; if (ruta === "/me/media") return { id: "CAR1" }; if (ruta === "/CAR1") return { status_code: st }; if (ruta === "/me/media_publish") return { id: "MED1" }; if (ruta === "/MED1") return { permalink: "https://instagram.com/p/XYZ/" }; throw new Error(ruta); };
db.prepare("UPDATE ig_carruseles SET programado_ts=? WHERE id=?").run(Date.now() + 3600e3, idA);
chk("antes de hora no publica", (await P.publicarCarruseles(env, ig)).length === 0 && !llam.length);
db.prepare("UPDATE ig_carruseles SET programado_ts=? WHERE id=?").run(Date.now() - 1000, idA);
await P.publicarCarruseles(env, ig);
const tok = fila("SELECT token FROM ig_carruseles WHERE id=?", idA).token;
const hijos = llam.filter((x) => x[2].is_carousel_item);
chk("crea un contenedor por slide con link temporal", hijos.length === 4 && hijos[2][2].image_url.endsWith(`/c/${tok}/2.jpg`));
const car = llam.find((x) => x[2].media_type === "CAROUSEL");
chk("crea el carrusel con los hijos y el copy", car && car[2].children.split(",").length === 4 && car[2].caption === "Comentá COSTO");
chk("Instagram puede bajar el slide", (await P.servirSlide(env, tok, 2)).status === 200 && (await P.servirSlide(env, tok, 9)).status === 404);
st = "FINISHED"; await P.publicarCarruseles(env, ig);
const pub = fila("SELECT estado, link, token FROM ig_carruseles WHERE id=?", idA);
chk("publicado con link y sin token", pub.estado === "publicado" && pub.link.includes("/p/XYZ") && pub.token === null);
chk("el link temporal deja de andar", (await P.servirSlide(env, tok, 0)).status === 404);

// Limpieza
db.prepare("UPDATE ig_carruseles SET publicado_ts=? WHERE id=?").run(Date.now() - 4 * 86400e3, idA);
await C.limpiezaCarr(env);
chk("borra las imágenes 3 días después de publicar", ![...objs.keys()].some((k) => k.startsWith(`carruseles/${idA}/`)) && fila("SELECT borrado FROM ig_carruseles WHERE id=?", idA).borrado === 1);
await api(`foto?id=${idB}&n=0`, new Uint8Array([1]), "PUT", { "content-type": "image/jpeg", "content-length": "1" });
await api("descartar", { id: idB });
chk("descartar borra las imágenes", ![...objs.keys()].some((k) => k.startsWith(`carruseles/${idB}/`)));
chk("cron de limpieza solo 4:12", (await C.cronCarr(env, Date.UTC(2026, 9, 10, 15, 0))) === false && (await C.cronCarr(env, Date.UTC(2026, 9, 10, 7, 12))) === true);

// Pantalla y conexiones
const R = await import(`${dir}/co/redes.js`);
const sc = R.PANEL_REDES.match(/<script>([\s\S]*)<\/script>/)[1];
try { new Function(sc); chk("js de Redes compila con carruseles", true); } catch (er) { chk("js: " + er.message, false); }
chk("Redes tiene la pestaña Carruseles y la tipografía", R.PANEL_REDES.includes('id="m-carr"') && R.PANEL_REDES.includes('data-m="carr"') && R.PANEL_REDES.includes("Patrick+Hand"));
const wk = fs.readFileSync(`${dir}/co/worker.js`, "utf8"), ins = fs.readFileSync(`${dir}/ig/instagram.js`, "utf8");
chk("panel monta la API y la limpieza", wk.includes('startsWith("/panel/api/carruseles/")') && wk.includes("cronCarr("));
chk("instagram publica carruseles y sirve /c/", ins.includes("publicarCarruseles(") && ins.includes("servirSlide("));
console.log(`sim-carruseles: ${ok} ok, ${mal} fallas`);
if (mal) process.exit(1);
