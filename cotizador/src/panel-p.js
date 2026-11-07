// Panel nuevo (/panel/p): Hoy · Chats · Números · Links · Agente. Datos en tablero.js.
export const PANEL_P = String.raw`<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Te Importamos</title>
<style>
:root{--bg:#f6f5f2;--card:#fff;--tx:#1d1b18;--mu:#6f6a62;--li:#e7e3dc;--ac:#e8590c;--ok:#2f9e44;--bad:#c92a2a;--warn:#f08c00;--chip:#f1ede6}
@media (prefers-color-scheme:dark){:root{--bg:#141311;--card:#1e1c19;--tx:#efece6;--mu:#a19b91;--li:#34302b;--chip:#2a2723}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--tx);font:15px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
header{position:sticky;top:0;z-index:5;background:var(--bg);border-bottom:1px solid var(--li)}
.hw{max-width:980px;margin:0 auto;padding:10px 16px;display:flex;gap:12px;align-items:center;flex-wrap:wrap}
.logo{font-weight:800;letter-spacing:.2px}.logo span{color:var(--ac)}
nav{display:flex;gap:4px;flex-wrap:wrap}nav button{border:0;background:none;color:var(--mu);padding:7px 11px;border-radius:9px;font:inherit;cursor:pointer}
nav button.on{background:var(--tx);color:var(--bg)}
.viejo{margin-left:auto;color:var(--mu);font-size:13px}
main{max-width:980px;margin:0 auto;padding:14px 16px 60px}
.est{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px}.pill{background:var(--chip);border-radius:20px;padding:4px 11px;font-size:13px}
.pill.ok::before,.pill.bad::before,.pill.warn::before{content:"";display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px;vertical-align:1px}
.pill.ok::before{background:var(--ok)}.pill.bad::before{background:var(--bad)}.pill.warn::before{background:var(--warn)}
h2{font-size:15px;margin:22px 0 8px;display:flex;gap:8px;align-items:center}h2 .n{background:var(--ac);color:#fff;border-radius:20px;padding:0 8px;font-size:12px}
.card{background:var(--card);border:1px solid var(--li);border-radius:12px;padding:11px 13px;margin-bottom:8px}
.top{display:flex;gap:8px;flex-wrap:wrap;align-items:baseline}.mu{color:var(--mu);font-size:13px}.tag{background:var(--chip);border-radius:6px;padding:0 6px;font-size:12px}
.que{margin-top:4px}.ult{color:var(--mu);font-size:13px;margin-top:3px;font-style:italic}
.borr{margin-top:6px;background:var(--chip);border-radius:8px;padding:7px 9px;font-size:13px;white-space:pre-wrap}
.acc{display:flex;gap:6px;flex-wrap:wrap;margin-top:9px}
.b{border:1px solid var(--li);background:var(--card);color:var(--tx);border-radius:8px;padding:6px 11px;font:inherit;font-size:13px;cursor:pointer;text-decoration:none}
.b.p{background:var(--ac);border-color:var(--ac);color:#fff}.b.v{color:var(--ok)}.b.x{color:var(--bad)}
.vacio{color:var(--mu);padding:20px 0}
.eq{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px}.eq .card b{font-size:22px;display:block}
table{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--li);border-radius:12px;overflow:hidden;font-size:14px}
th,td{padding:7px 9px;border-bottom:1px solid var(--li);text-align:right;white-space:nowrap}th:first-child,td:first-child{text-align:left}th{color:var(--mu);font-weight:600;font-size:12px}
.tw{overflow-x:auto;margin-bottom:6px}
input,select,textarea{font:inherit;border:1px solid var(--li);background:var(--card);color:var(--tx);border-radius:8px;padding:8px 10px;width:100%}
.fila{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:8px;margin-bottom:8px}
.modal{position:fixed;inset:0;background:#0007;display:none;align-items:center;justify-content:center;padding:16px;z-index:20}.modal.on{display:flex}
.modal .card{width:100%;max-width:440px}.modal label{font-size:13px;color:var(--mu);display:block;margin:8px 0 3px}
.seg{display:inline-flex;background:var(--chip);border-radius:9px;padding:3px}.seg button{border:0;background:none;padding:5px 12px;border-radius:7px;font:inherit;color:var(--mu);cursor:pointer}.seg button.on{background:var(--card);color:var(--tx)}
.hilo{display:flex;flex-direction:column;gap:8px;margin-bottom:10px}.msg{max-width:85%;padding:9px 12px;border-radius:12px;white-space:pre-wrap}.msg.u{align-self:flex-end;background:var(--ac);color:#fff}.msg.a{align-self:flex-start;background:var(--card);border:1px solid var(--li)}
.cons{white-space:pre-wrap;color:var(--tx);margin-top:6px}
.link{font-size:12px;word-break:break-all;color:var(--mu)}
.toast{position:fixed;bottom:18px;left:50%;transform:translateX(-50%);background:var(--tx);color:var(--bg);padding:8px 14px;border-radius:9px;display:none;z-index:30}
</style></head><body>
<header><div class="hw"><div class="logo">TE.<span>IMPORTAMOS</span></div>
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
var IA_EST = null;
function cargarHoy(liviano) {
  api("hoy" + (liviano ? "?liviano=1" : "")).then(function (d) {
    if (d.ia) IA_EST = d.ia; else d.ia = IA_EST;
    DATA = d; var est = [];
    var lect = d.lector || {}, fresco = lect.ultimoMensaje && Date.now() - lect.ultimoMensaje < 6 * 3600e3;
    est.push('<span class="pill ' + (lect.evento === "connected" && fresco ? "ok" : "bad") + '">WhatsApp 805 ' + (lect.evento === "connected" && fresco ? "sincronizado" : "sin datos nuevos hace rato: revisá el lector") + "</span>");
    var ia = d.ia || {}, alts = (ia.alternativas || []);
    var libres = alts.filter(function (a) { return !a.descansando; }).length;
    if (!alts.length) est.push('<span class="pill warn">IA: solo Gemini y Cloudflare. Cargá una clave gratis de Groq para que no se quede sin IA</span>');
    else est.push('<span class="pill ' + (libres ? "ok" : "warn") + '">IA de respaldo: ' + alts.map(function (a) { return a.id + (a.descansando ? " (sin cupo)" : ""); }).join(", ") + "</span>");
    if (ia.geminiModelosSinCupo) est.push('<span class="pill warn">Gemini: ' + ia.geminiModelosSinCupo + " modelos sin cupo</span>");
    $("#estado").innerHTML = est.join("");
    var por = {}; (d.equipo || []).forEach(function (e) { var p = por[e.persona] || (por[e.persona] = { hoy: 0, ayer: 0, mh: 0 }); if (e.dia === d.hoy) { p.hoy += e.chats; p.mh += e.mensajes; } else p.ayer += e.chats; });
    $("#equipoHoy").innerHTML = Object.keys(por).sort(function (a, b) { return por[b].hoy - por[a].hoy; }).map(function (n) { var p = por[n]; return '<div class="card"><span class="mu">' + esc(n) + '</span><b>' + p.hoy + '</b><span class="mu">chats hoy · ' + p.mh + " mensajes · ayer " + p.ayer + "</span></div>"; }).join("") || '<div class="mu">Todavía no hay chats contestados hoy.</div>';
    pintarLista();
  }).catch(function () { $("#lista").innerHTML = '<div class="vacio">No pude cargar. Recargá la página.</div>'; });
}
function pintarLista() {
  var d = DATA, cats = d.categorias, orden = Object.keys(cats).sort(function (a, b) { return cats[a].orden - cats[b].orden; });
  if (!d.lista.length) { $("#lista").innerHTML = '<div class="vacio">Nada pendiente. Buen momento para grabar contenido o prospectar.</div>'; return; }
  $("#lista").innerHTML = orden.map(function (k) {
    var it = d.lista.filter(function (i) { return i.cat === k; }); if (!it.length) return "";
    return '<h2>' + esc(cats[k].titulo) + ' <span class="n">' + it.length + "</span></h2>" + it.map(tarjeta).join("");
  }).join("");
}
function tarjeta(i) {
  var wa = "https://wa.me/" + i.conv + (i.borrador ? "?text=" + encodeURIComponent(i.borrador) : "");
  return '<div class="card" data-conv="' + esc(i.conv) + '"><div class="top"><b>' + esc(i.nombre || "+" + i.conv) + "</b>" + (i.producto ? '<span class="mu">' + esc(i.producto) + "</span>" : "") +
    (i.usd ? '<span class="tag">~USD ' + plata(i.usd) + "</span>" : "") + (i.cat !== "seguimiento" && i.cat !== "llamar" ? '<span class="mu">' + hace(i.espera_h) + "</span>" : (i.toque ? '<span class="tag">toque ' + i.toque + "</span>" : "")) + "</div>" +
    (i.que ? '<div class="que">' + esc(i.que) + "</div>" : "") + (i.ultimo ? '<div class="ult">"' + esc(i.ultimo) + '"</div>' : "") + (i.borrador ? '<div class="borr">' + esc(i.borrador) + "</div>" : "") +
    '<div class="acc"><a class="b p" target="_blank" href="' + esc(wa) + '">' + (i.borrador ? "Abrir con el mensaje" : "Abrir WhatsApp") + '</a><button class="b" data-a="listo">Listo</button><button class="b v" data-a="vendido">Vendido</button><button class="b x" data-a="perdido">Perdido</button></div></div>';
}
document.addEventListener("click", function (e) {
  var b = e.target.closest("[data-a]"); if (!b) return;
  var card = b.closest("[data-conv]"), conv = card ? card.dataset.conv : "", a = b.dataset.a;
  if (a === "listo") api("listo", { conv: conv }).then(function () { card.remove(); toast("Listo, sale de la lista"); });
  if (a === "vendido") modalVenta(conv, card);
  if (a === "perdido") modalPerdido(conv, card);
  if (a === "borrarVenta") { if (confirm("¿Borrar esta venta?")) api("venta-borrar", { id: b.dataset.id }).then(function () { cargarVentas(); toast("Venta borrada"); }); }
});
function cerrarModal() { $("#mod").classList.remove("on"); }
$("#mod").addEventListener("click", function (e) { if (e.target.id === "mod" || e.target.dataset.cerrar !== undefined) cerrarModal(); });
function modalVenta(conv, card) {
  var nombre = card ? (card.querySelector("b") || {}).textContent : "";
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
        '<div class="acc"><a class="b" target="_blank" href="https://wa.me/' + esc(c.conv) + '">WhatsApp</a><button class="b v" data-a="vendido">Vendido</button><button class="b x" data-a="perdido">Perdido</button></div></div>';
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
setInterval(function () { if (!document.hidden && !$("#v-hoy").hidden && !$("#mod").classList.contains("on")) cargarHoy(true); }, 20000);
document.addEventListener("visibilitychange", function () { if (!document.hidden && !$("#v-hoy").hidden) cargarHoy(true); });
</script></body></html>`;
