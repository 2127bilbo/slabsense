/**
 * Test Deep Analyze V3 against TAG reference cards
 *
 * Tests the 1000-point scoring system by running the same analysis
 * that deep-analyze-v3.js would do, then comparing results to TAG's actual grades.
 */

import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";
import https from "https";
import http from "http";

const anthropic = new Anthropic();
const MODEL = "claude-sonnet-4-20250514";

// ============================================================================
// PROMPTS (copied from deep-analyze-v3.js)
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

**CRITICAL: CAMERA GLARE WARNING**

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

function buildPass2Prompt(softwareCentering, defectInfo) {
  return `You have software-measured centering data. Use it exactly as provided.

## SOFTWARE-MEASURED CENTERING (USE THESE VALUES)
${softwareCentering ? `
FRONT: ${softwareCentering.front?.lrRatio?.toFixed(1) || '50.0'}/${(100 - (softwareCentering.front?.lrRatio || 50)).toFixed(1)} L/R, ${softwareCentering.front?.tbRatio?.toFixed(1) || '50.0'}/${(100 - (softwareCentering.front?.tbRatio || 50)).toFixed(1)} T/B
BACK: ${softwareCentering.back?.lrRatio?.toFixed(1) || '50.0'}/${(100 - (softwareCentering.back?.lrRatio || 50)).toFixed(1)} L/R, ${softwareCentering.back?.tbRatio?.toFixed(1) || '50.0'}/${(100 - (softwareCentering.back?.tbRatio || 50)).toFixed(1)} T/B
` : 'No software centering provided - estimate from images'}

## INITIAL DEFECT SCAN (from pass 1)
${JSON.stringify(defectInfo, null, 2)}

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
      "notes": "Explanation of grade-limiting factor"
    }
  },
  "summary": {
    "positives": ["Good surface condition", "Corners are clean"],
    "concerns": ["Back centering slightly off"],
    "recommendation": "Submit to TAG or PSA for best result"
  }
}`;
}

