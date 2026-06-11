# TAG Coordinate System Mapping

This document describes how to convert TAG grading coordinates to image pixel coordinates and how to determine which scoring zone a defect falls into.

---

## Coordinate Conversion

TAG uses its own coordinate system for defect locations. To map these to actual image pixel positions, use linear transformation.

### Conversion Formulas

**TAG to Image:**
```
imageX = (tagX * scaleX) + offsetX
imageY = (tagY * scaleY) + offsetY
```

**Image to TAG:**
```
tagX = (imageX - offsetX) / scaleX
tagY = (imageY - offsetY) / scaleY
```

### Calibration Values

#### Front Side (6 calibration points)
| Parameter | Value |
|-----------|-------|
| scaleX | 0.9808653546711816 |
| offsetX | 35.73243034657268 |
| scaleY | 0.985914375084105 |
| offsetY | 32.327281025553326 |

#### Back Side (6 calibration points)
| Parameter | Value |
|-----------|-------|
| scaleX | 1.0094184051332116 |
| offsetX | 9.52233267315872 |
| scaleY | 1.00148208928669 |
| offsetY | 50.37741061244348 |

### Example Code

```javascript
const calibration = {
  front: {
    scaleX: 0.9808653546711816,
    offsetX: 35.73243034657268,
    scaleY: 0.985914375084105,
    offsetY: 32.327281025553326
  },
  back: {
    scaleX: 1.0094184051332116,
    offsetX: 9.52233267315872,
    scaleY: 1.00148208928669,
    offsetY: 50.37741061244348
  }
};

function tagToImage(tagX, tagY, side) {
  const cal = calibration[side];
  return {
    x: (tagX * cal.scaleX) + cal.offsetX,
    y: (tagY * cal.scaleY) + cal.offsetY
  };
}

function imageToTag(imageX, imageY, side) {
  const cal = calibration[side];
  return {
    x: (imageX - cal.offsetX) / cal.scaleX,
    y: (imageY - cal.offsetY) / cal.scaleY
  };
}
```

---

## Zone System

TAG divides the card into 6 concentric rectangular zones radiating from the center outward. Zone 0 is the innermost (center), Zone 5 is the outermost (edges/corners).

Defects in outer zones (edges, corners) typically have more impact on grading than defects in the center.

### Zone Boundaries

Zones are defined as percentages from the card center to each edge. For example, if `left: 12%`, the zone's left boundary is at `centerX - (imageWidth * 0.12)`.

#### Front Side Zones

| Zone | Left % | Right % | Top % | Bottom % | Description |
|------|--------|---------|-------|----------|-------------|
| 0 | 12.05 | 14.99 | 19.27 | 21.42 | Inner center |
| 1 | 19.48 | 22.43 | 25.45 | 27.60 | Center |
| 2 | 26.92 | 29.87 | 31.63 | 33.78 | Mid-field |
| 3 | 34.35 | 37.30 | 37.82 | 39.97 | Outer mid-field |
| 4 | 41.79 | 44.74 | 44.00 | 46.15 | Near edge |
| 5 | 50.00 | 50.00 | 50.00 | 50.00 | Edge/Corner |

#### Back Side Zones

| Zone | Left % | Right % | Top % | Bottom % | Description |
|------|--------|---------|-------|----------|-------------|
| 0 | 12.03 | 15.00 | 19.27 | 21.42 | Inner center |
| 1 | 19.47 | 22.44 | 25.45 | 27.60 | Center |
| 2 | 26.90 | 29.87 | 31.63 | 33.79 | Mid-field |
| 3 | 34.33 | 37.31 | 37.82 | 39.97 | Outer mid-field |
| 4 | 41.76 | 44.74 | 44.00 | 46.15 | Near edge |
| 5 | 50.00 | 50.00 | 50.00 | 50.00 | Edge/Corner |

### Zone Detection Code

