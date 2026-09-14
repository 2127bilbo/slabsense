/**
 * ============================================================================
 * SLABSENSE SOFTWARE DETECTORS — detectors.js
 * ============================================================================
 * Pure pixel-level detectors for the client-side Software Grade path.
 * Moved verbatim from src/App.jsx on 2026-09-14 (see
 * docs/superpowers/specs/2026-09-14-software-grade-harness-design.md).
 *
 * Every function takes raw RGBA pixel data (ImageData.data), width, height.
 * No DOM, no fetch, no React. Runs in the browser and under node (scripts/harness).
 *
 * RULES: any threshold change here changes production grades. Run
 *   node src/lib/detectors.test.js   and   npm run harness
 * and record the delta before committing.
 * ============================================================================
 */
import { LUM } from './image-utils.js';

export const PX=(d,w,x,y)=>{const i=(y*w+x)*4;return[d[i],d[i+1],d[i+2]];};

/* ═══════════════════════════════════════════
   CARD DETECTION v2.6 — Grid-variance method
   Works on white, black, orange, any background,
   close-up or pulled back.
   ═══════════════════════════════════════════ */
export function findBounds(d, w, h) {
  const GX = 32, GY = 32;
  const cellW = Math.floor(w / GX), cellH = Math.floor(h / GY);
  if (cellW < 2 || cellH < 2) return { left:0, right:w-1, top:0, bottom:h-1, cardW:w-1, cardH:h-1 };

  // Step 1: Variance per grid cell
  const vg = [];
  let maxV = 0;
  for (let gy = 0; gy < GY; gy++) {
    vg[gy] = [];
    for (let gx = 0; gx < GX; gx++) {
      let s=0, sq=0, n=0;
      const x0=gx*cellW, y0=gy*cellH;
      const step = Math.max(1, Math.floor(Math.min(cellW,cellH)/5));
      for (let y=y0; y<y0+cellH && y<h; y+=step)
        for (let x=x0; x<x0+cellW && x<w; x+=step)
          { const v=LUM(...PX(d,w,x,y)); s+=v; sq+=v*v; n++; }
      const variance = n>0 ? sq/n-(s/n)**2 : 0;
      vg[gy][gx] = variance;
      if (variance > maxV) maxV = variance;
    }
  }

  // Step 2: Threshold = 12% of peak variance
  // Paper/solid background = variance ~5-30, card artwork = 200-2000+
  // At 12% of peak this reliably separates them regardless of background color
  const floor = Math.max(30, maxV * 0.12);

  // Step 3: Bounding box of high-variance cells
  let minGX=GX, maxGX=-1, minGY=GY, maxGY=-1, count=0;
  for (let gy=0; gy<GY; gy++)
    for (let gx=0; gx<GX; gx++)
      if (vg[gy][gx] > floor) {
        if (gx < minGX) minGX=gx; if (gx > maxGX) maxGX=gx;
        if (gy < minGY) minGY=gy; if (gy > maxGY) maxGY=gy;
        count++;
      }

  if (count < 6 || maxGX < minGX || maxGY < minGY) {
    // Nothing found — fall through to edge scan
    return edgeScanFallback(d, w, h);
  }

  // Step 4: Pixel-precise edges — scan inward from grid boundary
  // to find exact high-contrast transition
  let left   = minGX * cellW;
  let right  = Math.min(w-1, (maxGX+1) * cellW);
  let top    = minGY * cellH;
  let bottom = Math.min(h-1, (maxGY+1) * cellH);

  const scanLimit = Math.min(cellW*2, 60);
  const sampleN = 16;

  const edgeLum = (axis, pos, lo, hi) => {
    let s=0;
    for (let i=0; i<sampleN; i++) {
      const f = lo + (hi-lo)*(i+0.5)/sampleN;
      const px = axis==='x' ? Math.round(pos) : Math.round(f);
      const py = axis==='x' ? Math.round(f)   : Math.round(pos);
      s += LUM(...PX(d,w,Math.max(0,Math.min(w-1,px)),Math.max(0,Math.min(h-1,py))));
    }
    return s/sampleN;
  };

  // Find exact left edge
  let bestContrast=0, bestPos=left;
  for (let i=0; i<scanLimit; i++) {
    const x=left+i; if(x>=right-10) break;
    const c=Math.abs(edgeLum('x',x,top,bottom)-edgeLum('x',x-1,top,bottom));
    if(c>bestContrast){bestContrast=c;bestPos=x;}
  }
  left=bestPos;

  bestContrast=0; bestPos=right;
  for (let i=0; i<scanLimit; i++) {
    const x=right-i; if(x<=left+10) break;
    const c=Math.abs(edgeLum('x',x,top,bottom)-edgeLum('x',x+1,top,bottom));
    if(c>bestContrast){bestContrast=c;bestPos=x;}
  }
  right=bestPos;

  bestContrast=0; bestPos=top;
  for (let i=0; i<scanLimit; i++) {
    const y=top+i; if(y>=bottom-10) break;
    const c=Math.abs(edgeLum('y',y,left,right)-edgeLum('y',y-1,left,right));
    if(c>bestContrast){bestContrast=c;bestPos=y;}
  }
  top=bestPos;

  bestContrast=0; bestPos=bottom;
  for (let i=0; i<scanLimit; i++) {
    const y=bottom-i; if(y<=top+10) break;
    const c=Math.abs(edgeLum('y',y,left,right)-edgeLum('y',y+1,left,right));
    if(c>bestContrast){bestContrast=c;bestPos=y;}
  }
  bottom=bestPos;

  const cardW=right-left, cardH=bottom-top;

  // Sanity: must be at least 8% of image, aspect ratio roughly card-shaped
  if (cardW > w*0.08 && cardH > h*0.08) {
    return { left, right, top, bottom, cardW, cardH };
  }

  return edgeScanFallback(d, w, h);
}

