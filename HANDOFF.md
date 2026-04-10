# SlabSense Development Handoff

**Date:** April 9, 2026
**Status:** Active Development - AI Integration Complete

---

## Current State Summary

SlabSense is a multi-company card pre-grading application with **Claude AI integration** for accurate grading and **SAM 2** for 3D card cropping. The app supports PSA, BGS, SGC, CGC, and TAG grading standards.

---

## What's Working

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

### Collection View (NEW)
- ✅ Card stack visual with swipe navigation
- ✅ Click card to open full detail modal
- ✅ AI grade vs Software grade toggle (if both exist)
- ✅ Company tabs to switch grade display (PSA/BGS/SGC/CGC/TAG)
- ✅ Shows centering, condition, subgrades, summary
- ✅ Saves AI data with card (grades, condition, summary, centering)

### Centering Tab (UPDATED)
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
- ✅ Now saves AI grading data:
  - `ai_grades` - Multi-company grades object
  - `ai_condition` - Condition scores
  - `ai_summary` - Positives/concerns/recommendation
  - `ai_centering` - Claude's centering measurements
  - `card_info` - OCR-extracted card details

---

## API Flow

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

### Frontend
| File | Purpose |
|------|---------|
| `src/App.jsx` | Main app, grading UI, centering tab with rotation |
| `src/services/api.js` | `claudeGradingAnalysis()`, `samCardCropping()` |
| `src/services/scans.js` | Saves AI data with cards |
| `src/components/Collection/CollectionView.jsx` | Card stack, detail modal |
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

## Replicate Rate Limits

With < $5 credit: **1 burst request limit** (causes 429 errors)

**Solution implemented:** Separate AI Grade and 3D View into independent buttons. User controls timing between API calls.

---

## Database Schema Updates Needed

The `scans` table needs these new columns (add via Supabase dashboard):

```sql
ALTER TABLE scans ADD COLUMN IF NOT EXISTS ai_grades JSONB;
ALTER TABLE scans ADD COLUMN IF NOT EXISTS ai_condition JSONB;
ALTER TABLE scans ADD COLUMN IF NOT EXISTS ai_summary JSONB;
ALTER TABLE scans ADD COLUMN IF NOT EXISTS ai_centering JSONB;
ALTER TABLE scans ADD COLUMN IF NOT EXISTS card_info JSONB;
```

---

## Next Steps

1. ✅ ~~AI grading integration~~ - DONE
2. ✅ ~~3D view separation~~ - DONE
3. ✅ ~~Collection card stack~~ - DONE
4. ✅ ~~Centering rotation controls~~ - DONE
5. ✅ ~~UI consolidation~~ - DONE (unified tab bar, Grade/Dings tabs merged)
6. [ ] **Fine-tune SlabSense slab positioning** - Card window & text coordinates in SlabSenseSlab.jsx
7. [ ] Deploy database schema updates
8. [ ] Test full flow end-to-end
9. [ ] Stripe payments for Pro tier
10. [ ] Production deployment

---

## Test the App

```bash
# Frontend
cd "G:\Grading App\SlabSense"
npm run dev
# Opens at http://localhost:5173

# Deploy to Vercel
vercel --prod
```

---

*Last Updated: April 9, 2026*
