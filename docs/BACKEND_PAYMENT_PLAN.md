# SlabSense Backend & Payment Plan

## Market Research Summary

### Competitor Analysis

| App | Pricing Model | Per Grade Cost | Notes |
|-----|--------------|----------------|-------|
| Digital Grading Co | $5-15/mo + credits | ~$0.20-0.40 | Controversial: subscription + credits required |
| TCGrader | £10-20/mo | Included | Subscription only |
| CardGrading.app | Credit packs | ~$0.10 | No subscription, pay per use |
| GraderIQ | $10-25/mo | $0.10-0.20 | Subscription + volume |
| SnapGradeAI | Credit packs | $0.83-2.00 | No subscription |
| TCGai.pro | $7-30/mo | $0.06-0.07 | Best value per grade |

### Digital Grading Co Deep Dive
- **Tiers**: Lite ($5), Rookie ($10), Elite ($15)/month
- **Credit System**: 2 credits = 1 instant grade
- **Credit Packs**: 25 for $5, 75 for $15, 150 for $30
- **Without credits**: Grades take 1-4+ hours (queue system)
- **User complaints**: Feel misled by dual paywall (subscription + credits)

### Key Takeaways
1. Users hate hidden costs - be transparent
2. Queue system creates artificial scarcity
3. Credits for "express" is common but controversial
4. Per-grade cost ranges $0.06 - $2.00

---

## SlabSense Proposed Model

### Philosophy
**Be transparent. Don't double-dip.**

Users should know exactly what they're paying for. No bait-and-switch.

### Tier Structure

#### Free Tier (Current)
- Client-side grading (JavaScript in browser)
- Works offline, instant results
- Good accuracy for centering, decent for defects
- No account required
- Limited to basic analysis

#### Pro Tier - $15/month
- **Backend AI grading** (Python + OpenCV)
  - Perspective correction (flatten angled cards)
  - Pixel-perfect centering measurement
  - Enhanced defect detection
  - OCR for card name & set number
- Unlimited standard grades (queued)
- Queue time: ~30 seconds - 2 minutes
- Save unlimited scans to collection
- Export high-res grade cards
- Priority email support

#### Express Credits (Optional Add-on)
- Skip the queue, instant backend processing
- **Pricing**:
  - 10 credits = $5 ($0.50/grade)
  - 25 credits = $10 ($0.40/grade)
  - 50 credits = $15 ($0.30/grade)
- 1 credit = 1 express grade
- Available to Pro subscribers only
- Credits never expire

#### Beta Lifetime - $99 one-time
- Everything in Pro, forever
- 50 express credits included
- Early supporter badge
- Input on future features
- Limited availability (first 100 users?)

### Feature Comparison

| Feature | Free | Pro ($15/mo) | Beta Lifetime ($99) |
|---------|------|--------------|---------------------|
| Client-side grading | ✓ | ✓ | ✓ |
| Backend AI grading | ✗ | ✓ | ✓ |
| Perspective correction | ✗ | ✓ | ✓ |
| OCR (card name/set) | ✗ | ✓ | ✓ |
| Save to collection | 10 scans | Unlimited | Unlimited |
| Export grade cards | Watermark | Full quality | Full quality |
| Queue time | N/A | 30s-2min | 30s-2min |
| Express credits | ✗ | Can purchase | 50 included |

---

## Backend Architecture

### Tech Stack
```
Language:    Python 3.11+
Framework:   FastAPI (async, fast, auto-docs)
CV Library:  OpenCV + NumPy
OCR:         Tesseract (free) or Google Vision API (paid, more accurate)
Queue:       Redis + Celery (for job processing)
Storage:     Supabase Storage (card images)
Hosting:     Local (dev) → Fly.io (prod)
```

### Development Phases

