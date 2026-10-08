import { rutaLector, apiLector, cronLector, paginaReporte } from "./lector.js";
import { PANEL_805 } from "./lector-panel.js";
import { apiBusquedas, PANEL_BUSQUEDAS, rutaInformes } from "./busquedas.js";
/**
 * Agente de WhatsApp · Te Importamos (v15.0: + pestaña Búsquedas de proveedores)
 * Cloudflare Workers + Gemini (gratis) con respaldo de Cloudflare AI.
 *
 * Variables: WA_TOKEN, WA_PHONE_ID, VERIFY_TOKEN, GEMINI_KEY, ADMIN_PHONE (varios separados por coma)
 * Opcionales: NUMERO_AGENTE (número donde atiende el agente, ej. 5493412595936), NUMERO_EQUIPO, APP_SECRET (verifica que los mensajes vengan de Meta), SHEETS_URL (leads a Google Sheets)
 * Bindings:  ESTADO (KV), AI (Workers AI), DB (D1, recomendado: memoria consistente)
 * Trigger:   Cron cada 1 minuto (red de seguridad de respuestas, seguimientos cada 5 min y resumen a la hora en punto)
 * Respuesta: el agente espera ESPERA.segundos desde el ÚLTIMO mensaje del cliente y contesta todo junto (sin depender del cron)
 */

// =====================================================================
//  ✏️ ZONA EDITABLE
// =====================================================================
const NEGOCIO = {
  catalogo: "https://www.teimportamosarg.com/catalogo",
  grupoMayorista: "https://chat.whatsapp.com/EXZ9zby2LEJDeaoyAiRE4t",
  menu: (n) =>
    `buenas${n ? " " + n : ""}! gracias por escribir\nque estas buscando?\n\n` +
    `1. importar un producto\n2. armar combo para revender\n3. ver catalogo completo\n4. link al grupo mayorista\n\nmandame el numero y te paso todo`,
  opcion1: () => `${ok()}||que producto queres traer? mandame una foto o un link||y decime cuantas unidades necesitas`,
  opcion2: () => `${ok()}||contame, con que presupuesto contas mas o menos?`,
  opcion3: (u) => `te paso el catalogo completo||${u}||si algo te interesa mandame el nombre y lo vemos`,
  opcion4: (u) => `sumate al grupo mayorista||${u}||ahi pasamos ofertas, cupos de importacion y productos nuevos`,

  // Instructivo para encontrar los datos en Alibaba
  guiaAlibaba: (prod) =>
    `${prod ? `vi que es ${prod}||` : ""}no me deja abrir la pagina desde aca, te explico donde estan los datos||` +
    `1. Abri el link en la app o la web de Alibaba\n` +
    `2. Al lado de la foto estan los precios por cantidad (ej: "US$ 2,28 100-999 unidades"), sacale captura\n` +
    `3. Mas abajo, en "Empaque y entrega", figura el peso bruto (ej: 0,61 kg), sacale captura\n` +
    `4. Mandame las 2 capturas y cuantas unidades queres` +
    `||si te resulta mas facil escribime los numeros: precio por unidad segun cantidad y peso bruto`,

  // Datos para cobrar por transferencia
  cobro: { alias: "guinjo.quinal.lemon", banco: "Lemon", titular: "Matias" },

  // Lista mayorista de zapatillas: se manda TAL CUAL (con emojis) cuando preguntan por zapatillas.
  // Para actualizarla, reemplazá el texto entre las comillas invertidas.
  listaZapatillas: `✅ LISTA DE PRECIOS MAYORISTA ACTUALIZADA
📅 Fecha: 28/4

👟 A partir de 3 unidades ya accedés al precio mayorista.
Podés combinar talles y modelos dentro del mismo pedido.

📦 Mejoramos precios llevando media caja o caja cerrada de un mismo modelo (diferentes numeraciones).

💰 PRECIO BASE: $42.000

📂 Todos los modelos disponibles en el Drive

https://drive.google.com/drive/folders/11h-uInkiHGyOZXxy-TNrbLdK0d7k00ta

💎 MODELOS A $46.000

• Adidas 800
• Adidas Samba XL
• Vans Skate
• Straye
• Adidas forum
• Jordan retro 4

💎 MODELOS A $48.000

• Adidas Forum Verde
• Adidas Forum Abrojo
• Adidas Gazelle
• Adidas SL
• DC Todas Negras
• Nike Nix (deportiva)
• Nike Retro (deportiva)
• New Balance 550
• Puma 180
• Puma Suede XL (colores)
• Vans KNU G5
• Lacoste
• New balance 9060
• Adizero SL (deportivas)
• Jordan Low 1 Botita
• Puma Suede XL
• Nike Calidad luxo
• Adidas osiris
• Adidas ozmillen

💎 Modelos a $50.000
Adidas 2000
Vans hylane
Adidas 2000 DROP

📌 Recordá:
• Venta mínima: 3 pares
• Podés combinar modelos y talles

📲 Pedinos el link`,

  // Así habla el dueño. Pegá acá mensajes reales tuyos para que el agente copie el estilo.
  estilo: `
- "buenisimo dale" / "contame, con que presupuesto contas mas o menos?"
- "buenisimo podemos armar algo lindo" / "buscas algun rubro en particular??"
- "dale pasame el link y te armo la cotizacion"
- "si eso lo podemos traer sin problema"
- variá las muletillas: "joya", "genial", "impecable dale", "dale, impecable", "buenisimo dale", "perfecto". No repitas la misma dos veces seguidas.
(sin emojis, todo en minúscula informal, frases cortas, varias preguntas cortas en vez de un mensaje largo)
`,

  conocimiento: `
QUIÉNES SOMOS
- Te Importamos: servicio de importación. Nos encargamos de todo: papeleo, liberación y nacionalización en aduana.
- Traemos de China, Paraguay, Brasil, Estados Unidos y Argentina. Sin stock: todo por encargo, el proveedor envía.
- Diferencial: cercanía y acompañamiento mano a mano; mostramos el proceso y los costos en redes.
- Importamos a través de una empresa importadora registrada con la que trabajamos.

QUÉ TRAEMOS
- Todo tipo de productos: tecnología, bazar, ropa, indumentaria, perfumes, suplementos comunes (creatina, proteína).
- NO trabajamos: fármacos, medicamentos, suplementos raros, drogas ni tabaco. Es lo ÚNICO que rechazás.
- VAPERS / vapes / cigarrillos electrónicos (aunque figuren en la web): respondé EXACTAMENTE "nosotros no nos encargamos de eso, contactate por aca: 341 805-1515" y poné "es_vaper": true. No ofrezcas otra cosa ni sigas la charla sobre eso.
- Todo lo demás SÍ se puede consultar (celulares, iPhone, consolas, motos, cubiertas, repuestos, suelas, artículos musicales, lo que sea; lo de marca original lo traemos de EE. UU.). NUNCA digas "eso no lo traemos" ni inventes motivos de aduana, volumen o proveedores: si es algo raro o grande, juntá datos y derivá con estado "busqueda_proveedor".
- NO hacemos dropshipping (no despachamos ventas de terceros una por una).
- Si el cliente ya tiene su mercadería o su proveedor: SÍ lo hacemos. Nos encargamos de la importación, la nacionalización y todo el papeleo necesario (también podemos buscarle proveedores). Juntá qué es, cantidad, peso y de dónde viene, y derivá con estado "busqueda_proveedor" para que el equipo lo cotice.
- UNA SOLA UNIDAD para uso personal: SÍ se puede, pero el precio no es mayorista (sale más caro por unidad). Explicalo así, nunca digas que no se puede; juntá el producto y derivá con estado "busqueda_proveedor".
- LLAMADAS: si el cliente quiere hablar por teléfono, pasale el número del equipo: 341 805-1515 (decile que llame o escriba ahí) y poné accion "derivar" con estado "consulta".
- NUNCA inventes políticas que no estén en esta información (facturación, garantías, devoluciones, envíos especiales, plazos que no figuran). Si te preguntan algo así, decí que lo confirma el equipo y poné accion "derivar" con estado "consulta".
- Si estás juntando datos para cotizar y el cliente hace una pregunta (mínimo, tamaño, plazo, si se puede menos cantidad), RESPONDÉ primero su pregunta y después pedí lo que falta en el mismo mensaje.
- ZAPATILLAS (de stock o de la lista mayorista): el mínimo SIEMPRE es 3 pares (pueden ser del mismo modelo o combinados). Decilo apenas pregunten por un par.
- GRUPO DE WHATSAPP mayorista: si lo piden, pasá este link directo: https://chat.whatsapp.com/EXZ9zby2LEJDeaoyAiRE4t
- NO PODÉS MANDAR FOTOS. Nunca digas "te paso la foto": pasá el link del producto de la web, que tiene todas las fotos.
- COMBOS: nunca digas que armaste o que "el sistema generó" un combo si no estás listando los productos con cantidades y precios. Si no podés armarlo, preguntá qué productos o rubro concreto quiere.
- Difusores de aromas, humidificadores y vaporizadores de aromaterapia NO son vapers: esos sí se traen.
- Si el cliente ya tiene proveedor o pregunta "cuánto cobran por kilo": el flete aéreo desde China es USD 18 por kg (menos de 50 kg); de 50 a 250 kg, USD 950 fijo; más de 250 kg va en barco (USD 100 fijo). Se suma handling USD 30, impuestos aprox. 30% sobre (mercadería + flete) y honorarios USD 80 por operación. Con el detalle, peso y cantidad le armamos la cotización exacta.
- COSTO DEL SERVICIO (China): honorarios fijos de USD 80 por operación + handling USD 30; el flete y los impuestos (aprox. 30%) se calculan según el producto. Todo va incluido en la cotización "puesto en Argentina".
- Mínimos habituales para precio mayorista: tecnología, bazar y perfumes 5 unidades; ropa 10 unidades (o por docena/curva). Menos que eso también se puede, a precio no mayorista.
- Catálogo online (productos de Paraguay y referencias): desde 5 o 10 unidades, se paga el total.
- Productos populares de China para recomendar: sacapelos para perro, pistola masajeadora, NFC de Google, lentes estilo Meta Ray-Ban réplica.
- Cupos de importación: varios clientes piden el mismo producto en menor cantidad (desde 10 u.) y acceden al precio mayorista.

PAGOS
- Aceptamos todos los medios menos efectivo. Con tarjeta hay un recargo del 7% (transferencia: 7% menos).
- Se cotiza en dólares y se puede pagar en pesos al valor del dólar cripto (USDT en Binance) del día. Si confirma hoy y paga en unos días, se congela el valor de hoy.
- China: seña del 30% para confirmar el pedido (reserva toda la operación). Paraguay/catálogo: se paga el total.
- DATOS PARA TRANSFERIR: alias guinjo.quinal.lemon (cuenta de Lemon a nombre de Matias). Pasalos tal cual cuando el cliente confirma la compra o pregunta cómo pagar.
- Siempre pedir el comprobante de pago. Nosotros verificamos el ingreso y le confirmamos.

ENVÍOS Y TIEMPOS
- Productos de stock local / catálogo: despacho en unos 10 días desde el pago.
- Plazo de China (desde que el proveedor despacha): en avión 10 a 15 días; en barco 40 a 60 días. El tiempo de fabricación/preparación del proveedor se confirma en cada caso.
- Envío a todo el país por correo, lo paga el cliente (domicilio o sucursal).
- Le avisamos al cliente cada etapa: confirmación del proveedor, despacho, código de seguimiento y entrega.

GARANTÍAS Y POSVENTA
- Devoluciones: solo si el proveedor lo acepta, lo gestionamos nosotros.
- Paraguay: garantía del 50% de devolución si la mercadería queda retenida en aduana.
- Muestras: se pueden pedir, pero el cliente paga el envío (a veces no conviene).

COMBOS (preguntar presupuesto y rubro)
- Menos de $100.000: combo surtido del catálogo (tecnología, bazar).
- $150.000 a $250.000: puede incluir perfumes.
- Más de $300.000: perfumes o traer un producto de China.

REGLAS
- NUNCA inventes datos que no estén en este conocimiento (plazos de China, formas de cobro del saldo, costos). Si no lo sabés, decí "eso te lo confirmo enseguida" y derivá con estado "consulta".
- Nunca prometer ganancias ni hablar de "hacerse millonario"; tampoco desalentar. Solo información real.
- Nunca prometer envío gratis ni precios no confirmados.
- Descuentos: no los ofrezcas vos; si ves que con un descuento se cierra, derivá con estado "descuento".
- Variantes importantes: talle, color, modelo, original o réplica, capacidad, voltaje, batería.
`,
};

// Cotización: total = (FOB + flete + handling) x (1 + impuestos) + honorarios  (mismas tarifas que el panel admin)
const T = { fleteKg: 18, handling: 30, honorarios: 80, factor: 1.3, // impuestos 30%
  aereoFijo: 950, aereoDesde: 50, aereoHasta: 250, barcoFijo: 100 };

// Protocolo de derivación (provisional): ante productos sin proveedor o si el agente se traba, deriva y se pausa
const DERIVACION = {
  pausaHoras: 12,                 // cuánto se calla el agente con ese cliente después de derivar
  alCliente: () => `${["dale", "joya", "genial", "perfecto"][Math.floor(Math.random() * 4)]}, eso lo buscamos nosotros con proveedores||dame un rato que lo veo y te escribo con opciones`,
  alClienteGeneral: () => "dame un ratito que lo veo bien y te escribo",
};

// Convivencia con el equipo en el WhatsApp Business (coexistencia)
// Número donde atiende el equipo (WhatsApp Business). El agente deriva con un botón a este número.
const NUMERO_EQUIPO = "5493418051515";

const CONVIVENCIA = {
  pausaSiRespondeHumano: 8,   // horas que se calla el agente cuando ustedes responden desde el celular
  diasChatEnCurso: 7,         // chats importados con actividad en estos días quedan en manos del equipo
};

// Espera antes de responder: junta todos los mensajes del cliente y contesta a todo junto.
// segundos: cuánto espera desde el ÚLTIMO mensaje (si escribe otro, el reloj vuelve a cero).
// Respuesta total = espera + lo que tarda la IA (3 a 7 s) = unos 12 a 15 s.
// maxSeg: tope de seguridad (Cloudflare gratis corta las tareas en segundo plano a los 30 s).
const ESPERA = { segundos: 5, maxSeg: 15, extraSaludo: 8, vistoMin: 5, vistoMax: 8, tope: 16 };   // <-- ACÁ se cambia la espera (en segundos). visto: cuánto tarda en aparecer el "leído" y el "escribiendo..." (al azar entre min y max). tope: máximo total antes de responder (Cloudflare corta a los ~30 s)
const BASE_URL = "https://cotizador.berasateguimanuel07.workers.dev";

// Seguimiento automático (siempre GRATIS: solo dentro de la ventana de 24 h de WhatsApp)
const SEGUIMIENTO_AUTO = { primero: 22.5, ventana: 23.75 };   // un solo seguimiento, con oferta, justo antes de que cierre la ventana gratis de 24 h   // horas desde el último mensaje del cliente
// Anti pérdida de leads
const SALUD = { minutosSinRespuesta: 5, alertaCadaHoras: 2, supervisorCadaHoras: 3 };
const SEGUIMIENTO = {
  cotizacion: { horas: 22, texto: (n) => `hola${n ? " " + n : ""}! pudiste ver la cotizacion?||si te cierra avanzamos con el pedido` },
  catalogo: { horas: 8, texto: (n) => `hola${n ? " " + n : ""}! pudiste ver el catalogo?||queres que traigamos algo en particular?` },
};
// =====================================================================

const usd = (n) => "USD " + n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function num(v) {
  if (typeof v === "number") return isFinite(v) ? v : null;
  let t = String(v ?? "").replace(/[^\d,.]/g, "");
  if (!t) return null;
  if (t.includes(",") && t.includes(".")) t = t.replace(/\./g, "").replace(",", ".");   // 4.783,18
  else if (t.includes(",")) t = t.replace(",", ".");                                      // 0,61
  else if (/^[1-9]\d{0,2}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, "");               // 1.000 (pero 0.494 queda decimal)
  return parseFloat(t) || null;
}
// Peso escrito a mano: "1,5 kg", "800 g", "pesa 0.6"
function pesoEnTexto(t) {
  const m = t.match(/(\d+(?:[.,]\d+)?)\s*(kg|kgs|kilo|kilos|g|gr|grs|gramos)\b/i);
  if (!m) return null;
  const n = parseFloat(m[1].replace(",", "."));
  return /^g|^gr/i.test(m[2]) ? n / 1000 : n;
}
const ultimos10 = (n) => String(n).replace(/\D/g, "").slice(-10);
const esAdmin = (env, n) => (env.ADMIN_PHONE || "").split(",").some((a) => a && ultimos10(a) === ultimos10(n));
const id4 = () => Math.random().toString(36).slice(2, 6);

// ---------------- Cálculo ----------------
const flete = (kg) => (kg > T.aereoHasta ? T.barcoFijo : kg >= T.aereoDesde ? T.aereoFijo : kg * T.fleteKg);
function precioPorCantidad(tramos, cant) {
  const o = [...tramos].sort((a, b) => a.desde - b.desde);
  let p = o[0].precio;
  for (const t of o) if (cant >= t.desde) p = t.precio;
  return p;
}
function cotizarItems(items, honorarios = T.honorarios) {
  const fob = items.reduce((s, i) => s + precioPorCantidad(i.tramos, i.cantidad) * i.cantidad, 0);
  const kg = items.reduce((s, i) => s + i.peso_kg * i.cantidad, 0);
  const fl = flete(kg);
  const base = fob + fl + T.handling;
  const total = base * T.factor + honorarios;
  return { fob, fl, kg, imp: base * (T.factor - 1), total };
}
function textoCotizacion(items, oferta) {
  const hon = oferta?.honorarios50 && oferta.vence > Date.now() ? T.honorarios / 2 : T.honorarios;
  const c = cotizarItems(items, hon);
  const titulo = items.length === 1 ? `*${items[0].nombre || "Producto"}* x${items[0].cantidad}` :
    `*Todo junto:*\n${items.map((i) => `• ${i.nombre} x${i.cantidad}`).join("\n")}`;
  const unit = (items.length === 1 ? `\n*Precio unitario: ${usd(c.total / items[0].cantidad)}*` : "") + (items.some((i) => i.estimado) ? `\n_(peso estimado: el valor final puede variar un poco cuando el proveedor confirme el peso)_` : "");
  return `*Cotización estimada · Te Importamos*\n\n${titulo}\n\nCosto mercadería: ${usd(c.fob)}\n` +
    `Flete: ${usd(c.fl + T.handling)}\nHonorarios: ${usd(hon)}${hon < T.honorarios ? " (50% off)" : ""}\nImpuestos: ${usd(c.imp)}\n\n` +
    `💰 *Total puesto en Argentina: ${usd(c.total)}*${unit}\n\n` +
    `_Valor estimativo en dólares (se puede pagar en pesos al dólar cripto del día). Si te sirve, avanzamos con el pedido._`;
}

// Dólar cripto: precio USDT/ARS de Binance en el momento (respaldo: dolarapi y valor manual)
// Tipo de cambio de otras monedas contra el dólar (CNY, BRL), con resguardo fijo
async function tasaUSD(env, moneda) {
  const k = `tasa:${moneda}`, g = await env.ESTADO.get(k);
  if (g) return +g;
  try {
    const j = await (await fetch("https://open.er-api.com/v6/latest/USD")).json();
    const v = +j?.rates?.[moneda];
    if (v > 0) { await env.ESTADO.put(k, String(v), { expirationTtl: 12 * 3600 }); return v; }
  } catch {}
  return { CNY: 7.15, BRL: 5.5 }[moneda] || 1;
}
async function aDolares(env, precio, moneda) {
  const m = String(moneda || "USD").toUpperCase();
  if (/ARS/.test(m)) { const d = await dolarCripto(env); return { usd: precio / d, nota: `$${precio} ARS → USD al ${Math.round(d)}` }; }
  if (/CNY|RMB|YUAN|¥/.test(m)) { const t = await tasaUSD(env, "CNY"); return { usd: precio / t, nota: `¥${precio} → USD (1 USD = ${t.toFixed(2)} CNY)` }; }
  if (/BRL/.test(m)) { const t = await tasaUSD(env, "BRL"); return { usd: precio / t, nota: `R$${precio} → USD (1 USD = ${t.toFixed(2)} BRL)` }; }
  return { usd: precio, nota: "" };
}
async function dolarCripto(env) {
  const g = await env.ESTADO.get("dolar");
  if (g) return +g;
  const fuentes = [
    async () => +(await (await fetch("https://data-api.binance.vision/api/v3/ticker/price?symbol=USDTARS")).json()).price,
    async () => +(await (await fetch("https://api.binance.com/api/v3/ticker/price?symbol=USDTARS")).json()).price,
    async () => +(await (await fetch("https://dolarapi.com/v1/dolares/cripto")).json()).venta,
  ];
  for (const f of fuentes) {
    try {
      const v = await f();
      if (v > 100) { console.log("Dólar cripto:", v); await env.ESTADO.put("dolar", String(v), { expirationTtl: 1800 }); return v; }
    } catch {}
  }
  return 1586; // resguardo manual del panel
}


// =====================================================================
//  CATÁLOGO (lee los productos de teimportamosarg.com)
// =====================================================================
const WEB = "https://www.teimportamosarg.com";
const SUPABASE = "https://dybzgnmghisqapdzgknv.supabase.co";
const RUBROS = {
  "Perfumes": ["Perfumes Arabes", "Perfumes Diseñador"], "Tecnología": ["Tecnología"], "Bazar": ["Bazar"],
  "Zapatillas": ["Zapatillas"], "Camisetas": ["Camisetas"], "Indumentaria": ["Indumentaria", "Camisetas"],
  "Insumos Barber": ["Insumos Barber"], "Electrodomésticos": ["Electrodomésticos"], "Suplementación": ["Suplementación"],
};
const PALABRAS_RUBRO = [
  [/perfum|fragancia|arabe|árabe|lattafa|armaf/i, "Perfumes"], [/tecno|electr[oó]nic|auricular|celular|parlante|gamer|consola/i, "Tecnología"],
  [/bazar|cocina|mate|hogar|vaso|termo/i, "Bazar"], [/zapatilla|calzado/i, "Zapatillas"], [/camiseta|f[uú]tbol|nfl|nba/i, "Camisetas"],
  [/ropa|indumentaria|remera|buzo/i, "Indumentaria"], [/barber|peluquer/i, "Insumos Barber"], [/electrodom|licuadora|plancha|secador/i, "Electrodomésticos"],
  [/suplement|prote[ií]na|creatina/i, "Suplementación"],
];
// Muletillas: nunca repite la misma palabra en las últimas 4 que usó
const OK = ["joya", "buenisimo", "dale", "de una", "impecable", "genial", "perfecto", "barbaro", "joya dale", "dale de una", "buenisimo dale", "impecable dale", "dale perfecto", "genial dale"];
const MULETILLA = /^(joya|buen[ií]simo|dale|de una|impecable|genial|perfecto|b[aá]rbaro)(,? (dale|de una|impecable|joya|perfecto))?[,!. ]*/i;
let usadas = [];
const raiz = (m) => String(m).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").split(/[ ,]/)[0];
const ok = () => {
  const libres = OK.filter((x) => !usadas.includes(raiz(x)));
  const elegida = (libres.length ? libres : OK)[Math.floor(Math.random() * (libres.length || OK.length))];
  usadas = [...usadas, raiz(elegida)].slice(-4);
  return elegida;
};
// Si la IA arranca con una muletilla usada hace poco, la cambia por otra
function variarMuletilla(t) {
  const m = String(t).match(MULETILLA);
  if (!m) return t;
  if (!usadas.includes(raiz(m[1]))) { usadas = [...usadas, raiz(m[1])].slice(-4); return t; }
  const resto = t.slice(m[0].length);
  return resto ? `${ok()}${/^[a-z]/.test(resto) && resto.length > 25 ? ", " : "||"}${resto}` : ok();
}
const sinEmojis = (t) => String(t).replace(/[\p{Extended_Pictographic}\uFE0F\u200D\u20E3]/gu, "").replace(/[ \t]+\n/g, "\n").replace(/  +/g, " ").trim();
const pesos = (n) => "$" + Math.round(n).toLocaleString("es-AR");

async function claveSupabase(env) {
  if (env.SUPABASE_KEY) return env.SUPABASE_KEY;
  const g = await env.ESTADO.get("sbkey");
  if (g) return g;
  const html = await (await fetch(WEB + "/catalogo")).text();
  const scripts = [...new Set([...html.matchAll(/(?:src|href)="([^"]+\.js)"/g)].map((m) => new URL(m[1], WEB).href))];
  for (const src of scripts) {
    const js = await (await fetch(src)).text();
    const m = js.match(/sb_publishable_[\w-]+/) || js.match(/eyJ[\w-]{20,}\.[\w-]{20,}\.[\w-]{20,}/);
    if (m) { await env.ESTADO.put("sbkey", m[0], { expirationTtl: 86400 }); return m[0]; }
  }
  return null;
}

// Productos con stock y precio. Precio por transferencia = precio web (tarjeta) - 7%
async function catalogo(env) {
  const g = await env.ESTADO.get("catalogo");
  if (g) return JSON.parse(g);
  try {
    const k = await claveSupabase(env);
    const r = await fetch(`${SUPABASE}/rest/v1/products?select=id,nombre,categoria,precio,precio_oferta,oferta,stock`, { headers: { apikey: k, Authorization: `Bearer ${k}` } });
    const datos = await r.json();
    if (!Array.isArray(datos)) { console.log("Catálogo: respuesta inesperada", JSON.stringify(datos).slice(0, 150)); await env.ESTADO.delete("sbkey"); return []; }
    const lista = datos.filter((p) => p.stock === "SI" && num(p.precio) && p.categoria !== "Vapers")
      .map((p) => ({ nombre: p.nombre, cat: p.categoria, precio: Math.round((p.oferta === "SI" && num(p.precio_oferta) ? num(p.precio_oferta) : num(p.precio)) * 0.93), url: `${WEB}/producto/${p.id}` }));
    console.log("Catálogo cargado:", lista.length, "productos");
    if (lista.length) await env.ESTADO.put("catalogo", JSON.stringify(lista), { expirationTtl: 6 * 3600 });
    return lista;
  } catch (e) { console.log("Catálogo falló:", String(e)); return []; }
}

const mezclar = (a) => [...a].sort(() => Math.random() - 0.5);

// Busca un producto pedido en el catálogo de la web (por palabras del nombre)
const VACIAS = new Set(["replica","replicas","calidad","original","originales","jugador","marca","futbol","deportiva","deportivas","similar","tipo","igual","estilo","de","el","la","lo","y","en","que","un","me","mi","te","se","por","al","es","si","no","para","con","los","las","del","una","uno","unos","quiero","queria","saber","precio","tenes","tienen","hola","buenas","traer","importar","producto","productos","busco","necesito","sobre","este","esto","esos","como","cuanto","sale","salen","modelo","color","negro","negra","blanco","pack","recomendas","recomendame","recomienda","recomiendan","recomendar","conviene","hay","mostrame","pasame","opciones","algun","alguno","alguna","algunos","unas","mas","cual","cuales","otro","otra","bueno","buenos","buena","barato","baratos","tal","onda","che"]);
const normal = (t) => String(t).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9 ]/g, " ");
function buscarEnCatalogo(lista, consulta) {
  const raizP = (w) => (w.length > 5 && w.endsWith("es") ? w.slice(0, -2) : w.length > 4 && w.endsWith("s") ? w.slice(0, -1) : w);
  const pal = [...new Set(normal(consulta).split(/\s+/).filter((w) => w.length > 1 && !VACIAS.has(w)).map(raizP))];
  if (!pal.length) return [];
  const pegado = normal(consulta).replace(/\s+/g, "");
  return lista.map((p) => {
    const n = normal(p.nombre), np = n.replace(/\s+/g, "");
    let pts = pal.filter((w) => n.split(/\s+/).map(raizP).includes(w) || (w.length > 3 && n.includes(w))).length;
    const fuerte = pal.some((w) => w.length >= 6 && n.split(/\s+/).map(raizP).includes(w));   // palabra de producto clara ("auricular", "perfume")
    if (pal.some((w) => /\d/.test(w) && np.includes(w))) pts += 0.5;          // modelos tipo "go4", "9pm"
    if (pegado.length > 4 && np.includes(pegado)) pts += 2;
    return { p, pts, fuerte, cobertura: pts / pal.length };
  }).filter((x) => x.pts >= 2 || (x.pts >= 1 && (x.cobertura >= 0.6 || x.fuerte))).sort((a, b) => b.pts - a.pts).slice(0, 3).map((x) => x.p);
}

// Lo que la IA necesita saber del catálogo para responder consultas generales ("quiero saber de los perfumes")
async function catalogoParaIA(env, texto, charla = "") {
  const lista = await catalogo(env).catch(() => []);
  if (!lista.length) return "";
  // Rubro: lo que dice ahora y, si no nombra ninguno, lo que se venía hablando
  let rubros = [...new Set(PALABRAS_RUBRO.filter(([re]) => re.test(texto)).map(([, r]) => r))];
  if (!rubros.length) rubros = [...new Set(PALABRAS_RUBRO.filter(([re]) => re.test(charla)).map(([, r]) => r))].slice(-2);
  const porNombre = buscarEnCatalogo(lista, texto).length ? buscarEnCatalogo(lista, texto) : buscarEnCatalogo(lista, charla.split(" ").slice(-30).join(" "));
  const delRubro = rubros.flatMap((r) => [...lista.filter((p) => RUBROS[r]?.includes(p.cat))].sort((a, b) => a.precio - b.precio).slice(0, 45));
  const items = [...new Map([...porNombre, ...delRubro].map((p) => [p.nombre, p])).values()].slice(0, 60);
  const conteo = Object.entries(RUBROS).map(([r, cats]) => `${r}: ${lista.filter((p) => cats.includes(p.cat)).length}`).filter((x) => !x.endsWith(": 0")).join(", ");
  const precios = (r) => { const ps = lista.filter((p) => RUBROS[r]?.includes(p.cat)).map((p) => p.precio); return ps.length ? ` (de ${pesos(Math.min(...ps))} a ${pesos(Math.max(...ps))} por transferencia)` : ""; };
  return `Rubros con stock en la web y cantidad de productos: ${conteo}.` +
    (rubros.length ? `\nRango de precios del rubro que pregunta: ${rubros.map((r) => r + precios(r)).join("; ")}.` : "") +
    (porNombre.length ? `\nCOINCIDEN CON EL PRODUCTO QUE PIDE (ofrecé estos primero):\n${porNombre.map((p) => `- ${p.nombre} | ${p.cat} | ${pesos(p.precio)}`).join("\n")}` : "") +
    (items.length ? `\nOtros productos del rubro (nombre exacto | categoría | precio por transferencia):\n${items.filter((p) => !porNombre.includes(p)).map((p) => `- ${p.nombre} | ${p.cat} | ${pesos(p.precio)}`).join("\n")}` : "");
}

// Arma un combo dentro del presupuesto (cantidades para revender)
function armarCombo(productos, presupuesto, max = 5) {
  if (!presupuesto) return mezclar(productos).slice(0, max).map((p) => ({ ...p, cant: 1 }));
  const aptos = mezclar(productos.filter((p) => p.precio <= presupuesto / 2)).slice(0, max);
  if (!aptos.length) return [];
  const porItem = presupuesto / aptos.length;
  const items = aptos.map((p) => ({ ...p, cant: Math.max(1, Math.floor(porItem / p.precio)) }));
  const tot = () => items.reduce((t, i) => t + i.cant * i.precio, 0);
  while (tot() > presupuesto && items.length) { items.sort((x, y) => y.precio - x.precio); if (items[0].cant > 1) items[0].cant--; else items.shift(); }
  // Reparte lo que sobra de a una unidad por producto, en ronda (no amontona todo en el más barato)
  for (let sumo = true; sumo;) { sumo = false; for (const i of [...items].sort((x, y) => x.cant - y.cant || y.precio - x.precio)) if (tot() + i.precio <= presupuesto) { i.cant++; sumo = true; break; } }
  return items;
}
function listaCombo(items) {
  const total = items.reduce((t, i) => t + i.cant * i.precio, 0);
  return items.map((i) => `- ${i.cant}x ${i.nombre} ${pesos(i.precio)}${i.cant > 1 ? " c/u" : ""}`).join("\n") + `\n\ntotal ${pesos(total)} (precios por transferencia)`;
}
function presupuestoEnTexto(t) {
  const m = t.toLowerCase().match(/(\d+(?:[.,]\d+)*)\s*(k|mil|lucas|m|millones?|palos?)?/);
  if (!m) return null;
  let n = num(m[1]);
  if (/^(k|mil|lucas)/.test(m[2] || "")) n *= 1000;
  if (/^(millon|palo)|^m$/.test(m[2] || "")) n *= 1e6;
  if (/usd|d[oó]lar|u\$s/.test(t.toLowerCase())) n *= 1600;
  return n >= 1000 ? n : null;
}
const LISTA_RUBROS = "- perfumes (arabes y de diseñador)\n- tecnologia\n- bazar\n- zapatillas\n- camisetas\n- insumos barber\n- electrodomesticos\n- suplementacion";

// Flujo: presupuesto -> rubro -> combo armado -> ajustes
async function flujoCombo(env, de, e, texto, decir) {
  const c = e.combo;
  const t = texto.toLowerCase();
  const lista = await catalogo(env);
  const rubro = (PALABRAS_RUBRO.find(([re]) => re.test(texto)) || [])[1];
  const surtido = /surtid|variad|cualquier|de todo|mezcl|lo que sea|me da igual/i.test(texto);
  const nose = /no s[eé]|ni idea|no tengo idea|recomend|suger|que me (recomendas|aconsejas)/i.test(texto);
  const deRubro = (r) => lista.filter((p) => (r ? RUBROS[r] : Object.values(RUBROS).flat()).includes(p.cat));
  const enviarCombo = async (items, rub) => {
    if (!lista.length) return decir(`perdon, no pude cargar el catalogo ahora||fijate aca: ${WEB}/catalogo||y decime que te interesa`);
    if (!items.length) return decir(`con ese presupuesto no llego a armar un combo de ${rub ? rub.toLowerCase() : "eso"}||queres que lo arme con otro rubro o subimos un poco el presupuesto?`);
    c.items = items; c.paso = "armado";
    await evento(env, "cotizacion", de, `combo|${rub || "surtido"}`);
    return decir(`te recomiendo esto:||${listaCombo(items)}||podemos ajustarlo como quieras, sacamos o metemos lo que necesites`);
  };

  if (c.paso === "presupuesto") {
    c.presupuesto = presupuestoEnTexto(texto);
    if (!c.presupuesto && !rubro) return decir("mas o menos cuanto queres invertir? en pesos");
    if (rubro) { c.rubro = rubro; return enviarCombo(armarCombo(deRubro(rubro), c.presupuesto), rubro); }
    c.paso = "rubro";
    return decir(`${ok()}, podemos armar algo lindo||buscas algun rubro en particular??`);
  }
  if (c.paso === "rubro") {
    if (rubro) { c.rubro = rubro; return enviarCombo(armarCombo(deRubro(rubro), c.presupuesto), rubro); }
    if (surtido) { c.rubro = null; return enviarCombo(armarCombo(deRubro(null), c.presupuesto), null); }
    if (nose || /^no\b/.test(t)) return decir(`te recomiendo estos rubros:||${LISTA_RUBROS}||cual te interesa mas? o si queres te armo un surtido`);
    return decir("de que rubro? perfumes, tecnologia, bazar, zapatillas, camisetas...||o te armo un surtido");
  }
  if (c.paso === "armado" && c.items?.length) {
    const total = () => c.items.reduce((t, x) => t + x.cant * x.precio, 0);
    const limpiar = (frag) => normal(frag).split(/\s+/).filter((w) => w.length > 2 && !/^(saca|sacale|sacame|sacar|quita|quitale|quitame|sin|elimina|agrega|agregale|agregame|suma|sumale|sumame|mete|metele|pone|poneme|ponele|mas|tambien|unos|unas|algun|alguna|los|las|del|que|por|favor|otro|otros|otra|otras)$/.test(w));
    const coincide = (item, pals) => pals.length && pals.some((w) => normal(item.nombre).includes(w));
    // Divide el mensaje en la parte de "sacar" y la parte de "sumar" (ej. "sacale los airpods y poneme mas jbl")
    const mSacar = t.match(/\b(sac[aá]\w*|quit[aá]\w*|elimin\w*|sin (?:el|la|los|las))\b(.*?)(?=\b(y\s+)?(agreg|sum[aá]|met[eé]|pon[eé]|pone)|$)/i);
    const mSumar = t.match(/\b(agreg\w*|sum[aá]\w*|met[eé]\w*|pon[eé]\w*|quiero tambi[eé]n)\b(.*)$/i);
    let cambio = false, avisos = [];
    if (mSacar) {
      const pals = limpiar(mSacar[2]);
      const antes = c.items.length;
      c.items = c.items.filter((x) => !coincide(x, pals));
      if (c.items.length < antes) cambio = true; else avisos.push("no encontre cual sacar");
    }
    if (mSumar) {
      const pals = limpiar(mSumar[2]);
      const cantPedida = num((mSumar[2].match(/\d+/) || [])[0]);
      const existente = c.items.find((x) => coincide(x, pals));
      const libre = () => (c.presupuesto || Infinity) - total();
      if (existente) {
        // "poneme mas jbl": usa lo que quedó libre del presupuesto (al menos +1)
        const extra = cantPedida || Math.max(1, Math.floor(libre() / existente.precio));
        existente.cant += extra; cambio = true;
      } else if (pals.length) {
        const r2 = rubro ? deRubro(rubro) : lista.filter((p) => coincide(p, pals));
        const nuevo = r2.find((p) => !c.items.some((x) => x.nombre === p.nombre));
        if (nuevo) { c.items.push({ ...nuevo, cant: cantPedida || Math.max(1, Math.floor(libre() / nuevo.precio)) || 1 }); cambio = true; }
        else avisos.push("no encontre eso en el catalogo");
      }
    }
    if (cambio) return decir(`listo, asi quedaria:||${listaCombo(c.items)}${c.presupuesto && total() > c.presupuesto ? `||ojo que se pasa del presupuesto de ${pesos(c.presupuesto)}` : ""}||algo mas?`);
    if (avisos.length && (mSacar || mSumar)) return decir(`${avisos[0]}||decime el nombre como figura en la lista y lo ajusto`);
    // Pide rearmar explícitamente con otro rubro
    if (rubro && /\b(combo|arm[aá]|surtido|cambi[aá])/i.test(t)) { c.rubro = rubro; return enviarCombo(armarCombo(deRubro(rubro), c.presupuesto), rubro); }
    // Pregunta por otro producto/rubro sin hablar del combo: el combo queda guardado pero deja de "secuestrar" la charla
    if (rubro && rubro !== c.rubro) { e.comboAnterior = c; e.combo = null; }
  }
  return null; // sigue la conversación normal (IA)
}

// ---------------- WhatsApp ----------------
function variantes(n) {
  const v = [n];
  if (n.startsWith("549")) { const r = n.slice(3); v.push("54" + r); for (const l of [2, 3, 4]) v.push("54" + r.slice(0, l) + "15" + r.slice(l)); }
  return v;
}
async function enviarRaw(env, para, cuerpo) {
  const ok = await env.ESTADO.get(`fmt:${para}`);
  const lista = ok ? [ok, ...variantes(para).filter((x) => x !== ok)] : variantes(para);
  for (const n of lista) {
    const r = await fetch(`https://graph.facebook.com/v21.0/${env.WA_PHONE_ID}/messages`, {
      method: "POST", headers: { Authorization: `Bearer ${env.WA_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", to: n, ...cuerpo }) });
    const j = await r.json().catch(() => ({}));
    if (r.ok) { if (n !== ok) await env.ESTADO.put(`fmt:${para}`, n); return j.messages?.[0]?.id || true; }
    console.log("Fallo envío a", n, JSON.stringify(j.error || j).slice(0, 200));
    if (j.error?.code !== 131030) return false;
  }
  return false;
}
const enviar = (env, para, texto) => enviarRaw(env, para, { type: "text", text: { body: texto } });

// Menú como lista desplegable (si falla, manda el texto con números)
async function enviarMenu(env, para, nombre) {
  const ok = await enviarRaw(env, para, { type: "interactive", interactive: {
    type: "list",
    body: { text: `buenas${nombre ? " " + nombre : ""}! gracias por escribir\nque estas buscando?` },
    action: { button: "Ver opciones", sections: [{ title: "Te Importamos", rows: [
      { id: "1", title: "Importar un producto" },
      { id: "2", title: "Combo para revender" },
      { id: "3", title: "Ver catálogo" },
      { id: "4", title: "Grupo mayorista" },
    ] }] } } });
  if (!ok) await enviar(env, para, NEGOCIO.menu(nombre));
}

// Botón que abre WhatsApp con el número del equipo y un mensaje con todo el contexto
async function enviarBotonEquipo(env, para, cuerpo, mensaje) {
  const numero = env.NUMERO_EQUIPO || NUMERO_EQUIPO;
  const url = `https://wa.me/${numero}?text=${encodeURIComponent(mensaje.slice(0, 900))}`;
  const ok = await enviarRaw(env, para, { type: "interactive", interactive: {
    type: "cta_url", body: { text: cuerpo.slice(0, 1020) },
    action: { name: "cta_url", parameters: { display_text: "Hablar con el equipo", url } } } });
  if (!ok) await enviar(env, para, `${cuerpo}\n${url}`);
}

// Botones de aprobación para el equipo
async function enviarBotones(env, para, texto, botones) {
  const ok = await enviarRaw(env, para, { type: "interactive", interactive: {
    type: "button", body: { text: texto.slice(0, 1020) },
    action: { buttons: botones.map((b) => ({ type: "reply", reply: { id: b.id, title: b.titulo.slice(0, 20) } })) } } });
  if (!ok) await enviar(env, para, texto);
}

async function leidoYEscribiendo(env, id) {
  try {
    await fetch(`https://graph.facebook.com/v21.0/${env.WA_PHONE_ID}/messages`, {
      method: "POST", headers: { Authorization: `Bearer ${env.WA_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", status: "read", message_id: id, typing_indicator: { type: "text" } }) });
  } catch {}
}
async function avisarAdmins(env, texto) {
  for (const a of (env.ADMIN_PHONE || "").split(",").map((x) => x.trim()).filter(Boolean)) {
    const ok = await enviar(env, a, texto);
    // Fuera de la ventana de 24 h de WhatsApp no llega: se guarda y se entrega cuando el admin escriba
    if (!ok) {
      const pend = JSON.parse((await env.ESTADO.get(`alertas:${a}`)) || "[]");
      pend.push(texto.slice(0, 900));
      await env.ESTADO.put(`alertas:${a}`, JSON.stringify(pend.slice(-15)), { expirationTtl: 7 * 86400 });
    }
  }
}
// Aviso corto (sin detalle: el detalle queda en el panel > Pendientes). Va al business y al personal.
// AVISO_EXTRA (opcional en Cloudflare) reemplaza el número personal.
const AVISO_PERSONAL = "5493413084113";
async function avisoCorto(env, texto) {
  const nums = [...(env.ADMIN_PHONE || "").split(","), ...(env.AVISO_EXTRA || AVISO_PERSONAL).split(",")].map((x) => x.trim()).filter(Boolean);
  for (const n of [...new Map(nums.map((x) => [ultimos10(x), x])).values()]) await enviar(env, n, texto).catch(() => {});
}
// PENDIENTES: todo lo que el equipo tiene que hacer queda en la tabla "tareas" y se ve en el panel
async function crearTarea(env, t) {
  if (!env.DB) return;
  await prepararTablas(env);
  const ya = await env.DB.prepare("SELECT id FROM tareas WHERE tel = ? AND tipo = ? AND estado = 'abierta'").bind(t.tel || "", t.tipo).first();
  const datos = JSON.stringify(t.datos || {});
  if (ya && !t.ref) { await env.DB.prepare("UPDATE tareas SET ts = ?, titulo = ?, detalle = ?, datos = ? WHERE id = ?").bind(Date.now(), t.titulo || "", String(t.detalle || "").slice(0, 4000), datos, ya.id).run(); return ya.id; }
  const id = Date.now().toString(36) + id4();
  await env.DB.prepare("INSERT INTO tareas (id, ts, tipo, tel, nombre, titulo, detalle, datos, ref, estado) VALUES (?,?,?,?,?,?,?,?,?,'abierta')")
    .bind(id, Date.now(), t.tipo, t.tel || "", t.nombre || "", t.titulo || "", String(t.detalle || "").slice(0, 4000), datos, t.ref || "").run();
  return id;
}
async function cerrarTareas(env, { id, ref, tel, tipos } = {}) {
  if (!env.DB) return;
  await prepararTablas(env);
  if (id) return env.DB.prepare("UPDATE tareas SET estado = 'hecha' WHERE id = ?").bind(id).run();
  if (ref) return env.DB.prepare("UPDATE tareas SET estado = 'hecha' WHERE ref = ?").bind(ref).run();
  if (tel) for (const tp of tipos || []) await env.DB.prepare("UPDATE tareas SET estado = 'hecha' WHERE tel = ? AND tipo = ? AND estado = 'abierta'").bind(tel, tp).run();
}
async function hayTarea(env, tel, tipo) {
  if (!env.DB) return false;
  await prepararTablas(env);
  return !!(await env.DB.prepare("SELECT 1 FROM tareas WHERE tel = ? AND tipo = ? AND estado = 'abierta'").bind(tel, tipo).first());
}
// Frases en las que el agente promete hacer algo él mismo (hay que avisarle al equipo)
const PROMESA = /(lo averiguo|lo consulto|me encargo|dej[aá]melo|en mis manos|te aviso (enseguida|apenas|cuando)|te escribo (apenas|en cuanto|cuando lo)|te paso la cotizaci[oó]n en cuanto|lo busco y te)/i;

async function entregarAlertas(env, admin) {
  const clave = [...(env.ADMIN_PHONE || "").split(",")].map((x) => x.trim()).find((a) => ultimos10(a) === ultimos10(admin));
  if (!clave) return;
  const pend = JSON.parse((await env.ESTADO.get(`alertas:${clave}`)) || "[]");
  if (!pend.length) return;
  await env.ESTADO.delete(`alertas:${clave}`);
  await enviar(env, admin, `📬 Tenés ${pend.length} aviso(s) pendiente(s):`);
  for (const t of pend) await enviar(env, admin, t);
}
async function bajarImagen(env, id) {
  const h = { Authorization: `Bearer ${env.WA_TOKEN}` };
  const meta = await (await fetch(`https://graph.facebook.com/v21.0/${id}`, { headers: h })).json();
  if (!meta.url) throw new Error("No se pudo obtener la imagen (¿token vencido?)");
  const bytes = new Uint8Array(await (await fetch(meta.url, { headers: h })).arrayBuffer());
  let bin = ""; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { mime: meta.mime_type || "image/jpeg", data: btoa(bin) };
}
// Transcribe audios: Whisper de Cloudflare (gratis) y, si falla, Gemini
async function transcribir(env, id) {
  const a = await bajarImagen(env, id); // sirve para cualquier archivo de WhatsApp
  if (env.AI) {
    try {
      const r = await env.AI.run("@cf/openai/whisper-large-v3-turbo", { audio: a.data, language: "es" });
      if (r?.text?.trim()) { console.log("Audio (Whisper):", r.text.slice(0, 120)); return r.text.trim(); }
    } catch (e) { console.log("Whisper falló:", String(e).slice(0, 120)); }
  }
  for (const m of await modelosDisponibles(env)) {
    if (await env.ESTADO.get(`agotado:${m}`)) continue;
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, {
      method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_KEY },
      body: JSON.stringify({ contents: [{ parts: [{ text: "Transcribí este audio en español, textual, sin agregar nada." }, { inline_data: { mime_type: a.mime.split(";")[0], data: a.data } }] }] }) });
    const j = await r.json().catch(() => ({}));
    const t = (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("").trim();
    if (t) { console.log("Audio (Gemini):", t.slice(0, 120)); return t; }
  }
  return null;
}

// Lee los datos de Alibaba directo del código de la página (sin IA)
function extraerAlibaba(html) {
  const tramos = [];
  for (const m of html.matchAll(/"dollarPrice":([\d.]+)[^}]*?"min":(\d+)/g)) tramos.push({ desde: +m[2], precio: +m[1] });
  if (!tramos.length) for (const m of html.matchAll(/"minQuantity":(\d+)[^}]*?"price":([\d.]+)[^}]*?"formatPrice":"(US\$|USD|\$)/g)) tramos.push({ desde: +m[1], precio: +m[2] });
  if (!tramos.length) { const m = html.match(/"dollarPrice":([\d.]+)/); const q = html.match(/"minOrderQuantity":(\d+)|"moq":(\d+)/i); if (m) tramos.push({ desde: +(q?.[1] || q?.[2] || 1), precio: +m[1] }); }
  const unicos = [...new Map(tramos.map((t) => [t.desde, t])).values()].sort((a, b) => a.desde - b.desde);
  const peso = parseFloat((html.match(/"unitWeight":"?([\d.]+)/) || html.match(/"grossWeight":"?([\d.]+)/) || [])[1]) || null;
  const nombre = ((html.match(/<title>([^<]+)<\/title>/i) || [])[1] || "").split(/ - (Buy|Comprar)/)[0].trim().slice(0, 80) || null;
  return { nombre, tramos: unicos, peso_kg: peso };
}

async function leerPagina(link) {
  try {
    const r = await fetch(link, { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36", "Accept-Language": "es-AR,es;q=0.9" } });
    const html = await r.text();
    if (!r.ok || html.length < 5000 || /captcha|punish|slide to verify/i.test(html.slice(0, 20000))) {
      console.log("Página bloqueada", r.status, html.length);
      const slug = ((link.match(/product-detail\/([^_?#]+)/) || [])[1] || "").replace(/\.html?$/i, "").replace(/-?\d{8,}$/, "") || null;
      return slug ? { bloqueado: true, datos: { nombre: slug.replace(/-/g, " ").slice(0, 70) }, texto: `LINK BLOQUEADO: no se pudo leer la página. El producto parece ser: "${slug.replace(/-/g, " ")}". Pedí 2 capturas (tabla de precios por cantidad + Empaque y entrega con peso bruto), mencionando el producto.` } : null;
    }
    const datos = extraerAlibaba(html);
    console.log("Página", r.status, html.length, "extraído:", JSON.stringify(datos));
    const visible = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 6000);
    return { datos, texto: `DATOS EXTRAÍDOS DE LA PÁGINA: ${JSON.stringify(datos)}\nTEXTO: ${visible}` };
  } catch (e) { console.log("Error página", String(e)); return null; }
}

// ---------------- IA ----------------
async function modelosDisponibles(env) {
  if (env.GEMINI_MODEL) return [env.GEMINI_MODEL];
  const g = await env.ESTADO.get("modelos");
  if (g) return JSON.parse(g);
  const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", { headers: { "x-goog-api-key": env.GEMINI_KEY } });
  const j = await r.json().catch(() => ({}));
  const lista = (j.models || []).filter((m) => /flash/i.test(m.name) && !/image|tts|audio|live|embedding|thinking/i.test(m.name) &&
    (m.supportedGenerationMethods || []).includes("generateContent")).map((m) => m.name.replace("models/", ""))
    .sort((a, b) => (/omni|preview/.test(a) - /omni|preview/.test(b)) || b.localeCompare(a, undefined, { numeric: true }));
  const final = lista.length ? lista.slice(0, 6) : ["gemini-flash-latest"];
  await env.ESTADO.put("modelos", JSON.stringify(final), { expirationTtl: 43200 });
  return final;
}

async function instrucciones(env, e, extra = {}) {
  const aprendido = JSON.parse((await env.ESTADO.get("aprendido")) || "[]");
  return `Sos quien atiende el WhatsApp de "Te Importamos". Hablás como una persona del equipo, NO como un bot:
español rioplatense con VOSEO SIEMPRE (vos tenés, querés, podés; nunca "tú" ni "tienes"), natural, informal, en minúscula.
CERO EMOJIS. Mensajes MUY cortos como chat real: dividí tu respuesta en 2 o 3 mensajes separados con "||" (ej: "buenisimo dale||contame, que producto queres traer?"). Una sola pregunta por mensaje. No te presentes como IA, pero si el cliente pregunta si sos un bot o una persona, NUNCA mientas: decí "soy el asistente de te importamos, si querés te paso con alguien del equipo" y poné accion "derivar" con estado "consulta". Nunca digas que sos Matias, Manuel ni el dueño.

CÓMO PENSÁS ANTES DE RESPONDER (como lo haría un vendedor con experiencia):
1. Leé TODO lo que escribió el cliente (pueden ser varios mensajes juntos) y entendé qué quiere de verdad: qué producto o rubro, para qué (uso personal o revender), y qué te está preguntando concretamente.
2. Respondé PRIMERO a lo que preguntó, con información concreta. Recién después hacé UNA pregunta para avanzar.
3. Usá las mismas palabras del cliente ("los perfumes", "eso que vi en el video") para que sienta que lo escuchaste.
4. Si pregunta algo general de un rubro (ej. "quiero saber de los perfumes"), contale brevemente qué hay (tipos, rango de precios, mínimos) usando el CATÁLOGO RELEVANTE, pasale el link del catálogo y preguntale qué busca puntualmente o si es para revender. Eso NO es "requiere_busqueda".
5. Si dice algo ambiguo, hacé una pregunta corta para aclarar en vez de suponer.
5e. Si el cliente rechaza lo que le ofreciste ("no quiero eso", "botines no"), nunca lo vuelvas a ofrecer: preguntá qué busca o derivá.
5f. ARMAR COMBO solo con productos del tipo que pidió. Si pidió algo que no está en el CATÁLOGO RELEVANTE (herramientas, utensilios, canastos, insumos que no aparecen), NO completes armar_combo: decile que eso no lo tenemos en stock pero lo traemos de China por encargo y pedile fotos o links.
5d. Recomendá SOLO productos del mismo tipo que pidió (si pide auriculares, solo auriculares: nunca parlantes, cargadores ni otra cosa del rubro). Usá primero "COINCIDEN CON EL PRODUCTO QUE PIDE". Si no hay ninguno de ese tipo en el catálogo, decilo y ofrecé traerlo de China.
5a. Si ya hay un COMBO EN CURSO armado y el cliente lo acepta o pregunta por pago/envío/plazos, NO completes armar_combo: respondé la pregunta y avanzá al CIERRE DE VENTA. Solo rearmá si pide explícitamente otro combo, otro rubro para el combo u otro presupuesto.
5b. ARMAR DIRECTO: apenas sepas el RUBRO (o que quiere surtido de todo) y el PRESUPUESTO, completá "armar_combo" y el sistema le manda el combo armado con productos y cantidades del catálogo. NO le pases el link para que elija él, NO le hagas más preguntas: eso aplica a cualquier rubro (perfumes, tecnología, bazar, zapatillas, etc.). En "elegidos" poné los nombres EXACTOS del CATÁLOGO RELEVANTE que encajan con lo que pidió (ej. si dijo "para hombre", solo perfumes masculinos o unisex; si dijo "gamer", solo eso). Si te falta el presupuesto, preguntalo; si te falta el rubro, preguntalo. Nunca preguntes algo que ya respondió.
5c. MULETILLAS: variá entre joya, buenisimo, dale, de una, impecable, genial, barbaro, perfecto. Nunca uses la misma que en tus últimos 3 mensajes y muchas veces no uses ninguna, arrancá directo.
6. No repitas preguntas que el cliente ya respondió ni vuelvas a saludar si ya saludaste.
${extra.primerContacto ? `7. ES EL PRIMER MENSAJE DE ESTA CHARLA: arrancá saludando corto${e.nombre ? " con su nombre (" + e.nombre.split(" ")[0].toLowerCase() + ")" : ""} (ej. "buenas ${e.nombre ? e.nombre.split(" ")[0].toLowerCase() : ""}! como va") y en el mismo turno respondé lo que preguntó. NO muestres un menú.` : ""}

CATÁLOGO RELEVANTE (${WEB}/catalogo):
${extra.catalogoRelevante || "(no disponible ahora: pasá el link del catálogo)"}

ESTILO DEL DUEÑO (imitalo):${NEGOCIO.estilo}
CONOCIMIENTO:${NEGOCIO.conocimiento}
APRENDIDO (del equipo y de chats anteriores; tiene prioridad sobre lo anterior). Si una regla dice que algo no se hace o no se trae, respondéselo vos al cliente con amabilidad y ofrecé una alternativa; NO derives por eso:
${aprendido.map((a, i) => `${i + 1}. ${a}`).join("\n") || "(nada todavía)"}${e.oferta && e.oferta.vence > Date.now() ? `\n\nOFERTA VIGENTE PARA ESTE CLIENTE (respetala si avanza, vence ${new Date(e.oferta.vence).toLocaleDateString("es-AR")}): ${e.oferta.texto}` : ""}

CASO DERIVADO AL EQUIPO: ${e.derivado ? JSON.stringify(e.derivado) + ". Si el cliente pregunta por eso (ej: '¿pudiste encontrarlo?'), respondé que el equipo lo está viendo y le escribe en breve; no muestres el menú ni empieces de cero. Si ya hay una nota del equipo, seguí desde la nota." : "no"}
PRODUCTOS DEL CATÁLOGO YA OFRECIDOS: ${(e.catalogoOfrecido || []).join(", ") || "ninguno"}. Si el cliente responde cantidades o quiere comprar alguno de esos, son productos de stock (no de China): confirmá cantidad (mínimo habitual 5), precio por transferencia de la web y pedí los datos de compra; se paga el total.
COMBO EN CURSO: ${e.combo ? JSON.stringify(e.combo) : "no"}. Si el cliente pide cambios a un combo, ajustalo con productos del catálogo ${WEB}/catalogo (precios por transferencia = web - 7%).
Si en la conversación hay "(equipo)" o "(nota del equipo)", es lo que una persona del equipo ya habló con el cliente: seguí desde ahí sin repetir ni contradecir.
HISTORIAL DEL CLIENTE: ${e.resumen || "cliente nuevo"}. Productos ya cotizados: ${(e.listos || []).map((p) => `${p.nombre} x${p.cantidad}`).join(", ") || "ninguno"}.
Si vuelve después de un tiempo o cambia de producto/presupuesto/cantidad, adaptate con naturalidad y cercanía.
Si en la conversación aparece "Equipo (humano)", es alguien del equipo que atendió antes: respetá lo que dijo o prometió, no lo contradigas y seguí desde ahí sin volver a presentarte. ${e.nota ? "NOTA DEL EQUIPO: " + e.nota : ""}

ZAPATILLAS (lista mayorista propia, mínimo 3 pares combinando modelos y talles):
- Si pregunta por zapatillas en general o por modelos: fijate primero en el CATÁLOGO RELEVANTE; si no está lo que busca, poné "enviar_lista_zapatillas": true y en "respuesta" escribí "intro||pregunta" (ej. "te paso la lista mayorista que manejamos||cual modelo te interesa? decime talles y cuantos pares"). El sistema manda la lista en el medio.
- Si nombra o manda foto de un modelo que ESTÁ en la lista, decile el precio de la lista y pedí talles y cantidad de pares (mínimo 3). NO pidas capturas de Alibaba.
- Si el modelo NO está en la lista: seguí el PROTOCOLO DE BÚSQUEDA de abajo.
Lista (modelo: precio por par): ${NEGOCIO.listaZapatillas.split("\n").filter((l) => /^(•|💎|💰|[A-Z][a-z])/.test(l.trim())).join(" ").replace(/\s+/g, " ").slice(0, 1500)}

PROTOCOLO DE BÚSQUEDA (productos que hay que salir a buscar: ropa, camisetas, calzado fuera de lista, marcas, fotos sueltas sin precios de proveedor):
Antes de derivar juntá estos datos, preguntando de a 1 o 2 cosas por mensaje y SIN repetir lo que ya dijo:
 a) foto o modelo exacto (si solo nombró el producto, pedí una foto de referencia)
 b) cantidad (unidades/pares)
 c) talles y cantidad por talle (si es ropa o calzado) o variantes (color, capacidad, etc.)
 d) si busca solo ese modelo o también otros (cuáles)
 e) original o réplica
 f) si ya tiene proveedor o necesita que se lo busquemos
Cuando tengas TODO (o el cliente diga que le da lo mismo lo que falte), poné "datos_completos": true y avisale que el equipo lo busca con proveedores. Mientras falte algo, "datos_completos": false y preguntá lo que falta.

PESO DESDE IMÁGENES: solo completá peso_kg de una captura si ves claramente el rótulo "peso bruto" / "gross weight" / "single gross weight" POR UNIDAD. Si no estás seguro, dejalo null (el sistema se lo pide por escrito al cliente). Nunca confundas peso con medidas, precio o cantidad.

PARA COTIZAR necesitamos del proveedor: precio por tramo de cantidad, peso bruto unitario, y la cantidad del cliente. Vos NO calculás precios: solo extraés datos; el sistema arma la cotización.
- Sin referencia: pedí foto o link.
- Link o foto que no es de un proveedor (Mercado Libre, Instagram, foto suelta): preguntá "¿De dónde lo querés traer?" (China u otro origen) y si ya tiene proveedor.
- Si el cliente pregunta cómo o dónde encontrar los datos en Alibaba, respondé con este instructivo casi textual:
${NEGOCIO.guiaAlibaba("")}
- Si escribe los datos a mano (precios por cantidad y peso), tomalos como válidos.
- China/Alibaba: pedí el link o 2 capturas (tabla de precios por cantidad + "Empaque y entrega" con peso bruto) y la cantidad.
- Si manda una foto o nombre de un producto que hay que salir a buscar (marca, iPhone, ropa, calzado, camisetas, algo sin captura de proveedor con precios): marcá requiere_busqueda true, completá descripcion_producto con todo lo visible y seguí el PROTOCOLO DE BÚSQUEDA. NO pidas capturas de Alibaba en ese caso.
- Si la cantidad es menor al mínimo del proveedor: NUNCA le propongas subir al mínimo ni le cambies la cantidad. Se cotiza por la cantidad que pidió y el equipo busca otro proveedor que venda esa cantidad.
- FOTOS: mirá con atención cada imagen que manda (producto, precios, textos, peso) y usá lo que se ve. Nunca digas que no la ves ni pidas el link si ya mandó foto o link. Si no se lee el precio, pedilo UNA sola vez.
- Nunca asumas la cantidad: cada producto nuevo requiere que el cliente diga cuántas unidades quiere.
- Mientras estés juntando datos para cotizar, NO derives.
- NUNCA prometas averiguar algo vos (peso, proveedor, precio): si el cliente no puede darte un dato, poné accion "derivar" con estado "consulta" y decile que lo ve el equipo.
- Pedí solo lo que falta. Producto en curso: ${JSON.stringify(e.actual || {})}, cantidad: ${e.cantidad || "sin dato"}.

RITMO (no seas invasivo, como un buen vendedor):
- Si el cliente dice que es "para saber el precio", "no es para ahora", "lo voy a pensar", "tengo que juntar" o similar: dale el precio o la info que pidió, decile que cuando quiera lo armamos y NO le pidas datos personales ni le hables de seña. Cerrá corto y amable, sin pregunta.
- Nunca pidas los datos de compra (nombre, DNI, mail, dirección) si el cliente no dijo claramente que quiere comprar YA.
- Si respondió algo corto tipo "dale", "ok", "joya" sin dato nuevo, no repitas la pregunta anterior: reformulala una sola vez o esperá.
- Si el cliente agradece o se despide ("gracias", "dale gracias"), respondé corto y no hagas otra pregunta.
- Juntá datos en pocas preguntas: si te falta talle y color, preguntá las dos cosas juntas en un mensaje.
CIERRE DE VENTA: SOLO si el cliente dice claramente que quiere avanzar o comprar, pedí: nombre y apellido, DNI, email, teléfono, envío a domicilio o sucursal de correo (y cuál/dirección). Explicá la seña del 30% (China) o pago total (catálogo/Paraguay), que puede pagar en pesos al dólar cripto del día, pasale el alias ${NEGOCIO.cobro.alias} (cuenta ${NEGOCIO.cobro.banco} a nombre de ${NEGOCIO.cobro.titular}) y pedile que mande el comprobante por acá.
Si te pregunta cómo pagar, respondé eso directamente (no armes ni cambies combos ni cotizaciones).
COMPROBANTES: si la imagen es un comprobante de transferencia o pago, poné "comprobante": {"monto": número o null, "destino": "alias/titular que figura o null", "fecha": "texto o null"} y en "respuesta" agradecé y decí que lo verifican y le confirman enseguida. No derives por eso.

DERIVÁ (accion "derivar") cuando: reclamo/producto incorrecto/insatisfecho ("problema"), urgente ("urgente"), pagos ("señado"/"pagado"), descuento ("descuento"), búsqueda de proveedor ("busqueda_proveedor"), o algo que no sabés ("consulta").

Respondé SOLO JSON:
{"respuesta":"mensaje al cliente",
 "accion":"ninguna"|"derivar",
 "derivacion":{"estado":"urgente|problema|señado|pagado|descuento|busqueda_proveedor|consulta","resumen":"una oración con el caso"} o null,
 "producto":{"nombre":null,"tramos":[{"desde":0,"precio":0}],"moneda":"USD|CNY|ARS|BRL","peso_kg":null,"link":null},
 "es_vaper": true si consulta por vapers, vapes, pods o cigarrillos electrónicos (por texto o foto); false si no (los difusores de aromaterapia NO son vapers),
 "es_proveedor": true SOLO si la imagen es una captura de Alibaba/1688/AliExpress/proveedor con tabla de precios por cantidad; false si es foto de producto, carrito de otra tienda, publicación de Instagram/ML o foto suelta,
 "peso_estimado_kg": tu estimación razonable del peso bruto POR UNIDAD de ese producto con su caja (ej. SSD 0.08, zapatilla con caja 1.1, bicicleta 18) o null si no sabés qué producto es,
 "ofrecer_catalogo": true SOLO si el cliente pidió algo que está en "COINCIDEN CON EL PRODUCTO QUE PIDE" y es exactamente el mismo tipo de producto; false en cualquier otro caso,
 "cantidad":null,
 "requiere_busqueda": true si el cliente pide un producto que NO viene de una publicación/captura de proveedor con precios (foto suelta, producto de marca como iPhone, ropa, calzado, link de Mercado Libre/Instagram, algo que hay que salir a buscar); false si es una captura o link de Alibaba/proveedor con precios,
 "descripcion_producto": "qué es, marca, modelo, color, talle u otros detalles visibles",
 "enviar_lista_zapatillas": false,
 "comprobante": null,
 "datos_completos": true solo si ya tenés todos los datos del PROTOCOLO DE BÚSQUEDA,
 "armar_combo": null o {"rubro":"Perfumes|Tecnología|Bazar|Zapatillas|Camisetas|Indumentaria|Insumos Barber|Electrodomésticos|Suplementación|null si es surtido de todo","presupuesto": número en pesos completos (300k = 300000),"preferencia":"lo que pidió en 2-4 palabras (ej. perfumes de hombre)","elegidos":["nombres exactos del catálogo que encajan"]},
 "lead":{"perfil":"arranca|revendedor_ml|local_fisico|desconocido","presupuesto":null,"rubro":null,"interes":null,"calidad":"alta|media|baja","temperatura":"caliente|tibio|frio","puntaje":1-10,"etapa":"consulta|cotizado|negociando|cierre|cliente"},
 "datos_cliente":{"nombre_apellido":null,"dni":null,"email":null,"envio":null,"direccion":null},
 "resumen_cliente":"2 líneas: quién es, qué busca, en qué quedó"}
Números con punto decimal (3647.38, no 3.647,38).
LECTURA DE PRECIOS (muy importante, un error acá arruina la cotización):
- Fijate SIEMPRE la moneda. "¥", "元", "CNY", "RMB" o precios de 1688/Taobao = moneda "CNY". "ARS", "$" con miles (28.792,69), precios de Mercado Libre o de una web argentina = moneda "ARS". "R$" = "BRL". "US$", "USD", "$" en Alibaba.com = "USD".
- Si la captura muestra el equivalente en dólares al lado (ej. "¥23.9 ≈3,65$" en la app de 1688), USÁ ESE VALOR EN DÓLARES y poné moneda "USD".
- Cada tramo es {"desde": cantidad mínima de ese precio, "precio": precio POR UNIDAD}. Ej: "≥1 ¥24.9 / 100-999 ¥23.9" → [{"desde":1,"precio":24.9},{"desde":100,"precio":23.9}] con moneda "CNY".
- Un rango de precios "28.792 - 47.955" sin cantidades = un solo tramo desde 1 con el precio ALTO.
- Si solo se ve un precio, poné un tramo desde 1 con ese precio. No pidas otra captura si ya hay un precio legible.
- El peso bruto por unidad: si aparece en la captura ("peso bruto", "毛重", "weight", "kg" o "g" en empaque), ponelo en peso_kg (en kg). Si no aparece, igual completá peso_estimado_kg con tu mejor estimación. En producto solo datos vistos (tramos [] si no hay). Calidad alta = tiene negocio o presupuesto de USD 500+; baja = solo mira o presupuesto muy bajo.
Temperatura: caliente = quiere comprar ya, pregunta cómo pagar, acepta cotización o da datos; tibio = interés concreto (producto y cantidad) pero sin apuro; frio = solo mira, pide catálogo sin más, presupuesto muy bajo o dejó de responder. Puntaje 1-10 = probabilidad de compra combinando calidad y temperatura. resumen_cliente: actualizalo siempre con lo último (qué busca, cantidad, presupuesto, en qué quedó).`;
}

async function cerebro(env, e, texto, imagen, pagina, extra = {}) {
  const hist = (e.historial || []).slice(-14).map((h) => `${h.r === "c" ? "Cliente" : h.r === "h" ? "Equipo (humano)" : "Vos"}: ${h.t}`).join("\n");
  const prompt = `${await instrucciones(env, e, extra)}\n\nCONVERSACIÓN:\n${hist}\nCliente: ${texto || "(envió una imagen)"}` + (pagina ? `\n\nCONTENIDO DEL LINK:\n${pagina}` : "");
  const parsear = (t) => { const m = (t || "").match(/\{[\s\S]*\}/); try { return m ? JSON.parse(m[0].replace(/(\d),(\d)/g, "$1.$2")) : null; } catch { return null; } };
  const partes = [{ text: prompt }];
  if (imagen) for (const im of [imagen, ...(imagen.extras || [])]) partes.push({ inline_data: { mime_type: im.mime, data: im.data } });
  if (imagen?.extras?.length) partes[0].text += `\n\n(El cliente mandó ${imagen.extras.length + 1} imágenes juntas: combiná los datos de todas, por ejemplo precios de una y peso de otra.)`;
  let intentos = 0;
  for (const m of await modelosDisponibles(env)) {
    if (intentos >= 3) break;
    if (await env.ESTADO.get(`agotado:${m}`)) continue;
    intentos++;
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, {
      method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_KEY },
      body: JSON.stringify({ contents: [{ parts: partes }], generationConfig: { responseMimeType: "application/json", temperature: 0.6 } }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.error) {
      console.log("Gemini", m, r.status, (j.error?.message || "").slice(0, 60));
      if (r.status === 429) await env.ESTADO.put(`agotado:${m}`, "1", { expirationTtl: 6 * 3600 });
      if (r.status === 404) await env.ESTADO.delete("modelos");
      continue;
    }
    const res = parsear((j.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join(""));
    if (res) { console.log("Gemini OK", m); return res; }
  }
  if (env.AI) {
    try {
      const modelo = imagen ? "@cf/mistralai/mistral-small-3.1-24b-instruct" : "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
      const contenido = imagen ? [{ type: "text", text: prompt.slice(0, 24000) }, { type: "image_url", image_url: { url: `data:${imagen.mime};base64,${imagen.data}` } }] : prompt.slice(0, 24000);
      const r = await env.AI.run(modelo, { messages: [{ role: "user", content: contenido }], max_tokens: 1200, temperature: 0.4 });
      console.log("Cloudflare AI OK", modelo);
      return parsear(typeof r.response === "string" ? r.response : JSON.stringify(r.response));
    } catch (err) { console.log("Cloudflare AI falló:", String(err).slice(0, 150)); }
  }
  return null;
}

// =====================================================================
//  AUTOAPRENDIZAJE: una vez por día relee los chats, detecta qué salió mal
//  y propone reglas nuevas. Ustedes las aprueban con un botón (o #autoaprender si).
// =====================================================================
const APRENDIZAJE = { horaUTC: 12, minuto: 30, maxChats: 40, maxReglas: 60 };   // 12:30 UTC = 9:30 Rosario
async function iaJSON(env, prompt) {
  const parsear = (t) => { const m = (t || "").match(/\{[\s\S]*\}/); try { return m ? JSON.parse(m[0]) : null; } catch { return null; } };
  for (const m of (await modelosDisponibles(env)).slice(0, 3)) {
    if (await env.ESTADO.get(`agotado:${m}`)) continue;
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, { method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_KEY },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: "application/json", temperature: 0.3 } }) }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : {};
    if (!r?.ok || j.error) { if (r?.status === 429) await env.ESTADO.put(`agotado:${m}`, "1", { expirationTtl: 6 * 3600 }); continue; }
    const res = parsear((j.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join(""));
    if (res) return res;
  }
  if (env.AI) { try { const r = await env.AI.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast", { messages: [{ role: "user", content: prompt.slice(0, 24000) }], max_tokens: 1500, temperature: 0.3 }); return parsear(typeof r.response === "string" ? r.response : JSON.stringify(r.response)); } catch {} }
  return null;
}
async function autoaprender(env, forzar) {
  const desde = Date.now() - 26 * 3600e3;
  const chats = [];
  for (const k of (await env.ESTADO.list({ prefix: "v3:" })).keys) {
    const e = JSON.parse((await env.ESTADO.get(k.name)) || "null");
    if (!e?.historial?.length || (e.ultimoMensaje || 0) < desde || (!forzar && (e.revisado || 0) >= e.ultimoMensaje)) continue;
    chats.push({ tel: k.name.slice(3), e });
  }
  if (!chats.length) return "No hubo chats nuevos para revisar.";
  const lote = chats.sort((a, b) => b.e.ultimoMensaje - a.e.ultimoMensaje).slice(0, APRENDIZAJE.maxChats);
  const quien = { c: "Cliente", a: "Agente", h: "Equipo (humano)" };
  const texto = lote.map((c, i) => `### Chat ${i + 1}${c.e.derivado ? ` (derivado: ${c.e.derivado.estado})` : ""}${c.e.listos?.length ? " (llegó a cotización)" : ""}\n` +
    c.e.historial.slice(-24).map((h) => `${quien[h.r] || h.r}: ${String(h.t).slice(0, 220)}`).join("\n")).join("\n\n").slice(0, 60000);
  const ap = JSON.parse((await env.ESTADO.get("aprendido")) || "[]");
  const r = await iaJSON(env, `Sos el entrenador del agente de WhatsApp de "Te Importamos" (importaciones por encargo, Rosario). Analizá estos chats reales de las últimas 24 h.
Buscá: respuestas que no entendieron lo que el cliente quería, preguntas repetidas, respuestas robóticas, clientes que dejaron de responder después de algo que dijo el agente, preguntas frecuentes sin buena respuesta, y lo que el EQUIPO (humano) respondió distinto o mejor que el agente.
Proponé como máximo 5 reglas nuevas, cortas y accionables (una oración, en imperativo, en español rioplatense), que mejoren las próximas charlas. No repitas reglas que ya existen:
${ap.map((a, i) => `${i + 1}. ${a}`).join("\n") || "(ninguna)"}
No inventes precios, plazos ni políticas: si hace falta un dato del negocio que no está, proponé la regla como pregunta para el equipo empezando con "PREGUNTA:".
Respondé SOLO JSON: {"diagnostico":"3 líneas: qué funcionó y qué falló","reglas":[{"regla":"...","porque":"chat N: lo que pasó"}]}

CHATS:
${texto}`);
  for (const c of lote) { c.e.revisado = Date.now(); await env.ESTADO.put(`v3:${c.tel}`, JSON.stringify(c.e), { expirationTtl: 90 * 86400 }); }
  if (!r) return "La IA no respondió, lo intento mañana.";
  const auto = (await env.ESTADO.get("autoaprender")) === "si";
  const reglas = (r.reglas || []).filter((x) => x?.regla).slice(0, 5);
  let informe = `🧠 Revisé ${lote.length} chat(s) de ayer\n\n${r.diagnostico || ""}`;
  if (!reglas.length) { await avisarAdmins(env, informe + "\n\nNo encontré reglas nuevas para agregar."); return informe; }
  if (auto) {
    const nuevas = reglas.filter((x) => !/^PREGUNTA:/i.test(x.regla)).map((x) => x.regla);
    const total = [...ap, ...nuevas].slice(-APRENDIZAJE.maxReglas);
    await env.ESTADO.put("aprendido", JSON.stringify(total));
    informe += `\n\nAprendí solo (modo automático):\n${nuevas.map((x) => "• " + x).join("\n")}` + reglas.filter((x) => /^PREGUNTA:/i.test(x.regla)).map((x) => `\n❓ ${x.regla}`).join("") + `\n\nPara borrar alguna: #saber y #olvidar N`;
    await avisarAdmins(env, informe.slice(0, 3900));
    return informe;
  }
  await avisarAdmins(env, (informe + `\n\nTe propongo ${reglas.length} regla(s) nuevas, aprobalas una por una:`).slice(0, 3900));
  for (const x of reglas) {
    const id = id4();
    await env.ESTADO.put(`prop:${id}`, x.regla, { expirationTtl: 7 * 86400 });
    for (const a of (env.ADMIN_PHONE || "").split(",").map((y) => y.trim()).filter(Boolean))
      await enviarBotones(env, a, `📌 ${x.regla}\n\n(por qué: ${String(x.porque || "").slice(0, 200)})${/^PREGUNTA:/i.test(x.regla) ? "\n\nRespondela con #aprender y el dato" : ""}`,
        /^PREGUNTA:/i.test(x.regla) ? [{ id: `#rech ${id}`, titulo: "Listo" }] : [{ id: `#ap ${id}`, titulo: "✅ Aprender" }, { id: `#rech ${id}`, titulo: "❌ Descartar" }]);
  }
  return informe;
}

// =====================================================================
//  ANTI PÉRDIDA DE LEADS
//  Distingue "frío porque el cliente no quiere" de "frío porque el agente se trabó".
// =====================================================================
// VAPERS: no se atienden por este número (políticas de WhatsApp). Respuesta fija y aviso al socio que se encarga.
const VAPERS = { respuesta: "nosotros no nos encargamos de eso, contactate por aca: 341 805-1515", avisarA: "5493413011600" };
const ES_VAPER = /\b(vapes?|vapers?|vapeador|vapear|elf ?bar|elbar|ignite|lost ?mary|waka|vozol|pod(s)? desechable|desechable de \d|\d+\s*k?\s*puffs?|cigarrillos? electr[oó]nicos?)\b/i;
const NO_VAPER = /aromaterapia|difusor|humidificador|aromas?\b/i;
async function derivarVaper(env, de, e, decir) {
  if (!e.historial.slice(-3).some((h) => h.r === "a" && String(h.t).includes("no nos encargamos de eso"))) await decir(VAPERS.respuesta);
  if (!e.vaperAvisado) {
    e.vaperAvisado = Date.now();
    const ult = e.historial.filter((h) => h.r === "c").slice(-2).map((h) => h.t).join(" / ").slice(0, 200);
    await enviar(env, VAPERS.avisarA, `Te derivé un chat de vapers: ${e.nombre || ""} +${de}\n"${ult}"\nEscribile: https://wa.me/${de}`).catch(() => {});
    await evento(env, "derivado", de, "vapers");
  }
  await env.ESTADO.put(`pausa:${de}`, "1", { expirationTtl: 12 * 3600 });   // el agente no sigue esa charla
  await env.ESTADO.delete(`seg:${de}`);
  e.sinInteres = true;   // sin seguimientos ni ofertas
}
const PIDE_HUMANO = /(hablar con (una persona|alguien|un humano|un asesor|el due[nñ]o|matias|manuel)|una persona real|un asesor|n[uú]mero para llamar|(hacer|coordinar|tener) una? (llamada|llamadita|videollamada)|me llam[aá]s|te llamo|pod[eé]s llamar|sos (un )?(bot|robot)|claramente (sos )?un bot|no (me )?(da|brinda) confianza|desconf|estafa)/i;
const RECLAMO = /(no (me )?entend[eé]s|no entendiste|te pregunt[eé]|ya te (lo )?dije|no es eso|no te ped[ií]|\?{2,}|hola+\s*\?+|me respond[eé]s|no me respond|sos (un )?(bot|robot)|hablar con (una persona|alguien|un humano)|una persona real|cualquier cosa|no tiene nada que ver)/i;
async function alertaRiesgo(env, de, e, motivo, forzar = false) {
  e.salud = "trabada"; e.saludMotivo = String(motivo).slice(0, 200);
  const k = `riesgo:${de}`;
  if (!forzar && (await env.ESTADO.get(k))) return;   // máximo una alerta por chat cada 2 h
  await env.ESTADO.put(k, "1", { expirationTtl: SALUD.alertaCadaHoras * 3600 });
  await anotarResumen(env, { tipo: "riesgo", tel: de, nombre: e.nombre, texto: motivo });
  const link = `${env.PUBLIC_URL || BASE_URL}/panel?tel=${de}`;
  await crearTarea(env, { tipo: "riesgo", tel: de, nombre: e.nombre, titulo: "Chat en riesgo", detalle: `${motivo}\nEn qué estaba: ${(e.resumen || "-").slice(0, 300)}` });
}

// Supervisor: cada pocas horas relee los chats que quedaron en silencio y juzga de quién fue la culpa
async function supervisarChats(env, conIA = true) {
  const ahora = Date.now(), lote = [];
  for (const k of (await env.ESTADO.list({ prefix: "v3:" })).keys) {
    const tel = k.name.slice(3);
    if (esAdmin(env, tel)) continue;
    const e = JSON.parse((await env.ESTADO.get(k.name)) || "null");
    if (!e?.historial?.length || !e.ultimoMensaje) continue;
    const pausado = await env.ESTADO.get(`pausa:${tel}`);
    const ultimo = e.historial[e.historial.length - 1];
    // a) El cliente escribió y nadie le respondió
    if (ultimo.r === "c" && !pausado && ahora - e.ultimoMensaje > SALUD.minutosSinRespuesta * 60e3 && ahora - e.ultimoMensaje < 24 * 3600e3 && !(await env.ESTADO.list({ prefix: `bm:${tel}:` })).keys.length) {
      const res = await retomar(env, tel, "sin respuesta").catch((err) => "error: " + err);
      console.log("Retomado solo", tel, res);
      if (res.startsWith("le respondí")) continue;
      await alertaRiesgo(env, tel, e, `el cliente escribió hace ${Math.round((ahora - e.ultimoMensaje) / 60e3)} min y no tuvo respuesta: "${String(ultimo.t).slice(0, 100)}"`);
      await env.ESTADO.put(k.name, JSON.stringify(e), { expirationTtl: 90 * 86400 });
      continue;
    }
    // b) Silencio después de una respuesta del agente: lo revisa la IA (una vez por cada silencio)
    const charlo = e.historial.filter((h) => h.r === "c").length >= 2;
    if (conIA && charlo && ultimo.r === "a" && !pausado && ahora - e.ultimoMensaje > 2 * 3600e3 && ahora - e.ultimoMensaje < 30 * 3600e3 && (e.saludRevisada || 0) < e.ultimoMensaje) lote.push({ tel, e });
  }
  if (!lote.length) return "Sin chats para revisar.";
  const quien = { c: "Cliente", a: "Agente", h: "Equipo" };
  const muestra = lote.slice(0, 25);
  const r = await iaJSON(env, `Sos supervisor de calidad de un agente de ventas por WhatsApp (Te Importamos, importaciones). En cada chat el cliente dejó de responder. Decidí si se enfrió por el CLIENTE (normal: solo miraba, precio, ya tiene lo que necesita) o por culpa del AGENTE (no entendió, respondió otra cosa, repitió preguntas, armó algo que no pidió, se trabó, sonó robótico, no respondió una pregunta concreta, no avanzó al cierre cuando el cliente quería comprar).
Respondé SOLO JSON: {"chats":[{"n":1,"salud":"ok|dudosa|trabada","culpa":"cliente|agente","motivo":"una oración concreta"}]}

${muestra.map((c, i) => `### Chat ${i + 1}\n` + c.e.historial.slice(-14).map((h) => `${quien[h.r] || h.r}: ${String(h.t).slice(0, 200)}`).join("\n")).join("\n\n").slice(0, 50000)}`);
  const malos = [];
  for (const [i, c] of muestra.entries()) {
    const v = (r?.chats || []).find((x) => +x.n === i + 1);
    c.e.saludRevisada = Date.now();
    if (v) { c.e.salud = v.culpa === "agente" ? v.salud : "ok"; c.e.saludMotivo = v.culpa === "agente" ? v.motivo : `se enfrió el cliente: ${v.motivo || ""}`.slice(0, 200); }
    await env.ESTADO.put(`v3:${c.tel}`, JSON.stringify(c.e), { expirationTtl: 90 * 86400 });
    await guardarLead(env, c.tel, c.e, {});
    if (v && v.culpa === "agente" && v.salud !== "ok") malos.push({ ...c, v });
  }
  for (const m of malos) await alertaRiesgo(env, m.tel, m.e, `supervisor: ${m.v.motivo}`);
  return `Revisé ${muestra.length} chat(s): ${malos.length} con problemas del agente.`;
}

// RETOMAR al sacar la pausa: si el cliente quedó sin respuesta, le responde; si ya le contestó el equipo, retoma con un mensaje natural
async function retomar(env, tel, motivo = "reanudado") {
  if (await env.ESTADO.get(`pausa:${tel}`)) return "sigue pausado";
  const k = `v3:${tel}`;
  const e = JSON.parse((await env.ESTADO.get(k)) || "null");
  if (!e?.historial?.length) return "sin charla previa: responde cuando el cliente escriba";
  const reales = e.historial.filter((h) => !h.n);   // las notas internas no cuentan como mensajes
  const ultimo = reales[reales.length - 1];
  const hs = (Date.now() - (e.ultimoMensaje || 0)) / 3600e3;
  if (hs > SEGUIMIENTO_AUTO.ventana) return "pasaron más de 24 h desde el último mensaje del cliente: WhatsApp no deja escribirle gratis, responde cuando vuelva a escribir";
  if (ultimo?.r === "c") {
    // Junta lo que el cliente escribió mientras estaba pausado y lo responde como un turno normal
    let i = e.historial.length; while (i > 0 && (e.historial[i - 1].r === "c" || e.historial[i - 1].n)) i--;
    const pendientes = e.historial.slice(i).filter((h) => h.r === "c").map((h) => String(h.t).replace(/^\(audio\) /, ""));
    e.historial = e.historial.slice(0, i).concat(e.historial.slice(i).filter((h) => h.n));
    await env.ESTADO.put(k, JSON.stringify(e), { expirationTtl: 90 * 86400 });
    const texto = pendientes.filter((t) => t !== "(imagen)").join("\n") || "(mandó una imagen mientras estaba en pausa)";
    await enCola(env, tel, () => procesar(env, tel, { type: "text", text: { body: texto } }, e.nombre));
    return `le respondí lo que había preguntado: "${texto.slice(0, 80)}"`;
  }
  // Lo último lo dijo el equipo (o el agente): NO le escribe. Queda atento y responde cuando el cliente conteste.
  // Si el cliente no contesta, los seguimientos de 12 h y 23 h lo retoman solos.
  return "quedó atento: responde cuando el cliente conteste (no le mandé nada)";
}

// Seguimiento automático personalizado: 12 h y 23 h después del último mensaje del cliente (siempre gratis)
// RECORDATORIO "MANTENÉ VIVA LA VENTANA": a los números del equipo se les avisa a las ~22 h de su último mensaje
// (WhatsApp solo deja escribirles gratis si escribieron en las últimas 24 h). Si responden, la ventana se renueva.
const VENTANA_EQUIPO = { numeros: ["5493418051515", "5493413084113", "5493413011600"], aLasHoras: 22, texto: "acordate de mandarme un mensaje asi no se corta el flujo (cualquier cosa, un ok alcanza)" };
async function recordarVentanas(env) {
  for (const n of VENTANA_EQUIPO.numeros) {
    const ult = +(await env.ESTADO.get(`vent:${ultimos10(n)}`)) || 0;
    if (!ult) continue;
    const hs = (Date.now() - ult) / 3600e3;
    if (hs < VENTANA_EQUIPO.aLasHoras || hs > 23.8) continue;
    if ((await env.ESTADO.get(`ventAvisado:${ultimos10(n)}`)) === String(ult)) continue;   // uno solo por cada ventana
    await env.ESTADO.put(`ventAvisado:${ultimos10(n)}`, String(ult), { expirationTtl: 3 * 86400 });
    const ok = await enviar(env, n, VENTANA_EQUIPO.texto).catch(() => false);
    if (ok) await env.ESTADO.put(`ventRecordado:${ultimos10(n)}`, String(Date.now()), { expirationTtl: 86400 });
    console.log("Recordatorio de ventana a", n, ok ? "enviado" : "falló");
  }
}
async function seguimientosAuto(env) {
  const ahora = Date.now();
  for (const k of (await env.ESTADO.list({ prefix: "v3:" })).keys) {
    const tel = k.name.slice(3);
    if (esAdmin(env, tel)) continue;
    const e = JSON.parse((await env.ESTADO.get(k.name)) || "null");
    if (!e?.historial?.length || !e.ultimoMensaje) continue;
    const hs = (ahora - e.ultimoMensaje) / 3600e3, env2 = e.segEnviados || 0;
    const toca = env2 === 0 && hs >= SEGUIMIENTO_AUTO.primero ? 1 : 0;
    if (!toca || hs > SEGUIMIENTO_AUTO.ventana) continue;   // fuera de las 24 h: WhatsApp cobra, no se manda
    const ultimo = e.historial[e.historial.length - 1];
    if (ultimo.r === "c" || e.sinInteres || e.baja || ["pagado", "pago_informado"].includes(e.etapa) || (e.derivado && ahora - Date.parse(e.derivado.cuando) < 3 * 86400e3) || (await env.ESTADO.get(`pausa:${tel}`))) continue;
    const quien = { c: "Cliente", a: "Vos", h: "Equipo" };
    const soloSaludo = !e.historial.some((h) => h.r === "c" && !/vi un video tuyo/i.test(h.t) && String(h.t).replace(/[^a-z0-9]/gi, "").length > 3);
    const r = await iaJSON(env, `Sos quien atiende el WhatsApp de "Te Importamos" (importaciones por encargo). El cliente no responde hace ${Math.round(hs)} horas. Escribí UN seguimiento (el único que le vamos a mandar) con una OFERTA personalizada para que se decida.
OFERTAS PERMITIDAS (elegí la que mejor encaje con lo que consultó; nunca más de 10% de descuento):
- Importación desde China (Alibaba, cotización, producto a buscar): 50% off en nuestros honorarios (USD 40 en vez de 80).
- Productos del catálogo o combos: envío gratis llevando 5 unidades o más, o hasta 10% de descuento en el pedido.
- Zapatillas: envío gratis desde 3 pares.
- Si todavía no dijo qué quiere: 50% off en honorarios en su primera importación si nos cuenta qué producto busca.
La oferta vale 48 h. Estilo: rioplatense, voseo, minúscula, CERO emojis, 1 o 2 mensajes cortos separados por "||". Natural, nada de "estimado cliente". Retomá lo concreto que se habló${soloSaludo ? " (en este caso solo saludó: preguntale qué producto vio en el video)" : ""} y cerrá con una pregunta simple.
Si el cliente dijo que no le interesa, que no le escriban, o se despidió cerrando la charla, respondé enviar false.
Respondé SOLO JSON: {"enviar": true|false, "mensaje": "...", "oferta": "descripción corta de la oferta que diste", "honorarios50": true|false}

Resumen: ${e.resumen || "-"}
${e.historial.slice(-12).map((h) => `${quien[h.r] || h.r}: ${String(h.t).slice(0, 220)}`).join("\n")}`);
    e.segEnviados = toca;
    if (r?.oferta) e.oferta = { texto: String(r.oferta).slice(0, 200), honorarios50: !!r.honorarios50, vence: Date.now() + 48 * 3600e3 };
    if (r && r.enviar === false) { e.sinInteres = true; await env.ESTADO.put(k.name, JSON.stringify(e), { expirationTtl: 90 * 86400 }); continue; }
    if (!r?.mensaje) continue;   // sin IA no se manda un seguimiento genérico
    const texto = sinEmojis(r.mensaje);
    for (const parte of texto.split("||").map((x) => x.trim()).filter(Boolean)) { await enviar(env, tel, parte); await dormir(1200); }
    e.historial = [...e.historial, { r: "a", t: `(seguimiento) ${texto.replace(/\|\|/g, " / ")}`.slice(0, 2000) }].slice(-60);
    await env.ESTADO.put(k.name, JSON.stringify(e), { expirationTtl: 90 * 86400 });
    await anotarResumen(env, { tipo: "seguimiento", tel, nombre: e.nombre });
    await guardarLead(env, tel, e, {});
  }
}

// ---------------- Comandos del equipo (desde el celular admin) ----------------
async function comandoAdmin(env, de, texto) {
  const [cmd, ...resto] = texto.trim().split(/\s+/);
  const arg = resto.join(" ");
  const resp = (t) => (de ? enviar(env, de, t) : t);
  const ap = JSON.parse((await env.ESTADO.get("aprendido")) || "[]");
  switch (cmd.toLowerCase()) {
    case "#aprender": ap.push(arg); await env.ESTADO.put("aprendido", JSON.stringify(ap)); return resp(`✅ Aprendido (#${ap.length}): ${arg}`);
    case "#ap": case "#aprobar": {
      const ids = arg === "todo" ? (await env.ESTADO.list({ prefix: "prop:" })).keys.map((k) => k.name.slice(5)) : [arg];
      const ok2 = [];
      for (const id of ids) { const x = await env.ESTADO.get(`prop:${id}`); if (x) { ap.push(x); ok2.push(x); await env.ESTADO.delete(`prop:${id}`); } }
      if (!ok2.length) return resp("No encontré esa propuesta (¿ya la respondiste?).");
      await env.ESTADO.put("aprendido", JSON.stringify(ap.slice(-APRENDIZAJE.maxReglas)));
      return resp(`✅ Aprendido:\n${ok2.map((x) => "• " + x).join("\n")}`);
    }
    case "#pago": {
      const [idp, res] = arg.split(/\s+/);
      const pg = JSON.parse((await env.ESTADO.get(`pago:${idp}`)) || "null");
      if (!pg) return resp("No encontré ese comprobante (¿ya lo respondiste?).");
      await env.ESTADO.delete(`pago:${idp}`);
      await cerrarTareas(env, { ref: idp });
      const ec = JSON.parse((await env.ESTADO.get(`v3:${pg.para}`)) || "null") || { historial: [] };
      if (/^(ok|si|sí|entro|entró)$/i.test(res || "ok")) {
        const t = "listo, ya nos impacto el pago, gracias!||tu pedido quedo confirmado y te vamos avisando cada etapa hasta que te llegue";
        for (const parte of t.split("||")) await enviar(env, pg.para, parte);
        ec.historial = [...(ec.historial || []), { r: "a", t: t.replace("||", " / ") }].slice(-60);
        ec.etapa = "pagado"; ec.pagado = new Date().toISOString();
        await env.ESTADO.put(`v3:${pg.para}`, JSON.stringify(ec), { expirationTtl: 90 * 86400 });
        await guardarLead(env, pg.para, ec, { lead: { etapa: "cliente", temperatura: "caliente", puntaje: 10 }, resumen_cliente: `${ec.resumen || ""} | PAGÓ ${pg.monto ?? ""}`.slice(0, 300) });
        await evento(env, "venta", pg.para, pg.monto ?? "");
        return resp(`✅ Pago confirmado a ${pg.nombre || "+" + pg.para}. Ya le avisé y quedó como cliente en la planilla.`);
      }
      await enviar(env, pg.para, "todavia no nos figura el pago||me reenvias el comprobante o te fijas si salio bien la transferencia?");
      return resp(`❌ Le avisé a ${pg.nombre || "+" + pg.para} que todavía no figura el pago.`);
    }
    case "#espejo": { const si = /^(si|sí|on)$/i.test(arg); await env.ESTADO.put("espejo", si ? "si" : "no"); return resp(si ? "👁 Modo espejo activado: te copio acá cada charla del agente.\nPanel en vivo: " + `${env.PUBLIC_URL || BASE_URL}/panel` + "\nPara apagarlo: #espejo no" : "Modo espejo apagado."); }
    case "#panel": return resp(`Panel en vivo: ${env.PUBLIC_URL || BASE_URL}/panel`);
    case "#bien": {
      const t = arg.replace(/\D/g, "");
      const ec = JSON.parse((await env.ESTADO.get(`v3:${t}`)) || "null");
      if (ec) { ec.salud = "ok"; ec.saludMotivo = "revisado por el equipo"; await env.ESTADO.put(`v3:${t}`, JSON.stringify(ec), { expirationTtl: 90 * 86400 }); await guardarLead(env, t, ec, {}); }
      return resp(`👍 Listo, el agente sigue con +${t}.`);
    }
    case "#rech": { await env.ESTADO.delete(`prop:${arg}`); return resp("👌 Descartada."); }
    case "#propuestas": {
      const ks = (await env.ESTADO.list({ prefix: "prop:" })).keys;
      if (!ks.length) return resp("No hay propuestas pendientes.");
      const ls = []; for (const k of ks) ls.push(`${k.name.slice(5)}: ${await env.ESTADO.get(k.name)}`);
      return resp(`Propuestas pendientes:\n${ls.join("\n")}\n\n#ap ID para aprobar una, #ap todo para todas, #rech ID para descartar`);
    }
    case "#autoaprender": { const si = /^(si|sí|on|auto)$/i.test(arg); await env.ESTADO.put("autoaprender", si ? "si" : "no"); return resp(si ? "🤖 Aprendo solo: agrego las reglas sin preguntarte y te aviso cuáles (las podés borrar con #olvidar)." : "✋ Te consulto cada regla antes de aprenderla."); }
    case "#revisar": { await resp("🧠 Revisando los chats de las últimas 24 h, dame un minuto..."); await autoaprender(env, true); return; }
    case "#saber": return resp(ap.length ? "📚 Lo que sé:\n" + ap.map((a, i) => `${i + 1}. ${a}`).join("\n") : "Todavía no aprendí nada. Usá #aprender ...");
    case "#olvidar": { const i = parseInt(arg) - 1; const x = ap.splice(i, 1); await env.ESTADO.put("aprendido", JSON.stringify(ap)); return resp(x.length ? `🗑️ Olvidé: ${x[0]}` : "No encontré ese número."); }
    case "#ok": case "#no": {
      const idc = arg || (await env.ESTADO.get("pend:ultimo")) || "";
      const p = JSON.parse((await env.ESTADO.get(`pend:${idc}`)) || "null");
      if (!p) return resp("No encontré esa cotización (¿ya se envió?).");
      await env.ESTADO.delete(`pend:${idc}`);
      await cerrarTareas(env, { ref: idc });
      if ((await env.ESTADO.get("pend:ultimo")) === idc) await env.ESTADO.delete("pend:ultimo");
      if (cmd.toLowerCase() === "#no") return resp(`❌ Cotización ${idc} descartada. Respondele vos al +${p.para}.`);
      for (const t of p.textos) await enviar(env, p.para, t);
      await evento(env, "cotizacion", p.para, "china");
      await programarSeguimiento(env, p.para, "cotizacion");
      const ec = JSON.parse((await env.ESTADO.get(`v3:${p.para}`)) || "null");
      if (ec) { ec.historial = [...(ec.historial || []), ...p.textos.map((t) => ({ r: "a", t: t.slice(0, 2000) }))].slice(-60); await env.ESTADO.put(`v3:${p.para}`, JSON.stringify(ec), { expirationTtl: 90 * 86400 }); }
      return resp(`📤 Enviada a +${p.para}`);
    }
    case "#modo": await env.ESTADO.put("modo", arg === "auto" ? "auto" : "aprobacion"); return resp(`Modo: ${arg === "auto" ? "automático 🤖 (envía solo)" : "aprobación ✋ (te consulto antes de enviar)"}`);
    case "#pausa": {
      const [tel, hs] = arg.split(/\s+/);
      const horas = num(hs) || 24;
      await env.ESTADO.put(`pausa:${tel.replace(/\D/g, "")}`, "1", { expirationTtl: Math.round(horas * 3600) });
      await env.ESTADO.delete(`seg:${tel.replace(/\D/g, "")}`);
      return resp(`⏸️ Pausado ${horas} h: +${tel}. Lo atendés vos.\nPara devolvérselo al agente: #reanudar ${tel} (podés agregar una nota de cómo quedó)`);
    }
    case "#reanudar": {
      const [tel, ...nota] = arg.split(/\s+/);
      const t = tel.replace(/\D/g, "");
      await env.ESTADO.delete(`pausa:${t}`);
      if (nota.length) {
        const ec = JSON.parse((await env.ESTADO.get(`v3:${t}`)) || "null") || { historial: [] };
        ec.nota = nota.join(" ");
        ec.historial = [...(ec.historial || []), { r: "h", n: true, t: `(nota interna) ${nota.join(" ")}` }].slice(-60);
        await env.ESTADO.put(`v3:${t}`, JSON.stringify(ec), { expirationTtl: 90 * 86400 });
      }
      const res = await retomar(env, t).catch((err) => "error: " + err);
      return resp(`▶️ El agente retoma con +${t}${nota.length ? " con tu nota" : ""}: ${res}.`);
    }
    case "#reset": case "#reiniciar": {
      const objetivo = arg.replace(/\D/g, "") || de;
      for (const k of [`v3:${objetivo}`, `lock:${objetivo}`, `seg:${objetivo}`]) await env.ESTADO.delete(k);
      return resp(`🧹 Historial y estado reiniciados para +${objetivo}.`);
    }
    default: return resp("Comandos: #reset [NUM] · #aprender texto · #saber · #olvidar N · #revisar · #propuestas · #ap ID|todo · #autoaprender si|no · #pago ID ok|no · #espejo si|no · #panel · #ok ID · #no ID · #modo auto|aprobacion · #pausa NUM · #reanudar NUM");
  }
}

// ---------------- Seguimientos y leads ----------------
async function programarSeguimiento(env, para, tipo, horas) {
  if (tipo === "cotizacion" || tipo === "catalogo") return;   // ahora los cubre el seguimiento automático personalizado
  const h = horas ?? SEGUIMIENTO[tipo]?.horas ?? 1;
  await env.ESTADO.put(`seg:${para}`, JSON.stringify({ tipo, cuando: Date.now() + h * 3600e3 }), { expirationTtl: 3 * 86400 });
}
async function guardarLead(env, de, e, r, ultimoTexto) {
  const k = `lead:${de}`;
  const l = JSON.parse((await env.ESTADO.get(k)) || "null") || { telefono: de, primer_contacto: new Date().toISOString() };
  r = r || {};
  const interesAntes = l.interes;
  Object.assign(l, Object.fromEntries(Object.entries(r.lead || {}).filter(([, v]) => v)));
  Object.assign(l, Object.fromEntries(Object.entries(r.datos_cliente || {}).filter(([, v]) => v)));
  if (l.interes && l.interes !== interesAntes) await evento(env, "interes", de, String(l.interes).toLowerCase().slice(0, 60));
  l.nombre_whatsapp = e.nombre || l.nombre_whatsapp;
  l.productos = (e.listos || []).map((p) => `${p.nombre} x${p.cantidad}`).join(" | ") || l.productos;
  l.ultimo_contacto = new Date().toISOString();
  l.mensajes = (l.mensajes || 0) + 1;
  if (r.resumen_cliente) l.resumen = r.resumen_cliente;
  const ultC = ultimoTexto || [...(e.historial || [])].reverse().find((h) => h.r === "c")?.t;
  if (ultC) l.ultimo_mensaje = String(ultC).slice(0, 200);
  l.estado_agente = (await env.ESTADO.get(`pausa:${de}`)) ? "pausado" : "activo";
  l.salud = e.salud || "ok";
  l.motivo_salud = e.saludMotivo || "";
  l.seguimientos = e.segEnviados || 0;
  l.chat = `${env.PUBLIC_URL || BASE_URL}/panel?tel=${de}`;
  if (env.DB) { try { await prepararTablas(env); const ts = (await env.DB.prepare("SELECT titulo FROM tareas WHERE tel = ? AND estado = 'abierta'").bind(de).all()).results || []; l.pendiente = ts.map((x) => x.titulo).join(" | ") || "-"; } catch {} }
  await env.ESTADO.put(k, JSON.stringify(l));
  await enviarASheets(env, l);
}
// Copia el lead a Google Sheets (variable SHEETS_URL)
async function enviarASheets(env, l) {
  if (!env.SHEETS_URL) return;
  try {
    const rs = await fetch(`${env.SHEETS_URL}?clave=${encodeURIComponent(env.VERIFY_TOKEN)}`, { method: "POST", body: JSON.stringify(l), redirect: "follow" });
    console.log("Sheets:", rs.status, (await rs.text()).slice(0, 60), "|", l.telefono);
  } catch (err) { console.log("Sheets falló:", String(err).slice(0, 120)); }
}
async function exportarLeads(env) {
  const cols = ["telefono", "nombre_whatsapp", "temperatura", "puntaje", "nombre_apellido", "perfil", "calidad", "etapa", "estado_agente", "ultimo_mensaje", "chat", "presupuesto", "rubro", "interes", "productos", "dni", "email", "envio", "direccion", "mensajes", "primer_contacto", "ultimo_contacto", "resumen", "salud", "motivo_salud", "seguimientos"];
  const filas = [cols.join(";")];
  let cursor;
  do {
    const lst = await env.ESTADO.list({ prefix: "lead:", cursor });
    for (const k of lst.keys) {
      const l = JSON.parse((await env.ESTADO.get(k.name)) || "{}");
      filas.push(cols.map((c) => `"${String(l[c] ?? "").replace(/"/g, "'")}"`).join(";"));
    }
    cursor = lst.list_complete ? null : lst.cursor;
  } while (cursor);
  return "\uFEFF" + filas.join("\n");
}

// ---------------- Conversación ----------------
const SALUDO = /^(hola|buenas|buen d[ií]a|buenas tardes|buenas noches|hey|holi)\b/i;
// Texto automático del link wa.me de Instagram/TikTok
const MENSAJE_LINK = /vi un video tuyo y quiero importar un producto\.?/gi;

const histC2 = (e) => e.historial.filter((h) => h.r === "c").slice(-3).map((h) => h.t).join(" ");
// ---- Red de seguridad sobre lo que escribe la IA (errores reales vistos en los chats) ----
const PROFORMA = /proforma|packing ?list|pack ?list|packlist|factura comercial|\binvoice\b|lista de (productos|precios) del proveedor/i;
async function corregirRespuesta(env, de, e, texto, r) {
  let t = String(r.respuesta || "");
  const histC = e.historial.filter((h) => h.r === "c").slice(-8).map((h) => h.t).join(" ");
  // 1) Dice que armó / va a mandar un combo sin listarlo (Leonn): se arma de verdad o se pide el presupuesto
  if (!r.armar_combo && /(arm[eéo]|gener[oó]|prepar[oé]|te paso|te mando|te detallo).{0,40}combo|combo.{0,30}(con lo mejor|que armamos|incluye)|te (mando|paso|detallo) (las opciones|los productos|el detalle)/i.test(t) && !/https?:/.test(t)) {
    const presu = presupuestoEnTexto(texto) || presupuestoEnTexto(histC);
    if (presu) r.armar_combo = { rubro: null, presupuesto: presu, preferencia: "surtido", elegidos: [] };
    else t = "dale, te lo armo con productos y cantidades||con que presupuesto contas mas o menos?";
  }
  // 2) Promete "te paso el link / catálogo / opciones / foto" y no lo manda (Juanch, Libreriatomi, Dylan)
  if (/te (paso|mando|env[ií]o|dejo|muestro|comparto)\b.{0,35}(link|cat[aá]logo|opciones|fotos?|modelos|lo que m[aá]s sale|lo que hay)/i.test(t) && !/https?:/.test(t)) {
    if (/grupo/i.test(t)) t = t.replace(/,?\s*dame un (segundo|minuto)[^|/]*/i, "") + "||" + NEGOCIO.grupoMayorista;
    else t = t.replace(/te paso la foto[^|/]*/i, "las fotos las ves en la web") + `||${WEB}/catalogo`;
  }
  t = t.replace(/,?\s*dame un (segundo|minutito|minuto) que (lo|la|te lo) busco/gi, "");
  // 3) Nunca adelanta montos mientras hay una cotización esperando aprobación (Lucas)
  if (/(usd|u\$s|us\$|d[oó]lares)\s*\d|\d[\d.,]*\s*(usd|d[oó]lares)/i.test(t) && (await hayTarea(env, de, "cotizacion"))) t = "ya casi la tengo||apenas este lista te paso la cotizacion completa por aca";
  return t;
}

async function procesar(env, de, msg, nombre) {
  if (msg.type === "audio" && !(await env.ESTADO.get(`pausa:${de}`))) {
    const t = await transcribir(env, msg.audio.id).catch(() => null);
    if (!t) { await enviar(env, de, "no llego a escuchar bien el audio, me lo escribis?"); return; }
    msg = { type: "text", text: { body: t }, audio: true };
  }
  const texto = (msg.text?.body || msg.image?.caption || (msg.type === "audio" ? "(audio)" : "")).trim();

  // #reset para pruebas (cualquier número)
  if (/^#(reset|reiniciar|borrar|limpiar)\b/i.test(texto) && !/\d{6,}/.test(texto)) {
    for (const k of [`v3:${de}`, `seg:${de}`, `lock:${de}`, `pausa:${de}`]) await env.ESTADO.delete(k);
    await enviar(env, de, "🧹 ¡Listo! Chat y memoria reiniciados de cero. Escribime lo que quieras cotizar 🙌");
    return;
  }
  if (esAdmin(env, de)) await entregarAlertas(env, de);
  if (esAdmin(env, de) && /^(ok|enviar|mandala)$/i.test(texto) && (await env.ESTADO.get("pend:ultimo"))) return comandoAdmin(env, de, "#ok");
  if (esAdmin(env, de) && texto.startsWith("#")) return comandoAdmin(env, de, texto);
  if (await env.ESTADO.get(`pausa:${de}`)) {
    // Pausado: no responde, pero guarda lo que dice el cliente para retomar con contexto
    const ep = JSON.parse((await env.ESTADO.get(`v3:${de}`)) || "null") || { historial: [] };
    ep.historial = [...(ep.historial || []), { r: "c", t: (msg.audio ? "(audio) " : "") + (texto || "(imagen)"), ...(msg.type === "image" ? { img: [msg.image.id, ...(msg.image.extras || [])] } : {}) }].slice(-60);
    ep.ultimoMensaje = Date.now();
    await env.ESTADO.put(`v3:${de}`, JSON.stringify(ep), { expirationTtl: 90 * 86400 });
    await anotarResumen(env, { tipo: "pausado", tel: de, nombre: ep.nombre, texto: texto || "(imagen)" });
    await guardarLead(env, de, ep, { lead: {} }, texto);
    return;
  }
  await env.ESTADO.delete(`seg:${de}`);

  const clave = `v3:${de}`;
  const e = JSON.parse((await env.ESTADO.get(clave)) || "null") || {};
  if (!Array.isArray(e.historial)) e.historial = [];
  e.nombre = e.nombre || nombre;
  e.actual = e.actual || {};
  const guardar = () => env.ESTADO.put(clave, JSON.stringify(e), { expirationTtl: 90 * 86400 });
  const decir = async (t) => {
    const partes = sinEmojis(variarMuletilla(t)).split("||").map((x) => x.trim()).filter(Boolean);
    let wid = null;
    for (let i = 0; i < partes.length; i++) {
      // "escribiendo..." antes de cada mensaje, con una pausa proporcional al largo (como una persona)
      if (msg.id) await leidoYEscribiendo(env, msg.id);
      await new Promise((ok) => setTimeout(ok, (i ? 1400 : 900) + Math.min(partes[i].length * 22, i ? 2600 : 1500)));   // tiempo de "tipeo" según el largo
      const id = await enviar(env, de, partes[i]);
      if (typeof id === "string") wid = id;
    }
    e.historial.push({ r: "a", t: partes.join(" / ").slice(0, 2000), ...(wid ? { wid } : {}) });
    if (PROMESA.test(partes.join(" ")) && !(await hayTarea(env, de, "derivado")) && !(await hayTarea(env, de, "proveedor"))) await crearTarea(env, { tipo: "promesa", tel: de, nombre: e.nombre, titulo: "El agente prometió averiguar algo", detalle: partes.join(" / ").slice(0, 500) });
  };

  if (/^(cancelar|otro producto|otra cosa|empezar de nuevo|dejemos ese|olvidate)[\s!.,]*$/i.test(texto)) {
    e.actual = {}; e.cantidad = null; e.ofrecido = null; e.combo = null;
    await decir("dale, dejamos ese||que otro producto queres cotizar?");
    return guardar();
  }

  const nuevo = e.historial.length === 0;
  // Cada mensaje nuevo del cliente reinicia los seguimientos
  e.segEnviados = 0;
  // Señal de alarma: el cliente reclama o repite (suele ser culpa del agente, no del cliente)
  if (msg.type === "text" && RECLAMO.test(texto)) await alertaRiesgo(env, de, e, `el cliente parece frustrado: "${texto.slice(0, 120)}"`);
  e.pideHumano = msg.type === "text" && PIDE_HUMANO.test(texto);
  e.esVaper = msg.type === "text" && ES_VAPER.test(texto) && !NO_VAPER.test(texto);
  if (msg.type === "text" && /no me escrib|dej[aá] de escribir|no me molest|no me interesa(?! saber)|bajame|sacame de/i.test(texto)) { e.sinInteres = true; e.baja = Date.now(); }
  await anotarResumen(env, { tipo: nuevo ? "nuevo" : "mensaje", tel: de, nombre: e.nombre });
  if (nuevo) { await anotarResumen(env, { tipo: "mensaje", tel: de, nombre: e.nombre }); await evento(env, "nuevo", de); }
  e.historial.push({ r: "c", t: (msg.audio ? "(audio) " : "") + (texto || "(imagen)"), ...(msg.type === "image" ? { img: [msg.image.id, ...(msg.image.extras || [])] } : {}) });
  e.historial = e.historial.slice(-60);
  const ultimoAnterior = e.ultimoMensaje;
  e.ultimoMensaje = Date.now();
  if (e.esVaper) { e.esVaper = false; await derivarVaper(env, de, e, decir); await guardarLead(env, de, e, { lead: { etapa: "derivado", interes: "vapers" } }); return guardar(); }
  // Pide el grupo de WhatsApp: se pasa el link directo (antes prometía buscarlo y derivaba)
  if (msg.type === "text" && /\bgrupo\b/i.test(texto) && /whats|sum|entr|un[ií]|link|pas|quiero|agreg|meter/i.test(texto) && texto.length < 120) {
    await decir(NEGOCIO.opcion4(NEGOCIO.grupoMayorista));
    await guardarLead(env, de, e, { lead: { interes: "grupo mayorista" } });
    return guardar();
  }

  // ¿Es solo un saludo (o el texto automático del link de Instagram/TikTok) sin ninguna consulta concreta?
  const sinRelleno = texto.replace(MENSAJE_LINK, " ").replace(/\b(buenas tardes|buenas noches|buen d[ií]a|buenos d[ií]as|hola+|buenas+|holis?|hey|qu[eé] tal|qu[eé] onda|c[oó]mo (va|andas|est[aá]s)|todo bien)\b/gi, " ").replace(/[\s!?.,¿¡]+/g, "");
  // Intención genérica sin producto ("quiero importar", "quiero traer un producto", "una consulta"): también va el menú
  const sinGenerico = sinRelleno.length && sinRelleno.length < 70 ? texto.replace(MENSAJE_LINK, " ").replace(/\b(buenas tardes|buenas noches|buen d[ií]a|buenos d[ií]as|hola+|buenas+|holis?|hey|qu[eé] tal|qu[eé] onda|c[oó]mo (va|andas|est[aá]s)|todo bien|como va|gracias)\b/gi, " ")
    .replace(/\b(te|les?) (hago|queria hacer|quer[ií]a hacer) una consulta\b|\buna consulta\b|\bconsulta\b|\binfo(rmaci[oó]n)?\b|\b(yo )?(quiero|quisiera|quer[ií]a|me gustar[ií]a|necesito|busco|estoy (buscando|queriendo|pensando en))( poder)? (importar|traer|comprar)( (un|una|unos|unas|algo|algunos?|algunas?|productos?|cosas|mercader[ií]a|de china|desde china|de afuera|del exterior|para revender|para vender|por mayor|al por mayor))*\b|\bc[oó]mo (es|funciona|trabajan)( para importar| el tema)?\b|\bimportan\b|\bc[oó]mo (hago|puedo) (para )?importar\b/gi, " ").replace(/[\s!?.,¿¡]+/g, "") : "x";
  const saludoPuro = msg.type === "text" && (sinRelleno.length === 0 || sinGenerico.length === 0);   // saludo o texto del link de IG sin consulta: va el menú
  const inactivo = !ultimoAnterior || Date.now() - ultimoAnterior > 12 * 3600e3;
  const casoAbierto = (e.derivado && Date.now() - Date.parse(e.derivado.cuando) < 3 * 86400e3) || e.actual?.nombre || (e.combo && e.combo.paso !== "armado") || Object.keys(e.listos || {}).length && !inactivo;
  // Menú: solo cuando no dijo qué busca. Si ya preguntó algo concreto, la IA le responde directo (saludando)
  if (saludoPuro && (nuevo || (inactivo && !casoAbierto))) {
    e.etapa = "menu";
    await enviarMenu(env, de, e.nombre?.split(" ")[0]);
    e.historial.push({ r: "a", t: "(menú: 1 importar, 2 combo, 3 catálogo, 4 grupo)" });
    await guardarLead(env, de, e, { lead: { etapa: "consulta" } });
    return guardar();
  }
  if ((e.etapa === "menu" || msg.deMenu) && /^[1-4]$/.test(texto)) {
    const o = { 1: NEGOCIO.opcion1(), 2: NEGOCIO.opcion2(), 3: NEGOCIO.opcion3(NEGOCIO.catalogo), 4: NEGOCIO.opcion4(NEGOCIO.grupoMayorista) }[texto];
    e.etapa = "libre"; await decir(o);
    e.combo = texto === "2" ? { paso: "presupuesto" } : null;
    if (texto === "3") await programarSeguimiento(env, de, "catalogo");
    await guardarLead(env, de, e, { lead: { interes: { 1: "importar", 2: "combo", 3: "catálogo", 4: "grupo mayorista" }[texto] } });
    return guardar();
  }
  e.etapa = "libre";

  // Flujo de combo (sin IA mientras responde lo que se le pregunta)
  if (e.combo && msg.type === "text" && !/https?:/.test(texto)) {
    const hecho = await flujoCombo(env, de, e, texto, decir);
    if (hecho !== null) {
      await guardarLead(env, de, e, { lead: { rubro: e.combo.rubro, presupuesto: e.combo.presupuesto ? pesos(e.combo.presupuesto) : null, interes: "combo" } });
      return guardar();
    }
  }

  const img = msg.type === "image" ? await bajarImagen(env, msg.image.id) : null;
  if (img && msg.image.extras?.length) img.extras = (await Promise.all(msg.image.extras.map((id) => bajarImagen(env, id).catch(() => null)))).filter(Boolean);
  const link = (texto.match(/https?:\/\/\S+/i) || [])[0];
  const sinLink = texto.replace(link || "", "");
  const pag = link && /alibaba\.com/i.test(link) ? await leerPagina(link) : null;

  // ---- Datos que se pueden leer SIN IA ----
  const pesoEscrito = pesoEnTexto(sinLink);
  const sinPeso = sinLink.replace(/(\d+(?:[.,]\d+)?\s*(?:-|a|y)\s*)?\d+(?:[.,]\d+)?\s*(kg|kgs|kilo|kilos|g|gr|grs|gramos)\b/gi, " ").replace(/(?:us\$|u\$s|usd|\$)\s*\d+(?:[.,]\d+)?(?:\s*(?:-|a|hasta)\s*(?:us\$|u\$s|usd|\$)?\s*\d+(?:[.,]\d+)?)?/gi, " ");   // el peso y los precios no son cantidades
  const numeros = (sinPeso.match(/\d[\d.,]*/g) || []).map(num).filter(Boolean);
  // Si estábamos esperando el peso y escribe un número decimal suelto ("1,5"), es el peso
  const pesoSuelto = !pesoEscrito && e.esperaPeso && numeros.length === 1 && !Number.isInteger(numeros[0]) ? numeros[0] : null;
  const pesoTexto = pesoEscrito || pesoSuelto;
  const enteros = numeros.filter((n) => Number.isInteger(n) && n >= 1 && n < 1e6 && !(pesoEscrito && n === Math.round(pesoEscrito)));
  const cantidadTexto = pesoSuelto ? null : enteros[0] || null;

  // Link nuevo = producto nuevo
  if (link && pag) { e.actual = {}; e.cantidad = null; e.ofrecido = null; e.pidioPeso = 0; e.pidioCaptura = 0; }
  if (pag?.bloqueado) {
    e.actual = { nombre: pag.datos.nombre, tramos: [], peso_kg: null, link };
    if (cantidadTexto) e.cantidad = cantidadTexto;
    await decir(NEGOCIO.guiaAlibaba(pag.datos.nombre));
    await guardarLead(env, de, e, { lead: { etapa: "consulta", interes: pag.datos.nombre } });
    return guardar();
  }

  // ¿Hace falta la IA? Solo si hay imagen, link sin datos completos, o una conversación que no es solo números
  const soloDatos = msg.type === "text" && !link && (e.actual.nombre || e.actual.tramos?.length) && (pesoTexto || cantidadTexto) && sinLink.replace(/[\d.,\s]|kg|kgs|kilos?|gr?s?|gramos|unidades|unid|u\b|pcs|piezas|quiero|necesito|son|pesa|peso|de|cada|una?|aprox/gi, "").length < 4;
  const tieneTodoPagina = pag?.datos?.tramos?.length && pag.datos.peso_kg;
  let r = null;
  if (tieneTodoPagina) r = { producto: { ...pag.datos, link }, lead: { etapa: "cotizado", interes: pag.datos.nombre } };
  else if (!soloDatos) r = await cerebro(env, e, texto, img, pag?.texto, { primerContacto: nuevo || (inactivo && !casoAbierto), catalogoRelevante: await catalogoParaIA(env, texto, e.historial.filter((h) => h.r === "c").slice(-8).map((h) => h.t).join(" ")) });
  else r = {};
  if (!r) {
    await decir("dame un minutito que lo reviso y te escribo");
    await alertaRiesgo(env, de, e, `la IA no respondió. Último mensaje: ${texto || "(imagen)"}`, true);
    return guardar();
  }
  if (r.respuesta) r.respuesta = await corregirRespuesta(env, de, e, texto, r);
  // ---- Comprobante de pago ----
  if (img && r.comprobante) {
    const id = id4(), cp = r.comprobante;
    await env.ESTADO.put(`pago:${id}`, JSON.stringify({ para: de, nombre: e.nombre, monto: cp.monto, destino: cp.destino, fecha: cp.fecha }), { expirationTtl: 7 * 86400 });
    await decir(r.respuesta || "genial, gracias||ya lo verificamos y te confirmo enseguida");
    const detalle = `💸 COMPROBANTE ${id} | +${de} (${e.nombre || ""})\nMonto: ${cp.monto ?? "?"} | Destino: ${cp.destino || "?"} | Fecha: ${cp.fecha || "?"}\nPedido: ${e.combo?.items ? listaCombo(e.combo.items) : (e.listos || []).map((x) => x.nombre + " x" + x.cantidad).join(", ") || e.resumen || "-"}`;
    await crearTarea(env, { tipo: "comprobante", tel: de, nombre: e.nombre, ref: id, titulo: `Comprobante de pago${cp.monto ? " por " + cp.monto : ""}`, detalle, datos: { foto: msg.image.id } });
    await avisoCorto(env, `Fijate que te dejé un comprobante de pago para confirmar (${e.nombre || "+" + de}). Panel > Pendientes`);
    e.etapa = "pago_informado";
    if (r.resumen_cliente) e.resumen = r.resumen_cliente;
    await guardarLead(env, de, e, { ...r, lead: { ...(r.lead || {}), etapa: "cierre", temperatura: "caliente", puntaje: 10 } });
    return guardar();
  }

  // ---- Lista mayorista de zapatillas ----
  if (r.enviar_lista_zapatillas && !r.armar_combo) {
    const [intro, ...resto] = String(r.respuesta || "te paso la lista mayorista que manejamos||cual modelo te interesa? decime talles y cuantos pares").split("||");
    await decir(intro);
    await leidoYEscribiendo(env, msg.id); await dormir(1500);
    await enviar(env, de, NEGOCIO.listaZapatillas);
    e.historial.push({ r: "a", t: "(lista mayorista de zapatillas)" });
    if (resto.length) { await dormir(1200); await decir(resto.join("||")); }
    e.listaZapatillas = Date.now(); e.actual = {}; e.cantidad = null;
    if (r.resumen_cliente) e.resumen = r.resumen_cliente;
    await guardarLead(env, de, e, { ...r, lead: { ...(r.lead || {}), rubro: "Zapatillas", interes: "zapatillas" } });
    return guardar();
  }

  // ---- Combo armado directo (cualquier rubro) apenas se sabe rubro + presupuesto ----
  const pideRearmar = /\b(arm[aá](me|lo)?|otro combo|nuevo combo|cambi[aá](lo|me)?|rearm|surtido|presupuesto|lucas|\d{3}\.?\d{3}|\d+\s*k\b|mil)\b/i.test(texto);
  const ac = e.combo?.paso === "armado" && !pideRearmar ? null : r.armar_combo;
  const presuAC = ac && (num(ac.presupuesto) >= 1000 ? num(ac.presupuesto) : presupuestoEnTexto(String(ac.presupuesto || "")));
  if (ac && presuAC) {
    const lista = await catalogo(env);
    const rub = RUBROS[ac.rubro] ? ac.rubro : null;
    const deRub = lista.filter((p) => (rub ? RUBROS[rub] : Object.values(RUBROS).flat()).includes(p.cat));
    const nombres = new Set((ac.elegidos || []).map((x) => normal(x).trim()));
    const elegidos = deRub.filter((p) => nombres.has(normal(p.nombre).trim()));
    const histC = e.historial.filter((h) => h.r === "c").slice(-8).map((h) => h.t).join(" ");
    const pidioSurtido = /surtid|variad|de todo|lo que (sea|mas salga|m[aá]s se venda|tengan)|cualquier|vender f[aá]cil|lo que salga/i.test(`${ac.preferencia || ""} ${texto} ${histC}`);
    let base = elegidos.length >= 2 ? elegidos : [];
    if (!base.length && ac.preferencia) {
      const ws = normal(ac.preferencia).split(/\s+/).filter((w) => w.length > 3).map((w) => w.replace(/(es|s)$/, ""));
      base = deRub.filter((p) => ws.some((w) => normal(`${p.cat} ${p.nombre}`).includes(w)));
      if (base.length < 2) base = pidioSurtido ? deRub : [];
    }
    if (!base.length && (rub || pidioSurtido)) base = deRub;
    const items = base.length ? armarCombo(base, presuAC) : [];
    if (!items.length && r.respuesta) { await decir(r.respuesta); if (r.resumen_cliente) e.resumen = r.resumen_cliente; await guardarLead(env, de, e, r); return guardar(); }
    if (items.length) {
      e.combo = { paso: "armado", rubro: rub, presupuesto: presuAC, items, preferencia: ac.preferencia || null, avisado: true };
      await evento(env, "cotizacion", de, `combo|${rub || "surtido"}`);
      await decir(`${ok()}, con ${pesos(presuAC)} te armo esto${ac.preferencia ? " de " + String(ac.preferencia).toLowerCase() : ""}:||${listaCombo(items)}||lo ajustamos como quieras, sacamos o sumamos lo que necesites`);
      if (r.resumen_cliente) e.resumen = r.resumen_cliente;
      await guardarLead(env, de, e, { ...r, lead: { ...(r.lead || {}), rubro: rub, presupuesto: pesos(presuAC), interes: ac.preferencia || "combo", etapa: "cotizado" } });
      return guardar();
    }
    await decir(`con ${pesos(presuAC)} no llego a armar un combo de ${(ac.preferencia || rub || "eso").toLowerCase()}||queres que lo armemos con otro rubro o subimos un poco el presupuesto?`);
    return guardar();
  }
  if (pag?.datos && !tieneTodoPagina) r.producto = { ...(r.producto || {}), ...Object.fromEntries(Object.entries(pag.datos).filter(([, v]) => v && (!Array.isArray(v) || v.length))) };

  // ---- Combinar datos del producto: SOLO imágenes y links pueden traer precios/nombre ----
  const p = r.producto || {};
  const traeProducto = !!(link || (img && (r.es_proveedor === true || e.actual.tramos?.length)));   // foto suelta de producto: responde la IA
  if (traeProducto) {
    let tr = (img && !link && r.es_proveedor !== true ? [] : p.tramos || []).map((t) => ({ desde: num(t.desde), precio: num(t.precio) })).filter((t) => t.desde && t.precio);
    // Red de seguridad: números con miles en pesos que la IA marcó como USD (ej. 28.792 por un palet)
    let moneda = String(p.moneda || "USD").toUpperCase();
    if (/USD/.test(moneda) && tr.some((t) => t.precio >= 2000) && /ars|\$\s?\d{1,3}\.\d{3}|mercadolibre|pesos/i.test(`${texto} ${pag?.texto || ""}`)) moneda = "ARS";
    if (tr.length && !/USD/.test(moneda)) {
      const conv = await Promise.all(tr.map(async (t) => ({ desde: t.desde, precio: Math.round((await aDolares(env, t.precio, moneda)).usd * 100) / 100 })));
      e.origenPrecio = (await aDolares(env, tr[0].precio, moneda)).nota;
      console.log("Conversión", moneda, "→ USD", JSON.stringify(conv));
      tr = conv;
    } else if (tr.length) e.origenPrecio = "";
    if (img && p.nombre && e.actual.nombre && tr.length && e.actual.tramos?.length && p.nombre !== e.actual.nombre) {
      // Captura de precios de OTRO producto: empieza de cero
      e.actual = {}; e.cantidad = null;
    }
    e.actual = {
      nombre: e.actual.nombre || p.nombre || null,
      tramos: tr.length ? tr : e.actual.tramos || [],
      peso_kg: num(p.peso_kg) || e.actual.peso_kg || null,   // el peso leído de la foto se usa directo (la cotización la revisa el equipo antes de mandarla)
      pesoFoto: !!(img && num(p.peso_kg) && !e.actual.peso_kg) || e.actual.pesoFoto || false,
      link: link || e.actual.link || null,
    };
  } else if (!e.actual.tramos?.length && num(p.tramos?.[0]?.precio)) {
    // Escribió los precios a mano (ej. "2,28 desde 100")
    e.actual.tramos = p.tramos.map((t) => ({ desde: num(t.desde), precio: num(t.precio) })).filter((t) => t.desde && t.precio);
    e.actual.nombre = e.actual.nombre || p.nombre || null;
  }

  if (pesoTexto) { e.actual.peso_kg = pesoTexto; e.pesoSugerido = null; }
  // Confirma el peso que el agente creyó ver en la captura ("si", "correcto", "ese")
  const confirmaPeso = !pesoTexto && e.esperaPeso && e.pesoSugerido && /^(s[ií]|correcto|exacto|as[ií] es|ese|esa|dale|ok|confirmo|tal cual)\b/i.test(texto.trim());
  if (confirmaPeso) { e.actual.peso_kg = e.pesoSugerido; e.pesoSugerido = null; }
  if (e.actual.nombre && !(e.actual.tramos || []).length) {
    const pm = sinLink.match(/(?:us\$|u\$s|usd|\$)\s*(\d+(?:[.,]\d+)?)(?:\s*(?:-|a|hasta)\s*(?:us\$|u\$s|usd|\$)?\s*(\d+(?:[.,]\d+)?))?/i) || sinLink.match(/(\d+(?:[.,]\d+)?)\s*(?:usd|d[oó]lares)/i);
    const p = pm ? Math.max(num(pm[1]) || 0, num(pm[2]) || 0) : 0;
    if (p > 0 && p < 100000) e.actual.tramos = [{ desde: 1, precio: p }];   // con un rango, se toma el precio alto (es el de pocas unidades)
  }
  if (num(r.peso_estimado_kg) && num(r.peso_estimado_kg) < 500) e.pesoEstimado = num(r.peso_estimado_kg);
  if (!e.actual.peso_kg && !pesoTexto && e.esperaPeso && e.pesoEstimado && e.actual.tramos?.length && (/no (s[eé]|lo s[eé]|tengo|figura|dice|aparece|encuentro|encontr|sabr)|ni idea|no hay/i.test(texto) || (e.pidioPeso || 0) >= 2)) { e.actual.peso_kg = e.pesoEstimado; e.actual.estimado = true; }
  if (!traeProducto && !pesoTexto && !e.actual.peso_kg && num(p.peso_kg)) e.actual.peso_kg = num(p.peso_kg);

  // Cantidad dicha ANTES de mandar el producto ("necesitamos 15", "unas 50"): se recuerda para no volver a preguntarla
  if (cantidadTexto && !/\$|pesos|mil\b|\bk\b|presupuesto|lucas|ars/i.test(sinLink) && cantidadTexto < 100000) e.cantidadDicha = cantidadTexto;
  // ---- Cantidad: solo si la escribió en ESTE mensaje ----
  const aceptaMinimo = e.ofrecido && !cantidadTexto && /\b(s[ií]|dale|de una|ok|okey|bueno|esa|perfecto|va|avancemos|cotizame)\b/i.test(texto);
  if (aceptaMinimo) e.cantidad = e.ofrecido;
  else if (cantidadTexto && (e.actual.tramos?.length || e.actual.nombre || traeProducto)) e.cantidad = cantidadTexto;
  e.ofrecido = null;
  if (!e.cantidad && e.cantidadDicha && e.actual.nombre) e.cantidad = e.cantidadDicha;
  if (r.resumen_cliente) e.resumen = r.resumen_cliente;

  // Producto sin proveedor (foto suelta, marca, ropa, link de ML...): no se puede cotizar solo
  // Foto de ropa/calzado/camisetas sin precios de proveedor = hay que salir a buscarla (no pedir capturas de Alibaba)
  const charlaCliente = `${texto} ${r.descripcion_producto || ""} ${e.historial.filter((h) => h.r === "c").slice(-6).map((h) => h.t).join(" ")}`;
  const rubroBusqueda = /zapatill|calzado|camiset|remera|buzo|ropa|indumentaria|campera|jean|pantal|botin|nba|nfl|futbol|fútbol/i.test(charlaCliente);
  const sinPrecios = !e.actual.tramos?.length && !(p.tramos || []).some((t) => num(t.precio));
  if (pag || e.actual.tramos?.length || (img && r.es_proveedor === true)) e.busq = null;   // llegó un proveedor con precios: deja de ser búsqueda
  const necesitaBusqueda = !e.actual.tramos?.length && !pag && (!!e.busq || r.requiere_busqueda === true || (img && sinPrecios && rubroBusqueda) || (link && !/alibaba|1688|aliexpress|made-in-china/i.test(link)));

  // Deriva al equipo: avisa con todo el caso, reenvía la foto y pausa al agente con ese cliente
  const derivarCaso = async (estado, resumen, msgCliente, yaRespondio) => {
    const modoBoton = ultimos10(env.NUMERO_EQUIPO || NUMERO_EQUIPO) !== ultimos10(env.NUMERO_AGENTE || "");
    if (modoBoton) msgCliente = `${ok()}, esto lo ve el equipo directamente`;
    if (msgCliente) await decir(msgCliente);
    else if (!yaRespondio && r.respuesta) await decir(r.respuesta);
    const prod = e.listos?.length ? e.listos.map((x) => `${x.nombre} x${x.cantidad}`).join(", ") : (r.descripcion_producto || e.actual?.nombre || "-");
    const aviso = `🙋 ${String(estado).toUpperCase()} | +${de} (${e.nombre || ""})\n${resumen}\nProducto: ${prod}${e.cantidad ? " | Cantidad: " + e.cantidad : ""}${e.actual?.link || link ? "\nLink: " + (e.actual?.link || link) : ""}${e.combo?.presupuesto ? "\nPresupuesto: " + pesos(e.combo.presupuesto) : ""}\n\nAgente pausado ${DERIVACION.pausaHoras} h con este cliente. Para devolvérselo: #reanudar ${de} (con una nota de cómo quedó)`;
    // Si el agente atiende en un número distinto al del equipo, le da al cliente un botón con su caso resumido
    if (modoBoton) {
      const contexto = `Hola! Soy ${e.nombre || "cliente"} (+${de}). Vengo del asistente de Te Importamos.\n` +
        `Busco: ${prod}${e.cantidad ? " x" + e.cantidad : ""}${e.actual?.link || link ? "\nLink: " + (e.actual?.link || link) : ""}${e.combo?.presupuesto ? "\nPresupuesto: " + pesos(e.combo.presupuesto) : ""}\n` +
        `Resumen: ${(e.resumen || resumen || "").slice(0, 300)}`;
      await enviarBotonEquipo(env, de, "para seguir con esto tocá el boton y escribinos directo al equipo, ya te va a llegar el mensaje armado con tu consulta", contexto);
    }
    const foto = msg.type === "image" && msg.image?.id ? msg.image.id : e.fotoBusqueda;
    e.pidioPeso = 0;
    await cerrarTareas(env, { tel: de, tipos: ["promesa"] });
    await crearTarea(env, { tipo: estado === "busqueda_proveedor" ? "proveedor" : "derivado", tel: de, nombre: e.nombre, titulo: ({ busqueda_proveedor: "Buscar proveedor", falta_peso: "Falta el peso para cotizar", consulta: "Consulta que el agente no pudo resolver", pide_humano: "Pide hablar con una persona: escribile vos" })[estado] || `Derivado: ${estado}`, detalle: aviso.replace(/\n\nAgente pausado[\s\S]*$/, ""), datos: { foto: foto || null } });
    await avisoCorto(env, `Fijate que te dejé un chat derivado para responder (${e.nombre || "+" + de}). Panel > Pendientes`);
    await env.ESTADO.put(`pausa:${de}`, "1", { expirationTtl: DERIVACION.pausaHoras * 3600 });
    await evento(env, "derivado", de, estado);
    await env.ESTADO.delete(`seg:${de}`);
    e.derivado = { estado, producto: prod, cantidad: e.cantidad || null, resumen, cuando: new Date().toISOString() };
    await guardarLead(env, de, e, { ...r, lead: { ...(r.lead || {}), etapa: "derivado", interes: prod } });
    return guardar();
  };

  // Sin peso pero con precio y cantidad: se usa el peso estimado por la IA en lugar de volver a preguntar
  if (!e.actual.peso_kg && e.pesoEstimado && (e.actual.tramos || []).length && e.cantidad) { e.actual.peso_kg = e.pesoEstimado; e.actual.estimado = true; }
  let encontrados = [];
  const tramos = e.actual.tramos || [];
  const minimo = tramos.length ? Math.min(...tramos.map((t) => t.desde)) : 1;
  const listo = tramos.length && e.actual.peso_kg && e.cantidad;
  const noEncuentra = e.actual.nombre && !(e.actual.tramos || []).length && (e.pidioCaptura || 0) >= 1 && /no (lo |la )?(encuentro|encontr|veo|aparece|figura|s[eé]|dice)|no hay|no tiene|no me (sale|aparece)|ni idea/i.test(texto);
  const enCotizacion = traeProducto || pesoTexto || confirmaPeso || soloDatos || noEncuentra || (e.actual.nombre && (cantidadTexto || aceptaMinimo));
  e.esperaPeso = false;

  // Pide menos que el mínimo del proveedor: se cotiza IGUAL por la cantidad que pidió (nunca se le cambia la cantidad);
  // el equipo busca otro proveedor que venda esa cantidad
  const bajoMinimo = listo && e.cantidad < minimo;
  if (PROFORMA.test(texto) || (img && PROFORMA.test(histC2(e)))) {
    // Proforma / packing list con varios productos: la cotiza el equipo con esos datos (no se piden precios ni pesos de a uno)
    return derivarCaso("consulta", `Mandó proforma / packing list para cotizar${e.actual?.nombre ? " (" + e.actual.nombre + ")" : ""}: armá la cotización con esos datos`, "buenisimo, con eso armamos la cotizacion||lo revisa el equipo y te la pasamos en un rato", true);
  } else if (listo) {
    e.pidioPeso = 0;
    if (/\?/.test(texto) && r.respuesta && !/\d/.test(r.respuesta)) await decir(r.respuesta.split("||")[0]);   // primero responde lo que preguntó
    const item = { ...e.actual, cantidad: e.cantidad };
    e.listos = [...(e.listos || []).filter((x) => x.nombre !== item.nombre), item].slice(-5);
    const textos = [textoCotizacion([item], e.oferta)];
    if (e.listos.length > 1) textos.push(textoCotizacion(e.listos, e.oferta));
    e.actual = {}; e.cantidad = null;
    const modo = bajoMinimo ? "aprobacion" : (await env.ESTADO.get("modo")) || "aprobacion";
    if (bajoMinimo) await crearTarea(env, { tipo: "proveedor", tel: de, nombre: e.nombre, titulo: `Buscar proveedor que venda ${item.cantidad} u de ${item.nombre || "el producto"} (el actual pide mínimo ${minimo})`, detalle: `El cliente quiere ${item.cantidad} unidades. El proveedor del link vende desde ${minimo}.${item.link ? "\nLink: " + item.link : ""}` });
    if (modo === "auto") {
      for (const t of textos) await decir(t);
      await evento(env, "cotizacion", de, `china|${item.nombre || ""}`);
      await programarSeguimiento(env, de, "cotizacion");

    } else {
      const id = id4();
      await env.ESTADO.put(`pend:${id}`, JSON.stringify({ para: de, textos }), { expirationTtl: 3 * 86400 });
      await decir("listo ya tengo todo||estoy terminando de armar tu cotizacion y en un ratito te la paso");
      await env.ESTADO.put("pend:ultimo", id, { expirationTtl: 3 * 86400 });
      await crearTarea(env, { tipo: "cotizacion", tel: de, nombre: e.nombre, ref: id, titulo: `${bajoMinimo ? "⚠️ BAJO MÍNIMO (prov. pide " + minimo + ") · " : ""}${cotizarItems([item]).total > 8000 || precioPorCantidad(item.tramos, item.cantidad) > 300 ? "⚠️ REVISAR MONTO · " : ""}Cotización: ${item.nombre || "producto"} x${item.cantidad}${item.estimado ? " (PESO ESTIMADO " + item.peso_kg + " kg)" : item.pesoFoto ? " (peso leído de la foto: " + item.peso_kg + " kg)" : ""}`, detalle: textos.join("\n\n———\n\n") + `\n\nDATOS USADOS: precio unitario USD ${precioPorCantidad(item.tramos, item.cantidad).toFixed(2)}${e.origenPrecio ? " (" + e.origenPrecio + ")" : ""} · peso ${item.peso_kg} kg/u${item.estimado ? " ESTIMADO" : item.pesoFoto ? " leído de la foto" : ""} · cantidad ${item.cantidad}` + (item.link ? "\nLink: " + item.link : "") });
      await avisoCorto(env, "Fijate que te dejé una cotización para confirmar. Panel > Pendientes");
    }
    r.accion = "ninguna";
  } else if (necesitaBusqueda && !/\b(no|ni)\b/i.test(texto) && r.ofrecer_catalogo === true && (encontrados = buscarEnCatalogo(await catalogo(env), `${texto} ${r.descripcion_producto || ""}`)).length && !(e.catalogoOfrecido || []).length && !/no (quiero|busco|me interesa)|eso no|otra cosa/i.test(texto)) {
    // Lo tenemos en el catálogo: se ofrece directo, sin derivar
    e.catalogoOfrecido = encontrados.map((x) => x.nombre);
    await decir(`${ok()}, eso lo tenemos||${encontrados.map((x) => `- ${x.nombre} ${pesos(x.precio)} por transferencia\n${x.url}`).join("\n\n")}||cuantas unidades necesitas? el minimo suele ser de 5`);
    r.accion = "ninguna";
    await guardarLead(env, de, e, { ...r, lead: { ...(r.lead || {}), interes: encontrados[0].nombre, etapa: "consulta" } });
    return guardar();
  } else if (necesitaBusqueda) {
    // PROTOCOLO DE BÚSQUEDA determinístico: registra lo que YA mandó (foto/link, cantidad, original o réplica, proveedor)
    // y pregunta cada cosa que falta UNA sola vez. Nunca pide capturas de Alibaba acá.
    const b = e.busq || (e.busq = { pregunto: {} });
    const hist = e.historial.filter((h) => h.r === "c");
    if (link || img || hist.some((h) => h.img || /https?:\/\//i.test(h.t))) b.ref = b.ref || link || "foto";
    if (img) e.fotoBusqueda = msg.image?.id || e.fotoBusqueda;
    if (link) b.link = link;
    if (cantidadTexto && !b.cant) b.cant = cantidadTexto;
    if (b.cant) e.cantidad = e.cantidad || b.cant;
    if (/original|r[eé]plica|replica|copia|imitaci|\b(aaa|1:1|g5|ag)\b|me da (lo mismo|igual)|cualquiera/i.test(texto)) b.calidad = /original/i.test(texto) && !/r[eé]plica|copia/i.test(texto) ? "original" : /me da (lo mismo|igual)|cualquiera/i.test(texto) ? "le da igual" : "réplica";
    if (/proveedor|busc(alo|alos|ala|alas|ame|amelo|uen|ar)|no tengo|ya tengo|consegu(ime|ilo|ir)|ustedes/i.test(texto) && b.pregunto.prov) b.prov = /ya tengo|tengo (un |el )?proveedor|mi proveedor/i.test(texto) ? "tiene proveedor" : "que lo busquemos";
    const ropa = rubroBusqueda;
    if (ropa && /talle|\b(3[4-9]|4[0-6]|xs|s|m|l|xl|xxl)\b/i.test(texto)) b.talles = true;
    const falta = [
      !b.ref && ["ref", "me pasas una foto o link de referencia del producto?"],
      !b.cant && ["cant", "cuantas unidades queres traer?"],
      ropa && !b.talles && ["talles", "que talles y cuantos de cada uno?"],
      !b.calidad && ["calidad", "lo queres original o replica?"],
      !b.prov && ["prov", "ya tenes proveedor o queres que te lo busquemos nosotros?"],
    ].filter((x) => x && !b.pregunto[x[0]]);
    const completo = b.ref && b.cant && b.calidad && (b.prov || b.pregunto.prov) && (!ropa || b.talles || b.pregunto.talles);
    if (completo || !falta.length || r.accion === "derivar") {
      const det = `Busca ${r.descripcion_producto || e.actual.nombre || "un producto"}${b.cant ? " x" + b.cant : ""}${b.calidad ? " · " + b.calidad : ""}${b.prov ? " · " + b.prov : ""}${b.link ? " · link: " + b.link : ""}`;
      e.busq = null;
      return derivarCaso("busqueda_proveedor", det, DERIVACION.alCliente());
    }
    const pedir = falta.slice(0, 2);
    for (const [k] of pedir) b.pregunto[k] = 1;
    const visto = link ? `ya vi el link${r.descripcion_producto ? " (" + r.descripcion_producto.slice(0, 60) + ")" : ""}` : img ? `ya vi la foto${r.descripcion_producto ? ", " + r.descripcion_producto.slice(0, 60) : ""}` : "";
    const respuestaIA = /\?/.test(texto) && r.respuesta ? r.respuesta.split("||")[0] : "";
    await decir([respuestaIA || (visto ? `${ok()}, ${visto}` : ok()), ...(pedir.length ? pedir.map((x) => x[1]) : ["me pasas una foto o link de referencia?"])].join("||"));
    if (r.resumen_cliente) e.resumen = r.resumen_cliente;
    e.actual = {};
    await guardarLead(env, de, e, { ...r, lead: { ...(r.lead || {}), etapa: "consulta", interes: r.descripcion_producto || "búsqueda" } });
    return guardar();
  } else if (enCotizacion && !(traeProducto || pesoTexto || confirmaPeso) && r.respuesta && (/\?|se puede|puedo|cu[aá]nto|c[oó]mo|m[ií]nimo|menos|tama[nñ]o|medida|plazo|tarda|demora|env[ií]o|precio/i.test(texto) || ((e.actual.tramos || []).length && e.ultimaFirma === `${(e.actual.tramos || []).length}|${!!e.actual.peso_kg}|${e.actual.nombre}`))) {
    // El cliente preguntó algo (o ya le pedimos esto mismo): la IA responde la pregunta y pide lo que falta, sin repetir el texto fijo
    await decir(r.respuesta);
  } else if (enCotizacion) {
    // Pide exactamente lo que falta; el peso se pide POR ESCRITO
    const nom = e.actual.nombre ? ` de *${e.actual.nombre}*` : "";
    if (!tramos.length) {
      // Nunca pedir lo mismo dos veces igual: 1ª captura, 2ª el precio escrito, 3ª lo cotiza el equipo
      e.pidioCaptura = (e.pidioCaptura || 0) + 1;
      if (e.pidioCaptura >= 2) { e.pidioCaptura = 0; return derivarCaso("consulta", `No logró leer el precio de ${e.actual.nombre || "el producto"}${e.actual.link ? " (" + e.actual.link + ")" : ""}${e.cantidad ? " x" + e.cantidad : ""}: cotizalo vos`, "dale, lo cotizamos nosotros y te pasamos el precio en un rato", true); }
      if (false) await decir(`no llego a ver el precio${nom ? " de" + nom.replace(" de", "") : ""}||escribime nomas el precio por unidad que ves en la publicacion (ej: US$ 2,50 o ¥18)${!e.cantidad ? " y cuantas unidades queres" : ""}`);
      else await decir(`genial${nom ? ", vi que es" + nom.replace(" de", "") : ""}||no llego a ver bien el precio||me pasas captura de la parte de precios (donde dice US$ o ¥ y las cantidades) o me escribis el precio por unidad?${!e.cantidad ? "||y cuantas unidades queres traer?" : ""}`);
    }
    else if (!e.actual.peso_kg) {
      e.esperaPeso = true;
      e.pidioPeso = (e.pidioPeso || 0) + 1;
      if (e.pidioPeso >= 3) { e.salud = "trabada"; e.saludMotivo = "no logró conseguir el peso"; return derivarCaso("falta_peso", `No consiguió el peso bruto de ${e.actual.nombre || "el producto"} (se lo pidió 2 veces)`, DERIVACION.alClienteGeneral(), true); }
      if (e.pidioPeso === 2 && !e.pesoSugerido) await decir(`te lo pido de otra forma||escribime solo el numero del peso por unidad, por ejemplo: 0,6 kg${!e.cantidad ? "||y cuantas unidades queres traer?" : ""}||si no lo encontras decime y lo averiguamos nosotros`);
      else if (e.pesoSugerido) await decir(`en la captura me parece que el peso bruto es ${String(e.pesoSugerido).replace(".", ",")} kg por unidad||me lo confirmas? si no es ese escribime el correcto (figura en "empaque y entrega")${!e.cantidad ? "||y cuantas unidades queres traer?" : ""}`);
      else await decir(`${img ? "no llego a leer bien el peso en la captura||" : ""}me escribis el peso bruto por unidad? figura en "empaque y entrega" (ej: 0,6 kg)${!e.cantidad ? "||y cuantas unidades queres traer?" : ""}`);
    } else await decir(`${ok()}, ya tengo precios y peso||cuantas unidades queres traer?`);
    if (r.derivacion?.estado === "consulta") r.accion = "ninguna";
    // Anti-bucle: si pide lo mismo por segunda vez sin datos nuevos, deriva
    const firma = `${tramos.length}|${!!e.actual.peso_kg}|${e.actual.nombre}`;
    const aportoAlgo = traeProducto || pesoTexto || confirmaPeso || cantidadTexto;
    e.pedidosIguales = e.ultimaFirma === firma && !aportoAlgo ? (e.pedidosIguales || 0) + 1 : 0;
    e.ultimaFirma = firma;
    if (e.pedidosIguales >= 2) { e.salud = "trabada"; e.saludMotivo = "el agente pidió lo mismo 3 veces"; }
    if (e.pedidosIguales >= 2) return derivarCaso("consulta", `El agente no logra completar los datos de ${e.actual.nombre || "un producto"} (le pidió lo mismo dos veces)`, DERIVACION.alClienteGeneral(), true);
  } else if (r.respuesta) await decir(r.respuesta);

  if (e.esVaper || (r.es_vaper === true && !NO_VAPER.test(texto))) { e.esVaper = false; await derivarVaper(env, de, e, decir); await guardarLead(env, de, e, { ...r, lead: { ...(r.lead || {}), etapa: "derivado", interes: "vapers" } }); return guardar(); }
  if (e.pideHumano && r.accion !== "derivar") { e.pideHumano = false; return derivarCaso("pide_humano", `Pide hablar con una persona o una llamada: "${texto.slice(0, 150)}"`, `dale, ahora te escribe alguien del equipo directamente${/llam/i.test(texto) ? "||si preferis llamar, el numero es 341 805-1515" : ""}`, true); }
  if (r.accion === "derivar") return derivarCaso(r.derivacion?.estado || "consulta", r.derivacion?.resumen || texto, null, true);
  if (r.lead?.etapa === "cierre" && !e.avisoCierre) { e.avisoCierre = Date.now(); await crearTarea(env, { tipo: "cierre", tel: de, nombre: e.nombre, titulo: "Quiere comprar: cerrá la venta", detalle: e.resumen || texto }); await avisoCorto(env, `Fijate que ${e.nombre || "+" + de} quiere comprar. Panel > Pendientes`); }
  await guardarLead(env, de, e, r);
  return guardar();
}

async function enCola(env, de, fn) {
  const k = `lock:${de}`;
  for (let i = 0; i < 12 && (await env.ESTADO.get(k)); i++) await new Promise((ok) => setTimeout(ok, 1000));
  await env.ESTADO.put(k, "1", { expirationTtl: 60 });
  try { await fn(); } finally { await env.ESTADO.delete(k); }
}

async function correrSeguimientos(env) {
  const lst = await env.ESTADO.list({ prefix: "seg:" });
  for (const k of lst.keys) {
    const s = JSON.parse((await env.ESTADO.get(k.name)) || "null");
    if (!s || Date.now() < s.cuando) continue;
    const para = k.name.slice(4);
    await env.ESTADO.delete(k.name);
    if (await env.ESTADO.get(`pausa:${para}`)) continue;
    const e = JSON.parse((await env.ESTADO.get(`v3:${para}`)) || "{}");
    let t;
    if (s.tipo === "recomendar") {
      const c = e.combo || {};
      const lista = await catalogo(env);
      const base = lista.filter((p) => (c.rubro ? RUBROS[c.rubro] : Object.values(RUBROS).flat()).includes(p.cat) && (!c.presupuesto || p.precio <= c.presupuesto));
      const it = mezclar(base).slice(0, 5);
      if (!it.length) continue;
      t = `¿Pudiste mirar el catálogo? 👀 Te dejo 5 que te recomiendo${c.rubro ? " de " + c.rubro.toLowerCase() : ""}${c.presupuesto ? " para tu presupuesto" : ""}:\n\n` +
        it.map((p) => `• ${p.nombre} — ${pesos(p.precio)}\n  ${p.url}`).join("\n") + `\n\n_Precios por transferencia._ ¿Alguno te interesa? Te armo el combo con cantidades.`;
      if (e.combo) e.combo.paso = "armado";
    } else t = SEGUIMIENTO[s.tipo].texto(e.nombre?.split(" ")[0]);
    for (const parte of sinEmojis(t).split("||").map((x) => x.trim()).filter(Boolean)) await enviar(env, para, parte);
    e.historial = [...(e.historial || []), { r: "a", t: t.replace(/\|\|/g, " / ") }].slice(-60);
    await env.ESTADO.put(`v3:${para}`, JSON.stringify(e), { expirationTtl: 90 * 86400 });
  }
}
// ---------- Política de privacidad (requerida por Meta) ----------
const PRIVACIDAD = `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Política de privacidad · Te Importamos</title>
<style>body{font-family:Arial,sans-serif;max-width:720px;margin:40px auto;padding:0 20px;line-height:1.6;color:#222}
h1{color:#EA5B0C}h2{font-size:1.1em;margin-top:1.6em}</style></head><body>
<h1>Política de privacidad</h1>
<p><strong>Te Importamos</strong> (teimportamosarg.com), Rosario, Santa Fe, Argentina. Última actualización: octubre de 2026.</p>
<h2>Qué datos recopilamos</h2>
<p>Cuando nos escribís por WhatsApp recibimos tu número de teléfono, tu nombre de perfil y el contenido de los mensajes que nos enviás (textos, links e imágenes de productos).</p>
<h2>Para qué los usamos</h2>
<p>Únicamente para responder tus consultas, preparar cotizaciones de importación y gestionar tus pedidos. Usamos un asistente automático que analiza los productos que nos enviás para calcular la cotización.</p>
<h2>Con quién los compartimos</h2>
<p>No vendemos ni cedemos tus datos. Se procesan a través de los servicios técnicos necesarios para operar: WhatsApp (Meta), Cloudflare (alojamiento) y Google (análisis de imágenes y links).</p>
<h2>Cuánto tiempo los guardamos</h2>
<p>Los datos de la conversación con el asistente se eliminan automáticamente a los 90 días. Los datos de pedidos confirmados se conservan el tiempo necesario por obligaciones comerciales.</p>
<h2>Tus derechos</h2>
<p>Podés pedir acceso, corrección o eliminación de tus datos en cualquier momento escribiéndonos por WhatsApp. Conforme a la Ley 25.326 de Protección de Datos Personales, la Agencia de Acceso a la Información Pública es el órgano de control.</p>
<h2>Contacto</h2>
<p>Por WhatsApp o a través de teimportamosarg.com.</p>
</body></html>`;


// =====================================================================
//  COEXISTENCIA: historial previo y mensajes que el equipo manda desde el celular
// =====================================================================
const textoDe = (m) => m.text?.body || m.image?.caption || m.interactive?.button_reply?.title || (m.type ? `(${m.type})` : "");

// Historial de chats que Meta envía al conectar el número (no responde nada, solo aprende el contexto)
async function importarHistorial(env, valor) {
  const negocio = String(valor.metadata?.display_phone_number || "").replace(/\D/g, "");
  let hilos = 0, enCurso = 0;
  for (const bloque of valor.history || []) {
    for (const hilo of bloque.threads || []) {
      const cliente = String(hilo.id || "").replace(/\D/g, "");
      if (!cliente) continue;
      const k = `v3:${cliente}`;
      const e = JSON.parse((await env.ESTADO.get(k)) || "null") || { historial: [] };
      const msgs = (hilo.messages || []).sort((a, b) => +a.timestamp - +b.timestamp);
      const previos = msgs.map((m) => ({ r: String(m.from).replace(/\D/g, "") === negocio || String(m.from).replace(/\D/g, "") !== cliente ? "a" : "c", t: textoDe(m).slice(0, 300), ts: +m.timestamp * 1000 }));
      const todos = [...previos, ...(e.historial || [])].sort((a, b) => (a.ts || 0) - (b.ts || 0));
      e.historial = todos.slice(-60).map(({ r, t, ts }) => ({ r, t, ts }));
      const ultimo = Math.max(...previos.map((x) => x.ts), 0);
      e.ultimoMensaje = Math.max(e.ultimoMensaje || 0, ultimo);
      e.importado = true;
      e.resumen = e.resumen || "cliente que ya venía hablando con el equipo antes del agente";
      await env.ESTADO.put(k, JSON.stringify(e), { expirationTtl: 90 * 86400 });
      // Chat en curso: queda con el equipo hasta que hagan #reanudar
      if (ultimo && Date.now() - ultimo < CONVIVENCIA.diasChatEnCurso * 86400e3) {
        await env.ESTADO.put(`pausa:${cliente}`, "1", { expirationTtl: CONVIVENCIA.diasChatEnCurso * 86400 });
        enCurso++;
      }
      hilos++;
    }
  }
  console.log(`Historial importado: ${hilos} chats, ${enCurso} en curso (pausados)`);
  if (hilos) await env.ESTADO.put("importacion", JSON.stringify({ hilos, enCurso, cuando: new Date().toISOString() }));
}

// Lo que ustedes responden desde la app: queda en el historial y el agente se calla un rato
async function registrarEco(env, valor) {
  for (const m of valor.message_echoes || []) {
    const cliente = String(m.to || "").replace(/\D/g, "");
    if (!cliente) continue;
    const k = `v3:${cliente}`;
    const e = JSON.parse((await env.ESTADO.get(k)) || "null") || { historial: [] };
    e.historial = [...(e.historial || []), { r: "h", t: textoDe(m).slice(0, 2000), ts: Date.now() }].slice(-60);
    e.ultimoHumano = Date.now();
    await env.ESTADO.put(k, JSON.stringify(e), { expirationTtl: 90 * 86400 });
    const pausaActual = await env.ESTADO.get(`pausa:${cliente}`);
    if (!pausaActual) await env.ESTADO.put(`pausa:${cliente}`, "1", { expirationTtl: Math.round((num(env.PAUSA_AUTO_HORAS) ?? CONVIVENCIA.pausaSiRespondeHumano) * 3600) });
    await env.ESTADO.delete(`seg:${cliente}`);
    console.log("Eco del equipo a", cliente, "→ agente en pausa");
  }
}

// Página para conectar el número existente (Embedded Signup de Meta, modo coexistencia)
function paginaAlta(env) {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Conectar WhatsApp · Te Importamos</title>
<style>body{font-family:Arial,sans-serif;max-width:640px;margin:40px auto;padding:0 20px;color:#222;line-height:1.5}
button{background:#EA5B0C;color:#fff;border:0;border-radius:8px;padding:14px 22px;font-size:16px;cursor:pointer}
pre{background:#f4f4f4;padding:12px;border-radius:8px;white-space:pre-wrap;word-break:break-all}</style></head><body>
<h1>Conectar el WhatsApp Business</h1>
<p>Tocá el botón, iniciá sesión con Facebook y elegí <b>conectar tu app de WhatsApp Business existente</b>. Al final vas a escanear un QR desde la app del celular. Aceptá <b>compartir el historial de chats</b>.</p>
<button onclick="conectar()">Conectar número</button>
<pre id="estado">Esperando...</pre>
<script>
let datos = {};
window.addEventListener("message", (ev) => {
  if (!String(ev.origin).endsWith("facebook.com")) return;
  try { const d = JSON.parse(ev.data); if (d.type === "WA_EMBEDDED_SIGNUP") { datos = { ...datos, ...d.data, evento: d.event };
    document.getElementById("estado").textContent = "Paso de Meta: " + d.event; } } catch (e) {}
});
window.fbAsyncInit = () => FB.init({ appId: "${env.FB_APP_ID || ""}", autoLogAppEvents: true, xfbml: true, version: "v21.0" });
function conectar() {
  FB.login(async (r) => {
    if (!r.authResponse?.code) { document.getElementById("estado").textContent = "Se canceló o falló el inicio de sesión."; return; }
    document.getElementById("estado").textContent = "Terminando la conexión...";
    const res = await fetch("/alta/cierre?clave=${encodeURIComponent(env.VERIFY_TOKEN)}", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: r.authResponse.code, ...datos }) });
    document.getElementById("estado").textContent = await res.text();
  }, { config_id: "${env.FB_CONFIG_ID || ""}", response_type: "code", override_default_response_type: true,
       extras: { setup: {}, featureType: "whatsapp_business_app_onboarding", sessionInfoVersion: "3" } });
}
</script><script async defer crossorigin="anonymous" src="https://connect.facebook.net/es_LA/sdk.js"></script></body></html>`;
}

// Cierre del alta: token, suscripción de la app y pedido de historial
async function cierreAlta(env, d) {
  const G = "https://graph.facebook.com/v21.0";
  const t = await (await fetch(`${G}/oauth/access_token?client_id=${env.FB_APP_ID}&client_secret=${env.APP_SECRET}&code=${encodeURIComponent(d.code)}`)).json();
  if (!t.access_token) return `❌ No se pudo obtener el token: ${JSON.stringify(t.error || t)}`;
  const tok = t.access_token, H = { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" };
  const sub = await (await fetch(`${G}/${d.waba_id}/subscribed_apps`, { method: "POST", headers: H })).json();
  const sync = [];
  for (const tipo of ["smb_app_state_sync", "history"]) {
    const r = await (await fetch(`${G}/${d.phone_number_id}/smb_app_data`, { method: "POST", headers: H, body: JSON.stringify({ messaging_product: "whatsapp", sync_type: tipo }) })).json();
    sync.push(`${tipo}: ${JSON.stringify(r).slice(0, 120)}`);
  }
  return `✅ Número conectado.\n\nCargá estas variables en Cloudflare (Settings > Variables) y hacé Deploy:\n\nWA_PHONE_ID = ${d.phone_number_id}\nWA_TOKEN (Secret) = ${tok}\n\nWABA: ${d.waba_id}\nSuscripción: ${JSON.stringify(sub)}\nHistorial: \n${sync.join("\n")}\n\nGuardá este token, no se vuelve a mostrar.`;
}


// Panel para ver lo que hace el agente: lista de chats y conversación completa
async function panel(env, url) {
  const clave = url.searchParams.get("clave");
  const tel = (url.searchParams.get("tel") || "").replace(/\D/g, "");
  const filtro = url.searchParams.get("f") || "";
  const q = "v=1";
  const esc = (t) => String(t ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const fmt = (ms) => ms ? new Date(ms).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";
  const estilo = `<style>body{font-family:Arial,sans-serif;max-width:860px;margin:0 auto;padding:0 12px 90px;color:#222;background:#fafafa}
a{color:#EA5B0C;text-decoration:none}header{position:sticky;top:0;background:#fafafa;padding:10px 0;border-bottom:1px solid #eee;z-index:2}
.fila{display:block;background:#fff;border:1px solid #eee;border-radius:12px;padding:10px 12px;margin:8px 0;color:#222}
.fila b{font-size:15px}.fila small{color:#777}.ult{color:#444;font-size:14px;margin-top:4px}
.c{background:#fff;border:1px solid #eee;border-radius:12px;padding:8px 12px;margin:6px 30% 6px 0;white-space:pre-wrap;font-size:14px}
.a{background:#ffe3d3;border-radius:12px;padding:8px 12px;margin:6px 0 6px 30%;white-space:pre-wrap;font-size:14px}
.h{background:#d9f2e3;border-radius:12px;padding:8px 12px;margin:6px 0 6px 30%;white-space:pre-wrap;font-size:14px}
.tag{font-size:12px;padding:2px 8px;border-radius:10px;background:#eee;margin-right:4px;white-space:nowrap}
.rojo{background:#ffd6d6}.verde{background:#d9f2e3}.btn{display:inline-block;padding:8px 12px;border-radius:10px;background:#EA5B0C;color:#fff;margin:4px 4px 0 0;font-size:14px}
.gris{background:#888}form.resp{position:fixed;bottom:0;left:0;right:0;background:#fff;border-top:1px solid #ddd;padding:10px;display:flex;gap:8px;max-width:860px;margin:0 auto}
form.resp textarea{flex:1;font-size:15px;padding:8px;border-radius:10px;border:1px solid #ccc;min-height:42px}form.resp button{background:#25D366;color:#fff;border:0;border-radius:10px;padding:0 16px;font-size:15px}</style>`;
  const salTag = (e) => e.salud === "trabada" ? '<span class="tag rojo">🚨 en riesgo</span>' : e.salud === "dudosa" ? '<span class="tag rojo">⚠ dudosa</span>' : "";
  // Recarga sola cada 10 s (sin perder lo que estés escribiendo)
  const vivo = `<script>setInterval(()=>{const t=document.querySelector("textarea");if(t&&t.value)return;location.reload()},10000);window.onload=()=>window.scrollTo(0,document.body.scrollHeight*${tel ? 1 : 0})</script>`;
  if (tel) {
    const e = JSON.parse((await env.ESTADO.get(`v3:${tel}`)) || "null") || { historial: [] };
    const pausa = await env.ESTADO.get(`pausa:${tel}`);
    const l = JSON.parse((await env.ESTADO.get(`lead:${tel}`)) || "null") || {};
    const fotos = (h) => (h.img || []).map((id) => `<a href="/panel/media?id=${encodeURIComponent(id)}" target="_blank"><img src="/panel/media?id=${encodeURIComponent(id)}" style="max-width:220px;max-height:260px;border-radius:8px;display:block;margin:4px 0"></a>`).join("");
    const burbujas = (e.historial || []).map((h) => `<div class="${h.r === "c" ? "c" : h.r === "h" ? "h" : "a"}">${h.r === "c" ? "" : h.n ? "<b>Nota interna:</b> " : h.r === "h" ? "<b>Equipo:</b> " : "<b>Agente:</b> "}${fotos(h)}${h.img && h.t === "(imagen)" ? "" : esc(h.t)}</div>`).join("");
    return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(e.nombre || tel)}</title>${estilo}
<header><a href="/panel?${q}">← Todos los chats</a> · <a href="https://wa.me/${tel}">abrir en WhatsApp</a>
<h3 style="margin:6px 0">${esc(e.nombre || "")} +${tel}</h3>
${pausa ? '<span class="tag">⏸ agente pausado</span>' : '<span class="tag verde">▶ agente activo</span>'}${salTag(e)}${l.temperatura ? `<span class="tag">${esc(l.temperatura)} ${l.puntaje ? l.puntaje + "/10" : ""}</span>` : ""}${e.derivado ? `<span class="tag">derivado: ${esc(e.derivado.estado)}</span>` : ""}
<div>${pausa ? `<a class="btn" href="/panel/accion?${q}&tel=${tel}&a=reanudar">▶ Devolver al agente</a>` : `<a class="btn" href="/panel/accion?${q}&tel=${tel}&a=pausa">🙋 Lo tomo yo (pausar 12 h)</a>`}${e.salud && e.salud !== "ok" ? `<a class="btn gris" href="/panel/accion?${q}&tel=${tel}&a=bien">👍 Está bien</a>` : ""}</div></header>
<p><b>Resumen:</b> ${esc(e.resumen || "-")}${e.saludMotivo ? `<br><b>Salud:</b> ${esc(e.saludMotivo)}` : ""}</p>${burbujas || "<p>Sin mensajes</p>"}
<form class="resp" method="post" action="/panel/enviar?${q}&tel=${tel}"><textarea name="t" placeholder="Responder como equipo (pausa al agente 12 h)"></textarea><button>Enviar</button></form>${vivo}`;
  }
  const filas = [];
  for (const k of (await env.ESTADO.list({ prefix: "v3:" })).keys) {
    const e = JSON.parse((await env.ESTADO.get(k.name)) || "null"); if (!e) continue;
    const t = k.name.slice(3);
    if (esAdmin(env, t)) continue;
    const ult = (e.historial || []).slice(-1)[0];
    const pausa = await env.ESTADO.get(`pausa:${t}`);
    const ld = JSON.parse((await env.ESTADO.get(`lead:${t}`)) || "null") || {};
    filas.push({ t, e, pausa, cuando: e.ultimoMensaje || 0, ult, temp: ld.temperatura || "", pts: ld.puntaje || 0 });
  }
  filas.sort((a, b) => b.cuando - a.cuando);
  const TEMPS = { caliente: "🔥 Calientes", tibio: "🌤 Tibios", frio: "❄️ Fríos" };
  let ver = filtro === "riesgo" ? filas.filter((f) => f.e.salud && f.e.salud !== "ok") : filtro === "hoy" ? filas.filter((f) => Date.now() - f.cuando < 24 * 3600e3) : TEMPS[filtro] ? filas.filter((f) => f.temp === filtro) : filas;
  if (TEMPS[filtro]) ver = [...ver].sort((a, b) => b.pts - a.pts || b.cuando - a.cuando);   // dentro de cada calidad, primero los de mayor puntaje
  const nTemp = (k) => filas.filter((f) => f.temp === k).length;
  const nRiesgo = filas.filter((f) => f.e.salud && f.e.salud !== "ok").length;
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Chats del agente</title>${estilo}
<header><h2 style="margin:4px 0">Chats del agente (${ver.length})</h2>
<a class="tag" href="/panel?${q}">Todos</a><a class="tag" href="/panel?${q}&f=hoy">Últimas 24 h</a><a class="tag rojo" href="/panel?${q}&f=riesgo">🚨 En riesgo (${nRiesgo})</a><br>
${Object.entries(TEMPS).map(([k, n]) => `<a class="tag${filtro === k ? " verde" : ""}" href="/panel?${q}&f=${k}">${n} (${nTemp(k)})</a>`).join("")}<br>
<small style="color:#777">se actualiza solo cada 10 s · ${esc(url.searchParams.get("quien") || "")} · <a href="/logout">salir</a></small></header>
${ver.map((f) => `<a class="fila" href="/panel?${q}&tel=${f.t}"><b>${esc(f.e.nombre || "+" + f.t)}</b> <small>+${f.t} · ${fmt(f.cuando)}</small><br>
${f.temp ? `<span class="tag">${{ caliente: "🔥", tibio: "🌤", frio: "❄️" }[f.temp] || ""} ${esc(f.temp)}${f.pts ? " " + f.pts + "/10" : ""}</span>` : ""}${f.pausa ? '<span class="tag">⏸ pausado</span>' : ""}${f.pausa && f.ult?.r === "c" ? '<span class="tag rojo">💬 espera tu respuesta</span>' : ""}${salTag(f.e)}${f.e.derivado ? `<span class="tag">${esc(f.e.derivado.estado)}</span>` : ""}${f.e.etapa === "pagado" ? '<span class="tag verde">💰 pagó</span>' : ""}
<div class="ult">${f.ult ? (f.ult.r === "c" ? "👤 " : f.ult.r === "h" ? "🧑‍💼 " : "🤖 ") + esc(String(f.ult.t).slice(0, 110)) : ""}</div></a>`).join("") || "<p>Sin chats</p>"}${vivo}`;
}

// =====================================================================
//  LOGIN DEL PANEL (usuario y contraseña)
//  Variable secreta en Cloudflare: PANEL_USUARIOS = "manuel:clave1,socio:clave2"
// =====================================================================
const SESION_DIAS = 30;
const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
async function firmarSesion(env, texto) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(`${env.VERIFY_TOKEN}|panel|${env.PANEL_USUARIOS || ""}`), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(texto)));
}
async function usuarioSesion(env, req) {
  const c = (req.headers.get("cookie") || "").match(/(?:^|;\s*)ti_sesion=([^;]+)/);
  if (!c) return null;
  const [u, exp, firma] = decodeURIComponent(c[1]).split(".");
  if (!u || !exp || Date.now() > +exp) return null;
  if (firma !== (await firmarSesion(env, `${u}.${exp}`))) return null;   // cambia sola si cambian las contraseñas
  return u;
}
// Tolerante: acepta comillas, espacios, "usuario=clave", y separar usuarios con coma, punto y coma o renglón
function usuariosPanel(env) {
  const limpio = String(env.PANEL_USUARIOS || "").trim().replace(/^["'`]+|["'`]+$/g, "");
  return Object.fromEntries(limpio.split(/[,;\n]+/).map((x) => x.trim().replace(/^["'`]+|["'`]+$/g, "")).filter((x) => /[:=]/.test(x)).map((x) => {
    const i = x.search(/[:=]/);
    return [x.slice(0, i).trim().toLowerCase(), x.slice(i + 1).trim().replace(/^["'`]+|["'`]+$/g, "")];
  }));
}
function paginaLogin(msg, volver) {
  const esc = (t) => String(t ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  return new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ingresar · Te Importamos</title>
<style>body{font-family:Arial,sans-serif;background:#fafafa;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;padding:16px}
form{background:#fff;border:1px solid #eee;border-radius:16px;padding:24px;width:100%;max-width:340px}h2{margin:0 0 16px;color:#EA5B0C}
input{width:100%;box-sizing:border-box;font-size:16px;padding:12px;border:1px solid #ccc;border-radius:10px;margin:6px 0}
button{width:100%;font-size:16px;padding:12px;border:0;border-radius:10px;background:#EA5B0C;color:#fff;margin-top:10px}.err{color:#c00;font-size:14px}</style>
<form method="post" action="/login"><h2>Panel del agente</h2>${msg ? `<p class="err">${esc(msg)}</p>` : ""}
<input name="u" placeholder="Usuario" autocomplete="username" autocapitalize="none" required>
<input name="p" type="password" placeholder="Contraseña" autocomplete="current-password" required>
<input type="hidden" name="volver" value="${esc(volver || "/panel")}"><button>Entrar</button></form>`, { status: msg ? 401 : 200, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}
async function login(env, req, url) {
  if (req.method !== "POST") return paginaLogin("", url.searchParams.get("volver"));
  const usuarios = usuariosPanel(env);
  if (!Object.keys(usuarios).length) return paginaLogin("Falta configurar PANEL_USUARIOS en Cloudflare.");
  // Freno anti fuerza bruta: 8 intentos fallidos por IP cada 15 minutos
  const ip = req.headers.get("cf-connecting-ip") || "x";
  const kf = `loginfallo:${ip}`, fallos = +(await env.ESTADO.get(kf)) || 0;
  if (fallos >= 8) return paginaLogin("Demasiados intentos. Probá de nuevo en 15 minutos.");
  const f = await req.formData();
  const u = String(f.get("u") || "").trim().toLowerCase(), p = String(f.get("p") || "").trim();
  let volver = String(f.get("volver") || "/panel");
  if (!volver.startsWith("/panel")) volver = "/panel";
  if (!usuarios[u] || usuarios[u] !== p) {
    await env.ESTADO.put(kf, String(fallos + 1), { expirationTtl: 900 });
    return paginaLogin("Usuario o contraseña incorrectos.", volver);
  }
  await env.ESTADO.delete(kf);
  const exp = Date.now() + SESION_DIAS * 86400e3;
  const valor = `${u}.${exp}.${await firmarSesion(env, `${u}.${exp}`)}`;
  return new Response(null, { status: 303, headers: { Location: volver, "Set-Cookie": `ti_sesion=${encodeURIComponent(valor)}; Path=/; Max-Age=${SESION_DIAS * 86400}; HttpOnly; Secure; SameSite=Lax` } });
}

// Acciones del panel: pausar, devolver al agente, marcar "está bien", responder como equipo
async function panelAccion(env, url, req) {
  const tel = (url.searchParams.get("tel") || "").replace(/\D/g, "");
  const volver = `/panel?tel=${tel}`;
  const k = `v3:${tel}`;
  const e = JSON.parse((await env.ESTADO.get(k)) || "null") || { historial: [] };
  if (url.pathname === "/panel/enviar" && req.method === "POST") {
    const t = String((await req.formData()).get("t") || "").trim();
    if (t) {
      await enviar(env, tel, t);
      e.historial = [...(e.historial || []), { r: "h", t: `(${url.searchParams.get("quien") || "equipo"}) ${t}`.slice(0, 300) }].slice(-60);
      await env.ESTADO.put(`pausa:${tel}`, "1", { expirationTtl: 12 * 3600 });
      await env.ESTADO.delete(`seg:${tel}`);
    }
  } else {
    const a = url.searchParams.get("a");
    if (a === "pausa") { await env.ESTADO.put(`pausa:${tel}`, "1", { expirationTtl: 12 * 3600 }); await env.ESTADO.delete(`seg:${tel}`); }
    if (a === "reanudar") { await env.ESTADO.delete(`pausa:${tel}`); await env.ESTADO.put(k, JSON.stringify(e), { expirationTtl: 90 * 86400 }); await retomar(env, tel).catch((err) => console.log("Error retomar:", err)); return Response.redirect(new URL(volver, url).toString(), 303); }
    if (a === "bien") { e.salud = "ok"; e.saludMotivo = "revisado por el equipo"; }
  }
  await env.ESTADO.put(k, JSON.stringify(e), { expirationTtl: 90 * 86400 });
  await guardarLead(env, tel, e, {});
  return Response.redirect(new URL(volver, url).toString(), 303);
}

// Lista los números de WhatsApp del portafolio con su ID y estado
async function listarNumeros(env, negocio) {
  const G = "https://graph.facebook.com/v21.0", H = { Authorization: `Bearer ${env.WA_TOKEN}` };
  const out = [];
  const wabas = await (await fetch(`${G}/${negocio}/owned_whatsapp_business_accounts?fields=id,name`, { headers: H })).json();
  if (wabas.error) return "Error: " + JSON.stringify(wabas.error);
  for (const w of wabas.data || []) {
    const nums = await (await fetch(`${G}/${w.id}/phone_numbers?fields=id,display_phone_number,verified_name,code_verification_status,name_status,platform_type,status`, { headers: H })).json();
    out.push(`Cuenta WhatsApp (WABA): ${w.name} | ID: ${w.id}`);
    for (const n of nums.data || []) out.push(`   Número ${n.display_phone_number} (${n.verified_name}) | PHONE ID: ${n.id} | estado: ${n.status || "-"} | plataforma: ${n.platform_type || "-"} | nombre: ${n.name_status || "-"}`);
  }
  return out.join("\n") || "No encontré números";
}

// Verifica que el mensaje venga realmente de Meta (opcional: variable APP_SECRET)
async function firmaValida(secreto, cuerpo, cabecera) {
  if (!cabecera) return false;
  const clave = await crypto.subtle.importKey("raw", new TextEncoder().encode(secreto), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const firma = await crypto.subtle.sign("HMAC", clave, new TextEncoder().encode(cuerpo));
  const hex = [...new Uint8Array(firma)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return cabecera === `sha256=${hex}`;
}


// =====================================================================
//  MEMORIA: usa D1 (base de datos, consistente y con más límite) si está
//  vinculada como DB; si no, el KV ESTADO de siempre.
// =====================================================================
let tablaLista = false;
// Pone la hora a los mensajes nuevos (los viejos, de antes de la v12, quedan sin hora)
function conHora(v) {
  try {
    const e = typeof v === "string" ? JSON.parse(v) : v;
    const h = e?.historial;
    if (!Array.isArray(h) || !h.length) return String(v);
    let i = h.length; while (i > 0 && h[i - 1].ts === undefined) i--;
    const ninguno = i === 0 && h.length > 4 && !h.some((x) => x.ts !== undefined);   // chat viejo, de antes de la v12
    h.forEach((x, j) => { if (x.ts === undefined) x.ts = ninguno && j < h.length - 1 ? 0 : Date.now(); });
    return JSON.stringify(e);
  } catch { return String(v); }
}
async function almacen(env) {
  if (!env.DB) return env.ESTADO;
  if (!tablaLista) { await env.DB.prepare("CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT, exp INTEGER)").run(); tablaLista = true; }
  return {
    async get(k) {
      const r = await env.DB.prepare("SELECT v, exp FROM kv WHERE k = ?").bind(k).first();
      if (!r) return null;
      if (r.exp && r.exp < Date.now()) { await env.DB.prepare("DELETE FROM kv WHERE k = ?").bind(k).run(); return null; }
      return r.v;
    },
    async put(k, v, o = {}) {
      if (k.startsWith("v3:")) v = conHora(v);
      const exp = o.expirationTtl ? Date.now() + o.expirationTtl * 1000 : null;
      await env.DB.prepare("INSERT INTO kv (k, v, exp) VALUES (?, ?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v, exp = excluded.exp").bind(k, String(v), exp).run();
      if (k.startsWith("v3:") || k.startsWith("lead:")) await indexar(env, k, String(v));
    },
    async delete(k) { await env.DB.prepare("DELETE FROM kv WHERE k = ?").bind(k).run(); if (k.startsWith("v3:")) await indexar(env, k, null); },
    // Borra y devuelve en UNA sola operación todo lo que empieza con prefix: si dos procesos
    // intentan tomar los mismos mensajes a la vez, solo uno se los lleva (nada se responde dos veces)
    async tomarPrefijo(prefix) {
      const rs = await env.DB.prepare("DELETE FROM kv WHERE substr(k, 1, ?) = ? RETURNING k, v, exp").bind(prefix.length, prefix).all();
      return rs.results.filter((r) => !r.exp || r.exp > Date.now()).map((r) => ({ k: r.k, v: r.v }));
    },
    async list({ prefix = "" } = {}) {
      const rs = await env.DB.prepare("SELECT k FROM kv WHERE k >= ? AND k < ? AND (exp IS NULL OR exp > ?)").bind(prefix, prefix + "\uffff", Date.now()).all();
      return { keys: rs.results.map((r) => ({ name: r.k })), list_complete: true };
    },
  };
}


// =====================================================================
//  ESPERA Y RESPUESTA: junta los mensajes del cliente y contesta todo junto
//  - Cada mensaje se guarda en su propia fila (bm:TEL:HORA:ID): dos mensajes
//    simultáneos nunca se pisan.
//  - bu:TEL guarda cuál fue el ÚLTIMO mensaje. Cada mensaje espera unos segundos;
//    si al despertar sigue siendo el último, responde todo; si llegó otro, se retira
//    y responde el más nuevo.
//  - El cron de cada minuto es la red de seguridad: responde lo que haya quedado
//    colgado y reintenta (una vez) respuestas que Cloudflare cortó a la mitad.
// =====================================================================
const dormir = (ms) => new Promise((ok) => setTimeout(ok, ms));
function esperaMs(env) {
  const v = env.ESPERA_SEG;
  const s = v !== undefined && v !== null && String(v).trim() !== "" && isFinite(Number(v)) ? Number(v) : ESPERA.segundos;
  return Math.max(0, Math.min(s, ESPERA.maxSeg)) * 1000;
}
async function tomarPrefijo(env, prefix) {
  if (env.ESTADO.tomarPrefijo) return env.ESTADO.tomarPrefijo(prefix);
  const out = [];   // respaldo sin D1 (KV): no es atómico, pero funciona
  for (const k of (await env.ESTADO.list({ prefix })).keys) {
    const v = await env.ESTADO.get(k.name);
    if (v != null) { await env.ESTADO.delete(k.name); out.push({ k: k.name, v }); }
  }
  return out;
}
async function encolarMensaje(env, msg, nombre) {
  const ahora = Date.now();
  await env.ESTADO.put(`bm:${msg.from}:${ahora}:${msg.id}`, JSON.stringify({ msg, nombre }), { expirationTtl: 3600 });
  await env.ESTADO.put(`bu:${msg.from}`, JSON.stringify({ id: msg.id, ts: ahora }), { expirationTtl: 3600 });
}
// Se llama al recibir cada mensaje (en segundo plano)
async function esperarYResponder(env, msg) {
  const t0 = Date.now();
  await dormir(esperaMs(env));
  const u = JSON.parse((await env.ESTADO.get(`bu:${msg.from}`)) || "null");
  if (u && u.id !== msg.id) return;   // el cliente siguió escribiendo: responde el mensaje más nuevo
  // Si solo dijo "hola"/"buenas", espera unos segundos más: casi siempre sigue una foto o la consulta
  if (msg.type === "text" && /^(hola+|buenas+|buen d[ií]a|buenas tardes|buenas noches|holis?|hey)[\s!.,]*$/i.test(msg.text?.body || "")) {
    await dormir(ESPERA.extraSaludo * 1000);
    const u2 = JSON.parse((await env.ESTADO.get(`bu:${msg.from}`)) || "null");
    if (u2 && u2.id !== msg.id) return;
  }
  // Pausa humana antes del "leído / escribiendo...": al azar, sin pasarse del tope total
  const yaEsperado = (Date.now() - t0) / 1000;
  const pausa = Math.max(0, Math.min(ESPERA.vistoMin + Math.random() * (ESPERA.vistoMax - ESPERA.vistoMin), ESPERA.tope - yaEsperado));
  if (pausa > 0) {
    await dormir(pausa * 1000);
    const u3 = JSON.parse((await env.ESTADO.get(`bu:${msg.from}`)) || "null");
    if (u3 && u3.id !== msg.id) return;   // escribió algo más mientras tanto
  }
  await env.ESTADO.delete(`bu:${msg.from}`);
  await responderTel(env, msg.from);
}
async function responderTel(env, de) {
  const filas = await tomarPrefijo(env, `bm:${de}:`);
  if (!filas.length) return false;    // otro proceso ya los tomó
  filas.sort((a, b) => (a.k < b.k ? -1 : 1));
  const lote = filas.map((f) => JSON.parse(f.v));
  const msgs = lote.map((x) => x.msg), nombre = lote.find((x) => x.nombre)?.nombre || "";
  await responderLote(env, de, msgs, nombre);
  return true;
}
// MODO ESPEJO (#espejo si): copia cada intercambio al 805-1515 para controlar al agente en los primeros días
async function espejo(env, de, antes, nombre) {
  if ((await env.ESTADO.get("espejo")) !== "si" || esAdmin(env, de)) return;
  const e = JSON.parse((await env.ESTADO.get(`v3:${de}`)) || "null");
  if (!e?.historial) return;
  const nuevos = e.historial.slice(Math.max(0, antes));
  if (!nuevos.length) return;
  const link = `${env.PUBLIC_URL || BASE_URL}/panel?tel=${de}`;
  const txt = `👁 ${e.nombre || nombre || ""} +${de}\n` + nuevos.map((h) => `${h.r === "c" ? "👤" : h.r === "h" ? "🧑‍💼" : "🤖"} ${String(h.t).slice(0, 400)}`).join("\n") + `\n${link}`;
  // Sin guardar en pendientes: si la ventana de 24 h con el admin está cerrada, se pierde (para no inundar)
  for (const a of (env.ADMIN_PHONE || "").split(",").map((x) => x.trim()).filter(Boolean)) await enviar(env, a, txt.slice(0, 3900));
}

// Arma una sola respuesta para todos los mensajes juntos. Mientras trabaja deja una copia
// (proc:TEL): si Cloudflare corta la tarea a la mitad, el cron la reintenta una vez.
async function responderLote(env, de, msgs, nombre, reintento = false) {
  const antes = (JSON.parse((await env.ESTADO.get(`v3:${de}`)) || "null")?.historial || []).length;
  await env.ESTADO.put(`proc:${de}`, JSON.stringify({ msgs, nombre, ts: Date.now(), reintento }), { expirationTtl: 3600 });
  try {
    // Textos y audios se unen en un solo mensaje; las imágenes van con ese texto como comentario
    const textos = [];
    let audio = false;
    for (const m of msgs) {
      if (m.type === "text") textos.push(m.text.body);
      else if (m.type === "audio") { const t = await transcribir(env, m.audio.id).catch(() => null); if (t) { textos.push(t); audio = true; } }
      else if (m.type === "image" && m.image?.caption) textos.push(m.image.caption);
    }
    const imagenes = msgs.filter((m) => m.type === "image");
    const ultimo = msgs[msgs.length - 1];
    await leidoYEscribiendo(env, ultimo.id);
    const unido = textos.join("\n").trim();
    const deMenu = msgs.some((m) => m.deMenu);
    if (!imagenes.length) {
      if (!unido) await enviar(env, de, "no llego a escuchar bien el audio, me lo escribis?");
      else await enCola(env, de, () => procesar(env, de, { type: "text", text: { body: unido }, audio, deMenu, id: ultimo.id }, nombre));
    } else {
      // Todas las fotos de la tanda juntas (ej. captura de precios + captura del peso): la IA las ve a la vez
      const img = { ...imagenes[0], image: { ...imagenes[0].image, caption: unido, extras: imagenes.slice(1, 5).map((m) => m.image.id) } };
      await enCola(env, de, () => procesar(env, de, img, nombre));
    }
  } catch (e) { console.log("Error respuesta", de, e?.stack || e); }
  finally { await env.ESTADO.delete(`proc:${de}`); }
  await espejo(env, de, antes, nombre).catch(() => {});
}
// Red de seguridad (cron cada minuto, o /procesar para forzar)
async function procesarBuffers(env, forzar) {
  const ahora = Date.now();
  // 1) Mensajes que nadie respondió (por ejemplo, si la espera en segundo plano no llegó a correr)
  const margen = forzar ? 0 : esperaMs(env) + 20000;
  for (const k of (await env.ESTADO.list({ prefix: "bu:" })).keys) {
    const u = JSON.parse((await env.ESTADO.get(k.name)) || "null");
    if (u && ahora - u.ts < margen) continue;
    await env.ESTADO.delete(k.name);
    try { if (await responderTel(env, k.name.slice(3))) console.log("Red de seguridad: respondido", k.name.slice(3)); }
    catch (e) { console.log("Error red", k.name, e?.stack || e); }
  }
  // 2) Respuestas cortadas a la mitad: se reintentan una sola vez
  for (const k of (await env.ESTADO.list({ prefix: "proc:" })).keys) {
    const p = JSON.parse((await env.ESTADO.get(k.name)) || "null");
    if (!p || p.reintento || ahora - p.ts < 90000) continue;
    console.log("Reintento de respuesta cortada", k.name.slice(5));
    await responderLote(env, k.name.slice(5), p.msgs, p.nombre, true);
  }
  // 3) Mensajes guardados con el sistema anterior (buf:), por única vez
  for (const k of (await env.ESTADO.list({ prefix: "buf:" })).keys) {
    const b = JSON.parse((await env.ESTADO.get(k.name)) || "null");
    await env.ESTADO.delete(k.name);
    if (b?.msgs?.length) await responderLote(env, k.name.slice(4), b.msgs, b.nombre || "");
  }
}


// Resumen cada hora al equipo (en vez de un aviso por cada mensaje)
async function anotarResumen(env, ev) {
  const r = JSON.parse((await env.ESTADO.get("resumen")) || "[]");
  r.push({ ...ev, ts: Date.now() });
  await env.ESTADO.put("resumen", JSON.stringify(r.slice(-200)), { expirationTtl: 3 * 86400 });
}
async function enviarResumen(env) {
  const r = JSON.parse((await env.ESTADO.get("resumen")) || "[]");
  if (!r.length) return;
  await env.ESTADO.delete("resumen");
  const link = (t) => `${env.PUBLIC_URL || BASE_URL}/panel?tel=${t}`;
  const unicos = (tipo) => [...new Map(r.filter((x) => x.tipo === tipo).map((x) => [x.tel, x])).values()];
  const nuevos = unicos("nuevo"), activos = unicos("mensaje"), pausados = unicos("pausado"), riesgos = unicos("riesgo"), segs = unicos("seguimiento");
  const leads = [];
  for (const x of activos) { const l = JSON.parse((await env.ESTADO.get(`lead:${x.tel}`)) || "null"); if (l) leads.push(l); }
  const orden = { caliente: 0, tibio: 1, frio: 2 };
  leads.sort((a, b) => (orden[a.temperatura] ?? 3) - (orden[b.temperatura] ?? 3) || (b.puntaje || 0) - (a.puntaje || 0));
  const pend = (await env.ESTADO.list({ prefix: "pend:" })).keys.filter((k) => k.name !== "pend:ultimo").length;
  let t = `📊 Resumen de la última hora\n\n` + (riesgos.length ? `🚨 CHATS EN RIESGO (revisalos primero):\n${riesgos.map((x) => `• ${x.nombre || "+" + x.tel}: ${String(x.texto).slice(0, 90)}\n${link(x.tel)}`).join("\n")}\n\n` : "") +
    `• ${activos.length} chats activos (${nuevos.length} nuevos)\n• ${pend} cotización(es) esperando tu OK` + (segs.length ? `\n• ${segs.length} seguimiento(s) enviados` : "");
  if (leads.length) t += `\n\nClientes:\n` + leads.slice(0, 12).map((l) => `${l.temperatura === "caliente" ? "🔥" : l.temperatura === "tibio" ? "🌤" : "❄️"} ${l.nombre_whatsapp || "+" + l.telefono} ${l.puntaje ? "(" + l.puntaje + "/10)" : ""}: ${(l.resumen || l.interes || "").slice(0, 110)}\n${link(l.telefono)}`).join("\n\n");
  if (pausados.length) t += `\n\nTe escribieron con el agente pausado:\n` + pausados.map((x) => `• ${x.nombre || "+" + x.tel}: "${String(x.texto).slice(0, 80)}" → #reanudar ${x.tel}`).join("\n");
  await avisarAdmins(env, t.slice(0, 3900));
}

// =====================================================================
//  PANEL 2.0: índice rápido de chats, eventos para métricas y reportes PDF
//  - "chats": una fila liviana por cliente (nombre, calidad, último mensaje) → la lista carga al instante
//  - "eventos": cada cliente nuevo, cotización, venta, derivación y producto consultado, con fecha → gráficos
//  - "reportes": resúmenes diarios, semanales y mensuales que arma la IA → PDF
// =====================================================================
const TZ_MS = 3 * 3600e3;   // Argentina = UTC-3
let tablasPanel = false;
async function prepararTablas(env) {
  if (tablasPanel || !env.DB) return;
  await env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS chats (tel TEXT PRIMARY KEY, nombre TEXT, cuando INTEGER DEFAULT 0, ult TEXT, ult_r TEXT, salud TEXT, etapa TEXT, derivado TEXT, resumen TEXT, temp TEXT, puntaje INTEGER, interes TEXT, rubro TEXT)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS chats_cuando ON chats(cuando)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS eventos (ts INTEGER, tipo TEXT, tel TEXT, dato TEXT)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS eventos_tipo_ts ON eventos(tipo, ts)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS tareas (id TEXT PRIMARY KEY, ts INTEGER, tipo TEXT, tel TEXT, nombre TEXT, titulo TEXT, detalle TEXT, datos TEXT, ref TEXT, estado TEXT)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS tareas_estado ON tareas(estado, ts)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS tareas_tel ON tareas(tel, estado)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS reportes (id TEXT PRIMARY KEY, tipo TEXT, desde INTEGER, hasta INTEGER, creado INTEGER, datos TEXT)"),
  ]);
  tablasPanel = true;
}

// Se llama sola cada vez que se guarda un chat, un lead o una pausa (desde el almacén)
async function indexar(env, k, v) {
  if (!env.DB || !/^(v3|lead):/.test(k)) return;
  try {
    await prepararTablas(env);
    if (k.startsWith("v3:")) {
      const tel = k.slice(3);
      if (v == null) { await env.DB.prepare("DELETE FROM chats WHERE tel = ?").bind(tel).run(); return; }
      const e = JSON.parse(v), h = e.historial || [], u = h[h.length - 1] || {};
      await env.DB.prepare("INSERT INTO chats (tel, nombre, cuando, ult, ult_r, salud, etapa, derivado, resumen) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(tel) DO UPDATE SET nombre=excluded.nombre, cuando=excluded.cuando, ult=excluded.ult, ult_r=excluded.ult_r, salud=excluded.salud, etapa=excluded.etapa, derivado=excluded.derivado, resumen=excluded.resumen")
        .bind(tel, e.nombre || "", e.ultimoMensaje || 0, String(u.t || "").slice(0, 140), u.n ? "n" : u.r || "", e.salud || "ok", e.etapa || "", e.derivado?.estado || "", String(e.resumen || "").slice(0, 300)).run();
    } else if (v != null) {
      const l = JSON.parse(v), tel = k.slice(5);
      await env.DB.prepare("INSERT INTO chats (tel, temp, puntaje, interes, rubro) VALUES (?,?,?,?,?) ON CONFLICT(tel) DO UPDATE SET temp=excluded.temp, puntaje=excluded.puntaje, interes=excluded.interes, rubro=excluded.rubro")
        .bind(tel, l.temperatura || "", +l.puntaje || 0, String(l.interes || "").slice(0, 80), l.rubro || "").run();
    }
  } catch (err) { console.log("Índice:", String(err).slice(0, 120)); }
}

async function evento(env, tipo, tel, dato = "") {
  if (!env.DB) return;
  try {
    await prepararTablas(env);
    await env.DB.prepare("INSERT INTO eventos (ts, tipo, tel, dato) VALUES (?,?,?,?)").bind(Date.now(), tipo, tel || "", String(dato || "").slice(0, 120)).run();
  } catch (err) { console.log("Evento:", String(err).slice(0, 100)); }
}

// Carga inicial: pasa los chats y leads que ya existían al índice y a las métricas (de a tandas, para no trabar)
async function reindexar(env, desde = "") {
  await prepararTablas(env);
  const rs = await env.DB.prepare("SELECT k, v FROM kv WHERE k > ? AND (k LIKE 'v3:%' OR k LIKE 'lead:%') ORDER BY k LIMIT 120").bind(desde).all();
  const filas = rs.results || [];
  const ins = "INSERT INTO eventos (ts, tipo, tel, dato) SELECT ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM eventos WHERE tipo = ? AND tel = ?)";
  for (const f of filas) {
    await indexar(env, f.k, f.v);
    try {
      const o = JSON.parse(f.v);
      if (f.k.startsWith("lead:")) {
        const tel = f.k.slice(5);
        if (o.primer_contacto) await env.DB.prepare(ins).bind(Date.parse(o.primer_contacto), "nuevo", tel, "", "nuevo", tel).run();
        if (o.interes) await env.DB.prepare(ins).bind(Date.parse(o.ultimo_contacto || o.primer_contacto) || Date.now(), "interes", tel, String(o.interes).toLowerCase().slice(0, 60), "interes", tel).run();
      } else {
        const tel = f.k.slice(3);
        if (o.derivado?.cuando) await env.DB.prepare(ins).bind(Date.parse(o.derivado.cuando), "derivado", tel, o.derivado.estado || "", "derivado", tel).run();
        if (o.pagado) await env.DB.prepare(ins).bind(Date.parse(o.pagado), "venta", tel, "", "venta", tel).run();
      }
    } catch {}
  }
  const siguiente = filas.length === 120 ? filas[filas.length - 1].k : null;
  if (!siguiente) await env.ESTADO.put("panel_indexado", "2");
  return { procesados: filas.length, siguiente };
}

// ---------- Períodos (hora argentina) ----------
const inicioDiaAR = (ms) => Math.floor((ms - TZ_MS) / 86400e3) * 86400e3 + TZ_MS;
function periodo(p, ahora = Date.now()) {
  const dias = p === "mes" ? 30 : p === "semana" ? 7 : 1;
  const desde = inicioDiaAR(ahora) - (dias - 1) * 86400e3;
  return { p, dias, desde, hasta: ahora, prevDesde: desde - dias * 86400e3, prevHasta: ahora - dias * 86400e3 };
}
const fechaAR = (ms) => new Date(ms - TZ_MS).toISOString().slice(0, 10);
const fechaVista = (ms) => { const d = new Date(ms - TZ_MS); return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`; };
const fechaCorta = (ms) => { const d = new Date(ms - TZ_MS); return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}`; };

const TIPOS_KPI = ["nuevo", "cotizacion", "venta", "derivado"];
async function metricas(env, desde, hasta) {
  await prepararTablas(env);
  const q = (sql, ...b) => env.DB.prepare(sql).bind(...b).all().then((r) => r.results || []);
  const cuenta = async (d, h) => Object.fromEntries((await q("SELECT tipo, COUNT(*) n FROM eventos WHERE ts >= ? AND ts < ? AND tipo IN ('nuevo','cotizacion','venta','derivado') GROUP BY tipo", d, h)).map((r) => [r.tipo, r.n]));
  const [kpis, temps, motivos, productos, cotiz, activos] = await Promise.all([
    cuenta(desde, hasta),
    q("SELECT COALESCE(NULLIF(temp,''),'sin dato') temp, COUNT(*) n FROM chats WHERE cuando >= ? AND cuando < ? GROUP BY 1", desde, hasta),
    q("SELECT COALESCE(NULLIF(dato,''),'otro') motivo, COUNT(*) n FROM eventos WHERE tipo = 'derivado' AND ts >= ? AND ts < ? GROUP BY 1 ORDER BY 2 DESC LIMIT 6", desde, hasta),
    q("SELECT lower(dato) producto, COUNT(*) n FROM eventos WHERE tipo = 'interes' AND dato <> '' AND ts >= ? AND ts < ? GROUP BY 1 ORDER BY 2 DESC LIMIT 8", desde, hasta),
    q("SELECT CASE WHEN dato LIKE 'combo%' THEN 'combo' ELSE 'china' END tipo, COUNT(*) n FROM eventos WHERE tipo = 'cotizacion' AND ts >= ? AND ts < ? GROUP BY 1", desde, hasta),
    q("SELECT COUNT(*) n FROM chats WHERE cuando >= ? AND cuando < ?", desde, hasta),
  ]);
  return { kpis, temps, motivos, productos, cotiz, activos: activos[0]?.n || 0 };
}

async function dashboard(env, p) {
  const P = periodo(p);
  const balde = P.dias === 1 ? 3600e3 : 86400e3, n = P.dias === 1 ? 24 : P.dias;
  const [act, prev, serieRows] = await Promise.all([
    metricas(env, P.desde, P.hasta),
    (async () => { await prepararTablas(env); const r = await env.DB.prepare("SELECT tipo, COUNT(*) n FROM eventos WHERE ts >= ? AND ts < ? AND tipo IN ('nuevo','cotizacion','venta','derivado') GROUP BY tipo").bind(P.prevDesde, P.prevHasta).all(); return Object.fromEntries((r.results || []).map((x) => [x.tipo, x.n])); })(),
    (async () => { await prepararTablas(env); return (await env.DB.prepare("SELECT tipo, CAST((ts - ?) / ? AS INTEGER) b, COUNT(*) n FROM eventos WHERE ts >= ? AND ts < ? AND tipo IN ('nuevo','cotizacion','venta') GROUP BY tipo, b").bind(P.desde, balde, P.desde, P.hasta).all()).results || []; })(),
  ]);
  const etiquetas = Array.from({ length: n }, (_, i) => P.dias === 1 ? `${String(i).padStart(2, "0")}h` : fechaCorta(P.desde + i * 86400e3));
  const serie = Object.fromEntries(["nuevo", "cotizacion", "venta"].map((t) => [t, Array(n).fill(0)]));
  for (const r of serieRows) if (serie[r.tipo] && r.b >= 0 && r.b < n) serie[r.tipo][r.b] = r.n;
  return { periodo: P, kpis: act.kpis, previo: prev, etiquetas, serie, temps: act.temps, motivos: act.motivos, productos: act.productos, cotiz: act.cotiz, activos: act.activos };
}

// ---------- Reportes (los arma la IA al cerrar el día, la semana y el mes) ----------
async function generarReporte(env, tipo, desde, hasta) {
  await prepararTablas(env);
  const m = await metricas(env, desde, hasta);
  const clientes = (await env.DB.prepare("SELECT nombre, tel, temp, puntaje, interes, resumen FROM chats WHERE cuando >= ? AND cuando < ? ORDER BY COALESCE(puntaje,0) DESC LIMIT 50").bind(desde, hasta).all()).results || [];
  const k = (t) => m.kpis[t] || 0;
  const base = {
    titular: `${k("nuevo")} clientes nuevos, ${k("cotizacion")} cotizaciones y ${k("venta")} ventas`,
    resumen: "", productos_mas_consultados: m.productos.map((x) => ({ producto: x.producto, consultas: x.n, nota: "" })),
    publicitar: [], mensajes_para_grupos: [], reforzar: [], oportunidades: clientes.filter((c) => c.temp === "caliente").slice(0, 5).map((c) => `${c.nombre || "+" + c.tel}: ${c.interes || c.resumen || ""}`.slice(0, 160)), alertas: [], acciones: [],
  };
  const nombre = { dia: "del día", semana: "de la semana", mes: "del mes" }[tipo];
  const r = await iaJSON(env, `Sos el analista comercial de "Te Importamos" (importaciones por encargo en Rosario: China, Paraguay, Brasil, EE. UU. y Argentina; vende a revendedores y particulares; tiene catálogo web, grupo mayorista de WhatsApp e Instagram/TikTok). Armá el reporte ${nombre} para el dueño: concreto, accionable, NADA de relleno. Español rioplatense, sin emojis.
DATOS DEL PERÍODO (${fechaAR(desde)} a ${fechaAR(hasta - 1)}):
- Clientes nuevos: ${k("nuevo")} · Cotizaciones enviadas: ${k("cotizacion")} · Ventas cerradas: ${k("venta")} · Derivados al equipo: ${k("derivado")} · Chats activos: ${m.activos}
- Calidad de leads: ${m.temps.map((t) => `${t.temp} ${t.n}`).join(", ") || "-"}
- Productos más consultados: ${m.productos.map((p) => `${p.producto} (${p.n})`).join(", ") || "-"}
- Motivos de derivación: ${m.motivos.map((x) => `${x.motivo} (${x.n})`).join(", ") || "-"}
- Clientes (nombre | calidad | interés | resumen):
${clientes.map((c) => `${c.nombre || c.tel} | ${c.temp || "-"} ${c.puntaje || ""} | ${c.interes || "-"} | ${String(c.resumen || "").slice(0, 160)}`).join("\n") || "-"}
Respondé SOLO JSON (máximo 5 ítems por lista, cada ítem una o dos oraciones cortas):
{"titular":"una oración con lo más importante","resumen":"3 a 4 oraciones","productos_mas_consultados":[{"producto":"","consultas":0,"nota":"qué hacer con ese producto"}],"publicitar":["producto + dónde (historias, grupo mayorista, TikTok) + por qué"],"mensajes_para_grupos":["mensaje listo para pegar en el grupo mayorista, informal, minúscula"],"reforzar":["qué productos o rubros aumentar en proporción (stock, cupos, combos) y por qué"],"oportunidades":["cliente caliente o tibio a contactar: nombre + qué ofrecerle"],"alertas":["problemas detectados: clientes que se enfriaron, errores del agente, consultas sin respuesta"],"acciones":["acción concreta y prioritaria"]}`);
  const datos = { ...base, ...(r || {}), kpis: m.kpis, activos: m.activos, temps: m.temps };
  if (!r) datos.resumen = "Reporte armado solo con los números (la IA no respondió en ese momento).";
  const id = `${tipo}-${fechaAR(hasta - 1)}`;
  await env.DB.prepare("INSERT INTO reportes (id, tipo, desde, hasta, creado, datos) VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET desde=excluded.desde, hasta=excluded.hasta, creado=excluded.creado, datos=excluded.datos")
    .bind(id, tipo, desde, hasta, Date.now(), JSON.stringify(datos)).run();
  return id;
}

// Cierre automático: 23:55 hora argentina → reporte del día; domingos también el semanal; último día del mes, el mensual
async function reportesProgramados(env, ms) {
  const ar = new Date(ms - TZ_MS);
  if (!(ar.getUTCHours() === 23 && ar.getUTCMinutes() === 55)) return;
  const hoy = inicioDiaAR(ms), fin = hoy + 86400e3;
  await generarReporte(env, "dia", hoy, fin);
  if (ar.getUTCDay() === 0) await generarReporte(env, "semana", fin - 7 * 86400e3, fin);
  if (new Date(fin - TZ_MS + 3600e3).getUTCDate() === 1) await generarReporte(env, "mes", Date.UTC(ar.getUTCFullYear(), ar.getUTCMonth(), 1) + TZ_MS, fin);
}

// ---------- PDF (generado en el momento, sin servicios externos) ----------
function pdfTexto(s) {
  const mapa = { "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94, "•": 0x95, "–": 0x96, "—": 0x97, "€": 0x80 };
  let out = "";
  for (const ch of String(s ?? "")) {
    const c = ch.codePointAt(0), b = mapa[ch] ?? (c >= 32 && c < 256 ? c : null);
    if (b == null) continue;
    const x = String.fromCharCode(b);
    out += x === "(" || x === ")" || x === "\\" ? "\\" + x : x;
  }
  return out;
}
function crearPDF(doc) {
  const W = 595, H = 842, M = 48, paginas = [];
  let ops = [], y = H - M;
  const nueva = () => { paginas.push(ops.join("\n")); ops = []; y = H - M; };
  const ancho = (t, s, b) => String(t).length * s * (b ? 0.55 : 0.5);
  const envolver = (t, s, max, b) => { const out = []; let l = ""; for (const w of String(t ?? "").split(/\s+/).filter(Boolean)) { const pr = l ? l + " " + w : w; if (ancho(pr, s, b) > max && l) { out.push(l); l = w; } else l = pr; } if (l) out.push(l); return out; };
  const txt = (t, x, s, b, color = "0.12 0.14 0.18") => ops.push(`BT ${color} rg /${b ? "F2" : "F1"} ${s} Tf ${x.toFixed(1)} ${y.toFixed(1)} Td (${pdfTexto(t)}) Tj ET`);
  const lugar = (h) => { if (y - h < M + 20) nueva(); };
  // Encabezado azul
  ops.push(`0.11 0.31 0.85 rg 0 ${H - 96} ${W} 96 re f`);
  y = H - 44; txt(doc.titulo, M, 20, true, "1 1 1");
  y = H - 68; txt(doc.subtitulo, M, 11, false, "0.86 0.91 1");
  y = H - 124;
  // KPIs
  if (doc.kpis?.length) {
    const bw = (W - 2 * M - 3 * 10) / 4;
    doc.kpis.forEach(([etq, val], i) => {
      const x = M + i * (bw + 10);
      ops.push(`0.86 0.9 0.97 RG 1 w ${x} ${y - 46} ${bw} 56 re S`);
      const yy = y; y = yy - 12; txt(String(val), x + 10, 20, true, i === 2 ? "0.86 0.15 0.15" : "0.11 0.31 0.85");
      y = yy - 36; txt(etq, x + 10, 9, false, "0.4 0.45 0.52"); y = yy;
    });
    y -= 76;
  }
  for (const sec of doc.secciones) {
    if (!sec.items?.length && !sec.texto) continue;
    lugar(40);
    txt(sec.titulo.toUpperCase(), M, 11, true, "0.11 0.31 0.85");
    ops.push(`0.11 0.31 0.85 RG 1.2 w ${M} ${y - 5} m ${M + 40} ${y - 5} l S`);
    y -= 20;
    if (sec.texto) for (const l of envolver(sec.texto, 10.5, W - 2 * M)) { lugar(15); txt(l, M, 10.5); y -= 15; }
    for (const it of sec.items || []) {
      const lineas = envolver(it, 10.5, W - 2 * M - 14);
      lugar(15 * lineas.length);
      lineas.forEach((l, i) => { if (!i) txt("•", M + 2, 10.5, true, "0.86 0.15 0.15"); txt(l, M + 14, 10.5); y -= 15; });
      y -= 3;
    }
    y -= 12;
  }
  paginas.push(ops.join("\n"));
  // Armado del archivo
  const objs = [null, "<< /Type /Catalog /Pages 2 0 R >>", "", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>"];
  const kids = [];
  paginas.forEach((cont, i) => {
    const pie = `\nBT 0.55 0.6 0.66 rg /F1 8 Tf ${M} 24 Td (${pdfTexto(`Te Importamos · ${doc.subtitulo} · página ${i + 1} de ${paginas.length}`)}) Tj ET`;
    const c = cont + pie;
    objs.push(`<< /Length ${c.length} >>\nstream\n${c}\nendstream`);
    const cId = objs.length - 1;
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${cId} 0 R >>`);
    kids.push(`${objs.length - 1} 0 R`);
  });
  objs[2] = `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${kids.length} >>`;
  let pdf = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
  const off = [];
  for (let i = 1; i < objs.length; i++) { off[i] = pdf.length; pdf += `${i} 0 obj\n${objs[i]}\nendobj\n`; }
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length}\n0000000000 65535 f \n` + off.slice(1).map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("");
  pdf += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  const bytes = new Uint8Array(pdf.length);
  for (let i = 0; i < pdf.length; i++) bytes[i] = pdf.charCodeAt(i) & 0xff;
  return bytes;
}
function pdfReporte(fila) {
  const d = JSON.parse(fila.datos || "{}"), k = d.kpis || {};
  const nombre = { dia: "Reporte diario", semana: "Reporte semanal", mes: "Reporte mensual" }[fila.tipo] || "Reporte";
  const rango = fila.tipo === "dia" ? fechaVista(fila.desde) : `${fechaVista(fila.desde)} al ${fechaVista(fila.hasta - 1)}`;
  return crearPDF({
    titulo: `${nombre} · Te Importamos`, subtitulo: rango,
    kpis: [["Clientes nuevos", k.nuevo || 0], ["Cotizaciones enviadas", k.cotizacion || 0], ["Ventas cerradas", k.venta || 0], ["Derivados por el agente", k.derivado || 0]],
    secciones: [
      { titulo: "En una línea", texto: d.titular },
      { titulo: "Resumen", texto: d.resumen },
      { titulo: "Productos más consultados", items: (d.productos_mas_consultados || []).map((p) => `${p.producto}${p.consultas ? ` (${p.consultas})` : ""}${p.nota ? ": " + p.nota : ""}`) },
      { titulo: "Qué publicitar (historias y grupos)", items: d.publicitar },
      { titulo: "Mensajes listos para los grupos", items: d.mensajes_para_grupos },
      { titulo: "Qué reforzar o aumentar", items: d.reforzar },
      { titulo: "Oportunidades: clientes a contactar", items: d.oportunidades },
      { titulo: "Alertas", items: d.alertas },
      { titulo: "Acciones prioritarias", items: d.acciones },
    ],
  });
}

// ---------- API del panel ----------
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
async function panelAPI(env, req, url, quien) {
  const ruta = url.pathname.replace("/panel/api/", "");
  await prepararTablas(env);
  if (ruta === "importar-viejos") return json({ n: (await importarViejos(env)) + (await limpiezaV13(env)) + (await reabrirV144(env)) });
  if (ruta === "estado") return json({ indexado: (await env.ESTADO.get("panel_indexado")) === "2", usuario: quien });
  if (ruta === "reindexar") return json(await reindexar(env, url.searchParams.get("desde") || ""));
  if (ruta === "tareas") {
    const rs = await env.DB.prepare("SELECT * FROM tareas WHERE estado = 'abierta' ORDER BY ts DESC LIMIT 200").all();
    return json((rs.results || []).filter((t) => !esAdmin(env, t.tel)).map((t) => ({ ...t, datos: JSON.parse(t.datos || "{}") })));
  }
  if (ruta === "tarea" && req.method === "POST") {
    const { id, a } = await req.json();
    const t = await env.DB.prepare("SELECT * FROM tareas WHERE id = ?").bind(id || "").first();
    if (!t) return json({ ok: false, res: "Ya no existe" });
    let res = "Listo";
    if (t.tipo === "cotizacion" && (a === "ok" || a === "no")) res = await comandoAdmin(env, null, `#${a} ${t.ref}`);
    else if (t.tipo === "comprobante" && (a === "ok" || a === "no")) res = await comandoAdmin(env, null, `#pago ${t.ref} ${a}`);
    else if (a === "enviar" && t.tipo === "recontactar") {
      const msg = String((JSON.parse(t.datos || "{}")).mensaje || "");
      const ok = await enviar(env, t.tel, msg);
      res = ok ? "Enviado" : "WhatsApp no deja mandarlo desde el agente (pasaron más de 24 h). Usá el botón 'Abrir en mi WhatsApp'.";
      if (!ok) return json({ ok: false, res });
    }
    if (t.tipo === "riesgo") { const e = JSON.parse((await env.ESTADO.get(`v3:${t.tel}`)) || "null"); if (e) { e.salud = "ok"; e.saludMotivo = "revisado por el equipo"; await env.ESTADO.put(`v3:${t.tel}`, JSON.stringify(e), { expirationTtl: 90 * 86400 }); } }
    await cerrarTareas(env, { id: t.id });
    return json({ ok: true, res: typeof res === "string" ? res : "Listo" });
  }
  if (ruta === "chats") {
    const rs = await env.DB.prepare("SELECT c.tel, c.nombre, c.cuando, c.ult, c.ult_r, c.salud, c.temp, c.puntaje, c.derivado, (p.k IS NOT NULL) pausado, (SELECT COUNT(*) FROM tareas t WHERE t.tel = c.tel AND t.estado = 'abierta') pend FROM chats c LEFT JOIN kv p ON p.k = 'pausa:' || c.tel AND (p.exp IS NULL OR p.exp > ?) WHERE c.cuando > 0 ORDER BY c.cuando DESC LIMIT 400").bind(Date.now()).all();
    return json((rs.results || []).filter((c) => !esAdmin(env, c.tel)).map((c) => ({ tel: c.tel, nombre: c.nombre || "", cuando: c.cuando, temp: c.temp || "", puntaje: c.puntaje || 0, espera: c.ult_r === "c", pausado: !!c.pausado, riesgo: c.salud && c.salud !== "ok", pend: c.pend || 0 })));
  }
  const tel = (url.searchParams.get("tel") || "").replace(/\D/g, "");
  if (ruta === "chat") {
    const e = JSON.parse((await env.ESTADO.get(`v3:${tel}`)) || "null") || { historial: [] };
    const fila = await env.DB.prepare("SELECT temp, puntaje FROM chats WHERE tel = ?").bind(tel).first();
    return json({ tel, nombre: e.nombre || "", temp: fila?.temp || "", puntaje: fila?.puntaje || 0, pausado: !!(await env.ESTADO.get(`pausa:${tel}`)), salud: e.salud || "ok", motivo: e.saludMotivo || "", resumen: e.resumen || "", derivado: e.derivado?.estado || "",
      fallos: JSON.parse((await env.ESTADO.get("fallos_envio")) || "[]").filter((x) => ultimos10(x.tel) === ultimos10(tel) && Date.now() - x.ts < 48 * 3600e3).slice(0, 5),
      mensajes: await (async () => {
        const ids = (e.historial || []).map((h) => h.wid).filter(Boolean).slice(-40);
        const est = {};
        if (ids.length) for (const f of (await env.DB.prepare(`SELECT k, v FROM kv WHERE k IN (${ids.map(() => "?").join(",")})`).bind(...ids.map((x) => "st:" + x)).all()).results || []) est[f.k.slice(3)] = f.v;
        return (e.historial || []).map((h) => ({ r: h.n ? "n" : h.r, t: h.t, img: h.img || [], ts: h.ts || 0, arch: h.arch || null, st: h.wid ? est[h.wid] || "sent" : "" }));
      })(), oferta: e.oferta && e.oferta.vence > Date.now() ? e.oferta.texto : "" });
  }
  if (ruta === "enviar" && req.method === "POST") {
    const { tel: t2, texto } = await req.json();
    const t = String(t2 || "").replace(/\D/g, ""), msg = String(texto || "").trim();
    if (!t || !msg) return json({ ok: false }, 400);
    const ok = await enviar(env, t, msg);
    const e = JSON.parse((await env.ESTADO.get(`v3:${t}`)) || "null") || { historial: [] };
    e.historial = [...(e.historial || []), { r: "h", t: `(${quien}) ${msg}`.slice(0, 2000), ts: Date.now(), ...(typeof ok === "string" ? { wid: ok } : {}) }].slice(-60);
    await env.ESTADO.put(`pausa:${t}`, "1", { expirationTtl: 12 * 3600 });
    await env.ESTADO.delete(`seg:${t}`);
    await env.ESTADO.put(`v3:${t}`, JSON.stringify(e), { expirationTtl: 90 * 86400 });
    if (ok) await cerrarTareas(env, { tel: t, tipos: ["derivado", "promesa", "riesgo", "recontactar"] });
    return json({ ok: !!ok });
  }
  if (ruta === "archivo" && req.method === "POST") {
    const f = await req.formData();
    const t = String(f.get("tel") || "").replace(/\D/g, ""), file = f.get("file");
    if (!t || !file || typeof file === "string") return json({ ok: false, res: "Falta el archivo" }, 400);
    const mime = file.type || "application/octet-stream";
    const tipo = /^image\/(jpeg|png)$/.test(mime) ? "image" : /^audio\//.test(mime) ? "audio" : "document";
    if (tipo === "audio" && !/ogg|mpeg|aac|amr/.test(mime)) return json({ ok: false, res: "Ese formato de audio no lo acepta WhatsApp. Recargá el panel (Ctrl+F5) para usar el grabador nuevo." });
    const lim = { image: 5, audio: 16, document: 100 }[tipo];
    if (file.size > lim * 1048576) return json({ ok: false, res: `El archivo pesa más de ${lim} MB (límite de WhatsApp)` });
    const fd = new FormData();
    fd.append("messaging_product", "whatsapp");
    fd.append("type", mime.split(";")[0]);
    fd.append("file", new Blob([await file.arrayBuffer()], { type: mime.split(";")[0] }), file.name || (tipo === "audio" ? "audio.ogg" : "archivo"));
    const up = await fetch(`https://graph.facebook.com/v21.0/${env.WA_PHONE_ID}/media`, { method: "POST", headers: { Authorization: `Bearer ${env.WA_TOKEN}` }, body: fd }).then((x) => x.json()).catch((err) => ({ error: { message: String(err) } }));
    if (!up.id) return json({ ok: false, res: "WhatsApp no aceptó el archivo: " + (up.error?.message || "error") });
    const nombre = file.name || "archivo";
    const pie = String(f.get("texto") || "").trim();
    const cuerpo = tipo === "image" ? { type: "image", image: { id: up.id, ...(pie ? { caption: pie } : {}) } } : tipo === "audio" ? { type: "audio", audio: { id: up.id } } : { type: "document", document: { id: up.id, filename: nombre, ...(pie ? { caption: pie } : {}) } };
    const ok = await enviarRaw(env, t, cuerpo);
    if (!ok) return json({ ok: false, res: "No se pudo enviar (¿pasaron más de 24 h desde el último mensaje del cliente?)" });
    const e = JSON.parse((await env.ESTADO.get(`v3:${t}`)) || "null") || { historial: [] };
    e.historial = [...(e.historial || []), { r: "h", t: `(${quien}) ` + (tipo === "image" ? (pie || "(imagen)") : tipo === "audio" ? "(audio)" : `(archivo) ${nombre}${pie ? " · " + pie : ""}`), ts: Date.now(), ...(typeof ok === "string" ? { wid: ok } : {}), ...(tipo === "image" ? { img: [up.id] } : { arch: { id: up.id, tipo, nombre } }) }].slice(-60);
    await env.ESTADO.put(`pausa:${t}`, "1", { expirationTtl: 12 * 3600 });
    await env.ESTADO.put(`v3:${t}`, JSON.stringify(e), { expirationTtl: 90 * 86400 });
    await cerrarTareas(env, { tel: t, tipos: ["derivado", "promesa", "riesgo", "recontactar"] });   // "Buscar proveedor" y "Quiere comprar" NO se cierran por mandar un mensaje: solo cuando el equipo toca "Listo"
    return json({ ok: true });
  }
  if (ruta === "reporte-borrar" && req.method === "POST") {
    const { id } = await req.json();
    await env.DB.prepare("DELETE FROM reportes WHERE id = ?").bind(String(id || "")).run();
    return json({ ok: true });
  }
  if (ruta === "tareas-cerrar-tipo" && req.method === "POST") {
    const { tipo } = await req.json();
    await env.DB.prepare("UPDATE tareas SET estado = 'hecha' WHERE tipo = ? AND estado = 'abierta'").bind(String(tipo || "")).run();
    return json({ ok: true });
  }
  if (ruta === "exportar") {
    const horas = Math.min(+(url.searchParams.get("h") || 24), 168), desde = Date.now() - horas * 3600e3;
    const filas = (await env.DB.prepare("SELECT tel FROM chats WHERE cuando > ? ORDER BY cuando DESC").bind(desde).all()).results || [];
    const fallos = JSON.parse((await env.ESTADO.get("fallos_envio")) || "[]");
    const pend = (await env.DB.prepare("SELECT tel, tipo, titulo FROM tareas WHERE estado = 'abierta'").all()).results || [];
    const hh = (ts) => ts ? new Date(ts).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }) : "--";
    let txt = `EXPORT DE CHATS · Te Importamos · últimas ${horas} h · generado ${hh(Date.now())}\nChats: ${filas.length}\nC = cliente · A = agente · E = equipo · N = nota\n`;
    for (const { tel } of filas) {
      if (esAdmin(env, tel)) continue;
      const e = JSON.parse((await env.ESTADO.get(`v3:${tel}`)) || "null"); if (!e) continue;
      const lead = JSON.parse((await env.ESTADO.get(`lead:${tel}`)) || "null") || {};
      const ms = (e.historial || []).filter((h) => !h.ts || h.ts > desde - 6 * 3600e3);
      txt += `\n\n==================== ${e.nombre || "(sin nombre)"} · +${tel} ====================\n`;
      txt += `temperatura: ${lead.temperatura || "-"} ${lead.puntaje || ""} · etapa: ${e.etapa || "-"}${e.derivado ? " · derivado: " + e.derivado.estado : ""}${e.salud && e.salud !== "ok" ? " · RIESGO: " + (e.saludMotivo || "") : ""}${(await env.ESTADO.get(`pausa:${tel}`)) ? " · PAUSADO" : ""}\n`;
      if (e.resumen) txt += `resumen: ${e.resumen}\n`;
      const p = pend.filter((x) => x.tel === tel); if (p.length) txt += `pendientes: ${p.map((x) => x.titulo).join(" | ")}\n`;
      const f = fallos.filter((x) => ultimos10(x.tel) === ultimos10(tel) && x.ts > desde); if (f.length) txt += `NO ENTREGADOS: ${f.map((x) => hh(x.ts) + " " + x.det.slice(0, 60)).join(" | ")}\n`;
      txt += ms.map((h) => `[${hh(h.ts)}] ${{ c: "C", a: "A", h: "E" }[h.r] || "N"}: ${String(h.t).replace(/\s+/g, " ")}${(h.img || []).length ? " [imagen]" : ""}`).join("\n");
    }
    return new Response(txt, { headers: { "Content-Type": "text/plain; charset=utf-8", "Content-Disposition": `attachment; filename="chats-${new Date().toISOString().slice(0, 10)}.txt"` } });
  }
  if (ruta === "fallos") return json(JSON.parse((await env.ESTADO.get("fallos_envio")) || "[]").map((x) => ({ ...x, cuando: new Date(x.ts).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" }) })));
  if (ruta === "agente-hilo") return json(await hiloAgente(env, url.searchParams.get("a") || "whatsapp"));
  if (ruta === "agente" && req.method === "POST") return json(await hablarConAgente(env, await req.json(), quien));
  if (ruta === "agente-aplicar" && req.method === "POST") return json(await aplicarAgente(env, await req.json(), quien));
  if (ruta === "accion" && req.method === "POST") {
    const { tel: t2, a } = await req.json();
    const t = String(t2 || "").replace(/\D/g, "");
    let res = "listo";
    if (a === "pausa") { await env.ESTADO.put(`pausa:${t}`, "1", { expirationTtl: 12 * 3600 }); await env.ESTADO.delete(`seg:${t}`); res = "Chat tomado: el agente queda en pausa 12 h"; }
    if (a === "reanudar") { await env.ESTADO.delete(`pausa:${t}`); res = await retomar(env, t).catch((err) => "error: " + err); }
    if (a === "bien") { const e = JSON.parse((await env.ESTADO.get(`v3:${t}`)) || "null"); if (e) { e.salud = "ok"; e.saludMotivo = "revisado por el equipo"; await env.ESTADO.put(`v3:${t}`, JSON.stringify(e), { expirationTtl: 90 * 86400 }); } }
    return json({ ok: true, res });
  }
  if (ruta === "dashboard") return json(await dashboard(env, url.searchParams.get("p") || "dia"));
  if (ruta === "reportes") {
    const tipo = url.searchParams.get("p") || "todos";
    const rs = tipo === "todos" ? await env.DB.prepare("SELECT id, tipo, desde, hasta, creado, json_extract(datos, '$.titular') titular FROM reportes ORDER BY creado DESC LIMIT 90").all()
      : await env.DB.prepare("SELECT id, tipo, desde, hasta, creado, json_extract(datos, '$.titular') titular FROM reportes WHERE tipo = ? ORDER BY creado DESC LIMIT 60").bind(tipo).all();
    return json((rs.results || []).map((r) => ({ ...r, generado: r.creado ? new Date(+r.creado).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }) : "", fecha: r.tipo === "dia" ? fechaVista(r.desde) : `${fechaVista(r.desde)} al ${fechaVista(r.hasta - 1)}` })));
  }
  if (ruta === "generar" && req.method === "POST") {
    const { p } = await req.json(), P = periodo(p);
    return json({ id: await generarReporte(env, p, P.desde, P.hasta) });
  }
  return json({ error: "no existe" }, 404);
}
// ---------------- Pestaña "Agentes": el equipo habla con cada agente, le enseña y le pide acciones ----------------
const AGENTES = {
  whatsapp: { nombre: "Agente de WhatsApp", clave: "aprendido" },
  instagram: { nombre: "Agente de Instagram", clave: "ig_reglas" },
};
async function hiloAgente(env, a) {
  const ag = AGENTES[a] || AGENTES.whatsapp;
  return { hilo: JSON.parse((await env.ESTADO.get(`agente_hilo:${a}`)) || "[]"), reglas: JSON.parse((await env.ESTADO.get(ag.clave)) || "[]") };
}
async function iaConImagenes(env, prompt, imagenes) {
  const partes = [{ text: prompt }, ...imagenes.slice(0, 6).map((d) => { const m = String(d).match(/^data:([^;]+);base64,(.+)$/); return m ? { inline_data: { mime_type: m[1], data: m[2] } } : null; }).filter(Boolean)];
  for (const m of (await modelosDisponibles(env)).slice(0, 3)) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, { method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_KEY },
      body: JSON.stringify({ contents: [{ parts: partes }], generationConfig: { responseMimeType: "application/json", temperature: 0.4 } }) }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : {};
    if (!r?.ok || j.error) continue;
    const t = (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("");
    const mm = t.match(/\{[\s\S]*\}/); if (mm) { try { return JSON.parse(mm[0]); } catch {} }
  }
  return null;
}
async function hablarConAgente(env, { agente, texto, imagenes }, quien) {
  const a = AGENTES[agente] ? agente : "whatsapp", ag = AGENTES[a];
  const { hilo, reglas } = await hiloAgente(env, a);
  texto = String(texto || "").slice(0, 4000); imagenes = Array.isArray(imagenes) ? imagenes : [];
  // MODO PRUEBA: "probá: mensaje de un cliente" → muestra qué le respondería, sin mandar nada
  const pm = a === "whatsapp" && texto.match(/^\s*prob[aá](?:r)?\s*[:\-]?\s*([\s\S]+)/i);
  if (pm) {
    const prueba = pm[1].trim(), fake = { historial: [], nombre: "Cliente de prueba", actual: {}, etapa: "libre" };
    const r = await cerebro(env, fake, prueba, null, null, { primerContacto: true, catalogoRelevante: await catalogoParaIA(env, prueba, prueba) }).catch(() => null);
    let resp = r ? `🧪 PRUEBA (no se mandó nada). Si un cliente nuevo escribe "${prueba}", le respondería:\n\n${String(r.respuesta || "(nada)").split("||").map((x) => "› " + x.trim()).join("\n")}` : "No pude simular la respuesta (la IA no respondió). Probá de nuevo.";
    if (r?.accion === "derivar") resp += `\n\n⚠️ Además lo DERIVARÍA al equipo (${r.derivacion?.estado || "consulta"}) y le diría "esto lo ve el equipo directamente".`;
    if (r && (ES_VAPER.test(prueba) && !NO_VAPER.test(prueba) || r.es_vaper)) resp = `🧪 PRUEBA: es una consulta de vapers → respondería "${VAPERS.respuesta}" y avisaría a tu socio.`;
    if (r) resp += `\n\nNota: la prueba muestra lo que decide la IA. Si el mensaje es solo un saludo o el texto del link, en la realidad va el menú.`;
    const nuevo = [...hilo, { r: "u", t: texto, ts: Date.now() }, { r: "a", t: resp, ts: Date.now() }].slice(-40);
    await env.ESTADO.put(`agente_hilo:${a}`, JSON.stringify(nuevo));
    return { ok: true, ...(await hiloAgente(env, a)) };
  }
  // Chats que menciona (por nombre o número)
  let chats = "";
  if (a === "whatsapp") {
    const palabras = [...new Set((texto.match(/\+?\d{8,15}|[A-Za-zÁÉÍÓÚÑáéíóúñ]{3,}/g) || []).map((x) => x.replace(/\D/g, "").length >= 8 ? x.replace(/\D/g, "") : x))].filter((x) => !/^(que|los|las|del|por|para|con|una|uno|este|esta|esto|chat|cliente|agente|cuando|como|donde|porque|pero|mas|muy|todo|todos|bien|mal|nada|algo|ese|esa|eso|riesgo|cotizacion|mandale|decile|hace|hizo|tenes|tiene|esta|estas)$/i.test(x)).slice(0, 12);
    const enc = new Map();
    for (const p of palabras) {
      if (enc.size >= 3) break;
      const rs = /^\d+$/.test(p) ? await env.DB.prepare("SELECT tel, nombre FROM chats WHERE tel LIKE ? LIMIT 2").bind(`%${p.slice(-8)}%`).all() : await env.DB.prepare("SELECT tel, nombre FROM chats WHERE lower(nombre) LIKE ? ORDER BY cuando DESC LIMIT 2").bind(`%${p.toLowerCase()}%`).all();
      for (const c of rs.results || []) if (!enc.has(c.tel)) enc.set(c.tel, c.nombre);
    }
    for (const [tel, nombre] of enc) {
      const e = JSON.parse((await env.ESTADO.get(`v3:${tel}`)) || "null"); if (!e) continue;
      const pend = (await env.DB.prepare("SELECT tipo, titulo, ref FROM tareas WHERE tel = ? AND estado = 'abierta'").bind(tel).all()).results || [];
      chats += `\n### Chat de ${nombre || "?"} (tel ${tel})${e.salud && e.salud !== "ok" ? " · EN RIESGO: " + (e.saludMotivo || "") : ""}${pend.length ? " · pendientes: " + pend.map((x) => x.tipo + (x.ref ? "(" + x.ref + ")" : "")).join(", ") : ""}\n` +
        (e.historial || []).slice(-25).map((h) => `${{ c: "Cliente", a: "Agente", h: "Equipo" }[h.r] || h.r}: ${String(h.t).slice(0, 300)}`).join("\n");
    }
  }
  // Preguntas de análisis ("por qué no cerramos", "dame un ejemplo", "qué mejorarías"...): se le pasan los chats REALES recientes
  let datos = "";
  const quiereAnalisis = a === "whatsapp" && /analiz|an[aá]lisis|ejemplo|caso|por qu[eé]|mejor|optimiz|datos|estad[ií]stic|cu[aá]nt|cerr|vent|error|fall|vuelta|demor|perd|qu[eé] pas[oó]|revis|chats?\b|clientes?\b/i.test(texto + " " + hilo.slice(-2).map((h) => h.t).join(" "));
  if (quiereAnalisis) {
    const horas = /semana|7 d[ií]as/i.test(texto) ? 168 : /hoy/i.test(texto) ? 16 : 48, desde = Date.now() - horas * 3600e3;
    const filas = (await env.DB.prepare("SELECT tel, nombre FROM chats WHERE cuando > ? ORDER BY cuando DESC LIMIT 80").bind(desde).all()).results || [];
    const ev = (await env.DB.prepare("SELECT tipo, COUNT(*) n FROM eventos WHERE ts > ? GROUP BY tipo").bind(desde).all()).results || [];
    let txt = "";
    for (const f of filas) {
      if (esAdmin(env, f.tel)) continue;
      const e = JSON.parse((await env.ESTADO.get(`v3:${f.tel}`)) || "null"); if (!e) continue;
      const ms = (e.historial || []).filter((h) => !h.ts || h.ts > desde - 12 * 3600e3).slice(-30);
      if (ms.filter((h) => h.r === "c").length < 1) continue;
      txt += `\n### ${e.nombre || f.nombre || "sin nombre"} · tel ${f.tel} · etapa ${e.etapa || "-"}${e.derivado ? " · derivado " + e.derivado.estado : ""}\n` +
        ms.map((h) => `${{ c: "C", a: "A", h: "E" }[h.r] || "N"}: ${String(h.t).replace(/\s+/g, " ").slice(0, 220)}`).join("\n");
      if (txt.length > 90000) break;
    }
    datos = `\nDATOS REALES DE LAS ÚLTIMAS ${horas} H (C=cliente, A=agente/vos, E=equipo humano):\nEventos: ${ev.map((x) => x.tipo + " " + x.n).join(", ") || "-"}\n${txt || "(no hay chats en ese período)"}`;
  }
  const contexto = a === "whatsapp"
    ? `Sos el agente de WhatsApp de "Te Importamos" (atendés clientes que quieren importar). Te habla ${quien || "el equipo"}, tu jefe, para enseñarte, corregirte o pedirte acciones.`
    : `Sos el agente de Instagram de "Te Importamos": respondés comentarios públicos con frases muy cortas (1 a 4 palabras) invitando al DM. Te habla ${quien || "el equipo"}, tu jefe, para ajustar cómo respondés.`;
  const r = await iaConImagenes(env, `${contexto}
Respondé en español rioplatense, claro, como un empleado que entendió (sin jerga técnica). Si te manda capturas, leelas y explicá qué hiciste mal.
REGLAS DE HONESTIDAD (obligatorias):
- Cuando des un análisis, una opinión o una recomendación, basala SOLO en los DATOS REALES de abajo y citá casos concretos: nombre del cliente, su número (tel) y la frase exacta entre comillas. Mínimo 2 o 3 casos si existen.
- Si no tenés datos para afirmar algo, decilo ("no lo veo en los chats de las últimas X h"). Nunca inventes casos, números ni porcentajes.
- Nunca prometas hacer algo "después" o "ahora me pongo a revisar": no podés trabajar en segundo plano. Respondé ahora con lo que tenés.
- Si es una pregunta de análisis, podés extenderte: usá viñetas cortas, una por caso, con qué pasó y qué tendríamos que haber hecho.
CÓMO REDACTAR UNA REGLA (muy importante):
- Tiene que decir EXACTAMENTE qué hacer y qué responderle al cliente. Nunca des opciones ("derivá o rechazá", "podés X o Y"): elegí UNA acción.
- Si el jefe dice que algo NO se puede o NO se trae: la regla es "respondé directamente que eso no lo hacemos y ofrecé [alternativa razonable]. No lo derives al equipo."
- Derivar al equipo solo si el jefe lo pide explícitamente.
- Si no estás seguro de qué acción quiere, NO propongas la regla: preguntale en "respuesta" qué querés que le diga el agente al cliente en ese caso.
Cuando te enseñe algo NO lo copies literal: entendé la intención de fondo, pensá en qué otros casos parecidos aplica y proponé UNA regla general bien redactada (1 o 2 oraciones en imperativo, con el porqué si ayuda), que sirva para todos esos casos. Si ya existe una regla parecida, proponé la versión mejorada que la reemplace y poné el número viejo en "olvidar". No repitas reglas que ya existen.
Cuando te pida hacer algo sobre un chat, proponé la acción (el equipo la confirma con un botón).

REGLAS QUE YA TENÉS:
${reglas.map((x, i) => `${i + 1}. ${x}`).join("\n") || "(ninguna)"}
${chats ? "\nCHATS QUE MENCIONA:" + chats : ""}${datos}

CONVERSACIÓN PREVIA CON TU JEFE:
${hilo.slice(-12).map((h) => `${h.r === "u" ? "Jefe" : "Vos"}: ${String(h.t).slice(0, 500)}`).join("\n") || "(ninguna)"}

MENSAJE NUEVO DEL JEFE: ${texto || "(solo mandó imágenes)"}

Respondé SOLO JSON:
{"respuesta": "lo que le contestás",
 "reglas_nuevas": ["regla 1", "..."],
 "olvidar": [números de reglas existentes que hay que borrar porque el jefe dijo que están mal],
 "acciones": [{"tipo": "${a === "whatsapp" ? "quitar_riesgo|cerrar_pendientes|enviar_cotizacion|mensaje_cliente|pausar|reanudar" : "ninguna"}", "tel": "número del chat", "texto": "solo para mensaje_cliente: el mensaje exacto", "descripcion": "qué vas a hacer, en una frase"}]}`, imagenes);
  if (!r) return { ok: false, respuesta: "No pude pensar la respuesta (la IA no respondió). Probá de nuevo en un minuto." };
  const nuevo = [...hilo, { r: "u", t: texto || "(imágenes)", ts: Date.now(), n: imagenes.length }, { r: "a", t: String(r.respuesta || ""), ts: Date.now(), reglas: (r.reglas_nuevas || []).filter(Boolean).slice(0, 5), olvidar: (r.olvidar || []).filter((n) => n > 0 && n <= reglas.length), acciones: (r.acciones || []).filter((x) => x && x.tipo && x.tipo !== "ninguna").slice(0, 5) }].slice(-40);
  await env.ESTADO.put(`agente_hilo:${a}`, JSON.stringify(nuevo));
  return { ok: true, ...(await hiloAgente(env, a)) };
}
async function aplicarAgente(env, { agente, tipo, regla, n, accion }, quien) {
  const a = AGENTES[agente] ? agente : "whatsapp", ag = AGENTES[a];
  const reglas = JSON.parse((await env.ESTADO.get(ag.clave)) || "[]");
  if (tipo === "regla" && regla) {
    reglas.push(String(regla).slice(0, 400));
    await env.ESTADO.put(ag.clave, JSON.stringify(reglas));
    const n = await consolidarReglas(env, ag.clave, a);
    return { ok: true, res: n ? `Aprendido. Lo integré con lo que ya sabía (ahora tiene ${n} reglas)` : "Regla guardada: la aplica desde el próximo mensaje" };
  }
  if (tipo === "consolidar") { const n = await consolidarReglas(env, ag.clave, a, true); return { ok: !!n, res: n ? `Listo, ordené todo en ${n} reglas` : "No hizo falta cambiar nada" }; }
  if (tipo === "olvidar") { const x = reglas.splice(+n - 1, 1); await env.ESTADO.put(ag.clave, JSON.stringify(reglas)); return { ok: !!x.length, res: x.length ? "Regla borrada" : "No encontré esa regla" }; }
  if (tipo === "editar") { if (!reglas[+n - 1]) return { ok: false, res: "No encontré esa regla" }; reglas[+n - 1] = String(regla || "").slice(0, 400); await env.ESTADO.put(ag.clave, JSON.stringify(reglas.filter(Boolean))); return { ok: true, res: "Regla actualizada" }; }
  if (tipo === "accion" && accion && a === "whatsapp") {
    const tel = String(accion.tel || "").replace(/\D/g, "");
    if (!tel) return { ok: false, res: "Falta el número del chat" };
    const k = `v3:${tel}`, e = JSON.parse((await env.ESTADO.get(k)) || "null");
    switch (accion.tipo) {
      case "quitar_riesgo": if (e) { e.salud = "ok"; e.saludMotivo = "revisado por el equipo"; await env.ESTADO.put(k, JSON.stringify(e), { expirationTtl: 90 * 86400 }); } await cerrarTareas(env, { tel, tipos: ["riesgo"] }); return { ok: true, res: "Listo, ya no figura en riesgo" };
      case "cerrar_pendientes": await env.DB.prepare("UPDATE tareas SET estado = 'hecha' WHERE tel = ? AND estado = 'abierta'").bind(tel).run(); return { ok: true, res: "Pendientes de ese chat cerrados" };
      case "enviar_cotizacion": { const t = await env.DB.prepare("SELECT ref FROM tareas WHERE tel = ? AND tipo = 'cotizacion' AND estado = 'abierta' ORDER BY ts DESC").bind(tel).first(); if (!t) return { ok: false, res: "Ese chat no tiene una cotización esperando aprobación" }; return { ok: true, res: await comandoAdmin(env, null, `#ok ${t.ref}`) }; }
      case "mensaje_cliente": { const msg = String(accion.texto || "").trim(); if (!msg) return { ok: false, res: "Falta el mensaje" }; const ok = await enviar(env, tel, msg); if (ok && e) { e.historial = [...(e.historial || []), { r: "h", t: `(${quien || "equipo"}) ${msg}`, ts: Date.now(), ...(typeof ok === "string" ? { wid: ok } : {}) }].slice(-60); await env.ESTADO.put(k, JSON.stringify(e), { expirationTtl: 90 * 86400 }); } return { ok: !!ok, res: ok ? "Mensaje enviado" : "WhatsApp no deja mandarlo (pasaron más de 24 h)" }; }
      case "pausar": await env.ESTADO.put(`pausa:${tel}`, "1", { expirationTtl: 12 * 3600 }); return { ok: true, res: "Chat pausado 12 h" };
      case "reanudar": await env.ESTADO.delete(`pausa:${tel}`); return { ok: true, res: await retomar(env, tel).catch((x) => "error: " + x) };
    }
    return { ok: false, res: "No sé hacer esa acción" };
  }
  if (tipo === "limpiar") { await env.ESTADO.put(`agente_hilo:${a}`, "[]"); return { ok: true, res: "Conversación borrada (las reglas quedan)" }; }
  return { ok: false, res: "Nada para hacer" };
}

// Junta reglas parecidas o repetidas en una sola, sin perder ningún dato concreto (guarda copia de lo anterior)
async function consolidarReglas(env, clave, agente, forzar = false) {
  const reglas = JSON.parse((await env.ESTADO.get(clave)) || "[]");
  if (reglas.length < 3 && !forzar) return 0;
  const r = await iaJSON(env, `Sos el editor de las reglas aprendidas del ${agente === "instagram" ? "agente de Instagram" : "agente de WhatsApp"} de "Te Importamos".
Tarea: devolvé la lista ordenada y sin repeticiones.
- Fusioná en UNA sola regla las que dicen lo mismo o se superponen (la más nueva manda si se contradicen; las más nuevas están al final).
- Generalizá cuando varias son casos particulares de una misma idea, pero NO pierdas ningún dato concreto (números, links, precios, nombres, excepciones).
- No inventes nada nuevo. Redacción: imperativo, español rioplatense, 1 o 2 oraciones por regla.
Respondé SOLO JSON: {"reglas": ["..."], "cambios": "qué fusionaste, en una línea"}

REGLAS ACTUALES:
${reglas.map((x, i) => `${i + 1}. ${x}`).join("\n")}`);
  const nuevas = (r?.reglas || []).map((x) => String(x).trim()).filter(Boolean);
  if (!nuevas.length || nuevas.length > reglas.length || nuevas.length < Math.ceil(reglas.length * 0.4)) return 0;   // por seguridad: si achica demasiado, no toca nada
  if (nuevas.length === reglas.length && nuevas.every((x, i) => x === reglas[i])) return 0;
  await env.ESTADO.put(`${clave}_copia`, JSON.stringify({ ts: Date.now(), reglas }));
  await env.ESTADO.put(clave, JSON.stringify(nuevas.map((x) => x.slice(0, 500))));
  console.log("Reglas consolidadas:", reglas.length, "→", nuevas.length, r.cambios || "");
  return nuevas.length;
}
// v14.4: reabre los "Buscar proveedor" / "Quiere comprar" que se cerraron solos al mandar un audio, imagen o PDF desde el panel
async function reabrirV144(env) {
  if (await env.ESTADO.get("reabrir_v144")) return 0;
  const ts = (await env.DB.prepare("SELECT id, tel, ts FROM tareas WHERE tipo IN ('proveedor', 'cierre') AND estado = 'hecha' AND ts > ?").bind(Date.now() - 6 * 86400e3).all()).results || [];
  let n = 0;
  for (const t of ts) {
    const e = JSON.parse((await env.ESTADO.get(`v3:${t.tel}`)) || "null");
    const archivoDespues = (e?.historial || []).some((h) => h.r === "h" && (h.ts || 0) > t.ts && (h.arch || (h.img || []).length || /^\([^)]*\) \((audio|archivo|imagen)\)/.test(String(h.t))));
    if (archivoDespues) { await env.DB.prepare("UPDATE tareas SET estado = 'abierta' WHERE id = ?").bind(t.id).run(); n++; }
  }
  await env.ESTADO.put("reabrir_v144", "1");
  return n;
}
// Limpieza única v13: cierra los "en riesgo" de chats donde el cliente nunca escribió más que el saludo
async function limpiezaV13(env) {
  if (await env.ESTADO.get("limpieza_v13")) return 0;
  const ts = (await env.DB.prepare("SELECT id, tel FROM tareas WHERE tipo = 'riesgo' AND estado = 'abierta'").all()).results || [];
  let n = 0;
  for (const t of ts) {
    const e = JSON.parse((await env.ESTADO.get(`v3:${t.tel}`)) || "null");
    const deCliente = (e?.historial || []).filter((h) => h.r === "c").length;
    if (!e || deCliente < 2 || Date.now() - (e.ultimoMensaje || 0) > 3 * 86400e3) { await cerrarTareas(env, { id: t.id }); if (e && deCliente < 2) { e.salud = "ok"; await env.ESTADO.put(`v3:${t.tel}`, JSON.stringify(e), { expirationTtl: 90 * 86400 }); } n++; }
  }
  await env.ESTADO.put("limpieza_v13", "1");
  return n;
}
// Pasa a Pendientes lo que quedó de antes de la v12 (cotizaciones sin aprobar, comprobantes, derivados, chats en riesgo)
async function importarViejos(env) {
  if (await env.ESTADO.get("viejos_importados")) return 0;
  let n = 0;
  for (const k of (await env.ESTADO.list({ prefix: "pend:" })).keys) {
    if (k.name === "pend:ultimo") continue;
    const p = JSON.parse((await env.ESTADO.get(k.name)) || "null"); if (!p) continue;
    const e = JSON.parse((await env.ESTADO.get(`v3:${p.para}`)) || "null") || {};
    await crearTarea(env, { tipo: "cotizacion", tel: p.para, nombre: e.nombre, ref: k.name.slice(5), titulo: "Cotización para aprobar", detalle: (p.textos || []).join("\n\n———\n\n") }); n++;
  }
  for (const k of (await env.ESTADO.list({ prefix: "pago:" })).keys) {
    const p = JSON.parse((await env.ESTADO.get(k.name)) || "null"); if (!p) continue;
    await crearTarea(env, { tipo: "comprobante", tel: p.para, nombre: p.nombre, ref: k.name.slice(5), titulo: `Comprobante de pago${p.monto ? " por " + p.monto : ""}`, detalle: `Monto: ${p.monto ?? "?"} | Destino: ${p.destino || "?"} | Fecha: ${p.fecha || "?"}` }); n++;
  }
  for (const k of (await env.ESTADO.list({ prefix: "v3:" })).keys) {
    const tel = k.name.slice(3); if (esAdmin(env, tel)) continue;
    const e = JSON.parse((await env.ESTADO.get(k.name)) || "null"); if (!e) continue;
    const ult = (e.historial || []).filter((h) => !h.n).slice(-1)[0];
    if (e.derivado && Date.now() - Date.parse(e.derivado.cuando) < 4 * 86400e3 && ult?.r !== "h") { await crearTarea(env, { tipo: "derivado", tel, nombre: e.nombre, titulo: ({ busqueda_proveedor: "Buscar proveedor" })[e.derivado.estado] || "Chat derivado", detalle: `${e.derivado.resumen || ""}\nProducto: ${e.derivado.producto || "-"}${e.derivado.cantidad ? " x" + e.derivado.cantidad : ""}` }); n++; }
    else if (e.salud && e.salud !== "ok" && Date.now() - (e.ultimoMensaje || 0) < 3 * 86400e3) { await crearTarea(env, { tipo: "riesgo", tel, nombre: e.nombre, titulo: "Chat en riesgo", detalle: e.saludMotivo || "" }); n++; }
  }
  await env.ESTADO.put("viejos_importados", "1");
  return n;
}
async function descargarReporte(env, url) {
  await prepararTablas(env);
  const fila = await env.DB.prepare("SELECT * FROM reportes WHERE id = ?").bind(url.searchParams.get("id") || "").first();
  if (!fila) return new Response("No encontré ese reporte", { status: 404 });
  return new Response(pdfReporte(fila), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="reporte-${fila.id}.pdf"`, "Cache-Control": "private, max-age=300" } });
}

const PANEL_APP = String.raw`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Panel · Te Importamos</title>
<script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js"></script>
<style>
:root{--azul:#EA5B0C;--azul2:#FDE3D3;--azul3:#FFF4EC;--rojo:#DC2626;--rojo2:#FEE2E2;--borde:#E5E7EB;--gris:#6B7280;--texto:#111827;--fondo:#F3F4F6}
*{box-sizing:border-box}html,body{margin:0;height:100%;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:var(--texto);background:var(--fondo)}
button{font:inherit;cursor:pointer}
.top{height:56px;background:#0B0B0B;border-bottom:3px solid var(--azul);display:flex;align-items:center;gap:16px;padding:0 16px;position:sticky;top:0;z-index:5}
.marca{font-weight:700;color:var(--azul);white-space:nowrap}.tabs{display:flex;gap:4px;flex:1}
.tab{border:0;background:none;padding:8px 14px;border-radius:8px;color:#D1D5DB;font-weight:600}.tab.on{background:var(--azul);color:#fff}
.user{color:#9CA3AF;font-size:13px;white-space:nowrap}.user a{color:#D1D5DB}
.vista{display:none}.vista.on{display:block}
/* Dashboard */
.dash{max-width:1200px;margin:0 auto;padding:16px}
.filtros{display:inline-flex;background:#fff;border:1px solid var(--borde);border-radius:10px;padding:3px;margin-bottom:14px}
.filtros button{border:0;background:none;padding:7px 16px;border-radius:8px;color:var(--gris);font-weight:600}.filtros button.on{background:var(--azul);color:#fff}
.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}
.kpi{background:#fff;border:1px solid var(--borde);border-radius:12px;padding:16px}
.kpi .n{font-size:30px;font-weight:700}.kpi .l{color:var(--gris);font-size:13px;margin-top:2px}.kpi .d{font-size:12px;margin-top:8px;font-weight:600}
.sube{color:var(--azul)}.baja{color:var(--rojo)}.igual{color:var(--gris)}
.graf{display:grid;grid-template-columns:2fr 1fr;gap:12px;margin-top:12px}.graf3{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-top:12px}
.card{background:#fff;border:1px solid var(--borde);border-radius:12px;padding:16px;min-width:0}.card h3{margin:0 0 12px;font-size:14px;color:var(--gris);font-weight:600}
.alto{height:260px;position:relative}.medio{height:220px;position:relative}
.embudo .fila{margin:10px 0}.embudo .et{display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px}.barra{height:10px;background:var(--azul3);border-radius:6px;overflow:hidden}.barra i{display:block;height:100%;background:var(--azul);border-radius:6px}
.reportes{margin-top:12px}.rep{display:flex;align-items:center;gap:12px;padding:12px 0;border-top:1px solid var(--borde)}.rep:first-of-type{border-top:0}
.rep .t{flex:1;min-width:0}.rep .t b{display:block;font-size:14px}.rep .t span{color:var(--gris);font-size:13px;display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.btn{border:1px solid var(--azul);background:#fff;color:var(--azul);border-radius:8px;padding:7px 12px;font-weight:600;font-size:13px;text-decoration:none;white-space:nowrap}
.btn.lleno{background:var(--azul);color:#fff}.btn.rojo{border-color:var(--rojo);color:var(--rojo)}
.cab{display:flex;justify-content:space-between;align-items:center;margin-bottom:6px}.vacio{color:var(--gris);font-size:14px;padding:12px 0}
/* Chats */
.chats{display:flex;height:calc(100vh - 56px);background:#fff}
.conv{flex:1;display:flex;flex-direction:column;min-width:0;background:#F8FAFC;border-right:1px solid var(--borde)}
.lista{width:340px;display:flex;flex-direction:column;background:#fff}
.buscar{padding:10px;border-bottom:1px solid var(--borde)}.buscar input{width:100%;padding:9px 12px;border:1px solid var(--borde);border-radius:8px;font-size:14px;background:var(--fondo)}
.leyenda{display:flex;gap:12px;padding:8px 12px;font-size:12px;color:var(--gris);border-bottom:1px solid var(--borde)}.leyenda i{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:4px;vertical-align:-1px;border:1px solid #CBD5E1}
.items{overflow-y:auto;flex:1}
.it{display:flex;align-items:center;gap:12px;padding:11px 14px;border-bottom:1px solid #F1F5F9;cursor:pointer}.it:hover{background:#F9FAFB}.it.on{background:var(--azul3)}
.av{width:38px;height:38px;border-radius:50%;flex:none;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:15px}
.t-blanco{background:#fff;border:2px solid #CBD5E1;color:#64748B}.t-azul{background:var(--azul);color:#fff}.t-rojo{background:var(--rojo);color:#fff}
.it .nom{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:15px}.it.espera .nom{font-weight:700}
.it .h{font-size:12px;color:var(--gris)}.it.espera .h{color:var(--azul);font-weight:700}
.chead{padding:10px 16px;background:#fff;border-bottom:1px solid var(--borde);display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.chead .q{flex:1;min-width:150px}.chead b{display:block}.chead small{color:var(--gris)}
.estado{font-size:12px;font-weight:600;padding:3px 9px;border-radius:20px;background:var(--fondo);color:var(--gris)}.estado.riesgo{background:var(--rojo2);color:var(--rojo)}
.msgs{flex:1;overflow-y:auto;padding:16px 6%}
.m{max-width:72%;padding:8px 12px;border-radius:12px;margin:4px 0;font-size:14.5px;line-height:1.4;white-space:pre-wrap;word-wrap:break-word;box-shadow:0 1px 1px rgba(0,0,0,.04)}
.m.c{background:#fff;border:1px solid var(--borde);margin-right:auto;border-top-left-radius:4px}
.m.a{background:var(--azul2);margin-left:auto;border-top-right-radius:4px}
.m.h{background:var(--azul);color:#fff;margin-left:auto;border-top-right-radius:4px}
.m audio{display:block;max-width:260px;margin:4px 0}.m .doc{display:inline-block;padding:6px 10px;border-radius:8px;background:rgba(255,255,255,.18);color:inherit;margin:4px 0}.m.a .doc,.m.c .doc{background:var(--fondo)}
.comp .ico{background:#fff;color:var(--azul);border:1px solid var(--borde);padding:0 12px;font-size:18px}.comp .ico.rec{background:var(--rojo);color:#fff;border-color:var(--rojo)}
.oferta{background:#ECFDF5;border:1px solid #A7F3D0;color:#065F46;border-radius:10px;padding:8px 12px;font-size:13px;margin:8px 0}
.ag{display:grid;grid-template-columns:240px 1fr;height:calc(100vh - 58px)}.ag .lista{border-right:1px solid var(--borde);background:#fff;padding:10px}
.ag .lista button{display:block;width:100%;text-align:left;border:0;background:none;padding:12px;border-radius:10px;font:inherit;font-weight:600}.ag .lista button.on{background:#FFF4EC;color:var(--azul)}
.ag .cuerpo{display:flex;flex-direction:column;min-height:0}.ag .hilo{flex:1;overflow:auto;padding:16px;background:var(--fondo)}
.ag .burb{max-width:720px;padding:10px 12px;border-radius:12px;margin:8px 0;white-space:pre-wrap;line-height:1.4;font-size:14.5px}.ag .burb.u{background:var(--azul);color:#fff;margin-left:auto}.ag .burb.a{background:#fff;border:1px solid var(--borde)}
.ag .prop{margin-top:8px;padding:8px;border:1px dashed var(--borde);border-radius:8px;background:var(--fondo);display:flex;gap:8px;align-items:center;flex-wrap:wrap}.ag .prop span{flex:1;min-width:180px}
.ag .reglas{border-top:1px solid var(--borde);background:#fff;max-height:30vh;overflow:auto;padding:8px 16px;font-size:13.5px}.ag .reglas li{margin:4px 0}.ag .reglas button{border:0;background:none;color:var(--rojo);cursor:pointer}
.ag .adj{display:flex;gap:6px;padding:0 12px;flex-wrap:wrap}.ag .adj img{height:56px;border-radius:6px;border:1px solid var(--borde)}
@media (max-width:900px){.ag{grid-template-columns:1fr}.ag .lista{display:flex;gap:6px;padding:6px}.ag .lista button{padding:8px}}
.m.n{background:#FEF9C3;margin:8px auto;font-size:13px;max-width:90%;text-align:center}
.m .q{font-size:11px;font-weight:700;opacity:.7;display:block;margin-bottom:2px}.m img{max-width:240px;max-height:280px;border-radius:8px;display:block;margin:4px 0}
.resumen{margin:0 0 12px;padding:10px 12px;background:#fff;border:1px solid var(--borde);border-radius:10px;font-size:13px;color:#374151}
.comp{display:flex;gap:8px;padding:10px 12px;background:#fff;border-top:1px solid var(--borde)}
.comp textarea{flex:1;resize:none;height:44px;max-height:140px;padding:11px 12px;border:1px solid var(--borde);border-radius:10px;font:inherit;font-size:15px}
.comp button{border:0;background:var(--azul);color:#fff;border-radius:10px;padding:0 18px;font-weight:600}
.nada{margin:auto;color:var(--gris);text-align:center;padding:40px}
.volver{display:none;border:0;background:none;color:var(--azul);font-weight:700;font-size:15px;padding:0}
.aviso{position:fixed;bottom:18px;left:50%;transform:translateX(-50%);background:#111827;color:#fff;padding:10px 16px;border-radius:10px;font-size:14px;display:none;z-index:9}
.cargando{position:fixed;inset:56px 0 0 0;background:rgba(255,255,255,.92);display:none;align-items:center;justify-content:center;color:var(--gris);z-index:8}
.badge{display:inline-block;min-width:18px;padding:1px 6px;border-radius:10px;background:var(--rojo);color:#fff;font-size:12px;margin-left:6px;text-align:center}.badge:empty{display:none}
.chips{display:flex;gap:6px;padding:8px 10px;border-bottom:1px solid var(--borde);flex-wrap:wrap}.chip{border:1px solid var(--borde);background:#fff;border-radius:16px;padding:4px 11px;font-size:13px;color:var(--gris)}.chip.on{background:var(--azul);border-color:var(--azul);color:#fff}
.it .pd{background:var(--rojo);color:#fff;border-radius:10px;font-size:11px;padding:1px 6px;font-weight:700}
.m .hr{display:block;text-align:right;font-size:11px;opacity:.55;margin-top:3px}.tl{font-size:12px;margin-left:4px;letter-spacing:-3px}.tl.leido{color:#38BDF8;opacity:1}.m.h .tl.leido{color:#7DD3FC}.tl.fallo{color:var(--rojo);letter-spacing:0}
.pend{max-width:900px;margin:0 auto;padding:16px}.pend h2{font-size:18px;margin:4px 0 12px}
.tk{background:#fff;border:1px solid var(--borde);border-left:5px solid var(--azul);border-radius:12px;padding:14px;margin:10px 0}#waDash{margin-bottom:14px}.wlisto{display:block;margin:4px 0 0 auto;border:1px solid var(--borde);background:#fff;border-radius:6px;padding:2px 8px;font-size:11.5px;color:var(--gris);cursor:pointer}.wlisto:hover{border-color:#1FA855;color:#1FA855}.wsub{display:flex;gap:2px;padding:6px 10px 0;border-bottom:1px solid var(--borde);overflow-x:auto}.wsub button{border:0;background:none;padding:9px 10px;font-weight:600;color:var(--gris);border-bottom:2px solid transparent;white-space:nowrap;font-size:13.5px}.wsub button.on{color:var(--texto);border-color:#EA5B0C}.wsub span{margin-left:6px;background:#F3F4F6;border-radius:99px;padding:0 7px;font-size:12px}.wscroll{max-height:380px;overflow:auto}.wtab .wn{width:28%}.wtab .wn small{display:block;color:#9CA3AF;font-size:11.5px}.rep2{border:1px solid var(--borde);border-radius:10px;margin:8px 0;background:#fff}.rep2 summary{display:flex;align-items:center;gap:10px;padding:11px 14px;cursor:pointer;list-style:none;flex-wrap:wrap}.rep2 summary::-webkit-details-marker{display:none}.rep2 summary:before{content:"";width:7px;height:7px;border-right:2px solid var(--gris);border-bottom:2px solid var(--gris);transform:rotate(-45deg);transition:.15s}.rep2[open] summary:before{transform:rotate(45deg)}.rep2 .rt{font-weight:700}.rep2 .rk{flex:1;color:var(--gris);font-size:13px}.rep2 .rb{padding:0 14px 14px;border-top:1px solid var(--borde)}.rep2 h5{margin:12px 0 4px;font-size:13px}.rkv{display:flex;gap:18px;flex-wrap:wrap;margin:10px 0;font-size:12.5px;color:var(--gris)}.rkv b{display:block;font-size:17px;color:var(--texto)}.dif{border:1px solid var(--borde);border-left:3px solid #1FA855;border-radius:8px;padding:9px 12px;margin:8px 0}.dif .dt{display:flex;justify-content:space-between;align-items:center;gap:8px}.dif .dpq{color:var(--gris);font-size:12.5px}.dif pre{white-space:pre-wrap;font-family:inherit;background:#F4F5F7;border-radius:6px;padding:8px 10px;margin:6px 0 0;font-size:13px}.sugA{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px}.sugA button{border:1px solid var(--borde);background:#fff;border-radius:99px;padding:5px 11px;font-size:12.5px;color:var(--gris)}@media (max-width:900px){.wtab .wp{display:none}}.westado{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--gris);margin:4px 0 10px}.wpunto{width:8px;height:8px;border-radius:50%;display:inline-block}.wlink{margin-left:auto;color:#1FA855;font-weight:700;text-decoration:none}.wkpis{display:grid;grid-template-columns:repeat(6,1fr);gap:10px;margin-bottom:12px}.wkpi{background:#fff;border:1px solid var(--borde);border-radius:10px;padding:10px 12px;border-top:3px solid var(--c)}.wkpi small{color:var(--gris);font-weight:600;font-size:12px;display:block}.wkpi div{font-size:24px;font-weight:700}.wkpi i{font-style:normal;font-size:11.5px;color:#9CA3AF}.wgrid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:12px}.wcard{padding:0!important;overflow:hidden}.wcard h3{margin:0;padding:10px 14px;border-bottom:1px solid var(--borde);font-size:13.5px}.wcnt{background:#F3F4F6;color:var(--gris);border-radius:99px;padding:1px 8px;font-size:12px}.wtab{width:100%;border-collapse:collapse}.wtab td{padding:8px 12px;border-bottom:1px solid #F0F1F3;font-size:13px;vertical-align:top}.wtab tr{cursor:pointer}.wtab tr:hover td{background:#FAFAFB}.wtab .wp{color:var(--gris);font-size:12px}.wtab .wa{font-size:12px}.wtab .wh{color:var(--gris);font-size:11.5px;white-space:nowrap;text-align:right}.sc{display:inline-block;min-width:22px;text-align:center;border-radius:6px;padding:0 5px;font-size:11.5px;font-weight:700}.sc.c{background:#FDECEC;color:#DC2626}.sc.t{background:#FEF3C7;color:#B45309}.sc.f{background:#E8F0FE;color:#2563EB}.sc.s{background:#F3F4F6;color:var(--gris)}.wprods{padding:10px 14px;display:flex;flex-wrap:wrap;gap:6px}.wprods span{background:#F3F4F6;border-radius:6px;padding:3px 8px;font-size:12px}.wprods b{color:#EA5B0C;margin-left:4px}details.viejo{margin:14px 0}details.viejo summary{cursor:pointer;color:var(--gris);font-weight:600;font-size:13.5px;padding:8px 0}@media (max-width:900px){.wkpis{grid-template-columns:repeat(3,1fr)}.wgrid{grid-template-columns:1fr}}details.tk{padding:0;margin:6px 0}details.tk summary{list-style:none;cursor:pointer;padding:11px 14px;display:flex;align-items:center;gap:10px;flex-wrap:wrap}details.tk summary::-webkit-details-marker{display:none}details.tk summary:before{content:"";width:7px;height:7px;border-right:2px solid var(--gris);border-bottom:2px solid var(--gris);transform:rotate(-45deg);transition:.15s;flex:none}details.tk[open] summary:before{transform:rotate(45deg)}details.tk .corto{flex:1;min-width:120px}details.tk .quien{color:var(--gris);font-size:13px}details.tk .cuerpo{padding:0 14px 14px;border-top:1px solid var(--borde)}.chipsT{display:flex;gap:6px;flex-wrap:wrap;margin:6px 0 10px}.chipsT .chip{border:1px solid var(--borde);background:#fff;border-radius:16px;padding:5px 12px;font-size:13px;color:var(--gris);cursor:pointer;font-weight:600}.chipsT .chip.on{background:#0B0B0B;border-color:#0B0B0B;color:#fff}
.tk.cierre,.tk.cotizacion,.tk.comprobante{border-left-color:var(--rojo)}.tk.derivado{border-left-color:#F59E0B}.tk.ig_revisar{border-left-color:#DB2777}.tk.proveedor{border-left-color:#0D9488}.tk.riesgo,.tk.promesa{border-left-color:#7C3AED}
.tk .cab2{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.tk .tipo{font-size:11px;font-weight:700;text-transform:uppercase;color:var(--gris)}.tk .cuando{margin-left:auto;font-size:12px;color:var(--gris)}
.tk .tit{font-weight:700;margin:4px 0}.tk pre{white-space:pre-wrap;font:inherit;font-size:13.5px;background:var(--fondo);border-radius:8px;padding:10px;margin:8px 0;max-height:260px;overflow:auto}
.tk textarea{width:100%;min-height:70px;font:inherit;font-size:14px;padding:8px;border:1px solid var(--borde);border-radius:8px}.tk img{max-width:200px;border-radius:8px;display:block;margin:6px 0}.tk .acc{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}
@media (max-width:900px){.kpis{grid-template-columns:repeat(2,1fr)}.graf,.graf3{grid-template-columns:1fr}}
/* Grabador de audio estilo WhatsApp */
.comp{position:relative}.comp .ico{min-width:44px;touch-action:none;user-select:none;-webkit-user-select:none}
.grab{position:absolute;inset:0;background:#fff;display:flex;align-items:center;gap:12px;padding:0 12px;z-index:3}
.grab .pt{width:10px;height:10px;border-radius:50%;background:var(--rojo);animation:lat 1s infinite}@keyframes lat{50%{opacity:.25}}
.grab .tm{font-variant-numeric:tabular-nums;font-weight:600;min-width:44px}.grab .hint{flex:1;color:var(--gris);font-size:14px;text-align:center;white-space:nowrap;overflow:hidden}
.grab .acc{border:0;border-radius:50%;width:44px;height:44px;font-size:18px}.grab .tirar{background:var(--fondo);color:var(--rojo)}.grab .mandar{background:var(--azul);color:#fff}
.candado{position:absolute;right:62px;bottom:64px;background:#fff;border:1px solid var(--borde);border-radius:22px;padding:10px 8px;font-size:16px;box-shadow:0 4px 12px rgba(0,0,0,.08);z-index:4;text-align:center;line-height:1.2}
.fallo{background:var(--rojo2);border:1px solid #FCA5A5;color:#991B1B;border-radius:10px;padding:8px 12px;font-size:13px;margin:8px 0}
@media (max-width:760px){
  .top{height:52px;padding:0 12px}.tabs{position:fixed;left:0;right:0;bottom:0;z-index:20;background:#0B0B0B;border-top:3px solid var(--azul);padding:6px 6px calc(6px + env(safe-area-inset-bottom));gap:2px}
  .tab{flex:1;padding:10px 1px;font-size:11px;text-align:center;border-radius:10px;min-width:0}.tab .badge{margin-left:3px}.tabs>a{flex:1;padding:10px 1px!important;font-size:11px;text-align:center;border-radius:10px!important;min-width:0}
  body{padding-bottom:calc(64px + env(safe-area-inset-bottom))}
  .chats,.ag{height:calc(100dvh - 52px - 64px - env(safe-area-inset-bottom))}
  .chead{padding:8px 10px;gap:6px}.chead .q{min-width:0}.chead .btn{padding:6px 9px;font-size:12px}.chead .estado{font-size:11px}
  .comp{padding:8px;gap:6px}.comp textarea{font-size:16px;height:42px;padding:10px}.comp button{min-width:44px;padding:0 12px}
  .m{font-size:15px}.it{padding:13px 12px}.buscar input{font-size:16px}.chips{overflow-x:auto;flex-wrap:nowrap}.chip{flex:none;padding:7px 12px}
  .pend{padding:10px}.tk{padding:12px}.tk .acc .btn{flex:1;text-align:center;padding:10px}
  .dash{padding:10px}.rep{flex-wrap:wrap}.rep .t{flex-basis:100%}
  .candado{right:56px}
  .marca{display:block!important;font-size:15px}.user{margin-left:auto}
  .chead .estado,.chead a.btn{display:none}.chead .q b{font-size:15px}.chead .q small{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:12px}
  .ag{grid-template-columns:1fr;grid-template-rows:auto 1fr}.ag .lista{display:flex;flex-direction:row;width:auto;gap:6px;padding:6px;border-right:0;border-bottom:1px solid var(--borde)}.ag .lista button{flex:1;text-align:center;padding:9px 6px;font-size:13px}
}
@media (max-width:760px){.lista{width:100%}.conv{display:none}.chats.abierto .conv{display:flex}.chats.abierto .lista{display:none}.volver{display:inline}.msgs{padding:12px}.m{max-width:86%}.marca{display:none}.user span{display:none}}
</style></head><body>
<div class="top"><div class="marca">Te Importamos</div>
<div class="tabs"><button class="tab on" data-v="dash">Dashboard</button><button class="tab" data-v="pend">Pendientes<span class="badge" id="nPend"></span></button><button class="tab" data-v="agentes">Agentes</button><a href="/panel/busquedas" style="text-decoration:none;padding:8px 14px;border-radius:8px;font-weight:600;color:#D1D5DB;align-self:center">Búsquedas</a><a href="/panel/805" style="text-decoration:none;padding:8px 14px;border-radius:8px;font-weight:600;color:#fff;background:#25D366;align-self:center">WhatsApp</a></div>
<div class="user"><span id="usuario"></span> · <a href="/logout">Salir</a></div></div>

<div class="vista on" id="v-dash"><div class="dash">
<div class="filtros" id="filtros"><button data-p="dia" class="on">Hoy</button><button data-p="semana">7 días</button><button data-p="mes">30 días</button></div>
<div id="waDash"><div class="vacio">Cargando...</div></div>
<div class="graf"><div class="card"><h3>Chats nuevos por día</h3><div class="alto"><canvas id="g-dias"></canvas></div></div>
<div class="card"><h3>Temperatura de los leads</h3><div class="alto"><canvas id="g-temp"></canvas></div></div></div>
<div class="graf3"><div class="card"><h3>Productos más pedidos</h3><div class="medio"><canvas id="g-prod"></canvas></div></div>
<div class="card"><h3>En qué etapa están los chats</h3><div class="medio"><canvas id="g-etapa"></canvas></div></div>
<div class="card"><h3>Calidad de los leads (puntaje 1 a 10)</h3><div class="medio"><canvas id="g-punt"></canvas></div></div></div>
<div class="card reportes"><div class="cab"><h3 id="rep-tit" style="margin:0">Reportes diarios</h3><button class="btn" id="generar">Generar ahora</button></div><div id="reps"></div></div>
</div></div>

<div class="vista" id="v-agentes"><div class="ag"><div class="lista" id="agLista"><button data-a="asistente" class="on">Asistente de WhatsApp</button><button data-a="instagram">Agente de Instagram</button></div>
<div class="cuerpo"><div class="hilo" id="agHilo"><div class="vacio">Cargando...</div></div>
<details class="reglas" id="agReglasBox"><summary><b>Lo que sabe</b> (<span id="agN">0</span> reglas) · tocá para ver, editar o borrar</summary><ol id="agReglas"></ol><button id="agOrdenar" style="color:var(--azul)">Ordenar y fusionar reglas parecidas</button> · <button id="agLimpiar" style="color:var(--gris)">Borrar esta conversación</button></details>
<div class="adj" id="agAdj"></div>
<div class="comp"><button class="ico" id="agFoto" title="Adjuntar capturas">📎</button><input type="file" id="agFile" accept="image/*" multiple hidden><textarea id="agTxt" placeholder="Escribile al agente: enseñale algo, corregilo o pedile una acción. Podés pegar capturas con Ctrl+V"></textarea><button id="agEnviar">Enviar</button></div></div></div></div>

<div class="vista" id="v-pend"><div class="pend"><h2>Lo que tenés que hacer</h2><div style="margin:-4px 0 8px;font-size:13px;color:var(--gris)">¿Muchos "chat en riesgo" que ya viste? <a href="#" id="cerrarRiesgos">Cerrar todos los de riesgo</a></div><div id="tareas"><div class="vacio">Cargando...</div></div></div></div>

<div class="vista" id="v-chats"><div class="chats" id="chats">
<div class="conv" id="conv"><div class="nada">Elegí un chat de la lista</div></div>
<div class="lista"><div class="buscar" style="display:flex;gap:6px"><a class="btn" href="/panel/api/exportar?h=24" title="Descargar todos los chats de las últimas 24 h en un archivo de texto">⬇ 24 h</a><input id="buscar" placeholder="Buscar por nombre o número"></div>
<div class="chips" id="chips"><button class="chip on" data-f="">Todos</button><button class="chip" data-f="pend">Pendientes</button><button class="chip" data-f="caliente">Calientes</button><button class="chip" data-f="tibio">Tibios</button><button class="chip" data-f="frio">Fríos</button></div>
<div class="items" id="items"></div></div>
</div></div>
<div class="aviso" id="aviso"></div><div class="cargando" id="cargando">Preparando el panel por primera vez...</div>

<script>
var $ = function (s) { return document.querySelector(s); };
var api = function (r, body) { return fetch("/panel/api/" + r, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : { cache: "no-store" }).then(function (x) { if (x.status === 401) { location.href = "/login?volver=/panel"; throw new Error("sesion"); } return x.json(); }); };
var esc = function (t) { return String(t == null ? "" : t).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
var color = function (t) { return t === "caliente" ? "rojo" : t === "tibio" ? "azul" : "blanco"; };
var aviso = function (t) { var a = $("#aviso"); a.textContent = t; a.style.display = "block"; clearTimeout(a._t); a._t = setTimeout(function () { a.style.display = "none"; }, 3500); };
var hora = function (ms) { if (!ms) return ""; var d = new Date(ms), h = new Date(); return d.toDateString() === h.toDateString() ? d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false }) : d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" }); };
var FILTRO = "", P = "dia", graficos = {}, chats = [], actual = null, firmaLista = "", firmaChat = "";

// ---------- Pestañas ----------
document.querySelectorAll(".tab").forEach(function (b) { b.onclick = function () { verTab(b.dataset.v); }; });
function verTab(v) {
  document.querySelectorAll(".tab").forEach(function (b) { b.classList.toggle("on", b.dataset.v === v); });
  document.querySelectorAll(".vista").forEach(function (x) { x.classList.toggle("on", x.id === "v-" + v); });
  if (v === "chats") cargarLista(); else if (v === "pend") cargarTareas(); else if (v === "agentes") cargarAgente(); else cargarDash();
}

// ---------- Dashboard ----------
document.querySelectorAll("#filtros button").forEach(function (b) { b.onclick = function () { P = b.dataset.p; document.querySelectorAll("#filtros button").forEach(function (x) { x.classList.toggle("on", x === b); }); cargarDash(); }; });
var NOMBRES = { nuevo: "Clientes nuevos", cotizacion: "Cotizaciones enviadas", venta: "Ventas cerradas", derivado: "Chats derivados por el agente" };
function delta(a, b) { if (!b && !a) return '<div class="d igual">sin movimiento</div>'; if (!b) return '<div class="d sube">nuevo en el período</div>'; var p = Math.round((a - b) / b * 100); if (!p) return '<div class="d igual">igual que el período anterior</div>'; return '<div class="d ' + (p > 0 ? "sube" : "baja") + '">' + (p > 0 ? "+" : "") + p + "% vs período anterior</div>"; }
function grafico(id, cfg) { if (!window.Chart) return; if (graficos[id]) graficos[id].destroy(); graficos[id] = new Chart(document.getElementById(id), cfg); }
var WA = null, WA_LISTA = "sin";
function waFila(c, extra, txt) {
  var sc = c.puntaje ? '<span class="sc ' + ({ caliente: "c", tibio: "t", frio: "f" }[c.temp] || "s") + '">' + c.puntaje + "</span>" : "";
  return '<tr data-wc="' + esc(c.conv) + '"><td class="wn"><b>' + esc(c.nombre || "+" + c.conv) + "</b>" + (c.nombre ? '<small>+' + esc(c.conv) + "</small>" : "") + " " + sc + '</td><td class="wp">' + esc(c.producto || "") + '</td><td class="wa">' + esc(txt !== undefined ? txt : String(c.accion || c.resumen || c.ult_texto || "").replace(/\|p\d$/, "")) + '</td><td class="wh">' + extra + "</td></tr>";
}
function pintarListaWA() {
  var d = WA; if (!d) return; var h = "";
  if (WA_LISTA === "sin") h = (d.sinResponder || []).map(function (c) { return waFila(c, hace(c.ult_cliente_ts) + '<button class="wlisto" data-visto="' + esc(c.conv) + '" title="Sacar de la lista hasta que vuelva a escribir">Listo</button>', String(c.accion || c.ult_texto || "").replace(/\|p\d$/, "")); }).join("");
  if (WA_LISTA === "esc") h = (d.escribiles || []).map(function (c) { return waFila(c, hora(c.ult_ts)); }).join("");
  if (WA_LISTA === "cot") h = (d.cotPend || []).map(function (c) { return waFila(c, hace(c.ult_cliente_ts || c.ult_ts)); }).join("");
  if (WA_LISTA === "ven") h = (d.ventasRec || []).map(function (v) { return waFila({ conv: v.conv, nombre: v.nombre, producto: v.producto }, hora(v.ts), v.dato); }).join("");
  $("#waTabla").innerHTML = h || '<tr><td class="vacio">Nada por acá</td></tr>';
}
function pintarWA(d) {
  WA = d; var p = d[P] || d.dia || {};
  var k = [["Chats nuevos", p.nuevos, "#1FA855"], ["Cotizaciones", p.cotizaciones, "#EA5B0C", (p.chatsCotizados || 0) + " chats"], ["Ventas", p.ventas, "#2563EB"], ["Sin responder", p.sinResponder, "#DC2626", "últimas 72 h"], ["Respuesta", p.respuestaMin == null ? "-" : p.respuestaMin + " min", "#6B7280", "mediana"], ["Conversión", p.conversion == null ? "-" : p.conversion + "%", "#0B0B0B", "cotizado a venta"]];
  var ok = d.ultimo && Date.now() - d.ultimo < 6 * 3600e3;
  var est = '<span class="wpunto" style="background:' + (ok ? "#1FA855" : "#DC2626") + '"></span>WhatsApp 805 · ' + (d.ultimo ? (ok ? "conectado" : "sin datos recientes") + " · último mensaje " + hace(d.ultimo) : "sin datos");
  var tabs = [["sin", "Responder ya", (d.sinResponder || []).length], ["esc", "Escribirles", (d.escribiles || []).length], ["cot", "Esperan cotización", (d.cotPend || []).length], ["ven", "Ventas", (d.ventasRec || []).length]];
  $("#waDash").innerHTML = '<div class="westado">' + est + '<a href="/panel/805" class="wlink">Ver chats de WhatsApp</a></div>' +
    '<div class="wkpis">' + k.map(function (x) { return '<div class="wkpi" style="--c:' + x[2] + '"><small>' + x[0] + "</small><div>" + (x[1] == null ? 0 : x[1]) + "</div>" + (x[3] ? "<i>" + x[3] + "</i>" : "") + "</div>"; }).join("") + "</div>" +
    '<div class="card wcard"><div class="wsub">' + tabs.map(function (t) { return '<button data-wl="' + t[0] + '"' + (WA_LISTA === t[0] ? ' class="on"' : "") + ">" + t[1] + "<span>" + t[2] + "</span></button>"; }).join("") + '</div><div class="wscroll"><table class="wtab" id="waTabla"></table></div></div>';
  pintarListaWA();
  // Gráficos
  var dd = (d.dist || {})[P] || {}, base = { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom", labels: { boxWidth: 12, font: { size: 12 } } } } };
  var dias = Object.keys(d.nuevosPorDia || {}), cuantos = P === "mes" ? 30 : 14; dias = dias.slice(-cuantos);
  var etiq = dias.map(function (x) { var q = x.split("-"); return q[2] + "/" + q[1]; });
  var nombreDia = dias.map(function (x) { return new Date(x + "T12:00:00").toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long" }); });
  grafico("g-dias", { type: "bar", data: { labels: etiq, datasets: [{ label: "Chats nuevos", data: dias.map(function (x) { return d.nuevosPorDia[x]; }), backgroundColor: dias.map(function (x, i) { return i === dias.length - 1 ? "#1FA855" : "#9FDDB4"; }), borderRadius: 4 }] }, options: Object.assign({}, base, { plugins: { legend: { display: false }, tooltip: { callbacks: { title: function (it) { return nombreDia[it[0].dataIndex]; }, label: function (it) { return it.raw + " chats nuevos"; } } } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } }) });
  var t = dd.temp || {};
  grafico("g-temp", { type: "doughnut", data: { labels: ["Caliente", "Tibio", "Frío", "Sin analizar"], datasets: [{ data: [t.caliente || 0, t.tibio || 0, t.frio || 0, t.sin || 0], backgroundColor: ["#DC2626", "#EA5B0C", "#2563EB", "#E5E7EB"], borderWidth: 0 }] }, options: Object.assign({}, base, { cutout: "62%" }) });
  var pr = dd.productos || [];
  grafico("g-prod", { type: "bar", data: { labels: pr.map(function (x) { return x.producto.length > 24 ? x.producto.slice(0, 23) + "…" : x.producto; }), datasets: [{ data: pr.map(function (x) { return x.n; }), backgroundColor: "#EA5B0C", borderRadius: 4 }] }, options: Object.assign({}, base, { indexAxis: "y", plugins: { legend: { display: false }, tooltip: { callbacks: { title: function (it) { return pr[it[0].dataIndex].producto; } } } }, scales: { x: { beginAtZero: true, ticks: { precision: 0 } } } }) });
  var NE = { consulta: "Consulta", falta_cotizar: "Falta cotizar", cotizado: "Cotizado", negociando: "Negociando", vendido: "Vendido", perdido: "Perdido", no_cliente: "No es cliente" }, et = dd.etapa || {}, ek = Object.keys(NE).filter(function (x) { return et[x]; });
  grafico("g-etapa", { type: "bar", data: { labels: ek.map(function (x) { return NE[x]; }), datasets: [{ data: ek.map(function (x) { return et[x]; }), backgroundColor: ek.map(function (x) { return { consulta: "#9CA3AF", falta_cotizar: "#F59E0B", cotizado: "#EA5B0C", negociando: "#2563EB", vendido: "#1FA855", perdido: "#DC2626", no_cliente: "#D1D5DB" }[x]; }), borderRadius: 4 }] }, options: Object.assign({}, base, { indexAxis: "y", plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true, ticks: { precision: 0 } } } }) });
  var pu = dd.puntaje || [];
  grafico("g-punt", { type: "bar", data: { labels: ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"], datasets: [{ data: pu, backgroundColor: pu.map(function (x, i) { return i >= 7 ? "#DC2626" : i >= 4 ? "#EA5B0C" : "#93A3B8"; }), borderRadius: 4 }] }, options: Object.assign({}, base, { plugins: { legend: { display: false }, tooltip: { callbacks: { title: function (it) { return "Puntaje " + it[0].label; }, label: function (it) { return it.raw + " chats"; } } } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } }) });
}
document.addEventListener("click", function (ev) {
  var w = ev.target.closest("[data-wl]"); if (w) { WA_LISTA = w.dataset.wl; document.querySelectorAll("[data-wl]").forEach(function (x) { x.classList.toggle("on", x === w); }); pintarListaWA(); return; }
  var vb = ev.target.closest("[data-visto]"); if (vb) { ev.stopPropagation(); vb.disabled = true; fetch("/panel/api/805/visto", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ conv: vb.dataset.visto }) }).then(function () { var tr = vb.closest("tr"); if (tr) tr.remove(); if (WA) { WA.sinResponder = (WA.sinResponder || []).filter(function (c) { return c.conv !== vb.dataset.visto; }); } }); return; }
  var r = ev.target.closest("[data-wc]"); if (r) location.href = "/panel/805#" + encodeURIComponent(r.dataset.wc);
});
function cargarDash() {
  fetch("/panel/api/805/resumen").then(function (r) { return r.json(); }).then(pintarWA).catch(function () { $("#waDash").innerHTML = '<div class="vacio">No se pudieron cargar las métricas de WhatsApp</div>'; });
  cargarReportes();
}
var REPS = [];
function cargarReportes() {
  $("#rep-tit").textContent = "Reportes de WhatsApp (diario a las 21:00 y semanal los domingos)";
  fetch("/panel/api/805/reportes").then(function (r) { return r.json(); }).then(function (rs) {
    REPS = rs;
    $("#reps").innerHTML = rs.length ? rs.map(function (r, ix) {
      var d = r.datos || {}, m = d.metricas || {}, ia = d.ia || {};
      var titulo = (r.tipo === "805_semanal" ? "Semanal" : "Diario") + " · " + new Date(r.desde).toLocaleDateString("es-AR") + (r.tipo === "805_semanal" ? " al " + new Date(r.hasta - 1).toLocaleDateString("es-AR") : "");
      var li = function (t, xs) { return (xs || []).length ? "<h5>" + t + "</h5><ul>" + xs.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul>" : ""; };
      var dif = (ia.difusion || []).map(function (x, k) { return '<div class="dif"><div class="dt"><b>' + esc(x.producto) + '</b><button class="btn" data-copiar="' + ix + "-" + k + '">Copiar mensaje</button></div><div class="dpq">' + esc(x.por_que || "") + '</div><pre id="m-' + ix + "-" + k + '">' + esc(x.mensaje || "") + "</pre></div>"; }).join("");
      return '<details class="rep2"' + (ix === 0 ? " open" : "") + '><summary><span class="rt">' + titulo + '</span><span class="rk">' + (m.nuevos || 0) + " nuevos · " + (m.cotizaciones || 0) + " cotizaciones · " + (m.ventas || 0) + ' ventas</span><a class="btn" target="_blank" href="/panel/805/reporte?id=' + encodeURIComponent(r.id) + '">PDF</a><button class="btn rojo" data-borrar="' + esc(r.id) + '">Borrar</button></summary><div class="rb">' +
        '<div class="rkv"><div>Chats nuevos<b>' + (m.nuevos || 0) + "</b></div><div>Cotizaciones<b>" + (m.cotizaciones || 0) + "</b></div><div>Ventas<b>" + (m.ventas || 0) + "</b></div><div>Sin responder<b>" + (m.sinResponder || 0) + "</b></div><div>Respuesta<b>" + (m.respuestaMin == null ? "-" : m.respuestaMin + " min") + "</b></div></div>" +
        (ia.titular ? "<p><b>" + esc(ia.titular) + "</b></p>" : "") + li("Claves", ia.claves) + li("A quién escribir", ia.oportunidades) + li("A mejorar", ia.problemas) + (ia.grupos ? "<h5>Grupos</h5><p>" + esc(ia.grupos) + "</p>" : "") + (ia.recomendacion ? "<h5>Recomendación</h5><p>" + esc(ia.recomendacion) + "</p>" : "") + (dif ? "<h5>Para mandar en los grupos</h5>" + dif : "") + "</div></details>";
    }).join("") : '<div class="vacio">Todavía no hay reportes. Se generan solos a las 21:00.</div>';
  }).catch(function () {});
}
$("#reps").onclick = function (ev) {
  var b = ev.target.closest("[data-borrar]"); if (b) { ev.preventDefault(); if (!confirm("¿Borrar este reporte?")) return; fetch("/panel/api/805/borrar-reporte", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: b.dataset.borrar }) }).then(function () { aviso("Reporte borrado"); cargarReportes(); }); return; }
  var c = ev.target.closest("[data-copiar]"); if (c) { ev.preventDefault(); var t = document.getElementById("m-" + c.dataset.copiar).textContent; navigator.clipboard.writeText(t).then(function () { c.textContent = "Copiado"; setTimeout(function () { c.textContent = "Copiar mensaje"; }, 1500); }); }
};
$("#generar").onclick = function () { var b = this; b.disabled = true; b.textContent = "Generando..."; fetch("/panel/api/805/reporte", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tipo: P === "semana" ? "805_semanal" : "805_diario" }) }).then(function () { aviso("Reporte generado"); cargarReportes(); }).finally(function () { b.disabled = false; b.textContent = "Generar ahora"; }); };

// ---------- Chats ----------
function cargarLista() {
  return api("chats").then(function (l) {
    chats = l; var f = JSON.stringify(l.map(function (c) { return [c.tel, c.cuando, c.temp, c.espera, c.pend]; })) + $("#buscar").value;
    if (f === firmaLista) return; firmaLista = f; pintarLista();
  }).catch(function () {});
}
function pintarLista() {
  var q = $("#buscar").value.toLowerCase().trim();
  var ver = chats.filter(function (c) { if (FILTRO === "pend" && !c.pend) return false; if (FILTRO === "caliente" || FILTRO === "tibio") { if (c.temp !== FILTRO) return false; } else if (FILTRO === "frio" && (c.temp === "caliente" || c.temp === "tibio")) return false; return true; }).filter(function (c) { return !q || (c.nombre || "").toLowerCase().indexOf(q) >= 0 || c.tel.indexOf(q.replace(/\D/g, "") || "x") >= 0; });
  $("#items").innerHTML = ver.map(function (c) { var n = c.nombre || "+" + c.tel; return '<div class="it' + (c.tel === actual ? " on" : "") + (c.espera ? " espera" : "") + '" data-t="' + c.tel + '"><div class="av t-' + color(c.temp) + '">' + esc(n.replace(/[^A-Za-zÁÉÍÓÚÑáéíóúñ0-9]/g, "").charAt(0).toUpperCase() || "#") + '</div><div class="nom">' + esc(n) + "</div>" + (c.pend ? '<span class="pd">' + c.pend + "</span>" : "") + '<div class="h">' + hora(c.cuando) + "</div></div>"; }).join("") || '<div class="vacio" style="padding:16px">Sin chats</div>';
}
$("#items").onclick = function (ev) { var it = ev.target.closest(".it"); if (it) abrir(it.dataset.t); };
$("#buscar").oninput = function () { firmaLista = ""; pintarLista(); };
document.querySelectorAll("#chips .chip").forEach(function (b) { b.onclick = function () { FILTRO = b.dataset.f; document.querySelectorAll("#chips .chip").forEach(function (x) { x.classList.toggle("on", x === b); }); pintarLista(); }; });
function abrir(tel) {
  actual = tel; firmaChat = ""; $("#chats").classList.add("abierto");
  document.querySelectorAll(".it").forEach(function (x) { x.classList.toggle("on", x.dataset.t === tel); });
  $("#conv").innerHTML = '<div class="nada">Cargando...</div>'; cargarChat(true);
  history.replaceState(null, "", "/panel?tel=" + tel);
}
function cargarChat(forzar) {
  if (!actual) return; var tel = actual;
  return api("chat?tel=" + tel).then(function (c) {
    if (tel !== actual) return;
    var f = JSON.stringify([c.mensajes.length, c.mensajes.length && c.mensajes[c.mensajes.length - 1].t, c.pausado, c.temp, c.salud, (c.fallos || []).length, c.mensajes.map(function (m) { return m.st; }).join("")]);
    if (!forzar && f === firmaChat) return; firmaChat = f;
    var caja = document.querySelector(".msgs"), abajo = !caja || caja.scrollHeight - caja.scrollTop - caja.clientHeight < 80, borrador = ($("#txt") || {}).value || "";
    var n = c.nombre || "+" + c.tel, etq = { caliente: "Caliente", tibio: "Tibio" }[c.temp] || "Frío / sin dato";
    var msgs = c.mensajes.map(function (m) {
      var quien = m.r === "a" ? "Agente" : m.r === "h" ? "Equipo" : m.r === "n" ? "Nota interna" : "";
      var imgs = (m.img || []).map(function (id) { return '<a href="/panel/media?id=' + encodeURIComponent(id) + '" target="_blank"><img loading="lazy" src="/panel/media?id=' + encodeURIComponent(id) + '"></a>'; }).join("");
      var t = m.img && m.img.length && m.t === "(imagen)" ? "" : esc(String(m.t).replace(/^\((admin|[a-z0-9]+)\) /i, function (x) { return m.r === "h" ? "" : x; }));
      if (m.arch) { var src = "/panel/media?id=" + encodeURIComponent(m.arch.id); imgs += m.arch.tipo === "audio" ? '<audio controls preload="none" src="' + src + '"></audio>' : '<a class="doc" target="_blank" href="' + src + '">📄 ' + esc(m.arch.nombre || "archivo") + "</a>"; t = t.replace(/^\((audio|archivo)\)\s*/, ""); if (m.arch.tipo === "audio") t = ""; }
      var tilde = { sent: '<span class="tl" title="Enviado">✓</span>', delivered: '<span class="tl" title="Entregado">✓✓</span>', read: '<span class="tl leido" title="Leído">✓✓</span>', failed: '<span class="tl fallo" title="No se entregó">⚠ no entregado</span>' }[m.st] || "";
      var hh = m.ts ? '<span class="hr">' + hora(m.ts) + (new Date(m.ts).toDateString() === new Date().toDateString() ? "" : " " + new Date(m.ts).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false })) + tilde + "</span>" : "";
      return '<div class="m ' + m.r + '">' + (quien ? '<span class="q">' + quien + "</span>" : "") + imgs + t + hh + "</div>";
    }).join("");
    $("#conv").innerHTML = '<div class="chead"><button class="volver" id="volver">‹ Chats</button><div class="av t-' + color(c.temp) + '">' + esc(n.charAt(0).toUpperCase()) + '</div><div class="q"><b>' + esc(n) + '</b><small>+' + c.tel + " · " + etq + (c.puntaje ? " " + c.puntaje + "/10" : "") + "</small></div>" +
      '<span class="estado' + (c.salud !== "ok" ? " riesgo" : "") + '">' + (c.salud !== "ok" ? "En riesgo" : c.pausado ? "Lo atiende el equipo" : "Agente activo") + "</span>" +
      (c.pausado ? '<button class="btn lleno" data-a="reanudar">Devolver al agente</button>' : '<button class="btn" data-a="pausa">Tomar chat</button>') +
      (c.salud !== "ok" ? '<button class="btn rojo" data-a="bien">Marcar como resuelto</button>' : "") + '<a class="btn" target="_blank" href="https://wa.me/' + c.tel + '">WhatsApp</a></div>' +
      '<div class="msgs">' + ((c.fallos || []).length ? '<div class="fallo"><b>⚠️ Mensajes que WhatsApp NO entregó:</b><br>' + c.fallos.map(function (f) { return hora(f.ts) + " · " + esc(/131047/.test(f.det) ? "pasaron más de 24 h desde el último mensaje del cliente (WhatsApp no deja escribirle gratis)" : /131053/.test(f.det) ? "audio en formato no aceptado" : /131042/.test(f.det) ? "problema de facturación de la cuenta de WhatsApp" : f.det.slice(0, 120)); }).join("<br>") + "</div>" : "") + (c.oferta ? '<div class="oferta"><b>Oferta vigente:</b> ' + esc(c.oferta) + "</div>" : "") + (c.resumen ? '<div class="resumen"><b>Resumen:</b> ' + esc(c.resumen) + (c.salud !== "ok" && c.motivo ? "<br><b>Riesgo:</b> " + esc(c.motivo) : "") + "</div>" : "") + msgs + "</div>" +
      (c.oferta ? "" : "") + '<div class="comp"><button class="ico" id="adj" title="Mandar imagen o PDF">📎</button><input type="file" id="archivo" accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx" hidden><button class="ico" id="mic" title="Mantené apretado para grabar">🎤</button><textarea id="txt" placeholder="Escribir como equipo"></textarea><button id="enviar">Enviar</button></div>';
    $("#txt").value = borrador;
    var cj = document.querySelector(".msgs"); if (abajo || forzar) cj.scrollTop = cj.scrollHeight;
    $("#volver").onclick = function () { actual = null; $("#chats").classList.remove("abierto"); history.replaceState(null, "", "/panel?tab=chats"); pintarLista(); };
    document.querySelectorAll(".chead [data-a]").forEach(function (b) { b.onclick = function () { b.disabled = true; api("accion", { tel: c.tel, a: b.dataset.a }).then(function (r) { aviso(r.res && r.res !== "listo" ? r.res : "Listo"); cargarChat(true); cargarLista(); }); }; });
    $("#enviar").onclick = enviarMsg;
    $("#adj").onclick = function () { $("#archivo").click(); };
    $("#archivo").onchange = function () { var f = this.files[0], pie = $("#txt").value.trim(); if (f) aImagenOk(f).then(function (x) { subirArchivo(x, pie); }); this.value = ""; };
    prepararMic($("#mic")); if (G) pintarGrab();
    $("#txt").onpaste = function (ev) { var fs = Array.prototype.filter.call((ev.clipboardData || {}).files || [], function (f) { return /^image\//.test(f.type); }); if (!fs.length) return; ev.preventDefault(); fs.forEach(function (f) { var n = new File([f], "imagen." + (f.type.split("/")[1] || "png").replace("jpeg", "jpg"), { type: f.type }); aImagenOk(n).then(function (x) { subirArchivo(x, $("#txt").value.trim()); }); }); };
    $("#txt").onkeydown = function (e) { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); enviarMsg(); } };
  }).catch(function () {});
}
function enviarMsg() {
  var t = $("#txt").value.trim(); if (!t || !actual) return; $("#txt").value = "";
  var cj = document.querySelector(".msgs"); cj.insertAdjacentHTML("beforeend", '<div class="m h"><span class="q">Equipo</span>' + esc(t) + "</div>"); cj.scrollTop = cj.scrollHeight;
  api("enviar", { tel: actual, texto: t }).then(function (r) { if (!r.ok) aviso("No se pudo enviar (¿pasaron más de 24 h desde el último mensaje del cliente?)"); cargarChat(true); cargarLista(); });
}

// ---------- Archivos y audios ----------
// WhatsApp solo acepta imágenes JPG o PNG de hasta 5 MB: las demás se convierten (y se achican si hace falta)
function aImagenOk(f) {
  return new Promise(function (ok) {
    if (!/^image\//.test(f.type) || (/^image\/(jpeg|png)$/.test(f.type) && f.size < 4.5e6)) return ok(f);
    var im = new Image(); im.onload = function () { var k = Math.min(1, 2400 / Math.max(im.width, im.height)), c = document.createElement("canvas"); c.width = im.width * k; c.height = im.height * k; c.getContext("2d").drawImage(im, 0, 0, c.width, c.height); c.toBlob(function (b) { ok(new File([b], "imagen.jpg", { type: "image/jpeg" })); }, "image/jpeg", 0.88); };
    im.onerror = function () { ok(f); }; im.src = URL.createObjectURL(f);
  });
}
function subirArchivo(f, pie) {
  if (!actual) return; var tel = actual;
  var fd = new FormData(); fd.append("tel", tel); fd.append("file", f, f.name || "audio"); if (pie) { fd.append("texto", pie); $("#txt").value = ""; }
  var cj = document.querySelector(".msgs"); cj.insertAdjacentHTML("beforeend", '<div class="m h"><span class="q">Equipo</span>Enviando ' + esc(f.name || "audio") + "...</div>"); cj.scrollTop = cj.scrollHeight;
  fetch("/panel/api/archivo", { method: "POST", body: fd }).then(function (x) { return x.json(); }).then(function (r) { if (!r.ok) aviso(r.res || "No se pudo enviar"); cargarChat(true); cargarLista(); }).catch(function () { aviso("No se pudo enviar"); });
}
// Grabador estilo WhatsApp: mantener apretado graba; soltar envía; deslizar a la izquierda cancela; deslizar arriba bloquea.
// Un toque corto también graba en modo "bloqueado" (con botones de borrar y enviar). Graba en OGG/Opus, el formato de las notas de voz de WhatsApp.
var OPUS = null;
function cargarOpus() {
  if (OPUS) return OPUS;
  OPUS = new Promise(function (ok, mal) {
    var sc = document.createElement("script"); sc.src = "https://cdn.jsdelivr.net/npm/opus-recorder@8.0.5/dist/recorder.min.js";
    sc.onload = function () { fetch("https://cdn.jsdelivr.net/npm/opus-recorder@8.0.5/dist/encoderWorker.min.js").then(function (r) { return r.text(); }).then(function (t) { ok(URL.createObjectURL(new Blob([t], { type: "text/javascript" }))); }).catch(mal); };
    sc.onerror = mal; document.head.appendChild(sc);
  });
  OPUS.catch(function () { OPUS = null; });
  return OPUS;
}
var G = null;   // grabación en curso
function fmtT(s) { s = Math.floor(s); return Math.floor(s / 60) + ":" + ("0" + (s % 60)).slice(-2); }
function pintarGrab() {
  var comp = document.querySelector("#conv .comp"); if (!comp || !G) return;
  var b = comp.querySelector(".grab");
  if (!b) { b = document.createElement("div"); b.className = "grab"; comp.appendChild(b); }
  b.innerHTML = G.bloq ? '<button class="acc tirar" data-g="tirar" title="Borrar">🗑</button><span class="pt"></span><span class="tm">' + fmtT(G.seg) + '</span><span class="hint">Grabando...</span><button class="acc mandar" data-g="mandar" title="Enviar">➤</button>'
    : '<span class="pt"></span><span class="tm">' + fmtT(G.seg) + '</span><span class="hint">‹ deslizá para cancelar</span>';
  var cd = comp.querySelector(".candado");
  if (!G.bloq && !cd) { cd = document.createElement("div"); cd.className = "candado"; cd.innerHTML = "🔒<br>↑"; comp.appendChild(cd); }
  if (G.bloq && cd) cd.remove();
}
function cerrarGrab() { var comp = document.querySelector("#conv .comp"); if (comp) { var b = comp.querySelector(".grab"), cd = comp.querySelector(".candado"); if (b) b.remove(); if (cd) cd.remove(); } }
function empezarGrab() {
  if (G || !actual) return;
  G = { tel: actual, seg: 0, bloq: false, listo: false, enviar: false, cancel: false };
  var esta = G;
  pintarGrab();
  cargarOpus().then(function (worker) {
    if (esta.cancel) return;
    return navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }).then(function (st) {
    if (esta.cancel) { st.getTracks().forEach(function (x) { x.stop(); }); return; }
    var ac = new (window.AudioContext || window.webkitAudioContext)(), src = ac.createMediaStreamSource(st);
    var comp = ac.createDynamicsCompressor(); comp.threshold.value = -32; comp.knee.value = 12; comp.ratio.value = 5; comp.attack.value = 0.004; comp.release.value = 0.2;
    var gan = ac.createGain(); gan.gain.value = 2.6;   // sube el volumen (el compresor evita que sature)
    var lim = ac.createDynamicsCompressor(); lim.threshold.value = -3; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.001; lim.release.value = 0.05;
    var dest = ac.createMediaStreamDestination(); src.connect(comp); comp.connect(gan); gan.connect(lim); lim.connect(dest);
    esta.limpiar = function () { st.getTracks().forEach(function (x) { x.stop(); }); try { ac.close(); } catch (e) {} };
    var rec = new Recorder({ encoderPath: worker, numberOfChannels: 1, encoderApplication: 2048, encoderSampleRate: 48000, streamPages: false, maxFramesPerPage: 40, sourceNode: ac.createMediaStreamSource(dest.stream) });
    rec.ondataavailable = function (datos) {
      if (esta.enviar && esta.seg >= 1) { var tel = actual; actual = esta.tel; subirArchivo(new File([datos], "audio.ogg", { type: "audio/ogg" }), ""); actual = tel; }
    };
    esta.rec = rec;
    return rec.start().then(function () { esta.t0 = Date.now(); esta.int = setInterval(function () { esta.seg = (Date.now() - esta.t0) / 1000; if (G === esta) pintarGrab(); }, 250); });
    });
  }).catch(function (e) { terminarGrab(false, true); aviso(/Permission|NotAllowed/i.test(String(e)) ? "Permití el micrófono en el navegador para grabar audios" : "No se pudo iniciar el grabador. Probá recargar la página."); });
}
function terminarGrab(enviarlo, silencio) {
  var g = G; if (!g) return; G = null; cerrarGrab();
  g.enviar = !!enviarlo; g.cancel = !enviarlo;
  if (g.int) clearInterval(g.int);
  if (g.rec) g.rec.stop(); else if (g.limpiar) g.limpiar();
  if (g.limpiar) setTimeout(g.limpiar, 600); 
  if (silencio) return;
  if (!enviarlo) aviso("Audio descartado"); else if (g.seg < 1) aviso("Mantené apretado para grabar");
}
function prepararMic(btn) {
  var x0, y0, t0;
  btn.onpointerdown = function (ev) { ev.preventDefault(); if (G && G.bloq) return; btn.setPointerCapture(ev.pointerId); x0 = ev.clientX; y0 = ev.clientY; t0 = Date.now(); empezarGrab(); };
  btn.onpointermove = function (ev) {
    if (!G || G.bloq || x0 == null) return;
    if (x0 - ev.clientX > 90) { x0 = null; terminarGrab(false); }
    else if (y0 - ev.clientY > 70) { x0 = null; G.bloq = true; pintarGrab(); }
  };
  btn.onpointerup = function () {
    if (x0 == null) return; x0 = null;
    if (!G || G.bloq) return;
    if (Date.now() - t0 < 350) { G.bloq = true; pintarGrab(); return; }   // toque corto: queda grabando con botones
    terminarGrab(true);
  };
  btn.oncontextmenu = function (e) { e.preventDefault(); };
}
document.addEventListener("click", function (ev) { var b = ev.target.closest("[data-g]"); if (!b || !G) return; terminarGrab(b.dataset.g === "mandar"); });

// ---------- Agentes ----------
var AG = "asistente", agImgs = [], ASIS = [];
function pintarAsistente() {
  $("#agReglasBox").style.display = "none"; $("#agFoto").style.display = "none"; $("#agTxt").placeholder = "Preguntale sobre los chats del 805: a quién le tenías que mandar algo, qué se pidió más hoy, quién quedó sin respuesta...";
  $("#agHilo").innerHTML = (ASIS.length ? ASIS : [{ r: "a", t: "Preguntame lo que quieras sobre los chats del WhatsApp 805. Por ejemplo: a quién le tenías que mandar un producto, qué se pidió más hoy o quién quedó sin respuesta." }]).map(function (m) { return '<div class="burb ' + (m.r === "u" ? "u" : "a") + '">' + esc(m.t).replace(/\+?(549\d{8,11})/g, '<a href="/panel/805#$1" style="color:inherit;font-weight:700">+$1</a>') + "</div>"; }).join("") +
    '<div class="sugA">' + ["Qué productos se pidieron más hoy", "A quién tengo que responder primero", "Qué cotizaciones quedaron pendientes"].map(function (x) { return '<button data-sug="' + x + '">' + x + "</button>"; }).join("") + "</div>";
  $("#agHilo").scrollTop = 1e9;
}
function preguntarAsis(q) {
  if (!q) return; ASIS.push({ r: "u", t: q }); ASIS.push({ r: "a", t: "Buscando en los chats..." }); pintarAsistente();
  fetch("/panel/api/805/preguntar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pregunta: q, historial: ASIS.slice(0, -2).slice(-6) }) }).then(function (r) { return r.json(); }).then(function (r) { ASIS[ASIS.length - 1] = { r: "a", t: r.respuesta }; pintarAsistente(); }).catch(function () { ASIS[ASIS.length - 1] = { r: "a", t: "No pude responder. Probá de nuevo." }; pintarAsistente(); });
}
$("#agHilo").addEventListener("click", function (ev) { var b = ev.target.closest("[data-sug]"); if (b) preguntarAsis(b.dataset.sug); });
function cargarAgente() { if (AG === "asistente") return pintarAsistente(); $("#agReglasBox").style.display = ""; $("#agFoto").style.display = ""; $("#agTxt").placeholder = "Escribile al agente: enseñale algo, corregilo o pedile una acción. Podés pegar capturas con Ctrl+V"; api("agente-hilo?a=" + AG).then(pintarAgente).catch(function () {}); }
function pintarAgente(d) {
  var h = d.hilo || [];
  $("#agHilo").innerHTML = h.length ? h.map(function (m, i) {
    var x = '<div class="burb ' + m.r + '">' + esc(m.t).replace(/\+?(54\d{9,11})\b/g, '<a href="/panel?tel=$1" style="color:inherit;font-weight:700">+$1</a>') + (m.n ? " <i>(" + m.n + " captura" + (m.n > 1 ? "s" : "") + ")</i>" : "");
    (m.reglas || []).forEach(function (r, j) { x += '<div class="prop"><span>📌 ' + esc(r) + '</span><button class="btn lleno" data-regla="' + i + "-" + j + '">Guardar regla</button></div>'; });
    (m.olvidar || []).forEach(function (n) { x += '<div class="prop"><span>🗑️ Borrar la regla ' + n + ": " + esc((d.reglas || [])[n - 1] || "") + '</span><button class="btn rojo" data-olvidar="' + n + '">Borrar</button></div>'; });
    (m.acciones || []).forEach(function (a, j) { x += '<div class="prop"><span>⚡ ' + esc(a.descripcion || a.tipo) + (a.texto ? ': "' + esc(a.texto) + '"' : "") + '</span><button class="btn lleno" data-accion="' + i + "-" + j + '">Hacerlo</button></div>'; });
    return x + "</div>";
  }).join("") : '<div class="vacio">Escribile al agente para enseñarle algo o corregirlo.<br><br>Ejemplos:<br>· "el chat de Abel no está en riesgo"<br>· "cuando pregunten por factura, decí que hacemos factura C" <br>· pegá una captura y decile "acá respondiste mal porque..."<br><br><b>Para probarlo sin usar WhatsApp</b>, escribí:<br>· "probá: traen productos de arabia saudita?"<br>y te muestra qué le contestaría a un cliente, sin mandar nada.</div>';
  window.__agHilo = h;
  $("#agN").textContent = (d.reglas || []).length;
  $("#agReglas").innerHTML = (d.reglas || []).map(function (r, i) { return '<li>' + esc(r) + ' <button data-editar="' + (i + 1) + '" title="Editar">✏️</button><button data-olvidar="' + (i + 1) + '" title="Borrar">🗑️</button></li>'; }).join("") || "<li>Todavía no tiene reglas guardadas.</li>";
  var hl = $("#agHilo"); hl.scrollTop = hl.scrollHeight;
}
function agAplicar(body, btn) { if (btn) btn.disabled = true; body.agente = AG; api("agente-aplicar", body).then(function (r) { aviso(r.res || "Listo"); if (btn && r.ok) { btn.textContent = "✓ Hecho"; } else if (btn) btn.disabled = false; cargarAgente(); }); }
$("#agHilo").onclick = function (ev) {
  var b = ev.target.closest("button"); if (!b) return; var h = window.__agHilo || [];
  if (b.dataset.regla) { var p = b.dataset.regla.split("-"); agAplicar({ tipo: "regla", regla: h[p[0]].reglas[p[1]] }, b); }
  if (b.dataset.olvidar) agAplicar({ tipo: "olvidar", n: +b.dataset.olvidar }, b);
  if (b.dataset.accion) { var q = b.dataset.accion.split("-"), ac = h[q[0]].acciones[q[1]]; if (ac.tipo === "mensaje_cliente" && !confirm("¿Mandarle este mensaje al cliente?\n\n" + ac.texto)) return; agAplicar({ tipo: "accion", accion: ac }, b); }
};
$("#agReglas").onclick = function (ev) {
  var b = ev.target.closest("button"); if (!b) return;
  if (b.dataset.olvidar && confirm("¿Borrar esta regla?")) agAplicar({ tipo: "olvidar", n: +b.dataset.olvidar });
  if (b.dataset.editar) { var actualTxt = b.parentNode.firstChild.textContent.trim(), nuevo = prompt("Editá la regla:", actualTxt); if (nuevo && nuevo.trim() !== actualTxt) agAplicar({ tipo: "editar", n: +b.dataset.editar, regla: nuevo.trim() }); }
};
$("#agOrdenar").onclick = function () { aviso("Ordenando..."); agAplicar({ tipo: "consolidar" }); };
$("#agLimpiar").onclick = function () { if (confirm("¿Borrar la conversación con este agente? Las reglas guardadas no se borran.")) agAplicar({ tipo: "limpiar" }); };
$("#agLista").onclick = function (ev) { var b = ev.target.closest("button"); if (!b) return; AG = b.dataset.a; document.querySelectorAll("#agLista button").forEach(function (x) { x.classList.toggle("on", x === b); }); $("#agHilo").innerHTML = '<div class="vacio">Cargando...</div>'; cargarAgente(); };
function agAgregarImg(f) { if (!f || !/^image\//.test(f.type) || agImgs.length >= 6) return; var rd = new FileReader(); rd.onload = function () { var c = document.createElement("canvas"), im = new Image(); im.onload = function () { var k = Math.min(1, 1600 / Math.max(im.width, im.height)); c.width = im.width * k; c.height = im.height * k; c.getContext("2d").drawImage(im, 0, 0, c.width, c.height); agImgs.push(c.toDataURL("image/jpeg", 0.85)); pintarAdj(); }; im.src = rd.result; }; rd.readAsDataURL(f); }
function pintarAdj() { $("#agAdj").innerHTML = agImgs.map(function (d, i) { return '<img src="' + d + '" title="Tocá para sacar" data-i="' + i + '">'; }).join(""); }
$("#agAdj").onclick = function (ev) { var i = ev.target.dataset.i; if (i != null) { agImgs.splice(+i, 1); pintarAdj(); } };
$("#agFoto").onclick = function () { $("#agFile").click(); };
$("#agFile").onchange = function () { Array.prototype.forEach.call(this.files, agAgregarImg); this.value = ""; };
$("#agTxt").onpaste = function (ev) { Array.prototype.forEach.call((ev.clipboardData || {}).files || [], agAgregarImg); };
$("#agTxt").onkeydown = function (e) { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("#agEnviar").click(); } };
$("#agEnviar").onclick = function () {
  if (AG === "asistente") { var q = $("#agTxt").value.trim(); $("#agTxt").value = ""; preguntarAsis(q); return; }
  var t = $("#agTxt").value.trim(); if (!t && !agImgs.length) return; var b = this; b.disabled = true; b.textContent = "Pensando...";
  $("#agHilo").insertAdjacentHTML("beforeend", '<div class="burb u">' + esc(t) + (agImgs.length ? " <i>(" + agImgs.length + " captura/s)</i>" : "") + '</div><div class="burb a"><i>Pensando...</i></div>'); $("#agHilo").scrollTop = 1e9;
  var imgs = agImgs; agImgs = []; pintarAdj(); $("#agTxt").value = "";
  api("agente", { agente: AG, texto: t, imagenes: imgs }).then(function (r) { if (!r.ok) aviso(r.respuesta || "No respondió"); cargarAgente(); }).finally(function () { b.disabled = false; b.textContent = "Enviar"; });
};

// ---------- Pendientes ----------
var TIPOS = { ig_revisar: "Instagram: comentario para vos", cierre: "Quiere comprar", proveedor: "Buscar proveedor", cotizacion: "Cotización para aprobar", comprobante: "Comprobante de pago", derivado: "Chat derivado: respondele vos", promesa: "El agente prometió algo", riesgo: "Chat en riesgo", recontactar: "Seguimiento para mandar vos", busqueda_lista: "Búsqueda de proveedores lista", informe_listo: "Informe de proveedores listo" };
var ORDEN = { cierre: 0, cotizacion: 0, comprobante: 1, proveedor: 2, busqueda_lista: 2, derivado: 2, promesa: 3, riesgo: 4, recontactar: 5 }, firmaT = "";
function hace(ms) { var m = Math.round((Date.now() - ms) / 60000); return m < 60 ? "hace " + m + " min" : m < 1440 ? "hace " + Math.round(m / 60) + " h" : "hace " + Math.round(m / 1440) + " d"; }
function contarPend() { api("tareas").then(function (ts) { $("#nPend").textContent = ts.length || ""; if ($("#v-pend").classList.contains("on")) pintarTareas(ts); }).catch(function () {}); }
function cargarTareas() { firmaT = ""; contarPend(); }
var filtroT = "todos", abiertosT = {}, ultimasT = [];
var GRUPO_T = { proveedor: "proveedor", busqueda_lista: "proveedor", informe_listo: "proveedor", ig_revisar: "instagram", cotizacion: "cotizacion", comprobante: "venta", cierre: "venta", derivado: "chats", promesa: "chats", riesgo: "chats", recontactar: "chats" };
var NOMBRE_G = { todos: "Todos", proveedor: "Buscar proveedor", instagram: "Instagram", cotizacion: "Cotizaciones", venta: "Ventas y pagos", chats: "Chats y seguimientos", otros: "Otros" };
function grupoT(t) { return GRUPO_T[t.tipo] || "otros"; }
function cortoT(t) {
  var base = "";
  var m = String(t.detalle || "").match(/Producto:\s*([^\n|]+)/i) || String(t.titulo || "").match(/(?:Buscar proveedor(?: que venda \d+ u de)?|Cotizaci[oó]n:|Busca)\s*([^(\n|]+)/i);
  base = m ? m[1] : (t.titulo || "");
  base = base.replace(/\bx\d+.*$/i, "").replace(/[·|,.:;]+/g, " ").trim();
  var ws = base.split(/\s+/).filter(Boolean).slice(0, 4); while (ws.length > 1 && /^(y|de|del|la|el|los|las|para|con|en|a|o|que|por)$/i.test(ws[ws.length - 1])) ws.pop(); var w = ws.join(" ");
  return w || (TIPOS[t.tipo] || t.tipo);
}
function pintarTareas(ts) {
  ultimasT = ts;
  var f = JSON.stringify([filtroT, ts.map(function (t) { return [t.id, t.ts]; })]); if (f === firmaT) return; firmaT = f;
  ts.sort(function (a, b) { return (ORDEN[a.tipo] ?? 9) - (ORDEN[b.tipo] ?? 9) || b.ts - a.ts; });
  var cuenta = { todos: ts.length }; ts.forEach(function (t) { var g = grupoT(t); cuenta[g] = (cuenta[g] || 0) + 1; });
  var chips = ["todos", "proveedor", "cotizacion", "venta", "chats", "instagram", "otros"].filter(function (g) { return g === "todos" || cuenta[g]; })
    .map(function (g) { return '<button class="chip' + (filtroT === g ? " on" : "") + '" data-fil="' + g + '">' + NOMBRE_G[g] + " " + (cuenta[g] || 0) + "</button>"; }).join("");
  var lista = ts.filter(function (t) { return filtroT === "todos" || grupoT(t) === filtroT; });
  $("#tareas").innerHTML = '<div class="chipsT">' + chips + "</div>" + (lista.length ? lista.map(function (t) {
    var b = [];
    if (t.tipo === "cotizacion") b = ['<button class="btn lleno" data-a="ok">Enviar al cliente</button>', '<button class="btn rojo" data-a="no">Descartar</button>'];
    else if (t.tipo === "comprobante") b = ['<button class="btn lleno" data-a="ok">Entró la plata</button>', '<button class="btn rojo" data-a="no">No entró</button>'];
    else if (t.tipo === "recontactar") b = ['<a class="btn lleno" target="_blank" data-wa="1" href="https://wa.me/' + t.tel + '?text=' + encodeURIComponent(t.datos.mensaje || "") + '">Abrir en mi WhatsApp</a>', '<button class="btn" data-a="hecho">Ya lo mandé</button>'];
    else if (t.tipo === "busqueda_lista") b = ['<a class="btn lleno" href="/panel/busquedas#' + esc(t.datos.busqueda || "") + '">Ver proveedores</a>', '<button class="btn" data-a="hecho">Listo, resuelto</button>'];
    else if (t.tipo === "proveedor") b = ['<a class="btn lleno" href="/panel/busquedas?tarea=' + encodeURIComponent(t.id) + '">Buscar proveedor ahora</a>', '<button class="btn" data-a="hecho">Listo, resuelto</button>'];
    else b = ['<button class="btn" data-a="hecho">Listo, resuelto</button>'];
    if (String(t.tel).indexOf("ig:") === 0) b.unshift('<a class="btn lleno" target="_blank" href="' + esc(t.datos.link || "https://instagram.com") + '">Abrir publicación</a>'); else if (t.tel) b.push('<button class="btn" data-ver="' + t.tel + '">Ver chat</button>');
    return '<details class="tk ' + t.tipo + '" data-id="' + t.id + '"' + (abiertosT[t.id] ? " open" : "") + '><summary class="cab2"><span class="tipo">' + (TIPOS[t.tipo] || t.tipo) + '</span><b class="corto">' + esc(cortoT(t)) + '</b><span class="quien">' + esc(t.nombre || (t.tel ? "+" + t.tel : "")) + '</span><span class="cuando">' + hace(t.ts) + '</span></summary><div class="cuerpo">' +
      '<div class="tit">' + esc(t.titulo) + '</div>' + (t.tipo === "recontactar" ? '<textarea>' + esc(t.datos.mensaje || "") + '</textarea>' : (t.detalle ? "<pre>" + esc(t.detalle) + "</pre>" : "")) +
      (t.datos.foto ? '<a target="_blank" href="/panel/media?id=' + encodeURIComponent(t.datos.foto) + '"><img loading="lazy" src="/panel/media?id=' + encodeURIComponent(t.datos.foto) + '"></a>' : "") + '<div class="acc">' + b.join("") + "</div></div></details>";
  }).join("") : '<div class="vacio">Nada pendiente en esta categoría.</div>');
}
$("#cerrarRiesgos").onclick = function (ev) { ev.preventDefault(); if (confirm("¿Cerrar todos los pendientes de 'chat en riesgo'?")) api("tareas-cerrar-tipo", { tipo: "riesgo" }).then(function () { aviso("Listo"); firmaT = ""; contarPend(); }); };
$("#tareas").addEventListener("toggle", function (ev) { var d = ev.target; if (d.dataset && d.dataset.id) abiertosT[d.dataset.id] = d.open; }, true);
$("#tareas").onclick = function (ev) {
  var fl = ev.target.closest("[data-fil]"); if (fl) { filtroT = fl.dataset.fil; firmaT = ""; pintarTareas(ultimasT); return; }
  var el = ev.target.closest("[data-a],[data-ver],[data-wa]"); if (!el) return; var tk = el.closest(".tk");
  if (el.dataset.ver) { location.href = "/panel/805#" + encodeURIComponent(el.dataset.ver); return; }
  if (el.dataset.wa) { var ta = tk.querySelector("textarea"); el.href = el.href.split("?")[0] + "?text=" + encodeURIComponent(ta ? ta.value : ""); return; }
  el.disabled = true; api("tarea", { id: tk.dataset.id, a: el.dataset.a }).then(function (r) { aviso(r.res || "Listo"); if (r.ok) tk.remove(); firmaT = ""; contarPend(); });
};

// ---------- Arranque y actualización en vivo ----------
function arrancar() {
  var q = new URLSearchParams(location.search);
  if (q.get("tel")) { verTab("chats"); abrir(q.get("tel").replace(/\D/g, "")); } else if (q.get("tab") === "chats") verTab("chats"); else cargarDash();
  setInterval(function () { if (document.hidden) return; if ($("#v-chats").classList.contains("on")) { cargarChat(false); if (++ciclosLista % 5 === 0) cargarLista(); } }, 3000);
  var ciclosLista = 0;
  setInterval(function () { if (!document.hidden && $("#v-dash").classList.contains("on")) cargarDash(); }, 60000);
  api("importar-viejos").then(function (r) { if (r.n) { aviso("Pasé " + r.n + " pendiente(s) viejos al panel"); contarPend(); } }).catch(function () {});
  contarPend(); setInterval(function () { if (!document.hidden) contarPend(); }, 30000);
  if (q.get("tab") === "pend") verTab("pend");
}
api("estado").then(function (s) {
  $("#usuario").textContent = s.usuario || "";
  if (s.indexado) return arrancar();
  $("#cargando").style.display = "flex";
  var paso = function (desde) { api("reindexar?desde=" + encodeURIComponent(desde || "")).then(function (r) { if (r.siguiente) paso(r.siguiente); else { $("#cargando").style.display = "none"; arrancar(); } }); };
  paso("");
});
</script></body></html>
`;

// ---------------- Entrada ----------------
export default {
  async scheduled(evento, envBase, ctx) {
    const env = { ...envBase, ESTADO: await almacen(envBase) };
    // Se usa la hora PROGRAMADA del cron (no la del reloj al terminar): así el resumen
    // y los seguimientos no se saltean aunque la vuelta tarde
    const m = new Date(evento.scheduledTime || Date.now()).getUTCMinutes();
    ctx.waitUntil((async () => {
      const h = new Date(evento.scheduledTime || Date.now()).getUTCHours();
      if (h === APRENDIZAJE.horaUTC && m === APRENDIZAJE.minuto) await autoaprender(env).catch((e) => console.log("Error autoaprender:", e?.stack || e));
      if (m % 5 === 0) await seguimientosAuto(env).catch((e) => console.log("Error seguimiento auto:", e?.stack || e));
      if (m % 5 === 0) await recordarVentanas(env).catch((e) => console.log("Error recordatorio ventana:", e?.stack || e));
      if (m % 5 === 2) await supervisarChats(env, h % SALUD.supervisorCadaHoras === 0 && m === 22).catch((e) => console.log("Error supervisor:", e?.stack || e));
      if (m % 5 === 0) await correrSeguimientos(env).catch((e) => console.log("Error seguimientos:", e?.stack || e));
      await procesarBuffers(env).catch((e) => console.log("Error red:", e?.stack || e));
      await cronLector(env, iaJSON, evento.scheduledTime || Date.now()).catch((e) => console.log("Error lector 805:", e?.stack || e));
    })());
  },
  async fetch(req, envBase, ctx) {
    const env = { ...envBase, ESTADO: await almacen(envBase) };
    const url = new URL(req.url);
    const clave = url.searchParams.get("clave");
    // Lector 805: el puente de WhatsApp (solo lectura) postea acá
    if (url.pathname.startsWith("/lector/")) return rutaLector(env, req, url, ctx);
    if (url.pathname.startsWith("/informes/")) return rutaInformes(env, url);   // cola de informes para la tarea programada de Claude
    if (url.pathname === "/reset") {
      if (clave !== env.VERIFY_TOKEN) return new Response("Falta ?clave=", { status: 401 });
      const tel = (url.searchParams.get("tel") || "").replace(/\D/g, "");
      if (!tel) return new Response("Falta ?tel=");
      for (const k of [`v3:${tel}`, `seg:${tel}`, `lock:${tel}`, `pausa:${tel}`, `buf:${tel}`, `bu:${tel}`, `proc:${tel}`]) await env.ESTADO.delete(k);
      await tomarPrefijo(env, `bm:${tel}:`);
      return new Response(`Estado de +${tel} reseteado (incluida la pausa).`);
    }
    if (["/alta", "/procesar", "/suscribir", "/modelos", "/catalogo-test"].includes(url.pathname) && clave !== env.VERIFY_TOKEN) return new Response("Falta ?clave=", { status: 401 });
    if (url.pathname === "/alta") return new Response(paginaAlta(env), { headers: { "Content-Type": "text/html; charset=utf-8" } });
    if (url.pathname === "/alta/cierre" && req.method === "POST") {
      if (clave !== env.VERIFY_TOKEN) return new Response("Sin permiso", { status: 401 });
      return new Response(await cierreAlta(env, await req.json()), { headers: { "Content-Type": "text/plain; charset=utf-8" } });
    }
    if (url.pathname === "/resumen") { if (clave !== env.VERIFY_TOKEN) return new Response("Falta ?clave=", { status: 401 }); await enviarResumen(env); return new Response("Resumen enviado (si había actividad)"); }
    if (url.pathname === "/supervisar") { if (clave !== env.VERIFY_TOKEN) return new Response("Falta ?clave=", { status: 401 }); return new Response(await supervisarChats(env, true), { headers: { "Content-Type": "text/plain; charset=utf-8" } }); }
    if (url.pathname === "/seguimientos") { if (clave !== env.VERIFY_TOKEN) return new Response("Falta ?clave=", { status: 401 }); await seguimientosAuto(env); return new Response("Seguimientos revisados"); }
    if (url.pathname === "/aprender-ahora") { if (clave !== env.VERIFY_TOKEN) return new Response("Falta ?clave=", { status: 401 }); return new Response(await autoaprender(env, true), { headers: { "Content-Type": "text/plain; charset=utf-8" } }); }
    if (url.pathname === "/procesar") { await procesarBuffers(env, true); return new Response("ok"); }
    if (url.pathname === "/login-diagnostico") {
      if (clave !== env.VERIFY_TOKEN) return new Response("Falta ?clave=", { status: 401 });
      // Prueba: compara lo que escribís con lo cargado, sin mostrar contraseñas
      if (req.method === "POST") {
        const f = await req.formData(), us = usuariosPanel(env);
        const u = String(f.get("u") || "").trim().toLowerCase(), p = String(f.get("p") || "").trim();
        const real = us[u];
        const pista = (x) => `${x.length} caracteres, empieza con "${x[0] || ""}" y termina con "${x.slice(-1)}"`;
        const dif = real && real !== p ? [...real].findIndex((c, i) => c !== p[i]) : -1;
        return new Response(`Usuario escrito: "${u}" → ${real !== undefined ? "EXISTE ✅" : "NO existe ❌ (usuarios cargados: " + Object.keys(us).join(", ") + ")"}\n` +
          `Contraseña escrita: ${pista(p)}\n` + (real !== undefined ? `Contraseña cargada: ${pista(real)}\n→ ${real === p ? "COINCIDEN ✅ (el login debería andar)" : "NO coinciden ❌, primera diferencia en el carácter N° " + ((dif < 0 ? Math.min(real.length, p.length) : dif) + 1)}` : "") +
          `\n\nIntentos fallidos bloqueados de tu conexión: ${(await env.ESTADO.get("loginfallo:" + (req.headers.get("cf-connecting-ip") || "x"))) || 0} de 8`,
          { headers: { "Content-Type": "text/plain; charset=utf-8" } });
      }
      if (url.searchParams.get("desbloquear") !== null) {
        let n = 0; for (const k of (await env.ESTADO.list({ prefix: "loginfallo:" })).keys) { await env.ESTADO.delete(k.name); n++; }
        return new Response(`✅ Listo: desbloqueé ${n} conexión(es). Ya podés entrar al panel.`, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
      }
      if (url.searchParams.get("prueba") !== null) return new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font-family:Arial;padding:20px"><h3>Probar usuario y contraseña</h3><form method="post"><p><input name="u" placeholder="Usuario" autocomplete="off" style="font-size:16px;padding:8px"></p><p><input name="p" type="text" placeholder="Contraseña" autocomplete="off" style="font-size:16px;padding:8px"></p><button style="font-size:16px;padding:8px 16px">Probar</button></form>`, { headers: { "Content-Type": "text/html; charset=utf-8" } });
      const us = usuariosPanel(env), crudo = String(env.PANEL_USUARIOS || "");
      return new Response(`PANEL_USUARIOS cargada: ${crudo ? "sí (" + crudo.length + " caracteres)" : "NO (no llega al worker)"}\n\nUsuarios que entiende el panel:\n` +
        (Object.entries(us).map(([u, p]) => `- "${u}" con contraseña de ${p.length} caracteres (empieza con "${p[0] || ""}" y termina con "${p.slice(-1)}")`).join("\n") || "(ninguno: revisá el formato usuario:contraseña)"),
        { headers: { "Content-Type": "text/plain; charset=utf-8" } });
    }
    if (url.pathname === "/login") return login(env, req, url);
    if (url.pathname === "/logout") return new Response(null, { status: 303, headers: { Location: "/login", "Set-Cookie": "ti_sesion=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax" } });
    if (url.pathname.startsWith("/panel")) {
      const quien = await usuarioSesion(env, req);
      if (!quien) return url.pathname === "/panel" ? Response.redirect(new URL(`/login?volver=${encodeURIComponent(url.pathname + url.search)}`, url).toString(), 303) : new Response("Iniciá sesión", { status: 401 });
      url.searchParams.set("quien", quien);
    }
    if (url.pathname === "/panel/media") {
      try {
        const H = { Authorization: `Bearer ${env.WA_TOKEN}` };
        const meta = await (await fetch(`https://graph.facebook.com/v21.0/${encodeURIComponent(url.searchParams.get("id") || "")}`, { headers: H })).json();
        if (!meta.url) return new Response("La foto ya no está disponible en WhatsApp", { status: 404 });
        const img = await fetch(meta.url, { headers: H });
        return new Response(img.body, { headers: { "Content-Type": meta.mime_type || "image/jpeg", "Cache-Control": "private, max-age=86400" } });
      } catch { return new Response("No se pudo cargar la foto", { status: 502 }); }
    }
    if (url.pathname.startsWith("/panel/api/805/")) return apiLector(env, req, url, iaJSON);
    if (url.pathname.startsWith("/panel/api/busquedas/")) return apiBusquedas(env, req, url, url.searchParams.get("quien"), Object.keys(usuariosPanel(env)));
    if (url.pathname === "/panel/busquedas") return new Response(PANEL_BUSQUEDAS, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
    if (url.pathname === "/panel/805/reporte") return paginaReporte(env, url.searchParams.get("id") || "");
    if (url.pathname === "/panel/805") return new Response(PANEL_805, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
    if (url.pathname.startsWith("/panel/api/")) return panelAPI(env, req, url, url.searchParams.get("quien"));
    if (url.pathname === "/panel/reporte.pdf") return descargarReporte(env, url);
    if (url.pathname === "/panel/accion" || url.pathname === "/panel/enviar") {
      return panelAccion(env, url, req);
    }
    if (url.pathname === "/panel") return new Response(PANEL_APP, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
    if (url.pathname === "/numeros") {
      if (clave !== env.VERIFY_TOKEN) return new Response("Falta ?clave=", { status: 401 });
      return new Response(await listarNumeros(env, url.searchParams.get("negocio") || "1769208074411196"), { headers: { "Content-Type": "text/plain; charset=utf-8" } });
    }
    if (url.pathname === "/registrar") {
      if (clave !== env.VERIFY_TOKEN) return new Response("Falta ?clave=", { status: 401 });
      const id = url.searchParams.get("phone") || env.WA_PHONE_ID, pin = url.searchParams.get("pin") || "123456";
      const r = await fetch(`https://graph.facebook.com/v21.0/${id}/register`, { method: "POST", headers: { Authorization: `Bearer ${env.WA_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify({ messaging_product: "whatsapp", pin }) });
      return new Response(`Registro del número ${id}: ${JSON.stringify(await r.json())}\n\nSi dice success:true, el número ya puede enviar y recibir. PIN de 2 pasos: ${pin} (guardalo).`, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
    }
    if (url.pathname === "/importacion") {
      if (clave !== env.VERIFY_TOKEN) return new Response("Falta ?clave=", { status: 401 });
      return new Response((await env.ESTADO.get("importacion")) || "Todavía no llegó el historial", { headers: { "Content-Type": "text/plain; charset=utf-8" } });
    }
    if (url.pathname === "/test-sheets") {
      if (clave !== env.VERIFY_TOKEN) return new Response("Falta ?clave=", { status: 401 });
      if (!env.SHEETS_URL) return new Response("❌ Falta la variable SHEETS_URL en Cloudflare");
      const rs = await fetch(`${env.SHEETS_URL}?clave=${encodeURIComponent(env.VERIFY_TOKEN)}`, { method: "POST", redirect: "follow",
        body: JSON.stringify({ telefono: "0000000000", nombre_whatsapp: "PRUEBA", resumen: "Fila de prueba", ultimo_contacto: new Date().toISOString() }) });
      const txt = await rs.text();
      return new Response(`Estado: ${rs.status}\nRespuesta: ${txt.slice(0, 300)}\n\n${txt.trim() === "ok" ? "✅ Funciona: fijate la fila PRUEBA en la hoja Leads" : txt.includes("sin permiso") ? "❌ La clave del script no coincide con VERIFY_TOKEN" : "❌ Revisá que la app web esté implementada con acceso 'Cualquier usuario'"}`, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
    }
    if (url.pathname === "/catalogo-test") { await env.ESTADO.delete("catalogo"); const l = await catalogo(env); return new Response(`${l.length} productos\n` + l.slice(0, 10).map((p) => `${p.cat} | ${p.nombre} | ${pesos(p.precio)}`).join("\n"), { headers: { "Content-Type": "text/plain; charset=utf-8" } }); }
    if (url.pathname === "/sync-sheets") {
      if (clave !== env.VERIFY_TOKEN) return new Response("Falta ?clave=", { status: 401 });
      const lst = await env.ESTADO.list({ prefix: "lead:" });
      let n = 0;
      for (const k of lst.keys) { const l = JSON.parse((await env.ESTADO.get(k.name)) || "null"); if (l) { await enviarASheets(env, l); n++; } }
      return new Response(`Enviados ${n} clientes a la planilla.`, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
    }
    if (url.pathname === "/leads.csv") {
      if (clave !== env.VERIFY_TOKEN) return new Response("Falta ?clave=", { status: 401 });
      return new Response(await exportarLeads(env), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": "attachment; filename=leads.csv" } });
    }
    if (url.pathname === "/suscribir") {
      const waba = url.searchParams.get("waba");
      if (!waba) return new Response("Falta ?waba=");
      const r = await fetch(`https://graph.facebook.com/v21.0/${waba}/subscribed_apps`, { method: "POST", headers: { Authorization: `Bearer ${env.WA_TOKEN}` } });
      return new Response(JSON.stringify(await r.json()), { headers: { "Content-Type": "application/json" } });
    }
    if (url.pathname === "/modelos") { await env.ESTADO.delete("modelos"); return new Response(JSON.stringify(await modelosDisponibles(env))); }
    if (url.pathname === "/privacidad") return new Response(PRIVACIDAD, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    if (req.method === "GET") {
      if (url.searchParams.get("hub.verify_token") === env.VERIFY_TOKEN) return new Response(url.searchParams.get("hub.challenge"));
      return new Response("Agente Te Importamos activo");
    }
    if (req.method === "POST") {
      const crudo = await req.text();
      if (env.APP_SECRET && !(await firmaValida(env.APP_SECRET, crudo, req.headers.get("x-hub-signature-256")))) {
        console.log("Firma inválida: mensaje rechazado");
        return new Response("firma inválida", { status: 401 });
      }
      let body = {}; try { body = JSON.parse(crudo); } catch {}
      const cambio = body.entry?.[0]?.changes?.[0];
      const v = cambio?.value;
      if (cambio?.field === "history") { ctx.waitUntil(importarHistorial(env, v).catch((e) => console.log("Error historial:", e))); return new Response("ok"); }
      if (cambio?.field === "smb_message_echoes") { ctx.waitUntil(registrarEco(env, v).catch((e) => console.log("Error eco:", e))); return new Response("ok"); }
      if (cambio?.field === "smb_app_state_sync") return new Response("ok");
      // Coexistencia: mensajes que el equipo manda desde la app del celular
      for (const eco of v?.message_echoes || []) {
        if (!eco.to || eco.type !== "text") continue;
        ctx.waitUntil((async () => {
          const ec = JSON.parse((await env.ESTADO.get(`v3:${eco.to}`)) || "null") || { historial: [] };
          ec.historial = [...(ec.historial || []), { r: "h", t: eco.text?.body || "", ts: Date.now() }].slice(-60);
          await env.ESTADO.put(`v3:${eco.to}`, JSON.stringify(ec), { expirationTtl: 90 * 86400 });
          const hs = num(env.PAUSA_AUTO_HORAS) ?? CONVIVENCIA.pausaSiRespondeHumano;
          if (hs > 0) await env.ESTADO.put(`pausa:${eco.to}`, "1", { expirationTtl: Math.round(hs * 3600) });
        })());
      }
      // Avisos de Meta sobre mensajes que NO se pudieron entregar: se registran para saber por qué
      const ORDEN_ST = { sent: 1, delivered: 2, read: 3, failed: 9 };
      if ((v?.statuses || []).length && env.DB) ctx.waitUntil((async () => {
        for (const st of v.statuses) {
          if (!st.id || !ORDEN_ST[st.status]) continue;
          await env.DB.prepare("INSERT INTO kv (k, v, exp) VALUES (?, ?, ?) ON CONFLICT(k) DO UPDATE SET v = CASE WHEN excluded.v = 'failed' OR (CASE kv.v WHEN 'sent' THEN 1 WHEN 'delivered' THEN 2 WHEN 'read' THEN 3 WHEN 'failed' THEN 9 ELSE 0 END) < (CASE excluded.v WHEN 'sent' THEN 1 WHEN 'delivered' THEN 2 WHEN 'read' THEN 3 ELSE 0 END) THEN excluded.v ELSE kv.v END")
            .bind(`st:${st.id}`, st.status, Date.now() + 10 * 86400e3).run().catch(() => {});
        }
      })());
      for (const st of v?.statuses || []) {
        if (st.status !== "failed") continue;
        const err = st.errors?.[0] || {};
        const det = `${err.code || "?"} ${err.title || ""} ${err.error_data?.details || err.message || ""}`.trim();
        console.log("NO ENTREGADO a", st.recipient_id, det);
        ctx.waitUntil((async () => {
          const l = JSON.parse((await env.ESTADO.get("fallos_envio")) || "[]");
          l.unshift({ ts: Date.now(), tel: st.recipient_id, det });
          await env.ESTADO.put("fallos_envio", JSON.stringify(l.slice(0, 50)));
        })());
      }
      const msg = v?.messages?.[0];
      if (msg?.type === "interactive") {
        const resp = msg.interactive?.list_reply || msg.interactive?.button_reply;
        if (resp) { msg.type = "text"; msg.text = { body: resp.id }; msg.deMenu = msg.interactive?.type === "list_reply"; }
      }
      if (msg?.type === "button") { msg.type = "text"; msg.text = { body: msg.button?.payload || msg.button?.text || "" }; }
      if (msg?.type === "document" && /^image\//.test(msg.document?.mime_type || "")) { msg.type = "image"; msg.image = { id: msg.document.id, caption: msg.document.caption }; }
      if (msg?.type === "text" && /^\*?(continue setting up|your account|meta for business)|whatsapp manager/i.test(msg.text?.body || "")) return new Response("ok");
      if (msg && ["text", "image", "audio"].includes(msg.type) && !(await env.ESTADO.get(`m:${msg.id}`))) {
        await env.ESTADO.put(`m:${msg.id}`, "1", { expirationTtl: 3600 });
        console.log("Mensaje de", msg.from, msg.type);
        if (VENTANA_EQUIPO.numeros.some((n) => ultimos10(n) === ultimos10(msg.from))) {
          await env.ESTADO.put(`vent:${ultimos10(msg.from)}`, String(Date.now()), { expirationTtl: 3 * 86400 });
          // Respuesta corta al recordatorio ("ok", "listo"...): solo renueva la ventana, el agente no contesta
          const rec = +(await env.ESTADO.get(`ventRecordado:${ultimos10(msg.from)}`)) || 0;
          if (rec && Date.now() - rec < 3 * 3600e3 && msg.type === "text" && String(msg.text?.body || "").trim().length <= 25 && !/^#/.test(msg.text?.body || "")) {
            await env.ESTADO.delete(`ventRecordado:${ultimos10(msg.from)}`);
            ctx.waitUntil(leidoYEscribiendo(env, msg.id).then(() => fetch(`https://graph.facebook.com/v21.0/${env.WA_PHONE_ID}/messages`, { method: "POST", headers: { Authorization: `Bearer ${env.WA_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to: msg.from, type: "reaction", reaction: { message_id: msg.id, emoji: "👍" } }) })).catch(() => {}));
            return new Response("ok");
          }
        }
        const nombreC = v.contacts?.[0]?.profile?.name || "";
        const inmediato = (msg.type === "text" && /^#/.test(msg.text?.body || "")) || esperaMs(env) === 0;   // solo los comandos (#...) van al instante; el resto, también del equipo, espera como un cliente
        if (inmediato) {
          ctx.waitUntil(leidoYEscribiendo(env, msg.id));
          ctx.waitUntil(enCola(env, msg.from, () => procesar(env, msg.from, msg, nombreC)).catch((e) => console.log("Error:", e?.stack || e)));
        } else {
          await encolarMensaje(env, msg, nombreC);   // responde cuando el cliente deja de escribir (el "leído" y "escribiendo..." aparecen después, como una persona)
          ctx.waitUntil(esperarYResponder(env, msg).catch((e) => console.log("Error espera:", e?.stack || e)));
        }
      } else if (msg && ["video", "location"].includes(msg.type) && !(await env.ESTADO.get(`pausa:${msg.from}`))) {
        ctx.waitUntil(enviar(env, msg.from, "eso no lo puedo ver desde aca, me lo escribis o me mandas una captura?"));
      }
      return new Response("ok");
    }
    return new Response("Método no permitido", { status: 405 });
  },
};