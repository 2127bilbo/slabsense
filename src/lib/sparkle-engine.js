/**
 * Sparkle Engine
 *
 * Renders four-point / eight-point star sparkles on a canvas.
 * Used by both HoloLogo and HoloCard components.
 *
 * Supports two modes:
 * - Motion-based: sparkles respond to tilt/mouse movement
 * - Continuous: sparkles randomly appear, twinkle, and reposition
 */

/**
 * Create a random star field
 */
export function createSparkleField(config) {
  const { count, sizeMin, sizeMax, useColorPalette } = config;
  const stars = [];

  for (let i = 0; i < count; i++) {
    stars.push({
      x: 0.04 + Math.random() * 0.92,
      y: 0.04 + Math.random() * 0.92,
      size: sizeMin + Math.random() * (sizeMax - sizeMin),
      phase: Math.random() * Math.PI * 2,
      speed: 1 + Math.random() * 2.5,
      hue: Math.random() * 360,
      // Assign a color from palette if enabled, otherwise null (white)
      color: useColorPalette ? VIBRANT_COLORS[Math.floor(Math.random() * VIBRANT_COLORS.length)] : null,
      // For continuous mode
      lifeStart: Date.now() - Math.random() * 1000, // Stagger start times
      lifeDuration: 500 + Math.random() * 500, // 0.5-1.0s per cycle (quick flash)
      // Track recent positions to avoid repeats
      recentPositions: [],
    });
  }

  return stars;
}

/**
 * Get distance between two points (0-1 normalized space)
 */
function getDistance(x1, y1, x2, y2) {
  return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
}

/**
 * Find a new position that's far from recent positions
 */
function findNewPosition(recentPositions, minDistance = 0.25, maxAttempts = 20) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const newX = 0.04 + Math.random() * 0.92;
    const newY = 0.04 + Math.random() * 0.92;

    // Check distance from all recent positions
    let tooClose = false;
    for (const pos of recentPositions) {
      if (getDistance(newX, newY, pos.x, pos.y) < minDistance) {
        tooClose = true;
        break;
      }
    }

    if (!tooClose) {
      return { x: newX, y: newY };
    }
  }

  // Fallback: return random position if can't find good one
  return { x: 0.04 + Math.random() * 0.92, y: 0.04 + Math.random() * 0.92 };
}

/**
 * Reposition a star to a new random location, avoiding recent spots
 */
function repositionStar(star, config) {
  // Find new position far from recent ones
  const newPos = findNewPosition(star.recentPositions, 0.25);

  // Track this position (keep last 5)
  star.recentPositions.push({ x: star.x, y: star.y });
  if (star.recentPositions.length > 5) {
    star.recentPositions.shift();
  }

  star.x = newPos.x;
  star.y = newPos.y;
  star.size = config.sizeMin + Math.random() * (config.sizeMax - config.sizeMin);
  star.hue = Math.random() * 360;
  // Assign new random color if using palette
  if (config.useColorPalette) {
    star.color = VIBRANT_COLORS[Math.floor(Math.random() * VIBRANT_COLORS.length)];
  }
  star.lifeStart = Date.now();
  star.lifeDuration = 500 + Math.random() * 500; // 0.5-1.0s quick flash
}

// Vibrant color palette for collection cards
const VIBRANT_COLORS = [
  { r: 255, g: 255, b: 255 }, // White
  { r: 0, g: 255, b: 255 },   // Cyan
  { r: 0, g: 150, b: 255 },   // Blue
  { r: 0, g: 255, b: 150 },   // Green
  { r: 255, g: 215, b: 0 },   // Gold
  { r: 255, g: 140, b: 0 },   // Orange
  { r: 255, g: 80, b: 80 },   // Red
  { r: 255, g: 100, b: 255 }, // Magenta
  { r: 180, g: 100, b: 255 }, // Purple
  { r: 255, g: 255, b: 150 }, // Light Yellow
];

/**
 * Draw a single sparkle
 * @param color - optional {r,g,b} object. If not provided, uses white
 */
function drawSparkle(ctx, cx, cy, sz, brightness, color = null) {
  if (brightness < 0.02) return;

  const r = color?.r ?? 255;
  const g = color?.g ?? 255;
  const b = color?.b ?? 255;

  // Glow - brighter center with colored halo
  const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, sz * 3);
  glow.addColorStop(0, `rgba(255,255,255,${brightness * 0.9})`);
  glow.addColorStop(0.15, `rgba(${r},${g},${b},${brightness * 0.5})`);
  glow.addColorStop(0.4, `rgba(${r},${g},${b},${brightness * 0.2})`);
  glow.addColorStop(1, 'transparent');
  ctx.fillStyle = glow;
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
}

/**
 * Render sparkles in continuous mode (time-based, random repositioning)
 * Camera flash style: smooth fade in → peak → fade out
 */
export function renderContinuous(ctx, width, height, stars, config) {
  ctx.clearRect(0, 0, width, height);
  const now = Date.now();

  stars.forEach(s => {
    const elapsed = now - s.lifeStart;
    const progress = elapsed / s.lifeDuration;

    // If cycle complete, reposition
    if (progress >= 1) {
      repositionStar(s, config);
      return; // Skip this frame, will render next frame
    }

    // Camera flash: smooth bell curve (sine-based)
    // 0% = off, 50% = peak brightness, 100% = off
    // Boost brightness slightly (1.1x)
    const brightness = Math.sin(progress * Math.PI) * 1.1;

    const cx = s.x * width;
    const cy = s.y * height;

    drawSparkle(ctx, cx, cy, s.size, brightness, s.color);
  });
}

/**
 * Render sparkles to a canvas context (motion-based mode)
 */
export function renderSparkles(ctx, width, height, stars, tiltData, config) {
  // If continuous mode, use time-based animation
  if (config.continuous) {
    renderContinuous(ctx, width, height, stars, config);
    return;
  }

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

    const cx = s.x * width;
    const cy = s.y * height;

    drawSparkle(ctx, cx, cy, s.size, brightness, s.color);
  });
}

/**
 * Render sparkles for idle pulse (synthetic tilt)
 */
export function renderIdlePulse(ctx, width, height, stars, pulseProgress, config) {
  // If continuous mode, just use that
  if (config.continuous) {
    renderContinuous(ctx, width, height, stars, config);
    return;
  }

  // Create synthetic tilt data for the pulse
  const angle = pulseProgress * 360;
  const tiltDist = Math.sin(pulseProgress * Math.PI) * 0.4; // Gentle pulse

  const syntheticTilt = {
    xP: 50 + Math.cos(pulseProgress * Math.PI * 2) * 20,
    yP: 50 + Math.sin(pulseProgress * Math.PI * 2) * 20,
    angle,
    tiltDist,
    rawTiltDist: tiltDist,
  };

  renderSparkles(ctx, width, height, stars, syntheticTilt, { ...config, motionOnly: false });
}

export default { createSparkleField, renderSparkles, renderIdlePulse, renderContinuous };
