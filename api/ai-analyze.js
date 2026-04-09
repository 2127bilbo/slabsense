/**
 * Claude AI Card Grading Analysis
 *
 * Receives PRE-CROPPED card images (from SAM) and analyzes:
 * - Card info (OCR)
 * - Centering analysis
 * - Condition assessment
 * - Grading notes
 *
 * Input: Single image or stitched (front+back side-by-side)
 * Output: Full grading analysis JSON
 *
 * Cost: ~$0.02-0.03 per call
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

    console.log('[Claude] Starting grading analysis...');
    console.log('[Claude] Stitched image (front+back):', isStitched);
    console.log('[Claude] Image size:', Math.round(image.length / 1024), 'KB');

    const apiUrl = `https://api.replicate.com/v1/models/${CLAUDE_MODEL}/predictions`;

    // Build prompt based on whether image is stitched
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
          max_tokens: 4096,
          temperature: 0.1,
        }
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Claude] API error:', response.status, errorText);
      throw new Error(`Replicate API error: ${response.status}`);
    }

    let prediction = await response.json();
    console.log('[Claude] Prediction ID:', prediction.id, 'Status:', prediction.status);

    // Poll if not immediately complete
    if (prediction.status === 'starting' || prediction.status === 'processing') {
      console.log('[Claude] Polling for result...');
      prediction = await pollForResult(prediction.urls.get, REPLICATE_API_TOKEN);
    }

    if (prediction.status !== 'succeeded') {
      throw new Error(`Claude analysis failed: ${prediction.error || prediction.status}`);
    }

    // Parse response
    const text = Array.isArray(prediction.output)
      ? prediction.output.join('')
      : prediction.output;

    console.log('[Claude] Response length:', text.length);

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error('[Claude] No JSON found in response:', text.substring(0, 500));
      throw new Error('No JSON in Claude response');
    }

    const analysis = JSON.parse(jsonMatch[0]);
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

      if (!response.ok) {
        console.error(`[Claude] Poll error: ${response.status}`);
        continue;
      }

      const prediction = await response.json();

      if (prediction.status === 'succeeded' || prediction.status === 'failed') {
        return prediction;
      }

      console.log(`[Claude] Poll ${i + 1}/${maxAttempts}: ${prediction.status}`);
    } catch (pollError) {
      console.error(`[Claude] Poll ${i + 1} failed:`, pollError.message);
    }
  }

  return { status: 'failed', error: 'Timeout waiting for Claude (90s)' };
}

/**
 * Prompt for STITCHED image (front on left, back on right)
 * The cards are already cropped by SAM - Claude just needs to analyze them
 */
function buildStitchedGradingPrompt(cardType) {
  return `You are an expert ${cardType} card grader. This image shows BOTH sides of a card that have been PRE-CROPPED and placed side-by-side.

## IMAGE LAYOUT:
- LEFT HALF: Card FRONT (artwork side)
- RIGHT HALF: Card BACK

The cards are already cropped to their edges. Analyze BOTH sides.

## YOUR TASKS:

### 1. CARD INFORMATION (from FRONT - left half)
Extract:
- Card name / Pokemon name
- HP value
- Card number (e.g., "025/198", "SV049", "SVP EN 085")
- Set name
- Rarity (Common, Uncommon, Rare, Holo Rare, etc.)
- Year
- Special variant (if any: Full Art, Alt Art, etc.)
- Language

### 2. CENTERING ANALYSIS (BOTH sides)
Look at the borders (space between card edge and printed area):
- For FRONT: Measure left vs right border ratio, top vs bottom ratio
- For BACK: Measure left vs right border ratio, top vs bottom ratio
- Express as ratios like "55/45" (55% on left, 45% on right)

### 3. CONDITION ASSESSMENT
Score each 1-10 (10 = perfect gem mint):
- Corners: Check all 4 corners for whitening, dings, bends
- Edges: Check for whitening, chips, rough spots
- Surface: Check for scratches, print lines, holo damage
- Centering: Based on your measurements above

**CRITICAL - These are CROPPED photos:**
- The cards fill the frame - this is intentional
- Focus on the actual card condition
- Ignore any JPEG artifacts from cropping

### 4. GRADING NOTES
- List positives (what's good about this card)
- List concerns (any issues found)
- Estimated grade (PSA/BGS scale: 1-10)
- Confidence level

## RESPONSE FORMAT - Return ONLY this JSON:

{
  "front": {
    "borders": {"left": 15, "right": 18, "top": 12, "bottom": 14},
    "centeringLR": "45/55",
    "centeringTB": "46/54"
  },
  "back": {
    "borders": {"left": 16, "right": 16, "top": 14, "bottom": 14},
    "centeringLR": "50/50",
    "centeringTB": "50/50"
  },
  "cardInfo": {
    "name": "Pikachu",
    "hp": "60",
    "cardNumber": "025/198",
    "setName": "Scarlet & Violet Base",
    "rarity": "Illustration Rare",
    "year": "2023",
    "variant": "Special Art",
    "language": "English"
  },
  "condition": {
    "corners": 9.5,
    "edges": 9.0,
    "surface": 9.5,
    "centering": 8.5,
    "overall": 9.0,
    "notes": "Minor centering to right on front"
  },
  "gradingNotes": {
    "positives": ["Sharp corners", "Clean holo", "No whitening"],
    "concerns": ["Slight off-center front"],
    "estimatedGrade": "9.0",
    "confidence": "high"
  }
}

IMPORTANT:
- Return ONLY valid JSON, no other text
- Analyze BOTH halves of the image (front AND back)
- Be accurate - this affects the card's grade and value`;
}

/**
 * Prompt for SINGLE card image (front only)
 */
function buildSingleGradingPrompt(cardType) {
  return `You are an expert ${cardType} card grader. This image shows a SINGLE card (FRONT only) that has been PRE-CROPPED to its edges.

## YOUR TASKS:

### 1. CARD INFORMATION
Extract:
- Card name / Pokemon name
- HP value
- Card number
- Set name
- Rarity
- Year
- Variant (if special)
- Language

### 2. CENTERING ANALYSIS
Look at the borders (space between card edge and printed area):
- Left vs right border ratio
- Top vs bottom border ratio
- Express as "55/45" format

### 3. CONDITION ASSESSMENT
Score each 1-10 (10 = gem mint):
- Corners: whitening, dings, bends
- Edges: whitening, chips, rough spots
- Surface: scratches, print lines, damage
- Centering: based on border measurements

### 4. GRADING NOTES
- Positives and concerns
- Estimated grade (1-10)
- Confidence level

## RESPONSE FORMAT - Return ONLY this JSON:

{
  "front": {
    "borders": {"left": 15, "right": 18, "top": 12, "bottom": 14},
    "centeringLR": "45/55",
    "centeringTB": "46/54"
  },
  "cardInfo": {
    "name": "Pikachu",
    "hp": "60",
    "cardNumber": "025/198",
    "setName": "Scarlet & Violet Base",
    "rarity": "Common",
    "year": "2023",
    "variant": null,
    "language": "English"
  },
  "condition": {
    "corners": 9.5,
    "edges": 9.0,
    "surface": 9.5,
    "centering": 8.5,
    "overall": 9.0,
    "notes": "Minor centering variance"
  },
  "gradingNotes": {
    "positives": ["Sharp corners", "Clean surface"],
    "concerns": ["Slight off-center"],
    "estimatedGrade": "9.0",
    "confidence": "high"
  }
}

Return ONLY valid JSON.`;
}
