/**
 * DeepAiDingsMap - Visual Defect Map for Deep AI Results
 *
 * Production component for rendering coordinate-based defects.
 *
 * Features:
 * - Renders defect markers at exact coordinates from Deep AI analysis
 * - Shows per-corner and per-edge scores with color-coded indicators
 * - Supports both 125-scale (legacy) and 1000-scale (TAG) scoring
 * - Hover tooltips for defect details
 * - Face health summary with scale auto-detection
 */

import { useState } from 'react';

const mono = "'JetBrains Mono', monospace";
const sans = "'Inter', sans-serif";

// Corner position mapping (as percentages)
const CORNER_POSITIONS = {
  TL: { x: 8, y: 8 },
  TR: { x: 92, y: 8 },
  BL: { x: 8, y: 92 },
  BR: { x: 92, y: 92 },
};

// Edge position mapping (center of each edge)
const EDGE_POSITIONS = {
  TOP: { x: 50, y: 5 },
  BOTTOM: { x: 50, y: 95 },
  LEFT: { x: 5, y: 50 },
  RIGHT: { x: 95, y: 50 },
};

// Score to color mapping (1000-point scale)
function getScoreColor(score) {
  // Handle both 125-scale (legacy) and 1000-scale
  const normalizedScore = score > 200 ? score : score * 8; // Convert 125-scale to 1000-scale if needed

  if (normalizedScore >= 980) return '#00ff88'; // Perfect (Gem Mint)
  if (normalizedScore >= 950) return '#66dd44'; // Excellent (Gem Mint eligible)
  if (normalizedScore >= 900) return '#aacc00'; // Very good (Mint)
  if (normalizedScore >= 800) return '#ffcc00'; // Good (NM-MT)
  if (normalizedScore >= 700) return '#ff9944'; // Fair (NM)
  return '#ff4444'; // Poor
}

// Severity to color mapping
function getSeverityColor(severity) {
  switch (severity) {
    case 'minor': return '#ffcc00';
    case 'moderate': return '#ff9944';
    case 'severe': return '#ff4444';
    default: return '#ff6633';
  }
}

/**
 * Single card face map with defect markers
 */
