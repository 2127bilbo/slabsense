/**
 * ============================================================================
 * SHARED AI DETECTION MODULE — api/_lib/detectionPrompt.js
 * ============================================================================
 * THE single prompt + post-processing layer for BOTH AI grading paths:
 *   - api/ai-analyze-unified.js  (single-pass AI Grade)
 *   - api/deep-analyze-v2.js     (two-pass Deep AI Grade with references)
 *
 * ARCHITECTURE RULE (GRADING_SCALE.md):
 *   The AI DETECTS AND CLASSIFIES defects. It NEVER computes grades, scores,
 *   or subgrades. All scoring math runs in src/lib/gradingEngine.js after
 *   detection. This is what keeps Software / AI / Deep grades uniform.
 *
 * Both endpoints use the SAME system prompt and the SAME user prompt builder.
 * Deep grade differs only by passing `referencesText` (TAG-graded comparison
 * cards) and `priorFindings` (Pass 1 defect list) into the builder.
 *
 * NEVER add grading instructions, grade scales, or score math to this file.
 * ============================================================================
 */

import { gradeCard, ENGINE_VERSION } from '../../src/lib/gradingEngine.js';

// ─────────────────────────────────────────────────────────────────────────────
// ENUMS (must match GRADING_OUTPUT_SCHEMA.md exactly — API contract)
// ─────────────────────────────────────────────────────────────────────────────
export const DEFECT_TYPES = [
  'CORNER', 'EDGE', 'SCRATCH', 'DENT', 'PRINT_DEFECT',
  'CREASE', 'PLAY_WEAR', 'PIT', 'STAIN', 'TEAR',
];
export const SEVERITIES = ['minor', 'moderate', 'severe', 'extreme'];
export const LOCATIONS = [
  'TOP LEFT', 'TOP RIGHT', 'BOTTOM LEFT', 'BOTTOM RIGHT',
  'TOP EDGE', 'BOTTOM EDGE', 'LEFT EDGE', 'RIGHT EDGE',
  'TOP CENTER', 'MIDDLE LEFT', 'MIDDLE CENTER', 'MIDDLE RIGHT', 'BOTTOM CENTER',
];

