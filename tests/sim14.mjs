import { DatabaseSync } from "node:sqlite";
import fs from "fs";
const src = fs.readFileSync("src/worker.js","utf8");
fs.writeFileSync("/tmp/wk.mjs", src); fs.copyFileSync("src/lector.js","/tmp/lector.js"); fs.copyFileSync("src/lector-panel.js","/tmp/lector-panel.js"); fs.copyFileSync("src/busquedas.js","/tmp/busquedas.js");
const W = (await import("/tmp/wk.mjs")).default;
const db = new DatabaseSync(":memory:");
const stmt = (sql, b=[]) => ({ bind:(...x)=>stmt(sql,x), run: async()=>{db.prepare(sql).run(...b);return{}}, first: async()=>db.prepare(sql).get(...b)??null, all: async()=>({results:db.prepare(sql).all(...b)}) });
const DB = { prepare:(s)=>stmt(s), batch: async(a)=>{for(const x of a) await x.run();} };
const sent=[]; let geminiResp = {};
globalThis.fetch = async (url, o={}) => {
  url=String(url);
  if (url.includes("/media") && o.method==="POST") return new Response(JSON.stringify({id:"MEDIA123"}));
  if (url.includes("/messages")) { const b=JSON.parse(o.body); if(b.to) sent.push([b.to, b.text?.body || b.type + (b.document?" "+b.document.filename:"")]); return new Response(JSON.stringify({messages:[{id:"wamid."+Math.random().toString(36).slice(2)}]}),{status:200}); }
  if (url.includes("generativelanguage") && url.includes("models?")) return new Response(JSON.stringify({models:[{name:"models/gemini-flash",supportedGenerationMethods:["generateContent"]}]}));
  if (url.includes("open.er-api.com")) return new Response(JSON.stringify({rates:{CNY:7.2,BRL:5.5}}));
  if (url.includes("binance")||url.includes("dolarapi")) return new Response(JSON.stringify({price:"1500",venta:1500}));
  if (url.includes("generateContent")) return new Response(JSON.stringify({candidates:[{content:{parts:[{text:JSON.stringify(geminiResp)}]}}]}));
  if (url.includes("graph.facebook.com")) return new Response(JSON.stringify({url:"http://img",mime_type:"image/png"}));
  if (url==="http://img") return new Response(new Uint8Array([1,2,3]));
  return new Response("[]");
};
globalThis.setTimeout = (f)=>{f();return 0}; // sin esperas
const env = { DB, ESTADO:null, WA_TOKEN:"t", WA_PHONE_ID:"p", VERIFY_TOKEN:"k", GEMINI_KEY:"g", ADMIN_PHONE:"5493418051515", NUMERO_AGENTE:"5493412595936", PANEL_USUARIOS:"admin:x", ESPERA_SEG:"0" };
const ctx={ waits:[], waitUntil(p){this.waits.push(p)} };
const flush=async()=>{while(ctx.waits.length) await ctx.waits.shift();};
let n=0;

