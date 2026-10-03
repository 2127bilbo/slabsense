/*
 * SlabSense — https://www.slabsenseai.com
 * Copyright (c) 2026 SlabSense. All rights reserved.
 * Proprietary and confidential; see LICENSE at the repository root.
 */
/**
 * What the plan card says, from the balance endpoint's answer (api/credits/balance.js).
 * The server decides entitlement (unlimitedGrades); this only words it. A paid status the
 * server no longer counts as unlimited reads as Free, so the card never promises more than
 * the grade button will allow.
 */

import { PRODUCTS } from './products.js';

function fmtDate(iso, { locale, timeZone } = {}) {
  return new Date(iso).toLocaleDateString(locale, { month: 'short', day: 'numeric', timeZone });
}

/** First day of the month after 'YYYY-MM', as an ISO date (UTC midnight). */
function nextMonthStart(month) {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(m === 12 ? y + 1 : y, m === 12 ? 0 : m, 1)).toISOString();
}

/**
 * @param {object|null} b balance endpoint response
 * @returns {null | {plan:'free'|'trial'|'plus'|'past_due'|'lifetime', name:string, dateLine:string|null,
 *   rows:{key:string,label:string,value:string,detail:string|null,warn:boolean,meter:number|null}[], actions:('plus'|'packs'|'manage')[],
 *   source:string|null}}
 */
export function planSummary(b, fmt = {}) {
  if (!b) return null;
  const d = (iso) => fmtDate(iso, { timeZone: 'UTC', ...fmt });
  let plan = 'free';
  if (b.isLifetime) plan = 'lifetime';
  else if (b.subscription === 'past_due') plan = 'past_due';
  else if (b.unlimitedGrades && b.subscription === 'trialing') plan = 'trial';
  else if (b.unlimitedGrades) plan = 'plus';

  const name = { free: 'Free', trial: 'Plus trial', plus: 'SlabSense Plus', past_due: 'SlabSense Plus', lifetime: 'Lifetime' }[plan];
  let dateLine = null;
  if (plan === 'trial' && b.renewsAt) dateLine = `Trial ends ${d(b.renewsAt)}`;
  if (plan === 'plus' && b.renewsAt) dateLine = `Renews ${d(b.renewsAt)}`;
  if (plan === 'past_due') dateLine = 'Your last payment did not go through. Update your payment method under Manage to keep Plus.';

  const unlimited = plan === 'trial' || plan === 'plus' || plan === 'lifetime';
  const fg = b.freeGrades || { remaining: 0, limit: 0 };
  const grades = unlimited
    ? { key: 'grades', label: 'Grades', value: 'Unlimited', detail: null, warn: false, meter: null }
    : { key: 'grades', label: 'Grades', value: `${fg.remaining} of ${fg.limit} left`,
      detail: fg.month ? `Resets ${d(nextMonthStart(fg.month))}` : null, warn: fg.remaining === 0,
      meter: fg.limit ? fg.remaining / fg.limit : null };

  const parts = [];
  if (b.subCredits > 0) parts.push(`${b.subCredits} from your plan${b.subCreditsExpireAt ? `, until ${d(b.subCreditsExpireAt)}` : ''}`);
  if (b.packCredits > 0) parts.push(`${b.packCredits} from packs, never expire`);
  const ai = plan === 'lifetime'
    ? { key: 'ai', label: 'AI Grades', value: 'Unlimited', detail: null, warn: false, meter: null }
    : { key: 'ai', label: 'AI Grades', value: String(b.credits || 0), detail: parts.join(' · ') || null, warn: false, meter: null };

  const saved = b.cardsSaved || 0;
  const cards = b.cardLimit == null
    ? { key: 'cards', label: 'Saved cards', value: `${saved} saved`, detail: 'No limit', warn: false, meter: null }
    : { key: 'cards', label: 'Saved cards', value: `${saved} of ${b.cardLimit}`, detail: null, warn: saved >= b.cardLimit,
      meter: Math.min(1, saved / b.cardLimit) };

  const actions = { free: ['plus', 'packs'], trial: ['packs', 'manage'], plus: ['packs', 'manage'], past_due: ['manage', 'packs'], lifetime: [] }[plan];
  return { plan, name, dateLine, rows: [grades, ai, cards], actions, source: b.subscriptionSource || null };
}

/**
 * The Plus button. The trial is offered only to accounts that never had one; the server makes the
 * same check (api/stripe/create-checkout.js, profiles.used_trial), so the button never promises more.
 * past_due still counts as the current plan: the fix is Manage, not a second subscription.
 */
export function plusOffer(b) {
  const current = !!b && !b.isLifetime && (b.subscription === 'past_due' || (b.unlimitedGrades && ['trialing', 'sub_monthly', 'grace'].includes(b.subscription)));
  if (current) return { cta: 'Current plan', trial: false, current: true };
  const trial = !b?.trialUsed;
  return { cta: trial ? `Start ${PRODUCTS.sub_monthly.trial.days}-day free trial` : 'Subscribe', trial, current: false };
}
