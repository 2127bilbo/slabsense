/**
 * ============================================================================
 * SLABSENSE GRADING ENGINE — gradingEngine.js
 * ============================================================================
 * THE single source of truth for all grading math.
 *
 * Implements: /docs/GRADING_SCALE.md  (deductions, subgrades, compounding, caps)
 *             /docs/COMPANY_OFFSETS.md (PSA/BGS/CGC/SGC conversion)
 *
 * Consumers:  src/App.jsx computeGrade()  → import { gradeCard }
 *             api/ai-analyze-unified.js   → import { gradeCard }
 *             api/deep-analyze-v2.js      → import { gradeCard }
 *             UI damage report            → per-defect `deduction` values
 *
 * RULES FOR EDITING THIS FILE:
 *  - Pure functions only. No fetch, no AI, no UI, no side effects.
 *  - Never rename exported functions or constant keys (API contract).
 *  - Any numeric change must be reflected in GRADING_SCALE.md first.
 *  - Run `node gradingEngine.test.js` after ANY edit. All tests must pass.
 * ============================================================================
 */

export const ENGINE_VERSION = '1.1';

/* ============================================================================
 * SECTION 1 — CONSTANTS (GRADING_SCALE.md §3)
 * ========================================================================== */

export const BASE_DEDUCTIONS = {
  CORNER: 4.0,
  EDGE: 5.0,
  SCRATCH: 2.5,
  DENT: 6.0,
  PRINT_DEFECT: 3.0,
  CREASE: 12.0,
  PLAY_WEAR: 3.5,
  PIT: 5.0,
  STAIN: 20.0,
  TEAR: 30.0,
};

export const SEVERITY_MULTIPLIERS = {
  minor: 1.0,
  moderate: 2.5,
  severe: 5.0,
  extreme: 8.0,
};

export const SIDE_MULTIPLIERS = {
  FRONT: 1.0,
  BACK: 0.7,
};

export const CATEGORY_FLOOR = 10;
export const CATEGORY_CEILING = 100;

/** Score → grade bands (GRADING_SCALE.md §6). Order matters: highest first. */
export const GRADE_TABLE = [
  { min: 99.0, grade: 10, label: 'Pristine', displayGrade: '10P' },
  { min: 95.0, grade: 10, label: 'Gem Mint', displayGrade: '10' },
  { min: 90.0, grade: 9, label: 'Mint', displayGrade: '9' },
  { min: 85.0, grade: 8.5, label: 'NM-MT+', displayGrade: '8.5' },
  { min: 80.0, grade: 8, label: 'NM-MT', displayGrade: '8' },
  { min: 75.0, grade: 7.5, label: 'NM+', displayGrade: '7.5' },
  { min: 70.0, grade: 7, label: 'NM', displayGrade: '7' },
  { min: 65.0, grade: 6.5, label: 'EX-MT+', displayGrade: '6.5' },
  { min: 60.0, grade: 6, label: 'EX-MT', displayGrade: '6' },
  { min: 55.0, grade: 5.5, label: 'EX+', displayGrade: '5.5' },
  { min: 50.0, grade: 5, label: 'EX', displayGrade: '5' },
  { min: 45.0, grade: 4.5, label: 'VG-EX+', displayGrade: '4.5' },
  { min: 40.0, grade: 4, label: 'VG-EX', displayGrade: '4' },
  { min: 35.0, grade: 3.5, label: 'VG+', displayGrade: '3.5' },
  { min: 30.0, grade: 3, label: 'VG', displayGrade: '3' },
  { min: 25.0, grade: 2.5, label: 'Good+', displayGrade: '2.5' },
  { min: 20.0, grade: 2, label: 'Good', displayGrade: '2' },
  { min: 15.0, grade: 1.5, label: 'Fair', displayGrade: '1.5' },
  { min: 0.0, grade: 1, label: 'Poor', displayGrade: '1' },
];

