/**
 * Deep AI Grade Endpoint
 *
 * Uses Anthropic Claude API directly with image URLs for full-resolution analysis.
 * Bypasses Vercel payload limits by having Claude fetch images from URLs.
 */

import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Detailed grading prompt for deep analysis
const DEEP_GRADING_PROMPT = `You are an expert trading card grader with years of experience at professional grading companies. Analyze these card images in EXTREME detail.

IMAGE 1: Front of the card (full resolution)
IMAGE 2: Back of the card (full resolution)

Examine every pixel carefully. This is a DEEP SCAN - the user expects thorough defect detection.

## Your Analysis Must Include:

### 1. CARD IDENTIFICATION
Extract from the card:
- Card name (Pokemon name)
- HP value
- Card number (e.g., "025/185")
- Set name
- Rarity symbol (circle=Common, diamond=Uncommon, star=Rare, etc.)
- Year/generation
- Any variant info (holo, reverse holo, full art, etc.)
- Language

### 2. CENTERING MEASUREMENT (CRITICAL - be extremely precise)
Measure EACH border independently, then calculate ratios WITH ONE DECIMAL PLACE:

**Method:**
1. Measure the LEFT border width in pixels
2. Measure the RIGHT border width in pixels
3. Calculate: Left% = Left / (Left + Right) * 100
4. Repeat for Top/Bottom
5. Do this separately for FRONT and BACK

**Important:**
- Do NOT assume the card is centered - most cards are off-center
- A difference of just 2-3% affects the grade significantly
- Double-check which border is actually wider
- "46.0/54.0" means LEFT border is 46% (right-heavy card)
- "54.0/46.0" means LEFT border is 54% (left-heavy card)

**Output format:**
- Front: Left/Right ratio (e.g., "46.0/54.0" = right-heavy)
- Front: Top/Bottom ratio (e.g., "45.5/54.5" = bottom-heavy)
- Back: Left/Right ratio (e.g., "56.0/44.0" = left-heavy)
- Back: Top/Bottom ratio (e.g., "46.0/54.0" = bottom-heavy)

ALWAYS use one decimal place. Be critical - even small offsets matter for grading.

### 3. CONDITION ASSESSMENT (Score each 1-10)
**CORNERS** - Examine all 8 corners (4 front, 4 back):
- Look for: whitening, dings, bends, peeling, rounding
- Note which specific corners have issues

**EDGES** - Examine all 8 edges:
- Look for: whitening, nicks, chips, peeling, silvering
- Note which specific edges have issues

**SURFACE** - Examine both surfaces thoroughly:
- Look for: scratches, scuffs, print lines, ink errors, holo scratches
- Look for: fingerprints, residue, staining, fading
- Note location of any defects

**DEFECTS** - List ALL visible defects:
- Type of defect
- Location (e.g., "top-left corner front", "center back")
- Severity (minor/moderate/severe)

### 4. GRADES FOR ALL COMPANIES
Based on your analysis, provide grades for:
- **PSA** (1-10 scale, half points allowed: 9.5, etc.)
- **BGS** (1-10 scale with subgrades for Centering, Corners, Edges, Surface)
- **CGC** (1-10 scale with subgrades)
- **SGC** (1-10 scale)
- **TAG** (1-1000 scale with 8 subgrades for front/back of each category)

### 5. SUMMARY
- Key positives (what's good about this card's condition)
- Key concerns (issues that affect grade)
- Recommendation (which company would grade this highest, submission advice)

## Response Format (JSON):
{
  "cardInfo": {
    "name": "string",
    "hp": "string or null",
    "cardNumber": "string",
    "setName": "string",
    "rarity": "string",
    "year": "string",
    "variant": "string or null",
    "language": "string"
  },
  "centering": {
    "front": { "leftRight": "54.2/45.8", "topBottom": "49.5/50.5" },
    "back": { "leftRight": "52.3/47.7", "topBottom": "50.0/50.0" }
  },
  "condition": {
    "corners": 8.5,
    "edges": 9.0,
    "surface": 8.0,
    "overall": 8.5
  },
  "defects": [
    { "type": "whitening", "location": "top-left corner front", "severity": "minor" },
    { "type": "scratch", "location": "center surface front", "severity": "moderate" }
  ],
  "grades": {
    "psa": { "grade": 8, "label": "NM-MT" },
    "bgs": {
      "grade": 8.5,
      "label": "NM-MT+",
      "subgrades": { "centering": 9, "corners": 8.5, "edges": 9, "surface": 8 }
    },
    "cgc": {
      "grade": 8.5,
      "label": "NM/Mint+",
      "subgrades": { "centering": 9, "corners": 8.5, "edges": 9, "surface": 8 }
    },
    "sgc": { "grade": 8.5, "label": "NM-MT+" },
    "tag": {
      "grade": 850,
      "label": "NM-MT+",
      "subgrades": {
        "centeringFront": 90, "centeringBack": 95,
        "cornersFront": 85, "cornersBack": 88,
        "edgesFront": 90, "edgesBack": 92,
        "surfaceFront": 80, "surfaceBack": 85
      }
    }
  },
  "summary": {
    "positives": ["Strong corners overall", "Excellent back centering"],
    "concerns": ["Light surface scratch on front", "Slight left-heavy centering on front"],
    "recommendation": "Best suited for BGS submission - subgrades will highlight strong corners and edges despite surface issue."
  }
}

IMPORTANT: Return ONLY the JSON object, no markdown formatting or explanation.`;

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

  const { frontUrl, backUrl, cardGame = 'pokemon' } = req.body;

  if (!frontUrl || !backUrl) {
    return res.status(400).json({ error: 'Missing image URLs (frontUrl and backUrl required)' });
  }

  // Validate URLs
  try {
    new URL(frontUrl);
    new URL(backUrl);
  } catch {
    return res.status(400).json({ error: 'Invalid image URLs provided' });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
  }

  try {
    console.log('[DeepAnalyze] Starting analysis with URLs:', {
      front: frontUrl.substring(0, 50) + '...',
      back: backUrl.substring(0, 50) + '...',
    });

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'url',
              url: frontUrl,
            },
          },
          {
            type: 'image',
            source: {
              type: 'url',
              url: backUrl,
            },
          },
          {
            type: 'text',
            text: DEEP_GRADING_PROMPT,
          },
        ],
      }],
    });

    // Extract text response
    const textContent = response.content.find(c => c.type === 'text');
    if (!textContent) {
      throw new Error('No text response from Claude');
    }

    // Parse JSON response
    let result;
    try {
      // Clean up response - remove markdown code blocks if present
      let jsonText = textContent.text.trim();
      if (jsonText.startsWith('```json')) {
        jsonText = jsonText.slice(7);
      }
      if (jsonText.startsWith('```')) {
        jsonText = jsonText.slice(3);
      }
      if (jsonText.endsWith('```')) {
        jsonText = jsonText.slice(0, -3);
      }
      result = JSON.parse(jsonText.trim());
    } catch (parseError) {
      console.error('[DeepAnalyze] Failed to parse response:', textContent.text);
      throw new Error('Failed to parse grading response');
    }

    console.log('[DeepAnalyze] Analysis complete:', {
      card: result.cardInfo?.name,
      psa: result.grades?.psa?.grade,
      defects: result.defects?.length || 0,
    });

    // Return successful response
    return res.status(200).json({
      success: true,
      cardInfo: result.cardInfo,
      centering: result.centering,
      condition: result.condition,
      defects: result.defects,
      grades: result.grades,
      summary: result.summary,
      analysisType: 'deep',
    });

  } catch (error) {
    console.error('[DeepAnalyze] Error:', error);

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
      error: 'Deep analysis failed',
      details: error.message,
    });
  }
}
