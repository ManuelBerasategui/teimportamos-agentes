/**
 * Manda la hoja "Pedidos" de la planilla al panel (solo lectura: no cambia nada de la planilla).
 * Instalación (una vez, 3 minutos):
 *  1. En la planilla: Extensiones > Apps Script. Borrá lo que haya y pegá este archivo entero. Guardá.
 *  2. Engranaje "Configuración del proyecto" > Propiedades de la secuencia de comandos > Agregar:
 *       LECTOR_TOKEN = (el mismo valor que está en sender/.env de la PC)
 *  3. Arriba elegí la función "instalar" y tocá Ejecutar. Aceptá los permisos (es tu propia cuenta).
 *     Queda mandando la hoja cada 1 hora. La función "mandarPedidos" la manda al instante.
 * El token no se escribe en el código: vive en las propiedades del script, dentro de tu cuenta de Google.
 */
var URL_PANEL = "https://cotizador.berasateguimanuel07.workers.dev/lector/planilla";
var HOJA = "Pedidos";

function mandarPedidos() {
  var hoja = SpreadsheetApp.getActive().getSheetByName(HOJA);
  if (!hoja) throw new Error("No encuentro la hoja " + HOJA);
  var token = PropertiesService.getScriptProperties().getProperty("LECTOR_TOKEN");
  if (!token) throw new Error("Falta cargar LECTOR_TOKEN en Propiedades de la secuencia de comandos");
  var filas = hoja.getDataRange().getDisplayValues();
  var r = UrlFetchApp.fetch(URL_PANEL, {
    method: "post", contentType: "application/json", muteHttpExceptions: true,
    headers: { Authorization: "Bearer " + token },
    payload: JSON.stringify({ filas: filas })
  });
  Logger.log(r.getResponseCode() + " " + r.getContentText());
}

function instalar() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === "mandarPedidos") ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger("mandarPedidos").timeBased().everyHours(1).create();
  mandarPedidos();
}
