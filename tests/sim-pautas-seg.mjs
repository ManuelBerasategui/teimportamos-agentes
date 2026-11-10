// Pautas de seguimiento del dueño: se cargan con el token, se limpian, y la IA las recibe como criterio al escribir seguimientos. Correr desde cotizador/
import { DatabaseSync } from "node:sqlite";
import fs from "fs";
import os from "os";
import path from "path";
import { pathToFileURL } from "node:url";
let ok = 0, mal = 0; const chk = (n, c) => { c ? (ok++, console.log("✓ " + n)) : (mal++, console.log("FALLA: " + n)); };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pautas-"));
const sourceDir = new URL("../cotizador/src/", import.meta.url);
for (const f of fs.readdirSync(sourceDir)) fs.copyFileSync(new URL(f, sourceDir), path.join(dir, f));
const db = new DatabaseSync(":memory:");
const stmt = (sql, b = []) => ({ bind: (...x) => stmt(sql, x), run: async () => { db.prepare(sql).run(...b); return {}; }, first: async () => db.prepare(sql).get(...b) ?? null, all: async () => ({ results: db.prepare(sql).all(...b) }) });
const env = { LECTOR_TOKEN: "tok-prueba", DB: { prepare: (s) => stmt(s), batch: async (a) => { for (const x of a) await x.run(); } } };
const L = await import(pathToFileURL(path.join(dir, "lector.js")));
await L.prepararLector(env);
const D = 86400e3, ahora = Date.now(), h = (d) => ahora - d * D;
let nm = 0;
const msg = (conv, yo, texto, ts) => db.prepare("INSERT INTO w_msg (id,conv,grupo,yo,texto,ts,hist,tipo) VALUES (?,?,0,?,?,?,0,'text')").run("m" + nm++, conv, yo, texto, ts);
const conv = (c, o) => db.prepare(`INSERT INTO w_conv (conv,nombre,grupo,primer_ts,ult_ts,ult_yo,ult_cliente_ts,ult_yo_ts,ult_texto,n,analizado_ts,puntaje,etapa,producto,perfil,presup_usd,resp,cot_pend,archivado,prov)
  VALUES (?,?,0,?,?,?,?,?,?,5,?,7,'cotizado',?,?,?,0,0,0,0)`).run(c, o.nombre, h(20), o.ult, o.ult_yo, o.cli ?? 0, o.yo ?? 0, "", o.ult, o.producto ?? "", "C", o.usd ?? null);
const cot = (c, ts) => db.prepare("INSERT INTO w_hito (id,conv,tipo,ts,dato) VALUES (?,?,'cotizacion',?,'')").run("c:" + c + ts, c, ts);
conv("5493410000001", { nombre: "Ana", ult: h(2), ult_yo: 1, yo: h(2), producto: "auriculares", usd: 400 });
msg("5493410000001", 0, "cuanto 20 auriculares?", h(2.1)); msg("5493410000001", 0, "uh se me va de precio", h(2.05)); msg("5493410000001", 1, "Total USD 400 puesto en tu casa", h(2)); cot("5493410000001", h(2));

const ruta = (p, metodo = "GET", body = null, token = "tok-prueba") => L.rutaLector(env, new Request("https://x/lector" + p, { method: metodo, headers: token ? { Authorization: "Bearer " + token } : {}, body: body ? JSON.stringify(body) : undefined }), new URL("https://x/lector" + p), null, null);
let prompts = [];
const ia = async (_e, p) => { prompts.push(p); return { mensajes: [{ n: 1, situacion: 5, seguir: true, mensaje: "ana, cuanto querias invertir mas o menos? te armo algo que entre" }] }; };

// 1) Sin pautas el prompt queda igual que antes
await L.revisarSeguimientos(env, ia, { limite: 0, forzar: true });
chk("sin pautas no aparece el bloque de criterio", prompts.length === 1 && !/CRITERIO DEL DUEÑO/.test(prompts[0]) && /\nEstilo: rioplatense/.test(prompts[0]));

