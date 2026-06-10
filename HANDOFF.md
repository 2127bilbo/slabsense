# SlabSense Development Handoff

**Date:** June 10, 2026
**Status:** Active Development - Beta Phase
**Codebase Audit:** See `CODEBASE_AUDIT.md` for detailed analysis

---

## Current State Summary

SlabSense is a multi-company card pre-grading application with **Claude AI integration** for accurate grading, **TCGDex** for high-quality card images, and **automated card identification** via CLIP visual matching + TCGDex API. The app supports PSA, BGS, SGC, CGC, and TAG grading standards.

### Recent Completed Work (June 2026)

| Feature | Description |
|---------|-------------|
| **TAG Calibration Integration** | Software grading now uses calibration data from 507 real TAG-graded reference cards |
| **5-Defect Cliff Rule** | Cards with 5+ defects hard-capped at grade 8.5 (per real TAG data) |
| **Grade Ceiling System** | Defect type-specific caps (e.g., PRISTINE requires 0 corner/0 edge defects) |
| **Centering Thresholds** | P90 values for all grades 1.0-10.0 (front and back) |
| **Software Confidence Score** | 0-100% confidence based on image quality (blur, glare, contrast, resolution) |
| **Codebase Audit** | Comprehensive audit of 600+ files, 200+ functions documented |
| **Masterweights System** | Single source of truth for all grading company data (`src/lib/masterweights.js`) |
| **Code Cleanup (C1-C6)** | Removed unused imports, deleted ~5.4MB obsolete files, consolidated duplicates, added CORS headers |
| **Shared Image Utilities** | Created `src/lib/image-utils.js` with shared `loadImg`, `genMaps`, `LUM` functions |
| **3D Card View Fixed** | Slab positioning and rendering issues resolved |
| **Surface Vision Modes** | Emboss, Hi-Pass, Edge Detection enabled on saved cards |
| **Cropped Images Display** | User's cropped front/back images shown in card detail view |
| **360 Card Viewer** | 3D slab viewer accessible from collection/card view |
| **Re-run Grading** | Button to re-analyze cards with AI from collection view |
| **High-res Crop Preservation** | Edge adjustment now keeps highest resolution cropped image |
| **Resolution Scaling** | Standard scan rescales after crop; Deep scan keeps full resolution |
| **Deep Scan Feature** | Higher quality independent front/back analysis (~$0.06 per scan) |
| **Domain Setup** | slabsense.com configured with Vercel deployment |
| **Anthropic Direct API** | Migrated from Replicate, enabled prompt caching (90% cost reduction) |
| **Crop Rotation Fix** | Auto-detects and corrects card rotation from corner positions (averages top/bottom edge angles for perspective) |
| **2-Step Centering Process** | Step 1: Define card edge (outer boundary) with rotation controls → crops card. Step 2: Define artwork boundary (inner) on cropped image → calculates centering ratios |
| **Unified Grade Display** | Single `GradeResultDisplay` component renders identically across all 6 locations (Grade Tab × 3 + Collection View × 3) |
| **Payment System (P11)** | Stripe integration with credits, subscriptions, and bundles |
| **Credit Balance UI** | Header displays credits with expiration warning, pricing modal |
| **AI Grade Credit Check** | Deducts 1 credit before AI grade, auto-refunds on failure |
| **Deep Grade Credit Check** | Deducts 2 credits before Deep grade, auto-refunds on failure |
| **AI Glare Detection Fix** | Enhanced prompts to distinguish camera glare from actual defects (both ai-analyze.js and deep-analyze-v2.js) |
| **Centering Tab Update Fix** | "Apply Correction" button now properly updates cropped image AND centering data |
| **TAG 1000-Point System** | Deep AI now uses TAG's exact 1000-point scale for all area scores (centering, corners, edges, surface) |
| **DIG Report Format** | Deep AI output matches TAG's DIG report structure with per-area scores and defect coordinates |
| **DingsTabV2 Component** | New dings tab with mode switching (software/ai/deep), 1000-point centering scoring |
| **DeepAiDingsMap Component** | Visual defect map with coordinate markers and per-area score indicators |

