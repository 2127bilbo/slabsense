# SlabSense - Development Gameplan

## Project Overview
**SlabSense** - A pre-grading card analysis tool supporting multiple grading companies (TAG, PSA, BGS, CGC, SGC). Provides grade estimates based on centering, corners, edges, and surface analysis.

### Tech Stack
- **Frontend**: React (Vite) - Mobile browser first
- **Backend**: Python + OpenCV + FastAPI (centering/defect API)
- **Database**: Supabase (Postgres + Auth + Storage)
- **Hosting**: Vercel (frontend) + Local Dev → Fly.io (backend)
- **Payments**: Stripe
- **Queue**: Redis + Celery (job processing)

---

## Pricing & Tier Structure

### Philosophy
**Be transparent. Don't double-dip.** Users know exactly what they pay for.

### Tier Comparison

| Feature | Free | Pro ($15/mo) | Beta Lifetime ($99) |
|---------|------|--------------|---------------------|
| Client-side grading | ✓ | ✓ | ✓ |
| **Grade number only** | ✓ | — | — |
| **Full DINGS report** | ✗ | ✓ | ��� |
| **Defect explanations** | ✗ | ✓ | ✓ |
| **Subgrade breakdown** | ✗ | ✓ | ✓ |
| Backend AI grading | ✗ | ✓ | ✓ |
| Perspective correction | ✗ | ✓ | ✓ |
| OCR (card name/set) | ✗ | ✓ | ✓ |
| Save to collection | 5 scans | Unlimited | Unlimited |
| Export grade cards | Watermark | Full quality | Full quality |
| Queue time (backend) | N/A | 30s-2min | 30s-2min |
| Express credits | ✗ | Can purchase | 50 included |

### Free Tier Limitations
- **Shows**: Grade number (e.g., "PSA 9") and label (e.g., "MINT")
- **Hidden**:
  - Detailed DINGS list (what defects were found)
  - Why each DING was flagged (descriptions)
  - Subgrade scores (centering, corners, edges, surface)
  - Centering ratios (50/50, 55/45, etc.)
  - Defect location overlays
- **Message**: "Upgrade to Pro to see full report with DINGS breakdown"
- **Collection**: Limited to 5 saved scans

### Pro Tier ($15/month)
- Full detailed reports with all DINGS explanations
- Backend AI processing (better accuracy)
- Perspective correction (flatten angled cards)
- OCR for automatic card name/set detection
- Unlimited saves to collection
- Standard queue: 30 seconds - 2 minutes
- Can purchase express credits

### Beta Lifetime ($99 one-time)
- Everything in Pro, forever
- 50 express credits included
- Early supporter badge
- Input on future features
- **Limited availability**: First 100 users only

### Express Credits (Pro users only)
Skip the queue for instant backend processing.

| Credits | Price | Per Grade |
|---------|-------|-----------|
| 10 | $5 | $0.50 |
| 25 | $10 | $0.40 |
| 50 | $15 | $0.30 |
| 100 | $25 | $0.25 |

- 1 credit = 1 express grade
- Credits never expire
- Only available to Pro/Lifetime subscribers

---

## Phase 1: Foundation (Copy & Rebrand)
> Status: COMPLETE

- [x] Copy current TAG Pre-Grader to new folder
- [x] Rename folder to SlabSense
- [x] Create folder structure
- [x] Update package.json with new name
- [x] Rebrand App.jsx (remove TAG references, add SlabSense branding)
- [x] Add grading company selector dropdown
- [x] Implement multiple grading scales (TAG, PSA, BGS, CGC, SGC)
- [x] Create grading scales configuration file (src/utils/gradingScales.js)
- [x] Add disclaimer modal/page
- [x] Add Terms of Service page (docs/TERMS_OF_SERVICE.md)
- [x] Add Privacy Policy page (docs/PRIVACY_POLICY.md)
- [x] Update README.md
- [x] Update index.html with new branding
- [x] Deploy to new Vercel project (GitHub → Vercel auto-deploy)
- [x] Wire grading company selection to grade calculation
  - computeGrade() now accepts companyId parameter
  - Uses company-specific centering thresholds
  - Grade display shows selected company name
  - Centering tab shows company-specific thresholds
  - Grade recalculates when company changes

---

## Phase 2: Backend & Auth
> Status: MOSTLY COMPLETE

### Supabase Setup
- [x] Create Supabase project
- [x] Set up database schema (profiles, scans, memberships)
- [x] Configure auth providers (email)
- [ ] Configure auth providers (Google OAuth) — optional
- [ ] Set up storage buckets for card images — future (for storing scan images)
- [x] Create Row Level Security (RLS) policies

