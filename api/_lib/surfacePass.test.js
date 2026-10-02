/*
 * SlabSense — https://www.slabsenseai.com
 * Copyright (c) 2026 SlabSense. All rights reserved.
 * Proprietary and confidential; see LICENSE at the repository root.
 */
import assert from 'node:assert/strict';
import { buildSurfacePassPrompt, surfaceDefectsFromTiles, tileGeometry, mergeSurfacePass, TILE_GRID } from './surfacePass.js';
import { sanitizeDefects } from './detectionPrompt.js';

let passed = 0;
const ok = (name, fn) => { fn(); passed++; console.log(`  ✓ ${name}`); };

ok('tile geometry is row-major over a 2 x 3 grid', () => {
  assert.deepEqual(tileGeometry(0), { row: 0, col: 0, x: 0, y: 0, w: 0.5, h: 1 / 3 });
  assert.deepEqual(tileGeometry(1).col, 1); assert.deepEqual(tileGeometry(2), { row: 1, col: 0, x: 0, y: 1 / 3, w: 0.5, h: 1 / 3 });
  assert.equal(tileGeometry(5).row, 2);
});
ok('prompt names every tile and the side, surface types only, JSON contract', () => {
  const p = buildSurfacePassPrompt('back', 6);
  assert.match(p, /BACK of ONE trading card/); assert.match(p, /tile 6 = row 3 col 2/); assert.match(p, /PRINT_DEFECT/); assert.match(p, /"defects": \[\]/);
  assert.doesNotMatch(p, /CORNER|EDGE/);
});
ok('tile-relative boxes map into card percent coordinates', () => {
  const d = surfaceDefectsFromTiles([{ type: 'CREASE', severity: 'severe', tile: 3, x: 0.5, y: 0.5, width: 0.2, height: 0.1 }], 'back', 6);
  assert.equal(d.length, 1);
  assert.equal(d[0].side, 'BACK'); assert.equal(d[0].type, 'CREASE');
  assert.equal(d[0].x, 25); // tile 3 = row 2 col 1: x = 0 + 0.5 * 50
  assert.equal(d[0].y, 50); // y = 33.3 + 0.5 * 33.3
  assert.equal(d[0].width, 10); assert.equal(d[0].height, 3.3);
});
ok('unknown types and out-of-range tiles are handled', () => {
  const d = surfaceDefectsFromTiles([{ type: 'CORNER', tile: 1 }, { type: 'pit', tile: 99, severity: 'minor' }, { type: 'SCRATCH' }], 'front', 6);
  assert.equal(d.length, 2); assert.equal(d[0].type, 'PIT'); assert.equal(d[1].x, 25); // defaults: tile 1 centre
});
ok('mapped defects pass the engine sanitizer unchanged in count', () => {
  const d = surfaceDefectsFromTiles([{ type: 'SCRATCH', severity: 'moderate', tile: 2, x: 0.1, y: 0.9 }, { type: 'PLAY_WEAR', severity: 'minor', tile: 5 }], 'front', 6);
  assert.equal(sanitizeDefects(d).length, 2);
});
ok('merge keeps pass-1 corners and edges, replaces its surface guesses with the tiled ones', () => {
  const m = mergeSurfacePass([{ type: 'CORNER', side: 'FRONT' }, { type: 'SCRATCH', side: 'FRONT' }], [{ type: 'CREASE', side: 'BACK' }]);
  assert.deepEqual(m.map((d) => d.type), ['CORNER', 'CREASE']);
});
assert.deepEqual(TILE_GRID, { cols: 2, rows: 3 });
console.log(`${passed} passed, 0 failed`);
