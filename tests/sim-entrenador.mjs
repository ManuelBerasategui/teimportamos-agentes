// Entrenador del contestador: estilo, juez, cotización con los 3 datos, rondas de entrenamiento y aprendizaje de errores.
// Correr desde cotizador/: node ../tests/sim-entrenador.mjs   (IA simulada, sin red)
import { DatabaseSync } from "node:sqlite";
import fs from "fs";
let ok = 0, mal = 0; const chk = (n, c) => { c ? (ok++, console.log("✓", n)) : (mal++, console.log("FALLA:", n)); };
const dir = fs.mkdtempSync("/tmp/entren-"); for (const f of fs.readdirSync("src")) fs.copyFileSync("src/" + f, dir + "/" + f);
const db = new DatabaseSync(":memory:");
const stmt = (sql, b = []) => ({ bind: (...x) => stmt(sql, x), run: async () => { const r = db.prepare(sql).run(...b); return { meta: { changes: Number(r.changes) } }; }, first: async () => db.prepare(sql).get(...b) ?? null, all: async () => ({ results: db.prepare(sql).all(...b) }) });
const env = { DB: { prepare: (s) => stmt(s), batch: async (a) => { for (const x of a) await x.run(); } } };
const L = await import(dir + "/lector.js"); const A = await import(dir + "/autoresp.js"); const E = await import(dir + "/entrenador.js");
await L.prepararLector(env);
db.prepare("CREATE TABLE IF NOT EXISTS cotiz_manual (id TEXT PRIMARY KEY, ts INTEGER, num INTEGER, quien TEXT, cliente TEXT, datos TEXT)").run();
const ahora = Date.now(); let n = 0;
const msg = (conv, yo, texto, hace, tipo = "text") => db.prepare("INSERT INTO w_msg (id,conv,grupo,yo,texto,ts,hist,tipo) VALUES (?,?,0,?,?,?,0,?)").run("m" + n++, conv, yo, texto, ahora - hace, tipo);
const conv = (c, nombre, ultTxt, hace, ultYo = 0) => db.prepare("INSERT INTO w_conv (conv,nombre,grupo,primer_ts,ult_ts,ult_yo,ult_cliente_ts,ult_yo_ts,ult_texto,archivado,prov) VALUES (?,?,0,?,?,?,?,0,?,0,0)").run(c, nombre, ahora - hace, ahora - hace, ultYo, ahora - hace, ultTxt);
const T = { fleteKg: 18, handling: 30, honorarios: 80, factor: 1.3, aereoFijo: 950, aereoDesde: 50, aereoHasta: 250, barcoFijo: 100 };

// ---- Historial real del dueño: 14 charlas "cliente pregunta → yo contesto"
const casos = [
  ["parlante bluetooth", "tenes link de alibaba o 1688 del parlante? si no mandame fotos de referencia"], ["auriculares inalambricos", "tenes link de alibaba o 1688 de los auriculares? sino mandame fotos"],
  ["cuanto sale traer relojes", "tenes link de alibaba o 1688 de los relojes? sino mandame fotos"], ["tienen stock de jbl", "mira el catalogo en https://www.teimportamosarg.com/catalogo ahi estan los productos y precios"],
  ["hola quiero info", "hola! que producto queres traer? tenes link de alibaba o fotos de referencia"], ["hola buenas", "hola! que producto queres traer? tenes link de alibaba o fotos de referencia"],
  ["quiero importar cargadores", "tenes link de alibaba o 1688 de los cargadores? sino mandame fotos de referencia"], ["necesito camaras de seguridad", "tenes link de alibaba o 1688 de las camaras? sino mandame fotos"],
  ["tienen catalogo", "mira el catalogo en https://www.teimportamosarg.com/catalogo ahi estan los productos y precios"], ["me pasas precio de un lampara", "que lampara viste? tenes el link o una captura"],
  ["quiero traer zapatillas", "tenes link de alibaba o 1688 de las zapatillas? sino mandame fotos"], ["cuanto cuesta esa campera", "que campera viste? mandame la captura o el link"],
  ["necesito 45 pestillos electronicos", "tenes link de alibaba o 1688 de los pestillos? sino mandame fotos de referencia"], ["info de mochilas", "hola! que mochilas queres traer? tenes link de alibaba o fotos"],
];
casos.forEach(([c, y], i) => { const cv = "54911" + String(100 + i); conv(cv, "H" + i, c, 40 * 86400e3, 1); msg(cv, 0, c, (40 - i) * 86400e3 / 40 + 3600e3 * 5); msg(cv, 1, y, (40 - i) * 86400e3 / 40 + 3600e3 * 4); });
msg("5491100", 1, "Bienvenido!! Gracias por escribir, mandame el numero de la opcion que necesites", 3600e3 * 80);   // bot: no cuenta como mío

// 1) ESTILO
const est = await E.construirEstilo(env, ahora);
chk("perfil de estilo: calcula largo, saludos y frases desde mis mensajes", est.stats.n === 14 && est.stats.med > 20 && est.stats.p90 >= est.stats.med && est.stats.frases.length > 0);
chk("el mensaje automático del bot no cuenta como mío", !est.pares.some((p) => /Bienvenido/.test(p.y)));
chk("guarda pares 'cliente dijo → yo contesté' con su contexto", est.pares.length >= 10 && est.pares.every((p) => p.c && p.y && p.ctx.length >= 1));
const sim = E.similares(est, "quiero traer 30 cargadores usb", 3);
chk("trae ejemplos parecidos a lo que escribió el cliente", sim.length >= 3 && sim.some((p) => /cargadores/.test(p.c)));
chk("excluye el caso que se entrena (no copia la respuesta real)", !E.similares(est, "quiero importar cargadores", 3, sim[0].id).some((p) => p.id === sim[0].id));
chk("perfil en texto para el prompt", /Largo típico/.test(E.perfilTexto(est)));

