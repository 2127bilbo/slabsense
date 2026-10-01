/**
 * ============================================================================
 * GRADE ROLLUP ON THE PAID PATHS — gradeRollup.js
 * ============================================================================
 * The learned rollup (src/lib/grade-rollup.js) applied to an engine result.
 * Off unless GRADE_ROLLUP_MODEL=1: the engine's fixed rule stays the grade,
 * and the model's label is only reported beside it (meta.gradeRollup) so the
 * two can be compared on real traffic before the switch is thrown. With the
 * flag on, overall.grade/label/displayGrade become the model's; the score,
 * subgrades and caps are untouched, and meta.gradeRollupSource says 'model'.
 * ============================================================================
 */
import MODEL from './models/grade-rollup-v1.json' with { type: 'json' };
import { rollupGrade } from '../../src/lib/grade-rollup.js';

export function gradeRollupEnabled(env = process.env) { return env.GRADE_ROLLUP_MODEL === '1'; }

/** The model's grade for an engine result ({ subgrades, defects }). Never throws. */
export function modelGradeFor(engine) {
  try { return rollupGrade(engine.subgrades, engine.defects || [], MODEL); } catch { return null; }
}

/**
 * Apply (or just report) the model's grade on an assembled output's `overall`.
 * @returns {{overall:object, meta:object}} the overall block to use and the meta fields to merge
 */
export function applyGradeRollup(engine, overall, env = process.env) {
  const m = modelGradeFor(engine);
  if (!m) return { overall, meta: { gradeRollupSource: 'engine' } };
  const report = { label: m.label, displayGrade: m.displayGrade, grade: m.grade, index: m.index, raw: +m.raw.toFixed(3), version: MODEL.version };
  if (!gradeRollupEnabled(env)) return { overall, meta: { gradeRollupSource: 'engine', gradeRollup: report } };
  return {
    overall: { ...overall, grade: m.grade, label: m.label, displayGrade: m.displayGrade, engineGrade: overall.grade, engineLabel: overall.label },
    meta: { gradeRollupSource: 'model', gradeRollup: report },
  };
}
