/**
 * Claude AI Card Grading Analysis - Multi-Company Format
 *
 * Returns grades for ALL major grading companies:
 * - PSA, BGS, SGC, CGC, TAG
 *
 * Each company has different standards - Claude applies them all
 * and returns grades in each format for easy tab switching.
 */

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
  maxDuration: 90,
};

const CLAUDE_MODEL = 'anthropic/claude-4-sonnet';

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;

  if (!REPLICATE_API_TOKEN) {
    return res.status(500).json({
      error: 'Replicate API not configured',
      message: 'Server missing REPLICATE_API_TOKEN'
    });
  }

  try {
    const { image, isStitched = false, cardType = 'pokemon' } = req.body;

    if (!image) {
      return res.status(400).json({ error: 'No image provided' });
    }

    console.log('[Claude] Starting multi-company grading analysis...');
    console.log('[Claude] Stitched (front+back):', isStitched);
    console.log('[Claude] Card type:', cardType);
    console.log('[Claude] Image size:', Math.round(image.length / 1024), 'KB');

    const apiUrl = `https://api.replicate.com/v1/models/${CLAUDE_MODEL}/predictions`;

    const prompt = isStitched
      ? buildStitchedGradingPrompt(cardType)
      : buildSingleGradingPrompt(cardType);

    console.log('[Claude] Sending to Replicate...');

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${REPLICATE_API_TOKEN}`,
        'Content-Type': 'application/json',
        'Prefer': 'wait',
      },
      body: JSON.stringify({
        input: {
          prompt,
          image,
          max_tokens: 6000,
          temperature: 0.1,
        }
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Claude] API error:', response.status, errorText);
      return res.status(500).json({
        error: 'Replicate API error',
        status: response.status,
        details: errorText.substring(0, 500),
      });
    }

    let prediction = await response.json();
    console.log('[Claude] Prediction ID:', prediction.id, 'Status:', prediction.status);

    if (prediction.status === 'starting' || prediction.status === 'processing') {
      console.log('[Claude] Polling for result...');
      prediction = await pollForResult(prediction.urls.get, REPLICATE_API_TOKEN);
    }

    if (prediction.status !== 'succeeded') {
      return res.status(500).json({
        error: 'Claude analysis failed',
        status: prediction.status,
        details: prediction.error,
      });
    }

    if (!prediction.output) {
      return res.status(500).json({
        error: 'No output from Claude',
        prediction: { id: prediction.id, status: prediction.status },
      });
    }

    const text = Array.isArray(prediction.output)
      ? prediction.output.join('')
      : prediction.output;

    console.log('[Claude] Response length:', text?.length || 0);

    if (!text) {
      return res.status(500).json({
        error: 'Empty response from Claude',
      });
    }

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error('[Claude] No JSON found:', text.substring(0, 500));
      return res.status(500).json({
        error: 'No JSON in response',
        response: text.substring(0, 1000),
      });
    }

    let analysis;
    try {
      analysis = JSON.parse(jsonMatch[0]);
    } catch (parseError) {
      return res.status(500).json({
        error: 'Failed to parse JSON',
        parseError: parseError.message,
        json: jsonMatch[0].substring(0, 500),
      });
    }

    console.log('[Claude] Analysis complete');

    return res.status(200).json({
      success: true,
      analysis,
      model: CLAUDE_MODEL,
    });

  } catch (error) {
    console.error('[Claude] Error:', error);
    return res.status(500).json({
      error: 'Analysis failed',
      message: error.message,
    });
  }
}

async function pollForResult(url, token, maxAttempts = 45) {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(r => setTimeout(r, 2000));

    try {
      const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (!response.ok) continue;

      const prediction = await response.json();

      if (prediction.status === 'succeeded' || prediction.status === 'failed') {
        return prediction;
      }

      console.log(`[Claude] Poll ${i + 1}/${maxAttempts}: ${prediction.status}`);
    } catch (e) {
      console.error(`[Claude] Poll ${i + 1} failed:`, e.message);
    }
  }

  return { status: 'failed', error: 'Timeout (90s)' };
}

/**
 * Comprehensive grading prompt for STITCHED image (front+back)
 */
function buildStitchedGradingPrompt(cardType) {
  return `You are an expert trading card grader with deep knowledge of PSA, BGS, SGC, CGC, and TAG grading standards. Analyze this ${cardType} card image.

## IMAGE LAYOUT
- LEFT HALF: Card FRONT (artwork side)
- RIGHT HALF: Card BACK
Both sides are shown. Analyze BOTH.

## TASK 1: MEASURE CENTERING (CRITICAL - assume cards are OFF-CENTER)

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

ALWAYS use one decimal. BE AGGRESSIVE - graders are critical, you should be too.

## TASK 2: ASSESS CONDITION

Examine and score (1-10 scale):
- Corners: whitening, dings, bends, softness
- Edges: whitening, chips, rough spots, fraying
- Surface: scratches, print lines, holo damage, scuffs, dents

**⚠️ CRITICAL WARNING: CAMERA GLARE ON POKEMON CARDS ⚠️**

Pokemon cards are photographed by users with phone cameras. MOST images have significant glare/flash reflection. You MUST NOT mistake glare for defects.

**THIS IS GLARE - DO NOT REPORT AS DEFECTS:**
- ANY bright white/silver spots or streaks (this is camera flash)
- Bright areas near corners that look "blown out" or overexposed
- Shiny reflections anywhere on holo/foil card surfaces
- Bright spots that have soft/fuzzy edges (real wear has sharp edges)
- Light areas that appear in multiple corners simultaneously (flash pattern)
- Any brightness on the card face that isn't at the precise paper edge

**THIS IS ACTUAL WEAR - ONLY REPORT THESE:**
- Corner whitening: WHITE FIBERS of the card stock are exposed at the corner TIP
- Edge whitening: WHITE PAPER FIBERS visible along the cut edge of the card
- Real wear looks like exposed cardboard/paper, NOT like bright reflection

**HOLO/FOIL CARDS ESPECIALLY:**
Full art cards, EX cards, GX cards, V cards, and any holographic cards will have INTENSE reflections. These reflections are NOT defects. A holo card showing rainbow reflections or bright spots is NORMAL.

**DECISION RULE:**
If you see bright areas on corners/edges, ask yourself: "Can I see actual exposed paper fibers, or is this just light reflecting off the card surface?"
- If you cannot clearly see damaged paper fibers → IT IS GLARE → DO NOT REPORT
- If you see actual white cardboard exposed → REPORT as wear

**DEFAULT ASSUMPTION: The card is in excellent condition unless you see OBVIOUS physical damage.**
Most cards submitted for grading are near-mint. Err heavily on the side of NOT reporting defects.

## TASK 3: EXTRACT CARD INFO

From the front: name, HP, card number, set, rarity, year, variant, language

## TASK 4: APPLY GRADING STANDARDS

Using your centering measurements and condition assessment, determine grades for each company:

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
      "notes": "Centering within PSA 9 tolerance. Minor edge issue prevents 10."
    },
    "bgs": {
      "grade": 9.5,
      "label": "Gem Mint",
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
      "notes": "Back centering within SGC tolerance for 9.5"
    },
    "cgc": {
      "grade": 9.5,
      "label": "Mint+",
      "notes": "Holistic assessment, minor edge issue noted"
    },
    "tag": {
      "score": 955,
      "grade": 10,
      "label": "Gem Mint",
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
function buildSingleGradingPrompt(cardType) {
  return `You are an expert trading card grader. Analyze this ${cardType} card FRONT image.

## TASK 1: MEASURE CENTERING (use decimal precision)
- Left/Right ratio with one decimal (e.g., "54.2/45.8")
- Top/Bottom ratio with one decimal (e.g., "49.5/50.5")

## TASK 2: ASSESS CONDITION (1-10 scale)
- Corners, Edges, Surface
- List any defects found

**⚠️ CRITICAL: CAMERA GLARE WARNING ⚠️**
Phone cameras create significant flash/glare on Pokemon cards. DO NOT mistake reflections for defects.
- GLARE: Bright white/silver spots, shiny reflections on holo surfaces, soft/fuzzy bright areas
- REAL WEAR: Exposed white paper fibers at corner tips or along cut edges
- Holo/foil cards will have INTENSE reflections - this is NORMAL, not damage
- DEFAULT: Assume the card is near-mint unless you see OBVIOUS physical damage
- When in doubt, DO NOT report it as a defect

## TASK 3: EXTRACT CARD INFO
Name, HP, card number, set, rarity, year, variant, language

## TASK 4: APPLY GRADING STANDARDS

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
    "psa": { "grade": 9, "label": "Mint", "notes": "..." },
    "bgs": {
      "grade": 9.5,
      "label": "Gem Mint",
      "subgrades": { "centering": 9.5, "corners": 9.5, "edges": 9.0, "surface": 9.5 },
      "notes": "..."
    },
    "sgc": { "grade": 9.5, "label": "Mint+", "notes": "..." },
    "cgc": { "grade": 9.5, "label": "Mint+", "notes": "..." },
    "tag": {
      "score": 955,
      "grade": 10,
      "label": "Gem Mint",
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
