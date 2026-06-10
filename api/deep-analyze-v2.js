/**
 * Deep AI Grade V2 - Two-Pass Grading with Reference Comparison
 *
 * Pass 1: Quick estimate from images → Returns grade range
 * Pass 2: Compare against real TAG-graded references for final grade
 *
 * This mimics how human graders work - comparing against known examples.
 */

import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY
);

// ============================================================================
// PASS 1: Defect Detection (centering is measured by software, not AI)
// ============================================================================
const PASS1_SYSTEM = `You are an expert Pokemon card defect detector. Your ONLY job is to find physical defects.
DO NOT assess centering - centering is measured separately by software with pixel-level precision.
Be thorough - look carefully at all four corners, all edges, and the entire surface.`;

const PASS1_PROMPT = `Identify the card and detect all physical defects. DO NOT assess centering.

DEFECT DETECTION ONLY:
1. CORNERS - Check all 4 corners on front AND back for: whitening, dings, bends, wear, rounding
2. EDGES - Check all 4 edges on front AND back for: whitening, chips, nicks, peeling, damage
3. SURFACE - Check entire surface front AND back for: scratches, print lines, silvering, indentations, holo scratches

**⚠️ CRITICAL WARNING: CAMERA GLARE ON POKEMON CARDS ⚠️**

Pokemon cards are photographed by users with phone cameras. MOST images have significant glare/flash reflection. You MUST NOT mistake glare for defects.

**THIS IS GLARE - DO NOT REPORT AS DEFECTS:**
- ANY bright white/silver spots or streaks (this is camera flash)
- Bright areas near corners that look "blown out" or overexposed
- Shiny reflections anywhere on holo/foil card surfaces
- Bright spots that have soft/fuzzy edges (real wear has sharp edges)
- Light areas that appear in multiple corners simultaneously (flash pattern)
- Any brightness on the card face that isn't at the precise paper edge
- Rainbow or colorful reflections on holographic cards

**THIS IS ACTUAL WEAR - ONLY REPORT THESE:**
- Corner whitening: WHITE FIBERS of the card stock are EXPOSED at the corner TIP
- Edge whitening: WHITE PAPER FIBERS visible along the CUT EDGE of the card
- Real wear looks like exposed cardboard/paper, NOT like bright reflection
- The damaged area must show actual paper texture, not smooth reflection

**HOLO/FOIL CARDS ESPECIALLY:**
Full art cards, EX cards, GX cards, V cards, VMAX, and any holographic cards will have INTENSE reflections. These reflections are NOT defects. A holo card showing rainbow reflections or bright spots is NORMAL.

**DECISION RULE:**
Ask yourself: "Can I see actual exposed paper fibers, or is this just light reflecting off the card surface?"
- If you cannot clearly see damaged paper fibers → IT IS GLARE → DO NOT REPORT
- If you see actual white cardboard exposed → REPORT as wear

**DEFAULT ASSUMPTION: The card is in excellent condition unless you see OBVIOUS physical damage.**
Most cards submitted for grading are near-mint. When uncertain, report "clean" for that category.

Respond with ONLY this JSON (no other text):
{
  "cardName": "Pokemon name and set if visible",
  "imageQuality": {
    "glareLevel": "none/minor/moderate/severe",
    "glareLocations": ["list corners/edges/areas affected by camera flash"],
    "canAccuratelyAssess": true
  },
  "defectAssessment": {
    "corners": "clean/minor wear/moderate wear/heavy wear",
    "cornerDetails": "describe any corner issues found (NOT glare)",
    "edges": "clean/minor wear/moderate wear/heavy wear",
    "edgeDetails": "describe any edge issues found (NOT glare)",
    "surface": "clean/minor issues/moderate issues/heavy issues",
    "surfaceDetails": "describe any surface issues found (NOT glare)"
  },
  "estimatedDefectImpact": "minimal/minor/moderate/significant",
  "gradeRange": { "low": 8, "high": 9.5 }
}`;

