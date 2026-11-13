// La MESA: agentes que analizan el negocio todos los días sin que nadie se lo pida.
//  - Capa de hechos (código, sin IA): embudo, tiempos de respuesta, preguntas sin responder, seguimientos por plantilla,
//    prospección, productos pedidos, cupos en los grupos, videos y consultas atribuidas, ventas. Todo medido en D1.
//  - Agentes (IA sobre los hechos): WhatsApp (por qué no cerramos), Redes (qué contenido trae consultas), Productos
//    (qué vender: demanda propia, cupos, Mercado Libre) e Integrador (cruza todo, decide, propone hipótesis).
//  - Hipótesis: cada una tiene una métrica, un valor base, una meta y un vencimiento. El código las verifica solo:
//    cumplida o fallida. Así la mesa aprende de lo que pasó, no de lo que opinó.
//  - Corre sola dos veces por día (06:10 y 20:30 hora AR), avisa por Telegram y se puede conversar con ella en el panel.
// Regla de oro: la IA no inventa números. Todos los números vienen de acá.
import { diaAR } from "./tablero.js";
import { esBotTexto, plantillaSeg } from "./lector.js";

const AR = 3 * 3600e3, DIA = 86400e3, H = 3600e3;
const inicioDia = (dia) => Date.parse(dia + "T00:00:00Z") + AR;
const kvGet = async (env, k) => (await env.DB.prepare("SELECT v FROM kv WHERE k=?").bind(k).first().catch(() => null))?.v ?? null;
const kvPut = (env, k, v) => env.DB.prepare("INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)").bind(k, String(v)).run();
const todas = async (env, sql, ...b) => { try { return (await env.DB.prepare(sql).bind(...b).all()).results || []; } catch { return []; } };
const n0 = (x) => (x == null || isNaN(x) ? "-" : Math.round(x).toLocaleString("es-AR"));
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const mediana = (xs) => { const v = xs.filter((x) => x != null).sort((a, b) => a - b); return v.length ? v[v.length >> 1] : null; };
const percentil = (xs, p) => { const v = xs.filter((x) => x != null).sort((a, b) => a - b); return v.length ? v[Math.min(v.length - 1, Math.floor(v.length * p))] : null; };
const fecha = (ts) => new Date(ts - AR).toISOString().slice(5, 10).split("-").reverse().join("/");
const corto = (t, n = 200) => String(t || "").replace(/\s+/g, " ").trim().slice(0, n);
const RE_PREGUNTA = /\?|pas[aá]me|mand[aá]me|cu[aá]nto|precio|quiero|necesito|ten[eé]s|tienen|cuando|cómo|como es|me pod[eé]s|se puede/i;

let listo = false;
export async function prepararMesa(env) {
  if (listo) return;
  await env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS mesa_informes (id TEXT PRIMARY KEY, ts INTEGER, dia TEXT, agente TEXT, datos TEXT, texto TEXT)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS mesa_informes_ts ON mesa_informes(ts)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS mesa_hip (id TEXT PRIMARY KEY, ts INTEGER, dia TEXT, agente TEXT, texto TEXT, accion TEXT, metrica TEXT, base REAL, meta REAL, vence TEXT, estado TEXT, actual REAL, resultado TEXT, verificado INTEGER)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS mesa_chat (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, rol TEXT, texto TEXT)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT, exp INTEGER)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS w_seg_log (id TEXT PRIMARY KEY, conv TEXT, ts INTEGER, toque INTEGER, situacion TEXT, quien TEXT, texto TEXT)"),
  ]);
  await env.DB.prepare("ALTER TABLE w_seg_log ADD COLUMN plantilla TEXT").run().catch(() => {});
  await env.DB.prepare("ALTER TABLE mesa_chat ADD COLUMN agente TEXT").run().catch(() => {});
  // Ideas que los agentes van dejando en cada corrida. estado: nueva | util | hecha | descartada (lo marca el dueño y los agentes aprenden de eso)
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS mesa_ideas (id TEXT PRIMARY KEY, ts INTEGER, dia TEXT, agente TEXT, texto TEXT, estado TEXT DEFAULT 'nueva', nota TEXT)").run().catch(() => {});   // con quién fue la charla: mesa, whatsapp, redes o productos   // plan A/B de cada seguimiento (lo escribe logSeg)
  listo = true;
}

// ---------------------------------------------------------------------------
// MÉTRICAS: nombre → cómo se calcula a partir de los hechos. Las hipótesis solo pueden usar estas.
export const METRICAS = {
  chats_nuevos_7d: { que: "chats nuevos en 7 días", f: (h) => h.embudo.v7.nuevos },
  cotizados_7d: { que: "chats cotizados en 7 días", f: (h) => h.embudo.v7.cotizados },
  ventas_7d: { que: "ventas en 7 días (cargadas + detectadas en el chat)", f: (h) => h.embudo.v7.ventas },
  cot_a_venta_pct: { que: "% de cotizados que compran (7 días)", f: (h) => pct(h.embudo.v7.ventas, h.embudo.v7.cotizados) },
  perfil_ab_pct: { que: "% de chats nuevos de perfil A o B (7 días)", f: (h) => h.perfiles.ab_pct },
  resp_humana_p50_min: { que: "mediana de minutos hasta la primera respuesta humana", f: (h) => h.respuesta.p50 },
  resp_mas_1h_pct: { que: "% de primeras respuestas humanas que tardaron más de 1 hora", f: (h) => h.respuesta.mas_1h_pct },
  preguntas_sin_responder: { que: "preguntas de clientes sin responder hace más de 24 h", f: (h) => h.pendientes.length },
  ventas_confirmadas_7d: { que: "ventas cargadas con el botón Vendido en 7 días", f: (h) => h.embudo.v7.ventas_confirmadas },
  cotizados_sin_resp_48h_pct: { que: "% de cotizaciones sin respuesta del cliente a las 48 h (7 días)", f: (h) => h.cotizaciones.sin_resp_pct },
  seg_resp_48h_pct: { que: "% de seguimientos que el cliente contestó en 48 h (14 días)", f: (h) => h.seguimientos.total.resp_pct },
  seg_resp_A_pct: { que: "% de respuesta de los seguimientos plan A (14 días)", f: (h) => h.seguimientos.A.resp_pct },
  seg_resp_B_pct: { que: "% de respuesta de los seguimientos plan B (14 días)", f: (h) => h.seguimientos.B.resp_pct },
  seg_con_plan_14d: { que: "seguimientos enviados con plan A o B en 14 días (los que manda el sender)", f: (h) => h.seguimientos.A.n + h.seguimientos.B.n },
  prosp_resp_pct: { que: "% de prospectos que respondieron (7 días)", f: (h) => h.prospeccion.resp_pct },
  consultas_por_video: { que: "chats nuevos atribuidos por video publicado (14 días)", f: (h) => h.redes.consultas_por_video },
  cupo_consultas_72h: { que: "consultas privadas en las 72 h después de cada mensaje de cupo (promedio, 14 días)", f: (h) => h.cupos.promedio_consultas },
};
export const medir = (h, nombre) => { const m = METRICAS[nombre]; if (!m) return null; try { const v = m.f(h); return v == null || isNaN(v) ? null : Math.round(v * 10) / 10; } catch { return null; } };

