/**
 * Agente de Instagram · Te Importamos (v1.5) · Respuesta de comentarios
 * Cloudflare Worker + Gemini. Usa la API OFICIAL de Instagram (sin riesgo de baneo por apps no oficiales).
 *
 * Cada 30 minutos (cron) revisa las últimas publicaciones, toma hasta 15 comentarios sin responder
 * y les contesta algo corto y distinto que invita a escribir al DM, con pausas entre cada respuesta.
 * Lo que no conviene responder solo (quejas, insultos, preguntas raras) queda en el panel > Pendientes.
 *
 * Variables: IG_TOKEN (secreta), GEMINI_KEY, VERIFY_TOKEN (la misma clave que el agente de WhatsApp)
 * Opcional:  IG_MODO = "prueba" (no publica, solo muestra lo que respondería) | "auto" (publica)
 * Bindings:  DB (la MISMA base D1 del agente de WhatsApp)
 * Trigger:   Cron  "*\/30 * * * *"
 */

// =====================================================================
//  ✏️ ZONA EDITABLE
// =====================================================================
const CONFIG = {
  porVuelta: 15,          // comentarios por vuelta (cada 30 min)
  publicaciones: 6,       // cuántas publicaciones recientes revisa (Cloudflare gratis permite ~50 consultas por vuelta)
  diasMax: 21,            // no responde comentarios más viejos que esto
  pausaMin: 8, pausaMax: 25,   // segundos entre respuesta y respuesta (para parecer natural)
};
const ESTILO = `
Sos quien maneja el Instagram de "Te Importamos" (importación por encargo, Rosario).
Respondés comentarios públicos con algo MUY corto: de 1 a 4 palabras. Minúscula, informal, rioplatense.
El único objetivo es que escriban por privado. Nunca des precios, mínimos ni info en público.
Estilo exacto (variá y combiná entre estas, a veces estirando una letra):
"escribime", "al dm", "privadoo", "mandame al dm", "mandame un msj", "por dm", "te escribo al priv", "escribime al dm", "dm!", "privado y te paso", "mandame msj", "al privii", "escribime y te cuento".
Para elogios: "graciass", "gracias!!", "🙌", "graciaas, escribime si queres".
Podés usar como mucho 1 emoji, y solo a veces. Nunca uses dos veces seguidas la misma respuesta.
`;
// =====================================================================

const G = "https://graph.instagram.com/v21.0";
const dormir = (ms) => new Promise((ok) => setTimeout(ok, ms));
const azar = (a, b) => a + Math.random() * (b - a);

// ---------- Base de datos (compartida con el agente de WhatsApp) ----------
let listo = false;
async function tablas(env) {
  if (listo) return;
  await env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT, exp INTEGER)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS ig_comentarios (id TEXT PRIMARY KEY, media TEXT, permalink TEXT, usuario TEXT, texto TEXT, respuesta TEXT, tipo TEXT, estado TEXT, ts INTEGER, respondido INTEGER)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS ig_com_ts ON ig_comentarios(ts)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS tareas (id TEXT PRIMARY KEY, ts INTEGER, tipo TEXT, tel TEXT, nombre TEXT, titulo TEXT, detalle TEXT, datos TEXT, ref TEXT, estado TEXT)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS eventos (ts INTEGER, tipo TEXT, tel TEXT, dato TEXT)"),
  ]);
  listo = true;
}
const kvGet = async (env, k) => (await env.DB.prepare("SELECT v FROM kv WHERE k = ?").bind(k).first())?.v ?? null;
const kvPut = (env, k, v) => env.DB.prepare("INSERT INTO kv (k, v, exp) VALUES (?, ?, NULL) ON CONFLICT(k) DO UPDATE SET v = excluded.v").bind(k, String(v)).run();

// ---------- Token: dura 60 días; se renueva solo cada semana ----------
let tokenCache = null;
async function token(env) {
  if (tokenCache) return tokenCache;
  const guardado = await kvGet(env, "ig_token");
  const t = guardado || env.IG_TOKEN;
  if (!t) throw new Error("Falta la variable IG_TOKEN");
  const ultimo = +(await kvGet(env, "ig_token_renovado")) || 0;
  if (Date.now() - ultimo > 7 * 86400e3) {
    const r = await fetch(`https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(t)}`).then((x) => x.json()).catch(() => ({}));
    if (r.access_token) { await kvPut(env, "ig_token", r.access_token); await kvPut(env, "ig_token_renovado", Date.now()); return (tokenCache = r.access_token); }
    console.log("No se pudo renovar el token:", JSON.stringify(r).slice(0, 200));
  }
  return (tokenCache = t);
}
async function ig(env, ruta, metodo = "GET", params = {}) {
  const t = await token(env);
  const u = new URL(G + ruta);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  u.searchParams.set("access_token", t);
  const r = await fetch(u, { method: metodo });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(`Instagram ${ruta}: ${j.error?.message || r.status}`);
  return j;
}

