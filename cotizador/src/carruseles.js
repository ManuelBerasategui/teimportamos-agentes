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

export const ESTILOS = {
  manuscrito: { nombre: "Manuscrito crema (el de siempre)", fondo: "#F3EFE8", tinta: "#3B4796", acento: "#3B4796", fuente: "mano" },
  marca: { nombre: "Marca: negro y naranja", fondo: "#0B0B0B", tinta: "#FFFFFF", acento: "#EA5B0C", fuente: "sans" },
  naranja: { nombre: "Naranja fuerte", fondo: "#EA5B0C", tinta: "#FFFFFF", acento: "#0B0B0B", fuente: "sans" },
  editorial: { nombre: "Editorial blanco y negro", fondo: "#FFFFFF", tinta: "#111111", acento: "#EA5B0C", fuente: "serif" },
  nota: { nombre: "Nota amarilla", fondo: "#FFF3B0", tinta: "#1F2937", acento: "#DC2626", fuente: "mano" },
  // Estilos "de tendencia" (letra gruesa, alineado a la izquierda, palabras clave resaltadas con *asteriscos*)
  impacto: { nombre: "Impacto: letra gigante amarilla sobre foto", fondo: "#121212", tinta: "#FFD400", acento: "#FFFFFF", fuente: "display", al: "l", fotoFondo: true },
  resaltado: { nombre: "Resaltado: blanco con palabras naranjas subrayadas", fondo: "#151515", tinta: "#FFFFFF", acento: "#FF6A1A", fuente: "display2", al: "l", minus: true, subrayar: true, fotoFondo: true },
  dividido: { nombre: "Dividido rojo y negro (A vs B)", fondo: "#E8231E", fondo2: "#141414", tinta: "#141414", tinta2: "#E8231E", acento: "#FFFFFF", fuente: "display2", minus: true, grano: true },
  grano: { nombre: "Negro texturado con título rojo", fondo: "#161616", tinta: "#F2F2F2", acento: "#E8231E", fuente: "display2", al: "l", minus: true, grano: true, tituloAcento: true },
  bloque: { nombre: "Marca bold: negro, blanco y naranja", fondo: "#0B0B0B", tinta: "#FFFFFF", acento: "#EA5B0C", fuente: "display", al: "l", grano: true },
  creador: { nombre: "Creador: tu foto de fondo, mayúsculas y etiquetas naranjas", fondo: "#111111", tinta: "#FFFFFF", acento: "#EA5B0C", fuente: "display2", mayus: true, fotoFondo: true, abajo: true, etiquetas: true },
  noticia: { nombre: "Noticia: foto con titular abajo y slides de texto sobrio", fondo: "#050505", tinta: "#F5F5F5", acento: "#FFD400", fuente: "noticia", fotoFondo: true, fotoSoloPortada: true, portadaMayus: true, grano: true },
  viral: { nombre: "Viral: foto, etiqueta VIRAL y titular en mayúsculas", fondo: "#050505", tinta: "#FFFFFF", acento: "#2F6BFF", fuente: "display", mayus: true, fotoFondo: true, abajo: true, etiqueta: "VIRAL", marcaArriba: true },
  producto: { nombre: "Producto: foto al centro y precio gigante", fondo: "#141414", fondo3: "#3A1A08", tinta: "#FFFFFF", acento: "#EA5B0C", fuente: "display2", mayus: true, etiquetas: true },
};
const ESTILOS_NUEVOS = ["impacto", "resaltado", "dividido", "grano", "bloque", "creador", "producto", "noticia", "viral"];
const direccion = async (env) => (await kvGet(env, "ig_direccion_carrusel")) || "";
const memoriaCarr = async (env) => (await kvGet(env, "ig_memoria_carrusel")) || "";
const guardarMemoriaCarr = (env, texto) => kvPut(env, "ig_memoria_carrusel", String(texto || "").trim().slice(0, 1500));
const textoDireccion = (d) => (d ? `DIRECCIÓN CREATIVA DEL DUEÑO (manda sobre todo lo demás): ${d}` : "");
const textoMemoria = (m) => (m ? `MEMORIA EDITORIAL (preferencias creativas del dueño; no reemplaza las reglas del negocio):\n${m}` : "");
const ANGULOS_CARR = new Set(["mito", "error", "caso_real", "paso_a_paso", "que_pasa_si", "detras_de_escena", "lista_productos", "opinion", "pregunta_respuesta", "comparacion_ml", "ensayo", "vs", "relato", "otro"]);
const normalizarIdea = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const FORMATOS = `FORMATOS POSIBLES (usá variedad real, no te quedes en precios):
- mito: "Mito: ..." → por qué es falso → cómo es en realidad
- error: errores típicos al importar, cada uno con su consecuencia concreta
- caso_real: un pedido real sin nombres (qué pidió, qué pasó, qué incluyó el precio)
- paso_a_paso: cómo se hace una cosa en N pasos
- que_pasa_si: "¿Qué pasa si ...?" y la respuesta honesta
- detras_de_escena: lo que no se ve de una importación
- lista_productos: N productos que la gente pide mucho y por qué. En el rubro lo que más se viraliza es la portada con número + promesa concreta: "5 productos que se venden solos y casi nadie trae de China", "3 páginas para comprar en China que no son Alibaba", "te ahorro el viaje a China: así encontrás proveedor"
- opinion: una postura fuerte que genere debate
- pregunta_respuesta: la pregunta que más nos hacen, contestada
- comparacion_ml: precio en MercadoLibre vs puesto en Argentina (solo uno de varios formatos)
- ensayo: una idea fuerte contada como hilo, frase por frase, tipo "por qué casi nadie le compra directo a China (y vos sí podés)": portada con pregunta polémica, slides de "frase grande" que avanzan la historia, giro, cierre. Funciona mucho con letra gigante.
- relato: una historia contada como noticia o confesión, con titular que intriga ("Lo que me dijo un despachante de aduana me ofendió, pero me ahorró USD 2.000..."), slides de texto corrido numerados (1., 2., 3.), un slide de "si llegaste hasta acá..." y cierre. Se usa con el estilo "noticia".
- vs: dos caminos enfrentados ("comprar en ML para revender vs traer de China", "revendedor que gana vs el que no"): portada A vs B, después una slide por lado con sus puntos, conclusión.
- otro: lo que se te ocurra a partir de las referencias`;
// ---------- Manual de viralidad (lo aprendido del carrusel ganador y de lo que no funcionó) ----------
const MANUAL = `CÓMO ESCRIBIMOS (obligatorio):
- Español de Argentina con voseo: "mirá", "fijate", "traelo", "pagás", "querés". JAMÁS: "descubre", "debes", "puedes", "tienes", "evita", "aprende", "conoce", "vosotros".
- Prohibido el tono de folleto o curso: nada de "secretos", "la verdad que nadie te cuenta", "errores costosos", "sin riesgos", "el proceso", "guía definitiva", "¡increíble!". Si suena a publicidad, está mal.
- Cada slide dice UNA cosa, corta (título de 3 a 8 palabras). Nada de párrafos explicativos.
- Concreto siempre, pero no todo contenido necesita producto, precio o cantidad. No inventes datos; usá un ejemplo sólo si el ángulo lo pide.
- Cada slide deja algo abierto para el siguiente ("Y se vende. Mucho." → "Traído de China, puesto en Argentina:" → el número).
- Ritmo: gancho que genera tensión → cada slide abre curiosidad para el siguiente → un giro o dato que sorprende → cierre claro. El orden depende del formato; no uses siempre el mismo.
- Honestidad que da confianza: mencionar comisiones, que hay mínimos, que el precio es del día. Nunca prometer ganancias.
- El cierre pide comentar UNA palabra en mayúsculas relacionada al tema (COSTO, LISTA, CUPO, PRECIO).
- Resaltá con *asteriscos* de 1 a 4 palabras clave por slide (ej: "la gente *perdió la paciencia* para ver contenido largo"). Se pintan con el color de acento: usalo en lo que sorprende o duele, no en palabras de relleno. No resaltes en el caption.`;
const MAL = /\b(descubr\w*|debes|deber[aá]s|puedes|tienes|evita\w*|aprende\w*|conoce\w*|vosotros|os\s|secreto\w*|esconde\w*|sin riesgos?|errores costosos|gu[ií]a definitiva|incre[ií]ble|nadie te cuenta)\b/i;
export function problemasTexto(slides, caption = "") {
  const out = [];
  slides.forEach((x, i) => {
    const t = Object.values(x).filter((v) => typeof v === "string" || Array.isArray(v)).flat().join(" ");
    const m = t.match(MAL); if (m) out.push(`slide ${i + 1}: "${m[0]}" (prohibido: suena genérico o a España)`);
    if (x.titulo && x.titulo.split(/\s+/).length > 12) out.push(`slide ${i + 1}: título muy largo (${x.titulo.split(/\s+/).length} palabras)`);
  });
  const mc = String(caption).match(MAL); if (mc) out.push(`texto del posteo: "${mc[0]}"`);
  return out;
}
const descartes = async (env) => JSON.parse((await kvGet(env, "ig_descartes_carrusel")) || "[]");
const textoDescartes = (l) => l.length ? l.slice(-25).map((d) => `- "${d.titulo}"${d.gancho ? ` (portada: "${d.gancho}")` : ""}${d.motivo ? ` → POR QUÉ NO: ${d.motivo}` : " → sin motivo"}`).join("\n") : "ninguna";
const referencias = async (env) => JSON.parse((await kvGet(env, "ig_refs_carrusel")) || "[]");
const textoRefs = (refs) => refs.length ? refs.slice(-12).map((r) => `id ${r.id || ""} · ${r.cuenta ? "@" + r.cuenta + " · " : ""}formato: ${r.formato || "-"} · gancho: "${r.gancho}" · estructura: ${(r.estructura || []).join(" → ")} · por qué funciona: ${r.por_que} · técnicas: ${(r.tecnicas || []).join(", ")} · visual: ${r.estilo_visual || "-"} · cómo adaptarlo: ${r.adaptacion || "-"}`).join("\n") : "todavía no hay";

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
  cta: { nombre: "Cierre (llamado a la acción)", campos: ["texto", "palabra", "abajo"] },
  grande: { nombre: "Frase grande", campos: ["texto", "abajo"] },
  versus: { nombre: "Uno contra otro", campos: ["titulo", "a_label", "a_texto", "b_label", "b_texto"] },
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
    estilo: ESTILOS[d.estilo] ? d.estilo : previo.estilo || "manuscrito",
    precio_ml: d.precio_ml !== undefined ? num(d.precio_ml) : previo.precio_ml ?? null,
    costo: d.costo !== undefined ? num(d.costo) : previo.costo ?? null,
    cantidad: d.cantidad !== undefined ? num(d.cantidad) : previo.cantidad ?? null,
    fotos: { ...(previo.fotos || {}), ...(d.fotos || {}) },
    foto_solo_portada: d.foto_solo_portada !== undefined ? !!d.foto_solo_portada : !!previo.foto_solo_portada,
    fx: limpiarFx({ ...(previo.fx || {}), ...(d.fx || {}) }),
    dis: limpiarDis({ ...(previo.dis || {}), ...(d.dis || {}) }),
    colores: (() => { const o = {}, src = d.colores === null ? {} : { ...(previo.colores || {}), ...(d.colores || {}) }; for (const k of ["fondo", "tinta", "acento"]) if (/^#[0-9a-f]{6}$/i.test(String(src[k] || ""))) o[k] = String(src[k]).toUpperCase(); return o; })(),
  };
}
// Retoques de las fotos de cada slide (los aplica el dibujo del panel, así se ven en el preview y en lo publicado)
export const FX = { rot: [-20, 20, "grados de rotación (negativo = a la izquierda)"], escala: [0.5, 1.4, "tamaño (1 = normal)"], dx: [-300, 300, "mover a la derecha (+) o izquierda (-), px"], dy: [-300, 300, "mover abajo (+) o arriba (-), px"], sombra: [0, 3, "sombra que sigue la forma del producto: 0 nada, 1 suave, 2 media, 3 fuerte"], piso: [0, 3, "sombra difusa en el piso, debajo del producto: 0 a 3"], brillo: [60, 150, "brillo en % (100 normal)"], contraste: [60, 150, "contraste en % (100 normal)"], saturacion: [0, 180, "saturación en % (100 normal, 0 blanco y negro)"], redondeo: [0, 80, "esquinas redondeadas en px"] };
// Ajustes de diseño por slide (los aplica el dibujo del panel)
export const DIS = { texto: [0.5, 1.5, "tamaño de TODOS los textos del slide (1 = normal)"], dy: [-500, 500, "mover todo el contenido abajo (+) o arriba (-), px (el slide mide 1350 de alto)"], usuario_escala: [0.4, 1.5, "tamaño del @usuario con la foto de perfil (1 = normal)"], usuario_dy: [-600, 600, "mover SOLO el @usuario abajo (+) o arriba (-), px"], usuario: [0, 1, "mostrar el @usuario (1) o esconderlo (0)"], icono_escala: [0.4, 2.5, "tamaño del ícono (1 = normal)"], icono_dx: [-500, 500, "correr el ícono a la derecha (+) o a la izquierda (-), px (el slide mide 1080 de ancho)"], icono_dy: [-500, 500, "correr el ícono abajo (+) o arriba (-), px"], icono_grosor: [3, 22, "grosor del trazo del ícono (9 = normal)"] };
export const ICONOS = ["flecha_der", "flecha_izq", "flecha_abajo", "flecha_arriba", "check", "cruz", "alerta", "dolar", "caja", "avion", "camion", "barco", "celular", "whatsapp", "carrito", "candado", "estrella", "fuego", "reloj", "mano"];
export const POS_ICONO = ["debajo", "abajo_der", "abajo_izq", "abajo_centro", "arriba_der", "arriba_izq", "centro", "derecha", "izquierda"];
export function limpiarDis(dis) {
  const out = {};
  for (const [i, v] of Object.entries(dis || {})) {
    if (!/^\d+$/.test(i) || !v || typeof v !== "object") continue;
    const o = {};
    if (v.al === "c" || v.al === "l") o.al = v.al;
    if (ICONOS.includes(v.icono)) o.icono = v.icono; else if (v.icono === "") o.icono = "";
    if (POS_ICONO.includes(v.icono_pos)) o.icono_pos = v.icono_pos;
    if (/^#[0-9a-f]{6}$/i.test(String(v.icono_color || ""))) o.icono_color = String(v.icono_color).toUpperCase();
    for (const [k, [mn, mx]] of Object.entries(DIS)) if (v[k] !== undefined && v[k] !== null && Number.isFinite(+v[k])) o[k] = Math.min(mx, Math.max(mn, +v[k]));
    if (Object.keys(o).length) out[i] = o;
  }
  return out;
}
export function limpiarFx(fx) {
  const out = {};
  for (const [i, v] of Object.entries(fx || {})) {
    if (!/^\d+$/.test(i) || !v || typeof v !== "object") continue;
    const o = {};
    for (const [k, [mn, mx]] of Object.entries(FX)) if (v[k] !== undefined && v[k] !== null && Number.isFinite(+v[k])) o[k] = Math.min(mx, Math.max(mn, +v[k]));
    if (Object.keys(o).length) out[i] = o;
  }
  return out;
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
UN FORMATO PROBADO (uno entre varios, falta testear otros): comparación de precio con MercadoLibre. Compará el rendimiento por ángulo y proponé repetir lo que anduvo y probar variantes.`;
}

// ---------- Ideas ----------
export async function generarIdeasCarrusel(env, iaJSON, { T, quien = "panel", cantidad = 5, ref = null, iaImg = null } = {}) {
  await prepararCarr(env);
  const w = await datosWhatsApp(env, T);
  const previas = (await env.DB.prepare("SELECT titulo, producto, angulo, estado FROM ig_carruseles WHERE estado <> 'descartado' AND ts > ? ORDER BY ts DESC LIMIT 40").bind(Date.now() - 45 * 86400e3).all()).results || [];
  const rg = await reglas(env);
  const refs = await referencias(env);
  const foco = ref != null && refs[ref] ? refs[ref] : null;
  const memoria = await memoriaCarr(env);
  const refsVideo = ((await env.DB.prepare("SELECT que_pasa FROM ig_refs WHERE que_pasa<>'' ORDER BY ts DESC LIMIT 12").all().catch(() => ({ results: [] }))).results || []).map((x) => x.que_pasa);
  const imgsRef = foco ? await imagenesDeReferencia(env, [foco], 3) : [];
  const promptImagenes = imgsRef.length && iaImg ? "\nLas capturas de referencia adjuntas sirven para inspirar ritmo y jerarquía visual; no copies textos, marca ni diseño." : "";
  const pIdeas = `Sos quien arma los CARRUSELES de Instagram de este negocio:
${NEGOCIO}
${MANUAL}
${FORMATOS}
${textoDireccion(await direccion(env))}
${textoMemoria(memoria)}
Referencias visuales y estructurales (adaptá mecánicas, no copies contenido): ${textoRefs(refs)}
${foco ? `Esta tanda toma como base la referencia elegida: ${JSON.stringify(foco)}${promptImagenes}` : ""}
Ideas descartadas (no repitas tema ni errores): ${textoDescartes(await descartes(env))}
MECÁNICAS QUE ESTÁN FUNCIONANDO EN VIDEOS (de nuestro nicho y de otros; trasladá la mecánica al formato carrusel): ${refsVideo.join(" | ") || "-"}
Generá ${cantidad} ideas distintas de carrusel como experimentos variados para viralizar.
CRITERIO (lo más importante): cada idea tiene una TENSIÓN concreta en la portada (una situación, un número que duele, un miedo real, una contradicción, algo que le pasó a alguien), nunca un tema suelto. PROHIBIDO títulos o portadas genéricas como "La verdad sobre...", "Error común al...", "Caso real de éxito", "¿Qué pasa si...?" sin la situación concreta, "La guerra de precios". El título interno describe la situación ("El cliente que pidió 1000 tarjetas y le llegaron 900"). Que se guarde (sirve como guía o checklist que vuelve a mirar) o se comparta (le pasa al amigo que vende en ML). Cada una usa un formato distinto. Buscá mitos, errores, decisiones, operaciones, opinión, comunidad, casos sin datos inventados y preguntas; no fuerces producto ni precio. Máximo una comparación de precios. Cada idea tiene hipótesis sobre guardados, compartidos o comentarios.
${await rendimiento(env)}
Público principal: gente que vende o quiere vender en Mercado Libre y revendedores. Hablales como colega que los entiende (las comisiones, el envío, la competencia), no como alguien que los critica. En cada tanda incluí al menos una idea "ensayo" (hilo con una idea fuerte) y una "vs" (dos caminos enfrentados).
LO QUE PASA EN WHATSAPP: cotizaciones ${w.cotizaciones.map((c) => c.items.map((i) => `${i.cantidad} × ${i.nombre}`).join(" + ")).join(" | ") || "ninguna"}; productos por chat ${w.cotizados.map((x) => `${x.producto} (${x.n})`).join(", ") || "sin datos"}; más consultado (14 días) ${w.demanda14.map((x) => `${x.producto} (${x.n})`).join(", ") || "sin datos"}.
Reglas del dueño: ${rg.join("; ") || "ninguna"}.
Ideas recientes (evitá repetir producto o ángulo): ${previas.map((x) => `${x.titulo} [${x.estado}]`).join(" | ") || "ninguna"}.
Gancho exacto de portada, voseo y concreto; no inventes hechos ni precios.
Respondé SOLO JSON: {"ideas":[{"titulo":"nombre corto","gancho":"texto exacto de la portada","producto":"... o vacío","angulo":"mito|error|caso_real|paso_a_paso|que_pasa_si|detras_de_escena|lista_productos|opinion|pregunta_respuesta|comparacion_ml|ensayo|vs|relato|otro","pilar":"educacion|operaciones|caso|decision|comunidad|opinion|producto|detras_de_escena","hipotesis":"qué testeamos","inspirado_en":"id de referencia o vacío","por_que":"razón concreta"}]}`;
  const r = foco && imgsRef.length && iaImg ? await iaImg(env, pIdeas, imgsRef) : await iaJSON(env, pIdeas);
  const ya = new Set(previas.map((x) => normalizarIdea(x.titulo)));
  const tandas = new Set(), tandasAngulos = new Set();
  const candidatas = (r?.ideas || []).filter((x) => {
    const titulo = normalizarIdea(x?.titulo), gancho = normalizarIdea(x?.gancho);
    const angulo = ANGULOS_CARR.has(x?.angulo) ? x.angulo : "otro";
    if (!titulo || !gancho || PROHIBIDO.test(JSON.stringify(x)) || MAL.test(String(x.gancho || x.titulo)) || ya.has(titulo) || tandas.has(titulo) || tandas.has(gancho)) return false;
    if (tandasAngulos.has(angulo)) return false;
    tandas.add(titulo); tandas.add(gancho); tandasAngulos.add(angulo); ya.add(titulo); return true;
  });
  const ideas = candidatas.slice(0, cantidad);
  if (!ideas.length) return { ok: false, error: r ? "No salieron ideas nuevas." : "La IA no respondió. Probá de nuevo en un minuto." };
  await env.DB.batch(ideas.map((x) => env.DB.prepare("INSERT INTO ig_carruseles (id, ts, estado, titulo, angulo, por_que, producto, datos, slides, caption, chat) VALUES (?,?,'idea',?,?,?,?,?,'[]','','[]')")
    .bind(nuevoId(), Date.now(), String(x.titulo).slice(0, 140), String(ANGULOS_CARR.has(x.angulo) ? x.angulo : "otro").slice(0, 30),
      (x.gancho ? "Portada: \"" + String(x.gancho).slice(0, 140) + "\" · " : "") + (x.pilar ? "Pilar: " + String(x.pilar).slice(0, 40) + " · " : "") + (x.hipotesis ? "Testea: " + String(x.hipotesis).slice(0, 160) + " · " : "") + (x.inspirado_en ? "Referencia: " + String(x.inspirado_en).slice(0, 40) + " · " : "") + String(x.por_que || "").slice(0, 240),
      String(x.producto || "").slice(0, 80), JSON.stringify({ producto: String(x.producto || "").slice(0, 80) }))));
  return { ok: true, cantidad: ideas.length };
}

// ---------- Estructura ----------
const AYUDA_TIPOS = Object.entries(TIPOS_SLIDE).map(([k, v]) => `"${k}" (${v.nombre}: ${v.campos.join(", ")}${v.foto ? ", lleva foto" : ""})`).join("; ");
export async function armarEstructura(env, iaJSON, c, T, iaImg = null) {
  const w = await datosWhatsApp(env, T);
  const rg = await reglas(env), refs = await referencias(env);
  const memoria = await memoriaCarr(env);
  const refBase = c.por_que?.match(/referencia\s+(?:id\s*)?([a-z0-9]+)/i)?.[1];
  const ref = refs.find((x) => x.id === refBase) || refs.find((x) => normalizarIdea(c.por_que).includes(normalizarIdea(x.gancho)));
  const imgsRef = ref ? await imagenesDeReferencia(env, [ref], 3) : [];
  const conImagen = Boolean(iaImg && imgsRef.length);
  // Si la IA con imágenes falla, se reintenta solo con texto (las capturas de referencia son un extra, no un requisito)
  const pedirIA = async (p) => (conImagen ? (await iaImg(env, p, imgsRef).catch(() => null)) : null) || (await iaJSON(env, p));
  const base = `Negocio:
${NEGOCIO}
${MANUAL}
${FORMATOS}
${textoDireccion(await direccion(env))}
${textoMemoria(memoria)}
IDEA: "${c.titulo}" · producto: ${c.producto || "-"} · formato/ángulo: ${c.angulo} · ${c.por_que}
Tipos de slide disponibles: ${AYUDA_TIPOS}.
Si el carrusel necesita precios o cuentas, usá SOLO estas marcas: {precio_ml} {costo} {diferencia} {cantidad} {total} {producto}. NUNCA escribas un precio con números. Si el formato no necesita números (mito, error, opinión...), no uses las marcas.
EJEMPLO DE PRECIOS (usalo solo si el ángulo es comparacion_ml; para otros formatos no pongas precios ni imites su secuencia):
${c.angulo === "comparacion_ml" ? JSON.stringify(EJEMPLO) : "No aplica a esta idea."}
VIRALES DE REFERENCIA (si hay una relacionada con esta idea, tomá su ritmo/función por slide y rasgos visuales, sin copiar textos, marca ni diseño):
${ref ? JSON.stringify(ref) : textoRefs(refs)}${conImagen ? "\nTambién se adjuntan sus capturas como referencia visual." : ""}
REGLAS QUE TE ENSEÑÓ EL DUEÑO (respetalas siempre): ${rg.map((x, i) => `${i + 1}. ${x}`).join(" ") || "ninguna"}
LO QUE EL DUEÑO DESCARTÓ Y POR QUÉ (no repitas esos errores): ${textoDescartes(await descartes(env))}
Cotizaciones reales recientes: ${w.cotizaciones.map((q) => q.items.map((i) => i.nombre).join(" + ")).join(" | ") || "ninguna"}.`;  // 1) tres versiones distintas
  const r1 = await pedirIA(`${base}
Escribí 3 VERSIONES distintas del carrusel completo (6 a 10 slides según el formato; la última "cta"). Que cambien el gancho de la portada, la estructura y el orden de la tensión, no solo las palabras.
Para portadas de tendencia sirve mucho: pregunta con paréntesis que provoca ("por qué esta letra gigante funciona tanto (y tu diseño bonito no)"), contraste A vs B, o un número que duele. Portada de 5 a 12 palabras.
Respondé SOLO JSON: {"versiones":[{"slides":[...],"caption":"2 o 3 frases + comentá la PALABRA + 3 hashtags"}]}`);
  let rb_dbg = null;
  let versiones = (r1?.versiones || (Array.isArray(r1?.slides) ? [r1] : [])).map((v) => ({ slides: limpiarSlides(v.slides), caption: String(v.caption || "") })).filter((v) => v.slides.length >= 3 && !PROHIBIDO.test(JSON.stringify(v)));
  if (!versiones.length) {
    // Plan B: pedir UNA sola versión (respuesta más corta, la IA se corta menos)
    const rb = await iaJSON(env, `${base}
Escribí el carrusel completo (6 a 9 slides; el último de tipo "cta"). Cada slide con su "tipo" y los campos de ese tipo.
Respondé SOLO JSON: {"slides":[{"tipo":"portada","titulo":"...","subtitulo":"..."}],"caption":"2 o 3 frases + comentá la PALABRA + 3 hashtags"}`);
    rb_dbg = rb ? { k: Object.keys(rb), s: (rb.slides || []).slice(0, 2) } : null;
    versiones = [{ slides: limpiarSlides(rb?.slides), caption: String(rb?.caption || "") }].filter((v) => v.slides.length >= 3 && !PROHIBIDO.test(JSON.stringify(v)));
  }
  if (!versiones.length) return { ok: false, error: "La IA no armó una estructura válida (puede ser el límite de uso de la IA). Esperá un minuto y probá de nuevo.", debug: JSON.stringify({ r1: r1 ? Object.keys(r1) : null, v0: r1?.versiones?.[0]?.slides?.slice?.(0, 2) || r1?.slides?.slice?.(0, 2) || null, rb: typeof rb_dbg !== "undefined" ? rb_dbg : null }).slice(0, 1500) };
  // 2) editor exigente: elige y mejora
  const r2 = await pedirIA(`${base}
Sos el EDITOR más exigente de contenido viral de Argentina. Estas son 3 versiones:
${versiones.map((v, i) => `VERSIÓN ${i + 1}: ${JSON.stringify(v)}`).join("\n")}
Puntuá cada una de 1 a 10 en: gancho (¿frena el scroll en 2 segundos?), curiosidad (¿cada slide obliga a pasar?), concreción (producto y números reales), voz (voseo, cero folleto). Elegí la mejor y MEJORALA: reescribí cada slide que no sea un 9. Compará contra las referencias virales: tiene que ser igual o mejor.
Elegí también el ESTILO VISUAL que mejor le queda (clave): ${Object.entries(ESTILOS).map(([k, v]) => `${k} = ${v.nombre}`).join("; ")}. Preferí los de tendencia (${ESTILOS_NUEVOS.join(", ")}): "dividido" para formatos vs, "impacto" o "resaltado" para ensayo/opinión/mito, "grano" para listas y pasos, "bloque" para casos y números, "creador" para explicaciones paso a paso o requisitos (lleva la foto del dueño de fondo), "producto" para comparaciones de precio de UN producto, "viral" para casos llamativos contados como noticia de portal ("se trajo 500 termos de China y en ML los vende al triple"), "noticia" para relatos e historias contadas como titular ("el consejo de un despachante que me ofendió, pero me salvó la importación..."); "manuscrito" solo si el contenido es una cuenta con precios.
Respondé SOLO JSON: {"puntajes":[{"version":1,"gancho":0,"curiosidad":0,"concrecion":0,"voz":0}],"elegida":1,"estilo":"clave","slides":[...],"caption":"..."}`);
  let slides = limpiarSlides(r2?.slides), caption = String(r2?.caption || "");
  if (slides.length < 3 || PROHIBIDO.test(JSON.stringify(slides) + caption)) { slides = versiones[0].slides; caption = versiones[0].caption; }
  // 3) control final: si quedó algo genérico o de España, una reescritura más
  let prob = problemasTexto(slides, caption);
  if (prob.length) {
    const r3 = await iaJSON(env, `${base}
Este carrusel tiene estos problemas: ${prob.join("; ")}. Reescribí SOLO lo necesario para corregirlos, manteniendo el resto.
CARRUSEL: ${JSON.stringify({ slides, caption })}
Respondé SOLO JSON: {"slides":[...],"caption":"..."}`);
    const s3 = limpiarSlides(r3?.slides);
    if (s3.length >= 3 && !PROHIBIDO.test(JSON.stringify(s3))) { slides = s3; caption = String(r3.caption || caption); prob = problemasTexto(slides, caption); }
  }
  const estilo = ESTILOS[r2?.estilo] ? r2.estilo : (c.angulo === "vs" ? "dividido" : c.angulo === "comparacion_ml" ? "manuscrito" : ESTILOS_NUEVOS[Math.floor(Math.random() * ESTILOS_NUEVOS.length)]);
  return { ok: true, slides, caption: caption.replace(/\*/g, "").slice(0, 2200), avisos: prob, estilo };
}

// ---------- Chat dentro del carrusel ----------
// ---------- Colores por nombre y "palabra X en color Y" resuelto en código (sin depender de la IA) ----------
const PALETA = { amarillo: "#FFD400", blanco: "#FFFFFF", negro: "#111111", naranja: "#EA5B0C", rojo: "#E8231E", azul: "#2F6BFF", verde: "#22C55E", gris: "#9CA3AF" };
export function nombreColor(hex) {
  const h = String(hex || "").replace("#", ""); if (h.length !== 6) return "";
  const rgb = (x) => [0, 2, 4].map((i) => parseInt(x.slice(i, i + 2), 16));
  const [r, g, b] = rgb(h); let mejor = "", d = 1e9;
  for (const [n, v] of Object.entries(PALETA)) { const [r2, g2, b2] = rgb(v.slice(1)); const dd = (r - r2) ** 2 + (g - g2) ** 2 + (b - b2) ** 2; if (dd < d) { d = dd; mejor = n; } }
  return mejor;
}
const sinTildes = (t) => String(t).toLowerCase().replace(/[áàä]/g, "a").replace(/[éèë]/g, "e").replace(/[íìï]/g, "i").replace(/[óòö]/g, "o").replace(/[úùü]/g, "u");
// Prende (on=true) o apaga el resaltado *...* de una frase dentro de un texto, sin tocar el resto
export function marcarFrase(texto, frase, on) {
  const chars = []; let est = false;
  for (const ch of String(texto)) { if (ch === "*") { est = !est; continue; } chars.push({ ch, on: est }); }
  const plano = sinTildes(chars.map((x) => x.ch).join("")), f = sinTildes(frase).trim();
  const i = f ? plano.indexOf(f) : -1;
  if (i < 0) return null;
  for (let k = i; k < i + f.length; k++) chars[k].on = on;
  let out = "", prev = false;
  for (const x of chars) { if (x.on !== prev) { out += "*"; prev = x.on; } out += x.ch; }
  if (prev) out += "*";
  return out.replace(/\*(\s+)\*/g, "$1");
}
function colorDirecto(c, mensaje) {
  const m = String(mensaje).match(/^\s*(?:pon[eé]\s+|pint[aá]\s+|hac[eé]\s+)?["“'«]?(.+?)["”'»]?\s+(?:del?\s+(?:slide|diapositiva)\s*\d+\s+)?(?:hacelo\s+|ponelo\s+|que\s+(?:est[eé]|sea|quede)\s+)?(?:en|de)\s+(?:color\s+)?(amarillo|blanco|negro|naranja|rojo|azul|verde|gris)\b/i);
  if (!m) return null;
  const frase = m[1].replace(/\s+del?\s+(?:slide|diapositiva)\s*\d+.*$/i, "").replace(/^(?:el|la|los|las|que)\s+/i, "").trim();
  const color = m[2].toLowerCase(), ns = String(mensaje).match(/(?:slide|diapositiva)\s*(\d+)/i);
  const est = { ...(ESTILOS[c.datos?.estilo || "manuscrito"] || {}), ...(c.datos?.colores || {}) };
  let on = null;
  if (nombreColor(est.tinta) === color) on = false; else if (nombreColor(est.acento) === color) on = true; else return null;
  const slides = JSON.parse(JSON.stringify(c.slides || [])), idx = ns ? [+ns[1] - 1] : slides.map((_, i) => i);
  let hechos = 0;
  for (const i of idx) { const s = slides[i]; if (!s) continue; for (const k of Object.keys(s)) { if (k === "tipo") continue; if (Array.isArray(s[k])) s[k] = s[k].map((v) => { const n = marcarFrase(v, frase, on); if (n !== null) { hechos++; return n; } return v; }); else if (typeof s[k] === "string") { const n = marcarFrase(s[k], frase, on); if (n !== null) { s[k] = n; hechos++; } } } }
  if (!hechos) return null;
  return { ok: true, respuesta: `Listo: "${frase}" quedó en ${color}${ns ? " en el slide " + ns[1] : ""}.`, regla: "", memoria: "", slides };
}
// "que la foto de fondo aparezca solo en el primer slide" / "en todos" → se resuelve en código, sin IA
function fotoFondoDirecto(c, mensaje) {
  const m = String(mensaje).toLowerCase();
  if (!/foto|imagen|fondo/.test(m)) return null;
  let solo = null;
  if (/(solo|solamente|[uú]nicamente|nada m[aá]s)\b.{0,40}(primer|1|portada)|(sac|quit|borr)[aá].{0,30}(foto|fondo).{0,40}(dem[aá]s|resto|otros)|(primer|portada).{0,25}(solo|solamente|[uú]nicamente)/.test(m)) solo = true;
  else if (/(en|a) todos\b|todas? las? (slides|diapositivas)|(volv|pon)[eé].{0,20}(foto|fondo).{0,30}(todos|resto|dem[aá]s)/.test(m)) solo = false;
  if (solo === null) return null;
  const datos = limpiarDatos({ foto_solo_portada: solo }, c.datos);
  return { ok: true, respuesta: solo ? "Listo: la foto de fondo queda solo en la portada; los demás slides van con el fondo liso del estilo. Si querés que vuelva a todos, decime \"poné la foto en todos\"." : "Listo: la foto de fondo vuelve a estar en todos los slides.", regla: "", memoria: "", datos };
}
// "bajá / subí / corré a la izquierda la flecha (el ícono)" → se resuelve en código, sin IA
function iconoDirecto(c, mensaje) {
  const t = sinTildes(mensaje);
  const unIcono = Object.values(c.datos?.dis || {}).filter((v) => v.icono).length === 1;
  if (!/\b(flecha|icono|iconito)\b/.test(t) && !(unIcono && /\b(gruesa|grueso|fina|fino|finita|engros)/.test(t)) && !/\b(hacela|hacelo|ponela|ponelo)\b.*\b(gruesa|grueso|fina|fino|amarill|blanc|naranj|roj|azul|negr|verde)/.test(t)) return null;
  if (/\b(agreg|pon[eé]?\s+un|sum[aá]|cambi[aá]\s+(el|la)\s+(icono|flecha)\s+por|sac[aá])/.test(t)) return null;   // agregar o cambiar ícono: lo hace la IA
  const dis = JSON.parse(JSON.stringify(c.datos?.dis || {})), con = Object.keys(dis).filter((k) => dis[k].icono);
  const ns = t.match(/(?:slide|diapositiva)\s*(\d+)/), i = ns ? String(+ns[1] - 1) : con.length === 1 ? con[0] : null;
  if (i === null || !dis[i]?.icono) return null;
  // grosor y color del ícono
  const col = t.match(/\b(amarill|blanc|negr|naranj|roj|azul|verde|gris)\w*/), grueso = /\b(gruesa|grueso|mas ancha|mas gorda|engros|mas marcad)/.test(t), fino = /\b(fina|fino|mas delgad|finita)\b/.test(t);
  if (col || grueso || fino) {
    const di = dis[i], nom = col ? { amarill: "amarillo", blanc: "blanco", negr: "negro", naranj: "naranja", roj: "rojo", azul: "azul", verde: "verde", gris: "gris" }[col[1]] : "";
    if (nom) di.icono_color = PALETA[nom];
    if (grueso) di.icono_grosor = Math.min(22, (di.icono_grosor || 9) + (/\bun poco|apenas\b/.test(t) ? 3 : 5));
    if (fino) di.icono_grosor = Math.max(3, (di.icono_grosor || 9) - (/\bun poco|apenas\b/.test(t) ? 2 : 4));
    return { ok: true, respuesta: `Listo, el ícono del slide ${+i + 1} quedó${grueso ? " más grueso" : fino ? " más fino" : ""}${nom ? (grueso || fino ? " y" : "") + " en " + nom : ""}. Si no te gusta, decime "volvé para atrás".`, regla: "", memoria: "", datos: limpiarDatos({ dis }, c.datos) };
  }
  if (!/\b(baj|sub|corr|move|mov|acerc|mas abajo|mas arriba|izquierda|derecha)/.test(t)) return null;
  const paso = /\bun poco|apenas|un toque|levemente\b/.test(t) ? 60 : /\bbastante|mucho\b/.test(t) ? 220 : 120;
  const d = dis[i]; let dx = 0, dy = 0;
  if (/\b(baj|mas abajo)/.test(t)) dy += paso; if (/\b(sub|mas arriba)/.test(t)) dy -= paso;
  if (/izquierda/.test(t)) dx -= paso; if (/derecha/.test(t) && !/flecha (a la |hacia la )?derecha/.test(t)) dx += paso;
  if (/acerc/.test(t) && !dx && !dy) dy -= paso;
  if (!dx && !dy) return null;
  d.icono_dx = Math.max(-500, Math.min(500, (d.icono_dx || 0) + dx)); d.icono_dy = Math.max(-500, Math.min(500, (d.icono_dy || 0) + dy));
  const datos = limpiarDatos({ dis }, c.datos);
  return { ok: true, respuesta: `Listo, moví el ícono del slide ${+i + 1}${dy > 0 ? " más abajo" : dy < 0 ? " más arriba" : ""}${dx < 0 ? " a la izquierda" : dx > 0 ? " a la derecha" : ""}. Si no te gusta, decime "volvé para atrás".`, regla: "", memoria: "", datos };
}
export async function chatCarrusel(env, iaJSON, c, mensaje) {
  const directo = colorDirecto(c, mensaje) || iconoDirecto(c, mensaje) || fotoFondoDirecto(c, mensaje);
  if (directo) return directo;
  const rg = await reglas(env);
  const memoriaAntes = await memoriaCarr(env);
  const datos = calcularDatos(c.datos);
  const r = await iaJSON(env, `Sos el agente de redes de "Te Importamos" y estás ajustando un carrusel con el dueño. Fase: ${c.estado === "slides" ? "slides (ya diseñados)" : "estructura"}.
${NEGOCIO}
${MANUAL}
Tipos de slide: ${AYUDA_TIPOS}. Para precios usá las marcas {precio_ml} {costo} {diferencia} {cantidad} {total} {producto}; nunca números de precio.
${textoDireccion(await direccion(env))}
${textoMemoria(memoriaAntes)}
ESTILO VISUAL ACTUAL: ${c.datos?.estilo || "manuscrito"}. Estilos disponibles: ${Object.entries(ESTILOS).map(([k, v]) => `${k} (${v.nombre})`).join("; ")}. Si pide cambiar el diseño o los colores, devolvé "estilo" con la clave.
DATOS CARGADOS: ${JSON.stringify({ producto: datos.producto, precio_ml: datos.precio_ml, costo: datos.costo, cantidad: datos.cantidad, diferencia: datos.diferencia, total: datos.total })}
SLIDES ACTUALES (numerados desde 1): ${JSON.stringify(c.slides)}
RETOQUES DE FOTOS ACTUALES (por número de slide): ${JSON.stringify(Object.fromEntries(Object.entries(c.datos?.fx || {}).map(([i, v]) => [+i + 1, v])))}
Fotos subidas en los slides: ${Object.keys(c.datos?.fotos || {}).map((i) => +i + 1).join(", ") || "ninguna"}.
Si pide retocar una foto (rotar, sombra, más grande, moverla, más brillo, etc.), devolvé en "fotos_fx" SOLO el slide que cambia, con TODOS sus valores finales (los actuales + el cambio). Valores posibles: ${Object.entries(FX).map(([k, v]) => `${k} (${v[0]} a ${v[1]}): ${v[2]}`).join("; ")}. "Ligeramente" = valores chicos (rot 4 a 6, sombra 1, piso 1 o 2). Para quitar un retoque poné su valor normal. No podés recortar el fondo ni dibujar sobre la foto: si lo pide, decíselo. Si la foto tiene fondo blanco o liso, para "sombra" usá sobre todo "piso" (la de "sombra" queda alrededor del rectángulo). NUNCA digas que cambiaste algo que no devolviste en el JSON.
AJUSTES DE DISEÑO ACTUALES (por número de slide): ${JSON.stringify(Object.fromEntries(Object.entries(c.datos?.dis || {}).map(([i, v]) => [+i + 1, v])))}
CAMBIÁ SOLO LO QUE PIDE: si nombra un slide, tocá únicamente ese slide; si pide mover, agrandar, achicar o poner un ícono, NO toques los textos (devolvé "slides": null). "Bajá la flecha" = icono_dy positivo (más 80 a 150 sobre el valor actual); "subila" = icono_dy negativo.
Si pide mover, centrar, alinear, agrandar o achicar textos o el @usuario de un slide, devolvé en "diseno" SOLO los slides que cambian, con TODOS sus valores finales. Valores: al ("c" = centrado, "l" = alineado a la izquierda); icono (uno de: ${ICONOS.join(", ")}; "" para sacarlo); icono_color (hex, ej. "#FFD400"; si no se pone, usa el color de acento); icono_pos (${POS_ICONO.join(", ")}; "debajo" = justo abajo del último texto, alineado como el texto, es el que hay que usar cuando dice "abajo del texto" o "pegado al texto"; las demás son posiciones fijas del slide); para acercarlo o correrlo un poco usá icono_dx / icono_dy (50 a 150 px = "un poco", sumá o restá sobre el valor actual); ${Object.entries(DIS).map(([k, v]) => `${k} (${v[0]} a ${v[1]}): ${v[2]}`).join("; ")}. "Un poco" = cambios chicos (texto 0.9, dy 60 a 120, usuario_dy 80 a 150).
CIERRE ("cta"): "palabra" es lo que va en grande. Si es UNA palabra se dibuja como Comentá "PALABRA". Si el dueño quiere otro llamado (link en bio, escribinos por WhatsApp, etc.), poné en "palabra" la frase completa (ej. "Link en bio" o "Escribinos al WhatsApp") y así NO aparece "Comentá". Sacá del "texto" y del "abajo" cualquier mención a comentar que contradiga el pedido.
COLORES: en este estilo el texto normal es ${nombreColor((c.datos?.colores?.tinta) || ESTILOS[c.datos?.estilo || "manuscrito"]?.tinta).toUpperCase()}, el fondo ${nombreColor((c.datos?.colores?.fondo) || ESTILOS[c.datos?.estilo || "manuscrito"]?.fondo).toUpperCase()} y lo que va entre *asteriscos* se pinta de ${nombreColor((c.datos?.colores?.acento) || ESTILOS[c.datos?.estilo || "manuscrito"]?.acento).toUpperCase()}. OJO: los asteriscos NO significan "amarillo", significan el color de acento. Para que una palabra quede del color del texto normal, sacale los asteriscos; para que quede del color de acento, ponésela entre asteriscos. Si pide un color que no está, cambiá el color en "colores" (hex: {"tinta":"#FFD400","acento":"#FFFFFF","fondo":"#111111"}, vale para todo el carrusel; para volver a los del estilo mandá "colores_estilo": true). Revisá el texto real antes de decir que algo "ya estaba" de un color.
LO ÚNICO QUE PODÉS CAMBIAR: textos de los slides (incluido qué palabras van entre asteriscos), texto del posteo, estilo, colores, datos de precios, retoques de fotos ("fotos_fx") y ajustes de diseño ("diseno"). Los íconos se agregan con "icono" en "diseno" (uno por slide, en el color de acento). Si pide algo que no está en esa lista (un tercer color para una sola palabra, otra letra, mover un solo renglón, un ícono que no existe), decile claramente que eso todavía no lo podés hacer. NUNCA digas que hiciste un cambio que no devolviste en el JSON.
TEXTO DEL POSTEO: ${JSON.stringify(c.caption || "")}
REGLAS QUE YA SABÉS: ${rg.map((x, i) => `${i + 1}. ${x}`).join(" ") || "ninguna"}
CHARLA PREVIA: ${c.chat.slice(-8).map((m) => `${m.r === "u" ? "DUEÑO" : "VOS"}: ${m.t}`).join(" | ") || "-"}
EL DUEÑO DICE: "${String(mensaje).slice(0, 800)}"
Hacé lo que pide con criterio de editor viral: si te dice que algo es aburrido o no engancha, no lo maquilles; cambiá el enfoque (tensión, número concreto, comparación, pregunta que obliga a pasar). Si cambia slides, devolvé TODOS los slides (completos, en orden). Si pide cambiar los datos (precio, costo, cantidad), devolvelos en "datos" con números.
Si el dueño expresa una preferencia DURADERA o confirma un resultado (por ejemplo "me gustan más los mitos que las comparaciones", "este tono sí", "menos venta directa"), actualizá la memoria editorial en "memoria" como un resumen corto y legible de las preferencias vigentes (máx. 1500 caracteres), integrando la memoria previa y evitando duplicados. No guardes instrucciones de un solo carrusel. Si formula una regla concreta que debe cumplirse siempre, devolvela también en "regla".
Respondé SOLO JSON: {"respuesta":"corta, qué cambiaste","slides":[...] o null,"caption":"..." o null,"datos":{...} o null,"fotos_fx":{"1":{"rot":-5,"sombra":1}} o null,"diseno":{"3":{"al":"c"},"1":{"usuario_dy":150,"usuario_escala":0.7}} o null,"colores":{"acento":"#FFD400"} o null,"colores_estilo":false,"regla":"..." o "","memoria":"resumen editorial actualizado o null"}`);
  if (!r) return { ok: false, error: "La IA no respondió. Probá de nuevo." };
  // Candados: si nombra slides, solo se tocan esos; si es un pedido de diseño (mover, ícono, tamaño), no se tocan los textos
  const nums = new Set([...String(mensaje).matchAll(/(?:slides?|diapositivas?)\s*((?:\d+\s*(?:,|y|e)?\s*)+)/gi)].flatMap((m) => m[1].match(/\d+/g) || []).map(Number));
  const pideTexto = /\b(textos?|dig[ao]|diga|escrib|palabras?|frases?|t[ií]tulos?|reemplaz|ortograf|tildes?|amarillo|blanco|naranja|rojo|azul|negro|colou?r|caption|posteo|gancho|cierre|redact|acort|alarg|cambi[aá]\s+(el|la|lo)\s+que\s+dice|sac[aá]\s+(la|el|lo)|agreg[aá]\s+(la|el|una?)\s+(palabra|frase|texto)|reescrib)/i.test(mensaje);
  if (!pideTexto) { delete r.slides; delete r.caption; }
  if (nums.size) {
    const soloEstos = (o) => (o && typeof o === "object" ? Object.fromEntries(Object.entries(o).filter(([k]) => nums.has(+k))) : o);
    r.diseno = soloEstos(r.diseno); r.fotos_fx = soloEstos(r.fotos_fx);
    if (Array.isArray(r.slides) && r.slides.length === (c.slides || []).length) r.slides = c.slides.map((s0, i) => (nums.has(i + 1) ? r.slides[i] : s0));
  }
  const cambios = {};
  if (Array.isArray(r.slides)) {
    let s = limpiarSlides(r.slides);
    const prob = s.length >= 3 ? problemasTexto(s) : [];
    if (prob.length) {
      const r2 = await iaJSON(env, `${MANUAL}\nCorregí estos problemas sin cambiar nada más: ${prob.join("; ")}.\nSLIDES: ${JSON.stringify(s)}\nRespondé SOLO JSON: {"slides":[...]}`);
      const s2 = limpiarSlides(r2?.slides); if (s2.length >= 3) s = s2;
    }
    if (s.length >= 3 && !PROHIBIDO.test(JSON.stringify(s))) cambios.slides = s;
  }
  if (typeof r.caption === "string" && r.caption.trim() && !PROHIBIDO.test(r.caption)) cambios.caption = r.caption.slice(0, 2200);
  if (r.datos && typeof r.datos === "object") cambios.datos = limpiarDatos(r.datos, c.datos);
  if (ESTILOS[r.estilo]) cambios.datos = limpiarDatos({ estilo: r.estilo }, cambios.datos || c.datos);
  if (r.fotos_fx && typeof r.fotos_fx === "object") {
    const fx = {}; for (const [n, v] of Object.entries(r.fotos_fx)) if (+n >= 1) fx[+n - 1] = v;
    const base = cambios.datos || c.datos || {};
    cambios.datos = limpiarDatos({ fx: { ...(base.fx || {}), ...fx } }, base);
    cambios.nota_fx = Object.keys(fx).map((i) => `slide ${+i + 1}: ${Object.entries(cambios.datos.fx[i] || {}).map(([k, v]) => k + " " + v).join(", ") || "sin retoques"}`).join(" · ");
  }
  if (r.colores_estilo === true || (r.colores && typeof r.colores === "object" && Object.keys(r.colores).length)) {
    const base = cambios.datos || c.datos || {};
    cambios.datos = limpiarDatos({ colores: r.colores_estilo === true ? null : r.colores }, base);
    const col = Object.entries(cambios.datos.colores || {}).map(([k, v]) => k + " " + v).join(", ");
    cambios.nota_fx = (cambios.nota_fx ? cambios.nota_fx + " · " : "") + "colores: " + (col || "los del estilo");
  }
  if (r.diseno && typeof r.diseno === "object") {
    const ds = {}; for (const [n, v] of Object.entries(r.diseno)) if (+n >= 1) ds[+n - 1] = v;
    const base = cambios.datos || c.datos || {};
    cambios.datos = limpiarDatos({ dis: { ...(base.dis || {}), ...ds } }, base);
    const nd = Object.keys(ds).filter((i) => cambios.datos.dis[i]).map((i) => `slide ${+i + 1}: ${Object.entries(cambios.datos.dis[i]).map(([k, v]) => k + " " + v).join(", ")}`).join(" · ");
    if (nd) cambios.nota_fx = (cambios.nota_fx ? cambios.nota_fx + " · " : "") + nd;
  }
  let regla = "";
  let memoria = "";
  if (typeof r.memoria === "string" && r.memoria.trim() && r.memoria.trim() !== memoriaAntes.trim()) {
    memoria = r.memoria.trim().slice(0, 1500);
    await guardarMemoriaCarr(env, memoria);
  }
  if (r.regla && String(r.regla).trim().length > 5) {
    regla = String(r.regla).trim().slice(0, 200);
    const l = rg.filter((x) => x.toLowerCase() !== regla.toLowerCase()).concat(regla).slice(-40);
    await kvPut(env, "ig_reglas_carrusel", JSON.stringify(l));
  }
  const { nota_fx, ...resto } = cambios;
  let respuesta = String(r.respuesta || "Listo.").slice(0, 600);
  if (nota_fx) respuesta += `\n(Retoque aplicado → ${nota_fx})`;
  else if (!resto.slides && !resto.caption && !resto.datos) respuesta = (regla || memoria ? "Me guardé la preferencia para los próximos, pero en ESTE carrusel no cambié nada todavía." : "Ojo: esta vez no se aplicó ningún cambio.") + " Pedímelo de nuevo, más concreto: ej. \"slide 3: centrado\" o \"slide 1: el @usuario más abajo y más chico\".";
  return { ok: true, respuesta, regla, memoria, ...resto };
}

// ---------- Virales de referencia: capturas analizadas por la IA ----------
const aB64 = (buf) => { let s = ""; const b = new Uint8Array(buf); for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); };
async function guardarFotosReferencia(env, id, imagenes) {
  const capturas = [];
  for (const data of (imagenes || []).slice(0, 3)) {
    const m = String(data).match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
    if (!m) continue;
    const bin = atob(m[2]); if (bin.length > 1024 * 1024) continue;
    const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const ext = m[1] === "image/jpeg" ? "jpg" : m[1].slice(6);
    const key = `carruseles/referencias/${id}/${capturas.length}.${ext}`;
    await env.VIDEOS.put(key, bytes, { httpMetadata: { contentType: m[1] } });
    capturas.push({ key, tipo: m[1] });
  }
  return capturas;
}
async function imagenesDeReferencia(env, refs, max = 6) {
  const out = [];
  for (const ref of refs || []) for (const c of (ref.capturas || []).slice(0, 3)) {
    if (out.length >= max) return out;
    const o = await env.VIDEOS.get(c.key).catch(() => null);
    if (o) out.push(`data:${c.tipo || o.httpMetadata?.contentType || "image/jpeg"};base64,${aB64(await new Response(o.body).arrayBuffer())}`);
  }
  return out;
}
async function borrarFotosReferencia(env, ref) {
  for (const c of ref?.capturas || []) if (c?.key && c.key.startsWith(`carruseles/referencias/${ref.id}/`)) await env.VIDEOS.delete(c.key);
}
export async function analizarReferencia(env, iaImg, imagenes, nota = "", link = "") {
  let imgs = (imagenes || []).filter((d) => /^data:image\/(jpeg|png|webp);base64,/.test(String(d))).slice(0, 6);
  const texto = [nota ? "Nota del dueño: " + String(nota).slice(0, 300) : "", link ? "Link de origen (no consultado): " + String(link).trim().slice(0, 300) : ""].filter(Boolean).join("\n");
  if (!imgs.length) return { ok: false, error: "Subí capturas de los slides. El link se guarda como referencia, pero no se abre ni se extrae contenido." };
  if (!iaImg) return { ok: false, error: "La IA de imágenes no está disponible" };
  const r = await iaImg(env, `Estas son imágenes (en orden) de un carrusel de Instagram que se viralizó. ${texto}
Analizalo como estratega: extraé sólo la mecánica narrativa, el ritmo y los rasgos visuales reutilizables. No copies el texto, la marca ni el diseño exacto. Decí cómo adaptarlo a "Te Importamos" (importación por encargo desde Rosario, sin productos prohibidos ni prometer ganancias).
Claves de estilo disponibles: ${Object.keys(ESTILOS).join(", ")}.
Respondé SOLO JSON: {"cuenta":"usuario si se ve, sin @, o vacío","tema":"de qué trata en 5 palabras","formato":"mito|error|caso_real|paso_a_paso|que_pasa_si|lista|opinion|comparacion|otro","gancho":"texto de la portada tal cual","estructura":["función de cada slide en 2 a 5 palabras"],"por_que":"por qué engancha, en una frase","tecnicas":["técnicas concretas"],"estilo_visual":"cómo se ve: fondo, tipografía, colores, en una frase","estilo_sugerido":"la clave de estilo más parecida","adaptacion":"cómo lo haríamos para Te Importamos, en una frase"}`, imgs);
  if (!r?.gancho) return { ok: false, error: "No pude leer las imágenes. Probá con capturas más nítidas." };
  const ref = { id: nuevoId(), ts: Date.now(), cuenta: String(r.cuenta || "").replace(/^@/, "").slice(0, 40), tema: String(r.tema || "").slice(0, 80), formato: String(r.formato || "otro").slice(0, 30), gancho: String(r.gancho).slice(0, 200), estructura: (r.estructura || []).map((x) => String(x).slice(0, 60)).slice(0, 12), por_que: String(r.por_que || "").slice(0, 240), tecnicas: (r.tecnicas || []).map((x) => String(x).slice(0, 60)).slice(0, 8), estilo_visual: String(r.estilo_visual || "").slice(0, 160), estilo_sugerido: ESTILOS[r.estilo_sugerido] ? r.estilo_sugerido : "", adaptacion: String(r.adaptacion || "").slice(0, 240) };
  try { ref.capturas = await guardarFotosReferencia(env, ref.id, imgs); } catch { ref.capturas = []; }
  const previas = await referencias(env), l = previas.concat(ref).slice(-30);
  for (const vieja of previas.slice(0, Math.max(0, previas.length + 1 - 30))) await borrarFotosReferencia(env, vieja);
  await kvPut(env, "ig_refs_carrusel", JSON.stringify(l));
  return { ok: true, referencia: ref, referencias: l, aviso: ref.capturas.length ? "Referencia guardada. El agente conservará las capturas y la estructura." : "Se analizó, pero no se pudieron conservar las capturas." };
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
export async function apiCarruseles(env, req, url, quien, iaJSON, T = null, iaImg = null) {
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
    const l = (await env.DB.prepare("SELECT id, ts, estado, titulo, angulo, por_que, producto, datos, n_slides, programado_ts, link, error, publicado_ts FROM ig_carruseles WHERE estado <> 'descartado' AND ts > ? ORDER BY ts DESC LIMIT 60").bind(Date.now() - 60 * 86400e3).all()).results || [];
    const yo = JSON.parse((await kvGet(env, "ig_yo")) || "{}");
    return json({ carruseles: l.map((x) => ({ ...x, datos: JSON.parse(x.datos || "{}") })), reglas: await reglas(env), referencias: await referencias(env), descartes: (await descartes(env)).length, usuario: yo.username || "te.importamos.arg", tipos: TIPOS_SLIDE, estilos: ESTILOS, direccion: await direccion(env), memoria: await memoriaCarr(env) });
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
  if (r === "referencia-img") {
    const ref = (await referencias(env)).find((x) => x.id === url.searchParams.get("id"));
    const n = Number(url.searchParams.get("n"));
    if (!ref || !Number.isInteger(n) || n < 0 || n >= (ref.capturas || []).length) return new Response("Referencia no encontrada", { status: 404 });
    const cap = ref.capturas[n];
    if (!cap?.key || !cap.key.startsWith(`carruseles/referencias/${ref.id}/`)) return new Response("Referencia no encontrada", { status: 404 });
    return servir(env, req, cap.key);
  }
  if (r === "referencia" && req.method === "POST") return json(await analizarReferencia(env, iaImg, body.imagenes, body.nota, body.link));
  if (r === "direccion" && req.method === "POST") { await kvPut(env, "ig_direccion_carrusel", String(body.texto || "").slice(0, 1500)); return json({ ok: true }); }
  if (r === "memoria" && req.method === "POST") { await guardarMemoriaCarr(env, body.texto); return json({ ok: true, memoria: await memoriaCarr(env) }); }
  if (r === "referencia-borrar" && req.method === "POST") {
    const anteriores = await referencias(env), eliminar = anteriores[+body.i];
    if (eliminar) await borrarFotosReferencia(env, eliminar);
    const l = anteriores.filter((_, i) => i !== +body.i);
    await kvPut(env, "ig_refs_carrusel", JSON.stringify(l));
    return json({ ok: true, referencias: l });
  }
  if (r === "generar-ideas" && req.method === "POST") return json(await generarIdeasCarrusel(env, iaJSON, { T, quien, ref: body.ref != null ? +body.ref : null, iaImg }));
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
    const e = await armarEstructura(env, iaJSON, c, T, iaImg);
    if (!e.ok) return json(e);
    const chat = c.chat.concat({ r: "a", t: "Escribí 3 versiones, me quedé con la mejor y la pulí. Revisala, cargá los números reales arriba y decime qué cambiar. Cuando te cierre, tocá \"Confirmar estructura\"." + (e.avisos?.length ? "\nOjo: " + e.avisos.join("; ") : "") });
    await guardar(c, { estado: "estructura", slides: e.slides, caption: e.caption, chat, datos: limpiarDatos({ estilo: e.estilo }, c.datos) });
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
    // Deshacer: "volvé para atrás", "deshacé", "undo"... restaura cómo estaba antes del último cambio
    const kh = "carr_hist:" + c.id, hist = JSON.parse((await kvGet(env, kh)) || "[]");
    if (/^\s*(volv[eé](lo)?\s*(para|a)?\s*atr[aá]s|volv[eé]\s+(a\s+)?(como|lo)\s+(estaba|anterior)|deshac[eé](lo)?|undo|ctrl\s*\+?\s*z|atr[aá]s|revert[ií]|como\s+estaba(\s+antes)?)(?=[\s.,!?]|$)/i.test(m)) {
      const prev = hist.pop();
      const t = prev ? "Listo, volví al estado anterior a tu último cambio." + (hist.length ? ` (Podés volver ${hist.length} paso${hist.length === 1 ? "" : "s"} más.)` : " (Ya no hay más pasos para atrás.)") : "No tengo cambios anteriores para deshacer.";
      const chat = c.chat.concat({ r: "u", t: m.slice(0, 800) }, { r: "a", t }).slice(-40);
      await kvPut(env, kh, JSON.stringify(hist));
      await guardar(c, { chat, ...(prev ? { slides: prev.slides, caption: prev.caption, datos: prev.datos } : {}) });
      return json({ ok: true, ...(await uno()) });
    }
    const res = await chatCarrusel(env, iaJSON, c, m);
    if (!res.ok) return json(res);
    if (res.slides || res.caption || res.datos) await kvPut(env, kh, JSON.stringify(hist.concat({ slides: c.slides, caption: c.caption, datos: c.datos }).slice(-15)));
    const chat = c.chat.concat({ r: "u", t: m.slice(0, 800) }, { r: "a", t: res.respuesta + (res.regla ? `\n(Lo guardo para los próximos: "${res.regla}")` : "") }).slice(-40);
    await guardar(c, { chat, ...(res.slides ? { slides: res.slides } : {}), ...(res.caption ? { caption: res.caption } : {}), ...(res.datos ? { datos: res.datos } : {}) });
    return json({ ok: true, regla: res.regla, memoria: res.memoria, ...(await uno()) });
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
    // La foto es obligatoria solo donde el diseño deja un hueco para ella: capturas siempre; portadas solo en estilos que no usan foto de fondo
    const estC = ESTILOS[c.datos?.estilo || "manuscrito"] || {};
    for (let i = 0; i < n; i++) { const t = c.slides[i].tipo; if (TIPOS_SLIDE[t]?.foto && !c.datos.fotos?.[i] && (t === "captura" || !estC.fotoFondo)) return json({ error: `Falta la foto del slide ${i + 1}` }, 400); }
    let cuando = +body.cuando || 0;
    // Si elegiste un horario que ya pasó o está por pasar (mientras se subían las imágenes), sale en 2 minutos en vez de saltar al día siguiente
    if (!cuando) cuando = await proximoHorarioCarr(env);
    else if (cuando < Date.now() + 2 * 60e3) cuando = Date.now() + 2 * 60e3;
    const caption = typeof body.caption === "string" ? body.caption.slice(0, 2200) : c.caption;
    await guardar(c, { estado: "aprobado", n_slides: n, programado_ts: cuando, caption, aprobado_por: quien || "", error: null, contenedor: null, token: null });
    return json({ ok: true, programado_ts: cuando });
  }
  if (r === "sugerir-hora") return json({ ts: await proximoHorarioCarr(env) });
  if (r === "reprogramar" && req.method === "POST") {
    if (c.estado !== "aprobado") return json({ error: "Solo se puede cambiar el horario de uno programado que todavía no salió" }, 400);
    const ts = +body.cuando || 0;
    if (!ts || ts < Date.now() - 60e3) return json({ error: "Elegí una fecha y hora que todavía no pasó" }, 400);
    await guardar(c, { programado_ts: Math.max(ts, Date.now() + 2 * 60e3) });
    return json({ ok: true, ...(await uno()) });
  }
  if (r === "frenar" && req.method === "POST") {
    if (c.estado !== "aprobado") return json({ error: "Solo se puede frenar uno programado que no salió" }, 400);
    await guardar(c, { estado: "slides", programado_ts: null });
    return json({ ok: true, ...(await uno()) });
  }
  if (r === "descartar" && req.method === "POST") {
    if (["publicando", "publicado"].includes(c.estado)) return json({ error: "Ya está publicado" }, 400);
    await borrarImagenes(env, c.id);
    await guardar(c, { estado: "descartado", borrado: 1 });
    const motivo = String(body.motivo || "").trim().slice(0, 500);
    const gancho = (String(c.por_que || "").match(/Portada: "([^"]+)"/) || [])[1] || c.slides?.[0]?.titulo || "";
    const l = (await descartes(env)).concat({ ts: Date.now(), titulo: c.titulo, gancho, angulo: c.angulo, motivo }).slice(-60);
    await kvPut(env, "ig_descartes_carrusel", JSON.stringify(l));
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
