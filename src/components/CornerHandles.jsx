/**
 * CornerHandles Component
 *
 * Renders 8 draggable corner handles (4 outer + 4 inner) for corner-anchored
 * centering measurement. Each corner can be dragged independently.
 */

import React, { useRef, useEffect } from 'react';
import { getSamplePoints, calculateCornerCentering } from '../lib/corner-measurement.js';

const mono = '"SF Mono", Monaco, "Fira Code", monospace';

/**
 * Main CornerHandles SVG overlay component
 */
export function CornerHandles({
  imgW,
  imgH,
  outerCorners,
  innerCorners,
  setOuterCorners,
  setInnerCorners,
  svgRef,
  onCenteringUpdate
}) {
  const dragging = useRef(null);
  const outerRef = useRef(outerCorners);
  const innerRef = useRef(innerCorners);

  useEffect(() => { outerRef.current = outerCorners; }, [outerCorners]);
  useEffect(() => { innerRef.current = innerCorners; }, [innerCorners]);

  // Recalculate centering whenever corners change
  useEffect(() => {
    if (onCenteringUpdate) {
      const result = calculateCornerCentering(outerCorners, innerCorners);
      onCenteringUpdate(result);
    }
  }, [outerCorners, innerCorners, onCenteringUpdate]);

  const getCoords = (e) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    return {
      x: Math.round((e.clientX - rect.left) / rect.width * imgW),
      y: Math.round((e.clientY - rect.top) / rect.height * imgH),
    };
  };

  const moveCorner = (which, x, y) => {
    const o = outerRef.current;
    const inn = innerRef.current;
    const minGap = 20; // Minimum gap between outer and inner corners

    if (which === 'O_TL') {
      setOuterCorners(p => ({
        ...p,
        tl: {
          x: Math.max(0, Math.min(x, inn.tl.x - minGap)),
          y: Math.max(0, Math.min(y, inn.tl.y - minGap))
        }
      }));
    } else if (which === 'O_TR') {
      setOuterCorners(p => ({
        ...p,
        tr: {
          x: Math.min(imgW, Math.max(x, inn.tr.x + minGap)),
          y: Math.max(0, Math.min(y, inn.tr.y - minGap))
        }
      }));
    } else if (which === 'O_BL') {
      setOuterCorners(p => ({
        ...p,
        bl: {
          x: Math.max(0, Math.min(x, inn.bl.x - minGap)),
          y: Math.min(imgH, Math.max(y, inn.bl.y + minGap))
        }
      }));
    } else if (which === 'O_BR') {
      setOuterCorners(p => ({
        ...p,
        br: {
          x: Math.min(imgW, Math.max(x, inn.br.x + minGap)),
          y: Math.min(imgH, Math.max(y, inn.br.y + minGap))
        }
      }));
    } else if (which === 'I_TL') {
      setInnerCorners(p => ({
        ...p,
        tl: {
          x: Math.max(o.tl.x + minGap, Math.min(x, p.tr.x - minGap)),
          y: Math.max(o.tl.y + minGap, Math.min(y, p.bl.y - minGap))
        }
      }));
    } else if (which === 'I_TR') {
      setInnerCorners(p => ({
        ...p,
        tr: {
          x: Math.min(o.tr.x - minGap, Math.max(x, p.tl.x + minGap)),
          y: Math.max(o.tr.y + minGap, Math.min(y, p.br.y - minGap))
        }
      }));
    } else if (which === 'I_BL') {
      setInnerCorners(p => ({
        ...p,
        bl: {
          x: Math.max(o.bl.x + minGap, Math.min(x, p.br.x - minGap)),
          y: Math.min(o.bl.y - minGap, Math.max(y, p.tl.y + minGap))
        }
      }));
    } else if (which === 'I_BR') {
      setInnerCorners(p => ({
        ...p,
        br: {
          x: Math.min(o.br.x - minGap, Math.max(x, p.bl.x + minGap)),
          y: Math.min(o.br.y - minGap, Math.max(y, p.tr.y + minGap))
        }
      }));
    }
  };

  // Visual parameters
  const cW = outerCorners.br.x - outerCorners.tl.x;
  const cH = outerCorners.br.y - outerCorners.tl.y;
  const handleSize = Math.max(32, Math.min(cW, cH) * 0.04);
  const lw = Math.max(2, cW * 0.004);
  const pad = 50; // Touch target padding

  // Get sample points for visualization
  const samplePoints = getSamplePoints(outerCorners, innerCorners);

  // Define all 8 corner handles
  const handles = [
    // Outer corners (cyan)
    { x: outerCorners.tl.x, y: outerCorners.tl.y, which: 'O_TL', isOuter: true, label: '↖' },
    { x: outerCorners.tr.x, y: outerCorners.tr.y, which: 'O_TR', isOuter: true, label: '↗' },
    { x: outerCorners.bl.x, y: outerCorners.bl.y, which: 'O_BL', isOuter: true, label: '↙' },
    { x: outerCorners.br.x, y: outerCorners.br.y, which: 'O_BR', isOuter: true, label: '↘' },
    // Inner corners (magenta)
    { x: innerCorners.tl.x, y: innerCorners.tl.y, which: 'I_TL', isOuter: false, label: '↘' },
    { x: innerCorners.tr.x, y: innerCorners.tr.y, which: 'I_TR', isOuter: false, label: '↙' },
    { x: innerCorners.bl.x, y: innerCorners.bl.y, which: 'I_BL', isOuter: false, label: '↗' },
    { x: innerCorners.br.x, y: innerCorners.br.y, which: 'I_BR', isOuter: false, label: '↖' },
  ];

  return (
    <>
      {/* Outer boundary polygon */}
      <polygon
        points={`${outerCorners.tl.x},${outerCorners.tl.y} ${outerCorners.tr.x},${outerCorners.tr.y} ${outerCorners.br.x},${outerCorners.br.y} ${outerCorners.bl.x},${outerCorners.bl.y}`}
        fill="none"
        stroke="#00bcd4"
        strokeWidth={lw}
        opacity={0.85}
      />

      {/* Inner boundary polygon */}
      <polygon
        points={`${innerCorners.tl.x},${innerCorners.tl.y} ${innerCorners.tr.x},${innerCorners.tr.y} ${innerCorners.br.x},${innerCorners.br.y} ${innerCorners.bl.x},${innerCorners.bl.y}`}
        fill="none"
        stroke="#e91e63"
        strokeWidth={Math.max(2, lw * 0.8)}
        strokeDasharray={`${cW * 0.02},${cW * 0.01}`}
        opacity={0.85}
      />

      {/* Sample point indicators along each edge */}
      {Object.entries(samplePoints).map(([edge, points]) =>
        points.map((pt, idx) => (
          <g key={`${edge}-${idx}`}>
            {/* Line connecting outer to inner sample point */}
            <line
              x1={pt.outer.x}
              y1={pt.outer.y}
              x2={pt.inner.x}
              y2={pt.inner.y}
              stroke="#ffffff"
              strokeWidth={1}
              opacity={0.3}
              strokeDasharray="4,4"
            />
            {/* Outer sample dot */}
            <circle
              cx={pt.outer.x}
              cy={pt.outer.y}
              r={4}
              fill="#00bcd4"
              opacity={0.7}
            />
            {/* Inner sample dot */}
            <circle
              cx={pt.inner.x}
              cy={pt.inner.y}
              r={4}
              fill="#e91e63"
              opacity={0.7}
            />
          </g>
        ))
      )}

      {/* 8 corner drag handles */}
      {handles.map(({ x, y, which, isOuter, label }) => {
        const color = isOuter ? '#00bcd4' : '#e91e63';
        const bgColor = '#111';
        const sz = handleSize;
        const fontSize = sz * 0.55;

        return (
          <g
            key={which}
            style={{ cursor: 'move', touchAction: 'none' }}
            onPointerDown={e => {
              e.stopPropagation();
              e.currentTarget.setPointerCapture(e.pointerId);
              dragging.current = which;
            }}
            onPointerMove={e => {
              if (dragging.current === which) {
                e.preventDefault();
                const { x: newX, y: newY } = getCoords(e);
                moveCorner(which, newX, newY);
              }
            }}
            onPointerUp={() => { dragging.current = null; }}
          >
            {/* Invisible large touch target */}
            <rect
              x={x - sz / 2 - pad}
              y={y - sz / 2 - pad}
              width={sz + pad * 2}
              height={sz + pad * 2}
              fill="transparent"
            />
            {/* Circle body with colored border */}
            <circle
              cx={x}
              cy={y}
              r={sz / 2}
              fill={bgColor}
              stroke={color}
              strokeWidth={Math.max(2, lw * 0.8)}
            />
            {/* Arrow indicator */}
            <text
              x={x}
              y={y}
              textAnchor="middle"
              dominantBaseline="central"
              fill={color}
              fontSize={fontSize}
              fontWeight="bold"
              style={{ pointerEvents: 'none' }}
            >
              {label}
            </text>
          </g>
        );
      })}
    </>
  );
}

