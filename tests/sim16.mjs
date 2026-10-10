// Auditoría de cotizaciones por IA (capturas/PDF) + pendientes desde el 805 + alertas agrupadas
import { DatabaseSync } from "node:sqlite";
import fs from "fs";
fs.copyFileSync("src/lector.js", "/tmp/lector16.js");
const L = await import("/tmp/lector16.js");
const db = new DatabaseSync(":memory:");
const stmt = (sql, b=[]) => ({ bind:(...x)=>stmt(sql,x), run: async()=>{db.prepare(sql).run(...b);return{}}, first: async()=>db.prepare(sql).get(...b)??null, all: async()=>({results:db.prepare(sql).all(...b)}) });
const tg=[]; globalThis.fetch=async(u,o={})=>{ if(String(u).includes("telegram")){tg.push(JSON.parse(o.body).text);return new Response('{"ok":true}');} return new Response("{}"); };
const env = { DB: { prepare:(s)=>stmt(s), batch: async(a)=>{for(const x of a) await x.run();} }, LECTOR_TOKEN:"t", TELEGRAM_TOKEN:"x", TELEGRAM_CHAT:"1" };
let ok=0, mal=0; const chk=(n,c)=>{c?ok++:(mal++,console.log("FALLA:",n));};
await L.analizarChats(env, async()=>({chats:[]}));   // crea tablas
const AR=3*3600e3, dia="2026-10-09", ini=Date.parse(dia+"T00:00:00Z")+AR;
const msg=(id,conv,yo,texto,h)=>db.prepare("INSERT INTO w_msg (id,conv,grupo,yo,tipo,texto,ts) VALUES (?,?,0,?,?,?,?)").run(id,conv,yo,"text",texto,ini+h*3600e3);
db.prepare("INSERT INTO w_conv (conv,nombre,grupo,primer_ts,ult_ts,ult_yo,ult_cliente_ts,n) VALUES ('111','Santy',0,?,?,0,?,5)").run(ini,ini+15*3600e3,ini+15*3600e3);
db.prepare("INSERT INTO w_conv (conv,nombre,grupo,primer_ts,ult_ts,ult_yo,ult_cliente_ts,n,prov) VALUES ('222','Michael Shop',0,?,?,1,?,3,1)").run(ini,ini+10*3600e3,ini+9*3600e3);
msg("a","111",0,"cuanto me sale 50?",10); msg("b","111",1,"ahi te cotizo",11); msg("c","111",1,"(archivo)",11.1); msg("d","111",1,"te armo por 80 y 100",12); msg("e","111",1,"(archivo)",12.1); msg("f","111",0,"dale gracias",15);
msg("g","222",1,"(archivo)",10); db.prepare("INSERT INTO w_hito (id,conv,tipo,ts,dato) VALUES ('c:x','111','cotizacion',?,'viejo')").run(ini+11*3600e3);
let prompt="";
const ia=async(_e,p)=>{prompt=p; return {chats:[{chat:"111|"+dia,es_cliente:true,cotizaciones:[{msg:2,producto:"set ducha 50u"},{msg:4,producto:"set ducha 80/100u"}]},{chat:"222|"+dia,es_cliente:false,cotizaciones:[{msg:0,producto:"x"}]}]};};
const r=await L.auditarCotizaciones(env, ia, {dia});
chk("audita 2 chats", r.auditados===2);
chk("prompt marca archivos", prompt.includes("(archivo)") && prompt.includes("111|"+dia));
const m=await L.metricas(env, ini, ini+86400e3);
chk("2 cotizaciones (reemplaza la regex)", m.cotizaciones===2);
chk("proveedor no cuenta", db.prepare("SELECT COUNT(*) n FROM w_hito WHERE conv='222'").get().n===0);
chk("no re-audita", (await L.auditarCotizaciones(env, ia, {dia})).pendientes===0);
// pendientes desde el análisis
db.prepare("UPDATE w_conv SET analizado_ts=0").run();
const ana=async()=>({chats:[{conv:"111",puntaje:8,temp:"caliente",producto:"set ducha",etapa:"cotizado",necesita_respuesta:false,pendiente:{tipo:"promesa",titulo:"Pasarle cotización por 300 u por barco",detalle:"Quedamos en evaluar 300 u"}}]});
// la vuelta de análisis toma chats de los últimos 14 días respecto a "ahora": ajusto ult_ts
db.prepare("UPDATE w_conv SET ult_ts=?, ult_cliente_ts=?",).run(Date.now()-3600e3, Date.now()-3600e3);
await L.analizarChats(env, ana);
const t=db.prepare("SELECT * FROM tareas WHERE ref='w805:111'").all();
chk("crea pendiente", t.length===1 && t[0].tipo==="promesa" && t[0].estado==="abierta");
db.prepare("UPDATE w_conv SET analizado_ts=0").run(); await L.analizarChats(env, ana);
chk("no duplica", db.prepare("SELECT COUNT(*) n FROM tareas").get().n===1);
db.prepare("UPDATE tareas SET estado='hecha'").run(); db.prepare("UPDATE w_conv SET analizado_ts=0").run(); await L.analizarChats(env, ana);
chk("si lo cerré no vuelve hasta que escriba", db.prepare("SELECT COUNT(*) n FROM tareas WHERE estado='abierta'").get().n===0);
db.prepare("UPDATE w_conv SET analizado_ts=0, ult_cliente_ts=?").run(Date.now()); await L.analizarChats(env, async()=>({chats:[{conv:"111",puntaje:8,etapa:"falta_cotizar",pendiente:{tipo:"cotizacion",titulo:"Cotizar 300 u"}}]}));
chk("nuevo pendiente tras mensaje", db.prepare("SELECT COUNT(*) n FROM tareas WHERE estado='abierta' AND tipo='cotizacion'").get().n===1);
db.prepare("UPDATE w_conv SET analizado_ts=0").run(); await L.analizarChats(env, async()=>({chats:[{conv:"111",puntaje:8,etapa:"cotizado",pendiente:null}]}));
chk("se cierra solo si ya se cumplió", db.prepare("SELECT COUNT(*) n FROM tareas WHERE estado='abierta'").get().n===0);
// alertas: 1 solo mensaje, una vez por día
db.prepare("UPDATE w_conv SET ult_yo=0, resp=1, puntaje=9, ult_cliente_ts=?, alerta_ts=0, etapa='consulta', accion='mandale precio' WHERE conv='111'").run(Date.now()-90*60e3);
const n1=await L.alertasRapidas(env), n2=await L.alertasRapidas(env);
const h=new Date(Date.now()-AR).getUTCHours();
if (h>=9 && h<23) { chk("alerta agrupada", n1===1 && tg.length===1 && tg[0].startsWith("Importante")); chk("no repite", n2===0); }
// ventas y chats nuevos por auditoría
const d2="2026-10-08", i2=Date.parse(d2+"T00:00:00Z")+AR;
const m2=(id,conv,yo,texto,h)=>db.prepare("INSERT INTO w_msg (id,conv,grupo,yo,tipo,texto,ts) VALUES (?,?,0,?,?,?,?)").run(id,conv,yo,"text",texto,i2+h*3600e3);
db.prepare("INSERT INTO w_conv (conv,nombre,grupo,primer_ts,ult_ts,ult_yo,ult_cliente_ts,n) VALUES ('333','Facu',0,?,?,1,?,3)").run(i2-5*86400e3,i2+12*3600e3,i2+11*3600e3);
db.prepare("INSERT INTO w_conv (conv,nombre,grupo,primer_ts,ult_ts,ult_yo,ult_cliente_ts,n) VALUES ('444','Nuevo',0,?,?,1,?,3)").run(i2+9*3600e3,i2+10*3600e3,i2+9*3600e3);
db.prepare("INSERT INTO w_conv (conv,nombre,grupo,primer_ts,ult_ts,ult_yo,ult_cliente_ts,n) VALUES ('555','Viejo',0,?,?,1,?,3)").run(i2+9*3600e3,i2+10*3600e3,i2+9*3600e3);
m2("v0","333",1,"vieja",-100); m2("v1","333",1,"ya salio tu pedido, codigo AB123",12); m2("v2","444",0,"hola cuanto sale",9); m2("v3","444",1,"te paso el alias",9.5); m2("v4","444",0,"(archivo)",10); m2("v5","444",1,"recibido!",10.1);
m2("v6","555",0,"hola, te escribo por el pedido que te hice",9); m2("v7","555",1,"si dale",9.5);
let pr="";
const ia2=async(_e,p)=>{pr=p; return {chats:[{chat:"333|"+d2,interno:false,primer_contacto:false,cotizaciones:[],venta:null},{chat:"444|"+d2,interno:false,primer_contacto:true,cotizaciones:[],venta:{msg:3,producto:"auriculares",monto:"USD 120"}},{chat:"555|"+d2,interno:false,primer_contacto:false,cotizaciones:[],venta:null}]};};
await L.auditarCotizaciones(env, ia2, {dia:d2});
chk("marca historial previo", pr.includes("333|"+d2+" (Facu) [hay mensajes de días anteriores]"));
chk("aviso de seguimiento no es venta", db.prepare("SELECT COUNT(*) n FROM w_hito WHERE conv='333' AND tipo='venta'").get().n===0);
const v=db.prepare("SELECT * FROM w_hito WHERE conv='444' AND tipo='venta'").get();
chk("venta con hora del pago", v && v.ts===i2+10.1*3600e3);
const mm=await L.metricas(env, i2, i2+86400e3);
chk("ventas del día = 1", mm.ventas===1);
chk("nuevos excluye cliente viejo", mm.nuevos===1);
db.prepare("UPDATE w_hito SET oculto=1 WHERE conv='444'").run(); await L.auditarCotizaciones(env, ia2, {dia:d2, rehacer:true});
chk("oculta sigue oculta", (await L.metricas(env, i2, i2+86400e3)).ventas===0);
console.log(`sim16: ${ok} ok, ${mal} fallas`);
