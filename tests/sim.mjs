import { DatabaseSync } from "node:sqlite";
import fs from "fs";
const src = fs.readFileSync("src/worker.js","utf8");
fs.writeFileSync("/tmp/wk.mjs", src); fs.copyFileSync("src/lector.js","/tmp/lector.js"); fs.copyFileSync("src/lector-panel.js","/tmp/lector-panel.js"); 
const W = (await import("/tmp/wk.mjs")).default;
const db = new DatabaseSync(":memory:");
const stmt = (sql, b=[]) => ({ bind:(...x)=>stmt(sql,x), run: async()=>{db.prepare(sql).run(...b);return{}}, first: async()=>db.prepare(sql).get(...b)??null, all: async()=>({results:db.prepare(sql).all(...b)}) });
const DB = { prepare:(s)=>stmt(s), batch: async(a)=>{for(const x of a) await x.run();} };
const sent=[]; let geminiResp = {};
globalThis.fetch = async (url, o={}) => {
  url=String(url);
  if (url.includes("/messages")) { const b=JSON.parse(o.body); if(b.to) sent.push([b.to, b.text?.body || b.type]); return new Response(JSON.stringify({messages:[{id:"wamid."+Math.random().toString(36).slice(2)}]}),{status:200}); }
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

// 1) Beni: captura de precios sin peso, 2 veces, luego otra vez -> deriva
const C="5493513329589";
geminiResp={respuesta:"x",es_proveedor:true,producto:{nombre:"Zapatilla",tramos:[{desde:1,precio:10}],peso_kg:null},requiere_busqueda:false};
await msg(C,"hola"); await msg(C,"",'image'); await msg(C,"",'image'); 
const r1 = sent.filter(s=>s[0]===C).map(s=>s[1]).join(" | ");
console.log("BENI 2 pedidos:", /otra forma/.test(r1) ? "OK pide distinto la 2a vez" : "FALLA", );
await msg(C,"",'image');
let t = await api("tareas"); console.log("Tareas tras 3a:", t.map(x=>x.tipo+":"+x.titulo));
console.log("Avisos al equipo:", sent.filter(s=>s[0]!==C).map(s=>s[0]+" -> "+s[1]));
// 2) Cotización completa
sent.length=0; const D="5491140306380";
geminiResp={respuesta:"x",es_proveedor:true,producto:{nombre:"Sillin",tramos:[{desde:1,precio:2}],peso_kg:null}};
await msg(D,"hola"); await msg(D,"","image"); await msg(D,"pesa 0,5 kg y quiero 100");
t = await api("tareas"); const cot=t.find(x=>x.tipo==="cotizacion"); console.log("Cotización en panel:", !!cot, "| avisos:", sent.filter(s=>s[0]!==D).map(s=>s[0]+" -> "+s[1]));
sent.length=0; console.log("Aprobar:", (await api("tarea",{id:cot.id,a:"ok"})).res, "| al cliente:", sent.filter(s=>s[0]===D).length, "msg");
// 3) Horas y mensajes largos
const ch = await api("chat?tel="+D); console.log("Horas:", ch.mensajes.map(m=>m.ts?1:0).join(""), "| largo max", Math.max(...ch.mensajes.map(m=>m.t.length)));
const ls = await api("chats"); console.log("Lista pend:", ls.map(c=>c.nombre+":"+c.pend));
// 4) responder desde panel cierra derivado de Beni
await api("enviar",{tel:C,texto:"hola, soy del equipo"}); t=await api("tareas"); console.log("Tras responder a Beni:", t.map(x=>x.tipo+":"+x.tel));
// 5) promesa
geminiResp={respuesta:"no te preocupes, dejamelo a mi que lo averiguo||te aviso apenas lo tenga"}; await msg("5491172167049","no tengo el peso");
t=await api("tareas"); console.log("Promesa:", t.some(x=>x.tipo==="promesa"));
// 6) cron sin resumen horario
sent.length=0; await W.scheduled({scheduledTime:Date.UTC(2026,9,4,15,0)},env,ctx); await flush(); console.log("Mensajes en cron hora en punto:", sent.length);
// 7) importar viejos
await env.DB.prepare("DELETE FROM tareas").run();
const E = (await import("/tmp/wk.mjs"));
console.log("Viejos:", await api("importar-viejos"), (await api("tareas")).map(x=>x.tipo));
