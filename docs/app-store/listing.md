# App Store listing, privacy labels, review notes (3h)

Drafted 2026-10-02 from audit parts F, I and K. Everything here is what goes into App Store
Connect; the owner confirms the items marked **OWNER** before Phase 4. No number in this
document claims accuracy; the measured figures live in `docs/GRADING_SYSTEM.md` ("Paid path
accuracy, measured") and may be quoted only with "on our test set".

## 1. Product page

| Field | Value | Limit |
|---|---|---|
| Name | SlabSense | 30 |
| Subtitle | Pre-grade your Pokémon cards | 30 |
| Promotional text | Photograph a card, get an estimate of how the major grading scales would score it, and keep your collection. Estimates only; SlabSense is not a grading company. | 170 |
| Category | Primary: Utilities. Secondary: Lifestyle. | |
| Keywords | pokemon,card,grading,pre-grade,centering,collection,condition,slab,tcg,corners,edges,estimate | 100 (no company names, guideline 2.3.7) |
| Support URL | https://www.slabsenseai.com/support | live page, `docs/legal/SUPPORT.md` |
| Marketing URL | https://www.slabsenseai.com | optional |
| Privacy Policy URL | https://www.slabsenseai.com/privacy | mandatory, live |
| Copyright | © 2026 **OWNER: legal name or entity** | |
| Age rating | 4+ (see §4) | |

**Description** (about 2,100 characters):

> SlabSense is a pre-grading tool for Pokémon trading cards. Photograph the front and back of a card and SlabSense measures centering, inspects the corners and edges, and lists the surface defects it can see. It turns those measurements into an estimate of how a card like yours would score on the published grading scales of PSA, BGS, CGC, SGC and TAG, with sub-scores so you can see what is holding the card back.
>
> What you get for free: a live viewfinder that outlines the card and snaps when it is steady; a centering tool where you place the card and artwork lines yourself, with the lines pre-placed for you; an on-device estimate for every card, with centering ratios front and back; a defect map showing where corner and edge wear was found; a collection with your photos, estimates and market value (Cardmarket, via TCGdex); and an export card to share the estimate.
>
> AI Grade (in-app purchase, one credit per card): a vision model inspects the full-resolution surface of both sides for scratches, print lines, creases and whitening, compares the card against professionally graded reference photos, and returns a written report with sub-scores. Free accounts get 10 on-device grades a month. SlabSense Plus ($9.99/month after a 5-day free trial) gives unlimited grades and 5 AI Grades a month; packs of 5 or 20 AI Grades never expire.
>
> SlabSense can also engrave a label with your estimate and ship the card back to you in a SlabSense display slab. The label carries a QR code to a page that records the estimate, the measurements and the photos.
>
> Please read this part: every number SlabSense shows is an estimate produced by software from your photos. SlabSense is an independent tool. It is not a grading company, it does not authenticate cards, and it is not affiliated with, endorsed by or connected to PSA, BGS, CGC, SGC, TAG or any other grading service. A grade from any of those companies can differ from a SlabSense estimate. Do not buy, sell or insure cards on a SlabSense estimate alone. Company names are the trademarks of their owners and are used only to identify the scales being compared. Pokémon is a trademark of Nintendo, Creatures Inc. and GAME FREAK inc.; SlabSense is not affiliated with them.
>
> Terms: https://www.slabsenseai.com/terms · Privacy: https://www.slabsenseai.com/privacy

**What's New (1.0):** First App Store release. Photograph a Pokémon card to get a pre-grade estimate with centering, corner, edge and surface sub-scores; keep a collection; optional AI Grades by in-app purchase. All grades are estimates; SlabSense is not affiliated with any grading company.

## 2. In-app purchases (App Store Connect → Monetization)

Product ids and names come from `src/lib/products.js` and must not change once created. Prices are
**OWNER** decisions (the numbers below are the web defaults in the code).

| Reference name | Product id | Type | Display name | Description (≤ 45 for the review note; full in-app) | Web default |
|---|---|---|---|---|---|
| SlabSense Plus monthly | `com.slabsense.app.plus.monthly` | Auto-renewable, group "SlabSense Plus" | SlabSense Plus | Unlimited grades and 5 AI Grades every month. Unused AI Grades expire at the end of the period. Introductory offer: 5-day free trial (includes 2 AI Grades). | $9.99 / month |
| 5 AI Grades | `com.slabsense.app.grades.5` | Consumable | 5 AI Grades | Five AI Grade credits that never expire. | $4.99 |
| 20 AI Grades | `com.slabsense.app.grades.20` | Consumable | 20 AI Grades | Twenty AI Grade credits that never expire. | $14.99 |

Each IAP needs one screenshot of the store screen in the app (`NativeStore.jsx`) and a review
note: "One credit = one AI Grade of one card. The free estimate stays free."

Server notifications V2 URL: `https://www.slabsenseai.com/api/apple?action=notifications`
(production and sandbox). Environment variables on Vercel: `APPLE_APP_APPLE_ID`,
`APPLE_ENVIRONMENT`.

## 3. App Privacy (nutrition labels)

Source: audit part F §3, re-checked 2026-10-02 after fix groups 3a–3c. Tracking: **No** (no
IDFA, no ad SDK, no analytics SDK, no ATT prompt).

| Data type | Collected | Linked to the user | Purpose(s) | Where |
|---|---|---|---|---|
| Email address | Yes | Yes | App functionality (account) | Supabase auth, Stripe customer |
| Name | Yes | Yes | App functionality | display name; shipping name on slab orders |
| Physical address | Yes (slab orders only) | Yes | App functionality (shipping) | Stripe-collected, stored with the order |
| Photos | Yes | Yes | App functionality; **Product personalisation / model training only with the in-app opt-in** | `card-images` bucket under the user id; sent to Anthropic only for a paid AI Grade |
| Other user content | Yes | Yes | App functionality | centering lines, crops, grades, notes, card ids |
| User ID | Yes | Yes | App functionality | Supabase uuid, Stripe customer id, Apple app account token |
| Purchase history | Yes | Yes | App functionality | credit ledger, Apple transactions, Stripe events, slab orders |
| Product interaction | Yes | Yes | Analytics (first-party only, to improve identification) | `card_identifications`, grade jobs |
| Device ID, location, contacts, health, financial info, browsing/search history, crash data, performance data, advertising data | No | | | Payment card details never touch the app. Motion data is used live and never stored. |

Third parties that receive data (already named in the privacy policy): Supabase, Vercel,
Anthropic (paid grades only), Stripe (web and slab payments), Apple (in-app purchase), TCGdex
(card lookups). Note for the owner: Vercel and Supabase request logs hold IP addresses; Apple
lets this go undeclared when it is not used for tracking or shared, which is the case.

## 4. Age rating questionnaire

None for: cartoon or fantasy violence, realistic violence, sexual content or nudity, profanity or
crude humour, horror or fear themes, alcohol, tobacco or drug use, gambling, contests, medical or
treatment information. Unrestricted web access: No. Gambling and contests: No.
User-generated content: No in the guideline 1.2 sense (no feed, comments, profiles or
user-to-user sharing; the public cert page shows the buyer's own slab after a paid order and the
studio's approval). Expected rating: **4+**.

## 5. App Review notes

> **Demo account:** `review@slabsenseai.com` / **OWNER: password** — pre-loaded with 10 AI Grade credits and three graded cards in the collection. (OWNER: create this account on Supabase; give it credits with `grant_credits` and external id `review:seed`.)
>
> **Trying the app without a card:** on the Scan tab, tap "Choose a photo" and use the two sample images attached to this submission (front and back of a Pokémon card photographed by us). Or photograph any trading card.
>
> **Free and paid:** the estimate on every card is free and runs on the device. "AI Grade" costs one credit; it sends the two photos to our server, which uses a hosted vision model (Anthropic) to inspect the surface and write a report. Credits come from the in-app purchases listed above; they are consumed server-side and refunded automatically if the grade fails.
>
> **Permissions:** Camera — to photograph the card and show the live card outline. Motion — a level indicator while framing, never stored. Photo library — only when the user chooses an existing photo. Nothing runs in the background. No tracking.
>
> **Physical goods:** "Get it slabbed" orders an engraved display slab shipped to a US address; it is a physical product paid through Stripe Checkout (guideline 3.1.3(e)). No digital good is sold outside in-app purchase.
>
> **Public cert page:** each shipped slab's QR code opens a read-only page of the buyer's own estimate and photos. It is created only after a paid order and the owner's approval in our studio; there is no user-to-user content.
>
> **Estimates:** every grade is a software estimate; the app says so on first run, on every result and in the listing. SlabSense is not affiliated with any grading company.

## 6. Screenshots

Sizes: iPhone 6.9" (1320 × 2868), iPhone 6.5" (1284 × 2778), iPad 13" (2064 × 2752). Same seven
frames in the same order, one real card the owner owns, photographed in the app. Never use the
TAG fixture under `src/lib/__fixtures__` (a scraped studio photo) or TCGdex artwork as the hero.

| # | Screen | Caption |
|---|---|---|
| 1 | Viewfinder with the live outline and "card locked" | Photograph front and back |
| 2 | Grade result with the ESTIMATE badge and sub-score rings | An estimate, with the sub-scores behind it |
| 3 | Centering tool with both lines placed | Centering you can check yourself |
| 4 | Damage report with the defect map | See where the wear is |
| 5 | Company selector, same card on two scales | Compare five published scales |
| 6 | Collection grid | Your collection, your photos |
| 7 | Export card with the footer "Not affiliated with any grading company · Estimate only" | Share the estimate |

Must not appear: any Stripe or USD text, the credit balance chip with a balance, the studio
pages, the cert page, debug readouts.

## 7. Permission strings

`docs/legal/ios-purpose-strings.md` (camera, photo library, photo library add, motion).

## 8. Owner checklist before Phase 4

- [ ] Final prices for the three products; update `products.js` `webPrice` to match
- [ ] Copyright line (legal name or entity)
- [ ] Confirm `support@slabsenseai.com` is a real mailbox (used on /support, /privacy, /terms)
- [ ] Create the demo account and seed it
- [ ] Shoot the sample front/back pair and the screenshot card
- [ ] Bundle id `com.slabsense.app`, display name SlabSense, App Store Connect app record
