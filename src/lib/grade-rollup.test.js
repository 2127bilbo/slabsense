/*
 * SlabSense — https://www.slabsenseai.com
 * Copyright (c) 2026 SlabSense. All rights reserved.
 * Proprietary and confidential; see LICENSE at the repository root.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rollupFeatures, predictGradeIndex, rollupGrade, checkTestVectors, MODEL_GRADE_TO_DISPLAY } from './grade-rollup.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const MODEL = JSON.parse(fs.readFileSync(path.join(here, '..', '..', 'api', '_lib', 'models', 'grade-rollup-v1.json'), 'utf8'));

let passed = 0;
const ok = (name, fn) => { fn(); passed++; console.log(`  ✓ ${name}`); };

ok('model file has the expected contract', () => {
  assert.equal(MODEL.features.length, 9);
  assert.equal(MODEL.grades.length, 19);
  assert.deepEqual(MODEL.clip, [0, 18]);
  for (const g of MODEL.grades) assert.ok(MODEL_GRADE_TO_DISPLAY[g], `no display label for ${g}`);
});

ok('all 20 shipped test vectors reproduce exactly', () => {
  assert.equal((MODEL.test_vectors || []).length, 20);
  const bad = checkTestVectors(MODEL);
  assert.deepEqual(bad, [], `failed vectors: ${JSON.stringify(bad.slice(0, 2))}`);
});

ok('a clean card maps to the top of the scale, a wrecked one to the bottom', () => {
  const clean = predictGradeIndex([1000, 1000, 1000, 1000, 1000, 1000, 0, 0, 0], MODEL);
  const wrecked = predictGradeIndex([300, 200, 250, 150, 150, 200, 20, 20, 6], MODEL);
  assert.ok(clean >= 16.5, `clean ${clean}`);
  assert.ok(wrecked <= 4, `wrecked ${wrecked}`);
});

ok('engine subgrades map to features in model order with the side weights', () => {
  const sub = { frontCentering: 90, backCentering: 80, frontCorners: 100, backCorners: 100, frontEdges: 95, backEdges: 85, frontSurface: 70, backSurface: 100 };
  const defects = [
    { side: 'FRONT', type: 'CORNER' }, { side: 'BACK', type: 'EDGE' }, { side: 'FRONT', type: 'SCRATCH' }, { side: 'BACK', type: 'CREASE' }, { side: 'BACK', type: 'STAIN' },
  ];
  const f = rollupFeatures(sub, defects);
  assert.equal(f.length, 9);
  assert.equal(f[0], 10 * (0.6 * 90 + 0.4 * 80));
  assert.equal(f[1], 1000);
  assert.equal(f[3], 10 * (0.6 * 70 + 0.4 * 100));
  assert.equal(f[4], 700); assert.equal(f[5], 1000);
  assert.deepEqual(f.slice(6), [1, 2, 2]);
});

ok('front-only cards use the front for the back', () => {
  const f = rollupFeatures({ frontCentering: 90, backCentering: null, frontCorners: 80, backCorners: null, frontEdges: 70, backEdges: null, frontSurface: 60, backSurface: null }, []);
  assert.deepEqual(f.slice(0, 6), [900, 800, 700, 600, 600, 600]);
});

ok('rollupGrade returns a label the app can display', () => {
  const g = rollupGrade({ frontCentering: 97, backCentering: 97, frontCorners: 100, backCorners: 100, frontEdges: 100, backEdges: 100, frontSurface: 100, backSurface: 100 }, [], MODEL);
  assert.ok(['10', '10P', '9'].includes(g.displayGrade), g.displayGrade);
  assert.equal(g.grade, Number.parseFloat(g.displayGrade));
  assert.equal(MODEL.grades[g.index], g.label);
});

console.log(`${passed} passed, 0 failed`);
