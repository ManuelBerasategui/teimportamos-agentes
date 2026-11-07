// IA alternativa cuando Gemini no responde (sin cupo, caído o con la clave gastada). Todo gratis: se prueban en orden
// los proveedores que tengan clave cargada en Cloudflare (Settings > Variables, tipo Secret). El que se queda sin cupo
// descansa una hora y se pasa al siguiente. Si ninguno tiene clave, no hace nada y sigue como antes (Gemini → Cloudflare AI).
//   GROQ_API_KEY        gratis en console.groq.com          (modelo: GROQ_MODEL, por defecto llama-3.3-70b-versatile)
//   OPENROUTER_API_KEY  gratis en openrouter.ai             (modelo: OPENROUTER_MODEL, por defecto un modelo ":free")
//   CEREBRAS_API_KEY    gratis en cloud.cerebras.ai         (modelo: CEREBRAS_MODEL)
//   ALT_API_KEY / ALT_API_URL / ALT_MODEL: cualquier otro compatible con OpenAI o la API de Anthropic (se mantiene por compatibilidad)
// Las tareas de fondo (entrenamiento, ideas) tienen un tope diario por proveedor (ALT_MAX_FONDO, 300 por defecto) para que
// el cupo quede para contestar clientes.
const parsear = (t) => { const m = String(t || "").match(/\{[\s\S]*\}/); try { return m ? JSON.parse(m[0]) : null; } catch { return null; } };
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

export function proveedores(env) {
  const altUrl = env?.ALT_API_URL || GROQ_URL, anthropic = /anthropic\.com/.test(altUrl);
  return [
    env?.GROQ_API_KEY && { id: "groq", url: GROQ_URL, key: env.GROQ_API_KEY, modelo: env.GROQ_MODEL || "llama-3.3-70b-versatile" },
    env?.CEREBRAS_API_KEY && { id: "cerebras", url: "https://api.cerebras.ai/v1/chat/completions", key: env.CEREBRAS_API_KEY, modelo: env.CEREBRAS_MODEL || "llama-3.3-70b" },
    env?.OPENROUTER_API_KEY && { id: "openrouter", url: "https://openrouter.ai/api/v1/chat/completions", key: env.OPENROUTER_API_KEY, modelo: env.OPENROUTER_MODEL || "meta-llama/llama-3.3-70b-instruct:free" },
    env?.ALT_API_KEY && { id: "alt", url: altUrl, key: env.ALT_API_KEY, anthropic, modelo: env.ALT_MODEL || (anthropic ? "claude-haiku-4-5" : "llama-3.3-70b-versatile") },
  ].filter(Boolean);
}
const diaAR = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);

async function llamar(p, texto, opts, conFormato = true) {
  const r = await fetch(p.url, { method: "POST", signal: AbortSignal.timeout(opts.prioridad ? 30000 : 60000),
    headers: p.anthropic ? { "Content-Type": "application/json", "x-api-key": p.key, "anthropic-version": "2023-06-01" } : { "Content-Type": "application/json", Authorization: "Bearer " + p.key },
    body: JSON.stringify(p.anthropic
      ? { model: p.modelo, max_tokens: 2000, temperature: 0.3, messages: [{ role: "user", content: texto + "\n\nRespondé SOLO con el JSON, sin texto antes ni después." }] }
      : { model: p.modelo, temperature: 0.3, ...(conFormato ? { response_format: { type: "json_object" } } : {}), messages: [{ role: "user", content: texto + (/json/i.test(texto) ? "" : "\n\nRespondé en JSON.") }] }) });
  return r;
}

export async function altIA(env, prompt, opts = {}) {
  const lista = proveedores(env);
  if (!lista.length) return null;
  const texto = String(prompt).length > 60000 ? String(prompt).slice(0, 30000) + " [...recortado...] " + String(prompt).slice(-28000) : String(prompt);
  const E = env.ESTADO, tope = +(env.ALT_MAX_FONDO || 300);
  for (const p of lista) {
    try {
      if (E && (await E.get("altago:" + p.id))) continue;                       // sin cupo hace poco: descansa
      const kDia = `altdia:${p.id}:${diaAR()}`;
      if (E && !opts.prioridad && +((await E.get(kDia)) || 0) >= tope) continue;  // fondo: dejar cupo para clientes
      let r = await llamar(p, texto, opts);
      if (r.status === 400 && !p.anthropic) r = await llamar(p, texto, opts, false);   // algunos modelos gratis no aceptan response_format
      if (r.status === 429) { if (E) await E.put("altago:" + p.id, "1", { expirationTtl: Math.max(60, Math.min(3600, +(r.headers.get("retry-after") || 3600))) }); continue; }
      if (r.status === 404 || r.status === 401) { if (E) await E.put("altago:" + p.id, String(r.status), { expirationTtl: 6 * 3600 }); continue; }
      if (!r.ok) continue;
      const j = await r.json().catch(() => ({}));
      const res = parsear(p.anthropic ? (j.content || []).map((c) => c.text || "").join("") : j.choices?.[0]?.message?.content);
      if (E) { await E.put(kDia, String(+((await E.get(kDia)) || 0) + 1), { expirationTtl: 2 * 86400 }); await E.put("ia_ultimo", JSON.stringify({ id: p.id, ts: Date.now() }), { expirationTtl: 7 * 86400 }); }
      if (res) return res;
    } catch { /* probamos el siguiente */ }
  }
  return null;
}

// Para el panel: qué IA hay disponible ahora
export async function estadoIA(env) {
  const E = env.ESTADO, dia = diaAR();
  const gem = E ? (await E.list({ prefix: "agotado:" })).keys.length : 0;
  const alt = [];
  for (const p of proveedores(env)) alt.push({ id: p.id, descansando: E ? !!(await E.get("altago:" + p.id)) : false, usosHoy: E ? +((await E.get(`altdia:${p.id}:${dia}`)) || 0) : 0 });
  let ultimo = null; try { ultimo = JSON.parse((E && (await E.get("ia_ultimo"))) || "null"); } catch {}
  return { gemini: !!env.GEMINI_KEY, geminiModelosSinCupo: gem, alternativas: alt, cloudflare: !!env.AI, ultimoAlternativo: ultimo };
}