---

## What's Working

### Card Identification (CLIP Visual Matching)
- ✅ CLIP embedding matching (more accurate than pHash for holo/foil)
- ✅ Embedding database: 21,899 cards, ~215MB (5 chunks for Vercel)
- ✅ Variance-based card detection crops card from background
- ✅ TCGDex API integration for card data + high-quality images
- ✅ Manual search fallback for low-confidence matches
- ✅ Card images from TCGDex used for slabs (perfect quality)
- ✅ Collection view shows card images instead of text placeholders
- ✅ Thumbnails in search results from TCGDex
- ✅ **Missing image fallback** - User crops their photo when TCGDex has no image
- ✅ **Missing image logging** - Tracks cards without images for us to fix

### AI Grading (Claude via Replicate)
- ✅ Claude Sonnet 4 analyzes card images via Replicate API
- ✅ Returns grades for ALL 5 companies in one API call (~$0.03)
- ✅ Extracts card info (name, set, number, rarity, year)
- ✅ Measures centering (L/R, T/B ratios for front and back)
- ✅ Condition assessment (corners, edges, surface scores)
- ✅ Summary with positives, concerns, and recommendation
- ✅ BGS 4 subgrades displayed when BGS selected
- ✅ TAG 8 subgrades (front/back for each category)

### 3D Card View
- ✅ TCGDex provides clean card images (no SAM2 needed)
- ✅ 3D rotating slab view with realistic render

### Card Pricing (NEW)
- ✅ **TCGDex Cardmarket pricing** integrated (EUR → USD conversion)
- ✅ **Home screen** shows total collection value
- ✅ **Collection view** header shows total value + card count
- ✅ **Card stack** badges show individual card prices
- ✅ **Card detail modal** displays full price info with market source
- ✅ **Grade tab** shows card value after grading

### Collection View
- ✅ Card stack visual with swipe navigation
- ✅ **Shows actual card images** from TCGDex (not text placeholders)
- ✅ Click card to open full detail modal
- ✅ AI grade vs Software grade toggle (if both exist)
- ✅ Company tabs to switch grade display (PSA/BGS/SGC/CGC/TAG)
- ✅ Shows centering, condition, subgrades, summary
- ✅ Saves AI data with card (grades, condition, summary, centering)
- ✅ **Card values** shown on cards and in total

### Software Grading Engine (NEW)
- ✅ **TAG calibration data** - 507 reference cards analyzed
- ✅ **Centering thresholds** - P90 values for all grades (front/back)
- ✅ **Grade ceiling rules** - Defect type-specific caps
- ✅ **5-defect cliff** - 5+ defects = max 8.5 grade
- ✅ **Confidence scoring** - Based on image quality metrics
- ✅ **Pro user display** - Shows confidence % and factors

### Centering Tab
- ✅ **2-Step Centering Process** (PostCaptureCentering component):
  - **Step 1: Card Edge** — Position outer boundary to define card edges
    - Rotation controls (1° and 0.05° increments)
    - Only outer boundary handles shown (`activeHandles='outer'`)
    - "Next →" button crops card and advances to Step 2
    - Progress indicator: "1. Card Edge → 2. Artwork"
  - **Step 2: Artwork Boundary** — Position inner boundary on cropped card image
    - Cropped card preview shown (no background)
    - Only inner boundary handles shown (`activeHandles='inner'`)
    - "← Back" button returns to Step 1
    - "✓ Confirm" button calculates centering and saves
- ✅ **Rotation correction** uses averaged top/bottom edge angles (handles perspective distortion)
- ✅ Crosshair overlay for visual alignment guidance
- ✅ **Image storage flow**:
  - Original images: `fI` / `bI` (never modified)
  - Cropped images: `frontCroppedImage` / `backCroppedImage` (generated from outer bounds)
