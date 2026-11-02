// Seguimientos del 805 y conteo de ventas (casos reales que marcó Manuel el 29/10). Correr desde cotizador/: node ../tests/sim-seguimientos.mjs
import { DatabaseSync } from "node:sqlite";
import fs from "fs";
let ok = 0, mal = 0; const chk = (n, c) => { c ? ok++ : (mal++, console.log("FALLA:", n)); };
const dir = fs.mkdtempSync("/tmp/seg-");
for (const f of fs.readdirSync("src")) fs.copyFileSync("src/" + f, dir + "/" + f);
const db = new DatabaseSync(":memory:");
const stmt = (sql, b = []) => ({ bind: (...x) => stmt(sql, x), run: async () => { db.prepare(sql).run(...b); return {}; }, first: async () => db.prepare(sql).get(...b) ?? null, all: async () => ({ results: db.prepare(sql).all(...b) }) });
const env = { DB: { prepare: (s) => stmt(s), batch: async (a) => { for (const x of a) await x.run(); } } };
const L = await import(dir + "/lector.js");
await L.prepararLector(env);
const D = 86400e3, ahora = Date.now(), h = (d) => ahora - d * D;
let nm = 0;
const msg = (conv, yo, texto, ts) => db.prepare("INSERT INTO w_msg (id,conv,grupo,yo,texto,ts,hist,tipo) VALUES (?,?,0,?,?,?,0,'text')").run("m" + nm++, conv, yo, texto, ts);
const conv = (c, o) => db.prepare(`INSERT INTO w_conv (conv,nombre,grupo,primer_ts,ult_ts,ult_yo,ult_cliente_ts,ult_yo_ts,ult_texto,n,analizado_ts,puntaje,etapa,producto,perfil,presup_usd,resp,cot_pend,archivado,prov)
  VALUES (?,?,0,?,?,?,?,?,?,5,?,?,?,?,?,?,?,?,0,0)`).run(c, o.nombre, o.primer ?? h(10), o.ult, o.ult_yo, o.cli ?? 0, o.yo ?? 0, o.texto ?? "", o.anal ?? o.ult, o.puntaje ?? 7, o.etapa ?? "cotizado", o.producto ?? "", o.perfil ?? "B", o.usd ?? null, o.resp ?? 0, o.cot_pend ?? 0);
const cot = (c, ts, dato = "") => db.prepare("INSERT INTO w_hito (id,conv,tipo,ts,dato) VALUES (?,?,'cotizacion',?,?)").run("c:" + c + ts, c, ts, dato);

