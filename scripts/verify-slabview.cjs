// Screenshots the cert page in several states from local fixtures; asserts the DOM reached each
// state and, for the states that render a card, that the label canvas actually drew.
const fs=require('fs'),cp=require('child_process'),path=require('path');
const CHROME=process.env.CHROME||'C:/Program Files/Google/Chrome/Application/chrome.exe';
const root=path.join(__dirname,'..').split(path.sep).join('/');
const page=(q)=>'file:///'+root+'/public/slabview.html?'+q;
const fix='file:///'+root+'/scripts/fixtures/slab-public.json';
const fixNoImage='file:///'+root+'/scripts/fixtures/slab-public-noimage.json';
function run(name,q,width){
  const out=`${root}/scripts/out-slabview-${name}.png`;
  const dom=cp.execFileSync(CHROME,['--headless=new','--disable-gpu','--allow-file-access-from-files','--hide-scrollbars','--window-size='+width+',1400','--virtual-time-budget=6000','--dump-dom','--screenshot='+out,page(q)],{encoding:'utf8',maxBuffer:64e6,stdio:['ignore','pipe','ignore']});
  const state=(dom.match(/data-state="([a-z-]+)"/)||[])[1];
  const label=(dom.match(/data-label="([a-z]+)"/)||[])[1];
  console.log(name,'state=',state,'label=',label,'→',out);
  return {state,label,dom};
}
let bad=0;

let r=run('found','cert=SS26-00001&src='+encodeURIComponent(fix),1200);
if(r.state!=='found'){console.log('FAIL found state',r.state);bad++;}
if(r.label!=='drawn'){console.log('FAIL found label',r.label);bad++;}

r=run('found-phone','cert=SS26-00001&src='+encodeURIComponent(fix),500);
if(r.state!=='found'){console.log('FAIL found-phone state',r.state);bad++;}
if(r.label!=='drawn'){console.log('FAIL found-phone label',r.label);bad++;}

r=run('notfound','cert=SS26-99999&src='+encodeURIComponent('file:///'+root+'/scripts/fixtures/nope.json'),1200);
if(r.state!=='not-found'){console.log('FAIL notfound state',r.state);bad++;}

r=run('nocert','',1200);
if(r.state!=='not-found'){console.log('FAIL nocert state',r.state);bad++;}

r=run('noimage','cert=SS26-00001&src='+encodeURIComponent(fixNoImage),1200);
if(r.state!=='found'){console.log('FAIL noimage state',r.state);bad++;}
if(r.label!=='drawn'){console.log('FAIL noimage label',r.label);bad++;}
if(r.dom.indexOf('No images on file')===-1){console.log('FAIL noimage: missing "No images on file" empty-well text');bad++;}

console.log(bad?'FAIL':'PASS — inspect the PNGs');process.exit(bad?1:0);
