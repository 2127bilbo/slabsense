/**
 * Deep AI Grade V2 - Multi-Provider Two-Pass Grading
 *
 * MODIFIED FOR MULTI-AI SUPPORT
 *
 * Pass 1: Quick estimate from images → Returns grade range
 * Pass 2: Compare against real TAG-graded references for final grade
 *
 * Supports multiple providers:
 * - claude (Anthropic) - Default
 * - gemini (Google)
 * - gpt (OpenAI)
 * - grok (xAI)
 *
 * Supports multiple modes:
 * - single: One provider only (default)
 * - parallel: Two providers, combined results
 * - sequential: Provider A → Provider B validates
 * - synthesize: A + B → C synthesizes
 */

import { createClient } from '@supabase/supabase-js';
import {
  callProvider,
  runMultiProvider,
  parseJsonFromResponse,
  PROVIDERS,
  MODES,
} from './_providers/index.js';

// Legacy Anthropic import for backward compatibility
import Anthropic from '@anthropic-ai/sdk';
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// ═══════════════════════════════════════════════════════════════════════════
// MULTI-PROVIDER CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════
const DEFAULT_CONFIG = {
  mode: MODES.SINGLE,
  primary: PROVIDERS.CLAUDE,
  secondary: null,
  synthesizer: null,
};

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

**GRADING PHILOSOPHY: BE STRICT AND ACCURATE.**
Cards range from PRISTINE (10) to POOR (1). Many cards have significant wear.
- If you see whitening on corners → REPORT IT as corner wear
- If whitening is on ALL corners → this is "heavy wear" territory (grade 7 or below)
- Vintage cards (1999-2003) often have natural wear - still report it accurately
- When uncertain between two severity levels, choose the MORE SEVERE option

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
  "estimatedDefectImpact": "minimal/minor/moderate/significant/severe",
  "gradeRange": { "low": 5, "high": 10, "mostLikely": 8 },
  "gradeRangeReasoning": "Brief explanation of grade range based on defects found"
}

