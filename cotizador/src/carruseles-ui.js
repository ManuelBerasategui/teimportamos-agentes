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
.cajustes summary{cursor:pointer;font-weight:700}.cajustes[open] summary{margin-bottom:12px}.cajuste{padding:8px 0;border-top:1px solid var(--borde)}.cajuste h2{margin:4px 0 8px}.refimgs{display:flex;gap:8px;overflow-x:auto;margin:8px 0}.refimgs img{width:96px;height:120px;object-fit:cover;border:1px solid var(--borde);border-radius:8px}
.reglasc{display:flex;flex-wrap:wrap;gap:6px}.reglasc span{background:#f1f5f9;border-radius:99px;padding:4px 6px 4px 10px;font-size:12.5px;display:inline-flex;align-items:center;gap:4px}
.reglasc button{border:0;background:none;cursor:pointer;color:var(--gris);font-size:14px;line-height:1}
.pasos{display:flex;gap:6px;margin:4px 0 10px;flex-wrap:wrap}.pasos span{font-size:12px;font-weight:700;padding:4px 10px;border-radius:99px;background:#f1f5f9;color:var(--gris)}.pasos span.on{background:#ffedd5;color:#c2410c}
@media(max-width:900px){.ced{grid-template-columns:1fr}.ced .lado{position:static}.datos{grid-template-columns:1fr 1fr}.cchat{height:50vh}.slides{grid-template-columns:1fr 1fr}}
`;
export const CARR_HTML = `
<div id="m-carr" style="display:none">
 <div id="c-lista">
  <div class="barraher"><button class="btn p" id="bCarrIdeas">Generar ideas de carruseles</button></div>
   <p class="estado ayuda">Generá ideas distintas, elegí una y revisá el borrador. Sólo se programa cuando lo aprobás.</p>
  <section class="card"><h2>En armado</h2><div class="cgrid" id="cArmado"></div></section>
  <section class="card"><h2>Ideas</h2><div class="cgrid" id="cIdeas"></div></section>
  <section class="card"><h2>Programados y publicados</h2><div id="cProg"></div></section>
   <details class="card cajustes"><summary>Ajustes y aprendizaje <span class="estado">opcional</span></summary>
    <section class="cajuste"><h2>Dirección para esta etapa</h2><textarea id="cDir" placeholder="Ej: más tips y comparaciones; menos contenido comercial." style="width:100%;min-height:64px;border:1px solid var(--borde);border-radius:10px;padding:10px;font:inherit;font-size:14px"></textarea><div class="fila" style="margin-top:8px"><button class="btn ch" id="cDirGuardar">Guardar</button></div></section>
    <section class="cajuste"><h2>Preferencias aprendidas <span class="estado">editable; las reglas de seguridad no se cambian acá</span></h2><textarea id="cMemoria" placeholder="Todavía no hay preferencias guardadas. Podés escribir qué tono, enfoques o formatos preferís." style="width:100%;min-height:80px;border:1px solid var(--borde);border-radius:10px;padding:10px;font:inherit;font-size:14px"></textarea><div class="fila" style="margin-top:8px"><button class="btn ch" id="cMemoriaGuardar">Guardar preferencias</button></div><div class="reglasc" id="cReglas" style="margin-top:8px"></div></section>
    <section class="cajuste"><h2>Referencias visuales</h2><p class="estado">Subí capturas para analizar el ritmo y la estructura. El sistema no abre ni extrae publicaciones desde Instagram.</p>
     <div class="fila"><input id="rLink" placeholder="Link de origen (se guarda como nota; no se abre)" style="flex:1;min-width:200px;padding:8px;border:1px solid var(--borde);border-radius:8px;font:inherit"></div>
     <div class="fila" style="margin-top:6px"><label class="btn ch" style="cursor:pointer">Elegir capturas<input type="file" id="rArch" accept="image/*" multiple style="display:none"></label><input id="rNota" placeholder="Nota opcional: cuenta, resultado, detalle" style="flex:1;min-width:180px;padding:8px;border:1px solid var(--borde);border-radius:8px;font:inherit"><button class="btn p ch" id="rAnalizar" disabled>Analizar</button></div>
     <div class="estado" id="rSel" style="margin-top:6px"></div><div id="rLista" style="margin-top:8px"></div></section>
   </details>
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
    <section class="card" id="cDis" style="display:none"><div class="fila" style="justify-content:space-between"><h2>Slides</h2><button class="btn ch" id="cAEstr">Volver a la estructura</button></div><div class="slides" id="cCanvas"></div><label class="estado">Estilo <select id="dEstilo" style="padding:7px;border:1px solid var(--borde);border-radius:8px;font:inherit"></select></label>
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
var RSL = "", W = 1080, H = 1350, AZUL = "#3B4796", CREMA = "#F3EFE8", ACENTO = "#3B4796", FAM = '"Patrick Hand", "Comic Sans MS", cursive', PESO = "", KS = 1, ESTILOS_S = {}, EST = {}, LH = 1.16;
var FAMS = { mano: ['"Patrick Hand", "Comic Sans MS", cursive', ""], sans: ['system-ui, "Segoe UI", Arial, sans-serif', "bold "], serif: ['Georgia, "Times New Roman", serif', "bold "], display: ['"Anton", Impact, "Arial Narrow", sans-serif', ""], display2: ['"Archivo Black", "Arial Black", sans-serif', ""], noticia: ['system-ui, "Segoe UI", Roboto, Arial, sans-serif', "500 "] };
function fuente() { if (FUENTE) return FUENTE; FUENTE = (document.fonts && document.fonts.load ? Promise.all([document.fonts.load('64px "Patrick Hand"'), document.fonts.load('64px "Anton"'), document.fonts.load('64px "Archivo Black"'), document.fonts.ready]) : Promise.resolve()).catch(function () {}); return FUENTE; }
function pesos(n) { return n == null ? null : "$" + Math.round(n).toLocaleString("es-AR"); }
function datosC() { var d = CC.datos || {}; var dif = d.precio_ml && d.costo ? d.precio_ml - d.costo : null; return { producto: d.producto || "", precio_ml: pesos(d.precio_ml), costo: pesos(d.costo), diferencia: pesos(dif), total: dif != null && d.cantidad ? pesos(dif * d.cantidad) : null, cantidad: d.cantidad ? String(d.cantidad) : null }; }
function rell(t) { var v = datosC(); var r = String(t || ""); if (EST.minus) r = r.toLowerCase(); if (EST.mayus || (EST.portadaMayus && RSL === "portada")) r = r.toUpperCase(); return r.replace(/\{(producto|precio_ml|costo|diferencia|total|cantidad)\}/g, function (m, k) { return v[k] || "[" + k.replace("_", " ") + "]"; }); }
function cargarImg(src) { if (!src) return Promise.resolve(null); if (IMGS[src]) return IMGS[src]; IMGS[src] = new Promise(function (ok) { var i = new Image(); i.onload = function () { ok(i); }; i.onerror = function () { ok(null); }; i.src = src; }); return IMGS[src]; }
function aplicarEstilo() { var s = ESTILOS_S[(CC && CC.datos && CC.datos.estilo) || "manuscrito"] || ESTILOS_S.manuscrito || { fondo: CREMA, tinta: AZUL, acento: AZUL, fuente: "mano" }; if (CC && CC.datos && CC.datos.colores) s = Object.assign({}, s, CC.datos.colores); CREMA = s.fondo; AZUL = s.tinta; ACENTO = s.acento || s.tinta; var f = FAMS[s.fuente] || FAMS.mano; FAM = f[0]; PESO = f[1]; EST = s; LH = /display/.test(s.fuente || "") ? 1.02 : 1.16; }
// Texto con *resaltado*: los asteriscos prenden y apagan el color de acento (no se dibujan ni se miden)
function sinMarca(t) { return String(t).replace(/\*/g, ""); }
function segs(l, on) { var out = [], cur = ""; for (var k = 0; k < l.length; k++) { if (l[k] === "*") { if (cur) out.push({ t: cur, on: on }); cur = ""; on = !on; } else cur += l[k]; } if (cur) out.push({ t: cur, on: on }); return { s: out, on: on }; }
var GRANO = null;
function grano(ctx) { if (!GRANO) { GRANO = document.createElement("canvas"); GRANO.width = GRANO.height = 256; var g = GRANO.getContext("2d"), im = g.createImageData(256, 256); for (var p = 0; p < im.data.length; p += 4) { var v = Math.random() * 255; im.data[p] = im.data[p + 1] = im.data[p + 2] = v; im.data[p + 3] = 22; } g.putImageData(im, 0, 0); } ctx.save(); ctx.fillStyle = ctx.createPattern(GRANO, "repeat"); ctx.fillRect(0, 0, W, H); ctx.restore(); }
function fnt(sz) { return PESO + sz + "px " + FAM; }
function partir(ctx, txt, maxW, sz) {
  ctx.font = fnt(sz); var out = [];
  String(txt).split("\n").forEach(function (par) { var pal = par.split(" "), l = ""; pal.forEach(function (p) { var t = l ? l + " " + p : p; if (ctx.measureText(sinMarca(t)).width > maxW && l) { out.push(l); l = p; } else l = t; }); out.push(l); });
  return out;
}
// Bloques: texto {t, sz, al:"c"|"l", sub:bool, gap}, img {img, mw, mh, card}, avatar, barras {...}, hr, esp
function medir(ctx, b) { var pv = PESO; if (b.peso) PESO = b.peso; try { return medir0(ctx, b); } finally { PESO = pv; } }
function medir0(ctx, b) {
  if (b.k === "t") { var mw = b.al === "c" ? 900 : 860; b.lines = partir(ctx, b.t, mw, b.sz); ctx.font = fnt(b.sz); var anch = Math.max.apply(null, b.lines.map(function (l) { return ctx.measureText(sinMarca(l)).width; })); if (anch > mw) { b.sz = Math.floor(b.sz * mw / anch); b.lines = partir(ctx, b.t, mw, b.sz); } b.h = b.lines.length * b.sz * LH + (b.sub ? 26 : 0) + (b.box ? b.lines.length * 30 : 0); }
  else if (b.k === "img") { if (!b.img) { b.w = b.mw * 0.8; b.h = b.mh * 0.55; } else { var r = Math.min(b.mw / b.img.width, b.mh / b.img.height); b.w = b.img.width * r; b.h = b.img.height * r; } }
  else if (b.k === "av") b.h = b.oculto ? 0 : 80 * (b.sc || 1);
  else if (b.k === "ico") b.h = 130 * b.sc; else if (b.k === "bar") b.h = 330; else if (b.k === "hr") b.h = 26; else if (b.k === "esp") b.h = b.h || 30;
  return b.h + (b.gap == null ? 22 : b.gap);
}
function dibujar(ctx, b, y, d) { var pv = PESO; if (b.peso) PESO = b.peso; try { return dibujar0(ctx, b, y, d); } finally { PESO = pv; } }
function dibujar0(ctx, b, y, d) {
  var tinta = b.color || (EST.fondo2 ? (y + (b.h || 0) / 2 < H / 2 ? AZUL : (EST.tinta2 || ACENTO)) : AZUL);
  ctx.fillStyle = tinta; ctx.strokeStyle = tinta; ctx.textBaseline = "top";
  if (b.k === "t") {
    ctx.font = fnt(b.sz); ctx.textAlign = "left"; var x = b.al === "c" ? W / 2 : 110, maxw = 0, on = false;
    if (EST.fotoFondo || EST.fuente === "display" || EST.fuente === "display2") { ctx.shadowColor = EST.fotoFondo ? "rgba(0,0,0,.55)" : "rgba(0,0,0,0)"; ctx.shadowBlur = EST.fotoFondo ? 18 : 0; }
    b.lines.forEach(function (l, i) {
      var r = segs(l, on), ancho = ctx.measureText(sinMarca(l)).width, xx = b.al === "c" ? x - ancho / 2 : x, yl = y + i * (b.sz * LH + (b.box ? 30 : 0)) + (b.box ? 15 : 0);
      if (b.box) { ctx.save(); ctx.shadowBlur = 0; rr(ctx, xx - 22, yl - 14, ancho + 44, b.sz * 1.02 + 24, 8); if (b.box === "fill") { ctx.fillStyle = ACENTO; ctx.fill(); } else { ctx.fillStyle = "rgba(0,0,0,.35)"; ctx.fill(); ctx.lineWidth = 4; ctx.strokeStyle = ACENTO; ctx.stroke(); } ctx.restore(); }
      r.s.forEach(function (sg) { var w = ctx.measureText(sg.t).width; ctx.fillStyle = sg.on ? ACENTO : tinta; ctx.fillText(sg.t, xx, yl); if (sg.on && EST.subrayar && sg.t.trim()) { ctx.fillRect(xx, yl + b.sz * 0.98, w - (/ $/.test(sg.t) ? ctx.measureText(" ").width : 0), Math.max(4, b.sz * 0.06)); } xx += w; });
      on = r.on; maxw = Math.max(maxw, ancho);
    });
    ctx.shadowBlur = 0; ctx.fillStyle = tinta;
    if (b.sub) { var yy = y + b.lines.length * b.sz * LH + 6, x0 = b.al === "c" ? W / 2 - maxw / 2 - 10 : x - 6, x1 = x0 + maxw + 20; ctx.strokeStyle = ACENTO; ctx.lineWidth = 6; ctx.lineCap = "round"; ctx.beginPath(); ctx.moveTo(x0, yy + 4); ctx.quadraticCurveTo((x0 + x1) / 2, yy - 4, x1, yy + 2); ctx.stroke(); }
  } else if (b.k === "img") {
    var x = (W - b.w) / 2;
    if (!b.img) { ctx.save(); ctx.setLineDash([14, 12]); ctx.lineWidth = 4; ctx.strokeStyle = "#B8BEDC"; ctx.strokeRect(x, y, b.w, b.h); ctx.restore(); ctx.font = fnt(46); ctx.textAlign = "center"; ctx.fillStyle = "#8C94C4"; ctx.fillText("Subí la foto de este slide", W / 2, y + b.h / 2 - 24); return; }
    var f = b.fx || {}; ctx.save();
    var sc = f.escala || 1, cx = x + b.w / 2 + (f.dx || 0), cy = y + b.h / 2 + (f.dy || 0);
    if (f.piso) { ctx.save(); ctx.filter = "blur(" + (14 + f.piso * 6) + "px)"; ctx.fillStyle = "rgba(25,30,60," + (0.12 + f.piso * 0.08) + ")"; ctx.beginPath(); ctx.ellipse(cx, cy + b.h * sc / 2 + 6, b.w * sc * 0.42, 16 + f.piso * 5, 0, 0, 7); ctx.fill(); ctx.restore(); }
    ctx.translate(cx, cy); ctx.rotate((f.rot || 0) * Math.PI / 180); ctx.scale(sc, sc); ctx.translate(-x - b.w / 2, -y - b.h / 2);
    var filt = []; if (f.brillo) filt.push("brightness(" + f.brillo + "%)"); if (f.contraste) filt.push("contrast(" + f.contraste + "%)"); if (f.saturacion != null) filt.push("saturate(" + f.saturacion + "%)");
    if (f.sombra) { ctx.shadowColor = "rgba(20,25,55," + (0.18 + f.sombra * 0.1) + ")"; ctx.shadowBlur = 12 + f.sombra * 14; ctx.shadowOffsetX = 4 * f.sombra; ctx.shadowOffsetY = 8 * f.sombra; }
    if (f.redondeo && !b.card) { var cv2 = document.createElement("canvas"); cv2.width = b.w; cv2.height = b.h; var c2 = cv2.getContext("2d"); rr(c2, 0, 0, b.w, b.h, f.redondeo); c2.clip(); c2.drawImage(b.img, 0, 0, b.w, b.h); b = Object.assign({}, b, { img: cv2 }); }
    if (filt.length) ctx.filter = filt.join(" ");
    if (b.card) { ctx.save(); ctx.shadowColor = "rgba(30,40,90,.22)"; ctx.shadowBlur = 40; ctx.shadowOffsetY = 14; rr(ctx, x - 14, y - 14, b.w + 28, b.h + 28, 26); ctx.fillStyle = "#fff"; ctx.fill(); ctx.restore(); ctx.save(); rr(ctx, x, y, b.w, b.h, 16); ctx.clip(); ctx.drawImage(b.img, x, y, b.w, b.h); ctx.restore(); }
    else ctx.drawImage(b.img, x, y, b.w, b.h);
    ctx.restore();
  } else if (b.k === "ico") { var tt = 130 * b.sc; icono(ctx, b.n, null, b.sc * 130 / 150, [(b.al === "l" ? 104 : (W - tt) / 2) + b.dx, y + b.dy], 0, 0, b.col, b.gr);
  } else if (b.k === "av") {
    if (b.oculto) return;
    if ((b.sc && b.sc !== 1) || b.dy) { var bb = Object.assign({}, b, { sc: 1, dy: 0 }); ctx.save(); ctx.translate(W / 2, y + (b.dy || 0)); ctx.scale(b.sc || 1, b.sc || 1); ctx.translate(-W / 2, 0); dibujar(ctx, bb, 0, d); ctx.restore(); return; }
    ctx.font = fnt(56); var t = "@" + USUARIO, tw = ctx.measureText(t).width, tot = 72 + 18 + tw + 14 + 34, x = W / 2 - tot / 2, cy = y + 40;
    ctx.save(); ctx.beginPath(); ctx.arc(x + 36, cy, 36, 0, 7); ctx.fillStyle = "#fff"; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = "#D6D9EA"; ctx.stroke(); ctx.clip(); if (d.logo) ctx.drawImage(d.logo, x, cy - 36, 72, 72); ctx.restore();
    ctx.fillStyle = AZUL; ctx.textAlign = "left"; ctx.textBaseline = "middle"; ctx.fillText(t, x + 90, cy + 2);
    var bx = x + 90 + tw + 14 + 17; ctx.beginPath(); ctx.arc(bx, cy, 16, 0, 7); ctx.fillStyle = "#3897F0"; ctx.fill(); ctx.strokeStyle = "#fff"; ctx.lineWidth = 4; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.beginPath(); ctx.moveTo(bx - 7, cy); ctx.lineTo(bx - 2, cy + 5); ctx.lineTo(bx + 8, cy - 6); ctx.stroke(); ctx.textBaseline = "top";
  } else if (b.k === "bar") {
    var va = numC(b.av), vb = numC(b.bv), mx = Math.max(va || 1, vb || 1), ancho = 560;
    ctx.font = fnt(60); ctx.textAlign = "left"; ctx.fillText(b.al_, 110, y);
    var wa = Math.max(60, ancho * (va || 0) / mx); ctx.fillRect(110, y + 64, wa, 84); ctx.fillText(b.av_, 110 + wa + 26, y + 80);
    ctx.fillText(b.bl_, 110, y + 176);
    var wb = Math.max(60, ancho * (vb || 0) / mx); ctx.save(); ctx.beginPath(); ctx.rect(110, y + 240, wb, 84); ctx.clip(); ctx.lineWidth = 14; for (var s = -100; s < wb + 100; s += 34) { ctx.beginPath(); ctx.moveTo(110 + s, y + 324); ctx.lineTo(110 + s + 84, y + 240); ctx.stroke(); } ctx.restore();
    ctx.fillText(b.bv_, 110 + wb + 26, y + 256);
  } else if (b.k === "hr") { ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(110, y + 12); ctx.lineTo(W - 150, y + 12); ctx.stroke(); }
}
// Íconos dibujados a mano (gratis, sin imágenes): trazos simples en el color de acento
function icono(ctx, n, pos, sc, xy, dx, dy, col, gr) {
  var t = 150 * sc, m = 70, P = xy || { abajo_der: [W - m - t, H - m - t], abajo_izq: [m, H - m - t], abajo_centro: [(W - t) / 2, H - m - t], arriba_der: [W - m - t, m], arriba_izq: [m, m], centro: [(W - t) / 2, (H - t) / 2], derecha: [W - m - t, (H - t) / 2], izquierda: [m, (H - t) / 2] }[pos] || [W - m - t, H - m - t];
  ctx.save(); ctx.translate(Math.max(10, Math.min(W - t - 10, P[0] + (dx || 0))), Math.max(10, Math.min(H - t - 10, P[1] + (dy || 0)))); ctx.scale(t / 100, t / 100); ctx.strokeStyle = col || ACENTO; ctx.fillStyle = col || ACENTO; ctx.lineWidth = gr || 9; ctx.lineCap = "round"; ctx.lineJoin = "round";
  var L = function (pts) { ctx.beginPath(); pts.forEach(function (p, k) { if (k) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]); }); ctx.stroke(); };
  var C = function (x, y, r, f) { ctx.beginPath(); ctx.arc(x, y, r, 0, 7); if (f) ctx.fill(); else ctx.stroke(); };
  var R = function (x, y, w, h, r) { rr(ctx, x, y, w, h, r); ctx.stroke(); };
  if (n === "flecha_der") { L([[10, 50], [88, 50]]); L([[60, 22], [88, 50], [60, 78]]); }
  else if (n === "flecha_izq") { L([[90, 50], [12, 50]]); L([[40, 22], [12, 50], [40, 78]]); }
  else if (n === "flecha_abajo") { L([[50, 10], [50, 88]]); L([[22, 60], [50, 88], [78, 60]]); }
  else if (n === "flecha_arriba") { L([[50, 90], [50, 12]]); L([[22, 40], [50, 12], [78, 40]]); }
  else if (n === "check") { C(50, 50, 44); L([[28, 52], [44, 68], [74, 36]]); }
  else if (n === "cruz") { C(50, 50, 44); L([[32, 32], [68, 68]]); L([[68, 32], [32, 68]]); }
  else if (n === "alerta") { L([[50, 8], [94, 88], [6, 88], [50, 8]]); L([[50, 38], [50, 62]]); C(50, 75, 4, true); }
  else if (n === "dolar") { C(50, 50, 44); L([[50, 18], [50, 82]]); ctx.beginPath(); ctx.moveTo(66, 34); ctx.bezierCurveTo(60, 24, 32, 24, 34, 40); ctx.bezierCurveTo(36, 54, 66, 46, 66, 62); ctx.bezierCurveTo(66, 76, 38, 76, 33, 66); ctx.stroke(); }
  else if (n === "caja") { L([[10, 30], [50, 12], [90, 30], [90, 74], [50, 92], [10, 74], [10, 30]]); L([[10, 30], [50, 48], [90, 30]]); L([[50, 48], [50, 92]]); }
  else if (n === "avion") { L([[8, 58], [92, 30], [70, 84], [52, 62], [8, 58]]); L([[52, 62], [92, 30]]); }
  else if (n === "camion") { R(6, 30, 56, 40, 4); L([[62, 42], [80, 42], [94, 56], [94, 70], [62, 70]]); C(26, 76, 9); C(76, 76, 9); }
  else if (n === "barco") { L([[6, 60], [94, 60], [80, 86], [20, 86], [6, 60]]); R(26, 34, 22, 26, 2); R(52, 24, 22, 36, 2); }
  else if (n === "celular") { R(26, 6, 48, 88, 10); L([[42, 80], [58, 80]]); }
  else if (n === "whatsapp") { C(52, 48, 40); L([[22, 74], [14, 94], [36, 86]]); ctx.beginPath(); ctx.moveTo(38, 34); ctx.quadraticCurveTo(40, 64, 68, 64); ctx.stroke(); }
  else if (n === "carrito") { L([[6, 16], [22, 16], [32, 66], [84, 66], [94, 30], [26, 30]]); C(38, 84, 7, true); C(78, 84, 7, true); }
  else if (n === "candado") { R(18, 44, 64, 50, 8); ctx.beginPath(); ctx.arc(50, 44, 22, Math.PI, 0); ctx.stroke(); C(50, 68, 6, true); }
  else if (n === "estrella") { var pt = []; for (var k = 0; k < 11; k++) { var a = -Math.PI / 2 + k * Math.PI / 5, r2 = k % 2 ? 20 : 46; pt.push([50 + r2 * Math.cos(a), 52 + r2 * Math.sin(a)]); } L(pt); }
  else if (n === "fuego") { ctx.beginPath(); ctx.moveTo(50, 94); ctx.bezierCurveTo(16, 92, 12, 60, 30, 40); ctx.bezierCurveTo(30, 54, 40, 58, 44, 54); ctx.bezierCurveTo(36, 30, 52, 14, 56, 6); ctx.bezierCurveTo(60, 30, 90, 44, 84, 70); ctx.bezierCurveTo(80, 88, 64, 94, 50, 94); ctx.stroke(); }
  else if (n === "reloj") { C(50, 50, 44); L([[50, 24], [50, 50], [70, 62]]); }
  else if (n === "mano") { L([[30, 92], [30, 40], [30, 18]]); ctx.beginPath(); ctx.arc(38, 18, 8, Math.PI, 0); ctx.stroke(); L([[46, 18], [46, 48]]); L([[46, 44], [46, 36], [58, 36], [58, 50]]); L([[58, 42], [70, 42], [70, 54]]); L([[70, 48], [80, 48], [80, 74], [66, 92], [30, 92]]); }
  ctx.restore();
}
function numC(t) { var m = String(t || "").replace(/\./g, "").match(/\d+/); return m ? +m[0] : 0; }
function rr(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
function bloques(s, i, d) {
  var out = bloques0(s, i, d), ds = (CC.datos && CC.datos.dis && CC.datos.dis[i]) || {};
  if (ds.icono && (ds.icono_pos || "debajo") === "debajo") { var alx = ds.al || (EST.al === "l" && s.tipo !== "cta" ? "l" : "c"); out = out.concat({ k: "ico", n: ds.icono, col: ds.icono_color, gr: ds.icono_grosor, sc: ds.icono_escala || 1, al: alx, dx: ds.icono_dx || 0, dy: ds.icono_dy || 0, gap: 0 }); }
  return out;
}
function bloques0(s, i, d) {
  RSL = s.tipo;
  var disp = /display/.test(EST.fuente || ""), izq = EST.al === "l" && s.tipo !== "cta", dis = (CC.datos && CC.datos.dis && CC.datos.dis[i]) || {};
  var T = function (t, sz, al, ex) { if (disp && sz >= 90) sz = sz * 1.22; return Object.assign({ k: "t", t: rell(t),sz: Math.round(sz * (sz < 90 ? 1.16 : 1.08) * KS * (dis.texto || 1)), al: dis.al || (izq ? "l" : (al || "c")) }, ex || {}); }, out = [];
  var foto = d.fotos[i], fx = (CC.datos && CC.datos.fx && CC.datos.fx[i]) || null;
  if (EST.etiquetas) {   // estilo con etiquetas: títulos en caja naranja y listas en cajas con borde
    var tit = function (t, sz) { return T(t, sz || 74, "c", { box: "fill", gap: 34 }); }, pill = function (t) { return T(t, 50, "c", { box: "line", gap: 18 }); };
    if (s.tipo === "portada" && !EST.fotoFondo) out = [{ k: "img", img: foto, fx: fx, mw: 760, mh: 640, gap: 40 }, T(s.titulo, 88, "c", { gap: 20 }), tit(s.subtitulo, 60)];
    else if (s.tipo === "portada") out = [T(s.titulo, 104, "c", { gap: 24 }), s.subtitulo ? tit(s.subtitulo, 56) : { k: "esp", h: 1 }];
    else if (s.tipo === "lista") { out = [tit(s.titulo)]; (s.items || []).forEach(function (it) { out.push(pill(it)); }); }
    else if (s.tipo === "texto") { out = [tit(s.titulo)]; (s.parrafos || []).forEach(function (p) { out.push(pill(p)); }); }
    else if (s.tipo === "numero") out = [s.arriba ? tit(s.arriba, 60) : { k: "esp", h: 1 }, T(s.numero, 210, "c", { gap: 24 }), T(s.abajo, 64)];
    else if (s.tipo === "grande") out = [T(s.texto, 96, "c", { gap: 30 }), s.abajo ? tit(s.abajo, 54) : { k: "esp", h: 1 }];
    if (out.length) return out;
  }
  if (EST.etiqueta && (s.tipo === "portada" || s.tipo === "grande")) { var tx = s.tipo === "portada" ? s.titulo : s.texto; out = [T(EST.etiqueta, 44, "c", { box: "fill", gap: 22 }), T(tx, 104, "c", { gap: 20 })]; if (s.tipo === "portada" && s.subtitulo) out.push(T(s.subtitulo, 52, "c", { gap: 10 })); return out; }
  if (s.tipo === "portada" && EST.fotoSoloPortada) { out = [T(s.titulo, 92, "c", { gap: 24, peso: "bold " }), T(s.subtitulo, 54, "c", { gap: 20 })]; }
  else if (s.tipo === "portada" && EST.fotoFondo) out = [T(s.titulo, 128, "l", { sub: false, gap: 40 }), T(s.subtitulo, 60, "c", { gap: 60 }), { k: "av" }];
  else if (s.tipo === "portada") out = [{ k: "img", img: foto, fx: fx, mw: 640, mh: 560, gap: 50 }, T(s.titulo, 96), T(s.subtitulo, 60, "c", { gap: 70 }), { k: "av" }];
  else if (s.tipo === "captura") out = [T(s.arriba, 100, "c", { gap: 50 }), { k: "img", img: foto, fx: fx, mw: 860, mh: 520, card: true, gap: 70 }, T(s.abajo, 64)];
  else if (s.tipo === "numero") out = [T(s.arriba, 70, "c", { gap: 30 }), T(s.numero, 200, "c", { sub: true, gap: 40 }), T(s.abajo, 64)];
  else if (s.tipo === "suma") { out = [T(s.titulo, 100, "l", { gap: 50 })]; (s.items || []).forEach(function (it, k) { out.push(T((k ? "+ " : "   ") + it, 62, "l", { gap: 10 })); }); out.push({ k: "hr", gap: 20 }, T(s.total, 92, "l")); }
  else if (s.tipo === "barras") out = [T(s.titulo, 100, "l", { gap: 50 }), { k: "bar", al_: rell(s.a_label), av_: rell(s.a_valor), av: rell(s.a_valor), bl_: rell(s.b_label), bv_: rell(s.b_valor), bv: rell(s.b_valor), gap: 50 }, T(s.conclusion, 84, "l")];
  else if (s.tipo === "texto") { out = [T(s.titulo, 100, "l", { gap: 40 })]; (s.parrafos || []).forEach(function (p) { out.push(T(p, 62, "l", { gap: 28 })); }); }
  else if (s.tipo === "multiplicacion") out = [T(s.arriba, 66, "c", { gap: 30 }), T(s.linea, 96, "c", { sub: true, gap: 40 }), T(s.numero, 150, "c", { gap: 26 }), T(s.abajo, 62)];
  else if (s.tipo === "lista") { out = [T(s.titulo, 104, "l", { gap: 44, color: EST.tituloAcento ? ACENTO : null })]; (s.items || []).forEach(function (it, k) { out.push(T((EST.tituloAcento ? "• " : (k + 1) + ". ") + it, 62, "l", { gap: 22 })); }); }
  else if (s.tipo === "cta") out = [{ k: "av", gap: 40 }, T(s.texto, 66, "c", { gap: 30 }), (function () { var p = String(s.palabra || "").trim(); if (!p) return { k: "esp", h: 1 }; var frase = /\s/.test(p) || /^(link|bio|whatsapp|dm|perfil)/i.test(p); return T(frase ? p.toUpperCase() : "Comentá “" + p.toUpperCase() + "”", 112, "c", { gap: 20 }); })(), T(s.abajo, 66)];
  else if (s.tipo === "grande") out = [T(s.texto, disp ? 104 : 150, "c", { sub: !disp, gap: 50 }), T(s.abajo, 66)];
  else if (s.tipo === "versus" && EST.fondo2) out = [T(s.a_label, 130, "c", { gap: 16 }), T(s.a_texto, 58, "c", { gap: 150 }), T(s.b_label, 130, "c", { gap: 16 }), T(s.b_texto, 58, "c")];
  else if (s.tipo === "versus") out = [T(s.titulo, 96, "l", { gap: 40 }), T(s.a_label, 78, "l", { sub: true, gap: 8 }), T(s.a_texto, 60, "l", { gap: 50 }), T(s.b_label, 78, "l", { sub: true, gap: 8 }), T(s.b_texto, 60, "l")];
  return out;
}
function render(canvas, s, i, d) {
  var ctx = canvas.getContext("2d"); canvas.width = W; canvas.height = H; aplicarEstilo();
  var bl, tot;
  for (KS = 1; ; KS -= 0.08) { bl = bloques(s, i, d); tot = 0; bl.forEach(function (b) { tot += medir(ctx, b); }); if (tot <= H - 140 || KS <= 0.5) break; }
  KS = 1;
  ctx.fillStyle = CREMA; ctx.fillRect(0, 0, W, H);
  if (EST.fondo2) { ctx.fillStyle = EST.fondo2; ctx.fillRect(0, H / 2, W, H / 2); }
  if (EST.fondo3) { var rg = ctx.createRadialGradient(W / 2, H * 0.42, 60, W / 2, H * 0.42, W * 0.9); rg.addColorStop(0, EST.fondo3); rg.addColorStop(1, CREMA); ctx.fillStyle = rg; ctx.fillRect(0, 0, W, H); }
  // con foto de fondo, los slides sin foto propia usan la última foto cargada antes (o la primera del carrusel)
  var fotoF = null; var soloP = EST.fotoSoloPortada || (CC.datos && CC.datos.foto_solo_portada); if (EST.fotoFondo && soloP && s.tipo !== "portada") fotoF = d.fotos[i] || null; else if (EST.fotoFondo) { for (var q = i; q >= 0 && !fotoF; q--) fotoF = d.fotos[q]; if (!fotoF) Object.keys(d.fotos).forEach(function (k) { fotoF = fotoF || d.fotos[k]; }); }
  var fondoFoto = EST.fotoFondo && fotoF;
  if (fondoFoto) { var im = fotoF, rz = Math.max(W / im.width, H / im.height); ctx.drawImage(im, (W - im.width * rz) / 2, (H - im.height * rz) / 2, im.width * rz, im.height * rz); var gr = ctx.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, "rgba(0,0,0,.35)"); gr.addColorStop(1, "rgba(0,0,0,.72)"); ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H); }
  if (EST.grano) grano(ctx);
  if (EST.marcaArriba) { ctx.save(); ctx.font = PESO + "30px " + FAM; ctx.textAlign = "center"; ctx.textBaseline = "top"; ctx.fillStyle = "rgba(255,255,255,.75)"; ctx.fillText(USUARIO.toUpperCase(), W / 2, 42); ctx.restore(); }
  var dis0 = (CC.datos && CC.datos.dis && CC.datos.dis[i]) || {};
  bl.forEach(function (b) { if (b.k === "av") { b.sc = dis0.usuario_escala || 1; b.dy = dis0.usuario_dy || 0; b.oculto = dis0.usuario === 0; } });
  if (dis0.usuario_escala || dis0.usuario === 0) { tot = 0; bl.forEach(function (b) { tot += medir(ctx, b); }); }
  var y = (EST.abajo || (EST.fotoSoloPortada && s.tipo === "portada") ? Math.max(70, H - tot - 110) : Math.max(70, (H - tot) / 2 + 10)) + (dis0.dy || 0);
  bl.forEach(function (b) { dibujar(ctx, b, y, d); y += b.h + (b.gap == null ? 22 : b.gap); });
  var dis = (CC.datos && CC.datos.dis && CC.datos.dis[i]) || {};
  if (dis.icono && (dis.icono_pos || "debajo") !== "debajo") icono(ctx, dis.icono, dis.icono_pos, dis.icono_escala || 1, null, dis.icono_dx || 0, dis.icono_dy || 0, dis.icono_color, dis.icono_grosor);
  if (EST.fondo2 && s.tipo === "versus") { ctx.font = fnt(92); ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillStyle = EST.acento || "#fff"; ctx.fillText("vs", W / 2, H / 2); ctx.textBaseline = "top"; }
}
function recursos() {
  var f = (CC.datos && CC.datos.fotos) || {}, ps = [fuente(), cargarImg("/panel/api/carruseles/logo")];
  Object.keys(f).forEach(function (k) { ps.push(cargarImg("/panel/api/carruseles/img?key=" + encodeURIComponent(f[k]) + "&v=" + (CC.fv || 0))); });
  return Promise.all(ps).then(function (r) { var d = { logo: r[1], fotos: {} }, i = 2; Object.keys(f).forEach(function (k) { d.fotos[k] = r[i++]; }); return d; });
}
function pintarCanvas() {
  aplicarEstilo();
  return recursos().then(function (d) {
    $("#cCanvas").innerHTML = CC.slides.map(function (s, i) { return '<div class="slc"><span class="n">' + (i + 1) + " · " + esc((TIPOS_S[s.tipo] || {}).nombre || s.tipo) + '</span><canvas data-i="' + i + '"></canvas>' + ((TIPOS_S[s.tipo] || {}).foto || EST.fotoFondo ? '<label class="btn ch" style="text-align:center;cursor:pointer">' + (CC.datos.fotos && CC.datos.fotos[i] ? "Cambiar foto" : "Subir foto de este slide") + '<input type="file" accept="image/*" data-foto="' + i + '" style="display:none"></label>' : "") + "</div>"; }).join("");
    document.querySelectorAll("#cCanvas canvas").forEach(function (cv) { render(cv, CC.slides[+cv.dataset.i], +cv.dataset.i, d); var inp = cv.parentNode.querySelector("input[data-foto]"); if (inp) { cv.style.cursor = "pointer"; cv.title = "Tocá para subir la foto"; cv.onclick = function () { inp.click(); }; } });
  });
}
function cargarCarr() {
  CAPI("lista").then(function (r) {
    CL = r; USUARIO = r.usuario || USUARIO; TIPOS_S = r.tipos || {}; pintarRefs(r.referencias);
    ESTILOS_S = r.estilos || {}; $("#dEstilo").innerHTML = Object.keys(ESTILOS_S).map(function (k) { return '<option value="' + k + '">' + esc(ESTILOS_S[k].nombre) + "</option>"; }).join(""); if (document.activeElement !== $("#cDir")) $("#cDir").value = r.direccion || ""; if (document.activeElement !== $("#cMemoria")) $("#cMemoria").value = r.memoria || "";
    var tarjeta = function (c) { return '<div class="ccard" data-c="' + c.id + '"><span class="pill n" style="align-self:flex-start">' + (EST_C[c.estado] || c.estado) + "</span><h3>" + esc(c.titulo) + '</h3><div class="pq">' + esc(c.por_que || "") + '</div><div class="fila" style="margin-top:auto"><button class="btn ch" data-desc="' + c.id + '">Descartar</button></div><div class="dform" style="display:none"><textarea placeholder="¿Por qué la descartás? (opcional, cuanto mejor lo expliques, más aprende)" style="width:100%;min-height:70px;border:1px solid var(--borde);border-radius:8px;padding:8px;font:inherit;font-size:13px"></textarea><div class="fila" style="margin-top:6px"><button class="btn p ch" data-descok="' + c.id + '">Descartar</button><button class="btn ch" data-desccancel="1">Cancelar</button></div></div></div>'; };
    var arm = r.carruseles.filter(function (c) { return ["estructura", "slides", "error"].indexOf(c.estado) >= 0; }), ide = r.carruseles.filter(function (c) { return c.estado === "idea"; }), prog = r.carruseles.filter(function (c) { return ["aprobado", "publicando", "publicado"].indexOf(c.estado) >= 0; });
    $("#cArmado").innerHTML = arm.length ? arm.map(tarjeta).join("") : '<div class="vacio">Nada en armado.</div>';
    $("#cIdeas").innerHTML = ide.length ? ide.map(tarjeta).join("") : '<div class="vacio">No hay ideas. Tocá <b>Generar ideas de carruseles</b>.</div>';
    $("#cProg").innerHTML = prog.length ? prog.map(function (c) { return '<div class="clip" data-c="' + c.id + '"><span><b>' + esc(c.titulo) + "</b> " + (c.estado === "publicado" ? '<span class="pill pr">Publicado</span>' : '<span class="pill n">' + (c.estado === "aprobado" ? "Sale el " + cuando(c.programado_ts) : "Publicando...") + "</span>") + '</span><span class="fila">' + (c.link ? '<a class="btn ch" target="_blank" rel="noopener" href="' + esc(c.link) + '">Ver en Instagram</a>' : "") + (c.estado === "aprobado" ? '<input type="datetime-local" class="f" data-cuando="' + c.id + '" value="' + localDT(c.programado_ts) + '" style="max-width:210px"><button class="btn ch" data-reprog="' + c.id + '">Cambiar horario</button><button class="btn ch" data-frenar="' + c.id + '">Frenar</button>' : "") + "</span></div>"; }).join("") : '<div class="vacio">Nada programado.</div>';
    var reglas = r.reglas || [];
    $("#cReglas").innerHTML = (r.descartes ? '<span class="estado" style="background:none">Aprendió de ' + r.descartes + ' idea' + (r.descartes === 1 ? "" : "s") + " descartada" + (r.descartes === 1 ? "" : "s") + ".</span>" : "") + (reglas.length ? reglas.map(function (x, i) { return "<span>" + esc(x) + '<button data-rb="' + i + '" aria-label="Borrar regla">×</button></span>'; }).join("") : '<span class="estado" style="background:none">Las preferencias de estilo se resumen arriba; acá aparecen las reglas concretas.</span>');
  });
}
function pintarRefs(l) {
  $("#rLista").innerHTML = (l || []).slice().reverse().map(function (x, k) { var i = l.length - 1 - k;
    var imgs = (x.capturas || []).map(function (_, n) { return '<img loading="lazy" alt="Captura de referencia ' + (n + 1) + '" src="/panel/api/carruseles/referencia-img?id=' + encodeURIComponent(x.id || "") + '&n=' + n + '">'; }).join("");
    return '<div class="idea" style="padding:10px"><div class="tit"><b>' + esc(x.gancho) + '</b><span class="fila"><button class="mini btn ch" data-refidea="' + i + '">Usar</button><button class="mini btn ch" data-refb="' + i + '">Borrar</button></span></div>' + (imgs ? '<div class="refimgs">' + imgs + '</div>' : "") + '<div class="pq">' + (x.cuenta ? "@" + esc(x.cuenta) + " · " : "") + esc(x.tema || "") + (x.formato ? " · formato: " + esc(x.formato) : "") + '</div><div class="pq"><b>Estructura:</b> ' + esc((x.estructura || []).join(" → ")) + '</div><div class="pq"><b>Por qué funciona:</b> ' + esc(x.por_que) + '</div><div class="pq"><b>Técnicas:</b> ' + esc((x.tecnicas || []).join(", ")) + '</div>' + (x.adaptacion ? '<div class="pq"><b>Para nosotros:</b> ' + esc(x.adaptacion) + "</div>" : "") + "</div>";
  }).join("") || '<div class="vacio">Todavía no analizaste ninguno.</div>';
}
var RFOTOS = [];
function achicar(f) { return new Promise(function (ok) { var r = new FileReader(); r.onload = function () { var im = new Image(); im.onload = function () { var k = Math.min(1, 1080 / Math.max(im.width, im.height)), c = document.createElement("canvas"); c.width = im.width * k; c.height = im.height * k; c.getContext("2d").drawImage(im, 0, 0, c.width, c.height); ok(c.toDataURL("image/jpeg", 0.85)); }; im.onerror = function () { ok(null); }; im.src = r.result; }; r.readAsDataURL(f); }); }
function habilitarRef() { $("#rAnalizar").disabled = !RFOTOS.length; }
$("#rArch").addEventListener("change", function () { var fs = Array.prototype.slice.call(this.files || []).slice(0, 6); Promise.all(fs.map(achicar)).then(function (l) { RFOTOS = l.filter(Boolean); $("#rSel").textContent = RFOTOS.length ? RFOTOS.length + " capturas listas para analizar" : ""; habilitarRef(); }); });
$("#rLink").addEventListener("input", habilitarRef);
$("#rAnalizar").onclick = function () { var b = this; b.disabled = true; b.textContent = "Analizando..."; CAPI("referencia", { imagenes: RFOTOS, nota: $("#rNota").value, link: $("#rLink").value.trim() }).then(function (r) { b.textContent = "Analizar"; if (!r.ok) { b.disabled = false; return aviso(r.error); } RFOTOS = []; $("#rSel").textContent = ""; $("#rNota").value = ""; $("#rLink").value = ""; pintarRefs(r.referencias); aviso(r.aviso || "Analizado: lo voy a usar en los próximos carruseles"); }); };
$("#rLista").onclick = function (ev) {
  var b = ev.target.closest("[data-refb]"); if (b) return CAPI("referencia-borrar", { i: +b.dataset.refb }).then(function (r) { pintarRefs(r.referencias); });
  var g = ev.target.closest("[data-refidea]"); if (g) { g.disabled = true; g.textContent = "Pensando..."; CAPI("generar-ideas", { ref: +g.dataset.refidea }).then(function (r) { g.disabled = false; g.textContent = "Ideas con esta"; if (!r.ok) return aviso(r.error); aviso(r.cantidad + " ideas nuevas basadas en esa referencia"); cargarCarr(); }); }
};
$("#cMemoriaGuardar").onclick = function () { CAPI("memoria", { texto: $("#cMemoria").value }).then(function (r) { aviso(r.ok ? "Preferencias guardadas" : "No se pudieron guardar"); }); };
$("#c-lista").onclick = function (ev) {
  if (ev.target.closest("#rLista") || ev.target.closest("#rArch") || ev.target.closest("#rAnalizar") || ev.target.closest("#rNota")) return;
  var dd = ev.target.closest("[data-desc]"); if (dd) { var cd = dd.closest(".ccard"); cd.querySelector(".dform").style.display = ""; dd.style.display = "none"; cd.querySelector("textarea").focus(); return; }
  if (ev.target.closest("[data-desccancel]")) { var cc = ev.target.closest(".ccard"); cc.querySelector(".dform").style.display = "none"; cc.querySelector("[data-desc]").style.display = ""; return; }
  var dk = ev.target.closest("[data-descok]"); if (dk) { dk.disabled = true; CAPI("descartar", { id: dk.dataset.descok, motivo: dk.closest(".ccard").querySelector("textarea").value }).then(function (r) { if (!r.ok) { dk.disabled = false; return aviso(r.error || "No se pudo"); } aviso("Descartada: lo tengo en cuenta para las próximas"); cargarCarr(); }); return; }
  if (ev.target.closest(".dform")) return;
  var rb = ev.target.closest("[data-rb]"); if (rb) { CAPI("regla-borrar", { i: +rb.dataset.rb }).then(cargarCarr); return; }
  if (ev.target.closest("[data-cuando]")) { ev.stopPropagation(); return; }   // tocar el calendario no abre el carrusel
  var rp = ev.target.closest("[data-reprog]"); if (rp) { var inp = document.querySelector('[data-cuando="' + rp.dataset.reprog + '"]'), ts = inp && inp.value ? new Date(inp.value).getTime() : 0; if (!ts) return aviso("Elegí fecha y hora"); CAPI("reprogramar", { id: rp.dataset.reprog, cuando: ts }).then(function (r) { if (!r.ok) return aviso(r.error || "No se pudo"); aviso("Listo: sale el " + cuando(r.programado_ts)); cargarCarr(); }); return; }
  var fr = ev.target.closest("[data-frenar]"); if (fr) { CAPI("frenar", { id: fr.dataset.frenar }).then(function (r) { if (!r.ok) return aviso(r.error); cargarCarr(); }); return; }
  if (ev.target.closest("a")) return;
  var t = ev.target.closest("[data-c]"); if (t) abrirCarr(t.dataset.c);
};
$("#bCarrIdeas").onclick = function () { var b = this; b.disabled = true; b.textContent = "Pensando ideas..."; CAPI("generar-ideas", {}).then(function (r) { b.disabled = false; b.textContent = "Generar ideas de carruseles"; if (!r.ok) return aviso(r.error); aviso(r.cantidad + " ideas nuevas"); cargarCarr(); }); };
function abrirCarr(id) {
  CAPI("ver?id=" + encodeURIComponent(id)).then(function (c) {
    if (c.error) return aviso(c.error);
    CC = c; $("#c-lista").style.display = "none"; $("#c-ed").style.display = ""; window.scrollTo(0, 0);
    if (c.estado === "idea") { CC.chat = [{ r: "a", t: "Armando el borrador..." }]; pintarEd(); CAPI("estructura", { id: id }).then(function (r) { if (!r.ok) { CC.chat = [{ r: "a", t: r.error }]; pintarEd(); return; } CC = r; pintarEd(); }); return; }
    pintarEd();
  });
}
$("#cVolver").onclick = function () { CC = null; $("#c-ed").style.display = "none"; $("#c-lista").style.display = ""; cargarCarr(); };
function pintarEd() {
  var c = CC, enSlides = ["slides", "error"].indexOf(c.estado) >= 0, editable = ["idea", "estructura", "slides", "error"].indexOf(c.estado) >= 0;
  $("#cTit").textContent = c.titulo; $("#cPq").textContent = c.por_que || "";
  $("#cPasos").innerHTML = ["1. Estructura", "2. Slides", "3. Programado"].map(function (p, i) { var on = (i === 0 && ["idea", "estructura"].indexOf(c.estado) >= 0) || (i === 1 && enSlides) || (i === 2 && ["aprobado", "publicando", "publicado"].indexOf(c.estado) >= 0); return '<span class="' + (on ? "on" : "") + '">' + p + "</span>"; }).join("");
  var d = c.datos || {};
  $("#dEstilo").value = d.estilo || "manuscrito";
  var usaN = /\{(producto|precio_ml|costo|diferencia|total|cantidad)\}/.test(JSON.stringify(c.slides || [])) || d.precio_ml || d.costo;
  $("#dProd").closest(".datos").style.display = usaN ? "" : "none"; $("#dCalc").style.display = usaN ? "" : "none";
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
var CAMPOS_N = { titulo: "Título", subtitulo: "Subtítulo", arriba: "Texto de arriba", abajo: "Texto de abajo", numero: "Número grande", items: "Ítems (uno por renglón)", total: "Total", a_label: "Barra 1 (nombre)", a_valor: "Barra 1 (valor)", b_label: "Barra 2 (nombre)", b_valor: "Barra 2 (valor)", conclusion: "Conclusión", parrafos: "Párrafos (uno por renglón)", linea: "Cuenta", texto: "Texto", palabra: "Palabra para comentar", a_texto: "Lado 1 (texto)", b_texto: "Lado 2 (texto)" };
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
  CAPI("guardar", { id: CC.id, slides: CC.slides, caption: CC.caption, datos: CC.datos }).then(function () { return CAPI("chat", { id: CC.id, mensaje: m }); }).then(function (r) { if (!r.ok) { CC.chat[CC.chat.length - 1] = { r: "a", t: r.error || "No pude." }; pintarEd(); return; } var fv = CC.fv; CC = r; CC.fv = fv; pintarEd(); if (r.regla || r.memoria) cargarCarr(); });
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
$("#cDescartar").onclick = function () { var m = prompt("¿Por qué lo descartás? (opcional, así aprende)"); if (m === null) return; CAPI("descartar", { id: CC.id, motivo: m }).then(function () { $("#cVolver").onclick(); }); };
$("#cDirGuardar").onclick = function () { CAPI("direccion", { texto: $("#cDir").value }).then(function (r) { aviso(r.ok ? "Dirección guardada" : "No se pudo guardar"); }); };
$("#dEstilo").onchange = function () { CC.datos = Object.assign({}, CC.datos, { estilo: this.value }); guardarCarr(); pintarCanvas(); };
`;
