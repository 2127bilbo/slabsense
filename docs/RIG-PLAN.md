# SlabSense Rig — the PC-hosted grading station

Written 2026-09-29. This is the full plan for a self-contained SlabSense that runs on the owner's PC
against a fixed imaging rig, with every model we have trained running locally and the larger
models that follow trained on the same machine. The phone app stays as it is and keeps improving
on its own track; the rig is a second product on the same engine.

Every number below that describes TAG's images or our models is taken from the repo
(`training/README.md`, `docs/GRADING_SYSTEM.md`, `scripts/tag-dataset/README.md`,
`training/HANDOFF-*.md`, `training/MODEL-ROADMAP.md`). Hardware recommendations are stated on
their own merits, not sized to the current PC; the current PC is the baseline.

---

## 0. Goals, principles, and what "as good as TAG or PSA" means

**Goal.** A card placed in the rig comes out with a grade, eight subgrades, a defect map and a
report that agree with TAG's DIG report on the same card at least as often as two TAG graders
would agree with each other, and that are reproducible: the same card scanned twice gives the
same answer, and any grade can be re-derived later from the stored images, model versions and
engine version.

**Principles.**
1. **One engine, one schema.** `src/lib/gradingEngine.js` v1.1 and the output schema in
   `docs/GRADING_SYSTEM.md` §4 are shared by phone and rig. The rig changes what feeds the engine,
   never the engine's math, unless the change ships to both.
2. **Copy TAG's capture.** Every model was trained on TAG's scans. The closer the rig's images are
   to TAG's (resolution, flatness, lighting, backdrop), the more of the recorded held-out accuracy
   transfers on day one, and the less domain work is needed.
3. **No paid models in the grade.** Identification is already ours; surface becomes ours (Section
   8); prose can be a template. Claude stays optional for wording only.
4. **Every scan is training data.** The rig stores everything it captures in the dataset's own
   layout, so a card that later goes to TAG becomes a paired example with zero extra work.
5. **Local first, private by default.** The rig runs with no inbound network, secrets outside the
   repo, and an audit trail per grade.

**Acceptance (the bar for "done").** Measured on the rig-paired set (Section 9), cards imaged on
the rig before being sent to TAG:

| Measure | Bar |
|---|---|
| Final grade agreement with TAG | exact on ≥ 80 % of cards, within a half grade on ≥ 95 % |
| Each subgrade (0–1000) vs TAG | mean absolute error ≤ 25 points, ≤ 15 on centering |
| Repeatability | same card, 10 scans: subgrade standard deviation ≤ 5 points, final grade identical |
| Centering | L/R and T/B within 1.0 point of TAG's DTE-derived ratio on ≥ 90 % of sides |
| Surface | crease recall ≥ 0.8 with ≤ 0.5 false creases per clean side |
| Throughput | ≤ 60 s from placing a card to a finished report, both sides |

PSA has no published per-card measurements to compare against; "as good as PSA" is measured by
crossover cards (Section 9.4) and, until pairs exist, by the published PSA scale the app already
applies.

---

## 1. Architecture

```
 ┌──────────── Imaging station ────────────┐        ┌──────────────── PC ─────────────────┐
 │ camera (tethered)  lights (sequenced)   │  USB   │ rig-capture service  (Python)        │
 │ jig + backdrop + fiducials + vacuum     ├───────►│   camera SDK, light controller,      │
 └─────────────────────────────────────────┘        │   photometric stereo → RGB + relief  │
                                                    │           │                          │
                                                    │ rig-inference service (Python, GPU)  │
                                                    │   PyTorch fp32: card, centering,     │
                                                    │   corners, edges, surface (later)    │
                                                    │           │  JSON slots / masks      │
                                                    │ rig-api (Node)                        │
                                                    │   same handlers as api/*, local DB,  │
                                                    │   gradingEngine.js, report, audit    │
                                                    │           │                          │
                                                    │ SlabSense Rig UI (Electron shell     │
                                                    │   around the existing Vite/React app)│
                                                    │           │                          │
                                                    │ local store: SQLite + scans/ folder  │
                                                    │   ⇄ optional sync to Supabase / R2   │
                                                    └──────────────────────────────────────┘
```

**Decisions.**
- **UI**: the existing React app in an Electron shell. Same components (`PostCaptureCentering`,
  the grade views, the collection), with the camera viewfinder replaced by the rig capture panel.
  Electron because the app and its libraries are JavaScript and the grading engine must run
  unchanged; Tauri would work but adds a Rust layer for no gain here.
