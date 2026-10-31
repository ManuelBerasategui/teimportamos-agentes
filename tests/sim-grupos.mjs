// Mensajes para los grupos (panel › WhatsApp › Grupos). Correr desde cotizador/: node ../tests/sim-grupos.mjs
import { DatabaseSync } from "node:sqlite";
import fs from "fs";
let ok = 0, mal = 0; const chk = (n, c) => { c ? ok++ : (mal++, console.log("FALLA:", n)); };
const dir = fs.mkdtempSync("/tmp/grp-");
for (const f of fs.readdirSync("src")) fs.copyFileSync("src/" + f, dir + "/" + f);
const db = new DatabaseSync(":memory:");
const stmt = (sql, b = []) => ({ bind: (...x) => stmt(sql, x), run: async () => { db.prepare(sql).run(...b); return {}; }, first: async () => db.prepare(sql).get(...b) ?? null, all: async () => ({ results: db.prepare(sql).all(...b) }) });
const env = { DB: { prepare: (s) => stmt(s), batch: async (a) => { for (const x of a) await x.run(); } } };
const L = await import(dir + "/lector.js");
const G = await import(dir + "/grupos.js");
await L.prepararLector(env);

// 1) Export de iPhone (con LRM, adjuntos, mensaje que empieza en la línea siguiente) y de Android
const ios = "‎[11/5/25, 20:58:20] #TE IMPORTAMOS MAYORISTA ARG 😉🇦🇷 #3: ‎Los mensajes y las llamadas están cifrados.\r\n" +
  "[1/7/26, 19:12:47] Te Importamos: 📱_Lo más vendido en *Tecnología*_\r\n\r\nJBL Go4 → $13 c/u\r\n💰 Precio mayorista\r\n" +
  "‎[7/7/26, 18:34:51] Te Importamos: ‎<adjunto: 00003036-PHOTO-2026-07-07-18-34-51.jpg>\r\n" +
  "[9/10/26, 08:21:07] Te Importamos: ⚽ _NUEVO INGRESO_ ⚽\r\n*PELOTAS IMPORTADAS G5🔥*\r\n*PRECIO MAYORISTA: $35.000* 💰\r\n" +
  "[10/10/26, 10:00:00] ~ Maxi: tienen pelotas número 4?\r\n" +
  "[31/10/26, 19:15:55] Te Importamos:\r\nPRECIOS MAYORISTA DE ZAPATILLAS. Cada marca tiene su carpeta\r\n" +
  "[31/10/26, 19:20:00] Te Importamos: Se eliminó este mensaje.\r\n" +
  "[31/10/26, 19:21:00] Te Importamos: Ignite V55 $11.20 por unidad, consulten por privado\r\n";
const p = G.parsearExport(ios);
chk("remitente = Te Importamos (no el nombre del grupo)", p.remitente === "Te Importamos");
chk("toma 4 mensajes nuestros (sin adjuntos ni borrados)", p.nuestros.length === 4);
chk("mensaje que empieza en la línea siguiente", p.nuestros.some((m) => /^PRECIOS MAYORISTA DE ZAPATILLAS/.test(m.texto)));
chk("fecha en hora argentina", new Date(p.nuestros[0].ts - 3 * 3600e3).toISOString().startsWith("2026-07-01T19:12"));
const android = "1/10/26, 9:20 - Te Importamos: 📦 Pack 2: \"Los Reyes del Hype\" TOTAL DEL PACK: $115.90\n2/10/26, 12:02 p. m. - Te Importamos: 📦 Combo 6: Alta Gama y Energía 💵 TOTAL DEL COMBO: $142,10\n2/10/26, 12:05 - Juan: buenísimo";
const pa = G.parsearExport(android);
chk("export de Android", pa.nuestros.length === 2 && new Date(pa.nuestros[1].ts - 3 * 3600e3).getUTCHours() === 12);

const imp = await G.importarExport(env, ios);
chk("importar guarda los mensajes", imp.ok && imp.nuevos === 4);
chk("reimportar no duplica", (await G.importarExport(env, ios)).nuevos === 0);
chk("archivo sin mensajes nuestros avisa", !(await G.importarExport(env, "hola")).ok);
const est = await G.ejemplosEstilo(env);
chk("los vapers no se usan como ejemplo", est.ejemplos.every((e) => !/ignite/i.test(e.texto)) && est.total === 3);

