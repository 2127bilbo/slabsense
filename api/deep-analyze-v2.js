/**
 * Deep AI Grade V2 - Two-Pass Grading with Reference Comparison
 *
 * Pass 1: Quick estimate from images → Returns grade range
 * Pass 2: Compare against real TAG-graded references for final grade
 *
 * This mimics how human graders work - comparing against known examples.
 */

import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY
);

// ============================================================================
// PASS 1: Quick Estimate Prompt (minimal, fast)
// ============================================================================
const PASS1_SYSTEM = `You are an expert Pokemon card grader. Provide a QUICK initial assessment.
Be conservative - when uncertain, estimate lower rather than higher.`;

const PASS1_PROMPT = `Analyze this Pokemon card and provide a quick grade estimate.

Look at:
1. CENTERING - Compare border widths (left vs right, top vs bottom) for front AND back
2. CORNERS - Any whitening, dings, or wear?
3. EDGES - Any whitening, chips, or damage?
4. SURFACE - Any scratches, print lines, or defects?

Respond with ONLY this JSON (no other text):
{
  "cardName": "Pokemon name",
  "estimatedGrade": 8.5,
  "gradeRange": { "low": 8, "high": 9 },
  "quickAssessment": {
    "centeringFront": "good/moderate/poor",
    "centeringBack": "good/moderate/poor",
    "corners": "clean/minor wear/moderate wear",
    "edges": "clean/minor wear/moderate wear",
    "surface": "clean/minor issues/moderate issues"
  }
}`;

// ============================================================================
// PASS 2: Comparison Grading Prompt
// ============================================================================
const PASS2_SYSTEM = `You are an expert Pokemon card grader performing a detailed comparison analysis.

You will receive:
1. The card images to grade
2. Reference cards that TAG has already graded (with their exact measurements and grades)

Your job: Compare the card to the references and determine where it fits.

GRADING PHILOSOPHY: TAG is STRICT. When uncertain between two grades, choose the LOWER grade.
The references show you exactly what each grade looks like in terms of centering and defects.`;

const buildPass2Prompt = (quickAssessment, references) => {
  // Format reference cards
  const refText = references.map((ref, i) => {
    const defectList = ref.defect_details?.map(d => `${d.type} (${d.location})`).join(', ') || 'None noted';
    return `
REFERENCE ${i + 1}: ${ref.grade} (Score: ${ref.score || 'N/A'})
Card: ${ref.card_name} | Type: ${ref.card_type}
Centering: Front ${ref.centering_front_lr?.toFixed(1) || '?'}% LR / ${ref.centering_front_tb?.toFixed(1) || '?'}% TB, Back ${ref.centering_back_lr?.toFixed(1) || '?'}% LR / ${ref.centering_back_tb?.toFixed(1) || '?'}% TB
Defects: ${ref.defect_count} total (${ref.corner_defects} corner, ${ref.edge_defects} edge, ${ref.surface_defects} surface)
Details: ${defectList}`;
  }).join('\n');

  return `## CARD BEING GRADED
Initial Assessment: Estimated ${quickAssessment.estimatedGrade} (range ${quickAssessment.gradeRange.low}-${quickAssessment.gradeRange.high})
Card: ${quickAssessment.cardName}
Quick Notes:
- Front Centering: ${quickAssessment.quickAssessment.centeringFront}
- Back Centering: ${quickAssessment.quickAssessment.centeringBack}
- Corners: ${quickAssessment.quickAssessment.corners}
- Edges: ${quickAssessment.quickAssessment.edges}
- Surface: ${quickAssessment.quickAssessment.surface}

## REFERENCE CARDS (Confirmed TAG Grades)
${refText}

## YOUR TASK
1. Measure the card's centering precisely (estimate deviation %)
2. Count and categorize all defects
3. Compare to the reference cards above
4. Determine the final TAG grade

Which reference card(s) does this card most closely match in condition?
If it's better than all references shown, it could grade higher.
If it's worse than all references shown, it could grade lower.

Respond with this JSON (no other text):
{
  "cardInfo": {
    "name": "string",
    "setName": "string",
    "cardNumber": "string"
  },
  "centering": {
    "front": { "leftRight": "52.0/48.0", "topBottom": "50.0/50.0", "deviationLR": 4.0, "deviationTB": 0.0 },
    "back": { "leftRight": "54.0/46.0", "topBottom": "51.0/49.0", "deviationLR": 8.0, "deviationTB": 2.0 }
  },
  "defects": {
    "count": 3,
    "corners": 1,
    "edges": 1,
    "surface": 1,
    "details": [
      { "type": "corner wear", "location": "top-left front", "severity": "minor" }
    ]
  },
  "comparison": {
    "closestMatch": "Reference 2 (9 MINT)",
    "reasoning": "Centering matches Reference 2, defect count is similar..."
  },
  "grades": {
    "tag": {
      "grade": 9,
      "label": "MINT",
      "score": 915,
      "confidence": 0.85
    },
    "psa": { "grade": 9, "label": "MINT" },
    "bgs": { "grade": 9, "label": "MINT", "subgrades": { "centering": 9, "corners": 9, "edges": 9, "surface": 9.5 } },
    "cgc": { "grade": 9, "label": "MINT" },
    "sgc": { "grade": 9, "label": "MINT" }
  },
  "summary": {
    "positives": ["Good surface condition", "Corners are clean"],
    "concerns": ["Back centering slightly off"],
    "recommendation": "Submit to TAG or PSA for best result"
  }
}`;
};

