// Tablero nuevo (/panel/p): lo que se usa todos los días y nada más.
//  - Para hacer: TODOS los chats que necesitan algo, ordenados por cercanía a la venta (pago > ya cotizado > falta cotizar > seguimiento > consulta nueva).
//  - Equipo: chats y mensajes contestados por persona, guardados por día en eq_dia (se pueden ver semana y mes).
//  - Ventas: las carga el equipo con el botón "Vendido" (monto, ganancia, línea). Es la fuente de verdad de la plata.
//  - Origen: links de WhatsApp con código "(H3)"; cuando alguien escribe desde ese link, el chat queda marcado con su origen.
// No manda mensajes a nadie. Solo lee y guarda en D1.
import { seguimientos, nombreDisp, cargarMapaEquipo, esBotTexto } from "./lector.js";
import { esCierre } from "./cierre.js";
import { estadoIA } from "./ia-alterna.js";

const AR = 3 * 3600e3, DIA = 86400e3;
export const diaAR = (ts = Date.now()) => new Date(ts - AR).toISOString().slice(0, 10);
const inicioDia = (dia) => Date.parse(dia + "T00:00:00Z") + AR;
const NUMERO_805 = "5493418051515";
export const LINEAS = ["Cupo / compra grupal", "A medida (China)", "Catálogo / grupos", "Paraguay", "Proveedor local", "Informe de proveedores", "Otro"];
export const CANALES = { H: "Historia", B: "Bio de Instagram", A: "Anuncio", P: "Prospección", G: "Grupo de WhatsApp", T: "TikTok", W: "Web", O: "Otro" };
const RE_SPAM = /comprobaci[oó]n r[aá]pida|est[aá]s ofreciendo \*\*|this is an automated|mensaje autom[aá]tico de/i;
const RE_PAGO = /transfer|se[ñn]a\b|comprobante|alias|cbu|cvu|ya (te )?pagu|c[oó]mo (te )?pago|link de pago|mercado ?pago|abon[oéa]/i;
const RE_NO_VENDEMOS = /vap|elf ?bar|\bpods?\b/i;

let listo = false;
export async function prepararTablero(env) {
  if (listo) return;
  await env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS eq_dia (dia TEXT, persona TEXT, chats INTEGER, mensajes INTEGER, act INTEGER, PRIMARY KEY (dia, persona))"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS ventas (id TEXT PRIMARY KEY, ts INTEGER, conv TEXT, nombre TEXT, producto TEXT, monto REAL, moneda TEXT, ganancia REAL, linea TEXT, quien TEXT, nota TEXT)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS ventas_ts ON ventas(ts)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS origenes (codigo TEXT PRIMARY KEY, nombre TEXT, canal TEXT, creado INTEGER, quien TEXT)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT, exp INTEGER)"),
  ]);
  for (const col of ["origen_cod TEXT", "cierre_ts INTEGER"]) await env.DB.prepare("ALTER TABLE w_conv ADD COLUMN " + col).run().catch(() => {});
  listo = true;
}
const kvGet = async (env, k) => (await env.DB.prepare("SELECT v FROM kv WHERE k=?").bind(k).first().catch(() => null))?.v ?? null;
const kvPut = (env, k, v) => env.DB.prepare("INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)").bind(k, String(v)).run();
const todas = async (env, sql, ...b) => (await env.DB.prepare(sql).bind(...b).all()).results || [];

// ---------------------------------------------------------------------------
// Equipo: cuántos chats y mensajes contestó cada persona cada día (queda guardado para siempre en eq_dia)
export async function calcularDiaEquipo(env, dia) {
  await cargarMapaEquipo(env);
  const d0 = inicioDia(dia);
  const ms = await todas(env, "SELECT conv, autor, texto FROM w_msg WHERE ts>=? AND ts<? AND grupo=0 AND yo=1 AND hist=0", d0, d0 + DIA);
  const P = {};
  for (const m of ms) {
    if (esBotTexto(m.texto)) continue;
    const n = nombreDisp(m.autor); if (!n) continue;
    const p = P[n] || (P[n] = { chats: new Set(), mensajes: 0 }); p.mensajes++; p.chats.add(m.conv);
  }
  const ops = [env.DB.prepare("DELETE FROM eq_dia WHERE dia=?").bind(dia)];
  for (const [n, p] of Object.entries(P)) ops.push(env.DB.prepare("INSERT INTO eq_dia (dia, persona, chats, mensajes, act) VALUES (?,?,?,?,?)").bind(dia, n, p.chats.size, p.mensajes, Date.now()));
  await env.DB.batch(ops);
  return P;
}

