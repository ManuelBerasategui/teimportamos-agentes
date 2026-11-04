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
export const K = { estilo: "ent:estilo", reglas: "ent:reglas", casos: "ent:casos", fallas: "ent:fallas", hist: "ent:hist", pedido: "ent:pedido", ultimo: "ent:ultimo", vistos: "ent:vistos", rechazadas: "ent:rechazadas", corre: "ent:corre" };
export const MAX_REGLAS = 12;

const BOT = /^\s*(bienvenid[oa]|te voy a derivar|gracias por escribir)/i;   // mensajes automáticos de WhatsApp Business: no son míos
const STOP = new Set("de la el en y a que lo un una te me se con por para es no si los las del al mi tu su ya le les mas más muy como pero esto eso este esta".split(" "));
const sinTilde = (t) => String(t || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const palabras = (t) => sinTilde(t).replace(/https?:\/\/\S+/g, " ").split(/[^a-z0-9ñ]+/).filter(Boolean);
const comp = (m) => ({ yo: m.yo ? 1 : 0, t: String(m.texto || `[${m.tipo || "archivo"}]`).replace(/\s+/g, " ").slice(0, 200) });
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
  const propios = [], pares = [];
  for (const [conv, ms] of porConv) {
    ms.sort((a, b) => a.ts - b.ts);
    let pend = [], ctx = [];
    for (const m of ms) {
      const t = String(m.texto || "").trim();
      if (!m.yo) { if (m.tipo === "text" && t) pend.push(t); ctx.push(m); continue; }
      const mio = m.tipo === "text" && t.length >= 8 && t.length <= 400 && !BOT.test(t) && !/^https?:\/\/\S+$/.test(t);
      if (mio) { propios.push(t); if (pend.length) pares.push({ id: `${conv}:${m.ts}`, ts: m.ts, c: pend.slice(-3).join(" / ").slice(0, 300), y: t, ctx: ctx.slice(-7).map(comp) }); }
      pend = []; ctx.push(m);
    }
  }
  const vistos = new Set(), unicos = [];
  for (const p of pares.sort((a, b) => b.ts - a.ts)) { const k = sinTilde(p.y); if (vistos.has(k)) continue; vistos.add(k); unicos.push(p); if (unicos.length >= 150) break; }
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
export const reglasTexto = (rs) => rs.map((x, i) => `${i + 1}. ${x.r}`).join("\n");

// ------------------------------------------------------------------ 2) JUEZ
export function chequeoDuro(mensaje, est, msgs = []) {
  const t = String(mensaje || "").trim(), f = [], p90 = est?.stats?.p90 || 140, max = Math.max(220, Math.round(p90 * 1.8));
  if (t.length > max) f.push(`muy largo (${t.length} caracteres; yo escribo hasta ~${p90})`);
  if (t.split(/\n/).filter(Boolean).length > 3) f.push("más de 3 líneas");
  if ((t.match(/\?/g) || []).length > 2) f.push("demasiadas preguntas juntas");
  if (/^(claro|dale|buen[ií]simo|genial|perfecto|excelente|obvio|por supuesto)\b/i.test(t)) f.push("arranca con muletilla");
  if (/\b(estimad[oa]|le informo|cordial(es)?|a su disposici[oó]n|usted|su consulta)\b/i.test(t)) f.push("tono formal");
  if ((t.match(/\p{Extended_Pictographic}/gu) || []).length > 2) f.push("demasiados emojis");
  if (/\*\*|^#|^\s*[-•]\s/m.test(t)) f.push("usa formato o listas");
  const mio = [...msgs].reverse().find((x) => x.yo);
  if (mio && parecido(mio.texto, t) > 0.8) f.push("repite casi igual lo que ya le dije");
  return f;
}

const charlaTexto = (msgs) => msgs.map((m) => `${m.yo ? "YO" : "CLIENTE"}: ${String(m.texto || `[${m.tipo || "archivo"}]`).replace(/\s+/g, " ").slice(0, 300)}`).join("\n");
export const OBJETIVO = `Cotizamos solos cuando el cliente manda link de Alibaba + cantidad, o cuando nos pasa peso del producto en gramos, cantidad de unidades y precio FOB unitario. Si falta algo, hay que conseguir esos 3 datos en la menor cantidad de mensajes: pedir TODO lo que falte junto en un solo mensaje y nunca pedir lo que ya dio.`;

export async function juzgar(env, iaJSON, { msgs, mensaje, est, reglas = [] }) {
  const duras = chequeoDuro(mensaje, est, msgs);
  let r = null;
  if (env.JUEZ !== "0") {
    r = await iaJSON(env, `Sos el revisor de calidad del contestador de "Te Importamos" (importación por encargo desde China, Rosario). Evaluá el BORRADOR que mandaría el agente como si fueras el dueño y lo leyera su cliente.
Cómo escribo yo: ${perfilTexto(est) || "tono cercano, voseo, directo, mensajes cortos"}
${reglas.length ? "Reglas que aprendí:\n" + reglasTexto(reglas) + "\n" : ""}OBJETIVO DEL NEGOCIO: ${OBJETIVO}

CONVERSACIÓN:
${charlaTexto(msgs)}

BORRADOR: "${mensaje}"

Puntaje de 1 a 10 (7 o más = se puede enviar). Criterios: (1) contesta lo que el cliente realmente escribió o preguntó; (2) avanza hacia el objetivo del negocio sin pedir lo que ya dio; (3) no inventa datos, precios, plazos ni promete cosas; (4) suena a mí: tono, largo y vocabulario, sin ¿ ni ¡ ni frases de call center; (5) no repite lo que ya dije.
Devolvé JSON: {"ok":true|false,"puntaje":1-10,"fallas":["falla corta"],"mensaje_mejorado":"versión corregida (solo si puntaje<7; si no, vacío)"}`, { prioridad: true }).catch(() => null);
  }
  const puntaje = Number.isFinite(+r?.puntaje) && r?.puntaje !== null ? +r.puntaje : null;   // sin juez (IA caída): valen solo los chequeos duros
  const fallas = [...duras, ...(Array.isArray(r?.fallas) ? r.fallas.map((x) => String(x).slice(0, 80)).slice(0, 4) : [])];
  return { ok: !duras.length && (puntaje === null || puntaje >= 7) && r?.ok !== false, puntaje, fallas, mejorado: String(r?.mensaje_mejorado || "").trim() };
}

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

async function comparar(ia, { ctx, real, agente }) {
  return ia(null, `Sos el dueño de "Te Importamos" (importación por encargo desde China, Rosario). Abajo está una charla real, cómo contesté YO de verdad y cómo contestó el AGENTE (decide "responder" con un mensaje, "humano" = me lo deja a mí, o "nada" = no contesta).
Puntuá al agente de 1 a 10: ¿habría sido una respuesta igual de buena que la mía para el cliente?
- Mismo objetivo que la mía, tono y largo parecidos a los míos, sin inventar datos, sin pedir lo que el cliente ya dio, sin repetir.
- Si el agente lo dejó para mí ("humano") y mi respuesta real trató de pagos, reclamos, precios, negociación, condiciones o algo que él no puede resolver, es CORRECTO (8 o más).
- Si el agente no contestó ("nada") pero yo contesté algo que había que contestar, o si contestó algo que yo no habría dicho, es un error.
OBJETIVO DEL NEGOCIO: ${OBJETIVO}

CONVERSACIÓN:
${charlaTexto(ctx.map((m) => ({ yo: m.yo, texto: m.t })))}

MI RESPUESTA REAL: ${real}
AGENTE: ${agente}

Devolvé JSON: {"puntaje":1-10,"fallas":["falla corta"],"regla":"una regla corta en imperativo, general (no de este chat), que evitaría este error; vacío si el agente estuvo bien"}`);
}

export async function rondaEntrenamiento(env, iaBase, decidir, { n = 6, maxIA = 34, ahora = Date.now() } = {}) {
  let usos = 0, agotada = false;
  const ia = async (e, prompt, o = {}) => { if (usos >= maxIA) { agotada = true; return null; } usos++; return iaBase(env, prompt, { ...o, sinRespaldo: true }); };   // el respaldo de Cloudflare AI queda para los clientes
  let est = await cargarEstilo(env);
  if (!est || ahora - est.ts > 20 * 3600e3) est = await construirEstilo(env, ahora);
  if (!est.pares.length) return { nota: "todavía no hay conversaciones tuyas para entrenar" };
  const reglas = await cargarReglas(env), rechazadas = await leer(env, K.rechazadas, []);
  let vistos = new Set(await leer(env, K.vistos, []));
  let cand = est.pares.filter((p) => p.ctx?.length && !p.ctx.at(-1)?.yo && !vistos.has(p.id));
  if (cand.length < n) { vistos = new Set(); cand = est.pares.filter((p) => p.ctx?.length && !p.ctx.at(-1)?.yo); }
  const lote = mezclar(cand).slice(0, n), res = [];
  const correr = async (p, reglasUsar) => {
    const msgs = p.ctx.map((m) => ({ yo: m.yo, texto: m.t, tipo: "text" }));
    const ultimo = [...msgs].reverse().find((m) => !m.yo);
    const borr = await decidir({ c: { nombre: "" }, msgs, ultimo, est, reglas: reglasUsar, excluir: p.id }, ia);
    if (!borr) return null;
    const v = await comparar(ia, { ctx: p.ctx, real: p.y, agente: AGENTE(borr) });
    if (!Number.isFinite(+v?.puntaje)) return null;
    return { p, borr, puntaje: +v.puntaje, fallas: v?.fallas || [], regla: String(v?.regla || "").trim() };
  };
  for (const p of lote) { const r = await correr(p, reglas); if (!r) { if (agotada) break; continue; } res.push(r); vistos.add(p.id); }
  if (!res.length) return { nota: agotada ? "la IA no respondió (cupo agotado), sigo mañana" : "no pude evaluar casos" };
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
    const nuevas = (Array.isArray(refl?.reglas) ? refl.reglas : []).map((x) => String(x).trim().slice(0, 220)).filter((x) => x.length > 12 && !/\$\s*\d|precio fijo|prometé|prometer/i.test(x) && !reglas.some((y) => parecido(y.r, x) > 0.6)).slice(0, 3);
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
  const hist = await leer(env, K.hist, []);
  hist.push({ ts: ahora, score, n: res.length, adoptadas: adoptadas.length, descartadas: descartadas.length, ia: usos });
  await guardar(env, K.hist, hist.slice(-40)); await guardar(env, K.vistos, [...vistos].slice(-300));
  const resumen = { score, casos: res.length, malos: malos.length, adoptadas, quitadas, descartadas, mejora: detalleMejora ?? null, ia: usos, ts: ahora };
  await guardar(env, K.ultimo, resumen);
  return resumen;
}

// Lo llama el cron cada minuto: de noche pide 3 rondas; cada ronda corre sola (así cada una usa pocas llamadas a la IA)
export async function cronEntrenador(env, iaJSON, decidir, tiempo = Date.now()) {
  const d = new Date(tiempo);
  if (d.getUTCHours() === 7 && d.getUTCMinutes() === 5) { await revisarResultados(env, tiempo); await kvPut(env, K.pedido, Math.max(+((await kvGet(env, K.pedido)) || 0), 3)); }   // 04:05 de Argentina
  const pedido = +((await kvGet(env, K.pedido)) || 0);
  if (pedido <= 0) return null;
  const corre = +((await kvGet(env, K.corre)) || 0);
  if (tiempo - corre < 3 * 60e3) return null;
  await kvPut(env, K.corre, tiempo); await kvPut(env, K.pedido, pedido - 1);
  try { return await rondaEntrenamiento(env, iaJSON, decidir, { ahora: tiempo }); } finally { await kvPut(env, K.corre, 0); }
}

export async function informe(env) {
  const [reglas, hist, ultimo, fallas, casos, est] = await Promise.all([cargarReglas(env), leer(env, K.hist, []), leer(env, K.ultimo, null), leer(env, K.fallas, []), leer(env, K.casos, []), cargarEstilo(env)]);
  return { reglas, hist: hist.slice(-12), ultimo, erroresPendientes: fallas.length, pedido: +((await kvGet(env, K.pedido)) || 0), estilo: est ? { ts: est.ts, ...est.stats, pares: est.pares.length } : null,
    ultimosCasos: casos.slice(-12).map((c) => ({ ts: c.ts, accion: c.accion, mensaje: c.mensaje, juez: c.juez })) };
}
export async function editarReglas(env, { agregar, borrar }) {
  const rs = await cargarReglas(env);
  if (Number.isInteger(borrar) && rs[borrar]) rs.splice(borrar, 1);
  if (agregar && String(agregar).trim().length > 8) rs.push({ r: String(agregar).trim().slice(0, 220), ts: Date.now(), fuente: "manual" });
  await guardar(env, K.reglas, rs.slice(-MAX_REGLAS)); return rs;
}
