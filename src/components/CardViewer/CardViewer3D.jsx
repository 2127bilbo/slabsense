/**
 * CardViewer3D - Interactive 3D card viewer with flip, spin, and realistic slab preview
 *
 * Features:
 * - Tap to flip between front/back
 * - Drag to rotate 360
 * - Realistic slab preview with authentic styling per company
 * - Card thickness simulation for real 3D appearance
 */

import { useState, useRef } from 'react';

const mono = "'JetBrains Mono','SF Mono',monospace";
const sans = "'Inter',-apple-system,sans-serif";

// Realistic slab templates based on actual grading company cases
const SLAB_TEMPLATES = {
  psa: {
    name: 'PSA',
    fullName: 'Professional Sports Authenticator',
    // PSA: Red label on clear case, red accent line
    labelBg: 'linear-gradient(180deg, #b91c1c 0%, #991b1b 100%)',
    labelColor: '#fff',
    labelBorder: '#7f1d1d',
    caseBg: 'linear-gradient(135deg, rgba(255,255,255,0.15) 0%, rgba(255,255,255,0.05) 50%, rgba(0,0,0,0.1) 100%)',
    caseEdge: '#d1d5db',
    accentColor: '#dc2626',
    gradeStyle: { fontSize: 22, fontWeight: 900 },
    certPrefix: 'Cert #',
  },
  bgs: {
    name: 'BGS',
    fullName: 'Beckett Grading Services',
    // BGS: Black label with gold accents (for high grades), or silver
    labelBg: 'linear-gradient(180deg, #1a1a1a 0%, #0a0a0a 100%)',
    labelColor: '#fbbf24',
    labelBorder: '#374151',
    caseBg: 'linear-gradient(135deg, rgba(255,255,255,0.12) 0%, rgba(255,255,255,0.03) 50%, rgba(0,0,0,0.15) 100%)',
    caseEdge: '#9ca3af',
    accentColor: '#fbbf24',
    gradeStyle: { fontSize: 20, fontWeight: 800 },
    hasSubgrades: true,
    certPrefix: '',
  },
  cgc: {
    name: 'CGC',
    fullName: 'Certified Guaranty Company',
    // CGC: Blue label, clean modern look
    labelBg: 'linear-gradient(180deg, #1d4ed8 0%, #1e40af 100%)',
    labelColor: '#fff',
    labelBorder: '#1e3a8a',
    caseBg: 'linear-gradient(135deg, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0.05) 50%, rgba(0,0,0,0.08) 100%)',
    caseEdge: '#e5e7eb',
    accentColor: '#3b82f6',
    gradeStyle: { fontSize: 24, fontWeight: 900 },
    certPrefix: 'CGC #',
  },
  sgc: {
    name: 'SGC',
    fullName: 'Sportscard Guaranty',
    // SGC: Green/teal label with tuxedo case design
    labelBg: 'linear-gradient(180deg, #047857 0%, #065f46 100%)',
    labelColor: '#fff',
    labelBorder: '#064e3b',
    caseBg: 'linear-gradient(135deg, rgba(255,255,255,0.1) 0%, rgba(0,0,0,0.05) 50%, rgba(0,0,0,0.2) 100%)',
    caseEdge: '#1f2937',
    accentColor: '#10b981',
    gradeStyle: { fontSize: 22, fontWeight: 800 },
    certPrefix: 'SGC ',
  },
  tag: {
    name: 'TAG',
    fullName: 'The Authentication Group',
    // TAG: Purple/indigo modern design
    labelBg: 'linear-gradient(180deg, #6366f1 0%, #4f46e5 100%)',
    labelColor: '#fff',
    labelBorder: '#4338ca',
    caseBg: 'linear-gradient(135deg, rgba(255,255,255,0.2) 0%, rgba(99,102,241,0.05) 50%, rgba(0,0,0,0.1) 100%)',
    caseEdge: '#c7d2fe',
    accentColor: '#818cf8',
    gradeStyle: { fontSize: 24, fontWeight: 900, letterSpacing: '0.05em' },
    certPrefix: 'TAG-',
  },
};

// Card edge color (white cardstock)
const CARD_EDGE_COLOR = '#f5f5f0';

