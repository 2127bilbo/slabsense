/**
 * SlabSense - Collection View
 * Card stack display with swipe navigation
 */

import { useState, useEffect, useRef } from 'react';
import { getUserScans, deleteScan } from '../../services/scans.js';
import { getGradeFromScore, GRADING_COMPANIES as GRADE_SCALES } from '../../utils/gradingScales.js';

const mono = "'JetBrains Mono','SF Mono',monospace";
const sans = "'Inter',-apple-system,sans-serif";

const GRADING_COMPANIES = {
  psa: { name: 'PSA', color: '#ff6b6b' },
  bgs: { name: 'BGS', color: '#ffd93d' },
  sgc: { name: 'SGC', color: '#6bcb77' },
  cgc: { name: 'CGC', color: '#4d96ff' },
  tag: { name: 'TAG', color: '#8b5cf6' },
};

export function CollectionView({ userId, onClose, isInline = false }) {
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
    } catch (err) {
      console.error('Delete failed:', err);
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

  // Get card image URL (TCGDex > enhanced > placeholder)
  const getCardImage = (scan) => {
    if (scan.tcgdex_image) return scan.tcgdex_image;
    if (scan.enhanced_front_path) return scan.enhanced_front_path;
    return null;
  };

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
              {/* Card Image */}
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

              {/* AI Badge - top left */}
              {grade.isAi && (
                <div style={{
                  position: 'absolute',
                  top: 8,
                  left: 8,
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
        </div>
      )}

      {/* Inline header */}
      {isInline && (
        <div style={{
          padding: '12px 16px',
          borderBottom: '1px solid #1a1c22',
        }}>
          <div style={{ fontFamily: sans, fontSize: 16, fontWeight: 600, color: '#fff' }}>
            My Collection
          </div>
          <div style={{ fontFamily: mono, fontSize: 10, color: '#555', marginTop: 2 }}>
            {scans.length} {scans.length === 1 ? 'card' : 'cards'}
          </div>
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