// ---------------------------------------------------------------------------
// HECHOS: una foto del negocio medida por el código. Es lo único que ven los agentes.
export async function hechos(env, { dias = 14 } = {}) {
  await prepararMesa(env);
  const ahora = Date.now(), hoy = diaAR(ahora);
  const s7 = ahora - 7 * DIA, s14 = ahora - 14 * DIA, s30 = ahora - 30 * DIA, desde = ahora - Math.max(14, dias) * DIA;
  const [convs, hitos, ventasCargadas, segLog, msgs7, grupos, ig, tt, prospectos, eq, mem, mlRaw, refs, vir, hitosVenta, ideasPrev] = await Promise.all([
    todas(env, "SELECT conv, nombre, primer_ts, ult_ts, ult_yo, ult_cliente_ts, ult_yo_ts, ult_texto, perfil, presup_usd, producto, etapa, motivo, origen, cierre_ts, puntaje FROM w_conv WHERE grupo=0 AND COALESCE(prov,0)=0 AND COALESCE(archivado,0)=0 AND (primer_ts>=? OR ult_ts>=?)", s30, s30),
    todas(env, "SELECT conv, tipo, ts, dato FROM w_hito WHERE ts>=? AND tipo='cotizacion'", s30 - 45 * DIA),
    todas(env, "SELECT ts, conv, nombre, producto, monto, moneda, ganancia, linea FROM ventas WHERE ts>=? ORDER BY ts DESC", s30),
    todas(env, "SELECT conv, ts, toque, situacion, quien, texto, plantilla FROM w_seg_log WHERE ts>=? AND quien<>'dueno-mal'", s14),
    todas(env, "SELECT conv, yo, texto, ts FROM w_msg INDEXED BY w_msg_priv WHERE ts>=? AND grupo=0 AND hist=0 ORDER BY conv, ts LIMIT 12000", s7),
    todas(env, "SELECT conv, texto, ts FROM w_msg WHERE grupo=1 AND yo=1 AND hist=0 AND ts>=? AND (lower(texto) LIKE '%cupo%' OR lower(texto) LIKE '%oferta%' OR lower(texto) LIKE '%combo%') ORDER BY ts", s14),
    todas(env, "SELECT id, ts, tipo, link, texto, formato, gancho, alcance, vistas, guardados, compartidos, comentarios, tiempo_ms FROM ig_posts WHERE ts>=? AND COALESCE(tipo,'')<>'STORY' ORDER BY ts", desde),
    todas(env, "SELECT id, ts, texto, vistas, likes, compartidos, guardados, guion FROM tt_posts WHERE ts>=? ORDER BY ts", desde),
    todas(env, "SELECT tel, negocio, rubro, estado, enviado_ts, respuesta, temperatura, act_ts FROM prospectos WHERE act_ts>=? OR enviado_ts>=?", s14, s14),
    todas(env, "SELECT dia, persona, chats, mensajes FROM eq_dia WHERE dia>=? ORDER BY dia", diaAR(s7)),
    todas(env, "SELECT tipo, texto, ts FROM ag_mem ORDER BY ts DESC LIMIT 25"),
    kvGet(env, "ml_tendencias"),
    todas(env, "SELECT ts, link, nicho, que_pasa, por_que FROM ig_refs WHERE que_pasa<>'' ORDER BY ts DESC LIMIT 12"),
    todas(env, "SELECT id, ts, autor, link, texto, vistas, compartidos, guardados, seguidores, fuente, guion FROM virales WHERE ts>=? ORDER BY vistas DESC LIMIT 14", ahora - 45 * DIA),   // lo lee el worker buscador (virales.js); si la tabla no existe todavía, queda vacío
    todas(env, "SELECT conv, tipo, ts, dato FROM w_hito WHERE (tipo IN ('venta','comprobante') AND COALESCE(oculto,0)=0) OR tipo='no_venta' ORDER BY ts"),   // todas las señales de pago de la historia: hacen falta para saber cuál es la PRIMERA de cada cliente
    todas(env, "SELECT agente, texto, estado, nota FROM mesa_ideas ORDER BY ts DESC LIMIT 60"),
  ]);
  const porConv = Object.fromEntries(convs.map((c) => [c.conv, c]));
  const activo = (c) => !["perdido", "vendido", "no_cliente"].includes(c.etapa);

  // --- Embudo por ventana: chats nuevos, cotizados (hito), ventas (cargadas + hito venta/comprobante + etapa vendido), perdidos con motivo
  const cotPorConv = {}, cotTodas = {};
  for (const x of hitos) { (cotTodas[x.conv] || (cotTodas[x.conv] = [])).push(x.ts); if (x.ts >= s30) cotPorConv[x.conv] = Math.min(cotPorConv[x.conv] || Infinity, x.ts); }
  const ventaTs = {};
  // VENTAS. Un pago o comprobante en el chat NO alcanza para decir "venta nueva": los clientes que ya compraron siguen
  // pagando saldos y mandando comprobantes semanas después. Regla:
  //   - venta confirmada = la que el equipo cargó con el botón Vendido;
  //   - venta detectada (sin confirmar) = la PRIMERA señal de pago de la historia de ese cliente, y solo si venía de un chat
  //     nuevo o de una cotización de los 45 días anteriores;
  //   - cualquier otra señal de pago = movimiento de un cliente anterior (se informa aparte, no entra al embudo).
  const cargada = new Set(ventasCargadas.filter((v) => v.conv).map((v) => v.conv));
  const primeraSenal = {}, movimientos = [];
  const noVenta = {}; for (const x of hitosVenta) if (x.tipo === "no_venta") noVenta[x.conv] = x.ts;   // el dueño dijo "no fue venta": lo anterior a esa marca no cuenta
  const senales = hitosVenta.filter((x) => x.tipo !== "no_venta" && !(noVenta[x.conv] >= x.ts));
  for (const x of senales) { if (!(x.conv in primeraSenal)) primeraSenal[x.conv] = { ts: x.ts, dato: x.dato }; }
  for (const c of convs) if (c.etapa === "vendido" && c.cierre_ts && !(c.conv in primeraSenal) && !(noVenta[c.conv] >= c.cierre_ts)) primeraSenal[c.conv] = { ts: c.cierre_ts, dato: "marcado vendido" };
  const evidencia = {};
  for (const [conv, x] of Object.entries(primeraSenal)) {
    if (cargada.has(conv) || x.ts < s30) continue;
    const c = porConv[conv]; if (!c) continue;
    const viene = c.primer_ts >= x.ts - 45 * DIA || (cotTodas[conv] || []).some((t) => t <= x.ts && t >= x.ts - 45 * DIA);
    if (viene) { ventaTs[conv] = x.ts; evidencia[conv] = corto(x.dato, 120); }
  }
  for (const x of senales) if (x.ts >= s14 && !ventaTs[x.conv] && !cargada.has(x.conv) && porConv[x.conv] && !movimientos.some((m) => m.conv === x.conv)) movimientos.push({ conv: x.conv, fecha: fecha(x.ts), nombre: porConv[x.conv].nombre || "sin nombre", primera: primeraSenal[x.conv] ? fecha(primeraSenal[x.conv].ts) : "-", dato: corto(x.dato, 90) });
  for (const v of ventasCargadas) if (v.conv) ventaTs[v.conv] = Math.min(ventaTs[v.conv] || Infinity, v.ts);

  const ventana = (a, b) => {
    const nuevos = convs.filter((c) => c.primer_ts >= a && c.primer_ts < b);
    const cot = Object.entries(cotPorConv).filter(([, ts]) => ts >= a && ts < b).map(([c]) => c);
    const ven = Object.entries(ventaTs).filter(([, ts]) => ts >= a && ts < b).map(([c]) => c);
    const perd = convs.filter((c) => c.etapa === "perdido" && (c.cierre_ts || c.ult_ts) >= a && (c.cierre_ts || c.ult_ts) < b);
    const motivos = {}; for (const p of perd) motivos[p.motivo || "sin motivo"] = (motivos[p.motivo || "sin motivo"] || 0) + 1;
    const sueltas = ventasCargadas.filter((v) => !v.conv && v.ts >= a && v.ts < b).length;   // ventas cargadas sin chat
    return { nuevos: nuevos.length, cotizados: cot.length, ventas: ven.length + sueltas, ventas_confirmadas: ven.filter((c) => cargada.has(c)).length + sueltas, perdidos: perd.length, motivos, cot_pct: pct(cot.length, nuevos.length), venta_pct: pct(ven.length, cot.length) };
  };
  const embudo = { v7: ventana(s7, ahora + H), v7ant: ventana(s14, s7), v30: ventana(s30, ahora + H), por_dia: [] };
  for (let i = 13; i >= 0; i--) { const d0 = inicioDia(diaAR(ahora - i * DIA)); embudo.por_dia.push({ dia: diaAR(d0 + H).slice(5), ...ventana(d0, d0 + DIA) }); }

  // --- Perfiles de los chats nuevos (7 días vs 7 anteriores)
  const perf = (a, b) => { const o = {}; for (const c of convs) if (c.primer_ts >= a && c.primer_ts < b) o[c.perfil || "?"] = (o[c.perfil || "?"] || 0) + 1; return o; };
  const p7 = perf(s7, ahora + H), p7a = perf(s14, s7), tot7 = Object.values(p7).reduce((x, y) => x + y, 0);
  const perfiles = { v7: p7, v7ant: p7a, ab_pct: pct((p7.A || 0) + (p7.B || 0), tot7) };

  // --- Velocidad humana y preguntas sin responder (7 días de mensajes)
  const delays = [], primeras = [];
  const porC = {}; for (const m of msgs7) (porC[m.conv] || (porC[m.conv] = [])).push(m);
  for (const [conv, ms] of Object.entries(porC)) {
    if (!porConv[conv]) continue;
    let esperando = null, primera = false;
    for (const m of ms) {
      if (!m.yo) { if (esperando === null) esperando = m.ts; continue; }
      if (esBotTexto(m.texto) || String(m.texto || "").length > 260) continue;   // el bot de Meta no es una respuesta humana
      if (esperando !== null) { const d = (m.ts - esperando) / 6e4; delays.push(d); if (!primera) { primeras.push(d); primera = true; } esperando = null; }
    }
  }
  const red0 = (x) => (x == null ? null : Math.round(x));
  const respuesta = { n: primeras.length, p50: red0(mediana(primeras)), p90: red0(percentil(primeras, 0.9)), mas_1h_pct: pct(primeras.filter((x) => x > 60).length, primeras.length), mas_12h: primeras.filter((x) => x > 720).length, todas_p50: red0(mediana(delays)) };
  const pendientes = convs.filter((c) => activo(c) && c.ult_yo === 0 && c.ult_cliente_ts && ahora - c.ult_cliente_ts > 24 * H && ahora - c.ult_cliente_ts < 10 * DIA && RE_PREGUNTA.test(c.ult_texto || ""))
    .sort((a, b) => (b.perfil === "A" || b.perfil === "B") - (a.perfil === "A" || a.perfil === "B") || b.ult_cliente_ts - a.ult_cliente_ts).slice(0, 60)
    .map((c) => ({ conv: c.conv, nombre: c.nombre || "sin nombre", perfil: c.perfil || "?", producto: corto(c.producto, 40), horas: Math.round((ahora - c.ult_cliente_ts) / H), texto: corto(c.ult_texto, 120) }));

  // Todos los chats donde el último mensaje es del cliente (con o sin pregunta), entre 24 h y 10 días: incluye "gracias", "ok" y saludos
  const esperando = convs.filter((c) => activo(c) && c.ult_yo === 0 && c.ult_cliente_ts && ahora - c.ult_cliente_ts > 24 * H && ahora - c.ult_cliente_ts < 10 * DIA).length;
  // --- Cotizaciones de los últimos 7 días: ¿el cliente contestó algo en 48 h?
  const cliTs = {}; for (const m of msgs7) if (!m.yo) (cliTs[m.conv] || (cliTs[m.conv] = [])).push(m.ts);
  const cot7 = Object.entries(cotPorConv).filter(([, ts]) => ts >= s7).map(([conv, ts]) => ({ conv, ts, resp: (cliTs[conv] || []).some((t) => t > ts && t - ts < 48 * H), c: porConv[conv] }));
  const cotizaciones = { n: cot7.length, sin_resp: cot7.filter((x) => !x.resp).length, sin_resp_pct: pct(cot7.filter((x) => !x.resp).length, cot7.length),
    por_perfil: cot7.reduce((o, x) => { const k = x.c?.perfil || "?"; o[k] = o[k] || { n: 0, resp: 0 }; o[k].n++; if (x.resp) o[k].resp++; return o; }, {}),
    sin_resp_lista: cot7.filter((x) => !x.resp && x.c).slice(0, 12).map((x) => ({ conv: x.conv, nombre: x.c.nombre || "sin nombre", perfil: x.c.perfil || "?", producto: corto(x.c.producto, 40), usd: x.c.presup_usd || null, hace_dias: Math.round((ahora - x.ts) / DIA) })) };

  // --- Seguimientos (14 días): respuesta a 48 h y compra después, por plantilla (A/B) y por toque
  // Cada fila de w_seg_log es un seguimiento mandado. Tres orígenes:
  //   - el sender o el botón del panel: guardan el plan (A/B) y el texto que salió;
  //   - cargados a mano con una nota ("lista html 10/11"): no tienen plan ni texto, y la hora es la de la carga, no la del envío.
  // Para todos se busca el mensaje real en el chat (el nuestro más cercano a la hora registrada) y la respuesta se mide desde ESE
  // mensaje. El plan A/B solo se compara con los que salieron con plan; los cargados a mano van aparte ("M").
  const segConvs = [...new Set(segLog.map((s) => s.conv))];
  const cli14 = {}, yo14 = {};
  for (let i = 0; i < segConvs.length; i += 90) {
    const lote = segConvs.slice(i, i + 90);
    for (const m of await todas(env, `SELECT conv, yo, ts, texto FROM w_msg INDEXED BY w_msg_conv WHERE conv IN (${lote.map(() => "?").join(",")}) AND ts>=? AND grupo=0 AND hist=0`, ...lote, s14 - DIA)) {
      if (!m.yo) (cli14[m.conv] || (cli14[m.conv] = [])).push(m.ts);
      else if (!esBotTexto(m.texto) && String(m.texto || "").trim()) (yo14[m.conv] || (yo14[m.conv] = [])).push({ ts: m.ts, texto: m.texto });
    }
  }
  const segStat = () => ({ n: 0, resp: 0, compro: 0, resp_pct: 0 });
  const seguimientos = { total: segStat(), A: segStat(), B: segStat(), M: segStat(), por_toque: {}, por_situacion: {}, sin_mensaje: 0 };
  const textosReales = [];
  for (const s of segLog) {
    const manual = !s.plantilla;
    // el mensaje real: a mano pudo salir hasta 18 h antes de cargarlo; el sender registra justo después de mandar
    const real = (yo14[s.conv] || []).filter((m) => m.ts >= s.ts - (manual ? 18 * H : 20 * 60e3) && m.ts <= s.ts + 30 * 60e3).sort((x, y) => Math.abs(x.ts - s.ts) - Math.abs(y.ts - s.ts))[0] || null;
    if (!real) seguimientos.sin_mensaje++;
    const t0 = real ? real.ts : s.ts;
    const resp = (cli14[s.conv] || []).some((t) => t > t0 && t - t0 < 48 * H), compro = (ventaTs[s.conv] || 0) > t0;
    const pl = manual ? "M" : s.plantilla;
    const texto = real ? real.texto : manual ? "" : s.texto;
    if (texto) textosReales.push({ texto, pl, resp });
    for (const g of [seguimientos.total, seguimientos[pl] || (seguimientos[pl] = segStat()), seguimientos.por_toque[manual ? "a mano" : s.toque || 0] || (seguimientos.por_toque[manual ? "a mano" : s.toque || 0] = segStat()), seguimientos.por_situacion[s.situacion || (manual ? "a mano" : "?")] || (seguimientos.por_situacion[s.situacion || (manual ? "a mano" : "?")] = segStat())]) { g.n++; if (resp) g.resp++; if (compro) g.compro++; }
  }
  for (const g of [seguimientos.total, seguimientos.A, seguimientos.B, seguimientos.M, ...Object.values(seguimientos.por_toque), ...Object.values(seguimientos.por_situacion)]) g.resp_pct = pct(g.resp, g.n);
  seguimientos.textos_repetidos = Object.entries(textosReales.reduce((o, s) => { const k = corto(s.texto, 60).toLowerCase().replace(/^(buenas|hola) [^,]{1,25}, /, ""); if (k) o[k] = (o[k] || 0) + 1; return o; }, {})).filter(([, n]) => n >= 5).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([t, n]) => ({ texto: t, veces: n }));
  // Ejemplos reales de lo que se mandó, con si contestaron o no: es lo que el agente de WhatsApp lee para decir QUÉ mensaje funciona
  const ej = (pl, resp) => textosReales.filter((t) => t.pl === pl && t.resp === resp).slice(-3).map((t) => corto(t.texto, 170));
  seguimientos.ejemplos = { A_si: ej("A", true), A_no: ej("A", false), B_si: ej("B", true), B_no: ej("B", false), M_si: ej("M", true), M_no: ej("M", false) };

  // --- Prospección (7 días)
  const pr7 = prospectos.filter((p) => (p.enviado_ts || 0) >= s7);
  const prospeccion = { enviados_7d: pr7.length, respondieron_7d: pr7.filter((p) => p.respuesta).length, resp_pct: pct(pr7.filter((p) => p.respuesta).length, pr7.length), calientes_7d: pr7.filter((p) => p.temperatura === "caliente").length,
    por_rubro: Object.entries(pr7.reduce((o, p) => { const k = p.rubro || "?"; o[k] = o[k] || { n: 0, resp: 0 }; o[k].n++; if (p.respuesta) o[k].resp++; return o; }, {})).map(([rubro, x]) => ({ rubro, ...x })).sort((a, b) => b.n - a.n).slice(0, 8) };

  // --- Productos pedidos (30 días): agrupados por palabra clave, con etapas y perfiles
  const clave = (p) => corto(p, 60).toLowerCase().replace(/\b(de|del|la|el|los|las|para|por|con|un|una|x|al|y|e|o)\b/g, " ").replace(/[^a-záéíóúñ ]/g, " ").split(/\s+/).filter((w) => w.length > 2).slice(0, 2).join(" ");
  const prod = {};
  for (const c of convs) { if (c.primer_ts < s30 || !c.producto) continue; const k = clave(c.producto); if (!k) continue; const o = prod[k] || (prod[k] = { producto: k, n: 0, cotizados: 0, ventas: 0, perdidos: 0, ab: 0, ejemplo: corto(c.producto, 50) }); o.n++; if (cotPorConv[c.conv]) o.cotizados++; if (ventaTs[c.conv]) o.ventas++; if (c.etapa === "perdido") o.perdidos++; if (c.perfil === "A" || c.perfil === "B") o.ab++; }
  const productos = Object.values(prod).sort((a, b) => b.n - a.n).slice(0, 18);

  // --- Cupos / ofertas en los grupos (14 días): cada mensaje y cuántas consultas privadas nuevas llegaron en 72 h
  const vistos = new Set(), cupos = [];
  const base72 = (convs.filter((c) => c.primer_ts >= s14).length / 14) * 3;
  for (const g of grupos) {
    const k = fecha(g.ts) + corto(g.texto, 50).toLowerCase(); if (vistos.has(k)) continue; vistos.add(k);
    const pal = clave(g.texto).split(" ").filter(Boolean);
    const nuevos = convs.filter((c) => c.primer_ts > g.ts && c.primer_ts < g.ts + 72 * H);
    const rel = nuevos.filter((c) => pal.some((w) => (c.producto || "").toLowerCase().includes(w) || (c.ult_texto || "").toLowerCase().includes(w)));
    cupos.push({ fecha: fecha(g.ts), texto: corto(g.texto, 110), consultas_72h: nuevos.length, relacionadas: rel.length, base_72h: Math.round(base72 * 10) / 10 });
  }
  const cuposR = { lista: cupos.slice(-12), promedio_consultas: cupos.length ? Math.round((cupos.reduce((a, x) => a + x.relacionadas, 0) / cupos.length) * 10) / 10 : null };

  // --- Redes: cada video con sus métricas y los chats nuevos en las 48 h siguientes (contra la base diaria)
  const baseDia = convs.filter((c) => c.primer_ts >= desde).length / Math.max(14, dias);
  const videos = ig.map((p) => { const n48 = convs.filter((c) => c.primer_ts > p.ts && c.primer_ts < p.ts + 48 * H).length; return { fecha: fecha(p.ts), gancho: corto(p.gancho, 70), texto: corto(p.texto, 90), formato: p.formato || "?", alcance: p.alcance, vistas: p.vistas, guardados: p.guardados, compartidos: p.compartidos, seg_vistos: p.tiempo_ms ? Math.round(p.tiempo_ms / 1000) : null, chats_48h: n48, atribuidos: Math.max(0, Math.round(n48 - baseDia * 2)) }; });
  const origen = {}; for (const c of convs) if (c.primer_ts >= s14) origen[c.origen || "sin dato"] = (origen[c.origen || "sin dato"] || 0) + 1;
  const chats48 = (ts) => convs.filter((c) => c.primer_ts > ts && c.primer_ts < ts + 48 * H).length;
  const virales = vir.map((v) => ({ fecha: fecha(v.ts), autor: v.autor, link: v.link, texto: corto(v.texto, 140), vistas: v.vistas, compartidos: v.compartidos, guardados: v.guardados, seguidores: v.seguidores, veces: v.seguidores ? Math.round(v.vistas / v.seguidores) : null, fuente: v.fuente, guion: corto(v.guion, 420) }));
  const redes = { videos, virales, tiktok: tt.map((p) => ({ fecha: fecha(p.ts), texto: corto(p.texto, 80), vistas: p.vistas, compartidos: p.compartidos, guardados: p.guardados, chats_48h: chats48(p.ts), guion: corto(p.guion, 420) })), origen_14d: origen,
    consultas_por_video: videos.length ? Math.round((videos.reduce((a, v) => a + v.atribuidos, 0) / videos.length) * 10) / 10 : null, base_diaria: Math.round(baseDia * 10) / 10, referencias: refs.map((r) => ({ fecha: fecha(r.ts), red: r.nicho, que_pasa: corto(r.que_pasa, 120), por_que: corto(r.por_que, 100) })) };

  // --- Ventas con detalle (30 días) y las que están en el chat pero no cargadas
  const ventas = { cargadas: ventasCargadas.map((v) => ({ fecha: fecha(v.ts), nombre: v.nombre, producto: corto(v.producto, 40), monto: v.monto, moneda: v.moneda, ganancia: v.ganancia, linea: v.linea })),
    movimientos_clientes_anteriores: movimientos.slice(0, 12),
    detectadas_sin_cargar: Object.entries(ventaTs).filter(([conv]) => !cargada.has(conv) && porConv[conv]).map(([conv, ts]) => ({ fecha: fecha(ts), conv, evidencia: evidencia[conv] || "", nombre: porConv[conv].nombre || "sin nombre", producto: corto(porConv[conv].producto, 40), perfil: porConv[conv].perfil || "?", usd: porConv[conv].presup_usd || null })).slice(0, 12) };

  // --- Equipo (7 días)
  const equipo = {}; for (const e of eq) { const o = equipo[e.persona] || (equipo[e.persona] = { chats: 0, mensajes: 0 }); o.chats += e.chats; o.mensajes += e.mensajes; }
  let ml = null; try { ml = mlRaw ? JSON.parse(mlRaw) : null; } catch {}
  const ideas = { utiles: ideasPrev.filter((i) => i.estado === "util" || i.estado === "hecha").slice(0, 8).map((i) => corto(i.texto, 140)), descartadas: ideasPrev.filter((i) => i.estado === "descartada").slice(0, 10).map((i) => corto(i.texto, 110) + (i.nota ? ` (motivo: ${corto(i.nota, 80)})` : "")), abiertas: ideasPrev.filter((i) => i.estado === "nueva").slice(0, 12).map((i) => corto(i.texto, 110)) };
  return { hoy, generado: ahora, ideas, esperando_total: esperando, embudo, perfiles, respuesta, pendientes, cotizaciones, seguimientos, prospeccion, productos, cupos: cuposR, redes, ventas, equipo, memoria: mem.map((m) => ({ tipo: m.tipo, texto: corto(m.texto, 160) })), ml, convs_30d: convs.length };
}

