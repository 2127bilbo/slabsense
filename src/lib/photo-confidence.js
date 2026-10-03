/*
 * SlabSense — https://www.slabsenseai.com
 * Copyright (c) 2026 SlabSense. All rights reserved.
 * Proprietary and confidential; see LICENSE at the repository root.
 */
/**
 * ============================================================================
 * PHOTO CONFIDENCE — photo-confidence.js
 * ============================================================================
 * How far a grade can be trusted, judged from the photo alone (owner, 2026-10-03). Pure: takes
 * RGBA pixels and the card's four corners (normalised 0..1, from the card model or the editor), so
 * it runs in the browser and in node (harness, tests).
 *
 * Measured, each 0 (fine) .. 1 (as bad as it gets), named like the medallion's lens layers:
 *   cutoff   a corner at or past the edge of the photo: the whole card is not there -> score 1.0
 *   glare    blown-out highlight patches on the card
 *   blur     soft card edges (10-90 % edge width across the card outline), Laplacian as a fallback
 *   dark     underexposed card
 *   fog      low contrast / haze on the card
 *   grain    sensor noise in the flattest parts of the card
 *   angle    perspective: opposite sides of different lengths, corners far from 90 degrees
 *   uneven   one side of the card lit much brighter than the other (border ring segments)
 *   small    the card covers too few pixels for detail
 *
 * score = 10 minus weighted penalties, floored at 1. The phone cap (9.4) and the rig's 10 are
 * applied by the caller from where the photo came from; this module reports the raw number.
 * The weights are starting values; they are tuned against the owner's card-val photos and TAG
 * studio images (scripts/harness/photo-confidence.mjs).
 * ============================================================================
 */

export const PHONE_CAP = 9.4;
/** blurEffect thresholds (0 sharp .. 1 blurred); set from the card-val + TAG calibration run. */
export let BLUR_GOOD = 0.27, BLUR_BAD = 0.5;   // TAG studio <= 0.26; owner-tagged "bad" photos 0.49-0.51
export const WEIGHTS = { glare: 3.0, blur: 3.4, dark: 2.4, fog: 2.0, grain: 1.2, angle: 1.6, uneven: 1.0, small: 1.6 };

const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const ramp = (v, good, bad) => clamp01((v - good) / (bad - good));   // 0 at good, 1 at bad (either direction)
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/** Sample the card's quad into a w x h RGBA rectangle (bilinear quad mapping, bilinear pixels). */
export function rectify(img, c, w, h) {
  const { data, width: W, height: H } = img;
  const out = new Uint8ClampedArray(w * h * 4);
  const P = { tl: { x: c.tl.x * W, y: c.tl.y * H }, tr: { x: c.tr.x * W, y: c.tr.y * H }, br: { x: c.br.x * W, y: c.br.y * H }, bl: { x: c.bl.x * W, y: c.bl.y * H } };
  for (let j = 0; j < h; j++) {
    const v = (j + 0.5) / h;
    for (let i = 0; i < w; i++) {
      const u = (i + 0.5) / w;
      const x = (1 - u) * (1 - v) * P.tl.x + u * (1 - v) * P.tr.x + u * v * P.br.x + (1 - u) * v * P.bl.x;
      const y = (1 - u) * (1 - v) * P.tl.y + u * (1 - v) * P.tr.y + u * v * P.br.y + (1 - u) * v * P.bl.y;
      const x0 = Math.max(0, Math.min(W - 2, Math.floor(x))), y0 = Math.max(0, Math.min(H - 2, Math.floor(y)));
      const fx = Math.max(0, Math.min(1, x - x0)), fy = Math.max(0, Math.min(1, y - y0));
      const o = (j * w + i) * 4;
      for (let k = 0; k < 3; k++) {
        const a = data[(y0 * W + x0) * 4 + k], b = data[(y0 * W + x0 + 1) * 4 + k], cc = data[((y0 + 1) * W + x0) * 4 + k], d = data[((y0 + 1) * W + x0 + 1) * 4 + k];
        out[o + k] = (a * (1 - fx) + b * fx) * (1 - fy) + (cc * (1 - fx) + d * fx) * fy;
      }
      out[o + 3] = 255;
    }
  }
  return { data: out, width: w, height: h };
}

