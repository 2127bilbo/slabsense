/**
 * ============================================================================
 * CORNER / EDGE MODEL INPUT FOR THE PAID PATHS — cornerEdgeInput.js
 * ============================================================================
 * The app runs the trained corner and edge models in the browser and, when it
 * has, sends every slot's prediction along with a paid grade the same way it
 * sends centering. Here that table is validated, turned into a prompt block so
 * Claude can concentrate on surface damage, and turned into engine defects with
 * the SAME thresholds and severities as the free software grade
 * (src/lib/corner-edge-model.js). Claude's own CORNER / EDGE findings are then
 * replaced by the model's, so every path agrees on corners and edges by
 * construction. Without the table the paid paths behave exactly as before.
 *
 * Pure: no network, no DB. See docs/GRADING_SYSTEM.md, "Corner and edge models".
 * ============================================================================
 */
import { slotsToDings, MODEL_DEFAULTS } from '../../src/lib/corner-edge-model.js';

const CORNER_KEYS = ['TL', 'TR', 'BL', 'BR'];
const EDGE_KEYS = ['T', 'B', 'L', 'R'];

/** Slot -> the AI-path location label and an approximate box on the card (% of card). */
const SLOT_GEOMETRY = {
  corners: {
    TL: { location: 'TOP LEFT', x: 8, y: 7, width: 12, height: 9 },
    TR: { location: 'TOP RIGHT', x: 92, y: 7, width: 12, height: 9 },
    BL: { location: 'BOTTOM LEFT', x: 8, y: 93, width: 12, height: 9 },
    BR: { location: 'BOTTOM RIGHT', x: 92, y: 93, width: 12, height: 9 },
  },
  edges: {
    T: { location: 'TOP EDGE', x: 50, y: 4, width: 75, height: 9 },
    B: { location: 'BOTTOM EDGE', x: 50, y: 96, width: 75, height: 7 },
    L: { location: 'LEFT EDGE', x: 6, y: 50, width: 12, height: 82 },
    R: { location: 'RIGHT EDGE', x: 94, y: 50, width: 12, height: 82 },
  },
};
const ENGINE_LOCATION = { TL: 'TOPLEFT', TR: 'TOPRIGHT', BL: 'BOTTOMLEFT', BR: 'BOTTOMRIGHT', T: 'TOP', B: 'BOTTOM', L: 'LEFT', R: 'RIGHT' };

const num = (v, lo, hi) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : null);

function parseSlots(list, keys) {
  if (!Array.isArray(list)) return null;
  const byKey = new Map();
  for (const s of list) {
    if (!s || typeof s !== 'object') continue;
    const key = String(s.key || '').toUpperCase();
    if (!keys.includes(key)) continue;
    const wear = num(s.wear, 0, 1);
    const deduction = num(s.deduction, 0, 10000);
    if (wear === null || deduction === null) continue;
    const slot = { key, location: ENGINE_LOCATION[key], wear, deduction };
    const angle = num(s.angle, 0, 10000);
    if (angle !== null) slot.angle = angle;
    byKey.set(key, slot);
  }
  // Every slot must be present: a partial table would silently leave corners unjudged.
  if (byKey.size !== keys.length) return null;
  return keys.map((k) => byKey.get(k));
}

function parseSide(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const corners = parseSlots(raw.corners, CORNER_KEYS);
  const edges = parseSlots(raw.edges, EDGE_KEYS);
  if (!corners || !edges) return null;
  return { corners, edges };
}

/**
 * Validate the client's table. Returns { front, back|null } or null when the
 * input is absent or unusable (the paid path then falls back to Claude's own
 * corner/edge findings). The front is required; the back is optional so a
 * front-only grade still works.
 */
export function parseCornerEdgeInput(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const front = parseSide(raw.front);
  if (!front) return null;
  const back = raw.back ? parseSide(raw.back) : null;
  if (raw.back && !back) return null; // a malformed back is a bug, not "no back"
  return { front, back };
}

