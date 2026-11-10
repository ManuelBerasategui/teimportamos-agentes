"""Entrenamiento del contestador: ver qué aprendió, pedir rondas de práctica y enseñarle reglas (SOP).
Uso:  python entrenar.py                 -> muestra lo que aprendió (reglas, puntajes, estilo)
      python entrenar.py --intensivo [MIN] -> entrena sin parar MIN minutos (60 si no ponés nada) y muestra cómo va mejorando
      python entrenar.py --parar          -> frena el entrenamiento pedido
      python entrenar.py --ya [N]        -> pide N rondas de entrenamiento ahora (una por minuto; 3 si no ponés N)
      python entrenar.py --regla "texto" -> le enseña una regla tuya (queda fija: el entrenamiento nunca la borra)
      python entrenar.py --borrar N      -> saca la regla número N
      python entrenar.py --corregir 549... "qué tenía que hacer"  -> le corregís un chat: queda como caso de oro y el agente aprende de él
      python entrenar.py --corregir-desde correcciones.txt        -> carga varias (una por línea: numero | corrección)
      python entrenar.py --bien N        -> confirmás que la cotización N° N que armó el agente estaba bien (7 seguidas y las manda directo)
      python entrenar.py --mal N "motivo"-> estaba mal: la racha vuelve a 0, vuelve a guardarlas para revisar y aprende del error
      python entrenar.py --pautas-seg archivo.json -> carga las pautas de SEGUIMIENTOS que exportaste del sandbox (reemplaza las anteriores)
      python entrenar.py --pautas-seg    -> muestra las pautas de seguimientos cargadas;  --pautas-seg --borrar las saca
Por la noche (4 AM) entrena solo con tus charlas reales: contesta sin ver tu respuesta, se compara y de los errores salen reglas
nuevas; una regla solo se queda si mejora el puntaje."""
import json, sys, time
from datetime import datetime
from enviar import api

# Situaciones del sandbox de seguimientos (sender/sandbox.html)
SITUACIONES_SANDBOX = {"precio": "le parecio caro", "cantidad": "quiere arrancar con menos unidades", "plazo": "lo frena el plazo",
                       "decision": "lo decide con otra persona", "silencio": "vio la cotizacion y no contesto",
                       "lista": "le pasamos lista de precios y no eligio", "info": "le pasamos info de productos y no avanzo"}
VARIABLES = {"{{nombre}}": "[nombre]", "{{producto}}": "[producto]", "{{cantidad}}": "[cantidad]", "{{total}}": "[total]"}


def pautas_desde_sandbox(ruta):
    """Lee el JSON exportado del sandbox y arma las pautas (situación, pauta, ejemplo) para el worker."""
    try:
        d = json.load(open(ruta, encoding="utf-8-sig"))
    except FileNotFoundError:
        sys.exit(f"No encuentro el archivo: {ruta}")
    except ValueError:
        sys.exit("Ese archivo no es un JSON válido.")
    if not isinstance(d, dict) or not isinstance(d.get("training"), dict):
        sys.exit("Ese archivo no es un entrenamiento exportado del sandbox (falta 'training').")
    pautas = []
    for sit, r in d["training"].items():
        if not isinstance(r, dict) or sit not in SITUACIONES_SANDBOX:
            continue
        pauta, ej = str(r.get("instruction") or "").strip(), str(r.get("example") or "").strip()
        for k, v in VARIABLES.items():
            ej = ej.replace(k, v)
        if len(pauta) >= 12:
            pautas.append({"situacion": SITUACIONES_SANDBOX[sit], "pauta": pauta, "ejemplo": ej})
    if not pautas:
        sys.exit("El archivo no trae pautas con instrucción escrita.")
    return pautas


def mostrar_pautas(d):
    ps = d.get("pautas") or []
    print(f"\nPautas de seguimientos ({len(ps)})" + (f", cargadas {fecha(d.get('ts'))}:" if ps else ": ninguna."))
    for i, p in enumerate(ps, 1):
        print(f"  {i}. [{p.get('situacion')}] {p.get('pauta')}" + (f"\n     tono: {p.get('ejemplo')}" if p.get("ejemplo") else ""))


def fecha(ms):
    return datetime.fromtimestamp(ms / 1000).strftime("%d/%m %H:%M") if ms else "-"


