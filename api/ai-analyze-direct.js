/**
 * Claude AI Card Grading Analysis - Direct Anthropic API
 *
 * Same grading logic as ai-analyze.js but uses Anthropic SDK directly
 * instead of Replicate. Requires uploading images to get URLs first.
 *
 * Returns grades for ALL major grading companies:
 * - PSA, BGS, SGC, CGC, TAG
 */

import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

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
    frontUrl,
    backUrl,
    cardType = 'pokemon',
    // Optional software-calculated centering (more accurate than AI estimation)
    frontCentering,  // { lrRatio, tbRatio }
    backCentering    // { lrRatio, tbRatio }
  } = req.body;

  // Check if we have pre-calculated centering
  const hasSoftwareCentering = frontCentering?.lrRatio != null && backCentering?.lrRatio != null;

  if (!frontUrl) {
    return res.status(400).json({ error: 'Missing frontUrl' });
  }

  // Validate URLs
  try {
    new URL(frontUrl);
    if (backUrl) new URL(backUrl);
  } catch {
    return res.status(400).json({ error: 'Invalid image URLs provided' });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
  }

  try {
    const isStitched = !!backUrl;

    // Build centering data for prompt if available
    const centeringData = hasSoftwareCentering ? { front: frontCentering, back: backCentering } : null;

    const prompt = isStitched
      ? buildStitchedGradingPrompt(cardType, centeringData)
      : buildSingleGradingPrompt(cardType, centeringData);

    console.log('[AI-Direct] Starting analysis:', {
      front: frontUrl.substring(0, 50) + '...',
      back: backUrl ? backUrl.substring(0, 50) + '...' : 'none',
      isStitched,
      hasSoftwareCentering,
    });

    // Build message content with images
    const content = [];

    // Add front image
    content.push({
      type: 'image',
      source: {
        type: 'url',
        url: frontUrl,
      },
    });

    // Add back image if provided
    if (backUrl) {
      content.push({
        type: 'image',
        source: {
          type: 'url',
          url: backUrl,
        },
      });
    }

    // Add prompt
    content.push({
      type: 'text',
      text: prompt,
    });

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 6000,
      messages: [{
        role: 'user',
        content,
      }],
    });

    // Extract text response
    const textContent = response.content.find(c => c.type === 'text');
    if (!textContent) {
      throw new Error('No text response from Claude');
    }

    // Parse JSON response
    const text = textContent.text;
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error('[AI-Direct] No JSON found:', text.substring(0, 500));
      return res.status(500).json({
        error: 'No JSON in response',
        response: text.substring(0, 1000),
      });
    }

    let analysis;
    try {
      analysis = JSON.parse(jsonMatch[0]);
    } catch (parseError) {
      console.error('[AI-Direct] Parse error:', parseError.message);
      return res.status(500).json({
        error: 'Failed to parse JSON',
        parseError: parseError.message,
        json: jsonMatch[0].substring(0, 500),
      });
    }

    console.log('[AI-Direct] Analysis complete:', {
      card: analysis.cardInfo?.name,
      psa: analysis.grades?.psa?.grade,
    });

    return res.status(200).json({
      success: true,
      analysis,
      model: 'claude-sonnet-4-20250514',
    });

  } catch (error) {
    console.error('[AI-Direct] Error:', error);

    // Handle specific Anthropic errors
    if (error.status === 401) {
      return res.status(500).json({ error: 'Invalid Anthropic API key' });
    }
    if (error.status === 429) {
      return res.status(429).json({ error: 'Rate limited - please try again in a moment' });
    }
    if (error.message?.includes('Could not download image')) {
      return res.status(400).json({ error: 'Claude could not access the image URLs. Ensure images are publicly accessible.' });
    }

    return res.status(500).json({
      error: 'Analysis failed',
      message: error.message,
    });
  }
}

/**
 * Comprehensive grading prompt for BOTH front and back images
 * Now supports pre-measured centering data for higher accuracy
 */
