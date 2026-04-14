# SlabSense — AI Grading Pipeline (Anthropic Direct + Multi-Image + Annotations)

Handoff doc for migrating the AI grading pipeline from Replicate to Anthropic's direct API, adding image preprocessing for defect visibility, and rendering annotated defect overlays on the user-facing grade screen.

## Goal

Replace the current Replicate-based Claude call with a direct Anthropic API integration that:
1. Pre-processes the card image into multiple filtered versions for better defect detection
2. Sends all versions in a single API call with prompt caching enabled
3. Receives structured JSON with defect coordinates
4. Renders orange annotation boxes on the original image so users can visually verify each flagged defect
5. (Future) Captures user feedback on annotations to build a calibration dataset

## Why Direct API Instead of Replicate

- **Same per-token pricing** ($3/M input, $15/M output for Sonnet) — Replicate doesn't mark up Claude
- **Prompt caching available** — 90% discount on repeated static prompt content. The grading checklist is identical every call, so cache it
- **Lower latency** — one fewer network hop, ~1s faster time-to-first-token
- **Full feature access** — extended thinking, adaptive thinking, fine-grained tool use, all newest models day-of-launch
- **Single vendor** — SAM2 is gone, no more reason to keep Replicate as a dependency
- **Direct support** — production issues filed directly with Anthropic instead of through Replicate

**Important clarification:** The Anthropic API is billed pay-per-token from a separate developer account at console.anthropic.com. It is NOT tied to any Claude.ai subscription. Bob loads credits, gets an API key, the app bills per call against credits. Same self-sufficient model as Replicate, different vendor.

## Architecture Overview

```
User taps "Grade card"
      │
      ▼
PWA captures front + back, sends to Vercel serverless function
      │
      ▼
Vercel serverless function:
  1. Apply image filters to FRONT (back optional, see notes):
       - CLAHE (Contrast Limited Adaptive Histogram Equalization)
       - Unsharp mask / high-pass filter
       - Edge detection (Sobel)
       - Optional: desaturated + curves, blue channel isolation, inverted
  2. Build prompt with cached static portion (system + checklist + JSON schema)
  3. Call Anthropic API with original front + original back + 3-4 filtered front images
  4. Receive structured JSON with grade + defect coordinates + per-defect confidence
  5. Return JSON to PWA (no images returned — original is already on the client)
      │
      ▼
PWA receives JSON:
  1. Render grade + breakdown
  2. Draw annotation boxes on the original front image using HTML5 canvas
  3. Make boxes tappable to show defect details
  4. (Future) Capture user confirm/dismiss feedback per defect
```

## The Filter Set (Image Preprocessing)

The model can only see what you send it — it cannot apply filters itself. Pre-processing happens in the Vercel function using `sharp` (Node) or OpenCV.js.

### Always include in the API call:
1. **Original front** — baseline reference, always image #1
2. **Original back** — baseline reference, always image #2

### Recommended filtered versions of FRONT (pick 3-4):

**CLAHE (highest impact for fish eyes / surface defects)**
- Contrast Limited Adaptive Histogram Equalization
- Boosts local contrast in small regions without blowing out the whole image
- Small optical defects, fish eyes, ink bubbles pop dramatically
- `sharp` doesn't have CLAHE built in — use `opencv4nodejs` or `opencv.js` for this one

**Unsharp mask / high-pass filter**
- Amplifies fine detail and edge transitions
- Scratches, dings, fish eyes become much more visible
- Silkscreen dots stay subtle
- `sharp` has this: `sharp(input).sharpen({ sigma: 1.5, m1: 1, m2: 2 })`

**Edge detection (Sobel)**
- Great for scratches, creases, ding outlines, edge whitening
- Useless for color-based defects but excellent for geometric damage
- `sharp` has it: `sharp(input).convolve({ width: 3, height: 3, kernel: [-1,0,1,-2,0,2,-1,0,1] })` for vertical Sobel; combine with horizontal for full edge map

### Optional / situational filters:

**Desaturated + curves adjustment**
- Removes color distraction, makes luminance defects dominant
- Surface wear shows clearly on grayscale
- `sharp(input).grayscale().linear(1.5, -50)` for contrast boost

