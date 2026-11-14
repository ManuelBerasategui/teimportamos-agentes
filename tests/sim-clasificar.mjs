// Simulación: perfiles A/B estrictos, detección de proveedores y poda de ideas (todo sin IA).
// Correr desde cotizador/: node ../tests/sim-clasificar.mjs
import { perfilEstricto, pareceProveedor, podarIdeas } from "../cotizador/src/clasificar.js";

let fallas = 0;
const ok = (cond, msg) => { if (!cond) { fallas++; console.log("FALLA:", msg); } else console.log("ok:", msg); };

// --- Perfiles
ok(perfilEstricto("A", "hola quiero 100 auriculares, cuanto sale?") === "C", "A sin prueba (solo cantidad) baja a C");
ok(perfilEstricto("A", "los vendo en mercado libre, quiero 100") === "A", "A con Mercado Libre queda A");
ok(perfilEstricto("B", "precio de 20 NFC?") === "C", "B sin prueba baja a C");
ok(perfilEstricto("B", "tengo un local de ropa en Rosario") === "B", "B con local queda B");
ok(perfilEstricto("A", "es para mi negocio, necesito factura A") === "B", "A que en realidad es negocio pasa a B");
ok(perfilEstricto("B", "consulta por cables", "Conect Cell - Servicio Tecnico Profesional") === "B", "nombre de negocio cuenta como prueba de B");
ok(perfilEstricto("A", "quiero 4 frascos de 500 ml") === "C", "'ml' de mililitros no es Mercado Libre");
ok(perfilEstricto("C", "tengo un local") === "C", "C no se toca");
ok(perfilEstricto(null, "") === null, "sin perfil queda sin perfil");

// --- Proveedor (charla real de Michael Shop, resumida)
const michael = [
  { yo: 1, texto: "tenes la guia?" }, { yo: 0, texto: "999039273075" }, { yo: 0, texto: "Acá te dejo" },
  { yo: 1, texto: "Quisiera 4 remeras Adidas, 1 XXL negra" }, { yo: 0, texto: "Hola buen día ahí te confirmo si logro tener así." },
  { yo: 1, texto: "y si tenes guia de talles de las remeras de boca" }, { yo: 0, texto: "No tenemos en color blanca ahora sabes" },
  { yo: 1, texto: "de las bermudas jordan te quedaron en stock?" }, { yo: 0, texto: "Si tengo stock" },
  { yo: 0, texto: "Colores? Surtido" }, { yo: 1, texto: "te consulto, se puden comprar sin que sea x curva? y a que precio?" },
  { yo: 0, texto: "Ese producto por ahora solo curva." }, { yo: 1, texto: "hola como andas, te consulto por camisetas de futbol" }, { yo: 0, texto: "que talle buscas?" },
];
ok(pareceProveedor(michael) === true, "Michael Shop (le compramos nosotros) es proveedor");
const cliente = [
  { yo: 0, texto: "hola cuanto sale importar 100 auriculares?" }, { yo: 1, texto: "te paso la cotizacion" },
  { yo: 0, texto: "que talle tienen las remeras?" }, { yo: 1, texto: "te consulto, para revender o para tu negocio?" }, { yo: 0, texto: "para revender, me interesa" },
];
ok(pareceProveedor(cliente) === false, "un cliente normal no es proveedor");
ok(pareceProveedor([]) === false, "chat vacío no es proveedor");

// --- Poda de ideas
const T = [
  ["productos", "Publicar un cupo en grupos de WhatsApp para lotes de tarjetas NFC con mínimo de 20 unidades respaldado por 6 consultas recientes."],
  ["redes", "Lanzar una historia de WhatsApp a perfiles A y B ofreciendo cupos para tarjetas NFC de reseñas con mínimo de 20 unidades."],
  ["whatsapp", "Publicar un caso de éxito en grupos mostrando el costo puesto de los Lentes Ray-Ban Meta para atraer revendedores de Mercado Libre."],
  ["whatsapp", "Crear un programa de fidelidad para clientes que han comprado anteriormente."],
  ["whatsapp", "Realizar un análisis de competencia para mejorar la oferta de productos y precios."],
  ["redes", "Hacer un reel mostrando cómo calcular el costo de importar 50 freidoras de aire para revender en Mercado Libre."],
  ["redes", "Grabar un video tipo adiviná cuánto sale con la hidrolavadora revelando el costo FOB más flete puesto en Rosario."],
  ["redes", "Subir un video respondiendo un comentario de aduana con la fórmula de cotización para filtrar curiosos y atraer 10 comerciantes."],
];
const ideas = T.map(([agente, texto], i) => ({ id: "i" + i, agente, texto, ts: Date.now() - i * 1000 }));
ideas.push({ id: "vieja", agente: "redes", texto: "Reel de 30 segundos con termos Stanley para 50 comercios", ts: Date.now() - 10 * 86400e3 });
const r = podarIdeas(ideas, { productos: ["tarjetas nfc", "ray-ban meta", "freidoras aire"] });
const motivo = (id) => (r.podadas.find((p) => p.id === id) || {}).motivo || "";
ok(/gen[eé]rica/.test(motivo("i3")) && /gen[eé]rica/.test(motivo("i4")), "las genéricas se podan");
ok(/repetida/.test(motivo("i1")), "la segunda idea de NFC se poda por repetida");
ok(/vieja/.test(motivo("vieja")), "la idea de más de 7 días se poda");
ok(r.quedan.length <= 6, "quedan como mucho 6 ideas");
const porAg = {}; for (const id of r.quedan) { const a = ideas.find((x) => x.id === id).agente; porAg[a] = (porAg[a] || 0) + 1; }
ok(Object.values(porAg).every((n) => n <= 2), "como mucho 2 ideas por agente");
ok(r.quedan.includes("i0") && r.quedan.includes("i2"), "quedan las concretas (NFC y Ray-Ban Meta)");

