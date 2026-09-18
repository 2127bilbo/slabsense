/** Run: node api/_lib/cornerEdgeInput.test.js */
import { parseCornerEdgeInput, cornerEdgeContextBlock, cornerEdgeDefects, applyCornerEdge } from './cornerEdgeInput.js';
import { MODEL_DEFAULTS } from '../../src/lib/corner-edge-model.js';
import { sanitizeDefects, LOCATIONS } from './detectionPrompt.js';
import { gradeCard } from '../../src/lib/gradingEngine.js';

let passed = 0, failed = 0;
const check = (n, ok, extra = '') => { if (ok) { passed++; console.log(`  ✓ ${n}`); } else { failed++; console.log(`  ✗ ${n} ${extra}`); } };

const slots = (vals) => vals.map(([key, wear, deduction]) => ({ key, wear, deduction }));
const cleanSide = () => ({
  corners: slots([['TL', 0.01, 40], ['TR', 0.02, 45], ['BL', 0.01, 50], ['BR', 0.02, 42]]),
  edges: slots([['T', 0.01, 40], ['B', 0.01, 44], ['L', 0.02, 60], ['R', 0.01, 50]]),
});
const wornSide = () => ({
  corners: slots([['TL', 0.91, 320], ['TR', 0.35, 120], ['BL', 0.05, 60], ['BR', 0.6, 180]]),
  edges: slots([['T', 0.8, 260], ['B', 0.1, 50], ['L', 0.49, 300], ['R', 0.02, 40]]),
});

console.log('— parsing');
check('absent input is null', parseCornerEdgeInput(undefined) === null && parseCornerEdgeInput(null) === null && parseCornerEdgeInput('x') === null);
check('front only is accepted', parseCornerEdgeInput({ front: cleanSide() })?.back === null);
check('front and back are accepted', parseCornerEdgeInput({ front: cleanSide(), back: wornSide() })?.back?.corners.length === 4);
check('a missing slot rejects the side', parseCornerEdgeInput({ front: { corners: cleanSide().corners.slice(1), edges: cleanSide().edges } }) === null);
check('a malformed back rejects the whole input', parseCornerEdgeInput({ front: cleanSide(), back: { corners: [] } }) === null);
check('unknown keys are ignored, valid ones kept', parseCornerEdgeInput({ front: { corners: [...cleanSide().corners, { key: 'XX', wear: 0.9, deduction: 1 }], edges: cleanSide().edges } })?.front.corners.length === 4);
check('non-numeric wear rejects', parseCornerEdgeInput({ front: { corners: slots([['TL', 'high', 1], ['TR', 0, 1], ['BL', 0, 1], ['BR', 0, 1]]), edges: cleanSide().edges } }) === null);
const clamped = parseCornerEdgeInput({ front: { corners: slots([['TL', 7, -5], ['TR', 0, 1], ['BL', 0, 1], ['BR', 0, 1]]), edges: cleanSide().edges } });
check('values are clamped, not trusted', clamped.front.corners[0].wear === 1 && clamped.front.corners[0].deduction === 0);
check('slots come back in canonical order with engine locations', parseCornerEdgeInput({ front: wornSide() }).front.corners.map((s) => s.location).join(',') === 'TOPLEFT,TOPRIGHT,BOTTOMLEFT,BOTTOMRIGHT');
check('angle is optional and kept when present', parseCornerEdgeInput({ front: { corners: slots([['TL', 0, 1], ['TR', 0, 1], ['BL', 0, 1], ['BR', 0, 1]]).map((s) => ({ ...s, angle: 990 })), edges: cleanSide().edges } }).front.corners[0].angle === 990);

// Pin the thresholds: these tests check the plumbing, not the calibrated defaults.
const PIN = { corners: { wearThreshold: 0.3, severityCuts: { moderate: 150, severe: 300, extreme: 500 } }, edges: { wearThreshold: 0.5, severityCuts: { moderate: 150, severe: 300, extreme: 500 } } };

console.log('— prompt block');
const input = parseCornerEdgeInput({ front: wornSide(), back: cleanSide() });
const block = cornerEdgeContextBlock(input, PIN);
check('empty without input', cornerEdgeContextBlock(null) === '');
check('tells Claude corners and edges are measured', /ALREADY MEASURED/.test(block) && /Do NOT report CORNER or\s+EDGE/.test(block));
check('lists every slot of both sides', (block.match(/^  corner /gm) || []).length === 8 && (block.match(/^  edge /gm) || []).length === 8);
check('verdicts follow the calibrated thresholds', /TOP LEFT.*-> SEVERE corner wear/.test(block) && /BOTTOM LEFT.*-> clean/.test(block));
check('an edge under 0.5 wear is reported clean', /LEFT EDGE.*-> clean/.test(block));
check('front-only says so', /BACK: not measured/.test(cornerEdgeContextBlock(parseCornerEdgeInput({ front: cleanSide() }), PIN)));

