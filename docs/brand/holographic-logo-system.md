# SlabSense — Holographic Logo & Sparkle System Handoff

Complete implementation guide for the interactive holographic logo and card collection sparkle effects. All visual options are driven by a single JSON config file so Bob can tweak values during beta without code changes.

## Architecture Overview

```
config/holo-config.json        ← Bob edits this to change look & feel
src/lib/sparkle-engine.js      ← Shared sparkle renderer (logo + cards)
src/lib/gyro-input.js          ← Shared gyroscope/mouse input handler
src/components/HoloLogo.jsx    ← App logo with all layered effects
src/components/HoloCard.jsx    ← Collection card with sparkle overlay
```

**Key principle:** One gyroscope input feeds everything. One sparkle engine renders everywhere. Config controls the look.

---

## The Config File

`config/holo-config.json` — Bob changes values here to adjust everything during beta.

```json
{
  "logo": {
    "background": "void",
    "surfaceEffect": "gold_pulse",
    "chromeTint": "original",
    "textGlare": "sharp_band",

    "sparkles": {
      "count": 90,
      "sizeMin": 2,
      "sizeMax": 5,
      "style": "cosmic_dust",
      "motionOnly": false,
      "idlePulse": {
        "enabled": true,
        "intervalSeconds": 12,
        "durationSeconds": 2
      },
      "deadZone": 0.15,
      "rampPower": 1.8
    }
  },

  "collectionCards": {
    "sparkles": {
      "count": 12,
      "sizeMin": 2,
      "sizeMax": 4,
      "style": "cosmic_dust",
      "motionOnly": true,
      "deadZone": 0.12,
      "rampPower": 1.5,
      "maxVisibleCanvases": 8
    }
  },

  "availableOptions": {
    "backgrounds": {
      "void": {
        "label": "Void",
        "css": "radial-gradient(ellipse at 50% 50%, #0a0a10 0%, #030305 50%, #000 100%)"
      },
      "abyss": {
        "label": "Abyss",
        "css": "radial-gradient(ellipse at 50% 50%, #060614 0%, #000006 60%, #000 100%)"
      },
      "midnight": {
        "label": "Midnight",
        "css": "radial-gradient(ellipse at 50% 30%, #0c0c30 0%, transparent 50%), radial-gradient(ellipse at 50% 70%, #0a0a22 0%, transparent 50%), radial-gradient(#040410, #010108)"
      },
      "ember": {
        "label": "Ember",
        "css": "radial-gradient(ellipse at 30% 70%, #200a08 0%, transparent 50%), radial-gradient(ellipse at 70% 30%, #201200 0%, transparent 50%), radial-gradient(#0a0505, #030202)"
      }
    },

    "surfaceEffects": {
      "gold_pulse": {
        "label": "Gold Pulse",
        "type": "metallic",
        "color": [200, 160, 80],
        "innerOpacity": 0.14,
        "outerOpacity": 0.06,
        "bandWidth": 20
      },
      "ice": {
        "label": "Ice Crystal",
        "type": "metallic",
        "color": [160, 200, 240],
        "innerOpacity": 0.12,
        "outerOpacity": 0.05,
        "bandWidth": 22
      },
      "emerald_glow": {
        "label": "Emerald Glow",
        "type": "metallic",
        "color": [60, 180, 100],
        "innerOpacity": 0.12,
        "outerOpacity": 0.05,
        "bandWidth": 20
      },
      "silver_shimmer": {
        "label": "Silver Shimmer",
        "type": "metallic",
        "color": [220, 220, 240],
        "innerOpacity": 0.14,
        "outerOpacity": 0.06,
        "bandWidth": 20
      }
    },

    "chromeTints": {
      "original": {
        "label": "Original",
        "color": "transparent",
        "blendMode": "normal"
      },
      "bronze": {
        "label": "Bronze",
        "color": "rgba(170, 115, 55, 0.4)",
        "blendMode": "color"
      },
      "darkgold": {
        "label": "Dark Gold",
        "color": "rgba(170, 145, 55, 0.4)",
        "blendMode": "color"
      },
      "ice_blue": {
        "label": "Ice Blue",
        "color": "rgba(80, 130, 190, 0.35)",
        "blendMode": "color"
      },
      "carbon": {
        "label": "Carbon",
        "color": "rgba(90, 100, 130, 0.45)",
        "blendMode": "color"
      }
    },

    "textGlares": {
      "sharp_band": {
        "label": "Sharp Band",
        "bandWidth": 10,
        "peakOpacity": 0.4,
        "falloffOpacity": 0.06
      }
    }
  }
}
```

