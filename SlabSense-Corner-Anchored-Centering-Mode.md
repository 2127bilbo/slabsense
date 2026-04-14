# SlabSense — Corner-Anchored Multi-Sample Centering Mode (Beta Toggle)

Handoff doc for adding an alternative centering measurement mode to the centering tool dev build. Runs alongside the existing edge-drag method, toggle-selectable, for beta comparison testing.

## Goal

Replace "drag a full edge line to match the border" with "place 4 outer corners + 4 inner corners, sample border width at 5 points along each edge, use median." More accurate on tilted/warped cards, provides confidence signal via sample variance, and matches how TAG actually measures centering (border-width ratios, not edge positions).

**DO NOT remove the existing edge-drag system.** Add this as a toggle-enabled alternative. Goal is A/B comparison during Bob's beta phase to decide which ships in the Apple App Store production release.

## Toggle Behavior

**UI:** Add a single toggle labeled "Measurement Mode" near the top of the centering screen:
- `Edge Drag (v1)` — existing system, unchanged
- `Corner Anchored (beta)` — new system described below

Toggle state persists per-session (localStorage). Both modes should produce a final centering ratio (e.g., "52/48 L/R, 49/51 T/B") in the same format so results are directly comparable.

## The Measurement Concept

```
Outer corners: TL, TR, BL, BR  (4 corners of the card itself)
Inner corners: tl, tr, bl, br  (4 corners of the art frame / inner border)

For each of the 4 edges, sample border width at 5 positions along the edge:
  Sample positions (as fraction of edge length): 0.1, 0.3, 0.5, 0.7, 0.9

Top edge example:
  For i in [0.1, 0.3, 0.5, 0.7, 0.9]:
    outer_point = lerp(TL, TR, i)          // along outer top edge
    inner_point = lerp(tl, tr, i)          // along inner top edge
    width[i] = perpendicular_distance(outer_point, inner_point)
  top_border_px = median(width)

Repeat for bottom (BL→BR, bl→br), left (TL→BL, tl→bl), right (TR→BR, tr→br).

Centering ratios:
  horizontal_pct = left_border / (left_border + right_border) * 100
  vertical_pct   = top_border / (top_border + bottom_border) * 100

Display as "L/R" and "T/B" (e.g., "52/48 L/R").
```

**Use median, not mean.** One sample hitting a print defect or detection error shouldn't dominate. Median is robust to outliers; mean is not.

**Sample variance = confidence signal.** Compute standard deviation of the 5 samples per edge. High variance means something is wrong (bad detection, warped card, perspective skew too severe). Flag it in the UI.

## Components to Build

### 1. Corner State Management

Track 8 corner positions in canvas coordinates:
```js
const [corners, setCorners] = useState({
  outer: { tl: {x,y}, tr: {x,y}, bl: {x,y}, br: {x,y} },
  inner: { tl: {x,y}, tr: {x,y}, bl: {x,y}, br: {x,y} }
});
```

**Auto-detect initial positions:**
- Outer corners: reuse existing card-bounds detection from the current tool
- Inner corners: reuse existing inner-border detection
- If bg-fallback triggered (full-frame card), place inner corners at reasonable defaults with a warning

### 2. Draggable Corner Handles

8 handles total, all draggable with pointer capture (same mobile drag pattern already working in the current tool).

**Visual distinction:**
- Outer corners: larger circles, one color (e.g., cyan)
- Inner corners: smaller circles, different color (e.g., magenta)
- Active drag: highlight ring
- Hit radius: scale by canvas-to-display ratio (reuse existing mobile hit-radius fix)

**Constraint option (optional v2):** Inner corners snap to a detected rectangle if one is found — enforce `tl.y == tr.y`, `bl.y == br.y`, etc. Skip this for v1; let corners be freely placed.

### 3. Sample Point Rendering

Along each of the 4 edges, draw 5 small tick marks showing where measurement samples are being taken. These are visual-only, not interactive. Render as small dots or short perpendicular lines in a subtle color.

**Why:** Users see that the tool is measuring at 5 points, not guessing from one line. Builds trust and makes the confidence signal intuitive.

### 4. Border Width Calculation

```js
function calculateBorderMeasurement(outerStart, outerEnd, innerStart, innerEnd) {
  const samples = [];
  const positions = [0.1, 0.3, 0.5, 0.7, 0.9];
  
  for (const t of positions) {
    const outerPt = lerp(outerStart, outerEnd, t);
    const innerPt = lerp(innerStart, innerEnd, t);
    const width = perpendicularDistance(outerPt, innerPt, outerStart, outerEnd);
    samples.push(width);
  }
  
  const median = medianOf(samples);
  const stdev = stdevOf(samples);
  const coefficientOfVariation = stdev / median; // normalized variance
  
  return { median, samples, stdev, coefficientOfVariation };
}
```

**`perpendicularDistance`:** not just `innerPt.y - outerPt.y` — project the inner point onto the perpendicular of the outer edge so tilted cards measure correctly.

### 5. Confidence Classification

Based on coefficient of variation (CV = stdev/median) across the 5 samples:
- `CV < 0.05`: **High confidence** — samples very consistent
- `CV 0.05-0.15`: **Medium confidence** — some variation, likely fine
- `CV > 0.15`: **Low confidence** — flag to user, detection probably wrong or card warped

