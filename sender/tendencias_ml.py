"""
Lee las tendencias de Mercado Libre Argentina (público, sin cuenta) y las manda al panel para el agente de Productos.
Para cada búsqueda en tendencia abre el listado y anota cuántas publicaciones hay, el rango de precios y
las 5 primeras (título, precio, cuántas vendió). Con eso la mesa detecta productos que se venden mucho con
publicaciones flojas, y los cruza con lo que piden por WhatsApp.

Uso (desde la carpeta sender):
  python tendencias_ml.py              lee una vez y manda los datos
  python tendencias_ml.py --cada 1440  queda leyendo una vez por día (dejalo abierto)
  python tendencias_ml.py --ver        muestra la ventana (para revisar si algo falla)
  python tendencias_ml.py --max 40     cuántas tendencias mirar (por defecto 30)

No publica ni cambia nada: solo lee páginas públicas de Mercado Libre. Si Mercado Libre pide captcha, frena y avisa.
"""
import json, os, re, sys, time, urllib.request
from pathlib import Path

AQUI = Path(__file__).resolve().parent
PERFIL = AQUI / "perfil_ml"
DEBUG = AQUI / "ml_debug.json"
TENDENCIAS = "https://tendencias.mercadolibre.com.ar/"

def cargar_env():
    p = AQUI / ".env"
    if p.exists():
        for l in p.read_text(encoding="utf-8-sig").splitlines():
            if "=" in l and not l.strip().startswith("#"):
                k, v = l.split("=", 1); os.environ.setdefault(k.strip(), v.strip())
cargar_env()
URL = os.environ["PANEL_URL"].rstrip("/")
TOKEN = os.environ["LECTOR_TOKEN"]

def num(t):
    t = re.sub(r"[^\d]", "", str(t or ""))
    return int(t) if t else None

