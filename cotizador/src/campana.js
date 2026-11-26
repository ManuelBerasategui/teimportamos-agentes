// Campaña de seguimientos: mientras está activa, seguimientos.bat manda SOLO mensajes promocionando el cupo de la campaña
// (hoy: suecos) a clientes elegidos de los chats privados, personalizados según lo que hablamos con cada uno.
// Prueba dos estilos: A (con la lista de precios) y B (sin precios, ofrece pasarla). Cada envío queda en w_hito tipo 'campana'.
// Para apagarla: poner activa:false (o kv "campana_off" = "1").

export const CAMPANA = {
  id: "suecos-2611",
  activa: true,
  hasta: "2026-11-30",          // después de este día se apaga sola
  meta: 50,                     // mensajes por día
  producto: "suecos",
  descripcion: "suecos con plantilla de corcho, suela antideslizante y hebilla regulable, en negro, camel y crudo; el calzado tendencia de este verano",
  precios: [[20, "20"], [35, "18"], [50, "16,5"], [70, "16"], [100, "15"]],   // [unidades, USD por unidad]
  limitado: "unidades limitadas",
};

const listaPrecios = (c = CAMPANA) => c.precios.map(([u, p]) => `${u} u a USD ${p}`).join(", ");
// Solo clientes afines al producto: calzado, ropa, moda, mallas o reventa de indumentaria. Un servicio técnico de celulares no.
const RE_INTERES = /calzad|zapat|zapa\b|zapas|sandal|ojota|suec|crocs|ropa|indument|mallas?\b|shorts?\b|remeras?|buzos?|camperas?|moda|boutique|showroom|vestimenta|outfit|textil|feria americana|tienda de ropa|local de ropa/i;
const RE_NO_AFIN = /servicio t[eé]cnico|t[eé]cnico|celular|cell\b|repuest|autopart|ferreter|electr[oó]nic|inform[aá]tic|computaci|gamer|barber|peluquer|veterinar|inmobiliar|farmac|kiosco|librer|construcc|taller mec|insumos/i;
const RE_NO = /\bno (me )?(interesa|sirve|gracias|va|voy a (comprar|seguir))|lo dejo\b|lo dejamos\b|dej[aá] de escribir|no me escrib|no molest|borr[aá]me|dar de baja|ya tengo proveedor|no me convenc/i;
const RE_ACUSE = /^\s*(ok(a|as|ey|is)?|okay|dale|gracias|muchas gracias|mil gracias|genial|perfecto|buen[ií]simo|bueno|b[aá]rbaro|joya|listo|de una|👍|🙏|❤️|😊|🙌)[\s!.,a-záéíóúñ👍🙏]{0,40}$/i;
// Cliente "activo": hay plata o un pedido en el medio (pagó, señó, está esperando que le llegue). A esos NO se les manda promoción.
const RE_ACTIVO = /pag(o|u[eé]|aste|amos|ado)\b|transfer|comprobante|se[ñn]a(r|ste|mos)?\b|alias|cbu|cvu|factura|recib(imos|í) (el|tu) pago|tu pedido|su pedido|el pedido|despach|en camino|llega(ría)? (el|la|en)|cu[aá]ndo (me )?lleg|tracking|seguimiento del env|andreani|oca\b|correo argentino|retir(o|ar|ás) (el|en)/i;
const diaAR = (ts = Date.now()) => new Date(ts - 3 * 3600e3).toISOString().slice(0, 10);

async function kv(env, k, v) {
  if (v === undefined) return (await env.DB.prepare("SELECT v FROM kv WHERE k=?").bind(k).first().catch(() => null))?.v ?? null;
  await env.DB.prepare("INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)").bind(k, v).run().catch(() => {});
}

export async function campanaActiva(env) {
  if (!CAMPANA.activa || diaAR() > CAMPANA.hasta) return null;
  if ((await kv(env, "campana_off")) === "1") return null;
  return CAMPANA;
}

