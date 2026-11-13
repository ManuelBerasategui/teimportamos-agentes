// La mesa de agentes: hechos medidos por el código, 3 agentes + integrador, hipótesis que se verifican solas,
// seguimientos A/B medidos, charla con la mesa, aviso al dueño. Correr desde cotizador/: node ../tests/sim-mesa.mjs
import { DatabaseSync } from "node:sqlite";
import fs from "fs";
let ok = 0, mal = 0; const chk = (n, c) => { c ? ok++ : (mal++, console.log("FALLA:", n)); };
const dir = fs.mkdtempSync("/tmp/mesa-");
for (const f of fs.readdirSync("src")) fs.copyFileSync("src/" + f, dir + "/" + f);
const db = new DatabaseSync(":memory:");
const stmt = (sql, b = []) => ({ bind: (...x) => stmt(sql, x), run: async () => { db.prepare(sql).run(...b); return {}; }, first: async () => db.prepare(sql).get(...b) ?? null, all: async () => ({ results: db.prepare(sql).all(...b) }) });
const kv = new Map();
const ESTADO = { get: async (k) => kv.get(k) ?? null, put: async (k, v) => { kv.set(k, v); }, delete: async (k) => { kv.delete(k); }, list: async ({ prefix }) => ({ keys: [...kv.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })) }) };
const env = { DB: { prepare: (s) => stmt(s), batch: async (a) => { for (const x of a) await x.run(); } }, ESTADO, __captura: [] };
const L = await import(dir + "/lector.js");
const T = await import(dir + "/tablero.js");
const M = await import(dir + "/mesa.js");
await L.prepararLector(env); await T.prepararTablero(env); await M.prepararMesa(env);
db.exec("CREATE TABLE IF NOT EXISTS ig_posts (id TEXT PRIMARY KEY, ts INTEGER, tipo TEXT, media TEXT, en_feed INTEGER, link TEXT, portada TEXT, texto TEXT, formato TEXT, gancho TEXT, alcance INTEGER, vistas INTEGER, guardados INTEGER, compartidos INTEGER, comentarios INTEGER, likes INTEGER, seguidores INTEGER, visitas INTEGER, tiempo_ms INTEGER, actualizado INTEGER)");
db.exec("CREATE TABLE IF NOT EXISTS tt_posts (id TEXT PRIMARY KEY, ts INTEGER, link TEXT, texto TEXT, duracion INTEGER, portada TEXT, vistas INTEGER, likes INTEGER, comentarios INTEGER, compartidos INTEGER, guardados INTEGER, seguidores INTEGER, actualizado INTEGER, guion TEXT)");
db.exec("CREATE TABLE IF NOT EXISTS prospectos (tel TEXT PRIMARY KEY, negocio TEXT, rubro TEXT, ciudad TEXT, estado TEXT, enviado_ts INTEGER, respuesta TEXT, temperatura TEXT, recontacto TEXT, proximo_mensaje TEXT, le_contestamos TEXT, nota TEXT, quien TEXT, act_ts INTEGER)");
db.exec("CREATE TABLE IF NOT EXISTS ig_refs (id TEXT PRIMARY KEY, ts INTEGER, link TEXT, nicho TEXT, que_pasa TEXT, por_que TEXT, usos INTEGER DEFAULT 0, quien TEXT)");
db.exec("CREATE TABLE IF NOT EXISTS virales (id TEXT PRIMARY KEY, ts INTEGER, red TEXT, autor TEXT, link TEXT, texto TEXT, duracion INTEGER, vistas INTEGER, likes INTEGER, comentarios INTEGER, compartidos INTEGER, guardados INTEGER, seguidores INTEGER, fuente TEXT, guion TEXT, leido INTEGER)");
db.exec("CREATE TABLE IF NOT EXISTS ag_mem (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, tipo TEXT, texto TEXT)");
const D = 86400e3, H = 3600e3, ahora = Date.now(), h = (d) => ahora - d * D;
let nm = 0;
const msg = (conv, yo, texto, ts, grupo = 0) => db.prepare("INSERT INTO w_msg (id,conv,grupo,yo,autor,texto,ts,hist,tipo) VALUES (?,?,?,?,?,?,?,0,'text')").run("m" + nm++, conv, grupo, yo, yo ? "x:99@s" : null, texto, ts);
const conv = (c, o) => db.prepare("INSERT INTO w_conv (conv,nombre,grupo,primer_ts,ult_ts,ult_yo,ult_cliente_ts,ult_yo_ts,ult_texto,n,analizado_ts,puntaje,etapa,producto,perfil,presup_usd,motivo,cierre_ts) VALUES (?,?,0,?,?,?,?,?,?,5,?,?,?,?,?,?,?,?)")
  .run(c, o.nombre, o.primer ?? h(3), o.ult ?? o.cli ?? h(1), o.ult_yo ?? 0, o.cli ?? h(1), o.yo ?? 0, o.texto ?? "", ahora, o.puntaje ?? 6, o.etapa ?? "consulta", o.producto ?? null, o.perfil ?? "C", o.usd ?? null, o.motivo ?? null, o.cierre ?? null);
