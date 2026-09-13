/**
 * api/_lib/slabs.js — slabbing orders: Checkout params, cert minting, cert-keyed image copies.
 * Pure and dependency-injected so it can be tested with fakes (scripts/verify-slabs-lib.cjs).
 */
export const SLAB_PRICE_KEY = 'slab';
export const SLAB_IMAGE_BUCKET = 'slab-images';

export function slabSessionParams({ customerId, userId, scanId, priceId, successUrl, cancelUrl }) {
  return {
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    mode: 'payment',
    // Card only — delayed-notification methods (e.g. ACH, some wallets) fire
    // checkout.session.completed before the money has actually arrived, which
    // would let the webhook mint a cert for a session that later fails to pay.
    payment_method_types: ['card'],
    shipping_address_collection: { allowed_countries: ['US'] },
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: { user_id: userId, price_id: priceId, price_key: SLAB_PRICE_KEY, scan_id: scanId },
  };
}

/** Mint arguments from a completed Checkout session. Throws when the session is not actually paid. */
export function slabOrderFromSession(session) {
  if (session.payment_status !== 'paid') throw new Error(`slab session ${session.id} is not paid (${session.payment_status})`);
  const scanId = session.metadata?.scan_id;
  const userId = session.metadata?.user_id;
  if (!scanId || !userId) throw new Error(`slab session ${session.id} is missing scan_id/user_id metadata`);
  return {
    scanId, userId, stripeSessionId: session.id,
    shipping: session.shipping_details || session.collected_information?.shipping_details || null,
  };
}

/** Which of a scan's images the slab should carry. Front prefers the user's crop; back the enhanced photo. */
export function pickImages(scan) {
  return {
    front: scan.user_card_image || scan.enhanced_front_path || scan.front_image_path || null,
    back: scan.enhanced_back_path || scan.back_image_path || null,
  };
}

async function copyOne({ storage, fetchImpl }, cert, side, url) {
  if (!url) return null;
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`fetch ${side} image: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const contentType = (res.headers && res.headers.get && res.headers.get('content-type')) || 'image/jpeg';
  const path = `${cert}/${side}.jpg`;
  const { error } = await storage.from(SLAB_IMAGE_BUCKET).upload(path, buf, { contentType, upsert: true });
  if (error) throw new Error(`upload ${side} image: ${error.message || error}`);
  return storage.from(SLAB_IMAGE_BUCKET).getPublicUrl(path).data.publicUrl;
}

/** Copies front/back to slab-images/<cert>/. Never throws: a failed side yields null. */
export async function copySlabImages(deps, cert, images) {
  const out = { front_image_url: null, back_image_url: null };
  const log = deps.log || console.error;
  for (const side of ['front', 'back']) {
    try { out[`${side}_image_url`] = await copyOne(deps, cert, side, images[side]); }
    catch (e) { log(`[slabs] ${cert}: ${side} image copy failed: ${e.message}`); }
  }
  return out;
}

/**
 * Mint a slab for a paid Checkout session. Idempotent on stripe_session_id (select first — never
 * insert-then-conflict, which would burn a cert number on webhook replays).
 */
export async function mintSlab({ db, storage, fetchImpl, log = console.error }, { scanId, userId, stripeSessionId, shipping }) {
  const existing = await db.from('slabs').select('*').eq('stripe_session_id', stripeSessionId).maybeSingle();
  if (existing.error) throw new Error(`slabs lookup failed: ${existing.error.message || existing.error}`);
  if (existing.data) return { slab: existing.data, created: false };

  const scanRes = await db.from('scans').select('*').eq('id', scanId).maybeSingle();
  if (scanRes.error) throw new Error(`scan lookup failed: ${scanRes.error.message || scanRes.error}`);
  const scan = scanRes.data;
  if (!scan) throw new Error(`scan ${scanId} not found`);
  if (scan.user_id !== userId) throw new Error(`scan ${scanId} does not belong to the paying user`);

  const ins = await db.from('slabs')
    .insert({ scan_id: scanId, user_id: userId, stripe_session_id: stripeSessionId, shipping: shipping || null })
    .select().single();
  if (ins.error) throw new Error(`slab insert failed: ${ins.error.message || ins.error}`);
  const slab = ins.data;

  const urls = await copySlabImages({ storage, fetchImpl, log }, slab.cert, pickImages(scan));
  const upd = await db.from('slabs').update(urls).eq('id', slab.id);
  if (upd.error) log(`[slabs] ${slab.cert}: image url update failed: ${upd.error.message || upd.error}`);
  return { slab: { ...slab, ...urls }, created: true };
}
