/*
 * SlabSense — https://www.slabsenseai.com
 * Copyright (c) 2026 SlabSense. All rights reserved.
 * Proprietary and confidential; see LICENSE at the repository root.
 */
import assert from 'node:assert/strict';
import { planSummary, plusOffer } from './plan-summary.js';

let passed = 0;
const ok = (n, f) => { f(); passed++; console.log(`  ✓ ${n}`); };
const fmt = { locale: 'en-US', timeZone: 'UTC' };
const free = { subscription: 'free', unlimitedGrades: false, freeGrades: { used: 3, limit: 10, remaining: 7, month: '2026-10' },
  credits: 0, packCredits: 0, subCredits: 0, cardsSaved: 12, cardLimit: 25, isLifetime: false };
const row = (s, key) => s.rows.find((r) => r.key === key);

ok('free account: counts against the monthly and collection limits', () => {
  const s = planSummary(free, fmt);
  assert.equal(s.plan, 'free'); assert.equal(s.name, 'Free');
  assert.equal(row(s, 'grades').value, '7 of 10 left'); assert.equal(row(s, 'grades').detail, 'Resets Nov 1');
  assert.equal(row(s, 'ai').value, '0'); assert.equal(row(s, 'cards').value, '12 of 25');
  assert.deepEqual(s.actions, ['plus', 'packs']);
  assert.equal(row(s, 'grades').meter, 0.7); assert.equal(row(s, 'cards').meter, 0.48); assert.equal(row(s, 'ai').meter, null);
});
ok('free account with a pack: pack grades show as never expiring', () => {
  const s = planSummary({ ...free, credits: 5, packCredits: 5 }, fmt);
  assert.equal(row(s, 'ai').value, '5'); assert.equal(row(s, 'ai').detail, '5 from packs, never expire');
});
ok('free account at its card limit is flagged', () => {
  assert.equal(row(planSummary({ ...free, cardsSaved: 25 }, fmt), 'cards').warn, true);
  assert.equal(row(planSummary(free, fmt), 'cards').warn, false);
});
ok('trial: end date, unlimited grades and the two trial AI Grades', () => {
  const s = planSummary({ ...free, subscription: 'trialing', unlimitedGrades: true, renewsAt: '2026-10-08T10:00:00Z',
    credits: 2, subCredits: 2, subCreditsExpireAt: '2026-10-08T10:00:00Z', cardLimit: null }, fmt);
  assert.equal(s.plan, 'trial'); assert.equal(s.name, 'Plus trial'); assert.equal(s.dateLine, 'Trial ends Oct 8');
  assert.equal(row(s, 'grades').value, 'Unlimited'); assert.equal(row(s, 'grades').meter, null); assert.equal(row(s, 'cards').value, '12 saved'); assert.equal(row(s, 'cards').detail, 'No limit');
  assert.equal(row(s, 'ai').detail, '2 from your plan, until Oct 8');
  assert.deepEqual(s.actions, ['packs', 'manage']);
});
ok('Plus with plan and pack grades shows both buckets', () => {
  const s = planSummary({ ...free, subscription: 'sub_monthly', unlimitedGrades: true, renewsAt: '2026-10-30T00:00:00Z',
    credits: 9, subCredits: 4, packCredits: 5, subCreditsExpireAt: '2026-10-30T00:00:00Z', cardLimit: null, cardsSaved: 80 }, fmt);
  assert.equal(s.plan, 'plus'); assert.equal(s.name, 'SlabSense Plus'); assert.equal(s.dateLine, 'Renews Oct 30');
  assert.equal(row(s, 'ai').value, '9'); assert.equal(row(s, 'ai').detail, '4 from your plan, until Oct 30 · 5 from packs, never expire');
  assert.equal(row(s, 'cards').value, '80 saved');
});
ok('a lapsed paid status reads as free (the server no longer grants unlimited)', () => {
  const s = planSummary({ ...free, subscription: 'sub_monthly', unlimitedGrades: false, renewsAt: '2026-09-01T00:00:00Z' }, fmt);
  assert.equal(s.plan, 'free');
});
ok('past due: asks for a card update and offers Manage first', () => {
  const s = planSummary({ ...free, subscription: 'past_due' }, fmt);
  assert.equal(s.plan, 'past_due'); assert.match(s.dateLine, /payment did not go through/i);
  assert.equal(s.actions[0], 'manage');
});
ok('lifetime: unlimited everything, nothing to buy but packs', () => {
  const s = planSummary({ ...free, subscription: 'beta_lifetime', isLifetime: true, unlimitedGrades: true, cardLimit: null }, fmt);
  assert.equal(s.plan, 'lifetime'); assert.equal(row(s, 'ai').value, 'Unlimited'); assert.deepEqual(s.actions, []);
});
ok('December resets on January 1', () => {
  const s = planSummary({ ...free, freeGrades: { ...free.freeGrades, month: '2026-12' } }, fmt);
  assert.equal(row(s, 'grades').detail, 'Resets Jan 1');
});
ok('missing balance gives null', () => { assert.equal(planSummary(null, fmt), null); });
ok('Plus button: trial only for accounts that never had one', () => {
  assert.deepEqual(plusOffer({ ...free, trialUsed: false }), { cta: 'Start 5-day free trial', trial: true, current: false });
  assert.deepEqual(plusOffer({ ...free, trialUsed: true }), { cta: 'Subscribe', trial: false, current: false });
  assert.deepEqual(plusOffer(null), { cta: 'Start 5-day free trial', trial: true, current: false });
});
ok('Plus button: already on Plus or trial reads as the current plan', () => {
  assert.equal(plusOffer({ ...free, subscription: 'trialing', unlimitedGrades: true }).current, true);
  assert.equal(plusOffer({ ...free, subscription: 'sub_monthly', unlimitedGrades: true }).cta, 'Current plan');
  assert.equal(plusOffer({ ...free, subscription: 'past_due', trialUsed: true }).cta, 'Current plan');
});
console.log(`${passed} passed, 0 failed`);
