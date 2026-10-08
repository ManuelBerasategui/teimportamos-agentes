// Cotizador manual desde links: lectura, cálculo, guardado y página PDF
import { DatabaseSync } from "node:sqlite";
import fs from "fs";
fs.copyFileSync("src/cotizar.js", "/tmp/cotizar.js");
const { apiCotizar, paginaCotizacion, calcular, PANEL_COTIZAR } = await import("/tmp/cotizar.js");
const db = new DatabaseSync(":memory:");
const stmt = (sql, b=[]) => ({ bind:(...x)=>stmt(sql,x), run: async()=>{db.prepare(sql).run(...b);return{}}, first: async()=>db.prepare(sql).get(...b)??null, all: async()=>({results:db.prepare(sql).all(...b)}) });
const env = { DB: { prepare:(s)=>stmt(s) } };
const T = { fleteKg: 18, handling: 30, honorarios: 80, factor: 1.3, aereoFijo: 950, aereoDesde: 50, aereoHasta: 250, barcoFijo: 100 };
let ok = 0, mal = 0; const chk = (n, c) => { c ? ok++ : (mal++, console.log("FALLA:", n)); };
const L1 = "https://www.alibaba.com/product-detail/LED-Light-Box_1600123456789.html", L2 = "https://www.alibaba.com/product-detail/NFC-Card_1600987654321.html";
const h = { T,
  leerPagina: async (l) => l === L1 ? { datos: { nombre: "LED Light Box", tramos: [{ desde: 10, precio: 12 }, { desde: 100, precio: 9 }], peso_kg: 2 } } : { bloqueado: true, datos: { nombre: "NFC Card" } },
  iaJSON: async (_e, p) => p.startsWith("Estimá") ? { pesos: [0.01] } : { items: [{ link: L1, nombre: "Caja de luz LED", cantidad: 120 }, { link: L2, nombre: "Tarjetas NFC", cantidad: 500 }], cliente: "Juan", honorarios: 120, notas_pdf: "Plazo 30 a 45 días" },
  iaConImagenes: async () => null };
const api = (p, b) => apiCotizar(env, new Request("https://x/panel/api/cotizar/" + p, b ? { method: "POST", body: JSON.stringify(b) } : {}), new URL("https://x/panel/api/cotizar/" + p), "manuel", h).then((r) => r.json());
const r = await api("leer", { texto: `${L1} x120\n${L2} 500 unidades`, indicaciones: "Cliente Juan, honorarios 120" });
chk("2 items", r.items.length === 2); chk("tramo 100+", r.items[0].precio === 9); chk("peso pag", r.items[0].peso === 2);
chk("bloqueado sin precio", r.items[1].bloqueado && r.items[1].precio === 0); chk("peso estimado", r.items[1].peso === 0.01 && r.items[1].peso_estimado);
chk("cliente/hon", r.cliente === "Juan" && r.honorarios === 120);
r.items[1].precio = 0.2;
const c = calcular(r.items, { honorarios: 120 }, T);
// fob = 1080 + 100 = 1180; kg = 240 + 5 = 245 -> flete 950; total = (1180+950+30)*1.3+120
chk("total", Math.abs(c.total - ((1180 + 950 + 30) * 1.3 + 120)) < 1e-6);
chk("suma subtotales = total", Math.abs(c.filas.reduce((s, f) => s + f.subtotal, 0) - c.total) < 1e-6);
const g = await api("guardar", { cliente: "Juan", items: r.items, honorarios: 120, notas: "Plazo 30 a 45 días" });
chk("guardado num 1", g.ok && g.num === 1);
const g2 = await api("guardar", { cliente: "Ana", items: [{ nombre: "x", cantidad: 1, precio: 10, peso: 1 }] }); chk("num 2", g2.num === 2);
chk("sin cantidad -> error", !!(await api("guardar", { items: [{ nombre: "x", cantidad: 0 }] })).error);
const l = await api("lista"); chk("lista 2", l.length === 2);
const pg = await (await paginaCotizacion(env, g.id, T)).text();
chk("pdf html", pg.includes("Cotización N° 1") && pg.includes("Juan") && pg.includes("Caja de luz LED") && pg.includes("Plazo 30 a 45"));
await api("borrar", { id: g2.id }); chk("borrar", (await api("lista")).length === 1);
chk("panel html", PANEL_COTIZAR.includes("/panel/api/cotizar/leer"));
const sc = PANEL_COTIZAR.match(/<script>([\s\S]*)<\/script>/)[1]; try { new Function(sc); chk("js ok", true); } catch (e) { chk("js: " + e.message, false); }
console.log(`sim15: ${ok} ok, ${mal} fallas`);