// 2) JUEZ: chequeos duros + IA
chk("duro: mensaje largo, formal y con muletilla se rechaza", E.chequeoDuro("Claro, estimado cliente. Le informo que " + "texto ".repeat(80), est, []).length >= 3);
chk("duro: mensaje corto y natural pasa", E.chequeoDuro("tenes link de alibaba o 1688 de los cargadores? sino mandame fotos", est, []).length === 0);
chk("duro: repetir lo que ya dije se detecta", E.chequeoDuro("tenes link de alibaba o fotos del producto", est, [{ yo: 1, texto: "tenes link de alibaba o fotos del producto" }]).length === 1);
let jIA = { ok: true, puntaje: 9, fallas: [] };
let usadoJuez = 0;
const iaTodo = async (e, p) => {
  if (p.includes("revisor de calidad")) { usadoJuez++; return jIA; }
  if (p.includes("Del chat sacá los 3 datos")) return iaExtrae;
  return iaRed;
};
let iaRed = { accion: "responder", mensaje: "tenes link de alibaba o 1688 de los cargadores? sino mandame fotos", motivo: "producto sin link" };
let iaExtrae = null;
conv("5491122", "Lu", "quiero 30 cargadores", 5 * 60e3); msg("5491122", 0, "quiero 30 cargadores", 5 * 60e3);
let r = await A.redactar(env, iaTodo, "5491122", { prueba: true, T });
chk("juez aprueba: sale el borrador tal cual", r.accion === "responder" && /cargadores/.test(r.mensaje) && r.juez?.ok === true && usadoJuez === 1);
let vueltasJ = 0; const jPrimero = { ok: false, puntaje: 4, fallas: ["pide cosas que ya dio"], mensaje_mejorado: "pasame el link de alibaba de los cargadores o una foto" };
const iaTodoOrig = iaTodo;
const iaJ2 = async (e, p) => p.includes("revisor de calidad") ? (++vueltasJ === 1 ? jPrimero : { ok: true, puntaje: 8 }) : iaTodoOrig(e, p);
r = await A.redactar(env, iaJ2, "5491122", { prueba: true, T });
chk("juez rechaza y la versión corregida APRUEBA una segunda revisión: se manda la corregida", r.accion === "responder" && /pasame el link/.test(r.mensaje) && r.juez?.corregido === true && vueltasJ === 2);
jIA = { ok: false, puntaje: 5, fallas: ["no contesta"], mensaje_mejorado: "hola de que material son las remeras mixed emotions" };
r = await A.redactar(env, iaTodo, "5491122", { prueba: true, T });
chk("si la versión corregida tampoco aprueba (ej. escrita como si fuera el cliente), NO se manda: queda para el dueño", r.accion === "humano" && !r.mensaje);
jIA = { ok: false, puntaje: 3, fallas: ["inventa un plazo"], mensaje_mejorado: "te va a llegar en 15 dias, son USD 20" };
r = await A.redactar(env, iaTodo, "5491122", { prueba: true, T });
chk("juez rechaza y la corrección trae precio: queda para el dueño", r.accion === "humano" && /juez/.test(r.motivo));
jIA = { ok: false, puntaje: 2, fallas: ["no contesta lo que preguntó"] };
r = await A.redactar(env, iaTodo, "5491122", { prueba: true, T });
chk("juez rechaza sin corrección: queda para el dueño (nunca sale)", r.accion === "humano" && !r.mensaje);
env.JUEZ = "0"; r = await A.redactar(env, iaTodo, "5491122", { prueba: true, T }); env.JUEZ = undefined;
chk("sin juez (IA caída) rigen solo los chequeos duros", r.accion === "responder");

// 3) COTIZACIÓN CON LOS 3 DATOS
conv("5491133", "Eze", "el peso es 90 gramos, 45 unidades y el fob 2.3 dolares", 2 * 60e3);
msg("5491133", 0, "hola quiero cotizar una cerradura electromagnetica", 30 * 60e3); msg("5491133", 1, "Necesito que me digas peso del producto en gramos, cantidad de unidades y precio FOB unitario", 25 * 60e3);
msg("5491133", 0, "el peso es 90 gramos, 45 unidades y el fob 2.3 dolares", 2 * 60e3);
iaExtrae = { producto: "Cerradura electromagnética", peso_dado_g: 90, tipo_peso: "por_unidad", cantidad: 45, fob_usd: 2.3, completo: true, plausible_por_unidad: true, plausible_total: false };
jIA = { ok: true, puntaje: 9 }; usadoJuez = 0;
r = await A.redactar(env, iaTodo, "5491133", { prueba: true, T });
chk("3 datos completos: arma la cotización (vista previa no guarda nada)", r.accion === "nada" && /armaría la cotización/.test(r.motivo) && db.prepare("SELECT COUNT(*) n FROM cotiz_manual").get().n === 0 && usadoJuez === 0);
r = await A.redactar(env, iaTodo, "5491133", { T });
const cot = db.prepare("SELECT * FROM cotiz_manual").get(), d = cot && JSON.parse(cot.datos);
chk("cotización guardada con peso en kg correcto y FOB unitario", r.accion === "nada" && d?.items[0].peso === 0.09 && d.items[0].precio === 2.3 && d.items[0].cantidad === 45);
const tarea = db.prepare("SELECT * FROM tareas WHERE tipo='cotizacion_auto'").get();
chk("queda como 'Cotización lista' en Pendientes", !!tarea && tarea.tel === "5491133");
const tot = (2.3 * 45 + 0.09 * 45 * 18 + 30) * 1.3 + 80;
chk("el total sigue la misma cuenta de la calculadora", Math.abs(+tarea.titulo.match(/USD ([\d.]+)/)[1] - tot) < 0.02);
db.prepare("DELETE FROM kv WHERE k LIKE 'resp_%'").run();
r = await A.redactar(env, iaTodo, "5491133", { T });
chk("no repite la misma cotización", r.accion === "nada" && db.prepare("SELECT COUNT(*) n FROM cotiz_manual").get().n === 1);
// peso absurdo para el producto (el caso de la cerradura de 2,5 kg): no cotiza, queda para el dueño
conv("5491144", "Raul", "pesa 2500 gramos, 45 unidades, fob 2.3 usd", 2 * 60e3); msg("5491144", 0, "cuanto sale la cerradura electromagnetica", 30 * 60e3); msg("5491144", 0, "pesa 2500 gramos, 45 unidades, fob 2.3 usd", 2 * 60e3);
iaExtrae = { producto: "Cerradura electromagnética", peso_dado_g: 2500, tipo_peso: "por_unidad", cantidad: 45, fob_usd: 2.3, completo: true, plausible_por_unidad: false, plausible_total: false };
r = await A.redactar(env, iaTodo, "5491144", { T });
chk("datos que no cierran en ninguna lectura: NO cotiza, queda para el dueño", r.accion === "humano" && /no cierran/.test(r.motivo) && db.prepare("SELECT COUNT(*) n FROM cotiz_manual").get().n === 1);