export function edgeScanFallback(d, w, h) {
  const thresholds = [15, 25, 40, 60];
  let best=null, bestArea=0;
  for (const t of thresholds) {
    let l=0, r=w-1, tp=0, b=h-1;
    const rowVar=(y,x1,x2)=>{let s=0,q=0,n=0;const st=Math.max(1,~~((x2-x1)/60));for(let x=x1;x<x2;x+=st){const v=LUM(...PX(d,w,Math.min(w-1,x),y));s+=v;q+=v*v;n++;}return n>0?q/n-(s/n)**2:0;};
    const colVar=(x,y1,y2)=>{let s=0,q=0,n=0;const st=Math.max(1,~~((y2-y1)/60));for(let y=y1;y<y2;y+=st){const v=LUM(...PX(d,w,x,Math.min(h-1,y)));s+=v;q+=v*v;n++;}return n>0?q/n-(s/n)**2:0;};
    for(let x=0;x<w*.4;x++) if(colVar(x,~~(h*.1),~~(h*.9))>t){l=x;break;}
    for(let x=w-1;x>w*.6;x--) if(colVar(x,~~(h*.1),~~(h*.9))>t){r=x;break;}
    for(let y=0;y<h*.4;y++) if(rowVar(y,~~(w*.1),~~(w*.9))>t){tp=y;break;}
    for(let y=h-1;y>h*.6;y--) if(rowVar(y,~~(w*.1),~~(w*.9))>t){b=y;break;}
    const area=(r-l)*(b-tp);
    if(area>bestArea&&(r-l)>w*0.15&&(b-tp)>h*0.15){bestArea=area;best={left:l,right:r,top:tp,bottom:b,cardW:r-l,cardH:b-tp};}
  }
  return best||{left:0,right:w-1,top:0,bottom:h-1,cardW:w-1,cardH:h-1};
}

/* ═══════════════════════════════════════════
   CENTERING — MODE 2 HELPER
   Scans inward from physical card edge looking
   for where color diverges from edge strip.
   Used when Mode 1 (variance spike) fails on
   full-art/holo cards with no visible border.
   ═══════════════════════════════════════════ */
export function scanBorderFromEdge(d, w, h, dir, edgeCoord, along0, along1) {
  const sampleN = 20;
  const maxScan = Math.round(Math.abs(along1-along0) * 0.18);
  
  const sample = (depth) => {
    let s = 0;
    for(let i=0; i<sampleN; i++){
      const f = along0 + (along1-along0)*(i+0.5)/sampleN;
      let px, py;
      if(dir==='L')      { px=edgeCoord+depth; py=Math.round(f); }
      else if(dir==='R') { px=edgeCoord-depth; py=Math.round(f); }
      else if(dir==='T') { px=Math.round(f);   py=edgeCoord+depth; }
      else               { px=Math.round(f);   py=edgeCoord-depth; }
      s += LUM(...PX(d,w,Math.max(0,Math.min(w-1,px)),Math.max(0,Math.min(h-1,py))));
    }
    return s/sampleN;
  };
  
  // Average the outermost 3 pixel rows for a stable edge-color baseline
  const edgeLum = (sample(0)+sample(1)+sample(2))/3;
  // Scan inward — first depth where luminance diverges meaningfully = border edge
  const tolerance = 20;
  for(let dep=3; dep<maxScan; dep++){
    if(Math.abs(sample(dep)-edgeLum) > tolerance) return dep;
  }
  return 0; // no clear border found — truly edge-to-edge artwork
}

