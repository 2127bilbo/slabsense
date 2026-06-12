/**
 * Deep AI Grade V3 - Multi-Provider Two-Pass DETECTION + Engine Grading
 *
 * REWRITTEN for the grading engine (GRADING_SCALE.md / AI_WIRING.md):
 *   AI detects + classifies defects. gradingEngine.js computes ALL scores.
 *   Shares its prompt with ai-analyze-unified.js via api/_lib/detectionPrompt.js.
 *
 * Pass 1: Full defect detection → engine computes a DETERMINISTIC estimated
 *         grade (no more AI grade-range guessing) → reference query
 * Pass 2: Re-detection with Pass 1 findings + TAG-graded reference cards for
 *         severity calibration → engine computes the final grade
 *
 * Providers: claude (default) | gemini | gpt | grok
 * Modes:     single | parallel | sequential | synthesize
 *
 * BEHAVIOR CHANGE: manual centering (front + back) is now REQUIRED.
 * The AI never estimates centering (forbidden behavior #2).
 */

import { createClient } from '@supabase/supabase-js';
import {
  callProvider,
  PROVIDERS,
  MODES,
} from './_providers/index.js';
import {
  DETECTION_SYSTEM,
  buildDetectionPrompt,
  parseDetection,
  sanitizeDefects,
  assembleUnifiedOutput,
} from './_lib/detectionPrompt.js';
import { gradeCard } from '../src/lib/gradingEngine.js';

// ═══════════════════════════════════════════════════════════════════════════
// MULTI-PROVIDER CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════
const DEFAULT_CONFIG = {
  mode: MODES.SINGLE,
  primary: PROVIDERS.CLAUDE,
  secondary: null,
  synthesizer: null,
};

// NOTE: service-role key strongly preferred. The anon-key fallback only works
// if RLS on graded_references allows anon SELECT — see AI_WIRING.md §6.
const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY
);

// ============================================================================
// Helper: Format reference cards for the prompt
// ============================================================================
function formatReferences(references) {
  if (!references.length) return null;
  return references.map((ref, i) => {
    const defectList = ref.defect_details?.map((d) => `${d.type} (${d.location})`).join(', ') || 'None noted';
    const adjustedNote = ref.is_adjusted
      ? '\n⚠ HUMAN-ADJUSTED GRADE: a TAG grader manually set this grade because the automated defect list UNDERSTATES the true damage (usually catastrophic damage like paper loss or creasing). Do NOT calibrate severity from this card\'s defect count.'
      : '';
    return `
REFERENCE ${i + 1}: ${ref.grade} (Score: ${ref.score || 'N/A'})
Card: ${ref.card_name} | Type: ${ref.card_type}
Centering: Front ${ref.centering_front_lr?.toFixed(1) || '?'}% LR / ${ref.centering_front_tb?.toFixed(1) || '?'}% TB, Back ${ref.centering_back_lr?.toFixed(1) || '?'}% LR / ${ref.centering_back_tb?.toFixed(1) || '?'}% TB
Defects: ${ref.defect_count} total (${ref.corner_defects} corner, ${ref.edge_defects} edge, ${ref.surface_defects} surface)
Details: ${defectList}${adjustedNote}`;
  }).join('\n');
}

