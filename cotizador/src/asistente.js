import { seguimientos } from "./lector.js";
import { notionActivo, notionHoy, textoNotion, crearEnNotion, marcarEnNotion, descubrir, diagnosticoNotion, fijarRol, agendaNotion, nivelesNotion } from "./notion.js";
// Asistente personal por Telegram: le mandás un audio o un texto con todo lo que tenés en la cabeza
// y lo ordena en tareas por prioridad. Cada persona tiene su lista (según desde qué chat escribe).
// Comandos: "lista" (o /lista), "hecho 2" / "listo 1,3", "borrar 4", "subí 3" / "bajá 3", "hoy".
// Todos los días a las 8 de Argentina manda la lista a cada uno.

const kvGet = async (env, k) => (await env.DB.prepare("SELECT v FROM kv WHERE k=?").bind(k).first())?.v ?? null;
const kvPut = (env, k, v) => env.DB.prepare("INSERT INTO kv (k,v,exp) VALUES (?,?,NULL) ON CONFLICT(k) DO UPDATE SET v=excluded.v, exp=NULL").bind(k, String(v)).run();
const nid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const AR = 3 * 3600e3;
const hoyAR = () => new Date(Date.now() - AR).toISOString().slice(0, 10);

export const VERSION_ASISTENTE = "28/10 (mira videos de referencia)";
export const PRIORIDADES = { 1: "🔴 URGENTE (hoy)", 2: "🟠 IMPORTANTE (esta semana)", 3: "🟡 PUEDE ESPERAR", 4: "⚪ ALGÚN DÍA / IDEAS" };
const AREAS = ["Ventas", "Proveedores", "Redes", "Operaciones", "Finanzas", "Sistema", "Equipo", "Personal", "Otro"];

