// Saca PNG de cada diseño HTML (1080x1350, el div #slide o .s). Se corre en GitHub (allá hay internet para las fotos).
import { chromium } from "playwright";
import fs from "fs"; import path from "path";
const dir = path.dirname(new URL(import.meta.url).pathname), out = process.argv[2] || "salida";
fs.mkdirSync(out, { recursive: true });
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1080, height: 1350 } });
for (const f of fs.readdirSync(dir + "/disenos").filter((x) => x.endsWith(".html"))) {
  await p.goto("file://" + dir + "/disenos/" + f, { waitUntil: "networkidle" }); await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(800);
  const els = await p.locator(".s").all();
  for (let i = 0; i < els.length; i++) await els[i].screenshot({ path: `${out}/${f.replace(".html", "")}${els.length > 1 ? "-" + String(i + 1).padStart(2, "0") : ""}.png` });
  console.log(f, els.length);
}
await b.close();