- **API**: the Vercel functions (`api/ai-analyze-unified.js`, `deep-analyze-v2.js`,
  `card-info-unified.js`, credits, slabs) become a local Node service with the same handler
  code and a local router, so nothing about the request/response shapes changes. Credits and
  Stripe are not needed on the rig; they are stubbed to "unlimited, local".
- **Inference**: Python, PyTorch fp32 from the `.pt` checkpoints, no ONNX, no size limits.
  FastAPI on `127.0.0.1` only. The JS runners (`src/lib/corner-edge-runner.js`,
  `card-model-runner.js`) stay for the phone; the rig calls Python for every model so the big
  surface model and the current ones share one path.
- **Storage**: SQLite mirrors the Supabase tables the rig needs (`scans`, `graded_references`,
  `card_identifications`); images live in `scans/<scanId>/` on an NVMe drive. Optional one-way
  sync to the existing Supabase project for cards the owner wants visible in the phone app.
- **Card database**: the bucket-served card DB (`card-db`) is downloaded once and read locally.

---

## 2. Hardware

### 2.1 PC

| Part | Baseline (today) | Recommended | Why |
|---|---|---|---|
| GPU | RTX 4070 SUPER 12 GB | **RTX 5090 32 GB** (or RTX PRO 6000 Blackwell 96 GB if the budget allows) | Inference of the current models fits in 12 GB. Training does not: the full corners and centering runs peaked at 11.4–11.6 GB and would not fit the 4070's 12 GB at their batch sizes even for today's *small* models, which is why they ran on a rented 48 GB card. The surface model at native 1024 px tiles with a larger backbone needs more again. 32 GB removes the rental step for everything but the very largest runs and roughly halves epoch time. |
| CPU | i7-14700F, 20 cores | keep, or any 16+ core | Data loading was the bottleneck on the rented boxes ("32+ cores matter more than VRAM"); 20 cores is fine. |
| RAM | 32 GB | **64 GB minimum, 128 GB preferred** | Free RAM has dropped to ~5 GB during runs, forcing `--workers 0`; loader workers and the resized caches need headroom. |
| Storage | C: 931 GB, G: 1.86 TB, ~400 GB free each | **2 × 4 TB NVMe** (one for dataset caches, one for rig captures) plus an 8 TB+ external or NAS for backup | Dataset caches needed locally: ~95 GB corners + ~33 GB resized edges + ~100 GB surface tiles. Rig captures: 6 frames per side at 45–61 MP raw ≈ 300–600 MB per card; 5,000 cards ≈ 2–3 TB. |
| Power | — | UPS, 1000 VA+ | A grade interrupted mid-write must not corrupt the store; lights and camera on the same UPS. |
| Display | — | any; a second monitor for the capture preview | |

Software already on the PC and reused: Node 24, Python 3.12 venv at `training/.venv` (torch 2.9.1
cu128, CUDA 12.8, GPU visible), the training library `trainlib`, and the harness.

### 2.2 Camera

**Requirement, derived from TAG.** TAG's card frame is 4391 × 6063 px for a 2.5 × 3.5 in card:
about **1,750 px per inch, 14.5 µm per pixel on the card**. Corner crops are 550 px, surface
markers have median sizes of 11 px (pits), 160 px (scratches), 280 px (dents), 390 px (creases)
in that frame. The rig must reach at least that sampling with the card *and* a margin in frame.

Field of view needed: the card (63.5 × 88.9 mm) plus ≥ 5 mm of backdrop each side ≈ 75 × 100 mm.
At 14.5 µm/px that is 5,170 × 6,900 px ≈ **36 MP minimum**; more gives room to crop and deskew.

| Tier | Camera | Lens | Notes |
|---|---|---|---|
| **Recommended** | 61 MP full-frame mirrorless (Sony A7R V, 9504 × 6336) or 45 MP (Canon EOS R5 II, 8192 × 5464) | 90–105 mm flat-field macro (Sony FE 90 mm f/2.8 Macro G, Canon RF 100 mm f/2.8 L Macro) at ~1:3, f/8 | 61 MP at 100 mm FOV long side ≈ 95 px/mm ≈ 2,400 px/in, above TAG. Tethered over USB with the maker's SDK (Sony Camera Remote SDK, Canon EDSDK) or digiCamControl on Windows. Electronic shutter, fixed manual exposure, RAW + JPEG. |
| Metrology option | Industrial camera, 45–61 MP (Sony IMX455/IMX492 class from Basler, FLIR/Teledyne, IDS) | **Telecentric lens** for a 100 mm FOV (0.1–0.15× magnification, e.g. Edmund/Opto Engineering) | Telecentric = no perspective, constant magnification across the field: centering and size in real millimetres, which TAG reports (DTE in 0.01 mm, `cardWidthInches`). Costlier (lens $2–4k) but the right tool if the size score and sub-point centering matter. Global-shutter, hardware trigger to the lights. |
| **Phase 0 (start now)** | Flatbed scanner (Epson Perfection V600 / V850) at 2,400 dpi | — | Produces a flat, evenly lit, high-resolution RGB image very close to what our models were trained on, for under $1k and with no rig build. It cannot do raking light (no relief image) and puts glass on the card. Use it to test every current model on real cards this week and as the RGB fallback while the camera rig is built. |

