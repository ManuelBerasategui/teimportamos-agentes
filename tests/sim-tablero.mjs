// Panel nuevo /panel/p: lista "Para hacer" ordenada por cercanía a la venta, equipo por día, ventas, links de origen, IA en cadena.
// Correr desde cotizador/: node ../tests/sim-tablero.mjs
import { DatabaseSync } from "node:sqlite";
import fs from "fs";
let ok = 0, mal = 0; const chk = (n, c) => { c ? ok++ : (mal++, console.log("FALLA:", n)); };
const dir = fs.mkdtempSync("/tmp/tab-");
for (const f of fs.readdirSync("src")) fs.copyFileSync("src/" + f, dir + "/" + f);
const db = new DatabaseSync(":memory:");
const stmt = (sql, b = []) => ({ bind: (...x) => stmt(sql, x), run: async () => { db.prepare(sql).run(...b); return {}; }, first: async () => db.prepare(sql).get(...b) ?? null, all: async () => ({ results: db.prepare(sql).all(...b) }) });
const kv = new Map();
const ESTADO = { get: async (k) => kv.get(k) ?? null, put: async (k, v) => { kv.set(k, v); }, delete: async (k) => { kv.delete(k); }, list: async ({ prefix }) => ({ keys: [...kv.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })) }) };
const env = { DB: { prepare: (s) => stmt(s), batch: async (a) => { for (const x of a) await x.run(); } }, ESTADO };
const L = await import(dir + "/lector.js");
const T = await import(dir + "/tablero.js");
await L.prepararLector(env); await T.prepararTablero(env);
const D = 86400e3, ahora = Date.now(), h = (d) => ahora - d * D;
let nm = 0;
const msg = (conv, yo, texto, ts, autor = null) => db.prepare("INSERT INTO w_msg (id,conv,grupo,yo,autor,texto,ts,hist,tipo) VALUES (?,?,0,?,?,?,?,0,'text')").run("m" + nm++, conv, yo, autor, texto, ts);
const conv = (c, o) => db.prepare(`INSERT INTO w_conv (conv,nombre,grupo,primer_ts,ult_ts,ult_yo,ult_cliente_ts,ult_yo_ts,ult_texto,n,analizado_ts,puntaje,etapa,producto,perfil,presup_usd,resp,cot_pend,archivado,prov,accion)
  VALUES (?,?,0,?,?,?,?,?,?,5,?,?,?,?,?,?,1,?,0,?,?)`).run(c, o.nombre, o.primer ?? h(5), o.ult ?? o.cli, o.ult_yo ?? 0, o.cli ?? 0, o.yo ?? 0, o.texto ?? "", ahora, o.puntaje ?? 6, o.etapa ?? "consulta", o.producto ?? "", o.perfil ?? "C", o.usd ?? null, o.cot ?? 0, o.prov ?? 0, o.accion ?? "");

// Casos
conv("5491100000001", { nombre: "Pago", cli: h(0.2), texto: "listo te transferi la seña, te mando el comprobante", etapa: "negociando" });
conv("5491100000002", { nombre: "Cotizado", cli: h(0.5), texto: "y eso es precio final?", etapa: "cotizado", usd: 900 });
conv("5491100000003", { nombre: "FaltaCot", cli: h(1), texto: "son 200 unidades, 300 g cada una", etapa: "falta_cotizar", cot: 1 });
conv("5491100000004", { nombre: "Consulta", cli: h(0.1), texto: "hola, importan desde china?" });
conv("5491100000005", { nombre: "Cierre", cli: h(0.3), texto: "okk déjame pensar", etapa: "cotizado" });
conv("5491100000006", { nombre: "Agradece", cli: h(0.3), texto: "Excelente, te agradezco, esta muy bueno tener esta opción", etapa: "cotizado" });
conv("5491100000007", { nombre: "Spam", cli: h(0.3), texto: "Una comprobación rápida: ¿estás ofreciendo **25% OFF EN BAZAR**?" });
conv("5491100000008", { nombre: "YaContestado", cli: h(0.5), yo: h(0.4), ult_yo: 1, texto: "te paso el precio" });
conv("5491100000009", { nombre: "Viejo", cli: h(40), texto: "hola?" });
conv("5491100000010", { nombre: "Proveedor", cli: h(0.2), texto: "hola, cuál es el alias?", prov: 1 });

