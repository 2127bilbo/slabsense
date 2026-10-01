# K. Content, claims and metadata

**Summary.** The app's core framing is honest ("{Company} Estimate", first-run disclaimer, export footer), but the legal documents are never served in-app and still carry `[email TBD]` placeholders, the PWA manifest calls the product "TAG Pre-Grader", a dead-but-shipped component paints PSA/BGS/CGC/SGC/TAG-branded slab labels with fabricated cert numbers, and the public cert page and engraved label carry no estimate / not-affiliated statement at all.
Counts: 3 Blocker, 9 Major, 10 Minor, 5 Note (27 findings). Blockers: K-01 (legal docs placeholders, not linked in app), K-02 (manifest names the product after TAG), K-03 (stale false capability claim "AI-Enhanced with SAM 2 • Perfect edges").
Read-only audit, 2026-10-01, branch `tag-dataset`; nothing outside this file was touched.

## 1. User-facing strings (claims, affiliation, cert wording, placeholders, stale)

Legend: (a) outcome/accuracy claim, (b) affiliation/equivalence, (c) our "cert" confusable with a company cert, (d) placeholder, (e) wrong/stale.

| # | file:line | Class | String (verbatim or abridged) | Problem | Suggested rewrite |
|---|---|---|---|---|---|
| S1 | `public/manifest.json:2-4` | b, e | name `"TAG Pre-Grader"`, short_name `"PreGrader"`, description `"Pre-grade TCG cards using TAG grading criteria"` | Names the product after a grading company; stale vs index.html | `"SlabSense"`, `"SlabSense"`, `"Pre-grade Pokémon cards: an estimate of how grading companies would score them. Not affiliated with any grading company."` |
| S2 | `src/App.jsx:2605` | a, e | `AI-Enhanced with SAM 2 • Perfect edges & perspective correction` | No SAM 2 anywhere in `api/` (grep: none); "Perfect" is an accuracy claim | `Card outline from your photo · perspective-corrected` or delete the line |
| S3 | `src/components/DamageReport/DefectList.jsx:35` | a, b | `No DINGS detected — potential Gem Mint candidate` | Predicts a company outcome ("Gem Mint" is PSA/TAG designation) | `No defects detected in these photos` |
| S4 | `src/App.jsx:248` | b | `TAG Score: {score} / 1000` | Reads as TAG's own score; it is our engine's 1000-pt score on a TAG-style scale | `Score (TAG-style 1000-pt scale): {score} / 1000` |
| S5 | `src/components/Grading/GradeResultDisplay.jsx:382`, `src/components/Collection/CollectionView.jsx:1422` | b | `Condition (TAG 1000-Point)` | Same as S4 | `Condition (1000-pt scale, TAG-style)` |
| S6 | `src/components/DamageReport/DamageReportModal.jsx:157,172`; "DINGS" in `App.jsx:334,3484`, `ExportCard.jsx:71`, `DefectList.jsx:35` | b | `DINGS` / `Defects Identified of Notable Grade Significance` | TAG's report vocabulary used as if it were ours (repo docs cite "the owner's own TAG DIG report data", `docs/GRADING_SYSTEM.md:12`) | Use `Defects` in the UI; keep DINGS only in code/docs with an attribution |
| S7 | `src/components/CardViewer/RealisticSlab.jsx:21-67,347-358,375` | b, c | `logoText: 'PSA'/'BECKETT'/'CGC'/'SGC'/'TAG'`, label colours per company, `'PROFESSIONAL SPORTS AUTHENTICATOR'`, `'BECKETT GRADING SERVICES'`, `'CERTIFIED GUARANTY COMPANY'`, `generateCertNumber()` = random 8 digits | Renders a mock company slab with a fake cert number. Toggle is commented out (`CardViewer3D.jsx:123-141`, `viewMode` fixed to `'card'`) so it is unreachable today, but it ships in the bundle | Delete `RealisticSlab.jsx` and the `slab` branch of `CardViewer3D.jsx`; if a slab preview returns, only a SlabSense-branded one with the word ESTIMATE |
| S8 | `src/components/Auth/AuthModal.jsx:240` | d, e | `By creating an account, you agree to our Terms of Service and Privacy Policy.` | No link; the documents are not served anywhere (grep `terms|privacy` in `src/`, `public/`, `vercel.json`: no route) | Link to in-app `/terms`, `/privacy` pages (see K-01) |
| S9 | `docs/TERMS_OF_SERVICE.md` (Contact), `docs/PRIVACY_POLICY.md` ("contact us at [email TBD]"), `docs/DISCLAIMERS.md` (Contact) | d | `[legal email TBD]`, `[email TBD]`, `[contact email TBD]`, `[repository TBD]`; all dated `April 2025` | Placeholders in the legal text Apple will read | Real support address + `Last updated` date; publish at URLs used in App Store Connect |
| S10 | `src/components/Auth/UserMenu.jsx:156,176` | d, e | `Upgrade to Pro` button with `/* TODO: Upgrade */` (does nothing); tier labels `Beta Lifetime`, `Pro` keyed `pro_monthly` | Dead button; tier keys do not match the plans sold (`trial/hobby/pro/dealer`, `src/services/credits.js:143-146`) | Open the pricing/IAP sheet, or remove; derive labels from one tier table |
| S11 | `src/App.jsx:36,2659`, `package.json:4`, `README.md:1` | e | `v0.1.0-beta` in the visible header; README says `v0.2.0-beta` | "beta" is visible in the shipping UI; versions disagree | Show `1.0` from `package.json`; drop "beta" |
| S12 | `src/App.jsx:3484` | b | `Pre-grade estimate · DINGS-based · Not affiliated with TAG` | Only disclaims TAG | `Pre-grade estimate · Not affiliated with any grading company` |
| S13 | `src/components/Settings/ProfileSettings.jsx:291` | b | `…with the TAG-trained models…` | Implies TAG involvement in training | `…with models trained on photos of professionally graded cards…` |
| S14 | `src/components/Collection/CollectionView.jsx:1562` | b | `GRADER NOTES` | Implies a human grader | `AI NOTES` |
| S15 | `src/components/Grading/GradeResultDisplay.jsx:11` | a | badge `SOFTWARE` (vs `AI ESTIMATE`, `DEEP AI`) | Only one of three badges says "estimate" | `SOFTWARE ESTIMATE`, `AI ESTIMATE`, `DEEP AI ESTIMATE` |
| S16 | `src/utils/gradingScales.js:43-47` vs `docs/DISCLAIMERS.md` | e | TAG = `Technical Authentication & Grading` in code, `True Authentic Grading` in DISCLAIMERS; PSA = "Professional Sports Authenticator" (company is "Professional Sports Authenticator" in one place, DISCLAIMERS attributes to "Collectors Universe") | Inconsistent company names; trademark owners possibly out of date | One list of names/owners, verified against each company's own site, used by both |
| S17 | `docs/DISCLAIMERS.md` "Trading Card Games" | e | Magic, Yu-Gi-Oh!, sports cards listed | App is Pokémon-only (`detectionPrompt.js:44`) | Keep Pokémon line only |
| S18 | `public/slabview.html:6,74`; `public/slab/slabview.js:135` | c | Title `SlabSense Cert`, section heading `Cert`, page shows `Subgrades`, `Defects found`, grade word | Reads like a grading-company certificate; no estimate or not-affiliated line anywhere on the page | Add under the grade: `SlabSense pre-grade estimate. SlabSense is not a grading company and is not affiliated with PSA, BGS, CGC, SGC or TAG.`; rename section to `Order` |
| S19 | `public/slab/label.js:8-11` (engraved label), `GRADES` | b, c | Grade words `PRISTINE`, `GEM MINT`, `NM-MT`… engraved with the number and a cert `SS26-nnnnn` + QR | The physical label uses the companies' designation vocabulary with no "estimate"; a buyer on the secondary market could mistake it for a graded slab | Owner decision (label layout is locked, memory `engraving-studio-plan`): add `EST.`/`PRE-GRADE` to the designation line or the header, and let the QR page carry the full statement (S18) |
| S20 | `api/stripe/create-checkout.js:148-149` | e | fallback `https://slabsense.com/billing…` | Stale domain (live is slabsenseai.com); `/billing` route does not exist | `https://slabsenseai.com/?...` |
| S21 | `README.md:5,19,27` | a, b, e | `using Claude AI for accurate grading`, `Get PSA, BGS, SGC, CGC, and TAG grades in ONE API call`, `3D Card View (SAM 2)` | Public repo README promises accuracy and company grades; SAM 2 gone | `…estimates of how each company's published standard would score the card`; drop SAM 2 |
| S22 | `src/components/DamageReport/DamageReportModal.jsx:381` | d | `F:{item.fray} W:{item.whiteRatio}%` | Debug readout in a user modal | Remove or label ("fray / white ratio, diagnostic") |
| S23 | `src/App.jsx:412`, `CollectionView.jsx:1593,1624` | e | `Raw card values via Cardmarket`, `MARKET VALUE … via Cardmarket` | Prices come from TCGdex's Cardmarket feed (EUR, `src/services/tcgdex.js:308`); no currency shown | `Market value (Cardmarket via TCGdex, EUR)` |
| S24 | `public/studio.html:89,92,121-124` | d | `admin email` placeholder, defaults `PIKACHU V / 2024 POKÉMON x SPONGEBOB / BIKINI BOTTOM PROMO #001` | Internal tool served publicly at `/studio` and `/queue` (`vercel.json`) with sample card text | Out of the native app; keep off screenshots; gate behind auth before load (section A/L) |