const hito = (c, tipo, ts) => db.prepare("INSERT INTO w_hito (id,conv,tipo,ts,dato) VALUES (?,?,?,?,'')").run(tipo[0] + ":" + c + ts, c, tipo, ts);

// Un negocio de juguete: 6 chats nuevos esta semana, 4 cotizados, 1 venta, 1 perdido; una pregunta sin responder; videos; cupo; seguimientos A y B
conv("5493410000002", { nombre: "Ana", perfil: "A", usd: 900, producto: "100 tarjetas NFC", etapa: "cotizado", cli: h(2), yo: h(1.9), ult_yo: 1 });
msg("5493410000002", 0, "hola, cuanto salen 100 nfc?", h(2)); msg("5493410000002", 1, "Bienvenido!! Te voy a derivar con alguien del equipo", h(2) + 1000); msg("5493410000002", 1, "te paso, USD 470 total", h(2) + 40 * 60e3);
hito("5493410000002", "cotizacion", h(2) + 40 * 60e3);
conv("5493410000001", { nombre: "Beto", perfil: "C", producto: "mallas", etapa: "cotizado", cli: h(1), yo: h(1) - 3 * H, ult_yo: 0, texto: "y el envio cuanto tarda?" });
msg("5493410000001", 1, "USD 15 c/u por docena", h(1) - 3 * H); msg("5493410000001", 0, "y el envio cuanto tarda?", h(1) - 2 * H);
hito("5493410000001", "cotizacion", h(1) - 3 * H);
conv("5493410000004", { nombre: "Caro", perfil: "B", producto: "viales", etapa: "vendido", cli: h(3), yo: h(2.5), ult_yo: 1, cierre: h(2.5) });
msg("5493410000004", 0, "te mando la seña", h(3)); msg("5493410000004", 1, "perfecto, anotado", h(3) + 5 * 60e3);
hito("5493410000004", "cotizacion", h(4)); hito("5493410000004", "venta", h(2.5));
conv("5493410000006", { nombre: "Dani", perfil: "D", producto: "una camiseta", etapa: "perdido", motivo: "caro", cli: h(2), cierre: h(1.5) });
hito("5493410000006", "cotizacion", h(2));
conv("5493410000008", { nombre: "Eli", perfil: "C", producto: "parlantes jbl", etapa: "consulta", primer: h(0.5), cli: h(0.5) });
conv("5493410000003", { nombre: "Fede", perfil: "A", producto: "100 tarjetas NFC", etapa: "consulta", primer: h(0.4), cli: h(0.4) });
conv("5493410000010", { nombre: "Viejo", perfil: "C", producto: "termos", etapa: "cotizado", primer: h(20), cli: h(12), yo: h(11), ult_yo: 1 });
hito("5493410000010", "cotizacion", h(11));
// seguimientos: Ana (par → A) contestó; Viejo (par → A) no; Beto (impar → B) contestó
// (w_seg_log y su columna plantilla las crea prepararMesa)
db.prepare("INSERT INTO w_seg_log VALUES ('s1','5493410000002',?,1,'2','auto','buenas ana, te paso una alternativa','A')").run(h(2.2));
db.prepare("INSERT INTO w_seg_log VALUES ('s2','5493410000010',?,1,'2','auto','buenas, te paso una alternativa','A')").run(h(5));
db.prepare("INSERT INTO w_seg_log VALUES ('s3','5493410000001',?,1,'2','auto','buenas beto, es para revender?','B')").run(h(1.2));
// grupos: un cupo hace 3 días → Ana y Fede preguntaron por NFC después
msg("120363@g.us", 1, "CUPO tarjetas NFC para reseñas de Google, USD 4,7 c/u, cierra el viernes", h(3), 1);
db.prepare("INSERT INTO ig_posts (id, ts, tipo, texto, formato, gancho, alcance, vistas, guardados, compartidos, tiempo_ms) VALUES ('p1',?,'REELS','Vendí 100 NFC','ml_vendi','Cuánto me quedó?',5000,9000,40,12,9000)").run(h(1));
db.prepare("INSERT INTO tt_posts (id, ts, texto, vistas, compartidos, guardados) VALUES ('t1',?,'Vendí 100 NFC',30000,80,200)").run(h(1));
db.prepare("INSERT INTO prospectos (tel, negocio, rubro, estado, enviado_ts, respuesta, temperatura, act_ts) VALUES ('5493419990001','Perfumería X','perfumeria','enviado',?,'si, pasame precios','caliente',?),('5493419990002','Kiosco Y','kiosco','enviado',?,NULL,NULL,?)").run(h(2), h(1), h(2), h(2));

