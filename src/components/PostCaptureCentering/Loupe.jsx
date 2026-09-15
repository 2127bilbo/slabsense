import React, { useEffect, useRef, useState } from 'react';

/**
 * Loupe — a magnifier shown while a centering handle is dragged.
 *
 * Draws from the ORIGINAL image (full capture resolution), not the 1400-px display copy, so it
 * adds real detail even when the stage is already zoomed. Centered on `point` (display-space
 * coords, imgW×imgH). Placed in the viewport quadrant opposite the finger unless the user has
 * dragged the loupe somewhere, which is remembered for the session.
 *
 * Props:
 *   src          image URL to magnify
 *   imgW, imgH   display-space size that `point` is expressed in
 *   point        { x, y } in display space, or null to hide
 *   anchorScreen { x, y } of the finger in viewport px (for auto placement), or null
 *   viewportSize { w, h } of the viewport in px
 *   size         loupe size in CSS px (default 150)
 */
const STORAGE_KEY = 'slabsense_loupePos';
const mono = "'JetBrains Mono','SF Mono',monospace";

export function Loupe({ src, imgW, imgH, point, anchorScreen, viewportSize, size = 150 }) {
  const canvasRef = useRef(null);
  const imgRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [visible, setVisible] = useState(false);
  const [custom, setCustom] = useState(() => {
    try { const v = sessionStorage.getItem(STORAGE_KEY); return v ? JSON.parse(v) : null; } catch { return null; }
  });
  const drag = useRef(null);

  // Load the source once per src
  useEffect(() => {
    setReady(false);
    if (!src) return;
    const img = new Image();
    img.onload = () => { imgRef.current = img; setReady(true); };
    img.src = src;
    return () => { imgRef.current = null; };
  }, [src]);

  // Fade in/out with the drag
  useEffect(() => {
    if (point) { setVisible(true); return; }
    const t = setTimeout(() => setVisible(false), 120);
    return () => clearTimeout(t);
  }, [point]);

  // Draw
  useEffect(() => {
    const canvas = canvasRef.current, img = imgRef.current;
    if (!canvas || !img || !point || !ready) return;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    if (canvas.width !== size * dpr) { canvas.width = size * dpr; canvas.height = size * dpr; }
    const ctx = canvas.getContext('2d');
    const nw = img.naturalWidth, nh = img.naturalHeight;
    const scaleX = nw / imgW, scaleY = nh / imgH;         // display → source
    const win = Math.max(24, Math.round(nw / 24));         // source px shown across the loupe
    const sx = point.x * scaleX - win / 2, sy = point.y * scaleY - win / 2;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // drawImage clamps nothing, so clip the source window to the image and place it accordingly
    const cx0 = Math.max(0, sx), cy0 = Math.max(0, sy);
    const cx1 = Math.min(nw, sx + win), cy1 = Math.min(nh, sy + win);
    if (cx1 > cx0 && cy1 > cy0) {
      const k = canvas.width / win;
      ctx.drawImage(img, cx0, cy0, cx1 - cx0, cy1 - cy0, (cx0 - sx) * k, (cy0 - sy) * k, (cx1 - cx0) * k, (cy1 - cy0) * k);
    }
    // crosshair
    const mid = canvas.width / 2;
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = Math.max(1, dpr * 0.8);
    ctx.beginPath(); ctx.moveTo(mid, 0); ctx.lineTo(mid, canvas.height); ctx.moveTo(0, mid); ctx.lineTo(canvas.width, mid); ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = Math.max(1, dpr * 0.4);
    ctx.beginPath(); ctx.moveTo(mid + dpr, 0); ctx.lineTo(mid + dpr, canvas.height); ctx.moveTo(0, mid + dpr); ctx.lineTo(canvas.width, mid + dpr); ctx.stroke();
  }, [point, ready, imgW, imgH, size]);

  if (!visible || !viewportSize?.w) return null;

  // Placement
  const inset = 8;
  let left, top;
  if (custom) {
    left = Math.max(inset, Math.min(viewportSize.w - size - inset, custom.fx * viewportSize.w));
    top = Math.max(inset, Math.min(viewportSize.h - size - inset, custom.fy * viewportSize.h));
  } else {
    const ax = anchorScreen?.x ?? viewportSize.w / 2, ay = anchorScreen?.y ?? viewportSize.h / 2;
    left = ax < viewportSize.w / 2 ? viewportSize.w - size - inset : inset;   // opposite side of the finger
    top = ay < viewportSize.h / 2 ? viewportSize.h - size - inset : inset;
  }

  const magnification = imgRef.current ? (size * Math.min(3, window.devicePixelRatio || 1)) / Math.max(24, Math.round(imgRef.current.naturalWidth / 24)) : 0;

  return (
    <div
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
        const pos = { fx: nl / viewportSize.w, fy: nt / viewportSize.h };
        setCustom(pos);
        try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(pos)); } catch { /* ignore */ }
      }}
      onPointerUp={() => { drag.current = null; }}
      onPointerCancel={() => { drag.current = null; }}
    >
      <canvas ref={canvasRef} style={{ width: size, height: size, display: 'block' }} />
      <div style={{ position: 'absolute', right: 6, top: 4, fontFamily: mono, fontSize: 9, color: '#ddd', background: 'rgba(0,0,0,0.55)', padding: '2px 5px', borderRadius: 6, pointerEvents: 'none' }}>
        {magnification ? `${magnification.toFixed(1)}×` : ''}
      </div>
    </div>
  );
}

export default Loupe;
