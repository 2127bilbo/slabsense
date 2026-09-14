/**
 * Browser-side re-ranking of CLIP candidates for card identification.
 * Ported from scripts/harness/identify.mjs (bake-off 2026-09-14). Two signals:
 *   - pixelBoosts(): normalized cross-correlation of the number line (bottom strip of the
 *     card) against each candidate's TCGDex reference image. Finds the lowest band of
 *     high-contrast ink in each end of the strip (numbers sit bottom-left on modern cards,
 *     bottom-right on vintage) and matches that template with a small shift search.
 *   - ocrNumber(): tesseract.js on the native-resolution bottom 8% of the crop, thresholded,
 *     no whitelist (the LSTM engine ignores it); returns the numerator of "NN/NNN" or null.
 * Both take the user's cropped card image (a data URL or object URL). No DOM beyond canvas.
 */

const CW = 1000, CH = 1400;
const SW = CW, SY0 = Math.round(CH * 0.91), SH = CH - SY0; // bottom 9%
const LUM = (d, i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`image load failed: ${String(src).slice(0, 80)}`));
    img.src = src;
  });
}

/** Draw an image (already a card crop) to a CW×CH canvas and return RGBA data. */
async function cardPixels(src) {
  const img = await loadImage(src);
  const c = document.createElement('canvas'); c.width = CW; c.height = CH;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, CW, CH);
  return { data: ctx.getImageData(0, 0, CW, CH).data, img };
}

function stripFeature(d) {
  const W = SW, Y0 = SY0, H = SH; const g = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) g[y * W + x] = LUM(d, ((Y0 + y) * W + x) * 4);
  const I = new Float64Array((W + 1) * (H + 1)), I2 = new Float64Array((W + 1) * (H + 1));
  for (let y = 1; y <= H; y++) { let s = 0, s2 = 0; for (let x = 1; x <= W; x++) { const v = g[(y - 1) * W + x - 1]; s += v; s2 += v * v; I[y * (W + 1) + x] = I[(y - 1) * (W + 1) + x] + s; I2[y * (W + 1) + x] = I2[(y - 1) * (W + 1) + x] + s2; } }
  const R = 12; const out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const x0 = Math.max(0, x - R), x1 = Math.min(W, x + R + 1), y0 = Math.max(0, y - R), y1 = Math.min(H, y + R + 1); const n = (x1 - x0) * (y1 - y0);
    const S = I[y1 * (W + 1) + x1] - I[y0 * (W + 1) + x1] - I[y1 * (W + 1) + x0] + I[y0 * (W + 1) + x0];
    const S2 = I2[y1 * (W + 1) + x1] - I2[y0 * (W + 1) + x1] - I2[y1 * (W + 1) + x0] + I2[y0 * (W + 1) + x0];
    const m = S / n, sd = Math.sqrt(Math.max(0, S2 / n - m * m));
    out[y * W + x] = (g[y * W + x] - m) / (sd + 5);
  }
  return out;
}

function inkBoxes(feat) {
  const W = SW, H = SH; const win = Math.round(W * 0.3); const boxes = []; const T = 1.4;
  for (const x0 of [0, W - win]) {
    const rows = new Int32Array(H);
    for (let y = 0; y < H; y++) for (let x = x0 + 12; x < x0 + win - 12; x++) if (Math.abs(feat[y * W + x]) > T) rows[y]++;
    let y2 = H - 4; while (y2 > 0 && rows[y2] < 4) y2--;
    let y1 = y2, gap = 0; while (y1 > 0) { if (rows[y1 - 1] < 4) { if (++gap >= 3) break; } else gap = 0; y1--; }
    let minX = 1e9, maxX = -1;
    for (let y = y1; y <= y2; y++) for (let x = x0 + 12; x < x0 + win - 12; x++) if (Math.abs(feat[y * W + x]) > T) { if (x < minX) minX = x; if (x > maxX) maxX = x; }
    const bw = maxX - minX + 1, bh = y2 - y1 + 1;
    if (maxX >= 0 && bw >= 24 && bh >= 8 && bh <= 45) boxes.push({ x0: Math.max(0, minX - 6), y0: Math.max(0, y1 - 4), w: Math.min(W, maxX + 7) - Math.max(0, minX - 6), h: Math.min(H, y2 + 5) - Math.max(0, y1 - 4) });
    else boxes.push({ x0, y0: 0, w: win, h: H });
  }
  return boxes;
}