// Mensaje de respaldo (si la IA no responde): personalizado con el nombre y lo que venía viendo
export function mensajeCampana(f, variante, c = CAMPANA) {
  const nom = String(f.nombre || "").split(/\s+/)[0].replace(/[^\p{L}]/gu, "").toLowerCase();
  const hola = nom && nom.length > 1 && nom.length < 15 ? `hola ${nom}, como va?` : "hola, como va?";
  const antes = f.producto && !/suec/i.test(f.producto) ? ` te escribo porque cuando hablamos de ${String(f.producto).toLowerCase().slice(0, 40)} me quedaste en mente para esto.` : "";
  if (variante === "A") return `${hola}${antes} te la tiro por si te sirve: traemos suecos por mayor y nos estamos quedando sin cupos, liquidamos los últimos. por cantidad quedan así: ${listaPrecios(c)} c/u. si te sirve, reservás y te doy prioridad`;
  return `${hola}${antes} paso a dejarte acceso a los últimos cupos de suecos que estamos largando, quedan pocos. si querés te mando fotos y precios y reservás antes que se terminen`;
}

// Elige los clientes: chats privados con charla real, sin "no me interesa", sin algo pendiente de contestar, sin mensaje nuestro en las últimas 20 h
export async function candidatosCampana(env, c = CAMPANA, { max = 120 } = {}) {
  const ahora = Date.now();
  const ya = new Set(((await env.DB.prepare("SELECT conv FROM w_hito WHERE tipo='campana' AND dato LIKE ?").bind(c.id + "%").all().catch(() => ({}))).results || []).map((r) => String(r.conv)));
  const filas = (await env.DB.prepare(`SELECT conv, nombre, producto, puntaje, etapa, ult_ts, ult_yo, ult_texto, ult_cliente_ts, ult_yo_ts, COALESCE(perfil,'') AS perfil FROM w_conv
    WHERE grupo=0 AND COALESCE(archivado,0)=0 AND COALESCE(prov,0)=0 AND COALESCE(ult_cliente_ts,0) > ? AND ult_ts > ?
    ORDER BY COALESCE(puntaje,0) DESC, ult_ts DESC LIMIT 400`).bind(0, ahora - 120 * 864e5).all().catch(async () =>
    env.DB.prepare(`SELECT conv, nombre, producto, puntaje, etapa, ult_ts, ult_yo, ult_texto, ult_cliente_ts, ult_yo_ts, '' AS perfil FROM w_conv
    WHERE grupo=0 AND COALESCE(archivado,0)=0 AND COALESCE(ult_cliente_ts,0) > 0 AND ult_ts > ? ORDER BY COALESCE(puntaje,0) DESC, ult_ts DESC LIMIT 400`).bind(ahora - 120 * 864e5).all())).results || [];
  // Pedidos de la planilla que no están entregados ni cancelados: esos clientes esperan su compra
  const conPedido = new Set(((await env.DB.prepare("SELECT conv, tel, estado FROM planilla WHERE COALESCE(ts,0) > ?").bind(ahora - 120 * 864e5).all().catch(() => ({}))).results || [])
    .filter((p) => !/entregad|cancel|anulad/i.test(String(p.estado || ""))).flatMap((p) => [String(p.conv || ""), String(p.tel || "").replace(/\D/g, "")]).filter(Boolean));
  const pre = filas.filter((f) => !conPedido.has(String(f.conv)) && !/vendido|pagad|pedido|envio|transito/i.test(String(f.etapa || ""))) .filter((f) => /^\d{8,15}$/.test(String(f.conv)) && !ya.has(String(f.conv))
    && !/no_cliente|proveedor|spam|vendido_hoy/i.test(String(f.etapa || ""))
    && ahora - Math.max(f.ult_yo_ts || 0, f.ult_yo ? f.ult_ts : 0) > 20 * 3600e3);
  const out = [];
  for (let i = 0; i < pre.length && out.length < max; i += 25) {
    const tanda = pre.slice(i, i + 25);
    const charlas = await Promise.all(tanda.map((f) => env.DB.prepare("SELECT yo, texto, ts FROM w_msg WHERE conv=? AND COALESCE(texto,'')<>'' ORDER BY ts DESC LIMIT 14").bind(f.conv).all().then((r) => (r.results || []).reverse()).catch(() => [])));
    tanda.forEach((f, k) => {
      const ms = charlas[k]; if (!ms.length) return;
      const cli = ms.filter((m) => !m.yo); if (!cli.length) return;
      if (cli.some((m) => RE_NO.test(String(m.texto || "")))) return;                    // dijo que no
      const ult = ms[ms.length - 1];
      if (!ult.yo && !RE_ACUSE.test(String(ult.texto || "")) && ahora - ult.ts < 10 * 864e5) return;   // nos debe respuesta a nosotros
      if (ms.some((m) => m.yo && ahora - m.ts < 20 * 3600e3)) return;                    // ya le escribimos hoy
      if (cli.some((m) => ahora - m.ts < 3 * 864e5)) return;                               // charla activa en los últimos 3 días: no se interrumpe con promo
      if (ms.some((m) => ahora - m.ts < 45 * 864e5 && RE_ACTIVO.test(String(m.texto || "")))) return;   // pagó / pedido en curso / esperando envío
      if (ms.some((m) => m.yo && /suec/i.test(String(m.texto || "")))) return;            // ya le hablamos de suecos (a mano o por campaña)
      const todo = ms.map((m) => m.texto).join(" ") + " " + (f.producto || "") + " " + (f.perfil || "");
      const afin = RE_INTERES.test(todo + " " + (f.nombre || ""));
      if (!afin) return;                                                                   // no habló de nada relacionado: es mensaje desperdiciado
      if (RE_NO_AFIN.test((f.nombre || "") + " " + (f.producto || "")) && !RE_INTERES.test(cli.map((m) => m.texto).join(" "))) return;   // rubro ajeno y nunca preguntó por ropa/calzado
      const puntos = (f.puntaje || 0) + (/calzad|zapat|zapas|sandal|ojota|suec|crocs/i.test(todo) ? 6 : 0) + (/^[AB]$/.test(f.perfil) ? 3 : 0) + Math.max(0, 4 - (ahora - f.ult_ts) / (10 * 864e5));
      const ultYo = [...ms].reverse().find((m) => m.yo);
      out.push({ ...f, puntos, charla: ms.slice(-8), cli_ultimo: !ult.yo, ult_cli_txt: !ult.yo ? String(ult.texto || "").replace(/\s+/g, " ").trim().slice(0, 200) : "", ult_yo_txt: String(ultYo?.texto || "").replace(/\s+/g, " ").trim().slice(0, 200) });
    });
  }
  return out.sort((a, b) => b.puntos - a.puntos);
}

