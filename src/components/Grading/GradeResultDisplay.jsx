/**
 * GradeResultDisplay - Unified grade display component
 * Renders identically across Grade Tab and Collection View for all grade types
 */

const mono = "'JetBrains Mono','SF Mono',monospace";
const sans = "'Inter',-apple-system,sans-serif";

// Grade type styling
const GRADE_TYPE_STYLES = {
  software: { color: '#00ff88', badge: 'SOFTWARE', borderColor: '#00ff8833' },
  ai: { color: '#8b5cf6', badge: 'AI ESTIMATE', borderColor: '#8b5cf633' },
  deep: { color: '#f97316', badge: 'DEEP AI', borderColor: '#f9731633' },
};

// Get color based on score value
function getScoreColor(value, maxValue = 100) {
  if (maxValue === 100) {
    // TAG 100-point scale (maps to 1000-pt system)
    if (value >= 95) return '#00ff88';
    if (value >= 90) return '#66dd44';
    if (value >= 80) return '#ffcc00';
    return '#ff6633';
  } else if (maxValue === 10) {
    // 10-point scale (BGS/CGC subgrades)
    if (value >= 9.5) return '#00ff88';
    if (value >= 9) return '#66dd44';
    if (value >= 8) return '#ffcc00';
    return '#ff6633';
  }
  return '#888';
}

// Format centering ratio for display
function formatCenteringRatio(ratio) {
  if (ratio == null) return '50/50';
  const left = Math.round(ratio * 10) / 10;
  const right = Math.round((100 - ratio) * 10) / 10;
  return `${left}/${right}`;
}

/**
 * SubgradeBox - Individual subgrade score display
 */
function SubgradeBox({ label, value, small = false, maxValue = 100 }) {
  if (value == null) return null;
  const color = getScoreColor(value, maxValue);
  return (
    <div style={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: small ? '4px 8px' : '6px 10px',
      background: '#0a0b0e',
      borderRadius: 6,
    }}>
      <span style={{ fontFamily: mono, fontSize: small ? 8 : 9, color: '#666' }}>{label}</span>
      <span style={{ fontFamily: mono, fontSize: small ? 10 : 11, fontWeight: 600, color }}>{value}</span>
    </div>
  );
}

/**
 * CenteringBox - Front/back centering display
 */
function CenteringBox({ label, lrRatio, tbRatio, isManual = false }) {
  const color = isManual ? '#ff9944' : '#00ff88';
  return (
    <div style={{ padding: '8px 10px', background: '#0a0b0e', borderRadius: 6 }}>
      <div style={{ fontFamily: mono, fontSize: 9, color: '#666', marginBottom: 4 }}>
        {label} {isManual && '(Manual)'}
      </div>
      <div style={{ fontFamily: mono, fontSize: 11, color }}>{formatCenteringRatio(lrRatio)} L/R</div>
      <div style={{ fontFamily: mono, fontSize: 11, color }}>{formatCenteringRatio(tbRatio)} T/B</div>
    </div>
  );
}

/**
 * ConditionBox - Condition score display
 */
function ConditionBox({ label, value, maxValue = 10 }) {
  if (value == null) return null;
  const color = getScoreColor(value, maxValue);
  return (
    <div style={{
      display: 'flex',
      justifyContent: 'space-between',
      padding: '6px 10px',
      background: '#0a0b0e',
      borderRadius: 6,
    }}>
      <span style={{ fontFamily: mono, fontSize: 9, color: '#666' }}>{label}</span>
      <span style={{ fontFamily: mono, fontSize: 11, fontWeight: 600, color }}>
        {value}{maxValue === 10 ? '/10' : ''}
      </span>
    </div>
  );
}

/**
 * GradeResultDisplay - Main unified component
 */