### How Bob uses this file

To change the background from "void" to "midnight":
```json
"background": "midnight"
```

To make sparkles motion-only (no sparkles when phone is flat):
```json
"motionOnly": true
```

To reduce sparkle count:
```json
"count": 50
```

To increase the dead zone (bigger tilt needed before effects start):
```json
"deadZone": 0.25
```

To disable the idle pulse glint:
```json
"idlePulse": { "enabled": false }
```

To make collection card sparkles always-on instead of motion-only:
```json
"collectionCards.sparkles.motionOnly": false
```

No code changes needed for any of these. Just edit the JSON, redeploy.

---

## The Logo Image

The SS and SlabSense text comes from a static image file: `public/slabsense-logo.png` (or .webp)

**This is the clean version Bob provided with a pure black background.** The black disappears when rendered with CSS `mix-blend-mode: screen`, leaving only the chrome text visible.

The image should be stored in `public/` and referenced by the HoloLogo component. Do NOT attempt to recreate the SS letterforms with fonts or SVG — the exact shapes, bevel, chrome reflections, and layout are baked into this image and must be preserved exactly.

**Logo sizing within the frame:** `background-size: 92%; background-position: center 48%` gave the best framing in testing.

---

## Component 1: Gyroscope / Mouse Input (Shared)

`src/lib/gyro-input.js`

Single source of tilt data for the entire app. Used by both the logo and collection sparkles.

```javascript
export function createGyroInput(config) {
  let xP = 50, yP = 50; // percentage 0-100
  let gyroAvailable = false;
  let listeners = [];

  function computeDerived(rawX, rawY) {
    const angle = Math.atan2(rawY - 50, rawX - 50) * (180 / Math.PI) + 180;
    const rawTiltDist = Math.sqrt((rawX - 50) ** 2 + (rawY - 50) ** 2) / 50;

    // Dead zone + ramp curve
    const deadZone = config.deadZone || 0.15;
    const rampPower = config.rampPower || 1.8;
    const effectiveTilt = rawTiltDist <= deadZone
      ? 0
      : Math.pow((rawTiltDist - deadZone) / (1 - deadZone), rampPower);

    return { xP: rawX, yP: rawY, angle, tiltDist: effectiveTilt, rawTiltDist };
  }

  function notify(rawX, rawY) {
    xP = rawX; yP = rawY;
    const data = computeDerived(rawX, rawY);
    listeners.forEach(fn => fn(data));
  }

  // Mouse (desktop)
  document.addEventListener('mousemove', e => {
    if (gyroAvailable) return;
    notify((e.clientX / window.innerWidth) * 100, (e.clientY / window.innerHeight) * 100);
  });

  // Gyroscope (mobile)
  function handleGyro(e) {
    gyroAvailable = true;
    const x = Math.max(0, Math.min(100, 50 + (e.gamma || 0) * 1.5));
    const y = Math.max(0, Math.min(100, 50 + ((e.beta || 0) - 40) * 1.2));
    notify(x, y);
  }

  // iOS permission request
  function requestPermission() {
    if (typeof DeviceOrientationEvent !== 'undefined' &&
        typeof DeviceOrientationEvent.requestPermission === 'function') {
      return DeviceOrientationEvent.requestPermission()
        .then(r => {
          if (r === 'granted') window.addEventListener('deviceorientation', handleGyro);
          return r;
        });
    } else if (typeof DeviceOrientationEvent !== 'undefined') {
      window.addEventListener('deviceorientation', handleGyro);
      return Promise.resolve('granted');
    }
    return Promise.resolve('unavailable');
  }

  function subscribe(fn) {
    listeners.push(fn);
    return () => { listeners = listeners.filter(l => l !== fn); };
  }

  return { subscribe, requestPermission, getCurrentTilt: () => computeDerived(xP, yP) };
}
```