function grayOf(img) {
  const g = new Float32Array(img.width * img.height);
  for (let i = 0; i < g.length; i++) g[i] = lum(img.data[i * 4], img.data[i * 4 + 1], img.data[i * 4 + 2]);
  return g;
}
function percentile(arr, p) { const s = Float32Array.from(arr).sort(); return s[Math.min(s.length - 1, Math.max(0, Math.floor(p * (s.length - 1))))]; }

/** Edge sharpness across the card outline in the ORIGINAL photo: median 10-90 % transition width
 *  in pixels at a scale where the card's short side is 800 px. Returns null when the background
 *  has too little contrast against the card to measure. */
function edgeWidth(img, c) {
  const { data, width: W, height: H } = img;
  const P = ['tl', 'tr', 'br', 'bl'].map((k) => ({ x: c[k].x * W, y: c[k].y * H }));
  const short = Math.min(dist(P[0], P[1]), dist(P[1], P[2]));
  const scale = short / 800;                                     // original px per normalised px
  const at = (x, y) => { const xi = Math.max(0, Math.min(W - 1, Math.round(x))), yi = Math.max(0, Math.min(H - 1, Math.round(y))), o = (yi * W + xi) * 4; return lum(data[o], data[o + 1], data[o + 2]); };
  const centre = { x: P.reduce((s, p) => s + p.x, 0) / 4, y: P.reduce((s, p) => s + p.y, 0) / 4 };
  const widths = [];
  for (let s = 0; s < 4; s++) {
    const a = P[s], b = P[(s + 1) % 4], len = dist(a, b);
    let nx = -(b.y - a.y) / len, ny = (b.x - a.x) / len;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    if ((centre.x - mid.x) * nx + (centre.y - mid.y) * ny > 0) { nx = -nx; ny = -ny; }   // normal points outward
    for (let t = 0.15; t <= 0.85; t += 0.02) {                    // skip the rounded corners
      const px = a.x + (b.x - a.x) * t, py = a.y + (b.y - a.y) * t;
      const N = 33, prof = [];
      for (let k = 0; k < N; k++) { const d = (k - (N - 1) / 2) * scale * 0.75; prof.push(at(px + nx * d, py + ny * d)); }
      const lo = Math.min(...prof), hi = Math.max(...prof), contrast = hi - lo;
      if (contrast < 28) continue;
      const v10 = lo + 0.1 * contrast, v90 = lo + 0.9 * contrast;
      const rising = prof[N - 1] > prof[0];
      const seq = rising ? prof : [...prof].reverse();
      let i10 = seq.findIndex((v) => v >= v10), i90 = seq.findIndex((v) => v >= v90);
      if (i10 < 0 || i90 < 0) continue;
      widths.push(Math.max(0.5, (i90 - i10) * 0.75));
    }
  }
  if (widths.length < 12) return null;
  widths.sort((x, y) => x - y);
  return widths[Math.floor(widths.length / 2)];
}

/** Laplacian variance on the rectified card, normalised by contrast: the fallback sharpness signal. */
function laplacianRatio(g, w, h) {
  let sum = 0, sum2 = 0, n = 0, gs = 0, gs2 = 0;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x, L = 4 * g[i] - g[i - 1] - g[i + 1] - g[i - w] - g[i + w];
    sum += L; sum2 += L * L; n++; gs += g[i]; gs2 += g[i] * g[i];
  }
  const varL = sum2 / n - (sum / n) ** 2, sd = Math.sqrt(Math.max(1, gs2 / n - (gs / n) ** 2));
  return Math.sqrt(Math.max(0, varL)) / sd;
}

/** No-reference blur (Crete-Roffet et al. 2007): re-blur the card and measure how much of its
 *  pixel-to-pixel variation survives. Content-normalised: a smooth card back in focus and a busy
 *  holo in focus both lose most of their variation; a blurry photo has little left to lose.
 *  0 = sharp .. 1 = completely blurred. */
