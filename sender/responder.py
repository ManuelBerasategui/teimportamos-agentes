"""Contesta los mensajes de WhatsApp que esperan respuesta, escribiendo como una persona (WhatsApp Web, ventana propia).
Uso:  python responder.py --prueba   -> solo muestra qué contestaría a cada chat, NO abre WhatsApp ni envía nada
      python responder.py            -> contesta hasta que no queden pendientes y termina
      python responder.py --escritorio --seguir -> usa el WhatsApp que ya tenés abierto (app o tu Chrome), sin QR
      python responder.py --seguir   -> queda andando y revisa cada 2 minutos hasta que lo cortes
Para frenarlo: Ctrl+C, un archivo llamado STOP en esta carpeta, o escribirle al bot de Telegram "pausar respuestas"."""
import random, re, sys, time, urllib.parse
from datetime import datetime
import json, urllib.request
from enviar import api, parar, AQUI, H_DESDE, H_HASTA, URL, TOKEN, variar, os
from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout

EXTRA_SEG = int(os.environ.get("RESP_EXTRA_SEG", "10"))          # segundos de más "leyendo" antes de escribir
PAUSA_MIN = int(os.environ.get("RESP_PAUSA_MIN_SEG", "25"))      # pausa entre un chat y el siguiente
PAUSA_MAX = int(os.environ.get("RESP_PAUSA_MAX_SEG", "70"))
COTIZ_MODO = os.environ.get("COTIZ_MODO", "revisar")             # revisar (guarda el PDF para que lo mandes vos) | enviar (lo manda solo)
VENTANA = os.environ.get("VENTANA", "minimizada")                # minimizada | oculta | visible
CAJA = 'footer div[contenteditable="true"]'

def dormir(seg, motivo=""):
    fin = time.time() + seg
    while time.time() < fin:
        if parar(): return False
        time.sleep(min(1, max(0, fin - time.time())))
    return True

def escribir(pg, caja, texto):
    """Tipea letra por letra con ritmo irregular (como una persona un poco lenta)."""
    caja.click()
    for ch in texto:
        if parar(): return False
        if ch == "\n":
            pg.keyboard.press("Shift+Enter")
        else:
            pg.keyboard.type(ch)
        d = random.uniform(0.09, 0.22)
        if ch in ".,?¿!": d += random.uniform(0.15, 0.5)
        if random.random() < 0.04: d += random.uniform(0.6, 1.8)
        time.sleep(d)
    return True

def anotar_para_vos(it, d):
    """Deja en para_vos.txt (y en el panel, pestaña 'Para vos') los chats que quedaron para contestar a mano."""
    with open(AQUI / "para_vos.txt", "a", encoding="utf-8") as f:
        f.write(f"{datetime.now():%d/%m %H:%M} | {it['nombre'] or '?'} | +{it['conv']} | {d.get('resumen') or d.get('motivo', '')}\n")

def desde_ms():
    """RESP_DESDE (en .env, ej. 2026-11-02 21:05): ignora los chats cuyo último mensaje del cliente es anterior a esa hora
    (sirve cuando el panel estuvo caído y no registró lo que pasó en ese rato)."""
    v = os.environ.get("RESP_DESDE", "").strip()
    if not v: return 0
    try: return int(datetime.fromisoformat(v).timestamp() * 1000)
    except ValueError: sys.exit("RESP_DESDE tiene que ser fecha y hora así: 2026-11-02 21:05")

def hay_pendientes():
    """Devuelve (chats a contestar, cotizaciones para mandar) o None si está pausado."""
    r = api(f"/enviar/responder?limite=10&desde={desde_ms()}")
    if r.get("pausado"): print("⏸  Pausado desde el bot de Telegram. Escribí 'reanudar respuestas' para seguir."); return None
    if r.get("tope"): print("Llegué al tope de respuestas por hora. Espero."); return [], []
    return r["lista"], r.get("cotizaciones", [])

