/**
 * Unified AI Card Analysis via Claude Sonnet 4 on Replicate
 *
 * STANDARDIZED IMAGE APPROACH:
 * - All images are standardized to 1400x1960 before sending
 * - If front+back: images are stitched side-by-side (2800x1960)
 * - Front is always left half (0-1400), Back is right half (1400-2800)
 * - ONE Claude call analyzes everything - no scaling math needed
 *
 * Cost: ~$0.02-0.05 per card (uses your Replicate prepaid balance)
 */

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
  maxDuration: 120,
};

// Claude Sonnet 4 on Replicate
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

    console.log('[Claude Vision] Analyzing card via Replicate...');
    console.log('[Claude Vision] Stitched image:', isStitched);
    console.log('[Claude Vision] Image size:', Math.round(image.length / 1024), 'KB');

    const apiUrl = `https://api.replicate.com/v1/models/${CLAUDE_MODEL}/predictions`;

    // Build prompt based on whether image is stitched (front+back) or single (front only)
    const prompt = isStitched
      ? buildStitchedPrompt(cardType)
      : buildFrontOnlyPrompt(cardType);

    console.log('[Claude] Starting analysis...');

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
      throw new Error(`API error: ${response.status}`);
    }

    let prediction = await response.json();
    console.log('[Claude] Prediction:', prediction.id, prediction.status);

    if (prediction.status === 'starting' || prediction.status === 'processing') {
      prediction = await pollForResult(prediction.urls.get, REPLICATE_API_TOKEN);
    }

    if (prediction.status !== 'succeeded') {
      throw new Error(`Analysis failed: ${prediction.error || prediction.status}`);
    }

    const text = Array.isArray(prediction.output)
      ? prediction.output.join('')
      : prediction.output;

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error('[Claude] No JSON in response:', text.substring(0, 500));
      throw new Error('No JSON in response');
    }

    const analysisResult = JSON.parse(jsonMatch[0]);
    console.log('[Claude] Analysis complete');

    return res.status(200).json({
      success: true,
      analysis: analysisResult,
      model: CLAUDE_MODEL,
    });

  } catch (error) {
    console.error('AI analysis error:', error);
    return res.status(500).json({
      error: 'Analysis failed',
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
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

      console.log(`[Claude] Polling ${i + 1}/${maxAttempts}, status: ${prediction.status}`);
    } catch (pollError) {
      console.error(`[Claude] Poll attempt ${i + 1} failed:`, pollError.message);
    }
  }

  return { status: 'failed', error: 'Timeout waiting for Claude response (90s)' };
}

/**
 * Prompt for STITCHED image (front+back side-by-side)
 * Image layout: 2800x1960 total
 *   - Left half (0-1400): Card FRONT
 *   - Right half (1400-2800): Card BACK
 */
