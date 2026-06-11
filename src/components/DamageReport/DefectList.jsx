const mono = "'JetBrains Mono', 'SF Mono', monospace";
const sans = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

/**
 * DefectList - Detailed list of all defects
 *
 * Props:
 * - defects: { front: [], back: [] }
 * - onDefectClick: (defect) => void
 * - highlightedId: number - ID of currently highlighted defect
 */
export default function DefectList({
  defects = { front: [], back: [] },
  onDefectClick,
  highlightedId
}) {
  const allDefects = [
    ...(defects.front || []).map(d => ({ ...d, side: 'front' })),
    ...(defects.back || []).map(d => ({ ...d, side: 'back' }))
  ];

  if (allDefects.length === 0) {
    return (
      <div style={{
        padding: 16,
        background: 'rgba(0, 255, 136, 0.05)',
        borderRadius: 8,
        border: '1px solid rgba(0, 255, 136, 0.15)'
      }}>
        <div style={{
          fontFamily: mono,
          fontSize: 12,
          color: '#00ff88'
        }}>
          No DINGS detected — potential Gem Mint candidate
        </div>
      </div>
    );
  }

  return (
    <div>
      {allDefects.map(defect => {
        const isHighlighted = highlightedId === defect.id;
        const colors = {
          corner: '#ff6633',
          edge: '#ff9944',
          surface: '#ffcc00'
        };
        const color = colors[defect.type] || colors.surface;

        return (
          <div
            key={`${defect.side}-${defect.id}`}
            onClick={() => onDefectClick?.(defect)}
            style={{
              padding: '10px 12px',
              marginBottom: 6,
              background: isHighlighted ? 'rgba(255, 102, 51, 0.1)' : '#0d0f13',
              borderRadius: 8,
              border: `1px solid ${isHighlighted ? '#ff6633' : '#1a1c22'}`,
              borderLeft: `3px solid ${color}`,
              cursor: 'pointer',
              transition: 'all 0.2s'
            }}
          >
            {/* Header */}
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 4
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{
                  width: 20,
                  height: 20,
                  borderRadius: '50%',
                  background: color,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontFamily: mono,
                  fontSize: 10,
                  fontWeight: 700,
                  color: defect.type === 'surface' ? '#000' : '#fff'
                }}>
                  {defect.id}
                </span>
                <span style={{
                  fontFamily: mono,
                  fontSize: 11,
                  color: '#ff9944',
                  fontWeight: 600
                }}>
                  {defect.side.toUpperCase()} / {defect.location}
                </span>
              </div>
              <span style={{
                fontFamily: mono,
                fontSize: 9,
                color: '#555',
                textTransform: 'uppercase'
              }}>
                {defect.label.split(' / ').pop()}
              </span>
            </div>

            {/* Details */}
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}>
              <span style={{
                fontFamily: mono,
                fontSize: 9,
                color: '#666'
              }}>
                Zone {defect.zone}: {defect.zoneLabel}
              </span>
              {defect.tagCoords && (
                <span style={{
                  fontFamily: mono,
                  fontSize: 8,
                  color: '#444'
                }}>
                  TAG: ({defect.tagCoords.x}, {defect.tagCoords.y})
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
