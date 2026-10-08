// Fase 1 · métricas de Instagram: permisos, métricas que no existen, paginado, límite de consultas y cambio de token
import { DatabaseSync } from "node:sqlite";
import fs from "fs";
const dir = fs.mkdtempSync("/tmp/igm-");
for (const f of ["instagram.js", "metricas.js", "sync.js", "formatos-iniciales.js"]) fs.copyFileSync(new URL("../instagram/src/" + f, import.meta.url), `${dir}/${f}`);
let ok = 0, mal = 0; const chk = (n, c) => { c ? ok++ : (mal++, console.log("FALLA:", n)); };

// ---- Instagram simulado ----
function fakeIG({ permiso = true, malas = ["profile_activity"], total = 45, rechazaCampo = false } = {}) {
  let llamadas = 0;
  const posts = Array.from({ length: total }, (_, i) => ({ id: "m" + i, caption: "post " + i, media_type: i % 3 ? "VIDEO" : "CAROUSEL_ALBUM", media_product_type: i % 3 ? "REELS" : "FEED", permalink: "https://ig/p/" + i, timestamp: "2026-09-01T12:00:00+0000", like_count: i, comments_count: 1 }));
  const ig = async (ruta, _m, p = {}) => {
    llamadas++;
    if (ruta === "/me") return { user_id: "1", username: "teimportamos", followers_count: 1500, media_count: total };
    if (ruta === "/me/media" && rechazaCampo && p.fields.includes("is_shared_to_feed")) throw new Error("Instagram /me/media: (#100) Tried accessing nonexisting field (is_shared_to_feed)");
    if (ruta === "/me/media") { const desde = +(p.after || 0), n = +p.limit; const d = posts.slice(desde, desde + n); return { data: d, paging: desde + n < total ? { next: "x", cursors: { after: String(desde + n) } } : {} }; }
    if (ruta.endsWith("/insights")) {
      if (!permiso) throw new Error(`Instagram ${ruta}: (#10) Application does not have permission for this action`);
      const ms = p.metric.split(",");
      const bad = ms.find((m) => malas.includes(m)); if (bad) throw new Error(`Instagram ${ruta}: (#100) metric[0] must be one of the following values`);
      if (p.breakdown) return { data: [{ name: "follower_demographics", total_value: { breakdowns: [{ results: [{ dimension_values: [p.breakdown], value: 10 }] }] } }] };
      if (p.metric_type === "total_value") return { data: ms.map((m) => ({ name: m, total_value: { value: 100 } })) };
      return { data: ms.map((m) => ({ name: m, values: m === "reach" && ruta !== "/me/insights" ? [{ value: 50 }] : [{ value: 5, end_time: "2026-09-01T07:00:00+0000" }, { value: 7, end_time: "2026-09-02T07:00:00+0000" }] })) };
    }
    throw new Error("ruta desconocida " + ruta);
  };
  return { ig, n: () => llamadas, reset: () => (llamadas = 0) };
}

const { cuenta, posts, PAGINA } = await import(`${dir}/metricas.js`);

// 1) Con permiso, una métrica que no existe
let F = fakeIG();
const c = await cuenta(F.ig);
chk("permiso ok", c.permisos.insights === true);
chk("alcance 30d", c.ultimos30.reach === 100 && c.anteriores30.reach === 100);
chk("serie diaria", Array.isArray(c.series.reach) && c.series.reach.length === 2);
chk("publico", !!c.publico.age.breakdowns);
chk("cuenta < 45 consultas", F.n() < 45);
F.reset();
const p1 = await posts(F.ig);
chk("20 por pagina", p1.items.length === 20 && p1.siguiente === "20");
chk("posts < 45 consultas (Cloudflare gratis: 50)", F.n() <= 45);
const feed = p1.items.find((x) => x.tipo === "FEED"), reel = p1.items.find((x) => x.tipo === "REELS");
chk("feed con base tras fallar profile_activity", feed.insights.reach === 50 && !feed.insights_error);
chk("reel con tiempo de visualizacion", reel.insights.ig_reels_avg_watch_time !== undefined);
const p3 = await posts(F.ig, "40"); chk("ultima pagina", p3.items.length === 5 && p3.siguiente === "");

