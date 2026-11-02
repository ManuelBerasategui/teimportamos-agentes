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
const SIN_VAPES = "lower(COALESCE(producto,'')) NOT LIKE '%vap%' AND lower(COALESCE(producto,'')) NOT LIKE '%elf%bar%'";
export const FRASE_COTIZAR = "Necesito que me digas peso del producto en kg, cantidad y precio FOB";

export async function pausaAutoresp(env, pausa) { await kvPut(env, "resp_pausa", pausa ? "1" : "0"); }

export async function pendientesResponder(env, { limite = 10 } = {}) {
  if ((await kvGet(env, "resp_pausa")) === "1") return { pausado: true, lista: [] };
  const topeHora = +env.RESP_TOPE_HORA || 25, hechos = +((await kvGet(env, "resp_hora:" + hora())) || 0);
  if (hechos >= topeHora) return { pausado: false, tope: true, lista: [] };
  const ahora = Date.now();
  const filas = (await env.DB.prepare(`SELECT conv, nombre, ult_cliente_ts, ult_texto FROM w_conv WHERE grupo=0 AND archivado=0 AND ult_yo=0 AND COALESCE(prov,0)=0 AND ult_cliente_ts>=? AND ult_cliente_ts<=? AND ${SIN_VAPES} ORDER BY ult_cliente_ts ASC LIMIT 300`).bind(ahora - 48 * 3600e3, ahora - 45e3).all()).results || [];
  const vistos = {};
  for (const r of (await env.DB.prepare("SELECT k, v FROM kv WHERE k LIKE 'resp_auto:%'").all()).results || []) vistos[r.k.slice(10)] = +r.v;
  const lista = filas.filter((f) => /^\d{8,15}$/.test(String(f.conv)) && !(vistos[f.conv] >= f.ult_cliente_ts)).slice(0, Math.min(limite, topeHora - hechos))
    .map((f) => ({ conv: f.conv, nombre: f.nombre, ult_cliente_ts: f.ult_cliente_ts, ultimo: String(f.ult_texto || "").slice(0, 200) }));
  return { pausado: false, lista };
}

const URL_OK = /^https?:\/\/(www\.)?teimportamosarg\.com/i;
export function revisarMensaje(m) {
  const t = String(m || "").trim();
  if (!t) return "vacío";
  if (t.length > 500) return "muy largo";
  if (/\b(usd|u\$s|dolar(es)?|dólar(es)?|pesos|ars)\b\s*\$?\s*\d|\$\s*\d|\d[\d.,]*\s*(usd|u\$s|dolar(es)?|dólar(es)?|pesos)\b/i.test(t)) return "tiene un precio";
  for (const u of t.match(/https?:\/\/\S+/gi) || []) if (!URL_OK.test(u)) return "link ajeno";
  if (/vap(e|er)|elf ?bar|pod\b|tabaco/i.test(t)) return "tema prohibido";
  if (/te paso con|te derivo|te deriv|alguien del equipo|el equipo|te llam(o|amos)|te escribe/i.test(t)) return "promete derivar";
  return "";
}

