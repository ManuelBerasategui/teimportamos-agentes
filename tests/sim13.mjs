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
async function msg(from, body, type="text"){ const m={from,id:"w"+(++n),type, ...(type==="text"?{text:{body}}:{image:{id:"img"+n,caption:body}})};
  await W.fetch(new Request("https://x/",{method:"POST",body:JSON.stringify({entry:[{changes:[{field:"messages",value:{messages:[m],contacts:[{profile:{name:"Beni"}}]}}]}]})}),env,ctx); await flush(); }
// login cookie
const lr = await W.fetch(new Request("https://x/login",{method:"POST",body:new URLSearchParams({u:"admin",p:"x"})}),env,ctx);
const cookie = lr.headers.get("set-cookie").split(";")[0];
const api = async (r,b)=> (await W.fetch(new Request("https://x/panel/api/"+r,{method:b?"POST":"GET",headers:{cookie},body:b?JSON.stringify(b):undefined}),env,ctx)).json();



const tit=async(tel)=>(await api("tareas")).filter(x=>x.tel===tel).map(x=>x.titulo+" || "+x.detalle.split("DATOS USADOS:")[1]);
const out=(t)=>sent.filter(s=>s[0]===t).map(s=>s[1]);
// 1) Menú con "quiero importar"
const M="5491100000090"; geminiResp={respuesta:"hola"}; await msg(M,"Hola, quiero importar un producto"); console.log("MENU:", out(M));
// 2) Bajo mínimo: pide 20, proveedor desde 50
const I="5491100000091"; geminiResp={respuesta:"x",es_proveedor:true,producto:{nombre:"Light Box",tramos:[{desde:50,precio:30}],peso_kg:2}};
await msg(I,"quiero 20 de estos","image"); console.log("MIN:", out(I), await tit(I));
// 3) Link ML: búsqueda sin pedir Alibaba
const T="5491100000092"; sent.length=0; geminiResp={respuesta:"x",requiere_busqueda:true,descripcion_producto:"consola R36"};
await msg(T,"https://www.mercadolibre.com.ar/consola-r36 quiero 25"); console.log("B1:", out(T));
geminiResp={respuesta:"x",requiere_busqueda:false}; sent.length=0;
await msg(T,"originales"); console.log("B2:", out(T));
sent.length=0; await msg(T,"buscalo vos"); console.log("B3:", out(T), (await api("tareas")).filter(x=>x.tel===T).map(x=>x.titulo));
