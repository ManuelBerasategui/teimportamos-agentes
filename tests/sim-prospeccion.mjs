// Prospección: un mensaje por negocio, según su rubro, sin ¿¡ ni emojis; sin IA no inventa nada
import { mensajesProspeccion, respuestasProspeccion } from "../cotizador/src/lector.js";
let ok = 0, mal = 0; const chk = (n, c) => { c ? (ok++, console.log("✓ " + n)) : (mal++, console.log("FALLA: " + n)); };
let prompt = "";
const ia = async (_e, p) => { prompt = p; return { mensajes: [{ n: 1, mensaje: "¡hola! 🙌 soy manuel de te importamos. ¿vendés mates?" }, { n: 2, mensaje: "buenas, soy manuel" }] }; };
const r = await mensajesProspeccion({}, ia, [{ negocio: "Mates Rosario", rubro: "regalería", telefono: "549341" }, { negocio: "Ferre", rubro: "ferretería" }]);
chk("arma un mensaje por negocio", r.mensajes.length === 2);
chk("limpia ¿ ¡ y emojis", r.mensajes[0].mensaje === "hola! soy manuel de te importamos. vendés mates?");
chk("el prompt usa el rubro y pide la salida para no molestar", /regalería/.test(prompt) && /ferretería/.test(prompt) && /no le escribimos más/.test(prompt));
chk("no manda el teléfono a la IA", !/549341/.test(prompt));
chk("sin IA no inventa", (await mensajesProspeccion({}, null, [{ negocio: "x" }])).mensajes.length === 0);
let p2 = "";
const ia2 = async (_e, p) => { p2 = p; return { chats: [{ n: 1, temperatura: "Frío", recontacto: "", proximo_mensaje: "" }, { n: 2, temperatura: "neutro", recontacto: "2026-11-14", proximo_mensaje: "¡hola! 🙌 pudieron ver la propuesta?" }] }; };
const rr = await respuestasProspeccion({}, ia2, [{ negocio: "A", charla: [{ yo: false, texto: "no gracias" }] }, { negocio: "B", charla: [{ yo: false, texto: "el 14 te digo" }] }], "2026-11-11");
chk("respuestas: temperatura normalizada y fecha de recontacto", rr.chats[0].temperatura === "frio" && rr.chats[1].recontacto === "2026-11-14");
chk("respuestas: próximo mensaje limpio y el prompt lleva la charla y la fecha de hoy", rr.chats[1].proximo_mensaje === "hola! pudieron ver la propuesta?" && /el 14 te digo/.test(p2) && /2026-11-11/.test(p2));
console.log(`\nsim-prospeccion: ${ok} ok, ${mal} fallas`); process.exit(mal ? 1 : 0);
