"""
Lee las estadísticas de TikTok Studio de @te.importamos.arg (solo lectura) y las manda al panel.
Gratis: usa tu propia sesión de TikTok en un navegador aparte (no toca tu Chrome).

Uso (desde la carpeta sender):
  python tiktok_studio.py --login      la PRIMERA vez: se abre una ventana, iniciás sesión en TikTok y la cerrás
  python tiktok_studio.py              lee una vez y manda los datos
  python tiktok_studio.py --cada 60    queda leyendo cada 60 minutos (dejalo abierto)
  python tiktok_studio.py --ver        lee mostrando la ventana (para revisar si algo falla)

No publica, no comenta, no cambia nada: solo abre TikTok Studio y lee lo que TikTok le muestra al dueño de la cuenta.
Si TikTok pide verificación (captcha), se frena y avisa: la resolvés vos con --ver.
"""
import json, os, re, sys, time, urllib.request
from pathlib import Path

AQUI = Path(__file__).resolve().parent
PERFIL = AQUI / "perfil_tiktok"          # sesión de TikTok de este programa (no se sube al repo)
DEBUG = AQUI / "tiktok_debug.json"       # muestra de lo leído, por si hay que ajustar el programa
STUDIO = "https://www.tiktok.com/tiktokstudio/content"

def cargar_env():
    p = AQUI / ".env"
    if p.exists():
        for l in p.read_text(encoding="utf-8-sig").splitlines():
            if "=" in l and not l.strip().startswith("#"):
                k, v = l.split("=", 1); os.environ.setdefault(k.strip(), v.strip())
cargar_env()
URL = os.environ["PANEL_URL"].rstrip("/")
TOKEN = os.environ["LECTOR_TOKEN"]

# Nombres que usa TikTok para cada dato (cambian según la página): se buscan todos
ALIAS = {
    "vistas": ["play_count", "playCount", "view_count", "viewCount", "video_views", "vv", "video_view"],
    "likes": ["digg_count", "diggCount", "like_count", "likeCount", "likes"],
    "comentarios": ["comment_count", "commentCount", "comments"],
    "compartidos": ["share_count", "shareCount", "shares"],
    "guardados": ["collect_count", "collectCount", "favorite_count", "favourite_count", "favoriteCount", "saves"],
    "duracion": ["duration", "video_duration", "videoDuration"],
    "ts": ["create_time", "createTime", "post_time", "publish_time", "schedule_time"],
    "texto": ["desc", "description", "title", "caption"],
    "tiempo": ["average_watch_time", "avg_watch_time", "avgWatchTime", "avg_play_time", "averageWatchTime"],
    "completado": ["full_watched_rate", "finish_rate", "completion_rate", "finishRate", "full_video_watched_rate"],
    "portada": ["cover_url", "coverUrl", "cover", "thumbnail"],
}
ID_KEYS = ["item_id", "itemId", "aweme_id", "awemeId", "video_id", "id"]

def valor(d, nombres):
    for n in nombres:
        if n in d and d[n] not in (None, ""):
            v = d[n]
            if isinstance(v, dict): v = v.get("value", v.get("url_list", [None])[0] if isinstance(v.get("url_list"), list) else None)
            if isinstance(v, list): v = v[0] if v else None
            return v
    return None

def recorrer(x, videos):
    if isinstance(x, dict):
        vid = None
        for k in ID_KEYS:
            if re.fullmatch(r"\d{15,25}", str(x.get(k, ""))): vid = str(x[k]); break
        if vid:
            fuentes = [x] + [x[k] for k in ("statistics", "stats", "metrics", "item_stats", "video", "itemInfo") if isinstance(x.get(k), dict)]
            v = videos.setdefault(vid, {"id": vid})
            for campo, nombres in ALIAS.items():
                for f in fuentes:
                    r = valor(f, nombres)
                    if r is not None:
                        if campo in ("texto", "portada"):
                            if not v.get(campo): v[campo] = str(r)
                        else:
                            try:
                                n = float(str(r).replace(",", "").replace("%", ""))
                                if campo not in v or n > v[campo]: v[campo] = n
                            except ValueError: pass
                        break
        for val in x.values(): recorrer(val, videos)
    elif isinstance(x, list):
        for val in x: recorrer(val, videos)