// ============================================================================
// Test cards data (from training.json)
// ============================================================================
const TEST_CARDS = [
  // 10 GEM MINT
  {
    grade: "10 GEM MINT",
    cert: "D4014224",
    card_name: "Lillie's Determination",
    card_number: "119/132",
    set_name: "MEGA Base Set",
    score_total: 961,
    centering: {
      front: { pct_lr: { left: 49, right: 51 }, pct_tb: { left: 48.5, right: 51.5 } },
      back: { pct_lr: { left: 46.5, right: 53.5 }, pct_tb: { left: 47.8, right: 52.2 } }
    },
    defects: {
      total_dings: 1,
      dings: [
        { side: "FRONT", type: "EDGE WEAR", location: "TOP" }
      ]
    },
    images: {
      front: "https://d39lwrz0lm7c9r.cloudfront.net/card-images/8240d29f-7b27-4ef5-ace7-ac2de15a3388_FRONT_MAIN.jpg",
      back: "https://d39lwrz0lm7c9r.cloudfront.net/card-images/8240d29f-7b27-4ef5-ace7-ac2de15a3388_BACK_MAIN.jpg"
    }
  },
  // 9 MINT
  {
    grade: "9 MINT",
    cert: "F1555020",
    card_name: "Mega Charizard X ex",
    card_number: "130/094",
    set_name: "Phantasmal Flames",
    score_total: 911,
    centering: {
      front: { pct_lr: { left: 47, right: 53 }, pct_tb: { left: 43.7, right: 56.3 } },
      back: { pct_lr: { left: 48.1, right: 51.9 }, pct_tb: { left: 44.7, right: 55.3 } }
    },
    defects: {
      total_dings: 4,
      dings: [
        { side: "FRONT", type: "EDGE WEAR", location: "TOP" },
        { side: "FRONT", type: "CENTERING", location: "47L/53R 44T/56B" },
        { side: "BACK", type: "EDGE WEAR", location: "TOP" },
        { side: "FRONT", type: "CORNER WEAR", location: "TOPRIGHT" }
      ]
    },
    images: {
      front: "https://d39lwrz0lm7c9r.cloudfront.net/card-images/6ad17f73-f247-404b-9187-120293160f01_FRONT_MAIN.jpg",
      back: "https://d39lwrz0lm7c9r.cloudfront.net/card-images/6ad17f73-f247-404b-9187-120293160f01_BACK_MAIN.jpg"
    }
  },
  // 8 NM MT
  {
    grade: "8 NM MT",
    cert: "Y3688558",
    card_name: "Suicune",
    card_number: "53",
    set_name: "Pokemon 4Ever VHS/DVD",
    score_total: 807,
    centering: {
      front: { pct_lr: { left: 46.9, right: 53.1 }, pct_tb: { left: 48.4, right: 51.6 } },
      back: { pct_lr: { left: 56.8, right: 43.2 }, pct_tb: { left: 55.3, right: 44.7 } }
    },
    defects: {
      total_dings: 3,
      dings: [
        { side: "BACK", type: "CORNER WEAR", location: "BOTTOMRIGHT" },
        { side: "BACK", type: "CORNER WEAR", location: "TOPRIGHT" },
        { side: "BACK", type: "CORNER WEAR", location: "BOTTOMLEFT" }
      ]
    },
    images: {
      front: "https://d39lwrz0lm7c9r.cloudfront.net/card-images/eb0c63cc-4722-4766-bff7-0c5302b5ef00_FRONT_MAIN.jpg",
      back: "https://d39lwrz0lm7c9r.cloudfront.net/card-images/eb0c63cc-4722-4766-bff7-0c5302b5ef00_BACK_MAIN.jpg"
    }
  },
  // 7 NEAR MINT
  {
    grade: "7 NEAR MINT",
    cert: "D6012395",
    card_name: "Victory Cup",
    card_number: "BW30",
    set_name: "Battle Road Spring 2012 Second Place",
    score_total: null, // Not provided in data, estimate ~725 based on grade stats
    centering: {
      front: { pct_lr: { left: 53.4, right: 46.6 }, pct_tb: { left: 46.6, right: 53.4 } },
      back: { pct_lr: { left: 50.7, right: 49.3 }, pct_tb: { left: 50.3, right: 49.7 } }
    },
    defects: {
      total_dings: 5,
      dings: [
        { side: "BACK", type: "SURFACE / PLAY WEAR", location: "" },
        { side: "BACK", type: "CORNER WEAR", location: "TOP LEFT" },
        { side: "BACK", type: "CORNER WEAR", location: "BOTTOM RIGHT" },
        { side: "BACK", type: "CORNER WEAR", location: "TOP RIGHT" },
        { side: "BACK", type: "CORNER WEAR", location: "BOTTOM LEFT" }
      ]
    },
    images: {
      front: "https://d39lwrz0lm7c9r.cloudfront.net/card-images/46f5c829-f693-4d76-961a-58503b3c5789_FRONT_MAIN.jpg",
      back: "https://d39lwrz0lm7c9r.cloudfront.net/card-images/46f5c829-f693-4d76-961a-58503b3c5789_BACK_MAIN.jpg"
    }
  },
  // 6 EX MT
  {
    grade: "6 EX MT",
    cert: "V5182438",
    card_name: "Steelix",
    card_number: "150/132",
    set_name: "MEGA Base Set",
    score_total: null, // Not provided, estimate ~647 based on grade stats
    centering: {
      front: { pct_lr: { left: 46.9, right: 53.1 }, pct_tb: { left: 48.2, right: 51.8 } },
      back: { pct_lr: { left: 49, right: 51 }, pct_tb: { left: 45.3, right: 54.7 } }
    },
    defects: {
      total_dings: 3,
      dings: [
        { side: "FRONT", type: "SURFACE / ROLLER MARK", location: "TOP CENTER" },
        { side: "BACK", type: "SURFACE / INK DEFECT", location: "TOP CENTER" },
        { side: "FRONT", type: "EDGE WEAR", location: "TOP" }
      ]
    },
    images: {
      front: "https://d39lwrz0lm7c9r.cloudfront.net/card-images/0d49b5c2-85ec-46ae-b488-fdb1fc7b7f4b_FRONT_MAIN.jpg",
      back: "https://d39lwrz0lm7c9r.cloudfront.net/card-images/0d49b5c2-85ec-46ae-b488-fdb1fc7b7f4b_BACK_MAIN.jpg"
    }
  }
];

