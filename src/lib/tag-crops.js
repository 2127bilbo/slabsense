/**
 * ============================================================================
 * TAG CROP GEOMETRY — tag-crops.js
 * ============================================================================
 * Cuts the 8 corner and 8 edge crops that the corner/edge models were trained
 * on, in TAG's own framing, out of a card image.
 *
 * TAG publishes one crop per slot per side. Measured over 598 cached dataset
 * cards (every card agreed to within +-1.5%):
 *   corner crops  550 x 550 px       = 0.1250 W x 0.0903 H
 *   top edge      (W - 1100) x 550   = the full span between the two corners
 *   left/right    550 x (H - 1100)
 *   bottom edge   (W - 1100) x 450   = 0.0739 H  (TAG's bottom strip is shorter)
 * A TAG card image is ~4400 x 6090, so the fractions above reproduce the same
 * framing on any crop of the same card, at any resolution.
 *
 * Orientation must match training exactly (training/trainlib/data.py):
 * a crop taller than it is wide is rotated with PIL ROTATE_90, i.e. 90 degrees
 * COUNTER-clockwise, before the resize. That applies to the left and right edge
 * strips only; corners and the top/bottom strips are fed as cut.
 *
 * Backdrop: every training crop shows TAG's orange backdrop beyond the card's
 * corner. The models learned that. Measured on held-out scans
 * (scripts/harness/model-domain.mjs): a black table keeps 17 of 64 corner
 * dings, white keeps 26, repainting the table TAG orange first keeps 52. So
 * `repaintBackdrop` flood-fills the backdrop from the tile's outer corner and
 * paints it TAG orange before the tensor is built. Until the models are
 * retrained with backdrop augmentation, this is what makes phone photos work.
 *
 * Pure except for the 2D canvas handed in: no DOM lookups, no model code.
 * Shared by the app and scripts/harness. See docs/GRADING_SYSTEM.md.
 * ============================================================================
 */

/** Crop sizes as fractions of the card rectangle (means over the cached dataset). */
export const TAG_CROP_FRACTIONS = {
  cornerW: 0.125,      // corner square width  / card width
  cornerH: 0.0903,     // corner square height / card height
  bottomEdgeH: 0.0739, // bottom strip height  / card height (TAG uses 450 px, not 550)
};

export const CORNER_KEYS = ['TL', 'TR', 'BL', 'BR'];
export const EDGE_KEYS = ['T', 'B', 'L', 'R'];

/** Engine ding locations, keyed by crop slot. */
export const CORNER_LOCATIONS = { TL: 'TOPLEFT', TR: 'TOPRIGHT', BL: 'BOTTOMLEFT', BR: 'BOTTOMRIGHT' };
export const EDGE_LOCATIONS = { T: 'TOP', B: 'BOTTOM', L: 'LEFT', R: 'RIGHT' };

export const IMAGENET_MEAN = [0.485, 0.456, 0.406];
export const IMAGENET_STD = [0.229, 0.224, 0.225];

/** Model input sizes, from the exported contract sidecars (weights/onnx/*.json). */
export const INPUT_SIZE = {
  corners: { w: 384, h: 384 },
  edges: { w: 1024, h: 192 },
};

/**
 * The four corner boxes of a cardW x cardH rectangle, in pixels.
 * @returns {{key:string, location:string, x:number, y:number, w:number, h:number, rotate:boolean}[]}
 */
export function cornerBoxes(cardW, cardH, f = TAG_CROP_FRACTIONS) {
  const w = cardW * f.cornerW;
  const h = cardH * f.cornerH;
  return [
    { key: 'TL', x: 0, y: 0 },
    { key: 'TR', x: cardW - w, y: 0 },
    { key: 'BL', x: 0, y: cardH - h },
    { key: 'BR', x: cardW - w, y: cardH - h },
  ].map((b) => ({ ...b, w, h, rotate: false, location: CORNER_LOCATIONS[b.key] }));
}

/**
 * The four edge strips between the corners. `rotate` marks the strips that must
 * be turned 90 degrees counter-clockwise to match training orientation.
 */
