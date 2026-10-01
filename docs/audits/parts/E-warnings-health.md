# E. Warnings and health — SlabSense App Store readiness audit (read-only, 2026-10-01)

**Summary.** `vite build` succeeds with 3 warnings (an `eval` in a nested onnxruntime-web pulled in by `@xenova/transformers`, a mixed static/dynamic import of `scans.js`, two chunks over 500 kB); there is no ESLint config at all and ESLint 10 refuses to run; `npm audit` reports 12 vulnerabilities (1 critical, 9 high) of which 7, including the critical `protobufjs` chain, ship to the browser via `@xenova/transformers`.
355 `console.*` calls in 68 runtime files reach production, no React ErrorBoundary exists, the web manifest still calls the app "TAG Pre-Grader", 25 of 122 buttons and 15 of 31 images have no accessible name, and `dist/` weighs 18 GB because `public/card-images` is copied in.
Health is otherwise sound: `npm run test:lib` passes 417/417 checks across 19 files, `node --check` passes 158/158 JS files, every `.map` in JSX carries a key, no deprecated lifecycles, no service worker to fight, no `http://` resources, and no direct dependency is deprecated.

Counts: 0 Blocker, 6 Major, 12 Minor, 8 Note (E-01 … E-26).

## 1. `vite build` warnings (verbatim, `npx vite build`, vite 6.4.2, 197 modules, 27.6 s, exit 0)

1. `node_modules/@xenova/transformers/node_modules/onnxruntime-web/dist/ort-web.min.js (6:62546): Use of eval in "node_modules/@xenova/transformers/node_modules/onnxruntime-web/dist/ort-web.min.js" is strongly discouraged as it poses security risks and may cause issues with minification.`
   Cause: `src/lib/clip-matcher.js:93` does `await import('@xenova/transformers')`; that package pins its own onnxruntime-web 1.14 (the build with `eval`). The app's real ONNX runtime is loaded from the models bucket (`src/services/cornerEdgeModels.js:193`), so this second runtime is dead weight. Fix: drop `clip-matcher.js` and the `@xenova/transformers` dependency if the CLIP re-rank is no longer on the identification path (`src/lib/identify-card.js:16` still imports it; card-DB memory says OCR + pixel re-rank since 2026-09-15 — confirm in section D); otherwise move CLIP to the API.
2. `(!) G:/Grading App/SlabSense/src/services/scans.js is dynamically imported by src/App.jsx but also statically imported by src/App.jsx, src/components/CardIdentifier/CardIdentifier.jsx, src/components/Collection/CollectionView.jsx, dynamic import will not move module into another chunk.`
   Cause: `src/App.jsx:11` static import plus `src/App.jsx:1614` `import('./services/scans.js')`. Fix: add `getUserScans` to the line-11 import and delete the dynamic import.
3. `(!) Some chunks are larger than 500 kB after minification.` — `assets/index-BpROA30R.js 717.98 kB (gzip 207.53)`, `assets/transformers-DH2twgIt.js 828.11 kB (gzip 200.93)`.
   Cause: `src/App.jsx` is a 3,487-line monolith in one chunk; the transformers chunk is item 1. Fix: remove transformers; split App.jsx by screen with `React.lazy` or `build.rollupOptions.output.manualChunks` (supabase, tesseract, html2canvas are already split).

Build output: 5 asset files, 1.7 MB in `dist/assets`; `dist/` total 18 GB (see E-09).

## 2. ESLint

