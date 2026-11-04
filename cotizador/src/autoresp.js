// Contestador automático (lo usa el programita de la PC, carpeta sender/). El worker NO envía nada: decide qué contestar y lo devuelve.
// Rutas (todas bajo /lector/enviar/, con la misma clave del lector):
//   GET  responder   -> chats que esperan respuesta (último mensaje del cliente) o {pausado:true}
//   POST redactar    -> {conv} → {accion:"responder"|"humano"|"nada", mensaje, motivo}
//   POST respondido  -> {conv} (cuenta para el tope por hora)
//   POST pausa       -> {pausa:true|false}   (también: "pausar respuestas" por Telegram)
//   GET  log         -> últimas decisiones
const kvGet = async (env, k) => (await env.DB.prepare("SELECT v FROM kv WHERE k=?").bind(k).first())?.v ?? null;
const kvPut = (env, k, v) => env.DB.prepare("INSERT INTO kv (k,v,exp) VALUES (?,?,NULL) ON CONFLICT(k) DO UPDATE SET v=excluded.v, exp=NULL").bind(k, String(v)).run();
const hora = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 13);
import { calcular, paginaCotizacion, guardarCotizAuto } from "./cotizar.js";
import { cargarEstilo, cargarReglas, reglasTexto, perfilTexto, similares, ejemplosTexto, juzgar, chequeoDuro, registrarCaso, informe, editarReglas, K as KENT, OBJETIVO, PLAZOS, revisarCotizacion, estadoCotizaciones } from "./entrenador.js";
const SIN_VAPES = "lower(COALESCE(producto,'')) NOT LIKE '%vap%' AND lower(COALESCE(producto,'')) NOT LIKE '%elf%bar%'";
export const PRECIO_INFORME = "$5.000";
export const FRASE_FOTO = "Si no te jode, podrías pasarme precio fob del producto, peso en kg por unidad, y cuántas unidades buscás?";   // lo dictó el dueño: cuando mandan fotos sin link
export const FRASE_COTIZAR = "Necesito que me digas peso del producto en gramos, cantidad de unidades y precio FOB unitario";

async function anotarDerivado(env, conv, nombre, resumen) {
  const der = JSON.parse((await kvGet(env, "resp_derivados")) || "{}");
  der[conv] = { nombre, resumen: String(resumen || "revisar").slice(0, 80), ts: Date.now() };
  const claves = Object.keys(der).sort((x, y) => der[y].ts - der[x].ts).slice(0, 200);
  await kvPut(env, "resp_derivados", JSON.stringify(Object.fromEntries(claves.map((k) => [k, der[k]]))));
}

// Cotizaciones que el worker ya armó solo (link de Alibaba + cantidad) y todavía no se le mandaron al cliente
async function cotizacionesListas(env, T) {
  const ts = ((await env.DB.prepare("SELECT id, tel, nombre, datos, ts FROM tareas WHERE tipo='cotizacion_auto' AND estado='abierta' AND ts>=? ORDER BY ts ASC LIMIT 20").bind(Date.now() - 5 * 86400e3).all().catch(() => ({ results: [] }))).results) || [];
  const out = [];
  for (const t of ts) {
    const id = JSON.parse(t.datos || "{}").cotiz;
    if (!id || (await kvGet(env, "cotsent:" + id))) continue;
    const cv = await env.DB.prepare("SELECT nombre, ult_yo_ts FROM w_conv WHERE conv=?").bind(t.tel).first();
    if (!cv || (cv.ult_yo_ts || 0) > t.ts || !/^\d{8,15}$/.test(String(t.tel))) { await kvPut(env, "cotsent:" + id, "lo vio el dueño"); continue; }   // ya le escribiste vos
    const f = await env.DB.prepare("SELECT datos, num FROM cotiz_manual WHERE id=?").bind(id).first();
    if (!f) continue;
    const dd = JSON.parse(f.datos), estimado = /peso estimado/i.test(dd.notas || "");
    if (estimado && env.COTIZ_PESO_ESTIMADO !== "1") {   // el peso no figuraba en la publicación: no se manda sola, queda para que la revises
      if (!(await kvGet(env, "cotder:" + id))) { await kvPut(env, "cotder:" + id, "1"); await anotarDerivado(env, t.tel, cv.nombre || t.nombre, `cotización lista (peso estimado) N° ${f.num}: revisala y mandala`); }
      continue;
    }
    out.push({ conv: t.tel, nombre: cv.nombre || t.nombre, id, num: f.num, total: Math.round(calcular(dd.items, dd, T).total * 100) / 100, estimado });
  }
  return out;
}

export async function pausaAutoresp(env, pausa) { await kvPut(env, "resp_pausa", pausa ? "1" : "0"); }

// Marcas que quedaron mal: el contestador redactaba, marcaba el chat como atendido y si el mensaje no llegaba a salir
// (Ctrl+C, borrador borrado a mano, error) el chat desaparecía de la lista. Se reparan una sola vez.
async function repararMarcas(env) {
  if (await kvGet(env, "resp_reparado_v1")) return;
  const log = JSON.parse((await kvGet(env, "resp_log")) || "[]").filter((x) => x.accion === "responder");
  for (const x of log) {
    const c = await env.DB.prepare("SELECT ult_yo FROM w_conv WHERE conv=?").bind(String(x.conv)).first();
    if (c && !c.ult_yo) await env.DB.prepare("DELETE FROM kv WHERE k=?").bind("resp_auto:" + x.conv).run();
  }
  await kvPut(env, "resp_reparado_v1", Date.now());
}

