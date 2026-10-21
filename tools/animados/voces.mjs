// Saca las frases de voz ("voz") de cada escena de un guion, para que piper las grabe.
// Uso: node voces.mjs guiones/01-dos-vendedores.js carpeta_salida
import fs from "fs";
import vm from "vm";

const [, , guion, dir] = process.argv;
let escenas = [];
const ctx = { cargar: (g) => { escenas = g.escenas; return 0; }, console };
vm.runInNewContext(fs.readFileSync(guion, "utf8"), ctx);
fs.mkdirSync(dir, { recursive: true });
const lineas = escenas.map((e, i) => ({ i, voz: String(e.voz || "").trim() })).filter((x) => x.voz);
fs.writeFileSync(dir + "/lineas.json", JSON.stringify(lineas, null, 1));
console.log(`${lineas.length} frases de voz`);