function CardFaceMap({ side, image, defects, areaScores, showScores = true }) {
  const [hoveredDefect, setHoveredDefect] = useState(null);

  const faceDefects = defects?.filter(d => d.side === side) || [];
  const scores = areaScores?.[side.toLowerCase()] || {};

  // Calculate overall face health (supports both 125 and 1000 scale)
  const cornerScores = scores.corners ? Object.values(scores.corners) : [];
  const edgeScores = scores.edges ? Object.values(scores.edges) : [];

  // Detect scale: if any score > 200, it's 1000-scale
  const is1000Scale = [...cornerScores, ...edgeScores, scores.surface || 0].some(s => s > 200);
  const maxScore = is1000Scale ? 1000 : 125;

  const avgCorner = cornerScores.length ? cornerScores.reduce((a, b) => a + b, 0) / cornerScores.length : maxScore;
  const avgEdge = edgeScores.length ? edgeScores.reduce((a, b) => a + b, 0) / edgeScores.length : maxScore;
  const surfaceScore = scores.surface || maxScore;
  const faceHealth = (avgCorner + avgEdge + surfaceScore) / 3;

  const hasDings = faceDefects.length > 0;

  return (
    <div style={{
      flex: 1,
      background: '#0d0f13',
      borderRadius: 10,
      border: `1px solid ${hasDings ? '#ff663344' : '#1a1c22'}`,
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        padding: '8px 12px',
        background: '#0a0b0e',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        borderBottom: '1px solid #1a1c22',
      }}>
        <span style={{ fontFamily: mono, fontSize: 10, color: '#888', textTransform: 'uppercase' }}>
          {side} — Defect Map
        </span>
        <span style={{
          fontFamily: mono,
          fontSize: 9,
          color: hasDings ? '#ff6633' : '#00ff88',
        }}>
          {hasDings ? `${faceDefects.length} defect${faceDefects.length !== 1 ? 's' : ''}` : 'Clean'}
        </span>
      </div>

      {/* Map area */}
      <div style={{ position: 'relative', padding: 12 }}>
        {/* Card image or placeholder */}
        <div style={{
          position: 'relative',
          width: '100%',
          paddingBottom: '140%', // Card aspect ratio
          background: image ? `url(${image}) center/contain no-repeat` : '#1a1c22',
          borderRadius: 8,
          overflow: 'hidden',
        }}>
          {/* Corner score indicators */}
          {showScores && scores.corners && Object.entries(scores.corners).map(([corner, score]) => {
            const pos = CORNER_POSITIONS[corner];
            return (
              <div
                key={corner}
                style={{
                  position: 'absolute',
                  left: `${pos.x}%`,
                  top: `${pos.y}%`,
                  transform: 'translate(-50%, -50%)',
                  width: 28,
                  height: 28,
                  borderRadius: '50%',
                  background: `${getScoreColor(score)}22`,
                  border: `2px solid ${getScoreColor(score)}`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontFamily: mono,
                  fontSize: 9,
                  fontWeight: 700,
                  color: getScoreColor(score),
                }}
              >
                {score}
              </div>
            );
          })}

          {/* Edge score indicators */}
          {showScores && scores.edges && Object.entries(scores.edges).map(([edge, score]) => {
            const pos = EDGE_POSITIONS[edge];
            const isVertical = edge === 'LEFT' || edge === 'RIGHT';
            return (
              <div
                key={edge}
                style={{
                  position: 'absolute',
                  left: `${pos.x}%`,
                  top: `${pos.y}%`,
                  transform: 'translate(-50%, -50%)',
                  padding: '2px 6px',
                  borderRadius: 4,
                  background: `${getScoreColor(score)}22`,
                  border: `1px solid ${getScoreColor(score)}`,
                  fontFamily: mono,
                  fontSize: 8,
                  fontWeight: 600,
                  color: getScoreColor(score),
                  writingMode: isVertical ? 'vertical-rl' : 'horizontal-tb',
                  textOrientation: isVertical ? 'mixed' : 'auto',
                }}
              >
                {score}
              </div>
            );
          })}

          {/* Surface score (center) */}
          {showScores && scores.surface && (
            <div style={{
              position: 'absolute',
              left: '50%',
              top: '50%',
              transform: 'translate(-50%, -50%)',
              padding: '4px 10px',
              borderRadius: 6,
              background: 'rgba(0,0,0,0.7)',
              border: `1px solid ${getScoreColor(scores.surface)}`,
              fontFamily: mono,
              fontSize: 10,
              color: getScoreColor(scores.surface),
            }}>
              SRF: {scores.surface}
            </div>
          )}

          {/* Defect markers */}
          {faceDefects.map((defect, i) => {
            const coords = defect.coordinates || CORNER_POSITIONS[defect.position] || EDGE_POSITIONS[defect.position] || { x: 50, y: 50 };
            return (
              <div
                key={i}
                onMouseEnter={() => setHoveredDefect(i)}
                onMouseLeave={() => setHoveredDefect(null)}
                style={{
                  position: 'absolute',
                  left: `${coords.x}%`,
                  top: `${coords.y}%`,
                  transform: 'translate(-50%, -50%)',
                  width: 20,
                  height: 20,
                  borderRadius: '50%',
                  background: `${getSeverityColor(defect.severity)}44`,
                  border: `2px solid ${getSeverityColor(defect.severity)}`,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontFamily: mono,
                  fontSize: 10,
                  fontWeight: 700,
                  color: '#fff',
                  zIndex: 10,
                }}
              >
                ⚠
              </div>
            );
          })}

          {/* Hover tooltip */}
          {hoveredDefect !== null && faceDefects[hoveredDefect] && (
            <div style={{
              position: 'absolute',
              left: '50%',
              bottom: 10,
              transform: 'translateX(-50%)',
              padding: '6px 10px',
              borderRadius: 6,
              background: 'rgba(0,0,0,0.9)',
              border: '1px solid #333',
              fontFamily: sans,
              fontSize: 11,
              color: '#fff',
              whiteSpace: 'nowrap',
              zIndex: 20,
            }}>
              <div style={{ color: getSeverityColor(faceDefects[hoveredDefect].severity), fontWeight: 600 }}>
                {faceDefects[hoveredDefect].type}
              </div>
              <div style={{ color: '#888', fontSize: 10 }}>
                {faceDefects[hoveredDefect].description || faceDefects[hoveredDefect].position}
              </div>
            </div>
          )}

          {/* No defects overlay */}
          {!hasDings && (
            <div style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              background: 'rgba(0,255,136,0.15)',
              border: '1px solid rgba(0,255,136,0.3)',
              borderRadius: 8,
              padding: '8px 14px',
              fontFamily: mono,
              fontSize: 11,
              color: '#00ff88',
              whiteSpace: 'nowrap',
            }}>
              No defects detected
            </div>
          )}
        </div>
      </div>

      {/* Face summary */}
      <div style={{
        padding: '8px 12px',
        borderTop: '1px solid #1a1c22',
        background: '#0a0b0e',
      }}>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <span style={{ fontFamily: mono, fontSize: 9, color: '#666' }}>
            Face Health
          </span>
          <span style={{
            fontFamily: mono,
            fontSize: 11,
            fontWeight: 600,
            color: getScoreColor(faceHealth),
          }}>
            {Math.round(faceHealth)}/{maxScore}
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * Main DeepAiDingsMap component
 */