### 6. Display Panel

Below the canvas, show per-edge breakdown. This is the meat of what users see in beta to understand whether the new mode is working:

```
┌─────────────────────────────────────────────────┐
│ TOP BORDER                                      │
│ Samples: 42, 41, 42, 43, 42 px                 │
│ Median: 42px  |  StDev: 0.7  |  ✓ High conf    │
│                                                 │
│ BOTTOM BORDER                                   │
│ Samples: 48, 47, 48, 49, 48 px                 │
│ Median: 48px  |  StDev: 0.7  |  ✓ High conf    │
│                                                 │
│ LEFT BORDER                                     │
│ Samples: 38, 41, 44, 47, 40 px                 │
│ Median: 41px  |  StDev: 3.5  |  ⚠ Low conf     │
│                                                 │
│ RIGHT BORDER                                    │
│ Samples: 44, 43, 45, 44, 43 px                 │
│ Median: 44px  |  StDev: 0.8  |  ✓ High conf    │
│                                                 │
│ CENTERING RATIOS                                │
│ Horizontal: 48/52 (L/R)                        │
│ Vertical:   47/53 (T/B)                        │
│                                                 │
│ Overall confidence: MEDIUM (1 edge low conf)   │
└─────────────────────────────────────────────────┘
```

This debug-style readout is what makes beta feedback actionable — Bob and testers can see *why* a measurement is or isn't trustworthy.

### 7. Comparison Mode (optional but valuable for beta)

When the toggle flips, **preserve both sets of ratios** in the UI. Show side-by-side:

```
Edge Drag (v1):       52/48 L/R, 49/51 T/B
Corner Anchored (β):  48/52 L/R, 47/53 T/B
```

This lets Bob and testers immediately see where the two methods disagree and judge which is closer to reality on real cards. Most valuable for building the beta dataset.

## File Manifest

New files:
- `src/lib/corner-measurement.js` — calculation functions (perpendicularDistance, median, stdev, calculateBorderMeasurement)
- `src/components/CornerHandles.jsx` — the 8 draggable handles + rendering

Modified files:
- `src/App.jsx` — add toggle state, conditional render between existing edge-drag UI and new corner-anchored UI, shared final-ratio display

## Geometry Reference

### Linear interpolation (lerp):
```js
function lerp(a, b, t) {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}
```

### Perpendicular distance from point P to line through A-B:
```js
function perpendicularDistance(P, lineStart, lineEnd) {
  const dx = lineEnd.x - lineStart.x;
  const dy = lineEnd.y - lineStart.y;
  const len = Math.sqrt(dx*dx + dy*dy);
  // perpendicular distance formula
  return Math.abs((P.x - lineStart.x) * dy - (P.y - lineStart.y) * dx) / len;
}
```

### Median of array:
```js
function medianOf(arr) {
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
```

### Standard deviation:
```js
function stdevOf(arr) {
  const mean = arr.reduce((a, b) => a + b) / arr.length;
  const variance = arr.reduce((sum, x) => sum + (x - mean) ** 2, 0) / arr.length;
  return Math.sqrt(variance);
}
```

## Implementation Order

1. Add toggle UI (both modes functional, new mode returns dummy data initially)
2. Build 8-corner state + auto-detect initialization (reuse existing detection)
3. Draggable corner handles with pointer capture
4. Sample point rendering (visual only)
5. Border width calculation with 5-sample median
6. Confidence classification + display panel
7. Comparison mode (side-by-side ratios when toggling)
8. Mobile testing — verify hit radius, drag smoothness, overlay rendering

## Known Considerations

- **Full-art / borderless cards:** No visible inner border. Inner corners can't be auto-detected. Either disable new mode for these with a message, or let user manually place inner corners at the art boundary they perceive. Flag as known limitation for beta.
- **Heavy card warp:** 5 samples may still show high variance. This is the point — the confidence signal tells the user to retake the photo or accept uncertainty. Don't try to hide it.
- **Existing rotation detection:** Keep it. Corner-anchored measurement works fine on the deskewed coordinate system. The rotation slider and auto-detect stay as-is.
- **Existing full-frame warning (bg-fallback):** Still applies to outer corner auto-detection. Keep the warning banner.

## What to Watch For in Beta

Track these in the debug readout so Bob and testers can report:
- How often do the two modes agree within 2% on the final ratios?
- On disagreements, which is closer to reality (visual inspection)?
- How often does the new mode's confidence signal correctly flag bad detections?
- Does user effort feel lower with 8 point-drags vs 4 line-drags?
- Any mobile drag issues specific to the smaller inner corner handles?

Answers to these decide whether corner-anchored ships as the default, stays as a toggle, or gets removed before App Store production.

## Out of Scope for This Handoff

- Perspective correction / homography un-skewing (future enhancement; would use the 4 inner corners to compute a warp matrix and measure on the corrected image)
- Inner corner rectangle snapping (v2 feature)
- Automatic outer/inner corner detection improvements (handled separately in existing docs)
- Anything touching the grading pipeline, main app, or pHash identification pipeline