// ============================================================================
// Helper Functions
// ============================================================================

function downloadImage(url) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith("https") ? https : http;
    protocol.get(url, (response) => {
      if (response.statusCode === 301 || response.statusCode === 302) {
        downloadImage(response.headers.location).then(resolve).catch(reject);
        return;
      }
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        const buffer = Buffer.concat(chunks);
        resolve(buffer.toString("base64"));
      });
      response.on("error", reject);
    }).on("error", reject);
  });
}

function scoreToGrade(score) {
  if (score >= 990) return { grade: 10, label: "PRISTINE" };
  if (score >= 950) return { grade: 10, label: "GEM MINT" };
  if (score >= 900) return { grade: 9, label: "MINT" };
  if (score >= 850) return { grade: 8.5, label: "NM-MT+" };
  if (score >= 800) return { grade: 8, label: "NM-MT" };
  if (score >= 750) return { grade: 7.5, label: "NM+" };
  if (score >= 700) return { grade: 7, label: "NM" };
  if (score >= 650) return { grade: 6.5, label: "EX-MT+" };
  if (score >= 600) return { grade: 6, label: "EX-MT" };
  if (score >= 500) return { grade: 5, label: "EX" };
  if (score >= 400) return { grade: 4, label: "VG-EX" };
  if (score >= 300) return { grade: 3, label: "VG" };
  if (score >= 200) return { grade: 2, label: "GOOD" };
  return { grade: 1, label: "POOR" };
}

function parseTagGrade(gradeStr) {
  const match = gradeStr.match(/^(\d+\.?\d*)\s+(.+)$/);
  if (match) {
    return { grade: parseFloat(match[1]), label: match[2] };
  }
  return { grade: 0, label: gradeStr };
}

function compareResults(tagGrade, v3Grade, tagScore, v3Score) {
  const tagParsed = parseTagGrade(tagGrade);
  const gradeDiff = Math.abs(tagParsed.grade - v3Grade);
  const scoreDiff = tagScore ? Math.abs(tagScore - v3Score) : null;

  if (gradeDiff === 0 && (scoreDiff === null || scoreDiff <= 20)) {
    return "EXACT";
  } else if (gradeDiff <= 1 && (scoreDiff === null || scoreDiff <= 50)) {
    return "CLOSE";
  } else {
    return "MISMATCH";
  }
}

// ============================================================================
// Main Analysis Function
// ============================================================================

async function analyzeCard(card) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`Analyzing: ${card.card_name} (Cert: ${card.cert})`);
  console.log(`TAG Grade: ${card.grade}`);
  console.log(`${"=".repeat(60)}`);

  // Download images
  console.log("Downloading images...");
  const [frontBase64, backBase64] = await Promise.all([
    downloadImage(card.images.front),
    downloadImage(card.images.back)
  ]);
  console.log("Images downloaded.");

  // Prepare centering data for Pass 2
  const softwareCentering = {
    front: {
      lrRatio: card.centering.front.pct_lr.left,
      tbRatio: card.centering.front.pct_tb.left
    },
    back: {
      lrRatio: card.centering.back.pct_lr.left,
      tbRatio: card.centering.back.pct_tb.left
    }
  };

  // ========== PASS 1: Quick defect detection ==========
  console.log("Pass 1: Initial defect scan...");

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
            source: { type: "base64", media_type: "image/jpeg", data: frontBase64 },
          },
          {
            type: "image",
            source: { type: "base64", media_type: "image/jpeg", data: backBase64 },
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
    console.error("Pass 1 parse error:", e.message);
    pass1Result = { defects: [], defectSummary: { corners: "unknown", edges: "unknown", surface: "unknown" } };
  }

  console.log(`Pass 1 complete: ${pass1Result.defects?.length || 0} defects found`);

  // ========== PASS 2: Final grading with area scores ==========
  console.log("Pass 2: Final grading...");

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
            source: { type: "base64", media_type: "image/jpeg", data: frontBase64 },
          },
          {
            type: "image",
            source: { type: "base64", media_type: "image/jpeg", data: backBase64 },
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
    console.error("Pass 2 parse error:", e.message);
    return { error: "Failed to parse AI response" };
  }

  // Calculate lowest score from area scores
  const frontCorners = finalResult.areaScores?.front?.corners || {};
  const backCorners = finalResult.areaScores?.back?.corners || {};
  const frontEdges = finalResult.areaScores?.front?.edges || {};
  const backEdges = finalResult.areaScores?.back?.edges || {};

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
  const v3GradeInfo = scoreToGrade(lowestScore);

  return {
    card,
    pass1: pass1Result,
    pass2: finalResult,
    lowestScore,
    v3Grade: v3GradeInfo,
    defectCount: (finalResult.defects || []).length
  };
}

