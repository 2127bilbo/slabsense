/**
 * RealisticSlab - Canvas-based photorealistic slab renderer
 *
 * Creates authentic-looking grading slabs with:
 * - Realistic plastic case rendering with depth and reflections
 * - Company-specific label designs (PSA, BGS, CGC, SGC, TAG)
 * - Proper card compositing with shadows
 * - High-quality text rendering for labels
 */

import { useRef, useEffect, useState } from 'react';

// Slab dimensions (standard grading slab proportions)
const SLAB_WIDTH = 240;
const SLAB_HEIGHT = 380;
const LABEL_HEIGHT = 80;
const CARD_PADDING = 16;
const BORDER_RADIUS = 8;

// Company-specific styling
const COMPANY_STYLES = {
  psa: {
    labelBg: '#c41e3a',
    labelBgGradient: ['#d42e4a', '#a01830'],
    textColor: '#ffffff',
    accentColor: '#ffcc00',
    logoText: 'PSA',
    logoFont: 'bold 18px Arial, sans-serif',
    certPrefix: '',
  },
  bgs: {
    labelBg: '#1a1a1a',
    labelBgGradient: ['#2a2a2a', '#0a0a0a'],
    textColor: '#ffffff',
    accentColor: '#ffd700',
    logoText: 'BECKETT',
    logoFont: 'italic bold 14px Georgia, serif',
    certPrefix: '',
    hasSubgrades: true,
  },
  cgc: {
    labelBg: '#1e40af',
    labelBgGradient: ['#2563eb', '#1e3a8a'],
    textColor: '#ffffff',
    accentColor: '#60a5fa',
    logoText: 'CGC',
    logoFont: 'bold 16px Arial, sans-serif',
    certPrefix: 'CGC',
  },
  sgc: {
    labelBg: '#047857',
    labelBgGradient: ['#059669', '#065f46'],
    textColor: '#ffffff',
    accentColor: '#34d399',
    logoText: 'SGC',
    logoFont: 'bold 16px Arial, sans-serif',
    certPrefix: 'SGC',
  },
  tag: {
    labelBg: '#18181b',
    labelBgGradient: ['#27272a', '#09090b'],
    textColor: '#ffffff',
    accentColor: '#dc2626',
    logoText: 'TAG',
    logoFont: 'bold 16px Arial, sans-serif',
    logoBg: '#dc2626',
    certPrefix: 'TAG-',
  },
};

export function RealisticSlab({
  cardImage,
  company = 'tag',
  grade = '10',
  gradeLabel = 'GEM MINT',
  cardInfo = {},
  certNumber = null,
  subgrades = null,
  width = SLAB_WIDTH,
  height = SLAB_HEIGHT,
}) {
  const canvasRef = useRef(null);
  const [cardImg, setCardImg] = useState(null);
  const style = COMPANY_STYLES[company] || COMPANY_STYLES.tag;

  // Load card image
  useEffect(() => {
    if (!cardImage) return;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => setCardImg(img);
    img.src = cardImage;
  }, [cardImage]);

  // Render slab
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const scale = window.devicePixelRatio || 1;

    canvas.width = width * scale;
    canvas.height = height * scale;
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    ctx.scale(scale, scale);

    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    // Draw slab case (outer frame)
    drawSlabCase(ctx, width, height);

    // Draw card window background
    const cardY = LABEL_HEIGHT + 8;
    const cardAreaHeight = height - LABEL_HEIGHT - 24;
    const cardAreaWidth = width - CARD_PADDING * 2;

    ctx.fillStyle = '#0a0a0a';
    roundRect(ctx, CARD_PADDING, cardY, cardAreaWidth, cardAreaHeight, 4);
    ctx.fill();

    // Draw card if loaded
    if (cardImg) {
      drawCardInWindow(ctx, cardImg, CARD_PADDING + 4, cardY + 4, cardAreaWidth - 8, cardAreaHeight - 8);
    }

    // Draw plastic overlay (glass effect)
    drawPlasticOverlay(ctx, width, height, LABEL_HEIGHT);

    // Draw label
    drawLabel(ctx, width, LABEL_HEIGHT, style, {
      grade,
      gradeLabel,
      cardInfo,
      certNumber: certNumber || generateCertNumber(),
      subgrades,
      company,
    });

    // Draw bottom branding
    drawBottomBranding(ctx, width, height, style, company);

  }, [cardImg, width, height, grade, gradeLabel, cardInfo, certNumber, subgrades, company, style]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        borderRadius: BORDER_RADIUS,
        boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
      }}
    />
  );
}

