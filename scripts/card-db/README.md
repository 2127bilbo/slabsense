# Card identification database (`card-db` bucket)

Float16 CLIP embeddings of TCGDex card images, sharded and versioned in the public Supabase bucket `card-db`.
Design: `docs/superpowers/specs/2026-09-14-card-db-shards-and-id-bakeoff-design.md`.

    npm run cards:build-initial -- --dry-run   # JSON chunks → scripts/card-db/out/ (no upload)
    npm run cards:build-initial                # one-off publish (refuses if a manifest exists)
    npm run cards:update -- --dry-run          # what the weekly job would add
    npm run cards:update -- --set me03         # one set
    npm run cards:update                       # everything TCGDex has that we do not

Rules: shards are append-only and a card id lives in exactly one shard; the manifest is uploaded last;
TCG Pocket (digital-only) sets are excluded; rows are L2-normalized so the client searches by dot product.
`.github/workflows/card-db-update.yml` runs `cards:update` every Monday and on demand
(secrets `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`). Locally the scripts read `.env.local`.
Cards without an image on TCGDex (the `image` field is null; ~1,560 as of 2026-09-14, mostly trainer
galleries, promos and older subsets) land in `manifest.pending` and are retried with `--retry-pending`,
which the weekly workflow passes. Those cards cannot be identified by image matching until TCGDex adds scans.