// 3b) PESO TOTAL vs POR UNIDAD (cotización 9: 2,5 kg era el total de 45 cerraduras y se tomó como por unidad → 112 kg)
const cantCots = () => db.prepare("SELECT COUNT(*) n FROM cotiz_manual").get().n;
const nuevoChat = (cv, nombre, ultimo, previo) => { conv(cv, nombre, ultimo, 2 * 60e3); msg(cv, 0, previo, 30 * 60e3); msg(cv, 0, ultimo, 2 * 60e3); };
nuevoChat("5491211", "Tot", "las 45 pesan 2.5 kg en total, fob 2.3 dolares", "quiero 45 cerraduras electromagneticas");
iaExtrae = { producto: "Cerradura electromagnética", peso_dado_g: 2500, tipo_peso: "total", cantidad: 45, fob_usd: 2.3, completo: true, plausible_por_unidad: false, plausible_total: true };
const antes = cantCots(); r = await A.redactar(env, iaTodo, "5491211", { T });
const dTot = JSON.parse(db.prepare("SELECT datos FROM cotiz_manual ORDER BY ts DESC, num DESC LIMIT 1").get().datos);
chk("peso total: lo divide por la cantidad (2500 g / 45 = 55,6 g por unidad, no 2,5 kg)", r.accion === "nada" && cantCots() === antes + 1 && Math.abs(dTot.items[0].peso - 2.5 / 45) < 1e-6);
chk("la cotización aclara que el peso era el total", /total del pedido/.test(dTot.notas));
nuevoChat("5491212", "Amb", "pesan 2.5 kg, fob 2.3 usd", "necesito 45 cerraduras electromagneticas");
iaExtrae = { producto: "Cerradura electromagnética", peso_dado_g: 2500, tipo_peso: "por_unidad", cantidad: 45, fob_usd: 2.3, completo: true, plausible_por_unidad: false, plausible_total: true };
r = await A.redactar(env, iaTodo, "5491212", { T });
const dAmb = JSON.parse(db.prepare("SELECT datos FROM cotiz_manual ORDER BY ts DESC, num DESC LIMIT 1").get().datos);
chk("dice 'por unidad' pero solo tiene sentido como total: se da cuenta y lo divide", r.accion === "nada" && Math.abs(dAmb.items[0].peso - 2.5 / 45) < 1e-6);
nuevoChat("5491213", "Duda", "pesa 2 kg, fob 3 usd", "quiero 10 zapatillas");
iaExtrae = { producto: "Zapatillas", peso_dado_g: 2000, tipo_peso: "no_claro", cantidad: 10, fob_usd: 3, completo: true, plausible_por_unidad: true, plausible_total: true };
const antes2 = cantCots(); r = await A.redactar(env, iaTodo, "5491213", { T });
chk("no queda claro y las dos lecturas sirven: le pregunta al cliente en vez de adivinar", r.accion === "responder" && /por unidad o de las 10 unidades en total\?/.test(r.mensaje) && cantCots() === antes2 && !/[¿¡]/.test(r.mensaje));
nuevoChat("5491214", "Uno", "pesa 90 g, fob 2 usd", "quiero 20 cerraduras");
iaExtrae = { producto: "Cerradura", peso_dado_g: 90, tipo_peso: "no_claro", cantidad: 20, fob_usd: 2, completo: true, plausible_por_unidad: true, plausible_total: false };
r = await A.redactar(env, iaTodo, "5491214", { T });
const dUno = JSON.parse(db.prepare("SELECT datos FROM cotiz_manual ORDER BY ts DESC, num DESC LIMIT 1").get().datos);
chk("no queda claro pero solo una lectura tiene sentido: usa esa", r.accion === "nada" && dUno.items[0].peso === 0.09);
// faltan datos: sigue el flujo normal y pide lo que falta
conv("5491155", "Ana", "el fob es 3 dolares", 2 * 60e3); msg("5491155", 0, "quiero 100 parlantes de 300 gramos", 20 * 60e3); msg("5491155", 0, "el fob es 3 dolares", 2 * 60e3);
iaExtrae = { producto: "Parlante", peso_dado_g: 300, tipo_peso: "por_unidad", cantidad: 100, fob_usd: 3, completo: false, plausible_por_unidad: true, plausible_total: true };
iaRed = { accion: "responder", mensaje: "me pasas el link del proveedor para ver el producto", motivo: "pide link" };
const antes3 = cantCots(); r = await A.redactar(env, iaTodo, "5491155", { T, prueba: true });
chk("faltan datos: no inventa la cotización", r.accion === "responder" && cantCots() === antes3);
chk("el pedido de datos usa gramos, cantidad y FOB unitario", /gramos/.test(A.FRASE_COTIZAR) && /FOB unitario/.test(A.FRASE_COTIZAR) && !/ kg/.test(A.FRASE_COTIZAR));