export function blurEffect(g, w, h) {
  const k = 4;                                                   // 9-tap box blur radius
  const B = new Float32Array(g.length), BH = new Float32Array(g.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let s = 0, n = 0; for (let d = -k; d <= k; d++) { const yy = y + d; if (yy >= 0 && yy < h) { s += g[yy * w + x]; n++; } } B[y * w + x] = s / n; }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let s = 0, n = 0; for (let d = -k; d <= k; d++) { const xx = x + d; if (xx >= 0 && xx < w) { s += g[y * w + xx]; n++; } } BH[y * w + x] = s / n; }
  let fV = 0, vV = 0, fH = 0, vH = 0;
  for (let y = 1; y < h; y++) for (let x = 1; x < w; x++) {
    const i = y * w + x;
    const dV = Math.abs(g[i] - g[i - w]), dBV = Math.abs(B[i] - B[i - w]);
    const dH = Math.abs(g[i] - g[i - 1]), dBH = Math.abs(BH[i] - BH[i - 1]);
    fV += dV; vV += Math.max(0, dV - dBV); fH += dH; vH += Math.max(0, dH - dBH);
  }
  return Math.max((fV - vV) / Math.max(1, fV), (fH - vH) / Math.max(1, fH));
}

/**
 * @param {{data: Uint8ClampedArray, width: number, height: number}} img  the full photo
 * @param {{tl,tr,br,bl: {x,y}}} corners  normalised 0..1
 * @param {{deskewed?: boolean}} [opts]  deskewed: a pre-cropped scan (TAG studio images): skip framing and angle
 * @returns {{score: number|null, issues: Record<string, number>, measures: object, cutoff: boolean, notCard?: boolean}}
 *   score is null (notCard) when the outline is not card-shaped
 */
