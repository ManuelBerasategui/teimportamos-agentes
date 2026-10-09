// Pantalla del creador de carruseles (se inserta en Redes). Sin imports: así redes.js la puede usar sin dependencias circulares.
// =====================================================================
//  Pantalla (se inserta en Redes): sección, estilos y el dibujo de los slides
// =====================================================================
export const CARR_CSS = `
.cgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:10px}
.ccard{border:1px solid var(--borde);border-radius:12px;padding:12px;background:#fff;cursor:pointer;display:flex;flex-direction:column;gap:6px}.ccard:hover{border-color:var(--nar)}
.ccard h3{margin:0;font-size:15px}.ccard .pq{font-size:12.5px;color:var(--gris);line-height:1.35}
.ced{display:grid;grid-template-columns:1fr 340px;gap:12px;align-items:start}
.ced .lado{position:sticky;top:70px}
.datos{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}.datos label{font-size:12px;color:var(--gris);font-weight:600;display:flex;flex-direction:column;gap:3px}
.datos input{padding:8px;border:1px solid var(--borde);border-radius:8px;font-size:15px;font-family:inherit;width:100%}
.calc{font-size:13px;color:var(--gris);margin-top:8px}.calc b{color:var(--txt)}
.sl{border:1px solid var(--borde);border-radius:12px;padding:10px;margin-top:8px;background:#fff}
.sl .cab{display:flex;align-items:center;gap:8px;margin-bottom:6px}.sl .cab b{font-size:13px}.sl .cab .sp{flex:1}
.sl .mini{border:0;background:#f1f5f9;border-radius:7px;width:30px;height:30px;cursor:pointer;color:var(--gris);display:inline-flex;align-items:center;justify-content:center}.sl .mini:hover{color:var(--txt)}
.sl label{display:block;font-size:11.5px;color:var(--gris);font-weight:600;margin-top:5px}.sl textarea{width:100%;border:1px solid var(--borde);border-radius:8px;padding:7px 9px;font:inherit;font-size:14px;resize:vertical;min-height:38px}
.slides{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px}
.slc{display:flex;flex-direction:column;gap:6px}.slc canvas{width:100%;aspect-ratio:4/5;border-radius:10px;border:1px solid var(--borde);background:#F3EFE8}
.slc .n{font-size:12px;color:var(--gris);font-weight:700}
.cchat{display:flex;flex-direction:column;height:62vh;min-height:360px}.cchat .hilo{flex:1;height:auto}
.reglasc{display:flex;flex-wrap:wrap;gap:6px}.reglasc span{background:#f1f5f9;border-radius:99px;padding:4px 6px 4px 10px;font-size:12.5px;display:inline-flex;align-items:center;gap:4px}
.reglasc button{border:0;background:none;cursor:pointer;color:var(--gris);font-size:14px;line-height:1}
.pasos{display:flex;gap:6px;margin:4px 0 10px;flex-wrap:wrap}.pasos span{font-size:12px;font-weight:700;padding:4px 10px;border-radius:99px;background:#f1f5f9;color:var(--gris)}.pasos span.on{background:#ffedd5;color:#c2410c}
@media(max-width:900px){.ced{grid-template-columns:1fr}.ced .lado{position:static}.datos{grid-template-columns:1fr 1fr}.cchat{height:50vh}.slides{grid-template-columns:1fr 1fr}}
`;
export const CARR_HTML = `
<div id="m-carr" style="display:none">
 <div id="c-lista">
  <div class="barraher"><button class="btn p" id="bCarrIdeas">Generar ideas de carruseles</button></div>
  <p class="estado ayuda">El agente propone; elegís una idea, te arma la estructura, la confirmás, hace los slides con el estilo que mejor funcionó y los aprobás. Se publican a las 12 h (o cuando elijas).</p>
  <section class="card"><h2>En armado</h2><div class="cgrid" id="cArmado"></div></section>
  <section class="card"><h2>Ideas</h2><div class="cgrid" id="cIdeas"></div></section>
  <section class="card"><h2>Programados y publicados</h2><div id="cProg"></div></section>
  <section class="card"><h2>Lo que aprendió <span class="estado">reglas que le enseñaste en los chats; tocá × para borrar una</span></h2><div class="reglasc" id="cReglas"></div></section>
 </div>
 <div id="c-ed" style="display:none">
  <div class="fila" style="justify-content:space-between;margin-bottom:8px"><button class="btn ch" id="cVolver">← Carruseles</button><span class="pasos" id="cPasos"></span></div>
  <div class="ced">
   <div>
    <section class="card"><h2 id="cTit"></h2><div class="estado" id="cPq"></div>
     <div class="datos" style="margin-top:10px"><label>Producto<input id="dProd"></label><label>Precio en MercadoLibre ($)<input id="dMl" inputmode="numeric"></label><label>Costo puesto por unidad ($)<input id="dCosto" inputmode="numeric"></label><label>Cantidad del ejemplo<input id="dCant" inputmode="numeric"></label></div>
     <div class="calc" id="dCalc"></div>
    </section>
    <section class="card" id="cEstr"><div class="fila" style="justify-content:space-between"><h2>Estructura <span class="estado">editá lo que quieras o pedíselo al agente</span></h2><button class="btn p" id="cConfirmar">Confirmar estructura y hacer slides</button></div><div id="cSlidesTxt"></div></section>
    <section class="card" id="cDis" style="display:none"><div class="fila" style="justify-content:space-between"><h2>Slides</h2><button class="btn ch" id="cAEstr">Volver a la estructura</button></div><div class="slides" id="cCanvas"></div>
     <h2 style="margin-top:16px">Texto del posteo</h2><textarea id="cCaption" style="width:100%;min-height:110px;border:1px solid var(--borde);border-radius:10px;padding:10px;font:inherit;font-size:14px"></textarea>
     <div class="fila" style="margin-top:10px"><label class="estado">Publicar el <input type="datetime-local" id="cCuando" style="padding:7px;border:1px solid var(--borde);border-radius:8px;font:inherit"></label><button class="btn p" id="cAprobar">Aprobar y programar</button><button class="btn ch" id="cBajar">Descargar slides</button><button class="btn ch" id="cDescartar">Descartar</button></div><div class="prog" id="cProgTxt"></div>
    </section>
   </div>
   <div class="lado"><section class="card cchat"><h2>Chat con el agente <span class="estado">"en el slide 3 poné..."</span></h2><div class="hilo" id="cHilo"></div><form class="preg" id="cFChat"><input id="cMsg" placeholder="Pedile un cambio" autocomplete="off"><button class="btn p">Enviar</button></form></section></div>
  </div>
 </div>
</div>`;