export async function pendientesResponder(env, { limite = 10, T = null, desde = 0, dias = 14 } = {}) {
  await repararMarcas(env).catch(() => {});   // desde: ignora chats cuyo último mensaje del cliente es anterior (ms)
  if ((await kvGet(env, "resp_pausa")) === "1") return { pausado: true, lista: [] };
  const topeHora = +env.RESP_TOPE_HORA || 40, hechos = +((await kvGet(env, "resp_hora:" + hora())) || 0);
  if (hechos >= topeHora) return { pausado: false, tope: true, lista: [], cotizaciones: [], cot_directo: false };
  const cotizaciones = T ? await cotizacionesListas(env, T) : [];
  const ahora = Date.now();
  // Mismo universo que "Responder ya" del panel (respeta lo que marcaste como listo). Orden: primero los que escribieron
  // en las últimas 3 horas (no hacer esperar a los nuevos), después los mejor puntuados, y entre iguales el más viejo primero
  const filas = (await env.DB.prepare(`SELECT conv, nombre, ult_cliente_ts, ult_texto FROM w_conv WHERE grupo=0 AND archivado=0 AND ult_yo=0 AND COALESCE(prov,0)=0 AND ult_cliente_ts>=? AND ult_cliente_ts<=? AND ult_cliente_ts>COALESCE(visto_ts,0) AND ${SIN_VAPES} AND lower(COALESCE(producto,'')) NOT LIKE '%pod%' ORDER BY (ult_cliente_ts >= ${Date.now() - 3 * 3600e3}) DESC, COALESCE(puntaje,5) DESC, ult_cliente_ts ASC LIMIT 300`).bind(Math.max(ahora - Math.min(Math.max(+dias || 14, 1), 14) * 86400e3, desde || 0), ahora - 45e3).all()).results || [];
  // Solo se consultan las marcas de los chats de esta lista (antes un LIKE recorría toda la tabla kv en cada vuelta)
  // resp_auto = ya decidido/enviado; resp_toma = otra PC lo está atendiendo ahora (vence a los 10 min si se cortó)
  const vistos = {}, tomados = {}, convs = filas.map((f) => String(f.conv));
  for (let i = 0; i < convs.length; i += 45) {
    const lote = convs.slice(i, i + 45), claves = [...lote.map((c) => "resp_auto:" + c), ...lote.map((c) => "resp_toma:" + c)];
    for (const r of (await env.DB.prepare(`SELECT k, v, exp FROM kv WHERE k IN (${claves.map(() => "?").join(",")})`).bind(...claves).all()).results || []) {
      if (r.k.startsWith("resp_auto:")) vistos[r.k.slice(10)] = +r.v;
      else if ((r.exp || 0) > ahora) tomados[r.k.slice(10)] = 1;
    }
  }
  const lista = filas.filter((f) => /^\d{8,15}$/.test(String(f.conv)) && !(vistos[f.conv] >= f.ult_cliente_ts) && !tomados[f.conv]).slice(0, Math.min(limite, topeHora - hechos))
    .map((f) => ({ conv: f.conv, nombre: f.nombre, ult_cliente_ts: f.ult_cliente_ts, ultimo: String(f.ult_texto || "").slice(0, 200) }));
  const quedan = filas.filter((f) => /^\d{8,15}$/.test(String(f.conv)) && !(vistos[f.conv] >= f.ult_cliente_ts)).length;   // incluye los reservados por otra PC
  return { pausado: false, lista, quedan, cotizaciones: cotizaciones.slice(0, Math.max(0, topeHora - hechos)), cot_directo: (await kvGet(env, "cot:directo")) === "1" };
}

