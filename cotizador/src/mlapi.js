// MERCADO LIBRE POR LA API OFICIAL (gratis, sin navegador, sin captcha, sin iniciar sesión en una ventana automatizada)
// Mercado Libre no deja iniciar sesión en una ventana manejada por un programa y pide sesión para ver los listados.
// La salida limpia es su API: Manuel crea una aplicación gratis en developers.mercadolibre.com.ar, la conecta una vez
// desde el panel y el worker lee solo, todos los días:
//   · /trends/MLA y /trends/MLA/{categoría}: las búsquedas que más crecen, más deseadas y más populares, por categoría
//   · /sites/MLA/search?q=: las publicaciones de cada búsqueda (precio, Full, tienda oficial, envío gratis, total)
// Lo guarda igual que lo que mandaba la PC (guardarML), así Candidatos y Tendencias lo usan sin cambios.
// Variables en Cloudflare: ML_APP_ID, ML_SECRET. La redirección de la app tiene que ser <worker>/ml/callback.
import { guardarML } from "./mesa.js";

const AR = 3 * 3600e3, DIA = 86400e3;
const API = "https://api.mercadolibre.com";
const corto = (t, n = 200) => String(t || "").replace(/\s+/g, " ").trim().slice(0, n);
const kvGet = async (env, k) => (await env.DB.prepare("SELECT v FROM kv WHERE k=?").bind(k).first().catch(() => null))?.v ?? null;
const kvPut = (env, k, v) => env.DB.prepare("INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)").bind(k, typeof v === "string" ? v : JSON.stringify(v)).run();
const kvJson = async (env, k, d = null) => { try { return JSON.parse((await kvGet(env, k)) || "null") ?? d; } catch { return d; } };
const diaAR = (ts) => new Date(ts - AR).toISOString().slice(0, 10);
// Categorías raíz que no son productos para revender
const SIN_PRODUCTO = /^(MLA1743|MLA1459|MLA1540|MLA1512|MLA2547|MLA409431|MLA1798)$/;   // autos, inmuebles, servicios, agro, entradas, salud(medicamentos), coleccionables
export const POR_TICK = 12;   // llamadas a la API por minuto de cron (Cloudflare limita subpedidos por ejecución)

async function prep(env) { await env.DB.prepare("CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT, exp INTEGER)").run(); }
// Tiene que coincidir EXACTO con la "URI de redirect" cargada en la app de Mercado Libre
const redir = (env) => `${(env.ML_BASE || "https://cotizador.berasateguimanuel07.workers.dev").replace(/\/$/, "")}/ml/callback`;

// Panel: estado de la conexión y link para conectar (con "state" de un solo uso)
export async function estadoML(env) {
  await prep(env);
  const tok = await kvJson(env, "mlapi_token"), ult = await kvJson(env, "mlapi_ultima"), cola = await kvJson(env, "mlapi_cola", []);
  const falta = [!env.ML_APP_ID && "ML_APP_ID", !env.ML_SECRET && "ML_SECRET"].filter(Boolean);
  let url = null;
  if (!falta.length) {
    const state = crypto.randomUUID();
    await kvPut(env, "mlapi_state", { state, ts: Date.now() });
    url = `https://auth.mercadolibre.com.ar/authorization?response_type=code&client_id=${encodeURIComponent(env.ML_APP_ID)}&redirect_uri=${encodeURIComponent(redir(env))}&state=${state}`;
  }
  return { conectado: !!tok?.refresh, usuario: tok?.usuario || null, falta, url_conectar: url, redireccion: redir(env), ultima: ult, en_cola: cola.length };
}

