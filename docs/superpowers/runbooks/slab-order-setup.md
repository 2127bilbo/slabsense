# Slab order — one-time setup and first live test

Follow these in order. Step 4's env var is the gate: until `STRIPE_PRICE_SLAB`
is set, every slab checkout returns 400 `Invalid price key`, so nothing can be
ordered before the bucket and columns from step 2 exist.

## 1. Deploy the code

Deploy the branch (webhook, checkout, UI, `api/_lib/slabs.js`) as usual.

## 2. Apply the migrations (Supabase SQL editor)

Apply `supabase/migrations/20260912_slabs.sql` (Plan A) then
`supabase/migrations/20260913_slab_images.sql`, in that order.

## 3. Create the Stripe price (dashboard)

1. Products → Add product: "SlabSense slabbing" · one-time price (USD) · copy
   the **Price ID** (`price_…`). Use test mode first, then repeat in live mode.
2. Developers → Webhooks: the existing endpoint
   `https://slabsenseai.com/api/stripe/webhook` must include
   `checkout.session.completed` (it already does for credits).

## 4. Set the price env var and redeploy (Vercel)

Environment variable `STRIPE_PRICE_SLAB` = the Price ID (test id on Preview,
live id on Production). Redeploy. This is the gate: before this step, slab
checkout requests fail with 400 `Invalid price key`, which is what keeps an
order from being placed before the bucket/columns from step 2 exist.

## First test (Stripe test mode)

1. In the app, open a graded card → **Get it slabbed** → Checkout opens with a shipping form. Pay with card `4242 4242 4242 4242`, any future date, any CVC, a US address.
2. Back in the app the card detail shows `Slab SS26-0000N · Paid — awaiting engraving`.
3. SQL editor: `select cert, status, front_image_url, back_image_url, shipping->'address'->>'postal_code' as zip from slabs order by paid_at desc limit 1;` — the URLs point at `slab-images/<cert>/…`.
4. Open `https://slabsenseai.com/v/<cert>`: the card photo, the label, the report and the "Paid — awaiting engraving" status.
5. Stripe dashboard → Webhooks → the event shows `200`. If it shows `500`, read the Vercel function log; the event will be retried and processed once the cause is fixed.
6. If the webhook shows repeated 500s for a session whose scan no longer exists, refund the payment in Stripe — the order cannot be fulfilled.

## Cleaning up test orders
`delete from slabs where cert = 'SS26-0000N';` then, if you want the numbering to restart, `alter sequence slab_cert_seq restart with 1;` and remove the test files from the `slab-images` bucket.

## Admin access to the studio queue
- Find your user id: Supabase → Authentication → Users → your email → copy the UUID.
- Vercel env `ADMIN_USER_IDS` = that UUID (comma-separate more later). Redeploy.
- Apply `supabase/migrations/20260914_slab_label.sql`.
- Open https://www.slabsenseai.com/studio → sign in with your app email/password → **Queue**.

## Working the queue
1. **To engrave**: click a row → the label renders from the record (edit the four text lines if the scan's name is missing or wrong — the edited text is what gets stored and shown on the cert page). **Download SVG** saves the file for LightBurn and marks the slab *engraved*.
2. **To ship**: the shipping address is shown with a copy button. After it's in the mail, **Mark shipped**.
3. **Done**: searchable history. The cert page shows the same status the whole way.
If "Could not mark engraved" appears, the SVG still downloaded — fix the cause (usually signed out) and click the row again; it stays in To engrave until the server confirms.

## Going live (after testing)
Change together in Vercel, then redeploy: `STRIPE_SECRET_KEY` → live key; `STRIPE_PRICE_SLAB` → the live-mode price id; `STRIPE_WEBHOOK_SECRET` → the **live** endpoint's secret, and make sure that endpoint's URL is `https://www.slabsenseai.com/api/stripe/webhook` (the apex domain redirects and Stripe won't follow) and that it subscribes to `checkout.session.completed`. Then clean up test data: `delete from slabs where cert like 'SS26-%';` `alter sequence slab_cert_seq restart with 1;` and empty the `slab-images` and `slab-labels` buckets.
