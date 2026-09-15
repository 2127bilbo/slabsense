/**
 * PostCaptureCentering - 2-Step Centering UI after photo capture
 *
 * Step 1: Card Edge Detection
 *   - User aligns outer boundary to card edges
 *   - Rotation/perspective controls available
 *   - "Next" crops and straightens the card
 *
 * Step 2: Artwork Detection
 *   - User aligns inner boundary to artwork edges
 *   - Working on clean cropped card image
 *   - "Back" returns to Step 1, "Confirm" finalizes
 */

import React, { useState, useRef, useEffect } from 'react';
import { CornerHandles, EdgeBreakdownPanel } from '../CornerHandles.jsx';
import { calculateCornerCentering } from '../../lib/corner-measurement.js';
import { fit as fitView, zoomAt, zoomToImagePoint, pan as panView, imageToViewport, CORNER_Z } from '../../lib/stage-view.js';
import { genMaps, loadImg } from '../../lib/image-utils.js';
import { LINE_PALETTE, loadLineStyle, saveLineStyle, haloFor, sampleSegments, pickLineColor, rectSegments, quadSegments } from '../../lib/line-color.js';
import { Loupe } from './Loupe.jsx';
import {
  initializeCorners,
  initializeInnerCorners,
  cropToOuterBounds,
  getBoundsFromCorners,
} from '../../lib/centering-utils.js';

const mono = "'JetBrains Mono','SF Mono',monospace";