const URL_OK = /^https?:\/\/(www\.)?teimportamosarg\.com/i;
export function revisarMensaje(m) {
  const t = String(m || "").trim();
  if (!t) return "vacío";
  if (t.length > 500) return "muy largo";
  const sinInforme = t.split(PRECIO_INFORME).join("").split("$5000").join("");   // el único precio permitido es el del informe
  if (/\b(usd|u\$s|dolar(es)?|dólar(es)?|pesos|ars)\b\s*\$?\s*\d|\$\s*\d|\d[\d.,]*\s*(usd|u\$s|dolar(es)?|dólar(es)?|pesos)\b/i.test(sinInforme)) return "tiene un precio";
  for (const u of t.match(/https?:\/\/\S+/gi) || []) if (!URL_OK.test(u)) return "link ajeno";
  if (/vap(e|er)|elf ?bar|pod\b|tabaco/i.test(t)) return "tema prohibido";
  if (/\binforme\b|5\.?000/i.test(t)) return "ofrece el informe (lo decide el dueño)";
  if (/\b(te|ah[ií]) (paso|mando|env[ií]o|comparto|va)\b|\bahí te\b/i.test(t) && !/https?:\/\//.test(t)) return "promete mandar algo que no tiene";
  if (/te paso con|te derivo|te deriv|alguien del equipo|el equipo|te llam(o|amos)|te escribe/i.test(t)) return "promete derivar";
  return "";
}

// "gracias", "dale joya", "ok perfecto", "no hay problema", "👍"…: solo palabras de cierre, sin pregunta. Se contestan con nada.
const CIERRE = new Set("gracias graciass mil muchas muchisimas muchísimas ok okey oka okk dale joya joyita listo lista perfecto perfecta genial buenisimo buenísimo barbaro bárbaro excelente igualmente de nada no hay problema problemas tranqui tranca esta bien está bien bien vale hno hermano amigo amiga bro crack capo maestro genio jefe che bueno buenas noches saludos abrazo besos un abrazo".split(" "));
const CIERRE_FRASE = /(ya te aviso|te aviso|les aviso|te vuelvo a escribir|me vuelvo a comunicar|te escribo (despu[eé]s|m[aá]s tarde|ma[ñn]ana)|despu[eé]s te (aviso|escribo|hablo)|lo (veo|analizo|pienso|consulto|charlo|hablo)|voy a ver|tengo que (verlo|pensarlo|consultarlo|hablarlo)|debo consultarlo|estamos en contacto|por ahora no|ahora no|volver[eé]|vuelvo cuando|cualquier cosa (te|les) (aviso|escribo|hablo)|quedo atento|quedo al pendiente|estoy al pendiente)/;
export function esCierre(t) {
  const x = String(t || "").toLowerCase().trim();
  if (!x || /[?¿]|\d|https?:/.test(x)) return false;
  if (x.length <= 160 && (CIERRE_FRASE.test(x) || /gra+cias+[\s!.🙏😊🫂❤️👍🫶🏼]*$/u.test(x))) return true;   // "…, déjame q lo analice. Muchas gracias"
  if (x.length > 45) return false;
  const palabras = x.normalize("NFC").replace(/[^\p{L}\s]/gu, " ").split(/\s+/).filter(Boolean);
  if (!palabras.length) return /^[\p{Extended_Pictographic}\s!.]+$/u.test(x);   // solo emojis (👍🙏)
  return palabras.every((w) => CIERRE.has(w) || /^(gra+cias+|o+k+|da+le+|jo+ya+)$/.test(w));
}

// Voseo como se escribe en WhatsApp: "avisame", "pasame", "decime" (sin tilde)
const VOSEO = Object.fromEntries(["avísame","pásame","mándame","decíme","contáme","fijáte","escribíme","mostráme","confirmáme","dejáme","llamáme","pasáme","mandáme","avisáme","contame","mirá"].filter((w) => w !== "contame" && w !== "mirá").map((w) => [w, w.normalize("NFD").replace(/[\u0300-\u036f]/g, "")]));
const VOSEO_RE = new RegExp(`(?<![\\p{L}])(${Object.keys(VOSEO).join("|")})(?![\\p{L}])`, "giu");

// Ya se le contestó (el agente o vos): sale de "Responder ya" y se cierran sus pendientes del 805 en el momento,
// sin esperar a que el lector registre el mensaje (misma regla que usa el lector cuando contestás vos)
const marcarContestado = (env, conv) => [
  env.DB.prepare("UPDATE w_conv SET visto_ts=? WHERE conv=?").bind(Date.now(), conv),
  env.DB.prepare("UPDATE tareas SET estado='resuelta' WHERE ref=? AND estado='abierta' AND ts<?").bind("w805:" + conv, Date.now()),
];

// Reserva el chat para esta PC. Solo una gana (la reserva se toma si no existe o si ya venció). forzar = renovar la propia.
async function reservar(env, conv, ms, forzar = false) {
  const ahora = Date.now(), k = "resp_toma:" + conv;
  const r = await env.DB.prepare(`INSERT INTO kv (k,v,exp) VALUES (?,?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v, exp=excluded.exp WHERE ${forzar ? "1" : "COALESCE(kv.exp,0) < ?"}`)
    .bind(...(forzar ? [k, String(ahora), ahora + ms] : [k, String(ahora), ahora + ms, ahora])).run();
  return (r.meta?.changes ?? 1) > 0;
}

export async function redactar(env, iaJSON, conv, { prueba = false, T = null } = {}) {
  const c = await env.DB.prepare("SELECT * FROM w_conv WHERE conv=?").bind(conv).first();
  let ctxCaso = [];   // últimos mensajes de la charla, para que el entrenador pueda repetir el caso
  const fin = async (r, nombre) => {
    if (r.mensaje) r.mensaje = String(r.mensaje).replace(/[¿¡]/g, "").replace(VOSEO_RE, (w) => { const sin = VOSEO[w.toLowerCase()]; return w[0] === w[0].toUpperCase() ? sin[0].toUpperCase() + sin.slice(1) : sin; });   // una persona no escribe ¿ ¡ ni "avísame"
    if (prueba) return r;   // vista previa: no cuenta ni queda en el log
    if (r.accion === "responder") await reservar(env, conv, 10 * 60e3, true);   // queda reservado hasta que la PC confirme que salió (/enviar/respondido)
    else {
      await kvPut(env, "resp_auto:" + conv, Date.now());
      if (r.accion === "nada") await env.DB.batch([   // "gracias", "ok", ya contestaste vos…: sale también de "Responder ya" del panel
        env.DB.prepare("UPDATE w_conv SET visto_ts=? WHERE conv=?").bind(Date.now(), conv),
        env.DB.prepare("UPDATE tareas SET estado='resuelta' WHERE ref=? AND estado='abierta' AND tipo NOT IN ('comprobante')").bind("w805:" + conv),
      ]).catch(() => {});
    }
    const log = JSON.parse((await kvGet(env, "resp_log")) || "[]");
    log.push({ ts: Date.now(), conv, nombre, accion: r.accion, mensaje: r.mensaje || "", motivo: r.motivo || "" });
    await kvPut(env, "resp_log", JSON.stringify(log.slice(-60)));
    await registrarCaso(env, { conv, nombre, accion: r.accion, mensaje: r.accion === "responder" ? r.mensaje || "" : "", motivo: r.motivo || "", ctx: ctxCaso, juez: r.juez }).catch(() => {});   // para aprender de lo que pasa después
    if (r.accion === "humano") await anotarDerivado(env, conv, nombre, r.resumen || r.motivo);   // lista "Para vos"
    return r;
  };
  if (!c) return { accion: "nada", motivo: "chat no encontrado" };
  if (c.ult_yo) return fin({ accion: "nada", motivo: "ya contestaste vos" }, c.nombre);
  if (!prueba && +((await kvGet(env, "resp_auto:" + conv)) || 0) >= (c.ult_cliente_ts || 0)) return { accion: "nada", motivo: "ya lo atendió la otra PC" };   // dos PCs a la vez: no contestar dos veces
  if (!prueba && !(await reservar(env, conv, 5 * 60e3))) return { accion: "nada", motivo: "lo está atendiendo otra PC" };   // reserva atómica: si dos PCs piden el mismo chat, gana una sola
  const msgs = ((await env.DB.prepare("SELECT yo, tipo, texto, ts FROM w_msg WHERE conv=? ORDER BY ts DESC LIMIT 14").bind(conv).all()).results || []).reverse();
  ctxCaso = msgs.slice(-6).map((m) => ({ yo: m.yo ? 1 : 0, t: String(m.texto || `[${m.tipo || "archivo"}]`).replace(/\s+/g, " ").slice(0, 160) }));
  const ultimo = [...msgs].reverse().find((m) => !m.yo);
  if (!ultimo) return fin({ accion: "nada", motivo: "sin mensaje del cliente" }, c.nombre);
  if (!String(ultimo.texto || "").trim() && ultimo.tipo !== "text" && !/^image$/i.test(ultimo.tipo || "")) return fin({ accion: "humano", motivo: `mandó ${ultimo.tipo || "un archivo"} sin texto` }, c.nombre);
  // Si el cliente mandó fotos, videos, audios o archivos desde tu último mensaje: lo ves vos (suelen ser el producto que busca).
  // Excepción (pedido del dueño): si mandó SOLO fotos del producto, se le piden los 3 datos para cotizar. Nunca si la charla es de plata
  // (un comprobante también es una foto) ni si ya se lo pedimos.
  let sinContestar = [];
  for (const m of [...msgs].reverse()) { if (m.yo) break; sinContestar.push(m); }
  const esMedia = (m) => /^(image|video|audio|ptt|document|sticker)$/i.test(m.tipo || "") || /^\((image|video|audio|document|sticker|archivo|foto)\)/i.test(String(m.texto || "").trim());
  const esImagen = (m) => /^image$/i.test(m.tipo || "") || /^\((image|foto)\)/i.test(String(m.texto || "").trim());
  if (sinContestar.some(esMedia)) {
    const soloFotos = sinContestar.filter(esMedia).every(esImagen);
    const dinero = /pag[oa]|transfer|comprobante|se[ñn]a\b|alias|cbu|dep[oó]sito|factura|reclamo|retiro|devoluc|garant|lleg[oó]|envi[oó]|seguimiento|tracking/i.test(msgs.slice(-8).map((m) => String(m.texto || "")).join(" "));
    const miUltimo = [...msgs].reverse().find((m) => m.yo);
    if (soloFotos && !dinero && !/precio fob/i.test(miUltimo?.texto || "")) return fin({ accion: "responder", mensaje: FRASE_FOTO, motivo: "mandó fotos del producto: se le piden los 3 datos" }, c.nombre);
    return fin({ accion: "humano", motivo: "mandó fotos o archivos", resumen: "mandó fotos: ver si está en Alibaba/1688 o va informe ($5.000)" }, c.nombre);
  }
  // La cotización automática no pudo leer el link de Alibaba: se le piden los datos al cliente (una sola vez)
  const fallos = ((await env.DB.prepare("SELECT k, v FROM kv WHERE k >= ? AND k < ? AND v LIKE 'no-se-pudo:%'").bind("cotauto:" + conv + ":", "cotauto:" + conv + ";").all()).results || [])
    .filter((r) => +r.v.split(":")[1] > (c.ult_yo_ts || 0));
  const dijoCantidad = /\d/.test(sinContestar.map((m) => String(m.texto || "")).join(" ").replace(/https?:\/\/\S+/gi, ""));   // ¿dio algún número aparte del link?
  for (const f of fallos) {
    if (await kvGet(env, "cotpedido:" + f.k)) continue;
    if (!prueba) await kvPut(env, "cotpedido:" + f.k, Date.now());
    if (!dijoCantidad) return fin({ accion: "responder", mensaje: ["No me abre bien la página de ese producto desde acá. ¿Me pasás el peso del producto en gramos, el precio FOB unitario que figura en Alibaba y cuántas unidades querés traer?",
      "Se me complica abrir ese link. ¿Me decís cuántas unidades querés traer, el precio FOB unitario que te figura en Alibaba y el peso del producto en gramos?"][Math.floor(Math.random() * 2)], motivo: "no se pudo leer el link y no dijo cantidad" }, c.nombre);
    const pide = ["No me abre bien la página de ese producto desde acá. ¿Me pasás el peso del producto en gramos y el precio FOB unitario que figura en Alibaba para esa cantidad?",
      "Se me complica abrir ese link. ¿Me decís el precio FOB unitario que te figura en Alibaba para esa cantidad y el peso del producto en gramos?"][Math.floor(Math.random() * 2)];
    return fin({ accion: "responder", mensaje: pide, motivo: "no se pudo leer el link para cotizar" }, c.nombre);
  }
  // Si lo ÚLTIMO que dijo es un cierre ("gracias", "ya te aviso", "lo analizo"), no se contesta aunque más arriba haya
  // quedado una pregunta: casi siempre ya se la respondieron por otro lado (audio, llamada, el celular)
  if (esCierre(ultimo.texto)) return fin({ accion: "nada", motivo: "agradece, se despide o va a avisar: no pide respuesta" }, c.nombre);
  // Si el cliente pasó peso, cantidad y FOB: la cotización se arma sola (con controles de que los números tengan sentido)
  const q3 = await cotizarConTresDatos(env, iaJSON, { conv, c, msgs, sinContestar, T, prueba });
  if (q3) return fin(q3, c.nombre);
  const est = await cargarEstilo(env), reglas = await cargarReglas(env);
  let d = await decidirIA(env, iaJSON, { c, msgs, ultimo, est, reglas });
  // Juez: ningún borrador sale sin aprobar. Si no pasa se manda la versión corregida (si cumple todo) o queda para vos.
  if (d.accion === "responder") {
    const j = await juzgar(env, iaJSON, { msgs, mensaje: d.mensaje, est, reglas }).catch(() => null);
    if (j) {
      d.juez = { puntaje: j.puntaje, fallas: j.fallas.slice(0, 3), ok: j.ok };
      if (!j.ok) {
        const arreglado = j.mejorado ? j.mejorado.replace(/[¿¡]/g, "") : "";
        if (arreglado && !chequeoDuro(arreglado, est, msgs).length && !revisarMensaje(arreglado)) { d = { ...d, mensaje: arreglado, motivo: (d.motivo || "") + " (corregido por el juez)", juez: { ...d.juez, corregido: true } }; }
        else d = { accion: "humano", motivo: `el juez no aprobó el borrador (${j.fallas.slice(0, 2).join("; ") || "puntaje bajo"})`, resumen: d.resumen || "revisar: el borrador no pasó el control", juez: d.juez, borrador: d.mensaje };
      }
    }
  }
  return fin(d, c.nombre);
}


// ---------------------------------------------------------------------------------------------------------------
// COTIZAR CON LOS 3 DATOS: si el cliente pasó peso del producto, cantidad y precio FOB unitario, el sistema arma la cotización
// (misma cuenta que la calculadora). Antes de armarla, la IA solo EXTRAE lo que el cliente escribió y dice si los números tienen
// sentido para ese producto (una cerradura chica no pesa 2,5 kg); si algo no cierra queda para vos en vez de cotizar mal.
// La cotización queda en Pendientes con su PDF; el programita de la PC la guarda para revisar o la manda según COTIZ_MODO.
const RE_PESO = /\d[\d.,]*\s*(g|gr|grs|gramos?|kg|kgs|kilos?)\b/i, RE_FOB = /(fob|u\$s|usd|d[oó]lar|\$\s*\d|\d\s*\$)/i, RE_CANT = /(\d+\s*(u|un|unid|unidades|pcs|piezas|pzs)\b|cantidad|\bx\s?\d+|quiero \d+|\d+ unidades)/i;
export async function cotizarConTresDatos(env, iaJSON, { conv, c, msgs, sinContestar, T, prueba = false }) {
  if (!T) return null;
  const nuevo = sinContestar.map((m) => String(m.texto || "")).join("\n");
  const antes = msgs.slice(-8).map((m) => String(m.texto || "")).join("\n");
  if (!(RE_PESO.test(nuevo) || RE_FOB.test(nuevo))) return null;   // lo último del cliente tiene que traer algún dato
  if (!(RE_PESO.test(antes) && RE_FOB.test(antes) && RE_CANT.test(antes))) return null;   // y entre todo lo dicho, los tres
  const e = await iaJSON(env, `Del chat sacá los 3 datos para cotizar una importación. Devolvé SOLO lo que el cliente escribió de forma explícita; no estimes ni completes nada.
Devolvé JSON {"producto":"nombre corto del producto","peso_g":número,"cantidad":número,"fob_usd":número,"completo":true|false,"plausible":true|false,"dudas":"qué falta o no cierra"}
- peso_g: peso de UNA unidad en gramos (convertí kg a gramos). Si dio el peso total del pedido y no queda claro el de una unidad, completo=false.
- cantidad: unidades que quiere traer.
- fob_usd: precio FOB de UNA unidad en dólares. Si dio un total y queda claro cuántas unidades, dividilo; si no queda claro, completo=false.
- plausible=false si el peso o el precio no tienen sentido para ese producto (ej. una cerradura chica de 2500 g, un celular a 5 dólares, un parlante de 10 g).
CHAT:
${msgs.slice(-8).map((m) => `${m.yo ? "YO" : "CLIENTE"}: ${String(m.texto || "").replace(/\s+/g, " ").slice(0, 300)}`).join("\n")}`, { prioridad: true }).catch(() => null);
  const peso_g = +e?.peso_g, cant = Math.round(+e?.cantidad), fob = +e?.fob_usd, prod = String(e?.producto || "").replace(/\s+/g, " ").trim().slice(0, 80);
  if (!e || e.completo !== true || !prod || !(peso_g >= 1 && peso_g <= 50000) || !(cant >= 1 && cant <= 100000) || !(fob >= 0.01 && fob <= 5000)) return null;   // faltan datos: sigue el flujo normal (pedir lo que falta)
  if (e.plausible === false) return { accion: "humano", motivo: "datos para cotizar que no cierran (peso o FOB raros)", resumen: `datos dudosos: ${prod} ${peso_g} g, USD ${fob}` };
  const clave = `cotauto3:${conv}:${peso_g}|${cant}|${fob}`;
  if (await kvGet(env, clave)) return { accion: "nada", motivo: "esa cotización ya se armó" };
  if (prueba) return { accion: "nada", motivo: `armaría la cotización: ${prod} x${cant}, ${peso_g} g, FOB USD ${fob}` };
  const g = await guardarCotizAuto(env, T, { conv, nombre: c.nombre, items: [{ nombre: prod, variante: "", link: "", cantidad: cant, precio: fob, peso: peso_g / 1000 }], notas: "Cotización con los datos que pasó el cliente (peso, cantidad y precio FOB).", extra: "\n(Datos pasados por el cliente en el chat.)" });
  await kvPut(env, clave, g.id);
  return { accion: "nada", motivo: `cotización N° ${g.num} armada con los 3 datos del cliente (USD ${g.total.toFixed(2)})` };
}

const sinContestarTexto = (msgs) => { const o = []; for (const m of [...msgs].reverse()) { if (m.yo) break; o.unshift(String(m.texto || "")); } return o.join(" ") || String([...msgs].reverse().find((m) => !m.yo)?.texto || ""); };

// Decide qué contestar (la parte "pensar" del contestador). Se usa en producción y en el entrenamiento: ahí recibe
// reglas de prueba y el id del caso para que los ejemplos parecidos no incluyan la respuesta real.
export async function decidirIA(env, iaJSON, { c, msgs, ultimo, est = null, reglas = [], excluir = "" }, opts = { prioridad: true }) {
  const sinPares = !est?.pares?.length;
  const ejemplos = sinPares ? ((await env.DB.prepare("SELECT texto FROM w_msg WHERE yo=1 AND grupo=0 AND tipo='text' AND length(texto) BETWEEN 12 AND 220 ORDER BY ts DESC LIMIT 40").all()).results || []).map((x) => "- " + String(x.texto).replace(/\s+/g, " ")).slice(0, 25) : [];
  const parecidos = sinPares ? "" : ejemplosTexto(similares(est, sinContestarTexto(msgs), 6, excluir));
  const charla = msgs.map((m) => `${m.yo ? "YO" : "CLIENTE"}: ${String(m.texto || `[${m.tipo}]`).replace(/\s+/g, " ").slice(0, 300)}`).join("\n");
  const ia = await iaJSON(env, `Sos el dueño de "Te Importamos" (importación por encargo desde China y catálogo con stock, Rosario, Argentina) contestando por WhatsApp. Escribí SOLO el próximo mensaje tuyo al cliente.
Cómo escribo yo (copiá el tono y el largo, no las frases):
${sinPares ? ejemplos.join("\n") || "- (sin ejemplos todavía: tono cercano, voseo, directo)" : perfilTexto(est) + "\nAsí contesté yo en casos parecidos:\n" + parecidos}

Conversación (los últimos mensajes; el último es del cliente, escrito hace ${Math.max(0, Math.round((Date.now() - (ultimo.ts || Date.now())) / 3600e3))} horas):
${charla}

REGLAS (seguí este orden; la primera que aplica manda):
1. CIERRES Y COTIZACIÓN EN CAMINO: si el cliente mandó link de Alibaba Y cantidad, o contestó la cantidad de un link de Alibaba que mandó antes (la cotización se arma sola y se la mandamos) → accion "nada". También "nada" si lo último del cliente no pide respuesta ("gracias", "ok", "dale", "👍", "listo", "ya te paso", "después te mando", "lo veo y te aviso") → accion "nada".
1b. LA IA DE WHATSAPP YA ESTÁ ATENDIENDO: si el último mensaje de YO es el menú automático de bienvenida ("Bienvenido!! Gracias por escribir… Mandame el número…") y el cliente solo contestó con un número o una opción, ese chat lo maneja la IA de WhatsApp Business → accion "nada". Si el último de YO es "Te voy a derivar con alguien del equipo…" y el cliente siguió escribiendo, NO lo dejes para el dueño solo por eso: vos sos quien atiende, seguí con las reglas de abajo.
2. PARA EL DUEÑO → accion "humano" (no contestes): pagos, transferencias, comprobantes, señas; reclamos o enojo; pide una llamada; negocia o compara precios; preguntas sobre una cotización que YA le pasamos; condiciones del servicio (garantías, envíos a terceros, venta sin stock, dropshipping, formas de pago, mínimos, comisiones, aduana); pide recomendaciones u opciones; pregunta si sos un bot o una persona; pide datos nuestros (dirección del depósito, CBU, alias, datos para el envío, ubicación); ya dio peso + cantidad + precio FOB (hay que cotizarle);  proveedores que nos ofrecen algo; algo que no entendés o cualquier duda.
2b. PLAZOS DE ENTREGA ("cuánto tarda", "cuándo llega", "en cuánto tiempo"): contestá SOLO con estos datos, sin sumar otros números ni garantías:
${PLAZOS}
3a. LINK DE ALIBABA SIN CANTIDAD: preguntale solo cuántas unidades quiere (el precio y el peso los sacamos nosotros del link; la cotización se arma sola cuando diga la cantidad). Si ya se lo preguntaste y no contestó, recordáselo corto.
3b. LINK DE 1688 (o de otro proveedor) sin datos: pedile "${FRASE_COTIZAR} de 1688" (o "del proveedor"). Si ya se lo pediste y no contestó, recordáselo corto.
3c. JUNTAR LOS 3 DATOS EN POCOS MENSAJES: cuando ya tiene proveedor o link y falta información para cotizar, pedí TODO lo que falte en UN solo mensaje (peso del producto en gramos, cantidad de unidades, precio FOB unitario). Si ya dio alguno, pedí solo los que faltan y nombrá lo que ya dijo para que vea que lo leíste; nunca repitas una pregunta que ya hiciste. Si no sabe dónde encontrarlos en Alibaba: el precio sale de la tabla por cantidad de la página y el peso de "Empaque y entrega" (peso bruto). Cuando los tres datos quedan completos, la cotización se arma sola (accion "nada").
4. NOMBRA UN PRODUCTO SIN LINK NI FOTOS (ej: "Xiaomi note 15", "necesito traer 45 pestillos electrónicos", "quiero importar parlantes"): preguntale si tiene el link de Alibaba o 1688, o de algún proveedor; y si no lo tiene, que te mande fotos de referencia del producto. NO ofrezcas el informe de búsqueda, NO pidas peso ni FOB todavía. EXCEPCIÓN: si nombra un producto de marca definida que ya vendemos desde Paraguay en la tienda (parlantes JBL: Charge, Go, Flip, Clip, Boombox, etc.), o el mensaje viene del botón de la tienda web ("quiero consultar precio y disponibilidad por el producto …"), NO le pidas link ni fotos ni lo dejes para el dueño: preguntale solo qué cantidad quiere de cada producto.
5. PRECIO DE ALGO QUE VIO (ropa, zapatillas, "¿ese precio es por unidad?", "¿cuánto sale por 12?") sin decir cuál: no confirmes ni expliques precios; preguntale qué producto vio (prenda, modelo, zapatilla) y si lo vio en un mensaje de los grupos o en la página, y que te pase la captura o el link.
6. CATÁLOGO / STOCK ("qué tienen", "lista de precios", "tienen X en stock"): mandale el link https://www.teimportamosarg.com/catalogo y que ahí están los productos y precios.
7. SALUDO O "QUIERO INFO" sin decir qué: saludalo y preguntale qué producto quiere traer y si tiene link de Alibaba/1688 o fotos de referencia.
8. Cualquier otra cosa → accion "humano".
${reglas?.length ? "REGLAS QUE APRENDÍ (valen como las de arriba; si chocan con REGLAS o PROHIBIDO, mandan estas últimas):\n" + reglasTexto(reglas) + "\n" : ""}ESTILO: 1 a 3 líneas, voseo argentino, como escribo yo (ver ejemplos), sin listas ni títulos, sin muletillas al arrancar ("claro", "dale", "buenísimo", "genial"). Si ya hubo charla hoy, no saludes de nuevo. Si el último mensaje del cliente es de hace más de 12 horas, arrancá con un "Perdón la demora!" corto. Usá el nombre del producto que dijo el cliente.
PROHIBIDO: prometer que le vas a pasar o mandar algo ("te paso la dirección", "ahí te mando") salvo el link del catálogo en ese mismo mensaje; dar precios, comisiones o cualquier número de plata (los plazos solo con los datos de la regla 2b); ofrecer el informe de búsqueda (eso lo hace el dueño cuando ve las fotos); decir "te paso con alguien", "te derivo", "el equipo", "te llamamos" o prometer que alguien le va a escribir; nombrar vapers, pods o tabaco.
Devolvé JSON: {"accion":"responder"|"humano"|"nada","mensaje":"texto a enviar (vacío si no es responder)","motivo":"una frase corta","resumen":"3 a 5 palabras: de qué trata el chat y qué debo hacer yo (ej: \"quiere vender sin stock, explicarle dropshipping\")"}`, opts);
  if (!ia || !["responder", "humano", "nada"].includes(ia.accion)) return ({ accion: "humano", motivo: "la IA no pudo decidir" });
  if (ia.accion !== "responder") return ({ accion: ia.accion, motivo: String(ia.motivo || "").slice(0, 120), resumen: ia.resumen });
  if (!/[?¿]/.test(ultimo.texto || "") && /(avisame si|av[ií]same cualquier|si te qued[oó]|qued[oó] alguna duda|pudiste ver|si pod[eé]s acordate|te sirvi[oó] la cotizaci[oó]n|lo pudiste)/i.test(ia.mensaje || ""))
    return ({ accion: "nada", motivo: "no preguntó nada; un recordatorio va como seguimiento" });
  const mal = revisarMensaje(ia.mensaje);
  if (mal) return ({ accion: "humano", motivo: `no mandé lo redactado (${mal})`, resumen: ia.resumen });
  return ({ accion: "responder", mensaje: String(ia.mensaje).trim(), motivo: String(ia.motivo || "").slice(0, 120) });
}



// Chats que el contestador dejó para vos y todavía no contestaste
export async function derivados(env) {
  const der = JSON.parse((await kvGet(env, "resp_derivados")) || "{}");
  const out = [];
  for (const [conv, d] of Object.entries(der)) {
    const c = await env.DB.prepare("SELECT nombre, ult_yo, ult_texto, ult_ts, archivado FROM w_conv WHERE conv=?").bind(conv).first();
    if (!c || c.ult_yo || c.archivado || Date.now() - d.ts > 14 * 86400e3) continue;   // ya contestaste vos, o es viejo
    out.push({ conv, nombre: c.nombre || d.nombre || "", resumen: d.resumen, ultimo: String(c.ult_texto || "").slice(0, 160), ts: d.ts });
  }
  return out.sort((x, y) => y.ts - x.ts);
}

export async function rutaAutoresp(env, req, p, url, iaJSON, h = {}) {
  const json = (x, s = 200) => Response.json(x, { status: s });
  const body = async () => req.json().catch(() => ({}));
  if (p === "/enviar/responder") return json({ ok: true, ...(await pendientesResponder(env, { limite: Math.min(Math.max(+url.searchParams.get("limite") || 10, 1), 50), T: h.T, desde: +url.searchParams.get("desde") || 0, dias: +url.searchParams.get("dias") || 14 })) });
  if (p === "/enviar/redactar" && req.method === "POST") return json({ ok: true, ...(await (async () => { const b = await body(); return redactar(env, iaJSON, String(b.conv || ""), { prueba: !!b.prueba, T: h.T }); })()) });
  if (p === "/enviar/respondido" && req.method === "POST") {   // el mensaje salió: recién ahí el chat queda como atendido
    const conv = String((await body()).conv || "");
    if (conv) await env.DB.batch([env.DB.prepare("INSERT INTO kv (k,v,exp) VALUES (?,?,NULL) ON CONFLICT(k) DO UPDATE SET v=excluded.v, exp=NULL").bind("resp_auto:" + conv, String(Date.now())), env.DB.prepare("DELETE FROM kv WHERE k=?").bind("resp_toma:" + conv), ...marcarContestado(env, conv)]);
    const k = "resp_hora:" + hora(); await kvPut(env, k, (+((await kvGet(env, k)) || 0)) + 1); return json({ ok: true });
  }
  if (p === "/enviar/atendido" && req.method === "POST") {   // la PC vio en WhatsApp que lo último ya es nuestro (el lector no lo había registrado): no se contesta
    const conv = String((await body()).conv || "");
    if (conv) await env.DB.batch([env.DB.prepare("INSERT INTO kv (k,v,exp) VALUES (?,?,NULL) ON CONFLICT(k) DO UPDATE SET v=excluded.v, exp=NULL").bind("resp_auto:" + conv, String(Date.now())), env.DB.prepare("DELETE FROM kv WHERE k=?").bind("resp_toma:" + conv), ...marcarContestado(env, conv)]);
    return json({ ok: true });
  }
  if (p === "/enviar/cotizacion-html" && req.method === "POST") return paginaCotizacion(env, String((await body()).id || ""), h.T);
  if (p === "/enviar/cotizacion-enviada" && req.method === "POST") {
    const id = String((await body()).id || "");
    await kvPut(env, "cotsent:" + id, Date.now());
    await env.DB.prepare("UPDATE tareas SET estado='resuelta' WHERE ref=? AND estado='abierta'").bind("cotauto:" + id).run();
    const k = "resp_hora:" + hora(); await kvPut(env, k, (+((await kvGet(env, k)) || 0)) + 1);
    return json({ ok: true });
  }
  if (p === "/enviar/reintentar" && req.method === "POST") { const conv = String((await body()).conv || ""); await env.DB.batch([env.DB.prepare("DELETE FROM kv WHERE k=?").bind("resp_auto:" + conv), env.DB.prepare("DELETE FROM kv WHERE k=?").bind("resp_toma:" + conv)]); return json({ ok: true }); }   // falló el envío: que se vuelva a intentar
  if (p === "/enviar/cotizacion-guardada" && req.method === "POST") { await kvPut(env, "cotsent:" + String((await body()).id || ""), "guardada"); return json({ ok: true }); }   // PDF guardado en la PC para revisar: no se vuelve a ofrecer, pero sigue en Pendientes del panel
  if (p === "/enviar/pausa" && req.method === "POST") { await pausaAutoresp(env, !!(await body()).pausa); return json({ ok: true }); }
  if (p === "/enviar/aprendizaje") {   // qué aprendió el agente; POST {agregar:"regla"} o {borrar:N} para enseñarle o sacarle una regla
    if (req.method === "POST") { const b = await body(); await editarReglas(env, { agregar: b.agregar, borrar: Number.isInteger(b.borrar) ? b.borrar : undefined }); }
    return json({ ok: true, ...(await informe(env)) });
  }
  if (p === "/enviar/entrenar" && req.method === "POST") { const n = Math.min(Math.max(+(await body()).rondas || 3, 1), 10); await kvPut(env, KENT.pedido, n); return json({ ok: true, rondas: n, nota: "corre sola, una ronda por minuto; mirá /enviar/aprendizaje" }); }
  if (p === "/enviar/cotizacion-revisada" && req.method === "POST") {   // el dueño confirma si una cotización armada por el agente estaba bien: 7 seguidas y pasa a mandar directo
    const b = await body(); const num = +b.num;
    if (!num) return json({ ok: false, error: "falta el número de cotización" }, 400);
    return json({ ok: true, ...(await revisarCotizacion(env, num, b.bien !== false, String(b.motivo || "").slice(0, 200))) });
  }
  if (p === "/enviar/cotizaciones-estado") return json({ ok: true, ...(await estadoCotizaciones(env)) });
  if (p === "/enviar/derivados") return json({ ok: true, lista: await derivados(env) });
  if (p === "/enviar/log") return json({ ok: true, pausado: (await kvGet(env, "resp_pausa")) === "1", log: JSON.parse((await kvGet(env, "resp_log")) || "[]") });
  return null;
}
