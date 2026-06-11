# Damage Report Feature - Implementation Plan

**Created:** June 11, 2026
**Status:** PLANNING
**Last Updated:** June 11, 2026

---

## Overview

Replace the current Dings tab with a new "Damage Report" modal that matches TAG's exact grading methodology. The report will display:
- Visual zone overlays (6 concentric zones from center to edge)
- Defect markers with descriptions
- Surface vision modes (Normal, Emboss, Hi-Pass, Edge Detection)
- Slider to adjust between vision modes
- Front and back card views side-by-side

---

## Reference Materials

### TAG Coordinate System
- **File:** `tag-data/TAG_COORDINATE_MAPPING.md`
- **Calibration Values:**
  - Front: scaleX=0.9809, scaleY=0.9859, offsetX=35.73, offsetY=32.33
  - Back: scaleX=1.0094, scaleY=1.0015, offsetX=9.52, offsetY=50.38
- **6 Zones:** Center (0) to Edge (5) with percentage-based boundaries

### TAG Grading Matrix
- **File:** `tag-data/TAG_GRADING_MATRIX.md`
- **Score Ranges:**
  - PRISTINE (990-1000)
  - GEM MINT (950-989)
  - MINT (900-949)
  - NM-MT+ (850-899)
  - NM-MT (800-849)
  - NM+ (750-799)
  - NM (700-749)
  - And so on down to POOR (100-149)

### Calibration Tool
- **File:** `tag-data/tag-calibration-tool.html`
- Used to map TAG coordinates to image coordinates

### Design Reference
- **File:** `mockup/Damage report output.png`
- Shows zone overlay rectangles and defect markers

---

## Current State

### Files to Extract From
| Source File | What to Extract |
|-------------|-----------------|
| `src/App.jsx` (lines 404-1100) | Dings detection functions (checkCenteringDings, detectCornerDings, detectEdgeDings, detectSurfaceDings, computeGrade) |
| `src/lib/image-utils.js` | genMaps() for surface vision modes |
| `src/components/Grading/GradeResultDisplay.jsx` | Layout patterns to reuse |

### Functions to Reuse/Update
```javascript
// FROM App.jsx - KEEP but update with TAG zones
checkCenteringDings(centering, side)
detectCornerDings(d, w, h, bn, side)
detectEdgeDings(d, w, h, bn, side)
detectSurfaceDings(d, w, h, bn, side)
computeGrade(frontDings, backDings, frontCenter, backCenter, companyId, imageQuality)

// FROM image-utils.js - KEEP as-is
loadImg(src, mx)
genMaps(src)  // Returns { original, emboss, highpass, edges }
LUM(r, g, b)
```

---

## New Components

### 1. DamageReportModal.jsx
Main modal component that opens when user clicks "Damage Report" button.

**Props:**
```javascript
{
  isOpen: boolean,
  onClose: () => void,
  frontImage: string,       // Cropped front image
  backImage: string,        // Cropped back image
  frontDefects: Defect[],   // Array of detected defects
  backDefects: Defect[],    // Array of detected defects
  grades: GradeResult,      // Current grade data
  cardInfo: CardInfo,       // Card identification info
}
```

### 2. DamageMap.jsx
Card image with zone overlays and defect markers.

**Features:**
- 6 concentric zone rectangles (color-coded)
- Defect markers (numbered circles) at exact coordinates
- Hover/click to show defect description
- Vision mode toggle (Normal/Emboss/Hi-Pass/Edges)

### 3. VisionModeSlider.jsx
Slider to blend between vision modes.

**Modes:**
- Normal (original image)
- Emboss (reveals surface texture)
- Hi-Pass (highlights anomalies)
- Edge Detection (shows boundaries)

### 4. DefectList.jsx
List of all defects with details.

**Fields per defect:**
- Number (matches marker on map)
- Type (Surface Scratch, Edge Whitening, Corner Wear, etc.)
- Location (zone number, area description)
- Severity (score impact)
- Side (Front/Back)

---

## Zone System

### Zone Colors (from image reference)
| Zone | Color | Description |
|------|-------|-------------|
| 5 | Cyan | Edge/Corner (outermost) |
| 4 | Green | Near edge |
| 3 | Yellow | Outer mid-field |
| 2 | Orange | Mid-field |
| 1 | Red | Center |
| 0 | Dark Red | Inner center (most protected) |

### Zone Boundaries (percentages from center)
```javascript
const ZONES = {
  front: [
    { zone: 0, left: 12.05, right: 14.99, top: 19.27, bottom: 21.42 },
    { zone: 1, left: 19.48, right: 22.43, top: 25.45, bottom: 27.60 },
    { zone: 2, left: 26.92, right: 29.87, top: 31.63, bottom: 33.78 },
    { zone: 3, left: 34.35, right: 37.30, top: 37.82, bottom: 39.97 },
    { zone: 4, left: 41.79, right: 44.74, top: 44.00, bottom: 46.15 },
    { zone: 5, left: 50.00, right: 50.00, top: 50.00, bottom: 50.00 },
  ],
  back: [
    // Similar values for back
  ]
};
```

