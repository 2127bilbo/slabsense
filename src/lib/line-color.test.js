/** Run: node src/lib/line-color.test.js */
import { LINE_PALETTE, hexToRgb, contrast, haloFor, rectSegments, quadSegments, sampleSegments, pickLineColor, loadLineStyle, DEFAULT_LINE_STYLE } from './line-color.js';

let passed = 0, failed = 0;
const check = (n, ok, extra = '') => { if (ok) { passed++; console.log(`  ✓ ${n}`); } else { failed++; console.log(`  ✗ ${n} ${extra}`); } };

const solid = (w, h, [r, g, b]) => { const data = new Uint8ClampedArray(w * h * 4); for (let i = 0; i < w * h; i++) { data[i * 4] = r; data[i * 4 + 1] = g; data[i * 4 + 2] = b; data[i * 4 + 3] = 255; } return { data, width: w, height: h }; };

console.log('— basics');
check('hexToRgb', JSON.stringify(hexToRgb('#ff9944')) === '[255,153,68]' && JSON.stringify(hexToRgb('#fff')) === '[255,255,255]');
check('contrast(x,x) = 0', contrast([10, 20, 30], [10, 20, 30]) === 0);
check('contrast black/white = 1', Math.abs(contrast([0, 0, 0], [255, 255, 255]) - 1) < 1e-9);
check('contrast symmetric', contrast([200, 10, 10], [10, 10, 200]) === contrast([10, 10, 200], [200, 10, 10]));
check('halo dark under light line, light under dark line', haloFor('#ffffff').startsWith('rgba(0,0,0') && haloFor('#000000').startsWith('rgba(255,255,255'));
check('rectSegments gives 4 edges', rectSegments({ left: 0, top: 0, right: 10, bottom: 20 }).length === 4);
check('quadSegments gives 4 edges', quadSegments({ tl: { x: 0, y: 0 }, tr: { x: 10, y: 0 }, br: { x: 10, y: 20 }, bl: { x: 0, y: 20 } }).length === 4);
check('loadLineStyle without localStorage returns defaults', JSON.stringify(loadLineStyle()) === JSON.stringify(DEFAULT_LINE_STYLE));

console.log('— sampling');
const img = solid(100, 100, [255, 153, 68]);
const segs = rectSegments({ left: 10, top: 10, right: 90, bottom: 90 });
const samples = sampleSegments(img, segs, 3, 2);
check('samples collected along the rect', samples.length > 100, String(samples.length));
check('samples off-image are skipped', sampleSegments(img, rectSegments({ left: -50, top: -50, right: -10, bottom: -10 }), 3, 2).length === 0);

console.log('— picking');
check('orange card never gets the orange line', pickLineColor(samples) !== '#ff9944');
check('black background -> white line', pickLineColor(sampleSegments(solid(50, 50, [0, 0, 0]), segs, 2, 2)) === '#ffffff');
check('white background -> black line', pickLineColor(sampleSegments(solid(50, 50, [255, 255, 255]), segs, 2, 2)) === '#000000');
check('empty samples -> first palette colour', pickLineColor([]) === LINE_PALETTE[0].hex);
const mixed = [...Array(50).fill([0, 0, 0]), ...Array(50).fill([255, 255, 255])];
const m = pickLineColor(mixed);
check('mixed black/white -> neither black nor white', m !== '#000000' && m !== '#ffffff', m);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
