# SlabSense Codebase Audit Report

**Generated**: June 2026
**Total Files Analyzed**: 600+
**Total Functions Cataloged**: 200+

---

## Table of Contents

1. [Folder Structure](#1-folder-structure)
2. [App Flow Documentation](#2-app-flow-documentation)
3. [Function Inventory](#3-function-inventory)
4. [API Endpoints](#4-api-endpoints)
5. [Unused Code](#5-unused-code)
6. [Duplicate Code](#6-duplicate-code)
7. [Issues & Recommendations](#7-issues--recommendations)

---

## 1. Folder Structure

```
G:\Grading App\SlabSense\
├── .claude/
│   └── settings.local.json
│
├── api/ - Serverless API functions (6 files)
│   ├── ai-analyze.js - AI analysis via Replicate
│   ├── ai-analyze-direct.js - Direct Anthropic API
│   ├── analyze-card.js - Quick card analysis
│   ├── deep-analyze.js - Deep analysis v1
│   ├── deep-analyze-v2.js - Deep analysis v2 (2-pass)
│   └── extract-card-info.js - Card info extraction
│
├── backend/ - Python backend services
│   ├── api/routes.py
│   ├── services/
│   │   ├── card_detection.py
│   │   ├── centering.py
│   │   ├── defects.py
│   │   ├── grading.py
│   │   └── perspective.py
│   ├── utils/image_processing.py
│   ├── main.py
│   └── Dockerfile
│
├── config/
│   ├── grading-calibration.json
│   └── holo-config.json
│
├── docs/
│   ├── grading-research/ (14 files - PSA/BGS/CGC/SGC/TAG standards)
│   ├── DISCLAIMERS.md
│   ├── PRIVACY_POLICY.md
│   ├── TECHNICAL_REFERENCE.md
│   └── TERMS_OF_SERVICE.md
│
├── models/ - ML Models (~575MB total)
│   ├── clip_embeddings_tfjs.json (216MB)
│   ├── clip_embeddings.json (212MB)
│   ├── card_embeddings.json (59MB)
│   ├── card_embedding_best.pth (44MB)
│   └── card_embedding_final.pth (44MB)
│
├── public/
│   ├── card-hashes.json
│   └── card-images/ (177 Pokémon set folders)
│
├── scripts/
│   ├── Tag scraper/ - TAG data collection
│   ├── analyze_tag_calibration_v2.cjs
│   ├── build-hash-db.cjs
│   └── [other utility scripts]
│
├── src/
│   ├── components/
│   │   ├── Auth/
│   │   │   ├── AuthModal.jsx
│   │   │   └── UserMenu.jsx
│   │   ├── CardIdentifier/CardIdentifier.jsx
│   │   ├── CardViewer/
│   │   │   ├── CardViewer3D.jsx
│   │   │   ├── RealisticSlab.jsx
│   │   │   └── SlabSenseSlab.jsx
│   │   ├── Collection/CollectionView.jsx
│   │   ├── Common/ [EMPTY]
│   │   ├── Export/ExportCard.jsx
│   │   ├── Grading/ [EMPTY]
│   │   ├── HoloCard/HoloCard.jsx
│   │   ├── HoloLogo/HoloLogo.jsx
│   │   ├── PostCaptureCentering/PostCaptureCentering.jsx
│   │   ├── Settings/ProfileSettings.jsx
│   │   ├── CardCropModal.jsx
│   │   └── CornerHandles.jsx
│   ├── hooks/
│   │   └── useAuth.js
│   ├── lib/
│   │   ├── card-detector.js
│   │   ├── card-matcher.js
│   │   ├── centering-utils.js
│   │   ├── clip-matcher.js
│   │   ├── corner-measurement.js
│   │   ├── gyro-input.js
│   │   ├── identify-card.js
│   │   ├── image-converter.js
│   │   ├── phash.js
│   │   ├── sparkle-engine.js
│   │   └── tag-calibration.js
│   ├── services/
│   │   ├── api.js
│   │   ├── auth.js
│   │   ├── ocr.js
│   │   ├── scans.js
│   │   ├── supabase.js
│   │   └── tcgdex.js
│   ├── utils/
│   │   └── gradingScales.js
│   ├── Old revs/ [OBSOLETE - 5 old App versions]
│   ├── test/ [TEST DATA]
│   ├── App.jsx (Main - 252KB)
│   ├── App1.jsx [DUPLICATE OF App.jsx]
│   └── main.jsx
│
├── supabase/migrations/
│   ├── 001_initial_schema.sql
│   ├── 20250108_create_graded_references.sql
│   └── 20260414_missing_images.sql
│
└── [Config files: package.json, vite.config.js, vercel.json, etc.]
```

### Notable Issues Found

| Issue | Location | Status |
|-------|----------|--------|
| Empty directories | `src/components/Common/`, `src/components/Grading/` | Should remove or use |
| Old revisions | `src/Old revs/` (App1-App5.jsx) | Should archive/remove |
| Duplicate App file | `src/App1.jsx` | Appears obsolete |
| Test data in src | `src/test/` | Should move to proper test directory |

---

## 2. App Flow Documentation

### 2.1 Launch Flow

```
index.html → main.jsx → App.jsx (line 2810)
    │
    ├── Backend health check (line 2945)
    ├── Load user profile (line 2938)
    ├── Collection stats refresh (line 2933)
    └── Render initial scan tab
```

### 2.2 Image Capture Flow

```
Camera/Upload
    │
    ├── analyzePhotoQuality() [App.jsx:68]
    │   ├── Blur detection (Laplacian variance)
    │   ├── Lighting check (dark/bright ratio)
    │   └── Contrast analysis
    │
    ├── PostCaptureCentering modal
    │   └── User adjusts card boundaries
    │
    └── CardIdentifier (front only)
        └── OCR + TCGDex matching
```

### 2.3 Three Grading Processes

#### Software Grading (Client-Side)

```
run() [App.jsx:2980]
    │
    ├── analyzeCardFull() [App.jsx:1033]
    │   ├── findBounds() [line 172] - Grid variance detection
    │   ├── analyzeCentering() [line 334] - Border measurement
    │   ├── checkCenteringDings() [line 409]
    │   ├── detectCornerDings() [line 427]
    │   ├── detectEdgeDings() [line 558]
    │   └── detectSurfaceDings() [line 620]
    │
    └── computeGrade() [App.jsx:834]
        ├── Count defects by type
        ├── Calculate centering deviation
        ├── Apply grade caps (TAG calibration)
        ├── Calculate component scores
        └── Return 0-1000 score + grade
```

#### AI Grading (Standard)

```
claudeGradingAnalysis() [api.js:487]
    │
    ├── Upload images to Supabase
    ├── POST /api/ai-analyze-direct
    │   └── Claude Vision analysis
    └── Return multi-company grades
```

#### Deep AI Grading (Two-Pass)

```
deepGradingAnalysisV2() [api.js:1429]
    │
    ├── Upload 4 images (original + cropped)
    ├── POST /api/deep-analyze-v2
    │   ├── Pass 1: Defect detection only
    │   ├── Fetch TAG reference cards from DB
    │   └── Pass 2: Grade with references + software centering
    └── Return detailed grades with confidence
```

### 2.4 Save Flow

```
handleSaveScan() [App.jsx:3306]
    │
    ├── buildSaveData() [line 3250]
    ├── saveScan() [scans.js:57]
    │   ├── INSERT to scans table
    │   └── Upload enhanced images
    └── Update UI state
```

### 2.5 3D Viewer Flow

```
CardViewer3D [CardViewer3D.jsx:24]
    │
    ├── Props: frontImage, backImage, grade, subgrades
    ├── Tap to flip (180° rotation)
    ├── Drag to rotate (360°)
    └── Optional slab view (disabled)
```

---

## 3. Function Inventory

### 3.1 Core Image Processing (App.jsx)

| Function | Line | Purpose |
|----------|------|---------|
| `loadImg` | 60 | Load and scale image to canvas |
| `PX` | 61 | Get RGB at pixel coordinates |
| `LUM` | 62 | Calculate luminance |
| `analyzePhotoQuality` | 68 | Blur/lighting/contrast check |
| `findBounds` | 172 | Card edge detection |
| `edgeScanFallback` | 279 | Fallback card detection |
| `scanBorderFromEdge` | 303 | Scan for card border |
| `analyzeCentering` | 334 | Calculate centering ratios |
| `checkCenteringDings` | 409 | TAG centering threshold check |
| `detectCornerDings` | 427 | Corner wear detection |
| `detectEdgeDings` | 558 | Edge wear detection |
| `detectSurfaceDings` | 620 | Surface defect detection |
| `clusterDefects` | 751 | Cluster detected defects |
| `computeGrade` | 834 | Calculate final grade |
| `genMaps` | 1005 | Generate vision maps |
| `analyzeCardFull` | 1033 | Complete analysis pipeline |

### 3.2 UI Components (App.jsx)

| Component | Line | Purpose |
|-----------|------|---------|
| `ScoreRing` | 1067 | Circular progress score |
| `GradeDisplay` | 1074 | Main grade display |
| `GradeDisplaySimple` | 1155 | Simplified grade |
| `HomeTab` | 1189 | Home screen |
| `PhotoQualityBadge` | 1323 | Quality indicator |
| `SurfaceVision` | 1349 | Surface visualization |
| `DingsMap` | 1502 | Ding visualization |
| `ManualBoundaryEditor` | 1708 | Manual boundary adjustment |
| `CameraViewfinder` | 2270 | Camera capture UI |
| `CaptureCard` | 2683 | Card capture UI |

### 3.3 Services

#### scans.js

| Function | Line | Purpose | Status |
|----------|------|---------|--------|
| `uploadCardImage` | 16 | Upload to Supabase | **UNUSED** |
| `saveScan` | 57 | Save scan to DB | Used |
| `getUserScans` | 143 | Fetch user's scans | Used |
| `getScan` | 164 | Get single scan | Used |
| `updateScan` | 182 | Update scan data | Used |
| `deleteScan` | 201 | Delete scan | Used |
| `toggleFavorite` | 217 | Toggle favorite | **UNUSED** |
| `getScanCount` | 224 | Get scan count | Used |
| `getFavoriteScans` | 241 | Get favorites | **UNUSED** |
| `searchScans` | 260 | Search scans | **UNUSED** |
| `logMissingImage` | 280 | Log missing images | Used |
| `uploadUserCardImage` | 327 | Upload cropped image | **UNUSED** |

#### auth.js

| Function | Line | Purpose | Status |
|----------|------|---------|--------|
| `signUp` | 10 | Create account | Used |
| `signIn` | 32 | Login | Used |
| `signOut` | 49 | Logout | Used |
| `getSession` | 61 | Get session | Used |
| `getUser` | 73 | Get current user | Used |
| `getProfile` | 85 | Fetch profile | Used |
| `updateProfile` | 103 | Update profile | Used |
| `onAuthStateChange` | 122 | Auth listener | Used |
| `resetPassword` | 133 | Password reset | **UNUSED** |
| `checkProAccess` | 148 | Check pro tier | **UNUSED** |
| `deleteAccount` | 168 | Delete account | Used |

#### api.js

| Function | Line | Purpose |
|----------|------|---------|
| `checkBackendHealth` | 14 | Check Python backend |
| `compressImageForAPI` | 68 | Compress for upload |
| `analyzeCardWithBackend` | 300 | Backend analysis |
| `analyzeCardWithVision` | 323 | Vision API (UNUSED IMPORT) |
| `claudeGradingAnalysis` | 487 | Standard AI grading |
| `deepGradingAnalysis` | 749 | Deep grading v1 |
| `deepGradingAnalysisV2` | 1429 | Deep grading v2 |

### 3.4 Libraries (src/lib/)

| File | Key Exports | Purpose |
|------|-------------|---------|
| tag-calibration.js | `TAG_CENTERING_THRESHOLDS`, `GRADE_CEILINGS`, `getMaxGradeByDefects`, `getCenteringGrade`, `calculateSoftwareConfidence` | TAG grade calibration |
| corner-measurement.js | `calculateCornerCentering`, `calculateBorderMeasurement` | Corner centering math |
| centering-utils.js | `cropToOuterBounds`, `calculateCenteringFromBounds`, `initializeCorners` | Centering utilities |
| card-detector.js | `detectAndCropCard`, `getCroppedDataUrl` | Card detection |
| phash.js | `computePHash`, `hammingDistance` | Perceptual hashing |
| card-matcher.js | `loadHashDb`, `matchCard`, `findMatches` | Card matching |
| clip-matcher.js | `loadModel`, `computeEmbedding`, `matchCard` | CLIP-based matching |
| identify-card.js | `identifyCard`, `selectCard` | Card identification |
| sparkle-engine.js | `createSparkleField`, `renderSparkles` | Holo effects |
| gyro-input.js | `getGyroInput`, `createGyroInput` | Gyroscope handling |

---

## 4. API Endpoints

| Endpoint | File | Method | Purpose | External API |
|----------|------|--------|---------|--------------|
| `/api/ai-analyze` | ai-analyze.js | POST | AI grading via Replicate | Replicate Claude |
| `/api/ai-analyze-direct` | ai-analyze-direct.js | POST | Direct Claude grading | Anthropic API |
| `/api/analyze-card` | analyze-card.js | POST | Quick condition check | Anthropic API |
| `/api/deep-analyze` | deep-analyze.js | POST | Deep grading v1 | Anthropic API |
| `/api/deep-analyze-v2` | deep-analyze-v2.js | POST | Two-pass deep grading | Anthropic + Supabase |
| `/api/extract-card-info` | extract-card-info.js | POST | Card OCR | Replicate LLaVA |

### API Issues Found

| Issue | Location | Details |
|-------|----------|---------|
| Missing CORS | ai-analyze.js, analyze-card.js, extract-card-info.js | Only 3 of 6 endpoints have CORS headers |
| Duplicate polling | ai-analyze.js:155, extract-card-info.js:177 | Identical `pollForResult` functions |
| Duplicate prompts | ai-analyze.js, ai-analyze-direct.js | `buildStitchedGradingPrompt` largely duplicated |
| Env var inconsistency | deep-analyze-v2.js:17-20 | Mixes VITE_ and non-VITE prefixes |

---

## 5. Unused Code

### 5.1 Unused Imports (App.jsx)

| Import | Line | Reason |
|--------|------|--------|
| `calculateCornerCentering` | 16 | Never called |
| `analyzeCardWithVision` | 11 | `analyzeCardWithBackend` used instead |

### 5.2 Unused Exports

| File | Function | Line |
|------|----------|------|
| scans.js | `uploadCardImage` | 16 |
| scans.js | `toggleFavorite` | 217 |
| scans.js | `getFavoriteScans` | 241 |
| scans.js | `searchScans` | 260 |
| scans.js | `uploadUserCardImage` | 327 |
| auth.js | `resetPassword` | 133 |
| auth.js | `checkProAccess` | 148 |
| tag-calibration.js | `AVG_DEFECTS_BY_GRADE` | 177 |

### 5.3 Obsolete Files

| Path | Reason |
|------|--------|
| `src/Old revs/App1.jsx` through `App5.jsx` | Old versions, 100% duplicated functionality |
| `src/App1.jsx` | Duplicate of App.jsx |
| `src/test/App.jsx`, `App1.jsx` | Test versions with duplicate code |
| `src/components/Common/` | Empty directory |
| `src/components/Grading/` | Empty directory |

---

## 6. Duplicate Code

### 6.1 Critical Duplicates: loadImg Functions

**5+ implementations of the same image loading logic:**

| Location | Function | Similarity |
|----------|----------|------------|
| App.jsx:60 | `loadImg(src, mx=1400)` | Original |
| App1.jsx:29 | `loadImg(src, mx=1400)` | 100% identical |
| CollectionView.jsx:32 | `loadImg(src, mx=1400)` | 99% (adds error handler) |
| card-detector.js:104 | `loadImage(source)` | Different implementation |
| centering-utils.js:13 | `loadImage(src)` | Simpler implementation |
| api.js:1082 | `loadImageFromUrl(url)` | Different parameters |

**Recommendation**: Consolidate to single utility in `src/lib/image-utils.js`

### 6.2 Duplicate genMaps Function

| Location | Line | Notes |
|----------|------|-------|
| App.jsx | ~1005 | Original implementation |
| CollectionView.jsx | 36-59 | Copy-pasted, identical logic |

**Recommendation**: Extract to shared utility

### 6.3 Duplicate Grading Logic

All these functions exist in both App.jsx AND App1.jsx with identical logic:

| Function | App.jsx Line | App1.jsx Line |
|----------|--------------|---------------|
| `checkCenteringDings` | 409 | 275 |
| `detectCornerDings` | 427 | 293 |
| `detectEdgeDings` | 558 | 440 |
| `detectSurfaceDings` | 620 | 502 |
| `computeGrade` | 834 | 716 |
| `findBounds` | 172 | 38 |

### 6.4 Duplicate UI Components

| Component | App.jsx | App1.jsx | Also In |
|-----------|---------|----------|---------|
| `ScoreRing` | 1067 | 844 | Old revs/* |
| `DingsMap` | 1502 | 1005 | Old revs/* |
| `DingLocationOverlay` | 1613 | 1116 | Old revs/* |

### 6.5 API Duplicates

| Code | File 1 | File 2 |
|------|--------|--------|
| `pollForResult` | ai-analyze.js:155 | extract-card-info.js:177 |
| `buildStitchedGradingPrompt` | ai-analyze.js:184 | ai-analyze-direct.js:179 |

---

## 7. Issues & Recommendations

### 7.1 High Priority

| Issue | Location | Recommendation |
|-------|----------|----------------|
| Monolithic App.jsx | 252KB, 3000+ lines | Extract components to separate files |
| Duplicate loadImg | 5+ implementations | Create shared `src/lib/image-utils.js` |
| Duplicate genMaps | App.jsx + CollectionView | Move to shared utility |
| Obsolete files | `Old revs/`, `App1.jsx`, `test/` | Archive or delete |
| Empty directories | `Common/`, `Grading/` | Remove or implement |

### 7.2 Medium Priority

| Issue | Location | Recommendation |
|-------|----------|----------------|
| Unused imports | App.jsx:11, 16 | Remove `analyzeCardWithVision`, `calculateCornerCentering` |
| Unused service exports | scans.js, auth.js | Remove or implement features |
| Missing CORS | 3 API endpoints | Add CORS headers |
| API duplicate functions | ai-analyze.js, extract-card-info.js | Extract to `api/_utils/` |
| Hardcoded card type | CollectionView.jsx:346 | Make dynamic |

### 7.3 Low Priority

| Issue | Location | Recommendation |
|-------|----------|----------------|
| Hardcoded EUR→USD rate | CollectionView.jsx | Use live conversion API |
| `AVG_DEFECTS_BY_GRADE` unused | tag-calibration.js:177 | Consider removing or documenting |
| Env var naming | deep-analyze-v2.js | Standardize VITE_ prefix usage |

### 7.4 Code Organization Improvements

1. **Extract from App.jsx**:
   - Image processing functions → `src/lib/image-processing.js`
   - Grade calculation → `src/lib/grading-engine.js`
   - Defect detection → `src/lib/defect-detection.js`
   - UI components → Individual files in `src/components/`

2. **Create shared utilities**:
   - `src/lib/image-utils.js` - Single loadImg/loadImage
   - `api/_utils/polling.js` - Shared pollForResult
   - `api/_utils/prompts.js` - Shared prompt builders

3. **Clean up**:
   - Remove `src/Old revs/` directory
   - Remove `src/App1.jsx`
   - Remove or properly organize `src/test/`
   - Delete empty component directories

---

## Appendix: Key Line Number Reference

### App.jsx Critical Functions

| Function | Line | Purpose |
|----------|------|---------|
| `analyzePhotoQuality` | 68 | Image quality check |
| `findBounds` | 172 | Card detection |
| `analyzeCentering` | 334 | Centering calculation |
| `checkCenteringDings` | 409 | Centering threshold |
| `detectCornerDings` | 427 | Corner wear |
| `detectEdgeDings` | 558 | Edge wear |
| `detectSurfaceDings` | 620 | Surface defects |
| `computeGrade` | 834 | Grade calculation |
| `genMaps` | 1005 | Vision maps |
| `analyzeCardFull` | 1033 | Full analysis |
| `SlabSense` (main) | 2810 | Main component |
| `run` | 2980 | Start analysis |
| `handleSaveScan` | 3306 | Save to DB |

### Service Functions

| Service | Function | Line |
|---------|----------|------|
| api.js | `claudeGradingAnalysis` | 487 |
| api.js | `deepGradingAnalysisV2` | 1429 |
| scans.js | `saveScan` | 57 |
| scans.js | `getUserScans` | 143 |
| auth.js | `signIn` | 32 |
| auth.js | `getProfile` | 85 |

---

*End of Audit Report*
