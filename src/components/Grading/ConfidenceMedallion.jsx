/*
 * SlabSense — https://www.slabsenseai.com
 * Copyright (c) 2026 SlabSense. All rights reserved.
 * Proprietary and confidential; see LICENSE at the repository root.
 */
/**
 * Photo-confidence medallion (owner's graphite-and-gold lens renders, public/confidence/*.jpg).
 * The clean lens is blurred for soft focus, then each problem's lens render is blended in as
 * strongly as it was measured; the score is set under the lens. PhotoConfidenceCard adds the band,
 * the trust message and what to fix.
 */
import { useEffect, useRef, useState } from 'react';
import { bandFor, problemsFor, lensLayers } from '../../lib/confidence-copy.js';

const W = 640, H = 674, LX = 322.3, LY = 289.5, LR = 113;
const NAMES = ['base', 'glare', 'blur', 'fog', 'dark', 'grain', 'finger'];
let cache = null;   // images load once per session
function loadAll() {
  if (cache) return cache;
  cache = Promise.all(NAMES.map((n) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res([n, i]); i.onerror = rej; i.src = `/confidence/${n}.jpg`; })))
    .then(Object.fromEntries)
    .catch((e) => { cache = null; throw e; });
  return cache;
}

function draw(canvas, imgs, score, layers) {
  const ctx = canvas.getContext('2d');
  ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1; ctx.filter = 'none';
  ctx.drawImage(imgs.base, 0, 0, W, H);
  const lens = document.createElement('canvas'); lens.width = W; lens.height = H;
  const lc = lens.getContext('2d');
  lc.filter = layers.blur > 0 ? `blur(${(layers.blur * 7).toFixed(1)}px)` : 'none';
  lc.drawImage(imgs.base, 0, 0, W, H);
  lc.filter = 'none';
  const layer = (key, alpha, mode) => { if (alpha <= 0) return; lc.globalCompositeOperation = mode; lc.globalAlpha = Math.min(1, alpha); lc.drawImage(imgs[key], 0, 0, W, H); };
  layer('blur', layers.blur * 0.55, 'source-over');
  layer('fog', layers.fog * 0.9, 'source-over');
  layer('grain', layers.grain * 0.75, 'source-over');
  layer('dark', layers.dark * 0.95, 'multiply');
  layer('finger', layers.finger * 0.95, 'source-over');
  layer('glare', layers.glare * 0.95, 'screen');
  lc.globalCompositeOperation = 'destination-in'; lc.globalAlpha = 1;
  const g = lc.createRadialGradient(LX, LY, LR - 9, LX, LY, LR + 1); g.addColorStop(0, '#000'); g.addColorStop(1, 'rgba(0,0,0,0)');
  lc.fillStyle = g; lc.fillRect(0, 0, W, H);
  ctx.drawImage(lens, 0, 0);
  ctx.save(); ctx.textAlign = 'center';
  ctx.font = '700 86px "Bodoni 72", Didot, "Bodoni MT", Georgia, serif';
  ctx.shadowColor = 'rgba(0,0,0,.65)'; ctx.shadowBlur = 10; ctx.shadowOffsetY = 4;
  const tg = ctx.createLinearGradient(0, 455, 0, 535); tg.addColorStop(0, '#ffffff'); tg.addColorStop(1, '#d9dbe2');
  ctx.fillStyle = tg; ctx.fillText(score.toFixed(1), LX, 535);
  ctx.restore();
}

export function ConfidenceMedallion({ score, issues, cutoff = false, size = 132 }) {
  const ref = useRef(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    loadAll().then((imgs) => { if (!cancelled && ref.current) draw(ref.current, imgs, score, lensLayers(issues, cutoff)); }).catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [score, issues, cutoff]);
  if (failed) return <div style={{ width: size, fontFamily: "'JetBrains Mono', monospace", fontSize: 28, color: '#fff', textAlign: 'center' }}>{score.toFixed(1)}</div>;
  return <canvas ref={ref} width={W} height={H} role="img" aria-label={`Photo confidence ${score.toFixed(1)} out of 10`} style={{ width: size, height: 'auto', display: 'block' }} />;
}

const mono = "'JetBrains Mono','SF Mono',monospace", sans = "'Inter',-apple-system,sans-serif";

/** The card on the grade screen: medallion, band, how far to trust the grade, what to fix. */
export function PhotoConfidenceCard({ result }) {
  if (!result) return null;
  const band = bandFor(result.score);
  const problems = problemsFor(result.issues, result.cutoff).slice(0, 3);
  return (
    <div style={{ display: 'flex', gap: 14, alignItems: 'center', padding: 14, background: '#0d0f13', borderRadius: 12, border: '1px solid #1a1c22', marginBottom: 12 }}>
      <ConfidenceMedallion score={result.score} issues={result.issues} cutoff={result.cutoff} size={112} />
      <div style={{ minWidth: 0, display: 'grid', gap: 6 }}>
        <div style={{ fontFamily: mono, fontSize: 11, letterSpacing: '.14em', textTransform: 'uppercase', color: '#d9b56a', fontWeight: 700 }}>Photo confidence · {band.name}</div>
        <div style={{ fontFamily: sans, fontSize: 13, color: '#ccc', lineHeight: 1.45 }}>{band.msg}</div>
        {problems.length > 0 && (
          <ul style={{ margin: 0, paddingLeft: 16, display: 'grid', gap: 4 }}>
            {problems.map((p) => <li key={p.key} style={{ fontFamily: sans, fontSize: 12, color: '#999', lineHeight: 1.4 }}><span style={{ color: '#ffd89a' }}>{p.label}.</span> {p.fix}</li>)}
          </ul>
        )}
      </div>
    </div>
  );
}

export default PhotoConfidenceCard;
