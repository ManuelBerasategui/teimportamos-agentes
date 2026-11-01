# Enviador de seguimientos (PC)

Toma la lista de seguimientos del panel y la manda por WhatsApp Web, uno por uno, con pausas largas. No usa IA: no gasta tokens.
El lector del celular sigue siendo solo de lectura; esto es aparte.

## Instalación (una vez)
1. Instalá Python (python.org, tildar "Add to PATH").
2. Doble clic en `instalar.bat`.
3. Copiá `.env.example` como `.env` y completá `PANEL_URL` y `LECTOR_TOKEN` (el mismo del lector). El token queda solo en tu PC.

## Uso
- `python enviar.py --seco`: muestra la lista sin enviar nada (probá esto primero).
- `enviar.bat`: te pide confirmación (Enter) en cada mensaje. Usalo los primeros días.
- `python enviar.py --auto`: envía solo con pausas al azar de 45–130 s, hasta 50 por corrida (después frena; lo volvés a correr más tarde), entre las 9 y las 20 h.
- Para frenar: Ctrl+C o crear un archivo `STOP` en esta carpeta.

La primera vez abre una ventana de Chrome propia: escaneá el QR con el celular (usa su propia sesión de WhatsApp Web, no toca la tuya).
Cada mensaje se varía un poco (saludo, cierre, puntuación) para que no salgan idénticos.
Cada envío queda marcado como hecho en el panel; "n" lo marca como "no seguir".

## Ojo
- No está probado contra WhatsApp Web real: si cambian la página puede fallar. Empezá con `--seco` y luego con confirmación.
- El riesgo de bloqueo depende del volumen y de que te marquen como spam, no de quién aprieta el botón. Mantené pocos por día, pausas largas, y mensajes a gente que ya habló con vos.

## Usar la app de escritorio de WhatsApp (sin Chrome ni QR)
`python enviar.py --escritorio` (agregá `--auto` para que no pida confirmación). Usa la app que ya tenés abierta con sesión: abre cada chat con el mensaje puesto y aprieta Enter.
Necesita `python -m pip install pyautogui pygetwindow` (ya incluido en `instalar.bat`). Mientras corre, no uses la PC (el Enter va a la ventana que esté al frente; si WhatsApp no queda al frente, frena solo).
Limitación: no puede saber si el número existe en WhatsApp. Con el modo Chrome sí.