**Blue channel isolation**
- Print defects often show strongest in the blue channel alone
- Cheap to do, sometimes reveals things invisible in RGB composite
- `sharp(input).extractChannel('blue')`

**Inverted image**
- Weirdly effective for certain print bubbles and fish eyes
- Trivially cheap
- `sharp(input).negate()`

### Filter selection strategy:

For v1, send a fixed set: original front, original back, CLAHE front, unsharp front, edges front. Five images total.

For v2 (if cost or latency becomes an issue), make filter selection adaptive based on card type detected by pHash:
- Holo / reverse-holo cards: skip edge detection (foil pattern produces noise), add inverted
- Matte / non-foil cards: standard set works well
- Full-art cards: skip edges, add desaturated + curves

### Don't filter the back image (usually):

The back is the same blue Pokémon pattern across all cards. Defects on the back are usually obvious in the original (creases, large scuffs, edge whitening). Skip filtering to save tokens. Re-evaluate based on real-world results.

## API Call Structure

```javascript
import Anthropic from '@anthropic-ai/sdk';
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const response = await client.messages.create({
  model: 'claude-sonnet-4-5',  // or whatever current Sonnet is at production time
  max_tokens: 2000,
  temperature: 0,  // critical for consistency — set to 0
  system: [
    {
      type: 'text',
      text: STATIC_GRADING_SYSTEM_PROMPT,  // ~1500 tokens, identical every call
      cache_control: { type: 'ephemeral' }  // enable prompt caching
    }
  ],
  messages: [
    {
      role: 'user',
      content: [
        { type: 'text', text: 'Image 1 (original front):' },
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: originalFrontB64 }},
        { type: 'text', text: 'Image 2 (original back):' },
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: originalBackB64 }},
        { type: 'text', text: 'Image 3 (front with CLAHE applied — examine for surface defects not visible in original):' },
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: claheFrontB64 }},
        { type: 'text', text: 'Image 4 (front with unsharp mask — examine for fine surface detail and fish eyes):' },
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: unsharpFrontB64 }},
        { type: 'text', text: 'Image 5 (front edge-detected — examine for scratches, dings, edge whitening):' },
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: edgesFrontB64 }},
        { type: 'text', text: USER_PROMPT_GRADING_REQUEST }
      ]
    }
  ]
});
```

## The Static System Prompt (Cached)

Structure for the cached portion. The exact wording is for Bob to refine — this is the skeleton:

```
You are an expert pre-grader for TAG (Technical Authentication and Grading) Pokémon TCG submissions.

CONTEXT:
- TAG grading is driven by DINGS (Defects Identified of Notable Grade Significance), not Fray/Fill/Angle scores
- Front defects weigh approximately 2x back defects
- Surface play wear on the front is the biggest grade killer
- Centering alone can drop a Gem Mint 10 to a Mint 9

YOUR TASK:
Examine the provided images of a Pokémon card and identify all defects that would impact a TAG grade. The user provides multiple images: original front, original back, and several processed versions of the front to reveal subtle defects.

EXAMINATION PROCEDURE — follow this order strictly:
1. Corners (TL, TR, BL, BR) — note any whitening, dings, bends, layering
2. Edges (Top, Right, Bottom, Left) — note any chips, rough cuts, whitening, nicks
3. Surface front — scan in 4 quadrants for scratches, fish eyes, print bubbles, scuffs, indentations, holo scratches
4. Surface back — scan in 4 quadrants for scratches, scuffs, indentations, edge whitening
5. Print quality — registration, color consistency, print lines
6. Centering — describe visible offset

FILTER NOTES (for processed images):
- CLAHE images: enhanced local contrast. Real defects appear as distinct intensity transitions. Beware: CLAHE amplifies grain and noise — only flag defects with clear shape/structure.
- Unsharp images: enhanced edge detail. Defects appear with crisp boundaries. Beware: holo patterns and silkscreen dots become exaggerated — distinguish print features from defects.
- Edge-detected images: high-contrast outline. Defects appear as line discontinuities. Useless for color-based defects.

A defect should ONLY be flagged if:
- It is visible in the original image, OR
- It is visible in at least 2 processed images (cross-confirmation reduces filter artifacts)

OUTPUT FORMAT — return ONLY valid JSON matching this schema:
{
  "predicted_grade": "TAG 8.5",
  "grade_confidence": "high" | "medium" | "low",
  "centering": {
    "horizontal": "52/48",
    "vertical": "49/51"
  },
  "defects": [
    {
      "type": "fish_eye" | "scratch" | "ding" | "edge_whitening" | "print_bubble" | "scuff" | "crease" | "indent" | "holo_scratch" | "edge_chip" | "corner_whitening" | "print_defect" | "other",
      "location": "front" | "back",
      "x": <pixel x of bounding box top-left>,
      "y": <pixel y of bounding box top-left>,
      "width": <pixel width>,
      "height": <pixel height>,
      "severity": 1-5,
      "confidence": "high" | "medium" | "low",
      "visible_in": ["original" | "clahe" | "unsharp" | "edges"],
      "notes": "<brief description, max 100 chars>"
    }
  ],
  "summary": "<2-3 sentence overall assessment>"
}

Coordinates must be in pixel space relative to the original image dimensions provided.
Do not include any text outside the JSON object.
```