function buildStitchedGradingPrompt(cardType, centeringData = null) {
  // Build centering section based on whether we have software measurements
  let centeringSection;
  if (centeringData) {
    const { front, back } = centeringData;
    const fDevLR = Math.abs(50 - front.lrRatio).toFixed(1);
    const fDevTB = Math.abs(50 - front.tbRatio).toFixed(1);
    const bDevLR = Math.abs(50 - back.lrRatio).toFixed(1);
    const bDevTB = Math.abs(50 - back.tbRatio).toFixed(1);

    centeringSection = `## CENTERING DATA (PRE-MEASURED - USE THESE EXACT VALUES)

═══════════════════════════════════════════════════════════════════════════════
FRONT: ${front.lrRatio.toFixed(1)}/${(100 - front.lrRatio).toFixed(1)} L/R (${fDevLR}% dev) | ${front.tbRatio.toFixed(1)}/${(100 - front.tbRatio).toFixed(1)} T/B (${fDevTB}% dev)
BACK:  ${back.lrRatio.toFixed(1)}/${(100 - back.lrRatio).toFixed(1)} L/R (${bDevLR}% dev) | ${back.tbRatio.toFixed(1)}/${(100 - back.tbRatio).toFixed(1)} T/B (${bDevTB}% dev)
═══════════════════════════════════════════════════════════════════════════════

⚠️ THESE ARE PIXEL-MEASURED VALUES. Use them directly - do NOT re-estimate centering.
Your job is DEFECT DETECTION only. The centering is already measured accurately.`;
  } else {
    centeringSection = `## TASK 1: MEASURE CENTERING (CRITICAL - assume cards are OFF-CENTER)

**IMPORTANT: Most cards are NOT centered. Assume off-center until proven otherwise.**

**Step-by-step (you MUST follow this):**

For each side (Front L/R, Front T/B, Back L/R, Back T/B):
1. Look at both borders carefully
2. Ask: "Which border is visibly WIDER?"
3. Estimate HOW MUCH wider (15-20% wider = ~45/55, 25-30% wider = ~43/57)
4. Do NOT round toward 50/50 - be aggressive

**Rules:**
- If borders look "about equal," look HARDER - one is almost always wider
- "46.0/54.0" means LEFT is 46% (card shifted LEFT, right border wider)
- "56.0/44.0" means LEFT is 56% (card shifted RIGHT, left border wider)

ALWAYS use one decimal. BE AGGRESSIVE - graders are critical, you should be too.`;
  }

  return `You are an expert Pokemon trading card grader with years of experience at professional grading companies (PSA, BGS, CGC, TAG).

## GRADING PHILOSOPHY
TAG uses a 1000-point system that is MORE STRICT than PSA or BGS. When uncertain between two grades, choose the LOWER grade. Your estimates should lean CONSERVATIVE.

## TAG GRADE HIERARCHY (highest to lowest):
- 10 PRISTINE (985-1000) = PERFECT. Zero defects, perfect centering (<2% deviation)
- 10 GEM MINT (950-984) = Near perfect. May have 1-2 trivial flaws invisible to naked eye
- 9.5 GEM MINT (925-949) = Excellent. Minor flaws only visible under magnification
- 9 MINT (900-924) = Great condition. Small flaws may be visible
- 8.5 NM-MT+ (875-899) = Light wear visible
- 8 NM-MT (850-874) = Noticeable minor wear

**IMPORTANT: PRISTINE is HIGHER than GEM MINT. Only award PRISTINE for truly flawless cards.**

## TAG GRADE THRESHOLDS (from 509 real graded cards):
- 10 PRISTINE: Front <2%, Back <4%, max 3 SURFACE defects only, 0 corner/edge wear
- 10 GEM MINT: Front <4.5%, Back <6.5%, max 3 defects (1 corner, 1 edge, 2 surface)
- 9 MINT: Front <10%, Back <9%, max 4 defects
- 8.5 NM-MT+: Front <12%, Back <11%, max 6 defects
- 8 NM-MT: Front <14%, Back <12%, max 8 defects

## IMAGE LAYOUT
- IMAGE 1: Card FRONT (artwork side)
- IMAGE 2: Card BACK
Both sides are shown. Analyze BOTH.

${centeringSection}

## TASK ${centeringData ? '1' : '2'}: CONDITION ASSESSMENT (DEEP SCAN - examine every pixel)

**CORNERS** - Examine all 8 corners (4 front, 4 back):
- Look for: whitening, dings, bends, peeling, rounding, soft corners
- Note WHICH specific corners have issues (e.g., "top-left front")
- Score: 10=perfect, 9=very minor, 8=light wear, 7=moderate wear

**EDGES** - Examine all 8 edges:
- Look for: whitening, nicks, chips, peeling, silvering, rough spots
- Note WHICH specific edges have issues
- Score: 10=perfect, 9=very minor, 8=light wear, 7=moderate wear

**SURFACE** - Examine both surfaces thoroughly:
- Look for: scratches, scuffs, print lines, ink errors, holo scratches
- Look for: fingerprints, residue, staining, fading, indentations
- Note location of any defects (e.g., "center front", "bottom-right back")
- Score: 10=perfect, 9=very minor, 8=light issues, 7=moderate issues

**LIST ALL DEFECTS** with:
- Type of defect (e.g., "corner whitening", "surface scratch")
- Location (e.g., "top-left corner front", "center back")
- Severity (minor/moderate/severe)

**CRITICAL: GLARE vs ACTUAL DEFECTS**
- GLARE appears as bright white/silver spots that follow light patterns, often oval or diffuse
- GLARE is NOT a defect - it's a photo artifact from lighting
- WHITENING is actual wear damage on corners/edges - it follows the card edge precisely
- If bright spots are in the MIDDLE of the card or don't follow edge contours = GLARE (ignore)
- If bright spots follow corner/edge shape precisely = possible WHITENING (count as defect)
- When in doubt about whitening vs glare, DO NOT count it as a defect

**IGNORE photographic artifacts, dust, reflections, GLARE - only grade ACTUAL physical defects**

## TASK ${centeringData ? '2' : '3'}: EXTRACT CARD INFO

From the front: name, HP, card number, set, rarity, year, variant, language

## TASK ${centeringData ? '3' : '4'}: APPLY GRADING STANDARDS

Using ${centeringData ? 'the PROVIDED centering data' : 'your centering measurements'} and condition assessment, determine grades for each company:

### PSA Standards (no 9.5, lowest-factor wins):
- PSA 10: Front 55/45, Back 75/25, virtually perfect
- PSA 9: Front 60/40, Back 90/10, one minor flaw allowed
- PSA 8: Front 65/35, Back 90/10, slight wear allowed

### BGS Standards (shows 4 subgrades, strictest centering):
- BGS 10 Pristine: 50/50 both sides, flawless
- BGS 9.5 Gem Mint: Front 55/45, Back 60/40
- BGS 9 Mint: Front 60/40, Back 65/35
- Final grade can only be 0.5 above lowest subgrade

### SGC Standards (strict back centering):
- SGC 10 Pristine: 50/50 both sides
- SGC 10 Gem Mint: Front 55/45, Back 70/30
- SGC 9.5: Front 55/45, Back 55/45

### CGC Standards (holistic, more forgiving on centering):
- CGC 10 Pristine: 50/50 both sides, flawless
- CGC 10 Gem Mint: Front 55/45, Back 75/25
- CGC 9.5: Front 60/40, Back 90/10

### TAG Standards (1000-point system, 8 subgrades):
- TAG 10 Pristine (990-1000): Front 52/48, Back 52/48 for TCG
- TAG 10 Gem Mint (950-989): Front 55/45, Back 65/35 for TCG
- TAG 9 Mint (900-949): Front 57/43, Back 70/30 for TCG
- Front defects weighted ~1.5x more than back

## RESPONSE FORMAT - Return ONLY this JSON:

{
  "cardInfo": {
    "name": "Pokemon Name",
    "hp": "60",
    "cardNumber": "025/198",
    "setName": "Set Name",
    "rarity": "Rare Holo",
    "year": "2023",
    "variant": null,
    "language": "English"
  },
  "centering": {
    "front": {
      "leftRight": "54.2/45.8",
      "topBottom": "49.5/50.5"
    },
    "back": {
      "leftRight": "52.3/47.7",
      "topBottom": "50.0/50.0"
    }
  },
  "condition": {
    "corners": 9.5,
    "edges": 9.0,
    "surface": 9.5,
    "defects": ["Minor edge whitening on top right"]
  },
  "grades": {
    "psa": {
      "grade": 9,
      "label": "Mint",
      "confidence": 0.85,
      "notes": "Centering within PSA 9 tolerance. Minor edge issue prevents 10."
    },
    "bgs": {
      "grade": 9.5,
      "label": "Gem Mint",
      "confidence": 0.80,
      "subgrades": {
        "centering": 9.5,
        "corners": 9.5,
        "edges": 9.0,
        "surface": 9.5
      },
      "notes": "Edge subgrade limits final to 9.5"
    },
    "sgc": {
      "grade": 9.5,
      "label": "Mint+",
      "confidence": 0.85,
      "notes": "Back centering within SGC tolerance for 9.5"
    },
    "cgc": {
      "grade": 9.5,
      "label": "Mint+",
      "confidence": 0.80,
      "notes": "Holistic assessment, minor edge issue noted"
    },
    "tag": {
      "score": 955,
      "grade": 10,
      "label": "Gem Mint",
      "confidence": 0.85,
      "subgrades": {
        "frontCentering": 118,
        "backCentering": 120,
        "frontCorners": 120,
        "backCorners": 118,
        "frontEdges": 115,
        "backEdges": 120,
        "frontSurface": 122,
        "backSurface": 122
      },
      "notes": "Score 955 = Gem Mint range (950-989)"
    }
  },
  "summary": {
    "positives": ["Sharp corners", "Clean surface", "Good centering"],
    "concerns": ["Minor edge whitening"],
    "recommendation": "Strong candidate for grading"
  }
}

CRITICAL RULES:
- Centering ratios must be based on actual visible borders
- All grades must follow that company's specific standards
- TAG score must be 100-1000 and match the grade range
- BGS subgrades must mathematically support the final grade
- Return ONLY valid JSON`;
}