### Auth Integration
- [x] Create Login component (AuthModal.jsx)
- [x] Create Register component (AuthModal.jsx - handles both)
- [ ] Create Profile/Settings component
- [x] Add auth hook (useAuth.js)
- [x] Protect collection view (only shows when logged in)
- [x] Add logout functionality (UserMenu.jsx)
- [x] "Save to Collection" button in overview tab

### Python Centering API

#### Stage 1: Local Development (Your PC)
- [ ] Set up Python project structure
- [ ] Install dependencies (OpenCV, FastAPI, Tesseract)
- [ ] Implement perspective correction (warp/deskew)
- [ ] Implement border detection
- [ ] Implement centering calculation
- [ ] Add Tesseract OCR for card name/set
- [ ] Create FastAPI endpoints
- [ ] Test with real card images
- [ ] Add "Use local backend" toggle in frontend settings
- [ ] Use ngrok to expose local server for testing

#### Stage 2: Production (Fly.io)
- [ ] Dockerize Python app
- [ ] Deploy to Fly.io
- [ ] Set up Redis for queue management
- [ ] Implement Celery workers for job processing
- [ ] Add auth middleware (verify Pro subscription via Supabase)
- [ ] Implement express priority queue
- [ ] Add WebSocket or polling for real-time status updates
- [ ] Load testing and monitoring
- [ ] Auto-scaling configuration

### Backend Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  STAGE 1: LOCAL DEVELOPMENT                                 │
│                                                             │
│  Your PC                                                    │
│  ┌─────────────┐    ┌─────────────────────────────────────┐ │
│  │ FastAPI     │    │ Python Processing                   │ │
│  │ localhost:  │───▶│ - OpenCV perspective transform      │ │
│  │ 8000        │    │ - Border detection                  │ │
│  └─────────────┘    │ - Centering calculation             │ │
│        ▲            │ - Tesseract OCR                     │ │
│        │            └─────────────────────────────────────┘ │
│   ngrok tunnel                                              │
│        │                                                    │
└────────│────────────────────────────────────────────────────┘
         │
    HTTPS Request
         │
┌────────│────────────────────────────────────────────────────┐
│  Frontend (Vercel)                                          │
│  - Toggle: "Use backend grading" in settings                │
│  - Sends image to backend API                               │
│  - Displays enhanced results                                │
└─────────────────────────────────────────────────────────────┘
```

```
┌─────────────────────────────────────────────────────────────┐
│  STAGE 2: PRODUCTION (Fly.io)                               │
│                                                             │
│  ┌─────────────┐    ┌─────────────────────────────────────┐ │
│  │ FastAPI     │    │ Celery Workers (scalable)           │ │
│  │ api.slab    │───▶│ - Process jobs from queue           │ │
│  │ sense.app   │    │ - Auto-scale based on load          │ │
│  └─────────────┘    └─────────────────────────────────────┘ │
│        │                        │                           │
│        │                        ▼                           │
│        │            ┌─────────────────────────────────────┐ │
│        │            │ Redis Queue                         │ │
│        │            │ - Standard queue (FIFO)             │ │
│        │            │ - Express queue (priority)          │ │
│        │            └─────────────────────────────────────┘ │
│        │                                                    │
│        ▼                                                    │
│  ┌─────────────────────────────────────────────────────────┐│
│  │ Auth Middleware                                         ││
│  │ - Verify JWT from Supabase                              ││
│  │ - Check tier (reject free users)                        ││
│  │ - Deduct express credits if used                        ││
│  └─────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
```

### Queue System

#### How It Works
1. User submits card image
2. Auth middleware verifies Pro/Lifetime subscription
3. If express credit used → Priority Queue (next in line)
4. Otherwise → Standard Queue (FIFO)
5. Worker picks up job, processes image
6. Results returned via WebSocket or polling
7. Frontend displays enhanced results

#### Estimated Wait Times
| Queue | Typical Wait |
|-------|--------------|
| Express | 5-15 seconds |
| Standard (low traffic) | 30 seconds |
| Standard (busy) | 1-2 minutes |
| Max wait | 5 minutes (auto-scale) |

### Backend Costs (Estimated)
| Service | Cost |
|---------|------|
| Fly.io (small instance) | $5-10/month |
| Fly.io (scaled) | $20-50/month |
| Redis (Fly.io) | $5/month |
| Google Vision API (optional) | ~$1.50/1000 images |

### Database Schema Updates Needed

```sql
-- Add express credits to profiles
ALTER TABLE profiles ADD COLUMN express_credits INTEGER DEFAULT 0;

