/*
 * SlabSense — https://www.slabsenseai.com
 * Copyright (c) 2026 SlabSense. All rights reserved.
 * Proprietary and confidential; see LICENSE at the repository root.
 */
/**
 * POST /api/credits/spend  { gradeType: 'ai' | 'deep', scanId? }
 * Deducts credits before an AI grade. The user comes from the Supabase JWT in the
 * Authorization header — never from the body. Returns a transactionId for refunds.
 * Logic lives in api/_lib/credits.js (atomic RPC, legacy fallback pre-migration).
 */
import { userRoute } from '../_lib/route.js';
import { spendWithDb } from '../_lib/credits.js';

export const config = { maxDuration: 10 };

export default userRoute({ label: 'Spend' }, async ({ req, res, db, user }) => {
  const { gradeType, scanId } = req.body || {};
  const { status, body } = await spendWithDb(db, { userId: user.id, gradeType, scanId: scanId || null });
  return res.status(status).json(body);
});
