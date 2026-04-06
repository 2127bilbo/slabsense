# SlabSense - Development Gameplan

## Project Overview
**SlabSense** - A pre-grading card analysis tool supporting multiple grading companies (TAG, PSA, BGS, CGC, SGC). Provides grade estimates based on centering, corners, edges, and surface analysis.

### Business Model
- **Free Tier**: Basic single-image analysis, no account required
- **Beta Lifetime**: One-time payment for early supporters, lifetime pro access
- **Pro Monthly**: Full features, multi-image, hardware integration

### Tech Stack
- **Frontend**: React (Vite) - Mobile browser first
- **Backend**: Python + OpenCV (centering/defect API)
- **Database**: Supabase (Postgres + Auth + Storage)
- **Hosting**: Vercel (frontend) + Fly.io (backend)
- **Payments**: Stripe (future)

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
- [ ] Set up Python project with OpenCV
- [ ] Implement perspective correction (warp/deskew)
- [ ] Implement border detection
- [ ] Implement centering calculation
- [ ] OCR for card name & set number (Google Vision or Tesseract)
- [ ] Create API endpoint (FastAPI or Flask)
- [ ] Dockerize the service
- [ ] Deploy to Fly.io
- [ ] Connect frontend to backend API

---

## Phase 3: User Features
> Status: IN PROGRESS

- [x] Save scans to user account
- [x] View scan history/collection (CollectionView.jsx)
- [x] Delete scans from collection
- [ ] Export results (image, PDF, share link)
- [ ] Profile settings (display name, preferences)
- [ ] Default grading company preference (save to profile)
- [ ] Delete account functionality

### Deferred to Backend Phase
- [ ] Card identification (OCR: name, set number) — will be part of Python backend
- [ ] Card database integration (TCGPlayer API) — after OCR working

---

## Phase 4: Pro Features & Payments
> Status: NOT STARTED

### Stripe Integration
- [ ] Create Stripe account
- [ ] Set up products (Beta Lifetime, Pro Monthly)
- [ ] Implement checkout flow
- [ ] Handle webhooks (subscription events)
- [ ] Update user tier on successful payment

### Pro Features
- [ ] Multi-image upload workflow
- [ ] Server-side enhanced processing
- [ ] Batch grading (multiple cards)
- [ ] Priority API access
- [ ] Advanced analytics/stats
- [ ] Compare to previous scans

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

| Milestone | Target | Status |
|-----------|--------|--------|
| Phase 1 Complete | Week 1 | DONE |
| Phase 2 Complete | Week 3 | ~80% Done |
| Public Beta Launch | Week 4 | Not Started |
| Phase 3 Complete | Week 6 | In Progress |
| Phase 4 (Payments) | Week 8 | Not Started |
| Phase 5 (Hardware) | TBD | Not Started |

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
