#!/usr/bin/env node
/**
 * What the app's image pipeline does to the corner/edge models.
 *
 * Two things differ between a TAG scan and what the app hands the models:
 *   1. cropToOuterBounds() clips the crop with a synthetic rounded corner
 *      (radius 4.8 % of width), replacing the real corner tip with a drawn arc.
 *   2. Outside the card the app has whatever the user's table is (often dark),
 *      where TAG's scans have TAG's orange backdrop.
 * This applies each effect to the held-out harness scans and reports how far
 * the predictions move. Run after model-predict.mjs (uses its cache as the
 * reference).
 *
 *   node --expose-gc scripts/harness/model-domain.mjs [--limit N]
 */
import { createCanvas, Image } from 'canvas';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ort from 'onnxruntime-web';
import { createCornerEdgeRunner } from '../../src/lib/corner-edge-runner.js';
import { MODEL_DEFAULTS } from '../../src/lib/corner-edge-model.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..', '..');
const PHOTOS = path.join(ROOT, 'scripts', 'Tag scraper', 'dig info', 'weights by tag', 'TAG Map');
const ONNX = path.join(ROOT, 'training', 'weights', 'onnx');
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const LIMIT = Number(opt('--limit', 0)) || 0;

const gt = JSON.parse(fs.readFileSync(path.join(here, 'ground-truth.json'), 'utf8'));
const splits = JSON.parse(fs.readFileSync(path.join(here, 'card-splits.json'), 'utf8'));
const ref = JSON.parse(fs.readFileSync(path.join(here, 'results', 'model-predictions.json'), 'utf8'));
let certs = Object.keys(gt.certs).filter((c) => splits[c] && splits[c] !== 'train' && ref.cards[c] && !ref.cards[c].error);
if (LIMIT) certs = certs.slice(0, LIMIT);

/** TAG's backdrop colour, sampled from the corner of its scans. */
const TAG_ORANGE = [236, 96, 32];
const isOrange = (r, g, b) => r > 170 && g > 50 && g < 160 && b < 110 && r - b > 90;

/** The app's crop, as cropToOuterBounds() draws it: rounded clip, transparent outside. */
function withClip(img) {
  const c = createCanvas(img.width, img.height);
  const ctx = c.getContext('2d');
  ctx.beginPath();
  ctx.roundRect(0, 0, img.width, img.height, Math.round(img.width * 0.048));
  ctx.clip();
  ctx.drawImage(img, 0, 0);
  return c;
}
/**
 * Replace the backdrop cleanly: flood-fill from each outer corner over pixels
 * close to the corner's own colour, grow the region by a few pixels so the
 * anti-aliased fringe goes with it, then paint it. Applied in a corner band only.
 */
