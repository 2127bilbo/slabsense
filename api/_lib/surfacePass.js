/**
 * ============================================================================
 * TILED SURFACE PASS — surfacePass.js
 * ============================================================================
 * Why: at the 1,568 px Claude receives a whole card, a scuff is one pixel wide
 * and it misses most of what TAG marks on the surface. Given the same side as
 * six native-resolution tiles (2 x 3) it finds the creases, scuffs and pits
 * that a person sees (measured 2026-10-02: grade error 1.75 -> 1.19 on the
 * surface-marked cards; docs/GRADING_SYSTEM.md "Paid path accuracy").
 *
 * The client cuts the tiles from its full-resolution crop (src/services/api.js
 * cutSurfaceTiles) and uploads them; this module builds the surface-only
 * prompt and maps tile-relative findings back to card coordinates in the
 * engine's shape. The reference pass then sees them as prior findings.
 * ============================================================================
 */

export const TILE_GRID = { cols: 2, rows: 3 };
export const MAX_TILES_PER_SIDE = 8;

/** Fractional geometry of tile i (row-major) in a cols x rows grid. */
export function tileGeometry(i, { cols, rows } = TILE_GRID) {
  const row = Math.floor(i / cols), col = i % cols;
  return { row, col, x: col / cols, y: row / rows, w: 1 / cols, h: 1 / rows };
}

export const SURFACE_TYPES = ['SCRATCH', 'CREASE', 'DENT', 'PIT', 'PRINT_DEFECT', 'STAIN', 'PLAY_WEAR', 'TEAR'];

/** The surface-only prompt for one side given `n` tiles in reading order. */
export function buildSurfacePassPrompt(side, n, grid = TILE_GRID) {
  const SIDE = String(side).toUpperCase();
  const order = Array.from({ length: n }, (_, i) => { const g = tileGeometry(i, grid); return `tile ${i + 1} = row ${g.row + 1} col ${g.col + 1}`; }).join(', ');
  return `You are inspecting the ${SIDE} of ONE trading card for SURFACE defects only. You are given ${n} close-up tiles that together cover the whole ${SIDE}, in reading order (row by row from the top-left): ${order}. Each tile is a magnified crop of the same physical card, not a different card.

Look for: scratches, scuffs and whitened lines in the ink, creases or bends (a line where the paper has folded), dents, pits (tiny holes in the gloss), print lines (fine straight lines of lighter ink from the press), print defects (ink spots, missing ink), stains and residue, and play wear (dull or whitened areas from handling, usually near the edges and corners). Ignore anything outside the card and the card's own rounded corners. Holographic foil pattern, printed texture and halftone dots are NOT defects. If a mark looks like a glare highlight, say so and do not list it.

Report ONLY surface defects you can actually see. Give each one as JSON with: "side" ("${SIDE}"), "type" (one of ${SURFACE_TYPES.join(', ')}), "severity" (minor | moderate | severe | extreme), "tile" (the tile number it is in), "x","y","width","height" as fractions 0-1 of that TILE, "description" (one sentence). Write one short paragraph of what you see first, then the JSON object: {"defects": [...]}. If there are none, return {"defects": []}.`;
}

/**
 * Tile-relative findings -> engine defects in percent of the card (the shape
 * sanitizeDefects / the engine accept). Unknown types are dropped.
 */
export function surfaceDefectsFromTiles(parsedDefects, side, n, grid = TILE_GRID) {
  const SIDE = String(side).toUpperCase();
  const out = [];
  for (const d of parsedDefects || []) {
    const type = String(d.type || '').toUpperCase();
    if (!SURFACE_TYPES.includes(type)) continue;
    const idx = Math.min(Math.max((Number(d.tile) || 1) - 1, 0), Math.max(n - 1, 0));
    const t = tileGeometry(idx, grid);
    const fx = clamp01(d.x, 0.5), fy = clamp01(d.y, 0.5), fw = clamp01(d.width, 0.05), fh = clamp01(d.height, 0.05);
    out.push({
      side: SIDE, type, severity: d.severity, location: d.location || null,
      x: round1((t.x + fx * t.w) * 100), y: round1((t.y + fy * t.h) * 100),
      width: round1(fw * t.w * 100), height: round1(fh * t.h * 100),
      description: d.description || `${type.toLowerCase()} (tiled surface pass, tile ${idx + 1})`,
      source: 'surface-pass',
    });
  }
  return out;
}

const clamp01 = (v, dflt) => { const n = Number(v); return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : dflt; };
const round1 = (v) => Math.round(v * 10) / 10;

/** Pass-1 corner/edge findings plus the tiled surface findings (tiles replace pass 1's surface guesses). */
export function mergeSurfacePass(pass1Defects, tiledDefects) {
  const keep = (pass1Defects || []).filter((d) => d.type === 'CORNER' || d.type === 'EDGE');
  return [...keep, ...(tiledDefects || [])];
}
