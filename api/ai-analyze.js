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
  maxDuration: 60,
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

    // Build the comprehensive analysis prompt
    const prompt = buildUnifiedPrompt(cardType, !!backImage);

    // Prepare images for Claude
    const images = [
      { type: 'image', source: { type: 'url', url: frontImage } }
    ];

    if (backImage) {
      images.push({ type: 'image', source: { type: 'url', url: backImage } });
    }

    // Call Claude via Replicate
    const response = await fetch('https://api.replicate.com/v1/models/' + CLAUDE_MODEL + '/predictions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${REPLICATE_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        input: {
          prompt: prompt,
          images: frontImage.startsWith('data:')
            ? [frontImage, ...(backImage ? [backImage] : [])]
            : undefined,
          image: !frontImage.startsWith('data:') ? frontImage : undefined,
          max_tokens: 2048,
        }
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Replicate API error:', response.status, errorText);
      return res.status(response.status).json({
        error: 'Replicate API error',
        details: errorText
      });
    }

    let prediction = await response.json();
    console.log('[Claude] Prediction started:', prediction.id);

    // Poll for completion
    prediction = await pollForResult(prediction.urls.get, REPLICATE_API_TOKEN);

    if (prediction.status !== 'succeeded') {
      return res.status(500).json({
        error: prediction.error || 'Claude processing failed',
        status: prediction.status
      });
    }

    // Parse Claude's response
    const responseText = Array.isArray(prediction.output)
      ? prediction.output.join('')
      : prediction.output;

    console.log('[Claude] Raw response:', responseText?.substring(0, 500));

    // Extract JSON from response
    let analysisResult = null;
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        analysisResult = JSON.parse(jsonMatch[0]);
      }
    } catch (parseError) {
      console.error('[Claude] JSON parse error:', parseError);
      analysisResult = { raw: responseText };
    }

    return res.status(200).json({
      success: true,
      analysis: analysisResult,
      model: CLAUDE_MODEL,
      predictionId: prediction.id,
    });

  } catch (error) {
    console.error('AI analysis error:', error);
    return res.status(500).json({
      error: 'Analysis failed',
      message: error.message
    });
  }
}

async function pollForResult(url, token, maxAttempts = 30) {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(r => setTimeout(r, 2000));

    const response = await fetch(url, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    const prediction = await response.json();

    if (prediction.status === 'succeeded' || prediction.status === 'failed') {
      return prediction;
    }

    console.log(`[Claude] Polling attempt ${i + 1}/${maxAttempts}, status: ${prediction.status}`);
  }

  return { status: 'failed', error: 'Timeout waiting for Claude response (60s)' };
}

function buildUnifiedPrompt(cardType, hasBack) {
  return `You are an expert trading card analyst and grader. Analyze this card image with EXTREME PRECISION.

${hasBack ? 'You are given TWO images: Image 1 is the FRONT, Image 2 is the BACK of the same card.' : 'Analyze this card image (FRONT side).'}

## YOUR TASKS:

### 1. CARD BOUNDARY DETECTION
Find the EXACT card boundaries in the image. The card may be rotated or tilted.
- Identify all 4 corners of the card precisely
- Calculate the rotation angle needed to make the card perfectly straight
- Measure the bounding box that contains the card

### 2. CENTERING ANALYSIS
Measure the border widths on all 4 sides of the card (the space between card edge and the printed area).
- For FRONT: measure left, right, top, bottom borders in pixels
- ${hasBack ? 'For BACK: measure left, right, top, bottom borders in pixels' : ''}
- Calculate centering ratios (e.g., 60/40 left-right, 55/45 top-bottom)

### 3. CARD INFORMATION (OCR)
Read all visible text on the card:
- Pokemon/Character name
- HP value
- Card number (e.g., "025/198" or "SV049")
- Set name and symbol
- Rarity (common/uncommon/rare/holo/ultra rare/secret rare/etc.)
- Year/Copyright
- Any special variants (Full Art, Alt Art, Rainbow, Gold, etc.)

### 4. CONDITION ASSESSMENT
Examine the card for defects. Score each category 1-10 (10=perfect):
- Corners: Look for whitening, bends, dings
- Edges: Look for whitening, chips, roughness
- Surface: Look for scratches, print lines, holo scratches
- Centering: Based on border measurements

### 5. GRADING NOTES
- List positives (good aspects)
- List concerns (issues that lower grade)
- Estimate overall grade (1-10 scale)

## RESPONSE FORMAT
Return ONLY a JSON object with this EXACT structure:

{
  "front": {
    "boundingBox": {
      "topLeft": {"x": 0, "y": 0},
      "topRight": {"x": 0, "y": 0},
      "bottomLeft": {"x": 0, "y": 0},
      "bottomRight": {"x": 0, "y": 0}
    },
    "rotationAngle": 0,
    "borders": {
      "left": 0,
      "right": 0,
      "top": 0,
      "bottom": 0
    },
    "centeringLR": "50/50",
    "centeringTB": "50/50"
  },
  ${hasBack ? `"back": {
    "boundingBox": {
      "topLeft": {"x": 0, "y": 0},
      "topRight": {"x": 0, "y": 0},
      "bottomLeft": {"x": 0, "y": 0},
      "bottomRight": {"x": 0, "y": 0}
    },
    "rotationAngle": 0,
    "borders": {
      "left": 0,
      "right": 0,
      "top": 0,
      "bottom": 0
    },
    "centeringLR": "50/50",
    "centeringTB": "50/50"
  },` : ''}
  "cardInfo": {
    "name": "Pokemon Name",
    "hp": "100",
    "cardNumber": "025/198",
    "setName": "Set Name",
    "rarity": "Holo Rare",
    "year": "2024",
    "variant": null,
    "language": "English"
  },
  "condition": {
    "corners": 9.5,
    "edges": 9.5,
    "surface": 9.5,
    "centering": 9.5,
    "overall": 9.5,
    "notes": "Brief condition summary"
  },
  "gradingNotes": {
    "positives": ["Sharp corners", "Clean surface"],
    "concerns": ["Slight off-center"],
    "estimatedGrade": "9.5",
    "confidence": "high"
  },
  "imageInfo": {
    "width": 0,
    "height": 0,
    "cardWidthPx": 0,
    "cardHeightPx": 0
  }
}

IMPORTANT:
- All coordinates are in PIXELS relative to the original image dimensions
- Rotation angle is in DEGREES (positive = clockwise rotation needed to straighten)
- Border measurements are in PIXELS
- Be PRECISE - these values will be used for automated cropping
- If you cannot determine a value, use null
- Return ONLY the JSON, no other text`;
}
