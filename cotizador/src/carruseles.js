// Creador de carruseles (Redes > Carruseles).
// 1) El agente propone ideas (métricas + WhatsApp). 2) Elegís una: arma la ESTRUCTURA (slide por slide, en texto) y la
// confirmás. 3) Hace los SLIDES con el estilo ganador (fondo crema, letra manuscrita azul): los ves como imagen.
// 4) Los aprobás → el worker de Instagram los publica a la hora elegida. Nada se publica sin aprobación.
// Las cuentas (diferencia, total) las hace el código con los datos que cargás, nunca la IA.
// Las imágenes se dibujan en el navegador (canvas) y se guardan en R2 (mismo bucket y tope que los videos).
import { datosWhatsApp, prepararRedes } from "./redes.js";
import { espacioUsado, VIDEOS } from "./videos.js";

// Copia idéntica en instagram/src/publicar.js (la simulación verifica que sean iguales)
export const ESQUEMA_CARR = [
  "CREATE TABLE IF NOT EXISTS ig_carruseles (id TEXT PRIMARY KEY, ts INTEGER, estado TEXT, titulo TEXT, angulo TEXT, por_que TEXT, producto TEXT, datos TEXT, slides TEXT, caption TEXT, chat TEXT, n_slides INTEGER DEFAULT 0, programado_ts INTEGER, token TEXT, contenedor TEXT, media_id TEXT, link TEXT, error TEXT, aprobado_por TEXT, publicado_ts INTEGER, borrado INTEGER DEFAULT 0)",
  "CREATE INDEX IF NOT EXISTS ig_carruseles_estado ON ig_carruseles(estado, programado_ts)",
  "CREATE INDEX IF NOT EXISTS ig_carruseles_token ON ig_carruseles(token)",
];
export const CARR = { horaAR: 12, maxSlides: 10, maxFoto: 8 * 1024 ** 2, borrarPublicadosDias: 3 };
const AR = 3 * 3600e3;
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
const nuevoId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const kvGet = async (env, k) => (await env.DB.prepare("SELECT v FROM kv WHERE k=?").bind(k).first())?.v ?? null;
const kvPut = (env, k, v) => env.DB.prepare("INSERT INTO kv (k,v,exp) VALUES (?,?,NULL) ON CONFLICT(k) DO UPDATE SET v=excluded.v, exp=NULL").bind(k, String(v)).run();
const PROHIBIDO = /\b(vapes?|vapers?|vapeador|pods? desechables?|tabaco|nicotina|medicamentos?|f[aá]rmacos?|drogas?|armas?|r[eé]plicas?|millonari[oa]s?|stock disponible|env[ií]o gratis)\b/i;
const NEGOCIO = `"Te Importamos" (Rosario): importación por encargo, nos encargamos de todo (proveedor, aduana, envío). Sin stock: todo por encargo. Tarifa China: honorarios USD 80 + handling USD 30 + flete aéreo USD 18/kg + impuestos aprox. 30%; aéreo 10 a 15 días. Mínimos: tecnología/bazar 5 u., ropa 10 u., zapatillas 3 pares; cupos compartidos. NUNCA: vapes, tabaco, fármacos, réplicas; no prometer ganancias ni "hacerse millonario", ni envío gratis, ni "tenemos stock". Tono rioplatense, cercano, frases cortas.`;