// Ana: cotizada hace 4 días, no respondió → va
conv("5493410000001", { nombre: "Ana", ult: h(4), ult_yo: 1, cli: h(5), yo: h(4), producto: "auriculares", usd: 800 });
msg("5493410000001", 0, "cuanto me salen 50 auriculares?", h(5)); msg("5493410000001", 1, "Te quedan en USD 16 c/u puesto en Rosario, total USD 800", h(4)); cot("5493410000001", h(4));
// Bruno: cotizado hace 3 días y dijo "gracias" → va, con lo que dijo
conv("5493410000002", { nombre: "Bruno", ult: h(2.5), ult_yo: 0, cli: h(2.5), yo: h(3), texto: "gracias!", producto: "termos", perfil: "A", usd: 2000, resp: 0 });
msg("5493410000002", 0, "precio de 100 termos?", h(3.2)); msg("5493410000002", 1, "Total USD 2000 puesto en tu casa", h(3)); msg("5493410000002", 0, "gracias!", h(2.5)); cot("5493410000002", h(3));
// Sofía: la IA dice "cotizado" pero NUNCA le pasamos precio → no va
conv("5493410000003", { nombre: "Sofia", ult: h(2), ult_yo: 1, cli: h(2.1), yo: h(2), producto: "Vans", perfil: "A", usd: 3000 });
msg("5493410000003", 0, "tienen vans?", h(2.1)); msg("5493410000003", 1, "si! que talles y cuantos pares?", h(2));
// Carla: cotizada, después preguntó algo y espera respuesta → va a "Responder ya", no a seguimientos
conv("5493410000004", { nombre: "Carla", ult: h(1.5), ult_yo: 0, cli: h(1.5), yo: h(3), texto: "y cuanto tarda en llegar?", resp: 1 });
msg("5493410000004", 1, "Total USD 500", h(3)); msg("5493410000004", 0, "y cuanto tarda en llegar?", h(1.5)); cot("5493410000004", h(3));
// Darío: cotizado y compró → no va
conv("5493410000005", { nombre: "Dario", ult: h(2), ult_yo: 1, yo: h(2), etapa: "negociando" });
msg("5493410000005", 1, "Total USD 900", h(5)); cot("5493410000005", h(5)); db.prepare("INSERT INTO w_hito (id,conv,tipo,ts,dato) VALUES ('v1','5493410000005','venta',?, 'gorras')").run(h(3));
// Ema: cotizada hace 5 días y le escribimos ayer → todavía no le toca (cadencia)
conv("5493410000006", { nombre: "Ema", ult: h(1), ult_yo: 1, yo: h(1) });
msg("5493410000006", 1, "Total USD 300", h(5)); msg("5493410000006", 1, "pudiste verlo?", h(1)); cot("5493410000006", h(5));
// Fede: el mismo número con otro formato (dos chats) → una sola fila
conv("5493410000007", { nombre: "Fede", ult: h(3), ult_yo: 1, yo: h(3) }); msg("5493410000007", 1, "Total USD 150", h(3)); cot("5493410000007", h(3));
conv("93410000007", { nombre: "Fede", ult: h(6), ult_yo: 1, yo: h(6) }); msg("93410000007", 1, "Total USD 150", h(6)); cot("93410000007", h(6));
// Gaby: le prometimos pasarle otra cotización (tarea abierta) → no es seguimiento
conv("5493410000008", { nombre: "Gaby", ult: h(2), ult_yo: 1, yo: h(2) }); msg("5493410000008", 1, "Total USD 400, mañana te paso la de 200", h(2)); cot("5493410000008", h(2));
db.prepare("INSERT INTO tareas (id,ts,tipo,tel,nombre,titulo,estado,ref) VALUES ('t1',?,'promesa','5493410000008','Gaby','Pasarle cotización por 200','abierta','w805:5493410000008')").run(h(2));
// Hugo: 4 toques sin respuesta → frío, no se insiste más
conv("5493410000009", { nombre: "Hugo", ult: h(2), ult_yo: 1, yo: h(2) }); msg("5493410000009", 1, "Total USD 700", h(18)); cot("5493410000009", h(18));
for (const d of [17, 14, 10, 2]) msg("5493410000009", 1, "¿lo seguimos viendo?", h(d));
// Iván: el dueño tocó "No seguir" → no va
conv("5493410000010", { nombre: "Ivan", ult: h(3), ult_yo: 1, yo: h(3) }); msg("5493410000010", 1, "Total USD 250", h(3)); cot("5493410000010", h(3));
db.prepare("UPDATE w_conv SET seg_no=? WHERE conv='5493410000010'").run(h(1));
// Juli: cotizada, pero en la charla dijo que no (la IA lo descarta)
conv("5493410000011", { nombre: "Juli", ult: h(2), ult_yo: 1, yo: h(2), etapa: "cotizado" }); msg("5493410000011", 1, "Total USD 600", h(3)); msg("5493410000011", 0, "no gracias, muy caro, lo dejo", h(2.2)); msg("5493410000011", 1, "dale, cualquier cosa avisame", h(2)); cot("5493410000011", h(3));