// 2) Cargar sin token: rechazado
chk("sin token no se pueden cargar", (await ruta("/enviar/pautas-seg", "POST", { pautas: [] }, null)).status === 401);
chk("con token equivocado tampoco", (await ruta("/enviar/pautas-seg", "POST", { pautas: [] }, "otro")).status === 401);

// 3) Cargar con token: se limpian y se recortan
const muchas = Array.from({ length: 20 }, (_, i) => ({ situacion: "extra " + i, pauta: "pauta de relleno numero " + i }));
const r = await (await ruta("/enviar/pautas-seg", "POST", { pautas: [
  { situacion: "le parecio caro", pauta: "si le parecio caro no repetirle la misma pregunta. pedirle cuanto quiere invertir", ejemplo: "¿[nombre] cuanto queres invertir?\u0007" },
  { situacion: "corta", pauta: "muy corta" },
  ...muchas,
] })).json();
chk("guarda con token", r.ok && Array.isArray(r.pautas) && r.ts > 0);
chk("descarta pautas demasiado cortas", !r.pautas.some((x) => x.pauta === "muy corta"));
chk("máximo 15 pautas", r.pautas.length === 15);
chk("saca ¿ ¡ y caracteres de control del ejemplo", r.pautas[0].ejemplo === "[nombre] cuanto queres invertir?");
const g = await (await ruta("/enviar/pautas-seg")).json();
chk("GET devuelve lo guardado", g.pautas?.length === 15 && g.pautas[0].situacion === "le parecio caro");
chk("no pasa por el contestador (no es una regla del autoresp)", !(await L.pautasSeg(env)).pautas.some((x) => /regla/.test(x.situacion)) && !(db.prepare("SELECT v FROM kv WHERE k='ent:reglas'").get()));

// 4) La IA las recibe como criterio, antes del estilo, sin pedir que copie el ejemplo
prompts = [];
await L.revisarSeguimientos(env, ia, { limite: 0, forzar: true });
const p = prompts[0] || "";
chk("el prompt trae el criterio del dueño", /CRITERIO DEL DUEÑO/.test(p) && /1\. le parecio caro: si le parecio caro no repetirle/.test(p));
chk("pide generalizar y no copiar el ejemplo", /Entendé la IDEA/.test(p) && /NO lo copies/.test(p) && /tono: "\[nombre\] cuanto queres invertir\?"/.test(p));
chk("el criterio no pisa el toque 3 ni lo de no inventar", /toque 3 mantiene el cierre con opciones numeradas/.test(p) && /Nunca inventes precios/.test(p));
chk("va antes del estilo y después de la estructura", p.indexOf("Estructura:") < p.indexOf("CRITERIO DEL DUEÑO") && p.indexOf("CRITERIO DEL DUEÑO") < p.indexOf("\nEstilo:"));
chk("el seguimiento se guarda como siempre", (await L.seguimientos(env)).find((x) => x.nombre === "Ana")?.borrador.startsWith("ana, cuanto querias"));

// 5) Seguimientos escritos desde afuera también reciben el criterio
const ex = await (await ruta("/enviar/seg-externos")).json();
chk("seg-externos manda el criterio", /CRITERIO DEL DUEÑO/.test(ex.criterio || ""));

// 6) Borrar
const b = await (await ruta("/enviar/pautas-seg", "POST", { pautas: [] })).json();
prompts = [];
await L.revisarSeguimientos(env, ia, { limite: 0, forzar: true });
chk("con [] se borran y el prompt vuelve a ser el de antes", b.pautas.length === 0 && !/CRITERIO DEL DUEÑO/.test(prompts[0]));
chk("texto vacío si no hay pautas", L.pautasTexto({ pautas: [] }) === "" && L.pautasTexto(null) === "");

console.log(`\n${ok} bien, ${mal} mal`);
if (mal) process.exit(1);