// ============================================================================
// Helper: Query Reference Cards from Supabase
// ============================================================================
async function getReferences(estimatedGrade, cardType = 'modern_holo') {
  // Grade bands for querying
  const gradeBands = {
    10: [10], 9.5: [10, 9], 9: [10, 9, 8.5], 8.5: [9, 8.5, 8],
    8: [9, 8.5, 8, 7.5], 7.5: [8.5, 8, 7.5, 7], 7: [8, 7.5, 7, 6.5],
    6.5: [7.5, 7, 6.5, 6], 6: [7, 6.5, 6, 5], 5: [6, 5, 4],
    4: [5, 4, 3], 3: [4, 3, 2], 2: [3, 2, 1], 1: [2, 1],
  };

  const targetGrades = [...(gradeBands[Math.round(estimatedGrade * 2) / 2] || gradeBands[Math.round(estimatedGrade)] || gradeBands[8])];

  // Always include a 10 as ceiling anchor (no duplicates)
  if (!targetGrades.includes(10)) {
    targetGrades.unshift(10);
  }

  const references = [];

  for (const grade of targetGrades) {
    const { data, error } = await supabase
      .from('graded_references')
      .select('*')
      .eq('grade_numeric', grade)
      .order('defect_count', { ascending: true })
      .limit(3);

    if (error) {
      console.error('[DeepAnalyzeV3] Reference query error for grade', grade, ':', error.message);
      continue;
    }
    if (data && data.length > 0) {
      const sameType = data.filter((d) => d.card_type === cardType);
      const toAdd = sameType.length > 0 ? sameType.slice(0, 2) : data.slice(0, 2);
      references.push(...toAdd);
    }
    if (references.length >= 7) break;
  }

  if (references.length === 0) {
    console.warn('[DeepAnalyzeV3] ⚠️ NO references found — Pass 2 runs without severity anchors. Check graded_references table / RLS.');
  }

  return references.slice(0, 7);
}

// ============================================================================
// Helper: detection result → engine preview (deterministic grade per provider)
// ============================================================================
function enginePreview(detection, centering) {
  try {
    const defects = sanitizeDefects(detection?.defects);
    const r = gradeCard({ defects, centering });
    return { grade: r.overall.grade, displayGrade: r.overall.displayGrade, score: r.companyGrades.tag.score, defectCount: r.defects.counts.total };
  } catch (e) {
    return { error: e.message };
  }
}

