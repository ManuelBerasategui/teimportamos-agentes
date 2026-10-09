// ============================================================================
// LECTOR 805 — análisis de solo lectura del WhatsApp Business +54 9 341 805-1515
// ----------------------------------------------------------------------------
// El puente (open-bsp-whatsmeow, vinculado como "dispositivo" por QR o código)
// nos postea cada mensaje que entra y sale del 805. Este módulo:
//   - guarda todo en D1 (w_msg, w_conv, w_hito)
//   - cuenta de forma EXACTA (código, no IA): chats nuevos, cotizaciones enviadas,
//     ventas cerradas, mensajes sin responder
//   - con IA (Gemini, gratis) puntúa leads, detecta producto/etapa y sugiere acción
//   - manda alertas y reportes diario/semanal por Telegram (gratis)
// NUNCA envía mensajes de WhatsApp: no existe ninguna llamada al puente que envíe.
// ============================================================================

const AR = 3 * 3600e3;          // Argentina = UTC-3
const LECTOR = {
  analizarPorVuelta: 24,        // chats que analiza la IA por vuelta del cron
  porLlamada: 8,                // chats por llamada a la IA
  mensajesPorChat: 25,          // últimos mensajes que ve la IA de cada chat
  alertaMin: 20,                // minutos sin responder antes de alertar un lead bueno
  alertasPorVuelta: 6,
  horario: [9, 23],             // horas AR en que se mandan alertas
};

// ---- Señales exactas (código) ----
const RE_COTIZ = /cotizaci[oó]n|total puesto|puesto en (argentina|tu casa|rosario)|precio final|te queda(r[ií]a)? (en|a)\b|sale en total|total:?\s*(usd|u\$s|us\$|\$)|precio unitario|costo mercader[ií]a/i;
const RE_PAGO_CLIENTE = /comprobante|transfer[ií]|ya (te )?(transfer|pagu|deposit|mand[eé] (el|la) (pago|seña|plata))|pagu[eé]|abon[eé]|(ah[ií]|ya) (va|est[aá]) (la seña|el pago)|te (envi|mand)[eé] (la seña|el pago)/i;
const RE_PAGO_NOSOTROS = /recib[ií](mos)? (el|tu|la) (pago|transferencia|comprobante|seña)|pago (confirmado|recibido|acreditado)|confirm(o|amos) (el|tu|la) (pago|seña|transferencia)|(ya )?qued[oó] (confirmado|se[ñn]ado|reservado) (el|tu) pedido|acredit[oó]/i;

// Cotización = mensaje NUESTRO con un monto y palabras de precio final (no difusiones ni avisos de cupos)
const RE_MONTO = /(usd|u\$s|us\$|\$|d[oó]lares)\s*\d|\d[\d.,]*\s*(usd|u\$s|d[oó]lares|pesos)\b/i;
const RE_PALABRA_COT = /total|c\/u|por unidad|cada un[oa]|puesto en|precio final|te queda|sale en total|precio unitario|cotizaci[oó]n/i;
const RE_NO_COT = /cupo|abrimos|promo|oferta del d[ií]a|seguimos atendiendo|manden sus productos|difusi[oó]n/i;
const esCotizacion = (t) => { t = String(t || ""); return RE_MONTO.test(t) && RE_PALABRA_COT.test(t) && !RE_NO_COT.test(t); };
const esGrupo = (conv) => /@|g\.us|-/.test(String(conv));
const diaAR = (ts) => new Date(ts - AR).toISOString().slice(0, 10);
const inicioDiaAR = (ts = Date.now()) => Date.parse(diaAR(ts) + "T00:00:00Z") + AR;
const horaAR = (ts = Date.now()) => new Date(ts - AR).getUTCHours();
const fechaHora = (ts) => new Date(ts - AR).toISOString().slice(5, 16).replace("T", " ").replace(/^(\d\d)-(\d\d)/, "$2/$1");

let tablasLector = false;
export async function prepararLector(env) {
  if (tablasLector || !env.DB) return;
  await env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS w_msg (id TEXT PRIMARY KEY, conv TEXT, grupo INTEGER, yo INTEGER, autor TEXT, autor_nombre TEXT, tipo TEXT, texto TEXT, ts INTEGER, hist INTEGER)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS w_msg_conv ON w_msg(conv, ts)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS w_msg_ts ON w_msg(ts)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS w_conv (conv TEXT PRIMARY KEY, nombre TEXT, grupo INTEGER, primer_ts INTEGER, ult_ts INTEGER, ult_yo INTEGER, ult_cliente_ts INTEGER DEFAULT 0, ult_yo_ts INTEGER DEFAULT 0, ult_texto TEXT, n INTEGER DEFAULT 0, analizado_ts INTEGER DEFAULT 0, puntaje INTEGER, temp TEXT, producto TEXT, etapa TEXT, accion TEXT, resumen TEXT, cot_pend INTEGER DEFAULT 0, alerta_ts INTEGER DEFAULT 0, archivado INTEGER DEFAULT 0)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS w_conv_ult ON w_conv(ult_ts)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS w_conv_primer ON w_conv(primer_ts)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS w_conv_cli ON w_conv(ult_cliente_ts)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS w_hito (id TEXT PRIMARY KEY, conv TEXT, tipo TEXT, ts INTEGER, dato TEXT)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS w_hito_tipo ON w_hito(tipo, ts)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS w_audit (conv TEXT, dia TEXT, ts INTEGER, PRIMARY KEY (conv, dia))"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS tareas (id TEXT PRIMARY KEY, ts INTEGER, tipo TEXT, tel TEXT, nombre TEXT, titulo TEXT, detalle TEXT, datos TEXT, ref TEXT, estado TEXT)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS reportes (id TEXT PRIMARY KEY, tipo TEXT, desde INTEGER, hasta INTEGER, creado INTEGER, datos TEXT)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT, exp INTEGER)"),
  ]);
  for (const col of ["resp INTEGER", "visto_ts INTEGER DEFAULT 0", "prov INTEGER DEFAULT 0", "visto_esc INTEGER DEFAULT 0", "visto_cot INTEGER DEFAULT 0"]) await env.DB.prepare(`ALTER TABLE w_conv ADD COLUMN ${col}`).run().catch(() => {});
  await env.DB.prepare("ALTER TABLE w_hito ADD COLUMN oculto INTEGER DEFAULT 0").run().catch(() => {});
  tablasLector = true;
}

const kvGet = async (env, k) => (await env.DB.prepare("SELECT v FROM kv WHERE k=?").bind(k).first())?.v ?? null;
const kvPut = (env, k, v) => env.DB.prepare("INSERT INTO kv (k,v,exp) VALUES (?,?,NULL) ON CONFLICT(k) DO UPDATE SET v=excluded.v, exp=NULL").bind(k, String(v)).run();

// ---------------------------------------------------------------------------
// 1) Entrada desde el puente
// ---------------------------------------------------------------------------
function autorizado(env, req) {
  const t = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  return !!env.LECTOR_TOKEN && t === env.LECTOR_TOKEN;
}

export async function rutaLector(env, req, url, ctx) {
  // Dos formas de autenticarse: header "Bearer LECTOR_TOKEN" (puente propio) o la clave en la
  // dirección /lector/<LECTOR_TOKEN>/... (puente hospedado por OpenBSP, que manda su propio token)
  let p = url.pathname.replace(/^\/lector/, "");
  const enRuta = p.split("/")[1] || "";
  let ok = autorizado(env, req);
  if (!ok && env.LECTOR_TOKEN && enRuta === env.LECTOR_TOKEN) { ok = true; p = p.slice(enRuta.length + 1); }
  if (!ok) return new Response("no autorizado", { status: 401 });
  await prepararLector(env);
  // Las fotos/audios NO se guardan (no hace falta para analizar y D1 no es para archivos):
  // el puente marca el mensaje como "media" y sigue.
  if (p === "/whatsapp-web-webhook/media") return new Response("no guardamos archivos", { status: 402 });
  // QR de vinculación: Termux lo sube y el panel lo muestra (para escanearlo con el celular del 805)
  if (p === "/qr" && req.method === "POST") {
    const b = await req.json().catch(() => ({}));
    await kvPut(env, "lector_qr", JSON.stringify({ qr: String(b.qr || "").slice(0, 2000), estado: String(b.estado || ""), ts: Date.now() }));
    return Response.json({ ok: true });
  }
  if (p === "/whatsapp-web-management/sessions/events") {
    const ev = await req.json().catch(() => ({}));
    await kvPut(env, "lector_estado", JSON.stringify({ evento: ev.event, numero: ev.address, cuando: Date.now() }));
    if (ev.event === "logged_out") ctx?.waitUntil(telegram(env, "⚠️ El WhatsApp 805 se desvinculó del lector. Hay que volver a vincularlo."));
    return Response.json({ ok: true });
  }
  if (p === "/whatsapp-web-webhook") {
    const lote = await req.json().catch(() => null);
    if (!lote) return new Response("json inválido", { status: 400 });
    const n = await guardarLote(env, lote);
    if (!lote.history && n.clienteNuevo) ctx?.waitUntil(alertasRapidas(env).catch(() => {}));
    return Response.json({ ok: true, guardados: n.mensajes });
  }
  return new Response("no existe", { status: 404 });
}

