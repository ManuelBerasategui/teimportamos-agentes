"""
Busca productos en tendencia todos los días y los manda al panel (pestaña Mercado Libre):
  1. Google Trends Argentina: "búsquedas en aumento" de semillas con intención de reventa ("por mayor", "para revender",
     "comprar", "precio"): aparecen productos que todavía no están arriba en Mercado Libre.
  2. Google Trends: curva diaria de 90 días de cada candidato (crecimiento del día, la semana y el mes).
  3. Mercado Libre: las 50 tendencias de búsqueda, los "Más vendidos" de 4 categorías por día (rotan) y el listado de
     cada búsqueda (precio actual, vendidos, calificación, Full, tiendas oficiales, avisos).
El worker cruza todo, arma el ranking del día, la semana y el mes con el texto para los grupos y para Instagram, lo manda
por WhatsApp a las 9:10, y además busca en 1688 los que pasan el filtro y calcula el margen.

Todo gratis y a ritmo de persona: usa tu Google Chrome (si está instalado) con un perfil propio (perfil_ml).
Mercado Libre pide iniciar sesión para ver los listados: la primera vez abrí tendencias_ml_verificar.bat e ingresá con tu
cuenta en la ventana (queda guardada). Si aparece un captcha no se esquiva: se avisa y se resuelve a mano con el mismo .bat.
Si Google responde "429" (demasiadas consultas) espera 3 minutos, reintenta una vez y si no, sigue al otro día.

Uso (desde la carpeta sender):
  programar_tendencias.bat                deja programada la lectura todos los días a las 07:30 (recomendado)
  python tendencias_ml.py                 lee una vez y manda los datos
  python tendencias_ml.py --ver           muestra la ventana y espera si hay que iniciar sesión
  python tendencias_ml.py --listados 35   cuántos listados de Mercado Libre abrir por vuelta
  python tendencias_ml.py --categorias 4  cuántas categorías de "Más vendidos" por día
Opcional en .env: GT_SEMILLAS (por defecto "por mayor,para revender,comprar|18,precio|18"; "|18" = categoría Compras),
GT_SERIES (curvas de Google por día, 25), ML_CATEGORIAS.

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

def mandar(cuerpo, ruta="ml-tendencias"):
    datos = json.dumps(cuerpo).encode()
    req = urllib.request.Request(f"{URL}/lector/{ruta}", data=datos, method="POST",
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
# GOOGLE TRENDS (gratis): se consulta desde la página de Google Trends abierta en el navegador, a ritmo de persona.
# "En aumento" de semillas con intención de compra/reventa → productos nuevos. Curva diaria de 90 días → crecimiento.
JS_GT_AUMENTO = r"""
async ([kw, tiempo, cat]) => {
  const leer = async (u) => { const r = await fetch(u); const t = await r.text(); if (r.status === 429) throw new Error('429'); if (!r.ok) throw new Error('http ' + r.status); return JSON.parse(t.slice(t.indexOf('{'))); };
  try {
    const req = { comparisonItem: [{ keyword: kw, geo: 'AR', time: tiempo }], category: cat || 0, property: '' };
    const j = await leer('/trends/api/explore?hl=es-AR&tz=180&req=' + encodeURIComponent(JSON.stringify(req)));
    const w = j.widgets.find((x) => x.id === 'RELATED_QUERIES'); if (!w) return { items: [] };
    const d = await leer('/trends/api/widgetdata/relatedsearches?hl=es-AR&tz=180&req=' + encodeURIComponent(JSON.stringify(w.request)) + '&token=' + w.token);
    const rl = d.default.rankedList || [];
    return { items: ((rl[1] || {}).rankedKeyword || []).map((k) => ({ query: k.query, valor: k.formattedValue })) };
  } catch (e) { return { error: String(e.message || e) }; }
}
"""
JS_GT_SERIE = r"""
async ([kw]) => {
  const leer = async (u) => { const r = await fetch(u); const t = await r.text(); if (r.status === 429) throw new Error('429'); if (!r.ok) throw new Error('http ' + r.status); return JSON.parse(t.slice(t.indexOf('{'))); };
  try {
    const req = { comparisonItem: [{ keyword: kw, geo: 'AR', time: 'today 3-m' }], category: 0, property: '' };
    const j = await leer('/trends/api/explore?hl=es-AR&tz=180&req=' + encodeURIComponent(JSON.stringify(req)));
    const w = j.widgets.find((x) => x.id === 'TIMESERIES'); if (!w) return { error: 'sin curva' };
    const d = await leer('/trends/api/widgetdata/multiline?hl=es-AR&tz=180&req=' + encodeURIComponent(JSON.stringify(w.request)) + '&token=' + w.token);
    const tl = (d.default.timelineData || []).filter((x) => !x.isPartial);   // el último día suele estar incompleto
    if (!tl.length) return { error: 'sin datos' };
    return { fin: new Date(Number(tl[tl.length - 1].time) * 1000).toISOString().slice(0, 10), valores: tl.map((x) => x.value[0]) };
  } catch (e) { return { error: String(e.message || e) }; }
}
"""
# Semillas con intención de reventa o compra. "palabra|18" = solo dentro de la categoría Compras de Google (saca juegos, dólar, autos).
SEMILLAS = [x.strip() for x in os.environ.get("GT_SEMILLAS", "por mayor,para revender,comprar|18,precio|18").split(",") if x.strip()]
TIEMPOS_GT = ["now 7-d", "today 1-m"]          # semana (y día) · mes
GT_SERIES = int(os.environ.get("GT_SERIES", "25"))
GT_PAUSA = (9, 16)                              # segundos entre consultas: Google corta (429) si se va más rápido
GT_CACHE = AQUI / "gt_cache.json"
RUIDO = re.compile(r"\bpara\s+revender\b|\b(directo\s+)?de\s+f[aá]brica\b|\b(al\s+)?(x\s+|por\s+)?mayor(ista|istas|eo)?\b|\bdonde\s+comprar\b|\bcomprar\b|\bprecios?\b|\bimportad[oa]s?\b|\bmercado\s*libre\b|\b(temu|shein|aliexpress|amazon|alibaba)\b|\ben\s+(once|flores|rosario|caba|cordoba|córdoba|mendoza)\b|\b(argentina|rosario|caba|online|baratos?|baratas?|ofertas?|venta|cuanto\s+(sale|cuesta)|20\d\d)\b", re.I)
NO_GOOGLE = re.compile(r"\bgta\b|play ?5|\bps[45]\b|xbox|nintendo|pasajes?|\btren\b|\breal\b|bitcoin|cripto|d[oó]lares|\beuro|jeep|honda|toyota|fiat|ford|chevrolet|volkswagen|peugeot|renault|nafta|aguinaldo|monotributo|plazo fijo|seguro|alquiler|cuotas?\b|netflix|gala|eliminaci|f[uú]tbol|boca|river|partido|dolar|d[oó]lar|clima|estafa|logo|es confiable|tienda online|black friday|cyber monday|hot sale|noche de los museos|login|iniciar sesi|app\b|whatsapp|instagram|tiktok|youtube|canva|mercado pago", re.I)

def limpiar(q):
    t = RUIDO.sub(" ", q.lower())
    t = re.sub(r"\s+", " ", t).strip(" -.,")
    t = re.sub(r"^(de|para|en|el|la|los|las)\s+|\s+(de|para|en|al|x|el|la)$", "", t).strip()
    generico = re.fullmatch(r"(productos?|cosas|art[ií]culos|mercader[ií]a|todo|ropa|negocio|emprendimiento|ideas?)", t)
    return t if 3 <= len(t) <= 40 and len(t.split()) <= 5 and not generico and not NO_GOOGLE.search(q) else ""

def google(pg, candidatos_ml):
    """Devuelve (descubiertas, series, aviso). candidatos_ml: palabras de Mercado Libre para medir su curva."""
    desc, series, aviso = [], [], ""
    try:
        pg.goto("https://trends.google.com/trends/explore?geo=AR&hl=es", wait_until="domcontentloaded", timeout=60000); time.sleep(4)
    except Exception as e: return desc, series, f"Google Trends no abrió: {str(e)[:60]}"
    def llamar(js, args):
        for intento in range(2):
            r = pg.evaluate(js, args)
            if r.get("error") == "429":
                if intento: return r
                print("  Google pide ir más despacio (429): espero 3 minutos..."); time.sleep(180); continue
            return r
        return r
    # 1) Búsquedas en aumento
    for semilla in SEMILLAS:
        sem, _, cat = semilla.partition("|")
        for t in TIEMPOS_GT:
            r = llamar(JS_GT_AUMENTO, [sem, t, int(cat or 0)]); time.sleep(random.uniform(*GT_PAUSA))
            if r.get("error"):
                if r["error"] == "429": aviso = "Google Trends limitó las consultas: sigo mañana"; break
                continue
            for k in r.get("items", []):
                pal = limpiar(k["query"])
                if pal and pal != sem: desc.append({"palabra": pal, "semilla": sem, "tiempo": t, "valor": k["valor"], "consulta": k["query"]})
        if aviso: break
    print(f"{len(desc)} búsquedas en aumento en Google ({len(set(d['palabra'] for d in desc))} productos)")
    # 2) Curva de 90 días: primero lo que Google descubrió (más crecimiento), después lo de Mercado Libre
    try: cache = json.loads(GT_CACHE.read_text(encoding="utf-8"))
    except Exception: cache = {}
    hoy = int(time.time() // 86400)
    crec = lambda v: 5000 if re.search(r"aumento|breakout", str(v), re.I) else int(re.sub(r"[^\d]", "", str(v)) or 0)
    orden = [d["palabra"] for d in sorted(desc, key=lambda d: -crec(d["valor"]))] + candidatos_ml
    vistos, cola = set(), []
    for pal in orden:
        k = pal.lower()
        if k in vistos or hoy - cache.get(k, -99) < 2: continue
        vistos.add(k); cola.append(pal)
    for pal in cola[:GT_SERIES]:
        if aviso: break
        r = llamar(JS_GT_SERIE, [pal]); time.sleep(random.uniform(*GT_PAUSA))
        if r.get("error"):
            if r["error"] == "429": aviso = "Google Trends limitó las consultas: sigo mañana"
            continue
        series.append({"palabra": pal, "fin": r["fin"], "valores": r["valores"]}); cache[pal.lower()] = hoy
    print(f"{len(series)} curvas de Google medidas")
    try: GT_CACHE.write_text(json.dumps({k: v for k, v in cache.items() if hoy - v < 10}), encoding="utf-8")
    except Exception: pass
    return desc, series, aviso

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

def leer(ver=False, maximo=50, listados=35, categorias=4, estado=None):
    estado = estado or {}
    por_api = bool(estado.get("api_conectada"))   # Mercado Libre lo lee el panel por la API oficial: acá solo Google
    from playwright.sync_api import sync_playwright
    visit = {}
    try: visit = json.loads(VISITADOS.read_text(encoding="utf-8"))
    except Exception: pass
    hoy = int(time.time() // 86400)
    salida, aviso = [], None
    desc, series, aviso_g = [], [], ""
    with sync_playwright() as p:
        # Mercado Libre bloquea el navegador oculto: se abre una ventana real fuera de la pantalla (con --ver queda a la vista).
        # El perfil (perfil_ml) guarda la sesión: hay que iniciarla una vez con tendencias_ml_verificar.bat.
        # Se usa el Google Chrome instalado (el mismo que usás vos); si no está, el Chromium de Playwright.
        opciones = dict(headless=False, viewport={"width": 1280, "height": 900}, locale="es-AR", args=[] if ver else ["--window-position=-2400,-2400"])
        try: ctx = p.chromium.launch_persistent_context(str(PERFIL), channel="chrome", **opciones)
        except Exception: ctx = p.chromium.launch_persistent_context(str(PERFIL), **opciones)
        pg = ctx.pages[0] if ctx.pages else ctx.new_page()
        # 1) Tendencias de búsqueda (las 50 de la portada: mayor crecimiento, más deseadas, más populares)
        tend = []
        if por_api: print("Mercado Libre conectado por la API oficial: lo lee el panel. Acá solo Google Trends.")
        else:
            pg.goto(TENDENCIAS, wait_until="domcontentloaded", timeout=60000); time.sleep(3)
            tend = [dict(t, categoria="tendencias") for t in pg.evaluate(JS_TENDENCIAS)][:maximo]
            print(f"{len(tend)} tendencias de búsqueda")
        # 2) Más vendidos por categoría: rota las categorías día a día (y una subcategoría de cada una)
        vend = []
        if CATEGORIAS and not por_api:
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
            print("  Mercado Libre pide iniciar sesión y no deja hacerlo en una ventana automática. Solución: conectá Mercado Libre")
            print("  por la API oficial desde el panel (pestaña Mercado Libre > Conexión con Mercado Libre). Sigo con Google Trends.")
        # 3) Google Trends: búsquedas en aumento + curva de 90 días (de lo descubierto y de lo que vino de Mercado Libre)
        desc, series, aviso_g = google(pg, [t["palabra"] for t in tend if not NO_PRODUCTO.search(t["palabra"])] + [v["palabra"] for v in vend] + [w for w in estado.get("palabras", []) if not NO_PRODUCTO.search(w)])
        crec = lambda v: 5000 if re.search(r"aumento|breakout", str(v), re.I) else int(re.sub(r"[^\d]", "", str(v)) or 0)
        g_top, g_vistos = [], set()
        for d in sorted(desc, key=lambda d: -crec(d["valor"])):
            if d["palabra"] not in g_vistos: g_vistos.add(d["palabra"]); g_top.append({"palabra": d["palabra"], "tipo": "google", "categoria": "google: " + d["semilla"]})
        # 4) Listado de cada búsqueda en Mercado Libre: competencia, precios, vendidos.
        #    Primero lo que Google descubrió (es lo que no se ve a mano), después lo que no se miró hace más de 6 días.
        todas = [] if por_api else g_top[:15] + [t for t in tend if not NO_PRODUCTO.search(t["palabra"])] + vend   # con la API, el panel busca en ML lo que descubrió Google
        vistos, cola = set(), []
        for t in todas:
            k = t["palabra"].lower()
            if k and k not in vistos: vistos.add(k); cola.append(t)
        cola.sort(key=lambda t: (t.get("tipo") != "google", visit.get(t["palabra"].lower(), 0)))
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
    DEBUG.write_text(json.dumps({"mercado_libre": salida, "google": {"descubiertas": desc, "series": len(series)}}, ensure_ascii=False, indent=1), encoding="utf-8")
    if aviso: print("AVISO:", "falta iniciar sesión en Mercado Libre (tendencias_ml_verificar.bat)" if aviso == "login" else "Mercado Libre pidió verificación (tendencias_ml_verificar.bat)")
    return salida, {"descubiertas": desc, "series": series, "aviso": aviso_g or (("falta iniciar sesión en Mercado Libre" if aviso == "login" else "Mercado Libre pidió verificación") if aviso else "")}

def una_vez(ver=False, maximo=50, listados=35, categorias=4):
    estado = {}
    try:
        with urllib.request.urlopen(urllib.request.Request(f"{URL}/lector/ml-api-estado", headers={"Authorization": f"Bearer {TOKEN}", "User-Agent": "Mozilla/5.0 TeImportamos-ML"}), timeout=30) as r: estado = json.load(r)
    except Exception as e: print("No pude consultar el panel (sigo igual):", str(e)[:80])
    items, g = leer(ver, maximo, listados, categorias, estado)
    if g["descubiertas"] or g["series"] or g["aviso"]:
        print("Google al panel:", mandar(g, "tendencias-google"))
    if not items:
        if not estado.get("api_conectada"): print("No leí listados de Mercado Libre. Conectá la API oficial desde el panel (pestaña Mercado Libre) y no hace falta navegador.")
        return
    print("Mercado Libre al panel:", mandar({"items": items}))

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
