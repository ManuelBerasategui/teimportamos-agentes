// PLAN SEMANAL + PLANILLA DE PEDIDOS: lo planificado contra lo real, todos los días.
//  - Campaña: palabras clave que piden los grupos y las historias (NFC, MALLAS, COMBOS, RESERVO, CUENTA, CUPO).
//    Se cuentan los chats privados que las escriben, por día. Así cada mensaje de grupo o historia tiene un resultado medido.
//  - Planilla "Pedidos" (Google Sheets, el manager): la manda un Apps Script a /lector/planilla. Es la fuente de verdad
//    de los pedidos. Cada pedido se cruza por teléfono con su chat del 805 para saber de dónde vino y cuánto tardó en cerrar.
//  - Plan: hipótesis de la semana con métrica, base, meta y vencimiento, cargadas en mesa_hip (las verifica la mesa sola).
// No manda mensajes a nadie. Solo lee y guarda en D1.
const AR = 3 * 3600e3, DIA = 86400e3;
const diaAR = (ts = Date.now()) => new Date(ts - AR).toISOString().slice(0, 10);
const todas = async (env, sql, ...b) => { try { return (await env.DB.prepare(sql).bind(...b).all()).results || []; } catch { return []; } };

let listo = false;
export async function prepararPlan(env) {
  if (listo) return;
  await env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS planilla (fila INTEGER PRIMARY KEY, fecha TEXT, ts INTEGER, canal TEXT, tel TEXT, conv TEXT, producto TEXT, estado TEXT, costo REAL, venta REAL, ganancia REAL, cliente TEXT, actualizado INTEGER)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS plan_sem (semana TEXT PRIMARY KEY, datos TEXT, ts INTEGER)"),
  ]);
  listo = true;
}

// ---------------------------------------------------------------------------
// Palabras clave de la campaña (las que piden los CTA). Mensajes cortos para CUENTA/CUPO/RESERVO: evita "te cuento", "el cupo de ayer…".
export const PALABRAS = {
  nfc: { que: "NFC (grupos)", re: /\bnfc\b/i },
  mallas: { que: "MALLAS (grupos)", re: /\bmallas?\b/i },
  combos: { que: "COMBOS (grupos)", re: /\bcombos?\b/i },
  reservo: { que: "RESERVO (historias mié y dom)", re: /\breserv[oa]\b/i, corto: true },
  cuenta: { que: "CUENTA (historia jue)", re: /\bcuenta\b/i, corto: true },
  cupo: { que: "CUPO (historia sáb)", re: /\bcupo\b/i, corto: true },
};
// msgs: filas de w_msg (conv, yo, texto, ts). Cuenta CHATS (no mensajes) por palabra y por día.
export function contarCampana(msgs, primerTs = {}) {
  const porDia = {}, total = {}, nuevos = {};
  const visto = new Set();
  for (const m of msgs) {
    if (m.yo) continue;
    const t = String(m.texto || "").trim(); if (!t) continue;
    for (const [k, p] of Object.entries(PALABRAS)) {
      if (!p.re.test(t) || (p.corto && t.length > 40)) continue;
      const clave = k + "|" + m.conv; if (visto.has(clave)) continue; visto.add(clave);
      const d = diaAR(m.ts);
      (porDia[d] ||= {})[k] = (porDia[d][k] || 0) + 1;
      total[k] = (total[k] || 0) + 1;
      if (primerTs[m.conv] && m.ts - primerTs[m.conv] < 10 * 60e3) nuevos[k] = (nuevos[k] || 0) + 1;   // chat que arrancó con esa palabra
    }
  }
  total.historias = (total.reservo || 0) + (total.cuenta || 0) + (total.cupo || 0);
  return { porDia, total, nuevos };
}

