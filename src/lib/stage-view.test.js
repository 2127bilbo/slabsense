/** Run: node src/lib/stage-view.test.js */
import { fit, clamp, zoomAt, zoomToImagePoint, pan, viewportToImage, imageToViewport, Z_MIN, Z_MAX, CORNER_Z } from './stage-view.js';

let passed = 0, failed = 0;
const check = (n, ok, extra = '') => { if (ok) { passed++; console.log(`  ✓ ${n}`); } else { failed++; console.log(`  ✗ ${n} ${extra}`); } };
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

const vw = 400, vh = 560, imgW = 1000, imgH = 1400;

console.log('— fit / clamp');
check('fit is identity', JSON.stringify(fit()) === JSON.stringify({ z: 1, tx: 0, ty: 0 }));
check('z clamps to Z_MIN', clamp({ z: 0.2, tx: -50, ty: -50 }, vw, vh).z === Z_MIN);
check('z clamps to Z_MAX', clamp({ z: 99, tx: 0, ty: 0 }, vw, vh).z === Z_MAX);
check('z=1 forces tx/ty to 0', JSON.stringify(clamp({ z: 1, tx: -30, ty: -30 }, vw, vh)) === JSON.stringify({ z: 1, tx: 0, ty: 0 }));
const c = clamp({ z: 2, tx: 50, ty: -5000 }, vw, vh);
check('tx never positive, ty never below vh - vh*z', c.tx === 0 && c.ty === vh - vh * 2);

console.log('— zoomAt keeps the anchor fixed');
const v0 = fit();
const px = 120, py = 300;
const before = viewportToImage(v0, px, py, imgW, imgH, vw, vh);
const v1 = zoomAt(v0, 3, px, py, vw, vh);
const after = viewportToImage(v1, px, py, imgW, imgH, vw, vh);
check('same image point under the anchor after zoom', near(before.x, after.x, 1e-6) && near(before.y, after.y, 1e-6), `${JSON.stringify(before)} vs ${JSON.stringify(after)}`);
check('zoomAt result is clamped (tx ≤ 0)', v1.tx <= 0 && v1.ty <= 0);

console.log('— zoomToImagePoint');
const mid = zoomToImagePoint(v0, CORNER_Z, 500, 700, imgW, imgH, vw, vh);
const midScreen = imageToViewport(mid, 500, 700, imgW, imgH, vw, vh);
check('image center lands at viewport center at 7.5×', near(midScreen.x, vw / 2) && near(midScreen.y, vh / 2), JSON.stringify(midScreen));
const tl = zoomToImagePoint(v0, CORNER_Z, 0, 0, imgW, imgH, vw, vh);
check('top-left corner clamps to tx=ty=0', tl.tx === 0 && tl.ty === 0 && tl.z === CORNER_Z);
const tlScreen = imageToViewport(tl, 0, 0, imgW, imgH, vw, vh);
check('top-left corner is at the viewport top-left when clamped', near(tlScreen.x, 0) && near(tlScreen.y, 0));
const br = zoomToImagePoint(v0, CORNER_Z, imgW, imgH, imgW, imgH, vw, vh);
const brScreen = imageToViewport(br, imgW, imgH, imgW, imgH, vw, vh);
check('bottom-right corner clamps to the viewport bottom-right', near(brScreen.x, vw) && near(brScreen.y, vh), JSON.stringify(brScreen));

console.log('— pan');
const p0 = zoomToImagePoint(v0, 2, 500, 700, imgW, imgH, vw, vh);
const p1 = pan(p0, 10, -10, vw, vh);
check('pan moves by dx/dy inside bounds', near(p1.tx, p0.tx + 10) && near(p1.ty, p0.ty - 10));
const p2 = pan(p0, 10000, 10000, vw, vh);
check('pan clamps at the top-left', p2.tx === 0 && p2.ty === 0);
const p3 = pan(p0, -10000, -10000, vw, vh);
check('pan clamps at the bottom-right', near(p3.tx, vw - vw * 2) && near(p3.ty, vh - vh * 2));

console.log('— round trip');
const rt = viewportToImage(mid, midScreen.x, midScreen.y, imgW, imgH, vw, vh);
check('viewportToImage(imageToViewport(p)) = p', near(rt.x, 500) && near(rt.y, 700));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
