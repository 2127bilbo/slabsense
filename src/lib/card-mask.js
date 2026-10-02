/*
 * SlabSense — https://www.slabsenseai.com
 * Copyright (c) 2026 SlabSense. All rights reserved.
 * Proprietary and confidential; see LICENSE at the repository root.
 */
/**
 * ============================================================================
 * CARD MASK GEOMETRY — card-mask.js
 * ============================================================================
 * Turns the card model's 512x512 mask into the card's four corners in the
 * photo, then tightens each side at full resolution.
 *
 * Contract (training/weights/onnx/card-v1.json): the photo is resized so its
 * long side is 512, padded on the short side with the mean colour of the
 * photo's outer 8 px ring, and the model returns logits where > 0 is card.
 * Everything geometric happens here, not in the model:
 *
 *   1. threshold -> largest connected component (the card; sleeves, hands and a
 *      second card are separate blobs or smaller ones)
 *   2. boundary pixels -> initial quad from the four extreme points -> three
 *      rounds of "assign each boundary pixel to its nearest side, fit a line per
 *      side, intersect adjacent lines". Rotation and perspective fall out of
 *      that; a bowed side gets its best straight line.
 *   3. `refineQuad`: at full resolution, walk each side, look along the normal
 *      for the strongest brightness step near the mask's edge, refit. The mask
 *      lives on a 512 grid (one mask pixel is ~0.3 % of a card that fills the
 *      frame), and this is what wins that back.
 *
 * Pure: no DOM, no ONNX. Shared by the app and scripts/harness.
 * ============================================================================
 */

export const CARD_INPUT = 512;

/** Letterbox geometry for a w x h photo into an S x S square. p_out = p * scale + pad. */
export function letterbox(w, h, S = CARD_INPUT) {
  const scale = S / Math.max(w, h);
  const newW = Math.round(w * scale), newH = Math.round(h * scale);
  return { scale, padX: Math.floor((S - newW) / 2), padY: Math.floor((S - newH) / 2), newW, newH, S };
}

/** Mean RGB of the outer `ring` px of an RGBA buffer. */
export function ringMean(data, w, h, ring = 8) {
  let r = 0, g = 0, b = 0, n = 0;
  const add = (i) => { r += data[i]; g += data[i + 1]; b += data[i + 2]; n++; };
  for (let y = 0; y < h; y++) {
    const edgeRow = y < ring || y >= h - ring;
    for (let x = 0; x < w; x++) {
      if (edgeRow || x < ring || x >= w - ring) add((y * w + x) * 4);
    }
  }
  return n ? [r / n, g / n, b / n] : [128, 128, 128];
}

/**
 * Largest connected component of the thresholded mask (4-connected).
 * @param {Float32Array|ArrayLike<number>} logits S*S, row-major
 * @returns {{ label: Uint8Array, area: number, total: number }} label 1 = largest component
 */
export function largestComponent(logits, S = CARD_INPUT, threshold = 0) {
  const n = S * S;
  const on = new Uint8Array(n);
  let total = 0;
  for (let i = 0; i < n; i++) if (logits[i] > threshold) { on[i] = 1; total++; }
  const comp = new Int32Array(n).fill(-1);
  const stack = new Int32Array(n);
  let best = -1, bestArea = 0, id = 0;
  const areas = [];
  for (let s = 0; s < n; s++) {
    if (!on[s] || comp[s] >= 0) continue;
    let top = 0, area = 0;
    stack[top++] = s; comp[s] = id;
    while (top) {
      const i = stack[--top]; area++;
      const x = i % S;
      if (x > 0 && on[i - 1] && comp[i - 1] < 0) { comp[i - 1] = id; stack[top++] = i - 1; }
      if (x < S - 1 && on[i + 1] && comp[i + 1] < 0) { comp[i + 1] = id; stack[top++] = i + 1; }
      if (i >= S && on[i - S] && comp[i - S] < 0) { comp[i - S] = id; stack[top++] = i - S; }
      if (i < n - S && on[i + S] && comp[i + S] < 0) { comp[i + S] = id; stack[top++] = i + S; }
    }
    areas.push(area);
    if (area > bestArea) { bestArea = area; best = id; }
    id++;
  }
  const label = new Uint8Array(n);
  if (best >= 0) for (let i = 0; i < n; i++) if (comp[i] === best) label[i] = 1;
  return { label, area: bestArea, total, components: areas.length };
}