## The User Prompt (Variable, Not Cached)

```
Examine the provided card images and return your grading assessment as JSON.
Original image dimensions: {width}x{height} pixels.
```

## Annotation Rendering (Client-Side)

The PWA receives the JSON and draws annotations on the original image using HTML5 canvas (same pattern as the centering tool measurement annotations).

```javascript
function renderAnnotations(canvas, originalImage, defects) {
  const ctx = canvas.getContext('2d');
  ctx.drawImage(originalImage, 0, 0);
  
  defects.forEach((defect, idx) => {
    // Color by severity: green=low, yellow=medium, orange=high
    const color = defect.severity >= 4 ? '#FF4500' 
                : defect.severity >= 2 ? '#FFA500' 
                : '#FFD700';
    
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.strokeRect(defect.x, defect.y, defect.width, defect.height);
    
    // Number label for tap reference
    ctx.fillStyle = color;
    ctx.fillRect(defect.x, defect.y - 20, 20, 20);
    ctx.fillStyle = 'white';
    ctx.font = 'bold 14px sans-serif';
    ctx.fillText(`${idx + 1}`, defect.x + 5, defect.y - 5);
  });
}
```

Make boxes tappable. On tap, show a popup/sheet with:
- Defect type and severity
- Confidence level
- Which filtered images flagged it (`visible_in` array)
- Notes from the model
- (Future) Confirm / Dismiss buttons for feedback capture

## File Manifest

New files:
- `api/grade-card.js` — Vercel serverless function handling preprocessing + Anthropic call
- `src/lib/grade-renderer.js` — client-side annotation drawing
- `src/components/DefectAnnotations.jsx` — annotated image viewer with tappable boxes
- `src/components/DefectDetail.jsx` — popup/sheet showing single defect details

Modified files:
- `src/App.jsx` — wire new grading endpoint into capture flow
- Remove Replicate SDK and related code

Environment:
- `ANTHROPIC_API_KEY` in Vercel env vars (server-side only, never exposed to client)
- Remove `REPLICATE_API_TOKEN`

## Cost Math (For Reference)

With prompt caching enabled and steady traffic keeping cache warm:

**Standard grade (5 images, ~3000 input tokens including cached portion, ~800 output tokens):**
- Cache hit on ~1500 static tokens: 1500 * $0.30/M = $0.00045
- New input tokens (images + variable prompt): ~1500 * $3/M = $0.0045
- Output tokens: ~800 * $15/M = $0.012
- **Total: ~$0.017 per grade**

**Premium grade (with ensemble voting 3x):**
- ~$0.05 per grade
- Charge $1-2 for this feature → 95%+ margin

These costs are essentially flat regardless of user count. Per-call billing scales linearly with usage; no fixed overhead beyond the credits being topped up.

## Implementation Order