async function pedirToken(env, cuerpo) {
  const r = await fetch(`${API}/oauth/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" }, body: new URLSearchParams({ client_id: env.ML_APP_ID, client_secret: env.ML_SECRET, ...cuerpo }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error(`token: ${r.status} ${corto(j.message || j.error, 80)}`);
  return j;
}

// Vuelta de Mercado Libre después de que Manuel autoriza la app
export async function callbackML(env, url) {
  await prep(env);
  const st = await kvJson(env, "mlapi_state");
  const html = (t) => new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><body style="font-family:system-ui;padding:24px"><h2>${t}</h2><p>Podés cerrar esta pestaña y volver al panel.</p>`, { headers: { "content-type": "text/html; charset=utf-8" } });
  if (!st || st.state !== url.searchParams.get("state") || Date.now() - st.ts > 30 * 60e3) return html("El link venció o no es válido. Volvé a tocar “Conectar Mercado Libre” en el panel.");
  const code = url.searchParams.get("code");
  if (!code) return html("Mercado Libre no mandó la autorización.");
  try {
    const j = await pedirToken(env, { grant_type: "authorization_code", code, redirect_uri: redir(env) });
    let usuario = null;
    try { const me = await (await fetch(`${API}/users/me`, { headers: { authorization: `Bearer ${j.access_token}` } })).json(); usuario = me.nickname || null; } catch {}
    await kvPut(env, "mlapi_token", { access: j.access_token, refresh: j.refresh_token, vence: Date.now() + (j.expires_in || 21600) * 1000 - 300e3, usuario });
    await env.DB.prepare("DELETE FROM kv WHERE k='mlapi_state'").run();
    return html(`Mercado Libre conectado${usuario ? ` (${usuario})` : ""} ✅`);
  } catch (e) { return html("No se pudo conectar: " + corto(e.message, 120)); }
}

async function token(env) {
  const t = await kvJson(env, "mlapi_token");
  if (!t?.refresh) return null;
  if (t.access && Date.now() < t.vence) return t.access;
  const j = await pedirToken(env, { grant_type: "refresh_token", refresh_token: t.refresh });   // el refresh se renueva en cada uso
  await kvPut(env, "mlapi_token", { ...t, access: j.access_token, refresh: j.refresh_token || t.refresh, vence: Date.now() + (j.expires_in || 21600) * 1000 - 300e3 });
  return j.access_token;
}

async function api(env, tk, ruta) {
  const r = await fetch(API + ruta, { headers: { authorization: `Bearer ${tk}`, accept: "application/json" } });
  if (!r.ok) { const j = await r.json().catch(() => ({})); throw Object.assign(new Error(`${ruta.split("?")[0]} → ${r.status} ${corto(j.message || j.error, 60)}`), { status: r.status }); }
  return r.json();
}

// La respuesta de /trends viene ordenada: 10 de mayor crecimiento, 20 más deseadas, 20 más populares
export const tipoTrend = (i) => (i < 10 ? "mayor crecimiento" : i < 30 ? "más deseada" : "más popular");
// Una publicación de /sites/MLA/search → el mismo formato que leía la PC
export const tarjeta = (x) => ({
  titulo: corto(x.title, 80), precio: +x.price || null, url: corto(x.permalink, 300),
  vendidos: x.sold_quantity > 0 ? `+${x.sold_quantity} vendidos` : "", vendidos_n: x.sold_quantity > 0 ? x.sold_quantity : null,
  full: x.shipping?.logistic_type === "fulfillment", oficial: !!x.official_store_id, gratis: !!x.shipping?.free_shipping,
  ad: false, mas_vendido: false, calif: null,
});

