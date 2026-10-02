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
 * Delete the account completely, server-side (api/account.js, service role): stored images,
 * scans, credits, jobs, the profile, the Stripe customer and the auth user. Slab orders keep
 * their cert record with the person detached. Apple 5.1.1(v): in-app deletion is complete.
 */
export async function deleteAccount() {
  if (!isSupabaseConfigured()) throw new Error('Authentication not configured');
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not signed in');
  const res = await fetch('/api/account', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ action: 'delete', confirm: 'DELETE' }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || data.error || `Delete failed (${res.status})`);
  await supabase.auth.signOut().catch(() => {});
  return data.report;
}

/** Download everything we hold for the signed-in user as JSON (privacy policy "Export"). */
export async function exportAccountData() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not signed in');
  const res = await fetch('/api/account', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ action: 'export' }),
  });
  if (!res.ok) throw new Error(`Export failed (${res.status})`);
  return res.json();
}

/** Email a password-reset link; the app handles the PASSWORD_RECOVERY event on return. */
export async function requestPasswordReset(email) {
  if (!isSupabaseConfigured()) throw new Error('Authentication not configured');
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/?recovery=1` });
  if (error) throw error;
}

export async function updatePassword(newPassword) {
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw error;
}

/** Supabase sends a confirmation to the new address; the change applies after the click. */
export async function updateEmail(newEmail) {
  const { error } = await supabase.auth.updateUser({ email: newEmail });
  if (error) throw error;
}
