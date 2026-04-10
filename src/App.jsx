import { useState, useRef, useCallback, useEffect } from "react";
import { GRADING_COMPANIES, getGradeFromScore, getCompanyOptions, DEFAULT_GRADING_COMPANY } from "./utils/gradingScales.js";
import { useAuth } from "./hooks/useAuth.js";
import { AuthModal } from "./components/Auth/AuthModal.jsx";
import { UserMenu } from "./components/Auth/UserMenu.jsx";
import { CollectionView } from "./components/Collection/CollectionView.jsx";
import { ExportCard } from "./components/Export/ExportCard.jsx";
import { ProfileSettings } from "./components/Settings/ProfileSettings.jsx";
import { saveScan } from "./services/scans.js";
import { checkBackendHealth, analyzeCardWithBackend, detectAndCropBothCards, analyzeCardWithVision, claudeGradingAnalysis, samCardCropping } from "./services/api.js";
import { CardViewer3D } from "./components/CardViewer/CardViewer3D.jsx";

/* ═══════════════════════════════════════════
   SLABSENSE v0.1.0-beta
   Multi-Company Card Pre-Grading Analysis Tool

   Supports: TAG, PSA, BGS, CGC, SGC

   DISCLAIMER: SlabSense is NOT affiliated with any grading company.
   All grades are ESTIMATES only. See docs/DISCLAIMERS.md for full details.
   ═══════════════════════════════════════════ */

// Legacy GRADES array for backwards compatibility (uses selected company's scale)
const getGradesForCompany = (companyId) => {
  const company = GRADING_COMPANIES[companyId];
  if (!company) return GRADING_COMPANIES[DEFAULT_GRADING_COMPANY].grades;
  return company.grades;
};

// Default to TAG for initial load
const GRADES = getGradesForCompany(DEFAULT_GRADING_COMPANY);
const getGrade = (s, companyId = DEFAULT_GRADING_COMPANY) => {
  const grades = getGradesForCompany(companyId);
  for (const g of grades) if (s >= g.min && s <= g.max) return g;
  return grades[grades.length - 1];
};
const mono="'JetBrains Mono','SF Mono',monospace", sans="'Inter',-apple-system,sans-serif";
const PERFECT_CENTER = { lrRatio: 50, tbRatio: 50 }; // For "ignore centering" mode

/* ═══════════════════════════════════════════
   IMAGE UTILITIES
   ═══════════════════════════════════════════ */
function loadImg(src,mx=1400){return new Promise(r=>{const img=new Image();img.crossOrigin="anonymous";img.onload=()=>{let w=img.width,h=img.height;if(Math.max(w,h)>mx){const s=mx/Math.max(w,h);w=Math.round(w*s);h=Math.round(h*s);}const c=document.createElement("canvas");c.width=w;c.height=h;const ctx=c.getContext("2d",{willReadFrequently:true});ctx.drawImage(img,0,0,w,h);r({canvas:c,ctx,w,h,data:ctx.getImageData(0,0,w,h)});};img.src=src;});}
const PX=(d,w,x,y)=>{const i=(y*w+x)*4;return[d[i],d[i+1],d[i+2]];};
const LUM=(r,g,b)=>.299*r+.587*g+.114*b;

/* ═══════════════════════════════════════════
   PHOTO QUALITY DETECTION
   Checks for blur, lighting, and card fill
   ═══════════════════════════════════════════ */
async function analyzePhotoQuality(imageSrc) {
  const { w, h, data } = await loadImg(imageSrc, 800); // Smaller for speed
  const d = data.data;
  const warnings = [];
  let score = 100;

  // 1. BLUR DETECTION using Laplacian variance
  // Higher variance = sharper image
  let laplacianSum = 0;
  let laplacianSq = 0;
  let laplacianN = 0;
  const step = 2; // Sample every 2nd pixel for speed

  for (let y = 1; y < h - 1; y += step) {
    for (let x = 1; x < w - 1; x += step) {
      // Laplacian kernel: center * 4 - neighbors
      const center = LUM(...PX(d, w, x, y));
      const top = LUM(...PX(d, w, x, y - 1));
      const bottom = LUM(...PX(d, w, x, y + 1));
      const left = LUM(...PX(d, w, x - 1, y));
      const right = LUM(...PX(d, w, x + 1, y));
      const laplacian = Math.abs(4 * center - top - bottom - left - right);
      laplacianSum += laplacian;
      laplacianSq += laplacian * laplacian;
      laplacianN++;
    }
  }

  const laplacianMean = laplacianSum / laplacianN;
  const laplacianVariance = (laplacianSq / laplacianN) - (laplacianMean * laplacianMean);

  // Thresholds determined empirically
  if (laplacianVariance < 100) {
    warnings.push({ type: 'blur', severity: 'high', message: 'Image is very blurry - retake recommended' });
    score -= 40;
  } else if (laplacianVariance < 300) {
    warnings.push({ type: 'blur', severity: 'medium', message: 'Image may be slightly blurry' });
    score -= 15;
  }

  // 2. LIGHTING CHECK - look for over/under exposure
  let darkPixels = 0, brightPixels = 0, totalPixels = 0;
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      const lum = LUM(...PX(d, w, x, y));
      totalPixels++;
      if (lum < 30) darkPixels++;
      if (lum > 240) brightPixels++;
    }
  }

  const darkRatio = darkPixels / totalPixels;
  const brightRatio = brightPixels / totalPixels;

  if (darkRatio > 0.4) {
    warnings.push({ type: 'dark', severity: 'high', message: 'Image is too dark - add more light' });
    score -= 25;
  } else if (darkRatio > 0.25) {
    warnings.push({ type: 'dark', severity: 'medium', message: 'Image could use more light' });
    score -= 10;
  }

  if (brightRatio > 0.3) {
    warnings.push({ type: 'bright', severity: 'high', message: 'Image is overexposed - reduce light or glare' });
    score -= 25;
  } else if (brightRatio > 0.15) {
    warnings.push({ type: 'bright', severity: 'medium', message: 'Some areas may be overexposed' });
    score -= 10;
  }

  // 3. CONTRAST CHECK - low contrast makes edge detection harder
  let minLum = 255, maxLum = 0;
  for (let y = Math.floor(h * 0.2); y < h * 0.8; y += step * 2) {
    for (let x = Math.floor(w * 0.2); x < w * 0.8; x += step * 2) {
      const lum = LUM(...PX(d, w, x, y));
      if (lum < minLum) minLum = lum;
      if (lum > maxLum) maxLum = lum;
    }
  }

  const contrast = maxLum - minLum;
  if (contrast < 50) {
    warnings.push({ type: 'contrast', severity: 'medium', message: 'Low contrast - may affect detection accuracy' });
    score -= 10;
  }

  return {
    score: Math.max(0, score),
    warnings,
    metrics: {
      sharpness: Math.round(laplacianVariance),
      darkRatio: Math.round(darkRatio * 100),
      brightRatio: Math.round(brightRatio * 100),
      contrast: Math.round(contrast),
    },
    isAcceptable: score >= 60,
  };
}

/* ═══════════════════════════════════════════
   CARD DETECTION v2.6 — Grid-variance method
   Works on white, black, orange, any background,
   close-up or pulled back.
   ═══════════════════════════════════════════ */
