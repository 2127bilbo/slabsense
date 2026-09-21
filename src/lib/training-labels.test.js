/** Run: node src/lib/training-labels.test.js */
import { normalisedCorners } from '../lib/training-labels.js';

let passed = 0, failed = 0;
const check = (n, ok, extra = '') => { if (ok) { passed++; console.log(`  ✓ ${n}`); } else { failed++; console.log(`  ✗ ${n} ${extra}`); } };

const cd = { outerCorners: { tl: { x: 70, y: 60 }, tr: { x: 1330, y: 62 }, bl: { x: 72, y: 1940 }, br: { x: 1328, y: 1938 } }, source: { imgW: 1400, imgH: 2000 } };
const n = normalisedCorners(cd);
check('corners normalised to the tool image size', Math.abs(n.tl.x - 0.05) < 1e-9 && Math.abs(n.tl.y - 0.03) < 1e-9 && Math.abs(n.br.x - 1328 / 1400) < 1e-9 && Math.abs(n.br.y - 0.969) < 1e-9);
check('all four corners present', ['tl', 'tr', 'bl', 'br'].every((k) => n[k]));
check('missing outline gives null', normalisedCorners({ source: { imgW: 1400, imgH: 2000 } }) === null && normalisedCorners(null) === null);
check('missing image size gives null', normalisedCorners({ outerCorners: cd.outerCorners, source: {} }) === null);
check('a corner without numbers gives null', normalisedCorners({ outerCorners: { ...cd.outerCorners, tr: { x: NaN, y: 1 } }, source: cd.source }) === null);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