Strings checked and found acceptable: `{company} Estimate` (`App.jsx:244`), `Multi-Company Grade Estimation … Analyze cards against TAG grading standards` (`App.jsx:2725-2732`), export footer `Not affiliated with any grading company · Estimate only` (`ExportCard.jsx:250`), copy-text `TAG Estimate: 9 (MINT) … Generated by SlabSense` (`ExportCard.jsx:66-83`), `index.html:10` meta description, `Have SlabSense engrave and ship this card in a slab.` (`CollectionView.jsx:811`), AI prompt forbids grades in its summary (`detectionPrompt.js:312`). No `lorem` text anywhere.

## 2. Disclaimer situation

Where it appears today (grep `not affiliated|estimate`):
- First-run modal `src/App.jsx:2631-2641` ("NOT affiliated … PSA, BGS, CGC, SGC, TAG", "estimates only"), shown once, gated by `localStorage.slabsense_disclaimer_acknowledged` (`App.jsx:1526-1528`). Not re-openable; no link to Terms/Privacy.
- Grade screen: `{company} Estimate` under the number (`App.jsx:244`); page footer `App.jsx:3484` (TAG-only, S12).
- Export PNG footer `ExportCard.jsx:250`; copy-text header "Estimate".
- `index.html:10` meta description; `README.md:7`.
- Missing: pricing page (`PricingPage.jsx`), slab order card (`CollectionView.jsx:798-822`), Stripe checkout (product text lives in the Stripe dashboard, not in code), cert page `public/slabview.html`, engraved label, collection detail, `manifest.json`, store listing (does not exist yet), Terms/Privacy (exist as docs only).