**One instance created at app init, passed to all components that need it.**

---

## Component 2: Sparkle Engine (Shared)

`src/lib/sparkle-engine.js`

Renders four-point / eight-point star sparkles on a canvas. Used by both HoloLogo and HoloCard.

```javascript
export function createSparkleField(config) {
  const { count, sizeMin, sizeMax } = config;
  const stars = [];
  for (let i = 0; i < count; i++) {
    stars.push({
      x: 0.04 + Math.random() * 0.92,
      y: 0.04 + Math.random() * 0.92,
      size: sizeMin + Math.random() * (sizeMax - sizeMin),
      phase: Math.random() * Math.PI * 2,
      speed: 1 + Math.random() * 2.5,
      hue: Math.random() * 360
    });
  }
  return stars;
}

export function renderSparkles(ctx, width, height, stars, tiltData, config) {
  const { tiltDist, angle, xP, yP } = tiltData;

  // If motionOnly and below dead zone, don't render
  if (config.motionOnly && tiltDist <= 0) {
    ctx.clearRect(0, 0, width, height);
    return;
  }

  ctx.clearRect(0, 0, width, height);

  stars.forEach(s => {
    // Brightness based on tilt angle + star's unique phase
    let raw = Math.cos(angle * (Math.PI / 180) * s.speed / 60 + s.phase + tiltDist * 2.5);
    let brightness = raw > 0.05 ? Math.pow((raw - 0.05) / 0.95, 0.75) : 0;
    brightness *= (0.2 + tiltDist * 1.3);
    brightness = Math.min(brightness, 1);

    if (brightness < 0.02) return;

    const cx = s.x * width;
    const cy = s.y * height;
    const sz = s.size;
    const hue = (s.hue + xP * 3 + yP * 2) % 360;

    // Glow
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, sz * 3);
    g.addColorStop(0, `rgba(255,255,255,${brightness * 0.8})`);
    g.addColorStop(0.2, `hsla(${hue},40%,90%,${brightness * 0.3})`);
    g.addColorStop(1, 'transparent');
    ctx.fillStyle = g;
    ctx.fillRect(cx - sz * 4, cy - sz * 4, sz * 8, sz * 8);

    // Star spikes (8-point)
    ctx.save();
    ctx.translate(cx, cy);
    ctx.globalAlpha = brightness;
    ctx.fillStyle = '#fff';

    for (let r = 0; r < 4; r++) {
      ctx.save();
      ctx.rotate(r * Math.PI / 4);
      const spikeSz = r % 2 === 0 ? sz : sz * 0.45;

      // Upward spike
      ctx.beginPath();
      ctx.moveTo(0, -spikeSz * 2.8);
      ctx.bezierCurveTo(spikeSz * 0.06, -spikeSz * 0.2, spikeSz * 0.06, 0, 0, 0);
      ctx.bezierCurveTo(-spikeSz * 0.06, 0, -spikeSz * 0.06, -spikeSz * 0.2, 0, -spikeSz * 2.8);
      ctx.fill();

      // Downward spike
      ctx.beginPath();
      ctx.moveTo(0, spikeSz * 2.8);
      ctx.bezierCurveTo(spikeSz * 0.06, spikeSz * 0.2, spikeSz * 0.06, 0, 0, 0);
      ctx.bezierCurveTo(-spikeSz * 0.06, 0, -spikeSz * 0.06, spikeSz * 0.2, 0, spikeSz * 2.8);
      ctx.fill();

      ctx.restore();
    }

    // Hot center dot
    ctx.beginPath();
    ctx.arc(0, 0, sz * 0.25, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255,255,255,${Math.min(brightness * 1.3, 1)})`;
    ctx.fill();

    ctx.restore();
    ctx.globalAlpha = 1;
  });
}
```

---

## Component 3: HoloLogo

`src/components/HoloLogo.jsx`

The app icon/logo with all layered effects.

### Layer stack (bottom to top):

1. **Background** — CSS gradient from config, fills the container
2. **Surface Effect** — CSS gradient that sweeps with tilt, `mix-blend-mode: screen`
3. **Sparkle Canvas** — Canvas element rendering cosmic dust stars
4. **Logo Image** — The clean black-background SS/SlabSense image, `mix-blend-mode: screen` (black disappears, chrome shows)
5. **Chrome Tint** — Solid color overlay, `mix-blend-mode: color` (tints the chrome without destroying metallic quality)
6. **Text Glare** — Sharp white gradient band that sweeps with tilt, `mix-blend-mode: overlay`

### Props:

```jsx
<HoloLogo
  size={280}           // pixel width/height
  gyroInput={gyroInput} // shared gyro input instance
  config={holoConfig}   // from JSON
  showSparkles={true}   // false for tiny sizes if performance matters
