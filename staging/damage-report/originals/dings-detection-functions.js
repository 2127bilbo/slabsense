   DINGS-BASED DETECTION ENGINE
   ═══════════════════════════════════════════
   Each module detects defects and classifies
   them as TAG DINGS types with side + location
   ═══════════════════════════════════════════ */

// Centering DINGS check — TAG threshold: 55/45 front, 65/35 back for Gem Mint
function checkCenteringDings(centering, side) {
  const maxLR = Math.max(centering.lrRatio, 100 - centering.lrRatio);
  const maxTB = Math.max(centering.tbRatio, 100 - centering.tbRatio);
  const worst = Math.max(maxLR, maxTB);
  const threshold = side === "front" ? 55 : 65;
  
  if (worst > threshold) {
    return [{
      side: side === "front" ? "FRONT" : "BACK",
      type: "CENTERING",
      location: `${centering.lrRatio}L/${Math.round((100-centering.lrRatio)*10)/10}R ${centering.tbRatio}T/${Math.round((100-centering.tbRatio)*10)/10}B`,
      severity: worst - threshold,
    }];
  }
  return [];
}

// Corner wear detection
function detectCornerDings(d, w, h, bn, side) {
  const { left:cl, right:cr, top:ct, bottom:cb, cardW:cW, cardH:cH } = bn;
  const cs = Math.max(24, ~~(Math.min(cW, cH) * 0.09));
  const corners = [
    { name:"TOP LEFT",     x:cl,    y:ct,    tipDist:(dx,dy)=>dx+dy           },
    { name:"TOP RIGHT",    x:cr-cs, y:ct,    tipDist:(dx,dy)=>(cs-dx)+dy      },
    { name:"BOTTOM LEFT",  x:cl,    y:cb-cs, tipDist:(dx,dy)=>dx+(cs-dy)      },
    { name:"BOTTOM RIGHT", x:cr-cs, y:cb-cs, tipDist:(dx,dy)=>(cs-dx)+(cs-dy) },
  ];

  // Only sample pixels within this manhattan distance of the physical corner tip.
  // Root cause of false positives: 72×72 scan box includes card artwork/text interiors.
  // Mew EX bottom corners showed W:58-63% — not foil, but the card's light artwork background.
  // Corner DINGS appear at the actual tip — not 70px into the card. Shrink to tip zone only.
  const tipRadius = ~~(cs * 0.42);

  const dings = [];
  const details = [];
  const sideLabel = side === "front" ? "FRONT" : "BACK";

  // ── Border color (WOTC dark-border detection) ────────────────────────────
  const edgeSamples = 12;
  let borderR=0, borderG=0, borderB=0;
  for(let i=0; i<edgeSamples; i++){
    const ex = Math.min(w-1, cl + Math.round(cW*0.25 + i*(cW*0.5/edgeSamples)));
    const ey = Math.min(h-1, ct + Math.round(cH*0.03));
    const [pr,pg,pb] = PX(d,w,ex,ey);
    borderR+=pr; borderG+=pg; borderB+=pb;
  }
  borderR/=edgeSamples; borderG/=edgeSamples; borderB/=edgeSamples;
  const borderLum = LUM(borderR,borderG,borderB);
  const isDarkBorder = borderLum < 80;

  // ── Holo detection (global variance) ────────────────────────────────────
  let gS=0,gSq=0,gN=0;
  const gStep=Math.max(4,~~(Math.min(cW,cH)/40));
  for(let gy=ct+~~(cH*0.1);gy<cb-~~(cH*0.1);gy+=gStep)
    for(let gx=cl+~~(cW*0.1);gx<cr-~~(cW*0.1);gx+=gStep){
      const l=LUM(...PX(d,w,Math.min(w-1,gx),Math.min(h-1,gy)));
      gS+=l; gSq+=l*l; gN++;
    }
  const cardGVar = gN>0 ? gSq/gN-(gS/gN)**2 : 0;
  const isHolo = cardGVar > 800;

  // ── Pass 1: measure every corner tip, store raw data ────────────────────
  const cornerData = corners.map(({ name, x:cx, y:cy, tipDist }) => {
    let whitePixels=0, colorDevPixels=0, totalPixels=0, sharpness=0, gradCount=0;
    let lSum=0, lSq=0, lN=0;

    for(let dy=0; dy<cs; dy++) for(let dx=0; dx<cs; dx++){
      if(tipDist(dx,dy) > tipRadius) continue; // skip pixels far from corner tip
      const X=Math.min(w-1,Math.max(0,cx+dx)), Y=Math.min(h-1,Math.max(0,cy+dy));
      const [r,g,b]=PX(d,w,X,Y); const l=LUM(r,g,b);
      totalPixels++; lSum+=l; lSq+=l*l; lN++;
      if(l>215 && Math.abs(r-g)<25 && Math.abs(g-b)<25) whitePixels++;
      if(isDarkBorder){
        const cd=Math.abs(r-borderR)+Math.abs(g-borderG)+Math.abs(b-borderB);
        if(cd>60 && l>borderLum+40) colorDevPixels++;
      }
      if(dx<cs-1 && dy<cs-1){
        const gx=Math.abs(LUM(...PX(d,w,Math.min(w-1,X+1),Y))-l);
        const gy=Math.abs(LUM(...PX(d,w,X,Math.min(h-1,Y+1)))-l);
        sharpness+=Math.sqrt(gx*gx+gy*gy); gradCount++;
      }
    }

    const whiteRatio      = totalPixels>0 ? whitePixels/totalPixels : 0;
    const colorDevRatio   = totalPixels>0 ? colorDevPixels/totalPixels : 0;
    const avgSharp        = gradCount>0 ? sharpness/gradCount : 0;
    const effectiveWear   = isDarkBorder ? Math.max(whiteRatio, colorDevRatio*0.7) : whiteRatio;
    const lumMean         = lN>0 ? lSum/lN : 0;
    const lumVariance     = lN>0 ? lSq/lN - lumMean**2 : 0;
    const isUniformBright = lumMean > 180 && lumVariance < 600;

    // Fray/Fill/Angle (supplementary display metrics only — not used for DING decision)
    let fray=1000, fill=1000, angle=1000;
    if(effectiveWear>0.30){fray-=20;fill-=25;}
    else if(effectiveWear>0.15){fray-=10;fill-=12;}
    else if(effectiveWear>0.05){fray-=3;fill-=5;}
    if(avgSharp<5) angle-=8; else if(avgSharp<8) angle-=4; else if(avgSharp<12) angle-=2;

    return { name, effectiveWear, avgSharp, isUniformBright, fray, fill, angle, cx, cy };
  });

  // ── Pass 2: holo adjustment ─────────────────────────────────────────────
  // Holo/foil cards have additional noise sources:
  //   1. Foil glow — bright neutral pixels from reflective coating
  //   2. Card artwork — full-art cards have light-colored interior artwork
  //   3. Rounded corner stock — the physical card tip exposes white card-stock edge
  // We use higher thresholds for holo cards (defined in Pass 3) rather than
  // suppressing detection entirely, so corner/edge DINGS are still reported
  // when damage is significant enough to exceed the holo-adjusted thresholds.

  // ── Pass 3: decide DING per corner and build output ─────────────────────
  for (const c of cornerData) {
    // Conservative detection: ALWAYS require both wear AND sharpness issues
    // High W% alone is NOT enough - card backs often have light-colored designs
    // Real wear shows: high white ratio + LOW sharpness (corner is soft/rounded)
    // False positive shows: high white ratio + HIGH sharpness (corner is still sharp)
    const wearThresh  = isHolo ? 0.22 : 0.15;  // Raised from 0.12
    const sharpThresh = isHolo ? 3    : 5;     // Raised - require clearly soft corners

    // ALWAYS require both conditions - no bypass for "severe wear"
    // because card design (especially backs) can have 50%+ white naturally
    const hasWear = !c.isUniformBright
      && c.effectiveWear > wearThresh
      && c.avgSharp < sharpThresh;

    if(hasWear){
      dings.push({
        side: sideLabel,
        type: "CORNER WEAR",
        location: `${sideLabel} / ${c.name}`,
        severity: c.effectiveWear>0.25 ? 3 : c.effectiveWear>0.15 ? 2 : 1,
        desc: c.effectiveWear>0.25 ? "Significant corner wear" : c.effectiveWear>0.15 ? "Corner wear visible" : "Light corner wear",
      });
    }

    details.push({
      name: c.name, fray: c.fray, fill: c.fill,
      angle: side==="front" ? c.angle : undefined,
      whiteRatio: Math.round(c.effectiveWear*1000)/10,
      sharpness: Math.round(c.avgSharp*10)/10,
      hasDing: hasWear, cropX: c.cx, cropY: c.cy, cropSize: cs,
    });
  }

  return { dings, details };
}

