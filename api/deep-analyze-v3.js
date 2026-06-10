/**
 * Deep Analyze V3 - Coordinate-Based Defect Detection (TAG 1000-Point System)
 *
 * This version returns defect data with:
 * - Exact coordinates (x, y as percentages)
 * - Per-area scores on TAG's 0-1000 scale
 * - Compatible with visual DingsMap rendering
 * - Full DIG report format matching TAG's output
 *
 * TAG Grade Scale (by total score):
 * - 10 PRISTINE: 990-1000
 * - 10 GEM MINT: 950-989
 * - 9 MINT: 900-949
 * - 8.5 NM-MT+: 850-899
 * - 8 NM-MT: 800-849
 * - 7.5 NM+: 750-799
 * - 7 NM: 700-749
 * - 6.5 EX-MT+: 650-699
 * - 6 EX-MT: 600-649
 * - 5 EX: 500-599
 * - 4 VG-EX: 400-499
 * - 3 VG: 300-399
 * - 2 GOOD: 200-299
 * - 1 POOR: 0-199
 *
 * DO NOT USE IN PRODUCTION - Testing only
 * When ready, rename this to deep-analyze-v2.js
 */

import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic();
const MODEL = "claude-sonnet-4-20250514";

// ============================================================================
// PASS 1: Quick defect detection with image quality assessment
// ============================================================================
const PASS1_SYSTEM = `You are an expert Pokemon card defect detector. Your ONLY job is to find physical defects and assess image quality.
DO NOT assess centering - centering is measured separately by software with pixel-level precision.
Be thorough - look carefully at all four corners, all edges, and the entire surface.`;

const PASS1_PROMPT = `Identify the card and detect all physical defects. DO NOT assess centering.

**FIRST: ASSESS IMAGE QUALITY**
Before looking for defects, evaluate the photo quality:
- Is there camera flash/glare obscuring any areas?
- Can you clearly see all 4 corners on both sides?
- Can you clearly see all 4 edges on both sides?
- Is the image sharp enough to detect minor wear?

**THEN: DEFECT DETECTION**
For each defect found, provide:
- Side: FRONT or BACK
- Type: CORNER WEAR, EDGE WEAR, SURFACE (scratch/print line/play wear/etc)
- Position: For corners (TL/TR/BL/BR), for edges (TOP/BOTTOM/LEFT/RIGHT)
- Coordinates: Approximate X,Y as percentage from top-left (0-100)
- Severity: minor/moderate/severe

**⚠️ CRITICAL: CAMERA GLARE WARNING ⚠️**

Pokemon cards are photographed by users with phone cameras. MOST images have significant glare/flash reflection. You MUST NOT mistake glare for defects.

**THIS IS GLARE - DO NOT REPORT AS DEFECTS:**
- ANY bright white/silver spots or streaks (this is camera flash)
- Bright areas near corners that look "blown out" or overexposed
- Shiny reflections anywhere on holo/foil card surfaces
- Bright spots that have soft/fuzzy edges (real wear has sharp edges)
- Light areas that appear in multiple corners simultaneously (flash pattern)

**THIS IS ACTUAL WEAR - ONLY REPORT THESE:**
- Corner whitening: WHITE FIBERS of the card stock are EXPOSED at the corner TIP
- Edge whitening: WHITE PAPER FIBERS visible along the CUT EDGE of the card
- Real wear looks like exposed cardboard/paper, NOT like bright reflection

Respond with ONLY this JSON (no other text):
{
  "cardName": "Pokemon name and set if visible",
  "imageQuality": {
    "glareLevel": "none/minor/moderate/severe",
    "glareLocations": ["list corners/edges/areas affected by camera flash"],
    "canAccuratelyAssess": true,
    "frontVisible": { "allCorners": true, "allEdges": true, "surface": true },
    "backVisible": { "allCorners": true, "allEdges": true, "surface": true }
  },
  "defects": [
    {
      "side": "FRONT",
      "type": "CORNER WEAR",
      "position": "TL",
      "coordinates": { "x": 5, "y": 5 },
      "severity": "minor",
      "description": "Light whitening at corner tip"
    }
  ],
  "defectSummary": {
    "corners": "clean/minor wear/moderate wear/heavy wear",
    "edges": "clean/minor wear/moderate wear/heavy wear",
    "surface": "clean/minor issues/moderate issues/heavy issues"
  },
  "estimatedDefectImpact": "minimal/minor/moderate/significant",
  "gradeRange": { "low": 8, "high": 9.5 }
}`;