// Muestras de charlas reales (para que el agente de WhatsApp lea cómo hablamos, no solo los números)
export async function muestrasChats(env, h, { max = 12 } = {}) {
  const elegidos = [];
  const add = (lista, n, tag) => { for (const x of lista.slice(0, n)) if (x.conv && !elegidos.some((e) => e.conv === x.conv)) elegidos.push({ conv: x.conv, nombre: x.nombre, tag }); };
  add(h.cotizaciones.sin_resp_lista, 5, "cotizado sin respuesta");
  add(h.pendientes, 3, "pregunta sin responder");
  add(h.ventas.detectadas_sin_cargar, 2, "compró");
  const perdidos = await todas(env, "SELECT conv, nombre, motivo FROM w_conv WHERE etapa='perdido' AND grupo=0 ORDER BY COALESCE(cierre_ts, ult_ts) DESC LIMIT 4");
  add(perdidos.map((p) => ({ ...p, nombre: (p.nombre || "sin nombre") + (p.motivo ? " (motivo: " + p.motivo + ")" : "") })), 3, "perdido");
  const out = [];
  for (const e of elegidos.slice(0, max)) {
    const ms = (await todas(env, "SELECT yo, texto, ts FROM w_msg WHERE conv=? AND COALESCE(texto,'')<>'' ORDER BY ts DESC LIMIT 14", e.conv)).reverse();
    out.push(`### ${e.tag.toUpperCase()} · ${e.nombre || "sin nombre"} (+${e.conv})\n` + ms.map((m) => `${fecha(m.ts)} ${m.yo ? (esBotTexto(m.texto) ? "BOT" : "NOSOTROS") : "CLIENTE"}: ${corto(m.texto, 180)}`).join("\n"));
  }
  return out.join("\n\n");
}