// ─────────────────────────────────────────────────────────────────────────────
// SYSTEM PROMPT — identical for every AI call on every path
// ─────────────────────────────────────────────────────────────────────────────
export const DETECTION_SYSTEM = `You are an expert Pokemon trading card DEFECT DETECTOR for a professional grading platform.

YOUR ONLY JOB: find, classify, and locate physical defects. You do NOT grade.
A deterministic scoring engine converts your defect list into grades — your
accuracy in TYPE, SEVERITY, and LOCATION is what makes grades correct.

YOU NEVER:
- Assess or estimate centering. Centering is measured by software with
  pixel-level precision and is handled outside your job entirely.
- Output grades, scores, subgrades, or grade ranges.
- Stop reporting defects early. EVERY defect must be reported even if the
  card is obviously heavily damaged. A destroyed card still gets a complete
  corner-by-corner, edge-by-edge, full-surface inspection of BOTH sides.
- Dismiss real damage because the card "looks nice overall", or inflate
  glare into damage.

SEVERITY DEFINITIONS (use EXACTLY these four, lowercase):
- "minor"    = visible only under close inspection or magnification
               (faint print line, tiny ink dot, light corner touch,
               hairline scratch not penetrating gloss)
- "moderate" = clearly visible at arm's length
               (corner ding with whitening, edge whitening/chip, scratch
               penetrating gloss, visible print line, small dent)
- "severe"   = obvious at a glance / structural
               (rounded corner, edge notch, deep scratch, visible crease,
               large dent, stain)
- "extreme"  = card integrity compromised
               (crushed corner, crease breaking card stock, tear, water
               damage, missing stock, writing on card)
When uncertain between two severities, choose the MORE SEVERE one.

⚠️ CAMERA GLARE — THE #1 FALSE-POSITIVE SOURCE ⚠️
User phone photos usually contain flash/glare. Holo, full art, EX/GX/V/VMAX
cards reflect intensely — rainbow shimmer and bright streaks are NORMAL.
GLARE (never report): bright white/silver spots or streaks; blown-out areas
with soft fuzzy edges; brightness appearing in multiple corners at once
(flash pattern); any reflection on the card FACE not at the paper edge.
REAL WEAR (always report): exposed white PAPER FIBERS at a corner tip or
along the cut edge; damage showing actual paper/cardboard texture.
DECISION RULE: "Can I see exposed paper fibers / broken surface texture, or
is this light reflecting off an intact surface?" Fibers → defect.
Reflection → glare → report it in imageQuality, never in defects.

HOLO PATTERN NOTE: natural holofoil texture is NOT a defect. Look for
scratches that cut ACROSS the pattern, print lines, and indentations.

⚠️ PAPER LOSS IS NOT GLARE — CRITICAL EXCEPTION TO THE GLARE RULE ⚠️
Missing stock / paper loss / sticker damage / lifted ink looks like white or
light patches — especially blatant on dark card backs (the blue Pokemon back).
DISTINGUISH: glare is SOFT-EDGED, follows the light, and the printed design is
still visible through it. Paper loss has HARD, IRREGULAR edges and the printed
design is GONE — interrupted artwork, exposed white card stock. Irregular white
patches that interrupt the printed design = type "TEAR", severity "extreme".
When the white area sits ON the artwork with ragged borders, it is damage.
Never let the glare rule erase missing stock.

CREASE HUNT (mandatory, every card, both sides):
Creases and wrinkles appear as thin light/dark LINE discontinuities crossing
the print — a shadow-line or highlight-line that bends across artwork, borders,
or text. Check: diagonals from each corner, horizontal mid-card, and along
heavy-wear zones. A line that crosses printed elements and disturbs the gloss
is a CREASE (severity "severe" if it breaks ink/stock, "extreme" if it crosses
the card or crushes the stock). Whitening that follows a LINE through the
card face is a crease, not play wear.

⚠️ DESIGN CAMOUFLAGE TRAP — POKEMON CARD BACKS ⚠️
The Pokemon card back artwork contains soft white energy swirls. Damage hides
in them. The differences: printed swirls are SOFT-EDGED, CURVED, and never
cross the Pokeball or the border; a crease is a STRAIGHT or angular line with
CRACKLED/fractured texture (exposed paper fibers) that ignores the artwork —
running through the Pokeball, across the full card width, or into the border.
Any straight fractured white line on a card back is a CREASE, severity
"extreme" if it spans the card. Never classify a full-width line as part of
the design.

SEVERITY-LANGUAGE CONSISTENCY RULE:
Your "severity" field must match your own words. If your description says
heavy / deep / significant / major / rounded / chunk / throughout → severity
MUST be "severe" or "extreme". If it says light / faint / slight / tiny →
"minor". Never describe damage as heavy and classify it moderate.

UNIFORM-CORNER RED FLAG:
"All corners show identical light wear" is almost always a misread of foil
pattern, gold borders, or flash falloff — real wear is uneven. Report a
corner defect ONLY when you can see exposed paper fibers at THAT specific
corner. Each corner is judged independently; if you cannot point to fibers
at a corner, that corner is clean. Never report wear on every corner as a
hedge.

NO UNVERIFIED NEGATIVES:
Never write "no creases", "no structural damage", or similar in positives
unless you completed the crease hunt on BOTH sides — including the full-width
horizontal and diagonal line check — and found nothing. A missed crease is
the single worst error you can make: it is the difference between a playable
card and a destroyed one.`;

// ─────────────────────────────────────────────────────────────────────────────
// USER PROMPT BUILDER — same core for both paths
// ─────────────────────────────────────────────────────────────────────────────

/** Centering block: measured values shown for CONTEXT ONLY (never re-estimated). */
function centeringContextBlock(centering) {
  const f = centering.front;
  const b = centering.back;
  const fmt = (s) =>
    `${s.lrRatio.toFixed(1)}/${(100 - s.lrRatio).toFixed(1)} L/R (dev ${Math.abs(s.lrRatio - 50).toFixed(1)}%) | ` +
    `${s.tbRatio.toFixed(1)}/${(100 - s.tbRatio).toFixed(1)} T/B (dev ${Math.abs(s.tbRatio - 50).toFixed(1)}%)`;
  return `## CENTERING — ALREADY MEASURED (context only, NOT your task)
FRONT: ${fmt(f)}
BACK:  ${b ? fmt(b) : 'not provided (front-only grading)'}
These pixel-measured values go directly to the scoring engine. Do NOT
re-estimate them, do NOT report centering as a defect, do NOT factor them
into anything you output.`;
}

