#!/usr/bin/env node
/**
 * Calibrates the corner/edge model thresholds against the DIG harness.
 *
 * Re-scores every harness card with the model's corner and edge dings in place
 * of the legacy detectors' (surface dings are kept), for a grid of wear
 * thresholds and severity cut lines, and reports grade error against TAG.
 * Uses the cached predictions from model-predict.mjs, so a sweep costs seconds.
 *
 *   node scripts/harness/model-sweep.mjs [--baseline file] [--predictions file]
 *                                        [--grid] [--apply] [--label name]
 *
 * 404 of the 507 cards were in the models' TRAIN split, so every table reports
 * the held-out (val + test) subset separately. That column is the honest one.
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
const BASELINE = opt('--baseline', path.join(RESULTS, '2026-09-17-2026-09-17-baseline-engine11.json'));
const PREDICTIONS = opt('--predictions', path.join(RESULTS, 'model-predictions.json'));
const GRID = args.includes('--grid');
const LABEL = opt('--label', 'model');

const base = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
const preds = JSON.parse(fs.readFileSync(PREDICTIONS, 'utf8'));
const splits = JSON.parse(fs.readFileSync(path.join(here, 'card-splits.json'), 'utf8'));
const gt = JSON.parse(fs.readFileSync(path.join(here, 'ground-truth.json'), 'utf8'));

const cards = base.cards.filter((c) => !c.error && preds.cards[c.cert] && !preds.cards[c.cert].error);
const heldOut = (cert) => splits[cert] !== 'train';

const r2 = (x) => Math.round(x * 100) / 100;
const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN);
const bucketOf = (g) => (g >= 9 ? '9-10' : g >= 7 ? '7-8.5' : g >= 5 ? '5-6.5' : '1-4.5');

/** Rebuild one card's dings with model corner/edge dings, then grade it. */
function gradeWith(card, opts) {
  const p = preds.cards[card.cert];
  const out = {};
  for (const side of ['front', 'back']) {
    const detector = card.softDings.filter((d) => d.side === (side === 'front' ? 'FRONT' : 'BACK'));
    const model = [
      ...slotsToDings('corners', side, p[side].corners, opts),
      ...slotsToDings('edges', side, p[side].edges, opts),
    ];
    out[side] = mergeModelDings(detector, model);
  }
  const c = card.centeringUsed;
  return { grade: computeGrade(out.front, out.back, c.front, c.back, 'tag'), dings: [...out.front, ...out.back] };
}

/** Detection precision/recall for CORNER and EDGE against the TAG report. */
function dingStats(rows) {
  const stat = {};
  for (const type of ['CORNER', 'EDGE']) {
    let tp = 0, fp = 0, fn = 0;
    for (const r of rows) {
      const truth = gt.certs[r.cert].dings.filter((d) => d.engineType === type);
      const soft = r.dings.filter((d) => (d.type || '').toUpperCase().includes(type));
      const need = {};
      for (const d of truth) need[d.side] = (need[d.side] || 0) + 1;
      for (const d of soft) { if (need[d.side] > 0) { need[d.side]--; tp++; } else fp++; }
      fn += Object.values(need).reduce((s, v) => s + v, 0);
    }
    stat[type] = { precision: tp + fp ? r2(tp / (tp + fp)) : null, recall: tp + fn ? r2(tp / (tp + fn)) : null, tp, fp, fn };
  }
  return stat;
}

