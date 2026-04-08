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
    const { frontImage, backImage, cardType = 'pokemon' } = req.body;

    if (!frontImage) {
      return res.status(400).json({ error: 'No front image provided' });
    }

    console.log('[Claude Vision] Analyzing card via Replicate...');
    console.log('[Claude Vision] Has back image:', !!backImage);

    // Build the comprehensive analysis prompt
    const prompt = buildUnifiedPrompt(cardType, !!backImage);

    // For Claude on Replicate, we pass the image directly
    // If we have both front and back, we'll describe them in the prompt
    // and pass the front image (Claude can analyze one image at a time on Replicate)

    // Use the front image for analysis
    const imageInput = frontImage;

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
          image: imageInput,
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

    // Analyze back image with a second Claude call if provided
    if (backImage) {
      console.log('[Claude] Analyzing back image...');
      try {
        const backPrompt = buildBackImagePrompt();

        const backResponse = await fetch(apiUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${REPLICATE_API_TOKEN}`,
            'Content-Type': 'application/json',
            'Prefer': 'wait',
          },
          body: JSON.stringify({
            input: {
              prompt: backPrompt,
              image: backImage,
              max_tokens: 2048,
              temperature: 0.1,
            }
          }),
        });

        if (backResponse.ok) {
          let backPrediction = await backResponse.json();

          if (backPrediction.status === 'starting' || backPrediction.status === 'processing') {
            backPrediction = await pollForResult(backPrediction.urls.get, REPLICATE_API_TOKEN);
          }

          if (backPrediction.status === 'succeeded') {
            const backText = Array.isArray(backPrediction.output)
              ? backPrediction.output.join('')
              : backPrediction.output;

            const backJsonMatch = backText.match(/\{[\s\S]*\}/);
            if (backJsonMatch) {
              const backAnalysis = JSON.parse(backJsonMatch[0]);
              analysisResult.back = backAnalysis.back || backAnalysis;
              console.log('[Claude] Back image analyzed successfully');
            }
          }
        }
      } catch (backError) {
        console.error('[Claude] Back image analysis failed:', backError.message);
        // Continue without back analysis - front is more important
      }
    }

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

function buildUnifiedPrompt(cardType, hasBack) {
  return `You are an expert trading card analyst and professional grader. Analyze this ${cardType} card image with EXTREME PRECISION.

${hasBack ? 'NOTE: You are analyzing the FRONT of the card. The back will be analyzed separately.' : ''}

## YOUR TASKS:

### 1. CARD BOUNDARY DETECTION
Find the EXACT card boundaries in the image. The card may be rotated or tilted.
- Identify all 4 corners of the card precisely (in pixels)
- Calculate the rotation angle needed to make the card perfectly straight (degrees)
- Provide the bounding box coordinates

### 2. CENTERING ANALYSIS
Measure the border widths on all 4 sides (space between card edge and printed area):
- Left border width in pixels
- Right border width in pixels
- Top border width in pixels
- Bottom border width in pixels
- Calculate centering ratios (e.g., "60/40" for left-right)

### 3. CARD INFORMATION (OCR)
Read ALL visible text:
- Pokemon/Character name
- HP value
- Card number (e.g., "025/198" or "SV049")
- Set name
- Rarity (Common/Uncommon/Rare/Holo/Ultra Rare/Secret Rare/etc.)
- Year/Copyright
- Special variants (Full Art/Alt Art/Rainbow/Gold/etc.)

### 4. CONDITION ASSESSMENT
Score each category from 1-10 (10 = perfect, 9 = near mint, 8 = light wear, etc.):
- Corners: Check for whitening, bends, dings
- Edges: Check for whitening, chips, roughness
- Surface: Check for scratches, print lines, holo scratches, fingerprints
- Centering: Based on your border measurements

**CRITICAL - IGNORE PHOTOGRAPHIC ARTIFACTS:**
- DO NOT count glare, reflections, or lighting artifacts as defects
- DO NOT count camera flash spots or shine as surface issues
- DO NOT count shadows from photography setup as defects
- ONLY count ACTUAL PHYSICAL defects on the card itself
- If unsure whether something is glare vs a scratch, assume it's glare
- Holo cards will naturally show rainbow reflections - this is NOT damage

### 5. GRADING NOTES
- List 2-3 positive aspects
- List any concerns that would lower the grade
- Provide your estimated grade (1-10 scale)

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
    "borders": {
      "left": 15,
      "right": 18,
      "top": 12,
      "bottom": 14
    },
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
    "notes": "Minor edge whitening on top, slightly off-center to right"
  },
  "gradingNotes": {
    "positives": ["Sharp corners", "Clean holo surface", "No scratches"],
    "concerns": ["Slight off-center to right", "Minor edge wear top"],
    "estimatedGrade": "9.0",
    "confidence": "high"
  }
}

CRITICAL RULES:
- All coordinates are in PIXELS
- Rotation angle is in DEGREES (positive = clockwise needed)
- Return ONLY valid JSON, no other text
- Use null for values you cannot determine
- Be PRECISE - these coordinates will be used for automated cropping`;
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