/** TCG centering deviation → score (GRADING_SCALE.md §2). deviation = |ratio − 50|. */
export const CENTERING_SCORE_TABLE = {
  FRONT: [
    // TAG rubric, TCG column (docs/grading-research/sources/TAG_scale_and_rubric_verbatim.md, 2026-09-15):
    // 10P ~51/49 · 10 ~55/45 · 9 ~60/40 · 8.5 ~62.5 · 8 ~65 · 7.5 ~67.5 · 7 ~70 · 6.5 ~72.5 · 6 ~75 · 5.5 ~77.5
    // 5 ~80 · 4.5 ~82.5 · 4 ~85 · 3.5 ~87.5 · 3 ~90 · 2.5 ~92.5 · 2 ~95 · 1.5 ~98.33. DIG reports confirm 51/49 for 10P.
    { maxDev: 1.0, score: 99.5 },
    { maxDev: 5.0, score: 97.0 },
    { maxDev: 10.0, score: 92.0 },
    { maxDev: 12.5, score: 86.0 },
    { maxDev: 15.0, score: 82.5 },
    { maxDev: 17.5, score: 77.5 },
    { maxDev: 20.0, score: 72.5 },
    { maxDev: 22.5, score: 67.5 },
    { maxDev: 25.0, score: 62.5 },
    { maxDev: 27.5, score: 57.5 },
    { maxDev: 30.0, score: 52.5 },
    { maxDev: 32.5, score: 47.5 },
    { maxDev: 35.0, score: 42.5 },
    { maxDev: 37.5, score: 37.5 },
    { maxDev: 40.0, score: 32.5 },
    { maxDev: 42.5, score: 27.5 },
    { maxDev: 45.0, score: 22.5 },
    { maxDev: 48.33, score: 17.5 },
    { maxDev: Infinity, score: 10.0 },
  ],
  BACK: [
    // TCG backs: 10P ~52/48 · 10 ~65/35 · 9 ~75/25 · 8.5 ~85/15 · 8 ~95/5; below 8 "a tiny sliver of border" is
    // allowed but not a miscut, so anything past 95/5 sits in the 7.5 band.
    { maxDev: 2.0, score: 99.5 },
    { maxDev: 15.0, score: 97.0 },
    { maxDev: 25.0, score: 92.0 },
    { maxDev: 35.0, score: 86.0 },
    { maxDev: 45.0, score: 82.5 },
    { maxDev: Infinity, score: 77.5 },
  ],
};

export const SUBGRADE_KEYS = [
  'frontCentering', 'backCentering',
  'frontCorners', 'backCorners',
  'frontEdges', 'backEdges',
  'frontSurface', 'backSurface',
];

const SURFACE_TYPES = new Set([
  'SCRATCH', 'DENT', 'PRINT_DEFECT', 'CREASE', 'PLAY_WEAR', 'PIT', 'STAIN', 'TEAR',
]);

/* ============================================================================
 * SECTION 2 — DEFECT DEDUCTION MATH (GRADING_SCALE.md §3)
 * ========================================================================== */

/**
 * Raw deduction for a single defect BEFORE diminishing returns.
 * deduction = BASE[type] × SEVERITY[severity] × SIDE[side]
 */
export function calculateDeduction(type, severity, side) {
  const base = BASE_DEDUCTIONS[type];
  const sev = SEVERITY_MULTIPLIERS[severity];
  const sideM = SIDE_MULTIPLIERS[side];
  if (base === undefined) throw new Error(`Unknown defect type: ${type}`);
  if (sev === undefined) throw new Error(`Unknown severity: ${severity}`);
  if (sideM === undefined) throw new Error(`Unknown side: ${side} (use FRONT/BACK)`);
  return base * sev * sideM;
}

/** Diminishing returns factor (GRADING_SCALE.md §3.4). index 0 = worst defect. */
export function diminishFactor(index) {
  return 1 / (1 + index * 0.15);
}

/**
 * Normalize a defect's scoring category from its type.
 * CORNER → CORNER, EDGE → EDGE, all surface types → SURFACE.
 */
export function categoryForType(type) {
  if (type === 'CORNER') return 'CORNER';
  if (type === 'EDGE') return 'EDGE';
  if (SURFACE_TYPES.has(type)) return 'SURFACE';
  throw new Error(`Unknown defect type: ${type}`);
}

/**
 * Score one category on one side from its defects.
 * Defects are sorted worst-first, diminishing returns applied in that order.
 * Returns { score, scoredDefects } where scoredDefects carry final `deduction`.
 */
export function scoreCategory(defects) {
  const sorted = [...defects].sort(
    (a, b) =>
      calculateDeduction(b.type, b.severity, b.side) -
      calculateDeduction(a.type, a.severity, a.side)
  );
  let total = 0;
  const scoredDefects = sorted.map((d, i) => {
    const deduction =
      Math.round(calculateDeduction(d.type, d.severity, d.side) * diminishFactor(i) * 100) / 100;
    total += deduction;
    return { ...d, deduction };
  });
  const score = Math.max(CATEGORY_FLOOR, Math.round((CATEGORY_CEILING - total) * 100) / 100);
  return { score, scoredDefects };
}

/* ============================================================================
 * SECTION 3 — CENTERING (GRADING_SCALE.md §2)
 * ========================================================================== */

/** The ONLY valid deviation formula. A 55/45 card → 5.0. */
export function centeringDeviation(ratio) {
  return Math.abs(ratio - 50);
}

/** Deviation → 0–100 centering score for a side ('FRONT' | 'BACK'). */
export function centeringScore(maxDev, side) {
  const table = CENTERING_SCORE_TABLE[side];
  if (!table) throw new Error(`Unknown side: ${side}`);
  for (const row of table) {
    if (maxDev <= row.maxDev) return row.score;
  }
  return table[table.length - 1].score;
}

/* ============================================================================
 * SECTION 4 — SUBGRADES + COMPOUNDING + CAPS (GRADING_SCALE.md §4–5)
 * ========================================================================== */