env.LECTOR_TOKEN="tok"; env.TELEGRAM_TOKEN="tg"; env.TELEGRAM_CHAT="1";
const tgs=[]; const f0=globalThis.fetch; globalThis.fetch=async(u,o={})=>{ if(String(u).includes("telegram")){tgs.push(JSON.parse(o.body||"{}").text);return new Response('{"ok":true}');} return f0(u,o); };
const post=(p,b,tok="tok")=>W.fetch(new Request("https://x/lector"+p,{method:"POST",headers:{Authorization:"Bearer "+tok,"Content-Type":"application/json"},body:JSON.stringify(b)}),env,ctx);
const now=Date.now(), iso=(m)=>new Date(now-m*60000).toISOString();
console.log("sin token:", (await post("/whatsapp-web-webhook",{},"mal")).status);
let r=await post("/whatsapp-web-webhook",{organization_address:"5493418051515",messages:[
 {external_id:"a1",conversation_address:"5491111111111",sender_address:"5491111111111",sender_name:"Ivo",content:{type:"text",kind:"text",text:"hola quiero 20 cajas de luz, me pasas precio?"},timestamp:iso(60)},
 {external_id:"a2",conversation_address:"5491111111111",content:{type:"text",kind:"text",text:"Cotización: Light box x20 Total puesto en Argentina USD 800"},timestamp:iso(50)},
 {external_id:"a3",conversation_address:"5491111111111",sender_address:"5491111111111",content:{type:"file",kind:"image",text:"ahi va el comprobante de la seña"},timestamp:iso(40)},
 {external_id:"b1",conversation_address:"5492222222222",sender_address:"5492222222222",sender_name:"Tabo",content:{type:"text",kind:"text",text:"quiero 25 consolas r36 originales"},timestamp:iso(45)},
 {external_id:"g1",conversation_address:"120363@g.us",sender_address:"5493333333333",sender_name:"Pepe",conversation_name:"Mayoristas",content:{type:"text",kind:"text",text:"alguien trae perfumes arabes?"},timestamp:iso(30)},
 {external_id:"r1",conversation_address:"5492222222222",sender_address:"5492222222222",content:{type:"data",kind:"reaction"},timestamp:iso(29)},
]}); console.log("ingesta:", r.status, await r.text());
console.log("media:", (await post("/whatsapp-web-webhook/media",{})).status);
geminiResp={chats:[{conv:"5492222222222",puntaje:8,temp:"caliente",producto:"consolas R36",etapa:"falta_cotizar",cot_pend:true,accion:"mandale la cotización de 25 R36",prioridad:1,resumen:"Tabo quiere 25 R36 originales"},{conv:"5491111111111",puntaje:9,temp:"caliente",producto:"cajas de luz",etapa:"vendido",cot_pend:false,accion:"",resumen:"Ivo señó"}]};
const lr = await W.fetch(new Request("https://x/login",{method:"POST",body:new URLSearchParams({u:"admin",p:"x"})}),env,ctx);
const cookie = lr.headers.get("set-cookie").split(";")[0];
const api2=async(p,b)=>(await W.fetch(new Request("https://x/panel/api/805/"+p,{method:b?"POST":"GET",headers:{cookie},body:b?JSON.stringify(b):undefined}),env,ctx)).json();
console.log("analizar:", await api2("analizar",{}));
const res=await api2("resumen"); console.log("KPIs hoy:", res.dia); console.log("sinResp:", res.sinResponder.map(c=>c.nombre), "cotPend:", res.cotPend.map(c=>c.nombre), "ventas:", res.ventasRec.length);
console.log("alertas:", await api2("probar-alertas",{}), tgs.slice(-1)[0]);
geminiResp={titular:"Día movido",claves:["2 chats nuevos"],oportunidades:["Tabo: cotizale"],problemas:[],grupos:"Piden perfumes",recomendacion:"Cotizá a Tabo"};
const rep=await api2("reporte",{tipo:"805_diario"}); console.log("reporte:", rep.id, tgs.slice(-1)[0].slice(0,200));
console.log("chats grupos:", (await api2("chats?f=grupos")).map(c=>c.nombre));
const ch=await api2("chat?conv=5491111111111"); console.log("chat:", ch.mensajes.length, ch.hitos.map(h=>h.tipo));
const pg=await W.fetch(new Request("https://x/panel/805",{headers:{cookie}}),env,ctx); console.log("pagina:", pg.status, (await pg.text()).length);
const r2=await W.fetch(new Request("https://x/lector/tok/whatsapp-web-webhook",{method:"POST",headers:{Authorization:"Bearer otro"},body:JSON.stringify({messages:[{external_id:"z1",conversation_address:"5494444444444",sender_address:"5494444444444",content:{type:"text",kind:"text",text:"hola"},timestamp:new Date().toISOString()}]})}),env,ctx);
console.log("clave en ruta:", r2.status, await r2.text());
const r3=await W.fetch(new Request("https://x/lector/mal/whatsapp-web-webhook",{method:"POST",body:"{}"}),env,ctx); console.log("clave mala:", r3.status);
console.log("qr post:", (await post("/qr",{qr:"2@abc+/=,def,ghi"})).status, "panel:", (await api2("qr")).qr);
await post("/qr",{qr:"",estado:"paired"}); console.log("qr vinculado:", (await api2("qr")).estado);
await post("/whatsapp-web-webhook",{organization_address:"5493418051515",messages:[
 {external_id:"p1",conversation_address:"5495555555555",sender_address:"5495555555555",sender_name:"Juan",content:{type:"text",kind:"text",text:"hola quiero precio"},timestamp:new Date(Date.now()-60000).toISOString()},
 {external_id:"p2",conversation_address:"5495555555555",sender_address:"5493418051515",sender_name:"Te importamos",conversation_name:"Te importamos",content:{type:"text",kind:"text",text:"Bienvenido!! Te voy a derivar"},timestamp:new Date().toISOString()}]});
const cp=await api2("chat?conv=5495555555555"); console.log("propio:", cp.mensajes.map(m=>m.yo).join(","), "nombre:", cp.conv.nombre, "ult_yo:", cp.conv.ult_yo);
// datos viejos mal marcados -> reparar
db.prepare("UPDATE w_msg SET yo=0 WHERE id='p2'").run(); db.prepare("UPDATE w_conv SET ult_yo=0, nombre='Te importamos' WHERE conv='5495555555555'").run();
console.log("reparar:", await api2("reparar",{})); const cp2=await api2("chat?conv=5495555555555"); console.log("reparado:", cp2.mensajes.map(m=>m.yo).join(","), cp2.conv.nombre, cp2.conv.ult_yo);
geminiResp={respuesta:"Se lo tenías que mandar a Tabo (+5492222222222): \"quiero 25 consolas r36 originales\"."};
const pa=await api2("preguntar",{pregunta:"a quien le tenia que mandar las consolas?",historial:[]}); console.log("asistente:", pa.respuesta.slice(0,60), pa.fuentes);
geminiResp={titular:"Día fuerte en camisetas",claves:["15 chats nuevos"],oportunidades:["Juan: cotizale"],problemas:[],grupos:"",recomendacion:"Cotizar camisetas",difusion:[{producto:"Camisetas versión jugador",por_que:"6 pedidos hoy",mensaje:"Abrimos cupo de camisetas versión jugador.\nTraemos directo, más barato que en Mercado Libre.\nEscribime y reservá tu lugar."}]};
const rp=await api2("reporte",{tipo:"805_diario"}); console.log("difusion:", rp.datos.ia.difusion.length);
console.log("borrar:", (await api2("borrar-reporte",{id:rp.id})).ok, "quedan:", (await api2("reportes")).length);