export function CardViewer3D({
  frontImage,
  backImage,
  grade = null,
  gradeLabel = null,
  gradingCompany = 'tag',
  subgrades = null,
  certNumber = null,
  cardName = null,
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

  // Card dimensions
  const cardWidth = viewMode === 'slab' ? 200 : 250;
  const cardHeight = viewMode === 'slab' ? 280 : 350;
  const cardThickness = 3; // Thickness in pixels for 3D edge effect
  const slabThickness = viewMode === 'slab' ? 8 : 0;

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
          Raw Card
        </button>
        <button
          onClick={() => setViewMode('slab')}
          style={{
            padding: '8px 16px',
            borderRadius: 8,
            border: 'none',
            background: viewMode === 'slab' ? slabTemplate.accentColor : '#1a1c22',
            color: viewMode === 'slab' ? '#fff' : '#666',
            fontFamily: mono,
            fontSize: 11,
            cursor: 'pointer',
            transition: 'all .2s',
          }}
        >
          {slabTemplate.name} Slab
        </button>
      </div>

      {/* 3D Card/Slab Container */}
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
          perspective: '1200px',
          cursor: isDragging ? 'grabbing' : 'grab',
          userSelect: 'none',
        }}
      >
        <div style={{
          position: 'relative',
          width: viewMode === 'slab' ? 240 : cardWidth,
          height: viewMode === 'slab' ? 380 : cardHeight,
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
            boxShadow: '0 15px 50px rgba(0,0,0,0.5)',
          }}>
            {viewMode === 'slab' ? (
              <RealisticSlabView
                cardImage={frontImage}
                template={slabTemplate}
                grade={grade}
                gradeLabel={gradeLabel}
                subgrades={subgrades}
                certNumber={certNumber}
                cardName={cardName}
                side="front"
              />
            ) : (
              <Card3D image={frontImage} thickness={cardThickness} side="front" />
            )}
          </div>

          {/* Card/Slab Edge (visible during rotation) */}
          {cardThickness > 0 && (
            <div style={{
              position: 'absolute',
              width: cardThickness + slabThickness,
              height: '100%',
              left: '100%',
              transformOrigin: 'left center',
              transform: 'rotateY(90deg)',
              background: viewMode === 'slab'
                ? `linear-gradient(180deg, ${slabTemplate.caseEdge} 0%, #999 50%, ${slabTemplate.caseEdge} 100%)`
                : `linear-gradient(180deg, ${CARD_EDGE_COLOR} 0%, #ddd 50%, ${CARD_EDGE_COLOR} 100%)`,
              borderRadius: '0 2px 2px 0',
            }} />
          )}

          {/* Back Face */}
          <div style={{
            position: 'absolute',
            width: '100%',
            height: '100%',
            backfaceVisibility: 'hidden',
            transform: 'rotateY(180deg)',
            borderRadius: viewMode === 'slab' ? 12 : 8,
            overflow: 'hidden',
            boxShadow: '0 15px 50px rgba(0,0,0,0.5)',
          }}>
            {viewMode === 'slab' ? (
              <RealisticSlabView
                cardImage={backImage}
                template={slabTemplate}
                grade={grade}
                gradeLabel={gradeLabel}
                subgrades={subgrades}
                certNumber={certNumber}
                cardName={cardName}
                side="back"
              />
            ) : (
              <Card3D image={backImage} thickness={cardThickness} side="back" />
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
 * Card3D - Raw card with thickness effect
 */
function Card3D({ image, thickness, side }) {
  return (
    <div style={{
      width: '100%',
      height: '100%',
      position: 'relative',
      background: CARD_EDGE_COLOR,
    }}>
      {/* Card image */}
      <img
        src={image}
        alt={`Card ${side}`}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          display: 'block',
        }}
        draggable={false}
      />
      {/* Subtle gloss overlay */}
      <div style={{
        position: 'absolute',
        inset: 0,
        background: 'linear-gradient(135deg, rgba(255,255,255,0.1) 0%, transparent 50%, rgba(0,0,0,0.05) 100%)',
        pointerEvents: 'none',
      }} />
    </div>
  );
}

/**
 * RealisticSlabView - Authentic grading slab mockup
 */