// Edge wear detection
function detectEdgeDings(d, w, h, bn, side) {
  const { left:cl, right:cr, top:ct, bottom:cb, cardW:cW, cardH:cH } = bn;
  const eW = Math.max(5, ~~(Math.min(cW, cH) * 0.025));
  const sampleCount = 80;
  
  const edges = [
    { name:"TOP", samples: Array.from({length:sampleCount},(_,i)=>({x:cl+~~(cW*(i+1)/(sampleCount+1)),y:ct})), dir:"h",
      cropX:cl+~~(cW*.2), cropY:ct, cropW:~~(cW*.6), cropH:~~(cH*.05) },
    { name:"BOTTOM", samples: Array.from({length:sampleCount},(_,i)=>({x:cl+~~(cW*(i+1)/(sampleCount+1)),y:cb-eW})), dir:"h",
      cropX:cl+~~(cW*.2), cropY:cb-~~(cH*.05), cropW:~~(cW*.6), cropH:~~(cH*.05) },
    { name:"LEFT", samples: Array.from({length:sampleCount},(_,i)=>({x:cl,y:ct+~~(cH*(i+1)/(sampleCount+1))})), dir:"v",
      cropX:cl, cropY:ct+~~(cH*.2), cropW:~~(cW*.05), cropH:~~(cH*.6) },
    { name:"RIGHT", samples: Array.from({length:sampleCount},(_,i)=>({x:cr-eW,y:ct+~~(cH*(i+1)/(sampleCount+1))})), dir:"v",
      cropX:cr-~~(cW*.05), cropY:ct+~~(cH*.2), cropW:~~(cW*.05), cropH:~~(cH*.6) },
  ];
  
  const dings = [];
  const details = [];
  const sideLabel = side === "front" ? "FRONT" : "BACK";
  
  for (const { name, samples, dir, cropX, cropY, cropW, cropH } of edges) {
    let whiteCount=0, roughness=0, prevLum=-1, totalSamples=0;
    
    samples.forEach(({x:sx,y:sy}) => {
      for(let dd=0; dd<eW; dd++){
        const ex=Math.min(w-1,Math.max(0,dir==="v"?sx+dd:sx));
        const ey=Math.min(h-1,Math.max(0,dir==="h"?sy+dd:sy));
        const [r,g,b]=PX(d,w,ex,ey); const l=LUM(r,g,b);
        totalSamples++;
        if(l>220 && Math.abs(r-g)<18 && Math.abs(g-b)<18) whiteCount++;
        if(prevLum>=0) roughness+=Math.abs(l-prevLum);
        prevLum=l;
      }
    });
    
    const whiteRatio = whiteCount/totalSamples;
    const avgRoughness = roughness/totalSamples;
    
    let fray = 1000, fill = 1000;
    if(whiteRatio > 0.20) { fray-=15; fill-=20; }
    else if(whiteRatio > 0.08) { fray-=6; fill-=8; }
    else if(whiteRatio > 0.03) { fray-=2; fill-=3; }
    if(avgRoughness > 20) { fray-=5; fill-=5; }
    
    const hasWear = whiteRatio > 0.08 || avgRoughness > 28;
    if (hasWear) {
      dings.push({
        side: sideLabel,
        type: "EDGE WEAR",
        location: `${sideLabel} / ${name}`,
        severity: whiteRatio > 0.20 ? 3 : whiteRatio > 0.12 ? 2 : 1,
        desc: whiteRatio > 0.20 ? "Edge chipping/whitening" : whiteRatio > 0.12 ? "Visible edge wear" : "Minor edge wear",
      });
    }
    
    details.push({ name, fray, fill, whiteRatio: Math.round(whiteRatio*1000)/10, roughness: Math.round(avgRoughness*10)/10, hasDing: hasWear, cropX, cropY, cropW, cropH });
  }
  
  return { dings, details };
}

