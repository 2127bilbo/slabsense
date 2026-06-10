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
  const [rotation, setRotation] = useState(0);
  const [tiltX, setTiltX] = useState(0);
  const [tiltY, setTiltY] = useState(0);
  const [activeAxis, setActiveAxis] = useState('Z');

  const svgRef = useRef(null);
  const dragging = useRef(null);
  const outerRef = useRef(outer);
  const innerRef = useRef(inner);

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

      // Initialize outer bounds (card edge) with small margin (2%)
      const margin = 0.02;
      const initOuter = {
        left: Math.round(w * margin),
        right: Math.round(w * (1 - margin)),
        top: Math.round(h * margin),
        bottom: Math.round(h * (1 - margin)),
      };
      setOuter(initOuter);

      // Initialize corner mode for outer only (Step 1)
      setOuterCorners({
        tl: { x: initOuter.left, y: initOuter.top },
        tr: { x: initOuter.right, y: initOuter.top },
        bl: { x: initOuter.left, y: initOuter.bottom },
        br: { x: initOuter.right, y: initOuter.bottom },
      });

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
      setCroppedPreview(cropped);

      // Load cropped image to get its dimensions and initialize inner bounds
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

        // Initialize inner bounds for the cropped card (8% inset)
        const offsetPct = 0.08;
        const initInner = {
          left: Math.round(w * offsetPct),
          right: Math.round(w * (1 - offsetPct)),
          top: Math.round(h * offsetPct),
          bottom: Math.round(h * (1 - offsetPct)),
        };
        setInner(initInner);

        // For corner mode, set up inner corners
        setInnerCorners({
          tl: { x: initInner.left, y: initInner.top },
          tr: { x: initInner.right, y: initInner.top },
          bl: { x: initInner.left, y: initInner.bottom },
          br: { x: initInner.right, y: initInner.bottom },
        });

        // Outer corners now represent the full cropped image bounds
        setOuterCorners({
          tl: { x: 0, y: 0 },
          tr: { x: w, y: 0 },
          bl: { x: 0, y: h },
          br: { x: w, y: h },
        });
        setOuter({
          left: 0,
          right: w,
          top: 0,
          bottom: h,
        });

        setStep(2);
        setIsProcessing(false);
      };
      croppedImg.onerror = () => {
        console.error('[PostCaptureCentering] Failed to load cropped image');
        setIsProcessing(false);
      };
      croppedImg.src = cropped;
    } catch (err) {
      console.error('[PostCaptureCentering] Next failed:', err);
      setIsProcessing(false);
    }
  };

  // ═══════════════════════════════════════════
  // STEP 2 → STEP 1: Back button
  // ═══════════════════════════════════════════
  const handleBack = () => {
    setCroppedPreview(null);
    setCroppedImgSize({ w: 0, h: 0 });
    setInner(null);
    setInnerCorners(null);
    setCornerCenteringResult(null);
    setStep(1);

    // Re-initialize outer from original image (preserves user's adjustments via existing state)
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

  // Handle dimensions
  const handleSize = Math.max(28, Math.min(cW, cH) * 0.035);
  const lw = Math.max(3, cW * 0.005);
  const pad = 40;

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
    [(outer.left + outer.right) / 2, outer.top + handleSize, 'OT', '↑'],     // Inside top edge
    [(outer.left + outer.right) / 2, outer.bottom - handleSize, 'OB', '↓'], // Inside bottom edge
    [outer.left + handleSize, (outer.top + outer.bottom) / 2, 'OL', '←'],   // Inside left edge
    [outer.right - handleSize, (outer.top + outer.bottom) / 2, 'OR', '→'],  // Inside right edge
  ];

  // ═══════════════════════════════════════════
  // STEP 2: Inner handles (on OUTER side of line - toward card edge)
  // ═══════════════════════════════════════════
  const innerHandles = inner ? [
    [(inner.left + inner.right) / 2, inner.top - handleSize, 'IT', '↓'],     // Above inner top
    [(inner.left + inner.right) / 2, inner.bottom + handleSize, 'IB', '↑'], // Below inner bottom
    [inner.left - handleSize, (inner.top + inner.bottom) / 2, 'IL', '→'],   // Left of inner left
    [inner.right + handleSize, (inner.top + inner.bottom) / 2, 'IR', '←'],  // Right of inner right
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
          {step === 1 && (
            <button
              onClick={handleReset}
              style={{ fontFamily: mono, fontSize: 9, color: '#555', background: 'transparent', border: '1px solid #333', borderRadius: 4, padding: '3px 8px', cursor: 'pointer' }}
            >
              Reset
            </button>
          )}
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
                onClick={() => {
                  if (activeAxis === 'X') setTiltX(v => Math.round((v - 1) * 100) / 100);
                  else if (activeAxis === 'Y') setTiltY(v => Math.round((v - 1) * 100) / 100);
                  else setRotation(r => Math.round((r - 1) * 100) / 100);
                }}
                style={{ width: 32, height: 32, borderRadius: 6, background: '#1a1c22', border: '1px solid #2a2d35', color: '#888', fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                ‹‹
              </button>
              <button
                onClick={() => {
                  if (activeAxis === 'X') setTiltX(v => Math.round((v - 0.05) * 100) / 100);
                  else if (activeAxis === 'Y') setTiltY(v => Math.round((v - 0.05) * 100) / 100);
                  else setRotation(r => Math.round((r - 0.05) * 100) / 100);
                }}
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
                onClick={() => {
                  if (activeAxis === 'X') setTiltX(v => Math.round((v + 0.05) * 100) / 100);
                  else if (activeAxis === 'Y') setTiltY(v => Math.round((v + 0.05) * 100) / 100);
                  else setRotation(r => Math.round((r + 0.05) * 100) / 100);
                }}
                style={{ width: 32, height: 32, borderRadius: 6, background: '#1a1c22', border: '1px solid #2a2d35', color: '#555', fontSize: 10, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                ›
              </button>
              <button
                onClick={() => {
                  if (activeAxis === 'X') setTiltX(v => Math.round((v + 1) * 100) / 100);
                  else if (activeAxis === 'Y') setTiltY(v => Math.round((v + 1) * 100) / 100);
                  else setRotation(r => Math.round((r + 1) * 100) / 100);
                }}
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
              <svg width={16} height={16}><rect x={2} y={2} width={12} height={12} rx={2} fill="#111" stroke="#ff9944" strokeWidth={2} /></svg>
              <span style={{ fontFamily: mono, fontSize: 9, color: '#ff9944' }}>Card edge</span>
              <span style={{ fontFamily: mono, fontSize: 8, color: '#555' }}>(drag to align)</span>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <svg width={16} height={16}><rect x={2} y={2} width={12} height={12} rx={2} fill="#111" stroke="#00ff88" strokeWidth={2} strokeDasharray="3,2" /></svg>
              <span style={{ fontFamily: mono, fontSize: 9, color: '#00ff88' }}>Artwork border</span>
              <span style={{ fontFamily: mono, fontSize: 8, color: '#555' }}>(drag to align)</span>
            </div>
          )}
        </div>

        {/* Image + drag canvas */}
        <div
          style={{ position: 'relative', lineHeight: 0, touchAction: 'none', overflow: 'visible' }}
          onTouchMove={e => { if (dragging.current) e.preventDefault(); }}
          onTouchStart={e => { if (dragging.current) e.preventDefault(); }}
        >
          <img
            src={displayImage}
            alt="Card"
            style={{
              width: '100%',
              display: 'block',
              transform: step === 1 ? `perspective(800px) rotateX(${tiltX}deg) rotateY(${tiltY}deg) rotateZ(${rotation}deg)` : 'none',
              transformOrigin: 'center center',
              transition: 'transform 0.15s ease',
            }}
            draggable={false}
          />
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
                <rect
                  x={outer.left}
                  y={outer.top}
                  width={cW}
                  height={cH}
                  rx={cW * 0.048}
                  ry={cW * 0.048}
                  fill="none"
                  stroke="#ff9944"
                  strokeWidth={lw}
                  opacity={0.85}
                />
                {outerHandles.map(([hx, hy, which, arrow]) => {
                  const sz = handleSize;
                  const isHoriz = which === 'OT' || which === 'OB';
                  return (
                    <g
                      key={which}
                      style={{ cursor: isHoriz ? 'ns-resize' : 'ew-resize', touchAction: 'none' }}
                      onPointerDown={e => { e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId); dragging.current = which; }}
                      onPointerMove={e => { if (dragging.current === which) { e.preventDefault(); const { x, y } = getCoords(e); moveOuterHandle(which, x, y); } }}
                      onPointerUp={() => { dragging.current = null; }}
                    >
                      <rect x={hx - sz / 2 - pad} y={hy - sz / 2 - pad} width={sz + pad * 2} height={sz + pad * 2} fill="transparent" />
                      <rect x={hx - sz / 2} y={hy - sz / 2} width={sz} height={sz} rx={4} fill="#111" stroke="#ff9944" strokeWidth={Math.max(2, lw * 0.6)} />
                      <text x={hx} y={hy} textAnchor="middle" dominantBaseline="central" fill="#ff9944" fontSize={sz * 0.6} fontWeight="bold" style={{ pointerEvents: 'none' }}>
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
                  stroke="#ff9944"
                  strokeWidth={lw * 0.5}
                  opacity={0.3}
                />
                {/* Draggable inner boundary */}
                <rect
                  x={inner.left}
                  y={inner.top}
                  width={inner.right - inner.left}
                  height={inner.bottom - inner.top}
                  fill="none"
                  stroke="#00ff88"
                  strokeWidth={Math.max(2, lw * 0.8)}
                  strokeDasharray={`${croppedImgSize.w * 0.025},${croppedImgSize.w * 0.012}`}
                  opacity={0.9}
                />
                {innerHandles.map(([hx, hy, which, arrow]) => {
                  const sz = handleSize;
                  const isHoriz = which === 'IT' || which === 'IB';
                  return (
                    <g
                      key={which}
                      style={{ cursor: isHoriz ? 'ns-resize' : 'ew-resize', touchAction: 'none' }}
                      onPointerDown={e => { e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId); dragging.current = which; }}
                      onPointerMove={e => { if (dragging.current === which) { e.preventDefault(); const { x, y } = getCoords(e); moveInnerHandle(which, x, y); } }}
                      onPointerUp={() => { dragging.current = null; }}
                    >
                      <rect x={hx - sz / 2 - pad} y={hy - sz / 2 - pad} width={sz + pad * 2} height={sz + pad * 2} fill="transparent" />
                      <rect x={hx - sz / 2} y={hy - sz / 2} width={sz} height={sz} rx={4} fill="#111" stroke="#00ff88" strokeWidth={Math.max(2, lw * 0.6)} />
                      <text x={hx} y={hy} textAnchor="middle" dominantBaseline="central" fill="#00ff88" fontSize={sz * 0.6} fontWeight="bold" style={{ pointerEvents: 'none' }}>
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
              />
            )}
          </svg>
        </div>

        {/* Edge breakdown panel for corner mode Step 2 */}
        {step === 2 && measureMode === 'corner' && cornerCenteringResult && (
          <div style={{ padding: '0 12px' }}>
            <EdgeBreakdownPanel centeringResult={cornerCenteringResult} />
          </div>
        )}

        {/* Action buttons */}
        <div style={{
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
