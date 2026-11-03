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

EXTRA_SEG = int(os.environ.get("RESP_EXTRA_SEG", "2"))          # segundos de más "leyendo" antes de escribir
PAUSA_MIN = int(os.environ.get("RESP_PAUSA_MIN_SEG", "8"))      # pausa entre un chat y el siguiente
PAUSA_MAX = int(os.environ.get("RESP_PAUSA_MAX_SEG", "20"))
COTIZ_MODO = os.environ.get("COTIZ_MODO", "revisar")             # revisar (guarda el PDF para que lo mandes vos) | enviar (lo manda solo)
DIAS = int(os.environ.get("RESP_DIAS", "14"))                     # cuántos días para atrás mira chats sin responder (máx. 14)
SEGUIMIENTOS = os.environ.get("RESP_SEGUIMIENTOS", "1") == "1"   # sin chats para contestar, manda los seguimientos del panel
SEG_MAX = int(os.environ.get("RESP_SEG_MAX", "30"))              # tope de seguimientos por corrida
TECLEO = float(os.environ.get("RESP_TECLEO", "1"))                # velocidad de tipeo: 1 = normal, 0.6 = más rápido, 1.5 = más lento
VENTANA = os.environ.get("VENTANA", "oculta")                # minimizada | oculta | visible
CAJA = 'footer div[contenteditable="true"]'

def pausado():
    """Archivo PAUSA en esta carpeta = la ventana sigue abierta y conectada, pero no contesta ni manda nada."""
    return (AQUI / "PAUSA").exists()

def dormir(seg, motivo=""):
    fin, antes = time.time() + seg, pausado()
    while time.time() < fin:
        if parar(): return False
        if pausado() != antes: return True   # lo activaste o pausaste: reacciona enseguida, sin esperar
        time.sleep(min(1, max(0, fin - time.time())))
    return True

def esperar_si_pausado():
    """Si está en pausa, espera (con la ventana abierta) hasta que lo actives. Devuelve False si lo cortaste."""
    if not pausado(): return True
    print(f"\n{datetime.now():%H:%M} · ⏸  EN PAUSA: WhatsApp abierto, no contesto nada. Para activarlo: doble clic en activar.bat")
    while pausado():
        if not dormir(3600): return False
    print(f"{datetime.now():%H:%M} · ▶  ACTIVADO: vuelvo a contestar.")
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
        d = random.uniform(0.05, 0.14) * TECLEO
        if ch in ".,?!": d += random.uniform(0.1, 0.3) * TECLEO
        if random.random() < 0.02: d += random.uniform(0.3, 0.9) * TECLEO
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
    r = api(f"/enviar/responder?limite=10&desde={desde_ms()}&dias={DIAS}")
    if r.get("pausado"): print("⏸  Pausado desde el bot de Telegram. Escribí 'reanudar respuestas' para seguir."); return None
    global QUEDAN
    if r.get("tope"): print("Llegué al tope de respuestas por hora. Espero."); QUEDAN = 1; return [], []
    QUEDAN = r.get("quedan", len(r["lista"]))
    return r["lista"], r.get("cotizaciones", [])

QUEDAN = 0   # chats sin contestar que quedan en total (si hay, no se hacen seguimientos)

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

# Mira en WhatsApp Web (no en el panel) de quién es el último mensaje del chat abierto: True = del cliente,
# False = nuestro, None = no se pudo saber. El lector a veces no registra mensajes (por ejemplo si D1 estuvo caído).
JS_ULTIMO = """() => {
  const main = document.querySelector('#main'); if (!main) return null;
  // 1) La "colita" de la burbuja: cada tanda de mensajes de un mismo lado empieza con tail-in (cliente) o tail-out (nuestra)
  const t = [...main.querySelectorAll('[data-icon="tail-in"], [data-icon="tail-out"]')];
  if (t.length) return t[t.length - 1].getAttribute('data-icon') === 'tail-in';
  // 2) Versiones viejas: data-id true_/false_ o clases message-in / message-out
  const ids = [...main.querySelectorAll('[data-id]')].map(e => e.getAttribute('data-id')).filter(i => /^(true|false)_/.test(i));
  if (ids.length) return ids[ids.length - 1].startsWith('false_');
  const m = [...main.querySelectorAll('.message-in, .message-out')];
  return m.length ? m[m.length - 1].classList.contains('message-in') : null;
}"""