let r = await T.paraHacer(env);
const orden = r.lista.map((i) => i.nombre);
chk("pago primero", orden[0] === "Pago");
chk("orden por cercanía a la venta: pago > cotizado > falta cotizar > consulta", orden.indexOf("Pago") < orden.indexOf("Cotizado") && orden.indexOf("Cotizado") < orden.indexOf("FaltaCot") && orden.indexOf("FaltaCot") < orden.indexOf("Consulta"));
chk("no corta en 3: lista todos los pendientes", r.lista.length >= 4);
chk("saca cierres ('déjame pensar', 'te agradezco')", !orden.includes("Cierre") && !orden.includes("Agradece"));
chk("saca spam de otros bots", !orden.includes("Spam"));
chk("saca los que ya contestamos", !orden.includes("YaContestado"));
chk("saca lo de más de 14 días", !orden.includes("Viejo"));
chk("saca proveedores", !orden.includes("Proveedor"));

// Listo / perdido / vendido
await T.marcar(env, "listo", { conv: "5491100000004" }, "Manuel");
r = await T.paraHacer(env);
chk("Listo lo saca de la lista", !r.lista.some((i) => i.nombre === "Consulta"));
let v = await T.marcar(env, "vendido", { conv: "5491100000001", monto: "350.000", moneda: "ARS", ganancia: "60.000", linea: "Cupo / compra grupal" }, "Manuel");
chk("venta guardada", v.ok && db.prepare("SELECT COUNT(*) n FROM ventas").get().n === 1);
chk("monto con puntos de miles se lee bien", db.prepare("SELECT monto, ganancia FROM ventas").get().monto === 350000);
chk("el chat vendido sale de la lista", !(await T.paraHacer(env)).lista.some((i) => i.nombre === "Pago"));
chk("sin monto no guarda", !!(await T.marcar(env, "vendido", { conv: "x" }, "M")).error);
await T.marcar(env, "perdido", { conv: "5491100000002", motivo: "Precio total" }, "Manuel");
chk("perdido guarda el motivo", db.prepare("SELECT etapa, motivo FROM w_conv WHERE conv='5491100000002'").get().motivo === "Precio total");
const n = await T.numeros(env, "semana", 2);
chk("números: ventas y ganancia de la semana", n.filas[0].ventas === 1 && n.filas[0].ARS === 350000 && n.filas[0].ganARS === 60000 && n.filas[0].linea["Cupo / compra grupal"].ventas === 1);

// Equipo por día: dispositivos 48-55 son de Manuel, Matías el 6, los bots no cuentan
const hoyD = T.diaAR();
msg("5491100000002", 1, "hola! te paso precio", ahora - 60e3, "x:6@s");
msg("5491100000003", 1, "dale", ahora - 50e3, "x:54@s");
msg("5491100000004", 1, "buenas", ahora - 40e3, "x:52@s");
msg("5491100000004", 1, "otra", ahora - 30e3, "x:52@s");
msg("5491100000005", 1, "Bienvenido!! Te voy a derivar con alguien del equipo", ahora - 20e3, "x:0@s");
await T.calcularDiaEquipo(env, hoyD);
const eq = Object.fromEntries(db.prepare("SELECT persona, chats, mensajes FROM eq_dia WHERE dia=?").all(hoyD).map((x) => [x.persona, x]));
chk("dispositivos 52 y 54 cuentan como Manuel (2 chats, 3 mensajes)", eq.Manuel?.chats === 2 && eq.Manuel?.mensajes === 3);
chk("Matías cuenta aparte", eq["Matías"]?.chats === 1);
chk("el bot de bienvenida no cuenta", !Object.keys(eq).some((k) => /Celular/.test(k)) && (eq.Manuel?.mensajes === 3));
msg("5491100000006", 1, "hola", ahora - 10e3, "x:77@s");
await T.asignarDispositivo(env, "77", "Buko");
await T.calcularDiaEquipo(env, hoyD);
chk("asignar un dispositivo nuevo desde el panel", db.prepare("SELECT chats FROM eq_dia WHERE dia=? AND persona='Buko'").get(hoyD)?.chats === 1);
await T.cronTablero(env);
chk("el cron guarda el día y rellena hacia atrás", !!db.prepare("SELECT v FROM kv WHERE k='eqdia_bf'").get());

