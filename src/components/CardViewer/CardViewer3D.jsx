/**
 * CardViewer3D - Interactive 3D card viewer with photorealistic slab preview
 *
 * Features:
 * - Tap to flip between front/back
 * - Drag to rotate 360 with realistic thickness
 * - Authentic slab designs for PSA, BGS, CGC, SGC, TAG
 * - Uses our card info and grade on authentic-looking labels
 */

import { useState, useRef } from 'react';

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
              <SlabView
                cardImage={frontImage}
                company={gradingCompany}
                grade={grade}
                gradeLabel={gradeLabel}
                cardInfo={cardInfo}
                certNumber={displayCert}
                subgrades={subgrades}
                side="front"
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
              <SlabView
                cardImage={backImage}
                company={gradingCompany}
                grade={grade}
                gradeLabel={gradeLabel}
                cardInfo={cardInfo}
                certNumber={displayCert}
                subgrades={subgrades}
                side="back"
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

/**
 * Photorealistic slab view - matches authentic company designs
 */
function SlabView({ cardImage, company, grade, gradeLabel, cardInfo, certNumber, subgrades, side }) {
  // Route to company-specific slab
  switch (company) {
    case 'psa':
      return <PSASlab cardImage={cardImage} grade={grade} gradeLabel={gradeLabel} cardInfo={cardInfo} certNumber={certNumber} side={side} />;
    case 'bgs':
      return <BGSSlab cardImage={cardImage} grade={grade} gradeLabel={gradeLabel} cardInfo={cardInfo} certNumber={certNumber} subgrades={subgrades} side={side} />;
    case 'cgc':
      return <CGCSlab cardImage={cardImage} grade={grade} gradeLabel={gradeLabel} cardInfo={cardInfo} certNumber={certNumber} side={side} />;
    case 'sgc':
      return <SGCSlab cardImage={cardImage} grade={grade} gradeLabel={gradeLabel} cardInfo={cardInfo} certNumber={certNumber} side={side} />;
    case 'tag':
    default:
      return <TAGSlab cardImage={cardImage} grade={grade} gradeLabel={gradeLabel} cardInfo={cardInfo} certNumber={certNumber} side={side} />;
  }
}

/**
 * PSA Slab - Red label, classic design
 */
function PSASlab({ cardImage, grade, gradeLabel, cardInfo, certNumber, side }) {
  const cardName = cardInfo?.name || 'POKEMON CARD';
  const setInfo = cardInfo?.setName || 'POKEMON';
  const cardNum = cardInfo?.cardNumber || '';
  const year = cardInfo?.year || '2024';

  return (
    <div style={{
      width: '100%',
      height: '100%',
      background: 'linear-gradient(180deg, #f0f0f0 0%, #e0e0e0 100%)',
      display: 'flex',
      flexDirection: 'column',
      position: 'relative',
      borderRadius: 6,
      overflow: 'hidden',
    }}>
      {/* PSA Red Label */}
      <div style={{
        background: 'linear-gradient(180deg, #c41e3a 0%, #a01830 100%)',
        padding: '8px 10px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        minHeight: 52,
      }}>
        {/* Left side - Card info */}
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: sans, fontSize: 8, color: '#fff', fontWeight: 700, letterSpacing: '0.02em' }}>
            {year} {setInfo.toUpperCase()}
          </div>
          <div style={{ fontFamily: sans, fontSize: 9, color: '#fff', fontWeight: 800, marginTop: 2 }}>
            {cardName.toUpperCase()}
          </div>
          {cardNum && (
            <div style={{ fontFamily: mono, fontSize: 7, color: 'rgba(255,255,255,0.8)', marginTop: 2 }}>
              #{cardNum}
            </div>
          )}
        </div>
        {/* Right side - Grade */}
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontFamily: sans, fontSize: 8, color: '#fff', fontWeight: 600 }}>
            {gradeLabel || 'MINT'}
          </div>
          <div style={{ fontFamily: sans, fontSize: 22, color: '#fff', fontWeight: 900, lineHeight: 1 }}>
            {grade || '10'}
          </div>
        </div>
      </div>

      {/* PSA Logo Bar */}
      <div style={{
        background: '#c41e3a',
        padding: '3px 10px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        borderTop: '1px solid rgba(255,255,255,0.2)',
      }}>
        <div style={{ fontFamily: sans, fontSize: 10, color: '#fff', fontWeight: 900, letterSpacing: '0.1em' }}>
          PSA
        </div>
        <div style={{ fontFamily: mono, fontSize: 7, color: 'rgba(255,255,255,0.9)' }}>
          {certNumber}
        </div>
      </div>

      {/* Card Window */}
      <div style={{
        flex: 1,
        background: '#000',
        margin: 8,
        marginTop: 6,
        borderRadius: 4,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 6,
      }}>
        <img src={cardImage} alt={`Card ${side}`} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: 3 }} draggable={false} />
      </div>

      {/* Clear case overlay */}
      <div style={{
        position: 'absolute',
        inset: 0,
        background: 'linear-gradient(135deg, rgba(255,255,255,0.2) 0%, transparent 30%, transparent 70%, rgba(255,255,255,0.1) 100%)',
        pointerEvents: 'none',
        borderRadius: 6,
      }} />
    </div>
  );
}

