/*
 * SlabSense — https://www.slabsenseai.com
 * Copyright (c) 2026 SlabSense. All rights reserved.
 * Proprietary and confidential; see LICENSE at the repository root.
 */
import assert from 'node:assert/strict';
import { PRODUCTS, FREE_TIER, FEEDBACK_EMAIL, isUnlimited, APPLE_SUBSCRIPTION_TERMS } from './products.js';

let passed = 0;
const ok = (n, f) => { f(); passed++; console.log(`  ✓ ${n}`); };

ok('owner prices of 2026-10-02', () => {
  assert.equal(PRODUCTS.sub_monthly.webPrice, 9.99);
  assert.equal(PRODUCTS.pack_5.webPrice, 4.99);
  assert.equal(PRODUCTS.pack_20.webPrice, 14.99);
});
ok('plan allowance 5, trial 5 days with 2 grades', () => {
  assert.equal(PRODUCTS.sub_monthly.allowance, 5);
  assert.deepEqual(PRODUCTS.sub_monthly.trial, { days: 5, grades: 2 });
});
ok('free tier: 10 on-device grades a month, no AI grades', () => {
  assert.deepEqual(FREE_TIER, { gradesPerMonth: 10, aiGrades: 0 });
});
ok('unlimited on-device grades for plan, trial and lifetime; not for free', () => {
  for (const s of ['sub_monthly', 'trialing', 'lifetime', 'beta_lifetime']) assert.equal(isUnlimited(s), true, s);
  for (const s of ['free', 'expired', 'past_due', null, undefined]) assert.equal(isUnlimited(s), false, String(s));
});
ok('feedback address and trial wording in the Apple terms', () => {
  assert.equal(FEEDBACK_EMAIL, 'support@slabsenseai.com');
  assert.match(APPLE_SUBSCRIPTION_TERMS, /5-day free trial/);
});
ok('review #6: unlimited needs a current period; lifetime ignores dates; grace keeps access', () => {
  const now = new Date('2026-10-10T00:00:00Z');
  assert.equal(isUnlimited('sub_monthly', '2026-11-01T00:00:00Z', now), true);
  assert.equal(isUnlimited('trialing', '2026-10-09T00:00:00Z', now), true, 'inside the 3-day slack');
  assert.equal(isUnlimited('sub_monthly', '2026-09-30T00:00:00Z', now), false, 'a missed expiry notice does not mean unlimited forever');
  assert.equal(isUnlimited('lifetime', null, now), true);
  assert.equal(isUnlimited('grace', '2026-10-12T00:00:00Z', now), true);
});
console.log(`${passed} passed, 0 failed`);