// Links de origen
const lk = await T.crearLink(env, { nombre: "historia cupo noviembre", canal: "H", texto: "Hola! quiero entrar al cupo" }, "Manuel");
chk("link con código", lk.codigo === "H1" && /wa\.me\/5493418051515\?text=/.test(lk.link) && decodeURIComponent(lk.link).endsWith("(H1)"));
conv("5491100000020", { nombre: "DesdeHistoria", cli: h(0.05), primer: h(0.05), texto: "Hola! quiero entrar al cupo (H1)" });
msg("5491100000020", 0, "Hola! quiero entrar al cupo (H1)", h(0.05));
conv("5491100000021", { nombre: "DesdeVideo", cli: h(0.05), primer: h(0.05), texto: "Hola como estas! Vi un video tuyo y quiero importar por mayor" });
msg("5491100000021", 0, "Hola como estas! Vi un video tuyo y quiero importar por mayor", h(0.05));
await T.detectarOrigen(env);
chk("detecta el código del link", db.prepare("SELECT origen, origen_cod FROM w_conv WHERE conv='5491100000020'").get().origen === "Historia");
chk("reconoce el mensaje de siempre de los videos", /Instagram/.test(db.prepare("SELECT origen FROM w_conv WHERE conv='5491100000021'").get().origen || ""));
chk("el link cuenta sus chats", (await T.links(env))[0].leads === 1);

// Perdido automático: cotizado, el cliente no escribe hace 13 días y nuestro último mensaje fue hace 6
conv("5491100000030", { nombre: "Silencio", cli: h(13), yo: h(6), ult_yo: 1, ult: h(6), etapa: "cotizado", texto: "te paso" });
conv("5491100000031", { nombre: "Reciente", cli: h(3), yo: h(2), ult_yo: 1, ult: h(2), etapa: "cotizado", texto: "te paso" });
await T.perdidosAutomaticos(env);
chk("marca perdido solo al que ya no respondió los seguimientos", db.prepare("SELECT etapa FROM w_conv WHERE conv='5491100000030'").get().etapa === "perdido" && db.prepare("SELECT etapa FROM w_conv WHERE conv='5491100000031'").get().etapa === "cotizado");
chk("motivo automático", /autom/.test(db.prepare("SELECT motivo FROM w_conv WHERE conv='5491100000030'").get().motivo));
// Venta detectada por el agente: pide confirmación arriba de todo
conv("5491100000032", { nombre: "VentaIA", cli: h(0.5), yo: h(0.4), ult_yo: 1, texto: "listo gracias", etapa: "negociando" });
db.prepare("INSERT INTO w_hito (conv, tipo, ts, dato) VALUES ('5491100000032','venta',?,'20 NFC · $90.000')").run(h(0.4));
r = await T.paraHacer(env);
chk("venta detectada aparece primero para confirmar", r.lista[0]?.nombre === "VentaIA" && r.lista[0].cat === "venta");
await T.marcar(env, "vendido", { conv: "5491100000032", monto: "90000" }, "Manuel");
chk("confirmada la venta, deja de pedirla", !(await T.paraHacer(env)).lista.some((i) => i.nombre === "VentaIA"));
const nd = await T.numeros(env, "dia", 7);
chk("números por día", nd.filas.length === 7 && nd.filas[0].ventas >= 2);
const ctx = await T.contextoTablero(env);
chk("el agente ve día por día los chats cruzados con los videos", ctx.includes("DÍA POR DÍA") && ctx.includes("videos:"));