export async function redactar(env, iaJSON, conv, { prueba = false } = {}) {
  const c = await env.DB.prepare("SELECT * FROM w_conv WHERE conv=?").bind(conv).first();
  const fin = async (r, nombre) => {
    if (prueba) return r;   // vista previa: no cuenta ni queda en el log
    await kvPut(env, "resp_auto:" + conv, Date.now());
    const log = JSON.parse((await kvGet(env, "resp_log")) || "[]");
    log.push({ ts: Date.now(), conv, nombre, accion: r.accion, mensaje: r.mensaje || "", motivo: r.motivo || "" });
    await kvPut(env, "resp_log", JSON.stringify(log.slice(-60)));
    if (r.accion === "humano") {   // lista "Para vos": quién quedó para que contestes vos y qué hacer (3-5 palabras)
      const der = JSON.parse((await kvGet(env, "resp_derivados")) || "{}");
      der[conv] = { nombre, resumen: String(r.resumen || r.motivo || "revisar").slice(0, 80), ts: Date.now() };
      const claves = Object.keys(der).sort((x, y) => der[y].ts - der[x].ts).slice(0, 200);
      await kvPut(env, "resp_derivados", JSON.stringify(Object.fromEntries(claves.map((k) => [k, der[k]]))));
    }
    return r;
  };
  if (!c) return { accion: "nada", motivo: "chat no encontrado" };
  if (c.ult_yo) return fin({ accion: "nada", motivo: "ya contestaste vos" }, c.nombre);
  const msgs = ((await env.DB.prepare("SELECT yo, tipo, texto, ts FROM w_msg WHERE conv=? ORDER BY ts DESC LIMIT 14").bind(conv).all()).results || []).reverse();
  const ultimo = [...msgs].reverse().find((m) => !m.yo);
  if (!ultimo) return fin({ accion: "nada", motivo: "sin mensaje del cliente" }, c.nombre);
  if (!String(ultimo.texto || "").trim() && ultimo.tipo !== "text") return fin({ accion: "humano", motivo: `mandó ${ultimo.tipo || "un archivo"} sin texto` }, c.nombre);
  const ejemplos = ((await env.DB.prepare("SELECT texto FROM w_msg WHERE yo=1 AND grupo=0 AND tipo='text' AND length(texto) BETWEEN 12 AND 220 ORDER BY ts DESC LIMIT 40").all()).results || []).map((x) => "- " + String(x.texto).replace(/\s+/g, " ")).slice(0, 25);
  const charla = msgs.map((m) => `${m.yo ? "YO" : "CLIENTE"}: ${String(m.texto || `[${m.tipo}]`).replace(/\s+/g, " ").slice(0, 300)}`).join("\n");
  const ia = await iaJSON(env, `Sos el dueño de "Te Importamos" (importación por encargo desde China y catálogo con stock, Rosario, Argentina) contestando por WhatsApp. Escribí SOLO el próximo mensaje tuyo al cliente.
Cómo escribo yo (ejemplos reales míos, copiá el tono, no las frases):
${ejemplos.join("\n") || "- (sin ejemplos todavía: tono cercano, voseo, directo)"}

Conversación (los últimos mensajes; el último es del cliente):
${charla}

REGLAS:
- Mensaje corto (1 a 3 líneas), voseo argentino, natural, sin sonar a bot ni a vendedor. Sin listas ni títulos. Si ya hay charla hoy, no saludes de nuevo.
- Si el cliente nombra un producto para importar SIN link y SIN precio (ej: "Xiaomi note 15", "quiero traer parlantes", "cuánto sale importar X"): todavía no tiene proveedor, así que NO le pidas peso ni FOB. Ofrecele la búsqueda de proveedores: un informe detallado con las mejores opciones de fábricas y proveedores para ese producto, y pedile cuántas unidades piensa importar y si busca alguna calidad o marca. No digas costos ni plazos del informe.
- Si el cliente YA tiene el producto y el precio de un proveedor (mandó un link o dice un precio FOB) y quiere cotizar el envío: pedile exactamente esto: "${FRASE_COTIZAR}". Si pasó un link de Alibaba, cerrá con "precio FOB de Alibaba"; si es de 1688, con "precio FOB de 1688" (ej: "${FRASE_COTIZAR} de Alibaba"). No cotices vos.
- Si pregunta por productos de catálogo, stock, "qué tienen", "lista de precios": mandale solo el link https://www.teimportamosarg.com/catalogo y que ahí están los productos y precios.
- NUNCA des números de precios, comisiones, plazos ni prometas nada. Nunca nombres vapers, pods ni tabaco.
- NUNCA digas "te paso con alguien", "te derivo", "el equipo", "te llamamos" ni nada parecido, ni prometas que alguien va a escribirle: si no podés resolverlo con estas reglas, accion "humano".
- Si el cliente ya mandó el link o el producto, no le pidas que "lo mande": pedile directo lo que falta. No arranques con muletillas ("dale", "buenísimo").
- Si pide una recomendación, algo "económico" u opciones: accion "humano".
- Si el cliente pregunta si hablás con un bot, una IA o una persona: accion "humano".
- accion "humano" (no contestes, lo ve el dueño) cuando: pagos, transferencias, comprobantes, reclamos o enojo, pedido de llamada, negociar precio, proveedores, algo que no entendés, algo técnico que no sabés o cualquier duda.
- accion "nada" si el último mensaje es un cierre que no pide respuesta ("gracias", "ok", "dale", "👍", "listo").
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

export async function rutaAutoresp(env, req, p, url, iaJSON) {
  const json = (x, s = 200) => Response.json(x, { status: s });
  const body = async () => req.json().catch(() => ({}));
  if (p === "/enviar/responder") return json({ ok: true, ...(await pendientesResponder(env, { limite: Math.min(Math.max(+url.searchParams.get("limite") || 10, 1), 50) })) });
  if (p === "/enviar/redactar" && req.method === "POST") return json({ ok: true, ...(await (async () => { const b = await body(); return redactar(env, iaJSON, String(b.conv || ""), { prueba: !!b.prueba }); })()) });
  if (p === "/enviar/respondido" && req.method === "POST") { const k = "resp_hora:" + hora(); await kvPut(env, k, (+((await kvGet(env, k)) || 0)) + 1); return json({ ok: true }); }
  if (p === "/enviar/pausa" && req.method === "POST") { await pausaAutoresp(env, !!(await body()).pausa); return json({ ok: true }); }
  if (p === "/enviar/derivados") return json({ ok: true, lista: await derivados(env) });
  if (p === "/enviar/log") return json({ ok: true, pausado: (await kvGet(env, "resp_pausa")) === "1", log: JSON.parse((await kvGet(env, "resp_log")) || "[]") });
  return null;
}
