// Seguimientos v2 (19/11): compra en curso (caso Ian), freno con el lector atrasado, solo mensajes de la IA salen solos,
// y aprendizaje de los seguimientos respondidos (a mano y del sender) con correcciones del equipo. Correr desde cotizador/
import { DatabaseSync } from "node:sqlite";
import fs from "fs";
import os from "os";
import path from "path";
import { pathToFileURL } from "node:url";
let ok = 0, mal = 0; const chk = (n, c) => { c ? (ok++, console.log("✓ " + n)) : (mal++, console.log("FALLA: " + n)); };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "seg3-"));
const sourceDir = new URL("../cotizador/src/", import.meta.url);
for (const f of fs.readdirSync(sourceDir)) fs.copyFileSync(new URL(f, sourceDir), path.join(dir, f));
const db = new DatabaseSync(":memory:");
const stmt = (sql, b = []) => ({ bind: (...x) => stmt(sql, x), run: async () => { db.prepare(sql).run(...b); return {}; }, first: async () => db.prepare(sql).get(...b) ?? null, all: async () => ({ results: db.prepare(sql).all(...b) }) });
const env = { DB: { prepare: (s) => stmt(s), batch: async (a) => { for (const x of a) await x.run(); } }, LECTOR_TOKEN: "t".repeat(30) };
const L = await import(pathToFileURL(path.join(dir, "lector.js")));
await L.prepararLector(env);
const D = 86400e3, H = 3600e3, ahora = Date.now(), h = (d) => ahora - d * D;
let nm = 0;
const msg = (conv, yo, texto, ts) => db.prepare("INSERT INTO w_msg (id,conv,grupo,yo,texto,ts,hist,tipo) VALUES (?,?,0,?,?,?,0,'text')").run("m" + nm++, conv, yo, texto, ts);
const conv = (c, o) => db.prepare(`INSERT INTO w_conv (conv,nombre,grupo,primer_ts,ult_ts,ult_yo,ult_cliente_ts,ult_yo_ts,ult_texto,n,analizado_ts,puntaje,etapa,producto,perfil,presup_usd,resp,cot_pend,archivado,prov)
  VALUES (?,?,0,?,?,?,?,?,?,5,?,7,'negociando',?,?,?,0,0,0,0)`).run(c, o.nombre, h(20), o.ult, 1, o.cli ?? 0, o.ult, o.texto ?? "", o.ult, o.producto ?? "", "C", o.usd ?? null);
const cot = (c, ts) => db.prepare("INSERT INTO w_hito (id,conv,tipo,ts,dato) VALUES (?,?,'cotizacion',?,'300 unidades')").run("c:" + c + ts, c, ts);

// Ian: cotizado hace 9 días, después se habló de pago y proforma; lo último es nuestro ("le pediste proforma...?") hace 1,2 días
const IAN = "5491168756132";
conv(IAN, { nombre: "Ian", ult: h(1.2), producto: "gorras", usd: 690, texto: "le pediste profoma invoice y packing list?" });
msg(IAN, 1, "300 gorras quedan en USD 690 puestas en tu casa", h(9)); cot(IAN, h(9));
msg(IAN, 0, "dale, el proveedor me paso el link para realizar el pago", h(1.4));
msg(IAN, 0, "Buen día amigo acá como sigo?", h(1.3));
msg(IAN, 1, "hermano", h(1.21)); msg(IAN, 1, "le pediste profoma invoice y packing list?", h(1.2));
// Ana: cotizada hace 2 días, silencio (caso normal)
const ANA = "5493410000001";
conv(ANA, { nombre: "Ana", ult: h(2), producto: "auriculares", usd: 400 });
msg(ANA, 0, "cuanto 20 auriculares?", h(2.1)); msg(ANA, 1, "Total USD 400 puesto en tu casa", h(2)); cot(ANA, h(2));

