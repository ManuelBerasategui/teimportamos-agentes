"""
Lee los links de Alibaba que mandan los clientes (o que se pegan en el panel, pestaña Cotizar) y le pasa al panel
el texto de cada página. Con eso el panel saca precio FOB por cantidad, peso y medidas, y calcula cuánto queda
puesto en Argentina con la misma cuenta de la calculadora de la web.

Por qué corre en la PC: Alibaba le pide el deslizador de verificación ("arrastrá para verificar") a cualquier
navegador nuevo. Eso NO se esquiva: la primera vez (y cada tanto) hay que pasarlo a mano en la ventana, y el
navegador recuerda la sesión en la carpeta perfil_alibaba.

Uso (desde la carpeta sender):
  python leer_alibaba.py              lee lo que haya en la cola una vez
  python leer_alibaba.py --cada 5     queda mirando la cola cada 5 minutos (dejalo abierto)
  python leer_alibaba.py --ver        muestra la ventana y espera a que pases la verificación si aparece
  python leer_alibaba.py --link URL   prueba un link suelto y muestra lo que lee (no lo manda)

No escribe ni compra nada en Alibaba: solo abre páginas públicas de productos.
"""
import json, os, re, sys, time, urllib.request
from pathlib import Path

AQUI = Path(__file__).resolve().parent
PERFIL = AQUI / "perfil_alibaba"

def cargar_env():
    p = AQUI / ".env"
    if p.exists():
        for l in p.read_text(encoding="utf-8-sig").splitlines():
            if "=" in l and not l.strip().startswith("#"):
                k, v = l.split("=", 1); os.environ.setdefault(k.strip(), v.strip())
cargar_env()
URL = os.environ.get("PANEL_URL", "").rstrip("/")
TOKEN = os.environ.get("LECTOR_TOKEN", "")
try: sys.stdout.reconfigure(encoding="utf-8")
except Exception: pass

