/**
 * ============================================================================
 * SLABSENSE SOFTWARE GRADE ADAPTER — softwareGrade.js
 * ============================================================================
 * Turns legacy detector dings into engine defects and runs gradingEngine.
 * Moved verbatim from src/App.jsx on 2026-09-14 (see
 * docs/superpowers/specs/2026-09-14-software-grade-harness-design.md).
 * Pure: no DOM, no React. Shared by the app and scripts/harness.
 * ============================================================================
 */
import { gradeCard, scoreToGrade, ENGINE_VERSION } from './gradingEngine.js';
import { GRADING_COMPANIES, DEFAULT_GRADING_COMPANY, GRADE_COLORS, calculateSoftwareConfidence } from './masterweights.js';

// Legacy GRADES array for backwards compatibility (uses selected company's scale)
export const getGradesForCompany = (companyId) => {
  const company = GRADING_COMPANIES[companyId];
  if (!company) return GRADING_COMPANIES[DEFAULT_GRADING_COMPANY].grades;
  return company.grades;
};

// Default to TAG for initial load
export const getGrade = (s, companyId = DEFAULT_GRADING_COMPANY) => {
  const grades = getGradesForCompany(companyId);
  for (const g of grades) if (s >= g.min && s <= g.max) return g;
  return grades[grades.length - 1];
};

/* ═══════════════════════════════════════════
   UNIFIED SCORING — adapter over gradingEngine.js
   Engine math: docs/GRADING_SCALE.md (100-pt subgrades, TAG baseline)
   Output contract: docs/GRADING_OUTPUT_SCHEMA.md
   Company conversion: docs/COMPANY_OFFSETS.md
   ═══════════════════════════════════════════ */

// Map legacy numeric ding severity (1/2/3, 4+) → engine severity keys.
// Already-string severities pass through untouched (future AI dings).
export function mapDingSeverity(sev) {
  if (typeof sev === "string") return sev;
  if (sev >= 4) return "extreme";
  if (sev >= 3) return "severe";
  if (sev >= 2) return "moderate";
  return "minor";
}

// Map legacy ding type strings → engine deduction type keys
// (GRADING_SCALE.md §3.1). Order matters: specific surface types first,
// generic SURFACE fallback last.
export function mapDingType(typeStr) {
  const t = (typeStr || "").toUpperCase();
  if (t.includes("CORNER")) return "CORNER";
  if (t.includes("EDGE")) return "EDGE";
  if (t.includes("CREASE") || t.includes("WRINKLE") || t.includes("BEND")) return "CREASE";
  if (t.includes("TEAR") || t.includes("RIP")) return "TEAR";
  if (t.includes("STAIN") || t.includes("WATER")) return "STAIN";
  if (t.includes("DENT") || t.includes("INDENT")) return "DENT";
  if (t.includes("PIT")) return "PIT";
  if (t.includes("PRINT") || t.includes("INK")) return "PRINT_DEFECT";
  if (t.includes("SCRATCH")) return "SCRATCH";
  if (t.includes("SURFACE") || t.includes("WEAR")) return "PLAY_WEAR";
  return null; // CENTERING and anything unknown → not an engine defect
}

// Legacy ding → engine defect. Returns null for CENTERING/unknown dings
// (centering is measured, never a defect item — GRADING_SCALE.md §7).
export function dingToEngineDefect(ding) {
  if (!ding || ding.type === "CENTERING") return null;
  const type = mapDingType(ding.type);
  if (!type) return null;
  return {
    side: ding.side === "BACK" ? "BACK" : "FRONT",
    type,
    severity: mapDingSeverity(ding.severity),
    location: ding.location || null,
    zone: ding.zone ?? null,
    x: ding.x ?? null,
    y: ding.y ?? null,
    width: ding.w ?? ding.width ?? null,
    height: ding.h ?? ding.height ?? null,
    description: ding.desc || ding.description || "",
  };
}

/**
 * F1: the displayed grade must come from the engine's per-company conversion,
 * not from a TAG-band lookup of the TAG score. Shape matches what the UI read
 * from the legacy getGrade() object: { grade, label, displayGrade, color, bg }.
 */
