# SlabSense v0.1.0-beta

**Multi-Company Card Pre-Grading Analysis Tool**

Analyze your trading cards against multiple professional grading standards including PSA, BGS, CGC, SGC, and TAG.

> **DISCLAIMER**: SlabSense is NOT affiliated with any professional grading company. All grades are estimates only. See [docs/DISCLAIMERS.md](docs/DISCLAIMERS.md) for full details.

## Features

- **Multi-Company Support** — Compare grades across PSA, BGS, CGC, SGC, and TAG scales
- **DINGS-Based Scoring** — Defect classification for Surface, Corners, Edges, and Centering
- **Live Camera Viewfinder** — Bubble level + card framing guide (requires HTTPS)
- **Surface Vision Modes** — Emboss, Hi-Pass, Edge Detection with transparency slider
- **DINGS Map Schematic** — Card outline with defect markers and severity scores
- **Auto-Crop Defect Previews** — Normal + enhanced side-by-side for detected defects
- **Holo Detection** — Automatically adjusts thresholds for foil/holographic cards
- **Manual Adjustment** — Fine-tune boundary detection for accuracy
- **PWA Ready** — Add to home screen for app-like experience

## Supported Grading Companies

| Company | Scale | Subgrades | Front Centering (10) |
|---------|-------|-----------|---------------------|
| TAG | 1000-point → 1-10 | Yes (8) | 55/45 |
| PSA | 1-10 | No | 60/40 |
| BGS | 1-10 | Yes (4) | 50/50 |
| CGC | 1-10 | Yes (4) | 55/45 |
| SGC | 1-10 | No | 60/40 |

## Deploy to Vercel

1. Push this repo to GitHub
2. Go to vercel.com → Import Project → select your repo
3. Vercel auto-detects Vite — click Deploy
4. Get your `https://your-project.vercel.app` URL
5. Open on any phone — camera, level, everything works over HTTPS

## Local Development

```bash
npm install
npm run dev
```

## Architecture

Currently 100% client-side — all image processing runs in the browser. No server required for basic functionality.

Future versions will include:
- Backend API for enhanced centering detection
- User accounts and scan history
- Card database integration

## Project Structure

```
SlabSense/
├── src/
│   ├── components/     # UI components (planned)
│   ├── services/       # API services (planned)
│   ├── utils/
│   │   └── gradingScales.js  # Multi-company grading scales
│   ├── App.jsx         # Main application
│   └── main.jsx
├── docs/
│   ├── DISCLAIMERS.md
│   ├── PRIVACY_POLICY.md
│   └── TERMS_OF_SERVICE.md
├── backend/            # Python API (planned)
├── supabase/           # Database migrations (planned)
├── GAMEPLAN.md         # Development roadmap
└── README.md
```

## Roadmap

See [GAMEPLAN.md](GAMEPLAN.md) for full development roadmap including:
- Phase 1: Foundation & Rebranding ✓
- Phase 2: Backend & Auth
- Phase 3: User Features
- Phase 4: Pro Features & Payments
- Phase 5: Hardware Integration

## License

MIT

## Status

**Beta** - Active development