export function DeepAiDingsMap({
  frontImage,
  backImage,
  defects = [],
  areaScores = {},
  showScores = true,
}) {
  const totalDefects = defects.length;
  const frontDefects = defects.filter(d => d.side === 'FRONT');
  const backDefects = defects.filter(d => d.side === 'BACK');

  return (
    <div>
      {/* Header stats */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 12,
        padding: '10px 14px',
        background: '#0d0f13',
        borderRadius: 8,
        border: `1px solid ${totalDefects > 0 ? '#ff663333' : '#00ff8833'}`,
      }}>
        <div style={{
          fontFamily: mono,
          fontSize: 10,
          color: '#888',
          textTransform: 'uppercase',
        }}>
          Deep AI Defect Analysis
        </div>
        <div style={{
          fontFamily: mono,
          fontSize: 12,
          fontWeight: 700,
          color: totalDefects === 0 ? '#00ff88' : totalDefects <= 2 ? '#ffcc00' : '#ff6633',
        }}>
          {totalDefects} DING{totalDefects !== 1 ? 'S' : ''}
        </div>
      </div>

      {/* Side-by-side maps */}
      <div style={{ display: 'flex', gap: 12 }}>
        <CardFaceMap
          side="FRONT"
          image={frontImage}
          defects={defects}
          areaScores={areaScores}
          showScores={showScores}
        />
        <CardFaceMap
          side="BACK"
          image={backImage}
          defects={defects}
          areaScores={areaScores}
          showScores={showScores}
        />
      </div>

      {/* Defect list */}
      {totalDefects > 0 && (
        <div style={{ marginTop: 14 }}>
          <div style={{
            fontFamily: mono,
            fontSize: 10,
            color: '#555',
            textTransform: 'uppercase',
            marginBottom: 8,
          }}>
            Defect Details (Deep AI)
          </div>
          {defects.map((d, i) => (
            <div
              key={i}
              style={{
                padding: '10px 12px',
                marginBottom: 6,
                background: '#0d0f13',
                borderRadius: 8,
                border: '1px solid #1a1c22',
                borderLeft: `3px solid ${getSeverityColor(d.severity)}`,
              }}
            >
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 4,
              }}>
                <span style={{
                  fontFamily: mono,
                  fontSize: 11,
                  color: getSeverityColor(d.severity),
                  fontWeight: 600,
                }}>
                  {d.position || d.type} ({d.side})
                </span>
                <span style={{
                  fontFamily: mono,
                  fontSize: 9,
                  color: '#555',
                  textTransform: 'uppercase',
                }}>
                  {d.type}
                </span>
              </div>
              {d.description && (
                <div style={{ fontFamily: sans, fontSize: 12, color: '#888' }}>
                  {d.description}
                </div>
              )}
              {d.coordinates && (
                <div style={{
                  fontFamily: mono,
                  fontSize: 9,
                  color: '#444',
                  marginTop: 4,
                }}>
                  Position: {d.coordinates.x}%, {d.coordinates.y}%
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default DeepAiDingsMap;
