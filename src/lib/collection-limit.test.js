/*
 * SlabSense — https://www.slabsenseai.com
 * Copyright (c) 2026 SlabSense. All rights reserved.
 * Proprietary and confidential; see LICENSE at the repository root.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { isCollectionLimitError, collectionLimitMessage } from './collection-limit.js';
import { FREE_TIER } from './products.js';

let passed = 0;
const ok = (n, f) => { f(); passed++; console.log(`  ✓ ${n}`); };

ok('the database refusal is recognised; other errors are not', () => {
  assert.equal(isCollectionLimitError({ code: 'P0001', message: 'collection_limit_reached: 25' }), true);
  assert.equal(isCollectionLimitError({ code: '23505', message: 'duplicate key' }), false);
  assert.equal(isCollectionLimitError(null), false);
});
ok('the message names the limit and the way out', () => {
  assert.equal(collectionLimitMessage(), `Your free collection holds ${FREE_TIER.collectionLimit} cards. Delete one or get SlabSense Plus for an unlimited collection.`);
});
ok('the migration enforces the same number as the catalogue', () => {
  const sql = fs.readFileSync(new URL('../../supabase/migrations/20261003_free_grades.sql', import.meta.url), 'utf8');
  const m = /v_collection_limit\s+integer\s*:=\s*(\d+)/.exec(sql);
  assert.ok(m, 'migration declares v_collection_limit');
  assert.equal(Number(m[1]), FREE_TIER.collectionLimit);
});
console.log(`${passed} passed, 0 failed`);