export function edgeBoxes(cardW, cardH, f = TAG_CROP_FRACTIONS) {
  const cw = cardW * f.cornerW;
  const ch = cardH * f.cornerH;
  const bh = cardH * f.bottomEdgeH;
  const span = cardW - 2 * cw;
  const side = cardH - 2 * ch;
  return [
    { key: 'T', x: cw, y: 0, w: span, h: ch, rotate: false },
    { key: 'B', x: cw, y: cardH - bh, w: span, h: bh, rotate: false },
    { key: 'L', x: 0, y: ch, w: cw, h: side, rotate: true },
    { key: 'R', x: cardW - cw, y: ch, w: cw, h: side, rotate: true },
  ].map((b) => ({ ...b, location: EDGE_LOCATIONS[b.key] }));
}

/** Every box for one task ('corners' | 'edges'). */
export function boxesForTask(task, cardW, cardH, f = TAG_CROP_FRACTIONS) {
  return task === 'corners' ? cornerBoxes(cardW, cardH, f) : edgeBoxes(cardW, cardH, f);
}

/**
 * Canvas transform that maps a box of bw x bh onto an outW x outH target,
 * rotating 90 degrees counter-clockwise when `rotate` is set (PIL ROTATE_90).
 *
 * Counter-clockwise means source (x, y) lands at (y, bw - x) before scaling, so
 * the card's outer boundary of a left strip ends up along the BOTTOM of the
 * output and of a right strip along the TOP — exactly what the model was
 * trained on. Returned as the six setTransform arguments.
 */
export function boxTransform(bw, bh, outW, outH, rotate) {
  if (!rotate) return [outW / bw, 0, 0, outH / bh, 0, 0];
  return [0, -outH / bw, outW / bh, 0, 0, outH];
}

/**
 * Draw one box into ctx (sized outW x outH) with the training orientation and a
 * high-quality downscale. `source` is anything drawImage accepts.
 */