// ---------- Tipos de slide (del carrusel que mejor funcionó) ----------
export const TIPOS_SLIDE = {
  portada: { nombre: "Portada con foto", campos: ["titulo", "subtitulo"], foto: true },
  captura: { nombre: "Texto + captura", campos: ["arriba", "abajo"], foto: true },
  numero: { nombre: "Número grande", campos: ["arriba", "numero", "abajo"] },
  suma: { nombre: "Suma con total", campos: ["titulo", "items", "total"] },
  barras: { nombre: "Comparación en barras", campos: ["titulo", "a_label", "a_valor", "b_label", "b_valor", "conclusion"] },
  texto: { nombre: "Título y párrafos", campos: ["titulo", "parrafos"] },
  multiplicacion: { nombre: "Multiplicación", campos: ["arriba", "linea", "numero", "abajo"] },
  lista: { nombre: "Lista numerada", campos: ["titulo", "items"] },
  cta: { nombre: "Cierre (comentá)", campos: ["texto", "palabra", "abajo"] },
};
const LISTAS = new Set(["items", "parrafos"]);
// El carrusel ganador (54 me gusta, el mejor de 4 o 5 estilos), como ejemplo para la IA
const EJEMPLO = [
  { tipo: "portada", titulo: "En MercadoLibre sale {precio_ml}.", subtitulo: "¿Cuánto cuesta traerlo de China?" },
  { tipo: "captura", arriba: "Y se vende. Mucho.", abajo: "Más vendido. +100 ventas. 4,8 estrellas." },
  { tipo: "numero", arriba: "Traído de China, puesto en Argentina:", numero: "{costo}", abajo: "Con flete, impuestos y todo incluido." },
  { tipo: "suma", titulo: "¿Qué incluye ese precio?", items: ["El producto en la fábrica", "El flete hasta Argentina", "Los impuestos de importación", "La gestión en Aduana"], total: "= {costo} por unidad" },
  { tipo: "barras", titulo: "La diferencia", a_label: "Importado", a_valor: "{costo}", b_label: "En MercadoLibre", b_valor: "{precio_ml}", conclusion: "{diferencia} de diferencia por cada unidad." },
  { tipo: "texto", titulo: "Ojo con algo.", parrafos: ["En MercadoLibre pagás comisión y envío.", "Restalos antes de calcular tu ganancia.", "Aun así, la diferencia sigue siendo grande."] },
  { tipo: "multiplicacion", arriba: "Ahora multiplicalo.", linea: "{cantidad} unidades × {diferencia}", numero: "{total}", abajo: "de diferencia en un solo lote." },
  { tipo: "texto", titulo: "Un dato más.", parrafos: ["Cuantas más unidades traés, más barato te sale cada una.", "El flete y la gestión se reparten entre todo el lote."] },
  { tipo: "lista", titulo: "Antes de importar:", items: ["Buscá en ML qué se vende.", "Anotá a cuánto se vende.", "Pedí la cotización puesta acá.", "Compará y decidí."] },
  { tipo: "cta", texto: "¿Querés saber cuánto te cuesta traer tu producto?", palabra: "COSTO", abajo: "y te lo cotizo puesto en Argentina." },
];

