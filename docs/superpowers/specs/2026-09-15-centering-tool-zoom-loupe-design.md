# Centering tool: stage zoom, corner buttons, loupe, vision views, undo — Design

**Date:** 2026-09-15
**Status:** approved in chat
**Component:** `src/components/PostCaptureCentering/PostCaptureCentering.jsx` (+ `CornerHandles.jsx`)
**Reference:** the owner liked tabletrack.nl's centering workspace (corner buttons → 750 % zoom on
that corner's handle, a magnifier window while dragging, Original/Edge/Contrast views, Undo).

## 1. Problems and goals

1. **Stuck after pinch-zoom.** The page sets `user-scalable=no`, which iOS ignores, so a pinch
   zooms the whole page. The image area has `touch-action: none` so handle drags don't scroll,
   which also blocks panning the zoomed page when the image fills the screen. Goal: the page never
   zooms; the tool zooms itself, and there is always a way back.
2. **Precision.** Goal: one tap zooms to 750 % on a corner's handle; a loupe shows real detail
   under the handle while dragging; edge/hi-pass/emboss views with our intensity slider help find
   borders on hard cards.
3. **Safety.** Undo the last handle move.

Non-goals: no change to centering math, the crop, what is saved, or the two-step flow.

## 2. Stage zoom and pan

- The `<img>` + `<svg>` block (both steps) is wrapped:
  ```
  <div class="viewport" style="overflow:hidden; position:relative; aspect-ratio: W/H; touch-action:none">
    <div class="stage" style="transform: translate(tx px, ty px) scale(z); transform-origin: 0 0; width:100%">
      <img …/> <svg …/>   (unchanged)
    </div>
  </div>
  ```
- View state `view = { z, tx, ty }` in viewport CSS px; `FIT = { z: 1, tx: 0, ty: 0 }`.
  Pure helpers in `src/lib/stage-view.js` (tested):
  - `fit()`
  - `zoomAt(view, z2, px, py, vw, vh)` — zoom to `z2` keeping viewport point (px,py) fixed, clamped
  - `zoomToImagePoint(view, z2, ix, iy, imgW, imgH, vw, vh)` — center image point, clamped
  - `pan(view, dx, dy, vw, vh)` — clamped
  - `clamp(view, vw, vh)` — stage always covers the viewport when z > 1; `z ∈ [1, 12]`
- Gestures on the viewport (pointer events, a `Map` of active pointers):
  - pointerdown on empty stage (not a handle) → record; two pointers → pinch: `zoomAt` about the
    midpoint by the distance ratio, plus pan by the midpoint delta; one pointer with `z > 1` → pan.
  - handles keep their own capture (`stopPropagation` already present), so a handle drag never pans.
  - `gesturestart`/`gesturechange` on the viewport → `preventDefault()` (Safari page-zoom).
- Handle hit targets: `getCoords()` already divides by `getBoundingClientRect()`, which reflects
  the scale, so coordinates need no change. Handle size and line width shrink with zoom:
  `handleSize / z`, `lw / z`, dash lengths `/ z` in both files (new `zoom` prop to `CornerHandles`).
- Controls row above the image: `◤ ◥ ◣ ◢` corner buttons, `Undo`, zoom readout (`100 %`/`750 %`),
  `Fit`. The existing Reset stays where it is.

## 3. Corner buttons

- `zoomToCorner(c)` for `c ∈ {tl,tr,bl,br}`: target = that corner's handle in image coords —
  edge mode: `(outer.left|right, outer.top|bottom)` in step 1, same on `inner` in step 2; corner
  mode: `outerCorners[c]` / `innerCorners[c]`. `view = zoomToImagePoint(view, 7.5, …)`.
- Active corner is highlighted; tapping it again (or Fit) → `FIT`. The view does **not** follow
  the handle during a drag.
- Switching step resets to `FIT`.

## 4. Loupe (drag-only)

- Component `Loupe.jsx`: a 150 × 150 CSS-px canvas (device-pixel-ratio aware), rounded, thin
  border, crosshair through the center, small zoom label.
- Source: the **original** `image` prop (full capture resolution) via one `Image` element loaded
  once; step 2 uses `croppedPreview`. It draws a window of `LOUPE_SRC_PX` source pixels (default
  = source width / 24 ≈ 4 % of the card) centered on the handle position, mapped to the canvas.
- Shown while any handle is dragged. Both drag paths call `onHandleDrag({ x, y, kind })` on
  pointerdown/move and `onHandleDrag(null)` on pointerup:
  - edge mode: `which` → point (`left` → `(outer.left, (outer.top+outer.bottom)/2)` etc.);
  - corner mode: `CornerHandles` gets an `onHandleDrag` prop and calls it with the corner point.
- Placement: positioned over the viewport. Default = the viewport quadrant diagonally opposite the
  handle's **screen** position, 8 px inset. The loupe is itself draggable (pointer capture); once
  dragged, its position is kept for the session (`sessionStorage['slabsense_loupePos']`, viewport
  fractions) and auto-placement is off. Fades in/out over 120 ms.

## 5. Vision views with intensity

- Buttons `Original | Emboss | Hi-pass | Edge` under the corner row, plus the existing-style
  intensity slider (0–100, default 70) shown when a non-Original view is active.
- Maps come from `genMaps(displayImage)` (already in `src/lib/image-utils.js`), computed lazily
  the first time a view is selected for the current step's image, cached per image, with a small
  "Building view…" state. The map is rendered as a second `<img>` over the base image inside the
  stage with `opacity = intensity/100`, so it zooms and pans with everything else. Handles stay
  on top.
- Views reset to Original when the step changes (the cropped image gets its own maps).

## 6. Undo

- History stack (max 50) of `{ outer, outerCorners, inner, innerCorners, rotation, tiltX, tiltY }`.
  Pushed on every handle pointerdown (both modes) and on the first tick of a rotation/tilt slider
  gesture. `Undo` pops and restores; disabled when empty. Cleared on step change and Reset.

## 7. Accessibility / desktop

- Corner buttons, Fit, Undo and view buttons are real `<button>`s with labels. Mouse wheel over the
  viewport zooms (`zoomAt` about the cursor); the loupe shows on mouse drags too.

## 8. Testing

- `src/lib/stage-view.test.js`: fit; zoomAt keeps the anchor fixed; zoomToImagePoint centers and
  clamps at the edges; pan clamps; z clamps to [1, 12].
- Manual on phone: pinch never zooms the page; corner button lands on the handle at 750 %; loupe
  tracks and can be dragged and remembers; views + slider; Undo restores; both steps; both modes;
  confirm output identical to before (same ratios for an untouched crop).
