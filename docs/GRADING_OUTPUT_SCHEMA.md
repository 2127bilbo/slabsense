# SLABSENSE GRADING OUTPUT SCHEMA — CANONICAL REFERENCE
**Version 1.0 | The single JSON contract for ALL grading output.**

> **What this is:** The exact JSON structure that ALL THREE grading paths must emit:
> Software Grade (`computeGrade()` in `src/App.jsx`), AI Grade
> (`api/ai-analyze-unified.js`), and Deep AI Grade (`api/deep-analyze-v2.js`).
> The schema is identical regardless of path — what differs per product tier is only
> which fields the UI DISPLAYS, never which fields exist.
>
> **Where it lives:** Project root `/docs/GRADING_OUTPUT_SCHEMA.md`
>
> **What it does:** Defines every field, its type, whether it's nullable, and the
> validation invariants. AI prompts must request this exact JSON. UI components must
> read these exact keys. If any producer or consumer disagrees with this file, the
> producer/consumer is wrong.
>
> **Companion docs:** `GRADING_SCALE.md` (all scoring math), `COMPANY_OFFSETS.md`
> (how company grades are derived), `COORDINATE_MAPPING.md` (zone/coordinate systems).

---

## 1. TOP-LEVEL STRUCTURE

```json
{
  "schemaVersion": "1.0",
  "gradedAt": "2026-06-11T14:32:00Z",
  "gradePath": "software",
  "cardInfo": { ... },
  "imageQuality": { ... },
  "centering": { ... },
  "defects": { ... },
  "subgrades": { ... },
  "overall": { ... },
  "companyGrades": { ... },
  "summary": { ... },
  "confidence": { ... },
  "meta": { ... }
}
```

| Field | Type | Notes |
|-------|------|-------|
| `schemaVersion` | string | Always matches this doc's version |
| `gradedAt` | string (ISO 8601) | When the grade was produced |
| `gradePath` | string enum | `"software"` \| `"ai"` \| `"deep"` |

---

## 2. `cardInfo`

```json
{
  "name": "Charizard",
  "setName": "Base Set",
  "cardNumber": "4/102",
  "rarity": "Holo Rare",
  "year": "1999",
  "hp": "120",
  "variant": null,
  "language": "English",
  "cardGame": "pokemon",
  "cardType": "modern_holo"
}
```

All strings; unknown values are `null` (never empty string, never "unknown").
Software Grade cannot identify cards — it emits all-null `cardInfo` except
`cardGame`/`cardType` passed from the client.

---

## 3. `imageQuality`

```json
{
  "front": { "glareLevel": "minor", "blurLevel": "none", "glareLocations": ["TOP RIGHT"] },
  "back":  { "glareLevel": "none",  "blurLevel": "none", "glareLocations": [] },
  "overall": "good",
  "warning": null
}
```

| Field | Type | Allowed Values |
|-------|------|----------------|
| `glareLevel` | string | `"none"` \| `"minor"` \| `"moderate"` \| `"severe"` |
| `blurLevel` | string | `"none"` \| `"minor"` \| `"moderate"` \| `"severe"` |
| `glareLocations` | string[] | Location labels (see §5 `location`) |
| `overall` | string | `"excellent"` \| `"good"` \| `"fair"` \| `"poor"` |
| `warning` | string \| null | Human-readable message, e.g. "Heavy flash on corners — retake photo for an accurate grade" |

---

## 4. `centering`

Always from the user's manual centering tool. **No grading path ever estimates these.**
Deviation = `|ratio − 50|` per `GRADING_SCALE.md` §2.

```json
{
  "source": "manual",
  "front": { "lrRatio": 52.0, "tbRatio": 50.5, "devLR": 2.0, "devTB": 0.5, "maxDev": 2.0 },
  "back":  { "lrRatio": 54.0, "tbRatio": 51.0, "devLR": 4.0, "devTB": 1.0, "maxDev": 4.0 }
}
```

| Field | Type | Notes |
|-------|------|-------|
| `source` | string | Always `"manual"` for now; reserved: `"auto"` |
| `lrRatio` / `tbRatio` | number | Left/top percentage, one decimal (52.0 means 52/48) |
| `devLR` / `devTB` | number | `|ratio − 50|` |
| `maxDev` | number | `max(devLR, devTB)` — drives the centering score |

