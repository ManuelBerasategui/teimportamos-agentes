// Simulación: IA alternativa cuando Gemini no responde
import { altIA } from "../cotizador/src/ia-alterna.js";
let ok = 0, mal = 0; const chk = (n, c) => { if (c) { ok++; console.log("✓ " + n); } else { mal++; console.log("FALLA: " + n); } };
const real = globalThis.fetch; let ult = null;
globalThis.fetch = async (url, o) => { ult = { url: String(url), o, b: JSON.parse(o.body) };
  if (/anthropic/.test(String(url))) return new Response(JSON.stringify({ content: [{ type: "text", text: 'Acá va: {"accion":"responder","mensaje":"hola"}' }] }), { status: 200 });
  if (/mal\.test/.test(String(url))) return new Response("{}", { status: 500 });
  return new Response(JSON.stringify({ choices: [{ message: { content: '{"accion":"nada"}' } }] }), { status: 200 }); };
chk("sin ALT_API_KEY no hace nada", (await altIA({}, "hola")) === null && ult === null);
let r = await altIA({ ALT_API_KEY: "k" }, "Devolvé JSON {a:1}");
chk("por defecto usa Groq con formato OpenAI y devuelve el JSON", r?.accion === "nada" && /groq\.com/.test(ult.url) && ult.o.headers.Authorization === "Bearer k" && ult.b.model === "llama-3.3-70b-versatile" && ult.b.response_format.type === "json_object");
r = await altIA({ ALT_API_KEY: "k", ALT_API_URL: "https://openrouter.ai/api/v1/chat/completions", ALT_MODEL: "x/y" }, "dale");
chk("sirve cualquier proveedor compatible con OpenAI y el modelo configurado", /openrouter/.test(ult.url) && ult.b.model === "x/y" && /JSON/.test(ult.b.messages[0].content));
r = await altIA({ ALT_API_KEY: "k", ALT_API_URL: "https://api.anthropic.com/v1/messages" }, "dale");
chk("también la API de Anthropic, y rescata el JSON entre texto", r?.accion === "responder" && ult.o.headers["x-api-key"] === "k" && ult.b.model.startsWith("claude-") && ult.b.max_tokens > 0);
chk("si el proveedor falla devuelve null sin romper", (await altIA({ ALT_API_KEY: "k", ALT_API_URL: "https://mal.test/v1" }, "x")) === null);
globalThis.fetch = real;
console.log(`\nsim-ia-alterna: ${ok} ok, ${mal} fallas`); process.exit(mal ? 1 : 0);
