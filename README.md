# Te Importamos · Agentes

| Carpeta | Worker de Cloudflare | Qué hace |
|---|---|---|
| `cotizador/` | `cotizador` | Agente de WhatsApp + panel web (`/panel`) |
| `instagram/` | `instagram` | Responde comentarios de Instagram |

- Cada cambio que se sube a `main` lo publica Cloudflare automáticamente (Workers Builds, una carpeta raíz por worker).
- Las claves y variables viven en Cloudflare (Settings > Variables). `keep_vars: true` hace que el deploy no las borre. **Nunca subir claves a este repo.**
- `tests/`: simulaciones en Node (D1 con `node:sqlite`, Meta y Gemini simulados). Correr con `node tests/sim.mjs` desde `cotizador/`.
