/*
 * SlabSense — https://www.slabsenseai.com
 * Copyright (c) 2026 SlabSense. All rights reserved.
 * Proprietary and confidential; see LICENSE at the repository root.
 */
import assert from 'node:assert/strict';
import { captureAdvice, RETAKE_BELOW } from './capture-advice.js';

let passed = 0;
const ok = (n, f) => { f(); passed++; console.log(`  ✓ ${n}`); };
const good = { valid: true, issues: [], corners: {} };
const conf = (score, extra = {}) => ({ score, issues: {}, cutoff: false, ...extra });

ok('a good photo is used as is', () => {
  const a = captureAdvice(good, conf(9.2));
  assert.equal(a.verdict, 'good'); assert.equal(a.primary, 'use'); assert.equal(a.useLabel, 'Use Photo');
});
ok('a fair score keeps Use Photo first but says it could be better', () => {
  const a = captureAdvice(good, conf(6.1));
  assert.equal(a.verdict, 'fair'); assert.equal(a.primary, 'use'); assert.match(a.message, /retake/i);
});
ok(`below ${RETAKE_BELOW} a retake is recommended and Use Anyway is the fallback`, () => {
  const a = captureAdvice(good, conf(4.4));
  assert.equal(a.verdict, 'retake'); assert.equal(a.primary, 'retake'); assert.equal(a.useLabel, 'Use Anyway');
});
ok('a cut-off card always asks for a retake', () => {
  const a = captureAdvice(good, conf(1, { cutoff: true }));
  assert.equal(a.verdict, 'retake'); assert.match(a.headline, /outside the photo/i);
});
ok('no card found asks for a retake with the detector reason', () => {
  const a = captureAdvice({ valid: false, issues: ['Card not found'], corners: null }, null);
  assert.equal(a.verdict, 'retake'); assert.equal(a.headline, 'Card not found');
});
ok('detector issues with a decent score read as fair', () => {
  const a = captureAdvice({ valid: false, issues: ['Card too small — move closer'], corners: {} }, conf(8));
  assert.equal(a.verdict, 'fair'); assert.equal(a.primary, 'use');
});
ok('no score (slab or odd outline) falls back to the detector', () => {
  assert.equal(captureAdvice(good, null).verdict, 'good');
  assert.equal(captureAdvice({ valid: false, issues: ['x'], corners: {} }, null).verdict, 'fair');
});
ok('advice says a retake is free and never promises a grade', () => {
  for (const a of [captureAdvice(good, conf(4)), captureAdvice(good, conf(6)), captureAdvice(good, conf(9))]) {
    assert.doesNotMatch(`${a.headline} ${a.message}`, /\d|off by|within|better grade|higher grade/i);
  }
  assert.match(captureAdvice(good, conf(4)).message, /retaking is free/i);
});
ok('still checking: no verdict yet', () => { assert.equal(captureAdvice(null, null), null); });
console.log(`${passed} passed, 0 failed`);
