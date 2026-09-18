/** Run: node src/lib/tag-crops.test.js */
import {
  TAG_CROP_FRACTIONS, CORNER_KEYS, EDGE_KEYS, cornerBoxes, edgeBoxes, boxesForTask,
  boxTransform, rgbaToTensor, IMAGENET_MEAN, IMAGENET_STD, INPUT_SIZE, drawBox, cropBatch,
  repaintBackdrop, TAG_BACKDROP_RGB,
} from './tag-crops.js';

let passed = 0, failed = 0;
const check = (n, ok, extra = '') => { if (ok) { passed++; console.log(`  ✓ ${n}`); } else { failed++; console.log(`  ✗ ${n} ${extra}`); } };
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

// A TAG card image and the crop sizes TAG publishes for it.
const W = 4400, H = 6090;

console.log('— corner boxes');
const cb = cornerBoxes(W, H);
check('four corners, in TL TR BL BR order', cb.length === 4 && cb.map((b) => b.key).join(',') === CORNER_KEYS.join(','));
check('corner size matches TAG 550 px', near(cb[0].w, 550, 1) && near(cb[0].h, 550, 2), `${cb[0].w}x${cb[0].h}`);
check('TL anchored at the origin', cb[0].x === 0 && cb[0].y === 0);
check('TR touches the right border', near(cb[1].x + cb[1].w, W));
check('BR touches both far borders', near(cb[3].x + cb[3].w, W) && near(cb[3].y + cb[3].h, H));
check('corners are never rotated', cb.every((b) => b.rotate === false));
check('corner locations are engine locations', cb.map((b) => b.location).join(',') === 'TOPLEFT,TOPRIGHT,BOTTOMLEFT,BOTTOMRIGHT');

console.log('— edge boxes');
const eb = edgeBoxes(W, H);
check('four edges, in T B L R order', eb.length === 4 && eb.map((b) => b.key).join(',') === EDGE_KEYS.join(','));
const top = eb[0], bottom = eb[1], left = eb[2], right = eb[3];
check('top strip spans exactly between the corners', near(top.x, cb[0].w) && near(top.w, W - 2 * cb[0].w));
check('top strip is as tall as a corner', near(top.h, cb[0].h));
check('bottom strip is TAG\'s shorter 450 px band', near(bottom.h, H * TAG_CROP_FRACTIONS.bottomEdgeH) && bottom.h < top.h);
check('bottom strip is flush with the bottom border', near(bottom.y + bottom.h, H));
check('side strips span between the corners', near(left.y, cb[0].h) && near(left.h, H - 2 * cb[0].h));
check('right strip is flush with the right border', near(right.x + right.w, W));
check('only the side strips rotate', !top.rotate && !bottom.rotate && left.rotate && right.rotate);
check('boxesForTask dispatches', boxesForTask('corners', W, H).length === 4 && boxesForTask('edges', W, H)[2].rotate === true);
check('geometry scales with the card', cornerBoxes(W / 2, H / 2)[3].x === cornerBoxes(W, H)[3].x / 2);

console.log('— orientation (must match PIL ROTATE_90 in training)');
const apply = (t, x, y) => [t[0] * x + t[2] * y + t[4], t[1] * x + t[3] * y + t[5]];
const plain = boxTransform(100, 50, 1024, 192, false);
check('unrotated box just scales', near(apply(plain, 0, 0)[0], 0) && near(apply(plain, 100, 50)[0], 1024) && near(apply(plain, 100, 50)[1], 192));
// A left strip: source x = 0 is the card's outer border, y grows down the card.
const rot = boxTransform(550, 5067, 1024, 192, true);
const [x00, y00] = apply(rot, 0, 0);
const [x10, y10] = apply(rot, 550, 0);
const [x01, y01] = apply(rot, 0, 5067);
check('counter-clockwise: crop top-left goes to output bottom-left', near(x00, 0) && near(y00, 192));
check('counter-clockwise: the card-inner side goes to the output top', near(x10, 0) && near(y10, 0));
check('counter-clockwise: down the card becomes right across the output', near(x01, 1024) && near(y01, 192));

console.log('— tensor');
const px = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255]); // 2x2 RGBA
const t = rgbaToTensor(px, 2, 2);
check('planar NCHW layout, 3 planes', t.length === 12);
check('red channel normalized', near(t[0], (1 - IMAGENET_MEAN[0]) / IMAGENET_STD[0], 1e-5));
check('green plane starts at offset w*h', near(t[4 + 1], (1 - IMAGENET_MEAN[1]) / IMAGENET_STD[1], 1e-5));
check('blue plane starts at offset 2*w*h', near(t[8 + 2], (1 - IMAGENET_MEAN[2]) / IMAGENET_STD[2], 1e-5));
check('zero channel maps to -mean/std', near(t[1], (0 - IMAGENET_MEAN[0]) / IMAGENET_STD[0], 1e-5));
const two = new Float32Array(2 * 12);
rgbaToTensor(px, 2, 2, two, 1);
check('batch offset writes the second image', two[0] === 0 && near(two[12], (1 - IMAGENET_MEAN[0]) / IMAGENET_STD[0], 1e-5));

