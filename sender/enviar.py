"""Configuración y helpers compartidos por el agente único de WhatsApp.
Los seguimientos se previsualizan y envían desde responder.py; este archivo no tiene un enviador aparte.
"""
import json, os, random, re, sys, time, urllib.error, urllib.request
from datetime import datetime
from pathlib import Path

AQUI = Path(__file__).parent

def cargar_env():
    p = AQUI / ".env"
    if not p.exists(): p = AQUI / "config.txt"
    if not p.exists():
        sys.exit("Falta la configuración: copiá .env.example como .env (o como config.txt) y completalo.")
    for l in p.read_text(encoding="utf-8-sig").splitlines():
        if "=" in l and not l.strip().startswith("#"):
            k, v = l.split("=", 1); os.environ.setdefault(k.strip(), v.strip())

cargar_env()
URL = os.environ["PANEL_URL"].rstrip("/")
TOKEN = os.environ["LECTOR_TOKEN"]
H_DESDE = int(os.environ.get("HORA_DESDE", "9"))
H_HASTA = int(os.environ.get("HORA_HASTA", "20"))

def api(path, body=None):
    req = urllib.request.Request(f"{URL}/lector{path}", headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json", "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) TeImportamos-Sender/1.0"},
                                 data=json.dumps(body).encode() if body is not None else None, method="POST" if body is not None else "GET")
    for intento in (1, 2, 3):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.load(r)
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
    """Pequeña variación para textos de cotización; los seguimientos conservan el borrador exacto de la IA."""
    t = s["borrador"].strip()
    if not t.lower().startswith(EMPIEZA_SALUDO) and random.random() < 0.8:
        g = random.choice(SALUDOS)
        n = _nombre(s)
        if n and n.lower() not in t.lower() and not g.endswith("?") and random.random() < 0.5:
            g = g[:-1] + f" {n}" + g[-1]
        t = f"{g} {t}"
    if t.endswith(".") and random.random() < 0.3:
        t = t[:-1]
    if (not t.endswith("?") or random.random() < 0.3) and not t.endswith(("avisame.", "atento.", "leo.", "🙂")):
        t += random.choice(CIERRES)
    return t.replace("¿", "").replace("¡", "").strip()

def parar():
    return (AQUI / "STOP").exists()

def main():
    """Comando antiguo: solo deriva al flujo unificado, con vista previa segura por defecto."""
    if "--escritorio" in sys.argv:
        sys.exit("Los seguimientos se escriben letra por letra desde responder.py, no con --escritorio.")
    vista = any(x in sys.argv for x in ("--seco", "--prueba")) or not any(x in sys.argv for x in ("--auto", "--seguir"))
    args = ["--prueba", "--solo-seguimientos"] if vista else ["--seguir", "--solo-seguimientos"]
    import subprocess
    subprocess.run([sys.executable, str(AQUI / "responder.py"), *args], check=False)

if __name__ == "__main__":
    main()
