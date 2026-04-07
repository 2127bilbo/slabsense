/**
 * CardViewer3D - Interactive 3D card viewer with flip, spin, and slab preview
 *
 * Features:
 * - Tap to flip between front/back
 * - Drag to rotate 360
 * - Slab preview mode (show card in graded slab)
 */

import { useState, useRef, useEffect } from 'react';

const mono = "'JetBrains Mono','SF Mono',monospace";
const sans = "'Inter',-apple-system,sans-serif";

// Slab templates (placeholder colors - can be replaced with real images)
const SLAB_TEMPLATES = {
  psa: {
    name: 'PSA',
    bgColor: '#1a1a1a',
    borderColor: '#c41e3a',
    labelBg: '#c41e3a',
    labelColor: '#fff',
  },
  bgs: {
    name: 'BGS',
    bgColor: '#1a1a1a',
    borderColor: '#000',
    labelBg: '#000',
    labelColor: '#ffd700',
  },
  cgc: {
    name: 'CGC',
    bgColor: '#1a1a1a',
    borderColor: '#1e90ff',
    labelBg: '#1e90ff',
    labelColor: '#fff',
  },
  sgc: {
    name: 'SGC',
    bgColor: '#1a1a1a',
    borderColor: '#228b22',
    labelBg: '#228b22',
    labelColor: '#fff',
  },
  tag: {
    name: 'TAG',
    bgColor: '#1a1a1a',
    borderColor: '#6366f1',
    labelBg: '#6366f1',
    labelColor: '#fff',
  },
};

export function CardViewer3D({
  frontImage,
  backImage,
  grade = null,
  gradeLabel = null,
  gradingCompany = 'tag',
  onClose,
  style = {},
}) {
  const [rotateY, setRotateY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [startX, setStartX] = useState(0);
  const [viewMode, setViewMode] = useState('card'); // 'card' | 'slab'
  const containerRef = useRef(null);

  // Determine which side is showing
  const isShowingBack = Math.abs(rotateY % 360) > 90 && Math.abs(rotateY % 360) < 270;

  // Handle tap to flip
  const handleTap = () => {
    if (!isDragging) {
      setRotateY(prev => prev + 180);
    }
  };

  // Handle drag to rotate
  const handleDragStart = (clientX) => {
    setIsDragging(true);
    setStartX(clientX);
  };

  const handleDragMove = (clientX) => {
    if (isDragging) {
      const diff = clientX - startX;
      setRotateY(prev => prev + diff * 0.5);
      setStartX(clientX);
    }
  };

  const handleDragEnd = () => {
    setIsDragging(false);
  };

  // Mouse events
  const onMouseDown = (e) => handleDragStart(e.clientX);
  const onMouseMove = (e) => handleDragMove(e.clientX);
  const onMouseUp = () => handleDragEnd();
  const onMouseLeave = () => handleDragEnd();

  // Touch events
  const onTouchStart = (e) => handleDragStart(e.touches[0].clientX);
  const onTouchMove = (e) => handleDragMove(e.touches[0].clientX);
  const onTouchEnd = () => handleDragEnd();

  const slabTemplate = SLAB_TEMPLATES[gradingCompany] || SLAB_TEMPLATES.tag;

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      padding: 16,
      ...style,
    }}>
      {/* View Mode Toggle */}
      <div style={{
        display: 'flex',
        gap: 8,
        marginBottom: 16,
      }}>
        <button
          onClick={() => setViewMode('card')}
          style={{
            padding: '8px 16px',
            borderRadius: 8,
            border: 'none',
            background: viewMode === 'card' ? '#6366f1' : '#1a1c22',
            color: viewMode === 'card' ? '#fff' : '#666',
            fontFamily: mono,
            fontSize: 11,
            cursor: 'pointer',
            transition: 'all .2s',
          }}
        >
          Card View
        </button>
        <button
          onClick={() => setViewMode('slab')}
          style={{
            padding: '8px 16px',
            borderRadius: 8,
            border: 'none',
            background: viewMode === 'slab' ? '#6366f1' : '#1a1c22',
            color: viewMode === 'slab' ? '#fff' : '#666',
            fontFamily: mono,
            fontSize: 11,
            cursor: 'pointer',
            transition: 'all .2s',
          }}
        >
          Slab Preview
        </button>
      </div>

      {/* 3D Card Container */}
      <div
        ref={containerRef}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseLeave}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onClick={handleTap}
        style={{
          perspective: '1000px',
          cursor: isDragging ? 'grabbing' : 'grab',
          userSelect: 'none',
        }}
      >
        <div style={{
          position: 'relative',
          width: viewMode === 'slab' ? 280 : 250,
          height: viewMode === 'slab' ? 420 : 350,
          transformStyle: 'preserve-3d',
          transform: `rotateY(${rotateY}deg)`,
          transition: isDragging ? 'none' : 'transform 0.6s ease-out',
        }}>
          {/* Front Face */}
          <div style={{
            position: 'absolute',
            width: '100%',
            height: '100%',
            backfaceVisibility: 'hidden',
            borderRadius: viewMode === 'slab' ? 12 : 8,
            overflow: 'hidden',
            boxShadow: '0 10px 40px rgba(0,0,0,0.5)',
          }}>
            {viewMode === 'slab' ? (
              <SlabView
                cardImage={frontImage}
                template={slabTemplate}
                grade={grade}
                gradeLabel={gradeLabel}
                side="front"
              />
            ) : (
              <img
                src={frontImage}
                alt="Card front"
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                }}
                draggable={false}
              />
            )}
          </div>

          {/* Back Face */}
          <div style={{
            position: 'absolute',
            width: '100%',
            height: '100%',
            backfaceVisibility: 'hidden',
            transform: 'rotateY(180deg)',
            borderRadius: viewMode === 'slab' ? 12 : 8,
            overflow: 'hidden',
            boxShadow: '0 10px 40px rgba(0,0,0,0.5)',
          }}>
            {viewMode === 'slab' ? (
              <SlabView
                cardImage={backImage}
                template={slabTemplate}
                grade={grade}
                gradeLabel={gradeLabel}
                side="back"
              />
            ) : (
              <img
                src={backImage}
                alt="Card back"
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                }}
                draggable={false}
              />
            )}
          </div>
        </div>
      </div>

      {/* Instructions */}
      <div style={{
        marginTop: 16,
        fontFamily: mono,
        fontSize: 10,
        color: '#555',
        textAlign: 'center',
      }}>
        {isShowingBack ? 'BACK' : 'FRONT'} • Tap to flip • Drag to rotate
      </div>

      {/* Quick Rotation Buttons */}
      <div style={{
        display: 'flex',
        gap: 8,
        marginTop: 12,
      }}>
        <button
          onClick={() => setRotateY(0)}
          style={{
            padding: '6px 12px',
            borderRadius: 6,
            border: '1px solid #2a2d35',
            background: 'transparent',
            color: '#888',
            fontFamily: mono,
            fontSize: 10,
            cursor: 'pointer',
          }}
        >
          Front
        </button>
        <button
          onClick={() => setRotateY(180)}
          style={{
            padding: '6px 12px',
            borderRadius: 6,
            border: '1px solid #2a2d35',
            background: 'transparent',
            color: '#888',
            fontFamily: mono,
            fontSize: 10,
            cursor: 'pointer',
          }}
        >
          Back
        </button>
        <button
          onClick={() => {
            // Spin animation
            let angle = rotateY;
            const spin = setInterval(() => {
              angle += 10;
              setRotateY(angle);
              if (angle >= rotateY + 360) {
                clearInterval(spin);
                setRotateY(rotateY + 360);
              }
            }, 20);
          }}
          style={{
            padding: '6px 12px',
            borderRadius: 6,
            border: '1px solid #2a2d35',
            background: 'transparent',
            color: '#888',
            fontFamily: mono,
            fontSize: 10,
            cursor: 'pointer',
          }}
        >
          Spin 360°
        </button>
      </div>
    </div>
  );
}