#### Phase 1: Local Development (Your PC)
```
┌─────────────────────────────────────────────────┐
│  Your PC                                        │
│  ┌─────────────┐    ┌─────────────────────────┐ │
│  │ FastAPI     │    │ Python Processing       │ │
│  │ localhost:  │───▶│ - OpenCV                │ │
│  │ 8000        │    │ - Perspective transform │ │
│  └─────────────┘    │ - Border detection      │ │
│        ▲            │ - Centering calc        │ │
│        │            │ - OCR                   │ │
│        │            └─────────────────────────┘ │
└────────│────────────────────────────────────────┘
         │
    HTTP Request
         │
┌────────│────────────────────────────────────────┐
│  Frontend (Vercel)                              │
│  - Calls YOUR_PC_IP:8000 for backend grades     │
│  - Toggle: "Use local backend" in settings      │
└─────────────────────────────────────────────────┘
```

**How to run locally:**
1. Install Python + dependencies
2. Run `python main.py` (starts FastAPI on port 8000)
3. Use ngrok or local IP to expose to frontend
4. Test processing pipeline

**Difficulty**: Medium
- Python/OpenCV setup: 2-3 hours
- Core processing logic: 8-12 hours
- API endpoints: 2-3 hours
- Testing/tuning: 4-6 hours

#### Phase 2: Production (Fly.io)
```
┌─────────────────────────────────────────────────┐
│  Fly.io                                         │
│  ┌─────────────┐    ┌─────────────────────────┐ │
│  │ FastAPI     │    │ Worker Containers       │ │
│  │ api.slab    │───▶│ - Process queue         │ │
│  │ sense.app   │    │ - Scale as needed       │ │
│  └─────────────┘    └─────────────────────────┘ │
│        ▲                      │                 │
│        │                      ▼                 │
│        │            ┌─────────────────────────┐ │
│        │            │ Redis Queue             │ │
│        │            │ - Job management        │ │
│        │            │ - Priority (express)    │ │
│        │            └─────────────────────────┘ │
└────────│────────────────────────────────────────┘
         │
┌────────│────────────────────────────────────────┐
│  Supabase                                       │
│  - Auth (verify Pro subscription)               │
│  - Store results                                │
│  - Image storage                                │
└─────────────────────────────────────────────────┘
```

**Migration from local to Fly.io:**
1. Dockerize the Python app
2. Deploy to Fly.io
3. Add Redis for queue management
4. Update frontend to use production URL
5. Add auth middleware (verify Pro status)

**Estimated Fly.io costs:**
- Small instance: ~$5-10/month base
- Scales with usage
- Redis: ~$5/month

---

## Queue System Design

### Why a Queue?
- Prevents server overload
- Fair processing order
- Enables priority lanes (express)
- Better user experience than timeouts

### Queue Flow
```
User submits card
       │
       ▼
┌──────────────────┐
│ Check auth/tier  │
│ - Free? Reject   │
│ - Pro? Continue  │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐     ┌──────────────────┐
│ Express credit?  │─Yes─▶│ Priority Queue   │
│                  │      │ (processed first)│
└────────┬─────────┘      └──────────────────┘
         │ No
         ▼
┌──────────────────┐
│ Standard Queue   │
│ (FIFO order)     │
└──────────────────┘
         │
         ▼
┌──────────────────┐
│ Worker picks up  │
│ - Download image │
│ - Process        │
│ - Return result  │
└──────────────────┘
         │
         ▼
┌──────────────────┐
│ Notify frontend  │
│ - WebSocket or   │
│ - Polling        │
└──────────────────┘
```

### Estimated Wait Times
- Express: 5-15 seconds (next in line)
- Standard (low traffic): 30 seconds
- Standard (busy): 1-2 minutes
- Never more than 5 minutes (scale workers)

---

## Stripe Integration

### Products to Create

1. **SlabSense Pro** (subscription)
   - Price: $15/month
   - Stripe Price ID: `price_pro_monthly`

2. **Beta Lifetime** (one-time)
   - Price: $99
   - Stripe Price ID: `price_beta_lifetime`
   - Limited quantity

3. **Express Credits** (one-time, multiple tiers)
   - 10 credits: $5 (`price_credits_10`)
   - 25 credits: $10 (`price_credits_25`)
   - 50 credits: $15 (`price_credits_50`)

