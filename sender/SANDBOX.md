# Sandbox para entrenar seguimientos

Este entorno practica mensajes con 100 conversaciones ficticias y con más contexto. Incluye cotizaciones vistas sin respuesta, objeciones de precio, cantidades para probar, plazos, decisiones compartidas, listas de precios e información de productos. No accede al lector, a WhatsApp ni a contactos reales. PLAY solo simula el tipeo en la página.

## Abrir y recuperar el entrenamiento compartido

1. Descargá o cloná la rama `seguimientos-sandbox` de este repositorio.
2. Abrí `sender/abrir-sandbox.bat`.
3. En el sandbox, tocá **Importar** y elegí `sender/entrenamiento-seguimientos.json`.
4. Seleccioná un chat y corregí el mensaje. Si tocás **PLAY** con un borrador modificado y completo, el sandbox guarda el antes y el después, generaliza nombre/producto/cantidad y reutiliza el ejemplo en chats de esa situación. También guarda la pauta de estilo general. Podés añadir una explicación en **Tu corrección para casos parecidos**. El botón **Guardar corrección y usarla en casos parecidos** sigue disponible para guardar sin simular.
5. Al terminar, tocá **Exportar entrenamiento**. El JSON guarda el progreso y todas las reglas, y se puede volver a importar.

## Aportar correcciones del grupo

Cada persona practica en su navegador. Para actualizar la copia compartida, reemplazá `sender/entrenamiento-seguimientos.json` con el JSON exportado y abrí una pull request hacia la rama `seguimientos-sandbox`. Si no tenés permiso para contribuir, mandale ese JSON a Manuel para que lo suba.

No uses `main` como destino de pull requests: ese branch está conectado al despliegue de producción. El repositorio es público. El archivo compartido contiene solo ejemplos ficticios; no subas conversaciones reales ni datos de clientes.

Los ejemplos de menos de 24 caracteres se descartan al importar y no se aplican. Si el borrador termina a mitad de una idea, PLAY no lo simula ni lo aprende hasta que lo completes. Las correcciones anteriores que repetían literalmente el nombre o producto de otro chat se migran a variables al abrir la versión nueva.

Para los casos de plazo, los chats ficticios muestran la ruta concreta: China por avión (15 a 20 días aprox. desde el despacho), zapatillas importadas de Brasil (aprox. 10 días), ropa de Argentina (despacho durante la semana) y China por barco (40 a 60 días aprox. desde el despacho). La plantilla no debe inventar ruta o plazo si el contexto real no lo indica.

