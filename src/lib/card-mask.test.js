/*
 * SlabSense — https://www.slabsenseai.com
 * Copyright (c) 2026 SlabSense. All rights reserved.
 * Proprietary and confidential; see LICENSE at the repository root.
 */
/** Run: node src/lib/card-mask.test.js */
import { letterbox, ringMean, largestComponent, boundaryPoints, fitLine, intersect, extremeQuad, fitQuad, unletterbox, quadStats, refineQuad, cardFromMask, lumSampler, toNormalisedCorners } from './card-mask.js';

let passed = 0, failed = 0;
const check = (n, ok, extra = '') => { if (ok) { passed++; console.log(`  ✓ ${n}`); } else { failed++; console.log(`  ✗ ${n} ${extra}`); } };
const near = (a, b, eps) => Math.abs(a - b) <= eps;
const S = 512;

/** Synthetic photo: a bright rotated rectangle (the card) on a dark ground, plus its ideal corners. */
function synth({ w = 1500, h = 2000, cx = 760, cy = 1010, cw = 800, ch = 1120, angle = 12, S: size = 512 }) {
  const a = angle * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  const corner = (ux, uy) => [cx + ux * cw / 2 * c - uy * ch / 2 * s, cy + ux * cw / 2 * s + uy * ch / 2 * c];
  const truth = { tl: corner(-1, -1), tr: corner(1, -1), br: corner(1, 1), bl: corner(-1, 1) };
  const inside = (x, y) => { const dx = x - cx, dy = y - cy; const u = dx * c + dy * s, v = -dx * s + dy * c; return Math.abs(u) <= cw / 2 && Math.abs(v) <= ch / 2; };
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; const v = inside(x + 0.5, y + 0.5) ? 225 : 40; data[i] = data[i + 1] = data[i + 2] = v; data[i + 3] = 255; }
  // the model's mask: the same shape on the letterbox grid, slightly eroded (models under-segment by a pixel)
  const lb = letterbox(w, h, size);
  const logits = new Float32Array(size * size).fill(-4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const px = (x + 0.5 - lb.padX) / lb.scale, py = (y + 0.5 - lb.padY) / lb.scale;
    if (inside(px, py)) logits[y * size + x] = 4;
  }
  return { w, h, data, logits, truth, lb };
}
const cornerErr = (q, t) => Math.max(...['tl', 'tr', 'br', 'bl'].map((k) => Math.hypot(q[k][0] - t[k][0], q[k][1] - t[k][1])));

console.log('— letterbox');
const lb = letterbox(1500, 2000);
check('long side to 512, short side padded and centred', lb.newH === 512 && lb.newW === 384 && lb.padX === 64 && lb.padY === 0);
check('square input needs no padding', letterbox(512, 512).padX === 0 && letterbox(512, 512).scale === 1);
check('ring mean averages the border only', (() => { const d = new Uint8ClampedArray(40 * 40 * 4); for (let y = 0; y < 40; y++) for (let x = 0; x < 40; x++) { const i = (y * 40 + x) * 4; const edge = x < 8 || y < 8 || x >= 32 || y >= 32; d[i] = edge ? 200 : 0; d[i + 3] = 255; } return ringMean(d, 40, 40)[0] === 200; })());

console.log('— components');
{
  const logits = new Float32Array(S * S).fill(-1);
  for (let y = 100; y < 300; y++) for (let x = 100; x < 250; x++) logits[y * S + x] = 1;      // big blob
  for (let y = 400; y < 420; y++) for (let x = 400; x < 420; x++) logits[y * S + x] = 1;      // small blob
  const { label, area, components } = largestComponent(logits);
  check('two components found, the larger kept', components === 2 && area === 200 * 150 && label[150 * S + 150] === 1 && label[410 * S + 410] === 0);
  const b = boundaryPoints(label);
  check('boundary is the rectangle perimeter', b.length === 2 * 200 + 2 * 150 - 4);
}

