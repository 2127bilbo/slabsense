/**
 * SlabSense - Collection View
 * Card stack display with swipe navigation
 */

import { useState, useEffect, useRef } from 'react';
import { getUserScans, deleteScan, updateScan } from '../../services/scans.js';
import { getGradeFromScore, GRADING_COMPANIES as GRADE_SCALES } from '../../utils/gradingScales.js';
import { HoloCard } from '../HoloCard/HoloCard.jsx';
import { getGyroInput } from '../../lib/gyro-input.js';
import { CardViewer3D } from '../CardViewer/CardViewer3D.jsx';
import { claudeGradingAnalysis } from '../../services/api.js';
import holoConfig from '../../../config/holo-config.json';

const mono = "'JetBrains Mono','SF Mono',monospace";
const sans = "'Inter',-apple-system,sans-serif";

const GRADING_COMPANIES = {
  psa: { name: 'PSA', color: '#ff6b6b' },
  bgs: { name: 'BGS', color: '#ffd93d' },
  sgc: { name: 'SGC', color: '#6bcb77' },
  cgc: { name: 'CGC', color: '#4d96ff' },
  tag: { name: 'TAG', color: '#8b5cf6' },
};

// EUR to USD conversion rate (approximate)
const EUR_TO_USD = 1.08;

/* ═══════════════════════════════════════════
   SURFACE VISION HELPERS
   ═══════════════════════════════════════════ */
function loadImg(src,mx=1400){return new Promise(r=>{const img=new Image();img.crossOrigin="anonymous";img.onload=()=>{let w=img.width,h=img.height;if(Math.max(w,h)>mx){const s=mx/Math.max(w,h);w=Math.round(w*s);h=Math.round(h*s);}const c=document.createElement("canvas");c.width=w;c.height=h;const ctx=c.getContext("2d",{willReadFrequently:true});ctx.drawImage(img,0,0,w,h);r({canvas:c,ctx,w,h,data:ctx.getImageData(0,0,w,h)});};img.onerror=()=>r(null);img.src=src;});}

const LUM=(r,g,b)=>.299*r+.587*g+.114*b;

function genMaps(src){return new Promise(async r=>{
  const result=await loadImg(src,1400);
  if(!result){r(null);return;}
  const{canvas,w,h,data}=result;const d=data.data;
  const mk=()=>{const c=document.createElement("canvas");c.width=w;c.height=h;return c;};
  const L=(Y,X)=>LUM(d[(Y*w+X)*4],d[(Y*w+X)*4+1],d[(Y*w+X)*4+2]);

  // Emboss
  const eC=mk(),eX=eC.getContext("2d"),eD=eX.createImageData(w,h),e=eD.data;
  for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){const i=(y*w+x)*4,v=Math.min(255,Math.max(0,128+(L(y+1,x+1)-L(y-1,x-1))*2));e[i]=e[i+1]=e[i+2]=v;e[i+3]=255;}
  eX.putImageData(eD,0,0);

  // High-pass
  const hC=mk(),hX=hC.getContext("2d"),hD=hX.createImageData(w,h),hp=hD.data;
  for(let y=8;y<h-8;y++)for(let x=8;x<w-8;x++){const i=(y*w+x)*4;let ls=0,ln=0;for(let dy=-8;dy<=8;dy+=2)for(let dx=-8;dx<=8;dx+=2){ls+=L(y+dy,x+dx);ln++;}const v=Math.min(255,Math.max(0,128+(L(y,x)-ls/ln)*3));hp[i]=hp[i+1]=hp[i+2]=v;hp[i+3]=255;}
  hX.putImageData(hD,0,0);

  // Sobel edges
  const dC=mk(),dX=dC.getContext("2d"),dD=dX.createImageData(w,h),ed=dD.data;
  for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){const i=(y*w+x)*4;const gx=-L(y-1,x-1)+L(y-1,x+1)-2*L(y,x-1)+2*L(y,x+1)-L(y+1,x-1)+L(y+1,x+1);const gy=-L(y-1,x-1)-2*L(y-1,x)-L(y-1,x+1)+L(y+1,x-1)+2*L(y+1,x)+L(y+1,x+1);const m=Math.min(255,Math.sqrt(gx*gx+gy*gy));ed[i]=~~(m*.2);ed[i+1]=~~(m*.9);ed[i+2]=~~m;ed[i+3]=255;}
  dX.putImageData(dD,0,0);

  r({original:canvas.toDataURL(),emboss:eC.toDataURL(),highpass:hC.toDataURL(),edges:dC.toDataURL(),width:w,height:h});
});}

/**
 * Get card price from scan data
 * Uses TCGDex Cardmarket pricing (EUR converted to USD)
 */
function getCardPrice(scan) {
  // Check card_info first (from TCGDex)
  const pricing = scan.card_info?.pricing;
  if (pricing) {
    // Prefer trend price, then avg, then low
    const eurPrice = pricing.trend || pricing.avg || pricing.low || null;
    if (eurPrice) {
      return {
        eur: eurPrice,
        usd: Math.round(eurPrice * EUR_TO_USD * 100) / 100,
        source: 'cardmarket',
      };
    }
  }
  return null;
}

/**
 * Format price for display
 */
function formatPrice(price, currency = 'usd') {
  if (!price) return null;
  if (currency === 'usd') {
    return `$${price.usd?.toFixed(2) || '—'}`;
  }
  return `€${price.eur?.toFixed(2) || '—'}`;
}

// Check if card is holo based on rarity string
function isHoloCard(scan) {
  const rarity = scan.card_info?.rarity?.toLowerCase() || '';
  return rarity.includes('holo') ||
         rarity.includes('rare v') ||
         rarity.includes('ultra') ||
         rarity.includes('secret') ||
         rarity.includes('rainbow') ||
         rarity.includes('gold') ||
         rarity.includes('radiant') ||
         rarity.includes('shiny') ||
         rarity.includes('full art') ||
         rarity.includes('illustration');
}

