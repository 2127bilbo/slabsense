# SlabSense v0.2.0-beta

**AI-Powered Multi-Company Card Pre-Grading Tool**

Analyze your trading cards against multiple professional grading standards including PSA, BGS, CGC, SGC, and TAG using **Claude AI** for accurate grading.

> **DISCLAIMER**: SlabSense is NOT affiliated with any professional grading company. All grades are estimates only. See [docs/DISCLAIMERS.md](docs/DISCLAIMERS.md) for full details.

## Features

### Card Identification (OCR + TCGDex)
- **Automatic Detection** — Upload a photo, OCR reads the card name
- **TCGDex Integration** — Free API provides card data + high-quality images
- **Smart Search** — Matches OCR results to database with scoring
- **Manual Fallback** — Search by name if OCR fails
- **Perfect Slab Images** — TCGDex provides borderless card images for 3D view

### AI Grading (Claude Sonnet 4)
- **Multi-Company Grades** — Get PSA, BGS, SGC, CGC, and TAG grades in ONE API call
- **Card Recognition** — Automatically extracts name, set, number, rarity, year
- **Centering Measurement** — L/R and T/B ratios for front and back
- **Condition Assessment** — Corners, edges, surface scores with defect notes
- **Detailed Summary** — Positives, concerns, and grading recommendation
- **Subgrades** — BGS 4 subgrades, TAG 8 subgrades when selected

### 3D Card View (SAM 2)
- **Clean Card Cropping** — AI-powered perspective correction
- **Rotating Slab Preview** — See your card in a realistic slab
- **Separate from Grading** — Avoids rate limits, user controls timing

### Collection
- **Visual Card Stack** — Swipe through your collection with actual card images
- **Full Detail Modal** — Tap any card for complete AI report
- **Company Switching** — Toggle between grading company views
- **AI vs Software Toggle** — Compare AI grade to client-side grade
- **TCGDex Images** — High-quality card art from database

### Centering Tools
- **Rotation Controls** — 1° and 0.05° fine-tune adjustments
- **Manual Border Adjustment** — Drag handles for precise alignment
- **Confirm Before Score** — No grade until you verify alignment

## Supported Grading Companies

| Company | Scale | Subgrades | AI Supported |
|---------|-------|-----------|--------------|
| TAG | 1000-point → 1-10 | Yes (8) | ✅ |
| PSA | 1-10 | No | ✅ |
| BGS | 1-10 | Yes (4) | ✅ |
| CGC | 1-10 | Yes (4) | ✅ |
| SGC | 1-10 | No | ✅ |

## Quick Start

### 1. Clone and Install
```bash
git clone https://github.com/yourusername/slabsense.git
cd slabsense
npm install
```

### 2. Set Environment Variables
Create `.env.local`:
```
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
REPLICATE_API_TOKEN=your_replicate_token
```

### 3. Run Development Server
```bash
npm run dev
# Opens at http://localhost:5173
```

### 4. Deploy to Vercel
```bash
vercel --prod
```

## Cost Per Card

| Feature | Cost | API |
|---------|------|-----|
| Card ID | FREE | TCGDex (browser OCR) |
| AI Grade | ~$0.03 | Claude Sonnet 4 |
| 3D View | ~$0.02 | SAM 2 |
| **Total** | **~$0.05** | |

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Frontend (React/Vite)                                      │
│  - Camera capture & viewfinder                              │
│  - AI grading UI with multi-company display                 │
│  - Collection card stack                                    │
│  - Centering with rotation controls                         │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  API Routes (Vercel Serverless)                             │
│  - /api/ai-analyze → Claude Sonnet 4 (Replicate)            │
│  - /api/detect-card → SAM 2 (Replicate)                     │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  Database (Supabase)                                        │
│  - User authentication                                      │
│  - Scan collection with AI data                             │
│  - Profiles & memberships                                   │
└─────────────────────────────────────────────────────────────┘
```

## Project Structure

```
SlabSense/
├── src/
│   ├── components/
│   │   ├── Auth/              # Login, Register
│   │   ├── CardIdentifier/    # OCR + TCGDex lookup
│   │   ├── Collection/        # Card stack view
│   │   ├── CardViewer/        # 3D slab viewer
│   │   └── Export/            # Grade card export
│   ├── services/
│   │   ├── api.js             # AI grading & SAM functions
│   │   ├── auth.js            # Supabase auth
│   │   ├── ocr.js             # Tesseract.js card reading
│   │   ├── tcgdex.js          # TCGDex API wrapper
│   │   └── scans.js           # Save/load with AI data
│   ├── utils/
│   │   └── gradingScales.js   # Multi-company scales
│   └── App.jsx                # Main application
├── api/
│   ├── ai-analyze.js          # Claude grading endpoint
│   └── detect-card.js         # SAM cropping endpoint
├── docs/
│   └── grading-research/      # Company standards
├── HANDOFF.md                 # Development state
└── README.md
```

## Key Functions

### Card Identification
```javascript
import { extractCardInfo } from './services/ocr.js';
import { smartSearch, getFullCardData } from './services/tcgdex.js';

// 1. OCR extracts card name
const ocr = await extractCardInfo(cardImage);
// Returns: { name, confidence, rawText }

// 2. Search TCGDex
const results = await smartSearch(ocr);
// Returns: [{ id, name, set, image, matchScore }, ...]

// 3. Get full card data
const card = await getFullCardData(cardId);
// Returns: { name, set, rarity, imageHigh, ... }
```

### AI Grading
```javascript
import { claudeGradingAnalysis } from './services/api.js';

const result = await claudeGradingAnalysis(frontImage, backImage, 'pokemon');
// Returns: { cardInfo, centering, condition, grades, summary }
```

### 3D Cropping
```javascript
import { samCardCropping } from './services/api.js';

const result = await samCardCropping(frontImage, backImage);
// Returns: { croppedFront, croppedBack }
```

## Development Status

| Feature | Status |
|---------|--------|
| Card Identification (OCR) | ⚠️ Testing |
| TCGDex Integration | ✅ Complete |
| Claude AI Grading | ✅ Complete |
| SAM 2 3D View | ✅ Complete |
| Collection Card Stack | ✅ Complete |
| Centering Rotation | ✅ Complete |
| Multi-Company Display | ✅ Complete |
| Stripe Payments | 🔄 Planned |

## License

MIT

## Contributing

See [HANDOFF.md](HANDOFF.md) for current development state and next steps.