let listo = false;
async function preparar(env) {
  if (listo) return;
  await env.DB.batch([
    "CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT, exp INTEGER)",
    "CREATE TABLE IF NOT EXISTS mis_tareas (id TEXT PRIMARY KEY, ts INTEGER, quien TEXT, texto TEXT, detalle TEXT, prioridad INTEGER, area TEXT, para TEXT, estado TEXT DEFAULT 'pendiente', hecha_ts INTEGER, origen TEXT)",
    "CREATE INDEX IF NOT EXISTS mis_tareas_quien ON mis_tareas(quien, estado, prioridad)",
  ].map((s) => env.DB.prepare(s)));
  for (const q of ["ALTER TABLE mis_tareas ADD COLUMN hora_ini TEXT", "ALTER TABLE mis_tareas ADD COLUMN hora_fin TEXT", "ALTER TABLE mis_tareas ADD COLUMN tipo TEXT", "ALTER TABLE mis_tareas ADD COLUMN notion_id TEXT"]) { try { await env.DB.prepare(q).run(); } catch {} }
  listo = true;
  // Limpieza única: tareas repetidas y preguntas que se anotaron como tarea antes del arreglo
  if (!(await kvGet(env, "asist_limpieza_v1"))) {
    const l = (await env.DB.prepare("SELECT id, quien, texto FROM mis_tareas WHERE estado='pendiente' ORDER BY ts DESC").all()).results || [];
    const pal = (t) => new Set(String(t).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").split(/[^a-z0-9ñ]+/).filter((w) => w.length > 2));
    const igual = (a, b) => { const A = pal(a), B = pal(b); if (!A.size || !B.size) return false; let n = 0; for (const w of A) if (B.has(w)) n++; return n / Math.min(A.size, B.size) >= 0.75; };
    const quedan = [], fuera = [];
    for (const x of l) { if (/^revisar chats urgentes/i.test(x.texto) || quedan.some((y) => y.quien === x.quien && igual(y.texto, x.texto))) fuera.push(x.id); else quedan.push(x); }
    if (fuera.length) await env.DB.batch(fuera.map((i) => env.DB.prepare("UPDATE mis_tareas SET estado='borrada', hecha_ts=? WHERE id=?").bind(Date.now(), i)));
    await kvPut(env, "asist_limpieza_v1", String(fuera.length));
  }
  if (!(await kvGet(env, "asist_limpieza_v4"))) {
    const l4 = (await env.DB.prepare("SELECT id, texto FROM mis_tareas WHERE estado='pendiente'").all()).results || [];
    const re = /^(aprobar|subir|generar|cargar|confirmar|diseñar|terminar|programar)\b.{0,40}\b(video|videos|historia|historias|carrusel|carruseles|clip|clips|idea|ideas|referencia|referencias)\b/i;
    const ids = l4.filter((x) => re.test(x.texto)).map((x) => x.id);
    if (ids.length) await env.DB.batch(ids.map((i) => env.DB.prepare("UPDATE mis_tareas SET estado='borrada', hecha_ts=? WHERE id=?").bind(Date.now(), i)));
    await kvPut(env, "asist_limpieza_v4", "1");
  }
  if (!(await kvGet(env, "asist_limpieza_v3"))) {
    await env.DB.prepare("UPDATE mis_tareas SET estado='borrada', hecha_ts=? WHERE estado='pendiente' AND (lower(texto) LIKE 'contestar los %chats%' OR lower(texto) LIKE 'contestar los chats%' OR lower(texto) LIKE 'responder los %chats%')").bind(Date.now()).run();
    await kvPut(env, "asist_limpieza_v3", "1");
  }
  if (!(await kvGet(env, "asist_limpieza_v2"))) {
    const hoy = hoyAR();
    await env.DB.prepare("UPDATE mis_tareas SET estado='hecha', hecha_ts=? WHERE estado='pendiente' AND lower(texto) LIKE 'cursar %' AND para<>'' AND para<=?").bind(Date.now(), hoy).run();
    await env.DB.prepare("UPDATE mis_tareas SET estado='borrada', hecha_ts=? WHERE estado='pendiente' AND (lower(texto) LIKE 'revisar pendientes%' OR lower(texto) LIKE 'revisar chats urgentes%')").bind(Date.now()).run();
    await kvPut(env, "asist_limpieza_v2", "1");
  }
}

export async function secretoTG(env) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("asistente:" + (env.TELEGRAM_TOKEN || "")));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("").slice(0, 32);
}
const tg = (env, metodo, body) => fetch(`https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/${metodo}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json()).catch(() => null);
const decir = (env, chat, texto) => env.__captura ? (env.__captura.push(String(texto)), Promise.resolve({ ok: true })) : tg(env, "sendMessage", { chat_id: chat, text: String(texto).slice(0, 4000), disable_web_page_preview: true });
// Con botones que abren un link (ej. el WhatsApp del cliente con el mensaje ya escrito)
const decirBotones = (env, chat, texto, botones = []) => env.__captura ? (env.__captura.push(String(texto) + botones.map((b) => `\n[${b.text}](${b.url})`).join("")), Promise.resolve({ ok: true }))
  : tg(env, "sendMessage", { chat_id: chat, text: String(texto).slice(0, 4000), disable_web_page_preview: true, ...(botones.length ? { reply_markup: { inline_keyboard: botones.map((b) => [b]) } } : {}) });

// Quién es cada chat: los que conectaron Telegram en el panel (telegram_chat:<nombre>) y el chat de alertas (telegram_chat)
async function chatsConocidos(env) {
  const l = ((await env.DB.prepare("SELECT k, v FROM kv WHERE k='telegram_chat' OR k LIKE 'telegram_chat:%'").all()).results || []);
  const m = {};
  for (const x of l) if (x.v) m[String(x.v)] = x.k === "telegram_chat" ? (m[String(x.v)] || "Manuel") : x.k.slice(14);
  if (env.TELEGRAM_CHAT && !m[String(env.TELEGRAM_CHAT)]) m[String(env.TELEGRAM_CHAT)] = "Manuel";
  return m;
}

async function pendientes(env, quien) {
  // Los eventos con horario (cursar, gym, reunión) se tachan solos cuando ya pasaron
  const ahora = new Date(Date.now() - AR), hoy = ahora.toISOString().slice(0, 10), hm = ahora.toISOString().slice(11, 16);
  try { await env.DB.prepare("UPDATE mis_tareas SET estado='hecha', hecha_ts=?, origen='paso el horario' WHERE quien=? AND estado='pendiente' AND tipo='evento' AND para<>'' AND COALESCE(hora_fin,'')<>'' AND (para<? OR (para=? AND hora_fin<=?))").bind(Date.now(), quien, hoy, hoy, hm).run(); } catch {}
  return (await env.DB.prepare("SELECT * FROM mis_tareas WHERE quien=? AND estado='pendiente' ORDER BY prioridad ASC, CASE WHEN para='' OR para IS NULL THEN 1 ELSE 0 END, para ASC, ts ASC LIMIT 80").bind(quien).all()).results || [];
}

// Arma el texto de la lista numerada y guarda qué número es cada tarea (para "hecho 3")
async function textoLista(env, chat, quien, { titulo = "Tu lista", soloHoy = false } = {}) {
  let l = await pendientes(env, quien);
  const hoy = hoyAR();
  if (soloHoy) l = l.filter((x) => x.prioridad === 1 || (x.para && x.para <= hoy));
  await kvPut(env, "tg_lista:" + chat, JSON.stringify(l.map((x) => x.id)));
  if (!l.length) return soloHoy ? "Para hoy no tenés nada urgente. 🙌" : "No tenés tareas pendientes. Mandame un audio con lo que tengas en la cabeza.";
  let n = 0, out = `📋 ${titulo} (${l.length})`;
  for (const p of [1, 2, 3, 4]) {
    const g = l.filter((x) => x.prioridad === p); if (!g.length) continue;
    out += `\n\n${PRIORIDADES[p]}`;
    for (const x of g) { n++; out += `\n${n}. ${x.hora_ini ? x.hora_ini + (x.hora_fin ? "-" + x.hora_fin : "") + " " : ""}${x.texto}${x.area ? " · " + x.area : ""}${x.para ? " · " + (x.para < hoy ? "⚠️ vencida " : "") + x.para.slice(8, 10) + "/" + x.para.slice(5, 7) : ""}`; }
  }
  return out + `\n\nPara tachar: "hecho 2" (o "hecho 1,3"). Para cambiar: "subí 4", "bajá 4", "borrar 4".`;
}

// Lo que el sistema ya sabe que está pendiente en el negocio (no hace falta anotarlo)
async function contar(env, sql, ...b) { try { return (await env.DB.prepare(sql).bind(...b).first())?.n || 0; } catch { return 0; } }
export async function negocioPendiente(env) {
  const hace24 = Date.now() - 24 * 3600e3, hace3d = Date.now() - 3 * 86400e3;
  const [chats, calientes, videos, ideas, hist] = await Promise.all([
    contar(env, "SELECT COUNT(*) n " + SIN_CONTESTAR, Date.now() - 3 * 86400e3),
    contar(env, "SELECT COUNT(*) n FROM w_conv WHERE grupo=0 AND archivado=0 AND ult_yo=0 AND COALESCE(resp,1)=1 AND COALESCE(prov,0)=0 AND ult_cliente_ts>COALESCE(visto_ts,0) AND COALESCE(etapa,'')<>'no_cliente' AND ult_cliente_ts>=? AND (puntaje>=8 OR cot_pend=1)", hace24),
    contar(env, "SELECT COUNT(*) n FROM ig_videos WHERE estado='revision' AND borrado=0"),
    contar(env, "SELECT COUNT(*) n FROM ig_ideas WHERE estado='nueva'"),
    contar(env, "SELECT COUNT(*) n FROM ig_historias WHERE estado='nueva' AND ts>?", hace3d),
  ]);
  const l = [];
  if (chats) l.push(`💬 ${chats} chat${chats > 1 ? "s" : ""} de WhatsApp sin contestar${calientes ? ` (${calientes} con cotización o muy calientes: primero esos)` : ""}`);
  if (videos) l.push(`🎬 ${videos} video${videos > 1 ? "s" : ""} editado${videos > 1 ? "s" : ""} esperando que los apruebes`);
  if (hist) l.push(`📱 ${hist} historia${hist > 1 ? "s" : ""} para subir`);
  if (ideas) l.push(`💡 ${ideas} idea${ideas > 1 ? "s" : ""} de reel para grabar`);
  return { chats, calientes, videos, ideas, hist, texto: l.join("\n") };
}
// Los chats del 805 que esperan respuesta, con número y link para abrirlos directo
const SIN_CONTESTAR = "FROM w_conv WHERE grupo=0 AND archivado=0 AND ult_yo=0 AND COALESCE(resp,1)=1 AND COALESCE(prov,0)=0 AND ult_cliente_ts>COALESCE(visto_ts,0) AND COALESCE(etapa,'')<>'no_cliente' AND ult_cliente_ts>=?";
export async function chatsSinContestar(env, limite = 12) {
  let l = [];
  try { l = (await env.DB.prepare(`SELECT conv, nombre, ult_cliente_ts, puntaje, cot_pend, producto, accion, ult_texto ${SIN_CONTESTAR} ORDER BY (COALESCE(puntaje,0)>=8 OR cot_pend=1) DESC, puntaje DESC, ult_cliente_ts ASC LIMIT ?`).bind(Date.now() - 3 * 86400e3, limite).all()).results || []; } catch {}
  if (!l.length) return "No hay chats del 805 esperando respuesta. 🙌";
  const hace = (ts) => { const m = Math.round((Date.now() - ts) / 60000); return m < 60 ? m + " min" : m < 1440 ? Math.round(m / 60) + " h" : Math.round(m / 1440) + " d"; };
  return `💬 Chats del 805 sin contestar (${l.length}${l.length >= limite ? "+" : ""}), primero los calientes:\n` + l.map((c, i) => {
    const tel = /^\d{8,}$/.test(c.conv) ? c.conv : "";
    const que = String(c.accion || c.ult_texto || "").replace(/\|p\d$/, "").replace(/\s+/g, " ").slice(0, 90);
    return `\n${i + 1}. ${(c.puntaje >= 8 || c.cot_pend) ? "🔥 " : ""}${c.nombre || (tel ? "+" + tel : c.conv)}${tel && c.nombre ? " (+" + tel + ")" : ""} · hace ${hace(c.ult_cliente_ts)}${c.producto ? " · " + c.producto : ""}${c.cot_pend ? " · espera cotización" : ""}\n   ${que}${tel ? "\n   wa.me/" + tel : ""}`;
  }).join("");
}
// Seguimientos del 805: clientes cotizados que dejaron de contestar (la lista la arma el lector, con reglas en código).
// Van con el mensaje ya escrito por la IA y un botón que abre el WhatsApp del cliente con ese texto: se revisa y se manda.
// Cuando se le escribe desde el 805, sale solo de la lista. La IA escribe una vez por día por cliente (se guarda).
async function cuantosSeg(env) { try { return (await seguimientos(env)).length; } catch { return 0; } }
async function borradoresSeg(env, iaJSON, lista) {
  const k = "seg_borr:" + hoyAR(), cache = JSON.parse((await kvGet(env, k)) || "{}");
  const faltan = lista.filter((s) => !cache[s.conv]);
  if (faltan.length && iaJSON) {
    const charlas = await Promise.all(faltan.map((s) => filas(env, "SELECT yo, texto FROM w_msg WHERE conv=? AND COALESCE(texto,'')<>'' ORDER BY ts DESC LIMIT 12", s.conv).then((m) => m.reverse())));
    const r = await iaJSON(env, `Atendés el WhatsApp de "Te Importamos" (importaciones por encargo de China a Argentina, para revendedores y negocios). A estos clientes les mandamos una cotización y dejaron de contestar. Escribí UN mensaje de seguimiento para cada uno, para que el dueño lo revise y lo mande él.
Reglas:
- Rioplatense, con voseo, cercano y corto (2 a 4 líneas), sin emojis, como lo escribiría una persona por WhatsApp. Sin "seguimiento", sin "estimado", sin "le escribo para".
- Nombrá el producto que pidió y terminá con UNA pregunta concreta y fácil de contestar.
- Según los días desde la cotización: 1-2 días → preguntá si le quedó alguna duda o si quiere ajustar cantidad; 3-6 días → sumá valor con algo real de la charla (tiempos, cómo es el proceso, que nos encargamos de todo, la ganancia si revende) y proponé el siguiente paso; 7 días o más → mensaje de cierre amable ("¿lo dejamos para más adelante o lo seguimos viendo?"), que suele reactivar.
- Si en la charla dijo una objeción (caro, mínimo, plazo, desconfianza), respondela sin bajar el precio.
- Nunca inventes precios, stock, descuentos ni fechas que no estén en la charla.
CLIENTES:
${faltan.map((s, i) => `#${i + 1} ${s.nombre || "sin nombre"} · producto: ${s.producto || "?"} · cotizado hace ${s.dias_cot} días · sin escribirle hace ${s.dias_sin} días${s.presup_usd ? " · aprox USD " + s.presup_usd : ""}
${charlas[i].map((m) => (m.yo ? "Nosotros: " : "Cliente: ") + String(m.texto).replace(/\s+/g, " ").slice(0, 300)).join("\n") || "(sin mensajes guardados)"}`).join("\n\n")}
Respondé SOLO JSON: {"mensajes":[{"n":1,"mensaje":"..."}]}`);
    for (const x of Array.isArray(r?.mensajes) ? r.mensajes : []) { const s = faltan[(parseInt(x?.n) || 0) - 1]; if (s && String(x.mensaje || "").trim()) cache[s.conv] = String(x.mensaje).trim().slice(0, 700); }
    await env.DB.prepare("DELETE FROM kv WHERE k LIKE 'seg_borr:%' AND k<>?").bind(k).run().catch(() => {});
    await kvPut(env, k, JSON.stringify(cache));
  }
  return cache;
}
export async function seguimientosHoy(env, iaJSON, limite = 10) {
  let l = []; try { l = await seguimientos(env); } catch {}
  if (!l.length) return [];
  const top = l.slice(0, limite), borr = await borradoresSeg(env, iaJSON, top), partes = [];
  for (let i = 0; i < top.length; i += 5) {
    const g = top.slice(i, i + 5).map((s, j) => ({ ...s, n: i + j + 1 }));
    const cab = i ? "" : `📌 Seguimientos de hoy: ${l.length}${l.length > top.length ? ` (acá los ${top.length} que más valen)` : ""}. Tocá el botón: se abre el WhatsApp con el mensaje escrito, lo revisás y lo mandás. Cuando le escribís, sale solo de la lista.\n`;
    partes.push({
      texto: cab + g.map((s) => `\n${s.n}. ${s.nombre || "+" + s.conv}${s.perfil ? " · perfil " + s.perfil : ""} · ${s.producto || "-"}${s.presup_usd ? " · aprox USD " + s.presup_usd : ""} · cotizado hace ${s.dias_cot} d\n${borr[s.conv] ? "✍️ " + borr[s.conv] : "(no pude armar el mensaje: escribile vos)"}`).join("\n"),
      botones: g.filter((s) => /^\d{8,}$/.test(s.conv)).map((s) => ({ text: `📲 ${s.n}. ${(s.nombre || "+" + s.conv).slice(0, 30)}`, url: `https://wa.me/${s.conv}${borr[s.conv] ? "?text=" + encodeURIComponent(borr[s.conv]) : ""}` })),
    });
  }
  return partes;
}
async function mandarSeguimientos(env, iaJSON, chat) {
  const p = await seguimientosHoy(env, iaJSON);
  if (!p.length) return decir(env, chat, "No hay seguimientos pendientes hoy. 🙌");
  for (const x of p) await decirBotones(env, chat, x.texto, x.botones);
}

