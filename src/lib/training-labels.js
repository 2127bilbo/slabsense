/**
 * Label maths for the card model's real-photo set (src/services/trainingCapture.js).
 * Pure: no Supabase, no DOM, so it runs under Node for tests.
 */

/**
 * The card outline the user confirmed in the centering tool, as fractions of
 * the photo. The tool records corners in its display space (`source.imgW/imgH`);
 * dividing by that size makes the label independent of how the photo was
 * scaled to fit the screen.
 * @returns {{tl:{x,y},tr:{x,y},bl:{x,y},br:{x,y}}|null}
 */
export function normalisedCorners(centeringData) {
  const c = centeringData?.outerCorners;
  const w = centeringData?.source?.imgW;
  const h = centeringData?.source?.imgH;
  if (!c || !w || !h) return null;
  const pt = (p) => (p && Number.isFinite(p.x) && Number.isFinite(p.y) ? { x: p.x / w, y: p.y / h } : null);
  const out = { tl: pt(c.tl), tr: pt(c.tr), bl: pt(c.bl), br: pt(c.br) };
  return Object.values(out).every(Boolean) ? out : null;
}
