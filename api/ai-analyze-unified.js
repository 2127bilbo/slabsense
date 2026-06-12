/**
 * Unified AI Card Grading Analysis — REWRITTEN for the grading engine
 *
 * ARCHITECTURE (GRADING_SCALE.md / AI_WIRING.md):
 *   AI detects + classifies defects → gradingEngine.js computes ALL scores
 *   and company grades → response is the unified schema
 *   (GRADING_OUTPUT_SCHEMA.md). The AI never grades.
 *
 * Shares its prompt with deep-analyze-v2.js via api/_lib/detectionPrompt.js
 * — single-pass here, no reference comparison, fastest response.
 *
 * Modes preserved from previous version:
 * - mode: 'direct'    → Direct Anthropic API (default, recommended)
 * - mode: 'replicate' → Legacy Replicate path
 *
 * BEHAVIOR CHANGE: manual centering (frontCentering, at minimum) is now
 * REQUIRED. The AI never estimates centering (forbidden behavior #2).
 * Clients must run the manual centering tool before calling this endpoint.
 */

import Anthropic from '@anthropic-ai/sdk';
import {
  DETECTION_SYSTEM,
  buildDetectionPrompt,
  parseDetection,
  assembleUnifiedOutput,
} from './_lib/detectionPrompt.js';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const DIRECT_MODEL = 'claude-sonnet-4-20250514';
// TODO: verify current Replicate model slug before relying on replicate mode
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
    mode = 'direct', // 'direct' | 'replicate'

    // Direct mode params (URLs)
    frontUrl,
    backUrl,

    // Replicate mode params (base64)
    image,
    isStitched = false,

    // Common params
    cardGame = 'pokemon',
    cardType = 'pokemon',
    frontCentering,
    backCentering,
  } = req.body;

  // ── Manual centering is REQUIRED (AI never estimates centering) ──────────
  if (frontCentering?.lrRatio == null || frontCentering?.tbRatio == null) {
    return res.status(400).json({
      error: 'Missing manual centering measurements',
      message:
        'frontCentering {lrRatio, tbRatio} is required (backCentering too unless grading front-only). ' +
        'Run the manual centering tool before requesting an AI grade.',
    });
  }
  const hasBackCentering = backCentering?.lrRatio != null && backCentering?.tbRatio != null;

  const centering = {
    front: { lrRatio: frontCentering.lrRatio, tbRatio: frontCentering.tbRatio },
    back: hasBackCentering ? { lrRatio: backCentering.lrRatio, tbRatio: backCentering.tbRatio } : null,
  };

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

    const hasBack = !!backUrl;
    const frontOnly = !hasBack;
    if (hasBack && !hasBackCentering) {
      return res.status(400).json({
        error: 'Missing backCentering',
        message: 'Back image provided but backCentering {lrRatio, tbRatio} is missing.',
      });
    }

    try {
      const startTime = Date.now();
      const imageLayout = hasBack
        ? '- IMAGE 1: Card FRONT\n- IMAGE 2: Card BACK'
        : '- IMAGE 1: Card FRONT (front-only grading — no back inspection possible)';

      const prompt = buildDetectionPrompt({ cardType, centering, imageLayout });

      console.log('[AI-Unified] Direct mode:', {
        front: frontUrl.substring(0, 50) + '...',
        back: backUrl ? backUrl.substring(0, 50) + '...' : 'none',
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
        model: DIRECT_MODEL,
        max_tokens: 3000,
        temperature: 0.1,
        system: DETECTION_SYSTEM,
        messages: [{ role: 'user', content }],
      });

      const textContent = response.content.find((c) => c.type === 'text');
      if (!textContent) {
        throw new Error('No text response from Claude');
      }

      const detection = parseDetection(textContent.text);
      if (!detection) {
        return res.status(500).json({
          error: 'No JSON in response',
          response: textContent.text.substring(0, 1000),
        });
      }

      // ── ALL grading math happens here, in the engine ─────────────────────
      const analysis = assembleUnifiedOutput({
        detection,
        centering: { front: centering.front, back: frontOnly ? null : centering.back },
        gradePath: 'ai',
        frontOnly,
        meta: {
          model: DIRECT_MODEL,
          gradeMode: 'single',
          primaryProvider: 'claude',
          secondaryProvider: null,
          synthesizerProvider: null,
          referencesUsed: 0,
          referenceGrades: [],
          elapsedMs: Date.now() - startTime,
          cardGame,
          cardType,
        },
      });

      console.log('[AI-Unified] Direct mode complete:', {
        card: analysis.cardInfo?.name,
        tag: analysis.overall?.displayGrade,
        defects: analysis.defects?.counts?.total,
      });

      return res.status(200).json({
        success: true,
        analysis,
        model: DIRECT_MODEL,
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
        message: 'Server missing REPLICATE_API_TOKEN',
      });
    }

    if (!image) {
      return res.status(400).json({ error: 'No image provided for replicate mode' });
    }

    try {
      const startTime = Date.now();
      console.log('[AI-Unified] Replicate mode:', {
        isStitched,
        cardType,
        imageSize: Math.round(image.length / 1024) + 'KB',
      });

      const imageLayout = isStitched
        ? '- ONE stitched image: card FRONT on the left, card BACK on the right'
        : '- ONE image: card FRONT only (front-only grading)';
      const frontOnly = !isStitched;

      const prompt = `${DETECTION_SYSTEM}\n\n${buildDetectionPrompt({ cardType, centering, imageLayout })}`;

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
            max_tokens: 3000,
            temperature: 0.1,
          },
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

      const detection = parseDetection(text);
      if (!detection) {
        return res.status(500).json({
          error: 'No JSON in response',
          response: text.substring(0, 1000),
        });
      }

      const analysis = assembleUnifiedOutput({
        detection,
        centering: { front: centering.front, back: frontOnly ? null : centering.back },
        gradePath: 'ai',
        frontOnly,
        meta: {
          model: CLAUDE_MODEL,
          gradeMode: 'single',
          primaryProvider: 'claude',
          secondaryProvider: null,
          synthesizerProvider: null,
          referencesUsed: 0,
          referenceGrades: [],
          elapsedMs: Date.now() - startTime,
          cardGame,
          cardType,
        },
      });

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
    await new Promise((r) => setTimeout(r, 2000));

    try {
      const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${token}` },
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
