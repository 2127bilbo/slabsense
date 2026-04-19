/**
 * HoloLogo Component
 *
 * Interactive holographic logo with layered effects:
 * 1. Background - CSS gradient from config
 * 2. Surface Effect - Metallic sweep that moves with tilt
 * 3. Sparkle Canvas - Cosmic dust stars
 * 4. Logo Image - Chrome SS/SlabSense with screen blend
 * 5. Chrome Tint - Color overlay
 * 6. Text Glare - Sharp white band sweep
 */

import React, { useRef, useEffect, useState, useCallback } from 'react';
import { createSparkleField, renderSparkles, renderIdlePulse } from '../../lib/sparkle-engine.js';

export function HoloLogo({
  size = 280,
  gyroInput,
  config,
  showSparkles = true,
}) {
  const canvasRef = useRef(null);
  const starsRef = useRef(null);
  const animationRef = useRef(null);
  const lastInteractionRef = useRef(Date.now());

  const [tiltData, setTiltData] = useState({ xP: 50, yP: 50, angle: 0, tiltDist: 0 });
  const [idlePulseActive, setIdlePulseActive] = useState(false);
  const [idlePulseProgress, setIdlePulseProgress] = useState(0);

  const sparkleConfig = config?.sparkles || {
    count: 90,
    sizeMin: 2,
    sizeMax: 5,
    motionOnly: false,
    deadZone: 0.15,
    rampPower: 1.8,
  };

  const idlePulseConfig = sparkleConfig.idlePulse || {
    enabled: true,
    intervalSeconds: 12,
    durationSeconds: 2,
  };

  // Initialize star field
  useEffect(() => {
    starsRef.current = createSparkleField(sparkleConfig);
  }, [sparkleConfig.count, sparkleConfig.sizeMin, sparkleConfig.sizeMax]);

  // Subscribe to gyro input
  useEffect(() => {
    if (!gyroInput) return;

    const unsub = gyroInput.subscribe(data => {
      setTiltData(data);
      if (data.tiltDist > 0.05) {
        lastInteractionRef.current = Date.now();
        setIdlePulseActive(false);
      }
    });

    return unsub;
  }, [gyroInput]);

  // Idle pulse timer
  useEffect(() => {
    if (!idlePulseConfig.enabled) return;

    const interval = setInterval(() => {
      const elapsed = (Date.now() - lastInteractionRef.current) / 1000;
      if (elapsed > idlePulseConfig.intervalSeconds && !idlePulseActive) {
        setIdlePulseActive(true);
        setIdlePulseProgress(0);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [idlePulseConfig.enabled, idlePulseConfig.intervalSeconds, idlePulseActive]);

  // Idle pulse animation
  useEffect(() => {
    if (!idlePulseActive) return;

    const duration = idlePulseConfig.durationSeconds * 1000;
    const startTime = Date.now();

    const animate = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      setIdlePulseProgress(progress);

      if (progress < 1) {
        animationRef.current = requestAnimationFrame(animate);
      } else {
        setIdlePulseActive(false);
      }
    };

    animationRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [idlePulseActive, idlePulseConfig.durationSeconds]);

  // Render sparkles - continuous mode (runs independent animation loop)
  useEffect(() => {
    if (!sparkleConfig.continuous) return;
    if (!showSparkles || !canvasRef.current || !starsRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;

    canvas.width = size * dpr;
    canvas.height = size * dpr;

    let running = true;
    const animate = () => {
      if (!running) return;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(dpr, dpr);
      renderSparkles(ctx, size, size, starsRef.current, tiltData, sparkleConfig);
      animationRef.current = requestAnimationFrame(animate);
    };
    animate();

    return () => {
      running = false;
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [size, showSparkles, sparkleConfig.continuous]);

  // Render sparkles - motion-based mode
  useEffect(() => {
    if (sparkleConfig.continuous) return;
    if (!showSparkles || !canvasRef.current || !starsRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;

    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.scale(dpr, dpr);

    if (idlePulseActive) {
      renderIdlePulse(ctx, size, size, starsRef.current, idlePulseProgress, sparkleConfig);
    } else {
      renderSparkles(ctx, size, size, starsRef.current, tiltData, sparkleConfig);
    }
  }, [tiltData, size, showSparkles, sparkleConfig, idlePulseActive, idlePulseProgress]);

  // Compute surface effect gradient
  const computeSurfaceFX = useCallback(() => {
    const effectId = config?.surfaceEffect || 'gold_pulse';
    const effectConfig = config?.availableOptions?.surfaceEffects?.[effectId];
    if (!effectConfig) return { background: 'transparent', opacity: 0 };

    const { angle, tiltDist, xP, yP } = tiltData;
    const a = angle;
    const band = 10 + xP * 0.5 + yP * 0.4;
    const [r, g, b] = effectConfig.color;
    const iO = effectConfig.innerOpacity;
    const oO = effectConfig.outerOpacity;
    const bw = effectConfig.bandWidth;

    const opacity = Math.max(tiltDist * 0.85, 0.06);

    const gradient = `linear-gradient(${a}deg,
      transparent ${band - bw}%,
      rgba(${r},${g},${b},${oO}) ${band - bw / 2}%,
      rgba(${r},${g},${b},${iO}) ${band - 3}%,
      rgba(${Math.min(r * 1.1, 255)},${Math.min(g * 1.1, 255)},${Math.min(b * 1.1, 255)},${iO + 0.04}) ${band}%,
      rgba(${r},${g},${b},${iO}) ${band + 3}%,
      rgba(${r},${g},${b},${oO}) ${band + bw / 2}%,
      transparent ${band + bw}%
    )`;

    return { background: gradient, opacity };
  }, [tiltData, config]);

  // Compute glare gradient
  const computeGlare = useCallback(() => {
    const glareId = config?.textGlare || 'sharp_band';
    const glareConfig = config?.availableOptions?.textGlares?.[glareId];
    if (!glareConfig) return { background: 'transparent', opacity: 0 };

    const { angle, tiltDist, xP, yP } = tiltData;
    const a = angle;
    const gpos = 10 + xP * 0.4 + yP * 0.5;
    const bw = glareConfig.bandWidth;
    const peak = glareConfig.peakOpacity;
    const falloff = glareConfig.falloffOpacity;
    const opacity = tiltDist * 0.95;

    const gradient = `linear-gradient(${a}deg,
      transparent ${gpos - bw}%,
      rgba(255,255,255,${falloff}) ${gpos - bw / 2}%,
      rgba(255,255,255,${peak * 0.55}) ${gpos - 1}%,
      rgba(255,255,255,${peak}) ${gpos}%,
      rgba(255,255,255,${peak * 0.55}) ${gpos + 1}%,
      rgba(255,255,255,${falloff}) ${gpos + bw / 2}%,
      transparent ${gpos + bw}%
    )`;

    return { background: gradient, opacity };
  }, [tiltData, config]);

  // Get background CSS
  const getBackground = () => {
    const bgId = config?.background || 'void';
    const bgConfig = config?.availableOptions?.backgrounds?.[bgId];
    return bgConfig?.css || 'radial-gradient(ellipse at 50% 50%, #0a0a10 0%, #030305 50%, #000 100%)';
  };

  // Get chrome tint
  const getChromeTint = () => {
    const tintId = config?.chromeTint || 'original';
    const tintConfig = config?.availableOptions?.chromeTints?.[tintId];
    return tintConfig || { color: 'transparent', blendMode: 'normal' };
  };

  // 3D tilt transform
  const rotateX = (tiltData.yP - 50) * 0.18;
  const rotateY = (tiltData.xP - 50) * -0.18;

  const surfaceFX = computeSurfaceFX();
  const glareFX = computeGlare();
  const chromeTint = getChromeTint();

  return (
    <div
      style={{
        width: size,
        height: size,
        position: 'relative',
        borderRadius: size * 0.12,
        overflow: 'hidden',
        transform: `perspective(600px) rotateX(${rotateX}deg) rotateY(${rotateY}deg)`,
        transition: 'transform 0.1s ease-out',
      }}
    >
      {/* Layer 1: Background */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: getBackground(),
        }}
      />

      {/* Layer 2: Surface Effect */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: surfaceFX.background,
          opacity: surfaceFX.opacity,
          mixBlendMode: 'screen',
          transition: 'opacity 0.15s ease-out',
        }}
      />

      {/* Layer 3: Sparkle Canvas */}
      {showSparkles && (
        <canvas
          ref={canvasRef}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            pointerEvents: 'none',
          }}
        />
      )}

      {/* Layer 4: Logo Image */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: 'url(/slabsense-logo.png)',
          backgroundSize: '92%',
          backgroundPosition: 'center 48%',
          backgroundRepeat: 'no-repeat',
          mixBlendMode: 'screen',
        }}
      />

      {/* Layer 5: Chrome Tint */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: chromeTint.color,
          mixBlendMode: chromeTint.blendMode,
          pointerEvents: 'none',
        }}
      />

      {/* Layer 6: Text Glare */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: glareFX.background,
          opacity: glareFX.opacity,
          mixBlendMode: 'overlay',
          transition: 'opacity 0.15s ease-out',
          pointerEvents: 'none',
        }}
      />
    </div>
  );
}

export default HoloLogo;
