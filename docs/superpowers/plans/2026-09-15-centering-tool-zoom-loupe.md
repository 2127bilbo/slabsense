# Centering Tool Zoom / Loupe / Views / Undo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In-app zoom/pan for the centering tool (no more stuck page zoom), corner buttons that jump to 750 % on a handle, a drag-time loupe drawn from the full-resolution capture, Emboss/Hi-pass/Edge views on our intensity slider, and Undo.

**Architecture:** A pure `stage-view.js` holds the zoom/pan math (tested). `PostCaptureCentering.jsx` wraps its existing image+SVG in a clipped viewport whose inner stage carries `translate/scale`; because handle coordinates already derive from the SVG's bounding box, handles work at any zoom. A `Loupe.jsx` canvas draws from the original image around the dragged handle. Vision maps reuse `genMaps()` and render as an overlay image inside the stage. `CornerHandles.jsx` gains `zoom` and `onHandleDrag` props.

**Tech Stack:** React 18, pointer events, canvas 2D, `src/lib/image-utils.js genMaps`.

**Spec:** `docs/superpowers/specs/2026-09-15-centering-tool-zoom-loupe-design.md`

## Global Constraints

- No change to centering math, `cropToOuterBounds`, `calculateCornerCentering`, or `onConfirm` payloads.
- Zoom range `[1, 12]`; corner zoom 7.5. View resets to fit on step change.
- Handle drags must never pan; pans/pinches must never move handles (handles already `stopPropagation` on pointerdown; the viewport ignores pointers whose target is inside a handle `<g>`).
- The page must never zoom: viewport has `touch-action: none` and cancels Safari `gesturestart`.
- Everything keeps working on desktop with a mouse (wheel = zoom about cursor).
- Commit messages end with the attribution lines from the session reminder; never `git add -A`.

---

### Task 1: `src/lib/stage-view.js` + test

**Files:** Create `src/lib/stage-view.js`, `src/lib/stage-view.test.js`; modify `package.json` (`test:lib`).

**Interfaces (produces):**
```js
export const Z_MIN = 1, Z_MAX = 12, CORNER_Z = 7.5;
export const fit = () => ({ z: 1, tx: 0, ty: 0 });
export function clamp(view, vw, vh)                          // z into [Z_MIN,Z_MAX]; stage covers viewport
export function zoomAt(view, z2, px, py, vw, vh)            // keep viewport point (px,py) fixed
export function zoomToImagePoint(view, z2, ix, iy, imgW, imgH, vw, vh) // center image point
export function pan(view, dx, dy, vw, vh)
export function viewportToImage(view, px, py, imgW, imgH, vw, vh)     // for tests / loupe placement
```
Model: a point at image coords (ix,iy) sits at viewport `(ix/imgW*vw*z + tx, iy/imgH*vh*z + ty)`.

- [ ] Write the test (fit; zoomAt keeps anchor; zoomToImagePoint centers, clamps at edges; pan clamps; z clamps) → run, fails on missing module → implement → passes → add to `test:lib` → commit `feat(centering): stage zoom/pan math`.

### Task 2: `Loupe.jsx`

**Files:** Create `src/components/PostCaptureCentering/Loupe.jsx`.

**Interface:** `<Loupe src imgW imgH point={{x,y}|null} viewportRef anchorScreen={{x,y}|null} />`
- `src`: original image URL (step 1) or cropped preview (step 2); loaded once per `src` into an `Image`.
- `imgW/imgH`: the display-space size the `point` is expressed in (1400-px space); the loupe maps to the source's natural size.
- Draws a 150×150 CSS-px canvas at `devicePixelRatio`, source window = `naturalWidth / 24` px wide, centered on the point; crosshair; label `${Math.round(magnification)}×`.
- Placement: opposite quadrant from `anchorScreen` (viewport-relative px) unless the user has dragged the loupe (stored in `sessionStorage.slabsense_loupePos` as `{fx, fy}` fractions). Draggable via pointer capture. Renders `null` when `point` is null (with a 120 ms fade-out).

- [ ] Implement → used in Task 3 → commit with Task 3.

### Task 3: Wire everything into `PostCaptureCentering.jsx` (+ `CornerHandles.jsx`)

**Edits in order:**
1. Imports: `stage-view`, `Loupe`, `genMaps` from `../../lib/image-utils.js`.
2. State: `view`, `activeCorner`, `viewMode` (`'original'|'emboss'|'highpass'|'edges'`), `viewIntensity` (70), `maps` (per-image cache `{ [src]: mapsObj }`), `mapsBusy`, `history` (ref array), `dragPoint` (`{x,y}|null`), `dragAnchor` (viewport px), `viewportRef`, `pointers` (ref Map).
3. Helpers: `viewportSize()` from `viewportRef.getBoundingClientRect()`; `zoomToCorner(c)`; `pushHistory()`; `undo()`; `handlePointForWhich(which)` (edge mode) → image point; `beginDrag(point, e)` / `moveDrag(point)` / `endDrag()` that set `dragPoint`/`dragAnchor` and push history on begin.
4. Viewport gestures: `onPointerDown/Move/Up/Cancel` on the viewport (ignore if `e.target.closest('[data-handle]')`), `onWheel`, `gesturestart` via `useEffect` addEventListener with `{ passive: false }`.
5. Render: controls row (corner buttons ◤◥◣◢ using `activeCorner`, `Undo`, zoom readout, `Fit`), view row (`Original/Emboss/Hi-pass/Edge` + slider when active), then the viewport/stage wrapper around the existing image+svg; a second `<img>` for the map overlay with `opacity`; `data-handle` attribute on every handle `<g>`; `sz = handleSize / view.z`, `lw`-derived widths `/ view.z`, dash `/ view.z`, `pad / view.z`; `<Loupe/>` rendered inside the viewport (absolute), outside the stage so it doesn't scale.
6. Edge-mode handles: pointerdown → `beginDrag(handlePointForWhich(which), e)`; pointermove → after `moveOuterHandle`/`moveInnerHandle`, `moveDrag(...)` with the new outer/inner via the ref; pointerup → `endDrag()`.
7. `CornerHandles`: new props `zoom = 1` (divide `handleSize`, `lw`, hit pad by it) and `onHandleDrag(pointOrNull, e)` called on pointerdown (with the corner point), pointermove (new point), pointerup (null). Add `data-handle` on the drag `<g>`.
8. Step change / Reset / Back: `setView(fit())`, `setActiveCorner(null)`, `setViewMode('original')`, clear history.
9. Rotation/tilt buttons: `pushHistory()` before each change.

- [ ] Implement, `npm run build`, `npm run test:lib`, then phone test per spec §8 → commit `feat(centering): in-app zoom, corner buttons, loupe, vision views, undo`.