// Surface defect detection
function detectSurfaceDings(d, w, h, bn, side) {
  const { left:cl, right:cr, top:ct, bottom:cb, cardW:cW, cardH:cH } = bn;
  const mg=0.10;
  const sx=cl+~~(cW*mg), sy=ct+~~(cH*mg), ex=cr-~~(cW*mg), ey=cb-~~(cH*mg);
  const sw=ex-sx, sh=ey-sy;
  const gX=24, gY=32, cellW=~~(sw/gX), cellH=~~(sh/gY);
  const sideLabel = side === "front" ? "FRONT" : "BACK";
  const dings = [];
  const defectCells = [];
  
  let gSum=0, gSq=0, gN=0;
  const step=2;
  
  // Global stats
  for(let gy=0;gy<gY;gy++) for(let gx=0;gx<gX;gx++){
    const bx=sx+gx*cellW, by=sy+gy*cellH;
    for(let dy=0;dy<cellH;dy+=step) for(let dx=0;dx<cellW;dx+=step){
      const l=LUM(...PX(d,w,Math.min(w-1,bx+dx),Math.min(h-1,by+dy)));
      gSum+=l; gSq+=l*l; gN++;
    }
  }
  const gMean=gN>0?gSum/gN:128, gVar=gN>0?gSq/gN-gMean**2:0;
  
  // Cell analysis
  const cells=[];
  for(let gy=0;gy<gY;gy++){cells[gy]=[];for(let gx=0;gx<gX;gx++){
    const bx=sx+gx*cellW, by=sy+gy*cellH;
    let sm=0,n=0,lv=0; const vs=[];
    for(let dy=0;dy<cellH;dy+=step) for(let dx=0;dx<cellW;dx+=step){
      const l=LUM(...PX(d,w,Math.min(w-1,bx+dx),Math.min(h-1,by+dy)));
      sm+=l; n++; vs.push(l);
    }
    const mean=n>0?sm/n:128; for(const v of vs) lv+=(v-mean)**2;
    cells[gy][gx]={mean, variance:n>0?lv/n:0};
  }}
  
  // Detect anomalous regions
  let anomCount=0, scratchCount=0, totalCells=0;
  
  // Holo/foil detection: check if image has high global variance (holo shimmer)
  const isHolo = gVar > 800;
  // Card back detection: the standard Pokemon card back (pokeball design) has very high
  // cell-to-cell variance from the design itself. Detect by checking if it's a back AND
  // has high structured variance (not random like play wear, but organized like design).
  // We use the side label + variance pattern to detect.
  const isBack = side === 'back';
  // High-design card back: high global variance but not a holo front
  const isHighDesignBack = isBack && gVar > 400;
  
  // All-metallic / fully-embossed detection (e.g. Ancient Mew):
  // If >70% of surface cells have high variance, the entire card is metallic by design.
  // Ancient Mew's 17.8% front anomaly rate crossed the normal holo DING threshold (14%)
  // but TAG says the card is fine — the entire surface IS the design, not damage.
  let highVarCellCount=0, allCellCount=0;
  for(let gy=0;gy<gY;gy++) for(let gx=0;gx<gX;gx++){
    allCellCount++;
    if(cells[gy]&&cells[gy][gx]&&cells[gy][gx].variance>300) highVarCellCount++;
  }
  const isAllMetallic = isHolo && !isBack && (allCellCount>0) && (highVarCellCount/allCellCount)>0.70;
  
  // Set thresholds — high-design backs get much higher thresholds since pokeball/logo
  // create massive cell variance that has nothing to do with surface wear
  const baseHigh = isHolo ? 35 : 25;
  const baseLow  = isHolo ? 22 : 15;
  const diffThreshHigh = isHighDesignBack ? 55 : isAllMetallic ? 48 : baseHigh;
  const diffThreshLow  = isHighDesignBack ? 38 : isAllMetallic ? 32 : baseLow;
  const varMultiplier  = isHolo ? 3.5 : isHighDesignBack ? 4.5 : 2.8;
  const varFloor       = isHolo ? 400 : isHighDesignBack ? 600 : 250;
  
  for(let gy=1;gy<gY-1;gy++) for(let gx=1;gx<gX-1;gx++){
    totalCells++;
    const c=cells[gy][gx];
    const nbs=[cells[gy-1][gx],cells[gy+1][gx],cells[gy][gx-1],cells[gy][gx+1]];
    const nMean=nbs.reduce((s,n)=>s+n.mean,0)/4;
    const diff=Math.abs(c.mean-nMean);
    
    if(diff>diffThreshHigh){anomCount++;defectCells.push({gx,gy,type:"anomaly",x:sx+gx*cellW,y:sy+gy*cellH,w:cellW,h:cellH,severity:diff});}
    else if(diff>diffThreshLow){anomCount+=0.3;defectCells.push({gx,gy,type:"mark",x:sx+gx*cellW,y:sy+gy*cellH,w:cellW,h:cellH,severity:diff});}
    if(c.variance>gVar*varMultiplier && c.variance>varFloor){scratchCount++;defectCells.push({gx,gy,type:"scratch",x:sx+gx*cellW,y:sy+gy*cellH,w:cellW,h:cellH,severity:c.variance});}
  }
  
  const anomRate = totalCells>0 ? anomCount/totalCells : 0;
  const scratchRate = totalCells>0 ? scratchCount/totalCells : 0;
  
  // Classify as DINGS — card backs with high-design artwork get very high thresholds
  // Holo fronts get elevated thresholds. Standard fronts get base thresholds.
  if (isAllMetallic) {
    // Ancient Mew / all-metallic embossed: entire surface has high variance by design.
    // Thresholds raised substantially — only flag actual damage, not metallic shimmer.
    if (anomRate > 0.40 || scratchRate > 0.32) {
      dings.push({ side:sideLabel, type:"SURFACE / PLAY WEAR", location:sideLabel, severity:3, desc:"Surface play wear / multiple defects" });
    } else if (anomRate > 0.28 || scratchRate > 0.22) {
      dings.push({ side:sideLabel, type:"SURFACE / PLAY WEAR", location:sideLabel, severity:2, desc:"Surface wear visible" });
    } else if (anomRate > 0.20 || scratchRate > 0.14) {
      dings.push({ side:sideLabel, type:"SURFACE / PLAY WEAR", location:sideLabel, severity:1, desc:"Minor surface imperfection" });
    }
  } else if (isHighDesignBack) {
    // Card back: pokeball/logo design creates massive false variance. Only flag obvious damage.
    if (anomRate > 0.45 || scratchRate > 0.35) {
      dings.push({ side:sideLabel, type:"SURFACE / PLAY WEAR", location:sideLabel, severity:3, desc:"Surface play wear / multiple defects" });
    } else if (anomRate > 0.30 || scratchRate > 0.22) {
      dings.push({ side:sideLabel, type:"SURFACE / PLAY WEAR", location:sideLabel, severity:2, desc:"Surface wear visible" });
    } else if (anomRate > 0.20 || scratchRate > 0.14) {
      dings.push({ side:sideLabel, type:"SURFACE / PLAY WEAR", location:sideLabel, severity:1, desc:"Minor surface imperfection" });
    }
  } else if (isHolo) {
    // Holo front: only flag severe/obvious damage
    if (anomRate > 0.35 || scratchRate > 0.28) {
      dings.push({ side:sideLabel, type:"SURFACE / PLAY WEAR", location:sideLabel, severity:3, desc:"Surface play wear / multiple defects" });
    } else if (anomRate > 0.22 || scratchRate > 0.18) {
      dings.push({ side:sideLabel, type:"SURFACE / PLAY WEAR", location:sideLabel, severity:2, desc:"Surface wear visible" });
    } else if (anomRate > 0.14 || scratchRate > 0.10) {
      dings.push({ side:sideLabel, type:"SURFACE / PLAY WEAR", location:sideLabel, severity:1, desc:"Minor surface imperfection" });
    }
  } else {
    // Standard non-holo front
    if (anomRate > 0.15 || scratchRate > 0.12) {
      dings.push({ side:sideLabel, type:"SURFACE / PLAY WEAR", location:sideLabel, severity:3, desc:"Surface play wear / multiple defects" });
    } else if (anomRate > 0.08 || scratchRate > 0.06) {
      dings.push({ side:sideLabel, type:"SURFACE / PLAY WEAR", location:sideLabel, severity:2, desc:"Surface wear visible" });
    } else if (anomRate > 0.04 || scratchRate > 0.03) {
      dings.push({ side:sideLabel, type:"SURFACE / PLAY WEAR", location:sideLabel, severity:1, desc:"Minor surface imperfection" });
    }
  }
  
  // Cluster defect cells for crop previews
  const regions = clusterDefects(defectCells, cellW);
  
  return { dings, anomalyRate:Math.round(anomRate*10000)/100, scratchRate:Math.round(scratchRate*10000)/100, defectRegions:regions, isHolo };
}

