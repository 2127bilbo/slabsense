/*
 * SlabSense — https://www.slabsenseai.com
 * Copyright (c) 2026 SlabSense. All rights reserved.
 * Proprietary and confidential; see LICENSE at the repository root.
 */
import assert from 'node:assert/strict';
import { TIPS, GRADE_KINDS, FAQ, allHelpText } from './help-content.js';
import { FREE_TIER, PRODUCTS, FEEDBACK_EMAIL } from './products.js';

let passed = 0;
const ok = (n, f) => { f(); passed++; console.log(`  ✓ ${n}`); };

ok('every tip, grade kind and question is complete', () => {
  assert.ok(TIPS.length >= 6); for (const t of TIPS) assert.ok(t.key && t.title && t.body, t.key);
  assert.deepEqual(GRADE_KINDS.map((g) => g.key), ['centering', 'grade', 'ai']);
  for (const g of GRADE_KINDS) assert.ok(g.name && g.cost && g.summary && g.details.length, g.key);
  assert.ok(FAQ.length >= 10); for (const q of FAQ) assert.ok(q.key && q.q.endsWith('?') && q.a, q.key);
  assert.equal(new Set(FAQ.map((q) => q.key)).size, FAQ.length);
});
ok('numbers come from the product catalogue, not hand-typed copies', () => {
  const text = allHelpText();
  assert.match(text, new RegExp(`${FREE_TIER.gradesPerMonth} a month`));
  assert.match(text, new RegExp(`${PRODUCTS.sub_monthly.trial.days}-day`));
  assert.match(text, new RegExp(`${PRODUCTS.sub_monthly.allowance} AI Grades`));
  assert.match(text, new RegExp(FEEDBACK_EMAIL.replace('.', '\\.')));
});
ok('no grade margins or promises (owner, 2026-10-03)', () => {
  assert.doesNotMatch(allHelpText(), /off by|within (about|half|one grade|a grade|\d)|half a grade|guarantee|accurate to|\d+ ?%/i);
});
ok('no claims about features SlabSense does not have', () => {
  assert.doesNotMatch(allHelpText(), /blockchain|NFT|community|unlimited AI|simulation/i);
});
ok('honest about being an estimate and not affiliated', () => {
  const official = FAQ.find((q) => q.key === 'official');
  assert.match(official.a, /estimate/i); assert.match(official.a, /not affiliated/i);
});
ok('the free grade is described without a surface check (removed 2026-10-03)', () => {
  const free = GRADE_KINDS.find((g) => g.key === 'grade');
  const text = [free.summary, ...free.details].join(' ');
  assert.match(text, /surface is not inspected/i);
  assert.doesNotMatch(text, /basic (check|surface)/i);
});
console.log(`${passed} passed, 0 failed`);
