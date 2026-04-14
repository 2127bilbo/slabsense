# SlabSense Development Handoff

**Date:** April 14, 2026
**Status:** Active Development - Beta Phase

---

## Current State Summary

SlabSense is a multi-company card pre-grading application with **Claude AI integration** for accurate grading, **SAM 2** for 3D card cropping, and **automated card identification** via pHash + TCGDex API. The app supports PSA, BGS, SGC, CGC, and TAG grading standards.

---

## What's Working

### Card Identification (pHash Pipeline)
- ✅ pHash visual matching (~30ms per card)
- ✅ Hash database: 21,900 cards, 1.94MB
- ✅ Variance-based card detection crops card from background
- ✅ TCGDex API integration for card data + high-quality images
- ✅ Manual search fallback for low-confidence matches
- ✅ Card images from TCGDex used for slabs (perfect quality)
- ✅ Collection view shows card images instead of text placeholders
- ✅ Incremental updates (`--update` flag) for new set releases

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

### Centering Tab
- ✅ Two-step alignment flow inside ManualBoundaryEditor:
  - Step 1: Straighten Card — rotation controls (1° and 0.05° increments) + 3-axis perspective
  - Step 2: Adjust Borders — drag handles for edge/artwork boundaries
- ✅ Crosshair overlay for visual alignment guidance
- ✅ "Confirm Alignment" button required before showing score
- ✅ Centering results only shown after confirmation
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

## Card Identification Flow (pHash)

```
User uploads/captures card image
  → Card cropped from background (variance detection)
  → pHash computed on card image (~30ms)
  → Hamming distance search against hash database (21,900 cards)

If distance <= 8 (high confidence):
  → Auto-accept match
  → Full card data + high-quality image loaded from TCGDex

If distance 9-15 (medium confidence):
  → Show top 3 candidates for user to confirm
  → User taps correct card

If distance > 15 (low confidence):
  → Manual search UI shown
  → User types card name → TCGDex search

Result:
  → Card info populated
  → TCGDex image used for slab (perfect quality)
  → Data saved with scan
```

**Hash Database:**
- Location: `public/card-hashes.json` (~1.94MB)
- Build script: `node scripts/build-hash-db.cjs --save-images`
- Update script: `node scripts/build-hash-db.cjs --update --save-images` (new sets only)

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

### Card Identification (pHash)
| File | Purpose |
|------|---------|
| `src/lib/phash.js` | pHash compute + Hamming distance |
| `src/lib/card-matcher.js` | Hash database loader + matching |
| `src/services/tcgdex.js` | TCGDex API wrapper |
| `src/components/CardIdentifier/CardIdentifier.jsx` | Identification UI flow |
| `scripts/build-hash-db.cjs` | Hash database builder (dev-only) |
| `public/card-hashes.json` | Hash database (shipped asset) |

### Frontend
| File | Purpose |
|------|---------|
| `src/App.jsx` | Main app, grading UI, card identifier integration |
| `src/services/api.js` | `claudeGradingAnalysis()`, `samCardCropping()` |
| `src/services/scans.js` | Saves AI data + TCGDex data with cards |
| `src/components/Collection/CollectionView.jsx` | Card stack with images |
| `src/components/CornerHandles.jsx` | Corner-anchored centering UI + breakdown panel |
| `src/lib/corner-measurement.js` | 5-sample median centering calculation |
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

## pHash Technical Details

### How It Works
1. **Card Detection** - Grid-based variance analysis finds card bounds
2. **Cropping** - Removes background, isolates card
3. **pHash Compute** - Draw to 32×32 grayscale, DCT, median threshold → 64-bit hash
4. **Hamming Search** - XOR query hash against database, popcount for distance
5. **Confidence** - Distance ≤8: high, 9-15: medium, >15: low

### Performance Targets
- pHash compute: <30ms
- Match search (21k cards): <20ms
- TCGDex API call: 200-500ms (cached after)

### Known Considerations
- **Foil/holo cards** may hash with higher distance (test threshold)
- **Reprints with identical art** return multiple matches (user picks)
- **Cards newer than hash DB** need `--update` run

---

## Next Steps

### Completed
1. ✅ AI grading integration (Claude via Replicate)
2. ✅ 3D slab view (SAM 2 via Replicate)
3. ✅ Collection card stack with images
4. ✅ Centering rotation controls + 3-axis perspective (Pitch/Roll/Rotate)
5. ✅ UI consolidation
6. ✅ Card identification (pHash + TCGDex)
7. ✅ TCGDex search fix (server-side filtering)
8. ✅ pHash visual matching pipeline
9. ✅ **Card pricing** - TCGDex Cardmarket values on home/collection/grade
10. ✅ **Incremental hash updates** - `--update` flag for new sets only
11. ✅ **Hash database built** - 21,900 cards, 18GB images, 1.94MB hash DB

