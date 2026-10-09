import { DatabaseSync } from "node:sqlite";
import fs from "fs";
const src = fs.readFileSync("src/worker.js","utf8");
fs.writeFileSync("/tmp/wk.mjs", src); fs.copyFileSync("src/lector.js","/tmp/lector.js"); fs.copyFileSync("src/lector-panel.js","/tmp/lector-panel.js"); fs.copyFileSync("src/busquedas.js","/tmp/busquedas.js"); for (const f of fs.readdirSync("src")) fs.copyFileSync("src/" + f, "/tmp/" + f); fs.copyFileSync("src/cotizar.js","/tmp/cotizar.js"); 
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
async function msg(from, body, type="text"){ const m={from,id:"w"+(++n),type, ...(type==="text"?{text:{body}}:{image:{id:"img"+n,caption:body}})};
  await W.fetch(new Request("https://x/",{method:"POST",body:JSON.stringify({entry:[{changes:[{field:"messages",value:{messages:[m],contacts:[{profile:{name:"Beni"}}]}}]}]})}),env,ctx); await flush(); }
// login cookie
const lr = await W.fetch(new Request("https://x/login",{method:"POST",body:new URLSearchParams({u:"admin",p:"x"})}),env,ctx);
const cookie = lr.headers.get("set-cookie").split(";")[0];
const api = async (r,b)=> (await W.fetch(new Request("https://x/panel/api/"+r,{method:b?"POST":"GET",headers:{cookie},body:b?JSON.stringify(b):undefined}),env,ctx)).json();


// A) Link de IG: sin menú
const L="5491100000010"; geminiResp={respuesta:"buenas leo! traemos lo que quieras de china o usa con todo incluido||que producto te intereso del video?"}; sent.length=0;
await msg(L,"Hola como estas! Vi un video tuyo y quiero importar un producto");
console.log("LINK:", sent.filter(s=>s[0]===L).map(s=>s[1]));
// B) Pregunta en cotizacion
const Q="5491100000011"; geminiResp={respuesta:"x",es_proveedor:true,producto:{nombre:"Light Box",tramos:[]},}; await msg(Q,"hola"); await msg(Q,"https://www.alibaba.com/product-detail/x.html");
geminiResp={respuesta:"si, se puede traer menos de 50, sale un poco mas caro por unidad||me pasas captura de los precios por cantidad?"}; sent.length=0;
await msg(Q,"la publicación dice minimo 50, se puede por menos?");
console.log("PREGUNTA COTIZ:", sent.filter(s=>s[0]===Q).map(s=>s[1]));
// C) Seguimiento 23h con oferta
const S="5491100000012"; geminiResp={respuesta:"genial, cuantas unidades?"}; await msg(S,"hola quiero traer auriculares de alibaba");
const kk=await env.DB.prepare("SELECT v FROM kv WHERE k=?").bind("v3:"+S).first(); const e=JSON.parse(kk.v); e.ultimoMensaje=Date.now()-23*3600e3; await env.DB.prepare("UPDATE kv SET v=? WHERE k=?").bind(JSON.stringify(e),"v3:"+S).run();
geminiResp={enviar:true,mensaje:"hola! te guardo 50% off en honorarios si arrancas esta semana||cuantas unidades queres?",oferta:"50% off en honorarios (USD 40)",honorarios50:true}; sent.length=0;
await W.scheduled({scheduledTime:Date.UTC(2026,9,4,15,5)},env,ctx); await flush();
console.log("SEGUIMIENTO:", sent.filter(s=>s[0]===S).map(s=>s[1]), "| oferta en panel:", (await api("chat?tel="+S)).oferta);
// D) Archivo
const fd=new FormData(); fd.append("tel",S); fd.append("file", new File([new Uint8Array([37,80,68,70])],"lista.pdf",{type:"application/pdf"}));
sent.length=0; const ar=await (await W.fetch(new Request("https://x/panel/api/archivo",{method:"POST",headers:{cookie},body:fd}),env,ctx)).json();
console.log("ARCHIVO:", ar, sent, (await api("chat?tel="+S)).mensajes.slice(-1));
// E) Agente
geminiResp={respuesta:"entendido, no lo vuelvo a hacer",reglas_nuevas:["Nunca pidas el peso de una foto de carrito"],olvidar:[],acciones:[{tipo:"quitar_riesgo",tel:S,descripcion:"sacar de riesgo a este chat"}]};
const ag=await api("agente",{agente:"whatsapp",texto:"el chat de "+S+" no está en riesgo, y no pidas peso de carritos",imagenes:[]});
console.log("AGENTE:", ag.ok, ag.hilo.slice(-1)[0].t, ag.hilo.slice(-1)[0].reglas, ag.hilo.slice(-1)[0].acciones.length);
console.log("GUARDAR REGLA:", (await api("agente-aplicar",{agente:"whatsapp",tipo:"regla",regla:"Nunca pidas el peso de una foto de carrito"})).res, (await api("agente-hilo?a=whatsapp")).reglas);
console.log("ACCION:", (await api("agente-aplicar",{agente:"whatsapp",tipo:"accion",accion:{tipo:"quitar_riesgo",tel:S}})).res);
console.log("IG REGLA:", (await api("agente-aplicar",{agente:"instagram",tipo:"regla",regla:"no uses emojis"})).res, (await env.DB.prepare("SELECT v FROM kv WHERE k='ig_reglas'").first()).v);
// F) Reportes
await api("generar",{p:"dia"}); const rp=await api("reportes?p=dia"); console.log("REPORTE:", rp[0]?.generado, rp.length); await api("reporte-borrar",{id:rp[0].id}); console.log("BORRADO:", (await api("reportes?p=dia")).length);
// G) Baja
const B="5491100000013"; geminiResp={respuesta:"perdon, no te escribo mas"}; await msg(B,"hola"); await msg(B,"no me escribas mas");
const eb=JSON.parse((await env.DB.prepare("SELECT v FROM kv WHERE k=?").bind("v3:"+B).first()).v); console.log("BAJA:", !!eb.baja, !!eb.sinInteres);
