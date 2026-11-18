// Cotizaciones por Telegram: link de Alibaba leído → cotización → aviso con botones → ✅ → la PC la manda → aviso de enviada.
// Correr desde cotizador/: node ../tests/sim-cotiz-tg.mjs
import { DatabaseSync } from "node:sqlite";
import fs from "fs";
let ok = 0, mal = 0; const chk = (n, c) => { c ? ok++ : (mal++, console.log("FALLA:", n)); };
const dir = fs.mkdtempSync("/tmp/ctg-");
for (const f of fs.readdirSync("src")) fs.copyFileSync("src/" + f, dir + "/" + f);
const db = new DatabaseSync(":memory:");
const stmt = (sql, b = []) => ({ bind: (...x) => stmt(sql, x), run: async () => { db.prepare(sql).run(...b); return {}; }, first: async () => db.prepare(sql).get(...b) ?? null, all: async () => ({ results: db.prepare(sql).all(...b) }) });
const tgs = [];
const env = { DB: { prepare: (s) => stmt(s), batch: async (a) => { for (const x of a) await x.run(); } }, TELEGRAM_TOKEN: "x", TELEGRAM_CHAT: "111", VERIFY_TOKEN: "secreto", __tg: tgs };
globalThis.fetch = async () => { throw new Error("sin red en la simulación"); };   // la config de la calculadora cae a los valores de la web por defecto
db.exec("CREATE TABLE kv (k TEXT PRIMARY KEY, v TEXT, exp INTEGER); CREATE TABLE w_conv (conv TEXT PRIMARY KEY, nombre TEXT); INSERT INTO w_conv VALUES ('5493410000001','Ana Pérez');");
db.exec("CREATE TABLE w_msg (id TEXT, conv TEXT, yo INT, texto TEXT, ts INT); CREATE INDEX w_msg_conv ON w_msg(conv, ts);");
const AC = await import(dir + "/autocot.js"), CT = await import(dir + "/cotiz-tg.js");
await AC.prepararAutocot(env);
const ahora = Date.now();
db.prepare("INSERT INTO w_msg VALUES ('m1','5493410000001',0,'hola quiero 100 de estos https://www.alibaba.com/product-detail/auriculares_1601234567890.html',?)").run(ahora - 60e3);
const datos = { nombre: "Auriculares inalámbricos", tramos: [{ desde: 2, precio: 5 }, { desde: 100, precio: 4.5 }], peso: 0.12, moq: 2, moneda: "USD" };
db.prepare("INSERT INTO ali_cola (clave, link, conv, ts, estado, intentos, datos, origen, cantidad) VALUES ('1601234567890','https://www.alibaba.com/product-detail/auriculares_1601234567890.html','5493410000001',?,'leido',0,?,'chat',0)").run(ahora - 60e3, JSON.stringify(datos));
const ia = async () => ({ cantidades: [100] });
const r1 = await AC.cotizarLinks(env, ia, "5493410000001");
chk("cotiza con la cantidad que dijo el cliente", r1.estado === "lista" && r1.total > 450);
const m1 = tgs.find((x) => x.metodo === "sendMessage");
chk("llega por Telegram al chat del dueño con el resumen", m1?.chat_id === "111" && m1.text.includes("Cotización lista para Ana Pérez (+5493410000001)") && m1.text.includes("100 x Auriculares"));
const kb = m1.reply_markup.inline_keyboard.flat(), pub = kb.find((b) => b.callback_data?.startsWith("cot:ok:")).callback_data.split(":")[2];
chk("botones: Mandala, No va, La mando yo, Ver y Corregir (lleva a la sección Cotizar del panel)", kb.map((b) => b.text).join("|") === "✅ Mandala|❌ No va|✏️ La mando yo|👀 Ver|📝 Corregir en el panel" && kb.at(-1).url === "https://cotizador.berasateguimanuel07.workers.dev/panel#cot");
const link = kb.find((b) => b.text === "👀 Ver").url;
chk("el mensaje para el cliente no tiene números y lleva el link firmado", m1.text.includes("Hola Ana! Ya tengo tu cotización de Auriculares inalámbricos") && link === `https://cotizador.berasateguimanuel07.workers.dev/q/${pub}/${await CT.firmaCot(env, pub)}`);
chk("La mando yo abre su WhatsApp con ese mensaje", kb.find((b) => b.text === "✏️ La mando yo").url.startsWith("https://wa.me/5493410000001?text=Hola%20Ana!"));
// página del cliente
const pg = await (await CT.paginaCotPublica(env, pub, await CT.firmaCot(env, pub))).text();
chk("la página muestra producto, puesto c/u y total", pg.includes("Auriculares inalámbricos") && pg.includes("Total puesto en Argentina") && pg.includes("Guardar en PDF") && pg.includes("Ana Pérez"));
chk("con la firma mal no se ve", (await CT.paginaCotPublica(env, pub, "0000000000000000")).status === 404);
// no repite el aviso si no cambió nada
const n0 = tgs.length; await AC.cotizarLinks(env, ia, "5493410000001");
chk("recalcular igual no repite el aviso", tgs.length === n0);
chk("sin aprobar, la PC no la manda", (await CT.enviosPendientes(env)).length === 0);
// ✅ Mandala
const cb = { id: "c1", data: "cot:ok:" + pub, message: { message_id: 7, chat: { id: 111 }, text: m1.text } };
await CT.botonCotizacion(env, cb, { "111": "Manuel" });
chk("el botón confirma y marca el mensaje", tgs.some((x) => x.metodo === "answerCallbackQuery" && /PC/.test(x.text)) && tgs.some((x) => x.metodo === "editMessageText" && x.text.endsWith("✅ Aprobada: la manda el agente de la PC (te aviso cuando salga).")));
const env2 = await CT.enviosPendientes(env);
chk("aprobada: la PC la recibe para mandar", env2.length === 1 && env2[0].conv === "5493410000001" && env2[0].texto.includes(link));
await CT.botonCotizacion(env, { ...cb, id: "c2", message: { ...cb.message, chat: { id: 999 } } }, { "111": "Manuel" });
chk("un chat que no es del panel no puede aprobar ni descartar", tgs.at(-1).text === "Este chat no está conectado al panel" || tgs.find((x) => x.callback_query_id === "c2")?.text === "Este chat no está conectado al panel");
// recalcular con el mismo total conserva la aprobación; con otro total, hay que volver a aprobar
await AC.cotizarLinks(env, ia, "5493410000001");
chk("recalcular igual conserva la aprobación", (await CT.enviosPendientes(env)).length === 1);
await AC.cotizarLinks(env, async () => ({ cantidades: [200] }), "5493410000001");
chk("si cambia el total, se anula y llega de nuevo para aprobar", (await CT.enviosPendientes(env)).length === 0 && tgs.filter((x) => x.metodo === "sendMessage" && x.text.includes("Cotización lista")).length === 2);
await CT.botonCotizacion(env, { ...cb, id: "c3" }, { "111": "Manuel" });
// la PC la mandó
const conv = await CT.resultadoEnvio(env, pub, true);
chk("enviada: avisa por Telegram y no se vuelve a mandar", conv === "5493410000001" && tgs.at(-1).text === "✅ Se mandó la cotización a Ana Pérez." && (await CT.enviosPendientes(env)).length === 0);
await CT.botonCotizacion(env, { ...cb, id: "c4" }, { "111": "Manuel" });
chk("aprobar una ya enviada no hace nada", tgs.find((x) => x.callback_query_id === "c4")?.text === "Esa cotización ya se mandó" && (await CT.enviosPendientes(env)).length === 0);
// falla en la PC → vuelve para mandar a mano
db.prepare("UPDATE autocot SET enviado_ts=NULL, aprobado_ts=? WHERE pub=?").run(Date.now(), pub);
await CT.resultadoEnvio(env, pub, false, "no abrió el chat");
chk("si la PC no pudo, avisa con el botón para mandarla vos", tgs.at(-1).text.includes("No pude mandarle la cotización a Ana Pérez (no abrió el chat)") && tgs.at(-1).reply_markup.inline_keyboard[0][0].url.startsWith("https://wa.me/5493410000001?text=") && (await CT.enviosPendientes(env)).length === 0);
// ❌ No va
await CT.botonCotizacion(env, { ...cb, id: "c5", data: "cot:no:" + pub }, { "111": "Manuel" });
const n1 = tgs.length; await AC.cotizarLinks(env, async () => ({ cantidades: [200] }), "5493410000001");
chk("descartada: recalcular no la revive ni la vuelve a avisar", tgs.length === n1 && db.prepare("SELECT estado FROM autocot WHERE pub=?").get(pub).estado === "descartada");
// falta un dato
db.prepare("INSERT INTO w_conv VALUES ('5493419999999','Beto')").run();
db.prepare("INSERT INTO ali_cola (clave, link, conv, ts, estado, intentos, datos, origen, cantidad) VALUES ('1609999999999','https://www.alibaba.com/product-detail/x_1609999999999.html','5493419999999',?,'leido',0,?,'chat',0)").run(ahora - 60e3, JSON.stringify({ nombre: "Lámpara", tramos: [{ desde: 1, precio: 3 }], peso: 0, moq: 1, moneda: "USD" }));
await AC.cotizarLinks(env, async () => ({ cantidades: [50] }), "5493419999999");
chk("si falta un dato, avisa qué falta con el botón para completarla", tgs.at(-1).text.includes("Cotización de Beto (+5493419999999): no la pude terminar") && tgs.at(-1).text.includes("peso por unidad de Lámpara") && tgs.at(-1).reply_markup.inline_keyboard[0][0].text === "📝 Completar en el panel");
// pegada a mano en el panel (sin cliente): no avisa
const n2 = tgs.length; db.prepare("INSERT INTO ali_cola (clave, link, conv, ts, estado, intentos, datos, origen, cantidad) VALUES ('1607777777777','https://www.alibaba.com/product-detail/y_1607777777777.html','',?,'leido',0,?,'panel',10)").run(ahora, JSON.stringify(datos));
await AC.cotizarLinks(env, ia, "", { soloClave: "1607777777777" });
chk("las pegadas a mano en el panel no avisan", tgs.length === n2);
// cableado
const W = fs.readFileSync("src/worker.js", "utf8"), A = fs.readFileSync("src/asistente.js", "utf8"), R = fs.readFileSync("src/autoresp.js", "utf8");
chk("worker sirve /q/ sin login, Telegram despacha cot: y la PC recibe envios", W.includes("paginaCotPublica(env, mq[1], mq[2])") && A.includes('/^cot:/.test(upd.callback_query.data') && R.includes("envios };") && R.includes('"/enviar/envio-hecho"') && R.includes('"/enviar/envio-fallo"'));
console.log(`sim-cotiz-tg: ${ok} ok, ${mal} fallas`);
