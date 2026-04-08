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
  maxDuration: 90,
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
    const { image, stitchInfo, cardType = 'pokemon' } = req.body;

    if (!image) {
      return res.status(400).json({ error: 'No image provided' });
    }

    const isStitched = !!stitchInfo;
    console.log('[Claude Vision] Analyzing card via Replicate...');
    console.log('[Claude Vision] Stitched (front+back):', isStitched);
    if (isStitched) {
      console.log(`[Claude Vision] Layout: front=${stitchInfo.frontWidth}px, back=${stitchInfo.backWidth}px`);
    }

    // Build the comprehensive analysis prompt
    const prompt = buildUnifiedPrompt(cardType, isStitched, stitchInfo);

    // Call Claude via Replicate using the models endpoint
    const apiUrl = `https://api.replicate.com/v1/models/${CLAUDE_MODEL}/predictions`;
    console.log('[Claude] Calling:', apiUrl);

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${REPLICATE_API_TOKEN}`,
        'Content-Type': 'application/json',
        'Prefer': 'wait', // Try to get synchronous response if quick
      },
      body: JSON.stringify({
        input: {
          prompt: prompt,
          image: image,
          max_tokens: 4096,
          temperature: 0.1, // Low temperature for consistent structured output
        }
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Replicate API error:', response.status, errorText);

      // Try to parse error for better message
      let errorDetail = errorText;
      try {
        const errorJson = JSON.parse(errorText);
        errorDetail = errorJson.detail || errorJson.error || errorText;
      } catch (e) {}

      return res.status(response.status).json({
        error: 'Replicate API error',
        details: errorDetail,
        status: response.status
      });
    }

    let prediction = await response.json();
    console.log('[Claude] Prediction created:', prediction.id, 'Status:', prediction.status);

    // Poll for completion if not already done
    if (prediction.status === 'starting' || prediction.status === 'processing') {
      prediction = await pollForResult(prediction.urls.get, REPLICATE_API_TOKEN);
    }

    if (prediction.status === 'failed') {
      console.error('[Claude] Prediction failed:', prediction.error);
      return res.status(500).json({
        error: prediction.error || 'Claude processing failed',
        status: prediction.status
      });
    }

    if (prediction.status !== 'succeeded') {
      return res.status(500).json({
        error: `Unexpected status: ${prediction.status}`,
        prediction
      });
    }

    // Parse Claude's response
    const responseText = Array.isArray(prediction.output)
      ? prediction.output.join('')
      : (typeof prediction.output === 'string' ? prediction.output : JSON.stringify(prediction.output));

    console.log('[Claude] Response length:', responseText?.length);
    console.log('[Claude] Response preview:', responseText?.substring(0, 300));

    // Extract JSON from response
    let analysisResult = null;
    try {
      // Try to find JSON in the response
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        analysisResult = JSON.parse(jsonMatch[0]);
        console.log('[Claude] Successfully parsed JSON response');
      } else {
        console.warn('[Claude] No JSON found in response');
        analysisResult = { raw: responseText, parseError: 'No JSON found' };
      }
    } catch (parseError) {
      console.error('[Claude] JSON parse error:', parseError.message);
      analysisResult = { raw: responseText, parseError: parseError.message };
    }

    // Include stitch info in response so client can split coordinates
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

function buildUnifiedPrompt(cardType, isStitched, stitchInfo) {
  // Build layout description for stitched images
  const layoutDesc = isStitched
    ? `
**IMAGE LAYOUT:** This image contains TWO cards side-by-side:
- LEFT SIDE (x: 0 to ${stitchInfo?.frontWidth || 'half'}): FRONT of the card
- RIGHT SIDE (x: ${stitchInfo?.frontWidth || 'half'} to end): BACK of the card

You MUST provide bounding boxes for BOTH cards. All coordinates are ABSOLUTE (relative to the full image).`
    : '';

  const responseFormat = isStitched
    ? `{
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
  "back": {
    "boundingBox": {
      "topLeft": {"x": 400, "y": 28},
      "topRight": {"x": 700, "y": 30},
      "bottomLeft": {"x": 398, "y": 478},
      "bottomRight": {"x": 698, "y": 480}
    },
    "rotationAngle": -0.3,
    "borders": {"left": 14, "right": 16, "top": 13, "bottom": 15},
    "centeringLR": "47/53",
    "centeringTB": "48/52"
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
}`
    : `{
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
}`;

  return `You are an expert trading card analyst and professional grader. Analyze this ${cardType} card image with EXTREME PRECISION.
${layoutDesc}

## YOUR TASKS:

### 1. CARD BOUNDARY DETECTION
Find the EXACT card boundaries in the image. The card(s) may be rotated or tilted.
- Identify all 4 corners of ${isStitched ? 'EACH card' : 'the card'} precisely (in pixels)
- Calculate the rotation angle needed to make ${isStitched ? 'each card' : 'the card'} perfectly straight
- All coordinates are ABSOLUTE pixel positions from the top-left of the image

### 2. CENTERING ANALYSIS
Measure the border widths on all 4 sides (space between card edge and printed area):
- Left, Right, Top, Bottom border widths in pixels
- Calculate centering ratios (e.g., "60/40" for left-right)
${isStitched ? '- Do this for BOTH front and back cards' : ''}

### 3. CARD INFORMATION (OCR) - From the FRONT
- Pokemon/Character name
- HP value
- Card number (e.g., "025/198" or "SV049")
- Set name, Rarity, Year, Special variants

### 4. CONDITION ASSESSMENT
Score each category 1-10 (10 = perfect):
- Corners, Edges, Surface, Centering
${isStitched ? '- Assess BOTH sides of the card' : ''}

**CRITICAL - IGNORE PHOTOGRAPHIC ARTIFACTS:**
- DO NOT count glare, reflections, or lighting as defects
- DO NOT count camera flash spots or shine as surface issues
- ONLY count ACTUAL PHYSICAL defects on the card
- Holo reflections are NOT damage

### 5. GRADING NOTES
- List positives and concerns
- Estimated grade (1-10 scale)

## RESPONSE FORMAT - Return ONLY this JSON:

${responseFormat}

CRITICAL RULES:
- All coordinates are in PIXELS (absolute from image top-left)
- Rotation angle in DEGREES (positive = clockwise needed)
- Return ONLY valid JSON, no other text
- Be PRECISE - coordinates are used for automated cropping
${isStitched ? '- MUST include both "front" and "back" bounding boxes' : ''}`;
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