def normalizar(v):
    out = {"id": v["id"], "texto": v.get("texto", "")[:600], "portada": v.get("portada", "")}
    for c in ("vistas", "likes", "comentarios", "compartidos", "guardados"):
        if c in v: out[c] = int(v[c])
    if "ts" in v: out["ts"] = int(v["ts"] * 1000 if v["ts"] < 1e12 else v["ts"])
    if "duracion" in v: out["duracion"] = int(v["duracion"] / 1000 if v["duracion"] > 1000 else v["duracion"])
    if "tiempo" in v: out["tiempo_ms"] = int(v["tiempo"] if v["tiempo"] > 1000 else v["tiempo"] * 1000)
    if "completado" in v: out["completado"] = round(v["completado"] / 100 if v["completado"] > 1 else v["completado"], 4)
    return out

def mandar(videos):
    datos = json.dumps({"videos": videos}).encode()
    req = urllib.request.Request(f"{URL}/lector/tiktok-studio", data=datos, method="POST",
        headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json", "User-Agent": "Mozilla/5.0 TeImportamos-TikTokStudio"})
    with urllib.request.urlopen(req, timeout=60) as r: return json.load(r)

def leer(ver=False, login=False):
    from playwright.sync_api import sync_playwright
    videos, muestras = {}, []
    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(str(PERFIL), headless=not (ver or login), viewport={"width": 1300, "height": 900}, locale="es-AR")
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        if login:
            page.goto("https://www.tiktok.com/login")
            print("Iniciá sesión en TikTok con la cuenta de te.importamos.arg en la ventana que se abrió.")
            input("Cuando ya veas tu cuenta, volvé acá y apretá Enter... ")
            ctx.close(); print("Listo, sesión guardada. Ahora corré: python tiktok_studio.py"); return None

        def al_responder(resp):
            try:
                if "tiktok.com" not in resp.url or "json" not in (resp.headers.get("content-type") or ""): return
                j = resp.json(); antes = len(videos); recorrer(j, videos)
                if len(videos) > antes and len(muestras) < 3: muestras.append({"url": resp.url[:200], "muestra": json.dumps(j)[:4000]})
            except Exception: pass
        page.on("response", al_responder)
        page.goto(STUDIO, wait_until="domcontentloaded", timeout=60000)
        page.wait_for_timeout(6000)
        if "login" in page.url:
            ctx.close(); print("TikTok pide iniciar sesión. Corré: python tiktok_studio.py --login"); return None
        if page.locator("text=/verific|captcha|Verify/i").count():
            ctx.close(); print("TikTok pidió una verificación. Corré: python tiktok_studio.py --ver y resolvela a mano."); return None
        for _ in range(8):   # bajar para que cargue más videos
            page.mouse.wheel(0, 3000); page.wait_for_timeout(1500)
        page.wait_for_timeout(2000)
        ctx.close()
    DEBUG.write_text(json.dumps(muestras, ensure_ascii=False, indent=1), encoding="utf-8")
    return [normalizar(v) for v in videos.values() if any(k in v for k in ("vistas", "likes"))]

def una_vez(ver=False):
    vids = leer(ver=ver)
    if vids is None: return False
    if not vids:
        print(f"No encontré estadísticas en la página. Mandame el archivo {DEBUG.name} para ajustar el programa."); return False
    r = mandar(vids)
    print(time.strftime("%H:%M"), f"TikTok Studio: {len(vids)} videos leídos, {r.get('guardados')} guardados en el panel")
    return True

if __name__ == "__main__":
    a = sys.argv[1:]
    if "--login" in a: leer(login=True); sys.exit(0)
    if "--cada" in a:
        mins = int(a[a.index("--cada") + 1]) if len(a) > a.index("--cada") + 1 else 60
        while True:
            try: una_vez()
            except Exception as e: print("Error:", e)
            time.sleep(mins * 60)
    sys.exit(0 if una_vez(ver="--ver" in a) else 1)