/**
 * BGS Slab - White/silver label with subgrades
 */
function BGSSlab({ cardImage, grade, gradeLabel, cardInfo, certNumber, subgrades, side }) {
  const cardName = cardInfo?.name || 'POKEMON CARD';
  const setInfo = cardInfo?.setName || 'BASE SET';
  const cardNum = cardInfo?.cardNumber || '';
  const year = cardInfo?.year || '2024';

  return (
    <div style={{
      width: '100%',
      height: '100%',
      background: 'linear-gradient(180deg, #f5f5f5 0%, #e8e8e8 100%)',
      display: 'flex',
      flexDirection: 'column',
      position: 'relative',
      borderRadius: 6,
      overflow: 'hidden',
    }}>
      {/* BGS Silver/White Label */}
      <div style={{
        background: 'linear-gradient(180deg, #fff 0%, #f0f0f0 100%)',
        padding: '6px 10px',
        borderBottom: '2px solid #222',
      }}>
        {/* Top row - Set info */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          marginBottom: 4,
        }}>
          <div>
            <div style={{ fontFamily: sans, fontSize: 8, color: '#333', fontWeight: 600 }}>
              {year} {setInfo.toUpperCase()}
            </div>
            <div style={{ fontFamily: sans, fontSize: 9, color: '#000', fontWeight: 800 }}>
              {cardNum ? `#${cardNum} ` : ''}{cardName.toUpperCase()}
            </div>
          </div>
          {/* Grade box */}
          <div style={{
            background: '#000',
            borderRadius: 4,
            padding: '4px 8px',
            textAlign: 'center',
          }}>
            <div style={{ fontFamily: sans, fontSize: 18, color: '#ffd700', fontWeight: 900, lineHeight: 1 }}>
              {grade || '9.5'}
            </div>
            <div style={{ fontFamily: sans, fontSize: 6, color: '#ffd700', fontWeight: 600, letterSpacing: '0.05em' }}>
              {gradeLabel || 'GEM MINT'}
            </div>
          </div>
        </div>

        {/* Beckett logo and subgrades */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <div style={{ fontFamily: 'serif', fontSize: 12, fontWeight: 700, color: '#000', fontStyle: 'italic' }}>
            BECKETT
          </div>
          {/* Subgrades */}
          <div style={{ display: 'flex', gap: 6 }}>
            {[
              { label: 'CEN', value: subgrades?.centering },
              { label: 'COR', value: subgrades?.corners },
              { label: 'EDG', value: subgrades?.edges },
              { label: 'SUR', value: subgrades?.surface },
            ].map(({ label, value }) => (
              <div key={label} style={{ textAlign: 'center' }}>
                <div style={{ fontFamily: mono, fontSize: 6, color: '#666' }}>{label}</div>
                <div style={{ fontFamily: mono, fontSize: 8, color: '#000', fontWeight: 700 }}>
                  {value ? (value / 100).toFixed(1) : '9.5'}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Cert number */}
        <div style={{ fontFamily: mono, fontSize: 7, color: '#666', marginTop: 4, textAlign: 'right' }}>
          {certNumber}
        </div>
      </div>

      {/* Card Window */}
      <div style={{
        flex: 1,
        background: '#000',
        margin: 8,
        marginTop: 6,
        borderRadius: 4,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 6,
      }}>
        <img src={cardImage} alt={`Card ${side}`} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: 3 }} draggable={false} />
      </div>

      {/* Clear case overlay */}
      <div style={{
        position: 'absolute',
        inset: 0,
        background: 'linear-gradient(135deg, rgba(255,255,255,0.15) 0%, transparent 25%, transparent 75%, rgba(255,255,255,0.08) 100%)',
        pointerEvents: 'none',
        borderRadius: 6,
      }} />
    </div>
  );
}

/**
 * CGC Slab - Blue label, modern design
 */