function findBounds(d, w, h) {
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

function edgeScanFallback(d, w, h) {
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
function scanBorderFromEdge(d, w, h, dir, edgeCoord, along0, along1) {
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
function analyzeCentering(d,w,h,bn){
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
   DINGS-BASED SCORING ENGINE
   Calibrated against real TAG DIG reports:
   Grade 10: 0 DINGS
   Grade 9:  1 DING (centering only)
   Grade 8:  4 DINGS (all back, no surface)
   Grade 7:  5 DINGS (front surface + ink + edge, back corners)
   Grade 6:  4 DINGS (front surface, back corner/edge)
   Grade 5:  6 DINGS (front+back surface, back corners+edge)
   ═══════════════════════════════════════════ */
function computeGrade(frontDings, backDings, frontCenter, backCenter, companyId = DEFAULT_GRADING_COMPANY) {
  const allDings = [...frontDings, ...backDings];
  const totalDings = allDings.length;
  const company = GRADING_COMPANIES[companyId] || GRADING_COMPANIES[DEFAULT_GRADING_COMPANY];
  const thresholds = company.centeringThresholds;

  // ═══════════════════════════════════════════
  // MULTI-COMPANY SCORING
  // Key insight: "A card will not grade significantly higher
  // than its lowest subgrade score"
  // ═══════════════════════════════════════════

  // Step 1: Calculate centering subgrade scores using company thresholds
  const fMaxOff = Math.max(Math.max(frontCenter.lrRatio,100-frontCenter.lrRatio), Math.max(frontCenter.tbRatio,100-frontCenter.tbRatio));
  const bMaxOff = Math.max(Math.max(backCenter.lrRatio,100-backCenter.lrRatio), Math.max(backCenter.tbRatio,100-backCenter.tbRatio));

  // Front centering → subgrade score (using company thresholds)
  const frontThresh = thresholds.front;
  let frontCenterScore;
  if (frontThresh[10]?.pristine && fMaxOff <= frontThresh[10].pristine) frontCenterScore = 995;
  else if (frontThresh[10]?.gem && fMaxOff <= frontThresh[10].gem) frontCenterScore = 970;
  else if (typeof frontThresh[10] === 'number' && fMaxOff <= frontThresh[10]) frontCenterScore = 970;
  else if (frontThresh[9.5] && fMaxOff <= frontThresh[9.5]) frontCenterScore = 945;
  else if (frontThresh[9] && fMaxOff <= frontThresh[9]) frontCenterScore = 920;
  else if (frontThresh[8.5] && fMaxOff <= frontThresh[8.5]) frontCenterScore = 875;
  else if (frontThresh[8] && fMaxOff <= frontThresh[8]) frontCenterScore = 825;
  else if (frontThresh[7.5] && fMaxOff <= frontThresh[7.5]) frontCenterScore = 775;
  else if (frontThresh[7] && fMaxOff <= frontThresh[7]) frontCenterScore = 725;
  else if (frontThresh[6.5] && fMaxOff <= frontThresh[6.5]) frontCenterScore = 675;
  else if (frontThresh[6] && fMaxOff <= frontThresh[6]) frontCenterScore = 625;
  else if (frontThresh[5.5] && fMaxOff <= frontThresh[5.5]) frontCenterScore = 575;
  else if (frontThresh[5] && fMaxOff <= frontThresh[5]) frontCenterScore = 525;
  else if (frontThresh[4] && fMaxOff <= frontThresh[4]) frontCenterScore = 425;
  else frontCenterScore = 350;

  // Back centering → subgrade score (using company thresholds, more lenient)
  const backThresh = thresholds.back;
  let backCenterScore;
  if (backThresh[10]?.pristine && bMaxOff <= backThresh[10].pristine) backCenterScore = 995;
  else if (backThresh[10]?.gem && bMaxOff <= backThresh[10].gem) backCenterScore = 970;
  else if (typeof backThresh[10] === 'number' && bMaxOff <= backThresh[10]) backCenterScore = 970;
  else if (backThresh[9.5] && bMaxOff <= backThresh[9.5]) backCenterScore = 945;
  else if (backThresh[9] && bMaxOff <= backThresh[9]) backCenterScore = 920;
  else if (backThresh[8] && bMaxOff <= backThresh[8]) backCenterScore = 825;
  else backCenterScore = 700;

  // Step 2: Calculate condition subgrade (corners, edges, surface)
  let conditionScore = 990;

  for (const ding of allDings) {
    if (ding.type === "CENTERING") continue;

    const sideMultiplier = ding.side === "FRONT" ? 1.5 : 1.0;
    let deduction = 0;

    if (ding.type.includes("SURFACE")) {
      deduction = 40 + (ding.severity || 1) * 15;
    } else if (ding.type.includes("CORNER")) {
      deduction = 25 + (ding.severity || 1) * 10;
    } else if (ding.type.includes("EDGE")) {
      deduction = 20 + (ding.severity || 1) * 8;
    } else {
      deduction = 20;
    }

    conditionScore -= deduction * sideMultiplier;
  }
  conditionScore = Math.max(300, conditionScore);

  // Step 3: Final score = approximately the LOWEST subgrade
  const minSubgrade = Math.min(frontCenterScore, backCenterScore, conditionScore);
  const avgSubgrade = (frontCenterScore + backCenterScore + conditionScore) / 3;
  const rawScore = Math.round(minSubgrade * 0.75 + avgSubgrade * 0.25);
  const finalScore = Math.max(300, Math.min(1000, rawScore));

  // Calculate weighted score for display
  let weightedScore = 0;
  for (const ding of allDings) {
    const sw = ding.side === "FRONT" ? 1.5 : 1.0;
    weightedScore += (ding.severity || 1) * sw;
  }

  return {
    rawScore: finalScore,
    grade: getGrade(finalScore, companyId),
    companyId,
    companyName: company.name,
    totalDings,
    weightedScore: Math.round(weightedScore * 10) / 10,
    allDings,
    subgrades: { frontCenter: frontCenterScore, backCenter: backCenterScore, condition: conditionScore },
  };
}

/* ═══════════════════════════════════════════
   SURFACE VISION MAPS
   ═══════════════════════════════════════════ */
function genMaps(src){return new Promise(async r=>{
  const{canvas,w,h,data}=await loadImg(src,1400);const d=data.data;
  const mk=()=>{const c=document.createElement("canvas");c.width=w;c.height=h;return c;};
  const L=(Y,X)=>LUM(d[(Y*w+X)*4],d[(Y*w+X)*4+1],d[(Y*w+X)*4+2]);
  
  // Emboss
  const eC=mk(),eX=eC.getContext("2d"),eD=eX.createImageData(w,h),e=eD.data;
  for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){const i=(y*w+x)*4,v=Math.min(255,Math.max(0,128+(L(y+1,x+1)-L(y-1,x-1))*2));e[i]=e[i+1]=e[i+2]=v;e[i+3]=255;}
  eX.putImageData(eD,0,0);
  
  // High-pass
  const hC=mk(),hX=hC.getContext("2d"),hD=hX.createImageData(w,h),hp=hD.data;
  for(let y=8;y<h-8;y++)for(let x=8;x<w-8;x++){const i=(y*w+x)*4;let ls=0,ln=0;for(let dy=-8;dy<=8;dy+=2)for(let dx=-8;dx<=8;dx+=2){ls+=L(y+dy,x+dx);ln++;}const v=Math.min(255,Math.max(0,128+(L(y,x)-ls/ln)*3));hp[i]=hp[i+1]=hp[i+2]=v;hp[i+3]=255;}
  hX.putImageData(hD,0,0);
  
  // Sobel edges
  const dC=mk(),dX=dC.getContext("2d"),dD=dX.createImageData(w,h),ed=dD.data;
  for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){const i=(y*w+x)*4;const gx=-L(y-1,x-1)+L(y-1,x+1)-2*L(y,x-1)+2*L(y,x+1)-L(y+1,x-1)+L(y+1,x+1);const gy=-L(y-1,x-1)-2*L(y-1,x)-L(y-1,x+1)+L(y+1,x-1)+2*L(y+1,x)+L(y+1,x+1);const m=Math.min(255,Math.sqrt(gx*gx+gy*gy));ed[i]=~~(m*.2);ed[i+1]=~~(m*.9);ed[i+2]=~~m;ed[i+3]=255;}
  dX.putImageData(dD,0,0);
  
  r({original:canvas.toDataURL(),emboss:eC.toDataURL(),highpass:hC.toDataURL(),edges:dC.toDataURL(),width:w,height:h});
});}

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

      {/* TAG-specific: Show 1000-point score */}
      {companyId === 'tag' && isPro && (
        <div style={{marginTop:12,padding:"8px 16px",background:"rgba(0,0,0,.3)",borderRadius:20,display:"inline-block"}}>
          <span style={{fontFamily:mono,fontSize:11,color:"#888"}}>TAG Score: </span>
          <span style={{fontFamily:mono,fontSize:13,fontWeight:700,color:grade.color}}>{score}</span>
          <span style={{fontFamily:mono,fontSize:10,color:"#555"}}> / 1000</span>
        </div>
      )}

      {/* BGS/CGC: Show subgrades if Pro */}
      {(companyId === 'bgs' || companyId === 'cgc') && isPro && gradeResult.subgrades && (
        <div style={{marginTop:16,display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,padding:"0 8px"}}>
          {[
            {label:"Center",score:gradeResult.subgrades.frontCenter},
            {label:"Corners",score:gradeResult.subgrades.condition},
            {label:"Edges",score:gradeResult.subgrades.condition},
            {label:"Surface",score:gradeResult.subgrades.condition}
          ].map((sub,i)=>{
            const subGrade = getGrade(sub.score, companyId);
            return (
              <div key={i} style={{textAlign:"center"}}>
                <div style={{fontFamily:mono,fontSize:14,fontWeight:700,color:subGrade.color}}>{subGrade.grade}</div>
                <div style={{fontFamily:mono,fontSize:8,color:"#555",textTransform:"uppercase"}}>{sub.label}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* Simple Grade Display for Free Users - Just grade number and label */
function GradeDisplaySimple({ gradeResult, companyId }) {
  const company = GRADING_COMPANIES[companyId];
  const grade = gradeResult.grade;

  const gradeNum = grade.grade;
  const gradeStr = Number.isInteger(gradeNum) ? gradeNum.toString() : gradeNum.toFixed(1);

  return (
    <div style={{textAlign:"center",padding:"32px 16px",background:grade.bg,borderRadius:12,border:`1px solid ${grade.color}22`,marginBottom:16}}>
      {/* Company Logo/Name */}
      <div style={{fontFamily:mono,fontSize:12,color:"#666",textTransform:"uppercase",letterSpacing:".15em",marginBottom:16}}>{company?.name || 'TAG'}</div>

      {/* Main Grade Number */}
      <div style={{marginBottom:8}}>
        <span style={{fontFamily:mono,fontSize:72,fontWeight:800,color:grade.color,lineHeight:1}}>{gradeStr}</span>
      </div>

      {/* Grade Label */}
      <div style={{fontFamily:mono,fontSize:20,fontWeight:600,color:grade.color}}>{grade.label}</div>

      {/* Upgrade prompt */}
      <div style={{marginTop:24,padding:"12px 20px",background:"rgba(99,102,241,.1)",borderRadius:8,border:"1px solid rgba(99,102,241,.2)"}}>
        <div style={{fontFamily:sans,fontSize:12,color:"#8b8fff"}}>Upgrade to Pro for full report</div>
        <div style={{fontFamily:sans,fontSize:10,color:"#666",marginTop:4}}>DINGS breakdown • Subgrades • Centering ratios</div>
      </div>
    </div>
  );
}

function SubScoreBar({label,score,icon}){const g=getGrade(score),pct=Math.min(100,Math.max(0,(score-300)/7));return(<div style={{marginBottom:12}}><div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}><div style={{display:"flex",alignItems:"center",gap:6}}><span style={{fontSize:13}}>{icon}</span><span style={{fontFamily:mono,fontSize:11,color:"#999",textTransform:"uppercase",letterSpacing:".08em"}}>{label}</span></div><span style={{fontFamily:mono,fontSize:13,fontWeight:600,color:g.color}}>{score}</span></div><div style={{height:4,background:"#1a1c22",borderRadius:2,overflow:"hidden"}}><div style={{height:"100%",width:`${pct}%`,background:g.color,borderRadius:2,transition:"width .6s ease"}}/></div></div>);}

/* ═══════════════════════════════════════════
   HOME TAB - Portfolio & Dashboard
   ═══════════════════════════════════════════ */
function HomeTab({ auth, onOpenCollection, onStartScan, collectionStats }) {
  const isPro = auth?.isPro;

  // Mock data for portfolio (will be replaced with real data)
  const mockPortfolio = {
    totalValue: 2847.50,
    changePercent: 12.3,
    cardCount: collectionStats?.count || 0,
    avgGrade: 8.7,
    topCards: [
      { name: "Charizard VMAX", grade: 9.5, value: 450 },
      { name: "Pikachu VMAX", grade: 10, value: 320 },
      { name: "Umbreon V Alt Art", grade: 9, value: 280 },
    ],
    recentActivity: [
      { action: "Graded", card: "Mew VMAX", grade: 9, time: "2 hours ago" },
      { action: "Graded", card: "Rayquaza V", grade: 8.5, time: "1 day ago" },
    ]
  };

  return (
    <div style={{padding:16,flex:1,overflowY:"auto"}}>
      {/* Welcome Header */}
      <div style={{marginBottom:20}}>
        <div style={{fontSize:22,fontWeight:700,color:"#fff",marginBottom:4}}>
          {auth?.isAuthenticated ? `Hey, ${auth.profile?.display_name || 'Collector'}` : 'Welcome to SlabSense'}
        </div>
        <div style={{fontFamily:mono,fontSize:11,color:"#666"}}>
          {auth?.isAuthenticated ? 'Your card grading dashboard' : 'Sign in to track your collection'}
        </div>
      </div>

      {/* Quick Action - Scan Card */}
      <button
        onClick={onStartScan}
        style={{
          width:"100%",
          padding:"16px 20px",
          marginBottom:16,
          borderRadius:12,
          border:"none",
          background:"linear-gradient(135deg,#6366f1,#8b5cf6)",
          color:"#fff",
          fontFamily:sans,
          fontSize:14,
          fontWeight:600,
          cursor:"pointer",
          display:"flex",
          alignItems:"center",
          justifyContent:"center",
          gap:10,
        }}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/>
          <circle cx="12" cy="13" r="4"/>
        </svg>
        Grade a Card
      </button>

      {/* Portfolio Summary - Pro Only */}
      {auth?.isAuthenticated && (
        <div style={{
          padding:16,
          background:"#0d0f13",
          borderRadius:12,
          border:"1px solid #1a1c22",
          marginBottom:16,
        }}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
            <span style={{fontFamily:mono,fontSize:10,color:"#888",textTransform:"uppercase",letterSpacing:".1em"}}>Portfolio Value</span>
            {!isPro && <span style={{fontFamily:mono,fontSize:8,color:"#6366f1",background:"rgba(99,102,241,.1)",padding:"2px 6px",borderRadius:4}}>PRO</span>}
          </div>

          {isPro ? (
            <>
              <div style={{display:"flex",alignItems:"baseline",gap:8,marginBottom:4}}>
                <span style={{fontSize:28,fontWeight:800,color:"#fff"}}>${mockPortfolio.totalValue.toLocaleString()}</span>
                <span style={{fontFamily:mono,fontSize:12,color:"#00ff88"}}>+{mockPortfolio.changePercent}%</span>
              </div>
              <div style={{fontFamily:mono,fontSize:10,color:"#555"}}>Based on recent eBay sales</div>
            </>
          ) : (
            <div style={{padding:"12px 0"}}>
              <div style={{fontSize:24,fontWeight:800,color:"#333",filter:"blur(6px)",userSelect:"none"}}>$2,847.50</div>
              <div style={{fontFamily:sans,fontSize:11,color:"#666",marginTop:8}}>Upgrade to Pro to see portfolio value</div>
            </div>
          )}
        </div>
      )}

      {/* Stats Grid */}
      {auth?.isAuthenticated && (
        <div style={{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:12,marginBottom:16}}>
          <div style={{padding:14,background:"#0d0f13",borderRadius:10,border:"1px solid #1a1c22"}}>
            <div style={{fontFamily:mono,fontSize:9,color:"#888",textTransform:"uppercase",marginBottom:6}}>Cards Graded</div>
            <div style={{fontSize:24,fontWeight:700,color:"#fff"}}>{mockPortfolio.cardCount}</div>
          </div>
          <div style={{padding:14,background:"#0d0f13",borderRadius:10,border:"1px solid #1a1c22"}}>
            <div style={{fontFamily:mono,fontSize:9,color:"#888",textTransform:"uppercase",marginBottom:6}}>Avg Grade</div>
            <div style={{fontSize:24,fontWeight:700,color:"#00ff88"}}>{mockPortfolio.avgGrade}</div>
          </div>
        </div>
      )}

      {/* Top Cards - Pro Only */}
      {auth?.isAuthenticated && isPro && (
        <div style={{
          padding:16,
          background:"#0d0f13",
          borderRadius:12,
          border:"1px solid #1a1c22",
          marginBottom:16,
        }}>
          <div style={{fontFamily:mono,fontSize:10,color:"#888",textTransform:"uppercase",letterSpacing:".1em",marginBottom:12}}>Top Cards by Value</div>
          {mockPortfolio.topCards.map((card, i) => (
            <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 0",borderTop:i>0?"1px solid #1a1c22":"none"}}>
              <div>
                <div style={{fontSize:13,color:"#ddd"}}>{card.name}</div>
                <div style={{fontFamily:mono,fontSize:10,color:"#00ff88"}}>Grade {card.grade}</div>
              </div>
              <div style={{fontFamily:mono,fontSize:14,fontWeight:600,color:"#fff"}}>${card.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Recent Activity */}
      {auth?.isAuthenticated && (
        <div style={{
          padding:16,
          background:"#0d0f13",
          borderRadius:12,
          border:"1px solid #1a1c22",
          marginBottom:16,
        }}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
            <span style={{fontFamily:mono,fontSize:10,color:"#888",textTransform:"uppercase",letterSpacing:".1em"}}>Recent Activity</span>
            <button onClick={onOpenCollection} style={{fontFamily:mono,fontSize:9,color:"#6366f1",background:"transparent",border:"none",cursor:"pointer"}}>View All →</button>
          </div>
          {mockPortfolio.recentActivity.length > 0 ? (
            mockPortfolio.recentActivity.map((item, i) => (
              <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 0",borderTop:i>0?"1px solid #1a1c22":"none"}}>
                <div>
                  <div style={{fontSize:12,color:"#ddd"}}>{item.card}</div>
                  <div style={{fontFamily:mono,fontSize:9,color:"#666"}}>{item.action} • Grade {item.grade}</div>
                </div>
                <div style={{fontFamily:mono,fontSize:9,color:"#555"}}>{item.time}</div>
              </div>
            ))
          ) : (
            <div style={{textAlign:"center",padding:"20px 0",color:"#555",fontSize:12}}>
              No cards graded yet. Start scanning!
            </div>
          )}
        </div>
      )}

      {/* Not Signed In */}
      {!auth?.isAuthenticated && (
        <div style={{
          padding:24,
          background:"#0d0f13",
          borderRadius:12,
          border:"1px solid #1a1c22",
          textAlign:"center",
        }}>
          <div style={{fontSize:32,marginBottom:12}}>📊</div>
          <div style={{fontSize:14,fontWeight:600,color:"#ddd",marginBottom:8}}>Track Your Collection</div>
          <div style={{fontSize:12,color:"#666",marginBottom:16,lineHeight:1.5}}>
            Sign in to save your graded cards, track portfolio value, and see your grading history.
          </div>
        </div>
      )}
    </div>
  );
}

/* Photo Quality Warning Badge */
function PhotoQualityBadge({ quality }) {
  if (!quality || quality.warnings.length === 0) return null;

  const hasHighSeverity = quality.warnings.some(w => w.severity === 'high');
  const color = hasHighSeverity ? '#ff6633' : '#ffaa00';

  return (
    <div style={{
      marginTop:8,
      padding:"8px 12px",
      background:`${color}15`,
      border:`1px solid ${color}33`,
      borderRadius:8,
    }}>
      <div style={{fontFamily:mono,fontSize:9,color,textTransform:"uppercase",marginBottom:4}}>
        {hasHighSeverity ? '⚠ Quality Issues' : '⚡ Tips'}
      </div>
      {quality.warnings.map((w, i) => (
        <div key={i} style={{fontFamily:sans,fontSize:11,color:"#999",marginTop:i>0?4:0}}>
          • {w.message}
        </div>
      ))}
    </div>
  );
}

function SurfaceVision({maps,label}){
  const[mode,setMode]=useState("original"),[blend,setBlend]=useState(0);
  const modes=[{id:"original",l:"Normal"},{id:"emboss",l:"Emboss"},{id:"highpass",l:"Hi-Pass"},{id:"edges",l:"Edges"}];
  if(!maps)return null;
  return(<div style={{marginBottom:16,background:"#0d0f13",borderRadius:10,border:"1px solid #1a1c22",overflow:"hidden"}}>
    <div style={{padding:"10px 12px 6px"}}><span style={{fontFamily:mono,fontSize:11,color:"#888",textTransform:"uppercase"}}>{label} — Card Vision</span></div>
    <div style={{position:"relative",width:"100%",aspectRatio:`${maps.width}/${maps.height}`,background:"#0a0a0a"}}><img src={maps.original} style={{position:"absolute",inset:0,width:"100%",height:"100%",objectFit:"contain"}}/>{mode!=="original"&&<img src={maps[mode]} style={{position:"absolute",inset:0,width:"100%",height:"100%",objectFit:"contain",opacity:blend/100,mixBlendMode:mode==="edges"?"screen":"normal"}}/>}</div>
    <div style={{display:"flex",gap:4,padding:"8px 8px 4px"}}>{modes.map(m=>(<button key={m.id} onClick={()=>{setMode(m.id);if(m.id!=="original"&&blend===0)setBlend(80);}} style={{flex:1,padding:"5px 3px",borderRadius:5,background:mode===m.id?"rgba(0,255,136,.1)":"transparent",border:`1px solid ${mode===m.id?"#00ff8833":"#1a1c22"}`,color:mode===m.id?"#00ff88":"#555",fontFamily:mono,fontSize:9,textTransform:"uppercase",cursor:"pointer"}}>{m.l}</button>))}</div>
    {mode!=="original"&&<div style={{padding:"4px 12px 10px"}}><div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}><span style={{fontFamily:mono,fontSize:8,color:"#444"}}>TRANSPARENCY</span><span style={{fontFamily:mono,fontSize:10,color:"#00ff88"}}>{blend}%</span></div><input type="range" min="0" max="100" value={blend} onChange={e=>setBlend(+e.target.value)} style={{width:"100%",accentColor:"#00ff88"}}/></div>}
  </div>);
}

/* Measurement Annotations Overlay — shows detected bounds on card photo */
function MeasurementOverlay({ image, result, label }) {
  const [showAnnotations, setShowAnnotations] = useState(false);
  const [imgDims, setImgDims] = useState(null);
  
  useEffect(() => {
    if (!image) return;
    const img = new Image();
    img.onload = () => setImgDims({ w: img.width, h: img.height });
    img.src = image;
  }, [image]);
  
  if (!result || !image) return null;
  const bn = result.bounds;
  const c = result.centering;
  
  return (
    <div style={{marginBottom:12,background:"#0d0f13",borderRadius:10,border:"1px solid #1a1c22",overflow:"hidden"}}>
      <div style={{padding:"10px 12px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <span style={{fontFamily:mono,fontSize:11,color:"#888",textTransform:"uppercase"}}>{label}</span>
        <button onClick={()=>setShowAnnotations(!showAnnotations)} style={{padding:"4px 10px",borderRadius:4,background:showAnnotations?"rgba(0,255,136,.1)":"transparent",border:`1px solid ${showAnnotations?"#00ff8833":"#1a1c22"}`,color:showAnnotations?"#00ff88":"#555",fontFamily:mono,fontSize:9,cursor:"pointer"}}>
          {showAnnotations?"HIDE":"SHOW"} ANNOTATIONS
        </button>
      </div>
      <div style={{position:"relative",width:"100%",aspectRatio:"2.5/3.5",background:"#0a0a0a"}}>
        <img src={image} style={{width:"100%",height:"100%",objectFit:"contain"}}/>
        {showAnnotations && imgDims && (
          <svg style={{position:"absolute",inset:0,width:"100%",height:"100%",pointerEvents:"none"}} viewBox={`0 0 ${imgDims.w} ${imgDims.h}`} preserveAspectRatio="xMidYMid meet">
            {/* Card boundary rectangle */}
            <rect x={bn.left} y={bn.top} width={bn.cardW} height={bn.cardH} fill="none" stroke="#00ff88" strokeWidth="3" strokeDasharray="12,6"/>
            
            {/* Border measurements */}
            {/* Left border */}
            <line x1={0} y1={bn.top+bn.cardH/2} x2={bn.left} y2={bn.top+bn.cardH/2} stroke="#ff9944" strokeWidth="2"/>
            <text x={bn.left/2} y={bn.top+bn.cardH/2-8} fill="#ff9944" fontSize={Math.max(14,bn.cardW*0.03)} fontFamily={mono} textAnchor="middle">{c.borderL}px</text>
            
            {/* Right border */}
            <line x1={bn.left+bn.cardW} y1={bn.top+bn.cardH/2} x2={imgDims.w} y2={bn.top+bn.cardH/2} stroke="#ff9944" strokeWidth="2"/>
            <text x={bn.left+bn.cardW+(imgDims.w-bn.left-bn.cardW)/2} y={bn.top+bn.cardH/2-8} fill="#ff9944" fontSize={Math.max(14,bn.cardW*0.03)} fontFamily={mono} textAnchor="middle">{c.borderR}px</text>
            
            {/* Top border */}
            <line x1={bn.left+bn.cardW/2} y1={0} x2={bn.left+bn.cardW/2} y2={bn.top} stroke="#ff9944" strokeWidth="2"/>
            <text x={bn.left+bn.cardW/2+10} y={bn.top/2+5} fill="#ff9944" fontSize={Math.max(14,bn.cardW*0.03)} fontFamily={mono}>{c.borderT}px</text>
            
            {/* Bottom border */}
            <line x1={bn.left+bn.cardW/2} y1={bn.top+bn.cardH} x2={bn.left+bn.cardW/2} y2={imgDims.h} stroke="#ff9944" strokeWidth="2"/>
            <text x={bn.left+bn.cardW/2+10} y={bn.top+bn.cardH+(imgDims.h-bn.top-bn.cardH)/2+5} fill="#ff9944" fontSize={Math.max(14,bn.cardW*0.03)} fontFamily={mono}>{c.borderB}px</text>
            
            {/* Center crosshair */}
            <line x1={bn.left+bn.cardW/2-20} y1={bn.top+bn.cardH/2} x2={bn.left+bn.cardW/2+20} y2={bn.top+bn.cardH/2} stroke="#0088ff66" strokeWidth="2"/>
            <line x1={bn.left+bn.cardW/2} y1={bn.top+bn.cardH/2-20} x2={bn.left+bn.cardW/2} y2={bn.top+bn.cardH/2+20} stroke="#0088ff66" strokeWidth="2"/>
            
            {/* Centering ratio text */}
            <rect x={bn.left+bn.cardW/2-60} y={bn.top+10} width={120} height={22} rx={4} fill="rgba(0,0,0,.7)"/>
            <text x={bn.left+bn.cardW/2} y={bn.top+25} fill="#00ff88" fontSize={Math.max(12,bn.cardW*0.025)} fontFamily={mono} textAnchor="middle">
              {c.lrRatio}/{Math.round((100-c.lrRatio)*10)/10} LR · {c.tbRatio}/{Math.round((100-c.tbRatio)*10)/10} TB
            </text>
            
            {/* Corner scan regions */}
            {result.corners.details.map(corner => (
              <rect key={corner.name} x={corner.cropX} y={corner.cropY} width={corner.cropSize} height={corner.cropSize}
                fill="none" stroke={corner.hasDing?"#ff6633":"#00ff8844"} strokeWidth="2" strokeDasharray={corner.hasDing?"none":"4,4"}/>
            ))}
          </svg>
        )}
      </div>
    </div>
  );
}

/* Grade Confidence Calculator */
function calcConfidence(gradeResult, frontResult, backResult) {
  let confidence = 100;
  const reasons = [];
  
  // Check if centering defaulted to 50/50 (detection may have failed)
  const fc = frontResult.centering;
  if (fc.lrRatio === 50 && fc.tbRatio === 50) { confidence -= 25; reasons.push("Front centering defaulted to 50/50 — border detection may have failed"); }
  const bc = backResult.centering;
  if (bc.lrRatio === 50 && bc.tbRatio === 50) { confidence -= 15; reasons.push("Back centering defaulted to 50/50"); }
  
  // Check if score is near a grade boundary (within 20 points)
  const score = gradeResult.rawScore;
  const boundaries = [990, 950, 900, 850, 800, 700, 600, 500];
  for (const b of boundaries) {
    if (Math.abs(score - b) < 20) { confidence -= 15; reasons.push(`Score ${score} is near the ${b}-point grade boundary`); break; }
  }
  
  // Check if holo was detected (surface analysis less reliable)
  if (frontResult.surface.isHolo) { confidence -= 10; reasons.push("Holo card detected — surface analysis adjusted"); }
  if (backResult.surface.isHolo) { confidence -= 5; reasons.push("Back has high variance pattern"); }
  
  // Check surface anomaly rates (high rates even below DING threshold suggest noise)
  if (frontResult.surface.anomalyRate > 10 && frontResult.surface.dings.length === 0) {
    confidence -= 10; reasons.push("Front surface has elevated noise but no DING flagged");
  }
  
  const level = confidence >= 80 ? "HIGH" : confidence >= 55 ? "MEDIUM" : "LOW";
  const color = confidence >= 80 ? "#00ff88" : confidence >= 55 ? "#ffcc00" : "#ff6633";
  
  return { confidence: Math.max(0, confidence), level, color, reasons };
}

/* Next Grade Comparison */
function getNextGradeInfo(gradeResult) {
  const score = gradeResult.rawScore;
  const dings = gradeResult.allDings;
  const totalDings = gradeResult.totalDings;
  const frontDings = dings.filter(d => d.side === "FRONT");
  const backDings = dings.filter(d => d.side === "BACK");
  const surfaceDings = dings.filter(d => d.type.includes("SURFACE"));
  const cornerDings = dings.filter(d => d.type.includes("CORNER"));
  const edgeDings = dings.filter(d => d.type.includes("EDGE"));
  const centerDings = dings.filter(d => d.type === "CENTERING");
  
  const tips = [];
  
  if (score >= 950) {
    tips.push({ text: "Card is in Gem Mint range — potential Pristine if centering is near-perfect", color: "#00ff88" });
  } else if (score >= 900) {
    if (centerDings.length > 0) tips.push({ text: "Centering is the only DING — improve framing won't fix the card, but it's close to a 10", color: "#66dd44" });
    if (totalDings <= 1) tips.push({ text: "Only 1 DING away from Gem Mint 10", color: "#66dd44" });
  } else if (score >= 800) {
    if (frontDings.length > 0) tips.push({ text: `${frontDings.length} front DING${frontDings.length>1?"s":""} — front defects weigh 2x. A clean front pushes toward Mint 9`, color: "#ffcc00" });
    if (surfaceDings.length > 0) tips.push({ text: "Surface wear is the heaviest grade penalty — this is what separates 8 from 9+", color: "#ffcc00" });
    tips.push({ text: `${totalDings} total DINGS — reducing to 0-1 needed for Mint 9`, color: "#ffcc00" });
  } else if (score >= 700) {
    if (frontDings.length >= 2) tips.push({ text: `Multiple front defects detected — cards with back-only DINGS grade significantly higher`, color: "#ff9900" });
    tips.push({ text: `Need ${Math.max(0, totalDings - 4)} fewer DINGS for NM-MT 8 range`, color: "#ff9900" });
  } else if (score >= 600) {
    tips.push({ text: `${totalDings} DINGS with front surface wear — this pattern typically grades 6-7 at TAG`, color: "#ff6633" });
    if (surfaceDings.length > 0) tips.push({ text: "Front surface play wear is the biggest grade limiter", color: "#ff6633" });
  } else {
    tips.push({ text: `Heavy defect load (${totalDings} DINGS) — card shows significant wear`, color: "#ff4444" });
    if (surfaceDings.length >= 2) tips.push({ text: "Surface wear on both sides — characteristic of grade 5 range", color: "#ff4444" });
  }
  
  return tips;
}

/* DINGS Map Schematic */
function DingsMap({ frontResult, backResult }) {
  const [side, setSide] = useState("front");
  const result = side === "front" ? frontResult : backResult;
  if (!result) return null;
  
  const cornerData = result.corners.details;
  const edgeData = result.edges.details;
  const centering = result.centering;
  const sideLabel = side === "front" ? "FRONT" : "BACK";
  const dingColor = "#ff6633";
  const cleanColor = "#333";
  const getCorner = (name) => cornerData.find(c => c.name === name) || {};
  const getEdge = (name) => edgeData.find(e => e.name === name) || {};
  
  // Card rect coordinates
  const cx=100, cy=80, cw=160, ch=224;

  const CornerScore = ({x, y, data, align="middle"}) => (
    <g>
      <text x={x} y={y} fill={data.hasDing?dingColor:"#555"} fontSize="7.5" fontFamily={mono} textAnchor={align} fontWeight={data.hasDing?600:400}>
        {data.name || ""}
      </text>
      <text x={x} y={y+11} fill="#555" fontSize="6.5" fontFamily={mono} textAnchor={align}>F:{data.fray||"—"} Fi:{data.fill||"—"}{data.angle!==undefined?` A:${data.angle}`:""}</text>
    </g>
  );

  const EdgeScore = ({x, y, data, align="middle"}) => (
    <g>
      <text x={x} y={y} fill={data.hasDing?dingColor:"#555"} fontSize="7.5" fontFamily={mono} textAnchor={align} fontWeight={data.hasDing?600:400}>
        {data.name||""} EDGE
      </text>
      <text x={x} y={y+11} fill="#555" fontSize="6.5" fontFamily={mono} textAnchor={align}>F:{data.fray||"—"} Fi:{data.fill||"—"}</text>
    </g>
  );

  return (
    <div style={{background:"#0d0f13",borderRadius:10,border:"1px solid #1a1c22",padding:12,marginBottom:16}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
        <span style={{fontFamily:mono,fontSize:11,color:"#888",textTransform:"uppercase"}}>DINGS Map</span>
        <div style={{display:"flex",gap:4}}>
          {["front","back"].map(s=>(<button key={s} onClick={()=>setSide(s)} style={{padding:"4px 10px",borderRadius:4,background:side===s?"rgba(0,255,136,.1)":"transparent",border:`1px solid ${side===s?"#00ff8833":"#1a1c22"}`,color:side===s?"#00ff88":"#555",fontFamily:mono,fontSize:9,textTransform:"uppercase",cursor:"pointer"}}>{s}</button>))}
        </div>
      </div>
      <svg viewBox="0 0 360 540" style={{width:"100%"}}>
        {/* Card outline */}
        <rect x={cx} y={cy} width={cw} height={ch} rx="6" fill="none" stroke="#333" strokeWidth="1.5"/>
        
        {/* Center crosshair */}
        <line x1={cx+cw/2} y1={cy} x2={cx+cw/2} y2={cy+ch} stroke="#1a1c22" strokeWidth="0.5" strokeDasharray="4,4"/>
        <line x1={cx} y1={cy+ch/2} x2={cx+cw} y2={cy+ch/2} stroke="#1a1c22" strokeWidth="0.5" strokeDasharray="4,4"/>
        <text x={cx+cw/2} y={cy+ch/2+3} fill="#222" fontSize="10" fontFamily={mono} textAnchor="middle" fontWeight="700">TAG</text>
        
        {/* Centering values on card */}
        <text x={cx+cw/2} y={cy-8} fill="#888" fontSize="8.5" fontFamily={mono} textAnchor="middle">C: {centering.tbRatio}</text>
        <text x={cx+cw/2} y={cy+ch+16} fill="#888" fontSize="8.5" fontFamily={mono} textAnchor="middle">C: {Math.round((100-centering.tbRatio)*10)/10}</text>
        <text x={cx-10} y={cy+ch/2+3} fill="#888" fontSize="8.5" fontFamily={mono} textAnchor="end">C: {centering.lrRatio}</text>
        <text x={cx+cw+10} y={cy+ch/2+3} fill="#888" fontSize="8.5" fontFamily={mono} textAnchor="start">C: {Math.round((100-centering.lrRatio)*10)/10}</text>
        
        {/* Corner indicators on card */}
        {[{n:"TOP LEFT",x:cx,y:cy},{n:"TOP RIGHT",x:cx+cw,y:cy},{n:"BOTTOM LEFT",x:cx,y:cy+ch},{n:"BOTTOM RIGHT",x:cx+cw,y:cy+ch}].map(({n,x,y})=>{
          const data=getCorner(n);
          return(<rect key={n} x={x-7} y={y-7} width={14} height={14} rx={3} fill="none"
            stroke={data.hasDing?dingColor:cleanColor} strokeWidth={data.hasDing?2.5:1} strokeDasharray={data.hasDing?"none":"3,3"}/>);
        })}
        
        {/* Edge indicators on card */}
        {[{n:"TOP",x1:cx+30,y1:cy,x2:cx+cw-30,y2:cy},{n:"BOTTOM",x1:cx+30,y1:cy+ch,x2:cx+cw-30,y2:cy+ch},{n:"LEFT",x1:cx,y1:cy+30,x2:cx,y2:cy+ch-30},{n:"RIGHT",x1:cx+cw,y1:cy+30,x2:cx+cw,y2:cy+ch-30}].map(({n,x1,y1,x2,y2})=>{
          const data=getEdge(n);
          return(<line key={n} x1={x1} y1={y1} x2={x2} y2={y2} stroke={data.hasDing?dingColor:cleanColor} strokeWidth={data.hasDing?3:1.5}/>);
        })}

        {/* === SCORE LABELS (below card, well-spaced) === */}
        
        {/* Top corners row */}
        <CornerScore x={45} y={cy+ch+40} data={getCorner("TOP LEFT")} align="start"/>
        <CornerScore x={315} y={cy+ch+40} data={getCorner("TOP RIGHT")} align="end"/>
        
        {/* Top edge (centered) */}
        <EdgeScore x={180} y={cy+ch+40} data={getEdge("TOP")} align="middle"/>
        
        {/* Left/Right edges row */}
        <EdgeScore x={45} y={cy+ch+72} data={getEdge("LEFT")} align="start"/>
        <EdgeScore x={315} y={cy+ch+72} data={getEdge("RIGHT")} align="end"/>
        
        {/* Bottom edge (centered) */}
        <EdgeScore x={180} y={cy+ch+72} data={getEdge("BOTTOM")} align="middle"/>
        
        {/* Bottom corners row */}
        <CornerScore x={45} y={cy+ch+104} data={getCorner("BOTTOM LEFT")} align="start"/>
        <CornerScore x={315} y={cy+ch+104} data={getCorner("BOTTOM RIGHT")} align="end"/>
        
        {/* Separator line */}
        <line x1="30" y1={cy+ch+126} x2="330" y2={cy+ch+126} stroke="#1a1c22" strokeWidth="0.5"/>
        
        {/* Side label */}
        <text x="180" y={cy+ch+142} fill="#444" fontSize="9" fontFamily={mono} textAnchor="middle">{sideLabel}</text>
        
        {/* DINGS legend */}
        {result.allDings.length > 0 && (<g>
          <rect x="30" y={cy+ch+152} width="300" height={20+result.allDings.length*14} rx="4" fill="rgba(255,102,51,.04)" stroke="#ff663322" strokeWidth="0.5"/>
          <text x="40" y={cy+ch+166} fill="#ff6633" fontSize="7.5" fontFamily={mono} fontWeight="600">DINGS DETECTED:</text>
          {result.allDings.map((d,i)=>(
            <text key={i} x="40" y={cy+ch+180+i*14} fill="#ff9944" fontSize="7" fontFamily={mono}>⚡ {d.type} — {d.location}</text>
          ))}
        </g>)}
      </svg>
    </div>
  );
}

/* DING Location Overlay — shows card image with DING regions highlighted */
function DingLocationOverlay({image, result, label}){
  if(!image||!result)return null;
  const displayImg = result.scaledImgUrl || image;
  const imgW=result.imgW||1400, imgH=result.imgH||1960;

  // Collect all detectable DING regions in analysis coordinate space
  const regions=[];
  // Corner DINGS
  for(const c of (result.corners?.details||[])){
    if(c.hasDing) regions.push({x:c.cropX,y:c.cropY,w:c.cropSize,h:c.cropSize,label:"CORNER",color:"#ff6633"});
  }
  // Edge DINGS
  for(const e of (result.edges?.details||[])){
    if(e.hasDing) regions.push({x:e.cropX,y:e.cropY,w:e.cropW,h:e.cropH,label:"EDGE",color:"#ff9944"});
  }
  // Surface DING clusters
  for(const rg of (result.surface?.defectRegions||[])){
    // Only show clusters associated with actual DINGS
    if(result.surface.dings.length>0) regions.push({x:rg.x,y:rg.y,w:rg.w,h:rg.h,label:"SURFACE",color:"#ffcc00"});
  }

  const hasDings = regions.length > 0;

  return(
    <div style={{marginBottom:14,background:"#0d0f13",borderRadius:10,border:`1px solid ${hasDings?"#332200":"#1a1c22"}`,overflow:"hidden"}}>
      <div style={{padding:"8px 12px",display:"flex",justifyContent:"space-between",alignItems:"center",borderBottom:"1px solid #151720"}}>
        <span style={{fontFamily:mono,fontSize:10,color:"#888",textTransform:"uppercase",letterSpacing:".08em"}}>{label} — Defect Map</span>
        <span style={{fontFamily:mono,fontSize:9,color:hasDings?"#ff6633":"#00ff88"}}>{hasDings?`${regions.length} region${regions.length!==1?"s":""} flagged`:"Clean"}</span>
      </div>
      <div style={{position:"relative",lineHeight:0}}>
        <img src={displayImg} style={{width:"100%",display:"block"}}/>
        <svg viewBox={`0 0 ${imgW} ${imgH}`} style={{position:"absolute",top:0,left:0,width:"100%",height:"100%",pointerEvents:"none"}}>
          {regions.map((rg,i)=>(
            <g key={i}>
              <rect x={rg.x} y={rg.y} width={rg.w} height={rg.h}
                fill="rgba(255,102,51,0.12)" stroke={rg.color} strokeWidth={8} strokeDasharray="16,8"/>
              <rect x={rg.x} y={Math.max(0,rg.y-28)} width={rg.label.length*9+16} height={24}
                fill={rg.color} rx={4}/>
              <text x={rg.x+8} y={Math.max(0,rg.y-28)+16} fill="#000" fontSize={14}
                fontFamily="'JetBrains Mono',monospace" fontWeight="700">{rg.label}</text>
            </g>
          ))}
        </svg>
        {!hasDings&&<div style={{position:"absolute",top:"50%",left:"50%",transform:"translate(-50%,-50%)",background:"rgba(0,255,136,0.15)",border:"1px solid rgba(0,255,136,0.3)",borderRadius:8,padding:"8px 14px",fontFamily:mono,fontSize:11,color:"#00ff88",whiteSpace:"nowrap"}}>No defects detected</div>}
      </div>
    </div>
  );
}

/* DINGS Preview Cards */
function DingsPreview({frontResult,backResult,frontMaps,backMaps,frontImg,backImg}){
  const[crops,setCrops]=useState([]),[loading,setLoading]=useState(true);
  useEffect(()=>{(async()=>{setLoading(true);const all=[];
    for(const[sLabel,result,img,maps]of[["Front",frontResult,frontResult?.scaledImgUrl||frontImg,frontMaps],["Back",backResult,backResult?.scaledImgUrl||backImg,backMaps]]){
      if(!result||!img)continue;
      for(const c of result.corners.details){if(!c.hasDing)continue;const rg={x:c.cropX,y:c.cropY,w:c.cropSize,h:c.cropSize};
        const norm=await cropReg(img,rg);const enh=maps?.emboss?await cropReg(maps.emboss,rg):null;
        if(norm)all.push({area:"Corner",loc:`${sLabel} / ${c.name}`,fray:c.fray,fill:c.fill,angle:c.angle,norm,enh,enhLabel:"Emboss"});}
      for(const e of result.edges.details){if(!e.hasDing)continue;const rg={x:e.cropX,y:e.cropY,w:e.cropW,h:e.cropH};
        const norm=await cropReg(img,rg);const enh=maps?.emboss?await cropReg(maps.emboss,rg):null;
        if(norm)all.push({area:"Edge",loc:`${sLabel} / ${e.name}`,fray:e.fray,fill:e.fill,norm,enh,enhLabel:"Emboss"});}
      for(const rg of (result.surface.defectRegions||[])){
        const norm=await cropReg(img,rg);const enh=maps?.highpass?await cropReg(maps.highpass,rg):null;
        if(norm)all.push({area:"Surface",loc:sLabel,norm,enh,enhLabel:"Hi-Pass"});}
    }
    setCrops(all);setLoading(false);})();},[frontResult,backResult,frontMaps,backMaps,frontImg,backImg]);
  
  if(loading)return<div style={{padding:20,textAlign:"center"}}><div style={{fontFamily:mono,fontSize:11,color:"#555"}}>Generating previews...</div></div>;
  if(!crops.length)return<div style={{padding:16,background:"rgba(0,255,136,.05)",borderRadius:8,border:"1px solid rgba(0,255,136,.15)"}}><div style={{fontFamily:mono,fontSize:11,color:"#00ff88"}}>No defects to preview</div></div>;
  
  return(<div style={{display:"flex",flexDirection:"column",gap:10}}>{crops.map((c,i)=>(
    <div key={i} style={{background:"#0d0f13",borderRadius:10,border:"1px solid #1a1c22",overflow:"hidden"}}>
      <div style={{padding:"8px 12px",display:"flex",justifyContent:"space-between",alignItems:"center",borderBottom:"1px solid #151720"}}>
        <div style={{display:"flex",alignItems:"center",gap:6}}>
          <div style={{width:4,height:4,borderRadius:"50%",background:"#ff6633"}}/>
          <span style={{fontFamily:mono,fontSize:10,color:"#888",textTransform:"uppercase"}}>{c.area}</span>
          <span style={{color:"#555",fontSize:10}}>·</span>
          <span style={{fontFamily:mono,fontSize:10,color:"#aaa"}}>{c.loc}</span>
        </div>
        {c.fray!==undefined&&<div style={{fontFamily:mono,fontSize:9,color:"#555"}}>F:{c.fray} Fi:{c.fill}{c.angle!==undefined?` A:${c.angle}`:""}</div>}
      </div>
      <div style={{display:"flex",gap:1,background:"#111"}}>
        <div style={{flex:1,position:"relative"}}><img src={c.norm} style={{width:"100%",display:"block"}}/><div style={{position:"absolute",bottom:4,left:4,fontFamily:mono,fontSize:8,color:"rgba(255,255,255,.5)",background:"rgba(0,0,0,.6)",padding:"2px 5px",borderRadius:3}}>NORMAL</div></div>
        {c.enh&&<div style={{flex:1,position:"relative"}}><img src={c.enh} style={{width:"100%",display:"block"}}/><div style={{position:"absolute",bottom:4,left:4,fontFamily:mono,fontSize:8,color:"rgba(0,255,136,.7)",background:"rgba(0,0,0,.6)",padding:"2px 5px",borderRadius:3}}>{c.enhLabel}</div></div>}
      </div>
    </div>
  ))}</div>);
}

/* ═══════════════════════════════════════════
   MANUAL BOUNDARY EDITOR
   Drag handles for outer (card edge) and
   inner (artwork border) boundaries.
   Corrects centering + re-runs analysis.
   ═══════════════════════════════════════════ */
function ManualBoundaryEditor({ image, result, side, onApply }) {
  const imgW = result.imgW || 1400;
  const imgH = result.imgH || 1960;
  const bn = result.bounds;
  const c = result.centering;

  // Try to seed from localStorage training data first
  const trained = loadTrainingBounds(result.surface?.isHolo, imgW, imgH);

  const initOuter = trained?.outer || { left:bn.left, right:bn.right, top:bn.top, bottom:bn.bottom };
  const initInner = trained?.inner || {
    left: Math.min(bn.left + c.borderL, (bn.left+bn.right)/2 - 10),
    right: Math.max(bn.right - c.borderR, (bn.left+bn.right)/2 + 10),
    top: Math.min(bn.top + c.borderT, (bn.top+bn.bottom)/2 - 10),
    bottom: Math.max(bn.bottom - c.borderB, (bn.top+bn.bottom)/2 + 10),
  };

  const [outer, setOuter] = useState(initOuter);
  const [inner, setInner] = useState(initInner);
  const [rotation, setRotation] = useState(0); // Rotation in degrees
  const [applying, setApplying] = useState(false);
  const [saved, setSaved] = useState(false);
  const svgRef = useRef(null);
  const dragging = useRef(null);
  // Refs to avoid stale closures during drag
  const outerRef = useRef(outer);
  const innerRef = useRef(inner);
  useEffect(() => { outerRef.current = outer; }, [outer]);
  useEffect(() => { innerRef.current = inner; }, [inner]);

  // Live centering numbers from current handle positions
  const cW = outer.right - outer.left, cH = outer.bottom - outer.top;
  const bL = inner.left - outer.left, bR = outer.right - inner.right;
  const bT = inner.top - outer.top, bB = outer.bottom - inner.bottom;
  const lrR = Math.round(((bL+bR)>0 ? bL/(bL+bR)*100 : 50)*10)/10;
  const tbR = Math.round(((bT+bB)>0 ? bT/(bT+bB)*100 : 50)*10)/10;
  const lrOff = Math.max(lrR, 100-lrR);
  const tbOff = Math.max(tbR, 100-tbR);

  const getCoords = (e) => {
    const svg = svgRef.current;
    if (!svg) return {x:0,y:0};
    const rect = svg.getBoundingClientRect();
    return {
      x: Math.round((e.clientX - rect.left) / rect.width * imgW),
      y: Math.round((e.clientY - rect.top) / rect.height * imgH),
    };
  };

  const moveHandle = (which, x, y) => {
    const o = outerRef.current, inn = innerRef.current;
    if (which==='OL') setOuter(p=>({...p, left:Math.max(0,Math.min(inn.left-20,x))}));
    else if (which==='OR') setOuter(p=>({...p, right:Math.min(imgW,Math.max(inn.right+20,x))}));
    else if (which==='OT') setOuter(p=>({...p, top:Math.max(0,Math.min(inn.top-20,y))}));
    else if (which==='OB') setOuter(p=>({...p, bottom:Math.min(imgH,Math.max(inn.bottom+20,y))}));
    else if (which==='IL') setInner(p=>({...p, left:Math.max(o.left+8,Math.min(p.right-30,x))}));
    else if (which==='IR') setInner(p=>({...p, right:Math.min(o.right-8,Math.max(p.left+30,x))}));
    else if (which==='IT') setInner(p=>({...p, top:Math.max(o.top+8,Math.min(p.bottom-30,y))}));
    else if (which==='IB') setInner(p=>({...p, bottom:Math.min(o.bottom-8,Math.max(p.top+30,y))}));
  };

  const handleApply = async () => {
    setApplying(true);
    const overrideBounds = { left:outer.left, right:outer.right, top:outer.top, bottom:outer.bottom };
    const tLR=bL+bR, tTB=bT+bB;
    const overrideCentering = {
      borderL:bL, borderR:bR, borderT:bT, borderB:bB,
      lrRatio:Math.round((tLR>0?bL/tLR*100:50)*10)/10,
      tbRatio:Math.round((tTB>0?bT/tTB*100:50)*10)/10,
    };
    await onApply(overrideBounds, overrideCentering);
    setApplying(false);
  };

  const handleSave = () => {
    const didSave = saveTrainingBounds(result, outer, inner);
    if (didSave) { setSaved(true); setTimeout(()=>setSaved(false), 2000); }
  };

  const handleReset = () => {
    const autoInner = {
      left: Math.min(bn.left+c.borderL, (bn.left+bn.right)/2-10),
      right: Math.max(bn.right-c.borderR, (bn.left+bn.right)/2+10),
      top: Math.min(bn.top+c.borderT, (bn.top+bn.bottom)/2-10),
      bottom: Math.max(bn.bottom-c.borderB, (bn.top+bn.bottom)/2+10),
    };
    setOuter({left:bn.left,right:bn.right,top:bn.top,bottom:bn.bottom});
    setInner(autoInner);
  };

  // Handle pill dimensions
  const pH = Math.max(52, cH*0.055), pW = Math.max(140, cW*0.22);
  const pHv = Math.max(52, cW*0.055), pWv = Math.max(140, cH*0.22);
  const lw = Math.max(3, cW*0.005);
  const pad = 50;
  // Outer handles pushed OUTSIDE the card rect so they never overlap inner handles
  const outerOffset = Math.max(pH*0.6, cH*0.04);

  // [x, y, which, isOuter, isHoriz]
  const handles = [
    [(outer.left+outer.right)/2, outer.top - outerOffset,    'OT', true,  true],
    [(outer.left+outer.right)/2, outer.bottom + outerOffset,  'OB', true,  true],
    [outer.left - outerOffset,   (outer.top+outer.bottom)/2,  'OL', true,  false],
    [outer.right + outerOffset,  (outer.top+outer.bottom)/2,  'OR', true,  false],
    [(inner.left+inner.right)/2, inner.top,    'IT', false, true],
    [(inner.left+inner.right)/2, inner.bottom,  'IB', false, true],
    [inner.left,  (inner.top+inner.bottom)/2,   'IL', false, false],
    [inner.right, (inner.top+inner.bottom)/2,   'IR', false, false],
  ];

  return (
    <div style={{background:'#0d0f13',borderRadius:10,border:'1px solid #ff994433',overflow:'hidden',marginBottom:16}}>
      {/* Header */}
      <div style={{padding:'10px 12px',borderBottom:'1px solid #1a1c22',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
        <span style={{fontFamily:mono,fontSize:11,color:'#ff9944',textTransform:'uppercase',letterSpacing:'.06em'}}>Manual Adjust — {side}</span>
        <button onClick={()=>{handleReset();setRotation(0);}} style={{fontFamily:mono,fontSize:9,color:'#555',background:'transparent',border:'1px solid #333',borderRadius:4,padding:'3px 8px',cursor:'pointer'}}>Reset All</button>
      </div>

      {/* Rotation Controls */}
      <div style={{padding:'10px 12px',background:'rgba(0,0,0,.3)',borderBottom:'1px solid #1a1c22'}}>
        <div style={{fontFamily:mono,fontSize:9,color:'#666',marginBottom:8,textTransform:'uppercase'}}>Step 1: Straighten Card</div>
        <div style={{display:'flex',alignItems:'center',justifyContent:'center',gap:6}}>
          {/* Coarse left -1° */}
          <button onClick={()=>setRotation(r=>Math.round((r-1)*100)/100)}
            style={{width:32,height:32,borderRadius:6,background:'#1a1c22',border:'1px solid #2a2d35',color:'#888',fontSize:12,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'}}>
            ‹‹
          </button>
          {/* Fine left -0.05° */}
          <button onClick={()=>setRotation(r=>Math.round((r-0.05)*100)/100)}
            style={{width:32,height:32,borderRadius:6,background:'#1a1c22',border:'1px solid #2a2d35',color:'#555',fontSize:10,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'}}>
            ‹
          </button>
          {/* Current rotation */}
          <div style={{minWidth:70,textAlign:'center',padding:'6px 10px',background:'#0a0b0e',borderRadius:6}}>
            <div style={{fontFamily:mono,fontSize:14,fontWeight:700,color:rotation===0?'#00ff88':'#ff9944'}}>{rotation.toFixed(2)}°</div>
          </div>
          {/* Fine right +0.05° */}
          <button onClick={()=>setRotation(r=>Math.round((r+0.05)*100)/100)}
            style={{width:32,height:32,borderRadius:6,background:'#1a1c22',border:'1px solid #2a2d35',color:'#555',fontSize:10,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'}}>
            ›
          </button>
          {/* Coarse right +1° */}
          <button onClick={()=>setRotation(r=>Math.round((r+1)*100)/100)}
            style={{width:32,height:32,borderRadius:6,background:'#1a1c22',border:'1px solid #2a2d35',color:'#888',fontSize:12,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'}}>
            ››
          </button>
        </div>
        <div style={{textAlign:'center',fontFamily:mono,fontSize:8,color:'#444',marginTop:6}}>‹‹/›› = 1° · ‹/› = 0.05°</div>
      </div>

      {/* Live centering readout */}
      <div style={{padding:'8px 12px',background:'rgba(0,0,0,.4)',display:'flex',justifyContent:'space-around',borderBottom:'1px solid #1a1c22'}}>
        <div style={{textAlign:'center'}}>
          <div style={{fontFamily:mono,fontSize:8,color:'#555',textTransform:'uppercase',marginBottom:2}}>L / R</div>
          <div style={{fontFamily:mono,fontSize:18,fontWeight:700,color:lrOff>55?'#ff6633':lrOff>53?'#ffcc00':'#00ff88'}}>{lrR}<span style={{color:'#444'}}>/</span>{Math.round((100-lrR)*10)/10}</div>
        </div>
        <div style={{width:1,background:'#1a1c22'}}/>
        <div style={{textAlign:'center'}}>
          <div style={{fontFamily:mono,fontSize:8,color:'#555',textTransform:'uppercase',marginBottom:2}}>T / B</div>
          <div style={{fontFamily:mono,fontSize:18,fontWeight:700,color:tbOff>55?'#ff6633':tbOff>53?'#ffcc00':'#00ff88'}}>{tbR}<span style={{color:'#444'}}>/</span>{Math.round((100-tbR)*10)/10}</div>
        </div>
        <div style={{width:1,background:'#1a1c22'}}/>
        <div style={{textAlign:'center'}}>
          <div style={{fontFamily:mono,fontSize:8,color:'#555',textTransform:'uppercase',marginBottom:2}}>Status</div>
          <div style={{fontFamily:mono,fontSize:11,fontWeight:600,color:Math.max(lrOff,tbOff)>55?'#ff6633':'#00ff88'}}>{Math.max(lrOff,tbOff)>55?'⚠ DING':'✓ Clean'}</div>
        </div>
      </div>
      {/* Legend */}
      <div style={{padding:'6px 12px',display:'flex',gap:16,borderBottom:'1px solid #0d0f13'}}>
        <div style={{display:'flex',alignItems:'center',gap:5}}>
          <svg width={22} height={8}><line x1={0} y1={4} x2={22} y2={4} stroke="#ff9944" strokeWidth={2}/></svg>
          <span style={{fontFamily:mono,fontSize:9,color:'#666'}}>Card edge</span>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:5}}>
          <svg width={22} height={8}><line x1={0} y1={4} x2={22} y2={4} stroke="#00ff88" strokeWidth={2} strokeDasharray="4,3"/></svg>
          <span style={{fontFamily:mono,fontSize:9,color:'#666'}}>Artwork border</span>
        </div>
        <span style={{fontFamily:mono,fontSize:9,color:'#444',marginLeft:'auto'}}>Drag handles</span>
      </div>
      {/* Step 2 label */}
      <div style={{padding:'8px 12px',background:'rgba(0,0,0,.2)',borderBottom:'1px solid #0d0f13'}}>
        <div style={{fontFamily:mono,fontSize:9,color:'#666',textTransform:'uppercase'}}>Step 2: Adjust Borders</div>
      </div>

      {/* Image + drag canvas — touch-action:none prevents iOS scroll hijack during drag */}
      <div style={{position:'relative',lineHeight:0,touchAction:'none',overflow:'hidden'}}
           onTouchMove={e=>{if(dragging.current)e.preventDefault();}}
           onTouchStart={e=>{if(dragging.current)e.preventDefault();}}>
        <img src={image} style={{width:'100%',display:'block',transform:`rotate(${rotation}deg)`,transformOrigin:'center center',transition:'transform 0.15s ease'}} draggable={false}/>
        {/* Crosshair overlay for alignment */}
        <div style={{position:'absolute',inset:0,pointerEvents:'none'}}>
          <div style={{position:'absolute',left:'50%',top:0,bottom:0,width:1,background:'rgba(0,255,136,0.2)'}}/>
          <div style={{position:'absolute',top:'50%',left:0,right:0,height:1,background:'rgba(0,255,136,0.2)'}}/>
        </div>
        <svg ref={svgRef} viewBox={`0 0 ${imgW} ${imgH}`}
             style={{position:'absolute',top:0,left:0,width:'100%',height:'100%',overflow:'visible',touchAction:'none'}}>
          {/* Outer boundary */}
          <rect x={outer.left} y={outer.top} width={cW} height={cH}
            fill="none" stroke="#ff9944" strokeWidth={lw} opacity={0.85}/>
          {/* Corner brackets on outer */}
          {[[outer.left,outer.top,1,1],[outer.right,outer.top,-1,1],[outer.left,outer.bottom,1,-1],[outer.right,outer.bottom,-1,-1]].map(([x,y,sx,sy],i)=>(
            <g key={i}>
              <line x1={x} y1={y} x2={x+sx*cW*0.06} y2={y} stroke="#ff9944" strokeWidth={lw*1.5}/>
              <line x1={x} y1={y} x2={x} y2={y+sy*cH*0.04} stroke="#ff9944" strokeWidth={lw*1.5}/>
            </g>
          ))}
          {/* Inner boundary */}
          <rect x={inner.left} y={inner.top} width={inner.right-inner.left} height={inner.bottom-inner.top}
            fill="none" stroke="#00ff88" strokeWidth={Math.max(2,lw*0.8)}
            strokeDasharray={`${cW*0.025},${cW*0.012}`} opacity={0.8}/>
          {/* Connector lines from outer handles to card rect edge — makes it clear what they control */}
          <line x1={(outer.left+outer.right)/2} y1={outer.top} x2={(outer.left+outer.right)/2} y2={outer.top-outerOffset+pH/2} stroke="#ff994466" strokeWidth={lw*0.6} strokeDasharray="8,6"/>
          <line x1={(outer.left+outer.right)/2} y1={outer.bottom} x2={(outer.left+outer.right)/2} y2={outer.bottom+outerOffset-pH/2} stroke="#ff994466" strokeWidth={lw*0.6} strokeDasharray="8,6"/>
          <line x1={outer.left} y1={(outer.top+outer.bottom)/2} x2={outer.left-outerOffset+pHv/2} y2={(outer.top+outer.bottom)/2} stroke="#ff994466" strokeWidth={lw*0.6} strokeDasharray="8,6"/>
          <line x1={outer.right} y1={(outer.top+outer.bottom)/2} x2={outer.right+outerOffset-pHv/2} y2={(outer.top+outer.bottom)/2} stroke="#ff994466" strokeWidth={lw*0.6} strokeDasharray="8,6"/>
          {/* 8 drag handles */}
          {handles.map(([hx,hy,which,isOuter,isHoriz])=>{
            const color = isOuter ? '#ff9944' : '#00ff88';
            const hw = isHoriz ? pW : pWv, hh = isHoriz ? pH : pHv;
            const hr = Math.min(hw,hh)/2;
            const lineLen = isHoriz ? hw*0.28 : hh*0.28;
            return (
              <g key={which} style={{cursor:isHoriz?'ns-resize':'ew-resize',touchAction:'none'}}
                 onPointerDown={e=>{e.stopPropagation();e.currentTarget.setPointerCapture(e.pointerId);dragging.current=which;}}
                 onPointerMove={e=>{if(dragging.current===which){e.preventDefault();const{x,y}=getCoords(e);moveHandle(which,x,y);}}}
                 onPointerUp={()=>{dragging.current=null;}}>
                {/* Invisible large touch target */}
                <rect x={hx-hw/2-pad} y={hy-hh/2-pad} width={hw+pad*2} height={hh+pad*2} fill="transparent"/>
                {/* Pill body */}
                <rect x={hx-hw/2} y={hy-hh/2} width={hw} height={hh} rx={hr}
                  fill={`${color}15`} stroke={color} strokeWidth={Math.max(2,lw*0.8)}/>
                {/* Three-line icon */}
                {[-0.32,0,0.32].map((o,i)=>(
                  <line key={i}
                    x1={isHoriz ? hx-lineLen : hx+o*hh*0.32}
                    y1={isHoriz ? hy+o*hh*0.32 : hy-lineLen}
                    x2={isHoriz ? hx+lineLen : hx+o*hh*0.32}
                    y2={isHoriz ? hy+o*hh*0.32 : hy+lineLen}
                    stroke={color} strokeWidth={Math.max(2,lw*0.7)} strokeLinecap="round"/>
                ))}
              </g>
            );
          })}
        </svg>
      </div>
      {/* Action buttons */}
      <div style={{padding:'10px 12px',display:'flex',gap:8}}>
        <button onClick={handleApply} disabled={applying}
          style={{flex:2,padding:'11px 0',borderRadius:7,border:'none',
            background:applying?'#1a1c22':'linear-gradient(135deg,#ff9944,#ff6633)',
            color:applying?'#444':'#000',fontFamily:mono,fontSize:11,fontWeight:700,cursor:applying?'default':'pointer',textTransform:'uppercase',letterSpacing:'.06em'}}>
          {applying?'Re-analyzing...':'▶ Apply Correction'}
        </button>
        <button onClick={handleSave}
          style={{flex:1,padding:'11px 0',borderRadius:7,border:`1px solid ${saved?'#00ff8844':'#333'}`,
            background:saved?'rgba(0,255,136,.08)':'transparent',
            color:saved?'#00ff88':'#888',fontFamily:mono,fontSize:9,cursor:'pointer',textTransform:'uppercase'}}>
          {saved?'✓ Saved':'Save & Train'}
        </button>
      </div>
    </div>
  );
}



/* Lightweight card detection for live preview (runs on small canvas) */
function detectCardLive(video, scanW=320) {
  const vw=video.videoWidth, vh=video.videoHeight;
  if(!vw||!vh) return null;
  const scale=scanW/vw, scanH=~~(vh*scale);
  const c=document.createElement("canvas"); c.width=scanW; c.height=scanH;
  const ctx=c.getContext("2d",{willReadFrequently:true});
  ctx.drawImage(video,0,0,scanW,scanH);
  const data=ctx.getImageData(0,0,scanW,scanH).data;
  const bounds=findBounds(data,scanW,scanH);
  if(bounds.cardW<scanW*0.12||bounds.cardH<scanH*0.12) return null;
  const asp=bounds.cardW/bounds.cardH, idealAsp=2.5/3.5;
  // Relaxed from 0.2 to 0.25 — handles slight tilt without dropping detection
  if(Math.abs(asp-idealAsp)>0.25) return null;
  return {
    left: (bounds.left/scanW)*100,
    top: (bounds.top/scanH)*100,
    width: (bounds.cardW/scanW)*100,
    height: (bounds.cardH/scanH)*100,
    fill: (bounds.cardW*bounds.cardH)/(scanW*scanH)*100,
    aspectOk: Math.abs(asp-idealAsp)<0.12,
  };
}

function CameraViewfinder({ side, onCapture, onClose }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [active, setActive] = useState(false);
  const [tilt, setTilt] = useState({ beta:0, gamma:0 });
  const [orientPerm, setOrientPerm] = useState("unknown");
  const [captured, setCaptured] = useState(null);
  const [validating, setValidating] = useState(false);
  const [validation, setValidation] = useState(null);
  const [camError, setCamError] = useState(null);
  const [cardOutline, setCardOutline] = useState(null);
  const [cardStable, setCardStable] = useState(0); // frames card has been stable
  const fileRef = useRef(null);
  const detectRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode:"environment", width:{ideal:1920}, height:{ideal:1440} }, audio:false,
        });
        if (cancelled) { stream.getTracks().forEach(t=>t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); }
        setActive(true);
      } catch(err) { setCamError(err.name==="NotAllowedError"?"Camera permission denied":"Camera not available — use upload"); }
    })();
    return () => { cancelled=true; streamRef.current?.getTracks().forEach(t=>t.stop()); };
  }, []);

  // Live card detection loop
  useEffect(() => {
    if (!active || captured) return;
    let running = true;
    let stableCount = 0;
    let lastOutline = null;
    
    const detect = () => {
      if (!running || !videoRef.current) return;
      try {
        const result = detectCardLive(videoRef.current);
        if (result && result.fill > 15 && result.fill < 92) {
          // Check stability - is outline similar to last frame?
          if (lastOutline && Math.abs(result.left-lastOutline.left)<3 && Math.abs(result.top-lastOutline.top)<3 && Math.abs(result.width-lastOutline.width)<3) {
            stableCount = Math.min(stableCount + 1, 15);
          } else {
            stableCount = 1;
          }
          lastOutline = result;
          setCardOutline(result);
          setCardStable(stableCount);
        } else {
          stableCount = 0;
          lastOutline = null;
          setCardOutline(null);
          setCardStable(0);
        }
      } catch(e) { /* ignore detection errors on live frames */ }
      if (running) detectRef.current = setTimeout(detect, 350);
    };
    
    detectRef.current = setTimeout(detect, 500);
    return () => { running=false; clearTimeout(detectRef.current); };
  }, [active, captured]);

  useEffect(() => {
    const handler = e => setTilt({ beta:Math.round((e.beta||0)*10)/10, gamma:Math.round((e.gamma||0)*10)/10 });
    if (typeof DeviceOrientationEvent!=="undefined" && typeof DeviceOrientationEvent.requestPermission==="function") {
      setOrientPerm("needs-request");
    } else if (typeof DeviceOrientationEvent!=="undefined") {
      window.addEventListener("deviceorientation",handler); setOrientPerm("granted");
      return () => window.removeEventListener("deviceorientation",handler);
    }
  }, []);

  const requestOrient = async () => {
    try {
      const p = await DeviceOrientationEvent.requestPermission();
      if (p==="granted") { setOrientPerm("granted"); window.addEventListener("deviceorientation",e=>setTilt({beta:Math.round((e.beta||0)*10)/10,gamma:Math.round((e.gamma||0)*10)/10})); }
    } catch { setOrientPerm("denied"); }
  };

  const isLevel=Math.abs(tilt.beta)<2&&Math.abs(tilt.gamma)<2;
  const isClose=Math.abs(tilt.beta)<5&&Math.abs(tilt.gamma)<5;
  const lvlColor=isLevel?"#00ff88":isClose?"#ffcc00":"#ff4444";
  const bx=Math.max(-20,Math.min(20,tilt.gamma*2)), by=Math.max(-20,Math.min(20,tilt.beta*2));
  
  const cardLocked = cardOutline && cardStable >= 4;
  const cardFound = cardOutline && cardStable >= 2;

  const captureFrame = () => {
    if(!videoRef.current) return;
    const v=videoRef.current, c=document.createElement("canvas");
    c.width=v.videoWidth; c.height=v.videoHeight;
    c.getContext("2d").drawImage(v,0,0);
    const dataUrl=c.toDataURL("image/jpeg",0.92);
    setCaptured(dataUrl); setValidating(true);
    validateCap(dataUrl).then(r=>{setValidation(r);setValidating(false);});
  };

  const acceptCapture = () => { streamRef.current?.getTracks().forEach(t=>t.stop()); onCapture(captured); };
  const retake = () => { setCaptured(null); setValidation(null); setCardOutline(null); setCardStable(0); };
  const closeCam = () => { streamRef.current?.getTracks().forEach(t=>t.stop()); onClose(); };
  const handleFile = e => { const f=e.target.files?.[0]; if(!f)return; const r=new FileReader(); r.onload=ev=>{const d=ev.target.result;setCaptured(d);setValidating(true);validateCap(d).then(r=>{setValidation(r);setValidating(false);});}; r.readAsDataURL(f); };

  return (
    <div style={{position:"fixed",inset:0,zIndex:1000,background:"#000",display:"flex",flexDirection:"column"}}>
      <div style={{padding:"12px 16px",display:"flex",justifyContent:"space-between",alignItems:"center",background:"rgba(0,0,0,.8)",zIndex:10}}>
        <button onClick={closeCam} style={{background:"transparent",border:"none",color:"#888",fontFamily:mono,fontSize:12,cursor:"pointer"}}>✕ Cancel</button>
        <div style={{fontFamily:mono,fontSize:12,color:"#fff",textTransform:"uppercase",letterSpacing:".1em"}}>Capture {side}</div>
        <div style={{width:60}}/>
      </div>

      <div style={{flex:1,position:"relative",overflow:"hidden"}}>
        {!captured?(<>
          {camError?(
            <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",height:"100%",padding:32}}>
              <div style={{fontFamily:mono,fontSize:12,color:"#ff4444",marginBottom:16,textAlign:"center"}}>{camError}</div>
              <button onClick={()=>fileRef.current?.click()} style={{padding:"12px 24px",background:"rgba(0,255,136,.15)",border:"1px solid #00ff8844",borderRadius:8,color:"#00ff88",fontFamily:mono,fontSize:12,cursor:"pointer"}}>Upload Photo Instead</button>
              <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={handleFile} style={{display:"none"}}/>
            </div>
          ):(
            <video ref={videoRef} playsInline muted style={{width:"100%",height:"100%",objectFit:"cover"}}/>
          )}

          {active&&(
            <svg style={{position:"absolute",inset:0,width:"100%",height:"100%",pointerEvents:"none"}}>
              {/* Dim overlay with cutout - use detected card or static guide */}
              {cardFound ? (<>
                {/* Live detected card outline */}
                <defs><mask id="cm"><rect width="100%" height="100%" fill="white"/><rect x={`${cardOutline.left}%`} y={`${cardOutline.top}%`} width={`${cardOutline.width}%`} height={`${cardOutline.height}%`} rx="6" fill="black"/></mask></defs>
                <rect width="100%" height="100%" fill="rgba(0,0,0,.5)" mask="url(#cm)"/>
                <rect x={`${cardOutline.left}%`} y={`${cardOutline.top}%`} width={`${cardOutline.width}%`} height={`${cardOutline.height}%`} rx="6"
                  fill="none" stroke={cardLocked?"#00ff88":"#ffcc00"} strokeWidth={cardLocked?"2.5":"1.5"}
                  style={{transition:"all .2s ease"}} />
                {/* Corner brackets on detected card */}
                {[[0,0,1,0,0,1],[1,0,-1,0,0,1],[0,1,1,0,0,-1],[1,1,-1,0,0,-1]].map(([cx,cy,dx,_,__,dy],i)=>{
                  const px=cardOutline.left+cx*cardOutline.width;
                  const py=cardOutline.top+cy*cardOutline.height;
                  return(<g key={i}>
                    <line x1={`${px}%`} y1={`${py}%`} x2={`${px+dx*3}%`} y2={`${py}%`} stroke={cardLocked?"#00ff88":"#ffcc00"} strokeWidth="3"/>
                    <line x1={`${px}%`} y1={`${py}%`} x2={`${px}%`} y2={`${py+dy*3}%`} stroke={cardLocked?"#00ff88":"#ffcc00"} strokeWidth="3"/>
                  </g>);
                })}
              </>):(<>
                {/* Static guide when no card detected */}
                <defs><mask id="cm"><rect width="100%" height="100%" fill="white"/><rect x="15%" y="12%" width="70%" height="76%" rx="8" fill="black"/></mask></defs>
                <rect width="100%" height="100%" fill="rgba(0,0,0,.45)" mask="url(#cm)"/>
                <rect x="15%" y="12%" width="70%" height="76%" rx="8" fill="none" stroke="#ffffff33" strokeWidth="1.5" strokeDasharray="8,6"/>
              </>)}
              {/* Center crosshair */}
              <line x1="49%" y1="50%" x2="51%" y2="50%" stroke="rgba(255,255,255,.2)" strokeWidth="1"/>
              <line x1="50%" y1="49%" x2="50%" y2="51%" stroke="rgba(255,255,255,.2)" strokeWidth="1"/>
              {/* Status text */}
              <text x="50%" y="7%" textAnchor="middle" fill={cardLocked?"#00ff88":cardFound?"#ffcc00":"rgba(255,255,255,.4)"} fontSize="11" fontFamily={mono}>
                {cardLocked?"✓ CARD LOCKED — READY TO SNAP":cardFound?"CARD DETECTED — HOLD STEADY":"ALIGN CARD WITHIN FRAME"}
              </text>
              {/* Fill percentage */}
              {cardFound&&<text x="50%" y="95%" textAnchor="middle" fill="#00ff8888" fontSize="10" fontFamily={mono}>
                {Math.round(cardOutline.fill)}% fill
              </text>}
            </svg>
          )}

          {/* Bubble level */}
          {orientPerm==="granted"&&active&&(
            <div style={{position:"absolute",bottom:100,left:"50%",transform:"translateX(-50%)",display:"flex",flexDirection:"column",alignItems:"center",gap:6}}>
              <div style={{width:56,height:56,borderRadius:"50%",border:`2px solid ${lvlColor}44`,background:"rgba(0,0,0,.5)",position:"relative",display:"flex",alignItems:"center",justifyContent:"center"}}>
                <div style={{position:"absolute",width:10,height:1,background:`${lvlColor}33`}}/>
                <div style={{position:"absolute",width:1,height:10,background:`${lvlColor}33`}}/>
                <div style={{position:"absolute",width:12,height:12,borderRadius:"50%",border:`1px solid ${lvlColor}44`}}/>
                <div style={{width:10,height:10,borderRadius:"50%",background:lvlColor,boxShadow:`0 0 8px ${lvlColor}66`,transform:`translate(${bx}px,${by}px)`,transition:"transform .1s ease-out"}}/>
              </div>
              <div style={{fontFamily:mono,fontSize:9,color:lvlColor,textTransform:"uppercase",letterSpacing:".1em"}}>{isLevel?"✓ Level":isClose?"Almost level":"Tilted"}</div>
            </div>
          )}
          {orientPerm==="needs-request"&&active&&(
            <button onClick={requestOrient} style={{position:"absolute",bottom:110,left:"50%",transform:"translateX(-50%)",padding:"8px 16px",background:"rgba(0,255,136,.15)",border:"1px solid #00ff8844",borderRadius:8,color:"#00ff88",fontFamily:mono,fontSize:10,cursor:"pointer"}}>Enable Level</button>
          )}
        </>):(
          <div style={{width:"100%",height:"100%",position:"relative"}}>
            <img src={captured} style={{width:"100%",height:"100%",objectFit:"contain"}}/>
            {validating&&<div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",background:"rgba(0,0,0,.6)"}}><div style={{fontFamily:mono,fontSize:12,color:"#00ff88"}}>Checking card detection...</div></div>}
            {validation&&(
              <div style={{position:"absolute",bottom:0,left:0,right:0,padding:16,background:"linear-gradient(transparent,rgba(0,0,0,.9))"}}>
                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
                  <div style={{width:8,height:8,borderRadius:"50%",background:validation.valid?"#00ff88":"#ff4444"}}/>
                  <span style={{fontFamily:mono,fontSize:12,color:validation.valid?"#00ff88":"#ff4444"}}>{validation.valid?"Card detected — good capture":"Issues detected"}</span>
                </div>
                {validation.valid&&<div style={{fontFamily:mono,fontSize:10,color:"#666"}}>Card fills {validation.fillRatio}% of frame</div>}
                {!validation.valid&&validation.issues.map((is,i)=><div key={i} style={{fontFamily:mono,fontSize:10,color:"#ff9944"}}>⚠ {is}</div>)}
              </div>
            )}
          </div>
        )}
      </div>

      <div style={{padding:"16px 20px 28px",background:"rgba(0,0,0,.9)",display:"flex",alignItems:"center",justifyContent:"center",gap:20}}>
        {!captured?(<>
          <button onClick={()=>fileRef.current?.click()} style={{width:40,height:40,borderRadius:"50%",background:"transparent",border:"1px solid #444",color:"#888",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer"}}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
          </button>
          <input ref={fileRef} type="file" accept="image/*" onChange={handleFile} style={{display:"none"}}/>
          {/* Shutter button - changes color when card locked */}
          <button onClick={captureFrame} disabled={!active&&!camError} style={{width:68,height:68,borderRadius:"50%",background:"transparent",border:`4px solid ${cardLocked?"#00ff88":active?"#fff":"#444"}`,cursor:active?"pointer":"default",display:"flex",alignItems:"center",justifyContent:"center",transition:"border-color .3s"}}>
            <div style={{width:56,height:56,borderRadius:"50%",background:cardLocked?"#00ff88":active?"#fff":"#333",transition:"all .3s"}}/>
          </button>
          <div style={{width:40}}/>
        </>):(<>
          <button onClick={retake} style={{padding:"12px 24px",background:"transparent",border:"1px solid #444",borderRadius:10,color:"#fff",fontFamily:mono,fontSize:12,cursor:"pointer"}}>Retake</button>
          <button onClick={acceptCapture} style={{padding:"12px 24px",background:validation?.valid?"#00ff88":"rgba(0,255,136,.3)",border:"none",borderRadius:10,color:"#000",fontFamily:mono,fontSize:12,fontWeight:700,cursor:"pointer"}}>{validation?.valid?"✓ Use Photo":"Use Anyway"}</button>
        </>)}
      </div>
    </div>
  );
}

/* Post-capture validation */
async function validateCap(src){const{w,h,data}=await loadImg(src,600);const bn=findBounds(data.data,w,h);const fill=bn.cardW*bn.cardH/(w*h),asp=bn.cardH>0?bn.cardW/bn.cardH:0,aDiff=Math.abs(asp-2.5/3.5);const ok=bn.cardW>50&&bn.cardH>50&&fill>.2&&fill<.95&&aDiff<.15;const issues=[];if(bn.cardW<=50)issues.push("Card not detected — use contrasting background");if(fill<.2&&bn.cardW>50)issues.push("Card too small — move closer");if(fill>=.95)issues.push("Too close — back up slightly");if(aDiff>=.15&&bn.cardW>50)issues.push("Card may be tilted");return{valid:ok,fillRatio:~~(fill*100),issues};}

/* Image Capture (opens viewfinder or fallback) - Original horizontal layout */
function CaptureCard({label,side,image,onImage,onOpenCamera}){
  const ref=useRef(null);
  return(<div style={{flex:1}}>
    <div style={{fontFamily:mono,fontSize:10,color:"#555",textTransform:"uppercase",letterSpacing:".12em",marginBottom:6}}>{label}</div>
    {!image?(<div onClick={()=>onOpenCamera(side)} style={{aspectRatio:"2.5/3.5",background:"#0d0f13",border:"1px dashed #2a2d35",borderRadius:10,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",cursor:"pointer"}}>
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#444" strokeWidth="1.5"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg>
      <div style={{fontFamily:mono,fontSize:11,color:"#444",marginTop:8}}>Tap to capture</div>
      <div style={{fontFamily:mono,fontSize:9,color:"#00ff8866",marginTop:4}}>with level + guide</div>
    </div>):(<div style={{position:"relative",aspectRatio:"2.5/3.5",borderRadius:10,overflow:"hidden",background:"#0a0a0a"}}>
      <img src={image} style={{width:"100%",height:"100%",objectFit:"contain"}}/>
      <div style={{position:"absolute",top:4,left:4,fontFamily:mono,fontSize:8,color:"#00ff88",background:"rgba(0,0,0,.6)",padding:"2px 6px",borderRadius:4}}>✓</div>
      <button onClick={()=>onImage(null)} style={{position:"absolute",top:6,right:6,width:26,height:26,borderRadius:"50%",background:"rgba(0,0,0,.7)",border:"1px solid #333",color:"#888",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",fontSize:13}}>×</button>
    </div>)}
  </div>);
}

/* Image Capture - Vertical stack layout (horizontal card with image left, info right) */
function CaptureCardVertical({label,side,image,onImage,onOpenCamera,quality}){
  const isFront = side === "front";
  const accentColor = isFront ? "#6366f1" : "#8b5cf6";
  const hasWarnings = quality?.warnings?.length > 0;
  const hasHighSeverity = quality?.warnings?.some(w => w.severity === 'high');

  return(
    <div style={{marginBottom:hasWarnings?0:0}}>
      <div
        onClick={!image ? ()=>onOpenCamera(side) : undefined}
        style={{
          display:"flex",
          alignItems:"stretch",
          background:"#0d0f13",
          border: hasHighSeverity ? "1px solid #ff663344" : image ? `1px solid ${accentColor}44` : "1px dashed #2a2d35",
          borderRadius: hasWarnings ? "12px 12px 0 0" : 12,
          overflow:"hidden",
          cursor: !image ? "pointer" : "default",
          transition:"all .2s",
        }}
      >
        {/* Image Preview Area */}
        <div style={{
          width:100,
          minHeight:140,
          background:"#0a0a0a",
          display:"flex",
          alignItems:"center",
          justifyContent:"center",
          position:"relative",
          flexShrink:0,
        }}>
          {!image ? (
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#333" strokeWidth="1.5">
              <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/>
              <circle cx="12" cy="13" r="4"/>
            </svg>
          ) : (
            <>
              <img src={image} style={{width:"100%",height:"100%",objectFit:"cover"}}/>
              <div style={{position:"absolute",top:4,left:4,width:16,height:16,borderRadius:"50%",background:hasHighSeverity?"#ff6633":accentColor,display:"flex",alignItems:"center",justifyContent:"center"}}>
                <span style={{color:"#fff",fontSize:10,fontWeight:700}}>{hasHighSeverity?"!":"✓"}</span>
              </div>
            </>
          )}
        </div>

        {/* Info Area */}
        <div style={{flex:1,padding:"14px 16px",display:"flex",flexDirection:"column",justifyContent:"center"}}>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
            <span style={{fontFamily:mono,fontSize:13,fontWeight:700,color:image ? accentColor : "#666",textTransform:"uppercase"}}>{label}</span>
            {image && !hasHighSeverity && <span style={{fontFamily:mono,fontSize:9,color:"#00ff88",background:"rgba(0,255,136,.1)",padding:"2px 6px",borderRadius:4}}>Ready</span>}
            {image && hasHighSeverity && <span style={{fontFamily:mono,fontSize:9,color:"#ff6633",background:"rgba(255,102,51,.1)",padding:"2px 6px",borderRadius:4}}>Issues</span>}
          </div>

          {!image ? (
            <>
              <div style={{fontFamily:sans,fontSize:12,color:"#666",marginBottom:8}}>Tap to capture {label.toLowerCase()} of card</div>
              <div style={{display:"flex",alignItems:"center",gap:6}}>
                <div style={{width:6,height:6,borderRadius:"50%",background:"#00ff8866"}}/>
                <span style={{fontFamily:mono,fontSize:9,color:"#00ff8866"}}>Level guide + card detection</span>
              </div>
            </>
          ) : (
          <button
            onClick={(e)=>{e.stopPropagation();onImage(null);}}
            style={{
              alignSelf:"flex-start",
              padding:"6px 12px",
              background:"rgba(255,68,68,.1)",
              border:"1px solid rgba(255,68,68,.2)",
              borderRadius:6,
              color:"#ff6666",
              fontFamily:mono,
              fontSize:10,
              cursor:"pointer",
            }}
          >
            ✕ Remove
          </button>
        )}
      </div>
    </div>

    {/* Photo Quality Warnings */}
    {image && hasWarnings && (
      <div style={{
        padding:"10px 14px",
        background: hasHighSeverity ? "rgba(255,102,51,.08)" : "rgba(255,170,0,.08)",
        borderTop: "none",
        borderLeft: `1px solid ${hasHighSeverity ? "#ff663333" : "#ffaa0033"}`,
        borderRight: `1px solid ${hasHighSeverity ? "#ff663333" : "#ffaa0033"}`,
        borderBottom: `1px solid ${hasHighSeverity ? "#ff663333" : "#ffaa0033"}`,
        borderRadius: "0 0 12px 12px",
      }}>
        {quality.warnings.map((w, i) => (
          <div key={i} style={{display:"flex",alignItems:"flex-start",gap:8,marginBottom:i<quality.warnings.length-1?6:0}}>
            <span style={{color:w.severity==='high'?"#ff6633":"#ffaa00",fontSize:12}}>⚠</span>
            <span style={{fontFamily:sans,fontSize:11,color:"#999",lineHeight:1.4}}>{w.message}</span>
          </div>
        ))}
      </div>
    )}
    </div>
  );
}

/* ═══════════════════════════════════════════
   MAIN APP
   ═══════════════════════════════════════════ */
export default function SlabSense(){
  // Unified tab state - single tab bar for everything
  const[tab,setTab]=useState("scan"); // 'home'|'scan'|'cards'|'grade'|'dings'|'centering'

  // Scan flow state
  const[step,setStep]=useState(0);
  const[fI,setFI]=useState(null),[bI,setBI]=useState(null);
  const[fR,setFR]=useState(null),[bR,setBR]=useState(null);
  const[fM,setFM]=useState(null),[bM,setBM]=useState(null);
  const[gradeResult,setGradeResult]=useState(null);
  const[prog,setProg]=useState("");
  const[camTarget,setCamTarget]=useState(null);
  const[manualMode,setManualMode]=useState(null); // 'front'|'back'|null
  const[centeringConfirmed,setCenteringConfirmed]=useState(false); // User confirmed edge alignment
  const[ignoreCentering,setIgnoreCentering]=useState(false); // Ignore centering in grade calculation
  const[gradingCompany,setGradingCompany]=useState(DEFAULT_GRADING_COMPANY); // Selected grading company
  const[useBackend,setUseBackend]=useState(true); // Use Python backend for analysis
  const[backendStatus,setBackendStatus]=useState({available:null,checking:true}); // Backend health status

  // Photo quality state
  const[frontQuality,setFrontQuality]=useState(null);
  const[backQuality,setBackQuality]=useState(null);

  // UI state
  const[showDisclaimer,setShowDisclaimer]=useState(true); // Show disclaimer on first load
  const[showAuthModal,setShowAuthModal]=useState(false); // Auth modal visibility
  const[savingStatus,setSavingStatus]=useState(null); // 'saving' | 'saved' | 'error' | null
  const[showCollection,setShowCollection]=useState(false); // Collection view visibility
  const[showExport,setShowExport]=useState(false); // Export modal visibility
  const[showSettings,setShowSettings]=useState(false); // Settings modal visibility
  const[visionMode,setVisionMode]=useState('normal'); // 'normal'|'emboss'|'hiPass'|'edges'
  const[visionIntensity,setVisionIntensity]=useState(50); // 0-100% intensity slider

  // 3D Viewer / AI Enhanced Cards state
  const[enhancedCards,setEnhancedCards]=useState(null); // { front, back } - AI cropped cards
  const[enhancingStatus,setEnhancingStatus]=useState(null); // 'enhancing' | 'done' | 'error' | null
  const[show3DViewer,setShow3DViewer]=useState(false); // 3D viewer modal visibility
  const[cardInfo,setCardInfo]=useState(null); // Card info: { name, cardNumber, setName, etc. }
  const[aiCondition,setAiCondition]=useState(null); // AI condition assessment: { overall, corners, edges, surface, notes }
  const[aiGradingNotes,setAiGradingNotes]=useState(null); // AI grading notes: { positives, concerns, estimatedGrade }
  const[aiGrades,setAiGrades]=useState(null); // Multi-company grades from Claude: { psa, bgs, sgc, cgc, tag }
  const[aiSummary,setAiSummary]=useState(null); // AI summary: { positives, concerns, recommendation }
  const[extractingInfo,setExtractingInfo]=useState(false); // AI analysis in progress

  // Auth hook
  const auth = useAuth();

  // Load user's preferred grading company when profile loads
  useEffect(() => {
    if (auth.profile?.preferred_company) {
      setGradingCompany(auth.profile.preferred_company);
    }
  }, [auth.profile]);

  // Check backend health on mount
  useEffect(() => {
    checkBackendHealth().then(status => {
      setBackendStatus({...status, checking: false});
      if (!status.available) {
        setUseBackend(false); // Fall back to client-side if backend unavailable
      }
    });
  }, []);

  // Re-runs analysis with manual boundary overrides, updates grade
  const applyManualCorrection = useCallback(async (side, overrideBounds, overrideCentering) => {
    const src = side === 'front' ? fI : bI;
    if (!src) return;
    const result = await analyzeCardFull(src, side, overrideBounds, overrideCentering);
    const newFR = side === 'front' ? result : fR;
    const newBR = side === 'back' ? result : bR;
    if (side === 'front') setFR(result); else setBR(result);
    const effFront = ignoreCentering ? PERFECT_CENTER : newFR.centering;
    const effBack = ignoreCentering ? PERFECT_CENTER : newBR.centering;
    const grade = computeGrade(newFR.allDings, newBR.allDings, effFront, effBack, gradingCompany);
    setGradeResult(grade);
  }, [fI, bI, fR, bR, ignoreCentering, gradingCompany]);

  const run=useCallback(async()=>{
    if(!fI||!bI)return; setStep(1);
    try{
      // Use Python backend if enabled and available
      if (useBackend && backendStatus.available) {
        setProg("Sending to backend for analysis...");await new Promise(r=>setTimeout(r,30));
        const backendResult = await analyzeCardWithBackend(fI, bI, 'tcg');

        // Use backend results directly for TAG grading
        const fr = backendResult.front;
        const br = backendResult.back;
        fr.scaledImgUrl = fI;
        br.scaledImgUrl = bI;
        setFR(fr);
        setBR(br);

        // Use backend's grade directly for TAG, convert for other companies
        const combined = backendResult.combined;
        setProg(`Processing ${GRADING_COMPANIES[gradingCompany]?.name || 'TAG'} grade...`);await new Promise(r=>setTimeout(r,30));

        if (gradingCompany === 'tag') {
          // Use backend TAG score directly
          const tagGrade = getGrade(combined.tag_score, 'tag');
          setGradeResult({
            rawScore: combined.tag_score,
            grade: tagGrade,
            subgrades: {
              frontCenter: combined.subgrades.frontCenter,
              backCenter: combined.subgrades.backCenter,
              corners: 990, // Backend doesn't separate these yet
              edges: 990,
              surface: combined.subgrades.condition,
            },
            allDings: combined.dings || [],
            processingTimeMs: combined.processing_time_ms,
            source: 'backend',
          });
        } else {
          // Convert to other company scales
          const effFront = ignoreCentering ? PERFECT_CENTER : fr.centering;
          const effBack = ignoreCentering ? PERFECT_CENTER : br.centering;
          const grade = computeGrade(fr.allDings, br.allDings, effFront, effBack, gradingCompany);
          setGradeResult({...grade, source: 'backend'});
        }

        setProg("Generating surface vision maps...");await new Promise(r=>setTimeout(r,30));
        setFM(await genMaps(fI)); setBM(await genMaps(bI));
        setStep(2);
      } else {
        // Fall back to client-side analysis
        setProg("Detecting card bounds (front)...");await new Promise(r=>setTimeout(r,30));
        const fr=await analyzeCardFull(fI,"front"); setFR(fr);
        setProg("Detecting card bounds (back)...");await new Promise(r=>setTimeout(r,30));
        const br=await analyzeCardFull(bI,"back"); setBR(br);
        setProg(`Computing ${GRADING_COMPANIES[gradingCompany]?.name || 'TAG'} grade...`);await new Promise(r=>setTimeout(r,30));
        const effFront = ignoreCentering ? PERFECT_CENTER : fr.centering;
        const effBack = ignoreCentering ? PERFECT_CENTER : br.centering;
        const grade=computeGrade(fr.allDings,br.allDings,effFront,effBack,gradingCompany);
        setGradeResult({...grade, source: 'client'});
        setProg("Generating surface vision maps...");await new Promise(r=>setTimeout(r,30));
        setFM(await genMaps(fI)); setBM(await genMaps(bI));
        setStep(2);
      }
    }catch(e){console.error("Analysis error:",e);setProg(`Error: ${e.message || "try better photos"}`);}
  },[fI,bI,ignoreCentering,gradingCompany,useBackend,backendStatus.available]);

  // Recompute grade when ignoreCentering or gradingCompany changes and results exist
  useEffect(()=>{
    if(fR && bR){
      const effFront = ignoreCentering ? PERFECT_CENTER : fR.centering;
      const effBack = ignoreCentering ? PERFECT_CENTER : bR.centering;
      const grade = computeGrade(fR.allDings, bR.allDings, effFront, effBack, gradingCompany);
      setGradeResult(grade);
    }
  },[ignoreCentering, gradingCompany, fR, bR]);

  const reset=()=>{setStep(0);setFI(null);setBI(null);setFR(null);setBR(null);setFM(null);setBM(null);setGradeResult(null);setTab("scan");setIgnoreCentering(false);setSavingStatus(null);setFrontQuality(null);setBackQuality(null);setEnhancedCards(null);setEnhancingStatus(null);setShow3DViewer(false);setCardInfo(null);setAiCondition(null);setAiGradingNotes(null);setAiGrades(null);setAiSummary(null);setExtractingInfo(false);setCroppingFor3D(false);setCenteringConfirmed(false);};

  // Analyze photo quality when images are captured
  const handleSetFrontImage = useCallback(async (img) => {
    setFI(img);
    if (img) {
      try {
        const quality = await analyzePhotoQuality(img);
        setFrontQuality(quality);
      } catch (e) {
        console.error('Quality analysis failed:', e);
        setFrontQuality(null);
      }
    } else {
      setFrontQuality(null);
    }
  }, []);

  const handleSetBackImage = useCallback(async (img) => {
    setBI(img);
    if (img) {
      try {
        const quality = await analyzePhotoQuality(img);
        setBackQuality(quality);
      } catch (e) {
        console.error('Quality analysis failed:', e);
        setBackQuality(null);
      }
    } else {
      setBackQuality(null);
    }
  }, []);
  const handleCam=d=>{if(camTarget==="front")setFI(d);else setBI(d);setCamTarget(null);};

  // Save scan to user's collection (includes AI data and enhanced images)
  const handleSaveScan = async () => {
    if (!auth.isAuthenticated || !gradeResult) return;
    setSavingStatus('saving');
    try {
      // Determine grade to save (prefer AI grade if available)
      const aiGradeForCompany = aiGrades?.[gradingCompany];
      const gradeValue = aiGradeForCompany?.grade ?? gradeResult.grade.grade;
      const gradeLabel = aiGradeForCompany?.label ?? gradeResult.grade.label;

      await saveScan(auth.user.id, {
        gradingCompany,
        rawScore: gradeResult.rawScore,
        gradeValue,
        gradeLabel,
        subgrades: gradeResult.subgrades,
        frontCentering: fR?.centering,
        backCentering: bR?.centering,
        dings: gradeResult.allDings,
        // Include AI-enhanced images if available (for 3D viewer in collection)
        enhancedFront: enhancedCards?.front || null,
        enhancedBack: enhancedCards?.back || null,
        // Include OCR-extracted card info
        cardName: cardInfo?.name || null,
        cardSet: cardInfo?.setName || null,
        cardNumber: cardInfo?.cardNumber || null,
        cardGame: 'pokemon',
        // AI grading data (from Claude)
        aiGrades: aiGrades || null,
        aiCondition: aiCondition || null,
        aiSummary: aiSummary || null,
        aiCentering: fR?.centering?.source === 'claude-ai' ? {
          front: { leftRight: fR?.centering?.lrRatio, topBottom: fR?.centering?.tbRatio },
          back: bR?.centering ? { leftRight: bR?.centering?.lrRatio, topBottom: bR?.centering?.tbRatio } : null,
        } : null,
        cardInfo: cardInfo || null,
      });
      setSavingStatus('saved');
      setTimeout(() => setSavingStatus(null), 2000);
    } catch (err) {
      console.error('Error saving scan:', err);
      setSavingStatus('error');
      setTimeout(() => setSavingStatus(null), 3000);
    }
  };

  // AI Grade - Claude analyzes card and returns grades (no SAM, no 3D)
  // Cost: ~$0.03 per card
  const handleEnhanceCards = async () => {
    if (!fI || !bI) return;
    setEnhancingStatus('enhancing');
    setExtractingInfo(true);
    try {
      console.log('Starting Claude grading analysis...');
      setProg('AI grading card...');

      const result = await claudeGradingAnalysis(fI, bI, 'pokemon');

      if (result.success) {
        // Card info from OCR
        if (result.cardInfo) {
          setCardInfo(result.cardInfo);
        }

        // Condition assessment
        if (result.condition) {
          setAiCondition(result.condition);
        }

        // Multi-company grades from Claude
        if (result.grades) {
          setAiGrades(result.grades);
          console.log('AI Multi-company grades:', result.grades);
        }

        // Summary with positives/concerns/recommendation
        if (result.summary) {
          setAiSummary(result.summary);
          setAiGradingNotes({
            positives: result.summary.positives || [],
            concerns: result.summary.concerns || [],
            estimatedGrade: result.grades?.[gradingCompany]?.grade || result.grades?.tag?.grade,
            recommendation: result.summary.recommendation,
          });
        }

        // Apply Claude's centering data
        if (result.centering) {
          console.log('AI Centering:', result.centering);

          const parseCentering = (str) => {
            if (!str) return null;
            const parts = str.split('/').map(s => parseFloat(s.trim()));
            if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
              return { left: parts[0], right: parts[1] };
            }
            return null;
          };

          if (result.centering.front && fR) {
            const lrParsed = parseCentering(result.centering.front.leftRight || result.centering.front.lr);
            const tbParsed = parseCentering(result.centering.front.topBottom || result.centering.front.tb);

            if (lrParsed || tbParsed) {
              const updatedFR = { ...fR };
              if (lrParsed) {
                updatedFR.centering = {
                  ...updatedFR.centering,
                  lrRatio: `${lrParsed.left}/${lrParsed.right}`,
                  leftPct: lrParsed.left,
                  rightPct: lrParsed.right,
                };
              }
              if (tbParsed) {
                updatedFR.centering = {
                  ...updatedFR.centering,
                  tbRatio: `${tbParsed.left}/${tbParsed.right}`,
                  topPct: tbParsed.left,
                  bottomPct: tbParsed.right,
                };
              }
              updatedFR.centering.source = 'claude-ai';
              setFR(updatedFR);
            }
          }

          if (result.centering.back && bR) {
            const lrParsed = parseCentering(result.centering.back.leftRight || result.centering.back.lr);
            const tbParsed = parseCentering(result.centering.back.topBottom || result.centering.back.tb);

            if (lrParsed || tbParsed) {
              const updatedBR = { ...bR };
              if (lrParsed) {
                updatedBR.centering = {
                  ...updatedBR.centering,
                  lrRatio: `${lrParsed.left}/${lrParsed.right}`,
                  leftPct: lrParsed.left,
                  rightPct: lrParsed.right,
                };
              }
              if (tbParsed) {
                updatedBR.centering = {
                  ...updatedBR.centering,
                  tbRatio: `${tbParsed.left}/${tbParsed.right}`,
                  topPct: tbParsed.left,
                  bottomPct: tbParsed.right,
                };
              }
              updatedBR.centering.source = 'claude-ai';
              setBR(updatedBR);
            }
          }
        }

        setEnhancingStatus('done');
        setExtractingInfo(false);
        setProg('');
        console.log('Claude analysis complete:', result.cardInfo?.name);

      } else {
        console.error('AI analysis failed:', result.error);
        setEnhancingStatus('error');
        setExtractingInfo(false);
        setProg('');
        setTimeout(() => setEnhancingStatus(null), 3000);
      }
    } catch (err) {
      console.error('Error in AI analysis:', err);
      setEnhancingStatus('error');
      setExtractingInfo(false);
      setProg('');
      setTimeout(() => setEnhancingStatus(null), 3000);
    }
  };

  // 3D View - SAM crops cards for 3D display (separate from grading)
  // Cost: ~$0.02 per card
  const [croppingFor3D, setCroppingFor3D] = useState(false);
  const handle3DView = async () => {
    if (!fI || !bI) return;

    // If already have cropped images, just show viewer
    if (enhancedCards?.front) {
      setShow3DViewer(true);
      return;
    }

    setCroppingFor3D(true);
    setProg('Preparing 3D view...');

    try {
      console.log('Starting SAM cropping for 3D view...');
      const samResult = await samCardCropping(fI, bI);

      if (samResult.success || samResult.croppedFront) {
        setEnhancedCards({
          front: samResult.croppedFront,
          back: samResult.croppedBack,
        });
        console.log('SAM cropping complete - 3D view ready');
        setShow3DViewer(true);
      } else {
        // Fall back to original images
        setEnhancedCards({ front: fI, back: bI });
        console.warn('SAM failed, using original images');
        setShow3DViewer(true);
      }
    } catch (err) {
      console.error('SAM error:', err);
      // Fall back to original images
      setEnhancedCards({ front: fI, back: bI });
      setShow3DViewer(true);
    } finally {
      setCroppingFor3D(false);
      setProg('');
    }
  };


  // Unified tab bar - navigation + analysis tabs combined
  const allTabs=[
    {id:"home",l:"Home",i:"⌂",free:true,nav:true},
    {id:"scan",l:"Scan",i:"◎",free:true,nav:true},
    {id:"cards",l:"Cards",i:"▤",free:true,nav:true},
    {id:"grade",l:"Grade",i:"★",free:true,analysis:true},
    {id:"dings",l:"Dings",i:"⚠",free:true,analysis:true},
    {id:"centering",l:"Center",i:"⊞",free:true,analysis:true},
  ];
  const tabs = allTabs; // All tabs available to all users

  const gr = gradeResult;

  return(<div style={{minHeight:"100vh",maxWidth:480,margin:"0 auto",background:"#0a0b0e",color:"#e0e0e0",fontFamily:sans,display:"flex",flexDirection:"column"}}>
    {/* Auth Modal */}
    {showAuthModal && (
      <AuthModal
        isOpen={showAuthModal}
        onClose={() => setShowAuthModal(false)}
        onAuth={auth}
      />
    )}
    {/* Collection View */}
    {showCollection && (
      <CollectionView
        userId={auth.user?.id}
        onClose={() => setShowCollection(false)}
      />
    )}
    {/* Export Modal */}
    {showExport && gradeResult && (
      <ExportCard
        gradeResult={gradeResult}
        frontImage={fI}
        backImage={bI}
        gradingCompany={gradingCompany}
        onClose={() => setShowExport(false)}
      />
    )}
    {/* 3D Card Viewer Modal */}
    {show3DViewer && enhancedCards && (
      <div style={{
        position:"fixed",
        inset:0,
        background:"rgba(0,0,0,0.95)",
        zIndex:1000,
        display:"flex",
        flexDirection:"column",
        alignItems:"center",
        justifyContent:"center",
      }}>
        {/* Close button */}
        <button
          onClick={() => setShow3DViewer(false)}
          style={{
            position:"absolute",
            top:16,
            right:16,
            background:"rgba(255,255,255,0.1)",
            border:"none",
            borderRadius:"50%",
            width:40,
            height:40,
            color:"#fff",
            fontSize:20,
            cursor:"pointer",
            display:"flex",
            alignItems:"center",
            justifyContent:"center",
          }}
        >
          ✕
        </button>
        {/* Grade badge */}
        {gradeResult && (
          <div style={{
            position:"absolute",
            top:16,
            left:16,
            background:gradeResult.grade.bg,
            borderRadius:8,
            padding:"8px 16px",
            border:`1px solid ${gradeResult.grade.color}33`,
          }}>
            <div style={{fontFamily:mono,fontSize:24,fontWeight:800,color:gradeResult.grade.color}}>
              {Number.isInteger(gradeResult.grade.grade) ? gradeResult.grade.grade : gradeResult.grade.grade.toFixed(1)}
            </div>
            <div style={{fontFamily:mono,fontSize:9,color:gradeResult.grade.color,opacity:0.8}}>
              {gradeResult.grade.label}
            </div>
          </div>
        )}
        {/* 3D Viewer */}
        <CardViewer3D
          frontImage={enhancedCards.front}
          backImage={enhancedCards.back}
          grade={gradeResult?.grade?.grade}
          gradeLabel={gradeResult?.grade?.label}
          gradingCompany={gradingCompany}
          cardInfo={cardInfo}
          subgrades={gradeResult?.subgrades}
        />
        {/* Info text */}
        <div style={{
          position:"absolute",
          bottom:20,
          fontFamily:mono,
          fontSize:10,
          color:"#555",
          textAlign:"center",
        }}>
          AI-Enhanced with SAM 2 • Perfect edges & perspective correction
        </div>
      </div>
    )}
    {/* Profile Settings Modal */}
    {showSettings && (
      <ProfileSettings
        user={auth.user}
        profile={auth.profile}
        onClose={() => setShowSettings(false)}
        onProfileUpdate={auth.refreshProfile}
        onSignOut={auth.signOut}
      />
    )}
    {/* Disclaimer Modal */}
    {showDisclaimer&&(
      <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
        <div style={{background:"#0d0f13",borderRadius:12,border:"1px solid #2a2d35",maxWidth:400,padding:24}}>
          <div style={{fontFamily:mono,fontSize:12,color:"#ff9944",textTransform:"uppercase",marginBottom:12}}>Important Disclaimer</div>
          <div style={{fontSize:13,color:"#999",lineHeight:1.6,marginBottom:16}}>
            <strong style={{color:"#fff"}}>SlabSense</strong> is an independent card analysis tool. We are <strong style={{color:"#ff6633"}}>NOT affiliated</strong> with any professional grading company (PSA, BGS, CGC, SGC, TAG, etc.).
          </div>
          <div style={{fontSize:12,color:"#666",lineHeight:1.5,marginBottom:20}}>
            All grades shown are <strong style={{color:"#ff9944"}}>estimates only</strong>. Actual grades from professional services may vary significantly. Do not make financial decisions based solely on these estimates.
          </div>
          <button onClick={()=>setShowDisclaimer(false)} style={{width:"100%",padding:"12px 0",borderRadius:8,border:"none",background:"linear-gradient(135deg,#00ff88,#0088ff)",color:"#000",fontFamily:mono,fontSize:12,fontWeight:700,cursor:"pointer",textTransform:"uppercase"}}>I Understand</button>
        </div>
      </div>
    )}
    {/* Camera Viewfinder Overlay */}
    {camTarget&&<CameraViewfinder side={camTarget} onCapture={handleCam} onClose={()=>setCamTarget(null)}/>}
    {/* Header */}
    <div style={{padding:"14px 16px",borderBottom:"1px solid #1a1c22",display:"flex",alignItems:"center",justifyContent:"space-between",position:"sticky",top:0,zIndex:100,background:"#0a0b0e"}}>
      <div style={{display:"flex",alignItems:"center",gap:10}}>
        <div style={{width:30,height:30,borderRadius:7,background:"linear-gradient(135deg,#6366f1,#8b5cf6)",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:mono,fontWeight:900,fontSize:11,color:"#fff"}}>SS</div>
        <div><div style={{fontSize:14,fontWeight:600}}>SlabSense</div><div style={{fontFamily:mono,fontSize:9,color:"#444",textTransform:"uppercase",letterSpacing:".1em"}}>v0.1.0-beta</div></div>
      </div>
      <div style={{display:"flex",alignItems:"center",gap:8}}>
        {/* Grading Company Selector */}
        <select value={gradingCompany} onChange={e=>setGradingCompany(e.target.value)} style={{background:"#1a1c22",border:"1px solid #2a2d35",borderRadius:6,color:"#888",fontFamily:mono,fontSize:10,padding:"5px 8px",cursor:"pointer",textTransform:"uppercase"}}>
          {getCompanyOptions().map(c=>(<option key={c.id} value={c.id}>{c.name}</option>))}
        </select>
        {step===2&&<button onClick={reset} style={{background:"transparent",border:"1px solid #2a2d35",borderRadius:6,color:"#666",fontFamily:mono,fontSize:10,padding:"5px 10px",cursor:"pointer",textTransform:"uppercase"}}>New</button>}
        {/* Auth UI */}
        {auth.isConfigured && (
          auth.isAuthenticated ? (
            <UserMenu user={auth.user} profile={auth.profile} onSignOut={auth.signOut} onOpenCollection={() => setShowCollection(true)} onOpenSettings={() => setShowSettings(true)} />
          ) : (
            <button onClick={() => setShowAuthModal(true)} style={{background:"linear-gradient(135deg,#6366f1,#8b5cf6)",border:"none",borderRadius:6,color:"#fff",fontFamily:mono,fontSize:10,padding:"6px 12px",cursor:"pointer",textTransform:"uppercase"}}>Sign In</button>
          )
        )}
      </div>
    </div>

    {/* UNIFIED TAB BAR */}
    <div style={{display:"flex",borderBottom:"1px solid #1a1c22",background:"#0a0b0e",position:"sticky",top:54,zIndex:99}}>
      {tabs.map(t=>{
        const isActive = tab===t.id;
        const isAnalysis = t.analysis;
        const hasResults = step===2 && !!gr;
        const isDisabled = isAnalysis && !hasResults;
        const activeColor = hasResults && gr?.grade?.color ? gr.grade.color : "#6366f1";
        return(
          <button key={t.id} onClick={()=>!isDisabled && setTab(t.id)} style={{
            flex:1,
            padding:"10px 0 8px",
            background:"transparent",
            border:"none",
            borderBottom:isActive?`2px solid ${activeColor}`:"2px solid transparent",
            color:isDisabled?"#333":isActive?"#ddd":"#666",
            fontFamily:mono,
            fontSize:9,
            cursor:isDisabled?"default":"pointer",
            textTransform:"uppercase",
            display:"flex",
            flexDirection:"column",
            alignItems:"center",
            gap:2,
            opacity:isDisabled?0.4:1,
            transition:"all .2s",
          }}>
            <span style={{fontSize:14}}>{t.i}</span>
            {t.l}
          </button>
        );
      })}
    </div>

    {/* CAPTURE - Vertical Layout */}
    {tab==="scan"&&step===0&&(<div style={{padding:16,flex:1}}>
      {/* Vertical stack of capture cards */}
      <div style={{display:"flex",flexDirection:"column",gap:12,marginBottom:16}}>
        <CaptureCardVertical label="Front" side="front" image={fI} onImage={handleSetFrontImage} onOpenCamera={setCamTarget} quality={frontQuality}/>
        <CaptureCardVertical label="Back" side="back" image={bI} onImage={handleSetBackImage} onOpenCamera={setCamTarget} quality={backQuality}/>
      </div>
      <button onClick={run} disabled={!fI||!bI} style={{width:"100%",padding:"14px 0",borderRadius:10,border:"none",background:fI&&bI?"linear-gradient(135deg,#00ff88,#0088ff)":"#1a1c22",color:fI&&bI?"#000":"#444",fontFamily:mono,fontSize:13,fontWeight:700,cursor:fI&&bI?"pointer":"default",textTransform:"uppercase",letterSpacing:".08em",transition:"all .3s"}}>{fI&&bI?"▶  Analyze Card":"Capture both sides"}</button>
      <div style={{marginTop:16,padding:14,background:"#0d0f13",borderRadius:8,border:"1px solid #1a1c22"}}>
        <div style={{fontFamily:mono,fontSize:10,color:"#6366f1",textTransform:"uppercase",marginBottom:6}}>Multi-Company Grade Estimation</div>
        <div style={{fontSize:12,color:"#666",lineHeight:1.7}}>
          Analyze cards against <span style={{color:"#ff9944"}}>{GRADING_COMPANIES[gradingCompany]?.name || 'TAG'}</span> grading standards.
          Detects centering, corners, edges, and surface defects. Front defects weighted ~2x heavier than back.
          Holo card detection adjusts thresholds automatically.
        </div>
        <div style={{marginTop:8,fontSize:10,color:"#555",fontStyle:"italic"}}>
          Select grading company in header to compare against different scales.
        </div>
      </div>
    </div>)}

    {/* ANALYZING */}
    {tab==="scan"&&step===1&&(<div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:32}}>
      <div style={{width:48,height:48,borderRadius:"50%",border:"3px solid #1a1c22",borderTopColor:"#00ff88",animation:"spin .8s linear infinite"}}/>
      <div style={{fontFamily:mono,fontSize:12,color:"#666",marginTop:16}}>{prog}</div>
      <style>{`@keyframes spin{to{transform:rotate(360deg);}}`}</style>
    </div>)}

    {/* SCAN TAB - After Analysis Complete */}
    {tab==="scan"&&step===2&&(<div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:32}}>
      <div style={{textAlign:"center",marginBottom:24}}>
        <div style={{fontSize:48,marginBottom:12}}>✓</div>
        <div style={{fontFamily:sans,fontSize:18,fontWeight:600,color:"#00ff88",marginBottom:4}}>Analysis Complete</div>
        <div style={{fontFamily:mono,fontSize:12,color:"#666"}}>View results in Grade tab</div>
      </div>
      <button onClick={()=>{setStep(0);setFI(null);setBI(null);setGr(null);setFR(null);setBR(null);setCardInfo(null);setAiCentering(null);setAiCondition(null);setAiGradingNotes(null);setAiSummary(null);setEnhancingStatus('idle');setSavingStatus('idle');}} style={{
        padding:"14px 32px",borderRadius:10,border:"none",
        background:"linear-gradient(135deg,#6366f1,#8b5cf6)",
        color:"#fff",fontFamily:mono,fontSize:13,fontWeight:700,cursor:"pointer",
        textTransform:"uppercase",letterSpacing:".08em"
      }}>◎ Scan New Card</button>
    </div>)}

    {/* GRADE TAB */}
    {tab==="grade"&&step===2&&gr&&(<div style={{flex:1,padding:16,overflowY:"auto"}}>
          {/* Card Info Header */}
          <div style={{marginBottom:16,textAlign:"center"}}>
            <div style={{fontFamily:sans,fontSize:20,fontWeight:700,color:"#fff",marginBottom:4}}>
              {cardInfo?.name || "Unknown Card"}
            </div>
            <div style={{fontFamily:mono,fontSize:11,color:"#888"}}>
              {cardInfo?.year && `${cardInfo.year} `}
              {cardInfo?.setName || ""}
              {cardInfo?.cardNumber && ` #${cardInfo.cardNumber}`}
            </div>
            {cardInfo?.rarity && (
              <div style={{fontFamily:mono,fontSize:10,color:"#fbbf24",marginTop:4}}>{cardInfo.rarity}</div>
            )}
          </div>

          {/* Score + Grade Display - Company specific */}
          <div style={{display:"flex",justifyContent:"center",alignItems:"center",gap:16,marginBottom:16,padding:20,background:"#0d0f13",borderRadius:10,border:`1px solid ${gr?.grade?.color || '#666'}33`}}>
            {/* TAG: Show raw score */}
            {gradingCompany === 'tag' && gr?.rawScore !== undefined && (
              <div style={{textAlign:"center"}}>
                <div style={{fontFamily:mono,fontSize:32,fontWeight:800,color:"#888"}}>{gr.rawScore}</div>
                <div style={{fontFamily:mono,fontSize:9,color:"#555"}}>/ 1000</div>
              </div>
            )}
            {/* Grade Number */}
            <div style={{textAlign:"center"}}>
              <div style={{fontFamily:mono,fontSize:48,fontWeight:900,color:gr?.grade?.color || '#00ff88'}}>{gr?.grade?.grade ?? '--'}</div>
              <div style={{fontFamily:mono,fontSize:12,fontWeight:600,color:gr?.grade?.color || '#00ff88',marginTop:2}}>{gr?.grade?.label || 'Grade'}</div>
            </div>
            {/* Company Badge */}
            <div style={{padding:"8px 12px",background:`${gr?.grade?.color || '#666'}15`,borderRadius:8,border:`1px solid ${gr?.grade?.color || '#666'}33`}}>
              <div style={{fontFamily:mono,fontSize:11,fontWeight:700,color:gr?.grade?.color || '#666'}}>{GRADING_COMPANIES[gradingCompany]?.name || 'TAG'}</div>
            </div>
          </div>

          {/* Front + Back Card Images with Intensity Blend */}
          <div style={{display:"flex",gap:8,marginBottom:12}}>
            <div style={{flex:1,aspectRatio:"2.5/3.5",borderRadius:8,overflow:"hidden",background:"#0a0a0a",position:"relative"}}>
              {/* Base normal image */}
              <img src={fI} style={{width:"100%",height:"100%",objectFit:"contain",position:"absolute",inset:0}}/>
              {/* Filtered overlay with intensity */}
              {visionMode!=='normal'&&fM?.[visionMode]&&(
                <img src={fM[visionMode]} style={{width:"100%",height:"100%",objectFit:"contain",position:"absolute",inset:0,opacity:visionIntensity/100}}/>
              )}
              <div style={{position:"absolute",bottom:4,left:4,fontFamily:mono,fontSize:8,color:"#555",background:"rgba(0,0,0,0.7)",padding:"2px 6px",borderRadius:4,zIndex:1}}>FRONT</div>
            </div>
            <div style={{flex:1,aspectRatio:"2.5/3.5",borderRadius:8,overflow:"hidden",background:"#0a0a0a",position:"relative"}}>
              {/* Base normal image */}
              <img src={bI} style={{width:"100%",height:"100%",objectFit:"contain",position:"absolute",inset:0}}/>
              {/* Filtered overlay with intensity */}
              {visionMode!=='normal'&&bM?.[visionMode]&&(
                <img src={bM[visionMode]} style={{width:"100%",height:"100%",objectFit:"contain",position:"absolute",inset:0,opacity:visionIntensity/100}}/>
              )}
              <div style={{position:"absolute",bottom:4,right:4,fontFamily:mono,fontSize:8,color:"#555",background:"rgba(0,0,0,0.7)",padding:"2px 6px",borderRadius:4,zIndex:1}}>BACK</div>
            </div>
          </div>

          {/* Vision Intensity Slider */}
          <div style={{marginBottom:10}}>
            <input type="range" min="0" max="100" value={visionIntensity} onChange={e=>setVisionIntensity(Number(e.target.value))}
              style={{width:"100%",height:6,borderRadius:3,background:`linear-gradient(90deg,#6366f1 ${visionIntensity}%,#1a1c22 ${visionIntensity}%)`,appearance:"none",cursor:"pointer"}}/>
            <style>{`input[type=range]::-webkit-slider-thumb{appearance:none;width:14px;height:14px;borderRadius:50%;background:#8b5cf6;cursor:pointer;border:2px solid #0a0b0e;}`}</style>
          </div>

          {/* Vision Mode Buttons */}
          <div style={{display:"flex",gap:6,marginBottom:12}}>
            {[['normal','Normal'],['emboss','Emboss'],['hiPass','Hi-Pass'],['edges','Edges']].map(([mode,label])=>(
              <button key={mode} onClick={()=>setVisionMode(mode)} style={{
                flex:1,padding:"8px 0",borderRadius:6,
                border:visionMode===mode?"1px solid #6366f1":"1px solid #2a2d35",
                background:visionMode===mode?"rgba(99,102,241,0.15)":"transparent",
                color:visionMode===mode?"#8b5cf6":"#666",
                fontFamily:mono,fontSize:9,cursor:"pointer",textTransform:"uppercase"
              }}>{label}</button>
            ))}
          </div>

          {/* Compact Action Icons */}
          <div style={{display:"flex",justifyContent:"center",gap:24,marginBottom:16}}>
            {auth.isAuthenticated && (
              <button onClick={handleSaveScan} disabled={savingStatus==='saving'} title="Save to Collection" style={{
                background:"transparent",border:"none",cursor:"pointer",padding:8,color:savingStatus==='saved'?"#00ff88":"#666",fontSize:20,transition:"color .2s"
              }}>{savingStatus==='saving'?"⏳":savingStatus==='saved'?"✓":"💾"}</button>
            )}
            <button onClick={()=>setShowExport(true)} title="Share / Export" style={{
              background:"transparent",border:"none",cursor:"pointer",padding:8,color:"#666",fontSize:18,transition:"color .2s"
            }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 16v4h16v-4"/><path d="M12 4v12"/><path d="M8 8l4-4 4 4"/>
              </svg>
            </button>
            <button onClick={handleEnhanceCards} disabled={enhancingStatus==='enhancing'||enhancingStatus==='done'} title="AI Grade ($0.03)" style={{
              background:"transparent",border:"none",cursor:enhancingStatus==='enhancing'?"wait":"pointer",padding:4,transition:"opacity .2s",opacity:enhancingStatus==='done'?0.5:1
            }}>
              {enhancingStatus==='enhancing'?<span style={{fontSize:18,color:"#666"}}>⏳</span>:enhancingStatus==='done'?<span style={{fontSize:18,color:"#00ff88"}}>✓</span>:(
                <div style={{display:"flex",flexDirection:"column",alignItems:"center",lineHeight:1.1}}>
                  <span style={{fontFamily:mono,fontSize:12,fontWeight:700,color:"#8b5cf6"}}>AI</span>
                  <span style={{fontFamily:mono,fontSize:9,fontWeight:600,color:"#6366f1"}}>Grade</span>
                </div>
              )}
            </button>
            <button onClick={handle3DView} disabled={croppingFor3D} title="3D Slab View ($0.02)" style={{
              background:"transparent",border:"none",cursor:croppingFor3D?"wait":"pointer",padding:4,color:enhancedCards?"#8b5cf6":"#666",transition:"color .2s"
            }}>
              {croppingFor3D?<span style={{fontSize:18}}>⏳</span>:(
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <rect x="3" y="5" width="18" height="14" rx="2" fill="none"/>
                  <rect x="5" y="7" width="14" height="10" rx="1" fill="currentColor" opacity="0.15"/>
                  <line x1="3" y1="8" x2="21" y2="8" strokeWidth="1"/>
                </svg>
              )}
            </button>
          </div>

          {/* 4 Score Boxes */}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:16}}>
            <div style={{padding:12,background:"#0d0f13",borderRadius:8,border:"1px solid #1a1c22"}}>
              <div style={{fontFamily:mono,fontSize:8,color:"#666",marginBottom:4}}>CORNERS</div>
              <div style={{fontFamily:mono,fontSize:18,fontWeight:700,color:aiCondition?.corners>=9?"#00ff88":aiCondition?.corners>=7?"#ffcc00":"#ff6633"}}>{aiCondition?.corners || fR?.corners?.score || "--"}</div>
            </div>
            <div style={{padding:12,background:"#0d0f13",borderRadius:8,border:"1px solid #1a1c22"}}>
              <div style={{fontFamily:mono,fontSize:8,color:"#666",marginBottom:4}}>EDGES</div>
              <div style={{fontFamily:mono,fontSize:18,fontWeight:700,color:aiCondition?.edges>=9?"#00ff88":aiCondition?.edges>=7?"#ffcc00":"#ff6633"}}>{aiCondition?.edges || fR?.edges?.score || "--"}</div>
            </div>
            <div style={{padding:12,background:"#0d0f13",borderRadius:8,border:"1px solid #1a1c22"}}>
              <div style={{fontFamily:mono,fontSize:8,color:"#666",marginBottom:4}}>SURFACE</div>
              <div style={{fontFamily:mono,fontSize:18,fontWeight:700,color:aiCondition?.surface>=9?"#00ff88":aiCondition?.surface>=7?"#ffcc00":"#ff6633"}}>{aiCondition?.surface || "--"}</div>
            </div>
            <div style={{padding:12,background:"#0d0f13",borderRadius:8,border:"1px solid #1a1c22"}}>
              <div style={{fontFamily:mono,fontSize:8,color:"#666",marginBottom:4}}>CENTERING</div>
              <div style={{fontFamily:mono,fontSize:14,fontWeight:700,color:"#00ff88"}}>{fR?.centering?.lrRatio||50}/{100-(fR?.centering?.lrRatio||50)}</div>
            </div>
          </div>

          {/* Total Dings */}
          {gr?.totalDings !== undefined && (
            <div style={{padding:14,background:"#0d0f13",borderRadius:10,border:"1px solid #1a1c22",marginBottom:12}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <span style={{fontFamily:mono,fontSize:11,color:"#888"}}>Total DINGS</span>
                <span style={{fontFamily:mono,fontSize:20,fontWeight:800,color:(gr?.totalDings||0)===0?"#00ff88":(gr?.totalDings||0)<=2?"#66dd44":(gr?.totalDings||0)<=4?"#ffcc00":"#ff6633"}}>{gr?.totalDings ?? 0}</span>
              </div>
            </div>
          )}

          {/* Grade Analysis */}
          {gr?.rawScore !== undefined && (
            <div style={{padding:14,background:"#0d0f13",borderRadius:10,border:"1px solid #1a1c22",marginBottom:12}}>
              <div style={{fontFamily:mono,fontSize:10,color:"#888",textTransform:"uppercase",marginBottom:8}}>Grade Analysis</div>
              {(getNextGradeInfo(gr)||[]).map((tip,i,arr)=>(
                <div key={i} style={{display:"flex",gap:8,marginBottom:i<arr.length-1?8:0}}>
                  <div style={{width:3,borderRadius:2,background:tip?.color||'#666',flexShrink:0,marginTop:2}}/>
                  <div style={{fontFamily:sans,fontSize:12,color:"#aaa",lineHeight:1.5}}>{tip?.text||''}</div>
                </div>
              ))}
            </div>
          )}

          {/* Confidence Notes */}
          {gr && fR && bR && (()=>{
            try {
              const conf=calcConfidence(gr,fR,bR);
              return conf?.reasons?.length>0?(
                <div style={{padding:14,background:"#0d0f13",borderRadius:10,border:`1px solid ${conf.color||'#666'}22`,marginBottom:12}}>
                  <div style={{fontFamily:mono,fontSize:10,color:conf.color||'#666',textTransform:"uppercase",marginBottom:8}}>Confidence Notes</div>
                  {conf.reasons.map((r,i)=>(
                    <div key={i} style={{fontFamily:sans,fontSize:11,color:"#777",marginBottom:4}}>• {r}</div>
                  ))}
                </div>
              ):null;
            } catch(e) { return null; }
          })()}

          {/* TAG 8 Subgrades (DIG Report Style) */}
          {gradingCompany === 'tag' && aiGrades?.tag?.subgrades && (
            <div style={{padding:14,background:"#0d0f13",borderRadius:10,border:"1px solid #8b5cf633",marginBottom:12}}>
              <div style={{fontFamily:mono,fontSize:10,color:"#8b5cf6",textTransform:"uppercase",marginBottom:10}}>TAG DIG Subgrades (8 Categories)</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
                {[
                  {k:"frontCentering",l:"Front Centering"},
                  {k:"backCentering",l:"Back Centering"},
                  {k:"frontCorners",l:"Front Corners"},
                  {k:"backCorners",l:"Back Corners"},
                  {k:"frontEdges",l:"Front Edges"},
                  {k:"backEdges",l:"Back Edges"},
                  {k:"frontSurface",l:"Front Surface"},
                  {k:"backSurface",l:"Back Surface"},
                ].map(({k,l})=>{
                  const val = aiGrades.tag.subgrades?.[k];
                  if(val==null)return null;
                  const color = val>=120?"#00ff88":val>=100?"#66dd44":val>=80?"#ffcc00":"#ff6633";
                  return(<div key={k} style={{display:"flex",justifyContent:"space-between",padding:"6px 10px",background:"#0a0b0e",borderRadius:6}}>
                    <span style={{fontFamily:mono,fontSize:9,color:"#666"}}>{l}</span>
                    <span style={{fontFamily:mono,fontSize:11,fontWeight:600,color}}>{val}</span>
                  </div>);
                })}
              </div>
            </div>
          )}

          {/* BGS 4 Subgrades */}
          {gradingCompany === 'bgs' && aiGrades?.bgs?.subgrades && (
            <div style={{padding:14,background:"#0d0f13",borderRadius:10,border:"1px solid #ffd93d33",marginBottom:12}}>
              <div style={{fontFamily:mono,fontSize:10,color:"#ffd93d",textTransform:"uppercase",marginBottom:10}}>BGS Subgrades</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
                {[
                  {k:"centering",l:"Centering"},
                  {k:"corners",l:"Corners"},
                  {k:"edges",l:"Edges"},
                  {k:"surface",l:"Surface"},
                ].map(({k,l})=>{
                  const val = aiGrades.bgs.subgrades?.[k];
                  if(val==null)return null;
                  const color = val>=9.5?"#00ff88":val>=9?"#66dd44":val>=8?"#ffcc00":"#ff6633";
                  return(<div key={k} style={{display:"flex",justifyContent:"space-between",padding:"6px 10px",background:"#0a0b0e",borderRadius:6}}>
                    <span style={{fontFamily:mono,fontSize:9,color:"#666"}}>{l}</span>
                    <span style={{fontFamily:mono,fontSize:12,fontWeight:600,color}}>{val}</span>
                  </div>);
                })}
              </div>
            </div>
          )}

          {/* CGC 4 Subgrades */}
          {gradingCompany === 'cgc' && aiGrades?.cgc?.subgrades && (
            <div style={{padding:14,background:"#0d0f13",borderRadius:10,border:"1px solid #4d96ff33",marginBottom:12}}>
              <div style={{fontFamily:mono,fontSize:10,color:"#4d96ff",textTransform:"uppercase",marginBottom:10}}>CGC Subgrades</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
                {[
                  {k:"centering",l:"Centering"},
                  {k:"corners",l:"Corners"},
                  {k:"edges",l:"Edges"},
                  {k:"surface",l:"Surface"},
                ].map(({k,l})=>{
                  const val = aiGrades.cgc.subgrades?.[k];
                  if(val==null)return null;
                  const color = val>=9.5?"#00ff88":val>=9?"#66dd44":val>=8?"#ffcc00":"#ff6633";
                  return(<div key={k} style={{display:"flex",justifyContent:"space-between",padding:"6px 10px",background:"#0a0b0e",borderRadius:6}}>
                    <span style={{fontFamily:mono,fontSize:9,color:"#666"}}>{l}</span>
                    <span style={{fontFamily:mono,fontSize:12,fontWeight:600,color}}>{val}</span>
                  </div>);
                })}
              </div>
            </div>
          )}

          {/* AI Centering Measurements */}
          {aiCentering && (
            <div style={{padding:14,background:"#0d0f13",borderRadius:10,border:"1px solid #1a1c22",marginBottom:12}}>
              <div style={{fontFamily:mono,fontSize:10,color:"#666",textTransform:"uppercase",marginBottom:10}}>Centering Measurements</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                <div style={{padding:"8px 10px",background:"#0a0b0e",borderRadius:6}}>
                  <div style={{fontFamily:mono,fontSize:9,color:"#666",marginBottom:4}}>FRONT</div>
                  <div style={{fontFamily:mono,fontSize:11,color:"#00ff88"}}>{aiCentering.front?.leftRight || "50/50"} L/R</div>
                  <div style={{fontFamily:mono,fontSize:11,color:"#00ff88"}}>{aiCentering.front?.topBottom || "50/50"} T/B</div>
                </div>
                <div style={{padding:"8px 10px",background:"#0a0b0e",borderRadius:6}}>
                  <div style={{fontFamily:mono,fontSize:9,color:"#666",marginBottom:4}}>BACK</div>
                  <div style={{fontFamily:mono,fontSize:11,color:"#00ff88"}}>{aiCentering.back?.leftRight || "50/50"} L/R</div>
                  <div style={{fontFamily:mono,fontSize:11,color:"#00ff88"}}>{aiCentering.back?.topBottom || "50/50"} T/B</div>
                </div>
              </div>
            </div>
          )}

          {/* AI Condition Assessment */}
          {aiCondition && (
            <div style={{padding:14,background:"#0d0f13",borderRadius:10,border:"1px solid #1a1c22",marginBottom:12}}>
              <div style={{fontFamily:mono,fontSize:10,color:"#666",textTransform:"uppercase",marginBottom:10}}>Condition Assessment</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
                {aiCondition.corners!=null&&(<div style={{display:"flex",justifyContent:"space-between",padding:"6px 10px",background:"#0a0b0e",borderRadius:6}}>
                  <span style={{fontFamily:mono,fontSize:9,color:"#666"}}>Corners</span>
                  <span style={{fontFamily:mono,fontSize:11,fontWeight:600,color:aiCondition.corners>=9?"#00ff88":aiCondition.corners>=7?"#ffcc00":"#ff6633"}}>{aiCondition.corners}/10</span>
                </div>)}
                {aiCondition.edges!=null&&(<div style={{display:"flex",justifyContent:"space-between",padding:"6px 10px",background:"#0a0b0e",borderRadius:6}}>
                  <span style={{fontFamily:mono,fontSize:9,color:"#666"}}>Edges</span>
                  <span style={{fontFamily:mono,fontSize:11,fontWeight:600,color:aiCondition.edges>=9?"#00ff88":aiCondition.edges>=7?"#ffcc00":"#ff6633"}}>{aiCondition.edges}/10</span>
                </div>)}
                {aiCondition.surface!=null&&(<div style={{display:"flex",justifyContent:"space-between",padding:"6px 10px",background:"#0a0b0e",borderRadius:6}}>
                  <span style={{fontFamily:mono,fontSize:9,color:"#666"}}>Surface</span>
                  <span style={{fontFamily:mono,fontSize:11,fontWeight:600,color:aiCondition.surface>=9?"#00ff88":aiCondition.surface>=7?"#ffcc00":"#ff6633"}}>{aiCondition.surface}/10</span>
                </div>)}
                {aiCondition.centering!=null&&(<div style={{display:"flex",justifyContent:"space-between",padding:"6px 10px",background:"#0a0b0e",borderRadius:6}}>
                  <span style={{fontFamily:mono,fontSize:9,color:"#666"}}>Centering</span>
                  <span style={{fontFamily:mono,fontSize:11,fontWeight:600,color:aiCondition.centering>=9?"#00ff88":aiCondition.centering>=7?"#ffcc00":"#ff6633"}}>{aiCondition.centering}/10</span>
                </div>)}
              </div>
              {aiCondition.defects?.length > 0 && (
                <div style={{marginTop:10}}>
                  <div style={{fontFamily:mono,fontSize:9,color:"#ff9944",marginBottom:4}}>DEFECTS NOTED</div>
                  {aiCondition.defects.map((d,i)=>(<div key={i} style={{fontFamily:sans,fontSize:11,color:"#888",marginBottom:2}}>• {d}</div>))}
                </div>
              )}
            </div>
          )}

          {/* AI Summary - Positives, Concerns, Recommendation */}
          {(aiGradingNotes?.positives?.length > 0 || aiGradingNotes?.concerns?.length > 0 || aiSummary?.recommendation) && (
            <div style={{padding:14,background:"linear-gradient(135deg, #0d0f13 0%, #12141a 100%)",borderRadius:10,border:"1px solid rgba(139,92,246,0.3)",marginBottom:12}}>
              <div style={{fontFamily:mono,fontSize:10,color:"#8b5cf6",textTransform:"uppercase",marginBottom:10}}>AI Analysis Summary</div>
              {aiGradingNotes?.positives?.length > 0 && (
                <div style={{marginBottom:10}}>
                  <div style={{fontFamily:mono,fontSize:9,color:"#00ff88",marginBottom:6}}>✓ POSITIVES</div>
                  {aiGradingNotes.positives.map((p,i)=>(<div key={i} style={{fontFamily:sans,fontSize:12,color:"#aaa",paddingLeft:12,marginBottom:3}}>• {p}</div>))}
                </div>
              )}
              {aiGradingNotes?.concerns?.length > 0 && (
                <div style={{marginBottom:10}}>
                  <div style={{fontFamily:mono,fontSize:9,color:"#ff9944",marginBottom:6}}>⚠ CONCERNS</div>
                  {aiGradingNotes.concerns.map((c,i)=>(<div key={i} style={{fontFamily:sans,fontSize:12,color:"#999",paddingLeft:12,marginBottom:3}}>• {c}</div>))}
                </div>
              )}
              {aiSummary?.recommendation && (
                <div style={{padding:"10px 12px",background:"rgba(0,255,136,0.05)",borderRadius:8,border:"1px solid rgba(0,255,136,0.2)"}}>
                  <div style={{fontFamily:mono,fontSize:9,color:"#00ff88",marginBottom:6}}>💡 RECOMMENDATION</div>
                  <div style={{fontFamily:sans,fontSize:12,color:"#aaa",lineHeight:1.5}}>{aiSummary.recommendation}</div>
                </div>
              )}
            </div>
          )}

    </div>)}

    {/* DINGS TAB */}
    {tab==="dings"&&step===2&&gr&&fR&&bR&&(<div style={{flex:1,padding:16,overflowY:"auto"}}>
          {/* DINGS Count */}
          <div style={{textAlign:"center",padding:16,marginBottom:12,background:"#0d0f13",borderRadius:10,border:"1px solid #1a1c22"}}>
            <div style={{fontFamily:mono,fontSize:9,color:"#555",textTransform:"uppercase",letterSpacing:".12em",marginBottom:4}}>Defects Identified of Notable Grade Significance</div>
            <div style={{fontFamily:mono,fontSize:36,fontWeight:800,color:gr.totalDings===0?"#00ff88":gr.totalDings<=2?"#66dd44":gr.totalDings<=4?"#ffcc00":"#ff6633"}}>{gr.totalDings}</div>
            <div style={{fontFamily:mono,fontSize:10,color:"#444"}}>DINGS</div>
          </div>

          {/* DEFECT MAP */}
          <div style={{marginBottom:16}}>
            <div style={{fontFamily:mono,fontSize:10,color:"#555",textTransform:"uppercase",marginBottom:8}}>Defect Map</div>
            <DingsMap frontResult={fR} backResult={bR}/>
          </div>

          {/* CORNERS DETAIL */}
          <div style={{marginBottom:16,padding:14,background:"#0d0f13",borderRadius:10,border:"1px solid #1a1c22"}}>
            <div style={{fontFamily:mono,fontSize:10,color:"#888",textTransform:"uppercase",marginBottom:10}}>Corners</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
              {[["Front",fR],["Back",bR]].map(([side,r])=>(
                <div key={side}>
                  <div style={{fontFamily:mono,fontSize:8,color:"#666",marginBottom:6}}>{side}</div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:4}}>
                    {r.corners?.details?.map(c=>(
                      <div key={c.name} style={{padding:6,background:"rgba(0,0,0,.3)",borderRadius:4,borderLeft:`2px solid ${c.hasDing?"#ff6633":"#333"}`}}>
                        <div style={{fontFamily:mono,fontSize:9,color:c.hasDing?"#ff9944":"#777"}}>{c.name}</div>
                        <div style={{fontFamily:mono,fontSize:8,color:"#555"}}>F:{c.fray} W:{c.whiteRatio}%</div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* EDGES DETAIL */}
          <div style={{marginBottom:16,padding:14,background:"#0d0f13",borderRadius:10,border:"1px solid #1a1c22"}}>
            <div style={{fontFamily:mono,fontSize:10,color:"#888",textTransform:"uppercase",marginBottom:10}}>Edges</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
              {[["Front",fR],["Back",bR]].map(([side,r])=>(
                <div key={side}>
                  <div style={{fontFamily:mono,fontSize:8,color:"#666",marginBottom:6}}>{side}</div>
                  {r.edges?.details?.map(e=>(
                    <div key={e.name} style={{padding:6,marginBottom:4,background:"rgba(0,0,0,.3)",borderRadius:4,borderLeft:`2px solid ${e.hasDing?"#ff6633":"#333"}`}}>
                      <div style={{fontFamily:mono,fontSize:9,color:e.hasDing?"#ff9944":"#777"}}>{e.name}</div>
                      <div style={{fontFamily:mono,fontSize:8,color:"#555"}}>F:{e.fray} W:{e.whiteRatio}%</div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>

          {/* DEFECT LIST */}
          {gr.allDings.length>0?(
            <div style={{marginBottom:14}}>
              <div style={{fontFamily:mono,fontSize:10,color:"#555",textTransform:"uppercase",marginBottom:8}}>Defect Details</div>
              {gr.allDings.map((d,i)=>(
                <div key={i} style={{padding:"10px 12px",marginBottom:6,background:"#0d0f13",borderRadius:8,border:"1px solid #1a1c22",borderLeft:"3px solid #ff6633"}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
                    <span style={{fontFamily:mono,fontSize:11,color:"#ff9944",fontWeight:600}}>{d.location}</span>
                    <span style={{fontFamily:mono,fontSize:9,color:"#555",textTransform:"uppercase"}}>{d.type}</span>
                  </div>
                  {d.desc&&<div style={{fontFamily:sans,fontSize:12,color:"#888"}}>{d.desc}</div>}
                </div>
              ))}
            </div>
          ):(
            <div style={{padding:16,background:"rgba(0,255,136,.05)",borderRadius:8,border:"1px solid rgba(0,255,136,.15)",marginBottom:14}}>
              <div style={{fontFamily:mono,fontSize:12,color:"#00ff88"}}>No DINGS detected — potential Gem Mint candidate</div>
            </div>
          )}
    </div>)}

    {/* CENTERING TAB */}
    {tab==="centering"&&step===2&&gr&&fR&&bR&&(<div style={{flex:1,padding:16,overflowY:"auto"}}>
          {/* Manual Adjust toggle buttons */}
          <div style={{display:"flex",gap:8,marginBottom:14}}>
            {[["front","Front",fR,fI],["back","Back",bR,bI]].map(([s,sl,r,img])=>(
              <button key={s} onClick={()=>setManualMode(manualMode===s?null:s)}
                style={{flex:1,padding:"9px 0",borderRadius:7,
                  border:`1px solid ${manualMode===s?"#ff9944":"#333"}`,
                  background:manualMode===s?"rgba(255,153,68,.1)":"transparent",
                  color:manualMode===s?"#ff9944":"#666",
                  fontFamily:mono,fontSize:10,cursor:"pointer",textTransform:"uppercase",letterSpacing:".06em"}}>
                {manualMode===s?"✕ Close":"✦ Adjust Borders"} {sl}
              </button>
            ))}
          </div>

          {/* Manual editors */}
          {manualMode==="front"&&fR&&fI&&(
            <ManualBoundaryEditor image={fI} result={fR} side="Front"
              onApply={(bounds,centering)=>{applyManualCorrection("front",bounds,centering);setCenteringConfirmed(true);}}/>
          )}
          {manualMode==="back"&&bR&&bI&&(
            <ManualBoundaryEditor image={bI} result={bR} side="Back"
              onApply={(bounds,centering)=>{applyManualCorrection("back",bounds,centering);setCenteringConfirmed(true);}}/>
          )}

          {/* Confirm Alignment Button */}
          {!centeringConfirmed && (
            <button
              onClick={()=>setCenteringConfirmed(true)}
              style={{
                width:"100%",
                padding:"14px 0",
                marginBottom:16,
                borderRadius:8,
                border:"1px solid #00ff8844",
                background:"linear-gradient(135deg,rgba(0,255,136,0.1),rgba(0,255,136,0.05))",
                color:"#00ff88",
                fontFamily:mono,
                fontSize:12,
                fontWeight:600,
                cursor:"pointer",
                textTransform:"uppercase",
                letterSpacing:".05em",
              }}
            >
              ✓ Confirm Alignment & Calculate
            </button>
          )}

          {/* Centering Results - Only show after confirmation */}
          {centeringConfirmed ? (
            <>
              {[["Front",fR,"front"],["Back",bR,"back"]].map(([s,r,side])=>{
                const maxOff=Math.max(Math.max(r.centering.lrRatio,100-r.centering.lrRatio),Math.max(r.centering.tbRatio,100-r.centering.tbRatio));
                const hasDing=r.centerDings.length>0;
                const companyThresh = GRADING_COMPANIES[gradingCompany]?.centeringThresholds?.[side]?.[10];
                const threshVal = typeof companyThresh === 'object' ? (companyThresh.gem || companyThresh.pristine) : companyThresh;
                const threshDisplay = threshVal ? `${threshVal}/${100-threshVal}` : (side==="front"?"55/45":"65/35");
                return(<div key={s} style={{marginBottom:16,padding:14,background:"#0d0f13",borderRadius:10,border:`1px solid ${hasDing?"#ff663344":"#00ff8822"}`}}>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:10}}>
                    <span style={{fontFamily:mono,fontSize:11,color:"#00ff88",textTransform:"uppercase"}}>✓ {s} Centering</span>
                    {hasDing&&<span style={{fontFamily:mono,fontSize:10,color:"#ff6633",fontWeight:600}}>⚠ DING</span>}
                  </div>
                  <div style={{display:"flex",gap:16}}>
                    <div style={{flex:1}}><div style={{fontFamily:mono,fontSize:9,color:"#555",marginBottom:4}}>L / R</div><div style={{fontFamily:mono,fontSize:20,fontWeight:700,color:"#ccc"}}>{r.centering.lrRatio}/{Math.round((100-r.centering.lrRatio)*10)/10}</div></div>
                    <div style={{width:1,background:"#1a1c22"}}/>
                    <div style={{flex:1}}><div style={{fontFamily:mono,fontSize:9,color:"#555",marginBottom:4}}>T / B</div><div style={{fontFamily:mono,fontSize:20,fontWeight:700,color:"#ccc"}}>{r.centering.tbRatio}/{Math.round((100-r.centering.tbRatio)*10)/10}</div></div>
                  </div>
                  <div style={{marginTop:8,fontFamily:mono,fontSize:9,color:"#555"}}>
                    Worst axis: {maxOff.toFixed(1)}/{(100-maxOff).toFixed(1)} · {GRADING_COMPANIES[gradingCompany]?.name || 'TAG'} 10 threshold: {threshDisplay}
                  </div>
                </div>);
              })}

              {/* Reset Alignment */}
              <button
                onClick={()=>setCenteringConfirmed(false)}
                style={{
                  width:"100%",
                  padding:"10px 0",
                  marginBottom:14,
                  borderRadius:6,
                  border:"1px solid #333",
                  background:"transparent",
                  color:"#666",
                  fontFamily:mono,
                  fontSize:10,
                  cursor:"pointer",
                }}
              >
                ↺ Re-adjust Alignment
              </button>
            </>
          ) : (
            <div style={{padding:20,background:"rgba(255,153,68,0.05)",borderRadius:10,border:"1px solid rgba(255,153,68,0.2)",textAlign:"center",marginBottom:16}}>
              <div style={{fontFamily:mono,fontSize:11,color:"#ff9944",marginBottom:8}}>⚠ ALIGNMENT REQUIRED</div>
              <div style={{fontFamily:sans,fontSize:12,color:"#888",lineHeight:1.5}}>
                Adjust rotation and borders above, then click "Confirm Alignment" to calculate centering score.
              </div>
            </div>
          )}

          {/* Ignore Centering Option */}
          <div style={{marginBottom:14,padding:12,background:"#0d0f13",borderRadius:8,border:`1px solid ${ignoreCentering?"#ff994444":"#1a1c22"}`}}>
            <label style={{display:"flex",alignItems:"center",gap:10,cursor:"pointer"}}>
              <input
                type="checkbox"
                checked={ignoreCentering}
                onChange={e=>setIgnoreCentering(e.target.checked)}
                style={{width:16,height:16,accentColor:"#ff9944",cursor:"pointer"}}
              />
              <span style={{fontFamily:mono,fontSize:11,color:ignoreCentering?"#ff9944":"#888",textTransform:"uppercase",letterSpacing:".04em"}}>
                Ignore Centering in Grade
              </span>
            </label>
            {ignoreCentering&&(
              <div style={{marginTop:10,padding:10,background:"rgba(255,153,68,.08)",borderRadius:6,border:"1px solid rgba(255,153,68,.2)"}}>
                <div style={{fontFamily:mono,fontSize:10,color:"#ff9944",fontWeight:600,marginBottom:4}}>⚠ WARNING</div>
                <div style={{fontFamily:sans,fontSize:11,color:"#aa7744",lineHeight:1.4}}>
                  Centering is set to 50/50 (perfect) and will NOT affect the grade.
                </div>
              </div>
            )}
          </div>
    </div>)}

    {/* HOME TAB */}
    {tab==="home"&&(
      <HomeTab
        auth={auth}
        onOpenCollection={()=>setTab("cards")}
        onStartScan={()=>setTab("scan")}
        collectionStats={{totalCards:0,avgGrade:0}}
      />
    )}

    {/* COLLECTION TAB */}
    {tab==="cards"&&auth.isAuthenticated&&(
      <div style={{flex:1,overflowY:"auto"}}>
        <CollectionView
          userId={auth.user?.id}
          onClose={()=>setTab("scan")}
          isInline={true}
        />
      </div>
    )}
    {tab==="cards"&&!auth.isAuthenticated&&(
      <div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:32}}>
        <div style={{fontSize:48,marginBottom:16}}>🔒</div>
        <div style={{fontFamily:mono,fontSize:14,color:"#888",marginBottom:8}}>Sign in to view your collection</div>
        <button onClick={()=>setShowAuthModal(true)} style={{marginTop:16,padding:"12px 24px",borderRadius:8,border:"none",background:"linear-gradient(135deg,#6366f1,#8b5cf6)",color:"#fff",fontFamily:mono,fontSize:12,fontWeight:600,cursor:"pointer"}}>Sign In</button>
      </div>
    )}

    <div style={{padding:"10px 16px",borderTop:"1px solid #1a1c22",textAlign:"center"}}><div style={{fontFamily:mono,fontSize:8,color:"#333",textTransform:"uppercase",letterSpacing:".15em"}}>Pre-grade estimate · DINGS-based · Not affiliated with TAG</div></div>
    <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700;800;900&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet"/>
  </div>);
}
