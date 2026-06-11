import { useState, useRef, useEffect, useCallback } from 'react';

const mono = "'JetBrains Mono', 'SF Mono', monospace";

/**
 * ZoomableCardView - Card image with defect boxes, zoom, and pan
 *
 * Props:
 * - image: string - Image URL (normal view)
 * - visionImages: { emboss, highpass, edges } - Enhanced vision mode images
 * - visionMode: 'normal' | 'emboss' | 'highpass' | 'edges'
 * - visionIntensity: number (0-100)
 * - defects: Array - Processed defects for this side
 * - showBoxes: boolean
 * - onDefectClick: (defect) => void
 */
export default function ZoomableCardView({
  image,
  visionImages = {},
  visionMode = 'normal',
  visionIntensity = 50,
  defects = [],
  showBoxes = true,
  onDefectClick,
  side = 'front'
}) {
  const containerRef = useRef(null);
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [lastPan, setLastPan] = useState({ x: 0, y: 0 });

  const MIN_SCALE = 1;
  const MAX_SCALE = 5;
  const ZOOM_STEP = 0.25;

  // Touch state for pinch zoom
  const [lastTouchDist, setLastTouchDist] = useState(0);
  const [lastTap, setLastTap] = useState(0);

  const clampPan = useCallback((newPan, newScale) => {
    if (!containerRef.current) return newPan;
    const rect = containerRef.current.getBoundingClientRect();
    const maxPanX = (newScale - 1) * rect.width / 2;
    const maxPanY = (newScale - 1) * rect.height / 2;
    return {
      x: Math.max(-maxPanX, Math.min(maxPanX, newPan.x)),
      y: Math.max(-maxPanY, Math.min(maxPanY, newPan.y))
    };
  }, []);

  const handleWheel = useCallback((e) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
    const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale + delta));

    if (newScale !== scale && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const mouseX = e.clientX - rect.left - rect.width / 2;
      const mouseY = e.clientY - rect.top - rect.height / 2;
      const scaleFactor = newScale / scale;

      let newPan = {
        x: mouseX - (mouseX - pan.x) * scaleFactor,
        y: mouseY - (mouseY - pan.y) * scaleFactor
      };

      if (newScale === 1) newPan = { x: 0, y: 0 };
      setPan(clampPan(newPan, newScale));
      setScale(newScale);
    }
  }, [scale, pan, clampPan]);

  const handleMouseDown = (e) => {
    if (scale > 1) {
      setIsDragging(true);
      setDragStart({ x: e.clientX, y: e.clientY });
      setLastPan(pan);
    }
  };

  const handleMouseMove = useCallback((e) => {
    if (isDragging) {
      const newPan = {
        x: lastPan.x + (e.clientX - dragStart.x),
        y: lastPan.y + (e.clientY - dragStart.y)
      };
      setPan(clampPan(newPan, scale));
    }
  }, [isDragging, lastPan, dragStart, scale, clampPan]);

  const handleMouseUp = () => setIsDragging(false);

  // Touch handlers
  const getTouchDistance = (touches) => {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  };

  const handleTouchStart = (e) => {
    if (e.touches.length === 2) {
      setLastTouchDist(getTouchDistance(e.touches));
    } else if (e.touches.length === 1 && scale > 1) {
      setIsDragging(true);
      setDragStart({ x: e.touches[0].clientX, y: e.touches[0].clientY });
      setLastPan(pan);
    }
  };

  const handleTouchMove = useCallback((e) => {
    if (e.touches.length === 2 && containerRef.current) {
      e.preventDefault();
      const dist = getTouchDistance(e.touches);
      const scaleDelta = (dist - lastTouchDist) * 0.01;
      const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale + scaleDelta));

      if (newScale !== scale) {
        const rect = containerRef.current.getBoundingClientRect();
        const centerX = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left - rect.width / 2;
        const centerY = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top - rect.height / 2;
        const scaleFactor = newScale / scale;

        let newPan = {
          x: centerX - (centerX - pan.x) * scaleFactor,
          y: centerY - (centerY - pan.y) * scaleFactor
        };

        if (newScale === 1) newPan = { x: 0, y: 0 };
        setPan(clampPan(newPan, newScale));
        setScale(newScale);
      }
      setLastTouchDist(dist);
    } else if (e.touches.length === 1 && isDragging) {
      const newPan = {
        x: lastPan.x + (e.touches[0].clientX - dragStart.x),
        y: lastPan.y + (e.touches[0].clientY - dragStart.y)
      };
      setPan(clampPan(newPan, scale));
    }
  }, [scale, pan, lastTouchDist, isDragging, lastPan, dragStart, clampPan]);

  const handleTouchEnd = (e) => {
    setIsDragging(false);
    setLastTouchDist(0);

    // Double tap to zoom
    if (e.changedTouches.length === 1) {
      const now = Date.now();
      if (now - lastTap < 300) {
        if (scale > 1) {
          setScale(1);
          setPan({ x: 0, y: 0 });
        } else {
          setScale(2.5);
        }
      }
      setLastTap(now);
    }
  };

  useEffect(() => {
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [handleMouseMove]);

  const zoomIn = () => {
    const newScale = Math.min(MAX_SCALE, scale + ZOOM_STEP);
    setPan(clampPan(pan, newScale));
    setScale(newScale);
  };

  const zoomOut = () => {
    const newScale = Math.max(MIN_SCALE, scale - ZOOM_STEP);
    if (newScale === 1) setPan({ x: 0, y: 0 });
    else setPan(clampPan(pan, newScale));
    setScale(newScale);
  };

  const resetZoom = () => {
    setScale(1);
    setPan({ x: 0, y: 0 });
  };

  const visionOverlay = visionMode !== 'normal' && visionImages[visionMode];

  return (
    <div
      ref={containerRef}
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      style={{
        position: 'relative',
        background: '#111',
        borderRadius: 8,
        overflow: 'hidden',
        aspectRatio: '63/88',
        cursor: scale > 1 ? (isDragging ? 'grabbing' : 'grab') : 'default',
        touchAction: 'none',
        userSelect: 'none'
      }}
    >
      {/* Zoom Wrapper */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          transformOrigin: 'center center',
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
          transition: isDragging ? 'none' : 'transform 0.1s ease-out'
        }}
      >
        {/* Base Image */}
        {image ? (
          <img
            src={image}
            alt={`${side} view`}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'contain',
              userSelect: 'none',
              WebkitUserDrag: 'none'
            }}
            draggable={false}
          />
        ) : (
          <div style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'linear-gradient(135deg, #1a1c22 0%, #0d0f13 100%)'
          }}>
            <span style={{ fontFamily: mono, fontSize: 11, color: '#333' }}>
              No Image
            </span>
          </div>
        )}

        {/* Vision Mode Overlay */}
        {visionOverlay && (
          <img
            src={visionOverlay}
            alt={`${visionMode} view`}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              objectFit: 'contain',
              opacity: visionIntensity / 100,
              mixBlendMode: visionMode === 'edges' ? 'screen' : 'normal',
              pointerEvents: 'none'
            }}
          />
        )}

        {/* Defect Boxes */}
        {showBoxes && (
          <div style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            pointerEvents: 'none'
          }}>
            {defects.map(defect => {
              const { bounds, type, id, label, location } = defect;
              const width = bounds.x2 - bounds.x1;
              const height = bounds.y2 - bounds.y1;

              const colors = {
                corner: { border: 'rgba(255, 102, 51, 0.9)', bg: 'rgba(255, 102, 51, 0.15)' },
                edge: { border: 'rgba(255, 153, 68, 0.9)', bg: 'rgba(255, 153, 68, 0.15)' },
                surface: { border: 'rgba(255, 204, 0, 0.9)', bg: 'rgba(255, 204, 0, 0.15)' }
              };
              const color = colors[type] || colors.surface;

              return (
                <div
                  key={id}
                  onClick={() => onDefectClick?.(defect)}
                  style={{
                    position: 'absolute',
                    top: `${bounds.y1}%`,
                    left: `${bounds.x1}%`,
                    width: `${width}%`,
                    height: `${height}%`,
                    border: `2px solid ${color.border}`,
                    background: color.bg,
                    borderRadius: 4,
                    pointerEvents: 'auto',
                    cursor: 'pointer'
                  }}
                >
                  {/* Label */}
                  <span style={{
                    position: 'absolute',
                    top: -10,
                    left: -10,
                    width: 20,
                    height: 20,
                    borderRadius: '50%',
                    background: color.border,
                    border: '2px solid #fff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontFamily: mono,
                    fontSize: 9,
                    fontWeight: 700,
                    color: type === 'surface' ? '#000' : '#fff',
                    boxShadow: '0 2px 6px rgba(0,0,0,0.5)'
                  }}>
                    {id}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Zoom Controls */}
      <div style={{
        position: 'absolute',
        bottom: 8,
        right: 8,
        display: 'flex',
        gap: 4,
        zIndex: 20
      }}>
        <button onClick={zoomIn} title="Zoom In" style={zoomBtnStyle}>+</button>
        <span style={zoomLevelStyle}>{scale.toFixed(1)}x</span>
        <button onClick={zoomOut} title="Zoom Out" style={zoomBtnStyle}>−</button>
        <button onClick={resetZoom} title="Reset" style={zoomBtnStyle}>⟲</button>
      </div>
    </div>
  );
}

const zoomBtnStyle = {
  width: 28,
  height: 28,
  borderRadius: 6,
  background: 'rgba(0, 0, 0, 0.7)',
  border: '1px solid #1a1c22',
  color: '#666',
  fontFamily: mono,
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center'
};

const zoomLevelStyle = {
  padding: '4px 8px',
  background: 'rgba(0, 0, 0, 0.7)',
  borderRadius: 6,
  fontFamily: mono,
  fontSize: 10,
  color: '#666',
  display: 'flex',
  alignItems: 'center'
};
