// Loads public/studio.html headless, drives it through window.SlabStudio, checks the SVG matches label.js output
const fs=require('fs'),cp=require('child_process'),path=require('path'),os=require('os');
const CHROME=process.env.CHROME||'C:/Program Files/Google/Chrome/Application/chrome.exe';
const root=path.join(__dirname,'..').split(path.sep).join('/');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'verify-studio-'));
fs.writeFileSync(tmp+'/w.html',`<!doctype html><meta charset="utf-8">
<iframe id="f" src="file:///${root}/public/studio.html" style="width:1400px;height:900px"></iframe>
<pre id="out"></pre><pre id="err"></pre>
<script>
document.getElementById('f').addEventListener('load',function(){
  var w=document.getElementById('f').contentWindow,api=w.SlabStudio,log=[];
  if(!api){document.getElementById('err').textContent='NO_API';return;}
  Promise.resolve(api.ready)
  .then(function(){log.push(['cert',api.getState().cert]);log.push(['svgStarts',api.getSVG().slice(0,5)]);api.advanceCert();return api.render();})
  .then(function(){log.push(['afterAdvance',api.getState().cert]);return api.set({grade:'8.5 NM-MT+'});})
  .then(function(){var s=api.getState();log.push(['grade',s.version+'-'+s.level+' '+s.moduleMM]);
    w.confirm=function(){return true;};
    w.document.getElementById('resetDefaults').click();
    return api.render();})
  .then(function(){log.push(['afterReset',api.getState().cert]);return api.set({cert:'TEST-00042'});})
  .then(function(){return new Promise(function(resolve,reject){
    var f=document.getElementById('f');
    f.addEventListener('load',function onLoad(){
      f.removeEventListener('load',onLoad);
      var w2=f.contentWindow,api2=w2.SlabStudio;
      if(!api2){reject(new Error('NO_API_AFTER_RELOAD'));return;}
      Promise.resolve(api2.ready).then(function(){log.push(['overrideSurvivesReload',api2.getState().cert]);resolve();}).catch(reject);
    });
    f.src=f.src;
  });})
  .then(function(){document.getElementById('out').textContent=JSON.stringify(log);})
  .catch(function(e){document.getElementById('err').textContent='ERR '+(e&&e.stack||e);});
},{once:true});
</script>`);
const dom=cp.execFileSync(CHROME,['--headless=new','--disable-gpu','--allow-file-access-from-files','--user-data-dir='+tmp+'/p','--virtual-time-budget=8000','--dump-dom','file:///'+tmp.split(path.sep).join('/')+'/w.html'],{encoding:'utf8',maxBuffer:64e6,stdio:['ignore','pipe','ignore']});
const dec=s=>s.replace(/&quot;/g,'"').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
const err=(dom.match(/<pre id="err">([\s\S]*?)<\/pre>/)||[])[1];if(err&&err.trim()){console.error(dec(err).slice(0,600));process.exit(2);}
const log=JSON.parse(dec((dom.match(/<pre id="out">([\s\S]*?)<\/pre>/)||[])[1]));
console.log(JSON.stringify(log));
const m=Object.fromEntries(log);
const ok=m.cert==='TEST-00001'&&m.svgStarts==='<?xml'&&m.afterAdvance==='TEST-00002'&&/^2-Q 0\.44/.test(m.grade)&&m.afterReset==='TEST-00002'&&m.overrideSurvivesReload==='TEST-00042';
fs.rmSync(tmp,{recursive:true,force:true});process.exit(ok?0:1);
