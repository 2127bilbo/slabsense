/** Run: node api/_lib/detectionPrompt.test.js */
import { parseDetection, sanitizeDefects, mergeStructural, STRUCTURAL_TYPES, buildDetectionPrompt } from './detectionPrompt.js';

let passed = 0, failed = 0;
const check = (n, ok, extra = '') => { if (ok) { passed++; console.log(`  ✓ ${n}`); } else { failed++; console.log(`  ✗ ${n} ${extra}`); } };

console.log('— parseDetection');
const prose = `Corner check: {top-left looks clean}. Edge check done.\nFinal:\n\`\`\`json\n{"cardInfo":{"name":"Glaceon"},"imageQuality":{"overall":"good"},"defects":[{"side":"FRONT","type":"CREASE","severity":"moderate","location":"MIDDLE CENTER","x":50,"y":48,"width":60,"height":2,"description":"horizontal line across the art"}],"summary":{"positives":["a"],"concerns":["b"],"recommendation":"c"}}\n\`\`\``;
const d = parseDetection(prose);
check('parses the final JSON block after prose with braces', d?.cardInfo?.name === 'Glaceon' && d.defects.length === 1);
check('a truncated response (no defects array) is a parse failure, not a clean card', parseDetection('reasoning... {"cardInfo":{"name":"X"}}') === null);
check('empty text → null', parseDetection('') === null);

console.log('— sanitizeDefects');
const s = sanitizeDefects([{ side: 'back', type: 'wrinkle', severity: 'SEVERE', location: 'top edge', x: 120, y: -3 }, { type: 'CENTERING' }, null]);
check('normalizes type/severity/side, clamps coords, drops centering pseudo-defects', s.length === 1 && s[0].type === 'CREASE' && s[0].severity === 'severe' && s[0].side === 'BACK' && s[0].x === 100 && s[0].y === 0, JSON.stringify(s));

console.log('— mergeStructural');
const p1 = sanitizeDefects([
  { side: 'FRONT', type: 'CREASE', severity: 'severe', description: 'line' },
  { side: 'BACK', type: 'DENT', severity: 'minor' },
  { side: 'FRONT', type: 'CORNER', severity: 'moderate' },
]);
const p2 = sanitizeDefects([
  { side: 'FRONT', type: 'CREASE', severity: 'minor', description: 'faint line' }, // pass 2 softened it
  { side: 'FRONT', type: 'EDGE', severity: 'minor' },                              // pass 2 dropped the corner, added an edge
]);
const m = mergeStructural(p1, p2);
check('STRUCTURAL_TYPES covers crease/tear/dent/stain/pit', ['CREASE', 'TEAR', 'DENT', 'STAIN', 'PIT'].every((t) => STRUCTURAL_TYPES.includes(t)));
check('softened crease is restored to pass-1 severity', m.find((x) => x.type === 'CREASE')?.severity === 'severe', JSON.stringify(m));
check('dropped dent is re-added and labelled', m.some((x) => x.type === 'DENT' && /kept from pass 1/.test(x.description)));
check('cosmetic corner dropped by pass 2 stays dropped; pass-2 edge kept', !m.some((x) => x.type === 'CORNER') && m.some((x) => x.type === 'EDGE'));
check('inputs are not mutated', p2.find((x) => x.type === 'CREASE').severity === 'minor' && p2.length === 2);
check('pass 2 may raise severity (kept)', mergeStructural([{ side: 'FRONT', type: 'CREASE', severity: 'minor' }], [{ side: 'FRONT', type: 'CREASE', severity: 'severe' }])[0].severity === 'severe');

console.log('— prompt wording');
const prompt = buildDetectionPrompt({ cardType: 'modern_holo', centering: { front: { lrRatio: 50, tbRatio: 50 }, back: { lrRatio: 50, tbRatio: 50 } }, imageLayout: 'x', referencesText: 'REF', priorFindings: { defects: [] } });
check('pass-2 prompt forbids softening structural findings', /NEVER removed/.test(prompt) && /never soften/i.test(prompt));
check('old "removing a false positive is as valuable" wording is gone', !/as valuable as finding/.test(prompt));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
