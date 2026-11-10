// Seguimientos: situaciones, máximo 3 toques, recálculo sin prometer descuentos, pasar al dueño y fecha futura. Correr desde cotizador/
import { DatabaseSync } from "node:sqlite";
import fs from "fs";
import os from "os";
import path from "path";
import { pathToFileURL } from "node:url";
let ok = 0, mal = 0; const chk = (n, c) => { c ? (ok++, console.log("✓ " + n)) : (mal++, console.log("FALLA: " + n)); };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "seg2-"));
const sourceDir = new URL("../cotizador/src/", import.meta.url);
for (const f of fs.readdirSync(sourceDir)) fs.copyFileSync(new URL(f, sourceDir), path.join(dir, f));
const db = new DatabaseSync(":memory:");
const stmt = (sql, b = []) => ({ bind: (...x) => stmt(sql, x), run: async () => { db.prepare(sql).run(...b); return {}; }, first: async () => db.prepare(sql).get(...b) ?? null, all: async () => ({ results: db.prepare(sql).all(...b) }) });
const env = { DB: { prepare: (s) => stmt(s), batch: async (a) => { for (const x of a) await x.run(); } } };
const L = await import(pathToFileURL(path.join(dir, "lector.js")));
await L.prepararLector(env);
const D = 86400e3, ahora = Date.now(), h = (d) => ahora - d * D;
let nm = 0;
const msg = (conv, yo, texto, ts) => db.prepare("INSERT INTO w_msg (id,conv,grupo,yo,texto,ts,hist,tipo) VALUES (?,?,0,?,?,?,0,'text')").run("m" + nm++, conv, yo, texto, ts);
const conv = (c, o) => db.prepare(`INSERT INTO w_conv (conv,nombre,grupo,primer_ts,ult_ts,ult_yo,ult_cliente_ts,ult_yo_ts,ult_texto,n,analizado_ts,puntaje,etapa,producto,perfil,presup_usd,resp,cot_pend,archivado,prov)
  VALUES (?,?,0,?,?,?,?,?,?,5,?,7,'cotizado',?,?,?,0,0,0,0)`).run(c, o.nombre, h(20), o.ult, o.ult_yo, o.cli ?? 0, o.yo ?? 0, o.texto ?? "", o.ult, o.producto ?? "", o.perfil ?? "C", o.usd ?? null);
const cot = (c, ts) => db.prepare("INSERT INTO w_hito (id,conv,tipo,ts,dato) VALUES (?,?,'cotizacion',?,'')").run("c:" + c + ts, c, ts);
// Ana: cotizada hace 2 días, silencio → toque 1
conv("5493410000001", { nombre: "Ana", ult: h(2), ult_yo: 1, yo: h(2), producto: "auriculares", usd: 400 });
msg("5493410000001", 0, "cuanto 20 auriculares?", h(2.1)); msg("5493410000001", 1, "Total USD 400 puesto en tu casa", h(2)); cot("5493410000001", h(2));
// Beto: cotizado hace 5 días, le escribimos hace 4 → toque 2 (va la oferta)
conv("5493410000002", { nombre: "Beto", ult: h(4), ult_yo: 1, yo: h(4), producto: "sandalias", usd: 300 });
msg("5493410000002", 1, "Total USD 300", h(5)); msg("5493410000002", 1, "lo ajustamos?", h(4)); cot("5493410000002", h(5));
// Caro: ya le escribimos 3 días distintos sin respuesta → no hay cuarto
conv("5493410000003", { nombre: "Caro", ult: h(10), ult_yo: 1, yo: h(10), producto: "termos", usd: 200 });
msg("5493410000003", 1, "Total USD 200", h(20)); for (const d of [18, 14, 10]) msg("5493410000003", 1, "toque", h(d)); cot("5493410000003", h(20));
// Dani: perfil A (Mercado Libre) → pasa al dueño, nunca sale solo
conv("5493410000004", { nombre: "Dani", ult: h(2), ult_yo: 1, yo: h(2), producto: "tarjetas nfc", perfil: "A", usd: 3000 });
msg("5493410000004", 1, "Total USD 3000", h(2)); cot("5493410000004", h(2));
// Eli: pidió que le escribamos en una fecha futura
conv("5493410000005", { nombre: "Eli", ult: h(2), ult_yo: 1, yo: h(2), producto: "gorras", usd: 250 });
msg("5493410000005", 1, "Total USD 250", h(2)); cot("5493410000005", h(2));
const futura = new Date(ahora + 5 * D).toISOString().slice(0, 10);
let prompts = [];
const ia = async (_e, p) => { prompts.push(p); const n = (nom) => { const m = p.match(new RegExp("#(\\d+) " + nom)); return m ? +m[1] : 0; };
  return { mensajes: [
    { n: n("Ana"), situacion: 2, seguir: true, mensaje: "¡buenas ana! 🙌 los 20 auriculares quedan en usd 400 puestos en tu casa, plazo 25 a 40 dias. arrancamos?", total: "USD 400" },
    { n: n("Beto"), situacion: 2, seguir: true, mensaje: "beto, con las sandalias se puede arrancar con menos pares de prueba. te lo armo?" },
    { n: n("Dani"), situacion: 5, seguir: true, dueno: true, llamada: "pregunta por flete y factura", mensaje: "dani, te llamo y lo vemos?" },
    { n: n("Eli"), situacion: 7, seguir: true, no_antes: futura, mensaje: "eli, como quedamos?" },
  ].filter((x) => x.n) }; };
