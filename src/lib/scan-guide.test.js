/*
 * SlabSense — https://www.slabsenseai.com
 * Copyright (c) 2026 SlabSense. All rights reserved.
 * Proprietary and confidential; see LICENSE at the repository root.
 */
import assert from 'node:assert/strict';
import { SLIDES, shouldAutoShowGuide, markGuideSeen, GUIDE_KEY } from './scan-guide.js';

let passed = 0;
const ok = (n, f) => { f(); passed++; console.log(`  ✓ ${n}`); };
const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) }; };

ok('four slides, each with a title, body and animation', () => {
  assert.equal(SLIDES.length, 4);
  for (const s of SLIDES) { assert.ok(s.key && s.title && s.body && s.anim, s.key); }
});
ok('slides cover background, framing, light and the auto-snap', () => {
  assert.deepEqual(SLIDES.map((s) => s.key), ['background', 'frame', 'light', 'steady']);
});
ok('slide copy makes no grade promises', () => {
  for (const s of SLIDES) assert.doesNotMatch(`${s.title} ${s.body}`, /off by|within|better grade|guarantee/i, s.key);
});
ok('shows automatically until it is marked seen', () => {
  const st = mem();
  assert.equal(shouldAutoShowGuide(st), true);
  markGuideSeen(st);
  assert.equal(st.getItem(GUIDE_KEY), '1');
  assert.equal(shouldAutoShowGuide(st), false);
});
ok('storage that throws (private mode) shows the guide and does not crash', () => {
  const bad = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
  assert.equal(shouldAutoShowGuide(bad), true);
  assert.doesNotThrow(() => markGuideSeen(bad));
});
console.log(`${passed} passed, 0 failed`);
