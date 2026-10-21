// Graba un guion animado a MP4 vertical 1080x1920, cuadro por cuadro (sin saltos aunque la máquina sea lenta).
// Uso: node grabar.mjs guiones/01-dos-vendedores.js salida.mp4 [fps] [carpeta_voces]
// Con carpeta de voces (tiempos.json + voz_N.wav): cada escena dura lo que dura su frase, y la voz va pegada a la escena.
const PW = ["/opt/npm-tools/node_modules/playwright/index.mjs", "playwright"];
let chromium; for (const m of PW) { try { ({ chromium } = await import(m)); break; } catch {} }
import { spawn } from "child_process";
import fs from "fs";
import path from "path";

const [, , guion, salida = "salida.mp4", fpsArg, voces] = process.argv;
const fps = +fpsArg || 30;
const dir = path.dirname(new URL(import.meta.url).pathname);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
await page.goto("file://" + path.join(dir, "motor.html"));
await page.addScriptTag({ content: fs.readFileSync(guion, "utf8") });
await page.evaluate(() => document.fonts.ready);
const tiempos = voces && fs.existsSync(voces + "/tiempos.json") ? JSON.parse(fs.readFileSync(voces + "/tiempos.json", "utf8")) : null;
if (tiempos) await page.evaluate((tp) => { GUION.escenas.forEach((e, i) => { if (tp[i]) e.dur = Math.max(e.dur, tp[i] + 0.45); }); cargar(GUION); }, tiempos);
const total = await page.evaluate(() => GUION.total);
const inicios = await page.evaluate(() => GUION.escenas.map((e) => e.ini));
// pista de voz: cada frase arranca 0,15 s después de que empieza su escena
let audio = ["-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo"];
if (tiempos) {
  const wavs = Object.keys(tiempos).map(Number).sort((a, b) => a - b), pista = salida.replace(/\.mp4$/, "") + "_voz.wav";
  const ent = wavs.flatMap((i) => ["-i", `${voces}/voz_${i}.wav`]);
  const fil = wavs.map((i, k) => `[${k}]aresample=44100,adelay=${Math.round((inicios[i] + 0.15) * 1000)}:all=1[a${k}]`).join(";") + ";" + wavs.map((_, k) => `[a${k}]`).join("") + `amix=inputs=${wavs.length}:normalize=0,apad,atrim=0:${total.toFixed(2)}[out]`;
  await new Promise((ok, no) => spawn("ffmpeg", ["-y", "-loglevel", "error", ...ent, "-filter_complex", fil, "-map", "[out]", "-ac", "2", pista], { stdio: "inherit" }).on("close", (c) => (c ? no(new Error("ffmpeg voz")) : ok())));
  audio = ["-i", pista];
}
const n = Math.ceil(total * fps);
const ff = spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(fps), "-c:v", "mjpeg", "-i", "-",
  ...audio, "-shortest",
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
