// Reglas sin IA para no clasificar de más (funcionan aunque la IA no tenga cupo).
//  - perfilEstricto: A y B solo con PRUEBA en las palabras del propio cliente. Sin prueba, baja a C.
//    A = vende online (Mercado Libre, tienda online, Instagram...). B = tiene local, negocio, empresa, marca (o pide factura A / CUIT).
//    Comprar mucha cantidad NO alcanza para ser A o B: eso ya se mide con presup_usd.
//  - pareceProveedor: la charla está "al revés": nosotros preguntamos precio/stock/talles y ellos contestan como vendedores.
//    Es conservadora a propósito: con datos reales del 13/11 solo marcó a Michael Shop.

export const RE_PERFIL_A = /mercado ?libre|(?<![\d.,]\s?)\bml\b|\bmeli\b|\bfull\b de ml|tienda ?(online|nube|virtual)|tiendanube|vend\w* (por |en )?(internet|instagram|online|la web|redes|mi web|mi p[aá]gina)|e-?commerce|shopify|dropshipping|marketplace|publicaciones? en ml/i;
export const RE_PERFIL_B = /\b(mi|mis|nuestro|nuestra|nuestros) (local|negocio|comercio|empresa|marca|f[aá]brica|taller|kiosco|ferreter[ií]a|farmacia|[oó]ptica|peluquer[ií]a|barber[ií]a|gimnasio|gym|restaurante|resto|bar|caf[eé]|cafeter[ií]a|distribuidora|pyme|consultorio|panader[ií]a|boutique|showroom|sucursal|librer[ií]a|jugueter[ií]a|zapater[ií]a|veterinaria|inmobiliaria|agencia|club|escuela|hotel)\b|factura ?a\b|\bcuit\b|somos una (empresa|marca|f[aá]brica|distribuidora|pyme)|tengo (un|una) (local|negocio|comercio|empresa|tienda|marca)|para (el|mi|nuestro|los) (local|negocio|comercio|empresa|taller|clientes del local)|servicio t[eé]cnico|insumos? para (mi|el|nuestro|la)/i;
// En el nombre del contacto también cuenta como prueba de negocio (ej. "Conect Cell - Servicio Tecnico")
const RE_NOMBRE_NEGOCIO = /servicio t[eé]cnico|\b(s\.?r\.?l|s\.?a\.?s?|ltda|distribuidora|ferreter[ií]a|farmacia|[oó]ptica|peluquer[ií]a|barber[ií]a|librer[ií]a|kiosco|store|shop|tienda|comercial|importadora|mayorista|f[aá]brica)\b/i;

// perfil: lo que dijo la IA ("A".."E" o null). textoCliente: todos los mensajes del CLIENTE juntos.
export function perfilEstricto(perfil, textoCliente, nombre = "") {
  const p = String(perfil || "").toUpperCase();
  if (p !== "A" && p !== "B") return perfil || null;
  const t = String(textoCliente || "");
  const a = RE_PERFIL_A.test(t), b = RE_PERFIL_B.test(t) || RE_NOMBRE_NEGOCIO.test(String(nombre || ""));
  if (p === "A") return a ? "A" : b ? "B" : "C";
  return b ? "B" : a ? "A" : "C";
}

// Lo que dice el que COMPRA (nosotros, cuando le compramos a un proveedor)
const RE_NOS_COMPRAMOS = /te consulto (por|si|el|la|los|las)|ten[eé]s stock|te qued(a|aron|o) (en )?stock|a qu[eé] precio|cu[aá]nto (sale|me sale|me cobr\w*|est[aá]n?)\b|pas(a|á)me (la |el )?(gu[ií]a|lista|precio|cat[aá]logo)|quisiera \d|podr[aá]s conseguir|me pod[eé]s conseguir|te (transfer[ií]|pagu[eé]|deposit[eé])|ah[ií] te (pagu[eé]|transfer[ií]|mand[eé] el comprobante)|ten[eé]s la gu[ií]a|por curva|sin que sea x? ?curva|de remitente/i;
// Lo que dice el que VENDE (el proveedor)
const RE_ELLOS_VENDEN = /qu[eé] talles?\b|colores\?|surtido|tengo stock|s[ií],? tengo|solo curva|por curva|lo enviamos|lo despach|te despacho|n[uú]mero de gu[ií]a|ac[aá] te dejo (la gu[ií]a|el seguimiento)|remitente|lista de precios|precio mayorista es|no tenemos en|tenemos stock|te confirmo si (logro|tengo)/i;
// Lo que dice un cliente nuestro
const RE_CLIENTE_PIDE = /cu[aá]nto (sale|cuesta|me sale)|precio|cotiz|quiero (importar|traer)|me interesa|m[ií]nimo/i;