-- Add stripe customer ID for subscription management
ALTER TABLE profiles ADD COLUMN stripe_customer_id TEXT;

-- Update tier check constraint
ALTER TABLE profiles DROP CONSTRAINT profiles_tier_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_tier_check
  CHECK (tier IN ('free', 'pro_monthly', 'beta_lifetime'));

-- Add backend processing fields to scans
ALTER TABLE scans ADD COLUMN processing_method TEXT DEFAULT 'client'
  CHECK (processing_method IN ('client', 'backend'));
ALTER TABLE scans ADD COLUMN backend_version TEXT; -- e.g., "1.0.0"
```

---

## Phase 3: User Features
> Status: COMPLETE (except deferred items)

- [x] Save scans to user account
- [x] View scan history/collection (CollectionView.jsx)
- [x] Delete scans from collection
- [x] Export results (PNG download, text copy) — ExportCard.jsx
- [x] Profile settings (display name) — ProfileSettings.jsx
- [x] Default grading company preference (save to profile, loads on app start)
- [x] Delete account functionality (with DELETE confirmation)

### Deferred to Backend Phase
- [ ] Card identification (OCR: name, set number) — will be part of Python backend
- [ ] Card database integration (TCGPlayer API) — after OCR working

---

## Phase 4: Pro Features & Payments
> Status: NOT STARTED

### Stripe Products to Create

| Product | Type | Price ID | Price |
|---------|------|----------|-------|
| SlabSense Pro | Subscription | `price_pro_monthly` | $15/month |
| Beta Lifetime | One-time | `price_beta_lifetime` | $99 |
| 10 Express Credits | One-time | `price_credits_10` | $5 |
| 25 Express Credits | One-time | `price_credits_25` | $10 |
| 50 Express Credits | One-time | `price_credits_50` | $15 |
| 100 Express Credits | One-time | `price_credits_100` | $25 |

### Stripe Integration Tasks
- [ ] Create Stripe account
- [ ] Create products and prices in Stripe dashboard
- [ ] Implement checkout flow (Stripe Checkout or Elements)
- [ ] Set up webhook endpoint
- [ ] Handle webhook events:
  - `checkout.session.completed` (one-time purchases)
  - `customer.subscription.created` (new Pro sub)
  - `customer.subscription.updated` (plan changes)
  - `customer.subscription.deleted` (cancellation)
  - `invoice.paid` (renewal)
  - `invoice.payment_failed` (failed payment)
- [ ] Update database on payment:
  - Set `profiles.tier` to `pro_monthly` or `beta_lifetime`
  - Add credits to `profiles.express_credits`
  - Log to `memberships` table
- [ ] Add tier-gating in UI (show upgrade prompts)
- [ ] Test full payment flow (test mode)
- [ ] Go live with real payments

### Free Tier Gating (UI Changes)
- [ ] Hide DINGS details behind blur/paywall
- [ ] Hide subgrade breakdown
- [ ] Hide centering ratios
- [ ] Show "Upgrade to see full report" CTA
- [ ] Limit collection to 5 scans
- [ ] Add watermark to exported grade cards

### Pro Features to Implement
- [ ] Full detailed DINGS report
- [ ] Subgrade breakdown display
- [ ] Centering ratio display
- [ ] Defect location overlays
- [ ] Unlimited collection saves
- [ ] High-quality exports (no watermark)
- [ ] Backend AI grading toggle
- [ ] Express credit purchase flow
- [ ] Credit balance display in UI

---

## Phase 5: Hardware Integration
> Status: NOT STARTED

### 3D Printed System Design
- [ ] Design phone mount (universal clamp)
- [ ] Design card tray (standard 2.5" x 3.5")
- [ ] Design LED ring mount (4-6 positions)
- [ ] Design enclosure (ambient light blocking)
- [ ] Test and iterate designs
- [ ] Create STL files for distribution

### Electronics
- [ ] Select microcontroller (ESP32, ATtiny, or simple 555 timer circuit)
- [ ] Design LED circuit (WS2812B or simple LEDs with resistors)
- [ ] Button interface for light cycling
- [ ] Optional: Bluetooth/WiFi for app control
- [ ] Power supply (USB or battery)
- [ ] Bill of materials (BOM)

### Software Integration
- [ ] Guided capture workflow in app
- [ ] On-screen prompts for light positions
- [ ] Multi-image processing pipeline
- [ ] Hardware detection/pairing (if using BLE)
- [ ] Pro-only gating for hardware features

---

## Grading Companies Reference

### Currently Implementing
| Company | Scale | Subgrades | Half Points | Centering (Front 10) |
|---------|-------|-----------|-------------|---------------------|
| TAG | 1000→1-10 | Yes (8) | Yes | 55/45 |
| PSA | 1-10 | No | No | 60/40 |
| BGS | 1-10 | Yes (4) | Yes | 50/50 |
| CGC | 1-10 | Yes (4) | Yes | 55/45 |
| SGC | 1-10 | No | No | 60/40 |

### Notes
- PSA is most lenient on centering
- BGS is strictest (50/50 for perfect 10)
- TAG uses 1000-point system internally
- CGC similar to BGS methodology

---

## Hardware Notes

### Chipset Options
| Option | Cost | Complexity | Features |
|--------|------|------------|----------|
| 555 Timer + Button | ~$2 | Very Low | Manual cycle only |
| ATtiny85 | ~$3 | Low | Programmable, button control |
| ESP8266 | ~$4 | Medium | WiFi, app control possible |
| ESP32 | ~$6 | Medium | WiFi + BLE, full app integration |

### Recommended: ATtiny85 or simple button circuit
- Keep it cheap and simple
- Button cycles through light positions
- App shows "Position 1: Direct", "Position 2: Left Rake", etc.
- No wireless complexity needed initially

### LED Positions (6-position system)
1. **Direct** - Flat, even lighting (overall condition)
2. **Left Rake** - Low angle from left (scratches, texture)
3. **Right Rake** - Low angle from right (scratches, texture)
4. **Top Rake** - Low angle from top (horizontal scratches)
5. **Bottom Rake** - Low angle from bottom (horizontal scratches)
6. **Backlight** (optional) - Behind card (creases, thinning)

---

## File Structure

```
SlabSense/
├── src/
│   ├── components/
│   │   ├── Auth/           # Login, Register, Profile
│   │   ├── Grading/        # Card analysis UI
│   │   ├── Collection/     # User's saved cards
│   │   ├── Settings/       # Preferences, grading company
│   │   └── Common/         # Shared (Header, Footer, Modal)
│   ├── services/
│   │   ├── api.js          # Backend API calls
│   │   ├── auth.js         # Supabase auth helpers
│   │   ├── storage.js      # Image upload/retrieval
│   │   └── grading.js      # Grade calculation logic
│   ├── hooks/
│   │   ├── useAuth.js
│   │   └── useGrading.js
│   ├── utils/
│   │   ├── gradingScales.js    # All company scales
│   │   └── calculations.js     # Shared math
│   ├── App.jsx
│   └── main.jsx
├── backend/
│   ├── api/
│   │   ├── centering.py
│   │   ├── defects.py
│   │   └── main.py
│   ├── requirements.txt
│   └── Dockerfile
├── supabase/
│   └── migrations/
├── docs/
│   ├── DISCLAIMERS.md
│   ├── PRIVACY_POLICY.md
│   └── TERMS_OF_SERVICE.md
├── public/
├── GAMEPLAN.md             # This file
├── package.json
├── vercel.json
└── README.md
```

---

## Legal Checklist

- [ ] Trademark search for "SlabSense"
- [ ] Disclaimers visible in app
- [ ] Terms of Service written
- [ ] Privacy Policy written (required for auth/data storage)
- [ ] Cookie consent (if using analytics)
- [ ] GDPR compliance (if EU users)

---

## Milestones

| Milestone | Description | Status |
|-----------|-------------|--------|
| Phase 1 | Foundation & Rebrand | DONE |
| Phase 2 (Auth) | Supabase auth, user accounts | DONE |
| Phase 3 | User features (collection, export, settings) | DONE |
| Backend Stage 1 | Python backend running locally | NOT STARTED |
| Phase 4 (Payments) | Stripe integration, tier gating | NOT STARTED |
| Backend Stage 2 | Deploy to Fly.io with queue | NOT STARTED |
| Phase 5 (Hardware) | 3D printed mount, LED system | NOT STARTED |

### Recommended Order
1. **Backend Stage 1** - Get Python processing working locally
2. **Phase 4** - Add Stripe payments and tier gating
3. **Backend Stage 2** - Deploy to production with queue
4. **Phase 5** - Hardware integration (future)

---

## Links & Resources

- **Supabase**: https://supabase.com
- **Fly.io**: https://fly.io
- **Stripe**: https://stripe.com
- **TCGPlayer API**: https://docs.tcgplayer.com
- **OpenCV Python**: https://docs.opencv.org
- **GitHub Repo**: https://github.com/2127bilbo/slabsense
- **Live Site**: (Vercel URL)

---

*Last Updated: April 6, 2026*
