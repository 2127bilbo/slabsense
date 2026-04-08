/**
 * Unified AI Card Analysis via Claude Sonnet 4 on Replicate
 *
 * Single API call that handles EVERYTHING:
 * - Card boundary detection with precise coordinates
 * - Rotation/deskew angle detection
 * - Border measurements for centering (front & back)
 * - Card info extraction (OCR)
 * - Condition assessment with numeric scores
 * - Grading notes
 *
 * Cost: ~$0.02-0.05 per card (uses your Replicate prepaid balance)
 */

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
  maxDuration: 120, // Increased for parallel front+back analysis
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
    const { frontImage, backImage, cardType = 'pokemon' } = req.body;

    if (!frontImage) {
      return res.status(400).json({ error: 'No front image provided' });
    }

    console.log('[Claude Vision] Analyzing card via Replicate...');
    console.log('[Claude Vision] Has back image:', !!backImage);

    const apiUrl = `https://api.replicate.com/v1/models/${CLAUDE_MODEL}/predictions`;

    // Helper to call Claude and get result
    const analyzeImage = async (image, prompt, label) => {
      console.log(`[Claude] Starting ${label} analysis...`);

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
        console.error(`[Claude] ${label} API error:`, response.status);
        throw new Error(`API error: ${response.status}`);
      }

      let prediction = await response.json();
      console.log(`[Claude] ${label} prediction:`, prediction.id, prediction.status);

      if (prediction.status === 'starting' || prediction.status === 'processing') {
        prediction = await pollForResult(prediction.urls.get, REPLICATE_API_TOKEN);
      }

      if (prediction.status !== 'succeeded') {
        throw new Error(`${label} failed: ${prediction.error || prediction.status}`);
      }

      const text = Array.isArray(prediction.output)
        ? prediction.output.join('')
        : prediction.output;

      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error(`No JSON in ${label} response`);
      }

      console.log(`[Claude] ${label} analysis complete`);
      return JSON.parse(jsonMatch[0]);
    };

    // Run front and back analysis IN PARALLEL for speed
    const frontPrompt = buildUnifiedPrompt(cardType);
    const backPrompt = buildBackImagePrompt();

    const analysisPromises = [
      analyzeImage(frontImage, frontPrompt, 'Front')
    ];

    if (backImage) {
      analysisPromises.push(
        analyzeImage(backImage, backPrompt, 'Back').catch(err => {
          console.error('[Claude] Back analysis failed:', err.message);
          return null; // Don't fail entire request if back fails
        })
      );
    }

    console.log(`[Claude] Running ${analysisPromises.length} analysis calls in parallel...`);
    const results = await Promise.all(analysisPromises);

    const frontResult = results[0];
    const backResult = results[1] || null;

    // Merge results
    const analysisResult = {
      ...frontResult,
      back: backResult?.back || backResult || null,
    };

    console.log('[Claude] All analysis complete');

    return res.status(200).json({
      success: true,
      analysis: analysisResult,
      model: CLAUDE_MODEL,
      predictionId: prediction.id,
      metrics: prediction.metrics,
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
    await new Promise(r => setTimeout(r, 2000)); // Wait 2 seconds between polls

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

function buildUnifiedPrompt(cardType) {
  return `You are an expert trading card analyst and professional grader. Analyze this ${cardType} card FRONT image with EXTREME PRECISION.

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

function buildBackImagePrompt() {
  return `You are analyzing the BACK of a trading card. Find the card boundaries with EXTREME PRECISION.

## YOUR TASK:

### CARD BOUNDARY DETECTION
Find the EXACT card boundaries in the image. The card may be rotated or tilted.
- Identify all 4 corners of the card precisely (in pixels from top-left of image)
- Calculate the rotation angle needed to make the card perfectly straight (degrees)

### CENTERING (for card backs)
For Pokemon/TCG backs with the standard pattern:
- Measure the border widths on all 4 sides
- Calculate centering ratios

**CRITICAL - IGNORE PHOTOGRAPHIC ARTIFACTS:**
- DO NOT include glare, reflections, or shadows in your measurements
- Find the PHYSICAL edge of the card, not lighting artifacts

## RESPONSE FORMAT - Return ONLY this JSON:

{
  "back": {
    "boundingBox": {
      "topLeft": {"x": 50, "y": 30},
      "topRight": {"x": 350, "y": 32},
      "bottomLeft": {"x": 48, "y": 480},
      "bottomRight": {"x": 348, "y": 482}
    },
    "rotationAngle": -0.5,
    "borders": {
      "left": 15,
      "right": 18,
      "top": 12,
      "bottom": 14
    },
    "centeringLR": "48/52",
    "centeringTB": "50/50"
  }
}

CRITICAL RULES:
- All coordinates are in PIXELS from image top-left corner
- Rotation angle is in DEGREES (positive = clockwise needed)
- Return ONLY valid JSON, no other text
- Be PRECISE - these coordinates will be used for automated cropping`;
}
