// Screenshots the cert page in several states from local fixtures; asserts the DOM reached each
// state and, for the states that render a card, that the label canvas actually drew.
// Serves public/ over a local HTTP port (the page uses absolute /slab/ paths because it is
// rewritten from /v/<cert> in production, where relative paths would resolve under /v/).
const fs=require('fs'),cp=require('child_process'),path=require('path'),http=require('http');
const CHROME=process.env.CHROME||'C:/Program Files/Google/Chrome/Application/chrome.exe';
const root=path.join(__dirname,'..');
const MIME={'.html':'text/html','.js':'application/javascript','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg'};
const MOUNTS=[['/__fixtures/',path.join(root,'scripts','fixtures')],['/__ref/',path.join(root,'SlabSense Slab Engraving Studio','Referances')],['/',path.join(root,'public')]];
const server=http.createServer((req,res)=>{
  const url=decodeURIComponent(req.url.split('?')[0]);
  const m=MOUNTS.find(([pre])=>url.startsWith(pre));
  const file=path.join(m[1],url.slice(m[0].length));
  fs.readFile(file,(err,data)=>{ if(err){res.writeHead(404);res.end('not found');return;}
    res.writeHead(200,{'Content-Type':MIME[path.extname(file).toLowerCase()]||'application/octet-stream'});res.end(data);});
});
const PORT=Number(process.env.PORT)||4173;
const origin='http://localhost:'+PORT;
const page=(q)=>origin+'/slabview.html?'+q;
const fix=origin+'/__fixtures/slab-public.json';
const fixNoImage=origin+'/__fixtures/slab-public-noimage.json';
async function run(name,q,width){
  const out=path.join(root,'scripts',`out-slabview-${name}.png`);
  const dom=await new Promise((ok,no)=>cp.execFile(CHROME,['--headless=new','--disable-gpu','--hide-scrollbars','--window-size='+width+',1400','--virtual-time-budget=6000','--dump-dom','--screenshot='+out,page(q)],{encoding:'utf8',maxBuffer:64e6},(err,stdout)=>err&&!stdout?no(err):ok(stdout)));
  const state=(dom.match(/data-state="([a-z-]+)"/)||[])[1];
  const label=(dom.match(/data-label="([a-z]+)"/)||[])[1];
  console.log(name,'state=',state,'label=',label,'→',out);
  return {state,label,dom};
}
server.listen(PORT,async()=>{
let bad=0;

let r=await run('found','cert=SS26-00001&src='+encodeURIComponent(fix),1200);
if(r.state!=='found'){console.log('FAIL found state',r.state);bad++;}
if(r.label!=='drawn'){console.log('FAIL found label',r.label);bad++;}
if(r.dom.indexOf('PIKACHU V (ENGRAVED)')===-1){console.log('FAIL found: engraved name not rendered');bad++;}

r=await run('found-phone','cert=SS26-00001&src='+encodeURIComponent(fix),500);
if(r.state!=='found'){console.log('FAIL found-phone state',r.state);bad++;}
if(r.label!=='drawn'){console.log('FAIL found-phone label',r.label);bad++;}

r=await run('notfound','cert=SS26-99999&src='+encodeURIComponent(origin+'/__fixtures/nope.json'),1200);
if(r.state!=='not-found'){console.log('FAIL notfound state',r.state);bad++;}

r=await run('nocert','',1200);
if(r.state!=='not-found'){console.log('FAIL nocert state',r.state);bad++;}

r=await run('noimage','cert=SS26-00001&src='+encodeURIComponent(fixNoImage),1200);
if(r.state!=='found'){console.log('FAIL noimage state',r.state);bad++;}
if(r.label!=='drawn'){console.log('FAIL noimage label',r.label);bad++;}
if(r.dom.indexOf('No images on file')===-1){console.log('FAIL noimage: missing "No images on file" empty-well text');bad++;}

console.log(bad?'FAIL':'PASS — inspect the PNGs');server.close();process.exit(bad?1:0);
});