// Los hechos en texto compacto (lo que lee cada agente)
export function textoHechos(h, partes = ["embudo", "whatsapp", "redes", "productos"]) {
  const L = [];
  const e = h.embudo;
  if (partes.includes("embudo")) {
    L.push(`EMBUDO 7 DÍAS: ${e.v7.nuevos} chats nuevos → ${e.v7.cotizados} cotizados (${e.v7.cot_pct}%) → ${e.v7.ventas} ventas (${e.v7.ventas_confirmadas ?? 0} CONFIRMADAS con el botón Vendido + ${e.v7.ventas - (e.v7.ventas_confirmadas ?? 0)} detectadas en el chat SIN CONFIRMAR; ${e.v7.venta_pct}% de los cotizados) · perdidos ${e.v7.perdidos} ${JSON.stringify(e.v7.motivos)}`);
    L.push(`7 DÍAS ANTERIORES: ${e.v7ant.nuevos} nuevos → ${e.v7ant.cotizados} cotizados → ${e.v7ant.ventas} ventas · 30 DÍAS: ${e.v30.nuevos} → ${e.v30.cotizados} → ${e.v30.ventas}`);
    L.push(`POR DÍA (nuevos/cotizados/ventas): ${e.por_dia.map((d) => `${d.dia} ${d.nuevos}/${d.cotizados}/${d.ventas}`).join(" · ")}`);
    L.push(`PERFILES chats nuevos 7d: ${JSON.stringify(h.perfiles.v7)} (A+B = ${h.perfiles.ab_pct}%) · 7d anteriores: ${JSON.stringify(h.perfiles.v7ant)}`);
    L.push(`VENTAS 30d cargadas: ${h.ventas.cargadas.map((v) => `${v.fecha} ${v.nombre} ${v.producto} ${v.moneda} ${n0(v.monto)} (${v.linea})`).join(" · ") || "ninguna"}`);
    L.push(`VENTAS DETECTADAS EN EL CHAT, SIN CONFIRMAR (primera señal de pago de un cliente nuevo o recién cotizado; son POSIBLES ventas: no las des por hechas, pedile a Manuel que las confirme o las descarte en el panel): ${h.ventas.detectadas_sin_cargar.map((v) => `${v.fecha} ${v.nombre} (+${v.conv}) ${v.producto} perfil ${v.perfil}${v.usd ? " ~USD " + v.usd : ""}${v.evidencia ? ` · señal: "${v.evidencia}"` : ""}`).join(" · ") || "ninguna"}`);
    if (h.ventas.movimientos_clientes_anteriores?.length) L.push(`PAGOS O COMPROBANTES DE CLIENTES QUE YA HABÍAN COMPRADO ANTES (saldos, envíos, recompras sin confirmar: NO son ventas nuevas y NO cuentan en el embudo): ${h.ventas.movimientos_clientes_anteriores.map((m) => `${m.fecha} ${m.nombre} (+${m.conv}), su primera compra fue el ${m.primera}`).join(" · ")}`);
    L.push(`EQUIPO 7d (chats contestados): ${JSON.stringify(h.equipo)}`);
  }
  if (partes.includes("whatsapp")) {
    const r = h.respuesta;
    L.push(`VELOCIDAD HUMANA 7d (sin contar el bot): mediana primera respuesta ${r.p50 ?? "-"} min · p90 ${r.p90 ?? "-"} min · ${r.mas_1h_pct}% tardó más de 1 h · ${r.mas_12h} esperaron más de 12 h (${r.n} charlas)`);
    L.push(`CHATS ESPERANDO RESPUESTA NUESTRA (último mensaje del cliente hace entre 24 h y 10 días): ${h.esperando_total ?? "-"} en total, de los cuales ${h.pendientes.length} tienen una pregunta o pedido concreto. El resto son cierres ("gracias", "ok", "dale") o saludos: no los cuentes como pendientes. Usá SOLO estos dos números, no otros.`);
    L.push(`PREGUNTAS SIN RESPONDER hace más de 24 h (${h.pendientes.length}; primero perfil A y B): ${h.pendientes.slice(0, 18).map((p) => `${p.nombre} (+${p.conv}) perfil ${p.perfil} · ${p.producto} · hace ${p.horas} h: "${p.texto}"`).join(" | ") || "ninguna"}`);
    const c = h.cotizaciones;
    L.push(`COTIZACIONES 7d: ${c.n} · sin respuesta del cliente a las 48 h: ${c.sin_resp} (${c.sin_resp_pct}%) · por perfil ${JSON.stringify(c.por_perfil)}`);
    L.push(`COTIZADOS SIN RESPUESTA (los más recientes): ${c.sin_resp_lista.map((x) => `${x.nombre} (+${x.conv}) ${x.perfil} · ${x.producto}${x.usd ? " ~USD " + x.usd : ""} · hace ${x.hace_dias} d`).join(" | ") || "-"}`);
    const s = h.seguimientos;
    const M = s.M || { n: 0, resp_pct: 0, compro: 0 }, conPlan = s.A.n + s.B.n;
    L.push(`SEGUIMIENTOS 14d: ${s.total.n} enviados · ${s.total.resp} contestaron en 48 h (${s.total.resp_pct}%) · ${s.total.compro} compraron después.`);
    L.push(`  CON PLAN (${conPlan}; es lo único que sirve para comparar A contra B): PLAN A oferta concreta: ${s.A.n} enviados, ${s.A.resp_pct}% respuesta, ${s.A.compro} compras · PLAN B entender su negocio: ${s.B.n} enviados, ${s.B.resp_pct}% respuesta, ${s.B.compro} compras.${Math.min(s.A.n, s.B.n) < 15 ? " OJO: con menos de 15 por plan la diferencia todavía no dice nada; no declares ganador." : ""}`);
    L.push(`  MANDADOS A MANO, SIN PLAN (${M.n}): ${M.resp_pct}% respuesta, ${M.compro} compras. No los sumes a ningún plan.`);
    L.push(`  Por toque ${JSON.stringify(s.por_toque)} · por situación ${JSON.stringify(s.por_situacion)}${s.sin_mensaje ? ` · ${s.sin_mensaje} registrados sin que el lector haya visto el mensaje en el chat (la respuesta se midió desde la hora de registro)` : ""}`);
    const e = s.ejemplos || {}, ejs = [["PLAN A que SÍ contestaron", e.A_si], ["PLAN A que NO contestaron", e.A_no], ["PLAN B que SÍ contestaron", e.B_si], ["PLAN B que NO contestaron", e.B_no], ["A MANO que SÍ contestaron", e.M_si], ["A MANO que NO contestaron", e.M_no]].filter(([, l]) => l?.length);
    if (ejs.length) L.push(`  MENSAJES REALES DE SEGUIMIENTO (texto que salió): ${ejs.map(([t, l]) => `${t}: ${l.map((x) => `"${x}"`).join(" / ")}`).join(" · ")}`);
    if (s.textos_repetidos.length) L.push(`TEXTOS DE SEGUIMIENTO REPETIDOS: ${s.textos_repetidos.map((t) => `"${t.texto}" x${t.veces}`).join(" · ")}`);
    const p = h.prospeccion;
    L.push(`PROSPECCIÓN 7d: ${p.enviados_7d} enviados · ${p.respondieron_7d} respondieron (${p.resp_pct}%) · ${p.calientes_7d} calientes · por rubro ${JSON.stringify(p.por_rubro)}`);
    L.push(`CUPOS/OFERTAS EN GRUPOS 14d (consultas privadas nuevas en 72 h; base esperada ${h.cupos.lista[0]?.base_72h ?? "-"} sin cupo): ${h.cupos.lista.map((c) => `${c.fecha} "${c.texto}" → ${c.consultas_72h} consultas, ${c.relacionadas} del producto`).join(" | ") || "ningún cupo publicado"}`);
  }
  if (partes.includes("redes")) {
    const r = h.redes;
    L.push(`VIDEOS INSTAGRAM (chats nuevos en las 48 h siguientes contra base de ${r.base_diaria} por día): ${r.videos.map((v) => `${v.fecha} [${v.formato}] gancho "${v.gancho}" · alcance ${n0(v.alcance)} · vistas ${n0(v.vistas)} · guardados ${n0(v.guardados)} · compartidos ${n0(v.compartidos)} · ${v.seg_vistos ?? "-"} s vistos · chats 48h ${v.chats_48h} (atribuidos ${v.atribuidos})`).join(" | ") || "sin videos"}`);
    L.push(`TIKTOK (los mismos videos que Instagram; "guion" es lo que se dice en el video, transcripto): ${r.tiktok.map((t) => `${t.fecha} "${t.texto}" ${n0(t.vistas)} vistas · ${n0(t.compartidos)} compartidos · ${n0(t.guardados)} guardados · chats 48h ${t.chats_48h}${t.guion ? ` · GUION: ${t.guion}` : ""}`).join(" | ") || "sin datos"}`);
    L.push(`ORIGEN DE LOS CHATS NUEVOS 14d (lo que dijo el cliente): ${JSON.stringify(r.origen_14d)}`);
    if (r.virales?.length) L.push(`VIRALES DE OTRAS CUENTAS (TikTok, leídos solos por hashtag o cuenta; "x seguidores" = cuántas veces superó a sus seguidores): ${r.virales.map((v) => `${v.fecha} @${v.autor} ${n0(v.vistas)} vistas${v.veces ? ` (${v.veces}x seguidores)` : ""} · ${n0(v.compartidos)} compartidos · ${n0(v.guardados)} guardados · ${v.fuente || ""} · "${v.texto}"${v.guion ? ` · DICE: ${v.guion}` : ""}`).join(" | ")}`);
    else L.push("VIRALES DE OTRAS CUENTAS: todavía no hay lectura (se leen solos los lunes; en el panel se puede pedir una lectura ahora y elegir hashtags y cuentas)");
    if (r.referencias.length) L.push(`VIDEOS VIRALES DE OTROS guardados como referencia: ${r.referencias.map((x) => `${x.fecha} ${x.red}: ${x.que_pasa} (${x.por_que})`).join(" | ")}`);
  }
  if (partes.includes("productos")) {
    L.push(`PRODUCTOS PEDIDOS 30d (consultas / cotizados / ventas / perdidos / de perfil A o B): ${h.productos.map((p) => `${p.ejemplo}: ${p.n}/${p.cotizados}/${p.ventas}/${p.perdidos}/${p.ab}`).join(" · ") || "-"}`);
    if (h.ml?.items?.length) L.push(`MERCADO LIBRE (leído desde la PC el ${fecha(h.ml.ts)}): ${h.ml.items.slice(0, 32).map((t) => `${t.palabra}${t.categoria && t.categoria !== "general" ? " [" + t.categoria + "]" : ""}${t.tipo ? " (" + t.tipo + ")" : ""}${t.resultados ? " · " + n0(t.resultados) + " publicaciones" : ""}${t.precio_min ? " · $" + n0(t.precio_min) + "-" + n0(t.precio_max) : ""}${t.vendidos ? " · top vende " + t.vendidos : ""}`).join(" | ")}`);
    else L.push("MERCADO LIBRE: sin datos todavía (corre tendencias_ml.bat en la PC para tenerlos)");
  }
  if (h.ideas?.utiles?.length) L.push(`IDEAS QUE MANUEL MARCÓ COMO ÚTILES O YA HIZO (más en esa línea): ${h.ideas.utiles.join(" | ")}`);
  if (h.ideas?.descartadas?.length) L.push(`IDEAS QUE MANUEL DESCARTÓ (no las repitas ni parecidas): ${h.ideas.descartadas.join(" | ")}`);
  if (h.ideas?.abiertas?.length) L.push(`IDEAS YA PROPUESTAS QUE TODAVÍA NO MIRÓ (no las repitas igual: proponé otras o mejoralas con un dato nuevo): ${h.ideas.abiertas.join(" | ")}`);
  if (h.memoria.length) L.push(`MEMORIA (decisiones y aprendizajes guardados): ${h.memoria.map((m) => `[${m.tipo}] ${m.texto}`).join(" · ")}`);
  return L.join("\n");
}

// ---------------------------------------------------------------------------
// AGENTES
const NEGOCIO = `"Te Importamos" (Rosario, Argentina): importación por encargo desde China (y Paraguay) para revendedores y comercios; cupos/compras grupales; catálogo propio en grupos de WhatsApp; cotizaciones a medida por link de Alibaba/1688. Cliente ideal: perfil A (vende o quiere vender en Mercado Libre con USD 1.000 a 3.000) y B (negocio que quiere abaratar costos). C es revendedor chico o curioso, D quiere una unidad, E no es cliente. Cómo se cotiza China: (FOB + flete + handling USD 30) x 1,30 + USD 80 de honorarios; seña 30%. El objetivo del dueño (Manuel) es UNO: vender más, de forma consistente y predecible. No está enamorado de ningún modelo: si los datos dicen que hay que cambiar el rumbo, hay que decirlo.`;
const REGLAS = `REGLAS:
- Usá SOLO los números y charlas de abajo. Nunca inventes clientes, cifras ni resultados. Cada hallazgo lleva su evidencia (nombre y número de cliente, o la cifra exacta).
- Si para afirmar algo te falta un dato, decí cuál y cómo medirlo: eso vale más que una opinión.
- Directo, español rioplatense con voseo, sin emojis, sin signos de apertura (¿ ¡), sin guiones largos. Manuel no tiene tiempo: primero lo importante.
- Las hipótesis son pocas (máximo 2), concretas y medibles: una acción que alguien puede hacer esta semana, una métrica de la lista y una meta numérica. Métricas posibles: ${Object.entries(METRICAS).map(([k, v]) => `${k} (${v.que})`).join("; ")}.
- Vapers, pods y tabaco no existen para vos.`;
// Manuales: criterio de cada agente. Armados con lo que ya aprendió el negocio y con patrones de equipos de agentes públicos
// (analistas por área + debate con un crítico + un jefe que decide, como en TauricResearch/TradingAgents; roles con método
// propio, como en los repos de agentes de marketing y ventas). Son criterio para razonar, no datos: los datos son los HECHOS.
export const MANUAL = {
  comun: `MÉTODO (para todos):
- De lo general a lo particular: primero en qué etapa del embudo se pierde más (arriba: contenido y consultas; medio: atención y cotización; abajo: cierre), después por qué.
- Nunca una sola causa. Para cada conclusión escribí también la explicación contraria y descartala con un dato; si no podés descartarla, dejala como duda y decí qué habría que medir.
- Compará siempre contra algo: la semana anterior, la base diaria, el otro plan, el otro perfil. Un número solo no dice nada.
- Con menos de 5 casos no hay patrón: decí "pocos casos" y tratá el hallazgo como pista.
- Cruzá con las otras áreas: una consulta viene de un contenido, pide un producto y termina (o no) en una venta. Seguí ese hilo completo.`,
  whatsapp: `CRITERIO DE VENTAS POR CHAT:
- Velocidad: el que pregunta y recibe respuesta en minutos sigue la charla; después de una hora la mayoría ya se fue a otra cosa. Mirá la demora humana, no la del bot.
- Calificar antes de cotizar: para qué lo quiere (revender, su negocio, uso propio), cantidad y presupuesto. Cotizarle a un perfil D o E es trabajo que no vuelve.
- Una cotización buena termina con un próximo paso y una pregunta concreta (seña, cantidad alternativa, fecha en que sale el pedido). "Cualquier cosa avisame" no es un próximo paso.
- Objeciones: precio total, mínimo, plazo, desconfianza, "lo pienso". Cada una pide otra respuesta. "Lo pienso" casi siempre es desconfianza o que no vio su margen.
- Lo que cierra con revendedores es mostrarles SU ganancia: costo puesto en Argentina contra el precio al que se vende acá.
- Para explicar por qué no se cierra: compará las charlas de los que compraron con las de los que no (quién era, qué se le dijo, cuánto tardamos, cómo se cotizó, qué objeción apareció).`,
  redes: `CRITERIO DE CONTENIDO:
- La métrica que importa es consultas de perfil A o B por video, no las vistas. Un video con pocas vistas que trae 3 chats de comerciantes vale más que uno de 100.000 que trae curiosos.
- Señales de intención: guardados y compartidos sobre vistas, comentarios pidiendo info, segundos vistos. Vistas solas son alcance.
- El primer segundo decide: un número, una pregunta o una imagen rara. Si el gancho no retiene, lo ven solo los seguidores.
- Un viral de otro se analiza en cuatro partes: gancho, desarrollo (qué muestra), giro u obstáculo, y pedido final. Se adapta la estructura a nuestro servicio, no se copia el tema.
- Un video "se despegó" cuando supera varias veces a los seguidores de la cuenta: esos son los que vale la pena estudiar, sean nuestros o de otros.
- Lo que funcionó se repite mejorado; una serie se gasta, y cuando cae hay que cortarla.
- Cada idea para grabar lleva: a quién le habla (perfil), producto, gancho textual, qué se muestra y qué consulta debería traer.`,
  productos: `CRITERIO DE PRODUCTO:
- Un producto vale si junta: demanda repetida (varios lo piden), compradores A o B, ticket que deje ganancia y poco riesgo (ni réplicas de marca ni cosas que frena la aduana).
- En Mercado Libre la oportunidad es: muchas ventas del primero + pocas publicaciones o publicaciones flojas + precio que deja margen contra el costo puesto.
- Un cupo funciona cuando el producto ya es conocido por el grupo, el precio por unidad está claro, hay cantidad mínima baja y fecha de cierre. Si el mismo cupo antes vendió y ahora no, mirá: saturación (ya compraron los que querían), precio contra la vez anterior, horario y cuántos mensajes hubo ese día en el grupo.
- Lista de corte: lo que se pide mucho y nunca cierra consume tiempo de cotización. Decí cuáles dejar de cotizar.
- Para cada producto decí la vía: cupo en grupos, por encargo, stock propio con entrega inmediata o publicarlo en Mercado Libre.`,
};
const SALIDA = `Respondé SOLO JSON: {"resumen":"2 o 3 líneas con lo más importante","hallazgos":[{"titulo":"corto","detalle":"qué pasa y por qué importa para vender","evidencia":"nombres, números o cifras exactas"}],"hipotesis":[{"texto":"qué creemos","accion":"qué hacer esta semana y quién (Manuel, Sender, agente, Buko)","metrica":"nombre de la lista","meta":número,"dias":7}],"ideas":["máximo 5 ideas NUEVAS para vender más, cada una concreta y completa en una oración: qué hacer, con qué producto o cliente, y el dato que la respalda"],"para_manuel":["cosas que solo él puede decidir o hacer, máximo 3"]}`;