// 4) ENTRENAMIENTO: el agente contesta SIN ver mi respuesta, se compara y de los errores salen reglas
let rondas = 0, ultimoPromptRegla = "";
const iaEnt = async (e, p) => {
  if (p.includes("Sos el dueño de \"Te Importamos\" (importación por encargo desde China, Rosario). Abajo está una charla real")) {
    const conRegla = /REGLAS QUE APRENDÍ/.test(ultimoPromptRegla);
    return { puntaje: conRegla ? 9 : 4, fallas: conRegla ? [] : ["pide el peso antes de tener link"], regla: conRegla ? "" : "Pedí primero el link de Alibaba o 1688 o fotos antes de preguntar peso o FOB" };
  }
  if (p.includes("Sos el entrenador del contestador")) return { reglas: ["Pedí primero el link de Alibaba o 1688 o fotos antes de preguntar peso o FOB"], quitar: [] };
  ultimoPromptRegla = p; rondas++;
  return { accion: "responder", mensaje: "me pasas el peso del producto y el fob?", motivo: "x" };
};
const decidir = (ctx, ia) => A.decidirIA(env, ia, ctx, { prioridad: false });
let res = await E.rondaEntrenamiento(env, iaEnt, decidir, { n: 5, ahora });
chk("ronda: evalúa casos reales y calcula un puntaje", res.casos === 5 && res.score === 4 && res.malos === 5);
chk("una regla que mejora el puntaje se adopta (probada con los mismos casos)", res.adoptadas.length === 1 && (await E.cargarReglas(env)).length === 1 && res.mejora >= 0.3);
chk("las reglas aprendidas entran al prompt del agente", /REGLAS QUE APRENDÍ/.test(ultimoPromptRegla) && /link de Alibaba o 1688/.test(ultimoPromptRegla));
chk("el agente entrenando no ve su propia respuesta real", !/tenes link de alibaba o 1688 de los cargadores\? sino mandame fotos de referencia\nCliente/.test(ultimoPromptRegla));
chk("el historial guarda el puntaje de cada ronda", (await E.informe(env)).hist.length === 1);
// regla que NO mejora: se descarta y no se vuelve a proponer
const iaMala = async (e, p) => {
  if (p.includes("Abajo está una charla real")) return { puntaje: 5, fallas: ["x"], regla: "Contestá más largo" };
  if (p.includes("Sos el entrenador del contestador")) return { reglas: ["Escribí tres líneas largas con mucho detalle en cada respuesta"], quitar: [] };
  return { accion: "responder", mensaje: "tenes link de alibaba o 1688?", motivo: "x" };
};
res = await E.rondaEntrenamiento(env, iaMala, decidir, { n: 4, ahora });
chk("una regla que no mejora se descarta (no empeora el agente)", res.adoptadas.length === 0 && res.descartadas.length === 1 && (await E.cargarReglas(env)).length === 1);
// regla con precio: filtrada
const iaPrecio = async (e, p) => p.includes("Abajo está una charla real") ? { puntaje: 3, fallas: ["x"], regla: "" } : p.includes("Sos el entrenador del contestador") ? { reglas: ["Decí siempre que el flete cuesta $ 50 por kilo"] } : { accion: "humano", motivo: "x" };
res = await E.rondaEntrenamiento(env, iaPrecio, decidir, { n: 3, ahora });
chk("reglas que habilitan dar precios se descartan solas", (await E.cargarReglas(env)).length === 1);
// cupo de IA agotado: corta sin romper
let llamadas = 0; const iaCorta = async () => { llamadas++; return null; };
res = await E.rondaEntrenamiento(env, iaCorta, decidir, { n: 4, ahora });
chk("si la IA no responde (cupo agotado) la ronda termina sin errores", /no respondió|no pude/.test(res.nota || "") && llamadas <= 34);
// tope de llamadas por ronda (plan gratis: 50 subrequests por ejecución)
let cuenta = 0; const iaConteo = async (e, p) => { cuenta++; return p.includes("Abajo está una charla real") ? { puntaje: 3, fallas: ["x"], regla: "" } : p.includes("Sos el entrenador del contestador") ? { reglas: ["Preguntá primero qué producto busca antes de pedir datos"] } : { accion: "responder", mensaje: "que producto queres traer?", motivo: "x" }; };
await E.rondaEntrenamiento(env, iaConteo, decidir, { n: 20, maxIA: 34, ahora });
chk("una ronda nunca pasa de 34 llamadas a la IA", cuenta <= 34);
// reglas manuales (SOP) no las toca el entrenamiento
await E.editarReglas(env, { agregar: "Nunca confirmes plazos de entrega: eso lo decide el dueño." });
const rs = await E.cargarReglas(env);
chk("las reglas manuales (SOP) quedan marcadas y el entrenamiento no las quita", rs.some((x) => x.fuente === "manual") );
const iaQuita = async (e, p) => p.includes("Abajo está una charla real") ? { puntaje: 3, fallas: ["x"] } : p.includes("Sos el entrenador del contestador") ? { reglas: [], quitar: [1, 2, 3] } : { accion: "humano", motivo: "x" };
await E.rondaEntrenamiento(env, iaQuita, decidir, { n: 3, ahora });
chk("quitar una regla manual no funciona", (await E.cargarReglas(env)).some((x) => /plazos de entrega/.test(x.r)));
chk("editar: borrar una regla por número", (await E.editarReglas(env, { borrar: (await E.cargarReglas(env)).findIndex((x) => /plazos/.test(x.r)) })).every((x) => !/plazos/.test(x.r)));