function textoDe(c = {}) {
  const k = c.kind || c.type || "";
  if (k === "reaction") return null;                       // reacciones: no cuentan
  if (c.text) return (c.type === "file" ? `(${k}) ` : "") + c.text;
  if (c.type === "file" || k === "media_placeholder") return `(${k === "media_placeholder" ? "archivo" : k})`;
  if (k === "location") return "(ubicación)";
  if (k === "contacts" || k === "contact") return "(contacto)";
  return k ? `(${k})` : "";
}

// El número propio (el 805): sus mensajes son "nosotros" aunque lleguen con remitente
const soloDigitos = (x) => String(x || "").replace(/\D/g, "");
const NUMERO_PROPIO = "5493418051515";
function esPropio(env, remitente, org) {
  const d = soloDigitos(String(remitente || "").split("@")[0].split(":")[0]);
  if (!d) return true;
  const propios = [NUMERO_PROPIO, soloDigitos(org), soloDigitos(env.LECTOR_NUMERO)].filter(Boolean);
  return propios.some((p) => d === p || d.slice(-10) === p.slice(-10));
}

async function guardarLote(env, lote) {
  const hist = lote.history ? 1 : 0;
  const ops = [];
  let mensajes = 0, clienteNuevo = false;
  const convs = new Map();
  for (const m of lote.messages || []) {
    const texto = textoDe(m.content);
    if (texto === null) continue;
    const ts = Date.parse(m.timestamp) || Date.now();
    const conv = m.conversation_address;
    if (!conv || /status@broadcast|newsletter/.test(conv)) continue;
    if (hist && (esGrupo(conv) || ts < Date.now() - 7 * 86400e3)) continue;   // ahorro: el historial de grupos y lo viejo no se guarda
    const yo = esPropio(env, m.sender_address, lote.organization_address) ? 1 : 0;
    const grupo = esGrupo(conv) ? 1 : 0;
    const tipo = m.content?.kind || m.content?.type || "text";
    ops.push(env.DB.prepare("INSERT OR IGNORE INTO w_msg (id,conv,grupo,yo,autor,autor_nombre,tipo,texto,ts,hist) VALUES (?,?,?,?,?,?,?,?,?,?)")
      .bind(m.external_id, conv, grupo, yo, m.sender_address || null, m.sender_name || null, tipo, String(texto).slice(0, 4000), ts, hist));
    mensajes++;
    const c = convs.get(conv) || { conv, grupo, nombre: null, primer: ts, ult: 0, ultYo: 0, ultCli: 0, ultYoTs: 0, texto: "", n: 0 };
    if (!grupo && !yo && m.sender_name && !/^te importamos/i.test(m.sender_name)) c.nombre = m.sender_name;
    if (m.conversation_name && (grupo || !/^te importamos/i.test(m.conversation_name))) c.nombre = m.conversation_name;
    c.primer = Math.min(c.primer, ts); c.n++;
    if (ts >= c.ult) { c.ult = ts; c.ultYo = yo; c.texto = String(texto).slice(0, 200); }
    if (yo) c.ultYoTs = Math.max(c.ultYoTs, ts); else c.ultCli = Math.max(c.ultCli, ts);
    convs.set(conv, c);
    // Hitos exactos (solo chats individuales)
    if (!grupo) {
      if (yo && esCotizacion(texto)) ops.push(env.DB.prepare("INSERT OR IGNORE INTO w_hito (id,conv,tipo,ts,dato) VALUES (?,?,?,?,?)").bind("c:" + m.external_id, conv, "cotizacion", ts, String(texto).slice(0, 300)));
      const pago = (!yo && (/^\((image|document)\)/.test(texto) || tipo === "image" || tipo === "document") && RE_PAGO_CLIENTE.test(texto)) || (!yo && RE_PAGO_CLIENTE.test(texto) && /comprobante/i.test(texto)) || (yo && RE_PAGO_NOSOTROS.test(texto));
      if (pago) ops.push(env.DB.prepare("INSERT OR IGNORE INTO w_hito (id,conv,tipo,ts,dato) VALUES (?,?,?,?,?)").bind(`v:${conv}:${diaAR(ts)}`, conv, "venta", ts, String(texto).slice(0, 300)));
      if (!yo && !hist) clienteNuevo = true;
    }
  }
  for (const c of convs.values()) {
    ops.push(env.DB.prepare(`INSERT INTO w_conv (conv,nombre,grupo,primer_ts,ult_ts,ult_yo,ult_cliente_ts,ult_yo_ts,ult_texto,n) VALUES (?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(conv) DO UPDATE SET
        nombre = COALESCE(excluded.nombre, w_conv.nombre),
        primer_ts = MIN(w_conv.primer_ts, excluded.primer_ts),
        ult_yo = CASE WHEN excluded.ult_ts >= w_conv.ult_ts THEN excluded.ult_yo ELSE w_conv.ult_yo END,
        ult_texto = CASE WHEN excluded.ult_ts >= w_conv.ult_ts THEN excluded.ult_texto ELSE w_conv.ult_texto END,
        ult_ts = MAX(w_conv.ult_ts, excluded.ult_ts),
        ult_cliente_ts = MAX(w_conv.ult_cliente_ts, excluded.ult_cliente_ts),
        ult_yo_ts = MAX(w_conv.ult_yo_ts, excluded.ult_yo_ts),
        n = w_conv.n + excluded.n`)
      .bind(c.conv, c.nombre, c.grupo, c.primer, c.ult, c.ultYo, c.ultCli, c.ultYoTs, c.texto, c.n));
  }
  // D1 acepta lotes grandes, pero se parte por las dudas (historial inicial)
  for (let i = 0; i < ops.length; i += 80) await env.DB.batch(ops.slice(i, i + 80));
  if (mensajes) await kvPut(env, "lector_ultimo", Date.now());
  return { mensajes, clienteNuevo };
}

// ---------------------------------------------------------------------------
// 2) Métricas exactas
// ---------------------------------------------------------------------------
export async function metricas(env, desde, hasta = Date.now()) {
  // Liviano: usa índices (w_conv por fechas, w_hito por tipo) y nunca recorre todos los mensajes
  const q = (sql, ...b) => env.DB.prepare(sql).bind(...b).first();
  const [nuevos, activos, cot, cotChats, ventas, sinResp] = await Promise.all([
    q("SELECT COUNT(*) n FROM w_conv WHERE primer_ts>=? AND primer_ts<? AND grupo=0", desde, hasta),
    q("SELECT COUNT(*) n FROM w_conv WHERE ult_ts>=? AND ult_ts<? AND grupo=0", desde, hasta),
    q("SELECT COUNT(*) n FROM w_hito WHERE tipo='cotizacion' AND ts>=? AND ts<?", desde, hasta),
    q("SELECT COUNT(DISTINCT conv) n FROM w_hito WHERE tipo='cotizacion' AND ts>=? AND ts<?", desde, hasta),
    q("SELECT COUNT(*) n FROM w_hito h LEFT JOIN w_conv c ON c.conv=h.conv WHERE h.tipo='venta' AND h.ts>=? AND h.ts<? AND COALESCE(h.oculto,0)=0 AND COALESCE(c.prov,0)=0", desde, hasta),
    q("SELECT COUNT(*) n FROM w_conv WHERE ult_cliente_ts>=? AND grupo=0 AND archivado=0 AND ult_yo=0 AND COALESCE(resp,1)=1 AND ult_cliente_ts>COALESCE(visto_ts,0) AND COALESCE(etapa,'')<>'no_cliente'", Date.now() - 72 * 3600e3),
  ]);
  // Tiempo de respuesta: solo con los mensajes de las últimas 24 h del período (acotado)
  const desdeResp = Math.max(desde, hasta - 86400e3);
  const filas = (await env.DB.prepare("SELECT conv, yo, ts FROM w_msg WHERE ts>=? AND ts<? AND grupo=0 AND hist=0 ORDER BY conv, ts LIMIT 4000").bind(desdeResp, hasta).all()).results || [];
  const esperas = []; let conv = null, esperando = null;
  for (const f of filas) {
    if (f.conv !== conv) { conv = f.conv; esperando = null; }
    if (!f.yo && esperando === null) esperando = f.ts;
    if (f.yo && esperando !== null) { esperas.push((f.ts - esperando) / 60000); esperando = null; }
  }
  esperas.sort((a, b) => a - b);
  return {
    nuevos: nuevos?.n || 0, activos: activos?.n || 0, cotizaciones: cot?.n || 0, chatsCotizados: cotChats?.n || 0,
    ventas: ventas?.n || 0, sinResponder: sinResp?.n || 0,
    respuestaMin: esperas.length ? Math.round(esperas[Math.floor(esperas.length / 2)]) : null,
    conversion: cotChats?.n ? Math.round(((ventas?.n || 0) / cotChats.n) * 100) : null,
  };
}

