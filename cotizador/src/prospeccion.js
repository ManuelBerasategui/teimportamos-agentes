// Prospección: lo que manda y lee prospectar.py desde cada PC (ej. el WhatsApp de Buko) queda acá para verlo en el panel (pestaña Prospección).
const COLS = ["negocio", "rubro", "ciudad", "estado", "respuesta", "temperatura", "recontacto", "proximo_mensaje", "le_contestamos", "nota"];
let listo = false;
async function tabla(env) {
  if (listo) return;
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS prospectos (tel TEXT PRIMARY KEY, negocio TEXT, rubro TEXT, ciudad TEXT, estado TEXT, enviado_ts INTEGER, respuesta TEXT,
    temperatura TEXT, recontacto TEXT, proximo_mensaje TEXT, le_contestamos TEXT, nota TEXT, quien TEXT, act_ts INTEGER)`).run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS prospectos_act ON prospectos(act_ts)").run().catch(() => {});
  listo = true;
}
const corto = (v, n = 600) => String(v ?? "").slice(0, n);
// "enviado 11/11 14:05" -> timestamp (año actual; si da en el futuro, el anterior)
function tsEnviado(estado, ahora = Date.now()) {
  const m = String(estado || "").match(/enviado (\d{2})\/(\d{2})(?: (\d{2}):(\d{2}))?/);
  if (!m) return null;
  const y = new Date(ahora).getUTCFullYear();
  let t = Date.parse(`${y}-${m[2]}-${m[1]}T${m[3] || "12"}:${m[4] || "00"}:00-03:00`);
  if (t > ahora + 86400e3) t = Date.parse(`${y - 1}-${m[2]}-${m[1]}T${m[3] || "12"}:${m[4] || "00"}:00-03:00`);
  return Number.isFinite(t) ? t : null;
}

// Desde la PC: sube las filas de la planilla (solo las que ya tienen algo: enviado, respuesta, etc.). No pisa lo que se editó a mano en el panel (nota).
export async function syncProspectos(env, filas, quien) {
  await tabla(env);
  const l = (Array.isArray(filas) ? filas : []).map((f) => ({ ...f, tel: String(f.telefono || f.tel || "").replace(/\D/g, "") })).filter((f) => f.tel.length >= 8 && f.estado).slice(0, 400);
  const ahora = Date.now();
  const stmts = l.map((f) => env.DB.prepare(`INSERT INTO prospectos (tel, negocio, rubro, ciudad, estado, enviado_ts, respuesta, temperatura, recontacto, proximo_mensaje, le_contestamos, quien, act_ts)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(tel) DO UPDATE SET negocio=excluded.negocio, rubro=excluded.rubro, ciudad=excluded.ciudad, estado=excluded.estado,
      enviado_ts=COALESCE(excluded.enviado_ts, prospectos.enviado_ts), respuesta=COALESCE(NULLIF(excluded.respuesta,''), prospectos.respuesta),
            -- temperatura/fecha/próximo mensaje: solo se pisan cuando llega una respuesta nueva (así no se pierde lo que se editó en el panel)
      temperatura=CASE WHEN excluded.respuesta<>'' AND excluded.respuesta IS NOT prospectos.respuesta THEN excluded.temperatura ELSE COALESCE(prospectos.temperatura, NULLIF(excluded.temperatura,'')) END, recontacto=CASE WHEN excluded.respuesta<>'' AND excluded.respuesta IS NOT prospectos.respuesta THEN excluded.recontacto ELSE COALESCE(prospectos.recontacto, NULLIF(excluded.recontacto,'')) END, proximo_mensaje=CASE WHEN excluded.respuesta<>'' AND excluded.respuesta IS NOT prospectos.respuesta THEN excluded.proximo_mensaje ELSE COALESCE(prospectos.proximo_mensaje, NULLIF(excluded.proximo_mensaje,'')) END, le_contestamos=COALESCE(NULLIF(excluded.le_contestamos,''), prospectos.le_contestamos),
      quien=excluded.quien, act_ts=CASE WHEN prospectos.estado IS excluded.estado AND COALESCE(prospectos.respuesta,'') = COALESCE(NULLIF(excluded.respuesta,''), prospectos.respuesta, '') THEN prospectos.act_ts ELSE excluded.act_ts END`)
    .bind(f.tel, corto(f.negocio, 120), corto(f.rubro, 80), corto(f.ciudad, 80), corto(f.estado, 60), tsEnviado(f.estado, ahora), corto(f.respuesta), corto(f.temperatura, 20),
      corto(f.recontacto, 10), corto(f.proximo_mensaje), corto(f.le_contestamos), corto(quien, 40), ahora));
  for (let i = 0; i < stmts.length; i += 50) await env.DB.batch(stmts.slice(i, i + 50));
  return { guardados: stmts.length };
}

export async function listarProspectos(env) {
  await tabla(env);
  const filas = (await env.DB.prepare("SELECT * FROM prospectos ORDER BY act_ts DESC LIMIT 1000").all()).results || [];
  const hoy = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
  const r = { total: filas.length, enviados: 0, respondieron: 0, caliente: 0, neutro: 0, frio: 0, paraHoy: 0, sinWhatsapp: 0, hoy };
  for (const f of filas) {
    if (String(f.estado).startsWith("enviado")) r.enviados++;
    if (/sin whatsapp/.test(f.estado || "")) r.sinWhatsapp++;
    if (f.respuesta) r.respondieron++;
    if (r[f.temperatura] != null) r[f.temperatura]++;
    if (f.recontacto && f.recontacto <= hoy && f.temperatura !== "frio") r.paraHoy++;
  }
  return { resumen: r, prospectos: filas };
}

// Desde el panel: cambiar temperatura, fecha, próximo mensaje o nota; "hecho" = ya le escribiste (borra la fecha de recontacto)
export async function editarProspecto(env, b, quien) {
  await tabla(env);
  const tel = String(b.tel || "").replace(/\D/g, ""); if (!tel) return { error: "falta el número" };
  const set = [], val = [];
  if (b.temperatura != null) { set.push("temperatura=?"); val.push(["caliente", "neutro", "frio"].includes(b.temperatura) ? b.temperatura : ""); }
  if (b.recontacto != null) { set.push("recontacto=?"); val.push(/^\d{4}-\d{2}-\d{2}$/.test(b.recontacto) ? b.recontacto : ""); }
  if (b.proximo_mensaje != null) { set.push("proximo_mensaje=?"); val.push(corto(b.proximo_mensaje)); }
  if (b.nota != null) { set.push("nota=?"); val.push(corto(b.nota, 300)); }
  if (b.hecho) { set.push("recontacto=''", "le_contestamos=?"); val.push(`${new Date(Date.now() - 3 * 3600e3).toISOString().slice(5, 16).replace("T", " ")} (${quien || "panel"}): le escribí`); }
  if (!set.length) return { ok: true };
  await env.DB.prepare(`UPDATE prospectos SET ${set.join(", ")}, act_ts=? WHERE tel=?`).bind(...val, Date.now(), tel).run();
  return { ok: true };
}
export { COLS };