### Webhook Events to Handle
```javascript
// Subscription created/renewed
'customer.subscription.created'
'customer.subscription.updated'
'invoice.paid'

// Subscription cancelled/expired
'customer.subscription.deleted'
'invoice.payment_failed'

// One-time purchases (lifetime, credits)
'checkout.session.completed'
```

### Database Updates on Payment
```sql
-- On Pro subscription
UPDATE profiles SET tier = 'pro_monthly' WHERE id = user_id;

-- On Beta Lifetime purchase
UPDATE profiles SET tier = 'beta_lifetime' WHERE id = user_id;
INSERT INTO memberships (user_id, type, amount_paid) VALUES (...);

-- On credit purchase
UPDATE profiles SET express_credits = express_credits + N WHERE id = user_id;
```

---

## Implementation Roadmap

### Stage 1: Backend MVP (Local)
**Goal**: Working Python backend on your PC

- [ ] Set up Python project structure
- [ ] Implement perspective correction (deskew)
- [ ] Implement precise border detection
- [ ] Implement centering calculation
- [ ] Add Tesseract OCR for card name/set
- [ ] Create FastAPI endpoints
- [ ] Test with real card images
- [ ] Add "Use local backend" toggle in frontend

### Stage 2: Stripe Integration
**Goal**: Accept payments, gate features

- [ ] Create Stripe account
- [ ] Set up products (Pro, Lifetime, Credits)
- [ ] Build checkout flow in frontend
- [ ] Handle webhooks (subscription events)
- [ ] Update user tier on payment
- [ ] Add feature gates in UI
- [ ] Test full payment flow

### Stage 3: Production Backend
**Goal**: Move backend to Fly.io

- [ ] Dockerize Python app
- [ ] Deploy to Fly.io
- [ ] Set up Redis queue
- [ ] Add auth middleware
- [ ] Implement express priority queue
- [ ] Add WebSocket for real-time updates
- [ ] Load testing
- [ ] Monitor and scale

### Stage 4: Polish
**Goal**: Production ready

- [ ] Error handling and retries
- [ ] Usage analytics
- [ ] Admin dashboard
- [ ] Rate limiting
- [ ] Abuse prevention

---

## Revenue Projections

### Conservative Estimates
```
Month 1-3 (Beta):
- 50 Beta Lifetime @ $99 = $4,950
- 20 Pro Monthly @ $15 = $300/mo

Month 4-6:
- 100 Pro Monthly @ $15 = $1,500/mo
- Credit sales: ~$200/mo

Month 6+:
- 200 Pro Monthly @ $15 = $3,000/mo
- Credit sales: ~$500/mo
```

### Costs
```
- Fly.io hosting: $10-30/month
- Supabase (free tier): $0
- Stripe fees: 2.9% + $0.30 per transaction
- Google Vision (if used): ~$50/month at scale
```

---

## Open Questions

1. **OCR accuracy**: Tesseract (free) vs Google Vision (paid)?
   - Test both, decide based on accuracy

2. **Queue visibility**: Show users their position in queue?
   - Probably yes, reduces anxiety

3. **Express credit expiry**: Should credits expire?
   - Recommend: No expiry (user-friendly)

4. **Refund policy**: What if backend is down?
   - Auto-refund credits if processing fails

5. **Free tier backend access**: Any free backend trials?
   - Maybe: 3 free backend grades for new users?

---

## Next Steps

1. **Review this plan** - Any changes to pricing or features?
2. **Start Stage 1** - Build Python backend locally
3. **Test accuracy** - Make sure it's better than client-side
4. **Then Stage 2** - Add Stripe while backend is tested

---

*Last Updated: April 6, 2026*

## Sources
- [Digital Grading Co - App Store](https://apps.apple.com/us/app/digital-grading-co/id1594172751)
- [CardGrading.app Comparison](https://cardgrading.app/compare)
- [Best Card Grading Apps 2026](https://zeropop.app/blog/best-card-grading-apps)
