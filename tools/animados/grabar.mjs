// Graba un guion animado a MP4 vertical 1080x1920, cuadro por cuadro (sin saltos aunque la máquina sea lenta).
// Uso: node grabar.mjs guiones/01-dos-vendedores.js salida.mp4 [fps]
import { chromium } from "/opt/npm-tools/node_modules/playwright/index.mjs";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";

const [, , guion, salida = "salida.mp4", fpsArg] = process.argv;
const fps = +fpsArg || 30;
const dir = path.dirname(new URL(import.meta.url).pathname);
const browser = await chromium.launch({ executablePath: fs.existsSync("/opt/pw-browsers/chromium") ? undefined : undefined });
const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
await page.goto("file://" + path.join(dir, "motor.html"));
await page.addScriptTag({ content: fs.readFileSync(guion, "utf8") });
await page.evaluate(() => document.fonts.ready);
const total = await page.evaluate(() => GUION.total);
const n = Math.ceil(total * fps);
const ff = spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(fps), "-c:v", "mjpeg", "-i", "-",
  "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo", "-shortest",
  "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "medium", "-crf", "18", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", salida], { stdio: ["pipe", "inherit", "inherit"] });
for (let i = 0; i < n; i++) {
  const b64 = await page.evaluate((t) => { render(t); return document.getElementById("c").toDataURL("image/jpeg", 0.93).split(",")[1]; }, i / fps);
  if (!ff.stdin.write(Buffer.from(b64, "base64"))) await new Promise((r) => ff.stdin.once("drain", r));
  if (i % 60 === 0) process.stdout.write(`\r${Math.round((i / n) * 100)}%`);
}
ff.stdin.end();
await new Promise((r) => ff.on("close", r));
await browser.close();
console.log(`\rListo: ${salida} (${total.toFixed(1)} s, ${n} cuadros)`);
