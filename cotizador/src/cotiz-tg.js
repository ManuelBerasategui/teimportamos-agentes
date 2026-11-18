// ============================================================================
// COTIZACIONES POR TELEGRAM: el dueño aprueba con un toque y el agente de la PC la manda.
// ----------------------------------------------------------------------------
// Cuando el cotizador automático (autocot.js) termina una cotización de un cliente, llega por Telegram con el resumen
// y botones:
//   ✅ Mandala      → queda aprobada; el agente de la PC (responder.py) le escribe al cliente en su próxima vuelta
//   ✏️ La mando yo  → abre el WhatsApp del cliente con el mensaje escrito
//   ❌ No va        → se descarta
//   📝 Corregir     → la abre en el panel (pestaña Cotizar) para cambiar cantidad, FOB o peso
// Al cliente le llega un mensaje corto con un link a la cotización (/q/...): misma cuenta que el panel, sin adjuntar
// archivos en WhatsApp Web (lo más frágil de automatizar). Desde ese link el cliente la puede guardar en PDF.
// Si faltan datos, también avisa qué falta, con el botón para completarla.
// ============================================================================
import { textoResultado } from "./autocot.js";

const BASE = (env) => (env.PUBLIC_URL || "https://cotizador.berasateguimanuel07.workers.dev").replace(/\/$/, "");
const kvGet = async (env, k) => (await env.DB.prepare("SELECT v FROM kv WHERE k=?").bind(k).first().catch(() => null))?.v ?? null;
const esc = (t) => String(t ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const usd = (n) => "USD " + Number(n || 0).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nid = () => [...crypto.getRandomValues(new Uint8Array(8))].map((b) => b.toString(16).padStart(2, "0")).join("");

let listo = false;
export async function prepararCotTg(env) {
  if (listo) return;
  for (const c of ["pub TEXT", "aprobado_ts INTEGER", "enviado_ts INTEGER", "texto TEXT", "aviso_tg TEXT"]) await env.DB.prepare("ALTER TABLE autocot ADD COLUMN " + c).run().catch(() => {});
  listo = true;
}
export async function firmaCot(env, pub) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("cot:" + pub + ":" + (env.VERIFY_TOKEN || env.LECTOR_TOKEN || "")));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("").slice(0, 16);
}
export async function linkCot(env, pub) { return `${BASE(env)}/q/${pub}/${await firmaCot(env, pub)}`; }

async function tg(env, metodo, body) {
  if (env.__tg) { env.__tg.push({ metodo, ...body }); return { ok: true, result: { message_id: env.__tg.length } }; }
  return fetch(`https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/${metodo}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json()).catch(() => null);
}
const chatDueno = async (env) => env.TELEGRAM_CHAT || (await kvGet(env, "telegram_chat"));
const productos = (items) => items.filter((i) => i.cantidad > 0).map((i) => i.nombre || "producto").slice(0, 3).join(", ").slice(0, 120);
// El mensaje para el cliente: corto, sin números (están en el link), en el tono del negocio
export function textoCliente(nombre, items, link) {
  const n = String(nombre || "").trim().split(/\s+/)[0];
  const que = productos(items);
  return `${n ? "Hola " + n + "! " : "Hola! "}Ya tengo tu cotización${que ? " de " + que : ""}, con el costo puesto en Argentina: ${link}\nAhí ves el detalle de cada producto y el total. Cualquier duda me decís y si te cierra arrancamos.`;
}

// Avisa por Telegram una cotización nueva (o que cambió). No repite el aviso si el estado y el total son los mismos.
export async function avisarCotizacion(env, id) {
  if (!env.TELEGRAM_TOKEN) return null;
  await prepararCotTg(env);
  const f = await env.DB.prepare("SELECT * FROM autocot WHERE id=?").bind(id).first();
  if (!f?.conv || f.enviado_ts || f.estado === "descartada") return null;   // las pegadas a mano en el panel no tienen cliente
  const clave = `${f.estado}:${f.total ?? ""}`;
  if (f.aviso_tg === clave) return null;
  const chat = await chatDueno(env); if (!chat) return null;
  let items = [], det = {}; try { items = JSON.parse(f.items || "[]"); det = JSON.parse(f.detalle || "{}"); } catch {}
  const pub = f.pub || nid(), link = await linkCot(env, pub), quien = `${f.nombre || "Cliente"} (+${f.conv})`;
  const texto = f.estado === "lista" ? textoCliente(f.nombre, items, link) : "";
  let msg, botones;
  if (f.estado === "lista") {
    msg = `🧾 Cotización lista para ${quien}\n${textoResultado(det)}${(det.avisos || []).length ? "\n⚠️ " + det.avisos.join("; ") : ""}\n\nLe mandaría:\n${texto}`;
    botones = [[{ text: "✅ Mandala", callback_data: "cot:ok:" + pub }, { text: "❌ No va", callback_data: "cot:no:" + pub }],
      [{ text: "✏️ La mando yo", url: `https://wa.me/${f.conv}?text=${encodeURIComponent(texto)}` }, { text: "👀 Ver", url: link }],
      [{ text: "📝 Corregir en el panel", url: `${BASE(env)}/panel#cot` }]];
  } else {
    msg = `🧾 Cotización de ${quien}: no la pude terminar.\nFalta: ${f.falta || "datos"}.\nCompletala en el panel (pestaña Cotizar) y te la vuelvo a pasar lista para mandar.`;
    botones = [[{ text: "📝 Completar en el panel", url: `${BASE(env)}/panel#cot` }, { text: "💬 Abrir el chat", url: `https://wa.me/${f.conv}` }]];
  }
  const r = await tg(env, "sendMessage", { chat_id: chat, text: msg.slice(0, 4000), disable_web_page_preview: true, reply_markup: { inline_keyboard: botones } });
  if (!r?.ok) return null;
  await env.DB.prepare("UPDATE autocot SET pub=?, texto=?, aviso_tg=? WHERE id=?").bind(pub, texto, clave, id).run();
  return { pub, link };
}

