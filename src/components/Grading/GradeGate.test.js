/*
 * SlabSense — https://www.slabsenseai.com
 * Copyright (c) 2026 SlabSense. All rights reserved.
 * Proprietary and confidential; see LICENSE at the repository root.
 */
import assert from 'node:assert/strict';
import { gradeButtonLabel } from './gradeButtonLabel.js';

let passed = 0;
const ok = (n, f) => { f(); passed++; console.log(`  ✓ ${n}`); };

ok('no photos yet', () => assert.equal(gradeButtonLabel({ hasPhotos: false, signedIn: true }), 'Capture both sides'));
ok('signed out asks to sign in', () => assert.equal(gradeButtonLabel({ hasPhotos: true, signedIn: false }), '▶  Sign in to see your grade'));
ok('unlimited shows no counter', () => assert.equal(gradeButtonLabel({ hasPhotos: true, signedIn: true, unlimited: true, remaining: 3 }), '▶  Get my grade'));
ok('free account shows the remaining count', () => assert.equal(gradeButtonLabel({ hasPhotos: true, signedIn: true, unlimited: false, remaining: 7 }), '▶  Get my grade (7 free left this month)'));
ok('free account at the cap', () => assert.equal(gradeButtonLabel({ hasPhotos: true, signedIn: true, unlimited: false, remaining: 0 }), 'Free limit reached'));
ok('balance not loaded yet still lets the tap through (the server decides)', () => assert.equal(gradeButtonLabel({ hasPhotos: true, signedIn: true, unlimited: false, remaining: null }), '▶  Get my grade'));
console.log(`${passed} passed, 0 failed`);
