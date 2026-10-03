/*
 * SlabSense — https://www.slabsenseai.com
 * Copyright (c) 2026 SlabSense. All rights reserved.
 * Proprietary and confidential; see LICENSE at the repository root.
 */
/**
 * Words and lens layers for the photo-confidence medallion (src/lib/photo-confidence.js).
 * Bands as agreed with the owner 2026-10-03; Studio (9.5+) is only reachable from the rig.
 * The margins in the messages are guidance until the rig calibration measures them.
 */
export const BANDS = [
  { min: 9.5, name: 'Studio', msg: 'Captured under controlled studio light. The highest confidence SlabSense gives.' },
  { min: 9.0, name: 'Brilliant', msg: 'As good as a phone photo gets. This is the most reliable phone grade SlabSense can give.' },
  { min: 7.0, name: 'Sharp', msg: 'Good photos. The grade is a reliable estimate, within about half a grade.' },
  { min: 5.0, name: 'Clear', msg: 'A fair read. The grade could be off by about a grade.' },
  { min: 3.0, name: 'Hazy', msg: 'Usable, but the grade could be off by up to two grades.' },
  { min: 0, name: 'Cloudy', msg: 'This grade could be off by two grades or more. Retake before trusting it.' },
];
export function bandFor(score) { return BANDS.find((b) => score >= b.min - 1e-9); }

const PROBLEMS = {
  glare: { label: 'Glare on the card', fix: 'Move the light so it does not reflect off the card, or diffuse it.' },
  blur: { label: 'Soft focus', fix: 'Hold steady and let the outline turn green before the photo is taken.' },
  dark: { label: 'Too dark', fix: 'Add soft light from above or beside the card.' },
  fog: { label: 'Low contrast', fix: 'Use a plain white, grey or black background and avoid light behind the card.' },
  grain: { label: 'Grainy', fix: 'More light lets the camera take a cleaner photo.' },
  angle: { label: 'Shot at an angle', fix: 'Hold the phone flat above the card; the level guide helps.' },
  uneven: { label: 'Uneven light', fix: 'Light the card evenly so one side is not brighter than the other.' },
  small: { label: 'Card too small', fix: 'Move closer so the card fills more of the frame.' },
};
const CUTOFF = { key: 'cutoff', label: 'Card not fully in the photo', fix: 'Get all four corners in the photo; the grade cannot see what is outside it.' };

/** Measured problems at or above 0.3, worst first; a cut-off card replaces everything else. */
export function problemsFor(issues, cutoff) {
  if (cutoff) return [CUTOFF];
  return Object.entries(issues || {})
    .filter(([k, v]) => PROBLEMS[k] && v >= 0.3)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => ({ key: k, amount: v, ...PROBLEMS[k] }));
}

/** How strongly each lens render is blended in. Angle, uneven light and size have no lens of their
 *  own; they lower the number and appear in the problem list. A cut-off card shows the obstruction lens. */
export function lensLayers(issues, cutoff) {
  const i = issues || {};
  return { glare: i.glare || 0, blur: i.blur || 0, dark: i.dark || 0, fog: i.fog || 0, grain: i.grain || 0, finger: cutoff ? 0.85 : 0 };
}
