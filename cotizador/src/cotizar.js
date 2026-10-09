// Cotizador manual: /panel/cotizar
// Pegás links (Alibaba, 1688, etc.) con cantidades y las indicaciones; la IA arma la lista, lee las páginas,
// completa precio y peso, y genera la cotización lista para imprimir/guardar en PDF.
// NO manda ningún mensaje: solo arma el documento.

const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

async function tabla(env) {
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS cotiz_manual (id TEXT PRIMARY KEY, ts INTEGER, num INTEGER, quien TEXT, cliente TEXT, datos TEXT)").run();
}

// Tarifas (las mismas del agente): se pasan desde worker.js
export function calcular(items, opc, T) {
  const its = items.filter((i) => i.cantidad > 0);
  const fob = its.reduce((s, i) => s + (+i.precio || 0) * i.cantidad, 0);
  const kg = its.reduce((s, i) => s + (+i.peso || 0) * i.cantidad, 0);
  const fl = opc.flete != null && opc.flete !== "" ? +opc.flete : kg > T.aereoHasta ? T.barcoFijo : kg >= T.aereoDesde ? T.aereoFijo : kg * T.fleteKg;
  const hand = T.handling, hon = opc.honorarios != null && opc.honorarios !== "" ? +opc.honorarios : T.honorarios;
  const imp = (fob + fl + hand) * (T.factor - 1);
  const total = (fob + fl + hand) * T.factor + hon;
  // Precio unitario puesto: reparte flete por peso, y handling + honorarios por valor
  const filas = its.map((i) => {
    const f = fob ? (i.precio * i.cantidad) / fob : 1 / its.length, p = kg ? (i.peso * i.cantidad) / kg : f;
    const sub = (i.precio * i.cantidad + fl * p + hand * f) * T.factor + hon * f;
    return { ...i, subtotal: sub, unitario: sub / i.cantidad };
  });
  return { filas, fob, kg, flete: fl + hand, imp, hon, total };
}

