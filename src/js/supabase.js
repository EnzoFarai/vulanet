// src/js/supabase.js
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = 'YOUR_SUPABASE_URL';
const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Helper to check if user is logged in
export async function isLoggedIn() {
  const { data: { session } } = await supabase.auth.getSession();
  return !!session;
}

// Helper to get current user profile
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

// Save temporary lesson progress (for unregistered users)
export function saveTempProgress(lessonData) {
  sessionStorage.setItem('tempLessonProgress', JSON.stringify(lessonData));
}

export function getTempProgress() {
  const data = sessionStorage.getItem('tempLessonProgress');
  return data ? JSON.parse(data) : null;
}

export function clearTempProgress() {
  sessionStorage.removeItem('tempLessonProgress');
}