// ============================================================================
// PASS 2: Final Grading (uses our centering + AI defect detection)
// ============================================================================
const PASS2_SYSTEM = `You are an expert Pokemon card grader. You will receive:
1. CENTERING DATA - Pre-measured with pixel-level precision. USE THESE EXACT VALUES. Do not re-estimate.
2. Card images - For detailed defect detection only
3. Reference cards - TAG-graded examples to compare defect levels

YOUR JOB:
- Accept the provided centering measurements as ground truth
- Detect and count all defects (corners, edges, surface)
- Compare defect severity to the reference cards
- Calculate final grade based on: OUR CENTERING + YOUR DEFECT FINDINGS

TAG GRADE HIERARCHY (highest to lowest):
- 10 PRISTINE (985-1000 pts) = PERFECT. Zero defects, perfect centering (<2% deviation)
- 10 GEM MINT (950-984 pts) = Near perfect. May have 1-2 trivial flaws invisible to naked eye
- 9.5 GEM MINT (925-949 pts) = Excellent. Minor flaws only visible under magnification
- 9 MINT (900-924 pts) = Great condition. Small flaws may be visible
- 8.5 NM-MT+ (875-899 pts) = Light wear visible
- 8 NM-MT (850-874 pts) = Noticeable minor wear

IMPORTANT: PRISTINE is HIGHER than GEM MINT. Only award PRISTINE for truly flawless cards.
If ANY defects exist (even minor surface issues), the card is NOT PRISTINE.

GRADING PHILOSOPHY: TAG is STRICT. When uncertain, choose the LOWER grade.`;