def mostrar(d):
    print("\n=== LO QUE APRENDIÓ EL CONTESTADOR ===")
    e = d.get("estilo")
    if e:
        print(f"\nTu estilo (de {e.get('n', 0)} mensajes tuyos, {e.get('pares', 0)} charlas guardadas como ejemplo): "
              f"largo típico {e.get('med')} caracteres, {e.get('saludo')}% saludan, {e.get('emoji')}% con emoji. Calculado {fecha(e.get('ts'))}")
    else:
        print("\nTodavía no calculó tu estilo (lo hace de noche o con --ya).")
    ag = (d.get("ia") or {}).get("agotados") or []
    print(f"\nGemini (la IA): " + (f"{len(ag)} modelo(s) SIN CUPO ahora: {', '.join(ag)}. Mientras eso pase el agente deriva todo con 'la IA no pudo decidir'." if ag else "con cupo."))
    if d.get("guia"):
        print(f"\nCriterio que el entrenador escribió (versión {d.get('versionesGuia', 1)}):\n  {d['guia']}")
    rs = d.get("reglas") or []
    print(f"\nReglas ({len(rs)}):")
    for i, r in enumerate(rs, 1):
        print(f"  {i}. [{'tuya' if r.get('fuente') == 'manual' else 'aprendida'}] {r.get('r')}")
    if not rs:
        print("  (ninguna todavía)")
    h = d.get("hist") or []
    if h:
        print("\nPuntaje de cada ronda de entrenamiento (de 10):")
        for x in h:
            print(f"  {fecha(x.get('ts'))}: {x.get('score')} con {x.get('n')} casos, reglas adoptadas {x.get('adoptadas')}, descartadas {x.get('descartadas')}")
    u = d.get("ultimo")
    if u:
        print(f"\nÚltima ronda: puntaje {u.get('score')}, {u.get('casos')} casos, {u.get('malos')} con errores.")
        for r in u.get("adoptadas") or []:
            print(f"  + regla nueva: {r}")
        for r in u.get("descartadas") or []:
            print(f"  - descartada (no mejoraba): {r}")
    if d.get("derivacion"):
        print(f"\nDerivados a vos: {d['derivacion']['pct']}% de las últimas {d['derivacion']['de']} decisiones (cuanto menos, mejor, siempre que no conteste mal). Correcciones tuyas guardadas: {d.get('correcciones', 0)}")
    cq = d.get("cotizaciones")
    if cq:
        print(f"\nCotizaciones: {cq.get('racha')} de {cq.get('meta')} bien seguidas. " + ("MANDA DIRECTO." if cq.get("directo") else "Todavía las guarda para revisar."))
    print(f"\nErrores de producción esperando revisión: {d.get('erroresPendientes', 0)}. Rondas pedidas pendientes: {d.get('pedido', 0)}")
    cs = d.get("ultimosCasos") or []
    if cs:
        print("\nÚltimas decisiones:")
        for c in cs[-8:]:
            j = c.get("juez") or {}
            print(f"  {fecha(c.get('ts'))} {c.get('accion')}" + (f" (juez {j.get('puntaje')})" if j.get("puntaje") is not None else "") + (f": {c.get('mensaje')}" if c.get("mensaje") else ""))


