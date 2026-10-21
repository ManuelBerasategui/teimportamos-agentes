// Asistente personal por Telegram: le mandás un audio o un texto con todo lo que tenés en la cabeza
// y lo ordena en tareas por prioridad. Cada persona tiene su lista (según desde qué chat escribe).
// Comandos: "lista" (o /lista), "hecho 2" / "listo 1,3", "borrar 4", "subí 3" / "bajá 3", "hoy".
// Todos los días a las 8 de Argentina manda la lista a cada uno.

const kvGet = async (env, k) => (await env.DB.prepare("SELECT v FROM kv WHERE k=?").bind(k).first())?.v ?? null;
const kvPut = (env, k, v) => env.DB.prepare("INSERT INTO kv (k,v,exp) VALUES (?,?,NULL) ON CONFLICT(k) DO UPDATE SET v=excluded.v, exp=NULL").bind(k, String(v)).run();
const nid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const AR = 3 * 3600e3;
const hoyAR = () => new Date(Date.now() - AR).toISOString().slice(0, 10);

export const VERSION_ASISTENTE = "21/10 12:10 (secretario)";
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
  for (const q of ["ALTER TABLE mis_tareas ADD COLUMN hora_ini TEXT", "ALTER TABLE mis_tareas ADD COLUMN hora_fin TEXT", "ALTER TABLE mis_tareas ADD COLUMN tipo TEXT"]) { try { await env.DB.prepare(q).run(); } catch {} }
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
const decir = (env, chat, texto) => tg(env, "sendMessage", { chat_id: chat, text: String(texto).slice(0, 4000), disable_web_page_preview: true });

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
  const [chats, calientes, videos, carr, ideas, hist] = await Promise.all([
    contar(env, "SELECT COUNT(*) n " + SIN_CONTESTAR, Date.now() - 3 * 86400e3),
    contar(env, "SELECT COUNT(*) n FROM w_conv WHERE grupo=0 AND archivado=0 AND ult_yo=0 AND COALESCE(resp,1)=1 AND COALESCE(prov,0)=0 AND ult_cliente_ts>COALESCE(visto_ts,0) AND COALESCE(etapa,'')<>'no_cliente' AND ult_cliente_ts>=? AND (puntaje>=8 OR cot_pend=1)", hace24),
    contar(env, "SELECT COUNT(*) n FROM ig_videos WHERE estado='revision' AND borrado=0"),
    contar(env, "SELECT COUNT(*) n FROM ig_carruseles WHERE estado IN ('estructura','slides') AND COALESCE(borrado,0)=0"),
    contar(env, "SELECT COUNT(*) n FROM ig_ideas WHERE estado='nueva'"),
    contar(env, "SELECT COUNT(*) n FROM ig_historias WHERE estado='nueva' AND ts>?", hace3d),
  ]);
  const l = [];
  if (chats) l.push(`💬 ${chats} chat${chats > 1 ? "s" : ""} de WhatsApp sin contestar${calientes ? ` (${calientes} con cotización o muy calientes: primero esos)` : ""}`);
  if (videos) l.push(`🎬 ${videos} video${videos > 1 ? "s" : ""} editado${videos > 1 ? "s" : ""} esperando que los apruebes`);
  if (carr) l.push(`🖼 ${carr} carrusel${carr > 1 ? "es" : ""} a medio armar`);
  if (hist) l.push(`📱 ${hist} historia${hist > 1 ? "s" : ""} para subir`);
  if (ideas) l.push(`💡 ${ideas} idea${ideas > 1 ? "s" : ""} de reel para grabar`);
  return { chats, calientes, videos, carr, ideas, hist, texto: l.join("\n") };
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
// Qué hay que hacer HOY en redes, en acciones concretas (sale del panel)
async function filas(env, sql, ...b) { try { return (await env.DB.prepare(sql).bind(...b).all()).results || []; } catch { return []; } }
export async function redesHoy(env) {
  const hace3d = Date.now() - 3 * 86400e3, ahora = Date.now(), finDia = ahora + 24 * 3600e3;
  const [ideas, lotes, rev, prog, carr, hist, grab] = await Promise.all([
    filas(env, "SELECT titulo FROM ig_ideas WHERE estado='nueva' ORDER BY ts DESC LIMIT 6"),
    filas(env, "SELECT estado, error FROM ig_lotes WHERE estado IN ('subiendo','en_cola','procesando','error') AND ts>?", ahora - 7 * 86400e3),
    filas(env, "SELECT texto FROM ig_videos WHERE estado='revision' AND borrado=0 LIMIT 10"),
    filas(env, "SELECT programado_ts FROM ig_videos WHERE estado='aprobado' AND programado_ts BETWEEN ? AND ?", ahora, finDia),
    filas(env, "SELECT titulo, estado FROM ig_carruseles WHERE estado IN ('idea','estructura','slides') AND COALESCE(borrado,0)=0 ORDER BY ts DESC LIMIT 6"),
    filas(env, "SELECT titulo FROM ig_historias WHERE estado='nueva' AND ts>? ORDER BY ts DESC LIMIT 5", hace3d),
    filas(env, "SELECT titulo FROM ig_ideas WHERE estado='grabada' AND hecho_ts>? ORDER BY hecho_ts DESC LIMIT 5", ahora - 5 * 86400e3),
  ]);
  const l = [];
  const editando = lotes.filter((x) => x.estado !== "error").length, err = lotes.filter((x) => x.estado === "error").length;
  if (rev.length) l.push(`Aprobar y programar ${rev.length} video${rev.length > 1 ? "s" : ""} editado${rev.length > 1 ? "s" : ""} (Redes › Videos)`);
  if (editando) l.push(`Hay ${editando} tanda${editando > 1 ? "s" : ""} de clips editándose: esperar y después revisar`);
  if (err) l.push(`${err} tanda${err > 1 ? "s" : ""} de videos falló al editar: reintentar desde Redes › Videos`);
  if (grab.length && !rev.length && !editando) l.push(`Subir al editor los clips grabados de: ${grab.map((x) => x.titulo).join("; ")}`);
  if (!prog.length) l.push("No hay ningún video programado para las próximas 24 h: aprobar uno para que salga");
  if (ideas.length) l.push(`Grabar (ideas listas): ${ideas.map((x) => x.titulo).join("; ")}`);
  else l.push("No hay ideas de reels para grabar: cargar referencias y tocar Generar ideas (o redefinir las que hay)");
  if (hist.length) l.push(`Subir historias: ${hist.map((x) => x.titulo).join("; ")}`);
  else l.push("Generar las historias de hoy (Redes › Ideas › Historias)");
  if (carr.length) l.push(`Carruseles a terminar: ${carr.map((x) => `${x.titulo} (${x.estado === "idea" ? "falta estructura" : x.estado === "estructura" ? "falta confirmar y diseñar" : "falta aprobar"})`).join("; ")}`);
  return l;
}

