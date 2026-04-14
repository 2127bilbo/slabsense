/**
 * SlabSense - Scans Service
 * Handles saving and retrieving card scan data
 */

import { supabase, isSupabaseConfigured } from './supabase.js';

/**
 * Upload an image to Supabase Storage
 * @param {string} userId - User ID
 * @param {string} scanId - Scan ID (or 'pending' for new scans)
 * @param {string} dataUrl - Base64 data URL of image
 * @param {string} type - 'front' | 'back' | 'enhanced_front' | 'enhanced_back'
 * @returns {Promise<string|null>} Public URL of uploaded image
 */
export async function uploadCardImage(userId, scanId, dataUrl, type) {
  if (!isSupabaseConfigured() || !dataUrl) return null;

  try {
    // Convert data URL to blob
    const response = await fetch(dataUrl);
    const blob = await response.blob();

    // Generate unique filename
    const timestamp = Date.now();
    const filename = `${userId}/${scanId}/${type}_${timestamp}.jpg`;

    // Upload to storage bucket
    const { data, error } = await supabase.storage
      .from('card-images')
      .upload(filename, blob, {
        contentType: 'image/jpeg',
        upsert: true,
      });

    if (error) {
      console.error('Image upload error:', error);
      return null;
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from('card-images')
      .getPublicUrl(filename);

    return urlData?.publicUrl || null;
  } catch (err) {
    console.error('Upload error:', err);
    return null;
  }
}

/**
 * Save a new scan to the database
 * Optionally uploads enhanced card images for 3D viewing
 */
export async function saveScan(userId, scanData) {
  if (!isSupabaseConfigured()) {
    throw new Error('Database not configured');
  }

  // First insert the scan to get an ID
  const { data: scan, error } = await supabase
    .from('scans')
    .insert({
      user_id: userId,
      card_name: scanData.cardName || null,
      card_set: scanData.cardSet || null,
      card_number: scanData.cardNumber || null,
      card_game: scanData.cardGame || 'pokemon',
      front_image_path: scanData.frontImagePath || null,
      back_image_path: scanData.backImagePath || null,
      grading_company: scanData.gradingCompany || 'tag',
      raw_score: scanData.rawScore,
      grade_value: scanData.gradeValue,
      grade_label: scanData.gradeLabel,
      subgrades: scanData.subgrades || {},
      front_centering: scanData.frontCentering || {},
      back_centering: scanData.backCentering || {},
      dings: scanData.dings || [],
      notes: scanData.notes || null,
      // AI grading data (from Claude)
      ai_grades: scanData.aiGrades || null,        // Multi-company grades { psa, bgs, sgc, cgc, tag }
      ai_condition: scanData.aiCondition || null,  // { corners, edges, surface, defects }
      ai_summary: scanData.aiSummary || null,      // { positives, concerns, recommendation }
      ai_centering: scanData.aiCentering || null,  // { front: {leftRight, topBottom}, back: {...} }
      card_info: scanData.cardInfo || null,        // { name, hp, cardNumber, setName, rarity, year, variant, language }
      tcgdex_image: scanData.tcgdexImage || null,  // High-quality card image URL from TCGDex
      tcgdex_id: scanData.tcgdexId || null,        // TCGDex card ID for future lookups
      user_card_image: scanData.userCardImage || null, // User-cropped image when TCGDex has none
    })
    .select()
    .single();

  if (error) throw error;

  // If enhanced images provided, upload them and update the scan
  if (scanData.enhancedFront || scanData.enhancedBack) {
    const updates = {};

    if (scanData.enhancedFront) {
      const url = await uploadCardImage(userId, scan.id, scanData.enhancedFront, 'enhanced_front');
      if (url) updates.enhanced_front_path = url;
    }

    if (scanData.enhancedBack) {
      const url = await uploadCardImage(userId, scan.id, scanData.enhancedBack, 'enhanced_back');
      if (url) updates.enhanced_back_path = url;
    }

    if (Object.keys(updates).length > 0) {
      const { data: updated } = await supabase
        .from('scans')
        .update(updates)
        .eq('id', scan.id)
        .select()
        .single();
      return updated || scan;
    }
  }

  return scan;
}

/**
 * Get all scans for a user
 */
export async function getUserScans(userId, options = {}) {
  if (!isSupabaseConfigured()) {
    return [];
  }

  const { limit = 50, offset = 0, orderBy = 'created_at', ascending = false } = options;

  const { data, error } = await supabase
    .from('scans')
    .select('*')
    .eq('user_id', userId)
    .order(orderBy, { ascending })
    .range(offset, offset + limit - 1);

  if (error) throw error;
  return data || [];
}

/**
 * Get a single scan by ID
 */
export async function getScan(scanId) {
  if (!isSupabaseConfigured()) {
    return null;
  }

  const { data, error } = await supabase
    .from('scans')
    .select('*')
    .eq('id', scanId)
    .single();

  if (error) throw error;
  return data;
}

/**
 * Update a scan
 */
export async function updateScan(scanId, updates) {
  if (!isSupabaseConfigured()) {
    throw new Error('Database not configured');
  }

  const { data, error } = await supabase
    .from('scans')
    .update(updates)
    .eq('id', scanId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Delete a scan
 */
export async function deleteScan(scanId) {
  if (!isSupabaseConfigured()) {
    throw new Error('Database not configured');
  }

  const { error } = await supabase
    .from('scans')
    .delete()
    .eq('id', scanId);

  if (error) throw error;
}

/**
 * Toggle favorite status
 */
export async function toggleFavorite(scanId, isFavorite) {
  return updateScan(scanId, { is_favorite: isFavorite });
}

/**
 * Get scan count for a user
 */
export async function getScanCount(userId) {
  if (!isSupabaseConfigured()) {
    return 0;
  }

  const { count, error } = await supabase
    .from('scans')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId);

  if (error) throw error;
  return count || 0;
}

/**
 * Get favorite scans
 */
export async function getFavoriteScans(userId) {
  if (!isSupabaseConfigured()) {
    return [];
  }

  const { data, error } = await supabase
    .from('scans')
    .select('*')
    .eq('user_id', userId)
    .eq('is_favorite', true)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

/**
 * Search scans by card name
 */
export async function searchScans(userId, searchTerm) {
  if (!isSupabaseConfigured()) {
    return [];
  }

  const { data, error } = await supabase
    .from('scans')
    .select('*')
    .eq('user_id', userId)
    .ilike('card_name', `%${searchTerm}%`)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

/**
 * Log a missing TCGDex image for later resolution
 * This helps us track cards that need images added to our database
 */
export async function logMissingImage(tcgdexId, cardName, setName, cardNumber) {
  if (!isSupabaseConfigured()) {
    console.log('[MissingImage] Would log:', { tcgdexId, cardName, setName, cardNumber });
    return;
  }

  try {
    // Check if already logged
    const { data: existing } = await supabase
      .from('missing_images')
      .select('id, report_count')
      .eq('tcgdex_id', tcgdexId)
      .single();

    if (existing) {
      // Increment report count
      await supabase
        .from('missing_images')
        .update({
          report_count: (existing.report_count || 1) + 1,
          last_reported: new Date().toISOString()
        })
        .eq('tcgdex_id', tcgdexId);
    } else {
      // Insert new record
      await supabase
        .from('missing_images')
        .insert({
          tcgdex_id: tcgdexId,
          card_name: cardName,
          set_name: setName,
          card_number: cardNumber,
          report_count: 1,
          last_reported: new Date().toISOString(),
        });
    }

    console.log('[MissingImage] Logged:', tcgdexId, cardName);
  } catch (err) {
    // Don't throw - this is non-critical logging
    console.warn('[MissingImage] Failed to log:', err.message);
  }
}

/**
 * Upload user-cropped card image when TCGDex has no image
 */
export async function uploadUserCardImage(userId, scanId, croppedDataUrl) {
  if (!isSupabaseConfigured() || !croppedDataUrl) return null;

  try {
    const response = await fetch(croppedDataUrl);
    const blob = await response.blob();

    const filename = `${userId}/${scanId}/user_card_${Date.now()}.jpg`;

    const { error } = await supabase.storage
      .from('card-images')
      .upload(filename, blob, {
        contentType: 'image/jpeg',
        upsert: true,
      });

    if (error) {
      console.error('[UserCardImage] Upload error:', error);
      return null;
    }

    const { data: urlData } = supabase.storage
      .from('card-images')
      .getPublicUrl(filename);

    return urlData?.publicUrl || null;
  } catch (err) {
    console.error('[UserCardImage] Error:', err);
    return null;
  }
}
