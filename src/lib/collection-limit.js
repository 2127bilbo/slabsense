/*
 * SlabSense — https://www.slabsenseai.com
 * Copyright (c) 2026 SlabSense. All rights reserved.
 * Proprietary and confidential; see LICENSE at the repository root.
 */
/**
 * Free-account collection cap (FREE_TIER.collectionLimit). The database refuses the insert with
 * 'collection_limit_reached' (trigger in migration 20261003_free_grades.sql); this module turns that
 * into something the app can show. Pure: no Supabase import, so it is testable in node.
 */
import { FREE_TIER } from './products.js';

export const COLLECTION_LIMIT_EVENT = 'slabsense:collection-limit';

export function isCollectionLimitError(error) {
  return !!error && /collection_limit_reached/.test(String(error.message || ''));
}

export function collectionLimitMessage() {
  return `Your free collection holds ${FREE_TIER.collectionLimit} cards. Delete one or get SlabSense Plus for an unlimited collection.`;
}