// Qué hay que hacer HOY en redes, en acciones concretas (sale del panel)
async function filas(env, sql, ...b) { try { return (await env.DB.prepare(sql).bind(...b).all()).results || []; } catch { return []; } }
export async function redesHoy(env) {
  const hace3d = Date.now() - 3 * 86400e3, ahora = Date.now(), finDia = ahora + 24 * 3600e3;
  const [ideas, lotes, rev, prog, hist, grab] = await Promise.all([
    filas(env, "SELECT titulo FROM ig_ideas WHERE estado='nueva' ORDER BY ts DESC LIMIT 6"),
    filas(env, "SELECT estado, error FROM ig_lotes WHERE estado IN ('subiendo','en_cola','procesando','error') AND ts>?", ahora - 7 * 86400e3),
    filas(env, "SELECT texto FROM ig_videos WHERE estado='revision' AND borrado=0 LIMIT 10"),
    filas(env, "SELECT programado_ts FROM ig_videos WHERE estado='aprobado' AND programado_ts BETWEEN ? AND ?", ahora, finDia),
    filas(env, "SELECT titulo FROM ig_historias WHERE estado='nueva' AND ts>? ORDER BY ts DESC LIMIT 5", hace3d),
    filas(env, "SELECT titulo FROM ig_ideas WHERE estado='grabada' AND hecho_ts>? ORDER BY hecho_ts DESC LIMIT 5", ahora - 5 * 86400e3),
  ]);
  const l = [];
  const editando = lotes.filter((x) => x.estado !== "error").length, err = lotes.filter((x) => x.estado === "error").length;
  if (rev.length) l.push(`Aprobar y programar ${rev.length} video${rev.length > 1 ? "s" : ""} editado${rev.length > 1 ? "s" : ""} (Redes › Videos)`);
  if (editando) l.push(`Hay ${editando} tanda${editando > 1 ? "s" : ""} de clips editándose: esperar y después revisar`);
  if (err) l.push(`${err} tanda${err > 1 ? "s" : ""} de videos falló al editar: reintentar desde Redes › Videos`);
  if (grab.length && !rev.length && !editando) l.push(`Subir al editor los clips grabados de: ${grab.map((x) => x.titulo).join("; ")}`);
  if (!prog.length) l.push(rev.length ? "No hay video programado para las próximas 24 h: aprobá uno de los editados" : "No hay ningún video listo para las próximas 24 h: subí clips al editor para tener uno");
  if (ideas.length) l.push(`Grabar (ideas listas): ${ideas.map((x) => x.titulo).join("; ")}`);
  else l.push("No hay ideas de reels para grabar: cargar referencias y tocar Generar ideas (o redefinir las que hay)");
  if (hist.length) l.push(`Subir historias: ${hist.map((x) => x.titulo).join("; ")}`);
  else l.push("Generar las historias de hoy (Redes › Ideas › Historias)");
  return l;
}

// Plan del resto del día armado en código (exacto): chats calientes primero, lo urgente, lo de Notion con sus minutos y un segundo bloque de chats
async function planBloques(env, quien) {
  const [l, neg, nt, redes] = await Promise.all([pendientes(env, quien), negocioPendiente(env), notionActivo(env) ? notionHoy(env).catch(() => null) : null, redesHoy(env)]);
  const ahora = new Date(Date.now() - AR); let min = ahora.getUTCHours() * 60 + ahora.getUTCMinutes(); min = Math.ceil(min / 15) * 15;
  const fin = 23 * 60, hhmm = (m) => String(Math.floor(m / 60) % 24).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");
  const items = [];
  if (neg.calientes || neg.chats) items.push({ t: `💬 Chats del 805${neg.calientes ? ` (${neg.calientes} calientes primero)` : ""}`, d: 30 });
  const nSeg = await cuantosSeg(env);
  if (nSeg) items.push({ t: `📌 Seguimientos del 805 (${nSeg}): decime "seguimientos" y te los paso listos para mandar`, d: 20 });
  for (const x of l.filter((x) => x.prioridad === 1)) items.push({ t: x.texto, d: 30, h: x.hora_ini });
  const redesUrg = redes.filter((x) => /^(Aprobar|No hay ningún video|No hay video|Subir historias)/.test(x));
  const corto = (x) => (/^Aprobar/.test(x) ? "aprobar videos" : /aprobá uno/.test(x) ? "aprobar un video" : /^No hay ningún video/.test(x) ? "subir clips al editor" : /^Subir historias/.test(x) ? "subir historias" : x);
  if (redesUrg.length) items.push({ t: "📲 Redes: " + [...new Set(redesUrg.map(corto))].join(" + "), d: 30 });
  for (const x of (nt?.tareas || []).filter((x) => x.fecha === "hoy")) items.push({ t: x.texto, d: Math.max(15, Math.min(240, x.min || 45)), h: x.hora });
  if (neg.chats) items.push({ t: "💬 Segunda vuelta de chats", d: 20 });
  for (const x of l.filter((x) => x.prioridad === 2 && (!x.para || x.para <= hoyAR()))) items.push({ t: x.texto, d: 30, h: x.hora_ini });
  // primero lo que tiene hora fija, en su lugar; el resto llena los huecos en orden
  const fijos = items.filter((x) => x.h && /^\d\d:\d\d$/.test(x.h)).map((x) => ({ ...x, ini: +x.h.slice(0, 2) * 60 + +x.h.slice(3) })).filter((x) => x.ini >= min).sort((a, b) => a.ini - b.ini);
  const libres = items.filter((x) => !fijos.some((f) => f.t === x.t) && !(x.h && /^\d\d:\d\d$/.test(x.h) && +x.h.slice(0, 2) * 60 + +x.h.slice(3) < min));
  const out = [], sobra = [];
  for (const x of libres) {
    while (fijos.length && min + x.d > fijos[0].ini) { const f = fijos.shift(); min = Math.max(min, f.ini); out.push(`${hhmm(min)}-${hhmm(min + f.d)} · ${f.t}`); min += f.d; }
    if (min + x.d > fin) { sobra.push(x.t); continue; }
    out.push(`${hhmm(min)}-${hhmm(min + x.d)} · ${x.t}`); min += x.d;
  }
  for (const f of fijos) { min = Math.max(min, f.ini); out.push(`${hhmm(min)}-${hhmm(min + f.d)} · ${f.t}`); min += f.d; }
  if (!out.length) return "Para lo que queda de hoy no tenés nada pendiente. 🙌";
  return `🗓 Lo que resta del día:\n${out.join("\n")}${sobra.length ? `\n\n➡️ No entra hoy: ${sobra.join("; ")}` : ""}\n\nCuando termines cada cosa decime "listo".`;
}

