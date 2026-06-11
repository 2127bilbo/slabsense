import { useState } from 'react';

const mono = "'JetBrains Mono', 'SF Mono', monospace";

/**
 * DefectMap - Schematic SVG view of card with defect indicators
 *
 * Props:
 * - frontResult: Analysis result for front
 * - backResult: Analysis result for back
 * - defects: { front: [], back: [] } - Processed defects
 * - centering: { front: { lrRatio, tbRatio }, back: { lrRatio, tbRatio } }
 */
export default function DefectMap({
  frontResult,
  backResult,
  defects = { front: [], back: [] },
  centering = {}
}) {
  const [side, setSide] = useState('front');

  const result = side === 'front' ? frontResult : backResult;
  const sideDefects = defects[side] || [];
  const sideLabel = side.toUpperCase();

  // Get centering data
  const centerData = centering[side] || result?.centering || {};
  const lrRatio = centerData.lrRatio ?? 50;
  const tbRatio = centerData.tbRatio ?? 50;

  // Card rect coordinates for SVG
  const cx = 100, cy = 80, cw = 160, ch = 224;

  // Extract corner/edge data from result if available
  const cornerData = result?.corners?.details || [];
  const edgeData = result?.edges?.details || [];

  const getCorner = (name) => cornerData.find(c => c.name === name) || {};
  const getEdge = (name) => edgeData.find(e => e.name === name) || {};

  const dingColor = '#ff6633';
  const cleanColor = '#333';

  return (
    <div style={{
      background: '#0d0f13',
      borderRadius: 10,
      border: '1px solid #1a1c22',
      padding: 12
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 10
      }}>
        <span style={{
          fontFamily: mono,
          fontSize: 11,
          color: '#888',
          textTransform: 'uppercase'
        }}>
          Defect Map
        </span>
        <div style={{ display: 'flex', gap: 4 }}>
          {['front', 'back'].map(s => (
            <button
              key={s}
              onClick={() => setSide(s)}
              style={{
                padding: '4px 10px',
                borderRadius: 4,
                background: side === s ? 'rgba(0,255,136,.1)' : 'transparent',
                border: `1px solid ${side === s ? '#00ff8833' : '#1a1c22'}`,
                color: side === s ? '#00ff88' : '#555',
                fontFamily: mono,
                fontSize: 9,
                textTransform: 'uppercase',
                cursor: 'pointer'
              }}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* SVG Map */}
      <svg viewBox="0 0 360 540" style={{ width: '100%' }}>
        {/* Card outline */}
        <rect x={cx} y={cy} width={cw} height={ch} rx="6" fill="none" stroke="#333" strokeWidth="1.5" />

        {/* Center crosshair */}
        <line x1={cx + cw / 2} y1={cy} x2={cx + cw / 2} y2={cy + ch} stroke="#1a1c22" strokeWidth="0.5" strokeDasharray="4,4" />
        <line x1={cx} y1={cy + ch / 2} x2={cx + cw} y2={cy + ch / 2} stroke="#1a1c22" strokeWidth="0.5" strokeDasharray="4,4" />
        <text x={cx + cw / 2} y={cy + ch / 2 + 3} fill="#222" fontSize="10" fontFamily={mono} textAnchor="middle" fontWeight="700">TAG</text>

        {/* Centering values */}
        <text x={cx + cw / 2} y={cy - 8} fill="#888" fontSize="8.5" fontFamily={mono} textAnchor="middle">
          C: {tbRatio.toFixed?.(1) || tbRatio}
        </text>
        <text x={cx + cw / 2} y={cy + ch + 16} fill="#888" fontSize="8.5" fontFamily={mono} textAnchor="middle">
          C: {(100 - tbRatio).toFixed?.(1) || (100 - tbRatio)}
        </text>
        <text x={cx - 10} y={cy + ch / 2 + 3} fill="#888" fontSize="8.5" fontFamily={mono} textAnchor="end">
          C: {lrRatio.toFixed?.(1) || lrRatio}
        </text>
        <text x={cx + cw + 10} y={cy + ch / 2 + 3} fill="#888" fontSize="8.5" fontFamily={mono} textAnchor="start">
          C: {(100 - lrRatio).toFixed?.(1) || (100 - lrRatio)}
        </text>

        {/* Corner indicators */}
        {[
          { n: 'TOP LEFT', x: cx, y: cy },
          { n: 'TOP RIGHT', x: cx + cw, y: cy },
          { n: 'BOTTOM LEFT', x: cx, y: cy + ch },
          { n: 'BOTTOM RIGHT', x: cx + cw, y: cy + ch }
        ].map(({ n, x, y }) => {
          const data = getCorner(n);
          const hasDing = data.hasDing || sideDefects.some(d => d.type === 'corner' && d.location?.includes(n.split(' ').pop()));
          return (
            <rect
              key={n}
              x={x - 7}
              y={y - 7}
              width={14}
              height={14}
              rx={3}
              fill="none"
              stroke={hasDing ? dingColor : cleanColor}
              strokeWidth={hasDing ? 2.5 : 1}
              strokeDasharray={hasDing ? 'none' : '3,3'}
            />
          );
        })}

        {/* Edge indicators */}
        {[
          { n: 'TOP', x1: cx + 30, y1: cy, x2: cx + cw - 30, y2: cy },
          { n: 'BOTTOM', x1: cx + 30, y1: cy + ch, x2: cx + cw - 30, y2: cy + ch },
          { n: 'LEFT', x1: cx, y1: cy + 30, x2: cx, y2: cy + ch - 30 },
          { n: 'RIGHT', x1: cx + cw, y1: cy + 30, x2: cx + cw, y2: cy + ch - 30 }
        ].map(({ n, x1, y1, x2, y2 }) => {
          const data = getEdge(n);
          const hasDing = data.hasDing || sideDefects.some(d => d.type === 'edge' && d.location?.includes(n));
          return (
            <line
              key={n}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke={hasDing ? dingColor : cleanColor}
              strokeWidth={hasDing ? 3 : 1.5}
            />
          );
        })}

        {/* Separator */}
        <line x1="30" y1={cy + ch + 40} x2="330" y2={cy + ch + 40} stroke="#1a1c22" strokeWidth="0.5" />

        {/* Side label */}
        <text x="180" y={cy + ch + 56} fill="#444" fontSize="9" fontFamily={mono} textAnchor="middle">{sideLabel}</text>

        {/* Defects legend */}
        {sideDefects.length > 0 && (
          <g>
            <rect
              x="30"
              y={cy + ch + 66}
              width="300"
              height={20 + sideDefects.length * 14}
              rx="4"
              fill="rgba(255,102,51,.04)"
              stroke="#ff663322"
              strokeWidth="0.5"
            />
            <text x="40" y={cy + ch + 80} fill="#ff6633" fontSize="7.5" fontFamily={mono} fontWeight="600">
              DINGS DETECTED:
            </text>
            {sideDefects.map((d, i) => (
              <text
                key={d.id}
                x="40"
                y={cy + ch + 94 + i * 14}
                fill="#ff9944"
                fontSize="7"
                fontFamily={mono}
              >
                ⚡ {d.label} — {sideLabel} / {d.location}
              </text>
            ))}
          </g>
        )}

        {/* No defects message */}
        {sideDefects.length === 0 && (
          <g>
            <rect
              x="30"
              y={cy + ch + 66}
              width="300"
              height="30"
              rx="4"
              fill="rgba(0,255,136,.04)"
              stroke="rgba(0,255,136,.15)"
              strokeWidth="0.5"
            />
            <text x="180" y={cy + ch + 86} fill="#00ff88" fontSize="9" fontFamily={mono} textAnchor="middle">
              No defects detected — Clean
            </text>
          </g>
        )}
      </svg>
    </div>
  );
}