`back` is `null` only if the user graded front-only.

---

## 5. `defects`

```json
{
  "counts": { "total": 3, "corner": 1, "edge": 1, "surface": 1,
              "frontTotal": 2, "backTotal": 1 },
  "items": [
    {
      "id": "d1",
      "side": "FRONT",
      "category": "CORNER",
      "type": "CORNER",
      "severity": "minor",
      "location": "TOP LEFT",
      "zone": 5,
      "x": 8.0, "y": 7.0, "width": 5.0, "height": 5.0,
      "deduction": 4.0,
      "description": "Light whitening at corner tip"
    }
  ]
}
```

| Field | Type | Allowed Values / Notes |
|-------|------|------------------------|
| `id` | string | `"d1"`, `"d2"`, ... unique within report |
| `side` | string | `"FRONT"` \| `"BACK"` (uppercase, exact) |
| `category` | string | `"CORNER"` \| `"EDGE"` \| `"SURFACE"` — which subgrade it deducts from |
| `type` | string | Deduction type key from `GRADING_SCALE.md` §3.1: `CORNER`, `EDGE`, `SCRATCH`, `DENT`, `PRINT_DEFECT`, `CREASE`, `PLAY_WEAR`, `PIT`, `STAIN`, `TEAR` |
| `severity` | string | `"minor"` \| `"moderate"` \| `"severe"` \| `"extreme"` (lowercase, exact) |
| `location` | string | `TOP LEFT`, `TOP RIGHT`, `BOTTOM LEFT`, `BOTTOM RIGHT`, `TOP EDGE`, `BOTTOM EDGE`, `LEFT EDGE`, `RIGHT EDGE`, `TOP CENTER`, `MIDDLE LEFT`, `MIDDLE CENTER`, `MIDDLE RIGHT`, `BOTTOM CENTER` |
| `zone` | integer \| null | 0–5 via `getZone()` (see `COORDINATE_MAPPING.md`). Location reference ONLY — never a scoring weight |
| `x`, `y` | number | Defect center as % of card (0–100), origin top-left |
| `width`, `height` | number | Approximate extent as % of card |
| `deduction` | number | Final computed deduction (after severity, side, diminishing) per `GRADING_SCALE.md` §3 |
| `description` | string | One short sentence, human-readable |

**Rules:**
- EVERY defect found is listed — no early stopping, no "grade already capped" omissions.
- Surface defect types (`SCRATCH`, `DENT`, `PRINT_DEFECT`, `CREASE`, `PLAY_WEAR`, `PIT`, `STAIN`, `TEAR`) all use `category: "SURFACE"`.
- Glare is never a defect item.

---

## 6. `subgrades`

All eight, 0–100 scale, exactly these keys (`GRADING_SCALE.md` §1):

```json
{
  "frontCentering": 97.0,
  "backCentering": 97.0,
  "frontCorners": 96.0,
  "backCorners": 100.0,
  "frontEdges": 95.0,
  "backEdges": 100.0,
  "frontSurface": 97.5,
  "backSurface": 98.25
}
```

Numbers, one or two decimals, floor 10, ceiling 100. Front-only grading: back keys are `null`.

---

## 7. `overall`

```json
{
  "score": 95.6,
  "grade": 10,
  "label": "Gem Mint",
  "displayGrade": "10",
  "capsApplied": [],
  "minSubgrade": { "key": "frontEdges", "value": 95.0 }
}
```

| Field | Type | Notes |
|-------|------|-------|
| `score` | number | 0–100, output of compounding formula + caps (`GRADING_SCALE.md` §4–5) |
| `grade` | number | Numeric TAG-baseline grade: 1–10 (10P encoded as `grade: 10` + `label: "Pristine"`) |
| `label` | string | From `GRADING_SCALE.md` §6 table |
| `displayGrade` | string | `"10P"`, `"10"`, `"9"`, `"8.5"`, ... what the UI shows |
| `capsApplied` | string[] | e.g. `["CREASE_CAP_6", "DEFECT_COUNT_CAP_8.5"]`; empty if none |
| `minSubgrade` | object | The lowest subgrade and which key it was |

**Invariant:** `grade ≤ grade(minSubgrade.value)`. Assert in code.

---

## 8. `companyGrades`