// Botones ✅ / ❌ (callback "cot:ok:<pub>" / "cot:no:<pub>"), solo desde un chat conectado al panel
export async function botonCotizacion(env, cb, conocidos) {
  await prepararCotTg(env);
  const [, accion, pub] = String(cb.data || "").split(":");
  const chat = String(cb.message?.chat?.id || cb.from?.id || "");
  const f = conocidos[chat] && /^[0-9a-f]{16}$/.test(pub || "") ? await env.DB.prepare("SELECT id, nombre, enviado_ts, estado FROM autocot WHERE pub=?").bind(pub).first() : null;
  let aviso = "Este chat no está conectado al panel", estado = "";
  if (f && f.enviado_ts) aviso = estado = "Esa cotización ya se mandó";
  else if (f && accion === "ok") { await env.DB.prepare("UPDATE autocot SET aprobado_ts=? WHERE id=?").bind(Date.now(), f.id).run(); aviso = "Listo: la manda el agente de la PC en su próxima vuelta"; estado = "✅ Aprobada: la manda el agente de la PC (te aviso cuando salga)."; }
  else if (f && accion === "no") { await env.DB.prepare("UPDATE autocot SET estado='descartada', aprobado_ts=NULL WHERE id=?").bind(f.id).run(); aviso = "Descartada"; estado = "❌ Descartada."; }
  await tg(env, "answerCallbackQuery", { callback_query_id: cb.id, text: aviso });
  if (estado && cb.message?.message_id) await tg(env, "editMessageText", { chat_id: cb.message.chat.id, message_id: cb.message.message_id, text: (String(cb.message.text || "") + "\n\n" + estado).slice(0, 4000), disable_web_page_preview: true });
}

// Para la PC: cotizaciones aprobadas que todavía no salieron (de los últimos 3 días)
export async function enviosPendientes(env) {
  await prepararCotTg(env);
  return ((await env.DB.prepare("SELECT pub, conv, nombre, texto FROM autocot WHERE aprobado_ts IS NOT NULL AND enviado_ts IS NULL AND estado='lista' AND conv<>'' AND texto<>'' AND aprobado_ts>=? ORDER BY aprobado_ts LIMIT 5").bind(Date.now() - 3 * 86400e3).all().catch(() => ({ results: [] }))).results || [])
    .map((f) => ({ id: f.pub, conv: f.conv, nombre: f.nombre || "", texto: f.texto }));
}
// La PC avisa cómo le fue: salió (ok) o no pudo (queda para mandar a mano, con el botón)
export async function resultadoEnvio(env, pub, ok, motivo = "") {
  await prepararCotTg(env);
  const f = await env.DB.prepare("SELECT id, conv, nombre, texto FROM autocot WHERE pub=?").bind(String(pub || "")).first();
  if (!f) return null;
  if (ok) await env.DB.prepare("UPDATE autocot SET enviado_ts=? WHERE id=?").bind(Date.now(), f.id).run();
  else await env.DB.prepare("UPDATE autocot SET aprobado_ts=NULL WHERE id=?").bind(f.id).run();
  const chat = await chatDueno(env);
  if (chat && env.TELEGRAM_TOKEN) await tg(env, "sendMessage", ok
    ? { chat_id: chat, text: `✅ Se mandó la cotización a ${f.nombre || "+" + f.conv}.`, disable_web_page_preview: true }
    : { chat_id: chat, text: `⚠️ No pude mandarle la cotización a ${f.nombre || "+" + f.conv}${motivo ? " (" + String(motivo).slice(0, 120) + ")" : ""}. Mandala vos:`, reply_markup: { inline_keyboard: [[{ text: "✏️ Abrir WhatsApp con el mensaje", url: `https://wa.me/${f.conv}?text=${encodeURIComponent(f.texto || "")}` }]] } });
  return f.conv;
}

