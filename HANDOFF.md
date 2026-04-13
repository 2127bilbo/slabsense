# SlabSense Development Handoff

**Date:** April 12, 2026
**Status:** Active Development - Card Identification In Progress

---

## Current State Summary

SlabSense is a multi-company card pre-grading application with **Claude AI integration** for accurate grading, **SAM 2** for 3D card cropping, and **automated card identification** via OCR + TCGDex API. The app supports PSA, BGS, SGC, CGC, and TAG grading standards.

---

## What's Working

### Card Identification (NEW - In Testing)
- ✅ OCR extracts card name from photos using Tesseract.js
- ✅ Variance-based card detection crops card from background
- ✅ Otsu's thresholding for better text/background separation
- ✅ TCGDex API integration for card data + high-quality images
- ✅ Manual search fallback when OCR confidence < 40%
- ✅ Card images from TCGDex used for slabs (perfect quality)
- ✅ Collection view shows card images instead of text placeholders
- ⚠️ **Testing needed** - OCR may struggle with holofoil cards

### AI Grading (Claude via Replicate)
- ✅ Claude Sonnet 4 analyzes card images via Replicate API
- ✅ Returns grades for ALL 5 companies in one API call (~$0.03)
- ✅ Extracts card info (name, set, number, rarity, year)
- ✅ Measures centering (L/R, T/B ratios for front and back)
- ✅ Condition assessment (corners, edges, surface scores)
- ✅ Summary with positives, concerns, and recommendation
- ✅ BGS 4 subgrades displayed when BGS selected
- ✅ TAG 8 subgrades (front/back for each category)

### 3D Card View (SAM 2 via Replicate)
- ✅ SAM 2 crops cards for clean 3D display (~$0.02)
- ✅ **Separate button** from AI grading (avoids rate limits)
- ✅ Falls back to original images if SAM fails
- ✅ 3D rotating slab view with realistic render

### Collection View
- ✅ Card stack visual with swipe navigation
- ✅ **Shows actual card images** from TCGDex (not text placeholders)
- ✅ Click card to open full detail modal
- ✅ AI grade vs Software grade toggle (if both exist)
- ✅ Company tabs to switch grade display (PSA/BGS/SGC/CGC/TAG)
- ✅ Shows centering, condition, subgrades, summary
- ✅ Saves AI data with card (grades, condition, summary, centering)

### Centering Tab
- ✅ Two-step alignment flow inside ManualBoundaryEditor:
  - Step 1: Straighten Card — rotation controls (1° and 0.05° increments)
  - Step 2: Adjust Borders — drag handles for edge/artwork boundaries
- ✅ Crosshair overlay for visual alignment guidance
- ✅ "Confirm Alignment" button required before showing score
- ✅ Centering results only shown after confirmation

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

## Card Identification Flow

```
User uploads/captures card image
  → Card cropped from background (variance detection)
  → Name region extracted (top 10% of card)
  → Preprocessing: contrast stretch + Otsu's threshold + 2x upscale
  → OCR reads card name

If confidence >= 40%:
  → TCGDex smart search (name matching + scoring)
  → User confirms correct card from results
  → Full card data + high-quality image loaded

If confidence < 40%:
  → Manual search UI shown
  → OCR result pre-filled for user to correct
  → User types card name → TCGDex search

Result:
  → Card info populated
  → TCGDex image used for slab (perfect quality)
  → Data saved with scan
```

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

### 3D View Button (~$0.02)
```
User clicks "3D Slab View"
  → samCardCropping(front, back)
  → Sends to /api/detect-card (SAM 2)
  → Returns: croppedFront, croppedBack
  → Opens 3D viewer
```

**Key:** These are SEPARATE buttons to avoid Replicate rate limits.

---

## Key Files

### Card Identification (NEW)
| File | Purpose |
|------|---------|
| `src/services/ocr.js` | Tesseract.js OCR with preprocessing |
| `src/services/tcgdex.js` | TCGDex API wrapper |
| `src/components/CardIdentifier/CardIdentifier.jsx` | Identification UI flow |

### Frontend
| File | Purpose |
|------|---------|
| `src/App.jsx` | Main app, grading UI, card identifier integration |
| `src/services/api.js` | `claudeGradingAnalysis()`, `samCardCropping()` |
| `src/services/scans.js` | Saves AI data + TCGDex data with cards |
| `src/components/Collection/CollectionView.jsx` | Card stack with images |
| `src/utils/gradingScales.js` | Multi-company grading scales |

### API Routes (Vercel)
| File | Purpose |
|------|---------|
| `api/ai-analyze.js` | Claude grading via Replicate |
| `api/detect-card.js` | SAM 2 card detection via Replicate |

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
```

---

## OCR Technical Details

### Preprocessing Pipeline
1. **Card Detection** - Grid-based variance analysis finds card bounds
2. **Cropping** - Removes background, isolates card
3. **Region Extraction** - Top 10% of card (name area)
4. **Contrast Stretching** - Normalizes lighting conditions
5. **Otsu's Thresholding** - Optimal text/background separation
6. **2x Upscaling** - More pixels for better OCR accuracy

### Known Limitations
- Holofoil patterns can confuse OCR (rainbow reflections)
- Dark/textured backgrounds on some cards
- Non-standard fonts on special cards
- **Fallback:** Manual search with pre-filled OCR result

---

## Next Steps

1. ✅ ~~AI grading integration~~ - DONE
2. ✅ ~~3D view separation~~ - DONE
3. ✅ ~~Collection card stack~~ - DONE
4. ✅ ~~Centering rotation controls~~ - DONE
5. ✅ ~~UI consolidation~~ - DONE
6. ✅ ~~Card identification (OCR + TCGDex)~~ - IMPLEMENTED
7. ⚠️ **Test OCR with various card types** - IN PROGRESS
8. [ ] Fine-tune SlabSense slab positioning
9. [ ] Deploy database schema updates
10. [ ] Test full flow end-to-end
11. [ ] Stripe payments for Pro tier
12. [ ] Production deployment

---

## Test the App

```bash
# Frontend
cd "G:\Grading App\SlabSense"
npm run dev
# Opens at http://localhost:5173

# Test card identification:
# 1. Upload a card image (front)
# 2. CardIdentifier modal appears automatically
# 3. Watch OCR progress
# 4. If OCR works: select matching card from results
# 5. If OCR fails: use manual search (pre-filled with OCR result)
# 6. Card data + high-quality image loaded

# Deploy to Vercel
vercel --prod
```

---

## Troubleshooting

### OCR Reading Garbage
- Check console for OCR confidence %
- If < 40%, falls back to manual search automatically
- Pre-filled text can be corrected by user
- Try cards with clearer text (non-holofoil)

### Card Not Cropping Properly
- Variance detection needs contrast between card and background
- Use plain background (not busy patterns)
- Ensure good lighting

### TCGDex Search No Results
- Check card name spelling
- Try partial name (e.g., "Pikachu" not "Pikachu EX")
- TCGDex only has Pokemon cards (not other TCGs)

---

*Last Updated: April 12, 2026*
