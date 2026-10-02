/*
 * SlabSense — https://www.slabsenseai.com
 * Copyright (c) 2026 SlabSense. All rights reserved.
 * Proprietary and confidential; see LICENSE at the repository root.
 */
/**
 * Paid grade tiers — the single source of truth for credit costs and labels.
 * Used by the client (buttons, credits service) and the server (api/_lib/credits.js,
 * which passes the cost into the spend_credits database function).
 */
// One paid tier since 2026-10-02: the "AI Grade" the app sells runs the Deep flow (two passes,
// references, structural floor, back required) for one credit. The standard single-pass path
// stays server-side for older clients and the web until it is retired; it is no longer offered.
export const GRADE_TIERS = {
  ai: { credits: 1, label: 'AI Grade', transactionType: 'grade_ai' },
  deep: { credits: 1, label: 'AI Grade', transactionType: 'grade_deep' },
};
export const PAID_GRADE_TYPE = 'deep';

export const creditsLabel = (n) => `${n} credit${n === 1 ? '' : 's'}`;
