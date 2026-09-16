/**
 * Grading company metadata for the UI — DERIVED from the engine, never hand-maintained.
 *
 * Every number here (allowed grades, labels, centering thresholds, TAG score bands) comes from
 * src/lib/gradingEngine.js, whose company rules cite the verbatim standards in
 * docs/grading-research/sources/. This file only adds names, colours, and display shapes.
 * See docs/GRADING_SYSTEM.md.
 */
import {
  GRADE_TABLE,
  ALLOWED_SUBGRADES,
  COMPANY_CENTERING,
  CENTERING_SCORE_TABLE,
  COMPANY_LABELS,
} from '../lib/gradingEngine.js';

/** Grade → display colour (UI only). */
export const GRADE_COLORS = {
  10.0: { color: '#00ff88', bg: 'rgba(0,255,136,0.10)' },
  9.5:  { color: '#00dd77', bg: 'rgba(0,221,119,0.08)' },
  9.0:  { color: '#66dd44', bg: 'rgba(102,221,68,0.08)' },
  8.5:  { color: '#ccbb00', bg: 'rgba(204,187,0,0.08)' },
  8.0:  { color: '#ff9900', bg: 'rgba(255,153,0,0.08)' },
  7.5:  { color: '#ff7722', bg: 'rgba(255,119,34,0.08)' },
  7.0:  { color: '#ff6633', bg: 'rgba(255,102,51,0.08)' },
  6.5:  { color: '#ff5544', bg: 'rgba(255,85,68,0.08)' },
  6.0:  { color: '#ff4444', bg: 'rgba(255,68,68,0.08)' },
  5.5:  { color: '#dd3333', bg: 'rgba(221,51,51,0.08)' },
  5.0:  { color: '#cc2222', bg: 'rgba(204,34,34,0.08)' },
  4.5:  { color: '#bb1111', bg: 'rgba(187,17,17,0.08)' },
  4.0:  { color: '#aa1111', bg: 'rgba(170,17,17,0.08)' },
  3.5:  { color: '#991111', bg: 'rgba(153,17,17,0.08)' },
  3.0:  { color: '#881111', bg: 'rgba(136,17,17,0.08)' },
  2.5:  { color: '#771111', bg: 'rgba(119,17,17,0.08)' },
  2.0:  { color: '#661111', bg: 'rgba(102,17,17,0.08)' },
  1.5:  { color: '#551111', bg: 'rgba(85,17,17,0.08)' },
  1.0:  { color: '#441111', bg: 'rgba(68,17,17,0.08)' },
};
export const getGradeColor = (grade) => (GRADE_COLORS[grade] || GRADE_COLORS[1]).color;

const NAMES = {
  tag: { name: 'TAG', fullName: 'Technical Authentication & Grading' },
  psa: { name: 'PSA', fullName: 'Professional Sports Authenticator' },
  bgs: { name: 'BGS', fullName: 'Beckett Grading Services' },
  cgc: { name: 'CGC', fullName: 'Certified Guaranty Company' },
  sgc: { name: 'SGC', fullName: 'Sportscard Guaranty Corporation' },
};

/** TAG score bands as the UI lists them: { grade, label, min, max (1000-pt), color, bg }. */
const tagBands = GRADE_TABLE.map((b, i) => ({
  grade: b.grade,
  label: b.label,
  displayGrade: b.displayGrade,
  min: Math.round(b.min * 10),
  max: i === 0 ? 1000 : Math.round(GRADE_TABLE[i - 1].min * 10) - 1,
  ...(GRADE_COLORS[b.grade] || GRADE_COLORS[1]),
}));

/** TAG: centering "max side" per grade from the engine's deviation→score table (e.g. 10 → 55). */
function tagCenteringThresholds(side) {
  const out = {};
  for (const row of CENTERING_SCORE_TABLE[side]) {
    if (!isFinite(row.maxDev)) continue;
    const band = GRADE_TABLE.find((b) => row.score >= b.min);
    if (!band) continue;
    const key = band.displayGrade === '10P' ? '10P' : band.grade;   // 10 = Gem Mint (55/45); 10P listed separately
    if (out[key] === undefined) out[key] = 50 + row.maxDev;
  }
  return out;
}

/** Other companies: from the engine's per-grade [grade, maxFrontDev, maxBackDev] rows. */
function companyCenteringThresholds(id, col) {
  const out = {};
  for (const [grade, fMax, bMax] of COMPANY_CENTERING[id]) {
    const v = col === 'front' ? fMax : bMax;
    if (isFinite(v)) out[grade] = 50 + v;
  }
  return out;
}

/** Grade steps a company can issue (TAG's come from its score bands; the engine has no TAG entry in ALLOWED_SUBGRADES). */
const allowedSteps = (id) => (id === 'tag' ? [...new Set(GRADE_TABLE.map((b) => b.grade))] : ALLOWED_SUBGRADES[id]);

/** A company's own grade steps with its labels (highest first). */
function allowedGrades(id) {
  const labels = id === 'tag' ? Object.fromEntries(GRADE_TABLE.map((b) => [b.grade, b.label])) : (COMPANY_LABELS[id] || {});
  return [...allowedSteps(id)].sort((a, b) => b - a).map((g) => ({ grade: g, label: labels[g] ?? '', ...(GRADE_COLORS[g] || GRADE_COLORS[1]) }));
}

export const COMPANY_IDS = ['tag', 'psa', 'bgs', 'cgc', 'sgc'];
export const DEFAULT_GRADING_COMPANY = 'tag';

export const GRADING_COMPANIES = Object.fromEntries(COMPANY_IDS.map((id) => [id, {
  id,
  ...NAMES[id],
  hasHalfPoints: true,
  has9_5: allowedSteps(id).includes(9.5),
  hasTwoTypes10: id === 'tag' || id === 'cgc' || id === 'sgc',   // Pristine vs Gem Mint labels at 10
  grades: tagBands,                 // subscore rings/bars always read the TAG 1000-pt bands (score scale is TAG's)
  allowedGrades: allowedGrades(id), // the company's own final-grade steps + labels
  centeringThresholds: id === 'tag'
    ? { front: tagCenteringThresholds('FRONT'), back: tagCenteringThresholds('BACK') }
    : { front: companyCenteringThresholds(id, 'front'), back: companyCenteringThresholds(id, 'back') },
}]));

export function getCompanyOptions() {
  return COMPANY_IDS.map((id) => ({ id, name: NAMES[id].name, fullName: NAMES[id].fullName }));
}

/**
 * TAG 1000-point score → band (with colours). Used by the collection view to re-derive a grade
 * from a stored raw score; the score is always TAG-scale, so the band is TAG's regardless of company.
 */
export function getGradeFromScore(score) {
  const s = Number(score) || 0;
  return tagBands.find((b) => s >= b.min) || tagBands[tagBands.length - 1];
}
