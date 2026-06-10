/**
 * DingsTabV2 - Dings Tab with Software/Deep AI Mode Switching
 *
 * Production version with TAG 1000-point scoring support.
 *
 * Features:
 * - Mode switching: 'software' | 'ai' | 'deep'
 * - Deep AI mode shows coordinate-based defect map with area scores
 * - Software mode shows pixel-based analysis
 * - Centering dings calculated from SOFTWARE/MANUAL data (never AI centering)
 * - TAG 1000-point centering scoring formula
 *
 * Usage: Replace dings tab section in App.jsx with this component.
 */

import { useState } from 'react';
import { DeepAiDingsMap } from './DeepAiDingsMap.jsx';

const mono = "'JetBrains Mono', monospace";
const sans = "'Inter', sans-serif";

/**
 * Calculate centering dings from software/manual centering data
 * TAG threshold: 55/45 front, 65/35 back for Gem Mint
 * Returns array of centering dings with severity based on deviation
 *
 * TAG 1000-POINT CENTERING SCALE:
 * - Perfect (50/50): 1000
 * - <2% deviation: 980-999
 * - 2-5% deviation: 950-979 (Gem Mint eligible)
 * - 5-10% deviation: 900-949 (Mint)
 * - 10-15% deviation: 800-899 (NM-MT)
 * - 15-20% deviation: 700-799 (NM)
 * - >20% deviation: <700
 */
function calculateCenteringDings(frontCentering, backCentering) {
  const dings = [];

  // Calculate centering score on 1000-point scale
  const calculateCenteringScore = (deviation) => {
    // deviation is percentage from 50 (e.g., 55/45 = 5% deviation)
    if (deviation <= 2) return 1000 - (deviation * 10); // 980-1000
    if (deviation <= 5) return 980 - ((deviation - 2) * 10); // 950-980
    if (deviation <= 10) return 950 - ((deviation - 5) * 10); // 900-950
    if (deviation <= 15) return 900 - ((deviation - 10) * 20); // 800-900
    if (deviation <= 20) return 800 - ((deviation - 15) * 20); // 700-800
    return Math.max(500, 700 - ((deviation - 20) * 10)); // <700
  };

  // Check front centering
  if (frontCentering) {
    const lrRatio = frontCentering.lrRatio || 50;
    const tbRatio = frontCentering.tbRatio || 50;
    const maxLR = Math.max(lrRatio, 100 - lrRatio);
    const maxTB = Math.max(tbRatio, 100 - tbRatio);
    const worst = Math.max(maxLR, maxTB);
    const deviation = worst - 50;
    const threshold = 55; // Front threshold for Gem Mint (5% deviation)

    if (worst > threshold) {
      const score = calculateCenteringScore(deviation);
      const severity = score < 800 ? 'severe' : score < 900 ? 'moderate' : 'minor';
      const deduction = 1000 - score; // TAG point deduction

      dings.push({
        side: 'FRONT',
        type: 'CENTERING',
        position: 'CENTER',
        coordinates: { x: 50, y: 50 },
        severity,
        description: `Off-center: ${lrRatio.toFixed(1)}/${(100-lrRatio).toFixed(1)} L/R, ${tbRatio.toFixed(1)}/${(100-tbRatio).toFixed(1)} T/B`,
        deviationPct: deviation,
        score: Math.round(score),
        pointDeduction: Math.round(deduction),
        isCentering: true,
      });
    }
  }

  // Check back centering
  if (backCentering) {
    const lrRatio = backCentering.lrRatio || 50;
    const tbRatio = backCentering.tbRatio || 50;
    const maxLR = Math.max(lrRatio, 100 - lrRatio);
    const maxTB = Math.max(tbRatio, 100 - tbRatio);
    const worst = Math.max(maxLR, maxTB);
    const deviation = worst - 50;
    const threshold = 65; // Back threshold for Gem Mint (15% deviation - more lenient)

    if (worst > threshold) {
      const score = calculateCenteringScore(deviation);
      const severity = score < 800 ? 'severe' : score < 900 ? 'moderate' : 'minor';
      const deduction = 1000 - score; // TAG point deduction

      dings.push({
        side: 'BACK',
        type: 'CENTERING',
        position: 'CENTER',
        coordinates: { x: 50, y: 50 },
        severity,
        description: `Off-center: ${lrRatio.toFixed(1)}/${(100-lrRatio).toFixed(1)} L/R, ${tbRatio.toFixed(1)}/${(100-tbRatio).toFixed(1)} T/B`,
        deviationPct: deviation,
        score: Math.round(score),
        pointDeduction: Math.round(deduction),
        isCentering: true,
      });
    }
  }

  return dings;
}