let prompts = [];
const ia = async (_e, p) => { prompts.push(p); const n = (nom) => { const m = p.match(new RegExp("#(\\d+) " + nom)); return m ? +m[1] : 0; };
  return { mensajes: [
    { n: n("Ian"), situacion: 2, seguir: true, contexto: "pidió cómo sigue", mensaje: "ian, como va? si queres tambien podemos sacar cupos para importar gorras, es un buen producto" },
    { n: n("Ana"), situacion: 2, seguir: true, contexto: "le pasamos USD 400 por 20 auriculares y no contestó", mensaje: "ana, los 20 auriculares quedan en usd 400 en tu casa. te lo reservo con la seña?" },
  ].filter((x) => x.n) }; };
const l = await L.revisarSeguimientos(env, ia, { limite: 0 });
const por = Object.fromEntries(l.map((x) => [x.nombre, x]));
const p0 = prompts[0] || "";
chk("Ian se detecta como compra en curso", por.Ian?.en_curso === true && /proforma|pago/i.test(por.Ian.paso_compra));
chk("el prompt pide el contexto primero y avisa la compra en curso", /PASO 0, LO MÁS IMPORTANTE/.test(p0) && /OJO: PARECE COMPRA EN CURSO/.test(p0) && /9 compra en curso/.test(p0));
chk("la charla va con fecha y hora", /\[\d\d\/\d\d \d\d:\d\d\] Cliente: Buen día amigo/.test(p0));
chk("el plan A/B es solo el ángulo (la charla manda)", /lo que pasó en la charla manda sobre el plan/.test(p0));
chk("el mensaje de cupos para Ian se descarta", por.Ian && !por.Ian.ia_msg && /descartado/.test(JSON.parse(db.prepare("SELECT v FROM kv WHERE k='seg_ia'").get()?.v || "{}")[IAN]?.motivo || ""));
chk("Ian queda con el borrador de respaldo del paso (sin ofertas)", /cómo venís con lo de gorras/.test(por.Ian?.borrador || "") && !L.RE_OFERTA_NUEVA.test(por.Ian?.borrador || ""));
chk("Ana sí queda con el mensaje de la IA", por.Ana?.ia_msg && /reservo con la seña/.test(por.Ana.borrador));
chk("validador: cupos que no están en la charla se descartan", L.validarSeg("sumate al cupo de esta semana", { sit: 2, charla: "cuanto salen 20?" }).mensaje === "" && L.validarSeg("sumate al cupo", { sit: 2, charla: "hay cupo?" }).mensaje !== "");

// Mensajes cruzados: nombra a otro cliente de la tanda → se descarta; la respuesta se ubica por id
chk("validador: un mensaje que nombra a otro cliente se descarta", L.validarSeg("Hola Somos Dalia, ya evaluaste la cotización?", { nombre: "Ezequias Q.T", otros: ["Somos Dalia", "Facu"] }).mensaje === "" && L.validarSeg("ezequias, como va?", { nombre: "Ezequias Q.T", otros: ["Somos Dalia"] }).mensaje !== "");
const tz = [{ conv: "5491100001111", nombre: "A" }, { conv: "5491100002222", nombre: "B" }];
chk("la respuesta se ubica por id y si no coincide con el número se descarta", L.clienteDeRespuesta(tz, { n: 2, id: "2222" }) === tz[1] && L.clienteDeRespuesta(tz, { n: 1, id: "2222" }) === null && L.clienteDeRespuesta(tz, { n: 1 }) === tz[0]);
chk("los seguimientos no usan la IA de último recurso", /sinRespaldo: true/.test(fs.readFileSync(path.join(dir, "lector.js"), "utf8").split("Respondé SOLO JSON: {\"mensajes\":[{\"n\":1,\"id\"")[1]?.slice(0, 400) || ""));
// La PC (sender) solo recibe mensajes escritos por la IA, y nada si el lector está atrasado
const pedir = async () => (await L.rutaLector(env, new Request("https://x/lector/seguimientos?listos=1&limite=20", { headers: { Authorization: "Bearer " + env.LECTOR_TOKEN } }), new URL("https://x/lector/seguimientos?listos=1&limite=20"), null, null)).json();
let r = await pedir();
chk("con el lector atrasado (último mensaje hace 1 día) la PC no recibe nada y avisa", r.lista.length === 0 && /atrasado/.test(r.aviso || ""));
msg("5490000000000", 0, "hola", ahora - 10 * 60e3);   // entra un mensaje recién: el lector está al día
db.prepare("DELETE FROM kv WHERE k='seg_ruta'").run();
r = await pedir();
chk("con el lector al día: sale Ana y no Ian (sin mensaje de la IA)", r.lista.some((x) => x.conv === ANA) && !r.lista.some((x) => x.conv === IAN) && !r.aviso);
chk("lectorAtrasado responde según el último mensaje", (await L.lectorAtrasado(env)) === false);

