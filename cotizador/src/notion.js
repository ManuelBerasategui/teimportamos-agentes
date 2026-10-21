// Conexión con el Notion del dueño (su RPG: tareas, hábitos, eventos por categoría).
// Necesita el secreto NOTION_TOKEN en Cloudflare (integración interna de Notion) y compartir las páginas con esa integración.
// Se adapta solo a cómo están armadas sus bases: busca las bases compartidas y reconoce cuál es de tareas, hábitos y eventos
// y qué columna es el título, la fecha, el "hecho" y la categoría. El tiempo dedicado lo sigue cargando él a mano.

const kvGet = async (env, k) => (await env.DB.prepare("SELECT v FROM kv WHERE k=?").bind(k).first())?.v ?? null;
const kvPut = (env, k, v) => env.DB.prepare("INSERT INTO kv (k,v,exp) VALUES (?,?,NULL) ON CONFLICT(k) DO UPDATE SET v=excluded.v, exp=NULL").bind(k, String(v)).run();
const AR = 3 * 3600e3;
const hoyAR = () => new Date(Date.now() - AR).toISOString().slice(0, 10);
const norm = (t) => String(t || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

export const notionActivo = (env) => !!env.NOTION_TOKEN;

async function api(env, ruta, body, metodo) {
  const r = await fetch("https://api.notion.com/v1/" + ruta, {
    method: metodo || (body ? "POST" : "GET"),
    headers: { Authorization: "Bearer " + env.NOTION_TOKEN, "Notion-Version": "2022-06-28", "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(12000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error("Notion " + (j.message || r.status));
  return j;
}

const titulo = (db) => (db.title || []).map((t) => t.plain_text).join("") || "Sin nombre";
// Elige la columna de cada tipo, prefiriendo la que tiene un nombre que suena a lo que buscamos
function columna(props, tipos, ...preferidos) {
  const l = Object.entries(props).filter(([, p]) => tipos.includes(p.type));
  for (const re of preferidos) { const x = l.find(([n]) => re.test(norm(n))); if (x) return x[0]; }
  return (l[0] || [null])[0];
}
function mapear(db) {
  const p = db.properties || {};
  return {
    id: db.id, nombre: titulo(db),
    titulo: Object.entries(p).find(([, x]) => x.type === "title")?.[0] || null,
    fecha: columna(p, ["date"], /fin|vence|plazo|deadline/, /fecha|dia|date|cuando/),
    fechaIni: columna(p, ["date"], /inicio|start|comienzo/, /fecha|dia|date|cuando/),
    relCat: columna(p, ["relation"], /habilidad|nivel|categor|area|skill/),
    esEvento: Object.entries(p).find(([n, x]) => x.type === "checkbox" && /evento/.test(norm(n)))?.[0] || null,
    duracion: Object.entries(p).find(([n, x]) => x.type === "number" && /durac|minut|tiempo/.test(norm(n)))?.[0] || null,
    completado: Object.entries(p).find(([n, x]) => x.type === "checkbox" && /complet|hecho|done/.test(norm(n)))?.[0] || null,
    hecho: columna(p, ["status"], /estado|status/) || columna(p, ["checkbox", "status"], /hecho|hecha|done|complet|listo/),
    tipoHecho: null,
    categoria: columna(p, ["select", "multi_select"], /categor|area|nivel|tipo|seccion|pilar/),
    tiempo: columna(p, ["number", "rich_text"], /tiempo|minutos|horas|duracion/),
    checks: Object.entries(p).filter(([, x]) => x.type === "checkbox").map(([n]) => n),   // en hábitos: una columna por hábito
    opcionesCat: (() => { const c = Object.values(p).find((x) => ["select", "multi_select"].includes(x.type)); return (c?.[c.type]?.options || []).map((o) => o.name); })(),
    columnas: Object.entries(p).map(([n, x]) => n + ":" + x.type),
    estados: (() => { const k = columna(p, ["status"], /estado|status/); return (p[k]?.status?.options || []).map((o) => o.name); })(),
  };
}

// Busca las bases compartidas con la integración y decide cuál es cuál
export async function descubrir(env) {
  const r = await api(env, "search", { filter: { property: "object", value: "database" }, page_size: 50 });
  const dbs = (r.results || []).map(mapear);
  for (const d of dbs) d.tipoHecho = d.hecho ? (Object.entries((r.results.find((x) => x.id === d.id) || {}).properties || {}).find(([n]) => n === d.hecho)?.[1]?.type || null) : null;
  const fijo = JSON.parse((await kvGet(env, "notion_roles")) || "{}");   // si el dueño dijo "tareas es la base X"
  const elegir = (re, rol) => (fijo[rol] && dbs.find((d) => norm(d.nombre) === norm(fijo[rol]))) || dbs.find((d) => re.test(norm(d.nombre))) || null;
  const mapa = {
    tareas: elegir(/tarea|task|to ?do|pendiente|mision|quest|proyecto|accion/, "tareas") ||
      // nombre genérico ("Base de Datos"): la que tiene título + fecha + casilla/estado, la que no sea de niveles o categorías
      dbs.filter((d) => d.titulo && d.fecha && d.hecho && !/nivel|categor|area|config/.test(norm(d.nombre))).sort((a, b) => b.columnas.length - a.columnas.length)[0] || null,
    habitos: elegir(/habito|habit|rutina|diario|tracker/, "habitos"),
    eventos: elegir(/evento|agenda|calendar|turno/, "eventos"),
    todas: dbs.map((d) => d.nombre),
    bases: dbs,
    ts: Date.now(),
  };
  await kvPut(env, "notion_mapa", JSON.stringify(mapa));
  return mapa;
}
async function mapa(env) {
  const m = JSON.parse((await kvGet(env, "notion_mapa")) || "null");
  if (m && Date.now() - m.ts < 24 * 3600e3) return m;
  return descubrir(env);
}

const texto = (prop) => {
  if (!prop) return "";
  if (prop.type === "title") return prop.title.map((t) => t.plain_text).join("");
  if (prop.type === "rich_text") return prop.rich_text.map((t) => t.plain_text).join("");
  if (prop.type === "select") return prop.select?.name || "";
  if (prop.type === "multi_select") return prop.multi_select.map((x) => x.name).join(", ");
  if (prop.type === "status") return prop.status?.name || "";
  if (prop.type === "date") return prop.date?.start || "";
  if (prop.type === "checkbox") return prop.checkbox ? "sí" : "no";
  if (prop.type === "number") return prop.number == null ? "" : String(prop.number);
  return "";
};
const hechoSi = (d, page) => {
  const p = page.properties?.[d.hecho]; if (!p) return false;
  if (p.type === "checkbox") return !!p.checkbox;
  if (p.type === "status") return /hech|done|complet|list|termin/i.test(norm(p.status?.name));
  return false;
};

// Lo de hoy en Notion: tareas abiertas (vencidas, de hoy o sin fecha), hábitos sin marcar y eventos de hoy
export async function notionHoy(env) {
  if (!notionActivo(env)) return null;
  const m = await mapa(env), hoy = hoyAR(), out = { tareas: [], habitos: [], eventos: [], bases: m.todas };
  if (m.tareas) {
    const T = m.tareas, ini = T.fechaIni || T.fecha, fin = T.fecha;
    // 1) lo de HOY (por fecha de inicio o de fin); 2) aparte, lo vencido de los últimos 7 días que sigue abierto (máx. 5)
    const deHoyF = [{ property: ini, date: { equals: hoy } }]; if (fin && fin !== ini) deHoyF.push({ property: fin, date: { equals: hoy } });
    const hace7 = new Date(Date.now() - AR - 7 * 86400e3).toISOString().slice(0, 10), hace21 = new Date(Date.now() - AR - 21 * 86400e3).toISOString().slice(0, 10), col = fin || ini;
    const [rh, rv] = await Promise.all([
      api(env, `databases/${T.id}/query`, { page_size: 100, filter: { or: deHoyF } }).catch(() => ({ results: [] })),
      api(env, `databases/${T.id}/query`, { page_size: 40, filter: { and: [{ property: col, date: { before: hoy } }, { property: col, date: { on_or_after: hace21 } }] }, sorts: [{ property: col, direction: "descending" }] }).catch(() => ({ results: [] })),
    ]);
    // lo que se repite (hábitos diarios, consultas de cada semana) no es "vencido": solo cuenta lo que aparece una vez en 3 semanas
    const veces = {}; for (const p of [...(rh.results || []), ...(rv.results || [])]) { const k = norm(texto(p.properties[T.titulo])); veces[k] = (veces[k] || 0) + 1; }
    const vence = (rv.results || []).filter((p) => !(rh.results || []).some((q) => q.id === p.id) && veces[norm(texto(p.properties[T.titulo]))] === 1 && String(p.properties[col]?.date?.start || "") >= hace7 && !(T.esEvento && p.properties[T.esEvento]?.checkbox));
    const r = { results: [...(rh.results || []), ...vence] };
    const niveles = await nombresRelacion(env, m);
    const faltan = new Set(); for (const p of r.results || []) for (const x of (T.relCat ? p.properties[T.relCat]?.relation || [] : [])) if (!niveles[x.id]) faltan.add(x.id);
    if (faltan.size) {
      for (const idp of [...faltan].slice(0, 15)) { const pg = await api(env, "pages/" + idp).catch(() => null); const tt = pg ? Object.values(pg.properties || {}).find((v) => v.type === "title") : null; if (tt) niveles[idp] = texto(tt); }
      await kvPut(env, "notion_niveles", JSON.stringify({ ts: Date.now(), m: niveles }));
    }
    out.hoy = [];
    for (const p of r.results || []) {
      const hecho = hechoSi(T, p) || (T.completado && p.properties[T.completado]?.checkbox === true);
      const fi = p.properties[ini]?.date?.start || "", ff = fin ? p.properties[fin]?.date?.start || "" : "";
      const deHoy = fi.slice(0, 10) === hoy || ff.slice(0, 10) === hoy;
      if (!deHoy && hecho) continue;   // vencidas solo si siguen abiertas
      const nom = texto(p.properties[T.titulo]); if (!nom.trim()) continue;
      if (!deHoy && (out.hoy.some((y) => !y.vencida && norm(y.texto) === norm(nom)) || out.hoy.filter((y) => y.vencida).length >= 5 || out.hoy.some((y) => y.vencida && norm(y.texto) === norm(nom)))) continue;   // los hábitos que se repiten cada día no cuentan como vencidos
      const cat = T.relCat ? (p.properties[T.relCat]?.relation || []).map((x) => niveles[x.id] || "").filter(Boolean).join(", ") : texto(p.properties[T.categoria]);
      out.hoy.push({ id: p.id, texto: texto(p.properties[T.titulo]), estado: texto(p.properties[T.hecho]) || (hecho ? "Hecho" : "Pendiente"), hecho, categoria: cat, hora: fi.length > 10 ? fi.slice(11, 16) : "", vencida: !deHoy, evento: T.esEvento ? !!p.properties[T.esEvento]?.checkbox : false, min: T.duracion ? p.properties[T.duracion]?.number ?? null : null });
    }
    out.tareas = out.hoy.filter((x) => !x.hecho && x.texto).map((x) => ({ ...x, fecha: x.vencida ? "vencida" : "hoy" }));
    out.eventos.push(...out.hoy.filter((x) => x.evento && !x.hecho).map((x) => ({ texto: x.texto, hora: x.hora })));
  }
  if (m.habitos) {
    const f = m.habitos.fecha ? { filter: { property: m.habitos.fecha, date: { equals: hoy } } } : {};
    let r = await api(env, `databases/${m.habitos.id}/query`, { page_size: 30, ...f }).catch(() => ({ results: [] }));
    if (!(r.results || []).length) r = await api(env, `databases/${m.habitos.id}/query`, { page_size: 1, sorts: [{ timestamp: "created_time", direction: "descending" }] }).catch(() => ({ results: [] }));   // la fila más nueva = hoy
    for (const p of r.results || []) {
      // dos formas comunes: una fila por día con una casilla por hábito, o una fila por hábito con su casilla de hecho
      const sinMarcar = m.habitos.checks.filter((c) => p.properties[c]?.checkbox === false);
      if (m.habitos.checks.length > 1) out.habitos.push(...sinMarcar.map((c) => ({ id: p.id, texto: c, col: c })));
      else if (!hechoSi(m.habitos, p)) out.habitos.push({ id: p.id, texto: texto(p.properties[m.habitos.titulo]), col: m.habitos.hecho });
    }
  }
  if (m.eventos && m.eventos.fecha) {
    const r = await api(env, `databases/${m.eventos.id}/query`, { page_size: 20, filter: { property: m.eventos.fecha, date: { equals: hoy } } }).catch(() => ({ results: [] }));
    out.eventos = (r.results || []).map((p) => ({ texto: texto(p.properties[m.eventos.titulo]), hora: String(p.properties[m.eventos.fecha]?.date?.start || "").slice(11, 16) })).filter((x) => x.texto);
  }
  const usadas = new Set([m.tareas?.id, m.habitos?.id, m.eventos?.id].filter(Boolean));
  out.otras = [];
  for (const d of (m.bases || []).filter((x) => !usadas.has(x.id)).slice(0, 6)) {
    const r = await api(env, `databases/${d.id}/query`, { page_size: 12, sorts: [{ timestamp: "last_edited_time", direction: "descending" }] }).catch(() => ({ results: [] }));
    const filas = (r.results || []).map((p) => Object.entries(p.properties || {}).map(([n, v]) => [n, texto(v)]).filter(([, v]) => v).slice(0, 6).map(([n, v]) => (v === texto(p.properties[d.titulo]) ? v : n + ": " + v)).join(" · ")).filter(Boolean);
    if (filas.length) out.otras.push({ base: d.nombre, filas });
  }
  return out;
}

// Nombres de las páginas a las que apunta la relación de categoría (ej. Habilidad → Niveles: Trabajo, Estudios, Ejercicio...)
async function nombresRelacion(env, m) {
  const c = JSON.parse((await kvGet(env, "notion_niveles")) || "null");
  if (c && Date.now() - c.ts < 24 * 3600e3) return c.m;
  const out = {};
  for (const d of (m.bases || []).filter((x) => x.id !== m.tareas?.id)) {
    const r = await api(env, `databases/${d.id}/query`, { page_size: 100 }).catch(() => ({ results: [] }));
    for (const p of r.results || []) out[p.id] = texto(p.properties[d.titulo]);
  }
  await kvPut(env, "notion_niveles", JSON.stringify({ ts: Date.now(), m: out }));
  return out;
}
export async function nivelesNotion(env) { const m = await mapa(env); return [...new Set(Object.values(await nombresRelacion(env, m)).filter(Boolean))]; }

// La agenda de hoy tal cual está en su Notion (sin IA, para que sea exacta)
export function agendaNotion(n) {
  if (!n?.hoy) return "";
  const ic = (x) => (x.hecho ? "✅" : /progres|curso/i.test(x.estado) ? "🔄" : "⏳");
  const l = [...n.hoy].sort((a, b) => (Number(!!a.hecho) - Number(!!b.hecho)) || (Number(!!a.vencida) - Number(!!b.vencida)) || (a.hora || "99").localeCompare(b.hora || "99"));
  if (!l.length) return "📅 En tu Notion no hay nada cargado para hoy.";
  const pend = l.filter((x) => !x.hecho).length;
  return `📅 Hoy en tu Notion (${pend} por hacer de ${l.length}):\n` + l.map((x) => `${ic(x)} ${x.hora ? x.hora + " " : ""}${x.texto}${x.categoria ? " · " + x.categoria : ""}${x.vencida ? " · vencida" : ""}${x.min ? " · " + x.min + " min" : ""}`).join("\n");
}

// Diagnóstico para el comando "notion": qué bases ve, columnas y cuántas filas abiertas trae
export async function diagnosticoNotion(env) {
  const m = await descubrir(env), n = await notionHoy(env).catch((e) => ({ error: String(e.message || e) }));
  const rol = (x) => (x ? `${x.nombre} (título "${x.titulo}", fecha "${x.fecha || "-"}", hecho "${x.hecho || "-"}", categoría "${x.categoria || "-"}")` : "no la reconocí");
  const cols = (m.bases || []).map((d) => `• ${d.nombre}: ${d.columnas.join(", ")}`).join("\n");
  return `Bases que veo (${m.todas.length}): ${m.todas.join(", ") || "ninguna"}\n${cols}\n\nTareas: ${rol(m.tareas)}\nHábitos: ${rol(m.habitos)}\nEventos: ${rol(m.eventos)}\n\nHoy leí: ${n.error ? "error " + n.error : `${n.tareas.length} tareas abiertas, ${n.habitos.length} hábitos sin marcar, ${n.eventos.length} eventos, y ${n.otras.reduce((a, x) => a + x.filas.length, 0)} filas de otras bases`}.\n\nSi alguna base la tomé mal, decime por ejemplo "en Notion las tareas están en la base Misiones".`;
}
export async function fijarRol(env, rol, nombre) {
  const f = JSON.parse((await kvGet(env, "notion_roles")) || "{}"); f[rol] = nombre;
  await kvPut(env, "notion_roles", JSON.stringify(f)); return descubrir(env);
}

export function textoNotion(n) {
  if (!n) return "";
  const l = [];
  if (n.tareas.length) l.push("TAREAS EN SU NOTION: " + n.tareas.map((x) => `${x.texto}${x.categoria ? " [" + x.categoria + "]" : ""}${x.fecha ? " (" + x.fecha.slice(0, 10) + ")" : ""}`).join(" | "));
  if (n.habitos.length) l.push("HÁBITOS DE HOY SIN MARCAR: " + n.habitos.map((x) => x.texto).join(", "));
  if (n.eventos.length) l.push("EVENTOS DE HOY: " + n.eventos.map((x) => (x.hora ? x.hora + " " : "") + x.texto).join(" | "));
  return l.join("\n");
}

// Una tarea nueva que dictó por Telegram también queda en su Notion (con fecha y categoría si las tiene)
export async function crearEnNotion(env, { texto: t, fecha, categoria }) {
  if (!notionActivo(env)) return null;
  const m = await mapa(env); if (!m.tareas?.titulo) return null;
  const props = { [m.tareas.titulo]: { title: [{ text: { content: String(t).slice(0, 200) } }] } };
  const ini = m.tareas.fechaIni || m.tareas.fecha;
  if (ini) props[ini] = { date: { start: fecha || hoyAR() } };
  if (m.tareas.tipoHecho === "status") { const pe = m.tareas.estados.find((e) => /pend|sin empezar|to ?do|por hacer/i.test(norm(e))); if (pe) props[m.tareas.hecho] = { status: { name: pe } }; }
  if (categoria && m.tareas.relCat) {
    const nv = await nombresRelacion(env, m), id = Object.keys(nv).find((k) => norm(nv[k]) === norm(categoria)) || Object.keys(nv).find((k) => norm(nv[k]).includes(norm(categoria)) || norm(categoria).includes(norm(nv[k])));
    if (id) props[m.tareas.relCat] = { relation: [{ id }] };
  }
  if (categoria && m.tareas.categoria) {
    const op = m.tareas.opcionesCat.find((o) => norm(o) === norm(categoria)) || m.tareas.opcionesCat.find((o) => norm(o).includes(norm(categoria)) || norm(categoria).includes(norm(o)));
    if (op) props[m.tareas.categoria] = { select: { name: op } };
  }
  const r = await api(env, "pages", { parent: { database_id: m.tareas.id }, properties: props }).catch(async (e) => {
    // si la categoría es multi_select, Notion rechaza "select": reintento sin categoría
    delete props[m.tareas.categoria]; return api(env, "pages", { parent: { database_id: m.tareas.id }, properties: props }).catch(() => null);
  });
  return r?.id || null;
}

// Tachar en Notion (tarea o hábito)
export async function marcarEnNotion(env, pageId, col = null) {
  if (!notionActivo(env) || !pageId) return false;
  const m = await mapa(env);
  const base = col && m.habitos?.checks?.includes(col) ? m.habitos : m.tareas;
  const c = col || base?.hecho; if (!c) return false;
  const tipo = col && base === m.habitos ? "checkbox" : base.tipoHecho;
  const val = tipo === "status" ? { status: { name: base.estados.find((e) => /hech|done|complet|list|termin/i.test(norm(e))) || base.estados.at(-1) } } : { checkbox: true };
  const props = { [c]: val };
  if (!col && base?.completado && base.completado !== c) props[base.completado] = { checkbox: true };
  return !!(await api(env, "pages/" + pageId, { properties: props }, "PATCH").catch(() => null));
}
