/**
 * SlabSense - Authentication Service
 */

import { supabase, isSupabaseConfigured } from './supabase.js';

/**
 * Sign up a new user with email and password
 */
export async function signUp(email, password, displayName = null) {
  if (!isSupabaseConfigured()) {
    throw new Error('Authentication not configured');
  }

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        display_name: displayName || email.split('@')[0],
      },
    },
  });

  if (error) throw error;
  return data;
}

/**
 * Sign in with email and password
 */
export async function signIn(email, password) {
  if (!isSupabaseConfigured()) {
    throw new Error('Authentication not configured');
  }

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) throw error;
  return data;
}

/**
 * Sign out the current user
 */
export async function signOut() {
  if (!isSupabaseConfigured()) {
    throw new Error('Authentication not configured');
  }

  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

/**
 * Get the current user session
 */
export async function getSession() {
  if (!isSupabaseConfigured()) {
    return null;
  }

  const { data: { session } } = await supabase.auth.getSession();
  return session;
}

/**
 * Get the current user
 */
export async function getUser() {
  if (!isSupabaseConfigured()) {
    return null;
  }

  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

/**
 * Get user profile from profiles table
 */
export async function getProfile(userId) {
  if (!isSupabaseConfigured()) {
    return null;
  }

  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();

  if (error) throw error;
  return data;
}

/**
 * Update user profile
 */
export async function updateProfile(userId, updates) {
  if (!isSupabaseConfigured()) {
    throw new Error('Authentication not configured');
  }

  const { data, error } = await supabase
    .from('profiles')
    .update(updates)
    .eq('id', userId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Listen for auth state changes
 */
export function onAuthStateChange(callback) {
  if (!isSupabaseConfigured()) {
    return { data: { subscription: { unsubscribe: () => {} } } };
  }

  return supabase.auth.onAuthStateChange(callback);
}

/**
 * Send password reset email
 */
export async function resetPassword(email) {
  if (!isSupabaseConfigured()) {
    throw new Error('Authentication not configured');
  }

  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/reset-password`,
  });

  if (error) throw error;
}

/**
 * Check if user has pro/lifetime access
 */
export async function checkProAccess(userId) {
  if (!isSupabaseConfigured()) {
    return false;
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('tier')
    .eq('id', userId)
    .single();

  return profile?.tier === 'pro_monthly' || profile?.tier === 'beta_lifetime';
}