Do not use a phone or a compact camera for the rig: rolling shutter, lens distortion and
auto-everything defeat repeatability.

### 2.3 Lighting

TAG describes its imaging as photometric stereoscopic (multiple light angles); their `sfx`
relief image is what makes dents visible, and our surface work found `DENT` only visible in `sfx`.
The rig therefore captures **two kinds of light**:

1. **Diffuse, cross-polarised colour pass** (the RGB image the corner, edge, centering and card
   models expect). Even light from all sides, no specular glare on holo foil.
2. **Raking passes** (the relief image). Low-angle light from four directions, one frame each;
   a photometric-stereo solve gives surface normals, rendered as a shaded relief image in the same
   pixel frame as the RGB.

| Item | Spec | Why |
|---|---|---|
| Diffuse light | Ring or dome of high-CRI (≥ 95) 5000 K LEDs behind opal acrylic diffuser; or four LED panels at 45° through diffusers | Flat, shadowless colour; matches a scanner look |
| Cross-polarisation | Linear polariser film on every diffuse light, analyser filter on the lens rotated 90° | Removes glare from holo and gloss so the models see print, not reflection |
| Raking lights | 4 LED bars (N, E, S, W) at 10–20° elevation, ~150 mm from the card, unpolarised, individually switchable | Photometric stereo input; long shadows reveal dents, creases, scratches |
| Driver | Constant-current, flicker-free, no PWM dimming (or PWM ≥ 20 kHz); each channel switchable from the PC (USB relay board or an Arduino/ESP32 over serial) | Repeatable exposures; the capture service sequences lights and shutter |
| Enclosure | Matte-black box around jig and lights, front door for card loading | Excludes room light and reflections; lighting is identical at any time of day |
| Optional | UV-A bar (365 nm) | Detects restoration, glue, re-coloured spots; not used by current models |

Bench check before committing to LEDs: photograph a known card under the diffuse pass and confirm
the TAG-orange backdrop reads within ±10 of RGB (247, 126, 44) after white balance, and that a
holo card shows no specular hotspots. The models learned that backdrop (a black table loses most
corner dings without repaint), so hitting the colour in-camera is cheaper than fixing it later.

### 2.4 Jig (3D printed) and platen

| Part | Design |
|---|---|
| Base plate | Rigid plate (printed in PETG/ASA, or milled acrylic) bolted to the enclosure floor; the camera column bolts to the same plate so camera-to-card distance never changes |
| Backdrop | Matte TAG-orange insert, replaceable, ≥ 15 mm larger than the card on every side; a matte white and a matte black insert for calibration frames |
| Card pocket | Recess 0.3 mm deep and 0.5 mm larger than a card, with three low locating pins (two on one long side, one on a short side) so a card seats in the same place every time; pins below the card's top surface so they never shadow an edge |
| **Vacuum platen** | Perforated pocket floor connected to a small vacuum pump (aquarium-pump class) with a foot switch; pulls a bowed card flat without touching its face | 20 of the owner's 147 photos are bowed; a bowed card shifts the crop line and puts the corner tile off the corner |
| Fiducials | Four printed crosshairs at known distances (calibrated with a certified ruler) outside the backdrop; used to compute mm per pixel per session and to check flatness/tilt | The engine can then report centering and size in real units like TAG |
| Colour patch | A small colour-checker strip in a corner of the frame, outside the card crop | White balance and exposure check every frame |
| Flip cradle | A second pocket rotated 180° is unnecessary: the operator flips the card in place; the software knows the side from the workflow step |
| Camera mount | Copy-stand column or 80/20 extrusion; camera plate with fine height adjustment; lens axis perpendicular to the platen, checked with a mirror target |
| Sleeve/slab | Out of scope by decision (2026-09-28): the rig grades raw cards; sleeved or slabbed cards are removed first |

Print tolerances: design the pocket 0.2 mm oversize and test-fit; PETG shrinks ~0.3–0.5 %.

### 2.5 Calibration kit