/**
 * Compute all 8 subgrades.
 * @param defects  Array of { side:'FRONT'|'BACK', type, severity, ... }
 * @param centering { front:{maxDev}, back:{maxDev}|null }
 * @param frontOnly boolean — back subgrades become null
 */
export function computeSubgrades(defects, centering, frontOnly = false) {
  const groups = {
    frontCorners: [], backCorners: [],
    frontEdges: [], backEdges: [],
    frontSurface: [], backSurface: [],
  };
  for (const d of defects) {
    const cat = categoryForType(d.type);
    const key =
      (d.side === 'FRONT' ? 'front' : 'back') +
      (cat === 'CORNER' ? 'Corners' : cat === 'EDGE' ? 'Edges' : 'Surface');
    groups[key].push(d);
  }

  const scoredAll = [];
  const sub = {};
  for (const key of Object.keys(groups)) {
    if (frontOnly && key.startsWith('back')) {
      sub[key] = null;
      continue;
    }
    const { score, scoredDefects } = scoreCategory(groups[key]);
    sub[key] = score;
    scoredAll.push(...scoredDefects);
  }

  sub.frontCentering = centeringScore(centering.front.maxDev, 'FRONT');
  sub.backCentering =
    frontOnly || !centering.back ? null : centeringScore(centering.back.maxDev, 'BACK');

  return { subgrades: sub, scoredDefects: scoredAll };
}

/** TAG-style compounding: min×0.75 + mean×0.25 over non-null subgrades. */
export function combineSubgrades(subgrades) {
  const vals = SUBGRADE_KEYS.map((k) => subgrades[k]).filter((v) => v !== null && v !== undefined);
  const min = Math.min(...vals);
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const score = Math.round((min * 0.75 + mean * 0.25) * 100) / 100;
  const minKey = SUBGRADE_KEYS.find((k) => subgrades[k] === min);
  return { score, min, mean, minSubgrade: { key: minKey, value: min } };
}

/** Score → grade band. */
export function scoreToGrade(score) {
  for (const band of GRADE_TABLE) {
    if (score >= band.min) return band;
  }
  return GRADE_TABLE[GRADE_TABLE.length - 1];
}

/** Ceiling score of the band a given score falls in (e.g. 87 → 89.99). */
function bandCeiling(score) {
  const idx = GRADE_TABLE.findIndex((b) => score >= b.min);
  if (idx <= 0) return 100;
  return GRADE_TABLE[idx - 1].min - 0.01;
}

/**
 * Hard caps (GRADING_SCALE.md §5) + the min-subgrade clamp (§4 invariant).
 * Returns { score, capsApplied[] }.
 */
export function applyCaps(rawScore, defects, subgradeMin, centering, subgrades) {
  let score = rawScore;
  const capsApplied = [];
  const cap = (maxScore, name) => {
    if (score > maxScore) {
      score = maxScore;
      capsApplied.push(name);
    }
  };

  const has = (pred) => defects.some(pred);
  const sevRank = { minor: 0, moderate: 1, severe: 2, extreme: 3 };

  // Any crease is structural damage: cap at 6 whatever the severity label (PSA already did).
  // Pass 2 of the deep grade used to erase this cap by relabelling a crease "minor".
  if (has((d) => d.type === 'CREASE')) cap(60, 'CREASE_CAP_6');
  if (has((d) => d.type === 'CREASE' && sevRank[d.severity] >= 2)) cap(50, 'CREASE_CAP_5');
  if (has((d) => d.type === 'TEAR')) cap(40, 'TEAR_CAP_4');
  if (has((d) => d.type === 'STAIN' && sevRank[d.severity] >= 2)) cap(50, 'STAIN_CAP_5');
  if (has((d) => d.severity === 'extreme')) cap(50, 'EXTREME_CAP_5');
  if (defects.length >= 5) cap(85, 'DEFECT_COUNT_CAP_8.5');
  if (has((d) => d.type === 'CORNER' || d.type === 'EDGE')) cap(98.9, 'PRISTINE_BLOCK');

  // Pristine gate (GRADING_SCALE.md §5): structural + centering + surface requirements.
  if (score >= 99.0) {
    const frontDevOK = centering.front.maxDev <= 2.0;
    const backDevOK = !centering.back || centering.back.maxDev <= 2.0;
    const surfaceDefects = defects.filter((d) => categoryForType(d.type) === 'SURFACE');
    const allMinor = surfaceDefects.every((d) => d.severity === 'minor');
    const structuralClean = !has((d) => d.type === 'CORNER' || d.type === 'EDGE');
    if (!(frontDevOK && backDevOK && structuralClean && allMinor && surfaceDefects.length <= 3)) {
      cap(98.9, 'PRISTINE_GATE');
    }
  }

  // MIN-SUBGRADE CLAMP: overall grade may never exceed the grade implied by the
  // lowest subgrade. Implemented as a score clamp to that subgrade's band ceiling
  // so TAG score and grade stay coherent. (Matches TAG behavior: 10/10/10/9 → 9.)
  cap(bandCeiling(subgradeMin), 'MIN_SUBGRADE_CLAMP');

  return { score: Math.round(score * 100) / 100, capsApplied };
}