function ncc(a, ref) {
  const W = SW, H = SH; let best = -1;
  for (const bx of ref.boxes) {
    for (let dy = -12; dy <= 12; dy += 2) for (let dx = -24; dx <= 24; dx += 4) {
      let dot = 0, na = 0, nb = 0;
      for (let y = bx.y0; y < bx.y0 + bx.h; y++) {
        const ya = y + dy; if (ya < 0 || ya >= H) continue;
        for (let x = bx.x0; x < bx.x0 + bx.w; x++) { const xa = x + dx; if (xa < 0 || xa >= W) continue; const va = a[ya * W + xa], vb = ref.feat[y * W + x]; dot += va * vb; na += va * va; nb += vb * vb; }
      }
      const v = dot / (Math.sqrt(na * nb) || 1); if (v > best) best = v;
    }
  }
  return best;
}

/**
 * @param {string} cropSrc  user's cropped card image
 * @param {Array<{id:string, image:string}>} candidates  from findMatches(); `image` is the TCGDex base URL
 * @param {object} [o]  { concurrency = 4, quality = 'high', weight = 0.03 }
 * @returns {Promise<Record<string, number>>}  id → boost (weight × max(0, ncc)), 0 when the reference failed to load
 */
export async function pixelBoosts(cropSrc, candidates, { concurrency = 4, quality = 'high', weight = 0.03 } = {}) {
  const { data } = await cardPixels(cropSrc);
  const qf = stripFeature(data);
  const boosts = {};
  const queue = [...candidates];
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (queue.length) {
      const c = queue.shift();
      try {
        const { data: rd } = await cardPixels(`${c.image}/${quality}.webp`);
        const feat = stripFeature(rd);
        boosts[c.id] = weight * Math.max(0, ncc(qf, { feat, boxes: inkBoxes(feat) }));
      } catch { boosts[c.id] = 0; }
    }
  }));
  return boosts;
}

let ocrWorker = null;
/**
 * @param {string} cropSrc  user's cropped card image
 * @returns {Promise<string|null>}  numerator of the set number (leading zeros stripped) or null
 */
export async function ocrNumber(cropSrc) {
  const { createWorker, PSM } = await import('tesseract.js');
  if (!ocrWorker) ocrWorker = await createWorker('eng');
  const img = await loadImage(cropSrc);
  const W = img.naturalWidth || img.width, H = img.naturalHeight || img.height;
  const sy = Math.round(H * 0.92), sh = H - sy;
  const S = Math.max(1, Math.min(3, 130 / sh));
  const strip = document.createElement('canvas'); strip.width = Math.round(W * S); strip.height = Math.round(sh * S);
  const sctx = strip.getContext('2d', { willReadFrequently: true }); sctx.imageSmoothingEnabled = true;
  sctx.drawImage(img, 0, sy, W, sh, 0, 0, strip.width, strip.height);
  const bw = document.createElement('canvas'); bw.width = strip.width; bw.height = strip.height;
  const bx = bw.getContext('2d', { willReadFrequently: true }); bx.drawImage(strip, 0, 0);
  const id = bx.getImageData(0, 0, bw.width, bw.height); const p = id.data;
  for (let i = 0; i < p.length; i += 4) { const v = 0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2]; const o = v < 110 ? 0 : 255; p[i] = p[i + 1] = p[i + 2] = o; }
  bx.putImageData(id, 0, 0);
  for (const [canvas, psm] of [[bw, PSM.SINGLE_BLOCK], [strip, PSM.SINGLE_LINE], [strip, PSM.SPARSE_TEXT]]) {
    await ocrWorker.setParameters({ tessedit_pageseg_mode: psm });
    const { data } = await ocrWorker.recognize(canvas);
    const m = (data.text || '').match(/(\d{1,3})\s*\/\s*(\d{1,3})/);
    if (m) return m[1].replace(/^0+(?=\d)/, '');
  }
  return null;
}

export const numerator = (s) => String(s || '').split('/')[0].trim().replace(/^0+(?=\d)/, '').toUpperCase();
