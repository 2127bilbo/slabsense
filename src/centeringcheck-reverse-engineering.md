# CenteringCheck.com Reverse Engineering Notes

**Date:** April 5, 2026
**Purpose:** Understand how centeringcheck.com calculates card centering to improve our own implementation

---

## API Endpoint

```
POST https://www.centeringcheck.com/api/upload
Content-Type: application/json
```

---

## Request Payload

```json
{
  "image": "data:image/jpeg;base64,...",
  "warp": true
}
```

| Field | Type | Description |
|-------|------|-------------|
| `image` | string | Base64-encoded JPEG image |
| `warp` | boolean | Enable/disable perspective correction ("Warp Method") |

---

## Response Format

```json
{
  "borders": {
    "bottom": [535, 515],
    "left": [14, 23],
    "right": [389, 374],
    "top": [11, 30]
  },
  "centeringValues": {
    "LR": 0.375,
    "TB": 0.487
  },
  "processedImage": "data:image/jpeg;base64,..."
}
```

### Border Format

Each border returns `[outer_edge, inner_edge]` in pixels:

| Side | Example | Calculation |
|------|---------|-------------|
| left | [14, 23] | Card edge at x=14, artwork starts at x=23 |
| right | [389, 374] | Card edge at x=389, artwork ends at x=374 |
| top | [11, 30] | Card edge at y=11, artwork starts at y=30 |
| bottom | [535, 515] | Card edge at y=535, artwork ends at y=515 |

**Border width** = `inner_edge - outer_edge` (for left/top)
**Border width** = `outer_edge - inner_edge` (for right/bottom)

### Centering Formula

```
Left Border Width  = inner_left - outer_left     = 23 - 14 = 9px
Right Border Width = outer_right - inner_right   = 389 - 374 = 15px

LR = left_border / (left_border + right_border)
   = 9 / (9 + 15)
   = 9 / 24
   = 0.375 (37.5/62.5)
```

Same formula for top/bottom:
```
TB = top_border / (top_border + bottom_border)
```

---

## Test Results

### Card 1 - Rotated Photo (Warp ON)

| Side | Values | Border Width |
|------|--------|--------------|
| Left | [14, 23] | 9px |
| Right | [389, 374] | 15px |
| Top | [11, 30] | 19px |
| Bottom | [535, 515] | 20px |

**Centering:** LR: 0.375 (37.5/62.5), TB: 0.487 (48.7/51.3)

### Card 2 - Straight Photo (Warp ON)

| Side | Values | Border Width |
|------|--------|--------------|
| Left | [14, 26] | 12px |
| Right | [355, 348] | 7px |
| Top | [12, 23] | 11px |
| Bottom | [495, 478] | 17px |

**Centering:** LR: 0.632 (63.2/36.8), TB: 0.393 (39.3/60.7)

### Card 1 - Rotated Photo (Warp OFF)

| Side | Values | Border Width |
|------|--------|--------------|
| Left | [30, 60] | 30px |
| Right | [570, 540] | 30px |
| Top | [37.1, 74.2] | 37.1px |
| Bottom | [704.9, 667.8] | 37.1px |

**Centering:** LR: 0.5 (50/50), TB: 0.5 (50/50)

**Note:** With warp OFF, edge detection failed completely on the rotated card. Values defaulted to near-center, borders were detected incorrectly. This proves the warp method is essential for their accuracy.

---

## Key Findings

### 1. The "Warp Method" is Critical

Their advertised "Warp Method" isn't just marketing - it's essential to their pipeline:

- **With Warp ON:** Accurate edge detection, correct centering values
- **With Warp OFF:** Detection fails, falls back to defaults, completely wrong measurements

### 2. Server-Side Processing

All processing happens on their backend:
- Image is sent as base64
- Server applies AI perspective correction
- Server detects borders
- Returns corrected image + measurements

No rotation/transform calls were detected in browser JavaScript - confirms server-side processing.

### 3. Perspective Correction vs Simple Rotation

Their warp does **full perspective correction** (keystone/trapezoid fix), not just rotation:

```
Simple Rotation:        Perspective Warp:
    ____                    ____
   /    \       -->        |    |
  /______\                 |____|
```

This is why their results are accurate even with angled photos.

### 4. Processing Returns Integers (with warp) vs Floats (without)

- Warp ON: Border values are integers (14, 23, 389, etc.)
- Warp OFF: Border values are floats (37.1, 704.9, etc.)

Suggests different detection algorithms for each mode.

---

## Their Likely Pipeline

1. **Corner Detection** - AI/ML model detects 4 corners of card (works even if tilted)
2. **Perspective Warp** - Transform trapezoid to rectangle using homography matrix
3. **Border Detection** - Find outer card edge and inner artwork boundary
4. **Measurement** - Calculate pixel distances for each border
5. **Return** - Send back warped image + border coordinates + centering ratios

---

## Comparison to Our Implementation

| Feature | CenteringCheck | Our App.jsx |
|---------|----------------|-------------|
| Card boundary detection | AI-based corner detection | Background color distance + variance fallback |
| Angle correction | Full perspective warp (server-side AI) | Rotation only (`deskewCanvas`) |
| Border detection | Unknown (likely color-based) | Color-distance scan with adaptive threshold |
| Processing location | Server-side | Client-side |

### Our Current Limitation

Our `deskewCanvas` only rotates:
```javascript
ctx.translate(nw/2, nh/2);
ctx.rotate(rad);
ctx.drawImage(srcCanvas, -sw/2, -sh/2);
```

This cannot fix keystone/trapezoid distortion from angled photos.

---

## Potential Improvements

### Option 1: Add Perspective Warp (Client-Side)

Use canvas `transform()` or a library to apply homography transformation:

```javascript
// Requires detecting 4 corners first, then computing transformation matrix
ctx.setTransform(a, b, c, d, e, f);
```

Libraries that could help:
- **OpenCV.js** - Full computer vision library
- **Perspective.js** - Lightweight perspective transform
- **TensorFlow.js** - For ML-based corner detection

### Option 2: Require Flat Photos

Document that users must take photos straight-on. Simpler but less user-friendly.

### Option 3: Improve Rotation Detection

Keep current approach but improve angle detection accuracy for near-straight photos.

---

## Raw Data Files

- `centercheck.com data.txt` - Card 1 (rotated, warp ON)
- `centercheck.com data 2.txt` - Card 2 (straight, warp ON)
- `centercheck.com no warp.txt` - Card 1 (rotated, warp OFF)
- `centercheck.com console data.txt` - Browser console intercepts

---

## References

- [CenteringCheck Guide](https://www.centeringcheck.com/guide)
- [CardGrade.io Centering Analysis](https://cardgrade.io/centering-analysis)
- [TCGrader - How AI Card Grading Works](https://www.tcgrader.com/blog/how-ai-card-grading-works-complete-guide)
