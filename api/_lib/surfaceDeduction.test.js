/** Run: node api/_lib/surfaceDeduction.test.js */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { surfaceFeatures, predictPoints, surfaceDeductionPoints, severityFromPoints, applySurfaceDeduction, SURFACE_SEVERITY_CUTS } from './surfaceDeduction.js';
import { assembleUnifiedOutput } from './detectionPrompt.js';

let passed = 0, failed = 0;
const check = (n, ok, extra = '') => { if (ok) { passed++; console.log(`  ✓ ${n}`); } else { failed++; console.log(`  ✗ ${n} ${extra}`); } };
const here = path.dirname(fileURLToPath(import.meta.url));

console.log('— parity with sklearn');
const vectors = JSON.parse(fs.readFileSync(path.join(here, 'models', 'surface-deduction-v1.testvectors.json'), 'utf8'));
let worst = 0;
for (const v of vectors) worst = Math.max(worst, Math.abs(predictPoints(surfaceFeatures({ type: v.cls, x: v.x, y: v.y, width: v.w, height: v.h, side: v.side })) - v.expected));
check(`${vectors.length} sklearn test vectors reproduced (worst diff ${worst.toExponential(1)})`, worst < 1e-3);

console.log('— features');
const f = surfaceFeatures({ type: 'CREASE', x: 0.1, y: 0.2, width: 0.3, height: 0.4, side: 'BACK' });
check('one-hot class first', f[0] === 1 && f.slice(1, 7).every((v) => v === 0));
check('geometry in the trained order', Math.abs(f[7] - Math.log(0.12)) < 1e-12 && Math.abs(f[10] - Math.log(0.75)) < 1e-12 && f[11] === 0.25 && f[12] === 0.4);
check('border distance is the nearest edge', Math.abs(f[13] - 0.25) < 1e-12);
check('back flag', f[14] === 1 && surfaceFeatures({ type: 'CREASE', x: 0, y: 0, width: 0.1, height: 0.1, side: 'FRONT' })[14] === 0);
check('unknown class gives null', surfaceFeatures({ type: 'PLAY_WEAR', x: 0, y: 0, width: 0.1, height: 0.1, side: 'FRONT' }) === null);

console.log('— behaviour');
const pts = (d) => surfaceDeductionPoints({ side: 'FRONT', x: 50, y: 50, width: 10, height: 3, ...d });
check('a crease costs more than a scratch of the same size', pts({ type: 'CREASE' }) > pts({ type: 'SCRATCH' }) + 200);
check('a bigger stain costs more', pts({ type: 'STAIN', width: 40, height: 40 }) > pts({ type: 'STAIN', width: 5, height: 5 }) + 200);
check('a tear is always extreme', severityFromPoints('TEAR', 1) === 'extreme');
check('AI centre/size in percent is converted to a top-left fraction box', Math.abs(pts({ type: 'CREASE', x: 55, y: 51.5, width: 10, height: 3 }) - predictPoints(surfaceFeatures({ type: 'CREASE', x: 0.5, y: 0.5, width: 0.1, height: 0.03, side: 'FRONT' }))) < 1e-9);
check('points are clipped to TAG range', pts({ type: 'TEAR' }) <= 1000 && pts({ type: 'PIT', width: 0.1, height: 0.1 }) >= 0);
check('missing box fields do not throw', Number.isFinite(surfaceDeductionPoints({ type: 'SCRATCH', side: 'FRONT' })));

console.log('— severity mapping');
check('cut lines are inclusive and ascend', severityFromPoints('CREASE', 300) === 'moderate' && severityFromPoints('CREASE', 549) === 'moderate' && severityFromPoints('CREASE', 550) === 'severe' && severityFromPoints('CREASE', 800) === 'extreme');
check('every type has ascending cuts', Object.values(SURFACE_SEVERITY_CUTS).every((c) => c.moderate <= c.severe && c.severe <= c.extreme));
check('unknown type gives null', severityFromPoints('CORNER', 500) === null);

console.log('— applying to a defect list');
const list = [
  { side: 'FRONT', type: 'CORNER', severity: 'minor', x: 8, y: 7, width: 12, height: 9 },
  { side: 'FRONT', type: 'CREASE', severity: 'minor', x: 50, y: 50, width: 60, height: 3, description: 'crease across the middle' },
  { side: 'BACK', type: 'PLAY_WEAR', severity: 'moderate', x: 50, y: 50, width: 80, height: 80 },
  { side: 'FRONT', type: 'PIT', severity: 'severe', x: 30, y: 30, width: 1, height: 1 },
];
const { defects, changed } = applySurfaceDeduction(list);
check('corner and play-wear defects pass through untouched', defects[0] === list[0] && defects[2] === list[2]);
check('the crease is re-scored from TAG points and keeps the AI opinion', defects[1].severitySource === 'model' && defects[1].aiSeverity === 'minor' && defects[1].deduction > 400 && ['severe', 'extreme'].includes(defects[1].severity));
check('a tiny pit is downgraded', defects[3].severity === 'minor' && defects[3].aiSeverity === 'severe');
check('changed count', changed === 2);

console.log('— in the assembler');
const detection = { defects: [{ side: 'FRONT', type: 'CREASE', severity: 'minor', location: 'MIDDLE CENTER', x: 50, y: 50, width: 60, height: 3, description: 'crease' }], imageQuality: {}, summary: {} };
const centering = { front: { lrRatio: 50, tbRatio: 50 }, back: { lrRatio: 50, tbRatio: 50 } };
const out = assembleUnifiedOutput({ detection, centering, gradePath: 'ai' });
check('meta says the surface severity came from the model', out.meta.surfaceSeveritySource === 'model' && out.meta.surfaceSeveritiesChanged === 1);
check('the engine graded the re-scored crease', out.defects.items[0].severity !== 'minor' && out.overall.grade <= 6);
process.env.SURFACE_DEDUCTION_MODEL = '0';
const off = assembleUnifiedOutput({ detection, centering, gradePath: 'ai' });
check('kill switch keeps the AI severity', off.meta.surfaceSeveritySource === 'ai' && off.defects.items[0].severity === 'minor');
delete process.env.SURFACE_DEDUCTION_MODEL;

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
