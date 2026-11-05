// IA alternativa cuando Gemini no responde (sin cupo, caído o con la clave gastada). Se activa sola con tres variables de Cloudflare (todas secretas):
//   ALT_API_KEY  la clave del proveedor
//   ALT_API_URL  (opcional) la dirección: por defecto Groq (https://api.groq.com/openai/v1/chat/completions). Sirve cualquiera compatible con OpenAI
//                (OpenRouter, OpenAI, Mistral, Together…) y también la API de Anthropic (https://api.anthropic.com/v1/messages).
//   ALT_MODEL    (opcional) el modelo: por defecto llama-3.3-70b-versatile (Groq) o claude-haiku-4-5 (Anthropic)
// Si ALT_API_KEY no está, no hace nada y todo sigue como antes.
const parsear = (t) => { const m = String(t || "").match(/\{[\s\S]*\}/); try { return m ? JSON.parse(m[0]) : null; } catch { return null; } };
export async function altIA(env, prompt, opts = {}) {
  if (!env?.ALT_API_KEY) return null;
  const url = env.ALT_API_URL || "https://api.groq.com/openai/v1/chat/completions", anthropic = /anthropic\.com/.test(url);
  const modelo = env.ALT_MODEL || (anthropic ? "claude-haiku-4-5" : "llama-3.3-70b-versatile");
  const texto = String(prompt).length > 60000 ? String(prompt).slice(0, 30000) + " [...recortado...] " + String(prompt).slice(-28000) : String(prompt);
  try {
    const r = await fetch(url, { method: "POST", signal: AbortSignal.timeout(opts.prioridad ? 30000 : 60000),
      headers: anthropic ? { "Content-Type": "application/json", "x-api-key": env.ALT_API_KEY, "anthropic-version": "2023-06-01" } : { "Content-Type": "application/json", Authorization: "Bearer " + env.ALT_API_KEY },
      body: JSON.stringify(anthropic
        ? { model: modelo, max_tokens: 2000, temperature: 0.3, messages: [{ role: "user", content: texto + "\n\nRespondé SOLO con el JSON, sin texto antes ni después." }] }
        : { model: modelo, temperature: 0.3, response_format: { type: "json_object" }, messages: [{ role: "user", content: texto + (/json/i.test(texto) ? "" : "\n\nRespondé en JSON.") }] }) });
    if (!r.ok) return null;
    const j = await r.json().catch(() => ({}));
    return parsear(anthropic ? (j.content || []).map((c) => c.text || "").join("") : j.choices?.[0]?.message?.content);
  } catch { return null; }
}
