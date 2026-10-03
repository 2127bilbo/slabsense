/*
 * SlabSense — https://www.slabsenseai.com
 * Copyright (c) 2026 SlabSense. All rights reserved.
 * Proprietary and confidential; see LICENSE at the repository root.
 */
import assert from 'node:assert/strict';
import { monthKey, freeGradeView, useFreeGradeWithDb } from './freeGrades.js';

let passed = 0;
const ok = async (n, f) => { await f(); passed++; console.log(`  ✓ ${n}`); };

await ok('month key is UTC year-month', async () => {
  assert.equal(monthKey(new Date('2026-10-02T03:00:00Z')), '2026-10');
  assert.equal(monthKey(new Date('2026-12-31T23:59:59Z')), '2026-12');
});
await ok('a new month resets the counter in the view', async () => {
  const sept = { free_grades_month: '2026-09', free_grades_used: 10 };
  assert.deepEqual(freeGradeView(sept, 10, new Date('2026-10-01T00:00:01Z')), { month: '2026-10', used: 0, limit: 10, remaining: 10 });
  assert.deepEqual(freeGradeView({ free_grades_month: '2026-10', free_grades_used: 3 }, 10, new Date('2026-10-05T00:00:00Z')), { month: '2026-10', used: 3, limit: 10, remaining: 7 });
  assert.deepEqual(freeGradeView({}, 10, new Date('2026-10-05T00:00:00Z')), { month: '2026-10', used: 0, limit: 10, remaining: 10 });
});
await ok('spend route shape: 200 with the counter, 402 when exhausted, 404 unknown user', async () => {
  const db = (reply) => ({ rpc: async (fn, args) => { assert.equal(fn, 'use_free_grade'); assert.equal(args.p_limit, 10); return { data: reply, error: null }; } });
  let r = await useFreeGradeWithDb(db({ success: true, used: 4, limit: 10, remaining: 6, month: '2026-10' }), { userId: 'u1', limit: 10 });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { success: true, freeGrades: { used: 4, limit: 10, remaining: 6, month: '2026-10' } });
  r = await useFreeGradeWithDb(db({ success: false, error: 'free_grades_exhausted', used: 10, limit: 10, remaining: 0, month: '2026-10' }), { userId: 'u1', limit: 10 });
  assert.equal(r.status, 402); assert.equal(r.body.error, 'free_grades_exhausted'); assert.equal(r.body.freeGrades.remaining, 0);
  r = await useFreeGradeWithDb(db({ success: false, error: 'user_not_found' }), { userId: 'u1', limit: 10 });
  assert.equal(r.status, 404);
});
console.log(`${passed} passed, 0 failed`);