- No `eslint.config.*`, `.eslintrc*`, `.prettierrc` or `.editorconfig` exists; `git log --all` shows none ever existed; `eslint` is not in `devDependencies` or `node_modules`.
- `npx eslint src/main.jsx` (npx fetched ESLint 10.11.0) exits with: `ESLint couldn't find an eslint.config.* file. From ESLint v9.0.0, the default configuration file is now eslint.config.*.` This is the "v9 migration" message earlier runs hit. Nothing was linted.
- Config to adopt (flat, ESM, matches `"type": "module"`): `@eslint/js` recommended + `eslint-plugin-react` (jsx-runtime preset) + `eslint-plugin-react-hooks` (rules-of-hooks error, exhaustive-deps warn) + `eslint-plugin-react-refresh` + `eslint-plugin-jsx-a11y` (section 8 shows it would fire ~40 times); `globals.browser` for `src/`, `globals.node` for `api/` and `scripts/`; `no-console: ["warn", { allow: ["warn", "error"] }]` in `src/`; ignore `dist/`, `public/slab/vendor/`, `training/`, `data/`, `staging/`. Add `"lint": "eslint ."` and run it inside `test:lib` (plan Phase 3 line 203).
- Dry analysis in its place: `node --check` over `src/`, `api/`, `scripts/` (`.js/.mjs/.cjs`, excluding node_modules): 158 checked, 0 parse failures. The 25 `.jsx` files cannot be checked by `node`; `vite build` compiled all of them. A regex pass for unused variables was not attempted because it is not reliable (destructuring, JSX usage, re-exports); the hook-deps rule is the one most likely to produce findings in `src/App.jsx` (57 `useEffect` calls app-wide, 5 flagged in section 5).

## 3. `npm audit` (12 vulnerabilities: 1 critical, 9 high, 1 moderate, 1 low; 252 packages, 47 prod)

| Sev | Package (installed) | Chain | Runs in | Fix |
|---|---|---|---|---|
| Critical | protobufjs <=7.6.2 (11 advisories: GHSA-xq3m-2v4x-88gg code exec, prototype injection, DoS …) | `@xenova/transformers` → `onnxruntime-web@1.14` → `onnx-proto` → `protobufjs` | **Client** (lazy `transformers-*.js` chunk, loaded when `clip-matcher.js` runs) | Remove `@xenova/transformers` (E-02); `npm audit fix --force` would downgrade it to 1.4.2 — do not |
| High | onnx-proto *, onnxruntime-web <=1.16 (via protobufjs) | same chain | Client | same |
| High | sharp <=0.35.4-rc.0 (libvips/libheif CVEs GHSA-f88m-g3jw-g9cj, GHSA-rgj7-g3m4-5g8c) | `@xenova/transformers` → `sharp` | Tooling only (Node image path; never bundled) | same |
| High | vite <=6.4.2 (GHSA-v6wh-96g9-6wx3 launch-editor NTLM hash leak on Windows; GHSA-fx2h-pf6j-xcff `server.fs.deny` bypass on Windows) | direct devDependency | Tooling (dev server only; `vite --host` is used, so it is LAN-exposed) | `npm update vite` → 6.4.3 (wanted) |
| High | browserslist <=4.28.6 (OOM, prototype write) | vite → `@vitejs/plugin-react` → babel → browserslist | Tooling | `npm audit fix` (non-breaking) |
| High | nanoid <=3.3.17 (infinite loop, integer overflow) | postcss → nanoid | Tooling | `npm audit fix` |
| High | postcss <=8.5.22 (XSS via `</style>`, sourceMappingURL file read ×3) | vite → postcss | Tooling (build) | `npm audit fix` |
| High | ws 8.0.0–8.20.1 (uninitialised memory, fragment DoS) | vite dev server / tesseract.js node path | Tooling | `npm audit fix` |
| Moderate | baseline-browser-mapping <2.11.0 | browserslist | Tooling | `npm audit fix` |
| Low | @babel/core <=7.29.0 (sourceMappingURL file read) | `@vitejs/plugin-react` | Tooling | `npm audit fix` |

API side: none of the 12 touch `api/` runtime deps (`stripe`, `@supabase/supabase-js`, `@anthropic-ai/sdk`, `openai`, `@google/generative-ai`). Outside npm's view: `public/slab/vendor/supabase.js` is a vendored supabase-js 2.116.0 UMD (E-12).

## 4. `npm outdated` and deprecations