- Certified steel ruler or glass scale (0.1 mm graduations) for mm/px.
- Flat-field target (matte white insert) for vignetting correction.
- Colour checker (X-Rite/Calibrite passport or equivalent).
- Reference cards: three cards the owner already has TAG DIG reports for, kept unsleeved in a
  case, scanned at the start of every session as a drift check.

### 2.6 Bill of materials (rough)

| Group | Recommended | Approx. cost |
|---|---|---|
| Camera + macro lens | Sony A7R V + 90 mm macro (or Canon R5 II + RF 100 mm) | $4,000–5,000 |
| Telecentric option | Industrial 61 MP camera + 100 mm-FOV telecentric | $6,000–10,000 |
| Phase 0 scanner | Epson V850 | $900 |
| Lights, drivers, polariser film, analyser filter | | $400–800 |
| Light controller (USB relay / ESP32) | | $30–60 |
| Enclosure, copy stand, extrusion | | $300–600 |
| Jig prints, vacuum pump, tubing, fittings | | $100–200 |
| Calibration kit | | $200–300 |
| GPU upgrade | RTX 5090 | $2,000–2,500 |
| RAM to 64/128 GB, 2 × 4 TB NVMe, UPS | | $900–1,400 |

---

## 3. Build steps, in order

Each step has a deliverable and a check. Do them in order; Phase 0 runs in parallel with the
physical build.

### Phase 0 — test today's models on the PC (no rig needed)

- **0.1** Verify the environment: `training/.venv` imports torch with CUDA; `node --version` 24.
- **0.2** Create `rig/inference/` with a FastAPI service that loads the four accepted checkpoints
  (`training/weights/corners/v3-phone/best.pt`, `edges/v2-phone/best.pt`,
  `centering_rgb/v2b/best.pt`, `card/v1/best.pt`) using `trainlib`'s model classes, and exposes
  `/card`, `/centering`, `/corner-edge` with the same JSON the browser runners return
  (`corners[].{key,wear,deduction,angle}`, `edges[].{key,wear,deduction}`, `dte_{l,r,t,b}`,
  card corners as fractions). Crops are cut with the framing in `src/lib/tag-crops.js`
  (corner 0.1250 W × 0.0903 H, bottom strip 0.0739 H, side strips rotated 90° CCW).
