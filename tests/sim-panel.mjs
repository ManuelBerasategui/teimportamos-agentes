// Panel principal: el JS compila, pestañas Hoy · WhatsApp · Redes · Agente · Herramientas y "Para hacer hoy". Correr desde cotizador/.
import fs from "fs";
let ok = 0, mal = 0; const chk = (n, c) => { c ? ok++ : (mal++, console.log("FALLA:", n)); };
const src = fs.readFileSync("src/worker.js", "utf8");
const i = src.indexOf("const PANEL_APP = String.raw`"), j = src.indexOf("\n`;", i);
const html = eval("String.raw`" + src.slice(i + "const PANEL_APP = String.raw`".length, j) + "`");
for (const m of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) { try { new Function(m[1]); chk("js compila", true); } catch (e) { chk("js: " + e.message, false); } }
const nav = html.slice(html.indexOf('<nav class="tabs">'), html.indexOf("</nav>"));
chk("pestañas en orden", ["Hoy", "WhatsApp", "Redes", "Agente", "Herramientas"].map((t) => nav.indexOf('<span class="nl">' + t + "</span>")).every((x, k, a) => x > 0 && (!k || x > a[k - 1])));
chk("sin Pendientes, Cotizar ni Búsquedas sueltos", !nav.includes('data-v="pend"') && !nav.includes('href="/panel/cotizar"') && !nav.includes('href="/panel/busquedas"'));
chk("Para hacer hoy con sus 4 listas", html.includes('id="hacer"') && ["sin", "seg", "pend", "dms"].every((k) => html.includes('["' + k + '"')));
chk("Quién atiende y el gráfico por día siguen", html.includes('id="equipoBox"') && html.includes('id="g-dias"'));
chk("Herramientas lleva a cotizar y buscar", html.includes('id="v-herr"') && html.includes('href="/panel/cotizar"') && html.includes('href="/panel/busquedas"'));
chk("seguimientos con el mensaje listo", html.includes("/panel/api/asistente/seguimientos") && html.includes('"https://wa.me/" + c.conv'));
console.log(`sim-panel: ${ok} ok, ${mal} fallas`);