function clusterDefects(cells,cW){
  if(!cells.length)return[];
  const used=new Set(), regions=[], sorted=[...cells].sort((a,b)=>b.severity-a.severity);
  for(const c of sorted){
    const k=`${c.gx},${c.gy}`; if(used.has(k))continue; used.add(k);
    let mX=c.x,mY=c.y,MX=c.x+c.w,MY=c.y+c.h,ms=c.severity;
    const ty=new Set([c.type]);
    for(const o of sorted){const ok=`${o.gx},${o.gy}`;if(!used.has(ok)&&Math.abs(o.gx-c.gx)<=2&&Math.abs(o.gy-c.gy)<=2){
      used.add(ok);mX=Math.min(mX,o.x);mY=Math.min(mY,o.y);MX=Math.max(MX,o.x+o.w);MY=Math.max(MY,o.y+o.h);ms=Math.max(ms,o.severity);ty.add(o.type);
    }}
    const pad=cW*3;
    regions.push({x:mX-pad,y:mY-pad,w:(MX-mX)+pad*2,h:(MY-mY)+pad*2,severity:ms,types:[...ty]});
    if(regions.length>=6)break;
  }
  return regions;
}

/* ═══════════════════════════════════════════
   LOCAL TRAINING DATA — localStorage
   Saves/loads manual boundary corrections
   keyed by card type (holo/std)
   ═══════════════════════════════════════════ */