- ✅ **CornerHandles component** accepts `activeHandles` prop ('all' | 'outer' | 'inner')
- ✅ **Corner-anchored mode (beta toggle)**:
  - 8 corner drag handles (4 outer + 4 inner)
  - 5-sample median per edge for accuracy on tilted/warped cards
  - Per-edge confidence via coefficient of variation
  - Sample point visualization
  - Side-by-side comparison with edge-drag mode

### Frontend (React/Vite)
- ✅ Multi-company grading (TAG, PSA, BGS, CGC, SGC)
- ✅ Camera capture with bubble level guide
- ✅ Surface vision modes (Emboss, Hi-Pass, Edge Detection)
- ✅ DINGS map with defect markers
- ✅ Export grade cards (PNG download)
- ✅ Supabase auth (login/register)
- ✅ Profile settings with default grading company

### Database (Supabase)
- ✅ Tables: profiles, scans, memberships
- ✅ Saves AI grading data + TCGDex card data
- ✅ New fields: `tcgdex_image`, `tcgdex_id`

---

## Unified Grade Display Architecture

All grade results (Software, AI, Deep AI) render identically across the app using a single shared component: `GradeResultDisplay.jsx`

### 6 Locations Using Same Component

| Location | Grade Type | File |
|----------|------------|------|
| Grade Tab | Software | `App.jsx` |
| Grade Tab | AI | `App.jsx` |
| Grade Tab | Deep AI | `App.jsx` |
| Collection Card Details | Software | `CollectionView.jsx` |
| Collection Card Details | AI | `CollectionView.jsx` |
| Collection Card Details | Deep AI | `CollectionView.jsx` |

### Unified Layout Structure
```
┌─────────────────────────────────────────┐
│  [Cropped Front]  │  [Cropped Back]     │
├─────────────────────────────────────────┤
│  GRADE: 9.5     TAG SCORE: 875          │
│  AI ESTIMATE • 92% confidence           │
├─────────────────────────────────────────┤
│  SUBGRADES (8 boxes for TAG)            │
│  F-Cent│B-Cent│F-Corn│B-Corn│...        │
├─────────────────────────────────────────┤
│  CENTERING (Manual only - no AI)        │
│  Front: 48/52 L/R • 50/50 T/B           │
│  Back: 49/51 L/R • 50/50 T/B            │
├─────────────────────────────────────────┤
│  CONDITION                              │
│  Corners: 9/10 │ Edges: 9/10 │ Surface  │
├─────────────────────────────────────────┤
│  ✓ PROS: Well-centered, sharp corners   │
│  ⚠ CONS: Minor surface scratch          │
├─────────────────────────────────────────┤
│  RECOMMENDATION                         │
├─────────────────────────────────────────┤
│  CARD INFO                              │
│  Charizard • Base Set • #4 • 1999       │
└─────────────────────────────────────────┘
```

