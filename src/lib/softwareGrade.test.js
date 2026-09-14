/**
 * Adapter guard: legacy dings → engine defects → computeGrade output shape.
 * Run: node src/lib/softwareGrade.test.js
 */
import { computeGrade, dingToEngineDefect, mapDingType, mapDingSeverity } from './softwareGrade.js';

let passed = 0, failed = 0;
const check = (name, ok, extra = '') => {
  if (ok) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name} ${extra}`); }
};

console.log('— mapping');
check('CORNER WEAR → CORNER', mapDingType('CORNER WEAR') === 'CORNER');
check('EDGE WEAR → EDGE', mapDingType('EDGE WEAR') === 'EDGE');
check('SURFACE / PLAY WEAR → PLAY_WEAR', mapDingType('SURFACE / PLAY WEAR') === 'PLAY_WEAR');
check('CENTERING → null', mapDingType('CENTERING') === null);
check('severity 1/2/3 → minor/moderate/severe', mapDingSeverity(1) === 'minor' && mapDingSeverity(2) === 'moderate' && mapDingSeverity(3) === 'severe');
check('centering ding dropped', dingToEngineDefect({ type: 'CENTERING', side: 'FRONT', severity: 3 }) === null);

console.log('— computeGrade');
const clean = computeGrade([], [], { lrRatio: 50, tbRatio: 50 }, { lrRatio: 50, tbRatio: 50 }, 'tag', null);
check('clean card TAG score 995', clean.rawScore === 995, `got ${clean.rawScore}`);
check('clean card overall grade 10', clean.overall.grade === 10);
check('companyGrades has all five', ['tag', 'psa', 'bgs', 'cgc', 'sgc'].every(k => clean.companyGrades[k]));
check('8 subgrade keys', Object.keys(clean.subgrades).length === 8);
check('gradePath software', clean.gradePath === 'software');

const worn = computeGrade(
  [{ side: 'FRONT', type: 'CORNER WEAR', location: 'FRONT / TOP LEFT', severity: 2 }],
  [], { lrRatio: 50, tbRatio: 50 }, { lrRatio: 50, tbRatio: 50 }, 'tag', null);
check('one moderate front corner → TAG 921 / grade 9', worn.rawScore === 921 && worn.overall.grade === 9, `got ${worn.rawScore}`);
check('defect counted', worn.defectCounts.total === 1 && worn.defectCounts.corner === 1);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
