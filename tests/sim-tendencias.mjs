// Tendencias para publicar (cotizador/src/tendencias.js): Google Trends + Mercado Libre → ranking del día, semana y mes
// con texto para grupos e Instagram. Correr desde cotizador/: node ../tests/sim-tendencias.mjs
import { DatabaseSync } from "node:sqlite";
import fs from "fs";
let ok = 0, mal = 0; const chk = (n, c) => { c ? ok++ : (mal++, console.log("FALLA:", n)); };
const dir = fs.mkdtempSync("/tmp/tend-");
for (const f of fs.readdirSync("src")) fs.copyFileSync("src/" + f, dir + "/" + f);
const db = new DatabaseSync(":memory:");
const stmt = (sql, b = []) => ({ bind: (...x) => stmt(sql, x), run: async () => { db.prepare(sql).run(...b); return {}; }, first: async () => db.prepare(sql).get(...b) ?? null, all: async () => ({ results: db.prepare(sql).all(...b) }) });
const env = { DB: { prepare: (s) => stmt(s), batch: async (a) => { for (const x of a) await x.run(); } } };
const T = await import(dir + "/tendencias.js");
const C = await import(dir + "/candidatos.js");
const M = await import(dir + "/mesa.js");
await M.prepararMesa(env);
const DIA = 86400e3, ahora = Date.parse("2026-11-23T12:10:00Z");   // lunes 09:10 en Argentina
const enHora = async (ts, f) => { const real = Date.now; Date.now = () => ts; try { return await f(); } finally { Date.now = real; } };

// 1) Curvas: crecimiento por período
const plana = Array(90).fill(20), sube = [...Array(60).fill(10), ...Array(30).fill(30)], baja = [...Array(83).fill(40), ...Array(7).fill(15)], pico = [...Array(87).fill(5), 60, 70, 80];
chk("curva que sube: mes ×3", T.curva(sube, T.PERIODOS.mes).ratio === 3);
chk("curva plana: ×1", T.curva(plana, T.PERIODOS.semana).ratio === 1);
chk("curva que baja la semana: < 0,9", T.curva(baja, T.PERIODOS.semana).ratio < 0.9);
chk("'Aumento' de Google = más de 5000%", T.crecDe("Aumento") === 5000 && T.crecDe("+3,500%") === 3500);

// 2) Lo que manda la PC
const r = await enHora(ahora - 2 * 3600e3, () => T.guardarGoogle(env, {
  descubiertas: [
    { palabra: "burbujeros", semilla: "por mayor", tiempo: "now 7-d", valor: "+5,000%" },
    { palabra: "reposeras", semilla: "por mayor", tiempo: "today 1-m", valor: "+4,600%" },
    { palabra: "pistolas de agua", semilla: "por mayor", tiempo: "now 7-d", valor: "Aumento" },
    { palabra: "auto usado", semilla: "comprar", tiempo: "now 7-d", valor: "+900%" },
  ],
  series: [
    { palabra: "burbujeros", fin: "2026-11-22", valores: sube },
    { palabra: "reposeras", fin: "2026-11-22", valores: sube },
    { palabra: "pistolas de agua", fin: "2026-11-22", valores: baja },
    { palabra: "organizador de cables", fin: "2026-11-22", valores: plana },
    { palabra: "mate", fin: "2026-11-22", valores: [1, 2, 3] },
  ],
}));
chk("guarda descubiertas y curvas (descarta la curva corta)", r.ok && db.prepare("SELECT COUNT(*) n FROM gt_serie").get().n === 4 && db.prepare("SELECT COUNT(*) n FROM gt_desc").get().n === 4);
// Mercado Libre: reposeras es tendencia y tiene listado
const top = [1, 2, 3].map((i) => ({ titulo: "Reposera playa " + i, precio: 30000, vendidos: "+5mil vendidos", vendidos_n: 5000, calif: 4.6, full: i === 1, oficial: false, ad: false }));
await enHora(ahora - 3600e3, () => M.guardarML(env, { items: [{ palabra: "Reposeras", tipo: "mayor crecimiento", puesto: 4, top }, { palabra: "Organizador de cables", tipo: "mayor crecimiento", puesto: 30, top }] }));

