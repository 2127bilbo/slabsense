#!/usr/bin/env node
/*
 * SlabSense — https://www.slabsenseai.com
 * Copyright (c) 2026 SlabSense. All rights reserved.
 * Proprietary and confidential; see LICENSE at the repository root.
 */
/**
 * Centering v2b against TAG on every TAG-graded 30th Celebration Crystal Lugia (149/147,
 * Secret Rare, gold-foil border) — the design where the model was first seen to disagree with
 * TAG by 10+ points (docs/grading-research/e-reader-centering.md §3).
 *
 * Input: a JSON of certs with TAG's DTEs and deskewed image URLs (pulled through
 * scripts/tag-dataset's TagClient). Images are downloaded once into --images (gitignored),
 * trimmed of the orange backdrop, and run through the model. Writes results/<date>-lugia-30th.json.
 *
 *   node scripts/harness/lugia-30th.mjs --certs <certs.json> --images <dir>
 */
import { createCanvas, Image } from 'canvas';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ort from 'onnxruntime-web';
import { createCardRunner } from '../../src/lib/card-model-runner.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..', '..');
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const CERTS = opt('--certs', path.join(here, 'lugia-30th-certs.json'));
const IMAGES = opt('--images', path.join(ROOT, 'training', 'data', 'lugia-30th', 'images'));
fs.mkdirSync(IMAGES, { recursive: true });

const certs = JSON.parse(fs.readFileSync(CERTS, 'utf8'));
const runner = createCardRunner({ ort, createCanvas, baseUrl: path.join(ROOT, 'training', 'weights', 'onnx') + path.sep, executionProviders: ['wasm'] });
await runner.preload(['centering']);

async function fetchTo(url, file) {
  if (fs.existsSync(file) && fs.statSync(file).size > 10000) return;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
}

/** Outer-ring median backdrop colour, scan inward until >50 % of a row/column differs by >35/channel. */
function trimBox(img) {
  const c = createCanvas(img.width, img.height); const ctx = c.getContext('2d', { willReadFrequently: true }); ctx.drawImage(img, 0, 0);
  const W = img.width, H = img.height, d = ctx.getImageData(0, 0, W, H).data;
  const ring = [];
  for (let x = 0; x < W; x += 7) { ring.push([d[x * 4], d[x * 4 + 1], d[x * 4 + 2]]); const i = ((H - 1) * W + x) * 4; ring.push([d[i], d[i + 1], d[i + 2]]); }
  for (let y = 0; y < H; y += 7) { const i = (y * W) * 4; ring.push([d[i], d[i + 1], d[i + 2]]); const j = (y * W + W - 1) * 4; ring.push([d[j], d[j + 1], d[j + 2]]); }
  const med = [0, 1, 2].map((k) => { const a = ring.map((p) => p[k]).sort((x, y) => x - y); return a[a.length >> 1]; });
  const diff = (i) => Math.max(Math.abs(d[i] - med[0]), Math.abs(d[i + 1] - med[1]), Math.abs(d[i + 2] - med[2])) > 35;
  const rowFrac = (y) => { let n = 0; for (let x = 0; x < W; x += 4) if (diff((y * W + x) * 4)) n++; return n / Math.ceil(W / 4); };
  const colFrac = (x) => { let n = 0; for (let y = 0; y < H; y += 4) if (diff((y * W + x) * 4)) n++; return n / Math.ceil(H / 4); };
  let top = 0; while (top < H && rowFrac(top) < 0.5) top++;
  let bottom = H - 1; while (bottom > 0 && rowFrac(bottom) < 0.5) bottom--;
  let left = 0; while (left < W && colFrac(left) < 0.5) left++;
  let right = W - 1; while (right > 0 && colFrac(right) < 0.5) right--;
  return { left, top, right: right + 1, bottom: bottom + 1 };
}

const r1 = (x) => Math.round(x * 10) / 10;
const rows = [];
for (const [cert, c] of Object.entries(certs)) {
  const row = { cert, grade: c.grade, scoreTotal: c.scoreTotal, sides: {} };
  for (const side of ['front', 'back']) {
    const url = side === 'front' ? c.imageFileDeskewedFront : c.imageFileDeskewedBack;
    const dte = side === 'front'
      ? [c.centerLeftDTE, c.centerRightDTE, c.centerTopDTE, c.centerBottomDTE]
      : [c.bCenterLeftDTE, c.bCenterRightDTE, c.bCenterTopDTE, c.bCenterBottomDTE];
    if (!url || dte.some((v) => v == null)) { row.sides[side] = { skipped: 'no image or DTE' }; continue; }
    const file = path.join(IMAGES, `${cert}_${side}.jpg`);
    try { await fetchTo(url, file); } catch (e) { row.sides[side] = { skipped: e.message }; continue; }
    const img = new Image(); img.src = fs.readFileSync(file);
    const b = trimBox(img);
    const crop = createCanvas(896, 1248); crop.getContext('2d').drawImage(img, b.left, b.top, b.right - b.left, b.bottom - b.top, 0, 0, 896, 1248);
    const m = await runner.measureCentering(crop, side);
    const tagLR = (100 * dte[0]) / (dte[0] + dte[1]), tagTB = (100 * dte[2]) / (dte[2] + dte[3]);
    row.sides[side] = { tagDTE: dte, tagLR: r1(tagLR), tagTB: r1(tagTB), modelLR: r1(m.lrRatio), modelTB: r1(m.tbRatio), dLR: r1(m.lrRatio - tagLR), dTB: r1(m.tbRatio - tagTB), modelMM: { l: r1((m.l / 1000) * 63.15), r: r1((m.r / 1000) * 63.15), t: r1((m.t / 1000) * 87.97), b: r1((m.b / 1000) * 87.97) } };
  }
  rows.push(row);
  const f = row.sides.front, k = row.sides.back;
  console.log(`${cert} ${String(c.grade).padEnd(12)} front TAG ${f.tagLR ?? '-'}/${f.tagTB ?? '-'} model ${f.modelLR ?? '-'}/${f.modelTB ?? '-'} (Δ ${f.dLR ?? '-'}/${f.dTB ?? '-'})   back TAG ${k.tagLR ?? '-'}/${k.tagTB ?? '-'} model ${k.modelLR ?? '-'}/${k.modelTB ?? '-'} (Δ ${k.dLR ?? '-'}/${k.dTB ?? '-'})`);
}
const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
for (const side of ['front', 'back']) {
  const ok = rows.map((r) => r.sides[side]).filter((s) => s && s.dLR != null);
  const aLR = ok.map((s) => Math.abs(s.dLR)), aTB = ok.map((s) => Math.abs(s.dTB));
  console.log(`\n${side}: n ${ok.length}  mean |ΔL/R| ${r1(mean(aLR))}  mean |ΔT/B| ${r1(mean(aTB))}  both within 2 pts ${ok.filter((s) => Math.abs(s.dLR) <= 2 && Math.abs(s.dTB) <= 2).length}/${ok.length}  TAG mean L/R ${r1(mean(ok.map((s) => s.tagLR)))} T/B ${r1(mean(ok.map((s) => s.tagTB)))}  model mean L/R ${r1(mean(ok.map((s) => s.modelLR)))} T/B ${r1(mean(ok.map((s) => s.modelTB)))}`);
}
const out = path.join(here, 'results', `${new Date().toISOString().slice(0, 10)}-lugia-30th.json`);
fs.writeFileSync(out, JSON.stringify({ rows }, null, 1));
console.log(`wrote ${path.relative(ROOT, out)}`);