// ============================================================================
// PASS 2: Final Grading with per-area scores (TAG 1000-point format)
// ============================================================================
const PASS2_SYSTEM = `You are an expert Pokemon card grader using TAG's 1000-point grading system. You will receive:
1. CENTERING DATA - Pre-measured with pixel-level precision. USE THESE EXACT VALUES. Do not re-estimate.
2. Card images - For detailed defect detection only
3. Initial defect scan - From pass 1

YOUR JOB:
- Accept the provided centering measurements as ground truth
- Verify and refine the defect detection from pass 1
- Provide per-area scores on TAG's 0-1000 scale (each area starts at 1000)
- Calculate final grade based on: OUR CENTERING + YOUR DEFECT FINDINGS
- The LOWEST area score determines the card's grade

TAG 1000-POINT SCALE (per area):
- 1000: Perfect (no visible defects even under magnification)
- 950-999: Near-perfect (trivial imperfection under magnification)
- 900-949: Excellent (minor flaw barely visible)
- 800-899: Very good (visible minor flaw)
- 700-799: Good (noticeable flaw)
- 600-699: Fair (significant visible flaw)
- 500-599: Below average (multiple or major flaws)
- <500: Poor (heavy damage)

TAG GRADE THRESHOLDS (by total/lowest score):
- 10 PRISTINE: 990-1000
- 10 GEM MINT: 950-989
- 9 MINT: 900-949
- 8.5 NM-MT+: 850-899
- 8 NM-MT: 800-849
- 7.5 NM+: 750-799
- 7 NM: 700-749
- 6.5 EX-MT+: 650-699
- 6 EX-MT: 600-649
- 5 EX: 500-599`;