// ---------- IA ----------
let ultimoErrorIA = "";
async function modelos(env) {
  if (env.GEMINI_MODEL) return [env.GEMINI_MODEL];
  const g = await kvGet(env, "ig_modelos");
  if (g) return JSON.parse(g);
  const j = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", { headers: { "x-goog-api-key": env.GEMINI_KEY } }).then((r) => r.json()).catch(() => ({}));
  if (j.error) ultimoErrorIA = "Gemini: " + j.error.message;
  const lista = (j.models || []).filter((m) => /flash/i.test(m.name) && !/image|tts|audio|live|embedding|thinking/i.test(m.name) && (m.supportedGenerationMethods || []).includes("generateContent"))
    .map((m) => m.name.replace("models/", "")).sort((a, b) => (/preview|exp/.test(a) - /preview|exp/.test(b)) || b.localeCompare(a, undefined, { numeric: true })).slice(0, 5);
  if (lista.length) await kvPut(env, "ig_modelos", JSON.stringify(lista));
  return lista.length ? lista : ["gemini-flash-latest"];
}
async function iaJSON(env, prompt) {
  if (!env.GEMINI_KEY) { ultimoErrorIA = "falta la variable GEMINI_KEY en este worker"; return null; }
  for (const m of await modelos(env)) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, {
      method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_KEY },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: "application/json", temperature: 0.95 } }),
    }).catch((e) => ({ ok: false, json: async () => ({ error: { message: String(e) } }) }));
    const j = await r.json().catch(() => ({}));
    if (j.error) { ultimoErrorIA = `${m}: ${j.error.message}`; if (r.status === 404) await env.DB.prepare("DELETE FROM kv WHERE k = 'ig_modelos'").run(); continue; }
    const t = (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("");
    const m2 = t.match(/\{[\s\S]*\}/);
    if (m2) { try { return JSON.parse(m2[0]); } catch { ultimoErrorIA = m + ": respuesta mal formada"; } }
    else ultimoErrorIA = m + ": respuesta vacía";
  }
  return null;
}

// ---------- Junta comentarios sin responder ----------
async function pendientesDeResponder(env) {
  const yo = await ig(env, "/me", "GET", { fields: "user_id,username" });
  await kvPut(env, "ig_usuario", yo.username);
  const medias = (await ig(env, "/me/media", "GET", { fields: "id,caption,permalink,timestamp,comments_count", limit: String(CONFIG.publicaciones) })).data || [];
  const limite = Date.now() - CONFIG.diasMax * 86400e3;
  const vistos = new Set((await env.DB.prepare("SELECT id FROM ig_comentarios WHERE ts > ?").bind(limite - 86400e3).all()).results.map((x) => x.id));
  const out = [];
  for (const m of medias) {
    if (!m.comments_count || out.length >= CONFIG.porVuelta * 3) continue;
    let url = `/${m.id}/comments`, params = { fields: "id,text,username,from{id,username},timestamp,replies{username,from{username}}", limit: "100" };
    for (let pag = 0; pag < 3 && url && out.length < CONFIG.porVuelta * 3; pag++) {
      const r = await ig(env, url, "GET", params);
      for (const c0 of r.data || []) {
        const c = { ...c0, username: c0.username || c0.from?.username || "alguien" };
        if (!c.text || c.username === yo.username || Date.parse(c.timestamp) < limite) continue;
        if ((c.replies?.data || []).some((x) => (x.username || x.from?.username) === yo.username)) continue;   // ya le respondimos (a mano o el agente)
        if (vistos.has(c.id)) continue;
        out.push({ ...c, media: m.id, permalink: m.permalink, caption: String(m.caption || "").slice(0, 200) });
      }
      const sig = r.paging?.cursors?.after && r.paging?.next ? r.paging.cursors.after : null;
      if (out.length >= CONFIG.porVuelta * 3) break;
      if (!sig) break;
      params = { ...params, limit: "100", after: sig };
    }
  }
  return out.sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));   // primero los más nuevos (los que todavía están mirando el video)
}