// Contexto del 805: lo que mandamos en grupos (lector), lo que piden, reportes
const ahora = Date.now();
db.prepare("INSERT INTO w_msg (id,conv,grupo,yo,texto,ts,hist,tipo) VALUES ('g1','120363@g.us',1,1,?,?,0,'text')").run("🔥 COMBO VERANO 👉 x6 mallas Billabong *TOTAL: $72.000* consultas por privado", ahora - 2 * 86400e3);
db.prepare("INSERT INTO w_msg (id,conv,grupo,yo,texto,ts,hist,tipo) VALUES ('g2','120363@g.us',1,0,?,?,0,'text')").run("tienen termos stanley?", ahora - 86400e3);
db.prepare("INSERT INTO w_conv (conv,grupo,ult_ts,producto,etapa) VALUES ('549341000001',0,?,'termo stanley','cotizado'),('549341000002',0,?,'termo stanley','nuevo'),('549341000003',0,?,'elfbar','nuevo')").run(ahora, ahora, ahora);
db.prepare("INSERT INTO reportes (id,tipo,desde,hasta,creado,datos) VALUES ('805_diario:x','805_diario',?,?,?,?)").run(ahora - 86400e3, ahora, ahora, JSON.stringify({ ia: { titular: "Se pidieron muchos termos", claves: ["5 pidieron termos"], difusion: [{ producto: "Termo Stanley", por_que: "5 lo pidieron" }] } }));

// 2) Generar el día con una IA simulada
let prompts = [];
const resp = { mensajes: [
  { hora: "8:30", tipo: "combo", producto: "Combo verano", por_que: "Viene el verano", foto: "mallas sobre fondo blanco", mensaje: "🔥 *COMBO VERANO* 🔥\n👉 x6 mallas\n*TOTAL: $72.000*\nConsultas por privado 📩" },
  { hora: "13:00", tipo: "producto", producto: "Termo Stanley", por_que: "5 lo pidieron", foto: "termo", mensaje: "Lo que tanto pidieron 👇\n*TERMO STANLEY*\n*PRECIO MAYORISTA: [PRECIO]*\nPídanlo por privado" },
  { hora: "16:30", tipo: "producto", producto: "Elfbar", por_que: "x", foto: "x", mensaje: "Elfbar Ice King a precio mayorista, consulten" },
  { hora: "19:30", tipo: "comunidad", producto: "Importamos lo que quieras", por_que: "y", foto: "-", mensaje: "Gentee recuerden que importamos LO QUE QUIERAN, mándennos una foto 📸" },
  { hora: "21:00", tipo: "urgencia", producto: "Pelotas G5", por_que: "z", foto: "pelotas", mensaje: "🚨 *ÚLTIMOS CUPOS* pelotas G5 a *$35.000* 🚨 por privado" },
] };
const ia = async (_env, prompt) => { prompts.push(prompt); return JSON.parse(JSON.stringify(resp)); };
const r = await G.generarDia(env, ia, { dia: "2026-11-01" });
chk("genera 4 mensajes", r.ok && r.mensajes.length === 4);
chk("descarta vapers", r.mensajes.every((m) => !/elfbar/i.test(m.texto)));
chk("hora normalizada", r.mensajes[0].hora === "08:30");
const pr = prompts[0];
chk("el prompt trae ejemplos de estilo", pr.includes("NUEVO INGRESO"));
chk("el prompt trae lo que mandamos en grupos (lector)", pr.includes("COMBO VERANO"));
chk("el prompt trae lo más pedido", pr.includes("termo stanley") && !pr.includes("elfbar\""));
chk("el prompt trae los reportes", pr.includes("Se pidieron muchos termos"));
chk("el prompt trae las preguntas de los grupos", pr.includes("tienen termos stanley"));
chk("el prompt pide no inventar precios", pr.includes("[PRECIO]"));
chk("no regenera si ya existe", !(await G.generarDia(env, ia, { dia: "2026-11-01" })).nuevo && prompts.length === 1);

// 3) Marcar enviado con corrección → aprende
const [m0, m1, , m3] = r.mensajes;
await G.marcar(env, m1.id, "enviado", "Lo que tanto pidieron 👇\n*TERMO STANLEY 1.2L*\n*PRECIO MAYORISTA: $28.000*\nPídanlo por privado 📩");
const s1 = db.prepare("SELECT * FROM g_sug WHERE id=?").get(m1.id);
chk("guarda el texto final", s1.estado === "enviado" && s1.final.includes("$28.000"));
chk("lo enviado pasa a ser ejemplo de estilo", db.prepare("SELECT COUNT(*) n FROM g_estilo WHERE fuente='panel'").get().n === 1);
await G.marcar(env, m3.id, "descartado");

