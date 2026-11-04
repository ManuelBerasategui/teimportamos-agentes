"""Entrenamiento del contestador: ver qué aprendió, pedir rondas de práctica y enseñarle reglas (SOP).
Uso:  python entrenar.py                 -> muestra lo que aprendió (reglas, puntajes, estilo)
      python entrenar.py --ya [N]        -> pide N rondas de entrenamiento ahora (una por minuto; 3 si no ponés N)
      python entrenar.py --regla "texto" -> le enseña una regla tuya (queda fija: el entrenamiento nunca la borra)
      python entrenar.py --borrar N      -> saca la regla número N
      python entrenar.py --corregir 549... "qué tenía que hacer"  -> le corregís un chat: queda como caso de oro y el agente aprende de él
      python entrenar.py --corregir-desde correcciones.txt        -> carga varias (una por línea: numero | corrección)
      python entrenar.py --bien N        -> confirmás que la cotización N° N que armó el agente estaba bien (7 seguidas y las manda directo)
      python entrenar.py --mal N "motivo"-> estaba mal: la racha vuelve a 0, vuelve a guardarlas para revisar y aprende del error
Por la noche (4 AM) entrena solo con tus charlas reales: contesta sin ver tu respuesta, se compara y de los errores salen reglas
nuevas; una regla solo se queda si mejora el puntaje."""
import sys
from datetime import datetime
from enviar import api


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
    if "--regla" in a:
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
    elif "--ya" in a:
        i = a.index("--ya")
        n = int(a[i + 1]) if len(a) > i + 1 and a[i + 1].isdigit() else 3
        d = api("/enviar/entrenar", {"rondas": n})
        print(f"Listo: pedí {d.get('rondas')} ronda(s). Corren solas, una por minuto. Mirá el resultado con:  python entrenar.py")
    else:
        mostrar(api("/enviar/aprendizaje"))


if __name__ == "__main__":
    main()