// ============================================================================
// Main Execution
// ============================================================================

async function main() {
  console.log("=".repeat(70));
  console.log("DEEP ANALYZE V3 VALIDATION TEST");
  console.log("Testing 1000-point scoring system against TAG reference cards");
  console.log("=".repeat(70));

  const results = [];

  for (const card of TEST_CARDS) {
    try {
      const result = await analyzeCard(card);
      results.push(result);

      // Print individual card result
      const tagParsed = parseTagGrade(card.grade);
      const tagScore = card.score_total || "N/A";

      console.log(`\n${"─".repeat(60)}`);
      console.log(`Card: ${card.card_name} (Cert: ${card.cert})`);
      console.log(`TAG Grade: ${card.grade} | TAG Score: ${tagScore}`);
      console.log(`TAG Defects: ${card.defects.total_dings} - ${card.defects.dings.map(d => `${d.type}/${d.location}`).join(", ")}`);
      console.log();
      console.log(`V3 Grade: ${result.v3Grade.grade} ${result.v3Grade.label} | V3 Score: ${result.lowestScore}`);
      console.log(`V3 Defects: ${result.defectCount} - ${(result.pass2.defects || []).map(d => `${d.type}/${d.position}`).join(", ")}`);

      const match = compareResults(card.grade, result.v3Grade.grade, card.score_total, result.lowestScore);
      console.log(`\nMatch: ${match}`);
      console.log(`${"─".repeat(60)}`);

      // Small delay to avoid rate limiting
      await new Promise(r => setTimeout(r, 1000));
    } catch (error) {
      console.error(`Error analyzing ${card.card_name}:`, error.message);
      results.push({ card, error: error.message });
    }
  }

  // Print summary
  console.log(`\n${"=".repeat(70)}`);
  console.log("SUMMARY");
  console.log("=".repeat(70));

  let exactMatches = 0;
  let closeMatches = 0;
  let mismatches = 0;

  for (const result of results) {
    if (result.error) {
      mismatches++;
      continue;
    }
    const match = compareResults(result.card.grade, result.v3Grade.grade, result.card.score_total, result.lowestScore);
    if (match === "EXACT") exactMatches++;
    else if (match === "CLOSE") closeMatches++;
    else mismatches++;
  }

  console.log(`- Exact matches: ${exactMatches}/${results.length}`);
  console.log(`- Close matches (+/-1 grade, +/-50 points): ${closeMatches}/${results.length}`);
  console.log(`- Mismatches: ${mismatches}/${results.length}`);
  console.log();

  // Detailed breakdown
  console.log("DETAILED RESULTS:");
  console.log("-".repeat(70));
  for (const result of results) {
    if (result.error) {
      console.log(`${result.card.card_name}: ERROR - ${result.error}`);
      continue;
    }
    const tagParsed = parseTagGrade(result.card.grade);
    const match = compareResults(result.card.grade, result.v3Grade.grade, result.card.score_total, result.lowestScore);
    console.log(`${result.card.card_name}:`);
    console.log(`  TAG: ${result.card.grade} (${result.card.score_total || 'N/A'}) vs V3: ${result.v3Grade.grade} ${result.v3Grade.label} (${result.lowestScore})`);
    console.log(`  TAG Defects: ${result.card.defects.total_dings} vs V3 Defects: ${result.defectCount}`);
    console.log(`  Match: ${match}`);
  }
}

main().catch(console.error);
