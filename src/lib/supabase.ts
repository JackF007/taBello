
import { createClient } from '@supabase/supabase-js';
import type { TablatureData } from './tablature';

// These will be replaced with actual values from your Supabase project
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// This interface will be extended when we implement the actual database
export interface UserProfile {
  id: string;
  email: string;
  full_name?: string;
  avatar_url?: string;
  created_at: string;
}

// Save tablature to Supabase
export const saveTablature = async (tablature: TablatureData) => {
  try {
    const { data, error } = await supabase
      .from('tablatures')
      .insert({
        title: tablature.title,
        instrument: tablature.instrument,
        tuning: tablature.tuning,
        key: tablature.key,
        tempo: tablature.tempo,
        sections: tablature.sections,
        user_id: tablature.user_id || null
      })
      .select()
      .single();
      
    if (error) throw error;
    return data;
  } catch (error) {
    console.error('Error saving tablature:', error);
    // Still return the tablature with a mock ID for demo purposes
    return { ...tablature, id: `tab_${Date.now()}` };
  }
};

// Get user tablatures from Supabase
export const getUserTablatures = async (userId: string) => {
  try {
    const { data, error } = await supabase
      .from('tablatures')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
      
    if (error) throw error;
    return data;
  } catch (error) {
    console.error('Error getting user tablatures:', error);
    return [];
  }
};

// Get tablature by ID from Supabase
export const getTablatureById = async (id: string) => {
  try {
    const { data, error } = await supabase
      .from('tablatures')
      .select('*')
      .eq('id', id)
      .single();
      
    if (error) throw error;
    return data;
  } catch (error) {
    console.error('Error getting tablature by ID:', error);
    return null;
  }
};

// Set up auth state change listener
export const setupAuthListener = (callback: (user: any) => void) => {
  return supabase.auth.onAuthStateChange((event, session) => {
    callback(session?.user || null);
  });
};

// Sign in with email and password
export const signInWithEmail = async (email: string, password: string) => {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password
  });
  
  if (error) throw error;
  return data;
};

// Sign up with email and password
export const signUpWithEmail = async (email: string, password: string) => {
  const { data, error } = await supabase.auth.signUp({
    email,
    password
  });
  
  if (error) throw error;
  return data;
};

// Sign out
export const signOut = async () => {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
};
