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
import { calcular, paginaCotizacion } from "./cotizar.js";
const SIN_VAPES = "lower(COALESCE(producto,'')) NOT LIKE '%vap%' AND lower(COALESCE(producto,'')) NOT LIKE '%elf%bar%'";
export const PRECIO_INFORME = "$5.000";
export const FRASE_COTIZAR = "Necesito que me digas peso del producto en kg, cantidad y precio FOB";

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
  if (hechos >= topeHora) return { pausado: false, tope: true, lista: [], cotizaciones: [] };
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
  return { pausado: false, lista, quedan, cotizaciones: cotizaciones.slice(0, Math.max(0, topeHora - hechos)) };
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

// Reserva el chat para esta PC. Solo una gana (la reserva se toma si no existe o si ya venció). forzar = renovar la propia.
async function reservar(env, conv, ms, forzar = false) {
  const ahora = Date.now(), k = "resp_toma:" + conv;
  const r = await env.DB.prepare(`INSERT INTO kv (k,v,exp) VALUES (?,?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v, exp=excluded.exp WHERE ${forzar ? "1" : "COALESCE(kv.exp,0) < ?"}`)
    .bind(...(forzar ? [k, String(ahora), ahora + ms] : [k, String(ahora), ahora + ms, ahora])).run();
  return (r.meta?.changes ?? 1) > 0;
}

