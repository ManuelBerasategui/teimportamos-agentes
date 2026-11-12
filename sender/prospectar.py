"""Prospección por WhatsApp: le escribe un primer mensaje distinto a cada negocio de la planilla prospectos.csv.
Uso:  python prospectar.py --prueba   -> arma los mensajes que falten (IA, según el rubro) y los guarda en la planilla para que los revises. NO abre WhatsApp.
      python prospectar.py            -> manda los mensajes de la planilla, como una persona, con tope por día y pausas largas.
La planilla (prospectos.csv, se abre con Excel) lleva estas columnas: telefono, negocio, rubro, ciudad, nota, mensaje, estado.
  - telefono con código de país, sin + ni espacios (ej. 5493411234567). No hace falta agendar el contacto.
  - mensaje: si está vacío lo escribe la IA en --prueba; si lo escribís o corregís vos, se manda tal cual.
  - estado: lo completa el programa (enviado DD/MM HH:MM, sin whatsapp, ya hablamos). Las filas con estado no se vuelven a mandar.
Antes de usarlo cerrá responder.py (usan la misma ventana de WhatsApp). Para frenarlo: Ctrl+C, o un archivo STOP o PAUSA en esta carpeta."""
import csv, random, sys, time
from datetime import datetime
from enviar import api, parar, AQUI, os
from responder import escribir, dormir, pausado, igual_a_lo_escrito, borrar_caja, debug_pantalla, CAJA, VENTANA

PLANILLA = AQUI / os.environ.get("PROSP_ARCHIVO", "prospectos.csv")
POR_DIA = int(os.environ.get("PROSP_POR_DIA", "20"))                 # tope por día (WhatsApp penaliza los envíos masivos a desconocidos)
PAUSA_MIN = int(os.environ.get("PROSP_PAUSA_MIN", "240"))            # segundos entre un mensaje y el siguiente (4 a 8 minutos: 20 en unas 2 horas)
PAUSA_MAX = int(os.environ.get("PROSP_PAUSA_MAX", "480"))
H_DESDE, H_HASTA = int(os.environ.get("PROSP_HORA_DESDE", "10")), int(os.environ.get("PROSP_HORA_HASTA", "19"))   # horario comercial
PERFIL = AQUI / os.environ.get("PROSP_PERFIL", "perfil")             # otra carpeta = otra sesión de WhatsApp (otro número)
COLS = ["telefono", "negocio", "rubro", "ciudad", "nota", "mensaje", "estado", "respuesta", "temperatura", "recontacto", "proximo_mensaje", "revisado"]

def leer():
    if not PLANILLA.exists():
        with open(PLANILLA, "w", newline="", encoding="utf-8-sig") as f: csv.writer(f, delimiter=";").writerow(COLS)
        sys.exit(f"Creé la planilla vacía {PLANILLA.name}: completala (una fila por negocio) y volvé a correrlo.")
    texto = PLANILLA.read_text(encoding="utf-8-sig")
    sep = ";" if texto.split("\n", 1)[0].count(";") >= texto.split("\n", 1)[0].count(",") else ","
    filas = [{k.strip().lower(): (v or "").strip() for k, v in r.items() if k} for r in csv.DictReader(texto.splitlines(), delimiter=sep)]
    for r in filas:
        r["telefono"] = "".join(ch for ch in r.get("telefono", "") if ch.isdigit())
        for c in COLS: r.setdefault(c, "")
        if r["estado"] in ("ya hablamos", "sin whatsapp"): r["estado"] = ""   # marcas de la primera versión (fallaba al detectar el chat): se reintentan
    return filas

def guardar(filas):
    with open(PLANILLA, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=COLS, delimiter=";", extrasaction="ignore"); w.writeheader(); w.writerows(filas)

def enviados_hoy(filas):
    hoy = datetime.now().strftime("%d/%m")
    return sum(1 for r in filas if r["estado"].startswith("enviado " + hoy))

