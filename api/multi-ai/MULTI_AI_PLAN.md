# Multi-AI Provider Architecture Plan

**Created:** June 10, 2026
**Status:** IN PROGRESS - Building staging files
**Last Updated:** June 10, 2026

---

## Overview

This folder contains everything needed to implement multi-provider AI grading. When ready to deploy, simply move existing api files to backup and replace with these edited versions.

---

## Folder Structure

```
api/multi-ai/
├── MULTI_AI_PLAN.md          # This file - master documentation
├── originals/                 # Unmodified copies of files being changed
│   ├── deep-analyze-v2.js
│   ├── ai-analyze.js
│   ├── ai-analyze-direct.js
│   ├── analyze-card.js
│   ├── extract-card-info.js
│   └── api.js                 # Frontend service (src/services/api.js)
├── merged/                    # Consolidated endpoints (frees Vercel slots)
│   ├── ai-analyze-unified.js  # Merges ai-analyze.js + ai-analyze-direct.js
│   └── card-info-unified.js   # Merges analyze-card.js + extract-card-info.js
├── providers/                 # Provider abstraction layer
│   ├── index.js               # Main selector + unified interface
│   ├── anthropic.js           # Claude implementation
│   ├── google.js              # Gemini implementation
│   ├── openai.js              # GPT implementation
│   └── xai.js                 # Grok implementation (OpenAI-compatible)
├── deep-analyze-v2.js         # EDITED - Multi-provider deep grading
└── api.js                     # EDITED - Frontend service with provider selection
```

---

## Vercel Function Count

### Before (11/12 slots used):
| # | Function | Status |
|---|----------|--------|
| 1 | ai-analyze.js | MERGE → ai-analyze-unified.js |
| 2 | ai-analyze-direct.js | MERGE → ai-analyze-unified.js |
| 3 | deep-analyze-v2.js | EDIT for multi-provider |
| 4 | analyze-card.js | MERGE → card-info-unified.js |
| 5 | extract-card-info.js | MERGE → card-info-unified.js |
| 6 | stripe/webhook.js | UNCHANGED |
| 7 | stripe/create-checkout.js | UNCHANGED |
| 8 | stripe/create-portal.js | UNCHANGED |
| 9 | credits/balance.js | UNCHANGED |
| 10 | credits/spend.js | UNCHANGED |
| 11 | credits/refund.js | UNCHANGED |

### After (9/12 slots used):
| # | Function | Notes |
|---|----------|-------|
| 1 | ai-analyze-unified.js | Replaces ai-analyze.js + ai-analyze-direct.js |
| 2 | deep-analyze-v2.js | Multi-provider enabled |
| 3 | card-info-unified.js | Replaces analyze-card.js + extract-card-info.js |
| 4 | stripe/webhook.js | UNCHANGED |
| 5 | stripe/create-checkout.js | UNCHANGED |
| 6 | stripe/create-portal.js | UNCHANGED |
| 7 | credits/balance.js | UNCHANGED |
| 8 | credits/spend.js | UNCHANGED |
| 9 | credits/refund.js | UNCHANGED |

**Slots freed: 2** (available for future features)

---

## Multi-Provider Modes

### Mode 1: Single Provider (Default - Current Behavior)
```
Images → [Claude OR Gemini OR GPT] → Grade Result
```

### Mode 2: Parallel + Average
```
Images → [Claude] ──┐
                    ├→ Average Results → Final Grade
Images → [Gemini] ──┘
```

### Mode 3: Sequential Validation
```
Images → [Claude Pass 1+2] → Assessment
                               ↓
              [Gemini] validates + adjusts → Final Grade
```

### Mode 4: Parallel + Synthesizer
```
Images → [Claude] ──┐
                    ├→ [GPT text-only synthesizer] → Final Grade
Images → [Gemini] ──┘
```

---

## Environment Variables

### Current (keep these):
```env
ANTHROPIC_API_KEY=sk-ant-...
```

### New (add when ready):
```env
GOOGLE_AI_API_KEY=AIza...
OPENAI_API_KEY=sk-...
XAI_API_KEY=xai-...
```

---

