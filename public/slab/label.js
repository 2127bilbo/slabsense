/* public/slab/label.js — SlabSense label engine.
   Requires globals: qrcode, opentype, polygonClipping, FONT_B64, MARK_PATH, FRAME (load in that order).
   Exposes window.SlabLabel. Pure: no DOM except the canvas handed to drawCanvas. */
(function(root){
"use strict";
/* >>> paste 1: ART, GRADES, SRC, HDR_TOP, DEF <<< */
var ART=FRAME._art;                       // {x,y,w,h} of the source artwork bbox
var GRADES=[["10","PRISTINE"],["10","GEM MINT"],["9","MINT"],["8.5","NM-MT+"],["8","NM-MT"],
["7.5","NM+"],["7","NM"],["6.5","EX-MT+"],["6","EX-MT"],["5.5","EX+"],["5","EX"],
["4.5","VG-EX+"],["4","VG-EX"],["3.5","VG+"],["3","VG"],["2.5","GOOD+"],["2","GOOD"],
["1.5","FAIR"],["1","POOR"]];

/* measured from the artwork, in source pixels */
var SRC={
  ruleY:[4,13], ruleT:2.2, ruleInset:180,      // horizontal rules: y offsets from art top, thickness, x inset
  divCx:482.25,                                 // divider piece centre x
  hdrCx:488.30,                                 // header assembly centre x
  badge:[330,122,53,66]                         // x,y,w,h of the S badge slot — tallest piece of the header
};
var HDR_TOP=1.0;                                // mm from trim top to the badge top, before nudge

/* ---------- settings & defaults ---------- */
var DEF={
  W:69,H:21.4,frameScale:1,
  headerScale:1,hdrX:0,hdrY:0,
  div1:0.468,div2:0.721,textL:0.062,colGap:0.4,certPos:"qr",showBoxes:false,
  outlineW:0.15,gradeOutline:true,gradeFont:"i3",wordFont:"i5",
  base:"slabsenseai.com/v/",compact:true,ec:"auto",dot:"square",eye:"square",logoPct:24,
  qrAuto:false,qrMM:11,useToken:false,secret:"",
  certPrefix:"SS26-",certDigits:5,certNext:1,
  color:"black",grpLayers:true,backdrop:"clear"
};
/* >>> paste 2: n3, n2, esc, pad <<< */
function n3(x){return Math.round(x*1000)/1000;} function n2(x){return Math.round(x*100)/100;}
function esc(s){return String(s).replace(/[&<>"]/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c];});}
function pad(n,d){var s=String(Math.max(0,Math.floor(n)));while(s.length<d)s="0"+s;return s;}
/* >>> paste 3: fonts + text layout (F, ab, loadFonts, run, tw, flattenPath, ringArea, glyphRings, tp, fit) <<< */
var F={};
function ab(b){var s=atob(b),a=new ArrayBuffer(s.length),u=new Uint8Array(a);for(var i=0;i<s.length;i++)u[i]=s.charCodeAt(i);return a;}
function loadFonts(){
  var m={bcR:"BarlowCondensed-Regular",bcS:"BarlowCondensed-SemiBold",bcB:"BarlowCondensed-Bold",
         i3:"Inter-300",i5:"Inter-500",i7:"Inter-700",mi:"Michroma-Regular"};
  for(var k in m) F[k]=opentype.parse(ab(FONT_B64[m[k]]));
}
/* glyph run with kerning: returns [{g,adv}] where adv is the pen advance in mm incl. kerning + tracking */
function run(f,t,s,tr){
  var gs=f.stringToGlyphs(String(t)),u=s/f.unitsPerEm,out=[],w=0;
  for(var i=0;i<gs.length;i++){
    var a=(gs[i].advanceWidth||0)*u;
    if(i<gs.length-1)a+=f.getKerningValue(gs[i],gs[i+1])*u+tr;
    out.push({g:gs[i],adv:a});w+=a;
  }
  return {gl:out,w:w};
}
function tw(f,t,s,tr){return run(f,t,s,tr).w;}
/* ---- clean contours: fonts like Inter build 4, A, R, M, N from overlapping pieces, and some contours cross
   themselves at joins. Filled on screen that is invisible; outlined (or filled in LightBurn, which cancels
   overlaps) it leaves stray lines. Every glyph is flattened and boolean-unioned once, in font units. ---- */
function flattenPath(p,tol){
  var rings=[],cur=null,lx=0,ly=0;
  function seg(px,py){cur.push([px,py]);lx=px;ly=py;}
  function curve(pts){var L=0;for(var i=1;i<pts.length;i++)L+=Math.hypot(pts[i][0]-pts[i-1][0],pts[i][1]-pts[i-1][1]);
    var n=Math.max(4,Math.min(64,Math.ceil(L/tol)));
    for(var k=1;k<=n;k++){var t=k/n,q=pts.slice();while(q.length>1){var r=[];for(var j=0;j<q.length-1;j++)r.push([q[j][0]+(q[j+1][0]-q[j][0])*t,q[j][1]+(q[j+1][1]-q[j][1])*t]);q=r;}seg(q[0][0],q[0][1]);}}
  p.commands.forEach(function(c){
    if(c.type==="M"){cur=[[c.x,c.y]];rings.push(cur);lx=c.x;ly=c.y;}
    else if(c.type==="L")seg(c.x,c.y);
    else if(c.type==="C")curve([[lx,ly],[c.x1,c.y1],[c.x2,c.y2],[c.x,c.y]]);
    else if(c.type==="Q")curve([[lx,ly],[c.x1,c.y1],[c.x,c.y]]);
  });
  return rings.filter(function(r){return r.length>=3;});
}
function ringArea(r){var a=0;for(var i=0,j=r.length-1;i<r.length;j=i++)a+=(r[j][0]*r[i][1]-r[i][0]*r[j][1]);return a/2;}
function glyphRings(f,g){                     // rings in font units, y down, baseline at 0 — cached on the glyph
  if(g._ss)return g._ss;
  var upem=f.unitsPerEm, rings=flattenPath(g.getPath(0,0,upem),upem/250), out=[];
  if(rings.length){
    var pos=[],neg=[],ap=0,an=0;
    rings.forEach(function(r){var a=ringArea(r);if(a>0){pos.push(r);ap+=a;}else{neg.push(r);an-=a;}});
    var outer=ap>=an?pos:neg, holes=ap>=an?neg:pos;   // the winding carrying more area is the outside
    try{
      var u=polygonClipping.union.apply(null,outer.map(function(r){return [r];}));
      if(holes.length)u=polygonClipping.difference.apply(null,[u].concat(holes.map(function(r){return [r];})));
      u.forEach(function(poly){poly.forEach(function(ring){out.push(ring.slice(0,-1));});});
    }catch(e){out=rings;}
  }
  return g._ss=out;
}
function tp(f,t,x,y,s,tr,al){
  var r=run(f,t,s,tr),cx=al==="center"?x-r.w/2:(al==="right"?x-r.w:x),d="",u=s/f.unitsPerEm;
  for(var i=0;i<r.gl.length;i++){var g=r.gl[i].g;
    if(g.unicode!==32)glyphRings(f,g).forEach(function(ring){
      for(var k=0;k<ring.length;k++)d+=(k?"L":"M")+n2(cx+ring[k][0]*u)+" "+n2(y+ring[k][1]*u);
      d+="Z";
    });
    cx+=r.gl[i].adv;}
  return {d:d,w:r.w};
}
function fit(f,t,maxW,s,tr){var z=s;for(var i=0;i<70;i++){if(tw(f,t,z,tr*(z/s))<=maxW||z<0.3)break;z*=0.97;}return z;}
/* >>> paste 4: QR (ALNUM … qrShapes) <<< */
var ALNUM=/^[0-9A-Z $%*+\-.\/:]*$/;
function tryQR(ver,lv,t,mode){try{var q=qrcode(ver,lv);q.addData(t,mode);q.make();return q;}catch(e){return null;}}
/* auto: smallest version, highest level that fits in it (never below M). A centre mark forces H. */
/* levels that can absorb a centre mark: its area must stay well inside the recovery capacity */
function levelsFor(ec,markPct){
  if(ec!=="auto")return [ec];
  var a=markPct*markPct;                                  // fraction of the code the mark hides
  return a<=0.001?["H","Q","M"]:(a<=0.07?["H","Q"]:["H"]);
}
function buildQR(t,alnum,ec,markPct){
  var mode=alnum?"Alphanumeric":"Byte";
  var levels=levelsFor(ec,markPct);
  for(var k=1;k<=20;k++)for(var i=0;i<levels.length;i++){var q=tryQR(k,levels[i],t,mode);if(q)return {q:q,level:levels[i],version:k};}
  return null;
}
/* how many characters fit in version `ver` at level `lv` (binary search, cached) */
var CAPC={};
function capacity(ver,lv,alnum){
  var key=ver+lv+(alnum?"a":"b");if(CAPC[key])return CAPC[key];
  var lo=0,hi=800,mode=alnum?"Alphanumeric":"Byte",ch=alnum?"A":"a";
  while(lo<hi){var mid=(lo+hi+1)>>1;if(tryQR(ver,lv,new Array(mid+1).join(ch),mode))lo=mid;else hi=mid-1;}
  return CAPC[key]=lo;
}
function isFinder(r,c,N){return (r<7&&c<7)||(r<7&&c>=N-7)||(r>=N-7&&c<7);}
function rrD(x,y,w,h,r){
  r=Math.max(0,Math.min(r,Math.min(w,h)/2));
  if(r<=0)return "M"+n3(x)+" "+n3(y)+"h"+n3(w)+"v"+n3(h)+"h"+n3(-w)+"Z";
  return "M"+n3(x+r)+" "+n3(y)+"H"+n3(x+w-r)+"A"+n3(r)+" "+n3(r)+" 0 0 1 "+n3(x+w)+" "+n3(y+r)+
    "V"+n3(y+h-r)+"A"+n3(r)+" "+n3(r)+" 0 0 1 "+n3(x+w-r)+" "+n3(y+h)+"H"+n3(x+r)+
    "A"+n3(r)+" "+n3(r)+" 0 0 1 "+n3(x)+" "+n3(y+h-r)+"V"+n3(y+r)+"A"+n3(r)+" "+n3(r)+" 0 0 1 "+n3(x+r)+" "+n3(y)+"Z";
}
function rrDrev(x,y,w,h,r){
  r=Math.max(0,Math.min(r,Math.min(w,h)/2));
  if(r<=0)return "M"+n3(x)+" "+n3(y)+"v"+n3(h)+"h"+n3(w)+"v"+n3(-h)+"Z";
  return "M"+n3(x+r)+" "+n3(y)+"A"+n3(r)+" "+n3(r)+" 0 0 0 "+n3(x)+" "+n3(y+r)+"V"+n3(y+h-r)+
    "A"+n3(r)+" "+n3(r)+" 0 0 0 "+n3(x+r)+" "+n3(y+h)+"H"+n3(x+w-r)+"A"+n3(r)+" "+n3(r)+" 0 0 0 "+n3(x+w)+" "+n3(y+h-r)+
    "V"+n3(y+r)+"A"+n3(r)+" "+n3(r)+" 0 0 0 "+n3(x+w-r)+" "+n3(y)+"Z";
}
function circD(cx,cy,r){return "M"+n3(cx-r)+" "+n3(cy)+"a"+n3(r)+" "+n3(r)+" 0 1 0 "+n3(2*r)+" 0a"+n3(r)+" "+n3(r)+" 0 1 0 "+n3(-2*r)+" 0Z";}

function markShape(x,y,size,layer){var s=size/100;return {d:MARK_PATH,mode:"fill",layer:layer,t:[s,s,x,y]};}

function qrShapes(qr,x0,y0,size,o){
  var N=qr.getModuleCount(), m=size/N, d=[];
  var lm=o.logoPct>0?Math.ceil(N*o.logoPct):0; if(lm&&lm%2!==N%2)lm+=1;   // keep the cutout centred on the grid
  var lo=(N-lm)/2, hi=lo+lm;
  for(var r=0;r<N;r++)for(var c=0;c<N;c++){
    if(!qr.isDark(r,c)||isFinder(r,c,N))continue;
    if(lm&&r>=lo&&r<hi&&c>=lo&&c<hi)continue;
    var x=x0+c*m,y=y0+r*m;
    if(o.dot==="dot")d.push(circD(x+m/2,y+m/2,m*0.46));
    else d.push(rrD(x,y,m*1.01,m*1.01,o.dot==="rounded"?m*0.28:0));
  }
  [[0,0],[N-7,0],[0,N-7]].forEach(function(p){
    var ex=x0+p[0]*m,ey=y0+p[1]*m;
    var rO=o.eye==="square"?0:(o.eye==="circle"?3.5*m:m*1.7);
    var rI=o.eye==="square"?0:(o.eye==="circle"?1.5*m:m*0.72);
    d.push(rrD(ex,ey,7*m,7*m,rO)+" "+rrDrev(ex+m,ey+m,5*m,5*m,Math.max(0,rO-m*0.55)));
    d.push(rrD(ex+2*m,ey+2*m,3*m,3*m,rI));
  });
  var out=[{d:d.join(" "),mode:"fill",layer:"qr",rule:"evenodd"}];
  if(lm){var lx=x0+lo*m,ls=lm*m;out.push(markShape(lx+ls*0.04,y0+lo*m+ls*0.04,ls*0.92,"mark"));}
  return {shapes:out,N:N,module:m};
}
/* >>> paste 5: frame (piece, frame, capOf) <<< */
function piece(name,sx,sy,tx,ty,layer){
  return {d:FRAME[name].d,mode:"fill",layer:layer||"frame",t:[sx,sy,tx,ty]};
}
function frame(W,H,cfg){
  var k=(H/ART.h)*cfg.frameScale;
  var Sh=[];
  var ax=ART.x*k, ay=ART.y*k;
  /* corners, mirrored about the trim centre */
  Sh.push(piece("corner", k, k, -ax, -ay));
  Sh.push(piece("corner",-k, k, W+ax, -ay));
  Sh.push(piece("corner", k,-k, -ax, H+ay));
  Sh.push(piece("corner",-k,-k, W+ax, H+ay));
  /* mid-edge ornaments, vertically centred */
  var emB=FRAME.edgeMid.box, emCy=emB[1]+emB[3]/2;
  var emTy=H/2-emCy*k;
  Sh.push(piece("edgeMid", k,k, -ax, emTy));
  Sh.push(piece("edgeMid",-k,k, W+ax, emTy));
  /* horizontal rules, stretched between the corners */
  var rx=SRC.ruleInset*k, rw=W-2*rx, rt=SRC.ruleT*k, d=[];
  if(rw>0.5) SRC.ruleY.forEach(function(oy){
    d.push(rrD(rx,oy*k,rw,rt,0));
    d.push(rrD(rx,H-oy*k-rt,rw,rt,0));
  });
  Sh.push({d:d.join(" "),mode:"fill",layer:"frame"});
  /* dividers */
  var d1=cfg.div1*W, d2=cfg.div2*W;
  Sh.push(piece("divider",k,k, d1-SRC.divCx*k, -ay));
  Sh.push(piece("divider",k,k, d2-SRC.divCx*k, -ay));
  /* header assembly: centred, badge top at HDR_TOP, plus nudges */
  var kh=k*cfg.headerScale, b=SRC.badge;
  var htx=W/2+cfg.hdrX-SRC.hdrCx*kh, hty=HDR_TOP+cfg.hdrY-b[1]*kh;
  ["flourL","flourR","wordmark"].forEach(function(nm){ Sh.push(piece(nm,kh,kh,htx,hty,"text")); });
  Sh.push(markShape(b[0]*kh+htx, b[1]*kh+hty, Math.max(b[2],b[3])*kh, "mark"));

  /* ink extents of each header piece, so a column only has to clear what is actually above it */
  var ink=["flourL","flourR","wordmark"].map(function(nm){return FRAME[nm].box;}).concat([b]).map(function(bx){
    return {x0:htx+bx[0]*kh, x1:htx+(bx[0]+bx[2])*kh, bot:hty+(bx[1]+bx[3])*kh};
  });
  function clearBelow(x0,x1,floor){var y=floor;ink.forEach(function(p){if(p.x1>x0&&p.x0<x1)y=Math.max(y,p.bot);});return y;}

  return {shapes:Sh, k:k, d1:d1, d2:d2, clearBelow:clearBelow,
    divHalf:FRAME.divider.box[2]*k/2,                     // half-width of a divider ornament
    ruleTop:SRC.ruleY[1]*k+rt, ruleBot:H-SRC.ruleY[1]*k-rt}; // inner rules: bottom edge of the top one, top edge of the bottom one
}
function capOf(f){ if(!f._cap){var bb=f.charToGlyph("H").getPath(0,0,100).getBoundingBox();f._cap=-bb.y1/100;} return f._cap; }
/* >>> paste 6: geometry <<< */
function geometry(cfg,qr){
  var W=cfg.W,H=cfg.H;
  var f=frame(W,H,cfg), Sh=f.shapes.slice();
  var cl=cfg.colGap, dh=f.divHalf;                        // clearance from a divider ornament to ink

  var N=qr.getModuleCount(), K=1+8/N;                     // K: ink box → box incl. 4-module quiet zones
  var inQR=cfg.certPos==="qr";
  var csN=H*0.092, certW=inQR?capOf(F.bcS)*csN+0.25:0;    // vertical cert: digit height + breathing room

  /* ---- QR box ---- */
  var left=f.d1+dh+cl+certW, right=f.d2-dh;
  var qTop=f.clearBelow(left,right,f.ruleTop), qBot=f.ruleBot;
  var availW=right-left, availH=qBot-qTop;
  var qMax=Math.max(2,Math.min(availW,availH)/K);
  var qs=cfg.qrAuto?qMax:Math.min(cfg.qrMM,qMax);
  var need=4*qs/N;
  /* band = the largest QR ink box, centred in the room available; a smaller QR sits centred inside it */
  var bandTop=qTop+(availH-qs*K)/2+need, bandBot=bandTop+qs, band=bandBot-bandTop;
  var qrX=right-need-qs, qrY=bandTop;
  var q=qrShapes(qr,qrX,qrY,qs,cfg);
  q.shapes.forEach(function(s){Sh.push(s);});

  if(inQR){                                               // hugs the quiet-zone boundary, bottom-aligned with the QR
    var cs=fit(F.bcS,cfg.cert,qs*0.98,csN,0.08);
    Sh.push({d:tp(F.bcS,cfg.cert,0,0,cs,cs*0.055,"left").d,mode:"fill",layer:"text",rot:[-90,qrX-need,qrY+qs]});
  }

  /* ---- card text in column 1: name cap-top on the band top, last baseline on the band bottom ---- */
  var c1=[cfg.textL*W, f.d1-dh-cl], maxW=c1[1]-c1[0], shrink=1;
  var capB=capOf(F.bcB), lead=band/(3+1.30*capB);
  var lines=[[cfg.name,F.bcB,1.30,0],[cfg.l2,F.bcS,0.74,0],[cfg.l3,F.bcS,0.74,0],
             inQR?[cfg.l4,F.bcR,0.68,0]:[cfg.cert,F.bcS,0.60,0.06]];
  lines.forEach(function(r,i){
    if(!r[0])return;
    var s=fit(r[1],r[0],maxW,lead*r[2],r[3]); shrink=Math.min(shrink,s/(lead*r[2]));
    Sh.push({d:tp(r[1],r[0],c1[0],bandTop+capB*lead*1.30+lead*i,s,s*r[3],"left").d,mode:"fill",layer:"text"});
  });

  /* ---- grade in column 3: designation cap-top on the band top, number baseline on the band bottom ---- */
  var c3=[f.d2+dh+cl, W-cfg.textL*W], gcx=(c3[0]+c3[1])/2, gw=(c3[1]-c3[0])*0.94;
  var fw=F[cfg.wordFont]||F.i5, fg=F[cfg.gradeFont]||F.i3;
  var wz=fit(fw,cfg.gradeWord,gw,band*0.19,band*0.19*0.13), wordCap=capOf(fw)*wz;
  var gs=Math.min(fit(fg,cfg.grade,gw,band,0),(band-wordCap-band*0.08)/capOf(fg));
  Sh.push({d:tp(fw,cfg.gradeWord,gcx,bandTop+wordCap,wz,wz*0.13,"center").d,
          mode:cfg.gradeOutline?"stroke":"fill",w:Math.min(cfg.outlineW,Math.max(0.06,wz*0.05)),layer:"grade"});
  Sh.push({d:tp(fg,cfg.grade,gcx,bandBot,gs,0,"center").d,
          mode:cfg.gradeOutline?"stroke":"fill",w:cfg.outlineW,layer:"grade"});

  if(cfg.showBoxes){
    [c1,c3].forEach(function(c){Sh.push({d:rrD(c[0],bandTop,c[1]-c[0],band,0),mode:"stroke",w:0.08,layer:"_guide"});});
    Sh.push({d:rrD(qrX,qrY,qs,qs,0)+" "+rrD(qrX-need,qrY-need,qs+2*need,qs+2*need,0),mode:"stroke",w:0.08,layer:"_guide"});
  }
  return {shapes:Sh,qr:q,qs:qs,need:need,bind:(availW<=availH?"width":"height"),availW:availW,availH:availH,certW:certW,
          shrink:shrink,band:[bandTop,bandBot],f:f};
}
/* >>> paste 7: render (PAL_K, PAL_L, applyT, drawCanvas, toSVG) — with the two S→cfg edits <<< */
var PAL_K={frame:"#000",text:"#000",grade:"#000",qr:"#000",mark:"#000",_guide:"#f0f"};
var PAL_L={frame:"#ff0000",text:"#000000",grade:"#0000ff",qr:"#00a000",mark:"#ff00ff",_guide:"#f0f"};
function applyT(ctx,s){
  if(s.t){ctx.translate(s.t[2],s.t[3]);ctx.scale(s.t[0],s.t[1]);}
  if(s.rot){ctx.translate(s.rot[1],s.rot[2]);ctx.rotate(s.rot[0]*Math.PI/180);}
}
function drawCanvas(cv,shapes,cfg,ink){
  var K=cv.width/cfg.W, ctx=cv.getContext("2d");
  ctx.setTransform(1,0,0,1,0,0); ctx.clearRect(0,0,cv.width,cv.height); ctx.scale(K,K);
  ctx.lineJoin="round"; ctx.lineCap="round";
  shapes.forEach(function(s){
    if(!s.d) return;
    ctx.save(); applyT(ctx,s);
    var p=new Path2D(s.d);
    if(s.layer==="_guide"){ctx.strokeStyle="#ff40c0";ctx.lineWidth=0.1;ctx.stroke(p);}
    else if(s.mode==="fill"){ctx.fillStyle=ink;ctx.fill(p,s.rule||"nonzero");}
    else{ctx.strokeStyle=ink;ctx.lineWidth=s.w;ctx.stroke(p);}
    ctx.restore();
  });
  ctx.setTransform(1,0,0,1,0,0);
}
function toSVG(shapes,cfg){
  var pal=cfg.color==="layers"?PAL_L:PAL_K, G={};
  shapes.forEach(function(s){ if(s.layer==="_guide"||!s.d)return; (G[s.layer]=G[s.layer]||[]).push(s); });
  var body="";
  ["frame","text","grade","qr","mark"].forEach(function(L){
    if(!G[L])return;
    var inner="";
    G[L].forEach(function(s){
      var t="";
      if(s.t)t=' transform="translate('+n3(s.t[2])+' '+n3(s.t[3])+') scale('+n3(s.t[0])+' '+n3(s.t[1])+')"';
      else if(s.rot)t=' transform="translate('+n3(s.rot[1])+' '+n3(s.rot[2])+') rotate('+s.rot[0]+')"';
      var a=s.mode==="fill"
        ?' fill="'+pal[L]+'" stroke="none"'+(s.rule?' fill-rule="'+s.rule+'"':'')
        :' fill="none" stroke="'+pal[L]+'" stroke-width="'+n3(s.w)+'" stroke-linejoin="round" stroke-linecap="round"';
      inner+='  <path'+t+a+' d="'+s.d+'"/>\n';
    });
    body+=cfg.grpLayers?'<g id="'+L+'">\n'+inner+'</g>\n':inner;
  });
  return '<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" version="1.1" '+
    'width="'+n3(cfg.W)+'mm" height="'+n3(cfg.H)+'mm" viewBox="0 0 '+n3(cfg.W)+' '+n3(cfg.H)+'">\n'+
    '<title>SlabSense '+esc(cfg.cert)+'</title>\n'+body+'</svg>\n';
}
/* >>> paste 8: payload (AL, token) <<< */
var AL="ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function token(c,s){
  if(!s||!window.crypto||!crypto.subtle)return Promise.resolve("");
  var e=new TextEncoder();
  return crypto.subtle.importKey("raw",e.encode(s),{name:"HMAC",hash:"SHA-256"},false,["sign"])
    .then(function(k){return crypto.subtle.sign("HMAC",k,e.encode(c));})
    .then(function(g){var b=new Uint8Array(g),o="";for(var i=0;i<4;i++)o+=AL[b[i]%32];return o;})
    .catch(function(){return "";});
}

function cfgOf(input,settings){
  var c={};for(var k in DEF)c[k]=(k in settings)?settings[k]:DEF[k];
  c.logoPct=Math.max(0,Math.min(30,c.logoPct))/100;
  c.name=input.name||"";c.l2=input.l2||"";c.l3=input.l3||"";c.l4=input.l4||"";
  c.cert=input.cert||"";c.grade=String(input.grade||"");c.gradeWord=input.gradeWord||"";
  return c;
}
function payload(input,settings){
  var cert=input.cert||"", s=settings||DEF;
  return token(cert,s.useToken?s.secret:"").then(function(t){
    var url=(s.base||DEF.base)+cert+(s.useToken&&t?"-"+t:"");
    if(s.compact!==false)url=url.toUpperCase();
    return {url:url,alnum:s.compact!==false&&ALNUM.test(url)};
  });
}
function build(input,settings,url,alnum){
  var cfg=cfgOf(input,settings||{});
  var built=buildQR(url,alnum,cfg.ec,cfg.logoPct);
  if(!built)return null;
  var g=geometry(cfg,built.q), mod=g.qr.module;
  var maxN=Math.floor(Math.min(g.availW,g.availH)/0.5)-8, vMax=Math.floor((maxN-21)/4)+1;
  var bl=levelsFor(cfg.ec,cfg.logoPct), bLevel=bl[bl.length-1];
  var budget=vMax>=1?capacity(Math.min(vMax,20),bLevel,alnum):0;
  var warnings=[];
  if(mod<0.38)warnings.push(["bad","Modules at "+mod.toFixed(3)+" mm will not scan reliably. The QR column between the dividers is "+(g.f.d2-g.f.d1).toFixed(1)+" mm wide — that is the limit. Shorten the verify URL"+(vMax>=1?" to about "+budget+" characters":"")+", move the cert under the card text, or widen the column in Settings › Layout."]);
  else if(mod<0.5)warnings.push(["warn","Modules at "+mod.toFixed(3)+" mm are under the 0.5 mm comfort threshold. Engrave a test tile and scan it before running a batch."]);
  else warnings.push(["ok","Modules at "+mod.toFixed(3)+" mm — comfortably scannable."]);
  if(vMax>=1&&url.length>budget)warnings.push(["warn","Payload is "+url.length+" characters; at 0.5 mm modules this column holds v"+Math.min(vMax,20)+"-"+bLevel+" ("+budget+" ch). Every character you cut buys module size."]);
  if(cfg.logoPct>0)warnings.push([cfg.logoPct>0.25?"warn":"info","Centre mark hides "+Math.round(cfg.logoPct*cfg.logoPct*100)+" % of the code"+(cfg.logoPct>0.25?" and forces error-correction H (a bigger code). Keep it at 25 % or under to stay at level Q.":" — level "+built.level+" recovers "+({L:7,M:15,Q:25,H:30})[built.level]+" %.")]);
  if(cfg.dot==="dot")warnings.push(["warn","Dot modules put less ink per cell than squares — harder to read on an engrave."]);
  if(cfg.useToken&&!cfg.secret)warnings.push(["warn","Check token is on but the signing secret is empty — no token was appended."]);
  if(g.shrink<0.72)warnings.push(["warn","Card text was shrunk to "+Math.round(g.shrink*100)+" % to fit the column. Shorten the longest line if it looks small."]);
  if(cfg.compact===false)warnings.push(["warn","Compact encoding is off — an uppercase URL buys a whole QR version."]);
  warnings.push(["info","Quiet zone of "+g.need.toFixed(1)+" mm is reserved on all four sides of the QR and comes from bare substrate. A frosted engrave on clear acrylic is low contrast — scan against the backing the slab will actually have."]);
  return {shapes:g.shapes, svg:toSVG(g.shapes,cfg), g:g, cfg:cfg, qr:{N:g.qr.N,module:g.qr.module,obj:built.q},
    stats:{version:built.version,level:built.level,modules:g.qr.N,moduleMM:n3(mod),qrMM:n3(g.qs),payloadLen:url.length,budget:budget,budgetVersion:vMax>=1?"v"+Math.min(vMax,20)+"-"+bLevel:null,bind:g.bind,shrink:n3(g.shrink),url:url},
    warnings:warnings};
}
function qrOnlySVG(built,settings){
  var q=qrShapes(built.qr.obj,0,0,built.g.qs,built.cfg);
  var c={};for(var k in built.cfg)c[k]=built.cfg[k];c.W=built.g.qs;c.H=built.g.qs;
  return toSVG(q.shapes,c);
}
/* Label text from a `scans` / `slab_public` row. One place; keep the studio and the cert page identical. */
function fromScan(row,cert){
  var info=row.card_info||{};
  var up=function(s){return s==null?"":String(s).toUpperCase().trim();};
  var year=info.year||(String(row.card_set||"").match(/\b(19|20)\d{2}\b/)||[])[0]||"";
  var game=({pokemon:"POKÉMON",mtg:"MAGIC",yugioh:"YU-GI-OH!",sports:"",other:""})[row.card_game]||"";
  var setName=up(info.setName||row.card_set).replace(/\b(19|20)\d{2}\b/,"").trim();
  if(game&&setName.indexOf(game)>=0)game="";                    // "2024 POKÉMON X SPONGEBOB", not "POKÉMON POKÉMON…"
  var number=row.card_number||info.cardNumber||"";
  var gv=row.grade_value==null?"":String(row.grade_value).replace(/\.0$/,"");
  var gl=up(row.grade_label).replace(/\s*\(.*\)$/,"");           // "Pristine (Black Label)" → "PRISTINE"
  return {
    name:up(row.card_name||info.name),
    l2:[year,game,setName].filter(Boolean).join(" ").replace(/\s+/g," "),
    l3:[up(info.variant),number?"#"+number:""].filter(Boolean).join(" "),
    l4:up(info.rarity),
    cert:cert, grade:gv, gradeWord:gl
  };
}
var readyResolve, readyReject, ready=new Promise(function(r,j){readyResolve=r;readyReject=j;});
function init(){ try{loadFonts();readyResolve();}catch(e){readyReject(e);} }
var defaults={};for(var k in DEF)defaults[k]=DEF[k];
root.SlabLabel={ready:ready,defaults:Object.freeze(defaults),GRADES:GRADES,fromScan:fromScan,payload:payload,build:build,drawCanvas:drawCanvas,qrOnlySVG:qrOnlySVG,
  _internal:{geometry:geometry,toSVG:toSVG,capOf:capOf,levelsFor:levelsFor,capacity:capacity}};
if(typeof qrcode==="undefined"||typeof opentype==="undefined"||typeof polygonClipping==="undefined"||typeof FONT_B64==="undefined"||typeof FRAME==="undefined")
  ready=root.SlabLabel.ready=Promise.reject(new Error("label.js: a dependency is missing (load qrcode, opentype, polygon-clipping, fonts, frame first)"));
else init();
})(typeof window!=="undefined"?window:this);