/>
```

### The surface effect sweep (dynamic, computed per frame):

```javascript
function computeSurfaceFX(effectId, config, tiltData) {
  const { angle, tiltDist, xP, yP } = tiltData;
  const a = angle;
  const band = 10 + xP * 0.5 + yP * 0.4;
  const effectConfig = config.availableOptions.surfaceEffects[effectId];
  const [r, g, b] = effectConfig.color;
  const iO = effectConfig.innerOpacity;
  const oO = effectConfig.outerOpacity;
  const bw = effectConfig.bandWidth;

  const opacity = Math.max(tiltDist * 0.85, 0.06);

  const gradient = `linear-gradient(${a}deg,
    transparent ${band - bw}%,
    rgba(${r},${g},${b},${oO}) ${band - bw/2}%,
    rgba(${r},${g},${b},${iO}) ${band - 3}%,
    rgba(${r*1.1},${g*1.1},${b*1.1},${iO + 0.04}) ${band}%,
    rgba(${r},${g},${b},${iO}) ${band + 3}%,
    rgba(${r},${g},${b},${oO}) ${band + bw/2}%,
    transparent ${band + bw}%
  )`;

  return { background: gradient, opacity };
}
```

### The sharp band glare (dynamic, computed per frame):

```javascript
function computeGlare(glareId, config, tiltData) {
  const { angle, tiltDist, xP, yP } = tiltData;
  const a = angle;
  const gpos = 10 + xP * 0.4 + yP * 0.5;
  const glareConfig = config.availableOptions.textGlares[glareId];
  const bw = glareConfig.bandWidth;
  const peak = glareConfig.peakOpacity;
  const falloff = glareConfig.falloffOpacity;
  const opacity = tiltDist * 0.95;

  const gradient = `linear-gradient(${a}deg,
    transparent ${gpos - bw}%,
    rgba(255,255,255,${falloff}) ${gpos - bw/2}%,
    rgba(255,255,255,${peak * 0.55}) ${gpos - 1}%,
    rgba(255,255,255,${peak}) ${gpos}%,
    rgba(255,255,255,${peak * 0.55}) ${gpos + 1}%,
    rgba(255,255,255,${falloff}) ${gpos + bw/2}%,
    transparent ${gpos + bw}%
  )`;

  return { background: gradient, opacity };
}
```

### Idle pulse behavior:

```javascript
function useIdlePulse(config, gyroInput) {
  const { enabled, intervalSeconds, durationSeconds } = config.sparkles.idlePulse;
  const [idleActive, setIdleActive] = useState(false);
  const lastInteraction = useRef(Date.now());

  useEffect(() => {
    if (!enabled) return;

    const interval = setInterval(() => {
      const elapsed = (Date.now() - lastInteraction.current) / 1000;
      if (elapsed > intervalSeconds) {
        // Trigger brief shimmer
        setIdleActive(true);
        setTimeout(() => setIdleActive(false), durationSeconds * 1000);
      }
    }, 1000);

    const unsub = gyroInput.subscribe(() => {
      lastInteraction.current = Date.now();
      setIdleActive(false);
    });

    return () => { clearInterval(interval); unsub(); };
  }, [enabled, intervalSeconds, durationSeconds]);

  return idleActive;
}
```

When `idleActive` is true, feed a gentle synthetic tilt to the sparkle renderer for the pulse duration. When false and no real input, everything stays still.

### 3D tilt transform:

```javascript
const rotateX = (yP - 50) * 0.18;
const rotateY = (xP - 50) * -0.18;
element.style.transform = `perspective(600px) rotateX(${rotateX}deg) rotateY(${rotateY}deg)`;
```

### iOS gyroscope permission:

Must be triggered by a user gesture (tap). The app should call `gyroInput.requestPermission()` on the first tap anywhere in the app. This enables the gyroscope for the rest of the session. Without this, iOS Safari silently ignores deviceorientation events.

---

## Component 4: HoloCard (Collection View)

`src/components/HoloCard.jsx`

Sparkle overlay for holo cards in the collection view.

### When to apply:

Only when `card.variants.holo === true` OR `card.variants.reverse === true` (data from tcgdex API). Non-holo cards render normally with zero sparkle overhead.

### Props:

```jsx
<HoloCard
  card={cardData}        // tcgdex card object
  gyroInput={gyroInput}  // shared gyro input
  config={holoConfig.collectionCards}
