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
 * Cut every crop for one task out of `source` and stack them into one batch
 * tensor. `ctx` must belong to a canvas already sized to the task input.
 *
 * @returns {{ images: Float32Array, boxes: object[], w: number, h: number }}
 */
export function cropBatch(ctx, source, task, cardW, cardH, f = TAG_CROP_FRACTIONS) {
  const { w, h } = INPUT_SIZE[task];
  const boxes = boxesForTask(task, cardW, cardH, f);
  const images = new Float32Array(boxes.length * 3 * w * h);
  boxes.forEach((box, n) => {
    drawBox(ctx, source, box, w, h);
    rgbaToTensor(ctx.getImageData(0, 0, w, h).data, w, h, images, n);
  });
  return { images, boxes, w, h };
}