console.log('— engine defects');
const defects = cornerEdgeDefects(input, PIN);
check('clean back yields nothing', defects.every((d) => d.side === 'FRONT'));
check('front fires per the thresholds (corners 0.3, edges 0.5)', defects.length === 4, String(defects.length));
check('corner and edge types only', defects.every((d) => d.type === 'CORNER' || d.type === 'EDGE'));
check('AI-path location labels', defects.every((d) => LOCATIONS.includes(d.location)));
check('every defect has a box on the card', defects.every((d) => d.x > 0 && d.y > 0 && d.width > 0 && d.height > 0));
check('severities come from the deduction', defects.find((d) => d.location === 'TOP LEFT').severity === 'severe' && defects.find((d) => d.location === 'TOP RIGHT').severity === 'minor');
check('origin is marked', defects.every((d) => d.source === 'model' && typeof d.wear === 'number'));
check('threshold override is honoured', cornerEdgeDefects(input, { corners: { ...MODEL_DEFAULTS.corners, wearThreshold: 0.95 }, edges: MODEL_DEFAULTS.edges }).filter((d) => d.type === 'CORNER').length === 0);

console.log('— merging with Claude');
const claude = sanitizeDefects([
  { side: 'FRONT', type: 'CORNER', severity: 'extreme', location: 'BOTTOM LEFT', x: 8, y: 92, width: 10, height: 10, description: 'claude corner' },
  { side: 'BACK', type: 'EDGE', severity: 'moderate', location: 'TOP EDGE', x: 50, y: 4, width: 80, height: 6, description: 'claude edge' },
  { side: 'FRONT', type: 'CREASE', severity: 'severe', location: 'MIDDLE CENTER', x: 50, y: 50, width: 40, height: 3, description: 'diagonal crease' },
  { side: 'BACK', type: 'SCRATCH', severity: 'minor', location: 'TOP CENTER', x: 50, y: 20, width: 5, height: 5, description: 'hairline' },
]);
const merged = applyCornerEdge(claude, input, PIN);
check('without input Claude is untouched', applyCornerEdge(claude, null).defects.length === 4 && applyCornerEdge(claude, null).source === 'ai');
check('Claude corner/edge findings are dropped', !merged.defects.some((d) => d.description === 'claude corner' || d.description === 'claude edge'));
check('Claude surface findings survive', merged.defects.some((d) => d.type === 'CREASE') && merged.defects.some((d) => d.type === 'SCRATCH'));
check('model findings are added', merged.defects.filter((d) => d.source === 'model').length === 4 && merged.source === 'model');
const engine = gradeCard({ defects: merged.defects, centering: { front: { lrRatio: 52, tbRatio: 51 }, back: { lrRatio: 50, tbRatio: 50 } } });
check('the engine grades the merged list', engine.overall.grade <= 6 && engine.defects.counts.corner === 3 && engine.defects.counts.edge === 1, JSON.stringify(engine.defects.counts));
check('engine keeps the origin tag on items', engine.defects.items.some((d) => d.source === 'model'));

console.log('— same numbers as the free grade');
// The free path builds its dings from the same slots via slotsToDings; the paid
// path must produce the same corner/edge subgrades for the same card.
import('../../src/lib/softwareGrade.js').then(({ computeGrade }) => {
  import('../../src/lib/corner-edge-model.js').then(({ slotsToDings }) => {
    const front = [...slotsToDings('corners', 'front', input.front.corners, PIN), ...slotsToDings('edges', 'front', input.front.edges, PIN)];
    const back = [...slotsToDings('corners', 'back', input.back.corners, PIN), ...slotsToDings('edges', 'back', input.back.edges, PIN)];
    const free = computeGrade(front, back, { lrRatio: 52, tbRatio: 51 }, { lrRatio: 50, tbRatio: 50 }, 'tag');
    const paid = gradeCard({ defects: cornerEdgeDefects(input, PIN), centering: { front: { lrRatio: 52, tbRatio: 51 }, back: { lrRatio: 50, tbRatio: 50 } } });
    const same = (k) => free.subgrades[k] === paid.subgrades[k];
    check('corner and edge subgrades match the free path exactly', ['frontCorners', 'backCorners', 'frontEdges', 'backEdges'].every(same), JSON.stringify([free.subgrades, paid.subgrades]));
    check('overall matches when no surface defects are present', free.overall.grade === paid.overall.grade);
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
  });
});