// ============================================================================
// Main Handler
// ============================================================================
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
    // Image URLs
    frontOriginalUrl,
    backOriginalUrl,
    frontCroppedUrl,
    backCroppedUrl,
    frontUrl,
    backUrl,
    cardGame = 'pokemon',
    cardType = 'modern_holo',
    // Software-calculated centering (REQUIRED)
    frontCentering, // { lrRatio, tbRatio }
    backCentering,  // { lrRatio, tbRatio }

    // Multi-provider options
    gradeMode = DEFAULT_CONFIG.mode,            // 'single' | 'parallel' | 'sequential' | 'synthesize'
    primaryProvider = DEFAULT_CONFIG.primary,    // 'claude' | 'gemini' | 'gpt' | 'grok'
    secondaryProvider = DEFAULT_CONFIG.secondary,
    synthesizerProvider = DEFAULT_CONFIG.synthesizer,
  } = req.body;

  // Validate provider selection
  const validProviders = Object.values(PROVIDERS);
  if (!validProviders.includes(primaryProvider)) {
    return res.status(400).json({
      error: `Invalid primaryProvider: ${primaryProvider}. Valid: ${validProviders.join(', ')}`,
    });
  }

  // ── Manual centering is REQUIRED (AI never estimates centering) ──────────
  const hasSoftwareCentering =
    frontCentering?.lrRatio != null && frontCentering?.tbRatio != null &&
    backCentering?.lrRatio != null && backCentering?.tbRatio != null;
  if (!hasSoftwareCentering) {
    return res.status(400).json({
      error: 'Missing manual centering measurements',
      message:
        'frontCentering and backCentering {lrRatio, tbRatio} are required. ' +
        'Run the manual centering tool before requesting a Deep AI grade.',
    });
  }
  const centering = {
    front: { lrRatio: frontCentering.lrRatio, tbRatio: frontCentering.tbRatio },
    back: { lrRatio: backCentering.lrRatio, tbRatio: backCentering.tbRatio },
  };

  // Support both 4-image and 2-image modes
  const has4Images = frontOriginalUrl && backOriginalUrl && frontCroppedUrl && backCroppedUrl;
  const hasLegacy = frontUrl && backUrl;
  if (!has4Images && !hasLegacy) {
    return res.status(400).json({ error: 'Missing image URLs' });
  }
  const imageUrls = has4Images
    ? [frontOriginalUrl, backOriginalUrl, frontCroppedUrl, backCroppedUrl]
    : [frontUrl, backUrl];
  const imageLayout = has4Images
    ? '- IMAGE 1: FRONT (full) · IMAGE 2: BACK (full) · IMAGE 3: FRONT (cropped to card) · IMAGE 4: BACK (cropped to card)'
    : '- IMAGE 1: Card FRONT · IMAGE 2: Card BACK';

  if (gradeMode === 'single' && primaryProvider === 'claude' && !process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
  }

  try {
    console.log('[DeepAnalyzeV3] Starting two-pass detection + engine grading...');
    console.log('[DeepAnalyzeV3] Mode:', gradeMode, '| Primary:', primaryProvider, '| Secondary:', secondaryProvider || 'none');
    const startTime = Date.now();

    // ========================================================================
    // PASS 1: Full defect detection (same shared prompt, no references)
    // ========================================================================
    console.log('[DeepAnalyzeV3] Pass 1: defect detection...');

    const pass1Result = await callProvider(primaryProvider, {
      systemPrompt: DETECTION_SYSTEM,
      userPrompt: buildDetectionPrompt({ cardType, centering, imageLayout }),
      images: imageUrls,
      maxTokens: 1500,
      temperature: 0.1,
    });

    if (!pass1Result.success) {
      console.error('[DeepAnalyzeV3] Pass 1 failed:', pass1Result.error);
      return res.status(500).json({
        error: 'Pass 1 failed: ' + pass1Result.error,
        provider: primaryProvider,
      });
    }

    const pass1Detection = pass1Result.parsed || parseDetection(pass1Result.text);
    if (!pass1Detection) {
      return res.status(500).json({ error: 'Failed to parse Pass 1 detection', raw: pass1Result.text });
    }

    // DETERMINISTIC estimated grade: engine on Pass 1 defects (no AI guessing)
    const pass1Defects = sanitizeDefects(pass1Detection.defects);
    const pass1Engine = gradeCard({ defects: pass1Defects, centering });
    const estimatedGrade = pass1Engine.overall.grade;

    console.log('[DeepAnalyzeV3] Pass 1 result:', {
      card: pass1Detection.cardInfo?.name,
      defects: pass1Defects.length,
      engineEstimate: pass1Engine.overall.displayGrade,
    });

    // ========================================================================
    // QUERY REFERENCES from Supabase (band centered on the engine estimate)
    // ========================================================================
    console.log('[DeepAnalyzeV3] Querying references for grade ~', estimatedGrade);
    const references = await getReferences(estimatedGrade, cardType);
    console.log('[DeepAnalyzeV3] Found', references.length, 'reference cards:',
      references.map((r) => r.grade).join(', '));

    // ========================================================================
    // PASS 2: Refined detection with Pass 1 findings + reference calibration
    // ========================================================================
    console.log('[DeepAnalyzeV3] Pass 2: refined detection...');

    const pass2Options = {
      systemPrompt: DETECTION_SYSTEM,
      userPrompt: buildDetectionPrompt({
        cardType,
        centering,
        imageLayout,
        referencesText: formatReferences(references),
        priorFindings: { imageQuality: pass1Detection.imageQuality, defects: pass1Defects },
      }),
      images: imageUrls,
      maxTokens: 3000,
      temperature: 0.1,
    };

    let finalDetection;
    let multiProviderResults = null;

    // ── MODE: SINGLE (default) ──────────────────────────────────────────────
    if (gradeMode === 'single' || gradeMode === MODES.SINGLE) {
      const pass2Result = await callProvider(primaryProvider, pass2Options);
      if (!pass2Result.success) {
        console.error('[DeepAnalyzeV3] Pass 2 failed:', pass2Result.error);
        return res.status(500).json({
          error: 'Pass 2 failed: ' + pass2Result.error,
          provider: primaryProvider,
        });
      }
      finalDetection = pass2Result.parsed || parseDetection(pass2Result.text);
      if (!finalDetection) {
        return res.status(500).json({ error: 'Failed to parse Pass 2 detection', raw: pass2Result.text });
      }
    }

    // ── MODE: PARALLEL — two providers detect, primary wins, both reported ──
    else if (gradeMode === 'parallel' || gradeMode === MODES.PARALLEL) {
      if (!secondaryProvider) {
        return res.status(400).json({ error: 'Parallel mode requires secondaryProvider' });
      }
      console.log(`[DeepAnalyzeV3] Parallel mode: ${primaryProvider} + ${secondaryProvider}`);

      const [result1, result2] = await Promise.all([
        callProvider(primaryProvider, pass2Options),
        callProvider(secondaryProvider, pass2Options),
      ]);

      const det1 = result1.parsed || parseDetection(result1.text);
      const det2 = result2.parsed || parseDetection(result2.text);

      multiProviderResults = {
        [primaryProvider]: det1 ? { detection: det1, enginePreview: enginePreview(det1, centering) } : null,
        [secondaryProvider]: det2 ? { detection: det2, enginePreview: enginePreview(det2, centering) } : null,
      };
      finalDetection = det1 || det2;
    }

    // ── MODE: SEQUENTIAL — primary detects, secondary verifies/refines ──────
    else if (gradeMode === 'sequential' || gradeMode === MODES.SEQUENTIAL) {
      if (!secondaryProvider) {
        return res.status(400).json({ error: 'Sequential mode requires secondaryProvider' });
      }
      console.log(`[DeepAnalyzeV3] Sequential mode: ${primaryProvider} → ${secondaryProvider}`);

      const result1 = await callProvider(primaryProvider, pass2Options);
      const det1 = result1.parsed || parseDetection(result1.text);

      // Validator gets the primary's defect list as priorFindings to verify
      const result2 = await callProvider(secondaryProvider, {
        ...pass2Options,
        userPrompt: buildDetectionPrompt({
          cardType,
          centering,
          imageLayout,
          referencesText: formatReferences(references),
          priorFindings: det1 ? { imageQuality: det1.imageQuality, defects: sanitizeDefects(det1.defects) } : null,
        }),
      });
      const det2 = result2.parsed || parseDetection(result2.text);

      multiProviderResults = {
        [primaryProvider]: det1 ? { detection: det1, enginePreview: enginePreview(det1, centering) } : null,
        [secondaryProvider]: det2 ? { detection: det2, enginePreview: enginePreview(det2, centering) } : null,
      };
      finalDetection = det2 || det1; // validator's refined list wins
    }

    // ── MODE: SYNTHESIZE — two detect, third merges the defect lists ────────
    else if (gradeMode === 'synthesize' || gradeMode === MODES.SYNTHESIZE) {
      if (!secondaryProvider || !synthesizerProvider) {
        return res.status(400).json({ error: 'Synthesize mode requires secondaryProvider and synthesizerProvider' });
      }
      console.log(`[DeepAnalyzeV3] Synthesize mode: ${primaryProvider} + ${secondaryProvider} → ${synthesizerProvider}`);

      const [result1, result2] = await Promise.all([
        callProvider(primaryProvider, pass2Options),
        callProvider(secondaryProvider, pass2Options),
      ]);
      const det1 = result1.parsed || parseDetection(result1.text);
      const det2 = result2.parsed || parseDetection(result2.text);

      const synthesisPrompt = `Two independent inspectors examined the same card. Merge their defect lists into ONE most-accurate list.

## INSPECTOR 1 (${primaryProvider}):
${JSON.stringify(det1 ? { imageQuality: det1.imageQuality, defects: sanitizeDefects(det1.defects), summary: det1.summary, cardInfo: det1.cardInfo } : null, null, 2)}

## INSPECTOR 2 (${secondaryProvider}):
${JSON.stringify(det2 ? { imageQuality: det2.imageQuality, defects: sanitizeDefects(det2.defects), summary: det2.summary, cardInfo: det2.cardInfo } : null, null, 2)}

## MERGE RULES
1. Same defect reported by both (same side + location + type) → keep ONE entry; on severity disagreement use the MORE SEVERE rating (strict philosophy).
2. Defect reported by only one inspector → keep it UNLESS the other inspector's imageQuality reports glare at that exact location (then it is likely glare — drop it).
3. Never invent defects neither inspector reported. You have no images.
4. Output the SAME detection JSON format (cardInfo, imageQuality, defects, summary) — no grades, no scores.`;

      const synthesisResult = await callProvider(synthesizerProvider, {
        systemPrompt: DETECTION_SYSTEM,
        userPrompt: synthesisPrompt,
        images: [], // text-only merge
        maxTokens: 3000,
        temperature: 0.1,
      });
      const detSynth = synthesisResult.parsed || parseDetection(synthesisResult.text);

      multiProviderResults = {
        [primaryProvider]: det1 ? { detection: det1, enginePreview: enginePreview(det1, centering) } : null,
        [secondaryProvider]: det2 ? { detection: det2, enginePreview: enginePreview(det2, centering) } : null,
        synthesizer: detSynth ? { detection: detSynth, enginePreview: enginePreview(detSynth, centering) } : null,
      };
      finalDetection = detSynth || det1 || det2;
    }

    if (!finalDetection) {
      return res.status(500).json({ error: 'Failed to get final detection from any provider' });
    }

    // ========================================================================
    // ENGINE: all grading math (GRADING_SCALE.md) + unified assembly
    // ========================================================================
    const elapsed = Date.now() - startTime;
    const analysis = assembleUnifiedOutput({
      detection: finalDetection,
      centering,
      gradePath: 'deep',
      meta: {
        model: null,
        gradeMode,
        primaryProvider,
        secondaryProvider: secondaryProvider || null,
        synthesizerProvider: synthesizerProvider || null,
        referencesUsed: references.length,
        referenceGrades: references.map((r) => r.grade),
        elapsedMs: elapsed,
        imageMode: has4Images ? '4-image' : '2-image',
        cardGame,
        cardType,
      },
    });

    console.log('[DeepAnalyzeV3] Complete in', elapsed, 'ms:', {
      card: analysis.cardInfo?.name,
      tagGrade: analysis.overall?.displayGrade,
      defects: analysis.defects?.counts?.total,
      confidence: analysis.confidence?.value,
      mode: gradeMode,
    });

    // ========================================================================
    // Return Response — unified schema + legacy top-level keys
    // ========================================================================
    return res.status(200).json({
      success: true,
      version: 'v3-engine',
      analysis, // ← FULL unified schema (GRADING_OUTPUT_SCHEMA.md) — migrate to this
      passes: {
        quickEstimate: {
          detection: pass1Detection,
          engineEstimate: { grade: pass1Engine.overall.grade, displayGrade: pass1Engine.overall.displayGrade, score: pass1Engine.companyGrades.tag.score },
        },
        referencesUsed: references.length,
        referenceGrades: references.map((r) => r.grade),
      },
      // Legacy-shaped conveniences (see AI_WIRING.md §5 for migration map)
      cardInfo: analysis.cardInfo,
      centering: analysis.centering,
      defects: analysis.defects,
      grades: analysis.companyGrades,
      summary: analysis.summary,
      meta: analysis.meta,
      multiProviderResults,
    });
  } catch (error) {
    console.error('[DeepAnalyzeV3] Error:', error);

    if (error.status === 401) {
      return res.status(500).json({ error: 'Invalid API key' });
    }
    if (error.status === 429) {
      return res.status(429).json({ error: 'Rate limited - please try again' });
    }
    if (error.message?.includes('Could not download image')) {
      return res.status(400).json({ error: 'Could not access image URLs' });
    }

    return res.status(500).json({
      error: 'Analysis failed',
      details: error.message,
    });
  }
}