/**
 * Software DingsMap - Original pixel-based analysis
 * (Extracted from App.jsx DingsMap function)
 */
function SoftwareDingsMap({ frontResult, backResult }) {
  const [side, setSide] = useState("front");
  const result = side === "front" ? frontResult : backResult;
  if (!result) return null;

  const cornerData = result.corners?.details || [];
  const edgeData = result.edges?.details || [];
  const centering = result.centering || { lrRatio: 50, tbRatio: 50 };
  const sideLabel = side === "front" ? "FRONT" : "BACK";
  const dingColor = "#ff6633";
  const cleanColor = "#333";
  const getCorner = (name) => cornerData.find(c => c.name === name) || {};
  const getEdge = (name) => edgeData.find(e => e.name === name) || {};

  // Card rect coordinates
  const cx = 100, cy = 80, cw = 160, ch = 224;

  const CornerScore = ({ x, y, data, align = "middle" }) => (
    <g>
      <text x={x} y={y} fill={data.hasDing ? dingColor : "#555"} fontSize="7.5" fontFamily={mono} textAnchor={align} fontWeight={data.hasDing ? 600 : 400}>
        {data.name || ""}
      </text>
      <text x={x} y={y + 11} fill="#555" fontSize="6.5" fontFamily={mono} textAnchor={align}>
        F:{data.fray || "—"} Fi:{data.fill || "—"}{data.angle !== undefined ? ` A:${data.angle}` : ""}
      </text>
    </g>
  );

  const EdgeScore = ({ x, y, data, align = "middle" }) => (
    <g>
      <text x={x} y={y} fill={data.hasDing ? dingColor : "#555"} fontSize="7.5" fontFamily={mono} textAnchor={align} fontWeight={data.hasDing ? 600 : 400}>
        {data.name || ""} EDGE
      </text>
      <text x={x} y={y + 11} fill="#555" fontSize="6.5" fontFamily={mono} textAnchor={align}>
        F:{data.fray || "—"} Fi:{data.fill || "—"}
      </text>
    </g>
  );

  return (
    <div style={{ background: "#0d0f13", borderRadius: 10, border: "1px solid #1a1c22", padding: 12, marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <span style={{ fontFamily: mono, fontSize: 11, color: "#888", textTransform: "uppercase" }}>Software DINGS Map</span>
        <div style={{ display: "flex", gap: 4 }}>
          {["front", "back"].map(s => (
            <button
              key={s}
              onClick={() => setSide(s)}
              style={{
                padding: "4px 10px",
                borderRadius: 4,
                background: side === s ? "rgba(0,255,136,.1)" : "transparent",
                border: `1px solid ${side === s ? "#00ff8833" : "#1a1c22"}`,
                color: side === s ? "#00ff88" : "#555",
                fontFamily: mono,
                fontSize: 9,
                textTransform: "uppercase",
                cursor: "pointer",
              }}
            >
              {s}
            </button>
          ))}
        </div>
      </div>
      <svg viewBox="0 0 360 540" style={{ width: "100%" }}>
        {/* Card outline */}
        <rect x={cx} y={cy} width={cw} height={ch} rx="6" fill="none" stroke="#333" strokeWidth="1.5" />

        {/* Center crosshair */}
        <line x1={cx + cw / 2} y1={cy} x2={cx + cw / 2} y2={cy + ch} stroke="#1a1c22" strokeWidth="0.5" strokeDasharray="4,4" />
        <line x1={cx} y1={cy + ch / 2} x2={cx + cw} y2={cy + ch / 2} stroke="#1a1c22" strokeWidth="0.5" strokeDasharray="4,4" />
        <text x={cx + cw / 2} y={cy + ch / 2 + 3} fill="#222" fontSize="10" fontFamily={mono} textAnchor="middle" fontWeight="700">SOFTWARE</text>

        {/* Centering values */}
        <text x={cx + cw / 2} y={cy - 8} fill="#888" fontSize="8.5" fontFamily={mono} textAnchor="middle">C: {centering.tbRatio}</text>
        <text x={cx + cw / 2} y={cy + ch + 16} fill="#888" fontSize="8.5" fontFamily={mono} textAnchor="middle">C: {Math.round((100 - centering.tbRatio) * 10) / 10}</text>
        <text x={cx - 10} y={cy + ch / 2 + 3} fill="#888" fontSize="8.5" fontFamily={mono} textAnchor="end">C: {centering.lrRatio}</text>
        <text x={cx + cw + 10} y={cy + ch / 2 + 3} fill="#888" fontSize="8.5" fontFamily={mono} textAnchor="start">C: {Math.round((100 - centering.lrRatio) * 10) / 10}</text>

        {/* Corner indicators */}
        {[{ n: "TOP LEFT", x: cx, y: cy }, { n: "TOP RIGHT", x: cx + cw, y: cy }, { n: "BOTTOM LEFT", x: cx, y: cy + ch }, { n: "BOTTOM RIGHT", x: cx + cw, y: cy + ch }].map(({ n, x, y }) => {
          const data = getCorner(n);
          return (
            <rect key={n} x={x - 7} y={y - 7} width={14} height={14} rx={3} fill="none"
              stroke={data.hasDing ? dingColor : cleanColor} strokeWidth={data.hasDing ? 2.5 : 1} strokeDasharray={data.hasDing ? "none" : "3,3"} />
          );
        })}

        {/* Edge indicators */}
        {[{ n: "TOP", x1: cx + 30, y1: cy, x2: cx + cw - 30, y2: cy }, { n: "BOTTOM", x1: cx + 30, y1: cy + ch, x2: cx + cw - 30, y2: cy + ch }, { n: "LEFT", x1: cx, y1: cy + 30, x2: cx, y2: cy + ch - 30 }, { n: "RIGHT", x1: cx + cw, y1: cy + 30, x2: cx + cw, y2: cy + ch - 30 }].map(({ n, x1, y1, x2, y2 }) => {
          const data = getEdge(n);
          return (<line key={n} x1={x1} y1={y1} x2={x2} y2={y2} stroke={data.hasDing ? dingColor : cleanColor} strokeWidth={data.hasDing ? 3 : 1.5} />);
        })}

        {/* Score labels */}
        <CornerScore x={45} y={cy + ch + 40} data={getCorner("TOP LEFT")} align="start" />
        <CornerScore x={315} y={cy + ch + 40} data={getCorner("TOP RIGHT")} align="end" />
        <EdgeScore x={180} y={cy + ch + 40} data={getEdge("TOP")} align="middle" />
        <EdgeScore x={45} y={cy + ch + 72} data={getEdge("LEFT")} align="start" />
        <EdgeScore x={315} y={cy + ch + 72} data={getEdge("RIGHT")} align="end" />
        <EdgeScore x={180} y={cy + ch + 72} data={getEdge("BOTTOM")} align="middle" />
        <CornerScore x={45} y={cy + ch + 104} data={getCorner("BOTTOM LEFT")} align="start" />
        <CornerScore x={315} y={cy + ch + 104} data={getCorner("BOTTOM RIGHT")} align="end" />

        <line x1="30" y1={cy + ch + 126} x2="330" y2={cy + ch + 126} stroke="#1a1c22" strokeWidth="0.5" />
        <text x="180" y={cy + ch + 142} fill="#444" fontSize="9" fontFamily={mono} textAnchor="middle">{sideLabel}</text>
      </svg>
    </div>
  );
}

/**
 * Main DingsTabV2 Component
 */
export function DingsTabV2({
  gradeMode,           // 'software' | 'ai' | 'deep'
  gradeResult,         // Software grade result (gr)
  frontResult,         // Software front analysis (fR)
  backResult,          // Software back analysis (bR)
  frontImage,          // Cropped front image
  backImage,           // Cropped back image
  deepAiData,          // Deep AI V3 data: { defects, areaScores, ... }
  aiCondition,         // Standard AI condition (for fallback)
  frontCenteringData,  // Manual/software centering for front (ALWAYS used)
  backCenteringData,   // Manual/software centering for back (ALWAYS used)
  ignoreCentering,     // If true, don't add centering dings
}) {
  // Calculate centering dings from SOFTWARE/MANUAL data (never AI)
  // This is separate from physical defects - centering always comes from our measurement
  const centeringDings = ignoreCentering ? [] : calculateCenteringDings(
    frontCenteringData || frontResult?.centering,
    backCenteringData || backResult?.centering
  );

  // Determine which data source to use for PHYSICAL defects
  const isDeepMode = gradeMode === 'deep' && deepAiData?.defects;
  const isAiMode = gradeMode === 'ai' && aiCondition?.defects;
  const isSoftwareMode = gradeMode === 'software' || (!isDeepMode && !isAiMode);

  // Get physical dings data based on mode
  const getPhysicalDingsData = () => {
    if (isDeepMode) {
      return {
        physicalDings: deepAiData.defects || [],
        source: 'Deep AI',
        color: '#f97316',
      };
    }
    if (isAiMode) {
      // Convert AI condition defects to dings format
      const defects = aiCondition.defects || [];
      return {
        physicalDings: defects.map((d, i) => ({
          type: typeof d === 'string' ? 'DEFECT' : d.type,
          location: typeof d === 'string' ? d : d.location,
          severity: typeof d === 'string' ? 'minor' : d.severity,
          description: typeof d === 'string' ? d : d.description,
          side: 'UNKNOWN',
        })),
        source: 'AI',
        color: '#8b5cf6',
      };
    }
    // Software mode - filter out centering from allDings since we handle it separately
    const softwareDings = (gradeResult?.allDings || []).filter(d => d.type !== 'CENTERING');
    return {
      physicalDings: softwareDings,
      source: 'Software',
      color: '#00ff88',
    };
  };

  const physicalData = getPhysicalDingsData();

  // Merge physical dings + centering dings for total count
  const allDings = [...physicalData.physicalDings, ...centeringDings];
  const totalDings = allDings.length;

  // For display purposes
  const dingsData = {
    totalDings,
    allDings,
    physicalDings: physicalData.physicalDings,
    centeringDings,
    source: physicalData.source,
    color: physicalData.color,
  };

  return (
    <div style={{ flex: 1, padding: 16, overflowY: 'auto' }}>
      {/* Mode indicator */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 12,
        padding: '8px 12px',
        background: '#0d0f13',
        borderRadius: 8,
        border: `1px solid ${dingsData.color}33`,
      }}>
        <span style={{ fontFamily: mono, fontSize: 10, color: '#888' }}>
          DINGS SOURCE
        </span>
        <span style={{
          fontFamily: mono,
          fontSize: 11,
          fontWeight: 600,
          color: dingsData.color,
          textTransform: 'uppercase',
        }}>
          {dingsData.source}
        </span>
      </div>

      {/* DINGS Count */}
      <div style={{
        textAlign: 'center',
        padding: 16,
        marginBottom: 12,
        background: '#0d0f13',
        borderRadius: 10,
        border: '1px solid #1a1c22',
      }}>
        <div style={{
          fontFamily: mono,
          fontSize: 9,
          color: '#555',
          textTransform: 'uppercase',
          letterSpacing: '.12em',
          marginBottom: 4,
        }}>
          Defects Identified of Notable Grade Significance
        </div>
        <div style={{
          fontFamily: mono,
          fontSize: 36,
          fontWeight: 800,
          color: dingsData.totalDings === 0 ? '#00ff88' :
            dingsData.totalDings <= 2 ? '#66dd44' :
              dingsData.totalDings <= 4 ? '#ffcc00' : '#ff6633',
        }}>
          {dingsData.totalDings}
        </div>
        <div style={{ fontFamily: mono, fontSize: 10, color: '#444' }}>DINGS</div>
      </div>

      {/* DEFECT MAP - switches based on mode */}
      <div style={{ marginBottom: 16 }}>
        <div style={{
          fontFamily: mono,
          fontSize: 10,
          color: '#555',
          textTransform: 'uppercase',
          marginBottom: 8,
        }}>
          Defect Map
        </div>

        {isDeepMode ? (
          // Deep AI coordinate-based map
          <DeepAiDingsMap
            frontImage={frontImage}
            backImage={backImage}
            defects={deepAiData.defects}
            areaScores={deepAiData.areaScores}
            showScores={true}
          />
        ) : (
          // Software pixel-based map
          <SoftwareDingsMap
            frontResult={frontResult}
            backResult={backResult}
          />
        )}
      </div>

      {/* Corners/Edges Detail - Only for software mode */}
      {isSoftwareMode && frontResult && backResult && (
        <>
          {/* CORNERS DETAIL */}
          <div style={{
            marginBottom: 16,
            padding: 14,
            background: '#0d0f13',
            borderRadius: 10,
            border: '1px solid #1a1c22',
          }}>
            <div style={{
              fontFamily: mono,
              fontSize: 10,
              color: '#888',
              textTransform: 'uppercase',
              marginBottom: 10,
            }}>
              Corners (Software)
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {[['Front', frontResult], ['Back', backResult]].map(([side, r]) => (
                <div key={side}>
                  <div style={{ fontFamily: mono, fontSize: 8, color: '#666', marginBottom: 6 }}>{side}</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
                    {r.corners?.details?.map(c => (
                      <div key={c.name} style={{
                        padding: 6,
                        background: 'rgba(0,0,0,.3)',
                        borderRadius: 4,
                        borderLeft: `2px solid ${c.hasDing ? '#ff6633' : '#333'}`,
                      }}>
                        <div style={{ fontFamily: mono, fontSize: 9, color: c.hasDing ? '#ff9944' : '#777' }}>{c.name}</div>
                        <div style={{ fontFamily: mono, fontSize: 8, color: '#555' }}>F:{c.fray} W:{c.whiteRatio}%</div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* EDGES DETAIL */}
          <div style={{
            marginBottom: 16,
            padding: 14,
            background: '#0d0f13',
            borderRadius: 10,
            border: '1px solid #1a1c22',
          }}>
            <div style={{
              fontFamily: mono,
              fontSize: 10,
              color: '#888',
              textTransform: 'uppercase',
              marginBottom: 10,
            }}>
              Edges (Software)
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {[['Front', frontResult], ['Back', backResult]].map(([side, r]) => (
                <div key={side}>
                  <div style={{ fontFamily: mono, fontSize: 8, color: '#666', marginBottom: 6 }}>{side}</div>
                  {r.edges?.details?.map(e => (
                    <div key={e.name} style={{
                      padding: 6,
                      marginBottom: 4,
                      background: 'rgba(0,0,0,.3)',
                      borderRadius: 4,
                      borderLeft: `2px solid ${e.hasDing ? '#ff6633' : '#333'}`,
                    }}>
                      <div style={{ fontFamily: mono, fontSize: 9, color: e.hasDing ? '#ff9944' : '#777' }}>{e.name}</div>
                      <div style={{ fontFamily: mono, fontSize: 8, color: '#555' }}>F:{e.fray} W:{e.whiteRatio}%</div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Area Scores - Only for Deep AI mode */}
      {isDeepMode && deepAiData.areaScores && (
        <div style={{
          marginBottom: 16,
          padding: 14,
          background: '#0d0f13',
          borderRadius: 10,
          border: '1px solid #f9731633',
        }}>
          <div style={{
            fontFamily: mono,
            fontSize: 10,
            color: '#f97316',
            textTransform: 'uppercase',
            marginBottom: 10,
          }}>
            TAG 1000-Point Area Scores (Deep AI)
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {['front', 'back'].map(side => {
              // Detect if using 1000-point scale (any score > 200)
              const scores = deepAiData.areaScores[side] || {};
              const allScores = [
                scores.centering,
                scores.surface,
                ...Object.values(scores.corners || {}),
                ...Object.values(scores.edges || {}),
              ].filter(s => typeof s === 'number');
              const is1000Scale = allScores.some(s => s > 200);

              // Color thresholds based on scale
              const getScoreColor = (v) => {
                if (is1000Scale) {
                  return v >= 950 ? '#00ff88' : v >= 900 ? '#66dd44' : v >= 800 ? '#ffcc00' : '#ff6633';
                } else {
                  return v >= 115 ? '#00ff88' : v >= 100 ? '#ffcc00' : '#ff6633';
                }
              };

              return (
                <div key={side}>
                  <div style={{
                    fontFamily: mono,
                    fontSize: 9,
                    color: '#888',
                    textTransform: 'uppercase',
                    marginBottom: 6,
                  }}>
                    {side}
                  </div>
                  {scores && (
                    <div style={{ fontSize: 10, fontFamily: mono }}>
                      <div style={{ color: '#666', marginBottom: 4 }}>
                        Centering: <span style={{ color: getScoreColor(scores.centering || 1000) }}>{scores.centering || 1000}</span>
                      </div>
                      <div style={{ color: '#666', marginBottom: 4 }}>
                        Surface: <span style={{ color: getScoreColor(scores.surface || 1000) }}>{scores.surface || 1000}</span>
                      </div>
                      {scores.corners && (
                        <div style={{ color: '#666', marginBottom: 2 }}>
                          Corners: {Object.entries(scores.corners).map(([k, v]) =>
                            <span key={k} style={{ color: getScoreColor(v), marginRight: 6 }}>
                              {k}:{v}
                            </span>
                          )}
                        </div>
                      )}
                      {scores.edges && (
                        <div style={{ color: '#666' }}>
                          Edges: {Object.entries(scores.edges).map(([k, v]) =>
                            <span key={k} style={{ color: getScoreColor(v), marginRight: 6 }}>
                              {k}:{v}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* CENTERING DINGS - Always from software/manual measurement */}
      {dingsData.centeringDings.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div style={{
            fontFamily: mono,
            fontSize: 10,
            color: '#ff9944',
            textTransform: 'uppercase',
            marginBottom: 8,
          }}>
            Centering Issues (Software Measurement)
          </div>
          {dingsData.centeringDings.map((d, i) => (
            <div key={`centering-${i}`} style={{
              padding: '10px 12px',
              marginBottom: 6,
              background: 'rgba(255,153,68,0.05)',
              borderRadius: 8,
              border: '1px solid rgba(255,153,68,0.2)',
              borderLeft: '3px solid #ff9944',
            }}>
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 4,
              }}>
                <span style={{
                  fontFamily: mono,
                  fontSize: 11,
                  color: '#ff9944',
                  fontWeight: 600,
                }}>
                  {d.side} CENTERING
                </span>
                <span style={{
                  fontFamily: mono,
                  fontSize: 9,
                  padding: '2px 6px',
                  borderRadius: 4,
                  background: d.severity === 'severe' ? '#ff444433' : d.severity === 'moderate' ? '#ff994433' : '#ffcc0033',
                  color: d.severity === 'severe' ? '#ff4444' : d.severity === 'moderate' ? '#ff9944' : '#ffcc00',
                  textTransform: 'uppercase',
                }}>
                  {d.severity}
                </span>
              </div>
              <div style={{ fontFamily: sans, fontSize: 12, color: '#888', marginBottom: 4 }}>
                {d.description}
              </div>
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontFamily: mono,
                fontSize: 10,
              }}>
                <span style={{ color: '#666' }}>
                  Deviation: {d.deviationPct?.toFixed(1)}%
                </span>
                <span style={{ color: d.score >= 950 ? '#00ff88' : d.score >= 900 ? '#ffcc00' : '#ff6633' }}>
                  Score: {d.score}/1000 ({d.pointDeduction > 0 ? `-${d.pointDeduction}` : '0'})
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* PHYSICAL DEFECT LIST */}
      {dingsData.physicalDings.length > 0 ? (
        <div style={{ marginBottom: 14 }}>
          <div style={{
            fontFamily: mono,
            fontSize: 10,
            color: '#555',
            textTransform: 'uppercase',
            marginBottom: 8,
          }}>
            Physical Defects ({dingsData.source})
          </div>
          {dingsData.physicalDings.map((d, i) => (
            <div key={i} style={{
              padding: '10px 12px',
              marginBottom: 6,
              background: '#0d0f13',
              borderRadius: 8,
              border: '1px solid #1a1c22',
              borderLeft: `3px solid ${dingsData.color}`,
            }}>
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 4,
              }}>
                <span style={{
                  fontFamily: mono,
                  fontSize: 11,
                  color: dingsData.color,
                  fontWeight: 600,
                }}>
                  {d.location || d.position || 'Unknown'}
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
              {(d.desc || d.description) && (
                <div style={{ fontFamily: sans, fontSize: 12, color: '#888' }}>
                  {d.desc || d.description}
                </div>
              )}
            </div>
          ))}
        </div>
      ) : dingsData.centeringDings.length === 0 ? (
        <div style={{
          padding: 16,
          background: 'rgba(0,255,136,.05)',
          borderRadius: 8,
          border: '1px solid rgba(0,255,136,.15)',
          marginBottom: 14,
        }}>
          <div style={{ fontFamily: mono, fontSize: 12, color: '#00ff88' }}>
            No DINGS detected — potential Gem Mint candidate
          </div>
        </div>
      ) : (
        <div style={{
          padding: 12,
          background: '#0d0f13',
          borderRadius: 8,
          border: '1px solid #1a1c22',
          marginBottom: 14,
        }}>
          <div style={{ fontFamily: mono, fontSize: 11, color: '#666' }}>
            No physical defects detected (centering only)
          </div>
        </div>
      )}

      {/* TOTAL DINGS SUMMARY */}
      {dingsData.totalDings > 0 && (
        <div style={{
          padding: 12,
          background: '#0a0b0e',
          borderRadius: 8,
          border: '1px solid #1a1c22',
        }}>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}>
            <span style={{ fontFamily: mono, fontSize: 10, color: '#666' }}>
              TOTAL DINGS
            </span>
            <span style={{
              fontFamily: mono,
              fontSize: 14,
              fontWeight: 700,
              color: dingsData.totalDings <= 1 ? '#00ff88' : dingsData.totalDings <= 3 ? '#ffcc00' : '#ff6633',
            }}>
              {dingsData.physicalDings.length} physical + {dingsData.centeringDings.length} centering = {dingsData.totalDings}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

export default DingsTabV2;