- **0.3** Parity check: run the harness cards (`scripts/harness/card-splits.json`) through the
  Python service and through the existing JS runner; every slot within 0.01 wear and the same
  threshold decisions (the JS harness already does this against TAG's own crops with 0 flips).
- **0.4** Scanner trial (if the Phase 0 scanner is bought): scan 20 raw cards at 2,400 dpi, run
  the chain, compare corner/edge dings and centering with the owner's eye and, for any card
  that has a DIG report, with TAG.
- **Check**: parity 0 flips; the service grades a 2,400 dpi scan in under 5 s on the 4070 SUPER.

### Phase 1 — the application shell

- **1.1** Repo layout: `rig/` at the repo root with `rig/electron/` (main process, window,
  service supervisor), `rig/api/` (Node: local router that imports the existing `api/*` handlers
  and `api/_lib/*`), `rig/inference/` (Python), `rig/capture/` (Python: camera + lights),
  `rig/db/` (SQLite schema and migrations mirroring the Supabase tables). Shared code stays in
  `src/` and `api/`; nothing is forked.
- **1.2** Build mode: Vite builds the same app with `VITE_RIG=1`; the app swaps the camera
  viewfinder for the rig capture panel and points services at `http://127.0.0.1:<port>`.
- **1.3** Local API: same handler functions, credits/Stripe stubbed, `SURFACE_DEDUCTION_MODEL`
  and the corner/edge slot path unchanged. AI providers optional (off by default).
- **1.4** Local store: SQLite (`better-sqlite3`) with tables `scans`, `graded_references`,
  `card_identifications`, `rig_sessions`, `rig_calibration`, `audit`; images under
  `<data-root>/scans/<scanId>/`.
- **1.5** Card DB: pull the `card-db` shards once (`scripts/card-db/storage.mjs` knows the bucket),
  serve from disk.
- **1.6** Packaging: `electron-builder` NSIS installer; the Python services ship as a frozen venv
  (PyInstaller) or the installer creates the venv on first run; models are copied from
  `training/weights/` into `<data-root>/models/<name>/<version>/` with a manifest (name, version,
  sha256, input contract) — the same idea as the bucket's `models.json`.
- **1.7** Supervisor: Electron starts inference and capture services on free localhost ports,
  health-checks them, restarts on crash, shows status in the UI footer.
- **Check**: a saved phone-app scan (front/back JPEG) loaded into the rig app grades identically
  to the phone app (same engine, same slots).

### Phase 2 — jig, enclosure, lights

- **2.1** Print the base plate, pocket, backdrop inserts, fiducial plate; fit-test with cards.
- **2.2** Vacuum platen: drill/print the perforated floor, seal the plenum, connect the pump,
  confirm a deliberately bowed card pulls flat without marking.
- **2.3** Build the enclosure; mount column and camera plate; set the lens axis perpendicular
  (mirror test) and lock it.
- **2.4** Install diffuse lights with polariser film; analyser on the lens; verify no hotspot on a
  holo card, backdrop RGB within ±10 of (247, 126, 44) after white balance.
- **2.5** Install the four raking bars; wire the controller; verify each channel switches from a
  Python script in < 50 ms.
- **2.6** Calibration frames: dark frame, flat frame per light, ruler frame; compute mm/px,
  vignetting map, tilt.
- **Check**: fiducial distances repeatable to ±1 px across 20 loads; the same card loaded 10 times
  lands within ±2 px.

### Phase 3 — capture service

- **3.1** Camera control: tether via SDK/digiCamControl; fixed manual exposure per pass, RAW +
  JPEG; verify a frame lands on disk in < 2 s.
- **3.2** Sequence per side: [diffuse cross-pol RGB] → [raking N] → [E] → [S] → [W] → (optional
  UV). Six frames, ~10 s.
- **3.3** Processing: RAW develop with a fixed profile (no auto anything) → flat-field and dark
  correction → lens distortion correction (or none with a telecentric) → fiducial-based
  scale/rotation → **card detection with the card model at full resolution** → deskew and crop to
  TAG's frame convention: card plus ~50 px of backdrop, ≈ 4391 × 6063 at TAG's scale (keep a
  higher-resolution master too) → corner 550 crops and edge strips per `tag-crops.js`.
- **3.4** Relief: photometric stereo from the four raking frames (Lambertian solve: N =
  (LᵀL)⁻¹Lᵀ I, then a shaded render from a fixed virtual light), saved as `sfx_front.jpg` /
  `sfx_back.jpg` in the same pixel frame as the RGB, exactly the layout of the TAG dataset.
- **3.5** Per-scan folder written in the **dataset layout** (`scripts/tag-dataset/README.md`):
  `front.jpg back.jpg sfx_front.jpg sfx_back.jpg corner_{F,B}{TL,TR,BL,BR}.png
  edge_{F,B}{T,B,L,R}.png` plus `capture.json` (camera, exposure, light sequence, calibration id,
  mm/px, fiducial positions, sha256 of every file).
- **Check**: the reference cards' RGB frames match their TAG images at the crop level (mean
  pixel difference of the corner crops < 8/255 after alignment) and relief frames show the
  known dents.

### Phase 4 — grading flow on the rig

- **4.1** Workflow: place card → capture front → flip → capture back → automatic: card model
  (outline), centering v2b (artwork frame) shown in the existing centering tool for an operator
  glance, corner/edge models on the TAG-framed crops, surface (Section 8; paid path or manual
  until then) → engine → report → store.
- **4.2** The centering tool keeps its role as the operator check; with fiducials the rig also
  reports L/R and T/B in millimetres and the size score like TAG (`cardWidthInches`,
  `scoreSize` are in the dataset to calibrate against).
- **4.3** Report: the phone report plus the relief view, the defect map on both images, and the
  provenance block (Section 7).
- **4.4** Batch mode: queue of cards with a barcode/serial label per card so a session of 50 is
  one sitting.
- **Check**: the three reference cards grade within the acceptance bars against their DIG reports
  every session.

### Phase 5 — dataset building (runs from the first rig scan onward)

- **5.1** Every scan is stored in the dataset layout (3.5), so the rig's own `manifest.parquet`
  is built by the same `tagdataset` code paths with `source = "rig"`.
- **5.2** Labelling: a rig labelling screen (extend `scripts/models/label-card-val.mjs`'s
  approach) for card corners, artwork frame, and surface markers using TAG's marker vocabulary
  (`scripts/tag-dataset/tagdataset/type_map.json`: crease, dent, scratch, pit, stain, print
  line, print defect, bend, tear …) with box + deduction; the operator marks what they see on the
  RGB and relief images.
- **5.3** Pairing with TAG: when a rig-scanned card is submitted to TAG, its cert is entered; the
  existing fetch code pulls the DIG report and the pair (rig images + TAG labels) is the
  **rig-paired set**. Target 300 cards across grades 4–10 in the first six months, then
  continuous.
- **5.4** Splits: paired cards get their own split file; never mix into TAG's frozen
  train/val/test (`scripts/tag-dataset/splits/splits.parquet`).
