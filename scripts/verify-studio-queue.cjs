// Drives the studio's queue mode with stubbed API/auth: rows appear, selecting one renders the label from
// the record with the real SS cert, the engrave payload carries svg + label_text + sanitized settings.
const fs=require('fs'),cp=require('child_process'),path=require('path'),http=require('http');
const CHROME=process.env.CHROME||'C:/Program Files/Google/Chrome/Application/chrome.exe';
const root=path.join(__dirname,'..'),MIME={'.html':'text/html','.js':'application/javascript','.json':'application/json','.png':'image/png'};
const server=http.createServer((req,res)=>{const u=decodeURIComponent(req.url.split('?')[0]);const f=u==='/__wrap.html'?path.join(__dirname,'__studio-wrap.html'):path.join(root,'public',u);
  fs.readFile(f,(e,d)=>{if(e){res.writeHead(404);res.end();return;}res.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'});res.end(d);});});
const rows=[{cert:'SS26-00001',status:'paid',paid_at:'2026-09-13T23:30:10Z',shipping:{name:'Bob',address:{line1:'1 Main St',city:'Indy',state:'IN',postal_code:'46201',country:'US'}},front_image_url:null,scan:{id:'s1',card_name:'Glaceon',card_set:'2008 Pokémon Majestic Dawn',card_number:'5',card_game:'pokemon',card_info:{rarity:'Holo Rare'},grade_value:9,grade_label:'Mint'}}];
fs.writeFileSync(path.join(__dirname,'__studio-wrap.html'),`<!doctype html><meta charset="utf-8"><iframe id="f" src="/studio.html?queue=1" style="width:1400px;height:900px"></iframe><pre id="out"></pre><pre id="err"></pre>
<script>
document.getElementById('f').addEventListener('load',function(){var w=document.getElementById('f').contentWindow,api=w.SlabStudio,log=[];
 Promise.resolve(api.ready).then(function(){ api.queue.setRows(${JSON.stringify(rows)}); log.push(['mode',api.queue.mode()]); log.push(['rows',w.document.querySelectorAll('#queueList .qrow').length]);
   return api.queue.select('SS26-00001'); }).then(function(){ var s=api.getState(); log.push(['cert',s.cert]); log.push(['url',s.url]); log.push(['name',w.document.getElementById('name').value]);
   var p=api.getEngravePayload(); log.push(['svg',p.svg.slice(0,5)]); log.push(['lt',p.label_text.name+'/'+p.label_text.grade+'/'+p.label_text.gradeWord]); log.push(['token',String(p.label_settings.useToken)+'/'+('secret' in p.label_settings)]);
   log.push(['ship',w.document.getElementById('queueShip').textContent.indexOf('46201')>=0]);
   document.getElementById('out').textContent=JSON.stringify(log);}).catch(function(e){document.getElementById('err').textContent='ERR '+(e&&e.stack||e);});});
</script>`);
server.listen(4176,()=>{cp.execFile(CHROME,['--headless=new','--disable-gpu','--virtual-time-budget=10000','--dump-dom','http://localhost:4176/__wrap.html'],{encoding:'utf8',maxBuffer:64e6},(err,dom)=>{
  const dec=s=>s.replace(/&quot;/g,'"').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
  const e=(dom.match(/<pre id="err">([\s\S]*?)<\/pre>/)||[])[1];if(e&&e.trim()){console.log(dec(e).slice(0,600));server.close();process.exit(2);}
  const log=JSON.parse(dec((dom.match(/<pre id="out">([\s\S]*?)<\/pre>/)||[])[1]));console.log(JSON.stringify(log));const m=Object.fromEntries(log);
  const ok=m.mode==='queue'&&m.rows===1&&m.cert==='SS26-00001'&&m.url==='SLABSENSEAI.COM/V/SS26-00001'&&m.name==='GLACEON'&&m.svg==='<?xml'&&m.lt==='GLACEON/9/MINT'&&m.token==='false/false'&&m.ship===true;
  fs.unlinkSync(path.join(__dirname,'__studio-wrap.html'));server.close();process.exit(ok?0:1);});});
