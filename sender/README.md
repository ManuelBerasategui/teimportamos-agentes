# Agente de WhatsApp y seguimientos (PC)

responder.py unifica respuestas y seguimientos comerciales. Los borradores se personalizan con la conversación; al enviar, el agente confirma en WhatsApp Web que el último mensaje sea nuestro y tipea el texto letra por letra.

La primera revisión de borradores se hace en modo seguro: no abre WhatsApp, no envía y no marca chats como enviados. Los envíos automáticos comerciales antiguos del Worker quedaron desactivados en el código.
## Instalación (una vez)
1. Instalá Python (python.org, tildar "Add to PATH").
2. Doble clic en `instalar.bat`.
3. Copiá `.env.example` como `.env` y completá `PANEL_URL` y `LECTOR_TOKEN` (el mismo del lector). El token queda solo en tu PC.

## Uso seguro y paso a paso
1. Instalá Python (python.org, marcá Add to PATH) y ejecutá instalar.bat.
2. Copiá .env.example como .env y el PANEL_URL ya está cargado y solo completá LECTOR_TOKEN. El token queda solo en esta PC.
3. Con el Worker actualizado y el lector sincronizado, ejecutá desde esta carpeta:

   python responder.py --prueba --solo-seguimientos

   Esto pide una sola vista previa autenticada, refresca hasta 10 borradores y muestra los textos reales. No abre WhatsApp, no envía y no marca chats como enviados. También podés hacer doble clic en previsualizar_seguimientos.bat.
4. Revisá cada borrador. Para ver también la cola de respuestas, usá python responder.py --prueba; esa opción consulta además los chats que esperan respuesta.
5. python enviar.py también deriva al agente unificado y por defecto muestra vista previa.

Para pausar el agente, conservá el archivo PAUSA. Para frenar una corrida, Ctrl+C o crear STOP. El envío de seguimientos desde WhatsApp Web requiere quitar PAUSA y ejecutar expresamente el agente; no uses activar.bat antes de revisar la vista previa.

## Envío de seguimientos
python responder.py --solo-seguimientos procesa únicamente seguimientos revisados por IA que no requieran intervención del dueño. Usa WhatsApp Web y respeta PAUSA; no ejecutar hasta haber revisado los borradores reales. Cada mensaje se marca como enviado solo después de que WhatsApp Web confirma la escritura.
## Usar la app de escritorio de WhatsApp (sin Chrome ni QR)
`python enviar.py --escritorio` (agregá `--auto` para que no pida confirmación). Usa la app que ya tenés abierta con sesión: abre cada chat con el mensaje puesto y aprieta Enter.
Necesita `python -m pip install pyautogui pygetwindow` (ya incluido en `instalar.bat`). Mientras corre, no uses la PC (el Enter va a la ventana que esté al frente; si WhatsApp no queda al frente, frena solo).
Limitación: no puede saber si el número existe en WhatsApp. Con el modo Chrome sí.

## Abrir, activar y pausar (sin cerrar la ventana)
- `abrir.bat`: abre el WhatsApp del agente (visible) **en pausa**: conectado, pero no contesta nada.
- `activar.bat`: empieza a contestar (y después a hacer seguimientos). Reacciona en segundos.
- `pausar.bat`: termina el mensaje que estaba escribiendo y no contesta más. La ventana sigue abierta.
- Se puede activar y pausar todas las veces que quieras. Para cerrarlo del todo: Ctrl+C en la ventana negra o archivo `STOP`.
- **Con la app de WhatsApp de escritorio** (sin QR, usa tu sesión): `abrir_app.bat` en vez de `abrir.bat`. Mismo `activar.bat` / `pausar.bat`. Mientras está activo no uses el teclado ni el mouse (aprieta Enter en la app); para usar la PC, `pausar.bat`. En este modo no puede leer el chat antes de escribir: si le contestaste vos desde otro lado y el panel no lo registró, podría repetir.
- Mientras está en pausa podés usar esa ventana de WhatsApp vos. Antes de activarlo, dejala en cualquier chat sin escribir nada: si la usás mientras está activo, el agente detecta que tocaste la caja, borra lo suyo y no manda.

