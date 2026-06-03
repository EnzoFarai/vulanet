// src/js/supabase.js
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

// REPLACE WITH YOUR ACTUAL SUPABASE CREDENTIALS
const SUPABASE_URL = 'https://your-project.supabase.co';
const SUPABASE_ANON_KEY = 'your-anon-key';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export async function isLoggedIn() {
  const { data: { session } } = await supabase.auth.getSession();
  return !!session;
}

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
