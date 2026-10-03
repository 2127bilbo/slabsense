/*
 * SlabSense — https://www.slabsenseai.com
 * Copyright (c) 2026 SlabSense. All rights reserved.
 * Proprietary and confidential; see LICENSE at the repository root.
 */
import assert from 'node:assert/strict';
import { chargeFreeGrade } from './free-grade-charge.js';

let passed = 0;
const ok = async (n, f) => { await f(); passed++; console.log(`  ✓ ${n}`); };
const err = (status, data) => Object.assign(new Error('x'), { status, data });

await ok('a counted free grade shows the result and the new count', async () => {
  assert.deepEqual(await chargeFreeGrade(async () => ({ success: true, freeGrades: { remaining: 6 } }), 'u1'), { show: true, unlimited: false, remaining: 6 });
});
await ok('an unlimited account shows the result without a count', async () => {
  assert.deepEqual(await chargeFreeGrade(async () => ({ success: true, unlimited: true }), 'u1'), { show: true, unlimited: true, remaining: null });
});
await ok('the limit (402) hides the result behind the limit card', async () => {
  const fg = { used: 10, limit: 10, remaining: 0 };
  assert.deepEqual(await chargeFreeGrade(async () => { throw err(402, { freeGrades: fg }); }, 'u1'), { show: false, gate: { kind: 'limit', freeGrades: fg } });
});
await ok('an expired sign-in (401) asks to sign in again', async () => {
  assert.deepEqual(await chargeFreeGrade(async () => { throw err(401, {}); }, 'u1'), { show: false, gate: { kind: 'signin' } });
});
await ok('any other failure is an error, not a free grade', async () => {
  const r = await chargeFreeGrade(async () => { throw err(500, {}); }, 'u1');
  assert.equal(r.show, false); assert.match(r.error, /could not record/);
});
console.log(`${passed} passed, 0 failed`);
