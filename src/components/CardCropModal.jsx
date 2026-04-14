/**
 * CardCropModal - Simple corner crop for cards without TCGDex images
 *
 * When a card has no image in TCGDex, users can crop their captured photo
 * to create a placeholder image for the collection.
 */

import React, { useState, useRef, useEffect } from 'react';

const mono = "'JetBrains Mono','SF Mono',monospace";

export function CardCropModal({
  image,           // User's captured card image (data URL)
  onCrop,          // Callback with cropped image: (croppedDataUrl) => void
  onCancel,        // Cancel callback
  cardName,        // Card name for display
}) {
  const canvasRef = useRef(null);
  const svgRef = useRef(null);
  const [imgSize, setImgSize] = useState({ w: 0, h: 0 });
  const [corners, setCorners] = useState(null);
  const dragging = useRef(null);
  const dragOffset = useRef({ x: 0, y: 0 });

  // Load image and initialize corners
  useEffect(() => {
    if (!image) return;

    const img = new Image();
    img.onload = () => {
      const w = img.width;
      const h = img.height;
      setImgSize({ w, h });

      // Initialize corners with 10% margin
      const margin = 0.1;
      setCorners({
        tl: { x: Math.round(w * margin), y: Math.round(h * margin) },
        tr: { x: Math.round(w * (1 - margin)), y: Math.round(h * margin) },
        bl: { x: Math.round(w * margin), y: Math.round(h * (1 - margin)) },
        br: { x: Math.round(w * (1 - margin)), y: Math.round(h * (1 - margin)) },
      });
    };
    img.src = image;
  }, [image]);

  const getCoords = (e) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    return {
      x: Math.round((e.clientX - rect.left) / rect.width * imgSize.w),
      y: Math.round((e.clientY - rect.top) / rect.height * imgSize.h),
    };
  };

  const getCornerPosition = (which) => {
    if (!corners) return { x: 0, y: 0 };
    if (which === 'tl') return corners.tl;
    if (which === 'tr') return corners.tr;
    if (which === 'bl') return corners.bl;
    if (which === 'br') return corners.br;
    return { x: 0, y: 0 };
  };

  const startDrag = (which, e) => {
    const touchPos = getCoords(e);
    const cornerPos = getCornerPosition(which);
    dragOffset.current = {
      x: cornerPos.x - touchPos.x,
      y: cornerPos.y - touchPos.y
    };
    dragging.current = which;
  };

  const moveCorner = (which, x, y) => {
    const adjustedX = x + dragOffset.current.x;
    const adjustedY = y + dragOffset.current.y;
    const minGap = 50;

    setCorners(p => {
      if (!p) return p;
      const newCorners = { ...p };

      if (which === 'tl') {
        newCorners.tl = {
          x: Math.max(0, Math.min(adjustedX, p.tr.x - minGap, p.bl.x - minGap)),
          y: Math.max(0, Math.min(adjustedY, p.bl.y - minGap, p.tr.y - minGap))
        };
      } else if (which === 'tr') {
        newCorners.tr = {
          x: Math.min(imgSize.w, Math.max(adjustedX, p.tl.x + minGap, p.br.x + minGap)),
          y: Math.max(0, Math.min(adjustedY, p.br.y - minGap, p.tl.y - minGap))
        };
      } else if (which === 'bl') {
        newCorners.bl = {
          x: Math.max(0, Math.min(adjustedX, p.br.x - minGap, p.tl.x - minGap)),
          y: Math.min(imgSize.h, Math.max(adjustedY, p.tl.y + minGap, p.br.y + minGap))
        };
      } else if (which === 'br') {
        newCorners.br = {
          x: Math.min(imgSize.w, Math.max(adjustedX, p.bl.x + minGap, p.tr.x + minGap)),
          y: Math.min(imgSize.h, Math.max(adjustedY, p.tr.y + minGap, p.bl.y + minGap))
        };
      }

      return newCorners;
    });
  };

  const handleCrop = () => {
    if (!corners || !image) return;

    const img = new Image();
    img.onload = () => {
      // Calculate bounding box
      const minX = Math.min(corners.tl.x, corners.bl.x);
      const maxX = Math.max(corners.tr.x, corners.br.x);
      const minY = Math.min(corners.tl.y, corners.tr.y);
      const maxY = Math.max(corners.bl.y, corners.br.y);

      const cropW = maxX - minX;
      const cropH = maxY - minY;

      // Standard card aspect ratio is ~2.5:3.5
      const targetRatio = 2.5 / 3.5;
      let finalW = cropW;
      let finalH = cropH;

      // Adjust to card aspect ratio
      if (cropW / cropH > targetRatio) {
        finalW = cropH * targetRatio;
      } else {
        finalH = cropW / targetRatio;
      }

      // Create canvas and crop
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(finalW);
      canvas.height = Math.round(finalH);
      const ctx = canvas.getContext('2d');

      // Draw cropped region
      ctx.drawImage(
        img,
        minX, minY, cropW, cropH,
        0, 0, finalW, finalH
      );

      const croppedDataUrl = canvas.toDataURL('image/jpeg', 0.9);
      onCrop(croppedDataUrl);
    };
    img.src = image;
  };

  if (!image || !corners) return null;

  const handleSize = 28;
  const handleOffset = handleSize * 1.2;
  const lw = 2;

  const handles = [
    { x: corners.tl.x - handleOffset, y: corners.tl.y - handleOffset, which: 'tl', label: '↘' },
    { x: corners.tr.x + handleOffset, y: corners.tr.y - handleOffset, which: 'tr', label: '↙' },
    { x: corners.bl.x - handleOffset, y: corners.bl.y + handleOffset, which: 'bl', label: '↗' },
    { x: corners.br.x + handleOffset, y: corners.br.y + handleOffset, which: 'br', label: '↖' },
  ];

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: 'rgba(0,0,0,0.95)',
      zIndex: 9999,
      display: 'flex',
      flexDirection: 'column',
      padding: 16,
    }}>
      {/* Header */}
      <div style={{
        textAlign: 'center',
        marginBottom: 12,
        padding: '8px 16px',
        background: 'rgba(255,152,0,0.15)',
        borderRadius: 8,
        border: '1px solid rgba(255,152,0,0.3)',
      }}>
        <div style={{ fontFamily: mono, fontSize: 11, color: '#ff9800', marginBottom: 4 }}>
          ⚠️ NO IMAGE IN DATABASE
        </div>
        <div style={{ fontFamily: mono, fontSize: 10, color: '#888' }}>
          Adjust corners to crop your photo for collection
        </div>
        {cardName && (
          <div style={{ fontFamily: mono, fontSize: 12, color: '#fff', marginTop: 4 }}>
            {cardName}
          </div>
        )}
      </div>

      {/* Image with corner handles - use SVG image for proper alignment */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <svg
          ref={svgRef}
          viewBox={`0 0 ${imgSize.w} ${imgSize.h}`}
          preserveAspectRatio="xMidYMid meet"
          style={{
            maxWidth: '100%',
            maxHeight: '100%',
            width: 'auto',
            height: 'auto',
          }}
        >
          {/* Image as SVG background */}
          <image
            href={image}
            x="0"
            y="0"
            width={imgSize.w}
            height={imgSize.h}
          />
          {/* Darkened overlay outside crop area */}
          <defs>
            <mask id="cropMask">
              <rect x="0" y="0" width={imgSize.w} height={imgSize.h} fill="white" />
              <polygon
                points={`${corners.tl.x},${corners.tl.y} ${corners.tr.x},${corners.tr.y} ${corners.br.x},${corners.br.y} ${corners.bl.x},${corners.bl.y}`}
                fill="black"
              />
            </mask>
          </defs>
          <rect
            x="0" y="0"
            width={imgSize.w} height={imgSize.h}
            fill="rgba(0,0,0,0.6)"
            mask="url(#cropMask)"
          />

          {/* Crop boundary */}
          <polygon
            points={`${corners.tl.x},${corners.tl.y} ${corners.tr.x},${corners.tr.y} ${corners.br.x},${corners.br.y} ${corners.bl.x},${corners.bl.y}`}
            fill="none"
            stroke="#ff9800"
            strokeWidth={lw}
          />

          {/* Corner handles */}
          {handles.map(({ x, y, which, label }) => (
            <g
              key={which}
              style={{ cursor: 'move', touchAction: 'none' }}
              onPointerDown={e => {
                e.stopPropagation();
                e.currentTarget.setPointerCapture(e.pointerId);
                startDrag(which, e);
              }}
              onPointerMove={e => {
                if (dragging.current === which) {
                  e.preventDefault();
                  const { x: newX, y: newY } = getCoords(e);
                  moveCorner(which, newX, newY);
                }
              }}
              onPointerUp={() => {
                dragging.current = null;
                dragOffset.current = { x: 0, y: 0 };
              }}
            >
              {/* Large touch target */}
              <rect
                x={x - handleSize - 30}
                y={y - handleSize - 30}
                width={handleSize * 2 + 60}
                height={handleSize * 2 + 60}
                fill="transparent"
              />
              {/* Handle circle */}
              <circle
                cx={x}
                cy={y}
                r={handleSize / 2}
                fill="#111"
                stroke="#ff9800"
                strokeWidth={2}
              />
              {/* Arrow */}
              <text
                x={x}
                y={y}
                textAnchor="middle"
                dominantBaseline="central"
                fill="#ff9800"
                fontSize={handleSize * 0.55}
                fontWeight="bold"
                style={{ pointerEvents: 'none' }}
              >
                {label}
              </text>
            </g>
          ))}
        </svg>
      </div>

      {/* Action buttons */}
      <div style={{
        display: 'flex',
        gap: 12,
        marginTop: 16,
        justifyContent: 'center',
      }}>
        <button
          onClick={onCancel}
          style={{
            padding: '12px 24px',
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
          onClick={handleCrop}
          style={{
            padding: '12px 32px',
            background: 'linear-gradient(135deg, #ff9800, #f57c00)',
            border: 'none',
            borderRadius: 8,
            color: '#000',
            fontFamily: mono,
            fontSize: 12,
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          Crop & Save
        </button>
      </div>
    </div>
  );
}

export default CardCropModal;