function RealisticSlabView({ cardImage, template, grade, gradeLabel, subgrades, certNumber, cardName, side }) {
  return (
    <div style={{
      width: '100%',
      height: '100%',
      background: template.caseBg,
      display: 'flex',
      flexDirection: 'column',
      position: 'relative',
      border: `2px solid ${template.caseEdge}`,
      borderRadius: 10,
      overflow: 'hidden',
    }}>
      {/* Clear plastic case effect */}
      <div style={{
        position: 'absolute',
        inset: 0,
        background: 'linear-gradient(135deg, rgba(255,255,255,0.3) 0%, transparent 30%, transparent 70%, rgba(255,255,255,0.1) 100%)',
        pointerEvents: 'none',
        zIndex: 10,
      }} />

      {/* Top Label */}
      <div style={{
        background: template.labelBg,
        padding: '10px 12px 8px',
        borderBottom: `2px solid ${template.labelBorder}`,
        position: 'relative',
      }}>
        {/* Company Name */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          marginBottom: 4,
        }}>
          <div>
            <div style={{
              fontFamily: sans,
              fontSize: 14,
              fontWeight: 800,
              color: template.labelColor,
              letterSpacing: '0.05em',
            }}>
              {template.name}
            </div>
            {cardName && (
              <div style={{
                fontFamily: sans,
                fontSize: 8,
                color: template.labelColor,
                opacity: 0.8,
                marginTop: 2,
                maxWidth: 120,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>
                {cardName}
              </div>
            )}
          </div>
          {/* Grade Display */}
          {grade && (
            <div style={{
              background: 'rgba(255,255,255,0.15)',
              borderRadius: 6,
              padding: '4px 10px',
              textAlign: 'center',
            }}>
              <div style={{
                fontFamily: mono,
                color: template.labelColor,
                ...template.gradeStyle,
              }}>
                {grade}
              </div>
              {gradeLabel && (
                <div style={{
                  fontFamily: mono,
                  fontSize: 7,
                  color: template.labelColor,
                  opacity: 0.9,
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                }}>
                  {gradeLabel}
                </div>
              )}
            </div>
          )}
        </div>

        {/* BGS Subgrades (if applicable) */}
        {template.hasSubgrades && subgrades && (
          <div style={{
            display: 'flex',
            gap: 8,
            marginTop: 6,
            justifyContent: 'center',
          }}>
            {[
              { key: 'centering', label: 'CEN' },
              { key: 'corners', label: 'COR' },
              { key: 'edges', label: 'EDG' },
              { key: 'surface', label: 'SUR' },
            ].map(({ key, label }) => (
              <div key={key} style={{
                background: 'rgba(0,0,0,0.3)',
                borderRadius: 3,
                padding: '2px 6px',
                textAlign: 'center',
              }}>
                <div style={{ fontFamily: mono, fontSize: 7, color: '#888' }}>{label}</div>
                <div style={{ fontFamily: mono, fontSize: 10, color: template.labelColor, fontWeight: 700 }}>
                  {subgrades[key] ? (subgrades[key] / 100).toFixed(1) : '-'}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Card Window (clear plastic area) */}
      <div style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 12,
        background: 'rgba(0,0,0,0.02)',
        position: 'relative',
      }}>
        {/* Inner holder */}
        <div style={{
          width: '90%',
          height: '92%',
          background: '#000',
          borderRadius: 4,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 4,
          boxShadow: 'inset 0 2px 8px rgba(0,0,0,0.3)',
        }}>
          <img
            src={cardImage}
            alt={`Card ${side}`}
            style={{
              maxWidth: '100%',
              maxHeight: '100%',
              objectFit: 'contain',
              borderRadius: 3,
            }}
            draggable={false}
          />
        </div>
      </div>

      {/* Bottom Label */}
      <div style={{
        background: template.labelBg,
        padding: '6px 12px',
        borderTop: `2px solid ${template.labelBorder}`,
        textAlign: 'center',
      }}>
        <div style={{
          fontFamily: mono,
          fontSize: 8,
          color: template.labelColor,
          opacity: 0.9,
          letterSpacing: '0.1em',
        }}>
          {certNumber ? `${template.certPrefix}${certNumber}` : template.fullName}
        </div>
      </div>
    </div>
  );
}

export default CardViewer3D;