def api_texto(path, body):
    req = urllib.request.Request(f"{URL}/lector{path}", data=json.dumps(body).encode(), method="POST", headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json", "User-Agent": "Mozilla/5.0 TeImportamos-Sender/1.0"})
    with urllib.request.urlopen(req, timeout=60) as r: return r.read().decode("utf-8")

CAPS = ["Te paso la cotización 👆 con el detalle de cada producto y el total puesto. Cualquier duda me decís.",
        "Acá tenés la cotización en PDF, con el detalle y el total. Si querés avanzamos o ajustamos cantidades.",
        "Listo, te dejo la cotización armada. Fijate el detalle y me contás."]

def hacer_pdf(p, it):
    """Convierte la cotización (página del panel) en PDF con un Chrome sin ventana (el PDF solo sale en modo sin ventana)."""
    html = api_texto("/enviar/cotizacion-html", {"id": it["id"]})
    b = p.chromium.launch(); pg2 = b.new_page()
    pg2.set_content(html, wait_until="load")
    ruta = AQUI / f"Cotizacion_{it['num']}.pdf"
    pg2.pdf(path=str(ruta), format="A4", print_background=True); b.close()
    return ruta

ENVIAR = '[data-icon*="send"], [aria-label="Enviar"], button[aria-label="Enviar"]'

def debug_pantalla(pg, motivo):
    """Deja en debug_whatsapp.txt y debug.png cómo está la pantalla, para poder ajustar los botones si WhatsApp cambia."""
    try:
        iconos = pg.evaluate("() => [...new Set([...document.querySelectorAll('[data-icon]')].map(e => e.dataset.icon))]")
        labels = pg.evaluate("() => [...new Set([...document.querySelectorAll('[aria-label]')].map(e => e.getAttribute('aria-label')))].slice(0, 80)")
        (AQUI / "debug_whatsapp.txt").write_text(f"{motivo}\n\nICONOS: {iconos}\n\nETIQUETAS: {labels}\n", encoding="utf-8")
        pg.screenshot(path=str(AQUI / "debug.png"))
    except Exception: pass

def mandar_pdf(pg, ruta, texto):
    """Adjunta el PDF como documento, le pone el texto y lo envía. Si algo falla deja todo lo que pudo hecho (en borrador) y avisa."""
    pg.locator('[data-icon*="plus"], [data-icon="attach-menu-plus"], [aria-label="Adjuntar"]').first.click(timeout=15000)
    try:
        with pg.expect_file_chooser(timeout=8000) as fc:
            pg.get_by_text(re.compile("Documento", re.I)).first.click()
        fc.value.set_files(str(ruta))
    except Exception:
        pg.set_input_files('input[type="file"]:not([accept*="image"])', str(ruta))
    pg.wait_for_selector(ENVIAR, timeout=30000)
    cap = pg.locator('div[contenteditable="true"]').last
    if not escribir(pg, cap, texto): raise RuntimeError("cortado")
    time.sleep(random.uniform(1.0, 2.5))
    pg.locator(ENVIAR).last.click()
    time.sleep(5)
    if pg.locator(ENVIAR).count(): raise RuntimeError("el PDF no se envió")

def guardar_cotizacion(p, c):
    """Modo revisión: deja el PDF en la carpeta cotizaciones y lo anota en para_vos.txt."""
    ruta = hacer_pdf(p, c); (AQUI / "cotizaciones").mkdir(exist_ok=True)
    nombre_pdf = re.sub(r"[^\w.-]+", "_", f"Cotizacion_{c['num']}_{c['nombre']}") + ".pdf"
    ruta.replace(AQUI / "cotizaciones" / nombre_pdf)
    with open(AQUI / "para_vos.txt", "a", encoding="utf-8") as f: f.write(f"{datetime.now():%d/%m %H:%M} | {c['nombre']} | +{c['conv']} | cotización N° {c['num']} (USD {c['total']}) lista para revisar y mandar: cotizaciones\\{nombre_pdf}\n")
    api("/enviar/cotizacion-guardada", {"id": c["id"]}); print(f"  Cotización N° {c['num']} guardada para revisar: cotizaciones\\{nombre_pdf}")

ESCRITORIO = os.environ.get("ESCRITORIO", "app")   # app = WhatsApp de escritorio | chrome = tu WhatsApp Web ya abierto en Chrome

def main_escritorio(seguir):
    """Usa el WhatsApp que ya tenés abierto con sesión (app de escritorio o WhatsApp Web en tu Chrome): abre el chat con el
    mensaje ya escrito, espera el tiempo que tardaría una persona y aprieta Enter. Mientras corre, no uses el teclado ni el mouse."""
    import webbrowser, pyautogui, pygetwindow as gw
    def al_frente():
        w = gw.getActiveWindow()
        return w is not None and "whatsapp" in (w.title or "").lower()
    def traer():
        for w in gw.getAllWindows():
            if "whatsapp" in (w.title or "").lower() and w.title.strip():
                try: w.activate()
                except Exception: pass
                time.sleep(1); return al_frente()
        return False
    enviados = 0
    print(f"Modo escritorio ({'app de WhatsApp' if ESCRITORIO == 'app' else 'WhatsApp Web en tu Chrome'}). No toques el teclado ni el mouse mientras escribe. Para cortar: Ctrl+C, archivo STOP o 'pausar respuestas' en Telegram.")
    try:
        while not parar():
            if not (H_DESDE <= datetime.now().hour < H_HASTA): print("Fuera de horario, termino."); break
            pend = hay_pendientes()
            if pend is None: break
            lista, cots = pend
            if cots:
                with sync_playwright() as p:
                    for c in cots:
                        try: guardar_cotizacion(p, c)
                        except Exception as e: print(f"  No pude guardar la cotización N° {c['num']} ({str(e).splitlines()[0]}).")
            if not lista:
                if not seguir: print("No quedan chats para contestar."); break
                print(f"{datetime.now():%H:%M} · no hay chats esperando respuesta. Vuelvo a mirar en 2 minutos (dejalo abierto).")
                if not dormir(120): break
                continue
            print(f"{datetime.now():%H:%M} · {len(lista)} chat(s) para revisar.")
            for it in lista:
                if parar(): break
                d = api("/enviar/redactar", {"conv": it["conv"]})
                print(f"\n{it['nombre']} ({it['conv']}): {it['ultimo']}\n  → {d['accion']}: {d.get('mensaje') or d.get('motivo', '')}")
                if d["accion"] == "humano": anotar_para_vos(it, d)
                if d["accion"] != "responder": continue
                texto = urllib.parse.quote(d["mensaje"])
                if ESCRITORIO == "chrome": webbrowser.open(f"https://web.whatsapp.com/send?phone={it['conv']}&text={texto}")
                else: os.startfile(f"whatsapp://send?phone={it['conv']}&text={texto}")
                espera = random.uniform(6, 14) + len(it["ultimo"]) * 0.05 + EXTRA_SEG + len(d["mensaje"]) * random.uniform(0.12, 0.2)
                print(f"  esperando {espera:.0f}s (lo que tardaría en leer y escribir)...")
                if not dormir(espera): break
                if not al_frente() and not traer():
                    print("  WhatsApp no quedó al frente: no aprieto Enter (podría ir a otra ventana). Se reintenta después.")
                    api("/enviar/reintentar", {"conv": it["conv"]}); continue
                pyautogui.press("enter"); time.sleep(2)
                if ESCRITORIO == "chrome": time.sleep(2); pyautogui.hotkey("ctrl", "w")   # cierra la pestaña que abrió
                api("/enviar/respondido", {"conv": it["conv"]}); enviados += 1; print("  Enter apretado ✅ (revisá de vez en cuando que salgan bien)")
                if not dormir(random.randint(PAUSA_MIN, PAUSA_MAX)): break
    except KeyboardInterrupt:
        print("\nCortado.")
    print(f"\nListo. Contestados: {enviados}")

def main():
    prueba, seguir = "--prueba" in sys.argv, "--seguir" in sys.argv
    if not prueba and not (H_DESDE <= datetime.now().hour < H_HASTA):
        sys.exit(f"Fuera de horario ({H_DESDE}:00 a {H_HASTA}:00). Cambialo en .env si querés.")
    if prueba:
        pend = hay_pendientes() or ([], [])
        lista, cots = pend
        for c in cots: print(f"\n- COTIZACIÓN N° {c['num']} lista para {c['nombre']} ({c['conv']}): total USD {c['total']} → se enviaría el PDF con un texto corto.")
        print(f"\n{len(lista)} chats esperando respuesta (vista previa, no se envía nada).")
        for it in lista:
            d = api("/enviar/redactar", {"conv": it["conv"], "prueba": True})
            print(f"\n- {it['nombre']} ({it['conv']}) dijo: {it['ultimo']}\n  → {d['accion'].upper()}: {d.get('mensaje') or d.get('motivo', '')}" + (f"\n  PARA VOS: {d.get('resumen') or d.get('motivo', '')}" if d['accion'] == 'humano' else ""))
        return
    if "--escritorio" in sys.argv: return main_escritorio(seguir)
    args = {"minimizada": ["--start-minimized"], "oculta": ["--window-position=-32000,-32000"]}.get(VENTANA, [])
    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(str(AQUI / "perfil"), headless=False, viewport={"width": 1200, "height": 800}, args=args)
        pg = ctx.pages[0] if ctx.pages else ctx.new_page()
        pg.goto("https://web.whatsapp.com")
        print("Si pide QR, escanealo con el celular (solo la primera vez). Esperando WhatsApp Web...")
        pg.wait_for_selector('#pane-side', timeout=180000)
        enviados = 0; fallidas = set()
        try:
            while not parar():
                if not (H_DESDE <= datetime.now().hour < H_HASTA): print("Fuera de horario, termino."); break
                pend = hay_pendientes()
                if pend is None: break
                lista, cots = pend
                for c in cots:
                    if parar(): break
                    if c["id"] in fallidas: continue
                    print(f"\nCotización N° {c['num']} para {c['nombre']} ({c['conv']}) · total USD {c['total']}")
                    if COTIZ_MODO != "enviar":   # modo revisión: deja el PDF en la carpeta "cotizaciones" y no manda nada
                        try:
                            ruta = hacer_pdf(p, c); (AQUI / "cotizaciones").mkdir(exist_ok=True)
                            nombre_pdf = re.sub(r"[^\w.-]+", "_", f"Cotizacion_{c['num']}_{c['nombre']}") + ".pdf"
                            destino = AQUI / "cotizaciones" / nombre_pdf; ruta.replace(destino)
                            with open(AQUI / "para_vos.txt", "a", encoding="utf-8") as f: f.write(f"{datetime.now():%d/%m %H:%M} | {c['nombre']} | +{c['conv']} | cotización N° {c['num']} (USD {c['total']}) lista para revisar y mandar: cotizaciones\\{nombre_pdf}\n")
                            api("/enviar/cotizacion-guardada", {"id": c["id"]}); print(f"  Guardada para revisar: cotizaciones\\{nombre_pdf}")
                        except Exception as e: print(f"  No pude guardar el PDF ({str(e).splitlines()[0]})."); fallidas.add(c["id"])
                        continue
                    try:
                        ruta = hacer_pdf(p, c)
                        pg.goto(f"https://web.whatsapp.com/send?phone={c['conv']}")
                        pg.wait_for_selector(CAJA, timeout=45000)
                        if not dormir(random.uniform(8, 16) + EXTRA_SEG): break
                        mandar_pdf(pg, ruta, variar({"nombre": c["nombre"], "borrador": random.choice(CAPS)}))
                    except Exception as e:
                        debug_pantalla(pg, f"cotización N° {c['num']}: {e}")
                        print(f"  No pude terminar de mandar la cotización ({str(e).splitlines()[0]}).")
                        print(f"  Dejé el chat de {c['nombre']} como quedó (con el PDF en borrador si llegó a adjuntarse). Enviala vos si está lista.")
                        fallidas.add(c["id"])
                        with open(AQUI / "para_vos.txt", "a", encoding="utf-8") as f: f.write(f"{datetime.now():%d/%m %H:%M} | {c['nombre']} | +{c['conv']} | cotización N° {c['num']}: mandala vos (PDF Cotizacion_{c['num']}.pdf en la carpeta sender)\n")
                        input("  Cuando la hayas enviado (o si no querés), apretá Enter para seguir: ")
                        api("/enviar/cotizacion-enviada", {"id": c["id"]})
                        continue
                    api("/enviar/cotizacion-enviada", {"id": c["id"]}); enviados += 1; print("  Cotización enviada ✅")
                    if not dormir(random.randint(PAUSA_MIN, PAUSA_MAX)): break
                if not lista:
                    if not seguir: print("No quedan chats para contestar."); break
                    if not dormir(120): break
                    continue
                for it in lista:
                    if parar(): break
                    d = api("/enviar/redactar", {"conv": it["conv"]})
                    print(f"\n{it['nombre']} ({it['conv']}): {it['ultimo']}\n  → {d['accion']}: {d.get('mensaje') or d.get('motivo', '')}")
                    if d["accion"] == "humano": anotar_para_vos(it, d)
                    if d["accion"] != "responder": continue
                    try:
                        pg.goto(f"https://web.whatsapp.com/send?phone={it['conv']}")
                        try: pg.wait_for_selector(CAJA, timeout=45000)
                        except PWTimeout: print("  No abrió el chat (¿número sin WhatsApp?). Salto."); continue
                        lee = random.uniform(6, 14) + len(it["ultimo"]) * 0.05 + EXTRA_SEG
                        print(f"  leyendo {lee:.0f}s...")
                        if not dormir(lee): break
                        caja = pg.locator(CAJA).first   # se vuelve a buscar: WhatsApp redibuja la caja mientras "lee"
                        if caja.inner_text().strip(): print("  La caja ya tenía texto (¿lo estás escribiendo vos?). Salto."); continue
                        if not escribir(pg, caja, d["mensaje"]): break
                        time.sleep(random.uniform(1.0, 3.0)); caja.press("Enter"); time.sleep(3)
                        if pg.locator(CAJA).first.inner_text().strip(): print("  No se envió (la caja sigue con texto). Frenando por seguridad."); return
                    except Exception as e:
                        debug_pantalla(pg, f"chat {it['conv']}: {e}")
                        print(f"  Falló este chat ({str(e).splitlines()[0]}). Lo salto; queda en 'Responder ya' y se reintenta más tarde.")
                        try: api("/enviar/reintentar", {"conv": it["conv"]})
                        except Exception: pass
                        continue
                    api("/enviar/respondido", {"conv": it["conv"]}); enviados += 1; print("  Enviado ✅")
                    if not dormir(random.randint(PAUSA_MIN, PAUSA_MAX)): break
        except KeyboardInterrupt:
            print("\nCortado.")
        print(f"\nListo. Contestados: {enviados}")
        ctx.close()

if __name__ == "__main__":
    main()