// ---------------------------------------------------------------------------
// 3) Análisis con IA: puntaje del lead, producto, etapa y qué hacer
// ---------------------------------------------------------------------------
export async function analizarChats(env, iaJSON, { limite = LECTOR.analizarPorVuelta, forzar = false } = {}) {
  await prepararLector(env);
  const convs = (await env.DB.prepare(`SELECT * FROM w_conv WHERE grupo=0 AND archivado=0 AND ult_ts > ? ${forzar ? "" : "AND ult_ts > analizado_ts"} ORDER BY ult_ts DESC LIMIT ?`)
    .bind(Date.now() - 14 * 86400e3, limite).all()).results || [];
  let hechos = 0;
  for (let i = 0; i < convs.length; i += LECTOR.porLlamada) {
    const tanda = convs.slice(i, i + LECTOR.porLlamada);
    const bloques = [];
    for (const c of tanda) {
      const ms = ((await env.DB.prepare("SELECT yo, texto, ts FROM w_msg WHERE conv=? ORDER BY ts DESC LIMIT ?").bind(c.conv, LECTOR.mensajesPorChat).all()).results || []).reverse();
      bloques.push(`### CHAT ${c.conv} (${c.nombre || "sin nombre"})\n` + ms.map((m) => `[${fechaHora(m.ts)}] ${m.yo ? "NOSOTROS" : "CLIENTE"}: ${String(m.texto).slice(0, 400)}`).join("\n"));
    }
    const r = await iaJSON(env, `Sos analista comercial de "Te Importamos" (importaciones desde China/EE.UU., catálogo de stock, combos para revender; Rosario, Argentina).
Leé cada chat de WhatsApp y devolvé SOLO datos reales del chat (no inventes). Ahora es ${fechaHora(Date.now())} (hora Argentina).
Para cada chat devolvé:
- conv: el id exacto del chat
- puntaje: 1-10 calidad del lead (10 = quiere comprar ya y tiene presupuesto; 7-9 = interés concreto con producto y cantidad; 4-6 = curioso con algo de interés; 1-3 = no es cliente, spam, solo saluda, proveedor, conocido)
- temp: "caliente" | "tibio" | "frio"
- producto: qué quiere (2-6 palabras) o "" si no dijo
- etapa: "consulta" | "falta_cotizar" | "cotizado" | "negociando" | "vendido" | "perdido" | "no_cliente"
- cot_pend: true si el cliente espera que le mandemos una cotización/precio y todavía no se la mandamos
- accion: qué tenemos que hacer AHORA, concreto y corto (ej. "mandale la cotización de las 50 tarjetas NFC", "respondele si el envío llega a Tierra del Fuego", "escribile ofreciendo 10% off, quedó en pensarlo"). "" si no hace falta nada.
- prioridad: 1 (urgente) a 3 (puede esperar)
- necesita_respuesta: true si el ÚLTIMO mensaje del chat es del CLIENTE y espera algo de nosotros (una pregunta, un pedido, datos, una foto, una duda). false si el último mensaje del cliente es un cierre o acuse ("dale", "ok", "gracias", "perfecto", "lo pienso", "te aviso", "cuando tenga todo te hago el pedido", un sticker o emoji), o si el último mensaje es nuestro.
- es_proveedor: true si el chat es con un PROVEEDOR, mayorista, fábrica o tienda a la que NOSOTROS le compramos (nosotros pedimos precios, nosotros pagamos/transferimos, ellos nos venden). false si es un cliente que nos compra a nosotros.
- venta_real: true solo si en este chat un CLIENTE nos compró: nos pagó una seña o el total (mandó comprobante, confirmamos su pago). false si fuimos nosotros los que pagamos a un proveedor, o si todavía no pagó.
- pendiente: lo que NOSOTROS tenemos pendiente con este cliente AHORA, o null si no hay nada. {"tipo": uno de
    "cotizacion" (pidió precio/cotización y todavía no se la mandamos),
    "promesa" (le dijimos "ya te paso", "te averiguo", "mañana te mando", "te armo por 80 y 100", etc. y todavía no lo cumplimos),
    "comprobante" (nos pagó o mandó comprobante/seña: hay que confirmarle y hacer el pedido al proveedor),
    "proveedor" (hay que buscar proveedor o averiguar algo con un proveedor para poder avanzar),
   "titulo": máximo 8 palabras concretas (ej. "Cotizar 50 tarjetas NFC", "Pasarle cotización por 80 y 100 u"), "detalle": 1 oración}.
   Si ya lo cumplimos más abajo en el chat, o el cliente cerró la charla, o no es cliente: null.
- Si es_proveedor es true: etapa "no_cliente", puntaje 1, cot_pend false, venta_real false.
- Consultas por vapers, vapes, pods o tabaco: etapa "no_cliente" (no los trabajamos; los atiende el socio por otro canal).
- resumen: 1 oración con lo esencial (nombre, producto, cantidad, en qué quedó)
Respondé JSON: {"chats":[{...}]}

${bloques.join("\n\n")}`);
    const lista = Array.isArray(r?.chats) ? r.chats : [];
    const ops = [];
    for (const a of lista) {
      const c = tanda.find((x) => x.conv === String(a.conv));
      if (!c) continue;
      ops.push(env.DB.prepare("UPDATE w_conv SET analizado_ts=?, puntaje=?, temp=?, producto=?, etapa=?, accion=?, resumen=?, cot_pend=?, resp=?, prov=? WHERE conv=?")
        .bind(Date.now(), Math.max(1, Math.min(10, parseInt(a.puntaje) || 1)), String(a.temp || ""), String(a.producto || "").slice(0, 80), String(a.etapa || ""), String(a.accion || "").slice(0, 300) + (a.prioridad ? `|p${a.prioridad}` : ""), String(a.resumen || "").slice(0, 400), a.cot_pend ? 1 : 0, a.necesita_respuesta === false ? 0 : 1, a.es_proveedor ? 1 : 0, c.conv));
      if (a.es_proveedor) ops.push(env.DB.prepare("UPDATE w_hito SET oculto=1 WHERE conv=? AND tipo='venta'").bind(c.conv));
      else if (a.venta_real) ops.push(env.DB.prepare("INSERT OR IGNORE INTO w_hito (id,conv,tipo,ts,dato) SELECT ?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM w_hito WHERE conv=? AND tipo='venta' AND ts>=?)").bind(`v:${c.conv}:${diaAR(c.ult_ts || Date.now())}`, c.conv, "venta", c.ult_ts || Date.now(), String(a.resumen || "venta").slice(0, 300), c.conv, Date.now() - 30 * 86400e3));
      ops.push(...pendienteOps(env, c, a.es_proveedor || a.etapa === "no_cliente" ? null : a.pendiente));
      hechos++;
    }
    // Los que la IA no devolvió quedan para la próxima vuelta (no se marcan como analizados)
    if (ops.length) await env.DB.batch(ops);
  }
  return hechos;
}

// Pendientes del panel que salen del análisis del 805 (uno abierto por chat como máximo)
const TIPOS_PEND = { cotizacion: "cotizacion", promesa: "promesa", comprobante: "comprobante", proveedor: "proveedor" };
function pendienteOps(env, c, p) {
  const tipo = p && TIPOS_PEND[p.tipo];
  if (!tipo) return [env.DB.prepare("UPDATE tareas SET estado='hecha' WHERE ref=? AND estado='abierta'").bind("w805:" + c.conv)];
  const id = `w805:${c.conv}:${tipo}:${diaAR(Date.now())}`;
  return [
    env.DB.prepare("UPDATE tareas SET estado='hecha' WHERE ref=? AND estado='abierta' AND id<>? AND tipo<>?").bind("w805:" + c.conv, id, tipo),
    env.DB.prepare("INSERT INTO tareas (id, ts, tipo, tel, nombre, titulo, detalle, datos, ref, estado) SELECT ?,?,?,?,?,?,?,?,?,'abierta' WHERE NOT EXISTS (SELECT 1 FROM tareas WHERE ref=? AND tipo=? AND (estado='abierta' OR ts>=?))")
      .bind(id, Date.now(), tipo, c.conv, c.nombre || "", String(p.titulo || "").slice(0, 90), String(p.detalle || "").slice(0, 400), JSON.stringify({ origen: "805" }), "w805:" + c.conv, "w805:" + c.conv, tipo, c.ult_cliente_ts || 0),
  ];
}

