/**
 * PostCaptureCentering - Full centering UI after photo capture
 *
 * Matches the ManualBoundaryEditor layout exactly:
 * - Mode toggle (Edge Drag v1 / Corner Anchored β)
 * - Step 1: Straighten & Correct Perspective
 * - Live centering readout
 * - Step 2: Adjust Borders with handles
 *
 * Difference from centering tab:
 * - Appears after "Use Photo" (not as a tab)
 * - Confirm/Skip buttons instead of Apply/Save
 * - On confirm, crops image and returns centering data
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
  const [imgSize, setImgSize] = useState({ w: 0, h: 0 });
  const [isProcessing, setIsProcessing] = useState(false);

  // Measurement mode toggle
  const [measureMode, setMeasureMode] = useState(() => {
    try { return localStorage.getItem('slabsense_measureMode') || 'edge'; }
    catch { return 'edge'; }
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

  // Transform state
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

  // Load image and initialize bounds
  useEffect(() => {
    if (!image) return;

    const img = new Image();
    img.onload = () => {
      const w = img.width;
      const h = img.height;
      setImgSize({ w, h });

      // Initialize outer bounds (card edge) with small margin (2%)
      // This puts the handles near the edges so user can drag them to the card
      const margin = 0.02;
      const initOuter = {
        left: Math.round(w * margin),
        right: Math.round(w * (1 - margin)),
        top: Math.round(h * margin),
        bottom: Math.round(h * (1 - margin)),
      };
      setOuter(initOuter);

      // Initialize inner bounds (artwork) with offset from outer (8% inward)
      const offsetPct = 0.08;
      const cardW = initOuter.right - initOuter.left;
      const cardH = initOuter.bottom - initOuter.top;
      const initInner = {
        left: initOuter.left + Math.round(cardW * offsetPct),
        right: initOuter.right - Math.round(cardW * offsetPct),
        top: initOuter.top + Math.round(cardH * offsetPct),
        bottom: initOuter.bottom - Math.round(cardH * offsetPct),
      };
      setInner(initInner);

      // Initialize corner mode
      setOuterCorners({
        tl: { x: initOuter.left, y: initOuter.top },
        tr: { x: initOuter.right, y: initOuter.top },
        bl: { x: initOuter.left, y: initOuter.bottom },
        br: { x: initOuter.right, y: initOuter.bottom },
      });
      setInnerCorners({
        tl: { x: initInner.left, y: initInner.top },
        tr: { x: initInner.right, y: initInner.top },
        bl: { x: initInner.left, y: initInner.bottom },
        br: { x: initInner.right, y: initInner.bottom },
      });
    };
    img.src = image;
  }, [image]);

  // Calculate live centering from edge mode
  const cW = outer ? outer.right - outer.left : 0;
  const cH = outer ? outer.bottom - outer.top : 0;
  const bL = outer && inner ? inner.left - outer.left : 0;
  const bR = outer && inner ? outer.right - inner.right : 0;
  const bT = outer && inner ? inner.top - outer.top : 0;
  const bB = outer && inner ? outer.bottom - inner.bottom : 0;
  const lrR = Math.round(((bL + bR) > 0 ? bL / (bL + bR) * 100 : 50) * 10) / 10;
  const tbR = Math.round(((bT + bB) > 0 ? bT / (bT + bB) * 100 : 50) * 10) / 10;

  const getCoords = (e) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    return {
      x: Math.round((e.clientX - rect.left) / rect.width * imgSize.w),
      y: Math.round((e.clientY - rect.top) / rect.height * imgSize.h),
    };
  };

  const moveHandle = (which, x, y) => {
    const o = outerRef.current, inn = innerRef.current;
    if (!o || !inn) return;

    if (which === 'OL') setOuter(p => ({ ...p, left: Math.max(0, Math.min(inn.left - 20, x)) }));
    else if (which === 'OR') setOuter(p => ({ ...p, right: Math.min(imgSize.w, Math.max(inn.right + 20, x)) }));
    else if (which === 'OT') setOuter(p => ({ ...p, top: Math.max(0, Math.min(inn.top - 20, y)) }));
    else if (which === 'OB') setOuter(p => ({ ...p, bottom: Math.min(imgSize.h, Math.max(inn.bottom + 20, y)) }));
    else if (which === 'IL') setInner(p => ({ ...p, left: Math.max(o.left + 8, Math.min(p.right - 30, x)) }));
    else if (which === 'IR') setInner(p => ({ ...p, right: Math.min(o.right - 8, Math.max(p.left + 30, x)) }));
    else if (which === 'IT') setInner(p => ({ ...p, top: Math.max(o.top + 8, Math.min(p.bottom - 30, y)) }));
    else if (which === 'IB') setInner(p => ({ ...p, bottom: Math.min(o.bottom - 8, Math.max(p.top + 30, y)) }));
  };

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

    const offsetPct = 0.08;
    const cardW = initOuter.right - initOuter.left;
    const cardH = initOuter.bottom - initOuter.top;
    const initInner = {
      left: initOuter.left + Math.round(cardW * offsetPct),
      right: initOuter.right - Math.round(cardW * offsetPct),
      top: initOuter.top + Math.round(cardH * offsetPct),
      bottom: initOuter.bottom - Math.round(cardH * offsetPct),
    };
    setInner(initInner);

    setOuterCorners({
      tl: { x: initOuter.left, y: initOuter.top },
      tr: { x: initOuter.right, y: initOuter.top },
      bl: { x: initOuter.left, y: initOuter.bottom },
      br: { x: initOuter.right, y: initOuter.bottom },
    });
    setInnerCorners({
      tl: { x: initInner.left, y: initInner.top },
      tr: { x: initInner.right, y: initInner.top },
      bl: { x: initInner.left, y: initInner.bottom },
      br: { x: initInner.right, y: initInner.bottom },
    });
    setCornerCenteringResult(null);
    setRotation(0);
    setTiltX(0);
    setTiltY(0);
  };

  const handleConfirm = async () => {
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

      // Crop image to outer bounds
      const croppedImage = await cropToOuterBounds(image, cropCorners, rotation);

      // Build centering data
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
        centeringData = {
          didManualCenter: true,
          measureMode: 'edge',
          outer,
          inner,
          rotation,
          tiltX,
          tiltY,
          croppedBounds: { x: outer.left, y: outer.top, width: cW, height: cH },
          borderL: bL,
          borderR: bR,
          borderT: bT,
          borderB: bB,
          lrRatio: lrR,
          tbRatio: tbR,
        };
      }

      onConfirm({ croppedImage, centeringData });
    } catch (err) {
      console.error('[PostCaptureCentering] Confirm failed:', err);
      onSkip();
    } finally {
      setIsProcessing(false);
    }
  };

  if (!image || !outer || !inner || imgSize.w === 0) {
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

  // Handle dimensions
  const handleSize = Math.max(28, Math.min(cW, cH) * 0.035);
  const lw = Math.max(3, cW * 0.005);
  const pad = 40;
  const handleOffset = handleSize * 0.8;

  // Edge-drag handles: [x, y, which, isOuter, isHoriz, arrowDir]
  const handles = [
    [(outer.left + outer.right) / 2, outer.top - handleOffset, 'OT', true, true, '↓'],
    [(outer.left + outer.right) / 2, outer.bottom + handleOffset, 'OB', true, true, '↑'],
    [outer.left - handleOffset, (outer.top + outer.bottom) / 2, 'OL', true, false, '→'],
    [outer.right + handleOffset, (outer.top + outer.bottom) / 2, 'OR', true, false, '←'],
    [(inner.left + inner.right) / 2, inner.top + handleOffset, 'IT', false, true, '↑'],
    [(inner.left + inner.right) / 2, inner.bottom - handleOffset, 'IB', false, true, '↓'],
    [inner.left + handleOffset, (inner.top + inner.bottom) / 2, 'IL', false, false, '←'],
    [inner.right - handleOffset, (inner.top + inner.bottom) / 2, 'IR', false, false, '→'],
  ];

  // Live centering display values
  const displayLR = measureMode === 'corner' && cornerCenteringResult
    ? cornerCenteringResult.centering.horizontal
    : lrR;
  const displayTB = measureMode === 'corner' && cornerCenteringResult
    ? cornerCenteringResult.centering.vertical
    : tbR;
  const displayLROff = Math.max(displayLR, 100 - displayLR);
  const displayTBOff = Math.max(displayTB, 100 - displayTB);

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: '#0a0b0e',
      zIndex: 1100,
      overflow: 'auto',
      WebkitOverflowScrolling: 'touch',
    }}>
      {/* Main container matching ManualBoundaryEditor */}
      <div style={{ background: '#0d0f13', minHeight: '100%' }}>
        {/* Header */}
        <div style={{ padding: '10px 12px', borderBottom: '1px solid #1a1c22', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontFamily: mono, fontSize: 11, color: '#ff9944', textTransform: 'uppercase', letterSpacing: '.06em' }}>
            Manual Adjust — {side}
          </span>
          <button
            onClick={handleReset}
            style={{ fontFamily: mono, fontSize: 9, color: '#555', background: 'transparent', border: '1px solid #333', borderRadius: 4, padding: '3px 8px', cursor: 'pointer' }}
          >
            Reset All
          </button>
        </div>

        {/* Measurement Mode Toggle */}
        <div style={{ padding: '8px 12px', background: 'rgba(0,0,0,.4)', borderBottom: '1px solid #1a1c22', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
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
              Edge Drag (v1)
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
              Corner Anchored (β)
            </button>
          </div>
        </div>

        {/* Rotation & Tilt Controls */}
        <div style={{ padding: '10px 12px', background: 'rgba(0,0,0,.3)', borderBottom: '1px solid #1a1c22' }}>
          <div style={{ fontFamily: mono, fontSize: 9, color: '#666', marginBottom: 8, textTransform: 'uppercase' }}>
            Step 1: Straighten & Correct Perspective
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

          {/* All axes summary */}
          <div style={{ display: 'flex', justifyContent: 'center', gap: 12, marginTop: 8 }}>
            <span style={{ fontFamily: mono, fontSize: 9, color: tiltX === 0 ? '#444' : '#ff6b6b' }}>X:{tiltX}°</span>
            <span style={{ fontFamily: mono, fontSize: 9, color: tiltY === 0 ? '#444' : '#4ecdc4' }}>Y:{tiltY}°</span>
            <span style={{ fontFamily: mono, fontSize: 9, color: rotation === 0 ? '#444' : '#ff9944' }}>Z:{rotation}°</span>
          </div>
          <div style={{ textAlign: 'center', fontFamily: mono, fontSize: 8, color: '#444', marginTop: 4 }}>‹‹/›› = 1° · ‹/› = 0.05°</div>
        </div>

        {/* Live centering readout */}
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

        {/* Legend */}
        <div style={{ padding: '6px 12px', display: 'flex', gap: 12, borderBottom: '1px solid #0d0f13', flexWrap: 'wrap' }}>
          {measureMode === 'edge' ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <svg width={16} height={16}><rect x={2} y={2} width={12} height={12} rx={2} fill="#111" stroke="#ff9944" strokeWidth={2} /></svg>
                <span style={{ fontFamily: mono, fontSize: 9, color: '#ff9944' }}>Card edge</span>
                <span style={{ fontFamily: mono, fontSize: 8, color: '#555' }}>(outside→in)</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <svg width={16} height={16}><rect x={2} y={2} width={12} height={12} rx={2} fill="#111" stroke="#00ff88" strokeWidth={2} /></svg>
                <span style={{ fontFamily: mono, fontSize: 9, color: '#00ff88' }}>Artwork</span>
                <span style={{ fontFamily: mono, fontSize: 8, color: '#555' }}>(inside→out)</span>
              </div>
            </>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <svg width={16} height={16}><circle cx={8} cy={8} r={6} fill="#111" stroke="#00bcd4" strokeWidth={2} /></svg>
                <span style={{ fontFamily: mono, fontSize: 9, color: '#00bcd4' }}>Outer corners</span>
                <span style={{ fontFamily: mono, fontSize: 8, color: '#555' }}>(card edge)</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <svg width={16} height={16}><circle cx={8} cy={8} r={6} fill="#111" stroke="#e91e63" strokeWidth={2} /></svg>
                <span style={{ fontFamily: mono, fontSize: 9, color: '#e91e63' }}>Inner corners</span>
                <span style={{ fontFamily: mono, fontSize: 8, color: '#555' }}>(artwork)</span>
              </div>
            </>
          )}
        </div>

        {/* Step 2 label */}
        <div style={{ padding: '8px 12px', background: 'rgba(0,0,0,.2)', borderBottom: '1px solid #0d0f13' }}>
          <div style={{ fontFamily: mono, fontSize: 9, color: '#666', textTransform: 'uppercase' }}>Step 2: Adjust Borders</div>
        </div>

        {/* Image + drag canvas */}
        <div
          style={{ position: 'relative', lineHeight: 0, touchAction: 'none', overflow: 'visible' }}
          onTouchMove={e => { if (dragging.current) e.preventDefault(); }}
          onTouchStart={e => { if (dragging.current) e.preventDefault(); }}
        >
          <img
            src={image}
            alt="Card"
            style={{
              width: '100%',
              display: 'block',
              transform: `perspective(800px) rotateX(${tiltX}deg) rotateY(${tiltY}deg) rotateZ(${rotation}deg)`,
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
            viewBox={`0 0 ${imgSize.w} ${imgSize.h}`}
            style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', overflow: 'visible', touchAction: 'none' }}
          >
            {measureMode === 'edge' ? (
              <>
                {/* Outer boundary (orange) */}
                <rect
                  x={outer.left}
                  y={outer.top}
                  width={cW}
                  height={cH}
                  fill="none"
                  stroke="#ff9944"
                  strokeWidth={lw}
                  opacity={0.85}
                />
                {/* Corner brackets */}
                {[[outer.left, outer.top, 1, 1], [outer.right, outer.top, -1, 1], [outer.left, outer.bottom, 1, -1], [outer.right, outer.bottom, -1, -1]].map(([x, y, sx, sy], i) => (
                  <g key={i}>
                    <line x1={x} y1={y} x2={x + sx * cW * 0.06} y2={y} stroke="#ff9944" strokeWidth={lw * 1.5} />
                    <line x1={x} y1={y} x2={x} y2={y + sy * cH * 0.04} stroke="#ff9944" strokeWidth={lw * 1.5} />
                  </g>
                ))}
                {/* Inner boundary (green dashed) */}
                <rect
                  x={inner.left}
                  y={inner.top}
                  width={inner.right - inner.left}
                  height={inner.bottom - inner.top}
                  fill="none"
                  stroke="#00ff88"
                  strokeWidth={Math.max(2, lw * 0.8)}
                  strokeDasharray={`${cW * 0.025},${cW * 0.012}`}
                  opacity={0.8}
                />
                {/* Drag handles */}
                {handles.map(([hx, hy, which, isOuter, isHoriz, arrow]) => {
                  const color = isOuter ? '#ff9944' : '#00ff88';
                  const sz = handleSize;
                  const fontSize = sz * 0.6;
                  return (
                    <g
                      key={which}
                      style={{ cursor: isHoriz ? 'ns-resize' : 'ew-resize', touchAction: 'none' }}
                      onPointerDown={e => { e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId); dragging.current = which; }}
                      onPointerMove={e => { if (dragging.current === which) { e.preventDefault(); const { x, y } = getCoords(e); moveHandle(which, x, y); } }}
                      onPointerUp={() => { dragging.current = null; }}
                    >
                      <rect x={hx - sz / 2 - pad} y={hy - sz / 2 - pad} width={sz + pad * 2} height={sz + pad * 2} fill="transparent" />
                      <rect x={hx - sz / 2} y={hy - sz / 2} width={sz} height={sz} rx={4} fill="#111" stroke={color} strokeWidth={Math.max(2, lw * 0.6)} />
                      <text x={hx} y={hy} textAnchor="middle" dominantBaseline="central" fill={color} fontSize={fontSize} fontWeight="bold" style={{ pointerEvents: 'none' }}>
                        {arrow}
                      </text>
                    </g>
                  );
                })}
              </>
            ) : (
              <CornerHandles
                imgW={imgSize.w}
                imgH={imgSize.h}
                outerCorners={outerCorners}
                innerCorners={innerCorners}
                setOuterCorners={setOuterCorners}
                setInnerCorners={setInnerCorners}
                svgRef={svgRef}
                onCenteringUpdate={setCornerCenteringResult}
              />
            )}
          </svg>
        </div>

        {/* Edge breakdown panel for corner mode */}
        {measureMode === 'corner' && cornerCenteringResult && (
          <div style={{ padding: '0 12px' }}>
            <EdgeBreakdownPanel centeringResult={cornerCenteringResult} />
          </div>
        )}

        {/* Mode comparison */}
        {measureMode === 'corner' && cornerCenteringResult && (
          <div style={{ padding: '8px 12px', background: 'rgba(0,0,0,.3)', borderTop: '1px solid #1a1c22' }}>
            <div style={{ fontFamily: mono, fontSize: 8, color: '#666', textTransform: 'uppercase', marginBottom: 6 }}>Mode Comparison</div>
            <div style={{ display: 'flex', justifyContent: 'space-around', gap: 8 }}>
              <div style={{ flex: 1, padding: '6px 8px', background: '#1a1c22', borderRadius: 4, textAlign: 'center' }}>
                <div style={{ fontFamily: mono, fontSize: 8, color: '#ff9944', marginBottom: 2 }}>Edge Drag (v1)</div>
                <div style={{ fontFamily: mono, fontSize: 12, color: '#888' }}>{lrR}/{Math.round((100 - lrR) * 10) / 10} · {tbR}/{Math.round((100 - tbR) * 10) / 10}</div>
              </div>
              <div style={{ flex: 1, padding: '6px 8px', background: '#00bcd411', border: '1px solid #00bcd433', borderRadius: 4, textAlign: 'center' }}>
                <div style={{ fontFamily: mono, fontSize: 8, color: '#00bcd4', marginBottom: 2 }}>Corner (β)</div>
                <div style={{ fontFamily: mono, fontSize: 12, color: '#fff' }}>{cornerCenteringResult.centering.lrDisplay} · {cornerCenteringResult.centering.tbDisplay}</div>
              </div>
            </div>
          </div>
        )}

        {/* Action buttons - sticky at bottom */}
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
          <button
            onClick={onSkip}
            style={{
              flex: 1,
              padding: '11px 0',
              borderRadius: 7,
              border: '1px solid #333',
              background: '#1a1c22',
              color: '#888',
              fontFamily: mono,
              fontSize: 11,
              cursor: 'pointer',
              textTransform: 'uppercase',
              letterSpacing: '.06em',
            }}
          >
            Skip
          </button>
          <button
            onClick={handleConfirm}
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
            {isProcessing ? 'Processing...' : '✓ Confirm'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default PostCaptureCentering;
