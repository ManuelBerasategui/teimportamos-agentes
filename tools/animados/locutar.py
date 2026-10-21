# Graba la voz de cada frase con Piper (voz rioplatense es_AR-daniela, gratis y local) y anota cuánto dura cada una.
# Uso: python locutar.py carpeta (con lineas.json adentro) modelo.onnx [velocidad]
import json, subprocess, sys, wave
from pathlib import Path

d = Path(sys.argv[1]); modelo = sys.argv[2]; vel = sys.argv[3] if len(sys.argv) > 3 else "0.92"
tiempos = {}
for x in json.loads((d / "lineas.json").read_text()):
    wav = d / f"voz_{x['i']}.wav"
    subprocess.run(["piper", "--model", modelo, "--output_file", str(wav), "--length_scale", vel, "--sentence_silence", "0.1"], input=x["voz"].encode(), check=True, capture_output=True)
    with wave.open(str(wav)) as w: tiempos[x["i"]] = w.getnframes() / w.getframerate()
    print(f"escena {x['i']}: {tiempos[x['i']]:.2f} s · {x['voz']}")
(d / "tiempos.json").write_text(json.dumps(tiempos))
