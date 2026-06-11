/**
 * Unified AI Card Grading Analysis
 *
 * MERGED FROM:
 * - ai-analyze.js (Replicate path)
 * - ai-analyze-direct.js (Direct Anthropic path)
 *
 * This single endpoint handles both paths based on the 'mode' parameter:
 * - mode: 'direct' → Direct Anthropic API (default, recommended)
 * - mode: 'replicate' → Legacy Replicate path
 *
 * FREES UP: 1 Vercel serverless function slot
 */

import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Legacy Replicate model (if still needed)
const CLAUDE_MODEL = 'anthropic/claude-4-sonnet';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
  maxDuration: 90,
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
    // Mode selection
    mode = 'direct',  // 'direct' | 'replicate'

    // Direct mode params (URLs)
    frontUrl,
    backUrl,

    // Replicate mode params (base64)
    image,
    isStitched = false,

    // Common params
    cardType = 'pokemon',
    frontCentering,
    backCentering
  } = req.body;

  // Check if we have pre-calculated centering
  const hasSoftwareCentering = frontCentering?.lrRatio != null && backCentering?.lrRatio != null;

  // ═══════════════════════════════════════════════════════════════════════════
  // DIRECT ANTHROPIC PATH (default, recommended)
  // ═══════════════════════════════════════════════════════════════════════════
  if (mode === 'direct') {
    if (!frontUrl) {
      return res.status(400).json({ error: 'Missing frontUrl for direct mode' });
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
      const hasBack = !!backUrl;
      const centeringData = hasSoftwareCentering
        ? { front: frontCentering, back: backCentering }
        : null;

      const prompt = hasBack
        ? buildStitchedGradingPrompt(cardType, centeringData)
        : buildSingleGradingPrompt(cardType, centeringData);

      console.log('[AI-Unified] Direct mode:', {
        front: frontUrl.substring(0, 50) + '...',
        back: backUrl ? backUrl.substring(0, 50) + '...' : 'none',
        hasSoftwareCentering,
      });

      // Build message content with images
      const content = [];
      content.push({
        type: 'image',
        source: { type: 'url', url: frontUrl },
      });

      if (backUrl) {
        content.push({
          type: 'image',
          source: { type: 'url', url: backUrl },
        });
      }

      content.push({ type: 'text', text: prompt });

      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 6000,
        temperature: 0.1,
        messages: [{ role: 'user', content }],
      });

      const textContent = response.content.find(c => c.type === 'text');
      if (!textContent) {
        throw new Error('No text response from Claude');
      }

      const text = textContent.text;
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return res.status(500).json({
          error: 'No JSON in response',
          response: text.substring(0, 1000),
        });
      }

      let analysis;
      try {
        analysis = JSON.parse(jsonMatch[0]);
      } catch (parseError) {
        return res.status(500).json({
          error: 'Failed to parse JSON',
          parseError: parseError.message,
        });
      }

      console.log('[AI-Unified] Direct mode complete:', {
        card: analysis.cardInfo?.name,
        psa: analysis.grades?.psa?.grade,
      });

      return res.status(200).json({
        success: true,
        analysis,
        model: 'claude-sonnet-4-20250514',
        mode: 'direct',
      });

    } catch (error) {
      console.error('[AI-Unified] Direct mode error:', error);

      if (error.status === 401) {
        return res.status(500).json({ error: 'Invalid Anthropic API key' });
      }
      if (error.status === 429) {
        return res.status(429).json({ error: 'Rate limited - please try again' });
      }
      if (error.message?.includes('Could not download image')) {
        return res.status(400).json({ error: 'Claude could not access the image URLs' });
      }

      return res.status(500).json({
        error: 'Analysis failed',
        message: error.message,
      });
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // REPLICATE PATH (legacy)
  // ═══════════════════════════════════════════════════════════════════════════
  if (mode === 'replicate') {
    const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;

    if (!REPLICATE_API_TOKEN) {
      return res.status(500).json({
        error: 'Replicate API not configured',
        message: 'Server missing REPLICATE_API_TOKEN'
      });
    }

    if (!image) {
      return res.status(400).json({ error: 'No image provided for replicate mode' });
    }

    try {
      console.log('[AI-Unified] Replicate mode:', {
        isStitched,
        cardType,
        imageSize: Math.round(image.length / 1024) + 'KB',
      });

      const prompt = isStitched
        ? buildStitchedGradingPrompt(cardType, null)
        : buildSingleGradingPrompt(cardType, null);

      const apiUrl = `https://api.replicate.com/v1/models/${CLAUDE_MODEL}/predictions`;

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
            max_tokens: 6000,
            temperature: 0.1,
          }
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return res.status(500).json({
          error: 'Replicate API error',
          status: response.status,
          details: errorText.substring(0, 500),
        });
      }

      let prediction = await response.json();

      if (prediction.status === 'starting' || prediction.status === 'processing') {
        prediction = await pollForResult(prediction.urls.get, REPLICATE_API_TOKEN);
      }

      if (prediction.status !== 'succeeded') {
        return res.status(500).json({
          error: 'Claude analysis failed',
          status: prediction.status,
          details: prediction.error,
        });
      }

      const text = Array.isArray(prediction.output)
        ? prediction.output.join('')
        : prediction.output;

      if (!text) {
        return res.status(500).json({ error: 'Empty response from Claude' });
      }

      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return res.status(500).json({
          error: 'No JSON in response',
          response: text.substring(0, 1000),
        });
      }

      let analysis;
      try {
        analysis = JSON.parse(jsonMatch[0]);
      } catch (parseError) {
        return res.status(500).json({
          error: 'Failed to parse JSON',
          parseError: parseError.message,
        });
      }

      return res.status(200).json({
        success: true,
        analysis,
        model: CLAUDE_MODEL,
        mode: 'replicate',
      });

    } catch (error) {
      console.error('[AI-Unified] Replicate mode error:', error);
      return res.status(500).json({
        error: 'Analysis failed',
        message: error.message,
      });
    }
  }

  // Unknown mode
  return res.status(400).json({ error: `Unknown mode: ${mode}. Use 'direct' or 'replicate'` });
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