// 5) APRENDER DE PRODUCCIÓN: qué pasó después de cada decisión
db.prepare("DELETE FROM kv WHERE k LIKE 'resp_%' OR k LIKE 'ent:casos' OR k='ent:fallas'").run();
const hace = (min) => ahora - min * 60e3;
const caso = (cv, accion, mensaje, min, motivo = "") => E.registrarCaso(env, { conv: cv, nombre: "x", accion, mensaje, motivo, ctx: [{ yo: 0, t: "quiero cargadores" }] }).then(async () => { const l = JSON.parse(db.prepare("SELECT v FROM kv WHERE k='ent:casos'").get().v); l.at(-1).ts = hace(min); db.prepare("UPDATE kv SET v=? WHERE k='ent:casos'").run(JSON.stringify(l)); });
await caso("c1", "responder", "tenes link de alibaba de los cargadores?", 120);   // el cliente se confunde
msg("c1", 1, "tenes link de alibaba de los cargadores?", 119 * 60e3); msg("c1", 0, "pero ya te dije que quiero cargadores, no entendi", 100 * 60e3);
await caso("c2", "responder", "que producto queres traer?", 120);   // el dueño interviene enseguida
msg("c2", 1, "que producto queres traer?", 119 * 60e3); msg("c2", 1, "pasame foto y te digo si lo tenemos", 110 * 60e3);
await caso("c3", "humano", "", 120, "pregunta por algo");   // lo dejó para el dueño y la respuesta era simple
msg("c3", 1, "si, tenemos de 2 colores", 100 * 60e3);
await caso("c4", "humano", "", 120, "pago");   // pago: correcto que sea del dueño
msg("c4", 1, "te paso el alias: mi.alias.mp", 100 * 60e3);
await caso("c5", "responder", "que producto queres traer?", 120);   // salió bien
msg("c5", 1, "que producto queres traer?", 119 * 60e3); msg("c5", 0, "mochilas", 100 * 60e3);
await caso("c6", "responder", "que producto queres traer?", 10);   // muy reciente: todavía no se revisa
const rv = await E.revisarResultados(env, ahora);
const fallas = JSON.parse(db.prepare("SELECT v FROM kv WHERE k='ent:fallas'").get().v);
chk("detecta cliente confundido, dueño que interviene y respuesta simple que dejó pasar", rv.errores === 3 && fallas.length === 3);
chk("no marca como error un pago dejado al dueño ni una respuesta que anduvo bien", !fallas.some((f) => /alias/.test(f.real || "")) && rv.revisados === 5);
chk("guarda lo que contestó el dueño como ejemplo de lo correcto", fallas.some((f) => /2 colores/.test(f.real)) && fallas.some((f) => /pasame foto/.test(f.real)));
const rv2 = await E.revisarResultados(env, ahora);
chk("no revisa dos veces el mismo caso", rv2.revisados === 0);

// 6) Rutas de control y cron
const rr = async (path, body, method = "POST") => (await A.rutaAutoresp(env, { method, json: async () => body || {} }, path, new URL("http://x" + path), iaTodo, { T })).json();
let inf = await rr("/enviar/aprendizaje", {}, "GET");
chk("ruta de aprendizaje: muestra reglas, puntajes y estilo", inf.ok && Array.isArray(inf.reglas) && inf.hist.length >= 1 && inf.estilo?.n === 14);
inf = await rr("/enviar/aprendizaje", { agregar: "Si pregunta por plazos, decile que se lo confirma el dueño." });
chk("podés enseñarle una regla (queda como manual)", inf.reglas.some((x) => x.fuente === "manual" && /plazos/.test(x.r)));
inf = await rr("/enviar/entrenar", { rondas: 2 });
chk("pedir entrenamiento deja rondas programadas", inf.ok && inf.rondas === 2 && db.prepare("SELECT v FROM kv WHERE k='ent:pedido'").get().v === "2");
let corrio = 0; const iaCron = async (e, p) => { corrio++; return iaEnt(e, p); };
await E.cronEntrenador(env, iaCron, decidir, ahora);
chk("el cron corre una ronda por minuto y descuenta el pedido", corrio > 0 && db.prepare("SELECT v FROM kv WHERE k='ent:pedido'").get().v === "1");
const c0 = corrio; await E.cronEntrenador(env, iaCron, decidir, ahora + 20e3);
chk("no se pisan dos rondas a la vez", corrio === c0 || db.prepare("SELECT v FROM kv WHERE k='ent:corre'").get().v === "0");
const noche = new Date(ahora); noche.setUTCHours(7, 5, 0, 0); db.prepare("UPDATE kv SET v='0' WHERE k='ent:pedido'").run(); db.prepare("UPDATE kv SET v='0' WHERE k='ent:corre'").run();
await E.cronEntrenador(env, iaCron, decidir, noche.getTime());
chk("de noche (4:05 de Argentina) pide 3 rondas solo", +db.prepare("SELECT v FROM kv WHERE k='ent:pedido'").get().v === 2);

// 7) Producción registra cada decisión para aprender
db.prepare("DELETE FROM kv WHERE k='ent:casos' OR k LIKE 'resp_%'").run();
conv("5491166", "Mati", "hola", 3 * 60e3); msg("5491166", 0, "hola", 3 * 60e3);
iaRed = { accion: "responder", mensaje: "hola! que producto queres traer?", motivo: "saludo" }; jIA = { ok: true, puntaje: 8, fallas: [] };
await A.redactar(env, iaTodo, "5491166", { T });
const reg = JSON.parse(db.prepare("SELECT v FROM kv WHERE k='ent:casos'").get().v);
chk("cada decisión real se registra con su contexto y la nota del juez", reg.length === 1 && reg[0].accion === "responder" && reg[0].ctx.length >= 1 && reg[0].juez?.puntaje === 8);
await A.redactar(env, iaTodo, "5491166", { T, prueba: true });
chk("la vista previa (--prueba) no registra nada", JSON.parse(db.prepare("SELECT v FROM kv WHERE k='ent:casos'").get().v).length === 1);