// ---------------------------------------------------------------------------
// PLANILLA: llegan las filas crudas (getDisplayValues) y se detectan las columnas por su contenido.
export function normTel(s) {
  let d = String(s || "").replace(/\D/g, "");
  if (d.length < 10) return "";
  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith("0")) d = d.slice(1);
  if (d.length === 10) return "549" + d;
  if (d.length === 11 && d.startsWith("9")) return "54" + d;
  if (d.length === 12 && d.startsWith("54") && d[2] !== "9") return "549" + d.slice(2);
  return d;
}
export function plata(s) {
  const t = String(s || "").trim(); if (!/\d/.test(t) || !/\$/.test(t)) return null;
  const neg = /^-|\(\s*\$/.test(t.replace(/\s/g, ""));
  let n = t.replace(/[^\d.,]/g, "");
  if (/,\d{2}$/.test(n)) n = n.replace(/\./g, "").replace(",", ".");   // 1.583.100,00
  else n = n.replace(/,/g, "");                                       // 1,583,100.00
  const v = parseFloat(n); return isNaN(v) ? null : neg ? -v : v;
}
export function fechaPlanilla(s, hoy = new Date(Date.now() - AR)) {
  const m = String(s || "").trim().match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/); if (!m) return null;
  const dd = +m[1], mm = +m[2]; if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  let yy = m[3] ? +m[3] : hoy.getUTCFullYear(); if (yy < 100) yy += 2000;
  if (!m[3] && mm > hoy.getUTCMonth() + 2) yy -= 1;   // "30/12" leído en enero es del año pasado
  return `${yy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}
const RE_ESTADO = /^(se[ñn]ad[oa]|pagad[oa]|finalizad[oa]|cancelad[oa]|pendiente|en camino|entregad[oa]|esteban|en china|en aduana|despachad[oa]|reservad[oa])$/i;
const RE_CANAL = /^(wsp|whatsapp|web|inver\w*|claude|ig|instagram|tiktok|grupo|ml|mercado ?libre)/i;
export function detectarColumnas(filas) {
  const nCol = Math.max(0, ...filas.map((f) => f.length));
  const puntos = { fecha: [], tel: [], estado: [], canal: [], plata: [] };
  for (let c = 0; c < nCol; c++) {
    let f = 0, t = 0, e = 0, ca = 0, p = 0;
    for (const r of filas) {
      const v = String(r[c] ?? "").trim(); if (!v) continue;
      if (fechaPlanilla(v)) f++;
      if (/^[\d\s\-+()]{10,20}$/.test(v) && normTel(v)) t++;
      if (RE_ESTADO.test(v)) e++;
      if (RE_CANAL.test(v)) ca++;
      if (plata(v) != null) p++;
    }
    puntos.fecha.push(f); puntos.tel.push(t); puntos.estado.push(e); puntos.canal.push(ca); puntos.plata.push(p);
  }
  const mejor = (k) => { const a = puntos[k]; const m = Math.max(0, ...a); return m >= 2 ? a.indexOf(m) : -1; };
  const col = { fecha: mejor("fecha"), tel: mejor("tel"), estado: mejor("estado"), canal: mejor("canal") };
  const max = Math.max(0, ...puntos.plata);
  const dinero = puntos.plata.map((n, i) => [n, i]).filter(([n]) => n >= Math.max(2, max * 0.3)).map(([, i]) => i);
  col.costo = dinero[0] ?? -1; col.venta = dinero[1] ?? -1; col.ganancia = dinero.length >= 3 ? dinero[dinero.length - 1] : -1;
  col.producto = col.tel >= 0 && col.tel + 1 < nCol && ![col.estado, col.costo].includes(col.tel + 1) ? col.tel + 1 : -1;
  col.cliente = col.venta >= 0 && col.venta + 1 < nCol && col.venta + 1 !== col.ganancia ? col.venta + 1 : -1;
  return col;
}
export function leerFilas(filas) {
  const col = detectarColumnas(filas);
  const g = (r, k) => (col[k] >= 0 ? String(r[col[k]] ?? "").trim() : "");
  const out = [];
  filas.forEach((r, i) => {
    const fecha = fechaPlanilla(g(r, "fecha")); if (!fecha) return;
    const producto = g(r, "producto"), tel = normTel(g(r, "tel"));
    if (!producto && !tel) return;
    out.push({ fila: i + 1, fecha, ts: Date.parse(fecha + "T12:00:00Z"), canal: g(r, "canal"), tel, producto: producto.slice(0, 200), estado: g(r, "estado").toUpperCase(),
      costo: plata(g(r, "costo")), venta: plata(g(r, "venta")), ganancia: plata(g(r, "ganancia")), cliente: g(r, "cliente").slice(0, 120) });
  });
  return { col, filas: out };
}
// Es un pedido de cliente (no un gasto propio: inversión, pago a Claude, a proveedores)
export const esPedido = (p) => !/^(inver|claude)/i.test(p.canal || "") && !/cancel/i.test(p.estado || "") && !/^-/.test(String(p.ganancia ?? "")) && (p.tel || p.venta || p.ganancia);

export async function guardarPlanilla(env, b) {
  await prepararPlan(env);
  const crudas = Array.isArray(b?.filas) ? b.filas.slice(0, 5000) : [];
  if (!crudas.length) return { ok: false, error: "No llegaron filas" };
  const { col, filas } = leerFilas(crudas);
  if (col.fecha < 0 || col.tel < 0) return { ok: false, error: "No encontré las columnas de fecha y teléfono", columnas: col };
  const convs = new Set((await todas(env, "SELECT conv FROM w_conv WHERE grupo=0 AND conv IN (" + [...new Set(filas.map((f) => f.tel).filter(Boolean))].map(() => "?").join(",") + ")", ...new Set(filas.map((f) => f.tel).filter(Boolean)))).map((x) => x.conv));
  const ahora = Date.now();
  const ops = [env.DB.prepare("DELETE FROM planilla")];
  for (const f of filas) ops.push(env.DB.prepare("INSERT INTO planilla (fila, fecha, ts, canal, tel, conv, producto, estado, costo, venta, ganancia, cliente, actualizado) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .bind(f.fila, f.fecha, f.ts, f.canal, f.tel, convs.has(f.tel) ? f.tel : null, f.producto, f.estado, f.costo, f.venta, f.ganancia, f.cliente, ahora));
  for (let i = 0; i < ops.length; i += 80) await env.DB.batch(ops.slice(i, i + 80));
  await env.DB.prepare("INSERT OR REPLACE INTO kv (k, v) VALUES ('planilla_ts', ?)").bind(String(ahora)).run();
  return { ok: true, pedidos: filas.length, con_chat: filas.filter((f) => convs.has(f.tel)).length, columnas: col };
}

// Resumen para los agentes: pedidos del período y la historia de su chat (origen, días hasta el pedido, seguimientos)
export async function resumenPlanilla(env, dias = 30) {
  await prepararPlan(env);
  const ahora = Date.now();
  const ps = await todas(env, "SELECT * FROM planilla WHERE ts>=? ORDER BY ts DESC", ahora - dias * DIA);
  const act = +((await env.DB.prepare("SELECT v FROM kv WHERE k='planilla_ts'").first().catch(() => null))?.v || 0);
  if (!ps.length) return { actualizado: act, pedidos: [], v7: { n: 0, ganancia: 0, venta: 0 }, v7ant: { n: 0, ganancia: 0, venta: 0 }, v30: { n: 0, ganancia: 0, venta: 0 } };
  const cs = [...new Set(ps.map((p) => p.conv).filter(Boolean))];
  const ph = cs.map(() => "?").join(",");
  const [info, segs] = cs.length ? await Promise.all([
    todas(env, `SELECT conv, primer_ts, origen, origen_cod, perfil, etapa FROM w_conv WHERE conv IN (${ph})`, ...cs),
    todas(env, `SELECT conv, COUNT(*) n FROM w_seg_log WHERE conv IN (${ph}) AND quien IN ('auto','dueno') GROUP BY conv`, ...cs),
  ]) : [[], []];
  const I = Object.fromEntries(info.map((x) => [x.conv, x])), S = Object.fromEntries(segs.map((x) => [x.conv, x.n]));
  const pedidos = ps.filter(esPedido).map((p) => {
    const c = I[p.conv] || {};
    return { ...p, origen: c.origen_cod || c.origen || (p.conv ? "sin dato" : "chat no encontrado"), perfil: c.perfil || "", seguimientos: S[p.conv] || 0,
      dias_a_pedido: c.primer_ts ? Math.max(0, Math.round((p.ts - c.primer_ts) / DIA)) : null };
  });
  const sum = (l) => ({ n: l.length, venta: l.reduce((a, p) => a + (p.venta || 0), 0), ganancia: l.reduce((a, p) => a + (p.ganancia || 0), 0) });
  const en = (a, b) => pedidos.filter((p) => p.ts >= a && p.ts < b);
  return { actualizado: act, pedidos, v7: sum(en(ahora - 7 * DIA, ahora + DIA)), v7ant: sum(en(ahora - 14 * DIA, ahora - 7 * DIA)), v30: sum(pedidos) };
}

export function textoPlanilla(pl) {
  if (!pl?.actualizado) return "PLANILLA DE PEDIDOS: todavía no se conectó (falta el Apps Script en la planilla).";
  const k = (n) => "$" + Math.round((n || 0) / 1000) + "k";
  const L = [`PLANILLA DE PEDIDOS (fuente de verdad de lo vendido; actualizada ${new Date(pl.actualizado - AR).toISOString().slice(5, 16).replace("T", " ")}): 7 días ${pl.v7.n} pedidos, venta ${k(pl.v7.venta)}, ganancia ${k(pl.v7.ganancia)} · 7 días anteriores ${pl.v7ant.n} pedidos, ganancia ${k(pl.v7ant.ganancia)} · 30 días ${pl.v30.n} pedidos, ganancia ${k(pl.v30.ganancia)}`];
  L.push("PEDIDOS 30d con la historia de su chat: " + pl.pedidos.slice(0, 25).map((p) => `${p.fecha.slice(5)} ${p.producto} [${p.estado}] gan ${k(p.ganancia)} · origen ${p.origen}${p.perfil ? " perfil " + p.perfil : ""}${p.dias_a_pedido != null ? ` · ${p.dias_a_pedido} días del primer mensaje al pedido` : ""} · ${p.seguimientos} seguimientos`).join(" | "));
  return L.join("\n");
}

// ---------------------------------------------------------------------------
// PLAN DE LA SEMANA. Cada hipótesis usa una métrica de mesa.js (ventanas móviles de 7 días) y vence el lunes siguiente.
export const PLANES = {
  "2026-11-17": {
    titulo: "Campaña comercial 17 al 22/11: NFC, mallas y combos de tecnología",
    vence: "2026-11-23",
    hipotesis: [
      { metrica: "kw_mallas_7d", meta: 8, texto: "Las mallas con precio por cantidad a la vista traen más privados que los mensajes sin precio", accion: "Manuel: 5 mensajes de mallas en grupos (mar, jue, vie, sáb, dom), siempre con precio" },
      { metrica: "kw_nfc_7d", meta: 10, texto: "El cupo grupal de NFC con precio por unidad trae al menos 10 chats que escriben NFC", accion: "Manuel: 4 mensajes NFC en grupos (mar, jue, sáb, dom). Completar el $[X] antes de mandar" },
      { metrica: "kw_combos_7d", meta: 5, texto: "Los combos de tecnología con precio cerrado generan consultas de revendedores que arrancan", accion: "Manuel: 5 mensajes de combos. Precios por tramo 1-24: Arranque $155.000, Kit Pro $277.000, Premium $550.000" },
      { metrica: "kw_historias_7d", meta: 6, texto: "Las historias embudo con una palabra para escribir por privado (RESERVO, CUENTA, CUPO) traen al menos 6 chats", accion: "Manuel: 4-5 historias por día según el guion de cada día" },
      { metrica: "seg_resp_48h_pct", meta: 15, texto: "40-50 seguimientos por día sostienen al menos 15% de respuesta en 48 h", accion: "Manuel: 40-50 seguimientos diarios desde la lista del panel" },
      { metrica: "prosp_resp_pct", meta: 10, texto: "La prospección de Buko consigue al menos 10% de respuesta", accion: "Buko: prospección diaria cargada en la pestaña Prospección" },
      { metrica: "planilla_pedidos_7d", meta: 6, texto: "Con grupos, historias, seguimientos y prospección juntos se anotan al menos 6 pedidos en la semana (base: 5 la semana pasada)", accion: "Todos: anotar cada seña o pago en la planilla Pedidos el mismo día" },
    ],
    notas: [
      "Videos: 3-4 por día, orgánicos de Manuel vs animados de Claude. Se comparan vistas, retención y chats en 48 h por tipo; para separarlos hace falta saber cuál es cuál (ver PENDIENTES).",
      "Si un mensaje de grupo sale con [X] sin completar, no cuenta como prueba: el precio concreto es la variable que se testea.",
    ],
  },
};
export const lunesDe = (dia) => { const d = new Date(dia + "T12:00:00Z"); const w = (d.getUTCDay() + 6) % 7; return new Date(d.getTime() - w * DIA).toISOString().slice(0, 10); };
export function planVigente(dia = diaAR()) {
  const claves = Object.keys(PLANES).filter((k) => k <= dia && PLANES[k].vence >= dia).sort();
  const k = claves[claves.length - 1]; return k ? { semana: k, ...PLANES[k] } : null;
}

// Carga las hipótesis del plan en mesa_hip una sola vez (la mesa las verifica sola al vencimiento)
export async function sembrarPlan(env, h, medir) {
  const p = planVigente(h.hoy); if (!p) return 0;
  const ops = [];
  for (const [i, x] of p.hipotesis.entries()) {
    const id = `plan:${p.semana}:${i}`;
    const ya = await env.DB.prepare("SELECT id FROM mesa_hip WHERE id=?").bind(id).first().catch(() => null);
    if (ya) continue;
    const base = medir(h, x.metrica);
    ops.push(env.DB.prepare("INSERT INTO mesa_hip (id, ts, dia, agente, texto, accion, metrica, base, meta, vence, estado, actual, resultado, verificado) VALUES (?,?,?,?,?,?,?,?,?,?,'activa',?,NULL,0)")
      .bind(id, Date.now(), h.hoy, "plan", x.texto, x.accion, x.metrica, base ?? 0, x.meta, p.vence, base ?? 0));
  }
  if (ops.length) await env.DB.batch(ops);
  return ops.length;
}

export function textoPlan(h, medir) {
  const p = planVigente(h.hoy); if (!p) return "PLAN DE LA SEMANA: no hay plan cargado para esta semana. Pedile a Manuel las metas antes de sacar conclusiones.";
  const c = h.campana || { total: {}, porDia: {} };
  const dias = Object.keys(c.porDia).filter((d) => d >= p.semana).sort();
  return [
    `PLAN DE LA SEMANA (${p.titulo}; vence ${p.vence}). Compará SIEMPRE lo real contra estas metas y decí qué hipótesis va bien, cuál mal y qué cambiar mañana:`,
    ...p.hipotesis.map((x) => `- ${x.texto} → meta ${x.metrica} ≥ ${x.meta} · real hoy: ${medir(h, x.metrica) ?? "sin dato"} · acción: ${x.accion}`),
    ...p.notas.map((n) => "- Nota: " + n),
    `PALABRAS DE LA CAMPAÑA (chats privados que las escribieron, 7 días): ${Object.entries(PALABRAS).map(([k, v]) => `${v.que} ${c.total[k] || 0}${c.nuevos?.[k] ? ` (${c.nuevos[k]} chats nuevos)` : ""}`).join(" · ")}`,
    `POR DÍA: ${dias.map((d) => `${d.slice(5)} ${Object.entries(c.porDia[d]).map(([k, n]) => k + " " + n).join(", ")}`).join(" | ") || "todavía ninguna"}`,
  ].join("\n");
}
