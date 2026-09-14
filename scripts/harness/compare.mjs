#!/usr/bin/env node
/**
 * Compare two harness result files.
 *   node scripts/harness/compare.mjs results/A.json results/B.json
 * Prints every summary number side by side (B − A) and lists cards whose
 * software grade moved by ≥ 1.0.
 */
import fs from 'node:fs';

const [a, b] = process.argv.slice(2);
if (!a || !b) { console.error('usage: compare.mjs A.json B.json'); process.exit(1); }
const A = JSON.parse(fs.readFileSync(a, 'utf8'));
const B = JSON.parse(fs.readFileSync(b, 'utf8'));
const r2 = (x) => Math.round(x * 100) / 100;
const fmt = (x) => (x == null ? '-' : String(x));

console.log(`A: ${A.meta.label} (${A.meta.gitCommit})   B: ${B.meta.label} (${B.meta.gitCommit})   delta = B − A\n`);
const row = (name, va, vb) => console.log(`${name.padEnd(34)} ${fmt(va).padStart(9)} ${fmt(vb).padStart(9)} ${(va == null || vb == null ? '-' : fmt(r2(vb - va))).padStart(9)}`);
console.log(`${'metric'.padEnd(34)} ${'A'.padStart(9)} ${'B'.padStart(9)} ${'delta'.padStart(9)}`);
for (const k of ['mae', 'signed', 'exact', 'within05', 'within10']) row(`grade.${k}`, A.summary.grade[k], B.summary.grade[k]);
for (const bk of ['9-10', '7-8.5', '5-6.5', '1-4.5']) for (const k of ['mae', 'signed']) row(`bucket ${bk} ${k}`, A.summary.byBucket[bk]?.[k], B.summary.byBucket[bk]?.[k]);
for (const k of Object.keys(B.summary.subgrades)) for (const m of ['mae', 'signed']) row(`sub ${k} ${m}`, A.summary.subgrades[k]?.[m], B.summary.subgrades[k]?.[m]);
for (const k of Object.keys(B.summary.dings)) {
  const va = A.summary.dings[k], vb = B.summary.dings[k];
  if (!(va?.truth || va?.soft || vb?.truth || vb?.soft)) continue;
  row(`ding ${k} precision`, va?.precision, vb?.precision);
  row(`ding ${k} recall`, va?.recall, vb?.recall);
}
row('boundsFlagged', A.summary.boundsFlagged.length, B.summary.boundsFlagged.length);

const byCert = Object.fromEntries(A.cards.map((c) => [c.cert, c]));
const moved = B.cards.filter((c) => !c.error && byCert[c.cert] && !byCert[c.cert].error && Math.abs(c.softGrade - byCert[c.cert].softGrade) >= 1);
console.log(`\nCards whose software grade moved ≥1.0: ${moved.length}`);
for (const c of moved.slice(0, 40)) console.log(`  ${c.cert}  TAG ${c.tagGrade}  A ${byCert[c.cert].softGrade} → B ${c.softGrade}`);