// El secretario: entiende lo que le decís (audio o texto) con todo el contexto y hace lo que haría un secretario de verdad
async function secretario(env, iaJSON, quien, chat, texto) {
  const [l, perfil, redes, neg, prefs] = await Promise.all([pendientes(env, quien), perfilDe(env, quien), redesHoy(env), negocioPendiente(env), prefsDe(env, quien)]);
  const focoId = await kvGet(env, "asist_foco:" + quien), foco = l.find((x) => x.id === focoId) || null;
  const nt = notionActivo(env) ? await notionHoy(env).catch(() => null) : null;
  const niveles = nt ? await nivelesNotion(env).catch(() => []) : [];
  const nItems = nt ? [...nt.tareas.map((x) => ({ ...x, k: "tarea" })), ...nt.habitos.map((x) => ({ ...x, k: "habito" }))].map((x, i) => ({ ...x, ref: "n" + (i + 1) })) : [];
  const chats = await chatsSinContestar(env, 10);
  const ahora = new Date(Date.now() - AR), hm = ahora.toISOString().slice(11, 16), dia = ahora.toLocaleDateString("es-AR", { weekday: "long", timeZone: "UTC" });
  const r = await iaJSON(env, `Sos el SECRETARIO personal de ${nombreDe(quien)}, dueño de "Te Importamos" (importaciones por encargo de China a Argentina, Rosario; vende por WhatsApp 805, hace reels, historias y carruseles para Instagram; su socio es Matías "Buco"; Pedro Aguirre es el despachante/logística). Estudia en la facultad.
Ahora es ${dia} ${hoyAR()}, ${hm} h (Argentina).
Te habla así (puede ser un audio transcripto, desordenado): """${texto.slice(0, 5000)}"""

LO QUE SABÉS DE SU RUTINA: ${perfil || "(nada todavía)"}
CÓMO QUIERE QUE LE HABLES (sus preferencias, respetalas siempre): ${prefs || "mensajes cortos, de a una cosa a la vez (Kanban): no le mandes listas largas salvo que las pida"}
EN LO QUE ESTÁ AHORA (foco actual): ${foco ? foco.texto : "(nada)"}
SUS PENDIENTES (id · prioridad · fecha · horario · texto):
${l.map((x) => `[${x.id}] P${x.prioridad} · ${x.para || "-"} · ${x.hora_ini ? x.hora_ini + "-" + (x.hora_fin || "?") : "-"} · ${x.texto}`).join("\n") || "(ninguno)"}
QUÉ HAY QUE HACER EN REDES (dato real del panel):
${redes.map((x) => "- " + x).join("\n")}
WHATSAPP 805: ${neg.chats} chats sin contestar, ${neg.calientes} calientes. Seguimientos de cotizaciones pendientes (clientes cotizados que dejaron de contestar): ${await cuantosSeg(env)}. Si son lo siguiente, decile que escriba "seguimientos" y le llegan con el mensaje ya escrito para cada uno.
${nt ? `SU NOTION (donde organiza su vida: tareas por categoría, hábitos y eventos; tenelo en cuenta para el plan y para "¿ahora qué hago?"):
${nItems.map((x) => `[${x.ref}] ${x.k === "habito" ? "hábito de hoy" : "actividad"}: ${x.hora ? x.hora + " " : ""}${x.texto}${x.categoria ? " [" + x.categoria + "]" : ""} · ${x.estado || ""}${x.fecha === "vencida" ? " · VENCIDA" : ""}`).join("\n") || "(nada abierto hoy)"}
Ya hecho hoy en Notion: ${(nt.hoy || []).filter((x) => x.hecho).map((x) => x.texto).join(", ") || "nada"}
Habilidades/categorías de su Notion (para "habilidad" de lo nuevo): ${(niveles || []).join(", ")}
${(nt.otras || []).map((o) => `BASE "${o.base}" (últimas filas): ${o.filas.join(" | ")}`).join("\n")}
${nt.eventos.length ? "EVENTOS DE HOY: " + nt.eventos.map((x) => (x.hora ? x.hora + " " : "") + x.texto).join(" | ") : ""}
Si pregunta qué tiene en la agenda o sus pendientes de Notion, poné "incluir_agenda": true (yo pego la agenda exacta de Notion) y en "respuesta" solo una línea. Si pide que le organices LO QUE RESTA DEL DÍA (o "organizame", "plan"), en "respuesta" armá bloques con horario real desde ahora que incluyan TODAS las actividades pendientes de su Notion de hoy (cada una con sus minutos: Ejercicio 60 min = un bloque de 1 h), intercaladas con lo urgente del negocio, lo urgente del negocio y sus fijos, un bloque por renglón ("16:00-17:00 · Estudio Diario"), y "incluir_agenda": false. Si te pregunta por su Notion, contestá SOLO con lo que está acá arriba (si está vacío, decí que no ves nada y que mande "notion" para revisar la conexión); nunca inventes que algo está en Notion. Si dice que hizo algo de su Notion (una tarea o un hábito, ej: "ya fui al gym", "leí"), poné su ref en "notion_hechas". No dupliques en "nuevas" lo que ya está en su Notion.` : ""}

Actuá como un secretario de verdad:
1. Anotá cada cosa concreta que tiene que hacer como tarea separada, empezando con verbo y con el detalle que dio ("Repasar física para el parcial del 28/10"). Respetá exactamente lo que pidió anotar.
2. Los chats del 805 NO se anotan como tarea (el número cambia todo el tiempo; ya los ves en vivo arriba). Si son lo siguiente, decilo con el número real de arriba. NUNCA anotes tareas vagas tipo "revisar pendientes de redes" o "ver el WhatsApp": si menciona redes, anotá las acciones concretas de la lista de REDES de arriba que correspondan (ej. "Aprobar y programar 3 videos", "Redefinir las ideas de reels"); si menciona WhatsApp, no anotes nada: los chats ya los ves en vivo.
3. Cosas con horario (cursar, gym, reunión, llamada a una hora) son "evento" con hora_ini y hora_fin (HH:MM). Si el horario ya pasó hoy, o dice que ya lo hizo/terminó o que no va, ponelo en "hechas" o "borrar" (no lo dejes pendiente). Las cursadas fijas de cada semana van al PERFIL, no como tarea, salvo la de hoy si tiene horario.
4. Si algo ya está en la lista, no lo repitas: actualizalo. Si dice que algo ya lo hizo, va a "hechas". Si dice que algo no va más, a "borrar".
5. Prioridad: 1 = hoy (plata o cliente esperando, se vence, examen cerca); 2 = esta semana; 3 = puede esperar; 4 = algún día.
6. Si pregunta algo, contestá ESO primero y directo; no le repitas lo de los chats del 805 en cada mensaje (solo si lo pregunta o si de verdad es lo siguiente). Si pide los chats, poné "incluir_chats": true (yo agrego la lista real con números). Si pregunta qué hay que hacer en redes, "incluir_redes": true.
7. Si pide que le organices el día (o dicta varias cosas), armá en "respuesta" el plan de lo que QUEDA del día desde las ${hm}, en bloques con horario real, respetando lo fijo (facu, gym) y poniendo primero lo que tiene plata o clientes esperando. Repartí los chats en 2 o 3 bloques cortos.
8. "perfil": si aparece algo estable de su rutina (horarios de facu por día, gym, trabajo, fechas de parciales), devolvé el PERFIL COMPLETO actualizado (2 a 8 líneas). Si no, "".
9. "preferencias": si te dice CÓMO quiere que le hables o uses el bot (largo de los mensajes, de a una cosa, horarios de avisos, que no le mandes X), devolvé sus preferencias COMPLETAS actualizadas (1 a 6 líneas). Si no, "".
10. "siguiente": la UNA cosa que tiene que hacer ahora (Kanban: una a la vez), elegida por prioridad, hora y lo que tiene plata o clientes esperando. "siguiente_id": el id si es una tarea de la lista (o vacío). Si pregunta "¿ahora qué hago?" o terminó algo, la respuesta es solo eso: qué hacer ahora y por qué en una línea.
11. "respuesta": en rioplatense, MUY corta (1 a 3 líneas) y clara, como un secretario que ya lo resolvió (no "ahí me fijo"). Sin repetir la lista completa salvo que la pida.
Respondé SOLO JSON: {"nuevas":[{"texto":"...","detalle":"","prioridad":1,"area":"${AREAS.join("|")}","para":"YYYY-MM-DD o vacío","tipo":"tarea|evento","hora_ini":"","hora_fin":"","habilidad":"una de sus habilidades de Notion o vacío"}],"hechas":["id"],"borrar":["id"],"actualizar":[{"id":"...","texto":"","prioridad":null,"para":"","hora_ini":"","hora_fin":""}],"perfil":"","incluir_chats":false,"incluir_redes":false,"mostrar_lista":false,"preferencias":"","siguiente":"","siguiente_id":"","notion_hechas":[],"incluir_agenda":false,"respuesta":"..."}`, { prioridad: true });
  if (!r) return null;
  const ids = new Set(l.map((x) => x.id)), st = [], hhmm = (v) => (/^\d{1,2}:\d{2}$/.test(String(v || "")) ? String(v).padStart(5, "0") : "");
  const pal = (t) => new Set(String(t).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").split(/[^a-z0-9ñ]+/).filter((w) => w.length > 2));
  const igual = (a, b) => { const A = pal(a), B = pal(b); if (!A.size || !B.size) return false; let n = 0; for (const w of A) if (B.has(w)) n++; return n / Math.min(A.size, B.size) >= 0.75; };
  const REDES_VIVO = /^(aprobar|subir|generar|cargar|confirmar|diseñar|terminar|programar)\b.{0,40}\b(video|videos|historia|historias|carrusel|carruseles|clip|clips|idea|ideas|referencia|referencias)\b/i;   // eso sale del panel en vivo
  const vistas = l.map((x) => x.texto), VAGA = /^(revisar|ver|chequear) (los |las )?(pendientes|cosas|todo)|^(contestar|responder|liquidar|terminar de contestar) (los |las )?(\d+ )?(chats|mensajes|whatsapp)/i;   // lo de los chats ya lo ve en vivo, no se anota con un número que queda viejo
  let n = 0; const creadas = [];
  for (const x of (Array.isArray(r.nuevas) ? r.nuevas : []).slice(0, 30)) {
    const tx = String(x?.texto || "").trim(); if (tx.length <= 3 || VAGA.test(tx) || REDES_VIVO.test(tx) || vistas.some((v) => igual(v, tx)) || nItems.some((y) => igual(y.texto, tx))) continue; vistas.push(tx); n++;
    const idN = nid(); creadas.push({ id: idN, texto: tx, fecha: /^\d{4}-\d{2}-\d{2}$/.test(x.para || "") ? x.para : "", categoria: x.habilidad || x.area || "" });
    st.push(env.DB.prepare("INSERT INTO mis_tareas (id, ts, quien, texto, detalle, prioridad, area, para, estado, origen, tipo, hora_ini, hora_fin) VALUES (?,?,?,?,?,?,?,?,'pendiente',?,?,?,?)")
      .bind(idN, Date.now(), quien, tx.slice(0, 200), String(x.detalle || "").slice(0, 500), Math.max(1, Math.min(4, parseInt(x.prioridad) || 3)), AREAS.includes(x.area) ? x.area : "Otro", /^\d{4}-\d{2}-\d{2}$/.test(x.para || "") ? x.para : (hhmm(x.hora_ini) ? hoyAR() : ""), texto.slice(0, 300), x.tipo === "evento" ? "evento" : "tarea", hhmm(x.hora_ini), hhmm(x.hora_fin)));
  }
  const hechas = (r.hechas || []).map(String).filter((i) => ids.has(i)), borrar = (r.borrar || []).map(String).filter((i) => ids.has(i));
  for (const i of hechas) st.push(env.DB.prepare("UPDATE mis_tareas SET estado='hecha', hecha_ts=? WHERE id=?").bind(Date.now(), i));
  for (const i of borrar) st.push(env.DB.prepare("UPDATE mis_tareas SET estado='borrada', hecha_ts=? WHERE id=?").bind(Date.now(), i));
  for (const u of (Array.isArray(r.actualizar) ? r.actualizar : [])) if (ids.has(String(u?.id))) st.push(env.DB.prepare("UPDATE mis_tareas SET texto=COALESCE(NULLIF(?,''),texto), prioridad=COALESCE(?,prioridad), para=COALESCE(NULLIF(?,''),para), hora_ini=COALESCE(NULLIF(?,''),hora_ini), hora_fin=COALESCE(NULLIF(?,''),hora_fin) WHERE id=?").bind(String(u.texto || "").slice(0, 200), u.prioridad ? Math.max(1, Math.min(4, parseInt(u.prioridad))) : null, /^\d{4}-\d{2}-\d{2}$/.test(u.para || "") ? u.para : "", hhmm(u.hora_ini), hhmm(u.hora_fin), String(u.id)));
  if (st.length) await env.DB.batch(st);
  // Notion: lo nuevo también va a su Notion, lo tachado se tacha allá
  let enNotion = 0, tachNotion = 0;
  if (notionActivo(env)) {
    for (const c of creadas.filter((x) => !/^(contestar|aprobar|subir|grabar|generar|redefinir)\b/i.test(x.texto))) { const pid = await crearEnNotion(env, c).catch(() => null); if (pid) { enNotion++; await env.DB.prepare("UPDATE mis_tareas SET notion_id=? WHERE id=?").bind(pid, c.id).run(); } }
    for (const i of hechas) { const x = l.find((y) => y.id === i); if (x?.notion_id && (await marcarEnNotion(env, x.notion_id).catch(() => false))) tachNotion++; }
    for (const ref of (Array.isArray(r.notion_hechas) ? r.notion_hechas : [])) { const x = nItems.find((y) => y.ref === String(ref)); if (x && (await marcarEnNotion(env, x.id, x.k === "habito" ? x.col : null).catch(() => false))) tachNotion++; }
  }
  if (r.perfil && String(r.perfil).trim().length > 10) await kvPut(env, "asist_perfil:" + quien, String(r.perfil).trim().slice(0, 1500));
  if (r.preferencias && String(r.preferencias).trim().length > 5) await kvPut(env, "asist_prefs:" + quien, String(r.preferencias).trim().slice(0, 1000));
  if (r.siguiente_id && ids.has(String(r.siguiente_id))) await kvPut(env, "asist_foco:" + quien, String(r.siguiente_id));
  const marcas = [n ? `+${n} anotada${n > 1 ? "s" : ""}${enNotion ? ` (${enNotion} en Notion)` : ""}` : "", tachNotion ? `✅ ${tachNotion} marcada${tachNotion > 1 ? "s" : ""} en Notion` : "", hechas.length ? `✅ ${hechas.length} tachada${hechas.length > 1 ? "s" : ""}` : "", borrar.length ? `🗑 ${borrar.length} sacada${borrar.length > 1 ? "s" : ""}` : ""].filter(Boolean).join(" · ");
  const sinIds = (t) => String(t || "").replace(/\s*[(\[]?\b(?=[a-z0-9]*\d)(?=[a-z0-9]*[a-z])[a-z0-9]{11,14}\b[)\]]?/g, "");
  r.respuesta = sinIds(r.respuesta); r.siguiente = sinIds(r.siguiente);
  let out = String(r.respuesta || "Listo.").slice(0, 2500) + (marcas ? `\n(${marcas})` : "");
  if (r.incluir_agenda && nt) out += "\n\n" + agendaNotion(nt) + (neg.calientes ? `\n\n💬 Negocio: ${neg.calientes} chats calientes del 805 esperando (decime "chats").` : "");
  if (r.incluir_chats) out += "\n\n" + chats;
  if (r.incluir_redes) out += "\n\n📲 Hoy en redes:\n" + redes.map((x) => "• " + x).join("\n");
  if (r.siguiente && !String(r.respuesta || "").includes(String(r.siguiente).slice(0, 25))) out += `\n\n👉 Ahora: ${r.siguiente}`;
  if (r.mostrar_lista) out += "\n\n" + (await textoLista(env, chat, quien));
  return out.slice(0, 4000);
}

const prefsDe = async (env, quien) => (await kvGet(env, "asist_prefs:" + quien)) || "";
const nombreDe = (q) => (/^admin$/i.test(q) ? "Manuel" : q);
const perfilDe = async (env, quien) => (await kvGet(env, "asist_perfil:" + quien)) || "";

// Plan del día: mezcla sus tareas, lo pendiente del negocio y su vida (estudio, gym, horarios) en bloques
async function planDia(env, iaJSON, quien, pedido = "") {
  const [l, neg, perfil] = await Promise.all([pendientes(env, quien), negocioPendiente(env), perfilDe(env, quien)]);
  const ahora = new Date(Date.now() - AR), hora = ahora.toISOString().slice(11, 16), dia = ahora.toLocaleDateString("es-AR", { weekday: "long", timeZone: "UTC" });
  const r = await iaJSON(env, `Sos el asistente personal de ${nombreDe(quien)}, dueño de "Te Importamos" (importaciones por encargo de China a Argentina). Lo ayudás a que NO le queden cosas pendientes al final del día (siempre le quedan chats sin contestar, consultas a logística, videos por subir, carruseles, ideas por grabar).
Hoy es ${dia} ${hoyAR()}, son las ${hora} en Argentina.
LO QUE SABÉS DE SU VIDA Y SUS HORARIOS: ${perfil || "(todavía nada: si hace falta, preguntale una cosa al final)"}
LO PENDIENTE EN EL NEGOCIO (lo ve el sistema solo):
${neg.texto || "nada"}
EN REDES, CONCRETO: ${(await redesHoy(env)).join(" | ")}
SUS TAREAS:
${l.map((x) => `- (P${x.prioridad}) ${x.texto}${x.para ? " · vence " + x.para : ""}`).join("\n") || "(ninguna)"}
${pedido ? `LO QUE TE DICE AHORA: """${pedido.slice(0, 3000)}"""` : ""}

Armá el plan de lo que queda del día en bloques horarios realistas (desde ahora; no más de 7 bloques). Reglas:
- Primero lo que tiene plata o un cliente esperando (chats calientes, cotizaciones, consultas a logística), en el bloque más temprano.
- Los chats de WhatsApp van en 2 o 3 bloques cortos repartidos (ej. 20 min a la mañana, a la tarde y antes de cerrar), así no se acumulan.
- Un bloque de contenido por día (grabar 2 o 3 videos de una + subir historias), no picoteado.
- Respetá estudio, ejercicio y lo personal que conozcas: son fijos, no se sacrifican.
- Si hay más de lo que entra, decí qué pasa a mañana y por qué, en una línea.
- Tono rioplatense, directo, motivador sin chamuyo, sin emojis salvo uno al inicio de cada bloque.
- "perfil": si en lo que te dice ahora aparece algo nuevo y estable de su vida (horarios de facu, días de gym, horario de trabajo, fechas de examen), devolvé el perfil COMPLETO actualizado en 2 a 6 líneas; si no, vacío.
Respondé SOLO JSON: {"plan":"texto del plan con un bloque por renglón, formato '09:00-10:00 · qué hacer'","mañana":"lo que pasa a mañana o vacío","foco":"la UNA cosa más importante de hoy","perfil":""}`);
  if (!r?.plan) return null;
  if (r.perfil && String(r.perfil).trim().length > 10) await kvPut(env, "asist_perfil:" + quien, String(r.perfil).trim().slice(0, 1200));
  return `🎯 Foco de hoy: ${r.foco || "-"}\n\n${r.plan}${r.mañana ? "\n\n➡️ Pasa a mañana: " + r.mañana : ""}`;
}

async function porNumero(env, chat, nums) {
  const ids = JSON.parse((await kvGet(env, "tg_lista:" + chat)) || "[]");
  return nums.map((n) => ids[n - 1]).filter(Boolean);
}

// Palabras que el audio entiende mal seguido
const corregir = (t) => t.replace(/\b(nou?s[oó]n|nous?ion|knowzone|know ?zone|noci[oó]n|noshon|n[oó]chon|nosh[oó]n|noution|n[oa]u?ti[oó]n)\b/gi, "Notion").replace(/\bel ochocientos cinco\b/gi, "el 805");
async function transcribirTG(env, fileId) {
  const f = await tg(env, "getFile", { file_id: fileId });
  if (!f?.ok) throw new Error("no pude bajar el audio");
  const buf = new Uint8Array(await (await fetch(`https://api.telegram.org/file/bot${env.TELEGRAM_TOKEN}/${f.result.file_path}`)).arrayBuffer());
  let bin = ""; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  if (env.GEMINI_KEY) {
    for (const m of ["gemini-flash-lite-latest", "gemini-flash-latest", "gemini-2.5-flash-lite"]) {
      const g = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, { method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_KEY },
        body: JSON.stringify({ contents: [{ parts: [{ inline_data: { mime_type: "audio/ogg", data: btoa(bin) } }, { text: "Transcribí este audio en español rioplatense, palabra por palabra, sin agregar nada. Palabras que puede decir: Notion, Telegram, WhatsApp 805, Buco, Matías, Pedro, reels, carruseles, historias, Mercado Libre, Alibaba, facultad. Devolvé solo el texto." }] }], generationConfig: { temperature: 0 } }) }).catch(() => null);
      const j = g?.ok ? await g.json().catch(() => null) : null;
      const tx = (j?.candidates?.[0]?.content?.parts || []).map((x) => x.text || "").join("").trim();
      if (tx) return corregir(tx);
    }
  }
  const r = await env.AI.run("@cf/openai/whisper-large-v3-turbo", { audio: btoa(bin), language: "es", initial_prompt: "Notion, Telegram, WhatsApp 805, Buco, Matías, Pedro, reels, carruseles, historias, Mercado Libre, Alibaba, facultad, física, cálculo." });
  return corregir(String(r?.text || "").trim());
}

