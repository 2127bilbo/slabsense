/*
 * SlabSense — https://www.slabsenseai.com
 * Copyright (c) 2026 SlabSense. All rights reserved.
 * Proprietary and confidential; see LICENSE at the repository root.
 */
import assert from 'node:assert/strict';
import { calcConfidence, getNextGradeInfo } from './grade-insights.js';
import { computeGrade } from './softwareGrade.js';

let passed = 0;
const ok = (n, f) => { f(); passed++; console.log(`  ✓ ${n}`); };
const C = { lrRatio: 52, tbRatio: 51 };
const corner = (side, sev = 2) => ({ side, type: 'CORNER WEAR', severity: sev });
const edge = (side) => ({ side, type: 'EDGE WEAR', severity: 1 });
const grade = (f, b) => computeGrade(f, b, C, C, 'tag', null);
const texts = (g) => getNextGradeInfo(g).map((t) => t.text).join('\n');

ok('detector results without a surface block do not break the confidence notes', () => {
  const g = grade([corner('FRONT')], []);
  const r = calcConfidence(g, { centering: C }, { centering: C });
  assert.ok(r.level); assert.ok(Array.isArray(r.reasons));
  assert.doesNotMatch(r.reasons.join(' '), /surface|holo/i);
});
ok('tips name the subgrade that limits the grade', () => {
  assert.match(texts(grade([corner('FRONT', 3)], [])), /front corners/i);
  assert.match(texts(grade([], [edge('BACK'), edge('BACK'), edge('BACK')])), /back edges/i);
});
ok('tips count defects by side from what was found', () => {
  assert.match(texts(grade([corner('FRONT'), edge('FRONT')], [corner('BACK')])), /2 on the front and 1 on the back/);
});
ok('tips say the surface was not inspected and point to the AI Grade', () => {
  assert.match(texts(grade([], [])), /surface.*not inspected.*AI Grade/i);
});
ok('no old-engine claims: weights, typical-grade patterns or surface verdicts', () => {
  for (const g of [grade([], []), grade([corner('FRONT')], []), grade([corner('FRONT', 3), corner('FRONT', 3), edge('FRONT'), edge('BACK'), corner('BACK', 3)], [])]) {
    assert.doesNotMatch(texts(g), /2x|weigh|usually|characteristic|range|heaviest|biggest grade limiter/i);
  }
});
console.log(`${passed} passed, 0 failed`);