// Cron (cada minuto llama, trabaja cada 10): hoy, ayer cerrado una vez, y relleno hacia atrás de a 15 días hasta el primer mensaje guardado
export async function cronTablero(env) {
  if (!env.DB) return;
  await prepararTablero(env);
  const ult = +((await kvGet(env, "tab_ult")) || 0);
  if (Date.now() - ult < 10 * 60e3) return;
  await kvPut(env, "tab_ult", Date.now());
  const hoy = diaAR(), ayer = diaAR(Date.now() - DIA);
  await calcularDiaEquipo(env, hoy);
  if (!(await kvGet(env, "eqdia_fin:" + ayer))) { await calcularDiaEquipo(env, ayer); await kvPut(env, "eqdia_fin:" + ayer, Date.now()); }
  let primero = await kvGet(env, "eqdia_primero");
  if (!primero) { const r = await env.DB.prepare("SELECT MIN(ts) t FROM w_msg WHERE grupo=0 AND hist=0").first().catch(() => null); primero = r?.t ? diaAR(r.t) : hoy; await kvPut(env, "eqdia_primero", primero); }
  let hasta = (await kvGet(env, "eqdia_bf")) || ayer;   // último día ya rellenado hacia atrás
  for (let i = 0; i < 15 && hasta > primero; i++) { hasta = diaAR(inicioDia(hasta) - DIA / 2); await calcularDiaEquipo(env, hasta); }
  await kvPut(env, "eqdia_bf", hasta);
  await detectarOrigen(env).catch((e) => console.log("origen", e?.message || e));
}

// ---------------------------------------------------------------------------
// Origen del lead: "(H3)" al final del mensaje precargado del link. También reconoce los textos de siempre.
export async function detectarOrigen(env, limite = 80) {
  const convs = await todas(env, "SELECT conv, origen FROM w_conv WHERE grupo=0 AND origen_cod IS NULL AND primer_ts>=? ORDER BY primer_ts DESC LIMIT ?", Date.now() - 90 * DIA, limite);
  if (!convs.length) return 0;
  const cods = Object.fromEntries((await todas(env, "SELECT codigo, canal FROM origenes")).map((o) => [o.codigo, o.canal]));
  const ops = [];
  for (const c of convs) {
    const ms = await todas(env, "SELECT texto FROM w_msg WHERE conv=? AND yo=0 AND COALESCE(texto,'')<>'' ORDER BY ts LIMIT 3", c.conv);
    const t = ms.map((m) => m.texto).join(" ");
    const cod = (t.match(/\(([A-Z]\d{1,4})\)/) || [])[1];
    if (cod && cods[cod]) { ops.push(env.DB.prepare("UPDATE w_conv SET origen_cod=?, origen=? WHERE conv=?").bind(cod, cods[cod], c.conv)); continue; }
    let o = c.origen || "";
    if (!o && /vi un video tuyo/i.test(t)) o = "Instagram/TikTok (sin código)";
    else if (!o && /vengo del asistente/i.test(t)) o = "Web";
    ops.push(env.DB.prepare("UPDATE w_conv SET origen_cod='', origen=? WHERE conv=?").bind(o || null, c.conv));
  }
  for (let i = 0; i < ops.length; i += 50) await env.DB.batch(ops.slice(i, i + 50));
  return ops.length;
}

