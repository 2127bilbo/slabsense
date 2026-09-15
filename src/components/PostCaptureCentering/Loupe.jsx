import React, { useEffect, useRef, useState } from 'react';

/**
 * Loupe — a magnifier shown while a centering handle is dragged.
 *
 * Draws from the ORIGINAL image (full capture resolution), not the 1400-px display copy, so it
 * adds real detail even when the stage is already zoomed: it always shows about 3× the current
 * stage scale (never below ~0.8 CSS px per source px). Placed in the visible part of the
 * viewport, in the quadrant opposite the finger, unless the user has dragged the loupe somewhere,
 * which is remembered for the session.
 *
 * Props:
 *   src          image URL to magnify
 *   imgW, imgH   display-space size that `point` is expressed in
 *   point        { x, y } in display space, or null to hide
 *   anchorScreen { x, y } of the finger in viewport px (for auto placement), or null
 *   visible      { x0, y0, x1, y1 } visible part of the viewport, in viewport px
 *   stageCssPerDisplayPx  how many CSS px one display-space px occupies on screen right now
 *   size         loupe size in CSS px (default 150)
 */
const STORAGE_KEY = 'slabsense_loupePos';
const mono = "'JetBrains Mono','SF Mono',monospace";
const BOOST = 3;        // loupe scale relative to the stage
const MIN_CSS_PER_SRC = 0.8;

export function Loupe({ src, imgW, imgH, point, anchorScreen, visible, stageCssPerDisplayPx = 0.3, size = 150 }) {
  const canvasRef = useRef(null);
  const imgRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [shown, setShown] = useState(false);
  const [magLabel, setMagLabel] = useState('');
  const [custom, setCustom] = useState(() => {
    try { const v = sessionStorage.getItem(STORAGE_KEY); return v ? JSON.parse(v) : null; } catch { return null; }
  });
  const drag = useRef(null);

  useEffect(() => {
    setReady(false);
    if (!src) return;
    const img = new Image();
    img.onload = () => { imgRef.current = img; setReady(true); };
    img.src = src;
    return () => { imgRef.current = null; };
  }, [src]);

  useEffect(() => {
    if (point) { setShown(true); return; }
    const t = setTimeout(() => setShown(false), 120);
    return () => clearTimeout(t);
  }, [point]);

  useEffect(() => {
    const canvas = canvasRef.current, img = imgRef.current;
    if (!canvas || !img || !point || !ready) return;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    if (canvas.width !== size * dpr) { canvas.width = size * dpr; canvas.height = size * dpr; }
    const ctx = canvas.getContext('2d');
    const nw = img.naturalWidth, nh = img.naturalHeight;
    const srcPerDisplay = nw / imgW;                                  // source px per display px
    const stageCssPerSrc = stageCssPerDisplayPx / srcPerDisplay;      // CSS px per source px on the stage now
    const loupeCssPerSrc = Math.max(MIN_CSS_PER_SRC, stageCssPerSrc * BOOST);
    const win = size / loupeCssPerSrc;                                // source px across the loupe
    setMagLabel(`${(loupeCssPerSrc / Math.max(1e-6, stageCssPerSrc)).toFixed(1)}×`);
    const sx = point.x * srcPerDisplay - win / 2, sy = point.y * (nh / imgH) - win / 2;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const cx0 = Math.max(0, sx), cy0 = Math.max(0, sy);
    const cx1 = Math.min(nw, sx + win), cy1 = Math.min(nh, sy + win);
    if (cx1 > cx0 && cy1 > cy0) {
      const k = canvas.width / win;
      ctx.drawImage(img, cx0, cy0, cx1 - cx0, cy1 - cy0, (cx0 - sx) * k, (cy0 - sy) * k, (cx1 - cx0) * k, (cy1 - cy0) * k);
    }
    const mid = canvas.width / 2;
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = Math.max(1, dpr * 1.6);
    ctx.beginPath(); ctx.moveTo(mid, 0); ctx.lineTo(mid, canvas.height); ctx.moveTo(0, mid); ctx.lineTo(canvas.width, mid); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = Math.max(1, dpr * 0.7);
    ctx.beginPath(); ctx.moveTo(mid, 0); ctx.lineTo(mid, canvas.height); ctx.moveTo(0, mid); ctx.lineTo(canvas.width, mid); ctx.stroke();
  }, [point, ready, imgW, imgH, size, stageCssPerDisplayPx]);

  if (!shown || !visible) return null;

  // Placement inside the VISIBLE part of the viewport
  const inset = 8;
  const vx0 = visible.x0 + inset, vy0 = visible.y0 + inset;
  const vx1 = Math.max(vx0, visible.x1 - size - inset), vy1 = Math.max(vy0, visible.y1 - size - inset);
  let left, top;
  if (custom) {
    left = Math.max(vx0, Math.min(vx1, custom.fx * (visible.x1 - visible.x0) + visible.x0));
    top = Math.max(vy0, Math.min(vy1, custom.fy * (visible.y1 - visible.y0) + visible.y0));
  } else {
    const ax = anchorScreen?.x ?? (visible.x0 + visible.x1) / 2, ay = anchorScreen?.y ?? (visible.y0 + visible.y1) / 2;
    left = ax < (visible.x0 + visible.x1) / 2 ? vx1 : vx0;   // opposite side of the finger
    top = ay < (visible.y0 + visible.y1) / 2 ? vy1 : vy0;
  }

  return (
    <div
      data-loupe="1"
      style={{
        position: 'absolute', left, top, width: size, height: size, zIndex: 5,
        borderRadius: 14, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.35)',
        boxShadow: '0 6px 24px rgba(0,0,0,0.6)', background: '#000',
        opacity: point ? 1 : 0, transition: 'opacity 120ms ease',
        touchAction: 'none', cursor: 'grab',
      }}
      onPointerDown={(e) => { e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId); drag.current = { dx: e.clientX - left, dy: e.clientY - top }; }}
      onPointerMove={(e) => {
        if (!drag.current) return;
        e.preventDefault();
        const nl = e.clientX - drag.current.dx, nt = e.clientY - drag.current.dy;
        const pos = { fx: (nl - visible.x0) / Math.max(1, visible.x1 - visible.x0), fy: (nt - visible.y0) / Math.max(1, visible.y1 - visible.y0) };
        setCustom(pos);
        try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(pos)); } catch { /* ignore */ }
      }}
      onPointerUp={() => { drag.current = null; }}
      onPointerCancel={() => { drag.current = null; }}
    >
      <canvas ref={canvasRef} style={{ width: size, height: size, display: 'block' }} />
      <div style={{ position: 'absolute', right: 6, top: 4, fontFamily: mono, fontSize: 9, color: '#ddd', background: 'rgba(0,0,0,0.55)', padding: '2px 5px', borderRadius: 6, pointerEvents: 'none' }}>
        {magLabel}
      </div>
    </div>
  );
}

export default Loupe;