async function pollForResult(url, token, maxAttempts = 45) {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(r => setTimeout(r, 2000));

    try {
      const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (!response.ok) continue;

      const prediction = await response.json();

      if (prediction.status === 'succeeded' || prediction.status === 'failed') {
        return prediction;
      }

      console.log(`[AI-Unified] Poll ${i + 1}/${maxAttempts}: ${prediction.status}`);
    } catch (e) {
      console.error(`[AI-Unified] Poll ${i + 1} failed:`, e.message);
    }
  }

  return { status: 'failed', error: 'Timeout (90s)' };
}

/**
 * Grading prompt for BOTH front and back images
 */
function buildStitchedGradingPrompt(cardType, centeringData = null) {
  let centeringSection;
  if (centeringData) {
    const { front, back } = centeringData;
    const fDevLR = Math.abs(50 - front.lrRatio).toFixed(1);
    const fDevTB = Math.abs(50 - front.tbRatio).toFixed(1);
    const bDevLR = Math.abs(50 - back.lrRatio).toFixed(1);
    const bDevTB = Math.abs(50 - back.tbRatio).toFixed(1);

    centeringSection = `## CENTERING DATA (PRE-MEASURED - USE THESE EXACT VALUES)

═══════════════════════════════════════════════════════════════════════════════
FRONT: ${front.lrRatio.toFixed(1)}/${(100 - front.lrRatio).toFixed(1)} L/R (${fDevLR}% dev) | ${front.tbRatio.toFixed(1)}/${(100 - front.tbRatio).toFixed(1)} T/B (${fDevTB}% dev)
BACK:  ${back.lrRatio.toFixed(1)}/${(100 - back.lrRatio).toFixed(1)} L/R (${bDevLR}% dev) | ${back.tbRatio.toFixed(1)}/${(100 - back.tbRatio).toFixed(1)} T/B (${bDevTB}% dev)
═══════════════════════════════════════════════════════════════════════════════

⚠️ THESE ARE PIXEL-MEASURED VALUES. Use them directly - do NOT re-estimate centering.`;
  } else {
    centeringSection = `## TASK 1: MEASURE CENTERING (CRITICAL)

**Step-by-step:**
For each side (Front L/R, Front T/B, Back L/R, Back T/B):
1. Look at both borders carefully
2. Ask: "Which border is visibly WIDER?"
3. Estimate HOW MUCH wider
4. Do NOT round toward 50/50 - be aggressive`;
  }

  return `You are an expert Pokemon trading card grader.

## TAG GRADE HIERARCHY:
- 10 PRISTINE (985-1000) = PERFECT
- 10 GEM MINT (950-984) = Near perfect
- 9.5 GEM MINT (925-949) = Excellent
- 9 MINT (900-924) = Great condition
- 8.5 NM-MT+ (875-899) = Light wear
- 8 NM-MT (850-874) = Noticeable minor wear
- 7.5 NM+ (800-849) = Clear wear
- 7 NM (750-799) = Obvious wear
- 6.5 EX-MT+ (700-749) = Significant wear
- 6 EX-MT (650-699) = Heavy wear

## IMAGE LAYOUT
- IMAGE 1: Card FRONT
- IMAGE 2: Card BACK

${centeringSection}

## CONDITION ASSESSMENT
Examine CORNERS, EDGES, SURFACE for defects.
Score each 1-10. List all defects found.

**GLARE vs DEFECTS:** Glare is bright reflections - NOT defects. Whitening shows exposed paper fibers along edges/corners.

## RESPONSE FORMAT - Return ONLY this JSON:

{
  "cardInfo": { "name": "", "hp": "", "cardNumber": "", "setName": "", "rarity": "", "year": "", "variant": null, "language": "English" },
  "centering": {
    "front": { "leftRight": "50.0/50.0", "topBottom": "50.0/50.0" },
    "back": { "leftRight": "50.0/50.0", "topBottom": "50.0/50.0" }
  },
  "condition": { "corners": 9.5, "edges": 9.0, "surface": 9.5, "defects": [] },
  "grades": {
    "psa": { "grade": 9, "label": "Mint", "confidence": 0.85, "notes": "" },
    "bgs": { "grade": 9.5, "label": "Gem Mint", "confidence": 0.80, "subgrades": { "centering": 9.5, "corners": 9.5, "edges": 9.0, "surface": 9.5 }, "notes": "" },
    "sgc": { "grade": 9.5, "label": "Mint+", "confidence": 0.85, "notes": "" },
    "cgc": { "grade": 9.5, "label": "Mint+", "confidence": 0.80, "notes": "" },
    "tag": { "score": 955, "grade": 10, "label": "Gem Mint", "confidence": 0.85, "subgrades": { "frontCentering": 118, "backCentering": 120, "frontCorners": 120, "backCorners": 118, "frontEdges": 115, "backEdges": 120, "frontSurface": 122, "backSurface": 122 }, "notes": "" }
  },
  "summary": { "positives": [], "concerns": [], "recommendation": "" }
}

Return ONLY valid JSON.`;
}