// ---- Casos reales del 30/10: le pasamos precio o info SIN cotización registrada ----
// Lucas: le pasamos catálogo y envío de 20 pares, dijo "dale muchas gracias ahora veo bien todo" → va
conv("5493410000012", { nombre: "Lucas", ult: h(2.6), ult_yo: 0, cli: h(2.6), yo: h(2.6), etapa: "negociando", perfil: "C", texto: "Dale muchas gracias ahora veo bien todo y veo que se puede armar" });
msg("5493410000012", 0, "precio de zapatillas por 20 pares?", h(3)); msg("5493410000012", 1, "el envio amigo te va a quedar en 15mil pesos aprox", h(2.7)); msg("5493410000012", 1, "si todas las del catalogo", h(2.6)); msg("5493410000012", 0, "Dale muchas gracias ahora veo bien todo y veo que se puede armar", h(2.6));
// Lauti: le mandamos la lista de precios, dijo "okay" y le dijimos "avisame vos" → va
conv("5493410000013", { nombre: "lauti", ult: h(2.6), ult_yo: 1, yo: h(2.6), perfil: "C" });
msg("5493410000013", 0, "uno de cada uno", h(2.7)); msg("5493410000013", 1, "PRECIOS MAYORISTA DE ZAPATILLAS. Cada marca tiene su carpeta con los distintos precios", h(2.6)); msg("5493410000013", 0, "okay", h(2.6)); msg("5493410000013", 1, "avisame vos cuando decidas", h(2.6));
// Martin: la IA lo marcó "perdido", pero le pasamos precio y dijo "dale muchas gracias" → va
conv("5493410000014", { nombre: "Martin", ult: h(2), ult_yo: 0, cli: h(2), yo: h(2), etapa: "perdido", perfil: "D", texto: "Dale muchas gracias" });
msg("5493410000014", 0, "Necesito para uso personal así que dos", h(2.1)); msg("5493410000014", 1, "Estimativo 200usd cada uno", h(2)); msg("5493410000014", 1, "Puesto en argentina", h(2)); msg("5493410000014", 0, "Dale muchas gracias", h(2));
// Alexis: precio y "Ahí me fijo a ver" → va
conv("5493410000015", { nombre: "Alexis", ult: h(3), ult_yo: 0, cli: h(3), yo: h(3.1), perfil: "C", texto: "Ahí me fijo a ver" });
msg("5493410000015", 1, "50 cables te quedan en USD 2 c/u", h(3.1)); msg("5493410000015", 0, "Ahí me fijo a ver", h(3));
// Lautaro: solo el saludo automático y un "quedamos atentos" del bot → nunca le mandamos nada, no va
conv("5493410000016", { nombre: "Lautaro", ult: h(1.8), ult_yo: 1, yo: h(1.8), etapa: "perdido", perfil: "C" });
msg("5493410000016", 0, "Hola! Quiero hacer una consulta.", h(1.9)); msg("5493410000016", 1, "Bienvenido!! Gracias por escribir 🙌 Contame, ¿qué estás buscando importar?", h(1.9)); msg("5493410000016", 1, "Lautaro, quedamos atentos a tu consulta para cuando quieras retomarla.", h(1.8));
// Pato: le pasamos precio pero después preguntó algo → espera respuesta nuestra, no va
conv("5493410000017", { nombre: "Pato", ult: h(2), ult_yo: 0, cli: h(2), yo: h(3), perfil: "C", resp: 1, texto: "y en cuanto llega?" });
msg("5493410000017", 1, "te quedan en USD 5 c/u", h(3)); msg("5493410000017", 0, "y en cuanto llega?", h(2));
// Nati: le pasamos precio y dijo "no gracias, ya conseguí" → no va
conv("5493410000018", { nombre: "Nati", ult: h(2), ult_yo: 1, yo: h(2), perfil: "C" });
msg("5493410000018", 1, "te quedan en USD 5 c/u", h(3)); msg("5493410000018", 0, "ya conseguí, gracias igual", h(2.5)); msg("5493410000018", 1, "dale, cualquier cosa avisame", h(2));
// Bauti vendido: le pasamos el seguimiento del envío de su compra → no es seguimiento comercial
conv("5493410000019", { nombre: "Rocio", ult: h(3), ult_yo: 1, yo: h(3), etapa: "vendido", perfil: "C" });
db.prepare("INSERT INTO w_hito (id,conv,tipo,ts,dato) VALUES ('v19','5493410000019','venta',?, 'vasos')").run(h(10));
msg("5493410000019", 1, "te paso el envío por Andreani, llega en 3 días", h(3));
// Tomi: le pasamos precio hace 2 días; "Bueno pasame el de 100" no es un acuse (pide algo) → no va
conv("5493410000020", { nombre: "Tomi", ult: h(1.5), ult_yo: 0, cli: h(1.5), yo: h(2), perfil: "C", resp: 1, texto: "Bueno pasame el de 100" });
msg("5493410000020", 1, "50 te quedan USD 3 c/u", h(2)); msg("5493410000020", 0, "Bueno pasame el de 100", h(1.5));
// Cami: le cotizamos hace 25 días, 2 toques sin respuesta → entra (la ventana ahora es de 30 días)
conv("5493410000021", { nombre: "Cami", ult: h(8), ult_yo: 1, yo: h(8), perfil: "B", usd: 1200 });
msg("5493410000021", 1, "Total USD 1200 puesto en Rosario", h(25)); cot("5493410000021", h(25)); msg("5493410000021", 1, "¿pudiste verlo?", h(20)); msg("5493410000021", 1, "¿lo seguimos viendo?", h(8));

