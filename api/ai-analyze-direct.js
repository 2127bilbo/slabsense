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

  const { frontUrl, backUrl, cardType = 'pokemon' } = req.body;

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
    const prompt = isStitched
      ? buildStitchedGradingPrompt(cardType)
      : buildSingleGradingPrompt(cardType);

    console.log('[AI-Direct] Starting analysis with URLs:', {
      front: frontUrl.substring(0, 50) + '...',
      back: backUrl ? backUrl.substring(0, 50) + '...' : 'none',
      isStitched,
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
 */
function buildStitchedGradingPrompt(cardType) {
  return `You are an expert trading card grader with deep knowledge of PSA, BGS, SGC, CGC, and TAG grading standards. Analyze this ${cardType} card.

## IMAGE LAYOUT
- IMAGE 1: Card FRONT (artwork side)
- IMAGE 2: Card BACK
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

**IGNORE photographic artifacts - only grade ACTUAL physical defects**

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
function buildSingleGradingPrompt(cardType) {
  return `You are an expert trading card grader. Analyze this ${cardType} card FRONT image.

## TASK 1: MEASURE CENTERING (use decimal precision)
- Left/Right ratio with one decimal (e.g., "54.2/45.8")
- Top/Bottom ratio with one decimal (e.g., "49.5/50.5")

## TASK 2: ASSESS CONDITION (1-10 scale)
- Corners, Edges, Surface
- List any defects found

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
