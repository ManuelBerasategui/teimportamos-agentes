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
// Mensajes del agente automático de Meta (figuran como nuestros pero no los escribió una persona)
const RE_BOT = /^¡?bienvenid[oa]!*[\s\S]{0,80}?te voy a derivar con alguien|^te voy a derivar con alguien del equipo|ya le avis[eé] a (nuestro|el) equipo[\s\S]{0,120}se pondr[aá]n? en contacto/i;
const esBot = (t) => RE_BOT.test(String(t || "").trim());
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
    for (const col of ["resp INTEGER", "visto_ts INTEGER DEFAULT 0", "prov INTEGER DEFAULT 0", "visto_esc INTEGER DEFAULT 0", "visto_cot INTEGER DEFAULT 0", "nuevo_ok INTEGER", "perfil TEXT", "presup_usd INTEGER", "origen TEXT", "motivo TEXT", "seg_visto INTEGER DEFAULT 0", "seg_no INTEGER DEFAULT 0"]) await env.DB.prepare(`ALTER TABLE w_conv ADD COLUMN ${col}`).run().catch(() => {});
  await env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS ag_chat (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, rol TEXT, texto TEXT)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS ag_mem (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, tipo TEXT, texto TEXT)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS ag_obj (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, metrica TEXT, periodo TEXT, meta INTEGER, activo INTEGER DEFAULT 1)"),
  ]);
  await env.DB.prepare("ALTER TABLE w_hito ADD COLUMN oculto INTEGER DEFAULT 0").run().catch(() => {});
  tablasLector = true;
}