/**
 * Grading prompt for SINGLE card (front only)
 */
function buildSingleGradingPrompt(cardType, centeringData = null) {
  // Build centering section for single image (front only)
  let centeringSection;
  if (centeringData?.front) {
    const { front } = centeringData;
    const fDevLR = Math.abs(50 - front.lrRatio).toFixed(1);
    const fDevTB = Math.abs(50 - front.tbRatio).toFixed(1);
    centeringSection = `## CENTERING DATA (PRE-MEASURED - USE THESE EXACT VALUES)
FRONT: ${front.lrRatio.toFixed(1)}/${(100 - front.lrRatio).toFixed(1)} L/R (${fDevLR}% dev) | ${front.tbRatio.toFixed(1)}/${(100 - front.tbRatio).toFixed(1)} T/B (${fDevTB}% dev)
⚠️ This is pixel-measured. Use directly - do NOT re-estimate.`;
  } else {
    centeringSection = `## TASK 1: MEASURE CENTERING (use decimal precision)
- Left/Right ratio with one decimal (e.g., "54.2/45.8")
- Top/Bottom ratio with one decimal (e.g., "49.5/50.5")`;
  }

  return `You are an expert trading card grader. Analyze this ${cardType} card FRONT image.

${centeringSection}

## TASK ${centeringData ? '1' : '2'}: ASSESS CONDITION (1-10 scale)
- Corners, Edges, Surface
- List any defects found

## TASK ${centeringData ? '2' : '3'}: EXTRACT CARD INFO
Name, HP, card number, set, rarity, year, variant, language

## TASK ${centeringData ? '3' : '4'}: APPLY GRADING STANDARDS

### PSA: No 9.5. 10 needs 55/45 front centering.
### BGS: Shows 4 subgrades. 10 needs 50/50. Final = lowest + 0.5 max.
### SGC: Has Pristine 10 (50/50) and Gem Mint 10 (55/45).
### CGC: Holistic. Pristine 10 needs 50/50, Gem Mint 10 needs 55/45.
### TAG: 1000-point system. Gem Mint 10 = 950-989, Pristine = 990-1000.

## RESPONSE FORMAT - Return ONLY this JSON:

{
  "cardInfo": {
    "name": "Pokemon Name",
    "hp": "60",
    "cardNumber": "025/198",
    "setName": "Set Name",
    "rarity": "Rare",
    "year": "2023",
    "variant": null,
    "language": "English"
  },
  "centering": {
    "front": {
      "leftRight": "54.2/45.8",
      "topBottom": "49.5/50.5"
    },
    "back": null
  },
  "condition": {
    "corners": 9.5,
    "edges": 9.0,
    "surface": 9.5,
    "defects": []
  },
  "grades": {
    "psa": { "grade": 9, "label": "Mint", "confidence": 0.85, "notes": "..." },
    "bgs": {
      "grade": 9.5,
      "label": "Gem Mint",
      "confidence": 0.80,
      "subgrades": { "centering": 9.5, "corners": 9.5, "edges": 9.0, "surface": 9.5 },
      "notes": "..."
    },
    "sgc": { "grade": 9.5, "label": "Mint+", "confidence": 0.85, "notes": "..." },
    "cgc": { "grade": 9.5, "label": "Mint+", "confidence": 0.80, "notes": "..." },
    "tag": {
      "score": 955,
      "grade": 10,
      "label": "Gem Mint",
      "confidence": 0.85,
      "subgrades": {
        "frontCentering": 118,
        "backCentering": null,
        "frontCorners": 120,
        "backCorners": null,
        "frontEdges": 115,
        "backEdges": null,
        "frontSurface": 122,
        "backSurface": null
      },
      "notes": "..."
    }
  },
  "summary": {
    "positives": ["..."],
    "concerns": ["..."],
    "recommendation": "..."
  }
}

Return ONLY valid JSON.`;
}