### Beta Phase (Current)
12. ✅ **Corner-anchored centering mode** - Toggle alternative to edge-drag with 5-sample median per edge
13. [ ] Test pHash matching with various card types
14. [ ] Fine-tune SlabSense slab positioning
15. [ ] Deploy database schema updates
16. [ ] Test full flow end-to-end
17. [ ] Bug fixes and polish

### AI Pipeline Migration (Post-Beta)
18. [ ] **Migrate from Replicate to Anthropic direct API** (see SlabSense-AI-Grading-Pipeline.md)
   - Prompt caching for 90% cost reduction on static content
   - Image preprocessing (CLAHE, unsharp mask, edge detection)
   - Defect annotation rendering with coordinates
   - Remove Replicate dependency
19. [ ] Defect feedback capture system (optional, UX TBD with Bob)

### Launch Phase
20. [ ] **Billing & Subscriptions** (see SlabSense-Billing-Tokens-Subscriptions.md)
   - Token-based billing (Standard vs Express grades)
   - Stripe + PayPal integration
   - Subscription tiers (Free / Pro / Lifetime)
21. [ ] Production deployment
22. [ ] Privacy policy & Terms of Service updates
23. [ ] Landing page / marketing site
24. [ ] **Automated hash DB updates** - Serverless job to sync new TCGDex cards

### Post-Launch / Mobile App
25. [ ] **Mobile app decision: Capacitor vs React Native**
   - Capacitor: Wrap existing code, faster launch
   - React Native: Better native feel, more work
26. [ ] Apple Developer Account ($99/year)
27. [ ] iOS app build and submission
28. [ ] TestFlight beta testing
29. [ ] App Store launch
30. [ ] Google Play (Android) - same codebase

### Future Enhancements
31. [ ] Custom ML model for card recognition (using saved images)
32. [ ] Sports cards support (baseball, basketball, etc.)
33. [ ] Price tracking history & trends
34. [ ] Social features (share collections)
35. [ ] Bulk grading mode
36. [ ] Hardware integration (3D printed mount, LED lighting system)

---

## Test the App

```bash
# Frontend
cd "G:\Grading App\SlabSense"
npm run dev
# Opens at http://localhost:5173

# Test card identification (pHash):
# 1. Upload a card image (front)
# 2. CardIdentifier computes visual hash (~50ms)
# 3. Searches hash database for matches
# 4. High confidence → auto-selects card
# 5. Medium confidence → shows candidates to pick
# 6. Low/error → falls back to manual name search
# 7. Card data + high-quality image loaded from TCGDex

# Build hash database (required for pHash):
node scripts/build-hash-db.cjs --save-images

# Update hash database (new sets only, ~5-15 min):
node scripts/build-hash-db.cjs --update --save-images

# Deploy to Vercel
vercel --prod
```

---

## Troubleshooting

### pHash Not Matching Cards
- Distance > 15 indicates low confidence match
- Holo/foil cards may have higher distances (test threshold 10 vs 8)
- Card must be in hash database (run `--update` for new sets)
- Falls back to manual search automatically

### Card Not Cropping Properly
- Variance detection needs contrast between card and background
- Use plain background (not busy patterns)
- Ensure good lighting

### TCGDex Search No Results
- Check card name spelling
- Try partial name (e.g., "Pikachu" not "Pikachu EX")
- TCGDex only has Pokemon cards (not other TCGs)

### Hash Database Updates
- Run `node scripts/build-hash-db.cjs --update --save-images` for new sets
- Full rebuild: `node scripts/build-hash-db.cjs --save-images` (~6 hours)

---

---

## Reference Documentation

Detailed implementation specs for upcoming features (keep these files):

| File | Purpose |
|------|---------|
| `SlabSense-Corner-Anchored-Centering-Mode.md` | Beta toggle for 8-corner centering with 5-sample median per edge |
| `SlabSense-AI-Grading-Pipeline.md` | Anthropic direct API migration, image preprocessing, defect annotations |
| `SlabSense-Billing-Tokens-Subscriptions.md` | Token-based billing, Stripe/PayPal integration, subscription tiers |
| `docs/grading-research/` | Grading standards and defect weights for all 5 companies |

---

*Last Updated: April 14, 2026*