async function leerItems(env, h, texto, indicaciones, imagenes) {
  const links = [...new Set((String(texto).match(/https?:\/\/[^\s<>"']+/g) || []).map((l) => l.replace(/[),.;]+$/, "")))].slice(0, 30);
  const prompt = `Sos el asistente de cotizaciones de "Te Importamos" (importamos desde China). Te paso un listado que nos mandó un cliente: links de productos con cantidades, y las indicaciones de cómo cotizar.
Armá la lista de productos a cotizar. Cada link es un producto distinto, salvo que el texto diga otra cosa. Si un producto no tiene link, igual incluilo.
Para cada uno devolvé: link (exacto, o ""), nombre (corto y claro en español, 2-6 palabras), variante (color/talle/modelo si lo dice, o ""), cantidad (número; si no dice, 0), nota (lo que aclare el cliente, o "").
Si hay capturas, leé de ahí precios por cantidad (tramos) y peso de cada producto y asignalos al producto que corresponda: tramos [{desde, precio_usd}], peso_kg por unidad.
Del texto de indicaciones sacá: cliente (nombre o ""), honorarios (número si lo indica, o null), mostrar_desglose (true/false, true por defecto), notas_pdf (aclaraciones para poner en la cotización, o "").
Respondé JSON: {"items":[{"link","nombre","variante","cantidad","nota","tramos","peso_kg"}],"cliente","honorarios","mostrar_desglose","notas_pdf"}

LISTADO:
${String(texto).slice(0, 12000)}

INDICACIONES:
${String(indicaciones || "").slice(0, 3000)}`;
  const r = (imagenes?.length ? await h.iaConImagenes(env, prompt, imagenes) : await h.iaJSON(env, prompt)) || {};
  let items = Array.isArray(r.items) ? r.items : [];
  if (!items.length) items = links.map((l) => ({ link: l, nombre: "", cantidad: 0 }));
  for (const l of links) if (!items.some((i) => i.link === l)) items.push({ link: l, nombre: "", cantidad: 0 });
  items = items.slice(0, 30);
  // Leer cada página (en paralelo)
  await Promise.all(items.map(async (it) => {
    it.cantidad = Math.max(0, parseInt(it.cantidad) || 0);
    it.tramos = (Array.isArray(it.tramos) ? it.tramos : []).map((t) => ({ desde: +t.desde || 1, precio: +(t.precio_usd ?? t.precio) || 0 })).filter((t) => t.precio > 0);
    it.peso = +it.peso_kg || 0; delete it.peso_kg;
    it.origen = it.tramos.length ? "captura" : "";
    if (!it.link) return;
    const p = await h.leerPagina(it.link).catch(() => null);
    if (p?.datos) {
      if (!it.nombre && p.datos.nombre) it.nombre = p.datos.nombre;
      if (!it.tramos.length && p.datos.tramos?.length) { it.tramos = p.datos.tramos; it.origen = "página"; }
      if (!it.peso && p.datos.peso_kg) it.peso = p.datos.peso_kg;
    }
    it.bloqueado = !!p?.bloqueado || !p;
  }));
  // Pesos que faltan: estimación de la IA (marcada como estimada)
  const sinPeso = items.filter((i) => !i.peso);
  if (sinPeso.length) {
    const e = await h.iaJSON(env, `Estimá el peso bruto por unidad (con su caja) en kg de cada producto, como lo despacharía un proveedor chino. Respondé JSON {"pesos":[número por cada producto, en el mismo orden]}.\n${sinPeso.map((i, n) => `${n + 1}. ${i.nombre || i.link}${i.variante ? " (" + i.variante + ")" : ""}`).join("\n")}`).catch(() => null);
    sinPeso.forEach((i, n) => { const v = +e?.pesos?.[n]; if (v > 0) { i.peso = Math.round(v * 1000) / 1000; i.peso_estimado = true; } });
  }
  for (const it of items) {
    if (it.tramos.length) {
      const o = [...it.tramos].sort((a, b) => a.desde - b.desde);
      let p = o[0].precio; for (const t of o) if (it.cantidad >= t.desde) p = t.precio;
      it.precio = p; it.minimo = o[0].desde;
    } else it.precio = 0;
    it.nombre = String(it.nombre || "Producto").slice(0, 90);
  }
  return { items, cliente: r.cliente || "", honorarios: r.honorarios ?? null, mostrar_desglose: r.mostrar_desglose !== false, notas_pdf: r.notas_pdf || "" };
}

// ---------------------------------------------------------------------------
// Cotización AUTOMÁTICA desde el 805: si un cliente mandó link(s) de Alibaba.com + cantidad, se arma sola
// y queda en Pendientes ("Cotización lista") con el PDF. No se le manda nada al cliente.
// Fotos, nombres sueltos y links de 1688 NO se cotizan solos (siguen como "esperan cotización").
// ---------------------------------------------------------------------------
const RE_ALIBABA = /https?:\/\/(?:[a-z0-9-]+\.)*alibaba\.com\/[^\s<>"']+/gi;
export async function cotizarAuto(env, h, { limite = 2 } = {}) {
  await tabla(env);
  const hasta = Date.now() - 3 * 86400e3;
  const convs = (await env.DB.prepare("SELECT conv, nombre FROM w_conv WHERE grupo=0 AND archivado=0 AND ult_cliente_ts>=? AND ult_cliente_ts>=ult_yo_ts - 3*86400000 ORDER BY ult_cliente_ts DESC LIMIT 60").bind(hasta).all().catch(() => ({ results: [] }))).results || [];
  const hechos = [];
  for (const c of convs) {
    if (hechos.length >= limite) break;
    const ms = (await env.DB.prepare("SELECT texto, ts FROM w_msg WHERE conv=? AND yo=0 AND ts>=? ORDER BY ts").bind(c.conv, hasta).all()).results || [];
    const texto = ms.map((m) => m.texto).join("\n");
    const links = [...new Set((texto.match(RE_ALIBABA) || []).map((l) => l.replace(/[),.;]+$/, "").split("?")[0]))];
    if (!links.length) continue;
    const clave = "cotauto:" + c.conv + ":" + links.sort().join("|").slice(0, 300);
    const ya = await env.DB.prepare("SELECT v FROM kv WHERE k=?").bind(clave).first();
    if (ya) continue;
    // Hace falta la cantidad: si todavía no la dijo, se espera (se vuelve a mirar en la próxima vuelta)
    if (!/\d/.test(texto.replace(RE_ALIBABA, ""))) continue;
    const r = await leerItems(env, h, texto.slice(-6000), "Cotizá solo los productos de los links de Alibaba que mandó el cliente, con la cantidad que pidió. Si no dijo cantidad para un producto, poné 0.", []);
    const items = r.items.filter((i) => /alibaba\.com/i.test(i.link || "") && i.cantidad > 0 && i.precio > 0);
    const sinCant = r.items.some((i) => /alibaba\.com/i.test(i.link || "") && !i.cantidad);
    const marca = (v) => env.DB.prepare("INSERT INTO kv (k,v,exp) VALUES (?,?,NULL) ON CONFLICT(k) DO UPDATE SET v=excluded.v").bind(clave, v).run();
    if (!items.length) { if (!sinCant) await marca("no-se-pudo"); continue; }   // sin cantidad: espera; página ilegible: queda para cotizar a mano
    const ult = await env.DB.prepare("SELECT MAX(num) n FROM cotiz_manual").first();
    const id = Math.random().toString(36).slice(2, 10), num = (ult?.n || 0) + 1;
    const cliente = c.nombre || "+" + c.conv;
    const est = items.some((i) => i.peso_estimado);
    const datos = { items: items.map((i) => ({ nombre: i.nombre, variante: i.variante || "", link: i.link, cantidad: i.cantidad, precio: i.precio, peso: i.peso })), desglose: true,
      notas: est ? "Peso estimado: el valor final puede variar un poco cuando el proveedor confirme el peso." : "", auto: true, conv: c.conv };
    await env.DB.prepare("INSERT INTO cotiz_manual (id, ts, num, quien, cliente, datos) VALUES (?,?,?,?,?,?)").bind(id, Date.now(), num, "auto", cliente.slice(0, 80), JSON.stringify(datos)).run();
    const tot = calcular(datos.items, datos, h.T).total;
    const det = items.map((i) => `• ${i.nombre} x${i.cantidad}: USD ${i.precio}/u FOB${i.peso_estimado ? " (peso estimado)" : ""}`).join("\n") + (r.items.length > items.length ? "\n(Hay productos que no se pudieron leer: cotizalos a mano.)" : "");
    await env.DB.prepare("INSERT INTO tareas (id, ts, tipo, tel, nombre, titulo, detalle, datos, ref, estado) VALUES (?,?,?,?,?,?,?,?,?,'abierta')")
      .bind("ca" + id, Date.now(), "cotizacion_auto", c.conv, cliente, `Cotización lista: ${items.length} producto${items.length > 1 ? "s" : ""} · total USD ${tot.toFixed(2)} puesto`, det, JSON.stringify({ cotiz: id, num }), "cotauto:" + id).run();
    await marca(id);
    hechos.push({ conv: c.conv, id, total: tot });
  }
  return hechos;
}

export async function apiCotizar(env, req, url, quien, h) {
  await tabla(env);
  const r = url.pathname.replace("/panel/api/cotizar/", "");
  if (r === "tarifas") return json(h.T);
  if (r === "leer" && req.method === "POST") {
    const b = await req.json();
    if (!String(b.texto || "").trim() && !(b.imagenes || []).length) return json({ error: "Pegá los links o subí capturas" }, 400);
    return json(await leerItems(env, h, b.texto || "", b.indicaciones || "", (b.imagenes || []).slice(0, 6)));
  }
  if (r === "guardar" && req.method === "POST") {
    const b = await req.json();
    const items = (b.items || []).map((i) => ({ nombre: String(i.nombre || "").slice(0, 90), variante: String(i.variante || "").slice(0, 60), link: String(i.link || ""), cantidad: Math.max(0, parseInt(i.cantidad) || 0), precio: +i.precio || 0, peso: +i.peso || 0 })).filter((i) => i.cantidad > 0);
    if (!items.length) return json({ error: "No hay productos con cantidad" }, 400);
    const ult = await env.DB.prepare("SELECT MAX(num) n FROM cotiz_manual").first();
    const id = b.id || Math.random().toString(36).slice(2, 10), num = b.num || (ult?.n || 0) + 1;
    const datos = { items, honorarios: b.honorarios, flete: b.flete, desglose: b.desglose !== false, notas: String(b.notas || "").slice(0, 1500), dolar: b.dolar || null };
    await env.DB.prepare("INSERT OR REPLACE INTO cotiz_manual (id, ts, num, quien, cliente, datos) VALUES (?,?,?,?,?,?)").bind(id, Date.now(), num, quien || "", String(b.cliente || "").slice(0, 80), JSON.stringify(datos)).run();
    return json({ ok: true, id, num });
  }
  if (r === "lista") return json(((await env.DB.prepare("SELECT id, ts, num, cliente, datos FROM cotiz_manual ORDER BY ts DESC LIMIT 40").all()).results || []).map((f) => { const d = JSON.parse(f.datos); return { id: f.id, ts: f.ts, num: f.num, cliente: f.cliente, n: d.items.length, total: calcular(d.items, d, h.T).total }; }));
  if (r === "una") { const f = await env.DB.prepare("SELECT * FROM cotiz_manual WHERE id=?").bind(url.searchParams.get("id") || "").first(); return f ? json({ ...f, datos: JSON.parse(f.datos) }) : json({ error: "no existe" }, 404); }
  if (r === "borrar" && req.method === "POST") { const b = await req.json(); await env.DB.prepare("DELETE FROM cotiz_manual WHERE id=?").bind(String(b.id || "")).run(); return json({ ok: true }); }
  return json({ error: "no existe" }, 404);
}

const usd = (n) => "USD " + (+n || 0).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export async function paginaCotizacion(env, id, T) {
  await tabla(env);
  const f = await env.DB.prepare("SELECT * FROM cotiz_manual WHERE id=?").bind(id).first();
  if (!f) return new Response("No existe esa cotización", { status: 404 });
  const d = JSON.parse(f.datos), c = calcular(d.items, d, T);
  const fecha = new Date(f.ts - 3 * 3600e3).toISOString().slice(0, 10).split("-").reverse().join("/");
  const filas = c.filas.map((i, n) => `<tr><td>${n + 1}</td><td><b>${esc(i.nombre)}</b>${i.variante ? `<small>${esc(i.variante)}</small>` : ""}</td><td class="r">${i.cantidad}</td><td class="r">${usd(i.unitario)}</td><td class="r">${usd(i.subtotal)}</td></tr>`).join("");
  const des = d.desglose ? `<table class="res"><tr><td>Costo de la mercadería</td><td class="r">${usd(c.fob)}</td></tr><tr><td>Flete internacional y manejo (${c.kg.toFixed(1)} kg aprox.)</td><td class="r">${usd(c.flete)}</td></tr><tr><td>Impuestos</td><td class="r">${usd(c.imp)}</td></tr><tr><td>Honorarios</td><td class="r">${usd(c.hon)}</td></tr></table>` : "";
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Cotización ${f.num}${f.cliente ? " · " + esc(f.cliente) : ""} · Te Importamos</title>
<style>*{box-sizing:border-box}body{margin:0;background:#fff;color:#111;font:14px/1.45 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif}.hoja{max-width:820px;margin:0 auto;padding:0 0 30px}
header{background:#0B0B0B;color:#fff;padding:26px 34px;border-bottom:5px solid #EA5B0C;display:flex;justify-content:space-between;align-items:flex-end;gap:20px}header h1{margin:0;font-size:26px;letter-spacing:.5px}header h1 span{color:#EA5B0C}header .m{text-align:right;font-size:13px;color:#ccc}header .m b{color:#fff;font-size:15px}
.cuerpo{padding:24px 34px}.cli{display:flex;justify-content:space-between;margin-bottom:18px;font-size:13.5px;color:#444}.cli b{color:#111}
table{width:100%;border-collapse:collapse}.it th{background:#F4F4F4;text-align:left;font-size:12px;text-transform:uppercase;letter-spacing:.4px;color:#555;padding:9px 10px;border-bottom:2px solid #EA5B0C}.it td{padding:10px;border-bottom:1px solid #eee;vertical-align:top}.it small{display:block;color:#777;font-size:12px}.r{text-align:right;white-space:nowrap}
.tot{display:flex;justify-content:flex-end;margin-top:18px}.tot>div{min-width:340px}.res td{padding:6px 10px;color:#444;border-bottom:1px solid #f0f0f0}.gran{display:flex;justify-content:space-between;background:#0B0B0B;color:#fff;padding:13px 14px;border-radius:6px;margin-top:8px;font-size:17px}.gran b{color:#EA5B0C}
.notas{margin-top:26px;font-size:12.5px;color:#555;border-top:1px solid #eee;padding-top:14px}.notas p{margin:4px 0}.bar{position:sticky;top:0;background:#FFF4EC;padding:10px;text-align:center;font-size:13px}.bar button{background:#EA5B0C;color:#fff;border:0;border-radius:6px;padding:8px 16px;font-weight:700;cursor:pointer;margin-left:8px}
@media print{.bar{display:none}body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}@page{margin:10mm}</style></head><body>
<div class="bar">Para guardarla: Imprimir → "Guardar como PDF"<button onclick="print()">Descargar PDF</button></div>
<div class="hoja"><header><h1>TE <span>IMPORTAMOS</span></h1><div class="m"><b>Cotización N° ${f.num}</b><br>${fecha}</div></header><div class="cuerpo">
<div class="cli"><div>${f.cliente ? `Cliente: <b>${esc(f.cliente)}</b>` : ""}</div><div>Importación desde China · puesto en Argentina</div></div>
<table class="it"><tr><th>#</th><th>Producto</th><th class="r">Cant.</th><th class="r">Unitario puesto</th><th class="r">Subtotal</th></tr>${filas}</table>
<div class="tot"><div>${des}<div class="gran"><span>Total puesto en Argentina</span><b>${usd(c.total)}</b></div></div></div>
<div class="notas">${d.notas ? `<p><b>${esc(d.notas)}</b></p>` : ""}<p>Valores estimativos en dólares; se pueden pagar en pesos al dólar cripto del día.</p><p>El precio final puede variar levemente cuando el proveedor confirme peso y medidas del envío.</p></div>
</div></div><script>if(location.hash==="#imprimir")setTimeout(function(){print()},400)</script></body></html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

export const PANEL_COTIZAR = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Cotizar · Te Importamos</title>
<style>:root{--n:#0B0B0B;--o:#EA5B0C;--o2:#FFF4EC;--b:#E5E7EB;--g:#6B7280}*{box-sizing:border-box}body{margin:0;background:#F6F6F7;color:#111;font:14px/1.45 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif}
header{background:var(--n);border-bottom:3px solid var(--o);color:#fff;padding:12px 18px;display:flex;align-items:center;gap:16px}header a{color:#D1D5DB;text-decoration:none;font-weight:600}header b{font-size:16px}
main{max-width:1150px;margin:0 auto;padding:18px 16px}.card{background:#fff;border:1px solid var(--b);border-radius:12px;padding:16px;margin-bottom:14px}h2{margin:0 0 10px;font-size:16px}
.dos{display:grid;grid-template-columns:2fr 1fr;gap:12px}textarea,input{width:100%;border:1px solid var(--b);border-radius:8px;padding:9px 10px;font:inherit}textarea{min-height:170px;resize:vertical}label{font-size:12.5px;font-weight:600;color:var(--g);display:block;margin:0 0 4px}
.btn{background:var(--o);color:#fff;border:0;border-radius:8px;padding:10px 16px;font-weight:700;cursor:pointer}.btn.s{background:#fff;color:#111;border:1px solid var(--b)}.btn:disabled{opacity:.5}.fila{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:10px}
table{width:100%;border-collapse:collapse}th{font-size:11.5px;text-transform:uppercase;color:var(--g);text-align:left;padding:6px;border-bottom:2px solid var(--o)}td{padding:5px 6px;border-bottom:1px solid #F0F0F0;vertical-align:top}td input{padding:6px}td.r{text-align:right;white-space:nowrap}.falta input{background:#FFF1F1;border-color:#F3B4B4}.est{color:#B45309;font-size:11px}.lk{font-size:11px;color:var(--g);word-break:break-all}.x{background:none;border:0;color:#999;cursor:pointer;font-size:16px}
.tots{display:flex;gap:18px;flex-wrap:wrap;justify-content:flex-end;margin-top:12px;font-size:13px;color:var(--g)}.tots b{display:block;color:#111;font-size:16px}.tots .T b{color:var(--o);font-size:20px}.aviso{background:var(--o2);border-radius:8px;padding:9px 12px;font-size:13px;margin-top:10px}
.hist div{display:flex;gap:10px;align-items:center;padding:8px 0;border-bottom:1px solid #F0F0F0;font-size:13.5px}.hist span{flex:1}.hist a{color:var(--o);font-weight:600;text-decoration:none}.cap{font-size:12.5px;color:var(--g)}
@media(max-width:800px){.dos{grid-template-columns:1fr}.oc{display:none}}</style></head><body>
<header><a href="/panel">&larr; Panel</a><b>Cotizar desde links</b></header><main>
<div class="card"><h2>1. Pegá lo que te mandaron</h2><div class="dos"><div><label>Links y cantidades (como vengan: un link por renglón con la cantidad al lado, o el mensaje entero)</label><textarea id="texto" placeholder="https://www.alibaba.com/product-detail/... x 200&#10;https://www.alibaba.com/product-detail/... 50 unidades color negro"></textarea></div>
<div><label>Indicaciones (cliente, honorarios, aclaraciones)</label><textarea id="ind" placeholder="Cliente: Juan Pérez&#10;Honorarios 120&#10;Aclarar que el plazo es de 30 a 45 días"></textarea>
<label style="margin-top:8px">Capturas de precios o pesos (opcional, hasta 6)</label><input type="file" id="fotos" accept="image/*" multiple></div></div>
<div class="fila"><button class="btn" id="leer">Armar cotización</button><span class="cap" id="estado"></span></div></div>
<div class="card" id="paso2" style="display:none"><h2>2. Revisá y corregí</h2>
<div class="fila" style="margin:0 0 10px"><div style="flex:1;min-width:180px"><label>Cliente</label><input id="cli"></div><div style="width:130px"><label>Honorarios USD</label><input id="hon" type="number" step="1"></div><div style="width:150px"><label>Flete USD (vacío = automático)</label><input id="fle" type="number" step="1"></div><label style="margin-top:18px"><input type="checkbox" id="des" checked style="width:auto"> Mostrar desglose</label></div>
<table><thead><tr><th>Producto</th><th style="width:80px">Cant.</th><th style="width:105px">Precio USD/u</th><th style="width:95px">Peso kg/u</th><th class="oc" style="width:120px">Unit. puesto</th><th class="oc" style="width:115px">Subtotal</th><th></th></tr></thead><tbody id="filas"></tbody></table>
<div class="fila"><button class="btn s" id="agregar">+ Agregar producto</button></div>
<div class="tots" id="tots"></div><div class="aviso" id="avisos" style="display:none"></div>
<label style="margin-top:12px">Notas para el PDF</label><textarea id="notas" style="min-height:60px"></textarea>
<div class="fila"><button class="btn" id="pdf">Generar PDF</button><span class="cap">No se manda nada a nadie: solo se genera el documento.</span></div></div>
<div class="card"><h2>Cotizaciones hechas</h2><div class="hist" id="hist"><span class="cap">Cargando...</span></div></div>
</main><script>
var T=null,IT=[],ID=null,NUM=null;function $(s){return document.querySelector(s)}function e(s){return String(s==null?"":s).replace(/[&<>"]/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]})}
function u(n){return "USD "+(+n||0).toLocaleString("es-AR",{minimumFractionDigits:2,maximumFractionDigits:2})}
fetch("/panel/api/cotizar/tarifas").then(function(r){return r.json()}).then(function(t){T=t});
function calc(){var its=IT.filter(function(i){return i.cantidad>0}),fob=0,kg=0;its.forEach(function(i){fob+=(+i.precio||0)*i.cantidad;kg+=(+i.peso||0)*i.cantidad});var fv=$("#fle").value,hv=$("#hon").value;
var fl=fv!==""?+fv:kg>T.aereoHasta?T.barcoFijo:kg>=T.aereoDesde?T.aereoFijo:kg*T.fleteKg,hon=hv!==""?+hv:T.honorarios,h=T.handling;
its.forEach(function(i){var f=fob?(i.precio*i.cantidad)/fob:1/its.length,p=kg?(i.peso*i.cantidad)/kg:f;i.sub=(i.precio*i.cantidad+fl*p+h*f)*T.factor+hon*f;i.uni=i.sub/i.cantidad});
return{fob:fob,kg:kg,fl:fl+h,imp:(fob+fl+h)*(T.factor-1),hon:hon,total:(fob+fl+h)*T.factor+hon}}
function pintar(){if(!T)return setTimeout(pintar,200);$("#filas").innerHTML=IT.map(function(i,n){var fp=!(+i.precio>0),fw=!(+i.peso>0);return '<tr data-n="'+n+'"><td><input data-k="nombre" value="'+e(i.nombre)+'"><input data-k="variante" placeholder="variante" value="'+e(i.variante||"")+'" style="margin-top:3px;font-size:12px">'+(i.link?'<div class="lk"><a href="'+e(i.link)+'" target="_blank">'+e(i.link.slice(0,70))+'</a></div>':"")+(i.bloqueado&&fp?'<div class="est">No se pudo leer la página: cargá el precio o subí la captura</div>':"")+(i.minimo&&i.cantidad<i.minimo?'<div class="est">El proveedor pide mínimo '+i.minimo+'</div>':"")+'</td><td><input data-k="cantidad" type="number" value="'+(i.cantidad||"")+'"></td><td class="'+(fp?"falta":"")+'"><input data-k="precio" type="number" step="0.01" value="'+(i.precio||"")+'"></td><td class="'+(fw?"falta":"")+'"><input data-k="peso" type="number" step="0.001" value="'+(i.peso||"")+'">'+(i.peso_estimado?'<div class="est">estimado</div>':"")+'</td><td class="r oc" data-u></td><td class="r oc" data-s></td><td><button class="x" data-x title="Quitar">&times;</button></td></tr>'}).join("");totales()}
function totales(){var c=calc();[].forEach.call(document.querySelectorAll("#filas tr"),function(tr){var i=IT[tr.dataset.n];tr.querySelector("[data-u]").textContent=i.cantidad>0&&i.uni?u(i.uni):"";tr.querySelector("[data-s]").textContent=i.cantidad>0&&i.sub?u(i.sub):""});
$("#tots").innerHTML='<div>Mercadería<b>'+u(c.fob)+'</b></div><div>Flete y manejo ('+c.kg.toFixed(1)+' kg)<b>'+u(c.fl)+'</b></div><div>Impuestos<b>'+u(c.imp)+'</b></div><div>Honorarios<b>'+u(c.hon)+'</b></div><div class="T">Total puesto<b>'+u(c.total)+'</b></div>';
var f=IT.filter(function(i){return i.cantidad>0&&!(+i.precio>0)}).length,s=IT.filter(function(i){return !(i.cantidad>0)}).length,es=IT.filter(function(i){return i.peso_estimado}).length,a=[];if(f)a.push(f+" producto(s) sin precio (en rojo)");if(s)a.push(s+" sin cantidad (no entran en el total)");if(es)a.push(es+" con peso estimado por la IA: revisalo si tenés el dato");$("#avisos").style.display=a.length?"":"none";$("#avisos").textContent=a.join(" · ")}
$("#filas").addEventListener("input",function(ev){var k=ev.target.dataset.k;if(!k)return;var i=IT[ev.target.closest("tr").dataset.n];i[k]=k==="nombre"||k==="variante"?ev.target.value:+ev.target.value;if(k==="peso")i.peso_estimado=false;totales()});
$("#filas").addEventListener("click",function(ev){if(ev.target.closest("[data-x]")){IT.splice(+ev.target.closest("tr").dataset.n,1);pintar()}});
["#hon","#fle"].forEach(function(s){$(s).oninput=totales});
$("#agregar").onclick=function(){IT.push({nombre:"",cantidad:0,precio:0,peso:0});pintar()};
function leerFotos(){var fs=[].slice.call($("#fotos").files||[],0,6);return Promise.all(fs.map(function(f){return new Promise(function(ok){var img=new Image(),r=new FileReader();r.onload=function(){img.onload=function(){var m=1600,s=Math.min(1,m/Math.max(img.width,img.height)),c=document.createElement("canvas");c.width=img.width*s;c.height=img.height*s;c.getContext("2d").drawImage(img,0,0,c.width,c.height);ok(c.toDataURL("image/jpeg",.85))};img.src=r.result};r.readAsDataURL(f)})}))}
$("#leer").onclick=function(){var b=this;b.disabled=true;$("#estado").textContent="Leyendo links y armando la lista (puede tardar hasta un minuto)...";leerFotos().then(function(im){return fetch("/panel/api/cotizar/leer",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({texto:$("#texto").value,indicaciones:$("#ind").value,imagenes:im})})}).then(function(r){return r.json()}).then(function(r){if(r.error){$("#estado").textContent=r.error;return}ID=null;NUM=null;IT=r.items||[];$("#cli").value=r.cliente||"";$("#hon").value=r.honorarios!=null?r.honorarios:"";$("#fle").value="";$("#des").checked=r.mostrar_desglose!==false;$("#notas").value=r.notas_pdf||"";$("#paso2").style.display="";$("#estado").textContent=IT.length+" productos";pintar();$("#paso2").scrollIntoView({behavior:"smooth"})}).catch(function(){$("#estado").textContent="No se pudo leer. Probá de nuevo."}).finally(function(){b.disabled=false})};
$("#pdf").onclick=function(){var b=this;b.disabled=true;var w=window.open("about:blank","_blank");fetch("/panel/api/cotizar/guardar",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:ID,num:NUM,cliente:$("#cli").value,items:IT,honorarios:$("#hon").value,flete:$("#fle").value,desglose:$("#des").checked,notas:$("#notas").value})}).then(function(r){return r.json()}).then(function(r){if(r.error){if(w)w.close();alert(r.error);return}ID=r.id;NUM=r.num;var url="/panel/cotizar/pdf?id="+r.id+"#imprimir";if(w)w.location=url;else location.href=url;historial()}).finally(function(){b.disabled=false})};
function historial(){fetch("/panel/api/cotizar/lista").then(function(r){return r.json()}).then(function(l){$("#hist").innerHTML=l.length?l.map(function(c){return '<div><b>N° '+c.num+'</b><span>'+e(c.cliente||"Sin nombre")+' · '+c.n+' productos · '+u(c.total)+' · '+new Date(c.ts).toLocaleDateString("es-AR")+'</span><a href="/panel/cotizar/pdf?id='+c.id+'" target="_blank">PDF</a><a href="#" data-ed="'+c.id+'">Editar</a><a href="#" data-del="'+c.id+'" style="color:#999">Borrar</a></div>'}).join(""):'<span class="cap">Todavía no hiciste ninguna.</span>'})}
$("#hist").addEventListener("click",function(ev){var d=ev.target.closest("[data-del]"),ed=ev.target.closest("[data-ed]");if(d){ev.preventDefault();if(!confirm("¿Borrar esta cotización?"))return;fetch("/panel/api/cotizar/borrar",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:d.dataset.del})}).then(historial)}
if(ed){ev.preventDefault();fetch("/panel/api/cotizar/una?id="+ed.dataset.ed).then(function(r){return r.json()}).then(function(f){ID=f.id;NUM=f.num;IT=f.datos.items;$("#cli").value=f.cliente||"";$("#hon").value=f.datos.honorarios==null?"":f.datos.honorarios;$("#fle").value=f.datos.flete==null?"":f.datos.flete;$("#des").checked=f.datos.desglose!==false;$("#notas").value=f.datos.notas||"";$("#paso2").style.display="";pintar();$("#paso2").scrollIntoView({behavior:"smooth"})})}});
historial();
(function(){var q=new URLSearchParams(location.search).get("id");if(!q)return;fetch("/panel/api/cotizar/una?id="+encodeURIComponent(q)).then(function(r){return r.json()}).then(function(f){if(!f.id)return;ID=f.id;NUM=f.num;IT=f.datos.items;$("#cli").value=f.cliente||"";$("#hon").value=f.datos.honorarios==null?"":f.datos.honorarios;$("#fle").value=f.datos.flete==null?"":f.datos.flete;$("#des").checked=f.datos.desglose!==false;$("#notas").value=f.datos.notas||"";$("#paso2").style.display="";pintar();$("#paso2").scrollIntoView({behavior:"smooth"})})})();
</script></body></html>`;
