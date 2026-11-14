# Contestador de la PC (sender/responder.py): demora de 5 a 10 min antes de contestar y envío de las cotizaciones aprobadas por Telegram.
# Correr desde la raíz o desde cotizador/:  python ../tests/sim-demora.py
import os, shutil, sys, tempfile, time
from pathlib import Path
tmp = Path(tempfile.mkdtemp()) / "sender"   # copia de la carpeta con un .env de prueba (no toca el tuyo)
shutil.copytree(Path(__file__).resolve().parent.parent / "sender", tmp, ignore=shutil.ignore_patterns(".env", "perfil*", "cotizaciones"))
(tmp / ".env").write_text("PANEL_URL=https://x.test\nLECTOR_TOKEN=prueba\n", encoding="utf-8")
sys.path.insert(0, str(tmp))
os.environ.update(RESP_DEMORA_MIN="5", RESP_DEMORA_MAX="10", PANEL_URL="https://x.test", LECTOR_TOKEN="prueba")
ok = mal = 0
def chk(n, c):
    global ok, mal
    if c: ok += 1
    else: mal += 1; print("FALLA:", n)
from demora import Demora
d = Demora(5, 10, azar=lambda a, b: 7)   # siempre 7 min
ahora = 1_000_000_000_000
fresco = {"conv": "1", "ult_cliente_ts": ahora - 2 * 60e3}      # escribió hace 2 min
viejo = {"conv": "2", "ult_cliente_ts": ahora - 30 * 60e3}      # hace 30 min
listos, esperan, prox = d.separar([fresco, viejo], ahora)
chk("el que escribió hace 2 min espera; el de hace 30 se contesta ya", [x["conv"] for x in listos] == ["2"] and esperan == 1)
chk("dice cuánto falta para el próximo (5 min)", abs(prox - 300) < 1)
chk("pasada la espera, se contesta", d.separar([fresco], ahora + 6 * 60e3)[0] == [fresco])
d2 = Demora(5, 10)
s1 = d2.segundos(fresco); chk("la espera sorteada queda fija para ese mensaje", s1 == d2.segundos(fresco) and 300 <= s1 <= 600)
nuevo = dict(fresco, ult_cliente_ts=fresco["ult_cliente_ts"] + 60e3)
chk("si el cliente vuelve a escribir, la cuenta arranca de nuevo", d.separar([fresco], ahora + 5.5 * 60e3)[0] == [fresco] and d.separar([nuevo], ahora + 5.5 * 60e3)[1] == 1)
chk("0 y 0 la apaga", Demora(0, 0).separar([fresco], ahora)[0] == [fresco])
# El contestador con el panel simulado
import responder as R
R.DEMORA = Demora(5, 10, azar=lambda a, b: 7)
ahora_real = time.time() * 1000
R.api = lambda path, body=None: {"lista": [{"conv": "549111", "nombre": "Ana", "ult_cliente_ts": ahora_real - 60e3, "ultimo": "hola"}, {"conv": "549222", "nombre": "Juan", "ult_cliente_ts": ahora_real - 20 * 60e3, "ultimo": "precio?"}], "quedan": 2, "cotizaciones": []}
lista, cots = R.hay_pendientes()
chk("el contestador solo toma los que cumplieron su espera", [x["conv"] for x in lista] == ["549222"] and R.ESPERAN == 1 and 350 < R.PROXIMO < 370)
chk("los que esperan no frenan los seguimientos", R.QUEDAN == 1)
lista, _ = R.hay_pendientes(sin_demora=True)
chk("la vista previa muestra todos", len(lista) == 2 and R.ESPERAN == 0)
# Cotizaciones aprobadas por Telegram (✅ Mandala): la PC las manda como un mensaje con el link
import types
if "playwright" not in sys.modules:   # en la PC está instalado; acá alcanza con una versión de mentira
    pw = types.ModuleType("playwright"); pws = types.ModuleType("playwright.sync_api"); pws.TimeoutError = TimeoutError; pw.sync_api = pws
    sys.modules["playwright"], sys.modules["playwright.sync_api"] = pw, pws
R.api = lambda path, body=None: {"lista": [], "quedan": 0, "cotizaciones": [], "envios": [{"id": "abc", "conv": "549333", "nombre": "Ana", "texto": "Hola Ana! Ya tengo tu cotización: https://x/q/1\nCualquier duda me decís."}]}
R.hay_pendientes()
chk("la PC recibe las cotizaciones aprobadas", len(R.ENVIOS) == 1 and R.ENVIOS[0]["id"] == "abc")
R.api = lambda path, body=None: {"tope": True}
R.hay_pendientes()
chk("si el panel corta antes (tope por hora), no reusa la lista vieja", R.ENVIOS == [])
class Caja:
    def __init__(s, pg): s.pg = pg
    @property
    def first(s): return s
    @property
    def last(s): return s
    def inner_text(s): return s.pg.texto
    def click(s): pass
    def press(s, k):
        if k == "Enter": s.pg.enviados.append(s.pg.texto); s.pg.texto = ""
    def count(s): return 0
class Teclado:
    def __init__(s, pg): s.pg = pg
    def type(s, ch): s.pg.texto += ch
    def press(s, k):
        if k == "Shift+Enter": s.pg.texto += "\n"
        elif k == "Delete": s.pg.texto = ""
class Pagina:
    def __init__(s): s.texto, s.enviados, s.urls = "", [], []; s.keyboard = Teclado(s)
    def goto(s, u): s.urls.append(u)
    def wait_for_selector(s, sel, timeout=0): return True
    def locator(s, sel): return Caja(s)
llamadas = []
R.api = lambda path, body=None: llamadas.append((path, body)) or {"ok": True}
R.dormir = lambda seg, motivo="": True
R.time = types.SimpleNamespace(sleep=lambda x: None, time=time.time)
pg = Pagina(); fall = set()
e = {"id": "abc", "conv": "549333", "nombre": "Ana", "texto": "Hola Ana! Ya tengo tu cotización: https://x/q/1\nCualquier duda me decís."}
chk("manda la cotización aprobada", R.mandar_envio(pg, e, fall) is True and pg.enviados == [e["texto"]] and pg.urls == ["https://web.whatsapp.com/send?phone=549333"])
chk("avisa al panel que salió (y el panel avisa por Telegram)", llamadas[-1] == ("/enviar/envio-hecho", {"id": "abc"}))
pg2 = Pagina(); pg2.texto = "algo que estabas escribiendo"
chk("si la caja ya tenía texto, no pisa nada y avisa que la mandes vos", R.mandar_envio(pg2, e, fall) is False and pg2.enviados == [] and llamadas[-1][0] == "/enviar/envio-fallo" and "abc" in fall)
print(f"sim-demora: {ok} ok, {mal} fallas")
