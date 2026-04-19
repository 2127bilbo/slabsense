/**
 * HoloCard Component
 *
 * Lightweight sparkle overlay for collection card thumbnails.
 * Uses shared gyro input and sparkle engine.
 * Only renders sparkles when card is visible (IntersectionObserver).
 */

import React, { useRef, useEffect, useState, memo } from 'react';
import { createSparkleField, renderSparkles } from '../../lib/sparkle-engine.js';

export const HoloCard = memo(function HoloCard({
  children,
  gyroInput,
  config,
  enabled = true,
  className = '',
  style = {},
}) {
  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const starsRef = useRef(null);
  const animationRef = useRef(null);
  const [isVisible, setIsVisible] = useState(false);
  const [tiltData, setTiltData] = useState({ xP: 50, yP: 50, angle: 0, tiltDist: 0 });
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

  const sparkleConfig = config?.sparkles || {
    count: 12,
    sizeMin: 2,
    sizeMax: 4,
    motionOnly: true,
    deadZone: 0.12,
    rampPower: 1.5,
  };

  // Initialize star field
  useEffect(() => {
    starsRef.current = createSparkleField(sparkleConfig);
  }, [sparkleConfig.count, sparkleConfig.sizeMin, sparkleConfig.sizeMax]);

  // Observe visibility
  useEffect(() => {
    if (!containerRef.current || !enabled) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsVisible(entry.isIntersecting);
      },
      { threshold: 0.1 }
    );

    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [enabled]);

  // Track container dimensions
  useEffect(() => {
    if (!containerRef.current) return;

    const updateDimensions = () => {
      const rect = containerRef.current.getBoundingClientRect();
      setDimensions({ width: rect.width, height: rect.height });
    };

    updateDimensions();
    window.addEventListener('resize', updateDimensions);
    return () => window.removeEventListener('resize', updateDimensions);
  }, []);

  // Subscribe to gyro input only when visible
  useEffect(() => {
    if (!gyroInput || !isVisible || !enabled) return;

    const unsub = gyroInput.subscribe(data => {
      setTiltData(data);
    });

    return unsub;
  }, [gyroInput, isVisible, enabled]);

  // Render sparkles
  useEffect(() => {
    if (!isVisible || !enabled || !canvasRef.current || !starsRef.current) return;
    if (dimensions.width === 0 || dimensions.height === 0) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;

    // Set canvas size for retina
    canvas.width = dimensions.width * dpr;
    canvas.height = dimensions.height * dpr;
    ctx.scale(dpr, dpr);

    // Continuous mode: run animation loop
    if (sparkleConfig.continuous) {
      let running = true;
      const animate = () => {
        if (!running) return;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.scale(dpr, dpr);
        renderSparkles(ctx, dimensions.width, dimensions.height, starsRef.current, tiltData, sparkleConfig);
        animationRef.current = requestAnimationFrame(animate);
      };
      animate();
      return () => {
        running = false;
        if (animationRef.current) cancelAnimationFrame(animationRef.current);
      };
    }

    // Motion-based mode
    renderSparkles(ctx, dimensions.width, dimensions.height, starsRef.current, tiltData, sparkleConfig);
  }, [tiltData, dimensions, isVisible, enabled, sparkleConfig]);

  // Clear canvas when not visible or disabled
  useEffect(() => {
    if ((isVisible && enabled) || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }, [isVisible, enabled]);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        ...style,
      }}
    >
      {children}

      {enabled && (
        <canvas
          ref={canvasRef}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            pointerEvents: 'none',
            zIndex: 1,
          }}
        />
      )}
    </div>
  );
});

export default HoloCard;
