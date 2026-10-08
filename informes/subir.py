# Uso: python3 informes/subir.py carpeta_salida ID CLAVE  → imprime las direcciones (una por línea) que hay que abrir con WebFetch, en orden,
# para subir el informe al panel. Cada dirección lleva un número al azar para que no se use una copia guardada.
import sys, os, json, gzip, base64, random
out, iid, clave = sys.argv[1], sys.argv[2], sys.argv[3]
datos = json.load(open(os.path.join(out, "datos.json"))) if os.path.exists(os.path.join(out, "datos.json")) else None
html = open(os.path.join(out, "informe.html")).read()
b = base64.urlsafe_b64encode(gzip.compress(json.dumps({"html": html, "datos": datos}, ensure_ascii=False).encode())).decode().rstrip("=")
T = 3000; partes = [b[i:i + T] for i in range(0, len(b), T)]
base = "https://cotizador.berasateguimanuel07.workers.dev/informes/parte"
for i, p in enumerate(partes):
    print(f"{base}?clave={clave}&id={iid}&i={i}&n={len(partes)}&t={random.randint(1, 10**9)}&d={p}")