- **5.5** Backup: rig captures to a new R2 bucket `slabsense-rig-captures` (same key layout,
  separate write token) and a local external drive; the TAG dataset stays in
  `slabsense-tag-dataset`.
- **Check**: `verify --check-bucket` style completeness for rig scans; each paired card has both
  halves.

### Phase 6 — larger models on the PC GPU

For each: cache from R2 → train → evaluate on TAG held-out → evaluate on the rig-paired set →
accept → deploy to `<data-root>/models/` with a version bump. Gates are in
`training/MODEL-ROADMAP.md`.

- **6.1 Edges HR**: native-resolution strip segments, ding-marker targets; recall ≥ 0.6 at ≤ 10 %
  false-positive sides.
- **6.2 Centering v3**: sees the card edge in a loose crop, direct ratio head, native-resolution
  border bands; slope ≥ 0.95, ≥ 90 % within 1 point on the rig set.
- **6.3 Surface (rig-first, the big one)**: two-stage — tile detector on 1024 px native tiles
  (RGB + relief channels, larger backbone) trained on TAG's 320,864 markers with `Manual` markers
  as strong labels; side-level aggregator to TAG's per-side surface score. Crease recall ≥ 0.8,
  ≤ 0.5 false creases per clean side.
- **6.4 Rollup**: trees from TAG's eight per-side scores to the final grade on 27,751 certs
  (note `score_total` exists on only 3,010 certs; the grade label exists on all), exported as
  JSON and walked in the engine like the deduction regressor.
- **6.5 Corners/edges fine-tune on rig-paired data** once ≥ 150 pairs exist.
- **6.6 Company offsets** from crossovers (Section 9.4).

### Phase 7 — hardening and operations

- Daily: dark/flat/ruler frames, three reference cards, drift report in the UI.
- Weekly: lens and platen cleaning, backup verification, model/engine version review.
- Release process: git tag, installer build, changelog; the phone app and the rig share `main`.

---

## 4. Models: what runs on the rig at day one and how it changes

| Model | Checkpoint | Input (today) | Rig day one | Rig later |
|---|---|---|---|---|
| Card outline | `training/weights/card/v1/best.pt` (12.7 MB) | 512 letterbox mask | Runs on the full frame; fiducials and the fixed pocket make it almost trivial; add a full-resolution edge refiner | Mesh for bowed cards is unnecessary with the vacuum platen |
| Centering | `centering_rgb/v2b/best.pt` (112 MB) | 896 × 1248 card crop | Runs on the TAG-framed crop; the rig's crop error is ~1 px so the crop-edge sensitivity mostly disappears | v3 (Section 6.2) |
| Corners | `corners/v3-phone/best.pt` | 384 × 384 tile, TAG framing | Runs on 550 px crops like TAG's own; expect the scan-domain numbers (AUROC 0.92) | fine-tune on rig pairs |
| Edges | `edges/v2-phone/best.pt` | 1024 × 192 strip | Same; still the weak one | Edges HR (6.1) |
| Surface deduction regressor | `api/_lib/models/surface-deduction-v1.json` | marker type + geometry | Unchanged, sets severity for any marker source | feeds the rig surface model's output |
| Surface detector | none live (`surface/v3/best.pt` rejected) | — | Paid path or operator markers | Rig surface model (6.3) |

Inference cost on the 4070 SUPER: the current four models on one card, both sides, well under 2 s
in fp32. The surface tile model at ~40 tiles per side adds a few seconds.

Contracts to honour (from `training/weights/onnx/*.json`): ImageNet normalisation after `x/255`,
NCHW; corners output wear/deduction/angle (sigmoid, ×1000 for TAG points); edges wear/deduction;
centering four DTE per-mille; card mask logits > 0. Thresholds in the app: wear 0.20 for both
corners and edges, severity cuts 150/300/500 (`MODEL_DEFAULTS` in `src/lib/corner-edge-model.js`).
The rig re-calibrates thresholds on the rig-paired set and records them per model version.

---

## 5. Data we already have, and how the rig reaches it

### 5.1 Cloudflare R2 (the TAG dataset)

- Bucket `slabsense-tag-dataset`, region `auto`, key layout `tag-dataset/{cert}/{file}`,
  24 files per cert, ~24 MB per cert; ~1.63 TB total (edges full-res 833 GB, sfx 338 GB,
  front/back 251 GB, corners 105 GB, dings 105 GB). Account id and endpoint are in
  `scripts/tag-dataset/config.toml` (gitignored) and `training/HANDOFF-rented-gpu.md`.
