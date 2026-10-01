import assert from 'node:assert/strict';
import { gradeCard } from '../../src/lib/gradingEngine.js';
import { applyGradeRollup, modelGradeFor, gradeRollupEnabled } from './gradeRollup.js';

let passed = 0;
const ok = (name, fn) => { fn(); passed++; console.log(`  ✓ ${name}`); };
const engine = gradeCard({ defects: [{ side: 'FRONT', type: 'CORNER', severity: 'minor', location: 'top-left' }], centering: { front: { lrRatio: 52, tbRatio: 51 }, back: { lrRatio: 55, tbRatio: 50 } } });

ok('flag off: engine grade kept, model reported in meta', () => {
  assert.equal(gradeRollupEnabled({}), false);
  const r = applyGradeRollup(engine, engine.overall, {});
  assert.equal(r.overall, engine.overall);
  assert.equal(r.meta.gradeRollupSource, 'engine');
  assert.ok(r.meta.gradeRollup.label && r.meta.gradeRollup.displayGrade);
});

ok('flag on: model label becomes the grade, score and subgrades untouched', () => {
  const r = applyGradeRollup(engine, engine.overall, { GRADE_ROLLUP_MODEL: '1' });
  const m = modelGradeFor(engine);
  assert.equal(r.meta.gradeRollupSource, 'model');
  assert.equal(r.overall.grade, m.grade);
  assert.equal(r.overall.label, m.label);
  assert.equal(r.overall.score, engine.overall.score);
  assert.equal(r.overall.engineGrade, engine.overall.grade);
});

console.log(`${passed} passed, 0 failed`);
