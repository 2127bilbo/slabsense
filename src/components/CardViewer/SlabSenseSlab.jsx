/**
 * SlabSenseSlab - Custom SlabSense branded slab renderer
 *
 * Uses actual slab template images with dynamic card and text overlay
 */

import { useState, useEffect } from 'react';

const mono = "'JetBrains Mono','SF Mono','Consolas',monospace";

// Template image paths
const FRONT_TEMPLATE = '/slabs/slabsense-front.png';
const BACK_TEMPLATE = '/slabs/slabsense-back.png';

// Layout coordinates (percentages for responsive scaling)
// These define where elements are positioned on the slab template
const LAYOUT = {
  // Card window position (where the card image goes)
  card: {
    top: '22%',
    left: '12%',
    width: '76%',
    height: '68%',
  },
  // Label text positions
  label: {
    // Card name line
    name: { top: '4.5%', left: '8%', fontSize: '3.2%' },
    // Set/year line
    set: { top: '8%', left: '8%', fontSize: '2.2%' },
    // Card number line
    number: { top: '10.5%', left: '8%', fontSize: '2%' },
    // Rarity line
    rarity: { top: '13%', left: '8%', fontSize: '1.8%' },
    // Grade number
    grade: { top: '4%', right: '6%', fontSize: '8%' },
    // Grade label (GEM MINT)
    gradeLabel: { top: '13%', right: '6%', fontSize: '1.8%' },
  },
};

export function SlabSenseSlab({
  cardImage,
  side = 'front', // 'front' | 'back'
  grade = '10',
  gradeLabel = 'GEM MINT',
  cardInfo = {},
  width = 280,
  height = 420,
}) {
  const [imgLoaded, setImgLoaded] = useState(false);
  const template = side === 'front' ? FRONT_TEMPLATE : BACK_TEMPLATE;

  // Card info with defaults
  const name = cardInfo?.name || 'POKEMON CARD';
  const setName = cardInfo?.setName || 'POKEMON';
  const cardNumber = cardInfo?.cardNumber || '';
  const year = cardInfo?.year || '2025';
  const rarity = cardInfo?.rarity || '';

  // For back side, we mirror the text
  const isMirrored = side === 'back';

  return (
    <div style={{
      position: 'relative',
      width,
      height,
      overflow: 'hidden',
      borderRadius: 8,
    }}>
      {/* Slab template image */}
      <img
        src={template}
        alt={`SlabSense ${side}`}
        onLoad={() => setImgLoaded(true)}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          display: 'block',
        }}
        draggable={false}
      />

      {/* Card image overlay */}
      {cardImage && imgLoaded && (
        <div style={{
          position: 'absolute',
          top: LAYOUT.card.top,
          left: LAYOUT.card.left,
          width: LAYOUT.card.width,
          height: LAYOUT.card.height,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
        }}>
          <img
            src={cardImage}
            alt="Card"
            style={{
              maxWidth: '100%',
              maxHeight: '100%',
              objectFit: 'contain',
              borderRadius: 4,
            }}
            draggable={false}
          />
        </div>
      )}

      {/* Dynamic text overlay - only on front, back uses mirrored template */}
      {imgLoaded && side === 'front' && (
        <>
          {/* Card Name */}
          <div style={{
            position: 'absolute',
            top: LAYOUT.label.name.top,
            left: LAYOUT.label.name.left,
            fontSize: `calc(${width}px * ${parseFloat(LAYOUT.label.name.fontSize) / 100})`,
            fontFamily: mono,
            fontWeight: 700,
            color: '#d4af37',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            textShadow: '0 1px 2px rgba(0,0,0,0.8)',
            whiteSpace: 'nowrap',
          }}>
            {name.substring(0, 20)}
          </div>

          {/* Year + Set */}
          <div style={{
            position: 'absolute',
            top: LAYOUT.label.set.top,
            left: LAYOUT.label.set.left,
            fontSize: `calc(${width}px * ${parseFloat(LAYOUT.label.set.fontSize) / 100})`,
            fontFamily: mono,
            fontWeight: 500,
            color: '#d4af37',
            letterSpacing: '0.03em',
            textShadow: '0 1px 2px rgba(0,0,0,0.8)',
          }}>
            {year} POKÉMON {setName.toUpperCase()}
          </div>

          {/* Card Number */}
          {cardNumber && (
            <div style={{
              position: 'absolute',
              top: LAYOUT.label.number.top,
              left: LAYOUT.label.number.left,
              fontSize: `calc(${width}px * ${parseFloat(LAYOUT.label.number.fontSize) / 100})`,
              fontFamily: mono,
              fontWeight: 500,
              color: '#d4af37',
              letterSpacing: '0.03em',
              textShadow: '0 1px 2px rgba(0,0,0,0.8)',
            }}>
              #{cardNumber}
            </div>
          )}

          {/* Rarity */}
          {rarity && (
            <div style={{
              position: 'absolute',
              top: LAYOUT.label.rarity.top,
              left: LAYOUT.label.rarity.left,
              fontSize: `calc(${width}px * ${parseFloat(LAYOUT.label.rarity.fontSize) / 100})`,
              fontFamily: mono,
              fontWeight: 500,
              color: '#d4af37',
              letterSpacing: '0.03em',
              textShadow: '0 1px 2px rgba(0,0,0,0.8)',
            }}>
              {rarity.toUpperCase()}
          </div>
          )}

          {/* Grade Number */}
          <div style={{
            position: 'absolute',
            top: LAYOUT.label.grade.top,
            right: LAYOUT.label.grade.right,
            fontSize: `calc(${width}px * ${parseFloat(LAYOUT.label.grade.fontSize) / 100})`,
            fontFamily: mono,
            fontWeight: 900,
            color: '#d4af37',
            textShadow: '0 2px 4px rgba(0,0,0,0.8)',
          }}>
            {grade}
          </div>

          {/* Grade Label */}
          <div style={{
            position: 'absolute',
            top: LAYOUT.label.gradeLabel.top,
            right: LAYOUT.label.gradeLabel.right,
            fontSize: `calc(${width}px * ${parseFloat(LAYOUT.label.gradeLabel.fontSize) / 100})`,
            fontFamily: mono,
            fontWeight: 600,
            color: '#d4af37',
            letterSpacing: '0.05em',
            textShadow: '0 1px 2px rgba(0,0,0,0.8)',
          }}>
            {gradeLabel}
          </div>
        </>
      )}

      {/* Gloss/reflection overlay */}
      <div style={{
        position: 'absolute',
        inset: 0,
        background: 'linear-gradient(135deg, rgba(255,255,255,0.08) 0%, transparent 30%, transparent 70%, rgba(255,255,255,0.05) 100%)',
        pointerEvents: 'none',
        borderRadius: 8,
      }} />
    </div>
  );
}

export default SlabSenseSlab;
