# Fix group 3c — Account lifecycle and privacy

> **For agentic workers:** executed natively by the app session. Closes audit ids listed per task
> (`docs/audits/2026-10-app-store-audit.md`). Owner actions are marked.

**Goal:** account deletion that deletes, legal documents that are served, linked and true, the
AI-provider disclosure, consent for training photos, and the account controls Apple expects
(reset, change email and password, data export).

**Spec:** audit sections F and L, plus A-04, A-05, A-11, B-15, K-01, K-11.

## Tasks

- [x] **1. Server-side deletion** `api/account.js` (`action: delete`): removes every stored image
      under `card-images/<userId>/`, slab orders detached and address purged, jobs, credit
      transactions, identifications, scans, profile, Stripe subscription and customer, then the
      auth user. `src/services/auth.js deleteAccount()` calls it with the bearer token. (A-04,
      F-01, L-01, L-07, F-05, L-08)
- [x] **2. Migration** `supabase/migrations/20261002_account_deletion.sql`: `slabs.scan_id` /
      `user_id` nullable with `ON DELETE SET NULL`. (L-02, F-06) **Owner applies in the SQL editor.**
- [x] **3. Scan deletion purges images** (`action: purge-scan`, best effort from `deleteScan`). (F-05)
- [x] **4. Data export** (`action: export` → JSON with signed image links; Settings "Download my
      data"). (F-12, L-05)
- [x] **5. Legal documents rewritten** in `docs/legal/` (privacy names Anthropic, Supabase, Vercel,
      Stripe, Apple, TCGdex; retention; deletion; training consent; shipping data; no promises
      the code does not keep), rendered by `scripts/legal/build-legal.mjs` to `public/{privacy,
      terms,disclaimers}.html`, served at `/privacy`, `/terms`, `/disclaimers` (vercel.json
      rewrites ahead of the SPA catch-all). (A-05, F-02, F-03, K-01, F-11)
- [x] **6. Links**: sign-up notice links to terms, privacy and disclaimers; Settings has a
      "Legal & your data" section with the three links, the export button and the AI-provider
      sentence. (I-03, K-11 partially: the first-run modal is re-openable via Settings links)
- [x] **7. Password reset** ("Forgot password?" → reset email → `SetPasswordModal` on the
      `PASSWORD_RECOVERY` event) and **change email / password** in Settings. (L-03, L-04)
- [x] **8. Training-photo consent copy** on the Settings toggle; policy section. (F-10)
- [x] **9. iOS purpose strings** drafted in `docs/legal/ios-purpose-strings.md` for 3f. (A-11)
- [ ] **10. Owner**: confirm `support@slabsenseai.com` exists (or give the right address) and the
      governing-law state (Indiana assumed) in `docs/legal/*`; re-run the legal build after edits.
- [ ] **11. Owner**: Supabase dashboard — add `https://www.slabsenseai.com/?recovery=1` (and the
      native scheme later) to the auth redirect allow-list so reset links open the app. (L-06)
- [ ] **12. Deferred to 3b**: deletion copy about an active Apple subscription (handled by Apple;
      text added when IAP lands). Deferred to 3g: the first-run disclaimer re-open control.
