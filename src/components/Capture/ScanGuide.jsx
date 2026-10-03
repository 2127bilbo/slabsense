/*
 * SlabSense — https://www.slabsenseai.com
 * Copyright (c) 2026 SlabSense. All rights reserved.
 * Proprietary and confidential; see LICENSE at the repository root.
 */
/**
 * ScanGuide — four animated slides on taking a good card photo (copy in src/lib/scan-guide.js).
 * Opens over the camera the first time it is used and from the camera's "?" button.
 * Each animation's resting state is its final frame, so with reduced motion the slide still shows
 * the point (card on a plain surface, corners in frame, no glare, outline locked).
 */
import { useEffect, useRef, useState } from 'react';
import { SLIDES } from '../../lib/scan-guide.js';

const mono = "'JetBrains Mono','SF Mono',monospace";
const sans = "'Inter',-apple-system,sans-serif";
const GREEN = '#00ff88', AMBER = '#ffcc00', GOLD = '#d9b56a';

const CSS = `
.sg svg *{transform-box:fill-box}
@keyframes sgDrop{0%{transform:translateY(-150px) rotate(-10deg);opacity:0}22%{opacity:1}34%{transform:translateY(6px) rotate(1deg)}42%,100%{transform:translateY(0) rotate(0);opacity:1}}
@keyframes sgOutline{0%,44%{opacity:0;stroke:${AMBER}}52%,66%{opacity:1;stroke:${AMBER}}72%,100%{opacity:1;stroke:${GREEN}}}
@keyframes sgSurface{0%,30%{fill:#e8e8ec}36%,63%{fill:#8b8e96}69%,96%{fill:#16171b}100%{fill:#e8e8ec}}
@keyframes sgZoom{0%,18%{transform:scale(1.55)}55%,100%{transform:scale(1)}}
@keyframes sgCorner{0%,58%{stroke:#ffffff44}66%,100%{stroke:${GREEN}}}
@keyframes sgLamp{0%,18%{transform:translateX(0)}60%,100%{transform:translateX(78px)}}
@keyframes sgGlare{0%,18%{opacity:.95}60%,100%{opacity:0}}
@keyframes sgSoft{0%,45%{opacity:0}75%,100%{opacity:.55}}
@keyframes sgBubble{0%{transform:translate(14px,-10px)}35%{transform:translate(-5px,4px)}55%,100%{transform:translate(0,0)}}
@keyframes sgRing{0%,55%{stroke-dashoffset:126}88%,100%{stroke-dashoffset:0}}
@keyframes sgLock{0%,52%{stroke:${AMBER}}58%,100%{stroke:${GREEN}}}
@keyframes sgFlash{0%,88%{opacity:0}91%{opacity:.85}100%{opacity:0}}
.sg-drop{animation:sgDrop 3.6s cubic-bezier(.3,.7,.3,1) infinite}
.sg-outline{stroke:${GREEN};animation:sgOutline 3.6s linear infinite}
.sg-surface{fill:#e8e8ec;animation:sgSurface 10.8s steps(1,end) infinite}
.sg-zoom{transform-origin:50% 50%;animation:sgZoom 3.6s ease-in-out infinite}
.sg-corner{stroke:${GREEN};animation:sgCorner 3.6s linear infinite}
.sg-lamp{transform:translateX(78px);animation:sgLamp 4s ease-in-out infinite alternate}
.sg-glare{opacity:0;animation:sgGlare 4s ease-in-out infinite alternate}
.sg-soft{opacity:.55;animation:sgSoft 4s ease-in-out infinite alternate}
.sg-bubble{animation:sgBubble 3.6s ease-out infinite}
.sg-ring{stroke-dasharray:126;stroke-dashoffset:0;animation:sgRing 3.6s linear infinite}
.sg-lock{stroke:${GREEN};animation:sgLock 3.6s linear infinite}
.sg-flash{opacity:0;animation:sgFlash 3.6s linear infinite}
@media (prefers-reduced-motion: reduce){.sg *{animation:none!important}}
`;

