/**
 * Detector extraction guard. Runs the real detectors on a committed 1400-px
 * reference card and checks bounds + ding output against a recorded snapshot.
 * Run: node src/lib/detectors.test.js
 */
import { createCanvas, loadImage } from 'canvas';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { analyzePixels } from './detectors.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(here, '__fixtures__', 'C1287305_front_1400.jpg');

// Recorded on first green run. Update ONLY when a detector change is intended.
const SNAPSHOT_DINGS = []; // C1287305 front (9 MINT): software emits no dings at 050a162 behavior

let passed = 0, failed = 0;
const check = (name, ok, extra = '') => {
  if (ok) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name} ${extra}`); }
};

const img = await loadImage(FIXTURE);
const c = createCanvas(img.width, img.height);
const ctx = c.getContext('2d');
ctx.drawImage(img, 0, 0);
const { data, width: w, height: h } = ctx.getImageData(0, 0, img.width, img.height);

console.log('— analyzePixels on C1287305 front');
const r = analyzePixels({ data, w, h }, 'front');

check('returns bounds', !!r.bounds && r.bounds.right > r.bounds.left && r.bounds.bottom > r.bounds.top);
check('card fills ≥85% of frame width', r.bounds.cardW >= w * 0.85, `cardW=${r.bounds.cardW} w=${w}`);
check('card fills ≥85% of frame height', r.bounds.cardH >= h * 0.85, `cardH=${r.bounds.cardH} h=${h}`);
check('centering ratios present', typeof r.centering.lrRatio === 'number' && typeof r.centering.tbRatio === 'number');
check('allDings is an array', Array.isArray(r.allDings));
check('corners.details has 4 entries', r.corners.details.length === 4);
check('edges.details has 4 entries', r.edges.details.length === 4);
check('imgW/imgH echo input', r.imgW === w && r.imgH === h);

const summary = r.allDings.map(d => `${d.side}|${d.type}|${d.location}|${d.severity}`);
if (SNAPSHOT_DINGS === null) {
  console.log('  (no snapshot yet) dings =', JSON.stringify(summary));
} else {
  check('dings match snapshot', JSON.stringify(summary) === JSON.stringify(SNAPSHOT_DINGS),
    `\n    got  ${JSON.stringify(summary)}\n    want ${JSON.stringify(SNAPSHOT_DINGS)}`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