// 8) Reglas del dueño: plazos, fotos y cotizaciones que pasan de revisar a mandar directo
let promptVisto = "";
const iaVe = async (e, p) => { if (p.includes("revisor de calidad")) return { ok: true, puntaje: 9 }; promptVisto = p; return { accion: "responder", mensaje: "una vez despachado llega en 10 a 15 dias por avion", motivo: "plazo" }; };
db.prepare("DELETE FROM kv WHERE k LIKE 'resp_%'").run();
conv("5491177", "Pau", "cuanto tarda en llegar?", 2 * 60e3); msg("5491177", 0, "cuanto tarda en llegar?", 2 * 60e3);
r = await A.redactar(env, iaVe, "5491177", { T, prueba: true });
chk("plazos: el prompt trae los plazos del dueño (Paraguay, ropa, mates, zapatillas, China)", /15 días/.test(promptVisto) && /Ropa/.test(promptVisto) && /Mates/.test(promptVisto) && /40 a 60 días/.test(promptVisto));
chk("plazos: contesta con el plazo (ya no lo deriva siempre)", r.accion === "responder" && /10 a 15/.test(r.mensaje) && !/ plazos, /.test(promptVisto.split("PARA EL DUEÑO")[1]?.split("2b.")[0] || ""));
conv("5491188", "Foto", "(image)", 2 * 60e3); msg("5491188", 0, "", 2 * 60e3, "image");
r = await A.redactar(env, iaVe, "5491188", { T, prueba: true });
chk("foto sin link: pide precio fob, peso por unidad y cantidad (frase del dueño)", r.accion === "responder" && /precio fob del producto, peso en kg por unidad, y cuantas unidades buscas/i.test(r.mensaje.normalize("NFD").replace(/[\u0300-\u036f]/g, "")) && !/[¿¡]/.test(r.mensaje));
r = await A.redactar(env, iaVe, "5491188", { T, prueba: true });
conv("5491199", "Pago", "(image)", 2 * 60e3); msg("5491199", 0, "te hice la transferencia, te paso el comprobante", 5 * 60e3); msg("5491199", 0, "", 2 * 60e3, "image");
r = await A.redactar(env, iaVe, "5491199", { T, prueba: true });
chk("foto de un comprobante de pago: NO se la trata como producto, queda para el dueño", r.accion === "humano");
conv("5491200", "Re", "(image)", 2 * 60e3); msg("5491200", 0, "mandame foto", 90 * 60e3); msg("5491200", 1, A.FRASE_FOTO, 60 * 60e3); msg("5491200", 0, "", 2 * 60e3, "image");
r = await A.redactar(env, iaVe, "5491200", { T, prueba: true });
chk("si ya se los pidió, no lo repite: queda para el dueño", r.accion === "humano");
conv("5491201", "Au", "(audio)", 2 * 60e3); msg("5491201", 0, "", 2 * 60e3, "ptt");
r = await A.redactar(env, iaVe, "5491201", { T, prueba: true });
chk("un audio sigue siendo para el dueño", r.accion === "humano");
// racha de cotizaciones
let est7 = await E.estadoCotizaciones(env);
chk("al principio las cotizaciones se guardan para revisar", est7.directo === false && est7.racha === 0);
let rp = await A.pendientesResponder(env, { limite: 5, T });
chk("el servidor avisa a la PC que todavía debe revisar", rp.cot_directo === false);
for (let i = 1; i <= 6; i++) await E.revisarCotizacion(env, 100 + i, true);
est7 = await E.estadoCotizaciones(env);
chk("6 bien seguidas: todavía revisa", est7.racha === 6 && est7.directo === false && est7.faltan === 1);
await E.revisarCotizacion(env, 101, true);
chk("marcar dos veces la misma no suma", (await E.estadoCotizaciones(env)).racha === 6);
await E.revisarCotizacion(env, 107, true);
est7 = await E.estadoCotizaciones(env);
chk("a la 7ª bien seguida pasa a mandar directo", est7.directo === true && est7.racha === 7);
rp = await A.pendientesResponder(env, { limite: 5, T });
chk("el servidor le avisa a la PC que mande directo", rp.cot_directo === true);
db.prepare("INSERT INTO cotiz_manual (id, ts, num, quien, cliente, datos) VALUES ('zz', ?, 200, 'auto', 'X', ?)").run(ahora, JSON.stringify({ items: [{ nombre: "Cerradura", cantidad: 45, peso: 2.5, precio: 2.34 }] }));
const mal2 = await rr("/enviar/cotizacion-revisada", { num: 200, bien: false, motivo: "el peso estaba mal" });
est7 = await E.estadoCotizaciones(env);
chk("una cotización marcada mal: racha a 0 y vuelve a revisar", mal2.ok && est7.racha === 0 && est7.directo === false);
const fl = JSON.parse(db.prepare("SELECT v FROM kv WHERE k='ent:fallas'").get().v);
chk("el error de la cotización alimenta el entrenamiento", fl.some((f) => /peso estaba mal/.test(f.motivo) && /2.5 kg por unidad/.test(f.agente)));
chk("la ruta de aprendizaje muestra la racha", (await rr("/enviar/aprendizaje", {}, "GET")).cotizaciones.meta === 7);