function buildStitchedPrompt(cardType) {
  return `You are an expert trading card analyst and professional grader. This image shows BOTH sides of a ${cardType} card STITCHED SIDE-BY-SIDE.

## IMAGE LAYOUT (IMPORTANT!):
- Total image size: 2800 x 1960 pixels
- LEFT HALF (x: 0 to 1400): Card FRONT
- RIGHT HALF (x: 1400 to 2800): Card BACK

## YOUR TASKS:

### 1. CARD FRONT (LEFT HALF, x: 0-1400)
Find the EXACT card boundaries in the LEFT half of the image:
- Identify all 4 corners precisely (in pixels from image top-left)
- Calculate rotation angle needed to straighten the card
- Measure border widths and centering ratios

### 2. CARD BACK (RIGHT HALF, x: 1400-2800)
Find the EXACT card boundaries in the RIGHT half of the image:
- Identify all 4 corners precisely (x coordinates will be 1400-2800 range)
- Calculate rotation angle needed to straighten the card
- Measure border widths and centering ratios for the back

### 3. CARD INFORMATION (from FRONT only)
- Pokemon/Character name
- HP value, Card number, Set name, Rarity, Year, Variant

### 4. CONDITION ASSESSMENT
Score each category 1-10 (10 = perfect):
- Corners, Edges, Surface, Centering

**CRITICAL - IGNORE PHOTOGRAPHIC ARTIFACTS:**
- DO NOT count glare, reflections, or lighting as defects
- DO NOT count camera flash spots or shine as surface issues
- ONLY count ACTUAL PHYSICAL defects on the card
- Holo reflections are NOT damage

### 5. GRADING NOTES
- List positives and concerns
- Estimated grade (1-10 scale)

## RESPONSE FORMAT - Return ONLY this JSON:

{
  "front": {
    "boundingBox": {
      "topLeft": {"x": 50, "y": 30},
      "topRight": {"x": 350, "y": 32},
      "bottomLeft": {"x": 48, "y": 480},
      "bottomRight": {"x": 348, "y": 482}
    },
    "rotationAngle": 0,
    "borders": {"left": 15, "right": 18, "top": 12, "bottom": 14},
    "centeringLR": "45/55",
    "centeringTB": "46/54"
  },
  "back": {
    "boundingBox": {
      "topLeft": {"x": 1450, "y": 30},
      "topRight": {"x": 1750, "y": 32},
      "bottomLeft": {"x": 1448, "y": 480},
      "bottomRight": {"x": 1748, "y": 482}
    },
    "rotationAngle": 0,
    "borders": {"left": 15, "right": 15, "top": 14, "bottom": 14},
    "centeringLR": "50/50",
    "centeringTB": "50/50"
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
    "notes": "Minor edge whitening on top"
  },
  "gradingNotes": {
    "positives": ["Sharp corners", "Clean holo surface"],
    "concerns": ["Slight off-center to right"],
    "estimatedGrade": "9.0",
    "confidence": "high"
  }
}

CRITICAL RULES:
- FRONT bounding box x values: 0-1400 range
- BACK bounding box x values: 1400-2800 range
- All coordinates are in PIXELS from image top-left
- Return ONLY valid JSON, no other text
- Be PRECISE - coordinates are used for automated cropping`;
}

/**
 * Prompt for FRONT ONLY image (single card)
 * Image layout: 1400x1960
 */
function buildFrontOnlyPrompt(cardType) {
  return `You are an expert trading card analyst and professional grader. Analyze this ${cardType} card FRONT image with EXTREME PRECISION.

## IMAGE SIZE: 1400 x 1960 pixels

## YOUR TASKS:

### 1. CARD BOUNDARY DETECTION
Find the EXACT card boundaries in the image. The card may be rotated or tilted.
- Identify all 4 corners of the card precisely (in pixels from top-left of image)
- Calculate the rotation angle needed to make the card perfectly straight (degrees)

### 2. CENTERING ANALYSIS
Measure the border widths on all 4 sides (space between card edge and printed area):
- Left, Right, Top, Bottom border widths in pixels
- Calculate centering ratios (e.g., "60/40" for left-right)

### 3. CARD INFORMATION (OCR)
- Pokemon/Character name
- HP value
- Card number (e.g., "025/198" or "SV049")
- Set name, Rarity, Year, Special variants

### 4. CONDITION ASSESSMENT
Score each category 1-10 (10 = perfect):
- Corners, Edges, Surface, Centering

**CRITICAL - IGNORE PHOTOGRAPHIC ARTIFACTS:**
- DO NOT count glare, reflections, or lighting as defects
- DO NOT count camera flash spots or shine as surface issues
- ONLY count ACTUAL PHYSICAL defects on the card
- Holo reflections are NOT damage

### 5. GRADING NOTES
- List positives and concerns
- Estimated grade (1-10 scale)

## RESPONSE FORMAT - Return ONLY this JSON:

{
  "front": {
    "boundingBox": {
      "topLeft": {"x": 50, "y": 30},
      "topRight": {"x": 350, "y": 32},
      "bottomLeft": {"x": 48, "y": 480},
      "bottomRight": {"x": 348, "y": 482}
    },
    "rotationAngle": -0.5,
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
    "notes": "Minor edge whitening on top"
  },
  "gradingNotes": {
    "positives": ["Sharp corners", "Clean holo surface"],
    "concerns": ["Slight off-center to right"],
    "estimatedGrade": "9.0",
    "confidence": "high"
  }
}

CRITICAL RULES:
- All coordinates are in PIXELS (from image top-left corner)
- Rotation angle in DEGREES (positive = clockwise needed)
- Return ONLY valid JSON, no other text
- Be PRECISE - coordinates are used for automated cropping`;
}