export function limpiarSlides(slides) {
  const out = [];
  for (const s of Array.isArray(slides) ? slides : []) {
    const t = TIPOS_SLIDE[s?.tipo];
    if (!t) continue;
    const x = { tipo: s.tipo };
    for (const c of t.campos) {
      if (LISTAS.has(c)) x[c] = (Array.isArray(s[c]) ? s[c] : String(s[c] || "").split("\n")).map((v) => String(v).trim().slice(0, 160)).filter(Boolean).slice(0, 6);
      else x[c] = String(s[c] ?? "").trim().slice(0, c === "palabra" ? 24 : 220);
    }
    out.push(x);
    if (out.length >= CARR.maxSlides) break;
  }
  return out;
}
export function limpiarDatos(d = {}, previo = {}) {
  const num = (v) => { const n = Number(String(v ?? "").replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", ".")); return Number.isFinite(n) && n > 0 ? Math.round(n) : null; };
  return {
    producto: String(d.producto ?? previo.producto ?? "").slice(0, 80),
    precio_ml: d.precio_ml !== undefined ? num(d.precio_ml) : previo.precio_ml ?? null,
    costo: d.costo !== undefined ? num(d.costo) : previo.costo ?? null,
    cantidad: d.cantidad !== undefined ? num(d.cantidad) : previo.cantidad ?? null,
    fotos: { ...(previo.fotos || {}), ...(d.fotos || {}) },
  };
}
// Las cuentas: siempre en código
export function calcularDatos(d = {}) {
  const dif = d.precio_ml && d.costo ? d.precio_ml - d.costo : null;
  return { ...d, diferencia: dif, total: dif != null && d.cantidad ? dif * d.cantidad : null };
}
const pesos = (n) => (n == null ? null : "$" + Math.round(n).toLocaleString("es-AR"));
export function rellenar(texto, d) {
  const c = calcularDatos(d);
  const v = { producto: c.producto || "", precio_ml: pesos(c.precio_ml), costo: pesos(c.costo), diferencia: pesos(c.diferencia), total: pesos(c.total), cantidad: c.cantidad ? String(c.cantidad) : null };
  return String(texto || "").replace(/\{(producto|precio_ml|costo|diferencia|total|cantidad)\}/g, (m, k) => v[k] ?? "[" + k.replace("_", " ") + "]");
}

const listos = new WeakSet();
export async function prepararCarr(env) {
  if (listos.has(env.DB)) return;
  await prepararRedes(env);
  await env.DB.batch(ESQUEMA_CARR.map((s) => env.DB.prepare(s)));
  listos.add(env.DB);
}
const reglas = async (env) => JSON.parse((await kvGet(env, "ig_reglas_carrusel")) || "[]");
const leer = (c) => c && { ...c, datos: JSON.parse(c.datos || "{}"), slides: JSON.parse(c.slides || "[]"), chat: JSON.parse(c.chat || "[]") };

async function rendimiento(env) {
  const q = async (sql, ...b) => { try { return (await env.DB.prepare(sql).bind(...b).all()).results || []; } catch { return []; } };
  const propios = await q("SELECT c.titulo, c.angulo, p.alcance, p.guardados, p.compartidos, p.comentarios FROM ig_carruseles c JOIN ig_posts p ON p.id = c.media_id WHERE c.estado='publicado' ORDER BY c.publicado_ts DESC LIMIT 15");
  const todos = await q("SELECT ts, texto, alcance, guardados, compartidos, comentarios FROM ig_posts WHERE media='CAROUSEL_ALBUM' AND ts > ? ORDER BY ts DESC LIMIT 15", Date.now() - 90 * 86400e3);
  return `CARRUSELES HECHOS CON ESTE CREADOR: ${propios.map((x) => `"${x.titulo}" (${x.angulo}): alcance ${x.alcance ?? "-"}, guardados ${x.guardados ?? "-"}, compartidos ${x.compartidos ?? "-"}, comentarios ${x.comentarios ?? "-"}`).join(" | ") || "ninguno todavía"}
CARRUSELES DE LA CUENTA (90 días): ${todos.map((x) => `alcance ${x.alcance ?? "-"}, guardados ${x.guardados ?? "-"}, comentarios ${x.comentarios ?? "-"}${x.texto ? `, texto "${String(x.texto).slice(0, 60)}"` : ""}`).join(" | ") || "sin datos"}
EL ESTILO QUE MEJOR FUNCIONÓ (de 4 o 5 probados): comparación "En MercadoLibre sale $X, ¿cuánto cuesta traerlo de China?" con números reales, la diferencia por unidad y por lote, y cierre "Comentá COSTO".`;
}

// ---------- Ideas ----------
export async function generarIdeasCarrusel(env, iaJSON, { T, quien = "panel", cantidad = 5 } = {}) {
  await prepararCarr(env);
  const w = await datosWhatsApp(env, T);
  const previas = (await env.DB.prepare("SELECT titulo, producto, angulo, estado FROM ig_carruseles WHERE ts > ? ORDER BY ts DESC LIMIT 40").bind(Date.now() - 45 * 86400e3).all()).results || [];
  const rg = await reglas(env);
  const r = await iaJSON(env, `Sos quien arma los CARRUSELES de Instagram de este negocio:
${NEGOCIO}
Proponé ${cantidad} ideas de carrusel. La mayoría (al menos 3) con el estilo ganador: un producto concreto que la gente busca, comparando lo que sale en MercadoLibre contra lo que cuesta traerlo. Las otras pueden ser otros ángulos (errores al importar, cómo funciona un cupo, qué incluye el precio), siempre con números o pasos concretos.
${await rendimiento(env)}
LO QUE PASA EN EL WHATSAPP (datos reales):
COTIZACIONES ARMADAS: ${w.cotizaciones.map((c) => c.items.map((i) => `${i.cantidad} × ${i.nombre}`).join(" + ") + (c.total ? ` = USD ${c.total}` : "")).join(" | ") || "ninguna"}
PRODUCTOS COTIZADOS POR CHAT: ${w.cotizados.map((x) => `${x.producto} (${x.n})`).join(", ") || "sin datos"}
LO MÁS CONSULTADO (14 días): ${w.demanda14.map((x) => `${x.producto} (${x.n})`).join(", ") || "sin datos"}
REGLAS QUE TE ENSEÑÓ EL DUEÑO: ${rg.map((x, i) => `${i + 1}. ${x}`).join(" ") || "ninguna"}
IDEAS YA PROPUESTAS (no repitas el mismo producto ni el mismo ángulo): ${previas.map((x) => `${x.titulo} [${x.estado}]`).join(" | ") || "ninguna"}
Respondé SOLO JSON: {"ideas":[{"titulo":"...","producto":"... o vacío","angulo":"comparacion_ml|errores|como_funciona|que_incluye|caso_real|otro","por_que":"el dato concreto en el que te basás, con número"}]}`);
  const ya = new Set(previas.map((x) => (x.producto || x.titulo).toLowerCase()));
  const ideas = (r?.ideas || []).filter((x) => x?.titulo && !PROHIBIDO.test(JSON.stringify(x)) && !ya.has(String(x.producto || x.titulo).toLowerCase())).slice(0, cantidad);
  if (!ideas.length) return { ok: false, error: r ? "No salieron ideas nuevas." : "La IA no respondió. Probá de nuevo en un minuto." };
  await env.DB.batch(ideas.map((x) => env.DB.prepare("INSERT INTO ig_carruseles (id, ts, estado, titulo, angulo, por_que, producto, datos, slides, caption, chat) VALUES (?,?,'idea',?,?,?,?,?,'[]','','[]')")
    .bind(nuevoId(), Date.now(), String(x.titulo).slice(0, 140), String(x.angulo || "otro").slice(0, 30), String(x.por_que || "").slice(0, 300), String(x.producto || "").slice(0, 80), JSON.stringify({ producto: String(x.producto || "").slice(0, 80) }))));
  return { ok: true, cantidad: ideas.length };
}

// ---------- Estructura ----------
const AYUDA_TIPOS = Object.entries(TIPOS_SLIDE).map(([k, v]) => `"${k}" (${v.nombre}: ${v.campos.join(", ")}${v.foto ? ", lleva foto" : ""})`).join("; ");
export async function armarEstructura(env, iaJSON, c, T) {
  const w = await datosWhatsApp(env, T);
  const rg = await reglas(env);
  const r = await iaJSON(env, `Armá la ESTRUCTURA de un carrusel de Instagram (todavía no el diseño). Negocio:
${NEGOCIO}
IDEA: "${c.titulo}" · producto: ${c.producto || "-"} · ángulo: ${c.angulo} · por qué: ${c.por_que}
Tipos de slide disponibles: ${AYUDA_TIPOS}.
Para precios y cuentas usá SOLO estas marcas, que el sistema reemplaza con los datos reales: {precio_ml} {costo} {diferencia} {cantidad} {total} {producto}. NUNCA escribas un precio con números.
Ejemplo del carrusel que mejor funcionó (copiá el ritmo, la longitud de los textos y el tono; no el contenido si el ángulo es otro):
${JSON.stringify(EJEMPLO)}
Reglas: entre 7 y 10 slides; la primera con gancho fuerte; la última siempre "cta" con una palabra para comentar; textos cortos, como habla la gente en Rosario, sin emojis.
REGLAS QUE TE ENSEÑÓ EL DUEÑO (respetalas siempre): ${rg.map((x, i) => `${i + 1}. ${x}`).join(" ") || "ninguna"}
Datos de WhatsApp por si sirven: cotizaciones ${w.cotizaciones.map((q) => q.items.map((i) => i.nombre).join(" + ")).join(" | ") || "ninguna"}.
También escribí el texto del posteo ("caption"): 2 o 3 frases + la invitación a comentar la palabra + 3 hashtags. Sin precios con números.
Respondé SOLO JSON: {"slides":[...],"caption":"..."}`);
  const slides = limpiarSlides(r?.slides);
  if (slides.length < 3) return { ok: false, error: "La IA no armó una estructura válida. Probá de nuevo." };
  if (PROHIBIDO.test(JSON.stringify(slides) + (r.caption || ""))) return { ok: false, error: "La estructura tenía algo que no publicamos. Probá de nuevo." };
  return { ok: true, slides, caption: String(r.caption || "").slice(0, 2200) };
}

// ---------- Chat dentro del carrusel ----------
export async function chatCarrusel(env, iaJSON, c, mensaje) {
  const rg = await reglas(env);
  const datos = calcularDatos(c.datos);
  const r = await iaJSON(env, `Sos el agente de redes de "Te Importamos" y estás ajustando un carrusel con el dueño. Fase: ${c.estado === "slides" ? "slides (ya diseñados)" : "estructura"}.
${NEGOCIO}
Tipos de slide: ${AYUDA_TIPOS}. Para precios usá las marcas {precio_ml} {costo} {diferencia} {cantidad} {total} {producto}; nunca números de precio.
DATOS CARGADOS: ${JSON.stringify({ producto: datos.producto, precio_ml: datos.precio_ml, costo: datos.costo, cantidad: datos.cantidad, diferencia: datos.diferencia, total: datos.total })}
SLIDES ACTUALES (numerados desde 1): ${JSON.stringify(c.slides)}
TEXTO DEL POSTEO: ${JSON.stringify(c.caption || "")}
REGLAS QUE YA SABÉS: ${rg.map((x, i) => `${i + 1}. ${x}`).join(" ") || "ninguna"}
CHARLA PREVIA: ${c.chat.slice(-8).map((m) => `${m.r === "u" ? "DUEÑO" : "VOS"}: ${m.t}`).join(" | ") || "-"}
EL DUEÑO DICE: "${String(mensaje).slice(0, 800)}"
Hacé lo que pide. Si cambia slides, devolvé TODOS los slides (completos, en orden). Si pide cambiar los datos (precio, costo, cantidad), devolvelos en "datos" con números.
Si lo que dice es una preferencia para SIEMPRE (ej. "nunca pongas...", "siempre...", "me gusta más que..."), devolvela en "regla" en una frase corta; si es solo para este carrusel, "regla" vacío.
Respondé SOLO JSON: {"respuesta":"corta, qué cambiaste","slides":[...] o null,"caption":"..." o null,"datos":{...} o null,"regla":"..." o ""}`);
  if (!r) return { ok: false, error: "La IA no respondió. Probá de nuevo." };
  const cambios = {};
  if (Array.isArray(r.slides)) { const s = limpiarSlides(r.slides); if (s.length >= 3 && !PROHIBIDO.test(JSON.stringify(s))) cambios.slides = s; }
  if (typeof r.caption === "string" && r.caption.trim() && !PROHIBIDO.test(r.caption)) cambios.caption = r.caption.slice(0, 2200);
  if (r.datos && typeof r.datos === "object") cambios.datos = limpiarDatos(r.datos, c.datos);
  let regla = "";
  if (r.regla && String(r.regla).trim().length > 5) {
    regla = String(r.regla).trim().slice(0, 200);
    const l = rg.filter((x) => x.toLowerCase() !== regla.toLowerCase()).concat(regla).slice(-40);
    await kvPut(env, "ig_reglas_carrusel", JSON.stringify(l));
  }
  return { ok: true, respuesta: String(r.respuesta || "Listo.").slice(0, 600), regla, ...cambios };
}

// ---------- Horarios: un carrusel por día a las 12 h ----------
export async function proximoHorarioCarr(env, ahora = Date.now()) {
  const ocupados = new Set(((await env.DB.prepare("SELECT programado_ts FROM ig_carruseles WHERE estado IN ('aprobado','publicando','publicado') AND programado_ts >= ?").bind(ahora - 86400e3).all()).results || [])
    .map((x) => new Date(x.programado_ts - AR).toISOString().slice(0, 10)));
  const d = new Date(ahora - AR);
  let dia = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  if (d.getUTCHours() * 60 + d.getUTCMinutes() > CARR.horaAR * 60 - 15) dia += 86400e3;
  for (let i = 0; i < 365; i++, dia += 86400e3) if (!ocupados.has(new Date(dia).toISOString().slice(0, 10))) return dia + CARR.horaAR * 3600e3 + AR;
  return null;
}

async function borrarImagenes(env, id) {
  let cursor; const ks = [];
  do { const l = await env.VIDEOS.list({ prefix: `carruseles/${id}/`, cursor, limit: 1000 }); ks.push(...l.objects.map((o) => o.key)); cursor = l.truncated ? l.cursor : undefined; } while (cursor);
  for (let i = 0; i < ks.length; i += 900) await env.VIDEOS.delete(ks.slice(i, i + 900));
  return ks.length;
}
export async function limpiezaCarr(env, ahora = Date.now()) {
  if (!env.VIDEOS) return 0;
  await prepararCarr(env);
  const l = (await env.DB.prepare("SELECT id FROM ig_carruseles WHERE borrado=0 AND ((estado='publicado' AND publicado_ts < ?) OR estado='descartado' OR (estado IN ('idea','estructura','slides') AND ts < ?))").bind(ahora - CARR.borrarPublicadosDias * 86400e3, ahora - 30 * 86400e3).all()).results || [];
  for (const c of l) { await borrarImagenes(env, c.id); await env.DB.prepare("UPDATE ig_carruseles SET borrado=1 WHERE id=?").bind(c.id).run(); }
  return l.length;
}

async function servir(env, req, key) {
  const o = await env.VIDEOS.get(key);
  if (!o) return new Response("No existe", { status: 404 });
  return new Response(o.body, { headers: { "Content-Type": o.httpMetadata?.contentType || "image/jpeg", "Cache-Control": "private, max-age=600" } });
}

// ---------- API del panel (/panel/api/carruseles/...) ----------
export async function apiCarruseles(env, req, url, quien, iaJSON, T = null) {
  if (!env.VIDEOS) return json({ error: "Falta conectar el bucket (R2) al panel." }, 500);
  await prepararCarr(env);
  const r = url.pathname.replace("/panel/api/carruseles/", "");
  const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
  const id = String(body.id || url.searchParams.get("id") || "");
  const uno = async () => leer(await env.DB.prepare("SELECT * FROM ig_carruseles WHERE id=?").bind(id).first());
  const guardar = (c, cambios) => {
    const campos = Object.keys(cambios);
    if (!campos.length) return;
    return env.DB.prepare(`UPDATE ig_carruseles SET ${campos.map((k) => k + "=?").join(", ")} WHERE id=?`).bind(...campos.map((k) => (typeof cambios[k] === "object" && cambios[k] !== null ? JSON.stringify(cambios[k]) : cambios[k])), c.id).run();
  };
  if (r === "lista") {
    const l = (await env.DB.prepare("SELECT id, ts, estado, titulo, angulo, por_que, producto, n_slides, programado_ts, link, error, publicado_ts FROM ig_carruseles WHERE estado <> 'descartado' AND ts > ? ORDER BY ts DESC LIMIT 60").bind(Date.now() - 60 * 86400e3).all()).results || [];
    const yo = JSON.parse((await kvGet(env, "ig_yo")) || "{}");
    return json({ carruseles: l, reglas: await reglas(env), usuario: yo.username || "te.importamos.arg", tipos: TIPOS_SLIDE });
  }
  if (r === "logo") {
    let o = await env.VIDEOS.get("marca/perfil.jpg");
    if (!o) {
      const foto = JSON.parse((await kvGet(env, "ig_yo")) || "{}").foto;
      const f = foto ? await fetch(foto).catch(() => null) : null;
      if (!f?.ok) return new Response("Sin foto de perfil todavía", { status: 404 });
      await env.VIDEOS.put("marca/perfil.jpg", await f.arrayBuffer(), { httpMetadata: { contentType: "image/jpeg" } });
      o = await env.VIDEOS.get("marca/perfil.jpg");
    }
    return new Response(o.body, { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=86400" } });
  }
  if (r === "img") {
    const key = url.searchParams.get("key") || "";
    if (!/^carruseles\/[a-z0-9]+\/(foto|slide)-\d+\.(jpg|png|webp)$/.test(key)) return new Response("clave inválida", { status: 400 });
    return servir(env, req, key);
  }
  if (r === "generar-ideas" && req.method === "POST") return json(await generarIdeasCarrusel(env, iaJSON, { T, quien }));
  if (r === "regla-borrar" && req.method === "POST") {
    const l = (await reglas(env)).filter((_, i) => i !== +body.i);
    await kvPut(env, "ig_reglas_carrusel", JSON.stringify(l));
    return json({ ok: true, reglas: l });
  }
  const c = await uno();
  if (!c) return json({ error: "carrusel desconocido" }, 404);
  if (r === "ver") return json(c);
  if (r === "estructura" && req.method === "POST") {
    if (!["idea", "estructura"].includes(c.estado)) return json({ error: "Ese carrusel ya tiene slides" }, 400);
    const e = await armarEstructura(env, iaJSON, c, T);
    if (!e.ok) return json(e);
    const chat = c.chat.concat({ r: "a", t: "Te armé la estructura. Revisala, cargá los números reales arriba y decime qué cambiar. Cuando te cierre, tocá \"Confirmar estructura\"." });
    await guardar(c, { estado: "estructura", slides: e.slides, caption: e.caption, chat });
    return json({ ok: true, ...(await uno()) });
  }
  if (r === "guardar" && req.method === "POST") {
    if (!["idea", "estructura", "slides", "error"].includes(c.estado)) return json({ error: "Ya está aprobado: frenalo primero para editarlo" }, 400);
    const cambios = {};
    if (body.slides) { const s = limpiarSlides(body.slides); if (s.length) cambios.slides = s; }
    if (body.datos) cambios.datos = limpiarDatos(body.datos, c.datos);
    if (typeof body.caption === "string") cambios.caption = body.caption.slice(0, 2200);
    await guardar(c, cambios);
    return json({ ok: true, ...(await uno()) });
  }
  if (r === "chat" && req.method === "POST") {
    if (!["estructura", "slides", "error"].includes(c.estado)) return json({ error: "Primero armá la estructura" }, 400);
    const m = String(body.mensaje || "").trim();
    if (!m) return json({ error: "Escribí algo" }, 400);
    const res = await chatCarrusel(env, iaJSON, c, m);
    if (!res.ok) return json(res);
    const chat = c.chat.concat({ r: "u", t: m.slice(0, 800) }, { r: "a", t: res.respuesta + (res.regla ? `\n(Lo guardo para los próximos: "${res.regla}")` : "") }).slice(-40);
    await guardar(c, { chat, ...(res.slides ? { slides: res.slides } : {}), ...(res.caption ? { caption: res.caption } : {}), ...(res.datos ? { datos: res.datos } : {}) });
    return json({ ok: true, regla: res.regla, ...(await uno()) });
  }
  if (r === "fase" && req.method === "POST") {
    const a = body.a;
    if (a === "slides") {
      if (c.estado !== "estructura") return json({ error: "Primero armá la estructura" }, 400);
      await guardar(c, { estado: "slides", chat: c.chat.concat({ r: "a", t: "Listo, hice los slides. Si hay un slide con foto, subila. Pedime cambios acá: \"en el slide 3 ...\"." }) });
    } else if (a === "estructura") {
      if (c.estado !== "slides") return json({ error: "No se puede volver" }, 400);
      await guardar(c, { estado: "estructura" });
    } else return json({ error: "fase inválida" }, 400);
    return json({ ok: true, ...(await uno()) });
  }
  if (r === "foto" && req.method === "PUT") {
    const n = +url.searchParams.get("n");
    if (!(n >= 0 && n < CARR.maxSlides)) return json({ error: "slide inválido" }, 400);
    const largo = +req.headers.get("content-length") || 0, tipo = req.headers.get("content-type") || "image/jpeg";
    if (!/^image\/(jpeg|png|webp)$/.test(tipo)) return json({ error: "Subí una imagen JPG, PNG o WEBP" }, 400);
    if (largo > CARR.maxFoto) return json({ error: "La imagen pesa más de 8 MB" }, 400);
    if ((await espacioUsado(env)) + largo > VIDEOS.tope) return json({ error: "No hay lugar en el depósito" }, 507);
    const key = `carruseles/${c.id}/foto-${n}.${tipo.split("/")[1].replace("jpeg", "jpg")}`;
    await env.VIDEOS.put(key, req.body, { httpMetadata: { contentType: tipo } });
    await guardar(c, { datos: limpiarDatos({ fotos: { [n]: key } }, c.datos) });
    return json({ ok: true, key });
  }
  if (r === "slide" && req.method === "PUT") {
    const n = +url.searchParams.get("n");
    if (c.estado !== "slides") return json({ error: "No está en la fase de slides" }, 400);
    if (!(n >= 0 && n < CARR.maxSlides)) return json({ error: "slide inválido" }, 400);
    if ((+req.headers.get("content-length") || 0) > CARR.maxFoto) return json({ error: "slide demasiado pesado" }, 400);
    await env.VIDEOS.put(`carruseles/${c.id}/slide-${n}.jpg`, req.body, { httpMetadata: { contentType: "image/jpeg" } });
    return json({ ok: true });
  }
  if (r === "aprobar" && req.method === "POST") {
    if (!["slides", "error"].includes(c.estado)) return json({ error: "Primero confirmá la estructura y mirá los slides" }, 400);
    const n = c.slides.length;
    if (n < 2) return json({ error: "Un carrusel necesita al menos 2 slides" }, 400);
    for (let i = 0; i < n; i++) if (!(await env.VIDEOS.head(`carruseles/${c.id}/slide-${i}.jpg`))) return json({ error: `Falta la imagen del slide ${i + 1}: volvé a tocar Aprobar` }, 400);
    const d = calcularDatos(c.datos);
    const texto = c.slides.map((s) => JSON.stringify(s)).join(" ");
    for (const k of ["precio_ml", "costo", "diferencia", "total", "cantidad"]) if (texto.includes("{" + k + "}") && d[k] == null) return json({ error: `Falta cargar ${k === "precio_ml" ? "el precio en MercadoLibre" : k === "costo" ? "el costo puesto" : k === "cantidad" ? "la cantidad" : "el precio y el costo"}` }, 400);
    for (let i = 0; i < n; i++) if (TIPOS_SLIDE[c.slides[i].tipo]?.foto && !c.datos.fotos?.[i]) return json({ error: `Falta la foto del slide ${i + 1}` }, 400);
    let cuando = +body.cuando || 0;
    if (!cuando || cuando < Date.now() + 5 * 60e3) cuando = await proximoHorarioCarr(env);
    const caption = typeof body.caption === "string" ? body.caption.slice(0, 2200) : c.caption;
    await guardar(c, { estado: "aprobado", n_slides: n, programado_ts: cuando, caption, aprobado_por: quien || "", error: null, contenedor: null, token: null });
    return json({ ok: true, programado_ts: cuando });
  }
  if (r === "sugerir-hora") return json({ ts: await proximoHorarioCarr(env) });
  if (r === "frenar" && req.method === "POST") {
    if (c.estado !== "aprobado") return json({ error: "Solo se puede frenar uno programado que no salió" }, 400);
    await guardar(c, { estado: "slides", programado_ts: null });
    return json({ ok: true, ...(await uno()) });
  }
  if (r === "descartar" && req.method === "POST") {
    if (["publicando", "publicado"].includes(c.estado)) return json({ error: "Ya está publicado" }, 400);
    await borrarImagenes(env, c.id);
    await guardar(c, { estado: "descartado", borrado: 1 });
    return json({ ok: true });
  }
  return json({ error: "ruta desconocida" }, 404);
}


// Limpieza diaria 4:12 (hora Argentina). La llama el cron de cada minuto del worker principal.
export async function cronCarr(env, scheduledTime = Date.now()) {
  if (!env.VIDEOS || !env.DB) return false;
  const t = new Date(scheduledTime - AR);
  if (t.getUTCHours() !== 4 || t.getUTCMinutes() !== 12) return false;
  await limpiezaCarr(env);
  return true;
}
