/*
 * SlabSense — https://www.slabsenseai.com
 * Copyright (c) 2026 SlabSense. All rights reserved.
 * Proprietary and confidential; see LICENSE at the repository root.
 */
/**
 * The free grade is charged after the analysis succeeds and before the result is shown, so a
 * failed analysis (bad photos) never uses one of the month's free grades. This turns the spend
 * call's answer into what the grade screen does next.
 * @param {(userId: string) => Promise<object>} spend  spendFreeGrade from services/credits.js
 * @returns {Promise<{show: true, unlimited: boolean, remaining: number|null}
 *                  | {show: false, gate: {kind: 'limit'|'signin', freeGrades?: object}}
 *                  | {show: false, error: string}>}
 */
export async function chargeFreeGrade(spend, userId) {
  try {
    const r = await spend(userId);
    return { show: true, unlimited: !!r?.unlimited, remaining: r?.freeGrades?.remaining ?? null };
  } catch (e) {
    if (e?.status === 402) return { show: false, gate: { kind: 'limit', freeGrades: e.data?.freeGrades } };
    if (e?.status === 401) return { show: false, gate: { kind: 'signin' } };
    return { show: false, error: `Error: could not record the grade (${e?.message || 'try again'})` };
  }
}
