// Pantalla del panel: /panel/805 (solo lectura del WhatsApp 805)
export const PANEL_805 = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>805 · Te Importamos</title>
<style>
:root{--azul:#1d4ed8;--fondo:#f5f7fb;--borde:#e3e8f0;--txt:#0f172a;--gris:#64748b;--rojo:#dc2626;--verde:#16a34a;--ambar:#d97706}
*{box-sizing:border-box}body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:var(--fondo);color:var(--txt)}
header{display:flex;align-items:center;gap:14px;padding:12px 18px;background:#fff;border-bottom:1px solid var(--borde);position:sticky;top:0;z-index:5;flex-wrap:wrap}
header b{color:var(--azul);font-size:18px}header a{color:var(--gris);text-decoration:none;font-weight:600}
.tabs{display:flex;gap:6px;flex-wrap:wrap}.tab{border:0;background:none;padding:8px 12px;border-radius:8px;font-weight:600;color:var(--gris);cursor:pointer;font-size:15px}.tab.on{background:#e8efff;color:var(--azul)}
main{padding:16px;max-width:1200px;margin:0 auto}
.fila{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:12px}
.btn{border:1px solid var(--borde);background:#fff;padding:8px 12px;border-radius:8px;cursor:pointer;font-weight:600}.btn.p{background:var(--azul);color:#fff;border-color:var(--azul)}
.kpis{display:grid;grid-template-columns:repeat(6,1fr);gap:10px}.kpi{background:#fff;border:1px solid var(--borde);border-radius:12px;padding:12px}.kpi small{color:var(--gris);font-weight:600}.kpi div{font-size:26px;font-weight:700;margin-top:4px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px}.card{background:#fff;border:1px solid var(--borde);border-radius:12px;padding:12px;min-width:0}.card h3{margin:0 0 8px;font-size:15px}
.item{padding:9px 6px;border-top:1px solid var(--borde);cursor:pointer}.item:hover{background:#f8fafc}.item .t{display:flex;justify-content:space-between;gap:8px;font-weight:600}.item .s{color:var(--gris);font-size:13px;margin-top:2px;overflow:hidden;text-overflow:ellipsis}
.acc{color:var(--azul);font-size:13px;margin-top:3px}.pill{display:inline-block;padding:1px 7px;border-radius:99px;font-size:12px;font-weight:700;background:#eef2f7;color:var(--gris)}.pill.c{background:#fee2e2;color:var(--rojo)}.pill.t{background:#fef3c7;color:var(--ambar)}.pill.f{background:#e0f2fe;color:#0369a1}
.vacio{color:var(--gris);font-size:14px;padding:8px 0}
.chats{display:grid;grid-template-columns:340px 1fr;gap:12px;height:calc(100vh - 150px)}.lista{overflow:auto;background:#fff;border:1px solid var(--borde);border-radius:12px}
.conv{background:#efeae2;border:1px solid var(--borde);border-radius:12px;overflow:auto;padding:12px;display:flex;flex-direction:column;gap:6px}
.m{max-width:75%;padding:7px 10px;border-radius:10px;background:#fff;white-space:pre-wrap;word-wrap:break-word;font-size:14px}.m.yo{align-self:flex-end;background:#d9fdd3}.m small{display:block;color:var(--gris);font-size:11px;margin-top:3px;text-align:right}
.ficha{background:#fff;border-radius:10px;padding:10px;font-size:14px;margin-bottom:6px}
input,select{padding:8px 10px;border:1px solid var(--borde);border-radius:8px;font-size:14px}
.rep{background:#fff;border:1px solid var(--borde);border-radius:12px;padding:14px;margin-bottom:10px}.rep h3{margin:0 0 6px}.rep ul{margin:6px 0;padding-left:18px}
.estado{font-size:13px;color:var(--gris)}.ok{color:var(--verde)}.mal{color:var(--rojo)}
.barras{display:flex;align-items:flex-end;gap:4px;height:90px;margin-top:6px}.barras div{flex:1;background:#bfd3ff;border-radius:4px 4px 0 0;position:relative}.barras span{position:absolute;top:-16px;left:0;right:0;text-align:center;font-size:11px;color:var(--gris)}
@media(max-width:900px){.kpis{grid-template-columns:repeat(2,1fr)}.grid{grid-template-columns:1fr}.chats{grid-template-columns:1fr;height:auto}.lista{max-height:45vh}.conv{min-height:60vh}main{padding:10px}}
</style></head><body>
<header><b>805</b><div class="tabs"><button class="tab on" data-v="res">Resumen</button><button class="tab" data-v="chats">Chats</button><button class="tab" data-v="reps">Reportes</button><button class="tab" data-v="conf">Conexión</button></div><a href="/panel" style="margin-left:auto">← Panel del agente</a></header>
<main>
<section id="v-res">
  <div class="fila"><span class="estado" id="estado"></span><span style="flex:1"></span><select id="periodo"><option value="dia">Hoy</option><option value="semana">7 días</option><option value="mes">30 días</option></select><button class="btn" id="bAnalizar">Analizar ahora</button></div>
  <div class="kpis" id="kpis"></div>
  <div class="grid">
    <div class="card"><h3>🔥 Respondé ya (sin respuesta, por calidad)</h3><div id="lSin"></div></div>
    <div class="card"><h3>👉 Escribiles</h3><div id="lEsc"></div></div>
    <div class="card"><h3>📄 Esperan cotización</h3><div id="lCot"></div></div>
    <div class="card"><h3>📈 Chats nuevos por día · productos más pedidos (7 días)</h3><div class="barras" id="barras"></div><div id="lProd" style="margin-top:10px"></div></div>
    <div class="card"><h3>💰 Ventas detectadas</h3><div id="lVen"></div></div>
  </div>
</section>
<section id="v-chats" hidden>
  <div class="fila"><input id="q" placeholder="Buscar nombre, número o producto" style="flex:1;min-width:180px"><select id="f"><option value="todos">Todos</option><option value="calientes">Calientes</option><option value="sin">Sin responder</option><option value="cotizar">Esperan cotización</option><option value="grupos">Grupos</option><option value="archivados">Archivados</option></select></div>
  <div class="chats"><div class="lista" id="lista"></div><div class="conv" id="conv"><div class="vacio">Elegí un chat. Esta vista es solo lectura: para responder usá tu celular.</div></div></div>
</section>
<section id="v-reps" hidden>
  <div class="fila"><button class="btn p" id="bDiario">Generar reporte de hoy</button><button class="btn" id="bSemanal">Generar reporte semanal</button><span class="estado">Se generan solos todos los días a las 21:00 y los domingos el semanal.</span></div>
  <div id="reps"></div>
</section>
<section id="v-conf" hidden>
  <div class="card" style="max-width:720px">
    <h3>Estado del lector</h3><div id="confEstado" class="estado"></div>
    <h3 style="margin-top:16px">Alertas por Telegram (gratis)</h3>
    <ol class="estado" style="line-height:1.6"><li>En Telegram abrí <b>@BotFather</b> → /newbot → poné un nombre. Te da un token.</li><li>En Cloudflare → cotizador → Settings → Variables, agregá <b>TELEGRAM_TOKEN</b> (tipo Secret) con ese token.</li><li>Abrí tu bot en Telegram y escribile <b>/start</b>.</li><li>Tocá este botón:</li></ol>
    <button class="btn p" id="bTg">Conectar Telegram</button> <button class="btn" id="bProbar">Probar alertas</button> <span id="tgRes" class="estado"></span>
  </div>
</section>
</main>
<script>
const $=s=>document.querySelector(s);const api=(p,b)=>fetch('/panel/api/805/'+p,b?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)}:{}).then(r=>r.json());
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const hora=ts=>{if(!ts)return'';const d=new Date(ts),h=new Date();return d.toDateString()===h.toDateString()?d.toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit'}):d.toLocaleDateString('es-AR',{day:'2-digit',month:'2-digit'})+' '+d.toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit'})};
const hace=ts=>{const m=Math.round((Date.now()-ts)/60000);return m<60?m+' min':m<1440?Math.round(m/60)+' h':Math.round(m/1440)+' d'};
const tel=c=>/^\\d+$/.test(c)?'+'+c:c;
const pill=c=>c.temp?'<span class="pill '+({caliente:'c',tibio:'t',frio:'f'}[c.temp]||'')+'">'+esc(c.temp)+(c.puntaje?' '+c.puntaje:'')+'</span>':'<span class="pill">sin analizar</span>';
const acc=a=>a?String(a).replace(/\\|p\\d$/,''):'';
function item(c,extra){return '<div class="item" data-c="'+esc(c.conv)+'"><div class="t"><span>'+esc(c.nombre||tel(c.conv))+' '+pill(c)+'</span><span class="estado">'+(extra||hora(c.ult_ts))+'</span></div><div class="s">'+esc(c.producto?c.producto+' · ':'')+esc(c.resumen||c.ult_texto||'')+'</div>'+(acc(c.accion)?'<div class="acc">👉 '+esc(acc(c.accion))+'</div>':'')+'</div>'}
let datos=null;
async function cargar(){datos=await api('resumen');pintar()}
function pintar(){const d=datos;if(!d)return;const p=d[$('#periodo').value];
 const k=[['Chats nuevos',p.nuevos],['Cotizaciones',p.cotizaciones],['Ventas',p.ventas],['Sin responder (72h)',p.sinResponder],['Respuesta mediana',p.respuestaMin==null?'-':p.respuestaMin+' min'],['Cotizados → venta',p.conversion==null?'-':p.conversion+'%']];
 $('#kpis').innerHTML=k.map(x=>'<div class="kpi"><small>'+x[0]+'</small><div>'+x[1]+'</div></div>').join('');
 $('#lSin').innerHTML=d.sinResponder.slice(0,15).map(c=>item(c,'hace '+hace(c.ult_cliente_ts))).join('')||'<div class="vacio">Nada pendiente 🎉</div>';
 $('#lEsc').innerHTML=d.escribiles.slice(0,15).map(c=>item(c)).join('')||'<div class="vacio">Sin sugerencias por ahora</div>';
 $('#lCot').innerHTML=d.cotPend.map(c=>item(c,'hace '+hace(c.ult_cliente_ts||c.ult_ts))).join('')||'<div class="vacio">Ninguno</div>';
 $('#lVen').innerHTML=d.ventasRec.map(v=>'<div class="item" data-c="'+esc(v.conv)+'"><div class="t"><span>'+esc(v.nombre||tel(v.conv))+'</span><span class="estado">'+hora(v.ts)+'</span></div><div class="s">'+esc(v.producto||'')+' · '+esc(v.dato||'')+'</div></div>').join('')||'<div class="vacio">Todavía ninguna</div>';
 const ser=Object.entries(d.nuevosPorDia||{}),mx=Math.max(1,...ser.map(x=>x[1]));$('#barras').innerHTML=ser.map(([k,v])=>'<div title="'+k+'" style="height:'+(v/mx*100)+'%"><span>'+v+'</span></div>').join('');
 $('#lProd').innerHTML=(d.productos||[]).map(x=>'<span class="pill" style="margin:2px">'+esc(x.producto)+' · '+x.n+'</span>').join(' ')||'<span class="vacio">Sin datos</span>';
 const e=d.estado,ult=d.ultimo;$('#estado').innerHTML=!d.configurado?'<span class="mal">Lector sin configurar (falta LECTOR_TOKEN)</span>':ult?'Último mensaje recibido: hace '+hace(ult)+(e?.evento==='logged_out'?' · <span class="mal">desvinculado</span>':' · <span class="ok">conectado</span>'):'<span class="mal">Todavía no llegó ningún mensaje del 805</span>';
 $('#confEstado').innerHTML=$('#estado').innerHTML+'<br>Telegram: '+(d.telegram?'<span class="ok">conectado</span>':'<span class="mal">no conectado</span>');
}
document.addEventListener('click',e=>{const it=e.target.closest('[data-c]');if(it){abrir(it.dataset.c)}});
async function abrir(conv){vista('chats');location.hash=encodeURIComponent(conv);const r=await api('chat?conv='+encodeURIComponent(conv));const c=r.conv||{conv};
 $('#conv').innerHTML='<div class="ficha"><b>'+esc(c.nombre||tel(conv))+'</b> '+tel(conv)+' '+pill(c)+'<br>'+(c.producto?'<b>Busca:</b> '+esc(c.producto)+'<br>':'')+(c.resumen?esc(c.resumen)+'<br>':'')+(acc(c.accion)?'<span class="acc">👉 '+esc(acc(c.accion))+'</span><br>':'')+(r.hitos||[]).map(h=>'<span class="pill">'+h.tipo+' '+hora(h.ts)+'</span>').join(' ')+' <button class="btn" style="padding:3px 8px;margin-top:6px" onclick="archivar(\\''+esc(conv)+'\\','+(c.archivado?0:1)+')">'+(c.archivado?'Desarchivar':'Archivar (no es cliente)')+'</button></div>'+
 r.mensajes.map(m=>'<div class="m '+(m.yo?'yo':'')+'">'+(!m.yo&&m.autor_nombre&&c.grupo?'<b>'+esc(m.autor_nombre)+'</b>\\n':'')+esc(m.texto)+'<small>'+hora(m.ts)+'</small></div>').join('');
 $('#conv').scrollTop=1e9}
async function archivar(conv,si){await api('archivar',{conv,si});abrir(conv);listar();cargar()}
async function listar(){const l=await api('chats?f='+$('#f').value+'&q='+encodeURIComponent($('#q').value));$('#lista').innerHTML=l.map(c=>item(c)).join('')||'<div class="vacio" style="padding:12px">Sin chats</div>'}
async function reportes(){const l=await api('reportes');$('#reps').innerHTML=l.map(r=>{const d=r.datos||{},m=d.metricas||{},ia=d.ia||{};return '<div class="rep"><h3>'+(r.tipo==='805_semanal'?'Semanal':'Diario')+' · '+new Date(r.desde).toLocaleDateString('es-AR')+(r.tipo==='805_semanal'?' → '+new Date(r.hasta-1).toLocaleDateString('es-AR'):'')+'</h3><div class="estado">Generado '+new Date(r.creado).toLocaleString('es-AR')+'</div><p><b>'+esc(ia.titular||'')+'</b></p><div>Chats nuevos <b>'+(m.nuevos??0)+'</b> · Cotizaciones <b>'+(m.cotizaciones??0)+'</b> · Ventas <b>'+(m.ventas??0)+'</b> · Sin responder <b>'+(m.sinResponder??0)+'</b> · Respuesta mediana <b>'+(m.respuestaMin??'-')+' min</b></div>'+
 (ia.claves?.length?'<ul>'+ia.claves.map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul>':'')+(ia.oportunidades?.length?'<b>Escribiles</b><ul>'+ia.oportunidades.map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul>':'')+(ia.problemas?.length?'<b>A mejorar</b><ul>'+ia.problemas.map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul>':'')+(ia.grupos?'<p><b>Grupos:</b> '+esc(ia.grupos)+'</p>':'')+(ia.recomendacion?'<p>💡 '+esc(ia.recomendacion)+'</p>':'')+'</div>'}).join('')||'<div class="vacio">Todavía no hay reportes</div>'}
function vista(v){document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('on',t.dataset.v===v));document.querySelectorAll('main>section').forEach(s=>s.hidden=s.id!=='v-'+v);if(v==='chats')listar();if(v==='reps')reportes()}
document.querySelectorAll('.tab').forEach(t=>t.onclick=()=>vista(t.dataset.v));
$('#periodo').onchange=pintar;$('#f').onchange=listar;let tq;$('#q').oninput=()=>{clearTimeout(tq);tq=setTimeout(listar,300)};
$('#bAnalizar').onclick=async e=>{e.target.disabled=true;e.target.textContent='Analizando…';const r=await api('analizar',{});e.target.textContent='Analizados '+(r.analizados||0);e.target.disabled=false;cargar()};
$('#bDiario').onclick=async e=>{e.target.disabled=true;await api('reporte',{tipo:'805_diario'});e.target.disabled=false;reportes()};
$('#bSemanal').onclick=async e=>{e.target.disabled=true;await api('reporte',{tipo:'805_semanal'});e.target.disabled=false;reportes()};
$('#bTg').onclick=async()=>{const r=await api('telegram',{});$('#tgRes').textContent=r.ok?'Conectado '+(r.nombre||''):r.error;cargar()};
$('#bProbar').onclick=async()=>{const r=await api('probar-alertas',{});$('#tgRes').textContent='Alertas enviadas: '+r.alertas};
cargar();setInterval(cargar,60000);if(location.hash)abrir(decodeURIComponent(location.hash.slice(1)));
</script></body></html>`;
