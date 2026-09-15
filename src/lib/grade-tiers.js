/**
 * Paid grade tiers — the single source of truth for credit costs and labels.
 * Used by the client (buttons, credits service) and the server (api/_lib/credits.js,
 * which passes the cost into the spend_credits database function).
 */
export const GRADE_TIERS = {
  ai: { credits: 1, label: 'AI Grade', transactionType: 'grade_ai' },
  deep: { credits: 2, label: 'Deep AI Grade', transactionType: 'grade_deep' },
};

export const creditsLabel = (n) => `${n} credit${n === 1 ? '' : 's'}`;