### Key Design Decisions
- **Single source of truth**: Any layout change in `GradeResultDisplay.jsx` applies to all 6 locations
- **No AI centering displayed**: Only manual/software centering shown (AI centering removed)
- **Cropped images only**: Shows cropped card images, not full photos with background
- **Grade type colors**: Software (#00ff88), AI (#8b5cf6), Deep AI (#f97316)
- **Company-specific subgrades**: TAG shows 8 subgrades, BGS/CGC show 4

---

## TAG 1000-Point Scoring System (Deep AI)

Deep AI now uses TAG's exact 1000-point scale for grading. Each area starts at 1000 and the **lowest score determines the grade**.

### Grade Scale (by lowest area score)
| Score Range | Grade | Label |
|-------------|-------|-------|
| 990-1000 | 10 | PRISTINE |
| 950-989 | 10 | GEM MINT |
| 900-949 | 9 | MINT |
| 850-899 | 8.5 | NM-MT+ |
| 800-849 | 8 | NM-MT |
| 750-799 | 7.5 | NM+ |
| 700-749 | 7 | NM |
| 650-699 | 6.5 | EX-MT+ |
| 600-649 | 6 | EX-MT |
| 500-599 | 5 | EX |

### Area Scores (each 0-1000)
- **Centering Front/Back**: Based on L/R and T/B deviation from 50/50
- **Corners (TL/TR/BL/BR)**: Per-corner scores for front and back
- **Edges (TOP/BOTTOM/LEFT/RIGHT)**: Per-edge scores for front and back
- **Surface Front/Back**: Based on scratches, print lines, play wear

### DIG Report Format
The Deep AI response includes a `digReport` object matching TAG's format:
```javascript
digReport: {
  score_total: 940,           // Lowest area score = final grade
  scores: {
    centering_front: 980,
    centering_back: 940,      // Grade-limiting factor
    corners_front: 950,
    corners_back: 960,
    edges_front: 960,
    edges_back: 960,
    surface_front: 965,
    surface_back: 950,
  },
  lowestArea: "back centering",
  defects: { total_dings, corners, edges, surface, dings[] }
}
```

### Validation
Tested against 5 TAG reference cards (grades 6-10). Results:
- **4/5 exact matches** (same grade and score within ±20)
- **1/5 close match** (within ±0.5 grade, ±50 points)
- **0/5 mismatches**

### Files
| File | Purpose |
|------|---------|
| `api/deep-analyze-v2.js` | Production Deep AI with 1000-point scoring |
| `api/backup/deep-analyze-v2-pre-1000pt.js` | Backup of previous 125-scale version |
| `src/components/Grading/DingsTabV2.jsx` | Mode-switching dings tab (software/ai/deep) |
| `src/components/Grading/DeepAiDingsMap.jsx` | Visual defect map with coordinates |
| `scripts/test-deep-analyze-v3.js` | Test script for validation |
| `scripts/deep-analyze-v3-validation-report.md` | Validation analysis report |

---

## Card Identification Flow (CLIP)

```
User uploads/captures card image
  → Image resized to 1920x1440 max (JPEG 0.92)
  → Card cropped from background (variance detection)
  → CLIP embedding computed (512-dim vector)
  → Cosine similarity search against 21,899 embeddings

If similarity >= 0.85 (high confidence):
  → Show match with thumbnail for user confirmation
  → Full card data + high-quality image loaded from TCGDex

If similarity 0.75-0.85 (medium confidence):
  → Show top candidates for user to pick
  → User taps correct card

If similarity < 0.75 (low confidence):
  → Manual search UI shown
  → User types card name → TCGDex search

Result:
  → Card info populated
  → TCGDex image used for slab (perfect quality)
  → Data saved with scan
```

**CLIP Embeddings:**
- Location: `public/models/clip_embeddings_*.json` (5 chunks, ~215MB total)
- Card metadata: `public/card-hashes.json` (~1.94MB)
- Split script: `node scripts/split-embeddings.cjs`

---

## API Flow

### Card Identification (FREE - TCGDex)
```
User captures card image
  → extractCardInfo(image) [browser-side OCR]
  → smartSearch(ocrResults) [TCGDex API]
  → getFullCardData(cardId) [TCGDex API]
  → Returns: cardInfo, imageHigh, set details
```

### AI Grade Button (~$0.03)
```
User clicks "AI Grade Card"
  → claudeGradingAnalysis(front, back)
  → Stitches images side-by-side
  → Sends to /api/ai-analyze (Claude Sonnet 4)
  → Returns: cardInfo, centering, condition, grades (all 5 companies), summary
  → UI displays immediately
```

### 3D View Button (FREE)
```
User clicks "3D Slab View"
  → Uses TCGDex image (if available) for clean card display
  → Falls back to user's captured photo if no TCGDex image
  → Opens 3D rotating slab viewer
```

---

## Key Files

### Card Identification (CLIP)
| File | Purpose |
|------|---------|
| `src/lib/clip-matcher.js` | CLIP embedding computation + cosine similarity matching |
| `src/lib/card-detector.js` | Variance-based card cropping |
| `src/lib/identify-card.js` | Main identification pipeline |
| `src/services/tcgdex.js` | TCGDex API wrapper |
| `src/components/CardIdentifier/CardIdentifier.jsx` | Identification UI flow |
| `public/models/clip_embeddings_*.json` | Pre-computed embeddings (5 chunks) |
| `public/card-hashes.json` | Card metadata (names, sets, numbers) |
| `scripts/split-embeddings.cjs` | Split embeddings into Vercel-compatible chunks |

### Frontend
| File | Purpose |
|------|---------|
| `src/App.jsx` | Main app, grading UI, card identifier integration |
| `src/services/api.js` | `claudeGradingAnalysis()`, `samCardCropping()` |
| `src/services/scans.js` | Saves AI data + TCGDex data with cards |
| `src/components/Collection/CollectionView.jsx` | Card stack with images |
| `src/components/Grading/GradeResultDisplay.jsx` | **Unified grade display** - single component for all 6 grade views |
| `src/components/CornerHandles.jsx` | Corner-anchored centering UI + breakdown panel |
| `src/lib/corner-measurement.js` | 5-sample median centering calculation |
| `src/lib/masterweights.js` | **Single source of truth** for all grading company data (centering, scales, algorithms) |
| `src/lib/image-utils.js` | Shared image utilities (`loadImg`, `genMaps`, `LUM`) |
| `src/lib/tag-calibration.js` | Re-exports from masterweights for backward compatibility |
| `src/utils/gradingScales.js` | Re-exports from masterweights for backward compatibility |

### API Routes (Vercel)
| File | Purpose |
|------|---------|
| `api/ai-analyze.js` | Claude grading via Replicate |

### Backend (Optional - Python/FastAPI)
| File | Purpose |
|------|---------|
| `backend/main.py` | FastAPI entry point |
| `backend/services/centering.py` | OpenCV centering (legacy) |
| `backend/services/grading.py` | TAG-style scoring |

---

## Environment Variables

### Required for AI Features
```
REPLICATE_API_TOKEN=your_replicate_token
```

### Supabase
```
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_anon_key
```

---

## Database Schema

The `scans` table columns:

```sql
-- AI grading data
ALTER TABLE scans ADD COLUMN IF NOT EXISTS ai_grades JSONB;
ALTER TABLE scans ADD COLUMN IF NOT EXISTS ai_condition JSONB;
ALTER TABLE scans ADD COLUMN IF NOT EXISTS ai_summary JSONB;
ALTER TABLE scans ADD COLUMN IF NOT EXISTS ai_centering JSONB;
ALTER TABLE scans ADD COLUMN IF NOT EXISTS card_info JSONB;

-- TCGDex card identification
ALTER TABLE scans ADD COLUMN IF NOT EXISTS tcgdex_image TEXT;
ALTER TABLE scans ADD COLUMN IF NOT EXISTS tcgdex_id TEXT;
ALTER TABLE scans ADD COLUMN IF NOT EXISTS user_card_image TEXT;  -- Fallback when TCGDex has no image
```

The `missing_images` table (for tracking cards without TCGDex images):

```sql
CREATE TABLE missing_images (
  id UUID PRIMARY KEY,
  tcgdex_id TEXT NOT NULL UNIQUE,
  card_name TEXT,
  set_name TEXT,
  card_number TEXT,
  report_count INTEGER DEFAULT 1,
  last_reported TIMESTAMPTZ
);
```

---

## CLIP Technical Details

### How It Works
1. **Card Detection** - Grid-based variance analysis finds card bounds
2. **Cropping** - Removes background, isolates card
3. **CLIP Embedding** - Transformers.js computes 512-dimension vector
4. **Cosine Similarity** - Compare against 21,899 pre-computed embeddings
5. **Confidence** - Similarity ≥0.85: high, 0.75-0.85: medium, <0.75: low

### Model Details
- **Model:** `Xenova/clip-vit-base-patch32` via Transformers.js
- **First-time download:** ~90MB (cached in browser IndexedDB)
- **Embedding dimension:** 512 floats per card
- **Embeddings storage:** 5 JSON chunks (~43MB each) in `public/models/`

### Performance Targets
- CLIP model load: 2-5s (first time), instant (cached)
- Embedding compute: 200-500ms
- Match search (21k cards): <50ms
- TCGDex API call: 200-500ms (cached after)

### Advantages over pHash
- **Better for holo/foil cards** - CLIP understands visual features, not just edges
- **More robust to lighting** - Semantic matching vs pixel-level hashing
- **Higher accuracy** - 512-dim vector vs 64-bit hash

---

## Codebase Audit Summary

> Full details in `CODEBASE_AUDIT.md`

### Statistics
- **Total Files**: 600+
- **Total Functions**: 200+
- **App.jsx Size**: 252KB, 3000+ lines
- **API Endpoints**: 6

### Critical Issues Found

| Priority | Issue | Location | Status |
|----------|-------|----------|--------|
| **HIGH** | Monolithic App.jsx | 252KB single file - needs refactoring | Pending |
| **HIGH** | Duplicate `loadImg` | 5+ implementations across files | ✅ Fixed - consolidated to `src/lib/image-utils.js` |
| **HIGH** | Duplicate `genMaps` | App.jsx + CollectionView.jsx | ✅ Fixed - consolidated to `src/lib/image-utils.js` |
| **MEDIUM** | Obsolete files | `src/Old revs/`, `src/App1.jsx`, `src/test/` | ✅ Deleted (~5.4MB removed) |
| **MEDIUM** | Empty directories | `src/components/Common/`, `src/components/Grading/` | ✅ Removed |
| **MEDIUM** | Unused imports | `analyzeCardWithVision`, `calculateCornerCentering` | ✅ Removed |
| **LOW** | Missing CORS | 3 of 6 API endpoints lack CORS headers | ✅ Fixed - headers added |

### Unused Code Removed ✅
- ~~`scans.js`: `toggleFavorite`, `getFavoriteScans`, `searchScans`, `uploadUserCardImage`~~ DELETED
- ~~`auth.js`: `resetPassword`, `checkProAccess`~~ DELETED
- ~~`tag-calibration.js`: `AVG_DEFECTS_BY_GRADE`~~ Already removed in consolidation
- Note: `uploadCardImage` in scans.js is used by `saveScan` - kept

### Recommended Extractions from App.jsx (Future Refactoring)
1. Image processing → `src/lib/image-processing.js`
2. Grade calculation → `src/lib/grading-engine.js`
3. Defect detection → `src/lib/defect-detection.js`
4. ~~Shared utilities → `src/lib/image-utils.js`~~ ✅ DONE

---

## Next Steps

### Completed
1. ✅ AI grading integration (Claude via Replicate)
2. ✅ 3D slab view (TCGDex images)
3. ✅ Collection card stack with images
4. ✅ Centering rotation controls + 3-axis perspective (Pitch/Roll/Rotate)
5. ✅ UI consolidation
6. ✅ Card identification (pHash + TCGDex)
7. ✅ TCGDex search fix (server-side filtering)
8. ✅ pHash visual matching pipeline
9. ✅ **Card pricing** - TCGDex Cardmarket values on home/collection/grade
10. ✅ **Incremental hash updates** - `--update` flag for new sets only
11. ✅ **Hash database built** - 21,900 cards, 18GB images, 1.94MB hash DB

### Beta Phase (Current) - Completed
12. ✅ **Corner-anchored centering mode** - Toggle alternative to edge-drag with 5-sample median per edge
13. ✅ **Missing image fallback** - User crops photo when TCGDex has no image
14. ✅ **Database schema updates** - Added `user_card_image` column
15. ✅ **Camera retake bug fix** - Video playback restarted after retake
16. ✅ **CLIP visual matching** - Replaced pHash with CLIP for better holo/foil card matching
   - 21,899 card embeddings split into 5 chunks (~43MB each)
   - Uses Transformers.js (@xenova/transformers) in browser
   - Cosine similarity matching with confidence thresholds
17. ✅ **File upload resizing** - Uploaded images now resize to 1920x1440 (matches camera constraints)
18. ✅ **Technical documentation** - Complete system reference guide (docs/TECHNICAL_REFERENCE.md)
19. ✅ **TAG calibration integration** - Software grading now uses real data from 507 TAG-graded cards
   - Centering thresholds (P90 values) for all grades 1.0-10.0
   - Grade ceiling rules based on defect counts and types
   - 5-defect cliff rule (5+ defects = max 8.5 grade)
   - PRISTINE requires 0 corner/0 edge defects
20. ✅ **Software confidence scoring** - 0-100% confidence based on image quality
   - Blur detection, glare/overexposure, contrast, resolution
   - Displayed for Pro users with contributing factors
21. ✅ **Codebase audit** - Full audit with 200+ functions documented in CODEBASE_AUDIT.md

---

## 🎯 PRIORITY CHECKLIST (Sorted: Easy → Hard)

### Tier 0: Cleanup Tasks (From Audit) ✅ COMPLETE
| # | Task | Status | Notes |
|---|------|--------|-------|
| C1 | **Remove unused imports** | [x] | App.jsx: `analyzeCardWithVision`, `calculateCornerCentering` |
| C2 | **Delete obsolete files** | [x] | `src/Old revs/`, `src/App1.jsx`, `src/test/` (~5.4MB removed) |
| C3 | **Remove empty directories** | [x] | `src/components/Common/` |
| C4 | **Create shared loadImg utility** | [x] | Consolidated to `src/lib/image-utils.js` |
| C5 | **Extract genMaps to shared lib** | [x] | Removed duplicates from App.jsx and CollectionView.jsx |
| C6 | **Add missing CORS headers** | [x] | ai-analyze.js, analyze-card.js, extract-card-info.js |

### Tier 1: Quick Wins ✅ COMPLETE
| # | Task | Status | Notes |
|---|------|--------|-------|
| P1 | **Fix 3D card view** | [x] | Slab positioning/rendering fixed |
| P2 | **Card View Tab - Add surface vision modes** | [x] | Emboss, Hi-Pass, Edge Detection enabled on saved cards |
| P3 | **Card View Tab - Show cropped images** | [x] | User's cropped front/back images displayed in card detail view |

### Tier 2: Medium Tasks ✅ COMPLETE
| # | Task | Status | Notes |
|---|------|--------|-------|
| P4 | **Card View Tab - Add 360 card viewer** | [x] | 3D slab viewer accessible from collection/card view |
| P5 | **Card View Tab - Re-run grading option** | [x] | Button to re-analyze card with AI |
| P6 | **High-res crop preservation** | [x] | Edge adjustment keeps highest resolution cropped image |
| P7 | **Resolution scaling for standard scan** | [x] | Standard scan rescales; Deep scan keeps full resolution |

### Tier 3: Significant Development ✅ COMPLETE
| # | Task | Status | Notes |
|---|------|--------|-------|
| P8 | **Deep Scan feature** | [x] | Higher quality independent front/back analysis (~$0.06 per scan) |
| P9 | **Domain setup - slabsense.com** | [x] | Domain configured with Vercel deployment |
| P10 | **Migrate to Anthropic direct API** | [x] | Removed Replicate dependency, prompt caching enabled (90% cost reduction) |

### Tier 4: Major Features (Multiple days) - IN PROGRESS
| # | Task | Status | Notes |
|---|------|--------|-------|
| P11 | **Token system & billing** | [x] | Stripe credits (1=AI, 2=Deep), subscriptions, bundles, Stripe webhooks |
| P12 | **Subscription tiers** | [x] | Trial $4.99, Hobby $9.99, Pro $19.99, Dealer $49.99, Lifetime (admin only) |
| P13 | **Production deployment** | [ ] | Full production setup, monitoring, error tracking |

### Tier 5: Post-Launch
| # | Task | Status | Notes |
|---|------|--------|-------|
| P14 | **3D photo rig build** | [ ] | Purchase lights, diffusers, build physical rig for consistent card photography |
| P15 | **Mobile app (Capacitor)** | [ ] | Wrap existing code for iOS/Android |
| P16 | **Automated embedding updates** | [ ] | Serverless job to generate CLIP embeddings for new TCGDex cards |

---

## Original Remaining Items (For Reference)

### Testing & Polish
19. [ ] Fine-tune SlabSense slab positioning
20. [ ] Test full flow end-to-end
21. [ ] Bug fixes and polish

### Future Enhancements
- [ ] Custom ML model for card recognition (using saved images)
- [ ] Sports cards support (baseball, basketball, etc.)
- [ ] Price tracking history & trends
- [ ] Social features (share collections)
- [ ] Bulk grading mode
- [ ] **Upgrade Vercel plan** - Higher payload limits allow larger images for better AI grading accuracy
   - Current: Free tier (4.5MB function payload limit, 100MB deployment size)
   - Pro tier: 50MB payload limit, 1GB deployment size
   - Would enable higher resolution card images for detecting fine defects

---

## Deployment

**Vercel auto-deploys from GitHub.** Any push to `main` triggers a production deployment.

```bash
# Push to deploy
git push origin main
# Vercel automatically builds and deploys from GitHub
```

No need to run `vercel --prod` manually - just push to GitHub.

---

## Test the App

```bash
# Frontend
cd "G:\Grading App\SlabSense"
npm run dev
# Opens at http://localhost:5173

# Test card identification (CLIP):
# 1. Upload a card image (front)
# 2. CLIP model computes 512-dim embedding
# 3. Cosine similarity search against 21,899 embeddings
# 4. High confidence (>0.85) → shows match for confirmation
# 5. Medium confidence (0.75-0.85) → shows candidates to pick
# 6. Low/error → falls back to manual name search
# 7. Card data + high-quality image loaded from TCGDex

# Build hash database (for card metadata):
node scripts/build-hash-db.cjs --save-images

# Split embeddings into Vercel-compatible chunks:
node scripts/split-embeddings.cjs

# Deploy to Vercel
vercel --prod
```

---

## Troubleshooting

### CLIP Not Matching Cards
- Similarity < 0.75 indicates low confidence match
- Check browser console for CLIP loading errors
- Verify embedding chunks exist in `public/models/`
- Falls back to manual search automatically

### Card Not Cropping Properly
- Variance detection needs contrast between card and background
- Use plain background (not busy patterns)
- Ensure good lighting

### TCGDex Search No Results
- Check card name spelling
- Try partial name (e.g., "Pikachu" not "Pikachu EX")
- TCGDex only has Pokemon cards (not other TCGs)

### Missing Thumbnails in Search Results
- Check TCGDex image URL format includes series prefix
- URL format: `https://assets.tcgdex.net/en/{series}/{setId}/{number}/low.webp`
- See series mapping in `src/lib/clip-matcher.js`

### AI Grading Not Working
- Check Vercel logs for `/api/ai-analyze` errors
- Verify `REPLICATE_API_TOKEN` environment variable
- Check Replicate dashboard for API status/billing
- See `docs/TECHNICAL_REFERENCE.md` for full troubleshooting guide

---

---

## Reference Documentation

| File | Purpose |
|------|---------|
| `CODEBASE_AUDIT.md` | **Full codebase audit - folder structure, 200+ functions, unused code, duplicates** |
| `docs/TECHNICAL_REFERENCE.md` | **Complete system architecture, troubleshooting guide, all features explained** |
| `docs/Masterweights.md` | **Single source of truth documentation** - all grading weights, thresholds, algorithms |
| `docs/grading-research/` | Grading standards and defect weights for all 5 companies |
| `src/lib/masterweights.js` | **Code implementation** of Masterweights - centering thresholds, grade scales, algorithms |
| `src/lib/tag-calibration.js` | Re-exports from masterweights (backward compatibility) |

---

*Last Updated: June 10, 2026 (2-Step Centering Process with rotation fix)*