// --- Base de datos: corrección única (perfil_v2) y botón "No es cliente" / "Sí es cliente"
{
  const { DatabaseSync } = await import("node:sqlite");
  const fs = await import("fs");
  const dir = fs.mkdtempSync("/tmp/clasif-");
  for (const f of fs.readdirSync("src")) fs.copyFileSync("src/" + f, dir + "/" + f);
  const db = new DatabaseSync(":memory:");
  const stmt = (sql, b = []) => ({ bind: (...x) => stmt(sql, x), run: async () => { db.prepare(sql).run(...b); return {}; }, first: async () => db.prepare(sql).get(...b) ?? null, all: async () => ({ results: db.prepare(sql).all(...b) }) });
  const kv = new Map();
  const env = { DB: { prepare: (s) => stmt(s), batch: async (a) => { for (const x of a) await x.run(); } }, ESTADO: { get: async (k) => kv.get(k) ?? null, put: async (k, v) => { kv.set(k, v); }, delete: async (k) => { kv.delete(k); }, list: async () => ({ keys: [] }) } };
  const L = await import(dir + "/lector.js"), T = await import(dir + "/tablero.js");
  await L.prepararLector(env); await T.prepararTablero(env);
  const ahora = Date.now(); let n = 0;
  const conv = (c, nombre, perfil) => db.prepare("INSERT INTO w_conv (conv,nombre,grupo,primer_ts,ult_ts,ult_yo,ult_cliente_ts,ult_texto,n,analizado_ts,puntaje,etapa,perfil) VALUES (?,?,0,?,?,0,?,'',5,?,5,'consulta',?)").run(c, nombre, ahora - 5 * 864e5, ahora - 864e5, ahora - 864e5, ahora, perfil);
  const msg = (c, yo, texto) => db.prepare("INSERT INTO w_msg (id,conv,grupo,yo,texto,ts,hist,tipo) VALUES (?,?,0,?,?,?,0,'text')").run("m" + n++, c, yo, texto, ahora - 864e5 + n * 1000);
  conv("111", "Michael Shop", "B"); for (const m of michael) msg("111", m.yo, m.texto);
  conv("222", "Gustavo", "A"); msg("222", 0, "hola quiero 100 auriculares, cuanto sale?"); msg("222", 1, "te paso la cotizacion");
  conv("333", "Franco", "A"); msg("333", 0, "vendo en mercado libre, quiero arrancar con 50");
  conv("444", "Lucas", "B"); msg("444", 0, "es para mi local de celulares");
  const r = await L.revalidarClasificacion(env, ahora);
  const g = (c) => db.prepare("SELECT perfil, prov, etapa FROM w_conv WHERE conv=?").get(c);
  ok(g("111").prov === 1 && g("111").etapa === "no_cliente" && g("111").perfil === null, "corrección única: Michael Shop pasa a proveedor");
  ok(g("222").perfil === "C" && g("333").perfil === "A" && g("444").perfil === "B", "corrección única: A sin prueba baja a C, los que tienen prueba quedan");
  ok(r.prov.length === 1 && r.perfil.length === 1, "corrección única: informa qué cambió");
  await T.marcar(env, "es-cliente", { conv: "111" }, "Manuel");
  ok(g("111").prov === 0 && g("111").etapa === "consulta", "botón Sí es cliente deshace la marca");
  ok((await L.marcasClientes(env))["111"] === "cliente", "la marca a mano queda guardada para que la IA no la pise");
  await T.marcar(env, "proveedor", { conv: "222" }, "Manuel");
  ok(g("222").prov === 1 && (await L.marcasClientes(env))["222"] === "prov", "botón No es cliente lo saca de clientes");
}

console.log(fallas ? `\n${fallas} FALLAS` : "\nTodo bien: sim-clasificar");
process.exit(fallas ? 1 : 0);