function saveTrainingBounds(result, outer, inner) {
  try {
    const isHolo = result.surface?.isHolo;
    const key = `tg-bounds-${isHolo ? 'holo' : 'std'}`;
    const existing = JSON.parse(localStorage.getItem(key) || 'null');
    const imgW = result.imgW || 1400, imgH = result.imgH || 1960;
    const cW = outer.right - outer.left, cH = outer.bottom - outer.top;
    const entry = {
      outerPct: { left: outer.left/imgW, right: outer.right/imgW, top: outer.top/imgH, bottom: outer.bottom/imgH },
      innerOffPct: {
        left: (inner.left - outer.left)/cW, right: (outer.right - inner.right)/cW,
        top: (inner.top - outer.top)/cH, bottom: (outer.bottom - inner.bottom)/cH,
      },
      count: (existing?.count || 0) + 1,
    };
    // Weighted average with existing data
    if (existing?.count > 0) {
      const w1 = Math.min(existing.count, 5), w2 = 1, tot = w1 + w2;
      for (const k of ['left','right','top','bottom']) {
        entry.outerPct[k] = (existing.outerPct[k]*w1 + entry.outerPct[k]) / tot;
        entry.innerOffPct[k] = (existing.innerOffPct[k]*w1 + entry.innerOffPct[k]) / tot;
      }
    }
    localStorage.setItem(key, JSON.stringify(entry));
    return true;
  } catch(e) { return false; }
}

function loadTrainingBounds(isHolo, imgW, imgH) {
  try {
    const key = `tg-bounds-${isHolo ? 'holo' : 'std'}`;
    const saved = JSON.parse(localStorage.getItem(key) || 'null');
    if (!saved || saved.count < 2) return null;
    const cW = (saved.outerPct.right - saved.outerPct.left) * imgW;
    const cH = (saved.outerPct.bottom - saved.outerPct.top) * imgH;
    return {
      outer: {
        left: Math.round(saved.outerPct.left * imgW), right: Math.round(saved.outerPct.right * imgW),
        top: Math.round(saved.outerPct.top * imgH), bottom: Math.round(saved.outerPct.bottom * imgH),
      },
      inner: {
        left: Math.round(saved.outerPct.left*imgW + saved.innerOffPct.left*cW),
        right: Math.round(saved.outerPct.right*imgW - saved.innerOffPct.right*cW),
        top: Math.round(saved.outerPct.top*imgH + saved.innerOffPct.top*cH),
        bottom: Math.round(saved.outerPct.bottom*imgH - saved.innerOffPct.bottom*cH),
      },
    };
  } catch(e) { return null; }
}