function drawSlabCase(ctx, width, height) {
  // Outer case - light gray plastic
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, '#e8e8e8');
  gradient.addColorStop(0.3, '#d0d0d0');
  gradient.addColorStop(0.5, '#e0e0e0');
  gradient.addColorStop(0.7, '#c8c8c8');
  gradient.addColorStop(1, '#d8d8d8');

  ctx.fillStyle = gradient;
  roundRect(ctx, 0, 0, width, height, BORDER_RADIUS);
  ctx.fill();

  // Inner border (gives depth)
  ctx.strokeStyle = '#b0b0b0';
  ctx.lineWidth = 2;
  roundRect(ctx, 4, 4, width - 8, height - 8, BORDER_RADIUS - 2);
  ctx.stroke();

  // Another inner line for more depth
  ctx.strokeStyle = '#c8c8c8';
  ctx.lineWidth = 1;
  roundRect(ctx, 8, 8, width - 16, height - 16, BORDER_RADIUS - 4);
  ctx.stroke();
}

function drawCardInWindow(ctx, img, x, y, maxWidth, maxHeight) {
  // Calculate card dimensions maintaining aspect ratio (standard card is 2.5 x 3.5)
  const cardRatio = 2.5 / 3.5;
  let cardWidth = maxWidth - 8;
  let cardHeight = cardWidth / cardRatio;

  if (cardHeight > maxHeight - 8) {
    cardHeight = maxHeight - 8;
    cardWidth = cardHeight * cardRatio;
  }

  const cardX = x + (maxWidth - cardWidth) / 2;
  const cardY = y + (maxHeight - cardHeight) / 2;

  // Draw card shadow
  ctx.shadowColor = 'rgba(0,0,0,0.5)';
  ctx.shadowBlur = 10;
  ctx.shadowOffsetX = 2;
  ctx.shadowOffsetY = 4;

  // Draw card
  ctx.drawImage(img, cardX, cardY, cardWidth, cardHeight);

  // Reset shadow
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;

  // Card border
  ctx.strokeStyle = 'rgba(0,0,0,0.3)';
  ctx.lineWidth = 1;
  ctx.strokeRect(cardX, cardY, cardWidth, cardHeight);
}

function drawPlasticOverlay(ctx, width, height, labelHeight) {
  // Subtle reflection on plastic
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, 'rgba(255,255,255,0.15)');
  gradient.addColorStop(0.2, 'rgba(255,255,255,0.05)');
  gradient.addColorStop(0.5, 'rgba(255,255,255,0)');
  gradient.addColorStop(0.8, 'rgba(255,255,255,0.03)');
  gradient.addColorStop(1, 'rgba(255,255,255,0.1)');

  ctx.fillStyle = gradient;
  roundRect(ctx, 0, labelHeight, width, height - labelHeight, BORDER_RADIUS);
  ctx.fill();
}

