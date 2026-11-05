// Mensajes que no piden respuesta ("gracias", "ok", "dale", "te aviso"…). Lo usan el contestador y las listas del panel.
// "gracias", "dale joya", "ok perfecto", "no hay problema", "👍"…: solo palabras de cierre, sin pregunta. Se contestan con nada.
const CIERRE = new Set("gracias graciass mil muchas muchisimas muchísimas ok okey oka okk dale joya joyita listo lista perfecto perfecta genial buenisimo buenísimo barbaro bárbaro excelente igualmente de nada no hay problema problemas tranqui tranca esta bien está bien bien vale hno hermano amigo amiga bro crack capo maestro genio jefe che bueno her herma mi buenas un y suerte exitos éxitos pasa chau chao hasta luego nos vemos hablamos noches saludos abrazo besos un abrazo".split(" "));
const CIERRE_FRASE = /(ya te aviso|te aviso|les aviso|te vuelvo a escribir|me vuelvo a comunicar|te escribo (despu[eé]s|m[aá]s tarde|ma[ñn]ana)|despu[eé]s te (aviso|escribo|hablo)|lo (veo|analizo|pienso|consulto|charlo|hablo)|voy a ver|tengo que (verlo|pensarlo|consultarlo|hablarlo)|debo consultarlo|estamos en contacto|por ahora no|ahora no|volver[eé]|vuelvo cuando|cualquier cosa (te|les) (aviso|escribo|hablo)|quedo atento|quedo al pendiente|estoy al pendiente)/;
export function esCierre(t) {
  const x = String(t || "").toLowerCase().trim();
  if (!x || /[?¿]|\d|https?:/.test(x)) return false;
  if (x.length <= 160 && (CIERRE_FRASE.test(x) || /gra+cias+[\s!.🙏😊🫂❤️👍🫶🏼]*$/u.test(x))) return true;   // "…, déjame q lo analice. Muchas gracias"
  if (x.length > 45) return false;
  const palabras = x.normalize("NFC").replace(/[^\p{L}\s]/gu, " ").split(/\s+/).filter(Boolean);
  if (!palabras.length) return /^[\p{Extended_Pictographic}\s!.]+$/u.test(x);   // solo emojis (👍🙏)
  return palabras.every((w) => CIERRE.has(w) || /^(gra+cias+|o+k+|da+le+|jo+ya+)$/.test(w));
}
