// Entrenador del contestador (el agente que contesta en el WhatsApp del 805). Tres piezas que se retroalimentan:
//  1) ESTILO: cada día se recalcula cómo escribe el dueño (largo, saludos, frases) y se guardan pares "cliente dijo → yo contesté"
//     para mostrarle al agente ejemplos reales PARECIDOS a lo que escribió el cliente (antes eran 25 mensajes sueltos).
//  2) JUEZ: antes de enviar, cada borrador pasa por chequeos duros (largo, tono, repetición) y por una segunda lectura de la IA;
//     si no aprueba se manda la versión corregida o el chat queda en "Para vos". Nunca se manda algo que el juez rechazó.
//  3) ENTRENAMIENTO: de noche toma charlas reales donde el dueño contestó, hace que el agente conteste SIN ver tu respuesta y las
//     compara. De los errores salen reglas nuevas; una regla solo se adopta si el puntaje mejora y no empeora nada
//     (prueba con los mismos casos). También aprende de producción: cliente confundido, dueño que tuvo que intervenir.
// Todo vive en la tabla kv (claves ent:*). El worker no envía nada: solo mejora cómo se redacta.
const kvGet = async (env, k) => (await env.DB.prepare("SELECT v FROM kv WHERE k=?").bind(k).first())?.v ?? null;
const kvPut = (env, k, v) => env.DB.prepare("INSERT INTO kv (k,v,exp) VALUES (?,?,NULL) ON CONFLICT(k) DO UPDATE SET v=excluded.v, exp=NULL").bind(k, String(v)).run();
const leer = async (env, k, def) => { try { const v = await kvGet(env, k); return v ? JSON.parse(v) : def; } catch { return def; } };
const guardar = (env, k, v) => kvPut(env, k, JSON.stringify(v));
export const K = { estilo: "ent:estilo", reglas: "ent:reglas", casos: "ent:casos", fallas: "ent:fallas", hist: "ent:hist", correcciones: "ent:correcciones", pedido: "ent:pedido", ultimo: "ent:ultimo", vistos: "ent:vistos", rechazadas: "ent:rechazadas", corre: "ent:corre", guia: "ent:guia", guias: "ent:guias" };
export const MAX_REGLAS = 12;