def mandar(items):
    datos = json.dumps({"items": items}).encode()
    req = urllib.request.Request(f"{URL}/lector/ml-tendencias", data=datos, method="POST",
        headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json", "User-Agent": "Mozilla/5.0 TeImportamos-ML"})
    with urllib.request.urlopen(req, timeout=60) as r: return json.load(r)

JS_TENDENCIAS = r"""
() => {
  // Las tendencias son los enlaces que terminan en #trend; el texto trae el puesto arriba ("3° MÁS POPULAR") y la búsqueda abajo
  const out = [], vistos = new Set();
  for (const a of document.querySelectorAll('a[href$="#trend"]')) {
    const lineas = (a.innerText || '').split('\n').map((x) => x.trim()).filter(Boolean);
    const palabra = lineas[lineas.length - 1] || '', tipo = lineas.length > 1 ? lineas[0].replace(/^\d+\S*\s*/, '').toLowerCase() : '';
    const k = palabra.toLowerCase(); if (!palabra || palabra.length > 60 || vistos.has(k)) continue; vistos.add(k);
    out.push({ palabra, tipo, link: a.href });
  }
  return out;
}
"""
JS_CATEGORIAS = r"""
() => [...document.querySelectorAll('a')].map((a) => ({ nombre: (a.innerText || '').trim(), link: a.href })).filter((x) => /tendencias\.mercadolibre\.com\.ar\/\d+-/.test(x.link) && x.nombre)
"""
# Categorías donde suele haber productos importables por un revendedor (se suman a las tendencias generales)
CATEGORIAS = re.compile(r"hogar|belleza|deportes|juegos y juguetes|mascotas|herramientas|beb[eé]s|accesorios para veh|celulares|electr[oó]nica", re.I)
JS_LISTADO = """
() => {
  const txt = document.body.innerText || '';
  const m = txt.match(/([\\d.]+)\\s+resultados/i);
  const items = [];
  for (const li of document.querySelectorAll('li.ui-search-layout__item, .ui-search-result, .poly-card')) {
    const titulo = (li.querySelector('.poly-component__title, .ui-search-item__title, h2, h3') || {}).innerText || '';
    const precio = (li.querySelector('.andes-money-amount__fraction') || {}).innerText || '';
    const vend = (li.innerText.match(/(\\+?[\\d.]+\\s*vendidos?)/i) || [])[1] || '';
    if (titulo) items.push({ titulo: titulo.trim(), precio: precio.replace(/\\./g, ''), vendidos: vend });
    if (items.length >= 8) break;
  }
  return { resultados: m ? m[1].replace(/\\./g, '') : null, items };
}
"""

def leer(ver=False, maximo=25):
    from playwright.sync_api import sync_playwright
    salida = []
    with sync_playwright() as p:
        # Mercado Libre bloquea el navegador oculto ("Hubo un error accediendo a esta página"): se abre una ventana real,
        # fuera de la pantalla para que no moleste (con --ver queda a la vista)
        ctx = p.chromium.launch_persistent_context(str(PERFIL), headless=False, viewport={"width": 1280, "height": 900}, locale="es-AR", args=[] if ver else ["--window-position=-2400,-2400"])
        pg = ctx.new_page()
        pg.goto(TENDENCIAS, wait_until="domcontentloaded", timeout=60000); time.sleep(3)
        if re.search(r"captcha|verific", pg.content(), re.I) and "tendencias" not in pg.url:
            print("Mercado Libre pide verificación: abrí con --ver y resolvela."); ctx.close(); return []
        tend = [dict(t, categoria="general") for t in pg.evaluate(JS_TENDENCIAS)[:max(8, maximo // 2)]]
        cats = [c for c in pg.evaluate(JS_CATEGORIAS) if CATEGORIAS.search(c["nombre"])]
        vistos = {t["palabra"].lower() for t in tend}
        for c in cats[:8]:
            if len(tend) >= maximo: break
            try:
                pg.goto(c["link"], wait_until="domcontentloaded", timeout=60000); time.sleep(2)
                for t in pg.evaluate(JS_TENDENCIAS)[:4]:
                    if t["palabra"].lower() not in vistos and len(tend) < maximo: vistos.add(t["palabra"].lower()); tend.append(dict(t, categoria=c["nombre"]))
            except Exception as e: print("  categoría", c["nombre"], "error:", str(e)[:60])
        print(f"{len(tend)} tendencias encontradas")
        bloqueado = False
        for i, t in enumerate(tend, 1):
            fila = {"palabra": t["palabra"], "puesto": i, "categoria": t.get("categoria", ""), "tipo": t.get("tipo", "")}
            if bloqueado: salida.append(fila); continue
            try:
                link = t["link"] if t["link"].startswith("http") else "https://listado.mercadolibre.com.ar/" + re.sub(r"\s+", "-", t["palabra"].strip().lower())
                pg.goto(link, wait_until="domcontentloaded", timeout=60000); time.sleep(2)
                if "captcha" in pg.url:
                    # No se esquiva: con --ver esperamos a que la persona complete el paso; sin --ver se mandan solo las tendencias
                    if ver:
                        print("  Mercado Libre pide una verificación: completala en la ventana (espero hasta 3 minutos)...")
                        for _ in range(90):
                            if "captcha" not in pg.url: break
                            time.sleep(2)
                    if "captcha" in pg.url:
                        bloqueado = True; salida.append(fila)
                        print("  Mercado Libre pide una verificación para ver los listados. Mando solo los nombres de las tendencias.")
                        print("  Para tener publicaciones, precios y ventas: abrí tendencias_ml_verificar.bat y completá el paso una vez.")
                        continue
                    time.sleep(2)
                d = pg.evaluate(JS_LISTADO)
                precios = [num(x["precio"]) for x in d["items"] if num(x["precio"])]
                fila.update({"resultados": num(d.get("resultados")), "precio_min": min(precios) if precios else None, "precio_max": max(precios) if precios else None,
                             "vendidos": (d["items"][0]["vendidos"] if d["items"] else ""), "top": [{"titulo": x["titulo"], "precio": num(x["precio"]), "vendidos": x["vendidos"]} for x in d["items"][:5]]})
            except Exception as e:
                fila["error"] = str(e)[:80]
            salida.append(fila); print(f"  {i}. {fila['palabra']} · {fila.get('resultados') or '?'} publicaciones · top vende {fila.get('vendidos') or '?'}")
        ctx.close()
    DEBUG.write_text(json.dumps(salida, ensure_ascii=False, indent=1), encoding="utf-8")
    return salida

def una_vez(ver=False, maximo=25):
    items = leer(ver, maximo)
    if not items: print("No leí nada (¿cambió la página?). Mirá ml_debug.json o corré con --ver."); return
    r = mandar(items); print("Mandado al panel:", r)

if __name__ == "__main__":
    a = sys.argv[1:]
    ver = "--ver" in a
    maximo = int(a[a.index("--max") + 1]) if "--max" in a else 30
    if "--cada" in a:
        cada = int(a[a.index("--cada") + 1])
        while True:
            try: una_vez(ver, maximo)
            except Exception as e: print("Error:", e)
            print(f"Vuelvo a leer en {cada} minutos (Ctrl+C para parar)"); time.sleep(cada * 60)
    else:
        una_vez(ver, maximo)