export function CollectionView({ userId, onClose, isInline = false, onCollectionChange }) {
  const [scans, setScans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedCard, setSelectedCard] = useState(null);
  const [selectedCompany, setSelectedCompany] = useState('tag');
  const [showAiGrade, setShowAiGrade] = useState(true);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [touchStart, setTouchStart] = useState(null);
  const stackRef = useRef(null);

  // Vision mode state for card detail
  const [visionMode, setVisionMode] = useState('normal');
  const [visionIntensity, setVisionIntensity] = useState(50);
  const [fM, setFM] = useState(null);  // Front vision maps
  const [bM, setBM] = useState(null);  // Back vision maps
  const [mapsLoading, setMapsLoading] = useState(false);

  // 3D viewer state
  const [show3DViewer, setShow3DViewer] = useState(false);

  // Re-grading state
  const [enhancingStatus, setEnhancingStatus] = useState(null);
  const [regradeResult, setRegradeResult] = useState(null);

  // Gyro input for holo sparkles
  const gyroInputRef = useRef(null);
  if (!gyroInputRef.current) {
    gyroInputRef.current = getGyroInput({
      deadZone: holoConfig.collectionCards.sparkles.deadZone,
      rampPower: holoConfig.collectionCards.sparkles.rampPower,
    });
  }

  useEffect(() => {
    loadScans();
  }, [userId]);

  const loadScans = async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const data = await getUserScans(userId);
      setScans(data || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (scanId) => {
    try {
      await deleteScan(scanId);
      setScans(scans.filter(s => s.id !== scanId));
      setDeleteConfirm(null);
      setSelectedCard(null);
      if (currentIndex >= scans.length - 1) {
        setCurrentIndex(Math.max(0, scans.length - 2));
      }
      // Notify parent to refresh collection stats
      if (onCollectionChange) onCollectionChange();
    } catch (err) {
      console.error('Delete failed:', err);
    }
  };

  // Generate vision maps when card is selected
  useEffect(() => {
    if (selectedCard) {
      const frontImg = selectedCard.front_image_path;
      const backImg = selectedCard.back_image_path;

      // Reset state for new card
      setVisionMode('normal');
      setVisionIntensity(50);
      setShow3DViewer(false);
      setEnhancingStatus(null);
      setRegradeResult(null);
      setFM(null);
      setBM(null);

      // Generate vision maps if images exist
      if (frontImg || backImg) {
        setMapsLoading(true);
        Promise.all([
          frontImg ? genMaps(frontImg) : Promise.resolve(null),
          backImg ? genMaps(backImg) : Promise.resolve(null),
        ]).then(([frontMaps, backMaps]) => {
          setFM(frontMaps);
          setBM(backMaps);
          setMapsLoading(false);
        }).catch(() => setMapsLoading(false));
      }
    } else {
      setFM(null);
      setBM(null);
      setShow3DViewer(false);
    }
  }, [selectedCard]);

  // Handle re-grading with AI
  const handleRegrade = async () => {
    if (!selectedCard?.front_image || !selectedCard?.back_image) return;
    setEnhancingStatus('enhancing');
    try {
      const result = await claudeGradingAnalysis(
        selectedCard.front_image_path,
        selectedCard.back_image_path,
        'pokemon'
      );
      if (result.success) {
        setRegradeResult(result);

        // Update the scan in database with new grades
        const updateData = {};
        if (result.grades) updateData.ai_grades = result.grades;
        if (result.condition) updateData.ai_condition = result.condition;
        if (result.summary) updateData.ai_summary = result.summary;
        if (result.centering) updateData.ai_centering = result.centering;

        if (Object.keys(updateData).length > 0) {
          await updateScan(selectedCard.id, updateData);
          // Update local state
          setSelectedCard(prev => ({ ...prev, ...updateData }));
          setScans(prev => prev.map(s =>
            s.id === selectedCard.id ? { ...s, ...updateData } : s
          ));
        }

        setEnhancingStatus('done');
      } else {
        setEnhancingStatus('error');
        setTimeout(() => setEnhancingStatus(null), 3000);
      }
    } catch (err) {
      console.error('Re-grade error:', err);
      setEnhancingStatus('error');
      setTimeout(() => setEnhancingStatus(null), 3000);
    }
  };

  const getGradeColor = (grade) => {
    if (grade >= 9.5) return '#00ff88';
    if (grade >= 9) return '#66dd44';
    if (grade >= 8) return '#ffcc00';
    if (grade >= 7) return '#ff9944';
    return '#ff6633';
  };

  const formatDate = (dateStr) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  // Navigate through card stack
  const goToNext = () => {
    if (scans.length > 1) {
      setCurrentIndex((prev) => (prev + 1) % scans.length);
    }
  };

  const goToPrev = () => {
    if (scans.length > 1) {
      setCurrentIndex((prev) => (prev - 1 + scans.length) % scans.length);
    }
  };

  // Touch/swipe handling
  const handleTouchStart = (e) => {
    setTouchStart(e.touches[0].clientX);
  };

  const handleTouchEnd = (e) => {
    if (!touchStart) return;
    const touchEnd = e.changedTouches[0].clientX;
    const diff = touchStart - touchEnd;
    if (Math.abs(diff) > 50) {
      if (diff > 0) goToNext();
      else goToPrev();
    }
    setTouchStart(null);
  };

  // Get grade for display (AI or software)
  // Recalculates grade from score for accuracy based on selected company
  const getDisplayGrade = (scan, company = selectedCompany) => {
    if (showAiGrade && scan.ai_grades?.[company]) {
      const aiGrade = scan.ai_grades[company];
      // Recalculate grade from score for accuracy
      const score = aiGrade.score || 0;
      const recalcGrade = score > 0 ? getGradeFromScore(score, company) : null;
      return {
        value: recalcGrade?.grade ?? aiGrade.grade,
        label: recalcGrade?.label ?? aiGrade.label,
        color: recalcGrade?.color ?? GRADING_COMPANIES[company]?.color,
        isAi: true,
        score: company === 'tag' ? score : null,
        subgrades: aiGrade.subgrades,
        notes: aiGrade.notes,
        company: company,
      };
    }
    // Software grade - recalculate from raw_score for selected company
    const rawScore = scan.raw_score || 0;
    const recalcGrade = rawScore > 0 ? getGradeFromScore(rawScore, company) : null;
    return {
      value: recalcGrade?.grade ?? scan.grade_value,
      label: recalcGrade?.label ?? scan.grade_label,
      color: recalcGrade?.color ?? GRADING_COMPANIES[company]?.color,
      isAi: false,
      score: company === 'tag' ? rawScore : null,
      rawScore: rawScore,
      company: company,
    };
  };

  // Get card image URL (TCGDex > user-cropped > enhanced > null)
  const getCardImage = (scan) => {
    if (scan.tcgdex_image) return scan.tcgdex_image;
    if (scan.user_card_image) return scan.user_card_image;
    if (scan.enhanced_front_path) return scan.enhanced_front_path;
    return null;
  };

  // Calculate total collection value
  const getTotalCollectionValue = () => {
    let totalEur = 0;
    let cardsWithPrice = 0;

    scans.forEach(scan => {
      const price = getCardPrice(scan);
      if (price?.eur) {
        totalEur += price.eur;
        cardsWithPrice++;
      }
    });

    return {
      eur: Math.round(totalEur * 100) / 100,
      usd: Math.round(totalEur * EUR_TO_USD * 100) / 100,
      cardsWithPrice,
      totalCards: scans.length,
    };
  };

  const collectionValue = scans.length > 0 ? getTotalCollectionValue() : null;

  // Card stack rendering - shows actual card images with grade overlay
  const renderCardStack = () => {
    if (scans.length === 0) return null;

    const visibleCards = [];
    for (let i = 0; i < Math.min(3, scans.length); i++) {
      const index = (currentIndex + i) % scans.length;
      visibleCards.push({ scan: scans[index], offset: i });
    }

    return (
      <div
        ref={stackRef}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        style={{
          position: 'relative',
          width: '100%',
          height: 320,
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          perspective: '1000px',
        }}
      >
        {visibleCards.reverse().map(({ scan, offset }) => {
          const grade = getDisplayGrade(scan);
          const isTop = offset === 0;
          const cardImage = getCardImage(scan);

          return (
            <div
              key={scan.id}
              onClick={() => isTop && setSelectedCard(scan)}
              style={{
                position: 'absolute',
                width: 180,
                height: 252, // Pokemon card aspect ratio ~2.5x3.5
                background: cardImage ? '#0a0b0e' : `linear-gradient(145deg, #1a1c22 0%, #0d0f13 100%)`,
                borderRadius: 10,
                border: `2px solid ${isTop ? getGradeColor(grade.value) + '66' : '#1a1c22'}`,
                boxShadow: isTop
                  ? `0 12px 40px rgba(0,0,0,0.6), 0 0 30px ${getGradeColor(grade.value)}33`
                  : '0 6px 20px rgba(0,0,0,0.4)',
                transform: `
                  translateY(${offset * 12}px)
                  translateX(${offset * 6}px)
                  scale(${1 - offset * 0.06})
                  rotateX(${offset * 3}deg)
                `,
                transformOrigin: 'center bottom',
                zIndex: 10 - offset,
                cursor: isTop ? 'pointer' : 'default',
                transition: 'all 0.3s ease',
                opacity: isTop ? 1 : 0.8 - offset * 0.15,
                overflow: 'hidden',
              }}
            >
              {/* Card Image with Holo Sparkles */}
              <HoloCard
                gyroInput={gyroInputRef.current}
                config={holoConfig.collectionCards}
                enabled={isTop && isHoloCard(scan)}
              >
                {cardImage ? (
                  <img
                    src={cardImage}
                    alt={scan.card_name || 'Card'}
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover',
                      display: 'block',
                    }}
                    onError={(e) => { e.target.style.display = 'none'; }}
                  />
                ) : (
                  /* Fallback: Show card info text */
                  <div style={{
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'center',
                    alignItems: 'center',
                    height: '100%',
                    padding: 16,
                    textAlign: 'center',
                  }}>
                    <div style={{
                      fontFamily: sans,
                      fontSize: 13,
                      fontWeight: 600,
                      color: '#888',
                      marginBottom: 4,
                    }}>
                      {scan.card_name || scan.card_info?.name || 'Card'}
                    </div>
                    <div style={{
                      fontFamily: mono,
                      fontSize: 9,
                      color: '#555',
                    }}>
                      {scan.card_set || scan.card_info?.setName || ''}
                    </div>
                  </div>
                )}
              </HoloCard>

              {/* Grade Badge Overlay - top right */}
              <div style={{
                position: 'absolute',
                top: 8,
                right: 8,
                padding: '6px 10px',
                background: 'rgba(0,0,0,0.85)',
                backdropFilter: 'blur(8px)',
                border: `1px solid ${getGradeColor(grade.value)}55`,
                borderRadius: 8,
                textAlign: 'center',
              }}>
                <div style={{
                  fontFamily: mono,
                  fontSize: 20,
                  fontWeight: 800,
                  color: getGradeColor(grade.value),
                  lineHeight: 1,
                }}>
                  {grade.value}
                </div>
                <div style={{
                  fontFamily: mono,
                  fontSize: 7,
                  color: getGradeColor(grade.value),
                  opacity: 0.8,
                  marginTop: 2,
                }}>
                  {GRADING_COMPANIES[scan.grading_company]?.name || 'TAG'}
                </div>
              </div>

              {/* Top left badges */}
              <div style={{
                position: 'absolute',
                top: 8,
                left: 8,
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
              }}>
                {/* AI Badge */}
                {grade.isAi && (
                  <div style={{
                    padding: '3px 6px',
                    background: 'rgba(139,92,246,0.9)',
                    borderRadius: 4,
                    fontFamily: mono,
                    fontSize: 7,
                    fontWeight: 600,
                    color: '#fff',
                  }}>
                    AI
                  </div>
                )}
                {/* Price Badge */}
                {(() => {
                  const price = getCardPrice(scan);
                  if (!price) return null;
                  return (
                    <div style={{
                      padding: '3px 6px',
                      background: 'rgba(0,255,136,0.9)',
                      borderRadius: 4,
                      fontFamily: mono,
                      fontSize: 7,
                      fontWeight: 600,
                      color: '#000',
                    }}>
                      ${price.usd.toFixed(0)}
                    </div>
                  );
                })()}
              </div>

              {/* Tap hint on top card */}
              {isTop && (
                <div style={{
                  position: 'absolute',
                  bottom: -28,
                  left: '50%',
                  transform: 'translateX(-50%)',
                  fontFamily: mono,
                  fontSize: 9,
                  color: '#444',
                  whiteSpace: 'nowrap',
                }}>
                  tap for details
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  // Card Detail Modal
  const renderDetailModal = () => {
    if (!selectedCard) return null;

    const grade = getDisplayGrade(selectedCard, selectedCompany);
    const hasAiGrades = !!selectedCard.ai_grades;
    const hasSoftwareGrade = selectedCard.grade_value != null;
    const hasBothGrades = hasAiGrades && hasSoftwareGrade;

    return (
      <div style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.95)',
        zIndex: 2000,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'auto',
      }}>
        {/* Header */}
        <div style={{
          padding: '14px 16px',
          borderBottom: '1px solid #1a1c22',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          position: 'sticky',
          top: 0,
          background: '#0a0b0e',
          zIndex: 10,
        }}>
          <button
            onClick={() => setSelectedCard(null)}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#666',
              fontSize: 20,
              cursor: 'pointer',
              padding: '4px 8px',
            }}
          >
            ←
          </button>
          <div style={{ fontFamily: sans, fontSize: 14, fontWeight: 600, color: '#fff' }}>
            Card Details
          </div>
          <button
            onClick={() => setDeleteConfirm(selectedCard.id)}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#666',
              fontSize: 16,
              cursor: 'pointer',
              padding: '4px 8px',
            }}
          >
            🗑
          </button>
        </div>

        {/* Content */}
        <div style={{ padding: 16, flex: 1 }}>
          {/* Grade Toggle (AI vs Software) */}
          {hasBothGrades && (
            <div style={{
              display: 'flex',
              gap: 8,
              marginBottom: 16,
              padding: 4,
              background: '#0d0f13',
              borderRadius: 8,
            }}>
              <button
                onClick={() => setShowAiGrade(true)}
                style={{
                  flex: 1,
                  padding: '8px 12px',
                  background: showAiGrade ? 'rgba(139,92,246,0.2)' : 'transparent',
                  border: showAiGrade ? '1px solid rgba(139,92,246,0.3)' : '1px solid transparent',
                  borderRadius: 6,
                  color: showAiGrade ? '#8b5cf6' : '#666',
                  fontFamily: mono,
                  fontSize: 11,
                  cursor: 'pointer',
                }}
              >
                AI Grade
              </button>
              <button
                onClick={() => setShowAiGrade(false)}
                style={{
                  flex: 1,
                  padding: '8px 12px',
                  background: !showAiGrade ? 'rgba(0,255,136,0.1)' : 'transparent',
                  border: !showAiGrade ? '1px solid rgba(0,255,136,0.2)' : '1px solid transparent',
                  borderRadius: 6,
                  color: !showAiGrade ? '#00ff88' : '#666',
                  fontFamily: mono,
                  fontSize: 11,
                  cursor: 'pointer',
                }}
              >
                Software Grade
              </button>
            </div>
          )}

          {/* Card Images with Vision Modes */}
          {(selectedCard.front_image_path || selectedCard.back_image_path) && (
            <div style={{ marginBottom: 16 }}>
              {/* Vision Mode Buttons */}
              <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                {[['normal','Normal'],['emboss','Emboss'],['highpass','Hi-Pass'],['edges','Edges']]
                  .map(([mode, label]) => (
                    <button
                      key={mode}
                      onClick={() => setVisionMode(mode)}
                      disabled={mapsLoading}
                      style={{
                        flex: 1,
                        padding: '8px 0',
                        borderRadius: 6,
                        border: visionMode === mode ? '1px solid #6366f1' : '1px solid #2a2d35',
                        background: visionMode === mode ? 'rgba(99,102,241,0.15)' : 'transparent',
                        color: visionMode === mode ? '#8b5cf6' : '#666',
                        fontFamily: mono,
                        fontSize: 9,
                        cursor: mapsLoading ? 'wait' : 'pointer',
                        textTransform: 'uppercase',
                        opacity: mapsLoading ? 0.5 : 1,
                      }}
                    >
                      {label}
                    </button>
                  ))}
              </div>

              {/* Intensity Slider */}
              {visionMode !== 'normal' && (
                <div style={{ marginBottom: 10 }}>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={visionIntensity}
                    onChange={e => setVisionIntensity(Number(e.target.value))}
                    style={{
                      width: '100%',
                      height: 6,
                      borderRadius: 3,
                      background: `linear-gradient(90deg, #6366f1 ${visionIntensity}%, #1a1c22 ${visionIntensity}%)`,
                      appearance: 'none',
                      cursor: 'pointer',
                    }}
                  />
                  <style>{`input[type=range]::-webkit-slider-thumb{appearance:none;width:14px;height:14px;border-radius:50%;background:#8b5cf6;cursor:pointer;border:2px solid #0a0b0e;}`}</style>
                  <div style={{
                    fontFamily: mono,
                    fontSize: 9,
                    color: '#555',
                    textAlign: 'center',
                    marginTop: 4,
                  }}>
                    Intensity: {visionIntensity}%
                  </div>
                </div>
              )}

              {/* Front + Back Images */}
              <div style={{ display: 'flex', gap: 8 }}>
                {/* Front Image */}
                <div style={{
                  flex: 1,
                  aspectRatio: '2.5/3.5',
                  borderRadius: 8,
                  overflow: 'hidden',
                  background: '#0a0a0a',
                  position: 'relative',
                }}>
                  {selectedCard.front_image_path ? (
                    <>
                      <img
                        src={selectedCard.front_image_path}
                        alt="Front"
                        style={{
                          width: '100%',
                          height: '100%',
                          objectFit: 'contain',
                          position: 'absolute',
                          inset: 0,
                        }}
                      />
                      {visionMode !== 'normal' && fM?.[visionMode] && (
                        <img
                          src={fM[visionMode]}
                          alt={`Front ${visionMode}`}
                          style={{
                            width: '100%',
                            height: '100%',
                            objectFit: 'contain',
                            position: 'absolute',
                            inset: 0,
                            opacity: visionIntensity / 100,
                          }}
                        />
                      )}
                    </>
                  ) : (
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      height: '100%',
                      color: '#444',
                      fontFamily: mono,
                      fontSize: 10,
                    }}>
                      No image
                    </div>
                  )}
                  <div style={{
                    position: 'absolute',
                    bottom: 4,
                    left: 4,
                    fontFamily: mono,
                    fontSize: 8,
                    color: '#555',
                    background: 'rgba(0,0,0,0.7)',
                    padding: '2px 6px',
                    borderRadius: 4,
                    zIndex: 1,
                  }}>
                    FRONT
                  </div>
                </div>

                {/* Back Image */}
                <div style={{
                  flex: 1,
                  aspectRatio: '2.5/3.5',
                  borderRadius: 8,
                  overflow: 'hidden',
                  background: '#0a0a0a',
                  position: 'relative',
                }}>
                  {selectedCard.back_image_path ? (
                    <>
                      <img
                        src={selectedCard.back_image_path}
                        alt="Back"
                        style={{
                          width: '100%',
                          height: '100%',
                          objectFit: 'contain',
                          position: 'absolute',
                          inset: 0,
                        }}
                      />
                      {visionMode !== 'normal' && bM?.[visionMode] && (
                        <img
                          src={bM[visionMode]}
                          alt={`Back ${visionMode}`}
                          style={{
                            width: '100%',
                            height: '100%',
                            objectFit: 'contain',
                            position: 'absolute',
                            inset: 0,
                            opacity: visionIntensity / 100,
                          }}
                        />
                      )}
                    </>
                  ) : (
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      height: '100%',
                      color: '#444',
                      fontFamily: mono,
                      fontSize: 10,
                    }}>
                      No image
                    </div>
                  )}
                  <div style={{
                    position: 'absolute',
                    bottom: 4,
                    left: 4,
                    fontFamily: mono,
                    fontSize: 8,
                    color: '#555',
                    background: 'rgba(0,0,0,0.7)',
                    padding: '2px 6px',
                    borderRadius: 4,
                    zIndex: 1,
                  }}>
                    BACK
                  </div>
                </div>
              </div>

              {/* Action Buttons (3D View + Re-grade) */}
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                {/* 3D View Button */}
                <button
                  onClick={() => setShow3DViewer(true)}
                  style={{
                    flex: 1,
                    padding: '10px 12px',
                    background: 'rgba(99,102,241,0.1)',
                    border: '1px solid rgba(99,102,241,0.3)',
                    borderRadius: 8,
                    color: '#8b5cf6',
                    fontFamily: mono,
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                  }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="5" width="18" height="14" rx="2" />
                    <line x1="3" y1="9" x2="21" y2="9" />
                  </svg>
                  3D Slab View
                </button>

                {/* Re-grade Button */}
                <button
                  onClick={handleRegrade}
                  disabled={enhancingStatus === 'enhancing' || !selectedCard.front_image_path || !selectedCard.back_image_path}
                  style={{
                    flex: 1,
                    padding: '10px 12px',
                    background: enhancingStatus === 'done'
                      ? 'rgba(0,255,136,0.1)'
                      : enhancingStatus === 'error'
                      ? 'rgba(255,100,100,0.1)'
                      : 'rgba(139,92,246,0.1)',
                    border: enhancingStatus === 'done'
                      ? '1px solid rgba(0,255,136,0.3)'
                      : enhancingStatus === 'error'
                      ? '1px solid rgba(255,100,100,0.3)'
                      : '1px solid rgba(139,92,246,0.3)',
                    borderRadius: 8,
                    color: enhancingStatus === 'done'
                      ? '#00ff88'
                      : enhancingStatus === 'error'
                      ? '#ff6666'
                      : '#8b5cf6',
                    fontFamily: mono,
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: enhancingStatus === 'enhancing' ? 'wait' : 'pointer',
                    opacity: (!selectedCard.front_image_path || !selectedCard.back_image_path) ? 0.5 : 1,
                  }}
                >
                  {enhancingStatus === 'enhancing' ? '⏳ Grading...' :
                   enhancingStatus === 'done' ? '✓ Re-graded' :
                   enhancingStatus === 'error' ? '✗ Failed' :
                   'Re-grade (~$0.03)'}
                </button>
              </div>
            </div>
          )}

          {/* Company Tabs - Show for both AI and Software grades */}
          <div style={{
            display: 'flex',
            gap: 6,
            marginBottom: 16,
            overflowX: 'auto',
            paddingBottom: 4,
          }}>
            {Object.entries(GRADING_COMPANIES).map(([id, company]) => (
              <button
                key={id}
                onClick={() => setSelectedCompany(id)}
                style={{
                  padding: '6px 12px',
                  background: selectedCompany === id ? `${company.color}22` : '#0d0f13',
                  border: `1px solid ${selectedCompany === id ? company.color + '44' : '#1a1c22'}`,
                  borderRadius: 6,
                  color: selectedCompany === id ? company.color : '#666',
                  fontFamily: mono,
                  fontSize: 10,
                  fontWeight: 600,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                {company.name}
              </button>
            ))}
          </div>

          {/* Main Grade Display */}
          <div style={{
            textAlign: 'center',
            padding: '24px 16px',
            background: `${getGradeColor(grade.value)}08`,
            borderRadius: 12,
            border: `1px solid ${getGradeColor(grade.value)}22`,
            marginBottom: 16,
          }}>
            <div style={{
              fontFamily: mono,
              fontSize: 64,
              fontWeight: 800,
              color: getGradeColor(grade.value),
              lineHeight: 1,
            }}>
              {grade.value}
            </div>
            <div style={{
              fontFamily: mono,
              fontSize: 16,
              fontWeight: 600,
              color: getGradeColor(grade.value),
              marginTop: 8,
            }}>
              {grade.label}
            </div>
            {(grade.score || grade.rawScore) && selectedCompany === 'tag' && (
              <div style={{
                fontFamily: mono,
                fontSize: 12,
                color: '#666',
                marginTop: 4,
              }}>
                TAG Score: {grade.score || grade.rawScore} / 1000
              </div>
            )}
            {grade.isAi && (
              <div style={{
                display: 'inline-block',
                marginTop: 8,
                padding: '4px 12px',
                background: 'rgba(139,92,246,0.2)',
                borderRadius: 12,
                fontFamily: mono,
                fontSize: 10,
                color: '#8b5cf6',
              }}>
                AI Analysis
              </div>
            )}
          </div>

          {/* Subgrades (BGS/TAG) */}
          {grade.subgrades && (
            <div style={{
              padding: 14,
              background: '#0d0f13',
              borderRadius: 10,
              marginBottom: 16,
            }}>
              <div style={{
                fontFamily: mono,
                fontSize: 10,
                color: '#666',
                marginBottom: 10,
              }}>
                SUBGRADES
              </div>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(4, 1fr)',
                gap: 8,
              }}>
                {selectedCompany === 'bgs' && grade.subgrades && (
                  <>
                    <SubgradeBox label="Center" value={grade.subgrades.centering} />
                    <SubgradeBox label="Corners" value={grade.subgrades.corners} />
                    <SubgradeBox label="Edges" value={grade.subgrades.edges} />
                    <SubgradeBox label="Surface" value={grade.subgrades.surface} />
                  </>
                )}
                {selectedCompany === 'tag' && grade.subgrades && (
                  <>
                    <SubgradeBox label="F-Cent" value={grade.subgrades.frontCentering} small />
                    <SubgradeBox label="F-Corn" value={grade.subgrades.frontCorners} small />
                    <SubgradeBox label="F-Edge" value={grade.subgrades.frontEdges} small />
                    <SubgradeBox label="F-Surf" value={grade.subgrades.frontSurface} small />
                    {grade.subgrades.backCentering && (
                      <>
                        <SubgradeBox label="B-Cent" value={grade.subgrades.backCentering} small />
                        <SubgradeBox label="B-Corn" value={grade.subgrades.backCorners} small />
                        <SubgradeBox label="B-Edge" value={grade.subgrades.backEdges} small />
                        <SubgradeBox label="B-Surf" value={grade.subgrades.backSurface} small />
                      </>
                    )}
                  </>
                )}
              </div>
            </div>
          )}

          {/* Centering */}
          {(selectedCard.ai_centering || selectedCard.front_centering) && (
            <div style={{
              padding: 14,
              background: '#0d0f13',
              borderRadius: 10,
              marginBottom: 16,
            }}>
              <div style={{
                fontFamily: mono,
                fontSize: 10,
                color: '#666',
                marginBottom: 10,
              }}>
                CENTERING
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <CenteringBox
                  label="FRONT"
                  lr={selectedCard.ai_centering?.front?.leftRight ||
                      `${Math.round(selectedCard.front_centering?.lrRatio || 50)}/${Math.round(100 - (selectedCard.front_centering?.lrRatio || 50))}`}
                  tb={selectedCard.ai_centering?.front?.topBottom ||
                      `${Math.round(selectedCard.front_centering?.tbRatio || 50)}/${Math.round(100 - (selectedCard.front_centering?.tbRatio || 50))}`}
                />
                {(selectedCard.ai_centering?.back || selectedCard.back_centering) && (
                  <CenteringBox
                    label="BACK"
                    lr={selectedCard.ai_centering?.back?.leftRight ||
                        `${Math.round(selectedCard.back_centering?.lrRatio || 50)}/${Math.round(100 - (selectedCard.back_centering?.lrRatio || 50))}`}
                    tb={selectedCard.ai_centering?.back?.topBottom ||
                        `${Math.round(selectedCard.back_centering?.tbRatio || 50)}/${Math.round(100 - (selectedCard.back_centering?.tbRatio || 50))}`}
                  />
                )}
              </div>
            </div>
          )}

          {/* Condition - AI or Software */}
          {(()=>{
            const conditionData = showAiGrade ? selectedCard.ai_condition : selectedCard.subgrades;
            if (!conditionData) return null;
            const isTAG = selectedCompany === 'tag';
            // For software grades, subgrades has corners, edges, surface as scores
            const corners = showAiGrade ? conditionData.corners : conditionData.corners?.score;
            const edges = showAiGrade ? conditionData.edges : conditionData.edges?.score;
            const surface = showAiGrade ? conditionData.surface : conditionData.surface?.score;
            const centering = showAiGrade ? conditionData.centering : conditionData.centering?.score;
            const defects = showAiGrade ? conditionData.defects : null;

            return (
              <div style={{
                padding: 14,
                background: '#0d0f13',
                borderRadius: 10,
                marginBottom: 16,
              }}>
                <div style={{
                  fontFamily: mono,
                  fontSize: 10,
                  color: '#666',
                  marginBottom: 10,
                }}>
                  CONDITION {isTAG && <span style={{color:'#8b5cf6'}}>(TAG 1000-Point)</span>}
                  {!showAiGrade && <span style={{color:'#00ff88'}}> (Software)</span>}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  {corners != null && (
                    <ConditionBox label="Corners" value={corners} isTAG={isTAG} />
                  )}
                  {edges != null && (
                    <ConditionBox label="Edges" value={edges} isTAG={isTAG} />
                  )}
                  {surface != null && (
                    <ConditionBox label="Surface" value={surface} isTAG={isTAG} />
                  )}
                  {centering != null && (
                    <ConditionBox label="Centering" value={centering} isTAG={isTAG} />
                  )}
                </div>
                {defects?.length > 0 && (
                  <div style={{ marginTop: 10 }}>
                    <div style={{ fontFamily: mono, fontSize: 9, color: '#ff9944', marginBottom: 4 }}>
                      DEFECTS
                    </div>
                    {defects.map((d, i) => (
                      <div key={i} style={{
                        fontFamily: sans,
                        fontSize: 11,
                        color: '#888',
                        marginBottom: 2,
                      }}>
                        • {d}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}

          {/* AI Summary */}
          {selectedCard.ai_summary && showAiGrade && (
            <div style={{
              padding: 14,
              background: '#0d0f13',
              borderRadius: 10,
              marginBottom: 16,
            }}>
              {selectedCard.ai_summary.positives?.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <div style={{
                    fontFamily: mono,
                    fontSize: 9,
                    color: '#00ff88',
                    marginBottom: 6,
                  }}>
                    POSITIVES
                  </div>
                  {selectedCard.ai_summary.positives.map((p, i) => (
                    <div key={i} style={{
                      fontFamily: sans,
                      fontSize: 11,
                      color: '#888',
                      marginBottom: 2,
                    }}>
                      • {p}
                    </div>
                  ))}
                </div>
              )}
              {selectedCard.ai_summary.concerns?.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <div style={{
                    fontFamily: mono,
                    fontSize: 9,
                    color: '#ff9944',
                    marginBottom: 6,
                  }}>
                    CONCERNS
                  </div>
                  {selectedCard.ai_summary.concerns.map((c, i) => (
                    <div key={i} style={{
                      fontFamily: sans,
                      fontSize: 11,
                      color: '#888',
                      marginBottom: 2,
                    }}>
                      • {c}
                    </div>
                  ))}
                </div>
              )}
              {selectedCard.ai_summary.recommendation && (
                <div style={{
                  padding: '10px 12px',
                  background: 'rgba(0,255,136,0.05)',
                  borderRadius: 8,
                  border: '1px solid rgba(0,255,136,0.1)',
                }}>
                  <div style={{
                    fontFamily: mono,
                    fontSize: 9,
                    color: '#00ff88',
                    marginBottom: 4,
                  }}>
                    RECOMMENDATION
                  </div>
                  <div style={{
                    fontFamily: sans,
                    fontSize: 12,
                    color: '#aaa',
                  }}>
                    {selectedCard.ai_summary.recommendation}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Grade Notes */}
          {grade.notes && (
            <div style={{
              padding: 14,
              background: '#0d0f13',
              borderRadius: 10,
              marginBottom: 16,
            }}>
              <div style={{
                fontFamily: mono,
                fontSize: 10,
                color: '#666',
                marginBottom: 8,
              }}>
                GRADER NOTES
              </div>
              <div style={{
                fontFamily: sans,
                fontSize: 12,
                color: '#888',
                fontStyle: 'italic',
              }}>
                {grade.notes}
              </div>
            </div>
          )}

          {/* Card Value */}
          {(() => {
            const price = getCardPrice(selectedCard);
            if (!price) return null;
            return (
              <div style={{
                padding: 14,
                background: 'rgba(0,255,136,0.05)',
                borderRadius: 10,
                border: '1px solid rgba(0,255,136,0.15)',
                marginBottom: 16,
              }}>
                <div style={{
                  fontFamily: mono,
                  fontSize: 10,
                  color: '#00ff88',
                  marginBottom: 10,
                }}>
                  MARKET VALUE
                </div>
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}>
                  <div>
                    <div style={{
                      fontFamily: mono,
                      fontSize: 28,
                      fontWeight: 800,
                      color: '#00ff88',
                    }}>
                      ${price.usd.toFixed(2)}
                    </div>
                    <div style={{
                      fontFamily: mono,
                      fontSize: 11,
                      color: '#00ff8866',
                      marginTop: 2,
                    }}>
                      €{price.eur.toFixed(2)} EUR
                    </div>
                  </div>
                  <div style={{
                    textAlign: 'right',
                    fontFamily: mono,
                    fontSize: 9,
                    color: '#555',
                  }}>
                    <div>via Cardmarket</div>
                    <div style={{ color: '#444', marginTop: 2 }}>Raw card price</div>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Card Info */}
          <div style={{
            padding: 14,
            background: '#0d0f13',
            borderRadius: 10,
          }}>
            <div style={{
              fontFamily: mono,
              fontSize: 10,
              color: '#666',
              marginBottom: 10,
            }}>
              CARD INFO
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <InfoRow label="Name" value={selectedCard.card_name || selectedCard.card_info?.name} />
              <InfoRow label="Set" value={selectedCard.card_set || selectedCard.card_info?.setName} />
              <InfoRow label="Number" value={selectedCard.card_number || selectedCard.card_info?.cardNumber} />
              <InfoRow label="Year" value={selectedCard.card_info?.year} />
              <InfoRow label="Rarity" value={selectedCard.card_info?.rarity} />
              <InfoRow label="Language" value={selectedCard.card_info?.language} />
            </div>
            <div style={{
              marginTop: 12,
              paddingTop: 12,
              borderTop: '1px solid #1a1c22',
              fontFamily: mono,
              fontSize: 10,
              color: '#444',
            }}>
              Scanned {formatDate(selectedCard.created_at)}
            </div>
          </div>
        </div>

        {/* Delete Confirmation */}
        {deleteConfirm === selectedCard.id && (
          <div style={{
            position: 'fixed',
            bottom: 0,
            left: 0,
            right: 0,
            padding: 16,
            background: '#0a0b0e',
            borderTop: '1px solid #1a1c22',
          }}>
            <div style={{
              fontFamily: sans,
              fontSize: 14,
              color: '#fff',
              marginBottom: 12,
              textAlign: 'center',
            }}>
              Delete this card?
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => setDeleteConfirm(null)}
                style={{
                  flex: 1,
                  padding: 12,
                  background: '#1a1c22',
                  border: 'none',
                  borderRadius: 8,
                  color: '#888',
                  fontFamily: mono,
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => handleDelete(selectedCard.id)}
                style={{
                  flex: 1,
                  padding: 12,
                  background: 'rgba(255,68,68,0.2)',
                  border: '1px solid rgba(255,68,68,0.3)',
                  borderRadius: 8,
                  color: '#ff6666',
                  fontFamily: mono,
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                Delete
              </button>
            </div>
          </div>
        )}

        {/* 3D Viewer Modal */}
        {show3DViewer && (
          <div style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.98)',
            zIndex: 3000,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            {/* Close Button */}
            <button
              onClick={() => setShow3DViewer(false)}
              style={{
                position: 'absolute',
                top: 16,
                right: 16,
                background: 'rgba(255,255,255,0.1)',
                border: 'none',
                borderRadius: '50%',
                width: 40,
                height: 40,
                color: '#888',
                fontSize: 20,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 10,
              }}
            >
              ✕
            </button>

            {/* 3D Viewer */}
            <CardViewer3D
              frontImage={selectedCard.tcgdex_image || selectedCard.user_card_image || selectedCard.front_image_path}
              backImage={selectedCard.back_image_path}
              grade={grade.value}
              gradeLabel={grade.label}
              gradingCompany={selectedCompany}
              cardInfo={selectedCard.card_info}
              subgrades={grade.subgrades}
            />
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={isInline ? {
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
    } : {
      position: 'fixed',
      inset: 0,
      background: '#0a0b0e',
      zIndex: 1000,
      display: 'flex',
      flexDirection: 'column',
    }}>
      {/* Header */}
      {!isInline && (
        <div style={{
          padding: '14px 16px',
          borderBottom: '1px solid #1a1c22',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button
              onClick={onClose}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#666',
                fontSize: 20,
                cursor: 'pointer',
                padding: '4px 8px',
              }}
            >
              ←
            </button>
            <div>
              <div style={{ fontFamily: sans, fontSize: 16, fontWeight: 600, color: '#fff' }}>
                My Collection
              </div>
              <div style={{ fontFamily: mono, fontSize: 10, color: '#555' }}>
                {scans.length} {scans.length === 1 ? 'card' : 'cards'}
              </div>
            </div>
          </div>
          {/* Collection Value */}
          {collectionValue && collectionValue.usd > 0 && (
            <div style={{
              padding: '6px 12px',
              background: 'rgba(0,255,136,0.1)',
              borderRadius: 8,
              border: '1px solid rgba(0,255,136,0.2)',
            }}>
              <div style={{ fontFamily: mono, fontSize: 14, fontWeight: 700, color: '#00ff88' }}>
                ${collectionValue.usd.toFixed(2)}
              </div>
              <div style={{ fontFamily: mono, fontSize: 8, color: '#00ff8866' }}>
                {collectionValue.cardsWithPrice}/{collectionValue.totalCards} priced
              </div>
            </div>
          )}
        </div>
      )}

      {/* Inline header */}
      {isInline && (
        <div style={{
          padding: '12px 16px',
          borderBottom: '1px solid #1a1c22',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <div>
            <div style={{ fontFamily: sans, fontSize: 16, fontWeight: 600, color: '#fff' }}>
              My Collection
            </div>
            <div style={{ fontFamily: mono, fontSize: 10, color: '#555', marginTop: 2 }}>
              {scans.length} {scans.length === 1 ? 'card' : 'cards'}
            </div>
          </div>
          {/* Collection Value */}
          {collectionValue && collectionValue.usd > 0 && (
            <div style={{
              padding: '6px 12px',
              background: 'rgba(0,255,136,0.1)',
              borderRadius: 8,
              border: '1px solid rgba(0,255,136,0.2)',
              textAlign: 'right',
            }}>
              <div style={{ fontFamily: mono, fontSize: 14, fontWeight: 700, color: '#00ff88' }}>
                ${collectionValue.usd.toFixed(2)}
              </div>
              <div style={{ fontFamily: mono, fontSize: 8, color: '#00ff8866' }}>
                {collectionValue.cardsWithPrice}/{collectionValue.totalCards} priced
              </div>
            </div>
          )}
        </div>
      )}

      {/* Content */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: 16 }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: 40 }}>
            <div style={{ fontFamily: mono, fontSize: 12, color: '#555' }}>Loading...</div>
          </div>
        ) : error ? (
          <div style={{ textAlign: 'center', padding: 40 }}>
            <div style={{ fontFamily: mono, fontSize: 12, color: '#ff6666' }}>{error}</div>
          </div>
        ) : scans.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 40 }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>📁</div>
            <div style={{ fontFamily: sans, fontSize: 14, color: '#666', marginBottom: 8 }}>
              No cards yet
            </div>
            <div style={{ fontFamily: mono, fontSize: 11, color: '#444' }}>
              Grade a card and click "Save to Collection"
            </div>
          </div>
        ) : (
          <>
            {/* Card Stack */}
            {renderCardStack()}

            {/* Navigation */}
            {scans.length > 1 && (
              <div style={{
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                gap: 24,
                marginTop: 32,
              }}>
                <button
                  onClick={goToPrev}
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: '50%',
                    background: '#1a1c22',
                    border: '1px solid #2a2d35',
                    color: '#888',
                    fontSize: 20,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  ‹
                </button>
                <div style={{
                  fontFamily: mono,
                  fontSize: 12,
                  color: '#555',
                }}>
                  {currentIndex + 1} / {scans.length}
                </div>
                <button
                  onClick={goToNext}
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: '50%',
                    background: '#1a1c22',
                    border: '1px solid #2a2d35',
                    color: '#888',
                    fontSize: 20,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  ›
                </button>
              </div>
            )}

            {/* Swipe hint */}
            <div style={{
              textAlign: 'center',
              marginTop: 16,
              fontFamily: mono,
              fontSize: 10,
              color: '#333',
            }}>
              swipe or use arrows to browse
            </div>
          </>
        )}
      </div>

      {/* Detail Modal */}
      {renderDetailModal()}
    </div>
  );
}

// Helper Components
function SubgradeBox({ label, value, small = false }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{
        fontFamily: "'JetBrains Mono',monospace",
        fontSize: small ? 14 : 16,
        fontWeight: 700,
        color: '#8b5cf6',
      }}>
        {value}
      </div>
      <div style={{
        fontFamily: "'JetBrains Mono',monospace",
        fontSize: 8,
        color: '#555',
        textTransform: 'uppercase',
      }}>
        {label}
      </div>
    </div>
  );
}

function CenteringBox({ label, lr, tb }) {
  return (
    <div style={{
      padding: '8px 10px',
      background: '#0a0b0e',
      borderRadius: 6,
    }}>
      <div style={{
        fontFamily: "'JetBrains Mono',monospace",
        fontSize: 9,
        color: '#666',
        marginBottom: 4,
      }}>
        {label}
      </div>
      <div style={{
        fontFamily: "'JetBrains Mono',monospace",
        fontSize: 11,
        color: '#00ff88',
      }}>
        {lr} L/R
      </div>
      <div style={{
        fontFamily: "'JetBrains Mono',monospace",
        fontSize: 11,
        color: '#00ff88',
      }}>
        {tb} T/B
      </div>
    </div>
  );
}

function ConditionBox({ label, value, isTAG = false }) {
  // For TAG: value is out of 1000 (per category ~125 max), show as raw score
  // For others: value is out of 10
  const displayValue = isTAG ? value : value;
  const maxValue = isTAG ? (label === 'Centering' ? 125 : 125) : 10;
  const normalizedValue = isTAG ? (value / 125) * 10 : value;
  const color = normalizedValue >= 9 ? '#00ff88' : normalizedValue >= 7 ? '#ffcc00' : '#ff6633';

  return (
    <div style={{
      display: 'flex',
      justifyContent: 'space-between',
      padding: '6px 10px',
      background: '#0a0b0e',
      borderRadius: 6,
    }}>
      <span style={{
        fontFamily: "'JetBrains Mono',monospace",
        fontSize: 10,
        color: '#666',
      }}>
        {label}
      </span>
      <span style={{
        fontFamily: "'JetBrains Mono',monospace",
        fontSize: 11,
        fontWeight: 600,
        color,
      }}>
        {isTAG ? `${displayValue}` : `${value}/10`}
      </span>
    </div>
  );
}

function InfoRow({ label, value }) {
  if (!value) return null;
  return (
    <div style={{
      display: 'flex',
      justifyContent: 'space-between',
      padding: '4px 0',
    }}>
      <span style={{
        fontFamily: "'JetBrains Mono',monospace",
        fontSize: 10,
        color: '#555',
      }}>
        {label}
      </span>
      <span style={{
        fontFamily: "'Inter',sans-serif",
        fontSize: 11,
        color: '#888',
      }}>
        {value}
      </span>
    </div>
  );
}