// Escribe los mensajes con la IA (10 por llamada); si no hay IA, usa el de respaldo. Alterna variante A (con precios) y B (sin precios).
export async function escribirCampana(env, iaJSON, lista, c = CAMPANA) {
  lista.forEach((f, i) => { f.variante = f.variante || (i % 2 === 0 ? "A" : "B"); });
  for (let i = 0; i < lista.length; i += 10) {
    const tanda = lista.slice(i, i + 10);
    let r = null;
    if (iaJSON) r = await iaJSON(env, `Atendés el WhatsApp de "Te Importamos" (Rosario): importamos para revendedores y comercios con cupos grupales.
Hoy promocionamos por privado un CUPO DE ${c.producto.toUpperCase()}: ${c.descripcion}. Precios por par según cantidad (${c.limitado}): ${listaPrecios(c)}.
Contexto: nos estamos quedando SIN CUPOS, son los últimos lugares (urgencia real, sin exagerar).
Tono: casual, como un mensaje que le mandás a un conocido, corto, nada de vendedor ni de folleto. Ejemplos del estilo que queremos (NO los copies, adaptalos a cada charla):
- "hola como andas, te la tiro por si te sirve, traemos suecos por mayor y nos estamos quedando sin cupos, liquidamos los últimos. querés ver los precios? si te sirven, reservás"
- "buenas! paso a dejarte acceso a los cupos de suecos, estamos largando los últimos. te doy prioridad si querés reservar, avisame y te mando fotos o precios"
Escribí UN mensaje de WhatsApp para cada cliente, personalizado según lo que hablamos antes (nombrá lo que venía viendo o su negocio si sirve para conectar; si antes no avanzó por precio o cantidad, usalo a favor: arranca desde 20 unidades).
Variante A: incluí la lista de precios completa, corta. Variante B: NO pongas precios; contá que quedan los últimos cupos y ofrecé mandarle fotos o precios.
Reglas: rioplatense, voseo, minúsculas como chat, sin ¿ ni ¡, sin emojis, máximo 3 oraciones, una sola pregunta al final, no inventes datos ni plazos, no prometas descuentos extra, no digas que es un mensaje automático.
${tanda.map((f, k) => `CLIENTE ${k + 1} · variante ${f.variante} · nombre: ${f.nombre || "-"} · venía viendo: ${f.producto || "-"}\n${f.charla.map((m) => (m.yo ? "Nosotros: " : "Cliente: ") + String(m.texto || "").replace(/\s+/g, " ").slice(0, 220)).join("\n")}`).join("\n\n")}
Respondé SOLO JSON: {"mensajes":[{"n":1,"mensaje":"..."}]}`, { prioridad: true }).catch(() => null);
    tanda.forEach((f, k) => {
      const m = (r?.mensajes || []).find((x) => +x.n === k + 1)?.mensaje;
      const limpio = String(m || "").replace(/[¿¡]/g, "").replace(/\s+/g, " ").trim();
      const okA = f.variante !== "A" || /20/.test(limpio);
      f.mensaje = limpio.length > 30 && limpio.length < 600 && okA ? limpio : mensajeCampana(f, f.variante, c);
      f.ia = limpio.length > 30 && okA;
    });
  }
  return lista;
}

