// ============================================================================
// MENSAJES PARA LOS GRUPOS DE WHATSAPP (panel › WhatsApp › Grupos)
// ----------------------------------------------------------------------------
// Todos los días a las 7 h el agente propone 4 mensajes listos para pegar en los
// grupos mayoristas. Se basa en:
//   - el ESTILO de lo que ya mandamos (chat exportado que se sube una vez + lo que
//     el lector ve que mandamos en los grupos desde el 805 + lo que se marca enviado)
//   - los reportes diario y semanal del 805 (claves, qué se pidió, difusión)
//   - lo que más piden los clientes por privado y lo que preguntan en los grupos
//   - las correcciones del equipo (lo que editó antes de mandar y lo que descartó)
// Las fotos las pone el equipo: cada mensaje trae una sugerencia de qué foto usar.
// NUNCA manda nada a WhatsApp: solo propone textos.
// ============================================================================

import { esquemaAlDia, marcarEsquema } from "./esquema.js";
const AR = 3 * 3600e3;
const diaAR = (ts = Date.now()) => new Date(ts - AR).toISOString().slice(0, 10);
const fecha = (ts) => new Date(ts - AR).toISOString().slice(5, 10).split("-").reverse().join("/");
export const GRUPOS = { porDia: 4, horaGenera: 7, horas: ["08:30", "13:00", "16:30", "19:30"] };
// Lo que no se promociona en los grupos (mismas reglas que el resto del sistema)
const RE_PROHIBIDO = /\bvap\w*|elf ?bar|\bignite\b|\bpods?\b|r[eé]plica|falsificad|trucho|tabaco|cigarr/i;

let listo = false;
export async function prepararGrupos(env) {
  if (listo || !env.DB) return;
  if (await esquemaAlDia(env, "grupos", prepararGrupos)) { listo = true; return; }
  await env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS g_estilo (id TEXT PRIMARY KEY, ts INTEGER, texto TEXT, fuente TEXT)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS g_estilo_ts ON g_estilo(ts)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS g_sug (id TEXT PRIMARY KEY, dia TEXT, n INTEGER, hora TEXT, tipo TEXT, producto TEXT, por_que TEXT, foto TEXT, texto TEXT, estado TEXT DEFAULT 'nuevo', final TEXT, creado INTEGER, act INTEGER)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS g_sug_dia ON g_sug(dia)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT, exp INTEGER)"),
  ]);
  listo = true;
  await marcarEsquema(env, "grupos", prepararGrupos);
}
const kvGet = async (env, k) => (await env.DB.prepare("SELECT v FROM kv WHERE k=?").bind(k).first())?.v ?? null;
const kvPut = (env, k, v) => env.DB.prepare("INSERT INTO kv (k,v,exp) VALUES (?,?,NULL) ON CONFLICT(k) DO UPDATE SET v=excluded.v, exp=NULL").bind(k, String(v)).run();
const todas = async (env, sql, ...b) => (await env.DB.prepare(sql).bind(...b).all()).results || [];
function hash(s) { let h = 2166136261; for (const c of String(s)) { h ^= c.codePointAt(0); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }
const norm = (t) => String(t || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9ñ$ ]+/g, " ").replace(/\s+/g, " ").trim();