/* ═══════════════════════════════════════════
   DINGS-BASED SCORING ENGINE v2
   Calibrated against 507 real TAG-graded cards.

   Key insights from TAG data:
   - Centering stored as DEVIATION from 50% (not ratio)
   - 5+ defects = max grade 8.5 (THE DEFECT CLIFF)
   - Corner/edge defects are grade-killers for 10s
   - Surface defects more tolerated (PRISTINE allows 3)
   ═══════════════════════════════════════════ */
function computeGrade(frontDings, backDings, frontCenter, backCenter, companyId = DEFAULT_GRADING_COMPANY, imageQuality = null) {
  const allDings = [...frontDings, ...backDings];
  const totalDings = allDings.length;
  const company = GRADING_COMPANIES[companyId] || GRADING_COMPANIES[DEFAULT_GRADING_COMPANY];

  // ═══════════════════════════════════════════
  // STEP 1: Count defects by type AND side (8 categories for TAG)
  // ═══════════════════════════════════════════
  let cornerDefects = 0, edgeDefects = 0, surfaceDefects = 0;
  let frontCornerDefects = 0, backCornerDefects = 0;
  let frontEdgeDefects = 0, backEdgeDefects = 0;
  let frontSurfaceDefects = 0, backSurfaceDefects = 0;

  for (const ding of frontDings) {
    if (ding.type === "CENTERING") continue;
    if (ding.type.includes("CORNER")) { frontCornerDefects++; cornerDefects++; }
    else if (ding.type.includes("EDGE")) { frontEdgeDefects++; edgeDefects++; }
    else if (ding.type.includes("SURFACE")) { frontSurfaceDefects++; surfaceDefects++; }
  }
  for (const ding of backDings) {
    if (ding.type === "CENTERING") continue;
    if (ding.type.includes("CORNER")) { backCornerDefects++; cornerDefects++; }
    else if (ding.type.includes("EDGE")) { backEdgeDefects++; edgeDefects++; }
    else if (ding.type.includes("SURFACE")) { backSurfaceDefects++; surfaceDefects++; }
  }
  const conditionDefects = cornerDefects + edgeDefects + surfaceDefects;

  // ═══════════════════════════════════════════
  // STEP 2: Calculate centering deviation from 50/50
  // TAG stores centering as DEVIATION (e.g., 5 = 45/55 or 55/45)
  // ═══════════════════════════════════════════
  const frontLRDev = ratioToDeviation(Math.min(frontCenter.lrRatio, 100 - frontCenter.lrRatio));
  const frontTBDev = ratioToDeviation(Math.min(frontCenter.tbRatio, 100 - frontCenter.tbRatio));
  const backLRDev = ratioToDeviation(Math.min(backCenter.lrRatio, 100 - backCenter.lrRatio));
  const backTBDev = ratioToDeviation(Math.min(backCenter.tbRatio, 100 - backCenter.tbRatio));

  // Max deviation for each side (worst axis)
  const frontMaxDev = Math.max(frontLRDev, frontTBDev);
  const backMaxDev = Math.max(backLRDev, backTBDev);

  // ═══════════════════════════════════════════
  // STEP 3: Determine grade caps from TAG calibration
  // ═══════════════════════════════════════════

  // Cap by centering (using real TAG thresholds)
  const centeringGradeCap = getCenteringGrade(frontMaxDev, backMaxDev);

  // Cap by defect counts (using real TAG data)
  const defectGradeCap = getMaxGradeByDefects(conditionDefects, cornerDefects, edgeDefects, surfaceDefects);

  // Apply the 5-defect cliff
  let defectCountCap = 10.0;
  if (conditionDefects >= 6) defectCountCap = 8.5;
  else if (conditionDefects >= 5) defectCountCap = 8.5;
  else if (conditionDefects >= 4) defectCountCap = 9.0;
  else if (conditionDefects >= 3) defectCountCap = 10.0; // Surface defects allowed
  else if (conditionDefects >= 1) defectCountCap = 9.9;

  // Final grade cap = minimum of all caps
  const maxAllowedGrade = Math.min(centeringGradeCap, defectGradeCap, defectCountCap);

  // ═══════════════════════════════════════════
  // STEP 4: Calculate component scores (for subgrades display)
  // ═══════════════════════════════════════════

  // Front centering score (0-125 scale for TAG display)
  let frontCenterScore;
  if (frontMaxDev <= 2.0) frontCenterScore = 125;
  else if (frontMaxDev <= 5.0) frontCenterScore = 120;
  else if (frontMaxDev <= 10.0) frontCenterScore = 115;
  else if (frontMaxDev <= 15.0) frontCenterScore = 105;
  else if (frontMaxDev <= 20.0) frontCenterScore = 95;
  else if (frontMaxDev <= 25.0) frontCenterScore = 85;
  else if (frontMaxDev <= 30.0) frontCenterScore = 75;
  else frontCenterScore = Math.max(50, 75 - (frontMaxDev - 30));

  // Back centering score
  let backCenterScore;
  if (backMaxDev <= 4.0) backCenterScore = 125;
  else if (backMaxDev <= 8.0) backCenterScore = 120;
  else if (backMaxDev <= 12.0) backCenterScore = 115;
  else if (backMaxDev <= 16.0) backCenterScore = 105;
  else if (backMaxDev <= 20.0) backCenterScore = 95;
  else backCenterScore = Math.max(50, 95 - (backMaxDev - 20));

  // Calculate 8 individual subgrade scores (0-125 scale for TAG)
  // Each category starts at 125 (perfect) and deducts based on defects
  // Front defects are penalized ~30% more heavily than back defects

  // Corners: 20 points per front defect, 15 per back defect
  const frontCornersScore = Math.max(80, 125 - frontCornerDefects * 20);
  const backCornersScore = Math.max(80, 125 - backCornerDefects * 15);

  // Edges: 18 points per front defect, 14 per back defect
  const frontEdgesScore = Math.max(80, 125 - frontEdgeDefects * 18);
  const backEdgesScore = Math.max(80, 125 - backEdgeDefects * 14);

  // Surface: 12 points per front defect, 10 per back defect (more tolerant)
  const frontSurfaceScore = Math.max(80, 125 - frontSurfaceDefects * 12);
  const backSurfaceScore = Math.max(80, 125 - backSurfaceDefects * 10);

  // Combined condition score for overall raw score calculation
  const conditionScore = Math.round(
    (frontCornersScore + backCornersScore +
     frontEdgesScore + backEdgesScore +
     frontSurfaceScore + backSurfaceScore) / 6
  ) * 3; // Scale to ~375 max for backwards compatibility

  // ═══════════════════════════════════════════
  // STEP 5: Calculate final score
  // ═══════════════════════════════════════════

  // Total raw score (out of 1000)
  // Centering = 250 (front 125 + back 125)
  // Condition = 750 (corners, edges, surface front+back)
  const centeringTotal = frontCenterScore + backCenterScore;
  const rawScore = Math.round(centeringTotal + conditionScore * 2); // Scale condition to ~750 range
  let finalScore = Math.max(100, Math.min(1000, rawScore));

  // Apply grade caps - cap score BELOW the next grade's threshold
  // TAG Grade thresholds (no 9.9 - Pristine and Gem Mint are both grade 10):
  // 10: 950-1000 (Pristine 990+, Gem Mint 950-989), 9: 900-949, etc.
  const gradeThresholds = {
    10.0: 950, 9.0: 900, 8.5: 850, 8.0: 800,
    7.5: 750, 7.0: 700, 6.5: 650, 6.0: 600, 5.5: 550,
    5.0: 500, 4.5: 450, 4.0: 400, 3.5: 350, 3.0: 300,
    2.5: 250, 2.0: 200, 1.5: 150, 1.0: 100,
  };
  // Find the threshold for the NEXT grade up (the one we can't reach)
  // TAG actual grades (no 9.9 - both Pristine and Gem Mint are grade 10)
  const gradeOrder = [10.0, 9.0, 8.5, 8.0, 7.5, 7.0, 6.5, 6.0, 5.5, 5.0, 4.5, 4.0, 3.5, 3.0, 2.5, 2.0, 1.5, 1.0];
  const capIndex = gradeOrder.indexOf(maxAllowedGrade);
  const nextGradeUp = capIndex > 0 ? gradeOrder[capIndex - 1] : null;
  const maxAllowedScore = nextGradeUp ? gradeThresholds[nextGradeUp] - 1 : 1000;

  // Cap the score at max allowed (e.g., if capped at 9, max score is 949)
  if (finalScore > maxAllowedScore) {
    finalScore = maxAllowedScore;
  }

  // Calculate weighted score for display
  let weightedScore = 0;
  for (const ding of allDings) {
    const sw = ding.side === "FRONT" ? 1.5 : 1.0;
    weightedScore += (ding.severity || 1) * sw;
  }

  // ═══════════════════════════════════════════
  // STEP 6: Calculate confidence
  // ═══════════════════════════════════════════
  const confidenceResult = calculateSoftwareConfidence(imageQuality, {
    manualCentering: false, // Will be set by caller if applicable
  });

  return {
    rawScore: finalScore,
    grade: getGrade(finalScore, companyId),
    companyId,
    companyName: company.name,
    totalDings,
    weightedScore: Math.round(weightedScore * 10) / 10,
    allDings,
    subgrades: {
      frontCentering: frontCenterScore,
      backCentering: backCenterScore,
      frontCorners: frontCornersScore,
      backCorners: backCornersScore,
      frontEdges: frontEdgesScore,
      backEdges: backEdgesScore,
      frontSurface: frontSurfaceScore,
      backSurface: backSurfaceScore,
    },
    defectCounts: {
      total: conditionDefects,
      corner: cornerDefects,
      edge: edgeDefects,
      surface: surfaceDefects,
    },
    centeringDeviation: {
      front: { lr: frontLRDev, tb: frontTBDev, max: frontMaxDev },
      back: { lr: backLRDev, tb: backTBDev, max: backMaxDev },
    },
    gradeCaps: {
      centering: centeringGradeCap,
      defects: defectGradeCap,
      defectCount: defectCountCap,
      final: maxAllowedGrade,
    },
    confidence: confidenceResult.confidence,
    confidenceFactors: confidenceResult.factors,
  };
}