export function photoConfidence(img, corners, opts = {}) {
  const P = ['tl', 'tr', 'br', 'bl'].map((k) => corners[k]);
  const edgeGap = Math.min(...P.flatMap((p) => [p.x, p.y, 1 - p.x, 1 - p.y]));
  const cutoff = !opts.deskewed && edgeGap < 0.004;               // a corner sits on the photo's edge
  const px = P.map((p) => ({ x: p.x * img.width, y: p.y * img.height }));
  const top = dist(px[0], px[1]), right = dist(px[1], px[2]), bottom = dist(px[2], px[3]), left = dist(px[3], px[0]);
  const shortSide = Math.min((top + bottom) / 2, (left + right) / 2);
  // A card is 63 x 88 mm (0.716). An outline far from that is a slab, a holder or a mis-detection:
  // say nothing rather than score the wrong object (a slab touching the frame read as a cut-off card).
  const aspect = shortSide / Math.max((top + bottom) / 2, (left + right) / 2);
  if (!opts.deskewed && (aspect < 0.64 || aspect > 0.8)) {
    return { score: null, notCard: true, cutoff: false, issues: {}, measures: { aspect: +aspect.toFixed(3), edgeGap: +edgeGap.toFixed(4) } };
  }

  const R = rectify(img, corners, 300, 420);
  const g = grayOf(R), w = R.width, h = R.height;

  // glare: blown highlight pixels (all channels high, low saturation) on the card, ignoring a thin rim
  let blown = 0, inner = 0;
  for (let y = 8; y < h - 8; y++) for (let x = 8; x < w - 8; x++) {
    const o = (y * w + x) * 4, r = R.data[o], gg = R.data[o + 1], b = R.data[o + 2];
    inner++; if (Math.min(r, gg, b) > 242 && Math.max(r, gg, b) - Math.min(r, gg, b) < 18) blown++;
  }
  const glareFrac = blown / inner;

  // exposure and contrast
  const p05 = percentile(g, 0.05), p50 = percentile(g, 0.5), p95 = percentile(g, 0.95);
  const contrast = p95 - p05;

  // evenness: median luminance of 8 border segments (outer 5 % ring)
  const seg = Array.from({ length: 8 }, () => []);
  const bw = Math.round(w * 0.05), bh = Math.round(h * 0.05);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const inRing = x < bw || x >= w - bw || y < bh || y >= h - bh; if (!inRing) continue;
    const ang = Math.atan2(y - h / 2, x - w / 2); const k = Math.floor(((ang + Math.PI) / (2 * Math.PI)) * 8) % 8;
    seg[k].push(g[y * w + x]);
  }
  const segMed = seg.map((a) => percentile(a, 0.5));
  const unevenRatio = (Math.max(...segMed) - Math.min(...segMed)) / Math.max(30, percentile(g, 0.5));

  // noise: residual against a 3x3 mean in the flattest 15 % of 12x12 blocks
  const blocks = [];
  for (let by = 12; by < h - 24; by += 12) for (let bx = 12; bx < w - 24; bx += 12) {
    let s = 0, s2 = 0; for (let y = by; y < by + 12; y++) for (let x = bx; x < bx + 12; x++) { const v = g[y * w + x]; s += v; s2 += v * v; }
    blocks.push({ bx, by, sd: Math.sqrt(Math.max(0, s2 / 144 - (s / 144) ** 2)), mean: s / 144 });
  }
  blocks.sort((a, b) => a.sd - b.sd);
  let res = 0, rn = 0;
  for (const bl of blocks.slice(0, Math.max(4, Math.floor(blocks.length * 0.15)))) {
    for (let y = bl.by + 1; y < bl.by + 11; y++) for (let x = bl.bx + 1; x < bl.bx + 11; x++) {
      const i = y * w + x; const m = (g[i - w - 1] + g[i - w] + g[i - w + 1] + g[i - 1] + g[i] + g[i + 1] + g[i + w - 1] + g[i + w] + g[i + w + 1]) / 9;
      res += (g[i] - m) ** 2; rn++;
    }
  }
  const noise = Math.sqrt(res / Math.max(1, rn));

  // sharpness
  const ew = opts.deskewed ? null : edgeWidth(img, corners);
  const RH = rectify(img, corners, 600, 840);
  const gH = grayOf(RH);
  const lap = laplacianRatio(gH, RH.width, RH.height);
  const be = blurEffect(gH, RH.width, RH.height);

  // angle: side-length ratios and corner angles
  const sideSkew = Math.max(Math.abs(top - bottom) / Math.max(top, bottom), Math.abs(left - right) / Math.max(left, right));
  const angleDev = Math.max(...[0, 1, 2, 3].map((i) => { const a = px[(i + 3) % 4], b = px[i], c = px[(i + 1) % 4];
    const v1 = { x: a.x - b.x, y: a.y - b.y }, v2 = { x: c.x - b.x, y: c.y - b.y };
    const cos = (v1.x * v2.x + v1.y * v2.y) / (Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y));
    return Math.abs(Math.acos(Math.max(-1, Math.min(1, cos))) * 180 / Math.PI - 90); }));

  const issues = {
    glare: ramp(glareFrac, 0.004, 0.06),
    blur: ramp(be, BLUR_GOOD, BLUR_BAD),
    dark: ramp(-p95, -175, -95),                 // brightest 5 %: a dark card still has bright highlights when exposed well
    fog: ramp(-contrast, -120, -45),
    grain: ramp(noise, 4.5, 9) * ramp(-p95, -200, -140),  // sensor noise only in dim photos (low highlights); foil sparkle and paper texture are not noise
    angle: opts.deskewed ? 0 : Math.max(ramp(sideSkew, 0.04, 0.2), ramp(angleDev, 3, 12)),
    uneven: ramp(unevenRatio, 0.8, 1.8),         // loose: full-art borders carry artwork
    small: opts.deskewed ? 0 : ramp(-shortSide, -650, -300),
  };
  const penalty = Object.entries(issues).reduce((t, [k, v]) => t + WEIGHTS[k] * (0.55 * v * v + 0.45 * v), 0);
  const score = cutoff ? 1 : Math.max(1, Math.round((10 - penalty) * 10) / 10);
  return {
    score, cutoff, issues,
    measures: { blurEffect: +be.toFixed(3), p95: Math.round(p95), glareFrac: +glareFrac.toFixed(4), edgeWidth: ew == null ? null : +ew.toFixed(2), laplacian: +lap.toFixed(3), median: Math.round(p50), contrast: Math.round(contrast), noise: +noise.toFixed(2), sideSkew: +sideSkew.toFixed(3), angleDev: +angleDev.toFixed(1), unevenRatio: +unevenRatio.toFixed(3), shortSide: Math.round(shortSide), edgeGap: +edgeGap.toFixed(4) },
  };
}

/** The phone cap: a phone photo never reaches the rig's band. */
export function capForSource(score, source = 'phone') { return source === 'rig' ? score : Math.min(PHONE_CAP, score); }