// GET /q/<pub>/<firma>: la cotización que ve el cliente (sin iniciar sesión; el link va firmado)
export async function paginaCotPublica(env, pub, firma) {
  await prepararCotTg(env);
  const no = () => new Response("Esta cotización no existe o el link está incompleto.", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  if (!/^[0-9a-f]{16}$/.test(pub || "") || firma !== (await firmaCot(env, pub))) return no();
  const f = await env.DB.prepare("SELECT * FROM autocot WHERE pub=?").bind(pub).first();
  if (!f || f.estado !== "lista") return no();
  let c = {}; try { c = JSON.parse(f.detalle || "{}"); } catch {}
  const fecha = new Date(f.ts - 3 * 3600e3).toISOString().slice(0, 10).split("-").reverse().join("/");
  const filas = (c.items || []).map((i) => `<tr><td class="pr">${esc(i.nombre || "Producto")}</td><td class="n" data-l="Cantidad">${i.cantidad}</td><td class="n" data-l="FOB c/u">${usd(i.fob)}</td><td class="n" data-l="Puesto en Argentina c/u"><b>${usd(i.unitario)}</b></td><td class="n" data-l="Subtotal">${usd(i.subtotal)}</td></tr>`).join("");
  const linea = (t, v) => (v ? `<tr><td>${t}</td><td class="n">${usd(v)}</td></tr>` : "");
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Cotización · Te Importamos</title>
<style>body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#F4F4F5;color:#111827;margin:0;padding:16px}main{max-width:760px;margin:0 auto;background:#fff;border-radius:14px;padding:22px;border:1px solid #E5E7EB}
h1{font-size:20px;margin:0}.m{color:#6B7280;font-size:13.5px;margin:4px 0 16px}table{width:100%;border-collapse:collapse;font-size:14px;margin:8px 0}th,td{text-align:left;padding:8px 6px;border-bottom:1px solid #F0F1F3}th{color:#6B7280;font-weight:600;font-size:12.5px}.n{text-align:right;white-space:nowrap}
.tot{background:#FFF4EC;border:1px solid #FBD5BC;border-radius:12px;padding:14px;margin:14px 0}.tot b{font-size:22px}.p{font-size:13px;color:#4B5563;line-height:1.5}button{background:#EA5B0C;color:#fff;border:0;border-radius:9px;padding:10px 16px;font-weight:600;font-size:14px;cursor:pointer}
@media (max-width:560px){.it tr:first-child{display:none}.it tr{display:block;border-bottom:1px solid #F0F1F3;padding:8px 0}.it td{display:flex;justify-content:space-between;border:0;padding:3px 2px}.it td.pr{font-weight:600}.it td[data-l]::before{content:attr(data-l);color:#6B7280}}@media print{body{background:#fff;padding:0}main{border:0}button{display:none}}</style></head><body><main>
<h1>Cotización · Te Importamos</h1><div class="m">${esc(f.nombre || "")}${f.nombre ? " · " : ""}${fecha} · importación por encargo, nos encargamos de todo</div>
<div><table class="it"><tr><th>Producto</th><th class="n">Cantidad</th><th class="n">FOB c/u</th><th class="n">Puesto en Argentina c/u</th><th class="n">Subtotal</th></tr>${filas}</table></div>
<div class="tot">Total puesto en Argentina: <b>${usd(c.total)}</b>${c.totalArs ? ` <span class="m">(~$${Number(c.totalArs).toLocaleString("es-AR")})</span>` : ""}<div class="p">Envío por ${c.via === "maritimo" ? "barco" : "avión"} · llega en ${esc(c.plazo || "-")}${c.sena ? ` · para arrancar se deja una seña de ${usd(c.sena)}` : ""}</div></div>
<table>${linea("Mercadería (FOB)", c.fob)}${linea("Flete" + (c.kg ? ` (${c.kg} kg)` : ""), c.flete)}${linea("Handling", c.handling)}${linea(`Impuestos (${c.impuestosPct}%)`, c.impuestos)}${linea("Honorarios", c.honorarios)}${linea("Despachante", c.despachante)}${linea("Gastos fijos", c.gastosFijos)}</table>
<p class="p">Precios del proveedor al ${fecha}. El total puede variar un poco si el proveedor cambia el precio o confirma otro peso. ${c.dolar ? "Pesos calculados con el dólar del día." : ""}</p>
<button onclick="print()">Guardar en PDF</button></main></body></html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
}