### Zone Weight Multipliers (TBD)
Defects in outer zones impact grade more than center defects.
```javascript
const ZONE_WEIGHTS = [1.0, 1.2, 1.4, 1.6, 1.8, 2.0]; // Zone 0-5
```

---

## UI Layout

```
┌─────────────────────────────────────────────────────────────┐
│  DAMAGE REPORT                                    [X Close] │
├─────────────────────────────────────────────────────────────┤
│  Card: Charizard • Base Set • #4                            │
│  Grade: 9 MINT • Score: 920/1000                            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌──────────────────┐   ┌──────────────────┐               │
│  │                  │   │                  │               │
│  │   FRONT          │   │   BACK           │               │
│  │   [Zone overlay] │   │   [Zone overlay] │               │
│  │   ① ② ③         │   │   ④ ⑤           │               │
│  │                  │   │                  │               │
│  └──────────────────┘   └──────────────────┘               │
│                                                             │
│  Vision Mode: [Normal] [Emboss] [Hi-Pass] [Edges]          │
│  ──────────────○────────────────────────────               │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│  DEFECTS FOUND (5)                                          │
│  ① Surface Scratch    │ Zone 2 │ Front │ -15 pts           │
│  ② Edge Whitening     │ Zone 5 │ Front │ -25 pts           │
│  ③ Corner Wear        │ Zone 5 │ Front │ -20 pts           │
│  ④ Print Line         │ Zone 1 │ Back  │ -10 pts           │
│  ⑤ Minor Pit          │ Zone 3 │ Back  │ -10 pts           │
├─────────────────────────────────────────────────────────────┤
│  AREA SCORES                                                │
│  Centering: F 980 / B 960  │  Corners: F 950 / B 960       │
│  Edges: F 940 / B 960      │  Surface: F 955 / B 970       │
│                                                             │
│  Lowest: Front Edges (940) ← Grade-limiting factor         │
└─────────────────────────────────────────────────────────────┘
```

---

## Implementation Phases

### Phase 1: HTML Mockup
- [ ] Create standalone HTML file with full layout
- [ ] Implement zone overlay drawing (CSS/Canvas)
- [ ] Add defect markers
- [ ] Add vision mode slider
- [ ] Test with sample card images
- [ ] Verify zone coordinates match TAG exactly

### Phase 2: React Components
- [ ] Create `src/components/DamageReport/DamageReportModal.jsx`
- [ ] Create `src/components/DamageReport/DamageMap.jsx`
- [ ] Create `src/components/DamageReport/VisionModeSlider.jsx`
- [ ] Create `src/components/DamageReport/DefectList.jsx`
- [ ] Create `src/lib/tag-zones.js` (zone detection logic)
- [ ] Create `src/lib/tag-coordinates.js` (coordinate conversion)

### Phase 3: Integration
- [ ] Add "Damage Report" button to Grade tab
- [ ] Add "Damage Report" button to Collection card details
- [ ] Remove old Dings tab
- [ ] Update grading functions to use TAG zones
- [ ] Test full flow

### Phase 4: Polish
- [ ] Animations for zone highlighting
- [ ] Defect marker hover effects
- [ ] Print/export damage report
- [ ] Mobile responsive layout

---

## Files to Create

### New Files
```
src/components/DamageReport/
├── DamageReportModal.jsx    # Main modal container
├── DamageMap.jsx            # Card image with overlays
├── VisionModeSlider.jsx     # Vision mode control
├── DefectList.jsx           # Defect listing
└── index.js                 # Exports

src/lib/
├── tag-zones.js             # Zone detection logic
└── tag-coordinates.js       # Coordinate conversion
```

### Files to Modify
```
src/App.jsx                  # Add Damage Report button, remove Dings tab
src/components/Collection/CollectionView.jsx  # Add Damage Report button
```

---

## Staging Folder Structure

```
staging/damage-report/
├── DAMAGE_REPORT_PLAN.md    # This file
├── originals/
│   └── dings-detection-functions.js  # Extracted from App.jsx
├── lib/
│   └── image-utils.js       # Copy of genMaps, loadImg, etc.
├── mockup/
│   ├── damage-report.html   # HTML prototype (to create)
│   └── Damage report output.png  # Reference image
└── tag-data/
    ├── TAG_COORDINATE_MAPPING.md
    ├── TAG_GRADING_MATRIX.md
    └── tag-calibration-tool.html
```

---

## Questions/Decisions Needed

1. **Zone weights** - What are the exact multipliers for each zone? (User working on this)
2. **Background padding** - Do we add background to cropped images to match TAG's format?
3. **Defect types** - Complete list of defect type labels to use
4. **Score breakdown** - Show raw score calculation or just final numbers?

---

## Progress Log

### June 11, 2026
- Created staging folder structure
- Copied TAG coordinate mapping and grading matrix
- Extracted dings detection functions from App.jsx
- Created this implementation plan
- Next: Build HTML mockup for layout testing

---
