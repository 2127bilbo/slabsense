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
  
  // Check if holo was detected (surface analysis less reliable)
  if (frontResult.surface.isHolo) { confidence -= 10; reasons.push("Holo card detected — surface analysis adjusted"); }
  if (backResult.surface.isHolo) { confidence -= 5; reasons.push("Back has high variance pattern"); }
  
  // Check surface anomaly rates (high rates even below DING threshold suggest noise)
  if (frontResult.surface.anomalyRate > 10 && frontResult.surface.dings.length === 0) {
    confidence -= 10; reasons.push("Front surface has elevated noise but no DING flagged");
  }
  
  const level = confidence >= 80 ? "HIGH" : confidence >= 55 ? "MEDIUM" : "LOW";
  const color = confidence >= 80 ? "#00ff88" : confidence >= 55 ? "#ffcc00" : "#ff6633";
  
  return { confidence: Math.max(0, confidence), level, color, reasons };
}

/* Next Grade Comparison */
export function getNextGradeInfo(gradeResult) {
  const score = gradeResult.rawScore;
  const dings = gradeResult.allDings;
  const totalDings = gradeResult.totalDings;
  const frontDings = dings.filter(d => d.side === "FRONT");
  const surfaceDings = dings.filter(d => d.type.includes("SURFACE"));
  const centerDings = dings.filter(d => d.type === "CENTERING");
  
  const tips = [];
  
  if (score >= 950) {
    tips.push({ text: "Card is in Gem Mint range — potential Pristine if centering is near-perfect", color: "#00ff88" });
  } else if (score >= 900) {
    if (centerDings.length > 0) tips.push({ text: "Centering is the only DING — improve framing won't fix the card, but it's close to a 10", color: "#66dd44" });
    if (totalDings <= 1) tips.push({ text: "Only 1 DING away from Gem Mint 10", color: "#66dd44" });
  } else if (score >= 800) {
    if (frontDings.length > 0) tips.push({ text: `${frontDings.length} front defect${frontDings.length>1?"s":""} — front defects weigh 2x. A clean front pushes toward Mint 9`, color: "#ffcc00" });
    if (surfaceDings.length > 0) tips.push({ text: "Surface wear is the heaviest grade penalty — this is what separates 8 from 9+", color: "#ffcc00" });
    tips.push({ text: `${totalDings} defects in total — 0-1 is where Mint 9 estimates sit`, color: "#ffcc00" });
  } else if (score >= 700) {
    if (frontDings.length >= 2) tips.push({ text: `Multiple front defects detected — cards with back-only defects estimate significantly higher`, color: "#ff9900" });
    tips.push({ text: `${Math.max(0, totalDings - 4)} fewer defects would reach the NM-MT 8 range`, color: "#ff9900" });
  } else if (score >= 600) {
    tips.push({ text: `${totalDings} defects with front surface wear — this pattern usually estimates in the 6-7 range`, color: "#ff6633" });
    if (surfaceDings.length > 0) tips.push({ text: "Front surface play wear is the biggest grade limiter", color: "#ff6633" });
  } else {
    tips.push({ text: `Heavy defect load (${totalDings} defects) — card shows significant wear`, color: "#ff4444" });
    if (surfaceDings.length >= 2) tips.push({ text: "Surface wear on both sides — characteristic of grade 5 range", color: "#ff4444" });
  }
  
  return tips;
}