function repaintBackdrop(source, rgb, { tolerance = 60, grow = 3 } = {}) {
  const c = createCanvas(source.width, source.height);
  const ctx = c.getContext('2d');
  ctx.drawImage(source, 0, 0);
  const band = Math.round(source.width * 0.16);
  for (const [x0, y0, sx, sy] of [[0, 0, 0, 0], [source.width - band, 0, band - 1, 0], [0, source.height - band, 0, band - 1], [source.width - band, source.height - band, band - 1, band - 1]]) {
    const id = ctx.getImageData(x0, y0, band, band);
    const d = id.data;
    const at = (x, y) => (y * band + x) * 4;
    const seed = at(sx, sy);
    const [sr, sg, sb] = [d[seed], d[seed + 1], d[seed + 2]];
    const mask = new Uint8Array(band * band);
    const stack = [[sx, sy]];
    while (stack.length) {
      const [x, y] = stack.pop();
      if (x < 0 || y < 0 || x >= band || y >= band) continue;
      const i = y * band + x;
      if (mask[i]) continue;
      const o = i * 4;
      if (Math.abs(d[o] - sr) + Math.abs(d[o + 1] - sg) + Math.abs(d[o + 2] - sb) > tolerance) continue;
      mask[i] = 1;
      stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
    let m = mask;
    for (let g = 0; g < grow; g++) {
      const next = new Uint8Array(m);
      for (let y = 0; y < band; y++) for (let x = 0; x < band; x++) {
        if (m[y * band + x]) continue;
        if ((x > 0 && m[y * band + x - 1]) || (x < band - 1 && m[y * band + x + 1]) || (y > 0 && m[(y - 1) * band + x]) || (y < band - 1 && m[(y + 1) * band + x])) next[y * band + x] = 1;
      }
      m = next;
    }
    for (let i = 0; i < m.length; i++) if (m[i]) { d[i * 4] = rgb[0]; d[i * 4 + 1] = rgb[1]; d[i * 4 + 2] = rgb[2]; }
    ctx.putImageData(id, x0, y0);
  }
  return c;
}
// Each variant: [transform, runner]. `raw` feeds the tile as is (how the app ran before
// 2026-09-17); `fixed` repaints the backdrop TAG orange per tile (tag-crops.js).
const raw = createCornerEdgeRunner({ ort, createCanvas, baseUrl: ONNX + path.sep, executionProviders: ['wasm'], backdrop: false });
const fixed = createCornerEdgeRunner({ ort, createCanvas, baseUrl: ONNX + path.sep, executionProviders: ['wasm'], backdrop: true });
await raw.preload(); await fixed.preload();
const VARIANTS = {
  'untouched scan, tile repaint on': [(img) => img, fixed],
  'black backdrop, tile repaint on': [(img) => repaintBackdrop(img, [0, 0, 0]), fixed],
};
const sharedImg = new Image();

const stats = {};
for (const name of Object.keys(VARIANTS)) stats[name] = { corners: [], edges: [] };
const t0 = Date.now();
for (const [n, cert] of certs.entries()) {
  const g = gt.certs[cert];
  for (const side of ['front', 'back']) {
    sharedImg.src = fs.readFileSync(path.join(PHOTOS, side === 'front' ? 'Front' : 'Back', side === 'front' ? g.images.front : g.images.back));
    const base = ref.cards[cert][side];
    for (const [name, [fn, runner]] of Object.entries(VARIANTS)) {
      const src = fn(sharedImg);
      const s = await runner.analyzeSide(src, null, side);
      for (const task of ['corners', 'edges']) {
        const th = MODEL_DEFAULTS[task].wearThreshold;
        s[task].forEach((slot, i) => {
          const b = base[task][i];
          stats[name][task].push({ dw: slot.wear - b.wear, adw: Math.abs(slot.wear - b.wear), lost: b.wear >= th && slot.wear < th, gained: b.wear < th && slot.wear >= th, refFires: b.wear >= th });
        });
      }
    }
  }
  sharedImg.src = '';
  if (typeof global.gc === 'function') global.gc();
  if ((n + 1) % 10 === 0) process.stdout.write(`\r${n + 1}/${certs.length}  ${Math.round((Date.now() - t0) / 1000)}s   `);
}
console.log(`\n\n${certs.length} held-out TAG scans; reference = the untouched scan\n`);
const mean = (a) => a.reduce((s, v) => s + v, 0) / (a.length || 1);
const r3 = (x) => Math.round(x * 1000) / 1000;
console.log('| variant | slots | mean wear shift | mean |shift| | dings lost | dings gained |');
console.log('|---|---|---|---|---|---|');
for (const [name, s] of Object.entries(stats)) {
  for (const task of ['corners', 'edges']) {
    const list = s[task];
    const fires = list.filter((r) => r.refFires).length;
    console.log(`| ${name} | ${task} | ${r3(mean(list.map((r) => r.dw)))} | ${r3(mean(list.map((r) => r.adw)))} | ${list.filter((r) => r.lost).length}/${fires} | ${list.filter((r) => r.gained).length} |`);
  }
}