function drawLabel(ctx, width, height, style, data) {
  const { grade, gradeLabel, cardInfo, certNumber, subgrades, company } = data;

  // Label background gradient
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, style.labelBgGradient[0]);
  gradient.addColorStop(1, style.labelBgGradient[1]);

  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.moveTo(BORDER_RADIUS, 0);
  ctx.lineTo(width - BORDER_RADIUS, 0);
  ctx.quadraticCurveTo(width, 0, width, BORDER_RADIUS);
  ctx.lineTo(width, height);
  ctx.lineTo(0, height);
  ctx.lineTo(0, BORDER_RADIUS);
  ctx.quadraticCurveTo(0, 0, BORDER_RADIUS, 0);
  ctx.fill();

  // Accent line at bottom of label
  ctx.fillStyle = style.accentColor;
  ctx.fillRect(0, height - 3, width, 3);

  // Logo
  if (company === 'tag') {
    // TAG has logo on colored background
    ctx.fillStyle = style.logoBg;
    roundRect(ctx, 12, 10, 42, 22, 4);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 14px Arial, sans-serif';
    ctx.fillText('TAG', 18, 26);
  } else {
    ctx.fillStyle = style.textColor;
    ctx.font = style.logoFont;
    ctx.fillText(style.logoText, 12, 24);
  }

  // Grade (right side)
  ctx.textAlign = 'right';
  ctx.fillStyle = style.textColor;
  ctx.font = 'bold 28px Arial, sans-serif';
  ctx.fillText(grade, width - 14, 32);

  // Grade label
  ctx.font = 'bold 8px Arial, sans-serif';
  ctx.fillStyle = style.accentColor;
  ctx.fillText(gradeLabel, width - 14, 44);

  // Card info
  ctx.textAlign = 'left';
  ctx.fillStyle = style.textColor;

  const name = cardInfo?.name || 'POKEMON CARD';
  const setName = cardInfo?.setName || '';
  const cardNum = cardInfo?.cardNumber || '';
  const year = cardInfo?.year || '2024';

  ctx.font = 'bold 10px Arial, sans-serif';
  ctx.fillText(name.toUpperCase().substring(0, 24), 12, 42);

  ctx.font = '8px Arial, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  ctx.fillText(`${year} POKÉMON`, 12, 54);

  if (setName || cardNum) {
    ctx.fillText(`${setName} ${cardNum ? '#' + cardNum : ''}`.substring(0, 30), 12, 64);
  }

  // Cert number
  ctx.font = '7px monospace';
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.fillText(certNumber, 12, height - 8);

  // BGS subgrades
  if (company === 'bgs' && subgrades) {
    drawSubgrades(ctx, width, height, subgrades);
  }

  ctx.textAlign = 'left';
}

function drawSubgrades(ctx, width, height, subgrades) {
  const grades = [
    { label: 'CEN', value: subgrades.centering },
    { label: 'COR', value: subgrades.corners },
    { label: 'EDG', value: subgrades.edges },
    { label: 'SUR', value: subgrades.surface },
  ];

  const startX = width - 100;
  const y = height - 18;

  grades.forEach((g, i) => {
    const x = startX + i * 22;
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = '6px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(g.label, x, y);
    ctx.fillStyle = '#ffd700';
    ctx.font = 'bold 8px Arial';
    ctx.fillText(g.value ? (g.value / 100).toFixed(1) : '9.5', x, y + 10);
  });
}

function drawBottomBranding(ctx, width, height, style, company) {
  // Subtle bottom branding
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(100,100,100,0.4)';
  ctx.font = '8px Arial, sans-serif';

  const brandText = {
    psa: 'PROFESSIONAL SPORTS AUTHENTICATOR',
    bgs: 'BECKETT GRADING SERVICES',
    cgc: 'CERTIFIED GUARANTY COMPANY',
    sgc: 'SPORTSCARD GUARANTY',
    tag: 'TAG GRADING',
  };

  ctx.fillText(brandText[company] || 'GRADING SERVICE', width / 2, height - 8);
  ctx.textAlign = 'left';
}

function roundRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function generateCertNumber() {
  return Math.floor(Math.random() * 90000000 + 10000000).toString();
}

export default RealisticSlab;