/** A trading card drawn at 0,0 (60 x 84). */
function Card({ holo = false }) {
  return (
    <g>
      <rect width="60" height="84" rx="3.5" fill="#f3d36b" />
      <rect x="4" y="4" width="52" height="76" rx="2" fill="#fbf4dc" />
      <rect x="7" y="10" width="46" height="32" rx="1" fill={holo ? 'url(#sgHolo)' : '#7cb6e8'} />
      <rect x="7" y="47" width="46" height="3" rx="1" fill="#c9b98a" />
      <rect x="7" y="53" width="38" height="2.5" rx="1" fill="#d8cca4" />
      <rect x="7" y="58" width="42" height="2.5" rx="1" fill="#d8cca4" />
      <rect x="7" y="7" width="22" height="2" rx="1" fill="#8a7a4e" />
    </g>
  );
}
const Defs = () => (
  <defs>
    <linearGradient id="sgHolo" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stopColor="#8be9fd" /><stop offset=".35" stopColor="#c4b5fd" /><stop offset=".7" stopColor="#f9a8d4" /><stop offset="1" stopColor="#fde68a" />
    </linearGradient>
    <radialGradient id="sgGlareG"><stop offset="0" stopColor="#fff" /><stop offset=".45" stopColor="#fff" stopOpacity=".75" /><stop offset="1" stopColor="#fff" stopOpacity="0" /></radialGradient>
    <radialGradient id="sgSoftG"><stop offset="0" stopColor="#fff6dd" stopOpacity=".9" /><stop offset="1" stopColor="#fff6dd" stopOpacity="0" /></radialGradient>
    <clipPath id="sgView"><rect x="70" y="22" width="120" height="156" rx="10" /></clipPath>
  </defs>
);

/** Corner brackets around a card box at x,y (w x h). */
function Brackets({ x, y, w, h, className }) {
  const L = 9;
  const d = [`M${x} ${y + L}V${y}H${x + L}`, `M${x + w - L} ${y}H${x + w}V${y + L}`, `M${x + w} ${y + h - L}V${y + h}H${x + w - L}`, `M${x + L} ${y + h}H${x}V${y + h - L}`];
  return <g fill="none" strokeWidth="3" strokeLinecap="round" className={className}>{d.map((p) => <path key={p} d={p} />)}</g>;
}

function Scene({ anim }) {
  const box = { viewBox: '0 0 260 200', width: '100%', style: { maxWidth: 340, display: 'block', margin: '0 auto' }, 'aria-hidden': true };
  if (anim === 'drop') {
    return (
      <svg {...box}><Defs />
        <rect x="20" y="16" width="220" height="168" rx="14" className="sg-surface" />
        <g transform="translate(100 58)"><g className="sg-drop"><Card /></g></g>
        <rect x="95" y="53" width="70" height="94" rx="5" fill="none" strokeWidth="2.5" className="sg-outline" />
        <Brackets x={95} y={53} w={70} h={94} className="sg-outline" />
      </svg>
    );
  }
  if (anim === 'corners') {
    return (
      <svg {...box}><Defs />
        <rect x="20" y="10" width="220" height="180" rx="14" fill="#202228" />
        <g clipPath="url(#sgView)">
          <rect x="70" y="22" width="120" height="156" fill="#e8e8ec" />
          <g className="sg-zoom"><g transform="translate(100 58)"><Card /></g></g>
        </g>
        <rect x="70" y="22" width="120" height="156" rx="10" fill="none" stroke="#ffffff55" strokeWidth="2" />
        <Brackets x={95} y={53} w={70} h={94} className="sg-corner" />
      </svg>
    );
  }
  if (anim === 'glare') {
    return (
      <svg {...box}><Defs />
        <rect x="20" y="16" width="220" height="168" rx="14" fill="#e8e8ec" />
        <ellipse cx="130" cy="100" rx="90" ry="70" fill="url(#sgSoftG)" className="sg-soft" />
        <g transform="translate(100 64)"><Card holo /></g>
        <ellipse cx="128" cy="92" rx="20" ry="14" fill="url(#sgGlareG)" className="sg-glare" />
        <g className="sg-lamp">
          <path d="M120 22h20l7 14h-34z" fill="#5b5f6b" />
          <rect x="128" y="10" width="4" height="12" fill="#5b5f6b" />
          <ellipse cx="130" cy="37" rx="9" ry="3" fill="#fff6c8" />
        </g>
      </svg>
    );
  }
  return (
    <svg {...box}><Defs />
      <rect x="20" y="16" width="220" height="168" rx="14" fill="#e8e8ec" />
      <g transform="translate(70 50)"><Card /></g>
      <rect x="65" y="45" width="70" height="94" rx="5" fill="none" strokeWidth="2.5" className="sg-lock" />
      <circle cx="190" cy="72" r="22" fill="#0d0f13" stroke="#ffffff33" />
      <circle cx="190" cy="72" r="6" fill="none" stroke="#ffffff44" />
      <circle cx="190" cy="72" r="5" fill={GREEN} className="sg-bubble" />
      <circle cx="190" cy="138" r="18" fill="#fff" stroke="#0d0f13" strokeWidth="3" />
      <circle cx="190" cy="138" r="20" fill="none" stroke={GREEN} strokeWidth="3" strokeLinecap="round" transform="rotate(-90 190 138)" className="sg-ring" />
      <rect x="20" y="16" width="220" height="168" rx="14" fill="#fff" className="sg-flash" />
    </svg>
  );
}

