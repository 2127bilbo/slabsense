/**
 * SlabSense - Scans Service
 * Handles saving and retrieving card scan data
 */

import { supabase, isSupabaseConfigured } from './supabase.js';

/**
 * Save a new scan to the database
 */
export async function saveScan(userId, scanData) {
  if (!isSupabaseConfigured()) {
    throw new Error('Database not configured');
  }

  const { data, error } = await supabase
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
    })
    .select()
    .single();

  if (error) throw error;
  return data;
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