/* ═══════════════════════════════════════════
   CENTERING ANALYSIS (improved)
   ═══════════════════════════════════════════ */
export function analyzeCentering(d,w,h,bn){
  const{left:cl,right:cr,top:ct,bottom:cb,cardW:cW,cardH:cH}=bn;
  const thresholds = [50, 100, 150, 200, 300, 500];
  const validResults = [];
  
  for (const vT of thresholds) {
    let bL=0,bR=0,bT=0,bB=0;
    const colVar=(x,y1,y2)=>{let s=0,q=0,n=0;const st=Math.max(1,~~((y2-y1)/60));for(let y=y1;y<y2;y+=st){const v=LUM(...PX(d,w,x,Math.min(h-1,y)));s+=v;q+=v*v;n++;}return n>0?q/n-(s/n)**2:0;};
    const rowVar=(y,x1,x2)=>{let s=0,q=0,n=0;const st=Math.max(1,~~((x2-x1)/60));for(let x=x1;x<x2;x+=st){const v=LUM(...PX(d,w,Math.min(w-1,x),y));s+=v;q+=v*v;n++;}return n>0?q/n-(s/n)**2:0;};
    
    // Start at 1% not 3% — thin modern card borders can be missed if we skip too far in
    for(let x=cl+~~(cW*.01);x<cl+~~(cW*.25);x++) if(colVar(x,ct+~~(cH*.1),ct+~~(cH*.9))>vT){bL=x-cl;break;}
    for(let x=cr-~~(cW*.01);x>cr-~~(cW*.25);x--) if(colVar(x,ct+~~(cH*.1),ct+~~(cH*.9))>vT){bR=cr-x;break;}
    for(let y=ct+~~(cH*.01);y<ct+~~(cH*.25);y++) if(rowVar(y,cl+~~(cW*.1),cl+~~(cW*.9))>vT){bT=y-ct;break;}
    for(let y=cb-~~(cH*.01);y>cb-~~(cH*.25);y--) if(rowVar(y,cl+~~(cW*.1),cl+~~(cW*.9))>vT){bB=cb-y;break;}
    
    if (bL > 0 && bR > 0 && bT > 0 && bB > 0) {
      const lrTotal = bL+bR, tbTotal = bT+bB;
      const lrPct = lrTotal/cW, tbPct = tbTotal/cH;
      // Lowered min from 3% to 1% — thin borders on modern cards can be < 3% total
      if (lrPct > 0.01 && lrPct < 0.35 && tbPct > 0.01 && tbPct < 0.35) {
        validResults.push({ borderL:bL, borderR:bR, borderT:bT, borderB:bB });
      }
    }
  }
  
  // Median of all valid threshold results.
  // The old "most symmetric" selector was backwards — it preferred readings where
  // bL≈bR, actively biasing toward 50/50 even when the card IS off-center.
  // Median is neutral: it picks the middle detected position across thresholds.
  let bestResult = null;
  if (validResults.length > 0) {
    const med = arr => { const s=[...arr].sort((a,b)=>a-b); const m=~~(s.length/2); return s.length%2?s[m]:(s[m-1]+s[m])/2; };
    bestResult = {
      borderL: med(validResults.map(r=>r.borderL)),
      borderR: med(validResults.map(r=>r.borderR)),
      borderT: med(validResults.map(r=>r.borderT)),
      borderB: med(validResults.map(r=>r.borderB)),
    };
  }
  
  // Mode 2: Mode 1 found nothing (full-art/holo card with no artwork border to detect).
  // Scan inward from each physical card edge — many foil cards have a thin uniform-color
  // border strip (the holo foil margin) that diverges from the inner artwork color.
  if(!bestResult) {
    const bL = scanBorderFromEdge(d,w,h,'L',cl,ct+~~(cH*.1),cb-~~(cH*.1));
    const bR = scanBorderFromEdge(d,w,h,'R',cr,ct+~~(cH*.1),cb-~~(cH*.1));
    const bT = scanBorderFromEdge(d,w,h,'T',ct,cl+~~(cW*.1),cr-~~(cW*.1));
    const bB = scanBorderFromEdge(d,w,h,'B',cb,cl+~~(cW*.1),cr-~~(cW*.1));
    const lrTot=bL+bR, tbTot=bT+bB;
    const lrPct=lrTot/cW, tbPct=tbTot/cH;
    // Only accept if all four borders are found and within plausible range (1–18% of dim)
    if(bL>0&&bR>0&&bT>0&&bB>0 && lrPct>0.01&&lrPct<0.18 && tbPct>0.01&&tbPct<0.18){
      bestResult = { borderL:bL, borderR:bR, borderT:bT, borderB:bB };
    }
  }
  
  if (!bestResult) bestResult = { borderL: ~~(cW*0.05), borderR: ~~(cW*0.05), borderT: ~~(cH*0.07), borderB: ~~(cH*0.07) };
  
  const {borderL:bL,borderR:bR,borderT:bT,borderB:bB} = bestResult;
  const tLR=bL+bR, tTB=bT+bB;
  const lrRatio = Math.round((tLR>0?(bL/tLR)*100:50)*10)/10;
  const tbRatio = Math.round((tTB>0?(bT/tTB)*100:50)*10)/10;
  
  return { borderL:bL, borderR:bR, borderT:bT, borderB:bB, lrRatio, tbRatio };
}