// ---------------------------------------------------------------------------
// 1) Chat exportado de WhatsApp (.txt de "Exportar chat", iPhone o Android)
// ---------------------------------------------------------------------------
const RE_LINEA = /^\[?(\d{1,2})\/(\d{1,2})\/(\d{2,4}),? (\d{1,2}):(\d{2})(?::(\d{2}))?\s?([ap]\.?\s?m\.?)?\]?(?: -)? ([^:\n]{1,80}):[ \n]/gim;
const RE_BASURA = /<(adjunto|attached|archivo adjunto)[^>]*>|<se edit[oó] este mensaje\.?>|<this message was edited>|\(archivo adjunto\)/gi;
const RE_VACIO = /^(se elimin[oó] este mensaje|eliminaste este mensaje|this message was deleted|(imagen|audio|video|sticker|gif|documento) omitid[oa]|<multimedia omitido>|<media omitted>|null)\.?$/i;
export function parsearExport(txt) {
  const t = String(txt || "").replace(/[‎‏‪-‮⁦-⁩﻿]/g, "").replace(/[  ]/g, " ").replace(/\r/g, "");
  const marcas = [...t.matchAll(RE_LINEA)];
  const msgs = [];
  marcas.forEach((m, i) => {
    let [, d, mes, a, hh, mm, ss, ampm, autor] = m;
    a = +a < 100 ? 2000 + +a : +a; hh = +hh;
    if (ampm && /p/i.test(ampm) && hh < 12) hh += 12; if (ampm && /a/i.test(ampm) && hh === 12) hh = 0;
    const ts = Date.UTC(a, +mes - 1, +d, hh, +mm, +(ss || 0)) + AR;
    const texto = t.slice(m.index + m[0].length, i + 1 < marcas.length ? marcas[i + 1].index : t.length).replace(RE_BASURA, "").trim();
    msgs.push({ ts, autor: autor.trim(), texto });
  });
  // "Nosotros" = quien más escribió entre los que se llaman Te Importamos (el nombre del grupo también lo dice: se descarta por tener pocos mensajes)
  const cuenta = {}; for (const m of msgs) cuenta[m.autor] = (cuenta[m.autor] || 0) + 1;
  const ranking = Object.entries(cuenta).sort((a, b) => b[1] - a[1]);
  const remitente = (ranking.find(([n]) => /te ?importamos/i.test(n) && !/^#|mayorista/i.test(n)) || ranking.find(([n]) => /te ?importamos/i.test(n)) || ranking[0] || [""])[0];
  const nuestros = msgs.filter((m) => m.autor === remitente && m.texto.length >= 20 && !RE_VACIO.test(m.texto)).map((m) => ({ ts: m.ts, texto: m.texto.slice(0, 3000) }));
  return { remitente, total: msgs.length, nuestros };
}
export async function importarExport(env, txt) {
  await prepararGrupos(env);
  const r = parsearExport(txt);
  if (!r.nuestros.length) return { ok: false, error: "No encontré mensajes de Te Importamos en ese archivo. ¿Es el .txt (o .zip) de Exportar chat de un grupo?" };
  const antes = (await env.DB.prepare("SELECT COUNT(*) n FROM g_estilo").first())?.n || 0;
  const ops = r.nuestros.map((m) => env.DB.prepare("INSERT OR IGNORE INTO g_estilo (id,ts,texto,fuente) VALUES (?,?,?,'export')").bind("exp:" + hash(norm(m.texto)), m.ts, m.texto));
  for (let i = 0; i < ops.length; i += 80) await env.DB.batch(ops.slice(i, i + 80));
  const despues = (await env.DB.prepare("SELECT COUNT(*) n FROM g_estilo").first())?.n || 0;
  return { ok: true, remitente: r.remitente, leidos: r.nuestros.length, nuevos: despues - antes, total: despues };
}

// ---------------------------------------------------------------------------
// 2) Contexto para la IA
// ---------------------------------------------------------------------------
async function enviadosEnGrupos(env, desde) {
  // Lo que mandamos en los grupos y vio el lector (si existe la tabla del 805)
  return todas(env, "SELECT texto, ts FROM w_msg WHERE grupo=1 AND yo=1 AND ts>=? AND length(texto)>=20 AND texto NOT LIKE '(archivo)%' ORDER BY ts DESC LIMIT 400", desde).catch(() => []);
}
export async function ejemplosEstilo(env, n = 30) {
  const a = await todas(env, "SELECT texto, ts FROM g_estilo ORDER BY ts DESC LIMIT 600");
  const b = await enviadosEnGrupos(env, Date.now() - 120 * 86400e3);
  const vistos = new Set(), l = [];
  for (const x of [...a, ...b].sort((p, q) => q.ts - p.ts)) {
    const k = norm(x.texto).slice(0, 70); if (!k || vistos.has(k) || RE_PROHIBIDO.test(x.texto)) continue;
    vistos.add(k); l.push(x);
  }
  // los más nuevos (cómo escribimos hoy) + una muestra pareja del resto (variedad de formatos)
  const nuevos = l.slice(0, Math.ceil(n * 0.6)), resto = l.slice(nuevos.length), paso = Math.max(1, Math.floor(resto.length / (n - nuevos.length || 1)));
  return { total: l.length, ejemplos: [...nuevos, ...resto.filter((_, i) => i % paso === 0).slice(0, n - nuevos.length)] };
}
async function contexto(env, dia) {
  const ahora = Date.now(), d7 = ahora - 7 * 86400e3;
  const estilo = await ejemplosEstilo(env, 30);
  const recientes = [...(await todas(env, "SELECT texto, ts FROM g_estilo WHERE ts>=? ORDER BY ts DESC LIMIT 80", ahora - 30 * 86400e3)), ...(await enviadosEnGrupos(env, ahora - 30 * 86400e3))]
    .filter((x) => !RE_PROHIBIDO.test(x.texto)).sort((a, b) => b.ts - a.ts);
  const vistos = new Set(), ult = [];
  for (const x of recientes) { const k = norm(x.texto).slice(0, 70); if (vistos.has(k)) continue; vistos.add(k); ult.push(x); }
  const reportes = (await todas(env, "SELECT tipo, desde, datos FROM reportes WHERE tipo IN ('805_diario','805_semanal') ORDER BY desde DESC LIMIT 6").catch(() => []))
    .map((r) => { let d = {}; try { d = JSON.parse(r.datos || "{}"); } catch {} const ia = d.ia || {};
      return { tipo: r.tipo === "805_semanal" ? "semanal" : "diario", dia: fecha(r.desde), titular: ia.titular, claves: ia.claves, grupos: ia.grupos, recomendacion: ia.recomendacion, para_grupos: (ia.difusion || []).map((x) => ({ producto: x.producto, por_que: x.por_que })) }; })
    .filter((r, i, l) => r.tipo === "diario" ? l.filter((x) => x.tipo === "diario").indexOf(r) < 3 : l.filter((x) => x.tipo === "semanal").indexOf(r) < 1);
  const pedidos = await todas(env, "SELECT producto, COUNT(*) n FROM w_conv WHERE grupo=0 AND producto<>'' AND COALESCE(etapa,'')<>'no_cliente' AND ult_ts>=? GROUP BY lower(producto) ORDER BY n DESC LIMIT 25", d7).catch(() => []);
  const preguntasGrupos = await todas(env, "SELECT texto FROM w_msg WHERE grupo=1 AND yo=0 AND ts>=? AND length(texto)>=8 ORDER BY ts DESC LIMIT 60", d7).catch(() => []);
  const mem = await todas(env, "SELECT texto FROM ag_mem ORDER BY id DESC LIMIT 12").catch(() => []);
  const prev = await todas(env, "SELECT dia, tipo, producto, estado, texto, final FROM g_sug WHERE dia>=? AND dia<? ORDER BY dia DESC, n", diaAR(ahora - 21 * 86400e3), dia);
  const corregidos = prev.filter((p) => p.estado === "enviado" && p.final && norm(p.final) !== norm(p.texto)).slice(0, 6).map((p) => ({ propuesto: p.texto.slice(0, 500), mandado: p.final.slice(0, 500) }));
  const descartados = prev.filter((p) => p.estado === "descartado").slice(0, 12).map((p) => `${p.tipo}: ${p.producto}`);
  const usados = prev.filter((p) => p.dia >= diaAR(ahora - 5 * 86400e3)).map((p) => p.producto);
  return { estilo, ult: ult.slice(0, 40), reportes, pedidos: pedidos.filter((p) => !RE_PROHIBIDO.test(p.producto)), preguntasGrupos: preguntasGrupos.map((x) => x.texto.slice(0, 200)).filter((t) => !RE_PROHIBIDO.test(t)), mem: mem.map((m) => m.texto), corregidos, descartados, usados };
}

const MANUAL_GRUPOS = `
CÓMO ESCRIBIMOS EN LOS GRUPOS (sacado de nuestros mensajes reales):
- Tono rioplatense, cercano y con energía: "Gente", "Gentee", "les dejo", "les paso", "pidan por privado", "la rompen", "venden todo al toque". Nada formal ni de folleto.
- Formato de WhatsApp: *negrita* para títulos y precios, _cursiva_, ~tachado~ para el precio viejo. Títulos cortos en MAYÚSCULA con 🔥, 📦, ⚽, 🚨. Listas con 👉, ✅, • o -.
- Formatos que más usamos y funcionan:
  1. Lista de precios mayorista con escalas por cantidad (x unidad / x5 / x10 / media docena / docena / caja cerrada).
  2. Combos o packs con nombre propio ("Combo Conectividad", "Pack Top Ventas Inicial", "Los Reyes del Hype"), qué trae cada uno y *TOTAL DEL COMBO*. Packs por presupuesto (baja / media / alta inversión).
  3. "NUEVO INGRESO" o "Lo que tanto pidieron": producto puntual, 3-5 viñetas de beneficios y *PRECIO MAYORISTA*.
  4. Urgencia real: "ÚLTIMOS CUPOS", "oferta por tiempo limitado", "válido esta semana".
  5. Comunidad y confianza: "Gentee hagan sus consultas, estamos atendiendo", "importamos LO QUE QUIERAN, mándennos una foto", catálogo o tienda, novedades del equipo.
  6. Estacional u oportunidad de reventa: verano, Día del Niño, partidos, gimnasios, barberías ("si la querés romper en el verano mirá esto").
- Siempre cierra con un llamado a la acción: "consultas por privado 📩", "pídanlo por privado y les tomo el pedido", "reserven su cupo".
- Largo: de 3 a 12 líneas. Una lista de precios puede ser más larga.
`;

function promptDia(c, dia, extra = "") {
  const dow = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"][new Date(Date.parse(dia + "T12:00:00Z")).getUTCDay()];
  return `Sos el responsable de los grupos mayoristas de WhatsApp de "Te Importamos" (importación por mayor desde China y Paraguay para revendedores; Rosario, Argentina). Hoy es ${dow} ${dia.split("-").reverse().join("/")}.
Escribí los ${GRUPOS.porDia} mensajes de HOY para los grupos, de alto impacto, idénticos en estilo a los nuestros. Las fotos las pone el equipo: vos escribís el texto y decís qué foto conviene.
${MANUAL_GRUPOS}
REGLAS:
- Copiá nuestro estilo de los EJEMPLOS (emojis, negritas, cómo armamos listas y combos, cómo cerramos). Que parezcan escritos por nosotros, no por una IA.
- PRECIOS: usá SOLO precios que aparezcan en NUESTROS MENSAJES DE LOS ÚLTIMOS 30 DÍAS, copiados tal cual. Si no hay precio para ese producto, escribí [PRECIO] (y [TOTAL] en combos) para que el equipo lo complete. Nunca inventes precios, mínimos, plazos ni stock.
- Prohibido: vapers, pods, Elfbar, Ignite, tabaco, fármacos, la palabra "réplica", y decir "original" de algo que no sabemos que lo es.
- Variá: los ${GRUPOS.porDia} mensajes tienen que ser de productos y formatos distintos entre sí. Ideal: 1 oferta o combo con precios, 1 producto de lo que MÁS PIDEN por privado o en los grupos, 1 tendencia o nuevo ingreso según los reportes, 1 de comunidad/confianza o urgencia.
- No repitas productos usados en los últimos días (${JSON.stringify(c.usados.slice(0, 20))}) salvo que la demanda lo justifique mucho.
- Aprendé de las CORRECCIONES del equipo (cómo cambió nuestros textos antes de mandarlos) y evitá lo DESCARTADO.
- Horas sugeridas (cuando más mandamos): ${GRUPOS.horas.join(", ")}.
${extra}
EJEMPLOS DE NUESTRO ESTILO (${c.estilo.total} mensajes guardados; acá una muestra):
${c.estilo.ejemplos.map((e, i) => `--- ejemplo ${i + 1} (${fecha(e.ts)})\n${e.texto.slice(0, 650)}`).join("\n").slice(0, 16000) || "(todavía no hay ejemplos: usá el manual de estilo)"}

NUESTROS MENSAJES DE LOS ÚLTIMOS 30 DÍAS (fuente de precios y para no repetir):
${c.ult.map((e) => `[${fecha(e.ts)}] ${e.texto.slice(0, 450).replace(/\n+/g, " / ")}`).join("\n").slice(0, 9000) || "(ninguno)"}

REPORTES DEL 805 (diarios y semanal): ${JSON.stringify(c.reportes).slice(0, 6000)}
LO MÁS PEDIDO POR PRIVADO (7 días, chats por producto): ${JSON.stringify(c.pedidos)}
LO QUE PREGUNTAN EN LOS GRUPOS (7 días): ${JSON.stringify(c.preguntasGrupos).slice(0, 3000)}
MEMORIA DEL AGENTE (indicaciones del dueño): ${JSON.stringify(c.mem).slice(0, 2000)}
CORRECCIONES DEL EQUIPO (propuesto → lo que mandaron de verdad): ${JSON.stringify(c.corregidos).slice(0, 3500)}
DESCARTADOS: ${JSON.stringify(c.descartados)}

Respondé SOLO JSON: {"mensajes":[{"hora":"HH:MM","tipo":"combo|lista|producto|tendencia|comunidad|urgencia|estacional","producto":"producto o tema en pocas palabras","por_que":"1 oración con el dato que lo justifica (reporte, pedidos, grupos)","foto":"qué foto o fotos poner (ej. 'foto del pack armado sobre fondo blanco')","mensaje":"el texto listo para pegar, con saltos de línea"}]}`;
}

function limpiarMensajes(l) {
  return (Array.isArray(l) ? l : []).filter((m) => m && typeof m.mensaje === "string" && m.mensaje.trim().length >= 20 && !RE_PROHIBIDO.test(m.mensaje + " " + (m.producto || "")))
    .map((m) => ({ hora: /^\d{1,2}:\d{2}$/.test(m.hora || "") ? m.hora.padStart(5, "0") : "", tipo: String(m.tipo || "").slice(0, 20), producto: String(m.producto || "").slice(0, 120), por_que: String(m.por_que || "").slice(0, 300), foto: String(m.foto || "").slice(0, 200), mensaje: m.mensaje.trim().slice(0, 3500) }));
}

// ---------------------------------------------------------------------------
// 3) Generar los del día (o rehacer uno)
// ---------------------------------------------------------------------------
export async function generarDia(env, iaJSON, { dia = diaAR(), forzar = false, avisar = false, base = "" } = {}) {
  await prepararGrupos(env);
  const ya = await todas(env, "SELECT * FROM g_sug WHERE dia=? ORDER BY n", dia);
  if (ya.length && !forzar) return { ok: true, dia, mensajes: ya, nuevo: false };
  const c = await contexto(env, dia);
  let msgs = [];
  for (let i = 0; i < 2 && msgs.length < GRUPOS.porDia; i++) {
    const r = await iaJSON(env, promptDia(c, dia), { prioridad: !avisar });
    msgs = limpiarMensajes(r?.mensajes).slice(0, GRUPOS.porDia);
  }
  if (!msgs.length) return { ok: false, error: "La IA no respondió. Probá de nuevo en un rato." };
  // Al rehacer el día se conservan los que ya se mandaron o se editaron
  const quedan = ya.filter((x) => x.estado === "enviado");
  const ops = [env.DB.prepare("DELETE FROM g_sug WHERE dia=? AND estado<>'enviado'").bind(dia)];
  let n = 0; const ocupados = new Set(quedan.map((x) => x.n));
  for (const m of msgs) {
    if (quedan.length + n >= GRUPOS.porDia) break;
    let k = 0; while (ocupados.has(k)) k++; ocupados.add(k); n++;
    ops.push(env.DB.prepare("INSERT OR REPLACE INTO g_sug (id,dia,n,hora,tipo,producto,por_que,foto,texto,estado,creado,act) VALUES (?,?,?,?,?,?,?,?,?,'nuevo',?,?)")
      .bind(`${dia}:${k}`, dia, k, m.hora || GRUPOS.horas[k] || "", m.tipo, m.producto, m.por_que, m.foto, m.mensaje, Date.now(), Date.now()));
  }
  await env.DB.batch(ops);
  const fin = await todas(env, "SELECT * FROM g_sug WHERE dia=? ORDER BY n", dia);
  if (avisar) await avisoTelegram(env, fin, base).catch(() => {});
  return { ok: true, dia, mensajes: fin, nuevo: true };
}
export async function otraVersion(env, iaJSON, id, pedido = "") {
  await prepararGrupos(env);
  const s = await env.DB.prepare("SELECT * FROM g_sug WHERE id=?").bind(id).first();
  if (!s) return { ok: false, error: "No existe" };
  const hermanos = await todas(env, "SELECT producto, texto FROM g_sug WHERE dia=? AND id<>?", s.dia, id);
  const c = await contexto(env, s.dia);
  const extra = `- Ahora necesito SOLO 1 mensaje nuevo para reemplazar este, que no convenció:\n"""${s.texto.slice(0, 800)}"""\n${pedido ? `- Lo que pidió el equipo: ${String(pedido).slice(0, 300)}\n` : "- Hacé algo distinto (otro producto u otro formato).\n"}- No repitas estos otros de hoy: ${JSON.stringify(hermanos.map((h) => h.producto))}. Devolvé "mensajes" con 1 solo elemento.`;
  const r = await iaJSON(env, promptDia(c, s.dia, extra), { prioridad: true });
  const m = limpiarMensajes(r?.mensajes)[0];
  if (!m) return { ok: false, error: "La IA no respondió. Probá de nuevo." };
  await env.DB.prepare("UPDATE g_sug SET hora=?, tipo=?, producto=?, por_que=?, foto=?, texto=?, estado='nuevo', final=NULL, act=? WHERE id=?")
    .bind(m.hora || s.hora, m.tipo, m.producto, m.por_que, m.foto, m.mensaje, Date.now(), id).run();
  return { ok: true, mensaje: await env.DB.prepare("SELECT * FROM g_sug WHERE id=?").bind(id).first() };
}
export async function marcar(env, id, estado, texto) {
  await prepararGrupos(env);
  const s = await env.DB.prepare("SELECT * FROM g_sug WHERE id=?").bind(id).first();
  if (!s) return { ok: false, error: "No existe" };
  const est = ["nuevo", "enviado", "descartado"].includes(estado) ? estado : s.estado;
  const final = typeof texto === "string" && texto.trim() ? texto.trim().slice(0, 3500) : (est === "enviado" ? s.final || s.texto : s.final);
  await env.DB.prepare("UPDATE g_sug SET estado=?, final=?, act=? WHERE id=?").bind(est, final, Date.now(), id).run();
  // Lo que se manda pasa a ser ejemplo de estilo (así aprende de cada corrección)
  if (est === "enviado" && final) await env.DB.prepare("INSERT OR IGNORE INTO g_estilo (id,ts,texto,fuente) VALUES (?,?,?,'panel')").bind("pan:" + hash(norm(final)), Date.now(), final).run();
  return { ok: true };
}

// Si el lector ve que mandamos en un grupo algo parecido a una propuesta, la marca enviada sola (con el texto real)
function parecido(a, b) {
  const A = new Set(norm(a).split(" ").filter((w) => w.length > 2)), B = new Set(norm(b).split(" ").filter((w) => w.length > 2));
  if (!A.size || !B.size) return 0; let i = 0; for (const w of A) if (B.has(w)) i++;
  return i / Math.min(A.size, B.size);
}
export async function detectarEnviados(env) {
  await prepararGrupos(env);
  const pend = await todas(env, "SELECT * FROM g_sug WHERE estado='nuevo' AND dia>=?", diaAR(Date.now() - 2 * 86400e3));
  if (!pend.length) return 0;
  const reales = await enviadosEnGrupos(env, Math.min(...pend.map((p) => p.creado)));
  let n = 0; const usados = new Set();
  for (const p of pend.sort((a, b) => b.creado - a.creado)) {
    const r = reales.find((x) => !usados.has(x) && x.ts >= p.creado && parecido(p.texto, x.texto) >= 0.6);
    if (r) { usados.add(r); await env.DB.prepare("UPDATE g_sug SET estado='enviado', final=?, act=? WHERE id=?").bind(r.texto, Date.now(), p.id).run(); n++; }
  }
  return n;
}

// ---------------------------------------------------------------------------
// 4) Aviso por Telegram (1 por día, con lo que hay que mandar)
// ---------------------------------------------------------------------------
async function avisoTelegram(env, l, base) {
  if ((await kvGet(env, "grupos_telegram")) === "no") return false;
  const chat = env.TELEGRAM_CHAT || (await kvGet(env, "telegram_chat"));
  if (!env.TELEGRAM_TOKEN || !chat || !l.length) return false;
  const url = (base || env.PUBLIC_URL || "https://cotizador.berasateguimanuel07.workers.dev") + "/panel/805?v=grupos";
  const texto = `📣 Mensajes de hoy para los grupos (${l.length}):\n${l.map((m) => `• ${m.hora || ""} ${m.producto}`).join("\n")}\n\nCopialos, poneles la foto y marcalos enviados:\n${url}`;
  const r = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/sendMessage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: chat, text: texto, disable_web_page_preview: true }) }).catch(() => null);
  return !!r?.ok;
}