// ms: [{yo, texto}] (los últimos mensajes del chat)
export function pareceProveedor(ms) {
  let nos = 0, ven = 0, cli = 0;
  for (const m of ms || []) {
    const t = String(m.texto || "");
    if (m.yo) { if (RE_NOS_COMPRAMOS.test(t)) nos++; }
    else { if (RE_ELLOS_VENDEN.test(t)) ven++; if (RE_CLIENTE_PIDE.test(t)) cli++; }
  }
  return nos >= 3 && ven >= 2 && cli < nos;
}

// ---------------------------------------------------------------------------
// Poda de ideas de los agentes (sin IA): saca las repetidas y las genéricas, y deja a la vista solo las mejores.
const RE_GENERICA = /\b(crear|armar|implementar|desarrollar|realizar|hacer) (un|una) (sistema|programa|plan|estrategia|an[aá]lisis|cat[aá]logo|base de datos|proceso|embudo)\b|programa de fidelidad|an[aá]lisis de (la )?competencia|mejorar (la|el|los|las) |optimizar|ofrecer descuentos o promociones|potenciar|fortalecer|aumentar la presencia/i;
const RE_CONCRETA = /\d|@\w|\+\d{6,}|reel|historia|cupo|grupo|tiktok|video|carrusel/i;
const palabras = (t) => new Set(String(t || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 3));
export function parecidas(a, b) {
  const A = palabras(a), B = palabras(b); if (!A.size || !B.size) return false;
  let c = 0; for (const w of A) if (B.has(w)) c++;
  return c / Math.min(A.size, B.size) >= 0.6;
}
// Puntaje de una idea: concreta (números, producto, canal, cliente) suma; genérica resta.
export function puntajeIdea(t, productos = []) {
  const s = String(t || ""); let p = 0;
  if (RE_GENERICA.test(s)) p -= 4;
  if (RE_CONCRETA.test(s)) p += 2;
  if (/\d/.test(s)) p += 1;
  const l = s.toLowerCase(); if (productos.some((x) => x && x.length > 3 && l.includes(String(x).toLowerCase()))) p += 2;
  if (s.length < 70) p -= 1;
  return p;
}
// ideas: [{id, texto, agente, ts}] (las que están 'nueva'). Devuelve { quedan:[ids], podadas:[{id, motivo}] }
export function podarIdeas(ideas, { maximo = 6, porAgente = 2, productos = [], diasMax = 7, ahora = Date.now() } = {}) {
  const podadas = [], cand = [], quedan = [], vivas = [], cuenta = {};
  const temas = (t) => { const l = String(t || "").toLowerCase(); return productos.filter((x) => x && x.length > 3 && l.includes(String(x).toLowerCase())).map((x) => String(x).toLowerCase()); };
  for (const i of ideas) {
    if (ahora - (i.ts || 0) > diasMax * 86400e3) podadas.push({ id: i.id, motivo: "vieja: más de " + diasMax + " días sin usarse" });
    else if (puntajeIdea(i.texto, productos) < 0) podadas.push({ id: i.id, motivo: "genérica: no dice qué producto, cliente, número o canal" });
    else cand.push(i);
  }
  // Primero las más concretas (y a igual puntaje, las más nuevas): esas son las que quedan cuando hay repetidas
  cand.sort((a, b) => puntajeIdea(b.texto, productos) - puntajeIdea(a.texto, productos) || b.ts - a.ts);
  for (const i of cand) {
    const tm = temas(i.texto);
    if (vivas.some((v) => parecidas(v.texto, i.texto) || (tm.length && temas(v.texto).some((x) => tm.includes(x))))) { podadas.push({ id: i.id, motivo: "repetida: ya hay otra idea del mismo producto o casi igual" }); continue; }
    if (quedan.length >= maximo || (cuenta[i.agente] || 0) >= porAgente) { podadas.push({ id: i.id, motivo: "menos concreta que las que quedaron" }); continue; }
    vivas.push(i); cuenta[i.agente] = (cuenta[i.agente] || 0) + 1; quedan.push(i.id);
  }
  return { quedan, podadas };
}
