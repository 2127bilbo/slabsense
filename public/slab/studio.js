/* public/slab/studio.js — studio UI over SlabLabel (manual mode) */
(function(){
"use strict";
var DEF=SlabLabel.defaults, GRADES=SlabLabel.GRADES;
var NUM=["W","H","frameScale","headerScale","hdrX","hdrY","div1","div2","textL","colGap","outlineW","logoPct","qrMM","certDigits","certNext"];
var STR=["certPos","base","ec","dot","eye","secret","certPrefix","color","backdrop","gradeFont","wordFont"];
var BOOL=["showBoxes","gradeOutline","compact","qrAuto","useToken","grpLayers"];
var CARD=["name","l2","l3","l4"];
var KEY="ss-studio-v4";
var LOCAL_DEF={certPrefix:"TEST-",certDigits:5,certNext:1};      // manual-mode counter, never the SS sequence
var el={};NUM.concat(STR,BOOL,CARD,["cert","gradeSel"]).forEach(function(i){el[i]=document.getElementById(i);});
function esc(s){return String(s).replace(/[&<>"]/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c];});}
function pad(n,d){var s=String(Math.max(0,Math.floor(n)));while(s.length<d)s="0"+s;return s;}
function allDefaults(){var o={};for(var k in DEF)o[k]=DEF[k];for(var k2 in LOCAL_DEF)o[k2]=LOCAL_DEF[k2];return o;}
var S=allDefaults(), certOverride=null;
function counterCert(){return S.certPrefix+pad(S.certNext,S.certDigits);}
function currentCert(){return certOverride!==null?certOverride:counterCert();}

function settingsToUI(){
  NUM.forEach(function(k){el[k].value=S[k];});
  STR.forEach(function(k){el[k].value=S[k];});
  BOOL.forEach(function(k){el[k].checked=!!S[k];});
}
function uiToSettings(){
  var d=allDefaults();
  NUM.forEach(function(k){var x=parseFloat(el[k].value);S[k]=isNaN(x)?d[k]:x;});
  STR.forEach(function(k){S[k]=el[k].value;});
  BOOL.forEach(function(k){S[k]=el[k].checked;});
  S.logoPct=Math.max(0,Math.min(30,S.logoPct));
  S.certDigits=Math.max(1,Math.min(10,Math.round(S.certDigits)));
  S.certNext=Math.max(1,Math.round(S.certNext));
}
function save(){
  try{localStorage.setItem(KEY,JSON.stringify({s:S,card:CARD.reduce(function(a,k){a[k]=el[k].value;return a;},{}),
    grade:el.gradeSel.value,certOverride:certOverride}));}catch(e){}
}
function load(){
  S=allDefaults();
  try{var sv=JSON.parse(localStorage.getItem(KEY)||"null");
    if(sv&&sv.s){for(var k2 in DEF)if(k2 in sv.s&&typeof sv.s[k2]===typeof S[k2])S[k2]=sv.s[k2];}
    if(sv&&sv.card)CARD.forEach(function(k){if(typeof sv.card[k]==="string")el[k].value=sv.card[k];});
    if(sv&&sv.grade!=null&&GRADES[+sv.grade])el.gradeSel.value=sv.grade;
    if(sv&&typeof sv.certOverride==="string")certOverride=sv.certOverride;
  }catch(e){}
  settingsToUI();
}

function cfgFrom(){
  var g=GRADES[+el.gradeSel.value]||GRADES[0];
  var c={};for(var k in S)c[k]=S[k];
  c.name=el.name.value;c.l2=el.l2.value;c.l3=el.l3.value;c.l4=el.l4.value;
  c.cert=currentCert();c.grade=g[0];c.gradeWord=g[1];
  return c;
}
function refreshCertUI(){
  var ov=certOverride!==null;
  el.cert.readOnly=!ov; el.cert.value=currentCert();
  document.getElementById("certEdit").hidden=ov;
  document.getElementById("certReset").hidden=!ov;
  document.getElementById("certHint").textContent=ov
    ?"Override — the counter is at "+counterCert()+". Downloading advances it past this number when the prefix matches."
    :"From the counter. Next after this: "+S.certPrefix+pad(S.certNext+1,S.certDigits);
}
function st(b,s){return '<div class="stat"><b>'+esc(b)+'</b><span>'+esc(s)+'</span></div>';}

var cur=null,curSVG="",seq=0;
function render(){
  uiToSettings(); save();
  document.getElementById("owOut").textContent=S.outlineW.toFixed(2);
  document.getElementById("fsOut").textContent=Math.round(S.frameScale*100);
  document.getElementById("hsOut").textContent=Math.round(S.headerScale*100);
  document.getElementById("stage").className="stage "+S.backdrop;
  if(certOverride===null||document.activeElement!==el.cert)refreshCertUI();
  var my=++seq, input=cfgFrom();
  return SlabLabel.payload(input,S).then(function(p){
    if(my!==seq)return;
    var b=SlabLabel.build(input,S,p.url,p.alnum);
    if(!b){document.getElementById("payload").textContent="Payload too long for a QR code.";return;}
    cur={built:b,input:input,url:p.url};curSVG=b.svg;
    var cv=document.getElementById("cv");cv.width=1600;cv.height=Math.round(1600*S.H/S.W);
    SlabLabel.drawCanvas(cv,b.shapes,b.cfg,S.backdrop==="light"?"#1b1d22":"#ffffff");
    var t=b.stats;
    document.getElementById("stats").innerHTML=[st("v"+t.version+"-"+t.level,"QR version · EC"),st(t.modules+"×"+t.modules,"modules"),
      st(t.moduleMM.toFixed(3)+" mm","module size"),st(t.qrMM.toFixed(1)+" mm","QR footprint"),st(t.payloadLen+" ch","payload"),
      st(t.budgetVersion?t.budget+" ch":"—","fits @ 0.5 mm ("+(t.budgetVersion||"none")+")"),st(t.bind,"limited by")].join("");
    document.getElementById("warns").innerHTML=b.warnings.map(function(w){return '<div class="note '+w[0]+'">'+esc(w[1])+'</div>';}).join("");
    document.getElementById("payload").textContent=p.url;
  });
}

/* ---------- export ---------- */
var dl=null;
if(window.claude&&claude.use)claude.use("downloads").then(function(d){dl=d;}).catch(function(){});
function offer(fn,data,type){
  var b=(data instanceof Blob)?data:new Blob([data],{type:type||"image/svg+xml"});
  if(dl)return dl.save({filename:fn,data:b}).then(function(){return true;},function(e){if(e&&e.code==="declined")return false;fb(fn,b);return true;});
  fb(fn,b);return Promise.resolve(true);
}
function fb(fn,b){var u=URL.createObjectURL(b),a=document.createElement("a");a.href=u;a.download=fn;
  document.body.appendChild(a);a.click();setTimeout(function(){URL.revokeObjectURL(u);a.remove();},4000);}
function safeName(s){return String(s).replace(/[^A-Za-z0-9._-]+/g,"_");}
/* after a label goes out, move the counter past it */
function advanceCert(cert){
  if(cert===counterCert()){S.certNext+=1;}
  else{
    var m=cert.indexOf(S.certPrefix)===0?cert.slice(S.certPrefix.length).match(/^(\d+)$/):null;
    if(m)S.certNext=Math.max(S.certNext,parseInt(m[1],10)+1);
  }
  certOverride=null; el.certNext.value=S.certNext; render();
}
function downloadSVG(){
  if(!curSVG)return;
  var cert=cur.input.cert;
  offer("slabsense-"+safeName(cert)+".svg",curSVG).then(function(ok){if(ok)advanceCert(cert);});
}
document.getElementById("dlSVG").addEventListener("click",downloadSVG);
document.addEventListener("keydown",function(e){if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="s"){e.preventDefault();downloadSVG();}});
document.getElementById("dlQRSVG").addEventListener("click",function(){
  if(!cur)return;
  offer("slabsense-"+safeName(cur.input.cert)+"-qr.svg",SlabLabel.qrOnlySVG(cur.built,S));
});
document.getElementById("fitQR").addEventListener("click",function(){
  if(!cur)return;
  var c=cur.built.cfg, N=cur.built.g.qr.N;
  var wantW=0.5*(N+8)+cur.built.g.certW+2*cur.built.g.f.divHalf+c.colGap;   // divider-to-divider span for 0.5 mm modules
  var d2=Math.min(0.90,c.div1+wantW/c.W);
  el.div2.value=d2.toFixed(3);
  render();
});
document.getElementById("copySVG").addEventListener("click",function(){
  if(!curSVG)return;
  navigator.clipboard.writeText(curSVG).then(function(){
    var b=document.getElementById("copySVG"),o=b.textContent;b.textContent="Copied";
    setTimeout(function(){b.textContent=o;},1400);}).catch(function(){});
});
document.getElementById("dlPNG").addEventListener("click",function(){
  if(!cur)return;
  var dpi=1200,c=cur.built.cfg,cv=document.createElement("canvas");
  cv.width=Math.round(c.W/25.4*dpi);cv.height=Math.round(c.H/25.4*dpi);
  var x=cv.getContext("2d");x.fillStyle="#fff";x.fillRect(0,0,cv.width,cv.height);
  SlabLabel.drawCanvas(cv,cur.built.shapes.filter(function(s){return s.layer!=="_guide";}),c,"#000");
  cv.toBlob(function(b){offer("slabsense-"+safeName(c.cert)+"-proof.png",b,"image/png");},"image/png");
});

/* ---------- cert override ---------- */
document.getElementById("certEdit").addEventListener("click",function(){
  certOverride=counterCert(); refreshCertUI(); el.cert.focus(); el.cert.select();
});
document.getElementById("certReset").addEventListener("click",function(){certOverride=null;render();});
el.cert.addEventListener("input",function(){if(certOverride!==null){certOverride=el.cert.value;sched();}});
el.cert.addEventListener("blur",function(){if(certOverride!==null&&(certOverride===counterCert()||!certOverride.trim())){certOverride=null;render();}});

/* ---------- settings drawer ---------- */
var dlg=document.getElementById("settings");
document.getElementById("openSettings").addEventListener("click",function(){dlg.showModal();});
["closeSettings","closeSettings2"].forEach(function(id){document.getElementById(id).addEventListener("click",function(){dlg.close();});});
dlg.addEventListener("click",function(e){if(e.target===dlg)dlg.close();});
document.getElementById("resetDefaults").addEventListener("click",function(){
  if(!confirm("Restore every setting to the defaults? The cert counter is kept."))return;
  var next=S.certNext;S=allDefaults();S.certNext=next;settingsToUI();render();
});

/* ---------- wiring ---------- */
(function(){
  var s=el.gradeSel;
  GRADES.forEach(function(g,i){var o=document.createElement("option");o.value=i;o.textContent=g[0]+"  —  "+g[1];s.appendChild(o);});
})();
Array.prototype.forEach.call(document.querySelectorAll("[data-base]"),function(b){
  b.addEventListener("click",function(){el.base.value=b.getAttribute("data-base");render();});});
Array.prototype.forEach.call(document.querySelectorAll("[data-trim]"),function(b){
  b.addEventListener("click",function(){var t=b.getAttribute("data-trim").split(",");
    el.W.value=t[0];el.H.value=t[1];render();});});
var tmr=null;function sched(){clearTimeout(tmr);tmr=setTimeout(render,70);}
NUM.concat(STR,BOOL,CARD,["gradeSel"]).forEach(function(i){el[i].addEventListener("input",sched);el[i].addEventListener("change",sched);});

/* small API for automation and the future app integration */
var readyResolve; var ready=new Promise(function(r){readyResolve=r;});
window.SlabStudio={
  ready:ready,
  set:function(fields){
    fields=fields||{};
    for(var k in fields){
      if(k==="cert"){certOverride=String(fields[k]);continue;}
      if(k==="grade"){var idx=-1;GRADES.forEach(function(g,i){if(idx<0&&(g[0]+" "+g[1]).toUpperCase()===String(fields[k]).toUpperCase())idx=i;});if(idx>=0)el.gradeSel.value=idx;continue;}
      if(!el[k])continue;
      if(BOOL.indexOf(k)>=0)el[k].checked=fields[k]===true||fields[k]==="true";else el[k].value=fields[k];
    }
    return render();
  },
  render:render,
  getSVG:function(){return curSVG;},
  getState:function(){return cur?{url:cur.url,cert:cur.input.cert,version:cur.built.stats.version,level:cur.built.stats.level,modules:cur.built.stats.modules,moduleMM:cur.built.stats.moduleMM,qrMM:cur.built.stats.qrMM,bind:cur.built.stats.bind,W:S.W,H:S.H,shrink:cur.built.stats.shrink}:null;},
  advanceCert:function(){advanceCert(currentCert());}
};

SlabLabel.ready.then(function(){load();return render();}).then(readyResolve,function(e){document.getElementById("payload").textContent="Label engine failed to load: "+e.message;});
})();