function CGCSlab({ cardImage, grade, gradeLabel, cardInfo, certNumber, side }) {
  const cardName = cardInfo?.name || 'Pokemon Card';
  const setInfo = cardInfo?.setName || 'Pokemon Set';
  const cardNum = cardInfo?.cardNumber || '';
  const year = cardInfo?.year || '2024';

  return (
    <div style={{
      width: '100%',
      height: '100%',
      background: 'linear-gradient(180deg, #f8f8f8 0%, #e8e8e8 100%)',
      display: 'flex',
      flexDirection: 'column',
      position: 'relative',
      borderRadius: 6,
      overflow: 'hidden',
    }}>
      {/* CGC Blue Header */}
      <div style={{
        background: 'linear-gradient(180deg, #1e40af 0%, #1e3a8a 100%)',
        padding: '4px 10px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <div style={{ fontFamily: sans, fontSize: 11, color: '#fff', fontWeight: 800, letterSpacing: '0.05em' }}>
          CGC
        </div>
        <div style={{ fontFamily: sans, fontSize: 7, color: 'rgba(255,255,255,0.9)', letterSpacing: '0.02em' }}>
          CERTIFIED GUARANTY COMPANY
        </div>
      </div>

      {/* Card Info Section */}
      <div style={{
        background: '#fff',
        padding: '8px 10px',
        borderBottom: '1px solid #ddd',
      }}>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
        }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: sans, fontSize: 10, color: '#000', fontWeight: 700 }}>
              {cardName}
            </div>
            <div style={{ fontFamily: sans, fontSize: 8, color: '#666', marginTop: 2 }}>
              Pokémon ({year})
            </div>
            <div style={{ fontFamily: sans, fontSize: 8, color: '#666' }}>
              {setInfo} {cardNum ? `- ${cardNum}` : ''}
            </div>
          </div>
          {/* Grade */}
          <div style={{
            background: '#1e40af',
            borderRadius: 4,
            padding: '6px 10px',
            textAlign: 'center',
          }}>
            <div style={{ fontFamily: sans, fontSize: 7, color: '#fff', fontWeight: 600 }}>
              {gradeLabel || 'GEM MINT'}
            </div>
            <div style={{ fontFamily: sans, fontSize: 20, color: '#fff', fontWeight: 900, lineHeight: 1 }}>
              {grade || '10'}
            </div>
          </div>
        </div>
        <div style={{ fontFamily: mono, fontSize: 7, color: '#888', marginTop: 4 }}>
          {certNumber}
        </div>
      </div>

      {/* Card Window */}
      <div style={{
        flex: 1,
        background: '#1a1a1a',
        margin: 8,
        marginTop: 6,
        borderRadius: 4,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 6,
      }}>
        <img src={cardImage} alt={`Card ${side}`} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: 3 }} draggable={false} />
      </div>

      {/* Clear case overlay */}
      <div style={{
        position: 'absolute',
        inset: 0,
        background: 'linear-gradient(135deg, rgba(255,255,255,0.2) 0%, transparent 30%, transparent 70%, rgba(255,255,255,0.1) 100%)',
        pointerEvents: 'none',
        borderRadius: 6,
      }} />
    </div>
  );
}

/**
 * SGC Slab - Black tuxedo style with green accents
 */
function SGCSlab({ cardImage, grade, gradeLabel, cardInfo, certNumber, side }) {
  const cardName = cardInfo?.name || 'POKEMON CARD';
  const setInfo = cardInfo?.setName || 'POKEMON SET';
  const cardNum = cardInfo?.cardNumber || '';
  const year = cardInfo?.year || '2024';

  return (
    <div style={{
      width: '100%',
      height: '100%',
      background: '#1a1a1a',
      display: 'flex',
      flexDirection: 'column',
      position: 'relative',
      borderRadius: 6,
      overflow: 'hidden',
    }}>
      {/* SGC Label */}
      <div style={{
        background: 'linear-gradient(180deg, #047857 0%, #065f46 100%)',
        padding: '8px 10px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
      }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: sans, fontSize: 8, color: '#fff', fontWeight: 600 }}>
            {year} {setInfo.toUpperCase()}
          </div>
          <div style={{ fontFamily: sans, fontSize: 10, color: '#fff', fontWeight: 800, marginTop: 2 }}>
            {cardName.toUpperCase()}
          </div>
          {cardNum && (
            <div style={{ fontFamily: mono, fontSize: 7, color: 'rgba(255,255,255,0.8)', marginTop: 2 }}>
              #{cardNum}
            </div>
          )}
        </div>
        {/* Grade */}
        <div style={{
          background: 'rgba(0,0,0,0.3)',
          borderRadius: 4,
          padding: '4px 10px',
          textAlign: 'center',
        }}>
          <div style={{ fontFamily: sans, fontSize: 7, color: '#fff', fontWeight: 600 }}>
            {gradeLabel || 'GEM MINT'}
          </div>
          <div style={{ fontFamily: sans, fontSize: 20, color: '#fff', fontWeight: 900, lineHeight: 1 }}>
            {grade || '10'}
          </div>
        </div>
      </div>

      {/* SGC Logo Bar */}
      <div style={{
        background: '#065f46',
        padding: '3px 10px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        borderTop: '1px solid rgba(255,255,255,0.1)',
      }}>
        <div style={{ fontFamily: sans, fontSize: 11, color: '#fff', fontWeight: 900, letterSpacing: '0.15em' }}>
          SGC
        </div>
        <div style={{ fontFamily: mono, fontSize: 7, color: 'rgba(255,255,255,0.8)' }}>
          {certNumber}
        </div>
      </div>

      {/* Card Window */}
      <div style={{
        flex: 1,
        background: '#000',
        margin: 8,
        marginTop: 6,
        borderRadius: 4,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 6,
        border: '2px solid #333',
      }}>
        <img src={cardImage} alt={`Card ${side}`} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: 3 }} draggable={false} />
      </div>

      {/* Clear case overlay */}
      <div style={{
        position: 'absolute',
        inset: 0,
        background: 'linear-gradient(135deg, rgba(255,255,255,0.1) 0%, transparent 30%, transparent 70%, rgba(255,255,255,0.05) 100%)',
        pointerEvents: 'none',
        borderRadius: 6,
      }} />
    </div>
  );
}