const PROMPTS = {
  whatsapp: (h, muestras) => `Sos el AGENTE DE WHATSAPP de la mesa de ${NEGOCIO}
Tu trabajo: explicar con evidencia por qué los chats no terminan en venta y qué cambiar. Mirá todo el recorrido: cuánto tardamos en contestar (humanos, no el bot), si quedan preguntas sin responder, cómo cotizamos (texto o solo archivo, con o sin próximo paso), qué objeciones aparecen (precio, margen, mínimo, plazo, desconfianza), si la propuesta de valor es coherente (lo que prometemos vs lo que decimos en el chat), qué seguimientos funcionan (plan A oferta concreta vs plan B entender el negocio), prospección y cupos. Fijate en los perfiles: a quién le cotizamos y quién compra.
${MANUAL.comun}
${MANUAL.whatsapp}
${REGLAS}
HECHOS (medidos por el código):
${textoHechos(h, ["embudo", "whatsapp"])}

CHARLAS REALES (muestra de hoy):
${muestras || "(sin muestras)"}

${SALIDA}`,
  redes: (h) => `Sos el AGENTE DE REDES de la mesa de ${NEGOCIO}
Tu trabajo: decir qué contenido trae CONSULTAS QUE COMPRAN, no solo vistas. Cruzá cada video con los chats nuevos de las 48 h siguientes, con los perfiles que llegan (A y B valen, D y E no) y con los productos que después se piden. Comparalo con lo que guardamos de videos virales de otros. Si las consultas bajaron, mirá qué cambió en el contenido. Proponé qué grabar la semana que viene (tema, gancho, producto, a quién le habla) con la razón medida. Leé los GUIONES (lo que se dice en cada video nuestro) y lo que DICEN los virales de otras cuentas: compará estructuras, no solo temas, y decí qué viral conviene adaptar y cómo.
${MANUAL.comun}
${MANUAL.redes}
${REGLAS}
HECHOS:
${textoHechos(h, ["embudo", "redes", "productos"])}

${SALIDA}`,
  productos: (h) => `Sos el AGENTE DE PRODUCTOS de la mesa de ${NEGOCIO}
Tu trabajo: decir QUÉ VENDER y de qué forma. Fuentes: lo que la gente pide por WhatsApp (repetido, con perfil A o B, con cotización y venta), lo que se vendió, cómo rindieron los cupos en los grupos, los videos virales de otros, y las tendencias de Mercado Libre si están. Para cada producto que propongas decí la vía: cupo en grupos, importar por encargo, stockearlo nosotros (entrega inmediata) o publicarlo en Mercado Libre. Marcá productos a DEJAR de cotizar (los que se piden pero nunca cierran o son réplicas de marca/originales con riesgo de aduana). Si ves un producto que se vende mucho en Mercado Libre y las publicaciones son flojas, decilo: es una oportunidad.
${MANUAL.comun}
${MANUAL.productos}
${REGLAS}
HECHOS:
${textoHechos(h, ["embudo", "productos", "redes"])}
CUPOS: ${h.cupos.lista.map((c) => `${c.fecha} "${c.texto}" → ${c.relacionadas} consultas del producto en 72 h`).join(" | ") || "sin cupos en 14 días"}

${SALIDA}`,
};

const normIdea = (t) => String(t || "").toLowerCase().replace(/[^a-z0-9áéíóúñ ]/g, "").replace(/\s+/g, " ").trim().slice(0, 45);
async function guardarIdeas(env, dia, agente, lista) {
  const ya = new Set((await todas(env, "SELECT texto FROM mesa_ideas ORDER BY ts DESC LIMIT 120")).map((x) => normIdea(x.texto)));
  const ops = [];
  for (const t of lista) { const k = normIdea(t); if (k.length < 12 || ya.has(k)) continue; ya.add(k); ops.push(env.DB.prepare("INSERT INTO mesa_ideas (id, ts, dia, agente, texto, estado) VALUES (?,?,?,?,?,'nueva')").bind(`i:${Date.now()}:${agente}:${ops.length}:${Math.random().toString(36).slice(2, 6)}`, Date.now(), dia, agente, corto(t, 300))); }
  if (ops.length) await env.DB.batch(ops);
  return ops.length;
}
async function correrAgente(env, iaJSON, nombre, h, extra, opts) {
  const prompt = PROMPTS[nombre](h, extra);
  const r = await iaJSON(env, prompt, opts).catch(() => null);
  const datos = r && typeof r === "object" ? { resumen: corto(r.resumen, 600), hallazgos: (r.hallazgos || []).slice(0, 7).map((x) => ({ titulo: corto(x.titulo, 90), detalle: corto(x.detalle, 500), evidencia: corto(x.evidencia, 300) })), hipotesis: (r.hipotesis || []).filter((x) => METRICAS[x.metrica]).slice(0, 2).map((x) => ({ texto: corto(x.texto, 240), accion: corto(x.accion, 240), metrica: x.metrica, meta: +x.meta, dias: Math.min(30, Math.max(3, +x.dias || 7)) })), ideas: (r.ideas || []).slice(0, 5).map((x) => corto(x, 240)), para_manuel: (r.para_manuel || []).slice(0, 3).map((x) => corto(x, 240)) } : null;
  if (datos?.ideas?.length) await guardarIdeas(env, h.hoy, nombre, datos.ideas).catch(() => {});
  const texto = datos ? [datos.resumen, ...datos.hallazgos.map((x) => `- ${x.titulo}: ${x.detalle} (${x.evidencia})`)].join("\n") : "La IA no respondió (sin cupo). Se reintenta en la próxima corrida.";
  await env.DB.prepare("INSERT INTO mesa_informes (id, ts, dia, agente, datos, texto) VALUES (?,?,?,?,?,?)").bind(`${nombre}:${Date.now()}`, Date.now(), h.hoy, nombre, JSON.stringify(datos || {}), texto).run().catch(() => {});
  return datos;
}

// ---------------------------------------------------------------------------
// HIPÓTESIS: se crean con base medida hoy; se verifican solas cuando vencen (o antes, si ya se cumplieron)
async function crearHipotesis(env, h, agente, lista) {
  const activas = await todas(env, "SELECT id, texto FROM mesa_hip WHERE estado='activa'");
  const ops = [];
  for (const x of lista || []) {
    if (activas.length + ops.length >= 6 || !METRICAS[x.metrica] || isNaN(x.meta)) continue;
    if (activas.some((a) => a.texto.toLowerCase().slice(0, 40) === String(x.texto).toLowerCase().slice(0, 40))) continue;
    const base = medir(h, x.metrica), vence = diaAR(Date.now() + (x.dias || 7) * DIA);
    ops.push(env.DB.prepare("INSERT INTO mesa_hip (id, ts, dia, agente, texto, accion, metrica, base, meta, vence, estado, actual, resultado, verificado) VALUES (?,?,?,?,?,?,?,?,?,?,'activa',?,NULL,0)")
      .bind(`h:${Date.now()}:${agente}:${ops.length}:${Math.random().toString(36).slice(2, 6)}`, Date.now(), h.hoy, agente, x.texto, x.accion, x.metrica, base, x.meta, vence, base));
  }
  if (ops.length) await env.DB.batch(ops);
  return ops.length;
}
export async function verificarHipotesis(env, h) {
  const activas = await todas(env, "SELECT * FROM mesa_hip WHERE estado='activa'");
  const ops = [], cerradas = [];
  for (const x of activas) {
    const actual = medir(h, x.metrica);
    const subir = x.meta >= (x.base ?? 0), llego = actual != null && (subir ? actual >= x.meta : actual <= x.meta);
    let estado = "activa", resultado = null;
    if (llego) { estado = "cumplida"; resultado = `${x.metrica} pasó de ${x.base ?? "-"} a ${actual} (meta ${x.meta})`; }
    else if (x.vence <= h.hoy) { estado = "fallida"; resultado = `${x.metrica} quedó en ${actual ?? "-"} (base ${x.base ?? "-"}, meta ${x.meta})`; }
    ops.push(env.DB.prepare("UPDATE mesa_hip SET actual=?, estado=?, resultado=COALESCE(?, resultado), verificado=? WHERE id=?").bind(actual, estado, resultado, Date.now(), x.id));
    if (estado !== "activa") cerradas.push({ ...x, actual, estado, resultado });
  }
  if (ops.length) await env.DB.batch(ops);
  // Lo verificado queda en la memoria compartida con el agente: es lo que aprendió la mesa
  for (const c of cerradas) await env.DB.prepare("INSERT INTO ag_mem (ts, tipo, texto) VALUES (?,?,?)").bind(Date.now(), "aprendizaje", `Hipótesis ${c.estado}: "${corto(c.texto, 120)}" → ${c.resultado}`).run().catch(() => {});
  return cerradas;
}

// ---------------------------------------------------------------------------
// DISCUSIÓN: los agentes se contestan entre sí y un crítico ataca la conclusión más floja, antes de que el integrador decida.
// (Una sola llamada a la IA: cada agente habla solo desde su informe.)
const AGENTES = { whatsapp: "WhatsApp", redes: "Redes", productos: "Productos", critico: "Crítico", integrador: "Integrador", mesa: "Mesa", todos: "todos" };
async function discutir(env, iaJSON, h, informes, opts) {
  const compacto = (d) => d ? { resumen: d.resumen, hallazgos: d.hallazgos.map((x) => `${x.titulo}: ${corto(x.detalle, 220)} [${corto(x.evidencia, 140)}]`), ideas: d.ideas } : "sin informe";
  const prompt = `DISCUSIÓN DE LA MESA de ${NEGOCIO}
Abajo están los informes de hoy de tres agentes. Escribí la discusión entre ellos, en turnos cortos (2 a 4 líneas cada uno), como una reunión de equipo que busca la verdad y no quedar bien:
- Cada agente habla SOLO desde los datos de su informe y de los hechos. Nadie inventa números.
- Tiene que haber al menos un cruce Redes con WhatsApp (qué contenido trajo qué tipo de consulta y qué pasó después con esas consultas) y uno WhatsApp con Productos (qué se pide, qué se cotiza y qué cierra).
- Si un agente dice algo que los datos de otro contradicen o matizan, ese otro lo marca con el dato.
- El CRÍTICO entra una o dos veces: ataca la conclusión más floja (pocos casos, otra explicación posible, correlación que no es causa) y pide el dato que la confirmaría.
- Máximo 8 turnos. Terminá con los acuerdos, los desacuerdos que quedan abiertos y lo que falta medir para cerrarlos.
- Español rioplatense con voseo, sin emojis, sin signos de apertura, sin guiones largos. Vapers, pods y tabaco no existen.
${MANUAL.comun}
INFORME WHATSAPP: ${JSON.stringify(compacto(informes.whatsapp))}
INFORME REDES: ${JSON.stringify(compacto(informes.redes))}
INFORME PRODUCTOS: ${JSON.stringify(compacto(informes.productos))}
HECHOS: ${textoHechos(h, ["embudo"])}
Respondé SOLO JSON: {"turnos":[{"agente":"whatsapp|redes|productos|critico","a":"whatsapp|redes|productos|todos","texto":""}],"acuerdos":[""],"desacuerdos":[""],"falta_medir":[""]}`;
  const r = await iaJSON(env, prompt, opts).catch(() => null);
  if (!r || !Array.isArray(r.turnos) || !r.turnos.length) return null;
  const lista = (x, n) => (Array.isArray(x) ? x : []).slice(0, n).map((t) => corto(t, 260)).filter(Boolean);
  const datos = { turnos: r.turnos.slice(0, 8).filter((t) => t?.texto).map((t) => ({ agente: AGENTES[t.agente] && !["todos", "mesa", "integrador"].includes(t.agente) ? t.agente : "critico", a: AGENTES[t.a] ? t.a : "todos", texto: corto(t.texto, 520) })), acuerdos: lista(r.acuerdos, 4), desacuerdos: lista(r.desacuerdos, 4), falta_medir: lista(r.falta_medir, 4) };
  const texto = datos.turnos.map((t) => `${AGENTES[t.agente]} a ${AGENTES[t.a]}: ${t.texto}`).join("\n");
  await env.DB.prepare("INSERT INTO mesa_informes (id, ts, dia, agente, datos, texto) VALUES (?,?,?,?,?,?)").bind(`debate:${Date.now()}`, Date.now(), h.hoy, "debate", JSON.stringify(datos), texto).run().catch(() => {});
  return datos;
}

