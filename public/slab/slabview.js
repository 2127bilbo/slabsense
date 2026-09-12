/* public/slab/slabview.js — public cert page: composite + report */
(function(){
"use strict";
var LABEL_WIN={x:0.2847,y:0.1143,w:0.4458,h:0.1201};   // from scripts/plate-windows.json
var CARD_WIN ={x:0.2999,y:0.3018,w:0.4174,h:0.5586};
var PLATE={w:987,h:1024};
var q=new URLSearchParams(location.search), cert=(q.get("cert")||"").trim().toUpperCase();
var api=q.get("src")||("/api/slab?cert="+encodeURIComponent(cert));
var $=function(id){return document.getElementById(id);};
function setState(s){document.body.setAttribute("data-state",s);$("loading").hidden=s!=="loading";$("notfound").hidden=s!=="not-found";$("main").hidden=s!=="found";}
function esc(s){return String(s==null?"":s).replace(/[&<>"]/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c];});}
function pct(r){return {left:(r.x*100)+"%",top:(r.y*100)+"%",width:(r.w*100)+"%",height:(r.h*100)+"%"};}
function place(el,r){var p=pct(r);el.style.left=p.left;el.style.top=p.top;el.style.width=p.width;el.style.height=p.height;}
function fmtDate(s){return s?new Date(s).toLocaleDateString(undefined,{year:"numeric",month:"short",day:"numeric"}):"—";}
var STATUS={paid:"Paid — awaiting engraving",engraved:"Engraved — awaiting shipping",shipped:"Shipped"};

// The plate is an AI-generated photo whose label window is 3.58:1, while the real label is
// S.W/S.H = 69/21.4 ≈ 3.22:1. Don't stretch the canvas to LABEL_WIN — keep the label's true
// aspect, sized to the window's height, centred horizontally inside the window.
function labelRect(){
  var s=SlabLabel.defaults;
  var h=LABEL_WIN.h;
  var w=h*(s.W/s.H)*(PLATE.h/PLATE.w);
  var x=LABEL_WIN.x+(LABEL_WIN.w-w)/2;
  return {x:x,y:LABEL_WIN.y,w:w,h:h};
}

function drawLabel(row){
  var input=SlabLabel.fromScan(row,row.cert), s=SlabLabel.defaults;
  return SlabLabel.payload(input,s).then(function(p){
    var b=SlabLabel.build(input,s,p.url,p.alnum); if(!b)return;
    var cv=$("label"), slab=$("slab"), rect=labelRect();
    var pxW=Math.round(slab.clientWidth*rect.w*3);  // 3× for crisp downscale
    cv.width=pxW; cv.height=Math.round(pxW*s.H/s.W); place(cv,rect);
    SlabLabel.drawCanvas(cv,b.shapes,b.cfg,"#ffffff");
  });
}
function showSide(row,side){
  var src=side==="front"?(row.user_card_image||row.enhanced_front_path||row.front_image_path):(row.enhanced_back_path||row.back_image_path);
  var img=$("card"); img.hidden=!src; if(src)img.src=src; place(img,CARD_WIN); place($("well"),CARD_WIN);
  $("btnFront").setAttribute("aria-pressed",side==="front");$("btnBack").setAttribute("aria-pressed",side==="back");
}
function kv(el,obj,fmt){el.innerHTML=Object.keys(obj||{}).map(function(k){var v=obj[k];if(v&&typeof v==="object")v=Object.values(v).join(" / ");return '<div><b>'+esc(fmt?fmt(v):v)+'</b><span>'+esc(k.replace(/_/g," "))+'</span></div>';}).join("")||'<div><span>Not recorded</span></div>';}
function render(row){
  window.__row=row;
  var input=SlabLabel.fromScan(row,row.cert);
  document.title="SlabSense "+row.cert+" — "+input.name;
  $("hdrCert").textContent=row.cert;
  $("gradeNum").textContent=input.grade;$("gradeWord").textContent=input.gradeWord;
  $("name").textContent=input.name;$("setline").textContent=[input.l2,input.l3,input.l4].filter(Boolean).join(" · ");
  var st=$("status");st.textContent=STATUS[row.status]||row.status;st.className="status "+row.status;
  kv($("subgrades"),row.subgrades);
  kv($("centering"),{front:row.front_centering,back:row.back_centering});
  var d=row.dings||[];$("dings").innerHTML=d.map(function(x){return '<li>'+esc(x.type||"defect")+(x.severity?' <em>('+esc(x.severity)+')</em>':'')+(x.location?' — '+esc(x.location):'')+(x.note?': '+esc(x.note):'')+'</li>';}).join("");$("nodings").hidden=d.length>0;
  var imgs=[["Front",row.user_card_image||row.enhanced_front_path||row.front_image_path],["Back",row.enhanced_back_path||row.back_image_path]].filter(function(x){return x[1];});
  $("images").innerHTML=imgs.map(function(x){return '<figure style="margin:0"><img src="'+esc(x[1])+'" alt="'+esc(x[0])+'"><figcaption class="sub">'+esc(x[0])+'</figcaption></figure>';}).join("")||'<p class="sub">No images on file.</p>';
  kv($("dates"),{paid:row.paid_at,engraved:row.engraved_at,shipped:row.shipped_at},fmtDate);
  showSide(row,"front");
  $("btnFront").onclick=function(){showSide(row,"front");};$("btnBack").onclick=function(){showSide(row,"back");};
  setState("found");
  return SlabLabel.ready.then(function(){return drawLabel(row);});
}
function loadJSON(url){
  return fetch(url).then(function(r){if(!r.ok)throw new Error("status "+r.status);return r.json();});
}
if(!cert){$("nfCert").textContent="";setState("not-found");}
else loadJSON(api)
  .then(function(j){if(!j||!j.slab)throw new Error("empty");return render(j.slab);})
  .catch(function(){$("nfCert").textContent=cert;setState("not-found");});
window.addEventListener("resize",function(){if(document.body.getAttribute("data-state")==="found"&&window.__row)drawLabel(window.__row);});
})();