/* ============================================================================
 * SECTION 5 — COMPANY CONVERSION (COMPANY_OFFSETS.md)
 * ========================================================================== */

export const ALLOWED_SUBGRADES = {
  psa: [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7, 7.5, 8, 8.5, 9, 10],
  bgs: [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10],
  cgc: [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10],
  sgc: [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10],
};

/** Strict-bias rounding: snap DOWN to nearest allowed value. */
export function snapDown(raw, allowedList) {
  let best = allowedList[0];
  for (const g of allowedList) {
    if (g <= raw + 1e-9 && g > best) best = g;
  }
  return best;
}

/** 8 → 3 condition subgrades, front-weighted 0.65/0.35 (COMPANY_OFFSETS.md §1.1). */
export function mergeSubgrades(sub) {
  const merge = (f, b) => (b === null || b === undefined ? f : f * 0.65 + b * 0.35);
  return {
    corners: merge(sub.frontCorners, sub.backCorners),
    edges: merge(sub.frontEdges, sub.backEdges),
    surface: merge(sub.frontSurface, sub.backSurface),
  };
}

/** Merged 0–100 → company subgrade (COMPANY_OFFSETS.md §1.2). */
export function toCompanySubgrade(score100, company) {
  return snapDown(score100 / 10, ALLOWED_SUBGRADES[company]);
}

/** Company centering threshold tables: [grade, frontDevMax, backDevMax]. */
const COMPANY_CENTERING = {
  psa: [
    [10, 5.0, 25.0], [9, 10.0, 40.0], [8, 15.0, 40.0], [7, 20.0, 40.0],
    [6, 30.0, 40.0], [5, 35.0, 40.0], [4, 35.0, 40.0], [3, 40.0, 40.0], [2, 40.0, 40.0],
    [1.5, 40.0, 40.0], [1, Infinity, Infinity],
  ],
  // beckett.com/grading-standards (docs/grading-research/sources/BGS_gradingstandards_verbatim.md)
  bgs: [
    [10, 0.0, 5.0], [9.5, 5.0, 10.0], [9, 5.0, 20.0], [8, 10.0, 30.0], [7, 15.0, 40.0],
    [6, 20.0, 45.0], [5, 25.0, 45.0], [4, 30.0, 50.0], [3, 35.0, 50.0], [1, Infinity, Infinity],
  ],
  cgc: [
    [10, 5.0, 25.0], [9, 10.0, 40.0], [8, 15.0, 40.0], [7.5, 15.0, 40.0], [7, 20.0, 40.0],
    [6, 25.0, 40.0], [4.5, 35.0, 40.0], [3.5, 40.0, 40.0], [3, Infinity, Infinity],
  ],
  // gosgc.com/card-grading/scale (docs/grading-research/sources/SGC_gradingscale_verbatim.md). SGC publishes
  // one "X/Y or better" figure per grade with no separate back tolerance, so only the front is constrained.
  sgc: [
    [10, 5.0, Infinity], [9, 10.0, Infinity], [8.5, 15.0, Infinity], [8, 15.0, Infinity],
    [7.5, 20.0, Infinity], [7, 20.0, Infinity], [6, 25.0, Infinity], [5, 30.0, Infinity],
    [4, 35.0, Infinity], [3, 40.0, Infinity], [2, 40.0, Infinity], [1.5, 40.0, Infinity], [1, Infinity, Infinity],
  ],
};

/** Highest company centering subgrade whose front AND back thresholds pass. */
export function centeringSubgrade(maxDevF, maxDevB, company) {
  const table = COMPANY_CENTERING[company];
  const b = maxDevB === null || maxDevB === undefined ? 0 : maxDevB;
  for (const [grade, fMax, bMax] of table) {
    if (maxDevF <= fMax && b <= bMax) return grade;
  }
  return table[table.length - 1][0];
}

const PSA_LABELS = {
  10: 'Gem Mint', 9: 'Mint', 8.5: 'NM-MT+', 8: 'NM-MT', 7.5: 'NM+', 7: 'NM',
  6.5: 'EX-MT+', 6: 'EX-MT', 5.5: 'EX+', 5: 'EX', 4.5: 'VG-EX+', 4: 'VG-EX',
  3.5: 'VG+', 3: 'VG', 2.5: 'Good+', 2: 'Good', 1.5: 'Fair', 1: 'Poor',
};
const BGS_LABELS = { ...PSA_LABELS, 9.5: 'Gem Mint', 10: 'Pristine' };
const CGC_LABELS = { ...PSA_LABELS, 9.5: 'Mint+', 9: 'Mint', 10: 'Gem Mint' };
const SGC_LABELS = { ...PSA_LABELS, 9.5: 'Mint+', 10: 'Gem Mint' };

const sevRank = { minor: 0, moderate: 1, severe: 2, extreme: 3 };