// ---------------------------------------------------------------------------
// INTEGRADOR: cruza los tres informes, la discusión, lo verificado y la memoria; decide y escribe el mensaje para Manuel
async function integrar(env, iaJSON, h, informes, cerradas, opts, debate = null) {
  const activas = await todas(env, "SELECT texto, accion, metrica, base, actual, meta, vence FROM mesa_hip WHERE estado='activa'");
  const previas = await todas(env, "SELECT texto FROM mesa_informes WHERE agente='integrador' ORDER BY ts DESC LIMIT 2");
  const prompt = `Sos el INTEGRADOR de la mesa de ${NEGOCIO}
Tenés los informes de hoy de tres agentes (WhatsApp, Redes, Productos), las hipótesis en curso con su avance medido, las que se cerraron hoy y la memoria. Tu trabajo:
1) LECTURA: qué pasó en el embudo, por etapa (arriba: contenido y consultas; medio: atención y cotización; abajo: cierre), con los números. Dónde se pierde más.
2) DECISIONES: máximo 3, ordenadas por impacto en ventas, cada una con quién la hace (Manuel, Sender, el agente, Buko) y el dato que la justifica. No repitas lo que ya decidiste en las lecturas anteriores salvo que haya un dato nuevo.
3) HIPÓTESIS: máximo 2 nuevas (podés tomar las de los agentes). Nada de hipótesis si ya hay 5 activas.
4) CAMBIO DE RUMBO: solo si los datos lo justifican, decilo sin vueltas (qué dejar de hacer, qué empezar). Si no, "".
5) MENSAJE: lo que le mandás a Manuel por Telegram, máximo 900 caracteres, 4 a 6 líneas, lo más importante primero, cada línea con un número o un nombre. Sin saludos.
${REGLAS}
INFORMES DE HOY:
WHATSAPP: ${JSON.stringify(informes.whatsapp || "sin informe")}
REDES: ${JSON.stringify(informes.redes || "sin informe")}
PRODUCTOS: ${JSON.stringify(informes.productos || "sin informe")}
DISCUSIÓN ENTRE LOS AGENTES (tenela en cuenta: lo que quedó en desacuerdo no lo des por cierto; lo que falta medir puede ser una decisión): ${debate ? JSON.stringify({ turnos: debate.turnos.map((t) => `${AGENTES[t.agente]}: ${t.texto}`), acuerdos: debate.acuerdos, desacuerdos: debate.desacuerdos, falta_medir: debate.falta_medir }) : "no hubo"}
HIPÓTESIS ACTIVAS (medidas hoy): ${JSON.stringify(activas) || "ninguna"}
CERRADAS HOY: ${cerradas.map((c) => `${c.estado.toUpperCase()}: ${c.texto} → ${c.resultado}`).join(" | ") || "ninguna"}
LECTURAS ANTERIORES (no las repitas): ${previas.map((p) => corto(p.texto, 500)).join(" || ") || "ninguna"}
EMBUDO: ${textoHechos(h, ["embudo"])}
Respondé SOLO JSON: {"lectura":"...","decisiones":[{"que":"","quien":"","por_que":""}],"hipotesis":[{"texto":"","accion":"","metrica":"","meta":número,"dias":7}],"cambio_rumbo":"","mensaje":"..."}`;
  const r = await iaJSON(env, prompt, opts).catch(() => null);
  if (!r || typeof r !== "object") return null;
  const datos = { lectura: corto(r.lectura, 1500), decisiones: (r.decisiones || []).slice(0, 3).map((d) => ({ que: corto(d.que, 240), quien: corto(d.quien, 40), por_que: corto(d.por_que, 240) })), hipotesis: (r.hipotesis || []).filter((x) => METRICAS[x.metrica]).slice(0, 2).map((x) => ({ texto: corto(x.texto, 240), accion: corto(x.accion, 240), metrica: x.metrica, meta: +x.meta, dias: Math.min(30, Math.max(3, +x.dias || 7)) })), cambio_rumbo: corto(r.cambio_rumbo, 600), mensaje: corto(r.mensaje, 900) };
  const texto = [datos.lectura, ...datos.decisiones.map((d, i) => `${i + 1}. ${d.que} (${d.quien}: ${d.por_que})`), datos.cambio_rumbo ? "CAMBIO DE RUMBO: " + datos.cambio_rumbo : ""].filter(Boolean).join("\n");
  await env.DB.prepare("INSERT INTO mesa_informes (id, ts, dia, agente, datos, texto) VALUES (?,?,?,?,?,?)").bind(`integrador:${Date.now()}`, Date.now(), h.hoy, "integrador", JSON.stringify(datos), texto).run().catch(() => {});
  await crearHipotesis(env, h, "integrador", datos.hipotesis);
  return datos;
}

// Aviso al dueño: por WhatsApp (el 805 le escribe a ADMIN_PHONE) y por Telegram si está configurado. En las simulaciones se captura en env.__captura.
async function avisarTelegram(env, texto, avisar = null) {
  const chat = env.TELEGRAM_CHAT || (await kvGet(env, "telegram_chat"));
  if (!texto) return false;
  if (env.__captura) { env.__captura.push(texto); return true; }
  let ok = false;
  if (avisar) ok = await avisar(env, texto).then(() => true).catch(() => false);
  if (!env.TELEGRAM_TOKEN || !chat) return ok;
  const r = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/sendMessage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: chat, text: String(texto).slice(0, 4000), disable_web_page_preview: true }) }).then((x) => x.json()).catch(() => null);
  return !!r?.ok;
}

// ---------------------------------------------------------------------------
// CORRIDA COMPLETA: hechos → verificar hipótesis → 3 agentes → discusión → integrador → aviso
export async function correrMesa(env, iaJSON, { forzar = false, profundo = false, motivo = "cron", avisar = null, ahora = Date.now() } = {}) {
  await prepararMesa(env);
  const hoy = diaAR(ahora);
  if (!forzar) {
    const ult = +((await kvGet(env, "mesa_intento_ts")) || 0);
    if (ahora - ult < 55 * 60e3) return { ok: false, motivo: "hace menos de una hora" };
  }
  await kvPut(env, "mesa_intento_ts", ahora);
  const h = await hechos(env, { dias: profundo ? 30 : 14 });
  await kvPut(env, "mesa_hechos", JSON.stringify(h).slice(0, 180000));
  const cerradas = await verificarHipotesis(env, h);
  const opts = { prioridad: forzar };
  const muestras = await muestrasChats(env, h).catch(() => "");
  const informes = {};
  informes.whatsapp = await correrAgente(env, iaJSON, "whatsapp", h, muestras, opts);
  informes.redes = await correrAgente(env, iaJSON, "redes", h, null, opts);
  informes.productos = await correrAgente(env, iaJSON, "productos", h, null, opts);
  for (const [k, d] of Object.entries(informes)) if (d?.hipotesis?.length) await crearHipotesis(env, h, k, d.hipotesis);
  const ok = Object.values(informes).some(Boolean);
  const nInf = Object.values(informes).filter(Boolean).length;
  const debate = nInf >= 2 && env.MESA_DEBATE !== "0" ? await discutir(env, iaJSON, h, informes, opts).catch(() => null) : null;
  const integrador = ok ? await integrar(env, iaJSON, h, informes, cerradas, opts, debate) : null;
  if (integrador) {
    const n = +((await kvGet(env, "mesa_corridas:" + hoy)) || 0) + 1;
    await kvPut(env, "mesa_corridas:" + hoy, n);
    await kvPut(env, "mesa_ult", JSON.stringify({ ts: Date.now(), dia: hoy, motivo, corrida: n }));
    const hAR = new Date(ahora - AR).getUTCHours();
    const cab = `Mesa · ${motivo === "cron" ? (hAR < 12 ? "arranque del día" : hAR < 19 ? "mediodía" : "cierre del día") : "corrida pedida"} ${hoy.slice(5).split("-").reverse().join("/")}\n`;
    await avisarTelegram(env, cab + integrador.mensaje + (cerradas.length ? "\n\nHipótesis cerradas: " + cerradas.map((c) => `${c.estado} "${corto(c.texto, 60)}"`).join("; ") : ""), avisar);
  }
  return { ok: !!integrador, informes, debate, integrador, cerradas, hechos: h };
}

// Cron (cada minuto): tres corridas por día, una por tramo: 06:10 AR arranca el día (después de que vuelve el cupo de Gemini
// a las 05:00), 13:30 mediodía y 20:30 cierre. Si la IA no respondió, se reintenta cada hora dentro del tramo. Domingo a la mañana es la corrida profunda (30 días).
export async function cronMesa(env, iaJSON, ts = Date.now(), avisar = null) {
  if (!env.DB || env.MESA === "0") return;
  const d = new Date(ts - AR), h = d.getUTCHours(), m = d.getUTCMinutes(), hoy = diaAR(ts);
  if (!(m === 10 || m === 30)) return;
  const corridas = +((await kvGet(env, "mesa_corridas:" + hoy)) || 0);
  const tramo = h >= 6 && h < 13 ? "m" : h >= 13 && h < 20 ? "t" : h >= 20 ? "n" : "";
  if (!tramo || m !== (tramo === "m" ? 10 : 30)) return;
  const toca = !(await kvGet(env, `mesa_tramo:${hoy}:${tramo}`));
  if (!toca) return;
  const r = await correrMesa(env, iaJSON, { profundo: d.getUTCDay() === 0 && corridas === 0, motivo: "cron", avisar, ahora: ts });
  if (r?.ok) await env.DB.prepare("INSERT OR REPLACE INTO kv (k, v, exp) VALUES (?, '1', ?)").bind(`mesa_tramo:${hoy}:${tramo}`, ts + 3 * DIA).run().catch(() => kvPut(env, `mesa_tramo:${hoy}:${tramo}`, 1));
}