export function ScanGuide({ onClose }) {
  const [i, setI] = useState(0);
  const [dontShow, setDontShow] = useState(false);
  const touch = useRef(null);
  const last = i === SLIDES.length - 1;
  const s = SLIDES[i];
  const close = (finished) => onClose({ dontShow: finished || dontShow });

  useEffect(() => {
    const key = (e) => {
      if (e.key === 'ArrowRight') setI((n) => Math.min(SLIDES.length - 1, n + 1));
      if (e.key === 'ArrowLeft') setI((n) => Math.max(0, n - 1));
      if (e.key === 'Escape') onClose({ dontShow });
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [dontShow, onClose]);

  const btn = (primary) => ({ flex: 1, minHeight: 48, borderRadius: 12, cursor: 'pointer', fontFamily: mono, fontSize: 13, fontWeight: 700,
    border: primary ? 'none' : '1px solid #2a2d35', background: primary ? 'linear-gradient(135deg,#6366f1,#8b5cf6)' : 'transparent', color: primary ? '#fff' : '#bbb' });

  return (
    <div className="sg" role="dialog" aria-modal="true" aria-labelledby="sg-title"
      onTouchStart={(e) => { touch.current = e.touches[0].clientX; }}
      onTouchEnd={(e) => { const dx = e.changedTouches[0].clientX - (touch.current ?? e.changedTouches[0].clientX); if (dx < -40 && !last) setI(i + 1); if (dx > 40 && i > 0) setI(i - 1); }}
      style={{ position: 'absolute', inset: 0, zIndex: 30, background: '#0a0b0e', display: 'flex', flexDirection: 'column', padding: 'max(14px, env(safe-area-inset-top)) 20px max(20px, env(safe-area-inset-bottom))', overflowY: 'auto' }}>
      <style>{CSS}</style>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontFamily: mono, fontSize: 11, letterSpacing: '.14em', color: GOLD, fontWeight: 700 }}>SCANNING TIPS · {i + 1}/{SLIDES.length}</div>
        <button onClick={() => close(false)} style={{ minHeight: 44, padding: '0 6px', background: 'transparent', border: 'none', color: '#999', fontFamily: mono, fontSize: 12, cursor: 'pointer' }}>Skip</button>
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 22, maxWidth: 420, width: '100%', margin: '0 auto' }}>
        <div key={s.key} style={{ borderRadius: 18, padding: '10px 0', background: 'radial-gradient(ellipse at 50% 40%, #1b1d24 0%, #0a0b0e 70%)' }}><Scene anim={s.anim} /></div>
        <div aria-live="polite">
          <h2 id="sg-title" style={{ fontFamily: sans, fontSize: 22, fontWeight: 700, color: '#fff', margin: 0, textWrap: 'balance' }}>{s.title}</h2>
          <p style={{ fontFamily: sans, fontSize: 15, color: '#b8bcc6', lineHeight: 1.55, margin: '10px 0 0' }}>{s.body}</p>
        </div>
      </div>
      <div style={{ maxWidth: 420, width: '100%', margin: '0 auto' }}>
        <div role="tablist" aria-label="Tips" style={{ display: 'flex', justifyContent: 'center', gap: 8, margin: '16px 0' }}>
          {SLIDES.map((x, n) => (
            <button key={x.key} role="tab" aria-selected={n === i} aria-label={x.title} onClick={() => setI(n)}
              style={{ width: n === i ? 22 : 8, height: 8, padding: 0, borderRadius: 4, border: 'none', background: n === i ? GOLD : '#2f323b', cursor: 'pointer', transition: 'width .25s ease' }} />
          ))}
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          {i > 0 && <button onClick={() => setI(i - 1)} style={btn(false)}>Back</button>}
          <button onClick={() => (last ? close(true) : setI(i + 1))} style={btn(true)}>{last ? 'Start scanning' : 'Next'}</button>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 14, minHeight: 32, fontFamily: sans, fontSize: 13, color: '#888', cursor: 'pointer' }}>
          <input type="checkbox" checked={dontShow} onChange={(e) => setDontShow(e.target.checked)} style={{ width: 18, height: 18, accentColor: '#8b5cf6' }} />
          Don&apos;t show this again
        </label>
      </div>
    </div>
  );
}

export default ScanGuide;