// ---------------------------------------------------------------------------
// 3b) Auditoría de cotizaciones: la IA lee el día completo de cada chat y cuenta las cotizaciones que
// mandamos (texto, capturas o PDF: los adjuntos llegan como "(archivo)", se deducen por el contexto)
// ---------------------------------------------------------------------------
export async function auditarCotizaciones(env, iaJSON, { limite = 30, dia = null, conv = null, debug = false, rehacer = false } = {}) {
  await prepararLector(env);
  const desde = dia ? Date.parse(dia + "T00:00:00Z") + AR : Math.max(Date.parse("2026-10-07T00:00:00Z") + AR, Date.now() - 4 * 86400e3);
  const hasta = dia ? desde + 86400e3 : Date.now();
  const pares = (await env.DB.prepare(`SELECT m.conv, MAX(m.ts) ult, MIN(m.ts) pri FROM w_msg m WHERE m.ts>=? AND m.ts<? AND m.yo=1 AND m.grupo=0 GROUP BY m.conv, date((m.ts-${AR})/1000,'unixepoch')`).bind(desde, hasta).all()).results || [];
  const pend = [];
  for (const p of pares) {
    if (conv && p.conv !== conv) continue;
    const d = diaAR(p.pri);
    const a = await env.DB.prepare("SELECT ts FROM w_audit WHERE conv=? AND dia=?").bind(p.conv, d).first();
    if (debug || rehacer || !a || a.ts < p.ult) pend.push({ conv: p.conv, dia: d });
    if (pend.length >= limite) break;
  }
  let hechos = 0;
  for (let i = 0; i < pend.length; i += 6) {
    const tanda = pend.slice(i, i + 6), bloques = [], mapa = {};
    for (const t of tanda) {
      const ini = Date.parse(t.dia + "T00:00:00Z") + AR;
      const c = await env.DB.prepare("SELECT nombre, prov, etapa FROM w_conv WHERE conv=?").bind(t.conv).first();
      const ms = (await env.DB.prepare("SELECT id, yo, texto, ts FROM w_msg WHERE conv=? AND ts>=? AND ts<? ORDER BY ts LIMIT 160").bind(t.conv, ini - 6 * 3600e3, ini + 86400e3).all()).results || [];
      t.prov = c?.prov || 0; t.ini = ini; t.ms = ms;
      const k = `${t.conv}|${t.dia}`; mapa[k] = t;
      bloques.push(`### CHAT ${k} (${c?.nombre || "sin nombre"})
` + ms.map((m, n) => `${m.ts < ini ? "(día anterior) " : ""}#${n} ${m.yo ? "NOSOTROS" : "CLIENTE"}: ${String(m.texto).slice(0, 300)}`).join("\n"));
    }
    const r = await iaJSON(env, `Sos auditor de "Te Importamos" (importación por encargo). Contá las COTIZACIONES que NOSOTROS le mandamos al cliente en cada chat, solo en los mensajes que NO dicen "(día anterior)".
Una cotización es cuando le pasamos al cliente el precio de lo que pidió (precio puesto en Argentina, total, unitario, por cantidad), ya sea en texto, en una captura o en un PDF.
Los adjuntos (fotos, capturas, PDF) aparecen como "(archivo)" o con su texto al pie: deducí por el contexto si eran la cotización (ej. "ahi te cotizo" + (archivo); "ahi esta por 50 unidades"; (archivo) y después el cliente pregunta "¿ese precio es puesto acá?", "le falta un 0 al flete?", "me quedaria en..."; "te armo por 80 y 100" + (archivo)).
Varios archivos seguidos del mismo producto = UNA cotización. Una cotización nueva por otra cantidad u otro producto = otra cotización.
NO cuentan: catálogos o listas generales de precios ("PRECIOS MAYORISTA DE ZAPATILLAS", PDF de catálogo), fotos de productos de ejemplo, datos de pago o envío, mensajes automáticos, chats con proveedores (cuando NOSOTROS le compramos a ellos) ni charlas internas del equipo.
Devolvé JSON: {"chats":[{"chat":"id exacto","interno":true SOLO si es una charla entre socios del equipo o con un proveedor al que le compramos (si no, false),"cotizaciones":[{"msg":número del mensaje (#) donde se mandó,"producto":"2-5 palabras"}]}]}

${bloques.join("\n\n")}`);
    if (debug) return { r, prompt: bloques.join("\n\n").slice(0, 6000) };
    if (!r || !Array.isArray(r.chats)) continue;
    const ops = [];
    for (const a of r.chats) {
      const t = mapa[String(a.chat)]; if (!t) continue;
      ops.push(env.DB.prepare("DELETE FROM w_hito WHERE conv=? AND tipo='cotizacion' AND ts>=? AND ts<?").bind(t.conv, t.ini, t.ini + 86400e3));
      // Una cotización = una tanda al mismo cliente: lo que se manda dentro de 30 min cuenta como una sola
      const qs = (!t.prov && a.interno !== true ? a.cotizaciones || [] : [])
        .filter((q) => !/\bvap\w*|elf ?bar|ice king|ignite|\bpods?\b/i.test(String(q.producto || "")))
        .map((q) => { const m = t.ms[parseInt(q.msg)]; return { ...q, ts: m && m.ts >= t.ini ? m.ts : t.ini + 12 * 3600e3 }; })
        .sort((x, y) => x.ts - y.ts);
      let ultQ = 0;
      for (const q of qs.slice(0, 10)) {
        if (q.ts - ultQ < 30 * 60e3) continue;
        ultQ = q.ts; const ts = q.ts;
        ops.push(env.DB.prepare("INSERT OR IGNORE INTO w_hito (id,conv,tipo,ts,dato) VALUES (?,?,?,?,?)").bind(`ci:${t.conv}:${ts}`, t.conv, "cotizacion", ts, String(q.producto || "").slice(0, 120)));
      }
      ops.push(env.DB.prepare("INSERT INTO w_audit (conv, dia, ts) VALUES (?,?,?) ON CONFLICT(conv, dia) DO UPDATE SET ts=excluded.ts").bind(t.conv, t.dia, Date.now()));
      hechos++;
    }
    if (ops.length) await env.DB.batch(ops);
  }
  return { auditados: hechos, pendientes: pend.length };
}

// ---------------------------------------------------------------------------
// 4) Listas para el panel y las alertas
// ---------------------------------------------------------------------------
export async function listas(env) {
  const q = async (sql, ...b) => (await env.DB.prepare(sql).bind(...b).all()).results || [];
  const hace72 = Date.now() - 72 * 3600e3;
  const [sinResponder, escribiles, cotPend, ventasRec] = await Promise.all([
    q("SELECT * FROM w_conv WHERE ult_cliente_ts>=? AND grupo=0 AND archivado=0 AND ult_yo=0 AND COALESCE(resp,1)=1 AND ult_cliente_ts>COALESCE(visto_ts,0) AND COALESCE(etapa,'')<>'no_cliente' ORDER BY COALESCE(puntaje,5) DESC, ult_cliente_ts ASC LIMIT 60", hace72),
    q("SELECT * FROM w_conv WHERE grupo=0 AND archivado=0 AND COALESCE(prov,0)=0 AND COALESCE(visto_esc,0)<ult_ts AND puntaje>=6 AND accion<>'' AND etapa NOT IN ('vendido','perdido','no_cliente') AND ult_ts>=? ORDER BY puntaje DESC, ult_ts DESC LIMIT 40", Date.now() - 10 * 86400e3),
    q("SELECT * FROM w_conv WHERE ult_ts>=? AND grupo=0 AND archivado=0 AND cot_pend=1 AND COALESCE(prov,0)=0 AND COALESCE(visto_cot,0)<ult_ts ORDER BY ult_cliente_ts ASC LIMIT 40", Date.now() - 14 * 86400e3),
    q("SELECT h.id, h.ts, h.dato, c.conv, c.nombre, c.producto FROM w_hito h LEFT JOIN w_conv c ON c.conv=h.conv WHERE h.tipo='venta' AND COALESCE(h.oculto,0)=0 AND COALESCE(c.prov,0)=0 ORDER BY h.ts DESC LIMIT 20"),
  ]);
  return { sinResponder, escribiles, cotPend, ventasRec };
}

// ---------------------------------------------------------------------------
// 5) Telegram (alertas y reportes al celular, gratis)
// ---------------------------------------------------------------------------
export async function telegram(env, texto) {
  const chat = env.TELEGRAM_CHAT || (await kvGet(env, "telegram_chat"));
  if (!env.TELEGRAM_TOKEN || !chat) return false;
  const r = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/sendMessage`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chat, text: String(texto).slice(0, 4000), disable_web_page_preview: true }),
  }).catch(() => null);
  return !!r?.ok;
}

// El usuario le escribe /start al bot y toca "Conectar Telegram" en el panel: se guarda su chat
export async function vincularTelegram(env) {
  if (!env.TELEGRAM_TOKEN) return { ok: false, error: "Falta cargar TELEGRAM_TOKEN en Cloudflare" };
  const r = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/getUpdates`).then((x) => x.json()).catch(() => null);
  const ult = (r?.result || []).map((u) => u.message?.chat).filter(Boolean).pop();
  if (!ult) return { ok: false, error: "Escribile /start a tu bot en Telegram y volvé a tocar el botón" };
  await kvPut(env, "telegram_chat", ult.id);
  await telegram(env, "✅ Listo, acá te van a llegar las alertas y los reportes del 805.");
  return { ok: true, nombre: ult.first_name || ult.title || "" };
}