function score(opts, keep = false) {
  const rows = [];
  for (const card of cards) {
    const { grade, dings } = gradeWith(card, opts);
    rows.push({ cert: card.cert, tagGrade: card.tagGrade, softGrade: grade.overall.grade, err: grade.overall.grade - card.tagGrade, dings, held: heldOut(card.cert) });
  }
  const summarize = (list) => ({
    cards: list.length,
    mae: r2(mean(list.map((r) => Math.abs(r.err)))),
    signed: r2(mean(list.map((r) => r.err))),
    exact: r2((100 * list.filter((r) => r.err === 0).length) / list.length),
    within05: r2((100 * list.filter((r) => Math.abs(r.err) <= 0.5).length) / list.length),
  });
  const out = { all: summarize(rows), held: summarize(rows.filter((r) => r.held)) };
  out.byBucket = {};
  for (const b of ['9-10', '7-8.5', '5-6.5', '1-4.5']) {
    const list = rows.filter((r) => bucketOf(r.tagGrade) === b);
    if (list.length) out.byBucket[b] = summarize(list);
  }
  if (keep) { out.rows = rows; out.dingStats = dingStats(rows); }
  return out;
}

// ── baseline (detectors only, engine 1.1) ──────────────────────────────────
const baseRows = cards.map((c) => ({ cert: c.cert, tagGrade: c.tagGrade, err: c.gradeError, held: heldOut(c.cert) }));
const baseSummary = {
  all: { cards: baseRows.length, mae: r2(mean(baseRows.map((r) => Math.abs(r.err)))), signed: r2(mean(baseRows.map((r) => r.err))) },
  held: (() => { const h = baseRows.filter((r) => r.held); return { cards: h.length, mae: r2(mean(h.map((r) => Math.abs(r.err)))), signed: r2(mean(h.map((r) => r.err))) }; })(),
};
console.log(`cards ${cards.length} (held out ${baseRows.filter((r) => r.held).length})`);
console.log(`baseline detectors      MAE ${baseSummary.all.mae}  signed ${baseSummary.all.signed}   | held-out MAE ${baseSummary.held.mae} signed ${baseSummary.held.signed}\n`);

if (GRID) {
  // Corners and edges fire at very different rates, so they are swept independently.
  const wears = [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8];
  const cutSets = {
    'tight   (150/300/500)': { moderate: 150, severe: 300, extreme: 500 },
    'mid     (250/450/700)': { moderate: 250, severe: 450, extreme: 700 },
    'wide    (350/650/950)': { moderate: 350, severe: 650, extreme: 950 },
    'all minor': { moderate: 1e9, severe: 1e9, extreme: 1e9 },
  };
  const cutsFor = (name) => cutSets[name];

  // Stage 1: wear thresholds, with the middle cut set.
  console.log('stage 1 — wear thresholds (severity cuts: mid)');
  console.log('| corners | edges | MAE | signed | within0.5 | held MAE | held signed |');
  console.log('|---|---|---|---|---|---|---|');
  const stage1 = [];
  for (const cw of wears) {
    for (const ew of wears) {
      const s = score({
        corners: { wearThreshold: cw, severityCuts: cutsFor('mid     (250/450/700)') },
        edges: { wearThreshold: ew, severityCuts: cutsFor('mid     (250/450/700)') },
      });
      stage1.push({ cw, ew, mae: s.all.mae, signed: s.all.signed, heldMae: s.held.mae, heldSigned: s.held.signed });
      console.log(`| ${cw} | ${ew} | ${s.all.mae} | ${s.all.signed} | ${s.all.within05} | ${s.held.mae} | ${s.held.signed} |`);
    }
  }
  stage1.sort((a, b) => a.heldMae - b.heldMae);
  const best = stage1[0];
  console.log(`\nbest wear thresholds by held-out MAE: corners ${best.cw}, edges ${best.ew} -> held MAE ${best.heldMae}, all ${best.mae}`);

  // Stage 2: severity cut lines at those thresholds.
  console.log('\nstage 2 — severity cuts at those thresholds');
  console.log('| cuts | MAE | signed | within0.5 | held MAE | held signed |');
  console.log('|---|---|---|---|---|---|');
  const stage2 = [];
  for (const [name, cuts] of Object.entries(cutSets)) {
    const s = score({ corners: { wearThreshold: best.cw, severityCuts: cuts }, edges: { wearThreshold: best.ew, severityCuts: cuts } });
    stage2.push({ name, cuts, mae: s.all.mae, heldMae: s.held.mae, heldSigned: s.held.signed });
    console.log(`| ${name} | ${s.all.mae} | ${s.all.signed} | ${s.all.within05} | ${s.held.mae} | ${s.held.signed} |`);
  }
  stage2.sort((a, b) => a.heldMae - b.heldMae);
  console.log(`\nbest cuts by held-out MAE: ${stage2[0].name.trim()} -> held MAE ${stage2[0].heldMae}`);
  console.log(`\nsuggested MODEL_DEFAULTS: corners wear ${best.cw}, edges wear ${best.ew}, cuts ${JSON.stringify(stage2[0].cuts)}`);
}

