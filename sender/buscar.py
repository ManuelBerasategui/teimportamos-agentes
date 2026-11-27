"""Busca una palabra en todos los chats privados que leyó el 805 (ej.: led). Uso: python buscar.py led"""
import ssl_fix  # noqa: F401
import json, os, sys, urllib.parse, urllib.request
from pathlib import Path
AQUI = Path(__file__).parent
for l in (AQUI / ".env").read_text(encoding="utf-8").splitlines():
    if "=" in l and not l.strip().startswith("#"): k, v = l.split("=", 1); os.environ.setdefault(k.strip(), v.strip())
q = " ".join(sys.argv[1:]) or input("Qué palabra busco? ").strip()
dias = os.environ.get("BUSCAR_DIAS", "120")
req = urllib.request.Request(f"{os.environ['PANEL_URL'].rstrip('/')}/lector/enviar/buscar?q={urllib.parse.quote(q)}&dias={dias}",
                             headers={"Authorization": f"Bearer {os.environ['LECTOR_TOKEN']}", "User-Agent": "Mozilla/5.0 TeImportamos-Sender/1.0"})
d = json.loads(urllib.request.urlopen(req, timeout=60).read().decode("utf-8"))
if not d.get("ok"): sys.exit(f"Error: {d.get('error')}")
r = d.get("resultados", [])
print(f"\n{len(r)} mensajes con '{q}' (últimos {dias} días):\n")
for x in r:
    print(f"+{x['conv']}  {x['nombre'] or '(sin nombre)'}  · {x['fecha']} · {x['quien']}:\n   {x['texto']}\n")
