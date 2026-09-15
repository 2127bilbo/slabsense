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

console.log('— F1 company-aware grade');
const oneEdge = [{ side: 'FRONT', type: 'EDGE WEAR', location: 'FRONT / TOP', severity: 1 }];
const C = { lrRatio: 50, tbRatio: 50 };
const asTag = computeGrade(oneEdge, [], C, C, 'tag', null);
const asPsa = computeGrade(oneEdge, [], C, C, 'psa', null);
const asBgs = computeGrade(oneEdge, [], C, C, 'bgs', null);
check('TAG: one minor edge → grade 10', asTag.grade.grade === 10, `got ${asTag.grade.grade}`);
check('PSA: one minor edge → grade 9 (any-defect cap)', asPsa.grade.grade === 9, `got ${asPsa.grade.grade}`);
check('BGS: one minor edge → 9.5 (Pristine needs perfect edges; 9.5 allows specs of wear under magnification)', asBgs.grade.grade === 9.5, `got ${asBgs.grade.grade}`);
check('grade matches companyGrades for psa', asPsa.grade.grade === asPsa.companyGrades.psa.grade && asPsa.grade.label === asPsa.companyGrades.psa.label);
check('grade carries color/bg', typeof asPsa.grade.color === 'string' && typeof asPsa.grade.bg === 'string');
// beckett.com chart: 9 Mint needs 55/45 front; 56/44 (6.0 dev) only meets 8 Near Mint (60/40) → overall 8.5 (0.5 rule).
const offBgs = computeGrade([], [], { lrRatio: 56, tbRatio: 50 }, C, 'bgs', null);
check('BGS: 56/44 front → 8.5 (chart: 9 needs 55/45)', offBgs.grade.grade === 8.5, `got ${offBgs.grade.grade}`);
// 55/45 front + 60/40 back = Gem Mint centering; one minor edge caps at 9.5 → 9.5 reachable.
const halfBgs = computeGrade(oneEdge, [], { lrRatio: 55, tbRatio: 50 }, { lrRatio: 60, tbRatio: 50 }, 'bgs', null);
check('BGS 9.5 reachable', halfBgs.grade.grade === 9.5, `got ${halfBgs.grade.grade}`);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