| Package | Current | Wanted | Latest | Note |
|---|---|---|---|---|
| react / react-dom | 18.3.1 | 18.3.1 | 19.3.0 | One major behind; 19 drops `defaultProps`/string refs (none used). Not required for Capacitor. |
| vite | 6.4.2 | 6.4.3 | 8.3.2 | Two majors behind; 6.4.3 clears both High advisories. |
| @vitejs/plugin-react | 4.7.0 | 4.7.0 | 6.1.1 | Moves with vite. |
| @supabase/supabase-js | 2.101.1 | 2.117.2 | 2.117.2 | `npm update` (minor). `package.json` says `^2.39.0`. |
| stripe | 22.2.0 | 22.6.2 | 23.0.0 | `npm update` to 22.6.2; 23 is a major (API version bump) — do it during the Stripe go-live pass. |
| @anthropic-ai/sdk | 0.52.0 | 0.52.0 | 0.131.0 | 79 minor versions behind on a `^0.52.0` pin; check model ids/features before the paid-tier work. |
| openai | 6.42.0 | 6.49.0 | 7.25.0 | minor via `npm update`; 7 is a major. |
| @tcgdex/sdk | 2.7.1 | 2.9.0 | 2.9.0 | `npm update`. |
| onnxruntime-web | 1.30.0 | — | 1.30.0 | current (devDependency; the client's runtime copy comes from the bucket, E-11). |
| tesseract.js | 7.0.0 | — | 7.0.0 | current. |

Deprecated: no direct dependency is deprecated (`npm view … deprecated` on all 19). One deprecated transitive in the lockfile: `prebuild-install@7.1.3` (via `canvas`, tooling). `heic2any@0.0.4` is unmaintained (last publish 2020) though not flagged.

## 5. Runtime warnings and console output

- Missing keys: 84 `.map(` sites in JSX; all 18 candidates flagged by a loose grep were verified by hand to carry `key=` — **0 missing**. 23 use the array index as key (`key={i}`), harmless for static lists, wrong for reorderable ones (CollectionView).
- Deprecated lifecycles / `findDOMNode` / `ReactDOM.render` / `defaultProps` / `propTypes`: **0**. `dangerouslySetInnerHTML`: **0**.
- `setState` after unmount: 57 `useEffect`s; 5 await/`.then` then `setX` with no cancel flag or AbortController: `src/App.jsx:821`, `src/App.jsx:2092`, `src/components/Collection/CollectionView.jsx:175`, `src/components/PostCaptureCentering/PostCaptureCentering.jsx:125`, `src/hooks/useAuth.js:27`. React 18 no longer logs the warning, but a slow response can overwrite newer state (E-17). 10 effects do use a guard.
- Listener leaks: `src/App.jsx:1026` adds a `deviceorientation` listener inside `requestOrient` with no removal; `src/lib/gyro-input.js:127-139` registers `mousemove`, `touchmove`, `deviceorientation` on `document`/`window` and the returned object (line 145) has no `destroy` (module singleton via `getGyroInput`, so it leaks once, not per mount). `PostCaptureCentering.jsx:296-299` is balanced. `setInterval` without `clearInterval`: 0.
- No ErrorBoundary, `componentDidCatch`, `window.onerror` or `unhandledrejection` handler anywhere in `src/` (E-01). `main.jsx` runs `detectModelPassCrash()` before render — the only crash handling, and it is for page reloads, not JS exceptions.
- `console.*` in runtime code (tests excluded): **src** 144 log / 25 warn / 61 error, **api** 81 log / 4 warn / 40 error, 355 total across 68 of 100 files. Top: `src/services/api.js` 32, `src/App.jsx` 21, `api/deep-analyze-v2.js` 19, `api/stripe/webhook.js` 18, `src/services/ocr.js` 12, `src/services/tcgdex.js` 9, then 8 each in `scans.js`, `identify-card.js`, `clip-matcher.js`, `card-matcher.js`, `CardIdentifier.jsx`. `vite.config.js` has no `esbuild.drop`, so every client call ships (E-04). `public/studio.html` / `slabview.html`: 0.
- `React.StrictMode` is on (`src/main.jsx:10`): double-invoked effects in dev only; no production effect.

## 6. Service worker and caching

- No service worker: no `sw.js`, no `navigator.serviceWorker.register`, no workbox / `vite-plugin-pwa`. `public/manifest.json` (`display: standalone`) makes the site installable on the iOS home screen, but without a SW there is no offline shell and no update-prompt problem: every launch fetches `/index.html` from Vercel and content-hashed `assets/*`, so deploys are picked up on the next load. For the Capacitor build the web assets are bundled; nothing to unregister.
- Cache API is used directly, versioned by name: `slabsense-models-v1` (`src/services/cornerEdgeModels.js:23`, model `.onnx` files from `MODELS_BASE` = `VITE_MODELS_URL` or `<supabase>/storage/v1/object/public/models`) and `slabsense-card-db-v1` (`src/lib/card-db-client.js:9`). A changed model at the same URL is served stale until `CACHE_NAME` is bumped or `cache.delete` runs (`cornerEdgeModels.js:174` does that on toggle-off). Document the bump rule in the model upload runbook.
- `localStorage` keys: `slabsense_modelGrading`, `slabsense_modelPassActive`, `slabsense_modelPassCrashed`, `slabsense_measureMode`, `slabsense_disclaimer_acknowledged`. Reads in `cornerEdgeModels.js` are try/catch-wrapped; the `App.jsx:2641` and `measureMode` calls are not (private mode on iOS can throw).
- Runtime third-party origins: `cdn.jsdelivr.net` (tesseract.js default `workerPath`/`corePath`; `src/services/ocr.js:330,373` and `src/lib/id-rerank.js:121` pass no paths), `tessdata.projectnaptha.com` (lang data), `fonts.googleapis.com`, Supabase storage, `assets.tcgdex.net` via the `/tcgdex-img` rewrite. All HTTPS. For the native app, bundle the tesseract worker/core/`eng.traineddata` and the font so OCR and layout work offline (plan Review Focus 3).

## 7. `npm run test:lib`

Exit 0. 19 test files, **417 checks passed, 0 failed** (engine 117, detectors 9, softwareGrade 20, f16 5, card-db-client 11, stage-view 15, line-color 15, tag-crops 44, corner-edge-model 38, card-mask 19, grade-rollup 6, credits 15, gradeJobs 15, detectionPrompt 12, cornerEdgeInput 32, surfaceDeduction 22, gradeRollup 2, grade-records 15, training-labels 5). No warnings printed. Nothing exercises the React tree or the `api/` handlers end to end; there is no lint step.

## 8. Static Lighthouse-style checklist (`index.html`, `public/manifest.json`, `src/`)

| Check | Result |
|---|---|
| `<html lang>` | `en` — pass |
| viewport meta | present, `viewport-fit=cover`, but `maximum-scale=1.0, user-scalable=no` — Lighthouse accessibility fail (E-14) |
| theme-color | `#0a0b0e` in index.html and manifest — pass; absent from `public/studio.html`, `public/slabview.html` |
| apple-touch-icon | `/icon-192.png` — present (Apple's preferred size is 180×180; 192 is accepted) |
| apple-mobile-web-app-* | capable=yes, status-bar black-translucent, title SlabSense — pass |
| manifest fields | name **"TAG Pre-Grader"**, short_name **"PreGrader"**, description "Pre-grade TCG cards using TAG grading criteria" — mismatch with `<title>` "SlabSense - Card Pre-Grader" and uses a grading company's mark (E-05); icons 192/512 png, start_url `/`, display standalone, orientation portrait — pass |
| HTTPS-only resources | 0 `http://` literals in src/api/html (the 4 hits are `startsWith('http://')` URL checks in `api/_providers/*`) — pass |
| buttons with accessible name | 122 `<button>`; **25 have neither text, `aria-label` nor `title`**: `App.jsx` 698,1327,1332,1388,2546; `AuthModal.jsx` 73; `UserMenu.jsx` 33; `PricingPage.jsx` 119,364,397; `CardIdentifier.jsx` 205; `CollectionView.jsx` 761,780,1737,1799,1911,1936; `DamageReportModal.jsx` 183; `DefectMap.jsx` 68; `ExportCard.jsx` 107; `PostCaptureCentering.jsx` 870,880,902,912; `ProfileSettings.jsx` 89. Only 6 buttons app-wide use `aria-label` (all in PostCaptureCentering). |
| image alt | 31 `<img>`; **15 without `alt`** (all in `src/App.jsx`, e.g. 511, 542, 799, 851, 852 — captured card images and vision maps) |
| form controls | the file input at `App.jsx:1330` is hidden and triggered by an unlabeled icon button (1327) |
| sourcemaps in prod | `build.sourcemap: false` — pass |
| env exposure | only `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (+ optional `VITE_MODELS_URL`) reach the client — pass |

## Findings

E-01 | Major | src/main.jsx:9 | Apple 2.1 performance (no crash to a blank screen) | No ErrorBoundary / global error handler in `src/`; any render exception blanks the app | Add a top-level ErrorBoundary with a "reload" screen and an `unhandledrejection` listener that logs
E-02 | Major | src/lib/clip-matcher.js:93 (imported by src/lib/identify-card.js:16) | Supply chain / shipped vulnerable code | `@xenova/transformers` lazy chunk (828 kB) carries onnxruntime-web 1.14 (`eval` build warning) + critical `protobufjs` + high `onnx-proto`; 7 of 12 audit findings | Delete `clip-matcher.js` and the dependency if the CLIP path is dead (confirm with section D); else move CLIP server-side
E-03 | Major | package.json:22-45 | Owner requirement "every current warning"; audit hygiene | 12 audit vulns; the tooling ones have non-breaking fixes (`vite` 6.4.3, postcss, browserslist, nanoid, ws, baseline-browser-mapping, @babel/core) | `npm update vite && npm audit fix` (no `--force`), re-run; expect 12 → 0 once E-02 is done
E-04 | Major | vite.config.js:14; src/services/api.js (32), src/App.jsx (21), api/stripe/webhook.js (18) | 5.1.1 data minimisation; 2.1 | 355 `console.*` calls in 68 runtime files ship to production; client logs include request payloads and user ids | Client: `esbuild: { drop: ['console', 'debugger'] }` or a `log()` util gated on `import.meta.env.DEV`; API: one logger with a level and no payload bodies
E-05 | Major | public/manifest.json:2-4 | 2.3 accurate metadata; 5.2.1 third-party marks | Installed-app name "TAG Pre-Grader" / "PreGrader", description "using TAG grading criteria", while the app is SlabSense and disclaims affiliation | name and short_name "SlabSense"; copy the index.html description
E-06 | Major | (repo root; no eslint.config.js) | Code-quality baseline for the audit / re-audit loop | No ESLint config ever existed; ESLint 10 exits "couldn't find an eslint.config.*"; nothing has ever been linted | Add the flat config from section 2, `npm run lint` inside `test:lib`, fix findings in Phase 3
E-07 | Minor | src/App.jsx:1614 | Build warning | `scans.js` imported both dynamically and statically; the dynamic import has no effect | Add `getUserScans` to the static import at line 11
E-08 | Minor | src/App.jsx (3,487 lines) → dist index chunk 718 kB | Build warning; 2.1 launch time on phones | Main chunk over the 500 kB limit; App.jsx holds capture, viewfinder, results and settings | `React.lazy` per screen or `manualChunks`; raise `chunkSizeWarningLimit` only after splitting
E-09 | Minor | public/card-images (18 GB, gitignored) | Build hygiene; accidental upload | `vite build` copies `public/`, so `dist/` is 18 GB; a local `vercel deploy` would ship it | Move the card images out of `public/` (they are bucket-served) or exclude them from `publicDir`; add `.vercelignore`
E-10 | Minor | package.json | Dependency currency | React 18→19, Vite 6→8, plugin-react 4→6, @anthropic-ai/sdk 0.52→0.131, openai 6→7, stripe 22.2→23 behind | `npm update` for the minors now; schedule the majors after the native shell lands
E-11 | Minor | package.json:36-44 | Dependency classification | `@xenova/transformers` (client runtime) sits in devDependencies; the npm `onnxruntime-web` is only for scripts/harness while the client loads `ort.min.mjs` from the bucket — parity between the two versions is unchecked | Classify correctly; record the bucket ORT version next to the npm one in `training/weights/onnx/*.json`
E-12 | Minor | public/slab/vendor/supabase.js | Audit blind spot | Vendored supabase-js 2.116.0 UMD for the studio/slabview pages, outside `npm audit` and `npm update` | Note its version in the slab runbook; refresh it whenever supabase-js is bumped
E-13 | Minor | 25 buttons (list in §8); 15 `<img>` in src/App.jsx | 4.0 design / accessibility (VoiceOver) | Icon-only buttons (capture, pick file, close ×, tabs) have no accessible name; captured-card images have no `alt` | `aria-label` on each; `alt=""` for decorative vision maps, `alt="Front of card"` etc. for captures
E-14 | Minor | index.html:5 | Accessibility (zoom) | `maximum-scale=1.0, user-scalable=no` | Keep `viewport-fit=cover`; drop the two scale attributes (iOS ignores them; the editor blocks pinch with its own gesture handlers)
E-15 | Minor | src/App.jsx:1026 | Resource leak | `deviceorientation` listener added in `requestOrient` with no cleanup (the effect at 1018 does clean up its own) | Keep the handler in a ref and remove it in the effect cleanup
E-16 | Minor | src/lib/gyro-input.js:127-139,145 | Resource leak | Singleton registers `mousemove` / `touchmove` / `deviceorientation` on document/window; no `destroy()` | Add `destroy()` and call it from the HoloCard / Collection unmount
E-17 | Minor | src/App.jsx:821,2092; CollectionView.jsx:175; PostCaptureCentering.jsx:125; useAuth.js:27 | Stale async state | Effects set state after `await` with no cancel flag | `let cancelled = false; … return () => { cancelled = true }` or an AbortController
E-18 | Minor | src/services/ocr.js:330,373; src/lib/id-rerank.js:121 | 2.1 offline; third-party code at runtime | tesseract.js defaults load the worker/core from `cdn.jsdelivr.net` and lang data from `tessdata.projectnaptha.com` | Pass `workerPath` / `corePath` / `langPath` to bundled copies before the native build
E-19 | Note | src/ (23 sites) | React keys | Index used as key in 23 lists; 0 lists lack a key | Use stable ids where a list reorders (CollectionView)
E-20 | Note | src/main.jsx:10 | Dev only | StrictMode double effects in dev; not a production warning | None
E-21 | Note | (none) | Service worker | No SW; updates land on the next load; Cache API versions are `-v1` strings | Document the `CACHE_NAME` bump rule with model uploads
E-22 | Note | public/studio.html, public/slabview.html | Metadata | No `theme-color`; viewport present; 0 console calls | Add a theme-color meta
E-23 | Note | index.html:11 | Icons | apple-touch-icon is 192×192 (Apple recommends 180×180) | Add a 180 px PNG when the native icon set is produced
E-24 | Note | package-lock.json | Deprecation | Only `prebuild-install@7.1.3` (via `canvas`, tooling) is deprecated; no direct dep is | None
E-25 | Note | npm run test:lib | Test health | 19 files, 417 passed, 0 failed; no React or API-handler coverage | Add the lint step and one Playwright smoke run to the same script
E-26 | Note | vite build | Build health | 197 modules, 27.6 s, exit 0; sourcemaps off; only the Supabase URL/anon key are exposed | None