def main():
    a = sys.argv[1:]
    if "--pautas-seg" in a:
        i = a.index("--pautas-seg")
        if "--borrar" in a:
            mostrar_pautas(api("/enviar/pautas-seg", {"pautas": []})); print("Listo: saqué las pautas de seguimientos.")
        elif len(a) > i + 1:
            d = api("/enviar/pautas-seg", {"pautas": pautas_desde_sandbox(a[i + 1])})
            mostrar_pautas(d)
            print("\nListo. La IA las usa al escribir los próximos seguimientos (los borradores ya hechos se rehacen solos en hasta 2 días).")
        else:
            mostrar_pautas(api("/enviar/pautas-seg"))
    elif "--regla" in a:
        txt = " ".join(a[a.index("--regla") + 1:]).strip()
        if len(txt) < 9:
            sys.exit("Escribí la regla completa entre comillas.")
        mostrar(api("/enviar/aprendizaje", {"agregar": txt}))
    elif "--borrar" in a:
        mostrar(api("/enviar/aprendizaje", {"borrar": int(a[a.index("--borrar") + 1]) - 1}))
    elif "--corregir-desde" in a:
        ruta = a[a.index("--corregir-desde") + 1]
        n = 0
        for linea in open(ruta, encoding="utf-8-sig"):
            if "|" not in linea or linea.lstrip().startswith("#"):
                continue
            conv, txt = linea.split("|", 1)
            try:
                api("/enviar/corregir", {"conv": conv.strip(), "correccion": txt.strip()}); n += 1; print(f"  cargada: {conv.strip()}")
            except Exception as e:
                print(f"  NO se pudo cargar {conv.strip()}: {e}")
        print(f"Listo: {n} corrección(es). El agente las practica en el próximo minuto; mirá el resultado con: python entrenar.py")
    elif "--corregir" in a:
        i = a.index("--corregir")
        if len(a) < i + 3:
            sys.exit('Falta algo. Ej: entrenar.bat --corregir 5493886823863 "tenía que preguntarle la cantidad"')
        d = api("/enviar/corregir", {"conv": a[i + 1], "correccion": " ".join(a[i + 2:])})
        print(f"Listo: corrección guardada ({d.get('total')} en total). El agente la practica {d.get('practica')}.")
    elif "--bien" in a or "--mal" in a:
        bien = "--bien" in a
        i = a.index("--bien" if bien else "--mal")
        if len(a) <= i + 1 or not a[i + 1].isdigit():
            sys.exit("Falta el número de cotización. Ej: entrenar.bat --bien 12")
        d = api("/enviar/cotizacion-revisada", {"num": int(a[i + 1]), "bien": bien, "motivo": " ".join(a[i + 2:])})
        if d.get("ya"):
            print("Esa cotización ya la habías marcado.")
        if d.get("directo"):
            print(f"Racha: {d['racha']} seguidas bien. El agente YA manda las cotizaciones directo. Si alguna sale mal: entrenar.bat --mal N \"motivo\" y vuelve a guardarlas para revisar.")
        else:
            print(f"Racha: {d['racha']} de {d['meta']} cotizaciones seguidas bien. " + (f"Faltan {d['faltan']} para que las mande directo." if bien else "Vuelve el modo revisión; el error quedó anotado para que aprenda."))
    elif "--parar" in a:
        api("/enviar/entrenar", {"rondas": 0}); print("Listo: frené el entrenamiento.")
    elif "--intensivo" in a:
        i = a.index("--intensivo")
        mins = int(a[i + 1]) if len(a) > i + 1 and a[i + 1].isdigit() else 60
        d = api("/enviar/entrenar", {"rondas": mins})
        print(f"Entrenamiento intensivo: {d.get('rondas')} rondas, una por minuto (no hace falta tener WhatsApp abierto).")
        print("Cada ronda: toma charlas reales tuyas, el agente contesta SIN ver tu respuesta (con el mismo circuito que en vivo),")
        print("un juez compara, y de los errores salen reglas que solo se quedan si mejoran el puntaje. Ctrl+C deja de mirar (sigue solo).\n")
        visto, vistoN, fin = None, None, time.time() + mins * 60 + 180
        try:
            while time.time() < fin:
                time.sleep(60)
                try:
                    d = api("/enviar/aprendizaje")
                except Exception as e:
                    print(f"  (no pude consultar: {e})"); continue
                u = d.get("ultimo") or {}
                if u.get("ts") and u.get("ts") != visto:
                    visto = u["ts"]
                    extra = "".join(f"\n      + regla nueva: {r}" for r in u.get("adoptadas") or []) + "".join(f"\n      - descartada: {r}" for r in u.get("descartadas") or [])
                    print(f"  {fecha(u['ts'])}  puntaje {u.get('score')}/10 en {u.get('casos')} casos, {u.get('malos')} con errores, derivó {u.get('derivados', '-')}{extra}" + (f"\n      + criterio nuevo (mejora {u['guiaNueva'].get('mejora')})" if u.get("guiaNueva") else ""))
                if (d.get("nota") or {}).get("ts") and d["nota"]["ts"] != vistoN:
                    vistoN = d["nota"]["ts"]; print(f"  {fecha(vistoN)}  {d['nota']['nota']}")
                if not d.get("pedido"):
                    break
        except KeyboardInterrupt:
            print("\nDejé de mirar; el entrenamiento sigue en el servidor. Para frenarlo: python entrenar.py --parar")
        mostrar(api("/enviar/aprendizaje"))
    elif "--ya" in a:
        i = a.index("--ya")
        n = int(a[i + 1]) if len(a) > i + 1 and a[i + 1].isdigit() else 3
        d = api("/enviar/entrenar", {"rondas": n})
        print(f"Listo: pedí {d.get('rondas')} ronda(s). Corren solas, una por minuto. Mirá el resultado con:  python entrenar.py")
    else:
        mostrar(api("/enviar/aprendizaje"))


if __name__ == "__main__":
    main()
