/*
 * SlabSense — https://www.slabsenseai.com
 * Copyright (c) 2026 SlabSense. All rights reserved.
 * Proprietary and confidential; see LICENSE at the repository root.
 */
/** The label on the grade button for the account's situation. */
export function gradeButtonLabel({ hasPhotos, signedIn, unlimited, remaining }) {
  if (!hasPhotos) return 'Capture both sides';
  if (!signedIn) return '▶  Sign in to see your grade';
  if (unlimited) return '▶  Get my grade';
  if (remaining === 0) return 'Free limit reached';
  if (remaining == null) return '▶  Get my grade';
  return `▶  Get my grade (${remaining} free left this month)`;
}