/** PSA — lowest score wins + caps (COMPANY_OFFSETS.md §3). */
function convertPSA(merged, centering, defects) {
  const subs = {
    centering: centeringSubgrade(centering.front.maxDev, centering.back?.maxDev ?? null, 'psa'),
    corners: toCompanySubgrade(merged.corners, 'psa'),
    edges: toCompanySubgrade(merged.edges, 'psa'),
    surface: toCompanySubgrade(merged.surface, 'psa'),
  };
  let grade = Math.min(subs.centering, subs.corners, subs.edges, subs.surface);
  // Source: docs/grading-research/sources/PSA_gradingstandards_verbatim.md (psacard.com, captured 2026-09-15)
  if (defects.length >= 1) grade = Math.min(grade, 9);            // 10 = virtually perfect
  if (defects.length >= 3) grade = Math.min(grade, 8);            // 9 = "only one" minor flaw
  const cornerCount = defects.filter((d) => d.type === 'CORNER').length;
  if (cornerCount >= 1) grade = Math.min(grade, 8);               // 9 allows no corner wear; 8 = slightest fraying, 1-2 corners
  if (cornerCount >= 3) grade = Math.min(grade, 7);               // 7 = slight fraying on some corners
  const creaseSev = Math.max(-1, ...defects.filter((d) => d.type === 'CREASE').map((d) => sevRank[d.severity]));
  if (creaseSev >= 0) grade = Math.min(grade, 4);                 // 4 = "a light crease may be visible"
  if (creaseSev >= 2) grade = Math.min(grade, 2);                 // 2 = "several creases"; 1.5 = "heavy creases"
  const tearSev = Math.max(-1, ...defects.filter((d) => d.type === 'TEAR').map((d) => sevRank[d.severity]));
  if (tearSev >= 0) grade = Math.min(grade, 4);
  if (tearSev >= 2) grade = Math.min(grade, 1);                   // missing pieces / major tear cannot reach 1.5
  if (defects.some((d) => d.severity === 'extreme')) grade = Math.min(grade, 5);
  grade = snapDown(grade, ALLOWED_SUBGRADES.psa);
  return { grade, label: PSA_LABELS[grade] ?? '', displayGrade: String(grade), subgrades: subs };
}

/** BGS — four subgrades + 0.5 rule (COMPANY_OFFSETS.md §4). */
function convertBGS(merged, centering, defects) {
  let corners = toCompanySubgrade(merged.corners, 'bgs');
  const cornerDefects = defects.filter((d) => d.type === 'CORNER');
  if (cornerDefects.length > 0) {
    corners = snapDown(corners - 0.5, ALLOWED_SUBGRADES.bgs); // magnification strictness
    if (cornerDefects.some((d) => sevRank[d.severity] >= 1)) corners = Math.min(corners, 8);
  }
  const subs = {
    centering: centeringSubgrade(centering.front.maxDev, centering.back?.maxDev ?? null, 'bgs'),
    corners,
    edges: toCompanySubgrade(merged.edges, 'bgs'),
    surface: toCompanySubgrade(merged.surface, 'bgs'),
  };
  const vals = [subs.centering, subs.corners, subs.edges, subs.surface].sort((a, b) => a - b);
  const lowest = vals[0];
  const secondLowest = vals[1];
  let grade;
  if (vals.filter((v) => v === lowest).length >= 2) {
    grade = lowest; // tie at lowest
  } else if (secondLowest - lowest >= 3) {
    grade = lowest + 1; // drastic-gap exception (10/6/10/10 → 7)
  } else {
    grade = Math.min(lowest + 0.5, secondLowest, lowest + 2);
  }
  // Caps from the published chart (docs/grading-research/sources/BGS_gradingstandards_verbatim.md)
  const sevOf = (type) => Math.max(-1, ...defects.filter((d) => d.type === type).map((d) => sevRank[d.severity]));
  const countOf = (type, minSev = 0) => defects.filter((d) => d.type === type && sevRank[d.severity] >= minSev).length;
  if (defects.length >= 1) grade = Math.min(grade, 9.5);             // Pristine: perfect corners/edges, no print spots
  if (countOf('CORNER') >= 1) grade = Math.min(grade, 9);              // 9: slight corner wear under normal scrutiny
  if (countOf('CORNER') >= 2) grade = Math.min(grade, 7);              // 7: very minor wear on two or three corners
  if (countOf('CORNER', 1) >= 1) grade = Math.min(grade, 5);           // 5: a minor ding (6 is "free of dings")
  if (countOf('CORNER', 1) >= 2) grade = Math.min(grade, 4);           // 4: moderate dings
  if (sevOf('CORNER') >= 2) grade = Math.min(grade, 3);                // 3: slightly rounded / noticeably notched
  if (sevOf('EDGE') >= 1) grade = Math.min(grade, 6);                  // 6: moderate roughness or chipping
  if (sevOf('EDGE') >= 2) grade = Math.min(grade, 3);                  // 3: heavy notching / heavy chipping
  if (sevOf('PRINT_DEFECT') >= 1) grade = Math.min(grade, 7);          // 7: a few noticeable print spots
  if (sevOf('PRINT_DEFECT') >= 2) grade = Math.min(grade, 4);          // 4: heavy print spots
  if (sevOf('SCRATCH') >= 1 || sevOf('DENT') >= 1 || sevOf('PIT') >= 1) grade = Math.min(grade, 5);
  if (sevOf('PLAY_WEAR') >= 0) grade = Math.min(grade, 4);             // 4: very minor scuffing (6/5 are "devoid of scuffing")
  if (sevOf('PLAY_WEAR') >= 1) grade = Math.min(grade, 3);             // 3: minor scuffing
  if (sevOf('STAIN') >= 0) grade = Math.min(grade, 7);                 // 7: a very minor wax stain on back
  if (sevOf('STAIN') >= 1) grade = Math.min(grade, 4);                 // 4: moderate wax stains
  const creaseSev = sevOf('CREASE');
  if (creaseSev >= 0) grade = Math.min(grade, 4);                      // 4: hairline creases
  if (creaseSev >= 1) grade = Math.min(grade, 3);                      // 3: very minor creases (nothing published for 2)
  if (creaseSev >= 2) grade = Math.min(grade, 1);                      // 1: heavy creases
  const tearSev = sevOf('TEAR');
  if (tearSev >= 0) grade = Math.min(grade, 4);                        // 4: extremely subtle tear
  if (tearSev >= 1) grade = Math.min(grade, 3);                        // 3: very minor tear
  if (tearSev >= 2) grade = Math.min(grade, 1);                        // 1: severe tear
  if (defects.some((d) => d.severity === 'extreme')) grade = Math.min(grade, 1);
  grade = snapDown(grade, ALLOWED_SUBGRADES.bgs);
  const all10 = vals.every((v) => v === 10);
  const goldLabel = !all10 && vals.filter((v) => v === 10).length === 3 && vals.includes(9.5);
  let label = BGS_LABELS[grade] ?? '';
  if (grade === 10) label = all10 ? 'Pristine (Black Label)' : goldLabel ? 'Pristine (Gold Label)' : 'Pristine';
  return { grade, label, displayGrade: String(grade), subgrades: subs };
}