// 4) Otra versión de uno
const r2 = await G.otraVersion(env, async (_e, prompt) => { prompts.push(prompt); return { mensajes: [{ hora: "08:30", tipo: "lista", producto: "Cargadores", por_que: "a", foto: "b", mensaje: "✅ *CARGADORES 35W* x5 [PRECIO] consultas por privado" }] }; }, m0.id, "algo de tecnología");
chk("otra versión reemplaza", r2.ok && r2.mensaje.producto === "Cargadores" && r2.mensaje.estado === "nuevo");
chk("otra versión lleva el pedido del equipo", prompts.at(-1).includes("algo de tecnología"));

// 5) Rehacer el día conserva los enviados
const r3 = await G.generarDia(env, ia, { dia: "2026-11-01", forzar: true });
chk("rehacer conserva el enviado", r3.mensajes.length === 4 && r3.mensajes.some((m) => m.id === m1.id && m.estado === "enviado"));
chk("rehacer ve las correcciones del equipo", prompts.at(-1).includes("$28.000"));

// 6) El lector ve que lo mandamos en el grupo → se marca solo
const hoy = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
const r4 = await G.generarDia(env, ia, { dia: hoy });
const comunidad = r4.mensajes.find((m) => m.tipo === "comunidad");
db.prepare("INSERT INTO w_msg (id,conv,grupo,yo,texto,ts,hist,tipo) VALUES ('g3','120363@g.us',1,1,?,?,0,'text')").run("Gentee recuerden que importamos LO QUE QUIERAN!! mándennos una foto 📸 y les cotizamos", Date.now() + 1000);
const nd = await G.detectarEnviados(env);
chk("detecta lo enviado por el lector (un mensaje real marca una sola propuesta)", nd === 1 && db.prepare("SELECT COUNT(*) n FROM g_sug WHERE tipo='comunidad' AND estado='enviado' AND final LIKE '%les cotizamos%'").get().n === 1);
chk("propuesta del lector toma el texto real", !!comunidad);

// 7) API del panel
const get = async (path, body) => (await G.apiGrupos(env, { method: body ? "POST" : "GET", json: async () => body }, new URL("https://x" + path), ia)).json();
const a = await get("/panel/api/805/grupos/?dia=2026-11-01");
chk("API devuelve el día y el estilo", a.mensajes.length === 4 && a.estilo.exportados === 4 && a.estilo.del_lector === 2);
chk("API historial", (await get("/panel/api/805/grupos/?dia=2026-11-02")).historial.some((h) => h.dia === "2026-11-01"));
await get("/panel/api/805/grupos/telegram", { si: false });
chk("API apagar Telegram", (await get("/panel/api/805/grupos/")).telegram === false);

// 8) Cron: genera a partir de las 7 h y solo una vez
db.prepare("DELETE FROM g_sug").run();
let n = 0; const iaN = async (...x) => { n++; return ia(...x); };
const t6 = Date.parse(hoy + "T09:00:00Z"), t7 = Date.parse(hoy + "T10:05:00Z");   // 6:00 y 7:05 en Argentina
await G.cronGrupos(env, iaN, t6, "https://x"); chk("antes de las 7 no genera", n === 0);
await G.cronGrupos(env, iaN, t7, "https://x"); chk("a las 7 genera", n === 1);
await G.cronGrupos(env, iaN, t7 + 60e3, "https://x"); chk("no repite", n === 1);

// 9) El panel tiene la pestaña y su JS compila
const P = await import(dir + "/lector-panel.js");
chk("pestaña Grupos en el panel", P.PANEL_805.includes('data-v="grupos"') && P.PANEL_805.includes('id="v-grupos"'));
chk("JS del panel compila", (() => { try { new Function(P.PANEL_805.split("<script>")[1].split("</script>")[0]); return true; } catch (e) { console.log(e); return false; } })());
chk("regex de [PRECIO] bien escapada", P.PANEL_805.includes("/\\[(PRECIO|TOTAL)\\]/"));

console.log(`sim-grupos: ${ok} ok, ${mal} fallas`);
if (mal) process.exit(1);
