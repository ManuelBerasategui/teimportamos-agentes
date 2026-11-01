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
- `python enviar.py --auto`: envía solo con pausas de 60–150 s, hasta 15 por corrida, entre las 9 y las 20 h.
- Para frenar: Ctrl+C o crear un archivo `STOP` en esta carpeta.

La primera vez abre una ventana de Chrome propia: escaneá el QR con el celular (usa su propia sesión de WhatsApp Web, no toca la tuya).
Cada envío queda marcado como hecho en el panel; "n" lo marca como "no seguir".

## Ojo
- No está probado contra WhatsApp Web real: si cambian la página puede fallar. Empezá con `--seco` y luego con confirmación.
- El riesgo de bloqueo depende del volumen y de que te marquen como spam, no de quién aprieta el botón. Mantené pocos por día, pausas largas, y mensajes a gente que ya habló con vos.