// El secretario: entiende lo que le decís (audio o texto) con todo el contexto y hace lo que haría un secretario de verdad
async function secretario(env, iaJSON, quien, chat, texto) {
  const [l, perfil, redes, neg] = await Promise.all([pendientes(env, quien), perfilDe(env, quien), redesHoy(env), negocioPendiente(env)]);
  const chats = await chatsSinContestar(env, 10);
  const ahora = new Date(Date.now() - AR), hm = ahora.toISOString().slice(11, 16), dia = ahora.toLocaleDateString("es-AR", { weekday: "long", timeZone: "UTC" });
  const r = await iaJSON(env, `Sos el SECRETARIO personal de ${nombreDe(quien)}, dueño de "Te Importamos" (importaciones por encargo de China a Argentina, Rosario; vende por WhatsApp 805, hace reels, historias y carruseles para Instagram; su socio es Matías "Buco"; Pedro Aguirre es el despachante/logística). Estudia en la facultad.
Ahora es ${dia} ${hoyAR()}, ${hm} h (Argentina).
Te habla así (puede ser un audio transcripto, desordenado): """${texto.slice(0, 5000)}"""

LO QUE SABÉS DE SU RUTINA: ${perfil || "(nada todavía)"}
SUS PENDIENTES (id · prioridad · fecha · horario · texto):
${l.map((x) => `[${x.id}] P${x.prioridad} · ${x.para || "-"} · ${x.hora_ini ? x.hora_ini + "-" + (x.hora_fin || "?") : "-"} · ${x.texto}`).join("\n") || "(ninguno)"}
QUÉ HAY QUE HACER EN REDES (dato real del panel):
${redes.map((x) => "- " + x).join("\n")}
WHATSAPP 805: ${neg.chats} chats sin contestar, ${neg.calientes} calientes.

Actuá como un secretario de verdad:
1. Anotá cada cosa concreta que tiene que hacer como tarea separada, empezando con verbo y con el detalle que dio ("Repasar física para el parcial del 28/10"). Respetá exactamente lo que pidió anotar.
2. NUNCA anotes tareas vagas tipo "revisar pendientes de redes" o "ver el WhatsApp": si menciona redes, anotá las acciones concretas de la lista de REDES de arriba que correspondan (ej. "Aprobar y programar 3 videos", "Redefinir las ideas de reels"); si menciona WhatsApp, anotá "Contestar los N chats calientes del 805" con el número real.
3. Cosas con horario (cursar, gym, reunión, llamada a una hora) son "evento" con hora_ini y hora_fin (HH:MM). Si el horario ya pasó hoy, o dice que ya lo hizo/terminó o que no va, ponelo en "hechas" o "borrar" (no lo dejes pendiente). Las cursadas fijas de cada semana van al PERFIL, no como tarea, salvo la de hoy si tiene horario.
4. Si algo ya está en la lista, no lo repitas: actualizalo. Si dice que algo ya lo hizo, va a "hechas". Si dice que algo no va más, a "borrar".
5. Prioridad: 1 = hoy (plata o cliente esperando, se vence, examen cerca); 2 = esta semana; 3 = puede esperar; 4 = algún día.
6. Si pregunta algo, contestá eso primero y directo. Si pide los chats, poné "incluir_chats": true (yo agrego la lista real con números). Si pregunta qué hay que hacer en redes, "incluir_redes": true.
7. Si pide que le organices el día (o dicta varias cosas), armá en "respuesta" el plan de lo que QUEDA del día desde las ${hm}, en bloques con horario real, respetando lo fijo (facu, gym) y poniendo primero lo que tiene plata o clientes esperando. Repartí los chats en 2 o 3 bloques cortos.
8. "perfil": si aparece algo estable de su rutina (horarios de facu por día, gym, trabajo, fechas de parciales), devolvé el PERFIL COMPLETO actualizado (2 a 8 líneas). Si no, "".
9. "respuesta": en rioplatense, corta y clara, como un secretario que ya lo resolvió (no "ahí me fijo"). Sin repetir la lista completa salvo que la pida.
Respondé SOLO JSON: {"nuevas":[{"texto":"...","detalle":"","prioridad":1,"area":"${AREAS.join("|")}","para":"YYYY-MM-DD o vacío","tipo":"tarea|evento","hora_ini":"","hora_fin":""}],"hechas":["id"],"borrar":["id"],"actualizar":[{"id":"...","texto":"","prioridad":null,"para":"","hora_ini":"","hora_fin":""}],"perfil":"","incluir_chats":false,"incluir_redes":false,"mostrar_lista":false,"respuesta":"..."}`);
  if (!r) return null;
  const ids = new Set(l.map((x) => x.id)), st = [], hhmm = (v) => (/^\d{1,2}:\d{2}$/.test(String(v || "")) ? String(v).padStart(5, "0") : "");
  const pal = (t) => new Set(String(t).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").split(/[^a-z0-9ñ]+/).filter((w) => w.length > 2));
  const igual = (a, b) => { const A = pal(a), B = pal(b); if (!A.size || !B.size) return false; let n = 0; for (const w of A) if (B.has(w)) n++; return n / Math.min(A.size, B.size) >= 0.75; };
  const vistas = l.map((x) => x.texto), VAGA = /^(revisar|ver|chequear) (los |las )?(pendientes|cosas|todo)/i;
  let n = 0;
  for (const x of (Array.isArray(r.nuevas) ? r.nuevas : []).slice(0, 30)) {
    const tx = String(x?.texto || "").trim(); if (tx.length <= 3 || VAGA.test(tx) || vistas.some((v) => igual(v, tx))) continue; vistas.push(tx); n++;
    st.push(env.DB.prepare("INSERT INTO mis_tareas (id, ts, quien, texto, detalle, prioridad, area, para, estado, origen, tipo, hora_ini, hora_fin) VALUES (?,?,?,?,?,?,?,?,'pendiente',?,?,?,?)")
      .bind(nid(), Date.now(), quien, tx.slice(0, 200), String(x.detalle || "").slice(0, 500), Math.max(1, Math.min(4, parseInt(x.prioridad) || 3)), AREAS.includes(x.area) ? x.area : "Otro", /^\d{4}-\d{2}-\d{2}$/.test(x.para || "") ? x.para : (hhmm(x.hora_ini) ? hoyAR() : ""), texto.slice(0, 300), x.tipo === "evento" ? "evento" : "tarea", hhmm(x.hora_ini), hhmm(x.hora_fin)));
  }
  const hechas = (r.hechas || []).map(String).filter((i) => ids.has(i)), borrar = (r.borrar || []).map(String).filter((i) => ids.has(i));
  for (const i of hechas) st.push(env.DB.prepare("UPDATE mis_tareas SET estado='hecha', hecha_ts=? WHERE id=?").bind(Date.now(), i));
  for (const i of borrar) st.push(env.DB.prepare("UPDATE mis_tareas SET estado='borrada', hecha_ts=? WHERE id=?").bind(Date.now(), i));
  for (const u of (Array.isArray(r.actualizar) ? r.actualizar : [])) if (ids.has(String(u?.id))) st.push(env.DB.prepare("UPDATE mis_tareas SET texto=COALESCE(NULLIF(?,''),texto), prioridad=COALESCE(?,prioridad), para=COALESCE(NULLIF(?,''),para), hora_ini=COALESCE(NULLIF(?,''),hora_ini), hora_fin=COALESCE(NULLIF(?,''),hora_fin) WHERE id=?").bind(String(u.texto || "").slice(0, 200), u.prioridad ? Math.max(1, Math.min(4, parseInt(u.prioridad))) : null, /^\d{4}-\d{2}-\d{2}$/.test(u.para || "") ? u.para : "", hhmm(u.hora_ini), hhmm(u.hora_fin), String(u.id)));
  if (st.length) await env.DB.batch(st);
  if (r.perfil && String(r.perfil).trim().length > 10) await kvPut(env, "asist_perfil:" + quien, String(r.perfil).trim().slice(0, 1500));
  const marcas = [n ? `+${n} anotada${n > 1 ? "s" : ""}` : "", hechas.length ? `✅ ${hechas.length} tachada${hechas.length > 1 ? "s" : ""}` : "", borrar.length ? `🗑 ${borrar.length} sacada${borrar.length > 1 ? "s" : ""}` : ""].filter(Boolean).join(" · ");
  let out = String(r.respuesta || "Listo.").slice(0, 2500) + (marcas ? `\n(${marcas})` : "");
  if (r.incluir_chats) out += "\n\n" + chats;
  if (r.incluir_redes) out += "\n\n📲 Hoy en redes:\n" + redes.map((x) => "• " + x).join("\n");
  if (r.mostrar_lista || n || hechas.length || borrar.length) out += "\n\n" + (await textoLista(env, chat, quien));
  return out.slice(0, 4000);
}

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

async function transcribirTG(env, fileId) {
  const f = await tg(env, "getFile", { file_id: fileId });
  if (!f?.ok) throw new Error("no pude bajar el audio");
  const buf = new Uint8Array(await (await fetch(`https://api.telegram.org/file/bot${env.TELEGRAM_TOKEN}/${f.result.file_path}`)).arrayBuffer());
  let bin = ""; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  const r = await env.AI.run("@cf/openai/whisper-large-v3-turbo", { audio: btoa(bin), language: "es" });
  return String(r?.text || "").trim();
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
  const audio = msg.voice || msg.audio || (msg.video_note ? { file_id: msg.video_note.file_id } : null);
  if (audio) {
    await tg(env, "sendChatAction", { chat_id: chat, action: "typing" });
    try { texto = await transcribirTG(env, audio.file_id); } catch (e) { return decir(env, chat, "No pude escuchar el audio (" + String(e.message || e).slice(0, 80) + "). Probá de nuevo o escribímelo."); }
    if (!texto) return decir(env, chat, "El audio llegó vacío o no se entendió. Probá de nuevo.");
  }
  if (!texto) return;
  const t = texto.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
  if (/(esta(s)? configurad|funciona(s)?\b|andas\b|me escuchas|sos el asistente|que podes hacer|como te uso|como funciona)/.test(t) && t.length < 120) return decir(env, chat, `Sí ${nombreDe(quien)}, estoy andando y este es el chat correcto. Mandame audios o textos con todo lo que tengas que hacer y lo ordeno.\n\n• "lista": todo lo pendiente\n• "hoy": lo urgente\n• "plan": te armo el día en bloques\n• "chats": los del 805 sin contestar, con número\n• "redes": qué hay que hacer hoy en redes\n• "negocio": lo que espera en el panel\n• "hecho 2", "subí 3", "borrar 4"\nTe escribo a las 8, a las 14 y a las 21.`);
  if (/^\/?(start|ayuda|help)\b/.test(t)) return decir(env, chat, `Hola ${nombreDe(quien)}. Mandame un audio o un texto con todo lo que tenés que hacer, desordenado, y te lo ordeno por prioridad.\n\n• "lista": todo lo pendiente\n• "hoy": solo lo urgente\n• "hecho 2" o "hecho 1,3": tachar\n• "subí 4" / "bajá 4": cambiar prioridad\n• "borrar 4"\n• "plan": te armo el día en bloques (tus tareas + lo que espera en el negocio + facu, gym, etc.)\n• "negocio": chats, videos, carruseles e historias pendientes\n• "perfil": lo que sé de tu rutina\nA las 8 te mando el plan, a las 14 cómo vas y a las 21 el cierre del día.`);
  if (/^\/?(lista|tareas|pendientes|que tengo|todo)\b/.test(t)) return decir(env, chat, await textoLista(env, chat, quien));
  if (/^\/?hoy\b/.test(t)) return decir(env, chat, await textoLista(env, chat, quien, { titulo: "Para hoy", soloHoy: true }));
  if (/^\/?(plan|planificame|organizame|organiza(me)? el dia|que hago|que hago ahora|en que me enfoco|ahora que)\b/.test(t)) {
    await tg(env, "sendChatAction", { chat_id: chat, action: "typing" });
    return decir(env, chat, (await planDia(env, iaJSON, quien)) || "La IA no respondió ahora. Mientras tanto:\n\n" + (await textoLista(env, chat, quien, { titulo: "Para hoy", soloHoy: true })));
  }
  if (/^\/?(version|versión)\s*$/.test(t)) return decir(env, chat, "Asistente versión " + VERSION_ASISTENTE);
  if (/^\/?(chats|whatsapp|wpp|805)\s*$/.test(t)) return decir(env, chat, await chatsSinContestar(env));
  if (/^\/?(redes|instagram)\s*$/.test(t)) return decir(env, chat, "📲 Hoy en redes:\n" + (await redesHoy(env)).map((x) => "• " + x).join("\n"));
  if (/^\/?(negocio|pendientes del negocio|panel)\b/.test(t)) { const n = await negocioPendiente(env); return decir(env, chat, n.texto ? "Lo que está esperando en el negocio:\n" + n.texto : "En el negocio no hay nada esperando. 🙌"); }
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
  const r = await secretario(env, iaJSON, quien, chat, texto);
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
  ctx.waitUntil(atender(env, iaJSON, upd).catch((e) => console.log("Asistente:", e?.stack || e)));
  return new Response("ok");
}

// /panel/api/asistente/... (con sesión del panel)
export async function apiAsistente(env, req, url, quien, base) {
  await preparar(env);
  const r = url.pathname.replace("/panel/api/asistente/", "");
  const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json" } });
  if (r === "activar") {
    if (!env.TELEGRAM_TOKEN) return json({ ok: false, error: "Falta TELEGRAM_TOKEN" });
    const sec = await secretoTG(env);
    const x = await tg(env, "setWebhook", { url: `${base}/tg/${sec}`, secret_token: sec, allowed_updates: ["message", "edited_message"], drop_pending_updates: false });
    return json({ ok: !!x?.ok, telegram: x, chats: await chatsConocidos(env) });
  }
  if (r === "tareas") return json(await pendientes(env, url.searchParams.get("de") || quien));
  return json({ error: "ruta desconocida" }, 404);
}

// 8:00 plan del día · 14:00 cómo vas · 21:00 cierre (hora Argentina = UTC-3)
export async function cronAsistente(env, ts, iaJSON = null) {
  const d = new Date(ts), h = d.getUTCHours(), m = d.getUTCMinutes();
  if (m !== 0 || ![11, 17, 0].includes(h) || !env.TELEGRAM_TOKEN) return;
  await preparar(env);
  const neg = await negocioPendiente(env);
  for (const [chat, quien] of Object.entries(await chatsConocidos(env))) {
    if (h === 11) {
      const plan = iaJSON ? await planDia(env, iaJSON, quien).catch(() => null) : null;
      await decir(env, chat, "Buen día " + nombreDe(quien) + ".\n\n" + (plan || (await textoLista(env, chat, quien, { titulo: "Tu día" })) + (neg.texto ? "\n\nEn el negocio:\n" + neg.texto : "")));
    } else if (h === 17) {
      const urg = (await pendientes(env, quien)).filter((x) => x.prioridad === 1 || (x.para && x.para <= hoyAR()));
      if (!urg.length && !neg.calientes && !neg.chats) continue;
      await decir(env, chat, `⏱ Mitad del día. ${urg.length ? `Te quedan ${urg.length} urgente${urg.length > 1 ? "s" : ""}: ${urg.slice(0, 4).map((x) => x.texto).join("; ")}.` : "Las urgentes ya están."}${neg.chats ? `\n💬 ${neg.chats} chat${neg.chats > 1 ? "s" : ""} sin contestar${neg.calientes ? `, ${neg.calientes} calientes` : ""}: metele 20 minutos ahora.` : ""}\nSi algo ya lo hiciste, decime "hecho N" o mandame un audio.`);
    } else {
      const l = await pendientes(env, quien), hoy = hoyAR(), urg = l.filter((x) => x.prioridad === 1 || (x.para && x.para <= hoy));
      // lo urgente que no se hizo pasa a mañana con fecha, así aparece primero en el plan de mañana
      const man = new Date(Date.now() - AR + 86400e3).toISOString().slice(0, 10);
      if (urg.length) await env.DB.batch(urg.map((x) => env.DB.prepare("UPDATE mis_tareas SET para=? WHERE id=?").bind(man, x.id)));
      await decir(env, chat, `🌙 Cierre del día.${urg.length ? `\nQuedaron ${urg.length} urgente${urg.length > 1 ? "s" : ""}, las paso para mañana temprano: ${urg.slice(0, 5).map((x) => x.texto).join("; ")}.` : "\nTerminaste lo urgente. 💪"}${neg.texto ? "\n\nQuedó esperando en el negocio:\n" + neg.texto : ""}\n\nMandame un audio con lo que hiciste hoy y lo que tengas para mañana, así arrancás con la cabeza vacía.`);
    }
  }
}
