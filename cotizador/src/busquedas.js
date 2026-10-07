// Pestaña "Búsquedas" del panel: /panel/busquedas (formulario + resultados del worker "buscador").
// El panel solo guarda el pedido en la tabla "busquedas" (estado "nueva"); el worker "buscador" hace la búsqueda
// en Apify, puntúa y guarda en "proveedores". Así, si el buscador falla, el agente de WhatsApp no se entera.

// Copia idéntica del esquema de buscador/src/buscador.js (la simulación verifica que sean iguales)
export const ESQUEMA = [
  "CREATE TABLE IF NOT EXISTS busquedas (id TEXT PRIMARY KEY, ts INTEGER, num INTEGER, producto TEXT, cantidad INTEGER, calidad TEXT, presupuesto TEXT, fuentes TEXT, solo_minimo INTEGER DEFAULT 1, asignado TEXT, creado_por TEXT, cliente TEXT, tel TEXT, tarea TEXT, estado TEXT, nota TEXT, consultas TEXT, peso_kg REAL, runs TEXT, costo REAL DEFAULT 0, lanzada_ts INTEGER, lista_ts INTEGER, n_prov INTEGER DEFAULT 0, mejor_u REAL, archivada INTEGER DEFAULT 0)",
  "CREATE INDEX IF NOT EXISTS busquedas_estado ON busquedas(estado, ts)",
  "CREATE INDEX IF NOT EXISTS busquedas_asignado ON busquedas(asignado, ts)",
  "CREATE TABLE IF NOT EXISTS proveedores (id TEXT PRIMARY KEY, busqueda TEXT, ts INTEGER, fuente TEXT, titulo TEXT, titulo_orig TEXT, link TEXT, foto TEXT, proveedor TEXT, prov_link TEXT, ubicacion TEXT, tipo TEXT, verificado INTEGER, anios INTEGER, ventas INTEGER, calif REAL, minimo INTEGER, tramos TEXT, moneda TEXT, precio_u REAL, precio_usd REAL, puesto_u REAL, total REAL, minimo_ok INTEGER, parecido INTEGER, puntaje REAL, contacto TEXT, estado TEXT DEFAULT 'nuevo', notas TEXT)",
  "CREATE INDEX IF NOT EXISTS proveedores_busqueda ON proveedores(busqueda, puntaje)",
  "CREATE TABLE IF NOT EXISTS tareas (id TEXT PRIMARY KEY, ts INTEGER, tipo TEXT, tel TEXT, nombre TEXT, titulo TEXT, detalle TEXT, datos TEXT, ref TEXT, estado TEXT)",
  "CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT, exp INTEGER)",
];
export const MIGRACIONES = [
  "ALTER TABLE busquedas ADD COLUMN paises TEXT",
  "ALTER TABLE busquedas ADD COLUMN web TEXT",
  "ALTER TABLE proveedores ADD COLUMN pais TEXT",
  "ALTER TABLE proveedores ADD COLUMN calidad TEXT",
  "ALTER TABLE proveedores ADD COLUMN contactos TEXT",
  "ALTER TABLE proveedores ADD COLUMN resumen TEXT",
];
const PROHIBIDO = /\b(vapes?|vapers?|vapeador|elf ?bar|lost ?mary|pods? desechables?|puffs?|cigarrillos?|tabaco|nicotina|medicamentos?|f[aá]rmacos?|drogas?|marihuana|cannabis|thc|cbd)\b/i;
const FUENTES = ["1688", "alibaba", "web"];
const PAISES = ["ar", "py", "br", "cl", "us", "cn"];
const ESTADOS_PROV = ["nuevo", "contactado", "pidió muestra", "cotizado al cliente", "descartado"];
const AR = 3 * 3600e3;
const inicioDiaAR = (ts = Date.now()) => Math.floor((ts - AR) / 86400e3) * 86400e3 + AR;
const inicioMesAR = (ts = Date.now()) => { const d = new Date(ts - AR); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) + AR; };
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });

let listas = false;
async function preparar(env) {
  if (listas) return;
  await env.DB.batch(ESQUEMA.map((s) => env.DB.prepare(s)));
  for (const m of MIGRACIONES) await env.DB.prepare(m).run().catch(() => {});
  listas = true;
}
const kvGet = async (env, k) => (await env.DB.prepare("SELECT v FROM kv WHERE k=?").bind(k).first())?.v ?? null;
const kvPut = (env, k, v) => env.DB.prepare("INSERT INTO kv (k,v,exp) VALUES (?,?,NULL) ON CONFLICT(k) DO UPDATE SET v=excluded.v, exp=NULL").bind(k, String(v)).run();

