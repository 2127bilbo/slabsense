# Slab order — one-time setup and first live test

## Stripe (dashboard)
1. Products → Add product: "SlabSense slabbing" · one-time price (USD) · copy the **Price ID** (`price_…`). Use test mode first, then repeat in live mode.
2. Developers → Webhooks: the existing endpoint `https://slabsenseai.com/api/stripe/webhook` must include `checkout.session.completed` (it already does for credits).

## Vercel
- Environment variable `STRIPE_PRICE_SLAB` = the Price ID (test id on Preview, live id on Production). Redeploy.

## Supabase
- Apply `supabase/migrations/20260912_slabs.sql` (Plan A) then `supabase/migrations/20260913_slab_images.sql` in the SQL editor.

## First test (Stripe test mode)
1. In the app, open a graded card → **Get it slabbed** → Checkout opens with a shipping form. Pay with card `4242 4242 4242 4242`, any future date, any CVC, a US address.
2. Back in the app the card detail shows `Slab SS26-0000N · Paid — awaiting engraving`.
3. SQL editor: `select cert, status, front_image_url, back_image_url, shipping->'address'->>'postal_code' as zip from slabs order by paid_at desc limit 1;` — the URLs point at `slab-images/<cert>/…`.
4. Open `https://slabsenseai.com/v/<cert>`: the card photo, the label, the report and the "Paid — awaiting engraving" status.
5. Stripe dashboard → Webhooks → the event shows `200`. If it shows `500`, read the Vercel function log; the event will be retried and processed once the cause is fixed.

## Cleaning up test orders
`delete from slabs where cert = 'SS26-0000N';` then, if you want the numbering to restart, `alter sequence slab_cert_seq restart with 1;` and remove the test files from the `slab-images` bucket.