// ---------- Una vuelta: arma respuestas y las publica ----------
async function vuelta(env, { forzarPrueba = false } = {}) {
  await tablas(env);
  const modo = forzarPrueba ? "prueba" : (env.IG_MODO || "prueba");
  const todos = await pendientesDeResponder(env);
  const lote = todos.slice(0, CONFIG.porVuelta);
  if (!lote.length) return { modo, sinResponder: 0, respuestas: [] };
  const previas = (await env.DB.prepare("SELECT respuesta FROM ig_comentarios WHERE respuesta <> '' ORDER BY ts DESC LIMIT 40").all()).results.map((x) => x.respuesta);
  const reglas = JSON.parse((await kvGet(env, "ig_reglas")) || "[]");
  const r = await iaJSON(env, `${ESTILO}${reglas.length ? "\nREGLAS QUE TE ENSEÑÓ EL EQUIPO (respetalas siempre):\n" + reglas.map((x, i) => `${i + 1}. ${x}`).join("\n") + "\n" : ""}
Respuestas que ya usaste (NO las repitas ni las imites): ${previas.join(" | ") || "(ninguna)"}

Clasificá y respondé cada comentario:
- "interes": pregunta precio, cómo funciona, si traen algo, "info", "quiero", etiqueta a alguien diciendo que le interesa → respuesta invitando al DM.
- "elogio": felicita, emojis de fuego/aplausos, "buenísimo" → agradecé corto y variado (podés sumar la invitación al DM o no).
- "etiqueta": solo menciona a otra persona sin decir nada → respuesta muy corta y amistosa, o null si no aporta.
- "revisar": queja, insulto, acusación de estafa, crítica, tema delicado, pregunta técnica que necesita una persona, o algo que no entendés → respuesta null (lo ve el equipo).
- "spam": publicidad, bots, links raros → respuesta null.
Respondé SOLO JSON: {"items":[{"id":"...","tipo":"interes|elogio|etiqueta|revisar|spam","respuesta":"texto o null"}]}

COMENTARIOS:
${lote.map((c) => `id=${c.id} | @${c.username} | publicación: "${c.caption}" | comentario: "${String(c.text).slice(0, 300)}"`).join("\n")}`);
  if (!r) return { modo, sinResponder: todos.length, respuestas: [], error: "La IA no respondió → " + ultimoErrorIA };
  const items = new Map((r?.items || []).map((x) => [String(x.id), x]));
  const hechas = [], guardar = [];
  for (const [i, c] of lote.entries()) {
    const x = items.get(String(c.id));
    if (!x) continue;   // la IA no lo devolvió: queda para la próxima vuelta
    let estado = "salteado", resp = x.respuesta ? String(x.respuesta).trim().toLowerCase().replace(/[.]+$/, "").slice(0, 60) : "";
    if (x.tipo === "revisar") {
      estado = "revisar";
      if (modo === "auto") await crearTarea(env, { tipo: "ig_revisar", tel: "ig:" + c.username, nombre: "@" + c.username, titulo: "Comentario de Instagram para responder vos", detalle: `"${c.text}"\n\nPublicación: ${c.permalink}`, datos: { link: c.permalink } });
    } else if (resp && x.tipo !== "spam") {
      if (modo === "auto") {
        if (hechas.length) await dormir(azar(CONFIG.pausaMin, CONFIG.pausaMax) * 1000);
        try { await ig(env, `/${c.id}/replies`, "POST", { message: resp }); estado = "respondido"; }
        catch (e) { estado = "error"; console.log("No se pudo responder", c.id, String(e)); }
      } else estado = "borrador";
    }
    // En modo prueba no se guarda nada: así, al pasar a "auto", se responden de verdad
    if (modo === "auto") {
      guardar.push(env.DB.prepare("INSERT INTO ig_comentarios (id, media, permalink, usuario, texto, respuesta, tipo, estado, ts, respondido) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET respuesta = excluded.respuesta, tipo = excluded.tipo, estado = excluded.estado, respondido = excluded.respondido")
        .bind(c.id, c.media, c.permalink, c.username, String(c.text).slice(0, 500), resp, x.tipo, estado, Date.parse(c.timestamp) || Date.now(), estado === "respondido" ? Date.now() : null));
      if (estado === "respondido") guardar.push(env.DB.prepare("INSERT INTO eventos (ts, tipo, tel, dato) VALUES (?,?,?,?)").bind(Date.now(), "ig_respuesta", "ig:" + c.username, x.tipo));
    }
    hechas.push({ usuario: "@" + c.username, comentario: c.text, tipo: x.tipo, respuesta: resp || "(no responde)", estado });
  }
  if (guardar.length) await env.DB.batch(guardar);
  return { modo, sinResponder: todos.length, respuestas: hechas };
}