// Rami: 4 toques "¿pudiste evaluar la cotización?" (sin precio nuevo) → frío, no vuelve a arrancar la cuenta
conv("5493410000022", { nombre: "Rami", ult: h(2), ult_yo: 1, yo: h(2) }); msg("5493410000022", 1, "Total USD 700", h(18)); cot("5493410000022", h(18));
for (const d of [17, 14, 10, 2]) msg("5493410000022", 1, "Buenas, pudiste evaluar la cotización?", h(d));

let llamadas = 0, prompt = "";
const ia = async (_e, p) => {
  if (!p.includes("dejaron de contestar")) return null;
  llamadas++; prompt = p;
  const n = (nombre) => { const m = p.match(new RegExp("#(\\d+) " + nombre + " ")); return m ? +m[1] : 0; };
  return { mensajes: [
    { n: n("Ana"), seguir: true, producto: "auriculares", cantidad: "50 u", total: "USD 800 total", mensaje: "Ana, ¿pudiste ver lo de los auriculares?" },
    { n: n("Bruno"), seguir: true, producto: "termos", cantidad: "100 u", total: "USD 2000", mensaje: "Bruno, ¿avanzamos con los termos?" },
    { n: n("Juli"), seguir: false, motivo: "dijo que no, caro" },
    { n: n("Fede"), seguir: true, producto: "llaveros", cantidad: "", total: "USD 150", mensaje: "Fede, ¿seguimos?" },
  ].filter((x) => x.n) };
};
const l = await L.revisarSeguimientos(env, ia, { limite: 0 });
const nombres = l.map((x) => x.nombre);
chk("van los cotizados que no respondieron o dijeron gracias", nombres.includes("Ana") && nombres.includes("Bruno"));
chk("Sofía (sin cotización) no aparece", !nombres.includes("Sofia"));
chk("el que espera respuesta nuestra no aparece", !nombres.includes("Carla"));
chk("el que compró no aparece", !nombres.includes("Dario"));
chk("al que le escribimos ayer todavía no le toca", !nombres.includes("Ema"));
chk("sin repetidos por número", nombres.filter((x) => x === "Fede").length === 1);
chk("si le debemos una cotización, no es seguimiento", !nombres.includes("Gaby"));
chk("después de 4 toques no se insiste", !nombres.includes("Hugo"));
chk("No seguir lo saca", !nombres.includes("Ivan"));
chk("la IA saca al que dijo que no", !nombres.includes("Juli"));
chk("primero los que más valen", nombres[0] === "Bruno");
chk("precio/catálogo sin cotización registrada también va", nombres.includes("Lucas") && nombres.includes("lauti"));
chk("'perdido' que dijo gracias va", nombres.includes("Martin"));
chk("'ahí me fijo' cuenta como acuse", nombres.includes("Alexis"));
chk("solo el bot de bienvenida: no va", !nombres.includes("Lautaro"));
chk("pregunta después del precio: no va", !nombres.includes("Pato"));
chk("dijo que ya consiguió: no va", !nombres.includes("Nati"));
chk("envío de una compra hecha: no va", !nombres.includes("Rocio"));
chk("'bueno pasame…' pide algo: no va", !nombres.includes("Tomi"));
chk("cotización de 25 días con toques pendientes va", nombres.includes("Cami"));
chk("'¿pudiste ver la cotización?' es un toque, no una cotización nueva", !nombres.includes("Rami"));
chk("sin números repetidos en toda la lista", new Set(l.map((x) => x.conv.slice(-10))).size === l.length);
const lucas = l.find((x) => x.nombre === "Lucas");
chk("línea: dice qué le pasamos", L.lineaSeguimiento(lucas).includes("le pasamos") && L.lineaSeguimiento(lucas).includes('dijo "Dale muchas gracias'));
const ana = l.find((x) => x.nombre === "Ana"), bruno = l.find((x) => x.nombre === "Bruno");
chk("línea: qué, cuánto, monto y no respondió", L.lineaSeguimiento(ana) === "Ana (+5493410000001): le cotizamos 50 u auriculares · USD 800 total · cotizado hace 4 d → no respondió");
chk("línea: dijo gracias", L.lineaSeguimiento(bruno).includes('→ dijo "gracias!"') && L.lineaSeguimiento(bruno).includes("100 u termos · USD 2000"));
chk("la IA ve la charla y la reacción", prompt.includes("Cliente: gracias!") && prompt.includes("dijo \"gracias!\""));
const llamadas1 = llamadas;
await L.revisarSeguimientos(env, ia, { limite: 0 });
chk("la IA revisa una vez por día", llamadas1 >= 1 && llamadas === llamadas1);
chk("lo que la IA descartó tampoco cuenta en el resto del panel", !(await L.seguimientos(env)).some((x) => x.nombre === "Juli"));
db.prepare("UPDATE w_conv SET ult_yo_ts=? WHERE conv='5493410000001'").run(ahora);
chk("si ya le escribimos, sale", !(await L.seguimientos(env)).some((x) => x.nombre === "Ana"));

