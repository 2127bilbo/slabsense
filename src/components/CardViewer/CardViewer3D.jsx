/**
 * CardViewer3D - Interactive 3D card viewer with photorealistic slab preview
 *
 * Features:
 * - Tap to flip between front/back
 * - Drag to rotate 360 with realistic thickness
 * - Canvas-rendered photorealistic slabs for PSA, BGS, CGC, SGC, TAG
 * - Uses our card info and grade on authentic-looking labels
 */

import { useState, useRef } from 'react';
import { RealisticSlab } from './RealisticSlab.jsx';

const mono = "'JetBrains Mono','SF Mono','Consolas',monospace";
const sans = "'Inter','Helvetica Neue',Arial,sans-serif";

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
  cardInfo = null, // { name, cardNumber, setName, year, rarity, hp }
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

  // Company display names
  const companyNames = {
    psa: 'PSA',
    bgs: 'BGS',
    cgc: 'CGC',
    sgc: 'SGC',
    tag: 'TAG',
  };

  // Generate cert number if not provided
  const displayCert = certNumber || Math.floor(Math.random() * 90000000 + 10000000).toString();

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
            background: viewMode === 'slab' ? '#6366f1' : '#1a1c22',
            color: viewMode === 'slab' ? '#fff' : '#666',
            fontFamily: mono,
            fontSize: 11,
            cursor: 'pointer',
            transition: 'all .2s',
          }}
        >
          {companyNames[gradingCompany] || 'TAG'} Slab
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
          width: viewMode === 'slab' ? 220 : 250,
          height: viewMode === 'slab' ? 340 : 350,
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
            borderRadius: viewMode === 'slab' ? 6 : 8,
            overflow: 'hidden',
            boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
          }}>
            {viewMode === 'slab' ? (
              <RealisticSlab
                cardImage={frontImage}
                company={gradingCompany}
                grade={grade}
                gradeLabel={gradeLabel}
                cardInfo={cardInfo}
                certNumber={displayCert}
                subgrades={subgrades}
                width={220}
                height={340}
              />
            ) : (
              <Card3D image={frontImage} side="front" />
            )}
          </div>

          {/* Edge (visible during rotation) */}
          <div style={{
            position: 'absolute',
            width: viewMode === 'slab' ? 10 : 4,
            height: '100%',
            left: '100%',
            transformOrigin: 'left center',
            transform: 'rotateY(90deg)',
            background: viewMode === 'slab'
              ? 'linear-gradient(180deg, #e8e8e8 0%, #ccc 20%, #ddd 50%, #ccc 80%, #e8e8e8 100%)'
              : `linear-gradient(180deg, ${CARD_EDGE_COLOR} 0%, #ddd 50%, ${CARD_EDGE_COLOR} 100%)`,
            borderRadius: '0 2px 2px 0',
          }} />

          {/* Back Face */}
          <div style={{
            position: 'absolute',
            width: '100%',
            height: '100%',
            backfaceVisibility: 'hidden',
            transform: 'rotateY(180deg)',
            borderRadius: viewMode === 'slab' ? 6 : 8,
            overflow: 'hidden',
            boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
          }}>
            {viewMode === 'slab' ? (
              <RealisticSlab
                cardImage={backImage}
                company={gradingCompany}
                grade={grade}
                gradeLabel={gradeLabel}
                cardInfo={cardInfo}
                certNumber={displayCert}
                subgrades={subgrades}
                width={220}
                height={340}
              />
            ) : (
              <Card3D image={backImage} side="back" />
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
        {['Front', 'Back', 'Spin 360°'].map((label, i) => (
          <button
            key={label}
            onClick={() => {
              if (i === 0) setRotateY(0);
              else if (i === 1) setRotateY(180);
              else {
                let angle = rotateY;
                const spin = setInterval(() => {
                  angle += 12;
                  setRotateY(angle);
                  if (angle >= rotateY + 360) {
                    clearInterval(spin);
                    setRotateY(rotateY + 360);
                  }
                }, 20);
              }
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
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Raw card with gloss effect
 */
function Card3D({ image, side }) {
  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', background: '#111' }}>
      <img
        src={image}
        alt={`Card ${side}`}
        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        draggable={false}
      />
      {/* Gloss overlay */}
      <div style={{
        position: 'absolute',
        inset: 0,
        background: 'linear-gradient(135deg, rgba(255,255,255,0.15) 0%, transparent 40%, transparent 60%, rgba(0,0,0,0.1) 100%)',
        pointerEvents: 'none',
      }} />
    </div>
  );
}

export default CardViewer3D;