// Dibujo de slides en canvas (1080 × 1350, 4:5). Mismo dibujo para la vista previa y para la imagen que se publica.
export const CARR_JS = String.raw`
var CAPI = function (r, body, metodo, extra) { return fetch("/panel/api/carruseles/" + r, { method: metodo || (body ? "POST" : "GET"), headers: Object.assign(body && !(body instanceof Blob) ? { "Content-Type": "application/json" } : {}, extra || {}), body: body instanceof Blob ? body : body ? JSON.stringify(body) : undefined }).then(function (x) { if (x.status === 401) { location.href = "/login?volver=/panel/redes%23carr"; throw 0; } return x.json(); }); };
var CL = null, CC = null, USUARIO = "te.importamos.arg", TIPOS_S = {}, IMGS = {}, FUENTE = null;
var EST_C = { idea: "Idea", estructura: "Estructura", slides: "Slides", aprobado: "Programado", publicando: "Publicando", publicado: "Publicado", error: "Error" };
var W = 1080, H = 1350, AZUL = "#3B4796", CREMA = "#F3EFE8";
function fuente() { if (FUENTE) return FUENTE; FUENTE = (document.fonts && document.fonts.load ? Promise.all([document.fonts.load('64px "Patrick Hand"'), document.fonts.ready]) : Promise.resolve()).catch(function () {}); return FUENTE; }
function pesos(n) { return n == null ? null : "$" + Math.round(n).toLocaleString("es-AR"); }
function datosC() { var d = CC.datos || {}; var dif = d.precio_ml && d.costo ? d.precio_ml - d.costo : null; return { producto: d.producto || "", precio_ml: pesos(d.precio_ml), costo: pesos(d.costo), diferencia: pesos(dif), total: dif != null && d.cantidad ? pesos(dif * d.cantidad) : null, cantidad: d.cantidad ? String(d.cantidad) : null }; }
function rell(t) { var v = datosC(); return String(t || "").replace(/\{(producto|precio_ml|costo|diferencia|total|cantidad)\}/g, function (m, k) { return v[k] || "[" + k.replace("_", " ") + "]"; }); }
function cargarImg(src) { if (!src) return Promise.resolve(null); if (IMGS[src]) return IMGS[src]; IMGS[src] = new Promise(function (ok) { var i = new Image(); i.onload = function () { ok(i); }; i.onerror = function () { ok(null); }; i.src = src; }); return IMGS[src]; }
function fnt(sz) { return sz + 'px "Patrick Hand", "Comic Sans MS", cursive'; }
function partir(ctx, txt, maxW, sz) {
  ctx.font = fnt(sz); var out = [];
  String(txt).split("\n").forEach(function (par) { var pal = par.split(" "), l = ""; pal.forEach(function (p) { var t = l ? l + " " + p : p; if (ctx.measureText(t).width > maxW && l) { out.push(l); l = p; } else l = t; }); out.push(l); });
  return out;
}
// Bloques: texto {t, sz, al:"c"|"l", sub:bool, gap}, img {img, mw, mh, card}, avatar, barras {...}, hr, esp
function medir(ctx, b) {
  if (b.k === "t") { b.lines = partir(ctx, b.t, b.al === "c" ? 900 : 860, b.sz); b.h = b.lines.length * b.sz * 1.16 + (b.sub ? 26 : 0); }
  else if (b.k === "img") { if (!b.img) { b.w = b.mw * 0.8; b.h = b.mh * 0.55; } else { var r = Math.min(b.mw / b.img.width, b.mh / b.img.height); b.w = b.img.width * r; b.h = b.img.height * r; } }
  else if (b.k === "av") b.h = 80; else if (b.k === "bar") b.h = 330; else if (b.k === "hr") b.h = 26; else if (b.k === "esp") b.h = b.h || 30;
  return b.h + (b.gap == null ? 22 : b.gap);
}
function dibujar(ctx, b, y, d) {
  ctx.fillStyle = AZUL; ctx.strokeStyle = AZUL; ctx.textBaseline = "top";
  if (b.k === "t") {
    ctx.font = fnt(b.sz); ctx.textAlign = b.al === "c" ? "center" : "left"; var x = b.al === "c" ? W / 2 : 110, maxw = 0;
    b.lines.forEach(function (l, i) { ctx.fillText(l, x, y + i * b.sz * 1.16); maxw = Math.max(maxw, ctx.measureText(l).width); });
    if (b.sub) { var yy = y + b.lines.length * b.sz * 1.16 + 6, x0 = b.al === "c" ? W / 2 - maxw / 2 - 10 : x - 6, x1 = x0 + maxw + 20; ctx.lineWidth = 6; ctx.lineCap = "round"; ctx.beginPath(); ctx.moveTo(x0, yy + 4); ctx.quadraticCurveTo((x0 + x1) / 2, yy - 4, x1, yy + 2); ctx.stroke(); }
  } else if (b.k === "img") {
    var x = (W - b.w) / 2;
    if (!b.img) { ctx.save(); ctx.setLineDash([14, 12]); ctx.lineWidth = 4; ctx.strokeStyle = "#B8BEDC"; ctx.strokeRect(x, y, b.w, b.h); ctx.restore(); ctx.font = fnt(46); ctx.textAlign = "center"; ctx.fillStyle = "#8C94C4"; ctx.fillText("Subí la foto de este slide", W / 2, y + b.h / 2 - 24); return; }
    if (b.card) { ctx.save(); ctx.shadowColor = "rgba(30,40,90,.22)"; ctx.shadowBlur = 40; ctx.shadowOffsetY = 14; rr(ctx, x - 14, y - 14, b.w + 28, b.h + 28, 26); ctx.fillStyle = "#fff"; ctx.fill(); ctx.restore(); ctx.save(); rr(ctx, x, y, b.w, b.h, 16); ctx.clip(); ctx.drawImage(b.img, x, y, b.w, b.h); ctx.restore(); }
    else ctx.drawImage(b.img, x, y, b.w, b.h);
  } else if (b.k === "av") {
    ctx.font = fnt(50); var t = "@" + USUARIO, tw = ctx.measureText(t).width, tot = 72 + 18 + tw + 14 + 34, x = W / 2 - tot / 2, cy = y + 40;
    ctx.save(); ctx.beginPath(); ctx.arc(x + 36, cy, 36, 0, 7); ctx.fillStyle = "#fff"; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = "#D6D9EA"; ctx.stroke(); ctx.clip(); if (d.logo) ctx.drawImage(d.logo, x, cy - 36, 72, 72); ctx.restore();
    ctx.fillStyle = AZUL; ctx.textAlign = "left"; ctx.textBaseline = "middle"; ctx.fillText(t, x + 90, cy + 2);
    var bx = x + 90 + tw + 14 + 17; ctx.beginPath(); ctx.arc(bx, cy, 16, 0, 7); ctx.fillStyle = "#3897F0"; ctx.fill(); ctx.strokeStyle = "#fff"; ctx.lineWidth = 4; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.beginPath(); ctx.moveTo(bx - 7, cy); ctx.lineTo(bx - 2, cy + 5); ctx.lineTo(bx + 8, cy - 6); ctx.stroke(); ctx.textBaseline = "top";
  } else if (b.k === "bar") {
    var va = numC(b.av), vb = numC(b.bv), mx = Math.max(va || 1, vb || 1), ancho = 560;
    ctx.font = fnt(50); ctx.textAlign = "left"; ctx.fillText(b.al_, 110, y);
    var wa = Math.max(60, ancho * (va || 0) / mx); ctx.fillRect(110, y + 64, wa, 84); ctx.fillText(b.av_, 110 + wa + 26, y + 80);
    ctx.fillText(b.bl_, 110, y + 176);
    var wb = Math.max(60, ancho * (vb || 0) / mx); ctx.save(); ctx.beginPath(); ctx.rect(110, y + 240, wb, 84); ctx.clip(); ctx.lineWidth = 14; for (var s = -100; s < wb + 100; s += 34) { ctx.beginPath(); ctx.moveTo(110 + s, y + 324); ctx.lineTo(110 + s + 84, y + 240); ctx.stroke(); } ctx.restore();
    ctx.fillText(b.bv_, 110 + wb + 26, y + 256);
  } else if (b.k === "hr") { ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(110, y + 12); ctx.lineTo(W - 150, y + 12); ctx.stroke(); }
}
function numC(t) { var m = String(t || "").replace(/\./g, "").match(/\d+/); return m ? +m[0] : 0; }
function rr(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
function bloques(s, i, d) {
  var T = function (t, sz, al, ex) { return Object.assign({ k: "t", t: rell(t), sz: sz, al: al || "c" }, ex || {}); }, out = [];
  var foto = d.fotos[i];
  if (s.tipo === "portada") out = [{ k: "img", img: foto, mw: 640, mh: 560, gap: 50 }, T(s.titulo, 96), T(s.subtitulo, 60, "c", { gap: 70 }), { k: "av" }];
  else if (s.tipo === "captura") out = [T(s.arriba, 100, "c", { gap: 50 }), { k: "img", img: foto, mw: 860, mh: 520, card: true, gap: 70 }, T(s.abajo, 64)];
  else if (s.tipo === "numero") out = [T(s.arriba, 70, "c", { gap: 30 }), T(s.numero, 200, "c", { sub: true, gap: 40 }), T(s.abajo, 64)];
  else if (s.tipo === "suma") { out = [T(s.titulo, 100, "l", { gap: 50 })]; (s.items || []).forEach(function (it, k) { out.push(T((k ? "+ " : "   ") + it, 62, "l", { gap: 10 })); }); out.push({ k: "hr", gap: 20 }, T(s.total, 92, "l")); }
  else if (s.tipo === "barras") out = [T(s.titulo, 100, "l", { gap: 50 }), { k: "bar", al_: rell(s.a_label), av_: rell(s.a_valor), av: rell(s.a_valor), bl_: rell(s.b_label), bv_: rell(s.b_valor), bv: rell(s.b_valor), gap: 50 }, T(s.conclusion, 84, "l")];
  else if (s.tipo === "texto") { out = [T(s.titulo, 100, "l", { gap: 40 })]; (s.parrafos || []).forEach(function (p) { out.push(T(p, 62, "l", { gap: 28 })); }); }
  else if (s.tipo === "multiplicacion") out = [T(s.arriba, 66, "c", { gap: 30 }), T(s.linea, 96, "c", { sub: true, gap: 40 }), T(s.numero, 150, "c", { gap: 26 }), T(s.abajo, 62)];
  else if (s.tipo === "lista") { out = [T(s.titulo, 104, "l", { gap: 44 })]; (s.items || []).forEach(function (it, k) { out.push(T((k + 1) + ". " + it, 62, "l", { gap: 22 })); }); }
  else if (s.tipo === "cta") out = [{ k: "av", gap: 40 }, T(s.texto, 66, "c", { gap: 30 }), T("Comentá “" + String(s.palabra || "").toUpperCase() + "”", 112, "c", { gap: 20 }), T(s.abajo, 66)];
  return out;
}
function render(canvas, s, i, d) {
  var ctx = canvas.getContext("2d"); canvas.width = W; canvas.height = H;
  ctx.fillStyle = CREMA; ctx.fillRect(0, 0, W, H);
  var bl = bloques(s, i, d), tot = 0; bl.forEach(function (b) { tot += medir(ctx, b); });
  var y = Math.max(70, (H - tot) / 2 + 10);
  bl.forEach(function (b) { dibujar(ctx, b, y, d); y += b.h + (b.gap == null ? 22 : b.gap); });
}
function recursos() {
  var f = (CC.datos && CC.datos.fotos) || {}, ps = [fuente(), cargarImg("/panel/api/carruseles/logo")];
  Object.keys(f).forEach(function (k) { ps.push(cargarImg("/panel/api/carruseles/img?key=" + encodeURIComponent(f[k]) + "&v=" + (CC.fv || 0))); });
  return Promise.all(ps).then(function (r) { var d = { logo: r[1], fotos: {} }, i = 2; Object.keys(f).forEach(function (k) { d.fotos[k] = r[i++]; }); return d; });
}
function pintarCanvas() {
  return recursos().then(function (d) {
    $("#cCanvas").innerHTML = CC.slides.map(function (s, i) { return '<div class="slc"><span class="n">' + (i + 1) + " · " + esc((TIPOS_S[s.tipo] || {}).nombre || s.tipo) + '</span><canvas data-i="' + i + '"></canvas>' + ((TIPOS_S[s.tipo] || {}).foto ? '<label class="btn ch" style="text-align:center;cursor:pointer">' + (CC.datos.fotos && CC.datos.fotos[i] ? "Cambiar foto" : "Subir foto") + '<input type="file" accept="image/*" data-foto="' + i + '" style="display:none"></label>' : "") + "</div>"; }).join("");
    document.querySelectorAll("#cCanvas canvas").forEach(function (cv) { render(cv, CC.slides[+cv.dataset.i], +cv.dataset.i, d); });
  });
}
function cargarCarr() {
  CAPI("lista").then(function (r) {
    CL = r; USUARIO = r.usuario || USUARIO; TIPOS_S = r.tipos || {};
    var tarjeta = function (c) { return '<div class="ccard" data-c="' + c.id + '"><span class="pill n" style="align-self:flex-start">' + (EST_C[c.estado] || c.estado) + "</span><h3>" + esc(c.titulo) + '</h3><div class="pq">' + esc(c.por_que || "") + "</div></div>"; };
    var arm = r.carruseles.filter(function (c) { return ["estructura", "slides", "error"].indexOf(c.estado) >= 0; }), ide = r.carruseles.filter(function (c) { return c.estado === "idea"; }), prog = r.carruseles.filter(function (c) { return ["aprobado", "publicando", "publicado"].indexOf(c.estado) >= 0; });
    $("#cArmado").innerHTML = arm.length ? arm.map(tarjeta).join("") : '<div class="vacio">Nada en armado.</div>';
    $("#cIdeas").innerHTML = ide.length ? ide.map(tarjeta).join("") : '<div class="vacio">No hay ideas. Tocá <b>Generar ideas de carruseles</b>.</div>';
    $("#cProg").innerHTML = prog.length ? prog.map(function (c) { return '<div class="clip" data-c="' + c.id + '"><span><b>' + esc(c.titulo) + "</b> " + (c.estado === "publicado" ? '<span class="pill pr">Publicado</span>' : '<span class="pill n">' + (c.estado === "aprobado" ? "Sale el " + cuando(c.programado_ts) : "Publicando...") + "</span>") + '</span><span class="fila">' + (c.link ? '<a class="btn ch" target="_blank" rel="noopener" href="' + esc(c.link) + '">Ver en Instagram</a>' : "") + (c.estado === "aprobado" ? '<button class="btn ch" data-frenar="' + c.id + '">Frenar</button>' : "") + "</span></div>"; }).join("") : '<div class="vacio">Nada programado.</div>';
    $("#cReglas").innerHTML = r.reglas.length ? r.reglas.map(function (x, i) { return "<span>" + esc(x) + '<button data-rb="' + i + '" aria-label="Borrar regla">×</button></span>'; }).join("") : '<span class="estado" style="background:none">Todavía nada. Cuando en un chat le digas "siempre..." o "nunca...", lo guarda acá.</span>';
  });
}
$("#c-lista").onclick = function (ev) {
  var rb = ev.target.closest("[data-rb]"); if (rb) { CAPI("regla-borrar", { i: +rb.dataset.rb }).then(cargarCarr); return; }
  var fr = ev.target.closest("[data-frenar]"); if (fr) { CAPI("frenar", { id: fr.dataset.frenar }).then(function (r) { if (!r.ok) return aviso(r.error); cargarCarr(); }); return; }
  if (ev.target.closest("a")) return;
  var t = ev.target.closest("[data-c]"); if (t) abrirCarr(t.dataset.c);
};
$("#bCarrIdeas").onclick = function () { var b = this; b.disabled = true; b.textContent = "Pensando ideas..."; CAPI("generar-ideas", {}).then(function (r) { b.disabled = false; b.textContent = "Generar ideas de carruseles"; if (!r.ok) return aviso(r.error); aviso(r.cantidad + " ideas nuevas"); cargarCarr(); }); };
function abrirCarr(id) {
  CAPI("ver?id=" + encodeURIComponent(id)).then(function (c) {
    if (c.error) return aviso(c.error);
    CC = c; $("#c-lista").style.display = "none"; $("#c-ed").style.display = ""; window.scrollTo(0, 0);
    if (c.estado === "idea") { CC.chat = [{ r: "a", t: "Armando la estructura..." }]; pintarEd(); CAPI("estructura", { id: id }).then(function (r) { if (!r.ok) { CC.chat = [{ r: "a", t: r.error }]; pintarEd(); return; } CC = r; pintarEd(); }); return; }
    pintarEd();
  });
}
$("#cVolver").onclick = function () { CC = null; $("#c-ed").style.display = "none"; $("#c-lista").style.display = ""; cargarCarr(); };
function pintarEd() {
  var c = CC, enSlides = ["slides", "error"].indexOf(c.estado) >= 0, editable = ["idea", "estructura", "slides", "error"].indexOf(c.estado) >= 0;
  $("#cTit").textContent = c.titulo; $("#cPq").textContent = c.por_que || "";
  $("#cPasos").innerHTML = ["1. Estructura", "2. Slides", "3. Programado"].map(function (p, i) { var on = (i === 0 && ["idea", "estructura"].indexOf(c.estado) >= 0) || (i === 1 && enSlides) || (i === 2 && ["aprobado", "publicando", "publicado"].indexOf(c.estado) >= 0); return '<span class="' + (on ? "on" : "") + '">' + p + "</span>"; }).join("");
  var d = c.datos || {};
  $("#dProd").value = d.producto || ""; $("#dMl").value = d.precio_ml || ""; $("#dCosto").value = d.costo || ""; $("#dCant").value = d.cantidad || "";
  ["#dProd", "#dMl", "#dCosto", "#dCant"].forEach(function (s) { $(s).disabled = !editable; });
  pintarCalc();
  $("#cEstr").style.display = enSlides || !editable ? "none" : ""; $("#cDis").style.display = enSlides ? "" : "none";
  if (!enSlides && editable) pintarEstr();
  if (enSlides) { $("#cCaption").value = c.caption || ""; pintarCanvas(); if (!$("#cCuando").value) CAPI("sugerir-hora?id=" + c.id).then(function (r) { if (r.ts) $("#cCuando").value = localDT(r.ts); }); }
  $("#cHilo").innerHTML = (c.chat || []).map(function (m) { return '<div class="burb ' + (m.r === "u" ? "u" : "a") + '">' + esc(m.t) + "</div>"; }).join(""); $("#cHilo").scrollTop = 1e9;
  $("#cFChat").style.display = editable && c.estado !== "idea" ? "" : "none";
}
function localDT(ts) { var d = new Date(ts - new Date(ts).getTimezoneOffset() * 60000); return d.toISOString().slice(0, 16); }
function pintarCalc() { var v = datosC(); $("#dCalc").innerHTML = v.diferencia ? "Diferencia por unidad: <b>" + v.diferencia + "</b>" + (v.total ? " · En " + v.cantidad + " unidades: <b>" + v.total + "</b>" : "") + " · las cuentas las hace el sistema" : "Cargá el precio en MercadoLibre y el costo puesto: la diferencia y el total se calculan solos."; }
var CAMPOS_N = { titulo: "Título", subtitulo: "Subtítulo", arriba: "Texto de arriba", abajo: "Texto de abajo", numero: "Número grande", items: "Ítems (uno por renglón)", total: "Total", a_label: "Barra 1 (nombre)", a_valor: "Barra 1 (valor)", b_label: "Barra 2 (nombre)", b_valor: "Barra 2 (valor)", conclusion: "Conclusión", parrafos: "Párrafos (uno por renglón)", linea: "Cuenta", texto: "Texto", palabra: "Palabra para comentar" };
function pintarEstr() {
  $("#cSlidesTxt").innerHTML = (CC.slides || []).map(function (s, i) {
    var t = TIPOS_S[s.tipo] || { campos: [] };
    return '<div class="sl" data-i="' + i + '"><div class="cab"><b>' + (i + 1) + ". " + esc(t.nombre || s.tipo) + (t.foto ? " · lleva foto" : "") + '</b><span class="sp"></span><button class="mini" data-mv="-1" aria-label="Subir">↑</button><button class="mini" data-mv="1" aria-label="Bajar">↓</button><button class="mini" data-del="1" aria-label="Borrar">×</button></div>' +
      t.campos.map(function (k) { var v = Array.isArray(s[k]) ? s[k].join("\n") : s[k] || ""; return "<label>" + (CAMPOS_N[k] || k) + '</label><textarea data-k="' + k + '" rows="' + (Array.isArray(s[k]) ? Math.max(2, s[k].length) : 1) + '">' + esc(v) + "</textarea>"; }).join("") + "</div>";
  }).join("") || '<div class="vacio">Armando...</div>';
}
var tGuardar = null;
function guardarCarr(extra) { clearTimeout(tGuardar); tGuardar = setTimeout(function () { CAPI("guardar", Object.assign({ id: CC.id, slides: CC.slides, caption: CC.caption, datos: CC.datos }, extra || {})).then(function (r) { if (r.ok) { var fv = CC.fv; CC = r; CC.fv = fv; } else aviso(r.error || "No se guardó"); }); }, 600); }
$("#cSlidesTxt").addEventListener("input", function (ev) { var ta = ev.target, box = ta.closest("[data-i]"); if (!ta.dataset.k || !box) return; var s = CC.slides[+box.dataset.i]; s[ta.dataset.k] = ["items", "parrafos"].indexOf(ta.dataset.k) >= 0 ? ta.value.split("\n") : ta.value; guardarCarr(); });
$("#cSlidesTxt").onclick = function (ev) { var b = ev.target.closest("button"); if (!b) return; var i = +b.closest("[data-i]").dataset.i; if (b.dataset.del) CC.slides.splice(i, 1); else { var j = i + +b.dataset.mv; if (j < 0 || j >= CC.slides.length) return; var t = CC.slides[i]; CC.slides[i] = CC.slides[j]; CC.slides[j] = t; } pintarEstr(); guardarCarr(); };
["#dProd", "#dMl", "#dCosto", "#dCant"].forEach(function (s) { $(s).addEventListener("input", function () { CC.datos = Object.assign({}, CC.datos, { producto: $("#dProd").value, precio_ml: numC($("#dMl").value) || null, costo: numC($("#dCosto").value) || null, cantidad: numC($("#dCant").value) || null }); pintarCalc(); if ($("#cDis").style.display !== "none") pintarCanvas(); guardarCarr(); }); });
$("#cCaption").addEventListener("input", function () { CC.caption = this.value; guardarCarr(); });
$("#cConfirmar").onclick = function () { clearTimeout(tGuardar); CAPI("guardar", { id: CC.id, slides: CC.slides, caption: CC.caption, datos: CC.datos }).then(function () { return CAPI("fase", { id: CC.id, a: "slides" }); }).then(function (r) { if (!r.ok) return aviso(r.error); CC = r; pintarEd(); }); };
$("#cAEstr").onclick = function () { CAPI("fase", { id: CC.id, a: "estructura" }).then(function (r) { if (!r.ok) return aviso(r.error); CC = r; pintarEd(); }); };
$("#cCanvas").addEventListener("change", function (ev) {
  var inp = ev.target; if (inp.dataset.foto == null || !inp.files[0]) return; var f = inp.files[0];
  if (f.size > 8 * 1048576) return aviso("La imagen pesa más de 8 MB");
  aviso("Subiendo foto..."); CAPI("foto?id=" + CC.id + "&n=" + inp.dataset.foto, f, "PUT", { "Content-Type": f.type || "image/jpeg" }).then(function (r) { if (!r.ok) return aviso(r.error || "No se pudo"); CC.datos.fotos = Object.assign({}, CC.datos.fotos, {}); CC.datos.fotos[inp.dataset.foto] = r.key; CC.fv = Date.now(); pintarCanvas(); aviso("Foto lista"); });
});
$("#cFChat").onsubmit = function (e) {
  e.preventDefault(); var m = $("#cMsg").value.trim(); if (!m) return; $("#cMsg").value = "";
  clearTimeout(tGuardar);
  CC.chat = (CC.chat || []).concat({ r: "u", t: m }, { r: "a", t: "Pensando..." }); $("#cHilo").innerHTML = CC.chat.map(function (x) { return '<div class="burb ' + (x.r === "u" ? "u" : "a") + '">' + esc(x.t) + "</div>"; }).join(""); $("#cHilo").scrollTop = 1e9;
  CAPI("guardar", { id: CC.id, slides: CC.slides, caption: CC.caption, datos: CC.datos }).then(function () { return CAPI("chat", { id: CC.id, mensaje: m }); }).then(function (r) { if (!r.ok) { CC.chat[CC.chat.length - 1] = { r: "a", t: r.error || "No pude." }; pintarEd(); return; } var fv = CC.fv; CC = r; CC.fv = fv; pintarEd(); if (r.regla) cargarCarr(); });
};
function subirSlides() {
  var cs = document.querySelectorAll("#cCanvas canvas"), i = 0;
  function sig() { if (i >= cs.length) return Promise.resolve(); var cv = cs[i], n = i++; $("#cProgTxt").textContent = "Guardando slide " + (n + 1) + " de " + cs.length + "..."; return new Promise(function (ok) { cv.toBlob(ok, "image/jpeg", 0.92); }).then(function (b) { return CAPI("slide?id=" + CC.id + "&n=" + n, b, "PUT", { "Content-Type": "image/jpeg" }); }).then(function (r) { if (!r.ok) throw new Error(r.error || "error"); return sig(); }); }
  return pintarCanvas().then(sig);
}
$("#cAprobar").onclick = function () {
  var b = this; b.disabled = true; clearTimeout(tGuardar);
  CAPI("guardar", { id: CC.id, slides: CC.slides, caption: $("#cCaption").value, datos: CC.datos }).then(subirSlides).then(function () {
    var v = $("#cCuando").value, ts = v ? new Date(v).getTime() : 0; return CAPI("aprobar", { id: CC.id, caption: $("#cCaption").value, cuando: ts });
  }).then(function (r) { b.disabled = false; $("#cProgTxt").textContent = ""; if (!r.ok) return aviso(r.error || "No se pudo"); aviso("Programado: sale el " + cuando(r.programado_ts)); $("#cVolver").onclick(); })
    .catch(function (e) { b.disabled = false; $("#cProgTxt").textContent = "No se pudo: " + (e && e.message ? e.message : "error"); });
};
$("#cBajar").onclick = function () { pintarCanvas().then(function () { document.querySelectorAll("#cCanvas canvas").forEach(function (cv, i) { var a = document.createElement("a"); a.download = "slide-" + (i + 1) + ".jpg"; a.href = cv.toDataURL("image/jpeg", 0.92); a.click(); }); }); };
$("#cDescartar").onclick = function () { if (!confirm("¿Descartar este carrusel?")) return; CAPI("descartar", { id: CC.id }).then(function () { $("#cVolver").onclick(); }); };
`;
