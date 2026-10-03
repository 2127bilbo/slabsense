/*
 * SlabSense — https://www.slabsenseai.com
 * Copyright (c) 2026 SlabSense. All rights reserved.
 * Proprietary and confidential; see LICENSE at the repository root.
 */
import assert from 'node:assert/strict';
import { photoConfidence, capForSource, PHONE_CAP } from './photo-confidence.js';

let passed = 0;
const ok = (n, f) => { f(); passed++; console.log(`  ✓ ${n}`); };

// A synthetic phone photo: dark mat, a light card with a printed border and textured "art".
const W = 1200, H = 1560;   // card ~1000 px wide, like the owner's 1500x2000 phone shots
const CORNERS = { tl: { x: 0.08, y: 0.06 }, tr: { x: 0.92, y: 0.06 }, br: { x: 0.92, y: 0.94 }, bl: { x: 0.08, y: 0.94 } };
function photo({ dark = 1, corners = CORNERS, glare = false, seed = 7 } = {}) {
  const data = new Uint8ClampedArray(W * H * 4);
  let s = seed; const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const quad = ['tl', 'tr', 'br', 'bl'].map((k) => ({ x: corners[k].x * W, y: corners[k].y * H }));
  const inside = (x, y) => { let c = false; for (let i = 0, j = 3; i < 4; j = i++) { const a = quad[i], b = quad[j]; if (((a.y > y) !== (b.y > y)) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) c = !c; } return c; };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const o = (y * W + x) * 4; let v;
    if (inside(x, y)) {
      const ix = (x - quad[0].x) / (quad[1].x - quad[0].x), iy = (y - quad[0].y) / (quad[3].y - quad[0].y);
      const art = ix > 0.08 && ix < 0.92 && iy > 0.08 && iy < 0.55;
      v = art ? 70 + 120 * (Math.sin(x / 9) * Math.cos(y / 13) * 0.5 + 0.5) : 200;
      // printed texture like a real card: halftone dots in the art, fine text lines in the lower half
      if (art) v += ((x % 4 < 2) !== (y % 4 < 2) ? 22 : -22);
      else if (iy > 0.6 && iy < 0.9 && ix > 0.1 && ix < 0.9 && (y % 7 < 2) && (x % 5 < 3)) v -= 120;
    } else v = 28;
    v = v * dark + (rnd() - 0.5) * 2;
    data[o] = v; data[o + 1] = v * 0.98; data[o + 2] = v * 0.95; data[o + 3] = 255;
    if (glare && (x - W * 0.5) ** 2 + (y - H * 0.35) ** 2 < 170 ** 2) { data[o] = data[o + 1] = data[o + 2] = 255; }
  }
  return { data, width: W, height: H };
}
function boxBlur(img, r) {
  const { data, width: w, height: h } = img, out = new Uint8ClampedArray(data.length);
  const tmp = new Float32Array(data.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let k = 0; k < 3; k++) { let s = 0, n = 0; for (let d = -r; d <= r; d++) { const xx = Math.min(w - 1, Math.max(0, x + d)); s += data[(y * w + xx) * 4 + k]; n++; } tmp[(y * w + x) * 4 + k] = s / n; }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { for (let k = 0; k < 3; k++) { let s = 0, n = 0; for (let d = -r; d <= r; d++) { const yy = Math.min(h - 1, Math.max(0, y + d)); s += tmp[(yy * w + x) * 4 + k]; n++; } out[(y * w + x) * 4 + k] = s / n; } out[(y * w + x) * 4 + 3] = 255; }
  return { data: out, width: w, height: h };
}

const clean = photoConfidence(photo(), CORNERS);
ok('a clean, sharp, evenly lit photo scores high and flags nothing serious', () => {
  assert.ok(clean.score >= 9, JSON.stringify(clean));
  assert.ok(Object.values(clean.issues).every((v) => v < 0.25), JSON.stringify(clean.issues));
});
ok('blur is detected (the re-blur test) and costs points', () => {
  const r = photoConfidence(boxBlur(photo(), 6), CORNERS);
  assert.ok(r.issues.blur > 0.5, JSON.stringify(r.measures)); assert.ok(r.score < clean.score - 1.5);
});
ok('a dark photo is flagged as underexposed', () => {
  const r = photoConfidence(photo({ dark: 0.3 }), CORNERS);
  assert.ok(r.issues.dark > 0.5, JSON.stringify(r.measures)); assert.ok(r.score < clean.score - 1);
});
ok('a blown-out patch on the card is flagged as glare', () => {
  const r = photoConfidence(photo({ glare: true }), CORNERS);
  assert.ok(r.issues.glare > 0.5, JSON.stringify(r.measures)); assert.ok(r.score < clean.score - 1);
});
ok('a card shot at an angle is flagged', () => {
  const skew = { tl: { x: 0.2, y: 0.06 }, tr: { x: 0.8, y: 0.1 }, br: { x: 0.94, y: 0.94 }, bl: { x: 0.06, y: 0.92 } };
  const r = photoConfidence(photo({ corners: skew }), skew);
  assert.ok(r.issues.angle > 0.5, JSON.stringify(r.measures));
});
ok('a corner outside the photo means the whole card is not there: score 1', () => {
  const cut = { tl: { x: 0.0, y: 0.06 }, tr: { x: 0.92, y: 0.06 }, br: { x: 0.92, y: 0.94 }, bl: { x: 0.08, y: 0.94 } };
  const r = photoConfidence(photo({ corners: cut }), cut);
  assert.equal(r.cutoff, true); assert.equal(r.score, 1);
});
ok('a pre-cropped studio scan skips framing and angle', () => {
  const full = { tl: { x: 0, y: 0 }, tr: { x: 1, y: 0 }, br: { x: 1, y: 1 }, bl: { x: 0, y: 1 } };
  const r = photoConfidence(photo(), full, { deskewed: true });
  assert.equal(r.cutoff, false); assert.equal(r.issues.angle, 0); assert.equal(r.issues.small, 0);
});
ok('phones stop at 9.4; the rig can reach 10', () => {
  assert.equal(capForSource(9.9, 'phone'), PHONE_CAP); assert.equal(capForSource(9.9, 'rig'), 9.9); assert.equal(capForSource(6.2), 6.2);
});
console.log(`${passed} passed, 0 failed`);