GRADE RANGE GUIDELINES:
- Clean card, no visible defects → low: 9, high: 10
- 1-2 minor corner/edge issues → low: 8, high: 9
- Whitening on multiple corners → low: 7, high: 8
- Whitening on ALL corners + edge wear → low: 6, high: 7.5
- Heavy wear throughout → low: 5, high: 6.5
- Creases, bends, or major damage → low: 3, high: 5`;

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
- 8.5 NM-MT+ (875-899 pts) = Light wear visible on 1-2 corners or edges
- 8 NM-MT (850-874 pts) = Noticeable minor wear on multiple areas
- 7.5 NM+ (800-849 pts) = Clear wear on corners AND edges, still presents well
- 7 NM (750-799 pts) = Obvious wear - whitening visible on most corners/edges
- 6.5 EX-MT+ (700-749 pts) = Significant wear - corner whitening, edge wear throughout
- 6 EX-MT (650-699 pts) = Heavy wear - all corners show whitening, multiple edge dings
- 5 EX (500-649 pts) = Major wear - heavy whitening, possible creases, surface issues
- 4 VG-EX (400-499 pts) = Severe wear throughout, still intact
- 3 VG (300-399 pts) = Heavy play wear, creases likely
- 2 GOOD (200-299 pts) = Major damage
- 1 POOR (100-199 pts) = Severe damage

**CRITICAL MATH RULE: The LOWEST subgrade determines the maximum overall grade.**
- If corners = 7 and edges = 8 and surface = 9 → OVERALL CANNOT EXCEED 7
- If ANY area scores below 8, the card CANNOT be a 9 overall
- Always ensure: overall_grade <= min(corners, edges, surface, centering)

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

## YOUR TASK - DEFECT DETECTION WITH COORDINATES

Look at the card images and find ALL defects. For each defect, provide:
- **side**: "FRONT" or "BACK"
- **type**: Category like "CORNER / DING", "EDGE / WHITENING", "SURFACE / SCRATCH"
- **location**: Position like "TOP LEFT", "BOTTOM EDGE", "CENTER"
- **severity**: "minor", "moderate", or "severe"
- **x, y**: Position as PERCENTAGE (0-100) where 0,0 is top-left corner
- **width, height**: Approximate size as percentage of card dimensions

COORDINATE GUIDE (as percentages 0-100):
- TOP LEFT corner: x=5-15, y=5-15
- TOP RIGHT corner: x=85-95, y=5-15
- BOTTOM LEFT corner: x=5-15, y=85-95
- BOTTOM RIGHT corner: x=85-95, y=85-95
- TOP edge: x=20-80, y=2-8
- BOTTOM edge: x=20-80, y=92-98
- LEFT edge: x=2-8, y=20-80
- RIGHT edge: x=92-98, y=20-80
- CENTER area: x=30-70, y=30-70

DEFECT TYPES TO CHECK:

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
      {
        "type": "CORNER / DING",
        "side": "FRONT",
        "location": "TOP LEFT",
        "severity": "minor",
        "x": 8,
        "y": 7,
        "width": 6,
        "height": 5
      }
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
// Helper: Parse JSON from text response
// ============================================================================
function parseJsonFromText(text) {
  if (!text) return null;
  try {
    let jsonText = text.trim();
    if (jsonText.startsWith('```')) {
      jsonText = jsonText.replace(/```json?\n?/g, '').replace(/```$/g, '');
    }
    const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch (e) {
    console.error('[DeepAnalyzeV2] JSON parse error:', e.message);
  }
  return null;
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
    // Image URLs
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
    backCentering,   // { lrRatio, tbRatio } from calculateCenteringFromBounds

    // ═══════════════════════════════════════════════════════════════════════
    // MULTI-PROVIDER OPTIONS (new)
    // ═══════════════════════════════════════════════════════════════════════
    gradeMode = DEFAULT_CONFIG.mode,           // 'single' | 'parallel' | 'sequential' | 'synthesize'
    primaryProvider = DEFAULT_CONFIG.primary,   // 'claude' | 'gemini' | 'gpt' | 'grok'
    secondaryProvider = DEFAULT_CONFIG.secondary,
    synthesizerProvider = DEFAULT_CONFIG.synthesizer,
  } = req.body;

  // Validate provider selection
  const validProviders = Object.values(PROVIDERS);
  if (!validProviders.includes(primaryProvider)) {
    return res.status(400).json({
      error: `Invalid primaryProvider: ${primaryProvider}. Valid: ${validProviders.join(', ')}`
    });
  }

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

  // For single mode with Claude, require ANTHROPIC_API_KEY
  // For other providers, they will check their own keys
  if (gradeMode === 'single' && primaryProvider === 'claude' && !process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
  }

  try {
    console.log('[DeepAnalyzeV2] Starting two-pass analysis...');
    console.log('[DeepAnalyzeV2] Mode:', gradeMode, '| Primary:', primaryProvider, '| Secondary:', secondaryProvider || 'none');
    const startTime = Date.now();

    // ========================================================================
    // PASS 1: Defect Detection (centering handled by software)
    // Uses provider abstraction for multi-AI support
    // ========================================================================
    console.log('[DeepAnalyzeV2] Pass 1: Defect detection...', hasSoftwareCentering ? '(centering pre-measured)' : '(no centering data)');

    // Use provider abstraction for Pass 1
    const pass1Result = await callProvider(primaryProvider, {
      systemPrompt: PASS1_SYSTEM,
      userPrompt: PASS1_PROMPT,
      images: imageUrls,
      maxTokens: 500,
      temperature: 0.1,
    });

    if (!pass1Result.success) {
      console.error('[DeepAnalyzeV2] Pass 1 failed:', pass1Result.error);
      return res.status(500).json({
        error: 'Pass 1 failed: ' + pass1Result.error,
        provider: primaryProvider,
      });
    }

    let quickAssessment = pass1Result.parsed;

    // If parsed is null, try to extract JSON manually
    if (!quickAssessment && pass1Result.text) {
      try {
        let jsonText = pass1Result.text.trim();
        if (jsonText.startsWith('```')) {
          jsonText = jsonText.replace(/```json?\n?/g, '').replace(/```$/g, '');
        }
        const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          quickAssessment = JSON.parse(jsonMatch[0]);
        }
      } catch (e) {
        console.error('[DeepAnalyzeV2] Pass 1 parse error:', pass1Result.text);
        return res.status(500).json({ error: 'Failed to parse quick assessment', raw: pass1Result.text });
      }
    }

    if (!quickAssessment) {
      return res.status(500).json({ error: 'Failed to parse quick assessment', raw: pass1Result.text });
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
    // Supports multiple modes: single, parallel, sequential, synthesize
    // ========================================================================
    console.log('[DeepAnalyzeV2] Pass 2: Final grading...', hasSoftwareCentering ? '(SOFTWARE CENTERING + AI defects)' : '(AI centering + AI defects)');

    // Build software centering object if we have it
    const softwareCentering = hasSoftwareCentering ? {
      front: { lrRatio: frontCentering.lrRatio, tbRatio: frontCentering.tbRatio },
      back: { lrRatio: backCentering.lrRatio, tbRatio: backCentering.tbRatio }
    } : null;

    const pass2Prompt = buildPass2Prompt(quickAssessment, references, softwareCentering);

    // Prepare options for provider abstraction
    const pass2Options = {
      systemPrompt: PASS2_SYSTEM,
      userPrompt: pass2Prompt,
      images: imageUrls,
      maxTokens: 2000,
      temperature: 0.1,
    };

    let finalResult;
    let multiProviderResults = null;

    // ════════════════════════════════════════════════════════════════════════
    // MODE: SINGLE (default) - One provider only
    // ════════════════════════════════════════════════════════════════════════
    if (gradeMode === 'single' || gradeMode === MODES.SINGLE) {
      const pass2Result = await callProvider(primaryProvider, pass2Options);

      if (!pass2Result.success) {
        console.error('[DeepAnalyzeV2] Pass 2 failed:', pass2Result.error);
        return res.status(500).json({
          error: 'Pass 2 failed: ' + pass2Result.error,
          provider: primaryProvider,
        });
      }

      finalResult = pass2Result.parsed;

      // Manual parse if needed
      if (!finalResult && pass2Result.text) {
        try {
          let jsonText = pass2Result.text.trim();
          if (jsonText.startsWith('```')) {
            jsonText = jsonText.replace(/```json?\n?/g, '').replace(/```$/g, '');
          }
          const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            finalResult = JSON.parse(jsonMatch[0]);
          }
        } catch (e) {
          console.error('[DeepAnalyzeV2] Pass 2 parse error:', pass2Result.text);
          return res.status(500).json({ error: 'Failed to parse final assessment', raw: pass2Result.text });
        }
      }
    }

    // ════════════════════════════════════════════════════════════════════════
    // MODE: PARALLEL - Two providers, return both results
    // ════════════════════════════════════════════════════════════════════════
    else if (gradeMode === 'parallel' || gradeMode === MODES.PARALLEL) {
      if (!secondaryProvider) {
        return res.status(400).json({ error: 'Parallel mode requires secondaryProvider' });
      }

      console.log(`[DeepAnalyzeV2] Parallel mode: ${primaryProvider} + ${secondaryProvider}`);

      const [result1, result2] = await Promise.all([
        callProvider(primaryProvider, pass2Options),
        callProvider(secondaryProvider, pass2Options),
      ]);

      multiProviderResults = {
        [primaryProvider]: result1.parsed || parseJsonFromText(result1.text),
        [secondaryProvider]: result2.parsed || parseJsonFromText(result2.text),
      };

      // Use primary result as main, include secondary for comparison
      finalResult = multiProviderResults[primaryProvider] || multiProviderResults[secondaryProvider];
    }

    // ════════════════════════════════════════════════════════════════════════
    // MODE: SEQUENTIAL - First provider grades, second validates
    // ════════════════════════════════════════════════════════════════════════
    else if (gradeMode === 'sequential' || gradeMode === MODES.SEQUENTIAL) {
      if (!secondaryProvider) {
        return res.status(400).json({ error: 'Sequential mode requires secondaryProvider' });
      }

      console.log(`[DeepAnalyzeV2] Sequential mode: ${primaryProvider} → ${secondaryProvider}`);

      // First pass
      const result1 = await callProvider(primaryProvider, pass2Options);
      const parsed1 = result1.parsed || parseJsonFromText(result1.text);

      // Second pass with first result
      const validationPrompt = `${pass2Prompt}

## PREVIOUS AI ASSESSMENT (from ${primaryProvider}):
${JSON.stringify(parsed1, null, 2)}

## YOUR TASK:
1. First, analyze the card images independently
2. Then, compare your findings with the previous assessment
3. If you agree, confirm the grade. If you disagree, explain why and provide your grade.
4. Your final output should follow the same JSON format.`;

      const result2 = await callProvider(secondaryProvider, {
        ...pass2Options,
        userPrompt: validationPrompt,
      });

      multiProviderResults = {
        [primaryProvider]: parsed1,
        [secondaryProvider]: result2.parsed || parseJsonFromText(result2.text),
      };

      // Use secondary (validator) result as final
      finalResult = multiProviderResults[secondaryProvider] || multiProviderResults[primaryProvider];
    }

    // ════════════════════════════════════════════════════════════════════════
    // MODE: SYNTHESIZE - Two providers grade, third synthesizes
    // ════════════════════════════════════════════════════════════════════════
    else if (gradeMode === 'synthesize' || gradeMode === MODES.SYNTHESIZE) {
      if (!secondaryProvider || !synthesizerProvider) {
        return res.status(400).json({ error: 'Synthesize mode requires secondaryProvider and synthesizerProvider' });
      }

      console.log(`[DeepAnalyzeV2] Synthesize mode: ${primaryProvider} + ${secondaryProvider} → ${synthesizerProvider}`);

      // Both grade in parallel
      const [result1, result2] = await Promise.all([
        callProvider(primaryProvider, pass2Options),
        callProvider(secondaryProvider, pass2Options),
      ]);

      const parsed1 = result1.parsed || parseJsonFromText(result1.text);
      const parsed2 = result2.parsed || parseJsonFromText(result2.text);

      // Synthesize (no images, just text)
      const synthesisPrompt = `You are a card grading expert synthesizing two AI assessments.

## ASSESSMENT 1 (${primaryProvider}):
${JSON.stringify(parsed1, null, 2)}

## ASSESSMENT 2 (${secondaryProvider}):
${JSON.stringify(parsed2, null, 2)}

## YOUR TASK:
1. Compare both assessments
2. Identify agreements and disagreements
3. Provide a final synthesized grade that resolves any conflicts
4. Weight the more accurate-seeming assessment higher
5. Return the same JSON format with your final grades and notes explaining any disagreements`;

      const synthesisResult = await callProvider(synthesizerProvider, {
        systemPrompt: PASS2_SYSTEM,
        userPrompt: synthesisPrompt,
        images: [],  // No images for synthesis
        maxTokens: 2000,
        temperature: 0.1,
      });

      multiProviderResults = {
        [primaryProvider]: parsed1,
        [secondaryProvider]: parsed2,
        synthesizer: synthesisResult.parsed || parseJsonFromText(synthesisResult.text),
      };

      finalResult = multiProviderResults.synthesizer || parsed1 || parsed2;
    }

    // Validate we have a final result
    if (!finalResult) {
      return res.status(500).json({ error: 'Failed to get final assessment from any provider' });
    }

    const elapsed = Date.now() - startTime;
    console.log('[DeepAnalyzeV2] Complete in', elapsed, 'ms:', {
      card: finalResult.cardInfo?.name,
      tagGrade: finalResult.grades?.tag?.grade,
      confidence: finalResult.grades?.tag?.confidence,
      mode: gradeMode,
    });

    // ========================================================================
    // Return Response
    // ========================================================================
    return res.status(200).json({
      success: true,
      version: 'v2-multi',
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
      meta: {
        elapsedMs: elapsed,
        imageMode: has4Images ? '4-image' : '2-image',
        centeringSource: hasSoftwareCentering ? 'software' : 'ai-estimated',
        softwareCentering: softwareCentering || null,
        // Multi-provider metadata
        gradeMode: gradeMode,
        primaryProvider: primaryProvider,
        secondaryProvider: secondaryProvider || null,
        synthesizerProvider: synthesizerProvider || null,
      },
      // Include all provider results for parallel/sequential/synthesize modes
      multiProviderResults: multiProviderResults,
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
