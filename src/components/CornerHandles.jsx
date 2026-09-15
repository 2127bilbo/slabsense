/**
 * CornerHandles Component
 *
 * Renders 8 draggable corner handles (4 outer + 4 inner) for corner-anchored
 * centering measurement. Each corner can be dragged independently.
 */

import React, { useRef, useEffect } from 'react';
import { getSamplePoints, calculateCornerCentering } from '../lib/corner-measurement.js';
import { haloFor } from '../lib/line-color.js';

const mono = '"SF Mono", Monaco, "Fira Code", monospace';

/**
 * Generate SVG path for a rounded quadrilateral
 * @param {object} corners - { tl, tr, br, bl } each with { x, y }
 * @param {number} radius - Corner radius in pixels
 * @returns {string} SVG path d attribute
 */
/**
 * Offset a quadrilateral's edges by `d` (positive = outward) and return the new corners
 * (intersections of the shifted edge lines). Used so a stroke can be drawn with its INSIDE
 * edge (outer card line) or OUTSIDE edge (inner art line) exactly on the measured coordinate.
 */
export function offsetQuad(corners, d) {
  if (!d) return corners;
  const order = ['tl', 'tr', 'br', 'bl'];
  const pts = order.map((k) => corners[k]);
  // Edge i goes from pts[i] to pts[(i+1)%4]; outward normal for a clockwise (screen-space) quad
  const lines = pts.map((p, i) => {
    const q = pts[(i + 1) % 4];
    const dx = q.x - p.x, dy = q.y - p.y, len = Math.hypot(dx, dy) || 1;
    const nx = dy / len, ny = -dx / len;             // outward normal for tl→tr→br→bl order in y-down screen space
    return { p: { x: p.x + nx * d, y: p.y + ny * d }, q: { x: q.x + nx * d, y: q.y + ny * d } };
  });
  const intersect = (a, b) => {
    const x1 = a.p.x, y1 = a.p.y, x2 = a.q.x, y2 = a.q.y, x3 = b.p.x, y3 = b.p.y, x4 = b.q.x, y4 = b.q.y;
    const den = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
    if (Math.abs(den) < 1e-9) return a.q;
    const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / den;
    return { x: x1 + t * (x2 - x1), y: y1 + t * (y2 - y1) };
  };
  const out = {};
  order.forEach((k, i) => { out[k] = intersect(lines[(i + 3) % 4], lines[i]); }); // corner i = prev edge ∩ this edge
  return out;
}

/**
 * Rounded quadrilateral path with TRUE circular arcs of `radius` at each corner (a real card
 * corner is a circle; a quadratic curve through the corner point is noticeably sharper).
 */
function getRoundedQuadPath(corners, radius) {
  const order = ['tl', 'tr', 'br', 'bl'];
  const pts = order.map((k) => corners[k]);
  const segs = pts.map((c, i) => {
    const prev = pts[(i + 3) % 4], next = pts[(i + 1) % 4];
    const v1 = { x: prev.x - c.x, y: prev.y - c.y }, v2 = { x: next.x - c.x, y: next.y - c.y };
    const l1 = Math.hypot(v1.x, v1.y) || 1, l2 = Math.hypot(v2.x, v2.y) || 1;
    const cosT = Math.max(-0.999, Math.min(0.999, (v1.x * v2.x + v1.y * v2.y) / (l1 * l2)));
    const theta = Math.acos(cosT);                                     // interior angle
    const r = Math.min(radius, 0.4 * Math.min(l1, l2) * Math.tan(theta / 2));
    const t = r / Math.tan(theta / 2);                                 // tangent length along each edge
    return {
      r,
      a: { x: c.x + (v1.x / l1) * t, y: c.y + (v1.y / l1) * t },     // arc start (on the edge toward prev)
      b: { x: c.x + (v2.x / l2) * t, y: c.y + (v2.y / l2) * t },     // arc end   (on the edge toward next)
    };
  });
  let d = `M ${segs[0].b.x} ${segs[0].b.y}`;
  for (let i = 1; i <= 4; i++) {
    const s = segs[i % 4];
    d += ` L ${s.a.x} ${s.a.y} A ${s.r} ${s.r} 0 0 1 ${s.b.x} ${s.b.y}`;
  }
  return d + ' Z';
}

