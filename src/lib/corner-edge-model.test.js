/** Run: node src/lib/corner-edge-model.test.js */
import {
  MODEL_DEFAULTS, OUTPUT_CHANNELS, POINT_SCALE, severityFromDeduction, sigmoid,
  decodeLogits, decodeSide, slotsToDings, withoutDetectorCornerEdge, mergeModelDings,
} from './corner-edge-model.js';
import { cornerBoxes, edgeBoxes } from './tag-crops.js';
import { mapDingType, mapDingSeverity, dingToEngineDefect } from './softwareGrade.js';
import { ALLOWED_SUBGRADES, SEVERITY_MULTIPLIERS } from './gradingEngine.js';

let passed = 0, failed = 0;
const check = (n, ok, extra = '') => { if (ok) { passed++; console.log(`  ✓ ${n}`); } else { failed++; console.log(`  ✗ ${n} ${extra}`); } };
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;
const logit = (p) => Math.log(p / (1 - p));

console.log('— decoding');
check('sigmoid matches its definition', near(sigmoid(0), 0.5) && near(sigmoid(logit(0.9)), 0.9, 1e-9));
check('sigmoid is stable for large negatives', sigmoid(-800) === 0 && Number.isFinite(sigmoid(-800)));
const d = decodeLogits('corners', [logit(0.8), logit(0.25), logit(0.99)]);
check('wear stays a probability', near(d.wear, 0.8, 1e-9));
check('deduction is read as TAG points', near(d.deduction, 250, 1e-6), String(d.deduction));
check('angle is read as TAG points', near(d.angle, 990, 1e-6));
check('edges decode two channels only', Object.keys(decodeLogits('edges', [0, 0])).join(',') === 'wear,deduction');
check('point scale is TAG\'s 1000', POINT_SCALE === 1000);

console.log('— slot decoding follows the box order');
const boxes = cornerBoxes(4400, 6090);
const flat = new Float32Array([
  logit(0.1), logit(0.1), logit(0.9),
  logit(0.2), logit(0.2), logit(0.9),
  logit(0.3), logit(0.3), logit(0.9),
  logit(0.4), logit(0.4), logit(0.9),
]);
const slots = decodeSide('corners', flat, boxes);
check('one slot per box, keys preserved', slots.length === 4 && slots.map((s) => s.key).join(',') === 'TL,TR,BL,BR');
check('rows are not transposed', near(slots[0].wear, 0.1, 1e-6) && near(slots[3].wear, 0.4, 1e-6));
check('locations carried through for the engine', slots[2].location === 'BOTTOMLEFT');
check('edge slots carry edge locations', decodeSide('edges', new Float32Array(8), edgeBoxes(4400, 6090))[3].location === 'RIGHT');

console.log('— severity from predicted deduction');
const cuts = { moderate: 250, severe: 450, extreme: 700 };
check('below the first cut is minor', severityFromDeduction(100, cuts) === 'minor');
check('cut lines are inclusive', severityFromDeduction(250, cuts) === 'moderate' && severityFromDeduction(450, cuts) === 'severe' && severityFromDeduction(700, cuts) === 'extreme');
check('just under a cut stays in the lower band', severityFromDeduction(249.9, cuts) === 'minor');
check('far above the top cut stays extreme', severityFromDeduction(5000, cuts) === 'extreme');
check('missing prediction degrades to minor', severityFromDeduction(undefined, cuts) === 'minor' && severityFromDeduction(NaN, cuts) === 'minor');
check('every severity it can emit is a real engine severity', ['minor', 'moderate', 'severe', 'extreme'].every((s) => s in SEVERITY_MULTIPLIERS));