// Reparto alternado: 1ª búsqueda al primero de la lista, 2ª al segundo, y así.
// Lista: variable REPARTO (ej. "manuel,socio") o, si no está, los usuarios de PANEL_USUARIOS en orden.
export function personasReparto(env, usuarios) {
  const r = String(env.REPARTO || "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
  return r.length ? r : usuarios.length ? usuarios : ["manuel"];
}
async function siguienteTurno(env) {
  const r = await env.DB.prepare("INSERT INTO kv (k,v,exp) VALUES ('buscador_turno','1',NULL) ON CONFLICT(k) DO UPDATE SET v = CAST(v AS INTEGER) + 1 RETURNING v").first();
  return +r.v;
}

export async function apiBusquedas(env, req, url, quien, usuarios = []) {
  await preparar(env);
  const ruta = url.pathname.replace("/panel/api/busquedas/", "");
  const personas = personasReparto(env, usuarios);
  const cuerpo = req.method === "POST" ? await req.json().catch(() => ({})) : {};

  if (ruta === "lista") {
    const f = url.searchParams.get("f") || "mias";
    const where = ["archivada = 0"], binds = [];
    if (f === "mias") { where.push("asignado = ?"); binds.push(quien); }
    else if (f === "otros") { where.push("(asignado IS NULL OR asignado <> ?)"); binds.push(quien); }
    const est = url.searchParams.get("estado");
    if (est) { where.push("estado = ?"); binds.push(est); }
    const bs = (await env.DB.prepare(`SELECT * FROM busquedas WHERE ${where.join(" AND ")} ORDER BY ts DESC LIMIT 40`).bind(...binds).all()).results || [];
    let provs = [];
    if (bs.length) provs = (await env.DB.prepare(`SELECT * FROM proveedores WHERE busqueda IN (${bs.map(() => "?").join(",")}) ORDER BY puntaje DESC`).bind(...bs.map((b) => b.id)).all()).results || [];
    const porB = {};
    for (const p of provs) (porB[p.busqueda] = porB[p.busqueda] || []).push({ ...p, tramos: JSON.parse(p.tramos || "[]"), contactos: JSON.parse(p.contactos || "null") });
    const [gasto, hoy, tg] = await Promise.all([
      env.DB.prepare("SELECT SUM(costo) c FROM busquedas WHERE lanzada_ts >= ?").bind(inicioMesAR()).first(),
      env.DB.prepare("SELECT COUNT(*) c FROM busquedas WHERE lanzada_ts >= ?").bind(inicioDiaAR()).first(),
      kvGet(env, `telegram_chat:${quien}`),
    ]);
    return json({
      quien, personas, estadosProv: ESTADOS_PROV, gastoMes: +(gasto?.c || 0), hoy: +(hoy?.c || 0), telegram: !!tg,
      busquedas: bs.map((b) => ({ ...b, web: undefined, webInfo: b.web ? (({ pend, creditos }) => ({ faltan: pend.length, creditos }))(JSON.parse(b.web)) : null, paises: JSON.parse(b.paises || "[]"), fuentes: JSON.parse(b.fuentes || "[]"), consultas: JSON.parse(b.consultas || "null"), runs: JSON.parse(b.runs || "[]"), proveedores: porB[b.id] || [] })),
    });
  }

  if (ruta === "nueva" && req.method === "POST") {
    const producto = String(cuerpo.producto || "").trim().slice(0, 300);
    const cantidad = Math.round(+cuerpo.cantidad || 0);
    if (producto.length < 3) return json({ ok: false, res: "Escribí qué producto buscar." });
    if (!(cantidad >= 1 && cantidad <= 1000000)) return json({ ok: false, res: "Poné una cantidad válida." });
    if (PROHIBIDO.test(producto)) return json({ ok: false, res: "Ese producto no lo trabajamos (vapers, tabaco, fármacos o drogas). No se busca." });
    const fuentes = (Array.isArray(cuerpo.fuentes) ? cuerpo.fuentes : ["1688", "web"]).filter((x) => FUENTES.includes(x));
    if (!fuentes.length) return json({ ok: false, res: "Elegí al menos una fuente." });
    const paises = (Array.isArray(cuerpo.paises) ? cuerpo.paises : PAISES).filter((x) => PAISES.includes(x));
    if (fuentes.includes("web") && !paises.length) return json({ ok: false, res: "Para buscar en la web, elegí al menos un país." });
    const dup = await env.DB.prepare("SELECT id FROM busquedas WHERE lower(producto)=lower(?) AND cantidad=? AND estado IN ('nueva','buscando') AND ts > ?").bind(producto, cantidad, Date.now() - 3600e3).first();
    if (dup) return json({ ok: true, id: dup.id, res: "Esa búsqueda ya está en marcha." });
    const num = await siguienteTurno(env);
    const asignado = personas.includes(cuerpo.asignar) ? cuerpo.asignar : personas[(num - 1) % personas.length];
    let tarea = null, tel = "", cliente = String(cuerpo.cliente || "").slice(0, 120);
    if (cuerpo.tarea) {
      const t = await env.DB.prepare("SELECT id, tel, nombre FROM tareas WHERE id = ?").bind(cuerpo.tarea).first();
      if (t) { tarea = t.id; tel = t.tel || ""; cliente = cliente || t.nombre || (t.tel ? "+" + t.tel : ""); }
    }
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    await env.DB.prepare(`INSERT INTO busquedas (id, ts, num, producto, cantidad, calidad, presupuesto, fuentes, paises, solo_minimo, asignado, creado_por, cliente, tel, tarea, estado, nota, costo, n_prov, archivada)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'nueva','',0,0,0)`).bind(id, Date.now(), num, producto, cantidad, ["replica", "original", "reacondicionado", "indistinto"].includes(cuerpo.calidad) ? cuerpo.calidad : "indistinto",
      String(cuerpo.presupuesto || "").slice(0, 80), JSON.stringify(fuentes), JSON.stringify(fuentes.includes("web") ? paises : []), cuerpo.soloMinimo === false ? 0 : 1, asignado, quien, cliente, tel, tarea).run();
    return json({ ok: true, id, asignado, res: `Listo: la búsqueda quedó para ${asignado}. Tarda entre 2 y 10 minutos.` });
  }

  if (ruta === "reasignar" && req.method === "POST") {
    if (!personas.includes(cuerpo.a)) return json({ ok: false, res: "Esa persona no está en el reparto." });
    await env.DB.prepare("UPDATE busquedas SET asignado=? WHERE id=?").bind(cuerpo.a, cuerpo.id || "").run();
    await env.DB.prepare("UPDATE tareas SET nombre=? WHERE ref=? AND estado='abierta'").bind(`Para ${cuerpo.a}`, `busq:${cuerpo.id}`).run();
    return json({ ok: true, res: `Reasignada a ${cuerpo.a}` });
  }

  if (ruta === "busqueda" && req.method === "POST") {
    const b = await env.DB.prepare("SELECT * FROM busquedas WHERE id=?").bind(cuerpo.id || "").first();
    if (!b) return json({ ok: false, res: "Ya no existe" });
    if (cuerpo.accion === "archivar") {
      await env.DB.prepare("UPDATE busquedas SET archivada=1 WHERE id=?").bind(b.id).run();
      await env.DB.prepare("UPDATE tareas SET estado='hecha' WHERE ref=?").bind(`busq:${b.id}`).run();
      return json({ ok: true, res: "Archivada" });
    }
    if (cuerpo.accion === "reintentar" && (b.estado === "error" || b.estado === "lista")) {
      await env.DB.prepare("UPDATE busquedas SET estado='nueva', nota='', runs=NULL, web=NULL, lanzada_ts=NULL WHERE id=?").bind(b.id).run();
      return json({ ok: true, res: "Vuelve a la cola: sale en la próxima vuelta (2 min)" });
    }
    return json({ ok: false, res: "Acción no válida" });
  }

  if (ruta === "proveedor" && req.method === "POST") {
    const sets = [], binds = [];
    if (ESTADOS_PROV.includes(cuerpo.estado)) { sets.push("estado=?"); binds.push(cuerpo.estado); }
    if (typeof cuerpo.notas === "string") { sets.push("notas=?"); binds.push(cuerpo.notas.slice(0, 1000)); }
    if (!sets.length) return json({ ok: false, res: "Nada para cambiar" });
    await env.DB.prepare(`UPDATE proveedores SET ${sets.join(",")} WHERE id=?`).bind(...binds, cuerpo.id || "").run();
    return json({ ok: true, res: "Guardado" });
  }

  if (ruta === "tarea") {
    const t = await env.DB.prepare("SELECT id, tel, nombre, titulo, detalle FROM tareas WHERE id=?").bind(url.searchParams.get("id") || "").first();
    if (!t) return json({ ok: false });
    const texto = `${t.titulo} ${t.detalle}`;
    const m = t.titulo.match(/venda (\d+) u de (.+?)(?: \(|$)/);
    const cant = m ? +m[1] : +((texto.match(/(?:x\s?|cantidad:?\s*)(\d{1,6})\b|\b(\d{1,6})\s*(?:u\b|unidades|pares|piezas)/i) || []).slice(1).find(Boolean) || 0);
    const producto = m ? m[2] : String(t.detalle || "").split("\n")[0].replace(/^(producto|cliente pide|busca):?\s*/i, "").slice(0, 200);
    return json({ ok: true, id: t.id, cliente: t.nombre || (t.tel ? "+" + t.tel : ""), producto, cantidad: cant || "", detalle: t.detalle });
  }

  // Telegram por persona: le escribís /start al bot y tocás el botón; se guarda el chat de quien está logueado
  if (ruta === "telegram" && req.method === "POST") {
    if (!env.TELEGRAM_TOKEN) return json({ ok: false, res: "Falta TELEGRAM_TOKEN en el cotizador" });
    const r = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/getUpdates`).then((x) => x.json()).catch(() => null);
    const chat = (r?.result || []).map((u) => u.message?.chat).filter(Boolean).pop();
    if (!chat) return json({ ok: false, res: "Escribile /start al bot en Telegram y tocá el botón enseguida" });
    await kvPut(env, `telegram_chat:${quien}`, chat.id);
    await fetch(`https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/sendMessage`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chat.id, text: `✅ Listo ${quien}: acá te van a llegar tus búsquedas de proveedores.` }) }).catch(() => null);
    return json({ ok: true, res: `Conectado con ${chat.first_name || chat.title || "tu Telegram"}` });
  }

  return json({ ok: false, res: "No existe" }, 404);
}

export const PANEL_BUSQUEDAS = String.raw`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Búsquedas · Te Importamos</title>
<style>
:root{--azul:#1d4ed8;--azul2:#e8efff;--fondo:#f5f7fb;--borde:#e3e8f0;--txt:#0f172a;--gris:#64748b;--rojo:#dc2626;--verde:#16a34a;--ambar:#d97706}
*{box-sizing:border-box}body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:var(--fondo);color:var(--txt)}
header{display:flex;align-items:center;gap:14px;padding:12px 16px;background:#fff;border-bottom:1px solid var(--borde);position:sticky;top:0;z-index:5;flex-wrap:wrap}
header b{color:var(--azul);font-size:18px}header a{color:var(--gris);text-decoration:none;font-weight:600}
main{padding:16px;max-width:1100px;margin:0 auto}
.card{background:#fff;border:1px solid var(--borde);border-radius:12px;padding:14px;margin-bottom:12px;min-width:0}
h2{font-size:16px;margin:0 0 10px}
.form{display:grid;grid-template-columns:2fr 1fr 1fr 1fr;gap:10px}.form label{font-size:13px;color:var(--gris);font-weight:600;display:flex;flex-direction:column;gap:4px}
.form .ancho{grid-column:1/-1}
input,select,textarea{padding:9px 10px;border:1px solid var(--borde);border-radius:8px;font-size:15px;font-family:inherit;background:#fff;color:var(--txt);width:100%}
.chk{display:flex;gap:14px;flex-wrap:wrap;align-items:center;font-size:14px}.chk label{flex-direction:row;align-items:center;color:var(--txt);font-weight:500}.chk input{width:auto}
.btn{border:1px solid var(--borde);background:#fff;padding:8px 12px;border-radius:8px;cursor:pointer;font-weight:600;font-size:14px;color:var(--txt);text-decoration:none;display:inline-block}
.btn.p{background:var(--azul);color:#fff;border-color:var(--azul)}.btn.r{color:var(--rojo)}.btn:disabled{opacity:.5}
.fila{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.filtros{display:inline-flex;background:#fff;border:1px solid var(--borde);border-radius:10px;padding:3px}
.filtros button{border:0;background:none;padding:7px 14px;border-radius:8px;color:var(--gris);font-weight:600;cursor:pointer;font-size:14px}.filtros button.on{background:var(--azul);color:#fff}
.estado{font-size:13px;color:var(--gris)}
.pill{display:inline-block;padding:2px 8px;border-radius:99px;font-size:12px;font-weight:700;background:#eef2f7;color:var(--gris);white-space:nowrap}
.pill.lista{background:#dcfce7;color:var(--verde)}.pill.buscando,.pill.nueva{background:#fef3c7;color:var(--ambar)}.pill.error{background:#fee2e2;color:var(--rojo)}
.bq{scroll-margin-top:70px}.bq.marcada{outline:2px solid var(--azul)}
.cab{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:flex-start}
.cab h3{margin:0;font-size:16px}.meta{font-size:13px;color:var(--gris);margin-top:4px}
.nota{background:#fffbeb;border:1px solid #fde68a;color:#92400e;border-radius:8px;padding:8px 10px;font-size:13px;margin-top:8px}
.provs{display:flex;flex-direction:column;gap:8px;margin-top:10px}
.pv{display:grid;grid-template-columns:72px 1fr auto;gap:10px;border:1px solid var(--borde);border-radius:10px;padding:10px;align-items:start}
.pv.descartado{opacity:.45}.pv.web{grid-template-columns:1fr auto}.sec{font-weight:700;font-size:14px;margin:14px 0 2px;color:var(--txt)}.btn.wa{background:#16a34a;color:#fff;border-color:#16a34a}.resumen{font-size:13px;color:#334155;margin-top:4px;line-height:1.35}
.pv img{width:72px;height:72px;object-fit:cover;border-radius:8px;background:#eef2f7}
.pv .t{font-weight:600;font-size:14px;line-height:1.3}.pv .s{font-size:12px;color:var(--gris);margin-top:3px}
.pv .precio{text-align:right;min-width:120px}.pv .precio b{font-size:20px;display:block}.pv .precio small{color:var(--gris);font-size:12px;display:block}
.score{display:inline-block;min-width:38px;text-align:center;padding:3px 6px;border-radius:8px;font-weight:800;font-size:14px;color:#fff;background:var(--gris)}
.score.alto{background:var(--verde)}.score.medio{background:var(--ambar)}
.acc{grid-column:1/-1;display:flex;gap:6px;flex-wrap:wrap;align-items:center}.acc select{width:auto;padding:6px 8px;font-size:13px}
.tag{font-size:11px;font-weight:700;padding:1px 6px;border-radius:6px;background:#e0f2fe;color:#0369a1;margin-right:4px}.tag.no{background:#fee2e2;color:var(--rojo)}
.vacio{color:var(--gris);font-size:14px;padding:10px 0}
.aviso{position:fixed;left:50%;bottom:18px;transform:translateX(-50%);background:#0f172a;color:#fff;padding:10px 16px;border-radius:10px;font-size:14px;display:none;z-index:20;max-width:90vw}
dialog{border:1px solid var(--borde);border-radius:12px;padding:16px;max-width:560px;width:92vw}dialog textarea{height:150px;margin:6px 0 10px}
@media(max-width:760px){main{padding:10px}.form{grid-template-columns:1fr 1fr}.form .p2{grid-column:1/-1}.pv{grid-template-columns:56px 1fr}.pv img{width:56px;height:56px}.pv .precio{grid-column:1/-1;text-align:left;display:flex;gap:10px;align-items:baseline;flex-wrap:wrap}.pv .precio b{display:inline}}
</style></head><body>
<header><b>Búsquedas de proveedores</b><span class="estado" id="gasto"></span><a href="/panel" style="margin-left:auto">← Panel</a></header>
<main>
<section class="card">
  <h2>Nueva búsqueda</h2>
  <div class="form">
    <label class="p2">Producto<input id="fProd" placeholder="Ej: zapatillas Jordan 4 retro réplica 1:1"></label>
    <label>Cantidad<input id="fCant" type="number" min="1" inputmode="numeric" placeholder="50"></label>
    <label>Calidad<select id="fCal"><option value="indistinto">Indistinto</option><option value="replica">Réplica</option><option value="original">Original</option><option value="reacondicionado">Reacondicionado</option></select></label>
    <label>Presupuesto (opcional)<input id="fPres" placeholder="USD 1000"></label>
    <label class="p2">Cliente (opcional)<input id="fCli" placeholder="Nombre o teléfono"></label>
    <label>Asignar a<select id="fAsig"><option value="auto">Automático (alterna)</option></select></label>
    <div class="chk ancho">
      <b style="font-size:13px;color:var(--gris)">Buscar en:</b>
      <label><input type="checkbox" class="fFuente" value="web" checked> Web por país (gratis)</label>
      <label><input type="checkbox" class="fFuente" value="1688" checked> 1688 con precio (Apify)</label>
      <label><input type="checkbox" class="fFuente" value="alibaba"> Alibaba (Apify)</label>
      <label><input type="checkbox" id="fMin" checked> Solo mínimo ≤ cantidad</label>
    </div>
    <div class="chk ancho" id="fPaises">
      <b style="font-size:13px;color:var(--gris)">Países (web):</b>
      <label><input type="checkbox" value="ar" checked> 🇦🇷 Argentina</label><label><input type="checkbox" value="py" checked> 🇵🇾 Paraguay</label>
      <label><input type="checkbox" value="br" checked> 🇧🇷 Brasil</label><label><input type="checkbox" value="cl" checked> 🇨🇱 Chile</label>
      <label><input type="checkbox" value="us" checked> 🇺🇸 EE. UU.</label><label><input type="checkbox" value="cn" checked> 🇨🇳 China (fábricas)</label>
    </div>
    <div class="fila ancho"><button class="btn p" id="bBuscar">Buscar proveedores</button><span class="estado" id="costoEst"></span></div>
  </div>
</section>
<div class="fila" style="margin-bottom:12px">
  <div class="filtros" id="filtros"><button data-f="mias" class="on">Mías</button><button data-f="otros">Del otro</button><button data-f="todas">Todas</button></div>
  <select id="fEst" style="width:auto"><option value="">Todos los estados</option><option value="lista">Listas</option><option value="buscando">Buscando</option><option value="nueva">En cola</option><option value="error">Con error</option></select>
  <span style="flex:1"></span><button class="btn" id="bTg">Conectar mi Telegram</button>
</div>
<div id="lista"><div class="vacio">Cargando...</div></div>
</main>
<dialog id="dlg"><b id="dlgT">Mensaje para el proveedor</b>
  <div class="fila" style="margin-top:8px"><button class="btn" data-l="es">Español</button><button class="btn" data-l="pt">Portugués</button><button class="btn" data-l="en">Inglés</button><button class="btn" data-l="zh">Chino</button></div>
  <textarea id="dlgTxt"></textarea>
  <div class="fila"><button class="btn p" id="dlgCopiar">Copiar</button><button class="btn" id="dlgCerrar">Cerrar</button></div>
</dialog>
<div class="aviso" id="aviso"></div>
<script>
var $ = function (s) { return document.querySelector(s); };
var F = "mias", DATOS = null, TAREA = null, firma = "";
function esc(t) { return String(t == null ? "" : t).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
function aviso(t) { var a = $("#aviso"); a.textContent = t; a.style.display = "block"; clearTimeout(a._t); a._t = setTimeout(function () { a.style.display = "none"; }, 3500); }
function api(r, body) { return fetch("/panel/api/busquedas/" + r, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}).then(function (x) { if (x.status === 401) { location.href = "/login?volver=/panel/busquedas"; throw 0; } return x.json(); }); }
function usd(v) { return v == null ? "-" : "USD " + Number(v).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function hace(ms) { var m = Math.round((Date.now() - ms) / 60000); return m < 60 ? "hace " + m + " min" : m < 1440 ? "hace " + Math.round(m / 60) + " h" : "hace " + Math.round(m / 1440) + " d"; }
function nombre(u) { return u ? u.charAt(0).toUpperCase() + u.slice(1) : "-"; }
var ESTADOS = { nueva: "En cola", buscando: "Buscando...", lista: "Lista", error: "Error" };
var PAIS = { ar: "🇦🇷 Argentina", py: "🇵🇾 Paraguay", br: "🇧🇷 Brasil", cl: "🇨🇱 Chile", us: "🇺🇸 EE. UU.", cn: "🇨🇳 China" };
function costoEst() {
  var f = [].slice.call(document.querySelectorAll(".fFuente:checked")).map(function (x) { return x.value; }), np = document.querySelectorAll("#fPaises input:checked").length;
  var ap = (f.indexOf("1688") >= 0 ? 0.06 : 0) + (f.indexOf("alibaba") >= 0 ? 0.06 : 0), t = [];
  if (f.indexOf("web") >= 0) t.push("web: " + np * 2 + " de las 1.000 búsquedas gratis de Tavily");
  if (ap) t.push("Apify: unos USD " + ap.toFixed(2).replace(".", ",") + " del crédito gratis");
  $("#costoEst").textContent = t.length ? "Usa " + t.join(" · ") + "." : "Elegí al menos una fuente.";
  $("#fPaises").style.opacity = f.indexOf("web") >= 0 ? 1 : 0.4;
}
function msgTexto(l, p, q, prod) {
  var link = p.link, nom = p.fuente === "1688" ? "" : (p.titulo || prod);
  if (l === "es") return "Hola! Somos Te Importamos, importadores de Rosario (Argentina). Vimos su publicación: " + link + "\n\nNos interesa " + prod + ", cantidad: " + q + " unidades.\n¿Nos podrían pasar:\n1) Precio por unidad para " + q + " u (y por mayor)\n2) Mínimo de compra\n3) Formas de pago y envío\n4) Catálogo o fotos reales\n\nGracias!";
  if (l === "pt") return "Olá! Somos a Te Importamos, importadores de Rosario (Argentina). Vimos o seu anúncio: " + link + "\n\nTemos interesse em " + prod + ", quantidade: " + q + " unidades.\nPoderiam nos enviar:\n1) Preço por unidade para " + q + " un (e no atacado)\n2) Pedido mínimo\n3) Formas de pagamento e envio\n4) Catálogo ou fotos reais\n\nObrigado!";
  if (l === "en") return "Hello! We are an importer from Argentina and we are interested in this product:\n" + link + (nom ? "\n" + nom : "") + "\n\nQuantity: " + q + " pcs.\nCould you please confirm:\n1) Unit price for " + q + " pcs\n2) Minimum order quantity\n3) Gross weight and box size per unit\n4) Production and delivery time\n5) Sample cost\n\nThank you!";
  return "您好！我们是阿根廷的进口商，对这款产品感兴趣：\n" + link + "\n\n数量：" + q + "件\n请帮忙确认：\n1）" + q + "件的单价\n2）最小起订量\n3）单件毛重和包装尺寸\n4）生产和发货时间\n5）样品费用\n\n谢谢！";
}
var LENGUA = { ar: "es", py: "es", cl: "es", br: "pt", us: "en", cn: "en" };

function cargar() {
  api("lista?f=" + F + "&estado=" + encodeURIComponent($("#fEst").value)).then(function (d) {
    DATOS = d;
    var s = $("#fAsig"); if (s.options.length === 1) d.personas.forEach(function (p) { var o = document.createElement("option"); o.value = p; o.textContent = nombre(p) + (p === d.quien ? " (yo)" : ""); s.appendChild(o); });
    $("#gasto").textContent = "Apify este mes: " + usd(d.gastoMes) + " de USD 5 gratis · hoy: " + d.hoy + " búsquedas";
    $("#bTg").textContent = d.telegram ? "Telegram conectado ✓" : "Conectar mi Telegram";
    var f = JSON.stringify(d.busquedas.map(function (b) { return [b.id, b.estado, b.asignado, b.nota, b.proveedores.map(function (p) { return p.estado; }).join()]; }));
    if (f !== firma) { firma = f; pintar(d); }
    if (location.hash) { var el = document.getElementById("b-" + location.hash.slice(1)); if (el && !el._visto) { el._visto = 1; el.classList.add("marcada"); el.scrollIntoView(); } }
  }).catch(function () {});
}

function tarjetaWeb(p, b) {
  var k = p.contactos || { wa: [], ig: [], mail: [], tel: [], wechat: [] }, sc = p.puntaje >= 7 ? "alto" : p.puntaje >= 5 ? "medio" : "";
  var texto = msgTexto(LENGUA[p.pais] || "es", p, b.cantidad, b.producto), bt = [];
  (k.wa || []).forEach(function (w, i) { bt.push('<a class="btn wa" target="_blank" rel="noopener" href="https://wa.me/' + esc(w) + "?text=" + encodeURIComponent(texto) + '">WhatsApp' + (i ? " " + (i + 1) : "") + "</a>"); });
  (k.ig || []).forEach(function (u) { bt.push('<a class="btn" target="_blank" rel="noopener" href="https://instagram.com/' + esc(u) + '">@' + esc(u) + "</a>"); });
  (k.mail || []).forEach(function (m) { bt.push('<a class="btn" href="mailto:' + esc(m) + "?subject=" + encodeURIComponent("Consulta por mayor: " + b.producto) + "&body=" + encodeURIComponent(texto) + '">Mail</a>'); });
  (k.tel || []).forEach(function (t) { bt.push('<a class="btn" href="tel:+' + esc(t) + '">Tel +' + esc(t) + "</a>"); });
  (k.wechat || []).forEach(function (w) { bt.push('<span class="btn">WeChat: ' + esc(w) + "</span>"); });
  var opts = DATOS.estadosProv.map(function (e) { return "<option" + (e === p.estado ? " selected" : "") + ">" + e + "</option>"; }).join("");
  return '<div class="pv web ' + (p.estado === "descartado" ? "descartado" : "") + '" data-p="' + p.id + '"><div style="min-width:0">' +
    '<div class="t"><span class="tag">' + esc(p.tipo) + '</span>' + (p.calidad && p.calidad !== "no se sabe" ? '<span class="tag">' + esc(p.calidad) + "</span>" : "") + (p.minimo_ok ? "" : '<span class="tag no">mínimo ' + esc(p.minimo) + "</span>") + esc(p.proveedor || p.titulo) + "</div>" +
    '<div class="s">' + esc(p.titulo) + "</div>" + (p.resumen ? '<div class="resumen">' + esc(p.resumen) + "</div>" : "") +
    (bt.length ? "" : '<div class="s">No publica contacto en la página: entrá a la web y buscalo ahí.</div>') + "</div>" +
    '<div class="precio"><span class="score ' + sc + '">' + p.puntaje + "</span></div>" +
    '<div class="acc">' + bt.join("") + '<a class="btn p" target="_blank" rel="noopener" href="' + esc(p.link) + '">Abrir web</a><button class="btn" data-msg="1">Copiar mensaje</button><select data-est="1">' + opts + "</select>" +
    (p.estado !== "descartado" ? '<button class="btn r" data-desc="1">Descartar</button>' : "") + "</div></div>";
}
function bloques(b) {
  var china = b.proveedores.filter(function (p) { return p.fuente !== "web"; }), web = b.proveedores.filter(function (p) { return p.fuente === "web"; }), h = "";
  if (china.length) h += '<div class="sec">🇨🇳 China · 1688 / Alibaba (con precio puesto en AR)</div><div class="provs">' + china.map(function (p) { return tarjetaProv(p, b); }).join("") + "</div>";
  ["ar", "py", "br", "cl", "us", "cn"].forEach(function (k) {
    var l = web.filter(function (p) { return p.pais === k; }); if (!l.length) return;
    h += '<div class="sec">' + PAIS[k] + " · web (" + l.length + ")</div>" + '<div class="provs">' + l.map(function (p) { return tarjetaWeb(p, b); }).join("") + "</div>";
  });
  return h;
}
function descargar(b) {
  var cols = ["pais", "fuente", "proveedor", "titulo", "link", "tipo", "calidad", "minimo", "puesto_u", "total", "puntaje", "whatsapp", "instagram", "mail", "telefono", "estado", "resumen"];
  var filas = b.proveedores.map(function (p) { var k = p.contactos || {}; var o = Object.assign({}, p, { whatsapp: (k.wa || []).join(" "), instagram: (k.ig || []).join(" "), mail: (k.mail || []).join(" "), telefono: (k.tel || []).join(" ") }); return cols.map(function (c) { var v = o[c] == null ? "" : String(o[c]); return '"' + v.replace(/"/g, '""') + '"'; }).join(","); });
  var a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["\ufeff" + cols.join(",") + "\n" + filas.join("\n")], { type: "text/csv" }));
  a.download = "proveedores-" + b.producto.replace(/[^a-z0-9]+/gi, "-").slice(0, 40) + ".csv"; a.click();
}
function tarjetaProv(p, b) {
  var sc = p.puntaje >= 7 ? "alto" : p.puntaje >= 5 ? "medio" : "";
  var tramos = (p.tramos || []).map(function (t) { return t.desde + "+: " + (p.moneda === "CNY" ? "¥" : "$") + t.precio; }).join(" · ");
  var tags = '<span class="tag">' + esc(p.fuente) + '</span>' + (p.verificado ? '<span class="tag">verificado</span>' : "") + (p.tipo === "fábrica" ? '<span class="tag">fábrica</span>' : "") + (p.minimo_ok ? "" : '<span class="tag no">mínimo ' + esc(p.minimo) + '</span>');
  var opts = DATOS.estadosProv.map(function (e) { return '<option' + (e === p.estado ? " selected" : "") + ">" + e + "</option>"; }).join("");
  return '<div class="pv ' + (p.estado === "descartado" ? "descartado" : "") + '" data-p="' + p.id + '">' +
    (p.foto ? '<a href="' + esc(p.link) + '" target="_blank" rel="noopener"><img loading="lazy" referrerpolicy="no-referrer" src="' + esc(p.foto) + '"></a>' : '<div style="width:56px"></div>') +
    '<div style="min-width:0"><div class="t">' + tags + esc(p.titulo) + '</div>' +
    '<div class="s">' + esc(p.proveedor || "Proveedor sin nombre") + " · " + esc(p.ubicacion) + (p.anios ? " · " + p.anios + " años" : "") + (p.calif ? " · ★ " + p.calif : "") + (p.ventas ? " · " + p.ventas + " vendidos" : "") + '</div>' +
    '<div class="s">Mínimo: <b>' + esc(p.minimo || "?") + '</b> · Precios: ' + esc(tramos) + (p.contacto ? " · " + esc(p.contacto) : "") + '</div>' + (p.resumen ? '<div class="resumen">⚠️ ' + esc(p.resumen) + "</div>" : "") + (p.titulo_orig && p.titulo_orig !== p.titulo ? '<div class="s">' + esc(p.titulo_orig) + "</div>" : "") + '</div>' +
    '<div class="precio"><span class="score ' + sc + '">' + p.puntaje + '</span><b>' + usd(p.puesto_u) + '</b><small>por unidad puesta en AR</small><small>Total x' + b.cantidad + ": " + usd(p.total) + '</small><small>FOB ' + usd(p.precio_usd) + '/u</small></div>' +
    '<div class="acc"><a class="btn p" target="_blank" rel="noopener" href="' + esc(p.link) + '">Abrir publicación</a>' +
    (p.prov_link ? '<a class="btn" target="_blank" rel="noopener" href="' + esc(p.prov_link) + '">Tienda</a>' : "") +
    '<button class="btn" data-msg="1">Copiar mensaje</button><select data-est="1">' + opts + '</select>' +
    (p.estado !== "descartado" ? '<button class="btn r" data-desc="1">Descartar</button>' : "") + '</div></div>';
}

function pintar(d) {
  if (!d.busquedas.length) { $("#lista").innerHTML = '<div class="vacio">' + (F === "mias" ? "No tenés búsquedas asignadas." : "No hay búsquedas.") + " Cargá una arriba.</div>"; return; }
  $("#lista").innerHTML = d.busquedas.map(function (b) {
    var otras = d.personas.filter(function (p) { return p !== b.asignado; });
    var activos = b.proveedores.filter(function (p) { return p.estado !== "descartado"; }).length;
    var c = b.consultas;
    return '<section class="card bq" id="b-' + b.id + '" data-b="' + b.id + '"><div class="cab"><div>' +
      '<h3>' + esc(b.producto) + " x" + b.cantidad + ' <span class="pill ' + b.estado + '">' + (ESTADOS[b.estado] || b.estado) + '</span></h3>' +
      '<div class="meta">#' + b.num + " · " + hace(b.ts) + " · para <b>" + esc(nombre(b.asignado)) + "</b>" + (b.cliente ? " · cliente: " + esc(b.cliente) : "") + " · calidad " + esc(b.calidad) + (b.presupuesto ? " · presupuesto " + esc(b.presupuesto) : "") + " · " + b.fuentes.join(" + ") + (b.paises && b.paises.length ? " (" + b.paises.join(", ").toUpperCase() + ")" : "") + (b.solo_minimo ? " · mínimo ≤ " + b.cantidad : "") + '</div>' +
      (c ? '<div class="meta">Buscado como: 「' + esc(c.zh) + '」 / "' + esc(c.en) + '" · peso estimado ' + c.peso_kg + " kg/u" + (c.peso_motivo ? " (" + esc(c.peso_motivo) + ")" : "") + (b.costo ? " · costó " + usd(b.costo) : "") + '</div>' : "") +
      '</div><div class="fila">' + otras.map(function (o) { return '<button class="btn" data-reasig="' + esc(o) + '">Pasar a ' + esc(nombre(o)) + '</button>'; }).join("") +
      (b.estado === "error" || b.estado === "lista" ? '<button class="btn" data-reint="1">Buscar de nuevo</button>' : "") + (b.proveedores.length ? '<button class="btn" data-csv="1">Descargar</button>' : "") + '<button class="btn" data-arch="1">Archivar</button></div></div>' +
      (b.nota ? '<div class="nota">' + esc(b.nota) + '</div>' : "") +
      (b.estado === "lista" ? (b.proveedores.length ? '<div class="meta" style="margin-top:8px">' + activos + " proveedores. China: ordenados por precio puesto, confianza, mínimo y parecido (el peso es estimado, confirmalo antes de cotizar). Web: por parecido, tipo de negocio y si publica WhatsApp.</div>" + bloques(b) : "") : '<div class="vacio">' + (b.estado === "error" ? "" : "Buscando en " + b.fuentes.join(" + ") + (b.webInfo ? " (web: faltan " + b.webInfo.faltan + " búsquedas)" : "") + "... se actualiza sola.") + "</div>") +
      "</section>";
  }).join("");
}

$("#lista").addEventListener("click", function (ev) {
  var el = ev.target.closest("button"); if (!el) return;
  var bq = el.closest("[data-b]"), pv = el.closest("[data-p]"), id = bq && bq.dataset.b;
  if (el.dataset.reasig) api("reasignar", { id: id, a: el.dataset.reasig }).then(function (r) { aviso(r.res); cargar(); });
  else if (el.dataset.reint) api("busqueda", { id: id, accion: "reintentar" }).then(function (r) { aviso(r.res); cargar(); });
  else if (el.dataset.arch) { if (confirm("¿Archivar esta búsqueda?")) api("busqueda", { id: id, accion: "archivar" }).then(function (r) { aviso(r.res); cargar(); }); }
  else if (el.dataset.desc) api("proveedor", { id: pv.dataset.p, estado: "descartado" }).then(function (r) { aviso(r.res); cargar(); });
  else if (el.dataset.msg) abrirMensaje(id, pv.dataset.p);
  else if (el.dataset.csv) descargar(DATOS.busquedas.find(function (x) { return x.id === id; }));
});
$("#lista").addEventListener("change", function (ev) { var s = ev.target; if (s.dataset.est) api("proveedor", { id: s.closest("[data-p]").dataset.p, estado: s.value }).then(function (r) { aviso(r.res); cargar(); }); });

var MSG = {};
function abrirMensaje(bid, pid) {
  var b = DATOS.busquedas.find(function (x) { return x.id === bid; }), p = b.proveedores.find(function (x) { return x.id === pid; });
  ["es", "pt", "en", "zh"].forEach(function (l) { MSG[l] = msgTexto(l, p, b.cantidad, b.producto); });
  MSG.l = p.fuente === "1688" ? "zh" : p.fuente === "alibaba" ? "en" : LENGUA[p.pais] || "es";
  pintarMsg(); $("#dlg").showModal();
}
function pintarMsg() { $("#dlgTxt").value = MSG[MSG.l]; document.querySelectorAll("#dlg [data-l]").forEach(function (b) { b.classList.toggle("p", b.dataset.l === MSG.l); }); }
document.querySelectorAll("#dlg [data-l]").forEach(function (b) { b.onclick = function () { MSG.l = b.dataset.l; pintarMsg(); }; });
$("#dlgCopiar").onclick = function () { var t = $("#dlgTxt"); t.select(); (navigator.clipboard ? navigator.clipboard.writeText(t.value) : Promise.reject()).then(function () { aviso("Copiado"); }, function () { document.execCommand("copy"); aviso("Copiado"); }); };
$("#dlgCerrar").onclick = function () { $("#dlg").close(); };

$("#filtros").onclick = function (ev) { var b = ev.target.closest("button"); if (!b) return; F = b.dataset.f; document.querySelectorAll("#filtros button").forEach(function (x) { x.classList.toggle("on", x === b); }); firma = ""; cargar(); };
$("#fEst").onchange = function () { firma = ""; cargar(); };
$("#bTg").onclick = function () { api("telegram", {}).then(function (r) { aviso(r.res); cargar(); }); };
$("#bBuscar").onclick = function () {
  var fuentes = [].slice.call(document.querySelectorAll(".fFuente:checked")).map(function (x) { return x.value; });
  var paises = [].slice.call(document.querySelectorAll("#fPaises input:checked")).map(function (x) { return x.value; });
  var body = { paises: paises, producto: $("#fProd").value, cantidad: $("#fCant").value, calidad: $("#fCal").value, presupuesto: $("#fPres").value, cliente: $("#fCli").value, asignar: $("#fAsig").value, fuentes: fuentes, soloMinimo: $("#fMin").checked, tarea: TAREA };
  var btn = $("#bBuscar"); btn.disabled = true;
  api("nueva", body).then(function (r) {
    btn.disabled = false; aviso(r.res);
    if (r.ok) { $("#fProd").value = ""; $("#fCant").value = ""; $("#fPres").value = ""; $("#fCli").value = ""; TAREA = null; F = r.asignado && r.asignado !== DATOS.quien ? "todas" : F; document.querySelectorAll("#filtros button").forEach(function (x) { x.classList.toggle("on", x.dataset.f === F); }); firma = ""; cargar(); }
  }).catch(function () { btn.disabled = false; });
};
// Si viene desde una tarea "Buscar proveedor" de Pendientes, se completa el formulario
var tq = new URLSearchParams(location.search).get("tarea");
if (tq) api("tarea?id=" + encodeURIComponent(tq)).then(function (t) { if (!t.ok) return; TAREA = t.id; $("#fProd").value = t.producto || ""; $("#fCant").value = t.cantidad || ""; $("#fCli").value = t.cliente || ""; aviso("Revisá el producto y la cantidad, y tocá Buscar"); });
document.querySelectorAll(".fFuente, #fPaises input").forEach(function (x) { x.onchange = costoEst; }); costoEst();
cargar(); setInterval(cargar, 20000);
</script></body></html>`;