export function PostCaptureCentering({
  image,
  side = 'front',
  onConfirm,
  onSkip,
  initial = null,             // centeringData from a previous confirm → reopen with the saved points
  initialCroppedImage = null, // the crop that went with `initial` (reopens straight at step 2)
  onCancel = null,            // when given, a Cancel button closes the tool without changes
}) {
  // ═══════════════════════════════════════════
  // STEP STATE
  // ═══════════════════════════════════════════
  const [step, setStep] = useState(1); // 1 = card edge, 2 = artwork
  const [croppedPreview, setCroppedPreview] = useState(null);
  const [croppedImgSize, setCroppedImgSize] = useState({ w: 0, h: 0 });

  const [imgSize, setImgSize] = useState({ w: 0, h: 0 });
  const [isProcessing, setIsProcessing] = useState(false);

  // Measurement mode toggle - corner mode is default (handles tilted cards better)
  const [measureMode, setMeasureMode] = useState(() => {
    if (initial?.measureMode) return initial.measureMode;
    try { return localStorage.getItem('slabsense_measureMode') || 'corner'; }
    catch { return 'corner'; }
  });
  useEffect(() => {
    try { localStorage.setItem('slabsense_measureMode', measureMode); }
    catch {}
  }, [measureMode]);

  // Edge-drag mode state (4 boundaries)
  const [outer, setOuter] = useState(null);
  const [inner, setInner] = useState(null);

  // Corner-anchored mode state (8 corners)
  const [outerCorners, setOuterCorners] = useState(null);
  const [innerCorners, setInnerCorners] = useState(null);
  const [cornerCenteringResult, setCornerCenteringResult] = useState(null);

  // Transform state (Step 1 only)
  const [rotation, setRotation] = useState(initial?.rotation || 0);
  const [tiltX, setTiltX] = useState(initial?.tiltX || 0);
  const [tiltY, setTiltY] = useState(initial?.tiltY || 0);
  const [activeAxis, setActiveAxis] = useState('Z');

  // Stage zoom/pan, corner zoom, vision views, loupe, undo (see docs/superpowers/specs/2026-09-15-centering-tool-zoom-loupe-design.md)
  const [view, setView] = useState(fitView());
  const [activeCorner, setActiveCorner] = useState(null);          // 'tl' | 'tr' | 'bl' | 'br' | null
  const [viewMode, setViewMode] = useState('original');            // 'original' | 'emboss' | 'highpass' | 'edges'
  const [viewIntensity, setViewIntensity] = useState(70);
  const [maps, setMaps] = useState({});                            // { [imageSrc]: genMaps() result }
  const [mapsBusy, setMapsBusy] = useState(false);
  const [dragPoint, setDragPoint] = useState(null);                // { x, y } in display coords while a handle is held
  const [dragAnchor, setDragAnchor] = useState(null);              // finger position in viewport px
  const [undoCount, setUndoCount] = useState(0);
  // Guide-line style: manual swatch / halo / automatic colour from the card (see src/lib/line-color.js)
  const [lineStyle, setLineStyle] = useState(loadLineStyle);
  const [showLineSettings, setShowLineSettings] = useState(false);
  const [autoColors, setAutoColors] = useState({});                // { outer?, inner? } picked from the image
  const [sampleTick, setSampleTick] = useState(0);                 // bumps on handle release -> re-sample
  const pixelsRef = useRef({});                                    // { [src]: ImageData (small) }
  const updateLineStyle = (patch) => setLineStyle((prev) => { const next = { ...prev, ...patch }; saveLineStyle(next); return next; });
  const viewportRef = useRef(null);
  const actionBarRef = useRef(null);
  const pointersRef = useRef(new Map());
  const gestureRef = useRef(null);
  const historyRef = useRef([]);
  const dragActiveRef = useRef(false);

  const svgRef = useRef(null);
  const dragging = useRef(null);
  const dragOffsetRef = useRef({ x: 0, y: 0 });   // edge mode: line position minus finger position at pointerdown
  const outerRef = useRef(outer);
  const innerRef = useRef(inner);
  // Step-1 geometry (card edge on the ORIGINAL photo, display coords). Kept across the crop so
  // Back restores it and Confirm saves it, which is what lets the tool reopen with the same points.
  const sourceRef = useRef(null);
  // Art points from the last visit to step 2, so Back → Next keeps them (scaled to the new crop)
  const prevInnerRef = useRef(null);

  useEffect(() => { outerRef.current = outer; }, [outer]);
  useEffect(() => { innerRef.current = inner; }, [inner]);

  // ═══════════════════════════════════════════
  // STEP 1: Initialize from original image
  // ═══════════════════════════════════════════
  useEffect(() => {
    if (!image) return;

    const MAX_DIM = 1400;
    const img = new Image();
    img.onload = () => {
      let w = img.width;
      let h = img.height;
      if (Math.max(w, h) > MAX_DIM) {
        const scale = MAX_DIM / Math.max(w, h);
        w = Math.round(w * scale);
        h = Math.round(h * scale);
      }
      setImgSize({ w, h });

      const src = initial?.source;
      if (src?.outer && src.imgW) {
        // Reopen with the card-edge points saved last time (scaled if the display size changed)
        const k = w / src.imgW;
        const sc = (pt) => ({ x: pt.x * k, y: pt.y * k });
        const o = { left: src.outer.left * k, right: src.outer.right * k, top: src.outer.top * k, bottom: src.outer.bottom * k };
        const oc = src.outerCorners
          ? { tl: sc(src.outerCorners.tl), tr: sc(src.outerCorners.tr), bl: sc(src.outerCorners.bl), br: sc(src.outerCorners.br) }
          : { tl: { x: o.left, y: o.top }, tr: { x: o.right, y: o.top }, bl: { x: o.left, y: o.bottom }, br: { x: o.right, y: o.bottom } };
        setOuter(o);
        setOuterCorners(oc);
        sourceRef.current = { outer: o, outerCorners: src.outerCorners ? oc : null, imgW: w, imgH: h };
        if (initialCroppedImage && (initial.inner || initial.innerCorners)) {
          enterStep2(initialCroppedImage, initial);   // straight to the artwork step with the saved art points
          return;
        }
      } else {
        // Initialize outer bounds (card edge) with small margin (2%)
        const margin = 0.02;
        const initOuter = {
          left: Math.round(w * margin),
          right: Math.round(w * (1 - margin)),
          top: Math.round(h * margin),
          bottom: Math.round(h * (1 - margin)),
        };
        setOuter(initOuter);
        setOuterCorners({
          tl: { x: initOuter.left, y: initOuter.top },
          tr: { x: initOuter.right, y: initOuter.top },
          bl: { x: initOuter.left, y: initOuter.bottom },
          br: { x: initOuter.right, y: initOuter.bottom },
        });
      }

      // Inner will be initialized in Step 2 after crop
      setInner(null);
      setInnerCorners(null);
    };
    img.src = image;
  }, [image]);

  // ═══════════════════════════════════════════
  // COORDINATE HELPERS
  // ═══════════════════════════════════════════
  const currentImgSize = step === 1 ? imgSize : croppedImgSize;

  const getCoords = (e) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    return {
      x: Math.round((e.clientX - rect.left) / rect.width * currentImgSize.w),
      y: Math.round((e.clientY - rect.top) / rect.height * currentImgSize.h),
    };
  };

  // ═══════════════════════════════════════════
  // STAGE VIEW: zoom / pan / corner buttons
  // ═══════════════════════════════════════════
  const viewportSize = () => {
    const r = viewportRef.current?.getBoundingClientRect();
    return r ? { w: r.width, h: r.height } : { w: 0, h: 0 };
  };

  /** Display-space point of a corner's handle for the current step/mode. */
  const cornerPoint = (c) => {
    if (step === 1) {
      if (measureMode === 'corner' && outerCorners) return outerCorners[c];
      if (outer) return { x: c.endsWith('l') ? outer.left : outer.right, y: c.startsWith('t') ? outer.top : outer.bottom };
    } else {
      if (measureMode === 'corner' && innerCorners) return innerCorners[c];
      if (inner) return { x: c.endsWith('l') ? inner.left : inner.right, y: c.startsWith('t') ? inner.top : inner.bottom };
    }
    return null;
  };

  const zoomToCorner = (c) => {
    if (activeCorner === c) { setActiveCorner(null); setView(fitView()); return; }
    const p = cornerPoint(c); const { w, h } = viewportSize();
    if (!p || !w) return;
    setActiveCorner(c);
    setView(v => zoomToImagePoint(v, CORNER_Z, p.x, p.y, currentImgSize.w, currentImgSize.h, w, h));
  };
  const resetView = () => { setActiveCorner(null); setView(fitView()); };

  // Reset zoom, view mode and history whenever the step changes (new image)
  useEffect(() => { resetView(); setViewMode('original'); historyRef.current = []; setUndoCount(0); }, [step]);

  // Viewport gestures: pinch to zoom, one-finger pan when zoomed. Handles stop propagation on
  // pointerdown so they never reach here; the loupe does the same.
  const onViewportPointerDown = (e) => {
    if (e.target.closest?.('[data-handle]') || e.target.closest?.('[data-loupe]')) return;
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    const pts = [...pointersRef.current.values()];
    if (pts.length === 2) {
      gestureRef.current = { mode: 'pinch', dist: Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y), mid: { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 } };
    } else if (pts.length === 1) {
      gestureRef.current = { mode: 'pan', last: { x: e.clientX, y: e.clientY } };
    }
  };
  const onViewportPointerMove = (e) => {
    if (!pointersRef.current.has(e.pointerId)) return;
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gestureRef.current; if (!g) return;
    const rect = viewportRef.current.getBoundingClientRect();
    const pts = [...pointersRef.current.values()];
    if (g.mode === 'pinch' && pts.length === 2) {
      e.preventDefault();
      const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
      const k = g.dist > 0 ? dist / g.dist : 1;
      setView(v => panView(zoomAt(v, v.z * k, mid.x - rect.left, mid.y - rect.top, rect.width, rect.height), mid.x - g.mid.x, mid.y - g.mid.y, rect.width, rect.height));
      setActiveCorner(null);
      g.dist = dist; g.mid = mid;
    } else if (g.mode === 'pan' && pts.length === 1) {
      const dx = e.clientX - g.last.x, dy = e.clientY - g.last.y;
      g.last = { x: e.clientX, y: e.clientY };
      setView(v => (v.z > 1 ? panView(v, dx, dy, rect.width, rect.height) : v));
    }
  };
  const onViewportPointerUp = (e) => {
    pointersRef.current.delete(e.pointerId);
    const pts = [...pointersRef.current.entries()];
    gestureRef.current = pts.length === 1 ? { mode: 'pan', last: { x: pts[0][1].x, y: pts[0][1].y } } : null;
  };

  // Wheel zoom (desktop) and Safari page-zoom suppression need non-passive listeners.
  useEffect(() => {
    const el = viewportRef.current; if (!el) return;
    const onWheel = (e) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const k = Math.exp(-e.deltaY * 0.0025);
      setView(v => zoomAt(v, v.z * k, e.clientX - rect.left, e.clientY - rect.top, rect.width, rect.height));
      setActiveCorner(null);
    };
    const block = (e) => e.preventDefault();
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('gesturestart', block, { passive: false });
    el.addEventListener('gesturechange', block, { passive: false });
    return () => { el.removeEventListener('wheel', onWheel); el.removeEventListener('gesturestart', block); el.removeEventListener('gesturechange', block); };
  }, [step]);

  // ═══════════════════════════════════════════
  // UNDO + LOUPE hooks
  // ═══════════════════════════════════════════
  const pushHistory = () => {
    historyRef.current.push({ outer, outerCorners, inner, innerCorners, rotation, tiltX, tiltY });
    if (historyRef.current.length > 50) historyRef.current.shift();
    setUndoCount(historyRef.current.length);
  };
  const undo = () => {
    const h = historyRef.current.pop(); if (!h) return;
    setOuter(h.outer); setOuterCorners(h.outerCorners); setInner(h.inner); setInnerCorners(h.innerCorners);
    setRotation(h.rotation); setTiltX(h.tiltX); setTiltY(h.tiltY);
    setUndoCount(historyRef.current.length);
  };
  const withHistory = (fn) => { pushHistory(); fn(); };

  /** Called by every handle on pointerdown/move (point) and pointerup (null). */
  const onHandleDrag = (point, e) => {
    if (point) {
      if (!dragActiveRef.current) { dragActiveRef.current = true; pushHistory(); }
      setDragPoint(point);
      if (e && viewportRef.current) { const r = viewportRef.current.getBoundingClientRect(); setDragAnchor({ x: e.clientX - r.left, y: e.clientY - r.top }); }
    } else {
      if (dragActiveRef.current) setSampleTick((t) => t + 1);
      dragActiveRef.current = false;
      setDragPoint(null);
    }
  };
  /** Display-space point for an edge-mode handle, from the latest bounds. */
  const edgeHandlePoint = (which) => {
    const o = outerRef.current, i = innerRef.current;
    switch (which) {
      case 'OL': return o && { x: o.left, y: (o.top + o.bottom) / 2 };
      case 'OR': return o && { x: o.right, y: (o.top + o.bottom) / 2 };
      case 'OT': return o && { x: (o.left + o.right) / 2, y: o.top };
      case 'OB': return o && { x: (o.left + o.right) / 2, y: o.bottom };
      case 'IL': return i && { x: i.left, y: (i.top + i.bottom) / 2 };
      case 'IR': return i && { x: i.right, y: (i.top + i.bottom) / 2 };
      case 'IT': return i && { x: (i.left + i.right) / 2, y: i.top };
      case 'IB': return i && { x: (i.left + i.right) / 2, y: i.bottom };
      default: return null;
    }
  };

  // Vision maps (emboss / hi-pass / edges) for the current image, computed lazily
  useEffect(() => {
    const src = step === 1 ? image : croppedPreview;
    if (viewMode === 'original' || !src || maps[src] || mapsBusy) return;
    let cancelled = false;
    setMapsBusy(true);
    genMaps(src).then((m) => { if (!cancelled && m) setMaps((prev) => ({ ...prev, [src]: m })); }).finally(() => { if (!cancelled) setMapsBusy(false); });
    return () => { cancelled = true; };
  }, [viewMode, step, image, croppedPreview]);

  // Automatic line colour: sample the image along the line's current position (on open and on
  // handle release, never mid-drag) and pick the palette colour with the best worst-case contrast.
  const autoSrc = step === 1 ? image : croppedPreview;
  const autoSizeW = step === 1 ? imgSize.w : croppedImgSize.w;
  const hasOuterGeom = !!(outer || outerCorners), hasInnerGeom = !!(inner || innerCorners);
  useEffect(() => {
    if (!lineStyle.auto || !autoSrc || !autoSizeW) return;
    let cancelled = false;
    (async () => {
      let px = pixelsRef.current[autoSrc];
      if (!px) { const r = await loadImg(autoSrc, 500); if (!r) return; px = r.data; pixelsRef.current = { [autoSrc]: px }; }
      if (cancelled) return;
      const k = px.width / autoSizeW;
      const scaled = (segs) => segs.map((g) => ({ x1: g.x1 * k, y1: g.y1 * k, x2: g.x2 * k, y2: g.y2 * k }));
      const pick = (segs) => pickLineColor(sampleSegments(px, scaled(segs), Math.max(2, px.width * 0.015), 2));
      const o = outerRef.current, i = innerRef.current;
      if (step === 1) {
        const segs = measureMode === 'corner' ? (outerCorners && quadSegments(outerCorners)) : (o && rectSegments(o));
        if (segs) setAutoColors((c) => ({ ...c, outer: pick(segs) }));
      } else if (step === 2) {
        const segs = measureMode === 'corner' ? (innerCorners && quadSegments(innerCorners)) : (i && rectSegments(i));
        if (segs) setAutoColors((c) => ({ ...c, inner: pick(segs) }));
      }
    })();
    return () => { cancelled = true; };
  }, [lineStyle.auto, autoSrc, autoSizeW, step, measureMode, sampleTick, hasOuterGeom, hasInnerGeom]);

  // ═══════════════════════════════════════════
  // STEP 1: Edge drag handlers (outer only)
  // ═══════════════════════════════════════════
  const moveOuterHandle = (which, x, y) => {
    const o = outerRef.current;
    if (!o) return;

    // No inner constraint in Step 1
    if (which === 'OL') setOuter(p => ({ ...p, left: Math.max(0, Math.min(p.right - 50, x)) }));
    else if (which === 'OR') setOuter(p => ({ ...p, right: Math.min(imgSize.w, Math.max(p.left + 50, x)) }));
    else if (which === 'OT') setOuter(p => ({ ...p, top: Math.max(0, Math.min(p.bottom - 50, y)) }));
    else if (which === 'OB') setOuter(p => ({ ...p, bottom: Math.min(imgSize.h, Math.max(p.top + 50, y)) }));
  };

  // ═══════════════════════════════════════════
  // STEP 2: Inner drag handlers (artwork only)
  // ═══════════════════════════════════════════
  const moveInnerHandle = (which, x, y) => {
    const inn = innerRef.current;
    if (!inn) return;

    // Constrain to cropped image bounds with min size
    if (which === 'IL') setInner(p => ({ ...p, left: Math.max(8, Math.min(p.right - 30, x)) }));
    else if (which === 'IR') setInner(p => ({ ...p, right: Math.min(croppedImgSize.w - 8, Math.max(p.left + 30, x)) }));
    else if (which === 'IT') setInner(p => ({ ...p, top: Math.max(8, Math.min(p.bottom - 30, y)) }));
    else if (which === 'IB') setInner(p => ({ ...p, bottom: Math.min(croppedImgSize.h - 8, Math.max(p.top + 30, y)) }));
  };

  // ═══════════════════════════════════════════
  // STEP 1 → STEP 2: Next button
  // ═══════════════════════════════════════════
  const handleNext = async () => {
    if (!outer || !image) return;

    setIsProcessing(true);
    try {
      // Determine corners for cropping based on mode
      const cropCorners = measureMode === 'corner' && outerCorners
        ? outerCorners
        : {
            tl: { x: outer.left, y: outer.top },
            tr: { x: outer.right, y: outer.top },
            bl: { x: outer.left, y: outer.bottom },
            br: { x: outer.right, y: outer.bottom },
          };

      // Crop and straighten the card
      const cropped = await cropToOuterBounds(image, cropCorners, rotation, imgSize.w);
      // Keep the step-1 geometry: Back restores it, Confirm saves it for reopening later
      sourceRef.current = { outer: { ...outer }, outerCorners: measureMode === 'corner' ? outerCorners : null, imgW: imgSize.w, imgH: imgSize.h };
      await enterStep2(cropped);
    } catch (err) {
      console.error('[PostCaptureCentering] Next failed:', err);
      setIsProcessing(false);
    }
  };

  /**
   * Load a cropped card, initialise the artwork bounds (from `seed` = saved centeringData when
   * reopening, else an 8% inset) and switch to step 2.
   */
  const enterStep2 = (cropped, seed = null) => new Promise((resolve) => {
    if (!seed && prevInnerRef.current) seed = prevInnerRef.current;
    setCroppedPreview(cropped);
    const croppedImg = new Image();
    croppedImg.onload = () => {
      const MAX_DIM = 1400;
      let w = croppedImg.width;
      let h = croppedImg.height;
      if (Math.max(w, h) > MAX_DIM) {
        const scale = MAX_DIM / Math.max(w, h);
        w = Math.round(w * scale);
        h = Math.round(h * scale);
      }
      setCroppedImgSize({ w, h });

      const offsetPct = 0.08;
      let initInner = {
        left: Math.round(w * offsetPct),
        right: Math.round(w * (1 - offsetPct)),
        top: Math.round(h * offsetPct),
        bottom: Math.round(h * (1 - offsetPct)),
      };
      let initInnerCorners = null;
      const kx = seed?.w ? w / seed.w : 1, ky = seed?.h ? h / seed.h : 1;
      if (seed?.innerCorners) {
        const sc = (pt) => ({ x: pt.x * kx, y: pt.y * ky });
        initInnerCorners = { tl: sc(seed.innerCorners.tl), tr: sc(seed.innerCorners.tr), bl: sc(seed.innerCorners.bl), br: sc(seed.innerCorners.br) };
        const b = getBoundsFromCorners(initInnerCorners);
        initInner = { left: b.x, top: b.y, right: b.x + b.width, bottom: b.y + b.height };
      } else if (seed?.inner) {
        initInner = { left: seed.inner.left * kx, right: seed.inner.right * kx, top: seed.inner.top * ky, bottom: seed.inner.bottom * ky };
      }
      if (!initInnerCorners) {
        initInnerCorners = {
          tl: { x: initInner.left, y: initInner.top },
          tr: { x: initInner.right, y: initInner.top },
          bl: { x: initInner.left, y: initInner.bottom },
          br: { x: initInner.right, y: initInner.bottom },
        };
      }
      setInner(initInner);
      setInnerCorners(initInnerCorners);

      // Outer corners now represent the full cropped image bounds
      setOuterCorners({ tl: { x: 0, y: 0 }, tr: { x: w, y: 0 }, bl: { x: 0, y: h }, br: { x: w, y: h } });
      setOuter({ left: 0, right: w, top: 0, bottom: h });

      setStep(2);
      setIsProcessing(false);
      resolve(true);
    };
    croppedImg.onerror = () => {
      console.error('[PostCaptureCentering] Failed to load cropped image');
      setIsProcessing(false);
      resolve(false);
    };
    croppedImg.src = cropped;
  });

  // ═══════════════════════════════════════════
  // STEP 2 → STEP 1: Back button
  // ═══════════════════════════════════════════
  const handleBack = () => {
    if (innerRef.current) prevInnerRef.current = { inner: innerRef.current, innerCorners, w: croppedImgSize.w, h: croppedImgSize.h };
    setCroppedPreview(null);
    setCroppedImgSize({ w: 0, h: 0 });
    setInner(null);
    setInnerCorners(null);
    setCornerCenteringResult(null);
    // Restore the card-edge points from before the crop
    const src = sourceRef.current;
    if (src) {
      setOuter(src.outer);
      setOuterCorners(src.outerCorners || {
        tl: { x: src.outer.left, y: src.outer.top }, tr: { x: src.outer.right, y: src.outer.top },
        bl: { x: src.outer.left, y: src.outer.bottom }, br: { x: src.outer.right, y: src.outer.bottom },
      });
    }
    setStep(1);
  };

  // ═══════════════════════════════════════════
  // STEP 1: Reset to initial state
  // ═══════════════════════════════════════════
  const handleReset = () => {
    if (!imgSize.w) return;
    const w = imgSize.w, h = imgSize.h;
    const margin = 0.02;
    const initOuter = {
      left: Math.round(w * margin),
      right: Math.round(w * (1 - margin)),
      top: Math.round(h * margin),
      bottom: Math.round(h * (1 - margin)),
    };
    setOuter(initOuter);

    setOuterCorners({
      tl: { x: initOuter.left, y: initOuter.top },
      tr: { x: initOuter.right, y: initOuter.top },
      bl: { x: initOuter.left, y: initOuter.bottom },
      br: { x: initOuter.right, y: initOuter.bottom },
    });

    setRotation(0);
    setTiltX(0);
    setTiltY(0);
    resetView();
    historyRef.current = [];
    setUndoCount(0);
  };

  // ═══════════════════════════════════════════
  // STEP 2: Confirm and finalize
  // ═══════════════════════════════════════════
  const handleConfirm = async () => {
    if (!croppedPreview || !inner) return;

    setIsProcessing(true);
    try {
      // Build centering data from inner corners on cropped image
      let centeringData;
      if (measureMode === 'corner' && cornerCenteringResult) {
        const { edges, centering } = cornerCenteringResult;
        centeringData = {
          didManualCenter: true,
          measureMode: 'corner',
          outerCorners,
          innerCorners,
          rotation,
          tiltX,
          tiltY,
          source: sourceRef.current ? { ...sourceRef.current, rotation, tiltX, tiltY } : null,
          croppedBounds: getBoundsFromCorners(outerCorners),
          borderL: edges.left.median,
          borderR: edges.right.median,
          borderT: edges.top.median,
          borderB: edges.bottom.median,
          lrRatio: centering.horizontal,
          tbRatio: centering.vertical,
        };
      } else {
        // Edge mode centering from inner bounds
        const bL = inner.left;
        const bR = croppedImgSize.w - inner.right;
        const bT = inner.top;
        const bB = croppedImgSize.h - inner.bottom;
        const lrR = Math.round(((bL + bR) > 0 ? bL / (bL + bR) * 100 : 50) * 10) / 10;
        const tbR = Math.round(((bT + bB) > 0 ? bT / (bT + bB) * 100 : 50) * 10) / 10;

        centeringData = {
          didManualCenter: true,
          measureMode: 'edge',
          outer: { left: 0, right: croppedImgSize.w, top: 0, bottom: croppedImgSize.h },
          inner,
          rotation,
          tiltX,
          tiltY,
          source: sourceRef.current ? { ...sourceRef.current, rotation, tiltX, tiltY } : null,
          croppedBounds: { x: 0, y: 0, width: croppedImgSize.w, height: croppedImgSize.h },
          borderL: bL,
          borderR: bR,
          borderT: bT,
          borderB: bB,
          lrRatio: lrR,
          tbRatio: tbR,
        };
      }

      onConfirm({ croppedImage: croppedPreview, centeringData });
    } catch (err) {
      console.error('[PostCaptureCentering] Confirm failed:', err);
      onSkip();
    } finally {
      setIsProcessing(false);
    }
  };

  // ═══════════════════════════════════════════
  // LOADING STATE
  // ═══════════════════════════════════════════
  if (!image || !outer || imgSize.w === 0) {
    return (
      <div style={{
        position: 'fixed',
        inset: 0,
        background: '#000',
        zIndex: 1100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        <div style={{ color: '#888', fontFamily: mono, fontSize: 12 }}>Loading...</div>
      </div>
    );
  }

  // Step 2 loading state
  if (step === 2 && (!croppedPreview || !inner || croppedImgSize.w === 0)) {
    return (
      <div style={{
        position: 'fixed',
        inset: 0,
        background: '#000',
        zIndex: 1100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        <div style={{ color: '#888', fontFamily: mono, fontSize: 12 }}>Processing crop...</div>
      </div>
    );
  }

  // ═══════════════════════════════════════════
  // COMPUTED VALUES
  // ═══════════════════════════════════════════
  const displayImage = step === 1 ? image : croppedPreview;
  const displayImgSize = step === 1 ? imgSize : croppedImgSize;

  const cW = outer ? outer.right - outer.left : 0;
  const cH = outer ? outer.bottom - outer.top : 0;

  // Handle dimensions (shrink with stage zoom so they stay finger-sized on screen)
  const handleSize = Math.max(28, Math.min(cW, cH) * 0.035) / view.z;
  // Line weight thins on screen when zoomed so the exact edge stays visible
  const lw = Math.max(1.5, cW * 0.005 * (view.z > 1 ? 0.5 : 1)) / view.z;
  // Edge-mode handles sit inside the line; push them further in as zoom rises so they clear it
  const handleInset = handleSize * (2 + 3 * Math.min(1, (view.z - 1) / 3));
  const pad = 40 / view.z;
  const outerColor = lineStyle.auto && autoColors.outer ? autoColors.outer : lineStyle.outer;
  const innerColor = lineStyle.auto && autoColors.inner ? autoColors.inner : lineStyle.inner;
  const ilw = Math.max(1.5 / view.z, lw * 0.8);   // inner (artwork) line width
  const hw = lw * 4.5;                            // halo band width
  const stageTransform = step === 1 ? `perspective(800px) rotateX(${tiltX}deg) rotateY(${tiltY}deg) rotateZ(${rotation}deg)` : 'none';
  const activeMapSrc = step === 1 ? image : croppedPreview;
  const activeMap = viewMode !== 'original' ? maps[activeMapSrc]?.[viewMode] : null;

  // Step 2: Calculate live centering for display
  let displayLR = 50, displayTB = 50;
  if (step === 2 && inner) {
    if (measureMode === 'corner' && cornerCenteringResult) {
      displayLR = cornerCenteringResult.centering.horizontal;
      displayTB = cornerCenteringResult.centering.vertical;
    } else {
      const bL = inner.left;
      const bR = croppedImgSize.w - inner.right;
      const bT = inner.top;
      const bB = croppedImgSize.h - inner.bottom;
      displayLR = Math.round(((bL + bR) > 0 ? bL / (bL + bR) * 100 : 50) * 10) / 10;
      displayTB = Math.round(((bT + bB) > 0 ? bT / (bT + bB) * 100 : 50) * 10) / 10;
    }
  }
  const displayLROff = Math.max(displayLR, 100 - displayLR);
  const displayTBOff = Math.max(displayTB, 100 - displayTB);

  // ═══════════════════════════════════════════
  // STEP 1: Outer handles (on INNER side of line for easier reach)
  // ═══════════════════════════════════════════
  const outerHandles = [
    [(outer.left + outer.right) / 2, outer.top + handleInset, 'OT', '↑'],     // Inside top edge
    [(outer.left + outer.right) / 2, outer.bottom - handleInset, 'OB', '↓'], // Inside bottom edge
    [outer.left + handleInset, (outer.top + outer.bottom) / 2, 'OL', '←'],   // Inside left edge
    [outer.right - handleInset, (outer.top + outer.bottom) / 2, 'OR', '→'],  // Inside right edge
  ];

  // ═══════════════════════════════════════════
  // STEP 2: Inner handles (on INSIDE of line - toward artwork center)
  // ═══════════════════════════════════════════
  const innerHandles = inner ? [
    [(inner.left + inner.right) / 2, inner.top + handleInset, 'IT', '↑'],     // Inside top edge
    [(inner.left + inner.right) / 2, inner.bottom - handleInset, 'IB', '↓'], // Inside bottom edge
    [inner.left + handleInset, (inner.top + inner.bottom) / 2, 'IL', '←'],   // Inside left edge
    [inner.right - handleInset, (inner.top + inner.bottom) / 2, 'IR', '→'],  // Inside right edge
  ] : [];

  // ═══════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════
  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: '#0a0b0e',
      zIndex: 1100,
      overflow: 'auto',
      WebkitOverflowScrolling: 'touch',
    }}>
      <div style={{ background: '#0d0f13', minHeight: '100%' }}>
        {/* Header with Step Indicator */}
        <div style={{ padding: '10px 12px', borderBottom: '1px solid #1a1c22', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontFamily: mono, fontSize: 10, color: step === 1 ? '#ff9944' : '#444', fontWeight: step === 1 ? 700 : 400 }}>
              1. Card Edge
            </span>
            <span style={{ color: '#333', fontSize: 10 }}>→</span>
            <span style={{ fontFamily: mono, fontSize: 10, color: step === 2 ? '#00ff88' : '#444', fontWeight: step === 2 ? 700 : 400 }}>
              2. Artwork
            </span>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {step === 1 && (
              <button
                onClick={handleReset}
                style={{ fontFamily: mono, fontSize: 9, color: '#555', background: 'transparent', border: '1px solid #333', borderRadius: 4, padding: '3px 8px', cursor: 'pointer' }}
              >
                Reset
              </button>
            )}
            {onCancel && (
              <button
                onClick={onCancel}
                aria-label="Cancel centering changes"
                style={{ fontFamily: mono, fontSize: 9, color: '#aaa', background: 'transparent', border: '1px solid #444', borderRadius: 4, padding: '3px 8px', cursor: 'pointer' }}
              >
                ✕ Cancel
              </button>
            )}
          </div>
        </div>

        {/* Side label */}
        <div style={{ padding: '6px 12px', background: 'rgba(0,0,0,.4)', borderBottom: '1px solid #1a1c22' }}>
          <span style={{ fontFamily: mono, fontSize: 11, color: '#ff9944', textTransform: 'uppercase', letterSpacing: '.06em' }}>
            {side} — {step === 1 ? 'Align Card Edges' : 'Align Artwork Borders'}
          </span>
        </div>

        {/* Measurement Mode Toggle (both steps) */}
        <div style={{ padding: '8px 12px', background: 'rgba(0,0,0,.3)', borderBottom: '1px solid #1a1c22', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          <span style={{ fontFamily: mono, fontSize: 9, color: '#666', textTransform: 'uppercase' }}>Mode:</span>
          <div style={{ display: 'flex', borderRadius: 6, overflow: 'hidden', border: '1px solid #2a2d35' }}>
            <button
              onClick={() => setMeasureMode('edge')}
              style={{
                padding: '6px 12px',
                background: measureMode === 'edge' ? '#ff994422' : '#0a0b0e',
                border: 'none',
                color: measureMode === 'edge' ? '#ff9944' : '#555',
                fontFamily: mono,
                fontSize: 9,
                cursor: 'pointer',
                borderRight: '1px solid #2a2d35',
              }}
            >
              Edge Lines
            </button>
            <button
              onClick={() => setMeasureMode('corner')}
              style={{
                padding: '6px 12px',
                background: measureMode === 'corner' ? '#00bcd422' : '#0a0b0e',
                border: 'none',
                color: measureMode === 'corner' ? '#00bcd4' : '#555',
                fontFamily: mono,
                fontSize: 9,
                cursor: 'pointer',
              }}
            >
              4-Corner
            </button>
          </div>
        </div>

        {/* STEP 1: Rotation & Tilt Controls */}
        {step === 1 && (
          <div style={{ padding: '10px 12px', background: 'rgba(0,0,0,.3)', borderBottom: '1px solid #1a1c22' }}>
            <div style={{ fontFamily: mono, fontSize: 9, color: '#666', marginBottom: 8, textTransform: 'uppercase' }}>
              Straighten & Correct Perspective
            </div>

            {/* Axis Selector */}
            <div style={{ display: 'flex', justifyContent: 'center', gap: 4, marginBottom: 10 }}>
              {[
                { id: 'X', label: 'Pitch', desc: '↕ tilt', color: '#ff6b6b' },
                { id: 'Y', label: 'Roll', desc: '↔ tilt', color: '#4ecdc4' },
                { id: 'Z', label: 'Rotate', desc: '↻ spin', color: '#ff9944' },
              ].map(axis => (
                <button
                  key={axis.id}
                  onClick={() => setActiveAxis(axis.id)}
                  style={{
                    padding: '6px 12px',
                    borderRadius: 6,
                    border: `1px solid ${activeAxis === axis.id ? axis.color : '#2a2d35'}`,
                    background: activeAxis === axis.id ? `${axis.color}22` : '#1a1c22',
                    color: activeAxis === axis.id ? axis.color : '#555',
                    fontFamily: mono,
                    fontSize: 10,
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 2,
                    minWidth: 60,
                  }}
                >
                  <span>{axis.label}</span>
                  <span style={{ fontSize: 8, opacity: 0.7 }}>{axis.desc}</span>
                </button>
              ))}
            </div>

            {/* Adjustment Controls */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
              <button
                onClick={() => withHistory(() => {
                  if (activeAxis === 'X') setTiltX(v => Math.round((v - 1) * 100) / 100);
                  else if (activeAxis === 'Y') setTiltY(v => Math.round((v - 1) * 100) / 100);
                  else setRotation(r => Math.round((r - 1) * 100) / 100);
                })}
                style={{ width: 32, height: 32, borderRadius: 6, background: '#1a1c22', border: '1px solid #2a2d35', color: '#888', fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                ‹‹
              </button>
              <button
                onClick={() => withHistory(() => {
                  if (activeAxis === 'X') setTiltX(v => Math.round((v - 0.05) * 100) / 100);
                  else if (activeAxis === 'Y') setTiltY(v => Math.round((v - 0.05) * 100) / 100);
                  else setRotation(r => Math.round((r - 0.05) * 100) / 100);
                })}
                style={{ width: 32, height: 32, borderRadius: 6, background: '#1a1c22', border: '1px solid #2a2d35', color: '#555', fontSize: 10, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                ‹
              </button>
              <div style={{ minWidth: 70, textAlign: 'center', padding: '6px 10px', background: '#0a0b0e', borderRadius: 6 }}>
                <div style={{
                  fontFamily: mono,
                  fontSize: 14,
                  fontWeight: 700,
                  color: activeAxis === 'X' ? (tiltX === 0 ? '#00ff88' : '#ff6b6b') :
                    activeAxis === 'Y' ? (tiltY === 0 ? '#00ff88' : '#4ecdc4') :
                      (rotation === 0 ? '#00ff88' : '#ff9944')
                }}>
                  {activeAxis === 'X' ? tiltX.toFixed(2) : activeAxis === 'Y' ? tiltY.toFixed(2) : rotation.toFixed(2)}°
                </div>
              </div>
              <button
                onClick={() => withHistory(() => {
                  if (activeAxis === 'X') setTiltX(v => Math.round((v + 0.05) * 100) / 100);
                  else if (activeAxis === 'Y') setTiltY(v => Math.round((v + 0.05) * 100) / 100);
                  else setRotation(r => Math.round((r + 0.05) * 100) / 100);
                })}
                style={{ width: 32, height: 32, borderRadius: 6, background: '#1a1c22', border: '1px solid #2a2d35', color: '#555', fontSize: 10, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                ›
              </button>
              <button
                onClick={() => withHistory(() => {
                  if (activeAxis === 'X') setTiltX(v => Math.round((v + 1) * 100) / 100);
                  else if (activeAxis === 'Y') setTiltY(v => Math.round((v + 1) * 100) / 100);
                  else setRotation(r => Math.round((r + 1) * 100) / 100);
                })}
                style={{ width: 32, height: 32, borderRadius: 6, background: '#1a1c22', border: '1px solid #2a2d35', color: '#888', fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                ››
              </button>
            </div>

            <div style={{ display: 'flex', justifyContent: 'center', gap: 12, marginTop: 8 }}>
              <span style={{ fontFamily: mono, fontSize: 9, color: tiltX === 0 ? '#444' : '#ff6b6b' }}>X:{tiltX}°</span>
              <span style={{ fontFamily: mono, fontSize: 9, color: tiltY === 0 ? '#444' : '#4ecdc4' }}>Y:{tiltY}°</span>
              <span style={{ fontFamily: mono, fontSize: 9, color: rotation === 0 ? '#444' : '#ff9944' }}>Z:{rotation}°</span>
            </div>
            <div style={{ textAlign: 'center', fontFamily: mono, fontSize: 8, color: '#444', marginTop: 4 }}>‹‹/›› = 1° · ‹/› = 0.05°</div>
          </div>
        )}

        {/* STEP 2: Live centering readout */}
        {step === 2 && (
          <div style={{ padding: '8px 12px', background: 'rgba(0,0,0,.4)', display: 'flex', justifyContent: 'space-around', borderBottom: '1px solid #1a1c22' }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontFamily: mono, fontSize: 8, color: '#555', textTransform: 'uppercase', marginBottom: 2 }}>L / R</div>
              <div style={{ fontFamily: mono, fontSize: 18, fontWeight: 700, color: displayLROff > 55 ? '#ff6633' : displayLROff > 53 ? '#ffcc00' : '#00ff88' }}>
                {displayLR}<span style={{ color: '#444' }}>/</span>{Math.round((100 - displayLR) * 10) / 10}
              </div>
            </div>
            <div style={{ width: 1, background: '#1a1c22' }} />
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontFamily: mono, fontSize: 8, color: '#555', textTransform: 'uppercase', marginBottom: 2 }}>T / B</div>
              <div style={{ fontFamily: mono, fontSize: 18, fontWeight: 700, color: displayTBOff > 55 ? '#ff6633' : displayTBOff > 53 ? '#ffcc00' : '#00ff88' }}>
                {displayTB}<span style={{ color: '#444' }}>/</span>{Math.round((100 - displayTB) * 10) / 10}
              </div>
            </div>
            <div style={{ width: 1, background: '#1a1c22' }} />
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontFamily: mono, fontSize: 8, color: '#555', textTransform: 'uppercase', marginBottom: 2 }}>Status</div>
              <div style={{ fontFamily: mono, fontSize: 11, fontWeight: 600, color: Math.max(displayLROff, displayTBOff) > 55 ? '#ff6633' : '#00ff88' }}>
                {Math.max(displayLROff, displayTBOff) > 55 ? '⚠ DING' : '✓ Clean'}
              </div>
            </div>
          </div>
        )}

        {/* Legend */}
        <div style={{ padding: '6px 12px', display: 'flex', gap: 12, borderBottom: '1px solid #0d0f13', flexWrap: 'wrap' }}>
          {step === 1 ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <svg width={16} height={16}><rect x={2} y={2} width={12} height={12} rx={2} fill="#111" stroke={outerColor} strokeWidth={2} /></svg>
              <span style={{ fontFamily: mono, fontSize: 9, color: '#ff9944' }}>Card edge</span>
              <span style={{ fontFamily: mono, fontSize: 8, color: '#555' }}>(drag to align)</span>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <svg width={16} height={16}><rect x={2} y={2} width={12} height={12} rx={2} fill="#111" stroke={innerColor} strokeWidth={2} strokeDasharray="3,2" /></svg>
              <span style={{ fontFamily: mono, fontSize: 9, color: '#00ff88' }}>Artwork border</span>
              <span style={{ fontFamily: mono, fontSize: 8, color: '#555' }}>(drag to align)</span>
            </div>
          )}
        </div>

        {/* Zoom controls: corner buttons · Undo · zoom · Fit */}
        <div style={{ padding: '6px 12px', display: 'flex', alignItems: 'center', gap: 6, borderBottom: '1px solid #0d0f13' }}>
          {[['tl', '◤', 'Top-left'], ['tr', '◥', 'Top-right'], ['bl', '◣', 'Bottom-left'], ['br', '◢', 'Bottom-right']].map(([c, glyph, label]) => (
            <button
              key={c}
              type="button"
              aria-label={`Zoom to ${label.toLowerCase()} corner`}
              onClick={() => zoomToCorner(c)}
              style={{ flex: 1, padding: '7px 0', borderRadius: 6, border: `1px solid ${activeCorner === c ? '#8b5cf6' : '#2a2d35'}`, background: activeCorner === c ? '#8b5cf622' : '#1a1c22', color: activeCorner === c ? '#c4b5fd' : '#888', fontSize: 14, lineHeight: 1, cursor: 'pointer' }}
            >
              {glyph}
            </button>
          ))}
          <button type="button" onClick={undo} disabled={undoCount === 0} aria-label="Undo last change"
            style={{ padding: '7px 10px', borderRadius: 6, border: '1px solid #2a2d35', background: '#1a1c22', color: undoCount ? '#ccc' : '#444', fontFamily: mono, fontSize: 9, cursor: undoCount ? 'pointer' : 'default' }}>
            Undo
          </button>
          <div style={{ minWidth: 44, textAlign: 'center', fontFamily: mono, fontSize: 9, color: view.z > 1 ? '#c4b5fd' : '#555' }}>{Math.round(view.z * 100)}%</div>
          <button type="button" onClick={resetView} disabled={view.z === 1} aria-label="Fit whole image"
            style={{ padding: '7px 10px', borderRadius: 6, border: '1px solid #2a2d35', background: '#1a1c22', color: view.z > 1 ? '#ccc' : '#444', fontFamily: mono, fontSize: 9, cursor: view.z > 1 ? 'pointer' : 'default' }}>
            Fit
          </button>
          <button type="button" onClick={() => setShowLineSettings((v) => !v)} aria-label="Line settings" aria-expanded={showLineSettings}
            style={{ padding: '7px 9px', borderRadius: 6, border: `1px solid ${showLineSettings ? '#00ff88' : '#2a2d35'}`, background: showLineSettings ? '#00ff8822' : '#1a1c22', color: showLineSettings ? '#00ff88' : '#ccc', fontSize: 13, lineHeight: 1, cursor: 'pointer' }}>
            ⚙
          </button>
        </div>

        {/* Line settings: halo · auto colour · swatches (remembered on this device) */}
        {showLineSettings && (
          <div style={{ padding: '6px 12px 8px', display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid #0d0f13', flexWrap: 'wrap' }}>
            <span style={{ fontFamily: mono, fontSize: 8, color: '#666', textTransform: 'uppercase' }}>{step === 1 ? 'Card line' : 'Art line'}</span>
            {[['halo', 'Halo'], ['auto', 'Auto color']].map(([key, label]) => (
              <button key={key} type="button" onClick={() => updateLineStyle({ [key]: !lineStyle[key] })} aria-pressed={lineStyle[key]}
                style={{ padding: '5px 9px', borderRadius: 6, border: `1px solid ${lineStyle[key] ? '#00ff88' : '#2a2d35'}`, background: lineStyle[key] ? '#00ff8822' : '#1a1c22', color: lineStyle[key] ? '#00ff88' : '#777', fontFamily: mono, fontSize: 9, cursor: 'pointer' }}>
                {lineStyle[key] ? '● ' : '○ '}{label}
              </button>
            ))}
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', opacity: lineStyle.auto ? 0.35 : 1 }}>
              {LINE_PALETTE.map((c) => {
                const key = step === 1 ? 'outer' : 'inner';
                const on = lineStyle[key] === c.hex;
                return (
                  <button key={c.id} type="button" disabled={lineStyle.auto} onClick={() => updateLineStyle({ [key]: c.hex })} aria-label={`${c.id} line`} aria-pressed={on}
                    style={{ width: 22, height: 22, borderRadius: 11, background: c.hex, border: on ? '2px solid #fff' : '2px solid #2a2d35', boxShadow: on ? '0 0 0 1px #000 inset' : 'none', cursor: lineStyle.auto ? 'default' : 'pointer', padding: 0 }} />
                );
              })}
            </div>
            {lineStyle.auto && <span style={{ fontFamily: mono, fontSize: 8, color: '#666' }}>picked from the card: <span style={{ color: step === 1 ? outerColor : innerColor }}>■</span></span>}
          </div>
        )}

        {/* Vision views + intensity */}
        <div style={{ padding: '6px 12px', display: 'flex', alignItems: 'center', gap: 6, borderBottom: '1px solid #0d0f13', flexWrap: 'wrap' }}>
          {[['original', 'Original'], ['emboss', 'Emboss'], ['highpass', 'Hi-pass'], ['edges', 'Edge']].map(([id, label]) => (
            <button key={id} type="button" onClick={() => setViewMode(id)}
              style={{ flex: 1, minWidth: 60, padding: '6px 0', borderRadius: 6, border: `1px solid ${viewMode === id ? '#00ff88' : '#2a2d35'}`, background: viewMode === id ? '#00ff8822' : '#1a1c22', color: viewMode === id ? '#00ff88' : '#777', fontFamily: mono, fontSize: 9, cursor: 'pointer' }}>
              {label}
            </button>
          ))}
          {viewMode !== 'original' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', paddingTop: 4 }}>
              <span style={{ fontFamily: mono, fontSize: 8, color: '#666', textTransform: 'uppercase' }}>{mapsBusy && !activeMap ? 'Building view…' : 'Intensity'}</span>
              <input type="range" min={0} max={100} value={viewIntensity} onChange={e => setViewIntensity(Number(e.target.value))} style={{ flex: 1 }} aria-label="View intensity" />
              <span style={{ fontFamily: mono, fontSize: 9, color: '#00ff88', minWidth: 30, textAlign: 'right' }}>{viewIntensity}%</span>
            </div>
          )}
        </div>

        {/* Image + drag canvas: viewport (clips) → stage (zooms/pans) → image, map overlay, svg handles */}
        <div
          ref={viewportRef}
          style={{ position: 'relative', overflow: 'hidden', touchAction: 'none', lineHeight: 0, aspectRatio: displayImgSize.w > 0 ? `${displayImgSize.w} / ${displayImgSize.h}` : undefined, background: '#000', userSelect: 'none', WebkitUserSelect: 'none' }}
          onPointerDown={onViewportPointerDown}
          onPointerMove={onViewportPointerMove}
          onPointerUp={onViewportPointerUp}
          onPointerCancel={onViewportPointerUp}
          onTouchMove={e => { e.preventDefault(); }}
          onTouchStart={e => { if (dragging.current) e.preventDefault(); }}
        >
          <div style={{ position: 'absolute', inset: 0, transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.z})`, transformOrigin: '0 0', willChange: 'transform' }}>
          <img
            src={displayImage}
            alt="Card"
            style={{
              width: '100%',
              display: 'block',
              transform: stageTransform,
              transformOrigin: 'center center',
              transition: 'transform 0.15s ease',
            }}
            draggable={false}
          />
          {activeMap && (
            <img
              src={activeMap}
              alt=""
              aria-hidden="true"
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block', opacity: viewIntensity / 100, transform: stageTransform, transformOrigin: 'center center', transition: 'transform 0.15s ease', pointerEvents: 'none' }}
              draggable={false}
            />
          )}
          {/* Crosshair overlay */}
          <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
            <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 1, background: 'rgba(0,255,136,0.2)' }} />
            <div style={{ position: 'absolute', top: '50%', left: 0, right: 0, height: 1, background: 'rgba(0,255,136,0.2)' }} />
          </div>
          <svg
            ref={svgRef}
            viewBox={`0 0 ${displayImgSize.w} ${displayImgSize.h}`}
            style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', overflow: 'visible', touchAction: 'none' }}
          >
            {/* STEP 1: Edge mode - outer boundary only */}
            {step === 1 && measureMode === 'edge' && (
              <>
                {/* Stroke drawn OUTSIDE the coordinate: its inside edge is the crop line; radius keeps the card radius on that inside edge */}
                {/* Card-edge halo sits INSIDE the crop coordinate (on the card), so the seam between halo and line is the crop boundary */}
                {lineStyle.halo && (
                  <rect
                    x={outer.left + hw / 2}
                    y={outer.top + hw / 2}
                    width={Math.max(0, cW - hw)}
                    height={Math.max(0, cH - hw)}
                    rx={Math.max(0, cW * 0.048 - hw / 2)}
                    ry={Math.max(0, cW * 0.048 - hw / 2)}
                    fill="none"
                    stroke={haloFor(outerColor)}
                    strokeWidth={hw}
                  />
                )}
                <rect
                  x={outer.left - lw / 2}
                  y={outer.top - lw / 2}
                  width={cW + lw}
                  height={cH + lw}
                  rx={cW * 0.048 + lw / 2}
                  ry={cW * 0.048 + lw / 2}
                  fill="none"
                  stroke={outerColor}
                  strokeWidth={lw}
                  opacity={0.85}
                />
                {outerHandles.map(([hx, hy, which, arrow]) => {
                  const sz = handleSize;
                  const isHoriz = which === 'OT' || which === 'OB';
                  return (
                    <g
                      key={which}
                      data-handle={which}
                      style={{ cursor: isHoriz ? 'ns-resize' : 'ew-resize', touchAction: 'none' }}
                      onPointerDown={e => { e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId); dragging.current = which; const c = getCoords(e); const hp = edgeHandlePoint(which) || c; dragOffsetRef.current = { x: hp.x - c.x, y: hp.y - c.y }; onHandleDrag(hp, e); }}
                      onPointerMove={e => { if (dragging.current === which) { e.preventDefault(); const c = getCoords(e); const x = c.x + dragOffsetRef.current.x, y = c.y + dragOffsetRef.current.y; moveOuterHandle(which, x, y); const o = outerRef.current; onHandleDrag(isHoriz ? { x: (o.left + o.right) / 2, y } : { x, y: (o.top + o.bottom) / 2 }, e); } }}
                      onPointerUp={e => { dragging.current = null; onHandleDrag(null, e); }}
                      onPointerCancel={e => { dragging.current = null; onHandleDrag(null, e); }}
                    >
                      <rect x={hx - sz / 2 - pad} y={hy - sz / 2 - pad} width={sz + pad * 2} height={sz + pad * 2} fill="transparent" />
                      <rect x={hx - sz / 2} y={hy - sz / 2} width={sz} height={sz} rx={4} fill="#111" stroke={outerColor} strokeWidth={Math.max(1.5 / view.z, lw * 0.6)} />
                      <text x={hx} y={hy} textAnchor="middle" dominantBaseline="central" fill={outerColor} fontSize={sz * 0.6} fontWeight="bold" style={{ pointerEvents: 'none' }}>
                        {arrow}
                      </text>
                    </g>
                  );
                })}
              </>
            )}

            {/* STEP 1: Corner mode - outer corners only */}
            {step === 1 && measureMode === 'corner' && outerCorners && (
              <CornerHandles
                imgW={imgSize.w}
                imgH={imgSize.h}
                outerCorners={outerCorners}
                innerCorners={null}
                setOuterCorners={setOuterCorners}
                setInnerCorners={() => {}}
                svgRef={svgRef}
                onCenteringUpdate={() => {}}
                activeHandles="outer"
                zoom={view.z}
                onHandleDrag={onHandleDrag}
                outerColor={outerColor}
                innerColor={innerColor}
                halo={lineStyle.halo}
              />
            )}

            {/* STEP 2: Edge mode - inner boundary only */}
            {step === 2 && measureMode === 'edge' && inner && (
              <>
                {/* Fixed outer boundary (reference) */}
                <rect
                  x={0}
                  y={0}
                  width={croppedImgSize.w}
                  height={croppedImgSize.h}
                  rx={croppedImgSize.w * 0.048}
                  ry={croppedImgSize.w * 0.048}
                  fill="none"
                  stroke={outerColor}
                  strokeWidth={lw * 0.5}
                  opacity={0.3}
                />
                {/* Draggable inner boundary */}
                {/* Stroke drawn INSIDE the coordinate: its outside edge is the measured art line */}
                {/* Art-line halo sits OUTSIDE the measured coordinate (in the border), so the seam between line and halo is the boundary */}
                {lineStyle.halo && (
                  <rect
                    x={inner.left - hw / 2}
                    y={inner.top - hw / 2}
                    width={inner.right - inner.left + hw}
                    height={inner.bottom - inner.top + hw}
                    fill="none"
                    stroke={haloFor(innerColor)}
                    strokeWidth={hw}
                  />
                )}
                <rect
                  x={inner.left + ilw / 2}
                  y={inner.top + ilw / 2}
                  width={inner.right - inner.left - ilw}
                  height={inner.bottom - inner.top - ilw}
                  fill="none"
                  stroke={innerColor}
                  strokeWidth={ilw}
                  strokeDasharray={`${croppedImgSize.w * 0.025 / view.z},${croppedImgSize.w * 0.012 / view.z}`}
                  opacity={0.9}
                />
                {innerHandles.map(([hx, hy, which, arrow]) => {
                  const sz = handleSize;
                  const isHoriz = which === 'IT' || which === 'IB';
                  return (
                    <g
                      key={which}
                      data-handle={which}
                      style={{ cursor: isHoriz ? 'ns-resize' : 'ew-resize', touchAction: 'none' }}
                      onPointerDown={e => { e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId); dragging.current = which; const c = getCoords(e); const hp = edgeHandlePoint(which) || c; dragOffsetRef.current = { x: hp.x - c.x, y: hp.y - c.y }; onHandleDrag(hp, e); }}
                      onPointerMove={e => { if (dragging.current === which) { e.preventDefault(); const c = getCoords(e); const x = c.x + dragOffsetRef.current.x, y = c.y + dragOffsetRef.current.y; moveInnerHandle(which, x, y); const i = innerRef.current; onHandleDrag(isHoriz ? { x: (i.left + i.right) / 2, y } : { x, y: (i.top + i.bottom) / 2 }, e); } }}
                      onPointerUp={e => { dragging.current = null; onHandleDrag(null, e); }}
                      onPointerCancel={e => { dragging.current = null; onHandleDrag(null, e); }}
                    >
                      <rect x={hx - sz / 2 - pad} y={hy - sz / 2 - pad} width={sz + pad * 2} height={sz + pad * 2} fill="transparent" />
                      <rect x={hx - sz / 2} y={hy - sz / 2} width={sz} height={sz} rx={4} fill="#111" stroke={innerColor} strokeWidth={Math.max(1.5 / view.z, lw * 0.6)} />
                      <text x={hx} y={hy} textAnchor="middle" dominantBaseline="central" fill={innerColor} fontSize={sz * 0.6} fontWeight="bold" style={{ pointerEvents: 'none' }}>
                        {arrow}
                      </text>
                    </g>
                  );
                })}
              </>
            )}

            {/* STEP 2: Corner mode - inner corners only */}
            {step === 2 && measureMode === 'corner' && outerCorners && innerCorners && (
              <CornerHandles
                imgW={croppedImgSize.w}
                imgH={croppedImgSize.h}
                outerCorners={outerCorners}
                innerCorners={innerCorners}
                setOuterCorners={() => {}}
                setInnerCorners={setInnerCorners}
                svgRef={svgRef}
                onCenteringUpdate={setCornerCenteringResult}
                activeHandles="inner"
                zoom={view.z}
                onHandleDrag={onHandleDrag}
                outerColor={outerColor}
                innerColor={innerColor}
                halo={lineStyle.halo}
              />
            )}
          </svg>
          </div>
          {dragPoint && (() => {
            const r = viewportRef.current?.getBoundingClientRect();
            if (!r) return null;
            // Visible part of the viewport: the page can scroll it partly off screen, and the
            // sticky action bar covers the bottom of the screen.
            const barTop = actionBarRef.current?.getBoundingClientRect().top ?? window.innerHeight;
            const visible = { x0: Math.max(0, -r.left), y0: Math.max(0, -r.top), x1: Math.min(r.width, window.innerWidth - r.left), y1: Math.min(r.height, Math.min(window.innerHeight, barTop) - r.top) };
            const stageCssPerDisplayPx = displayImgSize.w > 0 ? (r.width * view.z) / displayImgSize.w : 0.3;
            return (
              <Loupe src={displayImage} imgW={displayImgSize.w} imgH={displayImgSize.h} point={dragPoint} anchorScreen={dragAnchor} visible={visible} stageCssPerDisplayPx={stageCssPerDisplayPx} />
            );
          })()}
        </div>

        {/* Edge breakdown panel for corner mode Step 2 */}
        {step === 2 && measureMode === 'corner' && cornerCenteringResult && (
          <div style={{ padding: '0 12px' }}>
            <EdgeBreakdownPanel centeringResult={cornerCenteringResult} />
          </div>
        )}

        {/* Action buttons */}
        <div ref={actionBarRef} style={{
          position: 'sticky',
          bottom: 0,
          padding: '10px 12px',
          display: 'flex',
          gap: 8,
          borderTop: '1px solid #1a1c22',
          background: '#0d0f13',
          zIndex: 10,
        }}>
          {step === 1 ? (
            <>
              {/* Step 1: No back, just Next */}
              <div style={{ flex: 1 }} /> {/* Spacer */}
              <button
                onClick={handleNext}
                disabled={isProcessing}
                style={{
                  flex: 2,
                  padding: '11px 0',
                  borderRadius: 7,
                  border: 'none',
                  background: isProcessing ? '#1a1c22' : 'linear-gradient(135deg,#ff9944,#ff6633)',
                  color: isProcessing ? '#444' : '#000',
                  fontFamily: mono,
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: isProcessing ? 'default' : 'pointer',
                  textTransform: 'uppercase',
                  letterSpacing: '.06em',
                }}
              >
                {isProcessing ? 'Processing...' : 'Next →'}
              </button>
            </>
          ) : (
            <>
              {/* Step 2: Back and Confirm */}
              <button
                onClick={handleBack}
                disabled={isProcessing}
                style={{
                  flex: 1,
                  padding: '11px 0',
                  borderRadius: 7,
                  border: '1px solid #333',
                  background: '#1a1c22',
                  color: '#888',
                  fontFamily: mono,
                  fontSize: 11,
                  cursor: isProcessing ? 'default' : 'pointer',
                  textTransform: 'uppercase',
                  letterSpacing: '.06em',
                }}
              >
                ← Back
              </button>
              <button
                onClick={handleConfirm}
                disabled={isProcessing}
                style={{
                  flex: 2,
                  padding: '11px 0',
                  borderRadius: 7,
                  border: 'none',
                  background: isProcessing ? '#1a1c22' : 'linear-gradient(135deg,#00ff88,#00cc6a)',
                  color: isProcessing ? '#444' : '#000',
                  fontFamily: mono,
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: isProcessing ? 'default' : 'pointer',
                  textTransform: 'uppercase',
                  letterSpacing: '.06em',
                }}
              >
                {isProcessing ? 'Processing...' : '✓ Confirm'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default PostCaptureCentering;