export function GradeResultDisplay({
  // Grade info
  grade,
  gradeLabel,
  rawScore,
  gradeType = 'software',
  company = 'tag',
  confidence,

  // Data sections
  subgrades,
  centering,
  condition,
  summary,
  cardInfo,

  // Images
  frontImage,
  backImage,
  showImages = true,

  // Styling
  compact = false,
}) {
  const style = GRADE_TYPE_STYLES[gradeType] || GRADE_TYPE_STYLES.software;
  const isTAG = company === 'tag';

  // Determine grade color based on value
  const getGradeColor = (value) => {
    if (value >= 9.5) return '#00ff88';
    if (value >= 9) return '#66dd44';
    if (value >= 8) return '#ffcc00';
    if (value >= 6) return '#ff9944';
    return '#ff6633';
  };

  const gradeColor = grade != null ? getGradeColor(grade) : style.color;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Card Images - Cropped */}
      {showImages && (frontImage || backImage) && (
        <div style={{ display: 'flex', gap: 8 }}>
          {frontImage && (
            <div style={{
              flex: 1,
              aspectRatio: '2.5/3.5',
              borderRadius: 8,
              overflow: 'hidden',
              background: '#0a0a0a',
              position: 'relative',
            }}>
              <img
                src={frontImage}
                alt="Front"
                style={{ width: '100%', height: '100%', objectFit: 'contain' }}
              />
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
              }}>FRONT</div>
            </div>
          )}
          {backImage && (
            <div style={{
              flex: 1,
              aspectRatio: '2.5/3.5',
              borderRadius: 8,
              overflow: 'hidden',
              background: '#0a0a0a',
              position: 'relative',
            }}>
              <img
                src={backImage}
                alt="Back"
                style={{ width: '100%', height: '100%', objectFit: 'contain' }}
              />
              <div style={{
                position: 'absolute',
                bottom: 4,
                right: 4,
                fontFamily: mono,
                fontSize: 8,
                color: '#555',
                background: 'rgba(0,0,0,0.7)',
                padding: '2px 6px',
                borderRadius: 4,
              }}>BACK</div>
            </div>
          )}
        </div>
      )}

      {/* Main Grade Display */}
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        gap: 16,
        padding: compact ? 16 : 20,
        background: '#0d0f13',
        borderRadius: 10,
        border: `1px solid ${style.borderColor}`,
      }}>
        {/* TAG: Show raw score */}
        {isTAG && rawScore != null && (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontFamily: mono, fontSize: compact ? 24 : 32, fontWeight: 800, color: '#888' }}>
              {rawScore}
            </div>
            <div style={{ fontFamily: mono, fontSize: 9, color: '#555' }}>/ 1000</div>
          </div>
        )}

        {/* Grade Number */}
        <div style={{ textAlign: 'center' }}>
          <div style={{
            fontFamily: mono,
            fontSize: compact ? 40 : 48,
            fontWeight: 900,
            color: gradeColor,
          }}>
            {grade ?? '--'}
          </div>
          <div style={{
            fontFamily: mono,
            fontSize: 12,
            fontWeight: 600,
            color: gradeColor,
            marginTop: 2,
          }}>
            {gradeLabel || 'Grade'}
          </div>
          {/* Confidence indicator */}
          {confidence != null && (
            <div style={{
              fontFamily: mono,
              fontSize: 10,
              color: confidence >= 80 ? '#00ff88' : confidence >= 60 ? '#ffcc00' : '#ff6633',
              marginTop: 4,
            }}>
              {Math.round(confidence)}% confident
            </div>
          )}
        </div>

        {/* Company Badge */}
        <div style={{
          padding: '8px 12px',
          background: `${style.color}15`,
          borderRadius: 8,
          border: `1px solid ${style.color}33`,
        }}>
          <div style={{ fontFamily: mono, fontSize: 11, fontWeight: 700, color: style.color }}>
            {company?.toUpperCase() || 'TAG'}
          </div>
          <div style={{ fontFamily: mono, fontSize: 8, color: style.color, opacity: 0.8, marginTop: 2 }}>
            {style.badge}
          </div>
        </div>
      </div>

      {/* TAG 8 Subgrades */}
      {isTAG && subgrades && (
        <div style={{
          padding: 14,
          background: '#0d0f13',
          borderRadius: 10,
          border: `1px solid ${style.borderColor}`,
        }}>
          <div style={{
            fontFamily: mono,
            fontSize: 10,
            color: style.color,
            textTransform: 'uppercase',
            marginBottom: 10,
          }}>
            Subgrades ({style.badge})
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            <SubgradeBox label="Front Centering" value={subgrades.frontCentering} />
            <SubgradeBox label="Back Centering" value={subgrades.backCentering} />
            <SubgradeBox label="Front Corners" value={subgrades.frontCorners} />
            <SubgradeBox label="Back Corners" value={subgrades.backCorners} />
            <SubgradeBox label="Front Edges" value={subgrades.frontEdges} />
            <SubgradeBox label="Back Edges" value={subgrades.backEdges} />
            <SubgradeBox label="Front Surface" value={subgrades.frontSurface} />
            <SubgradeBox label="Back Surface" value={subgrades.backSurface} />
          </div>
        </div>
      )}

      {/* BGS/CGC 4 Subgrades */}
      {(company === 'bgs' || company === 'cgc') && subgrades && (
        <div style={{
          padding: 14,
          background: '#0d0f13',
          borderRadius: 10,
          border: `1px solid ${style.borderColor}`,
        }}>
          <div style={{
            fontFamily: mono,
            fontSize: 10,
            color: style.color,
            textTransform: 'uppercase',
            marginBottom: 10,
          }}>
            {company.toUpperCase()} Subgrades ({style.badge})
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            <SubgradeBox label="Centering" value={subgrades.centering} maxValue={10} />
            <SubgradeBox label="Corners" value={subgrades.corners} maxValue={10} />
            <SubgradeBox label="Edges" value={subgrades.edges} maxValue={10} />
            <SubgradeBox label="Surface" value={subgrades.surface} maxValue={10} />
          </div>
        </div>
      )}

      {/* Centering Measurements - Manual only, no AI centering */}
      {centering && (centering.front || centering.back) && (
        <div style={{
          padding: 14,
          background: '#0d0f13',
          borderRadius: 10,
          border: '1px solid #1a1c22',
        }}>
          <div style={{
            fontFamily: mono,
            fontSize: 10,
            color: '#666',
            textTransform: 'uppercase',
            marginBottom: 10,
          }}>
            Centering Measurements
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {centering.front && (
              <CenteringBox
                label="FRONT"
                lrRatio={centering.front.lr}
                tbRatio={centering.front.tb}
                isManual={centering.front.isManual}
              />
            )}
            {centering.back && (
              <CenteringBox
                label="BACK"
                lrRatio={centering.back.lr}
                tbRatio={centering.back.tb}
                isManual={centering.back.isManual}
              />
            )}
          </div>
        </div>
      )}

      {/* Condition Assessment */}
      {condition && (
        <div style={{
          padding: 14,
          background: '#0d0f13',
          borderRadius: 10,
          border: `1px solid ${style.borderColor}`,
        }}>
          <div style={{
            fontFamily: mono,
            fontSize: 10,
            color: '#666',
            textTransform: 'uppercase',
            marginBottom: 10,
          }}>
            Condition {isTAG && <span style={{ color: style.color }}>(TAG 1000-Point)</span>}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            {condition.corners != null && <ConditionBox label="Corners" value={condition.corners} />}
            {condition.edges != null && <ConditionBox label="Edges" value={condition.edges} />}
            {condition.surface != null && <ConditionBox label="Surface" value={condition.surface} />}
            {condition.overall != null && <ConditionBox label="Overall" value={condition.overall} />}
          </div>
          {condition.defects?.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontFamily: mono, fontSize: 9, color: '#ff9944', marginBottom: 4 }}>
                DEFECTS
              </div>
              {condition.defects.map((d, i) => {
                const text = typeof d === 'string' ? d :
                  `${d.type}${d.location ? ` - ${d.location}` : ''}${d.severity ? ` (${d.severity})` : ''}`;
                return (
                  <div key={i} style={{ fontFamily: sans, fontSize: 11, color: '#888', marginBottom: 2 }}>
                    • {text}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Pros and Cons */}
      {summary && (summary.positives?.length > 0 || summary.concerns?.length > 0) && (
        <div style={{
          padding: 14,
          background: '#0d0f13',
          borderRadius: 10,
          border: `1px solid ${style.borderColor}`,
        }}>
          {summary.positives?.length > 0 && (
            <div style={{ marginBottom: summary.concerns?.length > 0 ? 12 : 0 }}>
              <div style={{
                fontFamily: mono,
                fontSize: 9,
                color: '#00ff88',
                marginBottom: 6,
              }}>
                PROS
              </div>
              {summary.positives.map((p, i) => (
                <div key={i} style={{ fontFamily: sans, fontSize: 11, color: '#888', marginBottom: 2 }}>
                  • {p}
                </div>
              ))}
            </div>
          )}
          {summary.concerns?.length > 0 && (
            <div>
              <div style={{
                fontFamily: mono,
                fontSize: 9,
                color: '#ff9944',
                marginBottom: 6,
              }}>
                CONS
              </div>
              {summary.concerns.map((c, i) => (
                <div key={i} style={{ fontFamily: sans, fontSize: 11, color: '#888', marginBottom: 2 }}>
                  • {c}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Grader Notes / Recommendation */}
      {summary?.recommendation && (
        <div style={{
          padding: '10px 12px',
          background: `${style.color}08`,
          borderRadius: 8,
          border: `1px solid ${style.color}15`,
        }}>
          <div style={{
            fontFamily: mono,
            fontSize: 9,
            color: style.color,
            marginBottom: 4,
          }}>
            RECOMMENDATION
          </div>
          <div style={{ fontFamily: sans, fontSize: 12, color: '#aaa', lineHeight: 1.5 }}>
            {summary.recommendation}
          </div>
        </div>
      )}

      {/* Card Info */}
      {cardInfo && (cardInfo.name || cardInfo.set) && (
        <div style={{
          padding: 12,
          background: '#0a0b0e',
          borderRadius: 8,
          border: '1px solid #1a1c2233',
        }}>
          <div style={{ fontFamily: mono, fontSize: 9, color: '#555', marginBottom: 4 }}>
            CARD INFO
          </div>
          <div style={{ fontFamily: sans, fontSize: 12, color: '#888' }}>
            {[cardInfo.name, cardInfo.set, cardInfo.number && `#${cardInfo.number}`, cardInfo.year]
              .filter(Boolean)
              .join(' • ')}
          </div>
        </div>
      )}
    </div>
  );
}

export default GradeResultDisplay;