## Cotizar, juez y entrenamiento (el agente aprende solo)
- **Cotiza solo** cuando el cliente manda link de Alibaba + cantidad, o cuando pasa **peso en gramos, cantidad y FOB unitario** en el chat. Antes de armarla, la IA solo extrae lo que escribió el cliente y marca si los números no tienen sentido para el producto (ej. una cerradura de 2,5 kg): en ese caso NO cotiza y queda en "Para vos". La cotización queda en Pendientes con su PDF y la PC la guarda o la manda según `COTIZ_MODO`.
- **Si faltan datos**: pide todo lo que falte en un solo mensaje, sin repetir lo que ya dio.
- **Juez**: cada borrador se evalúa antes de enviarlo (largo, tono, repetición, que conteste lo que preguntó, que no invente). Si no pasa, sale la versión corregida o queda en "Para vos". `JUEZ=0` en las variables del worker lo apaga.
- **Estilo**: cada noche se recalcula cómo escribís (largo, saludos, frases) y se guardan tus charlas como ejemplos: el agente ve las más parecidas a lo que escribió el cliente.
- **Entrenamiento nocturno (4 AM)**: toma charlas reales, el agente contesta sin ver tu respuesta, se compara con la tuya y de los errores salen reglas. Una regla nueva solo se adopta si mejora el puntaje probada con los mismos casos y no empeora nada.
- **Aprende de producción**: revisa qué pasó después de cada respuesta (cliente confundido, vos tuviste que intervenir, algo que dejó para vos y era simple).
- **Cotizaciones: de revisar a mandar directo**: al principio el agente guarda cada PDF en `cotizaciones\` para que lo revises. Con `entrenar.bat --bien N` confirmás que la cotización N° N estaba bien; con 7 seguidas empieza a mandarlas directo. `entrenar.bat --mal N "motivo"` vuelve la racha a 0, vuelve al modo revisión y el error alimenta el entrenamiento. (`COTIZ_MODO=revisar_siempre` en `.env` lo deja en revisión para siempre.)
- **Plazos**: contesta solo con los plazos que definiste (catálogo Paraguay ~15 días, ropa inmediata, mates y zapatillas ~10 días, China por avión 10 a 15 días y por barco 40 a 60 días desde el despacho). Mínimos y comisiones siguen siendo tuyos.
- **Fotos sin link**: si el cliente manda solo fotos del producto, le pide precio FOB, peso por unidad y cantidad. Si la charla es de pagos o comprobantes, lo deja para vos.
- **Corregirlo sin tocar código**: `entrenar.bat --corregir 549... "lo que tenía que hacer"` (o varias juntas con `--corregir-desde correcciones.txt`, una por línea: `numero | corrección`). Cada corrección queda como caso de oro: se le muestra al agente cuando aparece algo parecido, entra siempre en la práctica nocturna y ninguna regla nueva puede romperla.
- **Embudo del dueño (SOP)** para un producto sin link: cantidad y origen (China u otro lado) → si no es China, a vos → link de Alibaba o del proveedor → si no tiene, a vos → si tiene, FOB y peso para cotizar directo. Derivarte algo que se resuelve con una pregunta simple cuenta como error en el entrenamiento.
- **Entrenamiento intensivo**: `python entrenar.py --intensivo 60` entrena una hora sin parar (una ronda por minuto) con tus charlas reales y te muestra el puntaje de cada ronda. Usa exactamente el mismo circuito que en vivo (adjuntos, cierres, cotización, IA y juez) e incluye charlas donde lo correcto era no contestar o donde contestaste con un audio. `--parar` lo frena. Tiene un tope diario de llamadas a la IA (`ENT_MAX_DIA`, 800 por defecto) para no dejar sin cupo al contestador.
- `entrenar.bat`: muestra lo que aprendió. `entrenar.bat --ya 3`: pide 3 rondas ahora (una por minuto). `entrenar.bat --regla "texto"`: le enseña una regla tuya (fija, no se borra sola). `entrenar.bat --borrar N`.

## Contestador automático (responder.py)
Contesta los chats cuyo último mensaje es del cliente (incluye los que dejaste leídos sin responder). Escribe en una ventana propia de WhatsApp Web (no usa tu mouse ni tu teclado), con ritmo humano: "lee" unos segundos (+10 s de más), tipea letra por letra y recién ahí envía.
- `python responder.py --prueba`: muestra qué contestaría, sin abrir WhatsApp ni enviar nada. Probalo primero.
- `python responder.py`: contesta hasta que no queden pendientes y termina. `--seguir`: queda andando.
- `VENTANA=minimizada|oculta|visible` en `.env` (la primera vez usá `visible` para escanear el QR).
- Frenarlo: Ctrl+C, archivo `STOP`, o por Telegram: "pausar respuestas" (y "reanudar respuestas").
- Reglas: si nombran un producto sin link ni precio, les ofrece la búsqueda de proveedores (informe) y pregunta cantidad y calidad; si ya tienen producto y precio de proveedor, pide "peso del producto en gramos, cantidad de unidades y precio FOB unitario" (todo junto, en un solo mensaje) (+ "de Alibaba"/"de 1688" si mandaron link); para catálogo manda teimportamosarg.com/catalogo; nunca da precios. Pagos, reclamos, audios/fotos sin texto, "¿sos un bot?" y dudas los deja sin contestar para que los veas vos (siguen en "Responder ya").
- Tope: 25 respuestas por hora. Cada decisión queda en `/lector/enviar/log`.
- No corras `enviar.py` y `responder.py` a la vez (comparten la misma sesión de WhatsApp Web).
- Los chats que deja para vos se anotan en `para_vos.txt` (fecha | nombre | número | qué hacer, en 3-5 palabras) y aparecen en el panel, en "Para hacer hoy" → pestaña **Para vos**, con botón para abrir WhatsApp. Salen de la lista cuando contestás vos.

## Cotizaciones automáticas
El panel ya arma solo la cotización cuando un cliente manda un link de **Alibaba.com** + cantidad (lee precio y peso de la publicación). `responder.py` además la puede **mandar por WhatsApp** como PDF (con `COTIZ_MODO=enviar`; por defecto es `revisar`: guarda el PDF en la carpeta `cotizaciones` y lo anota en `para_vos.txt`, y la cotización sigue en Pendientes del panel para que la mandes vos) con un texto corto, sin números en el mensaje (están en el PDF).
- Si el peso no figuraba en la publicación y quedó **estimado**, NO se manda sola: aparece en la pestaña "Para vos" para que la revises. Para que igual se mande (el PDF avisa que el peso es estimado) cargá `COTIZ_PESO_ESTIMADO=1` como variable en Cloudflare.
- Links de 1688, fotos o productos sin link no se cotizan solos: ahí se le pide "peso, cantidad y precio FOB".
- Es la parte menos probada (adjuntar el PDF en WhatsApp Web). La primera vez corré con `VENTANA=visible` y mirá. Si falla, deja la cotización en "Para vos" y el PDF en esta carpeta.
- La búsqueda de proveedores se ofrece a $5.000 (informe).

## Prospección (prospectar.py)
1. Completá `prospectos.csv` (Excel): telefono, negocio, rubro, ciudad, nota. Si no existe, el programa la crea vacía.
2. Doble clic en `prospectar_prueba.bat`: la IA escribe un mensaje distinto por negocio según el rubro y lo guarda en la planilla. Revisalo y corregí lo que quieras.
3. Cerrá `responder.py` y doble clic en `prospectar.bat`: manda hasta 15 por día (PROSP_POR_DIA), de 10 a 19 h, con 4 a 9 minutos entre uno y otro. No hace falta agendar los números. Saltea los que no tienen WhatsApp y los que ya tienen charla con nosotros, y marca todo en la columna estado.
Otro número: `PROSP_PERFIL=perfil_prospeccion` en el .env abre otra sesión de WhatsApp Web (escaneás el QR con ese número la primera vez).