// ---------------------------------------------------------------------------
// 5) Cron (cada minuto desde el worker) y API del panel
// ---------------------------------------------------------------------------
export async function cronGrupos(env, iaJSON, scheduledTime, base) {
  if (!env.DB) return;
  await prepararGrupos(env);
  const t = new Date(scheduledTime), m = t.getUTCMinutes(), hAR = (t.getUTCHours() + 21) % 24;
  if (m % 15 === 13) await detectarEnviados(env).catch((e) => console.log("grupos detectar", e?.stack || e));
  // Desde las 7 h; si falla reintenta cada 10 min hasta las 18 h
  if (hAR < GRUPOS.horaGenera || hAR >= 18) return;
  const dia = diaAR(scheduledTime);
  if (await env.DB.prepare("SELECT 1 FROM g_sug WHERE dia=? LIMIT 1").bind(dia).first()) return;
  const k = "grupos_intento:" + dia;
  if (Date.now() - (+(await kvGet(env, k)) || 0) < 10 * 60e3) return;
  await kvPut(env, k, Date.now());
  await generarDia(env, iaJSON, { dia, avisar: true, base }).catch((e) => console.log("grupos generar", e?.stack || e));
}

export async function apiGrupos(env, req, url, iaJSON) {
  await prepararGrupos(env);
  const r = url.pathname.replace(/^\/panel\/api\/805\/grupos\/?/, "");
  const json = (x) => Response.json(x);
  const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
  if (r === "" || r === "hoy") {
    const dia = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get("dia") || "") ? url.searchParams.get("dia") : diaAR();
    const mensajes = await todas(env, "SELECT * FROM g_sug WHERE dia=? ORDER BY n", dia);
    const hist = await todas(env, "SELECT dia, COUNT(*) n, SUM(estado='enviado') env FROM g_sug WHERE dia<? GROUP BY dia ORDER BY dia DESC LIMIT 14", dia);
    const est = (await env.DB.prepare("SELECT COUNT(*) n, SUM(fuente='export') exp, SUM(fuente='panel') pan FROM g_estilo").first()) || {};
    const lector = (await env.DB.prepare("SELECT COUNT(*) n FROM w_msg WHERE grupo=1 AND yo=1").first().catch(() => null))?.n || 0;
    return json({ dia, hoy: diaAR(), mensajes, historial: hist, estilo: { exportados: est.exp || 0, del_panel: est.pan || 0, del_lector: lector }, telegram: (await kvGet(env, "grupos_telegram")) !== "no" });
  }
  if (r === "generar" && req.method === "POST") return json(await generarDia(env, iaJSON, { dia: /^\d{4}-\d{2}-\d{2}$/.test(body.dia || "") ? body.dia : diaAR(), forzar: true }));
  if (r === "otra" && req.method === "POST") return json(await otraVersion(env, iaJSON, String(body.id || ""), body.pedido));
  if (r === "marcar" && req.method === "POST") return json(await marcar(env, String(body.id || ""), body.estado, body.texto));
  if (r === "importar" && req.method === "POST") return json(await importarExport(env, String(body.texto || "")));
  if (r === "telegram" && req.method === "POST") { await kvPut(env, "grupos_telegram", body.si ? "si" : "no"); return json({ ok: true }); }
  return new Response("no existe", { status: 404 });
}