/* ═══════════════════════════════════════════
   SURFACE VISION MAPS (genMaps imported from lib/image-utils.js)
   ═══════════════════════════════════════════ */

function cropReg(src,rg,mx=300){return new Promise(r=>{const img=new Image();img.crossOrigin="anonymous";img.onload=()=>{const cx=Math.max(0,rg.x),cy=Math.max(0,rg.y),cw=Math.min(rg.w,img.width-cx),ch=Math.min(rg.h,img.height-cy);if(cw<=0||ch<=0){r(null);return;}const sc=Math.min(mx/cw,mx/ch,4);const c=document.createElement("canvas");c.width=~~(cw*sc);c.height=~~(ch*sc);const ctx=c.getContext("2d");ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality="high";ctx.drawImage(img,cx,cy,cw,ch,0,0,c.width,c.height);r(c.toDataURL("image/png"));};img.src=src;});}

/* ═══════════════════════════════════════════
   FULL ANALYSIS PIPELINE
   ═══════════════════════════════════════════ */
async function analyzeCardFull(src, side, overrideBounds = null, overrideCentering = null) {
  const { w, h, data, canvas } = await loadImg(src);
  const d = data.data;
  const scaledImgUrl = canvas.toDataURL('image/jpeg', 0.92);
  const bounds = overrideBounds
    ? { ...overrideBounds, cardW: overrideBounds.right - overrideBounds.left, cardH: overrideBounds.bottom - overrideBounds.top }
    : findBounds(d, w, h);
  const centering = overrideCentering || analyzeCentering(d, w, h, bounds);
  const centerDings = checkCenteringDings(centering, side);
  const corners = detectCornerDings(d, w, h, bounds, side);
  const edges = detectEdgeDings(d, w, h, bounds, side);
  const surface = detectSurfaceDings(d, w, h, bounds, side);

  const allDings = [...centerDings, ...corners.dings, ...edges.dings, ...surface.dings];

  return {
    centering,
    centerDings,
    corners,
    edges,
    surface,
    allDings,
    bounds,
    imgW: w,
    imgH: h,
    scaledImgUrl,
  };
}