const l = await L.revisarSeguimientos(env, ia, { limite: 0 });
const por = Object.fromEntries(l.map((x) => [x.nombre, x]));
chk("toque 1 y toque 2 entran", por.Ana?.toque === 1 && por.Beto?.toque === 2);
chk("con 3 toques sin respuesta no hay cuarto", !por.Caro);
chk("el prompt clasifica situaciones y lee la charla", /PASO 1/.test(prompts[0]) && /pendiente nuestro/.test(prompts[0]) && /TOQUE 1 de 3/.test(prompts[0]));
chk("no promete descuentos y ofrece revisar otra cantidad", /no prometas descuentos/.test(prompts[0]) && !/50% off en nuestros honorarios/.test(prompts[0]) && /revise una cantidad menor/.test(L.borradorBase({ nombre: "Ana", toque: 2 })));
chk("al mensaje se le sacan ¿ ¡ y emojis", por.Ana && !/[¿¡🙌]/u.test(por.Ana.borrador));
chk("situación guardada en w_conv", db.prepare("SELECT seg_situacion s FROM w_conv WHERE conv='5493410000001'").get().s === "2");
chk("perfil A pasa al dueño con tarea de llamada", por.Dani?.dueno && !!db.prepare("SELECT 1 FROM tareas WHERE tel='5493410000004' AND tipo='llamar'").get());
chk("pidió fecha futura: no aparece antes", !por.Eli);
chk("borrador de respaldo sin emojis ni ¿ y toque 3 con opciones", !/[¿¡🙌]/u.test(L.borradorBase({ nombre: "Ana", toque: 1 })) && /1\) el precio total/.test(L.borradorBase({ toque: 3 })));
// Envío automático: nada hasta 10 buenos; después solo situaciones simples sin dueño
chk("sin 10 buenos el programa de la PC no manda nada", (await L.seguimientosAuto805(env)).length === 0);
const api = (r, b) => L.apiLector(env, new Request("https://x/panel/api/805/" + r, { method: "POST", body: JSON.stringify(b) }), new URL("https://x/panel/api/805/" + r), null).then((x) => x.json());
for (let i = 0; i < 10; i++) await api("seguimiento-listo", { conv: "5493410009999" });
let auto = (await L.seguimientosAuto805(env)).map((x) => x.nombre);
chk("con 10 buenos salen solos los simples y no el del dueño", auto.includes("Ana") && auto.includes("Beto") && !auto.includes("Dani"));
await api("seguimiento-listo", { conv: "5493410009999", bien: false });
chk("un Mal vuelve a cero", (await L.seguimientosAuto805(env)).length === 0);
const rep = await (await L.apiLector(env, new Request("https://x/panel/api/805/seg-reporte"), new URL("https://x/panel/api/805/seg-reporte"), null)).json();
chk("reporte por situación con el registro", rep.buenos === 0 && rep.oferta === true && Array.isArray(rep.por_situacion));
// Cotización del panel con el número del cliente: queda ligada a su chat
const C = await import(pathToFileURL(path.join(dir, "cotizar.js")));
const conv2 = await C.vincularCotizacion(env, "+54 9 341 000-0001", "abc", 7, [{ cantidad: 20, nombre: "auriculares" }], 412);
chk("cotización vinculada al chat por el número", conv2 === "5493410000001" && /total USD 412/.test(db.prepare("SELECT dato FROM w_hito WHERE id='cotm:abc'").get().dato));
// Seguimientos escritos desde afuera (cuando la IA del worker no tiene cupo)
db.prepare("DELETE FROM kv WHERE k='seg_ia'").run();
const ext = await L.segExternos(env);
chk("externos: trae los que faltan con la charla", ext.faltan.length >= 2 && ext.faltan.some((x) => x.charla.length));
const conv0 = ext.faltan[0].conv;
await L.guardarSegExternos(env, [{ conv: conv0, situacion: 2, mensaje: "¡hola! 🙌 te armo el total?" }]);
const tras = await L.seguimientos(env);
chk("externos: queda revisado con el mensaje (sin ¿¡ ni emojis)", tras.some((x) => x.conv === conv0 && x.revisado && x.borrador === "hola! te armo el total?"));
console.log(`\nsim-seguimientos2: ${ok} ok, ${mal} fallas`); if (mal) throw new Error("simulations failed");
