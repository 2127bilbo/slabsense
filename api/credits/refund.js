/*
 * SlabSense — https://www.slabsenseai.com
 * Copyright (c) 2026 SlabSense. All rights reserved.
 * Proprietary and confidential; see LICENSE at the repository root.
 */
/**
 * POST /api/credits/refund  { transactionId, reason? }
 * Refunds one grade transaction, once, for the authenticated user. No raw amounts and
 * no expiry extension (both were open to abuse in the previous version).
 */
import { userRoute } from '../_lib/route.js';
import { refundWithDb } from '../_lib/credits.js';

export const config = { maxDuration: 10 };

export default userRoute({ label: 'Refund' }, async ({ req, res, db, user }) => {
  const { transactionId, reason } = req.body || {};
  const { status, body } = await refundWithDb(db, { userId: user.id, transactionId, reason: reason || null });
  return res.status(status).json(body);
});