/** CGC — holistic, centering compensatable up to 1.0 (COMPANY_OFFSETS.md §5). */
function convertCGC(merged, centering, defects) {
  const subs = {
    centering: centeringSubgrade(centering.front.maxDev, centering.back?.maxDev ?? null, 'cgc'),
    corners: toCompanySubgrade(merged.corners, 'cgc'),
    edges: toCompanySubgrade(merged.edges, 'cgc'),
    surface: toCompanySubgrade(merged.surface, 'cgc'),
  };
  const base = Math.min(subs.corners, subs.edges, subs.surface);
  let grade = subs.centering >= base ? base : Math.max(subs.centering, base - 1.0);
  // Source: docs/grading-research/sources/CGC_gradingscale_verbatim.md (cgccards.com, fetched 2026-09-15)
  const sevOf = (type) => Math.max(-1, ...defects.filter((d) => d.type === type).map((d) => sevRank[d.severity]));
  const countOf = (type, minSev = 0) => defects.filter((d) => d.type === type && sevRank[d.severity] >= minSev).length;
  if (defects.length >= 1) grade = Math.min(grade, 9);                 // Gem Mint 10: perfect corners, no print spots, no surface flaws
  if (defects.length >= 2) grade = Math.min(grade, 7.5);               // 8.5 / 8: "one of the following very minor flaws is allowed"
  const minorCorners = countOf('CORNER');
  if (minorCorners >= 2) grade = Math.min(grade, 7.5);                 // 7.5: touch of wear on two or three corners
  if (minorCorners >= 3) grade = Math.min(grade, 7);                   // 7: three or more corners
  const dinged = countOf('CORNER', 1);                                 // moderate = "dinged"
  if (dinged >= 1) grade = Math.min(grade, 6.5);
  if (dinged >= 2) grade = Math.min(grade, 5.5);
  if (dinged >= 3) grade = Math.min(grade, 5);
  if (sevOf('CORNER') >= 2) grade = Math.min(grade, 4.5);              // severe = rounding
  if (sevOf('CORNER') >= 3) grade = Math.min(grade, 3.5);              // four rounded corners
  if (sevOf('EDGE') >= 1) grade = Math.min(grade, 5.5);                // chipping on the edges
  if (sevOf('EDGE') >= 2) grade = Math.min(grade, 3.5);                // moderate edge wear
  if (sevOf('PRINT_DEFECT') >= 1) grade = Math.min(grade, 6.5);        // noticeable print spots
  if (sevOf('SCRATCH') >= 1 || sevOf('DENT') >= 1 || sevOf('PIT') >= 1) grade = Math.min(grade, 4.5); // noticeable surface flaws
  if (sevOf('SCRATCH') >= 2) grade = Math.min(grade, 3.5);
  if (sevOf('STAIN') >= 0) grade = Math.min(grade, 6.5);               // light wax staining on the front acceptable at 6.5
  if (sevOf('STAIN') >= 1) grade = Math.min(grade, 3.5);               // moderate staining
  const creaseSev = sevOf('CREASE');
  if (creaseSev >= 0) grade = Math.min(grade, 4.5);                    // 4.5: one light crease
  if (countOf('CREASE') >= 2) grade = Math.min(grade, 4);              // 4: one or more light creases
  if (creaseSev >= 1) grade = Math.min(grade, 3.5);                    // 3.5: one moderate crease
  if (creaseSev >= 2) grade = Math.min(grade, 2.5);                    // 2.5 / 2: heavier creasing
  if (creaseSev >= 3) grade = Math.min(grade, 1);                      // severe creasing that breaks the surface
  if (sevOf('TEAR') >= 0) grade = Math.min(grade, 1.5);                // missing surface = catastrophic flaw
  if (sevOf('TEAR') >= 2) grade = Math.min(grade, 1);
  if (defects.some((d) => d.severity === 'extreme')) grade = Math.min(grade, 1.5);
  grade = snapDown(grade, ALLOWED_SUBGRADES.cgc);
  let label = CGC_LABELS[grade] ?? '';
  if (grade === 10) {
    const pristine =
      centering.front.maxDev === 0 && (centering.back?.maxDev ?? 0) === 0 && defects.length === 0;
    label = pristine ? 'Pristine' : 'Gem Mint';
  }
  return { grade, label, displayGrade: String(grade), subgrades: subs };
}

