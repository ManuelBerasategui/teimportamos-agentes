# Informes de proveedores (los arma la tarea programada de Claude)

El equipo encarga un informe en el panel (Búsquedas > "Encargar informe completo a Claude" o el botón "Encargar informe" de un chat del 805).
Queda en la tabla `informes` de la D1. Esta tarea lo toma, investiga y entrega el PDF + la planilla.

## Pasos de cada vuelta
**Importante:** WebFetch guarda copias 15 minutos. Agregá siempre `&t=<número al azar distinto>` al final de cada dirección.

1. Leer la cola con WebFetch: `https://cotizador.berasateguimanuel07.workers.dev/informes/cola?clave=CLAVE&t=NUMERO_AL_AZAR`
   - Si `pendientes` está vacío: terminar en silencio (no mandar nada).
   - Máximo 2 informes por vuelta.
2. Por cada informe: marcarlo con WebFetch `.../informes/tomar?clave=CLAVE&id=ID`.
3. Investigar con WebSearch / WebFetch, como un comprador profesional:
   - Solo los países pedidos (ar, py, br, cl, us, cn). **Nunca Europa.**
   - Proveedores reales: mayoristas, distribuidores, fábricas, liquidadores, tiendas con venta por mayor. Nada de blogs ni notas.
   - Cada dato (nombre, WhatsApp, teléfono, mail, mínimo, precio) tiene que salir de la página del proveedor. Si no está, poner "A consultar". **No inventar.**
   - **Nunca réplicas ni falsificaciones**, aunque el pedido diga "réplica": en ese caso buscar originales o productos sin marca equivalentes y aclararlo en "claves".
   - **Nunca vapers, tabaco, fármacos ni drogas.**
   - Apuntar a 10-25 proveedores, ordenados por país y por conveniencia. Marcar con "nota" cualquier señal de riesgo (mail gratuito, dice ser "autorizado" sin pruebas, etc.).
4. Armar el JSON con el formato de `informes/ejemplo.json` (campos de cada proveedor: pais con bandera, nombre, lugar, tipo, calidad, marcas, minimo, precio, desc, wa, tel, mail, web, nota).
   - `claves`: 2-4 frases con lo más importante para el cliente (dónde conviene comprar, mínimos, precios típicos).
5. Generar: `mkdir -p salida && cp datos.json salida/ && python3 informes/generar.py salida/datos.json salida && node informes/pdf.mjs salida`
   (si `node informes/pdf.mjs` falla por playwright: `npm i playwright` en una carpeta aparte y usar el Chromium que haya; el PDF es opcional, lo importante es el paso 6b)
6. Revisar el PDF (abrirlo como imagen con pdftoppm) y entregar el PDF y el .xlsx con SendUserFile, con un mensaje corto: cliente, producto y cantidad de proveedores.
7. **Subir al panel:** `python3 informes/subir.py salida ID CLAVE` imprime varias direcciones; abrí cada una con WebFetch en orden. La última tiene que responder `"completo":true`. Si alguna falla, repetila.
8. Marcar listo con WebFetch: `.../informes/listo?clave=CLAVE&id=ID&nota=N%20proveedores`
   - Si algo falla: `.../informes/error?clave=CLAVE&id=ID&nota=motivo` (vuelve a la cola).

Los informes llevan contactos completos (el cliente paga por el listado). Español rioplatense, sin guiones largos.