// ---------------------------------------------------------------------------
// ESTADO para el panel y CHARLA con la mesa
// Hashtags y cuentas de donde el worker buscador lee los virales de otros (copia de buscador/src/virales.js)
const FUENTES_DEF = { hashtags: ["importardechina", "importaciones", "alibaba", "emprendedoresargentinos", "revender", "productosganadores", "mercadolibreargentina"], perfiles: [] };
export async function estadoMesa(env) {
  await prepararMesa(env);
  const ult = (await todas(env, "SELECT agente, ts, dia, datos, texto FROM mesa_informes ORDER BY ts DESC LIMIT 40"));
  const porAgente = {}; for (const x of ult) if (!porAgente[x.agente]) { let datos = {}; try { datos = JSON.parse(x.datos || "{}"); } catch {} porAgente[x.agente] = { ts: x.ts, dia: x.dia, datos, texto: x.texto }; }
  const hip = await todas(env, "SELECT * FROM mesa_hip ORDER BY CASE estado WHEN 'activa' THEN 0 ELSE 1 END, ts DESC LIMIT 30");
  const chat = (await todas(env, "SELECT ts, rol, texto, agente FROM mesa_chat ORDER BY id DESC LIMIT 40")).reverse();
  let hechosR = null; try { const h = JSON.parse((await kvGet(env, "mesa_hechos")) || "null"); if (h) hechosR = { generado: h.generado, embudo: h.embudo.v7, embudo_ant: h.embudo.v7ant, perfiles: h.perfiles, respuesta: h.respuesta, pendientes: h.pendientes.length, esperando_total: h.esperando_total ?? null, movimientos: h.ventas.movimientos_clientes_anteriores || [], cotizaciones: { n: h.cotizaciones.n, sin_resp_pct: h.cotizaciones.sin_resp_pct }, seguimientos: h.seguimientos, prospeccion: h.prospeccion, cupos: h.cupos, consultas_por_video: h.redes.consultas_por_video, ventas_sin_cargar: h.ventas.detectadas_sin_cargar, ml: !!h.ml }; } catch {}
  let ult2 = null; try { ult2 = JSON.parse((await kvGet(env, "mesa_ult")) || "null"); } catch {}
  const virales = await todas(env, "SELECT ts, autor, link, texto, vistas, compartidos, guardados, seguidores, fuente, guion FROM virales WHERE ts>=? ORDER BY vistas DESC LIMIT 12", Date.now() - 45 * DIA);
  let fuentes = null, virUlt = null; try { fuentes = JSON.parse((await kvGet(env, "virales_fuentes")) || "null"); virUlt = JSON.parse((await kvGet(env, "vir_ultimo")) || "null"); } catch {}
  const virPedido = !!(await kvGet(env, "vir_forzar")) || !!(await kvGet(env, "vir_run"));
  const ideas = await todas(env, "SELECT id, ts, agente, texto, estado FROM mesa_ideas WHERE estado IN ('nueva','util') ORDER BY CASE estado WHEN 'nueva' THEN 0 ELSE 1 END, ts DESC LIMIT 30");
  return { informes: porAgente, ideas, hipotesis: hip, chat, hechos: hechosR, ultima: ult2, virales: { lista: virales.map((v) => ({ ...v, texto: corto(v.texto, 160), guion: corto(v.guion, 500) })), fuentes: fuentes || FUENTES_DEF, ultimo: virUlt, leyendo: virPedido }, metricas: Object.fromEntries(Object.entries(METRICAS).map(([k, v]) => [k, v.que])) };
}
// ---------------------------------------------------------------------------
// CHARLA: Manuel le habla a la mesa entera o a un agente. Suele escribir corto, así que cada pregunta tiene dos pasos:
//   1) ENTENDER: la IA amplía la pregunta (qué quiere saber de verdad, sub-preguntas) y pide consultas a la base.
//   2) CONTESTAR: con los hechos, los informes del día y lo que devolvieron esas consultas.
// Las consultas las ejecuta el código (solo lectura, acotadas): la IA no toca la base.
export const CONSULTAS = {
  buscar_mensajes: 'mensajes privados de los últimos 21 días que contienen una palabra o frase. q = la palabra (ej. "caro", "seña", "perfume")',
  chat: "la charla completa reciente con un cliente. q = su número o su nombre",
  clientes_producto: "todos los clientes que pidieron un producto en 45 días, con perfil, etapa, monto y motivo de pérdida. q = el producto",
  perdidos: "los últimos 20 chats marcados como perdidos, con motivo y último mensaje. q vacío",
  cupos: "cada vez que publicamos un cupo u oferta de un producto en los grupos en 90 días, con las consultas privadas y las ventas de ese producto en las 72 h siguientes (sirve para comparar el mismo cupo en fechas distintas). q = el producto",
  videos: "nuestros videos de 60 días con vistas, guardados, compartidos, guion transcripto y chats nuevos en las 48 h siguientes. q vacío",
  virales: "videos virales de otras cuentas leídos en 45 días, con lo que dicen. q = palabra para filtrar o vacío",
  pendientes: "la lista completa de chats que esperan respuesta nuestra (último mensaje del cliente hace más de 24 h), con número, perfil, producto y qué dijo. q vacío, o 'todos' para incluir también los que solo dijeron gracias u ok",
  ventas: "las ventas de 30 días: confirmadas (cargadas), detectadas en el chat sin confirmar con su señal, y pagos de clientes anteriores. q vacío",
};
export async function ejecutarConsulta(env, c, ahora = Date.now()) {
  const tipo = String(c?.tipo || ""), q = corto(c?.q, 60).toLowerCase().replace(/[%_]/g, ""), like = "%" + q + "%";
  const quien = (m) => (m.yo ? (esBotTexto(m.texto) ? "BOT" : "NOSOTROS") : "CLIENTE");
  let out = "";
  if (tipo === "buscar_mensajes") {
    if (q.length < 3) return null;
    const r = await todas(env, "SELECT conv, yo, texto, ts FROM w_msg INDEXED BY w_msg_priv WHERE ts>=? AND grupo=0 AND hist=0 AND lower(texto) LIKE ? ORDER BY ts DESC LIMIT 30", ahora - 21 * DIA, like);
    out = r.length ? r.map((m) => `${fecha(m.ts)} +${m.conv} ${quien(m)}: ${corto(m.texto, 200)}`).join("\n") : "ningún mensaje con eso";
  } else if (tipo === "chat") {
    if (q.length < 3) return null;
    const dig = q.replace(/\D/g, "");
    const cs = dig.length >= 6 ? await todas(env, "SELECT conv, nombre, perfil, etapa, producto, presup_usd, motivo FROM w_conv WHERE grupo=0 AND conv LIKE ? ORDER BY ult_ts DESC LIMIT 1", "%" + dig)
      : await todas(env, "SELECT conv, nombre, perfil, etapa, producto, presup_usd, motivo FROM w_conv WHERE grupo=0 AND lower(COALESCE(nombre,'')) LIKE ? ORDER BY ult_ts DESC LIMIT 2", like);
    const partes = [];
    for (const x of cs) {
      const ms = (await todas(env, "SELECT yo, texto, ts FROM w_msg INDEXED BY w_msg_conv WHERE conv=? AND COALESCE(texto,'')<>'' ORDER BY ts DESC LIMIT 30", x.conv)).reverse();
      partes.push(`${x.nombre || "sin nombre"} (+${x.conv}) perfil ${x.perfil || "?"} · etapa ${x.etapa || "?"} · ${corto(x.producto, 50)}${x.presup_usd ? " · ~USD " + x.presup_usd : ""}${x.motivo ? " · motivo de pérdida: " + x.motivo : ""}\n` + ms.map((m) => `${fecha(m.ts)} ${quien(m)}: ${corto(m.texto, 220)}`).join("\n"));
    }
    out = partes.join("\n\n") || "no encontré ese cliente";
  } else if (tipo === "clientes_producto") {
    if (q.length < 3) return null;
    const r = await todas(env, "SELECT conv, nombre, perfil, etapa, producto, presup_usd, motivo, primer_ts, ult_yo, ult_texto FROM w_conv WHERE grupo=0 AND COALESCE(prov,0)=0 AND ult_ts>=? AND lower(COALESCE(producto,'')) LIKE ? ORDER BY ult_ts DESC LIMIT 30", ahora - 45 * DIA, like);
    const et = {}; for (const x of r) et[x.etapa || "?"] = (et[x.etapa || "?"] || 0) + 1;
    out = r.length ? `${r.length} clientes · por etapa ${JSON.stringify(et)}\n` + r.map((x) => `${fecha(x.primer_ts)} ${x.nombre || "sin nombre"} (+${x.conv}) perfil ${x.perfil || "?"} · ${x.etapa || "?"} · ${corto(x.producto, 50)}${x.presup_usd ? " · ~USD " + x.presup_usd : ""}${x.motivo ? " · perdido por: " + x.motivo : ""} · último (${x.ult_yo ? "nosotros" : "cliente"}): "${corto(x.ult_texto, 90)}"`).join("\n") : "nadie pidió eso en 45 días";
  } else if (tipo === "perdidos") {
    const r = await todas(env, "SELECT conv, nombre, perfil, producto, presup_usd, motivo, cierre_ts, ult_ts, ult_yo, ult_texto FROM w_conv WHERE grupo=0 AND etapa='perdido' ORDER BY COALESCE(cierre_ts, ult_ts) DESC LIMIT 20");
    out = r.map((x) => `${fecha(x.cierre_ts || x.ult_ts)} ${x.nombre || "sin nombre"} (+${x.conv}) perfil ${x.perfil || "?"} · ${corto(x.producto, 50)}${x.presup_usd ? " · ~USD " + x.presup_usd : ""} · motivo: ${x.motivo || "sin motivo"} · último (${x.ult_yo ? "nosotros" : "cliente"}): "${corto(x.ult_texto, 90)}"`).join("\n") || "no hay perdidos marcados";
  } else if (tipo === "cupos") {
    const s90 = ahora - 90 * DIA;
    const g = await todas(env, `SELECT conv, texto, ts FROM w_msg WHERE grupo=1 AND yo=1 AND hist=0 AND ts>=? AND ${q.length >= 3 ? "lower(texto) LIKE ?" : "(lower(texto) LIKE '%cupo%' OR lower(texto) LIKE '%oferta%')"} ORDER BY ts LIMIT 80`, ...(q.length >= 3 ? [s90, like] : [s90]));
    const cs = q.length >= 3 ? await todas(env, "SELECT conv, nombre, perfil, etapa, primer_ts FROM w_conv WHERE grupo=0 AND primer_ts>=? AND lower(COALESCE(producto,'')) LIKE ?", s90, like) : await todas(env, "SELECT conv, nombre, perfil, etapa, primer_ts FROM w_conv WHERE grupo=0 AND primer_ts>=?", s90);
    const vs = new Set((await todas(env, "SELECT conv FROM w_hito WHERE tipo IN ('venta','comprobante') AND ts>=?", s90)).map((x) => x.conv));
    const vistos = new Set(), filas = [];
    for (const m of g) {
      const k = fecha(m.ts) + corto(m.texto, 40).toLowerCase(); if (vistos.has(k)) continue; vistos.add(k);
      const n72 = cs.filter((c) => c.primer_ts > m.ts && c.primer_ts < m.ts + 72 * H);
      filas.push(`${fecha(m.ts)} ${new Date(m.ts - AR).toISOString().slice(11, 16)} h · "${corto(m.texto, 160)}" → ${n72.length} consultas${q.length >= 3 ? " de ese producto" : ""} en 72 h (${n72.filter((c) => c.perfil === "A" || c.perfil === "B").length} de perfil A o B) · ${n72.filter((c) => vs.has(c.conv) || c.etapa === "vendido").length} compraron`);
    }
    out = filas.slice(-25).join("\n") || "no publicamos cupos de eso en 90 días (o el lector no los vio)";
  } else if (tipo === "videos") {
    const d60 = ahora - 60 * DIA;
    const [tt, ig, nuevos] = await Promise.all([
      todas(env, "SELECT ts, texto, vistas, compartidos, guardados, guion FROM tt_posts WHERE ts>=? ORDER BY ts DESC LIMIT 30", d60),
      todas(env, "SELECT ts, texto, formato, gancho, alcance, vistas, guardados, compartidos FROM ig_posts WHERE ts>=? AND COALESCE(tipo,'')<>'STORY' ORDER BY ts DESC LIMIT 30", d60),
      todas(env, "SELECT primer_ts, perfil FROM w_conv WHERE grupo=0 AND COALESCE(prov,0)=0 AND primer_ts>=?", d60),
    ]);
    const c48 = (ts) => { const l = nuevos.filter((c) => c.primer_ts > ts && c.primer_ts < ts + 48 * H); return `${l.length} chats en 48 h (${l.filter((c) => c.perfil === "A" || c.perfil === "B").length} A o B)`; };
    out = [...ig.map((p) => `IG ${fecha(p.ts)} [${p.formato || "?"}] gancho "${corto(p.gancho, 70)}" · alcance ${n0(p.alcance)} · vistas ${n0(p.vistas)} · guardados ${n0(p.guardados)} · compartidos ${n0(p.compartidos)} · ${c48(p.ts)}`),
      ...tt.map((p) => `TikTok ${fecha(p.ts)} "${corto(p.texto, 70)}" · ${n0(p.vistas)} vistas · ${n0(p.guardados)} guardados · ${c48(p.ts)}${p.guion ? " · GUION: " + corto(p.guion, 350) : ""}`)].join("\n") || "sin videos en 60 días";
  } else if (tipo === "virales") {
    const r = await todas(env, `SELECT ts, autor, link, texto, vistas, compartidos, guardados, seguidores, guion FROM virales WHERE ts>=? ${q.length >= 3 ? "AND (lower(texto) LIKE ? OR lower(COALESCE(guion,'')) LIKE ?)" : ""} ORDER BY vistas DESC LIMIT 15`, ...(q.length >= 3 ? [ahora - 45 * DIA, like, like] : [ahora - 45 * DIA]));
    out = r.map((v) => `${fecha(v.ts)} @${v.autor} ${n0(v.vistas)} vistas${v.seguidores ? ` (${Math.round(v.vistas / v.seguidores)}x seguidores)` : ""} · "${corto(v.texto, 140)}"${v.guion ? " · DICE: " + corto(v.guion, 400) : ""} · ${v.link}`).join("\n") || "todavía no hay virales leídos";
  } else if (tipo === "pendientes") {
    const r = await todas(env, "SELECT conv, nombre, perfil, producto, etapa, ult_cliente_ts, ult_texto FROM w_conv WHERE grupo=0 AND COALESCE(prov,0)=0 AND COALESCE(archivado,0)=0 AND ult_yo=0 AND ult_cliente_ts>=? AND ult_cliente_ts<? AND COALESCE(etapa,'') NOT IN ('perdido','vendido','no_cliente') ORDER BY ult_cliente_ts DESC LIMIT 200", ahora - 10 * DIA, ahora - 24 * H);
    const con = r.filter((c) => RE_PREGUNTA.test(c.ult_texto || "")), l = (q === "todos" ? r : con).sort((a, b) => (b.perfil === "A" || b.perfil === "B") - (a.perfil === "A" || a.perfil === "B") || b.ult_cliente_ts - a.ult_cliente_ts);
    out = `${r.length} chats con el último mensaje del cliente hace entre 24 h y 10 días; ${con.length} con una pregunta o pedido concreto. Lista (${q === "todos" ? "todos" : "los que tienen pregunta"}; primero perfil A y B):\n` + l.slice(0, 70).map((c) => `+${c.conv} · ${c.nombre || "sin nombre"} · perfil ${c.perfil || "?"} · ${corto(c.producto, 40) || "sin producto"} · hace ${Math.round((ahora - c.ult_cliente_ts) / H)} h · "${corto(c.ult_texto, 90)}"`).join("\n");
    return `CONSULTA pendientes:\n${out.slice(0, 9000)}`;
  } else if (tipo === "ventas") {
    const h = await hechos(env);
    out = `CONFIRMADAS (cargadas con el botón Vendido, 30 días): ${h.ventas.cargadas.map((v) => `${v.fecha} ${v.nombre} · ${v.producto} · ${v.moneda} ${n0(v.monto)}`).join(" | ") || "ninguna"}\nDETECTADAS SIN CONFIRMAR (posibles): ${h.ventas.detectadas_sin_cargar.map((v) => `${v.fecha} ${v.nombre} (+${v.conv}) ${v.producto}${v.evidencia ? ` · señal: "${v.evidencia}"` : ""}`).join(" | ") || "ninguna"}\nPAGOS DE CLIENTES ANTERIORES (no son ventas nuevas): ${(h.ventas.movimientos_clientes_anteriores || []).map((m) => `${m.fecha} ${m.nombre} (+${m.conv}), primera compra ${m.primera}`).join(" | ") || "ninguno"}\nEMBUDO 7 días: ${h.embudo.v7.ventas_confirmadas} confirmadas, ${h.embudo.v7.ventas - h.embudo.v7.ventas_confirmadas} sin confirmar`;
  } else return null;
  return `CONSULTA ${tipo}${q ? ` "${q}"` : ""}:\n${out.slice(0, 4500)}`;
}

