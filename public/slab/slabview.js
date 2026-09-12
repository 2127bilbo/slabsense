/* public/slab/slabview.js — public cert page: composite + report */
(function(){
"use strict";
var LABEL_WIN={x:0.2847,y:0.1143,w:0.4458,h:0.1201};   // from scripts/plate-windows.json
var CARD_WIN ={x:0.2999,y:0.3018,w:0.4174,h:0.5586};
var PLATE={w:987,h:1024};
var q=new URLSearchParams(location.search), cert=(q.get("cert")||"").trim().toUpperCase();
var DEV=location.protocol==="file:"||/^(localhost|127\.0\.0\.1)$/.test(location.hostname);
var api=(DEV&&q.get("src"))||("/api/slab?cert="+encodeURIComponent(cert));
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
    var b=SlabLabel.build(input,s,p.url,p.alnum);
    if(!b){document.body.setAttribute("data-label","failed");return;}
    var cv=$("label"), slab=$("slab"), rect=labelRect();
    var pxW=Math.round(slab.clientWidth*rect.w*3);  // 3× for crisp downscale
    cv.width=pxW; cv.height=Math.round(pxW*s.H/s.W); place(cv,rect);
    SlabLabel.drawCanvas(cv,b.shapes,b.cfg,"#ffffff");
    document.body.setAttribute("data-label","drawn");
  }).catch(function(){document.body.setAttribute("data-label","failed");});
}
function showSide(row,side){
  var src=side==="front"?(row.user_card_image||row.enhanced_front_path||row.front_image_path):(row.enhanced_back_path||row.back_image_path);
  var img=$("card"); img.hidden=!src; if(src)img.src=src; place(img,CARD_WIN); place($("well"),CARD_WIN);
  $("label").hidden=side!=="front";
  $("btnFront").setAttribute("aria-pressed",side==="front");$("btnBack").setAttribute("aria-pressed",side==="back");
}
function labelOf(k){return k.replace(/([a-z])([A-Z])/g,"$1 $2").replace(/^./,function(c){return c.toUpperCase();});}
function kv(el,obj,fmt){el.innerHTML=Object.keys(obj||{}).map(function(k){var v=obj[k];if(v&&typeof v==="object")v=Object.values(v).join(" / ");return '<div><b>'+esc(fmt?fmt(v):v)+'</b><span>'+esc(labelOf(k))+'</span></div>';}).join("")||'<div><span>Not recorded</span></div>';}
/* The app stores subgrades as 8 camelCase keys (frontCentering…backSurface). Group them into
   Front/Back tiles when that shape is present; fall back to a flat list for other shapes
   (e.g. the older spec-shaped {centering,corners,edges,surface} fixture). */
function subgradeGroups(sub){
  sub=sub||{};
  if("frontCentering" in sub){
    var pick=function(prefix){var o={};["Centering","Corners","Edges","Surface"].forEach(function(suf){var k=prefix+suf;if(k in sub)o[suf]=sub[k];});return o;};
    return [["Front",pick("front")],["Back",pick("back")]];
  }
  return [["",sub]];
}
function kvGroups(el,groups){
  var html="";
  groups.forEach(function(g){
    var heading=g[0], obj=g[1]||{}, keys=Object.keys(obj);
    if(heading)html+='<div class="kvhead">'+esc(heading)+'</div>';
    html+=keys.length?keys.map(function(k){var v=obj[k];if(v&&typeof v==="object")v=Object.values(v).join(" / ");return '<div><b>'+esc(v==null?"—":v)+'</b><span>'+esc(labelOf(k))+'</span></div>';}).join(""):'<div><span>Not recorded</span></div>';
  });
  el.innerHTML=html||'<div><span>Not recorded</span></div>';
}
/* Centering objects come in several shapes depending on how they were measured — see
   src/lib/corner-measurement.js (lrDisplay/tbDisplay, horizontal/vertical) and
   src/App.jsx's save code (lrRatio/tbRatio) — plus the older spec fixture's {lr,tb}. */
function centeringText(c){
  if(!c)return "—";
  if(c.lrDisplay||c.tbDisplay)return [c.lrDisplay,c.tbDisplay].filter(Boolean).join("  ·  ");
  if(c.lr||c.tb)return [c.lr,c.tb].filter(Boolean).join("  ·  ");
  if(c.horizontal!=null||c.vertical!=null)return [c.horizontal,c.vertical].filter(function(x){return x!=null;}).join("  ·  ");
  if(c.lrRatio!=null||c.tbRatio!=null)return [c.lrRatio,c.tbRatio].filter(function(x){return x!=null;}).join("  ·  ");
  return Object.values(c).join(" / ");
}
/* Ding severity is a number 1–3 in the app's real rows (see src/App.jsx around the dings
   mapping); older/spec fixtures may already carry a word. */
function severityText(s){
  if(s==null)return "";
  if(typeof s==="number")return s>=3?"major":(s>=2?"moderate":"minor");
  return String(s);
}
function render(row){
  window.__row=row;
  var input=SlabLabel.fromScan(row,row.cert);
  document.title="SlabSense "+row.cert+" — "+input.name;
  $("hdrCert").textContent=row.cert;
  $("gradeNum").textContent=input.grade;$("gradeWord").textContent=input.gradeWord;
  $("name").textContent=input.name;$("setline").textContent=[input.l2,input.l3,input.l4].filter(Boolean).join(" · ");
  var st=$("status");st.textContent=STATUS[row.status]||row.status;st.className="status "+(STATUS[row.status]?row.status:"unknown");
  kvGroups($("subgrades"),subgradeGroups(row.subgrades));
  $("centering").innerHTML=[["Front",row.front_centering],["Back",row.back_centering]].map(function(x){
    return '<div><b>'+esc(centeringText(x[1]))+'</b><span>'+esc(x[0])+'</span></div>';
  }).join("");
  var d=row.dings||[];$("dings").innerHTML=d.map(function(x){var sev=severityText(x.severity);return '<li>'+(x.side?esc(x.side)+' — ':'')+esc(x.type||"defect")+(sev?' <em>('+esc(sev)+')</em>':'')+(x.location?' — '+esc(x.location):'')+(x.note||x.desc?': '+esc(x.note||x.desc):'')+'</li>';}).join("");$("nodings").hidden=d.length>0;
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
