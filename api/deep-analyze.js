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

// Detailed grading prompt for deep analysis (4-image version)
const DEEP_GRADING_PROMPT_4IMG = `You are an expert trading card grader with years of experience at professional grading companies. Analyze these card images in EXTREME detail.

## IMAGE LAYOUT (4 IMAGES PROVIDED):
- **IMAGE 1**: Front of card WITH BACKGROUND VISIBLE (use for CENTERING measurement)
- **IMAGE 2**: Back of card WITH BACKGROUND VISIBLE (use for CENTERING measurement)
- **IMAGE 3**: Front of card CROPPED TO BORDERS (use for DEFECT detection - corners, edges, surface)
- **IMAGE 4**: Back of card CROPPED TO BORDERS (use for DEFECT detection - corners, edges, surface)

**IMPORTANT**:
- For CENTERING: Use images 1 & 2 (with background) - you can see the card edge vs background clearly
- For DEFECTS: Use images 3 & 4 (cropped) - higher detail view of the card surface, corners, edges

Examine every pixel carefully. This is a DEEP SCAN - the user expects thorough defect detection.`;

// Detailed grading prompt for deep analysis (legacy 2-image version)
const DEEP_GRADING_PROMPT_2IMG = `You are an expert trading card grader with years of experience at professional grading companies. Analyze these card images in EXTREME detail.

IMAGE 1: Front of the card (full resolution)
IMAGE 2: Back of the card (full resolution)

Examine every pixel carefully. This is a DEEP SCAN - the user expects thorough defect detection.`;

// Shared analysis instructions (appended to both prompts)
const ANALYSIS_INSTRUCTIONS = `

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

**IMPORTANT: Most cards are NOT centered. Assume off-center until proven otherwise.**

**Step-by-step method (you MUST follow this):**

For FRONT Left/Right:
1. Look at the LEFT border (edge of card to edge of artwork/frame)
2. Look at the RIGHT border
3. Ask yourself: "Which border is visibly WIDER?"
4. Estimate HOW MUCH wider (e.g., "right border is about 15-20% wider than left")
5. Convert to ratio: if right is 20% wider, that's roughly 45/55

For FRONT Top/Bottom:
- Repeat the same process

For BACK Left/Right and Top/Bottom:
- Repeat for back image
- **PAY EXTRA ATTENTION TO THE BACK** - the orange border on Pokemon backs makes centering very visible
- Look at the orange border width on LEFT vs RIGHT carefully
- Back centering is often MORE off-center than front - don't assume it's centered

**Critical rules:**
- If borders look "about equal," look HARDER - one is almost always wider
- A border that's 15-20% wider than the other = roughly 45/55 or 55/45
- A border that's 25-30% wider = roughly 43/57 or 57/43
- Do NOT round toward 50/50 - be aggressive in your estimates
- "46.0/54.0" means LEFT is 46% (card shifted LEFT, right border wider)
- "56.0/44.0" means LEFT is 56% (card shifted RIGHT, left border wider)

**Output with one decimal place:**
- Front L/R: e.g., "46.0/54.0"
- Front T/B: e.g., "45.0/55.0"
- Back L/R: e.g., "56.0/44.0"
- Back T/B: e.g., "46.0/54.0"

BE AGGRESSIVE - graders are critical, you should be too.

**Centering Grade Impact (from TAG calibration data):**
- 50/50 perfect = 10 Pristine potential
- 48/52 or 52/48 (2% off) = 10 Gem Mint max
- 45/55 or 55/45 (5% off) = 9 Mint max
- 43/57 or 57/43 (7% off) = 8.5 NM-MT+ max
- 40/60 or 60/40 (10% off) = 8 NM-MT max
- Worse than 60/40 = 7.5 or lower

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
Based on your analysis, provide grades for each company using their specific standards:

**PSA** (1-10 scale, NO 9.5 exists):
- Labels: 10=Gem Mint, 9=Mint, 8=NM-MT, 7=NM, 6=EX-MT, 5=EX, 4=VG-EX, 3=VG, 2=Good, 1=Poor
- Half grades available: 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5 (but NOT 9.5)

**BGS** (1-10 scale with 4 subgrades):
- Labels: 10=Pristine, 9.5=Gem Mint, 9=Mint, 8.5=NM-MT+, 8=NM-MT, 7.5=NM+, 7=NM
- Subgrades: centering, corners, edges, surface (each 1-10)
- Final grade can only be 0.5 above lowest subgrade

**CGC** (1-10 scale with 4 subgrades):
- Labels: 10=Pristine/Gem Mint, 9.5=Mint+, 9=Mint, 8.5=NM/Mint+, 8=NM/Mint, 7=NM
- Subgrades: centering, corners, edges, surface (each 1-10)

**SGC** (1-10 scale):
- Labels: 10=Pristine or Gem Mint, 9.5=Mint+, 9=Mint, 8.5=NM/MT+, 8=NM/MT, 7=NM

**TAG** (1000-point score system, NO 9.5):
- Score 990-1000 = Grade 10 "Pristine" (strictest: centering <2% front/<4% back, 0 corner/edge defects)
- Score 950-989 = Grade 10 "Gem Mint" (centering <5% front/<6.5% back, max 3 minor defects)
- Score 900-949 = Grade 9 "Mint" (centering <6% front/<7% back, max 4 minor defects)
- Score 850-899 = Grade 8.5 "NM-MT+" (centering <7% front/<8% back)
- Score 800-849 = Grade 8 "NM-MT" (centering <8% front/<9% back)
- Score 750-799 = Grade 7.5 "NM+" (centering <10% front/<11% back)
- Score 700-749 = Grade 7 "NM" (centering <10% front/<11% back)
- 8 subgrades (each max 125): frontCentering, backCentering, frontCorners, backCorners, frontEdges, backEdges, frontSurface, backSurface

**TAG Centering Calibration (from 509 real TAG grades):**
- 10 Pristine: Front max 1.98%, Back max 3.85%
- 10 Gem Mint: Front max 4.5%, Back max 6.3%
- 9 Mint: Front max 9.8%, Back max 9.2%
- 8.5 NM-MT+: Front max 12.2%, Back max 11.2%
- 8 NM-MT: Front max 13.9%, Back max 10.3%

**TAG Defect Limits by Grade:**
- 10 Pristine: Max 3 SURFACE defects only (no corner/edge wear), avg 0.3 defects
- 10 Gem Mint: Max 3 total (1 corner, 1 edge, 2 surface), avg 0.5 defects
- 9 Mint: Max 4 total (3 corner, 2 edge, 3 surface), avg 1.8 defects
- Lower grades: Progressively more defects allowed

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
    "psa": { "grade": 8, "label": "NM-MT", "notes": "Centering and condition analysis" },
    "bgs": {
      "grade": 8.5,
      "label": "NM-MT+",
      "subgrades": { "centering": 9, "corners": 8.5, "edges": 9, "surface": 8 },
      "notes": "Lowest subgrade limits final grade"
    },
    "cgc": {
      "grade": 8.5,
      "label": "NM/Mint+",
      "subgrades": { "centering": 9, "corners": 8.5, "edges": 9, "surface": 8 },
      "notes": "Holistic assessment"
    },
    "sgc": { "grade": 8.5, "label": "NM/MT+", "notes": "Back centering assessment" },
    "tag": {
      "score": 845,
      "grade": 8,
      "label": "NM-MT",
      "subgrades": {
        "frontCentering": 105,
        "backCentering": 108,
        "frontCorners": 110,
        "backCorners": 105,
        "frontEdges": 107,
        "backEdges": 110,
        "frontSurface": 100,
        "backSurface": 100
      },
      "notes": "Score 845 = NM-MT range (800-849)"
    }
  },
  "summary": {
    "positives": ["Strong corners overall", "Excellent back centering"],
    "concerns": ["Light surface scratch on front", "Slight left-heavy centering on front"],
    "recommendation": "Best suited for BGS submission - subgrades will highlight strong corners and edges despite surface issue."
  }
}

CRITICAL RULES:
- PSA has NO 9.5 grade - use 9 or 10 only at top end
- TAG has NO 9.5 - jumps from 9 Mint to 10 Gem Mint
- TAG must have BOTH "score" (1000-point) AND "grade" (1-10) fields
- TAG subgrade keys must be: frontCentering, backCentering, frontCorners, backCorners, frontEdges, backEdges, frontSurface, backSurface
- BGS subgrades must mathematically support the final grade (final = lowest + 0.5 max)
- Return ONLY valid JSON, no markdown`;