db.prepare("INSERT INTO virales (id, ts, red, autor, link, texto, vistas, compartidos, guardados, seguidores, fuente, guion) VALUES ('v1',?,'tiktok','otro.importador','https://www.tiktok.com/@otro.importador/video/1','Traje 200 termos de China',800000,900,12000,40000,'#importardechina','Compré doscientos termos a dos dólares y mirá lo que pasó en la aduana')").run(h(4));
db.prepare("UPDATE tt_posts SET guion='Vendí cien tarjetas NFC por Mercado Libre, querés saber cuánto me quedó?' WHERE id='t1'").run();

// 1) Hechos medidos
const hh = await M.hechos(env);
chk("embudo 7 días: 6 nuevos, 4 cotizados, 1 venta", hh.embudo.v7.nuevos === 6 && hh.embudo.v7.cotizados === 4 && hh.embudo.v7.ventas === 1);
chk("perfil A+B entre los nuevos", hh.perfiles.ab_pct === 50);
chk("la primera respuesta humana no cuenta al bot (Ana esperó 40 min)", hh.respuesta.n >= 2 && hh.respuesta.p50 >= 5 && hh.respuesta.p50 <= 40);
chk("pregunta sin responder: Beto hace más de 24 h", hh.pendientes.some((p) => p.nombre === "Beto"));
chk("cotizaciones sin respuesta a 48 h se miden", hh.cotizaciones.n >= 3 && hh.cotizaciones.sin_resp >= 1);
chk("seguimientos por plan: A 2 enviados 50%, B 1 enviado 100%", hh.seguimientos.A.n === 2 && hh.seguimientos.A.resp_pct === 50 && hh.seguimientos.B.n === 1 && hh.seguimientos.B.resp_pct === 100);
chk("prospección 7 días: 2 enviados, 1 respondió", hh.prospeccion.enviados_7d === 2 && hh.prospeccion.resp_pct === 50);
chk("productos pedidos agrupados: NFC x2 con perfil A", hh.productos.some((p) => /tarjetas nfc/.test(p.producto) && p.n === 2 && p.ab === 2));
chk("cupo en grupos con consultas relacionadas en 72 h", hh.cupos.lista.length === 1 && hh.cupos.lista[0].relacionadas >= 1);
chk("video con chats atribuidos en 48 h", hh.redes.videos.length === 1 && hh.redes.videos[0].chats_48h >= 2);
chk("venta detectada en el chat y no cargada", hh.ventas.detectadas_sin_cargar.some((v) => v.nombre === "Caro"));
const txt = M.textoHechos(hh);
chk("texto de hechos con todas las secciones", /EMBUDO 7 DÍAS/.test(txt) && /VELOCIDAD HUMANA/.test(txt) && /PLAN A: 2 enviados/.test(txt) && /VIDEOS INSTAGRAM/.test(txt) && /PRODUCTOS PEDIDOS/.test(txt) && /MERCADO LIBRE: sin datos/.test(txt));
chk("virales de otras cuentas y guiones propios llegan al agente de Redes", hh.redes.virales.length === 1 && hh.redes.virales[0].veces === 20 && /VIRALES DE OTRAS CUENTAS/.test(txt) && /DICE: Compré doscientos termos/.test(txt) && /GUION: Vendí cien tarjetas/.test(txt));
chk("métricas medibles", M.medir(hh, "ventas_7d") === 1 && M.medir(hh, "seg_resp_A_pct") === 50 && M.medir(hh, "inventada") === null);