Where it must appear (minimum): (1) first run, re-openable from Settings and linked to Terms/Privacy; (2) every grade result header (all three badges, S15); (3) pricing/IAP sheet: "credits buy AI grade *estimates*"; (4) slab order card and the Stripe product description: "engraved SlabSense pre-grade label, not a third-party grading service"; (5) cert page `slabview.html` (S18); (6) App Store description, first screenshot caption, and the privacy policy page.

## 3. Age rating inputs (App Store Connect questionnaire)

- Cartoon/fantasy violence, realistic violence, sexual content, profanity, horror, alcohol/tobacco/drugs, gambling, contests: **None**. Medical: None. Unrestricted web access: **No** (fixed API endpoints; `/tcgdex-img` proxy only).
- User-generated content: **No** in the 1.2 sense. Users photograph their own cards; collection is private; "Share / Export" (`App.jsx:2954`) makes a local PNG or clipboard text; no feed, comments, profiles or user-to-user sharing (grep `share|community|publish`: none). One caveat: the public cert page (`/v/SS26-nnnnn`) shows the buyer's card photo to anyone with the link, created only after a paid order and after the owner engraves it in the studio queue. State this in Review notes; no moderation tooling is needed beyond the studio's reject path.
- Expected rating: **4+**. Pokémon artwork appears only in the user's own photos and TCGdex reference images (IP handled in section A, 5.2).

