#!/usr/bin/env python3
"""
Editor automático de reels · Te Importamos
Lo corre GitHub Actions cada 10 minutos (.github/workflows/videos.yml). Si hay un lote de clips subido
desde el panel (Redes > Videos), lo baja, lo transcribe, corta silencios y tomas repetidas, arma el video
9:16 con subtítulos y el texto del gancho, y lo devuelve al panel para que lo apruebes. NO publica nada:
eso lo hace el worker de Instagram a las 19 h, solo con los videos aprobados.

Variables: TI_BASE (URL del panel), TI_CLAVE (la clave VERIFY_TOKEN, cargada como secret en GitHub).
Prueba local sin Whisper: python editar.py --prueba transcripcion.json clip1.mp4 [clip2.mp4 ...]
"""
import json, os, re, subprocess, sys, tempfile, time, urllib.request, urllib.error

BASE = os.environ.get("TI_BASE", "https://cotizador.berasateguimanuel07.workers.dev").rstrip("/")
CLAVE = os.environ.get("TI_CLAVE", "")
MODELO = os.environ.get("WHISPER_MODELO", "small")
ANCHO, ALTO, FPS = 1080, 1920, 30
PAUSA_CORTE = 0.35      # silencios más largos que esto se cortan (segundos)
MARGEN = 0.08           # aire antes y después de cada palabra
PAUSA_FRASE = 0.6       # pausa que separa una frase de otra (para detectar tomas repetidas)
NARANJA_ASS = "&H000C5BEA"   # #EA5B0C en formato ASS (AABBGGRR)


# ---------------------------------------------------------------- HTTP con el panel
def api(ruta, datos=None, metodo=None, cuerpo=None, tipo="application/json"):
    url = BASE + ruta
    if cuerpo is None and datos is not None:
        cuerpo = json.dumps(datos).encode()
    req = urllib.request.Request(url, data=cuerpo, method=metodo or ("POST" if cuerpo is not None else "GET"),
                                 headers={"x-clave": CLAVE, "Content-Type": tipo, "User-Agent": "ti-editor"})
    for intento in range(3):
        try:
            with urllib.request.urlopen(req, timeout=300) as r:
                return json.loads(r.read() or b"{}")
        except urllib.error.HTTPError as e:
            if e.code < 500 or intento == 2:
                raise RuntimeError(f"{ruta}: HTTP {e.code} {e.read()[:200]!r}")
        except urllib.error.URLError:
            if intento == 2:
                raise
        time.sleep(3 * (intento + 1))


def bajar(ruta, destino):
    req = urllib.request.Request(BASE + ruta, headers={"x-clave": CLAVE, "User-Agent": "ti-editor"})
    with urllib.request.urlopen(req, timeout=600) as r, open(destino, "wb") as f:
        while True:
            b = r.read(1 << 20)
            if not b:
                break
            f.write(b)


# ---------------------------------------------------------------- Transcripción
_modelo = None
def transcribir(archivo):
    global _modelo
    from faster_whisper import WhisperModel
    if _modelo is None:
        _modelo = WhisperModel(MODELO, device="cpu", compute_type="int8")
    segs, _ = _modelo.transcribe(archivo, language="es", word_timestamps=True, vad_filter=True,
                                 vad_parameters={"min_silence_duration_ms": 300}, beam_size=5)
    palabras = []
    for s in segs:
        for w in s.words or []:
            t = w.word.strip()
            if t:
                palabras.append({"w": t, "ini": round(w.start, 3), "fin": round(w.end, 3)})
    return palabras


def frases_de(palabras):
    """Agrupa palabras en frases cortadas por pausas largas o fin de oración."""
    frases, actual = [], []
    for i, p in enumerate(palabras):
        if actual and (p["ini"] - actual[-1]["fin"] > PAUSA_FRASE):
            frases.append(actual); actual = []
        actual.append(p)
        if re.search(r"[.!?…]$", p["w"]):
            frases.append(actual); actual = []
    if actual:
        frases.append(actual)
    return [{"i": i, "texto": " ".join(p["w"] for p in f), "ini": f[0]["ini"], "fin": f[-1]["fin"], "palabras": f} for i, f in enumerate(frases)]


def duracion(archivo):
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", archivo],
                         capture_output=True, text=True, check=True).stdout.strip()
    return float(out or 0)


# ---------------------------------------------------------------- Cortes
def tramos(palabras, dur):
    """Une palabras en tramos continuos; corta los silencios de más de PAUSA_CORTE."""
    out = []
    for p in palabras:
        a, b = max(0.0, p["ini"] - MARGEN), min(dur, p["fin"] + MARGEN)
        if out and a - out[-1][1] <= PAUSA_CORTE:
            out[-1][1] = max(out[-1][1], b)
        else:
            out.append([a, b])
    return [(round(a, 3), round(b, 3)) for a, b in out if b - a > 0.05]


