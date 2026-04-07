/**
 * SlabSense - Auth Hook
 * Manages authentication state across the app
 */

import { useState, useEffect, useCallback } from 'react';
import { supabase, isSupabaseConfigured } from '../services/supabase.js';
import { getProfile } from '../services/auth.js';

export function useAuth() {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Load user profile
  const loadProfile = useCallback(async (userId) => {
    try {
      const profileData = await getProfile(userId);
      setProfile(profileData);
    } catch (err) {
      console.error('Error loading profile:', err);
    }
  }, []);

  // Initialize auth state
  useEffect(() => {
    if (!isSupabaseConfigured()) {
      setLoading(false);
      return;
    }

    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        loadProfile(session.user.id);
      }
      setLoading(false);
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        setUser(session?.user ?? null);
        if (session?.user) {
          loadProfile(session.user.id);
        } else {
          setProfile(null);
        }
        setLoading(false);
      }
    );

    return () => subscription.unsubscribe();
  }, [loadProfile]);

  // Sign up
  const signUp = async (email, password, displayName) => {
    if (!isSupabaseConfigured()) {
      throw new Error('Auth not configured');
    }
    setError(null);
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { display_name: displayName || email.split('@')[0] }
        }
      });
      if (error) throw error;
      return data;
    } catch (err) {
      setError(err.message);
      throw err;
    }
  };

  // Sign in
  const signIn = async (email, password) => {
    if (!isSupabaseConfigured()) {
      throw new Error('Auth not configured');
    }
    setError(null);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password
      });
      if (error) throw error;
      return data;
    } catch (err) {
      setError(err.message);
      throw err;
    }
  };

  // Sign out
  const signOut = async () => {
    if (!isSupabaseConfigured()) return;
    setError(null);
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      setUser(null);
      setProfile(null);
    } catch (err) {
      setError(err.message);
      throw err;
    }
  };

  // Refresh profile
  const refreshProfile = useCallback(() => {
    if (user) {
      loadProfile(user.id);
    }
  }, [user, loadProfile]);

  // Check if user has pro access
  const isPro = profile?.tier === 'pro_monthly' || profile?.tier === 'beta_lifetime';
  const tier = profile?.tier || 'free';

  return {
    user,
    profile,
    loading,
    error,
    isAuthenticated: !!user,
    isPro,
    tier,
    isConfigured: isSupabaseConfigured(),
    signUp,
    signIn,
    signOut,
    refreshProfile,
  };
}