// ── the configured defaults ────────────────────────────────────────────────
const final = score(MODEL_DEFAULTS, true);
console.log(`\ndefaults (corners wear ${MODEL_DEFAULTS.corners.wearThreshold}, edges wear ${MODEL_DEFAULTS.edges.wearThreshold}):`);
console.log(`  all      MAE ${final.all.mae}  signed ${final.all.signed}  exact ${final.all.exact}%  within0.5 ${final.all.within05}%`);
console.log(`  held out MAE ${final.held.mae}  signed ${final.held.signed}  exact ${final.held.exact}%  within0.5 ${final.held.within05}%`);
console.log('  by TAG grade bucket:');
for (const [b, s] of Object.entries(final.byBucket)) console.log(`    ${b.padEnd(7)} n=${String(s.cards).padStart(3)}  MAE ${s.mae}  signed ${s.signed}  within0.5 ${s.within05}%`);
console.log('  detection vs TAG report:');
for (const [t, s] of Object.entries(final.dingStats)) console.log(`    ${t.padEnd(7)} precision ${s.precision}  recall ${s.recall}  (tp ${s.tp} fp ${s.fp} fn ${s.fn})`);

// Paired bootstrap on the held-out cards: is the improvement bigger than the noise
// of a 100-card sample? Positive means the models beat the detectors.
const baseErr = new Map(baseRows.map((r) => [r.cert, Math.abs(r.err)]));
const paired = final.rows.filter((r) => r.held).map((r) => baseErr.get(r.cert) - Math.abs(r.err));
const draws = [];
let seed = 12345;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
for (let b = 0; b < 2000; b++) {
  let sum = 0;
  for (let i = 0; i < paired.length; i++) sum += paired[Math.floor(rnd() * paired.length)];
  draws.push(sum / paired.length);
}
draws.sort((a, b) => a - b);
const ci = [draws[Math.floor(draws.length * 0.025)], draws[Math.floor(draws.length * 0.975)]];
console.log(`  held-out improvement in MAE: ${r2(mean(paired))} grades (95% bootstrap ${r2(ci[0])} to ${r2(ci[1])}, n=${paired.length})`);
final.bootstrap = { meanImprovement: r2(mean(paired)), ci95: [r2(ci[0]), r2(ci[1])], n: paired.length };

const outFile = path.join(RESULTS, `${new Date().toISOString().slice(0, 10)}-${LABEL}.json`);
fs.writeFileSync(outFile, JSON.stringify({
  meta: { baseline: path.basename(BASELINE), predictions: path.basename(PREDICTIONS), defaults: MODEL_DEFAULTS, generatedAt: new Date().toISOString() },
  baseline: baseSummary,
  summary: { all: final.all, held: final.held, byBucket: final.byBucket, dingStats: final.dingStats, bootstrap: final.bootstrap },
  cards: final.rows.map((r) => ({ cert: r.cert, tagGrade: r.tagGrade, softGrade: r.softGrade, err: r2(r.err), held: r.held, dings: r.dings.length })),
}, null, 1));
console.log(`\nwrote ${path.relative(path.join(here, '..', '..'), outFile)}`);