def armar_linea_tiempo(partes):
    """partes: [(indice_input, palabras, dur)] → tramos [(input, a, b)] y palabras con el tiempo final del video."""
    lista, palabras_finales, t = [], [], 0.0
    for k, palabras, dur in partes:
        for a, b in tramos(palabras, dur):
            for p in palabras:
                if p["ini"] >= a - 1e-6 and p["fin"] <= b + 1e-6:
                    palabras_finales.append({"w": p["w"], "ini": round(t + p["ini"] - a, 3), "fin": round(t + p["fin"] - a, 3)})
            lista.append((k, a, b))
            t += b - a
    return lista, palabras_finales, round(t, 3)


# ---------------------------------------------------------------- Subtítulos (ASS)
def tiempo_ass(s):
    s = max(0.0, s)
    h, m = int(s // 3600), int(s % 3600 // 60)
    return f"{h}:{m:02d}:{s % 60:05.2f}"


def limpiar(t):
    return t.replace("{", "(").replace("}", ")").replace("\\", "").replace("\n", " ")


def grupos(palabras, max_palabras=3, max_letras=18):
    gs, g = [], []
    for p in palabras:
        largo = len(" ".join(x["w"] for x in g + [p]))
        if g and (len(g) >= max_palabras or largo > max_letras or p["ini"] - g[-1]["fin"] > 0.4):
            gs.append(g); g = []
        g.append(p)
    if g:
        gs.append(g)
    return gs


def ass(palabras, gancho, total):
    cab = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {ANCHO}
PlayResY: {ALTO}
WrapStyle: 2

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Sub,Montserrat,82,&H00FFFFFF,&H00FFFFFF,&H00000000,&H64000000,-1,0,0,0,100,100,0,0,1,7,2,2,80,80,620,1
Style: Gancho,Montserrat,76,&H00FFFFFF,&H00FFFFFF,&H00000000,&H64000000,-1,0,0,0,100,100,0,0,1,7,2,8,90,90,250,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    ev = []
    if gancho:
        ev.append(f"Dialogue: 1,{tiempo_ass(0)},{tiempo_ass(total)},Gancho,,0,0,0,,{limpiar(gancho)}")
    gs = grupos(palabras)
    for k, g in enumerate(gs):
        limite = gs[k + 1][0]["ini"] if k + 1 < len(gs) else total
        for j, p in enumerate(g):
            ini = p["ini"]
            fin = g[j + 1]["ini"] if j + 1 < len(g) else min(p["fin"] + 0.15, limite)
            texto = " ".join(("{\\c" + NARANJA_ASS + "&}" + limpiar(x["w"]) + "{\\c&H00FFFFFF&}") if x is p else limpiar(x["w"]) for x in g)
            ev.append(f"Dialogue: 0,{tiempo_ass(ini)},{tiempo_ass(min(fin, total))},Sub,,0,0,0,,{texto}")
    return cab + "\n".join(ev) + "\n"


# ---------------------------------------------------------------- Render
def render(entradas, lista, palabras, gancho, total, salida, dir_tmp):
    arch_ass = os.path.join(dir_tmp, "subs.ass")
    with open(arch_ass, "w", encoding="utf-8") as f:
        f.write(ass(palabras, gancho, total))
    filtros, pares = [], []
    for i, (k, a, b) in enumerate(lista):
        filtros.append(f"[{k}:v]trim={a}:{b},setpts=PTS-STARTPTS,scale={ANCHO}:{ALTO}:force_original_aspect_ratio=increase,crop={ANCHO}:{ALTO},fps={FPS},setsar=1[v{i}]")
        filtros.append(f"[{k}:a]atrim={a}:{b},asetpts=PTS-STARTPTS,aresample=48000[a{i}]")
        pares.append(f"[v{i}][a{i}]")
    filtros.append("".join(pares) + f"concat=n={len(lista)}:v=1:a=1[vc][ac]")
    ruta_ass = arch_ass.replace("\\", "/").replace(":", "\\:")
    filtros.append(f"[vc]ass='{ruta_ass}'[vo]")
    filtros.append("[ac]loudnorm=I=-14:TP=-1.5:LRA=11[ao]")
    cmd = ["ffmpeg", "-y", "-loglevel", "error"]
    for e in entradas:
        cmd += ["-i", e]
    cmd += ["-filter_complex", ";".join(filtros), "-map", "[vo]", "-map", "[ao]", "-c:v", "libx264", "-preset", "veryfast", "-crf", "21",
            "-pix_fmt", "yuv420p", "-profile:v", "high", "-c:a", "aac", "-b:a", "128k", "-ar", "48000", "-movflags", "+faststart", salida]
    subprocess.run(cmd, check=True)
    portada = salida.replace(".mp4", ".jpg")
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-ss", "0.4", "-i", salida, "-frames:v", "1", "-q:v", "3", "-vf", "scale=540:-2", portada], check=True)
    return portada


def armar_videos(clips, decision, dir_tmp):
    """clips: {n: {archivo, palabras, frases, dur}}; decision: respuesta de /videos/decidir."""
    mantener = {c["n"]: set(c.get("mantener") or []) for c in decision.get("clips", [])}
    hechos = []
    for j, v in enumerate(decision.get("videos", [])):
        entradas, partes = [], []
        for n in v["partes"]:
            c = clips[n]
            keep = mantener.get(n)
            frases = [f for f in c["frases"] if keep is None or f["i"] in keep] or c["frases"]
            pal = [p for f in frases for p in f["palabras"]]
            entradas.append(c["archivo"])
            partes.append((len(entradas) - 1, pal, c["dur"]))
        lista, palabras, total = armar_linea_tiempo(partes)
        if not lista:
            continue
        salida = os.path.join(dir_tmp, f"final-{j}.mp4")
        portada = render(entradas, lista, palabras, v.get("texto", ""), total, salida, dir_tmp)
        hechos.append({"j": j, "archivo": salida, "portada": portada, "duracion": total, "texto": v.get("texto", ""),
                       "caption": v.get("caption", ""), "transcripcion": " ".join(p["w"] for p in palabras)})
    return hechos


# ---------------------------------------------------------------- Un lote completo
def procesar(trabajo):
    lote = trabajo["lote"]
    with tempfile.TemporaryDirectory() as d:
        clips = {}
        for c in trabajo["clips"]:
            arch = os.path.join(d, f"clip{c['n']}{os.path.splitext(c.get('nombre') or '.mp4')[1] or '.mp4'}")
            bajar(c["url"], arch)
            pal = transcribir(arch)
            clips[c["n"]] = {"archivo": arch, "palabras": pal, "frases": frases_de(pal), "dur": duracion(arch), "tipo": c["tipo"]}
            print(f"clip {c['n']} ({c['tipo']}): {clips[c['n']]['dur']:.1f} s, {len(pal)} palabras")
        decision = api("/videos/decidir", {"lote": lote, "clips": [{"n": n, "tipo": c["tipo"], "dur": c["dur"],
                       "frases": [{"i": f["i"], "texto": f["texto"], "ini": f["ini"], "fin": f["fin"]} for f in c["frases"]]} for n, c in clips.items()]})
        hechos = armar_videos(clips, decision, d)
        if not hechos:
            raise RuntimeError("No quedó ningún video con voz (¿los clips tienen audio?)")
        salida = []
        for h in hechos:
            with open(h["archivo"], "rb") as f:
                k = api(f"/videos/resultado?lote={lote}&j={h['j']}&tipo=mp4", cuerpo=f.read(), metodo="PUT", tipo="video/mp4")["key"]
            with open(h["portada"], "rb") as f:
                kp = api(f"/videos/resultado?lote={lote}&j={h['j']}&tipo=jpg", cuerpo=f.read(), metodo="PUT", tipo="image/jpeg")["key"]
            salida.append({"key": k, "portada": kp, "bytes": os.path.getsize(h["archivo"]), "duracion": h["duracion"], "texto": h["texto"],
                           "caption": h["caption"], "transcripcion": h["transcripcion"]})
        api("/videos/fin", {"lote": lote, "videos": salida})
        print(f"lote {lote}: {len(salida)} videos listos para revisar")


def main():
    if len(sys.argv) > 2 and sys.argv[1] == "--prueba":   # prueba local sin Whisper ni panel
        trans = json.load(open(sys.argv[2]))
        d = tempfile.mkdtemp()
        clips = {}
        for n, arch in enumerate(sys.argv[3:]):
            pal = trans[str(n)]
            clips[n] = {"archivo": arch, "palabras": pal, "frases": frases_de(pal), "dur": duracion(arch)}
        dec = trans.get("decision") or {"clips": [], "videos": [{"partes": list(clips), "texto": "prueba de gancho", "caption": ""}]}
        for h in armar_videos(clips, dec, d):
            print(json.dumps({k: v for k, v in h.items() if k != "transcripcion"}))
        return
    if not CLAVE:
        sys.exit("Falta TI_CLAVE (secret de GitHub)")
    for _ in range(3):   # hasta 3 lotes por corrida
        t = api("/videos/trabajo", {})
        if not t.get("lote"):
            print("No hay lotes para editar.")
            return
        try:
            procesar(t)
        except Exception as e:
            print("Error en el lote", t["lote"], e)
            try:
                api("/videos/error", {"lote": t["lote"], "error": str(e)[:400]})
            except Exception:
                pass


if __name__ == "__main__":
    main()
