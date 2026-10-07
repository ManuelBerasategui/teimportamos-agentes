// Pantalla del panel: /panel/805 · WhatsApp (solo lectura del 805) + asistente interno
export const PANEL_805 = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>WhatsApp · Te Importamos</title>
<style>
:root{--neg:#0B0B0B;--nar:#EA5B0C;--ver:#1FA855;--ver2:#E7F6EC;--fondo:#F4F5F7;--borde:#E4E7EB;--txt:#111827;--gris:#6B7280;--gris2:#9CA3AF;
 --rojo:#DC2626;--rojo2:#FDECEC;--amb:#B45309;--amb2:#FEF3C7;--azul:#2563EB;--azul2:#E8F0FE}
*{box-sizing:border-box}body{margin:0;font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:var(--fondo);color:var(--txt);font-size:14px}
header{display:flex;align-items:center;gap:6px;padding:0 18px;height:54px;background:var(--neg);border-bottom:3px solid var(--nar);position:sticky;top:0;z-index:5}
header b{color:#25D366;font-size:17px;margin-right:14px;letter-spacing:.2px}header a{color:#D1D5DB;text-decoration:none;font-weight:600;margin-left:auto;font-size:13px}
.tab{border:0;background:none;padding:7px 12px;border-radius:7px;font-weight:600;color:#D1D5DB;cursor:pointer;font-size:14px}.tab.on{background:#25D366;color:var(--neg)}
main{padding:16px;max-width:1320px;margin:0 auto}
.barra{display:flex;align-items:center;gap:10px;margin-bottom:12px;flex-wrap:wrap}.estado{font-size:12.5px;color:var(--gris)}.punto{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px;vertical-align:middle}
.seg{display:inline-flex;background:#fff;border:1px solid var(--borde);border-radius:8px;padding:2px}.seg button{border:0;background:none;padding:6px 12px;border-radius:6px;font-weight:600;color:var(--gris);cursor:pointer;font-size:13px}.seg button.on{background:var(--neg);color:#fff}
.btn{border:1px solid var(--borde);background:#fff;padding:7px 12px;border-radius:8px;cursor:pointer;font-weight:600;font-size:13px;color:var(--txt)}.btn.p{background:var(--ver);border-color:var(--ver);color:#fff}.btn:disabled{opacity:.6}
.kpis{display:grid;grid-template-columns:repeat(6,1fr);gap:10px;margin-bottom:12px}
.kpi{background:#fff;border:1px solid var(--borde);border-radius:10px;padding:10px 12px;border-top:3px solid var(--c,var(--gris2))}.kpi small{color:var(--gris);font-weight:600;font-size:12px;display:block}.kpi div{font-size:24px;font-weight:700;margin-top:2px}.kpi i{font-style:normal;font-size:11.5px;color:var(--gris2)}
.grid{display:grid;grid-template-columns:minmax(0,1.55fr) minmax(0,1fr);gap:12px}
.card{background:#fff;border:1px solid var(--borde);border-radius:10px;min-width:0;display:flex;flex-direction:column}
.card h3{margin:0;font-size:13.5px;font-weight:700;padding:11px 14px;border-bottom:1px solid var(--borde);display:flex;align-items:center;gap:8px}
.card h3 .cnt{background:var(--fondo);color:var(--gris);border-radius:99px;padding:1px 8px;font-size:12px}
.subtabs{display:flex;gap:2px;padding:8px 10px 0;border-bottom:1px solid var(--borde)}.subtabs button{border:0;background:none;padding:8px 10px;font-weight:600;color:var(--gris);cursor:pointer;border-bottom:2px solid transparent;font-size:13px}.subtabs button.on{color:var(--txt);border-color:var(--nar)}
.subtabs button span{margin-left:5px;font-size:11.5px;background:var(--fondo);border-radius:99px;padding:0 6px}
table{width:100%;border-collapse:collapse}td{padding:9px 12px;border-bottom:1px solid #F0F1F3;vertical-align:top}tr{cursor:pointer}tr:hover td{background:#FAFAFB}
td.n{width:30%}td.n b{display:block;font-size:13.5px}td.n small{color:var(--gris2);font-size:11.5px}td.p{color:var(--gris);font-size:12.5px}td.a{font-size:12.5px;color:var(--txt)}td.h{white-space:nowrap;text-align:right;color:var(--gris);font-size:12px;width:70px}
.sc{display:inline-block;min-width:26px;text-align:center;border-radius:6px;padding:1px 6px;font-size:12px;font-weight:700;margin-top:3px}.sc.c{background:var(--rojo2);color:var(--rojo)}.sc.t{background:var(--amb2);color:var(--amb)}.sc.f{background:var(--azul2);color:var(--azul)}.sc.s{background:var(--fondo);color:var(--gris)}
.vacio{color:var(--gris2);padding:16px 14px;font-size:13px}.scroll{overflow:auto;max-height:440px}
.lado{display:flex;flex-direction:column;gap:12px;min-width:0}
.asis{height:520px}.msgs{flex:1;overflow:auto;padding:12px;display:flex;flex-direction:column;gap:8px;background:#FAFAFB}
.b{max-width:92%;padding:8px 11px;border-radius:10px;white-space:pre-wrap;line-height:1.45;font-size:13.5px}.b.u{align-self:flex-end;background:var(--neg);color:#fff}.b.a{align-self:flex-start;background:#fff;border:1px solid var(--borde)}.b a{color:var(--ver);font-weight:600;cursor:pointer;text-decoration:none}
.sug{display:flex;gap:6px;flex-wrap:wrap;padding:8px 12px 0}.sug button{border:1px solid var(--borde);background:#fff;border-radius:99px;padding:4px 10px;font-size:12px;color:var(--gris);cursor:pointer}
.comp{display:flex;gap:8px;padding:10px 12px;border-top:1px solid var(--borde)}.comp input{flex:1;padding:9px 11px;border:1px solid var(--borde);border-radius:8px;font-size:14px}
.bars{display:flex;align-items:flex-end;gap:4px;height:80px;padding:18px 14px 6px}.bars div{flex:1;background:#BFE8CC;border-radius:3px 3px 0 0;position:relative;min-height:2px}.bars div.hoy{background:var(--ver)}.bars span{position:absolute;top:-15px;left:0;right:0;text-align:center;font-size:10.5px;color:var(--gris)}
.prods{padding:4px 14px 12px;display:flex;flex-wrap:wrap;gap:6px}.prods span{background:var(--fondo);border-radius:6px;padding:3px 8px;font-size:12px;color:var(--txt)}.prods span b{color:var(--nar);margin-left:4px}
.chats{display:grid;grid-template-columns:340px 1fr;gap:12px;height:calc(100vh - 130px)}.lista{overflow:auto}.conv{background:#EFEAE2;border:1px solid var(--borde);border-radius:10px;overflow:auto;padding:12px;display:flex;flex-direction:column;gap:6px}
.it{padding:9px 12px;border-bottom:1px solid #F0F1F3;cursor:pointer}.it:hover{background:#FAFAFB}.it .t{display:flex;justify-content:space-between;gap:8px;font-weight:600;font-size:13.5px}.it .s{color:var(--gris);font-size:12.5px;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.m{max-width:75%;padding:7px 10px;border-radius:8px;background:#fff;white-space:pre-wrap;word-wrap:break-word;font-size:13.5px}.m.yo{align-self:flex-end;background:#D9FDD3}.m small{display:block;color:var(--gris);font-size:11px;margin-top:3px;text-align:right}
.ficha{background:#fff;border-radius:8px;padding:10px 12px;font-size:13px;margin-bottom:6px;line-height:1.5}
input.f,select{padding:8px 10px;border:1px solid var(--borde);border-radius:8px;font-size:13.5px;background:#fff}
.rep{background:#fff;border:1px solid var(--borde);border-radius:10px;margin-bottom:8px}.rep summary{display:flex;align-items:center;gap:12px;padding:12px 16px;cursor:pointer;list-style:none}.rep summary::-webkit-details-marker{display:none}.rep summary:before{content:"";width:7px;height:7px;border-right:2px solid var(--gris);border-bottom:2px solid var(--gris);transform:rotate(-45deg);transition:.15s}.rep[open] summary:before{transform:rotate(45deg)}.rt{font-weight:700}.rk{color:var(--gris);font-size:12.5px;flex:1}.borrar{padding:4px 10px;font-size:12px;color:var(--rojo)}.rb{padding:0 16px 14px;border-top:1px solid var(--borde)}.rep h5{margin:12px 0 4px;font-size:13px}.dif{border:1px solid var(--borde);border-left:3px solid var(--ver);border-radius:8px;padding:10px 12px;margin:8px 0}.dt{display:flex;justify-content:space-between;align-items:center;gap:8px}.dif pre{white-space:pre-wrap;font-family:inherit;background:var(--fondo);border-radius:6px;padding:8px 10px;margin:6px 0 0;font-size:13px}.rep h4{margin:0 0 2px}.rep ul{margin:6px 0;padding-left:18px}.rep .kv{display:flex;gap:16px;flex-wrap:wrap;margin:8px 0;font-size:13px}.rep .kv b{font-size:16px;display:block}
.conf{max-width:760px}.conf .card{padding:14px 16px;margin-bottom:12px}.conf h4{margin:0 0 6px}
code{display:block;background:var(--neg);color:#25D366;padding:8px;border-radius:8px;margin:8px 0;font-size:12px;word-break:break-all}
@media(max-width:640px){header{gap:1px;padding:0 8px;overflow-x:auto;white-space:nowrap}header a{font-size:0}header a:after{content:"\\2190";font-size:18px}.tab{padding:5px 6px;font-size:12px}header b{font-size:14px;margin-right:4px}.subtabs{overflow-x:auto}.subtabs button{white-space:nowrap}body{overflow-x:hidden}}
@media(max-width:1000px){.kpis{grid-template-columns:repeat(3,1fr)}.grid{grid-template-columns:1fr}.asis{height:460px}.chats{grid-template-columns:1fr;height:auto}.lista{max-height:45vh}.conv{min-height:60vh}td.p{display:none}main{padding:10px}header{padding:0 10px}header b{margin-right:4px}.tab{padding:6px 8px;font-size:13px}}
</style><script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script></head><body>
<header><b>WhatsApp</b><button class="tab on" data-v="res">Resumen</button><button class="tab" data-v="chats">Chats</button><button class="tab" data-v="reps">Reportes</button><button class="tab" data-v="conf">Conexión</button><a href="/panel">Panel principal</a></header>
<main>
<section id="v-res">
  <div class="barra"><span class="estado" id="estado"></span><span style="flex:1"></span><div class="seg" id="periodo"><button data-p="dia" class="on">Hoy</button><button data-p="semana">7 días</button><button data-p="mes">30 días</button></div><button class="btn" id="bAnalizar">Analizar ahora</button></div>
  <div class="kpis" id="kpis"></div>
  <div class="grid">
    <div class="card">
      <h3>Para hacer</h3>
      <div class="subtabs" id="st"><button data-l="sin" class="on">Responder ya<span id="n-sin"></span></button><button data-l="esc">Escribirles<span id="n-esc"></span></button><button data-l="cot">Esperan cotización<span id="n-cot"></span></button><button data-l="ven">Ventas<span id="n-ven"></span></button></div>
      <div class="scroll"><table id="tabla"></table></div>
    </div>
    <div class="lado">
      <div class="card asis">
        <h3>Asistente</h3>
        <div class="msgs" id="msgs"><div class="b a">Preguntame lo que quieras sobre los chats del 805. Por ejemplo: a quién le tenías que mandar un producto, qué se pidió más hoy o quién quedó sin respuesta.</div></div>
        <div class="sug" id="sug"><button>Qué productos se pidieron más hoy</button><button>A quién tengo que responder primero</button><button>Qué cotizaciones quedaron pendientes</button></div>
        <form class="comp" id="fAsis"><input id="pregunta" placeholder="Escribí tu pregunta" autocomplete="off"><button class="btn p">Enviar</button></form>
      </div>
      <div class="card"><h3>Chats nuevos por día <span class="cnt">14 días</span></h3><div class="bars" id="barras"></div><h3 style="border-top:1px solid var(--borde)">Más pedidos <span class="cnt">7 días</span></h3><div class="prods" id="lProd"></div></div>
    </div>
  </div>
</section>
<section id="v-chats" hidden>
  <div class="barra"><input class="f" id="q" placeholder="Buscar nombre, número o producto" style="flex:1;min-width:180px"><select id="f"><option value="todos">Todos</option><option value="calientes">Calientes</option><option value="sin">Sin responder</option><option value="cotizar">Esperan cotización</option><option value="grupos">Grupos</option><option value="archivados">Archivados</option></select></div>
  <div class="chats"><div class="card lista" id="lista"></div><div class="conv" id="conv"><div class="vacio">Elegí un chat. Esta vista es solo lectura: para responder usá el celular.</div></div></div>
</section>
<section id="v-reps" hidden>
  <div class="barra"><button class="btn p" id="bDiario">Generar reporte de hoy</button><button class="btn" id="bSemanal">Generar reporte semanal</button><span class="estado">Se generan solos a las 21:00, y los domingos el semanal.</span></div>
  <div id="reps"></div>
</section>
<section id="v-conf" hidden><div class="conf">
  <div class="card"><h4>Estado del lector</h4><div id="confEstado" class="estado"></div></div>
  <div class="card"><h4>Vincular con QR</h4>
    <div class="estado">En el celular del 805, en Termux, corré este comando. El QR aparece acá; escanealo desde WhatsApp Business, Dispositivos vinculados, Vincular un dispositivo.</div>
    <code>QR=1 bash -c "$(curl -sL https://raw.githubusercontent.com/ManuelBerasategui/teimportamos-agentes/main/lector/termux.sh)"</code>
    <div id="qrBox" class="estado" style="display:inline-block;padding:10px;border:1px solid var(--borde);border-radius:10px;min-width:120px">Esperando QR</div></div>
  <div class="card"><h4>Alertas por Telegram</h4>
    <ol class="estado" style="line-height:1.7;margin:4px 0 10px;padding-left:18px"><li>En Telegram abrí @BotFather, /newbot, y poné un nombre. Te da un token.</li><li>En Cloudflare, cotizador, Settings, Variables: agregá TELEGRAM_TOKEN (tipo Secret).</li><li>Abrí tu bot y escribile /start.</li><li>Tocá Conectar Telegram.</li></ol>
    <button class="btn p" id="bTg">Conectar Telegram</button> <button class="btn" id="bProbar">Probar alertas</button> <span id="tgRes" class="estado"></span></div>
</div></section>
</main>
<script>
const $=s=>document.querySelector(s);const api=(p,b)=>fetch('/panel/api/805/'+p,b?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)}:{}).then(r=>r.json());
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const hora=ts=>{if(!ts)return'';const d=new Date(ts),h=new Date();return d.toDateString()===h.toDateString()?d.toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit'}):d.toLocaleDateString('es-AR',{day:'2-digit',month:'2-digit'})};
const hace=ts=>{const m=Math.round((Date.now()-ts)/60000);return m<60?m+' min':m<1440?Math.round(m/60)+' h':Math.round(m/1440)+' d'};
const tel=c=>/^\\d+$/.test(c)?'+'+c:c;
const sc=c=>c.puntaje?'<span class="sc '+({caliente:'c',tibio:'t',frio:'f'}[c.temp]||'s')+'">'+c.puntaje+'</span>':'<span class="sc s">-</span>';
const acc=a=>a?String(a).replace(/\\|p\\d$/,''):'';
const nom=c=>esc(c.nombre||tel(c.conv));
let datos=null,per='dia',lista='sin';
async function cargar(){datos=await api('resumen');pintar()}
function fila(c,extra,txt){return '<tr data-c="'+esc(c.conv)+'"><td class="n"><b>'+nom(c)+'</b>'+(c.nombre?'<small>'+tel(c.conv)+'</small> ':'')+sc(c)+'</td><td class="p">'+esc(c.producto||'')+'</td><td class="a">'+esc(txt!==undefined?txt:(acc(c.accion)||c.resumen||c.ult_texto||''))+'</td><td class="h">'+extra+'</td></tr>'}
function pintarLista(){const d=datos;if(!d)return;let h='';
 if(lista==='sin')h=d.sinResponder.map(c=>fila(c,hace(c.ult_cliente_ts),acc(c.accion)||c.ult_texto)).join('');
 if(lista==='esc')h=d.escribiles.map(c=>fila(c,hora(c.ult_ts))).join('');
 if(lista==='cot')h=d.cotPend.map(c=>fila(c,hace(c.ult_cliente_ts||c.ult_ts))).join('');
 if(lista==='ven')h=d.ventasRec.map(v=>fila({conv:v.conv,nombre:v.nombre,producto:v.producto},hora(v.ts),v.dato)).join('');
 $('#tabla').innerHTML=h||'<tr><td class="vacio">Nada por acá</td></tr>'}
function pintar(){const d=datos;if(!d)return;const p=d[per];
 const k=[['Chats nuevos',p.nuevos,'#1FA855'],['Cotizaciones',p.cotizaciones,'#EA5B0C',p.chatsCotizados+' chats'],['Ventas',p.ventas,'#2563EB'],['Sin responder',p.sinResponder,'#DC2626','últimas 72 h'],['Respuesta',p.respuestaMin==null?'-':p.respuestaMin+' min','#6B7280','mediana'],['Conversión',p.conversion==null?'-':p.conversion+'%','#0B0B0B','cotizado a venta']];
 $('#kpis').innerHTML=k.map(x=>'<div class="kpi" style="--c:'+x[2]+'"><small>'+x[0]+'</small><div>'+x[1]+'</div>'+(x[3]?'<i>'+x[3]+'</i>':'')+'</div>').join('');
 $('#n-sin').textContent=d.sinResponder.length;$('#n-esc').textContent=d.escribiles.length;$('#n-cot').textContent=d.cotPend.length;$('#n-ven').textContent=d.ventasRec.length;pintarLista();
 const ser=Object.entries(d.nuevosPorDia||{}),mx=Math.max(1,...ser.map(x=>x[1]));$('#barras').innerHTML=ser.map(([k,v],i)=>'<div class="'+(i===ser.length-1?'hoy':'')+'" title="'+k+': '+v+'" style="height:'+(v/mx*100)+'%"><span>'+v+'</span></div>').join('');
 $('#lProd').innerHTML=(d.productos||[]).map(x=>'<span>'+esc(x.producto)+'<b>'+x.n+'</b></span>').join('')||'<span class="vacio">Sin datos todavía</span>';
 const e=d.estado,ult=d.ultimo,ok=ult&&Date.now()-ult<6*3600e3&&e?.evento!=='logged_out';
 $('#estado').innerHTML=!d.configurado?'<span class="punto" style="background:#DC2626"></span>Lector sin configurar':'<span class="punto" style="background:'+(ok?'#1FA855':'#DC2626')+'"></span>'+(ult?(ok?'Conectado':'Sin datos recientes')+' · último mensaje hace '+hace(ult):'Esperando el primer mensaje');
 $('#confEstado').innerHTML=$('#estado').innerHTML+'<br>Telegram: '+(d.telegram?'conectado':'no conectado')}
document.querySelectorAll('#periodo button').forEach(b=>b.onclick=()=>{per=b.dataset.p;document.querySelectorAll('#periodo button').forEach(x=>x.classList.toggle('on',x===b));pintar()});
document.querySelectorAll('#st button').forEach(b=>b.onclick=()=>{lista=b.dataset.l;document.querySelectorAll('#st button').forEach(x=>x.classList.toggle('on',x===b));pintarLista()});
document.addEventListener('click',e=>{const it=e.target.closest('[data-c]');if(it&&it.dataset.c&&it.dataset.c!=='undefined')abrir(it.dataset.c)});
async function abrir(conv){vista('chats');location.hash=encodeURIComponent(conv);const r=await api('chat?conv='+encodeURIComponent(conv));const c=r.conv||{conv};
 $('#conv').innerHTML='<div class="ficha"><b>'+nom(c)+'</b> · '+tel(conv)+' '+sc(c)+(c.producto?'<br><b>Busca:</b> '+esc(c.producto):'')+(c.resumen?'<br>'+esc(c.resumen):'')+(acc(c.accion)?'<br><b>Pendiente:</b> '+esc(acc(c.accion)):'')+'<br><span class="estado">'+(r.hitos||[]).map(h=>h.tipo+' '+hora(h.ts)).join(' · ')+'</span> <button class="btn" style="padding:3px 8px;margin-top:6px" onclick="archivar(\\''+esc(conv)+'\\','+(c.archivado?0:1)+')">'+(c.archivado?'Desarchivar':'Archivar (no es cliente)')+'</button></div>'+
 r.mensajes.map(m=>'<div class="m '+(m.yo?'yo':'')+'">'+(!m.yo&&m.autor_nombre&&c.grupo?'<b>'+esc(m.autor_nombre)+'</b>\\n':'')+esc(m.texto)+'<small>'+hora(m.ts)+'</small></div>').join('');$('#conv').scrollTop=1e9}
async function archivar(conv,si){await api('archivar',{conv,si});abrir(conv);listar();cargar()}
async function listar(){const l=await api('chats?f='+$('#f').value+'&q='+encodeURIComponent($('#q').value));$('#lista').innerHTML=l.map(c=>'<div class="it" data-c="'+esc(c.conv)+'"><div class="t"><span>'+nom(c)+' '+sc(c)+'</span><span class="estado">'+hora(c.ult_ts)+'</span></div><div class="s">'+esc(c.producto?c.producto+' · ':'')+esc(c.ult_texto||'')+'</div></div>').join('')||'<div class="vacio">Sin chats</div>'}
async function reportes(){const l=await api('reportes');$('#reps').innerHTML=l.map((r,ix)=>{const d=r.datos||{},m=d.metricas||{},ia=d.ia||{};const titulo=(r.tipo==='805_semanal'?'Semanal':'Diario')+' · '+new Date(r.desde).toLocaleDateString('es-AR')+(r.tipo==='805_semanal'?' al '+new Date(r.hasta-1).toLocaleDateString('es-AR'):'');
 const dif=(ia.difusion||[]).map((x,k)=>'<div class="dif"><div class="dt"><b>'+esc(x.producto)+'</b><button class="btn" data-copiar="'+ix+'-'+k+'">Copiar mensaje</button></div><div class="estado">'+esc(x.por_que||'')+'</div><pre id="m-'+ix+'-'+k+'">'+esc(x.mensaje||'')+'</pre></div>').join('');
 return '<details class="rep"'+(ix===0?' open':'')+'><summary><span class="rt">'+titulo+'</span><span class="rk">'+(m.nuevos??0)+' nuevos · '+(m.cotizaciones??0)+' cotizaciones · '+(m.ventas??0)+' ventas</span><button class="btn borrar" data-borrar="'+esc(r.id)+'">Borrar</button></summary><div class="rb"><div class="estado">Generado '+new Date(r.creado).toLocaleString('es-AR')+'</div>'+(ia.titular?'<p><b>'+esc(ia.titular)+'</b></p>':'')+'<div class="kv"><div>Chats nuevos<b>'+(m.nuevos??0)+'</b></div><div>Cotizaciones<b>'+(m.cotizaciones??0)+'</b></div><div>Ventas<b>'+(m.ventas??0)+'</b></div><div>Sin responder<b>'+(m.sinResponder??0)+'</b></div><div>Respuesta<b>'+(m.respuestaMin??'-')+' min</b></div></div>'+
 (ia.claves?.length?'<h5>Claves</h5><ul>'+ia.claves.map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul>':'')+(ia.oportunidades?.length?'<h5>A quién escribir</h5><ul>'+ia.oportunidades.map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul>':'')+(ia.problemas?.length?'<h5>A mejorar</h5><ul>'+ia.problemas.map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul>':'')+(ia.grupos?'<h5>Grupos</h5><p>'+esc(ia.grupos)+'</p>':'')+(ia.recomendacion?'<h5>Recomendación</h5><p>'+esc(ia.recomendacion)+'</p>':'')+(dif?'<h5>Para mandar en los grupos</h5>'+dif:'')+'</div></details>'}).join('')||'<div class="vacio">Todavía no hay reportes</div>'}
document.addEventListener('click',async e=>{const b=e.target.closest('[data-borrar]');if(b){e.preventDefault();if(!confirm('¿Borrar este reporte?'))return;await api('borrar-reporte',{id:b.dataset.borrar});reportes();return}
 const c=e.target.closest('[data-copiar]');if(c){const t=$('#m-'+c.dataset.copiar).textContent;try{await navigator.clipboard.writeText(t);c.textContent='Copiado'}catch(x){c.textContent='No se pudo copiar'}setTimeout(()=>c.textContent='Copiar mensaje',1500)}});
// Asistente
const hist=[];
function burbuja(t,quien){const d=document.createElement('div');d.className='b '+quien;d.innerHTML=quien==='a'?esc(t).replace(/\\+?(549\\d{8,11})/g,(m,n)=>'<a data-c="'+n+'">+'+n+'</a>'):esc(t);$('#msgs').appendChild(d);$('#msgs').scrollTop=1e9;return d}
async function preguntar(q){if(!q.trim())return;burbuja(q,'u');$('#pregunta').value='';const w=burbuja('Buscando en los chats…','a');w.style.color='#9CA3AF';
 try{const r=await api('preguntar',{pregunta:q,historial:hist});w.remove();burbuja(r.respuesta,'a');hist.push({r:'u',t:q},{r:'a',t:r.respuesta})}catch(e){w.textContent='No pude responder. Probá de nuevo.'}}
$('#fAsis').onsubmit=e=>{e.preventDefault();preguntar($('#pregunta').value)};
document.querySelectorAll('#sug button').forEach(b=>b.onclick=()=>preguntar(b.textContent));
function vista(v){document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('on',t.dataset.v===v));document.querySelectorAll('main>section').forEach(s=>s.hidden=s.id!=='v-'+v);if(v==='chats')listar();if(v==='reps')reportes()}
document.querySelectorAll('.tab').forEach(t=>t.onclick=()=>vista(t.dataset.v));
$('#f').onchange=listar;let tq;$('#q').oninput=()=>{clearTimeout(tq);tq=setTimeout(listar,300)};
$('#bAnalizar').onclick=async e=>{e.target.disabled=true;e.target.textContent='Analizando…';const r=await api('analizar',{});e.target.textContent='Analizados '+(r.analizados||0);e.target.disabled=false;cargar()};
$('#bDiario').onclick=async e=>{e.target.disabled=true;await api('reporte',{tipo:'805_diario'});e.target.disabled=false;reportes()};
$('#bSemanal').onclick=async e=>{e.target.disabled=true;await api('reporte',{tipo:'805_semanal'});e.target.disabled=false;reportes()};
$('#bTg').onclick=async()=>{const r=await api('telegram',{});$('#tgRes').textContent=r.ok?'Conectado '+(r.nombre||''):r.error;cargar()};
$('#bProbar').onclick=async()=>{const r=await api('probar-alertas',{});$('#tgRes').textContent='Alertas enviadas: '+r.alertas};
let qrUlt='';async function qrPoll(){if($('#v-conf').hidden)return;const q=await api('qr');const box=$('#qrBox');if(q.estado==='paired'){box.innerHTML='<b style="color:#1FA855">Vinculado</b>';return}if(!q.qr){box.textContent='Esperando QR (corré el comando en Termux)';qrUlt='';return}if(q.qr===qrUlt)return;qrUlt=q.qr;box.innerHTML='';if(typeof QRCode==='undefined'){box.textContent='No cargó el dibujador de QR: recargá la página';qrUlt='';return}new QRCode(box,{text:q.qr,width:260,height:260,correctLevel:QRCode.CorrectLevel.L})}
setInterval(qrPoll,3000);
cargar();setInterval(cargar,60000);if(location.hash)abrir(decodeURIComponent(location.hash.slice(1)));
</script></body></html>`;
