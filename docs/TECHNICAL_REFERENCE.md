# SlabSense Technical Reference

**Version:** 0.1.0-beta
**Last Updated:** April 16, 2026

This document provides a complete technical overview of SlabSense for debugging, maintenance, and development.

---

## Table of Contents

1. [System Architecture](#system-architecture)
2. [External Services](#external-services)
3. [Application Flow](#application-flow)
4. [Tab-by-Tab Feature Guide](#tab-by-tab-feature-guide)
5. [Image Processing Pipeline](#image-processing-pipeline)
6. [Card Identification (CLIP)](#card-identification-clip)
7. [AI Grading System](#ai-grading-system)
8. [Data Storage](#data-storage)
9. [Key Files Reference](#key-files-reference)
10. [Troubleshooting Guide](#troubleshooting-guide)
11. [Environment Variables](#environment-variables)

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                          FRONTEND (React/Vite)                       │
│                        Deployed on Vercel                            │
├─────────────────────────────────────────────────────────────────────┤
│  src/App.jsx              - Main app, all tabs, camera/upload       │
│  src/components/          - UI components (CardIdentifier, etc.)    │
│  src/services/api.js      - API calls (Claude, backend)             │
│  src/services/tcgdex.js   - TCGDex API wrapper                      │
│  src/services/scans.js    - Supabase database operations            │
│  src/lib/                 - Core libraries (CLIP, pHash, centering) │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                    ┌───────────────┼───────────────┐
                    ▼               ▼               ▼
        ┌───────────────┐  ┌───────────────┐  ┌───────────────┐
        │   TCGDex API  │  │   Replicate   │  │   Supabase    │
        │  (Card Data)  │  │ (Claude AI)   │  │  (Database)   │
        │     FREE      │  │  ~$0.03/call  │  │    FREE tier  │
        └───────────────┘  └───────────────┘  └───────────────┘
```

### Hosting

| Component | Service | URL/Dashboard |
|-----------|---------|---------------|
| Frontend | Vercel | https://vercel.com/dashboard |
| API Routes | Vercel Serverless | `/api/*` routes in project |
| Database | Supabase | https://supabase.com/dashboard |
| AI Model | Replicate | https://replicate.com/account |
| Card Data | TCGDex | https://tcgdex.dev (no account needed) |

---

## External Services

### 1. TCGDex API (FREE)

**Purpose:** Card identification, card images, pricing data

**Base URL:** `https://api.tcgdex.net/v2/en/`

**What we fetch:**
- Card search by name: `/cards?name={query}`
- Full card data: `/cards/{cardId}`
- Card images: `https://assets.tcgdex.net/en/{series}/{set}/{number}/{quality}.{format}`
- Pricing: Cardmarket prices included in card data (EUR, converted to USD)

**Key File:** `src/services/tcgdex.js`

**Image URL Format:**
```
https://assets.tcgdex.net/en/{series}/{setId}/{localId}/{quality}.{format}

Examples:
- https://assets.tcgdex.net/en/sv/sv01/001/high.png
- https://assets.tcgdex.net/en/swsh/swsh3/136/low.webp
```

**Series Mapping:**
| Prefix | Series |
|--------|--------|
| sv* | sv |
| swsh* | swsh |
| sm* | sm |
| xy* | xy |
| bw* | bw |
| hgss* | hgss |
| dp*, pl* | dp |
| ex* | ex |
| base*, gym*, neo* | base |

---

### 2. Replicate API (Claude AI)

**Purpose:** AI-powered card grading analysis

**Model:** `anthropic/claude-4-sonnet`

**Cost:** ~$0.02-0.03 per analysis

**API Key:** `REPLICATE_API_TOKEN` (set in Vercel environment variables)

**Endpoint:** `/api/ai-analyze` (Vercel serverless function)

**Key File:** `api/ai-analyze.js`

**What Claude analyzes:**
- Centering measurements (L/R, T/B ratios)
- Condition assessment (corners, edges, surface)
- Card identification (name, set, number, rarity)
- Grades for ALL 5 companies (PSA, BGS, SGC, CGC, TAG)

**Response Format:**
```json
{
  "cardInfo": { "name": "...", "setName": "...", "cardNumber": "..." },
  "centering": { "front": { "leftRight": "55/45", "topBottom": "50/50" } },
  "condition": { "corners": 9.5, "edges": 9.0, "surface": 9.5 },
  "grades": {
    "psa": { "grade": 9, "label": "Mint" },
    "bgs": { "grade": 9.5, "subgrades": {...} },
    "sgc": { "grade": 9.5 },
    "cgc": { "grade": 9.5 },
    "tag": { "score": 955, "grade": 10, "subgrades": {...} }
  }
}
```

---

### 3. Supabase (Database)

**Purpose:** User authentication, card collection storage

**Dashboard:** https://supabase.com/dashboard

**Tables:**

| Table | Purpose |
|-------|---------|
| `profiles` | User settings (default grading company) |
| `scans` | Saved card scans with grades and images |
| `missing_images` | Track cards without TCGDex images |

**Key Fields in `scans`:**
```sql
- id, user_id, created_at
- front_image, back_image          -- User's captured photos
- tcgdex_image, tcgdex_id          -- TCGDex card reference
- user_card_image                   -- Fallback when TCGDex has no image
- card_info (JSONB)                 -- Card metadata
- ai_grades (JSONB)                 -- All 5 company grades
- ai_condition (JSONB)              -- Condition scores
- ai_centering (JSONB)              -- Centering measurements
- ai_summary (JSONB)                -- Positives, concerns, recommendation
- centering_data (JSONB)            -- Software centering results
```

**Key File:** `src/services/scans.js`

---

## Application Flow

### Main User Flow

```
1. HOME TAB
   └── Shows collection value, recent scans, quick actions

2. CAPTURE/UPLOAD IMAGE
   ├── Camera: getUserMedia with 1920x1440 max constraint
   └── Upload: File resized to 1920x1440 max, JPEG 0.92 quality

3. CARD IDENTIFICATION (CLIP)
   ├── Crop card from background (variance detection)
   ├── Compute CLIP embedding (512-dim vector)
   ├── Search 21,899 pre-computed embeddings
   ├── Show top matches with thumbnails
   └── User confirms correct card

4. FRONT/BACK TABS
   ├── Show captured image
   ├── Surface vision modes (Emboss, Hi-Pass, Edge)
   └── Manual centering adjustment available

5. CENTERING TAB
   ├── Two modes: Edge-drag OR Corner-anchored
   ├── Rotation controls (1° and 0.05° increments)
   ├── 3-axis perspective correction
   └── Calculates L/R, T/B ratios

6. GRADE TAB
   ├── Shows software-calculated grade OR
   ├── "AI Grade Card" button (~$0.03)
   │   ├── Stitches front+back images
   │   ├── Sends to Claude via Replicate
   │   └── Returns grades for all 5 companies
   └── Company selector tabs (PSA/BGS/SGC/CGC/TAG)

7. SAVE TO COLLECTION
   └── Stores in Supabase with all grade data
```

---

## Tab-by-Tab Feature Guide

### Home Tab

**File:** `src/App.jsx` (home section)

**Features:**
- Total collection value (sum of all card prices)
- Card count
- Recent scans preview
- Quick action buttons

**Data Source:** TCGDex Cardmarket prices (EUR → USD at 1.08 rate)

---

### Capture Tab

**File:** `src/App.jsx` (camera section)

**Camera Constraints:**
```javascript
{
  video: {
    facingMode: 'environment',
    width: { ideal: 1920, max: 1920 },
    height: { ideal: 1440, max: 1440 }
  }
}
```

**Upload Resizing:**
```javascript
// In handleFile():
const maxW = 1920, maxH = 1440;
if (w > maxW || h > maxH) {
  const scale = Math.min(maxW / w, maxH / h);
  w = Math.round(w * scale);
  h = Math.round(h * scale);
}
// Output: JPEG at 0.92 quality
```

**Photo Quality Checks:**
- Blur detection (Laplacian variance)
- Lighting check (over/under exposure)
- Card fill percentage

**Key Functions:**
- `analyzePhotoQuality()` - Validates image quality
- `validateCap()` - Runs quality checks on capture

---

### Front/Back Tabs

**File:** `src/App.jsx` (front/back sections)

**Features:**
- Display captured card image
- Surface vision filter modes:
  - **Normal** - Original image
  - **Emboss** - Highlights surface texture
  - **Hi-Pass** - High-pass filter for scratches
  - **Edge** - Edge detection for defects
- Manual boundary adjustment available

**Vision Mode Implementation:**
```javascript
// Emboss kernel
const embossKernel = [
  [-2, -1, 0],
  [-1,  1, 1],
  [ 0,  1, 2]
];
```

---

### Centering Tab

**Files:**
- `src/App.jsx` (centering section)
- `src/components/CornerHandles.jsx`
- `src/lib/corner-measurement.js`

**Two Modes:**

1. **Edge-Drag Mode** (Default)
   - 4 draggable handles for card edges
   - 4 draggable handles for artwork edges
   - Simple L/R, T/B calculation

2. **Corner-Anchored Mode** (Beta toggle)
   - 8 corner handles (4 outer + 4 inner)
   - 5-sample median measurement per edge
   - Per-edge confidence scores
   - Better for warped/tilted cards

**Rotation Controls:**
- Coarse: ±1° increments
- Fine: ±0.05° increments
- 3-axis perspective: Pitch, Roll, Rotate

**Centering Calculation:**
```javascript
// L/R Ratio
const leftBorder = artworkLeft - cardLeft;
const rightBorder = cardRight - artworkRight;
const lrRatio = leftBorder / (leftBorder + rightBorder) * 100;

// T/B Ratio
const topBorder = artworkTop - cardTop;
const bottomBorder = cardBottom - artworkBottom;
const tbRatio = topBorder / (topBorder + bottomBorder) * 100;
```

---

### Grade Tab

**File:** `src/App.jsx` (grade section)

**Two Grade Types:**

1. **Software Grade**
   - Based on centering measurements only
   - Uses `src/utils/gradingScales.js` for scoring
   - Free, instant

2. **AI Grade** (Claude)
   - Full analysis of image
   - Centering + Corners + Edges + Surface
   - Returns grades for all 5 companies
   - Cost: ~$0.03 per analysis

**Company Tabs:** PSA | BGS | SGC | CGC | TAG

**BGS Subgrades Display:**
- Centering, Corners, Edges, Surface (each 1-10)

**TAG Subgrades Display:**
- 8 categories: Front/Back × (Centering, Corners, Edges, Surface)
- 1000-point total score

**Grade Scales:**
```javascript
// PSA (no 9.5)
[10, 9, 8, 7, 6, 5, 4, 3, 2, 1]

// BGS (has 9.5, 8.5, etc.)
[10, 9.5, 9, 8.5, 8, 7.5, 7, 6.5, 6, 5.5, 5, ...]

// TAG (1000-point with grade mapping)
990-1000 = Pristine 10
950-989  = Gem Mint 10
900-949  = Mint 9
```

---

### 3D View

**File:** `src/components/CardViewer/CardViewer3D.jsx`

**Features:**
- Rotating 3D slab display
- Uses TCGDex high-quality image for card face
- Falls back to user's captured image if no TCGDex image

---

### Collection View

**File:** `src/components/Collection/CollectionView.jsx`

**Features:**
- Card stack with swipe navigation
- Card thumbnails from TCGDex
- Total collection value in header
- Per-card price badges
- Click card → Full detail modal
- AI vs Software grade toggle
- Company tabs for different grades

---

## Image Processing Pipeline

### 1. Image Capture/Upload

```
Camera Capture                    File Upload
      │                               │
      ▼                               ▼
getUserMedia                    FileReader.readAsDataURL
(1920x1440 max)                       │
      │                               ▼
      │                    Resize to 1920x1440 max
      │                    JPEG quality 0.92
      │                               │
      └───────────┬───────────────────┘
                  ▼
         Photo Quality Check
         (blur, lighting, fill)
                  │
                  ▼
            Card Detection
         (variance-based crop)
                  │
                  ▼
          CLIP Identification
         (21,899 embeddings)
```

### 2. AI Grading Pipeline

```
Front Image + Back Image
           │
           ▼
    Stitch Side-by-Side
   (for single API call)
           │
           ▼
  POST /api/ai-analyze
           │
           ▼
    Replicate API
  (Claude 4 Sonnet)
           │
           ▼
   Parse JSON Response
           │
           ▼
   Display All 5 Grades
```

### 3. Image Size Constraints

| Stage | Max Dimension | Format | Quality |
|-------|---------------|--------|---------|
| Camera capture | 1920×1440 | JPEG | Native |
| File upload resize | 1920×1440 | JPEG | 0.92 |
| CLIP processing | 800×800 | Canvas | N/A |
| Claude API | 1500×1500 | JPEG | 0.85 |
| Vercel payload limit | N/A | N/A | 4.5MB max |

---

## Card Identification (CLIP)

### Overview

CLIP (Contrastive Language-Image Pre-training) provides visual card matching that's more robust than pHash for holographic/foil cards.

### Files

| File | Purpose |
|------|---------|
| `src/lib/clip-matcher.js` | CLIP embedding & matching |
| `src/lib/card-detector.js` | Card cropping from photo |
| `src/lib/identify-card.js` | Main identification pipeline |
| `public/models/clip_embeddings_*.json` | Pre-computed embeddings (5 chunks) |
| `public/card-hashes.json` | Card metadata (names, sets) |

### Embedding Files

```
public/models/
├── clip_embeddings_0.json  (~43MB, cards 1-4380)
├── clip_embeddings_1.json  (~43MB, cards 4381-8760)
├── clip_embeddings_2.json  (~43MB, cards 8761-13140)
├── clip_embeddings_3.json  (~43MB, cards 13141-17520)
└── clip_embeddings_4.json  (~43MB, cards 17521-21899)
```

Each file is under 50MB to comply with Vercel's 100MB per-file limit.

### CLIP Model

- **Model:** `Xenova/clip-vit-base-patch32`
- **Library:** `@xenova/transformers` (Transformers.js)
- **Embedding Dimension:** 512
- **First-time Download:** ~90MB (cached in browser)

### Matching Process

```javascript
1. Load CLIP model (lazy, cached)
2. Load embeddings (5 chunks in parallel)
3. Load card info (from card-hashes.json)
4. Detect & crop card from photo
5. Compute 512-dim embedding for photo
6. Cosine similarity search against all embeddings
7. Return top matches with confidence scores

Confidence Thresholds:
- similarity >= 0.85 → 'high' (auto-match candidate)
- similarity >= 0.75 → 'medium' (show for confirmation)
- similarity >= 0.65 → 'low'
- similarity < 0.65  → 'none' (fall back to manual search)
```

---

## AI Grading System

### API Endpoint

**File:** `api/ai-analyze.js`

**URL:** `POST /api/ai-analyze`

**Request:**
```json
{
  "image": "data:image/jpeg;base64,...",
  "isStitched": true,
  "cardType": "pokemon"
}
```

**Response:**
```json
{
  "success": true,
  "analysis": {
    "cardInfo": {...},
    "centering": {...},
    "condition": {...},
    "grades": {
      "psa": {...},
      "bgs": {...},
      "sgc": {...},
      "cgc": {...},
      "tag": {...}
    },
    "summary": {...}
  },
  "model": "anthropic/claude-4-sonnet"
}
```

### Replicate Integration

```javascript
// api/ai-analyze.js
const CLAUDE_MODEL = 'anthropic/claude-4-sonnet';

const response = await fetch(
  `https://api.replicate.com/v1/models/${CLAUDE_MODEL}/predictions`,
  {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${REPLICATE_API_TOKEN}`,
      'Content-Type': 'application/json',
      'Prefer': 'wait',  // Synchronous mode
    },
    body: JSON.stringify({
      input: {
        prompt: gradingPrompt,
        image: imageDataUrl,
        max_tokens: 6000,
        temperature: 0.1,
      }
    }),
  }
);
```

### Grading Prompt

The prompt instructs Claude to:
1. Measure centering (L/R, T/B ratios for front and back)
2. Assess condition (corners, edges, surface on 1-10 scale)
3. Extract card info (name, set, number, rarity)
4. Apply each company's specific grading standards
5. Return structured JSON

See `buildStitchedGradingPrompt()` in `api/ai-analyze.js` for full prompt.

---

## Data Storage

### Supabase Schema

```sql
-- User profiles
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id),
  default_company TEXT DEFAULT 'tag',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Card scans
CREATE TABLE scans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now(),

  -- Images
  front_image TEXT,
  back_image TEXT,
  tcgdex_image TEXT,
  tcgdex_id TEXT,
  user_card_image TEXT,

  -- Card data
  card_info JSONB,

  -- AI grading results
  ai_grades JSONB,
  ai_condition JSONB,
  ai_centering JSONB,
  ai_summary JSONB,

  -- Software centering
  centering_data JSONB
);

-- Missing images tracker
CREATE TABLE missing_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tcgdex_id TEXT NOT NULL UNIQUE,
  card_name TEXT,
  set_name TEXT,
  card_number TEXT,
  report_count INTEGER DEFAULT 1,
  last_reported TIMESTAMPTZ DEFAULT now()
);
```

### Save Flow

```javascript
// src/services/scans.js
export async function saveScan({
  frontImage,
  backImage,
  cardInfo,
  aiGrades,
  aiCondition,
  aiCentering,
  aiSummary,
  centeringData,
  tcgdexImage,
  tcgdexId,
  userCardImage,
}) {
  const { data, error } = await supabase
    .from('scans')
    .insert({
      user_id: currentUser.id,
      front_image: frontImage,
      back_image: backImage,
      card_info: cardInfo,
      ai_grades: aiGrades,
      ai_condition: aiCondition,
      ai_centering: aiCentering,
      ai_summary: aiSummary,
      centering_data: centeringData,
      tcgdex_image: tcgdexImage,
      tcgdex_id: tcgdexId,
      user_card_image: userCardImage,
    })
    .select()
    .single();

  return { data, error };
}
```

---

## Key Files Reference

### Frontend Core

| File | Purpose |
|------|---------|
| `src/App.jsx` | Main app component, all tabs, camera handling |
| `src/main.jsx` | React entry point |
| `index.html` | HTML template |
| `vite.config.js` | Vite build configuration |

### Components

| File | Purpose |
|------|---------|
| `src/components/CardIdentifier/CardIdentifier.jsx` | CLIP-based card identification UI |
| `src/components/Collection/CollectionView.jsx` | Collection display with card stack |
| `src/components/CardViewer/CardViewer3D.jsx` | 3D slab viewer |
| `src/components/CornerHandles.jsx` | Corner-anchored centering UI |
| `src/components/Auth/AuthModal.jsx` | Login/register modal |
| `src/components/Export/ExportCard.jsx` | Grade card PNG export |

### Services

| File | Purpose |
|------|---------|
| `src/services/api.js` | Backend API calls (Claude, SAM) |
| `src/services/tcgdex.js` | TCGDex API wrapper |
| `src/services/scans.js` | Supabase database operations |

### Libraries

| File | Purpose |
|------|---------|
| `src/lib/clip-matcher.js` | CLIP embedding & matching |
| `src/lib/card-detector.js` | Card cropping from photo |
| `src/lib/identify-card.js` | Main identification pipeline |
| `src/lib/phash.js` | Perceptual hash (legacy, backup) |
| `src/lib/card-matcher.js` | pHash database matching (legacy) |
| `src/lib/corner-measurement.js` | Corner-anchored centering calculation |

### Utilities

| File | Purpose |
|------|---------|
| `src/utils/gradingScales.js` | Grade scales for all 5 companies |
| `src/hooks/useAuth.js` | Supabase auth hook |

### API Routes (Vercel Serverless)

| File | Purpose |
|------|---------|
| `api/ai-analyze.js` | Claude grading via Replicate |

### Static Assets

| File | Purpose |
|------|---------|
| `public/card-hashes.json` | Card metadata (21,900 cards, 1.94MB) |
| `public/models/clip_embeddings_*.json` | CLIP embeddings (5 chunks, ~215MB total) |

### Scripts

| File | Purpose |
|------|---------|
| `scripts/build-hash-db.cjs` | Build card hash database |
| `scripts/split-embeddings.cjs` | Split embeddings into chunks |

---

## Troubleshooting Guide

### AI Grading Not Working

**Symptoms:** "AI Grade Card" button fails, no grades returned

**Check:**
1. **Vercel Logs:** https://vercel.com/dashboard → Project → Logs
   - Look for errors in `/api/ai-analyze`
2. **Replicate Dashboard:** https://replicate.com/account
   - Check API key is valid
   - Check billing/credits
3. **Environment Variable:** Verify `REPLICATE_API_TOKEN` is set in Vercel

**Common Errors:**
| Error | Cause | Fix |
|-------|-------|-----|
| "Replicate API not configured" | Missing API token | Add `REPLICATE_API_TOKEN` to Vercel env |
| "Function payload too large" | Image too big | Check image resizing in `handleFile()` |
| 429 Rate Limited | Too many requests | Wait and retry (built-in) |
| "No JSON in response" | Claude response format issue | Check prompt in `api/ai-analyze.js` |

---

### Card Identification Not Working

**Symptoms:** Cards not matching, wrong results, no thumbnails

**Check:**
1. **Browser Console:** Look for CLIP loading errors
2. **Network Tab:** Check if embedding chunks load (5 files, ~43MB each)

**Common Errors:**
| Error | Cause | Fix |
|-------|-------|-----|
| "Embeddings not loaded" | Chunk files missing | Verify `public/models/clip_embeddings_*.json` exist |
| No thumbnails | Wrong image URL format | Check series mapping in `clip-matcher.js` |
| Model download fails | Network/CORS issue | Check browser console for fetch errors |
| Wrong card matches | CLIP confidence too low | Lower threshold or add more training data |

**Key Files:**
- `src/lib/clip-matcher.js` - CLIP matching logic
- `src/lib/identify-card.js` - Pipeline orchestration
- `public/models/clip_embeddings_*.json` - Embedding data

---

### Database Not Working

**Symptoms:** Can't save cards, collection empty, auth fails

**Check:**
1. **Supabase Dashboard:** https://supabase.com/dashboard
   - Check project is running
   - Check tables exist
   - Check RLS policies
2. **Environment Variables:**
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`

**Common Errors:**
| Error | Cause | Fix |
|-------|-------|-----|
| "relation does not exist" | Table missing | Run schema SQL |
| "permission denied" | RLS policy issue | Check Supabase RLS settings |
| "invalid JWT" | Bad anon key | Verify env variable |

**Key Files:**
- `src/services/scans.js` - Database operations
- `src/hooks/useAuth.js` - Authentication

---

### Images Not Loading

**Symptoms:** Card images blank, thumbnails missing

**Check:**
1. **TCGDex Status:** https://api.tcgdex.net/v2/en/cards (should return data)
2. **Image URL Format:** Must include series prefix

**Correct URL Format:**
```
https://assets.tcgdex.net/en/{series}/{setId}/{localId}/{quality}.{format}
https://assets.tcgdex.net/en/sv/sv01/001/high.png  ✓
https://assets.tcgdex.net/en/sv01/001/high.png     ✗ (missing series)
```

**Key Files:**
- `src/services/tcgdex.js` - Image URL construction
- `src/lib/clip-matcher.js` - Thumbnail URLs in matches

---

### Centering Calculation Wrong

**Symptoms:** Centering ratios seem off, grades don't match visual

**Check:**
1. **Image Alignment:** Is card straight in image?
2. **Boundary Positions:** Are handles on correct edges?

**Key Files:**
- `src/components/CornerHandles.jsx` - Corner UI
- `src/lib/corner-measurement.js` - Calculation logic

**Debug:**
```javascript
// In console, check centering state
console.log('Centering:', centeringData);
// Should show: { lrRatio: 50, tbRatio: 50 } for perfect centering
```

---

### Vercel Deployment Issues

**Symptoms:** Deploy fails, functions timeout

**Check:**
1. **Vercel Dashboard:** Build logs
2. **File Sizes:** No single file > 100MB

**Limits (Free Tier):**
| Limit | Value |
|-------|-------|
| Function payload | 4.5MB |
| Single file size | 100MB |
| Total deployment | 100MB (upgraded plans: more) |
| Function timeout | 10s (hobby) / 60s (pro) |

**Key Configuration:**
```javascript
// api/ai-analyze.js
export const config = {
  api: { bodyParser: { sizeLimit: '10mb' } },
  maxDuration: 90,  // Requires Pro plan for >10s
};
```

---

## Environment Variables

### Required for Production

```bash
# Vercel Environment Variables

# Replicate (Claude AI)
REPLICATE_API_TOKEN=r8_xxxxxxxxxxxxxxxxxxxx

# Supabase
VITE_SUPABASE_URL=https://xxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJxxxxxxxxxxxxxxx
```

### Optional

```bash
# Backend API (if using Python backend)
VITE_API_URL=http://localhost:8000
```

### Setting in Vercel

1. Go to https://vercel.com/dashboard
2. Select project
3. Settings → Environment Variables
4. Add each variable for Production environment
5. Redeploy for changes to take effect

---

## Quick Reference Commands

```bash
# Local development
npm run dev                    # Start dev server (localhost:5173)

# Build
npm run build                  # Production build

# Deploy
vercel                         # Preview deployment
vercel --prod                  # Production deployment

# Update hash database (new card sets)
node scripts/build-hash-db.cjs --update --save-images

# Split embeddings (if regenerated)
node scripts/split-embeddings.cjs
```

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 0.1.0-beta | Apr 2026 | Initial release with CLIP matching, Claude AI grading |

---

*This document should be updated whenever major changes are made to the system architecture or external service integrations.*