/**
 * Build the detection user prompt.
 * @param {Object} opts
 * @param {string}  opts.cardType        e.g. 'pokemon' / 'modern_holo'
 * @param {Object}  opts.centering       { front:{lrRatio,tbRatio}, back|null }
 * @param {string}  opts.imageLayout     describes which image is which
 * @param {string} [opts.referencesText] Deep grade only: TAG reference cards
 * @param {Object} [opts.priorFindings]  Deep grade Pass 2 only: Pass 1 defect list
 */
export function buildDetectionPrompt({ cardType, centering, imageLayout, referencesText = null, priorFindings = null }) {
  const sections = [];

  sections.push(`Identify this ${cardType} card and perform a COMPLETE defect inspection.

## IMAGE LAYOUT
${imageLayout}

If FILTERED images (EMBOSS / HI-PASS / EDGES) are included in the layout:
these are processed versions of the SAME card that make surface topology
visible. Creases, dents, and indentations appear as bright ridge lines or
sharp discontinuities in these images even when invisible in the normal
photos. A continuous line crossing the card in a filtered image IS a crease —
report it even if the normal photo looks clean. Use filtered images for
STRUCTURE only (creases/dents/pits); use normal images for color-based
defects (whitening, stains, print defects).`);

  sections.push(centeringContextBlock(centering));

  sections.push(`## INSPECTION ORDER (complete EVERY step before responding)
0. CATASTROPHIC SCAN — both sides FIRST: creases/wrinkles (line discontinuities
   crossing print), paper loss / missing stock (hard-edged white patches
   interrupting artwork — NOT glare), tears, water damage, writing. These are
   the grade-defining defects; hunt them before anything else.
1. FRONT corners — all four, individually
2. FRONT edges — all four, full length
3. FRONT surface — entire face, systematic scan
4. BACK corners — all four, individually
5. BACK edges — all four, full length
6. BACK surface — entire face, systematic scan
Report EVERY defect found at EVERY step. Never summarize, never skip a step
because earlier findings were bad. Centering is NOT part of inspection.

GRANULARITY RULE: one JSON entry PER defect. "Wear on all four corners" is
FOUR entries (one per corner, each with its own severity and coordinates).
"Edge whitening on multiple sides" is one entry PER edge. Card-wide surface
scratching is one entry per distinct scratch or scratch cluster (up to ~6
regions). Never collapse multiple defects into one entry.

## DEFECT FIELDS (every defect needs all of these)
- "side": "FRONT" or "BACK"
- "type": one of ${JSON.stringify(DEFECT_TYPES)}
  (CORNER = any corner wear/ding/fray; EDGE = any edge wear/chip/nick;
   surface damage uses the specific type: SCRATCH, DENT, PRINT_DEFECT,
   CREASE, PLAY_WEAR, PIT, STAIN, TEAR)
- "severity": one of ${JSON.stringify(SEVERITIES)} per the definitions given
- "location": one of ${JSON.stringify(LOCATIONS)}
- "x", "y": defect CENTER as percentage of card (0-100), origin top-left
- "width", "height": approximate extent as percentage of card
- "description": one short factual sentence

COORDINATE GUIDE (percent of card):
corners → TOP LEFT x≈5-15,y≈5-15 · TOP RIGHT x≈85-95,y≈5-15 ·
BOTTOM LEFT x≈5-15,y≈85-95 · BOTTOM RIGHT x≈85-95,y≈85-95
edges → TOP y≈2-8 · BOTTOM y≈92-98 · LEFT x≈2-8 · RIGHT x≈92-98
center area → x≈30-70, y≈30-70`);

  if (priorFindings) {
    sections.push(`## PRIOR SCAN FINDINGS (verify, refine, and complete — do not blindly copy)
A first-pass scan reported these defects:
${JSON.stringify(priorFindings, null, 2)}
Re-inspect every reported item: confirm it is real (not glare), correct its
severity against the definitions, and add anything the first pass missed.
Removing a false positive is as valuable as finding a missed defect.`);
  }

  if (referencesText) {
    sections.push(`## TAG-GRADED REFERENCE CARDS (severity calibration)
These real TAG-graded cards show what defect counts and severities look like
at each grade level. Use them ONLY to calibrate your severity judgments
(e.g. what TAG considers "minor" corner wear vs "moderate"). Do NOT copy
their defects and do NOT derive a grade from them.
${referencesText}`);
  }

  sections.push(`## IMAGE QUALITY ASSESSMENT
Rate glare and blur per side: "none", "minor", "moderate", or "severe".
List glare locations using the location labels above. If quality prevents a
reliable inspection of any area, say so in "warning".

## RESPONSE — return ONLY this JSON, no other text:
{
  "cardInfo": { "name": null, "setName": null, "cardNumber": null, "rarity": null, "year": null, "hp": null, "variant": null, "language": "English" },
  "imageQuality": {
    "front": { "glareLevel": "none", "blurLevel": "none", "glareLocations": [] },
    "back":  { "glareLevel": "none", "blurLevel": "none", "glareLocations": [] },
    "overall": "good",
    "warning": null
  },
  "defects": [],
  "summary": {
    "positives": ["at least one factual positive observation"],
    "concerns": ["at least one factual concern, or 'No notable concerns'"],
    "recommendation": "one sentence on overall physical condition (no grades)"
  }
}

The defects array above is shown EMPTY on purpose — that is the correct
output for a card with no visible defects. Populate it ONLY with defects you
can actually see in THIS card's images. Each defect object uses this schema
(this is a FORMAT REFERENCE — never copy its values):
  {"side": <FRONT|BACK>, "type": <one of the type list>, "severity": <minor|moderate|severe|extreme>,
   "location": <one of the location list>, "x": <measured % 0-100>, "y": <measured %>,
   "width": <measured %>, "height": <measured %>, "description": <what you actually see>}

⚠️ ANTI-TEMPLATE RULES — these defects are the most-faked part of the output:
- DO NOT report a defect on all four corners by default. Most cards do NOT
  have wear on every corner. Report a corner ONLY if you SEE exposed paper
  fibers at that specific corner in this image. Clean corners are normal.
- DO NOT reuse placeholder coordinates. x/y must be where the defect actually
  sits in THIS image. If two corners legitimately have wear, their coordinates
  and severities will still differ — identical numbers across defects is a
  sign you are guessing, not measuring.
- Every defect's "description" must state what you SEE ("exposed white fiber
  along 3mm of the top-left corner tip"), not a generic phrase. If you cannot
  describe what you see, do not report the defect.
- Vary severity by what you observe. A card where every defect is "minor" and
  every corner is listed is almost always a fabricated/templated response —
  re-inspect and report only real, observed damage at its true severity.
Unknown cardInfo values are null. An immaculate card returns "defects": [].`);

  return sections.join('\n\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// POST-PROCESSING — parse, sanitize, score, assemble
// ─────────────────────────────────────────────────────────────────────────────

/** Extract JSON from an AI text response (handles ``` fences and chatter). */
export function parseDetection(text) {
  if (!text) return null;
  try {
    let t = String(text).trim();
    if (t.startsWith('```')) t = t.replace(/```json?\n?/g, '').replace(/```\s*$/g, '');
    const match = t.match(/\{[\s\S]*\}/);
    return match ? JSON.parse(match[0]) : null;
  } catch {
    return null;
  }
}

const TYPE_FALLBACKS = [
  ['CORNER', 'CORNER'], ['EDGE', 'EDGE'], ['CREASE', 'CREASE'], ['WRINKLE', 'CREASE'],
  ['BEND', 'CREASE'], ['TEAR', 'TEAR'], ['RIP', 'TEAR'], ['STAIN', 'STAIN'],
  ['WATER', 'STAIN'], ['DENT', 'DENT'], ['INDENT', 'DENT'], ['PIT', 'PIT'],
  ['PRINT', 'PRINT_DEFECT'], ['INK', 'PRINT_DEFECT'], ['SCRATCH', 'SCRATCH'],
  ['SILVER', 'EDGE'], ['WHITEN', 'EDGE'], ['WEAR', 'PLAY_WEAR'], ['SURFACE', 'PLAY_WEAR'],
];

/**
 * Sanitize a raw AI defect list into engine-safe defects.
 * Drops centering pseudo-defects and unmappable types; clamps coords;
 * normalizes enums. NEVER throws.
 */
export function sanitizeDefects(rawDefects) {
  if (!Array.isArray(rawDefects)) return [];
  const out = [];
  for (const d of rawDefects) {
    if (!d || typeof d !== 'object') continue;
    const typeRaw = String(d.type || '').toUpperCase();
    if (typeRaw.includes('CENTER') && !typeRaw.includes('CORNER')) continue; // centering is never a defect
    let type = DEFECT_TYPES.includes(typeRaw) ? typeRaw : null;
    if (!type) {
      for (const [needle, mapped] of TYPE_FALLBACKS) {
        if (typeRaw.includes(needle)) { type = mapped; break; }
      }
    }
    if (!type) continue;

    const sevRaw = String(d.severity || 'minor').toLowerCase();
    const severity = SEVERITIES.includes(sevRaw) ? sevRaw : 'minor';
    const side = String(d.side || 'FRONT').toUpperCase() === 'BACK' ? 'BACK' : 'FRONT';
    const clamp = (v) => (typeof v === 'number' && isFinite(v) ? Math.max(0, Math.min(100, v)) : null);

    out.push({
      side, type, severity,
      location: LOCATIONS.includes(String(d.location || '').toUpperCase()) ? String(d.location).toUpperCase() : (d.location || null),
      zone: null,
      x: clamp(d.x), y: clamp(d.y),
      width: clamp(d.width), height: clamp(d.height),
      description: String(d.description || '').slice(0, 200),
    });
  }
  return out;
}

/** Deterministic confidence from image quality (same math on every path). */
export function confidenceFromImageQuality(iq, { referencesUsed = 0 } = {}) {
  const PEN = { none: 0, minor: 0.08, moderate: 0.25, severe: 0.5 };
  const lvl = (v) => PEN[String(v || 'none').toLowerCase()] ?? 0;
  const factors = [];
  let value = 0.95;

  const worstGlare = Math.max(lvl(iq?.front?.glareLevel), lvl(iq?.back?.glareLevel));
  const worstBlur = Math.max(lvl(iq?.front?.blurLevel), lvl(iq?.back?.blurLevel));
  if (worstGlare > 0) { value -= worstGlare; factors.push({ factor: 'glare on card images', impact: -worstGlare }); }
  if (worstBlur > 0) { value -= worstBlur; factors.push({ factor: 'image blur', impact: -worstBlur }); }
  factors.push({ factor: 'manual centering provided', impact: 0 });
  if (referencesUsed > 0) {
    value += 0.02;
    factors.push({ factor: `${referencesUsed} TAG reference cards used`, impact: 0.02 });
  }
  return { value: Math.round(Math.max(0.2, Math.min(0.98, value)) * 100) / 100, factors };
}

/**
 * Run the engine on a sanitized detection and assemble the FULL unified
 * output per GRADING_OUTPUT_SCHEMA.md. Used by both endpoints.
 */
export function assembleUnifiedOutput({ detection, centering, gradePath, frontOnly = false, meta = {} }) {
  const defects = sanitizeDefects(detection?.defects);
  const engine = gradeCard({ defects, centering, frontOnly });

  const iq = detection?.imageQuality || {};
  const confidence = confidenceFromImageQuality(iq, { referencesUsed: meta.referencesUsed || 0 });

  const summary = detection?.summary || {};
  const nonEmpty = (arr, fb) => (Array.isArray(arr) && arr.length ? arr : [fb]);

  return {
    schemaVersion: '1.0',
    gradedAt: new Date().toISOString(),
    gradePath,
    cardInfo: {
      name: detection?.cardInfo?.name ?? null,
      setName: detection?.cardInfo?.setName ?? null,
      cardNumber: detection?.cardInfo?.cardNumber ?? null,
      rarity: detection?.cardInfo?.rarity ?? null,
      year: detection?.cardInfo?.year ?? null,
      hp: detection?.cardInfo?.hp ?? null,
      variant: detection?.cardInfo?.variant ?? null,
      language: detection?.cardInfo?.language ?? 'English',
      cardGame: meta.cardGame ?? null,
      cardType: meta.cardType ?? null,
    },
    imageQuality: {
      front: { glareLevel: iq.front?.glareLevel ?? 'none', blurLevel: iq.front?.blurLevel ?? 'none', glareLocations: iq.front?.glareLocations ?? [] },
      back: { glareLevel: iq.back?.glareLevel ?? 'none', blurLevel: iq.back?.blurLevel ?? 'none', glareLocations: iq.back?.glareLocations ?? [] },
      overall: iq.overall ?? 'good',
      warning: iq.warning ?? null,
    },
    centering: engine.centering,
    defects: engine.defects,
    subgrades: engine.subgrades,
    overall: engine.overall,
    companyGrades: engine.companyGrades,
    summary: {
      positives: nonEmpty(summary.positives, 'Inspection completed'),
      concerns: nonEmpty(summary.concerns, 'No notable concerns'),
      recommendation: summary.recommendation || 'See defect report for details.',
    },
    confidence,
    meta: { ...meta, gradePath, engineVersion: ENGINE_VERSION },
  };
}
