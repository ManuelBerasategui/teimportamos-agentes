# Lector 805 (solo lectura)

Lee todo lo que entra y sale del WhatsApp Business **+54 9 341 805-1515** y lo manda al
panel (`/panel/805`) para analizarlo: leads, métricas exactas, alertas y reportes.
**No manda mensajes:** las rutas de envío del puente se borran al compilarlo (ver `Dockerfile`).

```
celular 805 ──(dispositivo vinculado)──> puente (este servidor) ──> worker cotizador /lector/... ──> D1 ──> panel /panel/805
                                                                                         └──> Telegram (alertas y reportes)
```

## Costos
- Servidor: **Oracle Cloud "Always Free"** (USD 0). Pide una tarjeta para verificar identidad, pero no cobra
  mientras uses solo recursos "Always Free".
- Cloudflare (worker + D1): plan gratis, el mismo de hoy.
- IA de análisis: Gemini (nivel gratis), la misma de hoy.
- Telegram: gratis.
- Meta/WhatsApp: **USD 0**, porque no se manda ningún mensaje por la API.

## Puesta en marcha (una sola vez)

1. **Clave del lector**: en Cloudflare → Workers → cotizador → Settings → Variables, agregar
   `LECTOR_TOKEN` (tipo **Secret**) con una clave larga inventada (ej. 40 letras y números).
2. **Servidor gratis** (Oracle Cloud):
   - Crear cuenta en cloud.oracle.com (región São Paulo o la que ofrezca).
   - Compute → Instances → Create instance → imagen **Ubuntu 22.04/24.04**, forma
     **VM.Standard.A1.Flex** (1 OCPU, 6 GB, "Always Free eligible") → bajar la clave SSH → Create.
   - Entrar por SSH (o "Cloud Shell" desde la web).
3. En el servidor:
   ```sh
   git clone https://github.com/ManuelBerasategui/teimportamos-agentes && cd teimportamos-agentes/lector
   LECTOR_TOKEN='<la misma clave del paso 1>' bash instalar.sh
   bash vincular.sh 5493418051515
   ```
   Aparece un código de 8 letras. En el celular del 805: **WhatsApp → Dispositivos vinculados →
   Vincular un dispositivo → Vincular con el número de teléfono** → escribir el código.
4. Abrir el panel → pestaña **805**. Para las alertas: pestaña **Conexión** → seguir los pasos de Telegram.

## Qué hace solo
- Cada 15 min: la IA puntúa los chats nuevos (1-10), detecta producto, etapa y qué hacer.
- Cada 10 min (9 a 23 h): alerta por Telegram de leads buenos sin responder hace +20 min y de
  quienes esperan cotización.
- 21:00 todos los días: reporte diario. Domingos: también el semanal.
- Si el 805 se desvincula o dejan de llegar mensajes 6 h: aviso por Telegram.

## Riesgo
El puente usa el protocolo de WhatsApp Web (no oficial), igual que un dispositivo vinculado.
Sin enviar mensajes el riesgo es bajo, pero no es cero. Para desconectarlo en cualquier momento:
celular → Dispositivos vinculados → cerrar la sesión del lector.
