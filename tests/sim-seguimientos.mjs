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
const ana = l.find((x) => x.nombre === "Ana"), bruno = l.find((x) => x.nombre === "Bruno");
chk("línea: qué, cuánto, monto y no respondió", L.lineaSeguimiento(ana) === "Ana (+5493410000001): le cotizamos 50 u auriculares · USD 800 total · cotizado hace 4 d → no respondió");
chk("línea: dijo gracias", L.lineaSeguimiento(bruno).includes('→ dijo "gracias!"') && L.lineaSeguimiento(bruno).includes("100 u termos · USD 2000"));
chk("la IA ve la charla y la reacción", prompt.includes("Cliente: gracias!") && prompt.includes("dijo \"gracias!\""));
await L.revisarSeguimientos(env, ia, { limite: 0 });
chk("la IA revisa una vez por día", llamadas === 1);
chk("lo que la IA descartó tampoco cuenta en el resto del panel", !(await L.seguimientos(env)).some((x) => x.nombre === "Juli"));
db.prepare("UPDATE w_conv SET ult_yo_ts=? WHERE conv='5493410000001'").run(ahora);
chk("si ya le escribimos, sale", !(await L.seguimientos(env)).some((x) => x.nombre === "Ana"));

// El agente contesta la pregunta de seguimientos con la lista verificada
const r = await L.preguntarVendedor(env, ia, 'de los que les mandamos cotizaciones en los ultimos dias, quienes no contestaron o dijeron "gracias" o algo por el estilo, y les tendriamos que hacer seguimiento?');
chk("agente: lista corta con qué se cotizó", r.respuesta.includes("le cotizamos 100 u termos") && r.respuesta.includes('dijo "gracias!"'));
chk("agente: no nombra a Sofía", !r.respuesta.includes("Sofia"));

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
console.log(`sim-seguimientos: ${ok} ok, ${mal} fallas`);