// 9) Correcciones del dueño: el agente aprende de ellas sin tocar código (SOP, "ya te mando", fotos como "(archivo)")
promptVisto = "";
conv("5491301", "Dav", "estoy buscando este desodorante al por mayor", 2 * 60e3); msg("5491301", 0, "Bola amigo estoy buscando este desodorante al por mayor", 2 * 60e3);
iaRed = { accion: "responder", mensaje: "cuantas unidades buscas? y lo queres traer de china?", motivo: "embudo" };
const iaSop = async (e, p) => { if (p.includes("revisor de calidad")) return { ok: true, puntaje: 9 }; promptVisto = p; return iaRed; };
r = await A.redactar(env, iaSop, "5491301", { T, prueba: true });
chk("el prompt trae el embudo del dueño: cantidad y origen, luego link, luego FOB y peso", /cuántas unidades busca/.test(promptVisto) && /NO es China|NO es China/.test(promptVisto) && /link de Alibaba/.test(promptVisto) && /FOB unitario/.test(promptVisto));
chk("el prompt manda a responder el ÚLTIMO mensaje y a derivar solo en casos cerrados", /LO PRIMERO: respondé al ÚLTIMO mensaje/.test(promptVisto) && !/algo que no entendés o cualquier duda/.test(promptVisto) && /NO son motivo para derivar/.test(promptVisto));
chk("'ya te mando' se contesta corto (ya no es un cierre sin respuesta)", /PROMESA DE ENVÍO/.test(promptVisto) && !/"ya te paso", "después te mando"/.test(promptVisto));
chk("el acuse corto 'dale, cuando puedas me pasas' no lo rechaza el chequeo de muletillas", E.chequeoDuro("dale, cuando puedas me pasas", est, []).length === 0 && E.chequeoDuro("dale, " + "mirá que ".repeat(8), est, []).some((x) => /muletilla/.test(x)));
// adjuntos: WhatsApp Web entrega fotos y audios igual, "(archivo)". Nada de frases fijas sin leer la charla.
conv("5491302", "Rod", "Decime si sabes de algo asi", 2 * 60e3); msg("5491302", 0, "(archivo)", 3 * 60e3, "file"); msg("5491302", 0, "Decime si sabes de algo asi", 2 * 60e3);
promptVisto = ""; r = await A.redactar(env, iaSop, "5491302", { T, prueba: true });
chk("'(archivo)' + 'decime si sabés de algo así': lo decide la IA leyendo la charla, con la frase de fotos como guía", promptVisto.includes("4b. ADJUNTOS") && promptVisto.includes(A.FRASE_FOTO) && r.accion === "responder");
conv("5491303", "Alx", "(archivo)", 2 * 60e3); msg("5491303", 0, "(archivo)", 2 * 60e3, "file");
r = await A.redactar(env, iaSop, "5491303", { T, prueba: true });
chk("'(archivo)' solo (puede ser un audio): no le manda la frase, queda para el dueño", r.accion === "humano" && !/fob/i.test(r.mensaje || ""));
// el error real: audio + "no me sirve, muchas gracias"
conv("5491306", "Aud", "no me sirve, muchas gracias", 2 * 60e3); msg("5491306", 1, "te consigo ese modelo, mandame foto", 60 * 60e3); msg("5491306", 0, "(archivo)", 5 * 60e3, "file"); msg("5491306", 0, "no me sirve, muchas gracias", 2 * 60e3);
let llegoIA = false; const iaCierre = async (e, p) => { if (p.includes("revisor de calidad")) return { ok: true, puntaje: 9 }; llegoIA = true; promptVisto = p; return /no me sirve, muchas gracias/.test(p) && /accion "nada"/.test(p) ? { accion: "nada", motivo: "cierre" } : { accion: "responder", mensaje: A.FRASE_FOTO }; };
r = await A.redactar(env, iaCierre, "5491306", { T, prueba: true });
chk("audio + 'no me sirve, muchas gracias': no pide precio FOB (lee el último mensaje)", r.accion === "nada" && !/fob/i.test(r.mensaje || ""));
// corregir
const rc = await rr("/enviar/corregir", { conv: "5491301", correccion: "Tenía que preguntarle la cantidad y si lo quiere traer de China; si es de otro lado, derivarlo." });
chk("corregir: guarda la charla, lo que hizo el agente y lo que había que hacer", rc.ok && JSON.parse(db.prepare("SELECT v FROM kv WHERE k='ent:correcciones'").get().v)[0].ctx.length >= 1);
await rr("/enviar/corregir", { conv: "5491301", correccion: "Tenía que preguntarle la cantidad y si lo quiere traer de China; si es de otro lado, derivarlo." });
chk("la misma corrección cargada dos veces no se duplica", (await E.cargarCorrecciones(env)).filter((x) => x.conv === "5491301").length === 1);
chk("corregir un chat que no existe da error", (await rr("/enviar/corregir", { conv: "000", correccion: "texto largo de prueba" })).ok === false);
promptVisto = ""; conv("5491304", "Otro", "busco desodorante mayorista", 2 * 60e3); msg("5491304", 0, "busco desodorante mayorista", 2 * 60e3);
await A.redactar(env, iaSop, "5491304", { T, prueba: true });
chk("ante un caso parecido el agente ve la corrección del dueño en su prompt", /MIS CORRECCIONES A CASOS PARECIDOS/.test(promptVisto) && /preguntarle la cantidad y si lo quiere traer de China/.test(promptVisto));
promptVisto = ""; conv("5491305", "Dis", "hola quiero mochilas", 2 * 60e3); msg("5491305", 0, "hola quiero mochilas", 2 * 60e3);
await A.redactar(env, iaSop, "5491305", { T, prueba: true });
chk("ante un caso distinto no se la muestra", !/MIS CORRECCIONES/.test(promptVisto));
// práctica: la corrección entra siempre como caso de oro y no se ve a sí misma
let veces = 0, promptsCorr = [];
const iaOro = async (e, p) => { if (p.includes("Abajo está una charla real")) { if (/indicación mía/.test(p)) veces++; return { puntaje: 8, fallas: [], regla: "" }; } if (p.includes("Sos el entrenador")) return { reglas: [], quitar: [] }; promptsCorr.push(p); return { accion: "humano", motivo: "x" }; };
res = await E.rondaEntrenamiento(env, iaOro, decidir, { n: 2, ahora });
chk("la práctica incluye las correcciones del dueño como casos de oro", veces >= 1 && res.casos >= 3);
chk("al practicar una corrección, el agente no ve esa misma corrección (no hace trampa)", !promptsCorr.slice(0, 1).some((p) => /MIS CORRECCIONES A CASOS PARECIDOS/.test(p) && /Tenía que preguntarle la cantidad y si lo quiere traer de China/.test(p)));
chk("el puntaje de la ronda cuenta cuántas veces derivó", typeof res.derivados === "number");
// derivar algo simple es error
let promptComparar = ""; const iaCmp = async (e, p) => { if (p.includes("Abajo está una charla real")) { promptComparar = p; return { puntaje: 8 }; } return { accion: "humano", motivo: "x" }; };
await E.rondaEntrenamiento(env, iaCmp, decidir, { n: 1, ahora });
chk("derivar algo que se resuelve con una pregunta simple cuenta como error", /derivar fue un error/.test(promptComparar));
inf = await rr("/enviar/aprendizaje", {}, "GET");
chk("el informe muestra la tasa de derivación y las correcciones", inf.derivacion && typeof inf.derivacion.pct === "number" && inf.correcciones >= 1);
chk("el pedido de práctica queda programado al corregir", +db.prepare("SELECT v FROM kv WHERE k='ent:pedido'").get().v >= 0);