const buildPass2Prompt = (quickAssessment, references, softwareCentering = null) => {
  // Format reference cards for comparison
  const refText = references.map((ref, i) => {
    const defectList = ref.defect_details?.map(d => `${d.type} (${d.location})`).join(', ') || 'None noted';
    return `
REFERENCE ${i + 1}: ${ref.grade} (Score: ${ref.score || 'N/A'})
Card: ${ref.card_name} | Type: ${ref.card_type}
Centering: Front ${ref.centering_front_lr?.toFixed(1) || '?'}% LR / ${ref.centering_front_tb?.toFixed(1) || '?'}% TB, Back ${ref.centering_back_lr?.toFixed(1) || '?'}% LR / ${ref.centering_back_tb?.toFixed(1) || '?'}% TB
Defects: ${ref.defect_count} total (${ref.corner_defects} corner, ${ref.edge_defects} edge, ${ref.surface_defects} surface)
Details: ${defectList}`;
  }).join('\n');

  // Build the centering section based on whether we have software measurements
  let centeringBlock;
  if (softwareCentering) {
    const { front, back } = softwareCentering;
    const fDevLR = Math.abs(50 - front.lrRatio);
    const fDevTB = Math.abs(50 - front.tbRatio);
    const bDevLR = Math.abs(50 - back.lrRatio);
    const bDevTB = Math.abs(50 - back.tbRatio);
    const maxDev = Math.max(fDevLR, fDevTB, bDevLR, bDevTB);

    centeringBlock = `
═══════════════════════════════════════════════════════════════════════════════
                    CENTERING DATA (MEASURED - USE THESE EXACT VALUES)
═══════════════════════════════════════════════════════════════════════════════
FRONT: ${front.lrRatio.toFixed(1)}/${(100 - front.lrRatio).toFixed(1)} Left/Right | ${front.tbRatio.toFixed(1)}/${(100 - front.tbRatio).toFixed(1)} Top/Bottom
       Deviation: ${fDevLR.toFixed(1)}% LR, ${fDevTB.toFixed(1)}% TB

BACK:  ${back.lrRatio.toFixed(1)}/${(100 - back.lrRatio).toFixed(1)} Left/Right | ${back.tbRatio.toFixed(1)}/${(100 - back.tbRatio).toFixed(1)} Top/Bottom
       Deviation: ${bDevLR.toFixed(1)}% LR, ${bDevTB.toFixed(1)}% TB

MAX DEVIATION: ${maxDev.toFixed(1)}%
═══════════════════════════════════════════════════════════════════════════════
⚠️  THESE ARE PIXEL-MEASURED VALUES. DO NOT RE-ESTIMATE CENTERING.
    Use these numbers directly when calculating the grade.
═══════════════════════════════════════════════════════════════════════════════`;
  } else {
    centeringBlock = `
═══════════════════════════════════════════════════════════════════════════════
                    CENTERING (NO SOFTWARE DATA - MUST ESTIMATE)
═══════════════════════════════════════════════════════════════════════════════
Software centering not available. You must visually estimate by comparing borders.
═══════════════════════════════════════════════════════════════════════════════`;
  }

  // Get defect info from Pass 1
  const defectInfo = quickAssessment.defectAssessment || quickAssessment.quickAssessment || {};

  return `## CARD: ${quickAssessment.cardName}
${centeringBlock}

## YOUR TASK - DEFECT DETECTION ONLY

Look at the card images and find ALL defects:

1. CORNERS (all 4, front and back):
   - Whitening, dings, bends, rounding, wear

2. EDGES (all 4, front and back):
   - Whitening, chips, nicks, peeling

3. SURFACE (entire card, front and back):
   - Scratches, print lines, silvering, indentations, holo damage

## INITIAL DEFECT SCAN NOTES
- Corners: ${defectInfo.corners || 'unknown'} ${defectInfo.cornerDetails ? `(${defectInfo.cornerDetails})` : ''}
- Edges: ${defectInfo.edges || 'unknown'} ${defectInfo.edgeDetails ? `(${defectInfo.edgeDetails})` : ''}
- Surface: ${defectInfo.surface || 'unknown'} ${defectInfo.surfaceDetails ? `(${defectInfo.surfaceDetails})` : ''}

## REFERENCE CARDS (Compare your defect findings to these)
${refText}

## FINAL GRADING INSTRUCTIONS

1. ${softwareCentering ? 'CENTERING IS ALREADY MEASURED (see above). Use those exact values.' : 'Estimate centering from the images.'}
2. Count and describe every defect you find
3. Compare your defect findings to the reference cards
4. Calculate final grade using: ${softwareCentering ? 'PROVIDED CENTERING' : 'ESTIMATED CENTERING'} + YOUR DEFECT FINDINGS
5. **ASSESS IMAGE QUALITY** - Rate glare/flash level and adjust confidence accordingly

**CONFIDENCE SCORING (CRITICAL):**
- 0.90+: Clean photos, no glare issues, high certainty
- 0.75-0.89: Minor glare but can still assess accurately
- 0.60-0.74: Moderate glare obscuring some areas
- 0.40-0.59: Significant glare, low certainty
- <0.40: Severe glare, cannot reliably grade

If you see flash/glare, LOWER your confidence and note it in imageQuality.warning!

Respond with this JSON (no other text):
{
  "cardInfo": {
    "name": "string",
    "setName": "string",
    "cardNumber": "string"
  },
  "imageQuality": {
    "glareLevel": "none/minor/moderate/severe",
    "glareLocations": ["list areas affected by glare"],
    "overallQuality": "excellent/good/fair/poor",
    "warning": "null or message like 'Heavy flash on corners - retake photo for accurate grade'"
  },
  "centering": {
    "front": { "leftRight": "52.0/48.0", "topBottom": "50.0/50.0", "deviationLR": 4.0, "deviationTB": 0.0 },
    "back": { "leftRight": "54.0/46.0", "topBottom": "51.0/49.0", "deviationLR": 8.0, "deviationTB": 2.0 }
  },
  "defects": {
    "count": 3,
    "corners": 1,
    "edges": 1,
    "surface": 1,
    "details": [
      { "type": "corner wear", "location": "top-left front", "severity": "minor" }
    ]
  },
  "comparison": {
    "closestMatch": "Reference 2 (9 MINT)",
    "reasoning": "Centering matches Reference 2, defect count is similar..."
  },
  "grades": {
    "tag": {
      "grade": 9,
      "label": "MINT",
      "score": 915,
      "confidence": 0.85,
      "notes": "Brief explanation of grade",
      "subgrades": {
        "frontCentering": 120,
        "backCentering": 115,
        "frontCorners": 118,
        "backCorners": 118,
        "frontEdges": 115,
        "backEdges": 115,
        "frontSurface": 122,
        "backSurface": 120
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
};

// ============================================================================
// Helper: Query Reference Cards from Supabase
// ============================================================================
async function getReferences(estimatedGrade, cardType = 'modern_holo') {
  // Grade bands for querying
  const gradeBands = {
    10: [10],
    9.5: [10, 9],
    9: [10, 9, 8.5],
    8.5: [9, 8.5, 8],
    8: [9, 8.5, 8, 7.5],
    7.5: [8.5, 8, 7.5, 7],
    7: [8, 7.5, 7, 6.5],
    6.5: [7.5, 7, 6.5, 6],
    6: [7, 6.5, 6, 5],
    5: [6, 5, 4],
    4: [5, 4, 3],
    3: [4, 3, 2],
    2: [3, 2, 1],
    1: [2, 1]
  };

  const targetGrades = gradeBands[Math.round(estimatedGrade)] || gradeBands[8];

  // Always include a 10 as ceiling anchor
  if (!targetGrades.includes(10)) {
    targetGrades.unshift(10);
  }

  const references = [];

  // Query 2 cards from each target grade, preferring same card type
  for (const grade of targetGrades) {
    const { data } = await supabase
      .from('graded_references')
      .select('*')
      .eq('grade_numeric', grade)
      .order('defect_count', { ascending: true })
      .limit(3);

    if (data && data.length > 0) {
      // Prefer same card type, but take any if not available
      const sameType = data.filter(d => d.card_type === cardType);
      const toAdd = sameType.length > 0 ? sameType.slice(0, 2) : data.slice(0, 2);
      references.push(...toAdd);
    }

    // Stop at 7 references
    if (references.length >= 7) break;
  }

  return references.slice(0, 7);
}

// ============================================================================
// Main Handler
// ============================================================================
export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const {
    frontOriginalUrl,
    backOriginalUrl,
    frontCroppedUrl,
    backCroppedUrl,
    frontUrl,
    backUrl,
    cardGame = 'pokemon',
    cardType = 'modern_holo',
    // Software-calculated centering (optional - if provided, skips AI centering estimation)
    frontCentering,  // { lrRatio, tbRatio } from calculateCenteringFromBounds
    backCentering    // { lrRatio, tbRatio } from calculateCenteringFromBounds
  } = req.body;

  // Check if we have pre-calculated centering
  const hasSoftwareCentering = frontCentering?.lrRatio != null && backCentering?.lrRatio != null;

  // Support both 4-image and 2-image modes
  const has4Images = frontOriginalUrl && backOriginalUrl && frontCroppedUrl && backCroppedUrl;
  const hasLegacy = frontUrl && backUrl;

  if (!has4Images && !hasLegacy) {
    return res.status(400).json({
      error: 'Missing image URLs'
    });
  }

  const imageUrls = has4Images
    ? [frontOriginalUrl, backOriginalUrl, frontCroppedUrl, backCroppedUrl]
    : [frontUrl, backUrl];

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
  }

  try {
    console.log('[DeepAnalyzeV2] Starting two-pass analysis...');
    const startTime = Date.now();

    // ========================================================================
    // PASS 1: Defect Detection (centering handled by software)
    // ========================================================================
    console.log('[DeepAnalyzeV2] Pass 1: Defect detection...', hasSoftwareCentering ? '(centering pre-measured)' : '(no centering data)');

    const imageContent = imageUrls.map(url => ({
      type: 'image',
      source: { type: 'url', url },
    }));

    const pass1Response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 500,
      system: PASS1_SYSTEM,
      messages: [{
        role: 'user',
        content: [...imageContent, { type: 'text', text: PASS1_PROMPT }],
      }],
    });

    const pass1Text = pass1Response.content.find(c => c.type === 'text')?.text || '';
    let quickAssessment;

    try {
      // Clean JSON from response
      let jsonText = pass1Text.trim();
      if (jsonText.startsWith('```')) {
        jsonText = jsonText.replace(/```json?\n?/g, '').replace(/```$/g, '');
      }
      quickAssessment = JSON.parse(jsonText.trim());
    } catch (e) {
      console.error('[DeepAnalyzeV2] Pass 1 parse error:', pass1Text);
      return res.status(500).json({ error: 'Failed to parse quick assessment', raw: pass1Text });
    }

    // Calculate estimated grade from range midpoint for reference query
    const gradeRangeMid = quickAssessment.gradeRange
      ? (quickAssessment.gradeRange.low + quickAssessment.gradeRange.high) / 2
      : 8.5;

    console.log('[DeepAnalyzeV2] Pass 1 result:', {
      card: quickAssessment.cardName,
      defectImpact: quickAssessment.estimatedDefectImpact,
      range: quickAssessment.gradeRange,
      estimatedMidpoint: gradeRangeMid
    });

    // ========================================================================
    // QUERY REFERENCES from Supabase
    // ========================================================================
    console.log('[DeepAnalyzeV2] Querying references for grade ~', gradeRangeMid);

    const references = await getReferences(gradeRangeMid, cardType);

    console.log('[DeepAnalyzeV2] Found', references.length, 'reference cards:',
      references.map(r => r.grade).join(', '));

    // ========================================================================
    // PASS 2: Final Grade (our centering + AI defect detection)
    // ========================================================================
    console.log('[DeepAnalyzeV2] Pass 2: Final grading...', hasSoftwareCentering ? '(SOFTWARE CENTERING + AI defects)' : '(AI centering + AI defects)');

    // Build software centering object if we have it
    const softwareCentering = hasSoftwareCentering ? {
      front: { lrRatio: frontCentering.lrRatio, tbRatio: frontCentering.tbRatio },
      back: { lrRatio: backCentering.lrRatio, tbRatio: backCentering.tbRatio }
    } : null;

    const pass2Prompt = buildPass2Prompt(quickAssessment, references, softwareCentering);

    const pass2Response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      system: PASS2_SYSTEM,
      messages: [{
        role: 'user',
        content: [...imageContent, { type: 'text', text: pass2Prompt }],
      }],
    });

    const pass2Text = pass2Response.content.find(c => c.type === 'text')?.text || '';
    let finalResult;

    try {
      let jsonText = pass2Text.trim();
      if (jsonText.startsWith('```')) {
        jsonText = jsonText.replace(/```json?\n?/g, '').replace(/```$/g, '');
      }
      finalResult = JSON.parse(jsonText.trim());
    } catch (e) {
      console.error('[DeepAnalyzeV2] Pass 2 parse error:', pass2Text);
      return res.status(500).json({ error: 'Failed to parse final assessment', raw: pass2Text });
    }

    const elapsed = Date.now() - startTime;
    console.log('[DeepAnalyzeV2] Complete in', elapsed, 'ms:', {
      card: finalResult.cardInfo?.name,
      tagGrade: finalResult.grades?.tag?.grade,
      confidence: finalResult.grades?.tag?.confidence
    });

    // ========================================================================
    // Convert 125-scale subgrades to 1000-point scale for TAG DIG format
    // ========================================================================
    const subgrades = finalResult.grades?.tag?.subgrades || {};
    const to1000 = (val) => Math.round((val || 120) * 8); // 125 scale -> 1000 scale

    const areaScores = {
      front: {
        centering: to1000(subgrades.frontCentering),
        corners: { score: to1000(subgrades.frontCorners) },
        edges: { score: to1000(subgrades.frontEdges) },
        surface: to1000(subgrades.frontSurface),
      },
      back: {
        centering: to1000(subgrades.backCentering),
        corners: { score: to1000(subgrades.backCorners) },
        edges: { score: to1000(subgrades.backEdges) },
        surface: to1000(subgrades.backSurface),
      },
    };

    // Find lowest score (determines grade in TAG system)
    const allScores = [
      areaScores.front.centering, areaScores.back.centering,
      areaScores.front.corners.score, areaScores.back.corners.score,
      areaScores.front.edges.score, areaScores.back.edges.score,
      areaScores.front.surface, areaScores.back.surface,
    ];
    const lowestScore = Math.min(...allScores);

    // Build DIG report format
    const digReport = {
      score_total: lowestScore,
      scores: {
        centering_front: areaScores.front.centering,
        centering_back: areaScores.back.centering,
        corners_front: areaScores.front.corners.score,
        corners_back: areaScores.back.corners.score,
        edges_front: areaScores.front.edges.score,
        edges_back: areaScores.back.edges.score,
        surface_front: areaScores.front.surface,
        surface_back: areaScores.back.surface,
      },
      defects: finalResult.defects,
    };

    // ========================================================================
    // Return Response
    // ========================================================================
    return res.status(200).json({
      success: true,
      version: 'v2',
      passes: {
        quickEstimate: quickAssessment,
        referencesUsed: references.length,
        referenceGrades: references.map(r => r.grade)
      },
      cardInfo: finalResult.cardInfo,
      centering: finalResult.centering,
      defects: finalResult.defects,
      comparison: finalResult.comparison,
      grades: finalResult.grades,
      summary: finalResult.summary,
      // NEW: 1000-point scale data for DingsTabV2 / DeepAiDingsMap
      areaScores,
      digReport,
      condition: {
        corners: (areaScores.front.corners.score + areaScores.back.corners.score) / 200,
        edges: (areaScores.front.edges.score + areaScores.back.edges.score) / 200,
        surface: (areaScores.front.surface + areaScores.back.surface) / 200,
        defects: finalResult.defects?.details || [],
      },
      meta: {
        elapsedMs: elapsed,
        imageMode: has4Images ? '4-image' : '2-image',
        centeringSource: hasSoftwareCentering ? 'software' : 'ai-estimated',
        softwareCentering: softwareCentering || null,
        scale: 1000,
      }
    });

  } catch (error) {
    console.error('[DeepAnalyzeV2] Error:', error);

    if (error.status === 401) {
      return res.status(500).json({ error: 'Invalid Anthropic API key' });
    }
    if (error.status === 429) {
      return res.status(429).json({ error: 'Rate limited - please try again' });
    }
    if (error.message?.includes('Could not download image')) {
      return res.status(400).json({ error: 'Could not access image URLs' });
    }

    return res.status(500).json({
      error: 'Analysis failed',
      details: error.message,
    });
  }
}
