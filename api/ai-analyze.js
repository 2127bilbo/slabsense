/**
 * Unified AI Card Analysis via Claude Sonnet 4 on Replicate
 *
 * Analyzes front and back card images in parallel:
 * - Card boundary detection with precise coordinates
 * - Rotation angle detection
 * - Centering analysis
 * - Card info extraction (OCR) from front
 * - Condition assessment
 *
 * Cost: ~$0.02-0.05 per card
 */

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
  maxDuration: 120,
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
    const {
      frontImage,
      backImage,
      frontDimensions,
      backDimensions,
      cardType = 'pokemon'
    } = req.body;

    if (!frontImage) {
      return res.status(400).json({ error: 'No front image provided' });
    }

    console.log('[Claude] Starting card analysis...');
    console.log('[Claude] Front dimensions:', frontDimensions);
    console.log('[Claude] Has back image:', !!backImage);
    if (backDimensions) console.log('[Claude] Back dimensions:', backDimensions);

    const apiUrl = `https://api.replicate.com/v1/models/${CLAUDE_MODEL}/predictions`;

    // Helper to call Claude
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
        console.error(`[Claude] ${label} API error:`, response.status, errorText);
        throw new Error(`API error: ${response.status}`);
      }

      let prediction = await response.json();
      console.log(`[Claude] ${label} prediction ID:`, prediction.id, 'status:', prediction.status);

      if (prediction.status === 'starting' || prediction.status === 'processing') {
        prediction = await pollForResult(prediction.urls.get, REPLICATE_API_TOKEN);
      }

      if (prediction.status !== 'succeeded') {
        throw new Error(`${label} failed: ${prediction.error || prediction.status}`);
      }

      const text = Array.isArray(prediction.output)
        ? prediction.output.join('')
        : prediction.output;

      console.log(`[Claude] ${label} raw response length:`, text.length);

      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.error(`[Claude] ${label} - No JSON found in response:`, text.substring(0, 500));
        throw new Error(`No JSON in ${label} response`);
      }

      const parsed = JSON.parse(jsonMatch[0]);
      console.log(`[Claude] ${label} analysis complete`);
      return parsed;
    };

    // Build prompts with actual dimensions
    const frontPrompt = buildFrontPrompt(cardType, frontDimensions);
    const backPrompt = backImage && backDimensions ? buildBackPrompt(backDimensions) : null;

    // Run analysis in parallel
    const promises = [analyzeImage(frontImage, frontPrompt, 'Front')];

    if (backImage && backPrompt) {
      promises.push(
        analyzeImage(backImage, backPrompt, 'Back').catch(err => {
          console.error('[Claude] Back analysis failed:', err.message);
          return null;
        })
      );
    }

    console.log(`[Claude] Running ${promises.length} analysis call(s) in parallel...`);
    const results = await Promise.all(promises);

    const frontResult = results[0];
    const backResult = results[1] || null;

    // Merge results
    const analysisResult = {
      ...frontResult,
      back: backResult?.back || null,
    };

    console.log('[Claude] All analysis complete');

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
    });
  }
}

async function pollForResult(url, token, maxAttempts = 60) {
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

  return { status: 'failed', error: 'Timeout waiting for response' };
}

