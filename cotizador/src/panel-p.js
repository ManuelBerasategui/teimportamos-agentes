// Panel nuevo (/panel/p): Hoy · Chats · Números · Links · Agente. Datos en tablero.js.
export const PANEL_P = String.raw`<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Te Importamos</title>
<style>
:root{--bg:#f4f1ec;--card:#fff;--tx:#1b1916;--mu:#76705f;--li:#e6e0d6;--ac:#e8590c;--ac2:#ff922b;--ok:#2b8a3e;--bad:#c92a2a;--warn:#e67700;--chip:#f3eee6;--sh:0 1px 2px #0000000d,0 6px 18px #0000000a;
 --c-recordatorio:#fab005;--c-venta:#7048e8;--c-pago:#2b8a3e;--c-cotizado:#e8590c;--c-cotizar:#f59f00;--c-llamar:#1c7ed6;--c-consulta:#0ca678;--c-seguimiento:#868e96}
:root[data-t="d"],:root:not([data-t="l"]){color-scheme:light dark}
@media (prefers-color-scheme:dark){:root:not([data-t="l"]){--bg:#121110;--card:#1c1a17;--tx:#f1ede6;--mu:#a49d90;--li:#2f2b26;--chip:#26231f;--sh:0 1px 2px #0006}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--tx);font:15px/1.5 "Inter",system-ui,-apple-system,Segoe UI,Roboto,sans-serif;-webkit-font-smoothing:antialiased}
header{position:sticky;top:0;z-index:5;background:color-mix(in srgb,var(--bg) 88%,transparent);backdrop-filter:blur(10px);border-bottom:1px solid var(--li)}
.hw{max-width:1000px;margin:0 auto;padding:10px 16px;display:flex;gap:14px;align-items:center;flex-wrap:wrap}
.logo{font-weight:900;letter-spacing:.3px;font-size:17px;display:flex;align-items:center;gap:8px}.logo i{width:26px;height:26px;border-radius:8px;background:linear-gradient(135deg,var(--ac),var(--ac2));display:inline-block;box-shadow:0 3px 10px #e8590c55}.logo span{color:var(--ac)}
nav{display:flex;gap:2px;flex-wrap:wrap;background:var(--chip);padding:3px;border-radius:11px}nav button{border:0;background:none;color:var(--mu);padding:6px 12px;border-radius:9px;font:inherit;font-size:14px;font-weight:600;cursor:pointer}
nav button.on{background:var(--card);color:var(--tx);box-shadow:var(--sh)}
.viejo{margin-left:auto;color:var(--mu);font-size:12px}
main{max-width:1000px;margin:0 auto;padding:16px 16px 70px}
.est{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px}.pill{background:var(--card);border:1px solid var(--li);border-radius:20px;padding:4px 11px;font-size:12.5px}
.pill.ok::before,.pill.bad::before,.pill.warn::before{content:"";display:inline-block;width:7px;height:7px;border-radius:50%;margin-right:6px;vertical-align:1px}
.pill.ok::before{background:var(--ok)}.pill.bad::before{background:var(--bad)}.pill.warn::before{background:var(--warn)}
h2{font-size:13px;text-transform:uppercase;letter-spacing:.6px;color:var(--mu);margin:26px 0 10px;display:flex;gap:8px;align-items:center}h2 .n{background:var(--k,var(--ac));color:#fff;border-radius:20px;padding:1px 8px;font-size:11.5px;letter-spacing:0}
h2::before{content:"";width:10px;height:10px;border-radius:3px;background:var(--k,var(--ac))}
.card{background:var(--card);border:1px solid var(--li);border-radius:14px;padding:12px 14px;margin-bottom:9px;box-shadow:var(--sh)}
[data-cat]{border-left:4px solid var(--k,var(--li))}
.nota{margin-top:7px;background:color-mix(in srgb,#fab005 16%,var(--card));border-radius:8px;padding:6px 9px;font-size:13.5px}
.borr[data-copiar]{cursor:pointer}.borr[data-copiar]:hover{border-color:var(--ac)}
.tel{font-weight:800;font-size:15.5px;cursor:pointer;border-radius:6px;padding:0 4px;margin:0 -4px;transition:background .15s,color .15s}.tel:hover{background:var(--chip);color:var(--ac)}.tel.ok{color:var(--ok)}
.top{display:flex;gap:8px;flex-wrap:wrap;align-items:baseline}.top b{font-size:15.5px}.mu{color:var(--mu);font-size:13px}.tag{background:var(--chip);border-radius:6px;padding:1px 7px;font-size:12px;font-weight:600}
.que{margin-top:5px;font-weight:500}.ult{color:var(--mu);font-size:13px;margin-top:3px;font-style:italic}
.borr{margin-top:8px;background:var(--chip);border-radius:10px;padding:8px 10px;font-size:13px;white-space:pre-wrap;border:1px dashed var(--li)}
.acc{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px}
.b{border:1px solid var(--li);background:var(--card);color:var(--tx);border-radius:9px;padding:6px 12px;font:inherit;font-size:13px;font-weight:600;cursor:pointer;text-decoration:none;transition:transform .08s}.b:active{transform:scale(.97)}
.b.p{background:linear-gradient(135deg,var(--ac),var(--ac2));border-color:transparent;color:#fff}.b.v{color:var(--ok)}.b.x{color:var(--bad)}
.vacio{color:var(--mu);padding:24px 0;text-align:center}
.eq{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:9px}.eq .card{margin:0}.eq .card b{font-size:28px;display:block;line-height:1.2;font-weight:800}
.kp{font-size:11.5px;text-transform:uppercase;letter-spacing:.5px;color:var(--mu);font-weight:700}
table{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--li);border-radius:14px;overflow:hidden;font-size:14px;box-shadow:var(--sh)}
th,td{padding:8px 10px;border-bottom:1px solid var(--li);text-align:right;white-space:nowrap}th:first-child,td:first-child{text-align:left}th{color:var(--mu);font-weight:700;font-size:11.5px;text-transform:uppercase;letter-spacing:.4px;background:var(--chip)}
tr:last-child td{border-bottom:0}
.tw{overflow-x:auto;margin-bottom:6px}
input,select,textarea{font:inherit;border:1px solid var(--li);background:var(--card);color:var(--tx);border-radius:10px;padding:9px 11px;width:100%}
input:focus,select:focus,textarea:focus{outline:2px solid color-mix(in srgb,var(--ac) 40%,transparent);border-color:var(--ac)}
.fila{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:8px;margin-bottom:8px}
.modal{position:fixed;inset:0;background:#0008;display:none;align-items:center;justify-content:center;padding:16px;z-index:20}.modal.on{display:flex}
.modal .card{width:100%;max-width:440px}.modal label{font-size:13px;color:var(--mu);display:block;margin:9px 0 3px}
.seg{display:inline-flex;background:var(--chip);border-radius:10px;padding:3px}.seg button{border:0;background:none;padding:5px 13px;border-radius:8px;font:inherit;font-weight:600;color:var(--mu);cursor:pointer}.seg button.on{background:var(--card);color:var(--tx);box-shadow:var(--sh)}
.hilo{display:flex;flex-direction:column;gap:8px;margin-bottom:10px}.msg{max-width:85%;padding:10px 13px;border-radius:14px;white-space:pre-wrap}.msg.u{align-self:flex-end;background:linear-gradient(135deg,var(--ac),var(--ac2));color:#fff}.msg.a{align-self:flex-start;background:var(--card);border:1px solid var(--li)}
#consejo{background:linear-gradient(135deg,color-mix(in srgb,var(--ac) 9%,var(--card)),var(--card));border-color:color-mix(in srgb,var(--ac) 30%,var(--li))}#consejo>b{font-size:15px}
.cons{white-space:pre-wrap;color:var(--tx);margin-top:6px}
.link{font-size:12px;word-break:break-all;color:var(--mu)}
.toast{position:fixed;bottom:18px;left:50%;transform:translateX(-50%);background:var(--tx);color:var(--bg);padding:9px 15px;border-radius:10px;display:none;z-index:30;font-weight:600}
@media (max-width:560px){.viejo{display:none}nav button{padding:6px 9px;font-size:13px}}
</style></head><body>
<header><div class="hw"><div class="logo"><i></i>TE <span>IMPORTAMOS</span></div>
<nav id="tabs"><button data-v="hoy" class="on">Hoy</button><button data-v="chats">Chats y ventas</button><button data-v="num">Números</button><button data-v="links">Links</button><button data-v="ag">Agente</button></nav>
<a class="viejo" href="/panel/viejo">panel viejo</a></div></header>
<main>
<section id="v-hoy"><div class="est" id="estado"></div><div class="card" id="consejo"><b>Lo que dicen los datos</b><div class="mu" id="consTxt">Cargando…</div><div class="acc"><button class="b" id="consBtn">Actualizar análisis</button></div></div><div class="eq" id="equipoHoy"></div><div id="lista"><div class="vacio">Cargando…</div></div></section>
<section id="v-chats" hidden>
 <div class="fila"><input id="q" placeholder="Buscar chat por nombre, número o producto"><button class="b p" id="ventaSuelta">Registrar venta sin chat</button></div>
 <div id="res"></div><h2>Ventas registradas</h2><div id="ventas"></div>
</section>
<section id="v-num" hidden>
 <div class="seg" id="per"><button data-p="dia">Día</button><button data-p="semana" class="on">Semana</button><button data-p="mes">Mes</button></div>
 <h2>Resultados</h2><div class="tw" id="tRes"></div>
 <h2>Plata por línea de negocio</h2><div class="tw" id="tLin"></div>
 <h2>De dónde vinieron los chats nuevos</h2><div class="tw" id="tOri"></div>
 <h2>Chats contestados por persona</h2><div class="tw" id="tEq"></div>
 <h2>Por día (últimos 31)</h2><div class="tw" id="tDias"></div>
 <h2>Dispositivos</h2><p class="mu">Cada vez que alguien vincula de nuevo el WhatsApp aparece un dispositivo nuevo. Asignalo una vez y se recalcula todo el historial.</p><div id="disp"></div>
</section>
<section id="v-links" hidden>
 <p class="mu">Creá un link para cada historia, anuncio, bio o campaña. Cuando alguien escribe desde ese link, el chat queda marcado con su origen y lo ves en Números.</p>
 <div class="card"><div class="fila"><input id="lNom" placeholder="Nombre (ej. historia cupo noviembre)"><select id="lCan"></select></div>
 <input id="lTxt" placeholder="Mensaje que le aparece escrito al cliente (opcional)"><div class="acc"><button class="b p" id="lCrear">Crear link</button></div><div id="lNuevo"></div></div>
 <div id="lLista"></div>
</section>
<section id="v-ag" hidden>
 <p class="mu">Preguntale lo que quieras del negocio. Ve los números reales: chats, cotizaciones, ventas cargadas, equipo, redes.</p>
 <div class="hilo" id="hilo"></div>
 <div class="fila"><textarea id="agQ" rows="2" placeholder="Ej: por qué esta semana vendimos menos que la anterior?"></textarea></div><button class="b p" id="agEnv">Preguntar</button>
</section>
</main>
<div class="modal" id="mod"><div class="card" id="modC"></div></div><div class="toast" id="toast"></div>
<script>
var $ = function (s) { return document.querySelector(s); };
function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
function api(p, body) { return fetch("/panel/p/api/" + p, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}).then(function (r) { if (r.status === 401) { location.href = "/login?volver=/panel/p"; } return r.json(); }); }
function toast(t) { var e = $("#toast"); e.textContent = t; e.style.display = "block"; setTimeout(function () { e.style.display = "none"; }, 2200); }
function telFmt(c) { c = String(c || ""); var m = c.match(/^549(\d{2,4})(\d{6,8})$/); return "+" + (m ? "54 9 " + m[1] + " " + m[2].slice(0, -4) + "-" + m[2].slice(-4) : c); }
document.addEventListener("click", function (e) { var t = e.target.closest("[data-tel]"); if (!t) return; var n = "+" + t.dataset.tel;
  (navigator.clipboard ? navigator.clipboard.writeText(n) : Promise.reject()).then(function () { t.classList.add("ok"); setTimeout(function () { t.classList.remove("ok"); }, 900); toast("Número copiado"); }).catch(function () { prompt("Número:", n); }); });
function plata(n) { return Math.round(n || 0).toLocaleString("es-AR"); }
function hace(h) { return h < 1 ? "recién" : h < 48 ? "hace " + h + " h" : "hace " + Math.round(h / 24) + " días"; }
var LINEAS = [], DATA = null;
api("lineas").then(function (r) { LINEAS = r.lineas || []; });

// ---- pestañas
var cargado = {};
$("#tabs").addEventListener("click", function (e) { var b = e.target.closest("button"); if (!b) return; ver(b.dataset.v); });
function ver(v) {
  [].forEach.call(document.querySelectorAll("#tabs button"), function (x) { x.classList.toggle("on", x.dataset.v === v); });
  [].forEach.call(document.querySelectorAll("main section"), function (s) { s.hidden = s.id !== "v-" + v; });
  history.replaceState(null, "", "#" + v);
  if (v === "hoy") cargarHoy(); if (v === "chats") { buscar(); cargarVentas(); } if (v === "num") cargarNum(); if (v === "links") cargarLinks(); if (v === "ag") cargarAg();
}

// ---- Lo que dicen los datos (el agente lo arma una vez por día; se puede actualizar)
function pintarConsejo(r) { var t = (r && r.texto) || ""; $("#consTxt").className = t ? "cons" : "mu"; $("#consTxt").textContent = t || "Todavía no hay análisis de hoy."; $("#consBtn").textContent = t ? "Actualizar análisis" : "Generar análisis de hoy"; }
function cargarConsejo() { api("consejo").then(pintarConsejo).catch(function () {}); }
$("#consBtn").onclick = function () { $("#consTxt").className = "mu"; $("#consTxt").textContent = "El agente está leyendo los números, los chats y los videos… (puede tardar un minuto)"; api("consejo", {}).then(pintarConsejo).catch(function () { $("#consTxt").textContent = "No pude generarlo ahora. Probá de nuevo."; }); };
cargarConsejo();

// ---- Hoy
var IA_EST = null, RD_EST = null;
function cargarHoy(liviano) {
  api("hoy" + (liviano ? "?liviano=1" : "")).then(function (d) {
    if (d.ia) IA_EST = d.ia; else d.ia = IA_EST;
    if (d.redes) RD_EST = d.redes; else d.redes = RD_EST;
    DATA = d; var est = [];
    var lect = d.lector || {}, fresco = lect.ultimoMensaje && Date.now() - lect.ultimoMensaje < 6 * 3600e3;
    est.push('<span class="pill ' + (lect.evento === "connected" && fresco ? "ok" : "bad") + '">WhatsApp 805 ' + (lect.evento === "connected" && fresco ? "sincronizado" : "sin datos nuevos hace rato: revisá el lector") + "</span>");
    var ia = d.ia || {}, alts = (ia.alternativas || []);
    var libres = alts.filter(function (a) { return !a.descansando; }).length;
    if (!alts.length) est.push('<span class="pill warn">IA: solo Gemini y Cloudflare. Cargá una clave gratis de Groq para que no se quede sin IA</span>');
    else est.push('<span class="pill ' + (libres ? "ok" : "warn") + '">IA de respaldo: ' + alts.map(function (a) { return a.id + (a.descansando ? " (sin cupo)" : ""); }).join(", ") + "</span>");
    var rd = d.redes; if (rd) {
      var hs = function (t) { if (!t) return "nunca"; var h = Math.round((Date.now() - t) / 36e5); return h < 1 ? "hace minutos" : h < 48 ? "hace " + h + " h" : "hace " + Math.round(h / 24) + " días"; };
      var igOk = rd.ig.leido && Date.now() - rd.ig.leido < 36 * 3600e3;
      est.push('<span class="pill ' + (igOk ? "ok" : "bad") + '">Instagram: ' + rd.ig.videos7 + " publicaciones en 7 días · leído " + hs(rd.ig.leido) + "</span>");
      var ttOk = rd.tt.estado !== "ERROR" && rd.tt.leido && Date.now() - rd.tt.leido < 4 * 86400e3;
      est.push('<span class="pill ' + (ttOk ? "ok" : "bad") + '">TikTok: ' + (rd.tt.estado === "ERROR" ? "error en la última lectura" : rd.tt.videos7 + " videos en 7 días") + " · leído " + hs(rd.tt.leido) + "</span>");
    }
    if (ia.geminiModelosSinCupo) est.push('<span class="pill warn">Gemini: ' + ia.geminiModelosSinCupo + " modelos sin cupo</span>");
    $("#estado").innerHTML = est.join("");
    var por = {}; (d.equipo || []).forEach(function (e) { var p = por[e.persona] || (por[e.persona] = { hoy: 0, ayer: 0, mh: 0 }); if (e.dia === d.hoy) { p.hoy += e.chats; p.mh += e.mensajes; } else p.ayer += e.chats; });
    $("#equipoHoy").innerHTML = Object.keys(por).sort(function (a, b) { return por[b].hoy - por[a].hoy; }).map(function (n) { var p = por[n]; return '<div class="card"><span class="kp">' + esc(n) + '</span><b>' + p.hoy + '</b><span class="mu">chats hoy · ' + p.mh + " mensajes · ayer " + p.ayer + "</span></div>"; }).join("") || '<div class="mu">Todavía no hay chats contestados hoy.</div>';
    pintarLista();
  }).catch(function () { $("#lista").innerHTML = '<div class="vacio">No pude cargar. Recargá la página.</div>'; });
}
function pintarLista() {
  var d = DATA, cats = d.categorias, orden = Object.keys(cats).sort(function (a, b) { return cats[a].orden - cats[b].orden; });
  if (!d.lista.length) { $("#lista").innerHTML = '<div class="vacio">Nada pendiente. Buen momento para grabar contenido o prospectar.</div>'; return; }
  $("#lista").innerHTML = orden.map(function (k) {
    var it = d.lista.filter(function (i) { return i.cat === k; }); if (!it.length) return "";
    return '<h2 style="--k:var(--c-' + k + ')">' + esc(cats[k].titulo) + ' <span class="n">' + it.length + "</span></h2>" + it.map(tarjeta).join("");
  }).join("");
}
function tarjeta(i) {
  return '<div class="card" data-cat="' + i.cat + '" style="--k:var(--c-' + i.cat + ')" data-conv="' + esc(i.conv) + '"><div class="top"><span class="tel" data-tel="' + esc(i.conv) + '" title="' + esc(i.nombre || "") + '">' + telFmt(i.conv) + "</span>" + (i.producto ? '<span class="mu">' + esc(i.producto) + "</span>" : "") +
    (i.usd ? '<span class="tag">~USD ' + plata(i.usd) + "</span>" : "") + (i.cat !== "seguimiento" && i.cat !== "llamar" ? '<span class="mu">' + hace(i.espera_h) + "</span>" : (i.toque ? '<span class="tag">toque ' + i.toque + "</span>" : "")) + "</div>" +
    (i.que ? '<div class="que">' + esc(i.que) + "</div>" : "") + (i.ultimo ? '<div class="ult">"' + esc(i.ultimo) + '"</div>' : "") + (i.borrador ? '<div class="borr" data-copiar="' + esc(i.borrador) + '" title="Tocá para copiar">' + esc(i.borrador) + "</div>" : "") +
    (i.nota && i.cat !== "recordatorio" ? '<div class="nota">📝 ' + esc(i.nota) + (i.nota_para ? ' <span class="mu">· ' + esc(i.nota_para.slice(5)) + "</span>" : "") + "</div>" : "") +
    '<div class="acc"><button class="b" data-a="nota" data-nota="' + esc(i.nota || "") + '" data-para="' + esc(i.nota_para || "") + '">Nota</button><button class="b" data-a="listo">Listo</button><button class="b v" data-a="vendido">Vendido</button><button class="b x" data-a="perdido">Perdido</button></div></div>';
}
document.addEventListener("click", function (e) {
  var b = e.target.closest("[data-a]"); if (!b) return;
  var card = b.closest("[data-conv]"), conv = card ? card.dataset.conv : "", a = b.dataset.a;
  if (a === "listo") api("listo", { conv: conv }).then(function () { card.remove(); toast("Listo, sale de la lista"); });
  if (a === "vendido") modalVenta(conv, card);
  if (a === "perdido") modalPerdido(conv, card);
  if (a === "nota") modalNota(conv, card, b.dataset.nota || "", b.dataset.para || "");
  if (a === "borrarVenta") { if (confirm("¿Borrar esta venta?")) api("venta-borrar", { id: b.dataset.id }).then(function () { cargarVentas(); toast("Venta borrada"); }); }
});
function cerrarModal() { $("#mod").classList.remove("on"); }
$("#mod").addEventListener("click", function (e) { if (e.target.id === "mod" || e.target.dataset.cerrar !== undefined) cerrarModal(); });
function modalVenta(conv, card) {
  var nombre = card ? ((card.querySelector("[data-tel]") || card.querySelector("b") || {}).textContent || "") : "";
  $("#modC").innerHTML = "<b>Registrar venta" + (nombre ? " · " + esc(nombre) : "") + "</b>" + (conv ? "" : '<label>Nombre del cliente</label><input id="vNom">') +
    '<label>Monto total cobrado</label><div class="fila"><input id="vMonto" inputmode="decimal" placeholder="ej. 350000"><select id="vMon"><option>ARS</option><option>USD</option></select></div>' +
    '<label>Ganancia nuestra (lo que nos queda)</label><input id="vGan" inputmode="decimal" placeholder="ej. 60000">' +
    '<label>Línea</label><select id="vLin">' + LINEAS.map(function (l) { return "<option>" + esc(l) + "</option>"; }).join("") + "</select>" +
    '<label>Producto</label><input id="vProd"><label>Nota (opcional)</label><input id="vNota"><div class="acc"><button class="b p" id="vOk">Guardar venta</button><button class="b" data-cerrar>Cancelar</button></div>';
  $("#mod").classList.add("on"); $("#vMonto").focus();
  $("#vOk").onclick = function () {
    api("vendido", { conv: conv, monto: $("#vMonto").value, moneda: $("#vMon").value, ganancia: $("#vGan").value, linea: $("#vLin").value, producto: $("#vProd").value, nota: $("#vNota").value, nombre: conv ? "" : ($("#vNom") || {}).value })
      .then(function (r) { if (r.error) return toast(r.error); cerrarModal(); if (card) card.remove(); toast("Venta registrada"); cargarVentas(); });
  };
}
function manana() { var d = new Date(Date.now() - 3 * 3600e3 + 86400e3); return d.toISOString().slice(0, 10); }
function modalNota(conv, card, nota, para) {
  $("#modC").innerHTML = '<b>Nota</b><label>Qué hay que hacer o recordar</label><textarea id="nTxt" rows="3" placeholder="Ej: escribir mañana para que pague">' + esc(nota) + '</textarea>' +
    '<label>Recordármelo el</label><div class="fila"><input id="nPara" type="date" value="' + esc(para) + '"><button class="b" id="nMan">Mañana</button></div><div class="mu">Con fecha, ese día aparece arriba de todo y el agente te lo marca como importante.</div>' +
    '<div class="acc"><button class="b p" id="nOk">Guardar</button>' + (nota ? '<button class="b x" id="nBorrar">Borrar nota</button>' : "") + '<button class="b" data-cerrar>Cancelar</button></div>';
  $("#mod").classList.add("on"); $("#nTxt").focus();
  $("#nMan").onclick = function () { $("#nPara").value = manana(); };
  var guardar = function (txt) { api("nota", { conv: conv, nota: txt, para: $("#nPara").value }).then(function (r) { if (r.error) return toast(r.error); cerrarModal(); toast(txt ? "Nota guardada" : "Nota borrada"); cargarHoy(); }); };
  $("#nOk").onclick = function () { guardar($("#nTxt").value.trim()); };
  if ($("#nBorrar")) $("#nBorrar").onclick = function () { guardar(""); };
}
function modalPerdido(conv, card) {
  var motivos = ["Precio total", "Plazo", "Cantidad mínima", "Lo compra en otro lado / más barato acá", "No respondió más", "No es el momento", "Desconfianza", "Otro"];
  $("#modC").innerHTML = '<b>Marcar como perdido</b><label>Motivo</label><select id="pMot">' + motivos.map(function (m) { return "<option>" + m + "</option>"; }).join("") + '</select><div class="acc"><button class="b x" id="pOk">Marcar perdido</button><button class="b" data-cerrar>Cancelar</button></div>';
  $("#mod").classList.add("on");
  $("#pOk").onclick = function () { api("perdido", { conv: conv, motivo: $("#pMot").value }).then(function () { cerrarModal(); if (card) card.remove(); toast("Marcado como perdido"); }); };
}

// ---- Chats y ventas
var tq = null; $("#q").addEventListener("input", function () { clearTimeout(tq); tq = setTimeout(buscar, 300); });
$("#ventaSuelta").onclick = function () { modalVenta("", null); };
function buscar() {
  api("buscar?q=" + encodeURIComponent($("#q").value)).then(function (l) {
    $("#res").innerHTML = (l || []).map(function (c) {
      return '<div class="card" data-conv="' + esc(c.conv) + '"><div class="top"><b>' + esc(c.nombre || "+" + c.conv) + '</b><span class="mu">' + esc(c.producto || "") + '</span><span class="tag">' + esc(c.etapa || "sin etapa") + '</span></div><div class="ult">"' + esc(String(c.ult_texto || "").slice(0, 120)) + '"</div>' +
        '<div class="acc"><button class="b" data-a="nota">Nota</button><button class="b v" data-a="vendido">Vendido</button><button class="b x" data-a="perdido">Perdido</button></div></div>';
    }).join("") || '<div class="vacio">Sin resultados.</div>';
  });
}
function cargarVentas() {
  api("numeros?p=mes&n=3").then(function (d) {
    $("#ventas").innerHTML = (d.ventas || []).length ? '<div class="tw"><table><tr><th>Fecha</th><th>Cliente</th><th>Producto</th><th>Línea</th><th>Monto</th><th>Ganancia</th><th></th></tr>' + d.ventas.map(function (v) {
      return "<tr><td>" + new Date(v.ts).toLocaleDateString("es-AR") + "</td><td>" + esc(v.nombre || "") + "</td><td>" + esc(v.producto || "") + "</td><td>" + esc(v.linea) + "</td><td>" + v.moneda + " " + plata(v.monto) + "</td><td>" + (v.ganancia ? v.moneda + " " + plata(v.ganancia) : "—") + '</td><td><button class="b x" data-a="borrarVenta" data-id="' + esc(v.id) + '">borrar</button></td></tr>';
    }).join("") + "</table></div>" : '<div class="vacio">Todavía no cargaron ventas. Usá el botón Vendido en cada chat.</div>';
  });
}

// ---- Números
var PER = "semana";
$("#per").addEventListener("click", function (e) { var b = e.target.closest("button"); if (!b) return; PER = b.dataset.p; [].forEach.call(document.querySelectorAll("#per button"), function (x) { x.classList.toggle("on", x === b); }); cargarNum(); });
function tabla(cab, filas) { return "<table><tr>" + cab.map(function (c) { return "<th>" + esc(c) + "</th>"; }).join("") + "</tr>" + filas.map(function (f) { return "<tr>" + f.map(function (c) { return "<td>" + c + "</td>"; }).join("") + "</tr>"; }).join("") + "</table>"; }
function dinero(ars, usd) { var p = []; if (ars) p.push("$" + plata(ars)); if (usd) p.push("USD " + plata(usd)); return p.join(" + ") || "—"; }
function cargarNum() {
  api("numeros?p=" + PER).then(function (d) {
    var F = d.filas;
    $("#tRes").innerHTML = tabla(["Período", "Chats nuevos", "Cotizados", "Ventas", "Facturado", "Ganancia"], F.map(function (f) { return [esc(f.periodo), f.nuevos, f.cotizados, f.ventas, dinero(f.ARS, f.USD), dinero(f.ganARS, f.ganUSD)]; }));
    var lin = {}; F.slice(0, 2).forEach(function (f, i) { Object.keys(f.linea).forEach(function (l) { lin[l] = lin[l] || [null, null]; lin[l][i] = f.linea[l]; }); });
    $("#tLin").innerHTML = Object.keys(lin).length ? tabla(["Línea", "Ventas (actual)", "Facturado", "Ganancia", "Ventas (anterior)"], Object.keys(lin).map(function (l) { var a = lin[l][0] || { ventas: 0 }, b = lin[l][1] || { ventas: 0 }; return [esc(l), a.ventas, dinero(a.ARS, a.USD), dinero(a.ganARS, a.ganUSD), b.ventas]; })) : '<div class="mu">Aparece cuando carguen ventas con el botón Vendido.</div>';
    var ori = {}; F.slice(0, 4).forEach(function (f, i) { Object.keys(f.origen).forEach(function (o) { ori[o] = ori[o] || [0, 0, 0, 0]; ori[o][i] = f.origen[o]; }); });
    $("#tOri").innerHTML = tabla(["Origen"].concat(F.slice(0, 4).map(function (f) { return f.periodo; })), Object.keys(ori).sort(function (a, b) { return ori[b][0] - ori[a][0]; }).map(function (o) { return [esc(o)].concat(ori[o]); }));
    var per = {}; F.forEach(function (f) { Object.keys(f.equipo).forEach(function (p) { per[p] = 1; }); });
    var P = Object.keys(per);
    $("#tEq").innerHTML = P.length ? tabla(["Período"].concat(P), F.map(function (f) { return [esc(f.periodo)].concat(P.map(function (p) { var e = f.equipo[p]; return e ? e.chats + ' <span class="mu">(' + e.mensajes + " msj)</span>" : "—"; })); })) : '<div class="mu">Se está calculando el historial (tarda unas horas la primera vez).</div>';
  });
  api("equipo?d=31").then(function (d) {
    var dias = {}, per = {}; (d.dias || []).forEach(function (e) { (dias[e.dia] = dias[e.dia] || {})[e.persona] = e.chats; per[e.persona] = 1; });
    var P = Object.keys(per), D = Object.keys(dias).sort().reverse();
    $("#tDias").innerHTML = D.length ? tabla(["Día"].concat(P), D.map(function (x) { return [x.slice(5)].concat(P.map(function (p) { return dias[x][p] || 0; })); })) : '<div class="mu">Sin datos todavía.</div>';
    $("#disp").innerHTML = (d.dispositivos || []).map(function (x) {
      return '<div class="card"><div class="fila"><div><b>Dispositivo ' + esc(x.disp) + '</b><div class="mu">' + x.mensajes + " mensajes en 30 días · último " + new Date(x.ult).toLocaleDateString("es-AR") + '</div></div><input data-disp="' + esc(x.disp) + '" value="' + esc(x.persona || "") + '" placeholder="¿De quién es?"></div></div>';
    }).join("");
  });
}
$("#disp").addEventListener("change", function (e) { var i = e.target.closest("[data-disp]"); if (!i) return; api("asignar", { disp: i.dataset.disp, persona: i.value }).then(function () { toast("Guardado. Se recalcula el historial en las próximas horas"); }); });

// ---- Links
function copiar(t) { (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(function () { toast("Link copiado"); }).catch(function () { prompt("Copiá el link:", t); }); }
function cargarLinks() {
  api("links").then(function (d) {
    var c = d.canales || {}; $("#lCan").innerHTML = Object.keys(c).map(function (k) { return '<option value="' + k + '">' + esc(c[k]) + "</option>"; }).join("");
    $("#lLista").innerHTML = (d.links || []).map(function (l) {
      return '<div class="card"><div class="top"><b>' + esc(l.nombre) + '</b><span class="tag">' + esc(l.codigo) + '</span><span class="mu">' + esc(l.canal) + " · " + l.leads + " chats · " + l.ventas + ' ventas</span></div><div class="link">' + esc(l.link) + '</div><div class="acc"><button class="b" data-copiar="' + esc(l.link) + '">Copiar link</button></div></div>';
    }).join("") || '<div class="vacio">Todavía no hay links.</div>';
  });
}
document.addEventListener("click", function (e) { var b = e.target.closest("[data-copiar]"); if (b) copiar(b.dataset.copiar); });
$("#lCrear").onclick = function () {
  api("link", { nombre: $("#lNom").value, canal: $("#lCan").value, texto: $("#lTxt").value }).then(function (r) {
    if (r.error) return toast(r.error);
    $("#lNuevo").innerHTML = '<div class="borr">Código ' + esc(r.codigo) + "<br>" + esc(r.link) + '</div><div class="acc"><button class="b p" data-copiar="' + esc(r.link) + '">Copiar link</button></div>';
    $("#lNom").value = ""; $("#lTxt").value = ""; cargarLinks();
  });
};

// ---- Agente
function pintarHilo(l) { $("#hilo").innerHTML = l.map(function (m) { var u = m.rol === "u" || m.rol === "user" || m.rol === "yo"; return '<div class="msg ' + (u ? "u" : "a") + '">' + esc(m.texto) + "</div>"; }).join(""); window.scrollTo(0, document.body.scrollHeight); }
var HILO = [];
function cargarAg() { fetch("/panel/api/agente/charla").then(function (r) { return r.json(); }).then(function (l) { HILO = Array.isArray(l) ? l : []; pintarHilo(HILO); }).catch(function () {}); }
$("#agEnv").onclick = function () {
  var q = $("#agQ").value.trim(); if (!q) return; $("#agQ").value = "";
  HILO.push({ rol: "u", texto: q }, { rol: "a", texto: "Pensando…" }); pintarHilo(HILO);
  fetch("/panel/api/agente/preguntar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pregunta: q }) }).then(function (r) { return r.json(); })
    .then(function (r) { HILO[HILO.length - 1] = { rol: "a", texto: r.respuesta || r.error || "No pude responder ahora." }; pintarHilo(HILO); })
    .catch(function () { HILO[HILO.length - 1] = { rol: "a", texto: "No pude responder ahora. Probá de nuevo." }; pintarHilo(HILO); });
};

ver((location.hash || "#hoy").slice(1) || "hoy");
setInterval(function () { if (!document.hidden && !$("#v-hoy").hidden && !$("#mod").classList.contains("on")) cargarHoy(true); }, 30000);
document.addEventListener("visibilitychange", function () { if (!document.hidden && !$("#v-hoy").hidden) cargarHoy(true); });
</script></body></html>`;