// ---------------------------------------------------------------------------
// Para hacer: todo lo que necesita algo, ordenado por cercanía a la venta
const CATS = {
  pago: { orden: 1, titulo: "Pago, seña o comprobante" },
  llamar: { orden: 2, titulo: "Llamar o manejarlo vos" },
  cotizado: { orden: 3, titulo: "Ya cotizado y espera respuesta" },
  cotizar: { orden: 4, titulo: "Falta cotizar" },
  seguimiento: { orden: 5, titulo: "Seguimiento que toca hoy" },
  consulta: { orden: 6, titulo: "Consulta sin responder" },
};
export async function paraHacer(env) {
  const ahora = Date.now();
  const filas = await todas(env, `SELECT conv, nombre, producto, etapa, accion, puntaje, presup_usd, perfil, ult_yo, ult_texto, ult_cliente_ts, ult_yo_ts, cot_pend, visto_ts, cierre_ts
    FROM w_conv WHERE grupo=0 AND archivado=0 AND COALESCE(prov,0)=0 AND ult_cliente_ts>=? AND COALESCE(etapa,'') NOT IN ('vendido','perdido','no_cliente')`, ahora - 14 * DIA);
  const items = new Map();
  const poner = (cat, c, extra = {}) => {
    const prev = items.get(c.conv);
    if (prev && CATS[prev.cat].orden <= CATS[cat].orden) return;
    items.set(c.conv, { cat, conv: c.conv, nombre: c.nombre || "", producto: c.producto || "", que: String(c.accion || "").replace(/\|p\d+$/, ""), puntaje: c.puntaje || 0, usd: c.presup_usd || 0,
      espera_h: Math.round((ahora - (c.ult_cliente_ts || ahora)) / 36e5), ultimo: String(c.ult_texto || "").replace(/\s+/g, " ").slice(0, 140), ...extra });
  };
  for (const c of filas) {
    if (c.ult_yo || (c.ult_yo_ts || 0) > (c.ult_cliente_ts || 0)) continue;              // lo último lo escribimos nosotros
    if ((c.cierre_ts || 0) >= (c.ult_cliente_ts || 0) || (c.visto_ts || 0) >= (c.ult_cliente_ts || 0)) continue;   // ya marcado como listo
    if (esCierre(c.ult_texto) || RE_SPAM.test(c.ult_texto || "") || RE_NO_VENDEMOS.test(c.producto || "")) continue;
    if (RE_PAGO.test(c.ult_texto || "")) poner("pago", c);
    else if (["cotizado", "negociando"].includes(c.etapa)) poner("cotizado", c);
    else if (c.cot_pend || c.etapa === "falta_cotizar") poner("cotizar", c);
    else poner("consulta", c);
  }
  // Seguimientos (el agente ya decide a quién y redacta el mensaje). Los que van al dueño pasan a "Llamar".
  const segs = await seguimientos(env).catch(() => []);
  const cierres = Object.fromEntries((await todas(env, "SELECT conv, cierre_ts FROM w_conv WHERE cierre_ts IS NOT NULL AND cierre_ts>=?", ahora - 3 * DIA)).map((x) => [x.conv, x.cierre_ts]));
  for (const s of segs) {
    if (cierres[s.conv]) continue;
    const c = { conv: s.conv, nombre: s.nombre, producto: s.producto, accion: s.dueno ? (s.llamada || "Pedido grande o negociación: conviene llamarlo") : (s.sit_texto || "Toca seguimiento"), puntaje: s.puntaje, presup_usd: s.presup_usd, ult_texto: s.ult_texto };
    poner(s.dueno ? "llamar" : "seguimiento", c, { borrador: s.borrador || "", toque: s.toque || 1, dias: s.dias_cot ?? null });
  }
  const lista = [...items.values()].sort((a, b) => CATS[a.cat].orden - CATS[b.cat].orden || b.puntaje - a.puntaje || b.usd - a.usd || b.espera_h - a.espera_h);
  return { lista: lista.slice(0, 150), categorias: CATS };
}