/**
 * Main CornerHandles SVG overlay component
 * @param {string} activeHandles - 'all' | 'outer' | 'inner' - which handles to show/enable
 */
export function CornerHandles({
  imgW,
  imgH,
  outerCorners,
  innerCorners,
  setOuterCorners,
  setInnerCorners,
  svgRef,
  onCenteringUpdate,
  activeHandles = 'all',  // 'all', 'outer', or 'inner'
  zoom = 1,               // stage zoom; handle sizes shrink by it so they stay finger-sized
  onHandleDrag = null,    // (pointOrNull, event) → loupe hook: corner position while dragging
  outerColor = '#00bcd4', // card-edge line colour
  innerColor = '#e91e63', // artwork line colour
  halo = false,           // contrasting band on the far side of each line
}) {
  const dragging = useRef(null);
  const dragOffset = useRef({ x: 0, y: 0 }); // Offset from touch point to actual corner
  const outerRef = useRef(outerCorners);
  const innerRef = useRef(innerCorners);

  useEffect(() => { outerRef.current = outerCorners; }, [outerCorners]);
  useEffect(() => { innerRef.current = innerCorners; }, [innerCorners]);

  // Recalculate centering whenever corners change (only if both are available)
  useEffect(() => {
    if (onCenteringUpdate && outerCorners && innerCorners) {
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

  // Get the actual corner position for a given handle
  const getCornerPosition = (which) => {
    const o = outerRef.current;
    const inn = innerRef.current;
    if (which === 'O_TL') return o.tl;
    if (which === 'O_TR') return o.tr;
    if (which === 'O_BL') return o.bl;
    if (which === 'O_BR') return o.br;
    if (which === 'I_TL') return inn.tl;
    if (which === 'I_TR') return inn.tr;
    if (which === 'I_BL') return inn.bl;
    if (which === 'I_BR') return inn.br;
    return { x: 0, y: 0 };
  };

  // Start drag - calculate offset from touch point to actual corner
  const startDrag = (which, e) => {
    const touchPos = getCoords(e);
    const cornerPos = getCornerPosition(which);
    dragOffset.current = {
      x: cornerPos.x - touchPos.x,
      y: cornerPos.y - touchPos.y
    };
    dragging.current = which;
  };

  const moveCorner = (which, x, y) => {
    // Apply the offset so corner follows the handle, not the finger
    const adjustedX = x + dragOffset.current.x;
    const adjustedY = y + dragOffset.current.y;

    const o = outerRef.current;
    const inn = innerRef.current;
    const minGap = 20; // Minimum gap between outer and inner corners

    // Outer corners - if no inner corners, just use image bounds
    if (which === 'O_TL') {
      setOuterCorners(p => ({
        ...p,
        tl: {
          x: Math.max(0, Math.min(adjustedX, inn ? inn.tl.x - minGap : imgW - 50)),
          y: Math.max(0, Math.min(adjustedY, inn ? inn.tl.y - minGap : imgH - 50))
        }
      }));
    } else if (which === 'O_TR') {
      setOuterCorners(p => ({
        ...p,
        tr: {
          x: Math.min(imgW, Math.max(adjustedX, inn ? inn.tr.x + minGap : 50)),
          y: Math.max(0, Math.min(adjustedY, inn ? inn.tr.y - minGap : imgH - 50))
        }
      }));
    } else if (which === 'O_BL') {
      setOuterCorners(p => ({
        ...p,
        bl: {
          x: Math.max(0, Math.min(adjustedX, inn ? inn.bl.x - minGap : imgW - 50)),
          y: Math.min(imgH, Math.max(adjustedY, inn ? inn.bl.y + minGap : 50))
        }
      }));
    } else if (which === 'O_BR') {
      setOuterCorners(p => ({
        ...p,
        br: {
          x: Math.min(imgW, Math.max(adjustedX, inn ? inn.br.x + minGap : 50)),
          y: Math.min(imgH, Math.max(adjustedY, inn ? inn.br.y + minGap : 50))
        }
      }));
    } else if (which === 'I_TL') {
      setInnerCorners(p => ({
        ...p,
        tl: {
          x: Math.max(o.tl.x + minGap, Math.min(adjustedX, p.tr.x - minGap)),
          y: Math.max(o.tl.y + minGap, Math.min(adjustedY, p.bl.y - minGap))
        }
      }));
    } else if (which === 'I_TR') {
      setInnerCorners(p => ({
        ...p,
        tr: {
          x: Math.min(o.tr.x - minGap, Math.max(adjustedX, p.tl.x + minGap)),
          y: Math.max(o.tr.y + minGap, Math.min(adjustedY, p.br.y - minGap))
        }
      }));
    } else if (which === 'I_BL') {
      setInnerCorners(p => ({
        ...p,
        bl: {
          x: Math.max(o.bl.x + minGap, Math.min(adjustedX, p.br.x - minGap)),
          y: Math.min(o.bl.y - minGap, Math.max(adjustedY, p.tl.y + minGap))
        }
      }));
    } else if (which === 'I_BR') {
      setInnerCorners(p => ({
        ...p,
        br: {
          x: Math.min(o.br.x - minGap, Math.max(adjustedX, p.bl.x + minGap)),
          y: Math.min(o.br.y - minGap, Math.max(adjustedY, p.tr.y + minGap))
        }
      }));
    }
  };

  // Visual parameters
  const cW = outerCorners.br.x - outerCorners.tl.x;
  const cH = outerCorners.br.y - outerCorners.tl.y;
  const z = Math.max(1, zoom);
  const handleSize = Math.max(32, Math.min(cW, cH) * 0.04) / z;
  // Line weight: thin on screen when zoomed so the exact edge is visible (floor scales with zoom too)
  const lw = Math.max(1.5, cW * 0.004 * (z > 1 ? 0.5 : 1)) / z;
  const pad = 50 / z;   // Touch target padding
  const hw = lw * 4.5;    // halo band width (sits on the far side of the line, never over the edge you align to)
  // Pull handles further from the corner as zoom rises so they never sit on top of the line
  const handleOffset = handleSize * (2.2 + 3 * Math.min(1, (z - 1) / 3));

  // Get sample points for visualization (only if both corners exist)
  const samplePoints = innerCorners ? getSamplePoints(outerCorners, innerCorners) : {};

  // Define corner handles based on activeHandles prop
  // ALL handles positioned INSIDE their respective boundaries for easy reach
  // Outer handles: inside outer boundary, arrows point toward outer corner
  // Inner handles: inside inner boundary, arrows point toward inner corner
  const outerHandlesList = [
    { x: outerCorners.tl.x + handleOffset, y: outerCorners.tl.y + handleOffset, which: 'O_TL', isOuter: true, label: '↖' },
    { x: outerCorners.tr.x - handleOffset, y: outerCorners.tr.y + handleOffset, which: 'O_TR', isOuter: true, label: '↗' },
    { x: outerCorners.bl.x + handleOffset, y: outerCorners.bl.y - handleOffset, which: 'O_BL', isOuter: true, label: '↙' },
    { x: outerCorners.br.x - handleOffset, y: outerCorners.br.y - handleOffset, which: 'O_BR', isOuter: true, label: '↘' },
  ];

  const innerHandlesList = innerCorners ? [
    { x: innerCorners.tl.x + handleOffset, y: innerCorners.tl.y + handleOffset, which: 'I_TL', isOuter: false, label: '↖' },
    { x: innerCorners.tr.x - handleOffset, y: innerCorners.tr.y + handleOffset, which: 'I_TR', isOuter: false, label: '↗' },
    { x: innerCorners.bl.x + handleOffset, y: innerCorners.bl.y - handleOffset, which: 'I_BL', isOuter: false, label: '↙' },
    { x: innerCorners.br.x - handleOffset, y: innerCorners.br.y - handleOffset, which: 'I_BR', isOuter: false, label: '↘' },
  ] : [];

  // Filter handles based on activeHandles prop
  let handles = [];
  if (activeHandles === 'all') {
    handles = [...outerHandlesList, ...innerHandlesList];
  } else if (activeHandles === 'outer') {
    handles = outerHandlesList;
  } else if (activeHandles === 'inner') {
    handles = innerHandlesList;
  }

  // Show outer boundary if activeHandles is 'all' or 'outer'
  const showOuter = activeHandles === 'all' || activeHandles === 'outer';
  // Show inner boundary if innerCorners exists and activeHandles is 'all' or 'inner'
  const showInner = innerCorners && (activeHandles === 'all' || activeHandles === 'inner');
  // Show sample points only when both boundaries are available
  const showSamples = innerCorners && activeHandles === 'all';

  return (
    <>
      {/* Outer boundary - rounded corners (~4.8% of width) */}
      {/* Outer (card edge): the stroke sits OUTSIDE the coordinate, so its INSIDE edge is the
          crop line. Radius grows by half the stroke so the inside edge keeps the card radius. */}
      {showOuter && halo && (
        <path
          d={getRoundedQuadPath(offsetQuad(outerCorners, -hw / 2), Math.max(0, cW * 0.048 - hw / 2))}   /* halo INSIDE the crop coordinate (on the card) */
          fill="none"
          stroke={haloFor(outerColor)}
          strokeWidth={hw}
          opacity={activeHandles === 'inner' ? 0.3 : 1}
        />
      )}
      {showOuter && (
        <path
          d={getRoundedQuadPath(offsetQuad(outerCorners, lw / 2), cW * 0.048 + lw / 2)}
          fill="none"
          stroke={outerColor}
          strokeWidth={lw}
          opacity={activeHandles === 'inner' ? 0.3 : 0.85}
        />
      )}

      {/* Inner (artwork): the stroke sits INSIDE the coordinate, so its OUTSIDE edge is the measured line */}
      {showInner && (() => {
        const ilw = Math.max(1.5 / z, lw * 0.8);
        const q = offsetQuad(innerCorners, -ilw / 2);
        const hq = offsetQuad(innerCorners, hw / 2);   // halo OUTSIDE the measured coordinate (in the border)
        return (<>
          {halo && (
            <polygon
              points={`${hq.tl.x},${hq.tl.y} ${hq.tr.x},${hq.tr.y} ${hq.br.x},${hq.br.y} ${hq.bl.x},${hq.bl.y}`}
              fill="none"
              stroke={haloFor(innerColor)}
              strokeWidth={hw}
            />
          )}
          <polygon
            points={`${q.tl.x},${q.tl.y} ${q.tr.x},${q.tr.y} ${q.br.x},${q.br.y} ${q.bl.x},${q.bl.y}`}
            fill="none"
            stroke={innerColor}
            strokeWidth={ilw}
            strokeDasharray={`${cW * 0.02 / z},${cW * 0.01 / z}`}
            opacity={0.85}
          />
        </>);
      })()}

      {/* Sample point indicators along each edge */}
      {showSamples && Object.entries(samplePoints).map(([edge, points]) =>
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
              fill={outerColor}
              opacity={0.7}
            />
            {/* Inner sample dot */}
            <circle
              cx={pt.inner.x}
              cy={pt.inner.y}
              r={4}
              fill={innerColor}
              opacity={0.7}
            />
          </g>
        ))
      )}

      {/* 8 corner drag handles */}
      {handles.map(({ x, y, which, isOuter, label }) => {
        const color = isOuter ? outerColor : innerColor;
        const bgColor = '#111';
        const sz = handleSize;
        const fontSize = sz * 0.55;

        return (
          <g
            key={which}
            data-handle={which}
            style={{ cursor: 'move', touchAction: 'none' }}
            onPointerDown={e => {
              e.stopPropagation();
              e.currentTarget.setPointerCapture(e.pointerId);
              startDrag(which, e);
              if (onHandleDrag) onHandleDrag({ ...getCornerPosition(which) }, e);
            }}
            onPointerMove={e => {
              if (dragging.current === which) {
                e.preventDefault();
                const { x: newX, y: newY } = getCoords(e);
                moveCorner(which, newX, newY);
                if (onHandleDrag) onHandleDrag({ x: newX + dragOffset.current.x, y: newY + dragOffset.current.y }, e);
              }
            }}
            onPointerUp={(e) => {
              dragging.current = null;
              dragOffset.current = { x: 0, y: 0 };
              if (onHandleDrag) onHandleDrag(null, e);
            }}
            onPointerCancel={(e) => {
              dragging.current = null;
              dragOffset.current = { x: 0, y: 0 };
              if (onHandleDrag) onHandleDrag(null, e);
            }}
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
              strokeWidth={Math.max(1.5 / z, lw * 0.8)}
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
