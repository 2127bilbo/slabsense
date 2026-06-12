/**
 * gradingEngine.test.js — run with: node gradingEngine.test.js
 * (Requires "type": "module" in package.json, or rename both files to .mjs)
 *
 * Fixtures come from GRADING_SCALE.md §9 worked examples plus company
 * conversion scenarios from COMPANY_OFFSETS.md. If a doc number changes,
 * change it here too — these tests ARE the drift detector.
 */

import {
  ENGINE_VERSION,
  calculateDeduction,
  diminishFactor,
  centeringDeviation,
  centeringScore,
  scoreToGrade,
  snapDown,
  mergeSubgrades,
  centeringSubgrade,
  ALLOWED_SUBGRADES,
  gradeCard,
} from './gradingEngine.js';

let passed = 0;
let failed = 0;
function check(name, actual, expected) {
  const ok =
    typeof expected === 'number' && typeof actual === 'number'
      ? Math.abs(actual - expected) < 0.05
      : JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}\n      expected: ${JSON.stringify(expected)}\n      actual:   ${JSON.stringify(actual)}`); }
}
function section(t) { console.log(`\n— ${t}`); }

/* ------------------------------------------------------------------ */
section('Deduction math (GRADING_SCALE.md §3)');
check('minor front corner = 4', calculateDeduction('CORNER', 'minor', 'FRONT'), 4.0);
check('moderate front corner = 10', calculateDeduction('CORNER', 'moderate', 'FRONT'), 10.0);
check('moderate front edge = 12.5', calculateDeduction('EDGE', 'moderate', 'FRONT'), 12.5);
check('minor back scratch = 1.75', calculateDeduction('SCRATCH', 'minor', 'BACK'), 1.75);
check('extreme front crease = 96', calculateDeduction('CREASE', 'extreme', 'FRONT'), 96.0);
check('severe front stain = 100', calculateDeduction('STAIN', 'severe', 'FRONT'), 100.0);
check('diminish index 0 = 1.0', diminishFactor(0), 1.0);
check('diminish index 1 ≈ 0.8696', diminishFactor(1), 0.8696);

/* ------------------------------------------------------------------ */
section('Centering (GRADING_SCALE.md §2)');
check('55/45 deviation = 5', centeringDeviation(55), 5.0);
check('45/55 deviation = 5 (symmetric)', centeringDeviation(45), 5.0);
check('front dev 1.7 → 99.5', centeringScore(1.7, 'FRONT'), 99.5);
check('front dev 6.2 → 92', centeringScore(6.2, 'FRONT'), 92.0);
check('front dev 12.0 → 86', centeringScore(12.0, 'FRONT'), 86.0);
check('front dev 31 → 40', centeringScore(31, 'FRONT'), 40.0);
check('back dev 13.6 → 97', centeringScore(13.6, 'BACK'), 97.0);
check('back dev 36 → 70', centeringScore(36, 'BACK'), 70.0);

/* ------------------------------------------------------------------ */
section('snapDown + grade table');
check('snapDown(9.7, psa) = 9 (no 9.5)', snapDown(9.7, ALLOWED_SUBGRADES.psa), 9);
check('snapDown(9.7, bgs) = 9.5', snapDown(9.7, ALLOWED_SUBGRADES.bgs), 9.5);
check('snapDown(0.4, psa) = 1 (floor)', snapDown(0.4, ALLOWED_SUBGRADES.psa), 1);
check('score 95 → Gem Mint', scoreToGrade(95).label, 'Gem Mint');
check('score 99 → Pristine', scoreToGrade(99).label, 'Pristine');
check('score 94.9 → Mint (never round up)', scoreToGrade(94.9).grade, 9);

/* ------------------------------------------------------------------ */
section('Worked Example B — mid-grade 8.5 (GRADING_SCALE.md §9)');
const exB = gradeCard({
  centering: { front: { lrRatio: 56.2, tbRatio: 51.0 }, back: { lrRatio: 63.6, tbRatio: 52.0 } },
  defects: [
    { side: 'FRONT', type: 'CORNER', severity: 'moderate', location: 'TOP LEFT' },
    { side: 'FRONT', type: 'EDGE', severity: 'moderate', location: 'LEFT EDGE' },
    { side: 'BACK', type: 'SCRATCH', severity: 'minor', location: 'MIDDLE CENTER' },
  ],
});
check('B: frontCentering 92', exB.subgrades.frontCentering, 92.0);
check('B: backCentering 97', exB.subgrades.backCentering, 97.0);
check('B: frontCorners 90', exB.subgrades.frontCorners, 90.0);
check('B: frontEdges 87.5', exB.subgrades.frontEdges, 87.5);
check('B: backSurface 98.25', exB.subgrades.backSurface, 98.25);
check('B: overall score ≈ 89.5', exB.overall.score, 89.52);
check('B: grade 8.5', exB.overall.grade, 8.5);
check('B: no caps applied', exB.overall.capsApplied, []);
check('B: minSubgrade is frontEdges', exB.overall.minSubgrade.key, 'frontEdges');
check('B: defect counts total 3', exB.defects.counts.total, 3);
check('B: every defect carries a deduction', exB.defects.items.every((d) => typeof d.deduction === 'number'), true);

/* ------------------------------------------------------------------ */
section('Worked Example A — two print lines → Mint 9 via clamp');
const exA = gradeCard({
  centering: { front: { lrRatio: 51.7, tbRatio: 50.5 }, back: { lrRatio: 52.0, tbRatio: 50.5 } },
  defects: [
    { side: 'FRONT', type: 'PRINT_DEFECT', severity: 'minor', location: 'TOP CENTER' },
    { side: 'FRONT', type: 'PRINT_DEFECT', severity: 'minor', location: 'MIDDLE LEFT' },
  ],
});
check('A: frontSurface ≈ 94.39', exA.subgrades.frontSurface, 94.39);
check('A: clamp applied (grade ≤ min subgrade band)', exA.overall.capsApplied.includes('MIN_SUBGRADE_CLAMP'), true);
check('A: grade 9 Mint', exA.overall.grade, 9);
check('A: tag score stays in Mint band (<950)', exA.companyGrades.tag.score < 950, true);

/* ------------------------------------------------------------------ */
section('Worked Example C — destroyed card reaches grade 1');
const exC = gradeCard({
  centering: { front: { lrRatio: 62.0, tbRatio: 55.0 }, back: { lrRatio: 58.0, tbRatio: 53.0 } },
  defects: [
    { side: 'FRONT', type: 'CREASE', severity: 'extreme' },
    { side: 'FRONT', type: 'STAIN', severity: 'severe' },
    { side: 'FRONT', type: 'CORNER', severity: 'severe' },
    { side: 'FRONT', type: 'CORNER', severity: 'severe' },
    { side: 'FRONT', type: 'CORNER', severity: 'severe' },
    { side: 'FRONT', type: 'CORNER', severity: 'severe' },
    { side: 'FRONT', type: 'EDGE', severity: 'severe' },
    { side: 'FRONT', type: 'EDGE', severity: 'severe' },
  ],
});
check('C: frontSurface floored at 10', exC.subgrades.frontSurface, 10);
check('C: frontCorners ≈ 33.4', exC.subgrades.frontCorners, 33.43);
check('C: grade 1 (Poor) — full scale reachable', exC.overall.grade, 1);
check('C: clamp listed in caps', exC.overall.capsApplied.includes('MIN_SUBGRADE_CLAMP'), true);
check('C: all 8 defects still reported (no early stop)', exC.defects.counts.total, 8);

/* ------------------------------------------------------------------ */
section('Pristine gate');
const pristine = gradeCard({
  centering: { front: { lrRatio: 51.0, tbRatio: 50.5 }, back: { lrRatio: 51.0, tbRatio: 51.0 } },
  defects: [],
});
check('Pristine: grade 10', pristine.overall.grade, 10);
check('Pristine: label Pristine', pristine.overall.label, 'Pristine');
check('Pristine: displayGrade 10P', pristine.overall.displayGrade, '10P');
const blockedPristine = gradeCard({
  centering: { front: { lrRatio: 51.0, tbRatio: 50.5 }, back: { lrRatio: 51.0, tbRatio: 51.0 } },
  defects: [{ side: 'BACK', type: 'CORNER', severity: 'minor' }],
});
check('One corner touch blocks Pristine', blockedPristine.overall.displayGrade !== '10P', true);

/* ------------------------------------------------------------------ */
section('Hard caps');
const creased = gradeCard({
  centering: { front: { lrRatio: 51.0, tbRatio: 50.0 }, back: { lrRatio: 51.0, tbRatio: 50.0 } },
  defects: [{ side: 'FRONT', type: 'CREASE', severity: 'moderate' }],
});
check('Moderate crease → grade ≤ 6', creased.overall.grade <= 6, true);
check('CREASE_CAP_6 recorded', creased.overall.capsApplied.includes('CREASE_CAP_6'), true);
const torn = gradeCard({
  centering: { front: { lrRatio: 51.0, tbRatio: 50.0 }, back: { lrRatio: 51.0, tbRatio: 50.0 } },
  defects: [{ side: 'BACK', type: 'TEAR', severity: 'minor' }],
});
check('Any tear → grade ≤ 4', torn.overall.grade <= 4, true);
const fiveDefects = gradeCard({
  centering: { front: { lrRatio: 51.0, tbRatio: 50.0 }, back: { lrRatio: 51.0, tbRatio: 50.0 } },
  defects: [
    { side: 'FRONT', type: 'SCRATCH', severity: 'minor' },
    { side: 'FRONT', type: 'SCRATCH', severity: 'minor' },
    { side: 'BACK', type: 'SCRATCH', severity: 'minor' },
    { side: 'BACK', type: 'PRINT_DEFECT', severity: 'minor' },
    { side: 'BACK', type: 'PIT', severity: 'minor' },
  ],
});
check('5+ defects → grade ≤ 8.5 (the cliff)', fiveDefects.overall.grade <= 8.5, true);
check('DEFECT_COUNT_CAP_8.5 recorded', fiveDefects.overall.capsApplied.includes('DEFECT_COUNT_CAP_8.5'), true);

/* ------------------------------------------------------------------ */
section('Company conversions — the TAG 10 / PSA 9 / BGS 9.5 split');
const gem = gradeCard({
  centering: { front: { lrRatio: 55.0, tbRatio: 51.0 }, back: { lrRatio: 60.0, tbRatio: 52.0 } },
  defects: [{ side: 'FRONT', type: 'CORNER', severity: 'minor', location: 'TOP RIGHT' }],
});
check('TAG: Gem Mint 10', gem.companyGrades.tag.displayGrade, '10');
check('TAG: 1000-pt score present', gem.companyGrades.tag.score > 900, true);
check('PSA: 9 (1 defect ceiling + corner)', gem.companyGrades.psa.grade, 9);
check('BGS: 9.5 (0.5 rule)', gem.companyGrades.bgs.grade, 9.5);
check('BGS subgrades object exists', typeof gem.companyGrades.bgs.subgrades.corners, 'number');
check('All company grades ∈ allowed lists',
  ['psa', 'bgs', 'cgc', 'sgc'].every((c) =>
    ALLOWED_SUBGRADES[c].includes(gem.companyGrades[c].grade)), true);

section('Company centering thresholds');
check('PSA centering: 5/10 dev → 10', centeringSubgrade(5.0, 10.0, 'psa'), 10);
check('PSA centering: 6 front dev → 9', centeringSubgrade(6.0, 10.0, 'psa'), 9);
check('BGS centering: 50/50 only for 10', centeringSubgrade(0, 0, 'bgs'), 10);
check('BGS centering: 5/10 dev → 9.5', centeringSubgrade(5.0, 10.0, 'bgs'), 9.5);
check('SGC quirk: F5/B18 → Gem 10 band', centeringSubgrade(5.0, 18.0, 'sgc'), 10);
check('SGC: F5/B5 → 10 (passes Gem row first)', centeringSubgrade(5.0, 5.0, 'sgc'), 10);
check('CGC: F12/B12 → 8', centeringSubgrade(12.0, 12.0, 'cgc'), 8);

section('mergeSubgrades');
const merged = mergeSubgrades({
  frontCorners: 90, backCorners: 100,
  frontEdges: 80, backEdges: 100,
  frontSurface: 100, backSurface: 50,
});
check('corners merge 0.65/0.35 → 93.5', merged.corners, 93.5);
check('edges merge → 87', merged.edges, 87.0);
check('surface merge → 82.5', merged.surface, 82.5);

/* ------------------------------------------------------------------ */
section('Invariants (GRADING_OUTPUT_SCHEMA.md §13)');
for (const [name, r] of [['A', exA], ['B', exB], ['C', exC], ['gem', gem], ['creased', creased]]) {
  const minBand = scoreToGrade(r.overall.minSubgrade.value).grade;
  check(`${name}: overall.grade ≤ grade(min subgrade)`, r.overall.grade <= minBand, true);
  check(`${name}: counts.total === items.length`, r.defects.counts.total === r.defects.items.length, true);
  check(`${name}: tag grade === overall grade`, r.companyGrades.tag.grade === r.overall.grade, true);
}

/* ------------------------------------------------------------------ */
console.log(`\n${'='.repeat(50)}\nENGINE v${ENGINE_VERSION} — ${passed} passed, ${failed} failed\n${'='.repeat(50)}`);
process.exit(failed > 0 ? 1 : 0);
