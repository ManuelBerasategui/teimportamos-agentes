# Te Importamos · Agentes

| Carpeta | Worker de Cloudflare | Qué hace |
|---|---|---|
| `cotizador/` | `cotizador` | Agente de WhatsApp + panel web (`/panel`) |
| `instagram/` | `instagram` | Responde comentarios de Instagram |
| `buscador/` | `buscador` | Busca proveedores en 1688 y Alibaba (Apify) y los deja en el panel > Búsquedas |

- Cada cambio que se sube a `main` lo publica Cloudflare automáticamente (Workers Builds, una carpeta raíz por worker).
- Las claves y variables viven en Cloudflare (Settings > Variables). `keep_vars: true` hace que el deploy no las borre. **Nunca subir claves a este repo.**
- `tests/`: simulaciones en Node (D1 con `node:sqlite`, Meta y Gemini simulados). Correr desde `cotizador/`: `node ../tests/sim.mjs` (y sim3, sim11, sim13, sim14, sim-buscador).

_Deploy automático activo desde el 05/10/2026._