/**
 * Grading prompt for SINGLE card (front only)
 */
function buildSingleGradingPrompt(cardType, centeringData = null) {
  let centeringSection;
  if (centeringData?.front) {
    const { front } = centeringData;
    const fDevLR = Math.abs(50 - front.lrRatio).toFixed(1);
    const fDevTB = Math.abs(50 - front.tbRatio).toFixed(1);
    centeringSection = `## CENTERING DATA (PRE-MEASURED)
FRONT: ${front.lrRatio.toFixed(1)}/${(100 - front.lrRatio).toFixed(1)} L/R (${fDevLR}% dev) | ${front.tbRatio.toFixed(1)}/${(100 - front.tbRatio).toFixed(1)} T/B (${fDevTB}% dev)`;
  } else {
    centeringSection = `## TASK 1: MEASURE CENTERING
- Left/Right ratio with one decimal
- Top/Bottom ratio with one decimal`;
  }

  return `You are an expert trading card grader. Analyze this ${cardType} card FRONT image.

${centeringSection}

## CONDITION (1-10 scale): Corners, Edges, Surface

## RESPONSE FORMAT - Return ONLY JSON:

{
  "cardInfo": { "name": "", "hp": "", "cardNumber": "", "setName": "", "rarity": "", "year": "", "variant": null, "language": "English" },
  "centering": { "front": { "leftRight": "50.0/50.0", "topBottom": "50.0/50.0" }, "back": null },
  "condition": { "corners": 9.5, "edges": 9.0, "surface": 9.5, "defects": [] },
  "grades": {
    "psa": { "grade": 9, "label": "Mint", "confidence": 0.85, "notes": "" },
    "bgs": { "grade": 9.5, "label": "Gem Mint", "confidence": 0.80, "subgrades": { "centering": 9.5, "corners": 9.5, "edges": 9.0, "surface": 9.5 }, "notes": "" },
    "sgc": { "grade": 9.5, "label": "Mint+", "confidence": 0.85, "notes": "" },
    "cgc": { "grade": 9.5, "label": "Mint+", "confidence": 0.80, "notes": "" },
    "tag": { "score": 955, "grade": 10, "label": "Gem Mint", "confidence": 0.85, "subgrades": { "frontCentering": 118, "backCentering": null, "frontCorners": 120, "backCorners": null, "frontEdges": 115, "backEdges": null, "frontSurface": 122, "backSurface": null }, "notes": "" }
  },
  "summary": { "positives": [], "concerns": [], "recommendation": "" }
}

Return ONLY valid JSON.`;
}