// Marcar: listo (sale de la lista), vendido (queda registrada la venta), perdido (con motivo)
export async function marcar(env, accion, b, quien) {
  await prepararTablero(env);
  const conv = String(b.conv || "").replace(/\D/g, ""), ahora = Date.now();
  const cerrarTareas = env.DB.prepare("UPDATE tareas SET estado='resuelta' WHERE (ref=? OR tel=?) AND estado='abierta'").bind("w805:" + conv, conv);
  if (accion === "listo") {
    if (!conv) return { error: "falta el chat" };
    await env.DB.batch([env.DB.prepare("UPDATE w_conv SET cierre_ts=?, seg_visto=? WHERE conv=?").bind(ahora, ahora, conv), cerrarTareas]);
    return { ok: true };
  }
  if (accion === "perdido") {
    if (!conv) return { error: "falta el chat" };
    await env.DB.batch([env.DB.prepare("UPDATE w_conv SET etapa='perdido', motivo=?, cierre_ts=?, seg_no=? WHERE conv=?").bind(String(b.motivo || "otro").slice(0, 60), ahora, ahora, conv), cerrarTareas]);
    return { ok: true };
  }
  if (accion === "vendido") {
    const monto = Number(String(b.monto || "").replace(/\./g, "").replace(",", ".")) || 0;
    if (!monto) return { error: "poné el monto" };
    const c = conv ? await env.DB.prepare("SELECT nombre, producto FROM w_conv WHERE conv=?").bind(conv).first() : null;
    const id = "v" + ahora.toString(36) + Math.random().toString(36).slice(2, 6);
    const ops = [env.DB.prepare("INSERT INTO ventas (id, ts, conv, nombre, producto, monto, moneda, ganancia, linea, quien, nota) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
      .bind(id, b.ts ? Date.parse(b.ts + "T15:00:00Z") || ahora : ahora, conv || null, String(b.nombre || c?.nombre || "").slice(0, 80), String(b.producto || c?.producto || "").slice(0, 120), monto,
        b.moneda === "USD" ? "USD" : "ARS", Number(String(b.ganancia || "").replace(/\./g, "").replace(",", ".")) || null, LINEAS.includes(b.linea) ? b.linea : "Otro", quien || "", String(b.nota || "").slice(0, 300))];
    if (conv) ops.push(env.DB.prepare("UPDATE w_conv SET etapa='vendido', cierre_ts=? WHERE conv=?").bind(ahora, conv), cerrarTareas);
    await env.DB.batch(ops);
    return { ok: true, id };
  }
  if (accion === "venta-borrar") { await env.DB.prepare("DELETE FROM ventas WHERE id=?").bind(String(b.id || "")).run(); return { ok: true }; }
  return { error: "acción desconocida" };
}

// ---------------------------------------------------------------------------
// Números por semana o mes: lo justo para decidir
const lunes = (ts) => { const d = new Date(ts - AR); const w = (d.getUTCDay() + 6) % 7; return Date.parse(d.toISOString().slice(0, 10) + "T00:00:00Z") + AR - w * DIA; };
export async function numeros(env, periodo = "semana", n = 8) {
  await prepararTablero(env);
  const ahora = Date.now(), cortes = [];
  if (periodo === "mes") {
    const d = new Date(ahora - AR);
    for (let i = 0; i < n; i++) { const a = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1) + AR, b = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i + 1, 1) + AR; cortes.push([a, b, new Date(a - AR).toISOString().slice(0, 7)]); }
  } else {
    const l = lunes(ahora);
    for (let i = 0; i < n; i++) { const a = l - i * 7 * DIA; cortes.push([a, a + 7 * DIA, "sem " + diaAR(a).slice(5)]); }
  }
  const desde = cortes[cortes.length - 1][0];
  const [nuevos, cots, ventas, eq] = await Promise.all([
    todas(env, "SELECT primer_ts ts, COALESCE(NULLIF(origen,''),'sin dato') origen FROM w_conv WHERE grupo=0 AND COALESCE(prov,0)=0 AND COALESCE(nuevo_ok,1)=1 AND primer_ts>=?", desde),
    todas(env, "SELECT conv, MIN(ts) ts FROM w_hito WHERE tipo='cotizacion' AND ts>=? GROUP BY conv", desde),
    todas(env, "SELECT * FROM ventas WHERE ts>=? ORDER BY ts DESC", desde),
    todas(env, "SELECT dia, persona, chats, mensajes FROM eq_dia WHERE dia>=?", diaAR(desde)),
  ]);
  const filas = cortes.map(([a, b, et]) => {
    const en = (x) => x.ts >= a && x.ts < b, v = ventas.filter(en);
    const suma = (mon, k) => v.filter((x) => x.moneda === mon).reduce((s, x) => s + (Number(x[k]) || 0), 0);
    const equipo = {}; for (const e of eq) { const t = inicioDia(e.dia); if (t >= a && t < b) { const p = equipo[e.persona] || (equipo[e.persona] = { chats: 0, mensajes: 0 }); p.chats += e.chats; p.mensajes += e.mensajes; } }
    const origen = {}; for (const x of nuevos.filter(en)) origen[x.origen] = (origen[x.origen] || 0) + 1;
    const linea = {}; for (const x of v) { const l = linea[x.linea] || (linea[x.linea] = { ventas: 0, ARS: 0, USD: 0, ganARS: 0, ganUSD: 0 }); l.ventas++; l[x.moneda] += x.monto || 0; l["gan" + x.moneda] += x.ganancia || 0; }
    return { periodo: et, desde: a, nuevos: nuevos.filter(en).length, cotizados: cots.filter(en).length, ventas: v.length, ARS: suma("ARS", "monto"), USD: suma("USD", "monto"), ganARS: suma("ARS", "ganancia"), ganUSD: suma("USD", "ganancia"), equipo, origen, linea };
  });
  return { periodo, filas, ventas: ventas.slice(0, 60) };
}