## 4. Draft App Store listing

- **Name:** SlabSense (30 max; 9 used).
- **Subtitle (30):** `Pre-grade your Pokémon cards` (28).
- **Promotional text (170):** `Photograph a card, get an estimate of how the major grading scales would score it, and track your collection. Estimates only; not a grading company.` (≈150)
- **Description (≤4000):**
  SlabSense is a pre-grading tool for Pokémon trading cards. Photograph the front and back of a card and SlabSense measures centering, inspects the corners and edges, and lists the surface defects it can see. It turns those measurements into an estimate of how a card like yours would score on the published grading scales of PSA, BGS, CGC, SGC and TAG, with sub-scores so you can see what is holding the card back.
  What you get: an on-device estimate for every card, with centering ratios front and back; a centering tool where you place the card and artwork lines yourself; a defect map showing where corner and edge wear and surface marks were found; a collection with your photos, estimates and market value from Cardmarket (via TCGdex); an export card to share the estimate; and optional AI grades (in-app purchase) that use a vision model to find defects the free pass cannot.
  SlabSense can also engrave a label with your estimate and ship the card back to you in a SlabSense display slab. The label carries a QR code to a page that records the estimate, the measurements and the photos.
  Please read this part: every number SlabSense shows is an estimate produced by software from your photos. SlabSense is an independent tool. It is not a grading company, it does not authenticate cards, and it is not affiliated with, endorsed by or connected to PSA, BGS, CGC, SGC, TAG or any other grading service. A grade from any of those companies can differ from a SlabSense estimate. Do not buy, sell or insure cards on a SlabSense estimate alone. Company names are the trademarks of their owners and are used only to identify the scales being compared. Pokémon is a trademark of Nintendo, Creatures Inc. and GAME FREAK inc.; SlabSense is not affiliated with them.
  Credits for AI grades are sold through Apple in-app purchase; the physical slab is a shipped product paid for separately at checkout. Terms: <URL>. Privacy: <URL>.
  (≈1,950 chars. Add the IAP product names/prices once Phase 2 fixes them; never add a percentage agreement figure unless `scripts/harness/results/` backs it and the sentence says "on our test set".)
