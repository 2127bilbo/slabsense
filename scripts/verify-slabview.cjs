// Screenshots the cert page in three states from a local fixture; asserts the DOM reached each state.
const fs=require('fs'),cp=require('child_process'),path=require('path');
const CHROME=process.env.CHROME||'C:/Program Files/Google/Chrome/Application/chrome.exe';
const root=path.join(__dirname,'..').split(path.sep).join('/');
const page=(q)=>'file:///'+root+'/public/slabview.html?'+q;
const fix='file:///'+root+'/scripts/fixtures/slab-public.json';
function run(name,q,width){const out=`${root}/scripts/out-slabview-${name}.png`;
  const dom=cp.execFileSync(CHROME,['--headless=new','--disable-gpu','--allow-file-access-from-files','--hide-scrollbars','--window-size='+width+',1400','--virtual-time-budget=6000','--dump-dom','--screenshot='+out,page(q)],{encoding:'utf8',maxBuffer:64e6,stdio:['ignore','pipe','ignore']});
  const state=(dom.match(/data-state="([a-z-]+)"/)||[])[1];console.log(name,'state=',state,'→',out);return state;}
let bad=0;
if(run('found','cert=SS26-00001&src='+encodeURIComponent(fix),1200)!=='found')bad++;
if(run('found-phone','cert=SS26-00001&src='+encodeURIComponent(fix),500)!=='found')bad++;
if(run('notfound','cert=SS26-99999&src='+encodeURIComponent('file:///'+root+'/scripts/fixtures/nope.json'),1200)!=='not-found')bad++;
if(run('nocert','',1200)!=='not-found')bad++;
console.log(bad?'FAIL':'PASS — inspect the PNGs');process.exit(bad?1:0);