/**
 * Edge breakdown panel showing per-edge sample data
 */
export function EdgeBreakdownPanel({ centeringResult }) {
  if (!centeringResult) return null;

  const { edges, centering, overallConfidence, lowConfidenceEdges } = centeringResult;

  const getConfidenceColor = (conf) => {
    if (conf === 'high') return '#00ff88';
    if (conf === 'medium') return '#ffcc00';
    return '#ff6633';
  };

  const getConfidenceIcon = (conf) => {
    if (conf === 'high') return '✓';
    if (conf === 'medium') return '~';
    return '⚠';
  };

  const EdgeRow = ({ label, data }) => (
    <div style={{
      padding: '8px 12px',
      borderBottom: '1px solid #1a1c22',
      background: data.confidence === 'low' ? 'rgba(255,102,51,0.05)' : 'transparent'
    }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 4
      }}>
        <span style={{
          fontFamily: mono,
          fontSize: 10,
          color: '#888',
          textTransform: 'uppercase'
        }}>
          {label}
        </span>
        <span style={{
          fontFamily: mono,
          fontSize: 10,
          color: getConfidenceColor(data.confidence)
        }}>
          {getConfidenceIcon(data.confidence)} {data.confidence}
        </span>
      </div>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline'
      }}>
        <span style={{
          fontFamily: mono,
          fontSize: 8,
          color: '#555'
        }}>
          Samples: {data.samples.join(', ')}px
        </span>
        <span style={{
          fontFamily: mono,
          fontSize: 12,
          fontWeight: 700,
          color: '#fff'
        }}>
          {data.median}px
        </span>
      </div>
      <div style={{
        fontFamily: mono,
        fontSize: 8,
        color: '#444',
        marginTop: 2
      }}>
        StDev: {data.stdev} | CV: {(data.coefficientOfVariation * 100).toFixed(1)}%
      </div>
    </div>
  );

  return (
    <div style={{
      background: '#0a0b0e',
      borderRadius: 8,
      border: '1px solid #1a1c22',
      marginTop: 8
    }}>
      <div style={{
        padding: '8px 12px',
        borderBottom: '1px solid #1a1c22',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }}>
        <span style={{
          fontFamily: mono,
          fontSize: 9,
          color: '#666',
          textTransform: 'uppercase'
        }}>
          Per-Edge Breakdown (5-Sample Median)
        </span>
        <span style={{
          fontFamily: mono,
          fontSize: 10,
          color: getConfidenceColor(overallConfidence),
          fontWeight: 600
        }}>
          Overall: {overallConfidence.toUpperCase()}
          {lowConfidenceEdges > 0 && ` (${lowConfidenceEdges} edge${lowConfidenceEdges > 1 ? 's' : ''} low)`}
        </span>
      </div>

      <EdgeRow label="Top Border" data={edges.top} />
      <EdgeRow label="Bottom Border" data={edges.bottom} />
      <EdgeRow label="Left Border" data={edges.left} />
      <EdgeRow label="Right Border" data={edges.right} />

      {/* Final centering ratios */}
      <div style={{
        padding: '12px',
        background: 'rgba(0,0,0,0.3)',
        display: 'flex',
        justifyContent: 'space-around'
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{
            fontFamily: mono,
            fontSize: 8,
            color: '#555',
            textTransform: 'uppercase',
            marginBottom: 2
          }}>
            Horizontal (L/R)
          </div>
          <div style={{
            fontFamily: mono,
            fontSize: 16,
            fontWeight: 700,
            color: Math.max(centering.horizontal, 100 - centering.horizontal) > 55 ? '#ff6633' : '#00ff88'
          }}>
            {centering.lrDisplay}
          </div>
        </div>
        <div style={{ width: 1, background: '#1a1c22' }} />
        <div style={{ textAlign: 'center' }}>
          <div style={{
            fontFamily: mono,
            fontSize: 8,
            color: '#555',
            textTransform: 'uppercase',
            marginBottom: 2
          }}>
            Vertical (T/B)
          </div>
          <div style={{
            fontFamily: mono,
            fontSize: 16,
            fontWeight: 700,
            color: Math.max(centering.vertical, 100 - centering.vertical) > 55 ? '#ff6633' : '#00ff88'
          }}>
            {centering.tbDisplay}
          </div>
        </div>
      </div>
    </div>
  );
}

export default CornerHandles;
