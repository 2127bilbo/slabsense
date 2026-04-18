/**
 * Sparkle Engine
 *
 * Renders four-point / eight-point star sparkles on a canvas.
 * Used by both HoloLogo and HoloCard components.
 */

/**
 * Create a random star field
 */
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
      hue: Math.random() * 360,
    });
  }

  return stars;
}

/**
 * Render sparkles to a canvas context
 */
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

/**
 * Render sparkles for idle pulse (synthetic tilt)
 */
export function renderIdlePulse(ctx, width, height, stars, pulseProgress, config) {
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

export default { createSparkleField, renderSparkles, renderIdlePulse };
