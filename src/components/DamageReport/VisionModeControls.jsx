const mono = "'JetBrains Mono', 'SF Mono', monospace";

const VISION_MODES = [
  { id: 'normal', label: 'Normal' },
  { id: 'emboss', label: 'Emboss' },
  { id: 'highpass', label: 'Hi-Pass' },
  { id: 'edges', label: 'Edges' }
];

/**
 * VisionModeControls - Vision mode tabs and intensity slider
 *
 * Props:
 * - mode: 'normal' | 'emboss' | 'highpass' | 'edges'
 * - intensity: number (0-100)
 * - onModeChange: (mode) => void
 * - onIntensityChange: (value) => void
 */
export default function VisionModeControls({
  mode = 'normal',
  intensity = 50,
  onModeChange,
  onIntensityChange
}) {
  return (
    <div>
      {/* Vision Mode Tabs */}
      <div style={{
        display: 'flex',
        gap: 6,
        marginBottom: 8
      }}>
        {VISION_MODES.map(vm => (
          <button
            key={vm.id}
            onClick={() => onModeChange?.(vm.id)}
            style={{
              flex: 1,
              padding: '8px 0',
              borderRadius: 6,
              border: mode === vm.id ? '1px solid #6366f1' : '1px solid #2a2d35',
              background: mode === vm.id ? 'rgba(99, 102, 241, 0.15)' : 'transparent',
              color: mode === vm.id ? '#8b5cf6' : '#666',
              fontFamily: mono,
              fontSize: 9,
              textTransform: 'uppercase',
              cursor: 'pointer',
              transition: 'all 0.2s'
            }}
          >
            {vm.label}
          </button>
        ))}
      </div>

      {/* Intensity Slider */}
      <input
        type="range"
        min="0"
        max="100"
        value={intensity}
        onChange={(e) => onIntensityChange?.(Number(e.target.value))}
        style={{
          width: '100%',
          height: 6,
          borderRadius: 3,
          background: `linear-gradient(90deg, #6366f1 ${intensity}%, #1a1c22 ${intensity}%)`,
          appearance: 'none',
          cursor: 'pointer',
          marginBottom: 10
        }}
      />
      <style>{`
        input[type=range]::-webkit-slider-thumb {
          appearance: none;
          width: 14px;
          height: 14px;
          border-radius: 50%;
          background: #8b5cf6;
          cursor: pointer;
          border: 2px solid #0a0b0e;
        }
      `}</style>
    </div>
  );
}