/** Boundary pixels of a binary label image, as [x, y] pairs (pixel centres). */
export function boundaryPoints(label, S = CARD_INPUT) {
  const pts = [];
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      if (!label[i]) continue;
      if (x === 0 || y === 0 || x === S - 1 || y === S - 1 || !label[i - 1] || !label[i + 1] || !label[i - S] || !label[i + S]) pts.push([x + 0.5, y + 0.5]);
    }
  }
  return pts;
}

/** Total-least-squares line through points: { p: [x,y] on the line, d: unit direction }. */
export function fitLine(pts) {
  const n = pts.length;
  if (n < 2) return null;
  let mx = 0, my = 0;
  for (const [x, y] of pts) { mx += x; my += y; }
  mx /= n; my /= n;
  let sxx = 0, sxy = 0, syy = 0;
  for (const [x, y] of pts) { const dx = x - mx, dy = y - my; sxx += dx * dx; sxy += dx * dy; syy += dy * dy; }
  // principal eigenvector of the 2x2 covariance
  const tr = sxx + syy, det = sxx * syy - sxy * sxy;
  const l1 = tr / 2 + Math.sqrt(Math.max(0, tr * tr / 4 - det));
  let dx, dy;
  if (Math.abs(sxy) > 1e-9) { dx = l1 - syy; dy = sxy; } else if (sxx >= syy) { dx = 1; dy = 0; } else { dx = 0; dy = 1; }
  const len = Math.hypot(dx, dy) || 1;
  return { p: [mx, my], d: [dx / len, dy / len] };
}

export function intersect(a, b) {
  const [px, py] = a.p, [dx, dy] = a.d, [qx, qy] = b.p, [ex, ey] = b.d;
  const den = dx * ey - dy * ex;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((qx - px) * ey - (qy - py) * ex) / den;
  return [px + t * dx, py + t * dy];
}

const SIDES = ['top', 'right', 'bottom', 'left'];      // TL->TR, TR->BR, BR->BL, BL->TL

function sideSegments(q) {
  return { top: [q.tl, q.tr], right: [q.tr, q.br], bottom: [q.br, q.bl], left: [q.bl, q.tl] };
}

function distToSegment([x, y], [[x1, y1], [x2, y2]]) {
  const vx = x2 - x1, vy = y2 - y1, len2 = vx * vx + vy * vy || 1;
  const t = Math.max(0, Math.min(1, ((x - x1) * vx + (y - y1) * vy) / len2));
  return Math.hypot(x - (x1 + t * vx), y - (y1 + t * vy));
}

/** Corners from four fitted side lines. */
function cornersFromLines(L) {
  const tl = intersect(L.left, L.top), tr = intersect(L.top, L.right), br = intersect(L.right, L.bottom), bl = intersect(L.bottom, L.left);
  return tl && tr && br && bl ? { tl, tr, br, bl } : null;
}

/** Initial quad from the extreme points of the boundary: TL = min(x+y), TR = max(x-y), BR = max(x+y), BL = min(x-y). */
export function extremeQuad(pts) {
  let tl = pts[0], tr = pts[0], br = pts[0], bl = pts[0];
  for (const p of pts) {
    if (p[0] + p[1] < tl[0] + tl[1]) tl = p;
    if (p[0] - p[1] > tr[0] - tr[1]) tr = p;
    if (p[0] + p[1] > br[0] + br[1]) br = p;
    if (p[0] - p[1] < bl[0] - bl[1]) bl = p;
  }
  return { tl, tr, br, bl };
}

/**
 * Fit a quadrilateral to boundary points: assign each point to its nearest
 * side of the current quad, fit a line per side, intersect. `rounds` of that.
 * Points far from every side (a blob's stray pixels) are ignored via `band`.
 */
export function fitQuad(pts, { rounds = 3, band = 6 } = {}) {
  if (pts.length < 8) return null;
  let q = extremeQuad(pts);
  for (let r = 0; r < rounds; r++) {
    const seg = sideSegments(q);
    const buckets = { top: [], right: [], bottom: [], left: [] };
    for (const p of pts) {
      let best = null, bd = Infinity;
      for (const s of SIDES) { const d = distToSegment(p, seg[s]); if (d < bd) { bd = d; best = s; } }
      if (bd <= band * (r === 0 ? 4 : 1)) buckets[best].push(p);
    }
    const L = {};
    for (const s of SIDES) { L[s] = fitLine(buckets[s]); if (!L[s]) return q; }
    const next = cornersFromLines(L);
    if (!next) return q;
    q = next;
  }
  return q;
}