// Referencias de contenido: le reenvían al bot un video que funciona (descargado de TikTok o Instagram) y Gemini lo mira entero.
// Queda en ig_refs, de donde salen las ideas de reels (lunes 9 h o "Generar ideas") Gratis: no usa Apify.
const MAX_VIDEO = 14e6;   // Gemini acepta hasta ~20 MB por pedido y el video va en base64 (+33%)
const ESQUEMA_REFS = "CREATE TABLE IF NOT EXISTS ig_refs (id TEXT PRIMARY KEY, ts INTEGER, link TEXT, nicho TEXT, que_pasa TEXT, por_que TEXT, usos INTEGER DEFAULT 0, quien TEXT)";
const RE_LINK_RED = /https?:\/\/(?:www\.|vm\.|vt\.|m\.)?(?:tiktok\.com|instagram\.com)\/\S+/i;
async function guardarRef(env, { link = "", nicho = "", que_pasa, por_que = "", quien }) {
  await env.DB.prepare(ESQUEMA_REFS).run();
  if (link) await env.DB.prepare("DELETE FROM ig_refs WHERE link=?").bind(link).run();
  await env.DB.prepare("INSERT INTO ig_refs (id, ts, link, nicho, que_pasa, por_que, usos, quien) VALUES (?,?,?,?,?,?,0,?)").bind(nid(), Date.now(), link.slice(0, 300), nicho.slice(0, 60), String(que_pasa).slice(0, 800), String(por_que).slice(0, 400), quien).run();
}
async function analizarVideoRef(env, chat, quien, video, nota) {
  if (!env.GEMINI_KEY) return decir(env, chat, "Para mirar videos falta cargar GEMINI_KEY en Cloudflare.");
  if (video.file_size > 20e6) return decir(env, chat, "Ese video pesa más de 20 MB y Telegram no me deja bajarlo. Mandámelo como video (no como archivo), así Telegram lo comprime.");
  const f = await tg(env, "getFile", { file_id: video.file_id });
  if (!f?.ok) return decir(env, chat, "No pude bajar el video de Telegram. Probá mandarlo de nuevo como video (no como archivo).");
  const buf = new Uint8Array(await (await fetch(`https://api.telegram.org/file/bot${env.TELEGRAM_TOKEN}/${f.result.file_path}`)).arrayBuffer());
  if (buf.length > MAX_VIDEO) return decir(env, chat, `El video pesa ${Math.round(buf.length / 1e6)} MB y puedo mirar hasta ${MAX_VIDEO / 1e6}. Mandámelo como video (no como archivo) o recortalo.`);
  let bin = ""; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  const link = (nota.match(RE_LINK_RED) || [""])[0].replace(/[),.]+$/, ""), comentario = nota.replace(link, "").trim();
  const prompt = `Sos el estratega de contenido de "Te Importamos" (Rosario, Argentina): importamos por encargo de China para revendedores, emprendedores y gente que vende en Mercado Libre; hacemos reels e historias en Instagram y TikTok. El dueño te pasa este video porque le funcionó a otro (es una REFERENCIA, no es nuestro).${comentario ? ` Lo que dice él: "${comentario.slice(0, 500)}".` : ""}
Miralo entero (imagen, texto en pantalla y audio) y explicá su MECÁNICA para poder copiarla en nuestro nicho:
- "gancho": qué se ve, qué se dice y qué texto aparece en los primeros 3 segundos, tal cual.
- "que_pasa": qué pasa en el video, en orden y concreto (escenas, giro, cierre), en 2 a 4 oraciones.
- "estructura": la estructura en pasos cortos (ej. "problema → búsqueda frustrada → revelación del precio → reacción").
- "por_que": por qué engancha (sorpresa, momento real, número que impacta, identificación, polémica, curiosidad), en 1 o 2 oraciones.
- "para_nosotros": una idea concreta de cómo usar esa misma mecánica con importación, con un producto y un número.
- "red": "tiktok", "instagram" u "otro" según lo que se vea (marca de agua, interfaz).
Respondé SOLO JSON: {"gancho":"","que_pasa":"","estructura":"","por_que":"","para_nosotros":"","red":""}`;
  let r = null;
  for (const m of ["gemini-flash-latest", "gemini-2.5-flash", "gemini-flash-lite-latest"]) {
    const g = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, { method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_KEY },
      body: JSON.stringify({ contents: [{ parts: [{ inline_data: { mime_type: video.mime_type || "video/mp4", data: btoa(bin) } }, { text: prompt }] }], generationConfig: { temperature: 0.4, responseMimeType: "application/json" } }) }).catch(() => null);
    const j = g?.ok ? await g.json().catch(() => null) : null;
    try { r = JSON.parse((j?.candidates?.[0]?.content?.parts || []).map((x) => x.text || "").join("").replace(/^```(json)?|```$/g, "").trim()); } catch { r = null; }
    if (r?.que_pasa) break;
  }
  if (!r?.que_pasa) {
    if (comentario.length >= 10) { await guardarRef(env, { link, nicho: /tiktok/i.test(link) ? "tiktok" : /instagram/i.test(link) ? "instagram" : "", que_pasa: comentario, quien }); return decir(env, chat, "No pude mirar el video ahora, pero guardé la referencia con lo que me escribiste."); }
    return decir(env, chat, "No pude mirar el video ahora. Probá de nuevo en un rato o mandámelo con dos palabras de qué pasa.");
  }
  await guardarRef(env, { link, nicho: ["tiktok", "instagram"].includes(r.red) ? r.red : "", quien,
    que_pasa: `Gancho (0-3 s): ${r.gancho || "-"} | Qué pasa: ${r.que_pasa} | Estructura: ${r.estructura || "-"}${comentario ? " | Nota del dueño: " + comentario : ""}`,
    por_que: [r.por_que, r.para_nosotros ? "Para nosotros: " + r.para_nosotros : ""].filter(Boolean).join(" ") });
  const n = (await env.DB.prepare("SELECT COUNT(*) n FROM ig_refs WHERE que_pasa<>''").first())?.n || 0;
  return decir(env, chat, `🎬 Lo miré y lo guardé como referencia (ya hay ${n}).\n\n🪝 Gancho: ${r.gancho || "-"}\n🧩 Estructura: ${r.estructura || "-"}\n💡 Por qué engancha: ${r.por_que || "-"}${r.para_nosotros ? "\n➡️ Para nosotros: " + r.para_nosotros : ""}\n\nEntra en las ideas del lunes (o tocá "Generar ideas" en Redes).`);
}
// Un link de TikTok/Instagram sin video: se guarda con la nota (o el texto del posteo de TikTok), como en el panel
async function guardarLinkRef(env, chat, quien, texto) {
  const link = (texto.match(RE_LINK_RED) || [""])[0].replace(/[),.]+$/, ""), nota = texto.replace(link, "").replace(/^[\s\-–:|]+/, "").trim();
  let posteo = "";
  if (!nota && /tiktok\.com/i.test(link)) { try { const o = await fetch("https://www.tiktok.com/oembed?url=" + encodeURIComponent(link), { signal: AbortSignal.timeout(4000) }).then((x) => x.json()); posteo = [o.author_name ? "@" + o.author_name : "", o.title || ""].filter(Boolean).join(": "); } catch {} }
  await guardarRef(env, { link, nicho: /tiktok/i.test(link) ? "tiktok" : "instagram", que_pasa: nota || (posteo ? "Texto del posteo: " + posteo : ""), quien });
  return decir(env, chat, nota.length >= 10 ? "📌 Guardé la referencia con tu nota. Si me mandás el video descargado, lo miro entero y saco el gancho y la estructura (rinde mucho más)." : "📌 Guardé el link, pero solo con el link no sé qué pasa en el video" + (posteo ? " (leí el texto del posteo)" : "") + ". Mandame el video descargado y lo miro entero, o escribime en dos palabras qué pasa.");
}

