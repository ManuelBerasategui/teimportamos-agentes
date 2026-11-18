"""
Lee Mercado Libre Argentina y lo manda al panel (pestaña Mercado Libre > Candidatos para importar):
  1. Las 50 tendencias de búsqueda de la semana (tendencias.mercadolibre.com.ar).
  2. Los "Más vendidos" de 4 categorías por día (rotan) y una subcategoría de cada una.
  3. El listado de cada búsqueda: publicaciones, precio actual, vendidos, calificación, Full, tiendas oficiales y avisos.
Con eso el worker filtra con criterios objetivos, busca en 1688 y calcula el margen.

Mercado Libre ahora pide iniciar sesión para ver los listados. La primera vez abrí tendencias_ml_verificar.bat e
ingresá con tu cuenta en la ventana: la sesión queda guardada en perfil_ml y las próximas vueltas corren solas.
Si pide verificación (captcha) no se esquiva: se avisa y se hace a mano con el mismo .bat.

Uso (desde la carpeta sender):
  python tendencias_ml.py                 lee una vez y manda los datos
  python tendencias_ml.py --cada 1440     queda leyendo una vez por día (dejalo abierto)
  python tendencias_ml.py --ver           muestra la ventana y espera si hay que iniciar sesión
  python tendencias_ml.py --listados 35   cuántos listados abrir por vuelta (por defecto 35, ritmo de persona)
  python tendencias_ml.py --categorias 4  cuántas categorías de "Más vendidos" por día

No publica, no compra ni cambia nada: solo lee.
"""
import ssl_fix  # noqa: F401  (certificados en Windows)
import json, os, random, re, sys, time, urllib.request
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
URL = os.environ.get("PANEL_URL", "").strip().rstrip("/")
TOKEN = os.environ.get("LECTOR_TOKEN", "").strip()
if not URL or not TOKEN or "el mismo token" in TOKEN.lower() or TOKEN.lower() in {"changeme", "replace_me", "reemplazar"}:
    print("Falta configurar el acceso al panel para el lector de Mercado Libre.")
    print(f"Abrí este archivo y completá LECTOR_TOKEN: {AQUI / '.env'}")
    print("PANEL_URL ya viene cargada en .env.example. No pegues el token en un chat ni lo compartas.")
    raise SystemExit(2)

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
  // Las tendencias son los enlaces que terminan en #trend; el texto trae el puesto arriba ("3º MAYOR CRECIMIENTO") y la búsqueda abajo
  const out = [], vistos = new Set();
  for (const a of document.querySelectorAll('a[href$="#trend"]')) {
    const lineas = (a.innerText || '').split('\n').map((x) => x.trim()).filter(Boolean);
    const palabra = lineas[lineas.length - 1] || '', tipo = lineas.length > 1 ? lineas[0].replace(/^\d+\S*\s*/, '').toLowerCase() : '';
    const k = palabra.toLowerCase(); if (!palabra || palabra.length > 60 || vistos.has(k)) continue; vistos.add(k);
    const rango = lineas.length > 1 ? lineas[0].match(/^(\d+)/) : null;
    out.push({ palabra, tipo, puesto: rango ? Number(rango[1]) : null, link: a.href });
  }
  return out;
}
"""
# Una tarjeta de resultado (sirve para el listado de una búsqueda y para "Más vendidos" de una categoría).
# Selectores verificados el 18/11/2026: precio actual en .poly-price__current (el primero que aparece suele ser el
# precio tachado), Full = svg aria-label "Enviado por FULL", tienda oficial = svg aria-label "Tienda oficial",
# vendidos y calificación en el texto oculto "Calificación 4.8 de 5 estrellas. Más de 10mil productos vendidos.",
# publicidad = línea "Ad" o "Promocionado".
JS_TARJETAS = r"""
(maximo) => {
  const num = (t) => { const d = String(t || '').replace(/[^\d]/g, ''); return d ? Number(d) : null; };
  const vend = (t) => { const m = String(t || '').toLowerCase().replace(/\./g, '').match(/(\d+(?:,\d+)?)\s*(mil|millones|millón|m\b)?\s*(?:productos\s+)?vendidos?/); if (!m) return null; const b = parseFloat(m[1].replace(',', '.')); return Math.round(m[2] === 'mil' ? b * 1e3 : m[2] ? b * 1e6 : b); };
  const out = [], vistos = new Set();
  for (const li of document.querySelectorAll('li.ui-search-layout__item')) {
    const tEl = li.querySelector('.poly-component__title, .ui-search-item__title, h2, h3'); if (!tEl) continue;
    const titulo = (tEl.innerText || '').trim();
    const pEl = li.querySelector('.poly-price__current .andes-money-amount') || li.querySelector('.andes-money-amount:not(.andes-money-amount--previous)');
    const precio = pEl ? (num((pEl.getAttribute('aria-label') || '').split(' ')[0]) || num((pEl.querySelector('.andes-money-amount__fraction') || {}).innerText)) : null;
    const texto = li.innerText || '', lineas = texto.split('\n').map((x) => x.trim());
    const oculto = [...li.querySelectorAll('.andes-visually-hidden')].map((x) => x.innerText).join(' ');
    const calif = (oculto.match(/Calificaci[oó]n\s+([\d.,]+)/i) || [])[1];
    const vt = (texto.match(/\+\s?[\d.,]+\s*(mil|M)?\s*vendidos?/i) || [])[0] || '';
    const enlace = tEl.closest('a') || tEl.querySelector('a') || li.querySelector('a[href*="mercadolibre.com.ar"]');
    const clave = titulo.toLowerCase() + '|' + precio; if (!titulo || vistos.has(clave)) continue; vistos.add(clave);
    out.push({
      titulo, precio, vendidos: vt, vendidos_n: vend(oculto) || vend(vt),
      calif: calif ? Number(calif.replace(',', '.')) : null,
      full: !!li.querySelector('[aria-label*="FULL" i]'),
      oficial: !!li.querySelector('[aria-label="Tienda oficial" i]'),
      gratis: /env[ií]o gratis|llega gratis/i.test(texto),
      ad: lineas.includes('Ad') || /Promocionado/i.test(texto),
      mas_vendido: /M[ÁA]S VENDIDO/.test(texto),
      puesto_vendido: Number((texto.match(/(\d+)º\s*M[ÁA]S VENDIDO/) || [])[1]) || null,
      vendedor: ((li.querySelector('.poly-component__seller') || {}).innerText || '').trim(),
      url: enlace ? enlace.href.split('#')[0] : '',
    });
    if (out.length >= maximo) break;
  }
  const m = (document.body.innerText || '').match(/([\d.]+)\s+resultados/i);
  return { resultados: m ? Number(m[1].replace(/\./g, '')) : null, items: out };
}
"""
JS_SUBCATS = r"""
(base) => [...new Set([...document.querySelectorAll('a[href]')].map((a) => a.href.split('#')[0].split('?')[0]).filter((h) => h.startsWith(base) && h.length > base.length && /\/$/.test(h)))]
"""
# Categorías con productos importables para revender. Se pueden cambiar con ML_CATEGORIAS en .env (separadas por coma).
CATEGORIAS = [c.strip() for c in os.environ.get("ML_CATEGORIAS", "hogar-muebles-jardin,deportes-fitness,accesorios-vehiculos,belleza-cuidado-personal,animales-mascotas,herramientas,bebes,juegos-juguetes,celulares-telefonos,electronica-audio-video,computacion,salud-equipamiento-medico,arte-papeleria-merceria").split(",") if c.strip()]
# Búsquedas que no son productos (no vale la pena abrir su listado)
NO_PRODUCTO = re.compile(r"^(ofertas?|navidad|buscar|black friday|cyber ?monday|hot ?sale)$|tienda oficial|^(autos?|motos?|camionetas?|departamentos?|casas?|terrenos?|alquiler|inmuebles?)\b", re.I)
VISITADOS = AQUI / "ml_visitados.json"

def bloqueo(pg):
    """None si la página se ve; si no, qué pide Mercado Libre."""
    u = pg.url
    if "captcha" in u: return "captcha"
    if "account-verification" in u or "/lgz/login" in u or "negative_traffic" in u: return "login"
    try:
        if re.search(r"para continuar,?\s*ingres", pg.inner_text("body")[:3000], re.I): return "login"
    except Exception: pass
    return None

def esperar_persona(pg, ver, que):
    """Con --ver espera hasta 10 minutos a que la persona inicie sesión o complete el paso. No se esquiva nada."""
    if not ver: return False
    print(f"  Mercado Libre pide {'iniciar sesión' if que == 'login' else 'una verificación'}: hacelo en la ventana (espero hasta 10 minutos)...")
    for _ in range(300):
        time.sleep(2)
        if not bloqueo(pg): return True
    return False

def pausa(): time.sleep(random.uniform(3.5, 8))   # ritmo de una persona, no de un robot

def abrir(pg, url, ver):
    pg.goto(url, wait_until="domcontentloaded", timeout=60000)
    b = bloqueo(pg)
    if b and not esperar_persona(pg, ver, b): return b
    try: pg.wait_for_selector("li.ui-search-layout__item", timeout=30000)   # los resultados se dibujan unos segundos después
    except Exception: pass
    time.sleep(1.5)
    return None

def palabra_de_titulo(titulo, vendedor=""):
    """'Mesa Plegable 180x74 Rectangular Blanca Gardenlife' → 'mesa plegable 180x74 rectangular' (sin la marca del vendedor)."""
    marca = {w.lower() for w in re.findall(r"\w+", vendedor or "") if len(w) > 2}
    palabras = [w for w in re.findall(r"[\wáéíóúñü]+", titulo.lower()) if w not in marca]
    return " ".join(palabras[:4])

def leer(ver=False, maximo=50, listados=35, categorias=4):
    from playwright.sync_api import sync_playwright
    visit = {}
    try: visit = json.loads(VISITADOS.read_text(encoding="utf-8"))
    except Exception: pass
    hoy = int(time.time() // 86400)
    salida, aviso = [], None
    with sync_playwright() as p:
        # Mercado Libre bloquea el navegador oculto: se abre una ventana real fuera de la pantalla (con --ver queda a la vista).
        # El perfil (perfil_ml) guarda la sesión: hay que iniciarla una vez con tendencias_ml_verificar.bat.
        ctx = p.chromium.launch_persistent_context(str(PERFIL), headless=False, viewport={"width": 1280, "height": 900}, locale="es-AR", args=[] if ver else ["--window-position=-2400,-2400"])
        pg = ctx.pages[0] if ctx.pages else ctx.new_page()
        # 1) Tendencias de búsqueda (las 50 de la portada: mayor crecimiento, más deseadas, más populares)
        pg.goto(TENDENCIAS, wait_until="domcontentloaded", timeout=60000); time.sleep(3)
        tend = [dict(t, categoria="tendencias") for t in pg.evaluate(JS_TENDENCIAS)][:maximo]
        print(f"{len(tend)} tendencias de búsqueda")
        # 2) Más vendidos por categoría: rota las categorías día a día (y una subcategoría de cada una)
        vend = []
        if CATEGORIAS:
            inicio = (hoy * categorias) % len(CATEGORIAS)
            elegidas = [CATEGORIAS[(inicio + i) % len(CATEGORIAS)] for i in range(min(categorias, len(CATEGORIAS)))]
            for cat in elegidas:
                base = f"https://listado.mercadolibre.com.ar/{cat}/"
                try:
                    b = abrir(pg, base, ver)
                    if b: aviso = b; break
                    urls = [base]
                    subs = pg.evaluate(JS_SUBCATS, base)
                    if subs: urls.append(subs[hoy % len(subs)])
                    for i, u in enumerate(urls):
                        if i: pausa(); b = abrir(pg, u, ver)
                        if b: aviso = b; break
                        d = pg.evaluate(JS_TARJETAS, 10)
                        nombre = (pg.inner_text("h1") if pg.query_selector("h1") else cat).strip()
                        for x in d["items"]:
                            if x.get("mas_vendido") and not x.get("ad"):
                                vend.append({"palabra": palabra_de_titulo(x["titulo"], x.get("vendedor")), "tipo": "más vendido", "puesto": x.get("puesto_vendido"), "categoria": nombre[:40], "origen": x})
                    if aviso: break
                    pausa()
                except Exception as e: print("  categoría", cat, "error:", str(e)[:80])
            print(f"{len(vend)} más vendidos en {len(elegidas)} categorías")
        if aviso == "login":
            print("  Mercado Libre pide iniciar sesión para ver los listados. Abrí tendencias_ml_verificar.bat, ingresá con tu cuenta UNA vez y listo (queda guardada).")
        # 3) Listado de cada búsqueda: competencia, precios, vendidos. Primero lo que no se miró hace más de 6 días.
        todas = [t for t in tend if not NO_PRODUCTO.search(t["palabra"])] + vend
        vistos, cola = set(), []
        for t in todas:
            k = t["palabra"].lower()
            if k and k not in vistos: vistos.add(k); cola.append(t)
        cola.sort(key=lambda t: visit.get(t["palabra"].lower(), 0))
        abiertos = 0
        for t in cola:
            fila = {"palabra": t["palabra"], "puesto": t.get("puesto"), "categoria": t.get("categoria", ""), "tipo": t.get("tipo", "")}
            reciente = hoy - visit.get(t["palabra"].lower(), 0) < 6
            if aviso or abiertos >= listados or reciente:
                if t.get("origen"): fila["top"] = [t["origen"]]   # un más vendido trae al menos su propia tarjeta
                salida.append(fila); continue
            try:
                link = "https://listado.mercadolibre.com.ar/" + re.sub(r"\s+", "-", t["palabra"].strip().lower())
                pausa(); b = abrir(pg, link, ver); abiertos += 1
                if b: aviso = b; salida.append(fila); print("  Mercado Libre pide", "iniciar sesión" if b == "login" else "verificación", "- sigo solo con los nombres."); continue
                d = pg.evaluate(JS_TARJETAS, 18)
                org = [x for x in d["items"] if not x.get("ad")]
                precios = [x["precio"] for x in org if x.get("precio")]
                fila.update({"resultados": d.get("resultados"), "precio_min": min(precios) if precios else None, "precio_max": max(precios) if precios else None,
                             "vendidos": org[0]["vendidos"] if org else "", "top": org[:8] + [x for x in d["items"] if x.get("ad")][:2]})
                visit[t["palabra"].lower()] = hoy
                c, o = sum(1 for x in org if x.get("full")), sum(1 for x in org if x.get("oficial"))
                print(f"  {abiertos}. {t['palabra']} · {d.get('resultados') or '?'} publicaciones · {len(org)} leídas · Full {c} · oficiales {o}")
            except Exception as e:
                fila["error"] = str(e)[:80]
            salida.append(fila)
        ctx.close()
    try: VISITADOS.write_text(json.dumps({k: v for k, v in visit.items() if hoy - v < 30}), encoding="utf-8")
    except Exception: pass
    DEBUG.write_text(json.dumps(salida, ensure_ascii=False, indent=1), encoding="utf-8")
    if aviso: print("AVISO:", "falta iniciar sesión en Mercado Libre (tendencias_ml_verificar.bat)" if aviso == "login" else "Mercado Libre pidió verificación (tendencias_ml_verificar.bat)")
    return salida

def una_vez(ver=False, maximo=50, listados=35, categorias=4):
    items = leer(ver, maximo, listados, categorias)
    if not items: print("No leí nada (¿cambió la página?). Mirá ml_debug.json o corré con --ver."); return
    r = mandar(items); print("Mandado al panel:", r)

if __name__ == "__main__":
    a = sys.argv[1:]
    ver = "--ver" in a
    maximo = int(a[a.index("--max") + 1]) if "--max" in a else 50
    listados = int(a[a.index("--listados") + 1]) if "--listados" in a else 35
    categorias = int(a[a.index("--categorias") + 1]) if "--categorias" in a else 4
    if "--cada" in a:
        cada = int(a[a.index("--cada") + 1])
        while True:
            try: una_vez(ver, maximo, listados, categorias)
            except Exception as e: print("Error:", e)
            print(f"Vuelvo a leer en {cada} minutos (Ctrl+C para parar)"); time.sleep(cada * 60)
    else:
        una_vez(ver, maximo, listados, categorias)
