/*
 * SlabSense — https://www.slabsenseai.com
 * Copyright (c) 2026 SlabSense. All rights reserved.
 * Proprietary and confidential; see LICENSE at the repository root.
 */
import assert from 'node:assert/strict';
import { BANDS, bandFor, problemsFor, lensLayers } from './confidence-copy.js';

let passed = 0;
const ok = (n, f) => { f(); passed++; console.log(`  ✓ ${n}`); };
const none = { glare: 0, blur: 0, dark: 0, fog: 0, grain: 0, angle: 0, uneven: 0, small: 0 };

ok('bands follow the agreed ranges', () => {
  assert.equal(bandFor(1.0).name, 'Cloudy'); assert.equal(bandFor(2.9).name, 'Cloudy');
  assert.equal(bandFor(3.0).name, 'Hazy'); assert.equal(bandFor(6.9).name, 'Clear');
  assert.equal(bandFor(7.0).name, 'Sharp'); assert.equal(bandFor(9.4).name, 'Brilliant'); assert.equal(bandFor(9.5).name, 'Studio');
});
ok('problems are the measured ones, worst first, each with a fix', () => {
  const p = problemsFor({ ...none, glare: 0.4, blur: 0.9, small: 0.2 }, false);
  assert.deepEqual(p.map((x) => x.key), ['blur', 'glare']);
  assert.ok(p.every((x) => x.label && x.fix));
});
ok('a cut-off card is the only problem that matters', () => {
  const p = problemsFor({ ...none, blur: 0.8 }, true);
  assert.equal(p[0].key, 'cutoff'); assert.match(p[0].fix, /four corners/);
});
ok('lens layers map the measurements onto the medallion renders', () => {
  assert.deepEqual(lensLayers({ ...none, glare: 0.5, grain: 0.2 }, false), { glare: 0.5, blur: 0, dark: 0, fog: 0, grain: 0.2, finger: 0 });
  assert.equal(lensLayers(none, true).finger, 0.85);
});
ok('no message promises a margin or an outcome (owner, 2026-10-03)', () => {
  for (const b of BANDS) {
    assert.doesNotMatch(b.msg, /\d|off by|within|half a grade|two grades/i, b.name);
  }
  for (const b of BANDS.filter((x) => x.min < 7)) assert.match(b.msg, /do(es)? not change the card/i, b.name);
});
console.log(`${passed} passed, 0 failed`);