// 2) Corrida completa con IA simulada
const prompts = [];
const ia = async (_e, p) => {
  prompts.push(p);
  if (/AGENTE DE WHATSAPP/.test(p)) return { resumen: "Cotizamos sin próximo paso.", hallazgos: [{ titulo: "Beto sin respuesta", detalle: "preguntó el envío", evidencia: "Beto +5493410000001" }], hipotesis: [{ texto: "Si contestamos en menos de 1 h, responden más", accion: "Manuel contesta antes de 1 h", metrica: "resp_mas_1h_pct", meta: 10, dias: 7 }], ideas: ["responder a Beto"], para_manuel: [] };
  if (/AGENTE DE REDES/.test(p)) return { resumen: "El reel de NFC trajo 2 consultas.", hallazgos: [], hipotesis: [], ideas: ["otro reel de NFC"], para_manuel: [] };
  if (/AGENTE DE PRODUCTOS/.test(p)) return { resumen: "NFC se pide y se vende.", hallazgos: [], hipotesis: [{ texto: "Un cupo de NFC trae consultas", accion: "Sender manda cupo", metrica: "cupo_consultas_72h", meta: 3, dias: 7 }], ideas: [], para_manuel: ["stockear NFC"] };
  if (/^DISCUSIÓN DE LA MESA/.test(p)) return { turnos: [{ agente: "redes", a: "whatsapp", texto: "El reel de NFC trajo 2 chats, qué pasó con ellos?" }, { agente: "whatsapp", a: "redes", texto: "Ana cotizada sin respuesta, Fede sin cotizar." }, { agente: "critico", a: "todos", texto: "Son 2 casos: es una pista, no un patrón." }, { agente: "inventado", a: "nadie", texto: "turno de un agente que no existe" }], acuerdos: ["NFC tiene demanda"], desacuerdos: ["si el cupo o el reel trajo las consultas"], falta_medir: ["origen declarado de Ana y Fede"] };
  if (/^PREPARÁS LA RESPUESTA/.test(p)) return { entendi: "Quiere saber por qué los cupos de esta semana no vendieron y qué cambió contra la vez anterior.", consultas: [{ tipo: "cupos", q: "nfc" }, { tipo: "chat", q: "Beto" }, { tipo: "borrar_todo", q: "x" }], partes: ["productos"] };
  if (/^CHARLA CON MANUEL\. Sos el agente de REDES/.test(p)) return { respuesta: "**El reel de NFC** trajo 2 chats.", guardar: [], hipotesis: [], seguir: ["qué gancho usó el viral de los termos?"] };
  if (/INTEGRADOR/.test(p)) return { lectura: "Arriba bien, abajo se cae: 4 cotizados y 1 venta.", decisiones: [{ que: "Contestarle a Beto", quien: "Manuel", por_que: "pregunta sin responder hace 26 h" }], hipotesis: [{ texto: "Inventada con métrica que no existe", accion: "x", metrica: "nada", meta: 1, dias: 7 }], cambio_rumbo: "", mensaje: "4 cotizados, 1 venta. Beto espera respuesta hace 26 h." };
  if (/Sos la MESA/.test(p)) return { respuesta: "Los cupos esta semana trajeron 2 consultas.", guardar: [{ tipo: "decision", texto: "No cotizar réplicas de marca" }], hipotesis: [{ texto: "Plan A responde más que B", accion: "medir", metrica: "seg_resp_A_pct", meta: 60, dias: 7 }] };
  return null;
};
const r = await M.correrMesa(env, ia, { forzar: true, motivo: "panel" });
chk("corren los 3 agentes, la discusión y el integrador", r.ok && prompts.length === 5);
chk("los agentes razonan con su manual", /CRITERIO DE VENTAS POR CHAT/.test(prompts[0]) && /CRITERIO DE CONTENIDO/.test(prompts[1]) && /CRITERIO DE PRODUCTO/.test(prompts[2]) && /Nunca una sola causa/.test(prompts[0]));
chk("la discusión cruza los informes y se guarda (un agente inventado pasa a ser el crítico)", r.debate.turnos.length === 4 && r.debate.turnos[3].agente === "critico" && r.debate.turnos[3].a === "todos" && /INFORME REDES: \{"resumen":"El reel de NFC/.test(prompts[3]) && db.prepare("SELECT 1 FROM mesa_informes WHERE agente='debate'").get());
chk("el integrador lee la discusión", /DISCUSIÓN ENTRE LOS AGENTES/.test(prompts[4]) && /es una pista, no un patrón/.test(prompts[4]) && /origen declarado de Ana y Fede/.test(prompts[4]));
chk("el agente de WhatsApp lee charlas reales", /CHARLAS REALES/.test(prompts[0]) && /COTIZADO SIN RESPUESTA/.test(prompts[0]) && /Beto/.test(prompts[0]));
chk("el integrador ve los tres informes y el embudo", /WHATSAPP: \{"resumen":"Cotizamos sin próximo paso/.test(prompts[4]) && /EMBUDO 7 DÍAS/.test(prompts[4]));
chk("informes guardados por agente", db.prepare("SELECT COUNT(DISTINCT agente) n FROM mesa_informes").get().n === 5);
const hips = db.prepare("SELECT * FROM mesa_hip").all();
chk("hipótesis con base medida hoy (la de métrica inventada se descarta)", hips.length === 2 && hips.every((x) => x.estado === "activa") && hips.find((x) => x.metrica === "resp_mas_1h_pct").base === hh.respuesta.mas_1h_pct);
chk("avisa al dueño con el mensaje corto", env.__captura.length === 1 && /Beto espera respuesta/.test(env.__captura[0]) && /corrida pedida/.test(env.__captura[0]));
chk("no vuelve a correr sola antes de una hora", (await M.correrMesa(env, ia, { motivo: "cron" })).ok === false);

// 3) Verificación de hipótesis: la de cupos se cumple si el valor llega a la meta; la vencida falla
db.prepare("UPDATE mesa_hip SET vence=? WHERE metrica='resp_mas_1h_pct'").run("2020-01-01");
db.prepare("UPDATE mesa_hip SET meta=1 WHERE metrica='cupo_consultas_72h'").run();
const cerradas = await M.verificarHipotesis(env, await M.hechos(env));
chk("vencida sin llegar → fallida; alcanzada → cumplida", cerradas.length === 2 && cerradas.some((c) => c.estado === "fallida") && cerradas.some((c) => c.estado === "cumplida"));
chk("lo verificado queda en la memoria compartida", db.prepare("SELECT COUNT(*) n FROM ag_mem WHERE texto LIKE 'Hipótesis %'").get().n === 2);

// 4) Charla con la mesa: guarda decisiones e hipótesis del dueño
const q = await M.preguntarMesa(env, ia, "los cupos de esta semana no vendieron nada, qué pasó?");
chk("responde y guarda la charla", /2 consultas/.test(q.respuesta) && db.prepare("SELECT COUNT(*) n FROM mesa_chat").get().n === 2);
chk("guarda la decisión del dueño y su hipótesis", db.prepare("SELECT 1 FROM ag_mem WHERE tipo='decision' AND texto LIKE '%réplicas%'").get() && db.prepare("SELECT 1 FROM mesa_hip WHERE agente='manuel' AND metrica='seg_resp_A_pct'").get());

const pq = prompts.slice(-2);
chk("antes de contestar amplía la pregunta y pide datos a la base", /^PREPARÁS LA RESPUESTA/.test(pq[0]) && /cupos: cada vez que publicamos/.test(pq[0]) && /por qué los cupos de esta semana no vendieron/.test(q.entendi) && q.consultas.length === 2);
chk("la respuesta usa lo que se buscó (cupos de NFC por fecha y la charla de Beto)", /DATOS BUSCADOS PARA ESTA PREGUNTA/.test(pq[1]) && /CONSULTA cupos "nfc"/.test(pq[1]) && /CUPO tarjetas NFC.*consultas de ese producto en 72 h/.test(pq[1]) && /CONSULTA chat "beto"/.test(pq[1]) && /y el envio cuanto tarda/.test(pq[1]) && /LO QUE ENTENDIMOS DE SU MENSAJE: Quiere saber/.test(pq[1]));
const q2 = await M.preguntarMesa(env, ia, "qué grabo?", "redes");
chk("se puede hablar con un agente solo (con su manual y sin asteriscos)", q2.agente === "redes" && q2.respuesta === "El reel de NFC trajo 2 chats." && q2.seguir.length === 1 && /CRITERIO DE CONTENIDO/.test(prompts.at(-1)) && !/CRITERIO DE VENTAS POR CHAT/.test(prompts.at(-1)) && db.prepare("SELECT agente FROM mesa_chat ORDER BY id DESC LIMIT 1").get().agente === "redes");
chk("consultas a la base: solo lectura y solo los tipos conocidos", (await M.ejecutarConsulta(env, { tipo: "borrar_todo", q: "x" })) === null && /Caro/.test(await M.ejecutarConsulta(env, { tipo: "clientes_producto", q: "viales" })) && /Dani.*motivo: caro/.test(await M.ejecutarConsulta(env, { tipo: "perdidos" })) && /otro\.importador.*20x seguidores/.test(await M.ejecutarConsulta(env, { tipo: "virales", q: "termos" })) && /TikTok.*GUION: Vendí cien/.test(await M.ejecutarConsulta(env, { tipo: "videos" })) && /cuanto salen 100 nfc/.test(await M.ejecutarConsulta(env, { tipo: "buscar_mensajes", q: "nfc" })));

// 5) Estado para el panel y API
const est = await M.estadoMesa(env);
chk("estado: informes, hipótesis, hechos resumidos y última corrida", est.informes.integrador && est.hipotesis.length === 3 && est.hechos.embudo.nuevos === 6 && est.ultima.motivo === "panel" && est.informes.debate.datos.turnos.length === 4 && est.virales.lista.length === 1 && est.virales.fuentes.hashtags.length > 3 && est.chat.at(-1).agente === "redes");
const api = async (m, b) => (await M.apiMesa(env, { method: m, json: async () => { throw new Error("cuerpo ya leído"); } }, new URL("https://x/panel/p/api/mesa"), ia, b)).json();   // como en apiTablero: el cuerpo llega leído
chk("API: descartar una hipótesis", (await api("POST", { accion: "hipotesis", id: hips[0].id, estado: "descartada" })).ok && db.prepare("SELECT estado FROM mesa_hip WHERE id=?").get(hips[0].id).estado === "descartada");
chk("API: elegir hashtags y cuentas de los virales y pedir una lectura", (await api("POST", { accion: "fuentes", hashtags: "#importar, alibaba alibaba", perfiles: "@otro.importador" })).fuentes.hashtags.join() === "importar,alibaba" && JSON.parse(db.prepare("SELECT v FROM kv WHERE k='virales_fuentes'").get().v).perfiles[0] === "otro.importador" && (await api("POST", { accion: "virales_leer" })).ok && (await M.estadoMesa(env)).virales.leyendo === true);
chk("API: tendencias de Mercado Libre desde la PC", (await M.guardarML(env, { items: [{ palabra: "tarjetas nfc", puesto: 1, resultados: 1200, precio_min: 3000, precio_max: 9000, vendidos: "+500 vendidos", top: [{ titulo: "Tarjeta NFC", precio: 3500, vendidos: "+500" }] }] })).guardadas === 1 && /MERCADO LIBRE \(leído/.test(M.textoHechos(await M.hechos(env), ["productos"])));

// 6) Cron: corre a las 06:10 AR una vez y a las 20:30 la segunda; no antes de una hora entre intentos
kv.clear(); db.exec("DELETE FROM kv WHERE k LIKE 'mesa_%'"); env.__captura.length = 0;
const ar = (hh2, mm) => { const d = new Date(); d.setUTCHours(hh2 + 3, mm, 0, 0); return d.getTime(); };
await M.cronMesa(env, ia, ar(6, 10)); chk("06:10 corre", env.__captura.length === 1 && /arranque del día/.test(env.__captura[0]));
await M.cronMesa(env, ia, ar(9, 10)); chk("09:10 no repite", env.__captura.length === 1);
await M.cronMesa(env, ia, ar(20, 30)); chk("20:30 cierra el día", env.__captura.length === 2 && /cierre del día/.test(env.__captura[1]));
await M.cronMesa(env, ia, ar(22, 30)); chk("no hay tercera", env.__captura.length === 2);

// 7) Seguimientos A/B: plan fijo por cliente, la PC lo ve y el log lo guarda
chk("plan por último dígito", L.plantillaSeg("5493410000002") === "A" && L.plantillaSeg("5493410000001") === "B");
chk("borradores distintos por plan", /alternativa/.test(L.borradorBase({ nombre: "Ana", toque: 1, conv: "5493410000002" })) && /revender o para tu negocio/.test(L.borradorBase({ nombre: "Beto", toque: 1, conv: "5493410000001" })));

// 8) El panel tiene la pestaña Mesa y su JS compila
const { PANEL_P } = await import(dir + "/panel-p.js");
chk("pestaña Mesa", PANEL_P.includes('data-v="mesa"') && PANEL_P.includes('id="v-mesa"') && PANEL_P.includes('id="mesaCorrer"') && PANEL_P.includes('id="mesaEnv"') && PANEL_P.includes('id="mesaQuien"') && PANEL_P.includes('id="mesaDebate"') && PANEL_P.includes('id="mesaVir"') && !PANEL_P.includes('data-v="ag"'));
chk("la pestaña Agentes es la primera y la que abre por defecto", /<nav id="tabs"><button data-v="mesa" class="on">Agentes/.test(PANEL_P) && PANEL_P.includes('|| "mesa"'));
new Function(PANEL_P.match(/<script>([\s\S]*)<\/script>/)[1]);   // el JS del panel compila
console.log(`\nsim-mesa: ${ok} ok, ${mal} fallas`); if (mal) throw new Error("simulations failed");