// Equipo por día (para el gráfico y el detalle)
export async function equipoDias(env, dias = 31) {
  await prepararTablero(env);
  const desde = diaAR(Date.now() - (dias - 1) * DIA);
  return todas(env, "SELECT dia, persona, chats, mensajes FROM eq_dia WHERE dia>=? ORDER BY dia", desde);
}

// Dispositivos sin dueño (para asignarlos una vez)
export async function dispositivos(env) {
  await cargarMapaEquipo(env);
  const ms = await todas(env, "SELECT autor, COUNT(*) n, MAX(ts) ult FROM w_msg WHERE ts>=? AND grupo=0 AND yo=1 AND hist=0 GROUP BY autor", Date.now() - 30 * DIA);
  const out = {};
  for (const m of ms) {
    const d = (String(m.autor || "").match(/:(\d+)/) || [])[1]; if (d === undefined) continue;
    const o = out[d] || (out[d] = { disp: d, persona: nombreDisp(m.autor), mensajes: 0, ult: 0 }); o.mensajes += m.n; o.ult = Math.max(o.ult, m.ult);
  }
  return Object.values(out).sort((a, b) => b.ult - a.ult);
}
export async function asignarDispositivo(env, disp, persona) {
  const mapa = JSON.parse((await kvGet(env, "equipo_disp")) || "{}");
  const d = String(disp || "").replace(/\D/g, ""); if (!d) return { error: "falta el dispositivo" };
  mapa[d] = String(persona || "").trim().slice(0, 30) || null;
  await kvPut(env, "equipo_disp", JSON.stringify(mapa));
  await env.DB.prepare("DELETE FROM kv WHERE k IN ('eqdia_bf','tab_ult') OR k LIKE 'eqdia_fin:%' OR k LIKE 'equipo_cache:%'").run();   // se recalcula todo el historial de a poco
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Links con código de origen
export async function crearLink(env, b, quien) {
  await prepararTablero(env);
  const canal = CANALES[b.canal] ? b.canal : "O";
  const nombre = String(b.nombre || "").trim().slice(0, 60); if (!nombre) return { error: "poné un nombre (ej. historia cupo noviembre)" };
  const n = ((await env.DB.prepare("SELECT COUNT(*) n FROM origenes WHERE canal=?").bind(CANALES[canal]).first())?.n || 0) + 1;
  let codigo = canal + n; while (await env.DB.prepare("SELECT 1 FROM origenes WHERE codigo=?").bind(codigo).first()) codigo = canal + (+codigo.slice(1) + 1);
  await env.DB.prepare("INSERT INTO origenes (codigo, nombre, canal, creado, quien) VALUES (?,?,?,?,?)").bind(codigo, nombre, CANALES[canal], Date.now(), quien || "").run();
  return { ok: true, codigo, link: linkDe(codigo, b.texto) };
}
export const linkDe = (codigo, texto) => `https://wa.me/${NUMERO_805}?text=${encodeURIComponent((String(texto || "").trim() || "Hola! Quiero info para importar") + ` (${codigo})`)}`;
export async function links(env) {
  await prepararTablero(env);
  const os = await todas(env, "SELECT o.codigo, o.nombre, o.canal, o.creado, (SELECT COUNT(*) FROM w_conv c WHERE c.origen_cod=o.codigo) leads, (SELECT COUNT(*) FROM ventas v JOIN w_conv c ON c.conv=v.conv WHERE c.origen_cod=o.codigo) ventas FROM origenes o ORDER BY o.creado DESC");
  return os.map((o) => ({ ...o, link: linkDe(o.codigo) }));
}

// ---------------------------------------------------------------------------
// Pantalla Hoy en una sola llamada
export async function hoy(env) {
  await prepararTablero(env);
  const [ph, eq, lect, ultMsg, ia] = await Promise.all([
    paraHacer(env),
    todas(env, "SELECT dia, persona, chats, mensajes FROM eq_dia WHERE dia IN (?, ?)", diaAR(), diaAR(Date.now() - DIA)),
    kvGet(env, "lector_estado"),
    env.DB.prepare("SELECT MAX(ts) t FROM w_msg").first().catch(() => null),
    estadoIA(env).catch(() => null),
  ]);
  let lector = null; try { lector = JSON.parse(lect || "null"); } catch {}
  return { ...ph, equipo: eq, hoy: diaAR(), lector: { evento: lector?.evento || "", ultimoMensaje: ultMsg?.t || 0 }, ia };
}

// Resumen para el agente: números reales, no estimados
export async function contextoTablero(env) {
  try {
    const [n, ph] = await Promise.all([numeros(env, "semana", 4), paraHacer(env)]);
    const f = n.filas.map((x) => `${x.periodo}: ${x.nuevos} chats nuevos, ${x.cotizados} cotizados, ${x.ventas} ventas registradas (ARS ${Math.round(x.ARS)}, USD ${Math.round(x.USD)}, ganancia ARS ${Math.round(x.ganARS)} / USD ${Math.round(x.ganUSD)}), origen ${JSON.stringify(x.origen)}, por línea ${JSON.stringify(x.linea)}, equipo ${JSON.stringify(x.equipo)}`).join("\n");
    const cuenta = {}; for (const i of ph.lista) cuenta[i.cat] = (cuenta[i.cat] || 0) + 1;
    return `TABLERO (datos reales; las ventas son las que el equipo cargó con el botón Vendido):\n${f}\nPARA HACER AHORA: ${JSON.stringify(cuenta)}. Primeros: ${ph.lista.slice(0, 12).map((i) => `${i.nombre || i.conv} (${ph.categorias[i.cat].titulo}${i.producto ? ", " + i.producto : ""}${i.usd ? ", ~USD " + i.usd : ""})`).join("; ")}`;
  } catch (e) { return `TABLERO: no pude leerlo (${String(e?.message || e).slice(0, 100)})`; }
}

// ---------------------------------------------------------------------------
export async function apiTablero(env, req, url, quien) {
  const r = url.pathname.replace("/panel/p/api/", "");
  const json = (d) => Response.json(d, { headers: { "Cache-Control": "no-store" } });
  const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
  await prepararTablero(env);
  if (r === "hoy") return json(await hoy(env));
  if (["listo", "perdido", "vendido", "venta-borrar"].includes(r) && req.method === "POST") return json(await marcar(env, r, body, quien));
  if (r === "numeros") return json(await numeros(env, url.searchParams.get("p") === "mes" ? "mes" : "semana", Math.min(12, +url.searchParams.get("n") || 8)));
  if (r === "equipo") return json({ dias: await equipoDias(env, Math.min(400, +url.searchParams.get("d") || 31)), dispositivos: await dispositivos(env) });
  if (r === "asignar" && req.method === "POST") return json(await asignarDispositivo(env, body.disp, body.persona));
  if (r === "links") return json({ links: await links(env), canales: CANALES });
  if (r === "link" && req.method === "POST") return json(await crearLink(env, body, quien));
  if (r === "buscar") {
    const q = "%" + String(url.searchParams.get("q") || "").trim().toLowerCase() + "%";
    return json(await todas(env, "SELECT conv, nombre, producto, etapa, ult_ts, ult_texto, presup_usd FROM w_conv WHERE grupo=0 AND COALESCE(prov,0)=0 AND (lower(COALESCE(nombre,'')) LIKE ? OR conv LIKE ? OR lower(COALESCE(producto,'')) LIKE ?) ORDER BY ult_ts DESC LIMIT 40", q, q, q));
  }
  if (r === "lineas") return json({ lineas: LINEAS });
  return json({ error: "ruta desconocida" });
}