const QUIEN = {
  mesa: { nombre: "la MESA de agentes", partes: ["embudo", "whatsapp", "redes", "productos"], rol: "Sos la MESA de agentes (WhatsApp, Redes, Productos e Integrador). Contestá integrando las áreas: cuando un agente tenga un dato que aporte, que hable con su nombre en una o dos líneas (WhatsApp: ..., Redes: ..., Productos: ...) y cerrá con la conclusión y qué hacer." },
  whatsapp: { nombre: "el AGENTE DE WHATSAPP", partes: ["embudo", "whatsapp"], rol: "Sos el agente de WHATSAPP de la mesa: sabés de las charlas, la atención, las cotizaciones, los seguimientos, la prospección y por qué se cierra o no." },
  redes: { nombre: "el AGENTE DE REDES", partes: ["embudo", "redes"], rol: "Sos el agente de REDES de la mesa: sabés qué contenido trae consultas que compran, qué dicen nuestros videos y qué se está pegando en otras cuentas." },
  productos: { nombre: "el AGENTE DE PRODUCTOS", partes: ["embudo", "productos"], rol: "Sos el agente de PRODUCTOS de la mesa: sabés qué se pide, qué se vende, cómo rinden los cupos y qué pasa en Mercado Libre." },
};
export async function preguntarMesa(env, iaJSON, pregunta, agente = "mesa") {
  await prepararMesa(env);
  const q = corto(pregunta, 1000); if (!q) return { error: "falta la pregunta" };
  const A = QUIEN[agente] ? agente : "mesa", Q = QUIEN[A];
  const est = await estadoMesa(env);
  let h = null; try { h = JSON.parse((await kvGet(env, "mesa_hechos")) || "null"); } catch {}
  if (!h || Date.now() - (h.generado || 0) > 6 * H) { h = await hechos(env); await kvPut(env, "mesa_hechos", JSON.stringify(h).slice(0, 180000)); }
  const charla = est.chat.slice(-8).map((m) => `${m.rol === "u" ? "MANUEL" : (AGENTES[m.agente] || "MESA").toUpperCase()}: ${corto(m.texto, 400)}`).join("\n");
  const lectura = corto(est.informes.integrador?.datos?.lectura, 500);

  // Paso 1: entender y pedir datos
  const plan = await iaJSON(env, `PREPARÁS LA RESPUESTA de ${Q.nombre} de ${NEGOCIO}
Manuel escribe corto y apurado. Antes de contestarle hay que entender qué quiere saber DE VERDAD y juntar los datos. No contestes todavía.
${charla ? "CHARLA RECIENTE:\n" + charla + "\n" : ""}MENSAJE DE MANUEL: ${q}
LECTURA DE HOY (para contexto): ${lectura || "sin lectura todavía"}
1) "entendi": la pregunta ampliada en 2 o 3 oraciones: qué quiere saber, de qué período o producto habla, y las 2 a 4 sub-preguntas que hay que contestar para que la respuesta le sirva (aunque él no las haya escrito).
2) "consultas": hasta 4 consultas a la base, solo las que hagan falta (si con los números generales alcanza, ninguna). Tipos:
${Object.entries(CONSULTAS).map(([k, v]) => `- ${k}: ${v}`).join("\n")}
3) "partes": qué bloques de números generales hacen falta: embudo, whatsapp, redes, productos.
Respondé SOLO JSON: {"entendi":"","consultas":[{"tipo":"","q":""}],"partes":["embudo"]}`, { prioridad: true }).catch(() => null);
  const entendi = corto(plan?.entendi, 700);
  const pedidas = (Array.isArray(plan?.consultas) ? plan.consultas : []).filter((c) => CONSULTAS[c?.tipo]).slice(0, 4);
  const datos = [];
  for (const c of pedidas) { const r = await ejecutarConsulta(env, c).catch(() => null); if (r) datos.push(r); }
  const partes = [...new Set([...Q.partes, ...(Array.isArray(plan?.partes) ? plan.partes : []).filter((p) => ["embudo", "whatsapp", "redes", "productos"].includes(p))])];
  const informes = A === "mesa" ? Object.fromEntries(Object.entries(est.informes).map(([k, v]) => [k, v.datos])) : { [A]: est.informes[A]?.datos || "sin informe hoy", integrador: est.informes.integrador?.datos || "sin lectura hoy", discusion: est.informes.debate?.datos || "no hubo" };

  // Paso 2: contestar
  const r = await iaJSON(env, `CHARLA CON MANUEL. ${Q.rol} Negocio: ${NEGOCIO}
Manuel te habla desde el panel. Tenés los informes de hoy, las hipótesis con su avance medido, los hechos y los datos que se buscaron en la base para esta pregunta.
SI PIDE UNA LISTA (cuáles son, pasame los números, quiénes): dale la lista COMPLETA, un renglón por cada uno con su número de teléfono, sin resumir ni dar "algunos ejemplos"; después, en dos líneas, qué haría con eso. Si pide dos cosas, contestá las dos por separado.
Las ventas "sin confirmar" son posibles ventas: nunca las cuentes como hechas; decí que falta que él las confirme.
CÓMO CONTESTAR: primero la respuesta directa en 1 o 2 líneas; después la evidencia (números, nombres, fechas de los datos de abajo); después qué harías y quién. Contestá también las sub-preguntas de "LO QUE ENTENDIMOS" aunque él no las haya escrito. Si te falta un dato para afirmar algo, decí cuál y cómo medirlo. Si no estás de acuerdo con lo que plantea, decilo con el dato. Texto plano, sin asteriscos ni títulos con numerales.
Si te pide que cambies algo (una decisión, una regla, dejar de hacer algo), guardalo en "guardar" como decisión. Si propone probar algo medible, ponelo en "hipotesis" (métrica de la lista, meta numérica). Si te corrige un análisis, guardá la corrección como aprendizaje y no repitas el error.
${MANUAL.comun}
${A === "mesa" ? "" : MANUAL[A] + "\n"}${REGLAS}
INFORMES DE HOY: ${JSON.stringify(informes)}
HIPÓTESIS: ${JSON.stringify(est.hipotesis.slice(0, 10).map((x) => ({ texto: x.texto, metrica: x.metrica, base: x.base, actual: x.actual, meta: x.meta, vence: x.vence, estado: x.estado })))}
HECHOS:
${textoHechos(h, partes)}
${datos.length ? "DATOS BUSCADOS PARA ESTA PREGUNTA:\n" + datos.join("\n\n") + "\n" : ""}${charla ? "CHARLA RECIENTE:\n" + charla + "\n" : ""}LO QUE ENTENDIMOS DE SU MENSAJE: ${entendi || "(tomalo literal)"}
MANUEL: ${q}
Respondé SOLO JSON: {"respuesta":"texto, con saltos de línea (\\n) entre ideas y un renglón por elemento en las listas","guardar":[{"tipo":"decision|preferencia|aprendizaje","texto":"máximo 250 caracteres"}],"hipotesis":[{"texto":"","accion":"","metrica":"","meta":número,"dias":7}],"seguir":["hasta 2 preguntas cortas que le convendría hacerte después"]}`, { prioridad: true }).catch(() => null);
  const respuesta = r?.respuesta ? String(r.respuesta).replace(/\*\*/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, 9000) : "No pude responder ahora (la IA no tiene cupo). Probá en un rato.";
  await env.DB.batch([env.DB.prepare("INSERT INTO mesa_chat (ts, rol, texto, agente) VALUES (?,?,?,?)").bind(Date.now(), "u", q, A), env.DB.prepare("INSERT INTO mesa_chat (ts, rol, texto, agente) VALUES (?,?,?,?)").bind(Date.now() + 1, "a", respuesta, A)]);
  for (const g of (r?.guardar || []).slice(0, 3)) if (g?.texto) await env.DB.prepare("INSERT INTO ag_mem (ts, tipo, texto) VALUES (?,?,?)").bind(Date.now(), ["decision", "preferencia", "aprendizaje"].includes(g.tipo) ? g.tipo : "aprendizaje", corto(g.texto, 250)).run().catch(() => {});
  if (r?.hipotesis?.length) await crearHipotesis(env, h, "manuel", r.hipotesis);
  return { respuesta, agente: A, entendi: r?.respuesta ? entendi : "", consultas: pedidas.map((c) => c.tipo + (c.q ? ": " + corto(c.q, 40) : "")), seguir: (Array.isArray(r?.seguir) ? r.seguir : []).slice(0, 2).map((x) => corto(x, 140)).filter(Boolean) };
}
export async function apiMesa(env, req, url, iaJSON, body = null) {
  await prepararMesa(env);
  const json = (d) => Response.json(d, { headers: { "Cache-Control": "no-store" } });
  if (req.method !== "POST") {
    if (url.searchParams.get("hechos") === "1") return json(await hechos(env));
    return json(await estadoMesa(env));
  }
  const b = body || (await req.json().catch(() => ({})));   // apiTablero ya leyó el cuerpo: lo recibe por parámetro
  if (b.accion === "correr") { if (!iaJSON) return json({ error: "sin IA" }); const r = await correrMesa(env, iaJSON, { forzar: true, profundo: !!b.profundo, motivo: "panel" }); return json({ ok: r.ok, integrador: r.integrador, cerradas: r.cerradas, sin_ia: !r.ok }); }
  if (b.accion === "preguntar") { if (!iaJSON) return json({ error: "sin IA" }); return json(await preguntarMesa(env, iaJSON, b.pregunta, b.agente)); }
  if (b.accion === "fuentes") {
    const lim = (x) => [...new Set(String(x || "").split(/[\s,;]+/).map((t) => t.trim().replace(/^[@#]/, "").replace(/[^\w.\-áéíóúñ]/gi, "").slice(0, 40)).filter(Boolean))].slice(0, 12);
    const f = { hashtags: lim(b.hashtags), perfiles: lim(b.perfiles) };
    await kvPut(env, "virales_fuentes", JSON.stringify(f)); return json({ ok: true, fuentes: f });
  }
  if (b.accion === "idea" && b.id && ["util", "hecha", "descartada", "nueva"].includes(b.estado)) { await env.DB.prepare("UPDATE mesa_ideas SET estado=?, nota=? WHERE id=?").bind(b.estado, corto(b.nota, 200) || null, String(b.id)).run(); return json({ ok: true }); }
  // "No fue venta": la señal de pago de ese chat deja de contarse (misma marca que usa el panel viejo)
  if (b.accion === "venta_no" && /^\d{8,16}$/.test(String(b.conv || ""))) { await env.DB.batch([env.DB.prepare("UPDATE w_hito SET oculto=1 WHERE conv=? AND tipo IN ('venta','comprobante')").bind(String(b.conv)), env.DB.prepare("INSERT OR REPLACE INTO w_hito (id, conv, tipo, ts, dato) VALUES (?,?,'no_venta',?,'el dueño marcó que no fue venta')").bind("nv:" + b.conv, String(b.conv), Date.now())]); await env.DB.prepare("DELETE FROM kv WHERE k='mesa_hechos'").run().catch(() => {}); return json({ ok: true }); }
  if (b.accion === "virales_leer") { await kvPut(env, "vir_forzar", Date.now()); return json({ ok: true }); }
  if (b.accion === "hipotesis" && b.id && ["descartada", "activa"].includes(b.estado)) { await env.DB.prepare("UPDATE mesa_hip SET estado=? WHERE id=?").bind(b.estado, String(b.id)).run(); return json({ ok: true }); }
  return json({ error: "acción desconocida" });
}
// Tendencias de Mercado Libre leídas desde la PC (sender/tendencias_ml.py)
export async function guardarML(env, b) {
  await prepararMesa(env);
  const items = (Array.isArray(b?.items) ? b.items : []).slice(0, 80).map((t) => ({ palabra: corto(t.palabra, 60), categoria: corto(t.categoria, 40), tipo: corto(t.tipo, 30), puesto: +t.puesto || null, resultados: +t.resultados || null, precio_min: +t.precio_min || null, precio_max: +t.precio_max || null, vendidos: corto(t.vendidos, 30), top: (Array.isArray(t.top) ? t.top : []).slice(0, 5).map((x) => ({ titulo: corto(x.titulo, 80), precio: +x.precio || null, vendidos: corto(x.vendidos, 30) })) })).filter((t) => t.palabra);
  await kvPut(env, "ml_tendencias", JSON.stringify({ ts: Date.now(), items }));
  return { ok: true, guardadas: items.length };
}

// Diagnóstico (solo lectura, con el token del lector): los hechos tal como los ven los agentes y el último estado
export async function diagMesa(env) { const h = await hechos(env); return { texto: textoHechos(h), hechos: h, estado: await estadoMesa(env) }; }