// Aprendizaje: el equipo le mandó otra cosa a Ian (corrección) y le contestaron; un mensaje de la IA sin respuesta
const n1 = await L.anotarSegManuales(env, [{ conv: IAN, texto: "ian, como va? Se lo pudiste pedir?", ts: h(3) }]);
msg(IAN, 0, "si! ya lo pague, ahora espero la proforma", h(3) + 2 * H);
db.prepare("INSERT INTO w_seg_log (id, conv, ts, toque, situacion, quien, texto, plantilla) VALUES ('a1', ?, ?, 1, '2', 'auto', 'buenas ana, pudiste ver la cotizacion? si algo no te cerro decime y lo vemos', 'B')").run(ANA, h(6));
db.prepare("INSERT INTO w_seg_log (id, conv, ts, toque, situacion, quien, texto) VALUES ('man:x:1', ?, ?, 0, '', 'dueno', 'lista html 10/11')").run(ANA, h(4));
const d = await L.aprenderSeguimientos(env);
chk("se registró el seguimiento a mano con el borrador de la IA", n1 === 1 && /cupos/.test(db.prepare("SELECT borrador FROM w_seg_log WHERE quien='mano'").get()?.borrador || ""));
chk("el respondido a mano queda como ejemplo bueno con su respuesta", d.ejemplos.some((e) => /se lo pudiste pedir/i.test(e.texto) && /ya lo pague/.test(e.respuesta)));
chk("la corrección del equipo queda registrada", d.correcciones.some((c) => /cupos/.test(c.borrador) && /se lo pudiste pedir/i.test(c.texto) && c.resp));
chk("el de la IA sin respuesta va a 'no funcionaron' y las notas cargadas a mano no cuentan", d.fallidos.some((c) => /pudiste ver la cotizacion/.test(c.texto)) && !JSON.stringify(d).includes("lista html"));
prompts = [];
db.prepare("DELETE FROM kv WHERE k='seg_ia'").run();
await L.revisarSeguimientos(env, ia, { limite: 0 });
const p1 = prompts[0] || "";
chk("el prompt trae lo aprendido: ejemplos, correcciones y lo que no funcionó", /APRENDIDO DE NUESTROS SEGUIMIENTOS/.test(p1) && /CORRECCIONES DEL EQUIPO/.test(p1) && /NO FUNCIONARON/.test(p1) && /se lo pudiste pedir/i.test(p1));
chk("sin nada aprendido no aparece el bloque", L.aprendidoTexto(null) === "" && L.aprendidoTexto({ ejemplos: [], correcciones: [] }) === "");
const api = await (await L.apiLector(env, new Request("https://x/panel/api/805/seg-aprendido"), new URL("https://x/panel/api/805/seg-aprendido"), null)).json();
chk("el panel puede ver lo aprendido", api.n >= 2);
console.log(`\nsim-seguimientos3: ${ok} ok, ${mal} fallas`); if (mal) throw new Error("simulations failed");
