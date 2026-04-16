/**
 * PostCaptureCentering - Manual card alignment after photo capture
 *
 * Appears immediately after "Use Photo" to let users:
 * 1. Drag corners to define card edges (for cropping)
 * 2. Rotate to straighten tilted cards
 * 3. Optionally set inner bounds (artwork) for centering data
 *
 * Returns cropped image + centering data on confirm.
 * Skip falls back to auto-crop flow.
 */

import React, { useState, useRef, useEffect } from 'react';
import {
  initializeCorners,
  initializeInnerCorners,
  cropToOuterBounds,
  calculateCenteringFromBounds,
  getBoundsFromCorners,
} from '../../lib/centering-utils.js';

const mono = "'JetBrains Mono','SF Mono',monospace";

export function PostCaptureCentering({
  image,
  side = 'front',
  onConfirm,
  onSkip,
}) {
  const svgRef = useRef(null);
  const [imgSize, setImgSize] = useState({ w: 0, h: 0 });
  const [outerCorners, setOuterCorners] = useState(null);
  const [innerCorners, setInnerCorners] = useState(null);
  const [showInner, setShowInner] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [tiltX, setTiltX] = useState(0);
  const [tiltY, setTiltY] = useState(0);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [instructionOpacity, setInstructionOpacity] = useState(1);
  const [isProcessing, setIsProcessing] = useState(false);

  const dragging = useRef(null);
  const dragOffset = useRef({ x: 0, y: 0 });
  const outerCornersRef = useRef(outerCorners);
  const innerCornersRef = useRef(innerCorners);

  useEffect(() => { outerCornersRef.current = outerCorners; }, [outerCorners]);
  useEffect(() => { innerCornersRef.current = innerCorners; }, [innerCorners]);

  // Load image and initialize corners
  useEffect(() => {
    if (!image) return;

    const img = new Image();
    img.onload = () => {
      const w = img.width;
      const h = img.height;
      setImgSize({ w, h });

      // Initialize corners with 8% margin (tighter than CardCropModal)
      const outer = initializeCorners(w, h, 0.08);
      setOuterCorners(outer);
      setInnerCorners(initializeInnerCorners(outer, 0.06));
    };
    img.src = image;
  }, [image]);

  // Fade out instruction after 3 seconds
  useEffect(() => {
    const timer = setTimeout(() => {
      setInstructionOpacity(0);
    }, 3000);
    return () => clearTimeout(timer);
  }, []);

  // Coordinate conversion
  const getCoords = (e) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    return {
      x: Math.round((e.clientX - rect.left) / rect.width * imgSize.w),
      y: Math.round((e.clientY - rect.top) / rect.height * imgSize.h),
    };
  };

  const getCornerPosition = (which, isInner = false) => {
    const corners = isInner ? innerCornersRef.current : outerCornersRef.current;
    if (!corners) return { x: 0, y: 0 };
    return corners[which] || { x: 0, y: 0 };
  };

  const startDrag = (which, isInner, e) => {
    const touchPos = getCoords(e);
    const cornerPos = getCornerPosition(which, isInner);
    dragOffset.current = {
      x: cornerPos.x - touchPos.x,
      y: cornerPos.y - touchPos.y,
    };
    dragging.current = { which, isInner };
  };

  const moveCorner = (which, isInner, x, y) => {
    const adjustedX = x + dragOffset.current.x;
    const adjustedY = y + dragOffset.current.y;
    const minGap = 30;

    if (isInner) {
      setInnerCorners(p => {
        if (!p || !outerCornersRef.current) return p;
        const o = outerCornersRef.current;
        const newCorners = { ...p };

        if (which === 'tl') {
          newCorners.tl = {
            x: Math.max(o.tl.x + minGap, Math.min(adjustedX, p.tr.x - minGap)),
            y: Math.max(o.tl.y + minGap, Math.min(adjustedY, p.bl.y - minGap)),
          };
        } else if (which === 'tr') {
          newCorners.tr = {
            x: Math.min(o.tr.x - minGap, Math.max(adjustedX, p.tl.x + minGap)),
            y: Math.max(o.tr.y + minGap, Math.min(adjustedY, p.br.y - minGap)),
          };
        } else if (which === 'bl') {
          newCorners.bl = {
            x: Math.max(o.bl.x + minGap, Math.min(adjustedX, p.br.x - minGap)),
            y: Math.min(o.bl.y - minGap, Math.max(adjustedY, p.tl.y + minGap)),
          };
        } else if (which === 'br') {
          newCorners.br = {
            x: Math.min(o.br.x - minGap, Math.max(adjustedX, p.bl.x + minGap)),
            y: Math.min(o.br.y - minGap, Math.max(adjustedY, p.tr.y + minGap)),
          };
        }
        return newCorners;
      });
    } else {
      setOuterCorners(p => {
        if (!p) return p;
        const newCorners = { ...p };

        if (which === 'tl') {
          newCorners.tl = {
            x: Math.max(0, Math.min(adjustedX, p.tr.x - minGap)),
            y: Math.max(0, Math.min(adjustedY, p.bl.y - minGap)),
          };
        } else if (which === 'tr') {
          newCorners.tr = {
            x: Math.min(imgSize.w, Math.max(adjustedX, p.tl.x + minGap)),
            y: Math.max(0, Math.min(adjustedY, p.br.y - minGap)),
          };
        } else if (which === 'bl') {
          newCorners.bl = {
            x: Math.max(0, Math.min(adjustedX, p.br.x - minGap)),
            y: Math.min(imgSize.h, Math.max(adjustedY, p.tl.y + minGap)),
          };
        } else if (which === 'br') {
          newCorners.br = {
            x: Math.min(imgSize.w, Math.max(adjustedX, p.bl.x + minGap)),
            y: Math.min(imgSize.h, Math.max(adjustedY, p.tr.y + minGap)),
          };
        }
        return newCorners;
      });

      // Also adjust inner corners to stay within outer
      if (innerCornersRef.current) {
        setInnerCorners(prev => {
          if (!prev) return prev;
          const newInner = { ...prev };
          // Clamp inner to stay inside outer with minGap
          // This is a simplified constraint - just ensure inner doesn't exceed outer
          return newInner;
        });
      }
    }
  };

  const handleConfirm = async () => {
    if (!outerCorners || !image) return;

    setIsProcessing(true);
    try {
      // Crop image to outer bounds
      const croppedImage = await cropToOuterBounds(image, outerCorners, rotation);

      // Calculate centering if inner bounds are set
      let centeringData = null;
      if (innerCorners && showInner) {
        centeringData = calculateCenteringFromBounds(outerCorners, innerCorners);
      }

      const result = {
        croppedImage,
        centeringData: {
          didManualCenter: true,
          outerCorners,
          innerCorners: showInner ? innerCorners : null,
          rotation,
          tiltX,
          tiltY,
          croppedBounds: getBoundsFromCorners(outerCorners),
          ...(centeringData || {}),
        },
      };

      onConfirm(result);
    } catch (err) {
      console.error('[PostCaptureCentering] Crop failed:', err);
      // Fall back to skip on error
      onSkip();
    } finally {
      setIsProcessing(false);
    }
  };

  if (!image || !outerCorners || imgSize.w === 0) {
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

  const handleSize = 32;
  const handleOffset = handleSize * 1.3;
  const lw = 2;

  // Outer corner handles (cyan)
  const outerHandles = [
    { x: outerCorners.tl.x - handleOffset, y: outerCorners.tl.y - handleOffset, which: 'tl', label: '↘' },
    { x: outerCorners.tr.x + handleOffset, y: outerCorners.tr.y - handleOffset, which: 'tr', label: '↙' },
    { x: outerCorners.bl.x - handleOffset, y: outerCorners.bl.y + handleOffset, which: 'bl', label: '↗' },
    { x: outerCorners.br.x + handleOffset, y: outerCorners.br.y + handleOffset, which: 'br', label: '↖' },
  ];

  // Inner corner handles (magenta) - only shown when expanded
  const innerHandles = innerCorners && showInner ? [
    { x: innerCorners.tl.x + handleOffset * 0.5, y: innerCorners.tl.y + handleOffset * 0.5, which: 'tl', label: '↗' },
    { x: innerCorners.tr.x - handleOffset * 0.5, y: innerCorners.tr.y + handleOffset * 0.5, which: 'tr', label: '↖' },
    { x: innerCorners.bl.x + handleOffset * 0.5, y: innerCorners.bl.y - handleOffset * 0.5, which: 'bl', label: '↘' },
    { x: innerCorners.br.x - handleOffset * 0.5, y: innerCorners.br.y - handleOffset * 0.5, which: 'br', label: '↙' },
  ] : [];

  const rotateBtn = (delta, label, fine = false) => (
    <button
      onClick={() => setRotation(r => Math.round((r + delta) * 100) / 100)}
      style={{
        padding: fine ? '6px 8px' : '6px 12px',
        background: '#1a1c22',
        border: '1px solid #333',
        borderRadius: 4,
        color: '#ff9944',
        fontFamily: mono,
        fontSize: fine ? 10 : 12,
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  );

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: '#000',
      zIndex: 1100,
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        padding: '12px 16px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        background: 'rgba(0,0,0,0.9)',
        borderBottom: '1px solid #222',
      }}>
        <button
          onClick={onSkip}
          style={{
            background: 'transparent',
            border: 'none',
            color: '#888',
            fontFamily: mono,
            fontSize: 12,
            cursor: 'pointer',
            padding: '4px 8px',
          }}
        >
          ✕ Skip
        </button>
        <div style={{
          fontFamily: mono,
          fontSize: 12,
          color: '#fff',
          textTransform: 'uppercase',
          letterSpacing: '.1em',
        }}>
          Align {side}
        </div>
        <div style={{ width: 60 }} />
      </div>

      {/* Image with handles */}
      <div style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        overflow: 'hidden',
      }}>
        <div style={{
          position: 'relative',
          lineHeight: 0,
          maxWidth: '100%',
          maxHeight: '100%',
          transform: `perspective(800px) rotateX(${tiltX}deg) rotateY(${tiltY}deg) rotateZ(${rotation}deg)`,
          transformOrigin: 'center center',
          transition: 'transform 0.15s ease',
        }}>
          <img
            src={image}
            alt="Card"
            style={{
              maxWidth: '100%',
              maxHeight: 'calc(100vh - 280px)',
              display: 'block',
            }}
          />
          <svg
            ref={svgRef}
            viewBox={`0 0 ${imgSize.w} ${imgSize.h}`}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              overflow: 'visible',
              touchAction: 'none',
            }}
          >
            {/* Crosshair guides */}
            <line
              x1={imgSize.w / 2} y1={0}
              x2={imgSize.w / 2} y2={imgSize.h}
              stroke="rgba(0,255,136,0.2)"
              strokeWidth={1}
              strokeDasharray="8,8"
            />
            <line
              x1={0} y1={imgSize.h / 2}
              x2={imgSize.w} y2={imgSize.h / 2}
              stroke="rgba(0,255,136,0.2)"
              strokeWidth={1}
              strokeDasharray="8,8"
            />

            {/* Darkened overlay outside crop */}
            <defs>
              <mask id="cropMaskPost">
                <rect x="0" y="0" width={imgSize.w} height={imgSize.h} fill="white" />
                <polygon
                  points={`${outerCorners.tl.x},${outerCorners.tl.y} ${outerCorners.tr.x},${outerCorners.tr.y} ${outerCorners.br.x},${outerCorners.br.y} ${outerCorners.bl.x},${outerCorners.bl.y}`}
                  fill="black"
                />
              </mask>
            </defs>
            <rect
              x="0" y="0"
              width={imgSize.w} height={imgSize.h}
              fill="rgba(0,0,0,0.5)"
              mask="url(#cropMaskPost)"
            />

            {/* Outer boundary (card edge) - cyan */}
            <polygon
              points={`${outerCorners.tl.x},${outerCorners.tl.y} ${outerCorners.tr.x},${outerCorners.tr.y} ${outerCorners.br.x},${outerCorners.br.y} ${outerCorners.bl.x},${outerCorners.bl.y}`}
              fill="none"
              stroke="#00bcd4"
              strokeWidth={lw}
            />

            {/* Inner boundary (artwork) - magenta dashed */}
            {innerCorners && showInner && (
              <polygon
                points={`${innerCorners.tl.x},${innerCorners.tl.y} ${innerCorners.tr.x},${innerCorners.tr.y} ${innerCorners.br.x},${innerCorners.br.y} ${innerCorners.bl.x},${innerCorners.bl.y}`}
                fill="none"
                stroke="#e91e63"
                strokeWidth={lw}
                strokeDasharray="6,4"
              />
            )}

            {/* Outer corner handles */}
            {outerHandles.map(({ x, y, which, label }) => (
              <g
                key={`outer-${which}`}
                style={{ cursor: 'move', touchAction: 'none' }}
                onPointerDown={e => {
                  e.stopPropagation();
                  e.currentTarget.setPointerCapture(e.pointerId);
                  startDrag(which, false, e);
                }}
                onPointerMove={e => {
                  if (dragging.current?.which === which && !dragging.current?.isInner) {
                    e.preventDefault();
                    const { x: newX, y: newY } = getCoords(e);
                    moveCorner(which, false, newX, newY);
                  }
                }}
                onPointerUp={() => {
                  dragging.current = null;
                  dragOffset.current = { x: 0, y: 0 };
                }}
              >
                <rect
                  x={x - handleSize - 25}
                  y={y - handleSize - 25}
                  width={handleSize * 2 + 50}
                  height={handleSize * 2 + 50}
                  fill="transparent"
                />
                <circle
                  cx={x}
                  cy={y}
                  r={handleSize / 2}
                  fill="#111"
                  stroke="#00bcd4"
                  strokeWidth={2}
                />
                <text
                  x={x}
                  y={y}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill="#00bcd4"
                  fontSize={handleSize * 0.45}
                  fontWeight="bold"
                  style={{ pointerEvents: 'none' }}
                >
                  {label}
                </text>
              </g>
            ))}

            {/* Inner corner handles */}
            {innerHandles.map(({ x, y, which, label }) => (
              <g
                key={`inner-${which}`}
                style={{ cursor: 'move', touchAction: 'none' }}
                onPointerDown={e => {
                  e.stopPropagation();
                  e.currentTarget.setPointerCapture(e.pointerId);
                  startDrag(which, true, e);
                }}
                onPointerMove={e => {
                  if (dragging.current?.which === which && dragging.current?.isInner) {
                    e.preventDefault();
                    const { x: newX, y: newY } = getCoords(e);
                    moveCorner(which, true, newX, newY);
                  }
                }}
                onPointerUp={() => {
                  dragging.current = null;
                  dragOffset.current = { x: 0, y: 0 };
                }}
              >
                <rect
                  x={x - handleSize - 20}
                  y={y - handleSize - 20}
                  width={handleSize * 2 + 40}
                  height={handleSize * 2 + 40}
                  fill="transparent"
                />
                <circle
                  cx={x}
                  cy={y}
                  r={handleSize / 2 - 2}
                  fill="#111"
                  stroke="#e91e63"
                  strokeWidth={2}
                />
                <text
                  x={x}
                  y={y}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill="#e91e63"
                  fontSize={handleSize * 0.4}
                  fontWeight="bold"
                  style={{ pointerEvents: 'none' }}
                >
                  {label}
                </text>
              </g>
            ))}
          </svg>
        </div>
      </div>

      {/* Instruction message (fades out) */}
      <div style={{
        position: 'absolute',
        top: 70,
        left: '50%',
        transform: 'translateX(-50%)',
        background: 'rgba(0,188,212,0.15)',
        border: '1px solid rgba(0,188,212,0.3)',
        borderRadius: 8,
        padding: '10px 20px',
        opacity: instructionOpacity,
        transition: 'opacity 1s ease',
        pointerEvents: 'none',
        zIndex: 10,
      }}>
        <div style={{ fontFamily: mono, fontSize: 11, color: '#00bcd4', textAlign: 'center' }}>
          Drag corners to card edges for better identification
        </div>
      </div>

      {/* Controls */}
      <div style={{
        padding: '12px 16px',
        background: 'rgba(0,0,0,0.9)',
        borderTop: '1px solid #222',
      }}>
        {/* Rotation controls */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          marginBottom: 12,
        }}>
          <span style={{ fontFamily: mono, fontSize: 10, color: '#666', marginRight: 4 }}>Rotate:</span>
          {rotateBtn(-1, '‹‹')}
          {rotateBtn(-0.1, '‹', true)}
          <span style={{
            fontFamily: mono,
            fontSize: 12,
            color: '#ff9944',
            minWidth: 50,
            textAlign: 'center',
          }}>
            {rotation.toFixed(1)}°
          </span>
          {rotateBtn(0.1, '›', true)}
          {rotateBtn(1, '››')}
        </div>

        {/* Advanced toggle */}
        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          style={{
            display: 'block',
            width: '100%',
            padding: '8px',
            background: 'transparent',
            border: 'none',
            color: '#666',
            fontFamily: mono,
            fontSize: 10,
            cursor: 'pointer',
            textAlign: 'left',
          }}
        >
          {showAdvanced ? '▾' : '▸'} Advanced (tilt, inner bounds)
        </button>

        {/* Advanced controls */}
        {showAdvanced && (
          <div style={{
            padding: '12px',
            background: '#111',
            borderRadius: 6,
            marginBottom: 12,
          }}>
            {/* Tilt X */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ fontFamily: mono, fontSize: 10, color: '#ff6b6b', width: 50 }}>Pitch:</span>
              <button onClick={() => setTiltX(t => t - 1)} style={tiltBtnStyle}>‹‹</button>
              <button onClick={() => setTiltX(t => t - 0.1)} style={tiltBtnStyle}>‹</button>
              <span style={{ fontFamily: mono, fontSize: 11, color: '#ff6b6b', width: 40, textAlign: 'center' }}>
                {tiltX.toFixed(1)}°
              </span>
              <button onClick={() => setTiltX(t => t + 0.1)} style={tiltBtnStyle}>›</button>
              <button onClick={() => setTiltX(t => t + 1)} style={tiltBtnStyle}>››</button>
            </div>

            {/* Tilt Y */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <span style={{ fontFamily: mono, fontSize: 10, color: '#4ecdc4', width: 50 }}>Roll:</span>
              <button onClick={() => setTiltY(t => t - 1)} style={tiltBtnStyle}>‹‹</button>
              <button onClick={() => setTiltY(t => t - 0.1)} style={tiltBtnStyle}>‹</button>
              <span style={{ fontFamily: mono, fontSize: 11, color: '#4ecdc4', width: 40, textAlign: 'center' }}>
                {tiltY.toFixed(1)}°
              </span>
              <button onClick={() => setTiltY(t => t + 0.1)} style={tiltBtnStyle}>›</button>
              <button onClick={() => setTiltY(t => t + 1)} style={tiltBtnStyle}>››</button>
            </div>

            {/* Inner bounds toggle */}
            <button
              onClick={() => setShowInner(!showInner)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 12px',
                background: showInner ? 'rgba(233,30,99,0.15)' : '#1a1c22',
                border: `1px solid ${showInner ? '#e91e63' : '#333'}`,
                borderRadius: 6,
                color: showInner ? '#e91e63' : '#888',
                fontFamily: mono,
                fontSize: 10,
                cursor: 'pointer',
                width: '100%',
              }}
            >
              <span style={{ fontSize: 14 }}>{showInner ? '☑' : '☐'}</span>
              Show artwork bounds (for centering)
            </button>
          </div>
        )}

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: 12 }}>
          <button
            onClick={onSkip}
            style={{
              flex: 1,
              padding: '14px',
              background: '#1a1c22',
              border: '1px solid #333',
              borderRadius: 8,
              color: '#888',
              fontFamily: mono,
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            Skip
          </button>
          <button
            onClick={handleConfirm}
            disabled={isProcessing}
            style={{
              flex: 2,
              padding: '14px',
              background: isProcessing
                ? '#333'
                : 'linear-gradient(135deg, #00bcd4, #0097a7)',
              border: 'none',
              borderRadius: 8,
              color: isProcessing ? '#666' : '#000',
              fontFamily: mono,
              fontSize: 12,
              fontWeight: 700,
              cursor: isProcessing ? 'wait' : 'pointer',
            }}
          >
            {isProcessing ? 'Processing...' : '✓ Confirm'}
          </button>
        </div>
      </div>
    </div>
  );
}

const tiltBtnStyle = {
  padding: '4px 8px',
  background: '#1a1c22',
  border: '1px solid #333',
  borderRadius: 3,
  color: '#888',
  fontFamily: mono,
  fontSize: 10,
  cursor: 'pointer',
};

export default PostCaptureCentering;