1. Set up Anthropic API account, load credits, get API key, add to Vercel env
2. Build Vercel serverless function with no preprocessing — just pass original front+back to Anthropic. Verify parity with current Replicate output.
3. Add prompt caching to system prompt. Verify cache hits in API response (`cache_read_input_tokens` field).
4. Add CLAHE preprocessing (highest-impact filter). Verify defect detection improves on test cards.
5. Add unsharp mask + edge detection. Compare detection rates against CLAHE-only baseline.
6. Switch JSON output schema to include defect coordinates and `visible_in` field.
7. Build client-side annotation renderer. Test on real cards.
8. Build tappable defect detail popup.
9. Remove Replicate SDK and credentials.
10. (Deferred — see open questions) Feedback capture system.

## Known Considerations

- **Image size matters for cost.** Higher resolution images = more tokens. Resize images to a reasonable max dimension (~1000-1500px on long edge) before sending. The model doesn't gain useful detail above this for card-sized objects.
- **Temperature must be 0.** Non-zero temperature causes the inconsistency Bob observed (same image, different defects flagged on repeat runs). Setting to 0 doesn't make output perfectly deterministic but dramatically reduces variance.
- **Cache TTL is 5 minutes by default.** If grading traffic is sparse, cache may go cold between calls. Anthropic also offers a 1-hour cache option (2x write cost, pays back after 2 hits) for production at scale.
- **The model occasionally returns invalid JSON.** Always wrap parsing in try/catch. On failure, retry once. If still failing, surface a "grading failed, try again" message rather than crashing.
- **Replicate bills are not refundable.** Drain remaining Replicate credits before fully cutting over (or just leave them, $10 isn't worth the hassle).

## Out of Scope for This Handoff

- **pHash card identification** — separate handoff doc, runs in parallel
- **Corner-anchored centering measurement** — separate handoff doc, dev build only
- **Graded price lookups** — eBay sold scraping pipeline, separate handoff doc when ready
- **Multi-angle lighting capture** — physical hardware feature, future Pro tier

---

## OPEN QUESTIONS — DISCUSS WITH BOB BEFORE BUILDING

### 1. Feedback capture system (defect confirm/dismiss)

**Why valuable:**
- Builds a calibration dataset showing which defect types Claude over-calls on which card types
- Lets Bob improve prompt over time with empirical data ("on holo cards, fish_eye has a 68% false positive rate — adjust prompt to be more conservative there")
- Per-defect-type confidence scoring becomes possible: "Fish eye detected — note: this defect type has a 68% false positive rate on holo cards"
- Differentiates SlabSense from black-box graders

**What needs deciding (Bob to think on, then direct Claude Code):**

- **Trigger frequency:** Always show feedback option? Only on uncertain grades? Random sampling (1 in 10)? Opt-in via settings? Bob's stated preference: NOT annoying / pop-up every time. Some kind of subtle, opt-in-feeling pattern.
- **Interaction model:** Tap defect box → quick confirm/dismiss buttons in the popup? Or a separate "review defects" mode the user enters intentionally? Or no buttons at all and just a "Was this grade accurate?" thumbs-up/down at the bottom of the screen?
- **False positive categorization:** When user dismisses, ask why ("Holo reflection," "Print dot, not defect," "Photo glare," "Other") or just record dismissal? Categorized data is gold for prompt tuning but adds friction.
- **Storage:** Backend database (Supabase free tier?), Google Sheet via webhook (zero setup), local-only with optional sync? Bob's previous architecture preference was "free algorithmic tier + optional paid Claude API tier via Vercel serverless functions" — feedback storage fits the free tier infrastructure.
- **Privacy:** Anonymous session ID only, or tied to user accounts when those exist? GDPR/CCPA implications if storing per-user behavior.
- **Display of accumulated data:** Does the user ever see the calibration data? ("47 users have flagged fish_eye false positives on this card type") — interesting but potentially overwhelming.

**Recommendation for first conversation:**
Start with the simplest version that captures useful data without being annoying. Possibly: tap defect → popup shows defect info + small "Looks wrong?" link in the corner. Tap that → opens a one-tap categorization sheet. Most users ignore it; engaged users provide gold. No popups, no required interactions.

But this is Bob's call — he's the one who'll feel out the right UX during beta. Defer building until decided.