async function organizar(env, iaJSON, quien, texto) {
  const actuales = await pendientes(env, quien);
  const r = await iaJSON(env, `Sos el asistente personal de ${nombreDe(quien)}, dueño de "Te Importamos" (importaciones por encargo de China a Argentina, Rosario: vende por WhatsApp, hace contenido para Instagram, trabaja con proveedores y un socio). Hoy es ${hoyAR()} (hora Argentina).
Te acaba de decir esto (puede ser un audio transcripto, desordenado):
"""${texto.slice(0, 6000)}"""

SUS TAREAS PENDIENTES AHORA:
${actuales.map((x) => `[${x.id}] (P${x.prioridad}) ${x.texto}`).join("\n") || "(ninguna)"}

Si es una PREGUNTA o un pedido de información (ej: "¿hay chats urgentes?"), NO es una tarea: no la anotes. Cosas fijas y repetidas (cursar una materia todas las semanas) no son tareas sueltas: solo anotalas si hay algo puntual (rendir, entregar, estudiar para el parcial del 22).
Sacá TODAS las tareas concretas que menciona (cada cosa que tiene que hacer, llamar, mandar, comprar, revisar, decidir). Una tarea = una acción corta que empieza con verbo ("Llamar a Pedro por el envío de termos"). No inventes tareas que no dijo. Si algo ya está en la lista, no lo repitas (si agrega info, ponela en "actualizar"). Si dice que ya hizo algo de la lista, ponelo en "hechas".
Prioridad: 1 = urgente, hoy (hay un cliente o plata esperando, se vence, bloquea a otros); 2 = importante esta semana (hace crecer el negocio o evita un problema); 3 = puede esperar; 4 = idea o algún día.
"para": fecha límite YYYY-MM-DD solo si la dice o se deduce ("mañana", "el viernes"); si no, "".
Área: ${AREAS.join(", ")}.
"respuesta": una frase corta en rioplatense confirmando (sin repetir la lista).
Respondé SOLO JSON: {"nuevas":[{"texto":"...","detalle":"contexto útil o vacío","prioridad":1,"area":"...","para":""}],"hechas":["id"],"actualizar":[{"id":"...","texto":"...","prioridad":2,"para":""}],"respuesta":"..."}`);
  if (!r) return null;
  const ids = new Set(actuales.map((x) => x.id)), st = [];
  const pal = (t) => new Set(String(t).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").split(/[^a-z0-9ñ]+/).filter((w) => w.length > 2));
  const igual = (a, b) => { const A = pal(a), B = pal(b); if (!A.size || !B.size) return false; let n = 0; for (const w of A) if (B.has(w)) n++; return n / Math.min(A.size, B.size) >= 0.75; };
  const vistas = actuales.map((x) => x.texto);
  const nuevas = (Array.isArray(r.nuevas) ? r.nuevas : []).filter((x) => { const tx = String(x?.texto || "").trim(); if (tx.length <= 3 || vistas.some((v) => igual(v, tx))) return false; vistas.push(tx); return true; }).slice(0, 30);
  for (const x of nuevas) st.push(env.DB.prepare("INSERT INTO mis_tareas (id, ts, quien, texto, detalle, prioridad, area, para, estado, origen) VALUES (?,?,?,?,?,?,?,?,'pendiente',?)")
    .bind(nid(), Date.now(), quien, String(x.texto).trim().slice(0, 200), String(x.detalle || "").slice(0, 500), Math.max(1, Math.min(4, parseInt(x.prioridad) || 3)), AREAS.includes(x.area) ? x.area : "Otro", /^\d{4}-\d{2}-\d{2}$/.test(x.para || "") ? x.para : "", texto.slice(0, 300)));
  const hechas = (Array.isArray(r.hechas) ? r.hechas : []).map(String).filter((i) => ids.has(i));
  for (const i of hechas) st.push(env.DB.prepare("UPDATE mis_tareas SET estado='hecha', hecha_ts=? WHERE id=?").bind(Date.now(), i));
  for (const u of (Array.isArray(r.actualizar) ? r.actualizar : [])) if (ids.has(String(u?.id))) st.push(env.DB.prepare("UPDATE mis_tareas SET texto=COALESCE(NULLIF(?,''),texto), prioridad=COALESCE(?,prioridad), para=COALESCE(NULLIF(?,''),para) WHERE id=?").bind(String(u.texto || "").slice(0, 200), u.prioridad ? Math.max(1, Math.min(4, parseInt(u.prioridad))) : null, /^\d{4}-\d{2}-\d{2}$/.test(u.para || "") ? u.para : "", String(u.id)));
  if (st.length) await env.DB.batch(st);
  return { n: nuevas.length, hechas: hechas.length, respuesta: String(r.respuesta || "Listo, anotado.").slice(0, 300) };
}

async function atender(env, iaJSON, upd) {
  const msg = upd.message || upd.edited_message; if (!msg?.chat) return;
  const chat = String(msg.chat.id);
  // para que "Conectar Telegram" del panel siga andando con el webhook activo
  try { const u = JSON.parse((await kvGet(env, "tg_updates")) || "[]").filter((x) => String(x.message.chat.id) !== chat); u.push({ message: { chat: msg.chat } }); await kvPut(env, "tg_updates", JSON.stringify(u.slice(-10))); } catch {}
  const quien = (await chatsConocidos(env))[chat];
  if (!quien) {
    if (/^\/start/.test(msg.text || "")) return decir(env, chat, "Hola. Para conectarte, tocá \"Conectar Telegram\" en el panel ahora.");
    return decir(env, chat, "Este asistente es privado del equipo de Te Importamos. Si sos del equipo, conectá tu Telegram desde el panel.");
  }
  await preparar(env);
  let texto = String(msg.text || msg.caption || "").trim();
  const video = msg.video || msg.animation || (/^video\//.test(msg.document?.mime_type || "") ? msg.document : null);
  if (video) { await tg(env, "sendChatAction", { chat_id: chat, action: "typing" }); return analizarVideoRef(env, chat, quien, video, texto); }
  if (RE_LINK_RED.test(texto) && texto.replace(RE_LINK_RED, "").trim().length < 300) return guardarLinkRef(env, chat, quien, texto);
  const audio = msg.voice || msg.audio || (msg.video_note ? { file_id: msg.video_note.file_id } : null);
  if (audio) {
    await tg(env, "sendChatAction", { chat_id: chat, action: "typing" });
    try { texto = await transcribirTG(env, audio.file_id); } catch (e) { return decir(env, chat, "No pude escuchar el audio (" + String(e.message || e).slice(0, 80) + "). Probá de nuevo o escribímelo."); }
    if (!texto) return decir(env, chat, "El audio llegó vacío o no se entendió. Probá de nuevo.");
  }
  if (!texto) return;
  const t = texto.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
  if (/(esta(s)? configurad|funciona(s)?\b|andas\b|me escuchas|sos el asistente|que podes hacer|como te uso|como funciona)/.test(t) && t.length < 120) return decir(env, chat, `Sí ${nombreDe(quien)}, estoy andando y este es el chat correcto. Mandame audios o textos con todo lo que tengas que hacer y lo ordeno.\n\n• "lista": todo lo pendiente\n• "hoy": lo urgente\n• "plan": te armo el día en bloques\n• "chats": los del 805 sin contestar, con número\n• "seguimientos": cotizados que no contestaron, con el mensaje listo para mandar\n• Reenviame un video que funcione (de TikTok o Instagram) y lo miro para sacar ideas\n• "redes": qué hay que hacer hoy en redes\n• "negocio": lo que espera en el panel\n• "hecho 2", "subí 3", "borrar 4"\nTe escribo a las 8, a las 10 (seguimientos), a las 14 y a las 21.`);
  if (/^\/?(start|ayuda|help)\b/.test(t)) return decir(env, chat, `Hola ${nombreDe(quien)}. Mandame un audio o un texto con todo lo que tenés que hacer, desordenado, y te lo ordeno por prioridad.\n\n• "lista": todo lo pendiente\n• "hoy": solo lo urgente\n• "hecho 2" o "hecho 1,3": tachar\n• "subí 4" / "bajá 4": cambiar prioridad\n• "borrar 4"\n• "plan": te armo el día en bloques (tus tareas + lo que espera en el negocio + facu, gym, etc.)\n• "negocio": chats, videos, carruseles e historias pendientes\n• "seguimientos": a quién volver a escribirle, con el mensaje listo\n• Mandame un video que le funcionó a otro y lo guardo como referencia para las ideas\n• "perfil": lo que sé de tu rutina\nA las 8 te mando el plan, a las 10 los seguimientos, a las 14 cómo vas y a las 21 el cierre del día.`);
  if (/^\/?(lista|tareas|mis tareas|pendientes|todo|la lista)\s*$/.test(t)) return decir(env, chat, await textoLista(env, chat, quien));
  if (/^\/?hoy\s*$/.test(t)) return decir(env, chat, await textoLista(env, chat, quien, { titulo: "Para hoy", soloHoy: true }));
  // "listo" / "ya está" / "terminé" sin número: tacha lo que estaba haciendo y le dice lo que sigue
  if (/^(listo|ya esta|ya lo hice|termine|hecho|done|ok listo)[.! ]*$/.test(t)) {
    const fid = await kvGet(env, "asist_foco:" + quien);
    if (fid) { const fx = await env.DB.prepare("SELECT notion_id FROM mis_tareas WHERE id=?").bind(fid).first(); if (fx?.notion_id) await marcarEnNotion(env, fx.notion_id).catch(() => {}); await env.DB.prepare("UPDATE mis_tareas SET estado='hecha', hecha_ts=? WHERE id=? AND quien=? AND estado='pendiente'").bind(Date.now(), fid, quien).run(); await env.DB.prepare("DELETE FROM kv WHERE k=?").bind("asist_foco:" + quien).run(); }
    await tg(env, "sendChatAction", { chat_id: chat, action: "typing" });
    const r2 = await secretario(env, iaJSON, quien, chat, "Terminé lo que estaba haciendo. ¿Ahora qué hago?");
    return decir(env, chat, (fid ? "✅ Bien ahí.\n" : "") + (r2 || "Decime \"lista\" y elegimos lo que sigue."));
  }
  if (/^\/?(plan|planificame|organizame|organiza(me)? el dia|organizame lo que resta del dia|lo que resta del dia)\s*\??$/.test(t)) return decir(env, chat, await planBloques(env, quien));
  if (/^\/?(version|versión)\s*$/.test(t)) return decir(env, chat, "Asistente versión " + VERSION_ASISTENTE);
  if (/^\/?(agenda|mi agenda|hoy en notion|notion hoy|que me queda( hoy)?)\s*\??$/.test(t) || (/\bagenda\b|que (me|nos) queda (pendiente )?(de )?hoy|pendientes? de hoy/.test(t) && !/(anota|agrega|sum|organiz|plan|resta del dia)/.test(t) && t.length < 160)) {
    if (!notionActivo(env)) return decir(env, chat, await textoLista(env, chat, quien, { titulo: "Para hoy", soloHoy: true }));
    const nt = await notionHoy(env).catch(() => null), neg = await negocioPendiente(env);
    return decir(env, chat, (nt ? agendaNotion(nt) : "No pude leer tu Notion ahora.") + (neg.calientes ? `\n\n💬 Negocio: ${neg.calientes} chats calientes del 805 (decime "chats").` : ""));
  }
  if (/^\/?(chats|whatsapp|wpp|805)\s*$/.test(t)) return decir(env, chat, await chatsSinContestar(env));
  if (/^\/?(seguimientos?|seg|segs)( de hoy)?\s*$/.test(t)) { await tg(env, "sendChatAction", { chat_id: chat, action: "typing" }); return mandarSeguimientos(env, iaJSON, chat); }
  if (/^\/?(redes|instagram)\s*$/.test(t)) return decir(env, chat, "📲 Hoy en redes:\n" + (await redesHoy(env)).map((x) => "• " + x).join("\n"));
  if (/^\/?(negocio|pendientes del negocio|panel)\b/.test(t)) { const n = await negocioPendiente(env); return decir(env, chat, n.texto ? "Lo que está esperando en el negocio:\n" + n.texto : "En el negocio no hay nada esperando. 🙌"); }
  if (/^\/?notion\s*$/.test(t)) {
    if (!notionActivo(env)) return decir(env, chat, "Notion todavía no está conectado. Falta cargar NOTION_TOKEN en Cloudflare y compartir tus páginas con la integración (te lo explicó Claude paso a paso).");
    try { return decir(env, chat, await diagnosticoNotion(env)); }
    catch (e) { return decir(env, chat, "No pude leer tu Notion: " + String(e.message || e).slice(0, 150)); }
  }
  const rolN = t.match(/(tareas|habitos|eventos)\b.{0,30}\b(base|tabla|pagina)\s+["“']?([^"”']+?)["”']?\s*$/);
  if (rolN && /notion/.test(t) && notionActivo(env)) { const nom = texto.match(/(?:base|tabla|p[aá]gina)\s+["“']?([^"”']+?)["”']?\s*$/i)?.[1] || rolN[3]; await fijarRol(env, rolN[1], nom.trim()); return decir(env, chat, `Listo, uso "${nom.trim()}" como ${rolN[1]}.\n\n` + (await diagnosticoNotion(env))); }
  if (/^\/?(preferencias|configuracion|ajustes)\s*$/.test(t)) { const pf = await prefsDe(env, quien); return decir(env, chat, (pf ? "Así te hablo:\n" + pf : "Por ahora: mensajes cortos y de a una cosa.") + "\n\nPara cambiarlo decímelo normal (ej: \"no me mandes el aviso de las 14\")."); }
  if (/^\/?(perfil|mi perfil|que sabes de mi)\b/.test(t)) { const pf = await perfilDe(env, quien); return decir(env, chat, pf ? "Lo que sé de tu rutina:\n" + pf + "\n\nPara cambiarlo, contame (ej: \"los martes y jueves tengo facu de 18 a 22\")." : "Todavía no sé nada de tu rutina. Contame tus horarios fijos: trabajo, facu, gym, y lo tengo en cuenta en el plan."); }
  const cmd = t.match(/^\/?(hecho|hecha|listo|ok|tache|tacha|borrar|borra|elimina|subi|subir|baja|bajar)\s+((?:\d+\s*(?:,|y|\s)\s*)*\d+)\s*$/);
  if (cmd) {
    const nums = cmd[2].split(/\D+/).map(Number).filter(Boolean), ids = await porNumero(env, chat, nums);
    if (!ids.length) return decir(env, chat, "No encontré esos números. Pedí \"lista\" primero.");
    const v = cmd[1];
    const sql = /^(hech|list|ok|tach)/.test(v) ? "UPDATE mis_tareas SET estado='hecha', hecha_ts=? WHERE id=? AND quien=?" : /^(borr|elim)/.test(v) ? "UPDATE mis_tareas SET estado='borrada', hecha_ts=? WHERE id=? AND quien=?" : /^sub/.test(v) ? "UPDATE mis_tareas SET prioridad=MAX(1, prioridad-1), hecha_ts=hecha_ts WHERE ? IS NOT NULL AND id=? AND quien=?" : "UPDATE mis_tareas SET prioridad=MIN(4, prioridad+1), hecha_ts=hecha_ts WHERE ? IS NOT NULL AND id=? AND quien=?";
    await env.DB.batch(ids.map((i) => env.DB.prepare(sql).bind(Date.now(), i, quien)));
    const pre = /^(hech|list|ok|tach)/.test(v) ? `✅ Tachada${ids.length > 1 ? "s" : ""}.` : /^(borr|elim)/.test(v) ? "🗑 Borrada." : "↕️ Cambiada la prioridad.";
    return decir(env, chat, pre + "\n\n" + (await textoLista(env, chat, quien)));
  }
  await tg(env, "sendChatAction", { chat_id: chat, action: "typing" });
  const aviso = setTimeout(() => { decir(env, chat, "Dame un toque, lo estoy pensando…").catch(() => {}); }, 15000);
  const r = await secretario(env, iaJSON, quien, chat, texto).finally(() => clearTimeout(aviso));
  if (!r) return decir(env, chat, "La IA no respondió ahora. Guardé lo que dijiste como una tarea para no perderlo; reenviamelo en un rato para ordenarlo." + (await guardarCrudo(env, quien, texto)));
  return decir(env, chat, (audio ? `🎙 "${texto.slice(0, 200)}${texto.length > 200 ? "…" : ""}"\n\n` : "") + r);
}
async function guardarCrudo(env, quien, texto) {
  await env.DB.prepare("INSERT INTO mis_tareas (id, ts, quien, texto, detalle, prioridad, area, para, estado, origen) VALUES (?,?,?,?,?,2,'Otro','','pendiente',?)").bind(nid(), Date.now(), quien, "Ordenar: " + texto.slice(0, 180), texto.slice(0, 500), texto.slice(0, 300)).run();
  return "";
}

// POST /tg/<secreto> (webhook de Telegram)
export async function rutaTelegram(env, req, url, ctx, iaJSON) {
  const sec = await secretoTG(env);
  if (url.pathname !== "/tg/" + sec || req.headers.get("X-Telegram-Bot-Api-Secret-Token") !== sec) return new Response("no", { status: 403 });
  const upd = await req.json().catch(() => ({}));
  // Se procesa ANTES de contestarle a Telegram: waitUntil corta a los 30 s y la IA a veces tarda más (por eso no respondía).
  // Si pasa de 50 s, se le contesta a Telegram igual (para que no reintente) y se sigue en segundo plano.
  const trabajo = (async () => {
    await kvPut(env, "asist_ultimo", JSON.stringify({ ts: Date.now(), texto: String(upd?.message?.text || (upd?.message?.voice ? "[audio]" : "")).slice(0, 60) })).catch(() => {});
    await atender(env, iaJSON, upd).catch(async (e) => {
      const ch = upd?.message?.chat?.id; if (ch) await decir(env, String(ch), "Se me trabó procesando eso (" + String(e?.message || e).slice(0, 80) + "). Mandámelo de nuevo en un minuto.").catch(() => {}); console.log("Asistente:", e?.stack || e); await kvPut(env, "asist_error", JSON.stringify({ ts: Date.now(), error: String(e?.stack || e).slice(0, 800) })).catch(() => {}); });
  })();
  const listo = await Promise.race([trabajo.then(() => true), new Promise((ok) => setTimeout(() => ok(false), 50000))]);
  if (!listo) ctx.waitUntil(trabajo);
  return new Response("ok");
}

// /panel/api/asistente/... (con sesión del panel)
export async function apiAsistente(env, req, url, quien, base, iaJSON = null) {
  await preparar(env);
  const r = url.pathname.replace("/panel/api/asistente/", "");
  const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json" } });
  if (r === "activar") {
    if (!env.TELEGRAM_TOKEN) return json({ ok: false, error: "Falta TELEGRAM_TOKEN" });
    const sec = await secretoTG(env);
    const x = await tg(env, "setWebhook", { url: `${base}/tg/${sec}`, secret_token: sec, allowed_updates: ["message", "edited_message"], drop_pending_updates: false });
    return json({ ok: !!x?.ok, telegram: x, chats: await chatsConocidos(env) });
  }
  // Diagnóstico (se abre desde el celu logueado en el panel): qué dice Telegram, último mensaje y último error. Si el webhook se cayó, lo vuelve a poner.
  if (r === "estado") {
    const sec = await secretoTG(env), info = await tg(env, "getWebhookInfo", {});
    let reactivado = null;
    if (env.TELEGRAM_TOKEN && info?.result?.url !== `${base}/tg/${sec}`) reactivado = await tg(env, "setWebhook", { url: `${base}/tg/${sec}`, secret_token: sec, allowed_updates: ["message", "edited_message"], drop_pending_updates: false });
    return json({ version: VERSION_ASISTENTE, telegram: info?.result ? { url_ok: info.result.url === `${base}/tg/${sec}`, pendientes: info.result.pending_update_count, ultimo_error: info.result.last_error_message || "", error_hace_min: info.result.last_error_date ? Math.round((Date.now() / 1000 - info.result.last_error_date) / 60) : null } : info, reactivado, ultimo_mensaje: JSON.parse((await kvGet(env, "asist_ultimo")) || "null"), ultimo_error: JSON.parse((await kvGet(env, "asist_error")) || "null"), chats: await chatsConocidos(env) });
  }
  // Probar el asistente desde el panel sin mandar nada a Telegram (devuelve lo que contestaría)
  if (r === "probar" && req.method === "POST") {
    const b = await req.json().catch(() => ({})), chats = await chatsConocidos(env);
    const chat = Object.keys(chats).find((c) => chats[c] === (b.quien || quien)) || Object.keys(chats)[0];
    const e2 = { ...env, __captura: [] };
    if (!iaJSON) return json({ error: "sin IA" });
    await atender(e2, iaJSON, { message: { chat: { id: chat }, text: String(b.texto || "") } });
    return json({ respuestas: e2.__captura });
  }
  if (r === "tareas") return json(await pendientes(env, url.searchParams.get("de") || quien));
  return json({ error: "ruta desconocida" }, 404);
}

// 8:00 plan del día · 10:00 seguimientos · 14:00 cómo vas · 21:00 cierre (hora Argentina = UTC-3)
export async function cronAsistente(env, ts, iaJSON = null) {
  const d = new Date(ts), h = d.getUTCHours(), m = d.getUTCMinutes();
  if (m !== 0 || ![11, 13, 17, 0].includes(h) || !env.TELEGRAM_TOKEN) return;
  await preparar(env);
  // Seguimientos: solo al chat principal (el del dueño), así no le escriben dos personas al mismo cliente
  if (h === 13) {
    const chat = env.TELEGRAM_CHAT || (await kvGet(env, "telegram_chat"));
    const pf = (await prefsDe(env, "Manuel")).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    if (!chat || /(no|sin|sacame|saca)\b.{0,30}\b(10|diez|seguimiento)/.test(pf)) return;
    for (const x of await seguimientosHoy(env, iaJSON)) await decirBotones(env, chat, x.texto, x.botones);
    return;
  }
  const [neg, nSeg] = await Promise.all([negocioPendiente(env), cuantosSeg(env)]);
  for (const [chat, quien] of Object.entries(await chatsConocidos(env))) {
    const pf = (await prefsDe(env, quien)).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    if (h === 11 && /(no|sin|sacame|saca)\b.{0,30}\b(8|ocho|manana|buen dia)\b/.test(pf)) continue;
    if (h === 17 && /(no|sin|sacame|saca)\b.{0,30}\b(14|catorce|mediodia|mitad|como vas)\b/.test(pf)) continue;
    if (h === 0 && /(no|sin|sacame|saca)\b.{0,30}\b(21|noche|cierre)\b/.test(pf)) continue;
    if (h === 11) {
      const l = await pendientes(env, quien), top = l[0];
      if (top) await kvPut(env, "asist_foco:" + quien, top.id);
      const primero = neg.calientes ? `contestar los ${neg.calientes} chats calientes del 805 (decime "chats" y te paso los números)` : top ? top.texto : neg.chats ? `contestar los ${neg.chats} chats del 805` : "";
      await decir(env, chat, `Buen día ${nombreDe(quien)}. ${primero ? "Arrancamos con una sola cosa: " + primero + "." : "No tenés nada urgente. Mandame un audio con lo que quieras hacer hoy."}${nSeg ? `\nA las 10 te paso ${nSeg} seguimiento${nSeg > 1 ? "s" : ""} listos para mandar.` : ""}\nCuando termines decime "listo" y te digo lo que sigue.`);
    } else if (h === 17) {
      const urg = (await pendientes(env, quien)).filter((x) => x.prioridad === 1 || (x.para && x.para <= hoyAR()));
      if (!urg.length && !neg.calientes && !neg.chats) continue;
      await decir(env, chat, `⏱ ¿Cómo vas? ${urg.length ? `Te quedan ${urg.length} urgente${urg.length > 1 ? "s" : ""}.` : "Lo urgente ya está."}${neg.chats ? ` Hay ${neg.chats} chat${neg.chats > 1 ? "s" : ""} esperando.` : ""} Decime "ahora qué hago" y seguimos.`);
    } else {
      const l = await pendientes(env, quien), hoy = hoyAR(), urg = l.filter((x) => x.prioridad === 1 || (x.para && x.para <= hoy));
      // lo urgente que no se hizo pasa a mañana con fecha, así aparece primero en el plan de mañana
      const man = new Date(Date.now() - AR + 86400e3).toISOString().slice(0, 10);
      if (urg.length) await env.DB.batch(urg.map((x) => env.DB.prepare("UPDATE mis_tareas SET para=? WHERE id=?").bind(man, x.id)));
      await decir(env, chat, `🌙 Cierre. ${urg.length ? `${urg.length} urgente${urg.length > 1 ? "s pasan" : " pasa"} a mañana temprano.` : "Lo urgente quedó hecho. 💪"}${nSeg ? ` Quedaron ${nSeg} seguimiento${nSeg > 1 ? "s" : ""} sin hacer (decime "seguimientos" si querés liquidarlos ahora).` : ""} Mandame un audio con lo que tengas para mañana y arrancás con la cabeza vacía.`);
    }
  }
}