/** Map a quad from letterbox (S grid) coordinates back to photo pixels. */
export function unletterbox(q, lb) {
  const f = ([x, y]) => [(x - lb.padX) / lb.scale, (y - lb.padY) / lb.scale];
  return { tl: f(q.tl), tr: f(q.tr), br: f(q.br), bl: f(q.bl) };
}

/** Quad -> normalised corners {tl:{x,y}..} in fractions of the photo, clamped. */
export function toNormalisedCorners(q, w, h) {
  const c = (p) => ({ x: Math.max(0, Math.min(1, p[0] / w)), y: Math.max(0, Math.min(1, p[1] / h)) });
  return { tl: c(q.tl), tr: c(q.tr), br: c(q.br), bl: c(q.bl) };
}

/** Side lengths and a sanity verdict: is this quad card-shaped? */
export function quadStats(q) {
  const len = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
  const top = len(q.tl, q.tr), bottom = len(q.bl, q.br), left = len(q.tl, q.bl), right = len(q.tr, q.br);
  const w = (top + bottom) / 2, h = (left + right) / 2;
  const cross = (q.tr[0] - q.tl[0]) * (q.bl[1] - q.tl[1]) - (q.tr[1] - q.tl[1]) * (q.bl[0] - q.tl[0]);
  const area = Math.abs(((q.tl[0] * q.tr[1] - q.tr[0] * q.tl[1]) + (q.tr[0] * q.br[1] - q.br[0] * q.tr[1]) + (q.br[0] * q.bl[1] - q.bl[0] * q.br[1]) + (q.bl[0] * q.tl[1] - q.tl[0] * q.bl[1])) / 2);
  const aspect = Math.min(w, h) / Math.max(w, h);
  return { w, h, area, aspect, longSide: Math.max(w, h), cardLike: aspect > 0.6 && aspect < 0.85 && cross !== 0 };
}

/**
 * Full-resolution refinement of each side. `lum(x, y)` returns the photo's
 * luminance at integer pixel coordinates (null outside). For `samples` points
 * along each side, search along the outward normal within +-`reach` px for
 * the largest |gradient| and refit the side through those points, dropping
 * outliers. Returns the refined quad; sides that find no consistent step
 * keep their input line.
 */
export function refineQuad(q, lum, { samples = 32, reach = null, minPoints = 8 } = {}) {
  const stats = quadStats(q);
  const R = Math.max(4, Math.round(reach ?? stats.longSide * 0.01));
  const seg = sideSegments(q);
  const L = {};
  const cx = (q.tl[0] + q.tr[0] + q.br[0] + q.bl[0]) / 4, cy = (q.tl[1] + q.tr[1] + q.br[1] + q.bl[1]) / 4;
  for (const s of SIDES) {
    const [a, b] = seg[s];
    const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
    // outward normal: perpendicular pointing away from the quad centre
    let nx = -dy / len, ny = dx / len;
    const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
    if ((mx - cx) * nx + (my - cy) * ny < 0) { nx = -nx; ny = -ny; }
    const found = [];
    for (let i = 0; i < samples; i++) {
      const t = (i + 0.5) / samples;
      const px = a[0] + t * dx, py = a[1] + t * dy;
      // profile along the normal, inside (-R) to outside (+R)
      const prof = [];
      for (let k = -R; k <= R; k++) {
        const v = lum(Math.round(px + k * nx), Math.round(py + k * ny));
        if (v === null) { prof.length = 0; break; }
        prof.push(v);
      }
      if (prof.length < 5) continue;
      const grad = new Array(prof.length).fill(0);
      for (let k = 1; k < prof.length - 1; k++) grad[k] = Math.abs(prof[k + 1] - prof[k - 1]);
      let bestI = 1, bestG = 0;
      for (let k = 1; k < prof.length - 1; k++) if (grad[k] > bestG) { bestG = grad[k]; bestI = k; }
      if (bestG < 12) continue; // no real step here (glare, or the edge is out of reach)
      // sub-pixel peak: parabola through the three gradient samples around the maximum
      const g0 = grad[bestI - 1], g1 = grad[bestI], g2 = grad[bestI + 1];
      const den = g0 - 2 * g1 + g2;
      const sub = den < 0 ? Math.max(-0.5, Math.min(0.5, 0.5 * (g0 - g2) / den)) : 0;
      const kk = bestI - R + sub;
      found.push([px + kk * nx, py + kk * ny]);
    }
    if (found.length < minPoints) { L[s] = fitLine([a, b]); continue; }
    // robust refit: drop points beyond 2.5x the median residual
    let line = fitLine(found);
    const resid = found.map(([x, y]) => Math.abs((x - line.p[0]) * -line.d[1] + (y - line.p[1]) * line.d[0]));
    const med = [...resid].sort((u, v) => u - v)[Math.floor(resid.length / 2)] || 0;
    const kept = found.filter((_, i) => resid[i] <= Math.max(1.5, 2.5 * med));
    if (kept.length >= minPoints) line = fitLine(kept);
    L[s] = line;
  }
  return cornersFromLines(L) || q;
}