const kvGet = async (env, k) => (await env.DB.prepare("SELECT v FROM kv WHERE k=?").bind(k).first())?.v ?? null;
const REGLAS_DUENO = `
- Si nuestro último mensaje es una pregunta (por ejemplo "que cantidad?") y el cliente la contesta, aunque sea con pocas palabras, el cliente espera que le coticemos o le contestemos: necesita_respuesta true.
- Si nosotros prometimos algo (te paso el precio, consulto y te aviso, ahí te mando) y todavía no se ve en el chat que lo cumplimos con un precio, un texto o un link, y el cliente escribe después un gracias, dale u ok, igual necesita_respuesta true.
- Los mensajes nuestros que empiezan con "Bienvenido!! Te voy a derivar con alguien del equipo" los manda un bot, no una persona: si después no hay mensajes escritos por una persona del equipo, el cliente todavía no fue atendido y necesita_respuesta true.
- Si el cliente deja una frase a medias o una pregunta suelta ("una consulta", "una sola quería saber"), espera respuesta: necesita_respuesta true.
- Ante la duda de si hay que responder, poné necesita_respuesta true. Es peor perder un cliente que mostrar uno de más.
`;
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
    const esAuto = yo && esBot(texto);   // bot de Meta: no cuenta como respuesta nuestra
    if (!esAuto && ts >= c.ult) { c.ult = ts; c.ultYo = yo; c.texto = String(texto).slice(0, 200); }
    if (esAuto) { /* no cuenta */ } else if (yo) c.ultYoTs = Math.max(c.ultYoTs, ts); else c.ultCli = Math.max(c.ultCli, ts);
    convs.set(conv, c);
    // Hitos exactos (solo chats individuales)
    if (!grupo) {
      if (yo && esCotizacion(texto)) ops.push(env.DB.prepare("INSERT OR IGNORE INTO w_hito (id,conv,tipo,ts,dato) VALUES (?,?,?,?,?)").bind("c:" + m.external_id, conv, "cotizacion", ts, String(texto).slice(0, 300)));
      const pago = (!yo && (/^\((image|document)\)/.test(texto) || tipo === "image" || tipo === "document") && RE_PAGO_CLIENTE.test(texto)) || (!yo && RE_PAGO_CLIENTE.test(texto) && /comprobante/i.test(texto)) || (yo && RE_PAGO_NOSOTROS.test(texto));
      // ventas: las decide la auditoría diaria por IA (no por palabras sueltas)
      // Si alguien del equipo (vos o tu socio) le manda un archivo, un link o un precio, la tarea de cotizar/prometido se da por resuelta sola
            // Cualquier respuesta de una persona del equipo (no del bot) da por resuelta la tarea de cotizar/prometido
      if (yo && !grupo && !hist && !esAuto)
        ops.push(env.DB.prepare("UPDATE tareas SET estado='resuelta' WHERE ref=? AND estado='abierta' AND tipo IN ('cotizacion','promesa') AND ts<?").bind("w805:" + conv, ts));
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
    q("SELECT COUNT(*) n FROM w_conv WHERE primer_ts>=? AND primer_ts<? AND grupo=0 AND COALESCE(nuevo_ok,1)=1", desde, hasta),
    q("SELECT COUNT(*) n FROM w_conv WHERE ult_ts>=? AND ult_ts<? AND grupo=0", desde, hasta),
    q("SELECT COUNT(*) n FROM w_hito WHERE tipo='cotizacion' AND ts>=? AND ts<?", desde, hasta),
    q("SELECT COUNT(DISTINCT conv) n FROM w_hito WHERE tipo='cotizacion' AND ts>=? AND ts<?", desde, hasta),
    q("SELECT COUNT(*) n FROM w_hito h LEFT JOIN w_conv c ON c.conv=h.conv WHERE h.tipo='venta' AND h.ts>=? AND h.ts<? AND COALESCE(h.oculto,0)=0 AND COALESCE(c.prov,0)=0", desde, hasta),
        q("SELECT COUNT(*) n FROM w_conv WHERE ult_cliente_ts>=? AND grupo=0 AND archivado=0 AND ult_yo=0 AND COALESCE(prov,0)=0 AND lower(COALESCE(producto,'')) NOT LIKE '%vap%' AND lower(COALESCE(producto,'')) NOT LIKE '%elf%bar%' AND lower(COALESCE(producto,'')) NOT LIKE '%pod%' AND ult_cliente_ts>COALESCE(visto_ts,0)", Date.now() - 14 * 86400e3),
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
      bloques.push(`### CHAT ${c.conv} (${c.nombre || "sin nombre"})\n` + ms.map((m) => `[${fechaHora(m.ts)}] ${m.yo ? (esBot(m.texto) ? "BOT AUTOMATICO (no es una persona)" : "NOSOTROS") : "CLIENTE"}: ${String(m.texto).slice(0, 400)}`).join("\n"));
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
- necesita_respuesta: true si el ÚLTIMO mensaje del chat es del CLIENTE y espera algo de nosotros (una pregunta, un pedido, datos, una foto, una duda). false si el último mensaje del cliente es un cierre o acuse ("dale", "ok", "gracias", "perfecto", "lo pienso", "te aviso", "cuando tenga todo te hago el pedido", un sticker o emoji), o si el último mensaje es nuestro. EXCEPCIÓN IMPORTANTE: si el último mensaje del cliente es un acuse (dale, gracias, ok) pero el mensaje nuestro anterior es un (archivo) sin texto que respondía a una consulta de precio, ese (archivo) puede ser un AUDIO donde prometimos consultar el precio. En ese caso poné necesita_respuesta true y en accion escribí: Revisar si ya se le pasó el precio, el (archivo) puede ser un audio.
REGLAS DEL DUEÑO (mandan por encima de todo lo anterior):${REGLAS_DUENO}
- es_proveedor: true si el chat es con un PROVEEDOR o alguien que nos presta un servicio y a quien NOSOTROS le pagamos: mayorista, fábrica, tienda a la que le compramos, forwarder o agente de carga, despachante de aduana, transportista, courier o la importadora (nosotros pedimos precios, nosotros pagamos/transferimos, ellos nos venden). false si es un cliente que nos compra a nosotros.
- venta_real: true solo si en este chat un CLIENTE nos compró: nos pagó una seña o el total (mandó comprobante, confirmamos su pago). false si fuimos nosotros los que pagamos a un proveedor, o si todavía no pagó.
- pendiente: lo que NOSOTROS tenemos pendiente con este cliente AHORA, o null si no hay nada. {"tipo": uno de
    "cotizacion" (pidió precio/cotización y todavía no se la mandamos),
    "promesa" (le dijimos "ya te paso", "te averiguo", "mañana te mando", "te armo por 80 y 100", etc. y todavía no lo cumplimos),
    "comprobante" (nos pagó o mandó comprobante/seña: hay que confirmarle y hacer el pedido al proveedor),
    "proveedor" (hay que buscar proveedor o averiguar algo con un proveedor para poder avanzar),
   "titulo": máximo 8 palabras concretas (ej. "Cotizar 50 tarjetas NFC", "Pasarle cotización por 80 y 100 u"), "detalle": 1 oración}.
   Si ya lo cumplimos más abajo en el chat, o el cliente cerró la charla, o no es cliente: null.
   MUY IMPORTANTE: si el ÚLTIMO mensaje es NUESTRO y le pide algo al cliente (link, foto, cantidad, modelo, datos, "¿qué producto buscás?") o le hace una pregunta, la pelota está del lado del cliente: pendiente null (no hay nada que hacer hasta que conteste). Lo mismo si nuestra última respuesta ya le dio lo que pedía.
- Si es_proveedor es true: etapa "no_cliente", puntaje 1, cot_pend false, venta_real false.
- Consultas por vapers, vapes, pods o tabaco: etapa "no_cliente" (no los trabajamos; los atiende el socio por otro canal).
- resumen: 1 oración con lo esencial (nombre, producto, cantidad, en qué quedó)
- perfil: "A" (vende en Mercado Libre o quiere arrancar a vender en serio, con presupuesto claro), "B" (negocio físico, empresa o marca que compra para abaratar costos o insumos), "C" (revendedor chico o emprendedor que arranca, cantidades chicas), "D" (consumidor final, 1 a 3 unidades para uso propio), "E" (curioso: pregunta precio, catálogo o cómo funciona, sin producto ni cantidad concreta, y no avanza). Si pide cantidad mayorista (20 unidades o más, o más de USD 1000) NUNCA es "D". Si es proveedor o no es cliente: "".
- presup_usd: presupuesto en dólares (número entero) o null. Si no lo dijo, estimalo con cantidad por precio aproximado del producto (ej. 20 iPhones = 16000; 50 tarjetas NFC = 150). Si habla en pesos argentinos, dividí por ${DOLAR}.
- origen: cómo nos conoció, SOLO si lo dijo en el chat: "reel" | "historia" | "instagram" | "tiktok" | "web" | "recomendacion" | "grupo" | "mercadolibre" | "otro" | null.
- motivo_perdida: solo si etapa es "perdido" o la charla se cortó después de cotizarle: "caro" | "minimo" (quería menos que el mínimo) | "plazo" | "desconfianza" | "sin_respuesta" (dejó de contestar aunque le escribimos después de cotizar) | "sin_seguimiento" (lo último es nuestra cotización y nunca más le escribimos) | "otro" | null.
Respondé JSON: {"chats":[{...}]}

${bloques.join("\n\n")}`, { sinRespaldo: true });
    const lista = Array.isArray(r?.chats) ? r.chats : [];
    const ops = [];
    for (const a of lista) {
      const c = tanda.find((x) => x.conv === String(a.conv)); if (c && NO_CLIENTES.has(c.conv)) a.es_proveedor = true;
      if (!c) continue;
      let perfil = ["A", "B", "C", "D", "E"].includes(String(a.perfil || "").toUpperCase()) ? String(a.perfil).toUpperCase() : null;
      const presup = Number.isFinite(+a.presup_usd) && +a.presup_usd > 0 ? Math.min(500000, Math.round(+a.presup_usd)) : null;
      if (perfil === "D" && presup >= 1000) perfil = "C";
      if (a.es_proveedor) perfil = null;
      const origen = ["reel", "historia", "instagram", "tiktok", "web", "recomendacion", "grupo", "mercadolibre", "otro"].includes(a.origen) ? a.origen : null;
      const motivo = ["caro", "minimo", "plazo", "desconfianza", "sin_respuesta", "sin_seguimiento", "otro"].includes(a.motivo_perdida) ? a.motivo_perdida : null;
      ops.push(env.DB.prepare("UPDATE w_conv SET analizado_ts=?, puntaje=?, temp=?, producto=?, etapa=?, accion=?, resumen=?, cot_pend=?, resp=?, prov=?, perfil=?, presup_usd=?, origen=COALESCE(?, origen), motivo=? WHERE conv=?")
        .bind(Date.now(), Math.max(1, Math.min(10, parseInt(a.puntaje) || 1)), String(a.temp || ""), String(a.producto || "").slice(0, 80), String(a.etapa || ""), String(a.accion || "").slice(0, 300) + (a.prioridad ? `|p${a.prioridad}` : ""), String(a.resumen || "").slice(0, 400), a.cot_pend ? 1 : 0, a.necesita_respuesta === false ? 0 : 1, a.es_proveedor ? 1 : 0, perfil, presup, origen, motivo, c.conv));      if (a.es_proveedor) ops.push(env.DB.prepare("UPDATE w_hito SET oculto=1 WHERE conv=? AND tipo='venta'").bind(c.conv));
        ops.push(...pendienteOps(env, c, a.es_proveedor || a.etapa === "no_cliente" || (perfil === "E" && !presup && !String(a.producto || "").trim()) ? null : a.pendiente));
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
  let tipo = p && TIPOS_PEND[p.tipo];
  // Si lo último lo escribimos nosotros preguntándole algo, esperamos al cliente: no hay tarea de cotizar ni promesa
  if (tipo && (tipo === "cotizacion" || tipo === "promesa") && c.ult_yo && /\?\s*$|\b(pasame|mandame|envi[aá]me|ten[eé]s (alg[uú]n )?(link|foto)|qu[eé] (producto|modelo|cantidad))\b/i.test(String(c.ult_texto || ""))) tipo = null;
  if (!tipo) return [env.DB.prepare("UPDATE tareas SET estado='resuelta' WHERE ref=? AND estado='abierta'").bind("w805:" + c.conv)];
  const id = `w805:${c.conv}:${tipo}:${diaAR(Date.now())}`;
  return [
    env.DB.prepare("UPDATE tareas SET estado='resuelta' WHERE ref=? AND estado='abierta' AND id<>? AND tipo<>?").bind("w805:" + c.conv, id, tipo),
    env.DB.prepare("INSERT OR REPLACE INTO tareas (id, ts, tipo, tel, nombre, titulo, detalle, datos, ref, estado) SELECT ?,?,?,?,?,?,?,?,?,'abierta' WHERE NOT EXISTS (SELECT 1 FROM tareas WHERE ref=? AND tipo=? AND (estado='abierta' OR (estado='hecha' AND ts>=?)))")
      .bind(id, Date.now(), tipo, c.conv, c.nombre || "", String(p.titulo || "").slice(0, 90), String(p.detalle || "").slice(0, 400), JSON.stringify({ origen: "805" }), "w805:" + c.conv, "w805:" + c.conv, tipo, c.ult_cliente_ts || 0),
  ];
}

// ---------------------------------------------------------------------------
// 3b) Auditoría de cotizaciones: la IA lee el día completo de cada chat y cuenta las cotizaciones que
// mandamos (texto, capturas o PDF: los adjuntos llegan como "(archivo)", se deducen por el contexto)
// ---------------------------------------------------------------------------
// Una venta cuenta solo si es el primer pago (seña o total) de una compra nueva: envío, flete o saldo no son ventas,
// y si el chat ya tiene una venta registrada en los últimos 60 días tiene que ser explícitamente otra compra.
const RE_NO_VENTA = /env[ií]o|flete|correo|andreani|\boca\b|v[ií]a ?cargo|cadete|\bmoto\b|saldo|\bresto\b|diferencia|\bvap\w*|elf ?bar|ice king|ignite|\bpods?\b/i;
export function esVentaReal(v, t = {}) {
  if (!v || typeof v !== "object") return false;
  const concepto = String(v.concepto || "").toLowerCase();
  if (["saldo", "envio", "envío", "otro"].includes(concepto)) return false;
  if (RE_NO_VENTA.test(`${v.producto || ""} ${v.monto || ""}`)) return false;
  const m = (t.ms || [])[parseInt(v.msg)];
  if (m && RE_NO_VENTA.test(String(m.texto || ""))) return false;
  if ((t.ventasPrev || []).length && v.compra_nueva !== true) return false;
  return true;
}

export async function auditarCotizaciones(env, iaJSON, { limite = 30, dia = null, conv = null, debug = false, rehacer = false } = {}) {
  await prepararLector(env);
  const desde = dia ? Date.parse(dia + "T00:00:00Z") + AR : inicioDiaAR(Date.now() - 86400e3);
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
      const c = await env.DB.prepare("SELECT nombre, prov, etapa, primer_ts FROM w_conv WHERE conv=?").bind(t.conv).first();
      t.empieza = (c?.primer_ts || 0) >= ini && (c?.primer_ts || 0) < ini + 86400e3;
      const previo = await env.DB.prepare("SELECT 1 FROM w_msg WHERE conv=? AND ts<? LIMIT 1").bind(t.conv, ini - 6 * 3600e3).first();
      const ms = (await env.DB.prepare("SELECT id, yo, texto, ts FROM w_msg WHERE conv=? AND ts>=? AND ts<? ORDER BY ts LIMIT 160").bind(t.conv, ini - 6 * 3600e3, ini + 86400e3).all()).results || [];
      t.prov = c?.prov || 0; t.ini = ini; t.ms = ms;
      // Lo que ya pasó antes en este chat: ventas registradas y pagos de los últimos 45 días (para no contar dos veces la misma compra)
      t.ventasPrev = (await env.DB.prepare("SELECT ts, dato FROM w_hito WHERE conv=? AND tipo='venta' AND COALESCE(oculto,0)=0 AND ts<? AND ts>=? ORDER BY ts DESC LIMIT 3").bind(t.conv, ini, ini - 60 * 86400e3).all()).results || [];
      const pagosPrev = (await env.DB.prepare("SELECT yo, texto, ts FROM w_msg WHERE conv=? AND ts<? AND ts>=? AND (lower(texto) LIKE '%comprobante%' OR lower(texto) LIKE '%seña%' OR lower(texto) LIKE '%sena%' OR lower(texto) LIKE '%transfer%' OR lower(texto) LIKE '%pag%' OR lower(texto) LIKE '%abon%') ORDER BY ts DESC LIMIT 6").bind(t.conv, ini - 6 * 3600e3, ini - 45 * 86400e3).all()).results || [];
      const k = `${t.conv}|${t.dia}`; mapa[k] = t;
      const antes = [t.ventasPrev.length ? "VENTAS YA REGISTRADAS EN ESTE CHAT: " + t.ventasPrev.map((v) => `${fechaHora(v.ts).slice(0, 5)} ${v.dato || ""}`).join("; ") : "", pagosPrev.length ? "PAGOS O SEÑAS DE DÍAS ANTERIORES: " + pagosPrev.reverse().map((m) => `[${fechaHora(m.ts).slice(0, 5)}] ${m.yo ? "NOSOTROS" : "CLIENTE"}: ${String(m.texto).slice(0, 140)}`).join(" | ") : ""].filter(Boolean).join("\n");
      bloques.push(`### CHAT ${k} (${c?.nombre || "sin nombre"})${previo ? " [hay mensajes de días anteriores]" : t.empieza ? " [primer mensaje registrado este día]" : ""}
${antes ? antes + "\n" : ""}` + ms.map((m, n) => `${m.ts < ini ? "(día anterior) " : ""}#${n} ${m.yo ? "NOSOTROS" : "CLIENTE"}: ${String(m.texto).slice(0, 300)}`).join("\n"));
    }
    const r = await iaJSON(env, `Sos auditor de "Te Importamos" (importación por encargo). Contá las COTIZACIONES que NOSOTROS le mandamos al cliente en cada chat, solo en los mensajes que NO dicen "(día anterior)".
Una cotización es cuando le pasamos al cliente el precio de lo que pidió (precio puesto en Argentina, total, unitario, por cantidad), ya sea en texto, en una captura o en un PDF.
Los adjuntos (fotos, capturas, PDF) aparecen como "(archivo)" o con su texto al pie: deducí por el contexto si eran la cotización (ej. "ahi te cotizo" + (archivo); "ahi esta por 50 unidades"; (archivo) y después el cliente pregunta "¿ese precio es puesto acá?", "le falta un 0 al flete?", "me quedaria en..."; "te armo por 80 y 100" + (archivo)).
Varios archivos seguidos del mismo producto = UNA cotización. Una cotización nueva por otra cantidad u otro producto = otra cotización.
NO cuentan: catálogos o listas generales de precios ("PRECIOS MAYORISTA DE ZAPATILLAS", PDF de catálogo), fotos de productos de ejemplo, datos de pago o envío, mensajes automáticos, chats con proveedores (cuando NOSOTROS le compramos a ellos) ni charlas internas del equipo.
VENTAS: marcá "venta" SOLO si ESE DÍA (mensajes sin "(día anterior)") el cliente nos PAGÓ por primera vez esa compra: mandó el comprobante de la seña o del total, o le confirmamos que recibimos su pago. NO es venta del día: pagar el ENVÍO, el flete o el correo (Andreani, OCA, Vía Cargo, moto, etc.), pagar el saldo o el resto de una compra ya señada, pasarle el código de seguimiento, avisar que salió o llegó el pedido, datos de envío, reclamos, pedir el alias sin pagar todavía, ni pagos que NOSOTROS le hacemos a un proveedor.
Si el chat dice "VENTAS YA REGISTRADAS" o "PAGOS O SEÑAS DE DÍAS ANTERIORES", esa compra YA se contó: un comprobante nuevo es casi siempre envío o saldo de lo mismo → venta null. Solo es venta si se ve claramente que es una compra NUEVA de otro producto u otro pedido (y entonces "compra_nueva": true). Ante la duda, venta null: es peor inflar las ventas que perder una.
CHAT NUEVO: "primer_contacto" true solo si este día es la primera vez que esta persona nos escribe (consulta inicial, sin señales de que ya nos conocía: compras anteriores, pedidos en curso, "como te dije", etc.).
Devolvé JSON: {"chats":[{"chat":"id exacto","interno":true SOLO si es una charla entre socios del equipo o con un proveedor, forwarder, agente de carga, despachante o transportista (gente a la que NOSOTROS le pagamos) (si no, false),"primer_contacto":true|false,"cotizaciones":[{"msg":número del mensaje (#) donde se mandó,"producto":"2-5 palabras"}],"venta":null o {"msg":número del mensaje del pago o la confirmación,"producto":"2-5 palabras","monto":"si se ve, si no \"\"","concepto":"sena" | "total" | "saldo" | "envio" | "otro","compra_nueva":true si es un pedido distinto de las ventas ya registradas (si no hay ventas previas, true)}}]}

${bloques.join("\n\n")}`, { sinRespaldo: true });
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
      // Venta del día: se reemplaza lo de ese día (lo que marcaste como "no es venta" queda oculto)
      ops.push(env.DB.prepare("DELETE FROM w_hito WHERE conv=? AND tipo='venta' AND ts>=? AND ts<? AND COALESCE(oculto,0)=0").bind(t.conv, t.ini, t.ini + 86400e3));
      if (!t.prov && a.interno !== true && esVentaReal(a.venta, t)) {
        const m = t.ms[parseInt(a.venta.msg)], ts = m && m.ts >= t.ini ? m.ts : t.ini + 12 * 3600e3;
        ops.push(env.DB.prepare("INSERT OR IGNORE INTO w_hito (id,conv,tipo,ts,dato) VALUES (?,?,?,?,?)").bind(`vi:${t.conv}:${t.dia}`, t.conv, "venta", ts, `${String(a.venta.producto || "").slice(0, 80)}${a.venta.monto ? " · " + String(a.venta.monto).slice(0, 40) : ""}`));
      }
      if (t.empieza) ops.push(env.DB.prepare("UPDATE w_conv SET nuevo_ok=? WHERE conv=?").bind(t.prov || a.interno === true || a.primer_contacto === false ? 0 : 1, t.conv));
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
    q("SELECT * FROM w_conv WHERE ult_cliente_ts>=? AND grupo=0 AND archivado=0 AND ult_yo=0 AND COALESCE(prov,0)=0 AND lower(COALESCE(producto,'')) NOT LIKE '%vap%' AND lower(COALESCE(producto,'')) NOT LIKE '%elf%bar%' AND lower(COALESCE(producto,'')) NOT LIKE '%pod%' AND ult_cliente_ts>COALESCE(visto_ts,0) ORDER BY COALESCE(resp,1) DESC, COALESCE(puntaje,5) DESC, ult_cliente_ts ASC LIMIT 120", Date.now() - 14 * 86400e3),
    q("SELECT * FROM w_conv WHERE grupo=0 AND archivado=0 AND COALESCE(prov,0)=0 AND COALESCE(visto_esc,0)<ult_ts AND puntaje>=6 AND accion<>'' AND etapa NOT IN ('vendido','perdido','no_cliente') AND ult_ts>=? ORDER BY puntaje DESC, ult_ts DESC LIMIT 40", Date.now() - 10 * 86400e3),
    q("SELECT * FROM w_conv WHERE ult_ts>=? AND grupo=0 AND archivado=0 AND cot_pend=1 AND COALESCE(prov,0)=0 AND COALESCE(visto_cot,0)<ult_ts ORDER BY ult_cliente_ts ASC LIMIT 40", Date.now() - 14 * 86400e3),
    q("SELECT h.id, h.ts, h.dato, c.conv, c.nombre, c.producto FROM w_hito h LEFT JOIN w_conv c ON c.conv=h.conv WHERE h.tipo='venta' AND COALESCE(h.oculto,0)=0 AND COALESCE(c.prov,0)=0 ORDER BY h.ts DESC LIMIT 20"),
  ]);
  return { sinResponder, escribiles, cotPend, ventasRec };
}

