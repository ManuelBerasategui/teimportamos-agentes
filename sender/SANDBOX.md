# Sandbox para entrenar seguimientos

Este entorno practica mensajes con 100 conversaciones ficticias y con más contexto. Incluye cotizaciones vistas sin respuesta, objeciones de precio, cantidades para probar, plazos, decisiones compartidas, listas de precios e información de productos. No accede al lector, a WhatsApp ni a contactos reales. PLAY solo simula el tipeo en la página.

## Abrir y recuperar el entrenamiento compartido

1. Descargá o cloná la rama `seguimientos-sandbox` de este repositorio.
2. Abrí `sender/abrir-sandbox.bat`.
3. En el sandbox, tocá **Importar** y elegí `sender/entrenamiento-seguimientos.json`.
4. Seleccioná un chat, corregí el mensaje y escribí la regla para casos parecidos. Tocá **Guardar corrección y usarla en casos parecidos**.
5. Al terminar, tocá **Exportar entrenamiento**. El JSON guarda el progreso y todas las reglas, y se puede volver a importar.

## Aportar correcciones del grupo

Cada persona practica en su navegador. Para actualizar la copia compartida, reemplazá `sender/entrenamiento-seguimientos.json` con el JSON exportado y abrí una pull request hacia la rama `seguimientos-sandbox`. Si no tenés permiso para contribuir, mandale ese JSON a Manuel para que lo suba.

No uses `main` como destino de pull requests: ese branch está conectado al despliegue de producción. El repositorio es público. El archivo compartido contiene solo ejemplos ficticios; no subas conversaciones reales ni datos de clientes.

Los ejemplos de menos de 24 caracteres se descartan al importar y no se aplican. El borrador corregido tiene que estar completo para convertirse en ejemplo reutilizable.

