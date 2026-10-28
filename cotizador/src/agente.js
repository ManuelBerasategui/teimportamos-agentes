// El agente único de Te Importamos: jefe de ventas + estratega de contenido.
// Es el mismo desde el panel (pestaña Agente, el asistente del 805, Redes) y desde Telegram, con la misma memoria
// (ag_chat y ag_mem). Todos los números los calcula el código; la IA solo los interpreta con los manuales.
import { preguntarVendedor } from "./lector.js";
import { contextoRedesAgente, MANUAL_REDES } from "./redes.js";

export async function preguntarAgente(env, iaJSON, pregunta) {
  const redes = await contextoRedesAgente(env).catch((e) => `REDES: no pude leer los datos (${String(e?.message || e).slice(0, 120)}).`);
  return preguntarVendedor(env, iaJSON, pregunta, { redes, manualRedes: MANUAL_REDES });
}

// Últimos mensajes de la charla con el agente (para el panel)
export async function charlaAgente(env, n = 30) {
  try { return ((await env.DB.prepare("SELECT ts, rol, texto FROM ag_chat ORDER BY id DESC LIMIT ?").bind(n).all()).results || []).reverse(); } catch { return []; }
}
