"""Envía los seguimientos del panel por WhatsApp Web, uno por uno, con pausas largas.
Uso:  python enviar.py            -> pide confirmación en cada mensaje (recomendado al empezar)
      python enviar.py --auto     -> envía solo, con límites y pausas
      python enviar.py --escritorio -> usa la app de WhatsApp de Windows ya abierta (sin Chrome)
      python enviar.py --seco     -> no envía nada, solo muestra qué haría
Ctrl+C o crear un archivo llamado STOP en esta carpeta corta todo."""
import json, os, random, sys, time, urllib.parse, urllib.request
from datetime import datetime
from pathlib import Path
from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout

AQUI = Path(__file__).parent

def cargar_env():
    p = AQUI / ".env"
    if not p.exists():
        sys.exit("Falta el archivo .env (copiá .env.example como .env y completalo).")
    for l in p.read_text(encoding="utf-8").splitlines():
        if "=" in l and not l.strip().startswith("#"):
            k, v = l.split("=", 1); os.environ.setdefault(k.strip(), v.strip())

cargar_env()
URL = os.environ["PANEL_URL"].rstrip("/")          # ej: https://tu-worker.workers.dev
TOKEN = os.environ["LECTOR_TOKEN"]
MAX = int(os.environ.get("MAX_POR_CORRIDA", "50"))
PAUSA_MIN = int(os.environ.get("PAUSA_MIN_SEG", "45"))
PAUSA_MAX = int(os.environ.get("PAUSA_MAX_SEG", "130"))
H_DESDE = int(os.environ.get("HORA_DESDE", "9"))
H_HASTA = int(os.environ.get("HORA_HASTA", "20"))

def api(path, body=None):
    req = urllib.request.Request(f"{URL}/lector{path}", headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"},
                                 data=json.dumps(body).encode() if body is not None else None, method="POST" if body is not None else "GET")
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)

SALUDOS = ["Hola", "Hola!", "Buenas", "Buenas!", "Hola, ¿cómo andás?", "Hola, ¿todo bien?", "Qué tal", "Buen día"]
CIERRES = ["", "", " 🙂", " Cualquier cosa avisame.", " Quedo atento.", " Te leo."]
EMPIEZA_SALUDO = ("hola", "buen", "qué tal", "que tal")

def variar(s):
    """Cambia un poco cada mensaje (saludo/cierre/puntuación) sin tocar el contenido, para que no salgan todos idénticos."""
    t = s["borrador"].strip()
    nombre = (s.get("nombre") or "").split(" ")[0] if s.get("nombre") and not s["nombre"].lstrip("+").replace(" ", "").isdigit() else ""
    if not t.lower().startswith(EMPIEZA_SALUDO) and random.random() < 0.85:
        g = random.choice(SALUDOS)
        g = g + (f" {nombre}" if nombre and random.random() < 0.5 and not g.endswith("?") else "")
        t = f"{g.rstrip('!?,')}{'!' if g.endswith('!') else ','} {t[0].lower() + t[1:] if t[:2].isalpha() and not t[1].isupper() else t}"
    if t[-1] in ".?!" and random.random() < 0.3 and not t.endswith("?"):
        t = t[:-1]
    if not t.endswith("?") or random.random() < 0.3:
        t += random.choice(CIERRES)
    return t.strip()

def parar():
    return (AQUI / "STOP").exists()

def main_escritorio(lista, auto):
    """Usa la app de WhatsApp de Windows que ya tenés abierta y con sesión: abre el chat con el texto puesto y aprieta Enter."""
    import pyautogui, pygetwindow as gw
    enviados = 0
    for i, s in enumerate(lista, 1):
        if parar(): print("STOP detectado."); break
        texto = variar(s)
        print(f"\n[{i}/{len(lista)}] {s['nombre']} ({s['conv']})\n  {texto}")
        if not auto:
            r = input("  Enter = enviar | n = marcar 'no seguir' | s = saltar | q = salir: ").strip().lower()
            if r == "q": break
            if r == "s": continue
            if r == "n": api("/enviar/no", {"conv": s["conv"]}); continue
        os.startfile(f"whatsapp://send?phone={s['conv']}&text={urllib.parse.quote(texto)}")
        time.sleep(5)
        ventanas = [w for w in gw.getWindowsWithTitle("WhatsApp") if w.title.strip() == "WhatsApp"]
        if not ventanas: print("  No encuentro la ventana de WhatsApp. Frenando para no apretar Enter en otra cosa."); break
        try: ventanas[0].activate()
        except Exception: pass
        time.sleep(1.5)
        if gw.getActiveWindow() is None or gw.getActiveWindow().title.strip() != "WhatsApp":
            print("  WhatsApp no quedó al frente. Frenando."); break
        pyautogui.press("enter"); time.sleep(2)
        api("/enviar/hecho", {"conv": s["conv"]}); enviados += 1; print("  Enviado ✅")
        if i < len(lista):
            t = random.randint(PAUSA_MIN, PAUSA_MAX); print(f"  Pausa {t}s... (no toques el teclado cuando termine)"); time.sleep(t)
    print(f"\nListo. Enviados: {enviados}")

def main():
    seco, auto = "--seco" in sys.argv, "--auto" in sys.argv
    if not seco and not (H_DESDE <= datetime.now().hour < H_HASTA):
        sys.exit(f"Fuera de horario ({H_DESDE}:00 a {H_HASTA}:00). Cambialo en .env si querés.")
    lista = api(f"/enviar/lista?limite={MAX}")["lista"]
    print(f"{len(lista)} seguimientos para hoy.")
    if not lista: return
    if seco:
        for s in lista: print(f"- {s['nombre']} ({s['conv']}): {variar(s)}")
        return
    if "--escritorio" in sys.argv: return main_escritorio(lista, auto)
    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(str(AQUI / "perfil"), headless=False, viewport={"width": 1200, "height": 800})
        pg = ctx.pages[0] if ctx.pages else ctx.new_page()
        pg.goto("https://web.whatsapp.com")
        print("Si pide QR, escanealo con el celular (solo la primera vez). Esperando WhatsApp Web...")
        pg.wait_for_selector('#pane-side', timeout=180000)
        enviados = 0
        for i, s in enumerate(lista, 1):
            if parar(): print("STOP detectado."); break
            texto = variar(s)
            print(f"\n[{i}/{len(lista)}] {s['nombre']} ({s['conv']})\n  {texto}")
            if not auto:
                r = input("  Enter = enviar | n = marcar 'no seguir' | s = saltar | q = salir: ").strip().lower()
                if r == "q": break
                if r == "s": continue
                if r == "n": api("/enviar/no", {"conv": s["conv"]}); continue
            pg.goto(f"https://web.whatsapp.com/send?phone={s['conv']}&text={urllib.parse.quote(texto)}")
            try:
                caja = pg.wait_for_selector('footer div[contenteditable="true"]', timeout=45000)
                pg.wait_for_timeout(2500)
                if not caja.inner_text().strip():
                    print("  No cargó el texto, salto este."); continue
                caja.press("Enter")
                pg.wait_for_timeout(3000)
            except PWTimeout:
                print("  El número no está en WhatsApp o no cargó. Salto."); continue
            api("/enviar/hecho", {"conv": s["conv"]}); enviados += 1; print("  Enviado ✅")
            if i < len(lista):
                t = random.randint(PAUSA_MIN, PAUSA_MAX); print(f"  Pausa {t}s..."); time.sleep(t)
        print(f"\nListo. Enviados: {enviados}")
        ctx.close()

if __name__ == "__main__":
    main()
