"""Compatibilidad: delega todo en responder.py; por defecto solo muestra una vista previa."""
import json, os, random, re, sys, time, urllib.error, urllib.request
from pathlib import Path

AQUI = Path(__file__).parent

def cargar_env():
    p = AQUI / ".env"
    if not p.exists(): p = AQUI / "config.txt"
    if not p.exists(): sys.exit("Falta la configuración: copiá .env.example como .env y completá LECTOR_TOKEN.")
    for linea in p.read_text(encoding="utf-8-sig").splitlines():
        if "=" in linea and not linea.strip().startswith("#"):
            k, v = linea.split("=", 1); os.environ.setdefault(k.strip(), v.strip())

cargar_env()
URL = os.environ["PANEL_URL"].rstrip("/")
TOKEN = os.environ["LECTOR_TOKEN"]
MAX = int(os.environ.get("MAX_POR_CORRIDA", "50"))
PAUSA_MIN = int(os.environ.get("PAUSA_MIN_SEG", "45"))
PAUSA_MAX = int(os.environ.get("PAUSA_MAX_SEG", "130"))
H_DESDE = int(os.environ.get("HORA_DESDE", "9"))
H_HASTA = int(os.environ.get("HORA_HASTA", "20"))

def api(path, body=None):
    req = urllib.request.Request(f"{URL}/lector{path}", headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json", "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) TeImportamos-Sender/1.0"}, data=json.dumps(body).encode() if body is not None else None, method="POST" if body is not None else "GET")
    for intento in (1, 2, 3):
        try:
            with urllib.request.urlopen(req, timeout=60) as r: return json.load(r)
        except (TimeoutError, ConnectionError, urllib.error.URLError) as e:
            if isinstance(e, urllib.error.HTTPError) or intento == 3: raise
            time.sleep(3 * intento)

SALUDOS = ["Hola!", "Hola,", "Buenas!", "Buenas,", "Buen día!", "Qué tal,", "Hola, ¿todo bien?", "Hola, ¿cómo andás?"]
CIERRES = ["", "", "", " 🙂", " Cualquier cosa avisame.", " Quedo atento.", " Te leo."]
EMPIEZA_SALUDO = ("hola", "buen", "qué tal", "que tal")

def _nombre(s):
    n = re.sub(r"[^\w ]|[\d_]", "", str(s.get("nombre") or "")).strip().split(" ")[0]
    return n.capitalize() if len(n) >= 3 and n.lower() != "none" else ""

def variar(s):
    t = str(s.get("borrador") or "").strip()
    if not t.lower().startswith(EMPIEZA_SALUDO) and random.random() < 0.8:
        g = random.choice(SALUDOS); n = _nombre(s)
        if n and n.lower() not in t.lower() and not g.endswith("?") and random.random() < 0.5: g = g[:-1] + f" {n}" + g[-1]
        t = f"{g} {t}"
    if t.endswith(".") and random.random() < 0.3: t = t[:-1]
    if (not t.endswith("?") or random.random() < 0.3) and not t.endswith(("avisame.", "atento.", "leo.", "🙂")): t += random.choice(CIERRES)
    return t.replace("¿", "").replace("¡", "").strip()

def parar():
    return (AQUI / "STOP").exists()

if __name__ == "__main__":
    if not any(arg in sys.argv for arg in ("--prueba", "--seguir")): sys.argv.append("--prueba")
    import responder
    responder.main()
