# Te Importamos · Agentes

| Carpeta | Worker de Cloudflare | Qué hace |
|---|---|---|
| `cotizador/` | `cotizador` | Agente de WhatsApp + panel web (`/panel`) |
| `instagram/` | `instagram` | Responde comentarios de Instagram; cada 2 h guarda métricas, cuenta y DMs en D1 para la pestaña Redes (solo lectura); `/metricas` para diagnóstico |
| `buscador/` | `buscador` | Busca proveedores en 1688 y Alibaba (Apify) y los deja en el panel > Búsquedas |

- Panel `/panel/redes`: resumen de Instagram, ideas para grabar (lunes 9 h, con reporte por Telegram), DMs sin responder, reels con su formato y chat con el agente. El panel llama al worker `instagram` por el binding `IG`.
- Videos (`/panel/redes#videos`): subís clips → se guardan en R2 (`teimportamos-videos`, privado, tope 8 GB) → GitHub Actions (`.github/workflows/videos.yml` + `tools/editor/editar.py`) los edita cada 10 min → los aprobás → el worker `instagram` los publica como reel de prueba a las 19 h. Necesita el secret `TI_CLAVE` en GitHub.
- Cada cambio que se sube a `main` lo publica Cloudflare automáticamente (Workers Builds, una carpeta raíz por worker).
- Las claves y variables viven en Cloudflare (Settings > Variables). `keep_vars: true` hace que el deploy no las borre. **Nunca subir claves a este repo.**
- `tests/`: simulaciones en Node (D1 con `node:sqlite`, Meta y Gemini simulados). Correr desde `cotizador/`: `node ../tests/sim.mjs` (y sim3, sim11, sim13, sim14, sim15, sim-buscador, sim-ig-metricas, sim-ig-redes, sim-videos).

_Deploy automático activo desde el 05/10/2026._