// El agente contesta la pregunta de seguimientos con la lista verificada
const r = await L.preguntarVendedor(env, ia, 'de los que les mandamos cotizaciones en los ultimos dias, quienes no contestaron o dijeron "gracias" o algo por el estilo, y les tendriamos que hacer seguimiento?');
chk("agente: lista corta con qué se cotizó", r.respuesta.includes("le cotizamos 100 u termos") && r.respuesta.includes('dijo "gracias!"'));
chk("agente: no nombra a Sofía", !r.respuesta.includes("Sofia"));

// ---- Telegram: lista completa aunque sean muchos, y los mensajes de a 12 ----
for (let i = 0; i < 20; i++) { const c = "54934120000" + String(i).padStart(2, "0"); conv(c, { nombre: "Cliente" + i, ult: h(3), ult_yo: 1, yo: h(3), perfil: "C" }); msg(c, 1, "te quedan en USD " + (10 + i) + " c/u", h(3)); }
const A = await import(dir + "/asistente.js");
const total = (await L.revisarSeguimientos(env, ia, { limite: 0, tope: 200 })).length;
const partes = await A.seguimientosHoy(env, ia);
const textoTodo = partes.map((p) => p.texto).join("\n");
chk("Telegram: arranca con la lista completa", partes[0].texto.includes(`Seguimientos de hoy: ${total}`) && total > 20);
chk("Telegram: están todos en la lista", Array.from({ length: 20 }, (_, i) => "Cliente" + i).every((n) => textoTodo.includes(n + " (+")));
chk("Telegram: cada número una sola vez en la lista", (textoTodo.split("\n✍️")[0].match(/\(\+5493412000007\)/g) || []).length <= 1);
chk("Telegram: 12 con botón y aviso de 'más seguimientos'", partes.reduce((a, p) => a + p.botones.length, 0) === 12 && textoTodo.includes('"más seguimientos"'));
chk("Telegram: ningún mensaje pasa el límite", partes.every((p) => p.texto.length <= 4096));
const p2 = await A.seguimientosHoy(env, ia, { desde: 12 });
chk("Telegram: 'más seguimientos' trae los siguientes", p2[0].texto.includes("Mensajes listos del 13 al"));

// ---- Reparto entre dos personas: listas distintas, sin repetidos, entre los dos están todos ----
db.prepare("INSERT OR REPLACE INTO kv (k,v) VALUES ('telegram_chat:manuel','111'),('telegram_chat:juan','222'),('seg_equipo','[\"manuel\",\"juan\"]')").run();
const pm = await A.seguimientosHoy(env, ia, { quien: "manuel", cuantos: 500 }), pj = await A.seguimientosHoy(env, ia, { quien: "juan", cuantos: 500 });
const nums = (ps) => new Set(ps.flatMap((p) => p.botones.map((b) => b[0].url.match(/wa\.me\/(\d+)/)[1])));
const nMan = nums(pm), nj = nums(pj);
chk("reparto: ningún número en las dos listas", [...nMan].every((x) => !nj.has(x)));
chk("reparto: entre los dos están todos", nMan.size + nj.size === total && Math.abs(nMan.size - nj.size) <= 1);
chk("reparto: cada uno sabe que es su parte", pm[0].texto.includes("Esta es tu parte") && pm[0].texto.includes("Juan"));
const pm2 = await A.seguimientosHoy(env, ia, { quien: "manuel", cuantos: 500 });
chk("reparto: la asignación se mantiene", [...nums(pm2)].every((x) => nMan.has(x)));
db.prepare("DELETE FROM kv WHERE k IN ('seg_equipo','seg_asig')").run();