console.log('— lines');
const L1 = fitLine([[0, 0], [10, 0], [20, 0.1]]), L2 = fitLine([[5, -5], [5, 5]]);
check('horizontal and vertical fits', Math.abs(L1.d[1]) < 0.01 && Math.abs(L2.d[0]) < 1e-9);
check('intersection', (() => { const p = intersect(L1, L2); return near(p[0], 5, 0.01) && near(p[1], 0.03, 0.05); })());
check('parallel lines give null', intersect(fitLine([[0, 0], [10, 0]]), fitLine([[0, 5], [10, 5]])) === null);

console.log('— quad from a rotated rectangle');
{
  const sc = synth({ angle: 12 });
  const { label } = largestComponent(sc.logits);
  const q = fitQuad(boundaryPoints(label));
  const qp = unletterbox(q, sc.lb);
  const err = cornerErr(qp, sc.truth);
  check('mask-only corners within 1.5 mask pixels of truth', err < 1.5 / sc.lb.scale, `${err.toFixed(1)} px`);
  const st = quadStats(qp);
  check('card-shaped and right size', st.cardLike && near(st.w, 800, 8) && near(st.h, 1120, 8));
  const e = extremeQuad(boundaryPoints(label));
  check('extreme points are in TL/TR/BR/BL order', e.tl[0] < e.tr[0] && e.tl[1] < e.bl[1] && e.br[0] > e.bl[0]);
}

console.log('— full-resolution refinement');
{
  const sc = synth({ angle: 7 });
  const lum = lumSampler(sc.data, sc.w, sc.h);
  const raw = unletterbox(fitQuad(boundaryPoints(largestComponent(sc.logits).label)), sc.lb);
  // knock the mask quad off by 6 px on every corner to simulate mask quantisation
  const off = { tl: [raw.tl[0] - 6, raw.tl[1] - 5], tr: [raw.tr[0] + 5, raw.tr[1] - 6], br: [raw.br[0] + 6, raw.br[1] + 5], bl: [raw.bl[0] - 5, raw.bl[1] + 6] };
  const before = cornerErr(off, sc.truth);
  const refined = refineQuad(off, lum);
  const after = cornerErr(refined, sc.truth);
  check(`refinement pulls corners onto the real edge (${before.toFixed(1)} px -> ${after.toFixed(2)} px)`, after < 1.5 && after < before / 4);
  const flat = refineQuad(off, () => 100); // no edges anywhere: nothing to find
  check('with no brightness step the quad is left alone', cornerErr(flat, off) < 1e-6);
}

console.log('— whole chain');
{
  const sc = synth({ angle: -18, cx: 700, cy: 900 });
  const out = cardFromMask(sc.logits, sc.w, sc.h, { lum: lumSampler(sc.data, sc.w, sc.h), refine: 'gradient' });
  const outL = cardFromMask(sc.logits, sc.w, sc.h);
  check('logit refinement is at least as good as the raw boundary', cornerErr(outL.quad, sc.truth) <= cornerErr(outL.quadRaw, sc.truth) + 0.01, `${cornerErr(outL.quad, sc.truth).toFixed(2)} vs ${cornerErr(outL.quadRaw, sc.truth).toFixed(2)}`);
  check('returns a refined card quad', out && cornerErr(out.quad, sc.truth) < 1.5, out ? cornerErr(out.quad, sc.truth).toFixed(2) : 'null');
  check('raw quad is worse than refined', cornerErr(out.quadRaw, sc.truth) >= cornerErr(out.quad, sc.truth));
  check('mask area reported as a fraction', out.maskArea > 0.2 && out.maskArea < 0.7);
  const nc = toNormalisedCorners(out.quad, sc.w, sc.h);
  check('normalised corners in 0-1', Object.values(nc).every((p) => p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1));
  check('an empty mask gives null', cardFromMask(new Float32Array(S * S).fill(-3), 1500, 2000) === null);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