// ---------------------------------------------------------------------------
// 5) Telegram (alertas y reportes al celular, gratis)
// ---------------------------------------------------------------------------
// Avisos automáticos por Telegram: el dueño no los lee, así que solo pasan los de "algo se rompió".
// El resto (reportes, cotizaciones, seguimientos, videos listos) queda en el panel y el asistente los resume en su plan.
// Para volver a recibir todo: kv telegram_avisos = "todos".
const AVISO_CRITICO = /desvincul|no llegan mensajes|No pude editar|Videos: hay .* guardados/i;
export async function telegram(env, texto) {
  if (!AVISO_CRITICO.test(String(texto)) && env.TELEGRAM_AVISOS !== "todos" && (await kvGet(env, "telegram_avisos")) !== "todos") return false;
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
  let r = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/getUpdates`).then((x) => x.json()).catch(() => null);
    if (!r?.ok) { try { r = { result: JSON.parse((await env.DB.prepare("SELECT v FROM kv WHERE k='tg_updates'").first())?.v || "[]") }; } catch {} }   // con el asistente activo, Telegram usa webhook
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
MENSAJES EN GRUPOS: ${JSON.stringify(grupos).slice(0, 12000)} OBJETIVOS Y AVANCE: ${JSON.stringify((await avanceObjetivos(env).catch(() => [])).map((o) => ({ metrica: o.metrica, periodo: o.periodo, meta: o.meta, actual: o.actual })))} POR PERFIL (A Mercado Libre, B negocio, C revendedor chico, D consumidor, E curioso): ${JSON.stringify(await metricasPerfil(env, desde).catch(() => null))} SEGUIMIENTOS PENDIENTES: ${JSON.stringify((await seguimientos(env).catch(() => [])).slice(0, 15).map((s) => ({ nombre: s.nombre, conv: s.conv, perfil: s.perfil, producto: s.producto, usd: s.presup_usd, dias: s.dias_cot })))}
Devolvé JSON: {"titular":"1 oración con lo más importante","claves":["3-6 hallazgos concretos con números"],"oportunidades":["hasta 6: a quién escribir y por qué, con nombre"],"problemas":["hasta 4: qué se está haciendo mal (ej. demoras, cotizaciones sin mandar)"],"grupos":"2-3 oraciones de qué se pidió/habló en los grupos, o vacío","recomendacion":"1-2 acciones para mañana/la semana","manana":["3 acciones concretas para mañana, cada una con nombre y número del cliente; prioridad perfil A y B y seguimientos pendientes"],"avance":"1 oración: cómo vamos con los objetivos (o vacío si no hay)","manana":["3 acciones concretas para mañana, cada una con nombre y número del cliente; prioridad perfil A y B y seguimientos pendientes"],"avance":"1 oración: cómo vamos con los objetivos (o vacío si no hay)","manana":["3 acciones concretas para mañana, cada una con nombre y número del cliente; prioridad perfil A y B y seguimientos pendientes"],"avance":"1 oración: cómo vamos con los objetivos (o vacío si no hay)","manana":["3 acciones concretas para mañana, cada una con nombre y número del cliente; prioridad perfil A y B y seguimientos pendientes"],"avance":"1 oración: cómo vamos con los objetivos (o vacío si no hay)","difusion":[{"producto":"producto a empujar en los grupos de leads","por_que":"1 oración con datos: cuántos lo pidieron, tendencia","mensaje":"mensaje LISTO para pegar en el grupo: corto (3-6 líneas), tono Te Importamos (cercano, rioplatense), con gancho, beneficio (importación directa, mejor precio que Mercado Libre, cupos por cantidad) y llamado a la acción (escribime / reservá tu cupo). Sin emojis de más y sin inventar precios que no estén en los datos."}]}
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

export async function repararBot(env) {
  const filas = (await env.DB.prepare("SELECT DISTINCT conv FROM w_msg WHERE yo=1 AND grupo=0 AND ts>=? AND (lower(texto) LIKE '%te voy a derivar%' OR lower(texto) LIKE '%se pondrán en contacto%' OR lower(texto) LIKE '%se pondran en contacto%')").bind(Date.now() - 30 * 86400e3).all()).results || [];
  const ops = [];
  for (const f of filas) {
    const ms = (await env.DB.prepare("SELECT yo, texto, ts FROM w_msg WHERE conv=? ORDER BY ts DESC LIMIT 40").bind(f.conv).all()).results || [];
    const reales = ms.filter((m) => !(m.yo && esBot(m.texto)));
    const ult = reales[0]; if (!ult) continue;
    const ultYoTs = reales.find((m) => m.yo)?.ts || 0, ultCli = reales.find((m) => !m.yo)?.ts || 0;
    ops.push(env.DB.prepare("UPDATE w_conv SET ult_yo=?, ult_yo_ts=?, ult_cliente_ts=?, ult_texto=?, analizado_ts=0 WHERE conv=?").bind(ult.yo ? 1 : 0, ultYoTs, ultCli, String(ult.texto).slice(0, 200), f.conv));
  }
  for (let i = 0; i < ops.length; i += 80) await env.DB.batch(ops.slice(i, i + 80));
  await kvPut(env, "lector_bot_v1", Date.now());
  return ops.length;
}

export async function cronLector(env, iaJSON, scheduledTime) {
  if (!env.DB || !env.LECTOR_TOKEN) return;   // el lector no está configurado todavía
  await prepararLector(env);
  if (!(await kvGet(env, "lector_reparado_v1"))) await repararPropios(env).catch((e) => console.log("lector reparar", e?.stack || e));
  if (!(await kvGet(env, "lector_resp_v1"))) { await env.DB.prepare("UPDATE w_conv SET analizado_ts=0 WHERE ult_yo=0 AND grupo=0 AND ult_cliente_ts>=?").bind(Date.now() - 72 * 3600e3).run(); await kvPut(env, "lector_resp_v1", Date.now()); }
  if (!(await kvGet(env, "lector_ventas_v1"))) { await env.DB.prepare("UPDATE w_conv SET analizado_ts=0 WHERE conv IN (SELECT conv FROM w_hito WHERE tipo='venta') OR ult_ts>=?").bind(Date.now() - 3 * 86400e3).run(); await kvPut(env, "lector_ventas_v1", Date.now()); }
  if (!(await kvGet(env, "lector_audit_v4"))) {
    await env.DB.batch([env.DB.prepare("DELETE FROM w_audit"), env.DB.prepare("DELETE FROM w_hito WHERE tipo='venta' AND id LIKE 'v:%' AND COALESCE(oculto,0)=0")]);
    const dias = []; for (let t = Date.parse("2026-10-01T12:00:00Z"); diaAR(t) < diaAR(Date.now()); t += 86400e3) dias.push(diaAR(t));
    await kvPut(env, "lector_backfill", JSON.stringify(dias)); await kvPut(env, "lector_audit_v4", Date.now());
  }
  if (!(await kvGet(env, "lector_pend_res_v1"))) {
    await env.DB.prepare("UPDATE tareas SET estado='resuelta' WHERE estado='abierta' AND ref LIKE 'w805:%' AND tipo IN ('cotizacion','promesa') AND EXISTS (SELECT 1 FROM w_msg m WHERE m.conv=tareas.tel AND m.yo=1 AND m.ts>tareas.ts AND (m.tipo<>'text' OR m.texto LIKE '(archivo)%' OR m.texto LIKE '%http%' OR m.texto LIKE '%usd%' OR m.texto LIKE '%$%'))").run();
    await kvPut(env, "lector_pend_res_v1", Date.now());
  }
  if (!(await kvGet(env, "lector_pend_v2"))) { await env.DB.prepare("UPDATE w_conv SET analizado_ts=0 WHERE conv IN (SELECT tel FROM tareas WHERE estado='abierta' AND ref LIKE 'w805:%')").run(); await kvPut(env, "lector_pend_v2", Date.now()); }
  if (!(await kvGet(env, "lector_pend_v1"))) { await env.DB.prepare("UPDATE w_conv SET analizado_ts=0 WHERE grupo=0 AND ult_ts>=?").bind(Date.now() - 3 * 86400e3).run(); await kvPut(env, "lector_pend_v1", Date.now()); }
  if (!(await kvGet(env, "lector_cotiz_v2"))) await recalcularCotizaciones(env).catch((e) => console.log("lector cotiz", e?.stack || e));
  if (!(await kvGet(env, "lector_bot_v1"))) await repararBot(env).catch((e) => console.log("lector bot", e?.stack || e));
  // Ventas v2 (29/10): se vuelven a revisar las ventas del último mes con las reglas nuevas (envío/saldo/compra repetida no cuentan)
  if (!(await kvGet(env, "ventas_v2"))) {
    const l = (await env.DB.prepare("SELECT DISTINCT conv, ts FROM w_hito WHERE tipo='venta' AND COALESCE(oculto,0)=0 AND ts>=? ORDER BY ts").bind(Date.now() - 35 * 86400e3).all()).results || [];
    await kvPut(env, "ventas_v2_pend", JSON.stringify([...new Set(l.map((x) => x.conv + "|" + diaAR(x.ts)))])); await kvPut(env, "ventas_v2", Date.now());
  }
  {
    const pend = JSON.parse((await kvGet(env, "ventas_v2_pend")) || "[]");
    if (pend.length) {   // de a 2 por minuto, en orden (así las primeras quedan como "ya registradas" para las siguientes)
      for (const x of pend.splice(0, 2)) { const [conv, dia] = x.split("|"); await auditarCotizaciones(env, iaJSON, { dia, conv, rehacer: true, limite: 1 }).catch((e) => console.log("ventas v2", e?.stack || e)); }
      await kvPut(env, "ventas_v2_pend", JSON.stringify(pend));
    }
  }
  const t = new Date(scheduledTime);
  const m = t.getUTCMinutes(), hAR = (t.getUTCHours() + 21) % 24;
  if (m % 15 === 7) await analizarChats(env, iaJSON).catch((e) => console.log("lector analizar", e?.stack || e));
  // Pendientes viejos: si ya le escribimos después de crearse (y lo último es nuestro), o pasaron 4 días sin que el cliente escriba, se cierran solos (van a seguimientos)
  if (m % 15 === 9) await env.DB.prepare("UPDATE tareas SET estado='resuelta' WHERE estado='abierta' AND ref LIKE 'w805:%' AND EXISTS (SELECT 1 FROM w_conv c WHERE c.conv=tareas.tel AND ((c.ult_yo=1 AND COALESCE(c.ult_yo_ts,0)>tareas.ts) OR (tareas.ts<? AND COALESCE(c.ult_cliente_ts,0)<tareas.ts)))").bind(Date.now() - 4 * 86400e3).run().catch((e) => console.log("lector pend cierre", e?.stack || e));
  // Seguimientos: la IA va revisando la lista de a 20 durante el día (8 a 21 h), así a las 10 ya está casi toda lista
  if (m % 30 === 13 && hAR >= 8 && hAR < 21) await revisarSeguimientos(env, iaJSON, { limite: 0, tope: SEG.revisarPorCron }).catch((e) => console.log("lector seguimientos", e?.stack || e));
  if (m % 15 === 11) await auditarCotizaciones(env, iaJSON, { limite: 18 }).catch((e) => console.log("lector auditar", e?.stack || e));
  if (m % 15 === 4) {   // recálculo de días anteriores, de a uno, hasta terminar
    const pend = JSON.parse((await kvGet(env, "lector_backfill")) || "[]");
    if (pend.length) {
      const r = await auditarCotizaciones(env, iaJSON, { dia: pend[pend.length - 1], limite: 18 }).catch(() => null);
      if (r && r.pendientes === 0) { pend.pop(); await kvPut(env, "lector_backfill", JSON.stringify(pend)); }
    }
  }
  if (m % 30 === 3) await alertasRapidas(env).catch((e) => console.log("lector alertas", e?.stack || e));
  { const lista = [...NO_CLIENTES], kf = "no_clientes:" + lista.join(","); if (lista.length && !(await kvGet(env, kf))) { const q = lista.map(() => "?").join(","); await env.DB.batch([env.DB.prepare(`UPDATE w_conv SET prov=1, perfil=NULL, etapa='no_cliente' WHERE conv IN (${q})`).bind(...lista), env.DB.prepare(`UPDATE w_hito SET oculto=1 WHERE tipo='venta' AND conv IN (${q})`).bind(...lista), env.DB.prepare(`UPDATE tareas SET estado='resuelta' WHERE estado='abierta' AND tel IN (${q})`).bind(...lista), env.DB.prepare("DELETE FROM kv WHERE k='lector_resumen'")]); await kvPut(env, kf, Date.now()); } }
  if (!(await kvGet(env, "perfil_v1"))) { await env.DB.prepare("UPDATE w_conv SET analizado_ts=0 WHERE grupo=0 AND ult_ts>=?").bind(Date.now() - 14 * 86400e3).run(); await kvPut(env, "perfil_v1", Date.now()); }
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
    const cotPorDia = {}, venPorDia = {}, cotVistos = new Set();
    for (const k in porDia) { cotPorDia[k] = 0; venPorDia[k] = 0; }
    const hitosDia = (await env.DB.prepare("SELECT h.tipo, h.ts, h.conv FROM w_hito h LEFT JOIN w_conv c ON c.conv=h.conv WHERE h.tipo IN ('cotizacion','venta') AND h.ts>=? AND COALESCE(h.oculto,0)=0 AND COALESCE(c.prov,0)=0").bind(hoy - 29 * 86400e3).all()).results || [];
    for (const h of hitosDia) {
      const k = diaAR(h.ts);
      if (!(k in porDia)) continue;
      if (h.tipo === "venta") venPorDia[k]++;
      else if (!cotVistos.has(k + h.conv)) { cotVistos.add(k + h.conv); cotPorDia[k]++; }
    }
    const d = { dist, dia, semana, mes, ...l, estado, ultimo: +(await kvGet(env, "lector_ultimo")) || null, telegram: !!(env.TELEGRAM_TOKEN && (env.TELEGRAM_CHAT || (await kvGet(env, "telegram_chat")))), configurado: !!env.LECTOR_TOKEN, productos, nuevosPorDia: porDia, cotPorDia, venPorDia };
    await kvPut(env, "lector_resumen", JSON.stringify({ ts: Date.now(), d }));
    return json(d);
  }
  if (r === "chats") {
    const q = (url.searchParams.get("q") || "").trim(), f = url.searchParams.get("f") || "todos";
    const cond = { todos: "1=1", calientes: "puntaje>=7", sin: "ult_yo=0", cotizar: "cot_pend=1", grupos: "grupo=1", archivados: "archivado=1", urgentes: "COALESCE(prov,0)=0 AND ult_ts>=" + (Date.now() - 3 * 86400e3) + " AND etapa NOT IN ('vendido','perdido','no_cliente') AND (accion LIKE '%|p1' OR (resp=1 AND ult_yo=0 AND puntaje>=7) OR (cot_pend=1 AND puntaje>=6))" }[f] || "1=1";
    const filas = (await env.DB.prepare(`SELECT * FROM w_conv WHERE ${cond} ${f === "archivados" ? "" : "AND archivado=0"} ${f === "grupos" ? "" : "AND grupo=0"} ${q ? "AND (nombre LIKE ? OR conv LIKE ? OR producto LIKE ?)" : ""} ORDER BY ${f === "urgentes" ? "puntaje DESC, ult_ts DESC" : "ult_ts DESC"} LIMIT 200`)
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
    if (b.lista !== "ven") await env.DB.prepare("UPDATE tareas SET estado='hecha' WHERE ref=? AND estado='abierta'").bind("w805:" + conv).run();
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
    if (r === "preguntar" && req.method === "POST") { const b = await req.json().catch(() => ({})); return json(await preguntarVendedor(env, iaJSON, b.pregunta)); }
  if (r === "seguimiento") return json(await seguimientos(env));
  if (r === "objetivos") return json(await avanceObjetivos(env));
  if (r === "ventas-dia") {   // ventas de un día (al tocar el gráfico del dashboard)
    const dd = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get("d") || "") ? url.searchParams.get("d") : diaAR(), ini = Date.parse(dd + "T00:00:00Z") + AR;
    const l = (await env.DB.prepare("SELECT h.id, h.ts, h.dato, h.conv, c.nombre, c.producto, c.perfil FROM w_hito h LEFT JOIN w_conv c ON c.conv=h.conv WHERE h.tipo='venta' AND h.ts>=? AND h.ts<? AND COALESCE(h.oculto,0)=0 AND COALESCE(c.prov,0)=0 ORDER BY h.ts").bind(ini, ini + 86400e3).all()).results || [];
    return json({ dia: dd, ventas: l.map((x) => ({ id: x.id, ts: x.ts, conv: x.conv, nombre: x.nombre || "", perfil: x.perfil || "", producto: String(x.dato || "").split(" · ")[0] || x.producto || "", detalle: String(x.dato || "").slice(0, 300) })) });
  }
  if (r === "ventas") {
    const p = url.searchParams.get("p") || "semana", hoy = inicioDiaAR(), desde = p === "dia" ? hoy : p === "mes" ? hoy - 29 * 86400e3 : hoy - 6 * 86400e3;
    const [objetivos, segs, perfil] = await Promise.all([avanceObjetivos(env), seguimientos(env), metricasPerfil(env, desde)]);
    return json({ objetivos, seguimientos: segs, perfil });
  }
  if (r === "seguimiento-no" && req.method === "POST") { const b = await req.json().catch(() => ({})); await env.DB.prepare("UPDATE w_conv SET seg_no=? WHERE conv=?").bind(Date.now(), String(b.conv || "")).run(); return json({ ok: true }); }
  if (r === "seguimiento-listo" && req.method === "POST") { const b = await req.json().catch(() => ({})); await env.DB.prepare("UPDATE w_conv SET seg_visto=? WHERE conv=?").bind(Date.now(), String(b.conv || "")).run(); return json({ ok: true }); }
  if (r === "equipo") { const p = url.searchParams.get("p") || "semana", hoy = inicioDiaAR(); return json(await metricasEquipo(env, p === "dia" ? hoy : p === "mes" ? hoy - 29 * 86400e3 : hoy - 6 * 86400e3)); }
  if (r === "objetivo-borrar" && req.method === "POST") { const b = await req.json().catch(() => ({})); await env.DB.prepare("UPDATE ag_obj SET activo=0 WHERE id=?").bind(+b.id || 0).run(); return json({ ok: true }); }
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

// ---------------------------------------------------------------------------
// 10) Jefe de ventas: perfiles, seguimiento, objetivos y memoria (un solo agente)
// ---------------------------------------------------------------------------
const DOLAR = 1450;   // pesos por dólar para estimar presupuestos (ajustalo cada tanto)
const METRICAS_OBJ = ["chats_nuevos", "chats_ab", "cotizaciones", "chats_cotizados", "ventas"];
// Manual del asesor de ventas. Basado en ideas de: SPIN Selling (Rackham), The Challenger Sale, $100M Offers (Hormozi),
// Nunca dividas la diferencia (Voss), Fanatical Prospecting (Blount), Psicología de la venta (Brian Tracy),
// 10X y Vendes o vendes (Grant Cardone) y El pequeño libro rojo de las ventas (Gitomer). Escrito con palabras propias. Para cambiarlo, editá este texto.
const MANUAL_VENTAS = `
PARTE 1 · TU ROL Y TUS REGLAS (no negociables)
Sos el asesor de ventas de Manuel. No hablas con clientes: lees los datos del WhatsApp 805 y le decis a Manuel que hacer. Los mensajes que escribas son borradores para que el los copie y mande a mano.
Reglas anti chamuyo:
1. Cada afirmacion se apoya en un dato de abajo (numero, cliente con nombre y telefono, frase del chat). Si no hay dato, decis "no tengo ese dato" y como conseguirlo.
2. Separas siempre: DATO (medido por el codigo), ESTIMACION (lo calculo la IA, ej. perfil o presupuesto) y OPINION (tu criterio). Lo aclaras.
3. Si Manuel propone algo que los datos no apoyan, se lo decis con respeto y con el numero. No le das la razon para quedar bien.
4. Si hay pocos datos (menos de una semana o menos de 20 chats de un grupo), lo avisas: la conclusion es provisoria.
5. Nada de frases motivacionales vacias ni consejos genericos ("mejora la atencion"). Siempre: que hacer, con quien, cuando y por que.
6. Si algo no se puede saber leyendo el chat (un audio, una foto, un PDF), lo decis.

PARTE 2 · COMO DIAGNOSTICAS (en este orden, cuando pregunta por que no vende o que mejorar)
1. Trafico: cuantos chats llegaron y de que perfil. Si menos del 20% son A o B, el problema principal es el contenido o el canal que trae gente, no la atencion.
2. Calificacion: a cuantos A y B se les pregunto para que, cuanto y presupuesto en los primeros mensajes.
3. Velocidad: tiempo de respuesta. A y B esperando mas de 1 hora es plata que se pierde.
4. Cotizacion: de los A y B, cuantos recibieron precio. Si piden precio y no lo reciben, ahi esta el agujero.
5. Seguimiento: de los cotizados que no compraron, a cuantos se les volvio a escribir. La mayoria de las ventas se pierden aca.
6. Cierre: cuantos que mostraron interes recibieron una propuesta concreta para pagar la seña.
7. Margen: si hay ventas pero poca plata, revisar ticket y precio (honorarios fijos de USD 80 pesan mucho en pedidos chicos).
Siempre decis cual es EL cuello de botella principal (uno solo) y las 3 acciones de mayor impacto, ordenadas.

PARTE 3 · LO QUE SABES DE VENTAS (para enseñarle y corregirle)
- Prioridad (Tracy): el 20% de los clientes trae el 80% de la plata. El tiempo va a A y B; a los E, respuesta corta y link.
- Velocidad y volumen (Cardone): el que responde primero y hace seguimiento gana. Falta de seguimiento y de volumen de actividad es la causa numero uno de pocas ventas. Objetivos 10 veces mas ambiciosos en actividad, no en ilusiones.
- Seguimiento (Blount): la venta casi nunca sale al primer contacto. Cadencia sugerida despues de cotizar: dia 1, 3, 7 y 14, cada toque con algo nuevo (dato, variante, cupo que cierra, caso real). Nunca solo "pudiste verlo?".
- Descubrir la necesidad (SPIN): antes de cotizar preguntar situacion (a cuanto compra hoy, cuanto vende), problema (que le complica su proveedor), implicancia (cuanto margen pierde, que pasa si se queda sin stock) y beneficio (cuanto mas ganaria si lo trae mas barato). El cliente se convence con su propio numero.
- Enseñar y liderar (Challenger): darle al cliente un dato que no sabia y que cambia su decision: costo puesto en su casa contra Mercado Libre, cupos para llegar a precio mayorista, como pesa el flete segun la cantidad. Liderar la charla con seguridad.
- La oferta (Hormozi): el valor sube cuando el resultado es claro, creible, rapido y con poco esfuerzo para el cliente. Nunca bajar el precio primero: sumar valor (seguimiento por etapa, asesoramiento, "nos encargamos de todo"). Urgencia solo si es real. Cotizar al revendedor mostrando la ganancia, no solo el costo.
- Objeciones (Voss): primero nombrar lo que siente ("parece que te preocupa el precio"), despues preguntas abiertas que empiezan con "que" o "como" ("que tendria que pasar para que te cierre?"). Aislar la objecion real. "Lo pienso" casi siempre es una duda no dicha: hay que encontrarla.
- Confianza (Gitomer): a la gente le encanta comprar pero odia que le vendan. Ayudar primero, dar valor gratis (contenido, datos), ser cercano. La gente le compra a quien le cae bien y en quien confia; las recomendaciones valen mas que la publicidad.
- Cierre (Tracy y Cardone): pedir la venta. Dar por hecho que avanza y ofrecer opciones ("avion o barco?", "50 o 100?", "te paso el alias para la seña?"). Despues de preguntar, esperar.
- Posventa: avisar cada etapa, pedir recomendacion al entregar y volver a escribir a los 30 a 45 dias para reponer.

PARTE 4 · COMO LE RESPONDES A MANUEL
- Primero la respuesta directa en una o dos oraciones. Despues el respaldo con datos. Al final, que hacer hoy.
- Cuando recomiendes algo, nombras de que principio sale (ej. "seguimiento, Blount") para que Manuel aprenda.
- Si pide mensajes para clientes: cortos, en su tono (voseo, sin emojis), uno por cliente, y aclaras que son para que los mande el.
- Si pide objetivos: realistas, medibles con las metricas que existen y basados en los ultimos 30 dias.
- Si te pregunta algo de negocio que no esta en los datos (ej. si conviene vender en Mercado Libre), das tu opinion marcada como OPINION, con los pros, los contras y que dato haria falta para decidir.
`;
// ---------------------------------------------------------------------------
// Seguimientos: clientes a los que les MANDAMOS ALGO (cotización, precios, catálogo o info) y no avanzaron
// ---------------------------------------------------------------------------
// 1) Código (exacto): en los últimos 30 días le mandamos una cotización (w_hito) o, escrito por una persona
//    (no el bot de bienvenida), un precio, un catálogo / lista de precios, un archivo o info del proceso
//    (tiempos, envío, seña, mínimo). No compró después, no es proveedor, la pelota está del lado del cliente
//    (lo último es nuestro, o un "gracias / después te digo / lo veo" que no pide respuesta), no le debemos
//    nada (cotización o promesa pendiente) y le toca según la cadencia: 1, 2, 4 y 7 días entre toques
//    (máximo 4 toques; después se da por frío). Un número = una fila (sin repetidos aunque cambie el formato).
// 2) IA (una vez por día por chat): lee la charla, descarta lo que no hace falta seguir (ya compró, dijo que no,
//    quedó en escribir él en una fecha que no llegó, lo que le mandamos no era comercial, le debemos algo)
//    y saca qué le mandamos (producto, cantidad y monto) + el mensaje listo. Lo que descarta no vuelve a
//    aparecer ese día en ningún lado (Telegram, panel, agente).
const RE_PREG_SEG = /seguimiento|(cotiz\w*|precio|info\w*).{0,80}(no (contest|respond)\w*|gracias|seguir|escribir)|(no (contest|respond)\w*|dijeron gracias).{0,80}(cotiz|precio|info)|a quien (le )?(tengo|tenemos|hay) que (escribir|seguir)/;
const SEG = { dias: 30, esperas: [1, 2, 4, 7], revisarPorLlamada: 40, revisarPorCron: 20, porLlamada: 10 };
// "Gracias", "dale", "lo veo", "después te digo", "ahí me fijo": no pide respuesta, la pelota sigue del lado del cliente
const RE_ACUSE = /^\s*(ok(a|ey|is)?|okay|dale|gracias|graciass*|muchas gracias|mil gracias|genial|perfecto|buen[ií]simo|bueno|b[aá]rbaro|joya|listo|de una|lo veo|lo pienso|lo charlo|lo hablo|lo consulto|te aviso|te confirmo|cualquier cosa|despu[eé]s (te|vemos|lo)|ah[ií] (me fijo|veo|lo veo)|voy a ver|veo y te|ma[nñ]ana te|en la semana te|👍|🙏|🙌|👌)/i;
const RE_ACUSE_EN = /(despu[eé]s te (respondo|aviso|digo|escribo|confirmo)|despu[eé]s vemos|lo veo y te|lo (pienso|charlo|hablo|consulto)|te (aviso|confirmo|digo)\b|ah[ií] me fijo|voy a ver|veo bien|en la semana|ma[nñ]ana te|cualquier cosa te|qu[eé] s[eé] yo)/i;
const RE_PIDE = /pas[aá]me|mand[aá]me|cu[aá]nto|precio|quiero|necesito|ten[eé]s|tienen|hay (de|en)|y (el|la|los|las|si)\b/i;
const esAcuse = (t) => { t = String(t || "").trim(); return t.length > 0 && t.length < 140 && !/\?/.test(t) && !RE_PIDE.test(t) && (RE_ACUSE.test(t) || RE_ACUSE_EN.test(t)); };
// Dijo claramente que no, o que ya lo resolvió: no se le insiste (el resto lo decide la IA leyendo la charla)
const RE_NO_SEGUIR = /\bno (me )?(interesa|sirve|gracias|va|voy a (comprar|seguir))|lo dejo\b|lo dejamos\b|ya (lo )?(compr[eé]|consegu[ií]|consegu[ií]|lo tengo|tengo proveedor)|no (estoy|ando) (buscando|interesad)|desisto|olvidate|no quise hacer(te|les)? perder|no me (genera|da) confianza|no me (cierra|conviene)|(abrazo|saludos?)\W{0,3}(y )?suerte|por ahora no\b|ya no (lo )?(necesito|quiero)/i;
// Lo que mandamos que cuenta como "le pasamos algo" (escrito por una persona, no el bot automático)
const RE_AUTO = /^(¡?bienvenid|gracias por (escribir|consultar|compartir|enviar|el dato|tu consulta)|te qued[oó] pendiente|quedamos atentos a tu consulta|te dejo la consulta abierta|ya pas[eé] tu|te voy a derivar|perfecto,? .{0,20}¿qu[eé] (modelo|producto|cantidad))/i;
// Precio = un monto con número (un "¿pudiste ver la cotización?" sin números es un toque, no algo nuevo que le mandamos)
const RE_PRECIO_ENV = /(\$|usd|u\$s|us\$|d[oó]lares?)\s*\d|\d[\d.,]*\s*(usd|u\$s|us\$|d[oó]lares|pesos|mil|lucas)\b|\d[\d.,]*\s*(c\/u|cada un[oa]|por unidad|el par|la unidad)/i;
const RE_INFO_ENV = /cat[aá]logo|lista de precios|precios? mayorista|pdf|\d+\s*(a\s*\d+\s*)?d[ií]as|tarda|demora|env[ií]o|se[ñn]a\b|m[ií]nimo|despacho|aduana|como trabajamos|c[oó]mo es el proceso/i;
function queMandamos(m) {
  if (!m?.yo || esBot(m.texto)) return "";
  const t = String(m.texto || "").trim();
  if (!t || RE_AUTO.test(t)) return "";
  if (RE_PRECIO_ENV.test(t)) return "precio";
  if (/^\((archivo|image|imagen|document|documento|pdf)\)/i.test(t)) return "archivo";
  if (RE_INFO_ENV.test(t) && t.length >= 25) return "info";
  return "";
}
const ultimos10 = (x) => String(x || "").replace(/\D/g, "").slice(-10);
const PRI_PERFIL = { A: 0, B: 0, C: 1, D: 2 };
async function candidatosSeguimiento(env, ahora = Date.now()) {
  const todas = async (sql, ...b) => ((await env.DB.prepare(sql).bind(...b).all()).results || []);
  const desde = ahora - SEG.dias * 86400e3;
  // Chats con movimiento en la ventana (o con cotización en la ventana); 'perdido' entra igual (la IA mira si dijo que no),
  // 'vendido' solo si lo volvimos a cotizar. Todo por índice (sin subconsultas por fila): D1 cobra filas leídas.
  const cots = new Map((await todas(`SELECT conv, MAX(ts) ts FROM w_hito WHERE tipo='cotizacion' AND ts>=? GROUP BY conv`, desde)).map((x) => [x.conv, x.ts]));
  const cond = `grupo=0 AND archivado=0 AND COALESCE(prov,0)=0 AND COALESCE(etapa,'')<>'no_cliente' AND COALESCE(perfil,'')<>'E'`;
  const filas = await todas(`SELECT * FROM w_conv WHERE ult_ts>=? AND ${cond} ORDER BY ult_ts DESC LIMIT 1500`, desde);
  const ya = new Set(filas.map((f) => f.conv)), faltanCot = [...cots.keys()].filter((c) => !ya.has(c));
  for (let i = 0; i < faltanCot.length; i += 80) { const parte = faltanCot.slice(i, i + 80); filas.push(...(await todas(`SELECT * FROM w_conv WHERE conv IN (${parte.map(() => "?").join(",")}) AND ${cond}`, ...parte))); }
  for (const f of filas) f.cot_ts = cots.get(f.conv) || null;
  if (!filas.length) return [];
  const convs = filas.map((f) => f.conv);
  const ventas = new Map(), deuda = new Set(), msgs = new Map(), cotTxt = new Map();
  for (let i = 0; i < convs.length; i += 80) {
    const parte = convs.slice(i, i + 80), q = parte.map(() => "?").join(",");
    for (const v of await todas(`SELECT conv, MAX(ts) ts FROM w_hito WHERE tipo='venta' AND COALESCE(oculto,0)=0 AND conv IN (${q}) GROUP BY conv`, ...parte)) ventas.set(v.conv, v.ts);
    for (const h of await todas(`SELECT conv, ts, dato FROM w_hito WHERE tipo='cotizacion' AND ts>=? AND conv IN (${q}) ORDER BY ts`, desde, ...parte)) cotTxt.set(h.conv, h.dato || "");
    for (const t of await todas(`SELECT tel FROM tareas WHERE estado='abierta' AND tipo IN ('cotizacion','promesa','comprobante') AND tel IN (${q})`, ...parte).catch(() => [])) deuda.add(t.tel);
    for (const m of await todas(`SELECT conv, yo, texto, ts FROM w_msg WHERE ts>=? AND conv IN (${q}) ORDER BY ts`, desde - 86400e3, ...parte)) { if (!msgs.has(m.conv)) msgs.set(m.conv, []); msgs.get(m.conv).push(m); }
  }
  const lista = [];
  for (const f of filas) {
    if (deuda.has(f.conv) || f.cot_pend === 1) continue;              // le debemos algo: va a Pendientes, no a seguimientos
    const ms = (msgs.get(f.conv) || []).filter((m) => !(m.yo && esBot(m.texto)));
    // Qué le mandamos: la cotización registrada, o lo último con precio / catálogo / archivo / info que escribió una persona
    let envTs = 0, tipo = "";
    for (const m of ms) { const q = queMandamos(m); if (q) { envTs = m.ts; tipo = q === "archivo" ? (tipo === "precio" ? "precio" : "archivo") : q; } }
    let base = f.cot_ts || 0;
    if (base && base >= envTs - 3600e3) tipo = "cotizacion";
    else if (envTs) { base = envTs; if (f.cot_ts) tipo = "cotizacion"; }
    if (!base) continue;                                              // nunca le mandamos nada concreto (solo saludo o preguntas)
    if (tipo === "archivo" && !f.cot_ts && !ms.some((m) => !m.yo && m.ts > base)) {
      // Un archivo suelto nuestro cuenta solo si antes el cliente pidió precio/cotización o info
      const antes = ms.filter((m) => !m.yo && m.ts <= base).slice(-6).map((m) => m.texto).join(" ");
      if (!/precio|cu[aá]nto|cotiz|sale|valor|cat[aá]logo|info|link|alibaba|1688|temu|quiero|busco|necesito|unidades|pares/i.test(antes)) continue;
    }
    const venta = ventas.get(f.conv) || 0;
    if (venta >= base - 86400e3) continue;                            // compró después (o el mismo día) de lo que le mandamos
    if (f.etapa === "vendido" && !(f.cot_ts && f.cot_ts > venta)) continue;   // cliente que ya compró: solo si hay cotización nueva
    if ((f.seg_no || 0) >= base) continue;                            // "No seguir" para esto
    const ult = ms[ms.length - 1] || null;
    if (!ult && !f.cot_ts) continue;
    const clienteUltimo = ult ? !ult.yo : f.ult_yo === 0;
    if (clienteUltimo) {
      // Si lo último es del cliente, solo sigue si es un acuse ("gracias", "lo veo", "después te digo") que no pide respuesta
      const txt = String(ult?.texto ?? f.ult_texto ?? "");
      const iaDiceQueNo = f.resp === 0 && (f.analizado_ts || 0) >= (f.ult_ts || 0) && !/\?/.test(txt);
      if (!(esAcuse(txt) || iaDiceQueNo)) continue;
    }
    // Lo que dijo el cliente DESPUÉS de lo que le mandamos (por orden, así cuenta aunque sea el mismo minuto)
    let corte = -1; ms.forEach((m, i) => { if (m.ts <= base && (m.yo || m.ts < base)) corte = i; });
    const despues = ms.slice(corte + 1).filter((m) => !m.yo);
    const ultCli = despues[despues.length - 1] || null;
    if (despues.some((m) => RE_NO_SEGUIR.test(String(m.texto || "")))) continue;
    // Toques = días distintos en que le escribimos después de mandarle (o de su última respuesta)
    const desdeToque = Math.max(base, ultCli?.ts || 0);
    const dias = new Set(ms.filter((m) => m.yo && m.ts > desdeToque + 3 * 3600e3).map((m) => diaAR(m.ts)));
    if ((f.seg_visto || 0) > desdeToque) dias.add(diaAR(f.seg_visto));    // "Listo" en el panel o en Telegram cuenta como toque
    const toques = dias.size;
    if (toques >= SEG.esperas.length) continue;                       // ya le escribimos 4 veces sin respuesta: frío
    const movida = Math.max(f.ult_yo_ts || 0, f.ult_cliente_ts || 0, f.seg_visto || 0, ult?.ts || 0);
    const diasSin = (ahora - movida) / 86400e3;
    if (diasSin < SEG.esperas[toques]) continue;
    const t = ultCli ? String(ultCli.texto || "").replace(/\s+/g, " ").trim() : "";
    const reaccion = !ultCli ? "no respondió" : /^\((archivo|audio|image|imagen|ptt|sticker)/i.test(t) ? "mandó un audio o archivo" : `dijo "${t.slice(0, 40)}"`;
    lista.push({ conv: f.conv, nombre: f.nombre, perfil: f.perfil, presup_usd: f.presup_usd, producto: f.producto || cotTxt.get(f.conv) || "", etapa: f.etapa, puntaje: f.puntaje,
      ult_yo_ts: f.ult_yo_ts, seg_visto: f.seg_visto, ult_texto: f.ult_texto, ult_ts: f.ult_ts || movida, cot_ts: base, cot_dato: cotTxt.get(f.conv) || "", tipo,
      dias_cot: Math.floor((ahora - base) / 86400e3), dias_sin: Math.floor(diasSin), toque: toques + 1, reaccion, pri: PRI_PERFIL[f.perfil] ?? 2 });
  }
  // Sin repetidos: el mismo número (aunque venga con otro formato) queda una sola vez, el de lo más nuevo que le mandamos
  const unicos = new Map();
  for (const x of lista) { const k = ultimos10(x.conv) || x.conv, y = unicos.get(k); if (!y || x.cot_ts > y.cot_ts) unicos.set(k, x); }
  return [...unicos.values()].sort((a, b) => a.pri - b.pri || (b.presup_usd || 0) - (a.presup_usd || 0) || b.cot_ts - a.cot_ts);
}
// Revisión de la IA guardada por chat (no por día): se reusa mientras la charla no cambie.
// "No seguir" vale 3 días (por si quedó en escribir él en una fecha); el mensaje listo se rehace a los 2 días.
const CLAVE_SEG_IA = "seg_ia";
async function cacheSegIA(env) { try { return JSON.parse((await kvGet(env, CLAVE_SEG_IA)) || "{}"); } catch { return {}; } }
const firmaSeg = (s) => `${s.cot_ts}:${s.ult_ts}`;
const vigente = (c, s, ahora = Date.now()) => !!c && c.f === firmaSeg(s) && ahora - (c.ts || 0) < (c.seguir === false ? 3 : 2) * 86400e3;
// Lista sin IA nueva (usa lo que la IA ya revisó): para contar, el reporte y el agente
export async function seguimientos(env) {
  const [l, cache] = await Promise.all([candidatosSeguimiento(env), cacheSegIA(env)]);
  return l.filter((s) => !(vigente(cache[s.conv], s) && cache[s.conv].seguir === false)).map((s) => conDetalle(s, cache[s.conv]));
}
function conDetalle(s, c) {
  const ok = vigente(c, s);
  return { ...s, producto: (ok && c.producto) || s.producto, cantidad: (ok && c.cantidad) || "", total: (ok && c.total) || "", borrador: (ok && c.mensaje) || "", revisado: !!ok };
}
// Una línea corta y útil: a quién, qué le cotizamos (cantidad y monto), cuándo y qué contestó
export function lineaSeguimiento(s) {
  const que = [s.cantidad, s.producto].filter(Boolean).join(" ") || "lo que pidió";
  const nom = /\p{L}/u.test(String(s.nombre || "")) ? String(s.nombre).trim() : "Sin nombre";
  const verbo = { precio: ["le pasamos precio de", "se lo pasamos"], info: ["le pasamos info de", "se la pasamos"], archivo: ["le mandamos precios/fotos de", "se lo mandamos"] }[s.tipo] || ["le cotizamos", "cotizado"];
  return `${nom} (+${s.conv}): ${verbo[0]} ${que}${s.total ? " · " + s.total : ""} · ${verbo[1]} hace ${s.dias_cot} d → ${s.reaccion}${s.toque > 1 ? ` (ya le escribimos ${s.toque - 1} ${s.toque === 2 ? "vez" : "veces"})` : ""}`;
}
// Revisa con IA los que faltan hoy y devuelve los que de verdad hay que seguir (con producto, cantidad, monto y mensaje)
// tope: cuántos revisa la IA en esta llamada (el resto lo va revisando el cron de a poco durante el día)
export async function revisarSeguimientos(env, iaJSON, { limite = 10, tope = SEG.revisarPorLlamada } = {}) {
  const lista = await candidatosSeguimiento(env), cache = await cacheSegIA(env), ahora = Date.now();
  const faltan = lista.filter((s) => !vigente(cache[s.conv], s, ahora)).slice(0, tope);
  if (faltan.length && iaJSON) {
    for (let i = 0; i < faltan.length; i += SEG.porLlamada) {
      const tanda = faltan.slice(i, i + SEG.porLlamada);
      const charlas = await Promise.all(tanda.map((s) => env.DB.prepare("SELECT yo, texto, ts FROM w_msg WHERE conv=? AND COALESCE(texto,'')<>'' ORDER BY ts DESC LIMIT 16").bind(s.conv).all().then((r) => (r.results || []).reverse()).catch(() => [])));
      const r = await iaJSON(env, `Atendés el WhatsApp de "Te Importamos" (importaciones por encargo de China a Argentina, para revendedores y negocios). A estos clientes les mandamos una cotización, precios, un catálogo o información (tiempos, envío, cómo trabajamos) y dejaron de contestar, o solo dijeron "gracias", "lo veo", "después te digo". Ahora es ${fechaHora(Date.now())} (hora Argentina).
Para cada uno decidí si HOY hay que escribirle y, si sí, escribí el mensaje para que el dueño lo revise y lo mande él.
"seguir": false si en la charla se ve que NO hace falta: ya compró o pagó, dijo que no o que lo deja, pidió que le escribamos en una fecha que todavía no llegó, quedó en escribirnos él en un plazo que todavía no pasó, el tema ya se resolvió, lo que le mandamos no era comercial (solo un saludo, una pregunta nuestra sin precio ni info, el seguimiento de un envío de una compra ya hecha), le debemos algo nosotros (le dijimos que le pasábamos la cotización o un dato y no se lo pasamos), ya tiene un pedido en curso con nosotros (está esperando que llegue), le dijimos que eso no lo traemos o no lo conseguimos, o no es un cliente (proveedor, conocido, socio). Ante la duda con un cliente al que le pasamos precio o info y no contestó, true.
"producto", "cantidad" y "total": lo que le COTIZAMOS o le pasamos según la charla (ej. "zapatillas Vans", "20 pares", "USD 640 total" o "USD 32 c/u"). Si no se ve, "".
Reglas del mensaje:
- Rioplatense, con voseo, cercano y corto (2 a 4 líneas), sin emojis, como lo escribiría una persona por WhatsApp. Sin "seguimiento", sin "estimado", sin "le escribo para".
- Nombrá el producto que pidió y terminá con UNA pregunta concreta y fácil de contestar.
- Según los días desde la cotización: 1-2 días → preguntá si le quedó alguna duda o si quiere ajustar cantidad; 3-6 días → sumá valor con algo real de la charla (tiempos, cómo es el proceso, que nos encargamos de todo, la ganancia si revende) y proponé el siguiente paso; 7 días o más → mensaje de cierre amable ("¿lo dejamos para más adelante o lo seguimos viendo?"), que suele reactivar.
- Si ya le escribimos antes sin respuesta, no repitas lo mismo: traé algo nuevo.
- Si en la charla dijo una objeción (caro, mínimo, plazo, desconfianza), respondela sin bajar el precio.
- Nunca inventes precios, stock, descuentos ni fechas que no estén en la charla.
CLIENTES:
${tanda.map((s, j) => `#${j + 1} ${s.nombre || "sin nombre"} · producto: ${s.producto || "?"} · le mandamos ${{ precio: "precio", info: "info", archivo: "un archivo (precios o fotos)" }[s.tipo] || "una cotización"} hace ${s.dias_cot} días · ${s.reaccion} · toque ${s.toque}${s.presup_usd ? " · aprox USD " + s.presup_usd : ""}${s.cot_dato ? " · cotización: " + String(s.cot_dato).replace(/\s+/g, " ").slice(0, 160) : ""}
${charlas[j].map((m) => (m.yo ? "Nosotros: " : "Cliente: ") + String(m.texto).replace(/\s+/g, " ").slice(0, 300)).join("\n") || "(sin mensajes guardados)"}`).join("\n\n")}
Respondé SOLO JSON: {"mensajes":[{"n":1,"seguir":true,"motivo":"si seguir es false, por qué en pocas palabras","producto":"","cantidad":"","total":"","mensaje":"..."}]}`).catch(() => null);
      // Los que la IA no devolvió quedan revisados igual (siguen en la lista, sin mensaje): no se re-preguntan en cada carga
      if (Array.isArray(r?.mensajes)) for (const s of tanda) cache[s.conv] = { f: firmaSeg(s), ts: ahora, seguir: true, motivo: "", producto: "", cantidad: "", total: "", mensaje: "" };
      for (const x of Array.isArray(r?.mensajes) ? r.mensajes : []) {
        const s = tanda[(parseInt(x?.n) || 0) - 1]; if (!s) continue;
        cache[s.conv] = { f: firmaSeg(s), ts: ahora, seguir: x.seguir !== false, motivo: String(x.motivo || "").slice(0, 120), producto: String(x.producto || "").slice(0, 60), cantidad: String(x.cantidad || "").slice(0, 40), total: String(x.total || "").slice(0, 50), mensaje: String(x.mensaje || "").trim().slice(0, 700) };
      }
    }
    const vivos = new Set(lista.map((s) => s.conv));
    for (const c of Object.keys(cache)) if (!vivos.has(c)) delete cache[c];      // solo se guarda lo que sigue en la lista
    await env.DB.prepare("DELETE FROM kv WHERE k LIKE 'seg_ia:%'").run().catch(() => {});
    await kvPut(env, CLAVE_SEG_IA, JSON.stringify(cache));
  }
  const ok = lista.filter((s) => !(vigente(cache[s.conv], s, ahora) && cache[s.conv].seguir === false)).map((s) => conDetalle(s, cache[s.conv]));
  return limite ? ok.slice(0, limite) : ok;
}

// Chats, cotizados y ventas por perfil, de dónde vienen y por qué se pierden
export async function metricasPerfil(env, desde) {
  const all = async (sql, ...b) => (await env.DB.prepare(sql).bind(...b).all()).results || [];
  const base = "FROM w_conv c WHERE (COALESCE(c.ult_ts,0)>=? OR EXISTS (SELECT 1 FROM w_hito h WHERE h.conv=c.conv AND h.tipo='cotizacion' AND h.ts>=?)) AND c.grupo=0 AND COALESCE(c.prov,0)=0 AND COALESCE(c.etapa,'')<>'no_cliente'";
  const [perfiles, origen, motivos] = await Promise.all([
    all(`SELECT COALESCE(c.perfil,'sin') perfil, COUNT(*) chats,
      SUM(CASE WHEN EXISTS (SELECT 1 FROM w_hito h WHERE h.conv=c.conv AND h.tipo='cotizacion' AND h.ts>=?) THEN 1 ELSE 0 END) cotizados,
      SUM(CASE WHEN EXISTS (SELECT 1 FROM w_hito h WHERE h.conv=c.conv AND h.tipo='venta' AND h.ts>=? AND COALESCE(h.oculto,0)=0) THEN 1 ELSE 0 END) ventas,
      SUM(COALESCE(c.presup_usd,0)) usd ${base} GROUP BY 1`, desde, desde, desde),
    all(`SELECT c.origen, COALESCE(c.perfil,'sin') perfil, COUNT(*) n ${base} AND c.origen IS NOT NULL GROUP BY 1, 2`, desde),
    all(`SELECT c.motivo, COUNT(*) n ${base} AND c.motivo IS NOT NULL GROUP BY 1`, desde),
  ]);
  return { perfiles, origen, motivos };
}

// Objetivos activos con su avance (los mide el código, no la IA)
export async function avanceObjetivos(env) {
  const objs = (await env.DB.prepare("SELECT * FROM ag_obj WHERE activo=1 ORDER BY id").all()).results || [];
  if (!objs.length) return [];
  const ahora = Date.now(), hoy = inicioDiaAR(), dur = { dia: 1, semana: 7, mes: 30 }, cache = {};
  for (const o of objs) {
    const per = dur[o.periodo] ? o.periodo : "semana";
    const desde = per === "dia" ? hoy : inicioDiaAR(o.ts), fin = desde + dur[per] * 86400e3, hasta = Math.min(ahora, fin);
    const k = desde + ":" + hasta;
    if (!cache[k]) {
      const m = await metricas(env, desde, hasta);
      const ab = await env.DB.prepare("SELECT COUNT(*) n FROM w_conv WHERE primer_ts>=? AND primer_ts<? AND grupo=0 AND perfil IN ('A','B') AND COALESCE(nuevo_ok,1)=1").bind(desde, hasta).first();
      cache[k] = { chats_nuevos: m.nuevos, chats_ab: ab?.n || 0, cotizaciones: m.cotizaciones, chats_cotizados: m.chatsCotizados, ventas: m.ventas };
    }
    const restan = Math.ceil((fin - ahora) / 86400e3);
    o.periodo = per; o.actual = cache[k][o.metrica] ?? 0; o.pct = o.meta ? Math.round((o.actual * 100) / o.meta) : 0;
    o.estado = per === "dia" ? "hoy" : ahora >= fin ? "terminado" : restan <= 1 ? "termina hoy" : "quedan " + restan + " días";
  }
  return objs;
}

// Los seguimientos del día los manda el asistente de Telegram a las 10, con el mensaje listo (asistente.js)

// El agente: asistente de WhatsApp + jefe de ventas, con memoria liviana en D1
// opts.redes / opts.manualRedes: con eso es el agente único (ventas + contenido); lo arma agente.js
export async function preguntarVendedor(env, iaJSON, pregunta, opts = {}) {
  await prepararLector(env);
  const q = String(pregunta || "").slice(0, 1000);
  const ahora = Date.now(), hoy = inicioDiaAR(ahora);
  const all = async (sql, ...b) => (await env.DB.prepare(sql).bind(...b).all()).results || [];
  if (/^(borr|olvid)[aá]\s+(toda\s+)?la\s+memoria/i.test(q.trim())) {
    await env.DB.batch([env.DB.prepare("DELETE FROM ag_mem"), env.DB.prepare("DELETE FROM ag_chat")]);
    return { respuesta: "Listo, borré la memoria y la charla. Arrancamos de cero." };
  }
  // "¿A quién le hago seguimiento?" se contesta con la lista verificada por código (nada de nombres inventados)
  if (RE_PREG_SEG.test(normalQ(q)) && !/\b(por que|porque|analiz|estrategia|opin)/.test(normalQ(q))) {
    const l = await revisarSeguimientos(env, iaJSON, { limite: 0 });
    const pideMsj = /mensaj|texto|que (le )?(escrib|mand|dig)/.test(normalQ(q));
    const respuesta = l.length
      ? `Seguimientos de hoy: ${l.length} (la lista completa, primero los que más valen):\n` + l.map((x, i) => `${i + 1}. ${lineaSeguimiento(x)}${pideMsj && x.borrador ? "\n   Mensaje: " + x.borrador : ""}`).join("\n") + `\n\nEntran todos a los que les mandamos cotización, precio o info y no avanzaron (no contestaron, o dijeron \"gracias\" / \"después te digo\"), sin repetidos. No entran los que esperan respuesta nuestra (Responder ya o Pendientes), los que compraron ni los que dijeron que no.${pideMsj ? "" : " Los mensajes listos para mandar están en Hoy › Seguimientos o escribiendo \"seguimientos\" en Telegram."}`
      : "Hoy no hay cotizados para seguir: los que cotizamos ya contestaron, compraron, les escribimos hace poco o todavía no les toca.";
    await env.DB.batch([env.DB.prepare("INSERT INTO ag_chat (ts, rol, texto) VALUES (?,?,?)").bind(ahora, "u", q), env.DB.prepare("INSERT INTO ag_chat (ts, rol, texto) VALUES (?,?,?)").bind(ahora + 1, "a", respuesta)]);
    return { respuesta, fuentes: { seguimientos: l.length } };
  }
  const [mHoy, m7, m30, p7, p30, segs, objs, mem, charla, m7ant] = await Promise.all([
    metricas(env, hoy), metricas(env, hoy - 6 * 86400e3), metricas(env, hoy - 29 * 86400e3),
    metricasPerfil(env, hoy - 6 * 86400e3), metricasPerfil(env, hoy - 29 * 86400e3),
    seguimientos(env), avanceObjetivos(env),
    all("SELECT tipo, texto, ts FROM ag_mem ORDER BY ts DESC LIMIT 60"),
    all("SELECT rol, texto FROM ag_chat ORDER BY id DESC LIMIT 12"),
    metricas(env, hoy - 13 * 86400e3, hoy - 6 * 86400e3),
  ]);
  const chats = await all("SELECT conv, nombre, perfil, presup_usd, origen, motivo, puntaje, producto, etapa, accion, resumen, ult_yo, ult_ts, cot_pend FROM w_conv WHERE grupo=0 AND archivado=0 AND COALESCE(prov,0)=0 AND COALESCE(etapa,'')<>'no_cliente' AND ult_ts>=? ORDER BY CASE WHEN perfil IN ('A','B') THEN 0 ELSE 1 END, COALESCE(presup_usd,0) DESC, COALESCE(puntaje,0) DESC LIMIT 120", hoy - 13 * 86400e3);
  const palabras = [...new Set(normalQ(q).split(/[^a-z0-9ñ]+/).filter((w) => w.length > 3 && !VACIAS_Q.has(w)))].slice(0, 3);
  let hallados = [];
  for (const w of palabras) {
    const raiz = w.replace(/(es|s)$/, "");
    hallados.push(...(await all("SELECT m.conv, c.nombre, m.yo, m.texto, m.ts FROM w_msg m LEFT JOIN w_conv c ON c.conv=m.conv WHERE m.ts>=? AND m.grupo=0 AND lower(m.texto) LIKE ? ORDER BY m.ts DESC LIMIT 30", ahora - 14 * 86400e3, `%${raiz}%`)));
  }
  const vistos = new Set(); hallados = hallados.filter((h) => { const k = h.conv + h.ts; if (vistos.has(k)) return false; vistos.add(k); return true; }).slice(0, 60);
  const fChat = (c) => `- ${c.nombre || "sin nombre"} (+${c.conv}) · perfil ${c.perfil || "?"}${c.presup_usd ? " · aprox USD " + c.presup_usd : ""} · ${c.puntaje ?? "?"}/10 · ${c.producto || "-"} · ${c.etapa || "-"}${c.cot_pend ? " · ESPERA COTIZACION" : ""}${!c.ult_yo ? " · SIN RESPONDER" : ""}${c.origen ? " · vino de " + c.origen : ""}${c.motivo ? " · se perdió por " + c.motivo : ""} · último ${fechaHora(c.ult_ts)}${c.resumen ? " · " + c.resumen : ""}${c.accion ? " · pendiente: " + String(c.accion).replace(/\|p\d$/, "") : ""}`;
  const eq = await metricasEquipo(env, hoy - 6 * 86400e3).catch(() => []);
  const contexto = `EQUIPO ÚLTIMOS 7 DÍAS (quién atiende cada chat, por dispositivo vinculado; se mide desde el 14/10, las horas son aproximadas): ${JSON.stringify(eq)}
MEMORIA (notas guardadas de charlas anteriores, la más nueva primero):
${mem.map((n) => `- [${fechaHora(n.ts)}] (${n.tipo}) ${n.texto}`).join("\n") || "vacía"}
OBJETIVOS ACTIVOS Y AVANCE (medidos por el código): ${JSON.stringify(objs.map((o) => ({ metrica: o.metrica, periodo: o.periodo, meta: o.meta, actual: o.actual, pct: o.pct })))}
METRICAS EXACTAS · hoy: ${JSON.stringify(mHoy)} · 7 dias: ${JSON.stringify(m7)} · los 7 dias anteriores (para comparar): ${JSON.stringify(m7ant)} · 30 dias: ${JSON.stringify(m30)}
POR PERFIL (A Mercado Libre/con presupuesto, B negocio, C revendedor chico, D consumidor final, E curioso) · 7 dias: ${JSON.stringify(p7)} · 30 dias: ${JSON.stringify(p30)}
SEGUIMIENTOS PENDIENTES HOY (verificados por código: clientes a los que les mandamos cotización, precio o info y no avanzaron; es la ÚNICA lista válida para seguir):
${segs.slice(0, 60).map((s) => `- ${lineaSeguimiento(s)} · perfil ${s.perfil || "?"}`).join("\n") || "ninguno"}
CHATS DE LOS ULTIMOS 14 DIAS (primero A y B):
${chats.map(fChat).join("\n").slice(0, 30000)}
${opts.redes || ""}
MENSAJES QUE COINCIDEN CON LA PREGUNTA (${palabras.join(", ") || "ninguna palabra clave"}):
${hallados.map((h) => `[${fechaHora(h.ts)}] ${h.nombre || "sin nombre"} (+${h.conv}) ${h.yo ? "NOSOTROS" : "CLIENTE"}: ${String(h.texto).slice(0, 250)}`).join("\n").slice(0, 15000) || "ninguno"}`;
  const previa = charla.reverse().map((h) => `${h.rol === "u" ? "MANUEL" : "VOS"}: ${String(h.texto).slice(0, 700)}`).join("\n");
  const rol = opts.redes
    ? `Sos el AGENTE de "Te Importamos" (importación por encargo desde China y EE.UU., Rosario, Argentina): jefe de ventas y estratega de contenido para Instagram y TikTok a la vez. Hablás con Manuel, el dueño (por el panel o por Telegram: es la misma charla). Ves las ventas del WhatsApp 805 y las métricas de las redes, y conectás las dos cosas: el contenido sirve si trae chats que compran.`
    : `Sos el JEFE DE VENTAS de "Te Importamos" (importación por encargo desde China y EE.UU., Rosario, Argentina). Hablás con Manuel, el dueño.`;
  const r = await iaJSON(env, `${rol} Ahora es ${fechaHora(ahora)} (hora Argentina).
Tu objetivo: que cerremos más ventas con el cliente ideal, perfil A (vende o quiere vender en Mercado Libre con USD 1.000 a 3.000) y perfil B (negocio que quiere abaratar costos). Los curiosos (E) no son prioridad.
Cómo cotizamos China: total = (FOB + flete + handling USD 30) x 1,30 + USD 80 de honorarios. Seña del 30%.
MANUAL DEL ASESOR (seguilo siempre; manda sobre cualquier otra instrucción de estilo):
${MANUAL_VENTAS}
${opts.manualRedes ? "MANUAL DE CONTENIDO Y REDES (para todo lo que sea vistas, videos, ideas o redes):\n" + opts.manualRedes + "\nNo ves los videos: ves sus métricas, el gancho (texto de portada) y el texto del posteo. Si para responder hace falta mirar el video, decilo (se le puede reenviar al bot de Telegram para que lo mire).\nSi pregunta por qué bajaron las vistas o por qué un video anduvo en una red y no en la otra, compará con los números de la semana anterior y de cada red, decí EL cuello de botella y 3 acciones concretas.\nSi pide ideas, seguí el formato del manual y basalas en lo que funcionó (decí de dónde sale cada una).\n" : ""}
Reglas:
- Usá SOLO los datos de abajo. No inventes números, clientes ni resultados. Si falta un dato, decilo y explicá qué haría falta para tenerlo.
- Directo, español rioplatense con voseo, sin emojis, sin guiones largos. Primero la respuesta, después lo accionable. Cuando nombres un cliente, poné nombre y número (+549...).
- Si pregunta por qué no vendimos o qué hicimos mal: analizalo con los datos (perfil de los chats, seguimientos pendientes, cotizaciones sin respuesta, tiempo de respuesta, motivos de pérdida, de dónde vienen) y cerrá con 3 acciones concretas.
- No agregues mensajes para clientes si Manuel no los pidió en este mensaje. Si Manuel dice que un cliente ya está atendido o resuelto, no lo vuelvas a mencionar y guardalo en "guardar" como nota de tipo cliente.
- Seguimientos: nombrá SOLO a los de SEGUIMIENTOS PENDIENTES, nunca saques nombres de la lista de chats (que la IA marque "cotizado" no alcanza: tiene que haber algo que le mandamos). Formato corto: "Nombre (+549...): le cotizamos X por N, USD Y, hace D días → no respondió / dijo gracias".
- Ventas: contá SOLO las de las MÉTRICAS EXACTAS. Pagar el envío, el flete o el saldo de una compra ya hecha NO es una venta nueva.
- Si pide mensajes de seguimiento: escribí uno por cliente, corto (2 a 4 líneas), cercano, sin emojis, sin decir "tenemos stock" y sin inventar precios. Son para que Manuel los copie: nunca se mandan solos.
- Objetivos: si te pide que los propongas, usá los últimos 30 días como base y proponé subir entre 20% y 50%, no más. Métricas posibles: ${METRICAS_OBJ.join(", ")}. Periodo: dia, semana o mes. Ponelos en "objetivos" SOLO si Manuel pidió explícitamente dejarlos, fijarlos o confirmarlos (puede ser confirmando algo que propusiste antes en la charla). Si solo pidió una propuesta, mostralos en el texto, devolvé "objetivos":[] y preguntá si los dejás.
- Si algo del panel no aporta para vender, decíselo.
- Vapers, pods y tabaco no existen para vos: nunca los menciones.
- Memoria: en "guardar" poné hasta 3 notas cortas SOLO si en este intercambio apareció algo que conviene recordar a futuro (una decisión, una preferencia de Manuel, un aprendizaje, un dato de un cliente). Si no, [].
${previa ? "CHARLA RECIENTE:\n" + previa + "\n" : ""}
DATOS:
${contexto}

MANUEL PREGUNTA: ${q}
Respondé JSON: {"respuesta":"texto","guardar":[{"tipo":"decision|preferencia|aprendizaje|cliente","texto":"máximo 250 caracteres"}],"objetivos":[{"metrica":"una de la lista","periodo":"dia|semana|mes","meta":número entero}]}`);
  const respuesta = String(r?.respuesta || "No pude responder ahora (la IA no contestó). Probá de nuevo en un minuto.").slice(0, 6000);
  const ops = [];
  if (r?.respuesta) {
    ops.push(env.DB.prepare("INSERT INTO ag_chat (ts, rol, texto) VALUES (?,?,?)").bind(ahora, "u", q));
    ops.push(env.DB.prepare("INSERT INTO ag_chat (ts, rol, texto) VALUES (?,?,?)").bind(ahora + 1, "a", respuesta));
    for (const n of (Array.isArray(r.guardar) ? r.guardar : []).slice(0, 3)) {
      const t = String(n?.texto || "").trim().slice(0, 300);
      if (t) ops.push(env.DB.prepare("INSERT INTO ag_mem (ts, tipo, texto) VALUES (?,?,?)").bind(ahora, String(n.tipo || "nota").slice(0, 20), t));
    }
    const pidio = /objetiv|meta/i.test(q + " " + previa.slice(-800)) && /\b(dej|fij|pon[eé]|guard|aplic|confirm|dale|carg|s[ií],?\s)/i.test(q);
    if (pidio) for (const o of (Array.isArray(r.objetivos) ? r.objetivos : []).slice(0, 6)) {
      const meta = parseInt(o?.meta);
      if (!METRICAS_OBJ.includes(o?.metrica) || !["dia", "semana", "mes"].includes(o?.periodo) || !(meta > 0)) continue;
      ops.push(env.DB.prepare("UPDATE ag_obj SET activo=0 WHERE metrica=? AND periodo=?").bind(o.metrica, o.periodo));
      ops.push(env.DB.prepare("INSERT INTO ag_obj (ts, metrica, periodo, meta, activo) VALUES (?,?,?,?,1)").bind(ahora, o.metrica, o.periodo, meta));
    }
    ops.push(env.DB.prepare("DELETE FROM ag_chat WHERE id NOT IN (SELECT id FROM ag_chat ORDER BY id DESC LIMIT 40)"));
    ops.push(env.DB.prepare("DELETE FROM ag_mem WHERE id NOT IN (SELECT id FROM ag_mem ORDER BY id DESC LIMIT 80)"));
    await env.DB.batch(ops);
  }
  return { respuesta, fuentes: { chats: chats.length, mensajes: hallados.length, seguimientos: segs.length } };
}

// ---------------------------------------------------------------------------
// 11) Equipo: quién atiende, por dispositivo vinculado del 805 (desde el 14/10/2026)
// Completá los números cuando sepas de quién es cada dispositivo
// ---------------------------------------------------------------------------
const EQUIPO_DISP = { "0":"Manuel","29":"Manuel","31":"Manuel","6":"Matías","20":"Matías","30":"Matías","42":"Manuel","36":"Manuel","43":"Manuel", "44":"Manuel", 37:"Manuel", 39:"Manuel", 45:"Manuel", "99":null }
const nombreDisp = (autor) => { const d = (String(autor || "").match(/:(\d+)/) || [])[1]; if (d === undefined) return null; if (d in EQUIPO_DISP && !EQUIPO_DISP[d]) return ""; return EQUIPO_DISP[d] || (d === "0" ? "Celular del 805" : "Sin identificar (dispositivo " + d + ")"); };
export async function metricasEquipo(env, desde) {
  const k = "equipo_cache:" + desde, c = JSON.parse((await kvGet(env, k)) || "null");
  if (c && Date.now() - c.ts < 10 * 60e3) return c.d;
  const ms = (await env.DB.prepare("SELECT conv, yo, autor, texto, ts FROM w_msg WHERE ts>=? AND grupo=0 AND hist=0 ORDER BY conv, ts LIMIT 40000").bind(desde).all()).results || [];
  const hitos = (await env.DB.prepare("SELECT conv, tipo, ts FROM w_hito WHERE ts>=? AND tipo IN ('cotizacion','venta') AND COALESCE(oculto,0)=0").bind(desde).all()).results || [];
  const P = {}, get = (n) => P[n] || (P[n] = { nombre: n, mensajes: 0, chats: new Set(), esperas: [], cot: 0, ven: 0, ts: [], det: {}, dias: {} });
  const porConv = {};
  let conv = null, espera = null;
  for (const m of ms) {
    if (m.conv !== conv) { conv = m.conv; espera = null; }
    if (!m.yo) { if (espera === null) espera = m.ts; continue; }
    if (esBot(m.texto)) continue;
    const n = nombreDisp(m.autor); if (n === "") continue;
    if (!n) { espera = null; continue; }
    const p = get(n); p.mensajes++; p.chats.add(m.conv); p.ts.push(m.ts); (p.dias[diaAR(m.ts)] || (p.dias[diaAR(m.ts)] = new Set())).add(m.conv);
    { const dd = p.det[m.conv] || (p.det[m.conv] = { conv: m.conv, msgs: 0, primero: m.ts }); dd.msgs++; dd.ultimo = m.ts; dd.texto = String(m.texto || "").slice(0, 120); }
    if (espera !== null) { p.esperas.push((m.ts - espera) / 60000); espera = null; }
    (porConv[m.conv] || (porConv[m.conv] = [])).push({ ts: m.ts, n });
  }
  for (const h of hitos) {
    const l = (porConv[h.conv] || []).filter((x) => x.ts <= h.ts + 60e3).pop();
    if (l) get(l.n)[h.tipo === "venta" ? "ven" : "cot"]++;
  }
  const nombres = Object.fromEntries(((await env.DB.prepare("SELECT conv, nombre FROM w_conv WHERE ult_ts>=? AND grupo=0").bind(desde).all()).results || []).map((x) => [x.conv, x.nombre]));
  const d = Object.values(P).map((p) => {
    p.esperas.sort((a, b) => a - b); p.ts.sort((a, b) => a - b);
    let activo = p.ts.length ? 2 * 60e3 : 0;
    for (let i = 1; i < p.ts.length; i++) { const g = p.ts[i] - p.ts[i - 1]; activo += g < 15 * 60e3 ? g : 2 * 60e3; }
    return { nombre: p.nombre, dias: Object.fromEntries(Object.entries(p.dias).map(([k, v]) => [k, v.size])), mensajes: p.mensajes, chats: p.chats.size, respuestaMin: p.esperas.length ? Math.round(p.esperas[Math.floor(p.esperas.length / 2)]) : null, cotizaciones: p.cot, ventas: p.ven, horas: Math.round(activo / 360e3) / 10, detalle: Object.values(p.det).sort((a, b) => b.ultimo - a.ultimo).slice(0, 60).map((x) => ({ ...x, nombre: nombres[x.conv] || "" })) };
  }).sort((a, b) => b.mensajes - a.mensajes);
  await kvPut(env, k, JSON.stringify({ ts: Date.now(), d }));
  return d;
}


// Números que NUNCA son clientes: forwarders, despachantes, proveedores y números del equipo.
// Lo que está acá no cuenta como venta, cliente ni pendiente. Agregá los que hagan falta.
const NO_CLIENTES = new Set([
  "5491152577925",   // Pedro Aguirre, forwarder de China
  "5493413084113",   // Manuel personal
]);