def ultimo_del_cliente(pg):
    for _ in range(8):   # los mensajes tardan un poco en dibujarse
        try:
            r = pg.evaluate(JS_ULTIMO)
            if r is not None: return r
        except Exception: pass
        time.sleep(1)
    return None

def _norm(t): return re.sub(r"\s+", " ", str(t or "")).strip()

def igual_a_lo_escrito(pg, texto):
    """La caja del chat abierto tiene exactamente lo que el agente escribió (si no, alguien tocó la ventana)."""
    try: return _norm(pg.locator(CAJA).first.inner_text()) == _norm(texto)
    except Exception: return False

def borrar_caja(pg):
    try: c = pg.locator(CAJA).first; c.click(); pg.keyboard.press("Control+A"); pg.keyboard.press("Delete")
    except Exception: pass

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

def mandar_seguimiento(pg, saltados):
    """Manda UN seguimiento del panel (si hay). Devuelve True si mandó. Si uno no corresponde pasa al siguiente.
    Los chats nuevos siempre tienen prioridad: después de cada seguimiento se vuelve a mirar si alguien escribió."""
    try: lista = [x for x in api("/enviar/lista?limite=20")["lista"] if x["conv"] not in saltados]
    except Exception as e: print(f"  No pude traer los seguimientos ({e})."); return False
    for s in lista:
        if parar() or pausado(): return False
        texto = variar(s)
        print(f"\nSeguimiento · {s['nombre']} ({s['conv']}): {texto}")
        try:
            pg.goto(f"https://web.whatsapp.com/send?phone={s['conv']}")
            try: pg.wait_for_selector(CAJA, timeout=45000)
            except PWTimeout: print("  No abrió el chat (¿número sin WhatsApp?). Lo salteo."); saltados.add(s["conv"]); continue
            if not dormir(random.uniform(2, 4)): return False
            if ultimo_del_cliente(pg) is True:   # el cliente escribió: eso se contesta como chat, no con un seguimiento
                print("  El cliente escribió último: no mando seguimiento (lo toma el contestador)."); saltados.add(s["conv"]); continue
            caja = pg.locator(CAJA).first
            if caja.inner_text().strip(): print("  La caja ya tenía texto. Lo salteo."); saltados.add(s["conv"]); continue
            if not escribir(pg, caja, texto): return False
            time.sleep(random.uniform(0.8, 2.0))
            if not igual_a_lo_escrito(pg, texto): borrar_caja(pg); print("  Alguien usó esta ventana mientras escribía: no lo mando."); saltados.add(s["conv"]); continue
            caja.press("Enter"); time.sleep(3)
            if pg.locator(CAJA).first.inner_text().strip(): print("  No se envió (la caja sigue con texto)."); saltados.add(s["conv"]); continue
        except Exception as e:
            debug_pantalla(pg, f"seguimiento {s['conv']}: {e}"); print(f"  Falló ({str(e).splitlines()[0]})."); saltados.add(s["conv"]); continue
        api("/enviar/hecho", {"conv": s["conv"]}); print("  Seguimiento enviado ✅"); return True
    return False

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
            if not esperar_si_pausado(): break
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
    global QUEDAN
    prueba, seguir = "--prueba" in sys.argv, "--seguir" in sys.argv
    if "--pausado" in sys.argv: (AQUI / "PAUSA").touch()   # abrir.bat: abre WhatsApp sin contestar
    if not prueba and not (H_DESDE <= datetime.now().hour < H_HASTA):
        if not seguir: sys.exit(f"Fuera de horario ({H_DESDE}:00 a {H_HASTA}:00). Cambialo en .env si querés.")
        print(f"Fuera de horario: arranco solo a las {H_DESDE}:00 (dejalo abierto).")
        while not (H_DESDE <= datetime.now().hour < H_HASTA):
            if not dormir(300): return
    if prueba:
        pend = hay_pendientes() or ([], [])
        lista, cots = pend
        for c in cots: print(f"\n- COTIZACIÓN N° {c['num']} lista para {c['nombre']} ({c['conv']}): total USD {c['total']} → se enviaría el PDF con un texto corto.")
        print(f"\n{QUEDAN} chats sin contestar en total; acá van los primeros {len(lista)} (vista previa, no se envía nada).")
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
        if VENTANA != "visible": print("La ventana del agente queda fuera de la pantalla: para usar WhatsApp vos, usá la app de escritorio o el celular.")
        pg.wait_for_selector('#pane-side', timeout=180000)
        enviados = 0; fallidas = set(); seg_enviados = 0; seg_saltados = set(); chats_saltados = set()   # los que fallaron se reintentan en la próxima corrida
        try:
            while not parar():
                if not esperar_si_pausado(): break
                if not (H_DESDE <= datetime.now().hour < H_HASTA):
                    if not seguir: print("Fuera de horario, termino."); break
                    print(f"{datetime.now():%H:%M} · fuera de horario: sigo a las {H_DESDE}:00.")
                    if not dormir(300): break
                    continue
                try: pend = hay_pendientes()
                except Exception as e:
                    print(f"{datetime.now():%H:%M} · no pude hablar con el panel ({str(e).splitlines()[0][:80]}). Reintento en 1 minuto.")
                    if not dormir(60): break
                    continue
                if pend is None:   # pausado desde Telegram: espera en vez de cerrarse
                    if not seguir: break
                    if not dormir(120): break
                    continue
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
                lista = [x for x in lista if x["conv"] not in chats_saltados]
                if not lista and QUEDAN <= len(chats_saltados): QUEDAN = 0   # solo quedan los que fallaron en esta corrida
                if not lista:
                    if QUEDAN: print(f"{datetime.now():%H:%M} · quedan {QUEDAN} chat(s) sin contestar (los está atendiendo otra PC o es el tope por hora). Espero antes de los seguimientos.")
                    if SEGUIMIENTOS and not QUEDAN and seg_enviados < SEG_MAX and mandar_seguimiento(pg, seg_saltados):
                        seg_enviados += 1
                        if not dormir(random.randint(PAUSA_MIN, PAUSA_MAX)): break
                        continue
                    if not seguir: print("No quedan chats para contestar."); break
                    print(f"{datetime.now():%H:%M} · nada para contestar" + (" ni seguimientos" if SEGUIMIENTOS else "") + ". Vuelvo a mirar en 2 minutos.")
                    if not dormir(120): break
                    continue
                print(f"\n{datetime.now():%H:%M} · quedan {QUEDAN} chat(s) sin contestar.")
                for it in lista:
                    if parar() or pausado(): break   # pausa: termina el mensaje que estaba escribiendo y frena antes del próximo
                    try: d = api("/enviar/redactar", {"conv": it["conv"]})
                    except Exception as e: print(f"  No pude pedir la respuesta de {it['conv']} ({str(e).splitlines()[0][:80]}). Sigo con otro."); chats_saltados.add(it["conv"]); continue
                    print(f"\n{it['nombre']} ({it['conv']}): {it['ultimo']}\n  → {d['accion']}: {d.get('mensaje') or d.get('motivo', '')}")
                    if d["accion"] == "humano": anotar_para_vos(it, d)
                    if d["accion"] != "responder": continue
                    try:
                        pg.goto(f"https://web.whatsapp.com/send?phone={it['conv']}")
                        try: pg.wait_for_selector(CAJA, timeout=45000)
                        except PWTimeout: print("  No abrió el chat (¿número sin WhatsApp?). Salto."); chats_saltados.add(it["conv"]); api("/enviar/reintentar", {"conv": it["conv"]}); continue
                        lee = random.uniform(2, 5) + len(it["ultimo"]) * 0.02 + EXTRA_SEG
                        print(f"  leyendo {lee:.0f}s...")
                        if not dormir(lee): break
                        cli = ultimo_del_cliente(pg)
                        if cli is False:
                            print("  En WhatsApp lo último ya es nuestro (el panel no lo tenía). No contesto.")
                            api("/enviar/atendido", {"conv": it["conv"]}); continue
                        if cli is None:
                            debug_pantalla(pg, f"no pude leer el último mensaje de {it['conv']}")
                            print("  No pude ver de quién es el último mensaje. Por seguridad no contesto; se reintenta más tarde.")
                            api("/enviar/reintentar", {"conv": it["conv"]}); chats_saltados.add(it["conv"]); continue
                        caja = pg.locator(CAJA).first   # se vuelve a buscar: WhatsApp redibuja la caja mientras "lee"
                        if caja.inner_text().strip(): print("  La caja ya tenía texto (¿lo estás escribiendo vos?). Salto."); api("/enviar/reintentar", {"conv": it["conv"]}); chats_saltados.add(it["conv"]); continue
                        if not escribir(pg, caja, d["mensaje"]): break
                        time.sleep(random.uniform(1.0, 3.0))
                        if not igual_a_lo_escrito(pg, d["mensaje"]):   # alguien tocó esta ventana mientras tipeaba (cambió de chat o escribió)
                            borrar_caja(pg); print("  Alguien usó esta ventana mientras escribía: borro lo mío, no lo mando y lo reintento después.")
                            api("/enviar/reintentar", {"conv": it["conv"]}); chats_saltados.add(it["conv"]); continue
                        if ultimo_del_cliente(pg) is False:   # mientras tipeaba le escribiste vos (por ejemplo le mandaste un PDF)
                            caja.click(); pg.keyboard.press("Control+A"); pg.keyboard.press("Delete")
                            print("  Mientras escribía le contestaste vos: borro lo mío y no lo mando."); api("/enviar/atendido", {"conv": it["conv"]}); continue
                        caja.press("Enter"); time.sleep(3)
                        if pg.locator(CAJA).first.inner_text().strip():
                            print("  No se envió (la caja sigue con texto). Lo salteo y sigo con el resto.")
                            debug_pantalla(pg, f"no se envió {it['conv']}"); api("/enviar/reintentar", {"conv": it["conv"]}); chats_saltados.add(it["conv"]); continue
                    except Exception as e:
                        debug_pantalla(pg, f"chat {it['conv']}: {e}")
                        print(f"  Falló este chat ({str(e).splitlines()[0]}). Lo salto; queda en 'Responder ya' y se reintenta más tarde.")
                        chats_saltados.add(it["conv"])
                        try: api("/enviar/reintentar", {"conv": it["conv"]})
                        except Exception: pass
                        continue
                    for _ in range(3):   # que quede marcado aunque el panel tarde (si no, la próxima vez igual ve que lo último es nuestro)
                        try: api("/enviar/respondido", {"conv": it["conv"]}); break
                        except Exception: time.sleep(5)
                    enviados += 1; print("  Enviado ✅")
                    if not dormir(random.randint(PAUSA_MIN, PAUSA_MAX)): break
        except KeyboardInterrupt:
            print("\nCortado.")
        print(f"\nListo. Contestados: {enviados}")
        try: ctx.close()
        except Exception: pass   # al cortar con Ctrl+C Windows ya cerró Chrome: no es un error

if __name__ == "__main__":
    while True:
        try:
            main(); break
        except KeyboardInterrupt:
            print("\nCortado."); break
        except Exception as e:
            if "--seguir" not in sys.argv or parar(): raise
            print(f"\n{datetime.now():%H:%M} · se cortó por un error ({str(e).splitlines()[0][:100]}). Reinicio solo en 30 s (Ctrl+C para salir)...")
            try: time.sleep(30)
            except KeyboardInterrupt: break
