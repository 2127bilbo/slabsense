/*
 * SlabSense — https://www.slabsenseai.com
 * Copyright (c) 2026 SlabSense. All rights reserved.
 * Proprietary and confidential; see LICENSE at the repository root.
 */
/**
 * POST /api/credits/spend  { gradeType: 'free' | 'ai' | 'deep', scanId? }
 * 'free' spends one of the month's free on-device grades (unlimited accounts pass straight
 * through); the paid types deduct credits before an AI grade. The user comes from the Supabase
 * JWT in the Authorization header — never from the body. Returns a transactionId for refunds.
 * Logic lives in api/_lib/credits.js and api/_lib/freeGrades.js.
 */
import { userRoute } from '../_lib/route.js';
import { spendWithDb } from '../_lib/credits.js';
import { spendFreeGradeWithDb } from '../_lib/freeGrades.js';
import { FREE_TIER } from '../../src/lib/products.js';

export const config = { maxDuration: 10 };

export default userRoute({ label: 'Spend' }, async ({ req, res, db, user }) => {
  const { gradeType, scanId } = req.body || {};
  if (gradeType === 'free') {
    const { status, body } = await spendFreeGradeWithDb(db, { userId: user.id, limit: FREE_TIER.gradesPerMonth });
    return res.status(status).json(body);
  }
  const { status, body } = await spendWithDb(db, { userId: user.id, gradeType, scanId: scanId || null });
  return res.status(status).json(body);
});
