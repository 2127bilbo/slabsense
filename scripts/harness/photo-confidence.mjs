#!/usr/bin/env node
/*
 * SlabSense — https://www.slabsenseai.com
 * Copyright (c) 2026 SlabSense. All rights reserved.
 * Proprietary and confidential; see LICENSE at the repository root.
 */
/**
 * Photo confidence on real photos: the owner's card-val phone set (training/data/card-val, hand-labelled
 * card corners and tags) plus a sample of TAG studio fronts (pre-cropped scans, the "10" reference).
 * Writes results/photo-confidence/<date>.csv, summary.json and a contact sheet sorted by score.
 *
 *   node scripts/harness/photo-confidence.mjs [--tag 12]
 */
import fs from 'node:fs';
import path from 'node:path';
import { createCanvas, loadImage } from 'canvas';
import { photoConfidence, capForSource } from '../../src/lib/photo-confidence.js';

const ROOT = process.cwd();
const VAL = path.join(ROOT, 'training', 'data', 'card-val');
const DATA_DIR = process.env.SLABSENSE_DATA_DIR || path.join(ROOT, '..', 'SlabSense-data');
const TAG_DIR = path.join(DATA_DIR, 'Tag scraper', 'dig info', 'weights by tag', 'TAG Map', 'Front');
const OUT = path.join(ROOT, 'scripts', 'harness', 'results', 'photo-confidence');
const args = process.argv.slice(2);
const NTAG = Number(args[args.indexOf('--tag') + 1] || 12) || 12;
fs.mkdirSync(OUT, { recursive: true });

async function pixels(file, maxSide = 2000) {
  const im = await loadImage(file);
  const k = Math.min(1, maxSide / Math.max(im.width, im.height));
  const w = Math.round(im.width * k), h = Math.round(im.height * k);
  const c = createCanvas(w, h), x = c.getContext('2d'); x.drawImage(im, 0, 0, w, h);
  return { img: x.getImageData(0, 0, w, h), thumb: im };
}

const rows = [];
for (const dir of fs.readdirSync(VAL).sort()) {
  const lj = path.join(VAL, dir, 'labels.json'), img = path.join(VAL, dir, 'front.jpg');
  if (!fs.existsSync(lj) || !fs.existsSync(img)) continue;
  const L = JSON.parse(fs.readFileSync(lj, 'utf8'));
  const corners = L.sides?.front?.corners; if (!corners) continue;
  const { img: px, thumb } = await pixels(img);
  const r = photoConfidence(px, corners);
  rows.push({ set: 'phone', name: dir, tags: (L.tags || []).join('|'), raw: r.score, shown: capForSource(r.score, 'phone'), cutoff: r.cutoff, issues: r.issues, measures: r.measures, thumb, corners });
  process.stdout.write('.');
}
const tagFiles = fs.existsSync(TAG_DIR) ? fs.readdirSync(TAG_DIR).filter((f) => /\.jpe?g$/i.test(f)).sort() : [];
const pick = tagFiles.filter((_, i) => i % Math.max(1, Math.floor(tagFiles.length / NTAG)) === 0).slice(0, NTAG);
const full = { tl: { x: 0, y: 0 }, tr: { x: 1, y: 0 }, br: { x: 1, y: 1 }, bl: { x: 0, y: 1 } };
for (const f of pick) {
  const { img: px, thumb } = await pixels(path.join(TAG_DIR, f));
  const r = photoConfidence(px, full, { deskewed: true });
  rows.push({ set: 'tag', name: f.replace(/_front\.jpg$/i, ''), tags: 'tag-studio', raw: r.score, shown: capForSource(r.score, 'rig'), cutoff: false, issues: r.issues, measures: r.measures, thumb, corners: full });
  process.stdout.write('t');
}
console.log();

const date = new Date().toISOString().slice(0, 10);
const keys = Object.keys(rows[0].issues), mkeys = Object.keys(rows[0].measures);
fs.writeFileSync(path.join(OUT, `${date}.csv`), ['set,name,tags,raw,shown,cutoff,' + keys.join(',') + ',' + mkeys.join(','),
  ...rows.map((r) => [r.set, r.name, r.tags, r.raw, r.shown, r.cutoff, ...keys.map((k) => r.issues[k].toFixed(2)), ...mkeys.map((k) => r.measures[k])].join(','))].join('\n'));

// summary
const band = (s) => (s >= 9.5 ? '9.5-10' : s >= 9 ? '9-9.4' : s >= 7 ? '7-8.9' : s >= 5 ? '5-6.9' : s >= 3 ? '3-4.9' : '1-2.9');
const sum = (set) => { const rs = rows.filter((r) => r.set === set); const b = {}; rs.forEach((r) => { b[band(r.shown)] = (b[band(r.shown)] || 0) + 1; });
  const sorted = rs.map((r) => r.raw).sort((a, c) => a - c); return { n: rs.length, bands: b, median: sorted[Math.floor(sorted.length / 2)], min: sorted[0], max: sorted[sorted.length - 1],
    topIssues: Object.fromEntries(keys.map((k) => [k, rs.filter((r) => r.issues[k] >= 0.3).length])) }; };
const byTag = {}; rows.filter((r) => r.set === 'phone').forEach((r) => (r.tags || 'untagged').split('|').forEach((t) => { (byTag[t] ||= []).push(r.raw); }));
const summary = { phone: sum('phone'), tag: sum('tag'), phoneByTag: Object.fromEntries(Object.entries(byTag).map(([t, v]) => [t, { n: v.length, median: v.sort((a, b) => a - b)[Math.floor(v.length / 2)] }])) };
fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));

// contact sheet, sorted by score
const sorted = [...rows].sort((a, b) => a.raw - b.raw);
const TW = 150, TH = 210, LAB = 54, COLS = 10;
const sheet = createCanvas(COLS * TW, Math.ceil(sorted.length / COLS) * (TH + LAB)); const g = sheet.getContext('2d');
g.fillStyle = '#0b0c10'; g.fillRect(0, 0, sheet.width, sheet.height);
sorted.forEach((r, i) => {
  const x = (i % COLS) * TW, y = Math.floor(i / COLS) * (TH + LAB);
  const k = Math.min((TW - 6) / r.thumb.width, (TH - 6) / r.thumb.height);
  const w = r.thumb.width * k, h = r.thumb.height * k;
  g.drawImage(r.thumb, x + (TW - w) / 2, y + (TH - h) / 2, w, h);
  g.strokeStyle = r.set === 'tag' ? '#d9b56a' : '#2a2d36'; g.lineWidth = 2; g.strokeRect(x + 1, y + 1, TW - 2, TH + LAB - 2);
  g.fillStyle = '#fff'; g.font = 'bold 20px sans-serif'; g.fillText(r.raw.toFixed(1), x + 8, y + TH + 20);
  g.fillStyle = '#9aa0ab'; g.font = '11px sans-serif'; g.fillText(r.name.slice(0, 22), x + 58, y + TH + 18);
  const top = Object.entries(r.issues).filter(([, v]) => v >= 0.3).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => k).join(' ');
  g.fillStyle = r.cutoff ? '#ff6b6b' : '#e3b75f'; g.fillText(r.cutoff ? 'CUT OFF' : top, x + 8, y + TH + 40);
});
fs.writeFileSync(path.join(OUT, `${date}-sheet.jpg`), sheet.toBuffer('image/jpeg', { quality: 0.82 }));
console.log('wrote', path.relative(ROOT, OUT));