/**
 * TAG Slab - Black with red logo, modern design
 */
function TAGSlab({ cardImage, grade, gradeLabel, cardInfo, certNumber, side }) {
  const cardName = cardInfo?.name || 'POKEMON CARD';
  const setInfo = cardInfo?.setName || 'POKEMON SET';
  const cardNum = cardInfo?.cardNumber || '';
  const year = cardInfo?.year || '2024';
  const rarity = cardInfo?.rarity || '';

  return (
    <div style={{
      width: '100%',
      height: '100%',
      background: '#0a0a0a',
      display: 'flex',
      flexDirection: 'column',
      position: 'relative',
      borderRadius: 6,
      overflow: 'hidden',
    }}>
      {/* TAG Label */}
      <div style={{
        background: 'linear-gradient(180deg, #1a1a1a 0%, #0d0d0d 100%)',
        padding: '8px 10px',
        borderBottom: '2px solid #dc2626',
      }}>
        {/* Top row with logo and grade */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          marginBottom: 6,
        }}>
          {/* TAG Logo */}
          <div style={{
            background: '#dc2626',
            borderRadius: 3,
            padding: '2px 8px',
          }}>
            <span style={{ fontFamily: sans, fontSize: 12, color: '#fff', fontWeight: 900, letterSpacing: '0.1em' }}>
              TAG
            </span>
          </div>
          {/* Grade */}
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontFamily: sans, fontSize: 22, color: '#fff', fontWeight: 900, lineHeight: 1 }}>
              {grade || '10'}
            </div>
            <div style={{ fontFamily: sans, fontSize: 7, color: '#dc2626', fontWeight: 700, letterSpacing: '0.05em' }}>
              {gradeLabel || 'GEM MINT'}
            </div>
          </div>
        </div>

        {/* Card Info */}
        <div style={{ marginBottom: 4 }}>
          <div style={{ fontFamily: sans, fontSize: 10, color: '#fff', fontWeight: 700 }}>
            {cardName.toUpperCase()}
          </div>
          <div style={{ fontFamily: sans, fontSize: 8, color: '#888', marginTop: 2 }}>
            {year} POKÉMON
          </div>
          <div style={{ fontFamily: sans, fontSize: 8, color: '#888' }}>
            {setInfo.toUpperCase()} {cardNum ? `#${cardNum}` : ''}
          </div>
          {rarity && (
            <div style={{ fontFamily: sans, fontSize: 7, color: '#dc2626', marginTop: 2, fontWeight: 600 }}>
              {rarity.toUpperCase()}
            </div>
          )}
        </div>

        {/* Cert number */}
        <div style={{ fontFamily: mono, fontSize: 7, color: '#555' }}>
          {certNumber}
        </div>
      </div>

      {/* Card Window */}
      <div style={{
        flex: 1,
        background: '#000',
        margin: 8,
        marginTop: 6,
        borderRadius: 4,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 6,
      }}>
        <img src={cardImage} alt={`Card ${side}`} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: 3 }} draggable={false} />
      </div>

      {/* Bottom TAG branding */}
      <div style={{
        background: '#0d0d0d',
        padding: '4px 10px',
        textAlign: 'center',
        borderTop: '1px solid #222',
      }}>
        <span style={{ fontFamily: sans, fontSize: 8, color: '#444', letterSpacing: '0.1em' }}>
          TAG GRADING
        </span>
      </div>

      {/* Clear case overlay */}
      <div style={{
        position: 'absolute',
        inset: 0,
        background: 'linear-gradient(135deg, rgba(255,255,255,0.08) 0%, transparent 25%, transparent 75%, rgba(255,255,255,0.04) 100%)',
        pointerEvents: 'none',
        borderRadius: 6,
      }} />
    </div>
  );
}

export default CardViewer3D;