// ============================================================================
// Helper: Query Reference Cards from Supabase
// ============================================================================
async function getReferences(estimatedGrade, cardType = 'modern_holo') {
  // Grade bands for querying
  const gradeBands = {
    10: [10],
    9.5: [10, 9],
    9: [10, 9, 8.5],
    8.5: [9, 8.5, 8],
    8: [9, 8.5, 8, 7.5],
    7.5: [8.5, 8, 7.5, 7],
    7: [8, 7.5, 7, 6.5],
    6.5: [7.5, 7, 6.5, 6],
    6: [7, 6.5, 6, 5],
    5: [6, 5, 4],
    4: [5, 4, 3],
    3: [4, 3, 2],
    2: [3, 2, 1],
    1: [2, 1]
  };

  const targetGrades = gradeBands[Math.round(estimatedGrade)] || gradeBands[8];

  // Always include a 10 as ceiling anchor
  if (!targetGrades.includes(10)) {
    targetGrades.unshift(10);
  }

  const references = [];

  // Query 2 cards from each target grade, preferring same card type
  for (const grade of targetGrades) {
    const { data } = await supabase
      .from('graded_references')
      .select('*')
      .eq('grade_numeric', grade)
      .order('defect_count', { ascending: true })
      .limit(3);

    if (data && data.length > 0) {
      // Prefer same card type, but take any if not available
      const sameType = data.filter(d => d.card_type === cardType);
      const toAdd = sameType.length > 0 ? sameType.slice(0, 2) : data.slice(0, 2);
      references.push(...toAdd);
    }

    // Stop at 7 references
    if (references.length >= 7) break;
  }

  return references.slice(0, 7);
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
    frontOriginalUrl,
    backOriginalUrl,
    frontCroppedUrl,
    backCroppedUrl,
    frontUrl,
    backUrl,
    cardGame = 'pokemon',
    cardType = 'modern_holo'
  } = req.body;

  // Support both 4-image and 2-image modes
  const has4Images = frontOriginalUrl && backOriginalUrl && frontCroppedUrl && backCroppedUrl;
  const hasLegacy = frontUrl && backUrl;

  if (!has4Images && !hasLegacy) {
    return res.status(400).json({
      error: 'Missing image URLs'
    });
  }

  const imageUrls = has4Images
    ? [frontOriginalUrl, backOriginalUrl, frontCroppedUrl, backCroppedUrl]
    : [frontUrl, backUrl];

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
  }

  try {
    console.log('[DeepAnalyzeV2] Starting two-pass analysis...');
    const startTime = Date.now();

    // ========================================================================
    // PASS 1: Quick Estimate
    // ========================================================================
    console.log('[DeepAnalyzeV2] Pass 1: Quick estimate...');

    const imageContent = imageUrls.map(url => ({
      type: 'image',
      source: { type: 'url', url },
    }));

    const pass1Response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 500,
      system: PASS1_SYSTEM,
      messages: [{
        role: 'user',
        content: [...imageContent, { type: 'text', text: PASS1_PROMPT }],
      }],
    });

    const pass1Text = pass1Response.content.find(c => c.type === 'text')?.text || '';
    let quickAssessment;

    try {
      // Clean JSON from response
      let jsonText = pass1Text.trim();
      if (jsonText.startsWith('```')) {
        jsonText = jsonText.replace(/```json?\n?/g, '').replace(/```$/g, '');
      }
      quickAssessment = JSON.parse(jsonText.trim());
    } catch (e) {
      console.error('[DeepAnalyzeV2] Pass 1 parse error:', pass1Text);
      return res.status(500).json({ error: 'Failed to parse quick assessment', raw: pass1Text });
    }

    console.log('[DeepAnalyzeV2] Pass 1 result:', {
      card: quickAssessment.cardName,
      estimated: quickAssessment.estimatedGrade,
      range: quickAssessment.gradeRange
    });

    // ========================================================================
    // QUERY REFERENCES from Supabase
    // ========================================================================
    console.log('[DeepAnalyzeV2] Querying references for grade ~', quickAssessment.estimatedGrade);

    const references = await getReferences(quickAssessment.estimatedGrade, cardType);

    console.log('[DeepAnalyzeV2] Found', references.length, 'reference cards:',
      references.map(r => r.grade).join(', '));

    // ========================================================================
    // PASS 2: Comparison Grading
    // ========================================================================
    console.log('[DeepAnalyzeV2] Pass 2: Comparison grading...');

    const pass2Prompt = buildPass2Prompt(quickAssessment, references);

    const pass2Response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      system: PASS2_SYSTEM,
      messages: [{
        role: 'user',
        content: [...imageContent, { type: 'text', text: pass2Prompt }],
      }],
    });

    const pass2Text = pass2Response.content.find(c => c.type === 'text')?.text || '';
    let finalResult;

    try {
      let jsonText = pass2Text.trim();
      if (jsonText.startsWith('```')) {
        jsonText = jsonText.replace(/```json?\n?/g, '').replace(/```$/g, '');
      }
      finalResult = JSON.parse(jsonText.trim());
    } catch (e) {
      console.error('[DeepAnalyzeV2] Pass 2 parse error:', pass2Text);
      return res.status(500).json({ error: 'Failed to parse final assessment', raw: pass2Text });
    }

    const elapsed = Date.now() - startTime;
    console.log('[DeepAnalyzeV2] Complete in', elapsed, 'ms:', {
      card: finalResult.cardInfo?.name,
      tagGrade: finalResult.grades?.tag?.grade,
      confidence: finalResult.grades?.tag?.confidence
    });

    // ========================================================================
    // Return Response
    // ========================================================================
    return res.status(200).json({
      success: true,
      version: 'v2',
      passes: {
        quickEstimate: quickAssessment,
        referencesUsed: references.length,
        referenceGrades: references.map(r => r.grade)
      },
      cardInfo: finalResult.cardInfo,
      centering: finalResult.centering,
      defects: finalResult.defects,
      comparison: finalResult.comparison,
      grades: finalResult.grades,
      summary: finalResult.summary,
      meta: {
        elapsedMs: elapsed,
        imageMode: has4Images ? '4-image' : '2-image'
      }
    });

  } catch (error) {
    console.error('[DeepAnalyzeV2] Error:', error);

    if (error.status === 401) {
      return res.status(500).json({ error: 'Invalid Anthropic API key' });
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