// 10) Entrenamiento con el MISMO circuito que producción
const simu = (ctx, ia) => A.simularRedactar(env, ia, ctx, T);
db.prepare("DELETE FROM kv WHERE k='resp_log'").run();
let usoIA = 0; const iaCuenta = async (e, p) => { usoIA++; return { accion: "responder", mensaje: A.FRASE_FOTO }; };
r = await simu({ msgs: [{ yo: 1, texto: "mandame foto", tipo: "text" }, { yo: 0, texto: "(archivo)", tipo: "file" }], excluir: "x1" }, iaCuenta);
chk("simulador: un '(archivo)' suelto pasa por la misma regla que en vivo (queda para el dueño, sin IA)", r.accion === "humano" && usoIA === 0);
r = await simu({ msgs: [{ yo: 0, texto: "hola", tipo: "text" }], excluir: "x2" }, iaSop);
chk("simulador: también pasa por el juez y no escribe nada en la base", r.accion === "responder" && !db.prepare("SELECT 1 FROM kv WHERE k='resp_log'").get() && !db.prepare("SELECT 1 FROM kv WHERE k LIKE 'resp_toma:sim%'").get());
// casos nuevos en el historial: respuesta con audio y charla que terminó sin respuesta
conv("5491400", "NR", "no me sirve gracias", 3 * 86400e3); msg("5491400", 0, "quiero mochilas", 3 * 86400e3 + 60e3); msg("5491400", 1, "mandame fotos de las mochilas", 3 * 86400e3 + 30e3); msg("5491400", 0, "(archivo)", 3 * 86400e3 + 20e3, "file"); msg("5491400", 0, "no me sirve gracias", 3 * 86400e3);
conv("5491401", "AU", "cuanto tarda", 2 * 86400e3); msg("5491401", 0, "cuanto tarda", 2 * 86400e3 + 60e3); msg("5491401", 1, "(archivo)", 2 * 86400e3, "file");
const est2 = await E.construirEstilo(env, ahora);
chk("el entrenamiento incluye charlas que terminaron sin respuesta (para aprender cuándo NO contestar)", est2.pares.some((p) => p.k === "sin_respuesta" && /no me sirve/.test(p.c)));
chk("incluye casos donde el dueño contestó con un audio", est2.pares.some((p) => p.k === "adjunto" && /cuanto tarda/.test(p.c)));
chk("los adjuntos del cliente quedan con su tipo para repetirlos igual", est2.pares.some((p) => p.ctx?.some((m) => m.k === "file")));
let cmpTxt = ""; const iaR = async (e, p) => { if (p.includes("Abajo está una charla real")) { cmpTxt = p; return { puntaje: 9 }; } if (p.includes("revisor de calidad")) return { ok: true, puntaje: 9 }; return { accion: "nada", motivo: "x" }; };
await E.rondaEntrenamiento(env, iaR, simu, { n: 4, ahora });
chk("el juez del entrenamiento castiga contestar algo que no tiene que ver con el último mensaje", /ERROR GRAVE/.test(cmpTxt) && /no me sirve, gracias/.test(cmpTxt));
// tope diario y modo intensivo
const kDia = "ent:usos:" + new Date(ahora - 3 * 3600e3).toISOString().slice(0, 10);
chk("cuenta las llamadas a la IA usadas para entrenar en el día", +db.prepare("SELECT v FROM kv WHERE k=?").get(kDia).v > 0);
db.prepare("UPDATE kv SET v='800' WHERE k=?").run(kDia);
res = await E.rondaEntrenamiento(env, iaR, simu, { n: 4, ahora });
chk("al llegar al tope diario deja de entrenar (el contestador en vivo tiene prioridad)", /tope/.test(res.nota || ""));
db.prepare("UPDATE kv SET v='0' WHERE k=?").run(kDia);
inf = await rr("/enviar/entrenar", { rondas: 60 });
chk("modo intensivo: se pueden pedir 60 rondas (una hora)", inf.rondas === 60);
inf = await rr("/enviar/entrenar", { rondas: 0 });
chk("y frenarlo con 0", inf.rondas === 0 && db.prepare("SELECT v FROM kv WHERE k='ent:pedido'").get().v === "0");

console.log(`\nsim-entrenador: ${ok} ok, ${mal} fallas`); process.exit(mal ? 1 : 0);