/** SGC — lowest factor + 3-category compounding penalty (COMPANY_OFFSETS.md §6). */
function convertSGC(merged, centering, defects) {
  const subs = {
    centering: centeringSubgrade(centering.front.maxDev, centering.back?.maxDev ?? null, 'sgc'),
    corners: toCompanySubgrade(merged.corners, 'sgc'),
    edges: toCompanySubgrade(merged.edges, 'sgc'),
    surface: toCompanySubgrade(merged.surface, 'sgc'),
  };
  let grade = Math.min(subs.centering, subs.corners, subs.edges, subs.surface);
  // Caps from the published scale (docs/grading-research/sources/SGC_gradingscale_verbatim.md)
  const sevOf = (type) => Math.max(-1, ...defects.filter((d) => d.type === type).map((d) => sevRank[d.severity]));
  const countOf = (type, minSev = 0) => defects.filter((d) => d.type === type && sevRank[d.severity] >= minSev).length;
  const onlySlightPrintSpot = defects.length === 1 && defects[0].type === 'PRINT_DEFECT' && defects[0].severity === 'minor';
  if (defects.length >= 1 && !onlySlightPrintSpot) grade = Math.min(grade, 9.5); // GM 10 allows one slight print spot only
  if (defects.length >= 2) grade = Math.min(grade, 8.5);              // 9: "a minor flaw"; 8.5: "a few minor flaws"
  if (countOf('CORNER') >= 2) grade = Math.min(grade, 7);              // 7: slight wear on some corners (8: one corner)
  if (countOf('CORNER', 1) >= 1) grade = Math.min(grade, 5);           // 5: minor rounding or fuzzing
  if (sevOf('CORNER') >= 2) grade = Math.min(grade, 4);                // 4: slightly rounded
  if (sevOf('CORNER') >= 3) grade = Math.min(grade, 3);                // 3: more rounded
  if (sevOf('EDGE') >= 1) grade = Math.min(grade, 6);                  // 6: slight notching of edges
  if (sevOf('EDGE') >= 2) grade = Math.min(grade, 5);                  // 5: roughness or chipping along edge
  if (sevOf('PRINT_DEFECT') >= 1) grade = Math.min(grade, 7);          // 7: some print spots or speckling
  if (sevOf('PRINT_DEFECT') >= 2) grade = Math.min(grade, 2);          // 2: heavy print spots
  if (sevOf('SCRATCH') >= 1 || sevOf('DENT') >= 1 || sevOf('PIT') >= 1) grade = Math.min(grade, 5); // 5: some scratching
  if (sevOf('SCRATCH') >= 2) grade = Math.min(grade, 3);
  if (sevOf('PLAY_WEAR') >= 1) grade = Math.min(grade, 5);             // 5: gloss may be lost from surface
  if (sevOf('PLAY_WEAR') >= 2) grade = Math.min(grade, 2);             // 2: surface scuffing
  if (sevOf('STAIN') >= 0) grade = Math.min(grade, 7);                 // 10/GM/9 are "free of stains"
  if (sevOf('STAIN') >= 1) grade = Math.min(grade, 3);                 // 3: staining more noticeable
  const creaseSev = sevOf('CREASE');
  if (creaseSev >= 0) grade = Math.min(grade, 5);                      // 5: one very slight surface or "spider" crease
  if (countOf('CREASE') >= 2) grade = Math.min(grade, 4);              // 4: hairline crease on one or both sides
  if (creaseSev >= 1) grade = Math.min(grade, 3);                      // 3: stronger creasing
  if (creaseSev >= 2) grade = Math.min(grade, 2);                      // 2: heavy crease(s)
  if (creaseSev >= 3) grade = Math.min(grade, 1);
  const tearSev = sevOf('TEAR');
  if (tearSev >= 0) grade = Math.min(grade, 4);                        // 4: a light tear or surface break
  if (tearSev >= 1) grade = Math.min(grade, 2);                        // 2: tear
  if (tearSev >= 3) grade = Math.min(grade, 1);
  if (defects.some((d) => d.severity === 'extreme')) grade = Math.min(grade, 1.5);
  grade = snapDown(Math.max(1, grade), ALLOWED_SUBGRADES.sgc);
  let label = SGC_LABELS[grade] ?? '';
  if (grade === 10) {
    const pristine =
      centering.front.maxDev === 0 && (centering.back?.maxDev ?? 0) === 0 && defects.length === 0;
    label = pristine ? 'Pristine (Gold Label)' : 'Gem Mint';
  }
  return { grade, label, displayGrade: String(grade), subgrades: subs };
}