- Credentials: env vars `B2_KEY_ID` / `B2_APP_KEY` (names kept from the Backblaze era), read by
  `training/trainlib/r2.py` (boto3 S3 client) and `scripts/tag-dataset/tagdataset/config.py`.
  Local key file `scripts/tag-dataset/data/env.ps1` (gitignored).
- Manifests: `scripts/tag-dataset/data/dataset/{manifest,corners,edges,surface,dings,splits}.parquet`
  (~23 MB); authoritative splits `scripts/tag-dataset/splits/splits.parquet` (tracked).
  27,751 certs: 22,202 train / 2,790 val / 2,759 test; 222,008 corner and edge rows; 320,864
  surface markers; 113,621 dings.
- Local caches: `python -m trainlib.cache_cli --task corners|edges --splits train,val,test`
  (corners ~105 GB full, edges resized 1024 × 192 ~33 GB), `trainlib.surface_cache_cli pull|tile`
  for whole-card sfx/rgb. Cache dir is set in `training/config.toml`.
- New for the rig: bucket `slabsense-rig-captures`, same layout keyed by `rig/{scanId}/{file}`,
  a write-scoped token for the rig, read-only elsewhere.

### 5.2 Supabase (the app)

- Tables the rig mirrors: `scans`, `graded_references`, `card_identifications`.
- Buckets: `models` (phone models, parts + `models.json`), `card-images`, `card-db` (card DB
  shards, pulled once for the rig), `slab-images`, `slab-labels`.
- The rig never needs `SUPABASE_SERVICE_ROLE_KEY`; optional sync uses a dedicated user with the
  anon key and RLS.

### 5.3 Reference documents

- `docs/GRADING_SYSTEM.md` — the one grading doc: pipeline, engine, TAG scale, company rules,
  output schema.
- `docs/grading-research/sources/` — verbatim TAG/PSA/CGC/SGC/BGS scales and rubrics; TAG
  centering rubric; `TAG_DIG_reports_calibration.md` (photometric stereo mention).
- `docs/grading-research/e-reader-centering.md` — TAG counts the dot-code strip as print.
- `training/README.md` — every training run, result, and command; `training/MODEL-ROADMAP.md` —
  per-model plan and gates; `training/HANDOFF-rented-gpu.md`, `HANDOFF-card-and-centering.md` —
  step-by-step GPU procedures to copy for local runs.
- `scripts/tag-dataset/README.md`, `RUNBOOK.md` — dataset layout, fetch/verify commands, TAG
  API fields (`tagdataset/labels.py`), marker inventory (`data/dataset/stats_report.txt`),
  type map.
- `src/lib/tag-crops.js` — TAG crop framing and backdrop constant; `src/lib/card-mask.js`,
  `card-model-runner.js`, `corner-edge-runner.js` — reference implementations to mirror in Python.
- `scripts/harness/` — parity and accuracy tooling (`card-chain.mjs`, `centering-model.mjs`,
  `model-predict.mjs`, `verify-crops.mjs`).
- `docs/superpowers/specs/2026-09-12-tag-grading-models-design.md` — original model programme,
  including the hosted-inference design the rig replaces with a local service.

---

## 6. Security protocols

1. **Network**: all rig services bind `127.0.0.1`; Windows Firewall inbound rule denies the
   service ports; the PC has no port forwarding. Outbound only to R2, Supabase (optional sync),
   and TAG's API for pairing.
2. **Secrets**: never in the repo. A single `%LOCALAPPDATA%\SlabSense\rig.env` (NTFS
   permissions: owner only) or Windows Credential Manager entries for: R2 read token, R2 rig
   write token, Supabase anon key (sync only), TAG API signing values, optional AI keys. The
   Electron renderer never sees secrets; only the local API and Python services read them.
3. **Rotate what is already exposed**: `scripts/Tag scraper/tag_proxy.py` has two hardcoded
   values (signing secret, AES key) committed to git; `Slabsense Gemini API-.txt` sits in the
   repo root outside the ignore rule. Move both out of the tree, rotate where possible, and add
   the root file pattern to `.gitignore`. The repo is private, but the rig plan is the moment to
   clean this.
4. **Least privilege**: separate R2 tokens per purpose (dataset read; rig-captures write);
   `SUPABASE_SERVICE_ROLE_KEY` is not installed on the rig at all.
5. **Machine**: BitLocker on both drives; a standard (non-admin) Windows account runs the rig;
   auto-lock; the training venv and data root owned by that account.
6. **Provenance and audit** (this is also what makes "as good as TAG" defensible): every grade
   row stores sha256 of every image, model names + versions + thresholds, engine version,
   calibration id, capture settings, operator, timestamp; the audit table is append-only. A grade
   can be re-run from the stored inputs and must reproduce.