const link = (env, conv) => `${env.PUBLIC_URL || "https://cotizador.berasateguimanuel07.workers.dev"}/panel/805#${encodeURIComponent(conv)}`;
const telefono = (conv) => (/^\d+$/.test(conv) ? "+" + conv : conv);

// Alerta: lead bueno que escribió y nadie le contestó
export async function alertasRapidas(env) {
  // Solo lo importante, todo junto en UN mensaje: espera cotización o lead muy caliente, más de 1 h sin respuesta, y una vez por día por chat
  const h = horaAR();
  if (h < LECTOR.horario[0] || h >= LECTOR.horario[1]) return 0;
  const filas = (await env.DB.prepare(`SELECT * FROM w_conv WHERE grupo=0 AND archivado=0 AND ult_yo=0 AND COALESCE(resp,1)=1 AND COALESCE(prov,0)=0 AND ult_cliente_ts>COALESCE(visto_ts,0) AND COALESCE(etapa,'')<>'no_cliente' AND ult_cliente_ts<=? AND ult_cliente_ts>=? AND alerta_ts<?
      AND (puntaje>=8 OR (cot_pend=1 AND puntaje>=6)) ORDER BY puntaje DESC LIMIT 5`)
    .bind(Date.now() - 60 * 60e3, Date.now() - 24 * 3600e3, Date.now() - 20 * 3600e3).all()).results || [];
  if (!filas.length) return 0;
  const lineas = filas.map((c) => { const min = Math.round((Date.now() - c.ult_cliente_ts) / 60000); return `• ${c.nombre || telefono(c.conv)} (${c.puntaje}/10, hace ${min >= 120 ? Math.round(min / 60) + " h" : min + " min"}): ${String(c.accion || c.ult_texto || "").replace(/\|p\d$/, "").slice(0, 120)}`; });
  const ok = await telegram(env, `Importante: ${filas.length === 1 ? "1 cliente espera" : filas.length + " clientes esperan"} respuesta\n${lineas.join("\n")}\n${(env.PUBLIC_URL || "https://cotizador.berasateguimanuel07.workers.dev") + "/panel"}`);
  if (ok) await env.DB.batch(filas.map((c) => env.DB.prepare("UPDATE w_conv SET alerta_ts=? WHERE conv=?").bind(Date.now(), c.conv)));
  return filas.length;
}

// ---------------------------------------------------------------------------
// 6) Reportes diario y semanal
// ---------------------------------------------------------------------------
export async function generarReporte(env, iaJSON, tipo = "805_diario", hasta = Date.now(), estricto = false) {
  await prepararLector(env);
  const dias = tipo === "805_semanal" ? 7 : 1;
  const finDia = inicioDiaAR(hasta) + 86400e3;
  const desde = finDia - dias * 86400e3;
  const fin = Math.min(finDia, Date.now());
  if (dias === 1) { const au = await auditarCotizaciones(env, iaJSON, { dia: diaAR(desde), limite: 40 }).catch(() => null); if (estricto && au && au.pendientes > au.auditados && Date.now() - fin < 6 * 3600e3) throw new Error("faltan chats por auditar"); }
  const m = await metricas(env, desde, fin);
  const prev = await metricas(env, desde - dias * 86400e3, desde);
  const l = await listas(env);
  const productos = (await env.DB.prepare("SELECT producto, COUNT(*) n FROM w_conv WHERE grupo=0 AND producto<>'' AND COALESCE(etapa,'')<>'no_cliente' AND lower(producto) NOT LIKE '%vap%' AND lower(producto) NOT LIKE '%elf%bar%' AND ult_ts>=? AND ult_ts<? GROUP BY lower(producto) ORDER BY n DESC LIMIT 12").bind(desde, fin).all()).results || [];
  // Lo que se habló en grupos (para que la IA lo resuma)
  const grupos = (await env.DB.prepare("SELECT c.nombre, m.texto FROM w_msg m LEFT JOIN w_conv c ON c.conv=m.conv WHERE m.grupo=1 AND m.yo=0 AND m.ts>=? AND m.ts<? ORDER BY m.ts DESC LIMIT 150").bind(desde, fin).all()).results || [];
  const chatsDia = (await env.DB.prepare("SELECT nombre, conv, puntaje, producto, etapa, resumen FROM w_conv WHERE grupo=0 AND ult_ts>=? AND ult_ts<? ORDER BY COALESCE(puntaje,0) DESC LIMIT 80").bind(desde, fin).all()).results || [];
  const ia = await iaJSON(env, `Sos el analista comercial de "Te Importamos". Armá el reporte ${dias === 7 ? "SEMANAL" : "DIARIO"} del WhatsApp 805 SOLO con estos datos reales (no inventes nada; citá nombres reales).
MÉTRICAS (exactas): ${JSON.stringify(m)}
PERÍODO ANTERIOR: ${JSON.stringify(prev)}
PRODUCTOS MÁS CONSULTADOS: ${JSON.stringify(productos)}
CHATS DEL PERÍODO (resumen de la IA por chat): ${JSON.stringify(chatsDia).slice(0, 20000)}
MENSAJES EN GRUPOS: ${JSON.stringify(grupos).slice(0, 12000)}
Devolvé JSON: {"titular":"1 oración con lo más importante","claves":["3-6 hallazgos concretos con números"],"oportunidades":["hasta 6: a quién escribir y por qué, con nombre"],"problemas":["hasta 4: qué se está haciendo mal (ej. demoras, cotizaciones sin mandar)"],"grupos":"2-3 oraciones de qué se pidió/habló en los grupos, o vacío","recomendacion":"1-2 acciones para mañana/la semana","difusion":[{"producto":"producto a empujar en los grupos de leads","por_que":"1 oración con datos: cuántos lo pidieron, tendencia","mensaje":"mensaje LISTO para pegar en el grupo: corto (3-6 líneas), tono Te Importamos (cercano, rioplatense), con gancho, beneficio (importación directa, mejor precio que Mercado Libre, cupos por cantidad) y llamado a la acción (escribime / reservá tu cupo). Sin emojis de más y sin inventar precios que no estén en los datos."}]}
Para "difusion": 3 a 5 productos, priorizando los MÁS PEDIDOS del período y los que se repiten en grupos. Si hay pocos datos, igual proponé los más pedidos.
PROHIBIDO en "difusion": vapers, vapes, pods, tabaco, fármacos, medicamentos, skincare/cosmética regulada, armas. Nunca digas "tenemos stock" ni prometas precios, plazos o descuentos que no estén en los datos: hablá de importación por encargo y cupos. Sin emojis.`);
  if (ia && Array.isArray(ia.difusion)) ia.difusion = ia.difusion.filter((x) => !/\bvap\w*|\bpods?\b|\btabac\w*|\bcigarr\w*|\bf[aá]rmac\w*|\bmedicament\w*|\bskincare\b|\barmas?\b/i.test(`${x.producto} ${x.mensaje}`)).map((x) => ({ ...x, mensaje: String(x.mensaje || "").replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, "").replace(/ {2,}/g, " ").trim() }));
  if (estricto && !ia && Date.now() - fin < 6 * 3600e3) throw new Error("IA sin respuesta, se reintenta");
  const datos = { metricas: m, anterior: prev, productos, ia, pendientes: { sinResponder: l.sinResponder.length, cotPend: l.cotPend.length }, top: l.escribiles.slice(0, 10).map((c) => ({ nombre: c.nombre, conv: c.conv, puntaje: c.puntaje, accion: c.accion })) };
  const id = `${tipo}:${diaAR(desde)}`;
  await env.DB.prepare("INSERT INTO reportes (id,tipo,desde,hasta,creado,datos) VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET hasta=excluded.hasta, creado=excluded.creado, datos=excluded.datos")
    .bind(id, tipo, desde, fin, Date.now(), JSON.stringify(datos)).run();
  const d = (a, b) => (b ? ` (${a >= b ? "+" : ""}${a - b})` : "");
  await telegram(env, `Reporte ${dias === 7 ? "semanal" : "diario"} WhatsApp · ${diaAR(desde)}${dias === 7 ? " → " + diaAR(fin - 1) : ""}
${ia?.titular || ""}

Chats nuevos: ${m.nuevos}${d(m.nuevos, prev.nuevos)}
Cotizaciones enviadas: ${m.cotizaciones}${d(m.cotizaciones, prev.cotizaciones)}
Ventas detectadas: ${m.ventas}${d(m.ventas, prev.ventas)}
Sin responder ahora: ${m.sinResponder}
Respuesta mediana: ${m.respuestaMin ?? "-"} min
${(ia?.oportunidades || []).length ? "\nEscribiles:\n- " + ia.oportunidades.slice(0, 6).join("\n- ") : ""}
${ia?.recomendacion ? "\nRecomendación: " + ia.recomendacion : ""}${(ia?.difusion || []).length ? "\n\nPara los grupos: " + ia.difusion.map((x) => x.producto).join(", ") : ""}
${(env.PUBLIC_URL || "https://cotizador.berasateguimanuel07.workers.dev") + "/panel/805"}`);
  return { id, datos };
}