>
  {/* Normal card image/content renders inside */}
  <img src={card.image} />
</HoloCard>
```

### Performance: IntersectionObserver

**Critical for performance.** Do NOT run sparkle canvases on cards scrolled off-screen.

```javascript
function useVisibility(ref) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!ref.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(entry.isIntersecting),
      { threshold: 0.1 }
    );
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);

  return visible;
}
```

When `visible === false`:
- Canvas render loop paused
- Gyro subscription paused
- Zero CPU cost

When `visible === true`:
- Canvas activates
- Subscribes to shared gyro input
- Renders sparkles

### Max visible canvases:

Config has `maxVisibleCanvases: 8`. If more than 8 holo cards are visible simultaneously (large screen, small thumbnails), only the first 8 get active sparkle canvases. The rest show without sparkles until others scroll out. This prevents performance issues on scroll-heavy views.

### Star uniqueness per card:

Each HoloCard instance generates its own star field with `createSparkleField(config)`. Since positions are randomized, every card sparkles differently despite sharing the same gyro input. This matches how real holo cards each catch light uniquely.

---

## The Logo Image File

The clean logo file (`public/slabsense-logo.png`) must be the version Bob provided with:
- Pure black (#000000) background
- Chrome/silver SS letterforms (staggered, overlapping, beveled edges)
- "SlabSense" text overlaid across the lower portion of the SS
- No background elements, no galaxy, no waves — just the text on black

This file is referenced by HoloLogo and rendered with `mix-blend-mode: screen`. The black pixels become fully transparent, the chrome pixels show through. All visual effects (background, sparkles, surface sweep, glare) layer independently around/behind/over this text.

**Do NOT modify, recolor, or filter this image in code.** The chrome tint layer handles color shifts via blend modes.

---

## Where things render in the app

### App header (always visible):
```jsx
<HoloLogo size={48} gyroInput={gyroInput} config={config.logo} showSparkles={true} />
```
Small but sparkles are on (48px sparkles will be subtle dots, which is fine).

### Splash / loading screen:
```jsx
<HoloLogo size={280} gyroInput={gyroInput} config={config.logo} showSparkles={true} />
```
Full size, full effect.

### Collection view:
```jsx
{cards.map(card => (
  card.variants?.holo || card.variants?.reverse ? (
    <HoloCard key={card.id} card={card} gyroInput={gyroInput} config={config.collectionCards}>
      <img src={getImageUrl(card.id)} />
    </HoloCard>
  ) : (
    <div key={card.id}><img src={getImageUrl(card.id)} /></div>
  )
))}
```

---

## Config Adjustments Bob Will Make During Beta

These are the values Bob will want to tweak based on user feedback. All are in `holo-config.json`:

| What to adjust | Config path | Default | Range |
|---|---|---|---|
| Background style | `logo.background` | `"void"` | void, abyss, midnight, ember |
| Surface effect | `logo.surfaceEffect` | `"gold_pulse"` | gold_pulse, ice, emerald_glow, silver_shimmer |
| Chrome tint | `logo.chromeTint` | `"original"` | original, bronze, darkgold, ice_blue, carbon |
| Logo sparkle count | `logo.sparkles.count` | `90` | 20-120 |
| Logo sparkles motion-only | `logo.sparkles.motionOnly` | `false` | true/false |
| Dead zone threshold | `logo.sparkles.deadZone` | `0.15` | 0.0-0.4 |
| Ramp-up curve | `logo.sparkles.rampPower` | `1.8` | 1.0-3.0 |
| Idle pulse on/off | `logo.sparkles.idlePulse.enabled` | `true` | true/false |
| Idle pulse frequency | `logo.sparkles.idlePulse.intervalSeconds` | `12` | 5-30 |
| Card sparkle count | `collectionCards.sparkles.count` | `12` | 5-25 |
| Card sparkles motion-only | `collectionCards.sparkles.motionOnly` | `true` | true/false |
| Card dead zone | `collectionCards.sparkles.deadZone` | `0.12` | 0.0-0.3 |

---

## File Manifest

New files:
- `config/holo-config.json` — all visual config, Bob edits this
- `public/slabsense-logo.png` — clean logo image (black background)
- `src/lib/gyro-input.js` — shared gyroscope/mouse input singleton
- `src/lib/sparkle-engine.js` — shared star renderer
- `src/components/HoloLogo.jsx` — the layered holographic logo component
- `src/components/HoloCard.jsx` — sparkle overlay for collection holo cards

Modified files:
- `src/App.jsx` — init gyro input at app level, pass to components, use HoloLogo in header

---

## Implementation Order

1. Create `holo-config.json` with all defaults
2. Add `slabsense-logo.png` to `public/`
3. Build `gyro-input.js` — test with console.log on tilt values
4. Build `sparkle-engine.js` — test standalone on a blank canvas
5. Build `HoloLogo.jsx` — layer stack, wire to gyro + sparkle engine + config
6. Wire HoloLogo into app header and splash screen
7. Build `HoloCard.jsx` with IntersectionObserver
8. Wire HoloCard into collection view (only for holo/reverse-holo cards per tcgdex variants data)
9. Test on iPhone — verify gyro permission flow, sparkle performance, dead zone behavior
10. Bob adjusts config values based on feel and user feedback

---

## Known Considerations

- **iOS gyro permission:** Must be triggered by a user tap. Call `gyroInput.requestPermission()` on the very first tap anywhere in the app. Cannot be called on page load — Safari silently ignores it.
- **Canvas DPI:** Set canvas width/height to `element.clientWidth * 2` and `element.clientHeight * 2` for retina displays, then scale with CSS `width: 100%; height: 100%`.
- **Performance on older phones:** If frame rate drops below 30fps with many holo cards visible, reduce `maxVisibleCanvases` in config. The IntersectionObserver pattern ensures unused canvases cost zero.
- **PWA caching:** The logo image and config JSON should be included in the service worker cache manifest so they work offline.
- **Config hot-reload:** During dev, consider watching `holo-config.json` for changes and re-applying without full page reload. Nice for Bob's tweaking workflow but not required for production.
