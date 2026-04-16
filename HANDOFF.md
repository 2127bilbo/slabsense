# SlabSense Development Handoff

**Date:** April 14, 2026
**Status:** Active Development - Beta Phase

---

## Current State Summary

SlabSense is a multi-company card pre-grading application with **Claude AI integration** for accurate grading, **TCGDex** for high-quality card images, and **automated card identification** via pHash + TCGDex API. The app supports PSA, BGS, SGC, CGC, and TAG grading standards.

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
| `src/components/CornerHandles.jsx` | Corner-anchored centering UI + breakdown panel |
| `src/lib/corner-measurement.js` | 5-sample median centering calculation |
| `src/utils/gradingScales.js` | Multi-company grading scales |

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

### Beta Phase (Current)
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
19. [ ] Fine-tune SlabSense slab positioning
20. [ ] Test full flow end-to-end
21. [ ] Bug fixes and polish

### AI Pipeline Migration (Post-Beta)
22. [ ] **Migrate from Replicate to Anthropic direct API** (see SlabSense-AI-Grading-Pipeline.md)
   - Prompt caching for 90% cost reduction on static content
   - Image preprocessing (CLAHE, unsharp mask, edge detection)
   - Defect annotation rendering with coordinates
   - Remove Replicate dependency
23. [ ] Defect feedback capture system (optional, UX TBD with Bob)

### Launch Phase
24. [ ] **Billing & Subscriptions** (see SlabSense-Billing-Tokens-Subscriptions.md)
   - Token-based billing (Standard vs Express grades)
   - Stripe + PayPal integration
   - Subscription tiers (Free / Pro / Lifetime)
25. [ ] Production deployment
26. [ ] Privacy policy & Terms of Service updates
27. [ ] Landing page / marketing site
28. [ ] **Automated embedding updates** - Serverless job to generate CLIP embeddings for new TCGDex cards

### Post-Launch / Mobile App
29. [ ] **Mobile app decision: Capacitor vs React Native**
   - Capacitor: Wrap existing code, faster launch
   - React Native: Better native feel, more work
30. [ ] Apple Developer Account ($99/year)
31. [ ] iOS app build and submission
32. [ ] TestFlight beta testing
33. [ ] App Store launch
34. [ ] Google Play (Android) - same codebase

### Future Enhancements
35. [ ] Custom ML model for card recognition (using saved images)
36. [ ] Sports cards support (baseball, basketball, etc.)
37. [ ] Price tracking history & trends
38. [ ] Social features (share collections)
39. [ ] Bulk grading mode
40. [ ] Hardware integration (3D printed mount, LED lighting system)
41. [ ] **Upgrade Vercel plan** - Higher payload limits allow larger images for better AI grading accuracy
   - Current: Free tier (4.5MB function payload limit, 100MB deployment size)
   - Pro tier: 50MB payload limit, 1GB deployment size
   - Would enable higher resolution card images for detecting fine defects

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

Detailed implementation specs and technical guides:

| File | Purpose |
|------|---------|
| `docs/TECHNICAL_REFERENCE.md` | **Complete system architecture, troubleshooting guide, all features explained** |
| `SlabSense-Corner-Anchored-Centering-Mode.md` | Beta toggle for 8-corner centering with 5-sample median per edge |
| `SlabSense-AI-Grading-Pipeline.md` | Anthropic direct API migration, image preprocessing, defect annotations |
| `SlabSense-Billing-Tokens-Subscriptions.md` | Token-based billing, Stripe/PayPal integration, subscription tiers |
| `docs/grading-research/` | Grading standards and defect weights for all 5 companies |

---

*Last Updated: April 16, 2026*
