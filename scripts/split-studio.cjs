// scripts/split-studio.cjs — one-off: carve the vendored libraries and data out of the studio file
const fs = require('fs'), path = require('path');
const SRC = path.join(__dirname, '..', 'SlabSense Slab Engraving Studio', 'SlabSense-Engraving-Studio.html');
const OUT = path.join(__dirname, '..', 'public', 'slab');
const lines = fs.readFileSync(SRC, 'utf8').split('\n');
const L = (a, b) => lines.slice(a - 1, b).join('\n') + '\n';            // 1-based inclusive
const strip = s => s.replace(/^<script>/, '').replace(/<\/script>\s*$/, '');

fs.mkdirSync(path.join(OUT, 'vendor'), { recursive: true });
fs.writeFileSync(path.join(OUT, 'vendor', 'qrcode.js'), strip(L(282, 2581)));
fs.writeFileSync(path.join(OUT, 'vendor', 'opentype.js'), strip(L(2582, 2585)));
fs.writeFileSync(path.join(OUT, 'vendor', 'polygon-clipping.js'), strip(L(2591, 2616)));
fs.writeFileSync(path.join(OUT, 'fonts.js'), L(2587, 2587));
fs.writeFileSync(path.join(OUT, 'frame.js'), L(2588, 2589));
fs.writeFileSync(path.join(__dirname, 'studio-app.extracted.js'), strip(L(2617, 3166)));   // engine+UI, consumed by Task 3/4
console.log('split done');
