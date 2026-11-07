# Pendientes (paso 2, después del panel nuevo)

Orden acordado con Manuel el 07/11/2026: primero el panel nuevo y el agente de WhatsApp; después esto.

## A. Agente buscador de productos ganadores (corre solo todos los días)
1. Tendencias de Mercado Libre por la API oficial (tendencias de búsqueda y más vendidos por categoría). **Necesita a Manuel:** registrar una aplicación gratis en developers.mercadolibre.com.ar y pasar el ID y la clave (van a Cloudflare, nunca al repo).
2. Buscar cada producto en China:
   - Por nombre en Alibaba con el `buscador` (Apify, ya existe).
   - 1688 por foto desde la PC de Manuel con su sesión iniciada (Playwright en segundo plano). Si aparece captcha, se frena y avisa en el panel: no se esquiva.
3. Cruce con Unidrop: Manuel puede exportar el catálogo en PDF o Excel. Ver si se puede sincronizar seguido (preguntarle a Unidrop si tienen exportación o API).
4. Calcular costo puesto en Argentina con las tarifas actuales de la web (captura del 07/11):
   - Flete USD 19/kg (menos de 50 kg) · handling fijo USD 30 por envío
   - Honorarios 10% de la mercadería, tope USD 250 · impuestos 55%
   - Aéreo fijo USD 950 de 50 a 250 kg · barco fijo USD 100 desde 250 kg
   - Dólar: el de la base de la web (USDT Binance como respaldo)
   - ⚠️ El barco fijo de USD 100 subestima cargas grandes: un cliente de 3.000 frascos (~5 CBM) lo marcó. Revisar con Manuel antes de usarlo en el buscador.
5. Margen = precio en Mercado Libre − comisión ML (~15%) − envío − costo puesto. Si pasa el umbral que fije Manuel → "ganador".
6. Mostrarlo en el panel (pestaña Productos), simple: foto, precio ML, costo puesto, margen, si está en Unidrop.

## B. Prospección online masiva (todos los puntos)
1. El agente arma listas por nicho: vendedores de Mercado Libre por categoría (API oficial) y comercios de Google Maps por ciudad y rubro.
2. Nichos para empezar (uno por semana, para comparar): bazar y hogar, ferretería, accesorios de celular, mascotas, cotillón y regalería, peluquería y belleza, insumos gastronómicos.
3. Mensaje personalizado por prospecto: "tu [producto] te sale $X puesto en tu casa desde China", con el cálculo del punto A.4.
4. Canal masivo 1: anuncios de Meta que llevan a WhatsApp (ellos escriben primero, sin riesgo de bloqueo). Usar links con código del panel (pestaña Links, canal Anuncio).
5. Canal masivo 2: email a comercios con mail público, desde un dominio separado, con opción de baja.
6. Canal 3: WhatsApp semiautomático para los mejores prospectos: cola lista en el panel, un clic abre el chat con el mensaje escrito (link wa.me, sin agendar), la persona aprieta enviar, desde un número aparte (nunca el 805). No se arma un bot que simule tipeo ni que rote números.
7. Medición por nicho: contactados → respondieron → pidieron cotización → seña. Nicho con menos de 5–10% de respuesta en una semana se cambia.
8. Antes de escalar: que un abogado revise ley de datos personales y Registro No Llame.

## C. Otros pendientes detectados
- Simulaciones `sim-asistente` (4 fallas) y `sim-seguimientos` (9 fallas) ya fallaban en main desde el commit b1de32c (rediseño de seguimientos). Las tiene que corregir quien hizo ese cambio.
- Origen por reel: las respuestas de Instagram muestran el número (no un link), así que los reels sin link no se pueden marcar con código. Las historias con sticker de link, la bio, los anuncios y la prospección sí.
- Cupos en el panel (lugares, señas, fecha de cierre): falta definir de dónde salen los datos.
