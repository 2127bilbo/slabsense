#!/usr/bin/env node
/**
 * What the models lose at phone-upload resolution.
 *
 * TAG's crops are 550 px because its scans are ~4400 px wide. The app caps an
 * upload at 2000 px (GRADE_UPLOAD_MAX_PX), which leaves about 180 px per corner.
 * This compares two prediction caches of the same cards — one cut from the full
 * scan, one from a 2000 px copy — slot by slot and grade by grade.
 *
 *   node --expose-gc scripts/harness/model-predict.mjs --held-out --max-dim 2000 \
 *        --out scripts/harness/results/model-predictions-2000px.json
 *   node scripts/harness/model-resolution.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeGrade } from '../../src/lib/softwareGrade.js';
import { slotsToDings, mergeModelDings, MODEL_DEFAULTS } from '../../src/lib/corner-edge-model.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const RESULTS = path.join(here, 'results');
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const FULL = opt('--full', path.join(RESULTS, 'model-predictions.json'));
const SMALL = opt('--small', path.join(RESULTS, 'model-predictions-2000px.json'));
const BASELINE = opt('--baseline', path.join(RESULTS, '2026-09-17-2026-09-17-baseline-engine11.json'));

const full = JSON.parse(fs.readFileSync(FULL, 'utf8'));
const small = JSON.parse(fs.readFileSync(SMALL, 'utf8'));
const base = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
const byCert = new Map(base.cards.filter((c) => !c.error).map((c) => [c.cert, c]));

const certs = Object.keys(small.cards).filter((c) => full.cards[c] && !full.cards[c].error && !small.cards[c].error && byCert.has(c));
const r2 = (x) => Math.round(x * 100) / 100;
const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN);

// ── per-slot agreement ──────────────────────────────────────────────────────
const rows = { corners: [], edges: [] };
for (const cert of certs) {
  for (const side of ['front', 'back']) {
    for (const task of ['corners', 'edges']) {
      const a = full.cards[cert][side][task];
      const b = small.cards[cert][side][task];
      a.forEach((sa, i) => {
        const sb = b[i];
        const th = MODEL_DEFAULTS[task].wearThreshold;
        rows[task].push({ dw: Math.abs(sa.wear - sb.wear), dd: Math.abs(sa.deduction - sb.deduction), flip: (sa.wear >= th) !== (sb.wear >= th) });
      });
    }
  }
}
console.log(`${certs.length} held-out cards, full scan (~4400 px) vs 2000 px upload\n`);
console.log('| slots | mean |wear diff| | mean |deduction diff| | ding decisions that flip |');
console.log('|---|---|---|---|');
for (const [task, list] of Object.entries(rows)) {
  console.log(`| ${task} (${list.length}) | ${r2(mean(list.map((r) => r.dw)))} | ${r2(mean(list.map((r) => r.dd)))} pts | ${r2((100 * list.filter((r) => r.flip).length) / list.length)} % |`);
}

// ── grade effect ────────────────────────────────────────────────────────────
function gradesFrom(store) {
  const out = [];
  for (const cert of certs) {
    const card = byCert.get(cert);
    const p = store.cards[cert];
    const side = (s) => mergeModelDings(
      card.softDings.filter((d) => d.side === (s === 'front' ? 'FRONT' : 'BACK')),
      [...slotsToDings('corners', s, p[s].corners), ...slotsToDings('edges', s, p[s].edges)],
    );
    const g = computeGrade(side('front'), side('back'), card.centeringUsed.front, card.centeringUsed.back, 'tag');
    out.push({ cert, tagGrade: card.tagGrade, grade: g.overall.grade });
  }
  return out;
}
const gFull = gradesFrom(full);
const gSmall = gradesFrom(small);
const errs = (g) => g.map((r) => r.grade - r.tagGrade);
const same = gFull.filter((r, i) => r.grade === gSmall[i].grade).length;
const shift = gFull.map((r, i) => Math.abs(r.grade - gSmall[i].grade));

console.log('\n| grades | mean error vs TAG | mean |error| | within 0.5 |');
console.log('|---|---|---|---|');
for (const [name, g] of [['full scan', gFull], ['2000 px upload', gSmall]]) {
  const e = errs(g);
  console.log(`| ${name} | ${r2(mean(e))} | ${r2(mean(e.map(Math.abs)))} | ${r2((100 * e.filter((v) => Math.abs(v) <= 0.5).length) / e.length)} % |`);
}
console.log(`\nidentical grade on ${same}/${gFull.length} cards (${r2((100 * same) / gFull.length)} %); mean shift ${r2(mean(shift))} grades, worst ${r2(Math.max(...shift))}`);