function buildPass2Prompt(softwareCentering, defectInfo, referenceCards = []) {
  // Build reference card examples text
  let refText = '';
  if (referenceCards.length > 0) {
    refText = 'REFERENCE EXAMPLES (TAG-graded cards for comparison):\n';
    for (const ref of referenceCards.slice(0, 5)) {
      refText += `- Grade ${ref.grade}: ${ref.defect_count} defects, centering ${ref.front_lr}/${ref.back_lr}\n`;
    }
  }

  return `You have software-measured centering data. Use it exactly as provided.

## SOFTWARE-MEASURED CENTERING (USE THESE VALUES)
${softwareCentering ? `
FRONT: ${softwareCentering.front?.lrRatio?.toFixed(1) || '50.0'}/${(100 - (softwareCentering.front?.lrRatio || 50)).toFixed(1)} L/R, ${softwareCentering.front?.tbRatio?.toFixed(1) || '50.0'}/${(100 - (softwareCentering.front?.tbRatio || 50)).toFixed(1)} T/B
BACK: ${softwareCentering.back?.lrRatio?.toFixed(1) || '50.0'}/${(100 - (softwareCentering.back?.lrRatio || 50)).toFixed(1)} L/R, ${softwareCentering.back?.tbRatio?.toFixed(1) || '50.0'}/${(100 - (softwareCentering.back?.tbRatio || 50)).toFixed(1)} T/B
` : 'No software centering provided - estimate from images'}

## INITIAL DEFECT SCAN (from pass 1)
${JSON.stringify(defectInfo, null, 2)}

${refText}

## SCORING INSTRUCTIONS (TAG 1000-POINT SYSTEM)

Score each area on the TAG 0-1000 scale:
- Start at 1000 (perfect)
- Deduct points based on defect severity:
  - Trivial wear (only visible under magnification): -10 to -40
  - Minor wear (barely visible to naked eye): -40 to -100
  - Moderate wear (clearly visible): -100 to -200
  - Severe wear (significant damage): -200 to -400
  - Heavy damage: -400+

For CENTERING scores, use the software measurements:
- Perfect (50/50): 1000
- <2% deviation: 980-999
- 2-5% deviation: 950-979 (still Gem Mint eligible)
- 5-10% deviation: 900-949
- 10-15% deviation: 800-899
- 15-20% deviation: 700-799
- >20% deviation: <700

For CORNERS, score each corner individually (TL, TR, BL, BR):
- Perfect sharp corner: 1000
- Trivial softness: 950-999
- Minor whitening: 900-949
- Moderate wear: 800-899
- Significant wear: <800

For EDGES, score each edge (TOP, BOTTOM, LEFT, RIGHT):
- Perfect clean edge: 1000
- Trivial wear: 950-999
- Minor whitening/chipping: 900-949
- Moderate wear: 800-899
- Significant wear: <800

For SURFACE, score each side:
- Perfect (no scratches/print lines): 1000
- Trivial imperfections: 950-999
- Minor scratches/lines: 900-949
- Moderate issues: 800-899
- Significant damage: <800

## FINAL GRADE CALCULATION
The card's grade is determined by the LOWEST area score:
- Lowest score 990-1000 = 10 PRISTINE
- Lowest score 950-989 = 10 GEM MINT
- Lowest score 900-949 = 9 MINT
- Lowest score 850-899 = 8.5 NM-MT+
- Lowest score 800-849 = 8 NM-MT
- Lowest score 750-799 = 7.5 NM+
- Lowest score 700-749 = 7 NM
- Lowest score 650-699 = 6.5 EX-MT+
- Lowest score 600-649 = 6 EX-MT

## RESPONSE FORMAT

Respond with this JSON (no other text):
{
  "cardInfo": {
    "name": "string",
    "setName": "string",
    "cardNumber": "string"
  },
  "imageQuality": {
    "glareLevel": "none/minor/moderate/severe",
    "glareLocations": ["areas affected"],
    "overallQuality": "excellent/good/fair/poor",
    "warning": "null or message for user"
  },
  "centering": {
    "front": { "leftRight": "50.0/50.0", "topBottom": "50.0/50.0" },
    "back": { "leftRight": "50.0/50.0", "topBottom": "50.0/50.0" }
  },
  "defects": [
    {
      "side": "FRONT",
      "type": "CORNER WEAR",
      "position": "TL",
      "coordinates": { "x": 5, "y": 5 },
      "severity": "minor",
      "pointDeduction": 50,
      "description": "Light whitening at corner tip"
    }
  ],
  "areaScores": {
    "front": {
      "centering": 980,
      "corners": {
        "TL": 1000, "TR": 960, "BL": 1000, "BR": 950
      },
      "edges": {
        "TOP": 975, "BOTTOM": 1000, "LEFT": 960, "RIGHT": 1000
      },
      "surface": 965
    },
    "back": {
      "centering": 940,
      "corners": {
        "TL": 975, "TR": 1000, "BL": 960, "BR": 1000
      },
      "edges": {
        "TOP": 1000, "BOTTOM": 975, "LEFT": 1000, "RIGHT": 960
      },
      "surface": 950
    }
  },
  "grades": {
    "tag": {
      "grade": 9,
      "label": "MINT",
      "score": 940,
      "lowestArea": "back centering",
      "confidence": 0.85,
      "notes": "Explanation of grade-limiting factor",
      "subgrades": {
        "centeringFront": 980,
        "centeringBack": 940,
        "cornersFront": 950,
        "cornersBack": 960,
        "edgesFront": 960,
        "edgesBack": 960,
        "surfaceFront": 965,
        "surfaceBack": 950
      }
    },
    "psa": { "grade": 9, "label": "MINT", "confidence": 0.85, "notes": "Brief explanation" },
    "bgs": { "grade": 9, "label": "MINT", "confidence": 0.80, "subgrades": { "centering": 9, "corners": 9, "edges": 9, "surface": 9.5 }, "notes": "Brief explanation" },
    "cgc": { "grade": 9, "label": "MINT", "confidence": 0.85, "notes": "Brief explanation" },
    "sgc": { "grade": 9, "label": "MINT", "confidence": 0.85, "notes": "Brief explanation" }
  },
  "summary": {
    "positives": ["Good surface condition", "Corners are clean"],
    "concerns": ["Back centering slightly off"],
    "recommendation": "Submit to TAG or PSA for best result"
  }
}`;
}