7. **Backups**: nightly rig captures and SQLite to R2 `slabsense-rig-captures` and to the
   external drive; monthly restore test.
8. **Customer data**: card images and cert numbers are the customer's; keep them local unless
   they opt into sync; no third-party AI provider receives images unless the operator turns the
   paid path on for that scan.
9. **Updates**: rig builds come from tagged commits on `main`; no auto-update from the network.

---

## 7. Provenance block (stored with every grade)

```
{
  "rig": { "station": "rig-01", "calibrationId": "2026-10-03T09:00", "mmPerPx": 0.0145, "tiltDeg": 0.1 },
  "capture": { "camera": "…", "lens": "…", "exposure": {...}, "lights": ["diffuse","N","E","S","W"], "frames": { "front.jpg": "sha256…", "sfx_front.jpg": "sha256…", ... } },
  "models": { "card": "v1", "centering": "v2b", "corners": "v3-phone", "edges": "v2-phone", "surface": null, "deduction": "v1", "thresholds": { "cornerWear": 0.20, "edgeWear": 0.20 } },
  "engine": "1.1",
  "operator": "…", "timestamp": "…"
}
```

---

## 8. Surface on the rig (why it becomes ours here)

On the phone, surface was never going to be a small on-device model: hairline detail is gone at
2000 px and glare is uncontrolled. The rig removes both. The design, in full in
`training/MODEL-ROADMAP.md` §5:

- Native-resolution 1024 px tiles (stride 896, as `trainlib/tiles.py` already does), input RGB +
  relief, larger backbone (convnext_base or a DINOv2-class encoder), trained on TAG's markers with
  `Source = Manual` as strong labels and automatic ones as weak; tile outputs: presence per type
  and a deduction; side aggregation to TAG's per-side surface score (`scoreFCSE`/`scoreBCSE`).
- Rig relief images are the same modality as TAG's `sfx`, so the model trains on TAG's 338 GB of
  relief data and runs on ours without a domain jump.
- Until it ships: operator-marked defects in the labelling screen, severity from the deduction
  regressor; the paid AI path stays available as an optional second opinion.

---

## 9. Validation programme

- **9.1 Parity** (Phase 0): Python service = JS runners on the harness cards, 0 threshold flips.
- **9.2 Reference cards** (every session): three TAG-graded cards, subgrades within 25 points,
  grade identical.
- **9.3 Rig-paired set**: rig scan → submit to TAG → DIG report. Report per model and end to end
  against the Section 0 bars; this is the number that says the rig is as good as TAG.
- **9.4 Crossovers**: cards graded by TAG and by PSA/CGC/SGC/BGS (owner submissions, public pairs
  with both certs). Per-grade agreement tables per company; this is the only honest "as good as
  PSA" measure, and it also feeds the company-offset model.
- **9.5 Repeatability**: 10 loads of the same card per week; subgrade standard deviation ≤ 5.
- **9.6 Stress**: worn cards (grades 1–5), holo/foil, e-Reader (dot-code rule), oversized and
  mini cards, dark-border sets; the harness card list already spans grades 1–10.

---

## 10. Sequencing summary

| Order | Track | Weeks (rough) | Depends on |
|---|---|---|---|
| 1 | Phase 0: Python inference service + parity; scanner trial | 1–2 | nothing |
| 2 | Phase 1: Electron shell, local API, SQLite | 2–3 | Phase 0 |
| 3 | Phase 2: jig, enclosure, lights (parts on order from day 1) | 2–4 | parts |
| 4 | Phase 3: capture service + processing + relief | 2–3 | Phase 2 |
| 5 | Phase 4: grading flow, reports, batch mode | 1–2 | Phases 1, 3 |
| 6 | Phase 5: dataset building starts (never ends) | from first scan | Phase 3 |
| 7 | Phase 6: Edges HR → Centering v3 → Surface → Rollup | 6–12 | GPU, Phase 5 pairs for gates |
| 8 | Phase 7: hardening, operations | ongoing | |

Parts with lead time to order first: camera and lens, telecentric if chosen, LED bars and
polariser film, GPU and RAM, NVMe drives, UPS.

---

## 11. Open decisions for the owner

1. Camera path: mirrorless + macro (recommended, faster to build) or industrial + telecentric
   (best measurement accuracy, more cost and integration).
2. GPU: RTX 5090 now, or keep renting for the largest runs (about $50 per full corner/edge run so
   far) and buy later.
3. Whether the rig syncs any grades to the public app (affects the Supabase user model).
4. Whether the paid AI path remains available on the rig as an optional second opinion.
