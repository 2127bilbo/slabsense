/**
 * Line colour helpers for the centering tool.
 *
 * Three ways to keep the guide lines visible against any card:
 *   1. a manual swatch (LINE_PALETTE), remembered per device (loadLineStyle / saveLineStyle)
 *   2. a "halo": a contrasting band on the FAR side of the line (haloFor)
 *   3. automatic colour: sample the image along the line and pick the palette entry with the
 *      best worst-case contrast (sampleSegments + pickLineColor)
 *
 * Pure functions; no DOM except the optional localStorage in load/save.
 */

export const LINE_PALETTE = [
  { id: 'orange',  hex: '#ff9944' },
  { id: 'green',   hex: '#00ff88' },
  { id: 'cyan',    hex: '#00e5ff' },
  { id: 'magenta', hex: '#ff2d95' },
  { id: 'yellow',  hex: '#ffee00' },
  { id: 'white',   hex: '#ffffff' },
  { id: 'black',   hex: '#000000' },
];

export const DEFAULT_LINE_STYLE = { halo: false, auto: false, outer: '#ff9944', inner: '#00ff88' };
export const LINE_STYLE_KEY = 'slabsense_lineStyle';

export function loadLineStyle() {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(LINE_STYLE_KEY) : null;
    const v = raw ? JSON.parse(raw) : null;
    return v && typeof v === 'object' ? { ...DEFAULT_LINE_STYLE, ...v } : { ...DEFAULT_LINE_STYLE };
  } catch { return { ...DEFAULT_LINE_STYLE }; }
}

export function saveLineStyle(style) {
  try { if (typeof localStorage !== 'undefined') localStorage.setItem(LINE_STYLE_KEY, JSON.stringify(style)); } catch { /* ignore */ }
}

export function hexToRgb(hex) {
  const h = String(hex).replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export const luminance = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** 0 (identical) to 1 (black vs white). Weighted toward luminance, which the eye separates best. */
export function contrast(a, b) {
  const dl = Math.abs(luminance(a) - luminance(b)) / 255;
  const de = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) / Math.sqrt(3 * 255 * 255);
  return 0.6 * dl + 0.4 * de;
}

/** Halo colour for a line: dark under a light line, light under a dark line. */
export function haloFor(hex) {
  return luminance(hexToRgb(hex)) > 140 ? 'rgba(0,0,0,0.6)' : 'rgba(255,255,255,0.6)';
}

/** Four segments of an axis-aligned rect { left, top, right, bottom }. */
export function rectSegments(r) {
  return [
    { x1: r.left, y1: r.top, x2: r.right, y2: r.top },
    { x1: r.right, y1: r.top, x2: r.right, y2: r.bottom },
    { x1: r.right, y1: r.bottom, x2: r.left, y2: r.bottom },
    { x1: r.left, y1: r.bottom, x2: r.left, y2: r.top },
  ];
}

/** Four segments of a quad { tl, tr, br, bl }. */
export function quadSegments(q) {
  return [
    { x1: q.tl.x, y1: q.tl.y, x2: q.tr.x, y2: q.tr.y },
    { x1: q.tr.x, y1: q.tr.y, x2: q.br.x, y2: q.br.y },
    { x1: q.br.x, y1: q.br.y, x2: q.bl.x, y2: q.bl.y },
    { x1: q.bl.x, y1: q.bl.y, x2: q.tl.x, y2: q.tl.y },
  ];
}

/**
 * Sample pixels in a band of half-width `band` around each segment, every `stride` px along it.
 * @param {{data:Uint8ClampedArray,width:number,height:number}} img  ImageData-like; segment coords in its pixels
 * @returns {number[][]} [r,g,b] samples
 */
export function sampleSegments(img, segments, band = 4, stride = 2) {
  const out = [];
  const { data, width, height } = img;
  for (const s of segments) {
    const dx = s.x2 - s.x1, dy = s.y2 - s.y1, len = Math.hypot(dx, dy);
    if (len < 1) continue;
    const ux = dx / len, uy = dy / len;      // along
    const nx = -uy, ny = ux;                 // across
    for (let t = 0; t <= len; t += stride) {
      for (let b = -band; b <= band; b += Math.max(1, band / 2)) {
        const x = Math.round(s.x1 + ux * t + nx * b), y = Math.round(s.y1 + uy * t + ny * b);
        if (x < 0 || y < 0 || x >= width || y >= height) continue;
        const i = (y * width + x) * 4;
        out.push([data[i], data[i + 1], data[i + 2]]);
      }
    }
  }
  return out;
}

/**
 * Pick the palette colour with the best worst-case contrast against the samples
 * (the `pct` quantile of per-sample contrast, so a few odd pixels do not decide).
 */
export function pickLineColor(samples, palette = LINE_PALETTE, pct = 0.1) {
  if (!samples || samples.length === 0) return palette[0].hex;
  let best = palette[0].hex, bestScore = -1;
  for (const p of palette) {
    const rgb = hexToRgb(p.hex);
    const scores = samples.map((s) => contrast(rgb, s)).sort((a, b) => a - b);
    const q = scores[Math.min(scores.length - 1, Math.floor(scores.length * pct))];
    if (q > bestScore) { bestScore = q; best = p.hex; }
  }
  return best;
}
