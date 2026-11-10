Warning: truncated output (original token count: 88285)
Total output lines: 3748

import { rutaLector, apiLector, cronLector, paginaReporte } from "./lector.js";
import { PANEL_805 } from "./lector-panel.js";
import { apiCotizar, paginaCotizacion, PANEL_COTIZAR, cotizarAuto } from "./cotizar.js";
import { apiBusquedas, PANEL_BUSQUEDAS, rutaInformes, rutaImagen } from "./busquedas.js";
import { apiRedes, PANEL_REDES, cronRedes, contextoRedes } from "./redes.js";
import { apiVideos, rutaVideosEditor, cronVideos, despertarEditor } from "./videos.js";
import { conApp, rutaApp } from "./app.js";
import { metricasWeb, PANEL_WEB } from "./posthog.js";
import { altIA } from "./ia-alterna.js";
import { apiTablero, cronTablero } from "./tablero.js";
import { PANEL_P } from "./panel-p.js";
import { rutaTelegram, apiAsistente, cronAsistente } from "./asistente.js";
import { preguntarAgente, charlaAgente } from "./agente.js";
import { apiGrupos, cronGrupos } from "./grupos.js";
import { simularRedactar } from "./autoresp.js";
import { cronEntrenador } from "./entrenador.js";
/**
 * Agente de WhatsApp · Te Importamos (v15.0: + pestaña Búsquedas de proveedores)
 * Cloudflare Workers + Gemini (gratis) con respaldo de Cloudflare AI.
 *
 * Variables: WA_TOKEN, WA_PHONE_ID, VERIFY_TOKEN, GEMINI_KEY, ADMIN_PHONE (varios separados por coma)
 * Opcionales: NUMERO_AGENTE (número donde atiende el agente, ej. 5493412595936), NUMERO_EQUIPO, APP_SECRET (verifica que los mensajes vengan de Meta), SHEETS_URL (leads a Google Sheets)
 * Bindings:  ESTADO (KV), AI (Workers AI), DB (D1, recomendado: memoria consistente)
 * Trigger:   Cron cada 1 minuto (red de seguridad de respuestas, alertas y resumen a la hora en punto)
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
// Anti pérdida de leads
const SALUD = { minutosSinRespuesta: 5, alertaCadaHoras: 2, supervisorCadaHoras: 3 };
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
    { const ag = await env.ESTADO.get(`agotado:${m}`); if (ag === "1") await env.ESTADO.delete(`agotado:${m}`); else if (ag) continue; }   // "1" = bloqueo viejo de 6 h: se libera
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
// Un 429 de Gemini puede ser "por minuto" (se libera en segundos) o "por día" (hasta la medianoche del Pacífico).
// Antes todo 429 bloqueaba el modelo 6 horas y por eso la IA quedaba "sin responder" de golpe.
async function marcarAgotado(env, m, j) {
  const txt = JSON.stringify(j?.error || {});
  const porDia = /PerDay|per_day|daily/i.test(txt);
  const rd = +((txt.match(/"retryDelay"\s*:\s*"(\d+)/) || [])[1] || 0);
  let ttl;
  if (porDia) { const ahora = new Date(), reset = Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth(), ahora.getUTCDate(), 8, 0, 0); ttl = Math.round(((reset > ahora.getTime() ? reset : reset + 86400e3) - ahora.getTime()) / 1000); }
  else ttl = Math.min(300, Math.max(60, rd + 5));
  await env.ESTADO.put(`agotado:${m}`, porDia ? "dia" : "minuto", { expirationTtl: ttl });
}
// Cada modelo gratis de Gemini tiene su propia cuota diaria: probar varios multiplica lo que se puede usar por día
const MODELOS_RESPALDO = ["gemini-flash-latest", "gemini-flash-lite-latest", "gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.0-flash", "gemini-2.0-flash-lite"];
async function modelosDisponibles(env) {
  const base = await modelosDisponibles0(env), out = [];
  for (const m of [...(env.GEMINI_MODEL ? [env.GEMINI_MODEL] : []), ...base, ...MODELOS_RESPALDO]) if (!out.includes(m)) out.push(m);
  return out.slice(0, 8);
}
async function modelosDisponibles0(env) {
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
{"…58285 tokens truncated…porte", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tipo: P === "semana" ? "805_semanal" : "805_diario" }) }).then(function () { aviso("Reporte generado"); cargarReportes(); }).finally(function () { b.disabled = false; b.textContent = "Generar ahora"; }); };

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
var ASIS_CARGADA = false;
function pintarAsistente() {
  $("#agReglasBox").style.display = "none"; $("#agFoto").style.display = "none"; $("#agTxt").placeholder = "Preguntale lo que quieras de ventas o de redes: por qué no cerramos, por qué bajaron las vistas, pedile ideas u opinión. Es el mismo agente que el de Telegram.";
  if (!ASIS_CARGADA) { ASIS_CARGADA = true; fetch("/panel/api/agente/charla").then(function (r) { return r.json(); }).then(function (l) { if (!ASIS.length && l.length) { ASIS = l.map(function (m) { return { r: m.rol === "u" ? "u" : "a", t: m.texto }; }); pintarAsistente(); } }).catch(function () {}); }
  $("#agHilo").innerHTML = (ASIS.length ? ASIS : [{ r: "a", t: "Soy el agente de Te Importamos: veo las ventas del WhatsApp 805 y las métricas de Instagram y TikTok. Preguntame por qué pasó algo, pedime ideas u opinión: te contesto con los números y te digo qué hacer." }]).map(function (m) { return '<div class="burb ' + (m.r === "u" ? "u" : "a") + '">' + esc(m.t).replace(/\+?(549\d{8,11})/g, '<a href="/panel/805#$1" style="color:inherit;font-weight:700">+$1</a>') + "</div>"; }).join("") +
    '<div class="sugA">' + ["¿Por qué no cerramos más ventas esta semana?", "¿Por qué bajaron las vistas?", "Dame 3 ideas de reels con lo que funcionó", "¿Qué video anduvo en TikTok y no en Instagram, y por qué?", "¿Qué hago hoy para vender más?"].map(function (x) { return '<button data-sug="' + x + '">' + x + "</button>"; }).join("") + "</div>";
  $("#agHilo").scrollTop = 1e9;
}
function preguntarAsis(q) {
  if (!q) return; ASIS.push({ r: "u", t: q }); ASIS.push({ r: "a", t: "Mirando los números…" }); pintarAsistente();
  fetch("/panel/api/agente/preguntar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pregunta: q }) }).then(function (r) { return r.json(); }).then(function (r) { ASIS[ASIS.length - 1] = { r: "a", t: r.respuesta }; pintarAsistente(); }).catch(function () { ASIS[ASIS.length - 1] = { r: "a", t: "No pude responder. Probá de nuevo." }; pintarAsistente(); });
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
    if (m.para_claude) x += '<div class="prop" style="flex-direction:column;align-items:stretch"><span><b>Esto es un arreglo de código.</b> Copiá este texto y mandáselo a Claude:</span><textarea readonly rows="6" style="width:100%;font-size:12px;margin:6px 0">' + esc(m.para_claude) + '</textarea><button class="btn lleno" data-claude="' + i + '">Copiar para Claude</button></div>';
    return x + "</div>";
  }).join("") : AG === "redes" ? '<div class="vacio">Este agente maneja comentarios, ideas, historias y videos. Enseñale o contale qué anda mal.<br><br>Ejemplos:<br>· "en los videos los subtítulos quedan muy abajo"<br>· "no me propongas más ideas de ropa"<br>· "los videos están hace una hora en cola, ¿qué pasa?"<br>· "a los comentarios que dicen precio respondé: te paso info por DM"<br><br>Si es un error de código, te arma el texto listo para mandarle a Claude.</div>' : '<div class="vacio">Escribile al agente para enseñarle algo o corregirlo.<br><br>Ejemplos:<br>· "el chat de Abel no está en riesgo"<br>· "cuando pregunten por factura, decí que hacemos factura C" <br>· pegá una captura y decile "acá respondiste mal porque..."<br><br><b>Para probarlo sin usar WhatsApp</b>, escribí:<br>· "probá: traen productos de arabia saudita?"<br>y te muestra qué le contestaría a un cliente, sin mandar nada.</div>';
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
  if (b.dataset.claude) { var tx = h[b.dataset.claude].para_claude; (navigator.clipboard ? navigator.clipboard.writeText(tx) : Promise.reject()).then(function () { aviso("Copiado. Pegáselo a Claude"); }).catch(function () { var ta = b.previousSibling; ta.select(); document.execCommand("copy"); aviso("Copiado"); }); }
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
var TIPOS = { ig_revisar: "Instagram: comentario para vos", cierre: "Quiere comprar", proveedor: "Buscar proveedor", cotizacion: "Cotización para aprobar", comprobante: "Comprobante de pago", derivado: "Chat derivado: respondele vos", promesa: "Le prometimos algo", riesgo: "Chat en riesgo", recontactar: "Seguimiento para mandar vos", busqueda_lista: "Búsqueda de proveedores lista", cotizacion_auto: "Cotización automática lista", informe_listo: "Informe de proveedores listo" };
var ORDEN = { cierre: 0, cotizacion: 0, comprobante: 1, proveedor: 2, busqueda_lista: 2, derivado: 2, promesa: 3, riesgo: 4, recontactar: 5 }, firmaT = "";
function hace(ms) { var m = Math.round((Date.now() - ms) / 60000); return m < 60 ? "hace " + m + " min" : m < 1440 ? "hace " + Math.round(m / 60) + " h" : "hace " + Math.round(m / 1440) + " d"; }
function contarPend() { api("tareas").then(function (ts) { NPEND = ts.length; $("#nPend").textContent = ts.length || ""; if (HACER === "pend") pintarTareas(ts); if ($("#hacerTabs").innerHTML) pintarHacer(); }).catch(function () {}); }
function cargarTareas() { firmaT = ""; contarPend(); }
var filtroT = "todos", abiertosT = {}, ultimasT = [];
var TIPOS805 = { cotizacion: "Hay que cotizar", promesa: "Le prometimos algo", comprobante: "Pagó: confirmar y pedir", proveedor: "Buscar proveedor" };
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
    var b = [], de805 = t.datos && t.datos.origen === "805";
    if (de805) b = ['<button class="btn" data-a="hecho">Listo, resuelto</button>'];
    else if (t.tipo === "cotizacion") b = ['<button class="btn lleno" data-a="ok">Enviar al cliente</button>', '<button class="btn rojo" data-a="no">Descartar</button>'];
    else if (t.tipo === "comprobante") b = ['<button class="btn lleno" data-a="ok">Entró la plata</button>', '<button class="btn rojo" data-a="no">No entró</button>'];
    else if (t.tipo === "recontactar") b = ['<a class="btn lleno" target="_blank" data-wa="1" href="https://wa.me/' + t.tel + '?text=' + encodeURIComponent(t.datos.mensaje || "") + '">Abrir en mi WhatsApp</a>', '<button class="btn" data-a="hecho">Ya lo mandé</button>'];
    else if (t.tipo === "cotizacion_auto") b = ['<a class="btn lleno" target="_blank" href="/panel/cotizar/pdf?id=' + esc(t.datos.cotiz || "") + '">Ver / PDF</a>', '<a class="btn" href="/panel/cotizar?id=' + esc(t.datos.cotiz || "") + '">Editar</a>', '<button class="btn" data-a="hecho">Ya la mandé</button>'];
    else if (t.tipo === "busqueda_lista") b = ['<a class="btn lleno" href="/panel/busquedas#' + esc(t.datos.busqueda || "") + '">Ver proveedores</a>', '<button class="btn" data-a="hecho">Listo, resuelto</button>'];
    else if (t.tipo === "proveedor") b = ['<a class="btn lleno" href="/panel/busquedas?tarea=' + encodeURIComponent(t.id) + '">Buscar proveedor ahora</a>', '<button class="btn" data-a="hecho">Listo, resuelto</button>'];
    else b = ['<button class="btn" data-a="hecho">Listo, resuelto</button>'];
    if (String(t.tel).indexOf("ig:") === 0) b.unshift('<a class="btn lleno" target="_blank" href="' + esc(t.datos.link || "https://instagram.com") + '">Abrir publicación</a>'); else if (t.tel) { b.push('<button class="btn" data-ver="' + t.tel + '">Ver chat</button>'); if (/^[0-9]{8,}$/.test(String(t.tel))) b.unshift('<a class="btn lleno" style="background:#1FA855;border-color:#1FA855" target="_blank" href="https://wa.me/' + t.tel + '">Abrir en WhatsApp</a>'); }
    return '<details class="tk ' + t.tipo + '" data-id="' + t.id + '"' + (abiertosT[t.id] ? " open" : "") + '><summary class="cab2"><span class="tipo">' + ((de805 && TIPOS805[t.tipo]) || TIPOS[t.tipo] || t.tipo) + '</span><b class="corto">' + esc(cortoT(t)) + '</b><span class="quien">' + esc(t.nombre || "") + (/^[0-9]{8,}$/.test(String(t.tel || "")) ? ' <button class="copiar" data-copiar="' + esc(t.tel) + '" title="Copiar número">' + esc(t.tel) + ' <span>Copiar</span></button>' : "") + '</span><span class="cuando">' + hace(t.ts) + '</span><button class="btn mini" data-a="hecho" title="Listo, sacarlo de la lista">Listo</button></summary><div class="cuerpo">' +
      '<div class="tit">' + esc(t.titulo) + '</div>' + (t.tipo === "recontactar" ? '<textarea>' + esc(t.datos.mensaje || "") + '</textarea>' : (t.detalle ? "<pre>" + esc(t.detalle) + "</pre>" : "")) +
      (t.datos.foto ? '<a target="_blank" href="/panel/media?id=' + encodeURIComponent(t.datos.foto) + '"><img loading="lazy" src="/panel/media?id=' + encodeURIComponent(t.datos.foto) + '"></a>' : "") + '<div class="acc">' + b.join("") + "</div></div></details>";
  }).join("") : '<div class="vacio">Nada pendiente en esta categoría.</div>');
}
$("#cerrarRiesgos").onclick = function (ev) { ev.preventDefault(); if (confirm("¿Cerrar todos los pendientes de 'chat en riesgo'?")) api("tareas-cerrar-tipo", { tipo: "riesgo" }).then(function () { aviso("Listo"); firmaT = ""; contarPend(); }); };
$("#tareas").addEventListener("toggle", function (ev) { var d = ev.target; if (d.dataset && d.dataset.id) abiertosT[d.dataset.id] = d.open; }, true);
$("#tareas").onclick = function (ev) {
  var cp = ev.target.closest("[data-copiar]"); if (cp) { ev.preventDefault(); ev.stopPropagation(); var num = cp.dataset.copiar; (navigator.clipboard ? navigator.clipboard.writeText(num) : Promise.reject()).catch(function () { var x = document.createElement("textarea"); x.value = num; document.body.appendChild(x); x.select(); document.execCommand("copy"); x.remove(); }); var sp = cp.querySelector("span"); if (sp) { sp.textContent = "Copiado"; setTimeout(function () { sp.textContent = "Copiar"; }, 1500); } return; }
  var fl = ev.target.closest("[data-fil]"); if (fl) { filtroT = fl.dataset.fil; firmaT = ""; pintarTareas(ultimasT); return; }
  var el = ev.target.closest("[data-a],[data-ver],[data-wa]"); if (!el) return; var tk = el.closest(".tk");
  if (el.dataset.ver) { location.href = "/panel/805#" + encodeURIComponent(el.dataset.ver); return; }
  if (el.dataset.wa) { var ta = tk.querySelector("textarea"); el.href = el.href.split("?")[0] + "?text=" + encodeURIComponent(ta ? ta.value : ""); return; }
  if (tk && el.closest("summary")) ev.preventDefault();
  el.disabled = true; api("tarea", { id: tk.dataset.id, a: el.dataset.a }).then(function (r) { aviso(r.res || "Listo"); if (r.ok) tk.remove(); firmaT = ""; contarPend(); });
};

// ---------- Arranque y actualización en vivo ----------
function arrancar() {
  var q = new URLSearchParams(location.search);
  if (q.get("tel")) { verTab("chats"); abrir(q.get("tel").replace(/\D/g, "")); } else if (q.get("tab") === "chats") verTab("chats"); else cargarDash();
  setInterval(function () { if (document.hidden || !document.hasFocus()) return; if ($("#v-chats").classList.contains("on")) { cargarChat(false); if (++ciclosLista % 4 === 0) cargarLista(); } }, 15000);
  var ciclosLista = 0;
  setInterval(function () { if (!document.hidden && document.hasFocus() && $("#v-dash").classList.contains("on")) cargarDash(); }, 300000);
  api("importar-viejos").then(function (r) { if (r.n) { aviso("Pasé " + r.n + " pendiente(s) viejos al panel"); contarPend(); } }).catch(function () {});
  contarPend(); setInterval(function () { if (!document.hidden && document.hasFocus()) contarPend(); }, 120000);
  if (q.get("tab") === "pend") verTab("pend");
  if (q.get("tab") === "herr") verTab("herr");
  if (q.get("tab") === "agentes") { var bAg = q.get("ag") && document.querySelector('#agLista button[data-a="' + q.get("ag") + '"]'); if (bAg) { AG = bAg.dataset.a; document.querySelectorAll("#agLista button").forEach(function (x) { x.classList.toggle("on", x === bAg); }); } verTab("agentes"); }
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
      if (m % 5 === 0) await recordarVentanas(env).catch((e) => console.log("Error recordatorio ventana:", e?.stack || e));
      if (m % 5 === 2) await supervisarChats(env, h % SALUD.supervisorCadaHoras === 0 && m === 22).catch((e) => console.log("Error supervisor:", e?.stack || e));
      await procesarBuffers(env).catch((e) => console.log("Error red:", e?.stack || e));
      await cronLector(env, iaJSON, evento.scheduledTime || Date.now()).catch((e) => console.log("Error lector 805:", e?.stack || e));
      await cronTablero(env).catch((e) => console.log("Error tablero:", e?.stack || e));
      // Entrenamiento del contestador: de noche y cuando se pide (rondas chicas, una por minuto)
      await claveNueva(env).catch(() => {});   // clave de Gemini cambiada: limpia los avisos viejos sin esperar a que alguien use la IA
      if (env.DB && env.LECTOR_TOKEN) await cronEntrenador(env, iaJSON, (ctx, ia) => simularRedactar(env, ia, ctx, T), evento.scheduledTime || Date.now()).catch((e) => console.log("Error entrenador:", e?.stack || e));
      if (m % 5 === 4 && env.LECTOR_TOKEN) await cotizarAuto(env, { T, leerPagina, iaJSON, iaConImagenes }).catch((e) => console.log("Error cotización automática:", e?.stack || e));
      if (env.DB) await cronVideos(env, evento.scheduledTime || Date.now()).catch((e) => console.log("Error videos:", e?.stack || e));
      if (env.DB) await cronAsistente(env, evento.scheduledTime || Date.now(), iaJSON).catch((e) => console.log("Error asistente:", e?.stack || e));
      if (env.DB) await cronGrupos(env, iaJSON, evento.scheduledTime || Date.now(), BASE_URL).catch((e) => console.log("Error grupos:", e?.stack || e));
      if (env.DB) await cronRedes(env, iaJSON, evento.scheduledTime || Date.now(), BASE_URL, T).catch((e) => console.log("Error redes:", e?.stack || e));
    })());
  },
  async fetch(req, envBase, ctx) {
    const env = { ...envBase, ESTADO: await almacen(envBase) };
    const url = new URL(req.url);
    const clave = url.searchParams.get("clave");
    // Lector 805: el puente de WhatsApp (solo lectura) postea acá
    { const a = rutaApp(url); if (a) return a; }   // app web (manifest e íconos, públicos)
    if (url.pathname.startsWith("/tg/") && req.method === "POST") return rutaTelegram(env, req, url, ctx, iaJSON);   // asistente de tareas por Telegram
    if (url.pathname.startsWith("/lector/")) return rutaLector(env, req, url, ctx, iaJSON, { T });
    if (url.pathname.startsWith("/informes/")) return rutaInformes(env, url);
    if (url.pathname.startsWith("/img/")) return rutaImagen(env, url);   // foto de referencia para la búsqueda por imagen en 1688   // cola de informes para la tarea programada de Claude
    if (url.pathname.startsWith("/videos/")) return rutaVideosEditor(env, req, url, iaJSON, BASE_URL);   // editor de videos (GitHub Actions)
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
    if (url.pathname === "/seguimientos") { if (clave !== env.VERIFY_TOKEN) return new Response("Falta ?clave=", { status: 401 }); return new Response("Los seguimientos comerciales se gestionan desde sender/responder.py"); }
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
    if (url.pathname === "/p" || url.pathname === "/p/") return Response.redirect(new URL("/panel/p", url).toString(), 302);
    if (url.pathname === "/login") return login(env, req, url);
    if (url.pathname === "/logout") return new Response(null, { status: 303, headers: { Location: "/login", "Set-Cookie": "ti_sesion=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax" } });
    if (url.pathname.startsWith("/panel")) {
      const quien = await usuarioSesion(env, req);
      if (!quien) return url.pathname === "/panel" ? Response.redirect(new URL(`/login?volver=${encodeURIComponent(url.pathname + url.search)}`, url).toString(), 303) : new Response("Iniciá sesión", { status: 401 });
      url.searchParams.set("quien", quien);
    }
    if (url.pathname === "/panel" || url.pathname === "/panel/p") return new Response(conApp(PANEL_P), { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
    if (url.pathname.startsWith("/panel/p/api/")) return apiTablero(env, req, url, url.searchParams.get("quien"), iaJSON).catch((e) => Response.json({ error: String(e?.message || e).slice(0, 400) }, { status: 500 }));
    if (url.pathname === "/panel/media") {
      try {
        const H = { Authorization: `Bearer ${env.WA_TOKEN}` };
        const meta = await (await fetch(`https://graph.facebook.com/v21.0/${encodeURIComponent(url.searchParams.get("id") || "")}`, { headers: H })).json();
        if (!meta.url) return new Response("La foto ya no está disponible en WhatsApp", { status: 404 });
        const img = await fetch(meta.url, { headers: H });
        return new Response(img.body, { headers: { "Content-Type": meta.mime_type || "image/jpeg", "Cache-Control": "private, max-age=86400" } });
      } catch { return new Response("No se pudo cargar la foto", { status: 502 }); }
    }
    // Un solo agente: el chat de la pestaña Agente, el asistente del 805 y el de Redes van al mismo (ventas + contenido, misma memoria)
    if (req.method === "POST" && ["/panel/api/agente/preguntar", "/panel/api/805/preguntar", "/panel/api/redes/preguntar"].includes(url.pathname)) { const b = await req.json().catch(() => ({})); try { return Response.json(await preguntarAgente(env, iaJSON, String(b.pregunta || ""))); } catch (e) { console.log("agente", e?.stack || e); return Response.json({ respuesta: "No pude responder: " + String(e?.message || e).slice(0, 300) }); } }
    if (url.pathname === "/panel/api/agente/charla") return Response.json(await charlaAgente(env));
    if (url.pathname.startsWith("/panel/api/805/grupos")) return apiGrupos(env, req, url, iaJSON);
    if (url.pathname.startsWith("/panel/api/805/")) return apiLector(env, req, url, iaJSON);
    if (url.pathname.startsWith("/panel/api/cotizar/")) return apiCotizar(env, req, url, url.searchParams.get("quien"), { T, leerPagina, iaJSON, iaConImagenes });
    if (url.pathname === "/panel/cotizar/pdf") return paginaCotizacion(env, url.searchParams.get("id") || "", T);
    if (url.pathname === "/panel/web") return new Response(conApp(PANEL_WEB), { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
    if (url.pathname === "/panel/cotizar") return new Response(conApp(PANEL_COTIZAR), { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
    if (url.pathname.startsWith("/panel/api/asistente/")) return apiAsistente(env, req, url, url.searchParams.get("quien"), BASE_URL, iaJSON);
    if (url.pathname.startsWith("/panel/api/videos/")) return apiVideos(env, req, url, url.searchParams.get("quien"));
    if (url.pathname.startsWith("/panel/api/redes/")) return apiRedes(env, req, url, url.searchParams.get("quien"), iaJSON, BASE_URL, T);
    if (url.pathname === "/panel/redes") return new Response(conApp(PANEL_REDES), { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
    if (url.pathname.startsWith("/panel/api/busquedas/")) return apiBusquedas(env, req, url, url.searchParams.get("quien"), Object.keys(usuariosPanel(env)));
    if (url.pathname === "/panel/busquedas") return new Response(conApp(PANEL_BUSQUEDAS), { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
    if (url.pathname === "/panel/805/reporte") return paginaReporte(env, url.searchParams.get("id") || "");
    if (url.pathname === "/panel/805") return new Response(conApp(PANEL_805), { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
    if (url.pathname.startsWith("/panel/api/")) return panelAPI(env, req, url, url.searchParams.get("quien"));
    if (url.pathname === "/panel/reporte.pdf") return descargarReporte(env, url);
    if (url.pathname === "/panel/accion" || url.pathname === "/panel/enviar") {
      return panelAccion(env, url, req);
    }
    if (url.pathname === "/panel/viejo") return new Response(conApp(PANEL_APP), { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
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
