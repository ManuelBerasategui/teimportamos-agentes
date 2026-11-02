"""Contesta los mensajes de WhatsApp que esperan respuesta, escribiendo como una persona (WhatsApp Web, ventana propia).
Uso:  python responder.py --prueba   -> solo muestra qué contestaría a cada chat, NO abre WhatsApp ni envía nada
      python responder.py            -> contesta hasta que no queden pendientes y termina
      python responder.py --seguir   -> queda andando y revisa cada 2 minutos hasta que lo cortes
Para frenarlo: Ctrl+C, un archivo llamado STOP en esta carpeta, o escribirle al bot de Telegram "pausar respuestas"."""
import random, re, sys, time, urllib.parse
from datetime import datetime
from enviar import api, parar, AQUI, H_DESDE, H_HASTA, os
from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout

EXTRA_SEG = int(os.environ.get("RESP_EXTRA_SEG", "10"))          # segundos de más "leyendo" antes de escribir
PAUSA_MIN = int(os.environ.get("RESP_PAUSA_MIN_SEG", "25"))      # pausa entre un chat y el siguiente
PAUSA_MAX = int(os.environ.get("RESP_PAUSA_MAX_SEG", "70"))
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

def hay_pendientes():
    r = api("/enviar/responder?limite=10")
    if r.get("pausado"): print("⏸  Pausado desde el bot de Telegram. Escribí 'reanudar respuestas' para seguir."); return None
    if r.get("tope"): print("Llegué al tope de respuestas por hora. Espero."); return []
    return r["lista"]

def main():
    prueba, seguir = "--prueba" in sys.argv, "--seguir" in sys.argv
    if not prueba and not (H_DESDE <= datetime.now().hour < H_HASTA):
        sys.exit(f"Fuera de horario ({H_DESDE}:00 a {H_HASTA}:00). Cambialo en .env si querés.")
    if prueba:
        lista = hay_pendientes() or []
        print(f"{len(lista)} chats esperando respuesta (vista previa, no se envía nada).")
        for it in lista:
            d = api("/enviar/redactar", {"conv": it["conv"], "prueba": True})
            print(f"\n- {it['nombre']} ({it['conv']}) dijo: {it['ultimo']}\n  → {d['accion'].upper()}: {d.get('mensaje') or d.get('motivo', '')}" + (f"\n  PARA VOS: {d.get('resumen') or d.get('motivo', '')}" if d['accion'] == 'humano' else ""))
        return
    args = {"minimizada": ["--start-minimized"], "oculta": ["--window-position=-32000,-32000"]}.get(VENTANA, [])
    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(str(AQUI / "perfil"), headless=False, viewport={"width": 1200, "height": 800}, args=args)
        pg = ctx.pages[0] if ctx.pages else ctx.new_page()
        pg.goto("https://web.whatsapp.com")
        print("Si pide QR, escanealo con el celular (solo la primera vez). Esperando WhatsApp Web...")
        pg.wait_for_selector('#pane-side', timeout=180000)
        enviados = 0
        try:
            while not parar():
                if not (H_DESDE <= datetime.now().hour < H_HASTA): print("Fuera de horario, termino."); break
                lista = hay_pendientes()
                if lista is None: break
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
                    pg.goto(f"https://web.whatsapp.com/send?phone={it['conv']}")
                    try: caja = pg.wait_for_selector(CAJA, timeout=45000)
                    except PWTimeout: print("  No abrió el chat (¿número sin WhatsApp?). Salto."); continue
                    lee = random.uniform(6, 14) + len(it["ultimo"]) * 0.05 + EXTRA_SEG
                    print(f"  leyendo {lee:.0f}s...")
                    if not dormir(lee): break
                    if caja.inner_text().strip(): print("  La caja ya tenía texto (¿lo estás escribiendo vos?). Salto."); continue
                    if not escribir(pg, caja, d["mensaje"]): break
                    time.sleep(random.uniform(1.0, 3.0)); caja.press("Enter"); time.sleep(3)
                    if caja.inner_text().strip(): print("  No se envió (la caja sigue con texto). Frenando por seguridad."); return
                    api("/enviar/respondido", {"conv": it["conv"]}); enviados += 1; print("  Enviado ✅")
                    if not dormir(random.randint(PAUSA_MIN, PAUSA_MAX)): break
        except KeyboardInterrupt:
            print("\nCortado.")
        print(f"\nListo. Contestados: {enviados}")
        ctx.close()

if __name__ == "__main__":
    main()
