/**
 * Unified AI Card Grading Analysis — REWRITTEN for the grading engine
 *
 * ARCHITECTURE (docs/GRADING_SYSTEM.md):
 *   AI detects + classifies defects → gradingEngine.js computes ALL scores
 *   and company grades → response is the unified schema
 *   (output schema in docs/GRADING_SYSTEM.md). The AI never grades.
 *
 * Shares its prompt with deep-analyze-v2.js via api/_lib/detectionPrompt.js
 * — single-pass here, no reference comparison, fastest response.
 *
 * Uses Direct Anthropic API only (Replicate path removed).
 *
 * BEHAVIOR CHANGE: manual centering (frontCentering, at minimum) is now
 * REQUIRED. The AI never estimates centering (forbidden behavior #2).
 * Clients must run the manual centering tool before calling this endpoint.
 */

import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';
import { requireUser, AuthError, sendAuthError } from './_lib/auth.js';
import { runGradeJob, captureHandler } from './_lib/gradeJobs.js';
import {
  DETECTION_SYSTEM,
  buildDetectionPrompt,
  parseDetection,
  assembleUnifiedOutput,
} from './_lib/detectionPrompt.js';
import { parseCornerEdgeInput } from './_lib/cornerEdgeInput.js';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const DIRECT_MODEL = 'claude-opus-4-5-20251101';

export const config = { maxDuration: 120 };

/** The analysis proper. Not exported as the route: see handler() at the bottom. */
async function analyzeHandler(req, res) {
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
    // Direct mode params (URLs)
    frontUrl,
    backUrl,

    // Common params
    cardGame = 'pokemon',
    cardType = 'pokemon',
    frontCentering,
    backCentering,
    // Optional: the browser's corner/edge model table; when present it replaces
    // Claude's corner/edge findings so the paid grade agrees with the free one.
    cornerEdge: cornerEdgeRaw,
  } = req.body;
  const cornerEdge = parseCornerEdgeInput(cornerEdgeRaw);

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
  // DIRECT ANTHROPIC PATH
  // ═══════════════════════════════════════════════════════════════════════════
  if (!frontUrl) {
    return res.status(400).json({ error: 'Missing frontUrl' });
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

    const prompt = buildDetectionPrompt({ cardType, centering, imageLayout, cornerEdge });

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

    // DEBUG: Log AI defects immediately after parsing
    console.log('[AI-Unified] AI defects:', JSON.stringify(detection.defects, null, 2));

    // ── ALL grading math happens here, in the engine ─────────────────────
    const analysis = assembleUnifiedOutput({
      detection,
      centering: { front: centering.front, back: frontOnly ? null : centering.back },
      gradePath: 'ai',
      cornerEdge,
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

// ═════════════════════════════════════════════════════════════════════════════
// PUBLIC HANDLER — auth → spend credit → job row → analysis → result / refund
// (api/_lib/gradeJobs.js). The analysis itself is analyzeHandler above.
// ═════════════════════════════════════════════════════════════════════════════
const jobsDb = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let user;
  try { user = await requireUser({ db: jobsDb }, req); }
  catch (e) { if (e instanceof AuthError) return sendAuthError(res, e); throw e; }

  try {
    const { status, body } = await runGradeJob({
      db: jobsDb, user, gradeType: 'ai', body: req.body || {},
      run: () => captureHandler(analyzeHandler, req),
    });
    return res.status(status).json(body);
  } catch (error) {
    console.error('[AI-Unified] job wrapper error:', error);
    return res.status(500).json({ error: 'Analysis failed', message: error.message });
  }
}
