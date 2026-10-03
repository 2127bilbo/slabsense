/*
 * SlabSense — https://www.slabsenseai.com
 * Copyright (c) 2026 SlabSense. All rights reserved.
 * Proprietary and confidential; see LICENSE at the repository root.
 */
/**
 * The scanning guide: four slides shown the first time the camera opens, and from the "?" in the
 * camera any time. Each slide describes how SlabSense's capture actually works (plain background for
 * the card model, all four corners, soft light for glare, the level and auto-snap).
 * The animations live in src/components/Capture/ScanGuide.jsx, keyed by `anim`.
 */

export const GUIDE_KEY = 'slabsense_scanGuideSeen';

export const SLIDES = [
  {
    key: 'background', anim: 'drop',
    title: 'Use a plain background',
    body: 'Set the card on a plain white, grey or black surface. Patterns, wood grain and other cards make the edges harder to find.',
  },
  {
    key: 'frame', anim: 'corners',
    title: 'Get the whole card in',
    body: 'All four corners in the photo, with a little space around them. Take the card out of any sleeve, top loader or case first.',
  },
  {
    key: 'light', anim: 'glare',
    title: 'Use soft, even light',
    body: 'Daylight from a window or a ceiling light works well. If you see glare on the card, tilt it or move the light; glare and shadows hide wear.',
  },
  {
    key: 'steady', anim: 'snap',
    title: 'Hold steady and let it snap',
    body: 'Hold the phone flat above the card. When the outline turns green and the level is centered, SlabSense takes the photo for you.',
  },
];

/** True until the guide has been finished or turned off. Storage errors (private mode) show it. */
export function shouldAutoShowGuide(storage = globalThis.localStorage) {
  try { return storage?.getItem(GUIDE_KEY) !== '1'; } catch { return true; }
}

export function markGuideSeen(storage = globalThis.localStorage) {
  try { storage?.setItem(GUIDE_KEY, '1'); } catch { /* private mode: it shows again next time */ }
}