// ---- Ventas: envío o compra ya contada no son venta ----
chk("pagar el envío no es venta", !L.esVentaReal({ msg: 0, producto: "pago envío", concepto: "envio" }, {}));
chk("comprobante del flete no es venta", !L.esVentaReal({ msg: 0, producto: "vasos", concepto: "total" }, { ms: [{ texto: "(image) te paso el comprobante del flete" }] }));
chk("si ya hay venta en el chat, hace falta compra nueva", !L.esVentaReal({ msg: 0, producto: "llaveros", concepto: "sena" }, { ventasPrev: [{ ts: h(20) }] }) && L.esVentaReal({ msg: 0, producto: "gorras", concepto: "sena", compra_nueva: true }, { ventasPrev: [{ ts: h(20) }] }));
chk("una seña nueva sí es venta", L.esVentaReal({ msg: 0, producto: "vasos", concepto: "sena", compra_nueva: true }, {}));
// Auditoría de un día: Bauti pagó el envío de una compra de hace 3 semanas
const dia = new Date(h(1) - 3 * 3600e3).toISOString().slice(0, 10), ini = Date.parse(dia + "T00:00:00Z") + 3 * 3600e3;
conv("5492477469751", { nombre: "Bauti", ult: ini + 5 * 3600e3, ult_yo: 1, yo: ini + 5 * 3600e3, etapa: "vendido" });
db.prepare("INSERT INTO w_hito (id,conv,tipo,ts,dato) VALUES ('vb','5492477469751','venta',?, 'vasos')").run(ini - 20 * D);
msg("5492477469751", 0, "te mandé la seña de los vasos", ini - 20 * D); msg("5492477469751", 0, "(image) ahi va el comprobante", ini + 4 * 3600e3); msg("5492477469751", 1, "recibido! despachamos mañana", ini + 5 * 3600e3);
let pAud = "";
const iaAud = async (_e, p) => { pAud = p; return { chats: [{ chat: "5492477469751|" + dia, interno: false, primer_contacto: false, cotizaciones: [], venta: { msg: 0, producto: "vasos", monto: "", concepto: "total", compra_nueva: false } }] }; };
await L.auditarCotizaciones(env, iaAud, { dia, conv: "5492477469751", rehacer: true, limite: 1 });
chk("la auditoría ve la venta anterior", pAud.includes("VENTAS YA REGISTRADAS EN ESTE CHAT") && pAud.includes("ENVÍO"));
chk("el comprobante de una compra ya contada no suma otra venta", db.prepare("SELECT COUNT(*) n FROM w_hito WHERE conv='5492477469751' AND tipo='venta'").get().n === 1);
// Endpoints del programita de la PC
env.LECTOR_TOKEN = "tok";
const rq = (path, method = "GET", body) => L.rutaLector(env, new Request("https://x/lector" + path, { method, headers: { Authorization: "Bearer tok" }, body: body ? JSON.stringify(body) : undefined }), new URL("https://x/lector" + path), {});
const rl = await (await rq("/enviar/lista?limite=50")).json();
chk("enviar/lista devuelve seguimientos con borrador", rl.ok && rl.lista.length > 0 && rl.lista.every((x) => x.borrador && /^\d+$/.test(x.conv)));
if (rl.lista[0]) { await rq("/enviar/hecho", "POST", { conv: rl.lista[0].conv }); const rl2 = await (await rq("/enviar/lista?limite=50")).json(); chk("enviar/hecho lo saca de la lista", !rl2.lista.some((x) => x.conv === rl.lista[0].conv)); }
if (rl.lista[1]) { await rq("/enviar/no", "POST", { conv: rl.lista[1].conv }); const rl3 = await (await rq("/enviar/lista?limite=50")).json(); chk("enviar/no lo saca de la lista", !rl3.lista.some((x) => x.conv === rl.lista[1].conv)); }
// Contestador automático (rutas /enviar/responder, redactar, pausa)
{
  const ahoraR = Date.now(), tel = (n) => "54934100099" + n;
  const cv = (c, o) => db.prepare("INSERT INTO w_conv (conv,nombre,grupo,primer_ts,ult_ts,ult_yo,ult_cliente_ts,ult_yo_ts,ult_texto,n,archivado,prov) VALUES (?,?,0,?,?,?,?,?,?,3,0,0)").run(c, o.nombre, ahoraR - 9e6, o.ult, o.yo ? 1 : 0, o.cli, o.yo ? o.ult : 0, o.texto);
  const mm = (c, yo, texto, ts, tipo = "text") => db.prepare("INSERT INTO w_msg (id,conv,grupo,yo,texto,ts,hist,tipo) VALUES (?,?,0,?,?,?,0,?)").run("r" + nm++, c, yo, texto, ts, tipo);
  cv(tel(1), { nombre: "Pedro", ult: ahoraR - 600e3, cli: ahoraR - 600e3, texto: "me pasas el precio de estos auriculares? https://www.alibaba.com/product-detail/x" });
  mm(tel(1), 1, "Hola Pedro, cómo andás? Te paso la info en un rato", ahoraR - 3e6); mm(tel(1), 0, "me pasas el precio de estos auriculares? https://www.alibaba.com/product-detail/x", ahoraR - 600e3);
  cv(tel(2), { nombre: "Lu", ult: ahoraR - 300e3, cli: ahoraR - 300e3, texto: "transferí recién" }); mm(tel(2), 0, "transferí recién", ahoraR - 300e3);
  cv(tel(3), { nombre: "Recién", ult: ahoraR - 10e3, cli: ahoraR - 10e3, texto: "hola" }); mm(tel(3), 0, "hola", ahoraR - 10e3);
  cv(tel(4), { nombre: "YaContesté", ult: ahoraR - 100e3, yo: 1, cli: ahoraR - 900e3, texto: "dale" });
  const sin = await (await rq("/enviar/responder?limite=20")).json();
  const cs = sin.lista.map((x) => x.conv);
  chk("responder: lista chats esperando", cs.includes(tel(1)) && cs.includes(tel(2)));
  chk("responder: no los que ya contestaste ni los de hace segundos", !cs.includes(tel(4)) && !cs.includes(tel(3)));
  let prompt = "", resp = { accion: "responder", mensaje: "Dale Pedro! Necesito que me digas peso del producto en kg, cantidad y precio FOB de Alibaba", motivo: "quiere cotizar" };
  const iaR = async (_e, p) => { prompt = p; return resp; };
  const rqi = (path, body) => L.rutaLector(env, new Request("https://x/lector" + path, { method: "POST", headers: { Authorization: "Bearer tok" }, body: JSON.stringify(body) }), new URL("https://x/lector" + path), {}, iaR);
  let r1 = await (await rqi("/enviar/redactar", { conv: tel(1) })).json();
  chk("redactar: pide peso, cantidad y FOB de Alibaba", r1.accion === "responder" && /peso del producto en kg, cantidad y precio FOB de Alibaba/.test(r1.mensaje));
  chk("redactar: el prompt lleva tu estilo y la charla", prompt.includes("Te paso la info en un rato") && prompt.includes("CLIENTE: me pasas el precio"));
  chk("redactar: la regla de 1688 y del catálogo están en el prompt", prompt.includes("precio FOB de 1688") && prompt.includes("teimportamosarg.com/catalogo") && prompt.includes("búsqueda de proveedores") && prompt.includes("NO le pidas peso ni FOB"));
  chk("después de decidir no vuelve a aparecer", !(await (await rq("/enviar/responder?limite=20")).json()).lista.some((x) => x.conv === tel(1)));
  resp = { accion: "responder", mensaje: "Te sale USD 450 el total", motivo: "x" };
  let r2 = await (await rqi("/enviar/redactar", { conv: tel(2) })).json();
  chk("un mensaje con precio no se manda (queda para vos)", r2.accion === "humano" && /precio/.test(r2.motivo));
  chk("revisarMensaje: link ajeno y precios en pesos", L.rutaLector && (await import(dir + "/autoresp.js")).revisarMensaje("mirá https://malo.com") === "link ajeno" && (await import(dir + "/autoresp.js")).revisarMensaje("son $ 5000") === "tiene un precio" && (await import(dir + "/autoresp.js")).revisarMensaje("pasame kg, cantidad y precio FOB") === "");
  await rqi("/enviar/pausa", { pausa: true });
  const pz = await (await rq("/enviar/responder?limite=20")).json();
  chk("pausa: no devuelve nada", pz.pausado === true && pz.lista.length === 0);
  await rqi("/enviar/pausa", { pausa: false });
  chk("reanudar: vuelve a andar", (await (await rq("/enviar/responder?limite=20")).json()).pausado === false);
  // Derivados ("Para vos") y promesas de derivar
  chk("revisarMensaje: no promete que alguien lo va a escribir", (await import(dir + "/autoresp.js")).revisarMensaje("Te paso con alguien del equipo") === "promete derivar");
  resp = { accion: "humano", mensaje: "", motivo: "pagó", resumen: "mandó comprobante, confirmar pago" };
  await rqi("/enviar/redactar", { conv: tel(2) });
  const dv = await (await rq("/enviar/derivados")).json();
  chk("derivados: queda anotado con resumen corto", dv.lista.some((x) => x.conv === tel(2) && /comprobante/.test(x.resumen)));
  db.prepare("UPDATE w_conv SET ult_yo=1 WHERE conv=?").run(tel(2));
  chk("derivados: sale cuando contestás vos", !(await (await rq("/enviar/derivados")).json()).lista.some((x) => x.conv === tel(2)));
  // Cotizaciones que se arman solas (Alibaba + cantidad): se mandan si el peso es real; si es estimado quedan para vos
  {
    const T = { fleteKg: 18, handling: 30, honorarios: 80, factor: 1.3, aereoHasta: 100, aereoDesde: 20, barcoFijo: 900, aereoFijo: 300 };
    db.prepare("CREATE TABLE IF NOT EXISTS cotiz_manual (id TEXT PRIMARY KEY, ts INTEGER, num INTEGER, quien TEXT, cliente TEXT, datos TEXT)").run();
    const hh = async (path, body) => L.rutaLector(env, new Request("https://x/lector" + path, { method: body ? "POST" : "GET", headers: { Authorization: "Bearer tok" }, body: body ? JSON.stringify(body) : undefined }), new URL("https://x/lector" + path), {}, null, { T });
    const mk = (cid, conv, num, est) => {
      db.prepare("INSERT INTO cotiz_manual (id,ts,num,quien,cliente,datos) VALUES (?,?,?,?,?,?)").run(cid, ahoraR, num, "auto", "X", JSON.stringify({ items: [{ nombre: "Auriculares", cantidad: 50, precio: 8, peso: 0.2 }], desglose: true, notas: est ? "Peso estimado: el valor final puede variar" : "", auto: true, conv }));
      db.prepare("INSERT INTO tareas (id,ts,tipo,tel,nombre,titulo,datos,ref,estado) VALUES (?,?,?,?,?,?,?,?,'abierta')").run("ca" + cid, ahoraR - 1000, "cotizacion_auto", conv, "X", "Cotización lista", JSON.stringify({ cotiz: cid, num }), "cotauto:" + cid);
    };
    cv(tel(5), { nombre: "Cot Real", ult: ahoraR - 400e3, cli: ahoraR - 400e3, texto: "x" }); mk("cotreal", tel(5), 7, false);
    cv(tel(6), { nombre: "Cot Estimada", ult: ahoraR - 400e3, cli: ahoraR - 400e3, texto: "x" }); mk("cotest", tel(6), 8, true);
    const lr = await (await hh("/enviar/responder?limite=20")).json();
    chk("cotizaciones: la de peso real sale para enviar con su total", lr.cotizaciones.length === 1 && lr.cotizaciones[0].id === "cotreal" && lr.cotizaciones[0].total > 0);
    chk("cotizaciones: la de peso estimado queda para vos", !lr.cotizaciones.some((x) => x.id === "cotest") && (await (await hh("/enviar/derivados")).json()).lista.some((x) => x.conv === tel(6) && /peso estimado/.test(x.resumen)));
    const rh = await hh("/enviar/cotizacion-html", { id: "cotreal" });
    chk("cotizacion-html: devuelve la página para armar el PDF", rh.status === 200 && (await rh.text()).includes("Auriculares"));
    await hh("/enviar/cotizacion-enviada", { id: "cotreal" });
    chk("cotizacion-enviada: no se vuelve a ofrecer", !(await (await hh("/enviar/responder?limite=20")).json()).cotizaciones.length);
    chk("el precio del informe ($5.000) está permitido y otros no", (await import(dir + "/autoresp.js")).revisarMensaje("El informe cuesta $5.000, te sirve?") === "" && (await import(dir + "/autoresp.js")).revisarMensaje("te sale $6.000") === "tiene un precio");
  }
  const lg = await (await rq("/enviar/log")).json();
  chk("log guarda las decisiones", lg.log.length >= 2 && lg.log.some((x) => x.accion === "humano"));
}
console.log(`sim-seguimientos: ${ok} ok, ${mal} fallas`);