export function companyGradeObject(companyGrades, companyId, overall) {
  const cg = companyGrades[companyId] || companyGrades.tag;
  const isTag = !companyGrades[companyId] || companyId === 'tag';
  const grade = cg.grade;
  const label = isTag && overall?.label ? overall.label : cg.label;
  const colors = GRADE_COLORS[grade] || GRADE_COLORS[1];
  return { grade, label, displayGrade: cg.displayGrade ?? String(grade), ...colors };
}

export function computeGrade(frontDings, backDings, frontCenter, backCenter, companyId = DEFAULT_GRADING_COMPANY, imageQuality = null) {
  const allDings = [...frontDings, ...backDings];
  const totalDings = allDings.length;
  const company = GRADING_COMPANIES[companyId] || GRADING_COMPANIES[DEFAULT_GRADING_COMPANY];

  // ── 1) Adapt legacy dings → engine defects ─────────────────────────────
  const defects = allDings.map(dingToEngineDefect).filter(Boolean);

  // ── 2) Run the engine (ALL math happens in gradingEngine.js) ───────────
  // Defensive 50/50 default mirrors the old PERFECT_CENTER behavior.
  const engine = gradeCard({
    defects,
    centering: {
      front: frontCenter || { lrRatio: 50, tbRatio: 50 },
      back: backCenter || { lrRatio: 50, tbRatio: 50 },
    },
  });

  const { subgrades, overall, companyGrades } = engine;
  const tagScore1000 = companyGrades.tag.score;

  // ── 3) Legacy compatibility fields (UI reads these today) ──────────────
  // gradeCaps: rebuilt from engine subgrades so "Limited by: X" still works.
  const centeringCapGrade = scoreToGrade(
    Math.min(subgrades.frontCentering, subgrades.backCentering ?? 100)
  ).grade;
  const conditionCapGrade = scoreToGrade(
    Math.min(
      subgrades.frontCorners, subgrades.backCorners ?? 100,
      subgrades.frontEdges, subgrades.backEdges ?? 100,
      subgrades.frontSurface, subgrades.backSurface ?? 100
    )
  ).grade;
  const defectCountCap = engine.defects.counts.total >= 5 ? 8.5 : 10.0;

  // weightedScore: unchanged legacy display metric (numeric severity × side).
  let weightedScore = 0;
  for (const ding of allDings) {
    const sw = ding.side === "FRONT" ? 1.5 : 1.0;
    weightedScore += (typeof ding.severity === "number" ? ding.severity : 1) * sw;
  }

  const confidenceResult = calculateSoftwareConfidence(imageQuality, {
    manualCentering: false, // Will be set by caller if applicable
  });

  // ── 4) Return: legacy fields + unified schema fields ───────────────────
  return {
    // ——— LEGACY (keep until UI migrates; see ENGINE_WIRING.md) ———
    rawScore: tagScore1000,                       // TAG 1000-pt score
    grade: companyGradeObject(companyGrades, companyId, overall),   // F1: engine per-company grade
    companyId,
    companyName: company.name,
    totalDings,
    weightedScore: Math.round(weightedScore * 10) / 10,
    allDings,
    defectCounts: engine.defects.counts,          // superset of legacy {total,corner,edge,surface}
    centeringDeviation: {
      front: { lr: engine.centering.front.devLR, tb: engine.centering.front.devTB, max: engine.centering.front.maxDev },
      back: { lr: engine.centering.back.devLR, tb: engine.centering.back.devTB, max: engine.centering.back.maxDev },
    },
    gradeCaps: {
      centering: centeringCapGrade,
      defects: conditionCapGrade,
      defectCount: defectCountCap,
      final: overall.grade,
    },
    confidence: confidenceResult.confidence,
    confidenceFactors: confidenceResult.factors,

    // ——— UNIFIED SCHEMA (GRADING_OUTPUT_SCHEMA.md) — new canonical data ———
    subgrades,            // 8 keys, 0–100 scale (frontCentering ... backSurface)
    overall,              // { score, grade, label, displayGrade, capsApplied, minSubgrade }
    companyGrades,        // { tag, psa, bgs, cgc, sgc } each with native grade/label/subgrades
    defects: engine.defects,    // { counts, items[] } — every item has its deduction
    centering: engine.centering, // { source:"manual", front:{...}, back:{...} }
    gradePath: "software",
    engineVersion: ENGINE_VERSION,
  };
}
