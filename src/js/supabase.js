// src/js/supabase.js
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

// Read from environment variables (set in .env or Vercel)
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('Missing Supabase environment variables. Make sure .env exists and VITE_* are set.');
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/**
 * Check if a user is currently logged in
 */
export async function isLoggedIn() {
  const { data: { session } } = await supabase.auth.getSession();
  return !!session;
}

/**
 * Get the current user and their profile
 */
export async function getCurrentUserProfile() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single();
  return { user, profile };
}

/**
 * Store temporary lesson progress for unregistered users (sessionStorage)
 */
export function saveTempProgress(courseId, lessonId, stats) {
  const temp = {
    courseId,
    lessonId,
    completedAt: Date.now(),
    stats: { ...stats }
  };
  sessionStorage.setItem('tempLessonProgress', JSON.stringify(temp));
}

export function getTempProgress() {
  const data = sessionStorage.getItem('tempLessonProgress');
  return data ? JSON.parse(data) : null;
}

export function clearTempProgress() {
  sessionStorage.removeItem('tempLessonProgress');
}