def armar_mensajes(filas):
    faltan = [r for r in filas if r["telefono"] and not r["mensaje"] and not r["estado"]]
    for i in range(0, len(faltan), 10):
        parte = faltan[i:i + 10]
        try: res = api("/enviar/prospectos", {"negocios": parte}).get("mensajes", [])
        except Exception as e: print(f"No pude pedir los mensajes a la IA ({e})."); return
        for m in res:
            if 1 <= m["n"] <= len(parte): parte[m["n"] - 1]["mensaje"] = m["mensaje"]
        guardar(filas)
    sin = [r for r in faltan if not r["mensaje"]]
    if sin: print(f"\n{len(sin)} negocios quedaron sin mensaje (la IA no respondió, probablemente sin cupo). Escribilos vos en la planilla o probá más tarde.")

def chat_con_historia(pg):
    """True si ya hay mensajes en ese chat (es alguien con quien ya hablamos: no se le manda prospección)."""
    try: return pg.evaluate("() => document.querySelectorAll('#main .message-in, #main .message-out, #main [data-icon=tail-in], #main [data-icon=tail-out]').length") > 0
    except Exception: return False

JS_CHARLA = """() => [...document.querySelectorAll('#main .message-in, #main .message-out')].slice(-12).map(m => {
  const c = m.querySelector('.copyable-text'), t = m.querySelector('.selectable-text');
  return { yo: m.classList.contains('message-out'), cuando: (c && c.getAttribute('data-pre-plain-text') || '').replace(/\\].*$/, '').replace('[', ''), texto: t ? t.innerText : (m.querySelector('img') ? '(foto)' : '(audio o archivo)') };
})"""

def revisar(filas, pg, PWTimeout):
    """Entra SOLO a los chats de los negocios de la planilla a los que ya les mandamos, lee la charla y (si hay IA) arma estado, fecha de recontacto y próximo mensaje."""
    lista = [r for r in filas if r["estado"].startswith("enviado")]
    print(f"Reviso {len(lista)} chats de la planilla (no entro a ningún otro chat).")
    cambios = []
    for r in lista:
        if parar(): break
        try:
            pg.goto(f"https://web.whatsapp.com/send?phone={r['telefono']}")
            pg.wait_for_selector(CAJA, timeout=45000)
            if not dormir(random.uniform(3, 5)): return
            charla = pg.evaluate(JS_CHARLA)
        except PWTimeout: continue
        except Exception as e: print(f"  {r['negocio']}: no pude leer ({str(e).splitlines()[0]})"); continue
        resp = [m for m in charla if not m["yo"]]
        if not resp: continue
        ult = " | ".join(m["texto"] for m in resp[-3:])[:400]
        if ult == r["respuesta"]: continue
        r["respuesta"], r["revisado"] = ult, datetime.now().strftime("%d/%m %H:%M")
        print(f"\n{r['negocio']} (+{r['telefono']}) respondió: {ult}")
        cambios.append((r, charla)); guardar(filas)
    for i in range(0, len(cambios), 8):
        parte = cambios[i:i + 8]
        try: res = api("/enviar/prospecto-respuesta", {"hoy": datetime.now().strftime("%Y-%m-%d"), "chats": [{"negocio": r["negocio"], "rubro": r["rubro"], "charla": c} for r, c in parte]}).get("chats", [])
        except Exception as e: print(f"\nNo pude pedirle a la IA el estado y el próximo mensaje ({e}). Las respuestas quedaron guardadas igual."); break
        for x in res:
            if 1 <= x.get("n", 0) <= len(parte):
                r = parte[x["n"] - 1][0]
                r["temperatura"], r["recontacto"], r["proximo_mensaje"] = x.get("temperatura", ""), x.get("recontacto", ""), x.get("proximo_mensaje", "")
                print(f"  {r['negocio']}: {r['temperatura']} · recontacto {r['recontacto'] or '-'}\n    {r['proximo_mensaje']}")
        guardar(filas)
    hoy = datetime.now().strftime("%Y-%m-%d")
    toca = [r for r in filas if r["recontacto"] and r["recontacto"] <= hoy]
    print(f"\nListo. {len(cambios)} respuestas nuevas. Para recontactar hoy o atrasados: {len(toca)}")
    for r in toca: print(f"  - {r['negocio']} (+{r['telefono']}) [{r['temperatura']}]: {r['proximo_mensaje']}")
    print(f"\nTodo quedó en {PLANILLA.name} (columnas respuesta, temperatura, recontacto y proximo_mensaje).")

