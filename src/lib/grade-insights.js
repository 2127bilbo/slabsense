/*
 * SlabSense — https://www.slabsenseai.com
 * Copyright (c) 2026 SlabSense. All rights reserved.
 * Proprietary and confidential; see LICENSE at the repository root.
 */
/** Extracted from App.jsx on 2026-10-02 (App.jsx split, slice 1). */
export function calcConfidence(gradeResult, frontResult, backResult) {
  let confidence = 100;
  const reasons = [];
  
  // Check if centering defaulted to 50/50 (detection may have failed)
  const fc = frontResult.centering;
  if (fc.lrRatio === 50 && fc.tbRatio === 50) { confidence -= 25; reasons.push("Front centering defaulted to 50/50 — border detection may have failed"); }
  const bc = backResult.centering;
  if (bc.lrRatio === 50 && bc.tbRatio === 50) { confidence -= 15; reasons.push("Back centering defaulted to 50/50"); }
  
  // Check if score is near a grade boundary (within 20 points)
  const score = gradeResult.rawScore;
  const boundaries = [990, 950, 900, 850, 800, 700, 600, 500];
  for (const b of boundaries) {
    if (Math.abs(score - b) < 20) { confidence -= 15; reasons.push(`Score ${score} is near the ${b}-point grade boundary`); break; }
  }
  
  const level = confidence >= 80 ? "HIGH" : confidence >= 55 ? "MEDIUM" : "LOW";
  const color = confidence >= 80 ? "#00ff88" : confidence >= 55 ? "#ffcc00" : "#ff6633";
  
  return { confidence: Math.max(0, confidence), level, color, reasons };
}

/* Grade analysis tips (free grade): only what the engine measured. No weights, typical-grade patterns or
   surface verdicts; the old-engine wording ("front defects weigh 2x", "usually estimates in the 6-7 range")
   was removed 2026-10-03 along with the legacy surface check. */
const SUBGRADE_LABELS = {
  frontCentering: 'front centering', backCentering: 'back centering',
  frontCorners: 'front corners', backCorners: 'back corners',
  frontEdges: 'front edges', backEdges: 'back edges',
  frontSurface: 'front surface', backSurface: 'back surface',
};
const tone = (v) => (v >= 90 ? '#66dd44' : v >= 75 ? '#ffcc00' : v >= 60 ? '#ff9900' : '#ff6633');

export function getNextGradeInfo(gradeResult) {
  const tips = [];
  const counts = gradeResult?.defects?.counts || gradeResult?.defectCounts || {};
  const front = counts.frontTotal || 0, back = counts.backTotal || 0;
  if (front + back === 0) {
    tips.push({ text: 'No corner or edge wear found.', color: '#00ff88' });
  } else {
    const parts = [front && `${front} on the front`, back && `${back} on the back`].filter(Boolean).join(' and ');
    tips.push({ text: `Corner and edge wear found: ${parts}.`, color: '#ffcc00' });
  }
  const min = gradeResult?.overall?.minSubgrade;
  if (min && min.value < 100 && SUBGRADE_LABELS[min.key]) {
    tips.push({ text: `Lowest score: ${SUBGRADE_LABELS[min.key]} (${Math.round(min.value)}/100). The grade cannot go above the band this score falls in.`, color: tone(min.value) });
  }
  if (gradeResult?.gradePath === 'software') {
    tips.push({ text: 'The surface was not inspected in this grade. An AI Grade inspects it for scratches, print lines and dents.', color: '#888' });
  }
  return tips;
}