/* ═══════════════════════════════════════════
   UI COMPONENTS
   ═══════════════════════════════════════════ */

function ScoreRing({score,size=80,strokeWidth=4,label}){
  const g=getGrade(score),pct=Math.min(100,Math.max(0,(score-300)/7)),r=(size-strokeWidth)/2,c=Math.PI*2*r;
  return(<div style={{textAlign:"center"}}><svg width={size} height={size} style={{transform:"rotate(-90deg)"}}><circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#1a1c22" strokeWidth={strokeWidth}/><circle cx={size/2} cy={size/2} r={r} fill="none" stroke={g.color} strokeWidth={strokeWidth} strokeDasharray={c} strokeDashoffset={c-(pct/100)*c} strokeLinecap="round" style={{transition:"stroke-dashoffset .8s ease"}}/></svg>
    <div style={{marginTop:-size+12,position:"relative",height:size-16,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center"}}><div style={{fontFamily:mono,fontSize:size>70?22:14,fontWeight:700,color:g.color}}>{score}</div>{label&&<div style={{fontFamily:mono,fontSize:8,color:"#555",textTransform:"uppercase",letterSpacing:".1em",marginTop:2}}>{label}</div>}</div></div>);
}

/* Grade Display - Shows grade number prominently with company-specific formatting */
function GradeDisplay({ gradeResult, companyId, isPro = true }) {
  const company = GRADING_COMPANIES[companyId];
  const grade = gradeResult.grade;
  const score = gradeResult.rawScore;

  // Format grade number (handle 9.5, 10, etc.)
  const gradeNum = grade.grade;
  const gradeStr = Number.isInteger(gradeNum) ? gradeNum.toString() : gradeNum.toFixed(1);

  return (
    <div style={{textAlign:"center",padding:"24px 16px 20px",background:grade.bg,borderRadius:12,border:`1px solid ${grade.color}22`,marginBottom:16}}>
      {/* Main Grade Number */}
      <div style={{marginBottom:8}}>
        <span style={{fontFamily:mono,fontSize:56,fontWeight:800,color:grade.color,lineHeight:1}}>{gradeStr}</span>
      </div>

      {/* Grade Label */}
      <div style={{fontFamily:mono,fontSize:18,fontWeight:700,color:grade.color,marginBottom:8}}>{grade.label}</div>

      {/* Company Name */}
      <div style={{fontFamily:mono,fontSize:11,color:"#666",textTransform:"uppercase",letterSpacing:".1em"}}>{company?.name || 'TAG'} Estimate</div>