// Todos los días 07:00 (AR) arma la cola; cada minuto hasta vaciarla hace POR_TICK llamadas y guarda.
export async function cronMLApi(env, ts = Date.now(), { forzar = false } = {}) {
  if (!env.DB || !env.ML_APP_ID || !env.ML_SECRET) return { ok: false, motivo: "sin app" };
  await prep(env);
  let cola = await kvJson(env, "mlapi_cola", []);
  const d = new Date(ts - AR), hoy = diaAR(ts);
  if ((forzar || (d.getUTCHours() === 7 && d.getUTCMinutes() === 0)) && (forzar || (await kvGet(env, "mlapi_armada")) !== hoy)) {
    cola = [{ t: "cats" }, { t: "trends", cat: "", nombre: "Todas" }];
    await kvPut(env, "mlapi_armada", hoy);
    await kvPut(env, "mlapi_ultima", { ts, inicio: ts, trends: 0, busquedas: 0, errores: [] });
  }
  if (!cola.length) return { ok: true, motivo: "nada en cola" };
  let tk; try { tk = await token(env); } catch (e) { await kvPut(env, "mlapi_ultima", { ts, error: "No se pudo renovar el acceso: reconectá Mercado Libre desde el panel. " + corto(e.message, 80) }); return { ok: false, motivo: "token" }; }
  if (!tk) return { ok: false, motivo: "no conectado" };
  const ult = await kvJson(env, "mlapi_ultima", { trends: 0, busquedas: 0, errores: [] });
  const maxBusq = +env.ML_API_BUSQ || 80;
  const items = [];
  let hechas = 0;
  while (cola.length && hechas < POR_TICK) {
    const j = cola.shift(); hechas++;
    try {
      if (j.t === "cats") {
        const cats = await api(env, tk, "/sites/MLA/categories");
        for (const c of cats) if (!SIN_PRODUCTO.test(c.id)) cola.push({ t: "trends", cat: c.id, nombre: corto(c.name, 40) });
      } else if (j.t === "trends") {
        const tr = await api(env, tk, `/trends/MLA${j.cat ? "/" + j.cat : ""}`);
        ult.trends = (ult.trends || 0) + tr.length;
        tr.forEach((x, i) => {
          const palabra = corto(x.keyword, 60); if (!palabra) return;
          const fila = { palabra, tipo: tipoTrend(i), puesto: i + 1, categoria: j.nombre };
          // Se buscan las primeras de cada lista (crecimiento primero); el resto se guarda solo con el nombre
          if ((i < 6 || (i >= 10 && i < 14)) && cola.filter((q) => q.t === "search").length + (ult.busquedas || 0) < maxBusq && !cola.some((q) => q.t === "search" && q.fila.palabra.toLowerCase() === palabra.toLowerCase())) cola.push({ t: "search", fila });
          else items.push(fila);
        });
      } else if (j.t === "search") {
        const s = await api(env, tk, `/sites/MLA/search?q=${encodeURIComponent(j.fila.palabra)}&limit=20`);
        const top = (s.results || []).slice(0, 10).map(tarjeta);
        const precios = top.map((x) => x.precio).filter(Boolean);
        items.push({ ...j.fila, resultados: s.paging?.total ?? null, precio_min: precios.length ? Math.min(...precios) : null, precio_max: precios.length ? Math.max(...precios) : null, vendidos: top[0]?.vendidos || "", top });
        ult.busquedas = (ult.busquedas || 0) + 1;
      }
    } catch (e) {
      ult.errores = [...(ult.errores || []), corto(e.message, 100)].slice(-5);
      if (e.status === 401) { cola.unshift(j); await env.DB.prepare("UPDATE kv SET v=json_set(v,'$.vence',0) WHERE k='mlapi_token'").run().catch(() => {}); break; }
      if (j.t === "search") items.push(j.fila);   // sin listado (por ejemplo, si la API no deja buscar): queda el nombre
    }
  }
  for (let i = 0; i < items.length; i += 80) await guardarML(env, { items: items.slice(i, i + 80), acumular: true });   // guardarML toma hasta 80 por vez
  await kvPut(env, "mlapi_cola", cola);
  await kvPut(env, "mlapi_ultima", { ...ult, ts, pendientes: cola.length });
  return { ok: true, hechas, guardadas: items.length, pendientes: cola.length };
}

// Para la PC: si la API está conectada no abre Mercado Libre en el navegador (solo Google Trends),
// y mide en Google las búsquedas que la API trajo esta semana.
export async function estadoParaPC(env) {
  await prep(env);
  const tok = await kvJson(env, "mlapi_token");
  let palabras = [];
  try { palabras = ((await env.DB.prepare("SELECT palabra, MIN(puesto) p FROM ml_observaciones WHERE ts>=? GROUP BY clave ORDER BY p LIMIT 60").bind(Date.now() - 7 * DIA).all()).results || []).map((x) => x.palabra); } catch {}
  return { api_conectada: !!tok?.refresh, palabras };
}
