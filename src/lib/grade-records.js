/**
 * grade-records.js — the ONE place that knows how AI / Deep grade results are stored on a saved
 * scan, read back, and turned into damage-report and condition displays.
 *
 * Used by: src/App.jsx (Grade tab + auto-save), src/components/Collection/CollectionView.jsx
 * (saved-card details, re-grades, Dings), src/services/scans.js (column mapping).
 *
 * Storage shape on `scans` (no new columns):
 *   ai_grades    { psa, bgs, cgc, sgc, tag, __deep__: { ...same } }
 *   ai_condition { subgrades, overall, confidence, defects: { counts, items }, centering, gradedAt,
 *                  __deep__: { ...same } }
 *   ai_summary   { positives, concerns, recommendation, __deep__: { ...same } }
 *   ai_centering { front, back }          (display shape from the standard AI result)
 * Standard AI lives at the top level, Deep AI under __deep__.
 */

/** Client-shaped result (shapeAiResult / shapeDeepResult) → stored record. */
export function aiRecordFromResult(result) {
  if (!result) return null;
  return {
    subgrades: result.subgrades || null,
    overall: result.overall || null,
    confidence: result.confidence || null,
    defects: result.defects || null,
    centering: result.centering || null,
    gradedAt: new Date().toISOString(),
  };
}

const splitDeep = (obj) => {
  const { __deep__ = null, ...rest } = obj || {};
  return { top: Object.keys(rest).length ? rest : null, deep: __deep__ };
};
const pack = (top, deep) => (top || deep ? { ...(top || {}), ...(deep ? { __deep__: deep } : {}) } : null);

/**
 * Build the scans AI columns. Anything not supplied is kept from `existing` (a scans row), so a
 * Deep re-grade never wipes the standard AI data and vice versa.
 */
export function scanAiColumns({
  ai = null, deep = null,
  aiGrades = null, deepGrades = null,
  aiSummary = null, deepSummary = null,
  aiCentering = null,
  existing = null,
} = {}) {
  const g = splitDeep(existing?.ai_grades);
  const c = splitDeep(existing?.ai_condition);
  const s = splitDeep(existing?.ai_summary);
  return {
    ai_grades: pack(aiGrades || g.top, deepGrades || g.deep),
    ai_condition: pack(ai || c.top, deep || c.deep),
    ai_summary: pack(aiSummary || s.top, deepSummary || s.deep),
    ai_centering: aiCentering || existing?.ai_centering || null,
  };
}

/** Read a scans row back into { ai, deep, aiGrades, deepGrades, aiSummary, deepSummary }. */
export function savedAi(row) {
  const g = splitDeep(row?.ai_grades);
  const c = splitDeep(row?.ai_condition);
  const s = splitDeep(row?.ai_summary);
  return {
    ai: c.top, deep: c.deep,
    aiGrades: g.top, deepGrades: g.deep,
    aiSummary: s.top, deepSummary: s.deep,
  };
}

/** Which grade a saved row can show: 'deep' if it has one, else 'ai', else 'software'. */
export function savedGradeMode(row) {
  const { ai, deep, aiGrades, deepGrades } = savedAi(row);
  if (deep || deepGrades) return 'deep';
  if (ai || aiGrades) return 'ai';
  return 'software';
}

/** 8 engine subgrades (0–100) → the four condition boxes (front/back averaged). Null when absent. */
export function conditionScores(subgrades) {
  if (!subgrades || typeof subgrades !== 'object') return null;
  const avg = (f, b) => {
    const vals = [subgrades[f], subgrades[b]].filter((v) => typeof v === 'number');
    return vals.length ? Math.round(vals.reduce((a, v) => a + v, 0) / vals.length) : null;
  };
  const out = {
    corners: avg('frontCorners', 'backCorners'),
    edges: avg('frontEdges', 'backEdges'),
    surface: avg('frontSurface', 'backSurface'),
    centering: avg('frontCentering', 'backCentering'),
  };
  return Object.values(out).some((v) => v !== null) ? out : null;
}

/**
 * Props for DamageReportModal from either live state or a saved row.
 * mode 'software' plots the detector dings; 'ai' / 'deep' plot that tier's defect items (x/y boxes).
 */
export function damageReportInputs({
  mode = 'software',
  dings = [],
  subgrades = null,
  frontCentering = null, backCentering = null,
  frontResult = null, backResult = null,
  ai = null, deep = null,
} = {}) {
  const tier = mode === 'deep' ? deep : mode === 'ai' ? ai : null;
  const items = tier?.defects?.items || null;
  return {
    gradeResult: {
      allDings: dings || [],
      subgrades: subgrades || {},
      defectCounts: tier?.defects?.counts || { total: (dings || []).length },
    },
    tagDefects: items,
    frontResult: frontResult || { centering: frontCentering || null },
    backResult: backResult || { centering: backCentering || null },
  };
}