/**
 * Slab View - Shows card inside a graded slab mockup
 */
function SlabView({ cardImage, template, grade, gradeLabel, side }) {
  return (
    <div style={{
      width: '100%',
      height: '100%',
      background: template.bgColor,
      display: 'flex',
      flexDirection: 'column',
      padding: 8,
      boxSizing: 'border-box',
    }}>
      {/* Slab Label */}
      <div style={{
        background: template.labelBg,
        borderRadius: '8px 8px 0 0',
        padding: '8px 12px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <span style={{
          fontFamily: sans,
          fontSize: 12,
          fontWeight: 700,
          color: template.labelColor,
        }}>
          {template.name}
        </span>
        {grade && (
          <span style={{
            fontFamily: mono,
            fontSize: 16,
            fontWeight: 800,
            color: template.labelColor,
          }}>
            {grade}
          </span>
        )}
      </div>

      {/* Card Window */}
      <div style={{
        flex: 1,
        background: '#000',
        borderLeft: `3px solid ${template.borderColor}`,
        borderRight: `3px solid ${template.borderColor}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 8,
      }}>
        <img
          src={cardImage}
          alt={`Card ${side}`}
          style={{
            maxWidth: '100%',
            maxHeight: '100%',
            objectFit: 'contain',
            borderRadius: 4,
          }}
          draggable={false}
        />
      </div>

      {/* Bottom Label */}
      <div style={{
        background: template.labelBg,
        borderRadius: '0 0 8px 8px',
        padding: '6px 12px',
        textAlign: 'center',
      }}>
        <span style={{
          fontFamily: mono,
          fontSize: 9,
          color: template.labelColor,
          opacity: 0.8,
        }}>
          {gradeLabel || 'GRADE PREVIEW'}
        </span>
      </div>
    </div>
  );
}

export default CardViewer3D;
