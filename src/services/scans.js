/**
 * SlabSense - Scans Service
 * Handles saving and retrieving card scan data
 */

import { supabase, isSupabaseConfigured } from './supabase.js';
import { scanAiColumns } from '../lib/grade-records.js';

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
/** Column mapping shared by insert and update (kept in one place so both paths save the same fields). */
export function scanRowFromSaveData(scanData) {
  return {
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
    company_grades: scanData.companyGrades || null,   // engine per-company grades (F1)
    front_centering: scanData.frontCentering || {},
    back_centering: scanData.backCentering || {},
    dings: scanData.dings || [],
    notes: scanData.notes || null,
    // AI grading data — one canonical shape for the Grade tab, the collection view and the damage
    // report (src/lib/grade-records.js): standard AI at the top level, Deep AI under __deep__.
    ...scanAiColumns({
      ai: scanData.aiRecord || null,
      deep: scanData.deepRecord || null,
      aiGrades: scanData.aiGrades || null,
      deepGrades: scanData.deepAiGrades || null,
      aiSummary: scanData.aiSummary || null,
      deepSummary: scanData.deepAiSummary || null,
      aiCentering: scanData.aiCentering || null,
    }),
    card_info: scanData.cardInfo || null,        // { name, hp, cardNumber, setName, rarity, year, variant, language }
    tcgdex_image: scanData.tcgdexImage || null,  // High-quality card image URL from TCGDex
    tcgdex_id: scanData.tcgdexId || null,        // TCGDex card ID for future lookups
    // Note: user_card_image is set via upload below (URL, not base64)
  };
}

/**
 * Save a scan, or update the one already saved for this card.
 * @param {string} userId
 * @param {object} scanData  see scanRowFromSaveData + enhancedFront/enhancedBack/userCardImage data URLs
 * @param {string|null} existingId  update this row instead of inserting (auto-save + manual save share one row)
 * @param {{ skipImages?: boolean }} [opts]  skip re-uploading unchanged images on an update
 */
export async function upsertScan(userId, scanData, existingId = null, { skipImages = false } = {}) {
  if (!isSupabaseConfigured()) {
    throw new Error('Database not configured');
  }

  let scan;
  if (existingId) {
    const { data, error } = await supabase
      .from('scans')
      .update(scanRowFromSaveData(scanData))
      .eq('id', existingId)
      .eq('user_id', userId)
      .select()
      .single();
    if (error) throw error;
    scan = data;
  } else {
    const { data, error } = await supabase
      .from('scans')
      .insert({ user_id: userId, ...scanRowFromSaveData(scanData) })
      .select()
      .single();
    if (error) throw error;
    scan = data;
  }

  // If images provided, upload them to bucket and update the scan with URLs
  const hasImagesToUpload = !skipImages && (scanData.enhancedFront || scanData.enhancedBack || scanData.userCardImage);

  if (hasImagesToUpload) {
    console.log('[saveScan] Images to upload:', {
      enhancedFront: !!scanData.enhancedFront,
      enhancedBack: !!scanData.enhancedBack,
      userCardImage: !!scanData.userCardImage,
      update: !!existingId,
    });

    const updates = {};

    if (scanData.enhancedFront) {
      const url = await uploadCardImage(userId, scan.id, scanData.enhancedFront, 'enhanced_front');
      if (url) updates.enhanced_front_path = url;
    }

    if (scanData.enhancedBack) {
      const url = await uploadCardImage(userId, scan.id, scanData.enhancedBack, 'enhanced_back');
      if (url) updates.enhanced_back_path = url;
    }

    if (scanData.userCardImage) {
      const url = await uploadCardImage(userId, scan.id, scanData.userCardImage, 'user_card');
      if (url) updates.user_card_image = url;
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

/** Insert a new scan (kept for existing callers). */
export async function saveScan(userId, scanData) {
  return upsertScan(userId, scanData, null);
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
 * Log an identification outcome (what the matcher suggested vs what the user chose).
 * Fire-and-forget: never throws, never blocks the UI. Requires a signed-in user (RLS).
 * @param {{ dbVersion?: number, variant: string, status: string, top5: Array<{id:string, similarity:number}>, chosenId?: string|null, ocrRead?: string|null }} o
 */
export async function logIdentification({ dbVersion = null, variant, status, top5, chosenId = null, ocrRead = null }) {
  try {
    if (!isSupabaseConfigured()) return;
    const { data: { user } = {} } = await supabase.auth.getUser();
    if (!user) return;
    const { error } = await supabase.from('card_identifications').insert({
      user_id: user.id,
      db_version: dbVersion,
      variant,
      status,
      top5: (top5 || []).slice(0, 5).map((m) => ({ id: m.id, similarity: Math.round((m.similarity ?? 0) * 1000) / 1000 })),
      chosen_id: chosenId,
      ocr_read: ocrRead,
    });
    if (error) console.warn('[logIdentification]', error.message);
  } catch (e) {
    console.warn('[logIdentification]', e?.message || e);
  }
}