// Cron: análisis cada 15 min, alertas cada 10, reportes 21:00 AR (y domingo el semanal)
// Repara mensajes propios que entraron marcados como del cliente (una vez, idempotente)
export async function repararPropios(env) {
  await prepararLector(env);
  const filas = (await env.DB.prepare("SELECT id, conv, autor, texto, ts FROM w_msg WHERE yo=0 AND autor IS NOT NULL").all()).results || [];
  const ids = filas.filter((f) => esPropio(env, f.autor));
  const ops = [];
  for (const f of ids) {
    ops.push(env.DB.prepare("UPDATE w_msg SET yo=1 WHERE id=?").bind(f.id));
    if (!esGrupo(f.conv) && esCotizacion(f.texto)) ops.push(env.DB.prepare("INSERT OR IGNORE INTO w_hito (id,conv,tipo,ts,dato) VALUES (?,?,?,?,?)").bind("c:" + f.id, f.conv, "cotizacion", f.ts, String(f.texto).slice(0, 300)));
    if (!esGrupo(f.conv) && RE_PAGO_NOSOTROS.test(f.texto || "")) ops.push(env.DB.prepare("INSERT OR IGNORE INTO w_hito (id,conv,tipo,ts,dato) VALUES (?,?,?,?,?)").bind(`v:${f.conv}:${diaAR(f.ts)}`, f.conv, "venta", f.ts, String(f.texto).slice(0, 300)));
  }
  // Borra "ventas" que vinieron de mensajes nuestros mal marcados como del cliente
  for (let i = 0; i < ops.length; i += 80) await env.DB.batch(ops.slice(i, i + 80));
  // Recalcula cada chat desde sus mensajes
  await env.DB.batch([
    env.DB.prepare(`UPDATE w_conv SET
      ult_yo_ts = COALESCE((SELECT MAX(ts) FROM w_msg m WHERE m.conv=w_conv.conv AND m.yo=1),0),
      ult_cliente_ts = COALESCE((SELECT MAX(ts) FROM w_msg m WHERE m.conv=w_conv.conv AND m.yo=0),0),
      ult_yo = COALESCE((SELECT yo FROM w_msg m WHERE m.conv=w_conv.conv ORDER BY ts DESC LIMIT 1), ult_yo),
      ult_texto = COALESCE((SELECT texto FROM w_msg m WHERE m.conv=w_conv.conv ORDER BY ts DESC LIMIT 1), ult_texto),
      nombre = CASE WHEN grupo=1 THEN nombre ELSE COALESCE((SELECT autor_nombre FROM w_msg m WHERE m.conv=w_conv.conv AND m.yo=0 AND m.autor_nombre IS NOT NULL ORDER BY ts DESC LIMIT 1), CASE WHEN lower(nombre) LIKE 'te importamos%' THEN NULL ELSE nombre END) END,
      analizado_ts = 0`),
  ]);
  await kvPut(env, "lector_reparado_v1", Date.now());
  return ids.length;
}

export async function recalcularCotizaciones(env) {
  await env.DB.prepare("DELETE FROM w_hito WHERE tipo='cotizacion'").run();
  const filas = (await env.DB.prepare("SELECT id, conv, texto, ts FROM w_msg WHERE yo=1 AND grupo=0").all()).results || [];
  const ops = filas.filter((f) => esCotizacion(f.texto)).map((f) => env.DB.prepare("INSERT OR IGNORE INTO w_hito (id,conv,tipo,ts,dato) VALUES (?,?,?,?,?)").bind("c:" + f.id, f.conv, "cotizacion", f.ts, String(f.texto).slice(0, 300)));
  for (let i = 0; i < ops.length; i += 80) await env.DB.batch(ops.slice(i, i + 80));
  await kvPut(env, "lector_cotiz_v2", Date.now());
  return ops.length;
}

export async function cronLector(env, iaJSON, scheduledTime) {
  if (!env.DB || !env.LECTOR_TOKEN) return;   // el lector no está configurado todavía
  await prepararLector(env);
  if (!(await kvGet(env, "lector_reparado_v1"))) await repararPropios(env).catch((e) => console.log("lector reparar", e?.stack || e));
  if (!(await kvGet(env, "lector_resp_v1"))) { await env.DB.prepare("UPDATE w_conv SET analizado_ts=0 WHERE ult_yo=0 AND grupo=0 AND ult_cliente_ts>=?").bind(Date.now() - 72 * 3600e3).run(); await kvPut(env, "lector_resp_v1", Date.now()); }
  if (!(await kvGet(env, "lector_ventas_v1"))) { await env.DB.prepare("UPDATE w_conv SET analizado_ts=0 WHERE conv IN (SELECT conv FROM w_hito WHERE tipo='venta') OR ult_ts>=?").bind(Date.now() - 3 * 86400e3).run(); await kvPut(env, "lector_ventas_v1", Date.now()); }
  if (!(await kvGet(env, "lector_audit_v3"))) { await env.DB.prepare("DELETE FROM w_audit").run(); await kvPut(env, "lector_audit_v3", Date.now()); }
  if (!(await kvGet(env, "lector_pend_v1"))) { await env.DB.prepare("UPDATE w_conv SET analizado_ts=0 WHERE grupo=0 AND ult_ts>=?").bind(Date.now() - 3 * 86400e3).run(); await kvPut(env, "lector_pend_v1", Date.now()); }
  if (!(await kvGet(env, "lector_cotiz_v2"))) await recalcularCotizaciones(env).catch((e) => console.log("lector cotiz", e?.stack || e));
  const t = new Date(scheduledTime);
  const m = t.getUTCMinutes(), hAR = (t.getUTCHours() + 21) % 24;
  if (m % 15 === 7) await analizarChats(env, iaJSON).catch((e) => console.log("lector analizar", e?.stack || e));
  if (m % 15 === 11) await auditarCotizaciones(env, iaJSON).catch((e) => console.log("lector auditar", e?.stack || e));
  if (m % 30 === 3) await alertasRapidas(env).catch((e) => console.log("lector alertas", e?.stack || e));
  // Reporte diario: desde las 21 h; si falla o se saltea, reintenta cada 10 min y se recupera durante todo el día siguiente
  {
    const ref = hAR >= 21 ? scheduledTime : scheduledTime - 86400e3;
    for (const [tipo, dias] of [["805_diario", 1], ["805_semanal", 7]]) {
      if (tipo === "805_semanal" && new Date(ref - AR).getUTCDay() !== 0) continue;
      const desde = inicioDiaAR(ref) + 86400e3 - dias * 86400e3, id = `${tipo}:${diaAR(desde)}`;
      if (await env.DB.prepare("SELECT 1 FROM reportes WHERE id=?").bind(id).first()) continue;
      const k = "lector_intento:" + id;
      if (Date.now() - (+(await kvGet(env, k)) || 0) < 9 * 60e3) continue;
      await kvPut(env, k, Date.now());
      await generarReporte(env, iaJSON, tipo, ref, true).catch((e) => console.log("lector reporte", tipo, e?.stack || e));
      break;   // uno por vuelta
    }
  }
  // Aviso si el puente dejó de mandar datos hace mucho (posible desvinculación)
  if (m === 30) {
    const ult = +(await kvGet(env, "lector_ultimo")) || 0, avisado = +(await kvGet(env, "lector_avisado")) || 0;
    if (ult && Date.now() - ult > 6 * 3600e3 && avisado < ult && horaAR() >= 10 && horaAR() < 22) {
      await telegram(env, "⚠️ Hace más de 6 horas que no llegan mensajes del 805 al lector. Puede que se haya desvinculado: revisá Dispositivos vinculados en el celular.");
      await kvPut(env, "lector_avisado", Date.now());
    }
  }
}

