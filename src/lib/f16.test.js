/** Run: node src/lib/f16.test.js */
import { encodeF16, decodeF16 } from './f16.js';
let passed = 0, failed = 0;
const check = (n, ok, extra = '') => { if (ok) { passed++; console.log(`  ✓ ${n}`); } else { failed++; console.log(`  ✗ ${n} ${extra}`); } };

const exact = new Float32Array([0, 1, -1, 0.5, -0.5, 2, 1024, -0.0625]);
const back = decodeF16(encodeF16(exact));
check('exactly representable values round-trip', exact.every((v, i) => back[i] === v), JSON.stringify(Array.from(back)));

let seed = 7; const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const rand = new Float32Array(1000); for (let i = 0; i < 1000; i++) rand[i] = (rnd() * 2 - 1) * 0.25; // CLIP components are small
const r2 = decodeF16(encodeF16(rand));
let maxErr = 0; for (let i = 0; i < 1000; i++) maxErr = Math.max(maxErr, Math.abs(r2[i] - rand[i]));
check('1000 random small floats: max abs error < 1e-3', maxErr < 1e-3, `maxErr=${maxErr}`);
check('encoded length is 2 bytes per value', encodeF16(rand).length === 2000);

const buf = encodeF16(new Float32Array([1, 2, 3, 4]));
const slice = decodeF16(buf.buffer, buf.byteOffset + 2, 2);
check('decode with offset/length', slice.length === 2 && slice[0] === 2 && slice[1] === 3);

// unit vector stays ~unit after round trip
const u = new Float32Array(512); for (let i = 0; i < 512; i++) u[i] = rnd() - 0.5; let n = 0; for (const v of u) n += v * v; n = Math.sqrt(n); for (let i = 0; i < 512; i++) u[i] /= n;
const u2 = decodeF16(encodeF16(u)); let n2 = 0; for (const v of u2) n2 += v * v;
check('unit vector norm within 1e-3 after round trip', Math.abs(Math.sqrt(n2) - 1) < 1e-3, `norm=${Math.sqrt(n2)}`);

console.log(`\n${passed} passed, ${failed} failed`); process.exit(failed ? 1 : 0);