def api(path, body=None):
    req = urllib.request.Request(f"{URL}/lector{path}", data=json.dumps(body).encode() if body is not None else None, method="POST" if body is not None else "GET",
        headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json", "User-Agent": "Mozilla/5.0 TeImportamos-Alibaba"})
    with urllib.request.urlopen(req, timeout=120) as r: return json.load(r)

RE_VERIF = re.compile(r"captcha|slide to verify|drag the slider|deslizador|desliz[aá] para verificar|unusual traffic|punish", re.I)

def verificacion(pg):
    try: return bool(RE_VERIF.search(pg.title() or "")) or "punish" in pg.url or bool(RE_VERIF.search((pg.evaluate("() => (document.body.innerText || '').slice(0, 600)") or "")))
    except Exception: return False

JS_TEXTO = r"""
() => {
  // Texto visible de la página, sin menús ni pie. Las tablas de precios y de empaque quedan en renglones.
  for (const s of document.querySelectorAll('script,style,noscript,header,footer,nav')) s.remove();
  return (document.body.innerText || '').replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n').trim();
}
"""

def leer_link(pg, link, ver):
    """Devuelve {titulo, texto} o {bloqueado: True}."""
    pg.goto(link, wait_until="domcontentloaded", timeout=60000); time.sleep(4)
    if verificacion(pg):
        if ver:
            print("  Alibaba pide la verificación: arrastrá el deslizador en la ventana (espero hasta 3 minutos)...")
            for _ in range(90):
                if not verificacion(pg): break
                time.sleep(2)
            time.sleep(3)
        if verificacion(pg): return {"bloqueado": True}
    # bajar para que carguen las secciones de empaque y entrega (peso y medidas)
    for _ in range(7):
        pg.mouse.wheel(0, 1600); time.sleep(0.8)
    pg.mouse.wheel(0, -20000); time.sleep(1)
    titulo = pg.title() or ""
    texto = pg.evaluate(JS_TEXTO) or ""
    if len(texto) < 400: return {"bloqueado": True, "error": "la página vino vacía"}
    # Lo útil está arriba (precios) y en "Empaque y entrega" / "Packaging and delivery": se manda el principio y esas zonas
    trozos = [texto[:9000]]
    for m in re.finditer(r"(empaque y entrega|packaging and delivery|embalaje y entrega|detalles de empaque|single package size|tamaño del paquete|peso bruto|gross weight)", texto, re.I):
        if m.start() > 9000: trozos.append(texto[max(0, m.start() - 300):m.start() + 1500])
        if len(trozos) >= 4: break
    return {"titulo": titulo[:200], "texto": "\n...\n".join(trozos)[:15000], "url": pg.url[:300]}

def abrir(p, ver):
    # Navegador real (no oculto) y en inglés/dólares para que los precios salgan en USD. Sin --ver queda fuera de la pantalla.
    return p.chromium.launch_persistent_context(str(PERFIL), headless=False, viewport={"width": 1366, "height": 900}, locale="en-US",
        args=[] if ver else ["--window-position=-2400,-2400"])

def una_vez(ver=False):
    from playwright.sync_api import sync_playwright
    try: links = api("/ali-pendientes?limite=8").get("links", [])
    except Exception as e: print("No pude pedir la cola:", e); return None
    if not links: print(time.strftime("%H:%M"), "· no hay links para leer."); api("/ali-latido", {"estado": "leyendo", "detalle": "cola vacía"}); return 0
    hechos = 0
    with sync_playwright() as p:
        ctx = abrir(p, ver); pg = ctx.new_page()
        for l in links:
            print(time.strftime("%H:%M"), "· leyendo", l["link"][:90])
            try: r = leer_link(pg, l["link"], ver)
            except Exception as e: r = {"bloqueado": True, "error": str(e)[:100]}
            if r.get("bloqueado") and not r.get("error"):
                print("  Alibaba pide la verificación. Abrí cotizar_links_verificar.bat y arrastrá el deslizador una vez; después esto sigue solo.")
                try: api("/ali-leido", {"link": l["link"], "bloqueado": True}); api("/ali-latido", {"estado": "trabado", "detalle": "Alibaba pide la verificación: abrí cotizar_links_verificar.bat"})
                except Exception: pass
                ctx.close(); return hechos
            try:
                res = api("/ali-leido", {"link": l["link"], **r})
                d = res.get("datos") or {}; c = res.get("cotizacion") or {}
                if res.get("estado") == "leido":
                    hechos += 1
                    print(f"  {d.get('nombre') or '?'} · precios {d.get('tramos') or d.get('rango') or '?'} · peso {d.get('peso') or '?'} kg · " + (f"TOTAL puesto USD {c.get('total')}" if c.get("total") else "falta: " + "; ".join(c.get("falta") or ["?"])))
                else: print("  no se pudo:", res.get("estado") or res.get("error"))
            except Exception as e: print("  no pude mandarlo al panel:", e)
            time.sleep(3)
        ctx.close()
    try: api("/ali-latido", {"estado": "leyendo", "detalle": f"{hechos} link(s) leídos en la última vuelta"})
    except Exception: pass
    return hechos

if __name__ == "__main__":
    a = sys.argv[1:]; ver = "--ver" in a
    if "--link" in a:
        from playwright.sync_api import sync_playwright
        with sync_playwright() as p:
            ctx = abrir(p, True); r = leer_link(ctx.new_page(), a[a.index("--link") + 1], True); ctx.close()
        print(json.dumps(r, ensure_ascii=False, indent=1)[:6000]); sys.exit(0)
    if not URL or not TOKEN: sys.exit("Falta el archivo .env con PANEL_URL y LECTOR_TOKEN en esta carpeta.")
    if "--cada" in a:
        cada = int(a[a.index("--cada") + 1])
        while True:
            try: una_vez(ver)
            except Exception as e: print("Error:", e)
            time.sleep(cada * 60)
    else:
        una_vez(ver)