/** Engine-severity label for a slot, or null when it is below the wear threshold. */
function slotVerdict(task, slot, options) {
  const dings = slotsToDings(task, 'front', [slot], options);
  return dings.length ? dings[0].severity : null;
}

/**
 * Prompt section: the measured corner and edge state, so Claude skips them and
 * spends its inspection on surface damage. Clean slots are listed too — that is
 * information (it tells Claude a corner it might be tempted to flag is fine).
 */
export function cornerEdgeContextBlock(input, options = MODEL_DEFAULTS) {
  if (!input) return '';
  const lines = [];
  for (const [sideName, side] of [['FRONT', input.front], ['BACK', input.back]]) {
    if (!side) { lines.push(`${sideName}: not measured (front-only grading)`); continue; }
    const fmt = (task, slots, label) => slots.map((s) => {
      const v = slotVerdict(task, s, options);
      return `  ${label} ${SLOT_GEOMETRY[task][s.key].location.padEnd(12)} wear ${s.wear.toFixed(2)}  ${v ? `-> ${v.toUpperCase()} ${task === 'corners' ? 'corner' : 'edge'} wear (${Math.round(s.deduction)} pts)` : '-> clean'}`;
    }).join('\n');
    lines.push(`${sideName}:\n${fmt('corners', side.corners, 'corner')}\n${fmt('edges', side.edges, 'edge')}`);
  }
  return `## CORNERS AND EDGES — ALREADY MEASURED (context only, NOT your task)
A model trained on TAG's own corner and edge crops has already judged every
corner and edge of this card:
${lines.join('\n')}
These findings go directly to the scoring engine. Do NOT report CORNER or
EDGE defects — any you output will be discarded in favour of the measured
ones. Skip inspection steps 1, 2, 4 and 5. Spend that attention on the
SURFACE and on the catastrophic scan: creases, tears, dents, stains, pits,
scratches, print defects and play wear are yours to find.`;
}

/**
 * Engine defects for the model's findings, in the AI-path shape (side, type,
 * severity, location label, % box, description) so the damage map renders and
 * the saved-card columns stay the same. `source: 'model'` marks their origin.
 */
export function cornerEdgeDefects(input, options = MODEL_DEFAULTS) {
  if (!input) return [];
  const out = [];
  for (const [sideName, side] of [['FRONT', input.front], ['BACK', input.back]]) {
    if (!side) continue;
    for (const task of ['corners', 'edges']) {
      for (const d of slotsToDings(task, sideName, side[task], options)) {
        const key = Object.keys(ENGINE_LOCATION).find((k) => ENGINE_LOCATION[k] === d.location && (task === 'corners' ? CORNER_KEYS : EDGE_KEYS).includes(k));
        const geo = SLOT_GEOMETRY[task][key];
        out.push({
          side: sideName,
          type: task === 'corners' ? 'CORNER' : 'EDGE',
          severity: d.severity,
          location: geo.location,
          zone: null,
          x: geo.x, y: geo.y, width: geo.width, height: geo.height,
          description: `${d.desc} (model: wear ${d.wear}, ${d.deduction} pts)`,
          source: 'model',
          wear: d.wear,
          deduction: d.deduction,
        });
      }
    }
  }
  return out;
}

/**
 * Replace Claude's CORNER / EDGE defects with the model's. Everything else
 * Claude found is kept untouched. Returns the merged list plus the source tag
 * for the response meta.
 */
export function applyCornerEdge(sanitizedDefects, input, options = MODEL_DEFAULTS) {
  if (!input) return { defects: sanitizedDefects, source: 'ai' };
  const kept = (sanitizedDefects || []).filter((d) => d.type !== 'CORNER' && d.type !== 'EDGE');
  return { defects: [...kept, ...cornerEdgeDefects(input, options)], source: 'model' };
}
