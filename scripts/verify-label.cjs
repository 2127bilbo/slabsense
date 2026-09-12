// Renders the label through public/slab/label.js in headless Chrome, rasterises the SVG, decodes the QR.
// Usage: node scripts/verify-label.cjs [key=value ...]   e.g. node scripts/verify-label.cjs grade=8.5 gradeWord=NM-MT+
const fs=require('fs'),cp=require('child_process'),path=require('path'),os=require('os');
const jsQR=require('jsqr'),{PNG}=require('pngjs');
const CHROME=process.env.CHROME||'C:/Program Files/Google/Chrome/Application/chrome.exe';
const here=__dirname.split(path.sep).join('/');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'verify-label-'));
const qs=process.argv.slice(2).map(encodeURIComponent).map(s=>s.replace('%3D','=')).join('&');
function chrome(args){return cp.execFileSync(CHROME,['--headless=new','--disable-gpu','--allow-file-access-from-files','--user-data-dir='+tmp+'/profile','--hide-scrollbars','--virtual-time-budget=6000',...args],{encoding:'utf8',maxBuffer:64e6,stdio:['ignore','pipe','ignore']});}
const dom=chrome(['--dump-dom','file:///'+here+'/verify-label.html'+(qs?'?'+qs:'')]);
const dec=s=>s.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&amp;/g,'&');
const err=(dom.match(/<pre id="err">([\s\S]*?)<\/pre>/)||[])[1];
if(err&&err.trim()){console.error('HARNESS:',dec(err).slice(0,800));process.exit(2);}
const svg=dec((dom.match(/<pre id="out">([\s\S]*?)<\/pre>/)||[])[1]||'');
const meta=JSON.parse(dec((dom.match(/<pre id="meta">([\s\S]*?)<\/pre>/)||[])[1]||'{}'));
if(!svg.startsWith('<?xml')){console.error('NO SVG');process.exit(2);}
const W=parseFloat(svg.match(/width="([\d.]+)mm"/)[1]),H=parseFloat(svg.match(/height="([\d.]+)mm"/)[1]),PX=20;
const inner=svg.replace(/^<\?xml[^>]*>\s*/,'').replace(/<svg /,'<svg style="width:'+(W*PX)+'px;height:'+(H*PX)+'px;display:block" ').replace(/fill="#[0-9a-f]{3,6}"/gi,'fill="#000"').replace(/stroke="#[0-9a-f]{3,6}"/gi,'stroke="#000"');
fs.writeFileSync(tmp+'/view.html','<!doctype html><meta charset=utf-8><body style="margin:0;background:#fff">'+inner+'</body>');
chrome(['--window-size='+Math.ceil(W*PX)+','+Math.ceil(H*PX),'--screenshot='+tmp+'/label.png','file:///'+tmp.split(path.sep).join('/')+'/view.html']);
const png=PNG.sync.read(fs.readFileSync(tmp+'/label.png'));
const r=jsQR(png.data,png.width,png.height,{inversionAttempts:'attemptBoth'});
const ok=!!r&&r.data===meta.url;
console.log(JSON.stringify({...meta,decoded:r?r.data:null,ok}));
if(process.env.KEEP)console.log('artifacts in',tmp);else fs.rmSync(tmp,{recursive:true,force:true});
process.exit(ok?0:1);