## Cost Analysis

| Mode | Providers | Est. Cost | Latency |
|------|-----------|-----------|---------|
| Single (current) | Claude only | ~$0.05 | ~3-5s |
| Single | Gemini only | ~$0.03 | ~2-4s |
| Parallel | Claude + Gemini | ~$0.08 | ~4-6s |
| Sequential | Claude → Gemini | ~$0.08 | ~6-10s |
| Synthesize | Claude + Gemini → GPT | ~$0.10 | ~7-12s |

---

## Implementation Checklist

### Phase 1: File Preparation
- [x] Create folder structure
- [x] Create this plan document
- [x] Copy originals/deep-analyze-v2.js
- [x] Copy originals/ai-analyze.js
- [x] Copy originals/ai-analyze-direct.js
- [x] Copy originals/analyze-card.js
- [x] Copy originals/extract-card-info.js
- [x] Copy originals/api.js (from src/services/)

### Phase 2: Merged Endpoints
- [x] Create merged/ai-analyze-unified.js
- [x] Create merged/card-info-unified.js
- [ ] Test merged endpoints work identically

### Phase 3: Provider Abstraction
- [x] Create providers/index.js (main interface)
- [x] Create providers/anthropic.js (Claude)
- [x] Create providers/google.js (Gemini)
- [x] Create providers/openai.js (GPT)
- [x] Create providers/xai.js (Grok)

### Phase 4: Multi-Provider Integration
- [x] Edit deep-analyze-v2.js for multi-provider
- [x] Edit api.js for provider selection (uses unified endpoints)
- [x] Create ai-config.json (admin-only config)

### Phase 5: Testing (Before Deployment)
- [ ] Test single-provider Claude (existing behavior)
- [ ] Test single-provider Gemini
- [ ] Test parallel mode
- [ ] Test sequential mode
- [ ] Test synthesize mode

### Phase 6: Deployment
- [ ] Move current api/*.js to api/backup/
- [ ] Copy edited files from multi-ai/ to api/
- [ ] Copy providers/ folder to api/
- [ ] Update frontend to use new endpoints
- [ ] Add new env vars to Vercel
- [ ] Deploy and verify

---

## Configuration Strategy (Admin-Only)

**Decision:** Provider selection is ADMIN-ONLY via JSON config file.

### Config File: `api/multi-ai/ai-config.json`

```json
{
  "gradeMode": "single",
  "primaryProvider": "claude",
  "secondaryProvider": null,
  "synthesizerProvider": null,
  "fallbackProvider": "claude",
  "enableFallback": true
}
```

### Mode Options:
- `single`: Use primaryProvider only (default)
- `parallel`: Run primary + secondary, return both results
- `sequential`: Primary grades → Secondary validates/adjusts
- `synthesize`: Primary + Secondary → Synthesizer combines

### Notes:
- **NO cost display** to users
- **Claude is always the fallback** if another provider fails
- Config changes require code push (not user-facing)
- Frontend does NOT get to choose providers

---

## Progress Log

### June 10, 2026
- Created folder structure
- Created this plan document
- Copied all original files to originals/ folder
- Created merged/ai-analyze-unified.js (combines ai-analyze.js + ai-analyze-direct.js)
- Created merged/card-info-unified.js (combines analyze-card.js + extract-card-info.js)
- Created providers/index.js (main interface)
- Created providers/anthropic.js (Claude)
- Created providers/google.js (Gemini)
- Created providers/openai.js (GPT)
- Created providers/xai.js (Grok)
- Edited deep-analyze-v2.js for multi-provider support with modes
- Created ai-config.json (admin-only configuration)
- Edited api.js (frontend service) to use unified endpoints:
  - /api/ai-analyze-unified?mode=direct|replicate
  - /api/card-info-unified?mode=claude|llava
  - /api/deep-analyze-v2 (multi-provider via config)
- **STATUS: All staging files complete. Ready for testing.**

---

## Rollback Plan

If deployment fails:
1. Move api/backup/*.js back to api/
2. Remove providers/ folder
3. Redeploy

Original files are preserved in api/multi-ai/originals/ as reference.

---