// Build full prompt based on image count
const buildPrompt = (has4Images) => {
  const intro = has4Images ? DEEP_GRADING_PROMPT_4IMG : DEEP_GRADING_PROMPT_2IMG;
  return intro + ANALYSIS_INSTRUCTIONS;
};

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
    // 4-image mode (preferred)
    frontOriginalUrl,
    backOriginalUrl,
    frontCroppedUrl,
    backCroppedUrl,
    // Legacy 2-image mode (backwards compatibility)
    frontUrl,
    backUrl,
    cardGame = 'pokemon'
  } = req.body;

  // Determine if using 4-image mode or legacy 2-image mode
  const has4Images = frontOriginalUrl && backOriginalUrl && frontCroppedUrl && backCroppedUrl;
  const hasLegacy = frontUrl && backUrl;

  if (!has4Images && !hasLegacy) {
    return res.status(400).json({
      error: 'Missing image URLs. Provide either 4 URLs (frontOriginalUrl, backOriginalUrl, frontCroppedUrl, backCroppedUrl) or legacy 2 URLs (frontUrl, backUrl)'
    });
  }

  // Build image URLs array based on mode
  const imageUrls = has4Images
    ? [frontOriginalUrl, backOriginalUrl, frontCroppedUrl, backCroppedUrl]
    : [frontUrl, backUrl];

  // Validate all URLs
  try {
    imageUrls.forEach(url => new URL(url));
  } catch {
    return res.status(400).json({ error: 'Invalid image URLs provided' });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
  }

  try {
    console.log('[DeepAnalyze] Starting analysis:', {
      mode: has4Images ? '4-image' : 'legacy-2-image',
      imageCount: imageUrls.length,
      urls: imageUrls.map(url => url.substring(0, 50) + '...'),
    });

    // Build image content array
    const imageContent = imageUrls.map(url => ({
      type: 'image',
      source: {
        type: 'url',
        url: url,
      },
    }));

    // Add prompt text
    const messageContent = [
      ...imageContent,
      {
        type: 'text',
        text: buildPrompt(has4Images),
      },
    ];

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      messages: [{
        role: 'user',
        content: messageContent,
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
      imageMode: has4Images ? '4-image' : '2-image',
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
