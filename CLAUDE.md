# Instrucciones para Claude

- Antes de empezar a trabajar: `git pull origin main`.
- Por defecto, trabajar en `main` y subir (commit + push) directo a `main`.
- Todo lo que llega a `main` se publica en producción automáticamente (Cloudflare Workers Builds). Antes de cada push, correr las simulaciones de `tests/` desde `cotizador/` (ver `README.md`). Si alguna falla, no subir y avisar.
- Nunca subir claves al repo: viven en Cloudflare (Settings > Variables) y en los secrets de GitHub.
- Responder en español.
