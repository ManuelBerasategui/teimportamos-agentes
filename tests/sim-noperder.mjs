// Contestador: que no se pierda ningún chat y que dos PCs no contesten dos veces. Correr desde cotizador/: node ../tests/sim-noperder.mjs
import { DatabaseSync } from "node:sqlite";
import fs from "fs";
let ok = 0, mal = 0; const chk = (n, c) => { c ? (ok++, console.log("✓", n)) : (mal++, console.log("FALLA:", n)); };
const dir = fs.mkdtempSync("/tmp/noperder-"); for (const f of fs.readdirSync("src")) fs.copyFileSync("src/" + f, dir + "/" + f);
const db = new DatabaseSync(":memory:");
const stmt = (sql, b = []) => ({ bind: (...x) => stmt(sql, x), run: async () => { const r = db.prepare(sql).run(...b); return { meta: { changes: Number(r.changes) } }; }, first: async () => db.prepare(sql).get(...b) ?? null, all: async () => ({ results: db.prepare(sql).all(...b) }) });
const env = { DB: { prepare: (s) => stmt(s), batch: async (a) => { for (const x of a) await x.run(); } } };
const L = await import(dir + "/lector.js"); const A = await import(dir + "/autoresp.js");
await L.prepararLector(env);
const ahora = Date.now(); let n = 0;
const chat = (c, txt, hace) => { db.prepare("INSERT INTO w_conv (conv,nombre,grupo,primer_ts,ult_ts,ult_yo,ult_cliente_ts,ult_yo_ts,ult_texto,archivado,prov) VALUES (?,?,0,?,?,0,?,0,?,0,0)").run(c, "C" + c.slice(-2), ahora - hace, ahora - hace, ahora - hace, txt); db.prepare("INSERT INTO w_msg (id,conv,grupo,yo,texto,ts,hist,tipo) VALUES (?,?,0,0,?,?,0,'text')").run("m" + n++, c, txt, ahora - hace); };
const ia = async () => ({ accion: "responder", mensaje: "¿Qué producto querés traer?", motivo: "saludo" });
const iaNada = async () => ({ accion: "nada", mensaje: "", motivo: "agradece" });
const lista = async (o = {}) => (await A.pendientesResponder(env, { limite: 50, ...o })).lista.map((x) => x.conv);
chat("5491100000001", "hola", 5 * 60e3); chat("5491100000002", "gracias!", 5 * 60e3); chat("5491100000003", "info", 4 * 86400e3);
db.prepare("INSERT INTO tareas (id,ts,tipo,tel,nombre,titulo,estado,ref) VALUES ('t2',?,'cotizacion','5491100000002','x','x','abierta','w805:5491100000002')").run(ahora);

// 1) Dos PCs piden el mismo chat a la vez: solo una lo redacta
const [a, b] = await Promise.all([A.redactar(env, ia, "5491100000001"), A.redactar(env, ia, "5491100000001")]);
chk("dos PCs a la vez: una responde, la otra no", [a, b].filter((x) => x.accion === "responder").length === 1);
chk("sin ¿ ni ¡", !/[¿¡]/.test((a.accion === "responder" ? a : b).mensaje));
// 2) Redactado pero no enviado (Ctrl+C / borrador borrado): no aparece mientras está reservado...
chk("reservado: no se ofrece a otra PC", !(await lista()).includes("5491100000001"));
chk("todavía NO queda como atendido", !db.prepare("SELECT 1 FROM kv WHERE k='resp_auto:5491100000001'").get());
// ...y cuando vence la reserva (10 min) vuelve solo
db.prepare("UPDATE kv SET exp=? WHERE k='resp_toma:5491100000001'").run(ahora - 1);
chk("se cortó sin enviar: vuelve a la lista", (await lista()).includes("5491100000001"));
// 3) Enviado de verdad: queda atendido y no vuelve
const R = (p, body) => L.rutaLector({ ...env, LECTOR_TOKEN: "tok" }, new Request("https://x/lector" + p, { method: "POST", headers: { Authorization: "Bearer tok" }, body: JSON.stringify(body) }), new URL("https://x/lector" + p), null, ia);
await A.redactar(env, ia, "5491100000001"); await R("/enviar/respondido", { conv: "5491100000001" });
db.prepare("UPDATE kv SET exp=? WHERE k LIKE 'resp_toma:%'").run(ahora - 1);
chk("respondido: no vuelve a aparecer", !(await lista()).includes("5491100000001"));
// 4) "gracias": nada → sale de la lista y del panel
await A.redactar(env, iaNada, "5491100000002");
chk("'gracias': no vuelve a la lista", !(await lista()).includes("5491100000002"));
chk("'gracias': se cierra la tarea del panel", db.prepare("SELECT estado FROM tareas WHERE id='t2'").get().estado === "resuelta");
chk("'gracias': sale de Responder ya (visto_ts)", db.prepare("SELECT visto_ts FROM w_conv WHERE conv='5491100000002'").get().visto_ts > 0);
// 5) La PC vio en WhatsApp que lo último es nuestro
chat("5491100000004", "hola?", 3 * 60e3); await R("/enviar/atendido", { conv: "5491100000004" });
chk("atendido (visto en WhatsApp): no se contesta", !(await lista()).includes("5491100000004"));
// 6) Ventana de días
chk("chat de hace 4 días: no con dias=2", !(await lista({ dias: 2 })).includes("5491100000003"));
chk("chat de hace 4 días: sí con dias=7", (await lista({ dias: 7 })).includes("5491100000003"));
// 7) Reparación de marcas de esta noche: decidido 'responder' pero nunca salió
chat("5491100000005", "buenas", 60 * 60e3);
db.prepare("INSERT INTO kv (k,v,exp) VALUES ('resp_auto:5491100000005',?,NULL)").run(String(ahora));
db.prepare("INSERT OR REPLACE INTO kv (k,v,exp) VALUES ('resp_log',?,NULL)").run(JSON.stringify([{ ts: ahora, conv: "5491100000005", accion: "responder", mensaje: "x" }]));
db.prepare("DELETE FROM kv WHERE k='resp_reparado_v1'").run();
chk("marca vieja sin envío: el chat vuelve", (await lista()).includes("5491100000005"));
// 8) Lo marcaste como listo en el panel: el agente no lo toca
chat("5491100000006", "una consulta", 30 * 60e3); db.prepare("UPDATE w_conv SET visto_ts=? WHERE conv='5491100000006'").run(ahora);
chk("marcado como listo en el panel: no se contesta", !(await lista()).includes("5491100000006"));
// 9) Mismo universo que el panel: 14 días por defecto; los que escribieron recién van primero
chat("5491100000007", "hola", 10 * 86400e3); chat("5491100000008", "recién", 2 * 60e3);
const l9 = await lista();
chk("14 días por defecto (como el panel)", l9.includes("5491100000007"));
chk("los que escribieron en las últimas 3 h van antes que los viejos", l9.indexOf("5491100000008") < l9.indexOf("5491100000007") && l9.indexOf("5491100000008") < l9.indexOf("5491100000003"));
chk("informa cuántos quedan", (await A.pendientesResponder(env, { limite: 1 })).quedan >= 3);
console.log(`\nsim-noperder: ${ok} ok, ${mal} fallas`); process.exit(mal ? 1 : 0);