/**
 * Sub-pixel refinement on the mask itself: along each side's normal the logits
 * cross zero somewhere between two mask pixels; linear interpolation of that
 * crossing places the edge to a fraction of a mask pixel, which a boundary made
 * of pixel centres cannot. Only the largest component's pixels count (`label`),
 * so a neighbouring blob cannot pull a side. Runs in mask (letterbox) coordinates.
 */
export function refineByLogits(qS, logits, label, S = CARD_INPUT, { samples = 40, reach = 3, minPoints = 10 } = {}) {
  const seg = sideSegments(qS);
  const cx = (qS.tl[0] + qS.tr[0] + qS.br[0] + qS.bl[0]) / 4, cy = (qS.tl[1] + qS.tr[1] + qS.br[1] + qS.bl[1]) / 4;
  const at = (x, y) => { const xi = Math.round(x - 0.5), yi = Math.round(y - 0.5); if (xi < 0 || yi < 0 || xi >= S || yi >= S) return null; const i = yi * S + xi; return label[i] ? logits[i] : Math.min(logits[i], -1e-3); };
  const L = {};
  for (const s of SIDES) {
    const [a, b] = seg[s];
    const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
    let nx = -dy / len, ny = dx / len;
    if (((a[0] + b[0]) / 2 - cx) * nx + ((a[1] + b[1]) / 2 - cy) * ny < 0) { nx = -nx; ny = -ny; }
    const found = [];
    for (let i = 0; i < samples; i++) {
      const t = (i + 0.5) / samples;
      const px = a[0] + t * dx, py = a[1] + t * dy;
      // walk inside -> outside in half-pixel steps, find the first sign change
      let prev = null, prevK = null;
      for (let k = -reach; k <= reach; k += 0.5) {
        const v = at(px + k * nx, py + k * ny);
        if (v === null) { prev = null; continue; }
        if (prev !== null && prev > 0 && v <= 0) { const f = prev / (prev - v); const kk = prevK + f * (k - prevK); found.push([px + kk * nx, py + kk * ny]); break; }
        prev = v; prevK = k;
      }
    }
    if (found.length < minPoints) { L[s] = fitLine([a, b]); continue; }
    let line = fitLine(found);
    const resid = found.map(([x, y]) => Math.abs((x - line.p[0]) * -line.d[1] + (y - line.p[1]) * line.d[0]));
    const med = [...resid].sort((u, v) => u - v)[Math.floor(resid.length / 2)] || 0;
    const kept = found.filter((_, i) => resid[i] <= Math.max(0.75, 2.5 * med));
    if (kept.length >= minPoints) line = fitLine(kept);
    L[s] = line;
  }
  return cornersFromLines(L) || qS;
}

/**
 * The whole chain from logits to corners in photo pixels.
 * `refine`: 'logits' (default) interpolates the mask boundary to sub-pixel;
 * 'gradient' looks for brightness steps in the full-resolution photo via `lum`
 * (measured worse on real phone photos — shadows and holo texture out-step the
 * card edge — kept for experiments); 'none' uses the pixel-centre boundary.
 * @returns {{ quad, quadRaw, stats, maskArea, components }|null}
 */
export function cardFromMask(logits, w, h, { lum = null, S = CARD_INPUT, refine = 'logits' } = {}) {
  const lb = letterbox(w, h, S);
  const { label, area, total, components } = largestComponent(logits, S);
  if (area < S * S * 0.03) return null;
  const pts = boundaryPoints(label, S);
  const qS = fitQuad(pts);
  if (!qS) return null;
  const quadRaw = unletterbox(qS, lb);
  let quad = quadRaw;
  if (refine === 'logits') quad = unletterbox(refineByLogits(qS, logits, label, S), lb);
  else if (refine === 'gradient' && lum) quad = refineQuad(quadRaw, lum);
  return { quad, quadRaw, stats: quadStats(quad), rawStats: quadStats(quadRaw), maskArea: area / (S * S), maskTotal: total / (S * S), components };
}

/** Luminance sampler over an RGBA buffer. */
export function lumSampler(data, w, h) {
  return (x, y) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return null;
    const i = (y * w + x) * 4;
    return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  };
}
