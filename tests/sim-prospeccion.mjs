// Prospección: un mensaje por negocio, según su rubro, sin ¿¡ ni emojis; sin IA no inventa nada
import { mensajesProspeccion } from "../cotizador/src/lector.js";
let ok = 0, mal = 0; const chk = (n, c) => { c ? (ok++, console.log("✓ " + n)) : (mal++, console.log("FALLA: " + n)); };
let prompt = "";
const ia = async (_e, p) => { prompt = p; return { mensajes: [{ n: 1, mensaje: "¡hola! 🙌 soy manuel de te importamos. ¿vendés mates?" }, { n: 2, mensaje: "buenas, soy manuel" }] }; };
const r = await mensajesProspeccion({}, ia, [{ negocio: "Mates Rosario", rubro: "regalería", telefono: "549341" }, { negocio: "Ferre", rubro: "ferretería" }]);
chk("arma un mensaje por negocio", r.mensajes.length === 2);
chk("limpia ¿ ¡ y emojis", r.mensajes[0].mensaje === "hola! soy manuel de te importamos. vendés mates?");
chk("el prompt usa el rubro y pide la salida para no molestar", /regalería/.test(prompt) && /ferretería/.test(prompt) && /no le escribimos más/.test(prompt));
chk("no manda el teléfono a la IA", !/549341/.test(prompt));
chk("sin IA no inventa", (await mensajesProspeccion({}, null, [{ negocio: "x" }])).mensajes.length === 0);
console.log(`\nsim-prospeccion: ${ok} ok, ${mal} fallas`); process.exit(mal ? 1 : 0);