def main():
    filas = leer()
    if "--prueba" in sys.argv:
        armar_mensajes(filas)
        pend = [r for r in filas if r["telefono"] and not r["estado"]]
        print(f"\nPlanilla: {len(filas)} negocios · {len(pend)} pendientes · tope {POR_DIA} por día. NO se abrió WhatsApp ni se mandó nada.")
        for r in pend[:30]: print(f"\n- {r['negocio'] or '?'} ({r['rubro'] or '?'}) +{r['telefono']}\n  {r['mensaje'] or '(sin mensaje)'}")
        print(f"\nLos mensajes quedaron guardados en {PLANILLA.name}: abrila con Excel, corregí lo que quieras y después corré prospectar.bat sin --prueba.")
        return
    modo_revisar = "--revisar" in sys.argv
    pend = [r for r in filas if r["telefono"] and r["mensaje"] and not r["estado"]]
    if not pend and not modo_revisar and "--todo" not in sys.argv: sys.exit("No hay negocios pendientes con mensaje. Corré primero: prospectar.bat --prueba")
    from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout
    args = {"minimizada": ["--start-minimized", "--window-size=1280,800"], "oculta": ["--window-position=-32000,-32000", "--window-size=1280,800"]}.get(VENTANA, ["--start-maximized"])
    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(str(PERFIL), headless=False, no_viewport=True, args=args)
        pg = ctx.pages[0] if ctx.pages else ctx.new_page()
        pg.goto("https://web.whatsapp.com")
        print("Esperando WhatsApp Web (si pide QR, escanealo con el celular)...")
        pg.wait_for_selector("#pane-side", timeout=180000)
        if modo_revisar or "--todo" in sys.argv: revisar(filas, pg, PWTimeout)   # --todo: primero mira las respuestas y después manda los nuevos
        if modo_revisar: ctx.close(); return
        if not pend: print("No quedan negocios nuevos en la planilla para mandar."); ctx.close(); return
        print(f"\nAhora mando los mensajes nuevos (hasta {POR_DIA} por día).")
        for r in pend:
            if parar() or pausado(): print("Frenado (STOP o PAUSA)."); break
            if enviados_hoy(filas) >= POR_DIA: print(f"Llegué al tope de {POR_DIA} por hoy. Mañana sigo con los que quedan."); break
            while not (H_DESDE <= datetime.now().hour < H_HASTA):
                print(f"{datetime.now():%H:%M} · fuera del horario comercial ({H_DESDE} a {H_HASTA} h): espero.")
                if not dormir(600): return
            print(f"\n{datetime.now():%H:%M} · {r['negocio'] or '?'} (+{r['telefono']})\n  {r['mensaje']}")
            try:
                pg.goto(f"https://web.whatsapp.com/send?phone={r['telefono']}")
                try: pg.wait_for_selector(CAJA, timeout=45000)
                except PWTimeout:
                    r["estado"] = "sin whatsapp (v2)"; guardar(filas); print("  Ese número no tiene WhatsApp. Lo marco y sigo."); continue
                if not dormir(random.uniform(3, 6)): return
                if chat_con_historia(pg):
                    r["estado"] = "ya hablamos (v2)"; guardar(filas); print("  Ya hay mensajes con este número: no le mando prospección."); continue
                caja = pg.locator(CAJA).first
                if caja.inner_text().strip(): borrar_caja(pg)
                if not escribir(pg, caja, r["mensaje"]): return
                time.sleep(random.uniform(1, 2.5))
                if not igual_a_lo_escrito(pg, r["mensaje"]): borrar_caja(pg); print("  Alguien tocó la ventana mientras escribía: no lo mando."); continue
                caja.press("Enter"); time.sleep(3)
                if pg.locator(CAJA).first.inner_text().strip(): print("  No se envió (la caja sigue con texto)."); continue
                r["estado"] = f"enviado {datetime.now():%d/%m %H:%M}"; guardar(filas)
                print(f"  Enviado ✅  ({enviados_hoy(filas)}/{POR_DIA} hoy)")
            except Exception as e:
                debug_pantalla(pg, f"prospecto {r['telefono']}: {e}"); print(f"  Falló ({str(e).splitlines()[0]}). Sigo con el próximo."); continue
            espera = random.uniform(PAUSA_MIN, PAUSA_MAX)
            print(f"  Próximo en {espera / 60:.0f} minutos.")
            if not dormir(espera): break
        ctx.close()

if __name__ == "__main__":
    main()