// 3) Ranking
const leer = async () => ({ desc: db.prepare("SELECT * FROM gt_desc").all(), series: db.prepare("SELECT * FROM gt_serie").all(), ml: db.prepare("SELECT ts, clave, palabra, tipo, puesto, top FROM ml_observaciones").all(), feedback: db.prepare("SELECT * FROM ml_feedback").all() });
const mes = T.ranking(await leer(), "mes", ahora);
const sem = T.ranking(await leer(), "semana", ahora);
chk("mes: reposeras primero (Google sube ×3 + en aumento + tendencia en ML con ventas)", mes[0]?.clave === "reposeras" && mes[0].cruce);
chk("los motivos traen los números medidos", mes[0].motivos.some((m) => /\+200%/.test(m)) && mes[0].motivos.some((m) => /\+5\.000/.test(m)));
chk("lo que baja no es tendencia aunque Google lo haya listado", !sem.some((x) => x.clave === "pistolas de agua"));
chk("autos fuera (no es producto para revender)", !mes.some((x) => x.clave === "auto usado") && !sem.some((x) => x.clave === "auto usado"));
chk("plano y sin aumento no entra", !mes.some((x) => x.clave === "organizador de cables"));
chk("semana: burbujeros entra por 'en aumento' de esta semana", sem.some((x) => x.clave === "burbujeros"));
await M.guardarML(env, { items: [] }).catch(() => {});
db.prepare("INSERT OR REPLACE INTO ml_feedback (clave, estado, nota, ts) VALUES ('reposeras','descartada','',?)").run(ahora - DIA);
chk("lo descartado en el panel no vuelve por 30 días", !T.ranking(await leer(), "mes", ahora).some((x) => x.clave === "reposeras"));
db.prepare("DELETE FROM ml_feedback").run();

// 4) Textos listos para copiar
const tx = T.textos(mes, "mes");
chk("texto de grupos: lista, fuente y llamado a mandar foto", /Productos en tendencia del mes/.test(tx.whatsapp) && /Reposeras/.test(tx.whatsapp) && /Google Trends y Mercado Libre/.test(tx.whatsapp) && /foto/.test(tx.whatsapp));
chk("texto de Instagram con CTA de comentario WHATSAPP", /Comentá WHATSAPP/.test(tx.instagram) && /#importacion/.test(tx.instagram));
chk("sin promesas de ganancia", !/gan[aá]s|ganancia asegurada|vas a ganar/i.test(tx.whatsapp + tx.instagram));

// 5) Envío automático
const enviados = [];
const avisar = async (_e, t) => enviados.push(t);
chk("fuera de las 09:10 no manda", (await T.cronTendencias(env, ahora + 60e3, avisar)).motivo === "no es la hora");
const c1 = await T.cronTendencias(env, ahora, avisar);
chk("lunes 09:10: manda el del día y el de la semana", c1.enviados.join() === "dia,semana" && enviados.length === 2 && /Para Instagram/.test(enviados[0]));
const c2 = await T.cronTendencias(env, ahora, avisar);
chk("no repite el mismo día", c2.enviados.length === 0 && enviados.length === 2);
const c3 = await T.cronTendencias(env, Date.parse("2026-12-01T12:10:00Z"), avisar);
chk("día 1: manda el del mes (y avisa si la PC no mandó datos)", c3.enviados.includes("mes") && /36 h/.test(enviados[enviados.length - 1]));
chk("TENDENCIAS=0 lo apaga", (await T.cronTendencias({ ...env, TENDENCIAS: "0" }, ahora, avisar)).motivo === "apagado");

// 6) Panel y candidatos
const p = await T.tendenciasPanel(env, "mes", ahora);
chk("panel: lista, textos y última lectura de la PC", p.lista.length >= 1 && p.textos.whatsapp && p.ultima?.series === 5);
const g = await T.curvasGoogle(env);
const ev = C.evaluarML(db.prepare("SELECT ts, dia, clave, palabra, categoria, tipo, resultados, top FROM ml_observaciones").all(), [], ahora, C.umbrales({}), g);
chk("candidatos: Google sostenido cuenta como demanda estable (sin esperar 3 semanas)", ev.find((x) => x.clave === "reposeras").checks.find((k) => k.id === "estable").ok === true);

console.log(`sim-tendencias: ${ok} ok, ${mal} fallas`);
if (mal) process.exit(1);