// ---------------------------------------------------------------------------
// 7) API del panel (/panel/api/805/...)
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// 8) Asistente interno: preguntas en lenguaje natural sobre los chats del 805
// ---------------------------------------------------------------------------
const VACIAS_Q = new Set("que quien cual cuales como cuando donde cuanto cuantos cuantas para por con sin los las del una uno unos unas este esta esto ese esa eso hoy ayer semana mes dia dias tenia tengo tenes tiene tienen mandar mande mandarle decime deci acordas acuerdas producto productos pidieron pidio pedido mucho mucha muchos muchas algun alguna alguien hay habia fue era son mas menos todo todos todas cliente clientes chat chats whatsapp".split(" "));
export async function preguntarAsistente(env, iaJSON, pregunta, historial = []) {
  await prepararLector(env);
  const q = String(pregunta || "").slice(0, 600);
  const ahora = Date.now(), hoy = inicioDiaAR(ahora);
  const dias = /semana|7 d[ií]as/i.test(q) ? 7 : /mes|30 d[ií]as/i.test(q) ? 30 : /ayer/i.test(q) ? 2 : 3;
  const desde = /\bhoy\b/i.test(q) && !/ayer|semana|mes/i.test(q) ? hoy : hoy - (dias - 1) * 86400e3;
  const [mHoy, mRango] = await Promise.all([metricas(env, hoy), metricas(env, desde)]);
  const productos = (await env.DB.prepare("SELECT producto, COUNT(*) n FROM w_conv WHERE grupo=0 AND producto<>'' AND ult_ts>=? GROUP BY lower(producto) ORDER BY n DESC LIMIT 15").bind(desde).all()).results || [];
  const chats = (await env.DB.prepare("SELECT conv, nombre, puntaje, temp, producto, etapa, accion, resumen, ult_yo, ult_ts, ult_texto, cot_pend FROM w_conv WHERE grupo=0 AND archivado=0 AND ult_ts>=? ORDER BY COALESCE(puntaje,0) DESC, ult_ts DESC LIMIT 160").bind(desde).all()).results || [];
  // Búsqueda por palabras de la pregunta en TODOS los mensajes (para "¿a quién le tenía que mandar X?")
  const palabras = [...new Set(normalQ(q).split(/[^a-z0-9ñ]+/).filter((w) => w.length > 3 && !VACIAS_Q.has(w)))].slice(0, 3);
  let hallados = [];
  for (const w of palabras) {
    const raiz = w.replace(/(es|s)$/, "");
    const r = (await env.DB.prepare("SELECT m.conv, c.nombre, m.yo, m.texto, m.ts FROM w_msg m LEFT JOIN w_conv c ON c.conv=m.conv WHERE m.ts>=? AND m.grupo=0 AND lower(m.texto) LIKE ? ORDER BY m.ts DESC LIMIT 40").bind(ahora - 10 * 86400e3, `%${raiz}%`).all()).results || [];
    hallados.push(...r);
  }
  const vistos = new Set(); hallados = hallados.filter((h) => { const k = h.conv + h.ts; if (vistos.has(k)) return false; vistos.add(k); return true; }).slice(0, 90);
  const fmtChat = (c) => `- ${c.nombre || "sin nombre"} (+${c.conv}) · ${c.puntaje ?? "?"}/10 · ${c.producto || "-"} · etapa ${c.etapa || "-"}${c.cot_pend ? " · ESPERA COTIZACIÓN" : ""}${!c.ult_yo ? " · SIN RESPONDER" : ""} · último ${fechaHora(c.ult_ts)}: "${String(c.ult_texto || "").slice(0, 120)}"${c.resumen ? " · " + c.resumen : ""}${c.accion ? " · pendiente: " + String(c.accion).replace(/\|p\d$/, "") : ""}`;
  const contexto = `MÉTRICAS DE HOY (exactas): ${JSON.stringify(mHoy)}
MÉTRICAS DESDE ${fechaHora(desde)}: ${JSON.stringify(mRango)}
PRODUCTOS MÁS CONSULTADOS (desde ${fechaHora(desde)}): ${productos.map((p) => `${p.producto} (${p.n})`).join(", ") || "sin datos"}
CHATS ACTIVOS DESDE ${fechaHora(desde)} (ordenados por calidad):
${chats.map(fmtChat).join("\n").slice(0, 45000)}
MENSAJES QUE COINCIDEN CON LA PREGUNTA (${palabras.join(", ") || "ninguna palabra clave"}):
${hallados.map((h) => `[${fechaHora(h.ts)}] ${h.nombre || "sin nombre"} (+${h.conv}) ${h.yo ? "NOSOTROS" : "CLIENTE"}: ${String(h.texto).slice(0, 300)}`).join("\n").slice(0, 30000) || "ninguno"}`;
  const conv = (historial || []).slice(-6).map((h) => `${h.r === "u" ? "YO" : "ASISTENTE"}: ${String(h.t).slice(0, 800)}`).join("\n");
  const r = await iaJSON(env, `Sos el asistente interno de "Te Importamos" (importaciones). Respondés preguntas del dueño sobre los chats del WhatsApp Business 805, usando SOLO los datos de abajo. Ahora es ${fechaHora(ahora)} (hora Argentina).
Reglas:
- No inventes nada. Si los datos no alcanzan, decilo y sugerí cómo averiguarlo.
- Citá siempre nombre y número (formato +549...) de cada cliente que menciones, y cuando sirva, una frase textual corta entre comillas.
- Sé breve y ordenado: primero la respuesta directa, después una lista corta si hace falta. Sin emojis. Español rioplatense.
- Los conteos de chats nuevos, cotizaciones y ventas son exactos; los puntajes y productos los estimó la IA.
${conv ? "CONVERSACIÓN PREVIA:\n" + conv + "\n" : ""}
DATOS:
${contexto}

PREGUNTA: ${q}
Respondé JSON: {"respuesta":"texto"}`);
  return { respuesta: r?.respuesta || "No pude responder ahora (la IA no contestó). Probá de nuevo en un minuto.", fuentes: { chats: chats.length, mensajes: hallados.length } };
}
const normalQ = (t) => String(t || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

export async function apiLector(env, req, url, iaJSON) {
  await prepararLector(env);
  const r = url.pathname.replace("/panel/api/805/", "");
  const json = (x) => Response.json(x);
  if (r === "resumen") {
    const cache = JSON.parse((await kvGet(env, "lector_resumen")) || "null");
    if (cache && Date.now() - cache.ts < 5 * 60e3 && !url.searchParams.get("fresco")) return json(cache.d);
    const hoy = inicioDiaAR();
    const [dia, semana, mes, l] = await Promise.all([metricas(env, hoy), metricas(env, hoy - 6 * 86400e3), metricas(env, hoy - 29 * 86400e3), listas(env)]);
    const estado = JSON.parse((await kvGet(env, "lector_estado")) || "null");
    const productos = (await env.DB.prepare("SELECT producto, COUNT(*) n FROM w_conv WHERE grupo=0 AND producto<>'' AND ult_ts>=? GROUP BY lower(producto) ORDER BY n DESC LIMIT 10").bind(hoy - 6 * 86400e3).all()).results || [];
    const serie = (await env.DB.prepare("SELECT primer_ts ts FROM w_conv WHERE primer_ts>=? AND grupo=0").bind(hoy - 29 * 86400e3).all()).results || [];
    const porDia = {}; for (let i = 29; i >= 0; i--) porDia[diaAR(hoy - i * 86400e3 + 3600e3)] = 0;
    // Distribuciones para los gráficos (chats con actividad en el período; usa el índice de ult_ts)
    const dist = {};
    for (const [k, desde] of [["dia", hoy], ["semana", hoy - 6 * 86400e3], ["mes", hoy - 29 * 86400e3]]) {
      const filas = (await env.DB.prepare("SELECT temp, etapa, puntaje FROM w_conv WHERE ult_ts>=? AND grupo=0 AND archivado=0").bind(desde).all()).results || [];
      const t = { caliente: 0, tibio: 0, frio: 0, sin: 0 }, e = {}, pu = Array(10).fill(0);
      for (const f of filas) {
        if (t[f.temp] !== undefined && f.temp !== "sin") t[f.temp]++; else t.sin++;
        if (f.etapa) e[f.etapa] = (e[f.etapa] || 0) + 1;
        if (f.puntaje >= 1 && f.puntaje <= 10) pu[f.puntaje - 1]++;
      }
      const prods = (await env.DB.prepare("SELECT producto, COUNT(*) n FROM w_conv WHERE ult_ts>=? AND grupo=0 AND producto<>'' GROUP BY lower(producto) ORDER BY n DESC LIMIT 10").bind(desde).all()).results || [];
      dist[k] = { temp: t, etapa: e, puntaje: pu, productos: prods };
    }
    for (const s of serie) { const k = diaAR(s.ts); if (k in porDia) porDia[k]++; }
    const d = { dist, dia, semana, mes, ...l, estado, ultimo: +(await kvGet(env, "lector_ultimo")) || null, telegram: !!(env.TELEGRAM_TOKEN && (env.TELEGRAM_CHAT || (await kvGet(env, "telegram_chat")))), configurado: !!env.LECTOR_TOKEN, productos, nuevosPorDia: porDia };
    await kvPut(env, "lector_resumen", JSON.stringify({ ts: Date.now(), d }));
    return json(d);
  }
  if (r === "chats") {
    const q = (url.searchParams.get("q") || "").trim(), f = url.searchParams.get("f") || "todos";
    const cond = { todos: "1=1", calientes: "puntaje>=7", sin: "ult_yo=0", cotizar: "cot_pend=1", grupos: "grupo=1", archivados: "archivado=1" }[f] || "1=1";
    const filas = (await env.DB.prepare(`SELECT * FROM w_conv WHERE ${cond} ${f === "archivados" ? "" : "AND archivado=0"} ${f === "grupos" ? "" : "AND grupo=0"} ${q ? "AND (nombre LIKE ? OR conv LIKE ? OR producto LIKE ?)" : ""} ORDER BY ult_ts DESC LIMIT 200`)
      .bind(...(q ? [`%${q}%`, `%${q}%`, `%${q}%`] : [])).all()).results || [];
    return json(filas);
  }
  if (r === "chat") {
    const conv = url.searchParams.get("conv");
    const c = await env.DB.prepare("SELECT * FROM w_conv WHERE conv=?").bind(conv).first();
    const ms = ((await env.DB.prepare("SELECT yo, autor, autor_nombre, tipo, texto, ts FROM w_msg WHERE conv=? ORDER BY ts DESC LIMIT 300").bind(conv).all()).results || []).reverse();
    const hitos = (await env.DB.prepare("SELECT tipo, ts FROM w_hito WHERE conv=? ORDER BY ts").bind(conv).all()).results || [];
    return json({ conv: c, mensajes: ms, hitos });
  }
  if (r === "auditar" && req.method === "POST") { const b = await req.json().catch(() => ({})); return json(await auditarCotizaciones(env, iaJSON, { limite: Math.min(60, +b.limite || 30), dia: b.dia || null, conv: b.conv || null, debug: !!b.debug, rehacer: !!b.rehacer })); }
  if (r === "visto" && req.method === "POST") {
    const b = await req.json(); const conv = String(b.conv || "");
    if (b.lista === "ven") await env.DB.prepare("UPDATE w_hito SET oculto=1 WHERE id=? AND tipo='venta'").bind(String(b.id || "")).run();
    else { const col = b.lista === "esc" ? "visto_esc" : b.lista === "cot" ? "visto_cot" : "visto_ts"; await env.DB.prepare(`UPDATE w_conv SET ${col}=? WHERE conv=?`).bind(Date.now(), conv).run(); }
    await env.DB.prepare("DELETE FROM kv WHERE k='lector_resumen'").run(); return json({ ok: true });
  }
  if (r === "archivar" && req.method === "POST") {
    const b = await req.json(); await env.DB.prepare("UPDATE w_conv SET archivado=? WHERE conv=?").bind(b.si ? 1 : 0, b.conv).run(); return json({ ok: true });
  }
  if (r === "analizar" && req.method === "POST") {
    const n = await analizarChats(env, iaJSON, { limite: 24 });
    return json({ ok: true, analizados: n });
  }
  if (r === "reporte" && req.method === "POST") {
    const b = await req.json().catch(() => ({}));
    const rep = await generarReporte(env, iaJSON, b.tipo === "805_semanal" ? "805_semanal" : "805_diario");
    return json({ ok: true, ...rep });
  }
  if (r === "borrar-reporte" && req.method === "POST") {
    const b = await req.json().catch(() => ({}));
    await env.DB.prepare("DELETE FROM reportes WHERE id=? AND tipo LIKE '805_%'").bind(String(b.id || "")).run();
    return json({ ok: true });
  }
  if (r === "reportes") {
    const filas = (await env.DB.prepare("SELECT id, tipo, desde, hasta, creado, datos FROM reportes WHERE tipo LIKE '805_%' ORDER BY desde DESC, tipo LIMIT 60").all()).results || [];
    return json(filas.map((f) => ({ ...f, datos: JSON.parse(f.datos || "{}") })));
  }
  if (r === "telegram" && req.method === "POST") return json(await vincularTelegram(env));
  if (r === "preguntar" && req.method === "POST") { const b = await req.json().catch(() => ({})); return json(await preguntarAsistente(env, iaJSON, b.pregunta, b.historial)); }
  if (r === "reparar" && req.method === "POST") { const corregidos = await repararPropios(env); return json({ ok: true, corregidos, cotizaciones: await recalcularCotizaciones(env) }); }
  if (r === "qr") { const q = JSON.parse((await kvGet(env, "lector_qr")) || "null"); return json(q && Date.now() - q.ts < 90e3 ? q : { qr: "", estado: q?.estado === "paired" ? "paired" : "" }); }
  if (r === "probar-alertas" && req.method === "POST") return json({ ok: true, alertas: await alertasRapidas(env) });
  return new Response("no existe", { status: 404 });
}

// ---------------------------------------------------------------------------
// 9) Reporte en formato imprimible (el navegador lo guarda como PDF)
// ---------------------------------------------------------------------------
export async function paginaReporte(env, id) {
  await prepararLector(env);
  const r = await env.DB.prepare("SELECT * FROM reportes WHERE id=? AND tipo LIKE '805_%'").bind(id).first();
  if (!r) return new Response("Reporte no encontrado", { status: 404 });
  const d = JSON.parse(r.datos || "{}"), m = d.metricas || {}, ia = d.ia || {};
  const e = (x) => String(x ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const lista = (t, xs) => (xs || []).length ? `<h3>${t}</h3><ul>${xs.map((x) => `<li>${e(x)}</li>`).join("")}</ul>` : "";
  const fecha = (ts) => new Date(ts - AR).toISOString().slice(0, 10).split("-").reverse().join("/");
  const titulo = `${r.tipo === "805_semanal" ? "Reporte semanal" : "Reporte diario"} · ${fecha(r.desde)}${r.tipo === "805_semanal" ? " al " + fecha(r.hasta - 1) : ""}`;
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${e(titulo)} · Te Importamos</title><style>
body{font-family:Inter,system-ui,Arial,sans-serif;color:#111827;max-width:780px;margin:30px auto;padding:0 20px;font-size:14px;line-height:1.5}
.top{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:3px solid #EA5B0C;padding-bottom:10px}.top b{color:#EA5B0C;font-size:20px}.top span{color:#6B7280;font-size:12px}
h2{margin:18px 0 4px}h3{margin:18px 0 6px;font-size:15px}.kv{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin:14px 0}.kv div{border:1px solid #E5E7EB;border-top:3px solid #1FA855;border-radius:8px;padding:8px}.kv small{color:#6B7280;display:block;font-size:11px}.kv b{font-size:20px}
.dif{border:1px solid #E5E7EB;border-left:3px solid #1FA855;border-radius:8px;padding:8px 12px;margin:8px 0}.dif pre{white-space:pre-wrap;font-family:inherit;background:#F4F5F7;padding:8px;border-radius:6px;margin:6px 0 0}
@media print{.np{display:none}body{margin:0}}</style></head><body>
<div class="top"><b>Te Importamos</b><span>Generado ${e(new Date(r.creado - AR).toISOString().slice(0, 16).replace("T", " "))}</span></div>
<h2>${e(titulo)}</h2>${ia.titular ? `<p><b>${e(ia.titular)}</b></p>` : ""}
<div class="kv"><div><small>Chats nuevos</small><b>${m.nuevos ?? 0}</b></div><div><small>Cotizaciones</small><b>${m.cotizaciones ?? 0}</b></div><div><small>Ventas</small><b>${m.ventas ?? 0}</b></div><div><small>Sin responder</small><b>${m.sinResponder ?? 0}</b></div><div><small>Respuesta</small><b>${m.respuestaMin ?? "-"} min</b></div></div>
${lista("Claves", ia.claves)}${lista("A quién escribir", ia.oportunidades)}${lista("A mejorar", ia.problemas)}
${ia.grupos ? `<h3>Grupos</h3><p>${e(ia.grupos)}</p>` : ""}${ia.recomendacion ? `<h3>Recomendación</h3><p>${e(ia.recomendacion)}</p>` : ""}
${(ia.difusion || []).length ? `<h3>Para mandar en los grupos</h3>${ia.difusion.map((x) => `<div class="dif"><b>${e(x.producto)}</b><div style="color:#6B7280">${e(x.por_que || "")}</div><pre>${e(x.mensaje || "")}</pre></div>`).join("")}` : ""}
<p class="np" style="margin-top:24px"><button onclick="print()" style="background:#EA5B0C;color:#fff;border:0;border-radius:8px;padding:10px 16px;font-weight:700;cursor:pointer">Guardar como PDF</button></p>
<script>setTimeout(()=>print(),400)</script></body></html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