export function drawBox(ctx, source, box, outW, outH) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, outW, outH);
  ctx.imageSmoothingEnabled = true;
  if ('imageSmoothingQuality' in ctx) ctx.imageSmoothingQuality = 'high';
  ctx.setTransform(...boxTransform(box.w, box.h, outW, outH, box.rotate));
  ctx.drawImage(source, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

/** TAG's backdrop colour, the mean of the outer corner of 40 training crops. */
export const TAG_BACKDROP_RGB = [247, 126, 44];

/**
 * Which tile corners touch the backdrop, per slot, in TILE coordinates (after
 * the training rotation). Corners: the tile corner that is the card's corner.
 * Edge strips: both ends of the outer side (top/bottom of the tile).
 */
const OUTER_SEEDS = {
  corners: { TL: [[0, 0]], TR: [[1, 0]], BL: [[0, 1]], BR: [[1, 1]] },
  edges: { T: [[0, 0], [1, 0]], B: [[0, 1], [1, 1]], L: [[0, 1], [1, 1]], R: [[0, 0], [1, 0]] },
};

/**
 * Paint the backdrop beyond the card TAG orange, in place, on one tile's RGBA.
 *
 * From each seed corner, flood-fill over pixels within `tolerance` (sum of
 * absolute RGB differences) of the seed pixel; grow the region by `grow` pixels
 * so the anti-aliased card boundary goes with it; paint it. The backdrop can be
 * a thin margin along a whole side (TAG's scans) or just the arc beyond a
 * rounded corner (a tight phone crop), so the fill may roam the whole tile —
 * two guards catch a leak into a card whose border matches the table: the fill
 * may not exceed `maxFill` of the tile, and it may never reach the tile centre.
 *
 * @returns {number} fraction of the tile repainted (0 when nothing qualified)
 */
export function repaintBackdrop(data, w, h, task, key, {
  rgb = TAG_BACKDROP_RGB, tolerance = 60, grow = 2, maxFill = 0.3, skipTolerance = 110,
} = {}) {
  const seeds = OUTER_SEEDS[task]?.[key];
  if (!seeds) return 0;
  const centre = (h >> 1) * w + (w >> 1);
  let painted = 0;
  for (const [cx, cy] of seeds) {
    const sx = cx ? w - 1 : 0;
    const sy = cy ? h - 1 : 0;
    const si = (sy * w + sx) * 4;
    const sr = data[si], sg = data[si + 1], sb = data[si + 2];
    // Already an orange-ish backdrop (TAG's own scans vary a little): leave it as trained.
    if (Math.abs(sr - rgb[0]) + Math.abs(sg - rgb[1]) + Math.abs(sb - rgb[2]) <= skipTolerance) continue;
    const mask = new Uint8Array(w * h);
    const stack = [sy * w + sx];
    let count = 0;
    let leaked = false;
    while (stack.length && !leaked) {
      const i = stack.pop();
      if (mask[i]) continue;
      const o = i * 4;
      if (Math.abs(data[o] - sr) + Math.abs(data[o + 1] - sg) + Math.abs(data[o + 2] - sb) > tolerance) continue;
      mask[i] = 1; count++;
      if (i === centre || count > maxFill * w * h) { leaked = true; break; }
      const x = i % w;
      if (x > 0) stack.push(i - 1);
      if (x < w - 1) stack.push(i + 1);
      if (i >= w) stack.push(i - w);
      if (i < w * (h - 1)) stack.push(i + w);
    }
    if (leaked) continue; // into the card: leave this seed alone
    let m = mask;
    for (let g = 0; g < grow; g++) {
      const next = new Uint8Array(m);
      for (let i = 0; i < m.length; i++) {
        if (m[i]) continue;
        const x = i % w;
        if ((x > 0 && m[i - 1]) || (x < w - 1 && m[i + 1]) || (i >= w && m[i - w]) || (i < w * (h - 1) && m[i + w])) next[i] = 1;
      }
      m = next;
    }
    for (let i = 0; i < m.length; i++) {
      if (!m[i]) continue;
      const o = i * 4;
      data[o] = rgb[0]; data[o + 1] = rgb[1]; data[o + 2] = rgb[2]; data[o + 3] = 255;
      painted++;
    }
  }
  return painted / (w * h);
}

/**
 * RGBA bytes -> normalized NCHW float32, written into `out` at image index `n`.
 * Matches training: x/255, then (x - mean) / std per channel.
 */
export function rgbaToTensor(data, w, h, out = new Float32Array(3 * w * h), n = 0) {
  const plane = w * h;
  const base = n * 3 * plane;
  for (let i = 0, p = 0; p < plane; p++, i += 4) {
    out[base + p] = (data[i] / 255 - IMAGENET_MEAN[0]) / IMAGENET_STD[0];
    out[base + plane + p] = (data[i + 1] / 255 - IMAGENET_MEAN[1]) / IMAGENET_STD[1];
    out[base + 2 * plane + p] = (data[i + 2] / 255 - IMAGENET_MEAN[2]) / IMAGENET_STD[2];
  }
  return out;
}

/**
 * Normalize a card rectangle. Accepts the detector's bounds
 * ({left, top, cardW, cardH}) or a plain {x, y, w, h}; a bare width/height pair
 * means the whole image is the card, which is the case after the user crops.
 */
export function cardRect(rect, fallbackW, fallbackH) {
  if (!rect) return { x: 0, y: 0, w: fallbackW, h: fallbackH };
  if (rect.cardW !== undefined) return { x: rect.left || 0, y: rect.top || 0, w: rect.cardW, h: rect.cardH };
  return { x: rect.x || 0, y: rect.y || 0, w: rect.w ?? fallbackW, h: rect.h ?? fallbackH };
}

/**
 * Cut every crop for one task out of `source` and stack them into one batch
 * tensor. `ctx` must belong to a canvas already sized to the task input.
 * `rect` is where the card sits in `source`; pass the detector bounds when the
 * photo has not been cropped to the card, or omit it when it has.
 *
 * @returns {{ images: Float32Array, boxes: object[], w: number, h: number }}
 */
export function cropBatch(ctx, source, task, rect, f = TAG_CROP_FRACTIONS, { backdrop = true } = {}) {
  const { w, h } = INPUT_SIZE[task];
  const boxes = boxesForTask(task, rect.w, rect.h, f).map((b) => ({ ...b, x: b.x + rect.x, y: b.y + rect.y }));
  const images = new Float32Array(boxes.length * 3 * w * h);
  boxes.forEach((box, n) => {
    drawBox(ctx, source, box, w, h);
    const { data } = ctx.getImageData(0, 0, w, h);
    if (backdrop) box.repainted = repaintBackdrop(data, w, h, task, box.key);
    rgbaToTensor(data, w, h, images, n);
  });
  return { images, boxes, w, h };
}