/** Full company conversion (COMPANY_OFFSETS.md §8 call-out). */
export function convertToCompany(subgrades, centering, defects, company) {
  const merged = mergeSubgrades(subgrades);
  switch (company) {
    case 'psa': return convertPSA(merged, centering, defects);
    case 'bgs': return convertBGS(merged, centering, defects);
    case 'cgc': return convertCGC(merged, centering, defects);
    case 'sgc': return convertSGC(merged, centering, defects);
    default: throw new Error(`Unknown company: ${company}`);
  }
}

/* ============================================================================
 * SECTION 6 — TOP-LEVEL ENTRY POINT
 * ========================================================================== */

/**
 * gradeCard — the one function every grading path calls.
 *
 * @param {Object}   input
 * @param {Array}    input.defects   [{ side:'FRONT'|'BACK', type, severity,
 *                                      location?, zone?, x?, y?, width?, height?,
 *                                      description? }]
 * @param {Object}   input.centering { front:{lrRatio,tbRatio} , back:{lrRatio,tbRatio}|null }
 * @param {boolean} [input.frontOnly=false]
 *
 * @returns {Object} { centering, defects, subgrades, overall, companyGrades }
 *                   — drop-in sections of GRADING_OUTPUT_SCHEMA.md
 */
export function gradeCard({ defects = [], centering, frontOnly = false }) {
  if (!centering?.front) throw new Error('gradeCard: centering.front is required (manual tool values)');

  // 1) Centering block (deviation = |ratio − 50|, worst axis per side)
  const buildSide = (c) => {
    if (!c) return null;
    const devLR = Math.round(centeringDeviation(c.lrRatio) * 10) / 10;
    const devTB = Math.round(centeringDeviation(c.tbRatio) * 10) / 10;
    return { lrRatio: c.lrRatio, tbRatio: c.tbRatio, devLR, devTB, maxDev: Math.max(devLR, devTB) };
  };
  const cent = {
    source: 'manual',
    front: buildSide(centering.front),
    back: frontOnly ? null : buildSide(centering.back),
  };

  // 2) Subgrades (defect inspection first; centering scored last by design)
  const { subgrades, scoredDefects } = computeSubgrades(defects, cent, frontOnly);

  // 3) Compounding + caps + clamp
  const combined = combineSubgrades(subgrades);
  const { score, capsApplied } = applyCaps(combined.score, defects, combined.min, cent, subgrades);
  const band = scoreToGrade(score);

  const overall = {
    score,
    grade: band.grade,
    label: band.label,
    displayGrade: band.displayGrade,
    capsApplied,
    minSubgrade: combined.minSubgrade,
  };

  // 4) Company grades — TAG is baseline, others re-run their own algorithms
  const companyGrades = {
    tag: {
      grade: overall.grade,
      label: overall.label,
      displayGrade: overall.displayGrade,
      score: Math.floor(score * 10), // floor, never round: 94.99 must stay 949, not 950
    },
    psa: convertToCompany(subgrades, cent, defects, 'psa'),
    bgs: convertToCompany(subgrades, cent, defects, 'bgs'),
    cgc: convertToCompany(subgrades, cent, defects, 'cgc'),
    sgc: convertToCompany(subgrades, cent, defects, 'sgc'),
  };

  // 5) Defects block with ids + counts
  const items = scoredDefects.map((d, i) => ({ id: `d${i + 1}`, ...d }));
  const count = (pred) => items.filter(pred).length;
  const defectsBlock = {
    counts: {
      total: items.length,
      corner: count((d) => categoryForType(d.type) === 'CORNER'),
      edge: count((d) => categoryForType(d.type) === 'EDGE'),
      surface: count((d) => categoryForType(d.type) === 'SURFACE'),
      frontTotal: count((d) => d.side === 'FRONT'),
      backTotal: count((d) => d.side === 'BACK'),
    },
    items,
  };

  return { centering: cent, defects: defectsBlock, subgrades, overall, companyGrades };
}