/* ═══════════════════════════════════════════
   DINGS-BASED DETECTION ENGINE
   ═══════════════════════════════════════════
   Each module detects defects and classifies
   them as TAG DINGS types with side + location
   ═══════════════════════════════════════════ */

// Centering DINGS check — TAG threshold: 55/45 front, 65/35 back for Gem Mint
export function checkCenteringDings(centering, side) {
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
export function detectCornerDings(d, w, h, bn, side) {
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
    // FIX: For BACK sides with dark borders, don't use colorDevRatio.
    // Reason: Card backs have physically rounded corners that expose white card stock at the tips.
    // This is NORMAL - not damage. colorDevRatio falsely triggers on this natural white.
    // Only use whiteRatio (neutral white pixels l>215, r≈g≈b) which indicates actual wear/whitening.
    const isBack = side === "back";
    const effectiveWear   = (isDarkBorder && !isBack) ? Math.max(whiteRatio, colorDevRatio*0.7) : whiteRatio;
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
  const isBackSide = side === "back";

  for (const c of cornerData) {
    // Conservative detection: ALWAYS require both wear AND sharpness issues
    // High W% alone is NOT enough - card backs often have light-colored designs
    // Real wear shows: high white ratio + LOW sharpness (corner is soft/rounded)
    // False positive shows: high white ratio + HIGH sharpness (corner is still sharp)
    //
    // BACK-SIDE FIX: Card backs have physically rounded corners that naturally expose
    // ~20-35% white card stock at the tips. This is NOT damage. Raise thresholds for backs
    // to require significantly more white (40%+) to indicate actual corner wear.
    const wearThresh  = isBackSide ? 0.40 : (isHolo ? 0.22 : 0.15);
    const sharpThresh = isBackSide ? 3    : (isHolo ? 3    : 5);     // Require softer corners for backs

    // ALWAYS require both conditions - no bypass for "severe wear"
    // because card design (especially backs) can have 50%+ white naturally
    const hasWear = !c.isUniformBright
      && c.effectiveWear > wearThresh
      && c.avgSharp < sharpThresh;

    if(hasWear){
      // Severity thresholds adjusted for back sides (higher baseline due to natural rounded corners)
      const severeThresh = isBackSide ? 0.55 : 0.25;
      const moderateThresh = isBackSide ? 0.45 : 0.15;
      dings.push({
        side: sideLabel,
        type: "CORNER WEAR",
        location: `${sideLabel} / ${c.name}`,
        severity: c.effectiveWear > severeThresh ? 3 : c.effectiveWear > moderateThresh ? 2 : 1,
        desc: c.effectiveWear > severeThresh ? "Significant corner wear" : c.effectiveWear > moderateThresh ? "Corner wear visible" : "Light corner wear",
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
export function detectEdgeDings(d, w, h, bn, side) {
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
export function detectSurfaceDings(d, w, h, bn, side) {
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

export function clusterDefects(cells,cW){
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
   PIXEL-LEVEL PIPELINE (what analyzeCardFull does after loadImg)
   ═══════════════════════════════════════════ */
export function analyzePixels({ data, w, h }, side, overrideBounds = null, overrideCentering = null) {
  const d = data;
  const bounds = overrideBounds
    ? { ...overrideBounds, cardW: overrideBounds.right - overrideBounds.left, cardH: overrideBounds.bottom - overrideBounds.top }
    : findBounds(d, w, h);
  const centering = overrideCentering || analyzeCentering(d, w, h, bounds);
  const centerDings = checkCenteringDings(centering, side);
  const corners = detectCornerDings(d, w, h, bounds, side);
  const edges = detectEdgeDings(d, w, h, bounds, side);
  const surface = detectSurfaceDings(d, w, h, bounds, side);
  const allDings = [...centerDings, ...corners.dings, ...edges.dings, ...surface.dings];
  return { centering, centerDings, corners, edges, surface, allDings, bounds, imgW: w, imgH: h };
}
