// Página de Alibaba pegada entera: lee tramos, peso y medidas sin IA, y leerItems arma el producto aunque la IA no responda
import { leerPaginaPegada } from "../cotizador/src/cotizar.js";
let ok = 0, mal = 0; const chk = (n, c) => { c ? ok++ : (mal++, console.log("FALLA:", n)); };
const relleno = "Ships from China. Trade Assurance. Customization options. ".repeat(20);
const pag = `Alibaba.com Categories Sign in
Wireless Earbuds TWS T6 Bluetooth 5.3 Headphones With Charging Case
${relleno}
2 - 499 pieces
$3.80
500 - 1999 pieces
$3.20
>= 2000 pieces
$2.90
Min. order: 2 pieces
Packaging and delivery
Selling units: Single item
Single package size: 10X8X4 cm
Single gross weight: 0.120 kg
${relleno}`;
const r = leerPaginaPegada(pag);
chk("detecta página", r.es_pagina);
chk("3 tramos", r.tramos.length === 3 && r.tramos[0].desde === 2 && r.tramos[0].precio === 3.8 && r.tramos[2].desde === 2000 && r.tramos[2].precio === 2.9);
chk("peso", r.peso_kg === 0.12);
chk("medidas", /10X8X4 cm/i.test(r.medidas));
chk("mínimo", r.minimo === 2);
const g = leerPaginaPegada(pag.replace("0.120 kg", "350 g"));
chk("peso en gramos", g.peso_kg === 0.35);
chk("texto corto no es página", !leerPaginaPegada("quiero 100 de https://www.alibaba.com/product-detail/x.html").es_pagina);
// leerItems con IA caída
const { apiCotizar } = await import("../cotizador/src/cotizar.js");
const db = { prepare: () => ({ bind: () => ({ run: async () => ({}), first: async () => null, all: async () => ({ results: [] }) }), run: async () => ({}), first: async () => null, all: async () => ({ results: [] }) }), batch: async () => [], exec: async () => {} };
const h = { T: {}, iaJSON: async () => null, iaConImagenes: async () => null, leerPagina: async () => null };
const req = { method: "POST", json: async () => ({ texto: pag, indicaciones: "Cliente: Juan\nHonorarios 120\n300 unidades" }) };
const res = await apiCotizar({ DB: db }, req, new URL("https://x/panel/api/cotizar/leer"), "t", h);
const d = await res.json();
const it = d.items?.[0] || {};
chk("sin IA arma 1 producto", d.items?.length === 1);
chk("cantidad de indicaciones", it.cantidad === 300);
chk("precio por tramo (300 → 3.80)", it.precio === 3.8);
chk("peso de la página", it.peso === 0.12);
console.log(`sim-cotizar-pegado: ${ok} ok, ${mal} mal`); if (mal) process.exit(1);