async function crearTarea(env, t) {
  const ya = await env.DB.prepare("SELECT id FROM tareas WHERE tel = ? AND tipo = ? AND estado = 'abierta'").bind(t.tel, t.tipo).first();
  if (ya) return env.DB.prepare("UPDATE tareas SET ts = ?, detalle = detalle || ? WHERE id = ?").bind(Date.now(), "\n\n———\n\n" + t.detalle, ya.id).run();
  await env.DB.prepare("INSERT INTO tareas (id, ts, tipo, tel, nombre, titulo, detalle, datos, ref, estado) VALUES (?,?,?,?,?,?,?,?,?,'abierta')")
    .bind(Date.now().toString(36) + Math.random().toString(36).slice(2, 6), Date.now(), t.tipo, t.tel, t.nombre, t.titulo, t.detalle, JSON.stringify(t.datos || {}), "").run();
}

// ---------- Entrada ----------
const texto = (t, s = 200) => new Response(typeof t === "string" ? t : JSON.stringify(t, null, 2), { status: s, headers: { "Content-Type": "text/plain; charset=utf-8" } });
export default {
  async scheduled(ev, env, ctx) {
    ctx.waitUntil((async () => {
      try {
        if ((await env.DB.prepare("SELECT v FROM kv WHERE k = 'ig_pausa'").first().catch(() => null))?.v === "si") return;
        const r = await vuelta(env);
        console.log(`Instagram (${r.modo}): ${r.respuestas.length} procesados, quedaban ${r.sinResponder}`);
      } catch (e) { console.log("Error Instagram:", e?.stack || e); }
    })());
  },
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.searchParams.get("clave") !== env.VERIFY_TOKEN) return texto("Agente de Instagram activo. Para usarlo agregá ?clave=", 401);
    await tablas(env);
    try {
      if (url.pathname === "/estado") {
        const yo = await ig(env, "/me", "GET", { fields: "user_id,username,followers_count,media_count" });
        const n = await env.DB.prepare("SELECT estado, COUNT(*) n FROM ig_comentarios GROUP BY estado").all();
        return texto(`✅ Conectado a @${yo.username} (${yo.followers_count ?? "?"} seguidores, ${yo.media_count ?? "?"} publicaciones)\nModo: ${env.IG_MODO || "prueba"}${(await kvGet(env, "ig_pausa")) === "si" ? " (PAUSADO)" : ""}\n\nHistorial: ${n.results.map((x) => `${x.estado} ${x.n}`).join(", ") || "todavía nada"}`);
      }
      if (url.pathname === "/prueba") {   // muestra lo que respondería, SIN publicar
        const r = await vuelta(env, { forzarPrueba: true });
        return texto(`MODO PRUEBA (no se publicó nada)\nComentarios leídos en esta vuelta: ${r.sinResponder} (responde de a ${CONFIG.porVuelta} cada 30 min)\n${r.error ? "\n❌ " + r.error + "\n" : ""}\n` + r.respuestas.map((x) => `${x.usuario}: "${x.comentario}"\n  → [${x.tipo}] ${x.respuesta}`).join("\n\n"));
      }
      if (url.pathname === "/correr") { const r = await vuelta(env); return texto(r); }
      if (url.pathname === "/pausa") { await kvPut(env, "ig_pausa", url.searchParams.get("si") === "no" ? "no" : "si"); return texto(url.searchParams.get("si") === "no" ? "▶️ Agente de Instagram reanudado" : "⏸️ Agente de Instagram pausado"); }
    } catch (e) { return texto("❌ " + (e?.message || e), 500); }
    return texto("Rutas: /estado · /prueba · /correr · /pausa (&si=no para reanudar) — siempre con ?clave=");
  },
};