- **Keywords (≤100):** `pokemon,card,grading,pre-grade,centering,collection,condition,slab,tcg,corners,edges,estimate` (93). No company names (2.3.7: no other companies' names/trademarks in keywords).
- **Category:** Primary Utilities; secondary Lifestyle. (Not Reference: the app acts, not just informs.)
- **Support URL:** needed; today nothing exists (`slabsenseai.com` has no support/contact page; docs say `[email TBD]`). Propose `https://slabsenseai.com/support` with the email. **Marketing URL:** optional; `https://slabsenseai.com` qualifies once its copy follows this section. **Privacy Policy URL** is mandatory and must be a live page (K-01).
- **What's New (1.0):** `First App Store release. Photograph a Pokémon card to get a pre-grade estimate with centering, corner, edge and surface sub-scores; keep a collection; optional AI grades by in-app purchase. All grades are estimates; SlabSense is not affiliated with any grading company.`
- **Copyright:** `© 2026 <owner's legal name/entity>` (D4 header decision supplies this).

## 5. Screenshot plan

Sizes: iPhone 6.9" (1320×2868, iPhone 16 Pro Max), iPhone 6.5" (1284×2778 or 1242×2688), iPad 13" (2064×2752). Same seven frames, same order, same card (use a real card the owner owns, photographed in the app; not the TAG fixture `src/lib/__fixtures__/C1287305_front_1400.jpg`, which is a scraped TAG studio photo).

| # | Screen (state) | Caption (≤ 1 line) |
|---|---|---|
| 1 | Capture viewfinder with the live card outline, "CARD LOCKED — READY TO SNAP" (`App.jsx:1272`) | `Photograph front and back` |
| 2 | Grade result, Software badge, `TAG Estimate` with subgrade rings (`App.jsx:224-300`) | `An estimate, with the sub-scores behind it` |
| 3 | Centering tool, both lines placed (`PostCaptureCentering.jsx`) | `Centering you can check yourself` |
| 4 | Damage report with defect map (`DamageReportModal.jsx`) | `See where the wear is` |
| 5 | Company selector showing the same card on two scales (`App.jsx:2662`) | `Compare five published scales` |
| 6 | Collection grid with estimates (`CollectionView.jsx`) | `Your collection, your photos` |
| 7 | Export card with the footer `Not affiliated with any grading company · Estimate only` | `Share the estimate` |

Must NOT appear: `PricingPage.jsx` (Stripe USD prices, `SPECIAL OFFER`, `Auto-renews to Hobby ($9.99/mo)`); `CreditBalance` with a balance; `UserMenu` (`Upgrade to Pro`, `Beta Lifetime`); the `v0.1.0-beta` header until S11 is fixed; the 3D viewer if the slab branch is ever re-enabled (S7); `/studio` and its `PIKACHU V / SPONGEBOB` defaults; the cert page until S18 is fixed; any frame with `AI-Enhanced with SAM 2` (S2); the `F:/W:` debug line (S22); TCGdex reference artwork as the hero image (5.2.1: use the user's own photo, which is what `CardViewer3D` already does, `App.jsx:2586`).

## 6. App Review notes (draft)

- **Demo account:** required (sign-in gates collection, AI grades, slab order). Provide `review@slabsenseai.com` / password, pre-loaded with 10 credits and three graded cards in the collection; keep the account on a `beta_lifetime`-style no-charge tier only if that tier still exists after Phase 3 (`api/_lib/credits.js:87` "lifetime - no charge").
- **Testing a grade without a card:** today the only path is the camera or Photos upload (`App.jsx:1231`, accepts JPG/PNG/WebP/HEIC, 25 MB max). Ship a "Try a sample card" entry on the capture screen that loads a bundled front+back pair, or attach the pair to the review notes. Gap: the repo has only a front fixture (`src/lib/__fixtures__/C1287305_front_1400.jpg`, a TAG studio shot) and no back; a licensed/owner-shot pair is needed.
- **Free vs paid:** the free Software grade runs on the device (optional 110 MB model download, Settings toggle `ProfileSettings.jsx:273-293`). "AI Grade" (1 credit) and "Deep AI Grade" (2 credits, `src/lib/grade-tiers.js`) send the two photos to a hosted vision model and return defects, sub-scores and an estimate; credits are consumed server-side and refunded on failure (`api/_lib/credits.js:190`). State the IAP product ids once created.
- **Permissions:** Camera, to photograph the card (`App.jsx:950` getUserMedia; native plugin after D6). Motion/orientation (`DeviceOrientationEvent.requestPermission`, `App.jsx:1015-1026`, `src/lib/gyro-input.js:72`), used for the level indicator while shooting and the tilt effect on the logo/holo preview; no motion data leaves the device. Photos library, to pick an existing photo. Nothing runs in the background.
- **Physical goods:** "Get it slabbed" (`CollectionView.jsx:818`) opens a Stripe Checkout for an engraved display slab shipped to a US address (`api/_lib/slabs.js:17`); this is a physical good under 3.1.3(e), paid outside IAP by design. Digital credits are not sold through Stripe in the app (section B must make this true before submission).
- **Public cert page:** each shipped slab's QR opens `slabsenseai.com/v/<cert>`, a read-only page of the buyer's own estimate and photos; no user-to-user content.
- **Photos leave the device** only when the user starts a paid AI grade (sent to the AI provider) and when a card is saved to the collection or ordered as a slab (Supabase storage). Cross-reference the privacy policy page.

## 7. Cert page and QR label: claims on them

- `public/slabview.html` + `public/slab/slabview.js:135-147`: title `SlabSense <cert> — <card>`, big grade number + designation word, `Subgrades`, `Centering`, `Defects found`, `Images`, `Cert` (paid/engraved/shipped dates), status pill `Paid — awaiting engraving / Engraved — awaiting shipping / Shipped`. It makes no explicit grading-company claim, but nothing on it says estimate, pre-grade, or not affiliated; the structure (cert number, subgrades, defect list) mirrors a company cert lookup (S18).
- `api/_lib/routes/slab-get.js`: public read of `slab_public` by cert (`^[A-Z]{2,4}\d{2}-\d{5}$`), 60 s cache, no user data. No claims; fine.
- Label (`public/slab/label.js`): wordmark, card lines, `SS26-nnnnn`, QR to `slabsenseai.com/v/<cert>`, grade number and designation word drawn from a PSA/BGS/TAG-style vocabulary list (`GRADES`, S19). No "estimate" anywhere on the engraved surface.
- `docs/DISCLAIMERS.md` says SlabSense "does NOT provide official grades" and "does not authenticate"; the slab and cert page should say the same in one line.

## 8. Findings

| ID | Severity | file:line | Guideline | Evidence | Proposed fix |
|---|---|---|---|---|---|
| K-01 | Blocker | `docs/TERMS_OF_SERVICE.md`, `docs/PRIVACY_POLICY.md`, `docs/DISCLAIMERS.md`; `AuthModal.jsx:240`; `vercel.json` | 5.1.1(i) privacy policy link in app and in App Store Connect; 2.3 | Legal docs exist only as Markdown in the repo, dated April 2025, with `[email TBD]` placeholders; the sign-up screen cites them without a link; no route serves them | Finalise contact/date, publish `/terms`, `/privacy`, `/disclaimer` pages, link from sign-up, Settings and the disclaimer modal, enter the privacy URL in App Store Connect |
| K-02 | Blocker | `public/manifest.json:2-4` | 2.3.1/2.3.8 accurate metadata; 5.2.1 use of another company's name | Product named `TAG Pre-Grader`, "using TAG grading criteria" | S1 rewrite; make the native app name/bundle display name `SlabSense` (D5) |
| K-03 | Blocker | `src/App.jsx:2605` | 2.3.1 (misleading description of functionality) | Claims SAM 2 and "Perfect edges"; SAM 2 not used (`grep -ri sam api/` empty) | S2 rewrite or remove |
| K-04 | Major | `src/components/CardViewer/RealisticSlab.jsx` (whole file), `CardViewer3D.jsx:123-141,189-200` | 5.2.1 (third-party trademarks/branding), 5.2.5 (imitating a company's product), 2.3 | Company-branded slab labels and random cert numbers; unreachable today but bundled | Delete the component and the `slab` branch; grep for `generateCertNumber` afterwards |
| K-05 | Major | `DefectList.jsx:35` | 2.3.1; FTC-style outcome claim | "potential Gem Mint candidate" | S3 |
| K-06 | Major | `App.jsx:248`; `GradeResultDisplay.jsx:382`; `CollectionView.jsx:1422` | 5.2.1 implied affiliation | "TAG Score … / 1000", "TAG 1000-Point" present our score as TAG's | S4, S5 |
| K-07 | Major | `DamageReportModal.jsx:157,172` and every `DINGS` string | 5.2.1 | TAG report vocabulary and its expansion used as the app's own terminology | S6 |
| K-08 | Major | `public/slabview.html`, `public/slab/label.js:8-11` | 2.3; 5.2.5; FTC honesty (secondary-market confusion) | Cert page and engraved label carry no estimate / not-affiliated statement; label uses company designation words | S18 on the page (code change, small); S19 on the label (owner decision) |
| K-09 | Major | `UserMenu.jsx:156,176`; `UserMenu.jsx:25-27` vs `credits.js:143-146` | 2.1 (placeholder/non-functional UI), 2.3 | `Upgrade to Pro` does nothing; tier labels do not match the plans sold | S10; resolve with section B's entitlement model |
| K-10 | Major | `App.jsx:36,2659`; `package.json:4` | 2.3 (apps labelled beta/demo/trial are not accepted on the App Store; use TestFlight) | `v0.1.0-beta` visible in the header | S11 |
| K-11 | Major | `App.jsx:1526-1528,2631-2641` | 2.3; FTC clear-and-conspicuous disclosure | Disclaimer shown once, keyed on `localStorage`, never re-openable, no Terms/Privacy link; in a native shell storage can be cleared and the modal re-fires, or never fires if migrated | Show on first run per account, add "Disclaimer" entry in Settings, link legal pages |
| K-12 | Major | `PricingPage.jsx` (whole), `credits.js:143-157` | 2.3.1 + 3.1.1 (metadata/screenshots must match the IAP in the build) | Stripe USD plans and "Auto-renews to Hobby ($9.99/mo)" copy; must not appear in screenshots or description until B replaces them | Screenshot exclusion list (section 5); rewrite copy with the IAP products |
| K-13 | Minor | `App.jsx:3484` | 2.3 | Footer disclaims TAG only | S12 |
| K-14 | Minor | `ProfileSettings.jsx:291` | 5.2.1 | "TAG-trained models" | S13 |
| K-15 | Minor | `CollectionView.jsx:1562` | 2.3 | "GRADER NOTES" implies a human grader | S14 |
| K-16 | Minor | `GradeResultDisplay.jsx:11-13` | 2.3 | `SOFTWARE` badge lacks "estimate" | S15 |
| K-17 | Minor | `gradingScales.js:43-47`, `DISCLAIMERS.md` Trademark Notice | 5.2.1 (correct attribution) | Company full names/owners inconsistent (TAG expands two ways) | S16 |
| K-18 | Minor | `DISCLAIMERS.md` Trading Card Games | 2.3 | Lists games the app does not handle | S17 |
| K-19 | Minor | `api/stripe/create-checkout.js:148-149` | 2.1 | Fallback to `slabsense.com/billing` (stale domain, missing route) | S20 |
| K-20 | Minor | `README.md:1-30` | 2.3 (public-facing copy if the repo is public), 5.2.1 | "accurate grading", "Get PSA… grades", "SAM 2" | S21 |
| K-21 | Minor | `DamageReportModal.jsx:381` | 2.1 placeholder/debug UI | `F:… W:…%` readout | S22 |
| K-22 | Minor | `App.jsx:412`; `CollectionView.jsx:1593-1624` | 2.3; third-party data attribution | Cardmarket values shown without currency or TCGdex attribution | S23 |
| K-23 | Note | `public/studio.html`, `vercel.json` `/studio`, `/queue` | n/a (web only) | Internal engraving tool on the public domain with placeholder defaults; must not be reachable from or shown in the native app | Hand to sections A and L |
| K-24 | Note | `src/lib/__fixtures__/C1287305_front_1400.jpg`, `scripts/harness/README.md:11` | 5.2.1 | Only sample photo is a scraped TAG studio shot; unusable in screenshots or as the reviewer sample | Owner shoots a sample pair |
| K-25 | Note | `docs/PRIVACY_POLICY.md` Data Sharing | 5.1.2 | Says sharing only with hosting/payment providers; paid grades send photos to an AI provider (`api/_providers/index.js:173-177`) | Section A finding; wording lands in the published privacy page (K-01) |
| K-26 | Note | `src/components/Grading/backup/` | housekeeping | Backup copy of a component shipped in `src/` | Section M ledger |
| K-27 | Note | store listing, support/marketing URLs | 2.3 | None of these exist yet; drafts in sections 4-6 above | Owner confirms name, URLs, copyright line (D4/D5) before Phase 4 |
