import { useState, useEffect } from 'react';
import ZoomableCardView from './ZoomableCardView';
import VisionModeControls from './VisionModeControls';
import DefectMap from './DefectMap';
import DefectList from './DefectList';
import { processTagDefects } from '../../lib/tag-coordinates';

const mono = "'JetBrains Mono', 'SF Mono', monospace";

/**
 * DamageReportModal - Full damage report view
 *
 * Props:
 * - isOpen: boolean
 * - onClose: () => void
 * - frontImage: string - Cropped front image URL
 * - backImage: string - Cropped back image URL
 * - frontMaps: { emboss, highpass, edges } - Vision mode images
 * - backMaps: { emboss, highpass, edges }
 * - frontResult: Analysis result for front
 * - backResult: Analysis result for back
 * - gradeResult: Full grade result object
 * - tagDefects: Array - Raw TAG-format defects (optional, uses gradeResult.allDings if not provided)
 */
export default function DamageReportModal({
  isOpen,
  onClose,
  frontImage,
  backImage,
  frontMaps,
  backMaps,
  frontResult,
  backResult,
  gradeResult,
  tagDefects
}) {
  const [viewSide, setViewSide] = useState('front');
  const [visionMode, setVisionMode] = useState('normal');
  const [visionIntensity, setVisionIntensity] = useState(50);
  const [showBoxes, setShowBoxes] = useState(true);
  const [highlightedDefect, setHighlightedDefect] = useState(null);

  // Process defects
  const [defects, setDefects] = useState({ front: [], back: [] });

  useEffect(() => {
    // Priority: tagDefects > gradeResult.allDings
    const rawDefects = tagDefects || gradeResult?.allDings || [];

    if (rawDefects.length > 0) {
      // Check if already in TAG format (has x, y coords)
      const hasCoords = rawDefects[0]?.x !== undefined;

      if (hasCoords) {
        // Process TAG-format defects
        setDefects(processTagDefects(rawDefects, 5));
      } else {
        // Convert SlabSense dings format
        const converted = rawDefects.map((d, i) => ({
          ordering: i + 1,
          side: d.side || 'FRONT',
          type: d.type || 'SURFACE',
          location: d.location?.split(' / ').pop() || 'Unknown',
          // No coords - will use location-based estimation
        }));
        setDefects(processTagDefects(converted, 6));
      }
    } else {
      setDefects({ front: [], back: [] });
    }
  }, [tagDefects, gradeResult]);

  if (!isOpen) return null;

  const currentImage = viewSide === 'front' ? frontImage : backImage;
  const currentMaps = viewSide === 'front' ? frontMaps : backMaps;
  const currentDefects = defects[viewSide] || [];

  const totalDings = (defects.front?.length || 0) + (defects.back?.length || 0);
  const dingsColor = totalDings === 0 ? '#00ff88' :
                     totalDings <= 2 ? '#66dd44' :
                     totalDings <= 4 ? '#ffcc00' : '#ff6633';

  const handleDefectClick = (defect) => {
    setHighlightedDefect(defect.id);
    setViewSide(defect.side || 'front');
  };

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: 'rgba(0, 0, 0, 0.9)',
      zIndex: 1000,
      overflowY: 'auto',
      padding: 16
    }}>
      <div style={{
        maxWidth: 420,
        margin: '0 auto',
        background: '#0a0b0e'
      }}>
        {/* Header */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '12px 16px',
          background: '#0d0f13',
          borderRadius: 10,
          border: '1px solid #1a1c22',
          marginBottom: 16
        }}>
          <span style={{
            fontFamily: mono,
            fontSize: 11,
            color: '#888',
            textTransform: 'uppercase',
            letterSpacing: '0.12em'
          }}>
            Damage Report
          </span>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: '1px solid #1a1c22',
              color: '#555',
              padding: '6px 12px',
              borderRadius: 6,
              fontFamily: mono,
              fontSize: 10,
              cursor: 'pointer'
            }}
          >
            ✕ Close
          </button>
        </div>

        {/* Defects Count */}
        <Section>
          <div style={{ textAlign: 'center', padding: 16 }}>
            <div style={{
              fontFamily: mono,
              fontSize: 9,
              color: '#555',
              textTransform: 'uppercase',
              letterSpacing: '0.12em',
              marginBottom: 4
            }}>
              Defects Identified of Notable Grade Significance
            </div>
            <div style={{
              fontFamily: mono,
              fontSize: 36,
              fontWeight: 800,
              color: dingsColor
            }}>
              {totalDings}
            </div>
            <div style={{
              fontFamily: mono,
              fontSize: 10,
              color: '#444'
            }}>
              DINGS
            </div>
          </div>
        </Section>

        {/* Card View */}
        <Section
          title="Card View"
          rightContent={
            <div style={{ display: 'flex', gap: 4 }}>
              {['front', 'back'].map(s => (
                <button
                  key={s}
                  onClick={() => setViewSide(s)}
                  style={{
                    padding: '4px 10px',
                    borderRadius: 4,
                    background: viewSide === s ? 'rgba(0,255,136,.1)' : 'transparent',
                    border: `1px solid ${viewSide === s ? '#00ff8833' : '#1a1c22'}`,
                    color: viewSide === s ? '#00ff88' : '#555',
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
          }
        >
          <div style={{ padding: 12 }}>
            {/* Vision Controls */}
            <VisionModeControls
              mode={visionMode}
              intensity={visionIntensity}
              onModeChange={setVisionMode}
              onIntensityChange={setVisionIntensity}
            />

            {/* Zoomable Card */}
            <ZoomableCardView
              image={currentImage}
              visionImages={currentMaps}
              visionMode={visionMode}
              visionIntensity={visionIntensity}
              defects={currentDefects}
              showBoxes={showBoxes}
              onDefectClick={handleDefectClick}
              side={viewSide}
            />

            {/* Toggle Boxes */}
            <div style={{ marginTop: 10 }}>
              <button
                onClick={() => setShowBoxes(!showBoxes)}
                style={{
                  width: '100%',
                  padding: '6px 10px',
                  borderRadius: 4,
                  background: showBoxes ? 'rgba(255, 102, 51, 0.1)' : 'transparent',
                  border: `1px solid ${showBoxes ? 'rgba(255, 102, 51, 0.3)' : '#1a1c22'}`,
                  color: showBoxes ? '#ff9944' : '#555',
                  fontFamily: mono,
                  fontSize: 9,
                  cursor: 'pointer'
                }}
              >
                {showBoxes ? '⊕ Show Boxes' : '⊖ Hide Boxes'}
              </button>
            </div>
          </div>
        </Section>

        {/* Defect Map */}
        <Section title="Defect Map">
          <div style={{ padding: 12 }}>
            <DefectMap
              frontResult={frontResult}
              backResult={backResult}
              defects={defects}
              centering={{
                front: frontResult?.centering,
                back: backResult?.centering
              }}
            />
          </div>
        </Section>

        {/* Corners Detail */}
        <Section title="Corners">
          <div style={{ padding: 14 }}>
            <DetailGrid
              frontResult={frontResult}
              backResult={backResult}
              dataKey="corners"
            />
          </div>
        </Section>

        {/* Edges Detail */}
        <Section title="Edges">
          <div style={{ padding: 14 }}>
            <DetailGrid
              frontResult={frontResult}
              backResult={backResult}
              dataKey="edges"
            />
          </div>
        </Section>

        {/* Defect Details */}
        <Section title="Defect Details">
          <div style={{ padding: 14 }}>
            <DefectList
              defects={defects}
              onDefectClick={handleDefectClick}
              highlightedId={highlightedDefect}
            />
          </div>
        </Section>
      </div>
    </div>
  );
}

// Section wrapper component
function Section({ title, rightContent, children }) {
  return (
    <div style={{
      background: '#0d0f13',
      borderRadius: 10,
      border: '1px solid #1a1c22',
      marginBottom: 16,
      overflow: 'hidden'
    }}>
      {title && (
        <div style={{
          padding: '8px 12px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderBottom: '1px solid #1a1c22'
        }}>
          <span style={{
            fontFamily: mono,
            fontSize: 10,
            color: '#888',
            textTransform: 'uppercase',
            letterSpacing: '0.08em'
          }}>
            {title}
          </span>
          {rightContent}
        </div>
      )}
      {children}
    </div>
  );
}

// Detail grid for corners/edges
function DetailGrid({ frontResult, backResult, dataKey }) {
  const getData = (result) => result?.[dataKey]?.details || [];

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: 8
    }}>
      {[['Front', frontResult], ['Back', backResult]].map(([label, result]) => (
        <div key={label}>
          <div style={{
            fontFamily: mono,
            fontSize: 8,
            color: '#666',
            marginBottom: 6
          }}>
            {label}
          </div>
          <div style={{
            display: 'grid',
            gridTemplateColumns: dataKey === 'corners' ? '1fr 1fr' : '1fr',
            gap: 4
          }}>
            {getData(result).map(item => (
              <div
                key={item.name}
                style={{
                  padding: 6,
                  background: 'rgba(0, 0, 0, 0.3)',
                  borderRadius: 4,
                  borderLeft: `2px solid ${item.hasDing ? '#ff6633' : '#333'}`
                }}
              >
                <div style={{
                  fontFamily: mono,
                  fontSize: 9,
                  color: item.hasDing ? '#ff9944' : '#777'
                }}>
                  {item.name}
                </div>
                <div style={{
                  fontFamily: mono,
                  fontSize: 8,
                  color: '#555'
                }}>
                  F:{item.fray || '—'} W:{item.whiteRatio || '—'}%
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