// Lista para la PC (misma forma que /seguimientos). Guarda la tanda del día en kv para no recalcular en cada pedido.
export async function listaCampana(env, iaJSON, { excluir = new Set(), lim = 20 } = {}) {
  const c = await campanaActiva(env); if (!c) return null;
  const hoy = diaAR(), clave = "camp_lista3:" + c.id;
  let est = null; try { est = JSON.parse((await kv(env, clave)) || "null"); } catch {}
  if (!est || est.dia !== hoy) {
    const cands = (await candidatosCampana(env, c)).slice(0, Math.round(c.meta * 1.6));
    est = { dia: hoy, items: cands.map(({ charla, ...f }) => ({ ...f, charla })), enviados: [] };
  }
  const faltan = est.items.filter((f) => !f.mensaje && !excluir.has(String(f.conv)) && !est.enviados.includes(String(f.conv))).slice(0, lim);
  if (faltan.length) await escribirCampana(env, iaJSON, faltan, c);
  await kv(env, clave, JSON.stringify(est));
  const enviadosHoy = est.enviados.length;
  const lista = est.items.filter((f) => f.mensaje && !excluir.has(String(f.conv)) && !est.enviados.includes(String(f.conv))).slice(0, lim)
    .map((f) => ({ conv: f.conv, nombre: f.nombre, producto: c.producto, toque: 1, situacion: "campana", revisado: true, dueno: false, borrador: f.mensaje, campana: c.id, variante: f.variante,
      cli_ultimo: !!f.cli_ultimo, ult_cli_txt: f.ult_cli_txt || "", ult_yo_txt: f.ult_yo_txt || "" }));
  return { lista, campana: c.id, meta: c.meta, enviados_hoy: enviadosHoy, restantes: Math.max(0, c.meta - enviadosHoy) };
}

// Al confirmarse un envío: queda registrado (para medir qué variante respondió más) y sale de la lista
export async function marcarCampana(env, conv) {
  const c = await campanaActiva(env); if (!c) return false;
  const clave = "camp_lista3:" + c.id;
  let est = null; try { est = JSON.parse((await kv(env, clave)) || "null"); } catch {}
  const it = est?.items?.find((f) => String(f.conv) === String(conv)); if (!it) return false;
  if (!est.enviados.includes(String(conv))) est.enviados.push(String(conv));
  await kv(env, clave, JSON.stringify(est));
  await env.DB.prepare("INSERT OR IGNORE INTO w_hito (id, conv, tipo, ts, dato) VALUES (?,?,'campana',?,?)").bind(`camp:${c.id}:${conv}`, String(conv), Date.now(), `${c.id}|${it.variante}|${it.ia ? "ia" : "respaldo"}`).run().catch(() => {});
  return true;
}

// Resultado: cuántos respondieron por variante (clientes que escribieron después del mensaje de campaña)
export async function resultadoCampana(env, c = CAMPANA) {
  const hs = (await env.DB.prepare("SELECT conv, ts, dato FROM w_hito WHERE tipo='campana' AND dato LIKE ?").bind(c.id + "%").all().catch(() => ({}))).results || [];
  const r = { A: { enviados: 0, respondieron: 0 }, B: { enviados: 0, respondieron: 0 } };
  for (const h of hs) {
    const v = String(h.dato).split("|")[1] === "A" ? "A" : "B"; r[v].enviados++;
    const resp = await env.DB.prepare("SELECT 1 AS x FROM w_msg WHERE conv=? AND yo=0 AND ts>? LIMIT 1").bind(h.conv, h.ts).first().catch(() => null);
    if (resp) r[v].respondieron++;
  }
  return r;
}