export async function redactar(env, iaJSON, conv, { prueba = false } = {}) {
  const c = await env.DB.prepare("SELECT * FROM w_conv WHERE conv=?").bind(conv).first();
  const fin = async (r, nombre) => {
    if (r.mensaje) r.mensaje = String(r.mensaje).replace(/[¿¡]/g, "");   // una persona no escribe el signo de apertura en WhatsApp
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
    if (r.accion === "humano") await anotarDerivado(env, conv, nombre, r.resumen || r.motivo);   // lista "Para vos"
    return r;
  };
  if (!c) return { accion: "nada", motivo: "chat no encontrado" };
  if (c.ult_yo) return fin({ accion: "nada", motivo: "ya contestaste vos" }, c.nombre);
  if (!prueba && +((await kvGet(env, "resp_auto:" + conv)) || 0) >= (c.ult_cliente_ts || 0)) return { accion: "nada", motivo: "ya lo atendió la otra PC" };   // dos PCs a la vez: no contestar dos veces
  if (!prueba && !(await reservar(env, conv, 5 * 60e3))) return { accion: "nada", motivo: "lo está atendiendo otra PC" };   // reserva atómica: si dos PCs piden el mismo chat, gana una sola
  const msgs = ((await env.DB.prepare("SELECT yo, tipo, texto, ts FROM w_msg WHERE conv=? ORDER BY ts DESC LIMIT 14").bind(conv).all()).results || []).reverse();
  const ultimo = [...msgs].reverse().find((m) => !m.yo);
  if (!ultimo) return fin({ accion: "nada", motivo: "sin mensaje del cliente" }, c.nombre);
  if (!String(ultimo.texto || "").trim() && ultimo.tipo !== "text") return fin({ accion: "humano", motivo: `mandó ${ultimo.tipo || "un archivo"} sin texto` }, c.nombre);
  // Si el cliente mandó fotos, videos, audios o archivos desde tu último mensaje: lo ves vos (suelen ser el producto que busca)
  let sinContestar = [];
  for (const m of [...msgs].reverse()) { if (m.yo) break; sinContestar.push(m); }
  const esMedia = (m) => /^(image|video|audio|ptt|document|sticker)$/i.test(m.tipo || "") || /^\((image|video|audio|document|sticker|archivo|foto)\)/i.test(String(m.texto || "").trim());
  if (sinContestar.some(esMedia)) return fin({ accion: "humano", motivo: "mandó fotos o archivos", resumen: "mandó fotos: ver si está en Alibaba/1688 o va informe ($5.000)" }, c.nombre);
  // La cotización automática no pudo leer el link de Alibaba: se le piden los datos al cliente (una sola vez)
  const fallos = ((await env.DB.prepare("SELECT k, v FROM kv WHERE k >= ? AND k < ? AND v LIKE 'no-se-pudo:%'").bind("cotauto:" + conv + ":", "cotauto:" + conv + ";").all()).results || [])
    .filter((r) => +r.v.split(":")[1] > (c.ult_yo_ts || 0));
  const dijoCantidad = /\d/.test(sinContestar.map((m) => String(m.texto || "")).join(" ").replace(/https?:\/\/\S+/gi, ""));   // ¿dio algún número aparte del link?
  for (const f of fallos) {
    if (await kvGet(env, "cotpedido:" + f.k)) continue;
    if (!prueba) await kvPut(env, "cotpedido:" + f.k, Date.now());
    if (!dijoCantidad) return fin({ accion: "responder", mensaje: ["No me abre bien la página de ese producto desde acá. ¿Me pasás el peso del producto en kg, el precio FOB que figura en Alibaba y cuántas unidades querés traer?",
      "Se me complica abrir ese link. ¿Me decís cuántas unidades querés traer, el precio FOB que te figura en Alibaba y el peso del producto en kg?"][Math.floor(Math.random() * 2)], motivo: "no se pudo leer el link y no dijo cantidad" }, c.nombre);
    const pide = ["No me abre bien la página de ese producto desde acá. ¿Me pasás el peso del producto en kg y el precio FOB que figura en Alibaba para esa cantidad?",
      "Se me complica abrir ese link. ¿Me decís el precio FOB que te figura en Alibaba para esa cantidad y el peso del producto en kg?"][Math.floor(Math.random() * 2)];
    return fin({ accion: "responder", mensaje: pide, motivo: "no se pudo leer el link para cotizar" }, c.nombre);
  }
  const ejemplos = ((await env.DB.prepare("SELECT texto FROM w_msg WHERE yo=1 AND grupo=0 AND tipo='text' AND length(texto) BETWEEN 12 AND 220 ORDER BY ts DESC LIMIT 40").all()).results || []).map((x) => "- " + String(x.texto).replace(/\s+/g, " ")).slice(0, 25);
  const charla = msgs.map((m) => `${m.yo ? "YO" : "CLIENTE"}: ${String(m.texto || `[${m.tipo}]`).replace(/\s+/g, " ").slice(0, 300)}`).join("\n");
  const ia = await iaJSON(env, `Sos el dueño de "Te Importamos" (importación por encargo desde China y catálogo con stock, Rosario, Argentina) contestando por WhatsApp. Escribí SOLO el próximo mensaje tuyo al cliente.
Cómo escribo yo (ejemplos reales míos, copiá el tono, no las frases):
${ejemplos.join("\n") || "- (sin ejemplos todavía: tono cercano, voseo, directo)"}

Conversación (los últimos mensajes; el último es del cliente, escrito hace ${Math.max(0, Math.round((Date.now() - (ultimo.ts || Date.now())) / 3600e3))} horas):
${charla}

REGLAS (seguí este orden; la primera que aplica manda):
1. CIERRES Y COTIZACIÓN EN CAMINO: si el cliente mandó link de Alibaba Y cantidad, o contestó la cantidad de un link de Alibaba que mandó antes (la cotización se arma sola y se la mandamos) → accion "nada". También "nada" si lo último del cliente no pide respuesta ("gracias", "ok", "dale", "👍", "listo", "ya te paso", "después te mando", "lo veo y te aviso") → accion "nada".
1b. LA IA DE WHATSAPP YA ESTÁ ATENDIENDO: si el último mensaje de YO es el menú automático de bienvenida ("Bienvenido!! Gracias por escribir… Mandame el número…") y el cliente solo contestó con un número o una opción, ese chat lo maneja la IA de WhatsApp Business → accion "nada". Si el último de YO es "Te voy a derivar con alguien del equipo…" y el cliente siguió escribiendo → accion "humano" (lo ve el dueño).
2. PARA EL DUEÑO → accion "humano" (no contestes): pagos, transferencias, comprobantes, señas; reclamos o enojo; pide una llamada; negocia o compara precios; preguntas sobre una cotización que YA le pasamos; condiciones del servicio (garantías, envíos a terceros, venta sin stock, dropshipping, formas de pago, plazos, mínimos, aduana); pide recomendaciones u opciones; pregunta si sos un bot o una persona; pide datos nuestros (dirección del depósito, CBU, alias, datos para el envío, ubicación); ya dio peso + cantidad + precio FOB (hay que cotizarle);  proveedores que nos ofrecen algo; algo que no entendés o cualquier duda.
3a. LINK DE ALIBABA SIN CANTIDAD: preguntale solo cuántas unidades quiere (el precio y el peso los sacamos nosotros del link; la cotización se arma sola cuando diga la cantidad). Si ya se lo preguntaste y no contestó, recordáselo corto.
3b. LINK DE 1688 (o de otro proveedor) sin datos: pedile "${FRASE_COTIZAR} de 1688" (o "del proveedor"). Si ya se lo pediste y no contestó, recordáselo corto.
4. NOMBRA UN PRODUCTO SIN LINK NI FOTOS (ej: "Xiaomi note 15", "necesito traer 45 pestillos electrónicos", "quiero importar parlantes"): preguntale si tiene el link de Alibaba o 1688, o de algún proveedor; y si no lo tiene, que te mande fotos de referencia del producto. NO ofrezcas el informe de búsqueda, NO pidas peso ni FOB todavía. EXCEPCIÓN: si nombra un producto de marca definida que ya vendemos desde Paraguay en la tienda (parlantes JBL: Charge, Go, Flip, Clip, Boombox, etc.), NO le pidas link ni fotos: preguntale solo qué cantidad quiere de cada modelo.
5. PRECIO DE ALGO QUE VIO (ropa, zapatillas, "¿ese precio es por unidad?", "¿cuánto sale por 12?") sin decir cuál: no confirmes ni expliques precios; preguntale qué producto vio (prenda, modelo, zapatilla) y si lo vio en un mensaje de los grupos o en la página, y que te pase la captura o el link.
6. CATÁLOGO / STOCK ("qué tienen", "lista de precios", "tienen X en stock"): mandale el link https://www.teimportamosarg.com/catalogo y que ahí están los productos y precios.
7. SALUDO O "QUIERO INFO" sin decir qué: saludalo y preguntale qué producto quiere traer y si tiene link de Alibaba/1688 o fotos de referencia.
8. Cualquier otra cosa → accion "humano".
ESTILO: 1 a 3 líneas, voseo argentino, como escribo yo (ver ejemplos), sin listas ni títulos, sin muletillas al arrancar ("claro", "dale", "buenísimo", "genial"). Si ya hubo charla hoy, no saludes de nuevo. Si el último mensaje del cliente es de hace más de 12 horas, arrancá con un "Perdón la demora!" corto. Usá el nombre del producto que dijo el cliente.
PROHIBIDO: prometer que le vas a pasar o mandar algo ("te paso la dirección", "ahí te mando") salvo el link del catálogo en ese mismo mensaje; dar precios, comisiones, plazos o cualquier número de plata; ofrecer el informe de búsqueda (eso lo hace el dueño cuando ve las fotos); decir "te paso con alguien", "te derivo", "el equipo", "te llamamos" o prometer que alguien le va a escribir; nombrar vapers, pods o tabaco.
Devolvé JSON: {"accion":"responder"|"humano"|"nada","mensaje":"texto a enviar (vacío si no es responder)","motivo":"una frase corta","resumen":"3 a 5 palabras: de qué trata el chat y qué debo hacer yo (ej: \"quiere vender sin stock, explicarle dropshipping\")"}`, { prioridad: true });
  if (!ia || !["responder", "humano", "nada"].includes(ia.accion)) return fin({ accion: "humano", motivo: "la IA no pudo decidir" }, c.nombre);
  if (ia.accion !== "responder") return fin({ accion: ia.accion, motivo: String(ia.motivo || "").slice(0, 120), resumen: ia.resumen }, c.nombre);
  const mal = revisarMensaje(ia.mensaje);
  if (mal) return fin({ accion: "humano", motivo: `no mandé lo redactado (${mal})`, resumen: ia.resumen }, c.nombre);
  return fin({ accion: "responder", mensaje: String(ia.mensaje).trim(), motivo: String(ia.motivo || "").slice(0, 120) }, c.nombre);
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
  if (p === "/enviar/redactar" && req.method === "POST") return json({ ok: true, ...(await (async () => { const b = await body(); return redactar(env, iaJSON, String(b.conv || ""), { prueba: !!b.prueba }); })()) });
  if (p === "/enviar/respondido" && req.method === "POST") {   // el mensaje salió: recién ahí el chat queda como atendido
    const conv = String((await body()).conv || "");
    if (conv) await env.DB.batch([env.DB.prepare("INSERT INTO kv (k,v,exp) VALUES (?,?,NULL) ON CONFLICT(k) DO UPDATE SET v=excluded.v, exp=NULL").bind("resp_auto:" + conv, String(Date.now())), env.DB.prepare("DELETE FROM kv WHERE k=?").bind("resp_toma:" + conv)]);
    const k = "resp_hora:" + hora(); await kvPut(env, k, (+((await kvGet(env, k)) || 0)) + 1); return json({ ok: true });
  }
  if (p === "/enviar/atendido" && req.method === "POST") {   // la PC vio en WhatsApp que lo último ya es nuestro (el lector no lo había registrado): no se contesta
    const conv = String((await body()).conv || "");
    if (conv) await env.DB.batch([env.DB.prepare("INSERT INTO kv (k,v,exp) VALUES (?,?,NULL) ON CONFLICT(k) DO UPDATE SET v=excluded.v, exp=NULL").bind("resp_auto:" + conv, String(Date.now())), env.DB.prepare("DELETE FROM kv WHERE k=?").bind("resp_toma:" + conv), env.DB.prepare("UPDATE w_conv SET visto_ts=? WHERE conv=?").bind(Date.now(), conv)]);
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
  if (p === "/enviar/derivados") return json({ ok: true, lista: await derivados(env) });
  if (p === "/enviar/log") return json({ ok: true, pausado: (await kvGet(env, "resp_pausa")) === "1", log: JSON.parse((await kvGet(env, "resp_log")) || "[]") });
  return null;
}