console.log('— slots to dings');
const sample = [
  { key: 'TL', location: 'TOPLEFT', wear: 0.9, deduction: 120, angle: 900 },
  { key: 'TR', location: 'TOPRIGHT', wear: 0.49, deduction: 900, angle: 900 },
  { key: 'BL', location: 'BOTTOMLEFT', wear: 0.55, deduction: 800, angle: 900 },
  { key: 'BR', location: 'BOTTOMRIGHT', wear: 0.5, deduction: 460, angle: 900 },
];
// Pin the threshold here: this tests the rule, not the calibrated default.
const half = { wearThreshold: 0.5, severityCuts: cuts };
const dings = slotsToDings('corners', 'front', sample, half);
check('only slots over the threshold fire', dings.length === 3 && !dings.some((x) => x.location === 'TOPRIGHT'));
check('the threshold itself fires', dings.some((x) => x.location === 'BOTTOMRIGHT'));
check('severity comes from the deduction', dings.find((x) => x.location === 'TOPLEFT').severity === 'minor' && dings.find((x) => x.location === 'BOTTOMLEFT').severity === 'extreme');
check('side is upper-cased for the engine', dings.every((x) => x.side === 'FRONT'));
check('back side label', slotsToDings('corners', 'back', sample, half)[0].side === 'BACK');
check('predictions are carried for the report', dings[0].wear === 0.9 && dings[0].deduction === 120 && dings[0].source === 'model');
check('edge dings are typed as edge wear', slotsToDings('edges', 'front', [{ key: 'T', location: 'TOP', wear: 0.9, deduction: 100 }], half)[0].type === 'EDGE WEAR');
check('a threshold override is respected', slotsToDings('corners', 'front', sample, { corners: { wearThreshold: 0.95, severityCuts: cuts } }).length === 0);

console.log('— the engine accepts what we emit');
check('type maps to a real engine defect type', dings.every((x) => ['CORNER', 'EDGE'].includes(mapDingType(x.type))));
check('severity passes through the legacy mapper untouched', dings.every((x) => mapDingSeverity(x.severity) === x.severity));
const defect = dingToEngineDefect(dings[0]);
check('ding converts to an engine defect', defect && defect.type === 'CORNER' && defect.side === 'FRONT' && defect.severity === 'minor');
check('engine knows the TAG subgrade steps', Array.isArray(ALLOWED_SUBGRADES.psa));

console.log('— merging with the detectors');
const detector = [
  { side: 'FRONT', type: 'CORNER WEAR', severity: 2 },
  { side: 'FRONT', type: 'EDGE WEAR', severity: 1 },
  { side: 'FRONT', type: 'SURFACE / CREASE', severity: 3 },
  { side: 'FRONT', type: 'SURFACE / SCRATCH(ES)', severity: 1 },
];
const kept = withoutDetectorCornerEdge(detector);
check('detector corner and edge dings are dropped', kept.length === 2 && !kept.some((x) => /CORNER|EDGE/.test(x.type)));
check('surface dings survive', kept.some((x) => x.type.includes('CREASE')) && kept.some((x) => x.type.includes('SCRATCH')));
const merged = mergeModelDings(detector, dings);
check('merge keeps surface plus model dings only', merged.length === 2 + dings.length);
check('no slot is counted twice', merged.filter((x) => (x.type || '').includes('CORNER')).every((x) => x.source === 'model'));
check('empty inputs are safe', mergeModelDings(null, null).length === 0 && mergeModelDings(undefined, dings).length === dings.length);

console.log('— defaults');
check('both tasks have defaults', OUTPUT_CHANNELS.corners.length === 3 && OUTPUT_CHANNELS.edges.length === 2 && MODEL_DEFAULTS.corners && MODEL_DEFAULTS.edges);
check('cut lines ascend', Object.values(MODEL_DEFAULTS.corners.severityCuts).every((v, i, a) => i === 0 || a[i - 1] < v));
check('thresholds are probabilities', [MODEL_DEFAULTS.corners.wearThreshold, MODEL_DEFAULTS.edges.wearThreshold].every((v) => v > 0 && v < 1));
check('defaults are the calibrated ones (scripts/harness/model-sweep.mjs)', MODEL_DEFAULTS.corners.wearThreshold === 0.2 && MODEL_DEFAULTS.edges.wearThreshold === 0.2 && MODEL_DEFAULTS.corners.severityCuts.moderate === 150);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