Derived from the SAME 8 subgrades via each company's combination rule
(`COMPANY_OFFSETS.md`). TAG is the baseline and always equals `overall`.

```json
{
  "tag": { "grade": 10,  "label": "Gem Mint", "score": 956, "displayGrade": "10" },
  "psa": { "grade": 9,   "label": "Mint",      "displayGrade": "9" },
  "bgs": { "grade": 9.5, "label": "Gem Mint",  "displayGrade": "9.5",
           "subgrades": { "centering": 9.5, "corners": 9.5, "edges": 9.5, "surface": 9.5 } },
  "cgc": { "grade": 9.5, "label": "Mint+",     "displayGrade": "9.5" },
  "sgc": { "grade": 9.5, "label": "Mint+",     "displayGrade": "9.5" }
}
```

- `tag.score` is the 1000-point value (`overall.score × 10`, rounded).
- `bgs.subgrades` are BGS's four 1–10 subgrades (their scale, not ours).
- Grades snap DOWN to each company's allowed-grade list (`GRADING_SCALE.md` §6).

---

## 9. `summary`

```json
{
  "positives": ["Sharp corners on the back", "Strong front centering"],
  "concerns": ["Light edge whitening top edge front", "Moderate glare limited surface read"],
  "recommendation": "Solid Gem Mint candidate at TAG; PSA likely 9 due to corner touch."
}
```

Software Grade fills these from templated strings; AI paths write them naturally.
Never empty arrays — at minimum one item each.

---

## 10. `confidence`

```json
{
  "value": 0.85,
  "factors": [
    { "factor": "minor glare front top-right", "impact": -0.05 },
    { "factor": "manual centering provided", "impact": 0.0 }
  ]
}
```

| Value | Meaning |
|-------|---------|
| 0.90–1.00 | Clean photos, high certainty |
| 0.75–0.89 | Minor glare/blur, still accurate |
| 0.60–0.74 | Moderate glare obscuring some areas |
| 0.40–0.59 | Significant glare, low certainty |
| < 0.40 | Cannot reliably grade — UI should push a retake |

---

## 11. `meta`

```json
{
  "gradePath": "deep",
  "model": "claude-sonnet-4-20250514",
  "gradeMode": "single",
  "primaryProvider": "claude",
  "secondaryProvider": null,
  "synthesizerProvider": null,
  "referencesUsed": 7,
  "referenceGrades": ["10", "9", "9", "8.5"],
  "elapsedMs": 14250,
  "engineVersion": "1.0"
}
```

Software path: `model`/providers/references are `null`, `gradeMode` is `null`.
AI path: providers/references `null` unless used. `engineVersion` tracks
`GRADING_SCALE.md` version used for the math.

---

## 12. PER-TIER VISIBILITY (UI concern, NOT schema concern)

All paths emit the FULL schema. The UI hides fields by tier:

| Field | Software | AI | Deep |
|-------|----------|----|------|
| overall, companyGrades, confidence | ✅ | ✅ | ✅ |
| subgrades (8) | ✅ | ✅ | ✅ |
| defects.items w/ coordinates | ✅ | ✅ | ✅ |
| cardInfo (identification) | — (null) | ✅ | ✅ |
| summary (natural language) | templated | ✅ | ✅ |
| meta.references* | — | — | ✅ |

(Adjust this table as product tiers are finalized — but adjust DISPLAY, never the schema.)

---

## 13. VALIDATION INVARIANTS (assert in code on every grade)

1. All 8 subgrade keys present (back keys may be null only in front-only mode).
2. `overall.grade ≤ grade(min(subgrades))`.
3. Every `defects.items[].type` ∈ allowed type keys; `severity` ∈ allowed severities.
4. `counts.total === items.length` (excluding nothing — centering is never a defect item).
5. `companyGrades.tag.grade === overall.grade`.
6. Every company grade ∈ that company's allowed-grade list.
7. `confidence.value` ∈ [0, 1].
8. `centering.source === "manual"` (until auto-centering ships).
9. No key renames, no extra top-level keys, no missing top-level keys.

---

## 14. CHANGE LOG
- **v1.0** — Initial unified schema. Replaces the divergent outputs of
  `computeGrade()`, `ai-analyze-unified.js`, and `deep-analyze-v2.js`.
