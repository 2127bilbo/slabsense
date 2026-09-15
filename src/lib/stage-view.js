/**
 * Zoom/pan math for the centering tool's stage (pure, tested).
 *
 * Model: the stage is the image+overlay block, laid out to fill the viewport at z = 1.
 * A view { z, tx, ty } applies `translate(tx, ty) scale(z)` (origin 0,0) to the stage, so an
 * image point (ix, iy) lands at viewport px (ix / imgW * vw * z + tx, iy / imgH * vh * z + ty).
 * Clamping keeps the stage covering the viewport whenever z > 1 and z within [Z_MIN, Z_MAX].
 */
export const Z_MIN = 1;
export const Z_MAX = 12;
export const CORNER_Z = 7.5;

export const fit = () => ({ z: 1, tx: 0, ty: 0 });

export function clamp(view, vw, vh) {
  const z = Math.min(Z_MAX, Math.max(Z_MIN, view.z));
  if (z === 1) return { z: 1, tx: 0, ty: 0 };
  const minTx = vw - vw * z, minTy = vh - vh * z; // stage right/bottom edge must reach the viewport edge
  return {
    z,
    tx: Math.min(0, Math.max(minTx, view.tx)),
    ty: Math.min(0, Math.max(minTy, view.ty)),
  };
}

/** Zoom to z2 keeping the viewport point (px, py) over the same stage content. */
export function zoomAt(view, z2, px, py, vw, vh) {
  const z = Math.min(Z_MAX, Math.max(Z_MIN, z2));
  const k = z / view.z;
  return clamp({ z, tx: px - (px - view.tx) * k, ty: py - (py - view.ty) * k }, vw, vh);
}

/** Zoom to z2 with the image point (ix, iy) centered in the viewport (as far as clamping allows). */
export function zoomToImagePoint(view, z2, ix, iy, imgW, imgH, vw, vh) {
  const z = Math.min(Z_MAX, Math.max(Z_MIN, z2));
  const sx = (ix / imgW) * vw * z, sy = (iy / imgH) * vh * z;
  return clamp({ z, tx: vw / 2 - sx, ty: vh / 2 - sy }, vw, vh);
}

export function pan(view, dx, dy, vw, vh) {
  return clamp({ z: view.z, tx: view.tx + dx, ty: view.ty + dy }, vw, vh);
}

/** Viewport px → image coords. */
export function viewportToImage(view, px, py, imgW, imgH, vw, vh) {
  return {
    x: ((px - view.tx) / view.z) / vw * imgW,
    y: ((py - view.ty) / view.z) / vh * imgH,
  };
}

/** Image coords → viewport px. */
export function imageToViewport(view, ix, iy, imgW, imgH, vw, vh) {
  return {
    x: (ix / imgW) * vw * view.z + view.tx,
    y: (iy / imgH) * vh * view.z + view.ty,
  };
}