```javascript
const zones = {
  front: [
    { left: 12.045, right: 14.994, top: 19.266, bottom: 21.416 },
    { left: 19.478, right: 22.430, top: 25.451, bottom: 27.599 },
    { left: 26.916, right: 29.865, top: 31.635, bottom: 33.783 },
    { left: 34.352, right: 37.303, top: 37.820, bottom: 39.967 },
    { left: 41.785, right: 44.738, top: 44.003, bottom: 46.152 },
    { left: 50.000, right: 50.000, top: 50.000, bottom: 50.000 }
  ],
  back: [
    { left: 12.028, right: 15.003, top: 19.267, bottom: 21.416 },
    { left: 19.467, right: 22.436, top: 25.450, bottom: 27.602 },
    { left: 26.898, right: 29.871, top: 31.635, bottom: 33.788 },
    { left: 34.334, right: 37.306, top: 37.815, bottom: 39.971 },
    { left: 41.765, right: 44.738, top: 44.000, bottom: 46.152 },
    { left: 50.000, right: 50.000, top: 50.000, bottom: 50.000 }
  ]
};

/**
 * Determine which zone a defect falls into based on image coordinates
 * @param {number} imageX - X coordinate in image pixels
 * @param {number} imageY - Y coordinate in image pixels
 * @param {number} imageWidth - Total image width in pixels
 * @param {number} imageHeight - Total image height in pixels
 * @param {string} side - 'front' or 'back'
 * @returns {number} Zone index (0-5), where 0 is center and 5 is edge
 */
function getZone(imageX, imageY, imageWidth, imageHeight, side) {
  const centerX = imageWidth / 2;
  const centerY = imageHeight / 2;

  // Calculate distance from center as percentage
  const distLeftPct = ((centerX - imageX) / imageWidth) * 100;
  const distRightPct = ((imageX - centerX) / imageWidth) * 100;
  const distTopPct = ((centerY - imageY) / imageHeight) * 100;
  const distBottomPct = ((imageY - centerY) / imageHeight) * 100;

  // Check zones from innermost (0) to outermost (5)
  for (let i = 0; i < zones[side].length; i++) {
    const zone = zones[side][i];

    // Point is inside this zone if it's within all 4 boundaries
    const insideLeft = distLeftPct <= zone.left;
    const insideRight = distRightPct <= zone.right;
    const insideTop = distTopPct <= zone.top;
    const insideBottom = distBottomPct <= zone.bottom;

    if (insideLeft && insideRight && insideTop && insideBottom) {
      return i;
    }
  }

  // Default to outermost zone if outside all defined zones
  return 5;
}
```

---

## Complete Workflow Example

```javascript
// Given a TAG defect report
const defect = {
  tagX: 3524,
  tagY: 3157,
  side: 'back',
  type: 'SURFACE / PIT'
};

// 1. Convert TAG coords to image coords
const imageCoords = tagToImage(defect.tagX, defect.tagY, defect.side);
// Result: { x: 3567.4, y: 3213.0 }

// 2. Determine which zone the defect is in
const imageWidth = 4500;  // Your actual image width
const imageHeight = 6300; // Your actual image height
const zone = getZone(imageCoords.x, imageCoords.y, imageWidth, imageHeight, defect.side);
// Result: zone 2 (mid-field)

// 3. Use zone for scoring weight
const zoneWeights = [1.0, 1.2, 1.4, 1.6, 1.8, 2.0]; // Example weights
const defectImpact = baseDefectScore * zoneWeights[zone];
```

---

## Notes

- **Coordinate Origin**: TAG coordinates appear to use top-left as origin (0,0), same as standard image coordinates
- **Typical TAG Range**: X coordinates roughly 0-4500, Y coordinates roughly 0-6300 (matching standard card image dimensions)
- **Calibration Accuracy**: Both front and back sides calibrated with 6 reference points each for high accuracy
- **Scale Factors**: Both sides have scale factors very close to 1.0 (~0.98-1.01), meaning TAG coordinates map nearly 1:1 to image pixels with small offsets
- **Zone Asymmetry**: Zones are slightly asymmetric (left/right and top/bottom percentages differ slightly) to match TAG's actual zone boundaries as observed in their annotated images