// TikTok Studio desde la PC
const gs = await T.guardarStudio(env, { videos: [{ id: "7430000000000000001", ts: 1793000000000, texto: "Esto por Mercado Libre", vistas: 12500, likes: 800, guardados: 95, tiempo_ms: 7500, completado: 0.21 }, { id: "malo" }] });
const tt1 = db.prepare("SELECT vistas, guardados, tiempo_ms, fuente FROM tt_posts WHERE id='7430000000000000001'").get();
chk("TikTok Studio guarda los videos válidos con tiempo visto", gs.guardados === 1 && tt1.vistas === 12500 && tt1.tiempo_ms === 7500 && tt1.fuente === "studio");
await T.guardarStudio(env, { videos: [{ id: "7430000000000000001", vistas: 100 }] });
chk("una lectura vieja no baja las vistas", db.prepare("SELECT vistas FROM tt_posts WHERE id='7430000000000000001'").get().vistas === 12500);
chk("TikTok queda marcado como leído para el panel", JSON.parse(db.prepare("SELECT v FROM kv WHERE k='tt_ultimo'").get().v).estado === "OK");

// IA en cadena: Groq sin cupo → pasa a OpenRouter
const { altIA, estadoIA } = await import(dir + "/ia-alterna.js");
const real = globalThis.fetch; const urls = [];
globalThis.fetch = async (url) => { urls.push(String(url)); if (/groq/.test(url)) return new Response("{}", { status: 429, headers: { "retry-after": "120" } }); return new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }), { status: 200 }); };
const envIA = { GROQ_API_KEY: "g", OPENROUTER_API_KEY: "o", ESTADO };
const res = await altIA(envIA, "Devolvé JSON", { prioridad: true });
chk("si Groq no tiene cupo usa OpenRouter", res?.ok === true && /groq/.test(urls[0]) && /openrouter/.test(urls[1]));
urls.length = 0; await altIA(envIA, "Devolvé JSON", { prioridad: true });
chk("Groq descansa y no se vuelve a probar enseguida", !urls.some((u) => /groq/.test(u)));
const est = await estadoIA(envIA);
chk("estado de la IA para el panel", est.alternativas.find((a) => a.id === "groq")?.descansando === true && est.alternativas.find((a) => a.id === "openrouter")?.usosHoy >= 1);
globalThis.fetch = real;

// HTML del panel compila
const { PANEL_P } = await import(dir + "/panel-p.js");
for (const m of PANEL_P.matchAll(/<script>([\s\S]*?)<\/script>/g)) { try { new Function(m[1]); chk("js del panel compila", true); } catch (e) { chk("js del panel: " + e.message, false); } }
chk("pestañas Hoy, Chats, Números, Links, Agente", ["hoy", "chats", "num", "links", "ag"].every((v) => PANEL_P.includes('data-v="' + v + '"')));
chk("sin Telegram", !/telegram/i.test(PANEL_P));
const W = fs.readFileSync("src/worker.js", "utf8");
chk("el panel nuevo es el principal y el viejo queda en /panel/viejo", W.includes('url.pathname === "/panel" || url.pathname === "/panel/p"') && W.includes('"/panel/viejo"'));
chk("rutas del panel nuevo con sesión", W.includes('url.pathname === "/panel/p"') && W.includes('"/panel/p/api/"') && W.indexOf('url.pathname === "/panel/p"') > W.indexOf('url.pathname.startsWith("/panel")'));

console.log(`sim-tablero: ${ok} ok, ${mal} fallas`); process.exit(mal ? 1 : 0);
