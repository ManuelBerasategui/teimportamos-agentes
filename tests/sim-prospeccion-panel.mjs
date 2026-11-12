// Pestaña Prospección: la PC sube la planilla, el panel lista y edita sin que la próxima subida pise lo editado
import { DatabaseSync } from "node:sqlite";
import { syncProspectos, listarProspectos, editarProspecto } from "../cotizador/src/prospeccion.js";
let ok = 0, mal = 0; const chk = (n, c) => { c ? (ok++, console.log("✓ " + n)) : (mal++, console.log("FALLA: " + n)); };
const db = new DatabaseSync(":memory:");
const stmt = (sql, b = []) => ({ bind: (...x) => stmt(sql, x), run: async () => { db.prepare(sql).run(...b); return {}; }, first: async () => db.prepare(sql).get(...b) ?? null, all: async () => ({ results: db.prepare(sql).all(...b) }) });
const env = { DB: { prepare: (s) => stmt(s), batch: async (a) => { for (const x of a) await x.run(); } } };
const hoy = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
await syncProspectos(env, [
  { telefono: "5493411111111", negocio: "Barber A", rubro: "Barbería", estado: "enviado 11/11 14:05", respuesta: "el 14 te digo", temperatura: "neutro", recontacto: hoy, proximo_mensaje: "hola, pudieron verlo?" },
  { telefono: "5493412222222", negocio: "Zapas B", estado: "enviado 11/11 14:10" },
  { telefono: "5493413333333", negocio: "Sin estado" },
  { telefono: "5493414444444", negocio: "Fijo", estado: "sin whatsapp (v2)" }], "buko");
let d = await listarProspectos(env);
chk("sube solo las filas con estado", d.prospectos.length === 3);
chk("resumen: enviados, respondieron, para hoy y sin whatsapp", d.resumen.enviados === 2 && d.resumen.respondieron === 1 && d.resumen.paraHoy === 1 && d.resumen.sinWhatsapp === 1);
await editarProspecto(env, { tel: "5493411111111", temperatura: "caliente", hecho: true }, "manuel");
await syncProspectos(env, [{ telefono: "5493411111111", negocio: "Barber A", estado: "enviado 11/11 14:05", respuesta: "el 14 te digo", temperatura: "neutro", recontacto: hoy, proximo_mensaje: "hola, pudieron verlo?" }], "buko");
let a = (await listarProspectos(env)).prospectos.find((p) => p.tel === "5493411111111");
chk("lo editado en el panel no se pisa si no hay respuesta nueva", a.temperatura === "caliente" && a.recontacto === "" && /le escribí/.test(a.le_contestamos));
await syncProspectos(env, [{ telefono: "5493411111111", negocio: "Barber A", estado: "enviado 11/11 14:05", respuesta: "dale, pasame precio de 50 máquinas", temperatura: "caliente", recontacto: "2026-11-20", proximo_mensaje: "te paso el total" }], "buko");
a = (await listarProspectos(env)).prospectos.find((p) => p.tel === "5493411111111");
chk("con respuesta nueva se actualizan fecha y próximo mensaje", a.recontacto === "2026-11-20" && a.proximo_mensaje === "te paso el total" && a.quien === "buko");
console.log(`\nsim-prospeccion-panel: ${ok} ok, ${mal} fallas`); process.exit(mal ? 1 : 0);