console.log('— input sizes match the exported contracts');
check('corners 384x384', INPUT_SIZE.corners.w === 384 && INPUT_SIZE.corners.h === 384);
check('edges 1024x192', INPUT_SIZE.edges.w === 1024 && INPUT_SIZE.edges.h === 192);

console.log('— cropBatch with a stub canvas');
function stubCtx(w, h) {
  const calls = [];
  return {
    calls,
    setTransform: (...a) => calls.push(['setTransform', ...a]),
    clearRect: () => {},
    drawImage: (...a) => calls.push(['drawImage', ...a.slice(1)]),
    getImageData: () => ({ data: new Uint8ClampedArray(w * h * 4) }),
    imageSmoothingEnabled: false,
    imageSmoothingQuality: 'low',
  };
}
const ctx = stubCtx(384, 384);
const batch = cropBatch(ctx, {}, 'corners', { x: 0, y: 0, w: W, h: H });
check('batch holds every corner', batch.boxes.length === 4 && batch.images.length === 4 * 3 * 384 * 384);
check('one drawImage per crop', ctx.calls.filter((c) => c[0] === 'drawImage').length === 4);
check('drawImage receives the box, not the output size', ctx.calls.find((c) => c[0] === 'drawImage')[3] === cornerBoxes(W, H)[0].w);
check('smoothing turned on for the downscale', ctx.imageSmoothingEnabled === true && ctx.imageSmoothingQuality === 'high');
const ectx = stubCtx(1024, 192);
drawBox(ectx, {}, edgeBoxes(W, H)[2], 1024, 192);
check('rotated draw uses the CCW transform', JSON.stringify(ectx.calls.find((c) => c[0] === 'setTransform' && c[3] !== 0).slice(1, 7)) === JSON.stringify(boxTransform(left.w, left.h, 1024, 192, true)));

console.log('— backdrop repaint');
// A 40x40 tile: card is yellow, the table beyond a rounded corner at top-left is black.
function tile(bg, cardRgb = [250, 220, 60], radius = 10) {
  const w = 40, h = 40;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const outside = x < radius && y < radius && Math.hypot(radius - x, radius - y) > radius;
    const c = outside ? bg : cardRgb;
    const o = (y * w + x) * 4; data[o] = c[0]; data[o + 1] = c[1]; data[o + 2] = c[2]; data[o + 3] = 255;
  }
  return { data, w, h };
}
const pxAt = (t, x, y) => Array.from(t.data.slice((y * t.w + x) * 4, (y * t.w + x) * 4 + 3));
{
  const t = tile([0, 0, 0]);
  const frac = repaintBackdrop(t.data, t.w, t.h, 'corners', 'TL');
  check('black table beyond the corner becomes TAG orange', JSON.stringify(pxAt(t, 0, 0)) === JSON.stringify(TAG_BACKDROP_RGB));
  check('the card itself is untouched', JSON.stringify(pxAt(t, 20, 20)) === JSON.stringify([250, 220, 60]) && JSON.stringify(pxAt(t, 39, 39)) === JSON.stringify([250, 220, 60]));
  check('a small fraction was painted', frac > 0 && frac < 0.1, String(frac));
}
{
  const t = tile([245, 245, 245]);
  repaintBackdrop(t.data, t.w, t.h, 'corners', 'TL');
  check('white table repainted too', JSON.stringify(pxAt(t, 0, 0)) === JSON.stringify(TAG_BACKDROP_RGB));
}
{
  const t = tile(TAG_BACKDROP_RGB);
  const frac = repaintBackdrop(t.data, t.w, t.h, 'corners', 'TL');
  check('already-orange backdrop is left alone', frac === 0);
}
{
  const t = tile([0, 0, 0], [0, 0, 0]); // black-bordered card on a black table: indistinguishable
  const frac = repaintBackdrop(t.data, t.w, t.h, 'corners', 'TL');
  check('a fill that floods the card is refused', frac === 0);
}
{
  const t = tile([0, 0, 0]);
  repaintBackdrop(t.data, t.w, t.h, 'corners', 'BR'); // wrong seed corner: that corner is card
  check("only the slot's own outer corner is a seed", JSON.stringify(pxAt(t, 0, 0)) === JSON.stringify([0, 0, 0]));
}
check('unknown slot is a no-op', repaintBackdrop(tile([0, 0, 0]).data, 40, 40, 'corners', 'XX') === 0);
{
  // An edge tile: the outer side is the top for T (both ends seeded).
  const w = 60, h = 20; const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = (y * w + x) * 4; const bg = y < 2; data[o] = bg ? 0 : 250; data[o + 1] = bg ? 0 : 220; data[o + 2] = bg ? 0 : 60; data[o + 3] = 255; }
  repaintBackdrop(data, w, h, 'edges', 'T');
  check('edge strip: outer band repainted from both ends', data[0] === TAG_BACKDROP_RGB[0] && data[((1 * w) + (w - 1)) * 4] === TAG_BACKDROP_RGB[0]);
  check('edge strip: card rows untouched', data[(10 * w + 30) * 4] === 250);
}


console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