// ============================================================================
// Main Analysis Function
// ============================================================================
export default async function handler(req, res) {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { frontImage, backImage, softwareCentering, cardType = "pokemon" } = req.body;

  if (!frontImage || !backImage) {
    return res.status(400).json({ error: "Both frontImage and backImage required" });
  }

  try {
    console.log("[Deep V3] Starting coordinate-based analysis...");

    // ========== PASS 1: Quick defect detection ==========
    console.log("[Deep V3] Pass 1: Initial defect scan...");

    const pass1Response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 2000,
      system: PASS1_SYSTEM,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: "image/jpeg", data: frontImage.replace(/^data:image\/\w+;base64,/, "") },
            },
            {
              type: "image",
              source: { type: "base64", media_type: "image/jpeg", data: backImage.replace(/^data:image\/\w+;base64,/, "") },
            },
            { type: "text", text: PASS1_PROMPT },
          ],
        },
      ],
    });

    let pass1Result;
    try {
      const pass1Text = pass1Response.content[0].text;
      const jsonMatch = pass1Text.match(/\{[\s\S]*\}/);
      pass1Result = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
    } catch (e) {
      console.error("[Deep V3] Pass 1 parse error:", e);
      pass1Result = { defects: [], defectSummary: { corners: "unknown", edges: "unknown", surface: "unknown" } };
    }

    console.log("[Deep V3] Pass 1 complete:", pass1Result.defects?.length || 0, "defects found");

    // ========== PASS 2: Final grading with area scores ==========
    console.log("[Deep V3] Pass 2: Final grading with area scores...");

    const pass2Prompt = buildPass2Prompt(softwareCentering, pass1Result);

    const pass2Response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 3000,
      system: PASS2_SYSTEM,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: "image/jpeg", data: frontImage.replace(/^data:image\/\w+;base64,/, "") },
            },
            {
              type: "image",
              source: { type: "base64", media_type: "image/jpeg", data: backImage.replace(/^data:image\/\w+;base64,/, "") },
            },
            { type: "text", text: pass2Prompt },
          ],
        },
      ],
    });

    let finalResult;
    try {
      const pass2Text = pass2Response.content[0].text;
      const jsonMatch = pass2Text.match(/\{[\s\S]*\}/);
      finalResult = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
    } catch (e) {
      console.error("[Deep V3] Pass 2 parse error:", e);
      return res.status(500).json({ error: "Failed to parse AI response" });
    }

    console.log("[Deep V3] Pass 2 complete. Grade:", finalResult.grades?.tag?.grade);

    // ========== Calculate derived values for compatibility ==========
    const frontCorners = finalResult.areaScores?.front?.corners || {};
    const backCorners = finalResult.areaScores?.back?.corners || {};
    const frontEdges = finalResult.areaScores?.front?.edges || {};
    const backEdges = finalResult.areaScores?.back?.edges || {};

    // Find lowest scores for grade calculation
    const allScores = [
      finalResult.areaScores?.front?.centering || 1000,
      finalResult.areaScores?.back?.centering || 1000,
      ...Object.values(frontCorners),
      ...Object.values(backCorners),
      ...Object.values(frontEdges),
      ...Object.values(backEdges),
      finalResult.areaScores?.front?.surface || 1000,
      finalResult.areaScores?.back?.surface || 1000,
    ].filter(s => typeof s === 'number');

    const lowestScore = allScores.length > 0 ? Math.min(...allScores) : 950;

    // Convert 1000-point score to 10-point grade for condition display
    const scoreToGrade = (score) => Math.min(10, Math.max(1, score / 100));

    // ========== Format response ==========
    return res.status(200).json({
      success: true,
      cardInfo: finalResult.cardInfo,
      imageQuality: finalResult.imageQuality,
      centering: finalResult.centering,
      defects: finalResult.defects || [],
      areaScores: finalResult.areaScores,
      grades: finalResult.grades,
      condition: {
        corners: scoreToGrade(Math.min(
          ...Object.values(frontCorners).concat(Object.values(backCorners)).filter(s => typeof s === 'number')
        ) || 950),
        edges: scoreToGrade(Math.min(
          ...Object.values(frontEdges).concat(Object.values(backEdges)).filter(s => typeof s === 'number')
        ) || 950),
        surface: scoreToGrade(Math.min(
          finalResult.areaScores?.front?.surface || 1000,
          finalResult.areaScores?.back?.surface || 1000
        )),
        defects: finalResult.defects || [],
      },
      summary: finalResult.summary,
      confidence: finalResult.grades?.tag?.confidence,
      // TAG DIG Report format data
      digReport: {
        score_total: lowestScore,
        scores: {
          centering_front: finalResult.areaScores?.front?.centering || 1000,
          centering_back: finalResult.areaScores?.back?.centering || 1000,
          corners_front: Math.min(...Object.values(frontCorners).filter(s => typeof s === 'number') || [1000]),
          corners_back: Math.min(...Object.values(backCorners).filter(s => typeof s === 'number') || [1000]),
          edges_front: Math.min(...Object.values(frontEdges).filter(s => typeof s === 'number') || [1000]),
          edges_back: Math.min(...Object.values(backEdges).filter(s => typeof s === 'number') || [1000]),
          surface_front: finalResult.areaScores?.front?.surface || 1000,
          surface_back: finalResult.areaScores?.back?.surface || 1000,
        },
        lowestArea: finalResult.grades?.tag?.lowestArea || 'unknown',
        defects: {
          total_dings: (finalResult.defects || []).length,
          corners: {
            front: (finalResult.defects || []).filter(d => d.side === 'FRONT' && d.type?.includes('CORNER')).length,
            back: (finalResult.defects || []).filter(d => d.side === 'BACK' && d.type?.includes('CORNER')).length,
          },
          edges: {
            front: (finalResult.defects || []).filter(d => d.side === 'FRONT' && d.type?.includes('EDGE')).length,
            back: (finalResult.defects || []).filter(d => d.side === 'BACK' && d.type?.includes('EDGE')).length,
          },
          surface: {
            front: (finalResult.defects || []).filter(d => d.side === 'FRONT' && d.type?.includes('SURFACE')).length,
            back: (finalResult.defects || []).filter(d => d.side === 'BACK' && d.type?.includes('SURFACE')).length,
          },
          dings: (finalResult.defects || []).map((d, i) => ({
            ordering: i + 1,
            side: d.side,
            type: d.type,
            location: d.position,
            x: d.coordinates?.x || 50,
            y: d.coordinates?.y || 50,
            severity: d.severity,
            pointDeduction: d.pointDeduction || 50,
          })),
        },
      },
      // V3-specific data for enhanced DingsMap (now on 1000-point scale)
      v3Data: {
        pass1: pass1Result,
        areaScores: finalResult.areaScores,
        defectsWithCoordinates: finalResult.defects,
        scale: 1000, // Indicates this uses 1000-point scale
      },
    });

  } catch (error) {
    console.error("[Deep V3] Error:", error);
    return res.status(500).json({
      error: "Analysis failed",
      message: error.message,
    });
  }
}
