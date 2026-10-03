/*
 * SlabSense — https://www.slabsenseai.com
 * Copyright (c) 2026 SlabSense. All rights reserved.
 * Proprietary and confidential; see LICENSE at the repository root.
 */
/**
 * Free-tier on-device grade counter (owner decision 2026-10-02: 10 a month, no AI Grades).
 * The SQL function use_free_grade() (migration 20261003_free_grades.sql) is the only writer;
 * this module shapes its answers for the spend route and the balance endpoint.
 */
import { isUnlimited } from '../../src/lib/products.js';

/** 'YYYY-MM' in UTC, the key the counter is kept under. */
export function monthKey(date = new Date()) { return date.toISOString().slice(0, 7); }

/** The counter as the balance endpoint reports it; a stale month reads as unused. */
export function freeGradeView(profile, limit, now = new Date()) {
  const month = monthKey(now);
  const used = profile?.free_grades_month === month ? (profile.free_grades_used || 0) : 0;
  return { month, used, limit, remaining: Math.max(0, limit - used) };
}

/** What the balance endpoint adds for the grade flow: unlimited flag and the monthly counter. */
export function entitlementFields(profile, limit, now = new Date()) {
  return { unlimitedGrades: isUnlimited(profile?.subscription_status, profile?.subscription_renews_at, now), freeGrades: freeGradeView(profile, limit, now) };
}

/** The spend route's `gradeType: 'free'` branch: unlimited accounts never touch the counter. */
export async function spendFreeGradeWithDb(db, { userId, limit }) {
  const { data: profile } = await db.from('profiles').select('subscription_status, subscription_renews_at').eq('id', userId).maybeSingle();
  if (isUnlimited(profile?.subscription_status, profile?.subscription_renews_at)) return { status: 200, body: { success: true, unlimited: true } };
  return useFreeGradeWithDb(db, { userId, limit });
}

/** Spend one free grade. Same {status, body} shape as spendWithDb so the spend route can return it directly. */
export async function useFreeGradeWithDb(db, { userId, limit }) {
  if (!userId) return { status: 400, body: { error: 'User ID required' } };
  const { data: r, error } = await db.rpc('use_free_grade', { p_user_id: userId, p_limit: limit });
  if (error) throw error;
  const freeGrades = { used: r?.used ?? 0, limit: r?.limit ?? limit, remaining: r?.remaining ?? 0, month: r?.month ?? monthKey() };
  if (r?.success) return { status: 200, body: { success: true, freeGrades } };
  if (r?.error === 'user_not_found') return { status: 404, body: { error: 'User not found' } };
  if (r?.error === 'free_grades_exhausted') {
    return { status: 402, body: { error: 'free_grades_exhausted', message: `You have used your ${limit} free grades this month. Plus has unlimited grades.`, freeGrades } };
  }
  return { status: 400, body: { error: r?.error || 'Invalid request' } };
}