function buildFrontPrompt(cardType, dimensions) {
  const { width, height } = dimensions || { width: 1500, height: 2100 };

  return `You are an expert trading card analyst. Analyze this ${cardType} card FRONT image.

## IMAGE SIZE: ${width} x ${height} pixels

## CRITICAL TASK 1: FIND THE COMPLETE CARD BOUNDARIES

You MUST find where the ENTIRE card is located in this image. The card is a rectangular trading card (2.5 x 3.5 inch aspect ratio = roughly 5:7).

Look for:
- The card's outer edges (the physical card boundary, NOT the printed border inside)
- The card may be tilted/rotated - detect the angle
- The card should take up a LARGE portion of the image (typically 60-90%)

Return PIXEL COORDINATES for all 4 corners of the card:
- topLeft: upper-left corner of the card
- topRight: upper-right corner of the card
- bottomLeft: lower-left corner of the card
- bottomRight: lower-right corner of the card

## TASK 2: CENTERING ANALYSIS
Measure the border widths (space between card edge and printed area inside):
- Calculate centering ratios (e.g., "55/45" means 55% border on left, 45% on right)

## TASK 3: CARD INFORMATION
- Pokemon/Character name, HP, Card number, Set name, Rarity, Year, Variant

## TASK 4: CONDITION ASSESSMENT (1-10 scale)
Score: Corners, Edges, Surface, Centering

**IGNORE PHOTOGRAPHIC ARTIFACTS:**
- Glare, reflections, lighting = NOT defects
- Camera flash, shine = NOT surface issues
- Only count ACTUAL PHYSICAL damage

## RESPONSE FORMAT - Return ONLY this JSON:

{
  "front": {
    "boundingBox": {
      "topLeft": {"x": NUMBER, "y": NUMBER},
      "topRight": {"x": NUMBER, "y": NUMBER},
      "bottomLeft": {"x": NUMBER, "y": NUMBER},
      "bottomRight": {"x": NUMBER, "y": NUMBER}
    },
    "rotationAngle": NUMBER,
    "borders": {"left": NUMBER, "right": NUMBER, "top": NUMBER, "bottom": NUMBER},
    "centeringLR": "50/50",
    "centeringTB": "50/50"
  },
  "cardInfo": {
    "name": "STRING",
    "hp": "STRING",
    "cardNumber": "STRING",
    "setName": "STRING",
    "rarity": "STRING",
    "year": "STRING",
    "variant": "STRING or null",
    "language": "English"
  },
  "condition": {
    "corners": NUMBER,
    "edges": NUMBER,
    "surface": NUMBER,
    "centering": NUMBER,
    "overall": NUMBER,
    "notes": "STRING"
  },
  "gradingNotes": {
    "positives": ["STRING"],
    "concerns": ["STRING"],
    "estimatedGrade": "STRING",
    "confidence": "high/medium/low"
  }
}

CRITICAL RULES:
- The bounding box should encompass the ENTIRE card (typically 60-90% of the image)
- Coordinates are in PIXELS from image top-left (0,0)
- For a ${width}x${height} image, expect card corners to span most of that range
- If the card is tilted, corners won't form a perfect rectangle
- rotationAngle: degrees needed to straighten (positive = clockwise)
- Return ONLY valid JSON`;
}

function buildBackPrompt(dimensions) {
  const { width, height } = dimensions || { width: 1500, height: 2100 };

  return `You are analyzing the BACK of a trading card.

## IMAGE SIZE: ${width} x ${height} pixels

## CRITICAL TASK: FIND THE COMPLETE CARD BOUNDARIES

Find where the ENTIRE card is in this image. This is the back of a trading card showing the standard Pokemon/TCG pattern.

Look for:
- The card's physical outer edges (the full rectangle of the card)
- The card may be tilted/rotated
- The card should take up most of the image (60-90%)

Return PIXEL COORDINATES for all 4 corners:

## CENTERING
Measure border widths on all 4 sides of the back pattern.

## RESPONSE FORMAT - Return ONLY this JSON:

{
  "back": {
    "boundingBox": {
      "topLeft": {"x": NUMBER, "y": NUMBER},
      "topRight": {"x": NUMBER, "y": NUMBER},
      "bottomLeft": {"x": NUMBER, "y": NUMBER},
      "bottomRight": {"x": NUMBER, "y": NUMBER}
    },
    "rotationAngle": NUMBER,
    "borders": {"left": NUMBER, "right": NUMBER, "top": NUMBER, "bottom": NUMBER},
    "centeringLR": "50/50",
    "centeringTB": "50/50"
  }
}

CRITICAL RULES:
- Bounding box should encompass the ENTIRE card (60-90% of image typically)
- Coordinates in PIXELS from image top-left (0,0)
- For ${width}x${height} image, card corners should span most of that
- rotationAngle: degrees to straighten (positive = clockwise)
- IGNORE glare, reflections, shadows - find the PHYSICAL card edges
- Return ONLY valid JSON`;
}