const BOT = /^\s*(bienvenid[oa]|te voy a derivar|gracias por escribir)/i;   // mensajes automáticos de WhatsApp Business: no son míos
const STOP = new Set("de la el en y a que lo un una te me se con por para es no si los las del al mi tu su ya le les mas más muy como pero esto eso este esta".split(" "));
const sinTilde = (t) => String(t || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const palabras = (t) => sinTilde(t).replace(/https?:\/\/\S+/g, " ").split(/[^a-z0-9ñ]+/).filter(Boolean);
const comp = (m) => ({ yo: m.yo ? 1 : 0, t: String(m.texto || "(archivo)").replace(/\s+/g, " ").slice(0, 200), ...(m.tipo && m.tipo !== "text" ? { k: m.tipo } : {}) });
export const parecido = (a, b) => { const x = new Set(palabras(a)), y = new Set(palabras(b)); if (!x.size || !y.size) return 0; let i = 0; for (const w of x) if (y.has(w)) i++; return i / (x.size + y.size - i); };

// ------------------------------------------------------------------ 1) ESTILO
function estadisticas(propios) {
  const n = propios.length; if (!n) return { n: 0, med: 0, p90: 0, lineas: 1, saludo: 0, emoji: 0, sinInv: 100, aperturas: [], frases: [] };
  const largos = propios.map((t) => t.length).sort((a, b) => a - b), q = (p) => largos[Math.min(n - 1, Math.floor(n * p))];
  const lin = propios.map((t) => t.split(/\n/).filter(Boolean).length).sort((a, b) => a - b);
  const pct = (f) => Math.round((100 * propios.filter(f).length) / n);
  const conPreg = propios.filter((t) => t.includes("?")), sinInv = conPreg.length ? Math.round((100 * conPreg.filter((t) => !t.includes("¿")).length) / conPreg.length) : 100;
  const ap = new Map(), bi = new Map();
  for (const t of propios) {
    const w = palabras(t); if (w[0]) ap.set(w[0], (ap.get(w[0]) || 0) + 1);
    for (let i = 0; i < w.length - 1; i++) if (!(STOP.has(w[i]) && STOP.has(w[i + 1])) && !/\d/.test(w[i] + w[i + 1])) { const k = w[i] + " " + w[i + 1]; bi.set(k, (bi.get(k) || 0) + 1); }
  }
  const top = (m, min, k) => [...m.entries()].filter(([, c]) => c >= min).sort((a, b) => b[1] - a[1]).slice(0, k);
  return { n, med: q(0.5), p90: q(0.9), lineas: lin[Math.floor(n / 2)], saludo: pct((t) => /^(hola|buen[ao]s?|que tal|qué tal)/i.test(t.trim())), emoji: pct((t) => /\p{Extended_Pictographic}/u.test(t)), sinInv,
    aperturas: top(ap, Math.max(3, n * 0.03), 6).map(([w, c]) => `${w} (${Math.round((100 * c) / n)}%)`), frases: top(bi, 4, 10).map(([w]) => w) };
}

export async function construirEstilo(env, ahora = Date.now()) {
  const filas = ((await env.DB.prepare("SELECT conv, yo, tipo, texto, ts FROM w_msg WHERE grupo=0 AND ts>=? ORDER BY ts DESC LIMIT 5000").bind(ahora - 60 * 86400e3).all()).results || []);
  const porConv = new Map();
  for (const m of filas) { if (!porConv.has(m.conv)) porConv.set(m.conv, []); porConv.get(m.conv).push(m); }
  const propios = [], pares = [], sinResp = [];
  for (const [conv, ms] of porConv) {
    ms.sort((a, b) => a.ts - b.ts);
    let pend = [], ctx = [];
    for (const m of ms) {
      const t = String(m.texto || "").trim();
      if (!m.yo) { if (t || m.tipo !== "text") pend.push(t || "(archivo)"); ctx.push(m); continue; }
      const mio = m.tipo === "text" && t.length >= 8 && t.length <= 400 && !BOT.test(t) && !/^https?:\/\/\S+$/.test(t);
      const adjunto = m.tipo !== "text" || /^\((archivo|audio|image|video|document)/i.test(t);
      if (mio) { propios.push(t); if (pend.length) pares.push({ id: `${conv}:${m.ts}`, ts: m.ts, c: pend.slice(-3).join(" / ").slice(0, 300), y: t, ctx: ctx.slice(-7).map(comp) }); }
      else if (adjunto && pend.length) pares.push({ id: `${conv}:${m.ts}`, ts: m.ts, c: pend.slice(-3).join(" / ").slice(0, 300), y: "[respondí con un audio o un archivo]", ctx: ctx.slice(-7).map(comp), k: "adjunto" });
      pend = []; ctx.push(m);
    }
    const ult = ms.at(-1);   // la charla terminó con el cliente y no le contesté en 24 h: sirve para aprender cuándo NO hay que contestar
    if (pend.length && ult && !ult.yo && ahora - ult.ts > 24 * 3600e3) sinResp.push({ id: `${conv}:${ult.ts}:nr`, ts: ult.ts, c: pend.slice(-3).join(" / ").slice(0, 300), y: "(no le contesté nada)", ctx: ctx.slice(-7).map(comp), k: "sin_respuesta" });
  }
  const vistos = new Set(), unicos = [];
  const todos = [...pares, ...sinResp.sort((a, b) => b.ts - a.ts).slice(0, 60)].sort((a, b) => b.ts - a.ts);
  for (const p of todos) { const k = p.k ? p.id : sinTilde(p.y); if (vistos.has(k)) continue; vistos.add(k); unicos.push(unicos.length < 150 || p.k ? p : { id: p.id, ts: p.ts, c: p.c, y: p.y }); if (unicos.length >= 480) break; }
  const est = { ts: ahora, stats: estadisticas(propios.slice(0, 1500)), pares: unicos };
  await guardar(env, K.estilo, est);
  return est;
}
export const cargarEstilo = (env) => leer(env, K.estilo, null);

export function perfilTexto(e) {
  const s = e?.stats; if (!s?.n) return "";
  return `Largo típico de mis mensajes: ${s.med} caracteres (rara vez más de ${s.p90}), ${s.lineas} línea(s). ${s.saludo}% arrancan con saludo, ${s.emoji}% llevan emoji, ${s.sinInv}% de mis preguntas van sin ¿. ` +
    (s.aperturas.length ? `Cómo arranco seguido: ${s.aperturas.join(", ")}. ` : "") + (s.frases.length ? `Expresiones mías: ${s.frases.join(", ")}.` : "");
}

// Los k pares más parecidos a lo que escribió el cliente (excluye el caso que se está entrenando para que no copie la respuesta real)
export function similares(est, texto, k = 6, excluir = "") {
  const pares = (est?.pares || []).filter((p) => p.id !== excluir); if (!pares.length) return [];
  const w = new Set(palabras(texto).filter((x) => x.length >= 4 && !STOP.has(x)));
  const pt = pares.map((p, i) => ({ p, s: [...new Set(palabras(p.c))].filter((x) => w.has(x)).length * 10 - i * 0.01 })).sort((a, b) => b.s - a.s);
  const out = pt.filter((x) => x.s >= 10).slice(0, k).map((x) => x.p);
  for (const x of pt) { if (out.length >= Math.min(k, 4)) break; if (!out.includes(x.p)) out.push(x.p); }   // relleno con los más recientes
  return out;
}
export const ejemplosTexto = (ps) => ps.map((p) => `Cliente: ${p.c}\nYo: ${p.y.replace(/\s+/g, " ")}`).join("\n---\n");

// ------------------------------------------------------------------ reglas aprendidas
export async function cargarReglas(env) { return (await leer(env, K.reglas, [])).filter((x) => x?.r); }
export const cargarGuia = async (env) => String((await leer(env, K.guia, "")) || "");
export const guiaTexto = (g) => g ? "CRITERIO APRENDIDO (lo escribió el entrenador a partir de mis respuestas reales; REGLAS y PROHIBIDO mandan si chocan):\n" + g + "\n" : "";
export const reglasTexto = (rs) => rs.map((x, i) => `${i + 1}. ${x.r}`).join("\n");

// ------------------------------------------------------------------ 2) JUEZ
export function chequeoDuro(mensaje, est, msgs = []) {
  const t = String(mensaje || "").trim(), f = [], p90 = est?.stats?.p90 || 140, max = Math.max(220, Math.round(p90 * 1.8));
  if (t.length > max) f.push(`muy largo (${t.length} caracteres; yo escribo hasta ~${p90})`);
  if (t.split(/\n/).filter(Boolean).length > 3) f.push("más de 3 líneas");
  if ((t.match(/\?/g) || []).length > 2) f.push("demasiadas preguntas juntas");
  if (t.length > 45 && /^(claro|dale|buen[ií]simo|genial|perfecto|excelente|obvio|por supuesto)\b/i.test(t)) f.push("arranca con muletilla");
  if (/\b(estimad[oa]|le informo|cordial(es)?|a su disposici[oó]n|usted|su consulta)\b/i.test(t)) f.push("tono formal");
  if ((t.match(/\p{Extended_Pictographic}/gu) || []).length > 2) f.push("demasiados emojis");
  if (/\*\*|^#|^\s*[-•]\s/m.test(t)) f.push("usa formato o listas");
  const mio = [...msgs].reverse().find((x) => x.yo);
  if (mio && parecido(mio.texto, t) > 0.8) f.push("repite casi igual lo que ya le dije");
  return f;
}

const charlaTexto = (msgs) => msgs.map((m) => `${m.yo ? "YO" : "CLIENTE"}: ${String(m.texto || `[${m.tipo || "archivo"}]`).replace(/\s+/g, " ").slice(0, 300)}`).join("\n");
export const PLAZOS = `PLAZOS DE ENTREGA (son los únicos que se pueden decir; mínimos y comisiones los contesta el dueño):
- Productos del catálogo de tecnología y bazar (vienen de Paraguay): aproximadamente 15 días.
- Ropa (viene de Argentina): entrega inmediata. Mates: aproximadamente 10 días. Zapatillas: aproximadamente 10 días.
- Productos que se importan desde China: "una vez despachado, 10 a 15 días por avión; 40 a 60 días una vez despachado por barco".
- Si no está claro de dónde viene el producto, preguntale qué producto es antes de dar un plazo.`;
export const SOP_EMBUDO = `   a) Si el producto es vago (ej. "de silicona, varios colores y modelos", "algo así"): pedile fotos de referencia o, al menos, los nombres o modelos que busca.
   b) Si no dijo cantidad: preguntale cuántas unidades busca y, en el mismo mensaje, si lo quiere traer de China o de otro lado.
   c) Si lo quiere traer de un lugar que NO es China → accion "humano" (lo ve el dueño).
   d) Si es de China: preguntale si tiene el link de Alibaba o algo del proveedor. Si NO lo tiene → accion "humano". Si lo tiene → pedile el precio FOB unitario y el peso del producto para cotizar directo.
   e) Si mandó fotos de los productos (con o sin cantidad): preguntale si tiene links de Alibaba de esos productos o si necesita que se los busquemos. Buscar por fotos lo hace el dueño: si contesta que no tiene links o que los busquen → accion "humano".
   f) Si pide un rubro o varios productos genéricos (ej. "goma eva e insumos para espejos led") sin cantidad: preguntale qué cantidad busca de cada cosa o si tiene un presupuesto definido. No le pidas fotos como primer paso.`;
export const OBJETIVO = `Cotizamos solos cuando el cliente manda link de Alibaba + cantidad, o cuando nos pasa peso del producto en gramos, cantidad de unidades y precio FOB unitario. Si falta algo, hay que conseguir esos 3 datos en la menor cantidad de mensajes: pedir TODO lo que falte junto en un solo mensaje y nunca pedir lo que ya dio.`;

export async function juzgar(env, iaJSON, { msgs, mensaje, est, reglas = [], entiende = "" }) {
  const duras = chequeoDuro(mensaje, est, msgs);
  let r = null;
  if (env.JUEZ !== "0") {
    r = await iaJSON(env, `Sos el revisor de calidad del contestador de "Te Importamos" (importación por encargo desde China, Rosario). Evaluá el BORRADOR que mandaría el agente como si fueras el dueño y lo leyera su cliente.
Cómo escribo yo: ${perfilTexto(est) || "tono cercano, voseo, directo, mensajes cortos"}
${reglas.length ? "Reglas que aprendí:\n" + reglasTexto(reglas) + "\n" : ""}OBJETIVO DEL NEGOCIO: ${OBJETIVO}
${PLAZOS}

CONVERSACIÓN:
${charlaTexto(msgs)}

BORRADOR: "${mensaje}"
${entiende ? `El agente entendió que el cliente pide: "${entiende}". No te fíes: leé vos el ÚLTIMO mensaje del cliente y fijate si eso es cierto.\n` : ""}
Puntaje de 1 a 10 (7 o más = se puede enviar). Criterios: (1) contesta lo que el cliente realmente escribió o preguntó; (2) avanza hacia el objetivo del negocio sin pedir lo que ya dio; (3) no inventa datos, precios ni promete cosas (los plazos de entrega son válidos solo si coinciden con los DATOS DE PLAZOS); (4) suena a mí: tono, largo y vocabulario, sin ¿ ni ¡ ni frases de call center; (5) no repite lo que ya dije.
PRIMERO respondé "responde_pregunta": ¿el borrador contesta exactamente lo que el cliente escribió o preguntó en su último mensaje, o al menos le dice qué hace falta para contestarlo? Una frase armada que no toca lo que preguntó (pedir fotos o datos de cotización a quien preguntó otra cosa) es false y puntaje 3 o menos.
Devolvé JSON: {"responde_pregunta":true|false,"ok":true|false,"puntaje":1-10,"fallas":["falla corta"],"mensaje_mejorado":"solo si puntaje<7: el mensaje que YO (el dueño) le mandaría al cliente en lugar del borrador, contestando su último mensaje; nunca escrito como si fuera el cliente. Si no hace falta, vacío"}`, { prioridad: true }).catch(() => null);
  }
  const puntaje = Number.isFinite(+r?.puntaje) && r?.puntaje !== null ? +r.puntaje : null;   // sin juez (IA caída): valen solo los chequeos duros
  const fallas = [...duras, ...(Array.isArray(r?.fallas) ? r.fallas.map((x) => String(x).slice(0, 80)).slice(0, 4) : [])];
  return { ok: !duras.length && (puntaje === null || puntaje >= 7) && r?.ok !== false && r?.responde_pregunta !== false, puntaje, fallas, mejorado: String(r?.mensaje_mejorado || "").trim() };
}

// ------------------------------------------------------------------ correcciones del dueño
// "Acá le tendría que haber pedido la cantidad…": cada corrección guarda la charla, lo que hizo el agente y lo que había que hacer.
// Sirve de 3 maneras: (1) se le muestra al agente cuando aparece un caso parecido, (2) entra siempre en la práctica nocturna como caso de
// oro (una regla nueva nunca puede romperlas), (3) de ellas salen las reglas generales. Así no hace falta parchear el código por cada error.
export const cargarCorrecciones = async (env) => { const l = await leer(env, K.correcciones, []), out = []; for (const c of l.reverse()) if (!out.some((x) => x.conv === c.conv && parecido(x.y, c.y) > 0.8)) out.unshift(c); return out; };
export async function agregarCorreccion(env, { conv, correccion, msgs, agente = "" }) {
  const l = await cargarCorrecciones(env), ctx = msgs.map(comp), ult = [...msgs].reverse().find((m) => !m.yo);
  const prev = l.findIndex((x) => x.conv === conv && parecido(x.y, correccion) > 0.8); if (prev >= 0) l.splice(prev, 1);   // la misma corrección cargada dos veces no cuenta doble
  const c = { id: `corr:${conv}:${Date.now()}`, ts: Date.now(), conv, c: String(ult?.texto || ctx.at(-1)?.t || "").slice(0, 300), ctx, agente, y: String(correccion).slice(0, 700), oro: true };
  l.push(c); await guardar(env, K.correcciones, l.slice(-60));
  await kvPut(env, K.pedido, Math.max(+((await kvGet(env, K.pedido)) || 0), 1));   // el cron lo practica en el próximo minuto
  return { total: Math.min(l.length, 60), practica: "en el próximo minuto" };
}
export function corrSimilares(corrs, texto, k = 3, excluir = "") {
  const w = new Set(palabras(texto).filter((x) => x.length >= 4 && !STOP.has(x)));
  return (corrs || []).filter((c) => c.id !== excluir).map((c) => ({ c, s: [...new Set(palabras(c.c + " " + (c.ctx || []).map((m) => m.t).join(" ")))].filter((x) => w.has(x)).reduce((t, x) => t + (x.length >= 7 ? 2 : 1), 0) })).filter((x) => x.s >= 2).sort((a, b) => b.s - a.s).slice(0, k).map((x) => x.c);
}
export const correccionesTexto = (cs) => cs.map((c) => `Situación: "${c.c}"${c.agente ? `\n  El agente hizo: ${c.agente.slice(0, 200)}` : ""}\n  Lo que había que hacer: ${c.y}`).join("\n");

// ------------------------------------------------------------------ casos de producción
export async function registrarCaso(env, caso) {
  const l = await leer(env, K.casos, []);
  l.push({ ...caso, ts: Date.now() });
  await guardar(env, K.casos, l.slice(-120));
}

const CONFUSION = /no (te )?entend|no era eso|ya te (dije|pas|mand)|pero (eso )?ya|te lo (dije|pas)|repet[ií]s|\?\?|no me (contest|respond)|sos (un )?(bot|robot)|ia\b|persona real|hablo con (una )?persona/i;
const SIMPLE = /\b(alias|cbu|transfer|pag[oa]|se[ñn]a|comprobante|usd|d[oó]lar|\$|\d{3,})\b/i;
// Mira qué pasó DESPUÉS de cada decisión del agente (últimas 48 h) y anota las que parecen errores
export async function revisarResultados(env, ahora = Date.now()) {
  const casos = await leer(env, K.casos, []), fallas = await leer(env, K.fallas, []);
  let marcados = 0, nuevas = 0;
  for (const c of casos) {
    if (c.revisado || !c.conv || ahora - c.ts < 30 * 60e3 || ahora - c.ts > 48 * 3600e3) continue;
    const sig = ((await env.DB.prepare("SELECT yo, texto, ts FROM w_msg WHERE conv=? AND ts>? ORDER BY ts LIMIT 8").bind(c.conv, c.ts).all().catch(() => ({ results: [] }))).results || []);
    c.revisado = true; marcados++;
    const mio = (t) => c.mensaje && sinTilde(t).replace(/\s+/g, "").startsWith(sinTilde(c.mensaje).replace(/\s+/g, "").slice(0, 20));
    let motivo = "", real = "";
    const conf = sig.find((m) => !m.yo && CONFUSION.test(String(m.texto || "")));
    const primero = sig.find((m) => !mio(m.texto) || !m.yo);
    if (c.accion === "responder" && conf) motivo = `el cliente se confundió o se quejó después de mi respuesta: "${String(conf.texto).slice(0, 100)}"`;
    else if (c.accion === "responder" && primero?.yo && !mio(primero.texto) && !BOT.test(primero.texto || "") && primero.ts - c.ts < 30 * 60e3) { motivo = "el dueño tuvo que intervenir enseguida"; real = String(primero.texto).slice(0, 220); }
    else if (c.accion === "humano" || c.accion === "nada") {
      const resp = sig.find((m) => m.yo && !BOT.test(m.texto || ""));
      if (resp && c.accion === "humano" && String(resp.texto || "").length < 160 && !SIMPLE.test(resp.texto || "")) { motivo = "lo dejó para el dueño pero la respuesta era simple"; real = String(resp.texto).slice(0, 220); }
      else if (resp && c.accion === "nada" && !/ya contestaste|cierre|agradece|se despide|cotizaci[oó]n/i.test(c.motivo || "")) { motivo = "no contestó y el dueño sí contestó algo"; real = String(resp.texto).slice(0, 220); }
    }
    if (motivo && c.ctx?.length) { fallas.push({ ts: c.ts, ctx: c.ctx, agente: `${c.accion}${c.mensaje ? ": " + c.mensaje : ""}`, motivo, real }); nuevas++; }
  }
  await guardar(env, K.casos, casos); await guardar(env, K.fallas, fallas.slice(-40));
  return { revisados: marcados, errores: nuevas };
}

// ------------------------------------------------------------------ 3) ENTRENAMIENTO
const mezclar = (a) => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
const AGENTE = (r) => r ? `${String(r.accion).toUpperCase()}${r.mensaje ? ": " + r.mensaje : ""}${r.motivo ? "  (motivo: " + r.motivo + ")" : ""}` : "(sin respuesta)";

async function comparar(ia, { ctx, real, agente, oro = false }) {
  return ia(null, `Sos el dueño de "Te Importamos" (importación por encargo desde China, Rosario). Abajo está una charla real, cómo contesté YO de verdad y cómo contestó el AGENTE (decide "responder" con un mensaje, "humano" = me lo deja a mí, o "nada" = no contesta).
Puntuá al agente de 1 a 10: ¿habría sido una respuesta igual de buena que la mía para el cliente?
- Mismo objetivo que la mía, tono y largo parecidos a los míos, sin inventar datos, sin pedir lo que el cliente ya dio, sin repetir.
- Derivarme el chat ("humano") SOLO es correcto si mi respuesta real necesitó algo que el agente no puede tener: pagos o comprobantes, estado de un pedido en marcha, negociación de precios, aduana, llamadas, un reclamo o un origen que no es China. Si yo lo resolví con una pregunta o un dato simple (cantidad, link, fotos, plazo, "dale cuando puedas me pasás"), derivar fue un error: puntaje 5 o menos.
- Si el agente no contestó ("nada") pero yo contesté algo que había que contestar, o si contestó algo que yo no habría dicho, es un error.
- ERROR GRAVE (puntaje 1 a 3): contestar algo que no tiene que ver con el ÚLTIMO mensaje del cliente; usar una frase armada que no corresponde (ej. pedir precio FOB a alguien que dijo "no me sirve, gracias"); pedirle datos a alguien que se está despidiendo; inventar datos.
- Si mi respuesta es "(no le contesté nada)": a veces no contesto por olvido. Si lo último del cliente era un cierre o un rechazo, lo correcto era "nada"; si hacía una pregunta, contestarla bien también es correcto.
- Si mi respuesta es "[respondí con un audio o un archivo]": no sabés qué dije; está bien si el agente lo derivó o contestó algo sensato al último mensaje.
- "(archivo)" en la charla es un adjunto que puede ser foto, audio o documento.
OBJETIVO DEL NEGOCIO: ${OBJETIVO}
${PLAZOS}

CONVERSACIÓN:
${charlaTexto(ctx.map((m) => ({ yo: m.yo, texto: m.t })))}

${oro ? "LO QUE ERA CORRECTO HACER (indicación mía)" : "MI RESPUESTA REAL"}: ${real}
AGENTE: ${agente}

Devolvé JSON: {"puntaje":1-10,"fallas":["falla corta"],"regla":"una regla corta en imperativo, general (no de este chat), que evitaría este error; vacío si el agente estuvo bien"}`);
}

export async function modelosAgotados(env) { try { return ((await env.ESTADO?.list({ prefix: "agotado:" }))?.keys || []).map((k) => k.name.slice(8)); } catch { return []; } }
export async function rondaEntrenamiento(env, iaBase, decidir, opts = {}) {
  const ahora = opts.ahora || Date.now(), kDia = "ent:usos:" + new Date(ahora - 3 * 3600e3).toISOString().slice(0, 10);
  const usadosDia = +((await kvGet(env, kDia)) || 0), topeDia = +(env.ENT_MAX_DIA || 600);
  if (usadosDia >= topeDia) return { nota: `hoy ya usé ${usadosDia} llamadas a la IA para entrenar (tope ${topeDia}); sigo mañana para no dejar sin cupo al contestador` };
  // El cupo gratis de Gemini es compartido con el contestador de los clientes: si ya hay modelos agotados, el entrenamiento no gasta más.
  const agot = await modelosAgotados(env);
  if (agot.length >= 2 && !opts.forzarCupo) { await kvPut(env, "ent:enfria", ahora + 30 * 60e3); return { nota: `Gemini ya tiene ${agot.length} modelos sin cupo (${agot.join(", ")}): el entrenamiento descansa 30 minutos para dejarle el cupo a los clientes` }; }
  let usos = 0; const contar = async (e, p, o) => { usos++; return iaBase(e, p, o); };
  try { return await rondaInterna(env, contar, decidir, { ...opts, ahora }); } finally { await kvPut(env, kDia, usadosDia + usos); }
}
async function rondaInterna(env, iaBase, decidir, { n = 6, maxIA = 45, ahora = Date.now() } = {}) {
  let usos = 0, agotada = false, nulas = 0;
  const ia = async (e, prompt, o = {}) => { if (usos >= maxIA) { agotada = true; return null; } usos++; const r = await iaBase(env, prompt, { ...o, sinRespaldo: true }); if (!r) nulas++; return r; };   // el respaldo de Cloudflare AI queda para los clientes
  let est = await cargarEstilo(env);
  if (!est || ahora - est.ts > 20 * 3600e3) est = await construirEstilo(env, ahora);
  if (!est.pares.length) return { nota: "todavía no hay conversaciones tuyas para entrenar" };
  const reglas = await cargarReglas(env), guia = await cargarGuia(env), rechazadas = await leer(env, K.rechazadas, []);
  const correcciones = await cargarCorrecciones(env), oro = mezclar(correcciones).slice(0, 3);
  let vistos = new Set(await leer(env, K.vistos, []));
  let cand = est.pares.filter((p) => p.ctx?.length && !p.ctx.at(-1)?.yo && !vistos.has(p.id));
  if (cand.length < n) { vistos = new Set(); cand = est.pares.filter((p) => p.ctx?.length && !p.ctx.at(-1)?.yo); }
  const lote = [...oro, ...mezclar(cand).slice(0, n)], res = [];
  const correr = async (p, reglasUsar, guiaUsar = guia) => {
    const msgs = p.ctx.map((m) => ({ yo: m.yo, texto: m.t, tipo: m.k || "text" }));
    const ultimo = [...msgs].reverse().find((m) => !m.yo);
    const borr = await decidir({ c: { nombre: "" }, msgs, ultimo, est, reglas: reglasUsar, guia: guiaUsar, excluir: p.id, correcciones }, ia);
    if (!borr) return null;
    const v = await comparar(ia, { ctx: p.ctx, real: p.y, agente: AGENTE(borr), oro: !!p.oro });
    if (!Number.isFinite(+v?.puntaje)) return null;
    return { p, borr, puntaje: +v.puntaje, fallas: v?.fallas || [], regla: String(v?.regla || "").trim() };
  };
  for (const p of lote) { const r = await correr(p, reglas); if (!r) { if (agotada) break; continue; } res.push(r); if (!p.oro) vistos.add(p.id); }
  if (!res.length) {
    if (nulas >= 2) { await kvPut(env, "ent:enfria", ahora + 25 * 60e3); return { nota: `Gemini no respondió (${nulas} llamadas sin respuesta: casi seguro sin cupo gratis por ahora); descanso 25 minutos para no gastar el cupo de los clientes` }; }
    return { nota: agotada ? "la IA no respondió (cupo agotado), sigo mañana" : "no pude evaluar casos (el agente no devolvió respuesta para esos chats)" };
  }
  const prom = (a) => a.reduce((s, x) => s + x.puntaje, 0) / (a.length || 1);
  const score = Math.round(prom(res) * 10) / 10, malos = res.filter((r) => r.puntaje < 7);
  const prod = await leer(env, K.fallas, []);
  let adoptadas = [], descartadas = [], quitadas = [];
  if ((malos.length || prod.length) && !agotada) {
    const refl = await ia(null, `Sos el entrenador del contestador de "Te Importamos". Estos son errores del agente: casos de entrenamiento (comparado con lo que contesté yo de verdad) y casos de producción.
Escribí como máximo 3 REGLAS nuevas, cortas, generales y accionables (una oración en imperativo, español rioplatense) que eviten esos errores. Que no se contradigan con las existentes, no inventen precios, plazos ni políticas, y no habiliten mandar precios. También podés pedir sacar reglas existentes que causen problemas (por número).
OBJETIVO DEL NEGOCIO: ${OBJETIVO}
REGLAS EXISTENTES:
${reglasTexto(reglas) || "(ninguna)"}
YA PROBADAS SIN MEJORA (no las repitas): ${rechazadas.slice(-8).join(" | ") || "(ninguna)"}

ERRORES DE ENTRENAMIENTO:
${malos.slice(0, 6).map((r, i) => `${i + 1}. Cliente: ${r.p.c}\n   Yo contesté: ${r.p.y}\n   Agente: ${AGENTE(r.borr)}\n   Falla: ${r.fallas.join("; ")}${r.regla ? "\n   Sugerencia: " + r.regla : ""}`).join("\n")}
ERRORES DE PRODUCCIÓN:
${prod.slice(-5).map((f, i) => `${i + 1}. ${f.motivo}\n   Charla: ${f.ctx.map((m) => (m.yo ? "YO: " : "CLIENTE: ") + m.t).join(" | ").slice(0, 500)}\n   Agente: ${f.agente}${f.real ? "\n   Dueño: " + f.real : ""}`).join("\n") || "(ninguno)"}
Devolvé JSON: {"reglas":["regla"],"quitar":[número de regla existente]}`);
    const nuevas = (Array.isArray(refl?.reglas) ? refl.reglas : []).map((x) => String(x).trim().slice(0, 220)).filter((x) => x.length > 12 && !/\$\s*\d|precio fijo|prometé|prometer|\bsiempre\b|\bnunca\b|en todos los casos|sin excepci[oó]n/i.test(x) && !reglas.some((y) => parecido(y.r, x) > 0.6)).slice(0, 3);
    const quitar = new Set((Array.isArray(refl?.quitar) ? refl.quitar : []).map((x) => +x - 1).filter((i) => reglas[i] && reglas[i].fuente !== "manual").slice(0, 2));
    if (nuevas.length || quitar.size) {
      const candidatas = [...reglas.filter((_, i) => !quitar.has(i)), ...nuevas.map((r) => ({ r, ts: ahora, fuente: "auto" }))].slice(-MAX_REGLAS);
      // Prueba de las reglas nuevas con los mismos casos (los que fallaron + algunos que andaban bien): solo se adoptan si mejoran y no empeoran nada
      const prueba = [...malos.slice(0, 4), ...res.filter((r) => r.puntaje >= 8).slice(0, 3)], nuevos = [];
      for (const r of prueba) { const x = await correr(r.p, candidatas); if (x) nuevos.push({ antes: r.puntaje, despues: x.puntaje }); else if (agotada) break; }
      const mejora = nuevos.length ? nuevos.reduce((s, x) => s + x.despues - x.antes, 0) / nuevos.length : 0, peores = nuevos.filter((x) => x.despues < x.antes - 2).length;
      if (nuevos.length >= Math.min(3, prueba.length) && mejora >= 0.3 && peores <= 1) { await guardar(env, K.reglas, candidatas); adoptadas = nuevas; quitadas = [...quitar].map((i) => reglas[i].r); }
      else { descartadas = nuevas; await guardar(env, K.rechazadas, [...rechazadas, ...nuevas].slice(-20)); }
      var detalleMejora = Math.round(mejora * 100) / 100;
    }
    await guardar(env, K.fallas, []);   // los errores de producción ya se usaron
  }
  // EVOLUCIÓN DEL CRITERIO (estilo GEPA): el entrenador reescribe el criterio entero mirando errores y aciertos, y se queda con la versión nueva solo si gana en los mismos casos
  let guiaNueva = null;
  if (malos.length >= 2 && !agotada) {
    const versiones = await leer(env, K.guias, []);
    const g = await ia(null, `Sos el entrenador del contestador de "Te Importamos". Reescribí por completo el CRITERIO: un texto de hasta 1200 caracteres, en español rioplatense, que le explique al agente cómo pensar y decidir como el dueño (qué prioriza, cuándo pregunta, cuándo corta, cómo de largo escribe). No son reglas sueltas: es una guía coherente. No pongas precios, números de plata, promesas ni plazos; no uses "siempre" ni "nunca". Mantené lo que ya funciona del criterio actual y corregí lo que causa los errores.
OBJETIVO DEL NEGOCIO: ${OBJETIVO}
CRITERIO ACTUAL:
${guia || "(vacío)"}
ERRORES (cliente / lo que contesté yo / lo que hizo el agente / falla):
${malos.slice(0, 6).map((r, i) => `${i + 1}. ${r.p.c}\n   Yo: ${r.p.y}\n   Agente: ${AGENTE(r.borr)}\n   Falla: ${r.fallas.join("; ")}`).join("\n")}
ACIERTOS (que no se rompan):
${res.filter((r) => r.puntaje >= 8).slice(0, 3).map((r, i) => `${i + 1}. ${r.p.c} -> ${AGENTE(r.borr)}`).join("\n") || "(ninguno)"}
Devolvé JSON: {"criterio":"texto"}`);
    const txt = String(g?.criterio || "").trim().slice(0, 1300);
    if (txt.length > 80 && !/\$\s*\d|\bsiempre\b|\bnunca\b|prometé|prometer|sin excepci[oó]n/i.test(txt) && parecido(txt, guia) < 0.95) {
      const prueba = [...malos.slice(0, 4), ...res.filter((r) => r.puntaje >= 8).slice(0, 3)], nuevos = [];
      for (const r of prueba) { const x = await correr(r.p, reglas, txt); if (x) nuevos.push({ antes: r.puntaje, despues: x.puntaje }); else if (agotada) break; }
      const mejora = nuevos.length ? nuevos.reduce((s, x) => s + x.despues - x.antes, 0) / nuevos.length : 0, peores = nuevos.filter((x) => x.despues < x.antes - 2).length;
      const adopta = nuevos.length >= Math.min(3, prueba.length) && mejora >= 0.3 && peores <= 1;
      versiones.push({ ts: ahora, texto: txt, mejora: Math.round(mejora * 100) / 100, adoptada: adopta });
      await guardar(env, K.guias, versiones.slice(-12));
      if (adopta) { await guardar(env, K.guia, txt); guiaNueva = { mejora: Math.round(mejora * 100) / 100 }; }
    }
  }
  const hist = await leer(env, K.hist, []);
  const derivados = res.filter((r) => r.borr.accion === "humano").length;
  hist.push({ ts: ahora, score, n: res.length, derivados, adoptadas: adoptadas.length, descartadas: descartadas.length, ia: usos });
  await guardar(env, K.hist, hist.slice(-40)); await guardar(env, K.vistos, [...vistos].slice(-300));
  const resumen = { guiaNueva, score, derivados, casos: res.length, malos: malos.length, adoptadas, quitadas, descartadas, mejora: detalleMejora ?? null, ia: usos, ts: ahora };
  await guardar(env, K.ultimo, resumen);
  return resumen;
}

// Lo llama el cron cada minuto: de noche pide 3 rondas; cada ronda corre sola (así cada una usa pocas llamadas a la IA)
export async function cronEntrenador(env, iaJSON, decidir, tiempo = Date.now()) {
  const d = new Date(tiempo);
  if (d.getUTCHours() === 7 && d.getUTCMinutes() === 5) { await revisarResultados(env, tiempo); await kvPut(env, K.pedido, Math.max(+((await kvGet(env, K.pedido)) || 0), 10)); }   // 04:05 de Argentina
  if (+((await kvGet(env, "ent:enfria")) || 0) > tiempo) return null;   // descanso por falta de cupo de la IA
  let pedido = +((await kvGet(env, K.pedido)) || 0);
  if (pedido <= 0) {   // bucle continuo: si pasó un rato desde la última ronda, pide otra sola (de noche más seguido; de día más espaciado para no pelear cupo con los clientes)
    const horaAR = (d.getUTCHours() + 21) % 24, cada = (horaAR >= 9 && horaAR < 22 ? 30 : 8) * 60e3, ult = Math.max((await leer(env, K.ultimo, null))?.ts || 0, (await leer(env, "ent:nota", null))?.ts || 0);
    if (tiempo - ult < cada) return null;
    pedido = 1;
  }
  const corre = +((await kvGet(env, K.corre)) || 0);
  if (tiempo - corre < 3 * 60e3) return null;
  await kvPut(env, K.corre, tiempo); await kvPut(env, K.pedido, pedido - 1);
  try { const r = await rondaEntrenamiento(env, iaJSON, decidir, { ahora: tiempo }); if (r?.nota) await guardar(env, "ent:nota", { ts: tiempo, nota: r.nota }); return r; } finally { await kvPut(env, K.corre, 0); }
}

export async function informe(env) {
  const [reglas, hist, ultimo, fallas, casos, est] = await Promise.all([cargarReglas(env), leer(env, K.hist, []), leer(env, K.ultimo, null), leer(env, K.fallas, []), leer(env, K.casos, []), cargarEstilo(env)]);
  return { ia: { agotados: await modelosAgotados(env) }, reglas, guia: await cargarGuia(env), versionesGuia: (await leer(env, K.guias, [])).length, hist: hist.slice(-12), ultimo, nota: await leer(env, "ent:nota", null), erroresPendientes: fallas.length, pedido: +((await kvGet(env, K.pedido)) || 0), cotizaciones: await estadoCotizaciones(env), correcciones: (await cargarCorrecciones(env)).length, derivacion: (() => { const t = casos.filter((c) => c.accion !== "nada"); return { de: t.length, pct: t.length ? Math.round((100 * t.filter((c) => c.accion === "humano").length) / t.length) : 0 }; })(), estilo: est ? { ts: est.ts, ...est.stats, pares: est.pares.length } : null,
    ultimosCasos: casos.slice(-12).map((c) => ({ ts: c.ts, accion: c.accion, mensaje: c.mensaje, juez: c.juez })) };
}
export async function editarReglas(env, { agregar, borrar }) {
  const rs = await cargarReglas(env);
  if (Number.isInteger(borrar) && rs[borrar]) rs.splice(borrar, 1);
  if (agregar && String(agregar).trim().length > 8) rs.push({ r: String(agregar).trim().slice(0, 220), ts: Date.now(), fuente: "manual" });
  await guardar(env, K.reglas, rs.slice(-MAX_REGLAS)); return rs;
}

// ------------------------------------------------------------------ cotizaciones: de "revisar" a "mandar directo"
// Las cotizaciones que arma el agente quedan guardadas para que las revises. Cada una que confirmás bien suma a la racha; con 7 seguidas
// el agente pasa a mandarlas directo. Si marcás una mal, la racha vuelve a 0, vuelve el modo revisión y el error alimenta el entrenamiento.
export const RACHA_META = 7;
export async function estadoCotizaciones(env) { const racha = +((await kvGet(env, "cot:racha")) || 0); return { racha, meta: RACHA_META, directo: (await kvGet(env, "cot:directo")) === "1", faltan: Math.max(0, RACHA_META - racha) }; }
export async function revisarCotizacion(env, num, bien, motivo = "") {
  const k = "cot:rev:" + num;
  if (await kvGet(env, k)) return { ...(await estadoCotizaciones(env)), ya: true };
  await kvPut(env, k, bien ? "bien" : "mal");
  let racha = +((await kvGet(env, "cot:racha")) || 0);
  if (bien) { racha++; if (racha >= RACHA_META) await kvPut(env, "cot:directo", "1"); }
  else {
    racha = 0; await kvPut(env, "cot:directo", "0");
    let det = `cotización N° ${num}`;
    try { const f = await env.DB.prepare("SELECT datos FROM cotiz_manual WHERE num=?").bind(num).first(); const d = JSON.parse(f?.datos || "{}"); det += ": " + (d.items || []).map((i) => `${i.nombre} x${i.cantidad}, ${i.peso} kg por unidad, FOB USD ${i.precio}`).join("; "); } catch {}
    const fallas = await leer(env, K.fallas, []); fallas.push({ ts: Date.now(), ctx: [{ yo: 0, t: "el cliente pasó los datos para cotizar" }], agente: det, motivo: `el dueño marcó mal la cotización: ${motivo || "sin detalle"}`, real: "" });
    await guardar(env, K.fallas, fallas.slice(-40));
  }
  await kvPut(env, "cot:racha", racha);
  return { ...(await estadoCotizaciones(env)), ya: false };
}