// 1b) Meta no acepta is_shared_to_feed: igual trae la lista
F = fakeIG({ rechazaCampo: true }); const pr = await posts(F.ig); chk("sin campo en_feed: igual lista", pr.items.length === 20);
chk("campo en_feed presente", "en_feed" in p1.items[0]);

// 2) Sin permiso de insights
F = fakeIG({ permiso: false });
const c2 = await cuenta(F.ig);
chk("detecta falta de permiso", c2.permisos.insights === false && /permission/.test(c2.permisos.detalle));
chk("sin permiso corta rápido", F.n() <= 3);
F.reset(); const p2 = await posts(F.ig);
chk("posts sin permiso: igual lista", p2.items.length === 20 && !!p2.sin_permiso && F.n() <= 3);

// 3) Página: JS válido
const sc = PAGINA.match(/<script>([\s\S]*)<\/script>/)[1]; try { new Function(sc); chk("js ok", true); } catch (e) { chk("js: " + e.message, false); }

// 4) Worker completo: clave, rutas y cambio de token
const db = new DatabaseSync(":memory:");
const stmt = (sql, b = []) => ({ bind: (...x) => stmt(sql, x), run: async () => { db.prepare(sql).run(...b); return {}; }, first: async () => db.prepare(sql).get(...b) ?? null, all: async () => ({ results: db.prepare(sql).all(...b) }) });
const DB = { prepare: (s) => stmt(s), batch: async (a) => { for (const x of a) await x.run(); } };
let tokensUsados = [];
globalThis.fetch = async (u) => {
  const url = new URL(String(u)); tokensUsados.push(url.searchParams.get("access_token"));
  const body = url.pathname.endsWith("/me") ? { user_id: "1", username: "teimportamos", followers_count: 1500, media_count: 0 } : url.pathname.endsWith("/me/media") ? { data: [] } : { data: [] };
  return new Response(JSON.stringify(body), { status: 200 });
};
const W = (await import(`${dir}/instagram.js?a`)).default;
const env = { DB, IG_TOKEN: "viejo_token_AAAAAAAAAAAA", VERIFY_TOKEN: "k" };
chk("sin clave 401", (await W.fetch(new Request("https://x/metricas"), env)).status === 401);
const pg = await W.fetch(new Request("https://x/metricas?clave=k"), env);
chk("pagina html", pg.status === 200 && (await pg.text()).includes("Métricas de Instagram"));
const cj = await (await W.fetch(new Request("https://x/metricas/cuenta?clave=k"), env)).json();
chk("cuenta json", cj.perfil.username === "teimportamos");
// simula token renovado guardado y luego un IG_TOKEN nuevo en Cloudflare
db.prepare("UPDATE kv SET v='renovado_viejo' WHERE k='ig_token'").run();
if (!db.prepare("SELECT 1 FROM kv WHERE k='ig_token'").get()) db.prepare("INSERT INTO kv (k,v) VALUES ('ig_token','renovado_viejo')").run();
const W2 = (await import(`${dir}/instagram.js?b`)).default;   // isolate nuevo (sin caché)
tokensUsados = []; await W2.fetch(new Request("https://x/metricas/cuenta?clave=k"), env);
chk("mismo IG_TOKEN: usa el renovado", tokensUsados.includes("renovado_viejo"));
const W3 = (await import(`${dir}/instagram.js?c`)).default;
tokensUsados = []; await W3.fetch(new Request("https://x/metricas/cuenta?clave=k"), { ...env, IG_TOKEN: "nuevo_con_permisos_BBBBBBBBBBBB" });
chk("IG_TOKEN nuevo: lo usa", tokensUsados.includes("nuevo_con_permisos_BBBBBBBBBBBB") && !tokensUsados.includes("renovado_viejo"));
chk("guarda el nuevo", db.prepare("SELECT v FROM kv WHERE k='ig_token'").get().v === "nuevo_con_permisos_BBBBBBBBBBBB");
console.log(`sim-ig-metricas: ${ok} ok, ${mal} fallas`);
if (mal) process.exit(1);
