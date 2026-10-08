// Uso: node informes/pdf.mjs carpeta_salida  → convierte informe.html en <nombre>.pdf
import { createRequire } from "module"; import fs from "fs"; import path from "path";
const dir = path.resolve(process.argv[2]); const base = fs.readFileSync(path.join(dir, "nombre.txt"), "utf8").trim().replace("Proveedores-", "Informe-Proveedores-");
let pw; for (const r of ["/opt/npm-tools/node_modules/", process.cwd() + "/"]) { try { pw = createRequire(r)("playwright"); break; } catch {} }
const b = await pw.chromium.launch(); const p = await b.newPage();
await p.goto("file://" + path.join(dir, "informe.html")); await p.pdf({ path: path.join(dir, base + ".pdf"), format: "A4", printBackground: true }); await b.close();
console.log(path.join(dir, base + ".pdf"));
